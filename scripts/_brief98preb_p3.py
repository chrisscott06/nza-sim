#!/usr/bin/env python3
"""Brief 98-pre-b P3 — prove single-source on the baseline AND an edited project.

Run 1 (baseline): report_baseline_v1 with the simple systems_config POISONED to gas.
  derive_systems_for_sim (the /api/simulate path) must ignore the poison, drive VRF,
  and EnergyPlus must run 0 fatal.
Run 2 (edited v40): mutate systems_config_v40 heating -> gas + disable cooling, with
  NO manual sync of any simple copy. The emitted epJSON must flip to a gas fuel coil
  with no VRF — proving a v40 edit propagates to the sim on its own.

Run: python3 scripts/_brief98preb_p3.py
"""
import copy
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
    get_building_summary, get_energy_by_fuel,
)
from nza_engine.systems_from_v40 import derive_systems_for_sim  # noqa: E402

FIX = REPO / "validation/fixtures/report_baseline_v1.yaml"
OUT = REPO / "docs/audit/98preb_proof.json"
fx = yaml.safe_load(FIX.read_text())
bc = fx["building_config"]
cc = fx["construction_choices"]
weather = REPO / "data/weather/current" / fx["weather_file"]

POISON = {"mode": "detailed", "systems": {
    "space_heating": {"primary": {"system": "gas_boiler_heating", "efficiency_override": 0.9}},
    "space_cooling": {"primary": {"system": "none_cooling"}},
}}


def _emit(building_config, fallback, tag):
    simple, v25 = derive_systems_for_sim(building_config, fallback_simple=fallback)
    bc_sim = {**building_config, "systems_config_v25": v25} if v25 is not None else dict(building_config)
    out_dir = SIMULATIONS_DIR / f"brief98preb_p3_{tag}"
    out_dir.mkdir(parents=True, exist_ok=True)
    ep_path = out_dir / "input.epJSON"
    assemble_epjson(building_params=bc_sim, construction_choices=cc, weather_file_path=weather,
                    output_path=ep_path, systems_config=simple, schedule_overrides=None, mode="full")
    ep = json.loads(ep_path.read_text())
    objs = {
        "vrf_heating_coils": len(ep.get("Coil:Heating:DX:VariableRefrigerantFlow", {})),
        "vrf_cooling_coils": len(ep.get("Coil:Cooling:DX:VariableRefrigerantFlow", {})),
        "gas_fuel_coils": len(ep.get("Coil:Heating:Fuel", {})),
    }
    return simple, v25, objs, out_dir, ep_path


report = {"ep_version": str(ENERGYPLUS_DIR)}

# ── Override proof: poisoned simple → derive still drives VRF (object-level) ──
print("=== Override proof: v40 = VRF, simple copy POISONED to gas heating + no cooling ===")
simpleP, _, objsP, _, _ = _emit(bc, POISON, "override")
print("derived heating:", simpleP["systems"]["space_heating"]["primary"]["system"],
      "· cooling:", simpleP["systems"]["space_cooling"]["primary"]["system"], "· objects:", objsP)
assert objsP["vrf_heating_coils"] > 0 and objsP["gas_fuel_coils"] == 0, "stale gas leaked!"
print("[assert] system types overridden from v40 (stale gas/none ignored) ✓\n")

# ── Run 1: baseline via the PRODUCTION fallback (real simple config), full EP ─
# simulate_project passes project["systems_config"] as the fallback, so non-system
# fields (LPD/EPD/dhw setpoints/natural vent) are preserved; only system types,
# efficiencies and enabled gates are overridden from v40.
print("=== Run 1: report_baseline_v1 via production fallback (real simple config) ===")
prod_fallback = fx.get("systems_config") or {}
simple1, v25_1, objs1, out_dir1, ep1 = _emit(bc, prod_fallback, "baseline")
print("derived heating:", simple1["systems"]["space_heating"]["primary"]["system"],
      "· cooling:", simple1["systems"]["space_cooling"]["primary"]["system"],
      "· vent:", simple1["systems"]["ventilation"]["primary"]["system"])
print("preserved LPD:", simple1.get("lighting_power_density"),
      "· EPD:", simple1.get("equipment_power_density"))
print("emitted objects:", objs1)
assert objs1["vrf_heating_coils"] > 0 and objs1["gas_fuel_coils"] == 0, "stale gas leaked!"
assert simple1.get("lighting_power_density") == prod_fallback.get("lighting_power_density"), \
    "LPD not preserved — internal-gains field dropped!"
assert simple1.get("equipment_power_density") == prod_fallback.get("equipment_power_density"), \
    "EPD not preserved — internal-gains field dropped!"

res = run_simulation(epjson_path=ep1, weather_file_path=weather, output_dir=out_dir1)
print(f"EnergyPlus: success={res.success} fatal={res.fatal_errors} severe={res.severe_errors} "
      f"runtime={res.runtime_seconds:.1f}s")
assert res.success and res.fatal_errors == 0, f"baseline fatalled: {res.fatal_errors} fatal"
summary = get_building_summary(res.sql_path)
fuel = get_energy_by_fuel(res.sql_path)
print("summary:", json.dumps(summary, default=str))
report["run1_baseline"] = {"systems": simple1["systems"], "v25": v25_1, "objects": objs1,
                           "fatal": res.fatal_errors, "severe": res.severe_errors,
                           "summary": summary, "fuel_split": fuel}
print("[assert] baseline: derive drove VRF, 0 fatal ✓\n")

# ── Run 2: EDIT v40 (heating -> gas, cooling disabled), NO manual sync ────────
print("=== Run 2: edit systems_config_v40 (heating -> gas, cooling disabled) ===")
bc_edit = copy.deepcopy(bc)
v40e = bc_edit["systems_config_v40"]
v40e["heating"][0]["source"] = "natural_gas"
v40e["heating"][0]["efficiency_metric"] = 0.9
for csys in v40e.get("cooling", []):
    csys["enabled"] = False
# fallback simple stays the OLD VRF-ish poison inverse — proves it's ignored either way
simple2, v25_2, objs2, out_dir2, ep2 = _emit(bc_edit, POISON, "edited")
print("derived heating:", simple2["systems"]["space_heating"]["primary"]["system"],
      "· cooling enabled(v25):", v25_2["cooling"]["enabled"])
print("emitted objects:", objs2)
assert objs2["gas_fuel_coils"] > 0, "v40 heating->gas edit did NOT propagate (no gas coil)!"
assert objs2["vrf_heating_coils"] == 0, "v40 still emitting VRF heating after gas edit!"
assert v25_2["cooling"]["enabled"] is False, "cooling-disable edit did not propagate to v25 gate!"
report["run2_edited"] = {"systems": simple2["systems"], "v25": v25_2, "objects": objs2}
print("[assert] edited v40 (gas + cooling off) propagated to the sim, no manual sync ✓\n")

OUT.write_text(json.dumps(report, indent=2, default=str))
print(f"wrote {OUT}")
print("PROVEN: /api/simulate tracks systems_config_v40 — baseline clean, edits propagate.")
