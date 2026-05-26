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
import { useProjectMutation } from '../../hooks/useProjectMutation.js'
import { useUI } from '../../context/UIContext.jsx'
import { WeatherContext } from '../../context/WeatherContext.jsx'
import { useHourlySolar } from '../../hooks/useHourlySolar.js'
import { calculateInstant, synthesiseOperableOpeningsFromLegacy } from '../../utils/instantCalc.js'
import { SCHEDULES, allScheduleNames } from '../../utils/scheduleLibrary.js'
import BuildingViewer3D from './building/BuildingViewer3D.jsx'
import HeatBalance from './balance/HeatBalance.jsx'
import WeatherSynchronisedProfile from '../profiles/WeatherSynchronisedProfile.jsx'
// Brief 44 Part 5 (2026-05-21) — Operation module adopts the shared
// InteractiveProfileVisualiser for its profile-over-time tab.
import InteractiveProfileVisualiser from '../shared/InteractiveProfileVisualiser/InteractiveProfileVisualiser.jsx'
// Brief 37 Part 3 (2026-05-18): the legacy profiles/ScheduleEditor was
// previously hosted inside an inset-0 fixed modal — Operation's "stuck"
// editor (Brief 36 Part 3 fixed Systems' equivalent but missed this one).
// Replaced here with SchedulePopout + UnifiedScheduleEditor. Library save
// flow lifted from the legacy editor and inlined as `saveScheduleToProject`
// in this module.
import SchedulePopout from '../shared/SchedulePopout.jsx'
import { confirm } from '../shared/ConfirmDialog.jsx'
import UnifiedScheduleEditor from '../shared/scheduleEditor/UnifiedScheduleEditor.jsx'
// Brief 28-IM-Polish POL-M2: shared cross-module strip + chart components.
import LiveResultsStrip from '../shared/LiveResultsStrip.jsx'
import EnginePill from '../shared/EnginePill.jsx'
import ChartTotalsBadge from '../shared/ChartTotalsBadge.jsx'
// Chris UX request (2026-05-17): diverging-bars chart shared with Building
// + Internal Gains. Operable openings now stacked on fabric loss so the
// magnitude is visible in context, not in isolation.
import DivergingMonthlyChart from '../shared/DivergingMonthlyChart.jsx'

