#!/usr/bin/env python3
"""Brief 101 seed — add measure_life_years + assumption_notes to the 22 live Bridgewater
interventions, sourced from scripts/report/interventions.py (life / assumption / basis /
cost tier / confidence). Writes via the running backend's PUT /api/projects/{id} (WAL-safe).

Modes:
  --life   seed measure_life_years only (Part 1)
  --notes  seed assumption_notes only (Part 2)
  (default: both)

Idempotent: matches DB interventions to report refs by exact label/name; reports any
unmatched. Run: python3 scripts/_brief101_seed.py [--life|--notes]
"""
import sys, json, urllib.request
sys.path.insert(0, "scripts/report")
import interventions as I  # noqa: E402

API = "http://127.0.0.1:8002"
PID = "12cf7cc4-9bdc-41bc-ab4e-24e044fbad9d"
MODE = sys.argv[1] if len(sys.argv) > 1 else "--both"

L_FLAG_TEXT = {  # the four allowance-only measures (confidence L)
    "1.2": "VERTICAL WWHR HX units — cost is an ALLOWANCE pending riser survey.",
    "1.3": "exhaust-air ductwork modification — cost is an ALLOWANCE pending survey.",
    "1.5": "water-side HX + integration — cost is an ALLOWANCE pending survey (interlink design study required).",
    "2.1": "MVHR plenum/ductwork adaptation — cost is an ALLOWANCE pending a builder's-work design study.",
}
LIFE_CAT = {10: "controls/settings (10y)", 15: "plant (15y)", 25: "PV (25y)", 30: "fabric (30y)"}


def cost_basis(iv):
    c = iv["cost"]; ref = iv["ref"]; tier = c.get("tier"); onp = c["on_cost_pct"]; conf = c["confidence"]
    parts = []
    # tier → rate basis
    if onp >= 40:
        parts.append("NRM build-up with ~40% on-costs (prelims + OH&P + design + contingency)")
    elif iv["cls"] == "D" or c["central"] == 0 or c.get("within"):
        if c.get("within"):
            parts.append(f"cost carried within the {c['within']} controls visit (this measure reads £0 capex to avoid double-count)")
        else:
            parts.append("enabling/metering measure — all-in benchmark rate, no separate on-costs")
    else:
        parts.append("all-in benchmark rate (HIEX cost doc), no separate on-costs")
    # allowance flag (L)
    if ref in L_FLAG_TEXT:
        parts.append("assumption: " + L_FLAG_TEXT[ref])
    # measure life + repex
    life = iv["life"]
    if life:
        reps = 25 // life
        if reps > 0:
            parts.append(f"measure life {LIFE_CAT.get(life, str(life)+'y')}; £/tonne charges {reps} replacement(s) to 2050 at 70% of initial capex (excludes one-off strip-outs/supply/builder's-work/design ≈30%)")
        else:
            parts.append(f"measure life {LIFE_CAT.get(life, str(life)+'y')} — spans to 2050, no replacement in £/tonne")
    parts.append(f"cost confidence {conf}; central £{c['central']:,} (range £{c['low']:,}–£{c['high']:,}).")
    return "COST BASIS: " + " ".join(parts)


def energy_basis(iv):
    a = iv["assumption"].strip().rstrip(".")
    ref = iv["ref"]
    if ref == "7.1":  # PV — must state CRREM gross-demand rule
        return ("ENERGY BASIS: Off-model (Class C): 50 kWp × 950 kWh/kWp = 47.5 MWh/yr, 85% "
                "self-consumption. CRREM gross-demand rule — PV cuts CARBON, EUI is UNCHANGED by "
                "construction. Carbon valued on the declining grid factor. assumption: yield + "
                "self-consumption per the HIEX design note.")
    prefix = "ENERGY BASIS: "
    if iv["cls"] == "D":
        return prefix + "Enabling measure — no modelled demand change. " + a + " (basis: " + iv["basis"].strip().rstrip(".") + ")."
    if iv.get("off_model"):
        return prefix + a + ". Off-model: neither engine simulates this; effect from the design-note calc (basis: " + iv["basis"].strip().rstrip(".") + ")."
    return prefix + a + ". Source: HIEX design note (basis: " + iv["basis"].strip().rstrip(".") + ")."


def build_notes(iv):
    return energy_basis(iv) + "\n\n" + cost_basis(iv)


# ── name → (ref, life, notes) from the report source of truth ────────────────
by_name = {iv["name"]: iv for iv in I.INTERVENTIONS}

proj = json.load(urllib.request.urlopen(f"{API}/api/projects/{PID}"))
bc = proj["building_config"]
ivs = bc.get("interventions") or []
matched, unmatched = 0, []
for dbiv in ivs:
    label = dbiv.get("label") or ""
    src = by_name.get(label)
    if not src:
        unmatched.append(label); continue
    matched += 1
    if MODE in ("--life", "--both"):
        dbiv["measure_life_years"] = src["life"]  # None for D-class
    if MODE in ("--notes", "--both"):
        dbiv["assumption_notes"] = build_notes(src)

print(f"matched {matched}/{len(ivs)}; unmatched: {unmatched}")
if unmatched:
    sys.exit("ABORT: unmatched labels — fix name mapping before writing")

req = urllib.request.Request(f"{API}/api/projects/{PID}", method="PUT",
                             data=json.dumps({"building_config": bc}).encode(),
                             headers={"Content-Type": "application/json"})
resp = urllib.request.urlopen(req)
print(f"PUT {resp.status} — seeded mode {MODE}")
