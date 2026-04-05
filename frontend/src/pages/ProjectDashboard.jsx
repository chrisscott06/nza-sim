/**
 * ProjectDashboard.jsx — project overview page (/project)
 *
 * Landing page after clicking a project card. Shows:
 *  - Project name, building type, location
 *  - Summary cards: GIA, modelled EUI, actual EUI, CRREM target, performance gap
 *  - Data completeness checklist (links to relevant modules)
 *  - Mini CRREM trajectory chart (non-interactive, click to go to Results)
 *  - Scenario summary (if scenarios exist)
 *  - Quick-action buttons
 */

import { useContext, useEffect, useState, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  Building2, Settings2, Upload, Play, ChevronRight,
  CheckCircle2, Circle, AlertTriangle, Loader2,
} from 'lucide-react'
import {
  ComposedChart, Line, ReferenceDot,
  XAxis, YAxis, CartesianGrid, ResponsiveContainer,
} from 'recharts'
import { ProjectContext }    from '../context/ProjectContext.jsx'
import { SimulationContext } from '../context/SimulationContext.jsx'
import { useWeather }        from '../context/WeatherContext.jsx'
import { useHourlySolar }    from '../hooks/useHourlySolar.js'
import { calculateInstant }  from '../utils/instantCalc.js'

// ── Constants ──────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear()
const CHART_YEARS  = Array.from({ length: 31 }, (_, i) => 2020 + i) // 2020–2050

// ── Helpers ────────────────────────────────────────────────────────────────────

function interpolate(data, year) {
  if (!data) return null
  const years = Object.keys(data).map(Number).sort((a, b) => a - b)
  if (String(year) in data) return data[String(year)]
  if (year in data) return data[year]
  const lo = Math.max(...years.filter(y => y <= year))
  const hi = Math.min(...years.filter(y => y >= year))
  if (!isFinite(lo) || !isFinite(hi)) return null
  if (lo === hi) return data[lo]
  const t = (year - lo) / (hi - lo)
  return data[lo] + t * (data[hi] - data[lo])
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, status }) {
  const borderColor = {
    red:    '#FCA5A5',
    amber:  '#FCD34D',
    green:  '#86EFAC',
  }[status] ?? '#E5E7EB'

  const valueColor = {
    red:   '#DC2626',
    amber: '#D97706',
    green: '#16A34A',
  }[status] ?? '#1A1A3E'

  return (
    <div className="bg-white rounded-xl border p-4 flex flex-col" style={{ borderColor }}>
      <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">{label}</p>
      <p className="text-section font-bold tabular-nums" style={{ color: valueColor }}>
        {value ?? '—'}
      </p>
      {sub && <p className="text-xxs text-mid-grey mt-0.5">{sub}</p>}
    </div>
  )
}

function CheckItem({ done, warning, label, sub, href }) {
  const icon = warning
    ? <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
    : done
      ? <CheckCircle2 size={14} className="text-green-600 flex-shrink-0 mt-0.5" />
      : <Circle      size={14} className="text-light-grey flex-shrink-0 mt-0.5" />

  const inner = (
    <div className={`flex items-start gap-2 py-1.5 px-2 rounded-lg ${href ? 'hover:bg-off-white' : ''}`}>
      {icon}
      <div className="min-w-0">
        <p className={`text-caption ${done || warning ? 'text-dark-grey' : 'text-mid-grey'}`}>{label}</p>
        {sub && <p className="text-xxs text-mid-grey leading-snug mt-0.5">{sub}</p>}
      </div>
    </div>
  )

  return href
    ? <Link to={href} className="block">{inner}</Link>
    : <div>{inner}</div>
}

