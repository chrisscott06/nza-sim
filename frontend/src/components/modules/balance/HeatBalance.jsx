/**
 * HeatBalance.jsx
 *
 * PHPP-style annual heat balance view: gains-in (left) vs losses-out (right).
 * Mechanical heating sits with gains; mechanical cooling sits with losses.
 * Bars must balance — natural gains/losses + system fill = zero net.
 *
 * Props:
 *   liveData         — heat_balance from instantCalc (live, sub-second)
 *   simulationData   — heat_balance from EnergyPlus (last run, fetched via API)
 *   simulationInfo   — { runId, ranAt, isStale } — display only
 *   onElementClick   — called with (elementKey, meta) when a segment clicks
 *
 * Internal state:
 *   - unit:       kWh | kwh_per_m2  (persists to localStorage)
 *   - engineMode: 'live' | 'simulation'  (toggle between sources)
 *
 * Bar widths transition via CSS when the data source changes, so flipping
 * between live and simulation animates the divergence.
 */

import { useMemo, useState, useEffect, useContext } from 'react'
import { ArrowRight, Zap, Activity, AlertCircle, Info, ChevronDown } from 'lucide-react'
import {
  SOLAR_COLOURS, INTERNAL_COLOURS, HEATING_COLOUR, COOLING_COLOUR,
  FABRIC_COLOURS, LABELS, colourForElement,
} from '../../../data/balanceColours.js'
import { solarLabel } from '../../../utils/facadeLabel.js'
import { MODES, DEFAULT_MODE, isEnvelopeOnly, modeBadgeText, loadOrderFor, gainOrderFor } from '../../../utils/stateMode.js'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import BalanceSankey from './BalanceSankey.jsx'

