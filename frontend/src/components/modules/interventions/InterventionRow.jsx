/**
 * InterventionRow.jsx — Brief 41 Part 3
 *                     + Brief 43 Part 3 (2026-05-20)
 *                     + Brief 45 Part 2 (2026-05-21)
 *
 * One row in the intervention stack. Composition (post Brief 45 Part 2):
 *   [drag] [dot] [label + summary] [Δ EUI marg] [Δ CO₂ marg] [Δ EUI cum]
 *                                  [Δ CO₂ cum] [save] [duplicate] [edit]
 *
 * Brief 43 Part 3 — inline patch-count + short plain-English summary
 * below the label. So the user can read what an intervention actually
 * does without opening the editor pop-out.
 *
 * Brief 45 Part 2 (2026-05-21):
 *   - Marginal + Cumulative now split into TWO columns each — one for
 *     ΔEUI (kWh/m²·yr), one for ΔCO₂ (kgCO₂/m²·yr). Pre-Brief-45 the
 *     row concatenated the EUI delta + percent into a single string that
 *     Chris's screenshot showed running into the cumulative cell.
 *     Per-cell width is now narrower; the percent moves to the tooltip
 *     so the headline number is uncluttered.
 *   - Empty-intervention treatment: when `intervention.patches.length
 *     === 0`, all four delta cells render "—" with muted styling instead
 *     of the engine's zero deltas. The empty row no longer reads like a
 *     real intervention with no effect; it reads like a placeholder.
 *   - Duplicate button (lucide:Copy) sits between Save-to-library and
 *     Edit. Calls onDuplicate(id) so the parent can deep-clone patches
 *     with new UUIDs and insert immediately after the source row.
 *
 * Enable toggle mirrors the Brief 40 Part 5b per-system pattern — a 2.5px
 * round dot, accent colour when on / grey when off; row wrapper carries
 * opacity-50 when disabled.
 *
 * Delta-cell colour: green when delta is negative (savings),
 * red when positive (increases), grey when zero / null.
 *
 * Disabled rows still receive their marginal_delta + cumulative_delta
 * from the engine (rendered muted) for reference. Engine returns all
 * zeros for disabled rows per audit doc §8.2 (disabled-row contract).
 *
 * Override-warning indicator: small ⚠ icon next to the label when any
 * of this intervention's patches addresses a path that an ENABLED later
 * intervention also patches. Tooltip explains "Overridden by Intervention
 * X" (last-write-wins per audit doc §6 boundary condition).
 */

import { GripVertical, Pencil, AlertTriangle, Save, Copy } from 'lucide-react'
import { summarizePatchListShort } from './patchCapture.js'

const INTERVENTIONS_ACCENT = '#E84393'

function formatDelta(record, unit = '') {
  if (!record || !Number.isFinite(record.delta)) return { text: '—', tooltip: '', tone: 'neutral' }
  const v = record.delta
  const pct = Number.isFinite(record.delta_pct) ? record.delta_pct : null
  if (Math.abs(v) < 0.05) {
    return { text: `0.0${unit}`, tooltip: pct == null ? '0.0%' : `${pct < 0 ? '−' : '+'}${Math.abs(pct).toFixed(1)}%`, tone: 'neutral' }
  }
  const sign = v < 0 ? '−' : '+'
  const abs = Math.abs(v).toFixed(1)
  const pctText = pct == null ? '' : `${pct < 0 ? '−' : '+'}${Math.abs(pct).toFixed(1)}%`
  return {
    text: `${sign}${abs}${unit}`,
    tooltip: pctText,
    tone: v < 0 ? 'good' : 'bad',
  }
}

function DeltaCell({ record, unit, muted, forceEmpty }) {
  // Brief 45 Part 2: forceEmpty (e.g. empty-intervention row) overrides
  // the engine's zero deltas and renders "—" so the empty row reads as
  // a placeholder rather than a real intervention with no effect.
  if (forceEmpty) {
    return <span className="text-xxs tabular-nums whitespace-nowrap text-mid-grey/40" title="No patches yet">—</span>
  }
  const { text, tooltip, tone } = formatDelta(record, unit)
  const baseClass = 'text-xxs tabular-nums whitespace-nowrap'
  if (muted) return <span className={`${baseClass} text-mid-grey/60`} title={tooltip}>{text}</span>
  if (tone === 'good')    return <span className={`${baseClass} text-green-600 font-medium`} title={tooltip}>{text}</span>
  if (tone === 'bad')     return <span className={`${baseClass} text-red-600 font-medium`} title={tooltip}>{text}</span>
  return <span className={`${baseClass} text-mid-grey`} title={tooltip}>{text}</span>
}

