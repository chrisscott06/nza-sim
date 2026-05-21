/**
 * useProjectMutation.js — Brief 46 Part 1 (2026-05-21)
 *
 * The single mutation entry point that Building / Internal Gains /
 * Operation / Systems components use instead of calling
 * `updateParam` / `updateConstruction` / `updateSystem` directly on
 * ProjectContext.
 *
 * Usage:
 *
 *   const { mutate } = useProjectMutation()
 *   mutate('building.length', 60)
 *   mutate('constructions.external_wall', { id: 'cavity_wall_enhanced', … })
 *   mutate('systems_config_v40.heating[id=sys_x].share_pct', 70)
 *   mutate('schedules.occupancy_1.weekday', [...new hours], 'set')
 *   mutate('systems_config_v40.heating', newSystem, 'add')
 *
 * Routing rules:
 *
 *   1. If `InterventionCaptureContext.isCapturing === true`
 *      (i.e. the call originated from inside the intervention editor's
 *      subtree), the mutation routes to `capturePatch(path, op, value)`
 *      — captures a patch against the baseline; does NOT write through
 *      to project state. The intervention is responsible for committing
 *      its patches on Save.
 *
 *   2. Otherwise (main-app), the path is parsed and routed to the
 *      appropriate ProjectContext mutation. Top-level path segments:
 *        - `building.<rest>`            → updateParam( <rest>, value )
 *           (Building params, geometry, openings, comfort_band live
 *            directly on params; the 'building.' prefix is a Brief 41
 *            patch path convention, NOT a nested params.building object.
 *            The hook strips it before routing.)
 *        - `constructions.<key>`        → updateConstruction(key, value)
 *        - `systems_config_v40.<rest>`  → updateParam('systems_config_v40',
 *                                          deepMerge(existing, patched))
 *        - `schedules.<id>`             → updateParam('schedules',
 *                                          { …existing, [id]: value })
 *        - `interventions`              → updateParam('interventions', value)
 *        - `library_*`                  → updateParam(top-level key, value)
 *        - Any other top-level prefix   → updateParam(prefix, value)
 *           (graceful fallback — best-effort write)
 *
 * Parts 2-4 of Brief 46 refactor every Building / IG / Operation /
 * Systems mutation entry point to call this hook. Part 1 lands the
 * hook with the routing table but DOES NOT refactor any callers yet.
 *
 * Brief 41 patch-path convention:
 *   Patches use paths like `building.systems_config_v40.heating[id=X]
 *   .share_pct`. The `building.` prefix is conventional — see
 *   `docs/audit/41_interventions_schema.md` §4 "Patch path conventions".
 *   When in capture mode, we preserve the original path verbatim
 *   (engine's applyPatch handles `building.<rest>` correctly). When
 *   falling through to ProjectContext, we strip the `building.` prefix
 *   because ProjectContext.updateParam writes directly to params (no
 *   nested 'building' object in the live state).
 */

import { useCallback, useContext, useMemo } from 'react'
import { ProjectContext } from '../context/ProjectContext.jsx'
import { useInterventionCapture } from '../context/InterventionCaptureContext.jsx'

// ── Path parsing ────────────────────────────────────────────────────────

/**
 * Strip a leading "building." prefix from a Brief 41-style patch path.
 * Patches address `building.<rest>` by convention; ProjectContext stores
 * those fields directly on `params`. When falling through to
 * ProjectContext, we strip the prefix so the live mutation target is
 * correct.
 */
function stripBuildingPrefix(path) {
  if (typeof path !== 'string') return path
  if (path.startsWith('building.')) return path.slice('building.'.length)
  return path
}

/**
 * Get the top-level key from a path. For `systems_config_v40.heating
 * [id=X].share_pct` this returns `systems_config_v40`.
 */
function topKey(path) {
  if (typeof path !== 'string') return null
  const dot = path.indexOf('.')
  const bracket = path.indexOf('[')
  const end = (dot === -1) ? bracket : (bracket === -1 ? dot : Math.min(dot, bracket))
  return end === -1 ? path : path.slice(0, end)
}

