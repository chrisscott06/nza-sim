# Brief 26.1: State 1 finalisation — UI parity, parser end-to-end, free-running physics, thermal mass derivation

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read `docs/state_contracts.md` v2.2 — this brief implements contract conformance
4. Read `docs/briefs/archive/26_State_1_envelope_only_COMPLETED.md` for context
5. Read `docs/state_1_divergences.md` for the known limitations baseline
6. Read this ENTIRE brief before writing a single line of code
7. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## VERIFICATION RULES

**Browser verification is mandatory and the bar is higher this time.** Brief 26's automated tests all passed but visual inspection caught four issues that the tests missed. The discipline for this brief: every part must be verified by **opening the Building Heat Balance in a browser, toggling Live ↔ Simulation, and confirming the user sees what the contract specifies**. Screenshots are required. "Test passes" is necessary but not sufficient.

**Contract conformance is the bar.** The State 1 contract specifies output shape, UI rules, and engine agreement. If something works in a script but doesn't appear in the UI, it's not done. If something appears in Live but not Simulation, it's not done.

**Quick fix preferred over thorough debug.** Per Chris's direction: find the simplest fix that satisfies the contract. If the simplest fix doesn't work, escalate before doing a deep investigation. Don't spend hours building diagnostic harnesses when a 30-line patch would solve it.

---

## Context

Brief 26 closed with all 10 parts complete, regression passing, engine agreement script reporting +0.8% silent on heating demand. Visual inspection (12 May, Chris) caught four issues that the automated tests missed:

1. **Simulation view doesn't honour the State 1 contract output shape.** It still shows the old Heat Balance Sankey rows — no comfort band echo, no heating/cooling demand derivation, no free-running temperature stats, no fabric_leakage/permanent_vents split. The Live view shows it correctly; the Simulation view shows something else.

2. **Glazing and Ground floor losses read 0 MWh in the Simulation view** despite Brief 26 Part 6 claiming the parser was fixed. The parser fix may exist in `get_envelope_heat_flow_detailed` but the UI's data path isn't using it, or it's conditional on a mode flag the view isn't passing.

3. **Free-running summer max of 42.4°C is physically implausible.** UK record outdoor temperatures are around 40°C. For an envelope-only model with no internal gains, indoor max should be ~30–34°C on hot days. Cooling demand of 52 MWh (vs contract 5–20 MWh) is downstream of this. Likely cause: sol-air absorption on opaque surfaces isn't dissipating, or thermal mass not coupling to indoor air properly.

4. **Thermal mass is a separate dropdown rather than derived from construction layers.** The Construction Inspector already has layer data (thickness, lambda, density). A standard PIR-cavity wall has computable thermal mass — the dropdown is redundant and can disagree with the physical construction.

The byte-identical regression in Brief 26 Part 9 passed because baseline and absurd-input runs both had the same bug, so they were identical to each other while both being wrong. The regression confirmed isolation but not correctness.

This brief finalises State 1: aligns the UI Simulation view with the contract, confirms the parser fix reaches the UI end-to-end, fixes the free-running physics bug, and replaces the thermal mass dropdown with derivation from construction layers.

After this brief: State 1 is genuinely done — physically correct, contract-compliant, and visually consistent between engines.

6 parts. Do them in order.

---

## PART 0: Diagnostic baseline before changing anything

**File(s):** Read-only investigation.

Before changing any code, document the current state precisely. This gives us a before/after comparison and prevents "we fixed something but introduced something else" surprises.

For Bridgewater on the live development environment, capture:

1. **Screenshots:**
   - Building Heat Balance, Live, Rows view
   - Building Heat Balance, Simulation, Rows view
   - Building Heat Balance, Live, Stacked view
   - Building Heat Balance, Simulation, Stacked view

2. **Numerical baseline** — print the full State 1 output shape for both engines via the existing `state1_engine_agreement.mjs` script. Save as `docs/state_1_baseline_pre_26_1.md`.

