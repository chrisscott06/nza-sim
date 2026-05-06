/**
 * BuildingDefinition.jsx — three-column live workspace
 *
 * Left (w-72):   All building inputs (geometry + fabric + airtightness)
 * Centre (flex-1): 3D building viewer
 * Right (w-80):  LiveResultsPanel — instant-calc results
 */

import { useState, useContext, useEffect, useMemo, useRef, useCallback } from 'react'
import { NavLink } from 'react-router-dom'
import { PanelRightClose, PanelRightOpen, Pencil, Lock, Unlock } from 'lucide-react'
import BuildingViewer3D from './BuildingViewer3D.jsx'
import LiveResultsPanel from './LiveResultsPanel.jsx'
import ExpandedSankeyOverlay from './ExpandedSankeyOverlay.jsx'
import HeatBalance from '../balance/HeatBalance.jsx'
import ConstructionInspector from '../../library/ConstructionInspector.jsx'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { SimulationContext } from '../../../context/SimulationContext.jsx'
import { useWeather } from '../../../context/WeatherContext.jsx'
import { useHourlySolar } from '../../../hooks/useHourlySolar.js'
import { useSimulationBalance } from '../../../hooks/useSimulationBalance.js'
import { calculateInstant } from '../../../utils/instantCalc.js'

// ── Layout: resizable columns ────────────────────────────────────────────────
// Persisted column widths so users can size to their screen / focus area.
const LAYOUT_STORAGE_KEY = 'nza-building-layout'
const LEFT_DEFAULT  = 288   // px (was w-72)
const RIGHT_DEFAULT = 320   // px (was w-80)
const LEFT_MIN  = 220
const LEFT_MAX  = 520
const RIGHT_MIN = 240
const RIGHT_MAX = 600

function loadLayoutPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY))
    if (saved && typeof saved === 'object') {
      return {
        left:        clamp(Number(saved.left)  || LEFT_DEFAULT,  LEFT_MIN,  LEFT_MAX),
        right:       clamp(Number(saved.right) || RIGHT_DEFAULT, RIGHT_MIN, RIGHT_MAX),
        rightHidden: !!saved.rightHidden,
        centre:      ['3d', 'heat-balance'].includes(saved.centre) ? saved.centre : '3d',
      }
    }
  } catch {}
  return { left: LEFT_DEFAULT, right: RIGHT_DEFAULT, rightHidden: false, centre: '3d' }
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)) }

/**
 * ResizeHandle — vertical drag handle between columns. Calls onResize(dx)
 * for every pixel of horizontal movement while the user drags.
 */
function ResizeHandle({ onResize }) {
  const startX = useRef(null)
  const handleMouseDown = useCallback((e) => {
    e.preventDefault()
    startX.current = e.clientX
    const onMove = (ev) => {
      if (startX.current == null) return
      const dx = ev.clientX - startX.current
      startX.current = ev.clientX
      onResize(dx)
    }
    const onUp = () => {
      startX.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [onResize])

  return (
    <div
      className="w-1 flex-shrink-0 cursor-col-resize bg-light-grey/0 hover:bg-teal/40 active:bg-teal/60 transition-colors relative group"
      onMouseDown={handleMouseDown}
      title="Drag to resize"
    >
      <div className="absolute inset-y-0 -inset-x-1.5" />
    </div>
  )
}

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

const BUILDING_ACCENT = '#A1887F'  // warm earth — building module

function CollapsibleSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left transition-opacity"
        style={{ backgroundColor: BUILDING_ACCENT }}
      >
        <span className="text-white text-xxs font-semibold uppercase tracking-wider">{title}</span>
        <span className="text-white/70 text-xs leading-none">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="pt-2 pb-1">
          {children}
        </div>
      )}
    </div>
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

