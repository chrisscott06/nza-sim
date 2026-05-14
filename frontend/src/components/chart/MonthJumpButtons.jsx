/**
 * MonthJumpButtons — a reusable row of season-coloured buttons:
 *   [All] [Jan] [Feb] ... [Dec]
 *
 * Ported from Pablo (pablo-2/frontend/src/components/ui/MonthJumpButtons.jsx)
 * at 2026-05-14 as part of Brief 28a Part 4. Clean lift — no code changes
 * vs Pablo's source. Tokens (MONTH_LABELS / MONTH_SEASON / SEASON_COLORS)
 * are now in frontend/src/data/chartTokens.js (extended in the same commit).
 *
 * Lets the user jump a time-series window to a specific calendar month
 * (or back to "All" / no filter). NZA-Sim's Internal Gains Conditions tab
 * will consume this in Brief 28a Part 5 alongside ZoomNav.
 *
 * Props:
 *   selectedMonth   — number | null    (0-indexed month, or null for "All")
 *   onSelect        — (month: number | null) => void
 *   showAll         — boolean (default true)
 *   size            — 'sm' | 'md' (default 'sm')
 *   disabledMonths  — number[] | null  (indices to grey-out, e.g. months with no data)
 *
 * Helper exported below: dayOffsetForMonth(startDate, monthIndex) — given a
 * data start-date and a target calendar month, returns the day-offset from
 * start to the 1st of that month (clamped at 0 if target is before start;
 * jumps to next year if target month already passed in start year).
 */

import { MONTH_LABELS, MONTH_SEASON, SEASON_COLORS } from '../../data/chartTokens'

export default function MonthJumpButtons({
  selectedMonth = null,
  onSelect,
  showAll = true,
  size = 'sm',
  disabledMonths = null,
}) {
  const sizeClass = size === 'md'
    ? 'px-3 py-1.5 text-xs'
    : 'px-2.5 py-1 text-xxs'

  return (
    <div className="flex flex-wrap gap-1">
      {showAll && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`${sizeClass} font-medium rounded border transition-all ${
            selectedMonth === null
              ? 'bg-navy text-white border-navy'
              : 'bg-white text-navy border-light-grey hover:border-mid-grey'
          }`}
        >
          All
        </button>
      )}
      {MONTH_LABELS.map((m, i) => {
        const isSelected = selectedMonth === i
        const isDisabled = disabledMonths?.includes(i) ?? false
        const season = MONTH_SEASON[i]
        const colour = SEASON_COLORS[season]
        return (
          <button
            key={m}
            type="button"
            disabled={isDisabled}
            onClick={() => onSelect(i)}
            className={`${sizeClass} font-medium rounded border transition-all ${
              isDisabled
                ? 'bg-light-grey/40 text-mid-grey/60 border-light-grey cursor-not-allowed'
                : isSelected
                  ? 'text-white border-transparent'
                  : 'bg-white text-navy border-light-grey hover:border-mid-grey'
            }`}
            style={isSelected && !isDisabled ? { backgroundColor: colour, borderColor: colour } : {}}
            title={season}
          >
            {m}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Helper — given a startDate and a target month index (0–11), return the
 * day offset (number of whole days from startDate to the 1st of that month
 * within the same calendar year as startDate). Returns 0 if the month is
 * before the start month (clamped — the chart shouldn't try to scroll
 * before the data starts).
 */
export function dayOffsetForMonth(startDate, monthIndex) {
  if (!startDate || monthIndex == null) return 0
  const start = new Date(startDate)
  start.setHours(0, 0, 0, 0)
  const target = new Date(start.getFullYear(), monthIndex, 1)
  target.setHours(0, 0, 0, 0)
  // If the target month already passed in the start year, jump to next year
  if (target < start) {
    target.setFullYear(target.getFullYear() + 1)
  }
  const ms = target - start
  return Math.max(0, Math.round(ms / (24 * 3600 * 1000)))
}
