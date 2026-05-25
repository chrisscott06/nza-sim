# Brief 47 — Interventions layout and state (audit)

**Brief:** `docs/briefs/active/47_interventions_layout_and_state.md`
**Predecessor audit:** `docs/audit/46_inert_controls_diagnosis.md` (read-overlay)

---

## §0 Session-start reconciliation (2026-05-24)

Per Process Rule 8. Findings on first run:

- `docs/briefs/active/` contained `46_interventions_editor_rebuild.md` (Brief 46 had not been archived).
- `docs/briefs/current.md` pointed at Brief 46.
- STATUS.md's top-of-file section described the Brief 46 inert-controls fix as `commit_in_flight` even though the fix was committed at `70514e6` and pushed.
- Working tree: only pre-existing untracked files (validation sensitivity outputs from Brief 28b + `scripts/_wallmodel_debug.mjs` + `public/` folder). Same set STATUS.md notes were excluded from prior commits.
- `origin/main == local main == 70514e6`.

**Cleanup folded into Part 1's first commit** per Process Rule 8: Brief 46 archived → `archive/46_interventions_editor_rebuild_COMPLETED.md`; Brief 47 landed → `active/47_interventions_layout_and_state.md`; `current.md` updated; STATUS.md updated.

---

## §1 Part 1 — reopen-seed fix + list-level deletes + library removal

### §1.1 The reopen bug — confirmed diagnosis (read-only code trace)

Chris reproduced the bug at `70514e6` in the browser: editing an intervention works; saving works; reopening shows BASELINE values on every control while the engine numbers (EUI, footer Δ, stack waterfall) reflect the saved patches. The Brief 46 read-overlay was supposed to make controls show patched values; on reopen it doesn't.

**Mechanism (traced through React's render + effect ordering):**

The Brief 46 editor mounted `InterventionCaptureProvider` like this:
```jsx
<InterventionCaptureProvider
  intervention={{ ...intervention, patches: localPatches }}
  ...
>
```

The spread wraps the intervention prop's `patches` with the editor's local mirror `localPatches`. `localPatches` is seeded from `intervention.patches` via a useEffect on `[intervention?.id]`. That effect fires AFTER render. So on the render where the editor first opens an intervention:

| Step | What happens |
|---|---|
| 1 | Parent: `setEditingId(X.id)` → `editing = X` → `intervention` prop transitions from `null` to `X` (which carries the saved patches) |
| 2 | `InterventionEditorPopout` re-renders. Its `useState` initialiser already ran on prior mount: `localPatches = []` |
| 3 | The useEffect on `[intervention?.id]` is queued for after this render — has NOT fired yet |
| 4 | `isOpen = !!intervention = true` |
| 5 | `SchedulePopout`'s body, which had been returning `null` (see `if (!isOpen) return null`), now renders children for the first time this open cycle |
| 6 | `InterventionCaptureProvider` mounts. Its `useState` initialiser reads `intervention.patches` from props. The prop is `{...X, patches: localPatches}`. `localPatches` is `[]`. **`currentPatches` initialises to `[]`** |
| 7 | `PatchedProjectContextProvider` (inside the capture provider) computes `applyIntervention(baselineConfig, { patches: [] })` → returns baseline unchanged. Controls render baseline values |
| 8 | After render, `InterventionEditorPopout`'s `useEffect` fires: `setLocalPatches(X.patches)` |
| 9 | Re-render. `localPatches = X.patches`. `InterventionCaptureProvider` receives a new `intervention` prop but `useState` IGNORES prop changes after mount. Its `useEffect` on `[interventionId]` doesn't fire because `interventionId` hasn't changed (it was already `X.id` from step 6). **`currentPatches` stays `[]` forever** |
| 10 | Footer EUI still computes correctly because the EDITOR's preview engine uses `localPatches` directly via its own useMemo dependency — the engine path bypasses the capture context |

So the symptom Chris saw — engine numbers reflect saved state, controls don't — is exactly what this race produces.

**Sanity check on the "close-then-reopen of the same id" framing:** `SchedulePopout` returns `null` when `!isOpen`, so children fully unmount. On reopen the capture provider remounts and its `useState` initialiser re-runs. So the bug is NOT "useEffect with stale dep" in the sense of "id is unchanged across the close-reopen gap" — it's the race between the editor's `localPatches` effect and the capture provider's `useState` initialiser, on the SAME render where the provider first mounts.

### §1.2 The fix

Two changes, smallest possible:

**(a) `InterventionEditorPopout.jsx`** — pass `intervention` directly to the provider, not via the `{...intervention, patches: localPatches}` spread:
```diff
- <InterventionCaptureProvider intervention={{ ...intervention, patches: localPatches }} ...>
+ <InterventionCaptureProvider intervention={intervention} ...>
```

With this change, the capture provider's `useState` initialiser reads `intervention.patches` (= the SAVED patches) at mount-time. `currentPatches` initialises correctly. The `localPatches` mirror in the editor remains for the preview-engine useMemo dependency; it's also seeded from `intervention?.patches` and is now decoupled from the provider's seed.

**(b) `InterventionCaptureContext.jsx`** — deep-clone the seed on both `useState` init and the `[interventionId]` re-seed effect (per Part 1.2 — "seed is a copy, not a reference"):
```js
function cloneSavedPatches(patches) {
  if (!Array.isArray(patches)) return []
  if (typeof structuredClone === 'function') {
    try { return structuredClone(patches) } catch { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(patches))
}
const [currentPatches, setCurrentPatches] = useState(() => cloneSavedPatches(intervention?.patches))
```

This protects the persisted intervention from accidental mutation while editing. `Cancel` discards the cloned patches; `Save` writes them back through `onSave`. The same clone helper is added to `InterventionEditorPopout`'s `localPatches` for symmetry (it doesn't trigger the same bug, but the same hygiene applies).

