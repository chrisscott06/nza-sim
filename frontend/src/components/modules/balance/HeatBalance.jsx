/**
 * HeatBalance.jsx
 *
 * PHPP-style annual heat balance view: gains-in (left) vs losses-out (right).
 * Mechanical heating sits with gains; mechanical cooling sits with losses.
 * Bars must balance — natural gains/losses + system fill = zero net.
 *
 * Props:
 *   data    — heat_balance object (matches the shape from instantCalc /
 *             /api/projects/{id}/simulations/{run_id}/balance)
 *   source  — 'live' | 'simulation' (cosmetic — affects nothing yet; will
 *             feed into Part 4's engine toggle)
 *   onElementClick — optional, called with elementKey when the user clicks
 *                    a segment (used by Part 5 drill-down)
 *
 * Unit toggle: kWh ↔ kWh/m²·a, internal state, persists to localStorage.
 */

import { useMemo, useState, useEffect } from 'react'
import { ArrowRight } from 'lucide-react'
import {
  SOLAR_COLOURS, INTERNAL_COLOURS, HEATING_COLOUR, COOLING_COLOUR,
  FABRIC_COLOURS, LABELS, LOSS_ORDER, GAIN_ORDER, colourForElement,
} from '../../../data/balanceColours.js'

const UNIT_KEY = 'nza-balance-unit'

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
 */
function flattenLosses(data, unit) {
  const losses = data?.annual?.losses ?? {}
  return LOSS_ORDER
    .filter(k => losses[k] != null)
    .map(k => ({
      key: k,
      label: LABELS[k],
      value: readValue(losses[k], unit),
      raw_kwh: losses[k].kwh ?? 0,
      raw_kwh_per_m2: losses[k].kwh_per_m2 ?? 0,
      colour: colourForElement(k),
      area_m2: losses[k].area_m2,
      meta: losses[k],
    }))
}

function flattenGains(data, unit) {
  const gains = data?.annual?.gains ?? {}
  const out = []
  // Solar — split by face
  const solar = gains.solar ?? {}
  for (const face of ['south', 'east', 'west', 'north']) {
    const node = solar[face]
    if (!node) continue
    out.push({
      key:   `solar_${face}`,
      label: LABELS[`solar_${face}`],
      value: readValue(node, unit),
      raw_kwh: node.kwh ?? 0,
      raw_kwh_per_m2: node.kwh_per_m2 ?? 0,
      colour: SOLAR_COLOURS[face],
      area_m2: node.area_m2,
      meta:    node,
    })
  }
  // Internal — split into people / equipment / lighting
  const internal = gains.internal ?? {}
  for (const k of ['people', 'equipment', 'lighting']) {
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
  // Mechanical heating
  if (gains.heating) {
    out.push({
      key: 'heating',
      label: LABELS.heating,
      value: readValue(gains.heating, unit),
      raw_kwh: gains.heating.kwh ?? 0,
      raw_kwh_per_m2: gains.heating.kwh_per_m2 ?? 0,
      colour: HEATING_COLOUR,
      meta: gains.heating,
    })
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

// ── Main ─────────────────────────────────────────────────────────────────────

export default function HeatBalance({ data, source = 'live', onElementClick }) {
  const [unit, setUnit] = useState(() => {
    try { return localStorage.getItem(UNIT_KEY) || 'kwh_per_m2' }
    catch { return 'kwh_per_m2' }
  })
  useEffect(() => {
    try { localStorage.setItem(UNIT_KEY, unit) } catch {}
  }, [unit])

  const { losses, gains, scale, totalLosses, totalGains, gia } = useMemo(() => {
    const lossItems = flattenLosses(data, unit)
    const gainItems = flattenGains(data, unit)
    const allValues = [...lossItems.map(i => i.value), ...gainItems.map(i => i.value)]
    const scale = Math.max(...allValues, 0.1)
    const totalLosses = data?.annual?.totals?.[unit === 'kwh_per_m2' ? 'losses_kwh_per_m2' : 'losses_kwh'] ?? 0
    const totalGains  = data?.annual?.totals?.[unit === 'kwh_per_m2' ? 'gains_kwh_per_m2'  : 'gains_kwh']  ?? 0
    return {
      losses: lossItems,
      gains:  gainItems,
      scale,
      totalLosses,
      totalGains,
      gia: data?.metadata?.gia_m2 ?? 0,
    }
  }, [data, unit])

  if (!data || !data.annual) {
    return (
      <div className="h-full flex items-center justify-center text-mid-grey text-xxs">
        No heat balance data available — run a simulation or load a project.
      </div>
    )
  }

  const netResidual = totalGains - totalLosses

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">

      {/* Header bar — title + unit toggle */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-light-grey flex items-center justify-between">
        <div>
          <h2 className="text-caption font-semibold text-navy">Heat Balance</h2>
          <p className="text-xxs text-mid-grey mt-0.5">
            Annual gains and losses. Mechanical heating balances natural deficit;
            cooling absorbs excess. Bars should match.
            {gia > 0 && <> · GIA <span className="font-medium text-dark-grey">{gia.toLocaleString()} m²</span></>}
            {' · '}Source: <span className="font-medium text-dark-grey capitalize">{source}</span>
          </p>
        </div>
        <UnitToggle unit={unit} onChange={setUnit} />
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

      {/* Two-column bar stack */}
      <div className="flex-1 overflow-y-auto px-5 pb-5">
        <div className="grid grid-cols-2 gap-8">
          <StackColumn items={gains}  scale={scale} unit={unit} side="gains"  onClick={onElementClick} />
          <StackColumn items={losses} scale={scale} unit={unit} side="losses" onClick={onElementClick} />
        </div>

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
