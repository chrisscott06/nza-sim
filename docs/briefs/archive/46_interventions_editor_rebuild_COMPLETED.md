# Brief 46 — Interventions editor full rebuild: collapsible nav + reused controls + capture context

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott
**Status:** Active. Multi-Part rebuild brief.
**Date opened:** 2026-05-21
**Target outcome:** The intervention editor lets Chris change any input that exists anywhere in the main app — Building / Internal Gains / Operation / Systems — using the same controls he uses daily. Every change is captured as a patch against baseline. The editor lives in a draggable pop-out with a familiar shape: collapsible left nav mirroring the main app's modules, right pane showing the relevant controls, sticky footer with running EUI / carbon / Δ. Old curated editor is fully deleted.

After this brief lands: Chris opens an intervention, clicks Internal Gains → Occupancy → Schedule, edits the schedule with the same editor he uses on the main app, sees the EUI delta update live in the footer, drags the pop-out to a second screen so he can watch the waterfall move in the main window, and saves. He can do the same for envelope, openings, systems — anything.

---

## BEFORE DOING ANYTHING

0. **Run the session-start documentation reconciliation pass (mandatory).** Per Process Rule 8:
   - `ls docs/briefs/active/` — should be empty (Brief 45 archived at `d4a3d31`)
   - `cat docs/briefs/current.md` — should reflect no active brief
   - `tail -50 STATUS.md` — should show Brief 45 close
   - `git log --oneline -20` — last 20 commits
   - If any check fails, the first commit of the session is the cleanup commit.

1. Read this entire brief.
2. Read CLAUDE.md end to end. Particularly Module Scopes Interventions + Building + Internal Gains + Operation + Systems, Process Rules 7, 8, 10, 11.
3. Read the existing intervention editor scaffolding (about to be deleted in Part 5):
   - `frontend/src/components/modules/interventions/InterventionEditorPopout.jsx`
   - `frontend/src/components/modules/interventions/InterventionEditorBuildingView.jsx`
   - `frontend/src/components/modules/interventions/InterventionEditorPreview.jsx`
   - `frontend/src/components/modules/interventions/patchCapture.js`
   - `frontend/src/components/modules/interventions/PatchList.jsx`
   - `frontend/src/components/modules/interventions/StructuralOpMenu.jsx`
   - `frontend/src/components/modules/interventions/SystemSlotControls.jsx` (or equivalent)
4. Read the main-app input controls that this brief reuses inside the capture context:
   - Building module: `frontend/src/components/modules/building/*` — orientation, glazing ratios, fabric (construction picker), shading, q50
   - Internal Gains module: occupancy, lighting, equipment, schedules — particularly the schedule editor component
   - Operation module: openings, control thresholds, permanent vent flow
   - Systems module: `SystemsModule.jsx`, `ServiceSectionHeader.jsx`, `SystemSummaryRow.jsx`, `SystemEditorPopout.jsx`, `SystemEditorCard.jsx`, `ServiceSplitBar.jsx`
   - The shared schedule editor (Brief 37 SchedulePopout / UnifiedScheduleEditor)
5. Read `frontend/src/context/ProjectContext.jsx` — every mutation entry point (`updateProject`, `updateSystem`, `updateSchedule`, `updateInternalGains`, etc.) needs to be addressable by the new capture context.
6. Read `docs/audit/41_interventions_schema.md` for the patch model — `applyPatch`, set/add/remove/replace ops, path conventions.
7. Read `docs/audit/29_open_issues.md` for current open issue numbers. Issue #20 ("wrap full main-app UI in patch capture context") is this brief's core scope and will be marked resolved at close.
8. Confirm working tree clean: `git status --short`.
9. Confirm `origin/main == local main`.
10. **Part 1's first commit must include this brief file landed at `docs/briefs/active/46_interventions_editor_rebuild.md`** per Process Rule 7. No code work begins until that commit lands.
11. Do not begin Part 1 until checks 0–10 pass.

---

## Scope statement

This brief **rebuilds the intervention editor from scratch** and **deletes the old curated editor**. It does not change the patch model, the engine, or the project state schema. It adds one new piece of architecture (`InterventionCaptureContext`) and one new pop-out shell; it reuses every main-app input control inside that context.

Modules touched:
- **Interventions** (primary — editor rebuilt, old curated editor removed)
- **Building / Internal Gains / Operation / Systems** (secondary — input controls become capture-context-aware via prop or context, no behavioural change in main app)

