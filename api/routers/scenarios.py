"""
api/routers/scenarios.py

Scenario management endpoints for NZA Simulate.

POST   /api/projects/{project_id}/scenarios                         — Create scenario
GET    /api/projects/{project_id}/scenarios                         — List scenarios
GET    /api/projects/{project_id}/scenarios/{scenario_id}           — Get scenario
PUT    /api/projects/{project_id}/scenarios/{scenario_id}           — Update scenario
DELETE /api/projects/{project_id}/scenarios/{scenario_id}           — Delete scenario
POST   /api/projects/{project_id}/scenarios/{scenario_id}/simulate  — Run simulation for scenario
"""
from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.db.database import get_db
from api.utils import resolve_weather_file
from nza_engine.config import SIMULATIONS_DIR
from nza_engine.generators.epjson_assembler import assemble_epjson
from nza_engine.runner import run_simulation
from nza_engine.parsers.sql_parser import (
    get_building_summary,
    get_annual_energy_by_enduse,
    get_monthly_energy_by_enduse,
    get_zone_summary,
    get_envelope_heat_flow,
    get_envelope_heat_flow_detailed,
    get_typical_day_profiles,
)

router = APIRouter(prefix="/api/projects", tags=["scenarios"])


# ── Pydantic models ────────────────────────────────────────────────────────────

class CreateScenarioRequest(BaseModel):
    name: str
    description: str | None = None
    source: str = "baseline"  # "baseline" to copy project config, or a scenario ID


class UpdateScenarioRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    building_config: dict | None = None
    systems_config: dict | None = None
    construction_choices: dict | None = None
    schedule_assignments: dict | None = None
    weather_file: str | None = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _row_to_scenario(row) -> dict:
    """Convert a scenarios row to a dict."""
    return {
        "id":                    row["id"],
        "project_id":            row["project_id"],
        "name":                  row["name"],
        "description":           row["description"],
        "is_baseline":           bool(row["is_baseline"]),
        "building_config":       json.loads(row["building_config"]),
        "systems_config":        json.loads(row["systems_config"]),
        "construction_choices":  json.loads(row["construction_choices"]),
        "schedule_assignments":  json.loads(row["schedule_assignments"]) if row["schedule_assignments"] else None,
        "weather_file":          row["weather_file"],
        "changes_from_baseline": json.loads(row["changes_from_baseline"]) if row["changes_from_baseline"] else [],
        "created_at":            row["created_at"],
        "updated_at":            row["updated_at"],
    }


async def _get_item_display(name: str | None, item_type: str, db) -> str:
    """Look up a library item's display name, appending key metric where available."""
    if name is None:
        return "None"
    cursor = await db.execute(
        "SELECT display_name, config_json FROM library_items WHERE library_type = ? AND name = ?",
        (item_type, name),
    )
    row = await cursor.fetchone()
    if not row:
        return str(name)
    display = row["display_name"] or name
    if row["config_json"]:
        cfg = json.loads(row["config_json"])
        if item_type == "construction":
            u = cfg.get("u_value_W_per_m2K")
            if u is not None:
                display = f"{display} (U={u})"
        elif item_type == "system":
            desc = cfg.get("description") or cfg.get("display_name")
            if desc and desc != display:
                display = desc
    return display


