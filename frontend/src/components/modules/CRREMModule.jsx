/**
 * CRREMModule.jsx — /crrem
 *
 * Carbon Risk Real Estate Monitor (CRREM) dashboard.
 * Extracted from the old InformationModule executive summary so the
 * Information page can stay focused on background metadata.
 *
 * Reads:
 *   - Project params (gia, building_type) from ProjectContext
 *   - Modelled results from SimulationContext
 *   - Actual annual consumption via /api/projects/{id}/consumption
 *   - 1.5°C trajectory targets via /api/library/benchmarks
 *
 * Shows:
 *   1. Stranding banner (already-stranded / projected / aligned)
 *   2. EUI + Carbon trajectory charts (modelled, actual, CRREM target)
 *   3. KPI tiles: actual EUI, modelled EUI, CRREM today, stranding year
 */

import { useContext, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine,
} from 'recharts'
import { CheckCircle2, AlertTriangle, TrendingDown, ChevronDown } from 'lucide-react'
import { ProjectContext }    from '../../context/ProjectContext.jsx'
import { SimulationContext } from '../../context/SimulationContext.jsx'

// ── Constants ──────────────────────────────────────────────────────────────────

const CURRENT_YEAR  = new Date().getFullYear()
const CHART_YEARS   = Array.from({ length: 41 }, (_, i) => 2020 + i)
const CRREM_ACCENT  = '#DC2626'

const GRID_INTENSITY = {
  2020: 0.233, 2021: 0.215, 2022: 0.200, 2023: 0.185, 2024: 0.172,
  2025: 0.160, 2026: 0.145, 2027: 0.130, 2028: 0.116, 2029: 0.108,
  2030: 0.100, 2031: 0.088, 2032: 0.077, 2033: 0.068, 2034: 0.060,
  2035: 0.053, 2036: 0.047, 2037: 0.041, 2038: 0.036, 2039: 0.032,
  2040: 0.028, 2041: 0.025, 2042: 0.022, 2043: 0.019, 2044: 0.017,
  2045: 0.015, 2046: 0.013, 2047: 0.011, 2048: 0.009, 2049: 0.008,
  2050: 0.007, 2055: 0.003, 2060: 0.002,
}
const FUEL_CARBON = {
  gas: 0.183, oil: 0.247, lpg: 0.214, biomass: 0.015, district_heating: 0.168,
}