Modules untouched: CRREM, Roadmap, Results, Information, Comparison view, EUIWaterfall, Sankey hover tooltips, Live Results panel.

This brief delivers six substantive Parts plus close.

---

## Operational mode — keep ploughing through

Per Chris's authorisation: end-to-end run, no per-Part sign-off pauses. Walkthrough sign-off after Part 5 before Part 6 close. Stop and escalate only for the conditions in "When to escalate" below.

---

## Principles

1. **No data model changes.** Patch shape (op/path/value/source/schema_version), intervention shape, project state schema all unchanged. Brief 41–45 work preserved as-is.

2. **No engine changes.** `applyPatch`, `applyIntervention`, `runInterventionStack`, `computeDelta`, the v40 displacement adapters, the Brief 44 Part 5d `_skipInterventions` plumbing — all read-only references.

3. **Reuse main-app input controls inside the capture context.** The construction picker that works in Building works in the intervention editor. The schedule editor that works in Internal Gains works in the intervention editor. Same components, same behaviour, different mutation target. **Do not build parallel UI.**

4. **Pop-out chrome reuses Brief 37 / 41 / 42 pattern.** Draggable, position persisted via `nza-intervention-editor-popout-position` localStorage key (preserved from Brief 41 Part 4), Esc-to-close, reset-position. **The pop-out must be draggable to a second monitor** — Chris's primary use case is to keep the main app's EUI waterfall visible while editing the intervention in the pop-out.

5. **Capture context is the new architecture piece.** A React context (`InterventionCaptureContext`) wraps the editor. Mutation hooks (e.g. `useProjectMutation()`) check the context — if active, route to patch capture; if not, route to project state as today. Only the editor's subtree is wrapped — main app behaviour unchanged.

6. **Full replace, no parallel paths.** Old curated editor (`InterventionEditorBuildingView.jsx` and its scaffolding) deleted in Part 5. No "quick edit" fallback. No feature flag. The new editor IS the editor.

7. **Visible-change indicators.** Every input that has a patch applied shows a small visual marker (accent dot, coloured border, or similar) so Chris can see at a glance what's changed. Click the marker → revert that specific patch.

8. **Falsifiability anchored to Bridgewater.** Engine numbers post-Brief-46 baseline match Brief 45 close (Bridgewater baseline EUI 121.7 kWh/m²·yr within 0.1%). The new editor changes UI only; engine output must be unchanged.

9. **3-intervention walkthrough is the acceptance test.** Build fabric / internal-gains-stress / plant-electrification-with-MVHR using only the new editor. All three must capture cleanly, produce sensible deltas, and tell the waterfall story.

10. **Browser verification mandatory at Parts 3, 4, 5, 6.** This brief is mostly UI rewiring; code-side reasoning consistently underestimates UX-layer bugs.

11. **Documentation hygiene per Process Rule 7.** Each Part's commit includes STATUS.md + audit-doc update. Brief file landed in `docs/briefs/active/` as Part 1's first commit.

---

## Parts

### Part 1 — Capture context architecture + editor shell

**Goal:** The new architecture in place but not yet wired to any main-app controls. `InterventionCaptureContext` exists and is testable. Editor pop-out renders the shell (left collapsible nav, right pane, sticky footer) but with placeholder content. Patches captured via the context appear in the patch list and footer.

