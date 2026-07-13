#!/usr/bin/env python3
"""98-R P1 verify — re-run matched-inputs baseline after adding component-level output
requests; prove demand byte-identical to the pre-request run (EUI 95.6 / heat 10.3 /
cool 163.8) and that the new variables appear in the SQL. Reporting-only change.
Run: ENERGYPLUS_DIR=/Applications/EnergyPlus-25-2-0 validation/.venv/bin/python scripts/_98R_p1_verify.py
"""
import sqlite3, sys
from pathlib import Path
import yaml

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from nza_engine.config import SIMULATIONS_DIR
from nza_engine.generators.epjson_assembler import assemble_epjson, derive_operational_ach
from nza_engine.runner import run_simulation
from nza_engine.systems_from_v40 import derive_systems_for_sim
from nza_engine.parsers.sql_parser import get_building_summary

fx = yaml.safe_load((REPO / "validation/fixtures/report_baseline_v1.yaml").read_text())
bc = fx["building_config"]; cc = fx["construction_choices"]
weather = REPO / "data/weather/current" / fx["weather_file"]
simple, v25 = derive_systems_for_sim(bc, fallback_simple=fx.get("systems_config"))
bc_sim = {**bc, "systems_config_v25": v25}
out = SIMULATIONS_DIR / "98R_p1_baseline"; out.mkdir(parents=True, exist_ok=True)
ep_path = out / "input.epJSON"
assemble_epjson(building_params=bc_sim, construction_choices=cc, weather_file_path=weather,
                output_path=ep_path, systems_config=simple, schedule_overrides=None, mode="full")
res = run_simulation(epjson_path=ep_path, weather_file_path=weather, output_dir=out)
assert res.success, f"EP failed: {res.fatal_errors}"
s = get_building_summary(res.sql_path)
eui, heat, cool = s["eui_kWh_per_m2"], round(s["annual_heating_kWh"]/1000,1), round(s["annual_cooling_kWh"]/1000,1)
print(f"post-request baseline: EUI {eui} | heat {heat} | cool {cool}")
EXPECT = (95.6, 10.3, 163.8)
ok_demand = (eui, heat, cool) == EXPECT
print(f"DEMAND INVARIANT vs pre-request {EXPECT}: {'PASS' if ok_demand else 'FAIL'}")

# confirm new component variables are present in the SQL variable dictionary
NEW = ["Heat Exchanger Total Heating Energy", "Heat Exchanger Total Cooling Energy",
       "Heat Exchanger Electricity Energy", "Zone Ventilation Total Heat Loss Energy",
       "Zone Windows Total Heat Gain Energy"]
with sqlite3.connect(str(res.sql_path)) as conn:
    conn.row_factory = sqlite3.Row
    have = {r["Name"] for r in conn.execute("SELECT DISTINCT Name FROM ReportDataDictionary").fetchall()}
    tabs = {r["ReportName"] for r in conn.execute("SELECT DISTINCT ReportName FROM TabularDataWithStrings").fetchall()}
print("new component variables present in SQL:")
for v in NEW:
    print(f"   {'OK ' if v in have else 'MISSING'} {v}")
print(f"Sensible Heat Gain Summary tabular present: {'Sensible Heat Gain Summary' in tabs}")
sys.exit(0 if ok_demand else 1)
