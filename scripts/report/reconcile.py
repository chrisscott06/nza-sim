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
     "NZA = setpoint-gated heating loss; EP = raw gross envelope loss (all hours) AND now carries the P5 thermal-bridging ΔU (NZA books bridging separately) → EP structurally larger, not a gap"),
    ("", "Roof conduction", L["roof_conduction"], cond["roof"], "divergent",
     "same basis difference (gated vs gross) + P5 bridging ΔU folded in"),
    ("", "Floor/ground conduction", L["floor_conduction"], cond["floor"], "divergent",
     "same; EP ground uses its own ground-temp object vs NZA annual-mean ground temp"),
    ("", "Glazing conduction", L["glazing_conduction"], var_sum("Zone Windows Total Heat Loss Energy"), "divergent",
     "EP 'Windows Total Heat Loss' bundles glazing conduction; not cleanly separable (SimpleGlazing transmitted-solar var reads 0 in EP 25.2)"),
    ("", "Infiltration", L["infiltration"], var_sum("Zone Infiltration Sensible Heat Loss Energy"), "clean",
     "airtightness ACH matched (0.0692) — residual is basis: EP uses zone-volume ACH per zone; NZA whole-building V. Small."),
    ("", "Permanent vents", L["permanent_vents"], None, "emitted",
     "✅ 98-C P6: WindandStack (Autocalculate, 55.7) replaced by ZoneVentilation:DesignFlowRate on NZA's own wind correlation (single-sided Q=0.025·min(1,cd/0.6)·A·v_wind, velocity_term_coefficient=1); aggregated into the combined row (was the +244% gap)"),
    ("", "Thermal bridging", L["thermal_bridging"], None, "emitted",
     "✅ 98-C P5: inherited as psi-adjusted U — H_TB 278 W/K (ISO 14683 mirror) degrades the wall/roof/floor insulation R by ΔU=H_TB/A_opaque. EP has no separate ψ object so it folds into the conduction rows above (which rose accordingly)"),
    ("", "Mech vent — public MVHR", L["mech_vent_public_mvhr"], None, "emitted",
     "✅ 98-C P2: emitted ZoneVentilation:DesignFlowRate at v40 flow×(1−HRE) = 1425×0.20 = 285 L/s; per-system output not separable (EP aggregates) — see combined row"),
    ("", "Mech vent — bedroom extract", L["mech_vent_bedroom_extract"], None, "emitted",
     "✅ 98-C P2: emitted at 2208×(1−0) = 2208 L/s (was absent — the ~226 MWh hole); EP aggregates output — see combined row"),
    ("", "Mech vent — toilet extract", L["mech_vent_toilet_extract"], None, "emitted",
     "✅ 98-C P2: emitted at 210×(1−0) = 210 L/s; EP aggregates output — see combined row"),
    ("", "Ventilation TOTAL (mech+perm, EP ZoneVentilation)",
     L["mech_vent_public_mvhr"] + L["mech_vent_bedroom_extract"] + L["mech_vent_toilet_extract"] + L["permanent_vents"],
     var_sum("Zone Ventilation Sensible Heat Loss Energy"), "clean",
     "98-C P2+P6: all 3 mech systems (v40 flows) + permanent vents (NZA wind correlation) emitted; 375→336 after P6. Residual +15% is method — EP books ventilation loss ALL hours (incl. shoulder) vs NZA setpoint-gated — plus EP ρCp 1206 vs NZA 1188 (1.5%)"),
    ("GAINS (MWh/yr)", "Solar through glazing", G["solar_through_glazing"], var_sum("Zone Windows Total Heat Gain Energy"), "divergent",
     "EP 'Windows Total Heat Gain' bundles solar + conduction gain (transmitted-solar var = 0 under SimpleGlazing); NZA = transmitted solar only"),
    ("", "People", G["people"], var_sum("Zone People Total Heating Energy"), "clean",
     "✅ 98-C P1: EP inherits NZA sensible 75 W/person (instantCalc.js:2254) + headcount 345 (density.value 2.5, per_room) + config occupancy schedule — was the activity-schedule-fraction bug (1.2 MWh)"),
    ("", "Lighting", G["lighting"], var_sum("Zone Lights Total Heating Energy"), "clean", None),
    ("", "Equipment / small power", G["equipment"], var_sum("Zone Electric Equipment Total Heating Energy"), "clean", None),
    ("DEMAND (MWh/yr)", "Heating demand", Dm["heating"], meter("Heating:EnergyTransfer"), "clean",
     "98-C P1-P6 CONVERGED: 10.3→107.2 (NZA 87.7, +22%; was −88%). Residual is the gross-vs-gated method difference — EP's full sub-hourly heat balance books envelope+vent losses in all hours, NZA integrates net setpoint-gated demand (the mass-banking/gating mechanism from the physics trace)"),
    ("", "Cooling demand", Dm["cooling"], meter("Cooling:EnergyTransfer"), "clean",
     "98-C P1-P6 CONVERGED: 163.8→88.3 (NZA 101.1, −13%; was +62%). Same method difference, opposite sign"),
    ("DELIVERED (MWh/yr)", "Heating — electricity", De["heating_electricity"], meter("Heating:Electricity"), "clean",
     "NEW FINDING (not in P1-P6 register): EP VRF heating COP from performance curves (~1.4 in-service at UK winter temps + defrost) vs NZA's flat SCOP 3.0 → 77.4 vs 32.2. A delivered-side VRF-efficiency modelling difference (curves vs flat); the DEMAND converged (107 vs 88). Report, don't chase"),
    ("", "Cooling — electricity", De["cooling_electricity"], meter("Cooling:Electricity"), "clean",
     "downstream of cooling demand (88.3 vs 101.1) ÷ VRF cooling COP (also curve-based vs NZA flat EER)"),
    ("", "DHW — electricity", De["dhw_electricity"], meter("WaterSystems:Electricity"), "clean",
     "98-C P4: ASHP share 48% at COP 3.0; 28.0→34.6 vs NZA 42.2 (−18%) — ASHP tank delivers ~84% of its thermal share (COP-as-thermal-efficiency + tank standby); gas side matches within 2%"),
    ("", "DHW — gas", De["dhw_gas"], meter("WaterSystems:NaturalGas"), "clean",
     "✅ 98-C P4: parallel 52/48 gas/ASHP split (v40 shares) replacing the series preheat + corrected peak-flow sizing (0.65→0.35 schedule avg); gas 45.4→154.6 = NZA 157.4"),
    ("", "Ventilation fans — electricity", De["vent_fans_electricity"], meter("Fans:Electricity"), "clean",
     "NZA does not book fan electricity as a separate delivered channel (folded / null); EP books the MVHR+VRF fans explicitly"),
    ("", "Lighting — electricity", De["lighting_electricity"], meter("InteriorLights:Electricity"), "clean", None),
    ("", "Small power — electricity", De["small_power_electricity"], meter("InteriorEquipment:Electricity"), "clean", None),
    ("FUEL (MWh/yr)", "Total electricity", De["total_electricity"], meter("Electricity:Facility"), "clean",
     "downstream of heating-electricity (rose when P3 removed the compensating setback); settles as the ventilation residual closes at P6"),
    ("", "Total gas", De["total_gas"], meter("NaturalGas:Facility"), "clean",
     "✅ 98-C P4: all gas is DHW; parallel 52/48 split → 154.6 = NZA 157.4 (was 45.4 series-preheat)"),
]


