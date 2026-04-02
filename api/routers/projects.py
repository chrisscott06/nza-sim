"""
api/routers/projects.py

Project management endpoints for NZA Simulate.

POST   /api/projects                      — Create a new project
GET    /api/projects                      — List all projects
GET    /api/projects/{id}                 — Get full project details
PUT    /api/projects/{id}                 — Update project (partial)
DELETE /api/projects/{id}                 — Delete project
PUT    /api/projects/{id}/building        — Update building config
PUT    /api/projects/{id}/systems         — Update systems config
POST   /api/projects/{id}/simulate        — Run simulation, store results
GET    /api/projects/{id}/simulations     — List simulation runs for a project
"""

import json
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.db.database import get_db, DEFAULT_BUILDING_CONFIG, DEFAULT_CONSTRUCTION_CHOICES, DEFAULT_SYSTEMS_CONFIG
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
    get_hourly_profiles,
    get_typical_day_profiles,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])


# ── Pydantic models ────────────────────────────────────────────────────────────

class CreateProjectRequest(BaseModel):
    name: str = "New Project"
    description: str | None = None


class UpdateProjectRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    building_config: dict | None = None
    systems_config: dict | None = None
    construction_choices: dict | None = None
    schedule_assignments: dict | None = None
    weather_file: str | None = None


class UpdateBuildingRequest(BaseModel):
    """Partial update for building config — any fields provided will be merged."""
    model_config = {"extra": "allow"}

    def to_dict(self) -> dict:
        return self.model_dump(exclude_none=True)


class UpdateSystemsRequest(BaseModel):
    """Partial update for systems config — any fields provided will be merged."""
    model_config = {"extra": "allow"}

    def to_dict(self) -> dict:
        return self.model_dump(exclude_none=True)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_project(row) -> dict:
    """Convert a database row to a project dict."""
    return {
        "id":                   row["id"],
        "name":                 row["name"],
        "description":          row["description"],
        "created_at":           row["created_at"],
        "updated_at":           row["updated_at"],
        "building_config":      json.loads(row["building_config"]),
        "systems_config":       json.loads(row["systems_config"]),
        "construction_choices": json.loads(row["construction_choices"]),
        "schedule_assignments": json.loads(row["schedule_assignments"]) if row["schedule_assignments"] else None,
        "weather_file":         row["weather_file"],
        "metadata":             json.loads(row["metadata"]) if row["metadata"] else None,
    }


def _row_to_sim_run(row) -> dict:
    """Convert a simulation_runs row to a dict."""
    return {
        "id":                       row["id"],
        "project_id":               row["project_id"],
        "scenario_id":              row["scenario_id"] if "scenario_id" in row.keys() else None,
        "scenario_name":            row["scenario_name"],
        "status":                   row["status"],
        "results_summary":          json.loads(row["results_summary"]) if row["results_summary"] else None,
        "results_monthly":          json.loads(row["results_monthly"]) if row["results_monthly"] else None,
        "envelope_heat_flow":       json.loads(row["envelope_heat_flow"]) if row["envelope_heat_flow"] else None,
        "hourly_profiles":          json.loads(row["hourly_profiles"]) if row["hourly_profiles"] else None,
        "sankey_data":              json.loads(row["sankey_data"]) if row["sankey_data"] else None,
        "annual_energy":            json.loads(row["annual_energy"]) if row["annual_energy"] else None,
        "energyplus_warnings":      row["energyplus_warnings"],
        "energyplus_errors":        row["energyplus_errors"],
        "error_message":            row["error_message"],
        "simulation_time_seconds":  row["simulation_time_seconds"],
        "created_at":               row["created_at"],
    }


