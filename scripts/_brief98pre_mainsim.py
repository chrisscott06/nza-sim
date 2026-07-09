#!/usr/bin/env python3
"""Brief 98-pre P3 — run the MAIN /api/simulate EnergyPlus (nza_engine) engine-direct
on report_baseline_v1 and confirm it now runs clean (0 fatal) after the gas-heating
generator fix + the VRF config correction. Records the EP baseline breakdown that
Brief 98 P0's residual table was blocked on.

Mirrors api/routers/projects.py:simulate_project but reads the frozen fixture.
The fixture now carries a corrected simple `systems_config` (VRF heating/cooling,
Brief 98-pre Job 2). Run: python3 scripts/_brief98pre_mainsim.py
"""
import json
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from nza_engine.config import ENERGYPLUS_DIR, SIMULATIONS_DIR  # noqa: E402
from nza_engine.generators.epjson_assembler import assemble_epjson  # noqa: E402
from nza_engine.runner import run_simulation  # noqa: E402
from nza_engine.parsers.sql_parser import (  # noqa: E402
    get_building_summary, get_annual_energy_by_enduse, get_monthly_energy_by_enduse,
    get_envelope_heat_flow, get_energy_by_fuel,
)

FIX = REPO / "validation/fixtures/report_baseline_v1.yaml"
OUT = REPO / "docs/audit/98pre_mainsim_baseline.json"

print(f"EnergyPlus dir: {ENERGYPLUS_DIR}")
fx = yaml.safe_load(FIX.read_text())
bc = fx["building_config"]
cc = fx["construction_choices"]
weather = REPO / "data/weather/current" / fx["weather_file"]
systems_config = fx.get("systems_config") or {}
print(f"heating: {systems_config.get('space_heating', {}).get('primary', {}).get('system')} · "
      f"cooling: {systems_config.get('space_cooling', {}).get('primary', {}).get('system')}")

run_dir = SIMULATIONS_DIR / "brief98pre_mainsim_baseline"
run_dir.mkdir(parents=True, exist_ok=True)
epjson_path = run_dir / "input.epJSON"

assemble_epjson(
    building_params=bc, construction_choices=cc, weather_file_path=weather,
    output_path=epjson_path, systems_config=systems_config, schedule_overrides=None, mode="full",
)
res = run_simulation(epjson_path=epjson_path, weather_file_path=weather, output_dir=run_dir)
print(f"run: success={res.success} fatal={res.fatal_errors} severe={res.severe_errors} runtime={res.runtime_seconds:.1f}s")
if not res.success:
    sys.exit(1)

sql = res.sql_path
out = {
    "ep_version": str(ENERGYPLUS_DIR), "fatal": res.fatal_errors, "severe": res.severe_errors,
    "summary": get_building_summary(sql),
    "annual_by_enduse": get_annual_energy_by_enduse(sql),
    "monthly_by_enduse": get_monthly_energy_by_enduse(sql),
    "fuel_split": get_energy_by_fuel(sql),
    "envelope": get_envelope_heat_flow(sql),
}
OUT.write_text(json.dumps(out, indent=2, default=str))
print("summary:", json.dumps(out["summary"], default=str))
print("fuel_split:", json.dumps(out["fuel_split"], default=str)[:400])
print(f"wrote {OUT}")
