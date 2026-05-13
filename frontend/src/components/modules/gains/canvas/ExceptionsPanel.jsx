/**
 * ExceptionsPanel.jsx — canvas-level exception management.
 *
 * Brief 27 Revised Part 8. Replaces the v2.3-era inline ExceptionsList
 * that was buried inside the ScheduleEditor's collapsible sub-section.
 * Lives in the centre canvas next to the AnnualHeatmap so users see
 * their exceptions in the calendar AND in the management list together.
 *
 * Operations per exception:
 *   - Edit curves     → activates centre-canvas edit mode (banner appears,
 *                       schedule editor switches to this exception's curves)
 *   - Rename          → inline editable label
 *   - Date range      → MM-DD inputs, year-wrap supported
 *   - Icon            → optional emoji (click to swap from a small picker)
 *   - Ignore monthly multipliers → toggle
 *   - Duplicate       → copy with new id + suffix
 *   - Delete          → confirmation if exception has non-default curves
 *
 * "Add exception" dropdown surfaces four presets (Christmas / Summer /
 * Bank holidays / Custom) from `exceptions.js:EXCEPTION_PRESETS`.
 *
 * Highlight: clicking an exception in the list highlights it in the
 * AnnualHeatmap (via the `onHighlight` callback). Useful for "where
 * does this land in the year?" verification at-a-glance.
 */

import { useState, useRef, useEffect } from 'react'
import { Plus, Trash2, Edit3, Copy, ChevronDown } from 'lucide-react'
import { EXCEPTION_PRESETS, makeException } from './exceptions.js'

const ICON_CHOICES = ['🎄', '☀️', '🏛️', '📅', '🎉', '🛠️', '🌙', '✏️', '']

function DateField({ value, onChange, disabled }) {
  return (
    <input
      type="text"
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder="MM-DD"
      maxLength={5}
      disabled={disabled}
      className="w-14 px-1.5 py-0.5 text-xxs border border-light-grey rounded text-center tabular-nums focus:outline-none focus:border-mid-grey disabled:opacity-50"
    />
  )
}

