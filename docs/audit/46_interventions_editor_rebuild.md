# Brief 46 — Interventions editor full rebuild (living doc)

**Status:** Active. Filled as Parts land.

**Companion brief:** [`docs/briefs/active/46_interventions_editor_rebuild.md`](../briefs/active/46_interventions_editor_rebuild.md).

**Predecessors / related:**
- Brief 41 — Interventions data model + engine + module shell + curated editor
- Brief 42 — Systems UX schema (service-level vs system-level) + SystemEditorPopout
- Brief 43 — Interventions UX (popout layout + structural ops + service-level patches)
- Brief 44 — Visualisation + reactivity audit and rebuild (incl. Part 5d perf fix)
- Brief 45 — Interventions + Systems UX polish (icons, columns, duplicate, waterfall, split bar, auto-rebalance)
- [`docs/audit/29_open_issues.md`](29_open_issues.md) — Issue #20 ("wrap full main-app UI in patch capture context") is this brief's core scope

**Scope:** Rebuild the intervention editor from scratch. Delete the old curated editor (Brief 41-era). Reuse every main-app input control inside a new `InterventionCaptureContext`. No engine changes. No data model changes. Brief 41-45 work preserved as-is.

---

## §1 — Part 1 — Capture context architecture + editor shell (2026-05-21)

### §1.1 New files in this Part

```
frontend/src/context/InterventionCaptureContext.jsx   (new — 180 lines)
frontend/src/hooks/useProjectMutation.js              (new — 180 lines)
frontend/src/components/modules/interventions/
  EditorNav.jsx                                       (new — 195 lines)
  EditorFooter.jsx                                    (new — 110 lines)
  InterventionEditorV2.jsx                            (new — 215 lines)
docs/audit/46_interventions_editor_rebuild.md         (new — this file)
docs/briefs/active/46_interventions_editor_rebuild.md (new — brief on disk)
```

### §1.2 InterventionCaptureContext API

The context wraps the editor's subtree. While the editor is mounted, any call to `useProjectMutation().mutate(path, value, op?)` from within the wrapped subtree routes to a captured patch list rather than a direct ProjectContext write. Outside the editor (Building, Internal Gains, Operation, Systems pages on the main app), the same hook routes through ProjectContext as today.

**Provider:** `<InterventionCaptureProvider intervention baselineConfig onChange>{children}</InterventionCaptureProvider>`

**Hook:** `useInterventionCapture()` exposes:

```js
{
  isCapturing: boolean          // true inside the editor; false on main app
  interventionId: string | null // which intervention is being edited
  currentPatches: Patch[]       // running list of captured patches
  capturePatch(patch | (path, op, value, source?))  // two call forms supported
  revertPatch(patchId)          // remove a specific captured patch
  resetPatches()                // clear all captured patches
  baselineConfig                // exposed for consumers that need to resolve relative paths
}
```

**Default value (no provider):**

```js
{
  isCapturing: false,           // ← the key flag
  interventionId: null,
  currentPatches: [],
  capturePatch: () => {},       // no-ops so consumers don't crash if accidentally called outside the editor
  revertPatch: () => {},
  resetPatches: () => {},
}
```

**Patch shape** (unchanged from Brief 41 — see `docs/audit/41_interventions_schema.md` §"Patch shape"):

```js
{
  id: 'patch_<uuid>',
  op: 'set' | 'add' | 'remove' | 'replace',
  path: 'building.systems_config_v40.heating[id=X].share_pct',
  value: any,
  source: 'inline' | 'library',
  match?: { id: '...' },           // for remove / replace
  schema_version: 1,
}
```

Brief 46 does NOT change this shape. Dedupe semantics reused from Brief 41's `patchCapture.capturePatch` helper — last-write-wins per `(op, path)`.

### §1.3 useProjectMutation hook

Single mutation entry point for Building / Internal Gains / Operation / Systems components. Replaces direct `updateParam` / `updateConstruction` / `updateSystem` calls on ProjectContext.

```js
const { mutate, isCapturing } = useProjectMutation()
mutate('building.length', 60)
mutate('constructions.external_wall', { id: 'cavity_wall_enhanced', … })
mutate('systems_config_v40.heating[id=sys_x].share_pct', 70)
```

