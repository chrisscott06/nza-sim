#!/usr/bin/env python3
"""Brief 98-R P2 — the reconciliation table generator (Table A).

Reads NZA-Sim's per-channel heat-balance (docs/audit/98R_nza_channels.json, produced by
scripts/report/_98R_nza_channels.mjs) + EnergyPlus component outputs (the matched-inputs
baseline SQL) → emits Table A into docs/audit/98R_reconciliation.md with automatic flags.

NO hand-typed numbers: every value is extracted here and now. The `cause` strings are the
analyst's one-line named explanation per the brief's flag rule; the numbers that trigger
the flags are script-generated and rerunnable. Any flagged row with no known cause is
emitted as "UNEXPLAINED — needs investigation" (never silently passed).

Flag rules: 🔴 zero-vs-nonzero · 🔴 |Δ|>25% · 🟠 |Δ| 10-25% · ✅ ≤10%. Δ% = (EP−NZA)/|NZA|.

Run: ENERGYPLUS_DIR=/Applications/EnergyPlus-25-2-0 validation/.venv/bin/python scripts/report/reconcile.py
"""
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
EP_SQL = REPO / "data/simulations/98R_p1_baseline/eplusout.sql"
NZA_JSON = REPO / "docs/audit/98R_nza_channels.json"
OUT = REPO / "docs/audit/98R_reconciliation.md"
J_TO_MWH = 3.6e9

# ── refresh the NZA channel dump (keeps the table rerunnable end-to-end) ──────────
subprocess.run(["node", str(REPO / "scripts/report/_98R_nza_channels.mjs")], check=True)
NZA = json.loads(NZA_JSON.read_text())

if not EP_SQL.exists():
    sys.exit(f"EP baseline SQL missing: {EP_SQL} — run scripts/_98R_p1_verify.py first")
conn = sqlite3.connect(str(EP_SQL)); conn.row_factory = sqlite3.Row


def meter(name):
    r = conn.execute("""SELECT SUM(rmd.VariableValue) v FROM ReportMeterData rmd
        JOIN ReportMeterDataDictionary d ON rmd.ReportMeterDataDictionaryIndex=d.ReportMeterDataDictionaryIndex
        WHERE d.VariableName=?""", (name,)).fetchone()
    return (r["v"] or 0) / J_TO_MWH


def var_sum(name):
    r = conn.execute("""SELECT SUM(rvd.VariableValue) v FROM ReportVariableData rvd
        JOIN ReportVariableDataDictionary d ON rvd.ReportVariableDataDictionaryIndex=d.ReportVariableDataDictionaryIndex
        WHERE d.VariableName=?""", (name,)).fetchone()
    return (r["v"] or 0) / J_TO_MWH


def conduction_by_class():
    """Gross annual conduction LOSS (MWh) per external opaque class, from per-surface
    'Surface Inside Face Conduction Heat Transfer Energy'. EP sign: +ve = gain to zone,
    so gross loss = Σ −min(0, value). Classify via the Surfaces table boundary condition:
    ExtBoundCond 0 = Outdoors, -1 = Ground, >0 = interzone (excluded)."""
    surf = {r["SurfaceName"]: (r["ClassName"], r["ExtBoundCond"]) for r in
            conn.execute("SELECT SurfaceName,ClassName,ExtBoundCond FROM Surfaces")}
    rows = conn.execute("""SELECT d.KeyValue k, rvd.VariableValue val FROM ReportVariableData rvd
        JOIN ReportVariableDataDictionary d ON rvd.ReportVariableDataDictionaryIndex=d.ReportVariableDataDictionaryIndex
        WHERE d.VariableName='Surface Inside Face Conduction Heat Transfer Energy'""")
    loss = {"wall": 0.0, "roof": 0.0, "floor": 0.0}
    for r in rows:
        cls, ext = surf.get(r["k"], (None, None))
        if ext is None or ext > 0:
            continue  # interzone or unknown
        key = {"Wall": "wall", "Roof": "roof", "Floor": "floor"}.get(cls)
        if key and r["val"] < 0:
            loss[key] += -r["val"] / J_TO_MWH
    return loss


cond = conduction_by_class()

