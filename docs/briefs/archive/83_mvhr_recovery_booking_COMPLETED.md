# Brief 83 — MVHR recovery booking (Finding B fix)

**Author:** Claude Chat (architect)
**Authorised by:** Chris (2 June 2026, post-Brief-82 close)
**Authority level:** Same-day working session. Source-read diagnostic followed by targeted engine fix. Branch only.
**Provisional number:** 83. Numbering rolls per Brief 82: door bug → Brief 78; interventions harness → Brief 79; WWHR → Brief 80; solver-convention characterisation (Finding A) → Brief 84.
**Design note (canonical, READ FIRST):** https://app.notion.com/p/378d645e05cc81e2b01edd0e11836a80 — "Brief 83 design note: MVHR recovery booking (Finding B fix)". Where this brief and the design note disagree, the design note wins.
**Branch:** All work on `feat/energyplus-validation`. NEVER merge to `main` during this brief.

---

## CRITICAL CONTEXT — READ BEFORE STARTING

### What Brief 82 found

Outcome (b) — partial. The four Brief 81 divergences are at least two independent findings:

**Finding A — Free-float warmth (~+1 °C, unconditioned hours).** NZA-Sim's zone settles warmer than EnergyPlus during unconditioned hours. Best fit: solver convention (CTF + heat balance vs lumped quasi-dynamic mass). Defensible difference. **Brief 84's territory — DO NOT TOUCH IN BRIEF 83.**

**Finding B — Same-setpoint magnitude.** At agreed 24 °C cooling setpoint, NZA removes ~2× cooling and loses ~2× mech vent heat. **Immune to any temperature shift.** NZA-Sim shows ~54% effective recovery vs EP's ~82%, both nominally 75% HRE. **Real engine issue. Brief 83's target.**

### The two findings are partially coupled

Finding B says NZA loses more vent heat, which should make the zone *colder*. Finding A says NZA floats warmer. These move in opposite directions. Current numbers may be partially cancelling.

**Important consequence for Brief 83:** fixing Finding B (closing the 93% mech vent loss excess to ~0%) will remove a "cooling effect" on the zone that's currently partially offsetting Finding A. The zone will free-float even warmer after Brief 83 closes. **The float-warmth delta from Brief 82 may temporarily widen.** That's expected, not regression. Document.

Brief 84 (Finding A) then closes that gap separately.

### What Brief 83 is testing

NZA-Sim's MVHR recovery integration is booked differently than EnergyPlus's. Four candidate mechanisms (more may emerge from source reading):

1. **Recovery as zone gain vs supply-side preheat.** EnergyPlus mixes supply air at zone air node with recovery applied as supply-side preheat. NZA-Sim may treat recovered heat as a separate zone gain term.
2. **Recovery applied to extract vs supply.** Recovery may be subtracted from extract loss in NZA-Sim instead of added to supply temperature.
3. **Wrong ΔT for recovery calculation.** EP computes recovery effectiveness against (T_extract − T_outdoor). NZA may compute against (T_zone − T_outdoor) without accounting for supply-side temperature changes.
4. **Missing zone temperature feedback.** Recovery effectiveness depends on extract temperature which depends on zone temperature. If NZA computes recovery once per hour against an approximate zone temperature, it'll mis-book.

Or some combination. Or something we haven't predicted. Source-reading reveals.

---

## BEFORE DOING ANYTHING

1. **Confirm receipt.** Quote this brief's title and Finding B paragraph above. State tip of `feat/energyplus-validation` (expected: `d6f964c` or later if Brief 82 close commits have landed). State tip of `main` (expected: `d8a6207` — unchanged since branch cut).
2. **Read the design note** at https://app.notion.com/p/378d645e05cc81e2b01edd0e11836a80 in full.
3. **Confirm branch.** `git branch --show-current` returns `feat/energyplus-validation`. Verify before every commit.
4. **Read Brief 82's audit document** at `docs/audit/82_zone_temp_delta_diagnostic.md` — particularly §5/§6 findings + Appendix A methodology correction.
5. **Land brief on disk** at `docs/briefs/active/83_mvhr_recovery_booking.md` on the feature branch. Open audit stub at `docs/audit/83_mvhr_recovery_booking.md`.

---

## Parts (one commit per part, minimum)

### Part 1 — Brief landing + branch verify

Confirm branch is `feat/energyplus-validation`. Confirm `main` unchanged at `d8a6207`. Land brief. Open audit stub.

Commit: `Brief 83 P1: brief landing on feat/energyplus-validation`.

### Part 2 — Source read of NZA-Sim's MVHR recovery integration

Read the engine source. Identify and document in audit §2 with file + line refs:

