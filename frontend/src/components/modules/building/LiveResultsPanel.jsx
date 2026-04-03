/**
 * LiveResultsPanel.jsx
 *
 * Right column of the Building module three-column layout.
 * Shows instant-calc results that update live as the user edits inputs.
 * Will be enhanced in Part 8 with EUI gauge and fabric Sankey.
 */

import { useContext, useMemo } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { useWeather } from '../../../context/WeatherContext.jsx'
import { useHourlySolar } from '../../../hooks/useHourlySolar.js'
import { calculateInstant } from '../../../utils/instantCalc.js'
import { FABRIC_COLORS } from '../../../data/chartTokens.js'
import GainsLossesChart from './GainsLossesChart.jsx'

// ── EUI Arc Gauge (SVG, 180° sweep) ──────────────────────────────────────────

const EUI_MAX = 200  // kWh/m² — top of gauge scale
const CRREM_TARGET = 85  // approximate UK hotel CRREM pathway 2026

function EUIGauge({ eui }) {
  const pct = Math.min(eui / EUI_MAX, 1)
  const targetPct = CRREM_TARGET / EUI_MAX

  // Arc params — 180° from left to right along the top of a circle
  const cx = 60, cy = 60, r = 46
  const startAngle = Math.PI   // left (180°)
  const endAngle   = 0         // right (0°)

  function polarToXY(angle, radius) {
    return {
      x: cx + radius * Math.cos(angle),
      y: cy - radius * Math.sin(angle),
    }
  }

  // Full background arc (grey)
  const bgStart  = polarToXY(startAngle, r)
  const bgEnd    = polarToXY(endAngle,   r)
  const bgPath   = `M ${bgStart.x} ${bgStart.y} A ${r} ${r} 0 0 1 ${bgEnd.x} ${bgEnd.y}`

  // Value arc
  const valAngle = startAngle + (endAngle - startAngle) * pct  // goes from left to right
  // Actually: left = π, right = 0. As pct increases, angle decreases from π to 0.
  const valEndAngle = Math.PI * (1 - pct)
  const valEnd = polarToXY(valEndAngle, r)
  const largeArc = pct > 0.5 ? 1 : 0
  const valPath = pct > 0
    ? `M ${bgStart.x} ${bgStart.y} A ${r} ${r} 0 ${largeArc} 1 ${valEnd.x} ${valEnd.y}`
    : null

  // Target marker
  const targetAngle = Math.PI * (1 - targetPct)
  const targetOuter = polarToXY(targetAngle, r + 4)
  const targetInner = polarToXY(targetAngle, r - 4)

  const arcColor = eui <= CRREM_TARGET ? '#16A34A' : eui <= CRREM_TARGET * 1.3 ? '#F59E0B' : '#DC2626'

  return (
    <div className="flex flex-col items-center">
      <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">EUI (instant estimate)</p>
      <div className="relative">
        <svg width="120" height="72" viewBox="0 0 120 72">
          {/* Background arc */}
          <path d={bgPath} fill="none" stroke="#E6E6E6" strokeWidth="8" strokeLinecap="round" />
          {/* Value arc */}
          {valPath && (
            <path d={valPath} fill="none" stroke={arcColor} strokeWidth="8" strokeLinecap="round" />
          )}
          {/* CRREM target marker */}
          <line
            x1={targetInner.x} y1={targetInner.y}
            x2={targetOuter.x} y2={targetOuter.y}
            stroke="#ECB01F" strokeWidth="2" strokeLinecap="round"
          />
          {/* Centre value */}
          <text x="60" y="55" textAnchor="middle" fontSize="18" fontWeight="600" fill={arcColor}>
            {Math.round(eui)}
          </text>
          <text x="60" y="65" textAnchor="middle" fontSize="7" fill="#95A5A6">
            kWh/m²
          </text>
        </svg>
      </div>
      <p className="text-xxs text-mid-grey -mt-1">
        CRREM target <span className="text-gold font-medium">{CRREM_TARGET}</span> kWh/m²
      </p>
    </div>
  )
}

// ── Fabric heat loss proportional bar ────────────────────────────────────────