const ACCENT = '#0F766E'  // operation theme — teal-700 (Brief 37 Part 1: was '#0E7490' cyan-700)

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
export function facadeLabelByKey(key, orientationDeg) {
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

// Brief 42 Part 1 (2026-05-19): per-type defaults for cd + flow_mode.
// These are seed values applied at creation time when the user clicks
// "+ Door / + Window / + Vent". Once an opening exists, its cd and
// flow_mode are independent of these defaults — no inheritance link.
// Door defaults to cross-flow (rooms on opposite sides of a corridor
// connected through the door); window + vent default to single_sided
// (more conservative, the safe assumption without explicit topology).
// defaultCw retired: site exposure (C_w) is building-wide and lives on
// openings.site_exposure (resolved in instantCalc.js's siteExposureCw).
// Brief 46 Part 3 (2026-05-22): exported so the editor's
// OperationSection composer can reuse the same opening-type catalogue.
export const OPENING_TYPE_OPTIONS = [
  { value: 'door',   label: 'Door',   defaultArea: 4.0,  defaultHeight: 2.0, defaultCd: 0.60, defaultFlowMode: 'cross'        },
  { value: 'window', label: 'Window', defaultArea: 1.5,  defaultHeight: 1.2, defaultCd: 0.55, defaultFlowMode: 'single_sided' },
  { value: 'vent',   label: 'Vent',   defaultArea: 0.5,  defaultHeight: 0.5, defaultCd: 0.40, defaultFlowMode: 'single_sided' },
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

// Brief 46 Part 3 (2026-05-22): exported alongside OPENING_TYPE_OPTIONS
// + newOpening + facadeLabelByKey + OpeningRow so the editor's
// OperationSection composer can mount the same opening editor as the
// main /operation page.
// Generate a stable, human-readable id for a new opening.
export function nextId(existing, type, facade) {
  const base = `${facade}_${type}`
  const seen = new Set((existing ?? []).map(o => o?.id).filter(Boolean))
  if (!seen.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${i}`
    if (!seen.has(candidate)) return candidate
  }
  return `${base}_${Date.now()}`
}

export function newOpening(type, facade) {
  const t = OPENING_TYPE_OPTIONS.find(o => o.value === type) ?? OPENING_TYPE_OPTIONS[1]
  return {
    id:                    null,  // filled in by caller via nextId()
    name:                  `New ${t.label.toLowerCase()} (${facade})`,
    facade,
    area_m2:               t.defaultArea,
    height_m:              t.defaultHeight,
    // Brief 42 Part 1 (2026-05-19): per-opening cd + flow_mode seeded
    // from OPENING_TYPE_OPTIONS at creation. Building-wide openings.cd
    // and openings.flow_mode are removed (DEFAULT_PARAMS, ProjectContext);
    // each opening declares its own physics. Once created the values are
    // independent of these defaults — no inheritance link. Site exposure
    // (C_w) stays building-wide on openings.site_exposure. height_m
    // retained for temperature-mode stack contribution.
    cd:                    t.defaultCd,
    flow_mode:             t.defaultFlowMode,
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
  // Brief 46 Part 3 (2026-05-22): writeList routed through
  // useProjectMutation so the OperationSection editor composer can
  // capture operable_openings as patches. updateParam('schedules', …)
  // stays direct because schedule editing isn't yet captured as a
  // patch (Brief 46 Q1 schedule sub-popout is deferred).
  const { params, constructions, systems, comfortBand, updateParam } = useContext(ProjectContext)
  const { mutate } = useProjectMutation()
  const { weatherData } = useContext(WeatherContext)
  const { selectedOpeningId, setSelectedOpeningId, clearSelection } = useUI()

  const orientation = Number(params?.orientation ?? 0)
  const openings = useMemo(
    () => Array.isArray(params?.operable_openings) ? params.operable_openings : [],
    [params?.operable_openings],
  )

  // Brief 28-IM IM-M4 Addition 1 / Brief 37 Part 3: schedule editor state.
  // editingSchedule is the library schedule object being edited; the
  // SchedulePopout + UnifiedScheduleEditor host it as a draggable pop-out.
  // Seed accepts both flat (Brief 37 schema) and legacy day_types shapes —
  // UnifiedScheduleEditor's ensureSchedule helper unwraps either.
  const [editingSchedule, setEditingSchedule] = useState(null)
  const openScheduleEditor = (scheduleName) => {
    const existing = (params?.schedules ?? []).find(s => s?.name === scheduleName || s?.id === scheduleName)
    const hardcoded = SCHEDULES[scheduleName]
    const seed = existing ?? (hardcoded
      ? {
          id: scheduleName, name: scheduleName, display_name: scheduleName,
          schedule_type: 'occupancy',
          zone_type: 'bedroom',
          day_types: hardcoded.day_types,
          monthly_multipliers: hardcoded.monthly_multipliers ?? Array(12).fill(1),
          exceptions: [],
        }
      : {
          name: scheduleName,
          schedule_type: 'occupancy',
          zone_type: 'bedroom',
          weekday: Array(24).fill(0.5), saturday: Array(24).fill(0.5), sunday: Array(24).fill(0.5),
          monthly_multipliers: Array(12).fill(1),
          exceptions: [],
        })
    setEditingSchedule(seed)
  }

  // Brief 37 Part 3: save the buffered library schedule into params.schedules[]
  // (project-target — same destination as the legacy ScheduleEditor's
  // target='project' handleSave path). UnifiedScheduleEditor calls this via
  // libraryMeta.onSave; we close the pop-out after a short ack delay.
  const [savingSchedule, setSavingSchedule] = useState(false)
  const saveScheduleToProject = (draft) => {
    setSavingSchedule(true)
    const slugName = (draft.name ?? draft.id ?? 'schedule').toLowerCase().replace(/\s+/g, '_')
    const entry = {
      id:                  slugName,
      name:                slugName,
      display_name:        draft.display_name ?? draft.name ?? slugName,
      schedule_type:       draft.schedule_type ?? 'occupancy',
      zone_type:           draft.zone_type ?? 'bedroom',
      weekday:             draft.weekday  ?? [],
      saturday:            draft.saturday ?? [],
      sunday:              draft.sunday   ?? [],
      monthly_multipliers: draft.monthly_multipliers ?? Array(12).fill(1),
      exceptions:          Array.isArray(draft.exceptions) ? draft.exceptions : [],
    }
    const existingList = Array.isArray(params?.schedules) ? params.schedules : []
    const idx = existingList.findIndex(s => s?.id === slugName || s?.name === slugName)
    const next = idx >= 0 ? existingList.map((s, i) => i === idx ? entry : s) : [...existingList, entry]
    updateParam('schedules', next)
    setTimeout(() => { setSavingSchedule(false); setEditingSchedule(null) }, 600)
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
  // Brief 58 A2 (2026-05-26): pass comfortBand once via options; engine
  // throws if absent. No defensive `?? {…}`, no building.comfort_band.
  const instantResult = useMemo(() => {
    if (!params || !weatherData || !hourlySolar || !libraryData) return null
    return calculateInstant(
      params, constructions ?? {}, systems ?? {},
      libraryData, weatherData, hourlySolar, null,
      // Brief 44 Part 5d (2026-05-21): _skipInterventions per perf audit D.1.
      { mode: 'envelope-gains', comfortBand, _skipInterventions: true },
    )
  }, [params, constructions, systems, libraryData, weatherData, hourlySolar, comfortBand])

  // Detect legacy state that would synthesise something useful.
  const legacyPreview = useMemo(() => {
    if (openings.length > 0) return []
    return synthesiseOperableOpeningsFromLegacy(params ?? {})
  }, [openings.length, params])

  // ── List ops (always overwrite operable_openings wholesale) ────────────
  // Brief 46 Part 3: route through mutate() so the OperationSection
  // editor composer captures the whole-array patch. In main-app mode
  // this falls through to `updateParam('operable_openings', next)` —
  // identity-by-construction.
  const writeList = (next) => mutate('building.operable_openings', next)

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

            {/* Brief 42 Part 4 (2026-05-19): the Brief 41 Part 7
                BuildingWideOpeningsControls invocation is retired. Each
                opening now declares its own C_d + flow_mode in its
                editor card (per-opening UI lands in Brief 42 Part 5).
                Site exposure (C_w) stays building-wide — configured in
                Building → Permanent openings. */}
            <div className="text-xxs text-mid-grey/80 leading-snug bg-off-white border border-light-grey rounded-lg px-2.5 py-2">
              Site exposure (C<sub>w</sub>) is configured in{' '}
              <NavLink to="/building" className="text-navy underline">Building → Permanent openings</NavLink>
              {' '}— it applies to every opening on this building.
            </div>

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
            {/* Brief 41 Part 7 (2026-05-19): the "Building-wide cd / flow_mode
                / site_exposure live in Building" footnote retired — those
                controls now appear inline at the top of this panel via the
                shared BuildingWideOpeningsControls component. Slim footer
                retained for the MEV / MVHR pointer only. */}
            <div className="text-xxs text-mid-grey/90 leading-snug pt-2 border-t border-light-grey">
              <span className="font-medium text-dark-grey">Related:</span>{' '}
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

      {/* Brief 37 Part 3: shared SchedulePopout + UnifiedScheduleEditor.
          Replaces the legacy inset-0 fixed modal. Same library save flow
          (writes to params.schedules[] via saveScheduleToProject) but the
          editor is now draggable and the backdrop doesn't block the main
          view. */}
      <SchedulePopout
        isOpen={!!editingSchedule}
        onClose={() => setEditingSchedule(null)}
        title={editingSchedule ? `Schedule · ${editingSchedule.display_name ?? editingSchedule.name ?? 'untitled'}` : 'Schedule editor'}
        accent={ACCENT}
        persistKey="nza-schedule-popout-position-operation"
      >
        {editingSchedule && (
          <UnifiedScheduleEditor
            schedule={editingSchedule}
            onChange={(next) => setEditingSchedule(prev => ({ ...prev, ...next }))}
            accent={ACCENT}
            mode="library"
            enableExceptions
            contextLabel={editingSchedule.display_name ?? editingSchedule.name ?? ''}
            libraryMeta={{
              name:           editingSchedule.display_name ?? editingSchedule.name ?? '',
              schedule_type:  editingSchedule.schedule_type ?? 'occupancy',
              zone_type:      editingSchedule.zone_type ?? 'bedroom',
              onNameChange:   (v) => setEditingSchedule(prev => ({ ...prev, display_name: v })),
              onTypeChange:   (v) => setEditingSchedule(prev => ({ ...prev, schedule_type: v })),
              onZoneChange:   (v) => setEditingSchedule(prev => ({ ...prev, zone_type: v })),
              onSave:         () => saveScheduleToProject(editingSchedule),
              onCancel:       () => setEditingSchedule(null),
              saving:         savingSchedule,
            }}
          />
        )}
      </SchedulePopout>
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

  // Brief 44 Part 5 (2026-05-21) — Operation Profiles uses the shared
  // InteractiveProfileVisualiser. Default layer: total envelope loss
  // (Operation users care first about the BUILDING-side aggregate; the
  // per-opening breakdown layers in via the toggle chips). Each operable
  // opening's daily natural-ventilation loss appears as its own layer.

  const elements = [losses?.external_wall, losses?.roof, losses?.ground_floor,
                    losses?.glazing, losses?.thermal_bridging, losses?.fabric_leakage,
                    losses?.permanent_vents]
  const elementLen = Array.isArray(elements[0]) ? elements[0].length : 0
  const total_loss_daily_kwh = elementLen > 0
    ? Array.from({ length: elementLen }, (_, d) =>
        elements.reduce((s, arr) => s + (arr?.[d] ?? 0), 0))
    : []

  // Operable openings — one layer per opening with non-empty per-day data
  const openingLayers = nv
    .filter(n => Array.isArray(n?.daily_heat_loss_kwh) && n.daily_heat_loss_kwh.length > 0)
    .map((n, i) => ({
      id: `opening_${n.id}`,
      label: `${n.name || n.id} (natvent)`,
      colour: ['#DC2626', '#F97316', '#A855F7', '#0EA5E9', '#22C55E', '#EAB308'][i % 6],
      daily_kwh: n.daily_heat_loss_kwh,
    }))

  const layers = [
    { id: 'total_loss',   label: 'Total envelope loss', colour: '#1F2937', daily_kwh: total_loss_daily_kwh },
    { id: 'wall',         label: 'External wall',       colour: '#6B7280', daily_kwh: losses?.external_wall ?? [] },
    { id: 'roof',         label: 'Roof',                colour: '#9CA3AF', daily_kwh: losses?.roof ?? [] },
    { id: 'floor',        label: 'Ground floor',        colour: '#D1D5DB', daily_kwh: losses?.ground_floor ?? [] },
    { id: 'glazing',      label: 'Glazing',             colour: '#4B5563', daily_kwh: losses?.glazing ?? [] },
    { id: 'tb',           label: 'Thermal bridging',    colour: '#475569', daily_kwh: losses?.thermal_bridging ?? [] },
    { id: 'infiltration', label: 'Infiltration',        colour: '#7DD3FC', daily_kwh: losses?.fabric_leakage ?? [] },
    { id: 'permvent',     label: 'Permanent vents',     colour: '#0EA5E9', daily_kwh: losses?.permanent_vents ?? [] },
    ...openingLayers,
  ]

  const sumArr = (a) => Array.isArray(a) ? a.reduce((s, v) => s + (v ?? 0), 0) : 0
  const totalLossKwh =
      sumArr(losses?.external_wall) + sumArr(losses?.roof) + sumArr(losses?.ground_floor)
    + sumArr(losses?.glazing) + sumArr(losses?.thermal_bridging)
    + sumArr(losses?.fabric_leakage) + sumArr(losses?.permanent_vents)
  const totalNvKwh = nv.reduce((s, n) => s + (n.heat_loss_kwh ?? 0), 0)
  const gia = instantResult?.heat_balance?.metadata?.gia_m2 ?? instantResult?.metadata?.gia_m2 ?? 0

  const captionWithFocus = focusEngine
    ? `Toggle individual envelope elements + operable openings to drill down. Focus opening: ${focusEngine.name || focusEngine.id} (mode: ${focusEngine.mode}, ${focusEngine.open_hours} open-hours/yr, avg flow ${focusEngine.avg_flow_when_open_l_s} L/s when open, avg ΔT ${focusEngine.avg_dT_when_open_k} K).`
    : 'Toggle individual envelope elements + operable openings to drill down. Add operable openings in the left panel to see their per-opening natural-ventilation contribution as a separate layer.'

  return (
    <div className="w-full h-full flex flex-col overflow-auto p-3">
      <div className="flex-shrink-0 flex items-center justify-between gap-2 mb-2">
        <EnginePill mode="static" />
        <div className="flex items-center gap-2">
          <ChartTotalsBadge label="Σ fabric loss" value_kwh={totalLossKwh} gia_m2={gia} />
          <ChartTotalsBadge label="Σ natvent"     value_kwh={totalNvKwh}   gia_m2={gia} />
        </div>
      </div>
      <InteractiveProfileVisualiser
        layers={layers}
        weather={{ t_out_c: t_out_mean_c, wind_ms: wind_mean_ms, ghi_w_per_m2: ghi_mean_w_m2 }}
        defaultLayerIds={['total_loss']}
        defaultMode="single_line"
        module="operation"
        height={420}
        caption={captionWithFocus}
      />
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
  // Brief 37 Part 1: first entry mirrors the Operation accent (now teal-700).
  // The remaining shades stay cyan-progression — natural ventilation is
  // conceptually distinct from mechanical ventilation (which is Systems
  // module teal-500), so a cyan stack for NV openings is fine and keeps
  // the per-opening palette differentiated from Systems' ventilation row.
  const NV_COLOURS = ['#0F766E','#0891B2','#06B6D4','#22D3EE','#67E8F9','#A5F3FC']
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

/* ── Per-opening collapsible row (preserved from Gate E5a) ─────────────
 * Brief 46 Part 3 (2026-05-22): exported so the editor's OperationSection
 * composer can reuse the same per-opening editor as the main page.
 */
export function OpeningRow({ opening, selected, orientation, onSelect, onUpdate, onDelete, openScheduleEditor, allSched }) {
  const [expanded, setExpanded] = useState(false)
  // Brief 41 Part 4 (2026-05-19): showAdvanced state retired — it gated the
  // per-opening Cd / Cw sliders, which were dropped from the schema in
  // Part 2. Building-wide openings.cd + openings.site_exposure → Cw now
  // drive flow uniformly. See docs/audit/29_permanent_vent_methodology.md.
  // (Kept here as a marker; remove on next OperationModule refactor.)

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
          onClick={async () => {
            if (await confirm({
              title: `Delete "${opening.name || opening.id}"?`,
              message: 'This opening will be removed from the building. This cannot be undone.',
              confirmText: 'Delete',
              tone: 'danger',
            })) onDelete()
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

          {/* Brief 42 Part 5 (2026-05-19): per-opening C_d + flow_mode.
              Brief 41 Part 4's "Cd / Cw inputs removed" is superseded —
              each opening now declares its own physics. Seeded by type
              defaults at creation (Brief 42 Part 1 newOpening factory:
              door 0.60 / cross; window 0.55 / single_sided; vent 0.40 /
              single_sided) and editable per-opening here. Once an opening
              exists, its values are independent of the type defaults —
              changing the seed would not propagate. Site exposure (C_w)
              stays building-wide in Building → Permanent openings. */}
          <div className="pt-2 border-t border-light-grey">
            <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5">Physics</p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xxs text-mid-grey w-6">C<sub>d</sub></span>
                <input
                  type="range" min={0.15} max={0.65} step={0.01}
                  value={typeof opening.cd === 'number' ? opening.cd : 0.40}
                  onChange={e => onUpdate({ cd: Number(e.target.value) })}
                  className="flex-1 h-[3px] accent-navy"
                  title="Discharge coefficient — see docs/audit/29_permanent_vent_methodology.md for typical values (trickle vent 0.25 / louvre 0.40 / open window 0.60 / wide door 0.60)"
                />
                <span className="text-xxs text-navy tabular-nums w-9 text-right">
                  {(typeof opening.cd === 'number' ? opening.cd : 0.40).toFixed(2)}
                </span>
              </div>
              <LabeledSelect
                label="Flow mode"
                value={opening.flow_mode ?? 'single_sided'}
                onChange={v => onUpdate({ flow_mode: v })}
                options={[
                  { value: 'single_sided', label: 'Single-sided (one façade)' },
                  { value: 'cross',        label: 'Cross-flow (opposite façades)' },
                ]}
              />
              <p className="text-xxs text-mid-grey/70 leading-tight">
                Single-sided: <code>Q ≈ 0.025 · A · v<sub>wind</sub></code> (EN 16798-7 §6.4).
                Cross-flow: <code>Q = C<sub>d</sub> · A · √C<sub>w</sub> · v<sub>wind</sub></code> (CIBSE Guide A §4.6).
                Use cross-flow only when this opening connects rooms on opposite façades via an open internal air path.
              </p>
            </div>
          </div>


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
export function deepMergeOpening(current, partial) {
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
      label: 'Cooling demand', accent: '#00AEEF',
      value: demand?.cooling_demand_mwh != null ? demand.cooling_demand_mwh.toFixed(1) : '—',
      unit: 'MWh/yr',
      sub: 'with internal gains',
    },
    {
      label: 'Operable loss', accent: '#0F766E',
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
