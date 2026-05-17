/**
 * OperationModule.jsx — /operation
 *
 * Brief 28-IM Gate IM-M3: full three-column rewrite matching the Building
 * tab reference layout (BuildingDefinition.jsx).
 *
 *   Left   — operable-openings list (add buttons + per-opening editor)
 *   Centre — view switcher: Heat Balance | Profiles | Schedule | Monthly | Summary
 *   Right  — 3D viewer (reuses BuildingViewer3D)
 *
 * Module ownership (Brief 28-IM §3): Operation owns natural ventilation. The
 * Heat Balance tab passes modules including 'natural_ventilation' so the
 * shared HeatBalance component renders only the categories this tab is
 * responsible for (fabric + leakage + permanent vents + thermal bridging +
 * internal gains + natural-vent per-opening lines).
 *
 * 3D viewer extension (Brief 28-IM §15.2 fallback): per-facade hover/click
 * raycast is queued; for IM-M3 the "+ Door / + Window / + Vent" buttons
 * trigger an inline F1/F2/F3/F4 facade-select chip strip (covers the spec
 * intent — user picks where the opening attaches — without the deep Three.js
 * raycast wiring that's blocked here). The 3D viewer itself is unmodified.
 *
 * Brief 28e Gate E5a (preserved): operable openings as first-class envelope
 * features. Each entry is a door / window bank / vent with three control
 * modes (permanent / scheduled / temperature) and its own physics (area,
 * height, Cd, Cw — see Brief 28e §A.1).
 *
 * Reads / writes:
 *   params.operable_openings         (Brief 28e native array)
 *   params.openings.*                (LEGACY — synthesise→convert flow only)
 */

import { useContext, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ProjectContext } from '../../context/ProjectContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { WeatherContext } from '../../context/WeatherContext.jsx'
import { useHourlySolar } from '../../hooks/useHourlySolar.js'
import { calculateInstant, synthesiseOperableOpeningsFromLegacy } from '../../utils/instantCalc.js'
import { SCHEDULES, allScheduleNames } from '../../utils/scheduleLibrary.js'
import BuildingViewer3D from './building/BuildingViewer3D.jsx'
import HeatBalance from './balance/HeatBalance.jsx'
import WeatherSynchronisedProfile from '../profiles/WeatherSynchronisedProfile.jsx'
import ScheduleEditor from './profiles/ScheduleEditor.jsx'
// Brief 28-IM-Polish POL-M2: shared cross-module strip + chart components.
import LiveResultsStrip from '../shared/LiveResultsStrip.jsx'
import EnginePill from '../shared/EnginePill.jsx'
import ChartTotalsBadge from '../shared/ChartTotalsBadge.jsx'
// Chris UX request (2026-05-17): diverging-bars chart shared with Building
// + Internal Gains. Operable openings now stacked on fabric loss so the
// magnitude is visible in context, not in isolation.
import DivergingMonthlyChart from '../shared/DivergingMonthlyChart.jsx'

const ACCENT = '#0E7490'  // operation theme — cyan-700

const FACADES = [
  { num: 1, key: 'north' },
  { num: 2, key: 'east'  },
  { num: 3, key: 'south' },
  { num: 4, key: 'west'  },
]
function facadeLabel(facadeNumber, orientationDeg) {
  const baseAngles = { 1: 0, 2: 90, 3: 180, 4: 270 }
  const trueAngle = (baseAngles[facadeNumber] + (orientationDeg ?? 0)) % 360
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const compass = directions[Math.round(trueAngle / 45) % 8]
  return `F${facadeNumber} (${compass})`
}
function facadeLabelByKey(key, orientationDeg) {
  const fac = FACADES.find(f => f.key === key)
  return fac ? facadeLabel(fac.num, orientationDeg) : key
}

// Schedules registered in scheduleLibrary.js (frontend) + schedules.py (backend).
const SCHEDULE_OPTIONS = [
  { value: 'always_on',                     label: 'Always open (24/7)' },
  { value: 'business_hours_09_18_weekdays', label: 'Business hours (Mon–Fri 09–18)' },
  { value: 'hotel_ventilation_occupied',    label: 'Hotel occupied (06–23 full, night 0.3)' },
  { value: 'summer_day_daytime',            label: 'Summer day (May–Sept 08–20)' },
]

const OPENING_TYPE_OPTIONS = [
  { value: 'door',   label: 'Door',   defaultArea: 4.0,  defaultHeight: 2.0, defaultCw: 0.25 },
  { value: 'window', label: 'Window', defaultArea: 1.5,  defaultHeight: 1.2, defaultCw: 0.40 },
  { value: 'vent',   label: 'Vent',   defaultArea: 0.5,  defaultHeight: 0.5, defaultCw: 0.25 },
]

// Module ownership filter — see HeatBalance.MODULE_CATEGORY_KEYS.
const MODULES_OPERATION = [
  'fabric', 'thermal_bridging', 'fabric_leakage', 'permanent_vents',
  'internal_gains', 'natural_ventilation',
]

// Centre-column tabs — Brief 28-IM §3.2 (five views).
const CENTRE_TABS = [
  { id: 'heat-balance', label: 'Heat Balance' },
  { id: 'profiles',     label: 'Profiles' },
  { id: 'schedule',     label: 'Schedule' },
  { id: 'monthly',      label: 'Monthly' },
  { id: 'summary',      label: 'Summary' },
]

