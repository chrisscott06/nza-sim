# Brief 50 — MVHR recovery double-count fix (Option A: State 2 owns recovery)

**Type:** Fix brief (Tier 3). Diagnosis complete — Brief 49 reached verdict.
**Depends on:** Brief 49 (`150eeb6`, `06a5cda`, `9159ba0`) — verdict + live harness.
**Engine baseline before this brief:** Bridgewater clean EUI = **121.90 kWh/m²·yr**.
**Engine baseline AFTER this brief (expected, NOT a target):** Bridgewater clean EUI ≈ **126 kWh/m²·yr**. This MUST be reached by removing a double-count and explained from first principles — NOT calibrated to. See Part 3.
**Canonical diagnosis:** Diagnostics note `367d645e-05cc-81af-93d7-fc57bfc45faf` → "Finding E.2 — VERDICT REACHED".
**Falsifiability instrument (PRIMARY):** `scripts/_brief49_refbox_test.mjs` (committed in `5265c42`) — the clean known-answer reference box. Its **Probe 1 ratio (1.99 → must become 1.00)** is the primary acceptance gate. The Bridgewater harness `scripts/_brief49_mvhr_boundary_diagnostic.mjs` (`9159ba0`) is a SECONDARY check for portfolio-realistic magnitude, NOT the primary gate — see the methodological note below.

**Why the refbox is primary, not the Bridgewater harness:** the Bridgewater Δheating-elec / recovery / SCOP ratio ≈ 1.0 looks clean but is INVARIANT to this bug — it's true whether recovery is subtracted once or twice. A locally-consistent ratio can be globally wrong. Only an ABSOLUTE hand-calc of airstream heat content exposes the double-count, and only the confound-free box gives that cleanly. Trust the box's absolute ratio, not Bridgewater's internal consistency. (Diagnostics note: "REFERENCE BOX confirms H3, ratio 1.99" + "METHODOLOGICAL LESSON".)

---

## Background — what Brief 49 proved

The MVHR breakdown panel is NOT broken (H1 confirmed: fuel responds correctly to the toggle; the flat total-electricity was real fan-vs-heat arithmetic, plus a silent-fallback artefact). The real bug is **H3, sharpened**: MVHR recovery is **counted twice** across the State 2 / State 3 boundary.

- **State 2** reduces heating demand via its `(1 − HRE)` ventilation-UA factor (`instantCalc.js` ~L2551). On Bridgewater this already claims **85.60 MWh** of MVHR saving (State C raw 175.90 → State A raw 90.30).
- **State 3** then subtracts `effective_recovery_mwh` *again* at the heating-demand override (`instantCalc.js` ~L4131). This claims **another 61.42 MWh**.
**The decisive evidence (reference box, commit `5265c42`):** a clean 100 m² fixture — no gains, no DHW, no cooling, SFP=0, vent 500 L/s, single ASHP SCOP 3.0 — makes every boundary hand-calculable. Probe 1 (toggle HRE 0.75→0): the engine produces Δdelivered = 70.061 MWh against a hand-calc of 35.261 (vent × HRE), and Δheating-elec = 23.354 vs hand-calc 11.754 — **ratio 1.99**. The engine applies recovery exactly twice. Probe 3 (HRE sweep) confirms the recovery *magnitude* is correct (ratio 1.00 at every point) — so the bug is pure duplication, not a wrong coefficient. Probe 2 confirms elec = delivered/SCOP exactly — the fuel path is faithful, it's just fed a delivered that's missing half the recovery.

**The fix direction (Option A, authorised by Chris):** recovery is a *passive demand-reducer* and belongs in the State 2 demand integral, where `(1 − HRE)` already puts it (and computes the correct magnitude, per Probe 3). **State 2 owns recovery. State 3 stops subtracting it.** This is the Brief 44 boundary discipline: State 2 = demand inclusive of passive systems; State 3 = active fuel consumption only (post-recovery demand ÷ SCOP). The fix deletes the DUPLICATE (State 3 subtraction), not the original (State 2 factor).

**Supporting magnitude evidence (Bridgewater harness):** total apparent MVHR saving = 147.02 MWh against a ~104.20 MWh airstream ceiling — over-count ~43 MWh/yr, systematic across every MVHR building, heating fuel under-counted ~14 kWh/m²·yr delivered. (This is real but is NOT the primary gate — the refbox ratio is, per the instrument note above.)

