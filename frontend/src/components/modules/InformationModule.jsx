/**
 * InformationModule.jsx — /information
 *
 * Background metadata about the project, plus thin read-only summary cards
 * for each input module.
 *
 * Edits live ONLY here:
 *   - Project name, address, postcode, building type   (params)
 *   - Location & climate (postcode-driven station search via WeatherSelector)
 *
 * Everything else is read-only with an "Edit in [Module] →" link:
 *   - Building summary (geometry + fabric)            → /building
 *   - Systems summary (HVAC, DHW, ventilation)        → /systems
 *   - Internal gains & occupancy                      → /gains
 *   - Consumption summary (years, kWh, fuels)         → /consumption
 *   - Simulation status                               → /results
 *
 * Bottom: compact "Ready to simulate?" checklist.
 *
 * CRREM analysis lives in its own module (/crrem). Energy data entry and
 * upload live in /consumption.
 */

import { useState, useContext, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckCircle2, Circle, AlertTriangle, ChevronDown, ChevronRight,
  Building2, Settings2, Clock, FileSpreadsheet, BarChart3,
} from 'lucide-react'
import { ProjectContext }    from '../../context/ProjectContext.jsx'
import { SimulationContext } from '../../context/SimulationContext.jsx'
import WeatherSelector       from './building/WeatherSelector.jsx'
import { readProjectDefault } from '../../utils/costReads.js'

// ── Constants ──────────────────────────────────────────────────────────────────

// Project-level cost defaults, edited here and read everywhere via costReads.
const TARIFF_FIELDS = [
  { key: 'electricity_price_per_kWh', label: 'Electricity', unit: '£/kWh', step: 0.01 },
  { key: 'gas_price_per_kWh',         label: 'Gas',         unit: '£/kWh', step: 0.01 },
]
const ONCOST_FIELDS = [
  { key: 'design_fees_pct', label: 'Design fees' },
  { key: 'prelims_pct',     label: 'Prelims' },
  { key: 'ohp_pct',         label: 'OHP' },
  { key: 'contingency_pct', label: 'Contingency' },
  { key: 'inflation_pct',   label: 'Inflation' },
]

const BUILDING_TYPES = [
  '', 'Hotel', 'Office', 'Retail', 'Education', 'Healthcare',
  'Mixed-use', 'Residential', 'Industrial', 'Other',
]

// ── Shared UI ─────────────────────────────────────────────────────────────────

function SectionCard({ title, children, defaultOpen = true, action }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white rounded-xl border border-light-grey overflow-hidden">
      <div
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-off-white/50 transition-colors cursor-pointer"
        onClick={() => setOpen(o => !o)}
        style={{ borderBottom: open ? '1px solid #E5E7EB' : 'none' }}
      >
        <span className="text-caption font-semibold text-navy">{title}</span>
        <div className="flex items-center gap-3">
          {action}
          <ChevronDown
            size={14}
            className="text-mid-grey transition-transform"
            style={{ transform: open ? 'rotate(180deg)' : 'none' }}
          />
        </div>
      </div>
      {open && <div className="px-5 py-4">{children}</div>}
    </div>
  )
}