# ── Project CRUD ───────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_project(request: CreateProjectRequest):
    """Create a new project with default building, systems, and construction config."""
    project_id = str(uuid.uuid4())
    building_config = {**DEFAULT_BUILDING_CONFIG, "name": request.name}

    async with get_db() as db:
        await db.execute(
            """
            INSERT INTO projects
                (id, name, description, building_config, systems_config, construction_choices)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                project_id,
                request.name,
                request.description,
                json.dumps(building_config),
                json.dumps(DEFAULT_SYSTEMS_CONFIG),
                json.dumps(DEFAULT_CONSTRUCTION_CHOICES),
            ),
        )
        await db.commit()

        row = await db.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        project = await row.fetchone()

    return _row_to_project(project)


@router.get("")
async def list_projects():
    """List all projects, sorted by most recently updated."""
    async with get_db() as db:
        cursor = await db.execute(
            """
            SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
                   COUNT(s.id) AS simulation_count
            FROM projects p
            LEFT JOIN simulation_runs s ON s.project_id = p.id
            GROUP BY p.id
            ORDER BY p.updated_at DESC
            """
        )
        rows = await cursor.fetchall()

    return [
        {
            "id":               row["id"],
            "name":             row["name"],
            "description":      row["description"],
            "created_at":       row["created_at"],
            "updated_at":       row["updated_at"],
            "simulation_count": row["simulation_count"],
        }
        for row in rows
    ]


@router.get("/{project_id}")
async def get_project(project_id: str):
    """Get full project details including simulation run list."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM projects WHERE id = ?", (project_id,)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")

        project = _row_to_project(row)

        # Include list of simulation runs (summary only, no large result blobs)
        sim_cursor = await db.execute(
            """
            SELECT id, scenario_name, status, simulation_time_seconds, created_at,
                   results_summary, energyplus_warnings, energyplus_errors, error_message
            FROM simulation_runs
            WHERE project_id = ?
            ORDER BY created_at DESC
            """,
            (project_id,),
        )
        sim_rows = await sim_cursor.fetchall()

    project["simulations"] = [
        {
            "id":                      r["id"],
            "scenario_name":           r["scenario_name"],
            "status":                  r["status"],
            "simulation_time_seconds": r["simulation_time_seconds"],
            "created_at":              r["created_at"],
            "results_summary":         json.loads(r["results_summary"]) if r["results_summary"] else None,
            "energyplus_warnings":     r["energyplus_warnings"],
            "energyplus_errors":       r["energyplus_errors"],
            "error_message":           r["error_message"],
        }
        for r in sim_rows
    ]

    return project


@router.put("/{project_id}")
async def update_project(project_id: str, request: UpdateProjectRequest):
    """Partial update for a project."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM projects WHERE id = ?", (project_id,)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")

        current = _row_to_project(row)

        # Merge provided fields into current values
        name                 = request.name or current["name"]
        description          = request.description if request.description is not None else current["description"]
        building_config      = request.building_config or current["building_config"]
        systems_config       = request.systems_config or current["systems_config"]
        construction_choices = request.construction_choices or current["construction_choices"]
        schedule_assignments = request.schedule_assignments if request.schedule_assignments is not None else current["schedule_assignments"]
        weather_file         = request.weather_file if request.weather_file is not None else current["weather_file"]

        await db.execute(
            """
            UPDATE projects SET
                name = ?, description = ?, building_config = ?, systems_config = ?,
                construction_choices = ?, schedule_assignments = ?, weather_file = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                name,
                description,
                json.dumps(building_config),
                json.dumps(systems_config),
                json.dumps(construction_choices),
                json.dumps(schedule_assignments) if schedule_assignments is not None else None,
                weather_file,
                project_id,
            ),
        )
        await db.commit()

        cursor = await db.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        updated = await cursor.fetchone()

    return _row_to_project(updated)


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: str):
    """Delete a project and all its simulation runs (CASCADE)."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id FROM projects WHERE id = ?", (project_id,)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")

        await db.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        await db.commit()


@router.put("/{project_id}/building")
async def update_building(project_id: str, body: dict):
    """
    Merge-update the building config.

    The body can be a partial or full building_config dict.
    Existing keys not mentioned in the body are preserved.
    """
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT building_config FROM projects WHERE id = ?", (project_id,)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")

        current_config = json.loads(row["building_config"])

        # Deep-merge: handle nested 'wwr' dict specially
        merged = {**current_config}
        for key, value in body.items():
            if key == "wwr" and isinstance(value, dict) and isinstance(merged.get("wwr"), dict):
                merged["wwr"] = {**merged["wwr"], **value}
            else:
                merged[key] = value

        await db.execute(
            """
            UPDATE projects SET building_config = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (json.dumps(merged), project_id),
        )
        await db.commit()

        cursor = await db.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        updated = await cursor.fetchone()

    return _row_to_project(updated)