// Map building_type → CRREM benchmark name. Add others as briefs roll in.
const BENCHMARK_BY_TYPE = {
  Hotel:    'crrem_hotel_uk_15',
  Office:   'crrem_office_uk_15',
  Retail:   'crrem_retail_uk_15',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function interpolate(data, year) {
  if (!data) return null
  const keys = Object.keys(data).map(Number).sort((a, b) => a - b)
  if (year in data) return data[year]
  const lo = Math.max(...keys.filter(y => y <= year))
  const hi = Math.min(...keys.filter(y => y >= year))
  if (!isFinite(lo) || !isFinite(hi)) return null
  if (lo === hi) return data[lo] ?? data[String(lo)]
  const t = (year - lo) / (hi - lo)
  const vlo = data[lo] ?? data[String(lo)]
  const vhi = data[hi] ?? data[String(hi)]
  if (vlo == null || vhi == null) return null
  return vlo + t * (vhi - vlo)
}

function buildingCarbonKgPerM2(year, gia, fuels) {
  const gridFactor = interpolate(GRID_INTENSITY, year) ?? 0.1
  const elecCarbon = (fuels.electricity ?? 0) * gridFactor
  const fossilCarbon = (fuels.gas ?? 0) * FUEL_CARBON.gas
    + (fuels.oil ?? 0) * FUEL_CARBON.oil
    + (fuels.lpg ?? 0) * FUEL_CARBON.lpg
    + (fuels.biomass ?? 0) * FUEL_CARBON.biomass
    + (fuels.district_heating ?? 0) * FUEL_CARBON.district_heating
  return gia > 0 ? (elecCarbon + fossilCarbon) / gia : 0
}

function projectStrandingYear(actualData, targets) {
  if (!actualData || actualData.length < 2) return null
  const n = actualData.length
  const sumX  = actualData.reduce((s, d) => s + d.year, 0)
  const sumY  = actualData.reduce((s, d) => s + d.eui, 0)
  const sumXY = actualData.reduce((s, d) => s + d.year * d.eui, 0)
  const sumX2 = actualData.reduce((s, d) => s + d.year * d.year, 0)
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return null
  const slope     = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  for (let year = CURRENT_YEAR; year <= 2050; year++) {
    const projected = slope * year + intercept
    const target    = interpolate(targets, year) ?? 95
    if (projected > target) return year
  }
  return null
}

function findStrandingYear(eui, targets) {
  for (const year of CHART_YEARS) {
    if ((interpolate(targets, year) ?? 95) < eui) return year
  }
  return null
}

function strandingColor(yr) {
  if (!yr) return '#16A34A'
  const yearsAway = yr - CURRENT_YEAR
  if (yearsAway < 0)  return '#DC2626'
  if (yearsAway <= 3) return '#DC2626'
  if (yearsAway <= 10) return '#D97706'
  return '#16A34A'
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function SectionCard({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white rounded-xl border border-light-grey overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-off-white/50 transition-colors"
        style={{ borderBottom: open ? '1px solid #E5E7EB' : 'none' }}
      >
        <span className="text-caption font-semibold text-navy">{title}</span>
        <ChevronDown
          size={14}
          className="text-mid-grey transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>
      {open && <div className="px-5 py-4">{children}</div>}
    </div>
  )
}

// ── CRREM trajectory chart pair ───────────────────────────────────────────────

function CRREMChartPair({ euiTargets, carbonTargets, actualDataPoints, modelledEui, modelledFuels, gia }) {
  const euiData = CHART_YEARS.map(year => {
    const row = {
      year,
      'CRREM 1.5°C': Number((interpolate(euiTargets, year) ?? 0).toFixed(1)),
      safeZone:       Number((interpolate(euiTargets, year) ?? 0).toFixed(1)),
    }
    if (modelledEui && year >= CURRENT_YEAR - 1) row['Modelled'] = Number(modelledEui.toFixed(1))
    const found = actualDataPoints.find(p => p.year === year)
    if (found) row['Actual'] = found.eui
    return row
  })

  const carbonData = CHART_YEARS.map(year => {
    const row = {
      year,
      'CRREM Carbon': Number((interpolate(carbonTargets, year) ?? 0).toFixed(2)),
      safeZone:        Number((interpolate(carbonTargets, year) ?? 0).toFixed(2)),
    }
    if (modelledFuels && gia > 0 && year >= CURRENT_YEAR - 1) {
      row['Modelled Carbon'] = Number(buildingCarbonKgPerM2(year, gia, modelledFuels).toFixed(2))
    }
    const found = actualDataPoints.find(p => p.year === year)
    if (found) row['Actual Carbon'] = found.carbonPerM2
    return row
  })

  const axisProps = {
    tick: { fontSize: 10, fill: '#9CA3AF' },
    tickLine: false,
    axisLine: false,
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <p className="text-xxs font-medium text-mid-grey mb-2 uppercase tracking-wider">EUI — kWh/m²</p>
        <div className="h-[260px]">
          <ComposedChart width={520} height={260} data={euiData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
            <XAxis dataKey="year" {...axisProps} tickCount={6} tickFormatter={y => y % 5 === 0 ? y : ''} />
            <YAxis {...axisProps} domain={[0, 'dataMax']} />
            <Tooltip contentStyle={{ fontSize: 11, padding: '4px 8px', borderRadius: 4 }} />
            <Area type="monotone" dataKey="safeZone" fill="#16A34A" fillOpacity={0.07} stroke="none" legendType="none" />
            <Line type="monotone" dataKey="CRREM 1.5°C" stroke="#95A5A6" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
            {modelledEui > 0 && <Line type="monotone" dataKey="Modelled" stroke="#2B2A4C" strokeWidth={2} dot={false} />}
            {actualDataPoints.length > 0 && (
              <Line type="linear" dataKey="Actual" stroke="#DC2626" strokeWidth={2}
                dot={{ r: 4, fill: '#DC2626', stroke: '#fff', strokeWidth: 1.5 }}
                connectNulls={false} />
            )}
            <ReferenceLine x={CURRENT_YEAR} stroke="#E5E7EB" strokeDasharray="3 3" />
          </ComposedChart>
        </div>
      </div>

      <div>
        <p className="text-xxs font-medium text-mid-grey mb-2 uppercase tracking-wider">Carbon — kgCO₂e/m²</p>
        <div className="h-[260px]">
          <ComposedChart width={520} height={260} data={carbonData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
            <XAxis dataKey="year" {...axisProps} tickCount={6} tickFormatter={y => y % 5 === 0 ? y : ''} />
            <YAxis {...axisProps} domain={[0, 'dataMax']} />
            <Tooltip contentStyle={{ fontSize: 11, padding: '4px 8px', borderRadius: 4 }} />
            <Area type="monotone" dataKey="safeZone" fill="#16A34A" fillOpacity={0.07} stroke="none" legendType="none" />
            <Line type="monotone" dataKey="CRREM Carbon" stroke="#95A5A6" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
            {modelledFuels && gia > 0 && <Line type="monotone" dataKey="Modelled Carbon" stroke="#2B2A4C" strokeWidth={2} dot={false} />}
            {actualDataPoints.length > 0 && (
              <Line type="linear" dataKey="Actual Carbon" stroke="#DC2626" strokeWidth={2}
                dot={{ r: 4, fill: '#DC2626', stroke: '#fff', strokeWidth: 1.5 }}
                connectNulls={false} />
            )}
            <ReferenceLine x={CURRENT_YEAR} stroke="#E5E7EB" strokeDasharray="3 3" />
          </ComposedChart>
        </div>
      </div>
    </div>
  )
}

// ── Main module ────────────────────────────────────────────────────────────────

export default function CRREMModule() {
  const { params, currentProjectId } = useContext(ProjectContext)
  const { results, status: simStatus } = useContext(SimulationContext)

  const [crremData, setCrremData]               = useState(null)
  const [actualDatasets, setActualDatasets]     = useState([])

  const buildingType = params?.building_type || 'Hotel'

  // Fetch CRREM benchmark for the current building type
  useEffect(() => {
    const benchmarkName = BENCHMARK_BY_TYPE[buildingType] ?? BENCHMARK_BY_TYPE.Hotel
    const queryType = (benchmarkName.match(/crrem_(\w+?)_uk/)?.[1]) ?? 'hotel'
    fetch(`/api/library/benchmarks?building_type=${queryType}`)
      .then(r => r.ok ? r.json() : { benchmarks: [] })
      .then(d => {
        const p = d.benchmarks?.find(b => b.name === benchmarkName) ?? d.benchmarks?.[0]
        setCrremData(p?.config_json ?? null)
      })
      .catch(() => {})
  }, [buildingType])

  // Fetch actual consumption datasets
  useEffect(() => {
    if (!currentProjectId) return
    fetch(`/api/projects/${currentProjectId}/consumption`)
      .then(r => r.ok ? r.json() : { datasets: [] })
      .then(d => setActualDatasets(d.datasets ?? []))
      .catch(() => {})
  }, [currentProjectId])

  // ── Derived geometry ──────────────────────────────────────────────────────
  const length    = params?.length     ?? 60
  const width     = params?.width      ?? 15
  const numFloors = params?.num_floors ?? 4
  const gia       = length * width * numFloors

  // ── CRREM targets ─────────────────────────────────────────────────────────
  const euiTargets    = crremData?.eui_targets    ?? {}
  const carbonTargets = crremData?.carbon_targets ?? {}

  // ── Group actual datasets by year ─────────────────────────────────────────
  const dataByYear = {}
  for (const ds of actualDatasets) {
    const yr = Number(ds.data_start?.slice(0, 4))
    if (!yr || isNaN(yr)) continue
    if (!dataByYear[yr]) dataByYear[yr] = { electricity: 0, gas: 0, oil: 0, lpg: 0, biomass: 0, district_heating: 0 }
    const fuel = ds.fuel_type?.toLowerCase()
    if (fuel in dataByYear[yr]) dataByYear[yr][fuel] += ds.total_kwh ?? 0
  }

  const actualDataPoints = gia > 0
    ? Object.entries(dataByYear)
        .filter(([, fuels]) => Object.values(fuels).some(v => v > 0))
        .map(([year, fuels]) => {
          const yr       = Number(year)
          const totalKwh = Object.values(fuels).reduce((s, v) => s + v, 0)
          const eui      = Math.round(totalKwh / gia)
          const gridFactor   = interpolate(GRID_INTENSITY, yr) ?? 0.1
          const carbonTotal  = fuels.electricity * gridFactor
            + fuels.gas  * FUEL_CARBON.gas + fuels.oil   * FUEL_CARBON.oil
            + fuels.lpg  * FUEL_CARBON.lpg + fuels.biomass * FUEL_CARBON.biomass
            + fuels.district_heating * FUEL_CARBON.district_heating
          return {
            year: yr, eui, totalKwh,
            carbonPerM2: Number((carbonTotal / gia).toFixed(1)),
          }
        })
        .sort((a, b) => a.year - b.year)
    : []

  const latestActual = actualDataPoints.at(-1) ?? null

  // ── Modelled values from SimulationContext ────────────────────────────────
  const modelledEui = simStatus === 'complete' && results
    ? (results.summary?.eui_kWh_per_m2 ?? results.results_summary?.eui_kWh_per_m2 ?? null)
    : null
  const fs = results?.fuel_split
  const modelledFuels = fs
    ? { electricity: fs.electricity_kwh ?? 0, gas: fs.natural_gas_kwh ?? 0 }
    : results?.annual_energy
      ? { electricity: results.annual_energy.electricity_kWh ?? 0, gas: results.annual_energy.gas_kWh ?? 0 }
      : null

  // ── Stranding analysis ────────────────────────────────────────────────────
  const projectedStranding = projectStrandingYear(actualDataPoints, euiTargets)
  const modelledStranding  = modelledEui ? findStrandingYear(modelledEui, euiTargets) : null
  const crremNow           = euiTargets ? interpolate(euiTargets, CURRENT_YEAR) : null
  const isAlreadyStranded  = latestActual && crremNow != null && latestActual.eui > crremNow

  return (
    <div className="h-full overflow-y-auto bg-off-white">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-5">

        <div className="flex items-baseline justify-between mb-1">
          <div>
            <h1 className="text-heading font-semibold text-navy">CRREM 1.5°C Trajectory</h1>
            <p className="text-xxs text-mid-grey mt-1">
              Building type: <span className="font-medium text-dark-grey">{buildingType}</span>
              {' · '}Benchmark: <span className="font-mono text-dark-grey">{BENCHMARK_BY_TYPE[buildingType] ?? BENCHMARK_BY_TYPE.Hotel}</span>
            </p>
          </div>
          <Link to="/information" className="text-xxs text-mid-grey hover:text-navy underline">
            Edit building type in Information
          </Link>
        </div>

        {/* Stranding banner */}
        <SectionCard title="Stranding status">
          {!crremData ? (
            <p className="text-xxs text-mid-grey">CRREM benchmark not available — restart the backend or check the library.</p>
          ) : isAlreadyStranded ? (
            <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />
              <div>
                <p className="text-caption font-semibold text-red-800">
                  STRANDED — current EUI of {latestActual.eui} kWh/m² exceeds the {latestActual.year} target of {crremNow?.toFixed(0)} kWh/m²
                </p>
                <p className="text-xxs text-red-600 mt-0.5">Immediate action required to align with 1.5°C pathway</p>
              </div>
            </div>
          ) : actualDataPoints.length >= 2 && projectedStranding ? (
            <div
              className="flex items-center gap-3 rounded-xl px-4 py-3 border"
              style={{
                backgroundColor: strandingColor(projectedStranding) + '10',
                borderColor: strandingColor(projectedStranding) + '40',
              }}
            >
              <TrendingDown size={16} style={{ color: strandingColor(projectedStranding) }} className="flex-shrink-0" />
              <div>
                <p className="text-caption font-semibold" style={{ color: strandingColor(projectedStranding) }}>
                  Projected stranding: {projectedStranding}
                </p>
                <p className="text-xxs text-mid-grey mt-0.5">
                  At current trajectory, EUI will exceed the CRREM 1.5°C pathway in {projectedStranding}.
                  {crremNow && ` Target in ${CURRENT_YEAR}: ${crremNow.toFixed(0)} kWh/m².`}
                </p>
              </div>
            </div>
          ) : latestActual && crremNow != null && latestActual.eui <= crremNow ? (
            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <CheckCircle2 size={16} className="text-green-600 flex-shrink-0" />
              <p className="text-caption font-medium text-green-700">
                ALIGNED — actual EUI of {latestActual.eui} kWh/m² is within the CRREM 1.5°C target
              </p>
            </div>
          ) : (
            <p className="text-xxs text-mid-grey">
              Add at least one year of measured consumption in <Link to="/consumption" className="underline hover:text-navy">Consumption</Link> to see your trajectory.
            </p>
          )}
        </SectionCard>

        {/* Trajectory charts */}
        <SectionCard title="EUI & Carbon trajectory">
          {crremData ? (
            <CRREMChartPair
              euiTargets={euiTargets}
              carbonTargets={carbonTargets}
              actualDataPoints={actualDataPoints}
              modelledEui={modelledEui}
              modelledFuels={modelledFuels}
              gia={gia}
            />
          ) : (
            <p className="text-xxs text-mid-grey">No CRREM data loaded.</p>
          )}
        </SectionCard>

        {/* KPI tiles */}
        <SectionCard title="Key figures">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {latestActual && (
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <p className="text-xxs text-mid-grey">Actual EUI {latestActual.year}</p>
                <p className="text-heading font-bold text-red-700">{latestActual.eui}</p>
                <p className="text-xxs text-mid-grey">kWh/m²</p>
              </div>
            )}
            {modelledEui && (
              <div className="bg-navy/5 rounded-lg p-3 text-center">
                <p className="text-xxs text-mid-grey">Modelled EUI</p>
                <p className="text-heading font-bold text-navy">{Math.round(modelledEui)}</p>
                <p className="text-xxs text-mid-grey">kWh/m²</p>
              </div>
            )}
            {crremNow && (
              <div className="bg-off-white rounded-lg p-3 text-center">
                <p className="text-xxs text-mid-grey">CRREM {CURRENT_YEAR}</p>
                <p className="text-heading font-bold text-dark-grey">{crremNow.toFixed(0)}</p>
                <p className="text-xxs text-mid-grey">kWh/m²</p>
              </div>
            )}
            {(projectedStranding || modelledStranding) && (
              <div className="rounded-lg p-3 text-center"
                style={{ backgroundColor: strandingColor(projectedStranding ?? modelledStranding) + '10' }}>
                <p className="text-xxs text-mid-grey">Stranding year</p>
                <p className="text-heading font-bold"
                  style={{ color: strandingColor(projectedStranding ?? modelledStranding) }}>
                  {projectedStranding ?? modelledStranding}
                </p>
                <p className="text-xxs text-mid-grey">{projectedStranding ? 'projected' : 'modelled'}</p>
              </div>
            )}
            {!latestActual && !modelledEui && (
              <p className="col-span-full text-xxs text-mid-grey">
                Run a simulation or upload measured consumption to populate these figures.
              </p>
            )}
          </div>
        </SectionCard>

      </div>
    </div>
  )
}