3. **UI inspection notes:**
   - What does the Live view show that's part of the State 1 contract?
   - What does the Simulation view fail to show?
   - Where is the comfort band editor in each?
   - Where are the heating/cooling demand rows in each?
   - Where are the free-running temperature stats in each?

4. **Run the parser script in isolation** for envelope-only mode on Bridgewater. Print every key in the returned heat_balance object. Confirm whether `losses.conduction.glazing` and `losses.conduction.ground_floor` are non-zero. If they are non-zero in the script but zero in the UI, the bug is between the parser and the UI — not in the parser itself.

5. **Print the hourly free-running zone temperature for one peak summer hour** (e.g., 2026-07-21 14:00). Document the energy balance components: solar incident per façade, conduction in/out per element, ventilation flows. This baseline will help diagnose Part 3 (summer max bug).

**Commit message:** "Part 0: Baseline diagnostic for State 1 UI walkthrough findings"

**Verify:**
1. Baseline document committed to `docs/state_1_baseline_pre_26_1.md`
2. Four screenshots captured
3. Parser script output captured
4. Peak summer hour energy balance captured
5. Report: "Baseline captured. Live view shows [N] State 1 contract elements; Simulation view shows [M] of [N]. Parser direct output for glazing: [X] MWh; UI Simulation view shows: [Y] MWh. Gap identified between parser and UI: [yes/no]. Peak summer hour 2026-07-21 14:00: indoor T [Z]°C, outdoor T [W]°C, solar [components], conduction [components], ventilation [components]. Suspected cause of 42.4°C summer max: [hypothesis]."

---

## PART 1: Construction library audit for thermal mass derivation

**File(s):** Read-only investigation of `frontend/src/data/constructions.js` (or wherever the construction library lives) and any backend equivalent.

Before deciding whether thermal mass can be derived from construction layers, audit the library to confirm every construction has the data needed for the calculation.

For thermal mass derivation we need, per layer:
- Thickness (mm or m) — almost certainly present
- Density (kg/m³)
- Specific heat capacity (J/kg·K or kJ/kg·K)

If density and specific heat capacity are present for every layer in every construction, derivation is feasible. If they're missing for some constructions, the brief needs to either:
- Populate the missing data first
- Fall back to the dropdown for those constructions

**For each construction in the library:**
1. List the construction name
2. List every layer
3. Confirm presence of density and specific heat capacity per layer
4. Flag any missing data

**Decision point at end of Part 1:**

If the library is complete enough (≥80% of constructions have full data), proceed to Part 5 (thermal mass derivation) as planned.

If the library has substantial gaps, defer Part 5 to a separate brief that first populates the library, and replace Part 5 in this brief with: "Thermal mass dropdown placed in Building module Fabric section per Brief 26 Part 7's original scope, until library is populated."

**Commit message:** "Part 1: Construction library audit — thermal mass derivation feasibility"

**Verify:**
1. Library audit document committed to `docs/state_1_construction_library_audit.md`
2. Per-construction layer data inventory
3. Decision documented: "Library complete enough for derivation: [yes/no]. Constructions missing data: [count]. Decision: [proceed with Part 5 as planned / replace Part 5 with dropdown placement]."
4. Report: "Library audit complete. [N] constructions, [M] have full density+specific heat data. Derivation feasible: [yes/no]. Part 5 plan: [proceed / fall back to dropdown]."

---

## PART 2: Heat Balance Simulation view honours State 1 contract

**File(s):** `frontend/src/components/modules/balance/HeatBalance.jsx`, related sub-components

The Live view in the screenshot shows the full State 1 contract output: badge, comfort band editor, demand rows, comfort hours bar, annual mean, summer max, fabric_leakage/permanent_vents split, solar by orientation.

The Simulation view shows the old Heat Balance shape: just gain/loss rows without the State 1 specific elements.

**Both views must render identically when `mode='envelope-only'`.** The only difference between Live and Simulation should be the underlying data source. The component, layout, demand rows, badges, and labels are the same.

Implementation approach:

