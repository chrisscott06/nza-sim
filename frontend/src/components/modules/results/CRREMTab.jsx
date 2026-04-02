/**
 * CRREMTab.jsx
 *
 * CRREM & Carbon trajectory tab for the Results Dashboard.
 *
 * Props:
 *   scenarios       — array of scenario objects (optional; from ResultsDashboard)
 *   scenarioResults — { [scenarioId]: simRunData } (optional)
 *
 * When scenarios with results are provided, each scenario is plotted as a
 * separate EUI line and carbon line. Otherwise, falls back to SimulationContext.
 */

import { useContext, useEffect, useState } from 'react'
import {
  ComposedChart, Line, Area, XAxis, YAxis,
  Tooltip, Legend, ReferenceLine, ReferenceDot,
  CartesianGrid,
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
const CHART_YEARS  = Array.from({ length: 41 }, (_, i) => 2020 + i) // 2020–2060

const SCENARIO_COLORS = [
  '#2B2A4C', // navy (baseline)
  '#00AEEF', // teal
  '#E84393', // magenta
  '#ECB01F', // gold
  '#16A34A', // green
  '#8B5CF6', // purple
]

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
  for (const year of CHART_YEARS) {
    if (interpolate(euiTargets, year) < buildingEui) return year
  }
  return null
}

function findCarbonStrandingYear(totalKwh, gia, carbonTargets) {
  for (const year of CHART_YEARS) {
    const carbon = (totalKwh * interpolate(GRID_INTENSITY, year)) / gia
    if (interpolate(carbonTargets, year) < carbon) return year
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
        p.value != null && (
          <p key={i} style={{ color: p.color }}>
            {p.name}: {Number(p.value).toFixed(1)} {unit}
          </p>
        )
      ))}
    </div>
  )
}

// ── EUI Chart (single or multi-scenario) ──────────────────────────────────────

function EuiTrajectoryChart({ scenarioLines, euiTargets }) {
  // scenarioLines: [{ name, eui, color }]
  const data = CHART_YEARS.map(year => {
    const row = {
      year,
      'CRREM 1.5°C': Number(interpolate(euiTargets, year).toFixed(1)),
      safeZone:      Number(interpolate(euiTargets, year).toFixed(1)),
    }
    for (const s of scenarioLines) {
      if (year >= CURRENT_YEAR - 1) {
        row[s.name] = Number(s.eui.toFixed(1))
      }
    }
    return row
  })

  // Find stranding years for reference lines
  const strandingYears = scenarioLines.map(s => ({
    name:  s.name,
    color: s.color,
    year:  findStrandingYear(s.eui, euiTargets),
  }))

  return (
    <ChartContainer title="EUI trajectory vs CRREM 1.5°C pathway" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 4 }}>
        <CartesianGrid {...GRID_STYLE} />
        <XAxis dataKey="year" {...AXIS_PROPS} tickCount={9} />
        <YAxis
          {...AXIS_PROPS}
          label={{ value: 'kWh/m²', angle: -90, position: 'insideLeft', fontSize: 9, fill: '#95A5A6', dx: 12 }}
        />
        <Tooltip content={<ChartTooltip unit="kWh/m²" />} wrapperStyle={TOOLTIP_WRAPPER_STYLE} />
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

        {/* One line per scenario */}
        {scenarioLines.map(s => (
          <Line
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}

        {/* Current year reference */}
        <ReferenceLine
          x={CURRENT_YEAR}
          stroke="#95A5A6"
          strokeDasharray="3 3"
          label={{ value: 'Today', fontSize: 9, fill: '#95A5A6', position: 'insideTopRight' }}
        />

        {/* Stranding year dots */}
        {strandingYears.filter(s => s.year).map(s => (
          <ReferenceDot
            key={s.name}
            x={s.year}
            y={Number(scenarioLines.find(x => x.name === s.name)?.eui.toFixed(1))}
            r={5}
            fill={s.color}
            stroke="#fff"
            strokeWidth={2}
          />
        ))}
      </ComposedChart>
    </ChartContainer>
  )
}

// ── Carbon Chart (single or multi-scenario) ───────────────────────────────────

