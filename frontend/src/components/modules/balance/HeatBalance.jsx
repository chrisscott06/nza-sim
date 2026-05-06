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

import { useMemo, useState, useEffect } from 'react'
import { ArrowRight, Zap, Activity, AlertCircle } from 'lucide-react'
import {
  SOLAR_COLOURS, INTERNAL_COLOURS, HEATING_COLOUR, COOLING_COLOUR,
  FABRIC_COLOURS, LABELS, LOSS_ORDER, GAIN_ORDER, colourForElement,
} from '../../../data/balanceColours.js'
import { solarLabel } from '../../../utils/facadeLabel.js'
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

function flattenGains(data, unit, orientationDeg = 0) {
  const gains = data?.annual?.gains ?? {}
  const out = []
  // Solar — split by face. Label uses facade convention F# (compass) so it
  // matches the Glazing input panel and rotates with building orientation.
  const solar = gains.solar ?? {}
  for (const face of ['south', 'east', 'west', 'north']) {
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

// ── Main ─────────────────────────────────────────────────────────────────────

export default function HeatBalance({
  liveData,
  simulationData,
  simulationInfo,
  orientationDeg = 0,
  onElementClick,
}) {
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
    const lossItems = flattenLosses(data, unit)
    const gainItems = flattenGains(data, unit, orientationDeg)
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
  }, [data, unit, orientationDeg])

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
        title="Live estimate — instant feedback as you edit inputs"
      >
        <Zap size={10} />
        Live
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
          : 'No simulation has been run yet'}
      >
        <Activity size={10} />
        Simulation
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
