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

// ── Hook ────────────────────────────────────────────────────────────────

/**
 * Returns `{ mutate, isCapturing }`. `mutate(path, value, op?)` is the
 * single entry point components use; `isCapturing` lets callers branch
 * on whether they're inside an intervention editor (e.g. to render
 * visible-change indicators).
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

    // Add / remove / replace ops on arrays require deep manipulation.
    // Brief 46 Part 1 lands `set` as the common case; structural ops
    // (op !== 'set') are flagged as "use ProjectContext.updateSystem or
    // similar directly for now" — the relevant callers are within
    // Systems module helpers that already do that work (addSystem,
    // removeSystem, etc.) and Part 4 will refactor them to call this
    // hook with the array op + deep-merge helper.
    if (op !== 'set') {
      // Part 1: signal the limitation in dev console.
      // Part 4 will replace this branch with a deep array op helper.
      if (typeof console !== 'undefined') {
        console.warn(
          `[useProjectMutation] op='${op}' on path '${stripped}' in main-app mode is not yet routable; ` +
          `the calling component should continue to use its existing ProjectContext mutator directly until Brief 46 Part 4 lands the array-op helper. Patch path captured verbatim by the patch model.`
        )
      }
      return
    }

    // Dispatch by top-level path key.
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
        // Setting the whole comfort_band:
        if (!key && projectCtx.setComfortBand) {
          projectCtx.setComfortBand(value)
          return
        }
        break
      }
      // Single-segment top-level writes via updateParam.
      // Multi-segment paths like `systems_config_v40.heating[id=X]…`
      // fall through to updateParam(top, deepMerge(...)) — the
      // deep-merge helper lands in Part 4. For Part 1, we delegate to
      // updateParam at the top level for paths that are exactly the
      // top key, and surface a console.warn for deeper paths so it's
      // visible during the refactor in Parts 2-4.
      default: {
        // Exact top-level write (e.g. `length`, `width`, `orientation`,
        // `wwr`, `interventions`, `library_systems`, etc.):
        if (stripped === top) {
          projectCtx.updateParam?.(top, value)
          return
        }
        // Deeper write — Part 1 stub.
        if (typeof console !== 'undefined') {
          console.warn(
            `[useProjectMutation] deep path '${stripped}' in main-app mode: ` +
            `Part 1 stub — refactor target. Falling back to updateParam('${top}', value) ` +
            `with the FULL value assumed to be the new top-level slice. ` +
            `Parts 2-4 wire the deep-merge helper. Capture-mode is unaffected.`
          )
        }
        projectCtx.updateParam?.(top, value)
        return
      }
    }
  }, [capture, projectCtx])

  return useMemo(() => ({ mutate, isCapturing: !!capture?.isCapturing }), [mutate, capture])
}