### §1.3 Why "re-seed on open event" wasn't needed

Chris suggested in his amendment message: "likely re-seed on the open event, not on id-change." The deeper fix (passing `intervention` directly) makes that re-seed unnecessary because:

- The capture provider's `useState` initialiser runs ONCE on mount. Mount happens when `SchedulePopout` flips from `null` (closed) to rendering children (open). So the initialiser DOES re-run on every open — by virtue of the unmount-when-closed pattern.
- The previous bug was that the initialiser read stale `localPatches` from the editor's render-time state. By reading `intervention.patches` directly, we cut out the dependency chain entirely.

The `[interventionId]` re-seed effect is preserved for one specific case: the editor stays mounted but `intervention.id` changes (user clicks edit pencil on intervention B while editor is open on A). The Brief 41 Part 1 unsaved-changes guard intercepts this; if the user accepts the switch, the effect re-seeds `currentPatches` from B's saved patches.

### §1.4 Delete-intervention (list-level)

Added a `Trash2` icon button to each `InterventionRow`, after the existing Edit pencil. Hover red so it reads as destructive. Clicking invokes `onDelete(id)` → `handleListDelete` in `InterventionsModule`:

- Shows a confirm dialog (label + patch count + "cannot be undone").
- Filters the intervention out of `params.interventions` via `updateParam`.
- Closes the editor popout if the deleted intervention was being edited (clears `editingId` + `editorDirtyRef`).
- The engine re-runs through the standard `calculateInstant` useMemo chain because `params.interventions` changed; remaining interventions' `cumulative_delta` / `marginal_delta` recompute automatically per Brief 41 Part 2 mechanics.

The `Save` icon button (save-to-library) is removed from the row in the same change — see §1.6.

### §1.5 Delete-system-within-intervention (list-level)

Chris's amendment widened delete scope to systems-within-an-intervention, "visible up front" (without opening the per-system editor pop-out). Added a `Trash2` icon button to `SystemSummaryRow` (the compact row shown inside `InputsColumn` for each system). Confirm-before-delete dialog. Invokes a new `onDelete` prop, which `InputsColumn` wires to the existing `removeSystem(service, idx)` helper.

Routing semantics through Brief 46's Q2 design:
- **Main `/systems` page** (no capture context active): `removeSystem` → `writeV40(filteredList)` → `mutate('building.systems_config_v40', ...)` → `updateProject` (identity-by-construction).
- **Inside the intervention editor** (capture context active): same call → `mutate` → `capturePatch` → patched config now excludes the deleted system. The row disappears from the patched `systems_config_v40[service]` list on the next render — RC-3-style flow from the Brief 46 fix.

`SystemSummaryRow` renders the delete button only when `onDelete` is provided, so any pre-existing caller that hasn't been migrated stays safe. `InputsColumn` (the only caller today) is migrated.

### §1.6 Library removal (intervention library)

Per Brief 47 design note: "save-to-library / any library feature. Cut entirely. Within-project persistence + reopen-seeding makes it pointless."

Removed:
- `frontend/src/components/modules/interventions/InterventionLibrary.jsx` — deleted via `git rm`. Held `SaveToLibraryModal`, `LoadFromLibraryModal`, `LibraryStripButton`.
- `InterventionsModule.jsx` — removed the import, the `saveLibId` / `libraryPickerOpen` state, the `libraryInterventions` reads, the five `handleSaveToLibrary` / `handleCloseSaveLib` / `handleConfirmSaveLib` / `handleOpenLibrary` / `handleCloseLibrary` / `handleLoadFromLibrary` / `handleDeleteFromLibrary` handlers, the `LibraryStripButton` render at the top of the page, and both library modals at the bottom of the page.
- `InterventionRow.jsx` — removed the `Save` icon button + `onSaveToLibrary` prop.
- `InterventionStackView.jsx` — removed the `onSaveToLibrary` prop pass-through.