function SummaryCard({ title, icon: Icon, accent, to, stats, footnote }) {
  return (
    <Link
      to={to}
      className="block bg-white rounded-xl border border-light-grey hover:border-navy/30 hover:shadow-sm transition-all overflow-hidden"
    >
      <div className="px-5 py-3.5 flex items-center justify-between border-b border-light-grey">
        <div className="flex items-center gap-2.5">
          <span
            className="inline-flex items-center justify-center rounded-md w-7 h-7"
            style={{ backgroundColor: accent + '15', color: accent }}
          >
            <Icon size={14} />
          </span>
          <span className="text-caption font-semibold text-navy">{title}</span>
        </div>
        <ChevronRight size={14} className="text-mid-grey" />
      </div>
      <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map(({ label, value, sub }) => (
          <div key={label}>
            <p className="text-xxs uppercase tracking-wider text-mid-grey">{label}</p>
            <p className="text-caption font-semibold text-navy mt-0.5">{value ?? '—'}</p>
            {sub && <p className="text-xxs text-mid-grey mt-0.5">{sub}</p>}
          </div>
        ))}
      </div>
      {footnote && (
        <div className="px-5 pb-3 text-xxs text-mid-grey">{footnote}</div>
      )}
    </Link>
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

// ── Main component ─────────────────────────────────────────────────────────────

export default function InformationModule() {
  const { params, updateParam, currentProjectId, constructions, systems } = useContext(ProjectContext)
  const { results, status: simStatus } = useContext(SimulationContext)

  // Project cost defaults (tariffs + on-cost %s). Blank → drop the key so the
  // library floor applies; a number wins over it (costReads.readProjectDefault).
  const costDefaults = params?.cost_defaults ?? {}
  const setCostDefault = useCallback((key, raw) => {
    const next = { ...(params?.cost_defaults ?? {}) }
    if (raw === '' || raw == null || !Number.isFinite(Number(raw))) delete next[key]
    else next[key] = Number(raw)
    updateParam('cost_defaults', next)
  }, [params?.cost_defaults, updateParam])

  const [datasets,     setDatasets]     = useState([])
  const [weatherFiles, setWeatherFiles] = useState([])

  // Editable project metadata (lives in building_config until we add a separate metadata column)
  const name         = params?.name          ?? ''
  const address      = params?.address       ?? ''
  const postcode     = params?.postcode      ?? ''
  const buildingType = params?.building_type ?? ''

  // ── Fetch consumption datasets + weather files on mount / project change
  const loadDatasets = useCallback(() => {
    if (!currentProjectId) return
    fetch(`/api/projects/${currentProjectId}/consumption`)
      .then(r => r.ok ? r.json() : { datasets: [] })
      .then(d => setDatasets(d.datasets ?? []))
      .catch(() => {})
  }, [currentProjectId])

  useEffect(() => { loadDatasets() }, [loadDatasets])

  useEffect(() => {
    fetch('/api/weather')
      .then(r => r.ok ? r.json() : [])
      .then(setWeatherFiles)
      .catch(() => {})
  }, [])

  // ── Derived geometry summary
  const length      = params?.length       ?? 0
  const width       = params?.width        ?? 0
  const numFloors   = params?.num_floors   ?? 0
  const floorHeight = params?.floor_height ?? 0
  const gia         = length * width * numFloors
  const envelopeArea = 2 * (length + width) * numFloors * floorHeight
  const glazingArea  = Object.values(params?.wwr ?? {}).reduce(
    (s, v) => s + (envelopeArea / 4) * (v ?? 0), 0
  )
  const avgWWR = Object.values(params?.wwr ?? {}).length > 0
    ? Object.values(params.wwr).reduce((s, v) => s + (v ?? 0), 0) / Object.values(params.wwr).length
    : 0

  // ── Derived occupancy summary (read-only)
  //
  // Brief 72 P3 (2026-05-29): density.value replaces the retired
  // `people_per_room`. Read site mirrors the engine's unified
  // computeTotalOccupants helper for per_room basis (the basis on which
  // num_bedrooms is meaningful as a multiplier). Per_m2 projects fall
  // back to a placeholder — InformationModule's summary card just shows
  // a dash for those because the density.value lives in different units.
  const numBedrooms  = params?.num_bedrooms             ?? 0
  const occRate      = params?.occupancy?.occupancy_rate ?? params?.occupancy_rate ?? 0
  const occBasis     = params?.occupancy?.density?.basis ?? 'per_room'
  const density      = params?.occupancy?.density?.value ?? 0
  const avgOccupants = occBasis === 'per_room'
    ? Math.round(numBedrooms * occRate * density)
    : null

  // ── Derived consumption summary
  const yearsInData = new Set(
    datasets.map(d => Number(d.data_start?.slice(0, 4))).filter(y => y && !isNaN(y))
  )
  const totalKwh = datasets.reduce((s, d) => s + (d.total_kwh ?? 0), 0)
  const fuelsCovered = new Set(datasets.map(d => d.fuel_type?.toLowerCase()).filter(Boolean))

  // ── Simulation status
  const modelledEui = simStatus === 'complete' && results
    ? (results.summary?.eui_kWh_per_m2 ?? results.results_summary?.eui_kWh_per_m2 ?? null)
    : null
  const lastRunAt = results?.created_at ?? results?.run_id

  // ── Systems summary helpers
  const sysLabel = (path) => {
    const v = path?.primary?.system
    return v ? v.replace(/_/g, ' ') : '—'
  }

  // ── Data completeness
  const hasGeometry   = !!(length && width && numFloors)
  const hasFabric     = !!(constructions?.external_wall && constructions?.roof && constructions?.glazing)
  const hasSystems    = !!(systems?.space_heating?.primary?.system)
  const hasOccupancy  = !!(numBedrooms)
  const hasSimulation = simStatus === 'complete' && !!results
  const hasActualData = datasets.length > 0
  const hasWeather    = params?.weather_file && params.weather_file !== 'default'
  const hasMetadata   = !!(name && buildingType)
  const weatherEntry  = weatherFiles.find(f => f.filename === params?.weather_file) ?? null
  const projLat       = params?.location?.latitude ?? null
  const weatherMismatch = weatherEntry?.latitude != null && projLat != null
    && Math.abs(weatherEntry.latitude - projLat) > 3

  return (
    <div className="h-full overflow-y-auto bg-off-white">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-5">

        {/* ── Project Overview ──────────────────────────────────────── */}
        <SectionCard title="Project Overview">
          <div className="space-y-4">
            <div>
              <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">Project Name</label>
              <input
                type="text"
                value={name}
                onChange={e => updateParam('name', e.target.value)}
                className="w-full px-3 py-2 text-heading font-semibold text-navy border border-light-grey rounded-lg focus:outline-none focus:border-teal bg-white"
                placeholder="Untitled project"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={e => updateParam('address', e.target.value)}
                  className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal bg-white"
                  placeholder="Street, town/city"
                />
              </div>
              <div>
                <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">Postcode</label>
                <input
                  type="text"
                  value={postcode}
                  onChange={e => updateParam('postcode', e.target.value.toUpperCase())}
                  className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal bg-white font-mono"
                  placeholder="SW1A 1AA"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">Building Type</label>
                <select
                  value={buildingType}
                  onChange={e => updateParam('building_type', e.target.value)}
                  className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal bg-white"
                >
                  {BUILDING_TYPES.map(t => (
                    <option key={t} value={t}>{t || '— select —'}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* ── Location & Climate ────────────────────────────────────── */}
        <SectionCard title="Location & Climate">
          <WeatherSelector
            currentWeatherFile={params?.weather_file ?? 'default'}
            futureWeatherFile={params?.future_weather_file ?? ''}
            weatherFiles={weatherFiles}
            onWeatherChange={filename => updateParam('weather_file', filename)}
            onFutureChange={filename => updateParam('future_weather_file', filename)}
            projectLat={params?.location?.latitude ?? 51.5}
          />
        </SectionCard>

        {/* ── Cost & tariffs (project-wide defaults) ────────────────── */}
        <SectionCard title="Cost & tariffs">
          <p className="text-xxs text-mid-grey mb-3">
            Project-wide defaults. Energy tariffs drive running-cost + payback figures;
            on-cost %s seed every intervention cost plan (overridable per line). Blank a
            field to fall back to the standard default.
          </p>
          <div>
            <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1.5">Energy tariffs</label>
            <div className="grid grid-cols-2 gap-3">
              {TARIFF_FIELDS.map(({ key, label, unit, step }) => (
                <div key={key}>
                  <label className="block text-xxs text-mid-grey/70 mb-1">{label}</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number" min={0} step={step}
                      value={readProjectDefault(key, costDefaults)}
                      onChange={e => setCostDefault(key, e.target.value)}
                      className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal bg-white tabular-nums"
                    />
                    <span className="text-xxs text-mid-grey/60 whitespace-nowrap">{unit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1.5">On-cost defaults (%)</label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {ONCOST_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-xxs text-mid-grey/70 mb-1">{label}</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number" min={0} step={0.5}
                      value={readProjectDefault(key, costDefaults)}
                      onChange={e => setCostDefault(key, e.target.value)}
                      className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal bg-white tabular-nums"
                    />
                    <span className="text-xxs text-mid-grey/60">%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>

        {/* ── Summary cards: read-only, link out ───────────────────── */}
        <SummaryCard
          title="Building"
          icon={Building2}
          accent="#A1887F"
          to="/building"
          stats={[
            { label: 'GIA',        value: gia ? `${Math.round(gia).toLocaleString()} m²` : null },
            { label: 'Floors',     value: numFloors || null },
            { label: 'Dimensions', value: length && width ? `${length}m × ${width}m` : null },
            { label: 'Glazing',    value: avgWWR ? `${Math.round(avgWWR * 100)}%` : null },
          ]}
          footnote={hasFabric
            ? 'Fabric constructions assigned · Edit in Building →'
            : 'Fabric not yet assigned · Edit in Building →'}
        />

        <SummaryCard
          title="Systems"
          icon={Settings2}
          accent="#00AEEF"
          to="/systems"
          stats={[
            { label: 'Heating',     value: sysLabel(systems?.space_heating) },
            { label: 'Cooling',     value: sysLabel(systems?.space_cooling) },
            { label: 'DHW',         value: sysLabel(systems?.dhw) },
            { label: 'Ventilation', value: sysLabel(systems?.ventilation) },
          ]}
          footnote="Edit in Systems →"
        />

        <SummaryCard
          title="Internal Gains & Occupancy"
          icon={Clock}
          accent="#8B5CF6"
          to="/gains"
          stats={[
            { label: 'Rooms',           value: numBedrooms || null },
            { label: 'Occupancy rate',  value: occRate ? `${Math.round(occRate * 100)}%` : null },
            // Brief 72 P3 (2026-05-29): label switched from "People / room"
            // (read of the retired `params.people_per_room` phantom) to
            // "Density" reading `params.occupancy.density.value`. Unit suffix
            // tracks the basis so per_m2 projects show "x / m²".
            { label: 'Density',         value: density ? `${density.toFixed(1)} / ${occBasis === 'per_room' ? 'room' : 'm²'}` : null },
            { label: 'Avg occupants',   value: avgOccupants || null },
          ]}
          footnote="Schedules and occupancy parameters · Edit in Internal Gains →"
        />

        <SummaryCard
          title="Consumption"
          icon={FileSpreadsheet}
          accent="#2D6A7A"
          to="/consumption"
          stats={[
            { label: 'Years of data', value: yearsInData.size || null },
            { label: 'Total energy',  value: totalKwh ? `${Math.round(totalKwh / 1000).toLocaleString()} MWh` : null },
            { label: 'Fuels',         value: fuelsCovered.size || null },
            { label: 'Datasets',      value: datasets.length || null },
          ]}
          footnote={hasActualData
            ? 'Measured consumption present · Edit in Consumption →'
            : 'No measured data yet · Upload or enter manually in Consumption →'}
        />

        <SummaryCard
          title="Dynamic simulation"
          icon={BarChart3}
          accent="#2B2A4C"
          to="/results"
          stats={[
            { label: 'Status',        value: hasSimulation ? 'Complete' : (simStatus === 'running' ? 'Running…' : 'Not run') },
            { label: 'Modelled EUI',  value: modelledEui ? `${Math.round(modelledEui)} kWh/m²` : null },
            { label: 'Last run',      value: lastRunAt ? String(lastRunAt).slice(0, 10) : null },
          ]}
          footnote="Run from the top bar · View Results →"
        />

        {/* ── Ready-to-simulate footer ─────────────────────────────── */}
        <SectionCard title="Ready to simulate?">
          <div className="space-y-0.5">
            <CheckItem done={hasMetadata} label="Project metadata"
              sub={hasMetadata ? `${buildingType} — ${address || 'no address'}` : 'Set name and building type above'} />
            <CheckItem done={hasGeometry} label="Building geometry"
              sub={hasGeometry ? `${length}m × ${width}m × ${numFloors} fl — ${Math.round(gia).toLocaleString()} m²` : 'Define in Building module'}
              href="/building" />
            <CheckItem done={hasFabric} label="Fabric constructions"
              sub={hasFabric ? 'Wall, roof, floor and glazing assigned' : 'Assign in Building module'}
              href="/building" />
            <CheckItem done={hasSystems} label="Systems configured"
              sub={hasSystems ? sysLabel(systems?.space_heating) : 'Configure in Systems module'}
              href="/systems" />
            <CheckItem done={hasOccupancy} label="Occupancy set"
              sub={hasOccupancy ? `${numBedrooms} rooms · ${Math.round(occRate * 100)}% occupancy` : 'Set in Internal Gains module'}
              href="/gains" />
            <CheckItem
              done={hasWeather && !weatherMismatch}
              warning={weatherMismatch}
              label={`Weather file: ${hasWeather ? (weatherEntry?.city ?? params.weather_file) : 'Not set'}`}
              sub={weatherMismatch ? 'Weather file location does not match building' : hasWeather ? 'Current climate file assigned' : 'Find nearest station above'}
            />
            <CheckItem done={hasActualData} label="Energy consumption data"
              sub={hasActualData ? `${yearsInData.size} year${yearsInData.size !== 1 ? 's' : ''} of data` : 'Upload or enter in Consumption module'}
              href="/consumption" />
            <CheckItem done={hasSimulation} label="Dynamic run"
              sub={hasSimulation ? `Modelled EUI: ${Math.round(modelledEui ?? 0)} kWh/m²` : 'Run from the top bar'}
              href="/results" />
          </div>
        </SectionCard>

        {/* Brief 32 Part 1 (2026-05-18): Engine status footnote.
            Visually quiet — smaller text, no accent — per §1.4. The
            wording is reproduced verbatim from the brief. Restore /
            update copy when Brief 30 closes and Dynamic returns. */}
        <div className="pt-2 pb-4">
          <p className="text-xxs text-mid-grey italic leading-relaxed max-w-3xl">
            <span className="not-italic font-medium text-mid-grey">Engine status — </span>
            Dynamic engine (EnergyPlus-direct) is under reconstruction (Brief 30).
            Current displayed numbers are from the Static engine. The Dynamic engine
            will return in a future release with full per-element heat balance read
            directly from EnergyPlus outputs.
          </p>
        </div>

      </div>
    </div>
  )
}
