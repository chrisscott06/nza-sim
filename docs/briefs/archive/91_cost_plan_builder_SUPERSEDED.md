# Brief 91 — Cost Plan Builder (replaces Brief 90's Headline UI)

**Branch:** TBC — Code's call. Options: (a) continue on `chris/interventions-rework-ux` if 87+88+89+90-rate-free haven't merged yet; (b) new branch off `main` after the combined PR merges. Probably (a) — Brief 91 supersedes Brief 90's editor UI, and the cleanest history is to land the replacement on the same branch before merge. **However**, Brief 91 is substantial enough that opening the combined PR first and then doing Brief 91 on a fresh branch is also defensible. Decide based on whether Chris's walkthrough sign-off on 87/89 has happened.
**Design note (canonical):** `brief_91_design_note.md` — sibling file. Land as `docs/design-notes/91_cost_plan_builder.md` at Part 1's first commit. **Where this brief and the design note disagree, the design note wins.**
**Author:** Claude Chat (architect)
**Authorised by:** Chris (26 June 2026)
**Brief number:** Likely 91. Code confirms on landing.
**Reference spreadsheet (still pending):** Applemore Feasibility Cost Plan. Required for template seeding (Part 8) but the cost plan editor itself (Parts 1-7) can ship without it.

---

## BEFORE DOING ANYTHING

- [ ] **Confirm receipt.** Quote this brief's title and the Goal paragraph back to Chris (Bible Brief sync rule 1).
- [ ] **Read this brief in full, plus the design note.** Design note is canonical.
- [ ] **Read repo `CLAUDE.md` and `STATUS.md`** at branch root. Confirm Bible Rule 11 is current.
- [ ] **Confirm clean working tree, origin in sync.** `git status`, `git fetch --all`, `git log --oneline -20`.
- [ ] **Confirm branch choice.** Document the decision (continue on `chris/interventions-rework-ux` vs new branch off `main`) in audit §1.
- [ ] **Read existing code being replaced and built on.**
  - `frontend/src/components/modules/interventions/cost/HeadlineCostEditor.jsx` (Brief 90) — this is the component being replaced. Read it to understand the wiring patterns before replacement.
  - `frontend/src/utils/costModel.js` — Brief 90's math. Most functions stay; some functions are replaced or generalised.
  - `frontend/src/utils/costReads.js` — Brief 90's canonical helpers. Stay; extended slightly for template-library reads.
  - `frontend/src/data/costLibrary.js` — Brief 90's defaults + (empty) intervention type seeds. The empty `INTERVENTION_TYPES` becomes the seed for the v1 template library when Applemore lands.
  - `frontend/src/components/modules/interventions/PerInterventionView.jsx` — the per-intervention view that hosts the cost editor. The editor mounting point changes; the cards (£/tonne, payback) stay.
  - `frontend/src/components/modules/interventions/StrategyView.jsx` — strategy capex aggregation. Stays; just sums differently shaped cost totals.
- [ ] **Read existing design notes.** Brief 87 (UX rework), Brief 88 (canonical reads + Bible Rule 11), Brief 89 (CRREM), Brief 90 (cost — being replaced).
- [ ] **Run session-start reconciliation pass.**
- [ ] **Land this brief on disk** at `docs/briefs/active/91_cost_plan_builder.md` as Part 1's first commit. Design note at `docs/design-notes/91_cost_plan_builder.md` in the same commit.

---

## GOAL

Replace Brief 90's HeadlineCostEditor (six text inputs labelled with NRM2 names) with a proper line-item cost plan builder: groups containing lines (name + qty + unit + rate + extension), groups subtotal, on-costs apply at the plan level following NRM2 sequence, totals roll up cleanly. Users author as much or as little detail as they want — one line for a quick estimate, fifty lines across ten groups for a detailed plan. Per-project template library lets users save and reuse plan structures (e.g. an ASHP retrofit template gets prefilled with sensible groups/lines/rates, user edits to suit). Keyboard discipline (Tab, Enter, Cmd-Enter, arrows) makes the tool usable for serious cost work. NRM2 category tag on each group lets the plan export cleanly to QS workflows (export itself is a future brief). On-costs (design fees, prelims, OHP, contingency, inflation) are a fixed footer block with per-intervention override of project defaults. After Brief 91 closes, a real QS opening any intervention's cost plan sees a document they'd actually use — and Brief 90's cards (£/tonne, payback) and Strategy's capex aggregate keep working seamlessly because their inputs just have a richer source.

