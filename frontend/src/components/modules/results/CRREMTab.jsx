/**
 * CRREMTab.jsx
 *
 * CRREM & Carbon trajectory tab for the Results Dashboard.
 *
 * Shows:
 * 1. EUI trajectory — building EUI vs CRREM 1.5°C pathway, with stranding year
 * 2. DataCards — current EUI, CRREM target, gap, stranding year
 * 3. Carbon trajectory — building carbon intensity (declining with grid
 *    decarbonisation) vs CRREM carbon pathway
 *
 * The building is assumed to be all-electric (VRF + ASHP DHW). This gives
 * the most responsive carbon decline as grid decarbonises to 2050.
 */

import { useContext, useEffect, useState, useMemo } from 'react'
import {
  ComposedChart, Line, Area, XAxis, YAxis,
  Tooltip, Legend, ReferenceLine, ReferenceDot,
  CartesianGrid, ResponsiveContainer,
} from 'recharts'
import { TrendingDown, CheckCircle2, AlertTriangle } from 'lucide-react'
import ChartContainer from '../../ui/ChartContainer.jsx'
import DataCard from '../../ui/DataCard.jsx'
import ModuleEmptyState from '../../ui/ModuleEmptyState.jsx'
import { SimulationContext } from '../../../context/SimulationContext.jsx'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import {
  TOOLTIP_STYLE,
  TOOLTIP_WRAPPER_STYLE,
  AXIS_PROPS,
  GRID_STYLE,
  LEGEND_STYLE,
} from '../../../data/chartTokens.js'

// ── Constants ──────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear()
const CHART_YEARS = Array.from({ length: 41 }, (_, i) => 2020 + i) // 2020–2060

// Grid carbon intensity (kgCO₂/kWh) — FES Leading the Way 2023
const GRID_INTENSITY = {
  2020: 0.233, 2021: 0.215, 2022: 0.200, 2023: 0.185, 2024: 0.172,
  2025: 0.160, 2026: 0.145, 2027: 0.130, 2028: 0.116, 2029: 0.108,
  2030: 0.100, 2031: 0.088, 2032: 0.077, 2033: 0.068, 2034: 0.060,
  2035: 0.053, 2036: 0.047, 2037: 0.041, 2038: 0.036, 2039: 0.032,
  2040: 0.028, 2041: 0.025, 2042: 0.022, 2043: 0.019, 2044: 0.017,
  2045: 0.015, 2046: 0.013, 2047: 0.011, 2048: 0.009, 2049: 0.008,
  2050: 0.007, 2051: 0.006, 2052: 0.005, 2053: 0.004, 2054: 0.004,
  2055: 0.003, 2056: 0.003, 2057: 0.002, 2058: 0.002, 2059: 0.002,
  2060: 0.002,
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function interpolate(data, year) {
  const years = Object.keys(data).map(Number).sort((a, b) => a - b)
  if (year in data) return data[year]
  const lo = Math.max(...years.filter(y => y <= year))
  const hi = Math.min(...years.filter(y => y >= year))
  if (lo === hi) return data[lo]
  const t = (year - lo) / (hi - lo)
  return data[lo] + t * (data[hi] - data[lo])
}

function findStrandingYear(buildingEui, euiTargets) {
  // Returns the first year where CRREM target drops below building EUI
  for (const year of CHART_YEARS) {
    const target = interpolate(euiTargets, year)
    if (target < buildingEui) return year
  }
  return null // never stranded in the period
}

function findCarbonStrandingYear(buildingTotalKwh, gia, carbonTargets) {
  // Building carbon decreases over time due to grid decarbonisation.
  // Returns first year where CRREM carbon target drops below building carbon.
  for (const year of CHART_YEARS) {
    const gridIntensity = interpolate(GRID_INTENSITY, year)
    const buildingCarbon = (buildingTotalKwh * gridIntensity) / gia
    const target = interpolate(carbonTargets, year)
    if (target < buildingCarbon) return year
  }
  return null
}

// ── Custom tooltip ─────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null
  return (
    <div style={TOOLTIP_STYLE}>
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : '—'} {unit}
        </p>
      ))}
    </div>
  )
}

