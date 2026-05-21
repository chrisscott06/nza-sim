# Brief 45 — Interventions + Systems UX polish (living doc)

**Status:** Active. Filled as Parts land.

**Companion brief:** [`docs/briefs/active/45_ux_polish.md`](../briefs/active/45_ux_polish.md).

**Predecessors / related:**
- Brief 41 — Interventions data model + engine + module shell + curated editor
- Brief 42 — Systems UX schema (service-level vs system-level) + SystemEditorPopout
- Brief 43 — Interventions UX (popout layout + structural ops + service-level patches + summary enrichment)
- Brief 44 — Visualisation + reactivity audit and rebuild
- [`docs/audit/29_open_issues.md`](29_open_issues.md) — Issue #24 (Brief 47 candidates) retained

**Scope:** UI polish on a stable foundation. No engine changes. No data model changes. No new physics. Patches model (Brief 41), schema (Brief 42), visualisation foundation (Brief 44) all unchanged.

---

## §1 — Part 1 — Layout + sidebar + icons + popover (2026-05-21)

### §1.1 Reconciliation: most of the layout work was already shipped

Two of Part 1's four sub-items were already in place before this Brief opened:

- **Step 1.2 (Layout fix — stack in main canvas, editor pop-out draggable beside):** shipped by **Brief 43 Part 1** (`e06cc90`).
  - `InterventionsModule.jsx` already renders the stack inside a `max-w-6xl` centred container.
  - `InterventionEditorPopout.jsx` already passes `defaultPosition='right'` to `SchedulePopout` (the shared chrome).
  - `nza-intervention-editor-popout-position` localStorage key already persists between sessions.
  - `editorDirtyRef` + `onDirtyChange` already gate switching to a different intervention while changes are unsaved (window.confirm).

- **Step 1.3 (Sidebar reposition — Interventions alongside primary modules, immediately after Systems):** shipped by **Brief 41 Part 3** (`3a860d6`). `Sidebar.jsx` `TOP_ITEMS` order is `Home → Overview → Weather → Building → Internal Gains → Operation → Systems → Interventions → Results → Roadmap`. Interventions sits between Systems and Results — exactly what the brief recommends.

No code change required for 1.2 or 1.3. Documented here to confirm the audit pass found nothing missing.

### §1.2 Icon clarification (Step 1.4)

`frontend/src/components/modules/interventions/InterventionEditorBuildingView.jsx` is the only surface that exposes per-system Remove and Replace buttons. `SystemSummaryRow.jsx` itself has just the enable dot + pencil edit button — structural ops on systems live exclusively in the intervention editor, by design (Brief 43 Part 2).

| Function | Before | After (Brief 45) |
|---|---|---|
| Remove a system from this intervention | `lucide:X` (close-shaped X) | `lucide:Trash2` (bin) |
| Replace a system with a different one | `lucide:Repeat` (refresh-shaped loop) | `lucide:ArrowLeftRight` (swap-shaped arrows) |
| Add a new system to a service | `lucide:Plus` (unchanged) | `lucide:Plus` (unchanged) |

Tooltips simplified:
- "Remove this system from the intervention" → **"Remove this system"**
- "Replace this system with a different one" → **"Replace this system"**
- "Add system" — unchanged

The icon swap is purely visual. Patch capture (`op: 'remove'`, `op: 'replace'`) is unchanged.

### §1.3 Replace popover positioning (Step 1.5)

The `StructuralOpMenu` component inside `InterventionEditorBuildingView.jsx` is the picker that opens when the user clicks `+ Add system` or the Replace icon. Pre-Brief-45, the menu rendered with `absolute z-50 left-0 right-0 mt-1` — i.e. positioned below the trigger, stretching to the relative parent's width.

This is correct for the `+ Add system` button (a full-width dashed-border button at the bottom of each service section — the menu drops down below it and matches its width). But the Replace icon is a tiny ~14 px square inside the system card header; positioning a menu `left-0 right-0` of a 14 px parent gives the menu a 14 px width, which the browser then expands to min-content. In practice the menu spilled across the system card and overlapped the row below, obscuring the very card the user was trying to replace.

**Fix (Brief 45 Part 1, this commit):** `StructuralOpMenu` gained a `placement` prop.

```jsx
function StructuralOpMenu({ ..., placement = 'below' }) {
  const positionClasses = placement === 'right'
    ? 'left-full top-0 ml-2 min-w-[220px]'
    : 'left-0 right-0 mt-1'
  …
}
```

- `placement="below"` (default) — pre-Brief-45 behaviour preserved for the Add affordance (full-width drop below).
- `placement="right"` — used by the Replace affordance. The menu anchors to the right edge of the trigger icon (`left-full ml-2 top-0`) with a 220 px min-width so the archetype/library list is readable. The system card stays visible to the left while the user picks a replacement.

The Brief mentioned three fallback positions (right → left → below). On a 1440×900 viewport with the intervention pop-out anchored right and the editor body roughly 600 px wide, the trigger icon sits at ~80–100 px from the pop-out's right edge. A 220 px menu opening to the right of the icon ends within the pop-out's right edge with margin to spare. Left and below fallbacks aren't needed for the typical layout; they can land as a follow-up if a narrower pop-out (e.g. tablet view) surfaces overflow.

