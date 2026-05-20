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

## §4 — Part 3 — Wider coverage + service-level patches + InterventionRow summary (2026-05-20)

### §4.1 Service-level (building-level) patch UI

`InterventionEditorBuildingView` gained a new `ServiceLevelHeader` component that renders at the top of each service section in the curated editor. It mirrors the Brief 42 `ServiceSectionHeader` from the Systems module but with patch-capture wiring instead of direct-write:

| Service | Fields exposed | Patch paths |
|---|---|---|
| heating | Setpoint mode (radio: Follow comfort / Custom) + custom °C | `heating_setpoint_mode` + `heating_setpoint_c` |
| cooling | Same shape | `cooling_setpoint_mode` + `cooling_setpoint_c` |
| dhw     | Storage / tap outlet / cold supply temps + demand basis + demand quantity | `dhw_storage_setpoint_c`, `dhw_tap_outlet_temp_c`, `dhw_cold_supply_temp_c`, `dhw_demand_basis`, `dhw_demand_litres_per_person_per_day`, `dhw_demand_litres_per_m2_per_day` |
| ventilation / lighting / small_power | (no service-level fields — returns null) | — |

All paths address `building.systems_config_v40.<field>` directly — post-Brief-42 service-level positions. Toggling between Follow comfort ↔ Custom emits a pair of `set` patches (mode + value); the mode patch carries `'follow_comfort'` or `'custom'`, the value patch carries `null` or the seeded comfort-band temperature respectively.

### §4.2 Per-system field coverage widening

`ServiceBlock` now exposes:

- **Source dropdown** (heating / cooling / DHW / ventilation) — reads the canonical `SOURCE_OPTIONS` table from `SystemEditorCard.jsx` so the dropdown matches the Systems module byte-for-byte.
- **Efficiency metric** — heating (η / SCOP), cooling (SEER), DHW (point-of-use η). Numeric input. (Brief 41 already had this for heating/cooling/DHW — only the label was tightened in Part 3.)
- **Share %** — numeric input 0–100. (Already in Brief 41.)
- **Control mechanism** — dropdown (constant / weather_compensation / occupancy_driven / scheduled, per service). NEW for heating/cooling/DHW/ventilation. Was already present for lighting/small_power.
- **Enabled toggle** — boolean (Brief 40 Part 5b pattern). Already in Brief 41.

Per-system **`setpoint`** field input REMOVED. Brief 42 invalidated this path; the service-level header above the per-system list now owns the setpoint affordance. Removing the input prevents the editor from emitting stale paths that the engine ignores.

### §4.3 Ventilation-specific fields

`ServiceBlock` for the `ventilation` service now exposes:

- **Flow rate** + **Flow basis** (per_person / per_m2 / constant) — top-level on the system, mapped to `building.systems_config_v40.ventilation[id=*].flow_rate` and `.flow_rate_basis`.
- **SFP** — `efficiency_metric.sfp_w_per_lps` + v25 mirror `sfp_w_per_l_s` (dual-write per Brief 28j / Brief 41 Part 4.1 — State 2 demand-side recovery reads v25).
- **Sensible recovery** — `efficiency_metric.recovery_sensible_pct` + v25 mirror `hre` (×100 conversion).
- **Latent recovery** — `efficiency_metric.recovery_latent_pct`. NEW. No v25 mirror — Brief 28j's hourly recovery cap is sensible-only.
- **Control mechanism** — dropdown.

### §4.4 Lighting / small_power — Internal Gains cross-reference

`ServiceBlock` for `lighting` / `small_power` already exposed `control_mechanism` + `control_factor` in Brief 41. Brief 43 Part 3 adds an inline NavLink "Edit lighting load in Internal Gains →" / "Edit equipment load in Internal Gains →" that cross-references the Internal Gains module (the source of truth for the lighting/equipment power densities per the Brief 40 Part 4 + standalone `d3a7f5a` thin-entry pattern). Patching the power density itself happens in the Internal Gains section above (lighting load, equipment active).

### §4.5 Envelope: ground floor U

The envelope section gained a Ground floor construction picker (selectable from `libraryData.constructions`) writing patches at `constructions.ground_floor` with the same `{ library_id, u_value_override }` shape as wall / roof / glazing. Brief 41 walkthrough specifically called this out as missing. Patch-label table in `patchCapture.js` gained matching entries.

### §4.6 InterventionRow patch-summary

`InterventionRow` was previously: drag handle + dot + label + theme + override-warn + marginal Δ + cumulative Δ + save + edit. Brief 43 Part 3 reflows the label column into two rows:

- **Line 1:** label + theme chip + override-warn icon (unchanged).
- **Line 2 (new):** `N patches: <short summary>` where the summary is generated by `summarizePatchListShort(patches, baselineConfig, { maxItems: 3 })`.

`summarizePatchListShort` builds a comma-separated list of short patch tags. Each tag uses `shortPatchLabel(patch, baselineConfig)`:

| Op | Tag format |
|---|---|
| set | `<label>` (e.g. `Wall construction`, `Heating setpoint`) |
| add | `+ <label>: <value.label>` (e.g. `+ Heating system: ASHP_Daikin_VRV_X`) |
| remove | `− <label>: <baseline label or id>` (e.g. `− DHW system: gas_combi_dhw`) |
| replace | `⇄ <label>: <old> → <new>` (e.g. `⇄ Ventilation system: MEV → MVHR`) |

When the patch list has more entries than `maxItems`, the head is followed by ` +N more`. Empty patch lists render as `No patches yet`.

