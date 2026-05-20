# Brief 41 — Interventions Module

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott
**Status:** Active. Multi-Part build brief.
**Date opened:** 2026-05-20
**Target outcome:** NZA-Sim has a working Interventions module. The user can create, stack, toggle, reorder, and compare interventions against a single baseline (`building_config`). Each intervention is a declarative patch list. The engine runs the cumulative state for each intervention in the stack. Every input change produces a predictable, visible change in the comparison view — that's the verification discipline.

After this brief lands: Chris can open NZA-Sim, build a baseline, then layer interventions (fabric upgrade, plant replacement, demand reduction) on top, see the marginal and cumulative impact of each, reorder them to observe order-dependence, and toggle individual interventions on/off to test what-ifs.

---

## BEFORE DOING ANYTHING

1. Read this entire brief.
2. Read CLAUDE.md end to end. Particularly Rule 14 (envelope parity — unlikely to fire here), Module Scopes section (this brief adds a new Interventions module scope), Process Rules 7 (documentation hygiene), 10 (scope statement), 11 (stop dev server before migrations).
3. Read STATUS.md as currently on disk; confirm last entry is Brief 40 close. **Brief 40 must be archived before Brief 41 begins.** Note: Part 5c (originally planned pop-out refactor + lighting/small-power source-of-truth fix) was skipped after Section C walkthrough verified the current section-list UX works cleanly. The pop-out pattern from Brief 37 remains available to reuse; the lighting/small-power source-of-truth issue is logged for future cleanup but doesn't block this brief.
4. Read the Notion design note: **NZA-Sim — Interventions module: architecture design note** (URL: https://www.notion.so/365d645e05cc81b79160e49029d2158c). This is the canonical reference. The brief implements what the design note specifies; if there's any disagreement, the design note wins.
5. Read `docs/audit/40_systems_library_schema.md` for the established schema patterns. The intervention patch shape mirrors the per-system enable pattern from Brief 40 Part 5b.
6. Read the existing `frontend/src/components/modules/interventions/` or `scenarios/` directory contents (whichever exists). **Do not preserve any code from there** — see §C "Delete on sight" below — but read it briefly to identify what files exist, what routes them, and what `ProjectContext` keys they touch, so Part 1 can clean up cleanly.
7. Confirm working tree clean: `git status --short`.
8. Confirm `origin/main == local main`.
9. Do not begin Part 1 until all eight checks pass.

---

## Scope statement

This brief introduces a new **Interventions module** to NZA-Sim. Per CLAUDE.md Module Scopes pattern, the Interventions module:

**Computes:**
- The cumulative engine state for each enabled intervention in the user's stack, in order
- The marginal delta of each intervention (this intervention's contribution on top of everything above it)
- The cumulative delta from baseline (sum of all enabled interventions' marginals)
- The patches that compose each intervention (Type 1 field changes, Type 2 array add/remove, Type 3 array replace)

**Does not contain:**
- Envelope physics (Building owns this)
- Internal gain definitions (Internal Gains owns this)
- System definitions (Systems owns this — interventions patch these, but the canonical shape lives in Systems)
- Cost / payback / ROI (Roadmap module will own this; Brief 41 leaves a `capex_gbp` field on each intervention that the Roadmap module can read later)
- Library items (existing library patterns from Brief 37 and Brief 40 own these; interventions reference library items by ID)

The Interventions module touches `ProjectContext` to add an `interventions` array as a sibling of `building_config`. It does not modify `building_config` itself — interventions are non-destructive patches.

This brief delivers six substantive Parts plus close.

---

## Operational mode — keep ploughing through

Per Chris's authorisation: this brief runs end-to-end without phase-by-phase sign-off pauses. Authorisation granted up-front for all Parts. Walkthrough sign-off after Part 5 before Part 6 close, per the established pattern (Briefs 36, 39, 40, 41a, 42).

Stop and escalate only for the conditions in "When to escalate" below. Final report at end of Part 6.

---

## Principles

1. **Pattern Y — declarative patches, not branched states.** Each intervention is a named, ordered, toggleable list of patches. Baseline (`building_config`) stays untouched. Engine runs cumulative state per intervention in the stack. Per Notion design note §1 and §2.

2. **Delete the existing interventions/scenarios module on sight.** No audit. No salvage attempt. The audit pattern made sense for engine work (Audit 39 → Brief 39) because there was physics underneath worth understanding. There is no equivalent here. Per Notion design note §9.

3. **Visualisation as verification.** Every change to an input must produce a predictable, visible change in a specific output. The brief specifies the expected visual response for each intervention type (see §V "Visualisation verification matrix" below). If the visual doesn't match the prediction, investigate from physics before continuing. Per Notion design note §10.

4. **Path-addressed patches with schema-version stamps.** Every patch records the schema version it was authored against. Future methodology changes (e.g. new infiltration model, dynamic simulation, DHW changes) require a patch-migration function alongside the schema migration — same commit, same Process Rule 7 discipline. Per Notion design note §7 (schema-flexibility discipline).

5. **No pre-assumed numerical targets.** Per Brief 33 Principle 1. When interventions land, the resulting deltas are what the engine produces. Verify against hand calc where possible, but never calibrate to a target.

6. **Reuse existing patterns, don't invent new ones.** The pop-out editor reuses Brief 37's `SchedulePopout` pattern. The library save/load reuses Brief 37 + Brief 40 patterns with a new `'interventions'` namespace. The summary list / detail pop-out shape reuses Part 5c's Systems pattern. The comparison view reuses the existing Sankey, heat balance bars, and KPI strip components.

7. **Browser verification is mandatory.** Per Brief 40 Part 5b's lesson — code-side reasoning is insufficient. Boot the dev server, load Bridgewater, click the things, document the results. Browser MCP required for Section V.

8. **Documentation hygiene per Process Rule 7.** Each Part's commit includes STATUS.md + audit-doc update. Brief file folded into `docs/briefs/active/` in Part 1's commit.

---

## Parts

### Part 1 — Demolition + data model + schema documentation

**Goal:** Delete the existing interventions/scenarios module entirely. Define the intervention data model. Capture the schema and patch shapes in a new audit doc. Fold the brief into active. No engine code yet — Part 1 lays the foundations on disk.

**Files touched:**
- `frontend/src/components/modules/interventions/` OR `frontend/src/components/modules/scenarios/` — **DELETED entirely** (whichever exists; grep for both)
- Sidebar entry / routing for the old module — **REMOVED**
- Any `ProjectContext` fields specific to the old module — **REMOVED** (with a one-line migration that drops these from existing project files on load; data was UI-only, no engine impact)
- `frontend/src/context/ProjectContext.jsx` — `DEFAULT_PARAMS` gains `interventions: []` and `schema_version: <current>`
- `docs/audit/41_interventions_schema.md` (new) — canonical schema reference
- `CLAUDE.md` — new "Interventions module" entry in Module Scopes section
- `docs/briefs/active/41_interventions_module.md` — this brief file
- `docs/briefs/current.md` — pointer updated

**Steps:**

1.1 **Identify the old module.** `grep -r "interventions\|scenarios" frontend/src/components/modules/` to locate the existing module directory. List every file. Identify sidebar entries, routing imports, and `ProjectContext` keys used.

1.2 **Delete on sight.** Remove the entire module directory. Remove sidebar entry. Remove routing imports. Remove any `ProjectContext` keys it touched, with a one-line migration on project load that drops these keys cleanly. No salvage. Per Principle 2.

1.3 **Define the intervention data model** in `docs/audit/41_interventions_schema.md`:

```javascript
// Top-level project addition
project: {
  ...,
  building_config: { ... },          // unchanged baseline
  interventions: [                   // NEW — ordered list
    {
      id: 'int_<uuid>',              // stable UUID
      label: string,                 // user-facing name
      notes: string,                 // optional free text
      enabled: boolean,              // default true; toggleable
      theme: string | null,          // optional grouping ("Ventilation", "Fabric", "Plant", etc.)
      capex_gbp: number | null,      // future Roadmap input
      schema_version: number,        // version of building_config schema this was authored against
      patches: [ Patch, ... ]
    }
  ],
  schema_version: number             // current building_config schema version
}
```

```javascript
// Patch shape
Patch = {
  id: 'patch_<uuid>',
  op: 'set' | 'add' | 'remove' | 'replace',
  path: string,                      // JSON-pointer-style path into building_config
  // op-specific fields:
  value?: any,                       // for 'set', 'add', 'replace' — inline OR { library_ref: 'lib_id' }
  match?: { id: string } | { ... },  // for 'remove', 'replace' — identifies which array entry
  source?: 'library' | 'inline',     // declared at creation; affects how 'value' is interpreted
  notes?: string                     // optional free text on this specific patch
}
```

1.4 **Document patch operations:**

- **`set`** — sets the value at `path`. Used for Type 1 field changes (wall U, setpoint, ACH).
- **`add`** — appends `value` to the array at `path`. Used for Type 2 additions (new MVHR system, new opening).
- **`remove`** — removes the array entry matching `match` from the array at `path`. Used for Type 2 removals (delete gas boiler).
- **`replace`** — replaces the array entry matching `match` with `value` in the array at `path`. Used for Type 3 (swap boiler for heat pump). Equivalent to `remove` + `add` but kept as a single op for clarity.

1.5 **Document path conventions:**

Path uses dot notation with `[index]` or `[id=value]` for array addressing:
- `building_config.constructions.wall.u_value`
- `building_config.systems_config_v40.heating[id=gas_boiler_1].enabled`
- `building_config.operable_openings[id=front_door].cd_override`
- `building_config.internal_gains.lighting.load_w_per_m2`

The `[id=value]` form is preferred over `[index]` for array members that have stable IDs (systems, openings, schedules) because reordering doesn't break the patch.

1.6 **Document the patch-application algorithm:**

```
function applyPatch(config, patch):
  switch patch.op:
    case 'set':
      navigateTo(config, patch.path) = resolveValue(patch.value, patch.source)
    case 'add':
      navigateTo(config, patch.path).push(resolveValue(patch.value, patch.source))
    case 'remove':
      array = navigateTo(config, patch.path)
      array.removeWhere(entry => match(entry, patch.match))
    case 'replace':
      array = navigateTo(config, patch.path)
      index = array.findIndex(entry => match(entry, patch.match))
      array[index] = resolveValue(patch.value, patch.source)

function resolveValue(value, source):
  if source === 'library':
    return libraryLookup(value.library_ref)
  return value
```

1.7 **Document the schema-flexibility discipline:**

Every patch records `schema_version`. The project file records `schema_version` (its current overall version). On project load:

- If `project.schema_version < current_schema_version`, run schema migrations in order.
- Each schema migration that touches paths reachable by patches must also provide a **patch-migration function** that updates patches authored against the older schema.
- Patch-migration takes an old patch and returns either an updated patch (path renamed, value transformed) or a marker `{ deprecated: true, reason: '...' }` that the UI surfaces.

This protects the case Chris flagged: "if we change the base code or methodology, the interventions module must catch up." Per Notion design note §7 schema-flexibility discipline.

1.8 **Add `interventions: []` and `schema_version` to `DEFAULT_PARAMS`** in `ProjectContext.jsx`.

1.8a **Theme field — data model only.** The intervention schema includes an optional `theme: string | null` field. Per Notion design note §10a "Grouping interventions under themes," Brief 41 lands the data model field but **does not build theme-grouped UI**. The stack view in Part 3 ignores `theme` (renders all interventions in author order). Brief 42 (future) adds the theme-grouped UI. Adding the field now is free; adding it later would require a migration.

1.9 **CLAUDE.md Module Scopes — add Interventions section:**

```markdown
### Interventions module — scope

**Computes:**
- Cumulative engine state for each enabled intervention in the stack
- Marginal delta per intervention (contribution on top of everything above)
- Cumulative delta from baseline
- Patches composing each intervention (Type 1 field changes, Type 2 array
  add/remove, Type 3 array replace)

**Does not contain:**
- Envelope physics (Building)
- Internal gain definitions (Internal Gains)
- System definitions (Systems — interventions patch these, canonical shape lives in Systems)
- Cost / payback / ROI (Roadmap module; interventions carry capex_gbp for Roadmap to read)
- Library items (existing library patterns; interventions reference library items by ID)

Interventions module touches ProjectContext only to add an `interventions`
array as a sibling of `building_config`. Does not modify `building_config`
itself — interventions are non-destructive patches.
```

1.10 **Commit.**

**Commit message:**
```
Brief 41 Part 1: Interventions module — demolition + data model

Deleted existing interventions/scenarios module entirely (per Notion
design note §9 — no salvage). Sidebar entry, routing, ProjectContext
keys all removed with a one-line migration that drops dropped keys
on project load.

Added intervention data model to DEFAULT_PARAMS:
- interventions: [] (ordered list, sibling of building_config)
- schema_version stamped on the project

Documented schema in docs/audit/41_interventions_schema.md:
- Top-level project addition
- Patch shape (set/add/remove/replace ops)
- Path conventions (dot notation with [id=value] addressing)
- Patch-application algorithm
- Schema-flexibility discipline (patch-migration functions)

CLAUDE.md Module Scopes section gained Interventions module entry.
Brief file folded into docs/briefs/active/.

No engine code yet. Part 2 implements applyIntervention() and the
cumulative state runner.
```

STATUS.md update in same commit.

---

### Part 2 — Engine: applyIntervention + cumulative state runner

**Goal:** The engine can take an intervention (a list of patches), apply it to `building_config`, and produce a new transformed config. The intervention runner walks the stack in order, applying each enabled intervention cumulatively, and computes marginal + cumulative deltas.

**Files touched:**
- `frontend/src/utils/interventionsEngine.js` (new)
- `frontend/src/utils/instantCalc.js` — minor integration to read `interventions` and dispatch to `interventionsEngine.js`
- `docs/audit/41_interventions_schema.md` — append "Engine implementation" section

**Steps:**

2.1 **Implement `applyPatch(config, patch)`** in `interventionsEngine.js`:

- Deep-clones `config` (so the original baseline is never mutated).
- Parses `patch.path` into navigable segments (handling dot notation, `[index]`, and `[id=value]` forms).
- Resolves `patch.value` via `resolveValue(value, source)` — looks up library refs if `source === 'library'`, returns inline value otherwise.
- Executes the op (`set` / `add` / `remove` / `replace`) on the cloned config.
- Returns the cloned, modified config.
- If the path doesn't exist or the match doesn't resolve, returns the config unchanged and logs a `patch_application_error` finding (surfaces in UI).

2.2 **Implement `applyIntervention(config, intervention)`:**

```javascript
function applyIntervention(config, intervention):
  if !intervention.enabled:
    return config  // skip disabled interventions
  let result = config
  for patch in intervention.patches:
    result = applyPatch(result, patch)
  return result
```

2.3 **Implement `runInterventionStack(baseline_config, interventions)`:**

```javascript
function runInterventionStack(baseline_config, interventions):
  let states = [baseline_config]
  let configs = [baseline_config]
  for intervention in interventions:
    let next_config = applyIntervention(configs[configs.length - 1], intervention)
    configs.push(next_config)
  // Now run the engine on each config
  let results = configs.map(cfg => runEngine(cfg))
  // Compute deltas
  return {
    baseline: results[0],
    interventions: interventions.map((int, i) => ({
      id: int.id,
      result: results[i + 1],
      marginal_delta: computeDelta(results[i], results[i + 1]),
      cumulative_delta: computeDelta(results[0], results[i + 1])
    }))
  }
```

2.4 **Implement `computeDelta(from_result, to_result)`:**

Returns a structured delta object covering the headline metrics:

```javascript
{
  heating_demand_mwh: { from, to, delta_mwh, delta_pct },
  cooling_demand_mwh: { from, to, delta_mwh, delta_pct },
  eui_kwh_per_m2: { from, to, delta, delta_pct },
  fuel_split: {
    electricity_mwh: { from, to, delta_mwh, delta_pct },
    gas_mwh: { from, to, delta_mwh, delta_pct },
    ...
  },
  carbon_kgco2_per_m2: { from, to, delta, delta_pct },
  per_service: { heating: {...}, cooling: {...}, dhw: {...}, ventilation: {...}, lighting: {...}, small_power: {...} },
  per_envelope_term: { wall: {...}, roof: {...}, glazing: {...}, infiltration: {...}, permanent_vents: {...}, thermal_bridging: {...} }
}
```

These are the numbers the comparison view reads.

2.5 **Integrate with `instantCalc.js`:** When `params.interventions.length > 0`, `_calculateState3` (or the appropriate top-level entry) calls `runInterventionStack(baseline_config, params.interventions)` and attaches the result to `consumption.interventions`.

The existing Sankey / Heat Balance / Live Results continue to read baseline numbers (or "all enabled interventions applied" depending on the Interventions UI mode — see Part 3). The intervention-specific comparison view reads from `consumption.interventions`.

2.6 **Schema-version migration scaffolding.** Implement `migratePatch(patch, from_version, to_version)` as a no-op stub for now (no schema migrations exist yet). Document the function signature so future briefs that change `building_config` schema can register patch migrations.

2.7 **Sanity test** with synthetic configs:
- **Test A: Empty interventions stack.** Baseline runs unchanged; `consumption.interventions` is null or empty.
- **Test B: Single set-op patch.** Intervention: `set building_config.constructions.wall.u_value to 0.18`. Wall losses drop in the result; heating demand drops; nothing else moves materially.
- **Test C: Two interventions, second depends on first.** Intervention 1: fabric upgrade. Intervention 2: heat pump replacing gas boiler. Verify marginal of Int 2 is smaller than it would be if applied to baseline alone (less heating demand to serve).
- **Test D: Disabled intervention skipped.** Mark Int 1 as `enabled: false`. Verify Int 2's marginal is computed against baseline directly (Int 1 skipped in the stack).
- **Test E: Library-referenced patch resolves.** Patch with `source: 'library', value: { library_ref: 'EnerPHit_200mm_EPS' }`. Resolves to the library item's actual values. Verify the engine uses the resolved values.

Document all sanity tests in the audit doc.

2.8 **Commit.**

**Commit message:**
```
Brief 41 Part 2: Interventions engine — patch application + stack runner

interventionsEngine.js implements:
- applyPatch(config, patch) — deep-clones config, navigates path,
  resolves library refs, executes set/add/remove/replace ops
- applyIntervention(config, intervention) — applies all patches in
  order; skipped if intervention.enabled === false
- runInterventionStack(baseline, interventions) — walks the stack
  computing cumulative configs, runs engine on each, returns deltas
- computeDelta(from, to) — structured delta object (headline metrics
  + per-service + per-envelope-term)
- migratePatch() stub for future schema migrations

instantCalc.js _calculateState3 dispatches to runInterventionStack
when params.interventions.length > 0; result attached to
consumption.interventions.

Sanity tests A-E documented in docs/audit/41_interventions_schema.md
§"Engine implementation". All pass against synthetic configs.

No UI yet. Part 3 builds the interventions module shell.
```

STATUS.md update in same commit.

---

### Part 3 — UI: Interventions module shell + stack view

**Goal:** A new Interventions module appears in the sidebar. The module's main view shows the intervention stack (list of interventions in order, with marginal + cumulative deltas) and provides "+ Add intervention" and reorder controls.

**Files touched:**
- `frontend/src/components/modules/interventions/InterventionsModule.jsx` (new)
- `frontend/src/components/modules/interventions/InterventionStackView.jsx` (new)
- `frontend/src/components/modules/interventions/InterventionRow.jsx` (new)
- Sidebar — add Interventions entry (between Systems and Results per the design note §15 morning sequence; final placement Claude Code's call based on existing sidebar layout)
- Routing for `/interventions`

**Steps:**

3.1 **Module shell.** `InterventionsModule.jsx` is the page-level component. Header: "Interventions". Subhead: "Stack interventions against the baseline. Each intervention's effect compounds on top of the ones above it. Toggle, reorder, or click to edit."

3.2 **Stack view.** `InterventionStackView.jsx` renders the ordered list of interventions. Header row shows column labels: Label | Enabled | Marginal | Cumulative | Edit. Below the list: "+ Add intervention" button.

Top of the stack always shows a non-removable "Baseline" row with EUI, fuel split, and carbon. This anchors the user's reading of the stack.

3.3 **Intervention row.** `InterventionRow.jsx` renders one row. Shows:
- Drag handle (left edge) for reordering
- Label (clickable — opens editor pop-out)
- Enabled toggle (same on/off pattern as Brief 40 Part 5b per-system toggle — green dot when on, grey when off, body greyed when disabled but row stays clickable to re-enable)
- Marginal delta (EUI delta in kWh/m²·yr, plus % vs the row above — colour-coded green for savings, red for increases)
- Cumulative delta (EUI delta from baseline, plus %)
- Edit button → opens editor pop-out (Part 4)

3.4 **Reorder.** Drag-and-drop reorders the stack. On drop, `params.interventions` is updated and the engine reruns automatically (the existing `useMemo([params, ...])` dependency handles this). The marginals and cumulatives update.

Reordering surfaces the order-dependence Chris specifically wanted to see — per Notion design note §10 worked example "What if you reorder?"

3.5 **Disabled visual treatment.** Disabled interventions show muted/greyed-out (opacity-50). Their marginal still computes for reference (the engine still calculates "this is what the marginal would have been if enabled") but is shown in muted text. Cumulative skips them — the next enabled intervention's cumulative is computed against the previous *enabled* state.

3.6 **Override-warning indicator.** When two interventions patch the same path (e.g. both set `constructions.wall.u_value`), the lower one wins (last-write-wins per the patch-application algorithm). Detect this in the stack view: any patch whose path is also patched by a later enabled intervention gets a small warning indicator on the row, with a tooltip explaining "This patch is overridden by Intervention X." Per Notion design note §10 "Boundary condition." This prevents user confusion about why their fabric improvement appears to have no effect when a later intervention also patches wall U.

3.7 **Empty state.** When `interventions` is empty: stack view shows just the Baseline row plus a large "+ Add your first intervention" CTA. Brief inline explainer: "Interventions let you test what-if changes against the baseline without modifying the baseline itself."

3.8 **Browser verification.** Boot dev server. Load Bridgewater. Verify:
- Sidebar shows Interventions entry
- Click Interventions → empty state visible
- Click "+ Add your first intervention" → opens stub editor (full editor lands in Part 4; for now confirm the click handler fires)

**Commit message:**
```
Brief 41 Part 3: Interventions module shell + stack view

New /interventions route. Sidebar entry between Systems and Results.

InterventionStackView shows ordered list with header columns
Label | Enabled | Marginal | Cumulative | Edit. Top row is the
non-removable Baseline with EUI/fuel/carbon.

InterventionRow: drag handle, label, enable toggle (Brief 40 Part 5b
pattern), marginal delta colour-coded, cumulative delta, edit button.

Reorder by drag-and-drop triggers engine rerun and updates marginals
+ cumulatives. Disabled interventions compute marginal for reference
but skip in cumulative chain.

Empty state with explainer and CTA. Browser-verified on Bridgewater.

Editor pop-out lands in Part 4.
```

STATUS.md update in same commit.

---

### Part 4 — Editor pop-out + patch capture + live preview

**Goal:** Clicking an intervention (or "+ Add intervention") opens a draggable pop-out. Inside the pop-out, the user sees the building model and edits it as if editing the main app — but every change is captured as a patch on the intervention, not applied to the baseline. The right half of the pop-out shows the live comparison view, updating in real time as patches are added.

This is the substantial UX work. Reuses the Brief 37 / Part 5c `SchedulePopout` / system editor pop-out patterns.

**Files touched:**
- `frontend/src/components/modules/interventions/InterventionEditorPopout.jsx` (new)
- `frontend/src/components/modules/interventions/InterventionEditorBuildingView.jsx` (new) — the "edit as if in main app" left half
- `frontend/src/components/modules/interventions/InterventionEditorPreview.jsx` (new) — the live comparison right half
- `frontend/src/components/modules/interventions/PatchList.jsx` (new) — patches expressed in plain English
- `frontend/src/components/modules/interventions/patchCapture.js` (new) — the context provider that captures patches instead of mutating

**Steps:**

4.1 **Editor pop-out shell.** `InterventionEditorPopout.jsx`. Reuses Brief 37's draggable, persistent-position, non-blocking pattern. Position key: `nza-intervention-editor-popout-position`. Header: "Editing intervention: {label}" plus Drag-to-move / Esc-to-close affordances.

Two-column layout inside the pop-out:
- **Left** — Building view (the editing surface)
- **Right** — Live preview (the comparison view)

User can resize the divider between columns.

4.2 **Patch capture context.** `patchCapture.js` provides a React context that wraps the Building view inside the pop-out. When the wrapped components attempt to update `ProjectContext` (via `updateParam` or equivalent), the patch capture context intercepts:

- Reads the existing value at the path
- Records the change as a patch: `{ id, op: 'set', path, value, source: 'inline' }`
- Updates a local in-context state with the new value (so the user sees the change reflected)
- Does NOT propagate to the actual `ProjectContext` — the baseline stays untouched

Adding an array entry → captured as `op: 'add'`. Removing → `op: 'remove'`. Enabling/disabling a system → captured as a `set` patch on the `enabled` field.

4.3 **Library-aware capture.** When the user selects a library item (e.g. "Load construction from library: EnerPHit_200mm_EPS"), the patch is captured with `source: 'library', value: { library_ref: 'EnerPHit_200mm_EPS' }` rather than the resolved inline value. This preserves the live link to the library.

For inline values (user typed a number directly), `source: 'inline'`.

4.4 **Building view.** `InterventionEditorBuildingView.jsx` renders the same UI components used in the main app's modules (Building, Internal Gains, Systems, Operation). Wrapped in the patch capture context. User navigates between modules within the pop-out using a smaller version of the sidebar.

4.5 **Live preview.** `InterventionEditorPreview.jsx` is the right column. Reads the patches captured so far, computes the intervention's effect using `runInterventionStack(baseline, [thisIntervention])`, and renders:

- **Top: KPI strip** — baseline | intervention | delta (heating demand, cooling demand, EUI, fuel split, carbon)
- **Middle: Paired Sankeys** — baseline above, intervention below, same scale, changed ribbons highlighted in colour, unchanged ribbons muted grey
- **Bottom: Patch list** (`PatchList.jsx`) — patches in plain English: "Wall U-value: 0.28 → 0.18 (−36%)", "Added DHW system: Immersion at 10%", etc.

Updates in real time as each patch is captured. **This is the visualisation-as-verification discipline applied to intervention authoring** — per Notion design note §10.

4.6 **Save / Cancel.** Footer of the pop-out has:
- **Cancel** → discards captured patches, closes pop-out, intervention unchanged
- **Save** → writes captured patches into the intervention (via `updateParam('interventions', ...)` on the actual `ProjectContext`), closes pop-out, stack view refreshes

The "Add intervention" button on the stack view creates a new empty intervention with a generated UUID and opens the editor; Save commits it to the stack, Cancel discards.

4.7 **Patch editing within the editor.** The patch list isn't just read-only — user can click any individual patch to remove it (undoing that specific change), or click the value to refine it (e.g. change "U-value 0.18" to "U-value 0.15"). The Building view updates accordingly.

4.8 **Validation.** If the captured patches result in an invalid config (e.g. shares ≠ 100% in a service), the live preview shows the engine's validation error message in red, and Save is disabled until the user resolves it. Same engine-side share validation from Brief 40 Part 5b applies here.

4.9 **Browser verification of the editor.** Boot dev server. Load Bridgewater. Click "+ Add intervention". Verify pop-out opens. Inside the pop-out:
- Navigate to Systems → DHW
- Disable the gas combi system → confirm patch captured ("Disable DHW system 'gas_combi_1'")
- Change ASHP SCOP from 3.0 to 4.0 → confirm patch captured ("DHW ASHP SCOP: 3.0 → 4.0")
- Confirm live preview KPI strip updates (DHW thermal drops, electricity rises)
- Confirm patch list shows both patches
- Click Save → pop-out closes, intervention appears in the stack with computed marginal
- Verify marginal matches a hand calc (within rounding)

**Commit message:**
```
Brief 41 Part 4: Editor pop-out + patch capture + live preview

InterventionEditorPopout reuses Brief 37 SchedulePopout pattern
(draggable, persistent position, non-blocking, Esc-to-close).
Position key: nza-intervention-editor-popout-position.

Two-column layout: Building view (left) + Live preview (right).
Resizable divider.

patchCapture.js intercepts ProjectContext mutations inside the
pop-out — records each as a patch (set / add / remove / replace),
preserves library refs (source: 'library' / 'inline'), maintains
local in-context state so user sees changes.

Building view reuses existing main-app components wrapped in the
patch capture context.

Live preview computes intervention effect via runInterventionStack
on the fly. Renders KPI strip (baseline | intervention | delta),
paired Sankeys (changed ribbons highlighted), patch list in plain
English.

Patches editable inline. Engine-side validation surfaces blocking
errors; Save disabled until resolved.

Browser-verified on Bridgewater: DHW intervention captures cleanly,
preview updates in real time, save commits to stack.
```

STATUS.md update in same commit.

---

### Part 5 — Comparison view (full-page) + library save/load + reorder/toggle verification

**Goal:** A full-page comparison view shows the cumulative state of all enabled interventions vs baseline, with all five visualisation elements from the design note §8. Library save/load for interventions reuses the established library pattern. Reorder and toggle interactions across the stack are verified.

**Files touched:**
- `frontend/src/components/modules/interventions/ComparisonView.jsx` (new) — full-page baseline-vs-cumulative view
- `frontend/src/components/modules/interventions/PairedSankey.jsx` (new) — shared with editor preview
- `frontend/src/components/modules/interventions/PairedHeatBalance.jsx` (new)
- `frontend/src/components/modules/interventions/DeltaTable.jsx` (new)
- `frontend/src/context/ProjectContext.jsx` — `library_interventions` namespace added (mirrors `library_systems` / `library_schedules`)
- `frontend/src/components/modules/interventions/InterventionLibrary.jsx` (new) — Save / Load UI

**Steps:**

5.1 **Comparison view.** Full-page view accessible from a tab on the Interventions module ("Stack" / "Comparison"). Shows:

- **KPI strip** at the top — three columns: Baseline | All enabled interventions applied | Delta
- **Paired Sankeys** — baseline above, cumulative-with-all-interventions below, changed ribbons highlighted
- **Paired heat balance bars** — same shape, changed terms highlighted
- **Delta table** — one row per metric (heating demand, cooling demand, EUI, fuel split per fuel, carbon, per-service delivered) with from / to / Δ kWh / Δ %
- **Comfort-vs-setpoint summary** — if the cumulative state has any system setpoints differing from comfort, surface the diagnostic

5.2 **Per-intervention drill-down.** The Comparison view tab has a sub-selector: "Final (all enabled)" / "After Intervention 1" / "After Intervention 2" / etc. Switching shows the comparison view at that point in the stack. Default is "Final."

5.3 **Library save/load.** `InterventionLibrary.jsx` reuses the established library save/load UI from Brief 37 and Brief 40.

- **Save current intervention to library** — adds to `params.library_interventions`. User provides a label and optional notes. Saved patches preserve their `source: 'library' | 'inline'` declarations.
- **Load intervention from library** — opens a picker showing all `library_interventions`. Selecting one creates a new intervention in the stack (at the bottom) with the patches loaded.

5.4 **Reorder verification.** Browser-verify with three interventions:
- Drag Intervention 2 above Intervention 1. Engine reruns. Verify marginals change (per Notion design note §10 worked example).
- Confirm cumulative deltas update.
- Confirm the final cumulative state (all enabled) is the same regardless of order (order affects marginals but not the final result, since patches are idempotent within an intervention).

5.5 **Toggle verification.** Browser-verify:
- Toggle Intervention 1 off. Intervention 2's marginal recomputes against baseline directly (skipping Int 1).
- Toggle Int 1 back on. Marginals restore.
- Toggle all interventions off. Comparison view shows baseline = intervention = no delta.

5.6 **Browser verification — final pass on Bridgewater.** Build a real stack:
- Intervention 1: Fabric upgrade (wall U → 0.18, infiltration → 0.3 ACH, roof U → 0.15)
- Intervention 2: Plant replacement (gas combi heating → ASHP SCOP 3.2, gas DHW → ASHP DHW SCOP 2.5)
- Intervention 3: Demand reduction (lighting → daylight dimming, occupancy_rate → 0.65)

Confirm:
- Each intervention's marginal makes physical sense
- Cumulative converges to a sensible EUI
- Reordering shows different marginals but same final
- Toggling individual interventions surfaces order-dependence correctly
- Save Intervention 1 to library, delete from stack, reload from library → identical behaviour

**Commit message:**
```
Brief 41 Part 5: Comparison view + library save/load + verification

ComparisonView (full-page tab on /interventions) shows baseline vs
cumulative (all enabled). Reuses KPI strip, paired Sankeys, paired
heat balance bars, delta table.

Per-intervention drill-down via sub-selector: "After Intervention N"
shows the comparison view at that point in the stack.

library_interventions namespace added to ProjectContext (mirrors
library_systems and library_schedules from Briefs 37/40). Save/Load
UI reuses established library pattern.

Browser verification on Bridgewater:
- Three-intervention stack (fabric / plant / demand) produces
  sensible marginals and cumulative
- Reordering changes marginals, preserves final state
- Toggling individual interventions surfaces order-dependence
- Library round-trip works (save → delete → reload identical)

Awaits Chris's walkthrough sign-off before Part 6 close.
```

STATUS.md + audit doc in same commit.

---

### Part 6 — Walkthrough + close

**Goal:** Chris's walkthrough confirms the Interventions module works as intended. Brief 41 archived. STATUS.md final.

**Files touched:**
- `docs/briefs/active/41_interventions_module.md` → `docs/briefs/archive/41_interventions_module_COMPLETED.md`
- `docs/briefs/current.md`
- STATUS.md

**Walkthrough checklist Chris runs (15 items):**

1. Sidebar: Interventions entry visible, between Systems and Results
2. Empty state: clear explainer + CTA
3. Click "+ Add intervention": pop-out opens, draggable, position persists
4. Inside pop-out, navigate to Systems → DHW: same UI as main module
5. Disable gas combi DHW system: patch captured in patch list
6. Change ASHP DHW SCOP from 3.0 to 4.0: patch captured
7. Live preview right column: KPI strip shows DHW thermal drop + electricity rise
8. Live preview Sankey: DHW gas branch grey/muted; DHW electricity widened, highlighted
9. Save: pop-out closes, intervention appears in stack with marginal computed
10. Add a second intervention (fabric upgrade): captures patches across multiple modules
11. Add a third intervention (lighting daylight dimming)
12. Drag Intervention 2 above Intervention 1: stack reorders, marginals change, final cumulative unchanged
13. Toggle Intervention 1 off: Int 2's marginal recomputes against baseline; final cumulative now reflects only Int 2 + Int 3
14. Open Comparison view tab: baseline vs all-enabled side by side; per-service breakdown table
15. Save Intervention 1 to library, delete from stack, reload from library: identical behaviour

If all 15 pass cleanly → Part 6 close.
If anything anomalous → log finding in `29_open_issues.md`, diagnose, fix in follow-up commit within Part 6, re-verify.

**Final report (paste in chat after close commit):**

1. New origin/main HEAD SHA
2. Bridgewater intervention stack used in walkthrough — full description (3 interventions, patches per intervention)
3. EUI numbers: baseline, after each intervention, cumulative
4. Order-dependence test results (drag reorder, marginal change)
5. Toggle test results (disable / re-enable cycle)
6. Library round-trip confirmation
7. Any new issues logged in `29_open_issues.md`
8. Confirmation that `docs/briefs/active/` contains only Brief 30 (paused) + any subsequent active briefs
9. CLAUDE.md Module Scopes Interventions section confirmed in place

**Commit message:**
```
Brief 41 close: Interventions module live

Pattern Y declarative patches against baseline. Six-step intervention
authoring flow (Notion design note §8a) verified on Bridgewater
across fabric / plant / demand interventions.

Visualisation-as-verification discipline applied throughout — every
captured patch produced predictable visual change in live preview;
order-dependence surfaced via reorder; compounding visible via
marginal-vs-cumulative split.

Library save/load namespace 'interventions' established.
Schema-flexibility discipline in place (path-addressed patches with
version stamps; patch-migration scaffold for future schema changes).

NZA-Sim is now a complete pre-feasibility tool: build baseline, layer
interventions, see deltas. Time to use it.
```

---

## V — Visualisation verification matrix

This table is the **acceptance criteria for the engine reactivity work in Part 2 and the editor live preview in Part 4**. Claude Code must verify each row in the browser — apply the intervention type, observe the response, confirm against the prediction. Discrepancies are investigated from physics before continuing.

| # | Intervention type | Expected visible change | What should NOT change |
|---|---|---|---|
| 1 | Reduce wall U-value | External wall ribbon in Building Sankey narrows; heating demand drops | Solar gain, internal gains, cooling demand roughly unchanged |
| 2 | Reduce infiltration ACH | Infiltration ribbon narrows; heating demand drops | Conduction losses, internal gains |
| 3 | Add external shading | Solar gain ribbon narrows; cooling demand drops | Heating demand may rise slightly (less free heat); conduction unchanged |
| 4 | Add MVHR replacing MEV | Ventilation losses ribbon narrows (recovery credit); heating demand drops; ventilation electrical rises | Envelope physics unchanged |
| 5 | Reduce lighting load (Internal Gains patch) | Lighting gain ribbon narrows in Internal Gains Sankey; cooling demand drops; heating demand rises slightly | Envelope physics, occupancy gain |
| 6 | Daylight dimming (Systems patch) | Lighting electrical in Live Results drops by control_factor; Sankey lighting branch narrows on electricity side | Lighting gain in Internal Gains stays the same (still heats space at full magnitude until the load itself is reduced) |
| 7 | Change heat pump SCOP | Heating-to-electricity ribbon in Systems Sankey widens/narrows; EUI moves | Demand-side numbers, gas branch |
| 8 | Reduce occupancy density (Internal Gains patch) | People gain narrows; heating demand rises slightly; cooling demand drops; lighting+equipment gains drop if linked to occupancy; DHW drops on per-person basis | Envelope physics |
| 9 | Cooling setpoint custom 20°C (vs comfort 24°C) | Comfort-vs-setpoint diagnostic appears on cooling system card showing positive delta; EUI rises; cooling electrical rises | Heating demand, envelope physics |
| 10 | Swap gas DHW for ASHP DHW | DHW source on Systems Sankey shifts from gas to electricity; total gas drops; electricity rises; total DHW thermal unchanged | DHW demand (tap litres unchanged) |

For each row, the brief's acceptance is: applying that intervention in the editor pop-out produces the expected visible change in the live preview within the same render cycle.

If a visible change doesn't match the prediction: log a finding in `29_open_issues.md`, diagnose from physics (not from defensive patches), do not continue to the next intervention type until resolved. Per Principle 3.

---

## What MUST NOT happen in this brief

- No code changes to `sql_parser.py`, `epjson_assembler.py`, simulation API endpoints (Dynamic remains paused).
- No envelope-physics changes. Rule 14 unlikely to fire; if it does (because a patch handler somehow touches a State 2 helper), the parity rule applies.
- No salvage from the existing interventions/scenarios module. Delete entirely in Part 1.
- No invention of new visualisation primitives. Reuse existing Sankey, heat balance, KPI strip components.
- No "Save as scenario" pattern. Interventions are patches against the single baseline; no duplicate building configs.
- No calibration of intervention deltas. Per Principle 5.
- No partial commits — each Part is one commit including STATUS.md + audit-doc updates.
- No skipping browser verification on grounds of "the code looks right." Browser verification mandatory per Principle 7.
- No expanding the brief's scope to absorb new issues. Found issues go to `29_open_issues.md`; this brief stays focused.
- No premature Cost / Payback / ROI work. `capex_gbp` field is captured but Roadmap module owns the costing math.
- No premature multi-scenario / forking interventions. Option 1 only (single baseline). Multi-scenario is a possible future feature; not in scope.

---

## When to escalate

Pause and escalate to Chris ONLY if:

- The existing interventions/scenarios module's deletion turns out to break unrelated functionality (e.g. it was unexpectedly imported by a non-interventions component)
- Part 2's `applyPatch` deep-clone strategy turns out to be prohibitively slow on Bridgewater-size configs (suggests a performance optimisation needed before Part 3 can ship)
- Part 4's patch capture approach turns out to require reaching outside the `ProjectContext` boundary in ways that affect baseline mutations
- A visualisation verification row (§V) fails in a way that suggests a deeper engine bug beyond intervention scope (e.g. envelope physics produces wrong numbers under specific patches)
- The schema-flexibility discipline turns out to be unbuildable as designed (e.g. patch-migration scaffolding has structural problems)
- Brief 40 hasn't actually been archived cleanly — Brief 41 references baseline data structures from Brief 40 and needs that work properly closed
- Documentation hygiene starts slipping

Otherwise, plough through Parts 1–5, walkthrough sign-off after Part 5, Part 6 close. Final report at end.

---

## Notes for Claude Code on the discipline pattern

This brief follows the pattern that's worked for Briefs 36, 39, 40, 41a, 42:

- **Read everything before starting.** BEFORE-DOING-ANYTHING checklist is mandatory, not optional. Particularly the Notion design note — it's the canonical reference; this brief implements what the design note specifies.
- **Each Part is one commit.** Don't split a Part across multiple commits. Don't bundle Parts.
- **Audit doc updates land in the same commit as the code.** Per Process Rule 7.
- **Browser verification is mandatory.** Part 5's verification is the moment of truth. Boot the dev server, load Bridgewater, click the things, document the results. Code-side reasoning consistently underestimated this in earlier briefs.
- **If a verification row fails, the response is to log a finding, diagnose from physics, and not continue until resolved.** Never calibrate. Never defensive-patch. Per Principle 5.
- **The visualisation-as-verification matrix (§V) is the acceptance criterion.** A patch that doesn't show its effect in the live preview is indistinguishable from a patch that didn't wire through.

Standing by for authorisation to begin Part 1.