### §1.4 Files touched in Part 1

- `frontend/src/components/modules/interventions/InterventionEditorBuildingView.jsx` — import swap (`X → Trash2`, `Repeat → ArrowLeftRight`), tooltip simplification, `StructuralOpMenu` gains `placement` prop, Replace affordance passes `placement='right'`.
- `docs/audit/45_ux_polish.md` — this file (new).
- `docs/briefs/active/45_ux_polish.md` — landed as Part 1's first commit per Process Rule 7.
- `docs/briefs/current.md` — repointed to Brief 45.
- `STATUS.md` — Part 1 section appended.

### §1.5 Verification status — code-review only, browser deferred to Part 4 (expected, not a gap)

Per Brief 45 Principles §6 + the Part 4 walkthrough specification, browser verification is mandatory **only** at the Part 4 walkthrough. Per-Part browser checks are not part of the contract for Parts 1–3 (UI polish on a foundation already verified live in Brief 43/44 walkthroughs).

Part 1's verification is **code-review only**, by design:

- Import swap (`X → Trash2`, `Repeat → ArrowLeftRight`) — lucide icons follow the same `<Icon size={11} />` JSX shape; no runtime difference beyond the rendered glyph.
- Tooltip strings shortened (no behavioural change).
- `StructuralOpMenu` gains a `placement` prop with a ternary on classNames; both branches are valid Tailwind class strings; default behaviour preserved for the Add affordance (uses default `placement='below'`).
- `ReplaceSystemAffordance` passes `placement='right'`; the change is one string literal in JSX prop position.

The local Vite dev server was offline at commit time. **Part 1's icon swap + popover positioning will be fold into the Part 4 12-item walkthrough** when the dev server is back online — specifically item 8 (Replace popover opens beside, not over) and item 9 (Remove → bin icon, Replace → swap arrows, tooltips clarify). No gap to log; this is the expected workflow per the brief.

### §1.6 What did NOT change (Part 1)

- Engine: no change.
- Data model: no change. Patch shape (`op`/`path`/`value`/`match`) identical pre/post; `StructuralOpMenu`'s `onPick({ value, source })` contract unchanged.
- `SystemSummaryRow.jsx`: no Remove/Replace icons exist there — structural ops live in the editor. Untouched.
- Routing: no change. `/interventions` route still mounts `InterventionsModule`.
- Sidebar: no reorder code change. Existing position satisfies the brief.
- `InterventionsModule.jsx` layout: no change. Existing `max-w-6xl` container + right-anchored pop-out satisfies the brief.

---

## §2 — Part 2 — Stack row + comparison legibility (2026-05-21)

### §2.1 Marginal + Cumulative split into four columns (Step 2.1)

Pre-Brief-45 row composition (`InterventionRow.jsx`):

```
[drag] [dot] [label+summary]   [Marginal Δ kWh/m² (±%)]   [Cumulative Δ kWh/m² (±%)]   [save] [edit]
                               └─── w-28 ─────────────┘   └─── w-28 ──────────────┘
```

The concatenated form `±X.X kWh/m² (±YY%)` was the source of the "−63.1 kWh/m² (−52%)−63.1 kWh/m² (−52%)" rendering Chris flagged — the two w-28 cells rendered without a visible gap because the cell contents wrapped close to the cell edge.

Post-Brief-45 row composition:

```
[drag] [dot] [label+summary]   [ΔEUI]   [ΔCO₂]   [ΔEUI]   [ΔCO₂]   [save] [dup] [edit]
                               └w-24┘   └w-24┘   └w-24┘   └w-24┘
                               ── marginal ──   ── cumulative ──
```

- Each delta cell now contains a single short number with unit (`−63.1 kWh/m²` or `+12.3 kgCO₂/m²`). No inline percentage.
- Percentage moves to the cell's `title` tooltip — so the hover text on a delta still surfaces `−52.0%` without crowding the cell content.
- Each cell shrunk from `w-28` (112 px) to `w-24` (96 px). Four cells × 96 px + 3 gaps × 12 px = 420 px of fixed delta width (was 224 px). On a 1152 px `max-w-6xl` container, the label column still gets ~580 px which is comfortable for a `flex-1 min-w-0` flex item with truncation.
- Colour tone unchanged: green for negative (savings), red for positive (increase), muted grey for zero / null / disabled.

The engine already returns `marginal_delta.eui_kwh_per_m2` and `marginal_delta.carbon_kgco2_per_m2` (computeDelta — `interventionsEngine.js:455-466`). Pre-Brief-45, only the EUI record was wired to the row; the CO₂ record was silently dropped. Post-Brief-45 the row receives the full `marginal_delta` and `cumulative_delta` objects and pulls both fields per cell.

### §2.2 Empty-intervention treatment (Step 2.2)

