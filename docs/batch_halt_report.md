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
  - `docs/briefs/batch_orchestration_2026_05.md`
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

## Halt 2 — Update 2026-05-14 (Q1-Q3 verification)

Chris asked three diagnostic questions before deciding between Option A and Option C+:

| Q | Answer | Evidence |
|---|---|---|
| 1. Did Part 1 inspect the assembled epJSON, or SQL from a fresh envelope-only EP run? | **Assembled epJSON only.** | `scripts/state1_envelope_only_verify.py` calls `assemble_epjson(..., mode='envelope-only')` and inspects the returned dict. It does not run EP, does not read SQL. |
| 2. Does an envelope-only EP simulation currently exist in `data/simulations/` for Bridgewater? | **No.** | 200 sim dirs on disk; latest is `b1bd69be...` at 2026-05-13 22:21. The `simulation_runs` table has columns `[id, project_id, scenario_name, status, input_snapshot, results_summary, results_monthly, results_hourly_path, envelope_heat_flow, hourly_profiles, sankey_data, annual_energy, energyplus_warnings, energyplus_errors, error_message, simulation_time_seconds, created_at, scenario_id]` — **no `mode` / `simulation_type` column at all.** Mode information could only be reconstructed by parsing `input_snapshot` (a JSON blob). |
| 3. What does `state1_engine_agreement.mjs` pull when it hits `?mode=envelope-only`? | **It re-parses full-sim SQL through the State 1 parser view.** | `state1_engine_agreement.mjs:130-136` picks the most-recent-of-any-mode sim and calls `/balance?mode=envelope-only`. The `?mode=envelope-only` is a *parser dispatch* (re-interpret SQL through the State 1 view), not an EP-execution mode. The SQL itself was generated by an HVAC-clamped EP run. |

## Halt 2 verdict — physics audit attribution was correct after all

My Part 1 conclusion ("envelope-only mode IS practically free-running, so the prereq's premise is wrong") was based on inspecting the **wrong artifact** — the assembled epJSON, not what the engine_agreement script actually pulls.

Reconciled picture:
- The assembler CAN produce envelope-only epJSON (verified Part 1 — modulo the 0.0001 ppl/m² placeholder).
- The `state1_isolation_epjson.py` regression DOES exercise envelope-only end-to-end via a temp dir, but those sims are not persisted to `data/simulations/`.
- All 200 persisted sims in `data/simulations/` are full-mode (HVAC-clamped).
- `state1_engine_agreement.mjs` reuses one of those persisted full-mode sims and re-parses it through the State 1 parser view to get "Dynamic" numbers.
- The physics audit looked at those re-parsed numbers and concluded "Dynamic was HVAC-clamped." **That attribution was correct.** The 23.5% uniform conduction divergence is genuinely Static-truly-free-running vs Dynamic-HVAC-clamped.

**Option A is wrong. Option C+ is right.**

## Halt 2 verdict — proposed Option C+ scope

Re-scoping Brief 28 prereq from "verify + document" to "fix the comparison pipeline so it's actually honest":

1. **Hard-zero the People `people_per_floor_area` in envelope-only mode.** Small cleanup; not load-bearing (0.001% noise floor either way). Worth doing while in the assembler.
2. **Persist an envelope-only EP run for Bridgewater.** Either (a) extend the simulation runner to accept a `mode` param and run with `mode='envelope-only'`, persist the result with a distinguishing marker (column add, or convention in `scenario_name`), or (b) run the existing `state1_isolation_epjson.py`'s COMBINED path against a permanent output dir rather than tempdir. Decide based on API plumbing convenience.
3. **Repoint `state1_engine_agreement.mjs` to use the persisted envelope-only run** by run_id rather than "most recent of any mode." This is a 1-line change once Part 2 ships.
4. **Re-run engine_agreement** with the corrected comparison and capture the actual Static-vs-Dynamic free-running divergence. Update `docs/state_1_engine_divergence_investigation.md` with the new numbers and re-state which findings now hold / which were the HVAC-clamping artefact.

