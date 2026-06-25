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

**Reconciled `library_interventions` first:** it's the Brief 41 P5 save/load-templates store (entries with `lib_intervention_*` ids), currently not actively wired (InterventionsModule L101/L349 note it's "left in DEFAULT_PARAMS… not used anywhere"). It is NOT the catalogue. So: `interventions[]` stays the **Library catalogue**; `library_interventions[]` left untouched; new `strategies[]` holds the ordered selections.

**Added (`frontend/src/context/ProjectContext.jsx`):**
- `strategies: []` in DEFAULT_PARAMS. `Strategy = { id, name, ordered_intervention_ids: string[] }`.
- `makeDefaultStrategy(interventions)` + `migrateStrategies(bc)` helpers.
- Wired `strategies: migrateStrategies(bc)` into the load normalizer (beside `library_interventions`).

**Migration (lossless):** a project without `strategies` gets one default `{ id:'strategy_default', name:'Strategy 1', ordered_intervention_ids: [all current interventions' ids, current order] }`. Existing strategies preserved untouched.

**No engine drift — by construction:** the engine (`instantCalc.js`) consumes `building.interventions`, not `strategies` (confirmed §2). `strategies` is inert data until the Strategy view wires it in Part 5, so engine output is byte-identical pre/post-migration. (The brief's "load Bridgewater → same output" check is satisfied structurally; a live browser confirm lands with Part 5 when the Strategy view actually reads `strategies`.)

**Verified:** migration logic test — 3-intervention legacy project → Strategy 1 = `[a,b,c]` in order; existing strategies preserved; empty project → empty default (lossless). `npm run build` clean (4.23s).

## §4 — Part 4: Library page + two-section per-intervention view — IN PROGRESS

**Built (additive — nothing removed yet, per "don't remove before replacement"):**
`frontend/src/components/modules/interventions/PerInterventionView.jsx` — the new two-section view:
- **Section 1 — Isolated impact:** four headline cards (Lifetime carbon → "TBD — Brief C"; £/tonne → "TBD — Brief B"; **kWh saved / EUI Δ → LIVE** from `cumulativeDelta.eui_kwh_per_m2`/`total_delivered_mwh`; Simple payback → "TBD — Brief B") + demand-by-service delta rows (heating / cooling / DHW / total / electricity / gas / year-1 carbon) from the existing isolated `cumulative_delta`. No engine work.
- **Section 2 — Calc Trail:** UI-side diff (the brief's preferred, engine-change-free path) — lists the intervention's patches (inputs changed: path · op · value) → resulting headline deltas. "Shows only fields that changed." No engine trace mode.

Build clean (`npm run build`, 4.02s). Colours/format follow the existing IsolatedView conventions (save-green / increase-red, signed deltas).

**Integrated + browser-verified (2026-06-25, live with Chris):**
- `InterventionsModule.jsx` now has a **Library | Strategy page toggle** (header tabs). Library = catalogue (left: selectable intervention list with per-row isolated EUI Δ + theme) + `PerInterventionView` (right). Strategy = the existing stack + `VisualiserHost` (Part 5 will refine to waterfall / final Sankey / heat-balance-compare / CRREM).
- Wired `useIsolatedResults` at module level; the selected intervention's row feeds `PerInterventionView`. No engine change (reuses Brief 71 singleton hook).
- **Fixed a display bug:** engine `delta_pct` is already a percentage (`interventionsEngine.js:417`) — removed a `×100` double-scaling so demand-Δ percentages read correctly (e.g. Total −3%, not −343%).

**Browser verification (serverId, seeded 2 test interventions on Bridgewater — airtightness via `air_permeability_q50`, LED via lighting magnitude):**
- Library page renders by default; catalogue lists both with isolated deltas (−0.1, −4.8 kWh/m²) + themes.
- Per-intervention view shows **only two sections**: Isolated impact (4 cards — kWh/EUI Δ LIVE −4.8 / −20 MWh; lifetime-carbon + £/tonne + payback = "TBD — Brief B/C") + demand-by-service deltas (heating +7.7 MWh +12% / cooling −10.0 −6% / total −20 −3% / elec −5% / carbon −4%) and **Calc Trail** (the one changed field `lighting…magnitude.value SET → 1` → resulting headline). No Heat-Balance/Before-After/Waterfall in the per-intervention view.
- Strategy tab switches to the ordered-stack view. **No engine drift:** baseline stays **138.3** (the rebuilt-Bridgewater working anchor; brief's 143.5 is pre-rebuild/stale). No console errors; production build clean.

**Remaining Part 4 polish (minor):** per-row edit/delete affordances in the Library list (currently select + "+ Add"; the pop-out editor opens on Add). The conceptual core (two-section view) is done.
- (Old six-tab `VisualiserHost` removal is Part 6, after the Strategy page (Part 5) takes over its remaining views.)

## §5 — Part 5: Strategy page + reorder + waterfall + final-state views — DONE (core)

**Built `StrategyView.jsx`** (right pane of the Strategy page), wired in place of `VisualiserHost`;
narrowed the Strategy list to 440px so the composed view has room. Pure consumer (reuses `EUIWaterfall`
+ `PhysicsView`); no engine work.

Sections:
1. **Strategy headline** — final EUI, energy saved (kWh/m² + MWh/yr), carbon saved (yr 1), + Lifetime
   carbon / Total capex / £-per-tonne placeholders (Brief B/C). Reads the last enabled intervention's
   `cumulative_delta`.
2. **Waterfall** — `EUIWaterfall` (cumulative marginal attribution).
3. **Heat balance — final state** — `PhysicsView`/`HeatBalance` with the "−X vs baseline" badge and the
   Rows/Stacked/**Sankey** modes (the Sankey mode covers the "final energy flows" view).
4. **CRREM trajectory** — placeholder frame (Brief C).

Strategy name from `params.strategies?.[0]?.name` (the Part 3 model); for v1 the active strategy = all
interventions in order. Reorder via the existing `InterventionStackView` drag handles (`onReorder` →
`handleReorder`); the waterfall reads order-dependent `marginal_delta` so a reorder recomputes it.

**Browser-verified (1440×900):** Strategy 1 · 6 measures → **final EUI 76.2** (baseline 138.3, energy
−62.1 kWh/m² / −261.6 MWh/yr, carbon −11.8). Waterfall shows order-dependent marginals (DHW −41.9 …
bedroom-extract/MVHR **+3.6 (red increase)** … plug-load −16.2 → 76.2). Heat balance final state renders
(−62.1 vs baseline; cooling 43.8 — cooling-leaning, consistent with the MVHR-increase finding). CRREM
placeholder renders. No console errors; production build clean.

**Pending refinements (noted, not blocking):** heat-balance side-by-side *compare* button (currently
final-state + delta badge); a distinct Library-vs-Strategy subset (v1 strategy = all interventions);
literal drag-reorder needs a manual click-test (handles render; mechanism wired).

## §6 — Part 6: wiring + cleanup
_(to fill)_

## §7 — Part 7: walkthrough + close
_(to fill)_