// ── EUI Trajectory Chart ───────────────────────────────────────────────────────

function EuiTrajectoryChart({ buildingEui, euiTargets, strandingYear }) {
  const data = CHART_YEARS.map(year => {
    const crrem = interpolate(euiTargets, year)
    return {
      year,
      'CRREM 1.5°C': Number(crrem.toFixed(1)),
      'Building EUI': year >= CURRENT_YEAR - 1 ? Number(buildingEui.toFixed(1)) : null,
      safeZone: Number(crrem.toFixed(1)), // used for the area fill
    }
  })

  return (
    <ChartContainer title="EUI trajectory vs CRREM 1.5°C pathway" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 4 }}>
        <CartesianGrid {...GRID_STYLE} />
        <XAxis dataKey="year" {...AXIS_PROPS} tickCount={9} />
        <YAxis
          {...AXIS_PROPS}
          tickFormatter={v => `${v}`}
          label={{ value: 'kWh/m²', angle: -90, position: 'insideLeft', fontSize: 9, fill: '#95A5A6', dx: 12 }}
        />
        <Tooltip
          content={<ChartTooltip unit="kWh/m²" />}
          wrapperStyle={TOOLTIP_WRAPPER_STYLE}
        />
        <Legend wrapperStyle={LEGEND_STYLE} />

        {/* Safe zone — green area below CRREM pathway */}
        <Area
          type="monotone"
          dataKey="safeZone"
          fill="#16A34A"
          fillOpacity={0.06}
          stroke="none"
          legendType="none"
          name="Safe zone"
        />

        {/* CRREM pathway */}
        <Line
          type="monotone"
          dataKey="CRREM 1.5°C"
          stroke="#95A5A6"
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={false}
          activeDot={{ r: 4 }}
        />

        {/* Building EUI — flat line from current year onward */}
        <Line
          type="monotone"
          dataKey="Building EUI"
          stroke="#2B2A4C"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />

        {/* Current year reference */}
        <ReferenceLine
          x={CURRENT_YEAR}
          stroke="#95A5A6"
          strokeDasharray="3 3"
          label={{ value: 'Today', fontSize: 9, fill: '#95A5A6', position: 'insideTopRight' }}
        />

        {/* Stranding year marker */}
        {strandingYear && (
          <>
            <ReferenceLine
              x={strandingYear}
              stroke="#DC2626"
              strokeDasharray="4 2"
              strokeWidth={1.5}
            />
            <ReferenceDot
              x={strandingYear}
              y={Number(buildingEui.toFixed(1))}
              r={6}
              fill="#DC2626"
              stroke="#fff"
              strokeWidth={2}
              label={{
                value: `⚡ ${strandingYear}`,
                fontSize: 9,
                fill: '#DC2626',
                position: 'top',
              }}
            />
          </>
        )}
      </ComposedChart>
    </ChartContainer>
  )
}

// ── Carbon Trajectory Chart ────────────────────────────────────────────────────

