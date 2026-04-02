import { useContext, useEffect, useState } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'

function Field({ label, children, note }) {
  return (
    <div className="space-y-1">
      <label className="text-xxs uppercase tracking-wider text-mid-grey">{label}</label>
      {children}
      {note && <p className="text-xxs text-mid-grey">{note}</p>}
    </div>
  )
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-teal transition-colors appearance-none"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2395A5A6' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 8px center',
        paddingRight: '28px',
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Slider({ value, onChange, min, max, step = 1, label, unit }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 h-[3px]"
        style={{ accentColor: '#2B2A4C' }}
      />
      <span className="text-caption text-navy font-medium w-12 text-right">
        {value}{unit}
      </span>
    </div>
  )
}

function Toggle({ value, onChange, label, description }) {
  return (
    <div className="flex items-start gap-3">
      <button
        onClick={() => onChange(!value)}
        className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 mt-0.5 ${value ? 'bg-teal' : 'bg-light-grey'}`}
      >
        <span
          className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform"
          style={{ transform: value ? 'translateX(18px)' : 'translateX(2px)' }}
        />
      </button>
      <div>
        <p className="text-caption text-navy">{label}</p>
        {description && <p className="text-xxs text-mid-grey mt-0.5">{description}</p>}
      </div>
    </div>
  )
}

export default function VentilationTab() {
  const { systems, updateSystem } = useContext(ProjectContext)
  const [library, setLibrary] = useState([])

  useEffect(() => {
    fetch('/api/library/systems?category=ventilation')
      .then(r => r.json())
      .then(d => setLibrary(d.systems ?? []))
      .catch(() => {})
  }, [])

  const selected = library.find(s => s.name === systems.ventilation_type)
  const isMVHR   = selected?.type === 'mvhr'
  const mechOptions = library
    .filter(s => s.type !== 'natural_ventilation')
    .map(s => ({ value: s.name, label: s.display_name }))

  return (
    <div className="p-3 space-y-4">

      {/* Mechanical ventilation type */}
      <Field
        label="Mechanical ventilation"
        note={selected?.description}
      >
        <Select
          value={systems.ventilation_type}
          onChange={v => updateSystem('ventilation_type', v)}
          options={mechOptions.length > 0 ? mechOptions : [{ value: systems.ventilation_type, label: 'Loading…' }]}
        />
      </Field>

      {/* Specific fan power */}
      <Field label={`Specific fan power — ${systems.sfp_override ?? selected?.specific_fan_power ?? 1.5} W/(l/s)`}>
        <Slider
          value={systems.sfp_override ?? (selected?.specific_fan_power ?? 1.5)}
          onChange={v => updateSystem('sfp_override', v)}
          min={0.5} max={3.0} step={0.1}
          unit=" W/(l/s)"
        />
      </Field>

      {/* Heat recovery */}
      <Field
        label={`Heat recovery efficiency${!isMVHR ? ' — N/A for MEV' : ''}`}
        note={isMVHR ? 'Fraction of exhaust heat recovered' : 'MEV does not recover heat from exhaust'}
      >
        <Slider
          value={isMVHR ? (systems.hre_override ?? 82) : 0}
          onChange={v => updateSystem('hre_override', v)}
          min={0} max={95} step={1}
          unit="%"
        />
      </Field>

      {/* Natural ventilation toggle */}
      <div className="pt-2 border-t border-light-grey">
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-3">Natural ventilation</p>
        <Toggle
          value={systems.natural_ventilation}
          onChange={v => updateSystem('natural_ventilation', v)}
          label="Openable windows"
          description="Guests can open windows. Interacts with VRF cooling — increases heat loss in winter, may reduce cooling demand in summer."
        />
      </div>

      {/* Threshold temperature (only shown when natural vent is on) */}
      {systems.natural_ventilation && (
        <Field
          label={`Window opening threshold — ${systems.natural_vent_threshold}°C indoor temp`}
          note="Windows open when indoor temperature exceeds this threshold (occupied hours only)"
        >
          <Slider
            value={systems.natural_vent_threshold}
            onChange={v => updateSystem('natural_vent_threshold', v)}
            min={18} max={28} step={1}
            unit="°C"
          />
        </Field>
      )}

      {systems.natural_ventilation && (
        <div className="bg-gold/10 border border-gold/30 rounded p-3">
          <p className="text-xxs text-navy font-medium">Key interaction</p>
          <p className="text-xxs text-mid-grey mt-1">
            Natural ventilation and VRF cooling run simultaneously in EnergyPlus.
            When windows are open and the VRF is cooling, the system works harder.
            This Bridgewater-specific behaviour is why natural ventilation analysis is important.
          </p>
        </div>
      )}

    </div>
  )
}