NOT removed:
- `params.library_interventions` field in `ProjectContext.jsx` `DEFAULT_PARAMS`. Existing projects may carry library entries from Brief 41–46 era; leaving the field avoids any data migration. No UI surface reads or writes it now.
- `params.library_systems` field. Brief 47 is scoped to the **intervention** library. The Systems module's "Save to library" affordance (saves a system to `params.library_systems`) is a Brief 40 feature on the main `/systems` page — out of scope. The `library_systems` array is also still passed in `libraryData` so the engine's `applyPatch` can resolve `source: 'library'` patches if any exist on stored interventions.
- `UnifiedScheduleEditor` (used by main app pages + by Brief 46's editor schedule sub-popout). Its `libraryMeta` prop is a naming overlap with the cut library feature but the component itself is the schedule editor — not the intervention library. Untouched.

### §1.7 Files changed (Part 1)

| File | Change |
|---|---|
| `frontend/src/context/InterventionCaptureContext.jsx` | Deep-clone helper + seed both useState init and `[interventionId]` re-seed effect |
| `frontend/src/components/modules/interventions/InterventionEditorPopout.jsx` | Pass `intervention` directly (not `{...intervention, patches: localPatches}`); deep-clone `localPatches` init/re-seed |
| `frontend/src/components/modules/interventions/InterventionRow.jsx` | Replaced Save-to-library icon with Trash2 delete button; `onDelete` prop |
| `frontend/src/components/modules/interventions/InterventionStackView.jsx` | Wired `onDelete` through; removed `onSaveToLibrary` |
| `frontend/src/components/modules/interventions/InterventionsModule.jsx` | Added `handleListDelete`; removed library imports/state/handlers/JSX |
| `frontend/src/components/modules/interventions/InterventionLibrary.jsx` | **DELETED** |
| `frontend/src/components/modules/systems/SystemSummaryRow.jsx` | Trash2 delete button + `onDelete` prop |
| `frontend/src/components/modules/SystemsModule.jsx` | InputsColumn wires `onDelete={() => removeSystem(service, idx)}` |
| `docs/briefs/active/47_interventions_layout_and_state.md` | NEW — brief landed |
| `docs/briefs/current.md` | Updated pointer to Brief 47 |
| `docs/briefs/archive/46_interventions_editor_rebuild_COMPLETED.md` | Brief 46 archived (renamed from `active/`) |
| `docs/audit/47_interventions_layout_and_state.md` | NEW — this doc |
| `STATUS.md` | Brief 46 marked closed; Brief 47 Part 1 entry added |

### §1.8 Verification

**Build:** `npm run build` clean — no compile errors.

**Browser verification of the five Part-2 checks:** deferred to Chris (the mandatory checkpoint after Part 2 commit per the brief). The reopen-bug fix in particular needs live confirmation that opening a saved intervention now shows its saved values on the controls.

**Engine invariance:** no engine code touched. Bridgewater clean-state baseline must still read ~121.7 (UI-only changes throughout).

---

## §2 Part 2 — change list + nav/control change flags

### §2.1 ChangeList — always-visible plain-English panel

**New file:** `frontend/src/components/modules/interventions/ChangeList.jsx`

Reads `currentPatches` from `useInterventionCapture()`. For each patch, renders a row using `summarizePatch` (the existing Brief 41 plain-English renderer): label · before → after · pct delta · revert button. Tone-coloured (green for improvements, red for regressions, neutral otherwise).

Mounted in `InterventionEditorPopout.jsx` `EditorBody` as a horizontal strip between the section body and the footer. Always visible regardless of which section is active in the right pane. Part 3 may relocate it as part of the inputs-left / visualiser-right restructure; the component is layout-agnostic.

Empty state explains the panel will populate as the user edits.

### §2.2 Live revert — patches reactive end-to-end

Each row's trash button calls `capture.revertPatch(id)`. That removes the patch from `currentPatches`; the provider's `onChange` fires; `localPatches` mirror updates; `PatchedProjectContextProvider` re-applies (without the reverted patch); the controls render baseline for that field; the footer's preview engine re-runs; the change list re-renders without the row. All in the same React batch — no async delay.

The same revert path works for patches authored interactively (capture from a slider drag) AND patches loaded from the saved intervention on reopen (now seeded into `currentPatches` by Part 1.1's fix). Reverting a SAVED patch is a normal edit operation; only Save commits the change back to `params.interventions`. Cancel discards.

### §2.3 Nav-level patch flags — extended to cover Brief 46's whole-snapshot patterns

**Discovery:** the existing `patchMatchesSection` / `patchMatchesSubsection` matchers in `EditorNav.jsx` (Brief 46 Part 1) used substring heuristics that broke for Brief 46's whole-object snapshot capture pattern. Examples:

| Capture path (Brief 46) | Subsection sub-id | Previous matcher | Result |
|---|---|---|---|
| `building.fabric` (q50 slider in AirtightnessSection) | `building.air_permeability` | `patchPath.includes('q50')` | ❌ false |
| `building.gains` (LightingSection / EquipmentSection) | `gains.lighting` / `gains.equipment` | `patchPath.includes('lighting')` etc. | ❌ false — neither word appears in `'building.gains'` |
| `building.systems_config_v40` (whole config from writeV40) | `systems.heating` etc. | `patchPath.includes('systems_config_v40.heating')` | ❌ false — `'building.systems_config_v40'` has no service suffix |
| `building.operable_openings` (whole array from OperationSection) | `operation.openings` | `patchPath.includes('openings')` | ✅ true (substring `'openings'` matches) |

So nav flags were silently broken for the most common edit patterns. The change list (Part 2.1) is what surfaces the patches reliably; the nav flags are the secondary "where are my changes" hint.

**Fix:** replaced the substring heuristics with two explicit dispatch functions:
- `patchOwnerSection(path)` — returns the EditorNav section id that owns this path, or null. Routes `building.occupancy` / `building.gains` / `building.schedules` to `gains`, `building.operable_openings` to `operation`, `building.systems_config_v40` to `systems`, everything else under `building.*` / `constructions.*` / `comfort_band.*` to `building`.
- `patchOwnerSubsection(path)` — returns the subsection id within the owner section, or null when the path is too coarse to attribute. Whole-config snapshots default to the first sub-item (e.g. `building.systems_config_v40` → `systems.heating`); when the patch path carries a service suffix the attribution is exact (e.g. `building.systems_config_v40.cooling[id=...].share_pct` → `systems.cooling`).

`patchMatchesSection` and `patchMatchesSubsection` are now thin wrappers around these dispatch functions — the dot rendering in `Section` and `SectionPatchDot` is unchanged.

### §2.4 PatchedInputBadge coverage — DISCOVERY: 0% across all four section types

**Audit finding:** Brief 46 Part 2b created `PatchedInputBadge.jsx` and exposed `useHasPatchOnPath` / `useRevertPathPatch` hooks, but the component was never wrapped around any input across Building / Internal Gains / Operation / Systems. `grep -rn 'PatchedInputBadge' frontend/src/components/modules/{building,gains,OperationModule.jsx,SystemsModule.jsx,systems}` returns zero matches.

This is the third documented "intent vs implementation" gap in Brief 46 (alongside RC-1 read-overlay and RC-2 schedule-handler stubs). The component is ready and well-shaped; per-input wiring is a mechanical pass that touches roughly 50 input sites across the four section libraries.

**Decision (recorded here per Process Rule 7):** I did NOT wrap inputs with PatchedInputBadge in Part 2. Reasons:
1. The scope is too large for the "working-and-saving" Part. Wrapping 50 inputs across four section libraries would have delayed the browser checkpoint.
2. The change list (§2.1) + the now-functional nav flags (§2.3) + the patched controls themselves showing patched VALUES (the Brief 46 fix) give the user three working ways to see what's changed without per-input badges. The badges would be a fourth view — useful but not blocking.
3. Wrapping is mechanical and best handled as a polish pass alongside the visualiser work in Part 4 (which already touches the same files).

The brief's Part 2.4 wording ("Confirm PatchedInputBadge marks every patched control... Where coverage is missing, extend it") is technically not satisfied; the audit doc records the gap explicitly so it's not buried.

### §2.5 Three-ways-to-see check (post-Part-2)

After Part 2 lands, an intervention with multiple patches across sections is visible:
1. **As patched control VALUES** (Brief 46 fix § read-overlay): q50 slider shows 25.0 not the baseline 4.64; the construction picker shows `cavity_wall_enhanced` not the baseline default.
2. **As nav flags** (§2.3): a coloured dot on `Building`, a smaller dot on `Air permeability` and on `Fabric`.
3. **In the change list** (§2.1): three rows in plain English with revert buttons.

The fourth way (per-input PatchedInputBadge dot beside each changed input) is deferred per §2.4.

### §2.6 Files changed (Part 2)

| File | Change |
|---|---|
| `frontend/src/components/modules/interventions/ChangeList.jsx` | NEW |
| `frontend/src/components/modules/interventions/InterventionEditorPopout.jsx` | Mount ChangeList in EditorBody; thread baselineConfig prop |
| `frontend/src/components/modules/interventions/EditorNav.jsx` | Replace substring matchers with explicit `patchOwnerSection` / `patchOwnerSubsection` dispatch |
| `docs/audit/47_interventions_layout_and_state.md` | §2 added |
| `STATUS.md` | Part 2 entry |

### §2.7 Verification

- `npm run build` clean (3210 modules).
- No engine code touched.
- **Browser verification is Chris's, at the mandatory checkpoint** (the brief's Part 2 close, before any Part 3 layout work). Five-check list reproduced in the surface message.

---

## §3 Part 3 — layout restructure: stack-left / visualiser-right + draggable-off-screen pop-outs

### §3.1 Stack relocated to left pane

`InterventionsModule.jsx` restructured from a centred `max-w-6xl` vertical container into a full-height horizontal split:

- **Header** (full-width top strip): module title + subtitle. Border-bottom separates from body.
- **Left pane** (fixed `w-[560px]`, scrollable): `InterventionStackView` carrying the baseline row, intervention rows (reorderable in place via the existing drag handles), and the "+ Add" affordance. Per-intervention actions on each row: select (opens editor via pencil), duplicate, delete (Brief 47 Part 1.3). Reorder triggers the existing engine useMemo chain — marginals/cumulatives recompute live.
- **Right pane** (flex-1, scrollable): visualiser surface. Part 3 ships a placeholder card explaining the switcher lands in Part 4. The visualiser will consume `baselineSummary` + `stackResult` (already-recomputed engine output from the existing useMemo chain) plus a Part 4 addition: the editor's in-progress patches lifted up so the visualiser updates live as the user edits in an off-screen pop-out.

The Stack | Comparison tab switcher is retired. `ComparisonView.jsx` stays in the repo (no import deleted yet) — Part 4 will decide whether the right-pane switcher fully subsumes it (likely; before/after view covers the comparison use case).

### §3.2 Off-screen-drag clamp loosened

`SchedulePopout.jsx`'s drag clamp previously kept 200 px of the popout sticking out of the left edge, which crowded the new right-pane visualiser. Loosened to a 60 px sliver:

```diff
- x: Math.max(-POPOUT_WIDTH + 200, Math.min(maxX, newX))
- y: Math.max(0, Math.min(maxY, newY))
+ const sliver = 60   // px kept visible at the edge
+ const minX = -POPOUT_WIDTH + sliver
+ const maxX = innerW - sliver
+ const maxY = innerH - 40
+ x: Math.max(minX, Math.min(maxX, newX))
+ y: Math.max(0,    Math.min(maxY, newY))
```

So a 1000 px-wide pop-out on a 1440 px viewport can be dragged so just a 60 px grab-strip is visible at either edge. The right-pane visualiser is fully visible while the editor sits off-screen left, or vice versa. "Drag to a second monitor" is technically not possible — the pop-out is HTML inside the browser window — but Chris's actual use case ("editor off to one side so the visualiser stays visible") works without browser-level multi-monitor support.

Applied to ALL pop-outs that share this chrome: the intervention editor itself, the nested schedule editor (Brief 46 fix), and `SystemEditorPopout`. Single edit, multi-site effect.

### §3.3 Z-index nesting — confirmed working

`SchedulePopout` renders at `z-50` with `position: fixed`. Three pop-outs can stack at the same z-index in the editor flow:

1. Outer `<SchedulePopout>` chrome of `InterventionEditorPopout` (z-50)
2. Nested `<SchedulePopout>` for the schedule editor (z-50, opens from IG/Operation/Systems composers via `EditorChromeContext`)
3. Nested `<SystemEditorPopout>` for per-system editing (z-50, opens from `InputsColumn`'s `SystemSummaryRow` edit pencil)

Same z-index: React render order wins. The nested editors render AFTER the parent in their respective JSX trees, so they stack above. Confirmed by static analysis — no z-trap. Brief 46 Q1's concern about nested popouts is resolved by this stacking order plus the loosened clamp.

### §3.4 Share-rebalance flow clarity

Brief 45 Part 3b's auto-rebalance — dragging one system's share slider automatically rebalances the other enabled systems in the same service so the enabled sum stays at 100 % — has been silent. Users can miss that partner sliders are moving simultaneously.

Two minimal clarity additions:

- **Tooltip on the share slider** (when 2+ enabled partners): "Share: 70 % of heating demand · drag to rebalance N partner system(s) (enabled sum stays = 100 %)."
- **Inline hint above the system list** (when `enabledCount >= 2` in a service): italic one-liner "Drag a share slider to rebalance partners — enabled sum stays at 100 %."

Both surface the auto-rebalance behaviour without disrupting the existing UI; both vanish for single-system services where there's no partner to rebalance.

### §3.5 Library — confirmed not back

Grep audit: `grep -rn 'LibraryStripButton|SaveToLibraryModal|LoadFromLibraryModal|library_interventions|onSaveToLibrary' frontend/src/components/modules/interventions/` returns:
- Two comment lines in `InterventionsModule.jsx` (explaining Brief 47 Part 1 removed them).
- One entry in `PatchedProjectContextProvider.jsx`'s `PASSTHROUGH_TOP_KEYS` allowlist (defensive — handles writes to `library_*` keys without capturing, never renders).

No UI surface mounts library components. No prop chain references `onSaveToLibrary`. Part 1's removal holds.

### §3.6 Files changed (Part 3)

| File | Change |
|---|---|
| `frontend/src/components/modules/interventions/InterventionsModule.jsx` | Full-width split layout: header strip → stack-left (w-[560px]) + visualiser-right placeholder; tab switcher retired; ComparisonView import removed |
| `frontend/src/components/shared/SchedulePopout.jsx` | Drag clamp loosened to 60 px sliver at edges (was 200 px / 80 px) |
| `frontend/src/components/modules/systems/SystemSummaryRow.jsx` | New `enabledPartnerCount` prop; share-slider tooltip describes auto-rebalance when partners exist |
| `frontend/src/components/modules/SystemsModule.jsx` | Pass `enabledPartnerCount` per row; inline "Drag a share slider to rebalance partners" hint above the system list when 2+ enabled |
| `docs/audit/47_interventions_layout_and_state.md` | §3 added |
| `STATUS.md` | Part 3 entry |

### §3.7 Verification

- `npm run build` clean.
- Engine unchanged.
- Layout verification deferred to Chris's Part 5 walkthrough (the brief promises browser verification at the walkthrough, not per Part after the Part 2 checkpoint).

---

## §4 Part 4 — right-pane visualiser views + PatchedInputBadge coverage

### §4.1 Visualiser view switcher

New directory: `frontend/src/components/modules/interventions/visualiser/`.

| File | Role |
|---|---|
| `VisualiserHost.jsx` | View switcher (Waterfall / Before-after / Heat balance) — header strip with 3 buttons; routes to the active view. Selection persisted in localStorage. |
| `BeforeAfterBars.jsx` | NEW — small two-bar comparison (Baseline vs After-stack) for EUI + Carbon. Reuses the engine's `stackResult.baseline` + walks back to the last enabled intervention's `result` for the cumulative. Tone-coloured delta pill. |
| `PhysicsView.jsx` | Reuses `HeatBalance` (Brief 28-IM) on the cumulative state. Header strip shows ΔEUI vs baseline for context. |

Per Brief 47 Principle 4 (reuse, don't rebuild): only `BeforeAfterBars` is new (and small). `EUIWaterfall` (Brief 45) and `HeatBalance` (Brief 28-IM) are imported and fed intervention-aware data via the existing `stackResult` / `result` shapes — no fork.

### §4.2 Live-update loop — editor → visualiser

The brief's hardest requirement: "Edit a value in the (off-screen) pop-out → the on-screen visualiser updates live."

Implementation (`InterventionsModule.jsx`):

1. **Lift in-progress patches from editor.** Added `onLivePatchesChange` callback prop to `InterventionEditorPopout`. The popout's existing `handleCapturedPatchesChange` (which mirrors the capture provider's `onChange` into `localPatches`) now ALSO calls `onLivePatchesChange(nextPatches)`. Identity: both callbacks fire from the same source, the local mirror and the parent mirror stay in lockstep.
2. **Local mirror in InterventionsModule.** New `livePatches` useState held by `InterventionsModule`. `handleLivePatchesChange` writes to it. Cleared on editor close / save / delete.
3. **Substitute into the engine pass.** New `paramsForEngine` useMemo: when `editingId` + `livePatches` are both present, build a synthetic interventions array where the editing intervention's saved `patches` are replaced with `livePatches`. Pass this to `calculateInstant`. When no editor is open / no live patches yet, `paramsForEngine === params` and the engine pass is identical to pre-Part-4 behaviour.
4. **Visualiser consumes.** `stackResult` is re-derived from the new engine result every render; all three visualiser views (`EUIWaterfall`, `BeforeAfterBars`, `PhysicsView`) consume `stackResult` and re-render in the same cycle.

End-to-end: user drags a slider in the off-screen editor → mutate fires → capturePatch → currentPatches updates → CaptureProvider's onChange → editor's handleCapturedPatchesChange → onLivePatchesChange → InterventionsModule's livePatches state → paramsForEngine memo re-derives → calculateInstant re-runs → stackResult new → all three views re-render. All in one React batch.

**Performance note.** Every slider drag now triggers two engine passes: one in the editor (for the footer's preview EUI) and one in the InterventionsModule (for the visualiser). React batches state updates; on a typical drag the user-perceived rate is the render rate (~60 fps), not the input rate. The two engine passes share most computation but aren't dedup'd. If perf becomes an issue, the editor's preview engine can be retired (the visualiser's pass covers the footer too) — deferred until needed.

### §4.3 PatchedInputBadge prefix-match + coverage

**Hook enhancement** (`frontend/src/hooks/useProjectMutation.js`):

`useHasPatchOnPath(path)` previously did exact-match against `patch.path`. Most Brief 46 capture patterns store whole-object snapshots at parent paths (`building.fabric`, `building.systems_config_v40`, `building.occupancy`, `building.gains`, `building.operable_openings`), so an exact-match badge at a granular leaf path (e.g. `building.fabric.air_permeability_q50`) would never fire.

Enhanced to also match when `patch.path` is a PREFIX of the queried `path`:
```js
return capture.currentPatches.some(p => {
  if (p.path === path) return true                  // exact
  if (path.startsWith(p.path + '.')) return true    // whole-snapshot covers this field
  return false
})
```

`useRevertPathPatch` updated with the same dispatch — clicking the badge always finds the covering patch and removes it. For whole-snapshot patches the revert undoes ALL fields in that snapshot; the user understands they're undoing whatever change introduced the captured patch.

**Coverage** — `PatchedInputBadge` now wraps:

| Section | Inputs wrapped | Path matched |
|---|---|---|
| **Building / Geometry** | Orientation slider | `building.orientation` |
| **Building / Glazing** | Per-face WWR slider (×4) | `building.wwr.<face>` |
| **Building / Shading** | Per-face shading depth slider (×4) | `building.shading_overhang.<face>` |
| **Building / Air permeability** | q50 slider | `building.fabric.air_permeability_q50` (prefix-matches `building.fabric`) |
| **Building / Comfort band** | Heating + cooling setpoint sliders | `comfort_band.lower_c` / `comfort_band.upper_c` |
| **IG / Occupancy** | Density number, Occupancy rate slider | `building.occupancy.density` / `building.occupancy.occupancy_rate` (prefix-matches `building.occupancy`) |
| **Operation / Openings** | Each OpeningRow | `building.operable_openings` (whole-row trigger) |
| **Systems** | Per-system share slider on SystemSummaryRow | `building.systems_config_v40.<service>` (prefix-matches `building.systems_config_v40`) |

**Limitation acknowledged.** Prefix-matching is broad. A single whole-snapshot patch at `building.systems_config_v40` lights up every system's share slider in every service — not just the one that changed. Same for `building.gains` → both lighting and equipment lit. Acceptable for now; the change list (`ChangeList.jsx`) is the ground-truth surface that shows exactly which patch was captured. Granular per-field capture patterns (e.g. `building.systems_config_v40.heating[id=X].share_pct`) would resolve this; deferred — they require refactoring the writeV40 / patchOccupancy / patchGains call shapes to emit field-level patches rather than whole-object snapshots, which is a Brief 41 patch-shape concern not a Brief 47 layout one.

**Not yet wrapped (deferred to follow-up polish):**
- Lighting / Equipment per-profile magnitude inputs inside `MultiProfileList` (the profile list component is shared across modules and editing it adds risk; section-level nav flag already fires).
- Per-opening fields inside OpeningRow's expanded editor (Cd / threshold / schedule_ref).
- Per-system fields inside SystemEditorPopout (efficiency / control mechanism / setpoint).

These are all wrapped at a parent level (per-row for OperationSection openings, per-section for IG profiles); per-field granularity is the polish pass.

### §4.4 Files changed (Part 4)

| File | Change |
|---|---|
| `frontend/src/hooks/useProjectMutation.js` | `useHasPatchOnPath` + `useRevertPathPatch` extended with prefix-match |
| `frontend/src/components/modules/interventions/visualiser/VisualiserHost.jsx` | NEW — view switcher |
| `frontend/src/components/modules/interventions/visualiser/BeforeAfterBars.jsx` | NEW — small two-bar comparison |
| `frontend/src/components/modules/interventions/visualiser/PhysicsView.jsx` | NEW — heat-balance reuse wrapper with ΔEUI badge |
| `frontend/src/components/modules/interventions/InterventionsModule.jsx` | `livePatches` state + `paramsForEngine` memo + VisualiserHost mounted in right pane |
| `frontend/src/components/modules/interventions/InterventionEditorPopout.jsx` | `onLivePatchesChange` callback added; fires alongside `handleCapturedPatchesChange` |
| `frontend/src/components/modules/building/buildingSections.jsx` | PatchedInputBadge wraps: orientation, q50, WWR (×4), shading (×4), comfort heating + cooling |
| `frontend/src/components/modules/gains/OccupancySection.jsx` | PatchedInputBadge wraps: density, occupancy rate |
| `frontend/src/components/modules/interventions/sections/OperationSection.jsx` | PatchedInputBadge wraps each OpeningRow |
| `frontend/src/components/modules/systems/SystemSummaryRow.jsx` | PatchedInputBadge wraps the per-service share slider |
| `docs/audit/47_interventions_layout_and_state.md` | §4 added |
| `STATUS.md` | Part 4 entry |

### §4.5 Verification

- `npm run build` clean.
- No engine code touched. `applyIntervention` / `calculateInstant` unchanged. Bridgewater anchor ~121.7 holds by construction.
- Browser verification: Chris's Part 5 walkthrough.

### §4.6 What Part 5 does

Bridgewater walkthrough end-to-end (the 15-item checklist in Brief 47 §Part 5). If clean, close commit + archive Brief 47. If anything anomalous, log to `docs/audit/29_open_issues.md` + diagnose + fix within Part 5.

---

---

## §5 Part 5 — walkthrough findings + close

### §5a Card redesign for the left-pane stack (2026-05-24, walkthrough finding #1)

**Finding (Chris at `40e0f6f` walkthrough):** the Part 3 horizontal-row layout for `InterventionRow` didn't fit the 560 px-wide left pane — labels truncated to the point of wrapping the "starting point" baseline subtitle onto multiple lines, the four delta columns (`Marg ΔEUI` / `Marg ΔCO₂` / `Cum ΔEUI` / `Cum ΔCO₂` at `w-24` each = 384 px before action icons) crowded the label, and the three action icons (duplicate / edit / delete) at the right edge were too small + too cramped to register as actions.

**Fix:** rebuild as a card.

`InterventionRow.jsx` now renders:

```
┌──────────────────────────────────────────────────────────┐
│ ⠿ ● Label                            [⧉ Dup] [✏ Edit] [🗑]│
│       n patch(es): plain-English summary…                │
│       ⚠ Overridden by a later intervention (if any)      │
│ ┌────────┬───────────┬───────────┬────────────┐          │
│ │        │ Marginal  │ Cumulative│   unit     │          │
│ ├────────┼───────────┼───────────┼────────────┤          │
│ │ ΔEUI   │ +1.6      │ +1.6      │ kWh/m²·yr  │          │
│ │ ΔCO₂   │ +0.3      │ +0.3      │ kgCO₂/m²·yr│          │
│ └────────┴───────────┴───────────┴────────────┘          │
└──────────────────────────────────────────────────────────┘
```

Action icons (Duplicate / Edit / Delete) live in a small toolbar at the top-right, each a `p-1.5` button with a hover background, the icon at `size={13}` (was 12 in tighter spaces). Delete is hover-red.

`BaselineRow` rebuilt to match — a `p-3` card with a "Baseline · starting point" header and a small 2-row table showing the absolute baseline EUI + Carbon. No marginal/cumulative columns (meaningless for baseline).

`InterventionStackView`'s column-header strip retired — each card now carries its own labelled metrics, the global header is redundant and was the cause of the squeeze.

**Files changed (Part 5a):**

| File | Change |
|---|---|
| `frontend/src/components/modules/interventions/InterventionRow.jsx` | Full rewrite — card layout, prominent action toolbar, compact 2×2 metrics table with unit column |
| `frontend/src/components/modules/interventions/InterventionStackView.jsx` | BaselineRow rebuilt to match card shape; column-header strip removed |
| `docs/audit/47_interventions_layout_and_state.md` | §5a added |
| `STATUS.md` | Part 5a entry |

**Verification:** `npm run build` clean. Engine unchanged. Returns to walkthrough.

---

### §5b Waterfall chart redesign — stepped vertical SVG (2026-05-24, walkthrough finding #2)

**Finding (Chris at `22dc620` walkthrough):** the Brief 45 horizontal-bar `EUIWaterfall` reads as a list of bars rather than a waterfall. Asked to rebuild in the classic Excel "Increase / Decrease / Total" stepped-vertical shape.

**Fix:** full rewrite of `EUIWaterfall.jsx`.

New shape:
- Anchor columns at start (Baseline) and end (After stack) — full grounded bars from 0 to the absolute EUI, slate-grey.
- Per-intervention floating bars between them — each bar's height = abs(marginal delta), positioned between the previous cumulative and the new cumulative. Green for savings (delta < 0), red for increases (delta > 0), neutral grey for disabled / empty / zero.
- Dashed step connectors between consecutive bars at the running-total y-position so the eye reads the trajectory at a glance.
- Y-axis with "nice" ticks (multiples of 10/20/25/50 chosen automatically), kWh/m²·yr label rotated on the left.
- X-axis with intervention labels (truncated with `<title>` tooltip when long), and a sub-label showing the running total after each step.
- Legend strip above (Total / Saving / Increase / Disabled).

Implementation:
- Pure SVG, no chart library — 220 lines including the docstring.
- Fixed `colW = 88 px`, horizontal scroll if many interventions (each column stays legible regardless of total count).
- Inner height 280 px, total height ~366 px including padding + axis labels.
- `buildSeries` computes the per-step from/to values once, walking the engine's `consumption.interventions[]` marginal deltas. Reuses the same `pullEui` / `pullMarginalDelta` fallback lists the previous version used — no engine-shape change.
- `buildYAxis` picks a "nice" max via a step-magnitude lookup ([10, 20, 25, 50, 100, 200, 250, 500, …]); ticks at fifths.

Brief 45 §4 principle held: presentation-only, no new computation, no engine call.

**Files changed (Part 5b):**

| File | Change |
|---|---|
| `frontend/src/components/modules/interventions/EUIWaterfall.jsx` | Full rewrite — stepped vertical SVG |
| `docs/audit/47_interventions_layout_and_state.md` | §5b added |
| `STATUS.md` | Part 5b entry |

**Verification:** `npm run build` clean (3214 modules). Engine untouched. Returns to walkthrough.

---

### §5c Collapsible intervention cards (2026-05-24, walkthrough finding #3)

**Finding (Chris):** the Part 5a card layout is good, but the full-card-always-expanded shape adds vertical bulk to every row — drag-reorder of a long stack means scrolling past metrics tables to reach the target. Asked to make each card collapsible so the default state shows just label + actions + drag handle.

**Fix:**

- Each `InterventionRow` now has local `expanded` state, default `false`. Toggled by either clicking the label OR clicking a dedicated chevron button between the label and the action toolbar. The chevron carries `aria-expanded` so screen readers get the affordance.
- **Collapsed state** (default): single-line row — drag handle · enable dot · label · `· N patches` badge (or `· no patches` italic when empty) · override warning icon (if any) · theme pill · chevron-right · action toolbar (Duplicate / Edit / Delete). Vertical padding tightened to `px-3 py-2`.
- **Expanded state**: chevron-down · everything above PLUS the indented patch-summary block · override warning text · metrics table. Vertical padding bumped to `p-3` for breathing room.
- Click semantics: clicking the LABEL toggles expand (cheap discovery — the chevron is small). Clicking the PENCIL ICON edits. The two are independent buttons so the gestures don't fight.
- `InterventionStackView` inter-card gap tightened from `space-y-3` → `space-y-1.5` so a long collapsed stack packs tightly enough that drag-reorder lands within a single viewport without scroll.

**Persistence:** none. Each row's expand state lives in row-local `useState`, no localStorage. Defaults to collapsed on every render. Acceptable for now; if Chris wants individual rows to remember their state across reloads I can lift to localStorage with per-intervention-id keys (small follow-up).

**Files changed (Part 5c):**

| File | Change |
|---|---|
| `frontend/src/components/modules/interventions/InterventionRow.jsx` | Added `expanded` state, chevron toggle, conditional collapsed-vs-expanded layout |
| `frontend/src/components/modules/interventions/InterventionStackView.jsx` | Inter-card gap `space-y-3` → `space-y-1.5` |
| `docs/audit/47_interventions_layout_and_state.md` | §5c added |
| `STATUS.md` | Part 5c entry |

**Verification:** `npm run build` clean. Engine untouched.

---
