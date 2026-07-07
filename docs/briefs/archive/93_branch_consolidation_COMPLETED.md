# Brief 93: Branch Consolidation — envelope-fix → interventions → EP-validation → main

**Canonical design note:** Notion — "Design note: EnergyPlus as canonical-results layer for Interventions" (on the NZA-Sim product page). If this brief and the note disagree, the note wins.

---

## BEFORE DOING ANYTHING

1. Confirm receipt: quote this brief's title and first paragraph back.
2. Land this brief at `docs/briefs/active/93_branch_consolidation.md` as Part 1's first commit. No other work before this.
3. Read CLAUDE.md, STATUS.md.
4. Session-start reconciliation: `ls docs/briefs/active/` · `cat docs/briefs/current.md` · `tail STATUS.md` · `git log --oneline -20` on the CURRENT branch. If active/ or current.md disagree with reality, the first commit is the cleanup commit — surface before proceeding.
5. `git status` — list every untracked and modified file. The untracked planning stubs in docs/briefs/ get committed in Part 1 (project memory). Any OTHER uncommitted change: STOP and surface to Chris before any merge.
6. Confirm all four branches are pushed and local = origin for each: `main`, `chris/interventions-rework-ux`, `feat/envelope-fix-bridgwater-rebuild`, `feat/energyplus-validation`.

---

## Goal

Consolidate three long-running branches into `main` so that new work (EP-as-canonical-results for Interventions, next brief) starts from a single line containing: the rebuilt Bridgewater physics (Brief 86), the interventions/cost/UI work (Briefs 88–92), and the EnergyPlus validation harness (Briefs 81–85). Main is currently 15 briefs stale (Brief 77). The consolidation must not silently change Bridgewater's physics — every merge is checked against a snapshot, with a hard stop condition.

## Why this order (intent)

Envelope-fix lands **first** because its rebuilt physics is the anchor everything else is validated against. Landing it first means each subsequent merge is checked against a **fixed** reference rather than a moving target. Interventions lands second (largest feature surface; conflicts against the new physics get resolved once). Harness lands last (it validates the combination). Brief 91 (Cost Plan Builder) merges in its **transitional state** — Claude Code sized P4–P9 at 10–18 hr with P8 hard-blocked on the Applemore spreadsheet, and the transitional code has zero physics/engine contact. The debt is quarantined; it gets a tracking stub, not a delay.

## Scope

**IN:** committing untracked planning stubs · pre-merge snapshots · three merges in fixed order · conflict resolution · post-merge verification per merge · Brief 91 completion tracking stub · STATUS/close.

**OUT:** finishing Brief 91 P4–P9 · any change to engine numbers beyond faithful conflict resolution · any new feature work · deleting the merged branches (Chris decides post-walkthrough) · starting the EP-interventions build.

## Design decisions already agreed (do not relitigate)

1. Merge order: `feat/envelope-fix-bridgwater-rebuild` → `chris/interventions-rework-ux` → `feat/energyplus-validation`, all into `main`.
2. Brief 91 merges transitional. The ~15-line dual-path in `computeCostPlanTotal` and the mounted `HeadlineCostEditor` stay until a Brief 91-completion follow-up. No brief touches the cost layer until then.
3. Stop condition: any single snapshot metric drifts >5% **unexplained** after a merge → halt, do not proceed to the next merge.
4. Snapshot = full breakdown, not just EUI: heating kWh, cooling kWh, mech-vent kWh, gas kWh, elec kWh, EUI, and the 12-month heating/cooling shape.

## Principles

