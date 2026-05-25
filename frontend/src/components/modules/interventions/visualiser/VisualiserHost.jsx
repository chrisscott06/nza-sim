/**
 * VisualiserHost.jsx — Brief 47 Part 4 (2026-05-24), Brief 48 Part 2 (2026-05-25)
 *
 * Host for the right-pane visualiser views. Carries the view switcher
 * and dispatches to:
 *
 *   - Waterfall (reuse `EUIWaterfall` from Brief 45)
 *   - Before/after (new `BeforeAfterBars`)
 *   - Physics (reuse `HeatBalance` via `PhysicsView`)
 *   - Breakdown (Brief 48 Part 2 — per-intervention audit trail)
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
 * Brief 48 Part 2: the Breakdown view shows the per-intervention
 * audit trail. Picks one intervention from a dropdown, reads its
 * marginal_delta + cumulative_delta off the matching stackResult.
 * interventions[i] row, and hands them to BreakdownPanel. Alignment
 * is by index (runInterventionStack processes the source list in
 * order and produces a result row at the same index, including
 * disabled rows).
 *
 * Brief 47 Principle 4: reuse, don't rebuild. Only `BeforeAfterBars`
 * and `BreakdownPanel` are new. Waterfall + HeatBalance are existing.
 *
 * Out of scope (deferred to follow-on brief): carbon-trajectory-over-
 * time / pathway data / BAU projection. Brief 48 Part 3 will add
 * Level 3 chain context (downstream effect on subsequent rows) to
 * the breakdown view.
 */

import { useEffect, useState } from 'react'
import { BarChart3, GitCompareArrows, Flame, Receipt } from 'lucide-react'
import EUIWaterfall from '../EUIWaterfall.jsx'
import BeforeAfterBars from './BeforeAfterBars.jsx'
import PhysicsView from './PhysicsView.jsx'
import BreakdownPanel from './BreakdownPanel.jsx'

const VIEWS = [
  { id: 'waterfall',   label: 'Waterfall',     icon: BarChart3,         hint: 'Per-intervention marginal impact' },
  { id: 'beforeafter', label: 'Before/after',  icon: GitCompareArrows,  hint: 'Cumulative stack vs baseline' },
  { id: 'physics',     label: 'Heat balance',  icon: Flame,             hint: 'Current stack heat balance' },
  { id: 'breakdown',   label: 'Breakdown',     icon: Receipt,           hint: 'Per-intervention audit trail' },
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

  // ── Breakdown view selection ──────────────────────────────────────
  // Persist by id so reorders are tracked; auto-pick the first row
  // when the list changes (or the previously selected id is gone).
  const interventionList = Array.isArray(interventions) ? interventions : []
  const [selectedBreakdownId, setSelectedBreakdownId] = useState(() => {
    try { return localStorage.getItem('nza-interventions-breakdown-id') || null }
    catch { return null }
  })

  // If the selection is no longer in the list (deleted / never set),
  // fall back to the first available intervention. Run as an effect so
  // it doesn't re-render on every selection change.
  useEffect(() => {
    if (interventionList.length === 0) return
    const found = selectedBreakdownId
      && interventionList.some(i => i?.id === selectedBreakdownId)
    if (!found) {
      const firstId = interventionList[0]?.id ?? null
      setSelectedBreakdownId(firstId)
      try { localStorage.setItem('nza-interventions-breakdown-id', firstId ?? '') } catch {}
    }
  }, [interventionList, selectedBreakdownId])

  const handleSetBreakdownId = (id) => {
    setSelectedBreakdownId(id)
    try { localStorage.setItem('nza-interventions-breakdown-id', id ?? '') } catch {}
  }

  // The Breakdown panel resolves its own selected row by id from the
  // interventions + stackInterventions props (Brief 48 Part 3 — panel
  // is self-contained so it can own chain-context navigation cleanly).
  // VisualiserHost only owns the persisted selection id.

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
        {view === 'breakdown' && (
          <div className="h-full flex flex-col">
            {/* Intervention picker — quiet single-row strip above the
                panel. Disabled rows surface (muted label) so the user
                can see why a marginal_delta is zero. */}
            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-light-grey bg-white">
              <label className="text-xxs uppercase tracking-wider text-mid-grey">Intervention</label>
              {interventionList.length === 0 ? (
                <span className="text-xxs italic text-mid-grey">
                  No interventions yet — add one in the stack on the left.
                </span>
              ) : (
                <select
                  value={selectedBreakdownId ?? ''}
                  onChange={(e) => handleSetBreakdownId(e.target.value || null)}
                  className="text-xxs px-2 py-1 rounded border border-light-grey bg-white text-navy focus:outline-none focus:border-navy"
                >
                  {interventionList.map((i, idx) => (
                    <option key={i?.id ?? idx} value={i?.id ?? ''}>
                      {idx + 1}. {i?.label || '(unnamed)'}{i?.enabled === false ? '  · disabled' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex-1 min-h-0">
              <BreakdownPanel
                interventions={interventionList}
                stackInterventions={stackResult?.interventions ?? []}
                selectedId={selectedBreakdownId}
                onSelectId={handleSetBreakdownId}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
