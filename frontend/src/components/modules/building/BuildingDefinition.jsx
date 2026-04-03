/**
 * BuildingDefinition.jsx — three-column live workspace
 *
 * Left (w-64):   All building inputs (geometry + fabric + airtightness)
 * Centre (flex-1): 3D building viewer
 * Right (w-80):  LiveResultsPanel — instant-calc results
 */

import { useState, useContext, useEffect, useMemo } from 'react'
import BuildingViewer3D from './BuildingViewer3D.jsx'
import LiveResultsPanel from './LiveResultsPanel.jsx'
import FabricSankey from './FabricSankey.jsx'
import ExpandedSankeyOverlay from './ExpandedSankeyOverlay.jsx'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { useWeather } from '../../../context/WeatherContext.jsx'
import { useHourlySolar } from '../../../hooks/useHourlySolar.js'
import { calculateInstant } from '../../../utils/instantCalc.js'

// ── Facade numbering helpers ──────────────────────────────────────────────────
// F1=north (0°), F2=east (90°), F3=south (180°), F4=west (270°)
function facadeLabel(facadeNumber, orientationDeg) {
  const baseAngles = { 1: 0, 2: 90, 3: 180, 4: 270 }
  const trueAngle = (baseAngles[facadeNumber] + orientationDeg) % 360
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const compass = directions[Math.round(trueAngle / 45) % 8]
  return `F${facadeNumber} (${compass})`
}

// Ordered facade definitions for the WWR sliders
const FACADES = [
  { num: 1, key: 'north', defaultCount: 8 },
  { num: 2, key: 'east',  defaultCount: 3 },
  { num: 3, key: 'south', defaultCount: 8 },
  { num: 4, key: 'west',  defaultCount: 3 },
]

// ── Shared input components ───────────────────────────────────────────────────

function SectionHeader({ title }) {
  return (
    <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2 mt-3 first:mt-0">
      {title}
    </p>
  )
}

function Field({ label, children }) {
  return (
    <div className="space-y-1 mb-2">
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
      className="w-full px-2 py-1 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal bg-white transition-colors"
    />
  )
}

function CompassRose({ orientation }) {
  return (
    <div className="relative w-10 h-10 flex-shrink-0">
      <svg viewBox="-1 -1 2 2" className="w-full h-full">
        <circle cx="0" cy="0" r="0.9" fill="none" stroke="#E6E6E6" strokeWidth="0.06" />
        <g transform={`rotate(${orientation})`}>
          <polygon points="0,-0.7 0.1,-0.3 0,0 -0.1,-0.3" fill="#2B2A4C" />
          <polygon points="0,0.7 0.1,0.3 0,0 -0.1,0.3" fill="#95A5A6" />
        </g>
        <text x="0" y="-0.78" textAnchor="middle" fontSize="0.22" fill="#95A5A6" dominantBaseline="auto">N</text>
      </svg>
    </div>
  )
}

function WWRSlider({ label, value, onChange }) {
  const pct = Math.round(value * 100)
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <span className="text-xxs text-mid-grey w-3">{label}</span>
      <input
        type="range" min={0} max={100} step={1}
        value={pct}
        onChange={e => onChange(Number(e.target.value) / 100)}
        className="flex-1 h-[3px] accent-navy"
      />
      <span className="text-xxs text-navy w-7 text-right">{pct}%</span>
    </div>
  )
}

// ── U-value badge ─────────────────────────────────────────────────────────────

function UValueBadge({ u }) {
  if (u == null) return null
  const color = u <= 0.18 ? '#16A34A' : u <= 0.28 ? '#ECB01F' : '#DC2626'
  return (
    <span className="text-xxs font-semibold px-1 py-0.5 rounded" style={{ backgroundColor: color + '20', color }}>
      U {Number(u).toFixed(2)}
    </span>
  )
}

// ── Construction dropdown ─────────────────────────────────────────────────────