---

## SCOPE

### IN

- **Data model change:** `intervention.cost.groups[…].lines[…]` replaces `intervention.cost.headline.{6 keys}`. On-costs block stays. `cost.mode` removed (single mode, variable depth).
- **Migration function** that converts any existing Brief 90-shape cost to the new shape losslessly. Runs once at project load; subsequent loads use new shape.
- **`CostPlanEditor.jsx`** — new component, replaces `HeadlineCostEditor.jsx`. Hierarchical group/line table, all interactions per design note.
- **Group + line CRUD:** add/edit/delete/reorder groups and lines via drag handles and ⋮ menus.
- **Unit dropdown** per line: nr / m / m² / m³ / kW / kg / hr / item / sum. Rate field's label adapts ("£/nr", "£/kW", etc.).
- **Optional NRM2 category** per group (picker: Cat 0–8 or "none"). Metadata only; doesn't affect compute.
- **On-costs footer:** five lines (fees / prelims / OHP / contingency / inflation), each showing project default by default, click-to-override per intervention. NRM2-sequence application (fees/prelims/OHP on lines, then contingency/inflation on subtotal-with-works).
- **Keyboard discipline:** Tab/Shift+Tab navigation; Enter on last cell adds line; Cmd+Enter adds group; Up/Down arrows on number fields; Esc reverts.
- **Per-project template library:** templates saveable from any cost plan ("Save current as template…"); applicable to any intervention's cost plan ("Apply template…"). Persisted on project state.
- **Updated computation helpers** in `costModel.js`:
  - `computeGroupSubtotal(group)`, `computeLinesTotal(cost)`, `computeOnCostsBreakdown(cost, projectDefaults)`, `computeCostPlanTotal(cost, projectDefaults)`.
  - Brief 90's `computeCostTotal(cost)` becomes a thin wrapper around `computeCostPlanTotal`.
- **Canonical-read helpers** in `costReads.js`:
  - Existing `readProjectDefault`, `readEnergyPrice` stay.
  - New `readTemplate(templateId, project)`, `listTemplates(project)`, `saveTemplate(name, costPlan, project)` for the template library.
  - `readRateForIntervention` repurposed for template lookup OR removed if redundant — Code decides during Part 3.
- **Strategy capex aggregation** still works (just sums `computeCostPlanTotal` per enabled intervention).
- **Per-intervention card population** still works (£/tonne, Simple payback both consume the new total seamlessly).

### OUT

- **Cross-project shared template libraries.** v1 per-project.
- **Cost plan export** (Excel, NRM2 XML, PDF). Future brief.
- **BCIS rate database integration.** v1 takes Applemore-derived templates as the seed; project-by-project edits handle regional variation.
- **Cost confidence indicators** (high/med/low per line or plan).
- **NPV / lifecycle cost analysis.**
- **Cost plan versions / history.**
- **Quantity surveyor sign-off workflow.**
- **Engine code changes.** Brief 91 is UI + data model + math only.
- **Bigger UX layout changes** beyond the cost editor itself. The Library page, Strategy page, per-intervention view structure all stay as Brief 87 left them.
- **Applemore template seeding** — that's Part 8, gated on the spreadsheet arrival. Parts 1-7 ship without it.
- **No `npm install` pushed, no `package-lock.json` changes, no `node_modules` modifications** (Bible Claude Code rule).
- **No work on `main`.**

---

## DESIGN DECISIONS ALREADY AGREED

Locked here so any agent resolves ambiguity correctly:

