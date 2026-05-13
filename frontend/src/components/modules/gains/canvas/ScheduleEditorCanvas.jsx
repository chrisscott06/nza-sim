/**
 * ScheduleEditorCanvas.jsx — centre-canvas schedule workspace.
 *
 * Brief 27 Revised Part 7. Wraps the existing ScheduleEditor at canvas
 * width per the v2.4 contract's UI rule: "for any module where schedule
 * editing is a primary activity, the schedule editor lives in the centre
 * canvas. Left panel holds magnitude and structural inputs; centre canvas
 * holds workspace activities."
 *
 * UI principles (docs/ui_principles.md):
 *   - Centre canvas max width (~1000 px, principle #3) is OVERRIDDEN here.
 *     Schedule editors earn their full width because the annual heatmap
 *     and 8,760-hour visualisations carry data horizontally. The contract
 *     explicitly licenses the override.
 *   - Statistics card uses the canonical "list of stats inside a single
 *     card" pattern (principle #2). No spreading across the canvas.
 *
 * Composition:
 *   - Title bar with gain accent
 *   - Profile selector slot (Part 10 wires for Lighting / Equipment;
 *     occupancy doesn't need one — single-object, not multi-profile)
 *   - Area coverage indicator slot (Part 10 — shows Σ area_share for
 *     profile categories; warns if not 1.0)
 *   - Quick-set tool strip (flat, copy weekday→weekend, invert, shift)
 *   - ScheduleEditor at canvas-friendly sizing (barGrid 140 px tall,
 *     monthly row 56 px tall, monthly variation open by default)
 *   - Statistics card
 *
 * Modifiers, annual heatmap, and exception-edit-mode are wired in
 * later parts of the revised brief (Part 8 for exception authoring,
 * Part 10 for area coverage, Part 11 for heatmap as part of the
 * full diagnostic build-out).
 */

import { useMemo, useCallback } from 'react'
import ScheduleEditor from '../ScheduleEditor.jsx'

/**
 * Compute simple summary statistics for the active-day curve of a schedule.
 * Returns { peak, avg, operating_hours_per_year } where operating_hours is
 * the 8,760-hour count of (day fraction × monthly multiplier) > threshold.
 */
function useScheduleStats(schedule) {
  return useMemo(() => {
    if (!schedule) return { peak: 0, avg: 0, operating_hours: 0 }
    const wk = schedule.weekday  ?? []
    const sa = schedule.saturday ?? wk
    const su = schedule.sunday   ?? wk
    const mm = schedule.monthly_multipliers ?? new Array(12).fill(1)

    // Peak across any day type
    const peak = Math.max(0, ...wk, ...sa, ...su)

    // Average fraction across weekday × 5 + saturday × 1 + sunday × 1 = 7 days
    const sumWk = wk.reduce((s, v) => s + v, 0)
    const sumSa = sa.reduce((s, v) => s + v, 0)
    const sumSu = su.reduce((s, v) => s + v, 0)
    const avg = (sumWk * 5 + sumSa + sumSu) / (24 * 7)

    // Operating hours: rough annual estimate. (Σ_h frac[h]) × 7 days × 52 weeks × monthly_avg.
    const dailyFrac = (sumWk * 5 + sumSa + sumSu) / 7  // mean fraction-hours per day
    const monthAvg = mm.reduce((s, v) => s + v, 0) / 12
    const op_hours = dailyFrac * 365 * monthAvg

    return {
      peak,
      avg,
      operating_hours: op_hours,
    }
  }, [schedule])
}

// Quick-set actions moved into ScheduleEditor (Brief 27 Revised Part 7
// follow-up): the day-type tabs ARE the scope, so quick-sets live where
// the day-type state lives. Keeps "Flat 1.0 on Weekday only" possible
// — earlier all-three-days behaviour was too coarse.

