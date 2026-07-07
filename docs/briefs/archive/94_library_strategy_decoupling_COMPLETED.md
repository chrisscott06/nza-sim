# Brief 94: Interventions Library/Strategy Decoupling + Apply-Gated Recalc

**Canonical design note:** Notion — "Design note: Interventions library/strategy decoupling + Apply-gated recalc" (NZA-Sim product page). If brief and note disagree, the note wins.

---

## BEFORE DOING ANYTHING

1. Confirm receipt: quote this brief's title and Goal back.
2. Branch: `git checkout main && git pull && git checkout -b chris/interventions-decoupling`. Do NOT work on `chris/ep-interventions-backend` — that branch is reserved for Brief 95.
3. Land this brief at `docs/briefs/active/94_library_strategy_decoupling.md` as Part 1's first commit.
4. Read CLAUDE.md, STATUS.md. Session-start reconciliation (active/, current.md, STATUS tail, git log -15). Surface disagreements before working.
5. `git status` — the untracked `Brief_09–17` planning stubs: commit them in Part 1 (they were missed in Brief 93 P1).
6. Baseline check: run `scripts/_brief93_anchor.mjs` against Bridgewater `12cf7cc4`. Expected EUI **126.0** with the breakdown in `docs/audit/93_consolidation_snapshots.md` (post-aux-strip table). Record in the audit doc for this brief. This number must be IDENTICAL at close — this brief touches zero physics.

---

## Goal

Decouple the intervention **library** (editable definitions, multiple variants per type) from the **strategy** (an ordered selection of library items, read-only on parameters), and gate all global recalculation behind an explicit **Apply** action. Fixes three walkthrough findings at once: accidental shared-mutation from the strategy view, unusable slider-drag (live recalc mid-gesture), and sets the interaction rule the EnergyPlus backend (Brief 95) structurally requires. Also: diagnose and fix the drag-reorder regression, plus two cosmetic fixes.

## Intent (why, not just what)

Today add-to-library auto-applies to the strategy, and editing from the strategy pop-out mutates the shared definition while recalculating on every input event. That's one interaction model doing three jobs badly. The decision: definitions are edited in ONE place (library), strategies only select and order them, and nothing recomputes until the user says Apply. When Brief 95 adds EnergyPlus runs (minutes, not milliseconds), this rule is the only one that works — we adopt it now so there is one interaction model, not two.

## Scope

**IN:** strategy data model → ordered references · migration from the coupled state · strategy UI (add-from-library, remove, reorder, enable/disable — no param editing) · library UI as the sole editing surface (edit, clone, delete-with-confirm) · Apply-gated recalc · drag-reorder diagnostic + fix · aux tab colour · Sankey explainer removal.

**OUT:** EnergyPlus anything (Brief 95) · cost layer (Brief 91b quarantine — `costModel.js` and cost components untouched) · multiple strategies · engine/physics changes · CostPlanEditor.

## Decisions already agreed (do not relitigate)

1. Library = definitions, the only editing surface. Variants of a type = separate library items (clone).
2. Strategy = `[{ library_id, enabled, order }]`. No parameter editing from strategy. No duplicate `library_id` in one stack.
3. Apply-gated: no global recalc on keystroke/drag. Library edits propagate on Apply only. Editor-local debounced preview permitted ONLY if cheap and scoped to the open editor.
4. Remove from strategy ≠ delete from library. Deleting a referenced library item = explicit confirm, then drops from stack.
5. Single strategy per project for now.

## Principles

- Audit before fix (Part 1 is diagnostic-only for the reorder bug).
- Migration is lossless: every existing applied intervention survives as a library item + a strategy reference, order preserved.
- One Part = one commit. Browser verification per part where UI changes.
- You are not touching `instantCalc.js` physics. If a task seems to require it, stop and escalate.

---

## PART 1: Land brief + stubs + baseline + reorder diagnostic (NO FIX)

