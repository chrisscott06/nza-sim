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

// ── EUI Bar Gauge ─────────────────────────────────────────────────────────────
// Simple horizontal bar gauge — stable rendering, no SVG arc floating-point jitter.

const EUI_MAX = 300  // kWh/m² — top of gauge scale (raised to accommodate high-consumption buildings)
const CRREM_TARGET = 85  // approximate UK hotel CRREM pathway 2026

function EUIGauge({ eui }) {
  // Clamp to valid range — prevents NaN/Infinity and out-of-bounds rendering
  const clamped  = Math.max(0, Math.min(Math.round(eui ?? 0), EUI_MAX))
  const pct      = clamped / EUI_MAX                        // 0–1
  const targetPct = CRREM_TARGET / EUI_MAX

  const color = clamped <= CRREM_TARGET ? '#16A34A'
              : clamped <= CRREM_TARGET * 1.5 ? '#F59E0B'
              : '#DC2626'

  return (
    <div className="flex flex-col items-center">
      <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">EUI (instant estimate)</p>

      {/* Value display */}
      <div className="flex items-baseline gap-1 mb-2">
        <span className="text-2xl font-bold tabular-nums" style={{ color }}>{clamped}</span>
        <span className="text-xxs text-mid-grey">kWh/m²</span>
      </div>

      {/* Gauge bar */}
      <div className="relative w-full h-3 bg-light-grey rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${Math.round(pct * 10000) / 100}%`, background: color }}
        />
        {/* CRREM target marker */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-gold"
          style={{ left: `${Math.round(targetPct * 10000) / 100}%` }}
        />
      </div>

      {/* Labels */}
      <div className="relative w-full mt-0.5">
        <span
          className="absolute text-xxs text-gold"
          style={{ left: `${Math.round(targetPct * 10000) / 100}%`, transform: 'translateX(-50%)' }}
        >
          {CRREM_TARGET}
        </span>
      </div>

      <p className="text-xxs text-mid-grey mt-3">
        CRREM target <span className="text-gold font-medium">{CRREM_TARGET}</span> kWh/m²
        {clamped > CRREM_TARGET && (
          <span className="ml-1" style={{ color }}>
            (+{clamped - CRREM_TARGET})
          </span>
        )}
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

// ── Monthly heating/cooling chart ─────────────────────────────────────────────

const MONTH_ABBR = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

function MonthlyChart({ monthly }) {
  if (!monthly) return null
  const { heating_kWh = [], cooling_kWh = [] } = monthly
  if (!heating_kWh.length) return null

  const maxVal = Math.max(...heating_kWh, ...cooling_kWh, 1)
  const BAR_H = 36   // max bar height in px

  return (
    <div>
      <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5">Monthly profile</p>
      <div className="flex items-end gap-px justify-between" style={{ height: BAR_H * 2 + 10 }}>
        {heating_kWh.map((hKwh, i) => {
          const cKwh   = cooling_kWh[i] ?? 0
          const hH     = Math.round((hKwh / maxVal) * BAR_H)
          const cH     = Math.round((cKwh / maxVal) * BAR_H)
          return (
            <div key={i} className="flex flex-col items-center" style={{ flex: 1 }}>
              {/* Cooling bar (upward) */}
              <div style={{ height: BAR_H, display: 'flex', alignItems: 'flex-end' }}>
                <div
                  style={{ height: cH, background: '#3B82F6', width: '100%', borderRadius: '1px 1px 0 0', minWidth: 4 }}
                  title={`${MONTH_ABBR[i]}: cooling ${Math.round(cKwh)} kWh`}
                />
              </div>
              {/* Centre line */}
              <div style={{ height: 1, background: '#E5E7EB', width: '100%' }} />
              {/* Heating bar (downward) */}
              <div style={{ height: BAR_H, display: 'flex', alignItems: 'flex-start' }}>
                <div
                  style={{ height: hH, background: '#DC2626', width: '100%', borderRadius: '0 0 1px 1px', minWidth: 4 }}
                  title={`${MONTH_ABBR[i]}: heating ${Math.round(hKwh)} kWh`}
                />
              </div>
              {/* Month label */}
              <span className="text-xxs text-mid-grey mt-0.5" style={{ fontSize: 8 }}>{MONTH_ABBR[i]}</span>
            </div>
          )
        })}
      </div>
      <div className="flex gap-3 mt-1">
        <div className="flex items-center gap-1">
          <div className="w-2 h-1.5 rounded-sm bg-blue-500" />
          <span className="text-xxs text-mid-grey">Cooling</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-1.5 rounded-sm bg-red-600" />
          <span className="text-xxs text-mid-grey">Heating</span>
        </div>
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

        {/* Monthly heating/cooling profile (hourly calc only) */}
        {result.monthly && <MonthlyChart monthly={result.monthly} />}

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