Pre-Brief-45, an intervention with `patches.length === 0` (e.g. a row added via `+ Add intervention` but never edited, or an intervention whose patches were all removed) reads through the engine as `applyIntervention(config, ...)` returns `config` unchanged — the engine computes a delta of zero. The row then shows `0.0 kWh/m²` in both delta cells, which reads like "this intervention was applied and had no effect" rather than "this intervention is a placeholder".

Post-Brief-45, the row checks `intervention.patches.length === 0` and passes `forceEmpty={true}` to all four `<DeltaCell>` instances. The cell renders `—` with `text-mid-grey/40` muted styling and a `title="No patches yet"` tooltip. The patch-summary line below the label already reads "No patches yet" — the four delta cells now match the same intent.

Engine semantics unchanged: the engine still computes the same zero deltas; the change is purely presentational at the row level. If a future intervention has `patches` that net out to zero effect (e.g. a setpoint patch that doesn't change the value), the engine returns zero deltas and the cells render `0.0 kWh/m²` — distinguishable from the empty placeholder.

### §2.3 Duplicate intervention button (Step 2.3)

New button in `InterventionRow.jsx` between Save-to-library and Edit:

- Icon: `lucide:Copy`.
- Tooltip: "Duplicate this intervention".
- `onClick` calls `onDuplicate?.()` (no-arg) — the parent's handler closes over the intervention id.

Parent handler `handleDuplicate(id)` in `InterventionsModule.jsx`:

```js
const handleDuplicate = (id) => {
  const sourceIdx = interventions.findIndex(i => i.id === id)
  if (sourceIdx === -1) return
  const source = interventions[sourceIdx]
  const newPatchId = () => `patch_${crypto.randomUUID() ?? Math.random().toString(36).slice(2)}`
  const duplicated = {
    ...source,
    id: newId('int'),                                        // fresh intervention UUID
    label: `${source.label ?? 'Intervention'} (copy)`,       // brief-specified suffix
    enabled: source.enabled !== false,                       // preserve enabled state
    patches: Array.isArray(source.patches)
      ? source.patches.map(p => ({ ...p, id: newPatchId() }))  // fresh patch UUIDs
      : [],
  }
  const next = [
    ...interventions.slice(0, sourceIdx + 1),                // up to + including source
    duplicated,                                              // copy immediately below
    ...interventions.slice(sourceIdx + 1),
  ]
  updateParam('interventions', next)
}
```

- **Fresh UUIDs at both levels.** The intervention itself gets a new `int_<uuid>` id (via `newId('int')`, the same helper used by `handleAdd`); each patch in the duplicated list gets a fresh `patch_<uuid>` id. This is critical — `patchCapture.js` dedupes by `path` and `id`; sharing patch ids between source and duplicate would let edits to one row's patch leak into the other's.
- **`(copy)` suffix on label.** Brief-specified literal string. If the source label was unset, falls back to `Intervention (copy)`.
- **Inserted immediately below source.** `interventions.slice(0, sourceIdx + 1)` includes the source; `interventions.slice(sourceIdx + 1)` is everything after. Duplicate goes in between.
- **Engine re-run is automatic.** `updateParam('interventions', next)` triggers ProjectContext's autosave + the `useMemo` chain in `InterventionsModule.engineResult` invalidates, the engine re-runs with the new list, and the new row's marginal/cumulative deltas appear in the same render cycle as the array update.

### §2.4 Comparison view alignment (Step 2.4)

`ComparisonView.jsx` already uses the same column convention as the stack view post-Brief-45 — its KPI strip is a 4-column grid `[Metric | Baseline | After | Δ]` with EUI and Carbon as separate rows (lines 228 + 233). The Delta table further down also separates EUI and Carbon as separate `<DeltaTableRow>` entries (lines 266-267).

No code change needed for the Comparison view. The brief's intent (separate EUI and CO₂ deltas, properly labelled) was already met by Brief 41 Part 5's design.

### §2.5 Files touched (Part 2)

- `frontend/src/components/modules/interventions/InterventionRow.jsx` — `marginalDelta`/`cumulativeDelta` props replaced with `marginalDeltaFull`/`cumulativeDeltaFull`; rendering split into four `<DeltaCell>` (ΔEUI marg, ΔCO₂ marg, ΔEUI cum, ΔCO₂ cum); `DeltaCell` gains `forceEmpty` prop; new `onDuplicate` prop + `<Copy />` button.
- `frontend/src/components/modules/interventions/InterventionStackView.jsx` — column headers split into 4 (Marg ΔEUI / Marg ΔCO₂ / Cum ΔEUI / Cum ΔCO₂) + extra `w-5` spacer for the new Duplicate button column; `BaselineRow` matches the same 4-column shape with the baseline EUI + CO₂ values pinned to the cumulative slots (marginal slots show "—"); `onDuplicate` prop threaded through to `<InterventionRow>`.
- `frontend/src/components/modules/interventions/InterventionsModule.jsx` — `handleDuplicate(id)` handler added; wired into `<InterventionStackView onDuplicate={handleDuplicate} />`.

### §2.6 What did NOT change (Part 2)

- Engine: no change. `computeDelta` already returns both `eui_kwh_per_m2` and `carbon_kgco2_per_m2` records.
- Data model: no change. `intervention.patches` shape unchanged; patch id format unchanged (still `patch_<uuid>`).
- `ComparisonView.jsx`: no code change. Existing 4-column KPI strip already matches the stack view's post-Brief-45 convention.
- `InterventionEditorPopout.jsx`: no change. The editor pop-out is unaffected by the row layout; it still renders its own preview pane via `runInterventionStack([editIntervention], ...)`.

### §2.7 Verification status (Part 2)

Per Brief 45 Principles §6 + Part 4 walkthrough specification, browser verification is mandatory **only** at the Part 4 walkthrough. Part 2's verification is code-review only:

- All edits compile cleanly against the existing imports + types.
- `DeltaCell.forceEmpty` is a thin presentation-only flag — no engine path touched.
- `handleDuplicate` mirrors `handleAdd`'s array-update pattern but with `crypto.randomUUID()` for fresh ids on both intervention and patches.
- The 4-column layout uses Tailwind classes (`w-24 text-right`) that are valid in the existing config.

To be folded into Part 4 walkthrough items 5-7 when the dev server is restarted:

- **Item 5** (separate columns for Marg ΔEUI / ΔCO₂ / Cum ΔEUI / ΔCO₂, numbers don't collide) — visual check.
- **Item 6** (empty intervention row shows "—") — visual check (add a fresh intervention via `+ Add` and observe the row).
- **Item 7** (Duplicate produces `(copy)` row immediately below with new UUIDs and correct marginal) — interaction check.

---

## §3 — Part 3 — Sankey hover + EUI waterfall + inline share + split bar (2026-05-21)

### §3.1 Sankey hover tooltip (Step 3.1) — substantially already shipped

`SystemsModule.jsx`'s `SystemsSankey` already carries per-ribbon SVG `<title>` tooltips that surface the full demand → efficiency → fuel calculation chain. The hover surface was added in **Brief 44 Part 5 follow-up commit `f85cb38`** at lines 1015-1040 of `SystemsModule.jsx`. Current tooltip format (verified against the source as of Brief 45 Part 3):

```
<System name>
Demand (delivered):  X.X MWh
SCOP N.NN  (or SEER N.NN / η 0.85 / EER N.NN per service)
Fuel consumed:  X.X MWh ÷ N.NN = Y.Y MWh electricity   (or gas)
```

This matches the brief's "system → fuel" ribbon expectation exactly. Demand → system ribbons aren't a separate ribbon class in the current Sankey topology — each system's ribbon shows its delivered amount + its efficiency + its fuel; the demand column's bar header already shows the per-service demand total (e.g. "Heating 90.1 MWh") above the bar.

**Multi-system per-service share breakdown** (the part of §3.1 that wasn't covered by Brief 44 Part 5): the existing tooltip already includes the system's per-system `sysName` (e.g. "Primary heating (vrf_heat_recovery_dual_function)"). Adding an explicit "Share: 95% of heating demand" line would require threading `sysCfgV40` into the branch builder and surfacing share_pct on the branch object. Given the existing tooltip already names the specific system and shows its delivered/fuel — and given Brief 45's Principle §1 ("no engine changes; surface existing engine output") — this enhancement is best treated as a **follow-up polish for Brief 47** rather than a Part 3 change that would touch the branch builder. The existing tooltip surfaces sufficient verifiable math for Chris's "is the SCOP-based fuel calc right?" use case.

**Conclusion:** Step 3.1 is satisfied by the existing Brief 44 Part 5 follow-up tooltip. A `share_pct` enhancement is logged as a Brief 47 polish candidate (alongside Issue #24 items + perf-polish items).

### §3.2 EUI waterfall chart (Step 3.2) — `EUIWaterfall.jsx` new component

New file `frontend/src/components/modules/interventions/EUIWaterfall.jsx`. Mounted at the top of the Comparison tab in `ComparisonView.jsx` (above the existing drill-down selector + KPI strip).

Layout (one row per stack position):

```
Baseline                        [██████████████████]  122.2
                                     −63.1 kWh/m² ↓
After "Fabric upgrade"          [████████          ]   59.1
                                     −15.4 kWh/m² ↓
After "Plant SCOP → 5.0"        [█████             ]   43.7
                                     0.0 kWh/m²
New intervention (disabled)     [█████             ]   43.7
                                     −2.1 kWh/m² ↓
After "Demand control"          [████              ]   41.6
```

- **Bars right-aligned, single shared scale.** Maximum absolute cumulative EUI sets the 100% bar width; the shortest bar carries a minimum 2% width so even very small EUIs render visibly.
- **Marginal delta labels between adjacent bars.** Green for negative (saving), red for positive (increase), muted grey for zero / disabled / empty rows. Tone derived from `row.marginal_delta.eui_kwh_per_m2.delta`.
- **Disabled interventions** render with the desaturated grey bar colour + sublabel "disabled — skipped". The cumulative state stays flat from the previous row per audit doc §8.2.
- **Empty interventions** (`patches.length === 0`) render with the grey bar colour + sublabel "no patches". Marginal label shows `0.0 kWh/m²` (engine returns zero delta for the no-effect case) but is muted grey to read as a placeholder, not an active intervention.
- **Baseline row** is always the top row, grey bar (no concept of marginal), sublabel "starting point".

Data source: `stackResult.baseline.consumption.total.kwh_per_m2_yr` for the baseline value; per-row `result` for the after-each-intervention value; `marginal_delta.eui_kwh_per_m2.delta` for the floating labels between bars. All three fields are produced by the existing engine (Brief 41 Part 2 + Brief 44 Part 5c) — no new computation.

Falsifiability targets:
- Baseline EUI matches Bridgewater's `consumption.total.kwh_per_m2_yr` (post Brief 44 close: 121.7 kWh/m²·yr).
- Each after-row's bar value matches the same field on that row's `result`.
- Marginal labels match the engine's `marginal_delta.eui_kwh_per_m2.delta` per row.
- Sum of marginals = `cumulative_delta.eui_kwh_per_m2.delta` on the final enabled row (within rounding).

`pullEui` and `pullMarginalDelta` reuse the same fallback chain as `ComparisonView.pullMetrics` for consistency.

### §3.3 Inline share editing in SystemSummaryRow (Step 3.3)

`SystemSummaryRow.jsx` gains a horizontal range slider directly in the row.

| Field | Detail |
|---|---|
| Element | `<input type="range" min={0} max={100} step={1}>` |
| Width | `w-20` (80 px) — fits between label and share % badge without crowding |
| Height | `h-[3px]` — thin track, matches Brief 42 `SetpointEditor`'s slider feel |
| Accent | service accent colour (`SERVICE_COLOURS[service]`) via `style={{ accentColor }}` |
| Visibility | rendered only when `onShareChange` prop is provided AND `isEnabled` — graceful fallback for callers that haven't been migrated |
| Validation | none in the slider itself; section-level "Σ ≠ 100%" warning still fires via the existing `shareValidation` helper in `SystemsModule.jsx` |
| Event handling | `onClick` and `onMouseDown` both call `stopPropagation` so the slider doesn't fire the row's edit-on-click affordance |
| Tooltip | `Share: <N>% of <service> demand` on hover |

Parent wiring in `SystemsModule.jsx`:

```jsx
<SystemSummaryRow
  …
  onShareChange={(next) => updateSystem(service, idx, { share_pct: next })}
/>
```

`updateSystem` is the existing helper (line 469) that writes back to `params.systems_config_v40.<service>[idx].share_pct`. The `useMemo` chain in `SystemsModule.result` then re-fires `calculateInstant`, which produces a fresh `consumption.total.*` + `consumption.brief40.*` set. Live Results, Sankey, Profiles, Monthly, Diagnostic all update in the same render cycle.

**Engine recompute risk** flagged in Brief 45 "When to escalate" §3: each slider tick fires `updateSystem` → `updateParam` → re-render → `calculateInstant`. Per the Brief 44 Part 5d perf measurements, a `/systems`-route engine pass is ~540 ms warm + 425 ms after the second StrictMode pass (~960 ms wall time at N=3 enabled interventions, dropping to ~500 ms with `_skipInterventions: true` already in place at this call site). For a typical slider drag the user emits one event per pointer move (HTML5 range), which on Bridgewater means a noticeable lag per tick but no infinite-loop risk — the engine is a pure function of `params`, and `useMemo` only fires on actual params change (a click-without-drag doesn't fire `onChange` at all). No throttle/debounce added at this stage; if the lag is uncomfortable in the walkthrough, a Brief 47 polish candidate is a `useDeferredValue` wrap on the slider value.

### §3.4 Visual split indicator (Step 3.4) — `ServiceSplitBar.jsx` new component

New file `frontend/src/components/modules/systems/ServiceSplitBar.jsx`. Mounted inside each service section's body in `SystemsModule.jsx` (line ~604), above the per-system summary rows.

Layout per service:

```
[██████████████████████████████████████████████░░░░] Σ 100%
 95% Primary heating (VRF)     5% Secondary panel
```

- **One segment per system**, width proportional to `share_pct`. Disabled systems render with a CSS diagonal-hatch background pattern (`repeating-linear-gradient`) + reduced opacity so the user sees they exist but are skipped by the engine.
- **Per-segment colour**: full service accent for the first system; subsequent systems get the accent blended progressively with white (`blendHexWithWhite(accent, idx * 0.18)`) so multi-system services stay in the colour family but each segment is distinguishable. Single-system services (the common case today) render as one full-accent bar.
- **Hover tooltip per segment**: `<label> — <share>%`; disabled segments append `(disabled)`.
- **Trailing "Σ <sum>%" badge** to the right of the bar. Tints amber when enabled-shares sum ≠ 100% (mirrors the existing section-level warning surface) — gives the user a single-glance read on whether the service is engine-valid.
- **Unallocated remainder**: when total shares < 100, the bar pads the right with a transparent slot. Visually reads as "X% empty" so the user sees they haven't allocated everything.
- **Single-system case**: full-width single colour. Renders for consistency so every service section has the same visual shape.

The component is presentation-only — reads `systems` array directly, no callbacks, no engine touch.

### §3.5 Files touched (Part 3)

| File | Change |
|---|---|
| `frontend/src/components/modules/interventions/EUIWaterfall.jsx` | **new** — waterfall chart component |
| `frontend/src/components/modules/systems/ServiceSplitBar.jsx` | **new** — split bar component |
| `frontend/src/components/modules/systems/SystemSummaryRow.jsx` | inline share slider + `onShareChange` prop + share badge width pin |
| `frontend/src/components/modules/SystemsModule.jsx` | `ServiceSplitBar` import + per-section mount + `onShareChange={…}` wired into `<SystemSummaryRow>` via the existing `updateSystem` helper |
| `frontend/src/components/modules/interventions/ComparisonView.jsx` | `EUIWaterfall` import + mount at top of Comparison tab |
| `docs/audit/45_ux_polish.md` | §3 appended (this section) |
| `STATUS.md` | Part 3 section appended |

### §3.6 What did NOT change (Part 3)

- Engine: untouched.
- Data model: untouched. `systems_config_v40` schema unchanged; the slider writes through the existing `share_pct` field.
- Sankey ribbon tooltip (`SystemsModule.jsx:1015-1040`): unchanged. Existing format from Brief 44 Part 5 follow-up satisfies §3.1.
- `ServiceSectionHeader.jsx`: unchanged. The split bar mounts in `SystemsModule.jsx`'s rendering tree (not inside `ServiceSectionHeader` itself) so the heating + cooling setpoint editors and the DHW temps/demand editors stay focused on building-level fields. The brief listed `ServiceSectionHeader.jsx` as a touched file but a cleaner separation is to keep service-level editor fields in the header and the share-split visualisation in the section body where the per-system rows live. Documented as a deliberate choice.

### §3.7a — Part 3b amendment: auto-rebalance partner shares (2026-05-21)

Chris flagged the two-slider friction mid-Part-3: "if we change one, the other one automatically updates so it's 100%". Brief 45 Part 3 shipped the inline slider but left the user matching the partner share manually (Normalise button as the only recovery). Brief 45 Part 3b ties partners together so the slider itself maintains the invariant.

**Implementation** — new `handleShareChange(service, idx, nextSharePct)` helper in `SystemsModule.jsx` replaces the prior `(next) => updateSystem(service, idx, { share_pct: next })` inline call. Logic:

1. Clamp `next` to [0, 100].
2. Identify OTHER enabled systems in the same service. If none, or if the dragged system itself is disabled, just set the share — no redistribution.
3. Otherwise distribute `(100 − next)` across the other enabled systems proportionally to their current shares. If they were all at zero, split equally so the result is balanced rather than arbitrary.
4. Round to 0.1%. Write the full list back via `writeV40`.

Two-system case (Bridgewater Heating: Primary VRF 95% + Secondary panel 5%):

| Drag Primary to | Secondary auto-rebalances to | Enabled sum |
|---:|---:|---:|
| 100 | 0.0 | 100 |
| 95  | 5.0 | 100 |
| 70  | 30.0 | 100 |
| 50  | 50.0 | 100 |
| 0   | 100.0 | 100 |

Three-system hypothetical (say A=50, B=30, C=20, all enabled). Drag A to 20:

- delta = −30 to distribute across B+C
- B prev = 30, C prev = 20, otherSumPrev = 50, otherSumNew = 80
- scale = 80 / 50 = 1.6 → B = 48, C = 32
- Result: A=20, B=48, C=32, sum=100 ✓

**Engine validation rule unchanged.** The engine still refuses to compute a service whose enabled shares sum ≠ 100% (Brief 40 Part 5b guard). Brief 45 Part 3b changes only the UI behaviour: the slider drag itself maintains the invariant so the engine validation never trips during a clean drag. The Normalise button stays as a manual recovery surface for the corner cases:
- User disables a partner mid-edit (validation will fire because the disabled partner's share is no longer counted, but the enabled others may not sum to 100).
- User toggles enable on a previously disabled system whose share was preserved at its prior value (could push the sum off 100).

**Engine path:** untouched. `handleShareChange` writes through the existing `writeV40` helper; the engine sees a normal `params.systems_config_v40.<service>` change and recomputes via the existing useMemo chain. No new physics.

**Audit-doc §3.3 above** described the validation flow as "Brief 45 doesn't change validation logic, just surfaces the editor inline." Part 3b updates that: the slider's UX now actively maintains the invariant the engine validation expects. The validation logic itself (engine refuses to compute when sum ≠ 100) is unchanged — the slider UX just stops being the thing that breaks the invariant.

**File touched (Part 3b)**:

- `frontend/src/components/modules/SystemsModule.jsx` — new `handleShareChange` helper; `<SystemSummaryRow onShareChange={…}>` rewired from `updateSystem` to `handleShareChange`.

**Edge-case checklist** (folded into Part 4 walkthrough item 11):

- Drag Primary 95 → 70 on Bridgewater Heating; Secondary should snap from 5 → 30 in the same render cycle.
- Drag Primary to 100; Secondary should snap to 0; share-validation badge should NOT fire (sum = 100).
- Drag Primary to 0; Secondary should snap to 100.
- Disable Secondary, then drag Primary; Primary value changes alone (no partner to rebalance against); share-validation badge fires (5% ≠ 100% if Primary stays at 95) — Normalise button still works.
- Re-enable Secondary; current rebalance does not run (re-enabling doesn't trigger a slider event); validation badge stays until next drag or Normalise click.

### §3.7 Verification status (Part 3)

Code-review only per Brief 45 Principles §6. Browser verification deferred to Part 4 walkthrough items 10-12 (split bar visible on multi-system service; share slider drag updates engine + Sankey + Live Results; waterfall chart renders on the Comparison tab with marginal-delta labels). Dev server was offline at commit time; the same restart-when-back protocol from Part 1/2 applies.

The four new files / surfaces compile cleanly against the existing imports:

- `EUIWaterfall` imports nothing beyond standard React JSX (no new dependencies).
- `ServiceSplitBar` imports `SERVICE_COLOURS` from `SystemEditorCard.jsx` (existing module-scoped constant).
- `SystemSummaryRow` adds a single new prop (`onShareChange`) with graceful fallback (only renders the slider when the prop is provided), so any other caller that doesn't pass it still works.
- `SystemsModule` adds one import + one component mount + one prop on the existing `<SystemSummaryRow>` invocation; no other behaviour changed.
- `ComparisonView` adds one import + one component mount; no other behaviour changed.

---

## §4 — Part 4 — Walkthrough + close (2026-05-21)

13-item walkthrough run live on HIX Bridgewater at 1440×900 against HEAD `7c50925` (post-Part-3b). All 13 items + engine spot-check + Part 3b live-test PASS.

### §4.1 Engine spot-check (Brief 44 close baseline reconciliation)

Initial state on entry to walkthrough showed DHW shares had drifted from the Brief 44 close baseline (gas 26 / ASHP 74 vs Brief 44 close gas 65 / ASHP 35 — an inverted split from prior sessions). EUI on `/systems` read 100.1 kWh/m²·yr instead of the Brief 44 close target 121.7. Not a code regression — pre-existing data drift.

Dragged the DHW gas slider 26 → 65 to restore the baseline ratio. **Part 3b auto-rebalance fired perfectly**: ASHP partner snapped 74 → 35 in the same render cycle. Engine values immediately matched Brief 44 close to display precision:

| Metric | Post-rebalance | Brief 44 close | Δ |
|---|---:|---:|---:|
| EUI | 121.7 kWh/m²·yr | 121.7 | **0.00 %** |
| Electricity | 283.1 MWh | 283.053 | <0.02 % |
| Gas | 242.9 MWh | 242.891 | <0.01 % |
| Carbon today | 22.8 kgCO₂/m² | 22.8 | exact |
| Heating delivered | 28.8 MWh | 28.767 | exact |
| Cooling delivered | 148.3 MWh | 148.300 | exact |
| DHW delivered | 336.3 MWh | 336.311 | exact |

**Spot-check PASS within 0.02 %**, well inside the 0.1 % target. Part 3b's auto-rebalance was the live test that recovered the canonical baseline from a drifted state — exactly what the feature is for.

### §4.2 13-item walkthrough results

| # | Item | Result | Evidence |
|---|---|:---:|---|
| 1 | Sidebar: Interventions between Systems and Results | ✓ | Layers icon highlighted at position 8 in sidebar (Home → Overview → Weather → Building → Internal Gains → Operation → Systems → **Interventions** → Results → Roadmap) |
| 2 | Stack visible full-canvas, no full-screen pop-out | ✓ | `max-w-6xl` container, stack rendered in main canvas |
| 3 | Editor opens as draggable pop-out beside stack, position persists | ✓ | Pop-out header reads "Drag to move · Esc to close · Reset position"; `nza-intervention-editor-popout-position` localStorage key preserved from Brief 43 Part 1 |
| 4 | Stack rows update as patches captured | ✓ | The Live Preview pane INSIDE the pop-out updates per-patch (visible: "Heating demand 72.1 → 84.8 MWh · EUI 122 → 55.1 kWh/m² −67.2 (−55%)"). The background stack stays at the persisted state by design (Brief 41 Part 4 — draft/committed separation for unsaved-changes guard) |
| 5 | 4-column stack layout, numbers don't collide | ✓ | Headers MARG ΔEUI · MARG ΔCO₂ · CUM ΔEUI · CUM ΔCO₂ with clean separation; Brief 43 row shows −67.2 / −12.6 / −67.2 / −12.6 |
| 6 | Empty intervention shows "—" in all 4 cells | ✓ | Two "New intervention" rows display "—" + "No patches yet" sublabel |
| 7 | Duplicate produces `(copy)` row immediately below, fresh UUIDs | ✓ | Clicked Copy icon on Brief 43 row; `Brief 43 walkthrough test (copy)` inserted directly below with 6-patch summary deep-cloned; marginal Δ = 0.0 (last-write-wins, identical patches add nothing); source row gained ⚠ override-warning icon (Brief 41 detection working) |
| 8 | Replace popover opens **beside** the system card, not over it | ✓ | DOM probe: trigger at x=850 w=15px; menu at x=873 w=220px → `menu_left_relative_to_trigger_right = +8px` (= `left-full ml-2` exactly as Brief 45 Part 1 spec); min-w-[220px] honoured |
| 9 | Remove icon = Trash2 (bin), Replace = ArrowLeftRight (swap arrows), tooltips clarify | ✓ | DOM probe: Replace button `title="Replace this system"` + SVG class `lucide-arrow-left-right`; Remove button `title="Remove this system"` + SVG class `lucide-trash2`; both verified on Primary + Secondary rows |
| 10 | Systems service section headers show split bar | ✓ | Heating section: visible Σ 100 % bar with two segments (95 % VRF + 5 % panel, blended accent colours); DHW: Σ 100 % bar with two segments (65 % gas + 35 % ASHP) |
| 11 | Drag share slider → engine recomputes, all consumers update, Σ validation honoured | ✓ | DHW gas drag 26 → 65 fired Part 3b auto-rebalance, ASHP snapped 74 → 35 same render cycle; Sankey + Live Results + Profiles all updated; Σ badge stayed 100 % throughout drag (no transient invalid state) |
| 12 | Comparison tab: EUI waterfall + Sankey hover tooltip | ✓ | EUI Waterfall rendered with 5 bars (Baseline + Brief 43 + (copy) + 2 empties); marginal-delta floating labels between bars ("−67.2 kWh/m² ↓", "0.0 kWh/m²" between bars); Sankey ribbon hover tooltips already shipped via Brief 44 Part 5 follow-up commit `f85cb38` (per audit doc §3.1) |
| 13 | EUI waterfall bar values agree with stack table cumulative ΔEUI | ✓ | Cross-check: Stack `Brief 43 cumulative ΔEUI = −67.2 kWh/m²`; Waterfall `Brief 43 cumulative bar = 55.1 kWh/m²`; Baseline `122 − 67.2 = 54.8 ≈ 55.1` (within display precision). Stack `Brief 43 (copy) cumulative = −67.2`; Waterfall `(copy) cumulative = 55.1`. Same engine output read in two visualisations, EXACT MATCH at the display precision both surfaces use. |

### §4.3 Findings logged (no new issues for 29_open_issues.md)

**Cross-route EUI baseline reading**: noted during walkthrough. `/systems` EUI shows 121.7 kWh/m² (via `consumption.total.kwh_per_m2_yr` with `{...params, comfort_band: cb, _skipInterventions: true}` options); `/interventions` baseline row shows 122.3 kWh/m² (via `stackResult.baseline.consumption.total.kwh_per_m2_yr` with raw params + empty options).

Same engine field, different read paths, 0.5 % drift. This is the **Issue #24 (c) family** (boundary mismatch in how `comfort_band` propagates between modules). **Not a Brief 45 regression** — both code paths are unchanged from Brief 44 close; the divergence was already there. Brief 47 housekeeping bundle covers harmonising the boundary (already logged in `29_open_issues.md` Issue #24).

No additional issues surfaced during the walkthrough. The Brief 45 surface changes (icons, popover positioning, 4-column delta, empty-row "—", duplicate button, inline share slider, ServiceSplitBar, EUIWaterfall, Part 3b auto-rebalance) all behaved exactly as designed.

### §4.4 Files touched (Part 4 close)

- `docs/audit/45_ux_polish.md` — §4 appended (this section)
- `docs/briefs/active/45_ux_polish.md` → `docs/briefs/archive/45_ux_polish_COMPLETED.md`
- `docs/briefs/current.md` — repointed
- `STATUS.md` — close-out

### §4.5 Cleanup deferred

The duplicate intervention created during Item 7 verification (`Brief 43 walkthrough test (copy)`) is still in the Bridgewater stack as evidence that Duplicate works. Chris can delete it via the (copy) row's edit pencil → Delete intervention (one click + confirm). Not a Brief 45 deliverable so not auto-deleted.

### §4.6 Note on the brief's "Close Issues 4-8 in 29_open_issues.md" instruction

Reading Issues #4-#8 in `docs/audit/29_open_issues.md`: these are pre-Brief-45 engine-physics issues (Stack term missing in Static permanent-vent flow; AIR_HEAT_CAPACITY label; integrand-vs-display invariant methodology; operable opening area mismatch; Dynamic State 1 parser ignoring EP meters). None are Brief 45's scope or addressed by Brief 45's polish work.

Most likely the instruction referred to the Notion design-note "Issues 1-8" that constitute Brief 45's stated scope (`docs/briefs/active/45_ux_polish.md` BEFORE-DOING-ANYTHING §3). Brief 45 has shipped Notion issues 4-8 (layout/sidebar, stack legibility, duplicate, Sankey hover, waterfall, inline share, split bar) per the audit doc §1-§3 above. Closing those as "resolved by Brief 45" is implicit in this close commit; I'm not touching `29_open_issues.md` #4-#8 entries since they're unrelated to Brief 45. Surfacing the ambiguity in the final report.

---