async def _compute_changes(baseline: dict, scenario: dict, db) -> list[dict]:
    """
    Compare two configuration dicts and return a list of parameter differences.
    Covers construction_choices, systems_config, and building_config (excluding name).
    """
    changes = []

    # Construction choices
    b_cc = baseline.get("construction_choices", {})
    s_cc = scenario.get("construction_choices", {})
    for key in sorted(set(list(b_cc.keys()) + list(s_cc.keys()))):
        b_val = b_cc.get(key)
        s_val = s_cc.get(key)
        if b_val != s_val:
            b_display = await _get_item_display(b_val, "construction", db)
            s_display = await _get_item_display(s_val, "construction", db)
            changes.append({
                "category":        "construction",
                "parameter":       key,
                "baseline_value":  b_val,
                "scenario_value":  s_val,
                "baseline_display": b_display,
                "scenario_display": s_display,
            })

    # Systems config
    b_sys = baseline.get("systems_config", {})
    s_sys = scenario.get("systems_config", {})
    for key in sorted(set(list(b_sys.keys()) + list(s_sys.keys()))):
        b_val = b_sys.get(key)
        s_val = s_sys.get(key)
        if b_val != s_val:
            if isinstance(b_val, str):
                b_display = await _get_item_display(b_val, "system", db)
            else:
                b_display = str(b_val)
            if isinstance(s_val, str):
                s_display = await _get_item_display(s_val, "system", db)
            else:
                s_display = str(s_val)
            changes.append({
                "category":        "systems",
                "parameter":       key,
                "baseline_value":  b_val,
                "scenario_value":  s_val,
                "baseline_display": b_display,
                "scenario_display": s_display,
            })

    # Building config (numeric/geometry params — skip name)
    b_bc = baseline.get("building_config", {})
    s_bc = scenario.get("building_config", {})
    for key in sorted(set(list(b_bc.keys()) + list(s_bc.keys()))):
        if key == "name":
            continue
        b_val = b_bc.get(key)
        s_val = s_bc.get(key)
        if b_val != s_val:
            changes.append({
                "category":        "building",
                "parameter":       key,
                "baseline_value":  b_val,
                "scenario_value":  s_val,
                "baseline_display": str(b_val),
                "scenario_display": str(s_val),
            })

    return changes


# ── Scenario CRUD ───────────────────────────────────────────────────────────────

