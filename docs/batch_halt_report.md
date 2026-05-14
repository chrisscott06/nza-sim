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

## Note on the batch_orchestration path discrepancy

The supersession notes in the two archived briefs reference `docs/batch_orchestration_2026_05.md`. The actual file is at `docs/briefs/batch_orchestration.md`. Chris's instruction used the former path verbatim and I followed it verbatim. Worth resolving — either rename the file to `batch_orchestration_2026_05.md` (matching the dated convention used for `batch_progress_2026_05.md` and `batch_halt_report.md`), or correct the notes' path to point at the actual location. The dated-filename convention is probably what's wanted; happy to rename when Chris confirms.