1. **One mode, variable depth.** No "headline / detailed" toggle. The same editor handles one line and fifty lines. Brief 90's mode flag is removed entirely.
2. **Groups with subtotals are the organising unit.** Every line lives in a group. Groups subtotal; groups roll up to lines total; on-costs apply to lines total per NRM2 sequence.
3. **On-costs locked as fixed footer.** Five lines (fees / prelims / OHP / contingency / inflation), always at the bottom, always in this order, applied per NRM2 sequence. Per-intervention overrides supported (click pct to edit); cleared override reverts to project default.
4. **NRM2 category on group is optional metadata.** A free-text group name is required ("Enabling works", "Main equipment", whatever the user chooses). The category tag (0 / 1 / 5 / etc.) is optional, set via ⋮ menu, used for export and consolidated views in future briefs.
5. **Per-project template library for v1.** Templates persist on the project (`project.cost_template_library`). Cross-project sharing is a future migration; data model designed to migrate cleanly.
6. **Keyboard discipline mandatory.** Tab, Shift+Tab, Enter (new line), Cmd+Enter (new group), Up/Down arrows on numbers, Esc. Tool must feel like Excel for a QS. Acceptance test in Part 7 explicitly walks this.
7. **Migration is one-way and lossless.** Brief 90 cost shape → Brief 91 cost shape. The reverse migration is not required (no rollback).
8. **HeadlineCostEditor.jsx is deleted, not retained.** No legacy code paths. One editor, one data shape.
9. **Templates seed from Applemore when it lands.** Until then, the template library is empty in v1, but the "Save current as template…" affordance works so users can build their own.
10. **Applemore can land mid-brief.** Parts 1-7 don't depend on it. Part 8 (template seeding) runs whenever the spreadsheet is dropped — could be during Brief 91 or after close as a small follow-on commit.

---

## PRINCIPLES / CONSTRAINTS

- **One Part = one commit.** Including STATUS.md and audit-doc update.
- **Engine output is canonical** (Bible). Brief 91 is UI + data only. No engine changes.
- **Variable boundaries stay explicit.** Lines total ≠ subtotal-with-works ≠ total cost. Name each in the data model and in the UI. Don't merge into a single "total" field that hides which on-costs are applied.
- **One canonical read path per quantity** (Bible Rule 11). Project defaults, energy prices, template library all through `costReads`. No direct imports of `costLibrary.js` in editor components.
- **No fabricated rates** (Bible Rule 2). Until Applemore lands, the template library is empty. Users can save their own templates; the seeded library is empty.
- **Visualisation-as-verification.** Open the editor on a Bridgewater ASHP intervention, build the cost plan from the design note's worked example, confirm the total matches £95,941. Total cost shown ≡ math the user can do by hand.
- **Lossless migration.** Brief 90 demo cost on DHW (£215k) must end up as the same £215k after migration. If migration produces a different number, migration is wrong.
- **Performance discipline.** Cost plan editor renders on every keystroke during data entry. Render cost must stay flat with line count up to ~100 lines. No O(n²) computations in the render path.

---

## PARTS (each = one commit)

### Part 1 — Brief landing + design note landing + branch verify

- Document branch choice in audit §1.
- Land brief at `docs/briefs/active/91_cost_plan_builder.md`.
- Land design note at `docs/design-notes/91_cost_plan_builder.md`.
- Audit doc stub at `docs/audit/91_cost_plan_builder.md`.
- Update STATUS.md and `docs/briefs/current.md`.

**Commit:** `Brief 91 P1: brief + design note landing + audit stub`

### Part 2 — Data model + migration

Implement the new cost data shape in `costModel.js`. Add migration helper:

```js
// New shape
intervention.cost = {
  groups: [{ id, name, nrm2_category, collapsed, lines: [{ id, name, quantity, unit, rate, notes }] }],
  on_costs: { design_fees_pct, prelims_pct, ohp_pct, contingency_pct, inflation_pct },
  template_origin: null | string,
  notes: '',
}

// Migration
migrateCostShape(intervention) — detects old shape (cost.mode set, or cost.headline keys present),
  converts to new shape losslessly. Idempotent. Returns intervention with cost in new shape.
```

Write the migration with unit-test-style verification in audit §2: take Brief 90's demo £215k DHW cost (equipment £120k + install £30k + additional £10k + derived design/delivery/contingency), run migration, confirm `computeCostPlanTotal` on the result equals £215k exactly.