// Generate a stable, human-readable id for a new opening.
function nextId(existing, type, facade) {
  const base = `${facade}_${type}`
  const seen = new Set((existing ?? []).map(o => o?.id).filter(Boolean))
  if (!seen.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${i}`
    if (!seen.has(candidate)) return candidate
  }
  return `${base}_${Date.now()}`
}

function newOpening(type, facade) {
  const t = OPENING_TYPE_OPTIONS.find(o => o.value === type) ?? OPENING_TYPE_OPTIONS[1]
  return {
    id:                    null,  // filled in by caller via nextId()
    name:                  `New ${t.label.toLowerCase()} (${facade})`,
    facade,
    area_m2:               t.defaultArea,
    height_m:              t.defaultHeight,
    discharge_coefficient: 0.6,
    wind_coefficient:      t.defaultCw,
    opening_type:          type,
    parent_glazing_face:   type === 'window' ? facade : null,
    control: {
      mode:                   'scheduled',
      schedule_ref:           'business_hours_09_18_weekdays',
      open_above_zone_c:      22.0,
      hysteresis_c:           1.0,
      require_outside_cooler: true,
    },
  }
}

/* ── Constructions library fetch (mirrors useStateComparison pattern) ──── */
let _libraryDataPromise = null
function fetchLibraryData() {
  if (_libraryDataPromise) return _libraryDataPromise
  _libraryDataPromise = fetch('/api/library/constructions')
    .then(r => r.ok ? r.json() : { constructions: [] })
    .then(data => {
      const arr = data?.constructions ?? []
      return {
        constructions: arr.map(c => ({
          name: c.name,
          u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
          y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
          config_json: c.config_json ?? c,
        })),
      }
    })
    .catch(() => ({ constructions: [] }))
  return _libraryDataPromise
}

export default function OperationModule() {
  const { params, constructions, systems, comfortBand, updateParam } = useContext(ProjectContext)
  const { weatherData } = useContext(WeatherContext)
  const { selectedOpeningId, setSelectedOpeningId, clearSelection } = useUI()

  const orientation = Number(params?.orientation ?? 0)
  const openings = useMemo(
    () => Array.isArray(params?.operable_openings) ? params.operable_openings : [],
    [params?.operable_openings],
  )

  // Brief 28-IM IM-M4 Addition 1: schedule editor modal state.
  const [editingSchedule, setEditingSchedule] = useState(null)
  const openScheduleEditor = (scheduleName) => {
    const existing = (params?.schedules ?? []).find(s => s?.name === scheduleName || s?.id === scheduleName)
    const hardcoded = SCHEDULES[scheduleName]
    const seed = existing ?? (hardcoded
      ? {
          id: scheduleName, name: scheduleName, display_name: scheduleName,
          day_types: hardcoded.day_types,
          monthly_multipliers: hardcoded.monthly_multipliers ?? Array(12).fill(1),
        }
      : { name: scheduleName, day_types: { weekday: Array(24).fill(0.5), saturday: Array(24).fill(0.5), sunday: Array(24).fill(0.5) }, monthly_multipliers: Array(12).fill(1) })
    setEditingSchedule(seed)
  }

  // Centre view switcher state (persists per-session in localStorage)
  const [centreView, setCentreView] = useState(() => {
    try {
      const saved = localStorage.getItem('nza-operation-centre')
      if (CENTRE_TABS.some(t => t.id === saved)) return saved
    } catch {}
    return 'heat-balance'
  })
  useEffect(() => {
    try { localStorage.setItem('nza-operation-centre', centreView) } catch {}
  }, [centreView])

  // Facade-select state for "+ Door / + Window / + Vent" buttons. When
  // `pendingType` is non-null, the chip row appears asking the user to
  // choose a facade. (Brief 28-IM §15.2 fallback for the 3D raycast.)
  const [pendingType, setPendingType] = useState(null)

  // Constructions library (for live engine call)
  const [libraryData, setLibraryData] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetchLibraryData().then(d => { if (!cancelled) setLibraryData(d) })
    return () => { cancelled = true }
  }, [])

  // Live engine result — Operation tab is State 2 (envelope-gains). The
  // engine returns the per-opening natural-ventilation breakdown +
  // daily_profiles inside losses_at_setpoint.
  const hourlySolar = useHourlySolar(weatherData, orientation)
  const instantResult = useMemo(() => {
    if (!params || !weatherData || !hourlySolar || !libraryData) return null
    const cb = comfortBand ?? { lower_c: 20, upper_c: 26 }
    return calculateInstant(
      { ...params, comfort_band: cb }, constructions ?? {}, systems ?? {},
      libraryData, weatherData, hourlySolar, null,
      { mode: 'envelope-gains', comfortBand: cb },
    )
  }, [params, constructions, systems, libraryData, weatherData, hourlySolar, comfortBand])

  // Detect legacy state that would synthesise something useful.
  const legacyPreview = useMemo(() => {
    if (openings.length > 0) return []
    return synthesiseOperableOpeningsFromLegacy(params ?? {})
  }, [openings.length, params])

  // ── List ops (always overwrite operable_openings wholesale) ────────────
  const writeList = (next) => updateParam('operable_openings', next)

  const addOpening = (type, facade) => {
    const entry = { ...newOpening(type, facade), id: nextId(openings, type, facade) }
    const next = [...openings, entry]
    writeList(next)
    setSelectedOpeningId(entry.id)
    setPendingType(null)
  }

  const updateOpening = (id, partial) => {
    const next = openings.map(o => o.id === id ? deepMergeOpening(o, partial) : o)
    writeList(next)
  }

  const deleteOpening = (id) => {
    const next = openings.filter(o => o.id !== id)
    writeList(next)
    if (selectedOpeningId === id) clearSelection()
  }

  const convertLegacy = () => {
    if (legacyPreview.length === 0) return
    const cleaned = legacyPreview.map(({ _synthesised_from_legacy, ...rest }) => rest)
    writeList(cleaned)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] relative">
      {/* ── Module header with operation accent ── */}
      <div
        className="flex-shrink-0 bg-white border-b border-light-grey px-6 pt-3 pb-3"
        style={{ borderTopWidth: '3px', borderTopColor: ACCENT, borderTopStyle: 'solid' }}
      >
        <NavLink to="/project" className="text-xxs text-mid-grey hover:text-navy transition-colors">
          ← Overview
        </NavLink>
        <p className="text-caption font-medium mt-0.5" style={{ color: ACCENT }}>Operation</p>
        <p className="text-xxs text-mid-grey">
          Operable openings — doors, windows, vents — each with its own
          control mode (always / scheduled / temperature) and physics. The
          centre view switcher shows heat balance, profiles, schedule, monthly
          aggregation and a summary table; the 3D viewer on the right gives
          context.
        </p>
      </div>

      {/* ── Three-column workspace ── */}
      <div className="flex-1 min-h-0 flex">

        {/* LEFT: openings list ────────────────────────────────────────── */}
        <div className="flex-shrink-0 w-[300px] bg-white border-r border-light-grey overflow-y-auto">
          <div className="p-3 space-y-3">

            {/* Legacy conversion CTA (operable_openings empty + legacy present) */}
            {openings.length === 0 && legacyPreview.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xxs font-medium text-amber-900 mb-1">
                  Legacy operable-window settings detected
                </p>
                <p className="text-xxs text-amber-800 mb-2">
                  {legacyPreview.length} synthesised{' '}
                  {legacyPreview.length === 1 ? 'entry' : 'entries'} from the
                  pre-Brief 28e per-facade <code>openable_fraction</code>:
                </p>
                <ul className="text-xxs text-amber-800 mb-2 space-y-0.5 ml-3 list-disc">
                  {legacyPreview.map(p => (
                    <li key={p.id}>
                      <span className="font-medium">{p.name}</span> — {p.area_m2.toFixed(1)} m²,
                      <code className="ml-1">{p.control.schedule_ref}</code>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={convertLegacy}
                  className="text-xxs px-2.5 py-1 rounded bg-amber-700 text-white hover:bg-amber-800 transition-colors"
                >
                  Convert to native
                </button>
              </div>
            )}

            {/* Add buttons + facade-select chip row ─────────────────── */}
            <div className="space-y-1.5">
              <p className="text-xxs uppercase tracking-wider text-mid-grey">Add opening</p>
              <div className="flex gap-1">
                {OPENING_TYPE_OPTIONS.map(t => (
                  <button
                    key={t.value}
                    onClick={() => setPendingType(p => p === t.value ? null : t.value)}
                    className={`flex-1 text-xxs px-2 py-1.5 rounded border transition-colors ${
                      pendingType === t.value
                        ? 'border-cyan-700 bg-cyan-700 text-white'
                        : 'border-cyan-700 text-cyan-700 hover:bg-cyan-50'
                    }`}
                    title={`Add a new ${t.label.toLowerCase()} — then pick a facade`}
                  >
                    + {t.label}
                  </button>
                ))}
              </div>
              {pendingType && (
                <div className="bg-cyan-50 border border-cyan-200 rounded p-2 space-y-1.5">
                  <p className="text-xxs text-cyan-900">
                    Pick the facade for the new <span className="font-medium">{pendingType}</span>:
                  </p>
                  <div className="flex gap-1">
                    {FACADES.map(f => (
                      <button
                        key={f.key}
                        onClick={() => addOpening(pendingType, f.key)}
                        className="flex-1 text-xxs px-2 py-1.5 rounded bg-white border border-cyan-700 text-cyan-700 hover:bg-cyan-100 transition-colors"
                        title={`Attach to ${facadeLabel(f.num, orientation)}`}
                      >
                        {facadeLabel(f.num, orientation)}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setPendingType(null)}
                    className="text-xxs text-mid-grey hover:text-navy underline w-full text-left"
                  >
                    cancel
                  </button>
                </div>
              )}
            </div>

            {/* Operable openings list ─────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xxs uppercase tracking-wider text-mid-grey">Openings</p>
                <span className="text-xxs text-mid-grey">
                  {openings.length === 0 ? 'none' : `${openings.length}`}
                </span>
              </div>
              {openings.length === 0 && legacyPreview.length === 0 && (
                <div className="text-xxs text-mid-grey text-center py-6 border border-dashed border-light-grey rounded-lg">
                  No openings yet — use the buttons above to add one.
                </div>
              )}
              <div className="space-y-1.5">
                {openings.map(opening => (
                  <OpeningRow
                    key={opening.id}
                    opening={opening}
                    selected={selectedOpeningId === opening.id}
                    orientation={orientation}
                    onSelect={() => setSelectedOpeningId(opening.id)}
                    onUpdate={partial => updateOpening(opening.id, partial)}
                    onDelete={() => deleteOpening(opening.id)}
                    openScheduleEditor={openScheduleEditor}
                    allSched={allScheduleNames(params)}
                  />
                ))}
              </div>
            </div>

            {/* Footer cross-reference ─────────────────────────────── */}
            <div className="text-xxs text-mid-grey/90 leading-snug pt-2 border-t border-light-grey">
              <span className="font-medium text-dark-grey">Related:</span>{' '}
              Permanent louvres + site exposure in{' '}
              <NavLink to="/building" className="text-navy underline">Building</NavLink>.
              MEV / MVHR in{' '}
              <NavLink to="/systems" className="text-navy underline">Systems</NavLink>.
            </div>
          </div>
        </div>

        {/* CENTRE: view switcher ───────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col bg-off-white">
          {/* Tab bar */}
          <div className="flex-shrink-0 flex items-center gap-0 border-b border-light-grey bg-white px-2 pt-2">
            {CENTRE_TABS.map(t => {
              const active = t.id === centreView
              return (
                <button
                  key={t.id}
                  onClick={() => setCentreView(t.id)}
                  className={`px-3 py-1.5 text-caption transition-colors border-b-2 -mb-px ${
                    active
                      ? 'border-navy text-navy font-medium'
                      : 'border-transparent text-mid-grey hover:text-navy'
                  }`}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {centreView === 'heat-balance' && (
              <HeatBalance
                liveData={instantResult?.heat_balance}
                simulationData={null}
                simulationInfo={null}
                orientationDeg={orientation}
                onElementClick={() => {}}
                mode="envelope-gains"
                modules={MODULES_OPERATION}
              />
            )}
            {centreView === 'profiles' && (
              <OperationProfilesView
                instantResult={instantResult}
                openings={openings}
                selectedOpeningId={selectedOpeningId}
              />
            )}
            {centreView === 'schedule' && (
              <OperationScheduleView openings={openings} />
            )}
            {centreView === 'monthly' && (
              <OperationMonthlyView
                instantResult={instantResult}
                openings={openings}
              />
            )}
            {centreView === 'summary' && (
              <OperationSummaryView
                instantResult={instantResult}
                openings={openings}
                orientation={orientation}
              />
            )}
          </div>
        </div>

        {/* RIGHT: 3D viewer + always-visible Live Results strip below
            (Brief 28-IM-Polish POL-M2 IA 3.2 — same pattern as Building).
            Strip KPIs per the brief mapping for Operation: Heating demand
            · Cooling demand · Total operable loss/gain · Avg open hours. */}
        <div className="flex-shrink-0 w-[420px] bg-white border-l border-light-grey flex flex-col">
          <div className="flex-shrink-0 px-3 py-2 border-b border-light-grey flex items-center justify-between">
            <p className="text-xxs uppercase tracking-wider text-mid-grey">3D viewer</p>
            <EnginePill mode="static" />
          </div>
          <div className="flex-1 min-h-0">
            <BuildingViewer3D params={params ?? {}} />
          </div>
          <div className="flex-shrink-0 px-3 py-1 border-t border-light-grey">
            <p className="text-xxs text-mid-grey">
              Per-facade hover / per-opening rectangles queued (Brief 28-IM §15.2
              fallback active: facade chip-select on +Door/+Window/+Vent above).
            </p>
          </div>
          <OperationLiveResultsStrip instantResult={instantResult} openings={openings} />
        </div>
      </div>

      {/* Brief 28-IM IM-M4 Addition 1: shared ScheduleEditor modal */}
      {editingSchedule && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center overflow-auto p-4">
          <div className="bg-white rounded-xl shadow-2xl my-4 w-full max-w-4xl">
            <ScheduleEditor
              initialSchedule={editingSchedule}
              target="project"
              onSaved={() => setTimeout(() => setEditingSchedule(null), 800)}
              onCancel={() => setEditingSchedule(null)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   CENTRE PANES — Profiles / Schedule / Monthly / Summary
   ─────────────────────────────────────────────────────────────────────── */

function OperationProfilesView({ instantResult, openings, selectedOpeningId }) {
  const dp = instantResult?.daily_profiles
  const nv = instantResult?.losses_at_setpoint?.natural_ventilation ?? []

  if (!dp) {
    return (
      <div className="h-full flex items-center justify-center text-mid-grey text-xxs">
        Profiles require engine output — load weather data.
      </div>
    )
  }
  // Pick which opening's daily loss to overlay as a line. Default to the
  // selected opening; fall back to the first one with any open-hours.
  const focusOpeningId = selectedOpeningId
    ?? (openings.find(o => (nv.find(n => n.id === o.id)?.open_hours ?? 0) > 0)?.id)
    ?? openings[0]?.id
  const focusEngine = nv.find(n => n.id === focusOpeningId)

  const losses = dp.heat_loss_kwh
  const w      = dp.weather
  const t_out_mean_c    = (w?.t_out_sum_c ?? []).map(v => v / 24)
  const wind_mean_ms    = (w?.wind_sum_ms ?? []).map(v => v / 24)
  const ghi_mean_w_m2   = (w?.ghi_sum_w_per_m2 ?? []).map(v => v / 24)

  // Stack: same fabric stack as Building Profiles, with the FOCUS opening
  // added as its own coloured stack on top (so the user can see the door
  // contribution to total daily loss).
  const stacks = [
    { key: 'wall',  label: 'External wall',    color: '#6B7280', daily_kwh: losses?.external_wall },
    { key: 'roof',  label: 'Roof',             color: '#9CA3AF', daily_kwh: losses?.roof },
    { key: 'floor', label: 'Ground floor',     color: '#D1D5DB', daily_kwh: losses?.ground_floor },
    { key: 'glaz',  label: 'Glazing',          color: '#4B5563', daily_kwh: losses?.glazing },
    { key: 'tb',    label: 'Thermal bridging', color: '#475569', daily_kwh: losses?.thermal_bridging },
    { key: 'leak',  label: 'Fabric leakage',   color: '#94A3B8', daily_kwh: losses?.fabric_leakage },
    { key: 'pvent', label: 'Permanent vents',  color: '#0891B2', daily_kwh: losses?.permanent_vents },
  ]
  if (focusEngine?.daily_heat_loss_kwh) {
    stacks.push({
      key: `nv_${focusEngine.id}`,
      label: `${focusEngine.name || focusEngine.id} (natvent)`,
      color: '#DC2626',
      daily_kwh: focusEngine.daily_heat_loss_kwh,
    })
  }

  const primary = {
    title: 'Hourly heat loss at setpoint (with operable openings)',
    unit:  'kW',
    stacks,
    lines: [],
  }

  // Brief 28-IM-Polish POL-M2: chart consistency rules — pill + totals.
  const sumArr = (a) => Array.isArray(a) ? a.reduce((s, v) => s + (v ?? 0), 0) : 0
  const totalLossKwh =
      sumArr(losses?.external_wall) + sumArr(losses?.roof) + sumArr(losses?.ground_floor)
    + sumArr(losses?.glazing) + sumArr(losses?.thermal_bridging)
    + sumArr(losses?.fabric_leakage) + sumArr(losses?.permanent_vents)
  const totalNvKwh = nv.reduce((s, n) => s + (n.heat_loss_kwh ?? 0), 0)
  const gia = instantResult?.heat_balance?.metadata?.gia_m2 ?? instantResult?.metadata?.gia_m2 ?? 0

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-shrink-0 flex items-center justify-between gap-2 px-4 pt-2 pb-1">
        <EnginePill mode="static" />
        <div className="flex items-center gap-2">
          <ChartTotalsBadge label="Σ fabric loss" value_kwh={totalLossKwh} gia_m2={gia} />
          <ChartTotalsBadge label="Σ natvent"     value_kwh={totalNvKwh}   gia_m2={gia} />
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <WeatherSynchronisedProfile
          primary={primary}
          weather={{ t_out_mean_c, wind_mean_ms, ghi_mean_w_per_m2: ghi_mean_w_m2 }}
          height={540}
          caption={
            focusEngine
              ? `Daily mean of the 8760-hour State 2 trace. The red layer is the per-opening natural-ventilation loss from ${focusEngine.name || focusEngine.id} (mode: ${focusEngine.mode}, ${focusEngine.open_hours} open-hours/yr, avg flow ${focusEngine.avg_flow_when_open_l_s} L/s when open, avg ΔT ${focusEngine.avg_dT_when_open_k} K). Click an opening in the left panel to overlay a different one.`
              : 'Add an operable opening to see its hourly contribution overlaid on the fabric stack.'
          }
        />
      </div>
    </div>
  )
}

/* ── Schedule view: weekday / saturday / sunday grids for each opening ── */
function OperationScheduleView({ openings }) {
  if (openings.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-mid-grey text-xxs">
        Add an operable opening to see its control schedule.
      </div>
    )
  }
  // Brief 28-IM-Polish POL-M2: chart consistency rules.
  const totalOpenHours = openings.reduce((s, o) => {
    const sched = SCHEDULES[o.control?.schedule_ref ?? 'always_on']
    const wkdy = sched?.day_types?.weekday ?? []
    return s + Math.round(wkdy.reduce((a, x) => a + x, 0) * 261)  // 261 weekdays
  }, 0)
  return (
    <div className="w-full h-full overflow-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-caption font-semibold text-navy">Operable opening schedules</p>
            <EnginePill mode="static" />
          </div>
          <p className="text-xxs text-mid-grey mt-0.5">
            Per-opening control mode visualised as an hour-of-day grid. Scheduled
            openings show the underlying fraction (0–1) for weekday / Saturday /
            Sunday; permanent openings show 1.0 always; temperature-triggered
            openings show the schedule that gates the temperature check (AND-combined
            with T_zone vs setpoint).
          </p>
        </div>
        <div className="text-xxs tabular-nums text-mid-grey">
          {openings.length} opening{openings.length === 1 ? '' : 's'} · ~{totalOpenHours.toLocaleString()} weekday open-hours/yr
        </div>
      </div>
      {openings.map(o => (
        <ScheduleCard key={o.id} opening={o} />
      ))}
    </div>
  )
}

function ScheduleCard({ opening }) {
  const mode = opening.control?.mode ?? 'permanent'
  const sched_name = opening.control?.schedule_ref ?? 'always_on'

  // Pull the actual day-types from scheduleLibrary so the grid matches the
  // engine's behaviour byte-for-byte.
  const sched = mode === 'permanent'
    ? SCHEDULES.always_on
    : (SCHEDULES[sched_name] ?? SCHEDULES.always_on)
  const weekday = sched?.day_types?.weekday ?? new Array(24).fill(0)
  const saturday = sched?.day_types?.saturday ?? new Array(24).fill(0)
  const sunday = sched?.day_types?.sunday ?? new Array(24).fill(0)

  return (
    <div className="bg-white border border-light-grey rounded p-3 max-w-3xl">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-caption font-medium text-navy">{opening.name || opening.id}</p>
        <span className="text-xxs text-mid-grey">
          mode: <span className="text-navy">{mode}</span>
          {' · '}schedule: <span className="text-navy">{sched_name}</span>
        </span>
      </div>
      <ScheduleGrid label="Mon–Fri" hours={weekday} />
      <ScheduleGrid label="Sat"     hours={saturday} />
      <ScheduleGrid label="Sun"     hours={sunday} />
      {mode === 'temperature' && (
        <p className="text-xxs text-amber-700 mt-2">
          Temperature gate: opens when T_zone &gt; {opening.control?.open_above_zone_c ?? 22} °C
          (hysteresis {opening.control?.hysteresis_c ?? 1} K
          {opening.control?.require_outside_cooler ? ', only if T_out cooler' : ''})
          AND the schedule fraction above is &gt; 0.
        </p>
      )}
    </div>
  )
}

function ScheduleGrid({ label, hours }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <div className="text-xxs text-mid-grey w-12 flex-shrink-0">{label}</div>
      <div className="flex-1 grid grid-cols-24 gap-px" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
        {hours.map((v, i) => {
          // Heat-map colour: 0 = pale grey, 1 = full cyan-700
          const alpha = Math.max(0, Math.min(1, v))
          return (
            <div
              key={i}
              className="h-5 rounded-sm"
              style={{
                backgroundColor: alpha > 0.01
                  ? `rgba(14, 116, 144, ${0.25 + alpha * 0.75})`
                  : '#F3F4F6',
              }}
              title={`${i.toString().padStart(2, '0')}:00 — ${(v * 100).toFixed(0)}%`}
            />
          )
        })}
      </div>
      <div className="text-xxs text-mid-grey w-8 text-right tabular-nums">
        {Math.round(hours.reduce((s, x) => s + x, 0))}h
      </div>
    </div>
  )
}

/* ── Monthly: 12 bars of per-opening + total fabric loss ───────────── */
function OperationMonthlyView({ instantResult, openings }) {
  const los = instantResult?.losses_at_setpoint
  const nv = los?.natural_ventilation ?? []
  // Chris UX request (2026-05-17): show natvent alongside fabric losses
  // (and solar gains above) so the user reads the relative magnitudes,
  // not just the operable openings in isolation. Uses the same shared
  // DivergingMonthlyChart as Building / Internal Gains.
  if (!los) {
    return (
      <div className="h-full flex items-center justify-center text-mid-grey text-xxs">
        Monthly aggregation requires engine output — load weather data.
      </div>
    )
  }

  const _z = () => new Array(12).fill(0)
  const _add = (out, arr) => { if (Array.isArray(arr)) for (let i = 0; i < 12; i++) out[i] += (arr[i] ?? 0) }

  // Fabric loss = same 7 envelope elements as Building Monthly view.
  const fabricM = _z()
  _add(fabricM, los.external_wall?.monthly_heating_loss_kwh)
  _add(fabricM, los.roof?.monthly_heating_loss_kwh)
  _add(fabricM, los.ground_floor?.monthly_heating_loss_kwh)
  _add(fabricM, los.glazing?.monthly_heating_loss_kwh)
  _add(fabricM, los.fabric_leakage?.monthly_heating_loss_kwh)
  _add(fabricM, los.permanent_vents?.monthly_heating_loss_kwh)
  _add(fabricM, los.thermal_bridging?.monthly_heating_loss_kwh)

  // Solar gain monthly — same source as Building Monthly.
  const solarM = los.glazing?.monthly_solar_transmission_kwh ?? _z()

  // Nat-vent total per month (sum across all operable openings).
  const nvTotalM = _z()
  for (const o of nv) _add(nvTotalM, o.monthly_heating_loss_kwh)

  const gia = instantResult?.heat_balance?.metadata?.gia_m2 ?? 0
  const totalFabricKwh = fabricM.reduce((s, v) => s + v, 0)
  const totalSolarKwh  = solarM.reduce((s, v) => s + (v ?? 0), 0)
  const totalNvKwh     = nvTotalM.reduce((s, v) => s + v, 0)

  // Per-opening colour palette — kept consistent with the per-opening
  // legend so the user can identify which slice belongs to which entry.
  const NV_COLOURS = ['#0E7490','#0891B2','#06B6D4','#22D3EE','#67E8F9','#A5F3FC']
  // Build one losses stack for fabric + one per operable opening, so the
  // user can see (a) how big nat-vent is vs fabric, (b) which opening
  // contributes how much.
  const lossesStacks = [
    { key: 'fabric', label: `Fabric loss (${Math.round(totalFabricKwh).toLocaleString()} kWh)`, color: '#475569', values: fabricM },
    ...nv
      .filter(o => (o.heat_loss_kwh ?? 0) > 0.01)
      .map((o, oi) => ({
        key: `nv_${o.id}`,
        label: `${o.name || o.id} (${Math.round(o.heat_loss_kwh ?? 0).toLocaleString()} kWh)`,
        color: NV_COLOURS[oi % NV_COLOURS.length],
        values: o.monthly_heating_loss_kwh ?? _z(),
      })),
  ]

  return (
    <div className="w-full h-full overflow-auto p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div className="flex items-center gap-2">
          <EnginePill mode="static" />
          <p className="text-caption font-semibold text-navy">Monthly heat balance — operable openings in context</p>
        </div>
        <div className="flex items-center gap-2">
          <ChartTotalsBadge label="Σ solar"   value_kwh={totalSolarKwh}  gia_m2={gia} />
          <ChartTotalsBadge label="Σ fabric"  value_kwh={totalFabricKwh} gia_m2={gia} />
          <ChartTotalsBadge label="Σ natvent" value_kwh={totalNvKwh}     gia_m2={gia} />
        </div>
      </div>
      <p className="text-xxs text-mid-grey mb-4">
        Per-month aggregation of the 8760-hour State 2 trace. Months sit on a
        fixed horizontal axis; solar gain grows upward, fabric loss + per-opening
        natural ventilation grow downward — nat-vent stacks above fabric so its
        contribution to total envelope loss is visible at a glance.
      </p>

      <DivergingMonthlyChart
        gainsStacks={totalSolarKwh > 0 ? [
          { key: 'solar', label: `Solar (${Math.round(totalSolarKwh).toLocaleString()} kWh)`, color: '#F59E0B', values: solarM },
        ] : []}
        lossesStacks={lossesStacks}
        height={320}
        unit="kWh"
      />

      {nv.length === 0 && (
        <p className="text-xxs italic text-mid-grey/70 mt-3">
          No operable openings on this project — the chart shows envelope-only
          context (solar gain + fabric loss). Add an opening above to see its
          monthly contribution stacked on the loss side.
        </p>
      )}
    </div>
  )
}

/* ── Summary: per-opening table (Static engine) ─────────────────────
   Brief 28-IM IM-M4.5 Phase 2 (item 3 / UI honesty): renamed from the
   earlier "Static-vs-Dynamic Δ" promise. The implementation only ever
   read from Static (`instantResult.losses_at_setpoint.natural_ventilation`);
   the Δ comparison column never existed. Side-by-side comparison lands
   in Brief 28-DynamicParity once the Dynamic parser emits per-opening
   natvent (input-side already present in epjson_assembler.py
   _build_operable_openings_objects, output-side collapses to aggregate
   under Zone Ventilation Sensible Heat Loss). */
function OperationSummaryView({ instantResult, openings, orientation }) {
  const nv = instantResult?.losses_at_setpoint?.natural_ventilation ?? []
  const demand = instantResult?.demand
  if (openings.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-mid-grey text-xxs">
        Add an operable opening to populate the summary.
      </div>
    )
  }
  const totalNVKwh = nv.reduce((s, o) => s + (o.heat_loss_kwh ?? 0), 0)

  // Brief 28-IM-Polish POL-M2.
  const gia = instantResult?.heat_balance?.metadata?.gia_m2 ?? 0
  return (
    <div className="w-full h-full overflow-auto p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div className="flex items-center gap-2">
          <EnginePill mode="static" />
          <p className="text-caption font-semibold text-navy">Operable openings · summary</p>
        </div>
        <ChartTotalsBadge label="Σ natvent" value_kwh={totalNVKwh} gia_m2={gia} />
      </div>
      <p className="text-xxs text-mid-grey mb-3">
        Per-opening annual natural-ventilation heat loss · setpoint convention
        (Brief 28k) · Bridgewater post-BRUKL inputs.
      </p>

      <table className="w-full max-w-4xl text-xxs border-collapse">
        <thead>
          <tr className="border-b border-light-grey text-mid-grey uppercase tracking-wider">
            <th className="text-left py-2 pr-3 font-medium">Opening</th>
            <th className="text-left py-2 pr-3 font-medium">Facade</th>
            <th className="text-left py-2 pr-3 font-medium">Mode</th>
            <th className="text-right py-2 pr-3 font-medium">Area (m²)</th>
            <th className="text-right py-2 pr-3 font-medium">Open hrs</th>
            <th className="text-right py-2 pr-3 font-medium">Avg flow (L/s)</th>
            <th className="text-right py-2 pr-3 font-medium">Avg ΔT (K)</th>
            <th className="text-right py-2 font-medium">Heat loss (kWh/yr)</th>
          </tr>
        </thead>
        <tbody>
          {openings.map(o => {
            const eng = nv.find(n => n.id === o.id)
            return (
              <tr key={o.id} className="border-b border-light-grey/50">
                <td className="py-1.5 pr-3 text-navy">{o.name || o.id}</td>
                <td className="py-1.5 pr-3 text-mid-grey">{facadeLabelByKey(o.facade, orientation)}</td>
                <td className="py-1.5 pr-3 text-mid-grey">{o.control?.mode ?? '—'}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-navy">{Number(o.area_m2 ?? 0).toFixed(2)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-navy">{eng?.open_hours ?? '—'}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-navy">{eng?.avg_flow_when_open_l_s ?? '—'}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-navy">{eng?.avg_dT_when_open_k ?? '—'}</td>
                <td className="py-1.5 text-right tabular-nums text-navy">
                  {eng ? Math.round(eng.heat_loss_kwh).toLocaleString() : '—'}
                </td>
              </tr>
            )
          })}
          <tr className="border-t-2 border-navy/30 font-semibold">
            <td className="py-2 pr-3 text-navy" colSpan={7}>Total natural ventilation loss</td>
            <td className="py-2 text-right tabular-nums text-navy">{Math.round(totalNVKwh).toLocaleString()}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-6 grid grid-cols-2 gap-4 max-w-3xl">
        <div className="bg-white border border-light-grey rounded p-3">
          <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">State 2 heating demand</p>
          <p className="text-caption text-navy font-semibold tabular-nums">
            {demand?.heating_demand_mwh?.toFixed(1) ?? '—'} MWh/yr
          </p>
          <p className="text-xxs text-mid-grey">
            (envelope + gains, includes operable losses above)
          </p>
        </div>
        <div className="bg-white border border-light-grey rounded p-3">
          <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">State 2 cooling demand</p>
          <p className="text-caption text-navy font-semibold tabular-nums">
            {demand?.cooling_demand_mwh?.toFixed(1) ?? '—'} MWh/yr
          </p>
        </div>
      </div>

      <div className="text-xxs text-mid-grey/80 italic mt-4 max-w-3xl space-y-1">
        <p><span className="font-medium not-italic text-amber-700">Convention notes (Static vs Dynamic):</span></p>
        <p>• <span className="font-medium not-italic">Wind / stack split</span> (Brief 28-IM §11.3): Static uses BS 5925
          wind-angle decomposition; EnergyPlus autocalcs <code>F_w</code> per its
          <code>ZoneVentilation:WindandStackOpenArea</code> object. Static numbers
          here will diverge from a Dynamic run; both are physics-valid.</p>
        <p>• <span className="font-medium not-italic">Per-opening attribution</span>: Dynamic's
          EnergyPlus run emits one <code>ZoneVentilation</code> object per opening (input
          side parity, see <code>nza_engine/generators/epjson_assembler.py</code>
          <code>_build_operable_openings_objects</code>), but the SQL parser
          currently collapses all openings into one
          <code>Zone Ventilation Sensible Heat Loss Energy</code> aggregate. The
          per-opening Δ column for this table lands in Brief 28-DynamicParity.</p>
      </div>
    </div>
  )
}

/* ── Per-opening collapsible row (preserved from Gate E5a) ───────────── */
function OpeningRow({ opening, selected, orientation, onSelect, onUpdate, onDelete, openScheduleEditor, allSched }) {
  const [expanded, setExpanded] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const ctl = opening.control ?? {}
  const mode = ctl.mode ?? 'permanent'

  const modeBadgeClass =
    mode === 'permanent'   ? 'bg-mid-grey/15 text-dark-grey'      :
    mode === 'scheduled'   ? 'bg-cyan-700/15 text-cyan-800'        :
                             'bg-amber-600/15 text-amber-800'

  const summary = useMemo(() => {
    const a = opening.area_m2 ?? 0
    const h = opening.height_m ?? 0
    return `${a.toFixed(2)} m² × ${h.toFixed(2)} m on ${facadeLabelByKey(opening.facade, orientation)}`
  }, [opening.area_m2, opening.height_m, opening.facade, orientation])

  return (
    <div
      className={`rounded-lg border transition-colors ${
        selected
          ? 'border-cyan-700 ring-1 ring-cyan-700/30 bg-cyan-50/30'
          : 'border-light-grey bg-white hover:border-mid-grey'
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          onClick={() => { onSelect(); setExpanded(e => !e) }}
          className="flex-1 flex items-center gap-1.5 text-left min-w-0"
        >
          <span className={`text-xxs px-1 py-0.5 rounded ${modeBadgeClass} flex-shrink-0 capitalize`}>
            {mode}
          </span>
          <span className="text-xxs text-navy font-medium truncate">{opening.name || opening.id}</span>
        </button>
        <button
          onClick={() => { onSelect(); setExpanded(e => !e) }}
          className="text-xxs text-mid-grey hover:text-navy px-1"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▴' : '▾'}
        </button>
        <button
          onClick={() => {
            if (window.confirm(`Delete "${opening.name || opening.id}"?`)) onDelete()
          }}
          className="text-xxs text-error hover:underline px-1"
          title="Delete this opening"
        >
          ✕
        </button>
      </div>
      <div className="px-2 pb-1 text-xxs text-mid-grey truncate -mt-1">{summary}</div>

      {/* Expanded editor */}
      {expanded && (
        <div className="px-2 pb-2 pt-1 space-y-2 border-t border-light-grey text-xxs">
          <LabeledInput
            label="Name"
            value={opening.name ?? ''}
            onChange={v => onUpdate({ name: v })}
            placeholder="Main entrance door"
          />
          <div className="grid grid-cols-2 gap-2">
            <LabeledSelect
              label="Facade"
              value={opening.facade ?? 'south'}
              onChange={v => onUpdate({
                facade: v,
                parent_glazing_face: opening.parent_glazing_face != null ? v : null,
              })}
              options={FACADES.map(f => ({ value: f.key, label: facadeLabel(f.num, orientation) }))}
            />
            <LabeledSelect
              label="Opening type"
              value={opening.opening_type ?? 'window'}
              onChange={v => onUpdate({
                opening_type: v,
                parent_glazing_face: v === 'window' ? (opening.facade ?? 'south') : null,
              })}
              options={OPENING_TYPE_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
            />
          </div>
          <LabeledCheckbox
            label="Consumes glazing on parent facade"
            checked={opening.parent_glazing_face != null}
            onChange={c => onUpdate({ parent_glazing_face: c ? (opening.facade ?? 'south') : null })}
            hint="Doors leave this off (they add envelope area). Operable window banks on top of an existing glazed facade leave this on."
          />
          <div className="grid grid-cols-2 gap-2">
            <LabeledNumber
              label="Area (m²)"
              value={opening.area_m2 ?? 0}
              onChange={v => onUpdate({ area_m2: v })}
              min={0} step={0.1}
            />
            <LabeledNumber
              label="Height (m)"
              value={opening.height_m ?? 0}
              onChange={v => onUpdate({ height_m: v })}
              min={0} step={0.1}
            />
          </div>

          <button
            onClick={() => setShowAdvanced(s => !s)}
            className="text-xxs text-mid-grey hover:text-navy underline"
          >
            {showAdvanced ? 'Hide' : 'Show'} Cd / Cw
          </button>
          {showAdvanced && (
            <div className="grid grid-cols-2 gap-2">
              <LabeledNumber
                label="Cd"
                value={opening.discharge_coefficient ?? 0.6}
                onChange={v => onUpdate({ discharge_coefficient: v })}
                min={0} max={1} step={0.05}
              />
              <LabeledNumber
                label="Cw"
                value={opening.wind_coefficient ?? 0.25}
                onChange={v => onUpdate({ wind_coefficient: v })}
                min={0} max={1} step={0.05}
              />
            </div>
          )}

          {/* Control mode */}
          <div className="pt-2 border-t border-light-grey">
            <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5">Control</p>
            <LabeledSelect
              label="Mode"
              value={mode}
              onChange={v => onUpdate({ control: { ...ctl, mode: v } })}
              options={[
                { value: 'permanent',   label: 'Permanent (always open)' },
                { value: 'scheduled',   label: 'Scheduled' },
                { value: 'temperature', label: 'Temperature-triggered' },
              ]}
            />
            {(mode === 'scheduled' || mode === 'temperature') && (
              <div className="mt-1.5">
                <label className="block text-xxs text-mid-grey mb-0.5">
                  {mode === 'temperature' ? 'Schedule (AND temperature)' : 'Schedule'}
                </label>
                <div className="flex items-center gap-1">
                  <select
                    value={ctl.schedule_ref ?? 'always_on'}
                    onChange={e => onUpdate({ control: { ...ctl, schedule_ref: e.target.value } })}
                    className="flex-1 px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-cyan-700 cursor-pointer"
                  >
                    {/* Union: project-scoped schedules + hardcoded library presets */}
                    {(allSched && allSched.length > 0 ? allSched : SCHEDULE_OPTIONS.map(o => o.value)).map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  {openScheduleEditor && (
                    <button
                      onClick={() => openScheduleEditor(ctl.schedule_ref ?? 'always_on')}
                      className="text-xxs px-1.5 py-1 rounded border border-light-grey text-mid-grey hover:text-cyan-700 hover:border-cyan-700"
                      title="Edit this schedule (saves to project)"
                    >
                      ✏️
                    </button>
                  )}
                </div>
              </div>
            )}
            {mode === 'temperature' && (
              <div className="space-y-1.5 mt-1.5">
                <div className="grid grid-cols-2 gap-2">
                  <LabeledNumber
                    label="Open above T_zone (°C)"
                    value={ctl.open_above_zone_c ?? 22}
                    onChange={v => onUpdate({ control: { ...ctl, open_above_zone_c: v } })}
                    min={10} max={30} step={0.5}
                  />
                  <LabeledNumber
                    label="Hysteresis (°C)"
                    value={ctl.hysteresis_c ?? 1.0}
                    onChange={v => onUpdate({ control: { ...ctl, hysteresis_c: v } })}
                    min={0} max={5} step={0.5}
                  />
                </div>
                <LabeledCheckbox
                  label="Only if outside air is cooler"
                  checked={!!ctl.require_outside_cooler}
                  onChange={c => onUpdate({ control: { ...ctl, require_outside_cooler: c } })}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Small labelled-input primitives (compact for left column) ───────── */
function LabeledInput({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="block text-xxs text-mid-grey mb-0.5">{label}</label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-cyan-700"
      />
    </div>
  )
}

function LabeledNumber({ label, value, onChange, min, max, step, hint }) {
  return (
    <div>
      <label className="block text-xxs text-mid-grey mb-0.5">{label}</label>
      <input
        type="number"
        value={value}
        min={min} max={max} step={step}
        onChange={e => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
        className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-cyan-700 tabular-nums"
      />
      {hint && <p className="text-xxs text-mid-grey/80 mt-0.5">{hint}</p>}
    </div>
  )
}

function LabeledSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-xxs text-mid-grey mb-0.5">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-cyan-700 cursor-pointer"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function LabeledCheckbox({ label, checked, onChange, hint }) {
  return (
    <div>
      <label className="flex items-start gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          className="accent-cyan-700 w-3 h-3 mt-0.5 flex-shrink-0"
        />
        <span className="text-xxs text-navy">{label}</span>
      </label>
      {hint && <p className="text-xxs text-mid-grey/80 mt-0.5 ml-4">{hint}</p>}
    </div>
  )
}

/* ── deepMergeOpening: merge partial updates into an opening with the
       nested `control` object handled correctly. ────────────────────────── */
function deepMergeOpening(current, partial) {
  const out = { ...current, ...partial }
  if (partial.control) {
    out.control = { ...(current.control ?? {}), ...partial.control }
  }
  return out
}

/* Brief 28-IM-Polish POL-M2 IA 3.2: Operation Live Results strip.
   Four KPIs per the brief mapping for Operation: Heating demand · Cooling
   demand · Total operable loss/gain · Avg open hours across openings. */
function OperationLiveResultsStrip({ instantResult, openings }) {
  if (!instantResult) return <LiveResultsStrip loading />
  const demand = instantResult.demand
  const nv = instantResult.losses_at_setpoint?.natural_ventilation ?? []
  const totalNvKwh = nv.reduce((s, n) => s + (n.heat_loss_kwh ?? 0), 0)
  const totalOpenHrs = nv.reduce((s, n) => s + (n.open_hours ?? 0), 0)
  const avgOpenHrs = nv.length > 0 ? Math.round(totalOpenHrs / nv.length) : 0
  const items = [
    {
      label: 'Heating demand', accent: '#DC2626',
      value: demand?.heating_demand_mwh != null ? demand.heating_demand_mwh.toFixed(1) : '—',
      unit: 'MWh/yr',
      sub: 'State 2 (envelope + gains + operable)',
    },
    {
      label: 'Cooling demand', accent: '#3B82F6',
      value: demand?.cooling_demand_mwh != null ? demand.cooling_demand_mwh.toFixed(1) : '—',
      unit: 'MWh/yr',
      sub: 'with internal gains',
    },
    {
      label: 'Operable loss', accent: '#0E7490',
      value: totalNvKwh > 1000 ? (totalNvKwh / 1000).toFixed(1) : Math.round(totalNvKwh).toString(),
      unit: totalNvKwh > 1000 ? 'MWh/yr' : 'kWh/yr',
      sub: `${nv.length} opening${nv.length === 1 ? '' : 's'} (natural ventilation)`,
    },
    {
      label: 'Avg open hours', accent: '#0891B2',
      value: avgOpenHrs > 0 ? avgOpenHrs.toLocaleString() : '—',
      unit: 'h/yr',
      sub: `${Math.round(totalOpenHrs).toLocaleString()} h total across ${openings.length} entries`,
    },
  ]
  return <LiveResultsStrip items={items} />
}
