# Brief 43 — Interventions UX schema reference

**Status:** Living document. Sections filled as Parts land.

**Companion brief:** [`docs/briefs/active/43_interventions_ux.md`](../briefs/active/43_interventions_ux.md). Notion design notes:
- Interventions architecture — https://www.notion.so/365d645e05cc81b79160e49029d2158c
- Brief 43 scope — https://www.notion.so/366d645e05cc818b8653d51bdf8b4342

**Predecessors:**
- [`docs/audit/41_interventions_schema.md`](41_interventions_schema.md) — Brief 41 data model + patch shape + engine ops (unchanged in Brief 43)
- [`docs/audit/42_systems_ux_schema.md`](42_systems_ux_schema.md) — Brief 42 service-level vs system-level field reorganisation on `systems_config_v40` (relevant: Brief 43 patch paths address service-level fields directly)

**Scope of this doc:** the UX-layer changes Brief 43 lands on top of the Brief 41 data model + engine. No data model changes; no engine changes.

---

## §1 — Module surface after Brief 43

The Interventions module at `/interventions` retains the same primary affordances:

- Stack of interventions, ordered, with drag-to-reorder + per-row enable toggle + edit pencil
- Comparison view (tab)
- Library save / load

Brief 43 changes:

1. **Layout** — stack lives in the main canvas (full container width); editor pop-out opens to the right of the stack via the shared `SchedulePopout` chrome with `defaultPosition="right"`. (Part 1.)
2. **Structural ops in editor** — per-service `+ Add system` / `⊗ Remove` / `⇄ Replace` affordances that capture `op: 'add'` / `'remove'` / `'replace'` patches. (Part 2.)
3. **Wider field coverage** — Brief 42 service-level fields exposed in the editor (heating/cooling setpoints, DHW demand basis + quantity + temps), per-system field coverage (enabled / efficiency / share / control / schedule), lighting + small_power control_mechanism, ventilation per-system fields, envelope ground-floor U. (Part 3.)
4. **InterventionRow summary** — patch count + short plain-English summary on each stack row so the user doesn't have to open the editor to see what an intervention does. (Part 3.)

The patch shape (`{ id, op, path, value, match, source, schema_version }`) is unchanged from Brief 41. The engine's `applyPatch` / `applyIntervention` / `runInterventionStack` / `computeDelta` are unchanged. Brief 42's `migratePatch(patch, 1, 2)` continues to handle the v1→v2 path rewrites for any persisted library_interventions.

---

## §2 — Part 1 — Layout refactor (2026-05-20)

### §2.1 Default pop-out position

The shared `SchedulePopout.jsx` gained a `defaultPosition` prop that resolves to one of:

| Value | Resolves to |
|---|---|
| `'center'` (default — backward-compatible) | Centered horizontally on the viewport, y=60 |
| `'right'` | Right-anchored: `x = window.innerWidth - POPOUT_WIDTH - 20`, y=60 |
| `{ x: number, y: number }` | Explicit position passed by the consumer |

`InterventionEditorPopout` passes `defaultPosition="right"`. On a 1440 px viewport with the 1000 px popout, the editor opens at x≈420 (right edge minus popout width minus 20 px margin), with y=60.

If the user has previously dragged the popout to a custom position, the persisted localStorage value (key: `nza-intervention-editor-popout-position` — unchanged from Brief 41 Part 4) wins. The `Reset position` link in the popout chrome restores the right-anchored default for Interventions; center for everything else.

### §2.2 Container width

`InterventionsModule.jsx` container widened from `max-w-5xl` (~64 rem) to `max-w-6xl` (~72 rem) so the stack rows have more breathing room beside the popout when both are visible. The narrower constraint from Brief 41 made the stack rows feel cramped under the original full-screen-overlay editor pattern; with the popout now beside the stack, the wider container is the right shape.

### §2.3 Unsaved-changes guard

Two paths can discard unsaved changes — both now go through a `window.confirm` prompt before discarding:

1. **Close the editor pop-out** (× button / Esc / Cancel) while local patches differ from the intervention's persisted patches → confirm before close. Handled inside `InterventionEditorPopout` via `guardedCancel`.
2. **Switch to a different intervention** by clicking another edit pencil while the pop-out is dirty → confirm before switch. Handled in `InterventionsModule.handleEdit` via `editorDirtyRef`.

The dirty state is computed by comparing the local edit state against the intervention's persisted shape (patches: op + path + value + match; identity: label + theme + notes). The pop-out emits dirty-state changes via the new `onDirtyChange(boolean)` callback so the parent can intercept switch attempts.

`Save intervention` and `Delete intervention` both reset the dirty ref to false (Save persists the local state into params.interventions; Delete removes the row entirely).

### §2.4 Non-blocking interaction

The `SchedulePopout` chrome is `position: fixed` and renders no overlay. The main canvas (stack + comparison tabs + library button) remains interactive while the popout is open: the user can reorder stack rows, toggle enable, or click another edit pencil with the popout still visible (subject to the unsaved-changes guard above).

The intervention's marginal Δ and cumulative Δ in the stack row continue to recompute as the user edits in the popout — local patches feed the popout's `interventionResult` preview, and once saved they propagate to the stack via `params.interventions` and trigger an engine re-run via the existing `useMemo` in InterventionsModule.

### §2.5 Files touched in Part 1

- `frontend/src/components/shared/SchedulePopout.jsx` — added `defaultPosition` prop with `'center'` / `'right'` / explicit object support
- `frontend/src/components/modules/interventions/InterventionEditorPopout.jsx` — passes `defaultPosition="right"`; added `computeDirty` helper, `isDirty` tracking, `onDirtyChange` callback, `guardedCancel` wrapper
- `frontend/src/components/modules/interventions/InterventionsModule.jsx` — container widened to `max-w-6xl`; `editorDirtyRef` + `handleDirtyChange`; `handleEdit` gates intervention switch
- `docs/audit/43_interventions_ux.md` (this file)
- `docs/briefs/active/43_interventions_ux.md` (new — the brief itself)
- `docs/briefs/current.md` — pointer updated

### §2.6 What Part 1 did NOT change

- The popout body two-column layout (editor + preview side-by-side inside the 1000 px popout) is unchanged. Future briefs may compress this if 1000 px proves too wide on narrower viewports.
- The popout width (1000 px) is unchanged. `SchedulePopout`'s POPOUT_WIDTH constant is still hard-coded.
- The shared popout chrome itself (drag handle, reset link, close, Esc support, position persistence) is unchanged in behaviour — only the default initial position is now parameterised.
- No patch-shape changes. No engine changes. No new editor affordances (those land in Parts 2 + 3).

---

## §3 — Part 2 — Structural ops (placeholder, filled in Part 2)

To be filled.

---

## §4 — Part 3 — Wider coverage + summary (placeholder, filled in Part 3)

To be filled.

---

## §5 — Part 4 — Walkthrough (placeholder, filled in Part 4)

To be filled.

---

## §6 — What this doc does NOT contain

- The patch shape / engine ops — see `docs/audit/41_interventions_schema.md`.
- The post-Brief-42 systems schema — see `docs/audit/42_systems_ux_schema.md`.
- The brief itself — `docs/briefs/active/43_interventions_ux.md`.
- Brief 41's UI implementation pattern decisions (curated editor vs main-app wrap) — covered in Issue #20 in `docs/audit/29_open_issues.md` and Brief 41 Part 4's STATUS.
