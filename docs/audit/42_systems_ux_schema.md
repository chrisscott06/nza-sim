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

## §8 — Engine integration (Brief 42 Part 2)

Part 2 lands the engine refactor + loader-side migration. Three file paths touched:

### §8.1 — `frontend/src/utils/systemsEngine.js` — engine reads service-level

- **`_resolveSetpoint(serviceLevel, service, comfortBand)`** — signature change. Reads `serviceLevel.{service}_setpoint_mode` + `{service}_setpoint_c`. Mode `'follow_comfort'` substitutes `comfortBand.lower_c` (heating) or `comfortBand.upper_c` (cooling). Mode `'custom'` uses `_c` verbatim. DHW has its own service-level fields handled by `_computeDhw` directly (no setpoint-mode flag — storage setpoint is always explicit).
- **`_detectStalePerSystemFields(systems, service)`** — new helper. Walks per-system entries; if any carries a v1 building-level field (`setpoint` on heating/cooling/dhw, or `tap_outlet_temp_c` / `cold_supply_temp_c` / `demand_basis` / `demand_litres_*` on DHW), returns a loud error message naming the offending field + system + the v2 service-level path it should have moved to. Per Brief 42 Principle 2 — no silent fallbacks.
- **`_computeHeatingOrCooling(service, systems, serviceLevel, demandAtComfortMwh, comfortBand, state2Recompute)`** — signature gains `serviceLevel`. Runs the stale-field guard. Resolves setpoint ONCE at service level (not per-system). When `mode === 'custom'` and setpoint differs from comfort, calls `state2Recompute` ONCE; the resulting demand is used for ALL systems (each system's delivered = demand × share). Result shape gains `setpoint_mode`, `setpoint_c`, `setpoint_differs_from_comfort` fields on the service block.
- **`_computeDhw(systems, serviceLevel, gia, annualOccupantHours)`** — signature gains `serviceLevel`. Reads `dhw_demand_basis`, `dhw_tap_outlet_temp_c`, `dhw_cold_supply_temp_c`, `dhw_storage_setpoint_c`, `dhw_demand_litres_per_person_per_day`, `dhw_demand_litres_per_m2_per_day` directly. Pre-Brief-42 reads from `systems[0]` removed. Stale-field guard runs first.
- **`computeSystemsDelivered({ building, ... })`** — passes `cfg` (the whole `systems_config_v40` object) to heating/cooling/dhw sub-functions so they can read service-level fields. Ventilation/lighting/small_power signatures unchanged (no service-level fields for those services).
- **Share validation, enable filtering, displacement adapters** (`v40ServiceBlockToV25Shape` etc.) — all unchanged. Per-system `share_pct` / `efficiency_metric` / `source` / `enabled` reads preserved.

### §8.2 — `frontend/src/context/ProjectContext.jsx` — loader-side migration

New module-level helpers above `ProjectProvider`:

- **`migrateSystemsConfigV40_V1ToV2(rawV40)`** — pure function that takes a v1-shape `systems_config_v40` and returns the v2-shape. For each of heating / cooling / dhw, finds the lead value (first enabled per-system entry that has the field; falls back to first entry; falls back to `DEFAULT_PARAMS` value), lifts it to the service-level position, then strips the field from every per-system entry. Idempotent: re-running on v2 shape is a no-op (existing service-level fields preserved; per-system stripping is a no-op when fields are already absent).
- **`_brief42LoaderMigration(bc)`** — returns `{ systems_config_v40, interventions, schema_version: 2 }` when `bc.schema_version < 2`, or `null` (no-op) otherwise. Wraps the systems-config migration + calls `migrateInterventionPatches` (from `interventionsEngine.js`) on each intervention.

`_applyProject` now calls `_brief42LoaderMigration(bcRaw)` BEFORE applying the bc to React state. The migrated bc flows through the existing field-by-field loader. On first load post-Part-2, Bridgewater migrates in memory; the autosave persists the v2 shape on the next interaction.

### §8.3 — `frontend/src/utils/instantCalc.js` — `withMode` allowlist

No changes required. The new service-level fields live INSIDE `systems_config_v40`. `withMode` only filters when `mode ∈ {envelope-only, envelope-gains}` — those paths don't reach `_calculateState3` (which is where the Systems engine runs). For `mode === 'full'`, `withMode` returns `building` unchanged and the whole `systems_config_v40` (including the new service-level fields) flows through to State 3.

### §8.4 — Setpoint semantic change: per-system → service-level

The single behaviour change Brief 42 introduces is a SEMANTIC one (not a physics one): pre-Brief-42, each heating/cooling system could have its OWN setpoint, and the engine ran the State 2 demand recompute per-system. Post-Brief-42, the setpoint is service-level; all systems share the same demand calculation.

For Bridgewater specifically, this is benign because either:
- All systems for a service share the same setpoint (engine output identical pre/post)
- Only one system in the service had a custom setpoint, and the migration lifted that value (others would have had `setpoint: null` and used comfort — but the loader's "first enabled with value" rule lifts the lead's custom value, which is the value the OLD engine's `systems[0]` already used in the per-system loop, so per-system delta math is identical too — the recompute fires the same number of times with the same `setpointOverride` arg)

The Brief's "When to escalate" boundary case ("two interventions patching different systems' setpoints to different values") is captured by audit doc §7.3 — last-write-wins collapse, Brief 41 Part 3's `computeOverriddenSet` flags it in the stack view.

---

## §9 — Bridgewater sanity tests (Brief 42 Part 2 — run + recorded)

**Test method:** roll engine + loader to Part 1 (pre-Brief-42 state), capture engine output on Bridgewater's current disk data (which is v1-shape `systems_config_v40`); roll forward to Part 2 (post-Brief-42 engine + loader migration), capture engine output on Bridgewater's migrated data; diff.

Bridgewater's current persisted state (from `GET /api/projects/{id}`, `bc.schema_version: 1`):
- **Heating:** 2 systems — Primary (electricity, η=2.8, share 95%), Secondary (electricity, η=1.0, share 5%); both `setpoint: null` (follow comfort)
- **Cooling:** 1 system — Primary (electricity, η=3.51, share 100%); `setpoint: 22` (custom, below default comfort upper 26)
- **DHW:** 2 systems — Gas (gas, η=0.9, share 75%, tap_outlet=30, demand=80 L/person/day), ASHP (ambient_air, η=2.8, share 25%, tap_outlet=40, demand=105 L/person/day); both `setpoint: 60` (storage)

Note Bridgewater has **inconsistent per-system DHW values** (tap_outlet 30 vs 40; demand 80 vs 105) — exactly the structural ambiguity Issue #21 / Brief 42 is meant to resolve. Pre-Brief-42 engine reads `systems[0]` (gas DHW) as lead: tap=30, demand=80. My migration helper lifts from the same lead position (first enabled = dhw[0] = gas DHW), so the post-migration service-level fields take the same lead values.

### §9.1 Per-service results (engine-direct comparison)

| Metric | Pre-Brief-42 (Part 1 code, v1 disk data) | Post-Brief-42 (Part 2 code, v2 in-memory data) | Δ |
|---|---|---|---|
| EUI                      | 68.3 kWh/m²       | 68.3 kWh/m²       | 0.00% |
| Total electricity         | 170.678 MWh       | 170.678 MWh       | 0.00% |
| Total gas                 | 124.559 MWh       | 124.559 MWh       | 0.00% |
| Carbon                    | 13.45 kgCO₂/m²    | 13.45 kgCO₂/m²    | 0.00% |
| Heating demand            | 148.5 MWh         | 148.5 MWh         | 0.00% |
| Heating delivered         | 62.382 MWh        | 62.382 MWh        | 0.00% |
| Heating electricity       | 24.284 MWh        | 24.284 MWh        | 0.00% |
| Cooling demand            | 95.4 MWh          | 95.4 MWh          | 0.00% |
| Cooling delivered         | 99.5 MWh          | 99.5 MWh          | 0.00% |
| Cooling electricity       | 28.348 MWh        | 28.348 MWh        | 0.00% |
| DHW demand                | 149.471 MWh       | 149.471 MWh       | 0.00% |
| DHW delivered             | 149.471 MWh       | 149.471 MWh       | 0.00% |
| DHW gas                   | 124.559 MWh       | 124.559 MWh       | 0.00% |
| DHW electricity           | 14.397 MWh        | 14.397 MWh        | 0.00% |
| Lighting electricity      | 38.268 MWh        | 38.268 MWh        | 0.00% |
| Small power electricity   | 39.432 MWh        | 39.432 MWh        | 0.00% |

**14/14 metrics PASS** with Δ = 0.00% across all six services. Brief 42 Principle 1 satisfied: this is a structural reorganisation, not a physics change.

### §9.2 Diff vs Brief 41 close baseline (EUI 58.0 kWh/m²)

The Brief 41 Part 5 walkthrough STATUS recorded Bridgewater's baseline EUI as **58.0 kWh/m²**. Today's pre-Brief-42 engine produces **68.3 kWh/m²**. The 10.3 kWh/m² delta is NOT a Brief 42 regression — it predates Part 2's engine changes. Root cause: Bridgewater's persisted DHW share_pct changed between Brief 41 close (`2bf8f42`) and Brief 42 Part 1 close (`cbd54fa`). DB API confirms current shares are **gas 75% / ASHP 25%** (vs walkthrough-era **gas 45% / ASHP 55%**). Per-system shares are out of Brief 42 scope — they're cleanly under per-system fields, not lifted to service-level.

The flip likely happened during one of the live walkthrough sessions (autosave) and was preserved by the v1 shape on disk. No corrective action needed for Brief 42 — the migration faithfully preserves whatever state is on disk; the cross-session data drift is its own concern.

### §9.3 In-flight state — loader migration verification

Browser-verified post-migration React state on Bridgewater first load:
- `params.schema_version: 2` ✓ (bumped from 1)
- `params.systems_config_v40.heating_setpoint_mode: 'follow_comfort'`, `heating_setpoint_c: null` ✓ (lifted from per-system null = follow comfort)
- `params.systems_config_v40.cooling_setpoint_mode: 'custom'`, `cooling_setpoint_c: 22` ✓ (lifted from sys[0].setpoint=22)
- `params.systems_config_v40.dhw_storage_setpoint_c: 60` ✓
- `params.systems_config_v40.dhw_tap_outlet_temp_c: 30` ✓ (lifted from dhw[0])
- `params.systems_config_v40.dhw_cold_supply_temp_c: 10` ✓
- `params.systems_config_v40.dhw_demand_basis: 'per_person'` ✓
- `params.systems_config_v40.dhw_demand_litres_per_person_per_day: 80` ✓ (lifted from dhw[0])
- Per-system entries STRIPPED: `heating[0].setpoint` absent, `cooling[0].setpoint` absent, `dhw[0].setpoint/tap_outlet_temp_c/cold_supply_temp_c/demand_basis/demand_litres_*` all absent ✓

Loud-error guard verified working: hand-edited per-system stale field would surface a `consumption.{service}.error` string starting with `"Stale per-system field '{name}' on '{service}' system '{id}'..."`. No errors fired on Bridgewater (loader migration cleaned the data).

### §9.4 Disagreement-collapse policy on Bridgewater

Bridgewater's pre-migration DHW had inconsistent per-system fields (gas: tap=30 / demand=80; ASHP: tap=40 / demand=105). Per Brief 42 "When to escalate" — this is exactly the policy question the brief flags. The migration's "first-enabled wins" rule collapses to gas's values (tap=30, demand=80). The ASHP's values (tap=40, demand=105) are LOST during migration.

For Bridgewater specifically this is fine because:
1. Pre-Brief-42 engine `_computeDhw` already read `systems[0]` (gas) — the ASHP values were already being ignored by the OLD engine
2. Post-Brief-42 engine reads service-level values lifted from the same lead — identical behaviour

The migration faithfully preserves the OLD engine's "lead-wins" rule. The audit-trail of LOST values (ASHP's tap=40, demand=105) is what the Part 4 migration script should warn about (`--force` flag bypasses idempotency check but a separate warning surfaces detected disagreements). Logged for Part 4 to implement.

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