function ConstructionSelect({ elementKey, label, library, types, selectedId, onSelect }) {
  const filtered = library.filter(c => types.some(t => (c.type ?? '').toLowerCase() === t))
  const items = filtered.length > 0 ? filtered : library
  const selected = items.find(c => c.name === selectedId)

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-0.5">
        <label className="text-xxs text-mid-grey">{label}</label>
        {selected && <UValueBadge u={selected.u_value_W_per_m2K} />}
      </div>
      <select
        value={selectedId ?? ''}
        onChange={e => onSelect(elementKey, e.target.value || null)}
        className="w-full px-2 py-1 text-caption text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-teal appearance-none cursor-pointer"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2395A5A6' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 6px center',
          paddingRight: '24px',
        }}
      >
        <option value="">— select —</option>
        {items.map(c => (
          <option key={c.name} value={c.name}>{c.description ?? c.name}</option>
        ))}
      </select>
    </div>
  )
}

// ── Airtightness guidance ─────────────────────────────────────────────────────

function achLabel(ach) {
  if (ach < 0.3)  return { text: 'Very airtight', color: 'text-green-600' }
  if (ach <= 0.6) return { text: 'Good',          color: 'text-green-600' }
  if (ach <= 1.0) return { text: 'Average',        color: 'text-amber-600' }
  return                  { text: 'Leaky',          color: 'text-red-600' }
}

// ── Left column — all inputs ──────────────────────────────────────────────────

const CONSTRUCTION_ELEMENTS = [
  { key: 'external_wall', label: 'External Wall', types: ['wall'] },
  { key: 'roof',          label: 'Roof',          types: ['roof'] },
  { key: 'ground_floor',  label: 'Ground Floor',  types: ['floor', 'ground_floor'] },
  { key: 'glazing',       label: 'Glazing',       types: ['glazing', 'window'] },
]

