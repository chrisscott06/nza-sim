#!/usr/bin/env python3
"""Brief 98-A P0 — prove EnergyPlus now reads NZA-Sim's envelope-derived operational
ACH (q50 → n50/20) instead of the flat 0.5 default. Assembles + runs the main EP on
report_baseline_v1 (systems via the 98-pre-b derive so it doesn't fatal), reads the
emitted ZoneInfiltration:DesignFlowRate air_changes_per_hour, and states it against
NZA-Sim's deriveOperationalACH value. Run: python3 scripts/_brief98A_p0.py
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

fx = yaml.safe_load((REPO / "validation/fixtures/report_baseline_v1.yaml").read_text())
bc = fx["building_config"]; cc = fx["construction_choices"]
weather = REPO / "data/weather/current" / fx["weather_file"]

op_ach, meta = derive_operational_ach(bc)
print("derive_operational_ach:", json.dumps(meta))
print(f"  -> operational ACH = {op_ach:.4f}  (was flat default {0.5})")

simple, v25 = derive_systems_for_sim(bc, fallback_simple=fx.get("systems_config"))
bc_sim = {**bc, "systems_config_v25": v25}
out = SIMULATIONS_DIR / "brief98A_p0"; out.mkdir(parents=True, exist_ok=True)
ep_path = out / "input.epJSON"
assemble_epjson(building_params=bc_sim, construction_choices=cc, weather_file_path=weather,
                output_path=ep_path, systems_config=simple, schedule_overrides=None, mode="full")
ep = json.loads(ep_path.read_text())

infil = ep.get("ZoneInfiltration:DesignFlowRate", {})
achs = {k: v.get("air_changes_per_hour") for k, v in infil.items()}
uniq = sorted(set(achs.values()))
print(f"emitted ZoneInfiltration air_changes_per_hour: {uniq}  ({len(infil)} zones)")
assert all(abs((a or 0) - op_ach) < 1e-9 for a in achs.values()), "emitted ACH != derived"
assert all(abs((a or 0) - 0.5) > 1e-6 for a in achs.values()), "still flat 0.5!"
print("  [assert] EP infiltration = derived operational ACH, NOT 0.5  OK")

res = run_simulation(epjson_path=ep_path, weather_file_path=weather, output_dir=out)
print(f"\nEnergyPlus {ENERGYPLUS_DIR}: success={res.success} fatal={res.fatal_errors} "
      f"severe={res.severe_errors} runtime={res.runtime_seconds:.1f}s")
assert res.success and res.fatal_errors == 0, "EP fatalled"
print("\nP0 PROVEN: EP reads NZA-Sim's envelope-derived operational ACH; 0 fatal.")