The HeatBalance component should:
1. Accept the same shape from either engine (`heat_balance` object matching the contract State 1 output)
2. Render based on the shape, not based on which engine produced it
3. Show all State 1 elements regardless of source

Likely root cause: the Simulation data path is returning the older heat_balance shape (without `demand`, `free_running`, `losses.ventilation.fabric_leakage`, `losses.ventilation.permanent_vents` etc.) and the component falls back to old rendering when those keys are missing.

Two ways to fix:
- **Option A:** Make the Simulation parser emit the State 1 contract shape (preferred — fixes the root cause)
- **Option B:** Make the HeatBalance component compute the missing fields client-side from raw EP outputs

Prefer Option A. The parser already exists (`_get_heat_balance_state1` per Part 6) — if it's emitting the contract shape, the Simulation view should get it too. Trace the data path from `/balance?mode=envelope-only` endpoint through to the component and find where the State 1 shape is being lost or downcast.

**Acceptance criteria:**
- Toggle to Simulation view in Building Heat Balance
- Confirm: Envelope-only badge visible
- Confirm: Comfort band editor visible and matches Live
- Confirm: Heating demand row with "below 21°C — derived" annotation visible
- Confirm: Cooling demand row with "above 25°C — derived" annotation visible
- Confirm: Comfort hours bar visible with Under/In/Over split
- Confirm: Annual mean and summer max temperatures visible
- Confirm: Loss rows show fabric_leakage and permanent_vents as distinct items (not "Infiltration" and "Openings — louvres")
- Confirm: Glazing loss is non-zero (will be confirmed in Part 4 if not already working)

**Commit message:** "Part 2: Heat Balance Simulation view renders State 1 contract output"

**Verify:**
1. Screenshot of Simulation view in Rows mode
2. Screenshot of Simulation view in Stacked mode
3. Visual diff vs Live view — both should show the same UI structure
4. Engine agreement script still passes (regression)
5. Report: "Simulation view now renders State 1 contract output. Comfort band: [shown ✓ / not shown ✗]. Demand rows: [shown ✓ / not shown ✗]. Comfort hours: [shown ✓ / not shown ✗]. Annual mean: [shown ✓ / not shown ✗]. Summer max: [shown ✓ / not shown ✗]. Ventilation split: [shown ✓ / not shown ✗]. Visual parity with Live view: [achieved ✓ / N differences ✗]."

---

## PART 3: Free-running summer max physics fix

**File(s):** Likely `frontend/src/utils/instantCalc.js` (`_calculateEnvelopeOnly`), possibly `nza_engine/parsers/sql_parser.py` if the bug is in post-processing.

Summer max of 42.4°C for an envelope-only model is physically wrong. Quick fix approach:

**Hypotheses, in order of likelihood:**

**H1: Sol-air absorption on opaque surfaces is being added to indoor temperature without a release path.**
If walls and roof receive solar absorption (sol-air temperature elevated above outdoor), and conduction inward is computed from sol-air to indoor, but conduction outward at night isn't symmetric, heat accumulates. Quick check: in the peak summer hour energy balance from Part 0, is solar absorption on opaque surfaces showing as gain without corresponding loss elsewhere?

**H2: Thermal mass is not coupling to indoor air at all.**
If the lumped-capacitance model has thermal mass but the heat exchange between indoor air and mass uses a coefficient that's too low (or zero), the mass doesn't damp the swings — indoor air responds instantly to solar gains. Quick check: what's the air-to-mass coupling coefficient in the live engine? CIBSE Guide A suggests 6 W/m²K. If it's effectively zero or missing, mass isn't doing anything.

**H3: Ventilation is being under-applied.**
If permanent vents and fabric leakage are computed but not applied to the energy balance in summer (e.g., conditional on heating-season), the building can't dump heat. Quick check: is ventilation flow being applied year-round?

**H4: Solar gain through glazing is being applied to indoor air directly without thermal mass absorption.**
If solar through glazing instantly heats indoor air (rather than being absorbed by floor/walls and re-radiated with delay), peak temperatures will be unrealistically high. Quick check: where does Q_solar go in the energy balance — directly to T_air or to T_mass?

