# Brief 11: Fix Solar Gains Units Mismatch & Calculation Verification

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read this ENTIRE brief before writing a single line of code
4. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## VERIFICATION RULES

**Browser verification is mandatory.** Take screenshots, report actual numbers, check console for errors.

---

## Context

A critical units bug was discovered in the instant calc: `solar_gains` values are computed in MWh but `total_internal` gains are in kWh. This means solar is 1000x underweighted in the heating balance, so orientation changes don't affect the EUI. The butterfly chart displays correct MWh values (it reads from `gains_losses`), but the core heating/cooling demand calculation uses the mismatched raw values.

This is the highest priority fix. After this, the Building module should respond dramatically to orientation changes when glazing is asymmetric.

4 parts. Small, focused, critical.

---

## PART 1: Fix the units mismatch in instantCalc.js

**File(s):** `frontend/src/utils/instantCalc.js`

**The bug:** Trace through the calculation and find where solar gains switch from kWh to MWh (or vice versa) while internal gains stay in the other unit. The likely issue is the `/1000` in the solar gains calculation:

```js
solar_gains = {
  north: glazing.north * getSolarRadiation('north', orientation) * g_value / 1000,
  ...
}
```

The `SOLAR_RADIATION` values are in kWh/m²/yr. Multiplied by glazing area (m²) and g-value gives kWh. The `/ 1000` converts to MWh. But then these are used directly in:

```js
const heat_gains = total_solar + total_internal
```

Where `total_internal` (lighting + equipment + people) is in kWh (no `/1000` applied).

**The fix:** Ensure ALL values in the heating balance are in the SAME unit (kWh) during the calculation. Only convert to MWh at the display layer.

Steps:
1. Remove the `/ 1000` from the solar gains calculation so they remain in kWh
2. Verify that fabric losses, infiltration, ventilation losses are also in kWh
3. Verify that internal gains (lighting, equipment, people) are in kWh
4. The heating demand calculation `heat_losses - heat_gains * util_factor` should now work correctly with all values in kWh
5. The `gains_losses` output object should convert to MWh for display if needed, or keep in kWh and let the chart format

Also check the `opaque_solar_gain` calculation (sol-air gains from Part 7 of Brief 09) — verify it's in the same units.

**After fixing, verify the entire calculation chain:**
```
fabric_losses (kWh) = U × A × HDD × 24 / 1000  ← this /1000 converts W·h to kWh, correct
infiltration (kWh) = 0.33 × ACH × V × HDD × 24 / 1000  ← same, correct
solar_gains (kWh) = area × radiation × g_value  ← should be kWh if radiation is kWh/m²
internal_gains (kWh) = W/m² × m² × hours / 1000  ← converts W·h to kWh, correct
heating = MAX(0, losses - gains × util_factor)  ← all in kWh now
```

**Commit message:** "Part 1: Fix solar gains units — all values in kWh throughout calculation chain"

**Verify:**
1. Open browser console, check the instant calc output (or add a temporary console.log)
2. **UNIT CHECK:** Solar gains should now be in the tens/hundreds of thousands of kWh range (not tens/hundreds of MWh). For Bridgewater at 0° with 25% WWR: south solar ≈ 60m² glazing × 750 kWh/m² × 0.4 g-value ≈ 18,000 kWh. If you see 18 instead of 18,000, the fix didn't work.
3. **UNIT CHECK:** Internal gains should be similar order of magnitude. Lighting: 8 W/m² × 3,000 m² × 2,200 hours / 1000 ≈ 52,800 kWh. Equipment similar.
4. **BALANCE CHECK:** `total_solar + total_internal` should be comparable in magnitude to `total_fabric_losses + infiltration + ventilation`. If gains are 1000x smaller or larger than losses, there's still a units issue.
5. Report: "Units fixed. Solar gains now [X] kWh (was [X] MWh — 1000x correction). Internal gains [X] kWh. Fabric losses [X] kWh. All in same unit. Balance: losses [X] kWh vs gains [X] kWh."

---

## PART 2: Verify orientation now drives EUI

**File(s):** No code changes expected — pure verification. Fix if still broken.

With the units fix in place, orientation should now meaningfully affect the EUI.

**Test 1 — Symmetric glazing:**
Set all WWR to 25%. Change orientation from 0° to 180°. The EUI should change slightly (because south-facing radiation is 750 vs north at 350 — the "south" facade now faces north). The change should be modest because all facades have the same WWR.

**Test 2 — Asymmetric glazing (the critical test):**
Set F3 (the facade that faces south at 0°) WWR to 80%. Set all others to 5%.
- At 0°: The big window faces south → lots of solar gain → lower heating, higher cooling
- At 180°: The big window faces north → much less solar gain → higher heating, lower cooling
- The EUI difference should be clearly visible (several kWh/m² at least)

**Test 3 — Full rotation sweep:**
Slowly drag orientation from 0° to 360°. The EUI should vary smoothly, peaking when the big window faces north (least solar gain → most heating) and dipping when it faces south (most solar gain → least heating). The butterfly chart should animate, with the solar gain bar growing and shrinking.