1. Land brief; commit the untracked Brief_09–17 stubs. Commit: `Brief 94 P1: brief landed + planning stubs`.
2. Baseline anchor run (see BEFORE DOING ANYTHING #6) → append to `docs/audit/94_decoupling.md`.
3. **Reorder diagnostic:** intervention drag-reorder in the strategy view fails on main. Determine: does it work on the parked `chris/interventions-rework-ux` branch? (Run both, same project.)
   - Works on branch, broken on main → merge regression: bisect the divergence, name the cause in the audit doc.
   - Broken on both → pre-existing: locate the fault (component, handler, state), name it.
4. Commit: `Brief 94 P1b: baseline + reorder diagnostic — [merge-regression|pre-existing], cause: <one line>`.

**Falsifiable:** audit doc names the faulty file/mechanism. No fix in this Part.

## PART 2: Data model + lossless migration

1. New strategy shape on the project: ordered array of `{ library_id, enabled, order }`. Library items own all parameters.
2. Migrate-on-read: a project in the old coupled shape loads → each applied intervention becomes (a) a library item if not already one, (b) a strategy reference, order preserved. Idempotent; old shape never written back.
3. Unit-test the migration with a fixture of the current Bridgewater interventions state.
4. Commit: `Brief 94 P2: strategy-as-references data model + lossless migrate-on-read`.

**Falsifiable:** fixture test proves N applied interventions → N library items + N ordered refs, zero data loss; loading twice migrates once.

## PART 3: Strategy UI — select, order, toggle. Nothing else.

1. Strategy view: list of referenced items showing name, type, key metrics — parameters read-only (display, no inputs).
2. "Add from library" picker (grouped by type, shows variants). Adding does NOT auto-happen from library creation — the Part 5 wiring removes that behaviour.
3. Remove (reference only), enable/disable toggle, drag-reorder — the P1 diagnostic's fix lands HERE.
4. Duplicate guard: a `library_id` already in the stack can't be added again (picker shows it as "in strategy").
5. Commit: `Brief 94 P3: strategy view = selection + order only; reorder fixed`.

**Falsifiable (browser):** drag item 3 above item 1 → order persists after reload. No parameter input exists anywhere in the strategy view. Adding a library item to the stack twice is impossible.

## PART 4: Library UI — the single editing surface

1. Library view: create, edit (the existing intervention editor moves/mounts here), **clone** (one click → "Copy of X" ready to edit), delete.
2. Delete of a referenced item → confirm dialog naming the strategy impact; on confirm, reference drops from stack.
3. Creating a library item does NOT touch the strategy.
4. Commit: `Brief 94 P4: library = sole editing surface; clone + guarded delete`.

**Falsifiable (browser):** create item → strategy unchanged. Clone → independent copy (edit one, other unmoved). Delete referenced item → confirm shown, stack updates.

## PART 5: Apply-gated recalc

1. Remove live-reactive global recalculation from the intervention editor: input/slider changes update LOCAL editor state only.
2. **Apply** button commits the definition; strategies referencing it recalc ONCE. **Cancel/Esc** discards. Unsaved-changes guard on close.
3. Slider drag must be gesture-smooth: zero engine invocations mid-drag. Editor-local preview (debounced ≥300 ms, scoped to the editor's own summary numbers) is OPTIONAL — include only if it demonstrably doesn't jank; global numbers never move pre-Apply.
4. Commit: `Brief 94 P5: Apply-gated recalc — no global compute until Apply`.

**Falsifiable (browser):** drag a slider continuously for 3 s — main results panels do not change and the drag doesn't stutter; hit Apply — results update once. Esc → no change anywhere.

## PART 6: Walkthrough polish

1. Auxiliary toggle tab: blue → the dark grey used by the internal-gains tab (match exactly).
2. Systems — Energy Flows: delete the explainer paragraph above the Sankey (keep the Σ elec / Σ gas chips).
3. Commit: `Brief 94 P6: aux tab colour + Sankey explainer removed`.

## PART 7: Close

1. Re-run the baseline anchor: EUI **126.0** and full breakdown byte-identical to P1. Any drift = this brief broke physics it had no business touching → do not close, escalate.
2. STATUS.md, archive brief, repoint current.md, push branch, open PR to main. Do NOT merge — Chris walkthrough + independent review first.
3. Report: reorder root cause, migration test result, before/after of the Apply flow, anchor match.

---

## What MUST NOT happen

- No edits to `instantCalc.js` physics, `costModel.js`, or any cost component (Brief 91b quarantine).
- No touching `chris/ep-interventions-backend`.
- Migration must never drop or reorder existing applied interventions.
- No "while we're here" features (multi-strategy, EP hooks, cost editor).
- No merge to main without Chris walkthrough + independent review.

## Escalate / stop when

- P1 traces the reorder bug into engine or data-model code whose fix would exceed "restore the handler" — report options, wait.
- Migration hits a project shape the fixture didn't anticipate — surface it, don't improvise silently.
- The keyboard/drag work fights React defaults for >3 attempts on one behaviour — stop, report (known Brief 91 P5 risk pattern).
- Closing anchor ≠ 126.0.

## Independent review (mandatory — data-model migration)

After P7, Claude Chat reads on GitHub: the migration code + its fixture test, the strategy data model, the P5 diff removing live recalc, and the P1 diagnostic in the audit doc. Merging agent doesn't grade.

## Close

Archive · STATUS · current.md · PR open · Chris walkthrough: create variant in library → strategy untouched → add to stack → reorder → edit variant → nothing moves → Apply → one recalc.
