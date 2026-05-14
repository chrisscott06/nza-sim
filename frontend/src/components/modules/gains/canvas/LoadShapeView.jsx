/**
 * LoadShapeView.jsx — Internal Gains module "Conditions" tab.
 *
 * Brief 28a Part 3c (2026-05-14): consolidates three previously-separate
 * canvas tabs into one umbrella tab with an internal sub-view toggle:
 *
 *   - Temperature trace  -> existing FreeRunningView
 *   - Hourly profile     -> existing HourlyProfileView
 *   - Annual breakdown   -> existing AnnualBreakdownView
 *
 * Brief 28a Part 3d (2026-05-14): user-facing tab label changed from
 * "Load shape" to "Conditions" (Chris: industry jargon -> plain English;
 * the tab will eventually host temperature traces + profiles + hourly
 * distributions etc. -- all conditions). The internal file name +
 * component name stay as `LoadShapeView` to avoid churning component
 * imports across the codebase mid-Part-3; rename can happen at
 * Brief 28a Part 7 close-out alongside other deprecated-file deletions.
 *
 * This is an INTERIM consolidation: each sub-view renders its existing
 * component as-is, just bundled under one tab. Brief 28a Parts 4-5 lands
 * the Pablo zoom pattern (ChartContainer / ZoomNav / MonthJumpButtons /
 * DataCard) and rewrites this into a single unified time-series view
 * with period zoom + stat panel. The three sub-components remain on
 * disk for reuse OR deletion at Part 7 close-out.
 *
 * Default sub-view: Temperature trace (was the "Free-running" tab, the
 * most informative single perspective of the three).
 */

import { useState } from 'react'
import { Thermometer, Activity, BarChart3 } from 'lucide-react'
import FreeRunningView     from './FreeRunningView.jsx'
import HourlyProfileView   from './HourlyProfileView.jsx'
import AnnualBreakdownView from './AnnualBreakdownView.jsx'

const SUB_VIEWS = [
  { key: 'temperature', label: 'Temperature trace', icon: Thermometer },
  { key: 'hourly',      label: 'Hourly profile',    icon: Activity },
  { key: 'breakdown',   label: 'Annual breakdown',  icon: BarChart3 },
]

const SUB_VIEW_STORAGE_KEY = 'nza-loadshape-subview'

export default function LoadShapeView() {
  const [subView, setSubView] = useState(() => {
    try {
      const saved = localStorage.getItem(SUB_VIEW_STORAGE_KEY)
      if (saved && SUB_VIEWS.find(v => v.key === saved)) return saved
    } catch {}
    return 'temperature'
  })

  const setSubViewPersisted = (k) => {
    setSubView(k)
    try { localStorage.setItem(SUB_VIEW_STORAGE_KEY, k) } catch {}
  }

  return (
    <div className="flex flex-col h-full">
      {/* Sub-view toggle. Inline strip at top; visual style intentionally
          subordinate to the main tab strip — these are internal sub-modes
          of the Load shape tab, not first-class tabs. Will be replaced by
          a single unified time-series view in Brief 28a Parts 4-5. */}
      <div className="flex-shrink-0 px-6 pt-4 pb-2 border-b border-light-grey">
        <div className="inline-flex items-center bg-off-white rounded-lg p-0.5 text-xxs">
          {SUB_VIEWS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setSubViewPersisted(key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors ${
                subView === key
                  ? 'bg-white text-navy font-medium shadow-sm'
                  : 'text-mid-grey hover:text-navy'
              }`}
            >
              <Icon size={11} />
              {label}
            </button>
          ))}
        </div>
        <p className="text-xxs text-mid-grey/70 mt-1.5 italic">
          Interim sub-view toggle. Brief 28a Parts 4-5 (Pablo port + Conditions
          migration) replace these three perspectives with a single unified
          time-series view with period zoom.
        </p>
      </div>

      {/* Active sub-view */}
      <div className="flex-1 min-h-0 overflow-auto">
        {subView === 'temperature' && <FreeRunningView />}
        {subView === 'hourly'      && <HourlyProfileView />}
        {subView === 'breakdown'   && <AnnualBreakdownView />}
      </div>
    </div>
  )
}
