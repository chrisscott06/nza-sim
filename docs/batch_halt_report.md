# Batch Halt Report — 2026-05-14

**Halt condition triggered:** HH4 (premise question — applied pre-work, by user direction rather than by Claude finding)
**Brief:** 27 cleanup
**Part:** 1 (Heat Balance prop bug fix) — **halted before start**
**Specific issue:** The UX audit (`docs/ux_audit_2026_05.md`) identified a prop-name mismatch at `frontend/src/components/modules/gains/canvas/HeatBalanceView.jsx:45` (`balance=` passed where `liveData=` is expected) as the BLOCKING root cause of the Heat Balance tab showing "no data — load a project" on a fully-loaded Bridgewater. Brief 27 cleanup Part 1 is scoped on the basis of that finding. Chris has raised a concern that the symptom the audit observed may not be a separate prop-name bug — it may be the same race condition in `useStateComparison.js` that was already fixed in commit `4f4f3a5` (Brief 27 close-out, bug 3: shared in-flight promise pattern replacing the module-level `_libraryDataCache`). If the audit was inspecting a state of the code from before that fix landed, or was reading the file statically without verifying runtime behaviour, the proposed "fix" in Part 1 could be a no-op at best or could re-introduce the race symptom at worst. Verification is required before any code change.

## What was attempted

Pre-flight checks were run per the orchestration doc's starting checklist. All state-isolation regressions passed (State 1 Live 40/40, State 1 EP 41/41 including end-to-end, State 2 Live 21/21, State 2 EP 21/21). Frontend build clean. `current.md` updated to point at `active/27_cleanup.md`. Orchestration doc ordering corrected. Two stale brief files moved to archive with `SUPERSEDED` suffix and supersession notes prepended. Batch was about to enter Brief 27 cleanup Part 1 when Chris halted.

No code changes were attempted in `HeatBalanceView.jsx`. No commits made this session.

## What's blocking

The Heat Balance bug needs to be characterised correctly before any fix. Specifically:

1. Does `HeatBalanceView.jsx:45` currently pass `balance=` to a child component, and does that child component declare `liveData` as its expected prop name? (Static inspection.)
2. Is the "no data — load a project" empty state actually reproducible on the current `main` branch with Bridgewater loaded? (Runtime verification.)
3. If both 1 and 2 are true: was commit `4f4f3a5` insufficient — i.e., did the race-condition fix make the data fetch succeed but a separate prop-name bug means the data never reaches the consumer? Or was 4f4f3a5 itself the prop-name fix that's already in place, and the audit was reading the file pre-fix?
4. If 1 is true but 2 is not (i.e., the static signature looks wrong but runtime works): the audit has misclassified the issue; the prop-name observation may be a non-issue and the Part 1 fix should be dropped.

Answers to those four determine whether Part 1 fires as written, fires with different scope, or gets removed from Brief 27 cleanup entirely.

## What's needed from Chris

A verdict on how to proceed. Three plausible directions:

- **Direction A — Verify and proceed.** Claude inspects `HeatBalanceView.jsx:45` and the consumer component, reproduces (or fails to reproduce) the empty state on a loaded Bridgewater, and reports findings. Chris then signs off the Part 1 scope (as written, modified, or dropped) before any code change.
- **Direction B — Chris verifies in browser himself.** The runtime check is the load-bearing part; Chris navigates to /gains → Heat balance on Bridgewater and confirms the symptom (or its absence). Faster than Claude reasoning about a UI bug from static reading.
- **Direction C — Drop Part 1, proceed to Part 2.** If Chris is confident the audit was wrong about this one (e.g., he remembers verifying Heat Balance worked after the 4f4f3a5 fix), Part 1 is removed from Brief 27 cleanup and the batch starts at Part 2 (divergence doc correction), which is independent of the Heat Balance question.

Default behaviour: wait. No work proceeds until Chris responds.

## State of the work

- **WIP branch:** none created. The orchestration setup is in the working tree but not committed. Creating a WIP branch felt heavy-handed for what's effectively batch infrastructure, but happy to commit to a branch if Chris prefers.
- **Last clean commit:** `5f6cd83` — "Brief 27 close-out finalisation: archive renames + Brief 28/29 split"
- **Files modified but not committed:**
  - `STATUS.md` (modified) — Brief 28/29 split narrative from previous session, itself now superseded by the May 2026 batch and will need a refresh once the batch starts moving
  - `docs/briefs/current.md` (modified) — now points at `active/27_cleanup.md` with batch state table
  - `docs/briefs/Brief_28_Cross_Cutting_Polish.md` (deleted — moved to archive)
  - `docs/briefs/Brief_29_Building_Module_Completion.md` (deleted — moved to archive)
