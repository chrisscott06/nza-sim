#!/usr/bin/env python3
"""Brief 98 P0.1 — run the MAIN /api/simulate EnergyPlus (nza_engine) engine-direct
on the report_baseline_v1 fixture, so it can be diffed against NZA-Sim on the SAME
building. Mirrors api/routers/projects.py:simulate_project but reads the frozen
fixture instead of a live project (engine-direct, per the report-baseline discipline).

Bridges documented in the audit doc:
  - systems_config: the fixture carries building_config.systems_config_v40 (rich,
    NZA-Sim) but NOT the simple `systems_config` the main sim reads. Bridged from the
    live source project 12cf7cc4 (report_baseline_v1 derives from it; systems unchanged
    by the aux/intervention removals).
  - constructions: fixture construction_choices reference project-library names
    (bridgwater_*). Resolved exactly as the app does (assemble_epjson).

Run: python3 scripts/_brief98_mainsim.py
"""
import json
import sys
import urllib.request
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from nza_engine.config import ENERGYPLUS_DIR, SIMULATIONS_DIR  # noqa: E402
from nza_engine.generators.epjson_assembler import assemble_epjson  # noqa: E402
from nza_engine.runner import run_simulation  # noqa: E402
from nza_engine.parsers.sql_parser import (  # noqa: E402
    get_building_summary, get_annual_energy_by_enduse, get_monthly_energy_by_enduse,
    get_envelope_heat_flow, get_envelope_heat_flow_detailed, get_energy_by_fuel,
    get_zone_summary,
)

PROJECT_ID = "12cf7cc4-9bdc-41bc-ab4e-24e044fbad9d"
FIX = REPO / "validation/fixtures/report_baseline_v1.yaml"
OUT = Path("/private/tmp/claude-501/-Users-chrisscott-Dev-nza-sim/5b39e149-4d99-424d-b9ea-1f0f19690bf4/scratchpad/mainsim_report_baseline.json")

print(f"EnergyPlus dir: {ENERGYPLUS_DIR}")

fx = yaml.safe_load(FIX.read_text())
bc = fx["building_config"]
cc = fx["construction_choices"]
weather = REPO / "data/weather/current" / fx["weather_file"]
assert weather.exists(), f"weather not found: {weather}"

# Bridge: simple systems_config from the live source project (fixture lacks it).
proj = json.load(urllib.request.urlopen(f"http://127.0.0.1:8002/api/projects/{PROJECT_ID}"))
systems_config = proj.get("systems_config") or {}
print(f"systems_config bridged from project (keys): {sorted(systems_config.keys())}")
print(f"construction_choices: {cc}")

run_dir = SIMULATIONS_DIR / "brief98_mainsim_report_baseline"
run_dir.mkdir(parents=True, exist_ok=True)
epjson_path = run_dir / "input.epJSON"

assemble_epjson(
    building_params=bc,
    construction_choices=cc,
    weather_file_path=weather,
    output_path=epjson_path,
    systems_config=systems_config,
    schedule_overrides=None,
    mode="full",
)
print("epJSON assembled")

res = run_simulation(epjson_path=epjson_path, weather_file_path=weather, output_dir=run_dir)
print(f"run success={res.success} fatal={res.fatal_errors} severe={res.severe_errors} runtime={res.runtime_seconds:.1f}s")
if not res.success:
    print("FATAL — see .err")
    sys.exit(1)

sql = res.sql_path
out = {
    "ep_version": str(ENERGYPLUS_DIR),
    "fatal": res.fatal_errors, "severe": res.severe_errors,
    "summary":          get_building_summary(sql),
    "annual_by_enduse": get_annual_energy_by_enduse(sql),
    "monthly_by_enduse": get_monthly_energy_by_enduse(sql),
    "fuel_split":       get_energy_by_fuel(sql),
    "envelope":         get_envelope_heat_flow(sql),
    "envelope_detailed": get_envelope_heat_flow_detailed(sql),
    "zone_summary":     get_zone_summary(sql),
}
OUT.write_text(json.dumps(out, indent=2, default=str))
print(f"\n=== MAIN-EP on report_baseline_v1 ===")
print("summary:", json.dumps(out["summary"], default=str)[:400])
print("annual_by_enduse:", json.dumps(out["annual_by_enduse"], default=str)[:400])
print("fuel_split:", json.dumps(out["fuel_split"], default=str)[:300])
print(f"\nwrote {OUT}")