const UNIT_KEY   = 'nza-balance-unit'
const LAYOUT_KEY = 'nza-balance-layout'   // 'rows' | 'stacked'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(value, unit) {
  if (value == null || isNaN(value)) return '—'
  if (unit === 'kwh_per_m2') return `${value.toFixed(1)} kWh/m²·a`
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)} MWh`
  return `${Math.round(value).toLocaleString()} kWh`
}

function readValue(node, unit) {
  if (!node) return 0
  return unit === 'kwh_per_m2' ? (node.kwh_per_m2 ?? 0) : (node.kwh ?? 0)
}

/**
 * Flatten the heat_balance into [{key, label, value, colour}] arrays
 * for each side (losses + gains). Elements with zero value are kept so
 * the user can still see them — they'll just render as a 1px sliver.
 *
 * Brief 28a Part 5 walkthrough Finding HB3 (2026-05-14): 'cooling' is
 * synthesised from `data.demand.cooling_demand_mwh` when the mode order
 * includes it (envelope-gains + full). At State 2 this is "what a
 * mechanical system WOULD remove to hold the comfort band"; at State 3
 * it's the actual mechanical service. PHPP convention puts mechanical
 * cooling on the loss side to balance natural surplus. Without this,
 * the gain side at State 2 includes internal gains (people / lighting /
 * equipment) but the loss side has no mechanical sink, so the balance
 * fails to close by exactly the cooling-demand magnitude (the
 * "+214.6 MWh residual; check inputs" warning on Bridgewater).
 */
/**
 * Pull a {kwh, kwh_per_m2} pair from a losses_at_setpoint element node,
 * normalising the Brief 28k+ shape (heating_loss_kwh) to the legacy shape
 * the rest of HeatBalance expects (kwh / kwh_per_m2). Returns null when
 * the node is absent or its heating_loss_kwh is 0/missing — caller filters.
 *
 * Brief 28-TB-Simple TB-V1: the engine's losses_at_setpoint block carries
 * the post-Brief 28k convention numbers (setpoint-anchored, sol-air-driven,
 * thermal bridging via ISO 14683 H_TB, per-system mech vent breakdown,
 * per-opening natvent breakdown). This adapter lets the existing
 * flattenLosses → row-render pipeline consume the new shape without a
 * full row-renderer rewrite.
 */
function _normaliseSetpointNode(node, gia) {
  if (!node) return null
  const kwh = node.heating_loss_kwh ?? 0
  if (!(kwh > 0.01)) return null
  const kwh_per_m2 = gia > 0 ? kwh / gia : 0
  return { kwh, kwh_per_m2, area_m2: node.area_m2 }
}

function flattenLosses(data, unit, mode = DEFAULT_MODE) {
  // Brief 28-TB-Simple TB-V1: prefer losses_at_setpoint when present
  // (carries thermal_bridging via ISO 14683 H_TB, per-system mech vent
  // breakdown, per-opening natural-ventilation breakdown — none of which
  // exist on the legacy annual.losses block).
  const setpoint = data?.losses_at_setpoint
  const legacyLosses = data?.annual?.losses ?? {}
  const gia    = data?.metadata?.gia_m2 ?? 0
  const allowed = new Set(loadOrderFor(mode))

  // Build a working losses map keyed by the same element names the load
  // order uses. Setpoint values win where they exist; legacy values fill
  // gaps so any element the new shape doesn't carry (e.g. 'infiltration'
  // legacy alias) still renders.
  const losses = { ...legacyLosses }
  if (setpoint) {
    for (const elementKey of [
      'external_wall', 'roof', 'ground_floor', 'glazing',
      'fabric_leakage', 'permanent_vents', 'thermal_bridging',
    ]) {
      const sp = _normaliseSetpointNode(setpoint[elementKey], gia)
      if (sp) losses[elementKey] = sp
    }
  }

  // Build the rendering order. Start from the mode's canonical order, then
  // splice in per-system mech vent + per-opening natvent lines AFTER the
  // legacy 'ventilation' key (or at the end if absent) — these are new
  // categories not previously in the load order.
  const baseOrder = loadOrderFor(mode).filter(k => allowed.has(k))
  const orderWithNew = []
  for (const k of baseOrder) {
    orderWithNew.push(k)
    if (k === 'ventilation') {
      // Per-system mech vent expansion — replaces / supplements the legacy
      // single 'ventilation' aggregate line.
      const ventSystems = setpoint?.ventilation ?? []
      for (const v of ventSystems) {
        if ((v.heat_loss_kwh ?? 0) > 0.01) {
          const key = `ventilation_${v.name}`
          const kwh = v.heat_loss_kwh
          const kwh_per_m2 = gia > 0 ? kwh / gia : 0
          losses[key] = { kwh, kwh_per_m2, _label: `Ventilation: ${v.name}` }
          orderWithNew.push(key)
        }
      }
    }
  }
  // Per-opening natural ventilation — always appended at the end (operable
  // doors / windows from Brief 28e). Each opening becomes its own line.
  const natvents = setpoint?.natural_ventilation ?? []
  for (const o of natvents) {
    if ((o.heat_loss_kwh ?? 0) > 0.01) {
      const key = `natvent_${o.id}`
      const kwh = o.heat_loss_kwh
      const kwh_per_m2 = gia > 0 ? kwh / gia : 0
      losses[key] = { kwh, kwh_per_m2, _label: `Operable: ${o.name || o.id}` }
      orderWithNew.push(key)
    }
  }

  return orderWithNew
    .filter(k => {
      // 'cooling' is synthesised from demand — falls through the normal
      // losses[k] lookup. Only present when the mode order includes it
      // (envelope-gains, full).
      if (k === 'cooling') {
        const mwh = data?.demand?.cooling_demand_mwh
        return mwh != null && mwh > 0.01
      }
      // Drop the legacy aggregate 'ventilation' line when we've already
      // expanded it into per-system entries — avoids double-counting.
      if (k === 'ventilation' && orderWithNew.some(x => x.startsWith('ventilation_'))) return false
      return losses[k] != null
    })
    .filter(k => !k.startsWith('openings_') || (losses[k]?.kwh ?? 0) > 0.01)
    .filter(k => !['fabric_leakage', 'permanent_vents', 'thermal_bridging'].includes(k)
                 || (losses[k]?.kwh ?? 0) > 0.01)
    .map(k => {
      if (k === 'cooling') {
        const kwh = (data.demand.cooling_demand_mwh ?? 0) * 1000
        const kwh_per_m2 = gia > 0 ? kwh / gia : 0
        return {
          key:   'cooling',
          label: LABELS.cooling,
          value: unit === 'kwh_per_m2' ? kwh_per_m2 : kwh,
          raw_kwh: kwh,
          raw_kwh_per_m2: kwh_per_m2,
          colour: colourForElement('cooling'),
          meta:  { kwh, kwh_per_m2, synthetic: true, source: 'demand.cooling_demand_mwh' },
        }
      }
      const node = losses[k]
      // Per-system vent + per-opening natvent rows carry a synthetic _label
      // so they render with a descriptive name instead of the synthetic
      // composite key. Everything else uses the canonical LABELS table.
      const label = node?._label ?? LABELS[k] ?? k
      return {
        key: k,
        label,
        value: readValue(node, unit),
        raw_kwh: node?.kwh ?? 0,
        raw_kwh_per_m2: node?.kwh_per_m2 ?? 0,
        colour: colourForElement(k.startsWith('ventilation_') ? 'ventilation' : k.startsWith('natvent_') ? 'openings_window' : k),
        area_m2: node?.area_m2,
        meta: node,
      }
    })
}

function flattenGains(data, unit, orientationDeg = 0, mode = DEFAULT_MODE) {
  const gains = data?.annual?.gains ?? {}
  const allowed = new Set(gainOrderFor(mode))
  const out = []
  // Solar — split by face. Label uses facade convention F# (compass) so it
  // matches the Glazing input panel and rotates with building orientation.
  const solar = gains.solar ?? {}
  for (const face of ['south', 'east', 'west', 'north']) {
    if (!allowed.has(`solar_${face}`)) continue
    const node = solar[face]
    if (!node) continue
    out.push({
      key:   `solar_${face}`,
      label: solarLabel(face, orientationDeg),
      value: readValue(node, unit),
      raw_kwh: node.kwh ?? 0,
      raw_kwh_per_m2: node.kwh_per_m2 ?? 0,
      colour: SOLAR_COLOURS[face],
      area_m2: node.area_m2,
      meta:    node,
    })
  }
  // Internal gains — only at State 2+ (per state contract; State 1 is envelope-only)
  const internal = gains.internal ?? {}
  for (const k of ['people', 'equipment', 'lighting']) {
    if (!allowed.has(k)) continue
    const node = internal[k]
    if (!node) continue
    out.push({
      key:   k,
      label: LABELS[k],
      value: readValue(node, unit),
      raw_kwh: node.kwh ?? 0,
      raw_kwh_per_m2: node.kwh_per_m2 ?? 0,
      colour: INTERNAL_COLOURS[k],
      meta:   node,
    })
  }
  // Mechanical heating — surfaces whenever the gain order includes 'heating'.
  // Brief 28a Part 5 walkthrough Finding HB3 (2026-05-14): at State 2 this
  // is "what a mechanical system WOULD provide to hold the comfort band";
  // at State 3 it's the actual mechanical service. Same source either way:
  // data.demand.heating_demand_mwh. PHPP convention puts mechanical heating
  // on the gain side to balance natural deficit. Falls back to the engine's
  // `gains.heating` block if the engine ever emits one directly (preserves
  // forward compatibility with potential State 3 changes).
  if (allowed.has('heating')) {
    const engineHeating = gains.heating
    if (engineHeating?.kwh != null) {
      out.push({
        key: 'heating',
        label: LABELS.heating,
        value: readValue(engineHeating, unit),
        raw_kwh: engineHeating.kwh ?? 0,
        raw_kwh_per_m2: engineHeating.kwh_per_m2 ?? 0,
        colour: HEATING_COLOUR,
        meta: engineHeating,
      })
    } else {
      const mwh = data?.demand?.heating_demand_mwh
      if (mwh != null && mwh > 0.01) {
        const kwh = mwh * 1000
        const gia = data?.metadata?.gia_m2 ?? 0
        const kwh_per_m2 = gia > 0 ? kwh / gia : 0
        out.push({
          key:   'heating',
          label: LABELS.heating,
          value: unit === 'kwh_per_m2' ? kwh_per_m2 : kwh,
          raw_kwh: kwh,
          raw_kwh_per_m2: kwh_per_m2,
          colour: HEATING_COLOUR,
          meta:  { kwh, kwh_per_m2, synthetic: true, source: 'demand.heating_demand_mwh' },
        })
      }
    }
  }
  return out
}

// ── Stack column ─────────────────────────────────────────────────────────────

function StackColumn({ items, scale, unit, side, onClick }) {
  // scale = max kWh/m² (or kWh) value across both columns; sets bar lengths
  return (
    <div className="flex-1 flex flex-col gap-1.5 min-w-0">
      {items.map(it => {
        const widthPct = scale > 0 ? Math.max(0.4, (it.value / scale) * 100) : 0
        return (
          <button
            key={it.key}
            onClick={() => onClick?.(it.key, it.meta)}
            className="group flex items-center gap-3 text-left hover:bg-off-white/60 px-2 py-1 rounded transition-colors"
          >
            <span className="w-32 flex-shrink-0 text-xxs text-dark-grey truncate">
              {it.label}
            </span>
            <div className="flex-1 relative h-5 bg-off-white rounded overflow-hidden">
              <div
                className="h-full transition-all duration-500 ease-out"
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: it.colour,
                  marginLeft: side === 'losses' ? 0 : 'auto',
                  marginRight: side === 'losses' ? 'auto' : 0,
                }}
              />
            </div>
            <span className="w-24 flex-shrink-0 text-xxs tabular-nums text-navy text-right font-medium">
              {fmt(it.value, unit)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ── Tooltip pill (shared by Stacked + Sankey) ───────────────────────────────

export function TooltipPill({ x, y, label, value }) {
  if (label == null) return null
  return (
    <div
      className="fixed pointer-events-none z-50 bg-white border border-light-grey rounded shadow-md px-2.5 py-1.5 text-xxs whitespace-nowrap"
      style={{ left: x + 12, top: y + 12 }}
    >
      <span className="text-dark-grey font-medium">{label}</span>
      {value != null && (
        <>
          <span className="text-mid-grey mx-1">·</span>
          <span className="text-navy font-semibold tabular-nums">{value}</span>
        </>
      )}
    </div>
  )
}

// ── Stacked vertical (single bar per side) ───────────────────────────────────

function StackedColumns({ gains, losses, unit, onClick }) {
  const [tip, setTip] = useState(null) // {x, y, label, value} | null

  const totalGains  = gains.reduce((s, i) => s + i.value, 0)
  const totalLosses = losses.reduce((s, i) => s + i.value, 0)
  const max = Math.max(totalGains, totalLosses, 0.1)

  // chart height: fixed 360px; segments scale by share of max
  const HEIGHT = 360

  function renderColumn(items, totalKey) {
    const total = totalKey === 'gains' ? totalGains : totalLosses
    return (
      <div className="flex flex-col items-center gap-3">
        {/* Stacked bar */}
        <div
          className="relative w-24 rounded-md overflow-hidden border border-light-grey/60 flex flex-col-reverse"
          style={{ height: HEIGHT }}
        >
          <div
            className="absolute inset-0 flex flex-col-reverse"
            style={{ height: `${(total / max) * 100}%`, top: 'auto', bottom: 0 }}
          >
            {items.filter(i => i.value > 0).map(it => (
              <button
                key={it.key}
                onClick={() => onClick?.(it.key, it.meta)}
                onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, label: it.label, value: fmt(it.value, unit) })}
                onMouseLeave={() => setTip(null)}
                className="w-full transition-all duration-500 ease-out hover:brightness-110 group/seg relative"
                style={{
                  height: `${(it.value / total) * 100}%`,
                  backgroundColor: it.colour,
                  minHeight: 1,
                }}
              >
                {/* In-bar label if segment is tall enough */}
                {(it.value / total) > 0.07 && (
                  <span className="absolute inset-0 flex items-center justify-center text-xxs font-medium text-white/95 px-1 truncate pointer-events-none">
                    {it.label.replace(/^Solar — /, '')}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        {/* Total */}
        <p className="text-caption font-bold text-navy tabular-nums">{fmt(total, unit)}</p>
      </div>
    )
  }

  // Legend: union of items across sides, deduplicated, in the source order
  const legendKeys = []
  const seen = new Set()
  for (const i of [...gains, ...losses]) {
    if (i.value <= 0) continue
    if (seen.has(i.key)) continue
    seen.add(i.key)
    legendKeys.push(i)
  }

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-8 items-start">
      {/* Left: gains column */}
      <div className="flex flex-col items-center">
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-3">Gains</p>
        {renderColumn(gains, 'gains')}
      </div>

      {/* Centre: legend */}
      <div className="flex flex-col gap-1.5 pt-8 max-w-[160px]">
        {legendKeys.map(it => (
          <button
            key={it.key}
            onClick={() => onClick?.(it.key, it.meta)}
            className="flex items-center gap-2 text-xxs text-dark-grey hover:text-navy"
          >
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: it.colour }} />
            <span className="truncate">{it.label}</span>
          </button>
        ))}
      </div>

      {/* Right: losses column */}
      <div className="flex flex-col items-center">
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-3">Losses</p>
        {renderColumn(losses, 'losses')}
      </div>

      {tip && <TooltipPill {...tip} />}
    </div>
  )
}

// ── State 1 envelope-only extras ─────────────────────────────────────────────
// Badge, demand rows, free-running readout, comfort band editor, "what's not
// included" disclosure. All rendered only when `mode === 'envelope-only'`.

function EnvelopeOnlyBadge({ mode, onDisclosureToggle, showDisclosure }) {
  if (!isEnvelopeOnly(mode)) return null
  return (
    <div className="flex-shrink-0 px-5 py-2 bg-navy/5 border-b border-light-grey">
      <button
        onClick={onDisclosureToggle}
        className="w-full flex items-center justify-between gap-2 text-xxs text-navy font-medium hover:text-navy/70 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Info size={11} className="text-navy/60" />
          {modeBadgeText(mode)}
        </span>
        <ChevronDown
          size={11}
          className="text-navy/60 transition-transform"
          style={{ transform: showDisclosure ? 'rotate(180deg)' : 'none' }}
        />
      </button>
      {showDisclosure && (
        <div className="mt-2 pt-2 border-t border-navy/10 text-xxs text-mid-grey leading-relaxed">
          State 1 is the envelope acting alone against the weather. Not yet included:
          <ul className="mt-1 ml-4 list-disc space-y-0.5">
            <li><span className="text-dark-grey">Occupancy</span> — people, equipment, lighting (State 2 in /gains)</li>
            <li><span className="text-dark-grey">Operable windows</span> — user-controlled ventilation (State 2.5 in /operation)</li>
            <li><span className="text-dark-grey">Mechanical systems</span> — heating, cooling, MVHR, DHW (State 3 in /systems)</li>
          </ul>
          Heating and cooling appear below the balance as <em>derived demand</em> —
          the energy a system would need to provide to hold the zone in the comfort band.
          The zone temperature is otherwise <em>free-running</em>.
        </div>
      )}
    </div>
  )
}

function ComfortBandEditor({ comfortBand, onChange }) {
  // Local mirror so typing doesn't fire a PUT on every keystroke;
  // commits on blur or on Enter, validated client-side per contract bounds.
  const [lower, setLower] = useState(comfortBand?.lower_c ?? 20)
  const [upper, setUpper] = useState(comfortBand?.upper_c ?? 26)
  useEffect(() => { setLower(comfortBand?.lower_c ?? 20); setUpper(comfortBand?.upper_c ?? 26) },
    [comfortBand?.lower_c, comfortBand?.upper_c])

  const commit = () => {
    const lo = Number(lower), up = Number(upper)
    if (Number.isFinite(lo) && Number.isFinite(up) && lo < up && lo >= 8 && up <= 32) {
      onChange?.({ lower_c: lo, upper_c: up })
    } else {
      // reset to props if invalid
      setLower(comfortBand?.lower_c ?? 20); setUpper(comfortBand?.upper_c ?? 26)
    }
  }
  const onKeyDown = (e) => { if (e.key === 'Enter') e.currentTarget.blur() }
  const inputCls = 'w-12 px-1 py-0.5 text-xxs text-navy border border-light-grey rounded text-center tabular-nums focus:outline-none focus:border-teal bg-white'
  return (
    <div className="flex items-center gap-2 text-xxs text-mid-grey">
      <span>Comfort band:</span>
      <input type="number" min={8} max={32} step={1}
        value={lower} onChange={e => setLower(e.target.value)}
        onBlur={commit} onKeyDown={onKeyDown}
        className={inputCls} title="Heating threshold — lower comfort bound (°C)" />
      <span>°C</span>
      <span className="text-light-grey">⋯</span>
      <input type="number" min={8} max={32} step={1}
        value={upper} onChange={e => setUpper(e.target.value)}
        onBlur={commit} onKeyDown={onKeyDown}
        className={inputCls} title="Cooling threshold — upper comfort bound (°C)" />
      <span>°C</span>
    </div>
  )
}

function StateOneDemandPanel({ data, comfortBand, onComfortBandChange, unit, engineMode }) {
  // Reads `demand`, `free_running`, `comfort_band_used` injected at the top
  // of the heat_balance object by _calculateEnvelopeOnly (instantCalc.js).
  const demand = data?.demand
  const fr     = data?.free_running
  if (!demand || !fr) return null

  const gia = data?.metadata?.gia_m2 ?? 0
  const heatKWh = demand.heating_demand_mwh * 1000
  const coolKWh = demand.cooling_demand_mwh * 1000
  const heatVal = unit === 'kwh_per_m2'
    ? (gia > 0 ? heatKWh / gia : 0)
    : heatKWh
  const coolVal = unit === 'kwh_per_m2'
    ? (gia > 0 ? coolKWh / gia : 0)
    : coolKWh
  const heatLabel = unit === 'kwh_per_m2'
    ? `${heatVal.toFixed(1)} kWh/m²·a`
    : `${Math.round(demand.heating_demand_mwh)} MWh`
  const coolLabel = unit === 'kwh_per_m2'
    ? `${coolVal.toFixed(1)} kWh/m²·a`
    : `${Math.round(demand.cooling_demand_mwh)} MWh`

  const totalHours = demand.underheating_hours + demand.overheating_hours + demand.comfort_hours
  const pct = (h) => totalHours ? Math.round((h / totalHours) * 100) : 0

  return (
    <div className="flex-shrink-0 px-5 py-4 border-t border-light-grey bg-off-white/60">
      {/* Comfort band editor — inline */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <ComfortBandEditor comfortBand={comfortBand} onChange={onComfortBandChange} />
        <div className="text-xxs text-mid-grey">
          The energy a system would need to provide to hold the zone in this band.
        </div>
      </div>

      {/* Derived demand row — heating + cooling */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-white rounded border border-light-grey px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xxs text-mid-grey">Heating demand</span>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: HEATING_COLOUR }} />
          </div>
          <p className="text-caption font-semibold text-navy mt-0.5 tabular-nums">{heatLabel}</p>
          <p className="text-xxs text-mid-grey mt-0.5">below {comfortBand?.lower_c ?? 20}°C — derived</p>
        </div>
        <div className="bg-white rounded border border-light-grey px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xxs text-mid-grey">Cooling demand</span>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COOLING_COLOUR }} />
          </div>
          <p className="text-caption font-semibold text-navy mt-0.5 tabular-nums">{coolLabel}</p>
          <p className="text-xxs text-mid-grey mt-0.5">above {comfortBand?.upper_c ?? 26}°C — derived</p>
        </div>
      </div>

      {/* Comfort hours strip — under / in / over */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-xxs text-mid-grey mb-1">
          <span>Comfort hours (free-running, no system)</span>
          <span className="tabular-nums">
            {demand.comfort_hours.toLocaleString()} of {totalHours.toLocaleString()} hours in band ({pct(demand.comfort_hours)}%)
          </span>
        </div>
        <div className="flex h-3 rounded overflow-hidden bg-light-grey/30">
          {demand.underheating_hours > 0 && (
            <div title={`Underheating: ${demand.underheating_hours.toLocaleString()} h (${pct(demand.underheating_hours)}%)`}
              style={{ width: `${pct(demand.underheating_hours)}%`, backgroundColor: HEATING_COLOUR, opacity: 0.7 }} />
          )}
          {demand.comfort_hours > 0 && (
            <div title={`Comfort: ${demand.comfort_hours.toLocaleString()} h (${pct(demand.comfort_hours)}%)`}
              style={{ width: `${pct(demand.comfort_hours)}%`, backgroundColor: '#16A34A', opacity: 0.7 }} />
          )}
          {demand.overheating_hours > 0 && (
            <div title={`Overheating: ${demand.overheating_hours.toLocaleString()} h (${pct(demand.overheating_hours)}%)`}
              style={{ width: `${pct(demand.overheating_hours)}%`, backgroundColor: COOLING_COLOUR, opacity: 0.7 }} />
          )}
        </div>
        <div className="grid grid-cols-3 gap-1 text-xxs text-mid-grey mt-1">
          <span className="tabular-nums">Under: {demand.underheating_hours.toLocaleString()} h</span>
          <span className="text-center text-green-700 tabular-nums">In: {demand.comfort_hours.toLocaleString()} h</span>
          <span className="text-right tabular-nums">Over: {demand.overheating_hours.toLocaleString()} h</span>
        </div>
      </div>

      {/* Free-running mini-stats */}
      <div className="grid grid-cols-3 gap-3 text-xxs">
        <div>
          <p className="text-mid-grey">Annual mean</p>
          <p className="text-caption font-medium text-navy tabular-nums">{fr.annual_mean_c?.toFixed(1) ?? '—'}°C</p>
        </div>
        <div>
          <p className="text-mid-grey">Winter min</p>
          <p className="text-caption font-medium text-navy tabular-nums">{fr.winter_min_c?.toFixed(1) ?? '—'}°C</p>
        </div>
        <div>
          <p className="text-mid-grey">Summer max</p>
          <p className="text-caption font-medium text-navy tabular-nums">{fr.summer_max_c?.toFixed(1) ?? '—'}°C</p>
        </div>
      </div>

      {/* Engine-disclosure note. Post Brief 28b Part 3 v3 (2026-05-14):
          summer max + mean T + cooling demand all within ±15% of Dynamic.
          Three smaller limitations remain — documented in
          docs/validation/bridgewater_state1_engine_outputs_2026_05_post_part3_v3.md.
          Brief 28b Part 4 (multi-construction validation) is the queued
          follow-up before declaring State 1 fully validated. */}
      {engineMode === 'live' && (
        <p className="text-xxs text-mid-grey mt-2 italic leading-tight">
          <strong>Static engine — agreement with Dynamic (Brief 28b Part 3 v3, Bridgewater):</strong>
          <br />
          • <strong>Summer max:</strong> within 0.3 K of Dynamic — credible for peak comfort.
          <br />
          • <strong>Mean T trace:</strong> within 0.5 K of Dynamic.
          <br />
          • <strong>Cooling demand:</strong> within 10% of Dynamic.
          <br />
          <strong>Smaller known limitations:</strong> winter min ~2 K cooler than Dynamic; external wall loss reads ~40% low (library-vs-layer U-value discrepancy); F1 / F2 per-facade solar 17–18% off (Brief 28b Part 2 territory — HDKR/Perez sky model upgrade queued).
          {' '}For absolute peak comfort + design-day cooling sizing the Dynamic engine remains canonical, but the Static engine is now a credible first-pass approximation.
        </p>
      )}
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function HeatBalance({
  liveData,
  simulationData,
  simulationInfo,
  orientationDeg = 0,
  onElementClick,
  mode = DEFAULT_MODE,    // 'envelope-only' | 'full' (state contract `mode` field)
}) {
  // State 1 envelope-only mode pulls comfortBand + the updater from project
  // context so the inline editor on the Heat Balance commits straight back
  // to project state (Brief 26 Part 1 wired comfortBand into context).
  const projectCtx = useContext(ProjectContext)
  const comfortBand    = projectCtx?.comfortBand
  const setComfortBand = projectCtx?.setComfortBand

  const [showStateOneDisclosure, setShowStateOneDisclosure] = useState(false)

  const [unit, setUnit] = useState(() => {
    try { return localStorage.getItem(UNIT_KEY) || 'kwh_per_m2' }
    catch { return 'kwh_per_m2' }
  })
  useEffect(() => {
    try { localStorage.setItem(UNIT_KEY, unit) } catch {}
  }, [unit])

  const [layout, setLayout] = useState(() => {
    try { return localStorage.getItem(LAYOUT_KEY) || 'rows' }
    catch { return 'rows' }
  })
  useEffect(() => {
    try { localStorage.setItem(LAYOUT_KEY, layout) } catch {}
  }, [layout])

  // Engine: prefer live by default. If only simulation is available, switch to it.
  const [engineMode, setEngineMode] = useState('live')
  useEffect(() => {
    if (!liveData && simulationData) setEngineMode('simulation')
    if (!simulationData && !liveData) setEngineMode('live')
  }, [liveData, simulationData])

  const data = engineMode === 'live' ? liveData : simulationData

  const { losses, gains, scale, totalLosses, totalGains, gia } = useMemo(() => {
    const lossItems = flattenLosses(data, unit, mode)
    const gainItems = flattenGains(data, unit, orientationDeg, mode)
    const allValues = [...lossItems.map(i => i.value), ...gainItems.map(i => i.value)]
    const scale = Math.max(...allValues, 0.1)
    // Engine-emitted totals (fabric + solar only at State 2; engine omits
    // mechanical demand from totals).
    let totalLosses = data?.annual?.totals?.[unit === 'kwh_per_m2' ? 'losses_kwh_per_m2' : 'losses_kwh'] ?? 0
    let totalGains  = data?.annual?.totals?.[unit === 'kwh_per_m2' ? 'gains_kwh_per_m2'  : 'gains_kwh']  ?? 0
    // Brief 28a Part 5 walkthrough Finding HB3 (2026-05-14): the
    // flattened breakdown surfaces mechanical heating + cooling demand
    // as synthetic items at State 2+; the totals must include them too
    // or the "Net (gains - losses)" residual won't close. Add the
    // synthetic items (identified by `meta.synthetic === true`).
    for (const item of lossItems) {
      if (item.meta?.synthetic) totalLosses += item.value
    }
    for (const item of gainItems) {
      if (item.meta?.synthetic) totalGains += item.value
    }
    return {
      losses: lossItems,
      gains:  gainItems,
      scale,
      totalLosses,
      totalGains,
      gia: data?.metadata?.gia_m2 ?? 0,
    }
  }, [data, unit, orientationDeg, mode])

  if (!data || !data.annual) {
    return (
      <div className="h-full flex items-center justify-center text-mid-grey text-xxs">
        {engineMode === 'simulation'
          ? 'No simulation results yet — click Run Simulation in the top bar.'
          : 'No heat balance data available — load a project.'}
      </div>
    )
  }

  const netResidual = totalGains - totalLosses

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">

      {/* Envelope-only badge (State 1) — sits above the header */}
      <EnvelopeOnlyBadge
        mode={mode}
        showDisclosure={showStateOneDisclosure}
        onDisclosureToggle={() => setShowStateOneDisclosure(v => !v)}
      />

      {/* Header bar — title + engine + unit toggle */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-light-grey flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-caption font-semibold text-navy">Heat Balance</h2>
          <p className="text-xxs text-mid-grey mt-0.5 truncate">
            Annual gains and losses. Mechanical heating balances natural deficit;
            cooling absorbs excess. Bars should match.
            {gia > 0 && <> · GIA <span className="font-medium text-dark-grey">{gia.toLocaleString()} m²</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <EngineToggle
            engineMode={engineMode}
            onChange={setEngineMode}
            hasLive={!!liveData}
            hasSimulation={!!simulationData}
            simulationInfo={simulationInfo}
          />
          <LayoutToggle layout={layout} onChange={setLayout} />
          <UnitToggle unit={unit} onChange={setUnit} />
        </div>
      </div>

      {/* IN / OUT side labels */}
      <div className="flex-shrink-0 px-5 pt-4 pb-2 grid grid-cols-2 gap-8">
        <div className="flex items-center gap-2 text-caption font-semibold text-navy">
          <ArrowRight size={14} className="text-mid-grey" />
          <span>IN — Gains</span>
        </div>
        <div className="flex items-center gap-2 text-caption font-semibold text-navy justify-end">
          <span>OUT — Losses</span>
          <ArrowRight size={14} className="text-mid-grey" />
        </div>
      </div>

      {/* Bars: rows / stacked / sankey */}
      <div className="flex-1 overflow-hidden px-5 pb-5">
        {layout === 'rows' && (
          <div className="grid grid-cols-2 gap-8 h-full overflow-y-auto">
            <StackColumn items={gains}  scale={scale} unit={unit} side="gains"  onClick={onElementClick} />
            <StackColumn items={losses} scale={scale} unit={unit} side="losses" onClick={onElementClick} />
          </div>
        )}
        {layout === 'stacked' && (
          <div className="h-full overflow-y-auto">
            <StackedColumns gains={gains} losses={losses} unit={unit} onClick={onElementClick} />
          </div>
        )}
        {layout === 'sankey' && (
          <BalanceSankey
            data={data}
            unit={unit}
            orientationDeg={orientationDeg}
            onElementClick={onElementClick}
            mode={mode}
          />
        )}

        {/* Totals row */}
        <div className="grid grid-cols-2 gap-8 mt-4 pt-3 border-t border-light-grey">
          <div className="text-right">
            <p className="text-xxs text-mid-grey">Total gains</p>
            <p className="text-caption font-bold text-navy tabular-nums">{fmt(totalGains, unit)}</p>
          </div>
          <div className="text-right">
            <p className="text-xxs text-mid-grey">Total losses</p>
            <p className="text-caption font-bold text-navy tabular-nums">{fmt(totalLosses, unit)}</p>
          </div>
        </div>

        {/* Net balance check */}
        <div className="mt-3 px-3 py-2 rounded-lg text-xxs flex items-center justify-between"
          style={{
            backgroundColor: Math.abs(netResidual) < (unit === 'kwh_per_m2' ? 5 : totalLosses * 0.05)
              ? '#F0FDF4' : '#FFFBEB',
          }}
        >
          <span className="text-mid-grey">
            Net (gains − losses):
          </span>
          <span className="font-medium tabular-nums text-dark-grey">
            {netResidual > 0 ? '+' : ''}{fmt(netResidual, unit)}
            {Math.abs(netResidual) > (unit === 'kwh_per_m2' ? 5 : totalLosses * 0.1)
              ? ' — large residual; check inputs'
              : ' ✓ balanced'
            }
          </span>
        </div>
      </div>

      {/* State 1 derived-demand panel — heating/cooling MWh, comfort hours,
          free-running temperature stats. Per state contract: heating and
          cooling appear here, NOT as flows on the gains side above. */}
      {isEnvelopeOnly(mode) && (
        <StateOneDemandPanel
          data={data}
          comfortBand={comfortBand}
          onComfortBandChange={setComfortBand}
          unit={unit}
          engineMode={engineMode}
        />
      )}
    </div>
  )
}

// ── Unit toggle ──────────────────────────────────────────────────────────────

function UnitToggle({ unit, onChange }) {
  return (
    <div className="flex items-center bg-off-white rounded-lg p-0.5 text-xxs">
      <button
        onClick={() => onChange('kwh_per_m2')}
        className={`px-2.5 py-1 rounded transition-colors ${
          unit === 'kwh_per_m2'
            ? 'bg-white text-navy font-medium shadow-sm'
            : 'text-mid-grey hover:text-navy'
        }`}
      >
        kWh/m²·a
      </button>
      <button
        onClick={() => onChange('kwh')}
        className={`px-2.5 py-1 rounded transition-colors ${
          unit === 'kwh'
            ? 'bg-white text-navy font-medium shadow-sm'
            : 'text-mid-grey hover:text-navy'
        }`}
      >
        kWh
      </button>
    </div>
  )
}

// ── Layout toggle ────────────────────────────────────────────────────────────

function LayoutToggle({ layout, onChange }) {
  const opts = [
    { id: 'rows',    label: 'Rows',    title: 'Horizontal rows' },
    { id: 'stacked', label: 'Stacked', title: 'Stacked vertical bars' },
    { id: 'sankey',  label: 'Sankey',  title: 'Sankey diagram' },
  ]
  return (
    <div className="flex items-center bg-off-white rounded-lg p-0.5 text-xxs">
      {opts.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-2.5 py-1 rounded transition-colors ${
            layout === o.id
              ? 'bg-white text-navy font-medium shadow-sm'
              : 'text-mid-grey hover:text-navy'
          }`}
          title={o.title}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── Engine toggle ────────────────────────────────────────────────────────────

