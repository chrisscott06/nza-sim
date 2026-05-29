# Brief 66 — Overnight Integration Walkthrough

**Status:** active, autonomous overnight execution
**Lands at:** `docs/briefs/active/66_overnight_integration_walkthrough.md`
**Mode:** READ-ONLY + UI-driven project creation. **LOG ISSUES, DO NOT FIX THEM.**
**Estimated duration:** 6-10 hours autonomous execution
**Output:** ONE markdown report at `docs/audit/66_walkthrough_report.md`

---

## BEFORE DOING ANYTHING

1. Quote this brief's title and first paragraph back as your first action.
2. Confirm: **you will log issues, you will not fix them.** No engine edits. No UI edits. No commits to engine code. The only file you create is the report.
3. Read CLAUDE.md, STATUS.md, the Notion diagnostics note (page ID `367d645e-05cc-81af-93d7-fc57bfc45faf`) — particularly the headline finding "engine computes heat balance, not demand" so you understand which class of issue to flag-and-skip vs which to investigate.
4. Confirm clean working tree. If you ARE going to need to flip a config in code temporarily (e.g. to test something), do it on a local branch and revert before report.
5. Start the isolated verification stack: `nza_sim_cc.db`, backend :8003, frontend :5178.

---

## GOVERNING PRINCIPLES

1. **You are testing the model end-to-end as a user would experience it.** Create a project from scratch through the UI. Click every control. Read every number on every screen. Hand-calc each major output against engine output.
2. **LOG, DO NOT FIX.** Every issue goes in the report. Every issue. Including things that "look small." Including things you're tempted to silently work around. **Especially** those. If you fix something the downstream numbers change and the rest of the walkthrough becomes invalid.
3. **The "demand vs balance" architectural issue is KNOWN.** When you find that cooling demand responds to heating setpoint changes, or vice versa, log it as "demand-vs-balance interaction confirmed at module X" and move on. Do NOT investigate further. We know.
4. **Work module-by-module with explicit checkpoints.** Don't run end-to-end first and check at the end. Check at every transition: after geometry, after fabric, after gains, after systems, after interventions.
5. **Hand-calc reference values are the truth.** This brief specifies the reference values. Code is not the truth source. If the engine disagrees with the hand-calc by >10%, that's a finding — log it.
6. **If uncertain, log and continue. Do not ask. Do not stop.** This runs overnight. Block on nothing.
7. **The model uses Bristol EPW weather** (already in the engine). Use a different test building from Bridgewater — see §1.

---

## §1 — TEST BUILDING SPEC

**Build this exact building. Do not deviate. Hand-calc references depend on these numbers.**

- **Type:** Small office, 2-storey
- **Geometry:** 30m × 20m footprint × 2 floors × 3.5m floor-to-floor = 600 m² × 2 = **1200 m² GIA**
- **Volume:** 600 × 7 = 4200 m³
- **WWR:** 0.30 on all four facades (uniform)
- **Orientation:** Long axis east-west (south facade = 30 × 7 = 210 m² façade, glazing 63 m²)
- **U-values:**
  - Walls: 0.25 W/m²K
  - Roof: 0.18 W/m²K
  - Floor: 0.20 W/m²K
  - Glazing: 1.4 W/m²K (g-value 0.40, light transmission 0.70)
- **Infiltration:** 0.5 ACH
- **Setpoints:** heating 21°C, cooling 24°C (start with active_setpoint clamp)
- **Occupancy:** 60 people (5 m²/person), office profile, 09:00-18:00 weekdays
- **Lighting:** 8 W/m² installed, daylight dimming control selected
- **Equipment:** 12 W/m² installed, office profile
- **DHW:** per_m2 basis, 0.3 L/m²/day (light office use), default temps
- **Ventilation:** single MVHR system, 10 L/s/person × 60 = 600 L/s, HRE 80%, SFP 1.5 W/(L/s), no bypass
- **Heating system:** gas boiler 92% efficiency
- **Cooling system:** electric chiller SEER 4.0
- **Carbon factors:** as-is (note in report which path is being read)

---

## §2 — MODULE-BY-MODULE WALKTHROUGH

