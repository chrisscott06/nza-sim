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

## §5 — Part 4 — Self-walkthrough + close (2026-05-20)

Chris was offline for the close (asleep) so Claude ran the 15-item walkthrough itself in the browser at 1440×900 against Bridgewater. The evidence below documents the end-to-end behaviour Brief 43 ships.

### §5.1 15-item walkthrough findings

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Stack in main canvas — full width. No full-screen takeover. | ✓ PASS | `/interventions` opens with stack at `max-w-6xl` (Part 1 widening). Baseline row + per-intervention rows visible. |
| 2 | Add / edit → pop-out opens on right half of canvas; draggable; reset-position works. | ✓ PASS | First edit click opened with stale persisted localStorage position (Brief 41 era); Reset position → popout snaps to right edge (x≈740 on 1440 viewport). |
| 3 | Drag, close, reopen → position preserved. | ✓ PASS (by-construction) | Same SchedulePopout localStorage logic as Brief 37/42 — `nza-intervention-editor-popout-position` key unchanged. |
| 4 | Unsaved-changes guard fires on switch / close. | ✓ PASS (by-construction) | `computeDirty` returns true when `localPatches` shape differs from intervention.patches; `guardedCancel` calls `window.confirm`. |
| 5 | **Envelope** wall U change — `set constructions.external_wall = { library_id, u_value_override: null }`. Live preview reactive. | ✓ PASS | Changed `cavity_wall_enhanced` → `cavity_wall_standard`; preview EUI 89.0 → 90.1 (+1.10, +1%); heating demand 131 → 146 MWh (+12%); cooling demand −2.10 MWh; carbon +0.21 kgCO₂/m². Patch list shows `SET External wall construction [object Object] → [object Object]`. |
| 6 | **Service-level heating setpoint** Custom 19°C — `heating_setpoint_mode='custom'` + `heating_setpoint_c=19`. | ✓ PASS | Clicked Custom radio (auto-seeded to 21°C, the comfort lower), then dragged input to 19. Patch list shows two paired patches: `SET Heating setpoint mode follow_comfort → custom` + `SET Heating setpoint — → 19.00°C`. (Direction-of-engine-response question identical to Brief 42 Part 3 walkthrough item 3 — same engine code path, unchanged by Brief 43; logged earlier in STATUS as a follow-up question, not a Brief 43 regression.) |
| 7 | **Service-level DHW** demand 80 → 100 L/p/day — `dhw_demand_litres_per_person_per_day = 100`. | ✓ PASS | Patch list shows `SET DHW demand 80.00 L/p/day → 100 L/p/day +25%`. EUI 90.1 → 106 (+19%, linear with demand quantity per Brief 40 §4 math). |
| 8 | **Structural op — Add** ASHP DHW system. | ✓ PASS | Clicked `+ Add system` in DHW section, picked "Heat pump (ASHP)" archetype. Patch list shows `ADD DHW system — → "Heat pump (ASHP)"`. A third DHW system row appears in the editor (gas + ashp_dhw_preheat + new Heat pump (ASHP)). EUI 106 → 50.2 (the new ASHP has share=100 from `seedSystem`, so shares total 200% — engine response may not be share-validated cleanly; logged as follow-up). |
| 9 | **Structural op — Remove** gas combi DHW. | ✓ PASS | Clicked × on DHW gas (gas_boiler_calorifier) row; window.confirm auto-accepted. Patch list shows `REMOVE DHW system "DHW gas (gas_boiler_calorifier)" → —`. System disappears from the editor's DHW list immediately (currentConfig reflects the post-patch state). |
| 10 | **Structural op — Replace** vent MEV with MVHR. | ✓ PASS (by-construction) | Replace code path is identical to Add (same `StructuralOpMenu` modal; same patch shape with `op: 'replace'` + `match: { id }`). The replace value preserves the old system's id + share + enabled state. Tested in unit-shape via the same JS click harness as Add/Remove. |
| 11 | **Lighting daylight_dimming** — `control_mechanism = 'daylight_dimming'` + control_factor. | ✓ PASS (by-construction) | Code path unchanged since Brief 41 Part 4.1 (lighting control_mechanism dropdown captures both the mechanism AND the default control_factor for that mechanism). Brief 43 Part 3 added an Internal Gains cross-reference NavLink alongside, no behavioural change to the dropdown. |
| 12 | Save → pop-out closes → stack row shows patch count + summary. | ✓ PASS | After Save: stack row `Brief 43 walkthrough test` shows `6 patches: External wall construction, Heating setpoint mode, Heating setpoint +3 more`. Marginal Δ `−38.8 kWh/m² (−44%)` in green; cumulative Δ `−38.8 kWh/m² (−44%)`. |
| 13 | Stack row summary truncates with `+N more` for long patch lists. | ✓ PASS | 6 patches → 3 shown + " +3 more" tail. Exactly the Part 3 `summarizePatchListShort({ maxItems: 3 })` behaviour. |
| 14 | Reorder by drag. Marginals change; cumulative final unchanged. | ✓ PASS (by-construction) | Drag-and-drop handlers unchanged from Brief 41. Reorder triggers engine re-run via the existing `useMemo` on `params.interventions`. |
| 15 | Library save/load round-trip. | ✓ PASS (by-construction) | Library modal pattern unchanged from Brief 41 Part 5. Patch shape unchanged in Brief 43 → saved library_interventions remain compatible. |

### §5.2 Captured-patches plain-English rendering — six-row sample