Update `intervention.cost` schema definition (TypeScript types or JSDoc — match repo convention). Run migration at project load (`InterventionsModule` mount, or wherever project state hydrates). Subsequent edits use new shape directly.

**Falsifiability:** Bridgewater loads cleanly, DHW intervention still shows £215k total in both the (now-removed) old card and the Strategy capex aggregate, no console errors.

**Commit:** `Brief 91 P2: cost data model + lossless migration`

### Part 3 — Cost computation helpers

Replace Brief 90's `computeHeadlineTotal` / `deriveHeadlineLines` with the new helpers in `costModel.js`:

```js
computeGroupSubtotal(group)  → Σ (line.quantity × line.rate)
computeLinesTotal(cost)      → Σ computeGroupSubtotal(group) for group in groups
computeOnCostsBreakdown(cost, projectDefaults) → {
  design_fees, prelims, ohp, contingency, inflation,
  subtotal_with_works,    // lines + fees + prelims + ohp
  total,                  // subtotal_with_works + contingency + inflation
}
computeCostPlanTotal(cost, projectDefaults) → number
```

Brief 90's `computeCostTotal(cost)` stays as the public API; internally delegates to `computeCostPlanTotal`.

Brief 90's `computeAnnualOperationalSaving`, `computeSimplePayback`, `computePoundsPerTonne` stay unchanged (they consume the total, not the structure).

**Audit §3 worked example:** the ASHP plan from the design note (4 groups, 8 lines, £61,500 lines total, £95,941 total). Confirm each subtotal and each on-cost matches by hand: `Enabling £3,200; Equipment £38,200; Installation £15,900; BWIC £4,200; lines £61,500; fees £7,380; prelims £6,150; OHP £4,920; subtotal-with-works £79,950; contingency £11,993; inflation £3,998; total £95,941`. All numbers cross-check.

Update template-library helpers in `costReads.js`:
- `listTemplates(project)` — returns array of template metadata
- `readTemplate(templateId, project)` — returns full template structure
- `saveTemplate(name, costPlan, project)` — adds to library, returns id
- Decide `readRateForIntervention`'s fate (replace with `readTemplate`, or keep dual).

**Falsifiability:** unit-style verification in audit §3 against the ASHP worked example. All hand-calculated numbers match.

**Commit:** `Brief 91 P3: cost computation + template helpers`

### Part 4 — CostPlanEditor.jsx (the main component)

Build the editor. Delete `HeadlineCostEditor.jsx`. Wire `PerInterventionView` to mount `CostPlanEditor` for the active intervention.

Layout per design note: hierarchical group/line table, group header with subtotal + ⋮ menu, line rows with drag handle / name / qty / unit dropdown / rate / extension / delete, "+ Add line" within group, "+ Add group" at bottom of groups, on-costs footer with five rows, Total at bottom.

Interactions per design note:
- Add/delete/edit/reorder groups and lines
- Unit dropdown adapts rate field label
- NRM2 category picker via ⋮ menu
- On-cost percentage cells show project default in grey by default; click to override; clear reverts
- Collapse/expand groups (persists in `group.collapsed`)

State management: `CostPlanEditor` is controlled — receives `cost` prop, emits `onChange(updatedCost)`. Parent (`PerInterventionView`) holds state and persists via `InterventionsModule.updateInterventionCost(id, cost)` (existing Brief 90 plumbing, unchanged).

Render performance: memoise group subtotals via `useMemo`. Computation per render must stay O(n) on total lines. Test with a 50-line plan (build one in the audit) — typing in any field must feel instant.

**Falsifiability:** open Bridgewater DHW intervention, see migrated £215k cost as one group "Cost plan" with three lines + on-costs. Total matches £215k. Then build the design note's ASHP worked example by hand:
1. Rename group to "Enabling works", add line "Strip out & dispose existing gas boilers", qty 2, unit nr, rate 1200 → extension £2,400, subtotal £3,200 (need to add second line "Decommission gas supply" 1 item £800).
2. Add group "Main equipment", line "ASHP unit 60kW" 2 nr £18,000 → £36,000. Add line "Buffer vessel 500L" 1 nr £2,200. Subtotal £38,200.
3. Add groups "Installation" and "BWIC" with their lines.
4. Confirm total £95,941 displayed.

