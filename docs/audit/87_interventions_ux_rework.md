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

## §2 — Part 2: source read + Library/Strategy data model audit (read-only)

### Current structure (the brief's "six tabs" has evolved — Brief 47 retired the Stack|Comparison switcher)
`InterventionsModule.jsx` (490 L) is a two-pane layout, no global tab bar:
- **Left** — `InterventionStackView` (the ordered intervention list + baseline summary + add button).
- **Right** — `visualiser/VisualiserHost.jsx` (308 L): a **six-view switcher** (localStorage-persisted). The six views ARE the brief's "six tabs":

| View id | Component | Role | Consumes |
|---|---|---|---|
| `waterfall` | `EUIWaterfall.jsx` | marginal per-intervention contribution, compounded | `stackResult.interventions[].marginal_delta` |
| `isolated` | `visualiser/IsolatedView.jsx` | standalone impact vs bare baseline | `useIsolatedResults` (singleton stacks) |
| `beforeafter` | `visualiser/BeforeAfterBars.jsx` | baseline vs final cumulative bars | `stackResult.baseline` + last enabled result |
| `physics` | `visualiser/PhysicsView.jsx` | **Heat Balance** (wraps `balance/HeatBalance.jsx`) | `baselineResult` + `cumulativeResult` |
| `calctrail` | `visualiser/BreakdownTable.jsx` | **Calc Trail** (Brief 60) | `baselineResult` + after-result |
| `breakdown` | `visualiser/BreakdownPanel.jsx` | per-intervention chain audit (Brief 48) | `stackResult.interventions[i]` |

Editor pops out (`InterventionEditorPopout.jsx`) over both panes.

**Rework mapping:** per-intervention (Library) keeps **Isolated** (`IsolatedView`) + **Calc Trail** (`BreakdownTable`); removes Before-after, Physics/Heat-Balance, Waterfall, Breakdown from the per-intervention view. Strategy gets Waterfall (`EUIWaterfall`) + Sankey (reuse Building) + Heat Balance (`PhysicsView`/`HeatBalance`, +compare) + CRREM placeholder.

### Data model (Brief 41 declarative patches — UNCHANGED by this brief)
Intervention object (`ProjectContext` DEFAULT_PARAMS): `{ id, label, notes, enabled, theme, capex_gbp, schema_version, patches[] }`. Patch: `{ id, op:'set'|'add'|'remove'|'replace', path, value, source:'inline'|'library', match?, notes? }` (dot/bracket path into building config). Stored as the array `params.interventions`; **order is implicit (array index)** — no explicit order field. Disabled (`enabled:false`) entries stay in the array but skip patch application.

### Engine outputs (`interventionsEngine.js`, ~925 L — UNCHANGED)
`runInterventionStack(baselineConfig, interventions, runEngine, libraryData)` → `{ baseline, interventions: [{ id, enabled, result, marginal_delta, cumulative_delta }] }`. Deltas are boundary-named (`heating_raw_demand_mwh` / `heating_post_mvhr_demand_mwh` / `per_service` / `per_fuel` / `per_envelope` — Brief 48 boundary discipline). `useIsolatedResults.js` runs **singleton** stacks per intervention for the Isolated view (Brief 71).

### ✅ ENGINE-CHANGE GATE — CLEARED (no escalation): the split is UX-only
The engine is agnostic to array length — it runs a full list, an ordered subset, or a singleton identically and returns the same delta shape. Isolated (singleton) results already exist (Brief 71); marginal+cumulative already emitted (Brief 41); disabled-skip semantics already give "selective stacking." **So the Library/Strategy split needs no engine work** — exactly the Part 2 gate. The split is: Library = `params.interventions` (unordered catalogue); Strategy = an ordered **subset of ids**; the Strategy's engine call passes `interventions` filtered+ordered by the strategy's id list to the *existing* `runInterventionStack`.

### Proposed Library/Strategy data model + migration
- Add `strategies: Strategy[]` at project level, `Strategy = { id, name, ordered_intervention_ids: string[] }`. Interventions themselves don't change structurally — they become Library entries that a Strategy may reference.
- **Migration (lossless):** any project without `strategies` gets one default `{ id, name:"Strategy 1", ordered_intervention_ids: [all current interventions' ids in current array order] }`. Engine consumes the same patches in the same order → no number drift.

### Call sites that currently assume "all interventions = the stack" (must read the Strategy's ordered subset instead)
- `InterventionsModule.jsx` L99 (reads all), ~L130 (paramsForEngine swaps all), ~L189 (field-conflict across all)
- `instantCalc.js` (~L7311) passes `building.interventions` wholesale to `runInterventionStack`
- `InterventionStackView.jsx` (`computeFieldConflicts` over all), `VisualiserHost.jsx` (selector over all), `useIsolatedResults.js` (singleton loop over all — correct for Library, stays)

These are the wiring points Part 3/5 retarget from "the full list" to "the active Strategy's ordered subset." (Line numbers approximate — verify at edit time.)

### ⚠️ Existing scaffolding to reconcile in Part 3
`ProjectContext` DEFAULT_PARAMS already declares **both** `interventions: []` (L419 — the current stack) **and** `library_interventions: []` (L428). So a "library" slot may already exist (possibly unused / from an earlier brief). Part 3 must check what `library_interventions` is wired to before adding `strategies[]` — the cleanest model may be: `library_interventions` (or the existing `interventions`) = the Library catalogue, and the new `strategies[]` holds ordered id-subsets. Decide in Part 3 to avoid a redundant third list. Verified shapes (this commit): six view ids confirmed at `VisualiserHost.jsx:62–67`; `runInterventionStack`→`{baseline, interventions[]}` at `interventionsEngine.js:25`; `instantCalc.js:23,6582` consumes `building.interventions`.

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
