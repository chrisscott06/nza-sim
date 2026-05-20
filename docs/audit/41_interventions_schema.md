# 41 — Interventions module schema

**Status:** Canonical schema reference for Brief 41 (Interventions Module).
**Authored:** 2026-05-20 (Brief 41 Part 1)
**Notion design note:** [NZA-Sim — Interventions module: architecture design note](https://www.notion.so/365d645e05cc81b79160e49029d2158c)
**Module scope:** see `CLAUDE.md` → Module scopes → Interventions module.

This doc is the single canonical reference for how interventions are
modelled, stored, and applied. The brief (`docs/briefs/active/41_interventions_module.md`)
implements what's here; future briefs that touch interventions or the
building_config schema must align with this document and the Notion
design note. If they disagree, the Notion design note wins for design
questions, this doc wins for implementation details (paths, op
semantics, migration discipline).

---

## §1 — Headline architecture

An intervention is a **declarative patch against the baseline**, not a
saved building state (Pattern Y per Notion §1–2). The baseline is
`building_config` (the existing project state). Each intervention
describes a delta. The engine runs cumulative state per intervention
in order.

```
Baseline ─► Engine run #1 ─► results_baseline
   │
   ▼ Apply intervention 1 (patches)
   │
Config_1 ─► Engine run #2 ─► results_1
   │
   ▼ Apply intervention 2 (patches)
   │
Config_2 ─► Engine run #3 ─► results_2
```

Marginal delta of intervention N = `results_N − results_{N-1}`.
Cumulative delta = `results_N − results_baseline`.

Reordering reruns the chain. Toggling an intervention off skips it
(its patches are not applied), but subsequent interventions remain in
order. Per Notion §10 worked example, reordering changes marginals
but leaves the final cumulative state unchanged because patches are
idempotent within an intervention.

---

## §2 — Top-level project addition

`DEFAULT_PARAMS` in `frontend/src/context/ProjectContext.jsx` gains
two fields. Brief 41 Part 1 adds them as siblings of the existing
building_config fields (DEFAULT_PARAMS is the project state in
NZA-Sim's architecture).

```js
// DEFAULT_PARAMS (excerpt) — Brief 41 Part 1
{
  // ... existing building_config fields (length, width, openings,
  // systems_config_v40, library_systems, etc.) ...

  // Ordered list of interventions. Each is a named bundle of patches
  // that the engine applies cumulatively. See §3 for the intervention
  // shape and §4 for the patch shape.
  interventions: [],

  // Stamps the building_config schema version that this project's
  // interventions were authored against. First stamped version is 1
  // (Brief 41). Future briefs that change building_config schema in
  // a way that breaks patch paths must increment this and register a
  // patch-migration function (§7).
  schema_version: 1,
}
```

Project loader (`_applyProject` in `ProjectContext.jsx`) reads these
with defensive fall-backs:

```js
interventions:  Array.isArray(bc.interventions) ? bc.interventions : DEFAULT_PARAMS.interventions,
schema_version: Number.isInteger(bc.schema_version) ? bc.schema_version : DEFAULT_PARAMS.schema_version,
```

Pre-Brief-41 projects load with empty interventions and the current
schema_version. No patches authored against an older schema means no
migration to run.

---

## §3 — Intervention shape

```js
{
  id:              'int_<uuid>',        // stable UUID (Part 3 generates)
  label:           string,              // user-facing name
  notes:           string,              // optional free text
  enabled:         boolean,             // default true; toggleable
  theme:           string | null,       // optional grouping; free-text
  capex_gbp:       number | null,       // Roadmap input; Brief 41 does
                                        // not consume this
  schema_version:  number,              // building_config schema version
                                        // this intervention's patches
                                        // were authored against
  patches: [ Patch, ... ]               // see §4
}
```

### `enabled`

Mirrors the Brief 40 Part 5b per-system enable pattern. Toggle without
losing config. Disabled interventions are skipped in the stack but
remain in the list (and in the persisted project).

### `theme`

Optional free-text string. Used to group interventions under a strategy
("Ventilation strategy," "Fabric package," "Phase 1," "Client wishlist").

**Data model only in Brief 41.** Theme-grouped UI is a Brief 42
follow-up. The stack view in Part 3 ignores `theme` and renders all
interventions in author order. Why land the field now: adding fields
later requires a migration; adding now is free (Notion §10a).

Per Notion §10a, themes are free-text — not enum-validated. Three
interventions with `theme = "Ventilation strategy"` (typed
identically) cluster; "Ventilation Strategy" (different case) ends up
in a separate cluster. Themes can span modules — a single theme can
contain patches against Building, Operation, and Systems.

### `capex_gbp`

Cost field for the Roadmap module. Brief 41 captures this but does
not consume it. Roadmap (existing `/roadmap` route) currently uses
its own `building_config.roadmap.interventions` nested array — that
older shape is unrelated to Brief 41 and stays untouched. Future
Roadmap work will be the place where the new top-level
`interventions[].capex_gbp` is consumed.

### `schema_version`

Stamps the schema each patch was authored against. See §7.

---

## §4 — Patch shape

```js
{
  id:    'patch_<uuid>',                // stable UUID (Part 4 generates
                                        // on patch capture)
  op:    'set' | 'add' | 'remove' | 'replace',
  path:  string,                        // see §5 for path conventions

  // op-specific fields:
  value?: any,                          // for set / add / replace —
                                        // inline value OR
                                        // { library_ref: 'lib_id' }
  match?: { id: string } | object,      // for remove / replace —
                                        // identifies which array entry

  source?: 'library' | 'inline',        // declared at creation;
                                        // controls value resolution

  notes?: string                        // optional free text on this
                                        // specific patch
}
```

### Op semantics

| Op | What it does | Used for |
|---|---|---|
| `set` | Sets the value at `path`. | Type 1 — field changes (wall U, setpoint, ACH). |
| `add` | Appends `value` to the array at `path`. | Type 2 — array additions (new system, new opening, new shading device). |
| `remove` | Removes the array entry matching `match` from the array at `path`. | Type 2 — array removals (delete a system, delete a shading device). |
| `replace` | Replaces the array entry matching `match` with `value` in the array at `path`. | Type 3 — entry replacement (swap boiler for heat pump). Semantically `remove` + `add` but kept as one op for clarity in the patch list. |

### `source`

Two kinds of patch value provenance:

- **`'library'`** — `value` is `{ library_ref: 'lib_id' }`. On patch
  application, the engine resolves `lib_id` through the library
  lookup and inlines the resulting object. Editing the library item
  later updates this patch's effect automatically (live link).
  Useful for portfolio-wide standards.

- **`'inline'`** — `value` is the literal value (number, string,
  object). One-off, doesn't update if a library item changes.
  Useful for project-specific tweaks.

Declared at patch creation in the Part 4 editor pop-out.

---

## §5 — Path conventions

Paths use **dot notation** with `[index]` or `[id=value]` for array
addressing. The root is `building_config` (the DEFAULT_PARAMS object).

```
building_config.infiltration_ach
building_config.constructions.wall.u_value
building_config.systems_config_v40.heating[id=gas_boiler_1].enabled
building_config.systems_config_v40.heating[id=gas_boiler_1].efficiency_metric
building_config.operable_openings[id=front_door].cd_override
building_config.openings.south.cd
building_config.gains.lighting.profiles[id=default_lighting].magnitude.value
```

### Array addressing — prefer `[id=value]` over `[index]`

For arrays whose entries have stable IDs (Brief 40 `systems_config_v40.*`
arrays, schedules, operable openings, profiles), use the `[id=value]`
form. Reordering the array doesn't break the patch.

`[index]` is permitted for arrays without stable IDs but is fragile;
the Part 4 editor avoids generating index-addressed patches where
an ID exists.

### Brief 41 does not introduce new paths

All paths Brief 41 patches against already exist in the
building_config schema as of Brief 40 close. The Interventions module
is a config transformer; it doesn't widen the schema.

---

## §6 — Patch-application algorithm

```
function applyPatch(config, patch):
  // Deep-clone config so the baseline is never mutated. Required for
  // the engine to compute marginal vs cumulative correctly.
  let cloned = deepClone(config)
  let resolved = resolveValue(patch.value, patch.source)

  switch patch.op:
    case 'set':
      navigateTo(cloned, patch.path) = resolved

    case 'add':
      navigateTo(cloned, patch.path).push(resolved)

    case 'remove':
      let array = navigateTo(cloned, patch.path)
      array.removeWhere(entry => match(entry, patch.match))

    case 'replace':
      let array = navigateTo(cloned, patch.path)
      let index = array.findIndex(entry => match(entry, patch.match))
      if index === -1:
        log('patch_application_error: replace match not found', patch)
        return config  // unchanged
      array[index] = resolved

  return cloned


function resolveValue(value, source):
  if source === 'library':
    return libraryLookup(value.library_ref)
  return value


function applyIntervention(config, intervention):
  if !intervention.enabled:
    return config  // skipped
  let result = config
  for patch in intervention.patches:
    result = applyPatch(result, patch)
  return result


function runInterventionStack(baseline, interventions):
  let configs = [baseline]
  for intervention in interventions:
    configs.push(applyIntervention(configs[last], intervention))
  let results = configs.map(cfg => runEngine(cfg))
  return {
    baseline: results[0],
    interventions: interventions.map((int, i) => ({
      id: int.id,
      result: results[i + 1],
      marginal_delta:   computeDelta(results[i],     results[i + 1]),
      cumulative_delta: computeDelta(results[0],     results[i + 1])
    }))
  }
```

**Boundary condition (Notion §10) — two interventions patching the
same path.** If Intervention 1 sets `wall.u_value = 0.18` and
Intervention 2 (lower in the stack) also sets it to `0.15`, the
second wins (last-write-wins). Part 3's stack view flags this with a
warning indicator on the overridden patch.

Part 2 implements this algorithm in
`frontend/src/utils/interventionsEngine.js`.

---

## §7 — Schema-flexibility discipline

Patches are **path-addressed** and **schema-version-stamped**. When
the building_config schema changes (a new infiltration model, a
renamed field, a restructured array), patches authored against the
older schema must migrate alongside the schema. Per Notion §7 and
CLAUDE.md Process Rule 7 (documentation hygiene as part of the same
commit).

### How it works

- Every intervention records `schema_version` — the version the
  patches were authored against.
- The project records `schema_version` — the current building_config
  schema version it was saved at.
- On project load, if `project.schema_version < current_schema_version`:
  1. Run schema migrations in order (existing pattern for building_config).
  2. For each schema migration that touches paths reachable by patches,
     run the corresponding **patch-migration function** over every
     intervention authored at the older version.
- A patch-migration function takes a patch and returns either:
  - An **updated patch** (path renamed, value transformed), OR
  - A **deprecated marker** `{ deprecated: true, reason: '...' }` that
    the UI surfaces on the intervention's row in Part 3's stack view.

### When does a brief need a patch migration?

A brief that changes building_config schema needs a patch migration
when it changes any path that **could be in an existing patch**.
Practical test: would a Brief 41 patch authored before this schema
change still resolve correctly?

| Schema change | Patch migration needed? |
|---|---|
| Rename a field (e.g. `infiltration_ach` → `building_envelope.infiltration_ach`) | **Yes** — path rewrite |
| Change a value's shape (e.g. number → `{value, unit}`) | **Yes** — value transform |
| Add a new optional field | No — old paths still valid |
| Delete a field | **Yes** — patches against it become deprecated |
| Restructure an array (split `systems_config_v40.heating` into two arrays) | **Yes** — path rewrite + match rewrite |

When in doubt: add the migration. Cheap to add, expensive to debug a
silently-broken intervention months later.

### Discipline boundary

Per CLAUDE.md Process Rule 7, a brief that bumps `schema_version`
**must** land the patch migration in the same commit. Not in a
follow-up. Not as a TODO. The commit is incomplete if interventions
authored at the older schema would silently break after the migration.

Part 2 implements `migratePatch(patch, from_version, to_version)` as a
no-op stub (no schema migrations exist yet). The signature is
documented so future briefs can register migrations against it.

---

## §8 — Engine integration (Brief 41 Part 2)

Part 2 implements the algorithms from §6 in
`frontend/src/utils/interventionsEngine.js` and wires them into
`frontend/src/utils/instantCalc.js` via a wrapper around the existing
top-level `calculateInstant` export.

### §8.1 — Engine module shape

`interventionsEngine.js` exports (in order of use):

| Function | Purpose |
|---|---|
| `parsePath(path)` | Tokenises a dot-notation path with `[index]` / `[id=value]` array addressing into ordered segments. |
| `navigateToParent(root, segments)` | Walks to the parent container of the leaf; returns `{container, leafKey}` for set/replace, or `{null, null}` on failure. |
| `resolveValue(value, source, libraryData)` | Library-aware value resolution. `source === 'library'` triggers `libraryLookup(value.library_ref, libraryData)`; inline values pass through. |
| `applyPatch(config, patch, libraryData)` | Deep-clones config (uses `structuredClone` with JSON fallback), parses path, resolves value, executes op (`set` / `add` / `remove` / `replace`). Returns the original config unchanged on any failure with a `patch_application_error` console warning. NEVER mutates the input. |
| `applyIntervention(config, intervention, libraryData)` | Applies every patch in order. Returns config unchanged if `intervention.enabled === false`. |
| `runInterventionStack(baselineConfig, interventions, runEngine, libraryData)` | Builds the rolling cumulative config list, runs `runEngine` on each, returns `{baseline, interventions: [{id, enabled, result, marginal_delta, cumulative_delta}, ...]}`. |
| `computeDelta(fromResult, toResult)` | Structured delta object (see §8.3). |
| `migratePatch(patch, fromVersion, toVersion)` | Schema-migration scaffolding; Part 2 stub is a no-op passthrough. |

Internal helpers: `navigateToArray`, `libraryLookup`, `deepClone`, `deltaRecord`, `pickNumber`, `_serviceDelta`, `_envelopeDelta`.

### §8.2 — Rolling-config + disabled-row semantics

The stack walks `interventions` once, maintaining a rolling cumulative
config:
- For each ENABLED intervention the rolling config advances (patches
  applied on top of the previous rolling config).
- For each DISABLED intervention the rolling config does NOT advance.
  A row is still emitted with `enabled: false`, pointing to the
  previous rolling-config index.

This produces the per-row contract from Notion §10:
- Subsequent enabled interventions compute their marginal against the
  PREVIOUS ENABLED state — disabled entries skip in the chain.
- Disabled rows have `marginal_delta` of all zeros (their result is
  identical to the previous rolling state).
- Cumulative deltas are always vs baseline (rolling index 0).

### §8.3 — `computeDelta` result shape

```
{
  // Headline
  eui_kwh_per_m2:      { from, to, delta, delta_pct } | null,
  total_delivered_mwh: { from, to, delta, delta_pct } | null,
  carbon_kgco2_per_m2: { from, to, delta, delta_pct } | null,
  // Demand-side
  heating_demand_mwh:  { from, to, delta, delta_pct } | null,
  cooling_demand_mwh:  { from, to, delta, delta_pct } | null,
  // Per-service delivered (Brief 40 / v40 + v25 engine paths)
  per_service: {
    heating:     { delivered_mwh, demand_mwh },
    cooling:     { delivered_mwh, demand_mwh },
    dhw:         { delivered_mwh, demand_mwh },
    ventilation: { delivered_mwh, demand_mwh },
    lighting:    { delivered_mwh, demand_mwh },
    small_power: { delivered_mwh, demand_mwh },
  },
  // Per-fuel
  per_fuel: { electricity_mwh, gas_mwh, oil_mwh, district_heat_mwh },
  // Per-envelope-term (Building module integrand)
  per_envelope: { wall_loss_mwh, roof_loss_mwh, ground_loss_mwh, glazing_loss_mwh,
                  infiltration_loss_mwh, permanent_vent_loss_mwh,
                  thermal_bridge_loss_mwh, solar_gain_mwh },
}
```

`pickNumber` walks a candidate-path list per metric to absorb minor
shape variation across engine paths (degree-day, envelope-only,
envelope-gains, State 3). When neither path resolves to a finite
number, the metric's record slot is `null` — the Part 5 comparison
view shows `—` rather than crashing.

### §8.4 — `instantCalc.js` wiring

The historical `calculateInstant` function body (lines 5358–6016 in
the file's Part 1 state) was renamed to a non-exported
`_calculateInstantBaseline` of identical signature. A new
`export function calculateInstant(...)` appended after that body
wraps the baseline calculator:

1. Call `_calculateInstantBaseline(...)` to compute the baseline
   result.
2. If `options._skipInterventions === true` OR `building.interventions`
   is empty/absent, return the baseline result unchanged.
3. Otherwise build the engine quartet `{building, constructions,
   systems, libraryData}` and call `runInterventionStack(...)` with a
   `runEngine` callback that re-invokes
   `_calculateInstantBaseline(...)` on the transformed config,
   carrying `weatherData`, `hourlySolar`, `scheduleProfiles`, and
   `options` (with `_skipInterventions: true` to prevent infinite
   recursion).
4. Attach the stack result to `result.consumption.interventions`
   (when `consumption` exists) or `result.interventions` (degree-day
   fallback / envelope-only / envelope-gains paths that don't
   populate consumption).

The 17 existing call sites of `calculateInstant` see no API change;
their pre-Brief-41 behaviour is preserved because all pre-Brief-41
projects load with `interventions: []` (the empty-stack guard returns
the baseline result early). The new code path runs only when the user
has authored interventions in the stack.

Per Brief 41 brief §"What MUST NOT happen": no envelope physics
changes, no Rule 14 fire (the wrapper calls existing engine entry
points, never the envelope-physics helpers directly).

---

## §9 — Sanity tests (Brief 41 Part 2 — run + recorded)

Brief 41 Part 2 ships 13 synthetic-config sanity tests, all PASS.
Tests A–E correspond to the brief's §"Test A–E" specification; the
remainder verify helpers (`parsePath`, `computeDelta`, `migratePatch`)
plus invariants (baseline-not-mutated, disabled-row contract).

Tests are runnable by importing `interventionsEngine.js` in the
browser and invoking `runInterventionStack` against synthetic
`{building, constructions, systems, libraryData}` configs with a
deterministic mock `runEngine` whose output varies based on the
config's `infiltration_ach`, `external_wall` choice, and heating
efficiency. The mock allows assertions on engine orchestration without
depending on the full instantCalc.js pipeline.

| # | Name | Expectation | Observed (mock-engine) |
|---|---|---|---|
| A | Empty stack | Returns baseline only, `interventions: []` | baseline EUI 8.94, 0 rows ✓ |
| B | Single `set` patch — `infiltration_ach: 0.5 → 0.2` | Heating demand drops; marginal Δ negative | base 38.00 → 26.00 MWh, Δ −12.00 ✓ |
| B.1 | Baseline NOT mutated | `cfg.building.infiltration_ach` still 0.5 after run | 0.5 ✓ |
| C | Order-dependence — plant after fabric vs plant alone | `|electricity Δ|` smaller after fabric (less demand to convert) | after-A −27.44, alone −33.85 ✓ |
| C.1 | Stacked cumulative monotonically improves EUI | EUI delta more negative after each step | cumul A −1.69, B −7.18 ✓ |
| D | Disabled-A → B marginal === B-against-baseline | Disabled intervention skips in chain | B-after-disabled-A −12.000 ≡ B-alone −12.000 ✓ |
| D.1 | Disabled row carries `enabled: false` | Row appears in stack with metadata | true ✓ |
| D.2 | Disabled row marginal Δ === 0 | Disabled rows produce zero-delta entries | 0 ✓ |
| E | Library ref → `add` op grows DHW array | Library-resolved object pushed; dhw count 0 → 1 | delivered_mwh 10 ✓ |
| E.1 | `resolveValue` returns library object intact | Library lookup finds entry by id | `lib_systems_immersion`, share 10 ✓ |
| — | `parsePath` id-match segment | `[id=gas_boiler_1]` parsed as `{kind:'match', key:'id', value:'gas_boiler_1'}` | 5 segments, match at idx 3 ✓ |
| — | `computeDelta` arithmetic | 100 → 75 produces Δ=−25, Δ%=−25 | exact ✓ |
| — | `migratePatch` no-op stub | `from === to` returns patch unchanged | passthrough ✓ |

**Live integration probe (against the actual instantCalc.js wrapper,
Bridgewater params via React context):** with an empty interventions
array, `result.consumption.interventions` is absent (no overhead).
Injecting a one-patch intervention (`set
building.infiltration_ach = 0.2`) attaches the slot with
`interventions[0].id === 'live_test_1'`, `enabled: true`, and a
populated `marginal_delta` / `cumulative_delta` per the §8.3 shape.
Full numeric verification against real weather happens in the Part 5
walkthrough on Bridgewater.

**Sanity test source-of-truth:** the test harness lives in the Part 2
commit message. Future briefs that change the engine contract or audit
doc §3–§7 should re-run the harness; any of the 13 invariants failing
means the schema-flexibility discipline (§7) has been violated and a
patch migration is owed.

---

## §10 — What this doc does NOT contain

- The brief's Part-by-Part build plan (that's in `docs/briefs/active/41_interventions_module.md`).
- UI specifications for the editor pop-out, stack view, or comparison view (those are in the brief's Parts 3, 4, 5).
- Cost / payback / ROI calculations (Roadmap module owns that; Brief 41 only carries `capex_gbp` as a future-Roadmap input).
- Library item shapes (each module owns its library shape; Brief 37 + Brief 40 patterns).
- The current Roadmap module's nested `building_config.roadmap.interventions` array (a separate Brief 28-IM data shape, untouched by Brief 41).