function MiniCRREMChart({ crremData, modelledEui, actualEui }) {
  if (!crremData?.eui_targets) {
    return (
      <div className="h-48 flex items-center justify-center text-xxs text-mid-grey">
        CRREM data not available
      </div>
    )
  }

  const targets = crremData.eui_targets
  const data = CHART_YEARS.map(year => {
    const v = interpolate(targets, year)
    return { year, crrem: v != null ? Math.round(v) : null }
  })

  return (
    <ResponsiveContainer width="100%" height={180}>
      <ComposedChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
        <XAxis
          dataKey="year"
          tick={{ fontSize: 9, fill: '#9CA3AF' }}
          tickLine={false}
          interval={4}
          tickFormatter={y => y % 10 === 0 ? String(y) : ''}
        />
        <YAxis
          tick={{ fontSize: 9, fill: '#9CA3AF' }}
          tickLine={false}
          domain={[0, 'dataMax']}
          width={36}
        />
        {/* CRREM pathway */}
        <Line
          type="monotone"
          dataKey="crrem"
          stroke="#D97706"
          strokeWidth={1.5}
          dot={false}
          strokeDasharray="5 3"
          isAnimationActive={false}
        />
        {/* Modelled EUI dot */}
        {modelledEui != null && (
          <ReferenceDot
            x={CURRENT_YEAR}
            y={Math.round(modelledEui)}
            r={5}
            fill="#2D2B4F"
            stroke="#fff"
            strokeWidth={1.5}
          />
        )}
        {/* Actual EUI dot */}
        {actualEui != null && (
          <ReferenceDot
            x={CURRENT_YEAR}
            y={Math.round(actualEui)}
            r={5}
            fill="#DC2626"
            stroke="#fff"
            strokeWidth={1.5}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ProjectDashboard() {
  const { params, constructions, systems, currentProjectId, projects } = useContext(ProjectContext)
  const { results, status: simStatus, runSimulation } = useContext(SimulationContext)
  const { weatherData }  = useWeather()
  const hourlySolar      = useHourlySolar(weatherData, params?.orientation ?? 0)
  const navigate         = useNavigate()

  const [crremData,            setCrremData]            = useState(null)
  const [consumptionDatasets,  setConsumptionDatasets]  = useState(null) // null = loading
  const [scenarios,            setScenarios]            = useState([])

  // ── Data fetching ────────────────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/library/benchmarks')
      .then(r => r.json())
      .then(data => {
        const pathway = data.benchmarks?.find(b => b.name === 'crrem_hotel_uk_15')
        setCrremData(pathway?.config_json ?? null)
      })
      .catch(() => setCrremData(null))
  }, [])

  useEffect(() => {
    if (!currentProjectId) return
    fetch(`/api/projects/${currentProjectId}/consumption`)
      .then(r => r.ok ? r.json() : { datasets: [] })
      .then(data => setConsumptionDatasets(data.datasets ?? []))
      .catch(() => setConsumptionDatasets([]))
  }, [currentProjectId])

  useEffect(() => {
    if (!currentProjectId) return
    fetch(`/api/projects/${currentProjectId}/scenarios`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setScenarios(Array.isArray(data) ? data : []))
      .catch(() => setScenarios([]))
  }, [currentProjectId])

  // ── Instant calc (fallback if no simulation result) ──────────────────────────

  const instantResult = useMemo(() => {
    if (!params || !constructions || !systems) return null
    try {
      return calculateInstant(params, constructions, systems, {}, weatherData, hourlySolar)
    } catch { return null }
  }, [params, constructions, systems, weatherData, hourlySolar])

  // ── Derived values ───────────────────────────────────────────────────────────

  const gia          = params ? Math.round(params.length * params.width * params.num_floors) : null
  const modelledEui  = results?.summary?.eui_kWh_per_m2 ?? instantResult?.eui ?? null
  const epVerified   = results?.summary?.eui_kWh_per_m2 != null

  // Actual EUI from uploaded electricity consumption / GIA
  const elecDataset  = consumptionDatasets?.find(d => d.fuel_type === 'electricity')
  const gasDataset   = consumptionDatasets?.find(d => d.fuel_type === 'gas')
  const actualEui    = (elecDataset && gia) ? Math.round(elecDataset.total_kwh / gia) : null

  // CRREM target for current year
  const crremTarget  = crremData?.eui_targets
    ? Math.round(interpolate(crremData.eui_targets, CURRENT_YEAR))
    : null

  // Performance gap (actual vs CRREM)
  const perfGap      = (actualEui != null && crremTarget != null) ? actualEui - crremTarget : null
  const perfStatus   = perfGap == null ? null : perfGap > 100 ? 'red' : perfGap > 0 ? 'amber' : 'green'

  // Current project from list (for simulation_count)
  const currentProject  = projects?.find(p => p.id === currentProjectId)
  const simulationCount = currentProject?.simulation_count ?? 0

  // ── Checklist ────────────────────────────────────────────────────────────────

  const hasGeometry     = params?.length > 0 && params?.width > 0 && params?.num_floors > 0
  const hasConstructions = constructions && Object.values(constructions).some(Boolean)
  const hasSystemsConfig = systems?.mode === 'detailed'
  const hasOccupancy    = (params?.num_bedrooms ?? 0) > 0
  const hasElecData     = elecDataset != null
  const hasGasData      = gasDataset != null
  const hasSimulation   = simulationCount > 0 || results?.status === 'complete'

  // Weather location check (UK latitude 49–62°N)
  const weatherLat    = weatherData?.location?.latitude ?? params?.location?.latitude ?? null
  const weatherName   = weatherData?.location?.city ?? params?.location?.name ?? 'Unknown'
  const weatherOk     = weatherLat != null && weatherLat >= 49 && weatherLat <= 62
  const weatherWarn   = weatherLat != null && !weatherOk

  // Human-readable system summary
  const systemSummary = systems ? [
    systems.space_heating?.primary?.system,
    systems.ventilation?.primary?.system,
    systems.dhw?.primary?.system,
  ].filter(Boolean).map(s => s.replace(/_/g, ' ')).join(' · ') : ''

  // Modelled EUI card status
  const euiStatus = modelledEui == null ? null
    : modelledEui <= 100 ? 'green'
    : modelledEui <= 150 ? 'amber'
    : 'red'

  const actualEuiStatus = (actualEui == null || crremTarget == null) ? null
    : actualEui <= crremTarget ? 'green'
    : actualEui <= crremTarget * 1.5 ? 'amber'
    : 'red'

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto" style={{ backgroundColor: '#F8F9FA' }}>

      {/* ── Header ── */}
      <div className="bg-white border-b border-light-grey px-8 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            {/* Breadcrumb */}
            <p className="text-xxs text-mid-grey mb-1">
              <Link to="/" className="hover:text-navy transition-colors">Projects</Link>
              <span className="mx-1.5">›</span>
              <span className="text-dark-grey">Overview</span>
            </p>

            <h1 className="text-2xl font-bold text-navy leading-tight">
              {params?.name ?? 'Loading…'}
            </h1>

            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="px-2 py-0.5 rounded-full text-xxs font-semibold bg-navy/10 text-navy">
                Hotel
              </span>
              {params?.location?.name && (
                <span className="text-caption text-mid-grey">{params.location.name}</span>
              )}
              {simulationCount > 0 && (
                <span className="text-xxs text-mid-grey">
                  {simulationCount} simulation{simulationCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
            <button
              onClick={() => navigate('/building')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-caption text-navy border border-light-grey rounded-lg hover:border-navy/30 hover:bg-navy/5 transition-colors"
            >
              <Building2 size={13} /> Edit Building
            </button>
            <button
              onClick={() => navigate('/systems')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-caption text-navy border border-light-grey rounded-lg hover:border-navy/30 hover:bg-navy/5 transition-colors"
            >
              <Settings2 size={13} /> Edit Systems
            </button>
            <button
              onClick={() => navigate('/consumption')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-caption text-navy border border-light-grey rounded-lg hover:border-navy/30 hover:bg-navy/5 transition-colors"
            >
              <Upload size={13} /> Upload Data
            </button>
            <button
              onClick={() => { runSimulation(); navigate('/results') }}
              disabled={simStatus === 'running'}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-caption text-white rounded-lg transition-colors ${
                simStatus === 'running'
                  ? 'bg-magenta/70 cursor-not-allowed'
                  : 'bg-magenta hover:bg-magenta/90'
              }`}
            >
              {simStatus === 'running'
                ? <><Loader2 size={13} className="animate-spin" /> Simulating…</>
                : <><Play size={13} fill="currentColor" /> Run Simulation</>
              }
            </button>
          </div>
        </div>
      </div>

      <div className="px-8 py-6 space-y-5">

        {/* ── Summary strip ── */}
        <div className="grid grid-cols-5 gap-4">
          <SummaryCard
            label="GIA"
            value={gia ? `${gia.toLocaleString()} m²` : '—'}
            sub={params ? `${params.length}m × ${params.width}m × ${params.num_floors} fl` : null}
          />
          <SummaryCard
            label="Modelled EUI"
            value={modelledEui != null ? `${Math.round(modelledEui)} kWh/m²` : '—'}
            sub={epVerified ? 'EnergyPlus verified' : 'Instant estimate'}
            status={euiStatus}
          />
          <SummaryCard
            label="Actual EUI"
            value={actualEui != null ? `${actualEui} kWh/m²` : '—'}
            sub={
              elecDataset
                ? `Elec data ${new Date(elecDataset.data_start + 'Z').getFullYear()}`
                : 'No data uploaded'
            }
            status={actualEuiStatus}
          />
          <SummaryCard
            label={`CRREM ${CURRENT_YEAR}`}
            value={crremTarget != null ? `${crremTarget} kWh/m²` : '—'}
            sub="UK Hotel 1.5°C pathway"
            status="amber"
          />
          <SummaryCard
            label="Performance Gap"
            value={
              perfGap != null
                ? `${perfGap > 0 ? '+' : ''}${Math.round(perfGap)} kWh/m²`
                : '—'
            }
            sub={
              perfGap != null
                ? perfGap > 0 ? 'Above CRREM target' : 'Below CRREM target ✓'
                : 'Upload data to calculate'
            }
            status={perfStatus}
          />
        </div>

        {/* ── Checklist + Mini CRREM ── */}
        <div className="grid grid-cols-2 gap-5">

          {/* Data completeness checklist */}
          <div className="bg-white rounded-xl border border-light-grey p-5">
            <h3 className="text-caption font-semibold text-navy mb-3">Data Completeness</h3>
            <div className="space-y-0.5">
              <CheckItem
                done={hasGeometry}
                label="Building geometry defined"
                sub={
                  hasGeometry && gia
                    ? `${params.length}m × ${params.width}m × ${params.num_floors} fl — ${gia.toLocaleString()} m² GIA`
                    : 'Define in Building module'
                }
                href="/building"
              />
              <CheckItem
                done={hasConstructions}
                label="Fabric constructions assigned"
                sub={hasConstructions ? null : 'Assign in Building → Fabric'}
                href="/building"
              />
              <CheckItem
                done={hasSystemsConfig}
                label={`Systems configured${systems?.mode ? ` (${systems.mode} mode)` : ''}`}
                sub={
                  hasSystemsConfig && systemSummary
                    ? systemSummary.substring(0, 70)
                    : 'Configure in Systems module'
                }
                href="/systems"
              />
              <CheckItem
                done={hasOccupancy}
                label="Occupancy set"
                sub={
                  hasOccupancy
                    ? `${params.num_bedrooms} rooms · ${Math.round((params.occupancy_rate ?? 0.75) * 100)}% occupancy`
                    : 'Set in Building → Occupancy'
                }
                href="/building"
              />
              <CheckItem
                done={hasElecData}
                label="Electricity consumption data"
                sub={
                  hasElecData
                    ? `${elecDataset.record_count?.toLocaleString()} records · ${Math.round(elecDataset.total_kwh).toLocaleString()} kWh`
                    : 'Upload half-hourly data in Consumption'
                }
                href="/consumption"
              />
              <CheckItem
                done={hasGasData}
                label="Gas consumption data"
                sub={
                  hasGasData
                    ? `${gasDataset.record_count?.toLocaleString()} records · ${Math.round(gasDataset.total_kwh).toLocaleString()} kWh`
                    : 'Not uploaded'
                }
                href="/consumption"
              />
              <CheckItem
                done={hasSimulation}
                label="EnergyPlus simulation run"
                sub={
                  hasSimulation
                    ? `EUI: ${Math.round(results?.summary?.eui_kWh_per_m2 ?? 0)} kWh/m² · ${simulationCount} run${simulationCount !== 1 ? 's' : ''}`
                    : 'Run simulation for verified results'
                }
              />
              <CheckItem
                done={weatherOk && !weatherWarn}
                warning={weatherWarn}
                label={`Weather file: ${weatherName}`}
                sub={
                  weatherLat != null
                    ? weatherOk
                      ? `${weatherLat.toFixed(1)}°N — UK climate`
                      : `Latitude ${weatherLat.toFixed(1)}° — check weather file matches building location`
                    : 'Weather file location unknown'
                }
                href="/building"
              />
              <CheckItem
                done={false}
                label="PROMETHEUS future weather files"
                sub="Not available — future climate scenarios require separate PROMETHEUS files"
              />
            </div>
          </div>

          {/* Mini CRREM chart */}
          <div className="bg-white rounded-xl border border-light-grey p-5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-caption font-semibold text-navy">CRREM Trajectory</h3>
              <button
                onClick={() => navigate('/results')}
                className="text-xxs text-teal hover:text-teal/70 transition-colors flex items-center gap-0.5"
              >
                Full chart <ChevronRight size={11} />
              </button>
            </div>
            <p className="text-xxs text-mid-grey mb-2">UK Hotel 1.5°C decarbonisation pathway</p>

            <MiniCRREMChart
              crremData={crremData}
              modelledEui={modelledEui}
              actualEui={actualEui}
            />

            {/* Legend */}
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-1.5">
                <svg width="18" height="8">
                  <line x1="0" y1="4" x2="18" y2="4" stroke="#D97706" strokeWidth="1.5" strokeDasharray="5 3" />
                </svg>
                <span className="text-xxs text-mid-grey">CRREM 1.5°C</span>
              </div>
              {modelledEui != null && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-navy" />
                  <span className="text-xxs text-mid-grey">Modelled {Math.round(modelledEui)} kWh/m²</span>
                </div>
              )}
              {actualEui != null && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-600" />
                  <span className="text-xxs text-mid-grey">Actual {actualEui} kWh/m²</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Scenario summary ── */}
        {scenarios.filter(s => s.latest_eui != null).length > 0 && (
          <div className="bg-white rounded-xl border border-light-grey p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-caption font-semibold text-navy">Scenario Summary</h3>
              <button
                onClick={() => navigate('/scenarios')}
                className="text-xxs text-teal hover:text-teal/70 transition-colors flex items-center gap-0.5"
              >
                Compare scenarios <ChevronRight size={11} />
              </button>
            </div>
            <div className="space-y-0.5">
              {[...scenarios]
                .filter(s => s.latest_eui != null)
                .sort((a, b) => a.latest_eui - b.latest_eui)
                .slice(0, 6)
                .map(s => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-off-white"
                  >
                    <span className="text-caption text-dark-grey">{s.name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-caption font-semibold text-navy tabular-nums">
                        {Math.round(s.latest_eui)} kWh/m²
                      </span>
                      {crremTarget != null && (
                        <span className={`text-xxs font-medium ${
                          s.latest_eui <= crremTarget ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {s.latest_eui <= crremTarget
                            ? '✓ On target'
                            : `+${Math.round(s.latest_eui - crremTarget)} over`}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
