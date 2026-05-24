# Brief 46 — Inert controls diagnosis (2026-05-22)

**Status:** Read-only diagnosis. No fixes yet. Awaiting Chris's signoff on root cause before any code change.

**Reporter:** Chris (Bridgewater walkthrough at HEAD `fa69a62`).

**Symptoms:**
> "The editor renders but controls are inert. Multiple failures in Bridgewater: sliders won't move, toggles don't respond, Occupancy schedule editor won't open on click, can't delete a system, 'Add system' doesn't register the click. The controls appear but don't function."

---

## 1. Architecture recap

Brief 46 Principle 3 (Part 1 close): *"Reuse main-app input controls inside the capture context — do not build parallel UI."*

The implementation:

- Parts 2c–4 refactored every Building / IG / Operation / Systems mutation through `useProjectMutation.mutate(path, value)`.
- `useProjectMutation` checks `useInterventionCapture().isCapturing`:
  - **Main-app** (no `<InterventionCaptureProvider>` on ancestor tree): falls through to `ProjectContext.updateParam(…)` etc.
  - **Editor** (provider wraps the editor body): calls `capturePatch(…)`, which appends to `currentPatches` in the provider's local state and emits via `onChange(nextPatches)`.
- `InterventionEditorPopout` lifts `currentPatches` into local `localPatches` state, runs `runInterventionStack(baselineConfig, [editIntervention])` to compute the preview EUI, and renders the **footer** with baseline → preview deltas.

The section composers (`BuildingSection.jsx`, `InternalGainsSection.jsx`, `OperationSection.jsx`, `SystemsSection.jsx`) all sit inside `<InterventionCaptureProvider>` and mount the same components the main app uses for those modules. Each of those components reads its display state from `useContext(ProjectContext)` — i.e., **baseline `params`, NOT baseline + captured patches.**

---

## 2. Root causes

### RC-1 — Capture context captures WRITES but doesn't apply patches to READS

**This is the core failure.** The pattern works only one way.

Trace for the q50 slider in the editor's Building → Air permeability subsection:

1. `AirtightnessSection` (mounted inside `InterventionCaptureProvider`) renders.
2. `const q50 = Number(params?.fabric?.air_permeability_q50 ?? … ?? 5)` — reads BASELINE `params.fabric.air_permeability_q50` from ProjectContext. E.g. 5.0 on Bridgewater.
3. Slider renders with `value={q50}` = 5.0.
4. User drags slider → onChange → `mutate('building.fabric', { air_permeability_q50: 4.2 })`.
5. `useProjectMutation` sees `isCapturing === true` → calls `capture.capturePatch({ path: 'building.fabric', op: 'set', value: { air_permeability_q50: 4.2 } })`.
6. `currentPatches` grows by one entry. Provider's `onChange` fires → `setLocalPatches(...)` in InterventionEditorPopout → footer's preview engine re-runs → footer EUI updates.
7. **But `params.fabric.air_permeability_q50` from ProjectContext is unchanged. The slider re-renders with `value=5.0` and snaps back.**

The capture path works perfectly. The read path is decoupled. Every controlled input that reads `value={…}` from ProjectContext params and writes through `mutate(…)` has this symptom: the visible value never reflects the captured edit.

**Affected:** sliders (q50, WWR, orientation, shading reveal, comfort band, shares, setpoints, occupancy density / rate, sensible/latent W/person, etc.); toggles (per-facade Include checkboxes, system enable, batch service enable, etc.); dropdowns (site exposure, flow_mode, schedule_ref, etc.); textbox inputs (building name, system label, etc.); list views (system rows, opening rows, etc.). **In short: every editor right-pane control that uses the React controlled-input pattern.**

### RC-2 — Schedule-edit click handlers are no-ops in every editor section composer

This was a documented Q1 deferral but presents as the symptom "Occupancy schedule editor won't open on click."

Confirmed locations:

| File | Line | Handler |
|---|---|---|
| `interventions/sections/InternalGainsSection.jsx` | 67 / 78 / 91 | `onEditSchedule={() => {}}` |
| `interventions/sections/OperationSection.jsx` | 137 | `openScheduleEditor={() => {}}` |
| `interventions/sections/SystemsSection.jsx` | 81 | `openScheduleEditor={() => {}}` |

The schedule editor (UnifiedScheduleEditor + SchedulePopout) is hosted by the main `/operation`, `/systems`, and `/gains` pages — not by `InterventionEditorPopout`. The composers were given stubbed no-op callbacks because Brief 46 Part 1 Q1 explicitly deferred the schedule sub-popout to "Part 3 or later."

Per Brief 46 audit doc §2.9.4 the deferral was documented as "Schedule sub-popout (Q1 directive defers it). Schedules edit on the main `/gains` and `/operation` pages; editor captures the resulting params." But that workflow assumes the user knows to switch pages to edit schedules. In practice they click the pencil in the editor and nothing happens — the deferral surfaces as "broken control."

### RC-3 — Structural ops (add / delete system) fail downstream of RC-1

Trace for "+ Add system" in editor's Systems → Heating subsection:

1. User clicks "+ Add system" → `addSystem(service, sys)` in `InputsColumn`.
2. `addSystem` builds `nextList = [...list, fresh]` and calls `writeV40(…)`.
3. `writeV40 = (next) => mutate('building.systems_config_v40', next)` → in capture mode → `capturePatch({ path: 'building.systems_config_v40', op: 'set', value: nextList })`. Patch lands.
4. `setEditingKey(`${service}:${fresh.id}`)` fires.
5. On re-render: `getList(service)` reads from `params.systems_config_v40[service]` (BASELINE, unchanged). The new system isn't in the rendered list.
6. The "edit popout" check: `editingSystem = list[idx]` where `list.findIndex(s => s.id === fresh.id) === -1`. `editingSystem` is `null`.
7. `SystemEditorPopout` is `isOpen = !!system` → `false`. **The popout never opens.**

So "Add system doesn't register" is actually "patch is captured (footer would show delta if Heating add caused one), but the rendered list doesn't show the new system AND the per-system editor popout doesn't open because it can't find the new system in baseline params."

Identical pattern for "Delete system":

1. User clicks ✕ on a system row → `removeSystem(service, idx)` → `writeV40(filteredList)` → mutate → capturePatch.
2. Re-render: list re-reads from baseline params → system still there. **Delete didn't visually happen.**

Identical for the system enable toggle, batch service-enable, normalise shares, share slider, etc.

---

## 3. Why "two contexts, one implementation" needs a third layer

Brief 46 Principle 3 implicitly assumes a closed read-write loop:

```
                    main-app:                      editor:
    READ:    useContext(ProjectContext)      useContext(ProjectContext)
    WRITE:   mutate() → updateParam()        mutate() → capturePatch()
```

The WRITE asymmetry is correct (Q2 design). But the READ side is the same for both — both branches read straight from ProjectContext. In main-app mode the read sees the result of the write because updateParam mutated ProjectContext. In editor mode the read sees baseline because the patch only landed in the capture provider's local state, never on ProjectContext.

**The architectural gap:** there is no layer between the section components and ProjectContext that overlays `currentPatches` on top of baseline `params` for the editor subtree. Reads bypass the capture context entirely.

The pre-Brief-46 editor (`InterventionEditorPopout.jsx`, deleted at Part 5) did not have this problem. It used a different design:

```js
// docs/audit/46_inert_controls_diagnosis.md — quote from the
// deleted file's docstring (commit fa69a62^):
//
// "currentConfig = applyIntervention(baselineConfig,
//    { ...intervention, patches: localPatches })
//  is the running edit state shown to the user."
```

