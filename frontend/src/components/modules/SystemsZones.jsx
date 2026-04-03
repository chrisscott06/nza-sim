/**
 * SystemsZones.jsx — three-column live workspace
 *
 * Left (w-64):   All system inputs (HVAC, Ventilation, DHW, Lighting, Small Power)
 * Centre (flex-1): System schematic diagram
 * Right (w-80):  SystemsLiveResults — instant-calc results
 */

import { useContext, useEffect, useState } from 'react'
import { ProjectContext } from '../../context/ProjectContext.jsx'
import SystemSchematic from './systems/SystemSchematic.jsx'
import SystemsLiveResults from './systems/SystemsLiveResults.jsx'

// ── Shared compact input components ──────────────────────────────────────────

function SectionHeader({ title }) {
  return (
    <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2 mt-3 first:mt-0">{title}</p>
  )
}

function Field({ label, children }) {
  return (
    <div className="mb-2">
      <label className="text-xxs uppercase tracking-wider text-mid-grey block mb-0.5">{label}</label>
      {children}
    </div>
  )
}

function CompactSelect({ value, onChange, options, disabled }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className="w-full px-2 py-1 text-caption text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-teal transition-colors appearance-none disabled:opacity-40 cursor-pointer"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2395A5A6' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 6px center',
        paddingRight: '24px',
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function SliderWithNumber({ value, onChange, min, max, step = 0.1, unit = '', disabled }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        disabled={disabled}
        className="flex-1 h-[3px] accent-teal disabled:opacity-40"
      />
      <input
        type="number" min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        disabled={disabled}
        className="w-14 px-1 py-0.5 text-xxs text-navy border border-light-grey rounded text-right focus:outline-none focus:border-teal disabled:opacity-40"
      />
      {unit && <span className="text-xxs text-mid-grey flex-shrink-0">{unit}</span>}
    </div>
  )
}

