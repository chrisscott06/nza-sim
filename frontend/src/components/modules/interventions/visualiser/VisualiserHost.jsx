/**
 * VisualiserHost.jsx — Brief 47 Part 4 (2026-05-24)
 *
 * Host for the right-pane visualiser views. Carries the view switcher
 * and dispatches to:
 *
 *   - Waterfall (reuse `EUIWaterfall` from Brief 45)
 *   - Before/after (new `BeforeAfterBars`)
 *   - Physics (reuse `HeatBalance` via `PhysicsView`)
 *
 * Brief 47 Part 4.2 framing: every view shows change-against-baseline
 * — baseline-vs-cumulative bars, baseline-vs-current physics, waterfall
 * marginal steps.
 *
 * Brief 47 Part 4.3 live update: as the user edits in the editor
 * popout (which can be off-screen), the visualiser updates in the same
 * render cycle. Mechanism: `InterventionsModule` lifts the editor's
 * in-progress `currentPatches` into local state via the popout's
 * `onLivePatchesChange` callback, then recomputes `stackResult` with
 * those patches overriding the editing intervention's saved patches.
 * This component receives the recomputed `stackResult` as a prop and
 * passes through to each view — no separate engine pass here.
 *
 * Brief 47 Principle 4: reuse, don't rebuild. Only `BeforeAfterBars`
 * is new (and small). Waterfall + HeatBalance are existing.
 *
 * Out of scope (deferred to follow-on brief): carbon-trajectory-over-
 * time / pathway data / BAU projection.
 */

import { useState } from 'react'
import { BarChart3, GitCompareArrows, Flame } from 'lucide-react'
import EUIWaterfall from '../EUIWaterfall.jsx'
import BeforeAfterBars from './BeforeAfterBars.jsx'
import PhysicsView from './PhysicsView.jsx'

const VIEWS = [
  { id: 'waterfall', label: 'Waterfall',     icon: BarChart3,         hint: 'Per-intervention marginal impact' },
  { id: 'beforeafter', label: 'Before/after', icon: GitCompareArrows,  hint: 'Cumulative stack vs baseline' },
  { id: 'physics',  label: 'Heat balance',   icon: Flame,             hint: 'Current stack heat balance' },
]

export default function VisualiserHost({ interventions, stackResult, orientationDeg = 0 }) {
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('nza-interventions-visualiser-view') || 'waterfall' }
    catch { return 'waterfall' }
  })

  const handleSetView = (id) => {
    setView(id)
    try { localStorage.setItem('nza-interventions-visualiser-view', id) } catch {}
  }

  const baselineResult = stackResult?.baseline ?? null

  // Walk backwards to find the last enabled intervention's result —
  // that's the cumulative state. Falls back to baseline if no
  // enabled interventions.
  let cumulativeResult = baselineResult
  if (Array.isArray(stackResult?.interventions)) {
    for (let i = stackResult.interventions.length - 1; i >= 0; i--) {
      const row = stackResult.interventions[i]
      if (row && row.enabled !== false && row.result) {
        cumulativeResult = row.result
        break
      }
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* View switcher */}
      <div className="flex-shrink-0 flex items-center gap-1 px-3 py-2 border-b border-light-grey bg-white">
        {VIEWS.map(v => {
          const Icon = v.icon
          const isActive = v.id === view
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => handleSetView(v.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xxs font-medium transition-colors ${
                isActive
                  ? 'bg-navy text-white'
                  : 'text-mid-grey hover:bg-off-white hover:text-navy'
              }`}
              title={v.hint}
            >
              <Icon size={12} />
              {v.label}
            </button>
          )
        })}
      </div>

      {/* View body */}
      <div className="flex-1 min-h-0 overflow-auto">
        {view === 'waterfall' && (
          <div className="p-4">
            <EUIWaterfall interventions={interventions ?? []} stackResult={stackResult} />
          </div>
        )}
        {view === 'beforeafter' && (
          <div className="p-4">
            <BeforeAfterBars stackResult={stackResult} />
          </div>
        )}
        {view === 'physics' && (
          <PhysicsView
            baselineResult={baselineResult}
            cumulativeResult={cumulativeResult}
            orientationDeg={orientationDeg}
          />
        )}
      </div>
    </div>
  )
}
