/**
 * InformationModule.jsx — /information
 *
 * Project executive summary and metadata hub.
 * Single-column scrollable layout.
 *
 * Sections:
 *   1. Project Header (name, type, address, operator)
 *   2. Location & Climate (postcode search, weather selectors, WeatherSelector)
 *   3. Building Summary (read-only, from ProjectContext geometry)
 *   4. Occupancy (rooms, occupancy rate — editable; people/room read-only)
 *   5. Energy Data (annual totals by fuel, multi-year)
 *   6. CRREM Executive Summary (EUI + carbon trajectories, stranding year)
 *   7. Data Completeness Checklist
 *   8. Quick Actions
 */

import { useState, useContext, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine,
} from 'recharts'
import {
  CheckCircle2, Circle, AlertTriangle, ChevronRight,
  Building2, Settings2, Upload, Play, GitCompare,
  TrendingDown, Plus, Trash2, ChevronDown,
} from 'lucide-react'
import { ProjectContext }    from '../../context/ProjectContext.jsx'
import { SimulationContext } from '../../context/SimulationContext.jsx'
import WeatherSelector       from './building/WeatherSelector.jsx'

// ── Constants ──────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear()
const CHART_YEARS  = Array.from({ length: 41 }, (_, i) => 2020 + i)
const INFO_ACCENT  = '#2B2A4C' // navy

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
const FUEL_LABELS = {
  electricity: 'Electricity',
  gas: 'Gas',
  oil: 'Oil',
  lpg: 'LPG',
  biomass: 'Biomass',
  district_heating: 'District Heat',
}
const EXTRA_FUELS = ['oil', 'lpg', 'biomass', 'district_heating']

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

function CheckItem({ done, warning, label, sub, href }) {
  const icon = warning
    ? <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
    : done
      ? <CheckCircle2 size={14} className="text-green-600 flex-shrink-0 mt-0.5" />
      : <Circle size={14} className="text-light-grey flex-shrink-0 mt-0.5" />
  const inner = (
    <div className={`flex items-start gap-2.5 py-1.5 px-2 rounded-lg ${href ? 'hover:bg-off-white' : ''}`}>
      {icon}
      <div>
        <p className={`text-caption ${done || warning ? 'text-dark-grey' : 'text-mid-grey'}`}>{label}</p>
        {sub && <p className="text-xxs text-mid-grey mt-0.5">{sub}</p>}
      </div>
    </div>
  )
  return href ? <Link to={href} className="block">{inner}</Link> : <div>{inner}</div>
}

// ── CRREM mini-chart ──────────────────────────────────────────────────────────

