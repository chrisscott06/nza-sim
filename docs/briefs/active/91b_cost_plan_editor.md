# Brief 91b: Cost Plan Editor — Completion (Brief 91 P4–P9, HIEX-seeded)

**Design authority:** the original Brief 91 spec (`docs/briefs/archive/` or `active/91_cost_plan_builder.md` — find it) + the `91b_cost_plan_completion_STUB.md`. This brief completes them with the deltas below. Where this brief and the 91 spec disagree on editor behaviour, the 91 spec wins; where either is silent, STOP-and-ask.

## BEFORE DOING ANYTHING
1. Confirm receipt: title + Goal quoted back.
2. **Precondition:** PRs #2 and #3 are merged to `main`. If not, STOP.
3. Branch: `chris/cost-plan-editor` off fresh `main`. Land this brief at `docs/briefs/active/91b_cost_plan_editor.md` as Part 1's first commit; reconcile session state.
4. Baseline: `--fixture` anchor byte-identical at start and close — this brief touches zero physics.

## Goal
Finish what Brief 91 started: replace the transitional headline cost card with the full hierarchical Cost Plan Editor (groups → line items, quantity × unit × rate, unit-adaptive labels, % on-cost lines, drag + keyboard reorder, templates), delete the old editor and the transitional dual-path, and prove it on the HIEX-seeded cost plans that are now live on main. This lifts the "no brief touches the cost layer" quarantine.

## Deltas from the original Brief 91 spec
1. **P8 Applemore seeding is DEAD — replaced.** The 22 HIEX cost plans (Brief 96, reconciled ±1%) are already in the data model. New P8: derive **type-default rates** from the HIEX benchmark lines (per category: £/kW, £/m², £/unit, £/(l/s), day-rates, on-cost %s) so "Fill % lines from defaults" and new-line rate suggestions draw from real research, with source strings carried. The stale "Applemore will pre-fill" footnote copy is deleted with the old editor.
2. **Acceptance case:** the HIEX 1.4 DHW ASHP plan (~£105k central, NRM tier) must render, edit, and re-total correctly in the new editor — line items, on-costs, low/central/high. Second case: a Simple-tier item (5.2 LED) renders as the lightweight single-rate view without ceremony.
3. **One rider from Brief 96 review:** in the report export, rename the "EP-validated ✓" flag to "EP-checked — see Table 3" wherever NZA/EP divergence >25% (currently 3.3). Small, isolated commit.

## Parts (per the 91 spec's P4–P9, renumbered)
- **P1** — brief landing + the flag-rename rider (isolated commit).
- **P2 (91-P4, the XL):** build `CostPlanEditor.jsx` — hierarchical group/line table, dual drag-reorder (groups AND lines), unit-adaptive rate labels, on-cost override cells, collapse, ⋮ menus. Delete `HeadlineCostEditor` + its mount in `PerInterventionView`; strip BOTH transitional `costModel.js` blocks ("removed in P4" markers); wire migrate-on-read at project load. **Reuse the Brief 94 reorder pattern** (target-row + cursor at release, y-only hit-testing, pending spinner) — do not reinvent drag.
- **P3 (91-P5, the risk):** keyboard discipline — Tab/Shift-Tab across the dynamic table, Enter → new line, Cmd+Enter → new group, ↑↓ on numbers, Esc-revert. **Known escalation zone:** if any single behaviour fights React/DOM defaults past 3 attempts, STOP that behaviour, document, move on — a missing keystroke doesn't block the editor.
- **P4 (91-P6):** template save/apply UI — picker modal + "save as template" (data helpers exist from 91-P3).
- **P5 (new P8):** HIEX type-default rates derivation + wiring into defaults/suggestions, sources carried.
- **P6 (91-P7):** end-to-end walkthrough — build the 1.4 DHW ASHP plan from scratch to ~£105k, keyboard pass, template round-trip, the two acceptance cases, 50-line perf check. Browser-verify on **ZZ TEST** with real clicks.
- **P7 (91-P9):** close — anchor invariant, STATUS, archive 91 + 91b stub, PR open, NOT merged.

## MUST NOT
Touch `instantCalc.js` / engines / EP harness · leave either transitional block or the old editor mounted (the whole point is the lie comes off main) · hand-edit Chris's live projects (ZZ TEST only) · merge without Chris walkthrough + independent review.

## Escalate
Keyboard 3-strikes (per part above) · migrate-on-read meets a cost shape the fixture set doesn't cover · any acceptance-case total ≠ HIEX doc central ±1%.

## Independent review (mandatory — data-layer deletion)
Claude Chat reads: the transitional-block deletion diff (nothing else lost), migrate-on-read wiring, `CostPlanEditor` reorder implementation vs the Brief 94 pattern, and the P6 walkthrough record.
