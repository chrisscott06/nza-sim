# Brief B — NRM2 cost model (populates Brief A's £ placeholders)

**Branch:** New branch off `main` after Brief C merges, OR continue on Brief C's branch if it hasn't merged yet. Code's call. Suggested branch name: `chris/interventions-nrm2-cost-model`.
**Design note (canonical):** `brief_B_design_note.md` — sibling file. Land as `docs/design-notes/brief_B_nrm2_cost_model.md` at Part 1's first commit. **Where this brief and the design note disagree, the design note wins.**
**Author:** Claude Chat (architect)
**Authorised by:** Chris (26 June 2026)
**Brief number:** TBC on landing. Likely 90, sequential after Brief C.
**Reference spreadsheet:** Applemore Leisure Centre Feasibility Cost Plan (already in repo at `docs/reference/applemore_cost_plan.xlsm` or equivalent — Code locates and confirms at Part 2).

---

## BEFORE DOING ANYTHING

- [ ] **Confirm receipt.** Quote this brief's title and the Goal paragraph back to Chris (Bible Brief sync rule 1).
- [ ] **Read this brief in full, plus the design note.** Sibling file `brief_B_design_note.md`. Design note is canonical.
- [ ] **Read repo `CLAUDE.md` and `STATUS.md`** at branch root. CLAUDE.md should contain Bible Rule 11 (canonical reads, from Brief 88). This brief extends the same principle to cost-rate library reads.
- [ ] **Confirm clean working tree, origin in sync.** `git status`, `git fetch --all`, `git log --oneline -20`.
- [ ] **Confirm branch.** Either continue on Brief C's branch (if not merged) or cut a new branch off `main` (cleaner once 87+88+C have merged). Document the choice in audit.
- [ ] **Read the Applemore Feasibility Cost Plan spreadsheet.** This is the reference structure Brief B mirrors. Confirm:
  - "Summary Interventions" sheet structure (6-line headline format)
  - "ElementalCP" worked-example sheet for at least one major intervention (e.g. ASHP) to see the full NRM2 build-up
  - "ElementalSummary" sheet for the aggregation pattern
  - On-costs structure (prelims / OHP / fees / risks / inflation)
  - Default rates per element + per intervention type
- [ ] **Read existing code being built on.**
  - `frontend/src/utils/engineReads.js` and any extensions from Brief C (e.g. `carbonReads.js`) — Brief B follows the same canonical-read pattern.
  - `frontend/src/utils/interventionsEngine.js` — produces per-intervention isolated/marginal/cumulative deltas including per-fuel kWh values. Brief B consumes these for the Simple payback calculation.
  - `frontend/src/components/modules/interventions/StrategyView.jsx` and the per-intervention Isolated view component — the placeholder cards (£ per tonne CO₂, Simple payback, Strategy capex) live here. Brief B populates them.
  - The lifetime carbon math from Brief C (`lifetimeCarbon.js` or equivalent) — Brief B reads `lifetime_tCO2e` for the £/tonne calculation.
- [ ] **Read existing design notes.** Brief A (UX scaffolding), Brief C (CRREM lifetime carbon), Brief 88 (canonical reads).
- [ ] **Run session-start reconciliation pass** (Bible Brief sync rule 3).
- [ ] **Land this brief on disk** at `docs/briefs/active/<NN>_nrm2_cost_model.md` as Part 1's first commit. Design note at `docs/design-notes/brief_B_nrm2_cost_model.md` in the same commit.

---

## GOAL

Populate Brief A's remaining placeholder cards on the per-intervention Isolated view and the Strategy headline with rigorous NRM2-aligned cost build-up math. Every intervention has a defensible total cost in a format a professional QS recognises (matching the Applemore Feasibility Cost Plan structure). Two authoring modes: Headline (6-line fast benchmark) and Detailed (full NRM2 elemental build-up). The £ per tonne CO₂ card combines Brief B's total cost with Brief C's lifetime carbon. Simple payback is total cost ÷ annual operational saving in £, with energy prices stored at project level (user-overridable). Strategy headline aggregates capex across all enabled interventions. After this brief, the metrics layer of the interventions module rework is complete: energy, carbon, cost, payback all populated, all defensible, all in formats a real QS can audit.

---

## SCOPE

### IN