/**
 * Get the immediate child key after the top key. For
 * `constructions.external_wall` this returns `external_wall`.
 * Returns null when the path has no segment after the top.
 */
function secondKey(path) {
  const t = topKey(path)
  if (!t) return null
  const rest = path.slice(t.length)
  if (rest.startsWith('.')) {
    const after = rest.slice(1)
    const dot = after.indexOf('.')
    const bracket = after.indexOf('[')
    const end = (dot === -1) ? bracket : (bracket === -1 ? dot : Math.min(dot, bracket))
    return end === -1 ? after : after.slice(0, end)
  }
  return null
}

// ── Building's deep-merge keys ──────────────────────────────────────────
//
// `ProjectContext.updateParam` performs partial-merge for these keys
// (e.g. `updateParam('wwr', { north: 0.4 })` merges into the existing
// `params.wwr` object rather than replacing). Components historically
// rely on this — they pass partials, not full objects.
//
// Brief 46 Part 2 delegate-to-existing-helpers design: when the hook
// receives a 2-segment path under one of these keys (e.g.
// `building.wwr.north`), it routes to `updateParam(top, { sub: value })`
// — exactly the partial-merge call shape that components used pre-
// refactor. The capture-mode side uses the verbatim deep path; the
// engine's applyPatch handles the deep navigation correctly. The
// asymmetry between the two modes IS the design — see audit doc 46
// §1.8 question 2 (delegate-to-existing-helpers, no generic deep-merge).
const BUILDING_DEEP_MERGE_KEYS = new Set([
  'wwr',                  // per-face glazing ratio
  'window_count',         // per-face window count
  'location',             // per-field location (name / latitude / longitude)
  'shading_overhang',     // per-face overhang (depth_m / offset_m)
  'shading_fin',          // per-face fin (left_depth_m / right_depth_m)
  'openings',             // per-face opening fields (louvre_area_m2 / cd / flow_mode etc) + site_exposure
])

// ── Hook ────────────────────────────────────────────────────────────────

/**
 * Returns `{ mutate, isCapturing }`. `mutate(path, value, op?)` is the
 * single entry point components use; `isCapturing` lets callers branch
 * on whether they're inside an intervention editor (e.g. to render
 * visible-change indicators).
 *
 * Capture-mode call: every path captured verbatim as a Brief-41 patch.
 * Main-app call: dispatched by path-prefix to the appropriate existing
 * ProjectContext helper (`updateParam`, `updateConstruction`,
 * `setComfortBand`, and — when Part 4 lands — `updateSystem`).
 *
 * The asymmetry is the point. Existing helpers encode the right
 * semantics for their slice (key-specific deep-merge in `updateParam`,
 * array-index lookups, system-id matching, share-validation triggers).
 * A generic deep-merge would either lose that semantics or duplicate
 * it. Main-app must remain behaviourally identical per Brief 46
 * Principle 11 (no main-app behavioural changes).
 */
