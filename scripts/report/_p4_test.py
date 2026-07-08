#!/usr/bin/env python3
"""Brief 96 P4 — metrics engine hand-check (3 cases: Class A, Class C, Class D).

Each expected value is derived independently here and must match the engine exactly.

Run: validation/.venv/bin/python scripts/report/_p4_test.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from interventions import by_ref  # noqa: E402
from metrics import compute_row  # noqa: E402
from offmodel import pv_7_1  # noqa: E402

_p = _f = 0
def ok(name, got, exp):
    global _p, _f
    if got == exp: _p += 1; print(f"  ✓ {name}: {got}")
    else: _f += 1; print(f"  ✗ FAIL {name}: got {got}, expected {exp}")

# ── Case 1 — Class A (4.2 plug-load): saves 10 MWh elec, life 10y ──────────────
# Hand: elec 10,000 kWh; £ = 10000×0.28 = 2,800; eui 123.6−126.0 = −2.4.
# Lifetime: grid factors 2026..2035 (gCO₂/kWh) = 150,125,100,75,50,43,36,29,22,15
#   Σ = 645 → 10,000 kWh × 0.645 kg = 6,450 kg = 6.45 t → displayed 6.5.
# £/t = round(19,320 / 6.5) = 2,972; payback = round(19,320/2,800,1) = 6.9.
print("── Case 1: Class A (4.2 plug-load) ──")
base = {"eui": 126.0, "elec_mwh": 373.8, "gas_mwh": 157.4}
mod = {"eui": 123.6, "elec_mwh": 363.8, "gas_mwh": 157.4}
r1 = compute_row(by_ref("4.2"), baseline=base, modelled=mod)
grid = [150, 125, 100, 75, 50, 43, 36, 29, 22, 15]
hand_life = round(10000 * sum(grid) / 1000 / 1000, 1)   # 6.5
ok("capex_central", r1["capex_central"], 19320)
ok("annual_elec_kwh", r1["annual_elec_kwh"], 10000)
ok("annual_gas_kwh", r1["annual_gas_kwh"], 0)
ok("annual_gbp", r1["annual_gbp"], 2800)
ok("eui_delta", r1["eui_delta"], -2.4)
ok("lifetime_tco2e", r1["lifetime_tco2e"], hand_life)
ok("gbp_per_tco2e", r1["gbp_per_tco2e"], round(19320 / hand_life))
ok("payback_yrs", r1["payback_yrs"], 6.9)

# ── Case 2 — Class C (7.1 PV): off-model ──────────────────────────────────────
# Hand: self-consumed 47,500×0.85 = 40,375 kWh; £ = 40375×0.28 = 11,305; EUI 0.
# Lifetime from the tested helper = 30.8 t. £/t = round(55,000/30.8) = 1,786;
# payback = round(55,000/11,305,1) = 4.9.
print("── Case 2: Class C (7.1 PV) ──")
r2 = compute_row(by_ref("7.1"), off=pv_7_1())
ok("capex_central", r2["capex_central"], 55000)
ok("annual_elec_kwh", r2["annual_elec_kwh"], 40375)
ok("annual_gbp", r2["annual_gbp"], 11305)
ok("eui_delta (gross-demand rule)", r2["eui_delta"], 0.0)
ok("lifetime_tco2e", r2["lifetime_tco2e"], 30.8)
ok("gbp_per_tco2e", r2["gbp_per_tco2e"], round(55000 / 30.8))
ok("payback_yrs", r2["payback_yrs"], 4.9)

# ── Case 3 — Class D (5.3 sub-metering): capex only, energy em-dashed ──────────
print("── Case 3: Class D (5.3 sub-metering) ──")
r3 = compute_row(by_ref("5.3"))
ok("capex_central", r3["capex_central"], 13300)
ok("annual_elec_kwh (em-dash)", r3["annual_elec_kwh"], None)
ok("annual_gbp (em-dash)", r3["annual_gbp"], None)
ok("eui_delta (em-dash)", r3["eui_delta"], None)
ok("lifetime_tco2e (em-dash)", r3["lifetime_tco2e"], None)
ok("gbp_per_tco2e (em-dash)", r3["gbp_per_tco2e"], None)
ok("payback_yrs (em-dash)", r3["payback_yrs"], None)

print(f"\n{'─'*48}\n{'✅ ALL PASS' if _f == 0 else '❌ FAILURES'}: {_p} passed, {_f} failed\n")
sys.exit(0 if _f == 0 else 1)