**Approach: test each hypothesis with a minimal code probe, fix the most likely.**

For each hypothesis, print the relevant intermediate quantities for the peak summer hour identified in Part 0. The fix should bring summer max into 30–34°C range for Bridgewater envelope-only.

**Acceptance criteria:**
- Free-running summer max ≤ 36°C for Bridgewater (envelope-only, no occupancy, no systems)
- Cooling demand within contract range (5–20 MWh)
- Free-running winter min unchanged (1–4°C range — building genuinely does drop near freezing without heating)
- Live and Simulation agreement on summer max within ±2°C

If quick fix doesn't bring summer max under 36°C within 30 lines of patches, **stop and document findings**. Don't escalate to thorough debug in this brief — flag as needing its own brief.

**Commit message:** "Part 3: Free-running summer max physics fix"

**Verify:**
1. Print the energy balance for the same peak summer hour as Part 0 — show the before/after of the relevant intermediate quantities
2. Free-running summer max: [X]°C (target ≤36°C)
3. Cooling demand: [Y] MWh (target 5–20 MWh)
4. Live vs Simulation agreement on summer max: [Z]°C delta
5. Document the root cause and the fix
6. Report: "Free-running physics fix landed. Root cause: [H1/H2/H3/H4/other]. Fix: [description]. Bridgewater summer max: 42.4°C → [X]°C. Cooling demand: 52 MWh → [Y] MWh. Live/Sim agreement: [Z]°C delta. Contract bounds: [met ✓ / escalation needed ✗]."

---

## PART 4: Parser fix end-to-end through the UI

**File(s):** `nza_engine/parsers/sql_parser.py`, API endpoint, and the UI data fetch path.

Part 0's diagnostic establishes whether the parser is correctly returning non-zero glazing and ground floor losses. Three possibilities:

**Case A: Parser returns 0 for glazing/floor.** The Brief 26 Part 6 fix didn't actually work or has a regression. Fix the parser to read these surface types correctly. The likely issue: window conduction surfaces in `eplusout.sql` are tagged differently than opaque walls, and the parser is filtering them out. Look at `Surface Window Heat Loss Energy` or equivalent variables.

**Case B: Parser returns non-zero but UI shows 0.** There's a missing wire between parser and view — the data is fetched but not displayed, or it's displayed in a field the UI doesn't read. Trace from `/balance?mode=envelope-only` endpoint response through to the HeatBalance component and find where glazing/floor are dropped.

**Case C: Parser returns non-zero AND UI shows non-zero after Part 2 fix.** Already resolved by Part 2. Confirm and skip to verification.

The Part 0 diagnostic determines which case applies.

**Acceptance criteria:**
- Bridgewater Simulation view shows non-zero glazing loss (expected order: 30–80 MWh for ~250 m² of U=1.43 W/m²K glazing in UK climate)
- Bridgewater Simulation view shows non-zero ground floor loss (expected order: 5–15 MWh)
- Engine agreement script shows Live and Simulation within 15% on glazing (allow some divergence due to EP using sol-air vs live using air temperature)
- Engine agreement script shows Live and Simulation within 15% on ground floor

**Commit message:** "Part 4: Parser fix verified end-to-end through UI for glazing and ground floor"

**Verify:**
1. Screenshot of Simulation view showing non-zero glazing and ground floor losses
2. Engine agreement script output showing per-line-item comparison
3. Report: "Parser fix verified end-to-end. Case identified: [A/B/C]. Bridgewater Simulation: glazing [X] MWh, ground floor [Y] MWh. Engine agreement on glazing: [Z]%, ground floor: [W]%. Contract conformance: [yes / no with explanation]."

---

## PART 5: Thermal mass derivation from construction layers

**File(s):** `frontend/src/utils/instantCalc.js`, `frontend/src/data/constructions.js` (or library location), `frontend/src/components/modules/building/Fabric.jsx`

**This part is conditional on Part 1's library audit.** Two paths:

**Path A (library complete enough):** Implement derivation.