- **Files newly created (untracked):**
  - `docs/briefs/batch_orchestration.md`
  - `docs/briefs/active/27_cleanup.md`
  - `docs/briefs/active/28_prereq_free_running_ep.md`
  - `docs/briefs/active/28a_visible_polish.md`
  - `docs/briefs/active/28b_physics_overhaul.md`
  - `docs/briefs/active/29_building_completion.md`
  - `docs/briefs/archive/28_Cross_Cutting_Polish_original_plan_SUPERSEDED.md`
  - `docs/briefs/archive/29_Building_Module_Completion_original_plan_SUPERSEDED.md`
  - `docs/physics_audit_2026_05.md`
  - `docs/ux_audit_2026_05.md`
  - `docs/batch_progress_2026_05.md` (this run)
  - `docs/batch_halt_report.md` (this file)
  - `scripts/audit_physics_helpers.mjs`

None of the uncommitted state is speculative or experimental — it's all orchestration + audit deliverables. Safe to commit as-is when Chris is ready.

---

## Resolution — 2026-05-14

**Resolved.** Chris ran Direction B (browser verification) and confirmed:
- `HeatBalance.jsx:509` destructures `liveData` as its data prop
- `HeatBalanceView.jsx:45` passes `balance={state2}` — the prop is never read
- Empty-state branch at `HeatBalance.jsx:595` fires: "No heat balance data available — load a project"
- The `4f4f3a5` race-condition fix governs the *"Loading constructions library"* state in `HeatBalanceView.jsx` itself (line 21). That fix was correct and necessary. Once it unblocked `ready`, the code path reached line 45 where the prop-name mismatch became the next-layer failure.

The two bugs are sequential, not duplicates. Brief 27 cleanup Part 1 proceeds as written, with the small refinement that the wrapper also drops `mode="envelope-gains"` (not a prop the consumer accepts). Batch state flipped to `running`.

---

---

# Halt 2 — 2026-05-14 (Brief 28 prereq Part 1)

