/**
 * UnifiedScheduleEditor.jsx — Brief 37 Part 2 (2026-05-18).
 *
 * One shared schedule editor used by Internal Gains, Operation, Systems
 * (wired by Part 3). Side-by-side layout:
 *   left column   = day-type tabs + bar editor + quick-set toolbar +
 *                   monthly dial knobs
 *   right column  = annual heatmap preview + statistics card
 *   bottom row    = exception periods panel (when enableExceptions)
 *   header row    = name + schedule_type + zone_type (library mode only)
 *   footer row    = Cancel / Save (library mode only)
 *
 * Single `accent` prop drives the theme — header strip, day-type active
 * tab, bar fill, dial-knob dot, heatmap gradient, Save button background.
 *
 * Schema (flat — matches Brief 37 §"Schema unification"):
 *   {
 *     weekday: number[24],
 *     saturday: number[24],
 *     sunday: number[24],
 *     monthly_multipliers: number[12],
 *     exceptions?: ExceptionEntry[],   // optional; when absent treated as []
 *   }
 *
 * Reader-side legacy tolerance: also accepts `day_types: {weekday, ...}`
 * via the unwrap helper at the top of the consumer; the editor itself
 * receives a flat schedule.
 *
 * Sub-components (BarEditor, MonthlyDials, QuickSetToolbar, Statistics)
 * live inline below — the brief's "separate files" structure is an
 * organisational suggestion; collapsing to one file at this stage keeps
 * the Part 2 commit readable. If the file grows, splitting is mechanical.
 *
 * Consumers (Part 3) wrap this component inside SchedulePopout (the
 * draggable chrome from Brief 36 Part 3). The pop-out provides the
 * outer header bar with the same accent.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, FlipHorizontal, AlignCenter, Copy, Save,
} from 'lucide-react'
import AnnualHeatmap from './AnnualHeatmap.jsx'
import ExceptionsPanel from './ExceptionsPanel.jsx'

// ── Constants ────────────────────────────────────────────────────────────────

const HOUR_LABELS  = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAY_TABS     = [
  { id: 'weekday',  label: 'Weekday'  },
  { id: 'saturday', label: 'Saturday' },
  { id: 'sunday',   label: 'Sunday'   },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureSchedule(s) {
  // Tolerant unwrap: callers may pass either the flat shape or a legacy
  // shape that hides curves under day_types. Editor always treats the
  // flat shape as canonical.
  const out = s ?? {}
  return {
    weekday:  Array.isArray(out.weekday)  ? out.weekday  : (out.day_types?.weekday  ?? new Array(24).fill(0)),
    saturday: Array.isArray(out.saturday) ? out.saturday : (out.day_types?.saturday ?? new Array(24).fill(0)),
    sunday:   Array.isArray(out.sunday)   ? out.sunday   : (out.day_types?.sunday   ?? new Array(24).fill(0)),
    monthly_multipliers: Array.isArray(out.monthly_multipliers) ? out.monthly_multipliers : new Array(12).fill(1),
    exceptions: Array.isArray(out.exceptions) ? out.exceptions : [],
  }
}

// ── BarEditor — drag-to-paint 24-bar daily curve ────────────────────────────

function BarEditor({ values, onChange, accent }) {
  const containerRef = useRef(null)
  const isDragging   = useRef(false)

  const getHourAndValue = useCallback((e) => {
    const el = containerRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const relX = e.clientX - rect.left
    const relY = e.clientY - rect.top
    const hour = Math.max(0, Math.min(23, Math.floor((relX / rect.width) * 24)))
    const val  = Math.max(0, Math.min(1, +(1 - relY / rect.height).toFixed(2)))
    return { hour, val }
  }, [])

  const applyPaint = useCallback((e) => {
    const hit = getHourAndValue(e)
    if (!hit) return
    const next = [...values]
    next[hit.hour] = hit.val
    onChange(next)
  }, [values, onChange, getHourAndValue])

  function handleMouseDown(e) {
    isDragging.current = true
    applyPaint(e)
    e.preventDefault()
  }
  function handleMouseMove(e) {
    if (isDragging.current) applyPaint(e)
  }
  useEffect(() => {
    const stop = () => { isDragging.current = false }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  return (
    <div className="space-y-1">
      <div
        ref={containerRef}
        className="relative flex items-end gap-px h-40 bg-off-white rounded overflow-hidden cursor-crosshair select-none p-1.5 pb-0"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
      >
        {values.map((v, i) => (
          <div key={i} className="flex-1 flex flex-col justify-end h-full">
            <div
              className="w-full rounded-t-sm"
              style={{
                height: `${Math.max(2, v * 100)}%`,
                backgroundColor: accent,
                opacity: 0.85,
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex px-1.5">
        {HOUR_LABELS.map((h, i) => (
          <div key={i} className="flex-1 text-center" style={{ fontSize: 8, color: '#95A5A6' }}>
            {i % 6 === 0 ? h : ''}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── MonthlyDials — 12-knob multiplier grid (2 rows × 6) ─────────────────────

function MonthlyDials({ values, onChange, accent }) {
  return (
    <div>
      <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Monthly multipliers</p>
      <div className="grid grid-cols-6 gap-x-2 gap-y-3">
        {MONTH_LABELS.map((m, i) => (
          <div key={m} className="flex flex-col items-center gap-0.5">
            <span className="text-xxs font-medium text-navy tabular-nums">
              {Number(values[i] ?? 1).toFixed(2)}
            </span>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={values[i] ?? 1}
              onChange={e => {
                const next = [...values]
                next[i] = parseFloat(e.target.value)
                onChange(next)
              }}
              className="w-full h-1"
              style={{
                writingMode: 'vertical-lr',
                direction: 'rtl',
                height: 60,
                width: 20,
                accentColor: accent,
              }}
            />
            <span className="text-xxs text-mid-grey">{m}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── QuickSetToolbar ─────────────────────────────────────────────────────────

function QuickSetToolbar({ activeDayValues, setActiveDayValues, setAllDays, accent }) {
  const [flatVal, setFlatVal] = useState('0.5')

  const applyFlat = () => {
    const v = Math.max(0, Math.min(1, parseFloat(flatVal) || 0.5))
    setActiveDayValues(new Array(24).fill(v))
  }
  const invert = () => {
    setActiveDayValues(activeDayValues.map(v => +(1 - v).toFixed(2)))
  }
  const shift = (hours) => {
    const arr = activeDayValues
    const n = arr.length
    const norm = ((hours % n) + n) % n
    setActiveDayValues([...arr.slice(n - norm), ...arr.slice(0, n - norm)])
  }
  const copyWkToWeekend = () => {
    setAllDays((d) => ({ ...d, saturday: [...d.weekday], sunday: [...d.weekday] }))
  }

  const btn = 'flex items-center gap-1 px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white hover:bg-off-white transition-colors'

  return (
    <div>
      <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5">Quick set</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-1">
          <span className="text-xxs text-mid-grey">Flat</span>
          <input
            type="number" min={0} max={1} step={0.05}
            value={flatVal}
            onChange={e => setFlatVal(e.target.value)}
            className="w-12 px-1 py-0.5 text-xxs text-navy text-right tabular-nums border border-light-grey rounded"
          />
          <button onClick={applyFlat} className={btn} style={{ borderColor: accent, color: accent }}>
            Apply
          </button>
        </div>
        <button onClick={copyWkToWeekend} className={btn}>
          <Copy size={11} /> Copy Wk → Sat + Sun
        </button>
        <button onClick={invert} className={btn}>
          <FlipHorizontal size={11} /> Invert
        </button>
        <button onClick={() => shift(-1)} className={btn} title="Shift left">
          <ArrowLeft size={11} /> Shift
        </button>
        <button onClick={() => shift(1)} className={btn} title="Shift right">
          Shift <ArrowRight size={11} />
        </button>
      </div>
    </div>
  )
}

// ── Statistics card ─────────────────────────────────────────────────────────

function Statistics({ schedule, accent }) {
  const stats = useMemo(() => {
    const wk = schedule.weekday  ?? []
    const sa = schedule.saturday ?? wk
    const su = schedule.sunday   ?? wk
    const mm = schedule.monthly_multipliers ?? new Array(12).fill(1)
    const peak = Math.max(0, ...wk, ...sa, ...su)
    const sumWk = wk.reduce((s, v) => s + v, 0)
    const sumSa = sa.reduce((s, v) => s + v, 0)
    const sumSu = su.reduce((s, v) => s + v, 0)
    const avg = (sumWk * 5 + sumSa + sumSu) / (24 * 7)
    const dailyFrac = (sumWk * 5 + sumSa + sumSu) / 7
    const monthAvg = mm.reduce((s, v) => s + v, 0) / 12
    const op_hours = dailyFrac * 365 * monthAvg
    return { peak, avg, op_hours }
  }, [schedule])

  return (
    <div className="bg-white border border-light-grey rounded p-3">
      <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Statistics</p>
      <div className="space-y-1 text-caption tabular-nums">
        <div className="flex justify-between">
          <span className="text-mid-grey">Peak fraction</span>
          <span className="font-medium" style={{ color: accent }}>{(stats.peak * 100).toFixed(0)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-mid-grey">Average fraction</span>
          <span className="text-navy font-medium">{(stats.avg * 100).toFixed(0)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-mid-grey">Annual operating hours</span>
          <span className="text-navy font-medium">{Math.round(stats.op_hours).toLocaleString()} h/yr</span>
        </div>
      </div>
    </div>
  )
}

// ── Library meta row ────────────────────────────────────────────────────────

function LibraryMetaRow({ meta, accent }) {
  if (!meta) return null
  return (
    <div className="grid grid-cols-3 gap-3 pb-3 mb-3 border-b border-light-grey">
      <div>
        <label className="text-xxs uppercase tracking-wider text-mid-grey block mb-0.5">Name</label>
        <input
          type="text"
          value={meta.name ?? ''}
          onChange={e => meta.onNameChange?.(e.target.value)}
          className="w-full px-2 py-1 text-caption text-navy border border-light-grey rounded focus:outline-none"
          style={{ borderColor: 'transparent', borderBottomColor: accent }}
        />
      </div>
      <div>
        <label className="text-xxs uppercase tracking-wider text-mid-grey block mb-0.5">Schedule type</label>
        <select
          value={meta.schedule_type ?? 'occupancy'}
          onChange={e => meta.onTypeChange?.(e.target.value)}
          className="w-full px-2 py-1 text-caption text-navy border border-light-grey rounded bg-white cursor-pointer"
        >
          {(meta.scheduleTypes ?? ['occupancy', 'lighting', 'equipment', 'heating', 'cooling', 'dhw', 'ventilation']).map(t => (
            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xxs uppercase tracking-wider text-mid-grey block mb-0.5">Zone type</label>
        <select
          value={meta.zone_type ?? 'bedroom'}
          onChange={e => meta.onZoneChange?.(e.target.value)}
          className="w-full px-2 py-1 text-caption text-navy border border-light-grey rounded bg-white cursor-pointer"
        >
          {(meta.zoneTypes ?? ['bedroom', 'office', 'public', 'retail', 'industrial', 'other']).map(z => (
            <option key={z} value={z}>{z.charAt(0).toUpperCase() + z.slice(1)}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

// ── Main editor ─────────────────────────────────────────────────────────────

export default function UnifiedScheduleEditor({
  schedule,
  onChange,
  accent          = '#2B2A4C',
  mode            = 'live',            // 'live' | 'library'
  enableExceptions = true,
  libraryMeta     = null,
  contextLabel    = '',
  // Brief 37 Part 3: exception edit-mode — when set, the bar editor + monthly
  // dials drive the EXCEPTION's curves (synthetic schedule), but the annual
  // heatmap + ExceptionsPanel keep operating on the parent schedule. Lifted
  // from the legacy ScheduleEditorCanvas pattern so Internal Gains' per-
  // exception hourly-curve drill-down survives the unification.
  editingException     = null,         // null | the exception object being edited
  onExceptionChange    = null,         // (curvePatch) => void — receives {weekday?, saturday?, sunday?}
  onEnterExceptionEdit = null,         // (excId) => void
  onExitExceptionEdit  = null,         // () => void
}) {
  const s = ensureSchedule(schedule)
  const [activeDay, setActiveDay] = useState('weekday')

  // ── Exception edit-mode routing ──────────────────────────────────────────
  // Lifted from gains/canvas/ScheduleEditorCanvas.jsx:198-222. When in
  // edit-mode the bar editor + monthly dials see a SYNTHETIC schedule whose
  // weekday/saturday/sunday ARE the exception's curves; monthly_multipliers
  // come from the parent (unless the exception ignores them). The
  // ExceptionsPanel + AnnualHeatmap always render against the parent.
  const isEditingException = !!editingException

  const editorSchedule = isEditingException
    ? ensureSchedule({
        weekday:             editingException.weekday  ?? new Array(24).fill(0),
        saturday:            editingException.saturday ?? new Array(24).fill(0),
        sunday:              editingException.sunday   ?? new Array(24).fill(0),
        monthly_multipliers: editingException.ignore_monthly_multipliers
          ? new Array(12).fill(1)
          : (s.monthly_multipliers ?? new Array(12).fill(1)),
        exceptions: [],
      })
    : s

  const writeSchedule = useCallback((patch) => {
    if (isEditingException) {
      // Curve writes during edit-mode route to the exception, not the parent.
      // Monthly multipliers + exceptions[] are NEVER edited via the exception
      // path (the synthetic monthly_multipliers + empty exceptions are display-
      // only context for the bar editor).
      const curvePatch = {}
      if ('weekday'  in patch) curvePatch.weekday  = patch.weekday
      if ('saturday' in patch) curvePatch.saturday = patch.saturday
      if ('sunday'   in patch) curvePatch.sunday   = patch.sunday
      if (Object.keys(curvePatch).length > 0) onExceptionChange?.(curvePatch)
      // monthly_multipliers + exceptions changes during edit-mode are dropped
      // (the editor's only sensible target is the exception's curves).
    } else {
      onChange?.({ ...s, ...patch })
    }
  }, [s, onChange, isEditingException, onExceptionChange])

  const setDayValues = useCallback((day, values) => {
    writeSchedule({ [day]: values })
  }, [writeSchedule])

  const activeValues = editorSchedule[activeDay] ?? new Array(24).fill(0)
  const setActiveDayValues = (next) => setDayValues(activeDay, next)
  const setAllDays = (updater) => {
    const draft = { weekday: editorSchedule.weekday, saturday: editorSchedule.saturday, sunday: editorSchedule.sunday }
    const next = typeof updater === 'function' ? updater(draft) : updater
    if (isEditingException) {
      onExceptionChange?.({
        weekday:  next.weekday,
        saturday: next.saturday,
        sunday:   next.sunday,
      })
    } else {
      onChange?.({ ...s, ...next })
    }
  }

  const setMonthly = (values) => {
    if (isEditingException) return  // monthly multipliers are parent-only
    onChange?.({ ...s, monthly_multipliers: values })
  }
  const setExceptions = (next) => onChange?.({ ...s, exceptions: next })

  return (
    <div className="p-4 bg-white">
      {/* Title strip — context-aware */}
      <div
        className="flex items-baseline gap-2 pb-2 mb-4 border-b-2"
        style={{ borderBottomColor: accent }}
      >
        <h2 className="text-base font-semibold text-navy">Schedule</h2>
        {contextLabel && <span className="text-caption text-mid-grey">{contextLabel}</span>}
        <span className="ml-auto text-xxs italic text-mid-grey/70">
          Drag bars to set fraction · drag horizontally to paint
        </span>
      </div>

      {mode === 'library' && (
        <LibraryMetaRow meta={libraryMeta} accent={accent} />
      )}

      {/* Brief 37 Part 3: exception edit-mode banner (lifted from
          ScheduleEditorCanvas). Distinct colour signals "you are not editing
          the default schedule right now". */}
      {isEditingException && (
        <div
          className="mb-3 px-3 py-2.5 rounded border-l-4 flex items-center gap-3"
          style={{
            backgroundColor: 'rgba(234, 88, 12, 0.08)',
            borderLeftColor: '#EA580C',
          }}
        >
          <div className="text-base">{editingException.icon || '✏️'}</div>
          <div className="flex-1">
            <div className="text-caption font-semibold text-navy">
              Editing exception: {editingException.name || '(unnamed)'}
            </div>
            <div className="text-xxs text-mid-grey">
              {editingException.start_date} → {editingException.end_date}
              {editingException.ignore_monthly_multipliers && <span className="ml-2">· monthly multipliers bypassed</span>}
            </div>
          </div>
          <button
            onClick={() => onExitExceptionEdit?.()}
            className="flex items-center gap-1 px-2.5 py-1 text-caption text-white rounded transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#EA580C' }}
          >
            <ArrowLeft size={11} /> Return to default
          </button>
        </div>
      )}

      {/* Two-column body */}
      <div className="grid grid-cols-2 gap-6">
        {/* Left column — bars + quick-set + monthly dials */}
        <div className="space-y-4">
          {/* Day-type tabs */}
          <div className="flex border-b border-light-grey">
            {DAY_TABS.map(d => (
              <button
                key={d.id}
                onClick={() => setActiveDay(d.id)}
                className={`px-3 py-1.5 text-caption transition-colors border-b-2 -mb-px ${
                  activeDay === d.id ? 'text-navy font-medium' : 'border-transparent text-mid-grey hover:text-navy'
                }`}
                style={activeDay === d.id ? { borderBottomColor: accent } : {}}
              >
                {d.label}
              </button>
            ))}
          </div>

          <BarEditor values={activeValues} onChange={setActiveDayValues} accent={accent} />

          <QuickSetToolbar
            activeDayValues={activeValues}
            setActiveDayValues={setActiveDayValues}
            setAllDays={setAllDays}
            accent={accent}
          />

          <MonthlyDials values={s.monthly_multipliers} onChange={setMonthly} accent={accent} />
        </div>

        {/* Right column — annual heatmap + statistics */}
        <div className="space-y-4">
          <div>
            <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5">Annual pattern (live preview)</p>
            <div className="border border-light-grey rounded p-2 overflow-hidden">
              <AnnualHeatmap schedule={s} accent={accent} />
            </div>
          </div>
          <Statistics schedule={s} accent={accent} />
        </div>
      </div>

      {/* Exception periods — full width, bottom row. Always operates on the
          PARENT schedule's exceptions[] (independent of any active exception
          edit-mode); the panel itself disables while edit-mode is active so
          add/remove can't race with curve editing. */}
      {enableExceptions && (
        <div className="mt-5 bg-white border border-light-grey rounded p-4">
          <ExceptionsPanel
            exceptions={s.exceptions ?? []}
            parentSchedule={s}
            onChange={setExceptions}
            onEditException={(excId) => onEnterExceptionEdit?.(excId)}
            highlightExceptionId={editingException?.id ?? null}
            onHighlight={() => {}}
            disabled={isEditingException}
          />
        </div>
      )}

      {/* Library footer — Cancel / Save */}
      {mode === 'library' && libraryMeta && (
        <div className="mt-5 pt-3 border-t border-light-grey flex items-center justify-end gap-2">
          {libraryMeta.savedId && (
            <span className="text-xxs text-green-700 mr-auto">Saved.</span>
          )}
          {libraryMeta.error && (
            <span className="text-xxs text-coral mr-auto">{libraryMeta.error}</span>
          )}
          <button
            onClick={libraryMeta.onCancel}
            className="px-3 py-1.5 text-caption text-mid-grey border border-light-grey rounded bg-white hover:bg-off-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={libraryMeta.onSave}
            disabled={libraryMeta.saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-caption text-white rounded transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: accent }}
          >
            <Save size={11} />
            {libraryMeta.saving ? 'Saving…' : 'Save to Library'}
          </button>
        </div>
      )}
    </div>
  )
}