It computed `currentConfig` via `applyIntervention(...)` — the same helper the engine uses to apply patches to a config — then passed `currentConfig` down as a prop to its custom-built `InterventionEditorBuildingView`. The view read display values from `currentConfig`, not from ProjectContext. Reads and writes flowed through the same data path.

Brief 46's design dropped that custom view in favour of mounting the main-app components directly. But it didn't replace the `currentConfig` read-overlay. The result is the inert UI.

---

## 4. Verification gap audit (Parts 2c–5)

**The escalation trigger fired and was missed.** Chris's two triggers:
> (a) a control resists capture-context wrapping, or
> (b) the engine anchor drifts unexpectedly (data-state drift from my testing is fine; code-introduced drift is not).

Trigger (a) is the failure mode we hit. The control wraps fine for writes (the patch IS captured); it doesn't function because reads are stale. I should have caught this in Part 2c by dragging the q50 slider in the editor and watching it snap back.

**What I actually verified per Part:**

| Part | Build | Code review | Browser drag/click in editor |
|---|---|---|---|
| 2c | ✓ | ✓ — "identity-by-construction" argument | ✗ |
| 3 | ✓ | ✓ — same argument extended to IG / Operation | ✗ |
| 4 | ✓ | ✓ — same argument extended to Systems | ✗ |
| 5 | ✓ | ✓ — rename + delete only, no logic | ✗ (justifiable for Part 5) |

The "identity-by-construction" argument I leaned on proves: *"`mutate('building.X', V)` in main-app mode produces the same engine state as the old `updateParam('X', V)` call."* It does NOT prove: *"the editor's UI shows the captured state to the user."* The Principle-3 conflation in the brief text — "same components, different mutation target" — let me skip the second proof entirely. That's the gap.

**What I should have done:**
- After Part 2c: open `localhost:5176/interventions`, click Add intervention, navigate to Building → Air permeability, drag the q50 slider. Watch behavior.
- After Part 3: same, plus toggle a system enable in operation.openings, watch the row update.
- After Part 4: open Systems → Heating in editor, click "+ Add system" and confirm the SystemEditorPopout opens with the new system.

I did none of these. Every Part 2c–5 commit message said "Bridgewater anchor live confirmation deferred to Chris's Part 6 walkthrough." That deferral was inappropriate for Part 2c — the central architectural assumption (capture context routing reaching the UI end-to-end) was untested.

---

## 5. Suggested next-step framing — for Chris's decision

I'm NOT proposing a fix yet. Three plausible directions, written here so we agree on root cause + direction together before any code:

**Direction A — read-overlay layer (most consistent with Principle 3).**
Add a `<PatchedProjectContextProvider>` between `<InterventionCaptureProvider>` and the section composers. It overrides `useContext(ProjectContext)` to return `applyIntervention(baselineParams, currentPatches)` instead of `baselineParams`. Each section reads patched values, writes through mutate (still captures patches against baseline). Read-write loop closed, no component refactor.

Risk: subtle — every consumer of `useContext(ProjectContext)` in the editor subtree gets patched params, including potentially the per-system editor popouts spawned from InputsColumn. Needs to handle: (1) re-deriving patched params on every patch change (memoised on `currentPatches` identity); (2) ensuring `updateParam` from the overridden context goes through `mutate` so writes from un-refactored deep components still capture (probably not needed if every write site already uses `mutate`).

