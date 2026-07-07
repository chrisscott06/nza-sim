# Audit — Brief 90: NRM2 cost model (Brief B)

Branch: **`chris/interventions-rework-ux`** (continued — Brief 87/88/89 not yet merged; combined PR).
Design note (canonical): [`../design-notes/brief_B_nrm2_cost_model.md`](../design-notes/brief_B_nrm2_cost_model.md).
Brief: [`../briefs/active/90_nrm2_cost_model.md`](../briefs/active/90_nrm2_cost_model.md).

## §1 — Branch decision (Part 1)
Continue on `chris/interventions-rework-ux`: Brief B populates Brief A's remaining placeholder cards
(£/tonne CO₂, Simple payback, Strategy capex) and reads Brief C's `lifetime_tCO2e` — both live on this
branch and aren't on `main` yet. A fresh cut off `main` would lack them. Combined PR at the end of the
A → C → B sequence.

## ⛔ BLOCKER — Part 2 cannot proceed without the Applemore spreadsheet

**Part 2 (Applemore source-read + rate library extraction) is blocked.** The brief and design note are
built entirely on the **Applemore Leisure Centre Feasibility Cost Plan** spreadsheet — its "Summary
Interventions" (6-line headline), "ElementalCP" (NRM2 elemental build-up), "ElementalSummary"
(aggregation), on-costs structure, and default rates are the v1 rate-library floor and the structural
template the Detailed-mode UI must mirror.

**The spreadsheet is NOT in the repo.** Searched:
- `find . -iname "*applemore*" -o -iname "*cost_plan*" -o -iname "*feasibility*cost*"` → nothing.
- `docs/reference/` → does not exist.
- Only spreadsheet present: `Bridgewater_Bottom_Up_Energy_Model.xlsx` (the energy model — unrelated to cost).

The brief assumed it at `docs/reference/applemore_cost_plan.xlsm or equivalent — Code locates and confirms
at Part 2`. It isn't there.

**Why I will not proceed past Part 1 without it:**
- The rate library, the NRM2 elemental templates, and the project on-cost defaults all come *from* the
  spreadsheet. Building them blind would mean **fabricating cost rates**, which violates CLAUDE.md Rule 2
  ("Never generate synthetic data … Empty is always better than fake").
- The Detailed-mode UI must structurally mirror Applemore (categories, element groups, on-costs order).
  Authoring it against a guessed structure risks rework once the real sheet is seen — the brief's own
  escalation rule says STOP if "the Applemore spreadsheet structure is more complex than the design note
  assumed."

