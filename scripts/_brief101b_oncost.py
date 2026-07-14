#!/usr/bin/env python3
"""Brief 101B — apply the four-tier on-cost framework (Bridgewater_on_cost_framework.xlsx)
across the 22 live cost plans, and refresh each COST BASIS note with the tier + justification.

Strips the old flat 40% (only WWHR/ASHP/MVHR/VRF carried it) back to works (the line items
already ARE the works — the 40% lived in on_costs), then sets per-tier on_costs:
  T1/T2  → contingency 10% only (all-in / day-rate: prelims+OH&P already in the rate)
  T3/T4  → design 8% + prelims 10% + OH&P 8% + contingency 15%
  zero   → no capex
Order (frontend computeOnCostsBreakdown, post OH&P-base fix): design %×works · prelims %×works
· OH&P %×(works+prelims) · contingency %×(works+design+prelims+OH&P).

PV (7.1) is FLAGGED: the framework's works £39,286 = £55,000÷1.4 strips a 40% PV never
carried (£1,100/kWp is an all-in turnkey rate). Per the framework's own rule (all-in rates
don't carry prelims/OH&P), PV is set Tier-1 (contingency 10% → £60,500), NOT the framework's
Tier-3 £57,287. Named in its COST BASIS for Chris to confirm/override.

Writes via the running backend's PUT (WAL-safe). Run: python3 scripts/_brief101b_oncost.py
"""
import sys, json, urllib.request
sys.path.insert(0, "scripts/report")
import interventions as I  # noqa: E402

API = "http://127.0.0.1:8002"
PID = "12cf7cc4-9bdc-41bc-ab4e-24e044fbad9d"

T1 = {"design_fees_pct": 0, "prelims_pct": 0, "ohp_pct": 0, "contingency_pct": 10, "inflation_pct": 0}
T2 = dict(T1)
T3 = {"design_fees_pct": 8, "prelims_pct": 10, "ohp_pct": 8, "contingency_pct": 15, "inflation_pct": 0}
T4 = dict(T3)
ZERO = {"design_fees_pct": 0, "prelims_pct": 0, "ohp_pct": 0, "contingency_pct": 0, "inflation_pct": 0}
TIER = {  # ref → (tier label, on_costs)
    "1.1": ("T1", T1), "3.4": ("T1", T1), "4.1": ("T1", T1), "4.2": ("T1", T1), "5.1": ("T1", T1), "5.3": ("T1", T1),
    "2.2": ("T2", T2), "3.1": ("T2", T2), "6.1": ("T2", T2),
    "1.2": ("T3", T3), "1.3": ("T3", T3), "1.4": ("T3", T3), "1.5": ("T3", T3), "2.1": ("T3", T3), "3.2": ("T3", T3), "5.2": ("T3", T3),
    "3.5": ("T4", T4),
    "7.1": ("PV", T1),   # flagged: all-in turnkey → T1, not the framework's T3
    "2.3": ("zero", ZERO), "3.3": ("zero", ZERO), "4.3": ("zero", ZERO), "5.4": ("zero", ZERO),
}
TIER_TEXT = {
    "T1": "Tier 1 (supply-&-fit, all-in installed rate): contingency 10% only — the installed rate already carries the installer's prelims/OH&P (public-sector minor-works norm).",
    "T2": "Tier 2 (specialist day-rate): contingency 10% only — day-rate visits, small but non-zero scope risk.",
    "T3": "Tier 3 (M&E plant project): design 8% + prelims 10% + OH&P 8% + contingency 15% — multi-trade installed project (M&E design/riser survey + integration, site establishment, main-contractor margin; 15% = public-sector pre-tender norm).",
    "T4": "Tier 4 (façade/structural): design 8% + prelims 10% + OH&P 8% + contingency 15% — includes the structural/wind-loading design sign-off and access.",
    "PV": "assumption: PV £1,100/kWp is an all-in turnkey (EPC) rate → treated Tier 1 (contingency 10% only). The framework's Tier-3 PV row stripped a 40% this plan never carried; FLAGGED for Chris to confirm (T1 £60,500 vs framework T3 £57,287).",
    "zero": "No capex (policy/settings measure — energy saving claimed here, cost carried under the consolidated controls visit where applicable).",
}
L_FLAG = {"1.2": "WWHR vertical HX units", "1.3": "exhaust-air ductwork", "1.5": "VRF→DHW interlink", "2.1": "MVHR plenum/ductwork"}
LIFE_CAT = {10: "controls/settings (10y)", 15: "plant (15y)", 25: "PV (25y)", 30: "fabric (30y)"}