- Merge commits, no rebase, no force-push, no squash — history is the audit trail.
- During conflict resolution you are a **scribe, not a physicist**: pick the intended side, never blend numbers to make outputs match. If both branches changed the same function and the intent isn't obvious, STOP (see escalation).
- Expected deltas are documented, not absorbed: Brief 92's auxScalar and Brief 88's alias purge may legitimately shift numbers when they meet the rebuilt envelope. "Explained" means you can name the commit and mechanism causing the delta.
- Every Part = one commit (merge commits count as the Part's commit; snapshot/doc changes ride with them or immediately after, per Part).

---

## PART 1: Land brief, commit stubs, snapshot all lines

1. Land this brief (see BEFORE DOING ANYTHING).
2. `git add` the untracked planning stubs in docs/briefs/ — commit: `Brief 93 P1: brief landing + planning stubs committed`.
3. Create `docs/audit/93_consolidation_snapshots.md`. For EACH of the four lines (`main`, envelope-fix, interventions, EP-validation): check out the branch, run the Bridgewater engine anchor (the same mechanism as `scripts/_brief75_p1_anchor.mjs` / the fixture exporter path — pure engine run, no DB write), and record the full breakdown table (metrics listed in Design Decision 4). If a branch cannot run the anchor (e.g. main at Brief 77 predates the runner), record the closest equivalent and note the method.
4. Commit: `Brief 93 P1b: pre-consolidation snapshots (4 lines)`.

**Done looks like:** audit doc with four labelled breakdown tables + method notes.

## PART 2: Merge envelope-fix → main

1. `git checkout main && git merge --no-ff feat/envelope-fix-bridgwater-rebuild`.
2. Resolve conflicts (expected: minimal — main is the common ancestor line).
3. Re-run the Bridgewater anchor on main. Compare against the **envelope-fix branch snapshot** from P1 — this merge should reproduce it within rounding (<1%), because nothing else has landed yet.
4. Append the post-merge table to the audit doc. This table is now **the anchor** for Parts 3–4.
5. Commit (merge commit) + audit update: `Brief 93 P2: envelope-fix merged — anchor established`.

**Falsifiable:** post-merge main breakdown = envelope-fix snapshot within 1% on every metric. Miss → STOP.

## PART 3: Merge interventions-rework-ux → main

1. `git merge --no-ff chris/interventions-rework-ux`.
2. Expected conflict zone: `frontend/src/utils/instantCalc.js` (Brief 88 alias purge + Brief 92 auxScalar vs envelope rebuild), STATUS.md, docs/briefs/. Resolve per Principles — intent of each side, no blending.
3. Re-run the anchor. Compare against the P2 anchor. For every metric that moved: explained (name the commit + mechanism, e.g. "auxScalar adds auxiliary gains → cooling +X") or unexplained.
4. Any metric >5% moved AND unexplained → STOP CONDITION. Halt, write findings to the audit doc, ping Chris. Do not proceed to Part 4.
5. Verify Brief 91 transitional state survived intact: `computeCostPlanTotal` dual-path present, `HeadlineCostEditor` still mounted, app builds, cost cards render.
6. Commit + audit update: `Brief 93 P3: interventions merged — deltas documented`.

**Falsifiable:** delta table in audit doc with every metric classified explained/unexplained; zero unexplained >5%.

## PART 4: Merge energyplus-validation → main

1. `git merge --no-ff feat/energyplus-validation`.
2. Expected conflicts: STATUS.md, docs/, possibly engine touchpoints from Briefs 81–85.
3. Re-run the anchor vs the P2 anchor — same explained/unexplained discipline, same stop condition.
4. Harness smoke test: `python validation/energyplus/generate_idf.py --check-determinism` passes (venv per validation README; if the venv can't be built in this environment, record the exact failure and mark the smoke test as deferred to walkthrough — do not silently skip).
5. Commit + audit update: `Brief 93 P4: EP-validation harness merged — smoke test [pass/deferred]`.

**Falsifiable:** determinism check output captured in audit doc, or explicit deferral note with cause.

## PART 5: Brief 91 tracking stub + branch for next work

1. Create `docs/briefs/active/91b_cost_plan_completion_STUB.md`: what remains (P4–P9 as sized), the two transitional code sites by file+line, P8's Applemore blocker, and the note that P4/P5/P7 need the dev server free for interactive verification. One line at the top: "No brief touches the cost layer until this closes."
2. Create the branch for the next brief: `git checkout -b chris/ep-interventions-backend main` (no work on it — just the branch, pushed).
3. Commit: `Brief 93 P5: Brief 91 completion stub + next-work branch`.

## PART 6: Close

1. STATUS.md close-out: consolidation summary, anchor numbers, link to audit doc, branch map (what's merged, what's parked, what's next).
2. `git mv docs/briefs/active/93_branch_consolidation.md docs/briefs/archive/93_branch_consolidation_COMPLETED.md`; repoint current.md.
3. Single push of main + the new branch.
4. Final report to Chris: per-merge conflict summary, the delta table, smoke test result, and the explicit statement that independent review is pending.

---

## What MUST NOT happen

- No rebase, force-push, or squash of any branch.
- No edits to engine logic beyond faithful conflict resolution. Never adjust a number so outputs match a snapshot — the snapshot check DETECTS problems; it is not a target to calibrate to.
- No npm install / package-lock pushes; no node_modules.
- No deleting merged branches.
- No starting Brief 91 P4–P9 or the EP-interventions build "while we're here."
- No proceeding past a fired stop condition.

## Escalate / stop when

- Any unexplained >5% metric drift post-merge (stop condition).
- A conflict where BOTH sides changed the same function's physics and intent is ambiguous — present both versions to Chris, do not choose.
- The Bridgewater anchor won't run on some line and no equivalent method exists.
- Anything suggesting a branch has unpushed local work.
- Three failed attempts at anything → stop, report options.

## Independent review (mandatory — engine data-flow)

After Part 6, Claude Chat reads on GitHub before sign-off: the resolved `frontend/src/utils/instantCalc.js`, `frontend/src/utils/costModel.js`, the merge commits' conflict resolutions (`git show` on each merge commit), and `docs/audit/93_consolidation_snapshots.md`. The agent that merged does not grade the merge.

## Close

Archive brief · STATUS.md updated · current.md repointed · single push · walkthrough with Chris (app boots, Bridgewater loads, interventions module works, cost cards render, harness files present).