function CRREMMiniChart({ euiTargets, carbonTargets, actualDataPoints, modelledEui, modelledFuels, gia }) {
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
    tick: { fontSize: 9, fill: '#9CA3AF' },
    tickLine: false,
    axisLine: false,
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* EUI chart */}
      <div>
        <p className="text-xxs font-medium text-mid-grey mb-2 uppercase tracking-wider">EUI — kWh/m²</p>
        <div className="h-[180px]">
          <ComposedChart width={340} height={180} data={euiData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
            <XAxis dataKey="year" {...axisProps} tickCount={5} tickFormatter={y => y % 10 === 0 ? y : ''} />
            <YAxis {...axisProps} domain={[0, 'dataMax']} />
            <Tooltip contentStyle={{ fontSize: 10, padding: '4px 8px', borderRadius: 4 }} />
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

      {/* Carbon chart */}
      <div>
        <p className="text-xxs font-medium text-mid-grey mb-2 uppercase tracking-wider">Carbon — kgCO₂e/m²</p>
        <div className="h-[180px]">
          <ComposedChart width={340} height={180} data={carbonData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
            <XAxis dataKey="year" {...axisProps} tickCount={5} tickFormatter={y => y % 10 === 0 ? y : ''} />
            <YAxis {...axisProps} domain={[0, 'dataMax']} />
            <Tooltip contentStyle={{ fontSize: 10, padding: '4px 8px', borderRadius: 4 }} />
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

// ── Energy data section ───────────────────────────────────────────────────────

const BLANK_YEAR_ENTRY = { electricity: '', gas: '', extraFuels: {} }

function EnergyDataSection({ projectId, euiTargets, gia, onDataChange }) {
  const [rows, setRows]       = useState({})  // { [year]: { electricity, gas, extraFuels: {} } }
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(null) // year that was just saved

  // Load existing consumption datasets on mount
  useEffect(() => {
    if (!projectId) return
    fetch(`/api/projects/${projectId}/consumption`)
      .then(r => r.ok ? r.json() : { datasets: [] })
      .then(data => {
        const datasets = data.datasets ?? []
        // Group by year
        const byYear = {}
        for (const ds of datasets) {
          const yr = Number(ds.data_start?.slice(0, 4))
          if (!yr || isNaN(yr)) continue
          if (!byYear[yr]) byYear[yr] = { electricity: '', gas: '', extraFuels: {} }
          const fuel = ds.fuel_type?.toLowerCase()
          const kwh = Math.round(ds.total_kwh ?? 0)
          if (fuel === 'electricity') byYear[yr].electricity = kwh > 0 ? String(kwh) : ''
          else if (fuel === 'gas')    byYear[yr].gas = kwh > 0 ? String(kwh) : ''
          else if (EXTRA_FUELS.includes(fuel) && kwh > 0) byYear[yr].extraFuels[fuel] = String(kwh)
        }
        if (Object.keys(byYear).length > 0) {
          setRows(byYear)
        } else {
          // Pre-populate with Bridgewater data as a starting point
          setRows({
            2022: { electricity: '600700', gas: '129391', extraFuels: {} },
            2023: { electricity: '578585', gas: '262155', extraFuels: {} },
            2024: { electricity: '546128', gas: '202801', extraFuels: {} },
            2025: { electricity: '572447', gas: '207686', extraFuels: {} },
          })
        }
      })
      .catch(() => {})
  }, [projectId])

  function addYear() {
    const existingYears = Object.keys(rows).map(Number)
    const newYear = existingYears.length > 0 ? Math.max(...existingYears) + 1 : CURRENT_YEAR
    setRows(r => ({ ...r, [newYear]: { electricity: '', gas: '', extraFuels: {} } }))
  }

  function removeYear(yr) {
    setRows(r => { const n = { ...r }; delete n[yr]; return n })
  }

  function updateRow(yr, field, value) {
    setRows(r => ({ ...r, [yr]: { ...r[yr], [field]: value } }))
  }

  function updateExtraFuel(yr, fuel, value) {
    setRows(r => ({
      ...r,
      [yr]: { ...r[yr], extraFuels: { ...r[yr].extraFuels, [fuel]: value } }
    }))
  }

  function addExtraFuel(yr, fuel) {
    setRows(r => ({
      ...r,
      [yr]: { ...r[yr], extraFuels: { ...r[yr].extraFuels, [fuel]: '' } }
    }))
  }

  function removeExtraFuel(yr, fuel) {
    setRows(r => {
      const ef = { ...r[yr].extraFuels }
      delete ef[fuel]
      return { ...r, [yr]: { ...r[yr], extraFuels: ef } }
    })
  }

  async function saveYear(yr) {
    if (!projectId) return
    const row = rows[yr] ?? {}
    const fuels = []
    const elec = parseFloat(row.electricity)
    if (!isNaN(elec) && elec > 0) fuels.push({ type: 'electricity', kwh: elec, source: 'invoice' })
    const gas = parseFloat(row.gas)
    if (!isNaN(gas) && gas > 0)   fuels.push({ type: 'gas', kwh: gas, source: 'invoice' })
    for (const [fuel, val] of Object.entries(row.extraFuels ?? {})) {
      const v = parseFloat(val)
      if (!isNaN(v) && v > 0) fuels.push({ type: fuel, kwh: v, source: 'invoice' })
    }
    if (fuels.length === 0) return
    setSaving(true)
    try {
      await fetch(`/api/projects/${projectId}/consumption/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: yr, fuels, gia_m2: gia }),
      })
      setSaved(yr)
      setTimeout(() => setSaved(null), 2000)
      onDataChange?.()
    } catch { /* silent */ } finally { setSaving(false) }
  }

  const sortedYears = Object.keys(rows).map(Number).sort((a, b) => a - b)

  return (
    <div className="space-y-4">
      {sortedYears.map(yr => {
        const row = rows[yr]
        const elecKwh = parseFloat(row.electricity) || 0
        const gasKwh  = parseFloat(row.gas) || 0
        const extraKwh = Object.values(row.extraFuels).reduce((s, v) => s + (parseFloat(v) || 0), 0)
        const totalKwh = elecKwh + gasKwh + extraKwh
        const eui = gia > 0 && totalKwh > 0 ? Math.round(totalKwh / gia) : null
        const crremTarget = euiTargets ? interpolate(euiTargets, yr) : null
        const gap = eui != null && crremTarget != null ? eui - crremTarget : null
        const statusColor = gap == null ? '#95A5A6' : gap <= 0 ? '#16A34A' : gap <= 30 ? '#D97706' : '#DC2626'
        const statusLabel = gap == null ? null : gap <= 0 ? 'ALIGNED' : 'ABOVE TARGET'
        const usedExtraFuels = Object.keys(row.extraFuels ?? {})
        const availableExtraFuels = EXTRA_FUELS.filter(f => !usedExtraFuels.includes(f))

        return (
          <div key={yr} className="border border-light-grey rounded-xl overflow-hidden">
            {/* Year header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-off-white border-b border-light-grey">
              <span className="text-caption font-semibold text-navy">{yr}</span>
              <div className="flex items-center gap-3">
                {eui != null && (
                  <span className="text-xs font-bold tabular-nums" style={{ color: statusColor }}>
                    {eui} kWh/m²
                    {statusLabel && <span className="ml-1.5 text-xxs font-medium opacity-80">{statusLabel}</span>}
                  </span>
                )}
                <button
                  onClick={() => saveYear(yr)}
                  disabled={saving}
                  className="text-xxs px-2.5 py-1 rounded-lg text-white transition-colors"
                  style={{ backgroundColor: saved === yr ? '#16A34A' : INFO_ACCENT }}
                >
                  {saved === yr ? '✓ Saved' : 'Save'}
                </button>
                <button onClick={() => removeYear(yr)} className="text-mid-grey hover:text-red-500 transition-colors">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* Inputs */}
            <div className="p-4 space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">Electricity (kWh)</label>
                  <input
                    type="number" min={0} step={1}
                    value={row.electricity}
                    onChange={e => updateRow(yr, 'electricity', e.target.value)}
                    className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal bg-white"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">Gas (kWh)</label>
                  <input
                    type="number" min={0} step={1}
                    value={row.gas}
                    onChange={e => updateRow(yr, 'gas', e.target.value)}
                    className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal bg-white"
                    placeholder="0"
                  />
                </div>
              </div>

              {/* Extra fuels */}
              {usedExtraFuels.map(fuel => (
                <div key={fuel} className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">{FUEL_LABELS[fuel]} (kWh)</label>
                    <input
                      type="number" min={0} step={1}
                      value={row.extraFuels[fuel]}
                      onChange={e => updateExtraFuel(yr, fuel, e.target.value)}
                      className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal bg-white"
                      placeholder="0"
                    />
                  </div>
                  <button onClick={() => removeExtraFuel(yr, fuel)} className="mt-5 text-mid-grey hover:text-red-500 transition-colors">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}

              {/* Add fuel */}
              {availableExtraFuels.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap mt-1">
                  <span className="text-xxs text-mid-grey">+ Add fuel:</span>
                  {availableExtraFuels.map(fuel => (
                    <button
                      key={fuel}
                      onClick={() => addExtraFuel(yr, fuel)}
                      className="text-xxs px-1.5 py-0.5 rounded border border-light-grey text-mid-grey hover:text-navy hover:border-navy transition-colors"
                    >
                      {FUEL_LABELS[fuel]}
                    </button>
                  ))}
                </div>
              )}

              {/* Totals row */}
              {totalKwh > 0 && (
                <div className="pt-2 mt-2 border-t border-light-grey flex items-center gap-4 text-xxs text-mid-grey">
                  <span>Total: <span className="font-semibold text-navy">{Math.round(totalKwh).toLocaleString()} kWh</span></span>
                  {eui != null && <span>EUI: <span className="font-semibold" style={{ color: statusColor }}>{eui} kWh/m²</span></span>}
                  {gap != null && crremTarget != null && (
                    <span>CRREM {yr} target: <span className="font-semibold text-navy">{crremTarget.toFixed(0)} kWh/m²</span></span>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}

      <button
        onClick={addYear}
        className="flex items-center gap-1.5 text-caption text-mid-grey hover:text-navy transition-colors px-2 py-1"
      >
        <Plus size={14} />
        Add Year
      </button>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function InformationModule() {
  const {
    params, updateParam, currentProjectId,
    constructions, systems,
  } = useContext(ProjectContext)
  const { results, status: simStatus, runSimulation } = useContext(SimulationContext)
  const navigate = useNavigate()

  const [crremData,       setCrremData]       = useState(null)
  const [actualDatasets,  setActualDatasets]  = useState([])
  const [weatherFiles,    setWeatherFiles]    = useState([])
  const [dataVersion,     setDataVersion]     = useState(0) // bump to trigger re-fetch

  // Editable project metadata (stored in params for now)
  const address  = params?.address  ?? 'Market Way, North Petherton, TA6 6DF'
  const operator = params?.operator ?? 'Zeal Hotels'

  // Fetch on mount
  useEffect(() => {
    fetch('/api/library/benchmarks?building_type=hotel')
      .then(r => r.ok ? r.json() : { benchmarks: [] })
      .then(d => {
        const p = d.benchmarks?.find(b => b.name === 'crrem_hotel_uk_15')
        setCrremData(p?.config_json ?? null)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/weather')
      .then(r => r.ok ? r.json() : [])
      .then(setWeatherFiles)
      .catch(() => {})
  }, [])

  const loadDatasets = useCallback(() => {
    if (!currentProjectId) return
    fetch(`/api/projects/${currentProjectId}/consumption`)
      .then(r => r.ok ? r.json() : { datasets: [] })
      .then(d => setActualDatasets(d.datasets ?? []))
      .catch(() => {})
  }, [currentProjectId])

  useEffect(() => { loadDatasets() }, [loadDatasets, dataVersion])

  // ── Derived geometry ──────────────────────────────────────────────────────

  const bc = params ?? {}
  const length      = bc.length      ?? 63
  const width       = bc.width       ?? 13.4
  const numFloors   = bc.num_floors  ?? 5
  const floorHeight = bc.floor_height ?? 3.0
  const gia         = length * width * numFloors
  const vol         = gia * floorHeight
  const envelopeArea = 2 * (length + width) * numFloors * floorHeight
  const roofArea    = length * width
  const glazingArea = Object.values(bc.wwr ?? {}).reduce((s, v) => {
    return s + (envelopeArea / 4) * (v ?? 0.25)
  }, 0)

  // ── Derived occupancy ─────────────────────────────────────────────────────

  const numBedrooms  = bc.num_bedrooms    ?? 134
  const occRate      = bc.occupancy_rate  ?? 0.75
  const peoplePerRm  = bc.people_per_room ?? 1.5
  const avgOccupants = numBedrooms * occRate * peoplePerRm
  const occDensity   = gia > 0 ? avgOccupants / gia : 0

  // ── CRREM data ────────────────────────────────────────────────────────────

  const euiTargets    = crremData?.eui_targets    ?? {}
  const carbonTargets = crremData?.carbon_targets ?? {}

  // Group actual datasets by year
  const dataByYear = {}
  for (const ds of actualDatasets) {
    const yr   = Number(ds.data_start?.slice(0, 4))
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
            electricityKwh: fuels.electricity,
            gasKwh:         fuels.gas,
            carbonPerM2:    Number((carbonTotal / gia).toFixed(1)),
          }
        })
        .sort((a, b) => a.year - b.year)
    : []

  const latestActual = actualDataPoints.at(-1) ?? null

  // Modelled values from SimulationContext
  const modelledEui = simStatus === 'complete' && results
    ? (results.summary?.eui_kWh_per_m2 ?? results.results_summary?.eui_kWh_per_m2 ?? null)
    : null
  const fs = results?.fuel_split
  const modelledFuels = fs
    ? { electricity: fs.electricity_kwh ?? 0, gas: fs.natural_gas_kwh ?? 0 }
    : results?.annual_energy
      ? { electricity: results.annual_energy.electricity_kWh ?? 0, gas: results.annual_energy.gas_kWh ?? 0 }
      : null

  // Stranding year
  const projectedStranding = projectStrandingYear(actualDataPoints, euiTargets)
  const modelledStranding  = modelledEui ? findStrandingYear(modelledEui, euiTargets) : null
  const crremNow           = euiTargets ? interpolate(euiTargets, CURRENT_YEAR) : null
  const isAlreadyStranded  = latestActual && crremNow != null && latestActual.eui > crremNow

  const strandingColor = (yr) => {
    if (!yr) return '#16A34A'
    const yearsAway = yr - CURRENT_YEAR
    if (yearsAway < 0)  return '#DC2626'
    if (yearsAway <= 3) return '#DC2626'
    if (yearsAway <= 10) return '#D97706'
    return '#16A34A'
  }

  // ── Data completeness ─────────────────────────────────────────────────────

  const hasGeometry    = !!(bc.length && bc.width && bc.num_floors)
  const hasFabric      = !!(constructions?.external_wall && constructions?.roof && constructions?.glazing)
  const hasSystems     = !!(systems?.space_heating?.primary?.system)
  const hasOccupancy   = !!(bc.num_bedrooms)
  const hasSimulation  = simStatus === 'complete' && !!results
  const hasActualData  = actualDataPoints.length > 0
  const hasWeather     = bc.weather_file && bc.weather_file !== 'default'
  const weatherLat     = weatherFiles.find(f => f.filename === bc.weather_file)?.latitude ?? null
  const projLat        = bc.location?.latitude ?? null
  const weatherMismatch = weatherLat != null && projLat != null && Math.abs(weatherLat - projLat) > 3

  const selectedWeather = params?.weather_file ?? 'default'
  const selectedFuture  = params?.future_weather_file ?? ''
  const projLatVal      = params?.location?.latitude ?? 51.5

  return (
    <div className="h-full overflow-y-auto bg-off-white">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-5">

        {/* ── 1. Project Header ─────────────────────────────────────────── */}
        <SectionCard title="Project Overview">
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="flex-1 space-y-3">
                <div>
                  <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">Project Name</label>
                  <input
                    type="text"
                    value={bc.name ?? ''}
                    onChange={e => updateParam('name', e.target.value)}
                    className="w-full px-3 py-2 text-heading font-semibold text-navy border border-light-grey rounded-lg focus:outline-none focus:border-teal bg-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">Address</label>
                    <input
                      type="text"
                      value={address}
                      onChange={e => updateParam('address', e.target.value)}
                      className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">Operator</label>
                    <input
                      type="text"
                      value={operator}
                      onChange={e => updateParam('operator', e.target.value)}
                      className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal bg-white"
                    />
                  </div>
                </div>
              </div>
              <div className="flex-shrink-0">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xxs font-semibold bg-navy/10 text-navy">
                  <Building2 size={11} />
                  Hotel
                </span>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* ── 2. Location & Climate ─────────────────────────────────────── */}
        <SectionCard title="Location & Climate">
          <WeatherSelector
            currentWeatherFile={selectedWeather}
            futureWeatherFile={selectedFuture}
            weatherFiles={weatherFiles}
            onWeatherChange={filename => updateParam('weather_file', filename)}
            onFutureChange={filename => updateParam('future_weather_file', filename)}
            projectLat={projLatVal}
          />
        </SectionCard>

        {/* ── 3. Building Summary ───────────────────────────────────────── */}
        <SectionCard title="Building Summary" defaultOpen={true}>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {[
              { label: 'GIA', value: `${Math.round(gia).toLocaleString()} m²` },
              { label: 'Floors', value: numFloors },
              { label: 'Dimensions', value: `${length}m × ${width}m` },
              { label: 'Volume', value: `${Math.round(vol).toLocaleString()} m³` },
              { label: 'Envelope', value: `${Math.round(envelopeArea).toLocaleString()} m²` },
              { label: 'Glazing', value: `${Math.round(glazingArea).toLocaleString()} m²` },
            ].map(({ label, value }) => (
              <div key={label} className="bg-off-white rounded-lg p-2.5 text-center">
                <p className="text-xxs text-mid-grey mb-0.5">{label}</p>
                <p className="text-caption font-semibold text-navy">{value}</p>
              </div>
            ))}
          </div>
          <p className="text-xxs text-mid-grey mt-3">
            Edit geometry in <Link to="/building" className="underline hover:text-navy">Building →</Link>
          </p>
        </SectionCard>

        {/* ── 4. Occupancy ─────────────────────────────────────────────── */}
        <SectionCard title="Occupancy">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">Number of Rooms</label>
              <input
                type="number" min={1} max={1000} step={1}
                value={numBedrooms}
                onChange={e => updateParam('num_bedrooms', Number(e.target.value))}
                className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal bg-white"
              />
            </div>
            <div>
              <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">
                Occupancy Rate — {Math.round(occRate * 100)}%
              </label>
              <input
                type="range" min={10} max={100} step={1}
                value={Math.round(occRate * 100)}
                onChange={e => updateParam('occupancy_rate', Number(e.target.value) / 100)}
                className="w-full h-[3px] accent-navy mt-3"
              />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3 mt-4">
            {[
              { label: 'People/room', value: peoplePerRm.toFixed(1), note: 'See Profiles' },
              { label: 'Avg occupants', value: Math.round(avgOccupants) },
              { label: 'Occ. density', value: `${occDensity.toFixed(3)} p/m²` },
              { label: 'Total rooms', value: numBedrooms },
            ].map(({ label, value, note }) => (
              <div key={label} className="bg-off-white rounded-lg p-2.5">
                <p className="text-xxs text-mid-grey">{label}</p>
                <p className="text-caption font-semibold text-navy">{value}</p>
                {note && <p className="text-xxs text-mid-grey mt-0.5">{note}</p>}
              </div>
            ))}
          </div>
          <p className="text-xxs text-mid-grey mt-2">
            People per room and schedule profiles are adjusted in <Link to="/profiles" className="underline hover:text-navy">Profiles →</Link>
          </p>
        </SectionCard>

        {/* ── 5. Energy Data ────────────────────────────────────────────── */}
        <SectionCard title="Energy Data — Annual Consumption">
          <EnergyDataSection
            projectId={currentProjectId}
            euiTargets={euiTargets}
            gia={gia}
            onDataChange={() => setDataVersion(v => v + 1)}
          />
        </SectionCard>

        {/* ── 6. CRREM Executive Summary ────────────────────────────────── */}
        <SectionCard title="CRREM Executive Summary">
          {!crremData ? (
            <p className="text-xxs text-mid-grey">CRREM data not available — restart the backend.</p>
          ) : (
            <div className="space-y-4">
              {/* Stranding banner */}
              {isAlreadyStranded ? (
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
              ) : null}

              {/* Charts */}
              <CRREMMiniChart
                euiTargets={euiTargets}
                carbonTargets={carbonTargets}
                actualDataPoints={actualDataPoints}
                modelledEui={modelledEui}
                modelledFuels={modelledFuels}
                gia={gia}
              />

              {/* Stats row */}
              <div className="grid grid-cols-4 gap-3">
                {latestActual && (
                  <div className="bg-red-50 rounded-lg p-2.5 text-center">
                    <p className="text-xxs text-mid-grey">Actual EUI {latestActual.year}</p>
                    <p className="text-caption font-bold text-red-700">{latestActual.eui}</p>
                    <p className="text-xxs text-mid-grey">kWh/m²</p>
                  </div>
                )}
                {modelledEui && (
                  <div className="bg-navy/5 rounded-lg p-2.5 text-center">
                    <p className="text-xxs text-mid-grey">Modelled EUI</p>
                    <p className="text-caption font-bold text-navy">{Math.round(modelledEui)}</p>
                    <p className="text-xxs text-mid-grey">kWh/m²</p>
                  </div>
                )}
                {crremNow && (
                  <div className="bg-off-white rounded-lg p-2.5 text-center">
                    <p className="text-xxs text-mid-grey">CRREM {CURRENT_YEAR}</p>
                    <p className="text-caption font-bold text-dark-grey">{crremNow.toFixed(0)}</p>
                    <p className="text-xxs text-mid-grey">kWh/m²</p>
                  </div>
                )}
                {(projectedStranding || modelledStranding) && (
                  <div className="rounded-lg p-2.5 text-center"
                    style={{ backgroundColor: strandingColor(projectedStranding ?? modelledStranding) + '10' }}>
                    <p className="text-xxs text-mid-grey">Stranding year</p>
                    <p className="text-caption font-bold"
                      style={{ color: strandingColor(projectedStranding ?? modelledStranding) }}>
                      {projectedStranding ?? modelledStranding}
                    </p>
                    <p className="text-xxs text-mid-grey">{projectedStranding ? 'projected' : 'modelled'}</p>
                  </div>
                )}
              </div>

              <p className="text-xxs text-mid-grey">
                Full CRREM analysis in <Link to="/results" className="underline hover:text-navy">Results →</Link>
              </p>
            </div>
          )}
        </SectionCard>

        {/* ── 7. Data Completeness ──────────────────────────────────────── */}
        <SectionCard title="Data Completeness">
          <div className="space-y-0.5">
            <CheckItem done={hasGeometry} label="Building geometry defined"
              sub={hasGeometry ? `${length}m × ${width}m × ${numFloors} fl — ${Math.round(gia).toLocaleString()} m² GIA` : 'Define in Building module'}
              href="/building" />
            <CheckItem done={hasFabric} label="Fabric constructions assigned"
              sub={hasFabric ? 'Wall, roof, floor and glazing selected' : 'Assign constructions in Building module'}
              href="/building" />
            <CheckItem done={hasSystems} label="Systems configured"
              sub={hasSystems ? systems.space_heating.primary.system.replace(/_/g, ' ') : 'Configure in Systems module'}
              href="/systems" />
            <CheckItem done={hasOccupancy} label="Occupancy set"
              sub={hasOccupancy ? `${numBedrooms} rooms · ${Math.round(occRate * 100)}% occupancy` : 'Set above'} />
            <CheckItem done={hasActualData} label="Energy consumption data"
              sub={hasActualData ? `${actualDataPoints.length} year${actualDataPoints.length !== 1 ? 's' : ''} of data` : 'Enter annual totals above'} />
            <CheckItem done={hasSimulation} label="EnergyPlus simulation run"
              sub={hasSimulation ? `EUI: ${Math.round(modelledEui ?? 0)} kWh/m²` : 'Run simulation from top bar'}
              href="/results" />
            <CheckItem
              done={hasWeather && !weatherMismatch}
              warning={weatherMismatch}
              label={`Weather file: ${hasWeather ? (weatherFiles.find(f => f.filename === bc.weather_file)?.city ?? bc.weather_file) : 'Not set'}`}
              sub={weatherMismatch ? 'Weather file location does not match building — update above' : hasWeather ? 'Current climate file assigned' : 'Find nearest station above'}
            />
          </div>
        </SectionCard>

        {/* ── 8. Quick Actions ─────────────────────────────────────────── */}
        <SectionCard title="Quick Actions">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { icon: Building2, label: 'Edit Fabric', to: '/building' },
              { icon: Settings2, label: 'Edit Systems', to: '/systems' },
              { icon: Upload,    label: 'Upload Energy Data', to: '/consumption' },
              { icon: GitCompare, label: 'Compare Scenarios', to: '/scenarios' },
              { icon: ChevronRight, label: 'View Full Results', to: '/results' },
            ].map(({ icon: Icon, label, to }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-light-grey bg-white hover:border-navy/30 hover:bg-off-white transition-all text-caption text-dark-grey"
              >
                <Icon size={14} className="text-mid-grey" />
                {label}
              </Link>
            ))}
            <button
              onClick={() => runSimulation?.()}
              disabled={simStatus === 'running'}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-navy/20 bg-navy text-white text-caption hover:bg-navy/90 transition-colors disabled:opacity-60"
            >
              <Play size={14} />
              {simStatus === 'running' ? 'Running…' : 'Run Simulation'}
            </button>
          </div>
        </SectionCard>

      </div>
    </div>
  )
}
