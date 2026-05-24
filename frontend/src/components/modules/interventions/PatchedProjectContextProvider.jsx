/**
 * PatchedProjectContextProvider.jsx — Brief 46 Part 6 fix (2026-05-22)
 *
 * The read-overlay layer that closes the gap left by Brief 46 Parts 2c-5.
 *
 * Problem (audit doc `46_inert_controls_diagnosis.md` §2 RC-1):
 *   Parts 2c-4 refactored every Building / IG / Operation / Systems
 *   mutation through `useProjectMutation` so writes route to
 *   `capturePatch` in the editor's capture context. But the section
 *   components STILL read display values from `useContext(ProjectContext)`
 *   — i.e. baseline `params`, NOT baseline + currentPatches. Result:
 *   sliders snap back, toggles don't move, add/delete don't register.
 *
 * Fix:
 *   Nest a second `ProjectContext.Provider` inside the editor subtree
 *   that returns patched values for `params`, `constructions`, `systems`,
 *   `comfortBand`. Any component below in the tree that calls
 *   `useContext(ProjectContext)` gets the patched data — including the
 *   shared section components (GeometrySection, OccupancySection,
 *   InputsColumn, OpeningRow, etc.). Reads and writes now flow through
 *   the same data path; React's controlled-input pattern works again.
 *
 * Mutator overrides (defensive):
 *   The Parts 2c-4 refactor moved nearly every direct write call to
 *   `mutate()` already (which routes through the capture context).
 *   But a few direct calls remain — `saveSystemToLibrary` calls
 *   `updateParam('library_systems', …)`, `updateConstruction` in
 *   FabricSection's construction picker, `setComfortBand` in legacy
 *   widgets, etc. The patched provider also overrides these mutators
 *   to route through `capturePatch` (with a PASSTHROUGH set for
 *   intentional cross-intervention writes like library / interventions).
 *
 * RC-2 (schedule editor stubs) is fixed by a sibling change in
 * `InterventionEditorPopout.jsx`, not here.
 *
 * Important invariants:
 *   - Outside capture mode (main app): renders children unchanged. The
 *     outer ProjectContext is unaffected.
 *   - The provider does NOT modify the underlying baseline ProjectContext.
 *     Patches live only in the capture context's local state; they're
 *     committed to the intervention's `patches[]` on Save.
 *   - applyIntervention is used to compute patched config — same helper
 *     the engine uses, so the displayed state matches what the engine
 *     would compute against the same patch list. No second source of
 *     truth.
 */

import { useContext, useMemo } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { useInterventionCapture } from '../../../context/InterventionCaptureContext.jsx'
import { applyIntervention } from '../../../utils/interventionsEngine.js'

// Top-level keys that should NOT be captured as intervention patches
// when written via direct updateParam — they live across interventions
// (the library) or describe the stack itself (interventions).
const PASSTHROUGH_TOP_KEYS = new Set([
  'library_systems',
  'library_schedules',
  'library_constructions',
  'library_interventions',
  'interventions',
])

export default function PatchedProjectContextProvider({ baselineConfig, children }) {
  const outer = useContext(ProjectContext)
  const capture = useInterventionCapture()

  // Patched config (applyIntervention against baseline + currentPatches).
  // Falls back to null when not capturing — children render against outer.
  const patched = useMemo(() => {
    if (!capture?.isCapturing) return null
    if (!baselineConfig) return null
    try {
      return applyIntervention(
        baselineConfig,
        { enabled: true, patches: capture.currentPatches ?? [] },
        baselineConfig.libraryData,
      )
    } catch (err) {
      console.warn('[PatchedProjectContextProvider] applyIntervention threw:', err)
      return null
    }
  }, [capture, baselineConfig])

  // comfort_band patches live at top-level paths like 'comfort_band.lower_c'
  // — they're not on the config shape applyIntervention walks (which is
  // { building, constructions, systems, libraryData }). Merge them
  // separately so the comfort-band slider holds position. The engine
  // preview honouring comfort_band patches is a follow-up; this fix is
  // strictly about the UI not snapping back.
  const patchedComfortBand = useMemo(() => {
    if (!capture?.isCapturing) return outer?.comfortBand
    const base = outer?.comfortBand ?? { lower_c: 20, upper_c: 26 }
    const cbPatches = (capture.currentPatches ?? []).filter(
      p => typeof p?.path === 'string' && p.path.startsWith('comfort_band.')
    )
    return cbPatches.reduce((acc, p) => {
      const key = p.path.slice('comfort_band.'.length)
      return { ...acc, [key]: p.value }
    }, { ...base })
  }, [capture, outer?.comfortBand])

  const value = useMemo(() => {
    if (!outer) return null
    if (!capture?.isCapturing || !patched) return outer

    // Capture-routed mutator overrides. The Parts 2c-4 refactor already
    // routes most writes through useProjectMutation; these wrappers
    // catch the remaining direct calls.
    const wrappedUpdateParam = (key, value) => {
      if (PASSTHROUGH_TOP_KEYS.has(key)) {
        outer.updateParam?.(key, value)
        return
      }
      // comfort_band edits are stored via setComfortBand below — if a
      // direct updateParam('comfort_band', …) lands here, capture with
      // the top-level 'comfort_band' path (rare; defensive).
      const path = key === 'comfort_band' ? 'comfort_band' : `building.${key}`
      capture.capturePatch({ path, op: 'set', value })
    }

    const wrappedUpdateConstruction = (key, value) => {
      capture.capturePatch({ path: `constructions.${key}`, op: 'set', value })
    }

    const wrappedUpdateSystem = (...args) => {
      // Legacy v25 updateSystem — rarely used post Brief 40. Capture as
      // a whole-systems-array snapshot for safety.
      capture.capturePatch({ path: 'systems', op: 'set', value: args[args.length - 1] })
    }

    const wrappedSetComfortBand = (patch) => {
      // setComfortBand({ lower_c: X }) → capture comfort_band.lower_c
      // Mirrors useProjectMutation's comfort_band branch.
      if (!patch || typeof patch !== 'object') return
      for (const k of Object.keys(patch)) {
        capture.capturePatch({ path: `comfort_band.${k}`, op: 'set', value: patch[k] })
      }
    }

    return {
      ...outer,
      params:         patched.building,
      constructions:  patched.constructions,
      systems:        patched.systems,
      comfortBand:    patchedComfortBand,
      updateParam:        wrappedUpdateParam,
      updateConstruction: wrappedUpdateConstruction,
      updateSystem:       wrappedUpdateSystem,
      setComfortBand:     wrappedSetComfortBand,
    }
  }, [outer, capture, patched, patchedComfortBand])

  // When not capturing or outer missing, render children unchanged.
  if (!value || !capture?.isCapturing) return children

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  )
}
