# Brief 71 — Interventions: Isolated vs Combined evaluation + theme grouping

> **Renumbered from provisional 61 → 71** (confirmed 2026-05-28 against `docs/briefs/active/` — slot 61 is taken by `61_engine_consistency_audit.md`, completed). All Part / audit / commit references below use `71`.

**Canonical design note:** https://www.notion.so/36ed645e05cc819ca6a2c6f54c5ed542
*(Per the Bible: the design note is canonical. If this brief and the note disagree, the note wins — stop and flag rather than guessing.)*

**Author:** Claude Chat (architect). **Authorises:** Chris. **Builder:** Claude Code.
**Module:** Interventions. **Type:** Feature (Tier 3).

---

## BEFORE DOING ANYTHING

Complete this checklist before any code is written. Do not skip.

1. **Read this brief** end to end. Confirm receipt to Chris by quoting the title and this first paragraph back (Brief-sync Rule 1).
2. **Read `CLAUDE.md`** — Process Rules, Module Scopes (Interventions), Rule 14 (envelope-physics parity), "what not to touch".
3. **Read `STATUS.md`** — last completed Part + SHA, known issues. If it is stale (it is — current last entry Brief 64; main is past Brief 70), the **first commit of this session is the reconciliation/cleanup commit** bringing STATUS.md and `current.md` into line with the actual `git log` and `docs/briefs/active/` state (Process Rule 5). Do not begin Part 1 implementation until reconciliation is committed.
4. **Read the canonical design note** (link above) — especially "the subtlety: isolated ≠ marginal" and the decision log.
5. **Read the existing code being modified** (do not work from memory):
   - `frontend/src/utils/interventionsEngine.js` — `runInterventionStack` (verify L365-401), `applyPatch` (L247), the never-mutate-baseline invariant (L48-51), disabled-row handling (L334).
   - `frontend/src/components/modules/interventions/InterventionsModule.jsx` — how `interventions`, `baselineConfig`, `stackResult`, and engine inputs are assembled (esp. the `paramsForEngine` useMemo and the `VisualiserHost` mount ~L422).
   - `frontend/src/components/modules/interventions/visualiser/VisualiserHost.jsx` — the `VIEWS` array (~L55-61) and the `localStorage` view-memory pattern (~L64-71). Note: VisualiserHost was touched by Brief 60 Part A on 27 May — verify line numbers against current `main`.
   - `frontend/src/components/modules/interventions/ComparisonView.jsx` — dormant; reusable primitives `PairedBar` (~L111), `fmt`, metric extraction.
   - `frontend/src/components/modules/interventions/InterventionRow.jsx` — existing `theme` badge (~L227-232).
   - `frontend/src/context/ProjectContext.jsx` — the `fresh` intervention object and `theme` field (~L221-229); the intervention save path (`updateParam('interventions', …)`).
   - `frontend/src/components/modules/interventions/InterventionEditorPopout.jsx` — where label/notes are edited (theme authoring lands here).
6. **Confirm clean working tree** (`git status`) and **origin in sync** (`git fetch && git status`).
7. **Land this brief on disk** at `docs/briefs/active/71_interventions_isolated_vs_combined.md` as **Part 1's first commit** (Brief-sync Rule 2). No code work before this.
8. **Create the audit doc** `docs/audit/71_interventions_isolated_vs_combined.md` (read-only findings: confirm the line numbers above against current `main`; record the actual `runInterventionStack` signature and the `fresh`-object shape with real line numbers). This doc is updated in the same commit as each Part it describes (Process Rule 7).

If `active/` already contains a different brief, or `current.md` claims a different active brief: **stop and surface to Chris** before any work (Brief-sync Rule 4).

---

## Scope statement

**In scope** (Interventions module only):
- An **Isolated** evaluation pass: each intervention run alone against the untouched baseline, via the existing `runInterventionStack` with singleton lists. Engine consumer only — no engine edit.
- An **Isolated view** in the visualiser right-pane switcher: sortable side-by-side bars, all interventions, measured from baseline; enable/disable + edit affordances; optional group-by-theme with clearly-labelled isolated-sum subtotals.
- **Theme authoring UI** in the intervention editor (the `theme` field already exists and persists; only the input control is missing).

**Out of scope** (see "What MUST NOT happen"):
- Locked base-layer / committed-measures comparison.
- A new persisted strategy/group object.
- Paired Sankeys.
- Capex/payback overlay.
- Any change to the engine, the patch schema, or the existing Combined views' output.

**Modules touched:** Interventions (UI + an engine-consumer hook). **Engine:** read-only reuse, not modified.

---

## Principles (durable constraints for this brief)

