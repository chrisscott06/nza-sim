# Brief 91b (STUB) — Cost Plan Builder completion (P4–P9)

> ⚠️ **No brief touches the cost layer until this closes.** Brief 91 merged to `main` in its
> **transitional** state (Brief 93 consolidation). This stub tracks what remains.

## Status
Brief 91 P1–P3 are on `main` (data model + lossless migration + NRM2 computation + template **data**
helpers). The line-item editor UI (P4) and beyond are not built. Sized **10–18 h** (Claude Code scoping,
2026-07-06). **Physics/engine risk: zero** — pure UI + cost data.

## What remains (sizes from the scoping pass)
- **P4 — XL (5–8 h):** build `cost/CostPlanEditor.jsx` (hierarchical group/line table: dual drag-reorder,
  unit-adaptive rate labels, on-cost override cells, collapse, ⋮ menus). Entangled cleanup in the SAME part:
  delete `HeadlineCostEditor.jsx`, remove the two transitional `costModel.js` blocks, wire migrate-on-read
  at project load. There is no clean "small P4".
- **P5 — L (3–6 h):** keyboard discipline (Tab/Shift-Tab, Enter→new line, Cmd+Enter→new group, ↑↓ on
  numbers, Esc-revert). Brief 91 itself flags this as a "fights React/DOM defaults" escalation risk.
- **P6 — M (1–3 h):** template save/apply UI. **Data helpers already exist** (`costReads.listTemplates/
  readTemplate/saveTemplate/deleteTemplate`, `costModel.instantiateTemplate/cloneGroupsWithNewIds`).
- **P7 — M (1–3 h):** end-to-end walkthrough + 50-line perf. **Needs the dev server free (port 5176)** for
  interactive browser verification.
- **P8 — BLOCKED:** Applemore template seeding. Needs `docs/reference/applemore_cost_plan.xlsm` (not in repo).
- **P9 — S (<1 h):** close (archive, STATUS, independent review, PR).

## Transitional code sites to remove in P4 (file:line on `main`)
1. `frontend/src/utils/costModel.js:144` — `computeCostPlanTotal` old-headline-shape fallback (`if (cost.headline) …`).
2. `frontend/src/utils/costModel.js:158` — transitional `computeHeadlineTotal` + `deriveHeadlineLines` exports
   (only consumer: `HeadlineCostEditor`).
3. `frontend/src/components/modules/interventions/PerInterventionView.jsx:37,222` — imports + mounts
   `HeadlineCostEditor` (delete the component in P4).

## Verification anchors (from Brief 91 audit §2/§3, already node-verified on main)
- Lossless migration: Brief-90 demo DHW cost **£215,040 → £215,040** exact.
- NRM2 worked example: the design-note ASHP plan totals **£95,941** (subtotals + on-costs all cross-check).

## Note for whoever picks this up
P4/P5/P7 **cannot be signed off without browser testing** — the editor + keyboard genuinely need it. Ensure
the dev server (`npm run dev`, port 5176) is available to the agent, or plan for Chris to drive the
interactive verification.
