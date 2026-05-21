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

### §1.5 What did NOT change

- Engine: no change.
- Data model: no change. Patch shape (`op`/`path`/`value`/`match`) identical pre/post; `StructuralOpMenu`'s `onPick({ value, source })` contract unchanged.
- `SystemSummaryRow.jsx`: no Remove/Replace icons exist there — structural ops live in the editor. Untouched.
- Routing: no change. `/interventions` route still mounts `InterventionsModule`.
- Sidebar: no reorder code change. Existing position satisfies the brief.
- `InterventionsModule.jsx` layout: no change. Existing `max-w-6xl` container + right-anchored pop-out satisfies the brief.

---
