# Brief 84a — Harness like-for-like comparison fix (mech-vent on coil-run hours)

**Author:** Claude Chat (architect)
**Authorised by:** Chris (2 June 2026, post-Brief-83 close)
**Authority level:** Same-day, small. Pure harness/comparison-framework change. No engine code touched.
**Design note (canonical):** `84a_design_note.md` (sibling file). Land in repo at `docs/design-notes/84a_harness_likeforlike_fix.md` as part of Part 1.
**Branch:** All work on `feat/energyplus-validation`. NEVER merge to `main` during this brief.
**Companion brief:** Brief 84b (Finding A characterisation) runs separately. They do not depend on each other and can land in either order.

---

## CRITICAL CONTEXT — READ BEFORE STARTING

### What Brief 83 found

The "mech vent net loss +93%" FAIL in Brief 81's comparison report is **not an engine bug.** It is a domain mismatch in the comparison framework:

- **NZA-Sim books mech-vent as a heat-balance term** over all heating-degree hours: `ventUA × (T_setpoint − T_outdoor)` integrated, where `ventUA = flow·ρCp·(1−HRE)` already folds in the nominal 75% HRE.
- **EnergyPlus books mech-vent as an IdealLoads coil OA load** (with HX recovery offset) over coil-run hours only.

These are different physical quantities measured over different hour sets. Comparing them as if they were the same metric is what produced the +93% gap.

**Brief 83 P4's per-hour data is decisive:** in the 4,426 hours where EnergyPlus's coil actually runs, NZA agrees with EP to 3.7% on per-hour recovery. NZA's effective recovery is ~75% — matching the nominal 75% HRE and matching EP. There is no recovery-fraction bug.

The +92.9% gated gap decomposes as:
- **59%** — NZA books a vent loss in free-float hours where EP's coil is off (a different finding — see Brief 84b)
- **36%** — EP's HX warming incoming air in cooling-season hours
- **5%** — shared-hour ΔT-reference difference

100% of the excess lives in free-float hours. The mech-vent metric (as currently constructed) is Finding A viewed through the ventilation-loss line, not an independent bug.

### What this brief does

**One change to the comparison framework: define `mech_vent` as a like-for-like metric over the hour set both engines have actively booking, then re-run.**

