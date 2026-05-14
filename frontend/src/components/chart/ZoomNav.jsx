/**
 * ZoomNav — shared zoom + date navigation control.
 *
 * Ported from Pablo (pablo-2/frontend/src/components/ui/ZoomNav.jsx) at
 * 2026-05-14 as part of Brief 28a Part 4. Clean lift — no code changes
 * vs Pablo's source. The investigation report (docs/pablo_chart_components_
 * investigation.md) noted this as a 70-line trivial lift; this file is a
 * faithful copy.
 *
 * Layout:  [1d] [7d] [14d] [30d]  ◄  dateRangeLabel  ►   {rightContent}
 *
 * Props:
 *   zoomDays         — current zoom level (number of days visible)
 *   setZoomDays      — setter for zoomDays
 *   startDay         — current window start (day offset from data start)
 *   setStartDay      — setter for startDay
 *   totalDays        — total number of days in the dataset
 *   dateRangeLabel   — string shown between the prev/next arrows
 *   options          — optional zoom button definitions (default [1d, 7d, 14d, 30d])
 *   rightContent     — optional right-aligned element (e.g. unit toggle, status pill)
 *
 * NZA-Sim's Internal Gains Conditions tab will consume this in Brief 28a
 * Part 5 (migration of the time-series view to the Pablo zoom pattern).
 */

import { ChevronLeft, ChevronRight } from 'lucide-react'

const DEFAULT_OPTIONS = [
  { label: '1d', days: 1 },
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
]

export default function ZoomNav({
  zoomDays,
  setZoomDays,
  startDay,
  setStartDay,
  totalDays,
  dateRangeLabel,
  options = DEFAULT_OPTIONS,
  rightContent,
}) {
  const maxStart = Math.max(0, totalDays - zoomDays)

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-xxs font-medium text-navy">Zoom:</span>
        <div className="flex bg-white rounded-lg border border-light-grey p-0.5 gap-0.5">
          {options.map(opt => (
            <button
              key={opt.days}
              onClick={() => {
                setZoomDays(opt.days)
                setStartDay(Math.min(startDay, Math.max(0, totalDays - opt.days)))
              }}
              className={`px-2.5 py-1 text-caption rounded-md transition-colors ${
                zoomDays === opt.days
                  ? 'bg-teal text-white font-medium'
                  : 'text-mid-grey hover:text-navy'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setStartDay(Math.max(0, startDay - zoomDays))}
          disabled={startDay <= 0}
          className="p-1 rounded border border-light-grey hover:bg-off-white disabled:opacity-30"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs text-navy font-medium min-w-[120px] text-center">
          {dateRangeLabel}
        </span>
        <button
          onClick={() => setStartDay(Math.min(maxStart, startDay + zoomDays))}
          disabled={startDay >= maxStart}
          className="p-1 rounded border border-light-grey hover:bg-off-white disabled:opacity-30"
        >
          <ChevronRight size={14} />
        </button>
      </div>
      {rightContent && <div className="flex items-center gap-2">{rightContent}</div>}
    </div>
  )
}
