import { useContext, useEffect, useState } from 'react'
import { BuildingContext } from '../../../context/BuildingContext.jsx'

function Field({ label, children, note }) {
  return (
    <div className="space-y-1">
      <label className="text-xxs uppercase tracking-wider text-mid-grey">{label}</label>
      {children}
      {note && <p className="text-xxs text-mid-grey">{note}</p>}
    </div>
  )
}

function Select({ value, onChange, options, disabled }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-teal transition-colors appearance-none disabled:opacity-50"
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

function NumberInput({ value, onChange, min, max, step = 0.1 }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={e => onChange(Number(e.target.value))}
      className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal transition-colors"
    />
  )
}

function SystemSchematic({ system }) {
  if (!system) return null
  const isElec = system.fuel_type === 'electricity'
  return (
    <div className="bg-off-white rounded-lg border border-light-grey p-4">
      <p className="text-xxs uppercase tracking-wider text-mid-grey mb-3">System overview</p>
      <div className="flex items-center gap-2 text-xxs">
        <span className="px-2 py-1 rounded bg-gold/20 text-navy font-medium">
          {isElec ? '⚡ Electricity' : '🔥 Gas'}
        </span>
        <span className="text-mid-grey">→</span>
        <span className="px-2 py-1 rounded bg-navy/10 text-navy font-medium">
          {system.display_name}
        </span>
        <span className="text-mid-grey">→</span>
        <span className="px-2 py-1 rounded bg-teal/20 text-navy font-medium">
          Heated / Cooled air
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {system.heating_cop != null && (
          <div className="text-center bg-white rounded border border-light-grey p-2">
            <p className="text-metric text-heating-red font-medium">{system.heating_cop}</p>
            <p className="text-xxs text-mid-grey uppercase tracking-wider">Heating COP</p>
          </div>
        )}
        {system.cooling_eer != null && (
          <div className="text-center bg-white rounded border border-light-grey p-2">
            <p className="text-metric text-cooling-blue font-medium">{system.cooling_eer}</p>
            <p className="text-xxs text-mid-grey uppercase tracking-wider">Cooling EER</p>
          </div>
        )}
        {system.efficiency != null && (
          <div className="text-center bg-white rounded border border-light-grey p-2">
            <p className="text-metric text-navy font-medium">{Math.round(system.efficiency * 100)}%</p>
            <p className="text-xxs text-mid-grey uppercase tracking-wider">Efficiency</p>
          </div>
        )}
        {system.fan_power_w_per_m2 != null && (
          <div className="text-center bg-white rounded border border-light-grey p-2">
            <p className="text-metric text-navy font-medium">{system.fan_power_w_per_m2}</p>
            <p className="text-xxs text-mid-grey uppercase tracking-wider">Fan W/m²</p>
          </div>
        )}
      </div>
      <p className="text-xxs text-mid-grey mt-3 leading-relaxed">{system.description}</p>
    </div>
  )
}

export default function HVACTab() {
  const { systems, updateSystem } = useContext(BuildingContext)
  const [library, setLibrary] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/library/systems?category=hvac')
      .then(r => r.json())
      .then(d => { setLibrary(d.systems ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const selected = library.find(s => s.name === systems.hvac_type)

  const hvacOptions = library.map(s => ({ value: s.name, label: s.display_name }))

  return (
    <div className="p-3 space-y-4">
      {/* Simulation mode */}
      <div className="bg-teal/5 border border-teal/20 rounded-lg p-3">
        <p className="text-xxs uppercase tracking-wider text-teal mb-2">Simulation mode</p>
        <div className="flex gap-2">
          {[{ v: 'ideal', l: 'Ideal Loads' }, { v: 'detailed', l: 'Detailed Systems' }].map(opt => (
            <button
              key={opt.v}
              onClick={() => updateSystem('mode', opt.v)}
              className={`flex-1 py-1.5 text-caption rounded border transition-colors ${
                systems.mode === opt.v
                  ? 'bg-teal text-white border-teal'
                  : 'bg-white text-mid-grey border-light-grey hover:border-teal'
              }`}
            >
              {opt.l}
            </button>
          ))}
        </div>
        <p className="text-xxs text-mid-grey mt-2">
          {systems.mode === 'ideal'
            ? 'Ideal Loads shows pure building demand — 100% efficient HVAC. Use for fabric comparisons.'
            : 'Detailed Systems applies real system efficiencies. EUI will be higher than Ideal mode.'
          }
        </p>
      </div>

      {/* System picker */}
      <Field label="HVAC system type">
        <Select
          value={systems.hvac_type}
          onChange={v => updateSystem('hvac_type', v)}
          options={loading ? [{ value: systems.hvac_type, label: 'Loading…' }] : hvacOptions}
        />
      </Field>

      {/* COP override */}
      {selected?.heating_cop != null && (
        <Field label="Heating COP (override)" note="Leave as system default, or enter a measured/certified value">
          <NumberInput
            value={systems.hvac_cop_override ?? selected.heating_cop}
            onChange={v => updateSystem('hvac_cop_override', v)}
            min={1.0} max={8.0} step={0.1}
          />
        </Field>
      )}

      {/* System schematic */}
      {selected && <SystemSchematic system={selected} />}
    </div>
  )
}