- **Where is recovery applied?** Find the line(s) in `instantCalc.js` State 2 (probably around line 2900-3000 for the ventSystems builder, then in the hourly loop around line 3300-3500) where MVHR recovery enters the heat balance.
- **What form does recovery take?** A reduction in extract loss? An addition to supply temperature? A zone gain term? Something else?
- **What ΔT is used for recovery calculation?** (T_zone − T_outdoor)? (T_extract − T_outdoor)? Something else?
- **Per-hour vs annualised?** Does the engine compute recovery hour-by-hour with current zone state, or does it use an annualised ΔT?
- **How does this map to the 54% effective recovery observation?** Walk through the math: given nominal 75% HRE, why does Brief 82 observe 54% effective?

This is read-only. No code changes in Part 2.

**Critical:** if reading source reveals the issue isn't where the brief assumed (e.g. recovery is fine but vent loss accounting upstream is wrong), **push back via audit comment, document actual root cause, propose revised fix scope.** Same premise-check authority as Brief 76.

Commit: `Brief 83 P2: source read of NZA-Sim MVHR recovery integration`.

### Part 3 — Source read of EnergyPlus's MVHR recovery (reference)

Read the EnergyPlus IDF generated by Brief 81 + relevant EnergyPlus documentation. Document in audit §3:

- Which EnergyPlus object handles MVHR? (`ZoneHVAC:EnergyRecoveryVentilator`? `HeatExchanger:AirToAir:SensibleAndLatent`? Something else?)
- How does EnergyPlus integrate recovery into zone heat balance?
- How is effective recovery computed in EnergyPlus's outputs?