`baselineConfig` is passed down from `InterventionsModule` through `InterventionStackView` so the row can resolve labels for `remove` / `replace` ops by matching against the baseline's current state.

### §4.7 Walkthrough verification matrix — 16 rows

Brief 41 §V row set (10 rows) + 6 new Brief 43 structural / service-level patches:

| # | Intervention type | Patch shape (paths inside `building_config.`) |
|---|---|---|
| 1 | Improve wall U (construction swap) | `set constructions.external_wall = { library_id, u_value_override: null }` |
| 2 | Reduce infiltration (q50) | `set building.fabric.air_permeability_q50` |
| 3 | Reduce solar gain via shading | `set building.shading_overhang.<face>.depth_m` |
| 4 | Improve roof U | `set constructions.roof` |
| 5 | Improve glazing U | `set constructions.glazing` |
| 6 | Increase heating efficiency (SCOP) | `set systems_config_v40.heating[id=*].efficiency_metric` |
| 7 | Increase ventilation SFP + recovery | `set systems_config_v40.ventilation[id=*].efficiency_metric.{sfp_w_per_lps, recovery_sensible_pct}` + v25 mirror |
| 8 | Reduce occupancy density | `set building.occupancy.density.value` |
| 9 | Custom cooling setpoint (Brief 41 per-system, **rewired to service-level in Brief 43**) | `set systems_config_v40.cooling_setpoint_mode = 'custom'` + `cooling_setpoint_c` |
| 10 | Daylight dimming lighting | `set systems_config_v40.lighting[id=*].control_mechanism = 'daylight_dimming'` + `.control_factor` |
| 11 | Add MVHR system to ventilation | `add systems_config_v40.ventilation` with `value: { id, label, source, efficiency_metric, ... }` |
| 12 | Remove gas combi heating | `remove systems_config_v40.heating, match: { id: 'gas_combi_1' }` |
| 13 | Replace gas DHW with ASHP DHW | `replace systems_config_v40.dhw, match: { id: '...' }, value: {...}` |
| 14 | Change heating setpoint (service-level) | `set systems_config_v40.heating_setpoint_mode + .._c` |
| 15 | Change DHW demand quantity (service-level) | `set systems_config_v40.dhw_demand_litres_per_person_per_day` |
| 16 | Add ground floor U intervention | `set constructions.ground_floor = { library_id, u_value_override }` |

Row 9 specifically MIGRATED from Brief 41's per-system path (`systems_config_v40.cooling[id=*].setpoint`) to Brief 42's service-level paths in Brief 43 Part 3. The per-system input is removed from the editor; the ServiceLevelHeader emits the new paths instead. Any persisted Brief 41 interventions with the old paths are handled by Brief 42's `migratePatch(patch, 1, 2)` (covered by the existing loader migration).

### §4.8 Files touched in Part 3

- `frontend/src/components/modules/interventions/InterventionEditorBuildingView.jsx` — new `ServiceLevelHeader`; `ServiceBlock` source + control_mechanism + ventilation flow_rate / recovery_latent / control_mechanism; per-system setpoint input removed; Internal Gains cross-reference for lighting/small_power; ground floor U construction picker
- `frontend/src/components/modules/interventions/patchCapture.js` — new `shortPatchLabel` + `summarizePatchListShort`; pathLabel gained ground-floor entries
- `frontend/src/components/modules/interventions/InterventionRow.jsx` — two-line label column with patch count + summary
- `frontend/src/components/modules/interventions/InterventionStackView.jsx` — passes `baselineConfig` to `InterventionRow`
- `frontend/src/components/modules/interventions/InterventionsModule.jsx` — passes `baselineConfig` to `InterventionStackView`

### §4.9 What Part 3 did NOT change

- No engine changes.
- No data model changes. Patch shape unchanged.
- Schedule overrides for occupancy / lighting / equipment (brief §3.5) — deferred. The Internal Gains cross-reference NavLink directs the user to the Internal Gains module which has the schedule editor. Adding the full schedule editor as a child of the curated intervention editor is significant scope; the cross-reference is the lighter answer.
- Shading fins (per-facade left/right fin depth) — deferred. Only overhang depth is editable in the curated editor. The Building module exposes fins; patches can be authored manually if needed.
- The popout body still uses the Brief 41 two-column layout (editor + preview side-by-side inside the 1000 px width). No width refactor.

### §4.10 Note on Brief 41 §V row 9 path migration

The cooling-setpoint-custom intervention type was acceptance-tested in Brief 41 Part 4.1 walkthrough using a per-system path. Brief 42 invalidated that path; the engine no longer reads `systems_config_v40.cooling[id=*].setpoint`. Any persisted intervention from Brief 41 with that path is rewritten to the service-level path by Brief 42's `migratePatch(patch, 1, 2)`, transparently. Brief 43's editor emits the new path directly; the old path is no longer offered in the UI. Brief 41's library_interventions remain functional via the migration layer.

---

## §5 — Part 4 — Walkthrough (placeholder, filled in Part 4)

To be filled.

---

## §6 — What this doc does NOT contain

- The patch shape / engine ops — see `docs/audit/41_interventions_schema.md`.
- The post-Brief-42 systems schema — see `docs/audit/42_systems_ux_schema.md`.
- The brief itself — `docs/briefs/active/43_interventions_ux.md`.
- Brief 41's UI implementation pattern decisions (curated editor vs main-app wrap) — covered in Issue #20 in `docs/audit/29_open_issues.md` and Brief 41 Part 4's STATUS.
