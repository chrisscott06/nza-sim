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
import ScheduleEditor from './profiles/ScheduleEditor.jsx'

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
const DEMAND_COLOURS = {
  space_heating: '#DC2626',
  space_cooling: '#3B82F6',
  dhw:           '#F97316',
  fans:          '#06B6D4',
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

  // Schedule editor modal state — target system or opening triggers
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

        {/* RIGHT: Live Results ────────────────────────────────────── */}
        <div className="flex-shrink-0 w-[340px] bg-white border-l border-light-grey overflow-y-auto">
          <LiveResultsPanel consumption={consumption} />
        </div>
      </div>

      {/* ── Schedule editor modal ────────────────────────────────────── */}
      {editingSchedule && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center overflow-auto p-4">
          <div className="bg-white rounded-xl shadow-2xl my-4 w-full max-w-4xl">
            <ScheduleEditor
              initialSchedule={editingSchedule}
              target="project"
              onSaved={() => {
                setTimeout(() => setEditingSchedule(null), 800)
              }}
              onCancel={() => setEditingSchedule(null)}
            />
          </div>
        </div>
      )}
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
function SystemsSankey({ consumption, sysCfg }) {
  // Build the three columns:
  //   col 0: demands (space_heating, space_cooling, dhw, fans, lighting, sp)
  //   col 1: systems (named per category) — middle "router" nodes
  //   col 2: energy carriers (electricity, gas)
  // Plus a right-edge waste stream node for cooling heat rejection + exhaust loss.
  //
  // Each link width ∝ MWh value. Demand→system link = delivered_mwh.
  // System→carrier link = fuel_mwh per carrier. Unserved (enabled:false)
  // demands get a dashed red link to a "Unserved" sink instead of a system.
  //
  // ASHP preheat (dhw with heat_pump>0): the DHW system box's electricity
  // link is rendered red (RECOVERED-style) rather than green — per
  // Brief 28-IM Bug 5 fix.

  const items = [
    { key: 'space_heating', label: 'Heating',     unit: consumption.space_heating?.delivered_mwh ?? 0, demand: consumption.space_heating?.demand_mwh ?? 0, enabled: consumption.space_heating?.enabled !== false, e_mwh: consumption.space_heating?.electricity_mwh ?? 0, g_mwh: consumption.space_heating?.gas_mwh ?? 0 },
    { key: 'space_cooling', label: 'Cooling',     unit: consumption.space_cooling?.delivered_mwh ?? 0, demand: consumption.space_cooling?.demand_mwh ?? 0, enabled: consumption.space_cooling?.enabled !== false, e_mwh: consumption.space_cooling?.electricity_mwh ?? 0, g_mwh: 0 },
    { key: 'dhw',           label: 'DHW',         unit: consumption.dhw?.delivered_mwh ?? 0,           demand: consumption.dhw?.demand_mwh ?? 0,           enabled: consumption.dhw?.enabled !== false,           e_mwh: consumption.dhw?.electricity_mwh ?? 0, g_mwh: consumption.dhw?.gas_mwh ?? 0, fuel_mix: consumption.dhw?.fuel_mix_applied ?? null },
    { key: 'fans',          label: 'Vent fans',   unit: (consumption.ventilation ?? []).reduce((s, v) => s + (v.fan_electricity_mwh ?? 0), 0), demand: (consumption.ventilation ?? []).reduce((s, v) => s + (v.fan_electricity_mwh ?? 0), 0), enabled: true, e_mwh: (consumption.ventilation ?? []).reduce((s, v) => s + (v.fan_electricity_mwh ?? 0), 0), g_mwh: 0 },
    { key: 'lighting',      label: 'Lighting',    unit: consumption.lighting?.electricity_mwh ?? 0, demand: consumption.lighting?.electricity_mwh ?? 0, enabled: true, e_mwh: consumption.lighting?.electricity_mwh ?? 0, g_mwh: 0 },
    { key: 'small_power',   label: 'Small power', unit: consumption.small_power?.electricity_mwh ?? 0, demand: consumption.small_power?.electricity_mwh ?? 0, enabled: true, e_mwh: consumption.small_power?.electricity_mwh ?? 0, g_mwh: 0 },
  ]

  const maxFlow = Math.max(...items.map(i => Math.max(i.demand, i.unit, i.e_mwh, i.g_mwh)), 1)
  const W = 1000
  const H = 580
  const padT = 50
  const padB = 70
  const col0X = 140    // demand right edge
  const col1X = 480    // system right edge
  const col2X = 820    // carriers right edge
  const rightX = 920   // waste sink
  const lanesY = 480   // total height for items
  const laneH  = lanesY / items.length
  const nodeW  = 130
  const itemHmax = 50

  const scaleW = (mwh) => Math.max(2, Math.min(itemHmax, (mwh / maxFlow) * itemHmax))

  // Per-carrier totals
  const totalElec = consumption.total?.electricity_mwh ?? 0
  const totalGas  = consumption.total?.gas_mwh ?? 0
  const carrierMax = Math.max(totalElec, totalGas, 1)
  const carrierH = (mwh) => Math.max(8, (mwh / carrierMax) * 180)

  return (
    <div className="w-full h-full overflow-auto p-4">
      <p className="text-caption font-semibold text-navy">Energy flow — demand to system to fuel · MWh/yr</p>
      <p className="text-xxs text-mid-grey mb-3">
        Left → middle → right: building demand, served by named systems,
        consuming energy carriers. Width of each flow is proportional to
        annual MWh. <span className="text-amber-700">Dashed red</span> = unserved
        demand (system off). DHW heat-pump preheat shows in <span className="text-red-600 font-medium">red</span> (energy
        flowing INTO an upstream heat pump, recovered by gas boiler downstream).
      </p>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}>
        {/* Column labels */}
        <g fontSize="11" fill="#475569" fontWeight="600" textAnchor="middle">
          <text x={col0X - 50} y={28}>Demand</text>
          <text x={col1X - nodeW / 2} y={28}>System</text>
          <text x={col2X - nodeW / 2} y={28}>Energy carrier</text>
          <text x={rightX + 40} y={28}>Waste</text>
        </g>

        {/* Carrier bars on right */}
        <g>
          <rect x={col2X - nodeW} y={padT} width={nodeW} height={carrierH(totalElec)} fill={FUEL_COLOURS.electricity} opacity={0.75} />
          <text x={col2X - nodeW / 2} y={padT + carrierH(totalElec) / 2} fontSize="11" fill="white" textAnchor="middle" dominantBaseline="middle" fontWeight="600">Electricity {totalElec.toFixed(1)}</text>
          <rect x={col2X - nodeW} y={padT + carrierH(totalElec) + 16} width={nodeW} height={carrierH(totalGas)} fill={FUEL_COLOURS.gas} opacity={0.75} />
          <text x={col2X - nodeW / 2} y={padT + carrierH(totalElec) + 16 + carrierH(totalGas) / 2} fontSize="11" fill="white" textAnchor="middle" dominantBaseline="middle" fontWeight="600">Gas {totalGas.toFixed(1)}</text>
        </g>

        {/* Waste sink */}
        <g>
          <rect x={rightX} y={padT} width={80} height={70} fill="#E5E7EB" stroke="#9CA3AF" />
          <text x={rightX + 40} y={padT + 38} fontSize="10" fill="#6B7280" textAnchor="middle">Exhaust / heat rejection</text>
        </g>

        {/* Items rows */}
        {items.map((it, i) => {
          const cy = padT + laneH * (i + 0.5)
          const demandW = scaleW(it.demand)
          const deliveredW = scaleW(it.unit)
          const elecW = scaleW(it.e_mwh)
          const gasW = scaleW(it.g_mwh)
          const isUnserved = it.demand > 0.01 && it.unit < 0.01
          const isAshpPreheat = it.key === 'dhw' && (it.fuel_mix?.heat_pump ?? 0) > 0
          return (
            <g key={it.key}>
              {/* Demand node */}
              <rect x={col0X - nodeW} y={cy - 14} width={nodeW} height={28} rx={4} fill={DEMAND_COLOURS[it.key] ?? '#94A3B8'} opacity={isUnserved ? 0.4 : 0.85} />
              <text x={col0X - nodeW / 2} y={cy + 4} fontSize="11" fill="white" textAnchor="middle" fontWeight="600">{it.label}</text>
              <text x={col0X - nodeW / 2} y={cy + 18} fontSize="9" fill="#334155" textAnchor="middle">{it.demand.toFixed(1)} MWh demand</text>

              {/* Link: demand → system (or unserved sink) */}
              {isUnserved ? (
                <g>
                  <path
                    d={pathLink(col0X, cy, rightX, padT + 110, demandW)}
                    fill="none" stroke="#DC2626" strokeWidth={Math.max(2, demandW * 0.7)} strokeDasharray="6 4" opacity={0.7}
                  />
                  <text x={(col0X + rightX) / 2} y={(cy + padT + 110) / 2 - 8} fontSize="10" fill="#DC2626" fontWeight="600">unserved {it.demand.toFixed(1)}</text>
                </g>
              ) : (
                <path
                  d={pathLink(col0X, cy, col1X - nodeW, cy, deliveredW)}
                  fill="none" stroke={DEMAND_COLOURS[it.key] ?? '#94A3B8'} strokeWidth={Math.max(2, deliveredW * 0.7)} opacity={0.55}
                />
              )}

              {/* System node */}
              {!isUnserved && (
                <>
                  <rect x={col1X - nodeW} y={cy - 14} width={nodeW} height={28} rx={4} fill="white" stroke="#0E7490" />
                  <text x={col1X - nodeW / 2} y={cy + 4} fontSize="11" fill="#0C4A6E" textAnchor="middle">{systemLabel(it, sysCfg)}</text>

                  {/* System → carrier(s) */}
                  {it.e_mwh > 0.01 && (
                    <path
                      d={pathLink(col1X, cy - 4, col2X - nodeW, padT + carrierH(totalElec) / 2, elecW)}
                      fill="none"
                      stroke={isAshpPreheat ? '#DC2626' : FUEL_COLOURS.electricity}
                      strokeWidth={Math.max(2, elecW * 0.7)}
                      opacity={0.55}
                    />
                  )}
                  {it.g_mwh > 0.01 && (
                    <path
                      d={pathLink(col1X, cy + 4, col2X - nodeW, padT + carrierH(totalElec) + 16 + carrierH(totalGas) / 2, gasW)}
                      fill="none" stroke={FUEL_COLOURS.gas} strokeWidth={Math.max(2, gasW * 0.7)} opacity={0.55}
                    />
                  )}
                  {/* Cooling → waste */}
                  {it.key === 'space_cooling' && it.unit > 0.01 && (
                    <path
                      d={pathLink(col1X, cy, rightX, padT + 35, scaleW(it.unit))}
                      fill="none" stroke="#94A3B8" strokeWidth={Math.max(2, scaleW(it.unit) * 0.4)} opacity={0.45} strokeDasharray="4 4"
                    />
                  )}
                </>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function pathLink(x0, y0, x1, y1, _w) {
  const cp = (x0 + x1) / 2
  return `M ${x0} ${y0} C ${cp} ${y0}, ${cp} ${y1}, ${x1} ${y1}`
}

function systemLabel(it, sysCfg) {
  if (it.key === 'space_heating') return sysCfg.heating?.primary?.library_id ?? 'heating'
  if (it.key === 'space_cooling') return sysCfg.cooling?.primary?.library_id ?? 'cooling'
  if (it.key === 'dhw') {
    const mix = it.fuel_mix
    if (mix && mix.heat_pump > 0 && mix.gas > 0) return `ASHP ${Math.round(mix.heat_pump * 100)}% / Gas ${Math.round(mix.gas * 100)}%`
    if (mix && mix.heat_pump > 0) return `ASHP DHW ${Math.round(mix.heat_pump * 100)}%`
    if (mix && mix.gas > 0)       return `Gas DHW ${Math.round(mix.gas * 100)}%`
    return sysCfg.dhw?.primary?.library_id ?? 'dhw'
  }
  if (it.key === 'fans')        return `${(sysCfg.ventilation ?? []).length} systems`
  if (it.key === 'lighting')    return 'LED fixtures'
  if (it.key === 'small_power') return 'Plug load'
  return ''
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
    { key: 'cooling',  label: 'Cooling delivered',     color: '#3B82F6', daily_kwh: dpEng.delivered_kwh_per_day?.cooling },
    { key: 'dhw',      label: 'DHW delivered',         color: '#F97316', daily_kwh: dpEng.delivered_kwh_per_day?.dhw },
    { key: 'fans',     label: 'Fan power',             color: '#06B6D4', daily_kwh: dpEng.delivered_kwh_per_day?.fans },
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

  return (
    <WeatherSynchronisedProfile
      primary={primary}
      weather={{ t_out_mean_c, wind_mean_ms, ghi_mean_w_per_m2: ghi_mean_w_m2 }}
      height={540}
      caption={'Daily mean of the 8760-hour engine pass. Stacked area = per-service DELIVERED output (kW); line overlays = fuel CONSUMED per carrier (kW, dashed for gas). Heating + cooling traces follow the weather; DHW + fans + lighting + small power are V1 flat daily-shares pending hourly profile capture. Outdoor weather context below.'}
    />
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

  return (
    <div className="w-full h-full overflow-auto p-4 space-y-3">
      <div>
        <p className="text-caption font-semibold text-navy">System on-time schedules</p>
        <p className="text-xxs text-mid-grey">
          Per-system schedule visualisation. Each row shows Mon–Fri / Sat / Sun
          hour-of-day fractions for the assigned schedule. The "✏️ Edit" button
          opens the shared schedule editor; saving updates the project's
          schedule library and any other system referencing that schedule
          will recompute immediately.
        </p>
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
      <p className="text-caption font-semibold text-navy">Monthly energy + demand · kWh</p>
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
            <div className="text-xxs tabular-nums" style={{ color: '#DC2626' }}>
              {heatDemandM[i] > 100 ? `↓${Math.round(heatDemandM[i])}` : ''}
            </div>
            <div className="text-xxs tabular-nums" style={{ color: '#3B82F6' }}>
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
      <p className="text-caption font-semibold text-navy">Systems summary · annual</p>
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
