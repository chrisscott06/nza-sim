# Brief 88 — Strategy baseline state-sync (diagnostic + targeted fix)

**Branch:** `chris/interventions-rework-ux` (same branch as Brief 87; both close before single PR to `main`)
**Design note (canonical):** `88_design_note.md` — sibling file. Land as `docs/design-notes/88_strategy_baseline_state_sync.md` at Part 1's first commit. **Where this brief and the design note disagree, the design note wins** (Bible rule).
**Author:** Claude Chat (architect)
**Authorised by:** Chris (26 June 2026)
**Brief number:** TBC on landing. Likely 88, sequential after Brief 87.

---

## BEFORE DOING ANYTHING

- [ ] **Confirm receipt.** Quote this brief's title and the Goal paragraph back to Chris (Bible Brief sync rule 1).
- [ ] **Read this brief in full, plus the design note.** Sibling file `88_design_note.md`. Design note is canonical.
- [ ] **Read repo `CLAUDE.md` and `STATUS.md`** at branch root.
- [ ] **Confirm clean working tree, origin in sync.** `git status`, `git fetch --all`, `git log --oneline -20`.
- [ ] **Confirm branch.** `git branch --show-current` returns `chris/interventions-rework-ux`. NOT `main`. NOT `feat/energyplus-validation`. NOT a new branch — this brief lands on the existing Brief 87 branch.
- [ ] **Read the existing engine source — required for Part 2 audit.**
  - `frontend/src/utils/instantCalc.js` — full file, but specifically the State 3 dispatch (~L4914 + L6669 per memory) and the call site of `_runInterventionStack`.
  - `frontend/src/utils/interventionsEngine.js` — `runInterventionStack` function (already audited by Claude Chat; reference docstring at top of file).
  - `frontend/src/components/modules/interventions/InterventionsModule.jsx` — the `calculateInstant` call site that consumes the stack.
  - `frontend/src/components/modules/interventions/StrategyView.jsx` — where the "Baseline 245.6" display value is rendered (reads `cumulative_delta.eui_kwh_per_m2.from`).
  - The SystemsModule entry point — to compare `calculateInstant` options between the two modules.
- [ ] **Read existing design notes.** Brief 76 (v40 dispatch fix) is the closest precedent; the diagnostic in this brief is hunting for a similar bug-family on a different consumer call site.
- [ ] **Run session-start reconciliation pass** (Bible Brief sync rule 3): `ls docs/briefs/active/`, `cat docs/briefs/current.md`, `tail STATUS.md`, `git log --oneline -20`. Cross-check `active/` against `current.md` against the most recent close commit. Note: Brief 87 may still be in `active/` (Part 6 cleanup / Part 7 walkthrough pending). Both briefs co-exist on the branch until they close together.
- [ ] **Land this brief on disk** at `docs/briefs/active/88_strategy_baseline_state_sync.md` as Part 1's first commit. Design note at `docs/design-notes/88_strategy_baseline_state_sync.md` in the same commit.

---

## GOAL

The Interventions → Strategy page's "Baseline EUI" must equal the Systems page's EUI at all times, for the same project state. Currently they disagree by ~100 kWh/m²·yr on Bridgewater (Systems shows 139.5; Strategy shows 245.6). This is a state-sync bug, not a design choice — NZA-Sim's product proposition is the live interactive engine, so any divergence between modules viewing the same building is a fault. Diagnose with source-read evidence (Tier-2 audit), fix with the smallest possible change, verify with a falsifiable visual gate: tweak any input in Systems, switch to Strategy, observe baseline track. As a bonus thread, audit and (if small) fix the persistent "Save failed" indicator surfaced in the same testing session.

---

## SCOPE

### IN
- **Thread A (diagnostic, read-only):** Source-read `instantCalc.js` State 3 dispatch and the `_runInterventionStack` call site. Document what options the inner `runEngine` closure passes through to `calculateInstant` when running the baseline pass. Compare to the SystemsModule's main `calculateInstant` options. Identify the divergence point with file + line evidence.
- **Thread B (targeted fix):** Smallest possible change that makes the Strategy waterfall's leftmost bar exactly equal the Systems page's EUI for the same project state. Probably a single option flag passed through one closure; if larger, escalate.
- **Thread C ("Save failed" audit):** Read-only diagnostic of the save endpoint failures via browser dev tools. Identify failing request, HTTP code, cause. Fix in this brief if small; escalate if architectural.