The effective indoor-facing thermal mass of a construction is the sum of (thickness × density × specific heat) for every layer **inside the insulation**. Layers outside the principal insulation layer don't contribute meaningfully to indoor thermal response.

Algorithm:
1. For each construction, identify the insulation layer (highest R-value layer in the stack, or layer with λ < 0.05 W/mK)
2. Sum the thermal mass of layers inside that insulation (closer to indoor face)
3. Express as kJ/m²·K

For Bridgewater's cavity wall (Brick / PIR / Block / Plasterboard):
- Brick is outside the insulation → doesn't count
- PIR is the insulation → doesn't count
- Block (100mm × 1400 kg/m³ × 1 kJ/kg·K = 140 kJ/m²·K) → counts
- Plasterboard (13mm × 900 kg/m³ × 1 kJ/kg·K = 12 kJ/m²·K) → counts
- Total: 152 kJ/m²·K → Medium mass per CIBSE TM52

**UI changes:**
- The standalone "Thermal mass" dropdown is removed from the Building module Fabric section
- Each construction in the Construction Inspector now displays its derived thermal mass: "Effective indoor mass: 152 kJ/m²·K (Medium)"
- A building-level "Thermal mass mode" control offers: "Auto (derived from constructions)" / "Override: Light / Medium / Heavy / Custom"
- Auto is default. Shows the area-weighted average of construction masses
- Override allows the user to ignore derivation (for sensitivity studies or mixed-construction approximations)

**Live engine integration:**
- `_calculateEnvelopeOnly` reads the derived mass from `building_config` (already populated)
- The mass value is one number (kJ/m²·K) regardless of source — derivation vs override doesn't change the calc, only the display

**Path B (library has gaps):** Keep dropdown, place properly in UI.

If Part 1 found the library is incomplete, place the thermal mass dropdown in the Building module Fabric section between Construction selectors and Airtightness, per Brief 26 Part 7's original scope. Document the library gaps for a future brief to populate.

**Acceptance criteria (Path A):**
- Construction Inspector shows derived thermal mass per construction
- Building-level Auto/Override control visible in Fabric section
- Auto mode by default, derived value shown
- Override mode lets user pick Light/Medium/Heavy/Custom
- Live engine produces same numerical result for the same effective mass regardless of source
- Smoke test: changing constructions from Light (e.g., metal-frame) to Heavy (e.g., solid masonry) shifts the live engine free-running temperature appropriately

**Acceptance criteria (Path B):**
- Thermal mass dropdown placed in Fabric section between constructions and airtightness
- Selection persists, reaches live engine, affects free-running temperature
- Library gaps documented in a follow-up brief stub

**Commit message:** "Part 5: Thermal mass derivation from constructions (Path A)" or "Part 5: Thermal mass dropdown UI placement (Path B)"

**Verify:**
1. Screenshot of Construction Inspector showing derived mass
2. Screenshot of Building module Fabric section showing Auto/Override control
3. Bridgewater's derived thermal mass: [X] kJ/m²·K
4. Smoke test: change a construction, confirm derived mass updates, confirm live engine free-running temperature responds
5. Report: "Thermal mass derivation working (Path A) or dropdown placed (Path B). Bridgewater derived mass: [X] kJ/m²·K. Construction Inspector shows per-construction mass. Building-level Auto/Override control in place. Smoke test passed: [yes/no]."

---

## PART 6: End-to-end verification on Bridgewater

Final integration test.

Walk through Bridgewater in the browser:

1. Open Building module
2. Confirm: 3D Model tab shows façades correctly labelled, building rotates at 42° orientation
3. Confirm: Heat Balance tab shows "Envelope only — no occupancy, no systems, no operable windows" badge
4. Confirm: Comfort band editor visible at 21°C / 25°C, editable inline
5. **Switch to Live view, Rows layout:**
   - Solar gains by orientation, F3 (SW) dominant ✓
   - Conduction losses by element (wall, roof, floor, glazing) all non-zero ✓
   - Ventilation split: Fabric leakage + Permanent vents as distinct items ✓
   - Heating demand row "below 21°C — derived" ✓
   - Cooling demand row "above 25°C — derived" ✓
   - Comfort hours bar with Under/In/Over split ✓
   - Annual mean and Summer max stats visible ✓
   - Summer max ≤ 36°C ✓
