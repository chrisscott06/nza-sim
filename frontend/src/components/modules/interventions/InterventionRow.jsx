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
import { GripVertical, AlertTriangle, X, ChevronDown, ChevronRight, ChevronUp, Loader2 } from 'lucide-react'
import { summarizePatchListShort } from './patchCapture.js'
import { useUISettings } from '../../../context/UISettingsContext.jsx'
import { toDisplay, KIND } from './visualiser/unitFmt.js'

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

function MetricsTable({ marginalEui, marginalCarbon, cumEui, cumCarbon, muted, forceEmpty, euiUnitLabel = 'kWh/m²·yr', carbonUnitLabel = 'kgCO₂/m²·yr' }) {
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
          <td className="text-mid-grey/70 pl-2 py-1">{euiUnitLabel}</td>
        </tr>
        <tr className="border-t border-light-grey/60">
          <td className="text-mid-grey font-medium py-1">ΔCO₂</td>
          <td className="text-right py-1"><DeltaCell record={marginalCarbon} muted={muted} forceEmpty={forceEmpty} /></td>
          <td className="text-right py-1"><DeltaCell record={cumCarbon}      muted={muted} forceEmpty={forceEmpty} /></td>
          <td className="text-mid-grey/70 pl-2 py-1">{carbonUnitLabel}</td>
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
  gia_m2 = 0,               // 2026-05-26: for global unit-toggle conversion
  onToggleEnabled,
  onRemove,                 // Brief 94 P3 — remove ref from strategy (library item survives)
  onDragStart,
  onDragEnd,
  onMoveUp,                 // Brief 94 follow-up — deterministic keyboard-accessible reorder
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
  pending = false,          // Brief 94 follow-up — reorder-in-flight spinner on the moved row
  draggingId,
  landed,           // Brief 87 drag UX — brief pink flash after the row settles
}) {
  const { unit } = useUISettings()
  // Brief 47 Part 5c (2026-05-24): collapse/expand state per row.
  // Defaults to COLLAPSED so the stack stays compact for drag-reorder —
  // user can expand individual rows to see the metrics table + patch
  // summary when they want detail. Local state per row (not lifted to
  // StackView) — simpler, no persistence across reloads. If usage shows
  // most rows stay expanded, swap the default to `true`.
  const [expanded, setExpanded] = useState(false)
  const isEnabled = intervention?.enabled !== false
  const isDragging = draggingId === intervention?.id
  // Brief 87 drag UX: animate drag/land state changes (ring, opacity, shadow).
  const wrapperBase = 'rounded-lg border bg-white transition-all duration-200'
  // When collapsed: tighter vertical padding so the row reads as a
  // single line. When expanded: full p-3 padding for breathing room.
  const wrapperPadding = expanded ? 'p-3' : 'px-3 py-2'
  const wrapperState = !isEnabled ? 'opacity-60' : ''
  // Grabbed: dim + lift (shadow) + pink ring so it clearly reads as "moving".
  // Landed: a brief pink ring/tint flash so the new position is unmissable.
  // Otherwise: the usual hover border.
  const wrapperDrag = isDragging
    ? 'opacity-40 ring-2 ring-offset-1 shadow-lg cursor-grabbing'
    : landed
      ? 'ring-2 ring-offset-2'
      : 'hover:border-mid-grey/40'

  const patchCount = Array.isArray(intervention?.patches) ? intervention.patches.length : 0
  const patchSummary = patchCount > 0 ? summarizePatchListShort(intervention.patches, baselineConfig, { maxItems: 3 }) : null
  const isEmpty = patchCount === 0

  const marginalEuiRaw    = marginalDeltaFull?.eui_kwh_per_m2 ?? null
  const marginalCarbonRaw = marginalDeltaFull?.carbon_kgco2_per_m2 ?? null
  const cumEuiRaw         = cumulativeDeltaFull?.eui_kwh_per_m2 ?? null
  const cumCarbonRaw      = cumulativeDeltaFull?.carbon_kgco2_per_m2 ?? null

  // 2026-05-26: convert ΔEUI and ΔCarbon through the global toggle. The
  // deltaRecord shape is { from, to, delta, delta_pct } — we clone with
  // the converted `delta` so DeltaCell's formatting still works unchanged.
  // delta_pct is unit-independent (a ratio); keep as-is.
  const convertDeltaRecord = (rec, kind) => {
    if (!rec) return null
    const conv = toDisplay(rec.delta, kind, unit, gia_m2)
    return { ...rec, delta: conv.value }
  }
  const marginalEui    = convertDeltaRecord(marginalEuiRaw,    KIND.KWH_M2)
  const marginalCarbon = convertDeltaRecord(marginalCarbonRaw, KIND.KG_M2)
  const cumEui         = convertDeltaRecord(cumEuiRaw,         KIND.KWH_M2)
  const cumCarbon      = convertDeltaRecord(cumCarbonRaw,      KIND.KG_M2)
  // Compute the unit labels once. For carbon, use a representative value
  // (typical cumulative delta magnitude) so the auto-promote kg→tCO₂ picks
  // the same label as the actual cell. Falling back to baseline magnitude.
  const euiLabel    = toDisplay(0, KIND.KWH_M2, unit, gia_m2).label || 'kWh/m²·yr'
  const carbonLabel = toDisplay(cumCarbonRaw?.to ?? cumCarbonRaw?.delta ?? 0, KIND.KG_M2, unit, gia_m2).label || 'kgCO₂/m²·yr'

  return (
    <div
      draggable
      data-row-id={intervention?.id}
      onDragStart={(e) => onDragStart?.(e, intervention?.id)}
      onDragEnd={onDragEnd}
      className={`${wrapperBase} ${wrapperPadding} ${wrapperState} ${wrapperDrag} ${isDragging || landed ? '' : 'border-light-grey'}`}
      style={
        isDragging
          ? { borderColor: INTERVENTIONS_ACCENT, '--tw-ring-color': INTERVENTIONS_ACCENT }
          : landed
            ? { borderColor: INTERVENTIONS_ACCENT, '--tw-ring-color': INTERVENTIONS_ACCENT, backgroundColor: `${INTERVENTIONS_ACCENT}0D` }
            : undefined
      }
    >
      {/* Header row: drag handle + up/down + enable dot · label · chevron · actions */}
      <div className="flex items-center gap-2">
        {/* Reorder controls: drag handle (mouse) + up/down arrows (deterministic,
            keyboard-accessible fallback — Brief 94 follow-up). A spinner replaces the
            handle while a reorder is in flight. */}
        <div className="flex-shrink-0 flex items-center gap-0.5">
          {pending ? (
            <Loader2 size={14} className="animate-spin text-mid-grey/70" aria-label="Reordering…" />
          ) : (
            <button
              type="button"
              className="cursor-grab text-mid-grey/60 hover:text-mid-grey active:cursor-grabbing"
              title="Drag to reorder"
              tabIndex={-1}
            >
              <GripVertical size={14} />
            </button>
          )}
          <div className="flex flex-col -my-1">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onMoveUp?.() }}
              disabled={!canMoveUp}
              title="Move up"
              aria-label="Move up"
              className="p-0.5 rounded text-mid-grey/50 hover:text-navy hover:bg-light-grey/50 disabled:opacity-25 disabled:cursor-not-allowed transition-colors leading-none"
            >
              <ChevronUp size={12} />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onMoveDown?.() }}
              disabled={!canMoveDown}
              title="Move down"
              aria-label="Move down"
              className="p-0.5 rounded text-mid-grey/50 hover:text-navy hover:bg-light-grey/50 disabled:opacity-25 disabled:cursor-not-allowed transition-colors leading-none"
            >
              <ChevronDown size={12} />
            </button>
          </div>
        </div>

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
                aria-label="Same-field conflict with another enabled intervention"
                title="One or more fields in this intervention are also edited by another enabled intervention — open the editor to see + drop unintended edits"
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

        {/* Brief 94 P3 — Strategy rows are selection/order/toggle/remove only. No
            edit or duplicate here (editing is the Library's job — Decision 1).
            "Remove" drops the reference from the strategy; the library item survives. */}
        <div className="flex-shrink-0 flex items-center gap-0.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove?.() }}
            className="p-1.5 rounded hover:bg-red-50 text-mid-grey hover:text-red-600 transition-colors"
            title="Remove from strategy (keeps the library item)"
            aria-label="Remove from strategy"
          >
            <X size={13} />
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
              <div className="flex items-start gap-1 mt-1 text-xxs text-amber-700">
                <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                <span>
                  Same-field conflict — another enabled intervention edits one or more of the same field paths.
                  Open the editor (pencil) to see exactly which fields collide and drop any unintended edits.
                </span>
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
            euiUnitLabel={euiLabel}
            carbonUnitLabel={carbonLabel}
          />
        </>
      )}
    </div>
  )
}
