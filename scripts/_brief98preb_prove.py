#!/usr/bin/env python3
"""Brief 98-pre-b P2 — falsifiable proof of single-source-of-truth.

v40 on report_baseline_v1 = VRF heating + VRF cooling. We deliberately POISON the
simple systems_config to gas heating + no cooling (the exact 98-pre stale state),
then confirm derive_systems_for_sim (the /api/simulate read path) ignores the stale
copy and the assembled epJSON emits VRF objects, NOT a gas fuel coil.

Run: python3 scripts/_brief98preb_prove.py
"""
import json
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from nza_engine.config import SIMULATIONS_DIR  # noqa: E402
from nza_engine.generators.epjson_assembler import assemble_epjson  # noqa: E402
from nza_engine.systems_from_v40 import derive_systems_for_sim  # noqa: E402

FIX = REPO / "validation/fixtures/report_baseline_v1.yaml"
fx = yaml.safe_load(FIX.read_text())
bc = fx["building_config"]
cc = fx["construction_choices"]
weather = REPO / "data/weather/current" / fx["weather_file"]

# DELIBERATELY-STALE simple config: gas heating, no cooling (what would silently
# drive a gas-heated EP baseline if /api/simulate read it).
POISON = {
    "mode": "detailed",
    "systems": {
        "space_heating": {"primary": {"system": "gas_boiler_heating", "efficiency_override": 0.9}},
        "space_cooling": {"primary": {"system": "none_cooling"}},
    },
}

v40 = bc.get("systems_config_v40") or {}
print("v40 heating[0]:", (v40.get("heating") or [{}])[0].get("source"),
      "· cooling[0]:", (v40.get("cooling") or [{}])[0].get("source"))

simple, v25 = derive_systems_for_sim(bc, fallback_simple=POISON)
print("\nderived simple.systems:")
print(json.dumps(simple["systems"], indent=2))
print("derived v25 gates:", json.dumps(v25))

sh = simple["systems"]["space_heating"]["primary"]["system"]
sc = simple["systems"]["space_cooling"]["primary"]["system"]
assert sh == "vrf_standard", f"heating derived {sh!r}, expected vrf_standard (stale gas leaked!)"
assert sc == "vrf_standard", f"cooling derived {sc!r}, expected vrf_standard (stale none leaked!)"
assert v25["cooling"]["enabled"] is True, "cooling gate should be enabled from v40"
print("\n[assert] derive ignored the stale gas/none copy → VRF heating + VRF cooling ✓")

# Assemble epJSON exactly as simulate_project now does (derived v25 injected).
bc_sim = {**bc, "systems_config_v25": v25}
out_dir = SIMULATIONS_DIR / "brief98preb_prove"
out_dir.mkdir(parents=True, exist_ok=True)
epjson_path = out_dir / "input.epJSON"
assemble_epjson(
    building_params=bc_sim, construction_choices=cc, weather_file_path=weather,
    output_path=epjson_path, systems_config=simple, schedule_overrides=None, mode="full",
)
ep = json.loads(epjson_path.read_text())

vrf_heat = len(ep.get("Coil:Heating:DX:VariableRefrigerantFlow", {}))
vrf_cool = len(ep.get("Coil:Cooling:DX:VariableRefrigerantFlow", {}))
gas_coil = len(ep.get("Coil:Heating:Fuel", {}))
print(f"\nemitted epJSON: VRF heating coils={vrf_heat} · VRF cooling coils={vrf_cool} · gas fuel coils={gas_coil}")
assert vrf_heat > 0, "no VRF heating coils emitted — stale gas config leaked into the sim!"
assert vrf_cool > 0, "no VRF cooling coils emitted — stale none-cooling leaked into the sim!"
assert gas_coil == 0, f"{gas_coil} gas fuel coil(s) emitted — the stale gas config drove the sim!"
print("[assert] emitted epJSON is VRF, no gas fuel coil → /api/simulate tracks v40 ✓")
print("\nPROVEN: /api/simulate reads the single source of truth (systems_config_v40).")