Two coupled defects, found in the same investigation, are fixed in this same brief because they live on the same boundary:
- **(D1) v25↔v40 silent-fallback footgun.** The v40 ventilation block returns `null` on share-pct validation failure; the engine silently falls back to v25 with MVHR still live. A user disabling MVHR in the v40 UI sees NO engine response — this produced Chris's original "90.3/90.3 both states" observation.
- **(D2) HRE drift.** v25 HRE = 0.80 vs v40 HRE = 0.75. Stale duplicate config. One source of truth, and the surviving recovery owner (State 2) must read it.

---

## BEFORE DOING ANYTHING

1. Read this brief in full. Confirm receipt by quoting its title + this Background section's first line back to Chris.
2. Read `CLAUDE.md` (esp. Rule 14 envelope-physics parity, Process Rules) and `STATUS.md`.
3. Read the canonical diagnosis: Notion `367d645e-05cc-81af-93d7-fc57bfc45faf`, "Finding E.2 — VERDICT REACHED" + "DECISIVE TEST METHOD" sections.
4. Read the code you will touch BEFORE touching it:
   - `instantCalc.js` — `_calculateState2` ventilation section (~L2551, the `(1 − HRE)` factor) AND `_calculateState3` heating-demand override (~L4131, the `effective_recovery_mwh` subtraction) AND `computeVentilationEnergy`.
   - `systemsEngine.js` — `computeSystemsDelivered` (the `heatingDemandOverrideMwh` / `heatingRecoveryOffsetMwh` params), `_computeHeatingOrCooling` (the `offsetRatio ≈ 0.68` proportional-scaling block), `_computeVentilation`, and the v40→v25 fallback path (`v40VentilationToV25List` + the null-return-on-validation-failure).
   - `scripts/_brief49_mvhr_boundary_diagnostic.mjs` — understand the three states A/B/C it runs and what it asserts.
5. Confirm clean working tree, origin in sync.
6. Land this brief at `docs/briefs/active/50_mvhr_recovery_doublecount_fix.md` as Part 1's first commit.
7. Run the session-start reconciliation pass.

---

## Scope

**In scope:** the MVHR/ventilation recovery accounting across the State 2 / State 3 boundary; the v40→v25 silent-fallback behaviour for ventilation; HRE config unification. `instantCalc.js` (`_calculateState2`, `_calculateState3`, `computeVentilationEnergy`), `systemsEngine.js` (`computeSystemsDelivered`, `_computeHeatingOrCooling`, the fallback path), and any HRE default constant/config they read.

**Out of scope (do NOT touch):**
- The BreakdownPanel UI logic beyond confirming its "Heat recovered by MVHR" row reconciles (Part 6 read-only check). No redesign.
- Cooling/SEER, DHW, lighting, small_power physics.
- The v40 `_computeVentilation` recovery placeholder — **do NOT** "move recovery into v40" in this brief. Option A keeps recovery in State 2's demand integral; the v40 placeholder stays zero because v40 is not the recovery owner. (A future brief may consolidate engines; not here.)
- Any interventions-engine delta math (`interventionsEngine.js`) — it only reads fields; it needs no change.

---

## Principles