export function useProjectMutation() {
  const capture = useInterventionCapture()
  const projectCtx = useContext(ProjectContext)

  const mutate = useCallback((path, value, op = 'set') => {
    if (path == null) return

    // ── Path 1: capture mode ──────────────────────────────────────────
    if (capture?.isCapturing) {
      // Preserve the original path verbatim. The engine's applyPatch
      // resolves `building.<rest>` correctly against the patched root.
      capture.capturePatch({ path, op, value, source: 'inline' })
      return
    }

    // ── Path 2: main-app fallthrough ──────────────────────────────────
    if (!projectCtx) return  // dev safety — ProjectContext should always be mounted in app

    // Strip the conventional `building.` prefix because ProjectContext's
    // live state is flat on params (no nested 'building' object).
    const stripped = stripBuildingPrefix(path)
    const top = topKey(stripped)

    // Structural ops on arrays (`add` / `remove` / `replace`) in
    // main-app mode aren't routable through a generic helper — each
    // module exposes its own structural mutator (`addSystem`,
    // `removeSystem`, etc.). Brief 46 Part 4 will add a
    // `systems_config_v40` branch that routes structural ops to those
    // helpers. Until then, surface the limitation in dev console.
    if (op !== 'set') {
      if (typeof console !== 'undefined') {
        console.warn(
          `[useProjectMutation] op='${op}' on path '${stripped}' in main-app mode is not yet routable; ` +
          `caller should keep using its existing structural mutator (addSystem / removeSystem / etc.) ` +
          `until Brief 46 Part 4 lands the systems_config_v40 branch. Capture-mode is unaffected.`
        )
      }
      return
    }

    // Dispatch by top-level path key — delegate-to-existing-helpers.
    switch (top) {
      case 'constructions': {
        const key = secondKey(stripped)
        if (key && projectCtx.updateConstruction) {
          projectCtx.updateConstruction(key, value)
          return
        }
        break
      }
      case 'comfort_band': {
        const key = secondKey(stripped)
        if (key && projectCtx.setComfortBand) {
          projectCtx.setComfortBand({ [key]: value })
          return
        }
        if (!key && projectCtx.setComfortBand) {
          projectCtx.setComfortBand(value)
          return
        }
        break
      }
      default: {
        // Building's deep-merge keys: 2-segment dispatch.
        // `mutate('building.wwr.north', 0.4)` → `updateParam('wwr', { north: 0.4 })`.
        // This preserves updateParam's partial-merge semantics so behaviour
        // matches existing main-app calls exactly.
        if (BUILDING_DEEP_MERGE_KEYS.has(top)) {
          const sub = secondKey(stripped)
          if (sub != null) {
            projectCtx.updateParam?.(top, { [sub]: value })
            return
          }
          // No sub-key — whole top-level write (rare, but supported):
          projectCtx.updateParam?.(top, value)
          return
        }

        // Exact top-level write (e.g. `length`, `width`, `orientation`,
        // `q50`, `infiltration_ach`, `thermal_bridges`, `fabric`,
        // `interventions`, `library_systems`, etc.):
        if (stripped === top) {
          projectCtx.updateParam?.(top, value)
          return
        }

        // Deeper write that's not in the known dispatch tables. Part 4
        // adds `systems_config_v40.*` branch. Until then, the caller
        // should use the appropriate ProjectContext helper directly.
        if (typeof console !== 'undefined') {
          console.warn(
            `[useProjectMutation] deep path '${stripped}' in main-app mode is not routable: ` +
            `top key '${top}' is not in BUILDING_DEEP_MERGE_KEYS and doesn't have a dedicated dispatch. ` +
            `The calling component should call its existing ProjectContext mutator directly. ` +
            `Capture-mode is unaffected (patch captured verbatim).`
          )
        }
        return
      }
    }
  }, [capture, projectCtx])

  return useMemo(() => ({ mutate, isCapturing: !!capture?.isCapturing }), [mutate, capture])
}

// ── Helper: hasPatchOnPath ──────────────────────────────────────────────

/**
 * Hook: returns true if the currently-mounted capture context has a
 * captured patch at the given path. Used by the visible-change
 * indicator pattern in Building / IG / Operation / Systems composers
 * (Brief 46 Parts 2-4 step 2.4 / 3.6 / 4.6). Renders a small accent
 * dot next to inputs with a patch; click reverts.
 *
 * Path matching is exact-match against `patch.path`. Components that
 * write to a deep path should query the same deep path (e.g.
 * `useHasPatchOnPath('building.wwr.north')`).
 */
export function useHasPatchOnPath(path) {
  const capture = useInterventionCapture()
  return useMemo(() => {
    if (!capture?.isCapturing || !Array.isArray(capture.currentPatches)) return false
    return capture.currentPatches.some(p => p?.path === path)
  }, [capture, path])
}

/**
 * Hook: returns a function that reverts the patch at a given path.
 * Components use it for the click-to-revert affordance on visible-
 * change indicators.
 */
export function useRevertPathPatch() {
  const capture = useInterventionCapture()
  return useCallback((path) => {
    if (!capture?.isCapturing || !Array.isArray(capture.currentPatches)) return
    const patch = capture.currentPatches.find(p => p?.path === path)
    if (patch?.id) capture.revertPatch(patch.id)
  }, [capture])
}
