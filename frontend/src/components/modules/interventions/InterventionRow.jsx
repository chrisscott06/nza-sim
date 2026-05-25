/**
 * InterventionRow.jsx — Brief 47 Part 5a (2026-05-24)
 *
 * Card layout (replaces the Brief 41/43/45 horizontal-row layout that
 * squeezed labels into a sliver when the stack moved to the left pane
 * at Brief 47 Part 3). Composition:
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ ⠿ ● Label                            [⧉ Dup] [✏ Edit] [🗑]│
 *   │       n patch(es): summary…                              │
 *   │       ⚠ Overridden by a later intervention (if any)      │
 *   │ ┌────────┬───────────┬───────────┐                       │
 *   │ │        │ Marginal  │ Cumulative│                       │
 *   │ ├────────┼───────────┼───────────┤                       │
 *   │ │ ΔEUI   │ +1.6      │ +1.6      │ kWh/m²·yr             │
 *   │ │ ΔCO₂   │ +0.3      │ +0.3      │ kgCO₂/m²·yr           │
 *   │ └────────┴───────────┴───────────┘                       │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Action icons are visible up-front (each in its own button with a
 * background hover and a recognisable colour: duplicate = neutral, edit
 * = navy, delete = red). The Brief 47 Part 1 amendment widened delete
 * scope — Trash2 lives at the right edge of the action row.
 *
 * Brief 47 Part 5a (this commit, 2026-05-24): card redesign per Chris's
 * mid-walkthrough finding — the previous horizontal layout truncated
 * labels and made the action icons nearly invisible in the 560 px-wide
 * left pane. Column headers in InterventionStackView retired (each card
 * now carries its own labelled metrics table).
 */

import { useState } from 'react'
import { GripVertical, Pencil, AlertTriangle, Copy, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
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
  return { text: `${sign}${abs}${unit}`, tooltip: pctText, tone: v < 0 ? 'good' : 'bad' }
}

function DeltaCell({ record, muted, forceEmpty }) {
  if (forceEmpty) {
    return <span className="text-xxs tabular-nums text-mid-grey/40" title="No patches yet">—</span>
  }
  const { text, tooltip, tone } = formatDelta(record, '')
  if (muted) return <span className="text-xxs tabular-nums text-mid-grey/60" title={tooltip}>{text}</span>
  if (tone === 'good')    return <span className="text-xxs tabular-nums text-green-700 font-medium" title={tooltip}>{text}</span>
  if (tone === 'bad')     return <span className="text-xxs tabular-nums text-red-700 font-medium" title={tooltip}>{text}</span>
  return <span className="text-xxs tabular-nums text-mid-grey" title={tooltip}>{text}</span>
}

function MetricsTable({ marginalEui, marginalCarbon, cumEui, cumCarbon, muted, forceEmpty }) {
  return (
    <table className="w-full mt-2 text-xxs border-collapse">
      <thead>
        <tr className="text-mid-grey/70">
          <th className="text-left font-medium uppercase tracking-wider pb-1 w-12"></th>
          <th className="text-right font-medium uppercase tracking-wider pb-1">Marginal</th>
          <th className="text-right font-medium uppercase tracking-wider pb-1">Cumulative</th>
          <th className="text-left font-normal pb-1 pl-2 text-mid-grey/60 normal-case">unit</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-t border-light-grey/60">
          <td className="text-mid-grey font-medium py-1">ΔEUI</td>
          <td className="text-right py-1"><DeltaCell record={marginalEui} muted={muted} forceEmpty={forceEmpty} /></td>
          <td className="text-right py-1"><DeltaCell record={cumEui}      muted={muted} forceEmpty={forceEmpty} /></td>
          <td className="text-mid-grey/70 pl-2 py-1">kWh/m²·yr</td>
        </tr>
        <tr className="border-t border-light-grey/60">
          <td className="text-mid-grey font-medium py-1">ΔCO₂</td>
          <td className="text-right py-1"><DeltaCell record={marginalCarbon} muted={muted} forceEmpty={forceEmpty} /></td>
          <td className="text-right py-1"><DeltaCell record={cumCarbon}      muted={muted} forceEmpty={forceEmpty} /></td>
          <td className="text-mid-grey/70 pl-2 py-1">kgCO₂/m²·yr</td>
        </tr>
      </tbody>
    </table>
  )
}

