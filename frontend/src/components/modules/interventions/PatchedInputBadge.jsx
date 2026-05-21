/**
 * PatchedInputBadge.jsx — Brief 46 Part 2b (2026-05-21)
 *
 * Visible-change indicator wrapping any input inside the intervention
 * editor. Reads `useHasPatchOnPath(path)` from the capture context;
 * when a patch exists at that path, renders a small accent dot beside
 * the input. Clicking the dot reverts the patch (via
 * `useRevertPathPatch`). Outside the capture context, renders only
 * the children (no badge) — main-app behaviour unchanged.
 *
 * Composition (typical):
 *
 *   <PatchedInputBadge path="building.q50">
 *     <Q50Slider value={…} onChange={(v) => mutate('building.q50', v)} />
 *   </PatchedInputBadge>
 *
 * Brief 46 Q3 directive: `useHasPatchOnPath(path)` returns true if the
 * capture context has a patch at that path; click the badge to revert
 * via `useRevertPathPatch()`. Pattern lands in Part 2b; reused in
 * Parts 3–4 by InternalGainsSection / OperationSection / SystemsSection.
 *
 * Layout: positions the badge as a tiny absolute-positioned dot in the
 * top-right corner of a relative wrapper around the input. The wrapper
 * doesn't change the input's own layout (just adds a positioning
 * context). Clicking the dot calls revert; clicking the input does
 * whatever the input does.
 *
 * Accent colour: defaults to the intervention pink (#E84393). Callers
 * can override per service / per module if needed.
 */

import { useHasPatchOnPath, useRevertPathPatch } from '../../../hooks/useProjectMutation.js'

const DEFAULT_ACCENT = '#E84393'

export default function PatchedInputBadge({ path, children, accent = DEFAULT_ACCENT, title }) {
  const hasPatch = useHasPatchOnPath(path)
  const revertPath = useRevertPathPatch()

  // When no capture context active OR no patch at this path, render
  // the children unmodified. Main-app behaviour unchanged.
  if (!hasPatch) {
    return children
  }

  return (
    <span className="relative inline-block w-full">
      {children}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          revertPath(path)
        }}
        title={title ?? `Revert this patch (path: ${path})`}
        className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full border border-white shadow-sm flex items-center justify-center transition-transform hover:scale-110 z-10"
        style={{ backgroundColor: accent }}
        aria-label="Revert patch"
      />
    </span>
  )
}
