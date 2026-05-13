/**
 * ScheduleEditor.jsx — inline 24-hour schedule editor.
 *
 * Brief 27 Part 5 (occupancy). Reused by Part 6 for lighting + equipment.
 *
 * Edits the v2.3 schedule shape:
 *   {
 *     weekday: [24 floats],   saturday: [24 floats],   sunday: [24 floats],
 *     monthly_multipliers: [12 floats],
 *     exceptions: [{ name, start_date, end_date, weekday, saturday, sunday,
 *                    ignore_monthly_multipliers }]
 *   }
 *
 * Designed to fit inside the Internal Gains module's 288px left panel
 * (~264px usable content). Compact-by-default with collapsible monthly
 * + exception sub-sections so the main 24-bar editing surface stays
 * prominent.
 *
 * Interaction:
 *   - Click + drag vertically within a bar to set the fraction
 *     (top of bar = 1.0, bottom = 0). Drag horizontally to paint
 *     adjacent bars at the same value (the most common edit pattern).
 *   - Hovered/edited hour value surfaces above the grid.
 *   - Preset dropdown applies a starting curve, preserving any
 *     exceptions already on the schedule.
 *
 * UI principles (docs/ui_principles.md):
 *   - Section bounding box pattern via collapsible sub-sections.
 *   - Compact, single-card content (principle #2 — related items
 *     together).
 *   - Bar grid uses full available width within the column (principle
 *     #3 exception — horizontal axis carries time).
 *
 * Props:
 *   - schedule        — v2.3 schedule object (required)
 *   - onChange(next)  — fired with the next schedule on every edit
 *   - gainType        — 'occupancy' | 'lighting' | 'equipment'
 *                       (controls preset library + colour)
 *   - accent          — bar colour (typically GAIN_COLOURS[gainType])
 *   - disabled        — read-only mode
 */

import { useState, useRef, useCallback, useMemo } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { SCHEDULE_PRESETS, applyPreset, emptySchedule } from '../../../data/schedulePresets.js'

const DAY_TYPES = [
  { key: 'weekday',  label: 'Weekday' },
  { key: 'saturday', label: 'Sat'     },
  { key: 'sunday',   label: 'Sun'     },
]

const MONTHS = ['J','F','M','A','M','J','J','A','S','O','N','D']

function clamp01(n) { return Math.max(0, Math.min(1, n)) }

