# Brief A — Interventions UX rework (Library/Strategy split + two-section per-intervention view)

**Branch:** `chris/interventions-rework-ux` (branch-per-feature per Bible; merge to `main` via PR after walkthrough)
**Design note (canonical):** `interventions_rework_design_note.md` — markdown, sibling to this brief. Land as `docs/design-notes/interventions_rework.md` at Part 1's first commit. **Where this brief and the design note disagree, the design note wins** (Bible rule).
**Author:** Claude Chat (architect)
**Authorised by:** Chris
**Brief number:** TBC on landing. Likely 87 if EnergyPlus Brief 86 is renumbered to 87; otherwise the next sequential number after the calibration branch's brief.

---

## BEFORE DOING ANYTHING

- [ ] **Confirm receipt.** Quote this brief's title and the Goal paragraph back to Chris. Verifies the right brief was received (Bible Brief sync rule 1).
- [ ] **Read this brief in full, plus the design note.** Sibling file `interventions_rework_design_note.md`. The design note is canonical — where the brief and note disagree, the note wins.
- [ ] **Read repo `CLAUDE.md` and `STATUS.md`** at branch root.
- [ ] **Confirm clean working tree, origin in sync.** `git status`, `git fetch --all`, `git log --oneline -20`.
- [ ] **Confirm branch.** `git checkout -b chris/interventions-rework-ux` from `main` (currently `d8a6207` — Brief 77 close). NOT from the calibration branch. NOT from `feat/energyplus-validation`. This rework branches from production `main`.
- [ ] **Read the existing interventions module source.** Specifically:
  - `frontend/src/components/modules/interventions/InterventionsModule.jsx` (the six-tab structure being replaced)
  - `frontend/src/utils/interventionsEngine.js` (engine wiring — stays as-is; the rework is the product layer on top)
  - Any sub-components rendering Waterfall, Isolated, Before, After, Heat Balance, Calc Trail tabs
- [ ] **Read existing design notes**: Brief 41 (interventions architecture — declarative patches model), Brief 43 (interventions UX feedback), Brief 47 (inputs-left/visualiser-right). The declarative-patches model from Brief 41 stays. The UX patterns evolve.
- [ ] **Run session-start reconciliation pass** (Bible Brief sync rule 3): `ls docs/briefs/active/`, `cat docs/briefs/current.md`, `tail STATUS.md`, `git log --oneline -20`. Cross-check `active/` against `current.md` against the most recent close commit. If anything is stale, the first commit of the session is the cleanup commit.
- [ ] **Land this brief on disk** at `docs/briefs/active/<NN>_interventions_ux_rework.md` as Part 1's first commit. The design note lands at `docs/design-notes/interventions_rework.md` in the same commit.

---

## GOAL

Restructure the interventions module's product layer so it does three things cleanly: (1) lets the user author and explore individual interventions in isolation (a *library*), (2) lets the user compose ordered strategies from the library and see the compounded impact (a *strategy*), and (3) consolidates the per-intervention sub-views from six overlapping tabs into two purposeful sections (Isolated impact and Calc Trail). The engine wiring (Brief 41's declarative-patches model, Brief 71's marginal/cumulative attribution, Brief 76's vent fix) stays unchanged — this is a UX restructure that uses the existing engine outputs differently. After this brief, the module is ready for the cost layer (Brief B) and the lifetime carbon layer (Brief C) to land on top without further structural changes.

---

## SCOPE

### IN
- Split the existing single-page Interventions module into two pages/tabs: **Library** (author + isolated view per intervention) and **Strategy** (compose + ordered stack + waterfall + final-state visualisations).
- Replace the existing six-tab per-intervention view (Waterfall / Isolated / Before / After / Heat Balance Calc / Trail Breakdown) with **two sections**: Isolated impact (default, leads page) and Calc Trail.
- Drag-and-drop reorder on the Strategy page (intervention rows shuffle, the waterfall and final-state views recompute).
- Heat Balance view lives on the Strategy page only — showing the strategy's final state, with a side-by-side compare option (baseline vs final) when the user expands it.
- Single strategy per project for v1. Multi-strategy comparison is explicitly out (future enhancement).
- Calc Trail uses the engine, not a parallel hand-calc. Shows only the fields that changed for this intervention.
- Wire Library and Strategy together cleanly: adding an intervention to Strategy is "select from Library." Library entries can exist without being in the Strategy.