export default function InterventionRow({
  intervention,
  marginalDeltaFull,        // Full computeDelta object (Brief 45 Part 2)
  cumulativeDeltaFull,      // Full computeDelta object (Brief 45 Part 2)
  overridden,
  baselineConfig,
  onToggleEnabled,
  onEdit,
  onSaveToLibrary,
  onDuplicate,              // Brief 45 Part 2
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  draggingId,
}) {
  const isEnabled = intervention?.enabled !== false
  const isDragging = draggingId === intervention?.id
  const wrapperBase = 'flex items-start gap-3 px-3 py-2 rounded-lg border border-light-grey bg-white hover:border-mid-grey/40 transition-colors'
  const wrapperState = !isEnabled ? 'opacity-50' : ''
  const wrapperDrag  = isDragging ? 'ring-2 ring-offset-1' : ''

  // Brief 43 Part 3: derive patch count + short plain-English summary
  // from the intervention's patches. baselineConfig lets remove/replace
  // labels resolve the OLD entry's label by id.
  const patchCount = Array.isArray(intervention?.patches) ? intervention.patches.length : 0
  const patchSummary = patchCount > 0 ? summarizePatchListShort(intervention.patches, baselineConfig, { maxItems: 3 }) : null

  // Brief 45 Part 2: empty interventions render "—" in all four delta
  // cells. Engine returns 0.0 for these (no patches → no state change →
  // delta=0); pre-Brief-45 the row read like "intervention applied,
  // zero effect" rather than "intervention is a placeholder".
  const isEmpty = patchCount === 0

  // Pull the four delta records from the engine's structured output.
  const marginalEui    = marginalDeltaFull?.eui_kwh_per_m2 ?? null
  const marginalCarbon = marginalDeltaFull?.carbon_kgco2_per_m2 ?? null
  const cumEui         = cumulativeDeltaFull?.eui_kwh_per_m2 ?? null
  const cumCarbon      = cumulativeDeltaFull?.carbon_kgco2_per_m2 ?? null

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
        className="cursor-grab text-mid-grey/60 hover:text-mid-grey active:cursor-grabbing flex-shrink-0 mt-1"
        title="Drag to reorder"
        tabIndex={-1}
      >
        <GripVertical size={14} />
      </button>

      {/* Enable dot */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleEnabled?.() }}
        className="flex-shrink-0 p-0.5 rounded hover:bg-light-grey/40 transition-colors mt-0.5"
        title={isEnabled ? 'Disable this intervention' : 'Enable this intervention'}
      >
        <span
          className="block w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: isEnabled ? INTERVENTIONS_ACCENT : '#9CA3AF' }}
        />
      </button>

      {/* Label (top) + Brief 43 Part 3 patch summary (bottom) + theme +
          override warning. Two-row layout for the main label column so
          the at-a-glance patch summary fits beneath the title without
          competing for horizontal space with the Δ columns. */}
      <button
        type="button"
        onClick={onEdit}
        className="flex-1 min-w-0 text-left"
      >
        <div className="flex items-center gap-2">
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
        </div>
        {patchCount > 0 && (
          <div className="flex items-baseline gap-2 mt-0.5 min-w-0">
            <span className="flex-shrink-0 text-xxs text-mid-grey/70 tabular-nums">
              {patchCount} {patchCount === 1 ? 'patch' : 'patches'}:
            </span>
            <span className="text-xxs text-mid-grey truncate" title={patchSummary ?? ''}>
              {patchSummary ?? '—'}
            </span>
          </div>
        )}
        {patchCount === 0 && (
          <div className="text-xxs text-mid-grey/60 italic mt-0.5">No patches yet</div>
        )}
      </button>

      {/* Marginal ΔEUI */}
      <div className="flex-shrink-0 w-24 text-right">
        <DeltaCell record={marginalEui} unit=" kWh/m²" muted={!isEnabled} forceEmpty={isEmpty} />
      </div>

      {/* Marginal ΔCO₂ */}
      <div className="flex-shrink-0 w-24 text-right">
        <DeltaCell record={marginalCarbon} unit=" kgCO₂/m²" muted={!isEnabled} forceEmpty={isEmpty} />
      </div>

      {/* Cumulative ΔEUI */}
      <div className="flex-shrink-0 w-24 text-right">
        <DeltaCell record={cumEui} unit=" kWh/m²" muted={!isEnabled} forceEmpty={isEmpty} />
      </div>

      {/* Cumulative ΔCO₂ */}
      <div className="flex-shrink-0 w-24 text-right">
        <DeltaCell record={cumCarbon} unit=" kgCO₂/m²" muted={!isEnabled} forceEmpty={isEmpty} />
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

      {/* Brief 45 Part 2: Duplicate */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDuplicate?.() }}
        className="flex-shrink-0 p-1 rounded hover:bg-light-grey/40 transition-colors text-mid-grey"
        title="Duplicate this intervention"
      >
        <Copy size={12} />
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
