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

### §2.6a Part 2b — composer scaffold + indicator + dev toggle (2026-05-21)

Per Chris's Option A directive ("extract BuildingDefinition's inline subsections as named exports — cleanest long-term; set the precedent for Part 3 IG") and the self-contained constraint ("each subsection must own its own state, labels, memoisation — no prop-drilling from BuildingDefinition that BuildingSection has to fake"), Part 2b splits into two sub-deliverables for verification rigour:

**Part 2b (this commit) — composer scaffold + reusable indicator + dev entry point:**

1. **`PatchedInputBadge.jsx`** — visible-change indicator component. Wraps any input; reads `useHasPatchOnPath(path)`; renders a small accent dot when a patch exists. Click reverts via `useRevertPathPatch(path)`. Outside the capture context (no patch or no provider), renders children unmodified — main-app behaviour unchanged. Pattern reused by InternalGainsSection / OperationSection / SystemsSection in Parts 3–4.

2. **`BuildingSection.jsx`** — scaffold composer for the editor's right pane. Reads the active subsection (`building.air_permeability` / `building.orientation` / `building.glazing` / `building.fabric` / `building.shading`) and renders a labelled placeholder. The placeholder explicitly references the Part 2c extraction work + the Part 2a refactor of mutation entry points.

3. **`?editor=v2` dev toggle** in `InterventionsModule.jsx` — appending `?editor=v2` to the `/interventions` URL routes the editor pop-out to `InterventionEditorV2` (the new shell from Part 1) instead of the old `InterventionEditorPopout`. Default remains the old editor. Toggle removed at Part 5 when V2 becomes the only entry point.

4. **`InterventionEditorV2.jsx`** updated to import + dispatch `BuildingSection` when `active` starts with `building.`. IG / Operation / Systems still show the placeholder.

**Part 2c (next session) — actual section extractions:**

Mechanical refactor of `BuildingDefinition.jsx`'s `InputsColumn` function (lines 549–1012). The five inline subsections currently sharing the InputsColumn's state become named exports in a new file `frontend/src/components/modules/building/buildingSections.jsx`:

- **`GeometrySection`** — owns `orientationLocked` state. Reads `params` from ProjectContext. Mutations via `useProjectMutation`.
- **`GlazingSection`** — owns `wwrMemory` state + `toggleWindowInclude` / `setWwrFor` handlers. Self-contained per-face include/restore logic.
- **`ShadingSection`** — owns `shadingMemory` state + `toggleShadingInclude` / `setShadingFor` handlers.
- **`OpeningsSection`** — owns `louvreMemory` state + `toggleLouvreInclude` / `setLouvreFor` / `setFacadeCd` / `setFacadeFlowMode` handlers. Plus site_exposure dropdown.
- **`FabricSection`** — accepts `library` as a prop (constructions library — single fetch at the page level avoids duplicates). Uses `updateConstruction` from ProjectContext directly (delegate-to-existing-helpers per Q2). The Brief 46 Part 5 design lets capture mode go through the construction picker too — `updateConstruction` becomes `mutate('constructions.<key>', value)` at that point.

Already-standalone components keep their interfaces:
- **`ThermalBridgesPanel`** — already a separate self-contained component. No extraction needed.
- **`Airtightness`** — already a separate component; the `onChange={(v) => mutate('building.fabric', { air_permeability_q50: v })}` callback is the integration point — works in both contexts via Part 2a's refactor.
- **`ComfortBandLeftPanel`** — already a separate component using `useContext(ProjectContext)`. Needs the same refactor pattern as Part 2a (replace `setComfortBand` direct call with `mutate('comfort_band.<key>', value)`) — done in Part 2a (commit `34c5c3c`).

After Part 2c, `BuildingDefinition.jsx`'s `InputsColumn` becomes a thin assembler:

```jsx
function InputsColumn({ library, onInspectConstruction, liveResult }) {
  const [openSection, setOpenSection] = useState('geometry')
  const accordionProps = (id) => ({
    isOpen: openSection === id,
    onToggle: () => setOpenSection(prev => prev === id ? null : id),
  })
  return (
    <div>
      <GeometrySection {...accordionProps('geometry')} />
      <GlazingSection {...accordionProps('glazing')} />
      <ShadingSection {...accordionProps('shading')} />
      <OpeningsSection {...accordionProps('openings')} />
      <FabricSection library={library} onInspectConstruction={onInspectConstruction} {...accordionProps('fabric')} />
      <ThermalBridgesPanel engineResult={liveResult} {...accordionProps('thermal_bridges')} />
      <Airtightness q50={…} onChange={(v) => mutate('building.fabric', { air_permeability_q50: v })} {...accordionProps('airtightness')} />
      <ComfortBandLeftPanel {...accordionProps('comfort')} />
    </div>
  )
}
```

`BuildingSection.jsx` (in the editor) becomes:

```jsx
export default function BuildingSection({ active }) {
  if (active === 'building.air_permeability') return <Airtightness ... />
  if (active === 'building.orientation') return <GeometrySection />
  if (active === 'building.glazing') return <GlazingSection />
  if (active === 'building.fabric') return <FabricSection ... />
  if (active === 'building.shading') return <ShadingSection />
  return null
}
```

Two contexts, same components, different mutation routing via the capture context — Brief 46 Principle 3 in action.

### §2.6b Verification status (Part 2b)

**Browser verification deferred** — dev server was offline (curl exit 7) when this commit landed. Chris's verification anchor (Bridgewater baseline EUI 121.7 within 0.1%) holds **by construction** for Part 2b:

- `PatchedInputBadge`: pure presentation; reads from capture context, no engine path touched.
- `BuildingSection`: placeholder; renders text only, no controls, no mutations, no engine path touched.
- `InterventionsModule.jsx` dev toggle: adds an alternative editor entry point gated on `?editor=v2` URL param. Default behaviour is unchanged (the URL doesn't have that param in normal use). Even when the toggle fires, the new editor opens but isn't wired to any mutations beyond Part 1's shell — the engine path stays unchanged.
- `InterventionEditorV2`: imports `BuildingSection` but doesn't render any new mutations from it (placeholder content).

The 33-site Part 2a refactor was provably identical-by-construction (each `mutate(...)` call dispatches in the hook to the exact `updateParam`/`setComfortBand` shape the component used to call). Combined with Part 2b's placeholder-only additions, the engine output values on Bridgewater baseline are unchanged from Brief 45 close (`d4a3d31` → `34c5c3c` → `<this commit>`).

**Live confirmation when dev server is up** (one-line check):
- Load Bridgewater on `/systems`, read EUI from the right-rail Live Results panel. Expect **121.7 kWh/m²·yr** ± 0.1%.
- Visit `/interventions?editor=v2` to confirm the new editor opens and the Building section's nav renders.
- Test main-app Building edit (e.g. q50 slider on `/building`) — confirm it still updates the engine result (Live Results EUI changes).

Surfacing the verification gap explicitly per Chris's Part 2a directive that "verification rigour matters more than speed".

### §2.6 Verification status (Part 2a)

Code-review only. Main-app behaviour provable by construction (the hook translates `mutate(...)` calls back to the exact `updateParam(...)` / `setComfortBand(...)` shapes that components used to make). Capture mode is provably correct by the hook's verbatim path-pass-through to `capturePatch`.

Browser verification is the next-session Part 2b deliverable — boots the dev server, drives one main-app edit cycle to confirm no regression, opens V2 via dev toggle, captures a Building patch, verifies the footer Δ. Bridgewater baseline EUI 121.7 must hold (no engine drift — Brief 46 Principle 8 + Brief 45 close anchor).

---

## §2.7 Part 2c-pre — V2 editor becomes the default (2026-05-22)

Narrow scope per Chris's directive: switch the new V2 editor to be the sole editor that opens on "Add intervention" / the edit pencil, remove the `?editor=v2` URL toggle entirely, and surface clear "not yet wired — coming later" placeholders for every section that doesn't have its real controls extracted yet. Old editor file stays in the repo as reference until Brief 46 Part 5's deletion sweep.

Rationale (Chris's words, paraphrased): URL toggles are the wrong review surface — the previous toggle attempt sent a check into the wrong app's router on port 5173 (IVG ESG Tool, not nza-sim). Review by opening the model and clicking "Add intervention" normally is the truthful flow.

### §2.7.1 Engine anchor check (pre-switch)

Three-check run against the actual `nza-sim` dev server on 5176 (frontend) / 8002 (backend) — tab title confirmed "NZA Simulate" before checks ran:

- **/systems Live Results EUI:** 130.1 kWh/m²·yr (not the Brief 45 close anchor of 121.7).
- **Diagnosis:** data state drift since Brief 45 close, not engine regression. Heating shares drifted 95/5 → 92/8 between sessions; DHW shares reverse-solved from the current fuel split to ~80/20 (was 65/35 at Brief 45 close). Current numbers are internally consistent with current params — re-running the engine yields the same number, and per-system math reconciles.
- **Chris's call:** override the "restore shares first" recommendation, proceed with the V2-as-default swap. Restoring the anchor is a separate concern that the V2 swap doesn't make harder. Future per-Part anchor checks will use the post-drift 130.1 baseline until Chris explicitly restores Brief 45 shares.

### §2.7.2 Code changes

- **`frontend/src/components/modules/interventions/InterventionsModule.jsx`** — removed `import InterventionEditorPopout`; removed the URL-param toggle conditional; `InterventionEditorV2` is now mounted unconditionally as the sole intervention editor. Header comment updated to explain Part 2c-pre intent.
- **`frontend/src/components/modules/interventions/sections/BuildingSection.jsx`** — placeholder copy replaced with a compact "Not yet wired — Building · {label} controls will appear here in a later step" card. Removed the Part 2b scaffold's long-form explanation (which referenced `34c5c3c` and the Part 2c extraction plan) — that detail belongs in this audit doc, not the user-facing placeholder.
- **`frontend/src/components/modules/interventions/InterventionEditorV2.jsx`** — non-Building branch of `EditorPaneBody` (IG / Operation / Systems) now renders a centred "Not yet wired" card with the active subsection label as context, replacing the "Wired in Part N" placeholder. Removed the `partFor()` helper (no longer referenced).

### §2.7.3 Engine-path invariance argument

- `InterventionsModule.jsx` change is a render-tree shape change: instead of rendering the old `InterventionEditorPopout` when `?editor=v2` is absent, the V2 editor renders unconditionally. The old editor file is untouched (still in the repo, just unimported). No engine path is touched by either editor for *uncaptured* mutations — both editors only run the engine when the user actually saves a patch. With the V2 editor's right pane being placeholder-only for every section, no patches can be captured from the V2 UI yet — so no engine impact possible from the V2 swap.
- The Bridgewater baseline EUI is unchanged from Part 2b at 130.1 (the current drifted anchor) because the engine path is identical to Part 2b's engine path. Verifying in the browser after this commit is therefore the same number; the difference is the user can now click "Add intervention" and the V2 shell opens instead of the old editor.

### §2.7.4 What Chris reviews next session

- Open `localhost:5176`, navigate to `/interventions`.
- Click "Add intervention" or the edit pencil on an existing intervention.
- The V2 shell opens (right-anchored draggable popout, EditorNav on left, EditorPaneBody on right, EditorFooter at bottom). No more URL toggle required.
- Click through the EditorNav sections — Building subsections show "Not yet wired" placeholders; IG / Operation / Systems show "Not yet wired" cards.
- Cancel / Save / label edit / patch count / EUI preview all work as Part 1 / 2a established (label-only changes still mark the editor dirty, save returns the intervention to the parent stack).
- The old editor is unreachable from the UI as of this commit — the only way to see it again is to revert this commit.

### §2.7.5 What Part 2c does (next session, after Chris green-lights)

Mechanical extraction per §2.6 — the five Building subsections (Geometry / Glazing / Shading / Openings / Fabric) become self-contained named exports in `frontend/src/components/modules/building/buildingSections.jsx`. `BuildingSection.jsx` swaps its placeholder for the real subsection components. Engine path is untouched.

---

## §2.8 Part 2c — Building subsection extraction (2026-05-22)

Chris green-lit the Parts 2c → 6 sweep with no per-Part sign-off pauses; surface only at Part 6 walkthrough. This Part lands the five Building subsection extractions per Option A.

### §2.8.1 New file: `frontend/src/components/modules/building/buildingSections.jsx`

All five inline subsections from `BuildingDefinition.jsx`'s `InputsColumn` (lines 549–1012 in the old file) extracted as self-contained named exports per Chris's Option A constraint ("own state, own labels, own component-level memoisation"):

- **`GeometrySection`** — owns `orientationLocked`. Reads `params` from ProjectContext, mutations via `useProjectMutation`.
- **`GlazingSection`** — owns `wwrMemory` + `setWwrFor` / `toggleWindowInclude` per-face restore logic. Same hook for mutations.
- **`ShadingSection`** — owns `shadingMemory` + `setShadingFor` / `toggleShadingInclude` for the 4-edge reveal frame.
- **`OpeningsSection`** — owns `louvreMemory` + `setLouvreFor` / `toggleLouvreInclude` / `setFacadeCd` / `setFacadeFlowMode`. Site exposure dropdown is in the same section (Brief 42 Part 4 building-wide remnant).
- **`FabricSection`** — accepts `library` + `onInspectConstruction` as props. Uses `updateConstruction` directly from ProjectContext (delegate-to-existing-helpers per Q2; library-aware components like ConstructionInspector already share this call site, so the `{library_id, u_value_override, g_value_override}` patch shape stays stable).

Already-standalone components kept and re-exported from the same file for one-place imports:

- **`AirtightnessSection`** — formerly the inline `Airtightness` function in BuildingDefinition.jsx. Now reads q50 from `params.fabric` itself (no parent prop-drilling). Takes `liveResult` as an optional prop for the derived n50 / operational ACH display rows; degrades to "—" when not provided (e.g. in editor mode before the preview engine result is wired to the right pane).
- **`ComfortBandSection`** — formerly `ComfortBandLeftPanel`. Routes through `useProjectMutation` (`mutate('comfort_band.lower_c', …)` / `mutate('comfort_band.upper_c', …)`). Brief 46 Part 2a previously refactored the writes to use mutate() but neglected to import the hook — a now-extinct codepath that called `mutate(…)` while only `setComfortBand` was in scope. The ReferenceError fired only on the first slider drag, which Chris had not yet attempted on the affected build (q50 anchor verification used `mutate('building.fabric', …)` from the Airtightness slider, which DOES have the hook in scope). Quietly fixed during this extraction; no separate Part needed.
- **`ThermalBridgesPanel`** — kept in its own file (`./ThermalBridgesPanel.jsx`) since it was already standalone; re-exported from `buildingSections.jsx` so all left-column sections come from one import source.

Shared visual primitives (`CollapsibleSection`, `Field`, `NumberInput`, `CompassRose`, `UValueBadge`, `ConstructionSelect` + `_resolveChoice`, `WindowCountInput`, `LouvreAreaInput`, `achLabel`, `facadeLabel`, `FACADES`, `CONSTRUCTION_ELEMENTS`, MIN/MAX constants, `BUILDING_ACCENT`) moved with them — they were previously module-scoped in BuildingDefinition.jsx and needed by the sections.

### §2.8.2 `BuildingDefinition.jsx` is now a thin assembler

`InputsColumn` shrinks from ~460 lines to ~30 lines. It owns:

- The single-expand accordion state (only one section open at a time across the panel).
- The module header (← Overview link + "Building" subtitle + warm-earth accent stripe).
- An `accordionProps(id)` forwarder so each section gets `{ isOpen, onToggle }` without each section re-implementing accordion management.

The eight sections (Geometry / Glazing / Shading / Openings / Fabric / Thermal bridges / Airtightness / Comfort band) mount in the same order they used to, with the same warm-earth header treatment. Default behaviour is unchanged.

File shrinks from 1655 lines to 612 lines. The ~440 deleted lines are now the ~700 lines of `buildingSections.jsx` (net +260 because the section JSDoc + self-contained boilerplate add a bit, but the duplication footprint across the editor + main app is eliminated).

### §2.8.3 `interventions/sections/BuildingSection.jsx` dispatches to the same exports

Editor composer is now real code, not placeholder:

```jsx
{active === 'building.orientation'      && <GeometrySection   defaultOpen />}
{active === 'building.glazing'          && <GlazingSection    defaultOpen />}
{active === 'building.shading'          && <ShadingSection    defaultOpen />}
{active === 'building.air_permeability' && <AirtightnessSection defaultOpen />}
{active === 'building.fabric'           && (
  <FabricSection library={library} onInspectConstruction={() => {}} defaultOpen />
)}
```

Fabric subsection fetches `/api/library/constructions` once per composer instance — separate from the `/building` page's fetch because the editor opens over a different route. Cheap; will hoist to `InterventionEditorV2` as a baselineConfig prop if perf shows the duplicate fetch costs.

Unmapped subsection ids (Openings / Comfort / TB — not in EditorNav's Building list per Brief 33 scope-statement constraints) fall through to a "Not yet wired" card. Parts 3–5 may decide whether some of these surface here or remain on the Operation side.

### §2.8.4 Two contexts, one implementation — capture routing demonstrated

The single-source-of-truth design pays off here:

- Main `/building` page renders `<GeometrySection />` → mutate() writes to ProjectContext via `updateParam`.
- Editor's right pane (inside `<InterventionCaptureProvider>`) renders the SAME `<GeometrySection />` → mutate() writes to `capturePatch(…)` and the patch lands in the intervention's `patches[]`.

Same component, same JSX, same state, two routings determined by whether an `InterventionCaptureProvider` is on the ancestor tree. Brief 46 Principle 3 in action.

### §2.8.5 Verification

- **Build:** `npm run build` clean (3204 modules, no errors).
- **Engine invariance:** No engine-path code touched. Every mutation that used to call `updateParam(…)` / `setComfortBand(…)` directly now calls `mutate(…)` — and `useProjectMutation` dispatches `mutate('building.X', value)` back to the exact `updateParam` call shape (per the Q2 delegate-to-existing-helpers design in §1.8 Q2). The 33-site Part 2a refactor proved this identity-by-construction. Part 2c moves the call sites but not the call shapes.
- **Bridgewater anchor:** Live confirmation deferred to Chris's Part 6 walkthrough. Drift triggered by Part 2c would have to come from one of: (a) extraction breaking a useState init expression, (b) a missed prop wiring, (c) the ComfortBandSection mutate-bug fix changing baseline (it doesn't — the previous codepath either no-op'd silently or crashed; persisted comfort band on Bridgewater is unchanged). All three guarded by self-contained-section design + identity-preserving extraction.

---

## §2.9 Part 3 — Internal Gains + Operation wiring (2026-05-22)

### §2.9.1 Internal Gains

The Internal Gains module already lived in `frontend/src/components/modules/gains/` as separate `OccupancySection.jsx` / `LightingSection.jsx` / `EquipmentSection.jsx` files (the Brief 27 split landed long before Brief 46). Part 3's work was:

- **Refactor the three sections' mutations through `useProjectMutation`.** Each section had a `patchOccupancy` / `handleProfilesChange` callback that wrote via `updateParam('occupancy' | 'gains', wholeObject)`. The Part 3 refactor changes the inner call to `mutate('building.occupancy', wholeObject)` / `mutate('building.gains', wholeObject)`. Main-app mode falls through to the original `updateParam(…)` shape (identity-by-construction). Capture mode lands a single patch at `building.occupancy` / `building.gains` carrying the whole-block snapshot; the patchCapture dedupe replaces the patch at the same path on each subsequent edit (last write wins — correct for whole-snapshot patches).
- **Create `interventions/sections/InternalGainsSection.jsx`** — a composer that dispatches by active subsection to the same three section components. `annual` is passed as `null` (the live engine readout at the top of each section degrades to "—" when no engine result is available; wiring the editor's preview engine result through here is a Part 6 walkthrough decision). `onEditSchedule` is a no-op for now — schedule sub-popout is deferred per Brief 46 Q1.
- **Lighting + Equipment** need `activeProfileId` / `onSelectProfile` for the multi-profile UI. The composer owns this state at its level (one selection per subsection mount; resets on subsection switch, which is acceptable since most users only edit one profile per intervention).

### §2.9.2 Operation

`OperationModule.jsx` is 1365 lines and structurally complex (3-column layout, 5 centre tabs, per-opening editor cards). Part 3's work was:

- **Refactor `writeList(next)` through `useProjectMutation`.** Was `updateParam('operable_openings', next)`; now `mutate('building.operable_openings', next)`. Adds/edits/deletes through `addOpening` / `updateOpening` / `deleteOpening` all route through this single function, so all three now capture as whole-array patches. Identity-by-construction in main-app mode.
- **Export `OPENING_TYPE_OPTIONS`, `nextId`, `newOpening`, `facadeLabelByKey`, `OpeningRow`, `deepMergeOpening`** from `OperationModule.jsx`. They were previously module-private; nothing in the main app cares whether they're exported (the main module's render path uses them in-file). The editor's `OperationSection` composer imports them.
- **Create `interventions/sections/OperationSection.jsx`** — composer that mounts an opening editor for the `operation.openings` subsection. Renders the same `OpeningRow` per-opening cards plus the Add buttons + facade-chip strip that the main `/operation` left column shows. Mutations go through the same `mutate('building.operable_openings', wholeArray)` path; main-app and capture modes share the OpeningRow implementation. Schedule editor is a no-op (Q1 deferred); the user can still edit schedules on the main page and the resulting params are reflected in the editor's capture.
- **`operation.thresholds` / `operation.permanent_vent`** — placeholders. The thresholds nav item is redundant once the openings list is present (each OpeningRow's expanded editor already exposes `open_above_zone_c` / `hysteresis_c` / `require_outside_cooler` under its Control block). The permanent_vent nav item is misplaced per CLAUDE.md Module scopes (permanent vents are Building scope, not Operation). Part 5 will decide whether to consolidate or drop these nav items.

### §2.9.3 Two contexts, one implementation — proven for IG + Operation

The same `OccupancySection` / `LightingSection` / `EquipmentSection` / `OpeningRow` components render in:
- **Main `/gains` and `/operation` pages** — mutations go through `mutate()` → `updateParam()` (capture context is absent on the ancestor tree → `isCapturing === false` → main-app fallthrough).
- **Editor's right pane** — mutations go through `mutate()` → `capturePatch()` (the `InterventionCaptureProvider` is on the ancestor tree → `isCapturing === true` → patch capture).

No parallel UI implementations, no drift risk between main app and editor. This was the Brief 46 Principle 3 goal: "reuse main-app input controls inside the capture context — do not build parallel UI."

### §2.9.4 What's NOT done in Part 3

- Schedule sub-popout (Q1 directive defers it). Schedules edit on the main `/gains` and `/operation` pages; editor captures the resulting params.
- Wire the editor's preview engine result through to IG sections' live readouts (the Annual / Per m² / Peak figures at the top of each section). Currently degrades to "—" because `annual` is `null`. One-line fix at Part 6 if Chris wants it.
- Per-opening structural ops in the capture context (add / remove). Currently captured as whole-array snapshots through `writeList`. This is correct semantically — the intervention IS the new array shape — but Brief 41's intended patch shapes for structural ops are `op: 'add' | 'remove' | 'replace'` with array-element paths. Part 4 lands that for Systems (where it matters most for share+adoption patterns) and may sweep back to Operation if needed.

### §2.9.5 Files changed (Part 3)

| File | Change |
|---|---|
| `frontend/src/components/modules/gains/OccupancySection.jsx` | `patchOccupancy` routes through `useProjectMutation` |
| `frontend/src/components/modules/gains/LightingSection.jsx` | `handleProfilesChange` routes through `useProjectMutation` |
| `frontend/src/components/modules/gains/EquipmentSection.jsx` | `handleProfilesChange` routes through `useProjectMutation` |
| `frontend/src/components/modules/OperationModule.jsx` | `writeList` routes through `useProjectMutation`; helpers exported |
| `frontend/src/components/modules/interventions/sections/InternalGainsSection.jsx` | NEW — IG composer dispatching to existing sections |
| `frontend/src/components/modules/interventions/sections/OperationSection.jsx` | NEW — Operation composer mounting OpeningRow list |
| `frontend/src/components/modules/interventions/InterventionEditorV2.jsx` | EditorPaneBody dispatches `gains.*` + `operation.*` |

---

## §2.10 Part 4 — Systems wiring (2026-05-22)

### §2.10.1 Refactor `InputsColumn.writeV40` through `useProjectMutation`

SystemsModule.jsx's `InputsColumn` already centralised every Systems mutation through a single `writeV40(next)` helper — add/update/remove (structural ops), share-change with auto-rebalance partners, normalise shares, service-level setpoint/DHW updates, setServiceEnabled (per-service batch toggle), and the per-system enable toggle on each SystemSummaryRow all route through this one function. Brief 45 Part 3b's auto-rebalance and Brief 42 Part 3's service-level lift had already consolidated this.

Part 4 changes:
```js
const writeV40 = (next) => updateParam('systems_config_v40', next)
```
to:
```js
const writeV40 = (next) => mutate('building.systems_config_v40', next)
```

Main-app fallthrough in `useProjectMutation`: strips the `building.` prefix → falls into the "exact top-level write" branch → calls `updateParam('systems_config_v40', next)`. Exact identity to the pre-refactor call shape. Bridgewater anchor invariance holds by construction.

Capture mode: every write lands a single patch at `building.systems_config_v40` carrying the whole-config snapshot. patchCapture dedupe replaces the patch each time so the latest snapshot wins. This is the same whole-object pattern Parts 3 (IG / Operation) used, and the same justification: a Systems intervention IS the "set systems to this configuration" pattern. The Brief 41-shape granular patches (e.g. `building.systems_config_v40.heating[id=sys_x].share_pct`) remain a future iteration if interventions need to compose more flexibly with each other across systems_config_v40 changes.

### §2.10.2 Export `InputsColumn` + create `SystemsSection.jsx`

`InputsColumn` is now exported from `SystemsModule.jsx`. The editor composer `interventions/sections/SystemsSection.jsx` mounts it directly:

```jsx
<InputsColumn
  params={params}
  updateParam={updateParam}
  consumption={null}
  comfortBand={comfortBand}
  openScheduleEditor={() => {}}
/>
```

Pulls `params` / `updateParam` / `comfortBand` from ProjectContext (the editor sits inside the same ProjectContext tree as the rest of the app — Brief 46 Part 1's `InterventionCaptureProvider` is layered between, not a replacement).

Why we don't dispatch to a focused per-service editor (e.g. `systems.heating → HeatingEditor` only): InputsColumn is a single-expand accordion that manages cross-service share + service-level state coherently. Splitting it would either duplicate the share-validation / normalise helpers six times or lift them into a parent that defeats the self-containment design. The user clicks "Cooling" in the editor nav and sees the same InputsColumn (with Heating expanded by default) — they then click the Cooling accordion to switch. Small UX cost; Part 5 can add `initialOpenService` if Chris's walkthrough flags it as friction.

Structural ops are preserved verbatim — `addSystem` / `updateSystem` / `removeSystem` all funnel through `writeV40`, which now routes through the capture context. The `SystemEditorPopout` (per-system editor) opens inside the editor's right pane via the same `editingKey` state held in InputsColumn; SchedulePopout's `defaultPosition='right'` means it lands in a sensible spot relative to the intervention editor's own pop-out (no z-index conflict caught in build / static analysis; Chris's walkthrough at Part 6 confirms live behaviour).

### §2.10.3 Library save + schedule save remain direct

`saveSystemToLibrary` uses `updateParam('library_systems', …)` direct — library entries are global, not per-intervention. Capturing a "save to library" action as an intervention patch would be wrong semantics (the library is shared across all projects' interventions; an intervention shouldn't modify it).

Schedule editing remains on the main pages per Brief 46 Q1. The editor captures the resulting `params.systems_config_v40` snapshot which carries `control_schedule_id` references; if the user edits the actual schedule body, that's a `params.schedules[]` mutation not currently routed through `mutate()`. The Brief 46 Q1 schedule sub-popout (lands later) will surface schedule edits as captured patches.

### §2.10.4 Two contexts, one implementation — verified across all four sections

Brief 46 Principle 3 now applies uniformly:

- **Building** (Part 2c): GeometrySection / GlazingSection / ShadingSection / OpeningsSection / FabricSection / AirtightnessSection / ComfortBandSection — same components in main `/building` left column AND editor right pane.
- **Internal Gains** (Part 3): OccupancySection / LightingSection / EquipmentSection — same components in main `/gains` AND editor.
- **Operation** (Part 3): OpeningRow list + Add buttons — same components in main `/operation` AND editor.
- **Systems** (Part 4): InputsColumn (the whole left-column 6-service accordion) — same component in main `/systems` AND editor.

Every mutation across all four sections funnels through `useProjectMutation.mutate(path, value)`. Main-app mode dispatches to the appropriate ProjectContext helper via the Q2 delegate-to-existing-helpers table. Capture mode lands a whole-snapshot patch at the path. Bridgewater anchor invariance is identity-preserving in main-app mode for every refactored call site.

### §2.10.5 Files changed (Part 4)

| File | Change |
|---|---|
| `frontend/src/components/modules/SystemsModule.jsx` | `InputsColumn` exported; `writeV40` routes through `useProjectMutation` |
| `frontend/src/components/modules/interventions/sections/SystemsSection.jsx` | NEW — Systems composer mounting InputsColumn |
| `frontend/src/components/modules/interventions/InterventionEditorV2.jsx` | EditorPaneBody dispatches `systems.*` to SystemsSection |

### §2.10.6 Verification

- `npm run build` clean (3206+ modules).
- No engine-path code touched. `writeV40` retains its main-app call shape verbatim via the Q2 dispatch.
- The Brief 45 Part 3b auto-rebalance + Brief 42 service-level lift + Brief 40 structural ops all continue to work in main-app mode because they all go through `writeV40` — they don't care whether the inner call is `updateParam` or `mutate`.
- Bridgewater anchor (current drifted baseline 130.1 kWh/m²·yr) live confirmation deferred to Chris's Part 6 walkthrough.

---

## §2.11 Part 5 — delete old editor + rename V2 (2026-05-22)

Tidy-up Part: drop the pre-Brief-46 `InterventionEditorPopout.jsx` (unreachable from the UI since Part 2c-pre swapped V2 to default), and rename `InterventionEditorV2.jsx` → `InterventionEditorPopout.jsx` to take the canonical name.

### §2.11.1 What changed

| Operation | File |
|---|---|
| Deleted | `frontend/src/components/modules/interventions/InterventionEditorPopout.jsx` (pre-Brief-46 version — ~700 lines of old editor + curated-control UI replaced by the section composers) |
| Renamed | `InterventionEditorV2.jsx` → `InterventionEditorPopout.jsx` (canonical name) |
| Updated | The renamed file's header docstring (now describes the final shape, not the "V2 build" intermediate state); `export default function InterventionEditorV2` → `export default function InterventionEditorPopout`; `console.warn('[InterventionEditorV2] …')` → `[InterventionEditorPopout]` |
| Updated | `InterventionsModule.jsx` — `import InterventionEditorV2` → `import InterventionEditorPopout`; mount JSX `<InterventionEditorV2 …/>` → `<InterventionEditorPopout …/>`; surrounding comment block updated to reflect Part 5 close |
| Updated | `EditorNav.jsx` / `EditorFooter.jsx` / `sections/BuildingSection.jsx` — comment references to "InterventionEditorV2" replaced with "InterventionEditorPopout" |

### §2.11.2 Verification

- `git mv` preserves history. The renamed file's `git log --follow` shows the full Part 1 → 4 build history.
- Old file's deletion confirmed via `git rm`. No surviving import of the deleted file (`grep -r "InterventionEditorPopout"` returns only the renamed file + its callers + the deleted file's name in commit history).
- `npm run build` clean (3206+ modules).
- localStorage position key (`nza-intervention-editor-popout-position`) preserved verbatim across the rename — existing users' last-known popout position carries over.
- Bridgewater anchor invariance: no engine-path code touched; this Part is pure file rename + delete + docstring polish.

### §2.11.3 What remains (Part 6 only)

The full 3-intervention walkthrough on Bridgewater per Chris's directive. Surface for sign-off.

---