function relativeTime(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (isNaN(t)) return ''
  const ms = Date.now() - t
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const d = Math.floor(hr / 24)
  return `${d} day${d > 1 ? 's' : ''} ago`
}

function EngineToggle({ engineMode, onChange, hasLive, hasSimulation, simulationInfo }) {
  const isStale = !!simulationInfo?.isStale
  return (
    <div className="flex items-center bg-off-white rounded-lg p-0.5 text-xxs">
      <button
        onClick={() => onChange('live')}
        disabled={!hasLive}
        className={`flex items-center gap-1 px-2.5 py-1 rounded transition-colors ${
          engineMode === 'live'
            ? 'bg-white text-navy font-medium shadow-sm'
            : 'text-mid-grey hover:text-navy disabled:opacity-40'
        }`}
        title="Static engine — instant calculation, updates as you edit inputs"
      >
        <Zap size={10} />
        Static
      </button>
      <button
        onClick={() => onChange('simulation')}
        disabled={!hasSimulation}
        className={`flex items-center gap-1 px-2.5 py-1 rounded transition-colors ${
          engineMode === 'simulation'
            ? 'bg-white text-navy font-medium shadow-sm'
            : 'text-mid-grey hover:text-navy disabled:opacity-40'
        }`}
        title={hasSimulation
          ? `Last EnergyPlus run${simulationInfo?.ranAt ? ` ${relativeTime(simulationInfo.ranAt)}` : ''}`
          : 'No Dynamic run yet'}
      >
        <Activity size={10} />
        Dynamic
        {simulationInfo?.ranAt && (
          <span className="text-mid-grey font-normal ml-0.5">
            · {relativeTime(simulationInfo.ranAt)}
          </span>
        )}
        {isStale && (
          <AlertCircle size={10} className="text-amber-500 ml-0.5" />
        )}
      </button>
    </div>
  )
}