function FabricBar({ fabric }) {
  const segments = [
    { key: 'walls_kWh',        label: 'Walls',       color: FABRIC_COLORS.wall },
    { key: 'glazing_kWh',      label: 'Glazing',     color: FABRIC_COLORS.glazing },
    { key: 'roof_kWh',         label: 'Roof',        color: FABRIC_COLORS.roof },
    { key: 'floor_kWh',        label: 'Floor',       color: FABRIC_COLORS.floor },
    { key: 'infiltration_kWh', label: 'Infiltration',color: FABRIC_COLORS.infiltration },
    { key: 'ventilation_kWh',  label: 'Ventilation', color: FABRIC_COLORS.ventilation },
  ]

  const total = segments.reduce((s, seg) => s + (fabric[seg.key] ?? 0), 0)
  if (total === 0) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xxs uppercase tracking-wider text-mid-grey">Fabric heat loss</p>
        <span className="text-xxs text-navy font-medium">{Math.round(total / 1000)} MWh/yr</span>
      </div>
      {/* Stacked bar */}
      <div className="flex h-4 rounded overflow-hidden gap-px">
        {segments.map(seg => {
          const val = fabric[seg.key] ?? 0
          if (val === 0) return null
          const pct = (val / total) * 100
          return (
            <div
              key={seg.key}
              style={{ width: `${pct}%`, backgroundColor: seg.color }}
              title={`${seg.label}: ${Math.round(val / 1000)} MWh (${Math.round(pct)}%)`}
            />
          )
        })}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5">
        {segments.map(seg => {
          const val = fabric[seg.key] ?? 0
          if (val === 0) return null
          return (
            <div key={seg.key} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: seg.color }} />
              <span className="text-xxs text-dark-grey">{seg.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Solar gains by facade ─────────────────────────────────────────────────────

function SolarBars({ solar }) {
  const dirs = [
    { key: 'south_kWh', label: 'S', color: '#F59E0B' },
    { key: 'east_kWh',  label: 'E', color: '#FCD34D' },
    { key: 'west_kWh',  label: 'W', color: '#FCD34D' },
    { key: 'north_kWh', label: 'N', color: '#FEF3C7' },
  ]
  const max = Math.max(...dirs.map(d => solar[d.key] ?? 0), 1)
  const total = Object.values(solar).reduce((s, v) => typeof v === 'number' ? s + v : s, 0) - (solar.total_kWh ?? 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xxs uppercase tracking-wider text-mid-grey">Solar gains by facade</p>
        <span className="text-xxs text-navy font-medium">{Math.round(solar.total_kWh)} MWh/yr</span>
      </div>
      <div className="space-y-1">
        {dirs.map(d => {
          const val = solar[d.key] ?? 0
          const pct = (val / max) * 100
          return (
            <div key={d.key} className="flex items-center gap-1.5">
              <span className="text-xxs text-mid-grey w-3 text-right">{d.label}</span>
              <div className="flex-1 bg-off-white rounded h-3 overflow-hidden">
                <div
                  className="h-full rounded transition-all duration-200"
                  style={{ width: `${pct}%`, backgroundColor: d.color }}
                />
              </div>
              <span className="text-xxs text-dark-grey w-10 text-right">{Math.round(val)} MWh</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Key metric row ────────────────────────────────────────────────────────────

/** Format kWh as MWh, showing "< 1" instead of "0" for very small non-zero values */
function fmtMWh(kWh) {
  const mwh = Math.round(kWh / 1000)
  if (mwh === 0 && kWh > 0) return '< 1'
  return mwh
}

function Metric({ label, value, unit, color }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-light-grey last:border-0">
      <span className="text-xxs text-dark-grey">{label}</span>
      <span className="text-xxs font-semibold" style={{ color: color ?? '#2B2A4C' }}>
        {value} <span className="font-normal text-mid-grey">{unit}</span>
      </span>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function LiveResultsPanel({ libraryData = {}, onSankeyExpand }) {
  const { params, constructions, systems } = useContext(ProjectContext)
  const { weatherData } = useWeather()
  const orientationDeg = Number(params?.orientation ?? 0)
  const hourlySolar = useHourlySolar(weatherData, orientationDeg)

  const result = useMemo(
    () => calculateInstant(params, constructions, systems, libraryData, weatherData, hourlySolar),
    [params, constructions, systems, libraryData, weatherData, hourlySolar]
  )

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-white border-l border-light-grey">
      <div className="p-3 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-xxs uppercase tracking-wider text-mid-grey">Live Results</p>
          <span className="text-xxs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
            ⚡ Instant estimate
          </span>
        </div>

        {/* EUI gauge */}
        <EUIGauge eui={result.eui_kWh_m2} />

        {/* Gains & Losses butterfly chart */}
        <GainsLossesChart
          result={result}
          orientation={params.orientation ?? 0}
          onExpand={onSankeyExpand ? () => onSankeyExpand(result) : undefined}
        />

        {/* Key metrics */}
        <div>
          <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5">Key metrics</p>
          <div>
            <Metric
              label="Annual heating"
              value={fmtMWh(result.annual_heating_kWh)}
              unit="MWh"
              color="#DC2626"
            />
            <Metric
              label="Annual cooling"
              value={fmtMWh(result.annual_cooling_kWh)}
              unit="MWh"
              color="#3B82F6"
            />
            <Metric
              label="Annual DHW"
              value={fmtMWh(result.annual_dhw_kWh)}
              unit="MWh"
              color="#F97316"
            />
            <Metric
              label="Carbon intensity"
              value={result.carbon_kgCO2_m2}
              unit="kgCO₂/m²"
              color="#58595B"
            />
            <Metric
              label="GIA"
              value={result.gia_m2.toLocaleString()}
              unit="m²"
            />
          </div>
        </div>

        {/* Fuel split */}
        {result.fuel_split.total_kWh > 0 && (
          <div>
            <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5">Fuel split</p>
            <div className="flex h-3 rounded overflow-hidden">
              <div
                className="bg-gold transition-all duration-200"
                style={{ width: `${result.fuel_split.electricity_pct}%` }}
                title={`Electricity: ${result.fuel_split.electricity_pct}%`}
              />
              <div
                className="bg-heating-red transition-all duration-200"
                style={{ width: `${result.fuel_split.gas_pct}%` }}
                title={`Gas: ${result.fuel_split.gas_pct}%`}
              />
            </div>
            <div className="flex gap-3 mt-1">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-gold" />
                <span className="text-xxs text-dark-grey">Elec {result.fuel_split.electricity_pct}%</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-heating-red" />
                <span className="text-xxs text-dark-grey">Gas {result.fuel_split.gas_pct}%</span>
              </div>
            </div>
          </div>
        )}

        {/* Run full simulation link */}
        <div className="pt-1 border-t border-light-grey">
          <p className="text-xxs text-mid-grey">
            These are simplified estimates.{' '}
            <button
              className="text-teal hover:underline"
              onClick={() => window.dispatchEvent(new CustomEvent('nza:run-simulation'))}
            >
              Run full EnergyPlus simulation →
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