function CarbonTrajectoryChart({ scenarioLines, gia, carbonTargets }) {
  // scenarioLines: [{ name, totalKwh, color }]
  const data = CHART_YEARS.map(year => {
    const row = {
      year,
      'CRREM 1.5°C Carbon': Number(interpolate(carbonTargets, year).toFixed(1)),
      safeZone:             Number(interpolate(carbonTargets, year).toFixed(1)),
    }
    if (gia > 0) {
      const gridIntensity = interpolate(GRID_INTENSITY, year)
      for (const s of scenarioLines) {
        if (year >= CURRENT_YEAR - 1) {
          row[s.name] = Number(((s.totalKwh * gridIntensity) / gia).toFixed(1))
        }
      }
    }
    return row
  })

  return (
    <ChartContainer title="Carbon intensity trajectory vs CRREM 1.5°C pathway" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 4 }}>
        <CartesianGrid {...GRID_STYLE} />
        <XAxis dataKey="year" {...AXIS_PROPS} tickCount={9} />
        <YAxis
          {...AXIS_PROPS}
          label={{ value: 'kgCO₂/m²', angle: -90, position: 'insideLeft', fontSize: 9, fill: '#95A5A6', dx: 16 }}
        />
        <Tooltip content={<ChartTooltip unit="kgCO₂/m²" />} wrapperStyle={TOOLTIP_WRAPPER_STYLE} />
        <Legend wrapperStyle={LEGEND_STYLE} />

        <Area type="monotone" dataKey="safeZone" fill="#16A34A" fillOpacity={0.06} stroke="none" legendType="none" />

        <Line type="monotone" dataKey="CRREM 1.5°C Carbon" stroke="#95A5A6" strokeWidth={2} strokeDasharray="6 3" dot={false} activeDot={{ r: 4 }} />

        {scenarioLines.map(s => (
          <Line key={s.name} type="monotone" dataKey={s.name} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        ))}

        <ReferenceLine
          x={CURRENT_YEAR}
          stroke="#95A5A6"
          strokeDasharray="3 3"
          label={{ value: 'Today', fontSize: 9, fill: '#95A5A6', position: 'insideTopRight' }}
        />
      </ComposedChart>
    </ChartContainer>
  )
}

// ── Stranding summary table ────────────────────────────────────────────────────

