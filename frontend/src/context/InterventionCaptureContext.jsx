/**
 * InterventionCaptureContext.jsx — Brief 46 Part 1 (2026-05-21)
 *
 * React context that wraps the intervention editor's subtree. While the
 * editor is mounted, any call to `useProjectMutation().mutate(path, value,
 * op?)` from within the wrapped subtree routes the change into a captured
 * patch list rather than a direct ProjectContext write. Outside the editor
 * (i.e. anywhere on the main app — Building, Internal Gains, Operation,
 * Systems pages), the same `useProjectMutation` hook routes through
 * ProjectContext as today.
 *
 * This is the central architectural piece for Brief 46:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Main app (no capture context active)                         │
 *   │   <BuildingPage>                                              │
 *   │     <ConstructionPicker>                                      │
 *   │       useProjectMutation().mutate('constructions.wall', X)    │
 *   │       → goes through to ProjectContext.updateConstruction     │
 *   └──────────────────────────────────────────────────────────────┘
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Intervention editor (capture context active)                  │
 *   │   <InterventionCaptureProvider>                               │
 *   │     <BuildingSection>                                         │
 *   │       <ConstructionPicker>                                    │
 *   │         useProjectMutation().mutate('constructions.wall', X)  │
 *   │         → goes through to capturePatch — does NOT write       │
 *   │           through to project state                            │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Same component, same call, different mutation target. That's the
 * point — reuse main-app controls inside the editor without parallel UI.
 *
 * Public API:
 *   - `<InterventionCaptureProvider intervention={…} baselineConfig={…}
 *      onChange={(patches) => void} children />`
 *   - `useInterventionCapture()` — hook exposing:
 *       { isCapturing: boolean
 *         interventionId: string | null
 *         currentPatches: Patch[]
 *         capturePatch(patch | (path, op, value, source?))
 *         revertPatch(patchId)
 *         resetPatches()        // clear all captured patches
 *       }
 *
 * NOT IN PUBLIC API (intentionally):
 *   - `previewState` — the engine output of (baseline + currentPatches)
 *     lives outside this context (the editor's parent computes it via
 *     `applyIntervention` + `calculateInstant` so the engine path stays
 *     unchanged). This context owns the patches list; the consumer owns
 *     the engine run.
 *
 * Patch shape: see `docs/audit/41_interventions_schema.md` § "Patch
 * shape" — { id, op, path, value, source, match?, schema_version }.
 * Brief 46 does not change this shape.
 *
 * Dedupe semantics: same as `patchCapture.capturePatch` from Brief 41
 * — last-write-wins per (op, path). We reuse the same dedupe helper so
 * the editor V2 behaves identically to the old curated editor at the
 * patch-list level.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, useEffect } from 'react'
import { capturePatch as patchCaptureMerge, newPatchId, removePatch } from '../components/modules/interventions/patchCapture.js'

/**
 * Deep-clone an array of patches. Brief 47 Part 1.2: the seed must be a
 * COPY of the saved patches so editing in the editor doesn't mutate the
 * persisted intervention until Save. Cancel discards cleanly.
 *
 * structuredClone where available; JSON fallback otherwise (patches are
 * pure JSON-shaped objects per Brief 41 schema, so the fallback is safe
 * — no Dates, no Maps, no functions in the patch shape).
 */
