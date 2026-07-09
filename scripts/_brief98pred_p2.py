#!/usr/bin/env python3
"""Brief 98-pre-d P2 — per-field unit tests for C1/C2 + EP-run proof.

C1: lighting_control derives from v40 control_mechanism.
C2: ASHP DHW COP derives from v40 heat-pump DHW efficiency_metric.
Proof: emitted epJSON Lights watts/area reflects factor 1.0 (not 0.80); the
DHW_ASHP_Preheat tank efficiency = 3.0 (not 2.8); EP runs 0 fatal.

Run: python3 scripts/_brief98pred_p2.py
"""
import json
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from nza_engine.systems_from_v40 import derive_systems_for_sim  # noqa: E402

# ── Unit tests: each mapping reaches the derived config ───────────────────────
def _bc(lighting_cm=None, dhw_hp_cop=None):
    """Minimal building_config with a v40 lighting + DHW to exercise the maps."""
    v40 = {
        "heating": [{"source": "ambient_air", "efficiency_metric": 3, "share_pct": 100, "enabled": True}],
        "cooling": [{"source": "electricity", "efficiency_metric": 3, "share_pct": 100, "enabled": True}],
        "dhw": [{"source": "gas", "efficiency_metric": 0.85, "share_pct": 52, "enabled": True}],
    }
    if lighting_cm is not None:
        v40["lighting"] = [{"source": "electricity", "control_mechanism": lighting_cm,
                            "share_pct": 100, "enabled": True}]
    if dhw_hp_cop is not None:
        v40["dhw"].append({"source": "ambient_air", "efficiency_metric": dhw_hp_cop,
                           "share_pct": 48, "enabled": True})
    return {"systems_config_v40": v40}


EP_FACTOR = {"manual": 1.20, "occupancy_sensing": 0.80, "daylight_dimming": 0.60}
print("=== C1 unit tests: v40 control_mechanism -> lighting_control -> EP factor ===")
cases = [("constant", 1.0), ("daylight_dimming", 0.60), ("occupancy_sensing", 0.80),
         ("occupancy", 0.80), ("manual", 1.20), ("weird_unknown", 1.0)]
for cm, want_factor in cases:
    d, _ = derive_systems_for_sim(_bc(lighting_cm=cm), fallback_simple={"lighting_control": "occupancy_sensing"})
    lc = d.get("lighting_control")
    got = EP_FACTOR.get(lc, 1.0)
    assert abs(got - want_factor) < 1e-9, f"{cm}: lighting_control={lc!r} factor {got} != {want_factor}"
    print(f"  {cm:16} -> lighting_control={lc!r:20} EP factor={got}  OK")

print("\n=== C2 unit tests: v40 heat-pump DHW efficiency_metric -> ASHP COP ===")
for cop in (3.0, 2.5, 4.1):
    d, _ = derive_systems_for_sim(_bc(dhw_hp_cop=cop), fallback_simple={})
    sec = (d.get("systems") or {}).get("dhw", {}).get("secondary", {})
    assert sec.get("efficiency_override") == cop, f"COP {cop}: got {sec}"
    print(f"  v40 metric {cop} -> secondary.efficiency_override={sec.get('efficiency_override')}  OK")
# No heat-pump DHW -> no ASHP secondary (symmetry)
d, _ = derive_systems_for_sim(_bc(), fallback_simple={})
assert "secondary" not in (d.get("systems") or {}).get("dhw", {}), "gas-only DHW should have no ASHP secondary"
print("  gas-only DHW -> no ASHP secondary  OK")

# ── EP-run proof on report_baseline_v1 ───────────────────────────────────────
print("\n=== EP proof: derive + assemble report_baseline_v1, inspect emitted objects ===")
from nza_engine.config import SIMULATIONS_DIR  # noqa: E402
from nza_engine.generators.epjson_assembler import assemble_epjson  # noqa: E402
from nza_engine.runner import run_simulation  # noqa: E402

fx = yaml.safe_load((REPO / "validation/fixtures/report_baseline_v1.yaml").read_text())
bc = fx["building_config"]; cc = fx["construction_choices"]
weather = REPO / "data/weather/current" / fx["weather_file"]
stored_simple = fx.get("systems_config") or {}
lpd = stored_simple.get("lighting_power_density")
v40_light_cm = ((bc.get("systems_config_v40") or {}).get("lighting") or [{}])[0].get("control_mechanism")
print(f"fixture LPD={lpd} · v40 lighting control_mechanism={v40_light_cm!r} · stale simple lighting_control={stored_simple.get('lighting_control')!r}")

simple, v25 = derive_systems_for_sim(bc, fallback_simple=stored_simple)
print(f"derived lighting_control={simple.get('lighting_control')!r} · dhw.secondary={json.dumps((simple.get('systems') or {}).get('dhw',{}).get('secondary'))}")

bc_sim = {**bc, "systems_config_v25": v25}
out = SIMULATIONS_DIR / "brief98pred_p2"; out.mkdir(parents=True, exist_ok=True)
ep_path = out / "input.epJSON"
assemble_epjson(building_params=bc_sim, construction_choices=cc, weather_file_path=weather,
                output_path=ep_path, systems_config=simple, schedule_overrides=None, mode="full")
ep = json.loads(ep_path.read_text())

# Lights: watts/area should be LPD x 1.0 (constant), not LPD x 0.80
lights = ep.get("Lights", {})
wpa = [v.get("watts_per_floor_area") for v in lights.values() if v.get("watts_per_floor_area") is not None]
maxwpa = max(wpa) if wpa else None
print(f"emitted Lights watts_per_zone_floor_area (max) = {maxwpa}  (expect ~LPD*1.0={lpd}; 0.80 would give {round((lpd or 0)*0.8,3)})")
assert maxwpa is not None and abs(maxwpa - lpd) < 1e-6, f"lighting factor not 1.0: watts/area {maxwpa} vs LPD {lpd}"
print("  [assert] emitted lighting reflects factor 1.0 (v40 constant), not stale 0.80  OK")

# ASHP DHW tank efficiency = COP 3.0
tanks = ep.get("WaterHeater:Mixed", {})
ashp = {k: v for k, v in tanks.items() if "ashp" in k.lower() or (v.get("heater_fuel_type") == "Electricity")}
print(f"emitted electric DHW tank(s): {[(k, v.get('heater_thermal_efficiency')) for k,v in ashp.items()]}")
assert any(abs((v.get("heater_thermal_efficiency") or 0) - 3.0) < 1e-6 for v in ashp.values()), "ASHP tank COP not 3.0"
print("  [assert] ASHP DHW tank heater_thermal_efficiency = 3.0 (v40), not 2.8  OK")

res = run_simulation(epjson_path=ep_path, weather_file_path=weather, output_dir=out)
print(f"\nEnergyPlus: success={res.success} fatal={res.fatal_errors} severe={res.severe_errors} runtime={res.runtime_seconds:.1f}s")
assert res.success and res.fatal_errors == 0, "EP fatalled"
print("\nALL P2 CHECKS PASS.")