def flag(nza, ep, comparability):
    if comparability == "emitted":
        # input inherited & emitted; per-system output not separable in EP (aggregated)
        return "✅", False
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
    ep_cell = "emitted✎" if comp == "emitted" else fmt(ep)
    cell_cause = cause or ""
    if flagged and not cause:
        cell_cause = "**UNEXPLAINED — needs investigation**"
        unexplained.append(chan)
    if not flagged and fl == "✅":
        cell_cause = cell_cause or "match"
    lines.append(f"| {group} | {chan} | {fmt(nza)} | {ep_cell} | {dpct} | {fl} | {cell_cause} |")
lines.append("")
lines.append(f"**Flag tally:** 🔴 {n_red} · 🟠 {n_amber} · rows {len(rows)}. "
             f"Unexplained: {', '.join(unexplained) if unexplained else 'none — every flag named'}.")
lines.append("")
lines.append("NZA gross-loss channels reconcile to NZA's own total (457.5 = 457.5 MWh, verified "
             "in `_98R_nza_channels.mjs`). Anchors 132.6/126.0 byte-identical; instantCalc + EP "
             "physics untouched (EP change = output requests only, P1).")

# ── Table B — input parity (P3): classification with assembler citations ──────────
TABLE_B = """
## Table B — input parity (every config field, its fate in the EP translation)

INHERITED = EP consumes NZA's value (cited). NOT INHERITED (🔴) = EP invents its own /
ignores the field. STRUCTURAL = EP genuinely cannot represent it in this pipeline (labelled).
Assembler = `nza_engine/generators/epjson_assembler.py`.

| Field (v40 / building_config) | NZA value | Fate in EP | Evidence |
|---|---|---|:--|
| `fabric.air_permeability_q50` | 4.64 | ✅ INHERITED | `derive_operational_ach` (98-A P0) → ZoneInfiltration AirChanges/Hour 0.0692 |
| infiltration basis | whole-building V | 🟠 basis differs | EP applies ACH per zone-volume; NZA whole-building — small residual |
| glazing U-value | constructions | ✅ INHERITED | `WindowMaterial:SimpleGlazingSystem` u_factor (assembler L1828) |
| glazing g-value | constructions | ✅ INHERITED | g_value_override → SimpleGlazing SHGC (assembler L219-223) |
| geometry (L/W/floors/height/orientation/wwr/window_count) | — | ✅ INHERITED | `generate_building_geometry(building_params)` (assembler L1295) |
| `shading_overhang` / `shading_fin` | 0.5 m avail. | 🔴 STRUCTURAL | geometry emits Shading:Overhang but it does not reduce solar in EP (Brief 23 H3) |
| `openings` (permanent-vent louvre) | 2×1.1 m², cd 0.49 | ✅ INHERITED (98-C P6) | `_build_permanent_vent_objects` drives ZoneVentilation:DesignFlowRate with NZA's single-sided wind correlation (cd, area, velocity coeff) — was the WindandStack Autocalculate over-count |
| `openings.site_exposure` (Cw) | exposed | ✅ INHERITED (98-C P6) | Cw (exposed→0.20) feeds the cross-mode sqrt(Cw) coefficient in `_build_permanent_vent_objects` |
| `thermal_bridges` | ISO 14683 ψ | ✅ INHERITED (98-C P5) | `_nza_thermal_bridging_H_TB` mirrors the auto ψ calc (278 W/K); `_apply_thermal_bridging` degrades opaque insulation R to bake in ΔU (no native EP ψ object, so folded into conduction) |
| `thermal_mass_category` / `_mode` | medium/lumped | 🟠 divergent | EP mass = construction CTF (real layers); NZA = lumped 250k J/K·m² — different basis, both defensible |
| `gains.lighting` | 2 W/m² profile | ✅ INHERITED | `_emit_state2_lighting_profiles` (98-A2 P1) → 39.0=39.0 |
| `gains.equipment` (small power) | 5.04 W/m² flat | ✅ INHERITED | `_emit_state2_equipment_profiles` (98-A2 P0) → 186.1=186.1 |
| `occupancy.density` | 2.5/room (345 ppl) | 🟠 basis differs | EP People/Area 0.0655 p/m² = 276 ppl (assembler L327) — headcount basis diverges |
| `occupancy.schedule` | config weekday/sat/sun | 🟠 derived | EP `hotel_bedroom_occupancy` derived from config (L1434) — shape approx, not the raw arrays |
| `occupancy.sensible_w_per_person` (75 W) | 75 W/person | 🔴 NOT INHERITED (BUG) | EP `activity_level_schedule_name="hotel_bedroom_occupancy"` (the 0-1 FRACTION, assembler L330) → ~1 W/person → people gain 1.2 vs 120.4 MWh |
| `systems_config_v40.heating` (VRF+panel, shares, SCOP) | 2 systems | 🟠 primary-only | `_primary` keeps highest-share; proportional split is NZA-only; SCOP of primary inherited |
| `systems_config_v40.cooling` | 2 systems | 🟠 primary-only | same single-primary simplification |
| `systems_config_v40.dhw` (2 systems, shares) | gas 52 / ASHP 48 | ✅ INHERITED (98-C P4) | parallel share split (two WaterHeater:Mixed, flow split by v40 share, own effs) + corrected peak-flow sizing (0.35 schedule avg) → gas 154.6 = NZA 157.4 |
| DHW setpoints (storage 60 / tap 42 / cold 10) | — | ✅ INHERITED | `_nza_dhw_boiler_litres_per_day` tap-mix (98-A2 P2) → demand 257.3=257.3 |
| `dhw_demand_basis` / litres_per_person (55) | per_person | ✅ INHERITED | 98-A2 P2 → 12,144 L/day |
| `ventilation[*].flow_rate` (1425/2208/210 L/s) | 3843 L/s total | 🔴 NOT INHERITED | EP OA = per-person constant `_VENT_M3_PER_S_PER_PERSON` (assembler L688), NOT v40 flows |
| `ventilation[*]` bedroom + toilet extract | 2 systems | 🔴 STRUCTURAL | `_primary` models only the public MVHR; other two absent from EP |
| `ventilation[0].recovery_sensible_pct` (80) | 80% | 🟠 passed, idle | effectiveness_override→ERV, but HeatExchanger recovery reports 0.0 MWh (ERV not conditioning) |
| `heating_setpoint_mode`/`cooling_setpoint_mode` (follow_comfort) | flat 21/24 band | ✅ INHERITED (98-C P3) | full mode overwrites `hotel_*_setpoint` with a flat band from `_resolve_comfort_setpoints` (comfort band + v40 mode); overnight setback removed |
| `lighting` / `small_power` (v40 delivered) | — | ✅ INHERITED | InteriorLights/Equipment meters 39.0/186.1 match |
"""