**Commit message:** "Part 2: Verify orientation drives EUI — tested with asymmetric glazing" (or fix commit if issues found)

**Verify:**
1. **Test 1 results:** Symmetric 25% WWR: EUI at 0° = [X], at 180° = [X]. Difference: [X] kWh/m².
2. **Test 2 results:** F3=80%, others=5%: EUI at 0° = [X], at 180° = [X]. Difference: [X] kWh/m².
3. **CRITICAL:** The Test 2 difference MUST be > 2 kWh/m². If it's < 1, something is still wrong.
4. **Test 3:** EUI varies smoothly across 0°-360°. Min EUI at orientation [X]° (big window faces south). Max EUI at [X]° (big window faces north).
5. **SCREENSHOT 1:** Butterfly chart at 0° (big window south) showing large solar gains
6. **SCREENSHOT 2:** Butterfly chart at 180° (big window north) showing small solar gains
7. Report: "Orientation now drives EUI. Asymmetric test (F3=80%): 0° EUI [X], 180° EUI [X], difference [X] kWh/m². Smooth sweep confirms: min at [X]°, max at [X]°. Solar gains at 0°: [X] kWh. At 180°: [X] kWh. Butterfly chart responds correctly."

---

## PART 3: Check gains_losses output for display consistency

**File(s):** `frontend/src/components/modules/building/GainsLossesChart.jsx`, `frontend/src/components/modules/building/LiveResultsPanel.jsx`

After the units fix, verify that the butterfly chart and all displayed values in the live results panel are consistent and show sensible numbers.

**Check:**
1. The butterfly chart bar lengths should be proportional to actual energy values — the longest bar on each side should represent the largest contributor
2. The EUI gauge value should match `total_energy / GIA`
3. The key metrics (annual heating, annual cooling) should be consistent with what the butterfly shows
4. Hover tooltips on the consolidated solar bar should show per-facade values that sum to the total
5. The expandable Sankey (if opened) should show flows consistent with the butterfly

**Fix any display issues:**
- If values are showing in mixed units (some kWh, some MWh), standardise: show kWh for values < 10,000, MWh for values ≥ 10,000 (with appropriate formatting: "18.2 MWh" or "18,200 kWh")
- If bar lengths look wrong (a small value has a longer bar than a large value), check the scale calculation

**Commit message:** "Part 3: Verify display consistency after units fix"

**Verify:**
1. Navigate to /building
2. **SCREENSHOT:** The full right panel showing EUI gauge, butterfly, and key metrics — all with consistent, sensible numbers
3. **DATA CHECK:** EUI gauge = total energy / GIA. Annual heating + cooling + lighting + equipment + DHW + fans ≈ total energy. Butterfly heating losses ≈ heating demand + useful gains offset.
4. All values formatted consistently (kWh or MWh, not mixed)
5. Report: "Display consistency verified. EUI [X] = [total] / [GIA]. Heating [X] kWh. Cooling [X] kWh. Butterfly sums: heating side losses [X], gains [X]. Cooling side gains [X]. All consistent."

---

## PART 4: Regression test — full walkthrough

**File(s):** No changes — verification only.

Quick regression check that the units fix hasn't broken anything else:

1. Navigate to /building — three-column layout renders, 3D viewer works
2. Change geometry (length, floors) — instant calc updates, 3D responds
3. Change fabric (wall U-value) — heating demand changes in butterfly
4. Change orientation — **EUI now changes** (the main fix)
5. Change occupancy rate — internal gains change
6. Auto-simulation triggers — verified results appear
7. Navigate to /systems — three-column works, inputs responsive
8. Navigate to /profiles — schedule editor works
9. Navigate to /results — all tabs render with simulation data
10. Navigate to /scenarios — comparison view works
11. Run a fresh simulation — completes without errors
12. Check browser console — zero red errors

**Commit message:** "Part 4: Regression test — all modules verified after units fix"

**Verify — report checklist:**
- Building module: ✓/✗
- Orientation drives EUI: ✓/✗ (this is the key one)
- Fabric changes affect results: ✓/✗
- Occupancy changes affect results: ✓/✗
- Systems module: ✓/✗
- Profiles module: ✓/✗
- Results dashboard: ✓/✗
- Scenarios: ✓/✗
- Auto-simulation: ✓/✗
- Full simulation completes: ✓/✗
- Console errors: 0

---

## After all 4 parts are complete

Update STATUS.md with:
- Units bug fixed (solar gains were in MWh, everything else in kWh)
- Orientation now drives EUI — tested with [X] kWh/m² swing on asymmetric glazing
- All modules regression tested
- Known issues

Push to GitHub. Confirm push succeeded.

Tell Chris: "Brief 11 complete. Units fixed — solar gains were 1000x underweighted. Orientation now swings EUI by [X] kWh/m² with asymmetric glazing. All modules regression tested. Ready for Systems module work."