**Direction B — pass `currentConfig` down as a prop (matches old editor's design).**
Lift `applyIntervention(...)` into `InterventionEditorPopout` (same as the deleted version did), pass `currentConfig` down through every section composer, and have each section composer use it instead of `useContext(ProjectContext)`. This is what the old editor did — and is the parallel-UI pattern Brief 46 Principle 3 was trying to escape.

Risk: defeats Principle 3's reuse. We'd be back to custom-built sections that take `currentConfig` as a prop. The Parts 2c–4 component reuse is wasted.

**Direction C — abandon shared components, build editor-side mini-editors.**
Revert Brief 46 Parts 2c–4 and rebuild the curated editor (like the deleted one) but slim. Cheaper to write, but throws away the dual-mount value.

I think **Direction A** is the right path — it's the smallest delta from the current code, it preserves Principle 3's intent, and it closes the architectural gap that Parts 2c–4 left open. But I want your call before touching anything.

**For RC-2 (schedule-edit no-ops):** likely lands as a follow-up to whichever direction we pick — the schedule editor needs to be mounted as a nested SchedulePopout inside `InterventionEditorPopout`, which is the Q1 deferral coming due. Direction A doesn't fix this on its own; we need to actually wire the schedule editor open.

---

## 6. Files / commits touched (for revert planning)

If Direction C is chosen, the Parts 2c–5 commits are:

```
fa69a62  Brief 46 Part 5: delete old editor + rename V2 to canonical
9c53866  Brief 46 Part 4: wire Systems editor section through InputsColumn
1361827  Brief 46 Part 3: wire Internal Gains + Operation editor sections
46775a2  Brief 46 Part 2c: extract Building subsections as self-contained named exports
```

Part 2c's extraction (`buildingSections.jsx`) is independently useful and shouldn't be reverted even under Direction C — the Building module's main `/building` page benefits from the cleaner file structure.

Parts 3–5 are tied to the dual-mount design; if Direction C wins, they'd need to be unwound (or kept as half-finished plumbing).

---

## 7. What I need from you

1. **Agreement on root cause** (RC-1 + RC-2 + RC-3 as written above), or pushback if my diagnosis misses something.
2. **Direction A / B / C decision** for the fix path.
3. **Whether to revert Part 5** (the file rename) before fixing — Direction C would want the old editor restored; A and B keep the new file.

I'll write nothing else until I hear back.

---

## 8. Fix landed — Direction A (2026-05-22, single commit)

Chris's call: Direction A, layer on top of Parts 2c–5, don't revert. Plus wire RC-2 schedule handlers.

### 8.1 What changed

**NEW `frontend/src/components/modules/interventions/PatchedProjectContextProvider.jsx`** — the read-overlay layer. Nests a second `<ProjectContext.Provider>` inside the editor subtree. When capturing:

- `params` → `applyIntervention(baselineConfig, { patches: currentPatches }).building`
- `constructions` → `applyIntervention(...).constructions`
- `systems` → `applyIntervention(...).systems`
- `comfortBand` → baseline merged with any `comfort_band.*` patches (applyIntervention doesn't handle `comfort_band` paths because comfort_band isn't on the config shape; merged separately)
- `updateParam(key, value)` → captures `building.${key}` patch; passes through `library_*` / `interventions` keys to the outer ProjectContext
- `updateConstruction(key, value)` → captures `constructions.${key}` patch
- `setComfortBand(patch)` → captures `comfort_band.${k}` per key in patch

Outside capture mode the provider is a no-op (renders children unchanged). The baseline ProjectContext is never modified.

**NEW `frontend/src/components/modules/interventions/EditorChromeContext.jsx`** — small context exposing the editor's schedule-editor open handlers (`openOccupancyScheduleEditor`, `openGainsProfileScheduleEditor`, `openNamedScheduleEditor`) to deeply nested section composers. Default value is no-ops so the same components render fine outside an editor.

**MODIFIED `frontend/src/components/modules/interventions/InterventionEditorPopout.jsx`** — render tree restructured to:

```
SchedulePopout (the editor's outer chrome)
  InterventionCaptureProvider
    PatchedProjectContextProvider               ← NEW
      EditorBody (lifted as a separate component)
        EditorChromeProvider                    ← NEW
          ... nav / pane / footer ...
        SchedulePopout (nested — the schedule editor)
```

EditorBody owns the nested schedule editor's state + the three open-handlers. Save handler branches by schedule kind (occupancy / gains-profile / named) and captures the appropriate patch via `mutate(...)`. The nested SchedulePopout uses a distinct persistKey (`nza-intervention-editor-schedule-popout`) so its drag position doesn't shadow the main-app schedule popouts.

**MODIFIED `interventions/sections/InternalGainsSection.jsx`** — `onEditSchedule` handlers now consume `useEditorChrome()` and route to `openOccupancyScheduleEditor` / `openGainsProfileScheduleEditor('lighting' | 'equipment', 0)` (profile index 0 — multi-profile resolution is a follow-up).

**MODIFIED `interventions/sections/OperationSection.jsx`** — `openScheduleEditor` and `allSched` props on each OpeningRow now wire to `chrome.openNamedScheduleEditor` and `params.schedules`.

**MODIFIED `interventions/sections/SystemsSection.jsx`** — `openScheduleEditor` prop on InputsColumn wires to `chrome.openNamedScheduleEditor`.

### 8.2 Why this fixes RC-1

The section composers continue to call `useContext(ProjectContext)` — but inside the editor subtree the context's `Provider value` is the patched layer. So `params.fabric.air_permeability_q50` reads the patched value (not baseline). When the user drags the q50 slider:

1. Slider's `value={q50}` displays the patched value.
2. onChange fires → `mutate('building.fabric', {...})` → `capturePatch(...)` → currentPatches grows.
3. PatchedProvider's `useMemo` re-runs `applyIntervention` → new patched config.
4. Section re-renders → `q50` is now the new patched value → slider holds at the new position. ✓

### 8.3 Why this fixes RC-3 (add/delete/toggle)

Add system:
1. addSystem(service, sys) builds `nextList = [...patchedList, fresh]` (where `patchedList` is from patched params).
2. `writeV40(nextList)` → `mutate('building.systems_config_v40', nextList)` → patch captured.
3. setEditingKey(`${service}:${fresh.id}`) fires.
4. Re-render: patched.systems_config_v40[service] now contains fresh → `editingSystem = list.find(s => s.id === fresh.id)` returns fresh → SystemEditorPopout opens. ✓

Delete: patched list now excludes the deleted system → list re-renders without it. ✓
Toggle: patched system has `enabled: !prev` → toggle reflects new state. ✓

### 8.4 Why this fixes RC-2 (schedule editor stubs)

Schedule editor handlers were no-ops in the three composers. Now they pull from `useEditorChrome()` and route to the editor's nested SchedulePopout. Saves capture as `building.occupancy` / `building.gains` / `building.schedules` patches.

### 8.5 Known gaps in this fix

- **Engine preview for comfort_band changes:** patched comfort_band shows in the slider, but the editor's preview engine (`runInterventionStack`) doesn't pass `options.comfortBand` to `calculateInstant`, so the EUI delta won't reflect a comfort-band change. Existing limitation; not a Brief 46 fix scope.
- **Multi-profile schedule editing for IG:** I wire only `profileIdx=0` — projects with multiple lighting / equipment profiles can only edit the first via the schedule pencil. The composer's `activeProfileId` state exists but isn't consulted by the schedule-handler call (needs a profile-id → index lookup against patched gains). Follow-up.
- **Whole-object patch granularity:** `building.fabric`, `building.occupancy`, `building.gains`, `building.systems_config_v40`, `building.operable_openings`, `building.schedules` all capture as whole-object/whole-array snapshots. This is what Parts 2c–4 chose and the fix preserves that. Granular Brief-41-shape patches (e.g. `building.systems_config_v40.heating[id=X].share_pct`) remain a future iteration if interventions need to compose across these slices.
- **Build verification only — no browser verification.** Per Chris's directive: "If you cannot drive the browser, say so and stop." I cannot drive the browser end-to-end on the Windows env. The fix compiles clean (`npm run build` — 3209 modules). The five-check browser verification is Chris's to run:
  1. Drag q50 — value holds, footer Δ moves
  2. Open occupancy schedule editor — opens, edits capture
  3. Add a system — appears in the list
  4. Delete a system — it goes
  5. Toggle a system — it stays

---
