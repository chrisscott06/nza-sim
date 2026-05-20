/**
 * InterventionRow.jsx — Brief 41 Part 3
 *
 * One row in the intervention stack. Composition:
 *   [drag handle] [enable dot] [label] [marginal Δ] [cumulative Δ] [edit]
 *
 * Enable toggle mirrors the Brief 40 Part 5b per-system pattern — a 2.5px
 * round dot, accent colour when on / grey when off; row wrapper carries
 * opacity-50 when disabled.
 *
 * Marginal / cumulative deltas are rendered as EUI changes (kWh/m²·yr)
 * with a percent. Colour: green when delta is negative (savings),
 * red when positive (increases), grey when zero / null.
 *
 * Disabled rows still render their marginal_delta from the engine for
 * reference (showing "what the marginal would have been if enabled"),
 * but the engine returns all zeros for disabled rows (per audit doc
 * §8.2 — disabled-row contract). So in practice the disabled row shows
 * 0.0 in both delta columns.
 *
 * Override-warning indicator: small ⚠ icon next to the label when any
 * of this intervention's patches addresses a path that an ENABLED later
 * intervention also patches. Tooltip explains "Overridden by
 * Intervention X" (last-write-wins per audit doc §6 boundary condition).
 *
 * Editor pop-out (Brief 41 Part 4) opens on label click or edit button
 * click. Part 3 ships a stub onEdit() handler; the full editor lives
 * in InterventionEditorPopout from Part 4.
 */

import { GripVertical, Pencil, AlertTriangle, Save } from 'lucide-react'

const INTERVENTIONS_ACCENT = '#E84393'

function formatDelta(record, unit = '') {
  if (!record || !Number.isFinite(record.delta)) return { text: '—', tone: 'neutral' }
  const v = record.delta
  const pct = Number.isFinite(record.delta_pct) ? record.delta_pct : null
  if (Math.abs(v) < 0.05) {
    return { text: `0.0${unit}`, tone: 'neutral' }
  }
  const sign = v < 0 ? '−' : '+'
  const abs = Math.abs(v).toFixed(1)
  const pctText = pct == null ? '' : ` (${pct < 0 ? '−' : '+'}${Math.abs(pct).toFixed(0)}%)`
  return {
    text: `${sign}${abs}${unit}${pctText}`,
    tone: v < 0 ? 'good' : 'bad',
  }
}

function DeltaCell({ record, unit, muted }) {
  const { text, tone } = formatDelta(record, unit)
  const baseClass = 'text-xxs tabular-nums whitespace-nowrap'
  if (muted) return <span className={`${baseClass} text-mid-grey/60`}>{text}</span>
  if (tone === 'good')    return <span className={`${baseClass} text-green-600 font-medium`}>{text}</span>
  if (tone === 'bad')     return <span className={`${baseClass} text-red-600 font-medium`}>{text}</span>
  return <span className={`${baseClass} text-mid-grey`}>{text}</span>
}

export default function InterventionRow({
  intervention,
  marginalDelta,
  cumulativeDelta,
  overridden,
  onToggleEnabled,
  onEdit,
  onSaveToLibrary,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  draggingId,
}) {
  const isEnabled = intervention?.enabled !== false
  const isDragging = draggingId === intervention?.id
  const wrapperBase = 'flex items-center gap-3 px-3 py-2 rounded-lg border border-light-grey bg-white hover:border-mid-grey/40 transition-colors'
  const wrapperState = !isEnabled ? 'opacity-50' : ''
  const wrapperDrag  = isDragging ? 'ring-2 ring-offset-1' : ''

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart?.(e, intervention?.id)}
      onDragOver={(e) => onDragOver?.(e, intervention?.id)}
      onDrop={(e) => onDrop?.(e, intervention?.id)}
      onDragEnd={onDragEnd}
      className={`${wrapperBase} ${wrapperState} ${wrapperDrag}`}
      style={isDragging ? { borderColor: INTERVENTIONS_ACCENT } : undefined}
    >
      {/* Drag handle */}
      <button
        type="button"
        className="cursor-grab text-mid-grey/60 hover:text-mid-grey active:cursor-grabbing flex-shrink-0"
        title="Drag to reorder"
        tabIndex={-1}
      >
        <GripVertical size={14} />
      </button>

      {/* Enable dot */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleEnabled?.() }}
        className="flex-shrink-0 p-0.5 rounded hover:bg-light-grey/40 transition-colors"
        title={isEnabled ? 'Disable this intervention' : 'Enable this intervention'}
      >
        <span
          className="block w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: isEnabled ? INTERVENTIONS_ACCENT : '#9CA3AF' }}
        />
      </button>

      {/* Label + theme + override warning */}
      <button
        type="button"
        onClick={onEdit}
        className="flex-1 min-w-0 flex items-center gap-2 text-left"
      >
        <span className={`flex-shrink min-w-0 truncate text-caption ${isEnabled ? 'text-navy font-medium' : 'text-mid-grey line-through'}`}>
          {intervention?.label || '(unnamed intervention)'}
        </span>
        {intervention?.theme && (
          <span
            className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-light-grey/60 text-xxs text-mid-grey font-medium"
            title={`Theme: ${intervention.theme}`}
          >
            {intervention.theme}
          </span>
        )}
        {overridden && isEnabled && (
          <AlertTriangle
            size={12}
            className="flex-shrink-0 text-amber-600"
            aria-label="Overridden by a later intervention"
          >
            <title>One or more of this intervention's patches are overridden by a later enabled intervention (last-write-wins).</title>
          </AlertTriangle>
        )}
      </button>

      {/* Marginal */}
      <div className="flex-shrink-0 w-28 text-right">
        <DeltaCell record={marginalDelta} unit=" kWh/m²" muted={!isEnabled} />
      </div>

      {/* Cumulative */}
      <div className="flex-shrink-0 w-28 text-right">
        <DeltaCell record={cumulativeDelta} unit=" kWh/m²" muted={!isEnabled} />
      </div>

      {/* Save to library */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onSaveToLibrary?.() }}
        className="flex-shrink-0 p-1 rounded hover:bg-light-grey/40 transition-colors text-mid-grey"
        title="Save this intervention to library"
      >
        <Save size={12} />
      </button>

      {/* Edit */}
      <button
        type="button"
        onClick={onEdit}
        className="flex-shrink-0 p-1 rounded hover:bg-light-grey/40 transition-colors text-mid-grey"
        title="Edit this intervention"
      >
        <Pencil size={12} />
      </button>
    </div>
  )
}