**What Chris needs to provide:** the Applemore Feasibility Cost Plan spreadsheet, placed at
`docs/reference/applemore_cost_plan.xlsm` (or share it and I'll land it there). Once present, Part 2
onward is unblocked.

**What CAN be built without it (if desired, on a follow-up):** the engine-side, rate-free pieces —
`computeAnnualOperationalSaving` (uses engine per-fuel kWh × project energy prices, which the design note
gives: electricity £0.30/kWh, gas £0.08/kWh), `computeSimplePayback`, `computePoundsPerTonne`
(reads Brief C's `lifetime_tCO2e`). But the cost *inputs* those consume (total cost per intervention)
require the rate library → still gated on Applemore. So the honest stopping point is Part 1 + this flag.

## §2 — Applemore source-read + rate library
_BLOCKED — pending the spreadsheet (see above)._

## §3 — Cost data model + canonical helpers + math (Parts 2/3, rate-free)

Per Chris's "carry on" (2026-06-26), built the rate-free framework — everything except the
Applemore-seeded type rates + the Detailed NRM2 mode (deferred, must mirror Applemore):

- `data/costLibrary.js` — `HEADLINE_LINES` (6 NRM2 lines), `PROJECT_COST_DEFAULTS` (design-note values:
  fees 12% / prelims 10% / OHP 8% / contingency 15% / inflation 5% / elec £0.30 / gas £0.08),
  `NRM2_BUILDING_WORKS` (0–8) + `NRM2_ONCOSTS` (9–14) for the future Detailed tree. `INTERVENTION_TYPES`
  is **EMPTY** — no fabricated rates (Rule 2); seed from Applemore when it lands.
- `utils/costReads.js` — canonical: `readProjectDefault` (project override > library floor),
  `readEnergyPrice`, `readRateForIntervention` (null until seeded), `hasSeededRates`.
- `utils/costModel.js` — `computeHeadlineTotal`, `deriveHeadlineLines` (design/delivery/contingency from
  works + project %s), `computeCostTotal`, `computeDetailedTotal` (shell), `computeAnnualOperationalSaving`
  (engine per-fuel kWh saved × energy price), `computeSimplePayback` (clamp 999, null when no saving),
  `computePoundsPerTonne` (total ÷ Brief C lifetime tCO₂e), `migrateInterventionCost` (lossless).

**Worked example (verified by node):** DHW heat pump, user enters equipment £120k + install £30k +
additional £10k → works £160k. Derived: design £13,440 (160k·12%·70%), delivery £5,760 (·30%),
contingency £35,840 ((works+design+delivery)·(15%+5%)). **Total £215,040.** Annual saving £11,392/yr
(gas 188.9 MWh·£0.08 = £15,112 saved − elec 12.4 MWh·£0.30 = £3,720 added). **Payback 18.9 y.**
**£/tonne £350** (£215k ÷ 614.8 tCO₂e). No-saving case → payback null. All sensible.

## §4 — Headline mode UI + cards (Part 4)

`cost/HeadlineCostEditor.jsx` (6 NRM2 lines + "Fill % lines from defaults" + live total) on the
`PerInterventionView` Isolated section. `InterventionsModule.updateInterventionCost(id, cost)` persists
to `params.interventions[].cost` via `updateParam`. The £/tonne + Simple payback cards populate from
`computeCostTotal` / `computeAnnualOperationalSaving` / `computePoundsPerTonne` / `computeSimplePayback`;
they show "enter cost below" until a cost exists (honest empty state, no fabricated number).

**Verified in browser (DHW, Bridgewater):** entered equipment £120k + install £30k + additional £10k →
"Fill from defaults" derived design £13,440 / delivery £5,760 / contingency £35,840 → **Total £215,040**;
cards updated live to **£/tonne £350** and **payback 18.9 yr** (£11,408/yr saved); persisted ("Saved").
Matches the node worked example. (A demo cost now sits on DHW; other interventions remain uncosted.)

## §5 — Detailed NRM2 mode (Part 5) — DEFERRED
Must mirror the Applemore elemental structure exactly; building it blind risks rework. The shell
(`computeDetailedTotal`, `NRM2_BUILDING_WORKS`, `NRM2_ONCOSTS`) is in place. Full Detailed-mode UI lands
when the Applemore spreadsheet arrives.

## §6 — Strategy capex (Part 6)

`StrategyView` headline: **Total Capex** = Σ enabled interventions' `computeCostTotal(cost)`
(order-independent, unlike cumulative carbon); **£/tonne CO₂** = capex ÷ strategy lifetime tCO₂e. Both show
"add costs in Library" until a cost exists. Verified Bridgewater (DHW costed at £215k): headline shows
**Total Capex £215k** + **£/tonne £270** (215,040 ÷ 797). Build clean.

## §7 — Project cost settings (Part 7) — DEFERRED (override convenience)
The cost layer runs on the design-note project defaults (fees/prelims/OHP/contingency/inflation, energy
prices £0.30/£0.08). A settings UI to *override* them per project is a convenience follow-on — deferred
with Part 5. `readProjectDefault` already reads `params.cost_defaults` first, so the override path is
wired; only the editing UI is pending.

## §8 — Status
Brief B delivered (rate-free): cost model + canonical helpers + Headline mode UI + per-intervention
£/tonne & payback cards + strategy capex. **Pending the Applemore spreadsheet:** the seeded rate library
(Part 2) + Detailed NRM2 mode (Part 5). Settings-override UI (Part 7) is a small follow-on. No engine
changes; all cost reads via `costReads` (Rule 11).