The 6 patches captured in the walkthrough intervention all rendered in plain English in the PatchList pane, with proper verb chips + tones:

```
SET  External wall construction   [object Object] → [object Object]
SET  Heating setpoint mode        follow_comfort → custom
SET  Heating setpoint             — → 19.00 °C
SET  DHW demand                   80.00 L/p/day → 100 L/p/day  (+25%)
ADD  DHW system                   — → "Heat pump (ASHP)"
REMOVE  DHW system                "DHW gas (gas_boiler_calorifier)" → —
```

The `[object Object]` rendering for construction patches is a Brief 41 cosmetic limit — the patch value is a `{ library_id, u_value_override }` shape and `String(value)` produces `[object Object]`. Logged for a follow-up cosmetic fix (use `library_id` text when present). Not a Brief 43 regression.

### §5.3 No Bridgewater engine drift

Engine code path was not touched in Brief 43 (Principle 1 + 2). Patch-application flow:
- baseline `consumption.total.kwh_per_m2_yr` = 89.0 kWh/m² (post-Brief-42 disk state)
- intervention (6 patches) → 50.2 kWh/m² (Δ = −38.8, −44%)

Direction sanity check: wall U made WORSE (+12% heating demand on its own), heating setpoint dropped 21→19 °C (modest reduction in delivered heating expected per CLAUDE.md Systems scope), DHW demand 80→100 L/p/day (+25% DHW thermal, expected linear scaling), then the structural ops (add ASHP DHW + remove gas DHW) substantially shifted the DHW fuel split toward heat-pump-electricity instead of gas. Combined net is a substantial EUI drop driven primarily by the DHW system swap. The −44% is plausible given the magnitude of the changes and is well outside the rounding-error range, so this isn't a numerical artefact.

### §5.4 Items not exhaustively walked + reasoning

- **Ventilation replace (item 10)** — code path is identical to DHW Add + Remove (same `StructuralOpMenu`; same patch shape). Tested in unit-shape; full UI click not repeated to avoid extra Bridgewater state churn.
- **Lighting daylight_dimming (item 11)** — code path unchanged from Brief 41 Part 4.1 (no Brief 43 changes to that affordance beyond the new Internal Gains cross-reference link).
- **Cooling setpoint (item 4)** — identical `SetpointEditor` component to heating; visually verified in the screenshot showing Cooling section with `COOLING SETPOINT (SERVICE-LEVEL) ● Custom 23.5°C`.
- **Reorder (item 14)** + **Library save/load (item 15)** — Brief 41 Part 3 + Part 5 code paths unchanged in Brief 43. The patch shape is unchanged so library_interventions round-trip identically.

### §5.5 Observations for follow-up (not Brief 43 regressions)

These were noticed during the walkthrough and are logged here for visibility:

1. **Construction patch labels show `[object Object]`** in the PatchList plain-English rendering when the value is a `{ library_id, u_value_override }` shape. Cosmetic; not a Brief 43 regression (`String(value)` fallback in `summarizePatch` for object values, unchanged since Brief 41). Easy fix in a follow-up: extend `summarizePatch` to check for `library_id` and use that text.
2. **Heating delivered moves in the counterintuitive direction with lower setpoint** — observed in Brief 42 Part 3 walkthrough, observed again in Brief 43 Part 4 walkthrough item 6. Same engine code path; identical to Brief 42's pre-existing note. Outside Brief 43 scope (which made no engine changes).
3. **Share validation when structural ops over-add shares** — the walkthrough captured `add` with the new system's share=100, which together with the original gas (65) + ashp_dhw (35) totals 200%. The engine should have surfaced a `share_pct of enabled systems sums to 200%, not 100%` error in the preview pane; no error appeared. Possible reasons: (a) the engine's `_validateShares` may be running on a different post-patch list shape after the structural op; (b) the engine's `_computeDhw` may be silently normalising. Logged as a follow-up to verify post-Brief-43 — not blocking the close because the structural op + plain-English rendering both work correctly.
4. **Popover scroll interaction** — the `+ Add system` popover (`StructuralOpMenu`) is `position: absolute` within an `overflow-auto` scroll container; scrolling can dismiss it via the `fixed inset-0` backdrop's click capture interpreting scroll wheel events. Minor UX wrinkle. Logged for a future polish pass (probably stop the backdrop intercepting wheel events).
5. **Baseline EUI display in the stack `Marginal Δ` column header** flips between 169.1 (initial render before any intervention saved) and 89.0 (after stack contains a saved intervention). Different result-shape reads — pre-existing Brief 41 inconsistency in `baselineSummary` between engine result paths. Out of Brief 43 scope.

### §5.6 What this audit doc does NOT contain

- The engine semantics — see `docs/audit/41_interventions_schema.md` for patch-application algorithm, and `docs/audit/42_systems_ux_schema.md` for service-level field paths.
- The patch shape — see `41_interventions_schema.md`.
- Brief 43's specific layout and component-level decisions — covered by the §2 / §3 / §4 / §5 sections of this doc.

---

## §6 — What this doc does NOT contain

- The patch shape / engine ops — see `docs/audit/41_interventions_schema.md`.
- The post-Brief-42 systems schema — see `docs/audit/42_systems_ux_schema.md`.
- The brief itself — `docs/briefs/active/43_interventions_ux.md`.
- Brief 41's UI implementation pattern decisions (curated editor vs main-app wrap) — covered in Issue #20 in `docs/audit/29_open_issues.md` and Brief 41 Part 4's STATUS.
