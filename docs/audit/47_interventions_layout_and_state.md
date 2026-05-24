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

(To be filled by the Part 2 commit.)

---

## §3 Part 3 — layout restructure

(To be filled by the Part 3 commit, post browser-verification checkpoint.)

---

## §4 Part 4 — visualiser views

(To be filled.)

---

## §5 Part 5 — walkthrough + close

(To be filled.)