### OUT
- **No cost model.** That's Brief B (separate). The Isolated view in this brief has placeholder cards for cost/payback/£-per-tonne, populated by Brief B later. The cards exist; their values are blank or "TBD" until Brief B fills them.
- **No lifetime carbon / CRREM model.** That's Brief C (separate). Same pattern — placeholder card on Isolated view, filled by Brief C later.
- **No engine changes.** `interventionsEngine.js` stays as-is. `instantCalc.js` stays as-is. The rework consumes existing engine outputs and rearranges them.
- **No new engine modes.** No new patch types. No schema-version bumps.
- **No `npm install` pushes, no `package-lock.json` changes, no `node_modules` modifications** (Bible Claude Code rules).
- **No work on `main`, `feat/energyplus-validation`, or the calibration branch.** This brief lives on its own feature branch.
- **No multi-strategy comparison view.** Single strategy only.
- **Heat Balance on the per-intervention page.** Removed entirely from there. Lives on Strategy view only.

---

## DESIGN DECISIONS ALREADY AGREED

The design note (`interventions_rework_design_note.md`) is the canonical record. Key decisions resolved with Chris in conversation, locked here so any agent resolves ambiguity in the right direction:

1. **Two pages, not one.** Library (author + isolated) and Strategy (compose + ordered + final state). Authoring is decoupled from sequencing.
2. **Two sections per intervention, not six tabs.** Isolated impact (default, leads page) + Calc Trail. Heat Balance, Before/After, Waterfall are removed from per-intervention view.
3. **Heat Balance lives on Strategy view only.** Shows the strategy's final state. A "compare" option expands to side-by-side baseline-vs-final view. The user can also flip back to the baseline state in the building module if they want to compare manually — this view doesn't have to do everything.
4. **Calc Trail is engine-driven, only shows changed fields.** Walks the engine's actual computation path for this intervention, narrating which input changed, which engine fields recalculated, what the final headline became. NOT a parallel hand-calc, NOT a separate verification engine — a narrated trace of the engine's actual run. Shows only fields whose value changed (focused, not comprehensive). If the user wants the full engine state, they can use the Building module's Heat Balance/Energy Flows views.
5. **Drag-and-drop reorder on Strategy.** Intervention rows can be reordered freely. The waterfall and final-state views recompute on reorder. Toggle/disable per intervention. Delete affordance per row.
6. **Single strategy per project for v1.** Multi-strategy comparison is a future enhancement. The data model supports multiple strategies (named container holding ordered selection); the UI exposes one at a time for v1.
7. **Engine stays unchanged.** Brief 41's declarative-patches model is preserved. Brief 71's marginal/cumulative/isolated attribution is preserved. Brief 76's vent fix is preserved. No engine code changes in this brief.
8. **Cost and lifetime carbon cards are placeholders in this brief.** They appear in the Isolated view's headline-card row with "TBD" or blank values, ready for Brief B and Brief C to populate. The layout is settled here; the values are not.
9. **Themes/categorisation (from Brief 71) stay.** Used for both Library navigation (filter by theme) and Strategy composition (group interventions by theme in the picker).
10. **The Strategy view is the only place where order matters.** Library entries have no order — they're authored independently. Only when added to the Strategy do they take a position in the stack.

---

## PRINCIPLES / CONSTRAINTS

- **One Part = one commit.** Including `STATUS.md` and any audit-doc update in the same commit.
- **Brief 41's declarative-patches model is sacred.** An intervention is a patch description. The Library stores patches. The Strategy stores an ordered selection of patches. No new patch types in this brief.
- **Engine outputs are canonical** (Bible: "Engine output is canonical; never tweak the engine to make a number match a target"). The rework consumes engine outputs and arranges them; if a value looks wrong, investigate the engine path, don't massage the display.
- **Variable boundaries stay explicit** (Bible Boundary-mismatch principle). Every numerical variable name should declare its physical boundary (raw demand / post-MVHR / delivered / source fuel). When wiring engine outputs into the Library or Strategy views, preserve these boundaries — don't conflate demand with delivered with fuel.
- **Visualisation-as-verification** (Bible rule). Reordering interventions in the Strategy MUST produce a predictable visible change in the waterfall and final-state views. If a reorder doesn't change anything visible, something is wired wrong.
- **Clean up before building** (Bible rule). When replacing the six-tab structure, DELETE the old tab components first. Don't leave them commented-out or as dead imports.
- **No engine work without an audit-before-fix doc** (Bible rule). If during the rework an engine issue surfaces, STOP and escalate per the tier-3 rule. Don't fix engine code as a side effect of UX work.
- **Performance discipline.** The reworked module must not introduce new engine passes per UI interaction. The interventions engine already runs hourly for each intervention; the rework should not multiply that. If reordering would require N engine re-runs and N is unbounded, cache appropriately.

