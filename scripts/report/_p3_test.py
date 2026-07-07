#!/usr/bin/env python3
"""Brief 96 P3 — unit tests for Class B scalars + Class C calculators.

Structural/invariant tests (no engine run — engine EFFECTS are validated in P5):
  - WWHR (1.2) scalar reaches the DHW demand field at 0.82× baseline (55→45.1).
  - 1.3 touches ONLY the preheat stage (dhw[1]), never dhw[0].
  - interlink usable ≤ recoverable AND ≤ preheat demand every month.
  - PV EUI contribution == 0 (gross-demand rule).

Run: validation/.venv/bin/python scripts/report/_p3_test.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from interventions import by_ref  # noqa: E402
import offmodel as OM  # noqa: E402

_p = _f = 0
def ok(name, cond):
    global _p, _f
    if cond: _p += 1; print(f"  ✓ {name}")
    else: _f += 1; print(f"  ✗ FAIL: {name}")

print("── Class B: WWHR (1.2) reaches the DHW demand calc at 0.82× ──")
p12 = by_ref("1.2")["patches"]
ok("1.2 has exactly one patch on dhw_demand_litres_per_person_per_day",
   len(p12) == 1 and p12[0]["path"].endswith("dhw_demand_litres_per_person_per_day"))
ok("1.2 value == 55 × 0.82 (45.1)", abs(p12[0]["value"] - 55 * 0.82) < 0.05)

print("── Class B: 1.3 touches ONLY the preheat stage (dhw[1]) ──")
p13 = by_ref("1.3")["patches"]
ok("1.3 patches dhw[1] efficiency", any("dhw[1].efficiency_metric" in p["path"] for p in p13))
ok("1.3 never touches dhw[0]", not any("dhw[0]" in p["path"] for p in p13))
ok("1.3 preheat COP == 3.4 (+0.4 on 3.0)", p13[0]["value"] == 3.4)

print("── Class B: 3.1 sensitivity band + 3.2 anti-double-count ──")
ok("3.1 band = none/central/strong", set(OM.VRF_COMMISSIONING) == {"none", "central", "strong"})
ok("3.1 central = +0.4 (3.4)", OM.VRF_COMMISSIONING["central"] == 3.4)
ok("3.2 isolated eff = 3.75 (−20% vs 3.0)", abs(OM.VRF_REPLACEMENT_EFF["isolated"] - 3.0 / 0.8) < 1e-9)
ok("3.2 cumulative eff = 4.25 (−20% vs post-3.1 3.4)", abs(OM.VRF_REPLACEMENT_EFF["cumulative_after_3_1"] - 3.4 / 0.8) < 1e-9)

print("── Class C: interlink monthly invariants ──")
il = OM.interlink_1_5()
ok("every month usable ≤ recoverable", all(m["usable"] <= m["recoverable"] + 1e-6 for m in il["monthly"]))
ok("every month usable ≤ preheat demand", all(m["usable"] <= m["preheat_demand"] + 1e-6 for m in il["monthly"]))
ok("interlink elec saving > 0", il["annual_elec_kwh_saved"] > 0)

print("── Class C: refrigerant ≈ 4.7 tCO₂e/yr (note) ──")
ok("refrigerant annual ≈ 4.7", abs(OM.refrigerant_3_2()["annual_tco2e"] - 4.7) < 0.1)

print("── Class C: PV EUI contribution == 0 (gross-demand rule) ──")
pv = OM.pv_7_1()
ok("PV eui_delta == 0", pv["eui_delta_kwh_m2"] == 0.0)
ok("PV self-consumed = 47.5 × 0.85 = 40.4 MWh", abs(pv["annual_elec_kwh_saved"] - 40375) < 5)

print(f"\n{'─'*48}\n{'✅ ALL PASS' if _f == 0 else '❌ FAILURES'}: {_p} passed, {_f} failed\n")
sys.exit(0 if _f == 0 else 1)