1. **Reuse the engine, never re-implement it.** The isolated pass MUST call the existing `runInterventionStack` with a singleton list and read `.interventions[0].cumulative_delta` / `.result`. Writing a second isolated evaluator is forbidden — it creates a divergent code path. (Bible: reuse don't rebuild; design-note rationale.)
2. **No schema change.** `theme` already exists on every intervention. A theme/strategy is the ordered enabled subset sharing a tag — not a new object. No migration function is needed; if you find yourself writing one, stop — you have mis-scoped.
3. **Non-destructive promotion.** Committing/removing interventions to/from the stack toggles `enabled`, never deletes.
4. **Isolated ≠ marginal must be visible.** A caption in the Isolated view states that isolated deltas do not reconcile with the waterfall and do not sum to the total. Per-theme subtotals are labelled "sum of isolated impacts — not the compounded total."
5. **Combined surface is untouchable.** Waterfall / Before-after / Heat balance / Calc trail / Breakdown must produce byte-identical output to pre-brief `main` for the Bridgewater stack.
6. **Performance discipline (Bible).** The isolated pass is N extra engine runs (N = intervention count). Memoise on `[interventions, baselineConfig]`. Document the per-run cost for the Bridgewater case in the audit doc. Do not pre-optimise beyond memoisation; if N is expected to exceed ~25, note it rather than building a worker.

---

## Parts (each Part = one commit, including STATUS.md + audit-doc updates)

### Part 1 — Brief + audit land; isolated evaluation hook
**Files:**
- `docs/briefs/active/71_interventions_isolated_vs_combined.md` (this file — first commit).
- `docs/audit/71_interventions_isolated_vs_combined.md` (line-number verification + run-cost note).
- New: `frontend/src/components/modules/interventions/useIsolatedResults.js`.

**Steps:**
1. Land brief + audit doc.
2. Implement `useIsolatedResults(interventions, baselineConfig, runEngine, libraryData)`: for each intervention (including `enabled: false` ones — isolated view shows all), call `runInterventionStack(baselineConfig, [intervention], runEngine, libraryData)` and return an array of `{ id, label, theme, enabled, isolatedResult, cumulativeDelta }`. Memoise on `[interventions, baselineConfig]`.
3. No UI yet. Add a temporary console assertion (removed in Part 2) confirming the first intervention's isolated `cumulative_delta` equals its marginal in the full stack (falsifiability #1).

**Commit:** `Brief 71 Part 1: land brief + audit; isolated evaluation hook (reuses runInterventionStack)`

### Part 2 — Isolated view component
**Files:**
- New: `frontend/src/components/modules/interventions/visualiser/IsolatedView.jsx`.
- Reuse primitives from `ComparisonView.jsx` (import `PairedBar`/`fmt` or lift them to a shared util if cleaner — if lifted, delete the originals' duplication per the Bible's clean-up-before-you-build rule).

**Steps:**
1. Horizontal sortable bars, one per intervention, value = isolated EUI delta from baseline. Respect the Per m² / Total unit toggle via `useUISettings` + `unitFmt.js` (same as ComparisonView). Green = saving, red = increase (match EUIWaterfall legend semantics).
2. Sort control: by saving (default), by name, by theme.
3. Group-by-theme toggle: grouped bars under theme headers with a per-theme subtotal **labelled** "sum of isolated impacts — not the compounded total."
4. Per-bar affordances matching stack rows: enable/disable toggle (calls existing `onToggleEnabled`); click opens editor (`onEdit`). Disabled interventions render muted but still show their isolated number.
5. Caption (Principle 4): one line stating isolated ≠ marginal and that isolated deltas don't sum to the total.

**Commit:** `Brief 71 Part 2: Isolated view — sortable bars, group-by-theme, isolated≠marginal caption`

### Part 3 — Register the view in the switcher
**Files:** `frontend/src/components/modules/interventions/visualiser/VisualiserHost.jsx`.

**Steps:**
1. **Additively** insert into `VIEWS` (do not assume current contents — Brief 60 Part A just added `calctrail`): `{ id: 'isolated', label: 'Isolated', icon: <lucide icon, e.g. SplitSquareHorizontal>, hint: 'Each intervention alone vs baseline' }`, placed adjacent to `waterfall`.
2. Render `<IsolatedView … />` for `view === 'isolated'`, passing `interventions`, `baselineConfig`, and the engine inputs already in scope (mirror how the other views receive `stackResult`).
3. Persist selection via the existing `localStorage` pattern — no new mechanism.

**Commit:** `Brief 71 Part 3: register Isolated view in visualiser switcher`

### Part 4 — Theme authoring UI
**Files:** `frontend/src/components/modules/interventions/InterventionEditorPopout.jsx` (wherever label/notes are edited).

**Steps:**
1. Add a `theme` input (free-text combobox suggesting existing distinct theme values from the current `interventions` list, so tags stay consistent). Writes `theme` through the existing `onSave` → `updateParam('interventions', …)` path. No new persistence — `theme` already round-trips.
2. Verify the existing `InterventionRow` badge renders the newly-set theme.

**Commit:** `Brief 71 Part 4: theme authoring control in intervention editor`

### Part 5 — Browser verification + close
**Steps:**
1. Boot dev server (Chris runs `go.bat`; frontend per `CLAUDE.md` — :5176; backend per `CLAUDE.md` — :8002). Load Bridgewater.
2. Run the full Walkthrough checklist below with MCP browser tools, capturing **numerical evidence** (not "looks right").
3. Update STATUS.md close-out; `git mv` brief to `docs/briefs/archive/71_..._COMPLETED.md`; repoint `current.md`. Single push.

**Commit:** `Brief 71 Part 5: browser verification + close`

---

## Walkthrough checklist (Chris runs in browser before close; Bridgewater, with Reduce Extract + MVHR present)

1. Interventions right-pane switcher shows a new **Isolated** entry alongside Waterfall / Before-after / Heat balance / Calc trail / Breakdown. ✓/✗
2. Selecting Isolated shows two bars (Reduce Extract, MVHR), each measured from the baseline EUI; the baseline value shown is identical across bars and equals `stackResult.baseline`. ✓/✗
3. Reduce Extract's isolated bar **equals** its Waterfall marginal (it is first in the stack). ✓/✗
4. MVHR's isolated bar **does not equal** its Waterfall marginal, and the caption explains why. ✓/✗
5. Sort by saving / name / theme reorders bars; the underlying stack order in the left pane is unchanged. ✓/✗
6. Setting theme "Ventilation" on both interventions (Part 4 control) shows the badge on each row. ✓/✗
7. Enabling group-by-theme groups both under "Ventilation" with a subtotal labelled "sum of isolated impacts — not the compounded total." ✓/✗
8. Disabling MVHR from the Isolated view mutes its bar AND removes it from the combined Waterfall on next render. ✓/✗
9. Re-enabling MVHR restores it in both views. ✓/✗
10. Switching back to Waterfall shows the combined stack exactly as before this brief (same marginal labels −13.6 / +18.1, same After-stack total). ✓/✗
11. Save project, reload (`.nzasim` round-trip): themes persist; isolated view repopulates correctly. ✓/✗
12. Anchor: the combined After-stack EUI and the baseline EUI are unchanged from pre-brief `main`. ✓/✗

Hard-stop reporting points for Chris: after Part 3 (view visible + correct) and after Part 4 (theme authoring end-to-end).

---

## What MUST NOT happen

- **No second evaluator.** Do not write a standalone isolated-calculation function. Reuse `runInterventionStack` with singleton lists. (Divergent-path risk — the core reason this brief is safe.)
- **No schema change / no migration function.** `theme` already exists. If a migration seems necessary, you have mis-scoped — stop and escalate.
- **No engine edit.** `interventionsEngine.js` is read-only for this brief. If the isolated numbers look wrong, the bug is in the consumer/UI, not the engine — diagnose there.
- **No change to Combined views' output.** Any movement in baseline or After-stack EUI is a blocker.
- **No deletion of interventions** as a promotion mechanism — `enabled` toggle only.
- **No deletion of `ComparisonView.jsx`** in this brief, even if it becomes redundant — note it for a future cleanup brief instead.
- **No scope creep into capex/payback, locked base layers, or Sankeys.**

---

## When to escalate (pause and ping Chris)

- STATUS.md / `current.md` / `active/` disagree in a way reconciliation can't resolve cleanly (Brief-sync Rule 4).
- The design note and this brief conflict on any point (note wins; confirm with Chris).
- Falsifiability #1 fails (isolated first-intervention delta ≠ its stack marginal) — this means the isolated pass is not reusing engine semantics correctly; do **not** patch around it.
- Any Combined-view number moves.
- Reusing `ComparisonView` primitives would require touching engine or shared state beyond the interventions module.
- Three approaches tried on any single problem without resolution (Bible: stop at three, escalate).

---

## Final report (Claude Code reports to Chris at close)

- Parts completed with SHAs.
- Falsifiability results with **actual numbers**: isolated deltas for Reduce Extract and MVHR; their stacked marginals; explicit confirmation that #1 holds (first-intervention isolated == marginal) and that MVHR isolated ≠ MVHR marginal (with both figures).
- Confirmation that baseline + After-stack EUI are unchanged vs pre-brief `main`.
- Per-run engine cost for the isolated pass (Bridgewater, N interventions) from the audit doc.
- Anything noted for future cleanup (e.g. `ComparisonView` redundancy).

---

## Anchor
Bridgewater baseline + After-stack EUI as read from `stackResult` at session start (≈513.6 baseline / ≈518 after-stack per the current screenshot — confirm live). Identical before and after on the Combined surface is the non-negotiable gate.

---

## Carried-over note (from prior session — door bug deferred)

A separate bug was uncovered during the session that landed this brief: an operable door added in Operations renders correctly in the Operations Heat Balance (mode `envelope-gains`) but reports `heat_loss_kwh = 0` in the Systems Heat Balance (mode `full`, State 3 → State 2). Diagnostic instrumentation confirmed the entry IS present in `losses_at_setpoint.natural_ventilation` on Systems with `natvent_count: 1` — so the engine surfaces it — but the per-hour accumulator never increments to a non-zero loss in the State-3-internal path. Three diagnosis angles tried (static engine trace, instrumented HeatBalance log, setpoint-override hypothesis) without root cause. CLAUDE.md Rule 4 (three strikes then escalate) and Rule 13 (the cause is deeper than current evidence) apply. **Action:** carry as a future brief — likely Brief 72, scoped to engine-side natvent parity between direct-State-2 and State-3-via-State-2 invocations. Out of scope for Brief 71.