For each module, do this sequence:
1. Click into the module in the UI.
2. Enter the inputs from §1.
3. Take a screenshot if anything looks odd.
4. Compare the displayed numbers against the hand-calc reference values in §3.
5. Note every divergence ≥10% as a finding.
6. Note every display where the label is ambiguous or the unit isn't clear.
7. Note every control that doesn't exist where you'd expect it to (e.g. the DHW load-shape toggle that we know is missing).
8. Move to next module. **Do not go back to fix.**

### Module checkpoints (in order):

- **A. Project Creation.** Does the "new project" flow work? Are default values sensible? Do you get to a usable empty project?
- **B. Geometry & Fabric.** Enter §1 geometry and U-values. Read back GIA, total UA, breakdown by element. Compare to §3 hand-calcs.
- **C. Envelope (State 1).** Read free-running cooling and heating demand. This is fabric+solar only, no gains. Compare to §3.
- **D. Internal Gains (State 2).** Enter occupancy, lighting, equipment. Read gain totals (annual kWh) per category. Compare to §3.
- **E. Systems (State 3).** Enter heating/cooling/DHW/ventilation systems. Read delivered energy, fuel split, EUI, carbon. Compare to §3.
- **F. Interventions.** Create 3 interventions: (1) walls 0.25 → 0.15 U-value, (2) MVHR SFP 1.5 → 0.8, (3) cooling setpoint 24 → 26. For each, read the calc trail / breakdown panel. Verify Δ values match (after − before). Look for the "+714 unit mismatch" class of bug.
- **G. Reports / EUI breakdown.** Whatever final summary screens exist. Do the numbers across all summary screens match each other? (consumption.total, EUI panel, headline KPI, etc.)

### What to record per module:

For each module, in the report:
- **Inputs entered:** what you typed.
- **Outputs read:** what the screen shows, with the exact label and unit.
- **Hand-calc reference:** the value from §3.
- **Δ engine vs hand-calc:** number and percentage.
- **Findings:** anything weird, ambiguous, missing, or contradictory.
- **Screenshots taken:** filenames if any.

---

## §3 — HAND-CALC REFERENCE VALUES

These are the truth. Match the engine against these.

### Fabric UA totals
- Wall area (gross): 2 × (30 + 20) × 7 = **700 m²**. Glazing 30%: **210 m² glazing, 490 m² opaque wall**.
- Roof: 30 × 20 = **600 m²**
- Floor: 30 × 20 = **600 m²**
- Wall UA: 490 × 0.25 = **122.5 W/K**
- Roof UA: 600 × 0.18 = **108 W/K**
- Floor UA: 600 × 0.20 = **120 W/K**
- Glazing UA: 210 × 1.4 = **294 W/K**
- Infiltration: 0.5 ACH × 4200 m³ × 1.2 × 1005 / 3600 = **702 W/K** (heat capacity of moving air)
- **Total UA: ~1346 W/K**

### Peak heating load (cold winter day)
- Outside: -3°C, Inside: 21°C, ΔT = 24°C
- Peak fabric+infil loss: 1346 × 24 = **32.3 kW**
- Ventilation: 600 L/s × 1.2 × 1005 × (1−0.8) × 24 / 1000 = **3.5 kW** (with MVHR HRE 80%)
- **Total peak heating: ~36 kW** (no internal gains accounted for in peak)

### Peak cooling load (hot summer day)
- Outside: 28°C, Inside: 24°C, ΔT = 4°C
- Fabric: 1346 × 4 = **5.4 kW** (net into zone via fabric+infil)
- Solar through glazing peak: 210 × 0.40 × ~400 W/m² average peak (mixed facades) = **34 kW**
- Internal gains (peak afternoon, 60 people × 100 W + lights 8 W/m² × 0.7 dim × 1200 + equip 12 × 0.6 × 1200) = 6 + 6.7 + 8.6 = **~21 kW**
- Ventilation: 600 × 1.2 × 1005 × 4 / 1000 = 2.9 kW (no bypass, just delivery)
- **Total peak cooling: ~63 kW**

### Annual envelope (State 1, no gains, free-running)
- Heating degree hours base 21°C Bristol: roughly 80,000 K·hr/yr
- Annual fabric+infil heating loss: 1346 × 80000 / 1000 = **~108 MWh** (envelope-only, no gains)
- Annual cooling: free-running envelope-only, mostly from solar through glazing. Roughly **2-5 MWh** (small without internal gains).