### OUT
- **No Calc Trail restructure.** Separate UX brief, blocked by this one (trying to improve trail presentation while headline numbers are wrong is sand-on-sand).
- **No DHW-occupancy audit.** Separate engine question raised in Brief 87 walkthrough; captured for a follow-on.
- **No engine architectural changes.** Brief 41's declarative-patches model and `runInterventionStack` contract are not modified.
- **No frozen-baseline feature.** Live read is the locked principle.
- **No re-running Brief 87's UX rework.** Part 4/5 components stay as they are.
- **No work on `main`, `feat/energyplus-validation`, or a new branch.** Same branch as Brief 87.
- **No `npm install` pushed, no `package-lock.json` changes, no `node_modules` modifications** (Bible Claude Code rule).

---

## DESIGN DECISIONS ALREADY AGREED

Resolved with Chris in conversation, locked here so any agent resolves ambiguity in the right direction:

1. **Live baseline everywhere.** The Strategy waterfall's baseline EUI must equal the Systems page's EUI at all times. No frozen snapshots. No "capture baseline" feature. NZA-Sim's interactive-engine product proposition is non-negotiable.
2. **Diagnostic first, then fix.** Bible's "audit before fix" discipline. Part 2 produces evidence-grounded findings before any code change.
3. **Smallest fix possible.** The leading hypothesis is a single option flag missing from one closure (Brief 76 bug-family on a different call site). If the fix turns out to be larger than ~20 lines, STOP and escalate — that's a sign the diagnosis is wrong or scope is creeping.
4. **No frozen baselines for NZA-Sim, ever.** Frozen baselines only become relevant when the EnergyPlus-as-canonical-results layer lands (Brief 87 / Brief 88 territory in the roadmap, not numbered yet). That's a different architecture for a different engine.
5. **Brief 87 close blocks on Brief 88.** Both briefs co-exist on `chris/interventions-rework-ux`. Single PR to `main` after both close. Don't merge Brief 87 with this bug still live.
6. **"Save failed" is part of this brief if and only if the fix is small.** If the cause turns out to be a payload-shape issue or a missing field in the post-Brief-87 schema change, fix here. If it's a deeper API contract change, escalate to a separate brief and leave the indicator in place.

---

## PRINCIPLES / CONSTRAINTS

- **One Part = one commit.** Including `STATUS.md` and any audit-doc update in the same commit.
- **Engine output is canonical** (Bible). Never tweak engine numbers to make modules agree. The fix is to make sure both modules are calling the engine the same way; the engine's output is whatever it is.
- **Variable boundaries stay explicit** (Bible Boundary-mismatch principle). When confirming that two engine call sites produce the same EUI, name the boundary: both should read `consumption.total.kwh_per_m2_yr` from a State 3 result. Not demand. Not pre-systems. Not inline-legacy degree-day EUI. Same field, same physical boundary, same dispatch path.
- **Visualisation-as-verification** (Bible rule). The final test is visual: tweak a slider in Systems, switch to Strategy, watch the baseline number update in real time to match. Not "the code looks right". Not "the test passes". The visual is the test; the prediction is "they track together"; the engine output is the truth.
- **Clean up before building** (Bible rule). If the fix involves deleting a redundant closure or option-threading helper, delete it cleanly. No commented-out blocks, no dead imports.
- **No engine work without an audit-before-fix doc** (Bible rule). Part 2 is read-only audit; Part 3 is the fix the audit prescribes. If Part 2's findings don't justify Part 3's fix, STOP and revise.
- **Performance discipline** (Bible). The fix must not add new engine passes per UI interaction. If the bug is "the engine is running twice with different options", the fix is to make both runs use the same options — not to add a third run.

---

## PARTS (each = one commit)

### Part 1 — Brief landing + design note landing + branch verify

- Confirm branch is `chris/interventions-rework-ux` and Brief 87 is still in `active/` (or has just landed in `archive/` — note state in audit).
- Land this brief at `docs/briefs/active/88_strategy_baseline_state_sync.md`.
- Land the design note at `docs/design-notes/88_strategy_baseline_state_sync.md`.
- Open an audit-doc stub at `docs/audit/88_strategy_baseline_state_sync.md` with sections for Parts A/B/C to fill in.
- Update `STATUS.md`: Brief 88 opened alongside Brief 87.
- Update `docs/briefs/current.md` to point at this brief.

**Commit:** `Brief 88 P1: brief + design note landing + audit stub`

### Part 2 — Source-read diagnostic (Tier-2 audit, READ-ONLY)

This is the audit part. **No code changes in Part 2.**

Read the source and document in audit §A with file + line references. Answer in order:

**A1 — What does the SystemsModule actually call?**
Find the `calculateInstant(…)` call in the Systems module. Document:
- Exact function call signature
- All option flags passed (mode, comfortBand, engine, _skipInterventions, anything else)
- Which result field is read for the EUI display (the 139.5 number)

**A2 — What does the InterventionsModule actually call?**
Find the `calculateInstant(…)` call in `InterventionsModule.jsx`. Document:
- Exact function call signature
- All option flags passed
- Which result field feeds `stackResult.baseline` → which feeds `cumulative_delta.eui_kwh_per_m2.from` → which the Strategy waterfall renders

**A3 — Inside `calculateInstant`, where is `runInterventionStack` called?**
Find the call site of `_runInterventionStack` in `instantCalc.js`. Document:
- File + line
- The `baselineConfig` argument: what shape, what fields, where does it come from inside `calculateInstant`?
- The `runEngine` closure: how is it built? What does it pass to its inner `calculateInstant` call (or wherever it routes)?
- Critically: does the inner closure preserve `engine: 'v2.5'` (or the equivalent v40-routing flag)? Does it preserve `comfortBand`? Does it preserve all the other options that the outer call has?

**A4 — Where does the divergence open?**
Based on A1–A3, identify the specific line where the two pages take different code paths. Ranked hypotheses with evidence:

- **Hypothesis 1 (leading):** The inner `runEngine` closure drops `engine: 'v2.5'` (or equivalent), so `rollingResults[0]` falls through to inline-legacy. Confirmed if A3 shows the closure built with a `_skipInterventions: true` flag but without the v2.5 flag.
- **Hypothesis 2:** The closure preserves all options but the `baselineConfig` shape is wrong — maybe missing `systems_config_v40` or similar. Confirmed if A3 shows a `baselineConfig` that's been stripped of system config fields.
- **Hypothesis 3:** The closure is correct but `consumption.total.kwh_per_m2_yr` is computed differently in the outer pass vs the inner stack pass. Confirmed by manually computing what each path would produce on Bridgewater.
- **Hypothesis 4:** Save failures (Thread C) are causing stale state. Confirmed if A1's params and A2's `paramsForEngine` resolve to different values from `ProjectContext`.

**A5 — Recommended fix shape.**
Smallest possible change that closes the gap. Should be a one-line option-passthrough fix if Hypothesis 1 is right; bigger if it's something else.

**Critical:** if reading the source reveals the bug isn't where the brief assumed — for example, if the inner closure looks fine but the divergence comes from elsewhere — **push back via audit comment, document the actual root cause, propose revised fix scope.** Same premise-check authority as Briefs 76, 83, 84a/b. The architect's hypothesis above is best-effort from partial source-read; Code's full local read is the verifier.

**Commit:** `Brief 88 P2: state-sync diagnostic (read-only audit)`

### Part 3 — Apply the fix Part 2 prescribes

Implement the smallest change Part 2 identifies. Constraints:

- Must not change the engine's `interventionsEngine.js` contract (the stack runner is fine; the fix is in the caller).
- Must not change `runInterventionStack`'s signature or behaviour.
- Must not change Brief 87's UX components (StrategyView, PerInterventionView, etc.).
- Must not introduce a new engine mode or option flag — preferably reuse an existing one.
- Should be ≤20 lines of changed code. If it's bigger, STOP and escalate.

Document the diff in audit §B with before/after snippets and explanation of why this fixes the divergence Part 2 identified.

**Commit:** `Brief 88 P3: state-sync fix per Part 2 audit`

### Part 4 — Verify with the falsifiable visual gate

Boot the dev server. Load Bridgewater (or whatever project state currently has the bug). Capture, via MCP browser tools:

1. **Systems page EUI.** Read the headline number. Record it.
2. **Switch to Interventions → Strategy.** Read the "Baseline EUI" in the Strategy header and the leftmost bar of the waterfall. Record both.
3. **Confirm all three match.** Systems EUI = Strategy header baseline = waterfall leftmost. Within rounding (≤ 0.1 kWh/m²·yr).
4. **Tweak an input in Systems.** Nudge a heating SCOP. Note the new Systems EUI.
5. **Switch back to Strategy.** Confirm both the Strategy header baseline AND the waterfall leftmost have updated to match the new Systems EUI.
6. **Tweak something else.** Widen a setpoint, change ventilation flow, whatever. Confirm Strategy tracks Systems every time.

Document each step in audit §B verification with screenshots and the actual numbers observed.

