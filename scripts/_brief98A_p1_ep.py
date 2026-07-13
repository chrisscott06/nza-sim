#!/usr/bin/env python3
"""Brief 98-A P1 — run the main EnergyPlus (post-P0 infiltration fix) on
report_baseline_v1 and dump the full result set for the two-claim comparison.
Systems via the 98-pre-b derive. Output: docs/audit/98A_ep_results.json.
"""
import json
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from nza_engine.config import ENERGYPLUS_DIR, SIMULATIONS_DIR  # noqa: E402
from nza_engine.generators.epjson_assembler import assemble_epjson, derive_operational_ach  # noqa: E402
from nza_engine.runner import run_simulation  # noqa: E402
from nza_engine.systems_from_v40 import derive_systems_for_sim  # noqa: E402
from nza_engine.parsers.sql_parser import (  # noqa: E402
    get_building_summary, get_annual_energy_by_enduse, get_monthly_energy_by_enduse,
    get_energy_by_fuel, get_envelope_heat_flow,
)

fx = yaml.safe_load((REPO / "validation/fixtures/report_baseline_v1.yaml").read_text())
bc = fx["building_config"]; cc = fx["construction_choices"]
weather = REPO / "data/weather/current" / fx["weather_file"]
op_ach, ach_meta = derive_operational_ach(bc)

simple, v25 = derive_systems_for_sim(bc, fallback_simple=fx.get("systems_config"))
bc_sim = {**bc, "systems_config_v25": v25}
out = SIMULATIONS_DIR / "brief98A_p1"; out.mkdir(parents=True, exist_ok=True)
ep_path = out / "input.epJSON"
assemble_epjson(building_params=bc_sim, construction_choices=cc, weather_file_path=weather,
                output_path=ep_path, systems_config=simple, schedule_overrides=None, mode="full")
res = run_simulation(epjson_path=ep_path, weather_file_path=weather, output_dir=out)
print(f"EP {ENERGYPLUS_DIR}: success={res.success} fatal={res.fatal_errors} severe={res.severe_errors}")
if not res.success:
    sys.exit(1)
sql = res.sql_path
result = {
    "ep_version": str(ENERGYPLUS_DIR), "operational_ach": op_ach, "ach_meta": ach_meta,
    "fatal": res.fatal_errors, "severe": res.severe_errors,
    "summary": get_building_summary(sql),
    "annual_by_enduse": get_annual_energy_by_enduse(sql),
    "monthly_by_enduse": get_monthly_energy_by_enduse(sql),
    "fuel_split": get_energy_by_fuel(sql),
    "envelope": get_envelope_heat_flow(sql),
}
OUT = REPO / "docs/audit/98A_ep_results.json"
OUT.write_text(json.dumps(result, indent=2, default=str))
s = result["summary"]
print(f"EUI {s.get('eui_kWh_per_m2')} · heating {s.get('annual_heating_kWh',0)/1000:.1f} MWh · "
      f"cooling {s.get('annual_cooling_kWh',0)/1000:.1f} MWh · op_ach {op_ach:.4f}")
print(f"wrote {OUT}")
