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

import { useMemo, useCallback, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import ScheduleEditor from '../ScheduleEditor.jsx'
import AnnualHeatmap from './AnnualHeatmap.jsx'
import ExceptionsPanel from './ExceptionsPanel.jsx'

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

// ── Profile selector (Brief 27 Revised Part 10) ─────────────────────────────
//
// Lives only for Lighting + Equipment. The selector controls which profile
// the centre-canvas Schedule editor edits. The active profile is also
// reflected in the canvas title bar so the user always knows which schedule
// they are looking at.
function ProfileSelector({ gainType, profileSelector }) {
  if (gainType === 'occupancy' || !profileSelector) return null
  const { profiles, activeId, onChange } = profileSelector
  if (!profiles || profiles.length === 0) return null
  if (profiles.length === 1) {
    return (
      <div className="flex items-center justify-between mb-3 px-3 py-1.5 bg-off-white/60 border border-light-grey rounded">
        <span className="text-xxs uppercase tracking-wider text-mid-grey/80">Profile</span>
        <span className="text-caption text-navy font-medium">{profiles[0].label}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 mb-3 px-3 py-1.5 bg-off-white/60 border border-light-grey rounded">
      <span className="text-xxs uppercase tracking-wider text-mid-grey/80">Profile</span>
      <select
        value={activeId ?? ''}
        onChange={e => onChange?.(e.target.value)}
        className="flex-1 max-w-xs px-2 py-0.5 text-caption text-navy font-medium border border-light-grey rounded bg-white focus:outline-none focus:border-mid-grey"
      >
        {profiles.map(p => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
      <span className="text-xxs text-mid-grey/70">
        {profiles.length} profiles configured · edit in left panel
      </span>
    </div>
  )
}

// ── Area-coverage indicator (live Σ area_share check) ───────────────────────
//
// Lives only for Lighting + Equipment. Sum across profiles' area_share
// SHOULD equal 1.0 (= 100% of GIA covered). Warn-amber if outside ±2% to
// flag under/over-coverage without being noisy about small rounding.
function AreaCoverage({ gainType, areaShareTotal }) {
  if (gainType === 'occupancy' || areaShareTotal == null) return null
  const total = Number(areaShareTotal) || 0
  const pct = Math.round(total * 100)
  const ok = total >= 0.98 && total <= 1.02
  const verdict = total < 0.98 ? 'under-covered' :
                  total > 1.02 ? 'over-covered'  :
                  'fully covered'
  return (
    <div
      className={`flex items-center justify-between mb-3 px-3 py-1.5 rounded border ${
        ok ? 'border-light-grey bg-off-white/60' : 'border-amber-300 bg-amber-50/70'
      }`}
    >
      <span className="text-xxs uppercase tracking-wider text-mid-grey/80">
        Area coverage
      </span>
      <span className={`text-caption font-medium tabular-nums flex items-center gap-2 ${ok ? 'text-navy' : 'text-amber-700'}`}>
        <span>{pct}%</span>
        <span className="text-xxs font-normal">· {verdict}</span>
      </span>
    </div>
  )
}

// ── Main canvas ──────────────────────────────────────────────────────────────
//
// Brief 27 Revised Part 8 introduces edit-mode for individual exception
// periods. The caller (InternalGainsModule) tracks `editingException` as
// the exception currently being edited; when set:
//   - The canvas renders an edit-mode banner at top (distinct colour,
//     "Save & return to default" affordance).
//   - The ScheduleEditor below operates on the exception's curves (the
//     caller supplies a virtual schedule whose weekday/saturday/sunday
//     ARE the exception's curves; ExceptionsPanel + AnnualHeatmap below
//     keep working off the PARENT schedule).
//
// Props:
//   - parentSchedule       — always the underlying schedule (for heatmap,
//                            exceptions panel, and the on-change wiring
//                            when editing the default).
//   - parentOnChange       — write back to building_config for any change
//                            to the default schedule (not an exception).
//   - editingException     — null OR the exception object being edited.
//   - exceptionOnChange    — write back to building_config when the
//                            exception's curves change (only meaningful
//                            when editingException is set).
//   - onEnterEditMode(id)  — switch to editing exception `id`.
//   - onExitEditMode()     — return to default-schedule editing.
export default function ScheduleEditorCanvas({
  gainType,
  gainLabel,
  parentSchedule,
  parentOnChange,
  editingException,
  exceptionOnChange,
  onEnterEditMode,
  onExitEditMode,
  accent,
  // Brief 27 Revised Part 10 — multi-profile selector + area coverage.
  // For lighting/equipment, caller passes:
  //   profileSelector: { profiles: [{id, label}], activeId, onChange(id) }
  //   areaShareTotal:  Σ profiles[*].area_share
  // For occupancy, both should be null (single-object, not multi-profile).
  profileSelector,
  areaShareTotal,
}) {
  // ── Build the effective schedule for the ScheduleEditor ───────────────
  // Default mode: editor edits parentSchedule directly.
  // Exception mode: editor edits a synthetic schedule whose weekday/
  //   saturday/sunday ARE the exception's curves. monthly_multipliers
  //   inherited from parent unless the exception ignores them (in which
  //   case they're flat 1.0 so the editor's monthly row reads neutrally).
  //   The synthetic schedule has empty exceptions[] — no nesting.
  const isEditingException = !!editingException
  const editorSchedule = isEditingException
    ? {
        weekday:             editingException.weekday  ?? new Array(24).fill(0),
        saturday:            editingException.saturday ?? new Array(24).fill(0),
        sunday:              editingException.sunday   ?? new Array(24).fill(0),
        monthly_multipliers: editingException.ignore_monthly_multipliers
          ? new Array(12).fill(1)
          : (parentSchedule?.monthly_multipliers ?? new Array(12).fill(1)),
        exceptions: [],
      }
    : parentSchedule

  const editorOnChange = useCallback((next) => {
    if (isEditingException) {
      // Forward only the curve fields to the exception writer; the synthetic
      // monthly_multipliers + exceptions[] are not part of the exception.
      exceptionOnChange?.({
        weekday:  next.weekday,
        saturday: next.saturday,
        sunday:   next.sunday,
      })
    } else {
      parentOnChange?.(next)
    }
  }, [isEditingException, exceptionOnChange, parentOnChange])

  const stats = useScheduleStats(editorSchedule)

  // Highlight-on-hover for the exception list ↔ heatmap pairing.
  const [highlightExceptionId, setHighlightExceptionId] = useState(null)

  // When in edit mode, force-highlight the exception being edited so the
  // heatmap shows where it lands in the year.
  const effectiveHighlight = editingException?.id ?? highlightExceptionId

  // Header copy for the edit-mode banner — derive week numbers for the
  // user (approx since exception ranges can wrap year-end).
  const editBannerCopy = editingException
    ? `weeks of ${editingException.start_date} → ${editingException.end_date}`
    : null

  if (!parentSchedule) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto px-6 py-8 max-w-[1100px]">
          <p className="text-caption text-mid-grey">
            No schedule on this gain yet. Add a magnitude in the left panel,
            then return here to author the hourly profile.
          </p>
        </div>
      </div>
    )
  }

  return (
    // Brief 28a Part 5 walkthrough scroll fix (2026-05-14): bounded outer
    // container with internal scroll. Schedule editor has many sub-sections
    // (curve, day-types, exceptions, monthly multipliers) so internal
    // scrolling within the canvas is the right pattern.
    <div className="h-full overflow-y-auto">
    <div className="mx-auto px-6 py-5 max-w-[1100px]">
      {/* Title bar — always reflects the default schedule label */}
      <div
        className="flex items-baseline gap-2 pb-2 mb-4 border-b-2"
        style={{ borderBottomColor: accent }}
      >
        <h2 className="text-base font-semibold text-navy">Schedule</h2>
        <span className="text-caption text-mid-grey">{gainLabel}</span>
        <span className="ml-auto text-xxs italic text-mid-grey/70">
          Drag bars to set fraction · drag horizontally to paint
        </span>
      </div>

      {/* Profile selector + area coverage indicator (Brief 27 Revised Part 10) */}
      <ProfileSelector gainType={gainType} profileSelector={profileSelector} />
      <AreaCoverage    gainType={gainType} areaShareTotal={areaShareTotal} />

      {/* ── Edit-mode banner ─────────────────────────────────────────────
          Shown when an exception's curves are being edited. Distinct
          colour (orange/amber, deliberately different from the gain
          accent + the structural module accent) signals "you are not
          editing the default schedule right now". */}
      {isEditingException && (
        <div
          className="mb-3 px-3 py-2.5 rounded border-l-4 flex items-center gap-3"
          style={{
            backgroundColor: 'rgba(234, 88, 12, 0.08)',
            borderLeftColor: '#EA580C',
          }}
        >
          <div className="text-base">
            {editingException.icon || '✏️'}
          </div>
          <div className="flex-1">
            <div className="text-caption font-semibold text-navy">
              Editing: {editingException.name || '(unnamed exception)'}
            </div>
            <div className="text-xxs text-mid-grey">
              {editBannerCopy}
              {editingException.ignore_monthly_multipliers && (
                <span className="ml-2">· monthly multipliers bypassed</span>
              )}
            </div>
          </div>
          <button
            onClick={onExitEditMode}
            className="flex items-center gap-1 px-2.5 py-1 text-caption text-white rounded transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#EA580C' }}
          >
            <ArrowLeft size={11} /> Save &amp; return to default
          </button>
        </div>
      )}

      {/* ── Schedule editor ──────────────────────────────────────────────
          Same component for default and exception modes; the caller-
          supplied virtual schedule routes the edits to the right place. */}
      <div className="bg-white border border-light-grey rounded p-4">
        <ScheduleEditor
          schedule={editorSchedule}
          onChange={editorOnChange}
          gainType={gainType}
          accent={accent}
          barGridHeight={140}
          monthlyRowHeight={56}
        />
      </div>

      {/* ── Statistics card ──────────────────────────────────────────────
          Stats reflect whichever schedule the editor is currently editing
          (default OR exception's curves). */}
      <div className="mt-4 bg-white border border-light-grey rounded p-4 max-w-md">
        <h3 className="text-xxs uppercase tracking-wider text-mid-grey mb-2">
          Statistics {isEditingException && <span className="ml-1 text-orange-600">(this exception)</span>}
        </h3>
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
      </div>

      {/* ── Exception periods panel ──────────────────────────────────────
          Always operates on the PARENT schedule's exceptions[]. Hidden
          for the case where parentOnChange isn't supplied (defensive). */}
      {parentOnChange && (
        <div className="mt-5 bg-white border border-light-grey rounded p-4">
          <ExceptionsPanel
            exceptions={parentSchedule.exceptions ?? []}
            parentSchedule={parentSchedule}
            onChange={(nextExceptions) => parentOnChange({ ...parentSchedule, exceptions: nextExceptions })}
            onEditException={onEnterEditMode}
            highlightExceptionId={effectiveHighlight}
            onHighlight={setHighlightExceptionId}
            disabled={isEditingException}
          />
        </div>
      )}

      {/* ── Annual heatmap ───────────────────────────────────────────────
          Always renders the PARENT schedule's assembled pattern — even
          while editing an exception, the heatmap shows the full year
          with the exception's curves baked in via fractionForHour. */}
      <div className="mt-5 bg-white border border-light-grey rounded p-4">
        <AnnualHeatmap
          schedule={parentSchedule}
          accent={accent}
          highlightExceptionId={effectiveHighlight}
        />
      </div>
    </div>
    </div>
  )
}