function StrandingTable({ scenarioLines, euiTargets, carbonTargets, gia }) {
  if (scenarioLines.length <= 1) return null

  return (
    <div className="bg-white border border-light-grey rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-light-grey">
        <p className="text-caption font-semibold text-navy">Stranding Analysis</p>
        <p className="text-xxs text-mid-grey mt-0.5">Year when each scenario crosses the CRREM 1.5°C threshold</p>
      </div>
      <table className="w-full text-xxs">
        <thead>
          <tr className="border-b border-light-grey bg-off-white">
            <th className="text-left px-4 py-2 text-mid-grey font-medium">Scenario</th>
            <th className="text-right px-4 py-2 text-mid-grey font-medium">EUI (kWh/m²)</th>
            <th className="text-right px-4 py-2 text-mid-grey font-medium">EUI stranding</th>
            <th className="text-right px-4 py-2 text-mid-grey font-medium">Carbon stranding</th>
          </tr>
        </thead>
        <tbody>
          {scenarioLines.map(s => {
            const euiStrand    = findStrandingYear(s.eui, euiTargets)
            const carbStrand   = gia > 0 ? findCarbonStrandingYear(s.totalKwh, gia, carbonTargets) : null
            return (
              <tr key={s.name} className="border-b border-light-grey last:border-0 hover:bg-off-white/50">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="font-medium text-dark-grey">{s.name}</span>
                  </div>
                </td>
                <td className="px-4 py-2 text-right font-medium text-navy">{s.eui.toFixed(1)}</td>
                <td className="px-4 py-2 text-right">
                  {euiStrand
                    ? <span className="font-semibold text-red-500">{euiStrand}</span>
                    : <span className="text-green-600 font-semibold">Compliant</span>}
                </td>
                <td className="px-4 py-2 text-right">
                  {carbStrand
                    ? <span className="font-semibold text-red-500">{carbStrand}</span>
                    : <span className="text-green-600 font-semibold">Compliant</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── CRREMTab ───────────────────────────────────────────────────────────────────

export default function CRREMTab({ scenarios = [], scenarioResults = {} }) {
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

  // ── Determine which lines to show ─────────────────────────────────────────

  const bc  = params ?? {}
  const gia = (bc.length ?? 60) * (bc.width ?? 15) * (bc.num_floors ?? 4)

  const euiTargets    = crremData.eui_targets    ?? {}
  const carbonTargets = crremData.carbon_targets ?? {}

  // Build scenarioLines from passed-in scenario data if available
  const scenariosWithResults = scenarios.filter(s => scenarioResults[s.id])
  const useMultiScenario = scenariosWithResults.length > 0

  let scenarioLines = []

  if (useMultiScenario) {
    scenarioLines = scenariosWithResults.map((s, i) => ({
      name:     s.name,
      color:    SCENARIO_COLORS[i] ?? SCENARIO_COLORS[0],
      eui:      scenarioResults[s.id].results_summary?.eui_kWh_per_m2 ?? 0,
      totalKwh: scenarioResults[s.id].results_summary?.total_energy_kWh ?? 0,
    }))
  } else if (status === 'complete' && results) {
    // Fallback: single line from SimulationContext
    scenarioLines = [{
      name:     'This building',
      color:    '#2B2A4C',
      eui:      results.summary?.eui_kWh_per_m2 ?? 0,
      totalKwh: results.annual_energy?.total_kWh ?? 0,
    }]
  }

  if (scenarioLines.length === 0 || scenarioLines.every(s => !s.eui)) {
    return (
      <ModuleEmptyState
        icon={TrendingDown}
        title="No simulation results"
        message="Run a simulation first to see CRREM trajectory analysis."
      />
    )
  }

  // ── Derived: baseline (first) scenario for summary DataCards ─────────────

  const primary = scenarioLines[0]
  const primaryEui    = primary.eui
  const primaryKwh    = primary.totalKwh

  const crremEuiNow    = interpolate(euiTargets,    CURRENT_YEAR)
  const crremCarbonNow = interpolate(carbonTargets, CURRENT_YEAR)

  const euiGap         = primaryEui > 0 ? primaryEui - crremEuiNow : null
  const isEuiCompliant = euiGap != null && euiGap <= 0

  const currentGridIntensity = interpolate(GRID_INTENSITY, CURRENT_YEAR)
  const buildingCarbonNow    = gia > 0 ? (primaryKwh * currentGridIntensity) / gia : null

  const strandingYearEui    = findStrandingYear(primaryEui, euiTargets)
  const strandingYearCarbon = gia > 0 ? findCarbonStrandingYear(primaryKwh, gia, carbonTargets) : null

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-heading font-semibold text-navy">CRREM & Carbon Trajectory</h1>
          <p className="text-caption text-mid-grey mt-0.5">
            1.5°C decarbonisation pathway for UK Hotel
            {useMultiScenario && ` — ${scenarioLines.length} scenarios`}
          </p>
        </div>
      </div>

      {/* Compliance badge (for primary / baseline scenario) */}
      {isEuiCompliant ? (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <CheckCircle2 size={16} className="text-green-600" />
          <p className="text-caption font-medium text-green-700">
            {primary.name} is currently compliant — EUI below CRREM 1.5°C target for {CURRENT_YEAR}
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertTriangle size={16} className="text-amber-600" />
          <p className="text-caption font-medium text-amber-700">
            {primary.name} exceeds CRREM 1.5°C target for {CURRENT_YEAR} by{' '}
            {euiGap != null ? `${euiGap.toFixed(1)} kWh/m²` : '—'}
          </p>
        </div>
      )}

      {/* EUI Trajectory Chart */}
      <EuiTrajectoryChart
        scenarioLines={scenarioLines}
        euiTargets={euiTargets}
      />

      {/* EUI DataCards (primary scenario) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <DataCard
          label={`${primary.name} EUI`}
          value={primaryEui > 0 ? primaryEui.toFixed(1) : null}
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
          unit=""
          accent={strandingYearEui ? 'red' : 'green'}
        />
      </div>

      {/* Multi-scenario stranding table */}
      <StrandingTable
        scenarioLines={scenarioLines}
        euiTargets={euiTargets}
        carbonTargets={carbonTargets}
        gia={gia}
      />

      {/* Carbon Trajectory Chart */}
      {gia > 0 && (
        <CarbonTrajectoryChart
          scenarioLines={scenarioLines}
          gia={gia}
          carbonTargets={carbonTargets}
        />
      )}

      {/* Carbon DataCards (primary scenario) */}
      {gia > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <DataCard
            label={`Carbon ${CURRENT_YEAR}`}
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
            label="Building carbon 2050"
            value={primaryKwh > 0 ? ((primaryKwh * interpolate(GRID_INTENSITY, 2050)) / gia).toFixed(1) : null}
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

      {/* Methodology note */}
      <div className="bg-off-white border border-light-grey rounded-lg px-4 py-3">
        <p className="text-xxs text-mid-grey">
          <span className="font-semibold text-dark-grey">Carbon methodology:</span>{' '}
          All energy modelled as electricity (VRF + ASHP DHW). Carbon intensity declines
          as UK grid decarbonises (National Grid FES 2023 — Leading the Way).
          CRREM 1.5°C UK Hotel pathway — indicative values pending official CRREM tool data.
        </p>
      </div>
    </div>
  )
}