---

## PARTS (each = one commit)

### Part 1 — Brief landing + branch verify + audit doc stub

- Confirm branch is `chris/interventions-rework-ux` (cut from `main` at `d8a6207`).
- Land this brief at `docs/briefs/active/<NN>_interventions_ux_rework.md`.
- Land the design note at `docs/design-notes/interventions_rework.md`.
- Open an audit-doc stub at `docs/audit/<NN>_interventions_ux_rework.md` with sections for Parts 2-7 to fill in.
- Update `STATUS.md`: Brief opened, branch name, link to design note.
- Update `docs/briefs/current.md` to point at this brief.

**Commit:** `Brief <NN> P1: brief landing + branch verify + audit stub`

### Part 2 — Source read + Library/Strategy data model audit (read-only)

This is an *audit* part — no code changes. Bible's "audit before fix" discipline.

Read the existing interventions module source. Document in audit §2:

- The current six-tab structure: what each tab reads from the engine, what data flows through, where the rendering happens. File + line references.
- The existing data model: how interventions are stored, the patch schema (Brief 41), how the engine consumes them, how marginal/cumulative/isolated outputs are exposed.
- The proposed Library/Strategy data model: a Library entry is the current intervention object (patch + metadata). A Strategy is a new named container holding `{ name, ordered_intervention_ids: [...] }`. Document the migration path: existing projects have interventions in an implicit "first strategy"; the migration creates one default Strategy holding all current interventions in their current order. No data loss.
- The minimum schema additions needed: a `strategies` array at the project level, each with `{ id, name, ordered_intervention_ids[] }`. Interventions themselves don't change structurally — they just become Library entries that may or may not be referenced by a Strategy.
- Any places in the engine or other modules that assume "all interventions are in the stack." List them. The rework needs to update each call site to read from the Strategy's ordered list, not from the Library wholesale.

