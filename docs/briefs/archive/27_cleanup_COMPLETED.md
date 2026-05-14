# Brief 27 Cleanup — Heat Balance Bug + Divergence Doc Correction

**Scope:** Two small fixes flagged by the audits. Sets up clean state before Brief 28 starts.

**Estimated time:** 1 hour.

**Dependencies:** None.

**Pre-flight checks:** See batch orchestration doc.

---

## Part 1 — Heat Balance prop bug fix

**File:** `frontend/src/components/modules/gains/canvas/HeatBalanceView.jsx`

**Issue:** Line 45 passes `balance=` where the component expects `liveData=`. Result: Heat Balance tab in Internal Gains shows "no heat balance data available — load a project" even when Bridgewater is loaded.

Found by UX audit, flagged as BLOCKING.

**Fix:**

1. Open `HeatBalanceView.jsx`
2. Locate line 45 (or wherever the prop is being passed)
3. Rename `balance=` to match what the downstream component expects (`liveData=` per audit finding; verify by reading the component being passed to)
4. Verify the data shape matches what the consumer expects — if not, transform the data appropriately
5. Test: navigate to /gains on Bridgewater, click Heat balance tab, confirm data renders

**Verify:**
- Heat balance tab renders State 2 heat balance on first visit
- No "load a project" empty state on a loaded project
- State 1 isolation: 40/40 byte-identical
- State 2 isolation: 21/21 byte-identical (the fix is UI-only, shouldn't affect engine output)

**Commit message:** "Brief 27 cleanup Part 1: Heat balance prop name fix (HeatBalanceView.jsx)"

**Progress doc update:** Status `complete`, commit hash, any decisions made.

---

## Part 2 — Divergence doc correction

**File:** `docs/state_1_engine_divergence_investigation.md`

**Issue:** The doc states a "50 GWh phantom solar / 38% solar over-count" attributed to isotropic sky modelling. Physics audit found this is overstated by ~10×. Real per-facade deviation is +19% NNE / −10% SSW, aggregate +1%.

The doc was comparing pre-shading incident solar against post-shading transmitted total — different quantities.

**Fix:**

1. Read the current doc.
2. Identify every claim relating to the 38% number or 50 GWh figure.
3. Correct each instance with the audit's findings: per-facade deviation +19% NNE / −10% SSW, aggregate +1%.
4. Add a paragraph explaining the original measurement error (pre-shading incident vs post-shading transmitted).
5. Note that the HDKR/Perez fix is still warranted but smaller in magnitude than originally documented.
6. Update any references to the 23.5% conduction divergence — the audit found this was an artefact of HVAC-clamped vs free-running comparison. The fix here is to add a clarifying paragraph noting that the comparison wasn't apples-to-apples, and that the true free-running EP comparison is queued (Brief 28-prereq).
7. Add a dated audit attribution at the top: "Corrected {date} per docs/physics_audit_2026_05.md findings."

Do NOT delete the original content. Strike-through or annotate. The audit trail of "what we thought, what we found, what's correct" is more valuable than a clean rewrite.

**Verify:**
- Doc reads coherently
- All references to 38% and 50 GWh either struck through with correction or replaced
- 23.5% conduction divergence has a clarifying note about the comparison artefact
- HDKR/Perez fix mentioned as still warranted, magnitude revised

**Commit message:** "Brief 27 cleanup Part 2: Correct overstated solar / conduction divergence claims per physics audit"

**Progress doc update:** Status `complete`, commit hash, any decisions made.

---

## Close-out

After both parts complete:

1. Run full regression suite:
   - State 1 live: 40/40 byte-identical
   - State 1 EP: 40/40 byte-identical
   - State 2 live: 21/21 byte-identical
   - State 2 EP: 21/21 byte-identical
2. Update `STATUS.md` with one paragraph noting the cleanup is done.
3. Update `docs/batch_progress_2026_05.md` with Brief 27 cleanup marked complete.
4. Pre-flight check for next brief (Brief 28-prereq):
   - All regressions green
   - Build clean
   - Working tree clean
5. Update `current.md` to point at `docs/briefs/active/28_prereq_free_running_ep.md`
6. Proceed to next brief without pause.

**Confidence target:** 10/10 (these are bug fixes, no design decisions).

If anything in this brief takes more than 2 hours or surfaces unexpected complexity, halt under HH3 and report.

---

## Part 3 — Corrected close-out (added 2026-05-14 after walkthrough)

> **⚠ NUMBERS BELOW PREDATE `5f890c2` — RE-BASELINING QUEUED IN BRIEF 29 PART 5**
>
> The annual totals quoted in this part — `losses_kwh = 184,729.4`,
> `gains_kwh = 307,594.3`, and any per-gain figures — were produced by
> the Static engine **before** the `decomposeHour day=1` fix (commit
> `5f890c2`, 2026-05-14). That bug zeroed People/Lighting/Equipment
> across Jan/Apr/Jul/Sep/Dec on every project, so the 307,594 kWh gains
> total under-counted internal gains substantially.
>
> The structural conclusion (shape contract was wrong, fix re-routed
> internal gains under `gains.internal.*`, all 15 shape checks pass)
> stands. Engine numbers post `5f890c2` supersede the magnitudes here.
> Full re-baselining queued in Brief 29 Part 5.

**Reason for reopening:** Brief 27 cleanup Part 1 closed at 10/10 confidence based on a static-code verification that the prop rename had landed (`balance=` → `liveData=` on `HeatBalanceView.jsx:45`). The rename was correct but NOT sufficient. Chris's walkthrough confirmed the Heat balance tab still showed the empty state on a loaded Bridgewater. Honest root cause: I missed the brief's explicit Step 4 — "Verify the data shape matches what the consumer expects — if not, transform the data appropriately." I verified the prop name but not the shape contract.

### What was actually wrong

`_calculateState2` in `frontend/src/utils/instantCalc.js` returns the state contract output with `annual`/`losses`/`gains`/`metadata` NESTED under `heat_balance` (lines 1302-1325). The engine author's comment at the same site says explicitly: *"Mirror the state1 heat_balance shape so the existing HeatBalance component renders State 2 without further changes."* They intended the consumer to receive `state2.heat_balance`, not the full `state2`.

A second, secondary mismatch: `_calculateState2` placed `people` / `lighting` / `equipment` directly under `gains.*` while `HeatBalance.jsx`'s `flattenGains` looks for them under `gains.internal.*` (lines 102-117 of HeatBalance.jsx). So even after the wrapper unwrap, internal gains would have rendered empty.

### Fixes shipped in Part 3

1. **Wrapper unwrap.** `frontend/src/components/modules/gains/canvas/HeatBalanceView.jsx:45`:
   - Was: `<HeatBalance liveData={state2} mode="envelope-gains" />`
   - Now: `<HeatBalance liveData={state2?.heat_balance} mode="envelope-gains" />`
   - Inline comment explains the unwrap and references this Part 3.

2. **Engine output shape.** `frontend/src/utils/instantCalc.js` `_calculateState2` return at line 1299+:
   - Moved `people` / `lighting` / `equipment` from `gains.*` to `gains.internal.*` to match what `flattenGains` consumes.
   - Recomputed `totals.gains_kwh` and `totals.gains_kwh_per_m2` to include the new internal gains (was previously solar-only when internal gains were misplaced at `gains.*` and `flattenGains` couldn't see them anyway — but the totals were under-counting either way).

### Verification

New diagnostic script `scripts/verify_state2_heat_balance_shape.mjs`. All 15 shape checks pass:
- `state2.heat_balance.annual` exists (empty-state check passes)
- `annual.totals.losses_kwh` = 184,729.4 kWh ; `gains_kwh` = 307,594.3 kWh (now includes internal gains)
- `annual.gains.solar` exists ✓ ; `annual.gains.internal.{people,lighting,equipment}` all exist ✓
- `annual.losses.external_wall` exists ✓ ; `metadata.gia_m2` = 3,457 m² ✓
- `annual.gains.{people,lighting,equipment}` correctly absent at top level

Isolation regressions remain byte-identical post-shape-change (the new shape applies consistently across baseline + absurd-input cases):
- State 1 Live: 40/40
- State 2 Live: 21/21
- Build clean

### Revised confidence

**Part 3 confidence: 9/10.** One open question — `mode="envelope-gains"` is still being passed to a consumer whose `mode` prop is documented `'envelope-only' | 'full'`. `stateMode.js` falls through to `FULL` for unrecognised modes, which gives us the right gain/loss order (solar + internal + heating; heating filters out at runtime since state 2 has none). So this works, but it's documented-by-fallthrough rather than first-class. Suggest extending `LOSS_ORDERS` and `GAIN_ORDERS` in `stateMode.js` to include `ENVELOPE_GAINS` explicitly during Brief 28a Part 3 (canvas restructure) or as a small standalone follow-up.

**Brief 27 cleanup overall confidence after Part 3: 9/10.** The original 10/10 was wrong; Part 1's verification gap is the 1/10 gap. A regression test that loads the rendered HeatBalance with state2 data and confirms it doesn't fall into the empty-state branch would have caught this. Filed as a candidate test for Brief 28a Part 7 close-out.

### Lesson for future verification

When the brief says "Verify the data shape matches what the consumer expects — if not, transform the data appropriately," do not stop at the prop-name check. Read the engine's return statement, read the consumer's prop reads, and confirm the two shapes match field-by-field. A regression script that renders the React component server-side (or via a smoketest) and asserts on visible output would have caught this. Brief 28a Part 7 close-out gets a new acceptance gate: rendering smoketest for HeatBalanceView with Bridgewater state2 data, asserting `data.annual` resolves and gains.internal renders.