Two options for what "like-for-like" means (Code chooses based on what's cleanest in code):

1. **Coil-run hours only.** Restrict both engines' mech-vent comparison to hours where EP's coil is active. NZA's mech-vent over those same hours is summed for comparison. Pairs hour sets directly.

2. **Both engines on demand-domain.** Use NZA-Sim's State-3 demand-domain mech-vent number (which is already coil-run-hours-like in scope) rather than its State-2 heat-balance-domain number. Pairs the engines at the same domain.

Both should produce the same answer (within numerical precision) given Brief 83 P4's finding. Code picks whichever is simpler to implement in `validation/compare.py`.

### What this brief does NOT do

- **No engine code change.** This is harness-only. The mech-vent number NZA-Sim produces internally is correct in both its State-2 and State-3 contexts — it just means different things in different contexts.
- **No tolerance re-tuning.** The tolerances from Brief 81 stay. The fix is to make the metric being compared honest, not to widen tolerance.
- **No touching Brief 84b's territory** (Finding A free-float characterisation). They're separate concerns.
- **No merge to `main`.**

---

## BEFORE DOING ANYTHING

1. **Confirm receipt.** Quote this brief's title and the "What Brief 83 found" paragraph. State tip of `feat/energyplus-validation` (expected: `b955d22` or later if Brief 83 close commits have landed). State tip of `main` (expected: `d8a6207` — unchanged since branch cut).
2. **Read the design note** (sibling `84a_design_note.md`).
3. **Read Brief 83's audit document** at `docs/audit/83_mvhr_recovery_booking.md` — particularly §5 (the decomposition of the +92.9% gap) and §8 (the handoff section identifying this like-for-like fix as the option).
4. **Confirm branch.** `git branch --show-current` returns `feat/energyplus-validation`.
5. **Land brief + design note on disk.** Brief at `docs/briefs/active/84a_harness_likeforlike_fix.md`. Design note at `docs/design-notes/84a_harness_likeforlike_fix.md`. Open audit stub at `docs/audit/84a_harness_likeforlike_fix.md`.

---

## Parts (one commit per part, minimum)

### Part 1 — Brief + design note landing + branch verify

Land brief and design note on disk. Open audit stub.

Commit: `Brief 84a P1: brief + design note landing`.

### Part 2 — Identify cleanest like-for-like definition

Read `validation/compare.py` (the Brief 81 P9 comparison framework) and identify where mech-vent is currently computed. Document in audit §2:

- The current comparison formula (NZA value, EP value, delta calculation).
- Which option (coil-run-hours restriction OR demand-domain pairing) is cleaner given the available data in the harness's normalised JSON outputs.
- The proposed implementation: which field swaps in, which field swaps out, any need for new fields from `validation/{engine}/results/*.json`.

If new fields are needed from either engine's output JSON, document. The opt-in MVHR diagnostic outputs from Brief 83 P4 should already provide everything needed (coil-run-hour flags, per-hour recovery values, etc.) — verify.

Commit: `Brief 84a P2: like-for-like definition choice + impl plan`.

### Part 3 — Implement the comparison fix

Edit `validation/compare.py` to apply the chosen like-for-like definition for the mech-vent metric. Smallest viable change. Must:

- Not change any other metric's comparison logic
- Not change tolerances
- Not touch any NZA-Sim or EnergyPlus code (engine or IDF)
- Add a comment in the comparison code referencing the design note explaining why the metric is paired this way

Document the diff in audit §3.

Commit: `Brief 84a P3: like-for-like mech-vent comparison`.

### Part 4 — Re-run harness, verify

Re-run the full harness end-to-end:
```
python validation/energyplus/run.py
node validation/nza_sim/extract.mjs
python validation/compare.py
```

Capture the new comparison report. Expected outcome:

- **Mech-vent metric:** moves from +93% FAIL to ~+3.7% PASS (Brief 83 P4's measured agreement).
- **All other metrics:** unchanged. EUI, fabric, monthly correlations, heating demand, cooling demand, infiltration, solar, internal gains, zone temp — all identical to Brief 81/83 post-state.

**If mech-vent doesn't land near +3.7%, the like-for-like pairing isn't quite right** — back to P2 to refine. (Brief 83 P4 measured 3.7% agreement on coil-run hours specifically, so any deviation means the pairing is off, not the engines.)

**If any other metric moves, the implementation has leaked into other comparisons** — STOP and diagnose.

Document the new comparison state in audit §4. Include a row-by-row comparison: Brief 81 report vs Brief 84a report.

Commit: `Brief 84a P4: post-fix harness re-run + verification`.

### Part 5 — Close

Write Brief 84a close summary in audit §5:

- P2 evidence: chosen like-for-like definition + reason
- P3 diff
- P4 outcome: harness state pre/post
- **Bridgewater-Box validation state:** how many of the original 7 tolerances now pass
- Confirmation that no engine code or IDF was touched
- Confirmation that `main` untouched at `d8a6207`

Update STATUS.md on the branch — Brief 84a closed.

Commit: `Brief 84a P5: close summary + STATUS update`.

Push to origin. **DO NOT merge to main.**

---

## What MUST NOT happen

- **Any commit, push, or merge to `main`.**
- **Any change to engine code** (`instantCalc.js`, `systemsEngine.js`, anything in `frontend/src/utils/`). This is harness only.
- **Any change to the EnergyPlus IDF.**
- **Tolerance re-tuning.** The fix is to make the metric honest, not the tolerance lenient.
- **Touching any other metric's comparison logic.** Only mech-vent.
- **Spending more than 60 minutes on any single sub-problem before escalating.**

---

## Hard-STOP triggers

- **P4 mech-vent doesn't land near +3.7%.** Go back to P2 once to refine pairing. If second attempt still off, STOP — the like-for-like definition is harder than Brief 83 P4's data suggested.
- **P4 any other metric moves from Brief 81 baseline.** STOP and diagnose. Implementation has leaked.
- **Any indication work has landed on `main`.** STOP IMMEDIATELY.

---

## What "session success" looks like

Bridgewater-Box's comparison report shows mech-vent now passing (~3.7% delta vs +93% before). The number of passing tolerances increases by 1 with no engine work — bookkeeping correction, not engineering. The audit document records what changed and why. Brief 84b (Finding A characterisation) is unaffected and proceeds in parallel.

---

## Final notes

This brief is short and bounded. Its value is honesty: the comparison report stops lying about a bug that doesn't exist. The real underlying question (Finding A's float warmth) is properly framed in Brief 84b as its own investigation, not buried inside a misnamed mech-vent FAIL.

The architect notes for the record: this fix was identified by Code in Brief 83 P5/P8 from per-hour evidence. The architect's prior framing (Brief 82's "Finding B = recovery booking bug", Brief 83's "fix the 54% effective recovery") was wrong, and Code's source-read + premise-check discipline caught it. This brief implements the correction Code's evidence already named.
