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
import { ProjectContext } from '../../context/ProjectContext.jsx'
import { WeatherContext } from '../../context/WeatherContext.jsx'
import { useHourlySolar } from '../../hooks/useHourlySolar.js'
import { calculateInstant } from '../../utils/instantCalc.js'
import { SCHEDULES, allScheduleNames } from '../../utils/scheduleLibrary.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../../data/systemTemplatesLibrary.js'
import WeatherSynchronisedProfile from '../profiles/WeatherSynchronisedProfile.jsx'
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

const SYSTEMS_ACCENT = '#00AEEF'
import LiveResultsStrip from '../shared/LiveResultsStrip.jsx'

const ACCENT = '#00AEEF'   // systems theme — cyan-bright

const CENTRE_TABS = [
  { id: 'sankey',   label: 'Sankey' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'monthly',  label: 'Monthly' },
  { id: 'summary',  label: 'Summary' },
]

const FUEL_COLOURS = {
  electricity: '#ECB01F',
  gas:         '#DC2626',
  district:    '#8B5CF6',
}
// Brief 37 Part 1: aligned to SYSTEMS_SERVICE_COLOURS in balanceColours.js.
const DEMAND_COLOURS = {
  space_heating: '#DC2626',
  space_cooling: '#00AEEF',
  dhw:           '#EC4899',
  fans:          '#14B8A6',
  lighting:      '#F59E0B',
  small_power:   '#8B5CF6',
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
  const result = useMemo(() => {
    if (!params || !weatherData || !hourlySolar || !constructionsLib) return null
    const cb = comfortBand ?? { lower_c: 20, upper_c: 26 }
    return calculateInstant(
      { ...params, comfort_band: cb }, constructions ?? {}, systems ?? {},
      libraryData, weatherData, hourlySolar, null,
      { mode: 'full', comfortBand: cb, engine: 'v2.5' },
    )
  }, [params, constructions, systems, libraryData, weatherData, hourlySolar, comfortBand, constructionsLib])

  // Centre view switcher state
  const [centreView, setCentreView] = useState(() => {
    try {
      const saved = localStorage.getItem('nza-systems-centre')
      if (CENTRE_TABS.some(t => t.id === saved)) return saved
    } catch {}
    return 'sankey'
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

  const sysCfg = params?.systems_config_v25 ?? {}
  const consumption = result?.consumption ?? null

  const updateSystem = (path, patch) => {
    // path = 'heating' | 'cooling' | 'dhw' | 'ventilation'
    const current = params?.systems_config_v25 ?? {}
    if (path === 'ventilation') {
      // patch = { index, partial }
      const list = Array.isArray(current.ventilation) ? current.ventilation : []
      const next = list.map((v, i) => i === patch.index ? { ...v, ...patch.partial } : v)
      updateParam('systems_config_v25', { ...current, ventilation: next })
      return
    }
    const merged = { ...(current[path] ?? {}), ...patch }
    if (patch.fuel_mix) {
      merged.fuel_mix = { ...((current[path] ?? {}).fuel_mix ?? {}), ...patch.fuel_mix }
    }
    updateParam('systems_config_v25', { ...current, [path]: merged })
  }

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
        <div className="flex-shrink-0 w-[290px] bg-white border-r border-light-grey overflow-y-auto">
          <InputsColumn
            sysCfg={sysCfg}
            updateSystem={updateSystem}
            params={params}
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
          <div className="flex-1 min-h-0 overflow-hidden">
            {!consumption && (
              <div className="h-full flex items-center justify-center text-mid-grey text-xxs">
                Engine output not ready — load weather data + library.
              </div>
            )}
            {consumption && centreView === 'sankey' && (
              <SystemsSankey consumption={consumption} sysCfg={sysCfg} />
            )}
            {consumption && centreView === 'profiles' && (
              <SystemsProfiles result={result} />
            )}
            {consumption && centreView === 'schedule' && (
              <SystemsSchedule
                sysCfg={sysCfg}
                params={params}
                openScheduleEditor={openScheduleEditor}
              />
            )}
            {consumption && centreView === 'monthly' && (
              <SystemsMonthly consumption={consumption} result={result} />
            )}
            {consumption && centreView === 'summary' && (
              <SystemsSummary consumption={consumption} />
            )}
          </div>
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
   LEFT COLUMN — input accordions
   ─────────────────────────────────────────────────────────────────────── */
function InputsColumn({ sysCfg, updateSystem, params, openScheduleEditor }) {
  const [open, setOpen] = useState({ heating: true, cooling: false, dhw: false, ventilation: false, lighting: false, sp: false })
  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }))

  const allSched = useMemo(() => allScheduleNames(params), [params])

  return (
    <div className="p-3 space-y-2">
      <SectionHeader id="heating" title="Heating" open={open.heating} onToggle={() => toggle('heating')}>
        <ServiceInputs
          serviceKey="heating"
          cfg={sysCfg.heating ?? {}}
          updateSystem={updateSystem}
          allSched={allSched}
          openScheduleEditor={openScheduleEditor}
          effLabel="SCOP"
          effField="primary_pct"
        />
      </SectionHeader>
      <SectionHeader id="cooling" title="Cooling" open={open.cooling} onToggle={() => toggle('cooling')}>
        <ServiceInputs
          serviceKey="cooling"
          cfg={sysCfg.cooling ?? {}}
          updateSystem={updateSystem}
          allSched={allSched}
          openScheduleEditor={openScheduleEditor}
          effLabel="SEER"
          effField="primary_pct"
        />
      </SectionHeader>
      <SectionHeader id="dhw" title="DHW" open={open.dhw} onToggle={() => toggle('dhw')}>
        <DHWInputs
          cfg={sysCfg.dhw ?? {}}
          updateSystem={updateSystem}
          allSched={allSched}
          openScheduleEditor={openScheduleEditor}
        />
      </SectionHeader>
      <SectionHeader id="ventilation" title="Ventilation" open={open.ventilation} onToggle={() => toggle('ventilation')}>
        <VentilationInputs
          list={Array.isArray(sysCfg.ventilation) ? sysCfg.ventilation : []}
          updateSystem={updateSystem}
          allSched={allSched}
          openScheduleEditor={openScheduleEditor}
        />
      </SectionHeader>
      <SectionHeader id="lighting" title="Lighting" open={open.lighting} onToggle={() => toggle('lighting')}>
        <div className="text-xxs text-mid-grey">
          LPD + schedule live in <NavLink to="/gains" className="text-navy underline">Internal Gains</NavLink>.
          Energy use is computed from there.
        </div>
      </SectionHeader>
      <SectionHeader id="sp" title="Small Power" open={open.sp} onToggle={() => toggle('sp')}>
        <div className="text-xxs text-mid-grey">
          EPD + schedule live in <NavLink to="/gains" className="text-navy underline">Internal Gains</NavLink>.
        </div>
      </SectionHeader>
    </div>
  )
}