def energy_basis(iv):
    a = iv["assumption"].strip().rstrip(".")
    if iv["ref"] == "7.1":
        return ("ENERGY BASIS: Off-model (Class C): 50 kWp × 950 kWh/kWp = 47.5 MWh/yr, 85% self-consumption. "
                "CRREM gross-demand rule — PV cuts CARBON, EUI is UNCHANGED by construction; carbon on the declining "
                "grid factor. assumption: yield + self-consumption per the HIEX design note.")
    p = "ENERGY BASIS: "
    if iv["cls"] == "D":
        return p + "Enabling measure — no modelled demand change. " + a + " (basis: " + iv["basis"].strip().rstrip(".") + ")."
    if iv.get("off_model"):
        return p + a + ". Off-model: neither engine simulates this; effect from the design-note calc (basis: " + iv["basis"].strip().rstrip(".") + ")."
    return p + a + ". Source: HIEX design note (basis: " + iv["basis"].strip().rstrip(".") + ")."


def cost_basis(iv, tier):
    ref = iv["ref"]; c = iv["cost"]; parts = [TIER_TEXT[tier]]
    if ref in L_FLAG:
        parts.append(f"assumption: {L_FLAG[ref]} cost is an ALLOWANCE pending survey.")
    life = iv["life"]
    if life:
        reps = 25 // life
        if reps > 0:
            plural = "replacement" if reps == 1 else "replacements"
            parts.append(f"Measure life {LIFE_CAT.get(life, str(life)+'y')}; £/tonne charges {reps} {plural} to 2050 at 70% of total capex (excludes one-off strip-outs / supply upgrades / builder's-work / design).")
        else:
            parts.append(f"Measure life {LIFE_CAT.get(life, str(life)+'y')} — spans to 2050, no replacement in £/tonne.")
    parts.append(f"Cost confidence {c['confidence']}.")
    return "COST BASIS: " + " ".join(parts)


# frontend on-cost math (mirror of computeOnCostsBreakdown, post OH&P-base fix) for self-verify
def plan_total(works, oc):
    d = round(works * oc["design_fees_pct"] / 100)
    p = round(works * oc["prelims_pct"] / 100)
    o = round((works + p) * oc["ohp_pct"] / 100)
    sub = works + d + p + o
    cont = round(sub * oc["contingency_pct"] / 100)
    infl = round(sub * oc.get("inflation_pct", 0) / 100)
    return sub + cont + infl


by_name = {iv["name"]: iv for iv in I.INTERVENTIONS}
FW = {"1.1": 9108, "1.2": 23076, "1.3": 6635, "1.4": 110094, "1.5": 36455, "2.1": 102949, "2.2": 2860,
      "2.3": 0, "3.1": 8910, "3.2": 392256, "3.3": 0, "3.4": 9554, "3.5": 33684, "4.1": 4950, "4.2": 21252,
      "4.3": 0, "5.1": 2530, "5.2": 29310, "5.3": 14630, "5.4": 0, "6.1": 3300, "7.1": 57287}

proj = json.load(urllib.request.urlopen(f"{API}/api/projects/{PID}"))
bc = proj["building_config"]
rows = []
for dbiv in bc.get("interventions") or []:
    src = by_name.get(dbiv.get("label") or "")
    if not src:
        rows.append((dbiv.get("label"), "UNMATCHED")); continue
    ref = src["ref"]; tier, oc = TIER[ref]
    cost = dbiv.get("cost") or {}
    works = sum(sum(float(l.get("quantity", 0) or 0) * float(l.get("rate", 0) or 0) for l in (g.get("lines") or []))
                for g in (cost.get("groups") or []))
    cost["on_costs"] = dict(oc)
    dbiv["cost"] = cost
    dbiv["assumption_notes"] = energy_basis(src) + "\n\n" + cost_basis(src, tier)
    total = plan_total(works, oc)
    tgt = FW[ref]
    flag = "" if (tgt == 0 or abs(total - tgt) <= 5) else f"  Δ{total-tgt:+.0f}"
    rows.append((ref, tier, round(works), total, tgt, flag))

for r in rows:
    if r[1] == "UNMATCHED":
        sys.exit(f"ABORT unmatched: {r[0]}")
print(f"{'ref':5}{'tier':6}{'works':>9}{'total':>9}{'target':>9}  flag")
for ref, tier, works, total, tgt, flag in sorted(rows):
    print(f"{ref:5}{tier:6}{works:>9}{total:>9}{tgt:>9}{flag}")

req = urllib.request.Request(f"{API}/api/projects/{PID}", method="PUT",
                             data=json.dumps({"building_config": bc}).encode(),
                             headers={"Content-Type": "application/json"})
print("PUT", urllib.request.urlopen(req).status)