@router.put("/{project_id}/systems")
async def update_systems(project_id: str, body: dict):
    """
    Merge-update the systems config.

    The body can be a partial or full systems_config dict.
    Existing keys not mentioned in the body are preserved.
    """
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT systems_config FROM projects WHERE id = ?", (project_id,)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")

        current_config = json.loads(row["systems_config"])
        merged = {**current_config, **body}

        await db.execute(
            """
            UPDATE projects SET systems_config = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (json.dumps(merged), project_id),
        )
        await db.commit()

        cursor = await db.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        updated = await cursor.fetchone()

    return _row_to_project(updated)


# ── Project simulation ─────────────────────────────────────────────────────────

@router.post("/{project_id}/simulate")
async def simulate_project(project_id: str, scenario_name: str = "Baseline"):
    """
    Run a simulation for the given project.

    Reads the current project config from the database, runs EnergyPlus,
    stores the results in simulation_runs, and returns the full results dict.
    """
    # Load project from DB
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM projects WHERE id = ?", (project_id,)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")

    project = _row_to_project(row)

    # Resolve weather
    weather_path = resolve_weather_file(project.get("weather_file"))

    run_id = str(uuid.uuid4())[:8]
    run_dir = SIMULATIONS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    building_params = project["building_config"]
    construction_choices = project["construction_choices"]
    systems_config = project["systems_config"]
    schedule_assignments = project.get("schedule_assignments") or {}

    # Resolve schedule assignments: fetch config_json for each assigned library item
    schedule_overrides: dict = {}
    if schedule_assignments:
        async with get_db() as db:
            for assign_key, item_id in schedule_assignments.items():
                cursor = await db.execute(
                    "SELECT config_json FROM library_items WHERE id = ?", (item_id,)
                )
                row = await cursor.fetchone()
                if row and row["config_json"]:
                    schedule_overrides[assign_key] = json.loads(row["config_json"])

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
        # Store error run in DB
        async with get_db() as db:
            await db.execute(
                """
                INSERT INTO simulation_runs
                    (id, project_id, scenario_name, status, input_snapshot,
                     energyplus_warnings, energyplus_errors, error_message, simulation_time_seconds)
                VALUES (?, ?, ?, 'error', ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    project_id,
                    scenario_name,
                    json.dumps({"building": building_params, "constructions": construction_choices, "systems": systems_config}),
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

    # Parse results
    summary         = get_building_summary(sql)
    annual_energy   = get_annual_energy_by_enduse(sql)
    monthly_energy  = get_monthly_energy_by_enduse(sql)
    envelope        = get_envelope_heat_flow(sql)
    envelope_detail = get_envelope_heat_flow_detailed(sql)
    hourly_profiles = get_typical_day_profiles(sql)

    results = {
        "run_id":            run_id,
        "project_id":        project_id,
        "scenario_name":     scenario_name,
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

    # Cache results to file
    with open(run_dir / "results.json", "w") as f:
        json.dump(results, f, indent=2)

    # Store in DB — extract Sankey data if present
    sankey_data = results.get("sankey_data")

    async with get_db() as db:
        await db.execute(
            """
            INSERT INTO simulation_runs
                (id, project_id, scenario_name, status, input_snapshot,
                 results_summary, results_monthly, results_hourly_path,
                 envelope_heat_flow, hourly_profiles, sankey_data, annual_energy,
                 energyplus_warnings, energyplus_errors, simulation_time_seconds)
            VALUES (?, ?, ?, 'complete', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            """,
            (
                run_id,
                project_id,
                scenario_name,
                json.dumps({"building": building_params, "constructions": construction_choices, "systems": systems_config}),
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
        # Update project updated_at
        await db.execute(
            "UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (project_id,),
        )
        await db.commit()

    return results


@router.get("/{project_id}/simulations")
async def list_project_simulations(project_id: str):
    """List all simulation runs for a project, most recent first."""
    async with get_db() as db:
        # Verify project exists
        cursor = await db.execute(
            "SELECT id FROM projects WHERE id = ?", (project_id,)
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")

        cursor = await db.execute(
            """
            SELECT id, scenario_name, status, simulation_time_seconds, created_at,
                   results_summary, energyplus_warnings, energyplus_errors, error_message
            FROM simulation_runs
            WHERE project_id = ?
            ORDER BY created_at DESC
            """,
            (project_id,),
        )
        rows = await cursor.fetchall()

    return [
        {
            "id":                      r["id"],
            "scenario_name":           r["scenario_name"],
            "status":                  r["status"],
            "simulation_time_seconds": r["simulation_time_seconds"],
            "created_at":              r["created_at"],
            "results_summary":         json.loads(r["results_summary"]) if r["results_summary"] else None,
            "energyplus_warnings":     r["energyplus_warnings"],
            "energyplus_errors":       r["energyplus_errors"],
            "error_message":           r["error_message"],
        }
        for r in rows
    ]


@router.get("/{project_id}/simulations/{run_id}")
async def get_simulation_result(project_id: str, run_id: str):
    """Return full results for a specific simulation run."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM simulation_runs WHERE id = ? AND project_id = ?",
            (run_id, project_id),
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(
                status_code=404,
                detail=f"Simulation run '{run_id}' not found for project '{project_id}'",
            )

    return _row_to_sim_run(row)