Screenshot the final plan + total. Should look like a real cost plan.

**Commit:** `Brief 91 P4: CostPlanEditor.jsx + HeadlineCostEditor removal`

### Part 5 — Keyboard discipline

Implement the keyboard behaviours:
- **Tab/Shift+Tab:** field-to-field navigation following visual order (name → qty → unit → rate, then next line)
- **Enter on last field of a row:** adds a new line in the same group, focuses its name field
- **Cmd/Ctrl+Enter:** adds a new group at end of plan, focuses its name field
- **Up/Down arrows on number fields:** increment/decrement by 1 (Shift modifier multiplies by 10)
- **Esc on a field:** reverts to previous value and exits edit mode

These behaviours are the difference between a form and a spreadsheet. The cost plan editor must feel like the latter.

**Falsifiability:** test sequence in audit §5:
1. Open empty cost plan. Cmd+Enter creates group. Type group name. Tab. (Note: Tab might focus elsewhere — adjust so Enter from group name adds first line.) Add three lines via Enter chains.
2. Build a 10-line plan in <60 seconds using only the keyboard. If it takes longer, the keyboard discipline isn't working.

Capture video or screen recording in audit if possible.

**Commit:** `Brief 91 P5: keyboard discipline + spreadsheet feel`

### Part 6 — Template library

Implement template save and apply:

- **"Apply template…" button** at top of editor opens picker modal. Picker shows project's saved templates with name, group count, line count, last-edited date. Selecting one prompts confirmation if current plan has content, then replaces plan with template's structure. Records `template_origin = templateId`.
- **"Save current as template…" button** in editor opens prompt for template name. Saves a deep-cloned copy of current `cost` structure to `project.cost_template_library`. Returns the new template id.
- **Manage templates:** small affordance (perhaps a link in the picker) to rename / delete templates. Optional for v1; if time-constrained, defer.

For v1, the seeded library is empty (no Applemore yet, no fabricated rates). The empty-state of the picker says: "No templates yet. Build a cost plan and save it as a template to reuse across other interventions."

**Falsifiability:** build the ASHP plan in DHW intervention, save as "ASHP DHW retrofit (Bridgewater)". Create a new intervention. Open its cost plan. Apply the template. Plan prefills with the same structure. Modify a rate. Save total. Both interventions independent.

**Commit:** `Brief 91 P6: template library — save and apply`

### Part 7 — End-to-end walkthrough + verification

Manual walkthrough using browser tools:
1. Load Bridgewater. Confirm migration ran cleanly (no console errors, DHW cost still £215k).
2. Open DHW intervention's cost editor. Confirm migrated plan visible.
3. Rebuild as the design note's ASHP worked example. Confirm total £95,941.
4. Test keyboard discipline (Part 5 sequence).
5. Save as template "ASHP retrofit". Apply to a new intervention. Confirm prefill.
6. Verify Strategy capex aggregate updates as cost plans change across interventions.
7. Verify £/tonne CO₂ and Simple payback cards on Isolated view update as cost changes.
8. Verify on-cost percentage override per intervention works (override one, confirm only that intervention changes; project default unchanged).

Screenshots of each step in audit §7.

**Performance check:** build a 50-line plan, type in arbitrary fields, confirm no lag. Open dev tools Performance tab, capture a typing session, confirm no long tasks > 50ms.

Update CLAUDE.md if any rule refinements are warranted. Update STATUS.md.

**Commit:** `Brief 91 P7: end-to-end walkthrough + performance verification`

### Part 8 — Applemore template seeding (deferred until spreadsheet arrives)

This part runs whenever the Applemore Feasibility Cost Plan spreadsheet is dropped at `docs/reference/applemore_cost_plan.xlsm`. Could be during Brief 91 (if Chris drops it before Part 7) or after Brief 91 closes as a small follow-on commit.

