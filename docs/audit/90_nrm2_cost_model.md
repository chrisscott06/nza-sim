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
