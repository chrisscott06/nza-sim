# Audit — Brief 91: Cost Plan Builder (replaces Brief 90's Headline UI)

Branch: **`chris/interventions-rework-ux`** (continued).
Design note (canonical): [`../design-notes/91_cost_plan_builder.md`](../design-notes/91_cost_plan_builder.md).
Brief: [`../briefs/active/91_cost_plan_builder.md`](../briefs/active/91_cost_plan_builder.md).

## §1 — Branch decision (Part 1)
Continue on `chris/interventions-rework-ux`. 87/88/89/90 are not merged; Brief 91 supersedes Brief 90's
editor UI + `intervention.cost` shape, and Chris's walkthrough sign-off hasn't happened (he wants the
thorough walkthrough "once this is complete"). Cleanest history = land the replacement on the same branch
before the combined PR. Brief 90's cost *model/helpers/cards/strategy-capex* are reused unchanged in shape
(only the cost total's source gets richer).

## §2 — Data model + lossless migration (Part 2)

New shape (design note): `cost.groups[].lines[]` + `on_costs` + `template_origin` + `notes`. Removed:
`cost.mode`, `cost.headline`, `cost.detailed`.

**Migration losslessness (canonical gate) vs the design-note prose.** The design note prose suggests
folding Brief 90's derived lines (design/delivery/contingency) "back into on_costs". But Brief 91's on-cost
formula is NRM2-compounding (fees/prelims/OHP on works, then contingency/inflation on subtotal-with-works)
— *different* from Brief 90's `computeHeadlineTotal` (a flat sum of 6 lines). Folding the derived amounts
into on-cost **percentages cannot reproduce the Brief 90 total exactly** under the new formula, which would
violate the non-negotiable lossless gate (£215k → £215k).

**Resolution (losslessness wins):** migrate every non-zero Brief 90 headline entry — including the derived
design/delivery/contingency — into ONE group "Cost plan (migrated)" as explicit lines (qty 1, unit `sum`,
rate = the £ value), with `on_costs` **all zero**. Then `computeCostPlanTotal = lines_total + 0 = the exact
Brief 90 total`. Every Brief 90 value is preserved as a visible line; the user can restructure (move amounts
into on-cost %s) afterwards. This is documented as an intentional divergence from the design-note prose,
justified by the explicit lossless verification gate.

**Verified (node):** Brief 90 DHW cost (`mode:'headline'` + 6 headline values) →
`migrateCostShape` → one group "Cost plan (migrated)" with **6 lines**, on_costs all 0 →
`computeCostPlanTotal` = **£215,040** (exact). Idempotent: re-migrating gives £215,040 again.

`migrateCostShape` lives in `costModel.js`; it's idempotent (new-shape / absent costs pass through). It is
WIRED at project load in P4 (alongside the new editor + HeadlineCostEditor removal) so the data shape and
the editor change in lockstep. Until then, `computeCostPlanTotal` carries a transitional old-shape fallback
(removed in P4) so the DHW card stays £215k.

## §3 — Cost computation + template helpers (Part 3)

`costModel.js`: `computeGroupSubtotal` (Σ qty×rate), `computeLinesTotal` (Σ subtotals),
`computeOnCostsBreakdown` (NRM2 sequence, each on-cost rounded to whole £), `computeCostPlanTotal`,
`computeCostTotal` (Brief 90 public name → wrapper). `cloneGroupsWithNewIds` + `instantiateTemplate` for
templates. `computeAnnualOperationalSaving` / `computeSimplePayback` / `computePoundsPerTonne` unchanged.

`costReads.js`: `listTemplates` / `readTemplate` / `saveTemplate` (pure → returns `{id, library}`) /
`deleteTemplate`. `readProjectDefault` / `readEnergyPrice` unchanged. `readRateForIntervention` kept
(returns the empty `INTERVENTION_TYPES` seed; becomes the Applemore template source in P8).

**Verified (node) — design-note ASHP worked example:** subtotals Enabling £3,200 / Equipment £38,200 /
Installation £15,900 / BWIC £4,200 → **lines £61,500**; on-costs (12/10/8/15/5): design_fees £7,380,
prelims £6,150, ohp £4,920, subtotal-with-works £79,950, contingency £11,993, inflation £3,998 →
**TOTAL £95,941**. Every number matches the design note.

## §4 — CostPlanEditor (Part 4)
_(to fill)_

## §5 — Keyboard discipline (Part 5)
_(to fill)_

## §6 — Template library (Part 6)
_(to fill)_

## §7 — Walkthrough + performance (Part 7)
_(to fill)_