@router.post("/{project_id}/scenarios", status_code=201)
async def create_scenario(project_id: str, request: CreateScenarioRequest):
    """
    Create a new scenario for a project.

    source="baseline" copies the project's current config.
    source=<scenario_id> copies from that existing scenario.
    The first scenario created is automatically marked is_baseline=1.
    """
    async with get_db() as db:
        # Verify project exists
        cur = await db.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        project_row = await cur.fetchone()
        if not project_row:
            raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")

        # Is this the first scenario for the project?
        cur = await db.execute(
            "SELECT COUNT(*) AS cnt FROM scenarios WHERE project_id = ?", (project_id,)
        )
        count_row = await cur.fetchone()
        is_first    = (count_row["cnt"] == 0)
        is_baseline = 1 if is_first else 0

        # Resolve source configuration
        if request.source == "baseline":
            building_config      = json.loads(project_row["building_config"])
            systems_config       = json.loads(project_row["systems_config"])
            construction_choices = json.loads(project_row["construction_choices"])
            schedule_assignments = json.loads(project_row["schedule_assignments"]) if project_row["schedule_assignments"] else None
            weather_file         = project_row["weather_file"]
        else:
            cur = await db.execute(
                "SELECT * FROM scenarios WHERE id = ? AND project_id = ?",
                (request.source, project_id),
            )
            src_row = await cur.fetchone()
            if not src_row:
                raise HTTPException(
                    status_code=404,
                    detail=f"Source scenario '{request.source}' not found for this project",
                )
            building_config      = json.loads(src_row["building_config"])
            systems_config       = json.loads(src_row["systems_config"])
            construction_choices = json.loads(src_row["construction_choices"])
            schedule_assignments = json.loads(src_row["schedule_assignments"]) if src_row["schedule_assignments"] else None
            weather_file         = src_row["weather_file"]

        # Compute changes_from_baseline
        if is_baseline:
            changes = []
        else:
            cur = await db.execute(
                "SELECT * FROM scenarios WHERE project_id = ? AND is_baseline = 1",
                (project_id,),
            )
            baseline_row = await cur.fetchone()
            if baseline_row:
                baseline_cfg = {
                    "construction_choices": json.loads(baseline_row["construction_choices"]),
                    "systems_config":       json.loads(baseline_row["systems_config"]),
                    "building_config":      json.loads(baseline_row["building_config"]),
                }
                scenario_cfg = {
                    "construction_choices": construction_choices,
                    "systems_config":       systems_config,
                    "building_config":      building_config,
                }
                changes = await _compute_changes(baseline_cfg, scenario_cfg, db)
            else:
                changes = []

        scenario_id = f"scen_{str(uuid.uuid4())[:8]}"

        await db.execute(
            """
            INSERT INTO scenarios
                (id, project_id, name, description, is_baseline,
                 building_config, systems_config, construction_choices,
                 schedule_assignments, weather_file, changes_from_baseline)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                scenario_id,
                project_id,
                request.name,
                request.description,
                is_baseline,
                json.dumps(building_config),
                json.dumps(systems_config),
                json.dumps(construction_choices),
                json.dumps(schedule_assignments) if schedule_assignments else None,
                weather_file,
                json.dumps(changes),
            ),
        )
        await db.commit()

        # If this is the first (baseline) scenario, link any unlinked completed
        # simulation runs for this project to it, so historical results appear.
        if is_baseline:
            await db.execute(
                """
                UPDATE simulation_runs
                SET scenario_id = ?
                WHERE project_id = ? AND scenario_id IS NULL AND status = 'complete'
                """,
                (scenario_id, project_id),
            )
            await db.commit()

        cur = await db.execute("SELECT * FROM scenarios WHERE id = ?", (scenario_id,))
        new_row = await cur.fetchone()

    return _row_to_scenario(new_row)


@router.get("/{project_id}/scenarios")
async def list_scenarios(project_id: str):
    """List all scenarios for a project, with latest EUI from simulation results."""
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")

        cur = await db.execute(
            """
            SELECT s.*,
                   (SELECT sr.results_summary
                    FROM simulation_runs sr
                    WHERE sr.scenario_id = s.id AND sr.status = 'complete'
                    ORDER BY sr.created_at DESC LIMIT 1) AS latest_results_summary,
                   (SELECT sr.id
                    FROM simulation_runs sr
                    WHERE sr.scenario_id = s.id AND sr.status = 'complete'
                    ORDER BY sr.created_at DESC LIMIT 1) AS latest_run_id
            FROM scenarios s
            WHERE s.project_id = ?
            ORDER BY s.is_baseline DESC, s.created_at ASC
            """,
            (project_id,),
        )
        rows = await cur.fetchall()

    result = []
    for row in rows:
        scenario = _row_to_scenario(row)
        latest_summary_raw = row["latest_results_summary"]
        if latest_summary_raw:
            summary = json.loads(latest_summary_raw)
            scenario["latest_eui"]    = summary.get("eui_kWh_per_m2")
            scenario["latest_run_id"] = row["latest_run_id"]
        else:
            scenario["latest_eui"]    = None
            scenario["latest_run_id"] = None
        result.append(scenario)

    return result


@router.get("/{project_id}/scenarios/{scenario_id}")
async def get_scenario(project_id: str, scenario_id: str):
    """Get full details for a specific scenario."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM scenarios WHERE id = ? AND project_id = ?",
            (scenario_id, project_id),
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(
                status_code=404,
                detail=f"Scenario '{scenario_id}' not found for project '{project_id}'",
            )
    return _row_to_scenario(row)


@router.put("/{project_id}/scenarios/{scenario_id}")
async def update_scenario(project_id: str, scenario_id: str, request: UpdateScenarioRequest):
    """Partially update a scenario's configuration. Auto-recomputes changes_from_baseline."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM scenarios WHERE id = ? AND project_id = ?",
            (scenario_id, project_id),
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(
                status_code=404,
                detail=f"Scenario '{scenario_id}' not found",
            )

        current = _row_to_scenario(row)

        # Merge updates
        name                 = request.name or current["name"]
        description          = request.description if request.description is not None else current["description"]
        building_config      = request.building_config or current["building_config"]
        systems_config       = request.systems_config or current["systems_config"]
        construction_choices = request.construction_choices or current["construction_choices"]
        schedule_assignments = (
            request.schedule_assignments
            if request.schedule_assignments is not None
            else current["schedule_assignments"]
        )
        weather_file = request.weather_file if request.weather_file is not None else current["weather_file"]

        # Recompute changes_from_baseline
        if current["is_baseline"]:
            changes = []
        else:
            cur2 = await db.execute(
                "SELECT * FROM scenarios WHERE project_id = ? AND is_baseline = 1",
                (project_id,),
            )
            baseline_row = await cur2.fetchone()
            if baseline_row:
                baseline_cfg = {
                    "construction_choices": json.loads(baseline_row["construction_choices"]),
                    "systems_config":       json.loads(baseline_row["systems_config"]),
                    "building_config":      json.loads(baseline_row["building_config"]),
                }
                scenario_cfg = {
                    "construction_choices": construction_choices,
                    "systems_config":       systems_config,
                    "building_config":      building_config,
                }
                changes = await _compute_changes(baseline_cfg, scenario_cfg, db)
            else:
                changes = current["changes_from_baseline"]

        await db.execute(
            """
            UPDATE scenarios SET
                name = ?, description = ?,
                building_config = ?, systems_config = ?, construction_choices = ?,
                schedule_assignments = ?, weather_file = ?,
                changes_from_baseline = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                name,
                description,
                json.dumps(building_config),
                json.dumps(systems_config),
                json.dumps(construction_choices),
                json.dumps(schedule_assignments) if schedule_assignments else None,
                weather_file,
                json.dumps(changes),
                scenario_id,
            ),
        )
        await db.commit()

        cur = await db.execute("SELECT * FROM scenarios WHERE id = ?", (scenario_id,))
        updated = await cur.fetchone()

    return _row_to_scenario(updated)