function Toggle({ value, onChange, label }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`flex items-center gap-1.5 text-xxs px-2 py-1 rounded border transition-colors ${
        value
          ? 'bg-teal/10 text-teal border-teal/30'
          : 'bg-white text-mid-grey border-light-grey hover:border-teal'
      }`}
    >
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${value ? 'bg-teal' : 'bg-light-grey'}`} />
      {label}
    </button>
  )
}

// ── Left inputs column ────────────────────────────────────────────────────────

function InputsColumn({ library }) {
  const { systems, updateSystem } = useContext(ProjectContext)

  const isIdeal = systems.mode !== 'detailed'
  const isMVHR  = systems.ventilation_type?.startsWith('mvhr')

  // Build option lists from library
  // Library items use 'category' field (not 'type') — filter accordingly
  const hvacOpts = (() => {
    const items = library.filter(l => l.category === 'hvac')
    if (items.length === 0) return [{ value: systems.hvac_type ?? 'vrf_standard', label: 'Loading…' }]
    return items.map(l => ({ value: l.name, label: l.display_name ?? l.name }))
  })()

  const ventOpts = (() => {
    const items = library.filter(l => l.category === 'ventilation')
    if (items.length === 0) return [{ value: systems.ventilation_type ?? 'mev_standard', label: 'Loading…' }]
    return items.map(l => ({ value: l.name, label: l.display_name ?? l.name }))
  })()

  const dhwOpts = (() => {
    const items = library.filter(l => l.category === 'dhw' && !l.name.includes('preheat') && !l.name.includes('ashp'))
    if (items.length === 0) return [{ value: systems.dhw_primary ?? 'gas_boiler_dhw', label: 'Loading…' }]
    return items.map(l => ({ value: l.name, label: l.display_name ?? l.name }))
  })()

  const preheatOpts = [
    { value: 'none',     label: 'None' },
    { value: 'ashp_dhw', label: 'ASHP preheat (10→45°C)' },
  ]

  const lightingControlOpts = [
    { value: 'manual',             label: 'Manual switching' },
    { value: 'occupancy_sensing',  label: 'Occupancy sensing' },
    { value: 'daylight_dimming',   label: 'Daylight dimming' },
  ]

  const ventControlOpts = [
    { value: 'continuous',    label: 'Continuous' },
    { value: 'occupied',      label: 'Occupied hours' },
    { value: 'timer',         label: 'Timer' },
  ]

  const lpd = systems.lighting_power_density ?? 8.0
  const epd = systems.equipment_power_density ?? 15.0

  const LPD_PRESETS = [
    { label: 'LED',   value: 4  },
    { label: 'Fluor', value: 8  },
    { label: 'Incan', value: 16 },
  ]

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-white border-r border-light-grey">
      {/* Module header with teal accent */}
      <div
        className="px-3 pt-2.5 pb-2 border-b border-light-grey"
        style={{ borderTopWidth: '3px', borderTopColor: '#00AEEF', borderTopStyle: 'solid' }}
      >
        <p className="text-caption font-medium" style={{ color: '#00AEEF' }}>Systems</p>
        <p className="text-xxs text-mid-grey">HVAC, ventilation, DHW &amp; lighting</p>
      </div>

      <div className="p-3">

        {/* ── Simulation Mode ── */}
        <SectionHeader title="Simulation Mode" />
        <div className="flex gap-1.5 mb-3">
          {[{ v: 'detailed', l: 'Detailed' }, { v: 'ideal', l: 'Ideal Loads' }].map(opt => (
            <button
              key={opt.v}
              onClick={() => updateSystem('mode', opt.v)}
              className={`flex-1 py-1 text-xxs rounded border transition-colors ${
                systems.mode === opt.v
                  ? 'bg-teal text-white border-teal'
                  : 'bg-white text-mid-grey border-light-grey hover:border-teal'
              }`}
            >
              {opt.l}
            </button>
          ))}
        </div>
        {isIdeal && (
          <p className="text-xxs text-amber-600 mb-2 -mt-1">
            ⚠ Ideal Loads bypasses real HVAC — EUI will be lower than actuals
          </p>
        )}

        {/* ── HVAC ── */}
        <div className="border-t border-light-grey pt-3">
          <SectionHeader title="HVAC" />
          <div className={isIdeal ? 'opacity-40 pointer-events-none' : ''}>
            <Field label="System type">
              <CompactSelect
                value={systems.hvac_type ?? 'vrf_standard'}
                onChange={v => updateSystem('hvac_type', v)}
                options={hvacOpts}
              />
            </Field>
            <Field label="Heating COP">
              <SliderWithNumber
                value={systems.cop_heating ?? 3.5}
                onChange={v => updateSystem('cop_heating', v)}
                min={1.0} max={6.0} step={0.1}
              />
            </Field>
            <Field label="Cooling EER">
              <SliderWithNumber
                value={systems.cop_cooling ?? 3.2}
                onChange={v => updateSystem('cop_cooling', v)}
                min={1.0} max={6.0} step={0.1}
              />
            </Field>
          </div>
        </div>

        {/* ── Ventilation ── */}
        <div className="border-t border-light-grey pt-3">
          <SectionHeader title="Ventilation" />
          <Field label="System type">
            <CompactSelect
              value={systems.ventilation_type ?? 'mev_standard'}
              onChange={v => updateSystem('ventilation_type', v)}
              options={ventOpts}
            />
          </Field>
          <Field label="Specific fan power">
            <SliderWithNumber
              value={systems.sfp_override ?? 1.5}
              onChange={v => updateSystem('sfp_override', v)}
              min={0} max={3.0} step={0.1}
              unit="W/(l/s)"
            />
          </Field>
          {isMVHR && (
            <Field label="Heat recovery efficiency">
              <SliderWithNumber
                value={systems.hre_override ?? 85}
                onChange={v => updateSystem('hre_override', v)}
                min={50} max={95} step={1}
                unit="%"
              />
            </Field>
          )}
          <Field label="Control strategy">
            <CompactSelect
              value={systems.ventilation_control ?? 'continuous'}
              onChange={v => updateSystem('ventilation_control', v)}
              options={ventControlOpts}
            />
          </Field>
          <div className="mt-1.5">
            <Toggle
              value={systems.natural_ventilation ?? false}
              onChange={v => updateSystem('natural_ventilation', v)}
              label="Natural ventilation (openable windows)"
            />
          </div>
          {systems.natural_ventilation && (
            <Field label={`Window opening threshold — ${systems.natural_vent_threshold ?? 22}°C`}>
              <SliderWithNumber
                value={systems.natural_vent_threshold ?? 22}
                onChange={v => updateSystem('natural_vent_threshold', v)}
                min={18} max={28} step={0.5}
                unit="°C"
              />
            </Field>
          )}
        </div>

        {/* ── DHW ── */}
        <div className="border-t border-light-grey pt-3">
          <SectionHeader title="DHW" />
          <Field label="Primary system">
            <CompactSelect
              value={systems.dhw_primary ?? 'gas_boiler_dhw'}
              onChange={v => updateSystem('dhw_primary', v)}
              options={dhwOpts}
            />
          </Field>
          <Field label="Preheat">
            <CompactSelect
              value={systems.dhw_preheat ?? 'none'}
              onChange={v => updateSystem('dhw_preheat', v)}
              options={preheatOpts}
            />
          </Field>
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="Setpoint (°C)">
              <input
                type="number" min={45} max={70} step={1}
                value={systems.dhw_setpoint ?? 60}
                onChange={e => updateSystem('dhw_setpoint', Number(e.target.value))}
                className="w-full px-2 py-1 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal"
              />
            </Field>
            {(systems.dhw_preheat && systems.dhw_preheat !== 'none') && (
              <Field label="Preheat to (°C)">
                <input
                  type="number" min={30} max={55} step={1}
                  value={systems.dhw_preheat_setpoint ?? 45}
                  onChange={e => updateSystem('dhw_preheat_setpoint', Number(e.target.value))}
                  className="w-full px-2 py-1 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal"
                />
              </Field>
            )}
          </div>
        </div>

        {/* ── Lighting ── */}
        <div className="border-t border-light-grey pt-3">
          <SectionHeader title="Lighting" />
          <div className="flex items-center justify-between mb-1">
            <label className="text-xxs uppercase tracking-wider text-mid-grey">
              LPD — {lpd} W/m²
            </label>
            <div className="flex gap-1">
              {LPD_PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => updateSystem('lighting_power_density', p.value)}
                  className={`text-xxs px-1.5 py-0.5 rounded border transition-colors ${
                    lpd === p.value
                      ? 'bg-gold/20 text-navy border-gold/40'
                      : 'bg-white text-mid-grey border-light-grey hover:border-gold'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <SliderWithNumber
            value={lpd}
            onChange={v => updateSystem('lighting_power_density', v)}
            min={0} max={20} step={0.5}
            unit="W/m²"
          />
          <Field label="Control strategy">
            <CompactSelect
              value={systems.lighting_control ?? 'occupancy_sensing'}
              onChange={v => updateSystem('lighting_control', v)}
              options={lightingControlOpts}
            />
          </Field>
        </div>

        {/* ── Small Power ── */}
        <div className="border-t border-light-grey pt-3">
          <SectionHeader title="Small Power" />
          <Field label={`Equipment density — ${epd} W/m²`}>
            <SliderWithNumber
              value={epd}
              onChange={v => updateSystem('equipment_power_density', v)}
              min={0} max={30} step={0.5}
              unit="W/m²"
            />
          </Field>
          <p className="text-xxs text-mid-grey">
            CIBSE Guide A hotel default: 15 W/m²
          </p>
        </div>

      </div>
    </div>
  )
}

// ── Main three-column layout ──────────────────────────────────────────────────

export default function SystemsZones() {
  const [library, setLibrary]     = useState([])
  const [libraryData, setLibraryData] = useState({})

  useEffect(() => {
    // Fetch systems library for type dropdowns
    fetch('/api/library/systems')
      .then(r => r.ok ? r.json() : { systems: [] })
      .then(d => setLibrary(d.systems ?? []))
      .catch(() => {})

    // Fetch constructions for instant calc
    fetch('/api/library/constructions')
      .then(r => r.ok ? r.json() : { constructions: [] })
      .then(d => setLibraryData({ constructions: d.constructions ?? [] }))
      .catch(() => {})
  }, [])

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      {/* Left: inputs */}
      <div className="w-64 flex-shrink-0">
        <InputsColumn library={library} />
      </div>

      {/* Centre: system schematic */}
      <div className="flex-1 bg-off-white overflow-hidden">
        <SystemSchematic />
      </div>

      {/* Right: live results */}
      <div className="w-80 flex-shrink-0">
        <SystemsLiveResults libraryData={libraryData} />
      </div>
    </div>
  )
}