- **Per-intervention cost data model** with two modes (Headline 6-line, Detailed NRM2 elemental). User picks the mode per intervention.
- **Headline mode UI**: simple 6-input form per intervention. Direct £ entry per line, OR derive Lines 1/5/6 from project-level defaults (% of works).
- **Detailed mode UI**: NRM2 elemental tree. Categories 0-8 (Building Works), each containing element groups, each containing element lines (name + quantity + unit + rate → subtotal). Plus on-costs 9-14 (Prelims / OHP / Fees / Other / Risks / Inflation) applied to Building Works subtotal.
- **Default rate library**, seeded from the Applemore spreadsheet. Per intervention type: default headline 6-line costs + detailed elemental templates for the major types (heat pump, MVHR, fabric insulation, glazing).
- **Project-level defaults**: design fees %, prelims %, OHP %, contingency %, inflation %, energy prices (£/kWh electricity, £/kWh gas) — all overridable per project.
- **Populate £ per tonne CO₂ card** on per-intervention Isolated view (combines Brief B's `total_cost` with Brief C's `lifetime_tCO2e`).
- **Populate Simple payback card** on per-intervention Isolated view (`total_cost / annual_operational_saving_£`, clamped to 999 years for "no payback" cases).
- **Populate Strategy headline capex** (sum across enabled interventions).
- **Populate Strategy-level £ per tonne CO₂** (`total_capex / total_lifetime_carbon_saved`).
- **Populate Strategy-level Simple payback** (`total_capex / total_annual_operational_saving_£`).
- **Canonical-read helpers** for rate library, energy prices, cost totals. Same Bible Rule 11 pattern as Brief 88 and Brief C.

### OUT

- **Engine changes.** Brief B is UI + data model only.
- **Multi-region pricing** (BCIS regional factors).
- **Temporal rate escalation** (rates by year, indexed to construction inflation).
- **Capex profiling across years** (phased deployment with year-by-year capex curve).
- **NPV / discounted cashflow analysis.**
- **Lifecycle cost analysis** (operational cost summed over lifetime).
- **Cost confidence indicators** (high/medium/low).
- **User-contributed rate libraries** (sharing rates across projects).
- **Detailed mode templates for every intervention type.** v1 seeds detailed templates for heat pump, MVHR, fabric insulation, glazing. Other types start in headline mode only; user can switch to detailed and author lines manually.
- **No `npm install` pushed, no `package-lock.json` changes, no `node_modules` modifications** (Bible Claude Code rule).
- **No `main` work.** Branch-only until close + PR.

---

## DESIGN DECISIONS ALREADY AGREED

Locked here so any agent resolves ambiguity in the right direction:

1. **NRM2 alignment is non-negotiable.** Output must read like a QS-authored estimate to a real QS. Element names, category structure, on-costs sequence — all match Applemore exactly. This is what makes the cost layer credible.
2. **Two modes per intervention, user-selectable.** Headline 6-line (fast benchmark) and Detailed elemental (full build-up). User can flip between them per intervention. Switching from Headline to Detailed prefills detailed lines from the type-default template if available; switching from Detailed to Headline collapses to category subtotals.
3. **Applemore is the v1 rate library floor.** Code lifts rates and structure directly from the spreadsheet. Library expansion (BCIS, regional, temporal) explicitly deferred.
4. **Project-level defaults overridable.** Design fees %, prelims %, OHP %, contingency %, inflation %, energy prices — all stored at project level, all user-overridable. Defaults from Applemore.
5. **Simple payback uses annual operational saving in £.** `total_cost / (annual_kWh_electricity_saved × £/kWh_electricity + annual_kWh_gas_saved × £/kWh_gas)`. Clamped to 999 years for "no payback within lifetime" cases.
6. **£ per tonne CO₂ combines Brief B's £ with Brief C's tCO₂e.** `total_cost / lifetime_tCO2e`. Card on per-intervention view shows £/tonne. Card on strategy view shows strategy-level £/tonne.
7. **Bible Rule 11 extends to cost data.** Canonical-read helpers: `readRateForIntervention(type)`, `readProjectDefault(key)`, `readEnergyPrice(fuel)`, etc. No alternate paths.
8. **Strategy capex sums across enabled interventions only.** Disabled interventions in the stack contribute 0. Reordering doesn't change capex (it's order-independent — different from cumulative carbon which is order-dependent via marginal attribution).
9. **Energy prices stored at project level.** Default UK 2026: electricity £0.30/kWh, gas £0.08/kWh. User-overridable per project. Single value per fuel for v1 (no time-of-day, no seasonal, no escalation).
10. **Cost data persists on the intervention object in the project schema.** Schema version bump for the rate library structure. Migration: existing projects get `cost: { mode: 'headline', lines: { ... } }` populated with type-default rates from the library.