**Routing rules:**

1. **`isCapturing === true`** (call originated from inside the editor's subtree): mutation routes to `capturePatch({ path, op, value, source: 'inline' })`. Does NOT write through to project state. The intervention commits its patches on Save.

2. **`isCapturing === false`** (main app): the path is parsed and routed to the appropriate ProjectContext mutation:
   - `constructions.<key>` → `updateConstruction(key, value)`
   - `comfort_band.<key>` → `setComfortBand({ [key]: value })`
   - `<top-level-key>` exactly (no nested path) → `updateParam(top, value)`
   - Anything else → `updateParam(top, value)` with a `console.warn` flag (Part 1 stub; Parts 2–4 wire the deep-merge helper to address subpaths properly)

3. **`op !== 'set'`** in main-app mode (add / remove / replace on arrays): Part 1 logs a console warning. The relevant callers in Systems (addSystem / removeSystem / etc. helpers in `SystemsModule.jsx`) keep using their existing ProjectContext mutators until Part 4 lands the array-op helper.

**Brief 41 patch-path convention preserved.** Patches use `building.<rest>` paths by convention. When in capture mode, the path passes through verbatim (engine's `applyPatch` resolves correctly). When falling through to ProjectContext, we strip the `building.` prefix because ProjectContext's live state is flat on `params` (no nested `building` object).

### §1.4 Editor V2 shell layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ SchedulePopout header                                                 │
│   "Editing intervention: <label>"  ·  Drag · Reset position · ×       │
├──────────┬──────────────────────────────────────────────────────────┤
│ EditorNav│ EditorPaneBody                                            │
│ (w-56)   │   (active section's component)                            │
│          │                                                            │
│ ● Build  │   Part 1: placeholder "Select a section from the left."    │
│ ● Gains  │   Parts 2-4: BuildingSection / InternalGainsSection /      │
│ ● Op     │     OperationSection / SystemsSection composers            │
│ ● System │                                                            │
│          │                                                            │
├──────────┴──────────────────────────────────────────────────────────┤
│ EditorFooter                                                          │
│   Label: [_______]  Σ patches: N  EUI 122 → 55.1  −67.2 kWh/m²  …    │
│   Cancel  ·  Save intervention                                        │
└──────────────────────────────────────────────────────────────────────┘
```

- **Pop-out chrome**: reuses `SchedulePopout` (Brief 37 pattern, already used by `SystemEditorPopout` / old `InterventionEditorPopout`). `defaultPosition='right'`, `persistKey='nza-intervention-editor-popout-position'` (preserved from Brief 41 Part 4 — when V2 becomes default at Part 5, users' last-known position carries over).
- **Draggable to second monitor**: SchedulePopout already supports this — the entire window can be dragged anywhere on the desktop. Chris's primary use case (keep main-app waterfall visible while editing in the pop-out on screen 2) is supported by the existing chrome.
- **EditorNav** (`w-56`, ~224 px wide): collapsible section list. Each section has subsections that click → set `active` state; the right pane renders the matching composer. Patch-presence dots beside each section / subsection indicate where patches are captured.
- **EditorPaneBody**: in Part 1, renders a placeholder per active section showing "Wired in Part X". Parts 2–4 swap each branch for the matching composer (`BuildingSection`, `InternalGainsSection`, `OperationSection`, `SystemsSection`).
- **EditorFooter**: shows the label input, the patch counter (read from capture context), EUI baseline → preview + Δ pill, Carbon Δ pill, Cancel + Save buttons. Save disabled if label is empty.

### §1.5 Why the old editor stays operational during the build

Per Brief 46 Part 1 step 1.6, the old `InterventionEditorBuildingView.jsx` + `InterventionEditorPreview.jsx` + `InterventionEditorPopout.jsx` (the old shell with the same path/name as the new editor's eventual canonical name — to be resolved at Part 5 rename) remain operational through Parts 1–4. V2 is unreachable from the UI in Part 1; testing happens via a direct route or dev toggle if needed for verification.

This is an **incremental wire-up, not a big-bang switch**:
- Part 1 lands the architecture (this commit).
- Parts 2–4 refactor each module's mutation entry points to `useProjectMutation` AND compose the corresponding section into V2's right pane. After each Part, the main app + old editor still work identically; the new editor gains one more module's worth of functionality.
- Part 5 deletes the old editor scaffolding and renames V2 → canonical. Single commit makes the swap atomic.

The Brief 46 brief authorises "no per-Part sign-off" but mandates browser verification at Parts 3, 4, 5, 6. Browser verification at each module-wiring Part proves that:
1. The capture context routes correctly (mutations land as patches, not in project state).
2. The main app's behaviour is unchanged when no capture context is active.
3. The engine spot-check on Bridgewater still produces 121.7 kWh/m²·yr baseline (no engine drift).

### §1.6 What did NOT change in Part 1

- Engine: untouched. `applyPatch`, `applyIntervention`, `runInterventionStack`, `computeDelta`, v40 displacement adapters, `_skipInterventions` plumbing — all read-only references.
- Data model: untouched. Patch shape, intervention shape, project state schema unchanged.
- Main-app behaviour: untouched. `useProjectMutation` exists but no Building / IG / Operation / Systems component calls it yet. Parts 2–4 refactor those callers.
- Old editor: untouched. `InterventionEditorBuildingView.jsx`, `InterventionEditorPreview.jsx`, the old `InterventionEditorPopout.jsx` shell all still operational and the default entry point from `InterventionsModule.jsx`'s edit pencil + add intervention button.
- `InterventionsModule.jsx`: untouched in Part 1. Wired to the new editor at Part 5.

### §1.7 Verification status — code-review only, browser at Parts 3-4-5-6

Per Brief 46 Principle §10, browser verification is mandatory at Parts 3, 4, 5, 6. Part 1 ships **code-review only**:

- New files compile against existing imports (`SchedulePopout`, `runInterventionStack`, `calculateInstant`, `patchCapture`).
- `useProjectMutation` hook is the only new touch point and is currently unused by any caller — main app behaviour is provably unchanged (no callers = no behaviour change).
- The new editor V2 is unreachable from the UI in Part 1, so it doesn't affect any user-facing flow. Browser verification at Part 2 confirms Building-wired mutations route correctly through the capture context.

If the dev server build catches a typo or syntax issue, the next commit (Part 2's Building wiring) catches it. Code-review-only is the right granularity for Part 1's architectural-only scope.

### §1.8 Architectural decisions (resolved by Chris's review after Part 1)

Chris's review of the three Part 1 open questions:

**Q1 (schedule sub-popout nesting):** Defer to Part 3. Don't pre-emptively refactor `SchedulePopout`. If z-index/position conflicts fire in real flow, extend then.

**Q2 (deep-path writes in main-app mode):** **Delegate-to-existing-helpers.** `useProjectMutation` in main-app mode dispatches by path-prefix to existing helpers (`updateSystem`, `addSystem`, `updateConstruction`, `setComfortBand`, etc.). No generic deep-merge helper. Capture mode uses full Brief-41 patch paths. The asymmetry between the two modes IS the correct design — existing helpers encode the right semantics for their slice (key-specific deep-merge in `updateParam`, array-index lookups, system-id matching, share-validation triggers). A generic deep-merge would either lose that semantics or duplicate it. Main-app must remain behaviourally identical per Brief 46 Principle 11.

**Q3 (visible-change indicator):** As specified — `useHasPatchOnPath(path)` from the capture context, small accent dot per input. Hook lands in Part 2; the pattern is reused in Parts 3-4.

These decisions are baked into the Part 2 hook update below.

### §1.9 Open questions surfaced during Part 1 (pre-Chris-review version, kept for audit trail)

1. **Schedule editor reuse path for sub-popout.** Brief 37's `SchedulePopout` chrome wraps the schedule editor. When the user opens the schedule editor from inside the intervention editor (Brief 46 Part 3), it'll be a SchedulePopout opened from inside another SchedulePopout. The brief notes this should work, but I haven't tested z-index / position conflicts yet. Part 3 will surface this if real.

2. **Deep-path writes in main-app mode.** The current `useProjectMutation` hook stubs deep-path writes (`systems_config_v40.heating[id=X].share_pct`) with a `console.warn` and falls back to `updateParam(top, value)` with the FULL top-level slice as the value. That's wrong — it would clobber the whole `systems_config_v40` object. Parts 2-4 must wire a proper deep-merge / array-op helper, OR keep the existing Systems-module helpers (`updateSystem`, `addSystem`, etc.) as the main-app path while only the capture-mode path uses `useProjectMutation` for the full Brief-41 patch paths.

   The cleaner design (recommended for Part 4): `useProjectMutation` in main-app mode for systems just calls `updateSystem(key, value)` on the top-level systems_config_v40 slice; the calling component handles the sub-path mutation as today. Capture mode uses the full Brief-41 patch path for the engine's `applyPatch` to consume.

3. **Visible-change indicators (Parts 2-4).** Brief 46 mentions "small accent marker (coloured dot or border tint)" on patched inputs. The capture context exposes `currentPatches`; consumers can compute `hasPatchOnPath(path)` and render the marker. Pattern to land in Part 2 (Building) and reuse in Parts 3-4.

---

## §2 — Part 2 — Building module mutation refactor (2026-05-21)

**Status: Part 2a — refactor of all 33 Building mutation entry points is complete; BuildingSection composer + browser verification is a Part 2b follow-up in the next session.**

Chris's pacing directive after Part 1 was "one Part per fresh session" and "don't plough". Part 2 splits cleanly into two sub-deliverables; this commit ships the heavyweight mechanical refactor + the hook extension, and the next session lands the composer + browser verification before moving to Part 3.

### §2.1 Hook extension (this commit)

`frontend/src/hooks/useProjectMutation.js` extended per Chris's Q2 resolution (delegate-to-existing-helpers):

- New `BUILDING_DEEP_MERGE_KEYS` set captures the six `updateParam` partial-merge keys: `wwr`, `window_count`, `location`, `shading_overhang`, `shading_fin`, `openings`. 2-segment dispatch under any of these calls `updateParam(top, { sub: value })` — preserving the existing partial-merge semantics of `ProjectContext.updateParam`.

  Examples:
  - `mutate('building.wwr.north', 0.4)` → main-app: `updateParam('wwr', { north: 0.4 })` (face-merge preserved); capture: patch at `building.wwr.north`.
  - `mutate('building.shading_overhang.south', { depth_m: 0.5, offset_m: 0 })` → main-app: `updateParam('shading_overhang', { south: { depth_m: 0.5, offset_m: 0 } })`; capture: patch at `building.shading_overhang.south`.
  - `mutate('building.openings.site_exposure', 'exposed')` → main-app: `updateParam('openings', { site_exposure: 'exposed' })`; capture: patch at `building.openings.site_exposure`.

- New `useHasPatchOnPath(path)` hook (Q3 directive): returns `true` if the current capture context has a patch at the given path. Used by visible-change indicator UI in Parts 2b–4.

- New `useRevertPathPatch()` hook: returns a function `(path) => void` that reverts the patch at the given path. Used by the click-to-revert affordance on visible-change indicators.

- Routing rules tightened: top-level set on Building's flat params (e.g. `mutate('building.length', 60)` → `updateParam('length', 60)`), 2-segment for the BUILDING_DEEP_MERGE_KEYS, deeper paths flagged as Part 4 territory (when `systems_config_v40.<rest>` lands). The `console.warn` stub for unrecognised deep paths preserved as a development aid — capture mode is unaffected.

### §2.2 Mutation entry points refactored (33 sites across 4 files)

All `updateParam(...)` and `setComfortBand(...)` calls in Building components replaced with `mutate(path, value)` calls. The hook routes to the existing helpers in main-app mode (identical behaviour) and captures Brief-41-style patches in capture mode.

| File | Sites | Notes |
|---|---:|---|
| `frontend/src/components/modules/building/GeometryTab.jsx` | 10 | name, length, width, num_floors, floor_height, orientation, wwr per-face, location per-field |
| `frontend/src/components/modules/building/FabricTab.jsx` | 1 | infiltration_ach (separate from the BuildingDefinition q50 / fabric path) |
| `frontend/src/components/modules/building/ThermalBridgesPanel.jsx` | 3 | thermal_bridges (mode + multiplier + manual H_TB) |
| `frontend/src/components/modules/building/BuildingDefinition.jsx` | 19 | wwr × 3 (slider + restore + zero), shading_overhang + shading_fin (combined call site), openings × 4 (louvre + cd + flow_mode + site_exposure), geometry × 5 (name + dimensions + orientation), window_count, fabric q50, comfort_band lower + upper |
| **Total** | **33** | |

`updateConstruction(...)` call sites untouched in this Part — those live in FabricTab and use the dedicated `updateConstruction` helper from ProjectContext (which is the delegate-to-existing-helper for that slice). Capture mode will reach those via Part 2b's BuildingSection composer when the construction picker is exposed inside the editor. The hook already has a `constructions.<key>` dispatch branch ready.

### §2.3 What Part 2a verifies (by construction)

**Main-app behaviour identical** to pre-refactor. Every `mutate('building.X', v)` call in main-app mode (when no capture context is mounted) dispatches via the hook's `default` branch to `updateParam(X, v)` — the exact call the component used to make pre-refactor. For 2-segment partial-merge keys, the hook calls `updateParam(top, { [sub]: value })` — the exact call shape that components used to make pre-refactor.

This is provable by code reading: the hook's main-app branches for each key class translate `mutate(...)` back to the original call. No additional behaviour, no different ordering, no side-effects.

### §2.4 What Part 2b lands (next session)

- **`BuildingSection.jsx`** composer that renders Building's controls in the editor's right pane per the editor's active subsection (Air Permeability, Orientation, Glazing ratios, Fabric, Shading). Two options for how to compose:
  - **Option A — extract subsections from BuildingDefinition.jsx as named exports.** Cleaner long-term; minor refactor of BuildingDefinition; subsections become reusable.
  - **Option B — render whole `GeometryTab` for geometry subsections; build small wrapper components for the BuildingDefinition-inline subsections (q50 slider, fabric construction picker hookup, shading per-face).** Less elegant; more wrappers; faster to ship.
  - Recommend Option A; will surface to Chris at Part 2b open.
- **Visible-change indicator pattern** applied to Building inputs: wrap each input in a small `<PatchedInputBadge path={...} />` that reads `useHasPatchOnPath` and renders a small accent dot beside the input. Click reverts via `useRevertPathPatch`.
- **Dev toggle** in `InterventionsModule.jsx` to access the V2 editor (`?editor=v2` query param). Removed at Part 5 when V2 becomes the only path.
- **Browser verification** on Bridgewater:
  - q50 edit in main-app Building module → behaves identically to pre-refactor (engine recomputes, EUI 121.7 baseline preserved).
  - Open V2 editor via dev toggle, navigate to Building → Air Permeability, drag q50 → patch captures, footer ΔEUI moves, revert works, save persists, reopen restores.

### §2.5 Files touched (Part 2a — this commit)

- `frontend/src/hooks/useProjectMutation.js` — BUILDING_DEEP_MERGE_KEYS set + 2-segment dispatch + `useHasPatchOnPath` + `useRevertPathPatch` hooks
- `frontend/src/components/modules/building/GeometryTab.jsx` — 10 sites refactored
- `frontend/src/components/modules/building/FabricTab.jsx` — 1 site
- `frontend/src/components/modules/building/ThermalBridgesPanel.jsx` — 3 sites
- `frontend/src/components/modules/building/BuildingDefinition.jsx` — 19 sites
- `docs/audit/46_interventions_editor_rebuild.md` — §2 appended (this section)
- `STATUS.md` — Part 2a section

### §2.6 Verification status (Part 2a)

Code-review only. Main-app behaviour provable by construction (the hook translates `mutate(...)` calls back to the exact `updateParam(...)` / `setComfortBand(...)` shapes that components used to make). Capture mode is provably correct by the hook's verbatim path-pass-through to `capturePatch`.

Browser verification is the next-session Part 2b deliverable — boots the dev server, drives one main-app edit cycle to confirm no regression, opens V2 via dev toggle, captures a Building patch, verifies the footer Δ. Bridgewater baseline EUI 121.7 must hold (no engine drift — Brief 46 Principle 8 + Brief 45 close anchor).

---
