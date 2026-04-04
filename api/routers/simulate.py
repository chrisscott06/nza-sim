"""
api/routers/simulate.py

POST /api/simulate — run a simulation from parametric inputs
GET  /api/simulate/{run_id} — retrieve a previous simulation result

DEPRECATED (for standalone testing only)
The primary simulation endpoint is POST /api/projects/{id}/simulate which reads
all inputs from the database.  This endpoint remains for quick testing without
a project context but is not used by the frontend.
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from nza_engine.config import SIMULATIONS_DIR
from api.utils import resolve_weather_file
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
    get_energy_by_fuel,
)

router = APIRouter(prefix="/api/simulate", tags=["simulate"])

# ── Request/response models ────────────────────────────────────────────────────

class WWR(BaseModel):
    north: float = 0.25
    south: float = 0.25
    east:  float = 0.25
    west:  float = 0.25


class BuildingParams(BaseModel):
    name: str = "Building"
    length: float
    width: float
    num_floors: int
    floor_height: float
    orientation: float = 0.0
    wwr: WWR = WWR()


class ConstructionChoices(BaseModel):
    external_wall: str = "cavity_wall_standard"
    roof:          str = "flat_roof_standard"
    ground_floor:  str = "ground_floor_slab"
    glazing:       str = "double_low_e"


class SystemsConfig(BaseModel):
    mode: str = "ideal"                        # 'ideal' | 'detailed'
    hvac_type: str = "vrf_standard"
    cop_heating: float = 3.5                   # VRF heating COP at rated conditions
    cop_cooling: float = 3.2                   # VRF cooling EER at rated conditions
    ventilation_type: str = "mev_standard"
    mvhr_efficiency: float = 0.85              # MVHR sensible heat recovery efficiency (0–1)
    natural_ventilation: bool = False
    natural_vent_threshold: float = 22.0
    dhw_primary: str = "gas_boiler_dhw"
    dhw_preheat: str = "none"
    dhw_setpoint: float = 60.0
    dhw_preheat_setpoint: float = 45.0
    dhw_efficiency: float = 0.92               # gas boiler thermal efficiency
    ashp_cop_dhw: float = 2.8                  # ASHP DHW preheat COP
    lighting_power_density: float = 8.0        # W/m²
    lighting_control: str = "occupancy_sensing"
    pump_type: str = "variable_speed"


class SimulateRequest(BaseModel):
    building: BuildingParams
    constructions: ConstructionChoices = ConstructionChoices()
    systems: SystemsConfig = SystemsConfig()
    weather_file: str = "USE_DEFAULT"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _run_and_parse(run_id: str, request: SimulateRequest) -> dict:
    """
    Core simulation pipeline: assemble → run → parse → return results.
    Stores run artifacts in SIMULATIONS_DIR / run_id /.
    """
    run_dir = SIMULATIONS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    weather_path = resolve_weather_file(request.weather_file)

    # Convert Pydantic models to plain dicts
    building_params = {
        "name": request.building.name,
        "length": request.building.length,
        "width": request.building.width,
        "num_floors": request.building.num_floors,
        "floor_height": request.building.floor_height,
        "orientation": request.building.orientation,
        "wwr": {
            "north": request.building.wwr.north,
            "south": request.building.wwr.south,
            "east":  request.building.wwr.east,
            "west":  request.building.wwr.west,
        },
    }
    construction_choices = {
        "external_wall": request.constructions.external_wall,
        "roof":          request.constructions.roof,
        "ground_floor":  request.constructions.ground_floor,
        "glazing":       request.constructions.glazing,
    }
    systems_config = request.systems.model_dump()

    epjson_path = run_dir / "input.epJSON"
    assemble_epjson(
        building_params=building_params,
        construction_choices=construction_choices,
        weather_file_path=weather_path,
        output_path=epjson_path,
        systems_config=systems_config,
    )

    sim_result = run_simulation(
        epjson_path=epjson_path,
        weather_file_path=weather_path,
        output_dir=run_dir,
    )

    if not sim_result.success:
        error_detail = (
            f"EnergyPlus failed with {sim_result.fatal_errors} fatal error(s), "
            f"{sim_result.severe_errors} severe error(s). "
            f"Check run {run_id} .err file."
        )
        raise HTTPException(status_code=500, detail=error_detail)

    if not sim_result.sql_path or not sim_result.sql_path.exists():
        raise HTTPException(
            status_code=500,
            detail="Simulation succeeded but SQLite output not found.",
        )

    sql = sim_result.sql_path
    results = {
        "run_id":           run_id,
        "status":           "success",
        "runtime_s":        sim_result.runtime_seconds,
        "warnings":         sim_result.warnings,
        "building":         building_params,
        "constructions":    construction_choices,
        "systems":          systems_config,
        "weather_file":     str(weather_path),
        "summary":          get_building_summary(sql),
        "annual_energy":    get_annual_energy_by_enduse(sql),
        "monthly_energy":   get_monthly_energy_by_enduse(sql),
        "zone_summary":     get_zone_summary(sql),
        "envelope":          get_envelope_heat_flow(sql),
        "envelope_detailed": get_envelope_heat_flow_detailed(sql),
        # Typical day profiles included in main response (compact — 4 days × 24 hours)
        "hourly_profiles":  get_typical_day_profiles(sql),
        "fuel_split":        get_energy_by_fuel(sql),
    }

    # Cache results for later retrieval (without full 8760 — too large for JSON cache)
    results_path = run_dir / "results.json"
    with open(results_path, "w") as f:
        json.dump(results, f, indent=2)

    return results


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("")
async def start_simulation(request: SimulateRequest):
    """
    Run an EnergyPlus simulation from parametric inputs.

    Assembles epJSON, runs EnergyPlus, parses results, returns full summary.
    Stores the run artifacts in data/simulations/{run_id}/.

    The simulation runs synchronously (blocking) — this is appropriate for
    short simulations (<30s). Future briefs will add async/queuing.
    """
    run_id = str(uuid.uuid4())[:8]
    return _run_and_parse(run_id, request)


@router.get("/{run_id}")
async def get_simulation_result(run_id: str):
    """
    Return the parsed results for a previous simulation run.
    """
    results_path = SIMULATIONS_DIR / run_id / "results.json"
    if not results_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Run '{run_id}' not found. Run a simulation first.",
        )
    with open(results_path) as f:
        return json.load(f)


@router.get("/{run_id}/hourly")
async def get_hourly_data(run_id: str):
    """
    Return the full 8760-hour dataset for a previous simulation run.
    Used for detailed analysis, heatmaps, and carpet plots.
    """
    sql_path = SIMULATIONS_DIR / run_id / "eplusout.sql"
    if not sql_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Run '{run_id}' not found or SQL output missing.",
        )
    return get_hourly_profiles(sql_path)