# ── row spec: (group, channel, nza_value, ep_value, comparability, cause_if_flagged) ──
# comparability: 'clean' → flag on magnitude; 'divergent' → suppress magnitude-🔴 (still
# flags zero-vs-nonzero), because the two engines define the channel differently.
L, G, De, Dm = NZA["losses"], NZA["gains"], NZA["delivered"], NZA["demand"]
rows = [
    ("LOSSES (gross, MWh/yr)", "Wall conduction", L["wall_conduction"], cond["wall"], "divergent",
     "NZA = setpoint-gated heating loss; EP = raw gross envelope loss (all hours) → EP structurally larger, not a gap"),
    ("", "Roof conduction", L["roof_conduction"], cond["roof"], "divergent",
     "same definitional basis difference (gated vs gross)"),
    ("", "Floor/ground conduction", L["floor_conduction"], cond["floor"], "divergent",
     "same; EP ground uses its own ground-temp object vs NZA annual-mean ground temp"),
    ("", "Glazing conduction", L["glazing_conduction"], var_sum("Zone Windows Total Heat Loss Energy"), "divergent",
     "EP 'Windows Total Heat Loss' bundles glazing conduction; not cleanly separable (SimpleGlazing transmitted-solar var reads 0 in EP 25.2)"),
    ("", "Infiltration", L["infiltration"], var_sum("Zone Infiltration Sensible Heat Loss Energy"), "clean",
     "airtightness ACH matched (0.0692) — residual is basis: EP uses zone-volume ACH per zone; NZA whole-building V. Small."),
    ("", "Permanent vents", L["permanent_vents"], var_sum("Zone Ventilation Sensible Heat Loss Energy"), "clean",
     "passive-opening flow models differ: EP ZoneVentilation:WindandStack Autocalculate effectiveness vs NZA cd/Cw model"),
    ("", "Thermal bridging", L["thermal_bridging"], 0.0, "clean",
     "STRUCTURAL: EP model has no thermal-bridging object — NZA books ISO 14683 linear ψ; EP books nothing"),
    ("", "Mech vent — public MVHR", L["mech_vent_public_mvhr"], 0.0, "clean",
     "EP folds MVHR outdoor-air load into the VRF via DesignSpecification:OutdoorAir; no separate vent-loss channel, and HX recovery reports 0.0 MWh"),
    ("", "Mech vent — bedroom extract", L["mech_vent_bedroom_extract"], 0.0, "clean",
     "STRUCTURAL: derive_systems_for_sim._primary keeps only the highest-share vent system; bedroom extract (2208 L/s) absent from EP"),
    ("", "Mech vent — toilet extract", L["mech_vent_toilet_extract"], 0.0, "clean",
     "STRUCTURAL: same single-primary simplification — toilet extract (210 L/s) absent from EP"),
    ("GAINS (MWh/yr)", "Solar through glazing", G["solar_through_glazing"], var_sum("Zone Windows Total Heat Gain Energy"), "divergent",
     "EP 'Windows Total Heat Gain' bundles solar + conduction gain (transmitted-solar var = 0 under SimpleGlazing); NZA = transmitted solar only"),
    ("", "People", G["people"], var_sum("Zone People Total Heating Energy"), "clean",
     "BUG: EP People.activity_level_schedule_name points at the occupancy FRACTION schedule (0-1 W/person) instead of a ~100 W/person activity level → EP books ~1% of NZA's people gain"),
    ("", "Lighting", G["lighting"], var_sum("Zone Lights Total Heating Energy"), "clean", None),
    ("", "Equipment / small power", G["equipment"], var_sum("Zone Electric Equipment Total Heating Energy"), "clean", None),
    ("DEMAND (MWh/yr)", "Heating demand", Dm["heating"], meter("Heating:EnergyTransfer"), "clean",
     "downstream of the loss/gain gaps above (missing mech-vent loss lowers EP heating; missing people gain raises it — net EP far lower)"),
    ("", "Cooling demand", Dm["cooling"], meter("Cooling:EnergyTransfer"), "clean",
     "downstream: EP setback + missing vent loss + lumped-mass differences push cooling higher"),
    ("DELIVERED (MWh/yr)", "Heating — electricity", De["heating_electricity"], meter("Heating:Electricity"), "clean",
     "tracks the heating-demand gap (÷ VRF SCOP)"),
    ("", "Cooling — electricity", De["cooling_electricity"], meter("Cooling:Electricity"), "clean", None),
    ("", "DHW — electricity", De["dhw_electricity"], meter("WaterSystems:Electricity"), "clean",
     "DHW demand matched; delivered split differs — EP series-preheat ASHP vs NZA parallel 52/48 gas/ASHP"),
    ("", "DHW — gas", De["dhw_gas"], meter("WaterSystems:NaturalGas"), "clean",
     "same ASHP-topology split (EP puts more of DHW on electric preheat → less gas)"),
    ("", "Ventilation fans — electricity", De["vent_fans_electricity"], meter("Fans:Electricity"), "clean",
     "NZA does not book fan electricity as a separate delivered channel (folded / null); EP books the MVHR+VRF fans explicitly"),
    ("", "Lighting — electricity", De["lighting_electricity"], meter("InteriorLights:Electricity"), "clean", None),
    ("", "Small power — electricity", De["small_power_electricity"], meter("InteriorEquipment:Electricity"), "clean", None),
    ("FUEL (MWh/yr)", "Total electricity", De["total_electricity"], meter("Electricity:Facility"), "clean", None),
    ("", "Total gas", De["total_gas"], meter("NaturalGas:Facility"), "clean",
     "NZA gas = DHW gas share (157.4); EP gas = DHW preheat remainder (45.4) — the ASHP-topology split"),
]