function CarbonTrajectoryChart({ buildingTotalKwh, gia, carbonTargets, strandingYear }) {
  const data = CHART_YEARS.map(year => {
    const crrem = interpolate(carbonTargets, year)
    // Building carbon decreases over time as grid decarbonises
    const gridIntensity = interpolate(GRID_INTENSITY, year)
    const buildingCarbon = (buildingTotalKwh * gridIntensity) / gia
    return {
      year,
      'CRREM 1.5°C Carbon': Number(crrem.toFixed(1)),
      'Building Carbon': year >= CURRENT_YEAR - 1 ? Number(buildingCarbon.toFixed(1)) : null,
      safeZone: Number(crrem.toFixed(1)),
    }
  })

  return (
    <ChartContainer title="Carbon intensity trajectory vs CRREM 1.5°C pathway" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 4 }}>
        <CartesianGrid {...GRID_STYLE} />
        <XAxis dataKey="year" {...AXIS_PROPS} tickCount={9} />
        <YAxis
          {...AXIS_PROPS}
          tickFormatter={v => `${v}`}
          label={{ value: 'kgCO₂/m²', angle: -90, position: 'insideLeft', fontSize: 9, fill: '#95A5A6', dx: 16 }}
        />
        <Tooltip
          content={<ChartTooltip unit="kgCO₂/m²" />}
          wrapperStyle={TOOLTIP_WRAPPER_STYLE}
        />
        <Legend wrapperStyle={LEGEND_STYLE} />

        {/* Safe zone */}
        <Area
          type="monotone"
          dataKey="safeZone"
          fill="#16A34A"
          fillOpacity={0.06}
          stroke="none"
          legendType="none"
          name="Safe zone"
        />

        {/* CRREM carbon pathway */}
        <Line
          type="monotone"
          dataKey="CRREM 1.5°C Carbon"
          stroke="#95A5A6"
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={false}
          activeDot={{ r: 4 }}
        />

        {/* Building carbon — declining due to grid decarbonisation */}
        <Line
          type="monotone"
          dataKey="Building Carbon"
          stroke="#E84393"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />

        {/* Current year reference */}
        <ReferenceLine
          x={CURRENT_YEAR}
          stroke="#95A5A6"
          strokeDasharray="3 3"
          label={{ value: 'Today', fontSize: 9, fill: '#95A5A6', position: 'insideTopRight' }}
        />

        {/* Carbon stranding year */}
        {strandingYear && (
          <ReferenceLine
            x={strandingYear}
            stroke="#DC2626"
            strokeDasharray="4 2"
            strokeWidth={1.5}
            label={{
              value: `⚡ ${strandingYear}`,
              fontSize: 9,
              fill: '#DC2626',
              position: 'insideTopLeft',
            }}
          />
        )}
      </ComposedChart>
    </ChartContainer>
  )
}

// ── CRREMTab ───────────────────────────────────────────────────────────────────