// ── Profile + area-coverage slots (Part 10) ──────────────────────────────────
function ProfileSelectorSlot({ gainType, activeProfileId }) {
  // Part 10 wires the multi-profile data model + selector. Until then this
  // surfaces an explicit placeholder ONLY for the gain types that will get
  // profile arrays (lighting + equipment). Occupancy is single-object.
  if (gainType === 'occupancy') return null
  return (
    <div className="flex items-center justify-between mb-3 px-3 py-2 bg-off-white/60 border border-dashed border-light-grey rounded">
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey/80">Profile</p>
        <p className="text-caption text-navy font-medium">
          {activeProfileId ?? 'Default'}
          <span className="ml-2 text-xxs italic text-mid-grey/70">
            (selector wired in Brief 27 Revised Part 10)
          </span>
        </p>
      </div>
      <div className="text-xxs italic text-mid-grey/70">
        + Add profile · ⋯
      </div>
    </div>
  )
}

function AreaCoverageSlot({ gainType, areaShareTotal }) {
  if (gainType === 'occupancy') return null
  // Default value 1.0 until Part 9 introduces real profiles[] with area_share.
  const total = areaShareTotal ?? 1.0
  const pct = Math.round(total * 100)
  const ok = total >= 0.99 && total <= 1.01
  return (
    <div className="flex items-center justify-between mb-3 px-3 py-1.5 bg-off-white/60 border border-dashed border-light-grey rounded">
      <span className="text-xxs uppercase tracking-wider text-mid-grey/80">Area coverage</span>
      <span className={`text-caption font-medium tabular-nums ${ok ? 'text-navy' : 'text-amber-600'}`}>
        {pct}%
        <span className="ml-2 text-xxs italic text-mid-grey/70">
          (live check wired in Part 10)
        </span>
      </span>
    </div>
  )
}

// ── Main canvas ──────────────────────────────────────────────────────────────
export default function ScheduleEditorCanvas({
  gainType,
  gainLabel,
  schedule,
  onChange,
  accent,
  // Part 10 hooks — passed through but unused until that part:
  activeProfileId,
  areaShareTotal,
}) {
  const stats = useScheduleStats(schedule)

  const handleChange = useCallback((next) => onChange(next), [onChange])

  if (!schedule) {
    return (
      <div className="mx-auto px-6 py-8 max-w-[1100px]">
        <p className="text-caption text-mid-grey">
          No schedule on this gain yet. Add a magnitude in the left panel,
          then return here to author the hourly profile.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto px-6 py-5 max-w-[1100px]">
      {/* Title bar */}
      <div
        className="flex items-baseline gap-2 pb-2 mb-4 border-b-2"
        style={{ borderBottomColor: accent }}
      >
        <h2 className="text-base font-semibold text-navy">Schedule</h2>
        <span className="text-caption text-mid-grey">
          {gainLabel}
        </span>
        <span className="ml-auto text-xxs italic text-mid-grey/70">
          Drag bars to set fraction · drag horizontally to paint
        </span>
      </div>

      {/* Profile + area coverage (Part 10 slots — visible structure now) */}
      <ProfileSelectorSlot gainType={gainType} activeProfileId={activeProfileId} />
      <AreaCoverageSlot   gainType={gainType} areaShareTotal={areaShareTotal} />

      {/* The editor itself — canvas-sized; day-type tabs + per-day
          quick-set buttons live inside, so the scope is unambiguous. */}
      <div className="bg-white border border-light-grey rounded p-4">
        <ScheduleEditor
          schedule={schedule}
          onChange={handleChange}
          gainType={gainType}
          accent={accent}
          barGridHeight={140}
          monthlyRowHeight={56}
        />
      </div>

      {/* Statistics card — single multi-row card per UI principle #2 */}
      <div className="mt-4 bg-white border border-light-grey rounded p-4 max-w-md">
        <h3 className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Statistics</h3>
        <div className="space-y-1 text-caption tabular-nums">
          <div className="flex justify-between">
            <span className="text-mid-grey">Peak fraction</span>
            <span className="text-navy font-medium">{(stats.peak * 100).toFixed(0)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-mid-grey">Average fraction</span>
            <span className="text-navy font-medium">{(stats.avg * 100).toFixed(0)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-mid-grey">Annual operating hours</span>
            <span className="text-navy font-medium">{Math.round(stats.operating_hours).toLocaleString()} h/yr</span>
          </div>
        </div>
        <p className="text-xxs italic text-mid-grey/70 mt-2">
          Operating hours = (Σ day fractions across 7-day week × 365 ÷ 7 ×
          monthly average). Annual heatmap (8,760-hour view) lands in
          Brief 27 Revised Part 11.
        </p>
      </div>
    </div>
  )
}