**Halt condition triggered:** HH4 (premise concern — surfaced during Part 1 verification work)
**Brief:** 28 prereq (`docs/briefs/active/28_prereq_free_running_ep.md`)
**Part:** 1 (Verify the assembler's free-running mode) — partial work done, halted before completion
**Specific issue:** Part 1's verification (via new `scripts/state1_envelope_only_verify.py`) found that the Dynamic envelope-only mode **is already wide-band** (−60/+100 °C setpoints, no real systems, no operable windows). This contradicts the physics audit's attribution that motivated Brief 28 prereq in the first place — that previous Static-vs-Dynamic comparisons had been Static-free-running vs Dynamic-HVAC-clamped. They were actually free-running on both sides all along (modulo a 35 W placeholder People gain at 0.0001 ppl/m² — 0.001% of zone load, well below EP's heat-balance noise floor).

If the audit's "Dynamic was HVAC-clamped" attribution was wrong, then:
- The 23.5% uniform conduction divergence has a different cause (not HVAC clamping).
- The Brief 28 prereq's goal — "persist a free-running EP run so engines compare honestly" — is moot, because the free-running EP run already exists in regression infrastructure (`scripts/state1_isolation_epjson.py` end-to-end COMBINED scenario does exactly this).
- The downstream re-scope checkpoint in Part 4 of the prereq, which was designed to fire when comparing engine outputs reveals a different picture, fires earlier — *at Part 1*.

Full verification findings: `docs/state_1_free_running_verification.md`.

## What was attempted

1. Read `nza_engine/generators/epjson_assembler.py` around line 1358. Confirmed the envelope-only setpoint constants exist and reference `state1_heating_setpoint` (−60 °C) / `state1_cooling_setpoint` (+100 °C).
2. Followed the call chain through `_build_hvac_ideal_loads` to confirm thermostats actually reference those setpoints.
3. Wrote `scripts/state1_envelope_only_verify.py` to inspect the assembled epJSON for the four Part 1 properties (wide setpoints, no gains, no operable windows, no real systems).
4. Wrote `scripts/state1_envelope_only_inspect_gains.py` to drill into the People/Lights/Equipment object magnitudes when the strict check failed.
5. Ran both scripts on the current Bridgewater config. Setpoints, operable windows, real systems all clean. Gain objects emitted with near-zero magnitudes (Lights/Equipment at 0.0 W/m², People at 0.0001 ppl/m²).
6. Documented findings in `docs/state_1_free_running_verification.md`.

No code changes attempted. No commits yet from this part — the halt commit captures what was found.

## What's blocking

The prereq's premise. Chris's instruction at batch start was "proceed without further input until you reach a halt condition." This is a halt condition. Specifically:

The physics audit's recommendation FIX_REQUIRED #1 was "Run and persist a true `mode=envelope-only` EP simulation for Bridgewater. The State 1 vs Sim comparison currently feeds the parser an HVAC-clamped T_air trace." Verification now shows the comparison was **not** feeding the parser an HVAC-clamped trace. The assembler emits an envelope-only epJSON that EP executes with wide-band setpoints, returning a free-running zone temperature trace. The current `scripts/state1_engine_agreement.mjs` is already pulling free-running outputs from both sides.

If that's correct, then:
- Brief 28 prereq Parts 2-3 (run + persist a free-running run, update engine_agreement) are redundant — the work is already done.
- Brief 28 prereq Part 4 (re-scope check) is moot — the audit's premise was wrong.
- The 23.5% uniform conduction divergence remains unexplained.

## What's needed from Chris

A verdict on the four resolution options below.

**Option A — Brief 28 prereq is moot; remove from batch.** If the verification stands, the prereq's work was already done. Update progress doc to mark the prereq cancelled-as-redundant. Move directly to Brief 28a. Update the physics audit doc to note that FIX_REQUIRED #1 was based on an incorrect attribution.

**Option B — Investigate the 23.5% conduction divergence's real cause.** With HVAC-clamping ruled out, the divergence must come from somewhere else. Candidates:
- Different thermal mass treatment (lumped two-node vs full CTF — the physics audit's other finding)
- Different infiltration model (Live's ACH vs EP's AirChanges)
- Different ground-coupling treatment
- Different solar-gain absorption fractions
- The 35 W placeholder People gain in envelope-only — unlikely given magnitude but worth ruling out

Re-scope the prereq into "investigate the real cause of the 23.5% divergence." Rewrite Parts 1-4 accordingly.

**Option C — Hard-zero the People density in envelope-only mode, then proceed.** The 0.0001 ppl/m² is the only ambiguity. Change the assembler to emit `people_per_floor_area: 0.0` (or skip the People object entirely) when `mode='envelope-only'`. Re-run the engine_agreement script to see if any of the divergence shrinks. If it shrinks meaningfully, the placeholder was confounding the comparison. If it doesn't shrink (likely), confirm Option A and move on.

**Option D — Investigate why People is at 0.0001 rather than 0.0.** Git-blame the relevant assembler code, find out whether (a) EP requires non-zero density, (b) it's an oversight, or (c) it's a deliberate test hook. Decision (Option A vs B vs C) follows from the answer.

My lean: **Option C first** (~30 min), then re-run the engine_agreement to see if the placeholder accounts for anything. If not (likely), Option A. If yes, Option B with the new attribution.

But this is a scope decision and Chris should weigh in.

## State of the work

- **WIP branch:** none. All exploratory work landed on `main` (no destructive changes; only added two diagnostic scripts and a findings doc).
- **Last commit on `main`:** `a26b0b9` (Brief 27 cleanup close-out)
- **Files created this part (will be committed alongside this halt report):**
  - `scripts/state1_envelope_only_verify.py` — the 4-check verification script
  - `scripts/state1_envelope_only_inspect_gains.py` — the magnitude inspector
  - `docs/state_1_free_running_verification.md` — full Part 1 findings (the deliverable Part 1 was meant to produce regardless of pass/fail)
- **State isolation regressions:** unaffected (no engine code changed; only new diagnostic scripts and docs added). Still 40/40 + 41/41 + 21/21 + 21/21 as confirmed at Brief 27 cleanup close-out.

---

## Note on the batch_orchestration path discrepancy

The supersession notes in the two archived briefs reference `docs/batch_orchestration_2026_05.md`. The actual file is at `docs/briefs/batch_orchestration.md`. Chris's instruction used the former path verbatim and I followed it verbatim. Worth resolving — either rename the file to `batch_orchestration_2026_05.md` (matching the dated convention used for `batch_progress_2026_05.md` and `batch_halt_report.md`), or correct the notes' path to point at the actual location. The dated-filename convention is probably what's wanted; happy to rename when Chris confirms.