function SectionHeader({ id, title, open, onToggle, children }) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left transition-opacity"
        style={{ backgroundColor: ACCENT }}
      >
        <span className="text-white text-xxs font-semibold uppercase tracking-wider">{title}</span>
        <span className="text-white/70 text-xs leading-none">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="pt-2 pb-2 px-1 space-y-2">{children}</div>
      )}
    </div>
  )
}

function OnOffToggle({ enabled, onChange, label }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`w-full flex items-center gap-1.5 text-xxs px-2 py-1.5 rounded border transition-colors ${
        enabled
          ? 'bg-cyan-50 text-cyan-800 border-cyan-600'
          : 'bg-light-grey/30 text-mid-grey border-light-grey'
      }`}
    >
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${enabled ? 'bg-cyan-600' : 'bg-mid-grey/40'}`} />
      <span className="flex-1 text-left">{label}: <span className="font-medium">{enabled ? 'ON' : 'OFF'}</span></span>
    </button>
  )
}

function ScheduleDropdown({ value, onChange, allSched, openScheduleEditor }) {
  return (
    <div className="flex items-center gap-1">
      <select
        value={value ?? 'always_on'}
        onChange={e => onChange(e.target.value)}
        className="flex-1 px-1.5 py-1 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-cyan-700"
      >
        {allSched.map(n => <option key={n} value={n}>{n}</option>)}
      </select>
      <button
        onClick={() => openScheduleEditor(value ?? 'always_on')}
        className="text-xxs px-1.5 py-1 rounded border border-light-grey text-mid-grey hover:text-cyan-700 hover:border-cyan-700 transition-colors"
        title="Edit this schedule"
      >
        ✏️
      </button>
    </div>
  )
}

function ServiceInputs({ serviceKey, cfg, updateSystem, allSched, openScheduleEditor, effLabel, effField }) {
  const enabled = cfg.enabled !== false
  return (
    <>
      <OnOffToggle
        enabled={enabled}
        onChange={(v) => updateSystem(serviceKey, { enabled: v })}
        label={serviceKey === 'heating' ? 'Heating' : serviceKey === 'cooling' ? 'Cooling' : serviceKey}
      />
      <div className={enabled ? '' : 'opacity-40 pointer-events-none'}>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mt-1.5 mb-0.5">Primary library_id</p>
        <p className="text-xxs text-navy font-medium truncate">{cfg.primary?.library_id ?? '—'}</p>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mt-1.5 mb-0.5">Primary share (%)</p>
        <input
          type="range" min={0} max={100} step={5}
          value={Number(cfg.primary_pct ?? 100)}
          onChange={e => updateSystem(serviceKey, { primary_pct: Number(e.target.value) })}
          className="w-full h-[3px] accent-cyan-700"
        />
        <p className="text-xxs text-navy tabular-nums mt-0.5">{cfg.primary_pct ?? 100}%</p>
        {cfg.secondary?.library_id && (
          <>
            <p className="text-xxs uppercase tracking-wider text-mid-grey mt-2 mb-0.5">Secondary library_id</p>
            <p className="text-xxs text-navy font-medium truncate">{cfg.secondary?.library_id}</p>
            <p className="text-xxs text-mid-grey mt-0.5">covers {100 - (cfg.primary_pct ?? 100)}%</p>
          </>
        )}
        {serviceKey === 'heating' && (
          <>
            <p className="text-xxs uppercase tracking-wider text-mid-grey mt-2 mb-0.5">Setpoint (°C)</p>
            <input
              type="number" min={10} max={28} step={0.5}
              value={Number(cfg.setpoint_c ?? 21)}
              onChange={e => updateSystem(serviceKey, { setpoint_c: Number(e.target.value) })}
              className="w-full px-1.5 py-0.5 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-cyan-700 tabular-nums"
            />
          </>
        )}
        {serviceKey === 'cooling' && (
          <>
            <p className="text-xxs uppercase tracking-wider text-mid-grey mt-2 mb-0.5">Setpoint (°C)</p>
            <input
              type="number" min={18} max={30} step={0.5}
              value={Number(cfg.setpoint_c ?? 25)}
              onChange={e => updateSystem(serviceKey, { setpoint_c: Number(e.target.value) })}
              className="w-full px-1.5 py-0.5 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-cyan-700 tabular-nums"
            />
          </>
        )}
        <p className="text-xxs uppercase tracking-wider text-mid-grey mt-2 mb-0.5">Schedule</p>
        <ScheduleDropdown
          value={cfg.schedule_ref}
          onChange={v => updateSystem(serviceKey, { schedule_ref: v })}
          allSched={allSched}
          openScheduleEditor={openScheduleEditor}
        />
      </div>
    </>
  )
}

function DHWInputs({ cfg, updateSystem, allSched, openScheduleEditor }) {
  const enabled = cfg.enabled !== false
  const mix = cfg.fuel_mix ?? { gas: 1.0, electric_resistance: 0.0, heat_pump: 0.0 }
  const sumPct = Math.round((Number(mix.gas) + Number(mix.electric_resistance) + Number(mix.heat_pump)) * 100)

  // Slider change: keep the other two fractions proportional so the total
  // stays at 1.0 (the engine normalises anyway, but the slider should
  // visually balance).
  const setMix = (key, pct) => {
    const frac = pct / 100
    const others = Object.keys(mix).filter(k => k !== key)
    const remainingFrac = Math.max(0, 1 - frac)
    const othersSum = others.reduce((s, k) => s + Number(mix[k] ?? 0), 0)
    const next = { ...mix, [key]: frac }
    for (const k of others) {
      next[k] = othersSum > 0 ? Number(mix[k]) * (remainingFrac / othersSum) : remainingFrac / others.length
    }
    updateSystem('dhw', { fuel_mix: next })
  }

  return (
    <>
      <OnOffToggle enabled={enabled} onChange={v => updateSystem('dhw', { enabled: v })} label="DHW" />
      <div className={enabled ? '' : 'opacity-40 pointer-events-none'}>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mt-2 mb-1">Fuel mix (must sum to 100%)</p>
        <FuelMixSlider label="Gas"               color="#DC2626" pct={Math.round(Number(mix.gas) * 100)}                 onChange={p => setMix('gas', p)} />
        <FuelMixSlider label="Electric resistance" color="#ECB01F" pct={Math.round(Number(mix.electric_resistance) * 100)} onChange={p => setMix('electric_resistance', p)} />
        <FuelMixSlider label="Heat pump"         color="#16A34A" pct={Math.round(Number(mix.heat_pump) * 100)}           onChange={p => setMix('heat_pump', p)} />
        <p className={`text-xxs mt-1 ${sumPct === 100 ? 'text-mid-grey' : 'text-amber-700'}`}>
          Sum: {sumPct}% {sumPct !== 100 && '(engine normalises)'}
        </p>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mt-2 mb-0.5">Heat pump library</p>
        <p className="text-xxs text-navy font-medium truncate">{cfg.primary?.library_id ?? '—'}</p>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mt-1.5 mb-0.5">Gas boiler library</p>
        <p className="text-xxs text-navy font-medium truncate">{cfg.secondary?.library_id ?? '—'}</p>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mt-1.5 mb-0.5">Litres / person / day</p>
        <input
          type="number" min={20} max={200} step={5}
          value={Number(cfg.litres_per_person_per_day ?? 80)}
          onChange={e => updateSystem('dhw', { litres_per_person_per_day: Number(e.target.value) })}
          className="w-full px-1.5 py-0.5 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-cyan-700 tabular-nums"
        />
        <p className="text-xxs uppercase tracking-wider text-mid-grey mt-1.5 mb-0.5">Schedule</p>
        <ScheduleDropdown
          value={cfg.schedule_ref}
          onChange={v => updateSystem('dhw', { schedule_ref: v })}
          allSched={allSched}
          openScheduleEditor={openScheduleEditor}
        />
      </div>
    </>
  )
}

function FuelMixSlider({ label, color, pct, onChange }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
      <span className="text-xxs text-mid-grey w-24 flex-shrink-0 truncate">{label}</span>
      <input
        type="range" min={0} max={100} step={5}
        value={pct}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 h-[3px]"
        style={{ accentColor: color }}
      />
      <span className="text-xxs text-navy tabular-nums w-7 text-right">{pct}%</span>
    </div>
  )
}

function VentilationInputs({ list, updateSystem, allSched, openScheduleEditor }) {
  if (list.length === 0) return <div className="text-xxs text-mid-grey">No ventilation systems configured.</div>
  return (
    <div className="space-y-2">
      {list.map((v, i) => (
        <div key={v.id ?? i} className="border border-light-grey rounded p-2 space-y-1.5">
          <p className="text-xxs font-medium text-navy truncate">{v.name ?? v.id ?? `Vent ${i + 1}`}</p>
          <OnOffToggle
            enabled={v.enabled !== false}
            onChange={en => updateSystem('ventilation', { index: i, partial: { enabled: en } })}
            label="System"
          />
          <div className={v.enabled === false ? 'opacity-40 pointer-events-none' : ''}>
            <div className="flex items-center gap-1.5">
              <span className="text-xxs text-mid-grey w-12 flex-shrink-0">Flow</span>
              <input
                type="number" min={0} step={10}
                value={Number(v.flow_l_s ?? 0)}
                onChange={e => updateSystem('ventilation', { index: i, partial: { flow_l_s: Number(e.target.value) } })}
                className="flex-1 px-1.5 py-0.5 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-cyan-700 tabular-nums"
              />
              <span className="text-xxs text-mid-grey w-5">L/s</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-xxs text-mid-grey w-12 flex-shrink-0">SFP</span>
              <input
                type="number" min={0} step={0.05}
                value={Number(v.sfp_w_per_l_s ?? 0)}
                onChange={e => updateSystem('ventilation', { index: i, partial: { sfp_w_per_l_s: Number(e.target.value) } })}
                className="flex-1 px-1.5 py-0.5 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-cyan-700 tabular-nums"
              />
              <span className="text-xxs text-mid-grey w-12">W/(L/s)</span>
            </div>
            <div className="mt-1.5">
              <OnOffToggle
                enabled={v.hre_enabled !== false && (Number(v.hre ?? 0) > 0)}
                onChange={en => updateSystem('ventilation', { index: i, partial: { hre_enabled: en, hre: en ? Math.max(Number(v.hre ?? 0), 0.7) : 0 } })}
                label="HRE"
              />
              {Number(v.hre ?? 0) > 0 && (
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-xxs text-mid-grey w-12 flex-shrink-0">η</span>
                  <input
                    type="range" min={0.5} max={0.95} step={0.05}
                    value={Number(v.hre ?? 0.7)}
                    onChange={e => updateSystem('ventilation', { index: i, partial: { hre: Number(e.target.value) } })}
                    className="flex-1 h-[3px] accent-cyan-700"
                  />
                  <span className="text-xxs text-navy tabular-nums w-9 text-right">{Math.round(Number(v.hre ?? 0) * 100)}%</span>
                </div>
              )}
            </div>
            <p className="text-xxs uppercase tracking-wider text-mid-grey mt-1.5 mb-0.5">Schedule</p>
            <ScheduleDropdown
              value={v.schedule_ref}
              onChange={r => updateSystem('ventilation', { index: i, partial: { schedule_ref: r } })}
              allSched={allSched}
              openScheduleEditor={openScheduleEditor}
            />
          </div>
        </div>
      ))}
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

function SystemsSankey({ consumption, sysCfg }) {
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

  // Split a service's delivered demand into fuel branches. Each branch has
  // a delivered_mwh (source-side / left width of the ribbon) and a fuel_mwh
  // (target-side / right width of the ribbon). The width change IS the
  // SCOP / efficiency.
  function makeBranches(delivered, e_mwh, g_mwh, mix) {
    if (!delivered || delivered < 0.01) return []
    const branches = []
    if (mix && (mix.heat_pump ?? 0) > 0 && (mix.gas ?? 0) > 0) {
      const total = (mix.heat_pump ?? 0) + (mix.gas ?? 0)
      branches.push({ fuel: 'electricity', delivered_mwh: delivered * mix.heat_pump / total, fuel_mwh: e_mwh })
      branches.push({ fuel: 'gas',         delivered_mwh: delivered * mix.gas / total,       fuel_mwh: g_mwh })
    } else if (e_mwh > 0.01 && g_mwh > 0.01) {
      // No fuel_mix but both fuels — split by fuel proportion (rare).
      const t = e_mwh + g_mwh
      branches.push({ fuel: 'electricity', delivered_mwh: delivered * e_mwh / t, fuel_mwh: e_mwh })
      branches.push({ fuel: 'gas',         delivered_mwh: delivered * g_mwh / t, fuel_mwh: g_mwh })
    } else if (e_mwh > 0.01) {
      branches.push({ fuel: 'electricity', delivered_mwh: delivered, fuel_mwh: e_mwh })
    } else if (g_mwh > 0.01) {
      branches.push({ fuel: 'gas',         delivered_mwh: delivered, fuel_mwh: g_mwh })
    }
    return branches
  }

  // Efficiency string for the system column footer line, where the engine
  // exposes it. SCOP / EER live on the consumption block; for DHW (mixed)
  // and lighting/SP/fans (1:1) we don't show one.
  function effString(scopOrSeer, kind) {
    if (scopOrSeer == null || !isFinite(scopOrSeer) || scopOrSeer <= 0) return null
    if (scopOrSeer < 1) return `${Math.round(scopOrSeer * 100)}% eff`
    return `${kind} ${scopOrSeer.toFixed(1)}`
  }

  const items = [
    {
      key: 'space_heating', label: 'Heating',
      demand:    c.space_heating?.demand_mwh    ?? 0,
      delivered: c.space_heating?.delivered_mwh ?? 0,
      branches:  makeBranches(
        c.space_heating?.delivered_mwh ?? 0,
        c.space_heating?.electricity_mwh ?? 0,
        c.space_heating?.gas_mwh ?? 0,
        null,
      ),
      sysLabel: fmtSys(sysCfg.heating?.primary?.library_id ?? ''),
      effLabel: effString(c.space_heating?.scop_effective, 'SCOP'),
    },
    {
      key: 'space_cooling', label: 'Cooling',
      demand:    c.space_cooling?.demand_mwh    ?? 0,
      delivered: c.space_cooling?.delivered_mwh ?? 0,
      branches:  makeBranches(
        c.space_cooling?.delivered_mwh ?? 0,
        c.space_cooling?.electricity_mwh ?? 0,
        0,
        null,
      ),
      sysLabel: fmtSys(sysCfg.cooling?.primary?.library_id ?? ''),
      effLabel: effString(c.space_cooling?.seer_effective, 'EER'),
    },
    {
      key: 'dhw', label: 'DHW',
      demand:    c.dhw?.demand_mwh    ?? 0,
      delivered: c.dhw?.delivered_mwh ?? 0,
      branches:  makeBranches(
        c.dhw?.delivered_mwh ?? 0,
        c.dhw?.electricity_mwh ?? 0,
        c.dhw?.gas_mwh ?? 0,
        dhwMix,
      ),
      sysLabel: dhwIsMixed ? 'Mixed' : fmtSys(sysCfg.dhw?.primary?.library_id ?? ''),
      effLabel: null,  // Mixed → blended SCOP/eff not meaningful as one figure
    },
    {
      key: 'fans', label: 'Mech vent',
      demand:    fan_total,
      delivered: fan_total,
      branches:  makeBranches(fan_total, fan_total, 0, null),
      sysLabel:  ventListCfg.length > 1
        ? `${ventListCfg.length} systems`
        : (ventListCfg[0]?.name ? fmtSys(ventListCfg[0].name) : fmtSys(ventListCfg[0]?.id ?? '')),
      effLabel:  null,
    },
    {
      key: 'lighting', label: 'Lighting',
      demand:    c.lighting?.electricity_mwh ?? 0,
      delivered: c.lighting?.electricity_mwh ?? 0,
      branches:  makeBranches(
        c.lighting?.electricity_mwh ?? 0,
        c.lighting?.electricity_mwh ?? 0,
        0,
        null,
      ),
      sysLabel: 'LED fixtures',
      effLabel: null,
    },
    {
      key: 'small_power', label: 'Small power',
      demand:    c.small_power?.electricity_mwh ?? 0,
      delivered: c.small_power?.electricity_mwh ?? 0,
      branches:  makeBranches(
        c.small_power?.electricity_mwh ?? 0,
        c.small_power?.electricity_mwh ?? 0,
        0,
        null,
      ),
      sysLabel: 'Plug load',
      effLabel: null,
    },
  ].filter(it => it.demand > 0.01)

  for (const it of items) {
    it.isUnserved = it.demand > 0.01 && it.delivered < 0.01
    if (it.isUnserved) { it.sysLabel = '(off — no system)'; it.effLabel = null }
  }

  // ── Single uniform scale: demand sum drives the page height ──────────────
  const W = 920, H = 620
  const padT = 32
  const padB = 16
  const availH = H - padT - padB
  const NAME_GAP_PX = 14   // service-name label above the bar
  const MWH_GAP_PX  = 13   // MWh figure below the bar
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
    const barH = scaleW(it.demand)
    it.nameY = yCursor + NAME_GAP_PX - 4
    it.barY0 = yCursor + NAME_GAP_PX
    it.barY1 = it.barY0 + barH
    it.barMid = (it.barY0 + it.barY1) / 2
    it.mwhY  = it.barY1 + MWH_GAP_PX - 3
    yCursor  = it.barY1 + MWH_GAP_PX
  }

  // Assign source-side y-extents to each branch (stack from bar top using the
  // delivered share). Sum of branch source heights ≈ demand bar height.
  for (const it of items) {
    if (it.isUnserved) continue
    let cy = it.barY0
    for (const br of it.branches) {
      br.srcW  = scaleW(br.delivered_mwh)
      br.srcY0 = cy
      br.srcY1 = cy + br.srcW
      cy = br.srcY1
    }
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
              />
            )
          })
        })}

        {/* ── Demand bars (left) ─────────────────────────────────────────── */}
        {items.map(it => {
          const barH = it.barY1 - it.barY0
          const colour = DEMAND_COLOURS[it.key] ?? '#94A3B8'
          return (
            <g key={`d-${it.key}`}>
              <text x={leftX0 + nodeW / 2} y={it.nameY} fontSize="10"
                fill={it.isUnserved ? '#9CA3AF' : '#1F2937'} textAnchor="middle"
                fontWeight="600">
                {it.label}{it.isUnserved ? ' (off)' : ''}
              </text>
              <rect x={leftX0} y={it.barY0} width={nodeW} height={Math.max(2, barH)}
                fill={colour} opacity={it.isUnserved ? 0.30 : 0.90} rx={2} />
              <text x={leftX0 + nodeW / 2} y={it.mwhY} fontSize="9"
                fill={it.isUnserved ? '#9CA3AF' : '#374151'} textAnchor="middle"
                fontWeight="500">
                {it.demand.toFixed(1)} MWh
              </text>
            </g>
          )
        })}

        {/* ── System column (middle) — small text per row, no box ────────── */}
        {items.map(it => (
          <g key={`s-${it.key}`}>
            <text x={systemX} y={it.barMid - (it.effLabel ? 5 : 0)} fontSize="9"
              fill={it.isUnserved ? '#9CA3AF' : '#374151'} textAnchor="middle"
              fontWeight="500" fontStyle="italic">
              {it.sysLabel}
            </text>
            {it.effLabel && !it.isUnserved && (
              <text x={systemX} y={it.barMid + 8} fontSize="8"
                fill="#6B7280" textAnchor="middle">
                {it.effLabel}
              </text>
            )}
          </g>
        ))}

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
                {b.mwh.toFixed(1)} MWh
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
   CENTRE — PROFILES
   ─────────────────────────────────────────────────────────────────────── */
function SystemsProfiles({ result }) {
  const dpEng = result?.energy_use?.daily_profiles ?? result?.consumption?.daily_profiles
  const dpFab = result?.daily_profiles   // State 2 weather strip on result.daily_profiles
  if (!dpEng) {
    return <div className="h-full flex items-center justify-center text-mid-grey text-xxs">Engine profile data not yet available.</div>
  }
  const w = dpFab?.weather ?? {}
  const t_out_mean_c    = (w.t_out_sum_c ?? []).map(v => v / 24)
  const wind_mean_ms    = (w.wind_sum_ms ?? []).map(v => v / 24)
  const ghi_mean_w_m2   = (w.ghi_sum_w_per_m2 ?? []).map(v => v / 24)

  const stacks = [
    { key: 'heating',  label: 'Heating delivered',     color: '#DC2626', daily_kwh: dpEng.delivered_kwh_per_day?.heating },
    { key: 'cooling',  label: 'Cooling delivered',     color: '#00AEEF', daily_kwh: dpEng.delivered_kwh_per_day?.cooling },
    { key: 'dhw',      label: 'DHW delivered',         color: '#EC4899', daily_kwh: dpEng.delivered_kwh_per_day?.dhw },
    { key: 'fans',     label: 'Fan power',             color: '#14B8A6', daily_kwh: dpEng.delivered_kwh_per_day?.fans },
    { key: 'lighting', label: 'Lighting',              color: '#F59E0B', daily_kwh: dpEng.delivered_kwh_per_day?.lighting },
    { key: 'sp',       label: 'Small power',           color: '#8B5CF6', daily_kwh: dpEng.delivered_kwh_per_day?.small_power },
  ]
  const lines = [
    { key: 'elec', label: 'Electricity (kW)', color: '#ECB01F', daily_kwh: dpEng.fuel_kwh_per_day?.electricity },
    { key: 'gas',  label: 'Gas (kW)',         color: '#DC2626', daily_kwh: dpEng.fuel_kwh_per_day?.gas, dashed: true },
  ]
  const primary = {
    title: 'Hourly system output and energy use',
    unit:  'kW',
    stacks,
    lines,
  }

  // Brief 28-IM-Polish POL-M2.
  const sumArr = (a) => Array.isArray(a) ? a.reduce((s, v) => s + (v ?? 0), 0) : 0
  const totalElecKwh = sumArr(dpEng.fuel_kwh_per_day?.electricity)
  const totalGasKwh  = sumArr(dpEng.fuel_kwh_per_day?.gas)
  const gia = result?.metadata?.gia_m2 ?? result?.heat_balance?.metadata?.gia_m2 ?? 0
  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-shrink-0 flex items-center justify-between gap-2 px-4 pt-2 pb-1">
        <EnginePill mode="static" />
        <div className="flex items-center gap-2">
          <ChartTotalsBadge label="Σ elec" value_kwh={totalElecKwh} gia_m2={gia} />
          <ChartTotalsBadge label="Σ gas"  value_kwh={totalGasKwh}  gia_m2={gia} />
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <WeatherSynchronisedProfile
          primary={primary}
          weather={{ t_out_mean_c, wind_mean_ms, ghi_mean_w_per_m2: ghi_mean_w_m2 }}
          height={540}
          caption={'Daily mean of the 8760-hour engine pass. Stacked area = per-service DELIVERED output (kW); line overlays = fuel CONSUMED per carrier (kW, dashed for gas). Heating + cooling traces follow the weather; DHW + fans + lighting + small power are V1 flat daily-shares pending hourly profile capture. Outdoor weather context below.'}
        />
      </div>
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   CENTRE — SCHEDULE (per-system grids with edit button)
   ─────────────────────────────────────────────────────────────────────── */
function SystemsSchedule({ sysCfg, params, openScheduleEditor }) {
  const rows = []
  const add = (id, label, schedule_ref, enabled) => rows.push({ id, label, schedule_ref, enabled })
  add('heating', 'Heating',  sysCfg.heating?.schedule_ref ?? 'always_on', sysCfg.heating?.enabled !== false)
  add('cooling', 'Cooling',  sysCfg.cooling?.schedule_ref ?? 'always_on', sysCfg.cooling?.enabled !== false)
  add('dhw',     'DHW',      sysCfg.dhw?.schedule_ref ?? 'always_on',     sysCfg.dhw?.enabled !== false)
  for (const v of (sysCfg.ventilation ?? [])) {
    add(v.id ?? v.name ?? 'vent', `Vent: ${v.name ?? v.id ?? '?'}`, v.schedule_ref ?? 'always_on', v.enabled !== false)
  }

  const resolveSched = (name) => {
    const proj = (params?.schedules ?? []).find(s => s?.name === name || s?.id === name)
    if (proj) return proj
    return SCHEDULES[name] ?? { day_types: { weekday: Array(24).fill(0), saturday: Array(24).fill(0), sunday: Array(24).fill(0) } }
  }

  // Brief 28-IM-Polish POL-M2.
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
            hour-of-day fractions for the assigned schedule. The "✏️ Edit" button
            opens the shared schedule editor; saving updates the project's
            schedule library and any other system referencing that schedule
            will recompute immediately.
          </p>
        </div>
        <div className="text-xxs text-mid-grey tabular-nums flex-shrink-0">{rows.length} systems</div>
      </div>
      {rows.map(r => {
        const sched = resolveSched(r.schedule_ref)
        return (
          <div key={r.id} className={`bg-white border border-light-grey rounded p-3 max-w-3xl ${r.enabled ? '' : 'opacity-60'}`}>
            <div className="flex items-baseline justify-between mb-2 gap-3">
              <div className="flex items-baseline gap-2 min-w-0">
                <p className="text-caption font-medium text-navy truncate">{r.label}</p>
                {!r.enabled && <span className="text-xxs text-amber-700">(OFF)</span>}
              </div>
              <div className="flex items-center gap-2 text-xxs text-mid-grey flex-shrink-0">
                <span>schedule: <span className="text-navy">{r.schedule_ref}</span></span>
                <button
                  onClick={() => openScheduleEditor(r.schedule_ref)}
                  className="px-2 py-0.5 rounded border border-light-grey text-mid-grey hover:text-cyan-700 hover:border-cyan-700"
                >
                  ✏️ Edit
                </button>
              </div>
            </div>
            <ScheduleGrid label="Mon–Fri" hours={sched.day_types?.weekday ?? Array(24).fill(0)} />
            <ScheduleGrid label="Sat"     hours={sched.day_types?.saturday ?? Array(24).fill(0)} />
            <ScheduleGrid label="Sun"     hours={sched.day_types?.sunday ?? Array(24).fill(0)} />
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

  const maxBar = Math.max(...elecM, ...gasM, ...heatDemandM, ...coolDemandM, 1)

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
      <div className="flex items-end gap-2 max-w-5xl" style={{ height: 260 }}>
        {months.map((m, i) => (
          <div key={m} className="flex-1 flex flex-col items-center gap-1">
            <div className="text-xxs text-mid-grey tabular-nums">
              {(elecM[i] + gasM[i]) > 1000 ? ((elecM[i]+gasM[i])/1000).toFixed(1)+'k' : Math.round(elecM[i] + gasM[i])}
            </div>
            <div className="w-full" style={{ height: 200 }}>
              <div className="w-full" style={{ height: `${(gasM[i] / maxBar) * 200}px`, backgroundColor: FUEL_COLOURS.gas, opacity: 0.85 }} title={`Gas ${Math.round(gasM[i])} kWh`} />
              <div className="w-full" style={{ height: `${(elecM[i] / maxBar) * 200}px`, backgroundColor: FUEL_COLOURS.electricity, opacity: 0.85 }} title={`Electricity ${Math.round(elecM[i])} kWh`} />
            </div>
            <div className="text-xxs text-mid-grey">{m}</div>
            {/* Demand line indicators below */}
            <div className="text-xxs tabular-nums" style={{ color: '#DC2626' /* heating red */ }}>
              {heatDemandM[i] > 100 ? `↓${Math.round(heatDemandM[i])}` : ''}
            </div>
            <div className="text-xxs tabular-nums" style={{ color: '#00AEEF' /* cooling cyan */ }}>
              {coolDemandM[i] > 100 ? `↑${Math.round(coolDemandM[i])}` : ''}
            </div>
          </div>
        ))}
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
  const rows = [
    { key: 'space_heating', label: 'Space heating', node: consumption.space_heating, effKey: 'scop_effective' },
    { key: 'space_cooling', label: 'Space cooling', node: consumption.space_cooling, effKey: 'seer_effective' },
    { key: 'dhw',           label: 'DHW',           node: consumption.dhw,           effKey: null },
    { key: 'fans',          label: 'Vent fans',     node: { delivered_mwh: (consumption.ventilation ?? []).reduce((s, v) => s + (v.fan_electricity_mwh ?? 0), 0), demand_mwh: (consumption.ventilation ?? []).reduce((s, v) => s + (v.fan_electricity_mwh ?? 0), 0), electricity_mwh: (consumption.ventilation ?? []).reduce((s, v) => s + (v.fan_electricity_mwh ?? 0), 0), gas_mwh: 0, enabled: (consumption.ventilation ?? []).some(v => v.enabled !== false) } },
    { key: 'lighting',      label: 'Lighting',      node: { delivered_mwh: consumption.lighting?.electricity_mwh ?? 0, demand_mwh: consumption.lighting?.electricity_mwh ?? 0, electricity_mwh: consumption.lighting?.electricity_mwh ?? 0, gas_mwh: 0, enabled: true } },
    { key: 'small_power',   label: 'Small power',   node: { delivered_mwh: consumption.small_power?.electricity_mwh ?? 0, demand_mwh: consumption.small_power?.electricity_mwh ?? 0, electricity_mwh: consumption.small_power?.electricity_mwh ?? 0, gas_mwh: 0, enabled: true } },
  ]

  const totalElec = consumption.total?.electricity_mwh ?? 0
  const totalGas  = consumption.total?.gas_mwh ?? 0
  const eui       = consumption.total?.kwh_per_m2_yr ?? 0
  const CRREM_TARGET = 184

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
        Per-category demand → delivered → carrier breakdown. SCOP/SEER columns
        show the effective seasonal performance the engine derived from the
        installed system mix.
      </p>

      <table className="w-full max-w-4xl text-xxs border-collapse">
        <thead>
          <tr className="border-b border-light-grey text-mid-grey uppercase tracking-wider">
            <th className="text-left py-2 pr-3 font-medium">Category</th>
            <th className="text-right py-2 pr-3 font-medium">Demand (MWh)</th>
            <th className="text-right py-2 pr-3 font-medium">Delivered (MWh)</th>
            <th className="text-right py-2 pr-3 font-medium">Electricity (MWh)</th>
            <th className="text-right py-2 pr-3 font-medium">Gas (MWh)</th>
            <th className="text-right py-2 font-medium">SCOP / SEER</th>
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
              <td className="py-1.5 text-right tabular-nums text-mid-grey">{r.effKey && r.node[r.effKey] ? r.node[r.effKey].toFixed(2) : '—'}</td>
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
