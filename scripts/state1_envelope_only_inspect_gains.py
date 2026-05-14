"""
Quick inspection: in envelope-only mode the assembler emits People /
Lights / ElectricEquipment objects. What magnitudes / schedules do they
carry? Zero-magnitude placeholders are harmless; non-zero values would
make envelope-only no longer free-running.
"""
import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from nza_engine.generators.epjson_assembler import assemble_epjson

PROJECT_ID = "14b4a5b1-8c73-4acb-8b65-1d22f05ec969"

con = sqlite3.connect(REPO_ROOT / "data/nza_sim.db")
con.row_factory = sqlite3.Row
row = con.execute(
    "SELECT building_config, construction_choices, systems_config, weather_file FROM projects WHERE id = ?",
    (PROJECT_ID,)).fetchone()
con.close()
building       = json.loads(row["building_config"])
constructions  = json.loads(row["construction_choices"]) if row["construction_choices"] else {}
systems        = json.loads(row["systems_config"]) if row["systems_config"] else {}
weather_file   = row["weather_file"] or building.get("weather_file")
epw_path = next(p for p in [REPO_ROOT / "data/weather/current" / weather_file,
                            REPO_ROOT / "data/weather" / weather_file] if p.exists())

ep = assemble_epjson(
    building_params=building,
    construction_choices=constructions,
    weather_file_path=epw_path,
    output_path=None,
    systems_config=systems,
    mode="envelope-only",
)

print()
print("PEOPLE OBJECTS:")
for name, obj in ep.get("People", {}).items():
    print(f"  {name}")
    for k, v in obj.items():
        print(f"      {k}: {v}")

print()
print("LIGHTS OBJECTS:")
for name, obj in ep.get("Lights", {}).items():
    print(f"  {name}")
    for k, v in obj.items():
        print(f"      {k}: {v}")

print()
print("ELECTRICEQUIPMENT OBJECTS:")
for name, obj in ep.get("ElectricEquipment", {}).items():
    print(f"  {name}")
    for k, v in obj.items():
        print(f"      {k}: {v}")

# Also report what schedules they reference and look up the schedule values
print()
print("REFERENCED SCHEDULES (peek at hourly_value if Schedule:Constant):")
for sect in ("People", "Lights", "ElectricEquipment"):
    for name, obj in ep.get(sect, {}).items():
        sched_keys = [k for k in obj.keys() if "schedule_name" in k]
        for sk in sched_keys:
            sched_name = obj[sk]
            const = ep.get("Schedule:Constant", {}).get(sched_name)
            compact = ep.get("Schedule:Compact", {}).get(sched_name)
            if const:
                print(f"  {sect}/{name} -> {sk} -> Schedule:Constant {sched_name!r} = {const.get('hourly_value')}")
            elif compact:
                # Schedule:Compact has a complex structure; just show the name
                print(f"  {sect}/{name} -> {sk} -> Schedule:Compact {sched_name!r} (complex)")
            else:
                print(f"  {sect}/{name} -> {sk} -> {sched_name!r} (not found in Schedule:Constant or :Compact)")
        break  # just show the first object per section; they're all the same shape