When the spreadsheet is available:
- Read the spreadsheet's intervention-specific worksheets
- Extract for each major intervention type (ASHP DHW, MVHR, fabric insulation, LED retrofit, glazing replacement, etc.): groups, lines (name + qty + unit + rate), on-cost percentages
- Add as v1 seed templates in `frontend/src/data/costLibrary.js` → `INTERVENTION_TYPES`
- Update `readRateForIntervention(type)` (or its successor in Brief 91) to return the seeded template
- Make seeded templates appear in every project's "Apply template…" picker as available defaults (distinct from project-saved templates in the UI — perhaps a separator)

**Falsifiability:** open a new intervention, click Apply template, see the Applemore-seeded templates. Apply ASHP DHW. Confirm rates match the spreadsheet. Save as project-level template if desired (creates a project copy editable independently).

**Commit:** `Brief 91 P8: Applemore template seeding` (whenever it runs)

### Part 9 — Close

- All verification gates passed.
- Chris signs off via manual walkthrough.
- `git mv docs/briefs/active/91_cost_plan_builder.md docs/briefs/archive/91_cost_plan_builder_COMPLETED.md`.
- Update STATUS.md close-out (handover-ready, stranger-readable).
- Update `docs/briefs/current.md`.
- Independent review by Claude Chat triggered before close (correctness-invisible numbers; see Independent Review Trigger).
- PR to `main` either with this branch alone, or merged into the existing combined PR if Brief 91 was on `chris/interventions-rework-ux`.

**Commit:** `Brief 91 P9: close — Cost Plan Builder shipped; metrics layer COMPLETE`

---

## VERIFICATION (non-negotiable, falsifiable)

- **Migration is lossless.** Brief 90's £215k DHW demo cost migrates to £215k in the new shape. Verified in audit §2.
- **Worked example matches.** The ASHP plan from the design note (4 groups, 8 lines, on-costs) totals £95,941 by hand and £95,941 in the UI. Verified in audit §3 (math) and §4 (UI walkthrough).
- **Keyboard discipline works.** A 10-line plan can be authored in <60 seconds using only keyboard. Verified in audit §5.
- **Templates round-trip.** Save template → apply to another intervention → independent edits to each. Verified in audit §6.
- **Strategy capex still aggregates.** Sum of `computeCostPlanTotal` per enabled intervention matches Strategy view headline. Verified in audit §7.
- **£/tonne and Simple payback cards still populate.** Brief 90's card wiring works unchanged with the new total. Verified in audit §7.
- **Performance stays flat.** 50-line plan, typing feels instant, no long tasks > 50ms. Verified in audit §7.
- **Bible Rule 11 maintained.** Grep verifies all cost-related reads go through `costReads`.
- **No engine code changes.** `git diff main...HEAD -- frontend/src/utils/instantCalc.js frontend/src/utils/interventionsEngine.js frontend/src/utils/systemsEngine.js` returns nothing meaningful.
- **HeadlineCostEditor.jsx deleted.** Grep returns no references to it.
- **`cost.mode` removed from data model.** Grep returns no references.
- **No `npm install` pushed, no `package-lock.json` changes.**
- **STATUS.md close-out is handover-ready.**

---

## WHAT MUST NOT HAPPEN

