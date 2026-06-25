# Audit — Brief 87: Interventions UX rework (Library/Strategy split + two-section per-intervention view)

Branch: `chris/interventions-rework-ux` (cut from `main` `d8a6207`, Brief 77).
Design note (canonical): [`docs/design-notes/interventions_rework.md`](../design-notes/interventions_rework.md).
Brief: [`docs/briefs/active/87_interventions_ux_rework.md`](../briefs/active/87_interventions_ux_rework.md).

UX restructure only — no engine changes (Brief 41 declarative-patches, Brief 71 attribution, Brief 76
vent fix all preserved). Cost (Brief B) and CRREM lifetime carbon (Brief C) land on top later as
placeholders here.

## §1 — Part 1: landing
Brief + design note landed; this audit stub opened; STATUS + current.md updated. Branch verified cut
from `main` `d8a6207`. `active/` carries 70 + 75 (open carry-forwards, not stale — left in place).

## §2 — Part 2: source read + Library/Strategy data model audit
_(to fill — read-only audit of the existing six-tab interventions module)_
- Current six-tab structure (Waterfall / Isolated / Before / After / Heat Balance Calc / Trail Breakdown): what each reads, data flow, render sites (file:line).
- Existing data model: how interventions are stored (Brief 41 patch schema), engine consumption, marginal/cumulative/isolated outputs.
- Proposed Library/Strategy model + migration path (default "Strategy 1" holding all current interventions in order).
- Schema additions (`strategies[]`).
- Call sites assuming "all interventions are in the stack."
- **Engine-change risk gate:** if the rework needs engine changes, STOP and escalate.

## §3 — Part 3: Strategy data model + migration
_(to fill)_

## §4 — Part 4: Library page + two-section per-intervention view
_(to fill)_

## §5 — Part 5: Strategy page + reorder + waterfall + final-state views
_(to fill)_

## §6 — Part 6: wiring + cleanup
_(to fill)_

## §7 — Part 7: walkthrough + close
_(to fill)_
