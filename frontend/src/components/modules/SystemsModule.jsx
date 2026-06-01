/**
 * SystemsModule.jsx — /systems
 *
 * Brief 28-IM Gate IM-M4 (Systems) full rewrite.
 *
 *   Left   — system inputs: per-section accordions (Heating / Cooling / DHW /
 *            Ventilation list / Lighting / Small power) with on/off toggles,
 *            SCOP/SEER/efficiency sliders, DHW fuel-mix sliders, per-vent
 *            on/off + HRE on/off toggles.
 *   Centre — view switcher: Sankey | Profiles | Schedule | Monthly | Summary
 *            (Sankey is the primary view).
 *   Right  — Live Results panel: EUI big number, demand-vs-delivered cards,
 *            fuel split bars — all instant-recompute as inputs change.
 *
 * Engine path: forces v2.5 by passing SYSTEM_TEMPLATES_LIBRARY in libraryData,
 * reads `consumption.*` block per Brief 28-IM IM-M4 §8.1.
 *
 * Brief 28-IM §8.3 removals:
 *   - "Detailed / Ideal Loads" simulation mode toggle: gone
 *   - Unlabelled top-right buttons (Detailed / MEV / ASHP Preheat): gone
 *   - Right-hand "Live Results / Schedule" toggle: gone (Schedule is now a
 *     centre-column view tab; Live Results is the only right-column content).
 *
 * Brief 28-IM IM-M4 Addition 1 (project-scoped shared schedules) + Addition 3
 * (per-system schedule visualisation): the Schedule tab + every system's
 * schedule_ref dropdown carries an ✏️ Edit button that opens the canonical
 * ScheduleEditor with `target='project'` — writes land on
 * `building.schedules[]` and become visible across all modules.
 */