@router.delete("/{project_id}/scenarios/{scenario_id}", status_code=204)
async def delete_scenario(project_id: str, scenario_id: str):
    """
    Delete a scenario. Cannot delete the baseline if other scenarios exist.
    """
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, is_baseline FROM scenarios WHERE id = ? AND project_id = ?",
            (scenario_id, project_id),
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")

        if row["is_baseline"]:
            cur = await db.execute(
                "SELECT COUNT(*) AS cnt FROM scenarios WHERE project_id = ? AND id != ?",
                (project_id, scenario_id),
            )
            count_row = await cur.fetchone()
            if count_row["cnt"] > 0:
                raise HTTPException(
                    status_code=403,
                    detail=(
                        "Cannot delete the baseline scenario while other scenarios exist. "
                        "Delete all other scenarios first."
                    ),
                )

        await db.execute("DELETE FROM scenarios WHERE id = ?", (scenario_id,))
        await db.commit()


# ── Scenario simulation ────────────────────────────────────────────────────────

@router.post("/{project_id}/scenarios/{scenario_id}/simulate")
async def simulate_scenario(project_id: str, scenario_id: str):
    """
    Run a simulation using the scenario's configuration (not the project's current config).
    Results are stored in simulation_runs with scenario_id set.
    """
    # Load scenario
    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM scenarios WHERE id = ? AND project_id = ?",
            (scenario_id, project_id),
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(
                status_code=404,
                detail=f"Scenario '{scenario_id}' not found for project '{project_id}'",
            )

    scenario = _row_to_scenario(row)

    weather_path = resolve_weather_file(scenario.get("weather_file"))

    run_id  = str(uuid.uuid4())[:8]
    run_dir = SIMULATIONS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    building_params      = scenario["building_config"]
    construction_choices = scenario["construction_choices"]
    systems_config       = scenario["systems_config"]
    schedule_assignments = scenario.get("schedule_assignments") or {}

    # Resolve schedule overrides
    schedule_overrides: dict = {}
    if schedule_assignments:
        async with get_db() as db:
            for assign_key, item_id in schedule_assignments.items():
                cur = await db.execute(
                    "SELECT config_json FROM library_items WHERE id = ?", (item_id,)
                )
                lib_row = await cur.fetchone()
                if lib_row and lib_row["config_json"]:
                    schedule_overrides[assign_key] = json.loads(lib_row["config_json"])

    # Assemble and run
    epjson_path = run_dir / "input.epJSON"
    assemble_epjson(
        building_params=building_params,
        construction_choices=construction_choices,
        weather_file_path=weather_path,
        output_path=epjson_path,
        systems_config=systems_config,
        schedule_overrides=schedule_overrides if schedule_overrides else None,
    )

    sim_result = run_simulation(
        epjson_path=epjson_path,
        weather_file_path=weather_path,
        output_dir=run_dir,
    )

    if not sim_result.success:
        async with get_db() as db:
            await db.execute(
                """
                INSERT INTO simulation_runs
                    (id, project_id, scenario_id, scenario_name, status, input_snapshot,
                     energyplus_warnings, energyplus_errors, error_message, simulation_time_seconds)
                VALUES (?, ?, ?, ?, 'error', ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    project_id,
                    scenario_id,
                    scenario["name"],
                    json.dumps({
                        "building": building_params,
                        "constructions": construction_choices,
                        "systems": systems_config,
                    }),
                    sim_result.warnings,
                    sim_result.fatal_errors,
                    f"{sim_result.fatal_errors} fatal, {sim_result.severe_errors} severe errors",
                    sim_result.runtime_seconds,
                ),
            )
            await db.commit()

        raise HTTPException(
            status_code=500,
            detail=f"EnergyPlus failed with {sim_result.fatal_errors} fatal error(s). Run ID: {run_id}",
        )

    sql = sim_result.sql_path

    summary         = get_building_summary(sql)
    annual_energy   = get_annual_energy_by_enduse(sql)
    monthly_energy  = get_monthly_energy_by_enduse(sql)
    envelope        = get_envelope_heat_flow(sql)
    envelope_detail = get_envelope_heat_flow_detailed(sql)
    hourly_profiles = get_typical_day_profiles(sql)

    results = {
        "run_id":            run_id,
        "project_id":        project_id,
        "scenario_id":       scenario_id,
        "scenario_name":     scenario["name"],
        "status":            "success",
        "runtime_s":         sim_result.runtime_seconds,
        "warnings":          sim_result.warnings,
        "building":          building_params,
        "constructions":     construction_choices,
        "systems":           systems_config,
        "weather_file":      str(weather_path),
        "summary":           summary,
        "annual_energy":     annual_energy,
        "monthly_energy":    monthly_energy,
        "zone_summary":      get_zone_summary(sql),
        "envelope":          envelope,
        "envelope_detailed": envelope_detail,
        "hourly_profiles":   hourly_profiles,
    }

    with open(run_dir / "results.json", "w") as f:
        json.dump(results, f, indent=2)

    sankey_data = results.get("sankey_data")

    async with get_db() as db:
        await db.execute(
            """
            INSERT INTO simulation_runs
                (id, project_id, scenario_id, scenario_name, status, input_snapshot,
                 results_summary, results_monthly, results_hourly_path,
                 envelope_heat_flow, hourly_profiles, sankey_data, annual_energy,
                 energyplus_warnings, energyplus_errors, simulation_time_seconds)
            VALUES (?, ?, ?, ?, 'complete', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            """,
            (
                run_id,
                project_id,
                scenario_id,
                scenario["name"],
                json.dumps({
                    "building": building_params,
                    "constructions": construction_choices,
                    "systems": systems_config,
                }),
                json.dumps(summary),
                json.dumps(monthly_energy),
                str(run_dir / "eplusout.sql"),
                json.dumps(envelope_detail),
                json.dumps(hourly_profiles),
                json.dumps(sankey_data) if sankey_data else None,
                json.dumps(annual_energy),
                sim_result.warnings,
                sim_result.runtime_seconds,
            ),
        )
        await db.commit()

    return results
