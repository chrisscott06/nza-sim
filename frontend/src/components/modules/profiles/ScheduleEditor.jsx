/**
 * ScheduleEditor.jsx
 *
 * Interactive editor for creating and editing custom schedules.
 * - Drag-to-paint 24-hour bar chart (one bar per hour)
 * - Three day-type tabs: Weekday, Saturday, Sunday
 * - 12 monthly multiplier sliders
 * - Quick-set tools: Flat, Copy Weekday to Weekend, Invert, Shift ±1h
 * - Live heatmap preview (updates as you drag)
 * - Save to Library / Assign to Project
 */

import { useState, useRef, useEffect, useCallback, useContext } from 'react'
import {
  ArrowLeft, ArrowRight, Copy, FlipHorizontal,
  AlignCenter, Save, Check,
} from 'lucide-react'
import HeatmapView from './HeatmapView.jsx'
import { ProjectContext } from '../../../context/ProjectContext.jsx'

const HOUR_LABELS  = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAY_TABS     = [
  { id: 'weekday',  label: 'Weekday' },
  { id: 'saturday', label: 'Saturday' },
  { id: 'sunday',   label: 'Sunday' },
]

// ── Drag-to-paint bar chart ────────────────────────────────────────────────────

function EditableBarChart({ values, onChange }) {
  const containerRef = useRef(null)
  const isDragging   = useRef(false)

  const getHourAndValue = useCallback((e) => {
    const el   = containerRef.current
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
        className="relative flex items-end gap-px h-36 bg-gray-50 rounded-lg overflow-hidden cursor-crosshair select-none p-1.5 pb-0"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
      >
        {values.map((v, i) => (
          <div key={i} className="flex-1 flex flex-col justify-end h-full">
            <div
              className="w-full rounded-t-sm"
              style={{
                height: `${Math.max(2, v * 100)}%`,
                backgroundColor: '#2B2A4C',
                opacity: 0.8,
              }}
            />
          </div>
        ))}
      </div>

      {/* Hour labels */}
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

// ── Monthly multiplier sliders ─────────────────────────────────────────────────

function MonthlySliders({ values, onChange }) {
  return (
    <div>
      <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Monthly Multipliers</p>
      <div className="grid grid-cols-6 gap-x-2 gap-y-3">
        {MONTH_LABELS.map((m, i) => (
          <div key={m} className="flex flex-col items-center gap-0.5">
            <span className="text-xxs font-medium text-navy">{Number(values[i]).toFixed(2)}</span>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={values[i]}
              onChange={e => {
                const next = [...values]
                next[i] = parseFloat(e.target.value)
                onChange(next)
              }}
              className="w-full h-1 accent-navy"
              style={{ writingMode: 'vertical-lr', direction: 'rtl', height: 60, width: 20 }}
            />
            <span className="text-xxs text-mid-grey">{m}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main ScheduleEditor ────────────────────────────────────────────────────────

export default function ScheduleEditor({ initialSchedule, onSaved, onCancel }) {
  const { currentProjectId } = useContext(ProjectContext)

  // Editable state — deep copy of initial
  const [name,       setName]       = useState(initialSchedule.display_name ?? initialSchedule.name ?? 'New Schedule')
  const [schedType,  setSchedType]  = useState((initialSchedule.config_json ?? {}).schedule_type  ?? 'occupancy')
  const [zoneType,   setZoneType]   = useState((initialSchedule.config_json ?? {}).zone_type       ?? 'bedroom')
  const [activeDay,  setActiveDay]  = useState('weekday')
  const [dayTypes,   setDayTypes]   = useState(() => {
    const dt = (initialSchedule.config_json ?? {}).day_types ?? {}
    return {
      weekday:  [...(dt.weekday  ?? Array(24).fill(0.5))],
      saturday: [...(dt.saturday ?? Array(24).fill(0.5))],
      sunday:   [...(dt.sunday   ?? Array(24).fill(0.5))],
    }
  })
  const [multipliers, setMultipliers] = useState(
    [...((initialSchedule.config_json ?? {}).monthly_multipliers ?? Array(12).fill(1))]
  )

  const [saving,    setSaving]    = useState(false)
  const [savedId,   setSavedId]   = useState(null)
  const [saveError, setSaveError] = useState(null)

  // Flat value for the "Flat" quick-set tool
  const [flatValue, setFlatValue] = useState('0.5')

  // Build a preview schedule object for HeatmapView (updates in real time)
  const previewSchedule = {
    config_json: {
      day_types:           dayTypes,
      monthly_multipliers: multipliers,
      schedule_type:       schedType,
    }
  }

  // ── Quick-set actions ──────────────────────────────────────────────────────

  function applyFlat() {
    const v = Math.max(0, Math.min(1, parseFloat(flatValue) || 0.5))
    setDayTypes(d => ({ ...d, [activeDay]: Array(24).fill(v) }))
  }

  function copyWeekdayToWeekend() {
    setDayTypes(d => ({
      ...d,
      saturday: [...d.weekday],
      sunday:   [...d.weekday],
    }))
  }

  function invertCurrent() {
    setDayTypes(d => ({
      ...d,
      [activeDay]: d[activeDay].map(v => +(1 - v).toFixed(2)),
    }))
  }

  function shiftCurrent(hours) {
    setDayTypes(d => {
      const arr  = d[activeDay]
      const n    = arr.length
      const norm = ((hours % n) + n) % n
      return {
        ...d,
        [activeDay]: [...arr.slice(n - norm), ...arr.slice(0, n - norm)],
      }
    })
  }

  // ── Save to library ────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const payload = {
        library_type: 'schedule',
        name:         name.toLowerCase().replace(/\s+/g, '_'),
        display_name: name,
        description:  `Custom ${schedType} schedule — ${zoneType}`,
        config_json: {
          schedule_type:       schedType,
          zone_type:           zoneType,
          time_resolution:     'hourly',
          display_name:        name,
          description:         `Custom ${schedType} schedule — ${zoneType}`,
          day_types:           dayTypes,
          monthly_multipliers: multipliers,
        },
      }
      const res  = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const item = await res.json()
      setSavedId(item.id)
      if (onSaved) onSaved(item)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-section font-semibold text-navy mb-1">Custom Schedule Editor</h2>
            <p className="text-xs text-mid-grey">Drag the bars to set hourly values · Use quick-set tools below</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-caption border border-light-grey rounded-lg text-mid-grey hover:text-navy hover:border-navy transition-colors"
            >
              Cancel
            </button>
            {savedId ? (
              <span className="flex items-center gap-1 px-3 py-1.5 text-caption bg-green-50 text-green-700 rounded-lg border border-green-200">
                <Check size={12} /> Saved
              </span>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-caption bg-navy text-white rounded-lg hover:bg-opacity-90 transition-colors disabled:opacity-60"
              >
                <Save size={12} />
                {saving ? 'Saving…' : 'Save to Library'}
              </button>
            )}
          </div>
        </div>

        {saveError && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            Save failed: {saveError}
          </div>
        )}

        {/* Name + type fields */}
        <div className="bg-white rounded-xl border border-light-grey p-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">Name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-2 py-1.5 text-caption border border-light-grey rounded focus:outline-none focus:border-teal"
              />
            </div>
            <div>
              <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">Schedule Type</label>
              <select
                value={schedType}
                onChange={e => setSchedType(e.target.value)}
                className="w-full px-2 py-1.5 text-caption border border-light-grey rounded focus:outline-none focus:border-teal bg-white"
              >
                {['occupancy','lighting','equipment','heating_setpoint','cooling_setpoint','dhw'].map(t => (
                  <option key={t} value={t}>{t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">Zone Type</label>
              <select
                value={zoneType}
                onChange={e => setZoneType(e.target.value)}
                className="w-full px-2 py-1.5 text-caption border border-light-grey rounded focus:outline-none focus:border-teal bg-white"
              >
                {['bedroom','corridor','reception','office','retail','general'].map(z => (
                  <option key={z} value={z}>{z.replace(/\b\w/g,c=>c.toUpperCase())}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-5">
          {/* Left: editable bar chart */}
          <div className="bg-white rounded-xl border border-light-grey p-4 space-y-4">

            {/* Day type tabs */}
            <div className="flex items-center gap-1 bg-off-white rounded-lg p-0.5 w-fit">
              {DAY_TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveDay(tab.id)}
                  className={`px-3 py-1 rounded-md text-caption transition-colors ${
                    activeDay === tab.id
                      ? 'bg-white text-navy shadow-sm font-medium'
                      : 'text-mid-grey hover:text-navy'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Bar chart */}
            <EditableBarChart
              values={dayTypes[activeDay]}
              onChange={vals => setDayTypes(d => ({ ...d, [activeDay]: vals }))}
            />

            {/* Quick-set tools */}
            <div className="border-t border-light-grey pt-3">
              <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Quick Set</p>
              <div className="flex flex-wrap gap-2">
                {/* Flat */}
                <div className="flex items-center gap-1 border border-light-grey rounded px-2 py-1">
                  <span className="text-xxs text-mid-grey">Flat</span>
                  <input
                    type="number"
                    min={0} max={1} step={0.05}
                    value={flatValue}
                    onChange={e => setFlatValue(e.target.value)}
                    className="w-10 text-xxs border-0 focus:outline-none text-center"
                  />
                  <button
                    onClick={applyFlat}
                    className="text-xxs text-navy hover:underline"
                  >
                    Apply
                  </button>
                </div>

                {/* Copy to weekend */}
                <button
                  onClick={copyWeekdayToWeekend}
                  className="flex items-center gap-1 px-2 py-1 border border-light-grey rounded text-xxs text-mid-grey hover:text-navy hover:border-navy transition-colors"
                >
                  <Copy size={10} /> Copy Weekday to Weekend
                </button>

                {/* Invert */}
                <button
                  onClick={invertCurrent}
                  className="flex items-center gap-1 px-2 py-1 border border-light-grey rounded text-xxs text-mid-grey hover:text-navy hover:border-navy transition-colors"
                >
                  <FlipHorizontal size={10} /> Invert
                </button>

                {/* Shift */}
                <div className="flex items-center gap-1 border border-light-grey rounded px-2 py-1">
                  <span className="text-xxs text-mid-grey">Shift</span>
                  <button
                    onClick={() => shiftCurrent(-1)}
                    className="p-0.5 hover:text-navy transition-colors"
                    title="Shift 1 hour earlier"
                  >
                    <ArrowLeft size={10} />
                  </button>
                  <button
                    onClick={() => shiftCurrent(1)}
                    className="p-0.5 hover:text-navy transition-colors"
                    title="Shift 1 hour later"
                  >
                    <ArrowRight size={10} />
                  </button>
                </div>
              </div>
            </div>

            {/* Monthly multipliers */}
            <div className="border-t border-light-grey pt-3">
              <MonthlySliders values={multipliers} onChange={setMultipliers} />
            </div>
          </div>

          {/* Right: live heatmap preview */}
          <div className="bg-white rounded-xl border border-light-grey p-4">
            <p className="text-caption font-medium text-navy mb-3">Live Preview</p>
            <HeatmapView schedule={previewSchedule} />
          </div>
        </div>
      </div>
  )
}