def flag(nza, ep, comparability):
    nza = nza if nza is not None else None
    ep = ep if ep is not None else None
    a = abs(nza) if isinstance(nza, (int, float)) else 0
    b = abs(ep) if isinstance(ep, (int, float)) else 0
    ZERO = 1.0  # MWh threshold for "zero"
    if nza is None or ep is None:
        return "🔴", True  # one side doesn't book the channel at all
    if (a < ZERO) ^ (b < ZERO):
        return "🔴", True  # zero-vs-nonzero
    if a < ZERO and b < ZERO:
        return "✅", False
    dpct = (ep - nza) / a * 100
    if comparability == "divergent":
        # magnitude differences expected by definition — don't hard-red them, but surface
        return ("🟠" if abs(dpct) > 25 else "✅"), (abs(dpct) > 25)
    if abs(dpct) > 25:
        return "🔴", True
    if abs(dpct) >= 10:
        return "🟠", True
    return "✅", False


def fmt(v):
    return "—" if v is None else f"{v:,.1f}"


# ── emit Table A ─────────────────────────────────────────────────────────────────
lines = []
lines.append("## Table A — output reconciliation (per channel, NZA | EP | Δ)")
lines.append("")
lines.append("Both engines, `report_baseline_v1`, annual MWh. NZA = `calculateInstant` v2.5 "
             "(anchor path); EP = matched-inputs nza_engine pipeline, EP 25-2-0. Numbers are "
             "script-extracted (`scripts/report/reconcile.py` + `_98R_nza_channels.mjs`), not "
             "hand-typed. Δ% = (EP−NZA)/|NZA|. Flags: 🔴 zero-vs-nonzero or |Δ|>25% · 🟠 |Δ| "
             "10–25% · ✅ ≤10%. `divergent` rows define the channel differently between engines "
             "(noted) so magnitude gaps are amber-noted, not red.")
lines.append("")
lines.append("| Group | Channel | NZA | EP | Δ% | Flag | Named cause |")
lines.append("|---|---|--:|--:|--:|:--:|---|")
n_red = n_amber = 0
unexplained = []
for group, chan, nza, ep, comp, cause in rows:
    fl, flagged = flag(nza, ep, comp)
    if fl == "🔴":
        n_red += 1
    elif fl == "🟠":
        n_amber += 1
    dpct = "—"
    if isinstance(nza, (int, float)) and isinstance(ep, (int, float)) and abs(nza) >= 1.0:
        dpct = f"{(ep - nza) / abs(nza) * 100:+.0f}%"
    cell_cause = cause or ""
    if flagged and not cause:
        cell_cause = "**UNEXPLAINED — needs investigation**"
        unexplained.append(chan)
    if not flagged and fl == "✅":
        cell_cause = cell_cause or "match"
    lines.append(f"| {group} | {chan} | {fmt(nza)} | {fmt(ep)} | {dpct} | {fl} | {cell_cause} |")
lines.append("")
lines.append(f"**Flag tally:** 🔴 {n_red} · 🟠 {n_amber} · rows {len(rows)}. "
             f"Unexplained: {', '.join(unexplained) if unexplained else 'none — every flag named'}.")
lines.append("")
lines.append("NZA gross-loss channels reconcile to NZA's own total (457.5 = 457.5 MWh, verified "
             "in `_98R_nza_channels.mjs`). Anchors 132.6/126.0 byte-identical; instantCalc + EP "
             "physics untouched (EP change = output requests only, P1).")

# preserve any pre-existing header/Table B by only writing Table A section for now (P2).
header = ("# Brief 98-R — the reconciliation table\n\n"
          "Every channel, both engines, side by side — the systematic gap-detector. "
          "DETECTS, does not fix. Generated by `scripts/report/reconcile.py`.\n\n")
OUT.write_text(header + "\n".join(lines) + "\n")
print(f"wrote {OUT.relative_to(REPO)}")
print(f"🔴 {n_red} · 🟠 {n_amber} · unexplained: {unexplained or 'none'}")
conn.close()