This is materially the prereq as originally scoped, with the addition of Step 1 (zero People) and clarification that Step 2 actually means *persist* an envelope-only run (the original brief was less precise about whether the run had to be persisted).

## Design gap surfaced (not in Halt 2 scope; flagged for follow-up)

The `simulation_runs` table has no mode column. The engine_agreement script's "most recent sim, any mode" heuristic is fundamentally broken when mode matters. Candidate follow-up:
- Add `simulation_mode` column to `simulation_runs` (small migration).
- Or document a convention (e.g., put mode in `scenario_name`, e.g., `'state_1_envelope_only_free_running'` per the prereq's original Part 2 spec).

Logged in `docs/batch_progress_2026_05.md` decisions log as a candidate for Brief 29 Part 3 (constants cleanup) or Brief 28a Part 5 (SQL parser work, since that touches the same surface).

## Awaiting

Chris's explicit "go Option C+" to unhalt and proceed. The four sub-steps above can be executed in order; together they replace the original prereq's Parts 1-4. Estimate: ~1 day of focused work.

---

# Halt 3 — 2026-05-14 (Walkthrough Finding 2: auto-simulate vs Static engine) — RESOLVED 2026-05-14

## Resolution

Chris chose **fix-path (b): gate auto-simulate on user-initiated saves only.**

Shipped:
- `frontend/src/context/ProjectContext.jsx`:
  - Added `saveSource: 'user' | 'system' | null` state.
  - `_scheduleSave(endpoint, body, source = 'system')` now accepts a third arg. Default is `'system'` so a future save call site that forgets to tag itself fails safely (does NOT auto-simulate) rather than triggering a surprise EP run.
  - 5 existing user-edit call sites updated to explicitly pass `'user'`:
    - `updateParam` name branch (line 670)
    - `updateParam` building branch (line 672)
    - `updateConstruction` (line 684)
    - `setComfortBand` (line 706-709)
    - `updateSystem` (line 767)
  - `saveSource` exposed in context value.
- `frontend/src/context/SimulationContext.jsx`:
  - Reads `saveSource` from ProjectContext.
  - Auto-simulate `useEffect` gated on `saveStatus === 'saved' && saveSource === 'user'`.
  - Dep array updated to include `saveSource`.

Verification:
- Build clean (17.50s).
- State 2 Live isolation: 21/21 byte-identical.
- Browser verification pending Chris's walkthrough — when confirmed, batch state flips to `running` and Brief 28a Part 3 unblocks.

Acceptance criteria (from Chris):
- Load project: Static numbers visible immediately, **no Dynamic run firing**.
- Edit a value (e.g., occupancy density): Static updates instant, **Dynamic fires after 2s debounce**.
- No surprise EP runs on project load.

Additionally — per Chris's direction — Brief 28a Part 7 close-out gets a new acceptance gate: a rendering smoketest that asserts canvas views render Bridgewater state2 data without falling into the empty-state branch AND that `gains.internal.*` resolves through `flattenGains`. This is the discipline gap the Brief 27 cleanup miss exposed; documented in `docs/briefs/active/28a_visible_polish.md` Part 7 "Acceptance gate" subsection.

---

# Halt 3 (original) — 2026-05-14 (Walkthrough Finding 2: auto-simulate vs Static engine)

**Halt condition triggered:** SH3-adjacent (perceived performance regression in a "fresh-on-fresh" walkthrough surface; the Static engine itself is healthy, but the user-visible behaviour suggests it isn't, which makes the symptom load-bearing for batch confidence)
**Brief:** 28a (in flight; Part 3 blocked)
**Finding:** Chris's walkthrough reported a ~1-minute delay from "State 1 numbers appear" to "State 2 numbers appear." Investigation:

**Static engine measured cold = 25 ms** on Bridgewater (`scripts/profile_static_engine.mjs`):
```
  state1 cold:  7.8 ms
  state2 cold:  23.5 ms
  warm runs:    state1 1-2 ms, state2 6-17 ms
```

So the engine itself is performant. The "~1 minute" delay is **auto-simulate firing a full Dynamic EP run** in the background:
- `SimulationContext.jsx:59` defaults `autoSimulate = true`
- `SimulationContext.jsx:92-115` triggers `runSimulation()` (POST `/api/projects/{id}/simulate`) 2 seconds after any save
- Save events include project-load normalisations + migrations + every input edit
- Full mode EP runs take ~35-45s
- Status flips to `'running'` during the EP run

The Static engine numbers should appear immediately regardless. If the UI is blocking on Dynamic anywhere, that's a separate UI bug worth tracking. The likely user-visible chain:
1. User loads /gains
2. Project-load normalisation in ProjectContext flips `saveStatus` to `'saved'`
3. 2-second timer kicks off, then auto-simulate begins
4. Network tab shows POST `/api/projects/.../simulate` running for 35-45s
5. User perceives "the tool is loading something" — but it's the Dynamic EP run, not the Static engine

## Three plausible fix-paths

| Option | Change | Pros | Cons |
|---|---|---|---|
| **(a)** Disable auto-simulate by default | `SimulationContext.jsx:59` `useState(true)` → `useState(false)` | Simplest; no surprise EP runs; matches the principle "Static is canonical for editing, Dynamic on demand" | Loses the convenience of automatic Dynamic refresh after edits; user must remember to click Run Dynamic |
| **(b)** Gate auto-simulate on first user edit only | Track whether `saveStatus='saved'` was triggered by user input vs project-load/migration; only fire auto-simulate for the former | Preserves convenience for iterative editing; eliminates the surprise on initial load | Requires distinguishing user-saves from system-saves at the ProjectContext level — small refactor |
| **(c)** UI signalling improvement only | Add a "Dynamic running in background…" indicator, separate from Static-engine state; don't change auto-simulate behaviour | Zero behaviour change; clarifies UX | Doesn't address the underlying surprise; user still waits 35-45s for full EP to complete |

My lean: **(b)**. Auto-simulate is genuinely useful for iterative editing — when the user changes an input, they want Dynamic to refresh without clicking. But auto-simulate firing on project-load normalisation is surprising and produces exactly the "Static engine is slow" misimpression. Tracking the source of the save event is a small ProjectContext change.

Recommendation if (b) chosen: add `saveSource` to ProjectContext (`'user' | 'system'`), set it on each save action, and gate the auto-simulate effect on `saveSource === 'user'`. ~30 minutes of work.

## What's needed from Chris

A verdict on (a) / (b) / (c). The Static engine is fine; this is a fix to the auto-simulate UX, not to the Static engine itself.

## State of the work

- **Working tree:** clean after this commit (Finding 1 fix + corrected close-out doc).
- **Last commit on `main`:** (next push after this halt report update)
- **Files modified to surface the halt:** STATUS.md, batch_progress_2026_05.md, batch_halt_report.md. All are documentation; no code touched for Finding 2.
- **Brief 28a Part 3 remains blocked** until Chris weighs in on the fix-path.

---

## ~~Note on the batch_orchestration path discrepancy~~ Resolved 2026-05-14

~~The supersession notes in the two archived briefs reference `docs/batch_orchestration_2026_05.md`. The actual file is at `docs/briefs/batch_orchestration.md`.~~

**Resolved 2026-05-14:** Per Chris's direction, the file was renamed `docs/briefs/batch_orchestration.md` → `docs/briefs/batch_orchestration_2026_05.md` to match the dated convention used for `batch_progress_2026_05.md`. All five inline references in the codebase have been updated. The supersession notes' paths now resolve correctly.