function ConstructionSelect({ elementKey, label, library, types, selectedId, onSelect, onInspect }) {
  const filtered = library.filter(c => types.some(t => (c.type ?? '').toLowerCase() === t))
  const items = filtered.length > 0 ? filtered : library
  const selected = items.find(c => c.name === selectedId)

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-0.5">
        <label className="text-xxs text-mid-grey">{label}</label>
        {selected && (
          <button
            type="button"
            onClick={() => onInspect?.(selected.name)}
            title="Click to inspect / edit construction layers"
            className="flex items-center gap-1 cursor-pointer focus:outline-none group"
          >
            <Pencil size={10} className="text-mid-grey group-hover:text-navy transition-colors" />
            <UValueBadge u={selected.u_value_W_per_m2K} />
          </button>
        )}
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

function PreviewToggle({ label, checked, onChange }) {
  // Retained as a thin wrapper in case anything else imports it; no longer used
  // here. The per-facade Include checkboxes write straight to params.
  return (
    <label className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded bg-off-white text-xxs cursor-pointer hover:bg-light-grey/30 transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="accent-navy w-3 h-3"
      />
      <span className="text-dark-grey">{label}</span>
      {!checked && (
        <span className="ml-auto text-amber-600 italic">preview only</span>
      )}
    </label>
  )
}

function InputsColumn({ library, onInspectConstruction }) {
  const { params, updateParam, constructions, updateConstruction } = useContext(ProjectContext)
  const { length, width, num_floors, floor_height, orientation, wwr, name, infiltration_ach, window_count } = params
  const ach = infiltration_ach ?? 0.5
  const shadingOverhang = params.shading_overhang ?? {}
  const shadingFin      = params.shading_fin      ?? {}
  // Any non-zero shading on any facade?
  const anyShading = ['north','south','east','west'].some(f =>
    (shadingOverhang[f]?.depth_m ?? 0) > 0 ||
    (shadingFin[f]?.left_depth_m ?? 0) > 0 ||
    (shadingFin[f]?.right_depth_m ?? 0) > 0
  )

  // ── Orientation lock ──────────────────────────────────────────────────────
  // Local-only lock to prevent accidental drift of the orientation slider
  // once a project is dialled in. Doesn't persist — re-tick on each session.
  const [orientationLocked, setOrientationLocked] = useState(false)

  // ── Per-facade Include memory ─────────────────────────────────────────────
  // Remembers the last non-zero WWR / shading depth per facade so unchecking
  // and re-checking the Include box restores the slider to where it was.
  const [wwrMemory, setWwrMemory] = useState(() => ({
    north: (wwr?.north ?? 0) > 0 ? wwr.north : 0.25,
    south: (wwr?.south ?? 0) > 0 ? wwr.south : 0.25,
    east:  (wwr?.east  ?? 0) > 0 ? wwr.east  : 0.25,
    west:  (wwr?.west  ?? 0) > 0 ? wwr.west  : 0.25,
  }))
  const [shadingMemory, setShadingMemory] = useState(() => {
    const init = (f) => Math.max(
      Number(shadingOverhang[f]?.depth_m   ?? 0),
      Number(shadingFin[f]?.left_depth_m   ?? 0),
      Number(shadingFin[f]?.right_depth_m  ?? 0),
    )
    return {
      north: init('north') > 0 ? init('north') : 0.5,
      south: init('south') > 0 ? init('south') : 0.5,
      east:  init('east')  > 0 ? init('east')  : 0.5,
      west:  init('west')  > 0 ? init('west')  : 0.5,
    }
  })

  const setWwrFor = (face, v) => {
    if (v > 0) setWwrMemory(m => ({ ...m, [face]: v }))
    updateParam('wwr', { [face]: v })
  }
  const toggleWindowInclude = (face, include) => {
    const current = wwr?.[face] ?? 0
    if (include) {
      const restore = wwrMemory[face] > 0 ? wwrMemory[face] : 0.25
      updateParam('wwr', { [face]: restore })
    } else {
      if (current > 0) setWwrMemory(m => ({ ...m, [face]: current }))
      updateParam('wwr', { [face]: 0 })
    }
  }

  const setShadingFor = (face, v) => {
    if (v > 0) setShadingMemory(m => ({ ...m, [face]: v }))
    updateParam('shading_overhang', { [face]: { depth_m: v, offset_m: 0 } })
    updateParam('shading_fin',      { [face]: { left_depth_m: v, right_depth_m: v } })
  }
  const toggleShadingInclude = (face, include) => {
    const current = Math.max(
      Number(shadingOverhang[face]?.depth_m   ?? 0),
      Number(shadingFin[face]?.left_depth_m   ?? 0),
      Number(shadingFin[face]?.right_depth_m  ?? 0),
    )
    if (include) {
      const restore = shadingMemory[face] > 0 ? shadingMemory[face] : 0.5
      setShadingFor(face, restore)
    } else {
      if (current > 0) setShadingMemory(m => ({ ...m, [face]: current }))
      setShadingFor(face, 0)
    }
  }

  // ── Openings — per-facade Include memory ──────────────────────────────────
  const openings = params.openings ?? {}
  const [louvreMemory, setLouvreMemory] = useState(() => ({
    north: (openings?.north?.louvre_area_m2 ?? 0) > 0 ? openings.north.louvre_area_m2 : 0.5,
    south: (openings?.south?.louvre_area_m2 ?? 0) > 0 ? openings.south.louvre_area_m2 : 0.5,
    east:  (openings?.east?.louvre_area_m2  ?? 0) > 0 ? openings.east.louvre_area_m2  : 0.5,
    west:  (openings?.west?.louvre_area_m2  ?? 0) > 0 ? openings.west.louvre_area_m2  : 0.5,
  }))
  const [openableMemory, setOpenableMemory] = useState(() => ({
    north: (openings?.north?.openable_fraction ?? 0) > 0 ? openings.north.openable_fraction : 0.30,
    south: (openings?.south?.openable_fraction ?? 0) > 0 ? openings.south.openable_fraction : 0.30,
    east:  (openings?.east?.openable_fraction  ?? 0) > 0 ? openings.east.openable_fraction  : 0.30,
    west:  (openings?.west?.openable_fraction  ?? 0) > 0 ? openings.west.openable_fraction  : 0.30,
  }))

  const setLouvreFor = (face, v) => {
    if (v > 0) setLouvreMemory(m => ({ ...m, [face]: v }))
    updateParam('openings', { [face]: { louvre_area_m2: v } })
  }
  const toggleLouvreInclude = (face, include) => {
    const current = Number(openings?.[face]?.louvre_area_m2 ?? 0)
    if (include) {
      setLouvreFor(face, louvreMemory[face] > 0 ? louvreMemory[face] : 0.5)
    } else {
      if (current > 0) setLouvreMemory(m => ({ ...m, [face]: current }))
      setLouvreFor(face, 0)
    }
  }

  const setOpenableFor = (face, v) => {
    if (v > 0) setOpenableMemory(m => ({ ...m, [face]: v }))
    updateParam('openings', { [face]: { openable_fraction: v } })
  }
  const toggleOpenableInclude = (face, include) => {
    const current = Number(openings?.[face]?.openable_fraction ?? 0)
    if (include) {
      setOpenableFor(face, openableMemory[face] > 0 ? openableMemory[face] : 0.30)
      // If schedule is still 'Never', windows would be configured but never
      // actually open (Q_window stays 0, no heat loss). Auto-bump to a sensible
      // default so the engine sees flow as soon as the user enables an opening.
      if ((openings.schedule ?? 'never') === 'never') {
        updateParam('openings', { schedule: 'occupied' })
      }
    } else {
      if (current > 0) setOpenableMemory(m => ({ ...m, [face]: current }))
      setOpenableFor(face, 0)
    }
  }

  const anyOpenings = ['north','south','east','west'].some(f =>
    (openings?.[f]?.louvre_area_m2 ?? 0) > 0 ||
    (openings?.[f]?.openable_fraction ?? 0) > 0
  )

  // Derived metrics
  const gia  = length * width * num_floors
  const vol  = gia * floor_height

  const { text: achText, color: achColor } = achLabel(ach)

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-white border-r border-light-grey">
      {/* Module header with warm earth accent */}
      <div
        className="px-3 pt-2 pb-2 border-b border-light-grey"
        style={{ borderTopWidth: '3px', borderTopColor: '#A1887F', borderTopStyle: 'solid' }}
      >
        <NavLink to="/project" className="text-xxs text-mid-grey hover:text-navy transition-colors">
          ← Overview
        </NavLink>
        <p className="text-caption font-medium mt-0.5" style={{ color: '#A1887F' }}>Building</p>
        <p className="text-xxs text-mid-grey">Geometry, fabric &amp; airtightness</p>
      </div>

      <div className="p-3 space-y-0">

        {/* ── Geometry ── */}
        <CollapsibleSection title="Geometry">
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

          <Field label={`Orientation — ${orientation}°${orientationLocked ? ' (locked)' : ''}`}>
            <div className="flex items-center gap-2">
              <input
                type="range" min={0} max={359} step={1}
                value={orientation}
                onChange={e => updateParam('orientation', Number(e.target.value))}
                disabled={orientationLocked}
                className="flex-1 h-[3px] accent-navy disabled:opacity-30"
              />
              <button
                type="button"
                onClick={() => setOrientationLocked(l => !l)}
                title={orientationLocked ? 'Unlock orientation' : 'Lock orientation'}
                className="p-1 rounded hover:bg-off-white text-mid-grey hover:text-navy transition-colors"
              >
                {orientationLocked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
              <CompassRose orientation={orientation} />
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-1 mt-1 bg-off-white rounded p-2">
            <div>
              <p className="text-xxs text-mid-grey">GIA</p>
              <p className="text-caption font-medium text-navy">{Math.round(gia).toLocaleString()} m²</p>
            </div>
            <div>
              <p className="text-xxs text-mid-grey">Volume</p>
              <p className="text-caption font-medium text-navy">{Math.round(vol).toLocaleString()} m³</p>
            </div>
          </div>
        </CollapsibleSection>

        {/* ── Glazing ── */}
        <CollapsibleSection title="Glazing (WWR)">
          {FACADES.map(fac => {
            const included = (wwr[fac.key] ?? 0) > 0
            return (
              <div key={fac.key} className="flex items-center gap-1 mb-1">
                <input
                  type="checkbox"
                  checked={included}
                  onChange={e => toggleWindowInclude(fac.key, e.target.checked)}
                  className="accent-navy w-3 h-3 flex-shrink-0"
                  title={`Include windows on ${facadeLabel(fac.num, orientation)}`}
                />
                <span className={`text-xxs w-14 flex-shrink-0 ${included ? 'text-navy' : 'text-light-grey'}`}>
                  {facadeLabel(fac.num, orientation)}
                </span>
                <input
                  type="range" min={0} max={100} step={1}
                  value={Math.round((wwr[fac.key] ?? 0) * 100)}
                  onChange={e => setWwrFor(fac.key, Number(e.target.value) / 100)}
                  disabled={!included}
                  className="flex-1 h-[3px] accent-navy disabled:opacity-30"
                />
                <span className={`text-xxs w-7 text-right ${included ? 'text-navy' : 'text-light-grey'}`}>
                  {Math.round((wwr[fac.key] ?? 0) * 100)}%
                </span>
                <input
                  type="number" min={1} max={30} step={1}
                  value={window_count?.[fac.key] ?? fac.defaultCount}
                  onChange={e => updateParam('window_count', { [fac.key]: Math.max(1, Number(e.target.value)) })}
                  disabled={!included}
                  className="w-8 px-1 py-0.5 text-xxs text-navy border border-light-grey rounded text-center focus:outline-none focus:border-teal disabled:opacity-30 disabled:bg-off-white"
                  title={`${facadeLabel(fac.num, orientation)} window count`}
                />
                <span className={`text-xxs w-5 ${included ? 'text-mid-grey' : 'text-light-grey'}`}>win</span>
              </div>
            )
          })}
        </CollapsibleSection>

        {/* ── Shading — one Reveal depth per facade applied as a 4-edge frame
              wrapping every window. Drives overhang.depth_m + fin.left/right
              together so the per-window 3D frame matches the EnergyPlus
              shading objects emitted per fenestration. ── */}
        <CollapsibleSection title={`Shading${anyShading ? ' · active' : ''}`} defaultOpen={anyShading}>
          {FACADES.map(fac => {
            const reveal = Math.max(
              Number(shadingOverhang[fac.key]?.depth_m   ?? 0),
              Number(shadingFin[fac.key]?.left_depth_m   ?? 0),
              Number(shadingFin[fac.key]?.right_depth_m  ?? 0),
            )
            const included = reveal > 0
            return (
              <div key={fac.key} className="flex items-center gap-2 mb-1.5">
                <input
                  type="checkbox"
                  checked={included}
                  onChange={e => toggleShadingInclude(fac.key, e.target.checked)}
                  className="accent-navy w-3 h-3 flex-shrink-0"
                  title={`Include shading on ${facadeLabel(fac.num, orientation)}`}
                />
                <span className={`text-xxs w-14 flex-shrink-0 ${included ? 'text-navy' : 'text-light-grey'}`}>
                  {facadeLabel(fac.num, orientation)}
                </span>
                <input
                  type="range" min={0} max={1.5} step={0.05}
                  value={reveal}
                  onChange={e => setShadingFor(fac.key, Number(e.target.value))}
                  disabled={!included}
                  className="flex-1 h-[3px] accent-navy disabled:opacity-30"
                />
                <span className={`text-xxs w-12 text-right tabular-nums ${included ? 'text-navy' : 'text-light-grey'}`}>
                  {reveal.toFixed(2)} m
                </span>
              </div>
            )
          })}
        </CollapsibleSection>

        {/* ── Openings ── Wind-driven natural ventilation: louvres always-open,
              operable window fraction on a schedule. Single-zone, no stack term —
              flow ∝ Cd · A · √Cw · v_wind (CIBSE AM10 single-sided wind). */}
        <CollapsibleSection title={`Openings${anyOpenings ? ' · active' : ''}`} defaultOpen={anyOpenings}>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <label className="text-xxs text-mid-grey block mb-0.5">Site exposure</label>
              <select
                value={openings.site_exposure ?? 'normal'}
                onChange={e => updateParam('openings', { site_exposure: e.target.value })}
                className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-teal cursor-pointer"
              >
                <option value="sheltered">Sheltered</option>
                <option value="normal">Normal</option>
                <option value="exposed">Exposed</option>
              </select>
            </div>
            <div>
              <label className="text-xxs text-mid-grey block mb-0.5">Window-open schedule</label>
              <select
                value={openings.schedule ?? 'never'}
                onChange={e => updateParam('openings', { schedule: e.target.value })}
                className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-teal cursor-pointer"
              >
                <option value="never">Never</option>
                <option value="occupied">Occupied hours</option>
                <option value="summer_day">Summer day only</option>
                <option value="always">Always open</option>
              </select>
            </div>
          </div>

          <p className="text-xxs text-mid-grey mt-2 mb-1">Louvres (always open, m²)</p>
          {FACADES.map(fac => {
            const area = Number(openings?.[fac.key]?.louvre_area_m2 ?? 0)
            const included = area > 0
            return (
              <div key={`louvre-${fac.key}`} className="flex items-center gap-1 mb-1">
                <input
                  type="checkbox"
                  checked={included}
                  onChange={e => toggleLouvreInclude(fac.key, e.target.checked)}
                  className="accent-navy w-3 h-3 flex-shrink-0"
                  title={`Include louvre on ${facadeLabel(fac.num, orientation)}`}
                />
                <span className={`text-xxs w-14 flex-shrink-0 ${included ? 'text-navy' : 'text-light-grey'}`}>
                  {facadeLabel(fac.num, orientation)}
                </span>
                <input
                  type="range" min={0} max={5} step={0.1}
                  value={area}
                  onChange={e => setLouvreFor(fac.key, Number(e.target.value))}
                  disabled={!included}
                  className="flex-1 h-[3px] accent-navy disabled:opacity-30"
                />
                <input
                  type="number" min={0} max={20} step={0.05}
                  value={area.toFixed(2)}
                  onChange={e => setLouvreFor(fac.key, Math.max(0, Number(e.target.value)))}
                  disabled={!included}
                  className="w-14 px-1 py-0.5 text-xxs text-navy border border-light-grey rounded text-right tabular-nums focus:outline-none focus:border-teal disabled:opacity-30 disabled:bg-off-white"
                  title={`${facadeLabel(fac.num, orientation)} louvre area (m²)`}
                />
                <span className={`text-xxs w-4 ${included ? 'text-mid-grey' : 'text-light-grey'}`}>m²</span>
              </div>
            )
          })}

          <p className="text-xxs text-mid-grey mt-3 mb-1">Openable windows (% of glazing)</p>
          {FACADES.map(fac => {
            const frac = Number(openings?.[fac.key]?.openable_fraction ?? 0)
            const glazingOn = (wwr[fac.key] ?? 0) > 0
            // Openable windows need glass to open — gate the row on glazing.
            const included = frac > 0 && glazingOn
            const disabled = !glazingOn
            return (
              <div key={`openable-${fac.key}`} className="flex items-center gap-1 mb-1">
                <input
                  type="checkbox"
                  checked={included}
                  onChange={e => toggleOpenableInclude(fac.key, e.target.checked)}
                  disabled={disabled}
                  className="accent-navy w-3 h-3 flex-shrink-0 disabled:opacity-30"
                  title={disabled
                    ? `${facadeLabel(fac.num, orientation)} has no glazing — enable it in Glazing first`
                    : `Include openable windows on ${facadeLabel(fac.num, orientation)}`}
                />
                <span className={`text-xxs w-14 flex-shrink-0 ${included ? 'text-navy' : 'text-light-grey'}`}>
                  {facadeLabel(fac.num, orientation)}
                </span>
                <input
                  type="range" min={0} max={100} step={1}
                  value={Math.round(frac * 100)}
                  onChange={e => setOpenableFor(fac.key, Number(e.target.value) / 100)}
                  disabled={!included}
                  className="flex-1 h-[3px] accent-navy disabled:opacity-30"
                />
                <span className={`text-xxs w-9 text-right tabular-nums ${included ? 'text-navy' : 'text-light-grey'}`}>
                  {disabled ? '—' : `${Math.round(frac * 100)}%`}
                </span>
              </div>
            )
          })}
        </CollapsibleSection>

        {/* ── Fabric ── */}
        <CollapsibleSection title="Fabric">
          {CONSTRUCTION_ELEMENTS.map(el => (
            <ConstructionSelect
              key={el.key}
              elementKey={el.key}
              label={el.label}
              library={library}
              types={el.types}
              selectedId={constructions?.[el.key] ?? null}
              onSelect={updateConstruction}
              onInspect={onInspectConstruction}
            />
          ))}
        </CollapsibleSection>

        {/* ── Airtightness ── */}
        <CollapsibleSection title="Airtightness">
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
        </CollapsibleSection>

      </div>
    </div>
  )
}

// ── Main three-column layout ──────────────────────────────────────────────────

export default function BuildingDefinition() {
  const { params, constructions, systems, currentProjectId, saveStatus } = useContext(ProjectContext)
  const simCtx = useContext(SimulationContext)
  const [library, setLibrary] = useState([])
  const [libraryData, setLibraryData] = useState({})
  const [showSankey, setShowSankey] = useState(false)
  const [sankeyResult, setSankeyResult] = useState(null)

  // ── Construction Inspector — opens when user clicks a U-value badge ───────
  const [inspectConstruction, setInspectConstruction] = useState(null)

  // Weather + solar (shared computation with LiveResultsPanel)
  const { weatherData } = useWeather()
  const orientationDeg = Number(params?.orientation ?? 0)
  const hourlySolar = useHourlySolar(weatherData, orientationDeg)
  const instantResult = useMemo(
    () => calculateInstant(params, constructions, systems, libraryData, weatherData, hourlySolar),
    [params, constructions, systems, libraryData, weatherData, hourlySolar]
  )

  // Simulation balance — fetched per (projectId, runId). Lets the Live |
  // Simulation toggle in the centre panel actually flip between sources
  // instead of being permanently disabled on the Simulation pill.
  const { data: simBalance } = useSimulationBalance(currentProjectId, simCtx?.runId)
  const simulationInfo = simCtx?.runId ? {
    runId: simCtx.runId,
    ranAt: simCtx.results?.created_at ?? null,
    isStale: saveStatus === 'saving' || saveStatus === 'saved',
  } : null

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

  // ── Layout state (resizable columns, centre view, right hide) ─────────────
  const [layout, setLayout] = useState(loadLayoutPrefs)
  useEffect(() => {
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout)) } catch {}
  }, [layout])

  const setLeft       = (dx) => setLayout(l => ({ ...l, left:  clamp(l.left  + dx, LEFT_MIN,  LEFT_MAX) }))
  const setRight      = (dx) => setLayout(l => ({ ...l, right: clamp(l.right - dx, RIGHT_MIN, RIGHT_MAX) }))
  const toggleRight   = () => setLayout(l => ({ ...l, rightHidden: !l.rightHidden }))
  const setCentreView = (v) => setLayout(l => ({ ...l, centre: v }))

  return (
    <div className="flex h-[calc(100vh-3rem)] relative">
      {/* Left: inputs */}
      <div className="flex-shrink-0 z-10" style={{ width: layout.left }}>
        <InputsColumn
          library={library}
          onInspectConstruction={setInspectConstruction}
        />
      </div>

      <ResizeHandle onResize={setLeft} />

      {/* Centre: 3D viewer or live HeatBalance */}
      <div className="flex-1 relative bg-off-white flex flex-col min-w-0">
        {/* Centre view toggle */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex bg-white border border-light-grey rounded shadow-sm text-xxs">
          <button
            onClick={() => setCentreView('3d')}
            className={`px-3 py-1 rounded-l transition-colors ${layout.centre === '3d' ? 'bg-navy text-white' : 'text-mid-grey hover:text-navy'}`}
          >
            3D Model
          </button>
          <button
            onClick={() => setCentreView('heat-balance')}
            className={`px-3 py-1 rounded-r transition-colors ${layout.centre === 'heat-balance' ? 'bg-navy text-white' : 'text-mid-grey hover:text-navy'}`}
          >
            Heat Balance
          </button>
        </div>

        {/* Right-pane hide/show — sits on top so it's always reachable */}
        <button
          onClick={toggleRight}
          className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-1 rounded bg-white border border-light-grey shadow-sm text-xxs text-mid-grey hover:text-navy transition-colors"
          title={layout.rightHidden ? 'Show live results' : 'Hide live results'}
        >
          {layout.rightHidden
            ? <PanelRightOpen size={11} />
            : <PanelRightClose size={11} />}
          {layout.rightHidden ? 'Show results' : 'Hide results'}
        </button>

        {layout.centre === '3d' ? (
          <BuildingViewer3D params={params} />
        ) : (
          <div className="flex-1 w-full h-full pt-9">
            <HeatBalance
              liveData={instantResult?.heat_balance}
              simulationData={simBalance}
              simulationInfo={simulationInfo}
              orientationDeg={orientationDeg}
              onElementClick={() => {}}
            />
          </div>
        )}
      </div>

      {/* Right: live results (hidable) */}
      {!layout.rightHidden && (
        <>
          <ResizeHandle onResize={setRight} />
          <div className="flex-shrink-0" style={{ width: layout.right }}>
            <LiveResultsPanel libraryData={libraryData} />
          </div>
        </>
      )}

      {/* Expanded Sankey overlay — covers centre + right columns */}
      {showSankey && sankeyResult && (
        <div className="absolute top-0 bottom-0 right-0 z-20" style={{ left: layout.left + 4 }}>
          <ExpandedSankeyOverlay
            result={sankeyResult}
            orientation={params.orientation ?? 0}
            onClose={() => setShowSankey(false)}
          />
        </div>
      )}

      {/* Construction Inspector — opens when a U-value badge is clicked. */}
      <ConstructionInspector
        open={!!inspectConstruction}
        constructionName={inspectConstruction}
        initialMode="view"
        onClose={() => setInspectConstruction(null)}
        onSaved={() => {
          // Re-fetch library after save so any U-value updates reflect immediately.
          fetch('/api/library/constructions')
            .then(r => r.ok ? r.json() : { constructions: [] })
            .then(d => {
              const items = d.constructions ?? []
              setLibrary(items)
              setLibraryData({ constructions: items })
            })
            .catch(() => {})
        }}
      />
    </div>
  )
}
