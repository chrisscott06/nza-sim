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

## §3 — Part 2 — Structural ops (2026-05-20)

### §3.1 The three ops

The engine has supported `op: 'add'` / `'remove'` / `'replace'` since Brief 41 Part 2. Brief 43 Part 2 ships the UI affordances:

| Op | Path shape | Payload | Purpose |
|---|---|---|---|
| `add` | `building.systems_config_v40.<service>` (whole array) | `value: { id, label, service, source, ... }` + `source: 'inline' \| 'library'` | Add a new system into a service |
| `remove` | `building.systems_config_v40.<service>` (whole array) | `match: { id: '<system_id>' }` | Remove an existing system from a service |
| `replace` | `building.systems_config_v40.<service>` (whole array) | `match: { id: '<system_id>' }` + `value: { id: '<old_id>', ...replacement }` | Replace an existing system, preserving its slot's id + share + enabled |

Patch ordering within an intervention is preserved by the engine (`applyIntervention` iterates patches in order). If the user removes one system and then adds two, the final array is `original − removed + add1 + add2` — handled automatically.

### §3.2 UI affordances

`InterventionEditorBuildingView.jsx` per service section now renders:

- **`+ Add system`** button at the bottom of the section. Click opens a small popover (`StructuralOpMenu`) with:
  - **From library** — entries filtered to the matching service from `params.library_systems`. Clicking copies the library entry into the patch value with a freshly-generated system uuid and `source: 'library'` (the library reference is surfaced in the PatchList's plain-English rendering as `— from library`).
  - **Start blank** — archetypes from `BLANK_ARCHETYPES` (reused from Brief 40's `AddSystemButton`). Each archetype produces a `seedSystem(service, arch)` with defaults per service (gas boiler η 0.92, ASHP SCOP 3.0, MVHR SFP 1.8 + recovery 82%, etc.). Source on the patch is `'inline'`.

  Sections render for ALL six services even when the baseline has none, so the user can add the first heating/cooling/DHW/ventilation/lighting/small_power system in an intervention.

- **⊗ Remove** (X icon) on each existing system row. Confirms with `window.confirm` then captures `op: 'remove'` with `match: { id: sysId }`.

- **⇄ Replace** (Repeat icon) on each existing system row. Opens the same `StructuralOpMenu` popover. On pick, captures `op: 'replace'` with `match: { id: oldId }` and the resolved replacement merged with `{ id: oldId, share_pct: oldShare, enabled: oldEnabled }` so the slot's identity + share split + enable state survive the swap (subsequent patches in the same intervention that address `<service>[id=<old_id>].efficiency_metric` continue to resolve cleanly).

### §3.3 PatchList plain-English rendering

`patchCapture.summarizePatch` updated to:

- **add**: `"Heating system" + add + — + "ASHP" — from library` (or just `"ASHP"` for inline).
- **remove**: `"Heating system" + remove + "old label"` (looked up from baselineConfig via the match.id; falls back to id string).
- **replace**: `"Heating system" + replace + "old label" → "new label" — from library`.

The path-label table in `patchCapture.js` gained service-array entries:

```
building.systems_config_v40.heating      → 'Heating system'
building.systems_config_v40.cooling      → 'Cooling system'
building.systems_config_v40.dhw          → 'DHW system'
building.systems_config_v40.ventilation  → 'Ventilation system'
building.systems_config_v40.lighting     → 'Lighting entry'
building.systems_config_v40.small_power  → 'Small power entry'
```

(Brief 42 service-level paths added to the same table — heating_setpoint_c, cooling_setpoint_c, dhw_storage_setpoint_c, etc. — pre-emptively to support Part 3.)

### §3.4 Share validation + Normalise quick-fix

The engine's share validation (`_validateShares` in `systemsEngine.js`, Brief 40 Part 5b) emits an error string when `enabled` systems' `share_pct` don't sum to 100% for a service. The error reaches the preview pane via the existing `validationError` prop on `InterventionEditorPreview`.

Brief 43 Part 2 adds:

- The error block now shows a **"Normalise enabled shares"** button when the error string matches the share-validation pattern.
- Click handler (`InterventionEditorPopout.handleNormaliseShares`):
  - Parses the offending service from the error (`for service '<name>'`)
  - Reads enabled systems from `currentConfig.building.systems_config_v40[service]`
  - Computes new shares: `cur / enabled_sum * 100` (proportional scaling), or `100 / count` if all enabled systems are at zero
  - Captures one `set` patch per enabled system at `...[id=<id>].share_pct`
- Save remains disabled until the validation error clears (a re-run on the next render returns no error once the captured patches sum the shares to 100%).

Pattern mirrors Brief 40 Part 5b's Normalise (which operated on the baseline config); here it operates at intervention-authoring time, leaving the baseline untouched.

### §3.5 What Part 2 did NOT change

- No engine changes — `applyPatch`'s add/remove/replace handlers untouched.
- No data model changes — patch shape per Brief 41 (`{ id, op, path, value, match, source, schema_version }`).
- Service sections render even when empty (one minor UX upgrade) — but the empty-section message is purely cosmetic; the patch-capture flow doesn't depend on it.
- The popout body still uses the Brief 41 two-column layout inside the 1000 px width. No width / layout refactor in Part 2.
- Removed systems disappear from the editor immediately (currentConfig reflects the captured remove patch). The "ghost row crossed-out" treatment from the brief §2.2 is deferred — the PatchList already shows what was removed, which is sufficient for the patch-authoring use-case.

### §3.6 Files touched in Part 2

- `frontend/src/components/modules/interventions/InterventionEditorBuildingView.jsx` — `StructuralOpMenu` + `AddSystemAffordance` + `ReplaceSystemAffordance` helpers; ServiceBlock gains ⊗ / ⇄ buttons; sections render for all six services
- `frontend/src/components/modules/interventions/InterventionEditorPopout.jsx` — `handleNormaliseShares` parses the engine error + captures `set` patches; passes through to preview as `onNormaliseShares`
- `frontend/src/components/modules/interventions/InterventionEditorPreview.jsx` — surfaces the Normalise quick-fix button next to share-validation errors
- `frontend/src/components/modules/interventions/patchCapture.js` — `pathLabel` gains service-array + Brief 42 service-level entries; `summarizePatch` improves add/remove/replace rendering
- `frontend/src/components/modules/systems/AddSystemButton.jsx` — exported `seedSystem` + `BLANK_ARCHETYPES` for reuse

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