6. **Switch to Simulation view, Rows layout:**
   - Identical UI structure to Live ✓
   - Comfort band echo visible ✓
   - Demand rows visible ✓
   - Glazing and ground floor losses non-zero ✓
   - Ventilation split visible ✓
   - Free-running stats visible ✓
7. **Switch to Stacked layout:** both Live and Simulation render correctly
8. **Switch to Sankey layout:** both Live and Simulation render correctly
9. **Engine agreement:** Live and Simulation values within tolerance, no hard warnings on contract-significant outputs
10. **Adjust comfort band to 19/27:** confirm Live demand updates instantly, Simulation needs re-run, both behave correctly
11. **Open Fabric section in left panel:**
    - Constructions visible
    - Derived thermal mass shown per construction (Path A) or dropdown present (Path B)
12. **Critical regression:** open `/operation` in a separate tab, tick aggressive operable window schedule, save. Return to Building Heat Balance. State 1 numbers must be unchanged in both Live and Simulation.

**Expected Bridgewater State 1 numbers after fixes:**
- Heating demand: 150–250 MWh ✓ (contract v2.2)
- Cooling demand: 5–20 MWh ✓
- Overheating hours: 200–600
- Underheating hours: 4500–6500
- Summer max temperature: ≤ 36°C ✓
- Winter min temperature: 1–4°C
- Engine agreement: Live and Simulation within tolerance per contract

**Commit message:** "Part 6: State 1 finalisation verified end-to-end on Bridgewater"

**Verify — final report:**

| Item | Status |
|------|--------|
| Simulation view honours State 1 contract | ✓/✗ |
| Comfort band editor visible in both Live and Simulation | ✓/✗ |
| Demand rows in both Live and Simulation | ✓/✗ |
| Glazing loss non-zero in Simulation | ✓/✗ |
| Ground floor loss non-zero in Simulation | ✓/✗ |
| Ventilation split (fabric_leakage + permanent_vents) in Simulation | ✓/✗ |
| Free-running summer max ≤ 36°C | ✓/✗ |
| Cooling demand 5–20 MWh | ✓/✗ |
| Thermal mass derivation from constructions (or dropdown placement) | ✓/✗ |
| Engine agreement maintained — no new hard warnings | ✓/✗ |
| State isolation regression still passes (45/45 scenarios) | ✓/✗ |

If any item is ✗, document what was attempted and what blocked. Don't claim completion if anything is outstanding.

---

## After all parts complete

Update STATUS.md:

- Brief 26.1 closed with the four issues resolved (or documented as needing future briefs)
- Free-running physics root cause documented in `state_1_divergences.md`
- Thermal mass derivation methodology documented (if Path A)
- Bridgewater State 1 numbers updated to post-fix values

Update the state contract document if needed:
- v2.3 if any contract details changed (comfort band UI placement, etc.)
- Otherwise v2.2 stands

Archive this brief to `docs/briefs/archive/26_1_State_1_finalisation_COMPLETED.md`.

Point `current.md` at Brief 27 (Systems Inspectors).

Tell Chris:

> Brief 26.1 complete. State 1 now end-to-end through the UI, both engines render the contract output shape. Free-running summer max bug fixed (root cause: [X]) — Bridgewater now shows summer max [Y]°C, cooling demand [Z] MWh, both within contract bounds. Glazing and ground floor losses verified non-zero in Simulation view ([A] MWh and [B] MWh respectively). Thermal mass derivation from constructions implemented (Path A) / dropdown placed (Path B) — Bridgewater derived mass [C] kJ/m²·K. State isolation regression unchanged at 45/45. Engine agreement on heating demand: [D]% (vs +0.8% pre-fix). Ready for Brief 27.

Push to GitHub. Confirm push succeeded.