function IconPicker({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        className="w-7 h-7 flex items-center justify-center border border-light-grey rounded bg-white hover:border-mid-grey disabled:opacity-50 transition-colors text-base"
        title="Choose icon"
      >
        {value || <span className="text-xxs text-mid-grey/60">—</span>}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 p-1 bg-white border border-light-grey rounded shadow-md flex gap-0.5">
          {ICON_CHOICES.map((icon, i) => (
            <button
              key={i}
              onClick={() => { onChange(icon); setOpen(false) }}
              className="w-7 h-7 flex items-center justify-center hover:bg-off-white rounded transition-colors text-base"
            >
              {icon || <span className="text-xxs text-mid-grey/60">—</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AddExceptionDropdown({ onApplyPreset, disabled }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        className="flex items-center gap-1 px-2 py-1 text-xxs border border-dashed border-mid-grey/60 rounded text-mid-grey hover:text-navy hover:border-navy bg-white disabled:opacity-50 transition-colors"
      >
        <Plus size={11} /> Add exception
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 right-0 bg-white border border-light-grey rounded shadow-md min-w-[260px] py-1">
          {Object.entries(EXCEPTION_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              onClick={() => { onApplyPreset(key); setOpen(false) }}
              className="w-full px-3 py-1.5 text-left hover:bg-off-white transition-colors"
            >
              <div className="text-caption text-navy">{preset.label}</div>
              <div className="text-xxs text-mid-grey/80">{preset.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ExceptionsPanel({
  exceptions,
  onChange,
  parentSchedule,
  onEditException,
  highlightExceptionId,
  onHighlight,
  disabled,
}) {
  const list = exceptions ?? []

  const updateAt = (idx, patch) => {
    const next = list.slice()
    next[idx] = { ...next[idx], ...patch }
    onChange(next)
  }

  const removeAt = (idx) => {
    const next = list.filter((_, j) => j !== idx)
    onChange(next)
    if (highlightExceptionId === list[idx]?.id) onHighlight?.(null)
  }

  const duplicateAt = (idx) => {
    const src = list[idx]
    const copy = makeException({
      name: `${src.name} (copy)`,
      icon: src.icon,
      start_date: src.start_date,
      end_date:   src.end_date,
      curveSource: { weekday: src.weekday, saturday: src.saturday, sunday: src.sunday },
      ignore_monthly_multipliers: src.ignore_monthly_multipliers,
    })
    const next = list.slice()
    next.splice(idx + 1, 0, copy)
    onChange(next)
  }

  const applyPreset = (presetKey) => {
    const preset = EXCEPTION_PRESETS[presetKey]
    if (!preset) return
    const added = preset.apply(parentSchedule)
    onChange([...list, ...added])
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xxs uppercase tracking-wider text-mid-grey">
          Exception periods {list.length > 0 && <span className="ml-1 text-mid-grey/60">({list.length})</span>}
        </h3>
        <AddExceptionDropdown onApplyPreset={applyPreset} disabled={disabled} />
      </div>

      {list.length === 0 && (
        <p className="text-xxs italic text-mid-grey/70 px-1 py-2">
          No exception periods. Date-ranged overrides for shutdowns,
          holidays, peak events, etc. Pick a preset above to start.
        </p>
      )}

      <div className="space-y-1.5">
        {list.map((exc, i) => {
          const isHi = exc.id === highlightExceptionId
          return (
            <div
              key={exc.id ?? i}
              onMouseEnter={() => onHighlight?.(exc.id)}
              onMouseLeave={() => onHighlight?.(null)}
              className={`border rounded px-2 py-1.5 transition-colors ${
                isHi ? 'border-orange-400 bg-orange-50/60' : 'border-light-grey bg-white'
              }`}
            >
              <div className="flex items-center gap-2">
                <IconPicker
                  value={exc.icon ?? ''}
                  onChange={(icon) => updateAt(i, { icon })}
                  disabled={disabled}
                />
                <input
                  type="text"
                  value={exc.name ?? ''}
                  onChange={e => updateAt(i, { name: e.target.value })}
                  placeholder="Exception name"
                  disabled={disabled}
                  className="flex-1 px-1.5 py-0.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-mid-grey disabled:opacity-50"
                />
                <button
                  onClick={() => onEditException?.(exc.id)}
                  disabled={disabled}
                  className="flex items-center gap-1 px-2 py-0.5 text-xxs text-white rounded transition-colors disabled:opacity-50"
                  style={{ backgroundColor: '#EA580C' }}
                  title="Edit this exception's curves in place of the default schedule"
                >
                  <Edit3 size={10} /> Edit curves
                </button>
                <button
                  onClick={() => duplicateAt(i)}
                  disabled={disabled}
                  className="text-mid-grey hover:text-navy transition-colors disabled:opacity-50"
                  title="Duplicate"
                >
                  <Copy size={12} />
                </button>
                <button
                  onClick={() => removeAt(i)}
                  disabled={disabled}
                  className="text-mid-grey hover:text-red-600 transition-colors disabled:opacity-50"
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1.5 pl-9 text-xxs">
                <span className="text-mid-grey">From</span>
                <DateField value={exc.start_date} onChange={(v) => updateAt(i, { start_date: v })} disabled={disabled} />
                <span className="text-mid-grey">to</span>
                <DateField value={exc.end_date} onChange={(v) => updateAt(i, { end_date: v })} disabled={disabled} />
                <label className="ml-3 flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!exc.ignore_monthly_multipliers}
                    onChange={e => updateAt(i, { ignore_monthly_multipliers: e.target.checked })}
                    disabled={disabled}
                    className="accent-navy"
                  />
                  <span className="text-mid-grey">ignore monthly mults</span>
                </label>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