// ── 24-hour bar grid (the main editing surface) ──────────────────────────────
function HourBarGrid({ values, onChange, accent, disabled, height = 64 }) {
  const wrapRef = useRef(null)
  const [hoverIdx, setHoverIdx] = useState(null)
  const [editing, setEditing] = useState(false)

  // Compute the fraction value for a given clientY relative to the grid wrapper.
  const fractionFromClientY = useCallback((clientY) => {
    const el = wrapRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const y = clientY - rect.top
    return clamp01(1 - y / rect.height)
  }, [])

  // Compute the bar index for a given clientX.
  const indexFromClientX = useCallback((clientX) => {
    const el = wrapRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left
    const idx = Math.floor(x / (rect.width / 24))
    return Math.max(0, Math.min(23, idx))
  }, [])

  const handleMouseDown = useCallback((e) => {
    if (disabled) return
    e.preventDefault()
    setEditing(true)
    const idx = indexFromClientX(e.clientX)
    const v = fractionFromClientY(e.clientY)
    if (idx == null || v == null) return
    const next = values.slice()
    next[idx] = Math.round(v * 100) / 100
    onChange(next)

    const onMove = (ev) => {
      const i = indexFromClientX(ev.clientX)
      const f = fractionFromClientY(ev.clientY)
      if (i == null || f == null) return
      setHoverIdx(i)
      // Paint as user drags — both the bar under the cursor AND fill any
      // adjacent bars passed over since the last move event get the value.
      const arr = values.slice()
      arr[i] = Math.round(f * 100) / 100
      onChange(arr)
    }
    const onUp = () => {
      setEditing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [values, onChange, disabled, fractionFromClientY, indexFromClientX])

  const handleMouseMove = useCallback((e) => {
    if (editing) return  // drag handler owns it
    setHoverIdx(indexFromClientX(e.clientX))
  }, [editing, indexFromClientX])

  return (
    <div className="space-y-1 select-none">
      {/* Hover readout */}
      <div className="flex justify-between text-xxs text-mid-grey tabular-nums h-3.5">
        <span>{hoverIdx != null ? `${String(hoverIdx).padStart(2, '0')}:00` : ' '}</span>
        <span className="font-medium text-navy">
          {hoverIdx != null ? values[hoverIdx].toFixed(2) : ' '}
        </span>
      </div>

      {/* Bar grid — 24 vertical bars, each 1/24 of the wrapper width */}
      <div
        ref={wrapRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
        style={{ height: `${height}px` }}
        className={`relative bg-off-white border border-light-grey rounded ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-crosshair'
        }`}
        title="Drag to set fraction (top = 1.0, bottom = 0)"
      >
        <div className="absolute inset-0 flex">
          {values.map((v, i) => (
            <div
              key={i}
              className="flex-1 flex flex-col-reverse"
              style={{
                borderRight: i < 23 ? '1px solid rgba(0,0,0,0.04)' : 'none',
                backgroundColor: i === hoverIdx ? 'rgba(0,0,0,0.05)' : 'transparent',
              }}
            >
              <div
                style={{
                  height: `${v * 100}%`,
                  backgroundColor: accent,
                  opacity: 0.85,
                }}
              />
            </div>
          ))}
        </div>

        {/* Reference grid lines at 0.25, 0.5, 0.75 */}
        {[0.25, 0.5, 0.75].map(t => (
          <div
            key={t}
            className="absolute left-0 right-0 border-t border-mid-grey/15 pointer-events-none"
            style={{ top: `${(1 - t) * 100}%` }}
          />
        ))}
      </div>

      {/* Hour axis labels (sparse: 0, 6, 12, 18, 23) */}
      <div className="flex justify-between text-xxs text-mid-grey/70 tabular-nums px-0.5">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>
    </div>
  )
}

// ── Monthly multipliers row ──────────────────────────────────────────────────
function MonthlyRow({ values, onChange, accent, disabled, height = 40 }) {
  const wrapRef = useRef(null)
  const [hoverIdx, setHoverIdx] = useState(null)

  const handle = useCallback((e, isMove = false) => {
    if (disabled) return
    if (isMove && e.buttons === 0) return
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const idx = Math.max(0, Math.min(11, Math.floor(x / (rect.width / 12))))
    const frac = clamp01(1 - y / rect.height)
    setHoverIdx(idx)
    if (isMove && e.buttons !== 1) return
    const next = values.slice()
    next[idx] = Math.round(frac * 100) / 100
    onChange(next)
  }, [values, onChange, disabled])

  return (
    <div className="space-y-1 select-none">
      <div className="flex justify-between text-xxs text-mid-grey tabular-nums h-3.5">
        <span>{hoverIdx != null ? MONTHS[hoverIdx] : 'Monthly'}</span>
        <span className="font-medium text-navy">
          {hoverIdx != null ? values[hoverIdx].toFixed(2) : ' '}
        </span>
      </div>
      <div
        ref={wrapRef}
        onMouseDown={(e) => handle(e, false)}
        onMouseMove={(e) => handle(e, true)}
        onMouseLeave={() => setHoverIdx(null)}
        style={{ height: `${height}px` }}
        className={`relative bg-off-white border border-light-grey rounded ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-crosshair'
        }`}
      >
        <div className="absolute inset-0 flex">
          {values.map((v, i) => (
            <div key={i} className="flex-1 flex flex-col-reverse"
                 style={{ borderRight: i < 11 ? '1px solid rgba(0,0,0,0.04)' : 'none' }}>
              <div style={{ height: `${v * 100}%`, backgroundColor: accent, opacity: 0.85 }} />
            </div>
          ))}
        </div>
        <div className="absolute left-0 right-0 border-t border-mid-grey/15 pointer-events-none"
             style={{ top: '50%' }} />
      </div>
      <div className="flex justify-between text-xxs text-mid-grey/70 px-0.5">
        {MONTHS.map((m, i) => <span key={i} style={{ width: '1ch' }}>{m}</span>)}
      </div>
    </div>
  )
}

// ── Exception periods list ──────────────────────────────────────────────────
function ExceptionsList({ exceptions, onChange, disabled }) {
  const addOne = () => {
    const next = [...(exceptions || []), {
      name: 'New exception',
      start_date: '01-01',
      end_date:   '01-07',
      weekday:    new Array(24).fill(0),
      saturday:   new Array(24).fill(0),
      sunday:     new Array(24).fill(0),
      ignore_monthly_multipliers: false,
    }]
    onChange(next)
  }
  const removeAt = (i) => {
    const next = (exceptions || []).filter((_, j) => j !== i)
    onChange(next)
  }
  const updateAt = (i, patch) => {
    const next = (exceptions || []).slice()
    next[i] = { ...next[i], ...patch }
    onChange(next)
  }

  if (!exceptions || exceptions.length === 0) {
    return (
      <div className="space-y-1.5">
        <p className="text-xxs italic text-mid-grey/70">
          No exception periods. Add named date-ranged overrides for
          school holidays, shutdowns, peak events, etc.
        </p>
        <button
          onClick={addOne}
          disabled={disabled}
          className="flex items-center gap-1 px-2 py-1 text-xxs border border-dashed border-light-grey rounded hover:border-mid-grey hover:bg-off-white text-mid-grey disabled:opacity-50"
        >
          <Plus size={10} /> Add exception
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {exceptions.map((exc, i) => (
        <div key={i} className="border border-light-grey rounded p-2 space-y-1.5 bg-white">
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={exc.name ?? ''}
              onChange={e => updateAt(i, { name: e.target.value })}
              placeholder="Exception name"
              disabled={disabled}
              className="flex-1 px-1.5 py-0.5 text-xxs border border-light-grey rounded focus:outline-none focus:border-mid-grey"
            />
            <button
              onClick={() => removeAt(i)}
              disabled={disabled}
              className="text-mid-grey hover:text-red-600 transition-colors disabled:opacity-50"
              title="Delete exception"
            >
              <Trash2 size={11} />
            </button>
          </div>
          <div className="flex items-center gap-1 text-xxs">
            <span className="text-mid-grey">From</span>
            <input
              type="text"
              value={exc.start_date ?? ''}
              onChange={e => updateAt(i, { start_date: e.target.value })}
              placeholder="MM-DD"
              disabled={disabled}
              maxLength={5}
              className="w-14 px-1.5 py-0.5 border border-light-grey rounded text-center tabular-nums focus:outline-none focus:border-mid-grey"
            />
            <span className="text-mid-grey">to</span>
            <input
              type="text"
              value={exc.end_date ?? ''}
              onChange={e => updateAt(i, { end_date: e.target.value })}
              placeholder="MM-DD"
              disabled={disabled}
              maxLength={5}
              className="w-14 px-1.5 py-0.5 border border-light-grey rounded text-center tabular-nums focus:outline-none focus:border-mid-grey"
            />
          </div>
          <p className="text-xxs italic text-mid-grey/70">
            Hourly profile editor for exceptions lands in a follow-up; for
            now the start/end dates use the parent schedule's values.
          </p>
        </div>
      ))}
      <button
        onClick={addOne}
        disabled={disabled}
        className="flex items-center gap-1 px-2 py-1 text-xxs border border-dashed border-light-grey rounded hover:border-mid-grey hover:bg-off-white text-mid-grey disabled:opacity-50"
      >
        <Plus size={10} /> Add another
      </button>
    </div>
  )
}

// ── Collapsible sub-section (lighter weight than the parent CollapsibleSection) ──
function SubSection({ title, defaultOpen = false, badge, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t border-light-grey/60 pt-1.5 mt-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between py-0.5 text-left"
      >
        <span className="flex items-center gap-1 text-xxs uppercase tracking-wider text-mid-grey">
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          {title}
          {badge != null && (
            <span className="ml-1 px-1 rounded bg-mid-grey/20 text-mid-grey text-xxs">{badge}</span>
          )}
        </span>
      </button>
      {open && (
        <div className="pt-1.5 pb-0.5">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Main ScheduleEditor ──────────────────────────────────────────────────────
//
// Two-size component:
//   - PANEL mode (default): fits the 288 px left-panel section. Bar grid
//     64 px tall, monthly row 40 px. Used in Brief 27 Part 5.
//   - CANVAS mode: pass barGridHeight={140}+ and monthlyRowHeight={56}+
//     to get the breathing room appropriate for the centre canvas. Used
//     by ScheduleEditorCanvas (Brief 27 Revised Part 7).
//
// Drag-paint UX scales naturally from getBoundingClientRect — no other
// changes needed.
export default function ScheduleEditor({
  schedule,
  onChange,
  gainType = 'occupancy',
  accent = '#8B5CF6',
  disabled = false,
  barGridHeight = 64,
  monthlyRowHeight = 40,
}) {
  const [activeDay, setActiveDay] = useState('weekday')

  // Defensive defaults
  const safeSchedule = useMemo(() => ({
    weekday:             schedule?.weekday             ?? new Array(24).fill(0),
    saturday:            schedule?.saturday            ?? schedule?.weekday ?? new Array(24).fill(0),
    sunday:              schedule?.sunday              ?? schedule?.weekday ?? new Array(24).fill(0),
    monthly_multipliers: schedule?.monthly_multipliers ?? new Array(12).fill(1),
    exceptions:          schedule?.exceptions          ?? [],
  }), [schedule])

  const dayValues = safeSchedule[activeDay]

  const setDayValues = useCallback((next) => {
    onChange({ ...safeSchedule, [activeDay]: next })
  }, [safeSchedule, activeDay, onChange])

  const setMonthly = useCallback((next) => {
    onChange({ ...safeSchedule, monthly_multipliers: next })
  }, [safeSchedule, onChange])

  const setExceptions = useCallback((next) => {
    onChange({ ...safeSchedule, exceptions: next })
  }, [safeSchedule, onChange])

  const applyPresetById = useCallback((presetId) => {
    if (!presetId) return
    const next = applyPreset(safeSchedule, gainType, presetId)
    onChange(next)
  }, [safeSchedule, gainType, onChange])

  const resetAll = useCallback(() => {
    onChange(emptySchedule())
  }, [onChange])

  const presets = SCHEDULE_PRESETS[gainType] ?? []
  const exCount = safeSchedule.exceptions.length

  return (
    <div className="space-y-2">
      {/* Preset dropdown */}
      <div className="flex items-center gap-1">
        <select
          value=""
          onChange={e => applyPresetById(e.target.value)}
          disabled={disabled}
          className="flex-1 px-1.5 py-1 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-mid-grey disabled:opacity-50"
        >
          <option value="">Apply preset…</option>
          {presets.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button
          onClick={resetAll}
          disabled={disabled}
          className="px-1.5 py-1 text-xxs text-mid-grey border border-light-grey rounded hover:text-navy hover:border-mid-grey disabled:opacity-50"
          title="Reset to empty schedule"
        >
          Reset
        </button>
      </div>

      {/* Day-type pills */}
      <div className="flex gap-1">
        {DAY_TYPES.map(d => (
          <button
            key={d.key}
            onClick={() => setActiveDay(d.key)}
            className={`flex-1 px-1.5 py-0.5 text-xxs rounded border transition-colors ${
              activeDay === d.key
                ? 'border-mid-grey bg-navy text-white'
                : 'border-light-grey text-mid-grey hover:border-mid-grey'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* 24-hour bar grid for the active day type */}
      <HourBarGrid
        values={dayValues}
        onChange={setDayValues}
        accent={accent}
        disabled={disabled}
        height={barGridHeight}
      />

      {/* Monthly variation — collapsible */}
      <SubSection title="Monthly variation" defaultOpen={barGridHeight >= 100}>
        <MonthlyRow
          values={safeSchedule.monthly_multipliers}
          onChange={setMonthly}
          accent={accent}
          disabled={disabled}
          height={monthlyRowHeight}
        />
      </SubSection>

      {/* Exception periods — collapsible, with count badge */}
      <SubSection title="Exception periods" badge={exCount > 0 ? exCount : null}>
        <ExceptionsList
          exceptions={safeSchedule.exceptions}
          onChange={setExceptions}
          disabled={disabled}
        />
      </SubSection>
    </div>
  )
}
