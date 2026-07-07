#!/usr/bin/env python3
"""Brief 96 P3 — Class C off-model calculators + Class B sensitivity data.

Class C measures are not simulated by either engine (inter-plant heat flows, refrigerant
carbon, PV) — they are post-processed from model outputs per the design note's stated
formulae. Each calculator returns a dict with the annual energy/£ effect, lifetime tCO₂e,
and a `basis` string for the report.

Class B sensitivity: 3.1 VRF commissioning is a BAND (none/central/strong), not a point;
the central is the stack member, none/strong are stored as sensitivity. 3.2's cumulative
efficiency is computed against the post-3.1 state (the note's anti-double-count guard).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import benchmarks as B  # noqa: E402

# ── Class B sensitivity / anti-double-count data ──────────────────────────────
# 3.1 VRF commissioning: in-service VRF SCOP/EER scenarios (heating[0]/cooling[0]).
VRF_COMMISSIONING = {"none": 3.0, "central": 3.4, "strong": 3.9}   # baseline in-service 3.0

# 3.2 VRF replacement (energy): −20% consumption via rated-SCOP substitution derated.
#   isolated  = baseline 3.0 / 0.8 = 3.75   (−20% vs baseline)
#   cumulative= post-3.1 3.4 / 0.8 = 4.25   (−20% vs the post-commissioning state)
VRF_REPLACEMENT_EFF = {"isolated": 3.75, "cumulative_after_3_1": 4.25}

# Baseline monthly cooling: EP monthly shape (Brief 95 P1) scaled to the NZA-Sim annual
# total (101.1 MWh) — the two engines' monthly cooling shapes correlate r≈0.92, so the EP
# distribution on the NZA annual is a faithful NZA-consistent monthly proxy.
_EP_COOL_SHAPE = [0.5, 1.3, 4.0, 9.5, 15.1, 24.2, 30.8, 20.9, 14.6, 7.2, 1.8, 0.5]
_NZA_ANNUAL_COOLING_MWH = 101.1


def nza_monthly_cooling_mwh():
    s = sum(_EP_COOL_SHAPE)
    return [c / s * _NZA_ANNUAL_COOLING_MWH for c in _EP_COOL_SHAPE]


# ── 1.5 VRF→DHW interlink (Class C) ───────────────────────────────────────────
def interlink_1_5(cooling_monthly_mwh=None, dhw_annual_mwh=257.335, preheat_share=0.48,
                  cooling_eer=3.0, preheat_cop=3.0, capture=0.55, life_years=15):
    """Monthly method (design note): recoverable heat = cooling rejection
    (cooling × (1 + 1/EER)) × capture; usable = min(recoverable, monthly DHW preheat
    demand); elec saved = usable heat displacing the preheat ASHP's electricity at its COP.
    Coincidence handled by the monthly resolution."""
    cool = cooling_monthly_mwh or nza_monthly_cooling_mwh()
    preheat_monthly = dhw_annual_mwh * preheat_share / 12.0     # heat demand, MWh/month
    usable_total_heat = 0.0
    detail = []
    for m, c in enumerate(cool):
        recoverable = c * (1 + 1 / cooling_eer) * capture       # MWh heat available
        usable = min(recoverable, preheat_monthly)              # capped by demand
        assert usable <= recoverable + 1e-9, "usable exceeds recoverable"
        assert usable <= preheat_monthly + 1e-9, "usable exceeds preheat demand"
        usable_total_heat += usable
        detail.append({"month": m + 1, "recoverable": round(recoverable, 2),
                       "preheat_demand": round(preheat_monthly, 2), "usable": round(usable, 2)})
    elec_saved_mwh = usable_total_heat / preheat_cop            # ASHP elec displaced
    elec_saved_kwh = elec_saved_mwh * 1000.0
    return {
        "annual_elec_kwh_saved": round(elec_saved_kwh),
        "annual_gas_kwh_saved": 0,
        "annual_gbp_saved": round(elec_saved_kwh * B.ELEC_TARIFF_GBP_PER_KWH),
        "lifetime_tco2e": round(B.lifetime_carbon_tco2e(elec_saved_kwh, 0, life_years), 1),
        "eui_delta_kwh_m2": round(-elec_saved_kwh / B.GIA_M2, 2),
        "monthly": detail,
        "basis": f"Interlink: {int(capture*100)}% capture of VRF cooling rejection (EER {cooling_eer}) "
                 f"→ min(recoverable, DHW preheat {preheat_monthly*12:.0f} MWh/yr) → "
                 f"{usable_total_heat:.0f} MWh usable heat / COP {preheat_cop} = "
                 f"{elec_saved_mwh:.1f} MWh elec/yr.",
    }


# ── 3.2 refrigerant carbon (Class C, alongside the 3.2 energy patch) ──────────
def refrigerant_3_2(capacity_kw=320, charge_kg_per_kw=0.35, leak_pct=3.0,
                    gwp_r410a=2088, gwp_r32=675, life_years=15):
    charge = capacity_kw * charge_kg_per_kw
    annual_tco2e = charge * (leak_pct / 100.0) * (gwp_r410a - gwp_r32) / 1000.0
    return {
        "annual_elec_kwh_saved": 0, "annual_gas_kwh_saved": 0, "annual_gbp_saved": 0,
        "annual_tco2e": round(annual_tco2e, 2),
        "lifetime_tco2e": round(B.refrigerant_lifetime_tco2e(annual_tco2e, life_years), 1),
        "eui_delta_kwh_m2": 0.0,
        "basis": f"Charge {charge:.0f} kg ({charge_kg_per_kw} kg/kW × {capacity_kw} kW) × "
                 f"{leak_pct}% leak × (GWP {gwp_r410a}→{gwp_r32}) = {annual_tco2e:.1f} tCO₂e/yr avoided.",
    }


# ── 7.1 Solar PV (Class C) ────────────────────────────────────────────────────
def pv_7_1(kwp=50, yield_kwh_per_kwp=950, self_consumption=0.85, life_years=25):
    gen_kwh = kwp * yield_kwh_per_kwp
    self_kwh = gen_kwh * self_consumption           # displaces grid import (£ + carbon)
    return {
        "annual_gen_mwh": round(gen_kwh / 1000.0, 1),
        "annual_elec_kwh_saved": round(self_kwh),   # self-consumed avoids import
        "annual_gas_kwh_saved": 0,
        "annual_gbp_saved": round(self_kwh * B.ELEC_TARIFF_GBP_PER_KWH),
        "lifetime_tco2e": round(B.lifetime_carbon_tco2e(self_kwh, 0, life_years), 1),
        "eui_delta_kwh_m2": 0.0,   # EUI UNCHANGED by construction (CRREM gross-demand rule)
        "basis": f"{kwp} kWp × {yield_kwh_per_kwp} kWh/kWp = {gen_kwh/1000:.1f} MWh/yr; "
                 f"{int(self_consumption*100)}% self-consumed = {self_kwh/1000:.1f} MWh avoided import. "
                 f"EUI unchanged (gross-demand rule); export ({int((1-self_consumption)*100)}%) excluded (conservative).",
    }


OFFMODEL = {"1.5": interlink_1_5, "3.2_refrigerant": refrigerant_3_2, "7.1": pv_7_1}

if __name__ == "__main__":
    import json
    print("1.5 interlink:", json.dumps({k: v for k, v in interlink_1_5().items() if k != "monthly"}, indent=1))
    print("3.2 refrigerant:", json.dumps(refrigerant_3_2(), indent=1))
    print("7.1 PV:", json.dumps(pv_7_1(), indent=1))
