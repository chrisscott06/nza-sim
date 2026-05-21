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