function InputsColumn({ library }) {
  const { params, updateParam, constructions, updateConstruction } = useContext(ProjectContext)
  const { length, width, num_floors, floor_height, orientation, wwr, name, infiltration_ach, window_count,
          num_bedrooms, occupancy_rate, people_per_room } = params
  const ach = infiltration_ach ?? 0.5
  const bedrooms    = num_bedrooms    ?? 138
  const occRate     = occupancy_rate  ?? 0.75
  const peoplePerRm = people_per_room ?? 1.5

  // Derived metrics
  const gia  = length * width * num_floors
  const vol  = gia * floor_height

  // Derived occupancy metrics
  const avgOccupants   = bedrooms * occRate * peoplePerRm
  const occDensity     = gia > 0 ? avgOccupants / gia : 0

  const { text: achText, color: achColor } = achLabel(ach)

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-white border-r border-light-grey">
      {/* Module header with warm earth accent */}
      <div
        className="px-3 pt-2.5 pb-2 border-b border-light-grey"
        style={{ borderTopWidth: '3px', borderTopColor: '#A1887F', borderTopStyle: 'solid' }}
      >
        <p className="text-caption font-medium" style={{ color: '#A1887F' }}>Building</p>
        <p className="text-xxs text-mid-grey">Geometry, fabric &amp; airtightness</p>
      </div>

      <div className="p-3">
        {/* ── Geometry ── */}
        <SectionHeader title="Geometry" />

        <Field label="Building name">
          <input
            type="text"
            value={name}
            onChange={e => updateParam('name', e.target.value)}
            className="w-full px-2 py-1 text-caption text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-teal transition-colors"
          />
        </Field>

        <div className="grid grid-cols-2 gap-1.5 mb-2">
          <Field label="Length (m)">
            <NumberInput value={length} min={1} max={500} onChange={v => updateParam('length', v)} />
          </Field>
          <Field label="Width (m)">
            <NumberInput value={width} min={1} max={500} onChange={v => updateParam('width', v)} />
          </Field>
          <Field label="Floors">
            <NumberInput value={num_floors} min={1} max={20} onChange={v => updateParam('num_floors', v)} />
          </Field>
          <Field label="Floor height (m)">
            <NumberInput value={floor_height} min={2.0} max={6.0} step={0.1} onChange={v => updateParam('floor_height', v)} />
          </Field>
        </div>

        <Field label={`Orientation — ${orientation}°`}>
          <div className="flex items-center gap-2">
            <input
              type="range" min={0} max={359} step={1}
              value={orientation}
              onChange={e => updateParam('orientation', Number(e.target.value))}
              className="flex-1 h-[3px] accent-navy"
            />
            <CompassRose orientation={orientation} />
          </div>
        </Field>

        {/* Derived metrics */}
        <div className="grid grid-cols-2 gap-1 mb-3 mt-1 bg-off-white rounded p-2">
          <div>
            <p className="text-xxs text-mid-grey">GIA</p>
            <p className="text-caption font-medium text-navy">{Math.round(gia).toLocaleString()} m²</p>
          </div>
          <div>
            <p className="text-xxs text-mid-grey">Volume</p>
            <p className="text-caption font-medium text-navy">{Math.round(vol).toLocaleString()} m³</p>
          </div>
        </div>

        {/* ── Glazing ── */}
        <div className="border-t border-light-grey pt-3">
          <SectionHeader title="Glazing (WWR)" />
          {FACADES.map(fac => (
            <div key={fac.key} className="flex items-center gap-1 mb-1">
              <span className="text-xxs text-mid-grey w-14 flex-shrink-0">{facadeLabel(fac.num, orientation)}</span>
              <input
                type="range" min={0} max={100} step={1}
                value={Math.round((wwr[fac.key] ?? 0.25) * 100)}
                onChange={e => updateParam('wwr', { [fac.key]: Number(e.target.value) / 100 })}
                className="flex-1 h-[3px] accent-navy"
              />
              <span className="text-xxs text-navy w-7 text-right">{Math.round((wwr[fac.key] ?? 0.25) * 100)}%</span>
              <input
                type="number" min={1} max={30} step={1}
                value={window_count?.[fac.key] ?? fac.defaultCount}
                onChange={e => updateParam('window_count', { [fac.key]: Math.max(1, Number(e.target.value)) })}
                className="w-8 px-1 py-0.5 text-xxs text-navy border border-light-grey rounded text-center focus:outline-none focus:border-teal"
                title={`${facadeLabel(fac.num, orientation)} window count`}
              />
              <span className="text-xxs text-mid-grey w-5">win</span>
            </div>
          ))}
        </div>

        {/* ── Occupancy ── */}
        <div className="border-t border-light-grey pt-3">
          <SectionHeader title="Occupancy" />

          <div className="grid grid-cols-2 gap-1.5 mb-2">
            <Field label="Bedrooms">
              <NumberInput
                value={bedrooms} min={1} max={1000} step={1}
                onChange={v => updateParam('num_bedrooms', v)}
              />
            </Field>
            <Field label="People / room">
              <NumberInput
                value={peoplePerRm} min={1} max={4} step={0.5}
                onChange={v => updateParam('people_per_room', v)}
              />
            </Field>
          </div>

          <Field label={`Occupancy rate — ${Math.round(occRate * 100)}%`}>
            <input
              type="range" min={10} max={100} step={1}
              value={Math.round(occRate * 100)}
              onChange={e => updateParam('occupancy_rate', Number(e.target.value) / 100)}
              className="w-full h-[3px] accent-navy"
            />
          </Field>

          {/* Derived metrics */}
          <div className="grid grid-cols-2 gap-1 mb-1 mt-1 bg-off-white rounded p-2">
            <div>
              <p className="text-xxs text-mid-grey">Avg occupants</p>
              <p className="text-caption font-medium text-navy">{Math.round(avgOccupants)} people</p>
            </div>
            <div>
              <p className="text-xxs text-mid-grey">Occ. density</p>
              <p className="text-caption font-medium text-navy">{occDensity.toFixed(3)} p/m²</p>
            </div>
          </div>
        </div>

        {/* ── Fabric ── */}
        <div className="border-t border-light-grey pt-3">
          <SectionHeader title="Fabric" />
          {CONSTRUCTION_ELEMENTS.map(el => (
            <ConstructionSelect
              key={el.key}
              elementKey={el.key}
              label={el.label}
              library={library}
              types={el.types}
              selectedId={constructions?.[el.key] ?? null}
              onSelect={updateConstruction}
            />
          ))}
        </div>

        {/* ── Airtightness ── */}
        <div className="border-t border-light-grey pt-3">
          <SectionHeader title="Airtightness" />
          <div className="flex items-center gap-2 mb-1">
            <input
              type="range" min={0.1} max={2.0} step={0.05}
              value={ach}
              onChange={e => updateParam('infiltration_ach', parseFloat(e.target.value))}
              className="flex-1 h-[3px] accent-navy"
            />
            <span className="text-caption font-semibold text-navy w-14 text-right">
              {ach.toFixed(2)} ACH
            </span>
          </div>
          <p className={`text-xxs ${achColor}`}>{achText}</p>
        </div>
      </div>
    </div>
  )
}