1. **Single boundary owns recovery.** After this brief, recovery is applied in exactly ONE place (State 2's demand integral). Every other consumer reads the post-recovery demand State 2 produces; none re-derives or re-subtracts it.
2. **Don't calibrate to a target.** The EUI will move (~121.9 → ~126). Document the movement from first principles (removing a 43 MWh over-count → heating fuel rises by ~recovery_offset ÷ SCOP). NEVER tweak a factor to land on a specific EUI.
3. **No silent fallbacks** (Brief 42 Principle 2). A v40 validation failure must surface an error, not quietly revert to v25.
4. **Boundary-named variables** (Brief 44 family). Any variable this brief adds or renames declares its boundary: `*_raw_demand_mwh`, `*_post_mvhr_demand_mwh`, `*_delivered_mwh`, `*_source_fuel_mwh`.
5. **The harness is the truth.** Every Part that changes physics re-runs `_brief49_mvhr_boundary_diagnostic.mjs` and records the three-state table in the audit doc. The hard ceiling is **total apparent MVHR saving ≤ ~104 MWh** (airstream heat content).
6. **Rule 14 parity.** State 1 / State 2 / inline-legacy must stay in parity. If the `(1 − HRE)` treatment touches the shared ventilation path, verify all three locations still agree.

---

## Parts (one commit each)

### Part 1 — Land brief + baseline BOTH fixtures
- Land this brief at `docs/briefs/active/50_*.md`.
- Create the audit doc `docs/audit/50_mvhr_recovery_doublecount.md` with: (a) the refbox Probe 1 table (HRE 0.75 vs 0, ratio 1.99) as the PRE-FIX primary baseline; (b) the three probe results; (c) the Bridgewater three-state table as supporting magnitude evidence; (d) the over-count arithmetic (147.02 vs 104.20 ceiling).
- Run BOTH harnesses unchanged: `_brief49_refbox_test.mjs` (primary) and `_brief49_mvhr_boundary_diagnostic.mjs` (secondary). Paste outputs into the audit doc. Confirm the refbox reproduces ratio 1.99 and Bridgewater reproduces 121.90 anchor on the current tree.
- Commit: `Brief 50 Part 1: land brief + pre-fix baseline (refbox ratio 1.99 + Bridgewater)`.
- **CHECKPOINT:** refbox Probe 1 ratio = 1.99 (±0.01) AND Bridgewater anchor = 121.90. If either fails to reproduce, STOP and surface — the tree has drifted and the diagnosis must be re-confirmed before any fix.

### Part 2 — Remove the State 3 double-subtraction (the core fix)
- In `instantCalc.js` `_calculateState3` (~L4131): the heating-demand override currently passes `raw_state2_demand − effective_recovery_mwh` as the post-MVHR demand. Since State 2 ALREADY applied `(1 − HRE)`, the demand State 2 returns is ALREADY post-recovery. **Pass State 2's demand through unchanged** as `heating_post_mvhr_demand_mwh` — delete the `− effective_recovery_mwh` subtraction.
- Set `heatingRecoveryOffsetMwh` passed to `computeSystemsDelivered` to **0** (recovery is no longer applied at this boundary) — OR remove the param threading if cleaner. The recovery offset, if still surfaced for the panel, must now be DERIVED as `state_C_raw − state_2_demand` (the State-2-owned recovery), NOT re-subtracted.
- Diagnose-before-fix: add temporary diagnostic logging printing `raw_state2`, `effective_recovery_mwh`, `heating_post_mvhr_demand_mwh` before and after, to confirm the value passed to systems is now exactly State 2's demand. Remove logging before commit.
- Re-run BOTH harnesses. **Primary acceptance — refbox Probe 1 ratio must converge 1.99 → 1.00:** Δdelivered must drop 70.061 → 35.261, Δheating-elec 23.354 → 11.754. This is the clean, unambiguous gate. **Secondary — Bridgewater:** total apparent saving drops 147.02 → ≤104.20; record the new three-state table.
- Commit: `Brief 50 Part 2: State 2 owns MVHR recovery — remove State 3 double-subtraction`.
- **CHECKPOINT (falsifiable, refbox is the gate):** refbox Probe 1 ratio = 1.00 (±0.01). If the ratio is still ~1.99, the subtraction wasn't removed correctly; if it overshoots below 1.0 (e.g. 0.5), recovery is now being *under*-applied (State 2 factor also got touched — it must NOT be) — either way STOP and surface. Bridgewater apparent saving must also be ≤104.20.

### Part 3 — Reconcile the new EUI anchor from first principles
- Compute, in the audit doc, the expected EUI movement WITHOUT running the engine: removing ~43 MWh of phantom recovery means ~43 MWh more heating demand must be delivered; at the blended heating SCOP that's ~Δ MWh of extra fuel; ÷ GIA = expected ΔEUI. Show the arithmetic lands near +4 kWh/m²·yr → ~126.
- Then run the engine and confirm the actual new anchor matches the hand-prediction within rounding. If it does NOT match the first-principles prediction, the fix has a side effect — investigate before proceeding (do NOT accept a number you can't derive).
- Update `STATUS.md` clean-state anchor: **121.90 → [actual] kWh/m²·yr**, with a one-line note: "Brief 50 removed MVHR recovery double-count; previous anchor under-counted heating fuel by ~recovery_offset/yr."
- Commit: `Brief 50 Part 3: reconcile + document new clean-state EUI anchor (~126)`.

### Part 4 — Retire the `offsetRatio ≈ 0.68` workaround
- In `systemsEngine.js` `_computeHeatingOrCooling`: the proportional-scaling block (`offsetRatio = recoveryOffsetMwh / rawAtComfortMwh`, scaling the offset at custom setpoints) exists ONLY to keep State 3's recovery subtraction boundary-aligned with the State 2 setpoint recompute. With recovery no longer subtracted at State 3 (Part 2), this block has no reason to exist.
- The setpoint recompute now returns State 2 demand at the new setpoint, which is ALREADY post-recovery (State 2 owns it). So `demand_at_service_setpoint_mwh` = the recomputed State 2 demand, no offset scaling.
- Delete the `scaledOffset` / `offsetRatio` logic. `demand_at_service_setpoint_mwh = rawDemandAtSetpointMwh` (which is now post-recovery by construction). Clean up the now-unused `recoveryOffsetMwh` param if nothing else reads it (grep first per the clean-up rule).
- Re-run harness AND verify the Diagnostic setpoint behaviour (the original 248% bug regression): a 0.5°C heating setpoint change must still produce sensible monotonic deltas (Brief 44 Part 2 falsifiability target). Record in audit doc.
- Commit: `Brief 50 Part 4: retire offsetRatio recovery-scaling workaround (no longer needed)`.
- **CHECKPOINT:** setpoint-change deltas remain sensible/monotonic (no return of the 248% jump). If they regress, the workaround was masking a second issue — STOP and surface.

### Part 5 — Fix the v40→v25 silent-fallback (D1)
- In `systemsEngine.js`: when the v40 ventilation block fails share-pct validation (or otherwise can't compute), it currently returns `null`, and `_calculateState3` falls back to the v25 path with MVHR active. Change this so a v40 ventilation validation failure SURFACES an error (same pattern as the heating/cooling/DHW `error` field) rather than returning null.
- In `_calculateState3`: the fallback to v25 ventilation must only fire when v40 ventilation is genuinely ABSENT (empty array), NOT when it's present-but-erroring. Present-but-erroring → propagate the error, zero the ventilation contribution, surface in UI (consistent with how the other services already behave).
- Verify in the browser: populate v40 MVHR, disable it via the v40 UI toggle, confirm the engine NOW responds (demand/fuel changes) instead of silently keeping v25 MVHR alive. Capture before/after numbers.
- Commit: `Brief 50 Part 5: v40 ventilation no longer silently falls back to v25 on validation failure`.

### Part 6 — Unify HRE source of truth (D2) + reconciliation checks
- Resolve the v25 HRE 0.80 vs v40 HRE 0.75 drift. Pick ONE source of truth — the v40 system config's HRE is the user-facing value, so v40's HRE (0.75 as currently set for Bridgewater) should be canonical. Confirm State 2's `(1 − HRE)` factor reads the SAME HRE the v40 UI shows — trace the value from config to the State 2 ventilation factor. If State 2 currently reads a hardcoded/v25 0.80, rewire it to read the v40 system HRE.
- Grep for any other hardcoded HRE (the `SYSTEM_DEFAULTS.mvhr_standard.hre = 0.82` in instantCalc.js is a *default seed* — confirm it's only used when no system value is present, not as a live override).
- Read-only reconciliation checks (record in audit doc):
  - BreakdownPanel "Heat recovered by MVHR" row = `raw − delivered` (State C raw − State A delivered, single-counted).
  - Re-run `_brief49_mvhr_boundary_diagnostic.mjs`: total apparent saving ≤ 104 MWh; single boundary owns recovery; HRE consistent across paths.
- Commit: `Brief 50 Part 6: unify HRE to one source of truth + reconciliation checks`.
- **CHECKPOINT (final falsifiability gate):** all five targets in the "Falsifiability targets" section below pass.

### Part 7 — Walkthrough + close
- Claude Code reports the full before/after three-state table and the five falsifiability results to Chris.
- Chris runs the in-browser walkthrough (checklist below).
- On sign-off: `git mv` brief to `docs/briefs/archive/50_mvhr_recovery_doublecount_fix_COMPLETED.md`, STATUS.md close-out (new anchor recorded), `current.md` repointed. Single push.

---

## Falsifiability targets (the fix is wrong if any fail)

1. **Refbox ratio (PRIMARY):** Probe 1 ratio converges 1.99 → **1.00** (±0.01). Δdelivered 70.061 → 35.261; Δheating-elec 23.354 → 11.754. Re-run `_brief49_refbox_test.mjs`.
2. **Refbox regression guards:** Probe 2 (elec = delivered/SCOP to <0.001) and Probe 3 (HRE sweep linear, ratio 1.00 at every point) STILL pass — the fix must not disturb the correct magnitude or the faithful fuel path.
3. **Ceiling (secondary):** Bridgewater total apparent MVHR saving ≤ ~104.20 MWh (was 147.02). Re-run `_brief49_mvhr_boundary_diagnostic.mjs`.
4. **Single owner:** recovery applied in exactly one place (State 2). State 3 passes State 2 demand through unchanged; grep confirms no second subtraction.
5. **Panel reconciles:** BreakdownPanel "Heat recovered by MVHR" row = raw − delivered.
6. **EUI from first principles:** new Bridgewater anchor (~126) matches the hand-derived movement within rounding — NOT calibrated.
7. **No regressions:** (a) 0.5°C setpoint change still monotonic/sensible (no 248% return); (b) v40 MVHR disable produces a visible engine response (no silent v25 fallback); (c) one HRE value across both paths; (d) Bridgewater non-MVHR numbers unchanged within rounding.

---

## What MUST NOT happen

- Do NOT calibrate any factor to hit ~126. The number must fall out of removing the double-count.
- Do NOT move recovery into v40 `_computeVentilation` (that's a different brief; Option A keeps it in State 2).
- Do NOT touch cooling/DHW/lighting/small_power physics.
- Do NOT redesign BreakdownPanel — Part 6 is a read-only reconciliation check only.
- Do NOT leave the `offsetRatio` block "just in case" — if Part 2 is correct it is dead code; delete it (clean-up rule).
- Do NOT proceed past any CHECKPOINT that fails — surface to Chris.

## When to escalate (pause + ping Chris)

- Part 1 checkpoint: harness doesn't reproduce Brief 49 numbers (tree drifted).
- Part 2 checkpoint: refbox ratio doesn't reach 1.00 — still ~1.99 (subtraction not removed) or overshoots below 1.0 (State 2 factor wrongly touched, recovery now under-applied).
- Part 3: actual EUI doesn't match the first-principles prediction (hidden side effect).
- Part 4 checkpoint: setpoint deltas regress (workaround was masking something).
- Any point where the fix requires touching a file outside Scope.
- Three-approach limit on any single failure, then stop.

## Walkthrough checklist (Chris, in browser)

1. Load Bridgewater clean. EUI ≈ new anchor (~126), NOT 121.90. ✓/✗
2. Heat recovered by MVHR row reconciles to raw − delivered. ✓/✗
3. Toggle MVHR off (v40 UI): demand AND fuel both respond (no inert toggle). ✓/✗
4. Toggle MVHR back on: returns to anchor. ✓/✗
5. HRE shown in UI = HRE used by engine (0.75, consistent). ✓/✗
6. Change heating setpoint 0.5°C: sensible monotonic delta (no 248% jump). ✓/✗
7. A VRF-SCOP intervention still gives a sensible saving; isolated SCOP improvement REDUCES EUI (hard invariant). ✓/✗
8. Non-MVHR building (or MVHR-removed state): numbers unchanged vs pre-Brief-50 within rounding. ✓/✗
9. BreakdownPanel marginal/cumulative still reconcile (telescoping intact). ✓/✗
10. Harness re-run: total apparent saving ≤ 104 MWh. ✓/✗

## Final report (Claude Code at close)

- Before/after three-state harness table.
- The five falsifiability results, pass/fail with numbers.
- New clean-state EUI anchor + the first-principles derivation of the movement.
- Confirmation the `offsetRatio` block is deleted and `recoveryOffsetMwh` threading cleaned up.
- Confirmation the v40 disable toggle now produces an engine response.
- The single canonical HRE value and where it's now read from.