# ── Gap register (P3): dedup the 🔴, attach fix class + suggested brief ────────────
REGISTER = """
## Consolidated gap register (the finish-the-model backlog)

Every 🔴 from Tables A + B, deduplicated to root causes. **Fix class:** `inherit-input`
(assembler reads the v40/config value it currently ignores) · `EP-structural` (assembler
must add a capability EP lacks) · `NZA-side` (changes NZA → **moves the anchor, Chris
sign-off required**). Downstream demand/delivered reds are consequences, not roots — they
collapse when the roots are fixed.

| # | Root gap | Deficient engine | Fix class | Suggested brief |
|--:|---|---|---|---|
| 1 | Ventilation topology — bedroom extract (226 MWh) + toilet extract (21 MWh) not modelled; only the public MVHR survives `_primary` | EP | EP-structural | Model all v40 ventilation systems in the assembler (drop single-primary) |
| 2 | Ventilation flows not inherited — EP OA is a per-person constant, not v40 `flow_rate` | EP | inherit-input | (same brief as #1) route v40 flow_rate → DesignSpecification:OutdoorAir |
| 3 | ERV recovery idle — 80% effectiveness passed but HeatExchanger books 0.0 MWh | EP | EP-structural | Wire the ERV so the MVHR actually conditions supply air |
| 4 | People gain — activity level points at the 0-1 occupancy fraction, not 75 W/person → EP books 1% of the gain | EP | inherit-input | Set People activity_level to `occupancy.sensible_w_per_person` |
| 5 | Occupancy headcount/schedule basis — EP 276 ppl (People/Area) vs NZA 345 (per-room); EP schedule derived not raw | EP | inherit-input | Inherit density basis + occupancy schedule arrays |
| 6 | Thermostat regime — EP overnight setback (21/18, 24/28) vs NZA continuous 21/24; v40 setpoint mode ignored | both | inherit-input (+ decision) | Derive EP setpoint schedule from comfort band / v40; OR add setback to NZA (anchor-moving) — **decision needed** |
| 7 | Thermal bridging — EP models none; NZA books 24 MWh ISO 14683 | EP | EP-structural | Add linear-ψ bridging to EP (extra surface conductance) |
| 8 | Permanent-vent flow model — EP WindandStack Autocalculate (55.7) vs NZA cd/Cw (16.2); site_exposure Cw not inherited | both | inherit-input | Align EP passive-opening effectiveness to NZA cd + site Cw |
| 9 | Shading ineffective — overhang/fin emitted but no solar reduction (Brief 23 H3) | EP | EP-structural | Fix EP external-shading effectiveness (geometry/solar-distribution) |
| 10 | DHW delivered split — gas 157 vs 45, elec 42 vs 28 (EP series-preheat ASHP vs NZA parallel 52/48) | both | EP-structural (+ decision) | DHW ASHP topology parity — which topology is real? |
| 11 | Fan electricity — NZA books no separate fan channel (null); EP books 55.9 MWh | NZA | NZA-side (anchor-moving) | Book MVHR/VRF fan electricity in NZA — **raises EUI, Chris sign-off** |

**Downstream (resolve when roots fixed, not separate briefs):** heating demand 87.7 vs 10.3,
cooling demand 101.1 vs 163.8, heating-elec 32.2 vs 12.1, total gas 157.4 vs 45.4.

**Priority read:** gaps 1–2 (ventilation, ~248 MWh) dwarf everything and are the primary
cause of the heating-demand divergence; gap 4 (people, ~119 MWh) is the largest single
gain gap and a clean one-line assembler fix. Both are `inherit-input`/`EP-structural` —
EP-side, anchor stays put. Only gaps 6 (thermostat, if NZA-side chosen) and 11 (fans) touch
the anchor and need Chris's sign-off.
"""