import { useContext, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { ProjectContext } from '../../context/ProjectContext.jsx'
import { useProjectMutation } from '../../hooks/useProjectMutation.js'
import { useUISettings } from '../../context/UISettingsContext.jsx'
import { WeatherContext } from '../../context/WeatherContext.jsx'
import { useHourlySolar } from '../../hooks/useHourlySolar.js'
import { calculateInstant } from '../../utils/instantCalc.js'
import { SCHEDULES, allScheduleNames } from '../../utils/scheduleLibrary.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../../data/systemTemplatesLibrary.js'
import WeatherSynchronisedProfile from '../profiles/WeatherSynchronisedProfile.jsx'
// Brief 44 Part 3 (2026-05-21): rebuilt Profiles tab uses the shared
// InteractiveProfileVisualiser. WeatherSynchronisedProfile import retained
// for other consumers (none in SystemsModule itself) — could be pruned
// in a later cleanup pass.
import InteractiveProfileVisualiser from '../shared/InteractiveProfileVisualiser/InteractiveProfileVisualiser.jsx'
// Brief 37 Part 3 (2026-05-18): legacy profiles/ScheduleEditor replaced
// by UnifiedScheduleEditor inside the existing SchedulePopout (Brief 36
// Part 3). Library save flow lifted into saveScheduleToProject below.
import UnifiedScheduleEditor from '../shared/scheduleEditor/UnifiedScheduleEditor.jsx'
// Brief 28-IM-Polish POL-M2: shared chart-consistency components.
import EnginePill from '../shared/EnginePill.jsx'
import ChartTotalsBadge from '../shared/ChartTotalsBadge.jsx'
// Brief 36 Part 3 (2026-05-18): shared draggable pop-out chrome. Replaces
// the fixed inset-0 modal that locked the schedule editor to centre-screen
// — Chris's "stuck" complaint. The schedule body content (ScheduleEditor)
// is unchanged; only the host is replaced.
import SchedulePopout from '../shared/SchedulePopout.jsx'
// Brief 40 Part 3 (2026-05-19): Systems module rewrite from tab-based to
// section-list shape. SystemEditorCard renders one system at a time with
// service-aware fields per the Brief 40 schema (audit doc §2).
// AddSystemButton is the "+ Add system" affordance per section with
// library + start-blank archetypes. SystemsDiagnosticPanel renders the
// comfort-vs-setpoint summary table in a new "Diagnostic" centre tab.
import { SERVICE_COLOURS } from './systems/SystemEditorCard.jsx'
import AddSystemButton from './systems/AddSystemButton.jsx'
import SystemsDiagnosticPanel from './systems/SystemsDiagnosticPanel.jsx'
// Brief 70 Part 1 (2026-05-28): Zone temperature + demand viewer. Surfaces
// the Brief 67/69 demand-model trace as an annual heatmap + KPI strip.
import ZoneTempTab from './systems/ZoneTempTab.jsx'
// Brief 53 Part 3 (2026-05-26): heat-balance Sankey on Systems so the
// demand-shaping role of ventilation (envelope → +gains → +ventilation →
// demand) is visible alongside the existing energy-flow Sankey
// (demand → systems → fuel). Reuses the existing Scenarios/Results
// component — same visual language, same engine output path.
import HeatBalance from './balance/HeatBalance.jsx'
// Brief 42 Part 3 (2026-05-20): per-system inline-expand SystemEditorCard
// replaced with compact SystemSummaryRow + draggable SystemEditorPopout
// (Issue #22). Building-level fields (heating/cooling setpoint mode +
// custom value, DHW storage/tap/cold/demand) lifted out of the per-system
// card and into a per-service ServiceSectionHeader (Issue #21).
import ServiceSectionHeader from './systems/ServiceSectionHeader.jsx'
import SystemSummaryRow from './systems/SystemSummaryRow.jsx'
// Brief 45 Part 3 (2026-05-21): per-service share split visualisation.
import ServiceSplitBar from './systems/ServiceSplitBar.jsx'
import SystemEditorPopout from './systems/SystemEditorPopout.jsx'

const SYSTEMS_ACCENT = '#00AEEF'
import LiveResultsStrip from '../shared/LiveResultsStrip.jsx'
import ChartExportCard from '../shared/ChartExportCard.jsx'

const ACCENT = '#00AEEF'   // systems theme — cyan-bright

const CENTRE_TABS = [
  // Brief 53 Part 3 (2026-05-26): Heat balance placed FIRST so the
  // demand-shaping picture (gains → zone → losses, incl. ventilation
  // recovery folded into vent UA + cooling-demand drop in bypass hours)
  // is the default view a user lands on. Chris: "the vent is just as
  // important as the window… this is why I want to see this before we
  // start with the systems." Sankey (energy-flow) stays as the next tab.
  { id: 'heatbalance', label: 'Heat balance' },
  { id: 'sankey',     label: 'Energy flows' },
  // Brief 70 Part 1 (2026-05-28): Zone temperature trace + demand power
  // viewer. Placed after Heat balance / Energy flows so the demand-shaping
  // story flows: how heat moves through the zone → how the engine clamps
  // the float to setpoint → which hours the systems fire.
  { id: 'zonetemp',   label: 'Zone temperature' },
  { id: 'profiles',   label: 'Profiles' },
  { id: 'schedule',  label: 'Schedule' },
  { id: 'monthly',    label: 'Monthly' },
  { id: 'rejection',  label: 'Rejection' },   // Brief 38 (2026-05-19): heat-rejection breakdown
  { id: 'diagnostic', label: 'Diagnostic' },  // Brief 40 (2026-05-19): comfort-vs-setpoint summary
  { id: 'summary',    label: 'Summary' },
]

const FUEL_COLOURS = {
  electricity: '#ECB01F',
  gas:         '#DC2626',
  district:    '#8B5CF6',
}
// Brief 37 Part 1: aligned to SYSTEMS_SERVICE_COLOURS in balanceColours.js.
// Brief 74 P6 (2026-06-01): auxiliary added in #4B5563 (gray-600), same hex
// as INTERNAL_COLOURS.auxiliary (gainColours / balanceColours) — the heat-
// balance gain colour token, single source of truth across views.
const DEMAND_COLOURS = {
  space_heating: '#DC2626',
  space_cooling: '#00AEEF',
  dhw:           '#EC4899',
  fans:          '#14B8A6',
  lighting:      '#F59E0B',
  small_power:   '#8B5CF6',
  auxiliary:     '#4B5563',
}

/* ── Library data fetch ─────────────────────────────────────────────────── */
let _constructionsPromise = null
function fetchConstructions() {
  if (_constructionsPromise) return _constructionsPromise
  _constructionsPromise = fetch('/api/library/constructions')
    .then(r => r.ok ? r.json() : { constructions: [] })
    .then(d => (d.constructions ?? []).map(c => ({
      name: c.name,
      u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
      y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
      g_value: c.config_json?.g_value,
      config_json: c.config_json ?? c,
      layers: c.layers,
    })))
    .catch(() => [])
  return _constructionsPromise
}

/* ── Main module ────────────────────────────────────────────────────────── */
export default function SystemsModule() {
  const { params, constructions, systems, comfortBand, updateParam } = useContext(ProjectContext)
  const { weatherData } = useContext(WeatherContext)
  const orientation = Number(params?.orientation ?? 0)
  const hourlySolar = useHourlySolar(weatherData, orientation)

  const [constructionsLib, setConstructionsLib] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetchConstructions().then(d => { if (!cancelled) setConstructionsLib(d) })
    return () => { cancelled = true }
  }, [])

  const libraryData = useMemo(() => ({
    constructions: constructionsLib ?? [],
    system_templates: SYSTEM_TEMPLATES_LIBRARY,
  }), [constructionsLib])

  // Live engine pass — State 3 (full v2.5) when systems_config_v25 is present.
  // Brief 58 A2 (2026-05-26): pass comfortBand exactly once via options.
  // Engine now requires it (throws if missing); ProjectContext guarantees
  // a value is defined. No defensive `?? {…}`, no building.comfort_band
  // mutation. Single resolution at the boundary.
  const result = useMemo(() => {
    if (!params || !weatherData || !hourlySolar || !constructionsLib) return null
    return calculateInstant(
      params, constructions ?? {}, systems ?? {},
      libraryData, weatherData, hourlySolar, null,
      // Brief 44 Part 5d (2026-05-21): _skipInterventions:true — this
      // route doesn't consume consumption.interventions.*; skipping
      // the stack runner cuts the per-edit cost from ~6.3s (N=3) to
      // ~550 ms (perf audit §14 / D.1).
      { mode: 'full', comfortBand, engine: 'v2.5', _skipInterventions: true },
    )
  }, [params, constructions, systems, libraryData, weatherData, hourlySolar, comfortBand, constructionsLib])

  // Centre view switcher state. Brief 53 Part 3 (2026-05-26): default-
  // fallback shifted from 'sankey' to 'heatbalance' so fresh sessions
  // land on the demand-shaping view first (Chris's preference). Existing
  // sessions keep their saved selection — no UX regression for users
  // who'd memorised 'sankey' as the default.
  const [centreView, setCentreView] = useState(() => {
    try {
      const saved = localStorage.getItem('nza-systems-centre')
      if (CENTRE_TABS.some(t => t.id === saved)) return saved
    } catch {}
    return 'heatbalance'
  })
  useEffect(() => {
    try { localStorage.setItem('nza-systems-centre', centreView) } catch {}
  }, [centreView])

  // Brief 37 Part 3: schedule editor state. editingSchedule is the library
  // schedule object being edited; SchedulePopout (Brief 36 Part 3) +
  // UnifiedScheduleEditor (Brief 37 Part 2) replace the legacy modal +
  // editor pair. Seed accepts both flat (Brief 37 schema) and legacy
  // day_types shapes — UnifiedScheduleEditor's ensureSchedule unwraps either.
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

  // Brief 37 Part 3: library save flow — writes to params.schedules[]
  // (project-target, same destination as the legacy ScheduleEditor's
  // target='project' handleSave). Accent for the editor derives from the
  // schedule's `schedule_type` per SYSTEMS_SERVICE_COLOURS (heating red,
  // cooling cyan-bright, etc.).
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
  // Service-coloured accent for the editor — uses the canonical
  // SYSTEMS_SERVICE_COLOURS table. Schedules carry a schedule_type which
  // maps to red/cyan/pink/teal/amber/violet per Brief 37 Part 1.
  const scheduleEditorAccent = (() => {
    const t = editingSchedule?.schedule_type ?? 'occupancy'
    const map = {
      heating: '#DC2626', cooling: '#00AEEF', dhw: '#EC4899',
      ventilation: '#14B8A6', fans: '#14B8A6',
      lighting: '#F59E0B', small_power: '#8B5CF6',
      occupancy: '#8B5CF6', equipment: '#8B5CF6',
    }
    return map[t] ?? '#00AEEF'
  })()

  // Brief 38 polish + IM-M4 §8.1 contract: the centre Sankey + right Live
  // Results read from `consumption.space_heating` / `.space_cooling` /
  // `.dhw` / `.ventilation` etc. These remain populated by State 3's
  // existing `computeServiceEnergy` / `computeDhwFuelMix` /
  // `computeVentilationEnergy` paths regardless of whether Brief 40
  // `systems_config_v40` is also populated. The new Brief 40 per-system
  // breakdown surfaces on `consumption.brief40` and is consumed by the
  // left panel + the new "Diagnostic" centre tab.
  const sysCfg = params?.systems_config_v25 ?? {}
  const consumption = result?.consumption ?? null

  // Brief 40 Part 3 (2026-05-19): the legacy v25 updateSystem helper that
  // wrote into params.systems_config_v25 from the now-deleted v25 input
  // accordions has been retired. v40 write helpers live inside InputsColumn
  // (addSystem / updateSystem / removeSystem / saveSystemToLibrary), which
  // write through updateParam directly. v25 stays read-only here — Sankey +
  // Live Results consume it through `sysCfg` for cross-cutting visuals
  // (system labels, ventilation per-system enabled flags) until those
  // surfaces also migrate to v40 (follow-up brief).

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] relative">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 bg-white border-b border-light-grey px-6 pt-3 pb-3"
        style={{ borderTopWidth: '3px', borderTopColor: ACCENT, borderTopStyle: 'solid' }}
      >
        <NavLink to="/project" className="text-xxs text-mid-grey hover:text-navy transition-colors">
          ← Overview
        </NavLink>
        <p className="text-caption font-medium mt-0.5" style={{ color: ACCENT }}>Systems</p>
        <p className="text-xxs text-mid-grey">
          Heating, cooling, DHW, ventilation, lighting and small-power. Per-system
          on/off + efficiency inputs on the left; energy-flow Sankey, hourly
          profiles, schedules, monthly bars and a summary table in the centre;
          live EUI + fuel split on the right.
        </p>
      </div>

      {/* ── Three-column workspace ────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex">
        {/* LEFT: inputs ───────────────────────────────────────────────── */}
        {/* Brief 40 Part 3 (2026-05-19): per-service section list replacing
            the v25 tab-style column. Reads params.systems_config_v40 (Brief 40
            array shape); falls back to empty sections when absent (Bridgewater
            Part 5 migration populates v40 from v25). Per-system editing via
            SystemEditorCard + AddSystemButton with library save/load. */}
        <div className="flex-shrink-0 w-[320px] bg-white border-r border-light-grey overflow-y-auto">
          <InputsColumn
            params={params}
            updateParam={updateParam}
            consumption={consumption}
            comfortBand={comfortBand}
            openScheduleEditor={openScheduleEditor}
          />
        </div>

        {/* CENTRE: view switcher ────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col bg-off-white">
          <div className="flex-shrink-0 flex items-center gap-0 border-b border-light-grey bg-white px-2 pt-2">
            {CENTRE_TABS.map(t => {
              const active = t.id === centreView
              return (
                <button
                  key={t.id}
                  onClick={() => setCentreView(t.id)}
                  className={`px-3 py-1.5 text-caption transition-colors border-b-2 -mb-px ${
                    active ? 'border-navy text-navy font-medium' : 'border-transparent text-mid-grey hover:text-navy'
                  }`}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
          <ChartExportCard
            noChrome
            title={`Systems — ${CENTRE_TABS.find(t => t.id === centreView)?.label ?? 'View'}`}
            className="flex-1 min-h-0 overflow-hidden"
          >
            {!consumption && (
              <div className="h-full flex items-center justify-center text-mid-grey text-xxs">
                Engine output not ready — load weather data + library.
              </div>
            )}
            {/* Brief 53 Part 3 (2026-05-26): Heat balance Sankey — the
                demand-shaping picture (gains in → zone → losses out) that
                Chris wants visible BEFORE the system overlay (energy-flow
                Sankey below). After Brief 53 Part 4, the FULL loss order
                renders fabric_leakage + permanent_vents + thermal_bridging
                explicitly, so the +10 residual is gone (now ≈ −0.44 ✓
                balanced). After Brief 53 Part 2, summer_bypass on a vent
                system suppresses recovery in cooling-mode hours; the
                visible signature is the COOLING ribbon shrinking (e.g.
                refbox HOT 15.40 → 13.50 MWh) as the bypass damper opens.
                Reactivity: result.heat_balance is part of the memoised
                `result` above; any input edit triggers re-render. */}
            {consumption && centreView === 'heatbalance' && (
              <HeatBalance
                liveData={result?.heat_balance}
                mode="full"
                modules={null}
                orientationDeg={orientation}
              />
            )}
            {consumption && centreView === 'sankey' && (
              <SystemsSankey
                consumption={consumption}
                sysCfg={sysCfg}
                sysCfgV40={params?.systems_config_v40}
                giaM2={result?.metadata?.gia_m2 ?? result?.heat_balance?.metadata?.gia_m2 ?? 0}
                // Brief 74 P6 (2026-06-01): auxiliary loads electricity from
                // State 2 emit, in MWh. Threaded explicitly because the
                // Energy Flows Sankey items[] reads from `consumption` only,
                // and `consumption` doesn't carry an `auxiliary` rollup —
                // the auxiliary numbers live at
                // result.heat_balance.annual.gains.internal.auxiliary.
                // Falls back to 0 when the engine reports no aux profiles.
                auxElecMwh={(result?.heat_balance?.annual?.gains?.internal?.auxiliary?.electricity_kwh ?? 0) / 1000}
              />
            )}
            {/* Brief 70 Part 1: zone-temperature heatmap + KPI strip.
                Reads result.demand.hourly_zone_air_c etc. — no engine work,
                pure renderer of what Brief 67/69 already exposes. */}
            {centreView === 'zonetemp' && (
              <ZoneTempTab result={result} />
            )}
            {consumption && centreView === 'profiles' && (
              <SystemsProfiles result={result} />
            )}
            {consumption && centreView === 'schedule' && (
              <SystemsSchedule
                sysCfg={sysCfg}
                sysCfgV40={params?.systems_config_v40}
                params={params}
                openScheduleEditor={openScheduleEditor}
              />
            )}
            {consumption && centreView === 'monthly' && (
              <SystemsMonthly consumption={consumption} result={result} />
            )}
            {consumption && centreView === 'rejection' && (
              <SystemsRejection consumption={consumption} sysCfg={sysCfg} />
            )}
            {consumption && centreView === 'diagnostic' && (
              <SystemsDiagnosticPanel consumption={consumption} />
            )}
            {consumption && centreView === 'summary' && (
              <SystemsSummary consumption={consumption} />
            )}
          </ChartExportCard>
        </div>

        {/* RIGHT: Live Results — Brief 28-IM-Polish POL-M2 IA 3.2.
            Canonical 4-KPI strip at the TOP (matches Building / Operation
            pattern); the existing detail panel below acts as the fuel-
            split + per-system mini-diagnostic. */}
        <div className="flex-shrink-0 w-[340px] bg-white border-l border-light-grey overflow-y-auto flex flex-col">
          <SystemsLiveResultsStrip consumption={consumption} />
          <LiveResultsPanel consumption={consumption} />
        </div>
      </div>

      {/* Brief 36 Part 3 (chrome) + Brief 37 Part 3 (body): SchedulePopout
          replaces the legacy inset-0 modal; UnifiedScheduleEditor replaces
          the legacy profiles/ScheduleEditor body. Accent is service-coloured
          per the schedule's schedule_type (heating red / cooling cyan /
          DHW pink / ventilation teal / lighting amber / small power violet). */}
      <SchedulePopout
        isOpen={!!editingSchedule}
        onClose={() => setEditingSchedule(null)}
        title={editingSchedule ? `Schedule · ${editingSchedule.display_name ?? editingSchedule.name ?? 'untitled'}` : 'Schedule editor'}
        accent={scheduleEditorAccent}
        persistKey="nza-schedule-popout-position-systems"
      >
        {editingSchedule && (
          <UnifiedScheduleEditor
            schedule={editingSchedule}
            onChange={(next) => setEditingSchedule(prev => ({ ...prev, ...next }))}
            accent={scheduleEditorAccent}
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
   LEFT COLUMN — per-service section list (Brief 40 Part 3 rewrite)
   ─────────────────────────────────────────────────────────────────────── */

const SERVICES_IN_ORDER = ['heating', 'cooling', 'dhw', 'ventilation', 'lighting', 'small_power']
const SERVICE_LABEL_BY_KEY = {
  heating:     'Heating',
  cooling:     'Cooling',
  dhw:         'DHW',
  ventilation: 'Ventilation',
  lighting:    'Lighting',
  small_power: 'Small power',
}

/**
 * InputsColumn — Brief 40 v40 systems editor. Brief 46 Part 4
 * (2026-05-22) exported so the editor's SystemsSection composer can
 * mount the same per-service editor; writeV40 routes through
 * useProjectMutation so capture mode lands a whole-`systems_config_v40`
 * snapshot patch on every edit (add/update/remove/share/normalise/
 * service-level all share the same writeV40 path).
 *
 * Library save (saveSystemToLibrary) and schedule save still write
 * directly via updateParam — those targets aren't intervention-
 * patch-shaped (library is global, schedules are deferred per Q1).
 */
export function InputsColumn({ params, updateParam, consumption, comfortBand, openScheduleEditor }) {
  // Brief 46 Part 4 (2026-05-22): mutate replaces direct updateParam
  // for writeV40 so the editor's capture context routes the patch.
  const { mutate } = useProjectMutation()
  // Brief 40 v40 array shape lives at params.systems_config_v40.{service}: []
  const v40 = params?.systems_config_v40 ?? null

  // Engine-side per-service block (consumption.brief40.{service}) — null when
  // engine result not ready or no Brief 40 config. Used for the inline
  // comfort-vs-setpoint diagnostic on each SystemEditorCard.
  const brief40 = consumption?.brief40 ?? null

  // Per-section open/collapsed state. Single-expand accordion (2026-05-20
  // walkthrough request): only one service section can be open at a time;
  // clicking another service closes the current one. Clicking the open
  // section collapses it (leaving nothing open). Heating is the default.
  const [open, setOpen] = useState({
    heating: true, cooling: false, dhw: false, ventilation: false, lighting: false, small_power: false,
  })
  const toggle = (k) => setOpen(o => {
    const wasOpen = !!o[k]
    const next = Object.fromEntries(Object.keys(o).map(key => [key, false]))
    if (!wasOpen) next[k] = true
    return next
  })

  // Brief 42 Part 3 (2026-05-20): per-system editing now happens in a
  // draggable pop-out (SystemEditorPopout), not inline-expand. State is
  // a single `editingKey` of shape `${service}:${systemId}` — null when
  // no system is being edited.
  const [editingKey, setEditingKey] = useState(null)
  const closeEditor = () => setEditingKey(null)

  // ── Write helpers ──────────────────────────────────────────────────────
  // Brief 40 schema: params.systems_config_v40 = { heating: [...], ... }.
  // Brief 42 (2026-05-20): also carries service-level (building-level)
  // fields directly on systems_config_v40 — heating/cooling setpoint mode
  // + custom value, DHW storage/tap/cold/demand. See audit doc 42 §2.
  // Maintain through-updateParam so the engine sees the change reactively.

  // Brief 46 Part 4: route through mutate so capture mode captures
  // the whole systems_config_v40 as a single patch. The 'building.'
  // prefix is the Brief 41 patch-path convention (see audit doc 41
  // §4 + useProjectMutation hook docstring); main-app mode strips
  // the prefix and falls through to updateParam('systems_config_v40',
  // next) — exact identity to the pre-refactor call shape.
  const writeV40 = (next) => mutate('building.systems_config_v40', next)
  const getList = (service) => Array.isArray(v40?.[service]) ? v40[service] : []

  // Brief 42 Part 3 service-level write helper: shallow-merges a patch of
  // building-level fields into systems_config_v40 (e.g. {
  // heating_setpoint_mode: 'custom', heating_setpoint_c: 22 }).
  const updateServiceLevel = (patch) => {
    writeV40({ ...(v40 ?? {}), ...patch })
  }

  const addSystem = (service, sys) => {
    const list = getList(service)
    // First system gets share 100; subsequent systems get the remainder.
    const used = list.reduce((s, x) => s + Number(x?.share_pct ?? 0), 0)
    const share_pct = list.length === 0 ? 100 : Math.max(0, 100 - used)
    const fresh = { ...sys, share_pct }
    const nextList = [...list, fresh]
    writeV40({ ...(v40 ?? {}), [service]: nextList })
    setEditingKey(`${service}:${fresh.id}`)
  }

  const updateSystem = (service, index, patch) => {
    const list = getList(service)
    const nextList = list.map((s, i) => i === index ? { ...s, ...patch } : s)
    writeV40({ ...(v40 ?? {}), [service]: nextList })
  }

  const removeSystem = (service, index) => {
    const list = getList(service)
    const nextList = list.filter((_, i) => i !== index)
    writeV40({ ...(v40 ?? {}), [service]: nextList })
  }

  // Library save — writes to params.library_systems[] (Brief 37 pattern,
  // namespaced by service via the entry's `service` field)
  const saveSystemToLibrary = (sys) => {
    const lib = Array.isArray(params?.library_systems) ? params.library_systems : []
    const libEntry = {
      ...sys,
      id: `lib_${sys.service}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      saved_at: new Date().toISOString(),
    }
    updateParam('library_systems', [...lib, libEntry])
  }

  // Brief 40 Part 5b Section B (2026-05-19): share-validation helper now
  // operates on ENABLED systems only — matches the engine's _validateShares
  // semantics. A disabled system's share_pct is preserved on disk but
  // excluded from the validation sum. Returns: sum, valid, allCount,
  // enabledCount, allDisabled.
  const shareValidation = (service) => {
    const list = getList(service)
    if (list.length === 0) return { sum: 0, valid: true, allCount: 0, enabledCount: 0, allDisabled: false }
    const enabledList = list.filter(s => s?.enabled !== false)
    if (enabledList.length === 0) return { sum: 0, valid: true, allCount: list.length, enabledCount: 0, allDisabled: true }
    const sum = enabledList.reduce((s, x) => s + Number(x?.share_pct ?? 0), 0)
    // Brief 73 P3-redux (2026-06-01): ventilation has NO share rule —
    // each fan runs at its OWN flow_rate × flow_rate_basis independently,
    // not splitting a shared demand. The engine guard at systemsEngine.js
    // _computeVentilation was removed in P3 (2026-05-29) and the loader
    // strips share_pct from persisted vent rows. The original P3 commit
    // gated the share UI at TWO surfaces (SystemEditorCard share input,
    // ServiceSplitBar Σ chip) but missed THREE more downstream surfaces
    // that consume `valid` from this helper: the section-header amber
    // chip (V40SectionHeader L994-1003), the inline "Engine will not
    // compute" warning + Normalise button (SystemsModule:925-934), and
    // SystemSummaryRow's row-level shareInvalid tint. All three render
    // amber-when-sum≠100, which fires permanently for vent because the
    // stripped share_pct → sum 0. Forcing `valid: true` at the source
    // closes all three downstream surfaces in one place — pattern parity
    // with the engine guard skip (single source of truth, not five). See
    // audit §3.6 for the full enumeration.
    if (service === 'ventilation') {
      return { sum, valid: true, allCount: list.length, enabledCount: enabledList.length, allDisabled: false }
    }
    return { sum, valid: Math.abs(sum - 100) < 0.5, allCount: list.length, enabledCount: enabledList.length, allDisabled: false }
  }

  // Brief 45 Part 3b (2026-05-21): auto-rebalance partner shares when the
  // user drags one system's share slider. Prior to this change, dragging
  // Primary heating from 95 → 70 would leave Secondary at 5, breaking
  // share validation (95% ≠ 100%) until the user manually matched the
  // partner slider or clicked Normalise. The two-sliders-must-match
  // friction Chris flagged.
  //
  // Behaviour:
  //   - Target system: clamps `next` to [0, 100], writes share_pct = next.
  //   - Other ENABLED systems in the same service: absorb the negated
  //     delta proportionally to their current shares so the enabled sum
  //     stays at 100%.
  //   - Disabled systems: untouched on disk.
  //   - Edge cases:
  //       · Single enabled system (no partner): just set the share —
  //         user must re-enable a partner or use Normalise to recover
  //         a valid sum.
  //       · Editing a disabled system's share: just set the value (the
  //         engine ignores disabled systems for sum-validation anyway).
  //       · Other enabled systems all at 0 before: split (100 − next)
  //         equally across them so the result is balanced rather than
  //         arbitrary.
  //       · Target moves to 100: other enabled systems all go to 0.
  //       · Target moves to 0: other enabled systems share 100 pro-rata
  //         to their previous shares (or equally if they were all 0).
  //
  // Engine validation rule unchanged — engine still refuses to compute
  // a service whose enabled shares sum ≠ 100%. The Normalise button
  // remains as a manual recovery surface. Brief 45 Part 3b only changes
  // the inline-slider UX so the SLIDER itself maintains the invariant.
  const handleShareChange = (service, idx, nextSharePct) => {
    const list = getList(service)
    const target = list[idx]
    if (!target) return
    const next = Math.max(0, Math.min(100, Number(nextSharePct) || 0))
    const prev = Number(target.share_pct ?? 0)
    if (Math.abs(next - prev) < 0.01) return

    const round1 = (v) => Math.round(v * 10) / 10
    const targetEnabled = target?.enabled !== false

    // If the dragged system is disabled, or no other enabled partners
    // exist, just set the share without redistributing.
    const otherEnabledIndices = list
      .map((s, i) => (i !== idx && s?.enabled !== false) ? i : -1)
      .filter(i => i >= 0)
    if (!targetEnabled || otherEnabledIndices.length === 0) {
      const nextList = list.map((s, i) => i === idx ? { ...s, share_pct: round1(next) } : s)
      writeV40({ ...(v40 ?? {}), [service]: nextList })
      return
    }

    // Distribute (100 − next) across the other enabled systems
    // proportionally to their current shares. If they were all at 0,
    // split equally.
    const otherSharesPrev = otherEnabledIndices.map(i => Number(list[i].share_pct ?? 0))
    const otherSumPrev = otherSharesPrev.reduce((s, v) => s + v, 0)
    const otherSumNew = Math.max(0, 100 - next)

    let otherSharesNew
    if (otherSumPrev > 0) {
      const scale = otherSumNew / otherSumPrev
      otherSharesNew = otherSharesPrev.map(v => v * scale)
    } else {
      const per = otherSumNew / otherEnabledIndices.length
      otherSharesNew = otherEnabledIndices.map(() => per)
    }

    const nextList = list.map((s, i) => {
      if (i === idx) return { ...s, share_pct: round1(next) }
      const pos = otherEnabledIndices.indexOf(i)
      if (pos === -1) return s   // disabled or somehow filtered out
      return { ...s, share_pct: round1(otherSharesNew[pos]) }
    })
    writeV40({ ...(v40 ?? {}), [service]: nextList })
  }

  // Normalise scales ENABLED systems proportionally to sum 100; disabled
  // systems' shares are untouched on disk.
  const normaliseShares = (service) => {
    const list = getList(service)
    if (list.length === 0) return
    const enabledIndices = list.map((s, i) => s?.enabled !== false ? i : -1).filter(i => i >= 0)
    if (enabledIndices.length === 0) return
    const enabledSum = enabledIndices.reduce((s, i) => s + Number(list[i].share_pct ?? 0), 0)
    let nextList
    if (enabledSum <= 0) {
      // All enabled systems at zero — distribute equally across enabled
      const per = 100 / enabledIndices.length
      nextList = list.map((s, i) => enabledIndices.includes(i) ? { ...s, share_pct: Math.round(per * 10) / 10 } : s)
    } else {
      const scale = 100 / enabledSum
      nextList = list.map((s, i) => enabledIndices.includes(i)
        ? { ...s, share_pct: Math.round(Number(s.share_pct ?? 0) * scale * 10) / 10 }
        : s)
    }
    writeV40({ ...(v40 ?? {}), [service]: nextList })
  }

  // Brief 40 Part 5b Section B: per-service batch enable toggle. A UX
  // shortcut, not a separate field — clicking flips `enabled` on every
  // system in the service at once. Mixed state always flips to all-
  // enabled (so user can always recover from a partial-off state).
  const setServiceEnabled = (service, nextEnabled) => {
    const list = getList(service)
    if (list.length === 0) return
    const nextList = list.map(s => ({ ...s, enabled: nextEnabled }))
    writeV40({ ...(v40 ?? {}), [service]: nextList })
  }
  const toggleServiceEnabled = (service) => {
    const list = getList(service)
    if (list.length === 0) return
    const allEnabled = list.every(s => s?.enabled !== false)
    setServiceEnabled(service, !allEnabled)   // all-on → off; off / mixed → on
  }

  // Brief 42 Part 3: resolve the currently-edited system + its engine row
  // for SystemEditorPopout. editingKey is `${service}:${systemId}`. We
  // re-derive on every render so a click → edit → onUpdate path always
  // reads fresh data (single-source-of-truth: params.systems_config_v40).
  let editingSystem = null
  let editingEngineSys = null
  let editingService = null
  let editingIdx = -1
  let editingValid = true
  if (editingKey) {
    const [svc, ...rest] = editingKey.split(':')
    const sysId = rest.join(':')   // ids may contain ':'
    const list = getList(svc)
    const idx = list.findIndex((s, i) => (s.id ?? String(i)) === sysId)
    if (idx >= 0) {
      editingService = svc
      editingIdx = idx
      editingSystem = list[idx]
      const engineSystems = brief40?.[svc]?.systems ?? []
      editingEngineSys = engineSystems.find(es => es.id === editingSystem.id) ?? null
      editingValid = shareValidation(svc).valid
    }
  }

  // Brief 64 §B (2026-05-27) — control_strategy is a building-wide
  // demand-model selector that affects how _calculateState2 derives
  // heating/cooling demand against the setpoints. The choice is visible
  // and explicit here at the top of the Systems left panel because it
  // governs every service's demand integral. Two options per Brief 64:
  //   'active_setpoint' (default) — the clamp; system holds setpoint
  //     every hour the free-running zone would exceed/fall-below it.
  //   'free_running' — passive only; cooling occurs only when weather
  //     assists. NOT labelled "weather-compensated" — that term means
  //     heating flow-temperature modulation and would mislabel the
  //     physics here.
  // Writes route through mutate so intervention-capture mode can patch
  // this field too (an intervention can switch a building from active
  // to free-running at a future stage of a retrofit).
  const controlStrategy = (params?.control_strategy === 'free_running')
    ? 'free_running'
    : 'active_setpoint'
  const setControlStrategy = (val) => mutate('building.control_strategy', val)

  // 2026-05-28 (Chris-flag): control-strategy panel collapsed by default
  // to free up vertical space in the left panel. Compact one-line summary
  // shows the current selection; click to expand for the radios + helper
  // text. Same pattern as the Zone-temperature info popover landed today.
  const [csOpen, setCsOpen] = useState(false)

  return (
    <div className="p-3 space-y-2">
      {/* Brief 64 §B — building-wide demand-model selector. Compact header
          row + collapsible body so the descriptive text doesn't eat the
          left panel. */}
      <div className="border border-light-grey/60 rounded bg-off-white/30 mb-1">
        <button
          type="button"
          onClick={() => setCsOpen(o => !o)}
          className="w-full flex items-center justify-between gap-2 px-2 py-1.5 hover:bg-off-white/50 transition-colors rounded"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xxs uppercase tracking-wider text-mid-grey font-medium">
              Control strategy
            </span>
            <span className="text-xxs text-navy font-medium truncate">
              {controlStrategy === 'active_setpoint' ? 'Active setpoint' : 'Free-running'}
            </span>
          </div>
          <ChevronDown
            size={12}
            className="text-mid-grey flex-shrink-0 transition-transform"
            style={{ transform: csOpen ? 'rotate(180deg)' : 'none' }}
          />
        </button>
        {csOpen && (
          <div className="px-2 pb-2 pt-1 space-y-1.5 border-t border-light-grey/60">
            <div className="flex items-start gap-2 text-xxs">
              <input
                type="radio"
                id="cs_active"
                checked={controlStrategy === 'active_setpoint'}
                onChange={() => setControlStrategy('active_setpoint')}
                className="mt-0.5 flex-shrink-0"
              />
              <label htmlFor="cs_active" className="flex-1 cursor-pointer">
                <span className={controlStrategy === 'active_setpoint' ? 'text-navy font-medium' : 'text-mid-grey'}>
                  Active setpoint (hold to temperature)
                </span>
                <span className="block text-xxs text-mid-grey/70 mt-0.5">
                  The system holds the cooling / heating setpoint regardless of outdoor temperature.
                  Use this for a properly-conditioned building.
                </span>
              </label>
            </div>
            <div className="flex items-start gap-2 text-xxs">
              <input
                type="radio"
                id="cs_free"
                checked={controlStrategy === 'free_running'}
                onChange={() => setControlStrategy('free_running')}
                className="mt-0.5 flex-shrink-0"
              />
              <label htmlFor="cs_free" className="flex-1 cursor-pointer">
                <span className={controlStrategy === 'free_running' ? 'text-navy font-medium' : 'text-mid-grey'}>
                  Free-running / passive only (no active cooling)
                </span>
                <span className="block text-xxs text-mid-grey/70 mt-0.5">
                  The building relies on envelope + ventilation; cooling only occurs when the weather assists.
                  Use this to show overheating risk for a naturally-ventilated or mixed-mode design.
                </span>
              </label>
            </div>
          </div>
        )}
      </div>

      {SERVICES_IN_ORDER.map(service => {
        const list = getList(service)
        const isOpen = open[service]
        const accent = SERVICE_COLOURS[service] ?? '#00AEEF'
        const { sum, valid, enabledCount, allDisabled } = shareValidation(service)
        return (
          <V40SectionHeader
            key={service}
            service={service}
            label={SERVICE_LABEL_BY_KEY[service]}
            accent={accent}
            open={isOpen}
            onToggle={() => toggle(service)}
            count={list.length}
            enabledCount={enabledCount}
            allDisabled={allDisabled}
            shareSum={sum}
            shareValid={valid}
            onToggleServiceEnabled={() => toggleServiceEnabled(service)}
          >
            {/* Brief 42 Part 3: service-level (building-level) field editor
                rendered above the system list. Returns null for services
                without building-level fields (ventilation/lighting/small_power). */}
            <ServiceSectionHeader
              service={service}
              serviceLevel={v40}
              comfortBand={comfortBand}
              onUpdateServiceLevel={updateServiceLevel}
            />

            {list.length > 0 && (
              <div className="space-y-1.5">
                {/* Brief 45 Part 3 (2026-05-21): per-service share split
                    visualisation. Renders the share allocation across
                    all systems in this service (including disabled,
                    shown hatched) as a single horizontal bar so the
                    user can read the split at a glance without summing
                    individual rows mentally. */}
                {/* Brief 73 P3 (2026-05-29): ServiceSplitBar skipped for
                    ventilation — see Brief 73 §2. Vent systems don't
                    split a shared demand (each fan runs at its own flow),
                    so the Σ NN% chip's amber-when-not-100% logic is
                    physically meaningless here. */}
                {service !== 'ventilation' && (
                  <ServiceSplitBar service={service} systems={list} />
                )}

                {/* Brief 47 Part 3 (2026-05-24): share-rebalance flow
                    clarity — surface the Brief 45 Part 3b auto-rebalance
                    behaviour with a one-line hint when 2+ systems are
                    enabled in this service. Hidden when there's only
                    one enabled system (no partner to rebalance). */}
                {enabledCount >= 2 && (
                  <p className="text-xxs italic text-mid-grey/80 px-1.5 -mt-0.5 mb-1">
                    Drag a share slider to rebalance partners — enabled sum stays at 100%.
                  </p>
                )}

                {list.map((sys, idx) => {
                  const key = `${service}:${sys.id ?? idx}`
                  // Brief 47 Part 3: count of OTHER enabled systems in
                  // this service. SystemSummaryRow's tooltip uses this
                  // to explain the auto-rebalance behaviour when the
                  // user hovers the share slider.
                  const partnerCount = (sys?.enabled !== false)
                    ? Math.max(0, enabledCount - 1)
                    : 0
                  return (
                    <SystemSummaryRow
                      key={key}
                      system={sys}
                      onToggleEnabled={() => updateSystem(service, idx, { enabled: !(sys?.enabled !== false) })}
                      onEdit={() => setEditingKey(key)}
                      // Brief 45 Part 3b (2026-05-21): handleShareChange
                      // auto-rebalances the other enabled systems in this
                      // service so the enabled sum stays at 100% without
                      // the user matching two sliders manually.
                      onShareChange={(next) => handleShareChange(service, idx, next)}
                      // 2026-05-26: generic partial update so the row's
                      // inline ventilation flow_rate input can write
                      // through directly. Bypasses handleShareChange's
                      // partner-rebalancing logic (which is share-%
                      // specific and not meaningful for fixed-flow vent).
                      onUpdate={(patch) => updateSystem(service, idx, patch)}
                      // Brief 47 Part 1.3 (2026-05-24): list-level delete
                      // affordance — same `removeSystem` helper the
                      // pop-out's onDelete uses. In the main /systems
                      // page this writes through to ProjectContext; in
                      // the intervention editor it routes via
                      // writeV40 → mutate → capturePatch (Brief 46 Part 4).
                      onDelete={() => removeSystem(service, idx)}
                      enabledPartnerCount={partnerCount}
                      shareInvalid={!valid}
                    />
                  )
                })}
                {!valid && !allDisabled && (
                  <div className="flex items-center gap-2 px-1.5 py-1 text-xxs text-amber-700 bg-amber-50 border border-amber-200 rounded">
                    <span>⚠ Shares of enabled systems sum to {sum.toFixed(1)}%, not 100%. Engine will not compute this service until fixed.</span>
                    <button
                      onClick={() => normaliseShares(service)}
                      className="ml-auto px-1.5 py-0.5 rounded border border-amber-300 hover:bg-amber-100 transition-colors flex-shrink-0"
                    >
                      Normalise
                    </button>
                  </div>
                )}
                {allDisabled && (
                  <div className="flex items-center gap-2 px-1.5 py-1 text-xxs text-mid-grey bg-light-grey/30 border border-light-grey rounded">
                    <span>All systems in this service are disabled. Service delivered = 0.</span>
                  </div>
                )}
              </div>
            )}
            {list.length === 0 && (
              <p className="text-xxs text-mid-grey/80 italic mb-1.5">No {SERVICE_LABEL_BY_KEY[service].toLowerCase()} systems yet.</p>
            )}
            <AddSystemButton
              service={service}
              librarySystems={params?.library_systems ?? []}
              onAdd={(sys) => addSystem(service, sys)}
            />
          </V40SectionHeader>
        )
      })}

      {/* Brief 42 Part 3: per-system editor lives in a draggable pop-out.
          Mounted once at the column root, opened by SystemSummaryRow's
          edit button. localStorage position key:
          nza-system-editor-popout-position (set inside SystemEditorPopout). */}
      <SystemEditorPopout
        system={editingSystem}
        engineSystem={editingEngineSys}
        comfortBand={comfortBand}
        onUpdate={(patch) => editingIdx >= 0 && updateSystem(editingService, editingIdx, patch)}
        onDelete={() => editingIdx >= 0 && removeSystem(editingService, editingIdx)}
        onSaveToLibrary={saveSystemToLibrary}
        openScheduleEditor={openScheduleEditor}
        shareInvalid={!editingValid}
        onClose={closeEditor}
      />
    </div>
  )
}

function V40SectionHeader({ service, label, accent, open, onToggle, count, enabledCount, allDisabled, shareSum, shareValid, onToggleServiceEnabled, children }) {
  // Brief 40 Part 5b Section B (2026-05-19): per-service batch enable
  // toggle. Click flips `enabled` on every system in the service at
  // once. Mixed state always flips to all-enabled (recover-from-partial
  // pattern). Tooltip describes the action.
  const allEnabled = count > 0 && enabledCount === count
  const batchTitle = allEnabled
    ? `Disable all ${label.toLowerCase()} systems`
    : `Enable all ${label.toLowerCase()} systems`
  return (
    <div>
      <div
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded text-left transition-opacity"
        style={{ backgroundColor: accent }}
      >
        <button
          onClick={onToggle}
          className="flex items-center gap-2 flex-1 text-left"
        >
          <span className="text-white text-xxs font-semibold uppercase tracking-wider">{label}</span>
          {count > 0 && (
            <span className="text-white/85 text-xxs bg-black/15 px-1.5 py-0.5 rounded" title={`${enabledCount} of ${count} enabled`}>
              {enabledCount === count ? count : `${enabledCount}/${count}`}
            </span>
          )}
          {count > 0 && !shareValid && !allDisabled && (
            <span className="text-white text-xxs bg-amber-600 px-1.5 py-0.5 rounded" title={`Shares of enabled systems sum to ${shareSum.toFixed(1)}%`}>
              ⚠ {shareSum.toFixed(0)}%
            </span>
          )}
          {allDisabled && (
            <span className="text-white/80 text-xxs bg-black/25 px-1.5 py-0.5 rounded" title="All systems disabled">
              off
            </span>
          )}
        </button>
        <div className="flex items-center gap-1">
          {count > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleServiceEnabled?.() }}
              className="flex-shrink-0 p-0.5 rounded hover:bg-black/20 transition-colors"
              title={batchTitle}
            >
              <span
                className="block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: allEnabled ? '#FFFFFF' : 'rgba(255,255,255,0.4)' }}
              />
            </button>
          )}
          <button
            onClick={onToggle}
            className="flex-shrink-0 text-white/70 text-xs leading-none px-1"
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? '▾' : '▸'}
          </button>
        </div>
      </div>
      {open && (
        <div className="pt-2 pb-1 px-1 space-y-1.5">{children}</div>
      )}
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   CENTRE — SANKEY (inline SVG, demand → systems → carriers)
   ─────────────────────────────────────────────────────────────────────── */
// fmtSys: snake_case → spaced; common acronyms upper-cased.
function fmtSys(s) {
  if (!s) return ''
  return s
    .replace(/_/g, ' ')
    .replace(/\b(vrf|ashp|mvhr|mev|dhw|led|hvac|hp|sfp|cop|eer|seer)\b/gi, m => m.toUpperCase())
    .replace(/^\w/, ch => ch.toUpperCase())
}

/**
 * Brief 47 Part 5c (2026-05-24) — top-bar kWh / kWh/m²·yr toggle finding.
 *
 * The Sankey now reads the global `unit` from UISettingsContext and a
 * `giaM2` prop (passed from the engine result's metadata) and formats
 * every visible flow figure + tooltip via `fmtFlow`:
 *
 *   unit === 'kwh'         → "X.X MWh"          (existing default)
 *   unit === 'kwh_per_m2'  → "X.X kWh/m²·yr"    (mwh * 1000 / gia)
 *
 * If giaM2 isn't available the formatter falls back to MWh regardless
 * of the toggle (no synthetic divisor; CLAUDE.md Rule 2 "never generate
 * synthetic data").
 *
 * The flows themselves stay drawn in MWh space — the per-pixel scale is
 * unaffected. Only the printed labels change. The Sankey's geometry
 * (column widths, ribbon tapers, demand-driven scale) is unchanged.
 */
function fmtFlow(mwh, unit, giaM2) {
  if (!Number.isFinite(mwh)) return '—'
  if (unit === 'kwh_per_m2' && giaM2 > 0) {
    const kwhPerM2 = (mwh * 1000) / giaM2
    return `${kwhPerM2.toFixed(1)} kWh/m²·yr`
  }
  return `${mwh.toFixed(1)} MWh`
}

function SystemsSankey({ consumption, sysCfg, sysCfgV40, giaM2 = 0, auxElecMwh = 0 }) {
  const { unit } = useUISettings()
  // Three-column Sankey per Chris's walkthrough call (2026-05-19, second
  // iteration):
  //   LEFT   — Demand bars (Heating, Cooling, DHW, Mech vent, Lighting, SP)
  //   MIDDLE — System annotation (small italic text, no box). The flow
  //            visually NECKS DOWN through here: source-side width is the
  //            demand share served by this branch, target-side width is the
  //            fuel consumed. The taper IS the SCOP/efficiency.
  //   RIGHT  — Energy carrier: Electricity (top) + Gas (bottom), no Waste.
  //
  // Waste (cooling condenser, MEV/MVHR exhaust, flue losses) is intentionally
  // out of scope of THIS view — it dominated the layout in the previous pass
  // because cooling's reject (delivered + elec) is bigger than cooling demand.
  // Heat-rejection visual is a separate widget on the docket.
  //
  // Flows are drawn as proper Sankey ribbons (filled tapered polygons), not
  // constant-width strokes — so the demand → fuel transformation reads
  // visually as a width change through the system column.
  //
  // Unserved heating: demand bar drawn faint, name suffixed " (off)", system
  // label "(off — no system)", no ribbons.

  const c = consumption ?? {}
  const ventList    = c.ventilation ?? []
  const ventListCfg = sysCfg.ventilation ?? []
  const fan_total   = ventList.reduce((s, v) => s + (v.fan_electricity_mwh ?? 0), 0)

  const dhwMix      = c.dhw?.fuel_mix_applied ?? null
  const dhwIsMixed  = !!dhwMix && (dhwMix.heat_pump ?? 0) > 0 && (dhwMix.gas ?? 0) > 0
  const dhwIsAshpPreheat = (dhwMix?.heat_pump ?? 0) > 0

  // Branches for heating / cooling come from the engine's primary + secondary
  // perf objects (added to consumption in Brief 38 2026-05-19) — preserves
  // the per-system identity (primary VRF vs secondary electric panel) and
  // their individual efficiencies, even when both end up consuming the same
  // fuel. DHW uses fuel_mix_applied (existing engine output).
  function branchesFromPerfPair(primary, secondary) {
    const out = []
    if (primary && primary.delivered_mwh > 0.01) {
      out.push({
        role:           'primary',
        fuel:           primary.fuel,
        delivered_mwh:  primary.delivered_mwh,
        fuel_mwh:       primary.fuel_mwh,
        efficiency:     primary.efficiency,
      })
    }
    if (secondary && secondary.delivered_mwh > 0.01) {
      out.push({
        role:           'secondary',
        fuel:           secondary.fuel,
        delivered_mwh:  secondary.delivered_mwh,
        fuel_mwh:       secondary.fuel_mwh,
        efficiency:     secondary.efficiency,
      })
    }
    return out
  }

  function branchesFromFuelMix(delivered, e_mwh, g_mwh, mix) {
    if (!delivered || delivered < 0.01) return []
    const branches = []
    if (mix && (mix.heat_pump ?? 0) > 0 && (mix.gas ?? 0) > 0) {
      const total = (mix.heat_pump ?? 0) + (mix.gas ?? 0)
      const elec_delivered = delivered * mix.heat_pump / total
      const gas_delivered  = delivered * mix.gas       / total
      branches.push({
        role: 'primary',  fuel: 'electricity',
        delivered_mwh: elec_delivered, fuel_mwh: e_mwh,
        efficiency: e_mwh > 0 ? elec_delivered / e_mwh : 1,
      })
      branches.push({
        role: 'secondary', fuel: 'gas',
        delivered_mwh: gas_delivered, fuel_mwh: g_mwh,
        efficiency: g_mwh > 0 ? gas_delivered / g_mwh : 1,
      })
    } else if (e_mwh > 0.01) {
      branches.push({
        role: 'primary', fuel: 'electricity',
        delivered_mwh: delivered, fuel_mwh: e_mwh,
        efficiency: e_mwh > 0 ? delivered / e_mwh : 1,
      })
    } else if (g_mwh > 0.01) {
      branches.push({
        role: 'primary', fuel: 'gas',
        delivered_mwh: delivered, fuel_mwh: g_mwh,
        efficiency: g_mwh > 0 ? delivered / g_mwh : 1,
      })
    }
    return branches
  }

  // 2026-05-21 — Brief 44 Part 5 follow-up. The v25 fuel_mix path
  // (above) over-attributes delivered to gas on Bridgewater (80/20 v25
  // vs 65/35 v40), producing hover tooltips like "269 MWh ÷ 0.90 =
  // 242.9" where the math doesn't actually balance (269 / 0.9 = 298,
  // not 242.9). When the engine's brief40.dhw.systems block is
  // present, build branches directly from per-system delivered_mwh +
  // source_energy_mwh + efficiency so tooltips read true.
  function branchesFromV40Dhw(brief40Dhw) {
    if (!brief40Dhw || !Array.isArray(brief40Dhw.systems) || brief40Dhw.systems.length === 0) {
      return null
    }
    const out = []
    for (const s of brief40Dhw.systems) {
      const delivered_mwh = s.delivered_mwh ?? 0
      const fuel_mwh      = s.source_energy_mwh ?? 0
      if (delivered_mwh < 0.01 && fuel_mwh < 0.01) continue
      const fuel = s.source_fuel ?? 'electricity'
      out.push({
        role: out.length === 0 ? 'primary' : 'secondary',
        fuel,
        delivered_mwh,
        fuel_mwh,
        efficiency: s.efficiency ?? (fuel_mwh > 0 ? delivered_mwh / fuel_mwh : 1),
        // Carry the per-system label so the Sankey label loop can use it
        // directly without re-matching by fuel.
        v40_id:    s.id,
        v40_label: s.label,
      })
    }
    return out.length > 0 ? out : null
  }

  function branchesElectricOneToOne(mwh) {
    if (!mwh || mwh < 0.01) return []
    return [{ role: 'primary', fuel: 'electricity', delivered_mwh: mwh, fuel_mwh: mwh, efficiency: 1 }]
  }

  const items = [
    {
      key: 'space_heating', label: 'Heating',
      demand:    c.space_heating?.demand_mwh    ?? 0,
      delivered: c.space_heating?.delivered_mwh ?? 0,
      branches:  branchesFromPerfPair(c.space_heating?.primary, c.space_heating?.secondary),
    },
    {
      key: 'space_cooling', label: 'Cooling',
      demand:    c.space_cooling?.demand_mwh    ?? 0,
      delivered: c.space_cooling?.delivered_mwh ?? 0,
      branches:  branchesFromPerfPair(c.space_cooling?.primary, c.space_cooling?.secondary),
    },
    {
      key: 'dhw', label: 'DHW',
      demand:    c.dhw?.demand_mwh    ?? 0,
      delivered: c.dhw?.delivered_mwh ?? 0,
      // Prefer the v40 per-system branches when available (post-Brief-42
      // engine output via consumption.brief40.dhw.systems). This keeps the
      // delivered split + per-system efficiency + fuel attribution all
      // sourced from the same per-system calculation, so the Sankey
      // hover tooltips show math that actually balances.
      branches:  branchesFromV40Dhw(c.brief40?.dhw)
                 ?? branchesFromFuelMix(
                      c.dhw?.delivered_mwh ?? 0,
                      c.dhw?.electricity_mwh ?? 0,
                      c.dhw?.gas_mwh ?? 0,
                      dhwMix,
                    ),
    },
    {
      key: 'fans', label: 'Mech vent',
      demand:    fan_total,
      delivered: fan_total,
      branches:  branchesElectricOneToOne(fan_total),
    },
    {
      key: 'lighting', label: 'Lighting',
      demand:    c.lighting?.electricity_mwh ?? 0,
      delivered: c.lighting?.electricity_mwh ?? 0,
      branches:  branchesElectricOneToOne(c.lighting?.electricity_mwh ?? 0),
    },
    {
      key: 'small_power', label: 'Small power',
      demand:    c.small_power?.electricity_mwh ?? 0,
      delivered: c.small_power?.electricity_mwh ?? 0,
      branches:  branchesElectricOneToOne(c.small_power?.electricity_mwh ?? 0),
    },
    // Brief 74 P6 (2026-06-01): auxiliary loads on the Energy Flows Sankey.
    // 1:1 electricity (no system inflation — auxiliary is direct plug load),
    // value sourced from State 2 emit via the auxElecMwh prop. P3's port to
    // `result.systems_flow` (engine side) turned out not to feed this view —
    // SystemsSankey reads `consumption` + items[] and never touches
    // `result.systems_flow`. The render-layer fix lives here. Audit §6.
    {
      key: 'auxiliary', label: 'Auxiliary',
      demand:    auxElecMwh,
      delivered: auxElecMwh,
      branches:  branchesElectricOneToOne(auxElecMwh),
    },
  ].filter(it => it.demand > 0.01)

  for (const it of items) {
    it.isUnserved = it.demand > 0.01 && it.delivered < 0.01
  }

  // ── Per-branch labels (Brief 38, walkthrough #4 + #5) ───────────────────
  // Rule: label a branch if either (a) the ribbon visually tapers/widens
  // (efficiency != 1) OR (b) the row has more than one branch (so the user
  // can see which system is which). Single-branch rows at 1:1 efficiency
  // (lighting, small power, mech vent fans) get no label.
  //
  // System name source per item.key:
  //   - heating  → sysCfg.heating.{primary|secondary}.library_id by role
  //   - cooling  → sysCfg.cooling.{primary|secondary}.library_id by role
  //   - dhw (mixed) → generic by fuel: 'ASHP' / 'Gas boiler'
  //   - dhw (single) → sysCfg.dhw.primary.library_id
  //
  // Efficiency text:
  //   - eff > 1 + cooling row → 'EER X.X'
  //   - eff > 1 elsewhere     → 'SCOP X.X'
  //   - eff < 1               → 'X% eff'
  //   - eff ≈ 1               → no efficiency suffix (the system name alone)
  const EFF_TOLERANCE = 0.05
  for (const it of items) {
    const isMultiBranch = it.branches.length > 1
    for (const br of it.branches) {
      const eff = br.fuel_mwh > 0 ? br.delivered_mwh / br.fuel_mwh : 1
      br.efficiency = eff
      const hasEffChange = Math.abs(eff - 1) > EFF_TOLERANCE

      // Drop the label entirely only when the row is single-branch AND 1:1.
      if (!hasEffChange && !isMultiBranch) {
        br.sysName = null; br.effText = null; continue
      }

      const effText = !hasEffChange
        ? null
        : eff > 1
          ? `SCOP ${eff.toFixed(1)}`
          : `${Math.round(eff * 100)}% eff`

      if (it.key === 'space_heating') {
        const cfg = br.role === 'secondary' ? sysCfg.heating?.secondary : sysCfg.heating?.primary
        br.sysName = fmtSys(cfg?.library_id ?? '')
        br.effText = effText
      } else if (it.key === 'space_cooling') {
        const cfg = br.role === 'secondary' ? sysCfg.cooling?.secondary : sysCfg.cooling?.primary
        br.sysName = fmtSys(cfg?.library_id ?? '')
        br.effText = hasEffChange ? `EER ${eff.toFixed(1)}` : null
      } else if (it.key === 'dhw') {
        // 2026-05-21 fix (Brief 44 Part 5 follow-up). When the v40 branch
        // builder ran (branchesFromV40Dhw), each branch already carries
        // its v40_label + v40_id + accurate efficiency. Prefer that.
        // Fall back to per-fuel-source v40 config lookup (legacy path
        // for v25-fuel-mix branches), and to v25 sysCfg as a last
        // resort for pre-Brief-42 projects.
        if (br.v40_label || br.v40_id) {
          br.sysName = br.v40_label ?? br.v40_id
          br.effText = br.efficiency >= 1
            ? `SCOP ${br.efficiency.toFixed(1)}`
            : `${Math.round(br.efficiency * 100)}% eff`
        } else {
          // Legacy v25-fuel-mix branch path
          const v40DhwSystems = Array.isArray(sysCfgV40?.dhw) ? sysCfgV40.dhw : []
          const isGasSrc = (s) => s === 'gas' || s === 'oil' || s === 'biomass' || s === 'district_heating'
          const matchedV40 = v40DhwSystems.find(s => {
            if (s?.enabled === false) return false
            if (br.fuel === 'electricity') return s?.source === 'ambient_air'
                                             || s?.source === 'ambient_ground'
                                             || s?.source === 'electricity'
                                             || s?.source === 'solar_thermal_assisted'
            if (br.fuel === 'gas')         return isGasSrc(s?.source)
            return false
          })
          const effFromConfig = Number(matchedV40?.efficiency_metric ?? NaN)
          if (Number.isFinite(effFromConfig) && effFromConfig > 0) {
            br.efficiency = effFromConfig
            br.effText = effFromConfig >= 1
              ? `SCOP ${effFromConfig.toFixed(1)}`
              : `${Math.round(effFromConfig * 100)}% eff`
            br.sysName = matchedV40?.label
                       ?? (isMultiBranch ? (br.fuel === 'electricity' ? 'ASHP' : 'Gas boiler')
                                          : fmtSys(sysCfg.dhw?.primary?.library_id ?? ''))
          } else {
            br.effText = effText
            br.sysName = isMultiBranch
              ? (br.fuel === 'electricity' ? 'ASHP' : 'Gas boiler')
              : fmtSys(sysCfg.dhw?.primary?.library_id ?? '')
          }
        }
      } else {
        br.sysName = null
        br.effText = null
      }

      // 2026-05-21 — Brief 44 Part 5 follow-up: hover tooltip on each Sankey
      // ribbon so the user can verify the math (demand × efficiency =
      // fuel). Per Chris's request: "demand X kWh based on a SCOP of 2.5;
      // electricity used = X / 2.5". Format:
      //   <System name>
      //   Demand (delivered):  X.X MWh
      //   <Efficiency label>:  N.NN  (SCOP / SEER / η / EER)
      //   Fuel consumed:       D / E = F.F MWh <fuel name>
      // SVG <title> renders as a native browser tooltip; no JS hover state
      // needed.
      const deliveredMwh = br.delivered_mwh
      const fuelMwh      = br.fuel_mwh
      const effForLabel  = br.efficiency
      const fuelName     = br.fuel === 'electricity' ? 'electricity' : (br.fuel === 'gas' ? 'gas' : 'fuel')
      const effLabel = it.key === 'space_cooling'
        ? (effForLabel >= 1 ? `SEER ${effForLabel.toFixed(2)}` : `η ${effForLabel.toFixed(2)}`)
        : (effForLabel >= 1 ? `SCOP ${effForLabel.toFixed(2)}` : `η ${effForLabel.toFixed(2)}`)
      const nameStr = br.sysName ?? `${it.label} (${br.role ?? 'primary'})`
      // Brief 47 Part 5c: tooltip respects the global unit toggle. The
      // calc itself (MWh / efficiency) stays in MWh so the "÷ SCOP =
      // fuel MWh" identity reads naturally; the leading + trailing
      // figures swap to kWh/m²·yr when the toggle is set.
      const deliveredStr = fmtFlow(deliveredMwh, unit, giaM2)
      const fuelStr      = fmtFlow(fuelMwh, unit, giaM2)
      const calcStr = effForLabel > 0
        ? `${deliveredStr} ÷ ${effForLabel.toFixed(2)} = ${fuelStr} ${fuelName}`
        : `${deliveredStr} delivered`
      br.tooltip = `${nameStr}
Demand (delivered):  ${deliveredStr}
${effLabel}
Fuel consumed:  ${calcStr}`
    }
  }

  // ── Single uniform scale: demand sum drives the page height ──────────────
  const W = 920, H = 620
  const padT = 32
  const padB = 16
  const availH = H - padT - padB
  const NAME_GAP_PX = 14   // service-name label above the bar
  const MWH_GAP_PX  = 13   // MWh figure below the bar
  const BRANCH_GAP_PX = 3  // visual break between primary+secondary segments
  const LANE_TEXT_PX = NAME_GAP_PX + MWH_GAP_PX  // system label moved out of the lane

  const totalDemand = items.reduce((s, it) => s + it.demand, 0)
  const totalBarsPx = Math.max(120, availH - items.length * LANE_TEXT_PX)
  const pxPerMWh = totalBarsPx / Math.max(totalDemand, 1)
  const scaleW = (mwh) => mwh > 0 ? Math.max(1.5, mwh * pxPerMWh) : 0

  // ── Left column geometry ─────────────────────────────────────────────────
  const leftX0 = 60, nodeW = 130
  const leftX1 = leftX0 + nodeW

  let yCursor = padT
  for (const it of items) {
    const nBranches = (it.branches?.length ?? 0)
    const innerGap  = nBranches > 1 ? BRANCH_GAP_PX : 0
    it.nameY = yCursor + NAME_GAP_PX - 4
    it.barY0 = yCursor + NAME_GAP_PX

    // Lay out branch source segments (top-down). Each segment height is the
    // scaled delivered share; small visual gap between segments for dual-
    // system rows (Brief 38, walkthrough #5).
    let bcy = it.barY0
    if (it.isUnserved) {
      bcy = it.barY0 + scaleW(it.demand)  // unserved bar uses raw demand height
    } else {
      for (let i = 0; i < nBranches; i++) {
        const br = it.branches[i]
        br.srcW  = scaleW(br.delivered_mwh)
        br.srcY0 = bcy
        br.srcY1 = bcy + br.srcW
        bcy = br.srcY1
        if (i < nBranches - 1) bcy += innerGap
      }
    }

    it.barY1 = bcy
    it.barMid = (it.barY0 + it.barY1) / 2
    it.mwhY  = it.barY1 + MWH_GAP_PX - 3
    yCursor  = it.barY1 + MWH_GAP_PX
  }

  // ── Right column geometry (Electricity + Gas, no Waste) ──────────────────
  const rightX0 = 730, rightX1 = rightX0 + nodeW
  const totalElec = c.total?.electricity_mwh ?? 0
  const totalGas  = c.total?.gas_mwh ?? 0

  const carrierBars = [
    { key: 'electricity', label: 'Electricity', mwh: totalElec, color: FUEL_COLOURS.electricity },
    { key: 'gas',         label: 'Gas',         mwh: totalGas,  color: FUEL_COLOURS.gas },
  ].filter(b => b.mwh > 0.01)

  const INTER_RECT_GAP = 16
  const rightTotalH = carrierBars.reduce((s, b) => s + scaleW(b.mwh), 0)
                    + carrierBars.length * (NAME_GAP_PX + MWH_GAP_PX)
                    + Math.max(0, carrierBars.length - 1) * INTER_RECT_GAP
  const leftSpan = yCursor - padT
  const rightYStart = Math.max(padT, padT + leftSpan / 2 - rightTotalH / 2)

  yCursor = rightYStart
  for (const b of carrierBars) {
    const barH = scaleW(b.mwh)
    b.nameY = yCursor + NAME_GAP_PX - 4
    b.barY0 = yCursor + NAME_GAP_PX
    b.barY1 = b.barY0 + barH
    b.barMid = (b.barY0 + b.barY1) / 2
    b.mwhY  = b.barY1 + MWH_GAP_PX - 3
    yCursor = b.barY1 + MWH_GAP_PX + INTER_RECT_GAP
  }

  // For each carrier rect, assign target-side y-extents to incoming branches.
  // Stack from rect top using the fuel_mwh widths (sum = rect height).
  for (const b of carrierBars) {
    let cy = b.barY0
    for (const it of items) {
      if (it.isUnserved) continue
      for (const br of it.branches) {
        if (br.fuel !== b.key) continue
        if (br.fuel_mwh < 0.01) continue
        br.tgtW  = scaleW(br.fuel_mwh)
        br.tgtY0 = cy
        br.tgtY1 = cy + br.tgtW
        cy = br.tgtY1
      }
    }
  }

  // ── System column (middle) — small italic text, no box ───────────────────
  const systemX = (leftX1 + rightX0) / 2  // ≈ 460

  return (
    <div className="w-full h-full overflow-auto p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <EnginePill mode="static" />
          <p className="text-caption font-semibold text-navy">Energy flow — demand · system · carrier</p>
        </div>
        <div className="flex items-center gap-2">
          <ChartTotalsBadge label="Σ elec" value_kwh={totalElec * 1000} />
          <ChartTotalsBadge label="Σ gas"  value_kwh={totalGas  * 1000} />
        </div>
      </div>
      <p className="text-xxs text-mid-grey mb-3">
        Each demand on the left passes through its system in the middle, which
        consumes electricity and/or gas on the right. The ribbon's width on
        the left side is the demand served by that branch; on the right side
        it's the fuel consumed — so a heat pump's ribbon necks down
        through the system column, a gas boiler's barely tapers. Bar height
        and ribbon width share a single uniform scale (the total demand sets
        the canvas height). Heat rejection (cooling condenser, MEV / MVHR
        exhaust, gas flue) is intentionally out of scope of this view.
      </p>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }} preserveAspectRatio="xMidYMid meet">
        {/* Column headers */}
        <g fontSize="10" fill="#475569" fontWeight="600" textAnchor="middle">
          <text x={leftX0 + nodeW / 2}  y={padT - 12}>Demand</text>
          <text x={systemX}              y={padT - 12}>System</text>
          <text x={rightX0 + nodeW / 2}  y={padT - 12}>Energy carrier</text>
        </g>

        {/* ── Sankey ribbons (drawn first; bars sit on top at the edges) ── */}
        {items.map(it => {
          if (it.isUnserved) return null
          return it.branches.map((br, bi) => {
            const colour = br.fuel === 'electricity'
              ? (it.key === 'dhw' && dhwIsAshpPreheat ? '#DC2626' : FUEL_COLOURS.electricity)
              : FUEL_COLOURS.gas
            return (
              <path key={`r-${it.key}-${bi}`}
                d={ribbonPath(leftX1, br.srcY0, br.srcY1, rightX0, br.tgtY0, br.tgtY1)}
                fill={colour} fillOpacity={0.50}
                stroke={colour} strokeOpacity={0.20} strokeWidth={0.5}
                style={{ cursor: 'help' }}
              >
                {/* 2026-05-21 — Brief 44 Part 5 follow-up: native SVG tooltip
                    on hover. Shows demand × efficiency = fuel math so the
                    user can verify e.g. ASHP DHW: 117.7 MWh ÷ 2.5 = 47.1
                    MWh electricity. */}
                {br.tooltip && <title>{br.tooltip}</title>}
              </path>
            )
          })
        })}

        {/* ── Demand bars (left) ─────────────────────────────────────────── */}
        {/* Multi-branch rows (primary + secondary) render as separate rects
            stacked with a small visual gap, so the user can see at a glance
            that two systems are serving the demand. Single-branch rows draw
            as one rect spanning the whole demand. */}
        {items.map(it => {
          const colour = DEMAND_COLOURS[it.key] ?? '#94A3B8'
          return (
            <g key={`d-${it.key}`}>
              <text x={leftX0 + nodeW / 2} y={it.nameY} fontSize="10"
                fill={it.isUnserved ? '#9CA3AF' : '#1F2937'} textAnchor="middle"
                fontWeight="600">
                {it.label}{it.isUnserved ? ' (off)' : ''}
              </text>
              {it.isUnserved ? (
                <rect x={leftX0} y={it.barY0} width={nodeW}
                  height={Math.max(2, it.barY1 - it.barY0)}
                  fill={colour} opacity={0.30} rx={2} />
              ) : (
                it.branches.map((br, bi) => (
                  <rect key={bi}
                    x={leftX0} y={br.srcY0} width={nodeW}
                    height={Math.max(2, br.srcW)}
                    fill={colour} opacity={0.90} rx={2} />
                ))
              )}
              <text x={leftX0 + nodeW / 2} y={it.mwhY} fontSize="9"
                fill={it.isUnserved ? '#9CA3AF' : '#374151'} textAnchor="middle"
                fontWeight="500">
                {fmtFlow(it.demand, unit, giaM2)}
              </text>
            </g>
          )
        })}

        {/* ── System column (middle) — per-branch labels where the ribbon
             actually tapers or widens. 1:1 branches (lighting, small power,
             mech-vent fans) get no label. ────────────────────────────────── */}
        {items.map(it => {
          if (it.isUnserved) return null
          return it.branches.map((br, bi) => {
            if (!br.sysName && !br.effText) return null
            const srcMid = (br.srcY0 + br.srcY1) / 2
            const tgtMid = (br.tgtY0 + br.tgtY1) / 2
            const midY = (srcMid + tgtMid) / 2
            return (
              <g key={`s-${it.key}-${bi}`}>
                <text x={systemX} y={midY - (br.effText ? 5 : 0)} fontSize="9"
                  fill="#374151" textAnchor="middle"
                  fontWeight="500" fontStyle="italic">
                  {br.sysName}
                </text>
                {br.effText && (
                  <text x={systemX} y={midY + 8} fontSize="8"
                    fill="#6B7280" textAnchor="middle">
                    {br.effText}
                  </text>
                )}
              </g>
            )
          })
        })}

        {/* ── Right column rects ─────────────────────────────────────────── */}
        {carrierBars.map(b => {
          const barH = b.barY1 - b.barY0
          return (
            <g key={`c-${b.key}`}>
              <text x={rightX0 + nodeW / 2} y={b.nameY} fontSize="10"
                fill="#1F2937" textAnchor="middle" fontWeight="600">{b.label}</text>
              <rect x={rightX0} y={b.barY0} width={nodeW} height={Math.max(2, barH)}
                fill={b.color} opacity={0.90} rx={2} />
              <text x={rightX0 + nodeW / 2} y={b.mwhY} fontSize="9"
                fill="#374151" textAnchor="middle" fontWeight="500">
                {fmtFlow(b.mwh, unit, giaM2)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// pathLink — constant-width stroke path (legacy, retained in case other
// callers appear). New SystemsSankey uses ribbonPath below for tapered flows.
function pathLink(x0, y0, x1, y1, _w) {
  const cp = (x0 + x1) / 2
  return `M ${x0} ${y0} C ${cp} ${y0}, ${cp} ${y1}, ${x1} ${y1}`
}

// ribbonPath — a closed path forming a Sankey ribbon between a source edge
// (vertical segment x0 / y0_top..y0_bot) and a target edge (x1 / y1_top..y1_bot).
// The top edge is a cubic Bézier with horizontal control points at the midpoint
// x, then a vertical segment down the target edge, then a mirror Bézier back
// along the bottom edge, then close. SVG draws a smoothly tapering polygon.
function ribbonPath(x0, y0_top, y0_bot, x1, y1_top, y1_bot) {
  const cp = (x0 + x1) / 2
  return `M ${x0} ${y0_top} ` +
         `C ${cp} ${y0_top}, ${cp} ${y1_top}, ${x1} ${y1_top} ` +
         `L ${x1} ${y1_bot} ` +
         `C ${cp} ${y1_bot}, ${cp} ${y0_bot}, ${x0} ${y0_bot} ` +
         `Z`
}

/* ───────────────────────────────────────────────────────────────────────────
   CENTRE — REJECTION (Brief 38, 2026-05-19)

   Heat-rejection breakdown — what leaves the building via system pathways.
   Intentionally separate from the main Sankey: cooling condenser rejection
   alone exceeds cooling demand (because reject = delivered + electrical work
   input), so combining it into the demand-driven Sankey distorts the layout.

   Sources surfaced here:
     - Cooling condenser:      cooling_delivered + cooling_electricity
                               (heat pulled from zone + electrical work in,
                               both leave through the outdoor unit)
     - Mech vent exhaust:      Σ ventilation[].exhaust_loss_mwh
                               (engine's per-system post-HRE exhaust loss;
                               broken out per system here so the user can
                               see which fan is throwing the most heat out)
     - DHW flue:               dhw.gas_mwh × (1 - 0.92)  approx, 92% boiler
     - Heating flue:           space_heating.gas_mwh × (1 - 0.92)  approx

   Out of scope: fabric loss + infiltration (those live in the Building
   module's heat-balance view); ASHP-DHW outdoor-unit "rejection" is
   negative (it ABSORBS heat from outdoor air to deliver hot water — not
   a rejection at all).
   ─────────────────────────────────────────────────────────────────────── */
function SystemsRejection({ consumption, sysCfg }) {
  const c = consumption ?? {}

  // Category totals
  const cooling_reject = (c.space_cooling?.delivered_mwh ?? 0) + (c.space_cooling?.electricity_mwh ?? 0)
  const dhw_flue       = (c.dhw?.gas_mwh ?? 0) * (1 - 0.92)
  const heat_flue      = (c.space_heating?.gas_mwh ?? 0) * (1 - 0.92)
  const ventList       = c.ventilation ?? []
  const vent_exhaust   = ventList.reduce((s, v) => s + (v.exhaust_loss_mwh ?? 0), 0)

  const categories = [
    {
      key:    'cooling',
      label:  'Cooling condenser',
      mwh:    cooling_reject,
      colour: '#00AEEF',
      note:   c.space_cooling?.seer_effective != null
        ? `Cooling delivered ${(c.space_cooling.delivered_mwh ?? 0).toFixed(1)} MWh + electrical work ${(c.space_cooling.electricity_mwh ?? 0).toFixed(1)} MWh, both leave via the outdoor condenser. EER ${c.space_cooling.seer_effective.toFixed(1)}.`
        : 'Heat pulled from the zone + electrical work in, both leave via the outdoor condenser.',
    },
    {
      key:    'vent_exhaust',
      label:  'Mech vent exhaust',
      mwh:    vent_exhaust,
      colour: '#14B8A6',
      note:   `Heating-season vent loss after HRE recovery. ${ventList.length} ventilation system${ventList.length === 1 ? '' : 's'}; per-system breakdown below.`,
    },
    {
      key:    'dhw_flue',
      label:  'DHW flue',
      mwh:    dhw_flue,
      colour: '#EC4899',
      note:   '~8 % of DHW gas input leaves as flue loss on a 92 %-efficient boiler. Recovery opportunity: flue-gas heat-recovery (FGHR) or condensing-boiler tuning.',
      hidden: (c.dhw?.gas_mwh ?? 0) < 0.01,
    },
    {
      key:    'heat_flue',
      label:  'Heating flue',
      mwh:    heat_flue,
      colour: '#DC2626',
      note:   '~8 % of heating gas input leaves as flue loss on a 92 %-efficient boiler.',
      hidden: (c.space_heating?.gas_mwh ?? 0) < 0.01,
    },
  ].filter(cat => !cat.hidden && cat.mwh > 0.01)

  const totalReject = categories.reduce((s, cat) => s + cat.mwh, 0)
  const maxCat      = Math.max(1, ...categories.map(c => c.mwh))

  // Per-vent-system breakdown (separate table below the categories)
  const ventListCfg = sysCfg.ventilation ?? []
  const ventRows = ventList.map((v, vi) => {
    const cfg = ventListCfg[vi]
    const name = cfg?.name ?? v.name ?? v.id ?? `vent_${vi + 1}`
    return {
      key: v.id ?? name,
      label: fmtSys(name),
      exhaust_mwh:  v.exhaust_loss_mwh   ?? 0,
      recovery_mwh: v.hre_recovery_mwh   ?? 0,
      fan_mwh:      v.fan_electricity_mwh ?? 0,
      is_mvhr:      (cfg?.type ?? '').toLowerCase().includes('mvhr')
                 || (v.id ?? '').toLowerCase().includes('mvhr')
                 || (v.hre_recovery_mwh ?? 0) > 0.01,
    }
  }).sort((a, b) => b.exhaust_mwh - a.exhaust_mwh)

  return (
    <div className="w-full h-full overflow-auto p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <EnginePill mode="static" />
          <p className="text-caption font-semibold text-navy">Heat rejection — where heat leaves the building</p>
        </div>
        <div className="flex items-center gap-2">
          <ChartTotalsBadge label="Σ rejected" value_kwh={totalReject * 1000} />
        </div>
      </div>
      <p className="text-xxs text-mid-grey mb-4 max-w-3xl">
        Heat that leaves the building via system pathways — separate from the
        demand-to-fuel Sankey so its magnitudes don't distort that view.
        Fabric losses and infiltration are not included here (they live in the
        Building module's heat-balance view).
      </p>

      {/* ── Top-line totals + horizontal stacked bar ───────────────────── */}
      <div className="mb-6 max-w-3xl">
        <div className="text-caption font-semibold text-navy mb-2">
          {totalReject.toFixed(1)} MWh rejected per year
        </div>
        <div className="flex w-full h-7 rounded overflow-hidden border border-light-grey">
          {categories.map(cat => {
            const pct = (cat.mwh / Math.max(totalReject, 1)) * 100
            if (pct < 0.5) return null
            return (
              <div key={cat.key}
                title={`${cat.label}: ${cat.mwh.toFixed(1)} MWh (${pct.toFixed(0)} %)`}
                style={{ width: `${pct}%`, backgroundColor: cat.colour, opacity: 0.85 }}
              />
            )
          })}
        </div>
        <div className="flex gap-3 flex-wrap mt-2">
          {categories.map(cat => {
            const pct = (cat.mwh / Math.max(totalReject, 1)) * 100
            return (
              <div key={cat.key} className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: cat.colour, opacity: 0.85 }} />
                <span className="text-xxs text-mid-grey">
                  {cat.label} <span className="text-navy font-medium tabular-nums">{cat.mwh.toFixed(1)} MWh</span> <span className="text-mid-grey">({pct.toFixed(0)} %)</span>
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Categories detail (bars + notes) ─────────────────────────────── */}
      <div className="mb-6 max-w-3xl">
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">By source</p>
        <div className="space-y-3">
          {categories.length === 0 && (
            <p className="text-caption text-mid-grey italic">No system-side rejection in this configuration.</p>
          )}
          {categories.map(cat => {
            const pct = (cat.mwh / maxCat) * 100
            return (
              <div key={cat.key} className="bg-white border border-light-grey rounded p-3">
                <div className="flex items-baseline justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: cat.colour, opacity: 0.85 }} />
                    <span className="text-caption font-medium text-navy">{cat.label}</span>
                  </div>
                  <span className="text-caption font-semibold text-navy tabular-nums">{cat.mwh.toFixed(1)} MWh</span>
                </div>
                <div className="h-2 rounded-sm bg-off-white overflow-hidden mb-1.5">
                  <div className="h-full" style={{ width: `${pct}%`, backgroundColor: cat.colour, opacity: 0.75 }} />
                </div>
                <p className="text-xxs text-mid-grey leading-relaxed">{cat.note}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Per-vent-system breakdown ────────────────────────────────────── */}
      {ventRows.length > 0 && vent_exhaust > 0.01 && (
        <div className="max-w-3xl">
          <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Mech vent — per system (post-HRE)</p>
          <div className="bg-white border border-light-grey rounded">
            <table className="w-full text-caption">
              <thead>
                <tr className="border-b border-light-grey text-xxs uppercase tracking-wider text-mid-grey">
                  <th className="text-left  font-medium px-3 py-2">System</th>
                  <th className="text-right font-medium px-3 py-2">Exhaust MWh</th>
                  <th className="text-right font-medium px-3 py-2">HRE recovered</th>
                  <th className="text-right font-medium px-3 py-2">Fan kWh</th>
                  <th className="text-left  font-medium px-3 py-2">Type</th>
                </tr>
              </thead>
              <tbody>
                {ventRows.map(r => (
                  <tr key={r.key} className="border-b border-light-grey last:border-b-0">
                    <td className="px-3 py-2 text-navy">{r.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-navy">{r.exhaust_mwh.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-mid-grey">
                      {r.is_mvhr ? `${r.recovery_mwh.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-mid-grey">{(r.fan_mwh * 1000).toFixed(0)}</td>
                    <td className="px-3 py-2 text-xxs text-mid-grey italic">{r.is_mvhr ? 'MVHR (with recovery)' : 'Extract-only'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xxs text-mid-grey mt-2 leading-relaxed">
            Exhaust MWh = heating-season stale-air heat leaving via this system,
            after HRE recovery where present. Recovery opportunity: convert
            extract-only systems to MVHR to recover ~ 80 % of the listed exhaust.
          </p>
        </div>
      )}
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   CENTRE — PROFILES
   ─────────────────────────────────────────────────────────────────────── */
function SystemsProfiles({ result }) {
  // Brief 44 Part 3 (2026-05-21): rebuilt as InteractiveProfileVisualiser.
  // Default view: total electricity, year axis, single line. User opts
  // into additional layers, chart modes, weather overlays, time zoom.
  //
  // The old WeatherSynchronisedProfile rendered 11 layers at once across
  // three weather strips — illegible at a glance. The new visualiser
  // follows Brief 44 Principle 3: simple by default, layered by choice.
  const dpEng = result?.energy_use?.daily_profiles ?? result?.consumption?.daily_profiles
  const dpFab = result?.daily_profiles
  if (!dpEng) {
    return <div className="h-full flex items-center justify-center text-mid-grey text-xxs">Engine profile data not yet available.</div>
  }

  // Weather strip: convert daily sums → daily means (divide by 24).
  const w = dpFab?.weather ?? {}
  const t_out_c        = (w.t_out_sum_c ?? []).map(v => v / 24)
  const wind_ms        = (w.wind_sum_ms ?? []).map(v => v / 24)
  const ghi_w_per_m2   = (w.ghi_sum_w_per_m2 ?? []).map(v => v / 24)

  // Layers — module-specific data feeds. Total electricity is the default
  // single signal (most-summarising shape for a Systems-page user).
  //
  // Colour discipline: FUEL carriers (electricity, gas) get warm "fuel"
  // hues — amber + deep red. DELIVERED services get the canonical service
  // hues from SERVICE_COLOURS (red = heating, cyan = cooling, pink = DHW,
  // teal = ventilation, amber = lighting, violet = small power). The
  // heating-delivered red and gas red are intentionally NOT identical
  // hues (heating = #DC2626 canonical service red, gas = #991B1B darker
  // burgundy fuel red) so a user toggling both layers can distinguish
  // the seasonal heating thermal trace from the flat DHW-gas-fuel trace.
  // (Pre-fix Brief 44 Part 3 used a light coral #F87171 for heating and
  // #DC2626 for gas — too similar; Chris flagged them as visually
  // "aligned" when in fact one was flat and the other strongly
  // seasonal.)
  const layers = [
    { id: 'electricity', label: 'Electricity total', colour: '#ECB01F', daily_kwh: dpEng.fuel_kwh_per_day?.electricity ?? [] },
    { id: 'gas',         label: 'Gas total',         colour: '#991B1B', daily_kwh: dpEng.fuel_kwh_per_day?.gas ?? [] },
    { id: 'heating',     label: 'Heating delivered', colour: '#DC2626', daily_kwh: dpEng.delivered_kwh_per_day?.heating ?? [] },
    { id: 'cooling',     label: 'Cooling delivered', colour: '#00AEEF', daily_kwh: dpEng.delivered_kwh_per_day?.cooling ?? [] },
    { id: 'dhw',         label: 'DHW delivered',     colour: '#EC4899', daily_kwh: dpEng.delivered_kwh_per_day?.dhw ?? [] },
    { id: 'fans',        label: 'Fan power',         colour: '#14B8A6', daily_kwh: dpEng.delivered_kwh_per_day?.fans ?? [] },
    { id: 'lighting',    label: 'Lighting',          colour: '#FBBF24', daily_kwh: dpEng.delivered_kwh_per_day?.lighting ?? [] },
    { id: 'small_power', label: 'Small power',       colour: '#8B5CF6', daily_kwh: dpEng.delivered_kwh_per_day?.small_power ?? [] },
  ]

  const sumArr = (a) => Array.isArray(a) ? a.reduce((s, v) => s + (v ?? 0), 0) : 0
  const totalElecKwh = sumArr(dpEng.fuel_kwh_per_day?.electricity)
  const totalGasKwh  = sumArr(dpEng.fuel_kwh_per_day?.gas)
  const gia = result?.metadata?.gia_m2 ?? result?.heat_balance?.metadata?.gia_m2 ?? 0

  return (
    <div className="w-full h-full flex flex-col overflow-auto p-3">
      <div className="flex-shrink-0 flex items-center justify-between gap-2 mb-2">
        <EnginePill mode="static" />
        <div className="flex items-center gap-2">
          <ChartTotalsBadge label="Σ elec" value_kwh={totalElecKwh} gia_m2={gia} />
          <ChartTotalsBadge label="Σ gas"  value_kwh={totalGasKwh}  gia_m2={gia} />
        </div>
      </div>
      <InteractiveProfileVisualiser
        layers={layers}
        weather={{ t_out_c, wind_ms, ghi_w_per_m2 }}
        defaultLayerIds={['electricity']}
        defaultMode="single_line"
        module="systems"
        height={420}
        caption="Daily mean of the engine's 8760-hour pass. Toggle layers to compare service deliveries against carrier fuel; switch to Stacked area for cumulative composition or Small multiples for parallel views. Year / Quarter / Month / Day zoom rescales the y-axis to fit."
      />
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   CENTRE — SCHEDULE (per-system grids with edit button)
   Brief 44 Part 4 (2026-05-21) — rewired to v40 per-system arrays. The
   pre-Brief-44 implementation read `sysCfg.heating?.schedule_ref` etc.
   from systems_config_v25 — post-Brief-42 the canonical schema is v40
   per-system arrays with `control_schedule_id`. On v40-migrated projects
   the v25 schedule_ref is absent → silent fallback to 'always_on' →
   grid showed a flat always-on shape that LOOKED like real data. This
   was the "hardcoded data masquerading as real" case Brief 44 flagged
   for removal-or-rewire. Rewired to v40.
   ─────────────────────────────────────────────────────────────────── */
function SystemsSchedule({ sysCfg, sysCfgV40, params, openScheduleEditor }) {
  // V40 per-system rows. When v40 is present, use it as the source of
  // truth; v25 schedule_ref is the legacy fallback for pre-Brief-42
  // projects only.
  const rows = []
  const SERVICE_LABELS = {
    heating: 'Heating', cooling: 'Cooling', dhw: 'DHW',
    ventilation: 'Vent', lighting: 'Lighting', small_power: 'Small power',
  }

  if (sysCfgV40 && typeof sysCfgV40 === 'object') {
    for (const service of ['heating', 'cooling', 'dhw', 'ventilation', 'lighting', 'small_power']) {
      const list = Array.isArray(sysCfgV40[service]) ? sysCfgV40[service] : []
      for (const sys of list) {
        if (!sys) continue
        rows.push({
          id:           `${service}:${sys.id ?? sys.label ?? 'unknown'}`,
          label:        `${SERVICE_LABELS[service]}: ${sys.label ?? sys.id ?? '(unnamed)'}`,
          schedule_ref: sys.control_schedule_id ?? null,
          mechanism:    sys.control_mechanism ?? 'constant',
          enabled:      sys.enabled !== false,
          service,
        })
      }
    }
  } else {
    // Legacy v25 fallback — pre-Brief-42 projects only
    const add = (id, label, schedule_ref, enabled, service) =>
      rows.push({ id, label, schedule_ref, enabled, service, mechanism: null })
    add('heating', 'Heating',  sysCfg.heating?.schedule_ref ?? null, sysCfg.heating?.enabled !== false, 'heating')
    add('cooling', 'Cooling',  sysCfg.cooling?.schedule_ref ?? null, sysCfg.cooling?.enabled !== false, 'cooling')
    add('dhw',     'DHW',      sysCfg.dhw?.schedule_ref ?? null,     sysCfg.dhw?.enabled !== false, 'dhw')
    for (const v of (sysCfg.ventilation ?? [])) {
      add(v.id ?? v.name ?? 'vent', `Vent: ${v.name ?? v.id ?? '?'}`, v.schedule_ref ?? null, v.enabled !== false, 'ventilation')
    }
  }

  const resolveSched = (name) => {
    if (!name) return null
    const proj = (params?.schedules ?? []).find(s => s?.name === name || s?.id === name)
    if (proj) return proj
    return SCHEDULES[name] ?? null
  }

  return (
    <div className="w-full h-full overflow-auto p-4 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <EnginePill mode="static" />
            <p className="text-caption font-semibold text-navy">System on-time schedules</p>
          </div>
          <p className="text-xxs text-mid-grey mt-0.5">
            Per-system schedule visualisation. Each row shows Mon–Fri / Sat / Sun
            hour-of-day fractions for the system's `control_schedule_id`. Systems
            with `control_mechanism = 'constant'` (no schedule) show a banner
            instead of a grid. The "✏️ Edit" button opens the shared schedule
            editor; saving updates the project's schedule library and any other
            system referencing that schedule will recompute immediately.
          </p>
        </div>
        <div className="text-xxs text-mid-grey tabular-nums flex-shrink-0">{rows.length} systems</div>
      </div>
      {rows.length === 0 && (
        <div className="bg-off-white/40 border border-dashed border-light-grey rounded p-4 text-xxs text-mid-grey italic max-w-3xl">
          No systems configured yet. Add systems in the left panel.
        </div>
      )}
      {rows.map(r => {
        const sched = resolveSched(r.schedule_ref)
        const isConstant = r.mechanism === 'constant' || (!r.schedule_ref && !sched)
        return (
          <div key={r.id} className={`bg-white border border-light-grey rounded p-3 max-w-3xl ${r.enabled ? '' : 'opacity-60'}`}>
            <div className="flex items-baseline justify-between mb-2 gap-3">
              <div className="flex items-baseline gap-2 min-w-0">
                <p className="text-caption font-medium text-navy truncate">{r.label}</p>
                {!r.enabled && <span className="text-xxs text-amber-700">(OFF)</span>}
              </div>
              <div className="flex items-center gap-2 text-xxs text-mid-grey flex-shrink-0">
                {r.mechanism && (
                  <span>mechanism: <span className="text-navy">{r.mechanism}</span></span>
                )}
                {r.schedule_ref && (
                  <span>schedule: <span className="text-navy">{r.schedule_ref}</span></span>
                )}
                {r.schedule_ref && (
                  <button
                    onClick={() => openScheduleEditor(r.schedule_ref)}
                    className="px-2 py-0.5 rounded border border-light-grey text-mid-grey hover:text-cyan-700 hover:border-cyan-700"
                  >
                    ✏️ Edit
                  </button>
                )}
              </div>
            </div>
            {isConstant && (
              <p className="text-xxs text-mid-grey/80 italic">
                Constant operation — no schedule assigned. To add a schedule, set the system's
                control mechanism to "Scheduled" in the system editor.
              </p>
            )}
            {!isConstant && sched && (
              <>
                <ScheduleGrid label="Mon–Fri" hours={sched.day_types?.weekday ?? Array(24).fill(0)} />
                <ScheduleGrid label="Sat"     hours={sched.day_types?.saturday ?? Array(24).fill(0)} />
                <ScheduleGrid label="Sun"     hours={sched.day_types?.sunday ?? Array(24).fill(0)} />
              </>
            )}
            {!isConstant && !sched && r.schedule_ref && (
              <p className="text-xxs text-amber-700">
                Schedule reference "{r.schedule_ref}" not found in project library.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ScheduleGrid({ label, hours }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <div className="text-xxs text-mid-grey w-12 flex-shrink-0">{label}</div>
      <div className="flex-1 grid gap-px" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
        {hours.map((v, i) => {
          const a = Math.max(0, Math.min(1, v))
          return (
            <div
              key={i}
              className="h-5 rounded-sm"
              style={{ backgroundColor: a > 0.01 ? `rgba(0, 174, 239, ${0.25 + a * 0.75})` : '#F3F4F6' }}
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

/* ───────────────────────────────────────────────────────────────────────────
   CENTRE — MONTHLY
   ─────────────────────────────────────────────────────────────────────── */
function SystemsMonthly({ consumption, result }) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dpEng = result?.energy_use?.daily_profiles ?? result?.consumption?.daily_profiles
  if (!dpEng) {
    return <div className="h-full flex items-center justify-center text-mid-grey text-xxs">Daily profile arrays missing — can't aggregate monthly.</div>
  }

  // Daily → monthly aggregator using non-leap-year cumulative days
  const _CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365]
  const toMonth = (daily) => {
    const out = new Array(12).fill(0)
    if (!Array.isArray(daily)) return out
    for (let d = 0; d < Math.min(365, daily.length); d++) {
      let m = 0
      while (m < 11 && _CUM[m + 1] <= d) m++
      out[m] += daily[d]
    }
    return out
  }
  const elecM = toMonth(dpEng.fuel_kwh_per_day?.electricity)
  const gasM  = toMonth(dpEng.fuel_kwh_per_day?.gas)
  const heatDemandM = toMonth(dpEng.delivered_kwh_per_day?.heating)
  const coolDemandM = toMonth(dpEng.delivered_kwh_per_day?.cooling)

  // Brief 44 Part 4: the bar wrapper is 200px tall and the gas+elec
  // sub-bars STACK inside it. maxBar must be the max of (elec+gas) per
  // month — not the max across each array independently — otherwise the
  // stacked bars overflow the wrapper (gas/max * 200 + elec/max * 200
  // can exceed 200 if max < gas+elec). The pre-Brief-44 version used
  // max across all 4 arrays, which overflowed for any month where the
  // sum gas+elec exceeded any single array's max — bars then extended
  // BELOW the wrapper into the month-label area, causing the collision
  // Chris flagged.
  const maxStack = Math.max(...elecM.map((e, i) => (e + gasM[i])), 1)
  const maxBar = maxStack   // alias kept for readability of the per-bar math

  return (
    <div className="w-full h-full overflow-auto p-4">
      {/* Brief 28-IM-Polish POL-M2 */}
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <EnginePill mode="static" />
          <p className="text-caption font-semibold text-navy">Monthly energy + demand</p>
        </div>
        <div className="flex items-center gap-2">
          <ChartTotalsBadge label="Σ elec" value_kwh={elecM.reduce((s,v)=>s+v,0)} />
          <ChartTotalsBadge label="Σ gas"  value_kwh={gasM.reduce((s,v)=>s+v,0)} />
        </div>
      </div>
      <p className="text-xxs text-mid-grey mb-3">
        Per-month aggregation of the engine's daily delivered + fuel arrays.
        Stacked bars: <span style={{ color: FUEL_COLOURS.electricity }}>electricity</span>{' '}
        + <span style={{ color: FUEL_COLOURS.gas }}>gas</span> consumed. Lines:
        heating demand <span className="text-red-600">●</span> and cooling
        demand <span className="text-blue-600">●</span> for visual demand-vs-energy
        comparison.
      </p>
      {/* Brief 44 Part 4 (2026-05-21) — cosmetic restructure. The pre-Brief-44
          layout stacked four text labels under each bar (total / month name /
          heating demand / cooling demand). At narrow column widths these
          collide. New layout: total ABOVE bar; month label BELOW bar; heating
          + cooling demand combined into one short "↓X ↑Y" line below the
          month — only visible when above the threshold. Hover the bar for
          full numerical context via tooltip. */}
      <div className="flex items-end gap-2 max-w-5xl" style={{ height: 260 }}>
        {months.map((m, i) => {
          const total = elecM[i] + gasM[i]
          const totalLabel = total > 1000 ? `${(total / 1000).toFixed(1)}k` : `${Math.round(total)}`
          const tooltip =
            `${m}\n` +
            `Electricity: ${Math.round(elecM[i])} kWh\n` +
            `Gas: ${Math.round(gasM[i])} kWh\n` +
            `Heating demand: ${Math.round(heatDemandM[i])} kWh\n` +
            `Cooling demand: ${Math.round(coolDemandM[i])} kWh`
          return (
            <div key={m} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={tooltip}>
              <div className="text-xxs text-mid-grey tabular-nums leading-none">{totalLabel}</div>
              <div className="w-full" style={{ height: 200 }}>
                <div className="w-full" style={{ height: `${(gasM[i] / maxBar) * 200}px`, backgroundColor: FUEL_COLOURS.gas, opacity: 0.85 }} />
                <div className="w-full" style={{ height: `${(elecM[i] / maxBar) * 200}px`, backgroundColor: FUEL_COLOURS.electricity, opacity: 0.85 }} />
              </div>
              <div className="text-xxs text-mid-grey font-medium leading-none">{m}</div>
              {/* Demand indicators — combined onto one short line so they
                  can't collide with the month label. Tooltip on the column
                  shows the exact figures. */}
              <div className="text-xxs tabular-nums leading-none flex items-center gap-1">
                {heatDemandM[i] > 100 && (
                  <span style={{ color: '#DC2626' }}>↓{Math.round(heatDemandM[i] / 1000) >= 1 ? `${(heatDemandM[i] / 1000).toFixed(1)}k` : Math.round(heatDemandM[i])}</span>
                )}
                {coolDemandM[i] > 100 && (
                  <span style={{ color: '#00AEEF' }}>↑{Math.round(coolDemandM[i] / 1000) >= 1 ? `${(coolDemandM[i] / 1000).toFixed(1)}k` : Math.round(coolDemandM[i])}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-4 mt-4 text-xxs text-mid-grey">
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm" style={{ backgroundColor: FUEL_COLOURS.electricity }} /> Electricity ({consumption.total?.electricity_mwh?.toFixed(1)} MWh/yr)</div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm" style={{ backgroundColor: FUEL_COLOURS.gas }} /> Gas ({consumption.total?.gas_mwh?.toFixed(1)} MWh/yr)</div>
        <div className="flex items-center gap-1 text-red-600"><span>↓</span> Heating demand</div>
        <div className="flex items-center gap-1 text-blue-600"><span>↑</span> Cooling demand</div>
      </div>
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   CENTRE — SUMMARY
   ─────────────────────────────────────────────────────────────────────── */
function SystemsSummary({ consumption }) {
  // Brief 68 Part D (Brief 66 HIGH-4, 2026-05-28): `scop_effective` is also
  // used by gas boilers (the engine writes delivered/fuel = boiler efficiency
  // ≈ 0.92 to the same field for non-heat-pump heating). SCOP is a heat-
  // pump concept, so showing "0.92" in a column literally labelled
  // "SCOP / SEER" reads as a broken COP. The Sankey label code at
  // SystemsModule.jsx:1240/1280 already routes >1 → "SCOP", <1 → "X% eff";
  // do the same here. Format helper below picks the right label per row.
  const rows = [
    { key: 'space_heating', label: 'Space heating', node: consumption.space_heating, effKey: 'scop_effective' },
    { key: 'space_cooling', label: 'Space cooling', node: consumption.space_cooling, effKey: 'seer_effective' },
    { key: 'dhw',           label: 'DHW',           node: consumption.dhw,           effKey: null },
    { key: 'fans',          label: 'Vent fans',     node: { delivered_mwh: (consumption.ventilation ?? []).reduce((s, v) => s + (v.fan_electricity_mwh ?? 0), 0), demand_mwh: (consumption.ventilation ?? []).reduce((s, v) => s + (v.fan_electricity_mwh ?? 0), 0), electricity_mwh: (consumption.ventilation ?? []).reduce((s, v) => s + (v.fan_electricity_mwh ?? 0), 0), gas_mwh: 0, enabled: (consumption.ventilation ?? []).some(v => v.enabled !== false) } },
    { key: 'lighting',      label: 'Lighting',      node: { delivered_mwh: consumption.lighting?.electricity_mwh ?? 0, demand_mwh: consumption.lighting?.electricity_mwh ?? 0, electricity_mwh: consumption.lighting?.electricity_mwh ?? 0, gas_mwh: 0, enabled: true } },
    { key: 'small_power',   label: 'Small power',   node: { delivered_mwh: consumption.small_power?.electricity_mwh ?? 0, demand_mwh: consumption.small_power?.electricity_mwh ?? 0, electricity_mwh: consumption.small_power?.electricity_mwh ?? 0, gas_mwh: 0, enabled: true } },
    // Brief 73 P5 + P5-redux Part A (2026-06-01): auxiliary loads.
    // The accurate schedule-aware values produced by Brief 72 P5's State 2
    // emit live at `result.heat_balance.annual.gains.internal.auxiliary`
    // (TOP LEVEL of the engine result, NOT under `consumption`). The
    // original P5 edit read `consumption.heat_balance…` which doesn't
    // exist — `consumption` keys are `[space_heating, space_cooling,
    // dhw, ventilation, lighting, small_power, total, daily_profiles,
    // brief40, source_path]`. Wrong path → aux = {} → electricity_kwh
    // = 0 → row auto-disabled → no Auxiliary entry rendered (walkthrough
    // item 9 ✗). P5-redux corrects the path via `result?.heat_balance`
    // which is in scope here from L174. `delivered_mwh` is electricity
    // (matching lighting/small_power); heat-gain side (.kwh) appears
    // in the Heat Balance Sankey and is not double-counted here.
    { key: 'auxiliary',     label: 'Auxiliary',     node: (() => {
      const aux = result?.heat_balance?.annual?.gains?.internal?.auxiliary ?? {}
      const elecMwh = (aux.electricity_kwh ?? 0) / 1000
      return {
        delivered_mwh:   elecMwh,
        demand_mwh:      elecMwh,
        electricity_mwh: elecMwh,
        gas_mwh:         0,
        enabled:         elecMwh > 0,
      }
    })() },
  ]

  const totalElec = consumption.total?.electricity_mwh ?? 0
  const totalGas  = consumption.total?.gas_mwh ?? 0
  const eui       = consumption.total?.kwh_per_m2_yr ?? 0
  const CRREM_TARGET = 184

  // Brief 68 Part D: format effective performance with the right label.
  //   • space_heating (effKey scop_effective): ≥1 → "SCOP X.XX", <1 → "η X.XX"
  //     (the engine writes delivered/fuel; for gas boilers that's the combustion
  //      efficiency, not a SCOP — labelling it SCOP is misleading)
  //   • space_cooling (effKey seer_effective): ≥1 → "SEER X.XX", <1 → "η X.XX"
  //   • dhw / fans / lighting / small_power: no efficiency column applies (effKey null)
  const fmtEff = (effKey, value) => {
    if (effKey == null || value == null || !Number.isFinite(value)) return '—'
    const v = value.toFixed(2)
    if (effKey === 'seer_effective') return value >= 1 ? `SEER ${v}` : `η ${v}`
    // default: scop_effective
    return value >= 1 ? `SCOP ${v}` : `η ${v}`
  }

  return (
    <div className="w-full h-full overflow-auto p-4">
      {/* Brief 28-IM-Polish POL-M2 */}
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <EnginePill mode="static" />
          <p className="text-caption font-semibold text-navy">Systems summary · annual</p>
        </div>
        <div className="flex items-center gap-2">
          <ChartTotalsBadge label="Σ elec" value_kwh={totalElec * 1000} />
          <ChartTotalsBadge label="Σ gas"  value_kwh={totalGas  * 1000} />
        </div>
      </div>
      <p className="text-xxs text-mid-grey mb-3">
        Per-category demand → delivered → carrier breakdown. The Efficiency
        column shows the effective seasonal performance the engine derived from
        the installed system mix — labelled "SCOP" for heat-pump heating,
        "SEER" for heat-pump cooling, and "η" (Greek eta) for combustion-based
        efficiency where the value is below 1 (e.g. gas boiler ≈ 0.92).
      </p>

      <table className="w-full max-w-4xl text-xxs border-collapse">
        <thead>
          <tr className="border-b border-light-grey text-mid-grey uppercase tracking-wider">
            <th className="text-left py-2 pr-3 font-medium">Category</th>
            <th className="text-right py-2 pr-3 font-medium">Demand (MWh)</th>
            <th className="text-right py-2 pr-3 font-medium">Delivered (MWh)</th>
            <th className="text-right py-2 pr-3 font-medium">Electricity (MWh)</th>
            <th className="text-right py-2 pr-3 font-medium">Gas (MWh)</th>
            <th className="text-right py-2 font-medium">Efficiency</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className={`border-b border-light-grey/50 ${r.node.enabled === false ? 'opacity-50' : ''}`}>
              <td className="py-1.5 pr-3 text-navy">
                {r.label}{r.node.enabled === false && <span className="ml-1 text-amber-700 text-xxs">(off)</span>}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-navy">{(r.node.demand_mwh ?? 0).toFixed(1)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-navy">{(r.node.delivered_mwh ?? 0).toFixed(1)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-navy">{(r.node.electricity_mwh ?? 0).toFixed(1)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-navy">{(r.node.gas_mwh ?? 0).toFixed(1)}</td>
              <td className="py-1.5 text-right tabular-nums text-mid-grey">{fmtEff(r.effKey, r.node?.[r.effKey])}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-navy/30 font-semibold">
            <td className="py-2 pr-3 text-navy">Total</td>
            <td className="py-2 pr-3" />
            <td className="py-2 pr-3" />
            <td className="py-2 pr-3 text-right tabular-nums text-navy">{totalElec.toFixed(1)}</td>
            <td className="py-2 pr-3 text-right tabular-nums text-navy">{totalGas.toFixed(1)}</td>
            <td className="py-2 text-right" />
          </tr>
        </tbody>
      </table>

      <div className="mt-6 grid grid-cols-2 gap-4 max-w-3xl">
        <div className="bg-white border border-light-grey rounded p-3">
          <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">Total EUI</p>
          <p className="text-2xl text-navy font-semibold tabular-nums">{eui.toFixed(1)} <span className="text-xxs text-mid-grey">kWh/m²·yr</span></p>
          <p className={`text-xxs mt-0.5 ${eui <= CRREM_TARGET ? 'text-green-700' : 'text-amber-700'}`}>
            CRREM 1.5°C target {CRREM_TARGET} → {eui <= CRREM_TARGET ? `${(CRREM_TARGET - eui).toFixed(0)} below` : `${(eui - CRREM_TARGET).toFixed(0)} above`}
          </p>
        </div>
        <div className="bg-white border border-light-grey rounded p-3">
          <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">Fuel split</p>
          <p className="text-caption text-navy font-semibold tabular-nums">
            <span style={{ color: FUEL_COLOURS.electricity }}>{Math.round(totalElec / Math.max(totalElec + totalGas, 1) * 100)}%</span> electricity
            {' / '}
            <span style={{ color: FUEL_COLOURS.gas }}>{Math.round(totalGas / Math.max(totalElec + totalGas, 1) * 100)}%</span> gas
          </p>
          <p className="text-xxs text-mid-grey mt-0.5">
            {totalElec.toFixed(1)} MWh / {totalGas.toFixed(1)} MWh
          </p>
        </div>
      </div>

      <div className="text-xxs text-mid-grey/80 italic mt-4 max-w-3xl space-y-1">
        <p><span className="font-medium not-italic text-amber-700">Convention notes (Static vs Dynamic):</span></p>
        <p>• <span className="font-medium not-italic">Demand definition</span>: Static computes
          <code>demand_mwh</code> as a setpoint-convention property of the building (the
          heat load to hold 21 °C against the gain-warmed zone temperature), so it
          stays positive even when heating is disabled. Dynamic's <code>demand_mwh</code>
          is what EnergyPlus actually supplied (<code>Heating:EnergyTransfer</code>), so
          disabled services show ~0 demand and the shortfall surfaces as unmet-setpoint
          hours instead.</p>
        <p>• <span className="font-medium not-italic">Effective SCOP/SEER</span>: identical
          formula on both engines (delivered / fuel), but per-system COP curves in
          Dynamic vary with outdoor temperature while Static uses the seasonal
          rating directly. Static SCOP/SEER is typically optimistic by 5-15%.</p>
        <p>• <span className="font-medium not-italic">DHW fuel mix</span>: Static apportions
          DHW demand across <code>fuel_mix.{'{'}gas, electric_resistance, heat_pump{'}'}</code>;
          Dynamic V1 still uses the legacy primary/secondary path (Brief 28-DynamicParity).
          Flipping the sliders in the Systems left column changes Static numbers
          instantly; Dynamic re-runs reflect only the legacy DHW config.</p>
        <p>• <span className="font-medium not-italic">Per-vent on/off</span>: Static gates
          per-vent <code>enabled</code> in the engine (IM-M4.5 §5.4 fix); Dynamic V1 has
          per-service gating only (heating/cooling/dhw). Per-vent-system Dynamic
          gating queues for Brief 28-DynamicParity.</p>
        <p>• <span className="font-medium not-italic">Per-system fan breakdown</span>: Static
          surfaces <code>ventilation[].fan_electricity_mwh</code> per system; Dynamic
          aggregates all fans into <code>Fans:Electricity</code> (single combined entry).</p>
      </div>
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   RIGHT COLUMN — Live Results panel
   ─────────────────────────────────────────────────────────────────────── */
const CRREM_TARGET = 184

function LiveResultsPanel({ consumption }) {
  if (!consumption) {
    return <div className="p-4 text-xxs text-mid-grey">Engine output not yet available.</div>
  }
  const eui       = consumption.total?.kwh_per_m2_yr ?? 0
  const totalElec = consumption.total?.electricity_mwh ?? 0
  const totalGas  = consumption.total?.gas_mwh ?? 0
  const total     = totalElec + totalGas

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey">EUI (instant)</p>
        <p className="text-3xl font-bold tabular-nums text-navy">{eui.toFixed(1)} <span className="text-xxs text-mid-grey">kWh/m²·yr</span></p>
        <div className="relative w-full h-3 bg-light-grey rounded-full overflow-hidden mt-2">
          <div className="h-full rounded-full transition-all duration-300" style={{
            width: `${Math.min(100, eui / 400 * 100)}%`,
            background: eui <= CRREM_TARGET ? '#16A34A' : eui <= CRREM_TARGET * 1.5 ? '#F59E0B' : '#DC2626',
          }} />
          <div className="absolute top-0 bottom-0 w-0.5 bg-gold" style={{ left: `${CRREM_TARGET / 400 * 100}%` }} />
        </div>
        <p className="text-xxs text-mid-grey mt-1">CRREM 1.5°C target <span className="text-gold font-medium">{CRREM_TARGET}</span> kWh/m²·yr</p>
      </div>

      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">Demand → delivered</p>
        <DemandRow label="Heating" demand={consumption.space_heating?.demand_mwh} delivered={consumption.space_heating?.delivered_mwh} enabled={consumption.space_heating?.enabled !== false} color={DEMAND_COLOURS.space_heating} />
        <DemandRow label="Cooling" demand={consumption.space_cooling?.demand_mwh} delivered={consumption.space_cooling?.delivered_mwh} enabled={consumption.space_cooling?.enabled !== false} color={DEMAND_COLOURS.space_cooling} />
        <DemandRow label="DHW"     demand={consumption.dhw?.demand_mwh}           delivered={consumption.dhw?.delivered_mwh}           enabled={consumption.dhw?.enabled !== false}           color={DEMAND_COLOURS.dhw} />
      </div>

      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">Fuel split</p>
        <FuelBar label="Electricity" mwh={totalElec} total={total} color={FUEL_COLOURS.electricity} />
        <FuelBar label="Gas"         mwh={totalGas}  total={total} color={FUEL_COLOURS.gas} />
      </div>

      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">Ventilation (per-system)</p>
        {(consumption.ventilation ?? []).map(v => (
          <div key={v.id} className={`text-xxs flex items-center justify-between py-0.5 ${v.enabled ? '' : 'opacity-50'}`}>
            <span className="text-navy truncate flex-1">{v.name}{!v.enabled && ' (off)'}</span>
            <span className="tabular-nums text-mid-grey ml-2">{(v.fan_electricity_mwh ?? 0).toFixed(1)} MWh</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DemandRow({ label, demand, delivered, enabled, color }) {
  const d  = Number(demand ?? 0)
  const dl = Number(delivered ?? 0)
  const max = Math.max(d, dl, 1)
  return (
    <div className="mb-2">
      <div className="flex items-baseline justify-between mb-0.5">
        <span className="text-xxs text-navy">{label}{!enabled && <span className="text-amber-700 ml-1">(off)</span>}</span>
        <span className="text-xxs tabular-nums text-mid-grey">{dl.toFixed(1)} / {d.toFixed(1)} MWh</span>
      </div>
      <div className="relative h-3 bg-light-grey/50 rounded-sm overflow-hidden">
        <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${(d / max) * 100}%`, backgroundColor: color, opacity: 0.3 }} title="demand" />
        <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${(dl / max) * 100}%`, backgroundColor: color, opacity: 0.85 }} title="delivered" />
      </div>
    </div>
  )
}

function FuelBar({ label, mwh, total, color }) {
  const pct = total > 0 ? mwh / total * 100 : 0
  return (
    <div className="mb-1">
      <div className="flex items-baseline justify-between">
        <span className="text-xxs text-navy">{label}</span>
        <span className="text-xxs tabular-nums text-mid-grey">{mwh.toFixed(1)} MWh ({pct.toFixed(0)}%)</span>
      </div>
      <div className="h-2 bg-light-grey/50 rounded-sm overflow-hidden">
        <div className="h-full rounded-sm" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

/* Brief 28-IM-Polish POL-M2 IA 3.2: Systems Live Results strip — the
   canonical 4-KPI strip sits at the TOP of the right column above the
   existing detail panel (EUI gauge / per-category demand bars / fuel
   split). KPIs per the brief mapping for Systems: EUI · Total
   electricity · Total gas · Carbon today (via grid intensity 190 g/kWh
   + flat 184 g/kWh gas — same convention as IM-M5 carbon today). */
function SystemsLiveResultsStrip({ consumption }) {
  if (!consumption) return <LiveResultsStrip loading />
  const eui = consumption.total?.kwh_per_m2_yr ?? 0
  const totalElec = consumption.total?.electricity_mwh ?? 0
  const totalGas  = consumption.total?.gas_mwh ?? 0
  // Carbon today (rough): elec × 190 + gas × 184, ÷ GIA. Mirror the
  // simpler version of IM-M5 results.carbon.today without re-importing
  // the trajectory helpers (which would pull in the full data files).
  const giaM2 = (consumption.total && consumption.total.kwh_per_m2_yr > 0)
    ? ((totalElec + totalGas) * 1000) / consumption.total.kwh_per_m2_yr
    : 0
  const carbonKgM2 = giaM2 > 0
    ? Math.round(((totalElec * 190) + (totalGas * 184)) / giaM2 * 100) / 100
    : 0
  const items = [
    {
      label: 'EUI (instant)', accent: '#0F766E',
      value: eui.toFixed(1), unit: 'kWh/m²·yr',
      sub: 'CRREM 1.5°C target 184',
    },
    {
      label: 'Electricity', accent: '#ECB01F',
      value: totalElec.toFixed(1), unit: 'MWh/yr',
      sub: `${Math.round(totalElec / Math.max(totalElec + totalGas, 0.001) * 100)}% of total`,
    },
    {
      label: 'Gas', accent: '#DC2626',
      value: totalGas.toFixed(1), unit: 'MWh/yr',
      sub: `${Math.round(totalGas / Math.max(totalElec + totalGas, 0.001) * 100)}% of total`,
    },
    {
      label: 'Carbon today', accent: '#9333EA',
      value: carbonKgM2.toFixed(1), unit: 'kgCO₂/m²·yr',
      sub: 'grid 190 g/kWh · gas 184 g/kWh',
    },
  ]
  // Stacked vertical layout inside the 340 px column — items wrap 2×2.
  return (
    <div className="grid grid-cols-2 border-b border-light-grey bg-off-white">
      {items.map((it, i) => (
        <div
          key={it.label ?? i}
          className="px-3 py-2 border-r border-b border-light-grey last:border-r-0"
          style={it.accent ? { borderTop: `2px solid ${it.accent}` } : undefined}
        >
          <p className="text-xxs uppercase tracking-wider text-mid-grey leading-tight">{it.label}</p>
          <p className="text-base text-navy font-bold tabular-nums leading-tight mt-0.5">
            {it.value} <span className="text-xxs text-mid-grey font-normal">{it.unit}</span>
          </p>
          <p className="text-xxs text-mid-grey/80 leading-tight mt-0.5 truncate" title={it.sub}>{it.sub}</p>
        </div>
      ))}
    </div>
  )
}
