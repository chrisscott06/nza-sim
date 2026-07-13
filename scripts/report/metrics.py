#!/usr/bin/env python3
"""Brief 96 P4 — metrics engine: one intervention → the report row.

Given a baseline engine result, an intervention result (Class A/B) OR an off-model tuple
(Class C), and the cost plan, produce the four report metrics + supporting columns:
  capex central (+low/high) · annual kWh saved (elec/gas) · annual £ saved (28p/7p) ·
  EUI Δ · lifetime tCO₂e to 2050 (FES grid + gas constant, life-capped) · £/tCO₂e ·
  simple payback.
Class D (enabling/£0-energy) rows carry capex only; energy metrics are em-dashed (None).

Engine result shape: {"eui": kWh/m², "elec_mwh": MWh, "gas_mwh": MWh}. A SAVING is a
positive kWh/£/tonne (demand removed); an increase is negative.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import benchmarks as B  # noqa: E402
from offmodel import refrigerant_3_2  # noqa: E402


# Brief 101 follow-up: lifecycle capex for £/tCO₂e — mirror of frontend costModel.js.
# £/tonne carries a 70%-of-initial replacement each time the measure life expires before
# 2050 (floor(25/life): controls 10→2, plant 15→1, PV 25→1, fabric ≥26→0). Replacement is
# 70% because it excludes one-off strip-outs/supply/builder's-work/design (~30% of a build-up).
LIFECYCLE_HORIZON_YEARS = 2050 - 2025   # 25
REPLACEMENT_COST_FRACTION = 0.70
# Brief 101: the CO₂ SAVING is integrated over the whole CRREM window TO 2050 (not
# life-capped) — the measure is replaced when it wears out (the £/tonne repex above), so it
# keeps saving to 2050. This mirrors the frontend (lifetimeCarbon.js integrates to 2050) and
# lets the two engines' £/tonne agree. `measure life` still drives the repex, not the horizon.
CARBON_HORIZON_YEARS = B.CAP_YEAR - B.REPORT_START_YEAR + 1   # 2026..2050 → 25


def lifecycle_replacements(life_years):
    if not life_years or life_years <= 0:
        return 0
    return LIFECYCLE_HORIZON_YEARS // int(life_years)


def lifecycle_capex(initial_capex, life_years):
    return initial_capex * (1 + REPLACEMENT_COST_FRACTION * lifecycle_replacements(life_years))


def _flags(iv):
    f = []
    if iv.get("cost", {}).get("confidence") == "L":
        f.append("allowance-only")
    if iv.get("off_model"):
        f.append("off-model")
    if iv.get("enabling"):
        f.append("enabling")
    return f


def compute_row(iv, baseline=None, modelled=None, off=None, ep_validated=False):
    cost = iv["cost"]
    row = {
        "ref": iv["ref"], "name": iv["name"], "theme": iv["theme"], "category": iv["category"],
        "cls": iv["cls"], "confidence": cost["confidence"], "life_years": iv["life"],
        "capex_central": cost["central"], "capex_low": cost["low"], "capex_high": cost["high"],
        "annual_elec_kwh": None, "annual_gas_kwh": None, "annual_gbp": None,
        "eui_delta": None, "lifetime_tco2e": None, "gbp_per_tco2e": None, "payback_yrs": None,
        "basis": iv.get("assumption") or iv.get("basis", ""),
        "flags": _flags(iv), "ep_validated": ep_validated,
    }

    if iv.get("enabling") or (off is None and modelled is None):
        # Class D, or a measure with no clean static-engine representation (e.g. 2.3):
        # capex only, energy metrics em-dashed.
        return row

    if off is not None:             # Class C off-model (1.5, 7.1)
        elec_saved = off["annual_elec_kwh_saved"]
        gas_saved = off["annual_gas_kwh_saved"]
        eui_delta = off["eui_delta_kwh_m2"]
        gbp_saved = off["annual_gbp_saved"]
        lifetime = off["lifetime_tco2e"]
    else:                           # Class A/B modelled — deltas from the two engine runs
        elec_saved = round((baseline["elec_mwh"] - modelled["elec_mwh"]) * 1000)
        gas_saved = round((baseline["gas_mwh"] - modelled["gas_mwh"]) * 1000)
        eui_delta = round(modelled["eui"] - baseline["eui"], 1)     # negative = reduction
        gbp_saved = round(elec_saved * B.ELEC_TARIFF_GBP_PER_KWH + gas_saved * B.GAS_TARIFF_GBP_PER_KWH)
        lifetime = B.lifetime_carbon_tco2e(elec_saved, gas_saved, CARBON_HORIZON_YEARS)
        if iv["ref"] == "3.2":       # add the Class C refrigerant carbon to the 3.2 row
            lifetime = round(lifetime + refrigerant_3_2(life_years=iv["life"])["lifetime_tco2e"], 1)
        else:
            lifetime = round(lifetime, 1)

    row["annual_elec_kwh"] = elec_saved
    row["annual_gas_kwh"] = gas_saved
    row["annual_gbp"] = gbp_saved
    row["eui_delta"] = eui_delta
    row["lifetime_tco2e"] = lifetime
    # £/tCO₂e only meaningful when the measure actually saves carbon. Brief 101 follow-up:
    # numerator is LIFECYCLE capex (initial + 70% repex per measure-life expiry before 2050),
    # matching the frontend export; capex_central column stays the initial capex.
    row["lifecycle_capex"] = round(lifecycle_capex(cost["central"], iv["life"]))
    row["gbp_per_tco2e"] = round(lifecycle_capex(cost["central"], iv["life"]) / lifetime) if (lifetime and lifetime > 0) else None
    # simple payback only when there's a positive £ saving
    row["payback_yrs"] = round(cost["central"] / gbp_saved, 1) if gbp_saved and gbp_saved > 0 else None
    return row


if __name__ == "__main__":
    import json
    from offmodel import pv_7_1
    from interventions import by_ref
    base = {"eui": 126.0, "elec_mwh": 373.8, "gas_mwh": 157.4}
    # demo: a modelled Class A saving 10 MWh elec
    demo = {"eui": 123.6, "elec_mwh": 363.8, "gas_mwh": 157.4}
    print(json.dumps(compute_row(by_ref("4.2"), baseline=base, modelled=demo), indent=1))
    print(json.dumps(compute_row(by_ref("7.1"), off=pv_7_1()), indent=1))
    print(json.dumps(compute_row(by_ref("5.3")), indent=1))
