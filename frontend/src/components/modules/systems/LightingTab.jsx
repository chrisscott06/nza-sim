import { useContext } from 'react'
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

function Slider({ value, onChange, min, max, step = 1, unit }) {
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
      <span className="text-caption text-navy font-medium w-14 text-right">
        {value}{unit}
      </span>
    </div>
  )
}

const CONTROL_OPTIONS = [
  { value: 'manual',              label: 'Manual switching' },
  { value: 'occupancy_sensing',   label: 'Occupancy sensing' },
  { value: 'daylight_dimming',    label: 'Daylight dimming' },
  { value: 'occupancy_daylight',  label: 'Occupancy + Daylight' },
]

// Approximate reduction factors vs manual baseline
const CONTROL_FACTOR = {
  manual:             1.00,
  occupancy_sensing:  0.80,
  daylight_dimming:   0.70,
  occupancy_daylight: 0.55,
}

// Hotel operating hours assumption (occupied + common areas)
const ANNUAL_HOURS = 3650  // ~10 h/day average across zones

export default function LightingTab() {
  const { systems, updateSystem, params } = useContext(ProjectContext)

  const gia          = params.length * params.width * params.num_floors
  const lpd          = systems.lighting_power_density ?? 8.0
  const control      = systems.lighting_control ?? 'occupancy_sensing'
  const factor       = CONTROL_FACTOR[control] ?? 1.0
  const annualKwh    = (lpd * gia * ANNUAL_HOURS * factor) / 1000
  const savedKwh     = (lpd * gia * ANNUAL_HOURS * (1 - factor)) / 1000
  const selectedCtrl = CONTROL_OPTIONS.find(o => o.value === control)

  return (
    <div className="p-3 space-y-4">

      <Field
        label={`Lighting power density — ${lpd} W/m²`}
        note="CIBSE SLL CoP 2022: hotel bedrooms 5 W/m², corridors 8 W/m², reception 12 W/m²"
      >
        {/* Preset buttons */}
        <div className="flex gap-1.5 mb-2 flex-wrap">
          {[
            { label: 'LED Modern',   value: 4  },
            { label: 'LED Standard', value: 7  },
            { label: 'Fluorescent',  value: 11 },
            { label: 'Incandescent', value: 18 },
          ].map(p => (
            <button
              key={p.label}
              onClick={() => updateSystem('lighting_power_density', p.value)}
              className={`px-2 py-1 text-xxs rounded border transition-colors ${
                lpd === p.value
                  ? 'bg-navy text-white border-navy'
                  : 'text-mid-grey border-light-grey hover:border-navy hover:text-navy'
              }`}
            >
              {p.label} ({p.value})
            </button>
          ))}
        </div>
        <Slider
          value={lpd}
          onChange={v => updateSystem('lighting_power_density', v)}
          min={0} max={20} step={0.5}
          unit=" W/m²"
        />
      </Field>

      <Field label="Lighting control strategy">
        <Select
          value={control}
          onChange={v => updateSystem('lighting_control', v)}
          options={CONTROL_OPTIONS}
        />
      </Field>

      {/* Estimated demand panel */}
      <div className="bg-off-white rounded-lg border border-light-grey p-3">
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Estimated lighting demand</p>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div>
            <p className="text-metric text-navy font-medium">{Math.round(annualKwh).toLocaleString()}</p>
            <p className="text-xxs text-mid-grey uppercase tracking-wider">kWh/yr</p>
          </div>
          <div>
            <p className="text-metric text-navy font-medium">{Math.round(annualKwh / gia)}</p>
            <p className="text-xxs text-mid-grey uppercase tracking-wider">kWh/m²/yr</p>
          </div>
        </div>

        {/* Control savings bar */}
        <div className="mt-3">
          <div className="flex justify-between text-xxs text-mid-grey mb-1">
            <span>Control savings vs manual</span>
            <span className="text-teal font-medium">{Math.round((1 - factor) * 100)}%</span>
          </div>
          <div className="w-full h-1.5 bg-light-grey rounded-full overflow-hidden">
            <div
              className="h-full bg-teal rounded-full transition-all duration-300"
              style={{ width: `${(1 - factor) * 100}%` }}
            />
          </div>
          {savedKwh > 0 && (
            <p className="text-xxs text-teal mt-1">
              {selectedCtrl?.label} saves ~{Math.round(savedKwh).toLocaleString()} kWh/yr
            </p>
          )}
        </div>

        <p className="text-xxs text-mid-grey mt-2">
          Based on {lpd} W/m² × {gia.toLocaleString()} m² GIA × ~{ANNUAL_HOURS.toLocaleString()} operating hours/yr.
          Control factor applied: {Math.round(factor * 100)}%. Indicative only — EnergyPlus schedules govern actual result.
        </p>
      </div>

    </div>
  )
}