export default function CRREMTab() {
  const { status, results } = useContext(SimulationContext)
  const { params }          = useContext(ProjectContext)

  const [crremData, setCrremData] = useState(null)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    fetch('/api/library/benchmarks?building_type=hotel')
      .then(r => r.ok ? r.json() : { benchmarks: [] })
      .then(data => {
        const pathway = data.benchmarks?.find(b => b.name === 'crrem_hotel_uk_15')
        setCrremData(pathway?.config_json ?? null)
      })
      .catch(() => setCrremData(null))
      .finally(() => setLoading(false))
  }, [])

  if (status !== 'complete' || !results) {
    return (
      <ModuleEmptyState
        icon={TrendingDown}
        title="No simulation results"
        message="Run a simulation first to see CRREM trajectory analysis."
      />
    )
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        {[1, 2, 3].map(i => <div key={i} className="h-40 bg-light-grey rounded-xl" />)}
      </div>
    )
  }

  if (!crremData) {
    return (
      <div className="p-6">
        <div className="bg-white border border-light-grey rounded-xl p-6 text-center">
          <p className="text-caption font-medium text-dark-grey">CRREM data not available</p>
          <p className="text-xxs text-mid-grey mt-1">Restart the backend to seed benchmark data.</p>
        </div>
      </div>
    )
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const bc = params ?? {}
  const gia = (bc.length ?? 60) * (bc.width ?? 15) * (bc.num_floors ?? 4)

  const buildingEui   = results.summary?.eui_kWh_per_m2 ?? 0
  const totalKwh      = results.annual_energy?.total_kWh ?? 0

  const euiTargets    = crremData.eui_targets    ?? {}
  const carbonTargets = crremData.carbon_targets ?? {}

  // Current year CRREM targets (interpolated)
  const crremEuiNow     = interpolate(euiTargets,    CURRENT_YEAR)
  const crremCarbonNow  = interpolate(carbonTargets, CURRENT_YEAR)

  // Current year building carbon
  const currentGridIntensity = interpolate(GRID_INTENSITY, CURRENT_YEAR)
  const buildingCarbonNow    = gia > 0 ? (totalKwh * currentGridIntensity) / gia : null

  const euiGap         = buildingEui > 0 ? buildingEui - crremEuiNow : null
  const isEuiCompliant = euiGap != null && euiGap <= 0

  const strandingYearEui    = buildingEui > 0 ? findStrandingYear(buildingEui, euiTargets) : null
  const strandingYearCarbon = (totalKwh > 0 && gia > 0)
    ? findCarbonStrandingYear(totalKwh, gia, carbonTargets)
    : null

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-heading font-semibold text-navy">CRREM & Carbon Trajectory</h1>
        <p className="text-caption text-mid-grey mt-0.5">
          1.5°C decarbonisation pathway for UK Hotel — building vs CRREM targets
        </p>
      </div>

      {/* Compliance badge */}
      {isEuiCompliant ? (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <CheckCircle2 size={16} className="text-green-600" />
          <p className="text-caption font-medium text-green-700">
            Currently compliant — EUI is below the CRREM 1.5°C target for {CURRENT_YEAR}
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertTriangle size={16} className="text-amber-600" />
          <p className="text-caption font-medium text-amber-700">
            EUI exceeds CRREM 1.5°C target for {CURRENT_YEAR} by{' '}
            {euiGap != null ? `${euiGap.toFixed(1)} kWh/m²` : '—'}
          </p>
        </div>
      )}

      {/* EUI Trajectory Chart */}
      <EuiTrajectoryChart
        buildingEui={buildingEui}
        euiTargets={euiTargets}
        strandingYear={strandingYearEui}
      />

      {/* DataCards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <DataCard
          label="Building EUI"
          value={buildingEui > 0 ? buildingEui.toFixed(1) : null}
          unit="kWh/m²"
          accent="navy"
        />
        <DataCard
          label={`CRREM target ${CURRENT_YEAR}`}
          value={crremEuiNow.toFixed(1)}
          unit="kWh/m²"
          accent="teal"
        />
        <DataCard
          label="EUI vs target"
          value={euiGap != null ? `${euiGap > 0 ? '+' : ''}${euiGap.toFixed(1)}` : null}
          unit="kWh/m²"
          accent={isEuiCompliant ? 'green' : 'red'}
        />
        <DataCard
          label="EUI stranding year"
          value={strandingYearEui ?? 'Compliant'}
          unit={strandingYearEui ? '' : ''}
          accent={strandingYearEui ? 'red' : 'green'}
        />
      </div>

      {/* Carbon Trajectory Chart */}
      {gia > 0 && totalKwh > 0 && (
        <CarbonTrajectoryChart
          buildingTotalKwh={totalKwh}
          gia={gia}
          carbonTargets={carbonTargets}
          strandingYear={strandingYearCarbon}
        />
      )}

      {/* Carbon DataCards */}
      {gia > 0 && totalKwh > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <DataCard
            label={`Building carbon ${CURRENT_YEAR}`}
            value={buildingCarbonNow != null ? buildingCarbonNow.toFixed(1) : null}
            unit="kgCO₂/m²"
            accent="navy"
          />
          <DataCard
            label={`CRREM carbon ${CURRENT_YEAR}`}
            value={crremCarbonNow.toFixed(1)}
            unit="kgCO₂/m²"
            accent="teal"
          />
          <DataCard
            label="Carbon (2050)"
            value={gia > 0 ? ((totalKwh * interpolate(GRID_INTENSITY, 2050)) / gia).toFixed(1) : null}
            unit="kgCO₂/m²"
            accent="navy"
          />
          <DataCard
            label="Carbon stranding year"
            value={strandingYearCarbon ?? 'Compliant'}
            unit=""
            accent={strandingYearCarbon ? 'red' : 'green'}
          />
        </div>
      )}

      {/* Note on carbon methodology */}
      <div className="bg-off-white border border-light-grey rounded-lg px-4 py-3">
        <p className="text-xxs text-mid-grey">
          <span className="font-semibold text-dark-grey">Carbon methodology:</span>{' '}
          Building modelled as all-electric (VRF + ASHP DHW). Carbon intensity
          declines over time as UK grid decarbonises (FES 2023 Leading the Way).
          CRREM 1.5°C UK Hotel pathway — values are indicative pending official CRREM tool data.
        </p>
      </div>
    </div>
  )
}