**Files touched:**
- `frontend/src/context/InterventionCaptureContext.jsx` (new) — the capture context + provider + hooks
- `frontend/src/hooks/useProjectMutation.js` (new — or extend existing if there's already one) — central mutation hook that checks the capture context
- `frontend/src/components/modules/interventions/InterventionEditorV2.jsx` (new) — the new editor shell (V2 suffix during build to avoid colliding with the old editor; renamed at Part 5 deletion)
- `frontend/src/components/modules/interventions/EditorNav.jsx` (new) — left collapsible nav component
- `frontend/src/components/modules/interventions/EditorFooter.jsx` (new) — sticky footer with EUI / carbon / Δ / Save / Cancel
- `docs/audit/46_interventions_editor_rebuild.md` (new) — captures architecture decisions
- `docs/briefs/active/46_interventions_editor_rebuild.md` — this brief
- `docs/briefs/current.md` — pointer updated

**Steps:**

1.1 **`InterventionCaptureContext` design.** Exposes:
   - `isCapturing: boolean` — true when the editor pop-out is mounted in capture mode
   - `interventionId: string | null` — which intervention being edited
   - `capturePatch(path, op, value, source?)` — capture a single patch
   - `revertPatch(patchId)` — remove a specific captured patch
   - `currentPatches: Patch[]` — running list of captured patches
   - `previewState: object` — baseline + currentPatches applied (live engine input)

1.2 **`useProjectMutation` hook design.** Single hook that components use instead of calling `updateProject` / `updateSystem` / etc. directly. Returns a `mutate(path, value, op?)` function that:
   - If `InterventionCaptureContext.isCapturing === true`: calls `capturePatch(path, op || 'set', value)`
   - Else: calls the appropriate ProjectContext mutation as today

   This is the central plumbing piece. **No main-app control changes in Part 1 — the hook exists but nothing uses it yet.**

1.3 **Editor V2 shell.** `InterventionEditorV2.jsx` renders:
   - Pop-out chrome (drag handle, reset position, close) — reuses Brief 37 SchedulePopout pattern with `defaultPosition='right'`, `nza-intervention-editor-popout-position` localStorage
   - Left collapsible nav (`EditorNav.jsx`) showing module sections — placeholder list for now: Building, Internal Gains, Operation, Systems
   - Right pane (`EditorPane.jsx`) — placeholder "Select a section from the left" for now
   - Sticky footer (`EditorFooter.jsx`) showing: intervention label (editable), Σ patches: N, Baseline EUI / Current EUI / ΔEUI / ΔCO₂, Save / Cancel buttons
   - Wraps the whole editor in `InterventionCaptureContext.Provider`

1.4 **Live preview wiring.** The footer's EUI / Δ values read from `previewState` — which is the engine output of (baseline + currentPatches). When `currentPatches` changes, engine reruns (existing reactivity), footer updates within same render cycle.

1.5 **Patch list inside the editor.** Below the right pane (or as a collapsible drawer at the bottom of the right pane), show the captured patch list with revert buttons. Reuse PatchList.jsx where its rendering logic still applies; refactor the import paths since the surrounding scaffolding will be deleted at Part 5.

1.6 **Old editor still operational.** Part 1 does not delete the old editor. Both editors coexist for Parts 1-4 of this brief. The new editor is unreachable from the UI (no entry point wired yet) — it's only testable via direct route or a temporary dev toggle. Old editor remains the default.

1.7 **Audit doc.** § "Part 1 — capture context architecture" documents:
   - The `InterventionCaptureContext` API
   - The `useProjectMutation` hook signature and routing rules
   - The editor V2 shell layout (left nav + right pane + footer + draggable pop-out)
   - Why the old editor stays operational during the build (incremental wire-up, not big-bang switch)

**Commit message:**
```
Brief 46 Part 1: capture context architecture + editor shell

InterventionCaptureContext provides patch capture + revert + live
preview state. useProjectMutation hook centralises mutation
routing — checks the capture context, routes to patch capture
when active, falls through to ProjectContext as today.

InterventionEditorV2 renders the new shell: pop-out chrome
(reuses Brief 37 SchedulePopout), left collapsible nav, right
pane placeholder, sticky footer with live EUI / carbon / Δ /
Save / Cancel.

Old InterventionEditorBuildingView remains operational; new
editor is unreachable from UI in Part 1 (testable via dev
toggle). Old editor deleted at Part 5.

No data model changes. No engine changes. No main-app control
changes yet — useProjectMutation exists but nothing uses it.
```

STATUS.md + audit doc updated in same commit.

---

### Part 2 — Wire Building module controls inside capture context

**Goal:** Click Building → Fabric in the editor nav, see the same construction picker that works on the main Building page, edit a wall U-value, see the patch captured and EUI delta in the footer.

**Files touched:**
- `frontend/src/components/modules/building/*` — every input control refactored to use `useProjectMutation` instead of direct ProjectContext calls
- `frontend/src/components/modules/interventions/sections/BuildingSection.jsx` (new) — composes Building's controls into editor sections (Fabric, Orientation, Glazing, Shading, Air Permeability)
- `frontend/src/components/modules/interventions/InterventionEditorV2.jsx` — wires BuildingSection into the right pane when nav selection is Building
- `docs/audit/46_interventions_editor_rebuild.md` — append "Part 2 — Building wired"

**Steps:**

2.1 **Audit Building module mutation entry points.** List every place a Building control calls `updateProject(...)` or similar. Refactor each to `useProjectMutation().mutate(path, value)`. Behaviour in the main app is identical (context not active = falls through to ProjectContext).

2.2 **`BuildingSection.jsx`.** Composes Building's controls into editor subsections. Each subsection is a collapsible group in the left nav. Suggested grouping:
   - **Air Permeability** — q50 slider/input
   - **Orientation** — rotation control
   - **Glazing ratios** — per-orientation glazing ratio sliders
   - **Fabric** — construction picker for external wall / roof / glazing / ground floor
   - **Shading** — overhang depths per orientation

   Each subsection renders the existing main-app component(s) inside the capture context.

2.3 **Nav wire-up.** Clicking "Building" in `EditorNav` expands its subsections. Clicking a subsection sets the right pane to render that subsection's component.

2.4 **Visible-change indicator on patched inputs.** When a Building input has a patch applied (e.g. wall U-value was changed from baseline), show a small accent marker (coloured dot or border tint) on that input. Click the marker → revert the patch (calls `revertPatch(patchId)` from capture context). Marker visible in editor only, not in main app.

2.5 **Browser verification.** Boot dev server. Load Bridgewater. Open the new editor (via dev toggle since Part 5 hasn't wired the entry point yet). Walk:
   - Click Building → Fabric → change wall U via construction picker → patch appears in patch list → footer ΔEUI moves
   - Click Building → Air Permeability → change q50 → patch captured, ΔEUI moves
   - Click the patch's revert marker → patch removed, ΔEUI returns to 0
   - Save intervention → patches persist on the intervention
   - Reopen the intervention → patches restored, controls show the patched values

2.6 **Audit doc.** § "Part 2 — Building wired" documents:
   - Building mutation entry points refactored
   - BuildingSection composition
   - Visible-change indicator pattern (to be reused in Parts 3 + 4)

**Commit message:**
```
Brief 46 Part 2: Building controls wired inside capture context

Building module's mutation entry points refactored to use
useProjectMutation. Behaviour in main app identical — context
not active = ProjectContext fallthrough.

BuildingSection composes the existing main-app controls
(construction picker, q50, glazing ratios, orientation,
shading) into editor subsections. Click a subsection in the
left nav, see the same control that works on the main page,
edit it, patch captures, footer Δ updates live.

Visible-change indicators on patched inputs: small accent
marker per input that has a patch. Click marker to revert.

Browser-verified on Bridgewater: wall U / q50 edit cycle
captures + reverts cleanly. Footer ΔEUI tracks engine.
```

STATUS.md + audit doc updated in same commit.

---

### Part 3 — Wire Internal Gains + Operation module controls

**Goal:** The same pattern as Part 2, applied to Internal Gains (including the schedule editor for occupancy / lighting / equipment) and Operation (openings, thresholds, permanent vent).

**Files touched:**
- `frontend/src/components/modules/internalgains/*` — mutation entry points refactored to `useProjectMutation`
- `frontend/src/components/modules/operation/*` — same
- `frontend/src/components/modules/interventions/sections/InternalGainsSection.jsx` (new)
- `frontend/src/components/modules/interventions/sections/OperationSection.jsx` (new)
- `frontend/src/components/modules/interventions/InterventionEditorV2.jsx` — wires the new sections into right pane
- Schedule editor reuse — confirm it works as a sub-popout from the editor (Brief 37 SchedulePopout already supports nesting; verify no z-index or position conflicts)
- `docs/audit/46_interventions_editor_rebuild.md` — append "Part 3 — Internal Gains + Operation wired"

**Steps:**

3.1 **Internal Gains mutation entry points refactored.** All `updateInternalGains(...)` calls become `useProjectMutation().mutate(...)`.

3.2 **`InternalGainsSection.jsx`.** Subsections:
   - **Occupancy** — rate, density, schedule reference (opens schedule editor sub-popout)
   - **Lighting** — load (W/m²), schedule reference
   - **Equipment** — load (W/m²), schedule reference

3.3 **Schedule editor reuse.** When the user clicks "Edit schedule" inside Occupancy/Lighting/Equipment, the existing schedule editor opens as a sub-popout. Patches captured on schedule entries route through `useProjectMutation` → `capturePatch` with the schedule path.

   Critical: the schedule editor's existing path is `params.schedules[id]`. Patching a schedule from inside an intervention captures at that path. The intervention then has its own copy of that schedule applied via the engine's `applyPatch` machinery — no special-case logic.

3.4 **`OperationSection.jsx`.** Subsections:
   - **Operable openings** — per-opening flow + control mechanism
   - **Control thresholds** — outdoor temp triggers, time triggers
   - **Permanent vent flow** — l/s constant

3.5 **Operation mutation entry points refactored.** Same pattern.

3.6 **Visible-change indicators applied.** Reuse the Part 2 pattern.

3.7 **Browser verification.** Walk:
   - Open intervention editor → Internal Gains → Occupancy → click Edit schedule → schedule editor sub-popout opens
   - Change a schedule cell from 0 → 1 → patch captured at schedules path → footer ΔEUI moves (occupancy gain increased → heating demand drops, cooling rises)
   - Operation → Operable openings → change a flow rate → patch captured
   - Save, reopen, confirm all patches restored

3.8 **Audit doc.** § "Part 3 — Internal Gains + Operation wired."

**Commit message:**
```
Brief 46 Part 3: Internal Gains + Operation controls wired

InternalGainsSection wraps occupancy / lighting / equipment
controls inside the capture context. Schedule editor opens as
a sub-popout from any schedule-typed field; patches capture
at params.schedules path through useProjectMutation.

OperationSection wraps operable openings / control thresholds /
permanent vent flow.

Both modules' mutation entry points refactored to use
useProjectMutation. Main app behaviour unchanged (context
fallthrough).

Browser-verified on Bridgewater: occupancy schedule edit
captures, footer Δ moves predictably (occupancy up → heating
down + cooling up). Save / reopen round-trip works.
```

STATUS.md + audit doc updated in same commit.

---

### Part 4 — Wire Systems module controls

**Goal:** Systems is the biggest module — six services, service-level fields (post-Brief-42), per-system fields, structural ops (add/remove/replace from Brief 43), inline share editing (from Brief 45). All of it must work inside the capture context.

**Files touched:**
- `frontend/src/components/modules/systems/*` — mutation entry points refactored to `useProjectMutation`
- `frontend/src/components/modules/interventions/sections/SystemsSection.jsx` (new) — composes the Systems module's UI inside the editor
- `frontend/src/components/modules/interventions/InterventionEditorV2.jsx` — wires SystemsSection
- `docs/audit/46_interventions_editor_rebuild.md` — append "Part 4 — Systems wired"

**Steps:**

4.1 **Systems mutation entry points refactored.** Every `updateSystem`, `updateServiceLevel`, share slider, enable toggle, structural op (add/remove/replace) refactored to `useProjectMutation`.

4.2 **`SystemsSection.jsx`.** Composes the existing Systems left-panel UI inside the editor: service section headers (`ServiceSectionHeader`), summary rows (`SystemSummaryRow`), split bars (`ServiceSplitBar`), structural op affordances (`StructuralOpMenu`). Per-system pop-out (`SystemEditorPopout`) opens as a sub-popout when the edit pencil is clicked.

4.3 **Service-level patches.** Heating/cooling setpoints, DHW demand basis + quantity + temps — all captured at service-level paths (post-Brief-42 schema) via the section header controls inside the capture context.

4.4 **Structural ops.** Add system / remove system / replace system — captured as op: 'add' / 'remove' / 'replace' patches per the Brief 43 patch model. UI affordances reused from Brief 43.

4.5 **Inline share editing.** The Brief 45 inline share slider works inside the capture context — drag triggers `useProjectMutation` which captures a share patch.

4.6 **Visible-change indicators applied.** Markers on any field with a patch. For structural ops, the added/removed/replaced systems are visually distinguished in the section (e.g. added systems get a "+" badge, removed systems shown as crossed-out, replaced systems show before → after).

4.7 **Browser verification.** Walk:
   - Open intervention editor → Systems → change heating setpoint to Custom 19°C → service-level patch captured, footer ΔEUI moves
   - Systems → drag DHW gas share from 65 to 30 → share patch captured, footer ΔEUI moves
   - Systems → DHW → click + Add system → library modal opens → pick ASHP DHW → op: 'add' patch captured, footer ΔEUI moves
   - Systems → DHW → click ⊗ Remove on gas DHW → op: 'remove' patch captured
   - Save, reopen, all patches and structural ops restored

4.8 **Audit doc.** § "Part 4 — Systems wired."

**Commit message:**
```
Brief 46 Part 4: Systems controls wired inside capture context

SystemsSection composes the full Systems left-panel UI inside
the editor: section headers (service-level fields), summary
rows (inline share, enable toggle), split bars, structural
op menu, per-system pop-out as sub-popout from edit pencil.

All mutation entry points refactored to useProjectMutation.
Brief 42 service-level paths, Brief 43 structural ops, Brief 45
inline share editing all work inside the capture context.

Visible-change indicators applied to fields and structural ops:
+ badge on added systems, crossed-out on removed, before→after
on replaced.

Browser-verified on Bridgewater: 4-patch intervention captures
across service-level + per-system + structural op + share
without error. Save / reopen round-trip works.
```

STATUS.md + audit doc updated in same commit.

---

### Part 5 — Delete the old editor + wire the new editor as the only entry point

**Goal:** Old editor scaffolding deleted. New editor is the only way to edit an intervention. No feature flag, no fallback.

**Files touched (deleted):**
- `frontend/src/components/modules/interventions/InterventionEditorBuildingView.jsx` — deleted
- `frontend/src/components/modules/interventions/InterventionEditorPreview.jsx` — deleted (preview now lives in the editor footer)
- `frontend/src/components/modules/interventions/SystemSlotControls.jsx` — deleted (Systems controls now reused from main Systems module)
- Any other Brief 41-era curated-editor scaffolding identified during the audit

**Files renamed:**
- `frontend/src/components/modules/interventions/InterventionEditorV2.jsx` → `InterventionEditorPopout.jsx` (replaces the old shell of the same name; if the old shell name conflicts, delete old first then rename)

**Files touched (modified):**
- `frontend/src/components/modules/interventions/InterventionsModule.jsx` — entry point now opens InterventionEditorPopout (the new one). Dev toggle from Part 1 removed.
- `frontend/src/components/modules/interventions/PatchList.jsx` — kept; its rendering logic is reused inside the new editor. Imports cleaned up.
- `frontend/src/components/modules/interventions/StructuralOpMenu.jsx` — kept; reused by SystemsSection
- `frontend/src/components/modules/interventions/patchCapture.js` — review. Some helpers may still be needed (e.g. `summarizePatch`, `summarizePatchListShort`). Delete the old capture orchestration; keep the summary helpers.
- `docs/audit/46_interventions_editor_rebuild.md` — append "Part 5 — old editor deleted"

**Steps:**

5.1 **Pre-delete audit.** Grep for every import of the files about to be deleted. Confirm each import either has a replacement (e.g. PatchList still imported but from the new editor) or the importer itself is being deleted.

5.2 **Delete the files.** `git rm` each one. Single commit at the end of Part 5 for clarity in the diff.

5.3 **Wire the new editor as the only entry point.** `InterventionsModule.jsx`'s "Add intervention" / edit-pencil affordances open the new editor. Dev toggle removed.

5.4 **Rename V2 → canonical name.** `InterventionEditorV2.jsx` → `InterventionEditorPopout.jsx`. Update imports. Update audit doc references.

5.5 **Clean up `patchCapture.js`.** Old capture orchestration deleted. Helpers (`summarizePatch`, `summarizePatchListShort`, plain-English renderers) kept and exported.

5.6 **Grep for dead code.** `grep -rn` for old function names (`InterventionEditorBuildingView`, `InterventionEditorPreview`, `SystemSlotControls`, `summarizeOldPatch` if any). Remove any stragglers.

5.7 **Browser verification.** Boot dev server. Load Bridgewater. Open Interventions → Add intervention. The new editor opens. The old editor cannot be reached. Build a 4-patch intervention (envelope + internal gains + systems + schedule) using only the new editor. Save. Reopen. All patches restored. Engine numbers match expectations.

5.8 **Audit doc.** § "Part 5 — old editor deleted" documents:
   - List of deleted files
   - Rename V2 → canonical
   - Confirmation no dead code remains
   - The new editor's file structure now canonical

**Commit message:**
```
Brief 46 Part 5: old editor deleted, new editor canonical

Deleted: InterventionEditorBuildingView.jsx,
InterventionEditorPreview.jsx, SystemSlotControls.jsx, and
related Brief 41-era curated-editor scaffolding.

Renamed: InterventionEditorV2.jsx → InterventionEditorPopout.jsx
(replaces old shell of the same name). All imports updated.

Kept and reused: PatchList.jsx (rendering logic), StructuralOpMenu
(Systems integration), patchCapture.js summary helpers
(summarizePatch, summarizePatchListShort).

New editor is the only entry point. No feature flag, no fallback.

Browser-verified: Add intervention opens new editor; build 4-patch
intervention across envelope + internal gains + systems + schedule;
save + reopen round-trip clean.
```

STATUS.md + audit doc updated in same commit.

---

### Part 6 — Bridgewater 3-intervention walkthrough + close

**Goal:** Chris's 3-intervention test (fabric / internal-gains-stress / plant-electrification-with-MVHR) runs cleanly using only the new editor. Brief 46 archived. Issue #20 closed.

**Files touched:**
- `docs/audit/46_interventions_editor_rebuild.md` — append "Part 6 — walkthrough"
- `docs/audit/29_open_issues.md` — close Issue #20; log any new issues from walkthrough
- `docs/briefs/active/46_interventions_editor_rebuild.md` → `docs/briefs/archive/46_interventions_editor_rebuild_COMPLETED.md`
- `docs/briefs/current.md` — pointer updated
- STATUS.md — close-out

**Walkthrough checklist Chris runs (15 items):**

**Architecture + shell**
1. Open Interventions → Add intervention. Editor pop-out opens, draggable, default position right side of canvas.
2. Drag pop-out to second monitor. Main app's Comparison view (EUI waterfall) remains visible. As patches captured in the pop-out, the waterfall in the main window updates live.
3. Editor left nav shows: Building, Internal Gains, Operation, Systems (all collapsible). Each expands to show subsections.
4. Footer shows: intervention label, Σ patches counter, Baseline EUI / Current EUI / ΔEUI / ΔCO₂, Save / Cancel.

**Intervention 1 — Fabric strategy**
5. Building → Shading → set South overhang to 0.5m → patch captured. Set East overhang to 0.5m. Footer Σ patches = 2.
6. Building → Air permeability → drop q50 from baseline (4.64) to 2.0 → patch captured. Σ = 3.
7. Visible-change indicators visible on edited fields. Click revert on q50 → drops back to baseline → click again to restore.
8. Save intervention as "Fabric strategy". Reopen. All 3 patches restored.

**Intervention 2 — Internal Gains stress test**
9. Add new intervention. Internal Gains → Occupancy → Edit schedule → schedule sub-popout opens. Change schedule to 24/7 fully occupied. Patch captured at schedules path.
10. Internal Gains → Lighting → load up to 4 W/m². Σ = 2. Footer ΔEUI shows positive number (worsening — expected).
11. Save as "Internal gains stress".

**Intervention 3 — Plant electrification + MVHR**
12. Add new intervention. Systems → DHW → ⊗ Remove on gas combi. Σ = 1. Footer ΔEUI moves.
13. Systems → DHW → + Add system → ASHP DHW from library (90% share). + Add electric immersion (10% share). Σ = 3.
14. Systems → Ventilation → ⇄ Replace MEV extracts with MVHR (from library). Σ = 4. Footer ΔEUI drops further (recovery credit).
15. Save as "Plant electrification with MVHR".

**Final acceptance**
- 3-intervention stack visible in main view. EUI waterfall shows 5 bars (baseline → Int 1 → Int 2 → Int 3 → final).
- Bridgewater baseline EUI matches Brief 45 close (121.7 kWh/m²·yr within 0.1%) — confirms no engine drift.
- Cumulative ΔEUI in InterventionStackView agrees with the waterfall.
- All three interventions can be toggled on/off, reordered, duplicated, deleted.

If all pass → Part 6 close commit.
If anything anomalous → log in 29_open_issues.md, diagnose, fix in follow-up commit within Part 6, re-verify.

**Final report Chris pastes after close:**

1. New origin/main HEAD SHA
2. Editor architecture confirmed (capture context + nav + pane + footer + draggable to second monitor)
3. 3-intervention stack built cleanly using only the new editor
4. Bridgewater baseline EUI 121.7 within 0.1% (confirms no engine drift)
5. 3-intervention stack EUI: Int 1 → ? Int 2 → ? Int 3 → ? (actual numbers captured)
6. Waterfall agrees with stack table
7. Schedule sub-popout works inside editor
8. Visible-change indicators + revert per-patch works
9. Save / reopen round-trip works for all 3 intervention types
10. Issue #20 marked resolved in 29_open_issues.md
11. Any new issues logged from walkthrough
12. Confirmation `docs/briefs/active/` is empty
13. CLAUDE.md unchanged (no scope drift)
14. List of deleted files from Part 5 (confirms full replace)

**Commit message (after Chris's sign-off):**
```
Brief 46 close: interventions editor rebuild live

Intervention editor is now a draggable pop-out with collapsible
left nav (Building / Internal Gains / Operation / Systems),
right pane reusing main-app input controls, sticky footer
with live EUI / carbon / Δ / Save / Cancel.

Every input editable in the main app is editable in the
intervention editor. Schedule editor opens as a sub-popout.
Structural ops, service-level patches, inline share editing
all work inside the capture context.

Old curated editor (Brief 41-era) deleted entirely. No feature
flag, no fallback — full replace.

Architecture: InterventionCaptureContext routes mutations to
patch capture when the editor is mounted, falls through to
ProjectContext otherwise. useProjectMutation hook is the
single mutation entry point across Building / Internal Gains /
Operation / Systems modules. Main-app behaviour unchanged.

Bridgewater 3-intervention walkthrough (fabric / internal
gains stress / plant + MVHR) ran cleanly. Baseline EUI 121.7
matches Brief 45 close exactly — UI rebuild, no engine drift.

Issue #20 (wrap full main-app UI in patch capture context) —
resolved via this brief's lighter answer than the original
proposal. The capture context wraps the editor's subtree only;
main app untouched.
```

---

## What MUST NOT happen in this brief

- No data model changes. Patch shape, intervention shape, project state schema all unchanged.
- No engine changes. `applyPatch`, `applyIntervention`, `runInterventionStack`, `computeDelta`, v40 displacement, `_skipInterventions` plumbing — all read-only references.
- No new physics, no new visualisations (EUI waterfall, Sankey hover, Profiles visualiser all unchanged).
- No CRREM / Roadmap / Calibration / Results / Information scope creep.
- No partial commits — each Part is one commit including STATUS.md + audit-doc updates.
- No skipping browser verification at Parts 3, 4, 5, 6.
- No keeping the old editor as a fallback after Part 5. Full replace.
- No engine-number changes. Bridgewater baseline post-Brief-46 must match Brief 45 close (121.7 kWh/m²·yr) within 0.1%.
- No main-app behavioural changes. Building / Internal Gains / Operation / Systems modules behave identically when the capture context is not active. Test this by editing on the main pages and confirming nothing has changed.
- No silent feature additions. If the rebuild surfaces a missing affordance (e.g. a field exists in the model but no main-app control yet exists for it), log to 29_open_issues.md — do not invent a new control in this brief.

---

## When to escalate

Pause and escalate to Chris ONLY if:

- A main-app input control turns out to be tightly coupled to a write-to-baseline assumption that can't be refactored cleanly via `useProjectMutation` (suggests a structural component refactor that warrants its own brief)
- The capture context surfaces an engine bug not caught by Brief 44's verification work (e.g. a patch type the engine doesn't apply correctly) — log and surface; do not fix in this brief
- The schedule editor as a sub-popout has unresolvable z-index / position conflicts with the parent editor pop-out (suggests Brief 37 SchedulePopout needs an extension)
- The 3-intervention walkthrough surfaces a delta that doesn't match physical intuition (e.g. removing gas DHW + adding ASHP DHW produces unchanged EUI — suggests an engine path issue worth diagnosing)
- Bridgewater baseline EUI post-Brief-46 differs from Brief 45 close (would indicate accidental engine change; not possible in principle but worth verifying)
- The pre-delete audit in Part 5 reveals an importer of the old editor files that we didn't anticipate (suggests scope was wider than expected)
- Documentation hygiene starts slipping

Otherwise, plough through Parts 1–5, walkthrough sign-off after Part 5, Part 6 close.

---

## Notes for Claude Code on the discipline pattern

This brief follows the pattern from Briefs 36, 39, 40, 41, 42, 43, 44, 45:

- Read everything before starting. Particularly the existing editor scaffolding (about to be deleted) and the main-app input controls (about to be reused).
- Each Part is one commit. Audit doc + STATUS.md updates land in same commit.
- Browser verification mandatory at Parts 3, 4, 5, 6. Code-side reasoning consistently underestimates UX-layer bugs in rebuilds.
- No engine changes. If a UI bug surfaces an engine issue, log to 29_open_issues.md and continue.
- Reuse main-app controls — do not build parallel UI. The whole point of this brief is that the editor uses the same controls as the main app.
- Bridgewater engine numbers are the falsifiability target. UI rebuild means engine output is unchanged.
- Full replace — no parallel paths after Part 5. The old editor exists only during the build to allow incremental verification.

Standing by for authorisation to begin Part 1.