### Annual internal gains (State 2 additions)
- Occupancy: 60 people × 100 W × 2200 hours (office hours) = **13.2 MWh/yr**
- Lighting: 8 W/m² × 1200 × 2200 × 0.7 (daylight dim) = **14.8 MWh/yr**
- Equipment: 12 W/m² × 1200 × 2200 × 0.6 (diversity) = **19.0 MWh/yr**
- **Total internal gains: ~47 MWh/yr**

### Annual demand (State 3 / Systems)
- Heating demand after gains offset: 108 − partial(47) − solar_offset ≈ **50-70 MWh/yr** (rough — engine should produce in this range)
- Cooling demand: depends heavily on clamp behaviour. Order of magnitude **10-25 MWh/yr** for this geometry at c_sp=24.
- DHW: 1200 × 0.3 × 365 × (40-10) × 4.18 / 3600 = **4.6 MWh/yr** thermal demand
- Fan electricity: 600 × 1.5 × 8760 / 1000 = **7.9 MWh/yr** elec
- Lighting elec ≈ 14.8 MWh/yr (same as gain — 1:1 at control_factor 0.7 × installed)
- Equipment elec ≈ 19.0 MWh/yr (same as gain)
- **Total source energy rough order: ~110-140 MWh/yr**
- **EUI: ~90-120 kWh/m²/yr**

### Cooling setpoint sweep (c_sp 28→16, all else fixed)
- Cooling demand at c_sp=28: very low, maybe 2-5 MWh
- Cooling demand at c_sp=24: 10-25 MWh
- Cooling demand at c_sp=20: 30-50 MWh
- Cooling demand at c_sp=18: 50-80 MWh
- Cooling demand at c_sp=16: 80-120 MWh
- **If engine produces a flat curve (e.g. 24 vs 18 differs by <30%), flag as finding.**

### Heating setpoint sweep (h_sp 19→23, all else fixed at c_sp=24)
- Heating demand should vary monotonically and substantially.
- **Cooling demand should NOT vary significantly across heating setpoint changes** — if it does, this is the demand-vs-balance issue. Note it as confirmed at the relevant heating-sp values, then move on.

---

## §4 — INTERVENTION TESTING

After Module F (interventions created), test each one:

For each intervention:
1. Confirm baseline numbers match the State 3 numbers from Module E.
2. Read the "after" numbers.
3. Read the Δ values shown on the calc trail / breakdown panel.
4. **Verify: Δ = after − baseline, exactly. Same units. Same source field.** This is the +714 unit mismatch check.
5. Verify the Δ direction makes physical sense (wall U-value improvement → heating demand drops; SFP improvement → fan electricity drops; cooling setpoint raised → cooling demand drops).
6. Verify parts-sum-to-totals on the breakdown panel.

If ANY of these fail, log specific:
- File:line of the failure if you can identify it.
- The exact numbers on screen.
- Whether it's the engine producing a wrong number or the display reading a wrong source.

---

## §5 — CROSS-CONSISTENCY CHECKS

These are the "every number must stack up" checks. Run these after all modules complete:

