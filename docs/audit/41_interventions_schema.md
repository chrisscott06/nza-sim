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

## §8 — Engine integration

Part 2 wires `runInterventionStack` into `instantCalc.js`. When
`params.interventions.length > 0` (and at least one is enabled), the
engine populates `consumption.interventions` with the result shape
from §6's `runInterventionStack`. Existing Sankey / Heat Balance /
Live Results read baseline numbers unchanged; the intervention-
specific comparison view (Part 5) reads from
`consumption.interventions`.

Per Brief 41 brief §"What MUST NOT happen": no envelope physics
changes, no Rule 14 fire (the engine path that runs cumulative state
calls the existing engine entry points, not the envelope-physics
helpers directly).

---

## §9 — Sanity tests (filled in Part 2)

Part 2 documents the following synthetic-config sanity tests:

- **Test A — Empty stack:** baseline runs unchanged, `consumption.interventions` empty or null.
- **Test B — Single set-op patch:** wall U → 0.18; wall losses drop; nothing else moves materially.
- **Test C — Two interventions, second depends on first:** fabric + heat pump; verify Int 2's marginal is smaller than Int 2 applied to baseline alone.
- **Test D — Disabled intervention skipped:** mark Int 1 disabled; Int 2's marginal computed against baseline directly.
- **Test E — Library-referenced patch resolves:** `source: 'library', value: { library_ref: '...' }`; verify resolved values flow into the engine.

Each test gets a verifiable pass/fail with a hand-calc or sign-of-delta
check. Documented here after Part 2 lands.

---

## §10 — What this doc does NOT contain

- The brief's Part-by-Part build plan (that's in `docs/briefs/active/41_interventions_module.md`).
- UI specifications for the editor pop-out, stack view, or comparison view (those are in the brief's Parts 3, 4, 5).
- Cost / payback / ROI calculations (Roadmap module owns that; Brief 41 only carries `capex_gbp` as a future-Roadmap input).
- Library item shapes (each module owns its library shape; Brief 37 + Brief 40 patterns).
- The current Roadmap module's nested `building_config.roadmap.interventions` array (a separate Brief 28-IM data shape, untouched by Brief 41).