---

## PRINCIPLES / CONSTRAINTS

- **One Part = one commit.** Including `STATUS.md` and audit-doc update.
- **Engine output is canonical** (Bible). Brief B consumes engine outputs (per-fuel kWh per intervention) and applies cost data on top. Never tweak engine numbers for cost reasons.
- **Variable boundaries stay explicit** (Bible). "Annual electricity saved kWh" is one boundary; "annual operational £ saved" is downstream. Don't conflate.
- **One canonical read path per quantity** (Bible Rule 11). Rate library, project defaults, energy prices all read through canonical helpers.
- **NRM2 alignment is verifiable.** Code verifies its Detailed mode output against the Applemore spreadsheet's structure. If the output doesn't look like Applemore at a structural level (categories, element groups, on-costs order), the alignment is off.
- **Visualisation-as-verification** (Bible). Load Bridgewater, build a detailed cost on the DHW heat pump intervention, compare against what a QS would produce by hand against the Applemore template. If they don't match in structure, fix.
- **No engine changes without separate brief.** If during Brief B work an engine bug surfaces (e.g. annual operational saving values look wrong), STOP and escalate.

---

## PARTS (each = one commit)

### Part 1 — Brief landing + design note landing + branch verify

- Confirm branch choice. Document in audit.
- Land brief at `docs/briefs/active/<NN>_nrm2_cost_model.md`.
- Land design note at `docs/design-notes/brief_B_nrm2_cost_model.md`.
- Open audit-doc stub at `docs/audit/<NN>_nrm2_cost_model.md`.
- Update `STATUS.md` and `docs/briefs/current.md`.

**Commit:** `Brief <NN> P1: brief + design note landing + audit stub`

### Part 2 — Applemore source-read + rate library extraction

Read the Applemore Feasibility Cost Plan spreadsheet. Extract and document in audit §2:

- **Spreadsheet location in repo.** Confirm path.
- **Summary Interventions sheet structure.** Six-line headline cost format. Capture the exact column headers + line names.
- **ElementalCP sheet for at least one worked intervention** (probably ASHP since it's substantial). Capture: element categories used, element groups within each, element lines, units, rates, subtotal pattern.
- **ElementalSummary sheet.** The aggregation pattern across all interventions.
- **On-costs structure.** Percentages applied (prelims, OHP, fees, risks, inflation), where they're applied, in what order.
- **Default rates** that can be lifted directly into the rate library. Per intervention type: headline 6-line costs. Per element / per unit: rates with units (e.g. £/m² wall insulation, £/kW heat pump capacity).
- **Project-level defaults**: design fees %, prelims %, OHP %, contingency %, inflation %.

Build the rate library data structure. Suggested location: `frontend/src/data/costLibrary.js` (or similar). Structure:

```js
export const COST_LIBRARY = {
  intervention_types: {
    ashp_dhw: {
      headline_default: {
        design_engineering: ...,
        equipment: ...,
        installation_commissioning: ...,
        additional_measures: ...,
        project_delivery: ...,
        contingency: ...,
      },
      detailed_template: {
        // NRM2 categories with element lines
      },
    },
    led_retrofit: { ... },
    // etc.
  },
  project_defaults: {
    design_fees_pct: 12,
    prelims_pct: 10,
    ohp_pct: 8,
    contingency_pct: 15,
    inflation_pct: 5,
    electricity_price_per_kWh: 0.30,
    gas_price_per_kWh: 0.08,
  },
}
```

**Audit-doc deliverable:** include a comparison table showing Applemore's structure on the left, NZA-Sim's rate library structure on the right. They should look like the same document.

**Commit:** `Brief <NN> P2: Applemore source-read + rate library extraction`

### Part 3 — Canonical-read helpers + cost data model

Add canonical-read helpers (Bible Rule 11 extension). Either extend `engineReads.js` or create `costReads.js`. Required helpers:

- `readRateForIntervention(type, mode)` — returns the type's default cost structure for headline or detailed mode.
- `readProjectDefault(key)` — returns project-level default for a given key (design_fees_pct, electricity_price_per_kWh, etc.).
- `readEnergyPrice(fuel)` — returns £/kWh for the given fuel.

Add the cost data shape to the intervention object schema:

```js
intervention.cost = {
  mode: 'headline' | 'detailed',
  headline: { design_engineering, equipment, installation_commissioning, additional_measures, project_delivery, contingency },
  detailed: { /* NRM2 elemental tree */ },
  computed_total: number, // cached for display
}
```

Schema version bump. Migration: any existing intervention without `.cost` gets `.cost.mode = 'headline'` and `.cost.headline` populated from the rate library's default for that intervention type. Existing projects keep working without user action.

Add the cost computation functions:

- `computeHeadlineTotal(headline_lines, project_defaults)` — applies project-level percentages for design fees / project delivery / contingency if those lines were entered as percentages rather than absolute £.
- `computeDetailedTotal(detailed_tree, project_defaults)` — sums NRM2 categories 0-8 to Building Works; applies on-costs 9-14; returns Total Estimated Construction Cost.
- `computeAnnualOperationalSaving(intervention_isolated_result, project_defaults)` — uses engine output (annual kWh per fuel) × project's energy prices to give annual £ saving.
- `computeSimplePayback(total_cost, annual_saving)` — returns years, clamped to 999.
- `computePoundsPerTonne(total_cost, lifetime_tCO2e)` — returns £/tonne, with sensible handling of zero-carbon-saved cases.

**Falsifiability:** existing engine output unchanged. Bridgewater anchor unaffected. Migration produces non-zero costs on all six pre-authored interventions matching their library type-defaults.

**Commit:** `Brief <NN> P3: canonical cost-read helpers + data model + migration`

### Part 4 — Headline mode UI

Build the Headline mode authoring UI for the per-intervention view. Probably lives in the intervention editor (the pencil-edit modal or similar from Brief 87).

- Six input fields, one per cost line, with NRM2-aligned labels matching Applemore.
- Each input accepts £ directly OR a "use default" toggle that applies the project-level default.
- Live total shown at the bottom.
- Mode toggle: "Headline / Detailed" — switches to Detailed mode (prefills from library template if available).

Populate the £ per tonne CO₂ card and Simple payback card on the Isolated view from these values.

**Falsifiability:** load Bridgewater, edit the DHW heat pump intervention's cost in Headline mode, observe the Isolated view's £ per tonne CO₂ and Simple payback cards update in real time. Numbers physically sensible:
- DHW heat pump: total ~£100k-£200k, £/tonne probably £500-£2,000 (good carbon investment), payback probably 8-15 years.
- LED retrofit: total ~£10k-£30k, £/tonne probably £2,000-£10,000 (worse for carbon but quick payback), payback probably 3-7 years.

**Commit:** `Brief <NN> P4: Headline mode UI + Isolated view cards populated`

### Part 5 — Detailed mode UI

Build the Detailed mode NRM2 elemental UI. This is the substantial part of Brief B.

- NRM2 category tree (0 Facilitating Works through 8 External Works) collapsible.
- Within each category, element groups (e.g. Category 5 Services has groups for "Heat source", "Space heating & AC", "Ventilation", etc.).
- Within each group, element lines: name + quantity + unit + rate → subtotal.
- "Add line" affordance per group.
- "Apply template" button when a type-default detailed template exists for this intervention type (prefills the tree).
- On-costs section (categories 9-14) below Building Works, with project-default percentages pre-applied + user override per line.
- Running total at bottom: Total Building Works (Σ 0-8) → Total Estimated Construction Cost (after on-costs).

Visual style should match the Applemore spreadsheet — same category labels, same element group names, same on-cost line names. A QS opening this UI should immediately recognise it.

**Falsifiability:** load Bridgewater, open DHW heat pump intervention's cost in Detailed mode (with the ASHP template applied), confirm:
- NRM2 categories visible and collapsible
- Element groups populated from the Applemore template
- Element lines have name + qty + unit + rate + subtotal
- On-costs applied at expected percentages
- Total matches what the Applemore spreadsheet would produce for the same scenario

Screenshot side-by-side with the Applemore worksheet — they should look like the same document.

**Commit:** `Brief <NN> P5: Detailed mode NRM2 UI`

### Part 6 — Strategy view capex + headline metrics

Wire the cost layer into the Strategy view. Populate:

- **Total Capex** in the Strategy headline (sum across enabled interventions).
- **Strategy-level £ per tonne CO₂** (`total_capex / total_lifetime_carbon_saved`, where lifetime carbon comes from Brief C).
- **Strategy-level Simple payback** (`total_capex / total_annual_operational_saving_£`).

These display alongside Brief C's lifetime carbon and CRREM misalignment numbers in the Strategy headline row.

**Falsifiability:** load Bridgewater Strategy view, confirm capex sums across the six enabled interventions to a sensible total (probably £200k-£500k range for the current mix). £/tonne and payback computed from the totals.

**Commit:** `Brief <NN> P6: Strategy view capex + headline metrics`

### Part 7 — Project settings: defaults + energy prices

Add project-level settings UI for the cost defaults and energy prices. Lives wherever project settings live (probably the same place as Brief C's CRREM picker).

- Design fees %, prelims %, OHP %, contingency %, inflation % (with Applemore-sourced defaults)
- Electricity price £/kWh, gas price £/kWh (with UK 2026 defaults)
- Changing any of these updates all interventions' computed totals on next render (live).

**Falsifiability:** load Bridgewater, change electricity price from £0.30 to £0.50 in project settings, switch to Library/Strategy, confirm Simple payback values on interventions update (faster payback because energy savings worth more).

**Commit:** `Brief <NN> P7: project cost settings + energy prices`

### Part 8 — Cleanup + grep verification

- Run `grep -r "costLibrary\|COST_LIBRARY" frontend/src/` — confirm all reads go through canonical helpers, not direct imports of the library file outside the helpers themselves.
- Run `grep -r "design_fees\|prelims\|electricity_price\|gas_price" frontend/src/` — confirm all reads of project-level defaults go through `readProjectDefault()`, not direct property access.
- Run `grep -r "TODO\|FIXME\|HACK" frontend/src/` on changed files; clean up.
- Update CLAUDE.md if any rules need refinement.
- Update `STATUS.md` close-out (handover-ready, written for a stranger picking up cold).

**Commit:** `Brief <NN> P8: cleanup + canonical-read verification`

### Part 9 — Walkthrough + close

- Browser walkthrough via MCP browser tools. Capture screenshots:
  - Library page: each of six Bridgewater interventions showing populated £ per tonne CO₂ and Simple payback cards
  - Per-intervention Headline mode UI (one example)
  - Per-intervention Detailed mode UI showing NRM2 structure (DHW heat pump with ASHP template applied)
  - Strategy view headline row showing Total Capex, Strategy £/tonne, Strategy Simple payback alongside Brief C's CRREM numbers
  - Project settings panel showing cost defaults and energy prices
- Chris runs the walkthrough manually before close commit.
- After Chris signs off: archive brief, update STATUS, update current.md, single push.
- PR from this branch to `main`.

**Commit:** `Brief <NN> P9: walkthrough + close + STATUS update`

---

## VERIFICATION (non-negotiable, falsifiable)

- **NRM2 structural alignment with Applemore.** Detailed mode UI shows the same category structure, element group names, and on-costs sequence as the Applemore spreadsheet. Side-by-side comparison screenshot in audit.
- **All six Bridgewater interventions have populated cost data** after migration. £ per tonne CO₂ and Simple payback cards populated on Isolated view.
- **Strategy headline shows Total Capex, £/tonne, Simple payback** alongside Brief C's CRREM numbers.
- **Headline ↔ Detailed mode switching works** without data loss. Detailed mode prefills from template if available; Headline mode collapses Detailed to category subtotals.
- **Project-level defaults flow through.** Changing energy price in project settings updates Simple payback values on all interventions.
- **Bible Rule 11 maintained.** `grep -r "costLibrary" frontend/src/` returns canonical helper file + the cost library file itself only. No direct UI imports.
- **No engine code changes.** `git diff main...HEAD -- frontend/src/utils/instantCalc.js frontend/src/utils/interventionsEngine.js frontend/src/utils/systemsEngine.js` returns nothing meaningful.
- **No Brief A/C UX changes.** Layout, card positions, chart styles — all untouched.
- **`main`'s Bridgewater anchor unchanged.**
- **No `npm install` pushed, no `package-lock.json` changes.**
- **STATUS.md close-out is handover-ready.**

---

## WHAT MUST NOT HAPPEN

- **Any commit, push, or merge to `main` until close.**
- **Any engine code change.** Brief B is UI + data model only.
- **Any direct read of cost library, project defaults, or energy prices outside the canonical helpers.** Bible Rule 11 stays enforced.
- **Multi-region pricing**, **temporal escalation**, **NPV / discounted cashflow**, **lifecycle cost analysis** — all explicitly deferred to future briefs.
- **Detailed mode templates for every intervention type.** v1 seeds heat pump, MVHR, fabric insulation, glazing only. Other types start in Headline mode.
- **`npm install` pushed**, **`package-lock.json` modified**, **`node_modules` changes**.
- **Brief A/C UX layout changes.** Card positions, chart placements, page structure all stay.
- **NRM2 structure deviations.** If the implementation diverges from Applemore's structure, fix the implementation, don't justify the deviation.
- **Quiet scope expansion.** Cost confidence indicators, user-contributed rate libraries, regional adjustment factors — all explicitly out.

---

## WHEN TO ESCALATE / STOP

- **Applemore spreadsheet structure is more complex than the design note assumed** (e.g. multi-sheet aggregation across worked examples that doesn't fit the proposed library shape). STOP, document, propose revised data model.
- **NRM2 structure can't be expressed cleanly in the UI** within reasonable interaction complexity. STOP, screenshot what you have, share with Chris, decide simplification path.
- **Engine output doesn't carry per-fuel annual kWh values per intervention** in the shape needed for Simple payback math. STOP — that's an engine question, escalate to a separate brief.
- **Detailed mode UI has more than ~50 inputs visible at once** for a typical intervention. STOP — the UI is getting unwieldy. Consider whether NRM2 categories should be progressively disclosed (collapsed by default, expand on click) or whether the template approach needs different framing.
- **Migration causes any Bridgewater anchor number to drift.** STOP — migration should be lossless on engine outputs.
- **3 approaches tried on any blocker.** STOP per Bible's "when stuck" rule.
- **Any indication work has landed on `main`.** STOP IMMEDIATELY.

---

## INDEPENDENT REVIEW TRIGGER

This brief produces correctness-invisible output (£ values). Independent review **mandatory and proactive** per Bible verification framework.

Before close, Claude Chat reads:
- The canonical-read helpers
- The cost data model + migration function
- The Headline mode computation (`computeHeadlineTotal`)
- The Detailed mode computation (`computeDetailedTotal`)
- The Simple payback and £/tonne computations
- A screenshot comparison of Detailed mode UI vs Applemore spreadsheet

…and verifies:
- NRM2 structure matches Applemore at a category + on-costs level
- Canonical-read principle preserved
- Math is right (sum of category subtotals = Building Works; on-costs applied correctly)
- Migration is lossless

Pre-close handover from Code: post diff URLs for Claude Chat to read.

---

## CLOSE

- Browser walkthrough complete; screenshots captured at all verification points.
- Claude Chat's independent source-read review complete.
- Chris signs off via manual browser walkthrough.
- `git mv` brief to `archive/`.
- `STATUS.md` close-out written for a stranger: cost layer now populated, every intervention has total cost + £/tonne + payback, strategy carries Total Capex, NRM2 structure matches Applemore, project defaults overridable. **The metrics layer of the interventions module rework is complete.**
- `docs/briefs/current.md` repointed.
- PR opens from branch to `main`.

**Final commit:** `Brief <NN> P9: close — NRM2 cost model landed; interventions rework metrics layer COMPLETE`

---

## FINAL REPORT

At close, Claude Code reports to Chris:
- Applemore source-read summary — rate library extracted, structure documented
- Cost data model + migration walkthrough
- Headline mode + Detailed mode UI screenshots
- Cards populated on all six Bridgewater interventions
- Strategy headline populated with Total Capex + £/tonne + Simple payback
- Project settings showing cost defaults + energy prices
- Bible Rule 11 maintained
- Engine code untouched; Bridgewater anchor unchanged
- Independent review handover URLs
- STATUS.md handover-ready
- The interventions module rework is now complete (A done, C done, B done). Next briefs are engine-side (DHW-occupancy audit, full Bridgewater EnergyPlus integration) or product-expansion (complex geometry, multi-zone) per the roadmap.

---

*Brief B closes the interventions module rework cycle. After it ships, every intervention has energy + carbon + cost + payback in NRM2 format. Strategy carries the full picture for a client deliverable. The metrics layer is complete; subsequent work moves to engine improvements and product expansion per the NZA-Sim roadmap.*