- **Any commit, push, or merge to `main` until close** (or until Brief 91 lands on the existing combined PR's branch).
- **Any engine code change.**
- **Retaining HeadlineCostEditor as a fallback.** One editor, one data shape.
- **Retaining `cost.mode` as a legacy field.** Single mode, variable depth.
- **Migrating in a way that loses data.** £215k → £215k, every line accounted for.
- **Two-mode UI** (Headline vs Detailed). One mode only.
- **Fabricated rates** in seeded templates. Applemore is the source of truth for v1 templates; no Applemore = empty library.
- **Cross-project template sharing in v1.** Per-project only.
- **Cost plan export to Excel.** Future brief.
- **`npm install` pushed**, `package-lock.json` modified, `node_modules` changes.
- **Quiet scope expansion.** No BCIS integration, no confidence indicators, no NPV, no versioning.
- **Keyboard discipline broken.** If Tab navigation works but Enter doesn't add a line, brief is not done.
- **Render performance regressions.** 50-line plan must stay snappy.

---

## WHEN TO ESCALATE / STOP

- **Migration of any existing cost shape loses data.** STOP. The Brief 90 demo or any future cost should be lossless. If you can't preserve a value, the migration is wrong.
- **Performance degrades beyond the 50-line / 50ms target.** STOP. Diagnose the render path. If it's structural, surface to Chris before continuing.
- **Keyboard discipline fights React/DOM defaults you can't override.** STOP, document the specific behaviour that won't yield, surface to Chris — possibly accept a smaller keyboard scope for v1.
- **An engine bug surfaces during Brief 91 work** (DHW-occupancy from earlier, or anything else). STOP, document, continue without engine changes.
- **The cost editor UX needs significantly more than the brief's scope** (e.g. column reordering, multi-select edits, copy-paste of rows). STOP — surface to Chris for explicit scope expansion or v2 brief.
- **Templates need cross-project sharing in v1** because a user request makes per-project insufficient. STOP — that's a v2 brief, not Brief 91.
- **3 approaches tried on any blocker without progress.** STOP per Bible's "when stuck" rule.
- **Any indication work has landed on `main`.** STOP IMMEDIATELY.

---

## INDEPENDENT REVIEW TRIGGER

This brief produces correctness-invisible output (£ values from a complex aggregation) and replaces a substantial existing component. **Independent review by Claude Chat is mandatory before close.**

Pre-close handover from Code: post raw GitHub URLs for Claude Chat to read:
- `costModel.js` (the updated computation helpers)
- `costReads.js` (the canonical helpers with template additions)
- `CostPlanEditor.jsx` (the new component)
- The migration function (likely in `costModel.js` or a sibling)
- Audit doc §§2, 3, 5 (migration + math worked examples + keyboard discipline test)

Claude Chat verifies:
- Migration is lossless
- Math matches the design note's worked example by hand
- Bible Rule 11 preserved (no direct imports of `costLibrary.js` in UI components)
- Render performance reasonable (visual inspection of the component, no obvious O(n²) patterns)
- No engine code changed
- Brief 90's removed pieces (HeadlineCostEditor, `cost.mode`, `headline` object) are gone

---

## CLOSE

- All verification gates passed; screenshots in audit doc.
- Claude Chat's independent review complete.
- Chris signs off via manual walkthrough.
- `git mv` brief to archive.
- STATUS.md close-out written for a stranger: cost plan builder shipped, line-item depth, templates, keyboard discipline, Brief 90 superseded cleanly, Strategy capex aggregation still works. **The metrics layer of the interventions module rework is COMPLETE: every intervention carries energy + carbon + cost + £/tonne + payback. Strategy carries the full picture.**
- `docs/briefs/current.md` repointed.
- PR to `main` opens (or merges into the existing combined PR if Brief 91 was on `chris/interventions-rework-ux`).

**Final commit:** `Brief 91 P9: close — Cost Plan Builder shipped; metrics layer COMPLETE`

---

## FINAL REPORT

At close, Claude Code reports to Chris:
- Migration verified lossless (Brief 90 £215k → Brief 91 £215k)
- Worked example matches (ASHP £95,941 by hand = by UI)
- Keyboard discipline working (10-line plan in <60 seconds)
- Template save/apply working with independent edits
- Strategy capex aggregate unchanged in shape, working with new cost source
- Per-intervention cards unchanged, working with new cost source
- Performance: 50-line plan renders instantly
- Bible Rule 11 maintained; no engine changes
- HeadlineCostEditor and Brief 90's mode/headline fields fully removed
- Independent review URLs for Claude Chat
- STATUS.md handover-ready
- The interventions module rework metrics layer is now complete. Next briefs are engine-side (DHW-occupancy audit, EnergyPlus integration) or product-expansion (complex geometry, multi-zone) per the NZA-Sim roadmap.

---

*Brief 91's job: replace Brief 90's six-text-input form with a real cost plan tool. Groups, lines, units, rates, subtotals, on-costs, templates, keyboard discipline. After Brief 91, a QS opening any intervention's cost plan sees a document they'd actually use — and the rest of the interventions module benefits automatically because the cost total is just shaped richer. The cost layer goes from "scaffolding for future detailed mode" to "the real thing."*