**Critical:** if the source read reveals the rework requires engine changes (e.g. the engine implicitly stacks all interventions and that can't be changed without engine work), STOP and escalate. This brief is UX only. Engine change is out of scope and would need its own brief.

**Commit:** `Brief <NN> P2: source read + Library/Strategy data model audit`

### Part 3 — Add Strategy data model + migration

Implement the schema change identified in Part 2:

- Add `strategies: Strategy[]` to the project schema. Each `Strategy = { id: string, name: string, ordered_intervention_ids: string[] }`.
- Schema version bump (path-addressed patches per Bible's schema-flexibility discipline). Patch-migration function lands in the same commit.
- Migration: for any project loaded without `strategies`, create one default Strategy named "Strategy 1" with `ordered_intervention_ids` containing all existing interventions in their current order. Existing projects keep working without user action.
- Audit §3: document the schema change with before/after example. Document the migration function with a sanity check (load Bridgewater after migration, confirm all interventions present in default Strategy in original order).

**Falsifiability:** Load Bridgewater on the branch; confirm Strategy 1 exists, contains all existing interventions in their existing order, and produces the same engine output as the pre-migration state. No engine numbers move (this is a data-model change only; engine consumes same patches in same order).

**Commit:** `Brief <NN> P3: Strategy data model + migration`

### Part 4 — Build Library page (author + per-intervention view restructure)

Replace the existing six-tab per-intervention view with the two-section structure:

- **Library page layout**: list of interventions (left) + selected intervention's view (right). Existing inputs-left/visualiser-right pattern from Brief 47 preserved.
- **Per-intervention view, Section 1 — Isolated impact** (default, leads page):
  - Four headline cards (top row): **Lifetime carbon saved** (placeholder, "TBD — Brief C"), **£ per tonne CO₂** (placeholder, "TBD — Brief B"), **kWh saved / EUI Δ** (live, from engine isolated output), **Simple payback** (placeholder, "TBD — Brief B")
  - Below cards: demand-by-service deltas — heating demand Δ, cooling demand Δ, DHW demand Δ, total energy Δ, fuel splits Δ. All from existing engine isolated-output schema. Sourced via the engine's existing Isolated calculation — no new engine work.
  - Annual operational carbon Δ (year-1 only — full lifetime trajectory is Brief C).
- **Per-intervention view, Section 2 — Calc Trail**:
  - Narrated trace of the engine's actual computation for this intervention.
  - Shows only fields whose value changed between baseline and post-intervention (per Design Decision 4 above).
  - Walks: which inputs the patch changed → which engine fields re-evaluated → resulting headline output.
  - Implementation note: the engine doesn't expose this trail today. Building it means adding a thin "trace mode" to `interventionsEngine.js` that records which fields are accessed and which values changed. **If adding trace mode requires non-trivial engine work, STOP and escalate** — this might need to be its own brief (Brief 41's principle: the engine evolves carefully). Alternative: implement a UI-side diff between pre- and post-intervention engine state, showing only fields with non-zero delta. The UI-side diff avoids engine changes and is the preferred path if there's any doubt.
- **No Heat Balance section in the per-intervention view.** Confirm during implementation that any code referencing it from the per-intervention view is removed cleanly.
- **No Before/After section.** Same. Removed cleanly.
- **No Waterfall section.** Same. Waterfall moves to Strategy view (Part 5).

**Falsifiability**: Load Bridgewater. Click into any intervention. Confirm only two sections visible: Isolated impact (with four cards across top + demand deltas below) and Calc Trail. Confirm Heat Balance / Before / After / Waterfall sub-tabs are gone. Confirm Isolated cards populated for kWh/EUI Δ; other cards show "TBD" or blank. Confirm Calc Trail shows only fields that changed (e.g. for a wall U-value intervention, the trail shows wall_u_value change → fabric_loss recalc → heating_demand_delta; it does NOT walk through every unchanged field).

**Commit:** `Brief <NN> P4: Library page + two-section per-intervention view`

### Part 5 — Build Strategy page (compose + reorder + waterfall + final-state)

- **Strategy page layout**: header with strategy name (editable, defaults "Strategy 1"). Body: ordered intervention list (drag-and-drop reorder) + the visualisation stack below.
- **Intervention list row** shows: theme indicator (Brief 71), intervention name, marginal contribution within this strategy (Δ kWh, Δ carbon, Δ headline metric), toggle/disable, delete affordance, drag handle.
- **Add intervention to strategy**: button/dropdown that opens a picker showing the Library, grouped by theme. Selecting one adds it to the bottom of the strategy.
- **Reorder**: drag-and-drop rows. On drop, engine re-runs the marginal/cumulative attribution in the new order; the visualisations below update.
- **Visualisation 1 — Waterfall**: cumulative attribution chart. Each intervention's marginal contribution to the building's final state, stacked. Same data the old Waterfall tab consumed, now at the strategy level.
- **Visualisation 2 — Final Energy Flows (Sankey)**: the strategy's final building state. Reuse the existing Sankey component from the Building module.
- **Visualisation 3 — Heat Balance (final state, with expand-to-compare option)**:
  - Default view: single Heat Balance chart showing the strategy's final state.
  - **Compare button**: expands a side-by-side view with baseline state on left, final state on right. Same chart type, same scale. Lets the user see exactly where the strategy has shifted the energy balance.
  - Implementation: reuse the existing Heat Balance component from the Building module; pass it the final-state engine output. For the compare view, render two instances side-by-side, one with baseline state, one with final state.
- **Visualisation 4 — CRREM trajectory chart**: placeholder for Brief C. Show the chart frame and axes (years 2025-2050, kgCO₂/m²·yr); the building's trajectory line is "TBD — Brief C". Same pattern as the placeholder cards on the Library Isolated view.
- **Strategy headline row** (top of page or bottom, designer's call): final EUI, total energy saving, total carbon saving (year-1 only here — lifetime is Brief C), capex (placeholder for Brief B).

**Falsifiability**: Load Bridgewater. Open Strategy page. Confirm Strategy 1 contains all existing interventions in current order. Confirm waterfall renders, Sankey renders, Heat Balance renders (final state). Click Compare on Heat Balance; confirm side-by-side baseline-vs-final view appears. Drag an intervention row to a new position; confirm the waterfall recomputes and the final-state Sankey updates if the marginal attributions change. CRREM chart frame visible with placeholder line.

**Commit:** `Brief <NN> P5: Strategy page + reorder + waterfall + final-state views`

### Part 6 — Wiring + cleanup

- Wire Library and Strategy pages together: navigation between them (tab bar at top of module, or side nav — designer's call). Selecting an intervention in Library shows its isolated view; the Strategy page shows the composed view.
- **DELETE** the old six-tab per-intervention component (per Bible "clean up before you build" rule). Remove imports, remove unused state, remove commented-out blocks.
- Search for any other components referencing the old tab names (Waterfall, Before, After, Heat Balance Calc, Trail Breakdown) and update or remove.
- `grep -rn "TODO\|FIXME\|HACK"` on changed files; clean up.
- Update CLAUDE.md's Module Scopes section to reflect the new Library/Strategy split.

**Falsifiability**: `grep -rn "InterventionsTabs\|WaterfallTab\|BeforeTab\|AfterTab\|HeatBalanceCalcTab\|TrailBreakdownTab"` returns nothing (or only the rename in CLAUDE.md). No unused imports. No commented-out blocks. `STATUS.md` reflects the close.

**Commit:** `Brief <NN> P6: wiring + cleanup`

### Part 7 — Walkthrough + close

- Browser verification by Claude Code via MCP browser tools (Bible: mandatory at walkthrough). Capture screenshots of:
  - Library page with a selected intervention showing the two sections
  - Strategy page with multiple interventions, waterfall, Sankey, Heat Balance final state
  - Heat Balance compare view (side-by-side)
  - A reorder action and the resulting waterfall change
- Report findings to Chris. **Chris runs the walkthrough manually** before close commit.
- After Chris signs off: `git mv docs/briefs/active/<NN>_*.md docs/briefs/archive/<NN>_*_COMPLETED.md`. Update `STATUS.md` close-out (handover-ready, written for a stranger). Update `docs/briefs/current.md` to next brief or "none active." Single push.
- PR opens from `chris/interventions-rework-ux` to `main`. Chris merges via PR.

**Commit:** `Brief <NN> P7: walkthrough + close + STATUS update`

---

## VERIFICATION (non-negotiable, falsifiable)

UI-heavy brief — verification weight is visual + screenshots, with specific falsifiable checks per Bible's "weight flexes by task" rule.

- **Existing engine numbers unchanged.** Load Bridgewater on the branch; the headline Bridgewater EUI / heating / cooling / mech vent / DHW numbers match the `main` anchor (EUI 143.5 / heating 98.3 / cooling 53.1 / mech vent 326.0 / DHW 263.2) exactly. This is a UX rework, not an engine change — any number movement is a failure.
- **Per-intervention view shows two sections only.** Screenshot of any intervention shows Isolated impact (top, default) and Calc Trail (below or as a second section). No Heat Balance, no Before/After, no Waterfall, no Trail Breakdown duplicate.
- **Strategy page reorder works.** Drag an intervention to a new position; the waterfall and final-state views update within the same render cycle. Marginal attributions reflect the new order.
- **Heat Balance compare view works.** Click Compare on the Strategy's Heat Balance; side-by-side baseline-vs-final view appears with identical chart types and aligned scales.
- **Library and Strategy navigate cleanly.** Tab or nav between them works without state loss.
- **Migration is lossless.** Any project loaded from before this brief has all its interventions present in a default "Strategy 1" in original order. No interventions silently dropped or renamed.
- **No engine code modified.** `git diff main...HEAD -- frontend/src/utils/instantCalc.js frontend/src/utils/interventionsEngine.js frontend/src/utils/systemsEngine.js` returns nothing meaningful (only if a trace-mode addition for Calc Trail landed, and that's documented in Part 4 audit with explicit reasoning).
- **No `package-lock.json` or `node_modules` changes pushed.**
- **CLAUDE.md Module Scopes updated** to reflect Library/Strategy split.
- **STATUS.md close-out is handover-ready** (written for a stranger picking up cold per Bible rule).

---

## WHAT MUST NOT HAPPEN

- **No engine code changes.** `interventionsEngine.js`, `instantCalc.js`, `systemsEngine.js` stay unchanged. If a trace-mode for Calc Trail seems to need engine work, escalate before touching engine code. UI-side diff is the preferred path.
- **No new patch types in the interventions schema.** Brief 41's declarative-patches model is preserved as-is.
- **No multi-strategy comparison UI.** Single strategy only. Data model supports multiple strategies for future; UI exposes one.
- **No `npm install` pushed, no `package-lock.json` modified, no `node_modules` changes** (Bible Claude Code rule).
- **No work on `main`, `feat/energyplus-validation`, or the calibration branch.** Branch-per-feature.
- **No silent number drift.** If the headline Bridgewater anchor moves at all (EUI / heating / cooling / mech vent / DHW), STOP — something has changed that shouldn't have.
- **No removing functionality before its replacement is in place.** The six-tab structure is removed only when the two-section structure is rendering correctly (Part 4 done before Part 6's cleanup).
- **No quiet scope expansion.** If a sub-problem looks like it needs Brief B or Brief C work, STOP and escalate. The cost cards and CRREM cards are placeholders in this brief.
- **No skipping the audit pass (Part 2) to go straight to implementation.** Read the existing code first.

---

## WHEN TO ESCALATE / STOP

- **Part 2 source read reveals engine change is required.** STOP. UX-only scope is unfit. Surface to Chris.
- **Part 3 migration produces any number drift on Bridgewater.** STOP. The migration should be lossless; if numbers move, the schema change or migration function is wrong.
- **Part 4 Calc Trail requires non-trivial engine work** (trace mode is more than ~50 lines, or requires changes to multiple engine functions). STOP. UI-side diff is the alternative; escalate to Chris before committing to engine changes.
- **Part 5 reorder doesn't produce the expected visible change** in waterfall or final state. STOP and diagnose per Bible's "diagnose before you fix" rule. Visualisation-as-verification: if the visual doesn't match the prediction, find out why.
- **Any indication work has accidentally landed on `main` or another non-feature branch.** STOP IMMEDIATELY.
- **3 approaches tried on any blocker without progress.** STOP per Bible's "when stuck" rule. Describe what was tried, what happened, what the options are. Chris decides.
- **Any of the 10 Design Decisions Already Agreed need to change mid-implementation.** STOP and update the design note first (design note is canonical). Don't quietly diverge.

---

## INDEPENDENT REVIEW TRIGGER

UI-heavy brief; standard verification is Claude Code's MCP browser walkthrough + Chris's manual walkthrough. Independent review (Claude Chat reads source on GitHub) is NOT mandatory for this brief — the output (Library page, Strategy page, two-section per-intervention view, drag-and-drop reorder) is visually verifiable.

However: **Brief B (cost model) and Brief C (CRREM lifetime carbon) DO trigger mandatory independent review** because they introduce numbers whose correctness is invisible to the eye (£ figures, tCO₂e lifetime numbers). For those briefs, Claude Chat reads source on GitHub before close. This brief's job is to land the UX scaffolding; the numeric layers (B, C) are where Claude Chat's verification matters most.

---

## CLOSE

- Browser walkthrough complete; screenshots captured.
- Chris signs off via manual browser walkthrough.
- `git mv docs/briefs/active/<NN>_interventions_ux_rework.md docs/briefs/archive/<NN>_interventions_ux_rework_COMPLETED.md` (single move).
- `STATUS.md` close-out written for a stranger picking up cold: what works, what was changed, what's fragile, what's next (Brief B cost, Brief C CRREM, both consume the placeholders).
- `docs/briefs/current.md` repointed.
- PR opens from `chris/interventions-rework-ux` to `main`. Chris merges.

**Final commit:** `Brief <NN> P7: close — interventions UX rework complete; Brief B (cost) and Brief C (CRREM) next`

---

## FINAL REPORT

At close, Claude Code reports to Chris:
- Bridgewater anchor unchanged: EUI / heating / cooling / mech vent / DHW match `main` exactly.
- Library page rendering correctly with the two-section per-intervention view.
- Strategy page rendering correctly with drag-and-drop reorder, waterfall, Sankey, Heat Balance final state, Heat Balance compare view.
- Migration lossless: existing projects now have a default "Strategy 1" with all interventions in original order.
- No engine code modified (or, if Calc Trail trace mode landed, explicit audit-doc entry explaining what was added and why it doesn't affect existing engine behaviour).
- Placeholder cards on Isolated view ready for Brief B (cost) and Brief C (CRREM) to populate.
- Cleanup complete: old tab components deleted, no dead imports, no commented-out blocks.
- STATUS.md handover-ready; `current.md` points at next brief.

---

*Brief A scope is the UX scaffolding only. Brief B (cost model, NRM2-aligned) and Brief C (CRREM lifetime carbon, fuel-switching aware) follow on the same feature branch or sequential branches per Chris's call. Recommended order: A → C → B (CRREM first because it's the more impactful net-zero metric and has a cleaner data model; cost last because it's the most surface area). Confirmable on close.*