Goal: understand the reference implementation well enough to specify what NZA-Sim should match (or document why it can't).

Commit: `Brief 83 P3: source read of EnergyPlus MVHR recovery (reference)`.

### Part 4 — Per-hour MVHR heat flow comparison

Extend the existing harness to dump per-hour MVHR-related quantities from both engines for the full 8760 hours:

**Both engines:** supply air temperature (entering zone), extract air temperature (leaving zone), outdoor temperature, recovery heat flow (W), zone air temperature.

**NZA-Sim side:** add opt-in outputs to engine output schema (non-breaking, off by default). Surface through `extract.mjs` parallel to Brief 82's zone-temp extraction.

**EnergyPlus side:** verify IDF requests these via `Output:Variable`. Add if missing. Re-run.

Output two parallel CSVs at `validation/{engine}/results/bridgewater_box_v1_mvhr_hourly.csv`.

**Falsifiability:** both CSVs have 8760 rows, same time indexing as Brief 82. Sample 10 hours, hand-verify values are plausible. Effective recovery per hour ≈ (T_supply − T_outdoor) / (T_extract − T_outdoor) — should average ~0.75 for EP (matching nominal 75% HRE) and ~0.54 for NZA-Sim (matching Brief 82 observation). If those averages don't match Brief 82's findings, something has changed; STOP and investigate.

Commit: `Brief 83 P4: per-hour MVHR heat flow extraction (both engines)`.

### Part 5 — Identify the booking discrepancy

Analyse the Part 4 data. Answer with evidence in audit §5:

1. **Which candidate mechanism is operative?** Walk through the math. If recovery as zone gain — show where the gain term enters and why it under-books. If wrong ΔT — show the ΔT discrepancy. Etc.
2. **Is the operative mechanism single or coupled?** Multiple mechanisms may contribute.
3. **What's the minimum fix?** Smallest engine change that brings effective recovery from ~54% to ~75% on Bridgewater-Box.

Write up the verdict + proposed fix in audit §5. Include before/after pseudocode if the fix is non-trivial.

**DO NOT WRITE CODE IN PART 5.** Diagnostic + design only.

Commit: `Brief 83 P5: MVHR booking discrepancy verdict + proposed fix`.

### Part 6 — Implement the fix

Targeted engine code change per Part 5's design. Smallest viable change. Must:

- Not break any other engine behaviour (regression checks per Part 7)
- Live in the same file + region of source identified in Part 2
- Preserve all v25/v40 fallback patterns established in Brief 76
- Not touch any of the State 2 / State 3 / inline-legacy dispatch logic
- Not add new schema fields except as required to expose recovery diagnostics from Part 4 (already added)

Document the diff in audit §6.

**Hard requirement:** the fix must NOT change anything that affects Finding A (free-float zone temperature solver). If touching State 2's air-node solver becomes necessary, STOP — that's Brief 84 territory, not Brief 83.

Commit: `Brief 83 P6: MVHR recovery booking fix`.

### Part 7 — Re-run Bridgewater-Box comparison

Re-run the full harness end-to-end:
```
python validation/energyplus/run.py
node validation/nza_sim/extract.mjs
python validation/compare.py
```

Capture the new comparison report. Compare against Brief 81's first-rung verdict and Brief 82's expected post-fix state.

**Expected outcomes:**

- **Mech vent net loss:** should now match EP within ±15% (was +93%). This is the headline gate.
- **Cooling demand:** should reduce substantially (was +108%). Some excess may remain due to Finding A coupling.
- **Heating demand:** likely WIDENS slightly (was −24%) as Finding A's float warmth is no longer partially offset by Finding B's vent loss. Expected. NOT a regression.
- **Effective recovery (Part 4 traces):** ~75% on NZA-Sim, matching EP.
- **EUI, fabric, monthly correlations:** unchanged from Brief 81 (no envelope physics touched).

**Honest reporting required.** If mech vent doesn't close, the fix is wrong — go back to Part 5. If heating widens dramatically (e.g. −40%+), Finding A is much bigger than predicted — flag for Brief 84.

Document the new comparison state in audit §7. Include a row-by-row delta table comparing Brief 81 vs Brief 83 post-fix vs EP.

Commit: `Brief 83 P7: post-fix Bridgewater-Box re-validation`.

### Part 8 — Close + Brief 84 handoff

Write Brief 83 close summary in audit §8:

- P2/P3 evidence: source-read findings
- P5 verdict: operative mechanism + proposed fix shape
- P6 diff: actual change
- P7 outcome: comparison delta state
- **Status of Finding B:** closed / partially closed / open
- **Status of Finding A:** unchanged / widened (expected) / surprising movement
- **Recommended Brief 84 scope:** free-float solver characterisation, with current evidence framing

Update STATUS.md on the branch — Brief 83 closed, Brief 84 candidate scope identified.

Commit: `Brief 83 P8: close summary + STATUS update + Brief 84 handoff`.

**Push final state to origin. DO NOT merge to main.**

---

## What MUST NOT happen

- **Any commit, push, or merge to `main`.** All work on `feat/energyplus-validation` only.
- **Any change to the zone air-node solver / State 2 free-float logic.** That's Brief 84.
- **Tuning the fix to make the harness pass.** The fix is determined by Part 5's evidence-based design. If the harness doesn't pass after the fix, the fix is wrong — diagnose, don't tune.
- **Touching anything outside MVHR recovery booking.** No envelope physics, no other systems, no dispatch logic.
- **Skipping Part 2's source read.** The whole brief depends on grounding the fix in evidence, not architect speculation.
- **Forcing Finding A to stay still.** Finding A may widen as Finding B closes. That's expected. Honest reporting required.
- **Spending more than 60 minutes on any single sub-problem before escalating.**
- **Modifying the engine schema in breaking ways.** Part 4's MVHR diagnostic outputs are opt-in, off-by-default.

---

## Hard-STOP triggers

- **P2/P3 source read reveals the operative mechanism doesn't match any of the four predicted candidates.** STOP. Document, escalate. Revised fix scope may be needed.
- **P5 verdict requires touching the air-node solver to fix MVHR booking.** STOP. The two are coupled in ways Brief 82 didn't anticipate. Architect-Chris conversation needed about scope.
- **P6 fix exceeds 30 lines of changed code.** STOP. A targeted MVHR booking fix should be small. Larger changes mean the diagnosis is wrong or scope has crept.
- **P7 mech vent gap doesn't close after fix.** Go back to P5 (one re-diagnostic permitted). If second fix attempt doesn't close, STOP and escalate.
- **P7 reveals unexpected coupling** (e.g. cooling demand swings wildly, or heating swings to >50% gap). STOP. Document. The findings are more coupled than Brief 82 detected.
- **Any indication work has accidentally landed on `main`.** STOP IMMEDIATELY.

---

## What "session success" looks like

Bridgewater-Box's mech vent loss gap closes from +93% to within ±15% of EP. Effective recovery on NZA-Sim now matches nominal 75% HRE (and EP's 82%) within reasonable tolerance. Cooling demand reduces substantially. Heating demand likely widens slightly (Finding A no longer offset). Brief 83 close summary names this state honestly. Brief 84 has clear scope: address Finding A (free-float solver) with the post-Brief-83 numbers as starting state.

---

## What "session partial/failure" looks like

If session ends before P8:
- Whatever's committed gets pushed.
- `WIP_STATUS.md` at branch root explains where things ended.
- Audit captures diagnostic findings even if fix didn't land.

A diagnostic-only outcome (Parts 1-5 complete, Part 6 fix not landed) is still valuable — Brief 83 becomes "Finding B diagnosis", and a Brief 83a follows with the fix.

---

## Authority notes

This brief follows the discipline pattern that's working: source-read first, evidence-grounded fix design, then implement. Code's premise-check authority applies — if the source read reveals the architect's framing is wrong, push back via audit comment and propose the actual fix shape.

The two-finding tension (Finding B closing widens Finding A) is anticipated; honest reporting of that widening is required, not a sign of failure.

---

## Final notes

This brief is the first real engine fix on the EnergyPlus validation branch. The MVHR booking issue has been masked by Finding A's offsetting effect — Brief 82's diagnostic decoupled them, so this fix is the first one we can validate cleanly.

After Brief 83 closes, the Bridgewater-Box harness should show ventilation correctly modeled. Heat balance is closer to honest. Brief 84 then handles the remaining solver-convention question.

Good luck.
