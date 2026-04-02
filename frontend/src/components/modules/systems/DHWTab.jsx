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

function NumberInput({ value, onChange, min, max, step = 1 }) {
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

export default function DHWTab() {
  const { systems, updateSystem, params } = useContext(BuildingContext)
  const [library, setLibrary] = useState([])

  useEffect(() => {
    fetch('/api/library/systems?category=dhw')
      .then(r => r.json())
      .then(d => setLibrary(d.systems ?? []))
      .catch(() => {})
  }, [])

  const primaryOptions  = library.filter(s => ['gas_boiler_dhw', 'electric_immersion'].includes(s.type))
    .map(s => ({ value: s.name, label: s.display_name }))
  const preheatOptions  = [
    { value: 'none',     label: '— No preheat —' },
    ...library.filter(s => s.type === 'ashp_dhw').map(s => ({ value: s.name, label: s.display_name })),
  ]

  const hasPreheat = systems.dhw_preheat && systems.dhw_preheat !== 'none'

  // Estimated DHW demand
  const gia       = params.length * params.width * params.num_floors
  const bedrooms  = Math.round(gia / 26)  // approx 26 m²/bedroom for Bridgewater
  const lwDay     = 50                    // litres/bedroom/day (CIBSE TM50)
  const annualKwh = (bedrooms * lwDay * 365 * 4.18 * (60 - 10)) / (3600 * 0.85)  // ΔT=50K, 85% efficiency

  return (
    <div className="p-3 space-y-4">

      <Field
        label="Primary DHW system"
        note={library.find(s => s.name === systems.dhw_primary)?.description}
      >
        <Select
          value={systems.dhw_primary}
          onChange={v => updateSystem('dhw_primary', v)}
          options={primaryOptions.length > 0 ? primaryOptions : [{ value: systems.dhw_primary, label: 'Loading…' }]}
        />
      </Field>

      <Field
        label="Preheat system"
        note={hasPreheat ? 'ASHP preheats to preheat setpoint; primary system tops up to final setpoint' : 'No preheat — primary system heats from cold inlet temperature'}
      >
        <Select
          value={systems.dhw_preheat}
          onChange={v => updateSystem('dhw_preheat', v)}
          options={preheatOptions}
        />
      </Field>

      <Field label="Hot water setpoint (°C)" note="Minimum 60°C for Legionella prevention (HSE L8)">
        <NumberInput
          value={systems.dhw_setpoint}
          onChange={v => updateSystem('dhw_setpoint', v)}
          min={55} max={70} step={1}
        />
      </Field>

      {hasPreheat && (
        <Field label="Preheat setpoint (°C)" note="ASHP outlet temperature — typically 45°C for efficiency">
          <NumberInput
            value={systems.dhw_preheat_setpoint}
            onChange={v => updateSystem('dhw_preheat_setpoint', v)}
            min={40} max={55} step={1}
          />
        </Field>
      )}

      {/* Estimated demand */}
      <div className="bg-off-white rounded-lg border border-light-grey p-3">
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Estimated DHW demand</p>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div>
            <p className="text-metric text-navy font-medium">{bedrooms}</p>
            <p className="text-xxs text-mid-grey uppercase tracking-wider">Bedrooms (approx)</p>
          </div>
          <div>
            <p className="text-metric text-navy font-medium">{Math.round(annualKwh).toLocaleString()}</p>
            <p className="text-xxs text-mid-grey uppercase tracking-wider">Est. kWh/yr</p>
          </div>
        </div>
        <p className="text-xxs text-mid-grey mt-2">
          Based on {lwDay} l/bedroom/day (CIBSE TM50). DHW is not modelled by EnergyPlus IdealLoads — shown here for reference only.
        </p>
      </div>

    </div>
  )
}