**Falsifiability:** if ANY of steps 3–6 produce a mismatch, the fix is wrong — go back to Part 2 (Bible rule: one re-diagnostic permitted). If second attempt also fails, STOP and escalate.

**Commit:** `Brief 88 P4: falsifiable verification of state-sync fix`

### Part 5 — "Save failed" audit + fix-if-small

Read-only diagnostic first. In the browser dev tools network tab during a normal session, capture:

- Which endpoint is returning the "Save failed" indicator
- HTTP response code (4xx vs 5xx)
- Request payload shape
- Response body / error message
- Whether the failure is on every save attempt or intermittent

Document findings in audit §C. Then:

- **If cause is small** (payload-shape issue, missing field added in Brief 87's schema change, off-by-one in a serialiser, etc.): fix in this brief. Document the fix as part of audit §C.
- **If cause is architectural** (API contract change needed, server-side validation logic broken, data model migration required): escalate. Leave the indicator in place. Surface the finding to Chris with recommended scope for a follow-on brief.

**Falsifiability:** if fixed in this brief, the "Save failed" indicator must not appear in any normal session. Verify with: refresh project, edit any input, save, confirm no failure indicator.

**Commit:** `Brief 88 P5: save-failed diagnostic + fix (if small)` OR `Brief 88 P5: save-failed diagnostic (escalated to follow-on)`

### Part 6 — Close

- Browser walkthrough complete; screenshots captured at audit §B and §C (if fixed).
- Chris runs the walkthrough manually before close commit.
- After Chris signs off: `git mv docs/briefs/active/88_strategy_baseline_state_sync.md docs/briefs/archive/88_strategy_baseline_state_sync_COMPLETED.md`. Update `STATUS.md` close-out (handover-ready, written for a stranger picking up cold). Update `docs/briefs/current.md` to next brief or "none active." Single push.
- **DO NOT open the PR to `main` yet** — Brief 87 must also close first. PR opens when both briefs are in `archive/`.

**Commit:** `Brief 88 P6: close — state-sync bug fixed; pending Brief 87 close for PR to main`

---

## VERIFICATION (non-negotiable, falsifiable)

- **The 139.5 vs 245.6 divergence is closed.** Systems EUI and Strategy baseline EUI agree within ≤ 0.1 kWh/m²·yr on Bridgewater. Screenshot proof.
- **Live tracking confirmed.** Tweaking any input in Systems causes the Strategy baseline to update in real time on next navigation. Screenshot proof of at least three different inputs (heating SCOP, cooling setpoint, ventilation flow, occupancy, anything) producing matching changes on both pages.
- **No engine numbers move on `main`.** This is a branch-only fix; `main`'s Brief 77 anchor (EUI 143.5 / heating 98.3 / cooling 53.1 / mech vent 326.0 / DHW 263.2) is unaffected. Confirmed by checking out `main` after the fix lands and observing identical Bridgewater values.
- **No engine code architectural changes.** `git diff main...HEAD -- frontend/src/utils/interventionsEngine.js` returns nothing (interventions engine contract preserved). `git diff` on `instantCalc.js` shows only the minimal option-passthrough fix Part 2 prescribed, with no other behaviour changes.
- **"Save failed" indicator resolved OR explicitly escalated.** Either the indicator no longer appears in normal use (Part 5 fix landed), or audit §C contains an explicit escalation note with recommended follow-on scope.
- **No `package-lock.json` or `node_modules` changes pushed.**
- **CLAUDE.md updated** if any rule changes are warranted by what the audit finds (likely none for this brief).
- **STATUS.md close-out is handover-ready** (written for a stranger picking up cold per Bible rule).

---

## WHAT MUST NOT HAPPEN

- **Any commit, push, or merge to `main`.** Branch-only until both Brief 87 and Brief 88 close.
- **Any engine architectural change.** Brief 41's declarative-patches model and `interventionsEngine.js` API stay untouched. The fix is in the caller's option-passthrough, not in the engine.
- **Any change to Brief 87's UX components** (Library page, Strategy page layout, the two-section per-intervention view, the drag-and-drop reorder, the Heat Balance compare view). Brief 87's work stays as it is.
- **Adding a "frozen baseline" feature, a "snapshot project state" feature, or any equivalent.** Live read is the locked principle.
- **Tuning numbers to make Systems and Strategy agree.** The fix is to make both pages call the engine the same way. The engine's output is canonical; if the numbers disagree, the call sites disagree, not the physics.
- **Skipping the Part 2 audit.** No code changes before the source-read is documented.
- **Modifying the engine schema in any way.** Schema version stays.
- **`npm install` pushed, `package-lock.json` modified, `node_modules` changes** (Bible Claude Code rule).
- **Quiet scope expansion.** If Part 2's audit reveals a bigger problem than this brief's scope handles, STOP and escalate. Don't quietly fix more than the brief authorises.
- **Spending more than 60 minutes on any single sub-problem before escalating.**

---

## WHEN TO ESCALATE / STOP

- **Part 2 audit reveals the divergence is NOT from option-passthrough.** STOP. The architect's hypothesis is wrong. Document the actual cause, propose revised fix scope, ask Chris before continuing.
- **Part 3 fix exceeds ~20 lines.** STOP. A targeted option-flag fix should be small. Larger changes mean the diagnosis is wrong or scope has crept.
- **Part 4 verification shows the gap doesn't close.** Go back to Part 2 (one re-diagnostic permitted). If second attempt still fails, STOP — there's something deeper.
- **Part 4 verification shows Systems and Strategy agree at one moment but drift apart when inputs change.** STOP — the fix is incomplete; there's a state-sync issue beyond what was diagnosed.
- **Part 5 "Save failed" cause is architectural** (not a small payload fix). Escalate; do NOT widen this brief.
- **The audit reveals that Brief 87's Library/Strategy split itself has a latent state-sync bug** (e.g. the migration created the Strategy with wrong baseline). STOP — that's a Brief 87 follow-on, separate scope. Document and escalate.
- **3 approaches tried on any blocker without progress.** STOP per Bible's "when stuck" rule.
- **Any indication work has accidentally landed on `main` or another non-feature branch.** STOP IMMEDIATELY.

---

## INDEPENDENT REVIEW TRIGGER

This brief touches engine call-site wiring and produces correctness-invisible output (a number — "do the two pages now show the same EUI?"). Per the Bible's verification framework: **independent review is mandatory and proactive — not only-if-it-breaks.**

Before close, Claude Chat reads the relevant source on GitHub (the `instantCalc.js` State 3 dispatch + `_runInterventionStack` call site after the fix, the `InterventionsModule.jsx` engine call) and checks against this brief's intent. The agent that built it does not grade it. Chris authorises the fix only after Claude Chat's independent check.

Pre-close handover from Code: post the diff URLs (GitHub blob URLs at the relevant lines on the branch) for Claude Chat to read.

---

## CLOSE

- Browser walkthrough complete; screenshots captured.
- Claude Chat's independent source-read review complete (per Independent Review Trigger above).
- Chris signs off via manual browser walkthrough — confirms the visual test from Part 4 with his own inputs.
- `git mv docs/briefs/active/88_strategy_baseline_state_sync.md docs/briefs/archive/88_strategy_baseline_state_sync_COMPLETED.md` (single move).
- `STATUS.md` close-out written for a stranger picking up cold: what was wrong, how it was fixed, what's now reliable, the new principle codified (live baseline everywhere), what's next (Calc Trail restructure / DHW-occupancy audit / cost model / CRREM — all unblocked).
- `docs/briefs/current.md` repointed.
- **PR to `main` opens only after Brief 87 also closes.** Both briefs in `archive/`, both clean, single PR.

**Final commit:** `Brief 88 P6: close — state-sync bug fixed; pending Brief 87 close for PR to main`

---

## FINAL REPORT

At close, Claude Code reports to Chris:
- The Part 2 audit's verdict — which hypothesis was right, where the divergence came from, file + line evidence
- The Part 3 fix — what changed, how many lines, before/after snippet
- The Part 4 verification — Systems EUI and Strategy baseline match, tracking confirmed across at least three input changes
- The Part 5 outcome — "Save failed" either fixed or explicitly escalated, with cause documented
- Confirmation `main` untouched (Bridgewater anchor unchanged on `main`)
- Confirmation `interventionsEngine.js` untouched (engine contract preserved)
- Brief 87 close status (still in `active/` or just moved to `archive/`)
- STATUS.md handover-ready; `current.md` points at next brief
- Independent review handover URLs for Claude Chat to verify before Chris signs off

---

*Brief 88's job is narrow: make Systems EUI and Strategy baseline always agree, because the live interactive engine IS the product. With the headline number reliable, the downstream UX work (Calc Trail restructure, DHW-occupancy audit, cost model, CRREM) all unblocks. The architect's track record this round: framed the bug after Chris's correction (Systems-page screenshot disproving "engine is consistent"). Source-read confirmed the bug class is plausible. The diagnostic-first discipline catches whatever the actual cause turns out to be.*