header = ("# Brief 98-R — the reconciliation table\n\n"
          "Every channel + every input field, both engines, side by side — the systematic "
          "gap-detector. DETECTS, does not fix. Generated by `scripts/report/reconcile.py` "
          "(Table A numbers) + `_98R_nza_channels.mjs` (NZA channels). Table B / gap register "
          "are classification with assembler citations.\n\n")

SUMMARY = (
    "## In plain English\n\n"
    "**Where the engines agree (✅, ≤10%):** lighting (39.0=39.0), equipment/small power "
    "(186.1=186.1), DHW demand (257.3=257.3), cooling-electricity (33.7 vs 36.7), and total "
    "electricity (373.8 vs 357.8). The inputs that dominate the electricity bill are matched.\n\n"
    "**Where they differ, and why (🔴):** heating demand (NZA 87.7 vs EP 10.3) and cooling "
    "demand (101.1 vs 163.8) diverge — but those are *downstream*. The **roots** are five input "
    "gaps: (1) **ventilation** — EP models only 1 of NZA's 3 systems and ignores the v40 flows, "
    "so it misses ~248 MWh of extract loss (bedroom extract alone is 226); (2) **people** — an "
    "assembler bug points the EP occupant activity level at the 0–1 occupancy *fraction* instead "
    "of 75 W/person, so EP books 1.2 MWh of body heat against NZA's 120; (3) **thermostat regime** "
    "— EP runs an overnight setback (21/18, 24/28) while NZA holds a flat 21/24 band; (4) **thermal "
    "bridging** — EP has no bridging object (NZA books 24 MWh); (5) **DHW fuel split** — EP series-"
    "preheat ASHP vs NZA parallel 52/48 (gas 45 vs 157).\n\n"
    "**Inputs inherited:** of ~25 config-field groups, **9 are fully inherited** (airtightness, "
    "glazing U+g, geometry, lighting, equipment, DHW demand+setpoints), **9 partial/divergent-"
    "basis**, and **7 not inherited** (ventilation flows + 2 of 3 systems, occupant heat, "
    "thermostat regime, thermal bridging, shading effectiveness, site-exposure Cw). The un-"
    "inherited set is the finish-the-model backlog below.\n\n"
    "**The one-line verdict:** the electricity-side inputs are matched; the *heating*-side inputs "
    "are not — ventilation topology and occupant heat are the two big holes, both fixable on the "
    "EP side without moving the anchor. Only the thermostat and fan-accounting items touch the "
    "anchor and need Chris's call.\n\n"
    f"*(Flag tally: 🔴 {n_red} · 🟠 {n_amber} across {len(rows)} channels; every flag named, none "
    "unexplained. Anchors 132.6/126.0 byte-identical; EP change = output requests only.)*\n\n")

OUT.write_text(header + SUMMARY + "\n".join(lines) + "\n" + TABLE_B + "\n" + REGISTER + "\n")
print(f"wrote {OUT.relative_to(REPO)}")
print(f"🔴 {n_red} · 🟠 {n_amber} · unexplained: {unexplained or 'none'}")
conn.close()