export default function InterventionRow({
  intervention,
  marginalDeltaFull,        // Full computeDelta object (Brief 45 Part 2)
  cumulativeDeltaFull,      // Full computeDelta object (Brief 45 Part 2)
  overridden,
  baselineConfig,
  onToggleEnabled,
  onEdit,
  onDuplicate,              // Brief 45 Part 2
  onDelete,                 // Brief 47 Part 1.3
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  draggingId,
}) {
  // Brief 47 Part 5c (2026-05-24): collapse/expand state per row.
  // Defaults to COLLAPSED so the stack stays compact for drag-reorder —
  // user can expand individual rows to see the metrics table + patch
  // summary when they want detail. Local state per row (not lifted to
  // StackView) — simpler, no persistence across reloads. If usage shows
  // most rows stay expanded, swap the default to `true`.
  const [expanded, setExpanded] = useState(false)
  const isEnabled = intervention?.enabled !== false
  const isDragging = draggingId === intervention?.id
  const wrapperBase = 'rounded-lg border bg-white hover:border-mid-grey/40 transition-colors'
  // When collapsed: tighter vertical padding so the row reads as a
  // single line. When expanded: full p-3 padding for breathing room.
  const wrapperPadding = expanded ? 'p-3' : 'px-3 py-2'
  const wrapperState = !isEnabled ? 'opacity-60' : ''
  const wrapperDrag  = isDragging ? 'ring-2 ring-offset-1' : ''

  const patchCount = Array.isArray(intervention?.patches) ? intervention.patches.length : 0
  const patchSummary = patchCount > 0 ? summarizePatchListShort(intervention.patches, baselineConfig, { maxItems: 3 }) : null
  const isEmpty = patchCount === 0

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
      className={`${wrapperBase} ${wrapperPadding} ${wrapperState} ${wrapperDrag} border-light-grey`}
      style={isDragging ? { borderColor: INTERVENTIONS_ACCENT } : undefined}
    >
      {/* Header row: drag handle · enable dot · label · chevron · actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="cursor-grab text-mid-grey/60 hover:text-mid-grey active:cursor-grabbing flex-shrink-0"
          title="Drag to reorder"
          tabIndex={-1}
        >
          <GripVertical size={14} />
        </button>

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

        {/* Label + meta — click toggles expand/collapse (cheap discovery).
            Dedicated edit affordance is the pencil in the action toolbar
            to its right, so click-to-expand here doesn't steal the
            click-to-edit gesture. */}
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="flex-1 min-w-0 text-left"
          title={expanded ? 'Click to collapse' : 'Click to expand'}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className={`flex-shrink min-w-0 truncate text-caption ${isEnabled ? 'text-navy font-semibold' : 'text-mid-grey line-through'}`}>
              {intervention?.label || '(unnamed intervention)'}
            </span>
            {/* When collapsed, show a tiny patch-count badge so the user
                has at-a-glance richness without expanding. Hidden when
                expanded — the indented summary block below carries the
                same info in more detail. */}
            {!expanded && patchCount > 0 && (
              <span
                className="flex-shrink-0 text-xxs text-mid-grey/70 tabular-nums"
                title={patchSummary ?? ''}
              >
                · {patchCount} {patchCount === 1 ? 'patch' : 'patches'}
              </span>
            )}
            {!expanded && patchCount === 0 && (
              <span className="flex-shrink-0 text-xxs italic text-mid-grey/60">
                · no patches
              </span>
            )}
            {overridden && isEnabled && !expanded && (
              <AlertTriangle
                size={11}
                className="flex-shrink-0 text-amber-600"
                aria-label="Overridden by a later intervention"
              />
            )}
            {intervention?.theme && (
              <span
                className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-light-grey/60 text-xxs text-mid-grey font-medium"
                title={`Theme: ${intervention.theme}`}
              >
                {intervention.theme}
              </span>
            )}
          </div>
        </button>

        {/* Expand / collapse chevron — separate from the label button so
            screen-reader users get a distinct semantic action. */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}
          className="flex-shrink-0 p-1 rounded hover:bg-light-grey/40 text-mid-grey hover:text-navy transition-colors"
          title={expanded ? 'Collapse' : 'Expand'}
          aria-label={expanded ? 'Collapse intervention details' : 'Expand intervention details'}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>

        {/* Action toolbar — visible up-front (Brief 47 Part 5a). Spacing
            kept tight (gap-0.5) so the cluster reads as one toolbar, not
            three loose icons. Backgrounds appear on hover. */}
        <div className="flex-shrink-0 flex items-center gap-0.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDuplicate?.() }}
            className="p-1.5 rounded hover:bg-light-grey/50 text-mid-grey hover:text-navy transition-colors"
            title="Duplicate this intervention"
            aria-label="Duplicate"
          >
            <Copy size={13} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit?.() }}
            className="p-1.5 rounded hover:bg-light-grey/50 text-mid-grey hover:text-navy transition-colors"
            title="Edit this intervention"
            aria-label="Edit"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete?.() }}
            className="p-1.5 rounded hover:bg-red-50 text-mid-grey hover:text-red-600 transition-colors"
            title="Delete this intervention"
            aria-label="Delete"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Expanded body — Brief 47 Part 5c: rendered only when the user
          opens the row. Holds the longer patch summary, the override
          warning, and the metrics table. Collapsed state keeps the
          stack tight for drag-reorder per Chris's brief. */}
      {expanded && (
        <>
          <div className="pl-7 mt-2">
            {patchCount > 0 ? (
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="flex-shrink-0 text-xxs text-mid-grey/70 tabular-nums">
                  {patchCount} {patchCount === 1 ? 'patch' : 'patches'}:
                </span>
                <span className="text-xxs text-mid-grey truncate" title={patchSummary ?? ''}>
                  {patchSummary ?? '—'}
                </span>
              </div>
            ) : (
              <div className="text-xxs text-mid-grey/60 italic">No patches yet</div>
            )}

            {overridden && isEnabled && (
              <div className="flex items-center gap-1 mt-1 text-xxs text-amber-700">
                <AlertTriangle size={11} className="flex-shrink-0" />
                <span>Overridden by a later intervention (last-write-wins)</span>
              </div>
            )}
          </div>

          <MetricsTable
            marginalEui={marginalEui}
            marginalCarbon={marginalCarbon}
            cumEui={cumEui}
            cumCarbon={cumCarbon}
            muted={!isEnabled}
            forceEmpty={isEmpty}
          />
        </>
      )}
    </div>
  )
}
