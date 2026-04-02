import { useContext } from 'react'
import { BuildingContext } from '../../../context/BuildingContext.jsx'
import DataCard from '../../ui/DataCard.jsx'

/* ── Small compact input + label ───────────────────────────────────────────── */
function Field({ label, children }) {
  return (
    <div className="space-y-1">
      <label className="text-xxs uppercase tracking-wider text-mid-grey">{label}</label>
      {children}
    </div>
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
      className="
        w-full px-2 py-1.5 text-caption text-navy
        border border-light-grey rounded
        focus:outline-none focus:border-teal
        bg-white transition-colors
      "
    />
  )
}

/* ── Compass rose ──────────────────────────────────────────────────────────── */
function CompassRose({ orientation }) {
  const rad = (orientation * Math.PI) / 180
  const nx = Math.sin(rad)
  const ny = -Math.cos(rad)
  return (
    <div className="flex items-center justify-center">
      <div className="relative w-12 h-12">
        <svg viewBox="-1 -1 2 2" className="w-full h-full">
          <circle cx="0" cy="0" r="0.9" fill="none" stroke="#E6E6E6" strokeWidth="0.06" />
          {/* N marker — rotates with building */}
          <g transform={`rotate(${orientation})`}>
            <polygon points="0,-0.7 0.1,-0.3 0,0 -0.1,-0.3" fill="#2B2A4C" />
            <polygon points="0,0.7 0.1,0.3 0,0 -0.1,0.3" fill="#95A5A6" />
          </g>
          <text x="0" y="-0.78" textAnchor="middle" fontSize="0.22" fill="#95A5A6" dominantBaseline="auto">N</text>
        </svg>
      </div>
    </div>
  )
}

/* ── WWR slider ────────────────────────────────────────────────────────────── */
function WWRSlider({ label, value, onChange }) {
  const pct = Math.round(value * 100)
  return (
    <div className="flex items-center gap-2">
      <span className="text-xxs text-mid-grey w-3">{label}</span>
      <input
        type="range"
        min={0} max={100} step={1}
        value={pct}
        onChange={e => onChange(Number(e.target.value) / 100)}
        className="flex-1 h-[3px]"
        style={{ accentColor: '#2B2A4C' }}
      />
      <span className="text-xxs text-navy w-7 text-right">{pct}%</span>
    </div>
  )
}

export default function GeometryTab() {
  const { params, updateParam } = useContext(BuildingContext)
  const { length, width, num_floors, floor_height, orientation, wwr, name } = params

  // Derived metrics
  const gia   = length * width * num_floors
  const wall  = 2 * (length + width) * floor_height * num_floors
  const glaz  = wall * ((wwr.north + wwr.south + wwr.east + wwr.west) / 4)
  const vol   = gia * floor_height

  return (
    <div className="p-3 space-y-4">
      {/* Building name */}
      <Field label="Building name">
        <input
          type="text"
          value={name}
          onChange={e => updateParam('name', e.target.value)}
          className="
            w-full px-2 py-1.5 text-caption text-navy
            border border-light-grey rounded bg-white
            focus:outline-none focus:border-teal transition-colors
          "
        />
      </Field>

      {/* Dimensions */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Length (m)">
          <NumberInput value={length} min={1} max={500} step={1}
            onChange={v => updateParam('length', v)} />
        </Field>
        <Field label="Width (m)">
          <NumberInput value={width} min={1} max={500} step={1}
            onChange={v => updateParam('width', v)} />
        </Field>
        <Field label="Floors">
          <NumberInput value={num_floors} min={1} max={20} step={1}
            onChange={v => updateParam('num_floors', v)} />
        </Field>
        <Field label="Floor height (m)">
          <NumberInput value={floor_height} min={2.0} max={6.0} step={0.1}
            onChange={v => updateParam('floor_height', v)} />
        </Field>
      </div>

      {/* Orientation */}
      <Field label={`Orientation — ${orientation}°`}>
        <div className="flex items-center gap-3">
          <input
            type="range" min={0} max={359} step={1}
            value={orientation}
            onChange={e => updateParam('orientation', Number(e.target.value))}
            className="flex-1 h-[3px]"
            style={{ accentColor: '#2B2A4C' }}
          />
          <CompassRose orientation={orientation} />
        </div>
      </Field>

      {/* Window-to-wall ratio */}
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Window-to-wall ratio</p>
        <div className="space-y-2 bg-off-white rounded p-2">
          {['north', 'south', 'east', 'west'].map(dir => (
            <WWRSlider
              key={dir}
              label={dir[0].toUpperCase()}
              value={wwr[dir]}
              onChange={v => updateParam('wwr', { [dir]: v })}
            />
          ))}
        </div>
      </div>

      {/* Summary metrics */}
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Derived metrics</p>
        <div className="grid grid-cols-2 gap-2">
          <DataCard label="GIA" value={Math.round(gia).toLocaleString()} unit="m²" accent="navy" />
          <DataCard label="Volume" value={Math.round(vol).toLocaleString()} unit="m³" accent="teal" />
          <DataCard label="Envelope" value={Math.round(wall).toLocaleString()} unit="m²" accent="gold" />
          <DataCard label="Glazing" value={Math.round(glaz).toLocaleString()} unit="m²" accent="cooling-blue" />
        </div>
      </div>
    </div>
  )
}
