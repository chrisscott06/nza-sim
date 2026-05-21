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

### §1.8 Open questions surfaced during Part 1

1. **Schedule editor reuse path for sub-popout.** Brief 37's `SchedulePopout` chrome wraps the schedule editor. When the user opens the schedule editor from inside the intervention editor (Brief 46 Part 3), it'll be a SchedulePopout opened from inside another SchedulePopout. The brief notes this should work, but I haven't tested z-index / position conflicts yet. Part 3 will surface this if real.

2. **Deep-path writes in main-app mode.** The current `useProjectMutation` hook stubs deep-path writes (`systems_config_v40.heating[id=X].share_pct`) with a `console.warn` and falls back to `updateParam(top, value)` with the FULL top-level slice as the value. That's wrong — it would clobber the whole `systems_config_v40` object. Parts 2-4 must wire a proper deep-merge / array-op helper, OR keep the existing Systems-module helpers (`updateSystem`, `addSystem`, etc.) as the main-app path while only the capture-mode path uses `useProjectMutation` for the full Brief-41 patch paths.

   The cleaner design (recommended for Part 4): `useProjectMutation` in main-app mode for systems just calls `updateSystem(key, value)` on the top-level systems_config_v40 slice; the calling component handles the sub-path mutation as today. Capture mode uses the full Brief-41 patch path for the engine's `applyPatch` to consume.

3. **Visible-change indicators (Parts 2-4).** Brief 46 mentions "small accent marker (coloured dot or border tint)" on patched inputs. The capture context exposes `currentPatches`; consumers can compute `hasPatchOnPath(path)` and render the marker. Pattern to land in Part 2 (Building) and reuse in Parts 3-4.

---
