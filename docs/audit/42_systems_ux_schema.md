# 42 — Systems UX schema (service-level vs system-level)

**Status:** Canonical schema reference for Brief 42 (Systems UX).
**Authored:** 2026-05-20 (Brief 42 Part 1)
**Notion design note:** [NZA-Sim — Systems UX (Brief 42): service-level vs system-level fields](https://www.notion.so/366d645e05cc81cbb576ce33b0a22208)
**Supersedes (in part):** `docs/audit/40_systems_library_schema.md` §1, §2.1, §2.2, §2.3 — see §1 below for the precise scope.
**Resolves:** `docs/audit/29_open_issues.md` #21 (DHW demand → service-level), #22 (system editor pop-out).

This doc is the single canonical reference for the Brief 42 schema reorganisation. Building-level fields (zone targets, service demand) lift out of per-system entries to service-level positions on `systems_config_v40`. Per-system entries retain only fields that describe the specific kit installed.

---

## §1 — Scope of the reorganisation

**Pre-Brief-42 (Brief 40 schema, `schema_version: 1`):**
- Heating systems each carry their own `setpoint` field.
- Cooling systems each carry their own `setpoint` field.
- DHW systems each carry their own `setpoint` (storage temp), `tap_outlet_temp_c`, `cold_supply_temp_c`, `demand_basis`, `demand_litres_per_m2_day`, `demand_litres_per_person_per_day`.
- Ventilation, lighting, small_power: unchanged — no building-level fields embedded in per-system entries.

**Post-Brief-42 (`schema_version: 2`):**
- Heating setpoint lifts out as `systems_config_v40.heating_setpoint_mode` + `systems_config_v40.heating_setpoint_c`.
- Cooling setpoint lifts out as `systems_config_v40.cooling_setpoint_mode` + `systems_config_v40.cooling_setpoint_c`.
- DHW storage / tap / cold / demand fields lift out as `systems_config_v40.dhw_storage_setpoint_c`, `systems_config_v40.dhw_tap_outlet_temp_c`, `systems_config_v40.dhw_cold_supply_temp_c`, `systems_config_v40.dhw_demand_basis`, `systems_config_v40.dhw_demand_litres_per_person_per_day`, `systems_config_v40.dhw_demand_litres_per_m2_per_day`.
- Per-system DHW / heating / cooling entries no longer carry those fields; engine errors loudly if it sees them (Part 2).
- Ventilation, lighting, small_power: untouched.

---

## §2 — Why service-level

A field belongs at the service level when it describes the **project's needs** or **zone targets** rather than the specific kit installed. Two systems serving the same service cannot meaningfully disagree on:

- **Zone target temperature** — there's one zone-side temperature the heating/cooling systems are trying to maintain. If GSHP says 19°C and gas boiler backup says 21°C, the engine has no defined precedence — current behaviour is "use the first enabled system's setpoint", which is fragile + invisible.
- **DHW demand quantity** — there's one project hot-water demand (L/person/day or L/m²/day). Multiple DHW systems share that demand by `share_pct`. If gas calorifier says demand=80 L/person/day and ASHP DHW says demand=100 L/person/day, the engine has no defined precedence.
- **DHW tap-mix temperatures** — the building's tap outlet, cold supply, and storage temperatures are project properties. The tap-mix `hot_fraction` (Brief 40 audit §4) is a single per-project ratio, not a per-system ratio.

The engine's current "first enabled system wins" fallback works in practice (because Bridgewater's migration populated every DHW entry's demand fields with the same value) but is structurally wrong. Brief 42 makes the structure match the physics.

---

## §3 — Post-Brief-42 schema shape

```js
systems_config_v40: {
  // ── Heating service ────────────────────────────────────────────
  heating_setpoint_mode: 'follow_comfort' | 'custom',
  heating_setpoint_c:    number | null,   // populated when mode === 'custom'; null otherwise
  heating: [
    {
      id, label, service: 'heating',
      source,                       // 'electricity' | 'gas' | 'oil' | 'biomass'
                                    //   | 'district_heating' | 'ambient_air' | 'ambient_ground'
      efficiency_metric,            // SCOP | seasonal η (numeric)
      share_pct,                    // 0-100; enabled per-service shares sum to 100
      control_mechanism,            // 'constant' | 'weather_compensation' | 'occupancy_driven' | 'scheduled'
      control_schedule_id,          // string | null
      capacity_kw, notes,
      enabled                       // boolean (Brief 40 Part 5b)
      // NO `setpoint` — service-level now
    }, ...
  ],

  // ── Cooling service ────────────────────────────────────────────
  cooling_setpoint_mode: 'follow_comfort' | 'custom',
  cooling_setpoint_c:    number | null,
  cooling: [
    {
      id, label, service: 'cooling',
      source,                       // 'electricity' | 'district_cooling'
      efficiency_metric,            // SEER (numeric)
      share_pct, control_mechanism, control_schedule_id,
      capacity_kw, notes, enabled
      // NO `setpoint`
    }, ...
  ],

  // ── DHW service ────────────────────────────────────────────────
  dhw_storage_setpoint_c:  number,      // default 60 (legionella)
  dhw_tap_outlet_temp_c:   number,      // default 40 (hotel) / 30-35 (residential)
  dhw_cold_supply_temp_c:  number,      // default 10
  dhw_demand_basis:        'per_person' | 'per_m2',
  dhw_demand_litres_per_person_per_day: number,   // used when basis === 'per_person'
  dhw_demand_litres_per_m2_per_day:     number,   // used when basis === 'per_m2'
  dhw: [
    {
      id, label, service: 'dhw',
      source,                       // 'electricity' | 'gas' | 'oil' | 'biomass'
                                    //   | 'district_heating' | 'ambient_air' | 'ambient_ground'
      efficiency_metric,            // overall point-of-use η (numeric)
      share_pct, control_mechanism, control_schedule_id,
      capacity_kw, notes, enabled
      // NO `setpoint`, `tap_outlet_temp_c`, `cold_supply_temp_c`,
      //    `demand_basis`, `demand_litres_*` — service-level now
    }, ...
  ],

  // ── Ventilation, Lighting, Small power: unchanged ─────────────
  ventilation: [ /* per-system: SFP + recovery + flow_rate + enabled (Brief 40 unchanged) */ ],
  lighting:    [ /* per-system thin entries: control_mechanism + control_factor + share + enabled */ ],
  small_power: [ /* per-system thin entries */ ],
}
```

Both demand basis fields are kept populated on the schema (`dhw_demand_litres_per_person_per_day` AND `dhw_demand_litres_per_m2_per_day`) so the user can switch `dhw_demand_basis` without losing the other-basis value. The engine reads whichever matches the current basis.

---

## §4 — Before / after example (Bridgewater)

### Heating

**PRE-Brief-42** (current Bridgewater shape):
```js
systems_config_v40.heating = [
  {
    id: 'sys_heating_*_18672',
    label: 'Primary heating (vrf_heat_recovery_dual_function)',
    source: 'electricity', efficiency_metric: 2.5,
    setpoint: null,                       // ← moves out
    share_pct: 70, enabled: true, ...
  },
  {
    id: 'sys_heating_*_*',
    label: 'Secondary heating (electric_panel_heater)',
    source: 'electricity', efficiency_metric: 1.0,
    setpoint: null,                       // ← moves out
    share_pct: 30, enabled: true, ...
  },
]
```

**POST-Brief-42:**
```js
systems_config_v40 = {
  heating_setpoint_mode: 'follow_comfort',
  heating_setpoint_c:    null,           // engine substitutes comfortBand.lower_c
  heating: [
    { id, label, source: 'electricity', efficiency_metric: 2.5, share_pct: 70, ...enabled: true },
    { id, label, source: 'electricity', efficiency_metric: 1.0, share_pct: 30, ...enabled: true },
  ],
  ...
}
```

### DHW

**PRE-Brief-42** (Bridgewater):
```js
systems_config_v40.dhw = [
  {
    id: 'sys_dhw_*_52485',
    label: 'DHW gas (gas_boiler_calorifier)',
    source: 'gas', efficiency_metric: 0.9,
    setpoint: 60,                                 // ← storage temp; moves out
    tap_outlet_temp_c: 40,                        // ← moves out
    cold_supply_temp_c: 10,                       // ← moves out
    demand_basis: 'per_person',                   // ← moves out
    demand_litres_per_person_per_day: 80,         // ← moves out
    demand_litres_per_m2_day: null,               // ← moves out
    share_pct: 45, enabled: true, ...
  },
  {
    id: 'sys_dhw_*_17243',
    label: 'DHW heat pump (ashp_dhw_preheat)',
    source: 'ambient_air', efficiency_metric: 3.0,
    setpoint: 60,                                 // duplicated — structural problem
    tap_outlet_temp_c: 40,                        // duplicated
    cold_supply_temp_c: 10,                       // duplicated
    demand_basis: 'per_person',                   // duplicated
    demand_litres_per_person_per_day: 80,         // duplicated
    demand_litres_per_m2_day: null,               // duplicated
    share_pct: 55, enabled: true, ...
  },
]
```

**POST-Brief-42:**
```js
systems_config_v40 = {
  dhw_storage_setpoint_c: 60,
  dhw_tap_outlet_temp_c:  40,
  dhw_cold_supply_temp_c: 10,
  dhw_demand_basis:       'per_person',
  dhw_demand_litres_per_person_per_day: 80,
  dhw_demand_litres_per_m2_per_day:     1.1,    // populated to make basis-switching cheap
  dhw: [
    { id, label: 'DHW gas (gas_boiler_calorifier)',     source: 'gas',         efficiency_metric: 0.9, share_pct: 45, enabled: true, ... },
    { id, label: 'DHW heat pump (ashp_dhw_preheat)',    source: 'ambient_air', efficiency_metric: 3.0, share_pct: 55, enabled: true, ... },
  ],
  ...
}
```

The duplicated building-level fields collapse to one source of truth. Per-system entries shrink to the kit-describing fields only.

---

## §5 — DEFAULT_PARAMS new shape

`frontend/src/context/ProjectContext.jsx` DEFAULT_PARAMS sets these defaults for new projects:

```js
systems_config_v40: {
  heating_setpoint_mode: 'follow_comfort',
  heating_setpoint_c:    null,
  cooling_setpoint_mode: 'follow_comfort',
  cooling_setpoint_c:    null,
  dhw_storage_setpoint_c: 60,
  dhw_tap_outlet_temp_c:  40,
  dhw_cold_supply_temp_c: 10,
  dhw_demand_basis:       'per_person',
  dhw_demand_litres_per_person_per_day: 80,
  dhw_demand_litres_per_m2_per_day:     1.1,
  heating: [],
  cooling: [],
  dhw:     [],
  ventilation: [],
  lighting: [{ /* thin entry — unchanged from Brief 40 Part 4 seed */ }],
  small_power: [{ /* thin entry — unchanged */ }],
}
```

`schema_version: 2` (top-level on DEFAULT_PARAMS) — incremented from 1 (Brief 41 Part 1).

---

## §6 — Schema version convention

`schema_version` is a monotonically-increasing integer that increments each time the `building_config` schema changes in a way that breaks existing patch paths. Brief 41 stamped the first version (`schema_version: 1`). Brief 42 stamps version 2.

**Convention divergence note:** the Brief 42 spec text ("schema_version bumped from 41 to 42") used brief numbers as the schema_version label. The code stays with monotonic integers (1 → 2) so the existing Brief 41 convention is preserved. Future schema-changing briefs increment by 1, regardless of their brief number. The `migratePatch(patch, fromVersion, toVersion)` signature uses the integer versions; documentation references brief numbers for human readability.

---

## §7 — Patch migration (v1 → v2)

`frontend/src/utils/interventionsEngine.js` `migratePatch(patch, 1, 2)` rewrites pre-v2 patch paths to v2 paths. Interventions stored against the v1 schema continue to work after Brief 42 — they get migrated at project-load time and on each save.

### §7.1 Path-rewrite table

| v1 (pre-Brief-42) path | v2 (post-Brief-42) path |
|---|---|
| `building.systems_config_v40.heating[id=*].setpoint` | `building.systems_config_v40.heating_setpoint_c` (+ a sibling patch on `heating_setpoint_mode` when value is non-null — see §7.2) |
| `building.systems_config_v40.cooling[id=*].setpoint` | `building.systems_config_v40.cooling_setpoint_c` (+ sibling mode patch when non-null) |
| `building.systems_config_v40.dhw[id=*].setpoint` | `building.systems_config_v40.dhw_storage_setpoint_c` |
| `building.systems_config_v40.dhw[id=*].tap_outlet_temp_c` | `building.systems_config_v40.dhw_tap_outlet_temp_c` |
| `building.systems_config_v40.dhw[id=*].cold_supply_temp_c` | `building.systems_config_v40.dhw_cold_supply_temp_c` |
| `building.systems_config_v40.dhw[id=*].demand_basis` | `building.systems_config_v40.dhw_demand_basis` |
| `building.systems_config_v40.dhw[id=*].demand_litres_per_person_per_day` | `building.systems_config_v40.dhw_demand_litres_per_person_per_day` |
| `building.systems_config_v40.dhw[id=*].demand_litres_per_m2_day` | `building.systems_config_v40.dhw_demand_litres_per_m2_per_day` |

The `building_config.*` prefix variant is accepted as a synonym for `building.*` (Brief 41 audit doc §5 uses `building_config.` shorthand in places).

### §7.2 Multi-emit case: setpoint patches with non-null value

A v1 heating setpoint patch with a non-null value (e.g. `set heating[id=ashp].setpoint = 19`) needs TWO v2 patches:
1. `set systems_config_v40.heating_setpoint_mode = 'custom'` (flip mode out of `follow_comfort`)
2. `set systems_config_v40.heating_setpoint_c = 19`

A v1 patch setting setpoint to `null` (the "follow comfort" intent) collapses to a single v2 patch:
1. `set systems_config_v40.heating_setpoint_mode = 'follow_comfort'`

To handle this within the existing `migratePatch(patch) → result` contract, the function may return an **array** of patches when migration produces multiple. The patch-application loop (in `applyIntervention` and the project loader's intervention-migration step) handles array-returns by flattening.

Same logic for cooling.

### §7.3 Collapse case: multiple v1 patches targeting different systems

The "two interventions patching the same field" boundary condition from the Brief 41 interventions design note §10 applies after migration. If pre-v2 Intervention A sets `heating[id=ashp_1].setpoint = 19` and pre-v2 Intervention B (lower in stack) sets `heating[id=boiler_1].setpoint = 21`, migration produces:
- Intervention A: `heating_setpoint_c = 19` (+ mode = 'custom')
- Intervention B: `heating_setpoint_c = 21` (+ mode = 'custom')

Both now address the same building-level path. Last-write-wins per Notion design note §10. Brief 41 Part 3's `computeOverriddenSet` already flags this case in the stack view; post-migration it'll correctly flag Intervention A as overridden by Intervention B.

### §7.4 Deprecation marker

`migratePatch` returns `{ deprecated: true, reason: '...' }` only when a patch is no longer applicable. No v1 patches become deprecated in the v1→v2 transition — every pre-v2 path has a v2 equivalent.

---

## §8 — Engine integration sketch (filled in Part 2)

Part 2 updates the engine:

- `_computeDhw` reads `systems_config_v40.dhw_tap_outlet_temp_c` etc. directly (not from `enabledSystems[0]`).
- `_computeHeatingOrCooling` resolves setpoint from `systems_config_v40.heating_setpoint_mode` + `_c` (or `comfortBand.lower_c` when mode is `'follow_comfort'`).
- Engine errors loudly if any per-system entry contains a building-level field (catches stale / hand-edited data).
- `setpointOverride` contract on `_calculateState2` (Brief 40 Part 2) preserved — only the SOURCE of the setpoint changes (was per-system, now service-level).
- `withMode` allowlist (`instantCalc.js`) updated for the new building-level field names per Brief 33 Finding 1 ALLOWLIST DRIFT discipline.

### §8.1 Loader-side in-memory migration (Part 2)

When `_applyProject` reads `bc.schema_version < 2` and `bc.systems_config_v40` exists, the loader lifts building-level fields from the first enabled per-system entry that has them (or computes from defaults) to the new service-level position. Per-system fields are stripped. The in-memory params then have `schema_version: 2`; the autosave persists the migrated shape on the first interaction.

This handles in-flight cases between Part 2 lands and Part 4's explicit migration script runs.

### §8.2 Explicit migration script (Part 4)

`scripts/42_systems_ux_migration.py` is the idempotent one-shot equivalent of the loader-side migration. Bridgewater migrates cleanly to the new schema on disk. `--force` flag bypasses the idempotency check.

---

## §9 — Bridgewater sanity expectations (filled in Part 2)

**Critical invariant:** Bridgewater post-Brief-42 EUI must match pre-Brief-42 (commit `5835d21` = Brief 40 close) within 0.5% across all six services. This is a structural reorganisation, not a physics change. Any movement >0.5% means migration is losing data or engine logic has been changed unintentionally — escalate per the brief's "When to escalate" section.

Part 2 documents the hand-migrated sanity test results in this section.

---

## §10 — UI shape (filled in Part 3)

Part 3 lands:

- **`ServiceSectionHeader`** per service — building-level fields editable inline at the top of each service section. Heating: setpoint mode + custom temp. Cooling: same. DHW: storage / tap / cold / demand basis + quantity. Ventilation / lighting / small_power: no building-level fields, just count + Add.
- **`SystemSummaryRow`** per system — compact row: coloured dot, label, share %, headline efficiency, on/off toggle, edit button.
- **`SystemEditorPopout`** — draggable pop-out using Brief 37 `SchedulePopout` chrome; localStorage key `nza-system-editor-popout-position`. Per-system editor inside.
- **`SystemEditorCard` (refactored)** — Identity / Energy / Control / Library / Diagnostic groups. Building-level field groups REMOVED.

Pattern matches Brief 41 Part 4's `InterventionEditorPopout` so users have one consistent editor chrome across the app.

---

## §11 — What this doc does NOT contain

- The brief's Part-by-Part build plan (that's in `docs/briefs/active/42_systems_ux.md`).
- The activation-threshold case (UFH at 19°C + radiator backup below 17°C). Deferred per Notion design note "Principled exception"; different concept (control logic), different future field name. Not in Brief 42 scope.
- Lighting + small_power "source-of-truth" refactor (Brief 40 Part 5c skip). Out of Brief 42 scope per the brief's "What MUST NOT happen" section.
- Comfort-vs-setpoint diagnostic math (unchanged from Brief 40 audit doc §5).
- DHW tap-mix math (unchanged from Brief 40 audit doc §4 — formula identical, only the field paths it reads from change).