function cloneSavedPatches(patches) {
  if (!Array.isArray(patches)) return []
  if (typeof structuredClone === 'function') {
    try { return structuredClone(patches) } catch { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(patches))
}

// ── Context shape ────────────────────────────────────────────────────────

/**
 * Default value when no provider mounted. `isCapturing` is false — any
 * `useProjectMutation` call from outside an editor will see the default
 * and route through ProjectContext.
 */
const DEFAULT_VALUE = {
  isCapturing: false,
  interventionId: null,
  currentPatches: [],
  capturePatch: () => {},
  revertPatch: () => {},
  resetPatches: () => {},
}

export const InterventionCaptureContext = createContext(DEFAULT_VALUE)

/**
 * Hook: read the capture context from inside any component that wants to
 * know whether it's being edited inside an intervention or live on the
 * main app. The `useProjectMutation` hook in `frontend/src/hooks/
 * useProjectMutation.js` is the primary consumer. Component code rarely
 * calls this directly — it should use `useProjectMutation` instead.
 */
export function useInterventionCapture() {
  return useContext(InterventionCaptureContext)
}

// ── Provider ────────────────────────────────────────────────────────────

/**
 * Provider mounted by the intervention editor pop-out. Carries:
 *   - The intervention being edited (`intervention` prop).
 *   - A baseline config snapshot (`baselineConfig` prop) — used by the
 *     consumer to compute the preview engine result.
 *   - The running list of captured patches in local state.
 *   - Dispatch helpers `capturePatch`, `revertPatch`, `resetPatches`.
 *
 * The provider lifts `currentPatches` to local state. The consumer
 * (editor footer, EUI delta strip, patch list) reads via
 * `useInterventionCapture()`. Whenever the patches change, `onChange`
 * fires so the consumer can persist on Save / mark dirty / etc.
 *
 * Note on `intervention.patches` seeding: when the editor opens on an
 * existing intervention, the existing patches are seeded into the
 * provider's local state. New captures append (dedupe via patchCapture).
 * Revert removes a patch by id. Reset clears all.
 *
 * Note on the patchCapture helper reuse: `patchCaptureMerge` from
 * `patchCapture.js` handles the same dedupe rules the old curated editor
 * used. Brief 46 Part 5 removes the old editor but keeps these helpers
 * exported because the new editor depends on them.
 */
export function InterventionCaptureProvider({
  intervention,
  baselineConfig,
  onChange,
  children,
}) {
  const interventionId = intervention?.id ?? null

  // Seed local state from the intervention's saved patches when the
  // provider mounts or the intervention id changes (i.e. editor switches
  // to a different row). Stored in state, not derived, so user captures
  // accumulate locally until Save.
  //
  // Brief 47 Part 1.1 + 1.2 (2026-05-24): the seed reads
  // `intervention.patches` directly from props. The parent must pass
  // `intervention` directly (NOT `{...intervention, patches: localPatches}`)
  // so that on the render where this provider first mounts, the saved
  // patches are visible. Brief 46's `{ ...intervention, patches:
  // localPatches }` spread caused the reopen bug — `localPatches` was []
  // on the first render where this provider mounted, so currentPatches
  // initialised to [] and the read-overlay had nothing to apply. The
  // useEffect re-seed below ran after-render but didn't fire because
  // `interventionId` hadn't changed.
  //
  // The seed is a DEEP CLONE of the saved patches so editing here doesn't
  // mutate the persisted intervention until Save. Cancel discards cleanly.
  const [currentPatches, setCurrentPatches] = useState(
    () => cloneSavedPatches(intervention?.patches)
  )

  // Re-seed when intervention id changes (editor switches to a different
  // row WITHOUT unmounting — e.g. user clicks edit pencil on intervention
  // B while editor is open on A). Close-then-reopen of the same id is
  // handled by SchedulePopout's unmount-when-closed pattern: the
  // CaptureProvider remounts and the useState initialiser above re-runs
  // with the fresh `intervention.patches`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setCurrentPatches(cloneSavedPatches(intervention?.patches))
  }, [interventionId])

  // Notify the consumer on every patches change so it can mark dirty,
  // recompute the preview engine result, persist on Save, etc.
  const lastNotifiedRef = useRef(currentPatches)
  useEffect(() => {
    if (lastNotifiedRef.current !== currentPatches) {
      lastNotifiedRef.current = currentPatches
      onChange?.(currentPatches)
    }
  }, [currentPatches, onChange])

  /**
   * Capture a patch. Two call signatures supported for flexibility:
   *
   *   capturePatch({ id, op, path, value, source, match? })
   *   capturePatch(path, op, value, source?)
   *
   * The second form auto-generates an `id` and defaults `source` to
   * `'inline'`. Dedupe via patchCapture.capturePatch.
   */
  const capturePatch = useCallback((arg1, arg2, arg3, arg4) => {
    let patch
    if (typeof arg1 === 'string') {
      // (path, op, value, source?) form
      patch = {
        id: newPatchId(),
        path: arg1,
        op: arg2 ?? 'set',
        value: arg3,
        source: arg4 ?? 'inline',
      }
    } else if (arg1 && typeof arg1 === 'object') {
      // ({ id, op, path, value, ... }) form
      patch = { id: arg1.id ?? newPatchId(), source: 'inline', op: 'set', ...arg1 }
    } else {
      return  // malformed; no-op
    }
    setCurrentPatches(prev => patchCaptureMerge(prev, patch))
  }, [])

  const revertPatch = useCallback((patchId) => {
    setCurrentPatches(prev => removePatch(prev, patchId))
  }, [])

  const resetPatches = useCallback(() => {
    setCurrentPatches([])
  }, [])

  const value = useMemo(() => ({
    isCapturing: true,
    interventionId,
    currentPatches,
    capturePatch,
    revertPatch,
    resetPatches,
    baselineConfig,   // exposed so deep consumers can resolve relative paths if needed
  }), [interventionId, currentPatches, capturePatch, revertPatch, resetPatches, baselineConfig])

  return (
    <InterventionCaptureContext.Provider value={value}>
      {children}
    </InterventionCaptureContext.Provider>
  )
}