// ── Main three-column layout ──────────────────────────────────────────────────

export default function BuildingDefinition() {
  const { params, constructions, systems } = useContext(ProjectContext)
  const [library, setLibrary] = useState([])
  const [libraryData, setLibraryData] = useState({})
  const [showSankey, setShowSankey] = useState(false)
  const [sankeyResult, setSankeyResult] = useState(null)
  const [centreView, setCentreView] = useState('3d')   // '3d' | 'energy'

  // Weather + solar for FabricSankey (shared computation with LiveResultsPanel)
  const { weatherData } = useWeather()
  const orientationDeg = Number(params?.orientation ?? 0)
  const hourlySolar = useHourlySolar(weatherData, orientationDeg)
  const instantResult = useMemo(
    () => calculateInstant(params, constructions, systems, libraryData, weatherData, hourlySolar),
    [params, constructions, systems, libraryData, weatherData, hourlySolar]
  )

  useEffect(() => {
    fetch('/api/library/constructions')
      .then(r => r.ok ? r.json() : { constructions: [] })
      .then(d => {
        const items = d.constructions ?? []
        setLibrary(items)
        setLibraryData({ constructions: items })
      })
      .catch(() => {})
  }, [])

  return (
    <div className="flex h-[calc(100vh-3rem)] relative">
      {/* Left: inputs */}
      <div className="w-64 flex-shrink-0 z-10">
        <InputsColumn library={library} />
      </div>

      {/* Centre: 3D viewer or Energy Flow Sankey */}
      <div className="flex-1 relative bg-off-white flex flex-col">
        {/* View toggle */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex bg-white border border-light-grey rounded shadow-sm text-xxs">
          <button
            onClick={() => setCentreView('3d')}
            className={`px-3 py-1 rounded-l transition-colors ${centreView === '3d' ? 'bg-navy text-white' : 'text-mid-grey hover:text-navy'}`}
          >
            3D Model
          </button>
          <button
            onClick={() => setCentreView('energy')}
            className={`px-3 py-1 rounded-r transition-colors ${centreView === 'energy' ? 'bg-navy text-white' : 'text-mid-grey hover:text-navy'}`}
          >
            Energy Flow
          </button>
        </div>

        {centreView === '3d' ? (
          <BuildingViewer3D params={params} />
        ) : (
          <div className="flex-1 w-full h-full pt-8">
            <FabricSankey result={instantResult} />
          </div>
        )}
      </div>

      {/* Right: live results */}
      <div className="w-80 flex-shrink-0">
        <LiveResultsPanel
          libraryData={libraryData}
          onSankeyExpand={(result) => { setSankeyResult(result); setShowSankey(true) }}
        />
      </div>

      {/* Expanded Sankey overlay — covers centre + right columns */}
      {showSankey && sankeyResult && (
        <div className="absolute top-0 bottom-0 right-0 z-20" style={{ left: '16rem' }}>
          <ExpandedSankeyOverlay
            result={sankeyResult}
            orientation={params.orientation ?? 0}
            onClose={() => setShowSankey(false)}
          />
        </div>
      )}
    </div>
  )
}