1. **Same metric in two places matches.** Find every place "cooling demand" appears in the UI. List them all with values. Confirm they agree (or document which read different sources).
2. **consumption.total = sum of services.** consumption.total.electricity_mwh should equal heating elec + cooling elec + DHW elec + fan elec + lighting + equipment. Same for gas. Show the sum.
3. **Carbon factor consistency.** What electricity carbon factor is the headline carbon KPI using? Is it 0.207, 0.193, or 0.145? Quote the source.
4. **Toggle consistency for the U4 bug class (KNOWN BUG — verify it's still present).** 
   - **U4 specifically:** With baseline running, note `consumption.brief40.ventilation.total_fan_electrical_mwh` value and the headline electricity kWh on the UI. Disable the ventilation system(s) via the UI toggle. Confirm mech-vent heat loss in State 2 goes to zero (this part works). Then confirm fan electricity ALSO goes to zero. Last session it did NOT — fan electricity stayed at ~39,415 kWh on Bridgewater despite vent disabled. Verify this bug is still present, quote the residual fan kWh value, and confirm it propagates into headline electricity totals.
   - Then repeat for: disable each lighting system → does lighting electricity go to zero? Disable equipment/small_power → does its electricity go to zero? Disable each heating system → does heating delivered + fuel go to zero? Same for cooling and DHW.
   - List every service where disabling the system does NOT zero the corresponding electricity/fuel/delivered downstream. These are the bug class.
5. **DHW load shape.** Confirm the toggle is not visible in the UI (we expect this — Brief 58 wiring gap). If it IS visible, document where. Edit the DB directly to set `dhw_load_shape: 'follow_occupancy'`, reload, confirm DHW hourly shape changes in the calc.
6. **Hidden assumption verification.** For each item in the hidden assumptions register v3 §B (Shipping Bugs), confirm the bug is present:
   - B1: which electricity carbon factor is each panel using?
   - U1: create an intervention that adds external shading (shading factor 0.1 if the UI supports it). Does the engine apply 0.1, or does it floor at 0.4? Document.
   - U2: doesn't need user test, just read EPW year and confirm what day Jan 1 lands on.

---

## §6 — REPORT STRUCTURE

Write the report at `docs/audit/66_walkthrough_report.md` with this structure:

```
# Brief 66 Walkthrough Report — [date]

## Executive Summary
- Total findings: N
- Critical (engine/shipping): N
- High (display/wiring): N
- Medium (UX/labels): N
- Low (cosmetic): N
- Engine vs hand-calc agreement: roughly within X%
- Demand-vs-balance issue: confirmed at modules [list]

## Module-by-module findings
### Module A: Project Creation
[findings]
### Module B: Geometry & Fabric
[hand-calc vs engine table]
[findings]
...etc

## Cross-consistency check results
[§5 results]

## Hidden assumption verifications
[§5.6 results, per register row]

## Intervention testing
[per intervention, hand-calc vs engine, Δ verification]

## Issues NOT investigated (per brief rules)
- Demand-vs-balance interactions (known, logged not investigated)
- Any other "log and skip" items

## Recommended priority order for fixes
[Code's read of which findings are shipping-critical vs queue-able]
```

Keep the report **dense and factual**. No prose padding. Tables and bullets. Every finding with file:line if you can identify it. Every number with units and source field.

---

## §7 — WHAT MUST NOT HAPPEN

- No engine edits.
- No UI edits.
- No commits to engine or frontend code beyond a (local, reverted) experimental branch if absolutely needed.
- No "I'll just fix this small thing while I'm here." NO.
- No skipping modules. If a module is broken and you can't enter the inputs, log it as a critical finding and use sensible defaults to continue to the next module.
- No asking. No stopping for clarification. If uncertain, log the uncertainty and continue.
- No deviation from the §1 building spec. If a UI field doesn't accept a §1 value, log it and use the closest possible.
- No investigation of the demand-vs-balance issue. It is known. Log instances; do not chase.

---

## §8 — IF YOU GET STUCK

If you genuinely cannot proceed (e.g. project save fails entirely, dev server crashes):
1. Restart the relevant service.
2. If still stuck, log the failure as a critical finding with reproduction steps.
3. Skip to the next module that can be tested independently.
4. Do not stop the walkthrough.

The walkthrough's value is breadth-of-coverage. A partial walkthrough covering 5 modules with findings is much more useful than a perfect walkthrough of 2 modules.

---

## §9 — FINAL REPORT REQUIREMENTS

- File: `docs/audit/66_walkthrough_report.md`
- One commit creating the report file. No other commits.
- The commit message: "Brief 66: overnight walkthrough findings — N issues logged"
- Status line in the report: "WALKTHROUGH COMPLETE: [date] [time], [N] findings logged, no engine changes"
- Do not mark this brief as "complete" — Chris reads the report and triages.

---

## Closing note

This is the first time we've run an autonomous end-to-end test of the model as a user would experience it. We expect to find a lot — display bugs, missing controls, wrong-source reads, unit mismatches, intervention errors. That's the point. Every finding is one fewer surprise Chris hits in a client demo. Be exhaustive. Be specific. Log everything.
