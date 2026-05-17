/**
 * BuildingDefinition.jsx — three-column live workspace
 *
 * Left (w-72):   All building inputs (geometry + fabric + airtightness)
 * Centre (flex-1): 3D building viewer
 * Right (w-80):  LiveResultsPanel — instant-calc results
 */

import { useState, useContext, useEffect, useMemo, useRef, useCallback } from 'react'
import { NavLink } from 'react-router-dom'
import { Pencil, Lock, Unlock } from 'lucide-react'
import BuildingViewer3D from './BuildingViewer3D.jsx'
// LiveResultsPanel removed — premature at the Building stage (no systems/gains
// defined yet). EUI / fuel split / monthly bars now live in /results after
// a simulation has actually been run. See docs/briefs/Brief_24_Building_Module.md.
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

// Brief 28-IM Bug 1: Brief 28L persists construction_choices entries as
// objects `{library_id, u_value_override, g_value_override}` while pre-28L
// projects use a bare string library_id. Resolve both shapes so the
// dropdown's value matches the actual selection rather than reading
// "— select —" when an override is in effect.
function _resolveChoice(choice) {
  if (typeof choice === 'string') return { library_id: choice, u_value_override: null, g_value_override: null }
  if (choice && typeof choice === 'object') {
    return {
      library_id:       choice.library_id ?? null,
      u_value_override: Number.isFinite(choice.u_value_override) ? choice.u_value_override : null,
      g_value_override: Number.isFinite(choice.g_value_override) ? choice.g_value_override : null,
    }
  }
  return { library_id: null, u_value_override: null, g_value_override: null }
}

function ConstructionSelect({ elementKey, label, library, types, selectedChoice, onSelect, onInspect }) {
  const { library_id, u_value_override } = _resolveChoice(selectedChoice)
  const filtered = library.filter(c => types.some(t => (c.type ?? '').toLowerCase() === t))
  const items = filtered.length > 0 ? filtered : library
  const selected = items.find(c => c.name === library_id)
  const effectiveU = u_value_override ?? selected?.u_value_W_per_m2K

  // Preserve override on selection change — only the library_id flips.
  const handleSelect = (newLibraryId) => {
    if (!newLibraryId) {
      onSelect(elementKey, null)
      return
    }
    const isObject = selectedChoice && typeof selectedChoice === 'object'
    if (isObject) {
      onSelect(elementKey, { ...selectedChoice, library_id: newLibraryId })
    } else {
      onSelect(elementKey, newLibraryId)
    }
  }

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-0.5">
        <label className="text-xxs text-mid-grey">{label}</label>
        {selected && effectiveU != null && (
          <button
            type="button"
            onClick={() => onInspect?.(selected.name)}
            title={u_value_override != null
              ? `Override U = ${u_value_override.toFixed(2)}; library = ${selected.u_value_W_per_m2K?.toFixed(2) ?? '?'}. Click to inspect layers.`
              : 'Click to inspect / edit construction layers'}
            className="flex items-center gap-1 cursor-pointer focus:outline-none group"
          >
            {u_value_override != null
              ? <span className="text-xxs text-mid-grey">✏️</span>
              : <Pencil size={10} className="text-mid-grey group-hover:text-navy transition-colors" />}
            <UValueBadge u={effectiveU} />
          </button>
        )}
      </div>
      <select
        value={library_id ?? ''}
        onChange={e => handleSelect(e.target.value || null)}
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

// ── Window-count input ────────────────────────────────────────────────────
// Caps per-facade window count at MAX_WINDOWS_PER_FACADE. The 3D viewer
// renders 5 meshes per window (glass + 4 frame strips) × num_floors —
// at 4 floors that's 20 meshes per window. The original input had a HTML
// `max` attribute but it isn't enforced for direct typing, so a stray
// "118" produced ~10k meshes and crashed the tab.
//
// Two failure modes fixed at once:
//   1. Free typing — uses local string state, so deleting the field mid-edit
//      doesn't snap to "1" while the user is typing the new number.
//   2. Out-of-range — clamped to [MIN, MAX] on commit (blur / Enter).
const MIN_WINDOWS_PER_FACADE = 1
const MAX_WINDOWS_PER_FACADE = 40   // ~1.5m wide windows on a 60m facade — well above realistic

function WindowCountInput({ value, defaultValue, onCommit, disabled, title }) {
  // Local string state lets the user clear and retype without flicker.
  // `value` from props is the canonical persisted number; we only sync down
  // when it changes externally (e.g. project load).
  const [draft, setDraft] = useState(String(value ?? defaultValue))
  useEffect(() => { setDraft(String(value ?? defaultValue)) }, [value, defaultValue])

  // Self-heal: if the persisted value is out of range (legacy data from
  // before the cap was added — e.g. someone accidentally typed 118 and
  // crashed the tab before MAX_WINDOWS_PER_FACADE was enforced), clamp it
  // on mount so the field doesn't surface a number that can't be saved.
  useEffect(() => {
    if (value != null && value > MAX_WINDOWS_PER_FACADE) {
      onCommit(MAX_WINDOWS_PER_FACADE)
    }
  // run once on mount per facade; subsequent edits go through commit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commit = () => {
    const parsed = parseInt(draft, 10)
    const clamped = Number.isFinite(parsed)
      ? Math.min(MAX_WINDOWS_PER_FACADE, Math.max(MIN_WINDOWS_PER_FACADE, parsed))
      : (value ?? defaultValue)
    setDraft(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }

  const atMax = parseInt(draft, 10) >= MAX_WINDOWS_PER_FACADE
  return (
    <input
      type="number"
      min={MIN_WINDOWS_PER_FACADE}
      max={MAX_WINDOWS_PER_FACADE}
      step={1}
      value={draft}
      disabled={disabled}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      className={`w-12 px-1 py-0.5 text-xxs text-navy border rounded text-center
        focus:outline-none focus:border-teal disabled:opacity-30 disabled:bg-off-white
        ${atMax ? 'border-amber-500 bg-amber-50' : 'border-light-grey'}`}
      title={atMax
        ? `${title} — at max (${MAX_WINDOWS_PER_FACADE}). Higher values would overload the 3D viewer.`
        : title}
    />
  )
}

// ── Louvre-area input (per-facade m²) ──────────────────────────────────────
// Same pattern as WindowCountInput: local string draft, commit on blur or
// Enter. Why: the louvre area field was previously committing on every
// keystroke via `setLouvreFor(face, Number(e.target.value))`. Typing "0.5"
// passed through 0 as the user typed the leading "0" — which, because the
// "include this facade" checkbox is derived from `area > 0`, instantly
// disabled the very input the user was typing into. Same root cause as the
// window count crash earlier in the file. Local draft means the area only
// commits once on blur, so the input stays enabled throughout the edit.
const MIN_LOUVRE_AREA = 0
const MAX_LOUVRE_AREA = 20  // m² per facade — way above realistic for a UK hotel

function LouvreAreaInput({ value, onCommit, disabled, title }) {
  const fmt = (v) => (Number.isFinite(v) ? Number(v).toFixed(2) : '')
  const [draft, setDraft] = useState(fmt(value ?? 0))
  // Sync from props when external changes happen (project load, slider drag,
  // checkbox toggle). Skip if the user is mid-edit (input has focus) so
  // their typing doesn't get clobbered.
  const inputRef = useRef(null)
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setDraft(fmt(value ?? 0))
    }
  }, [value])

  const commit = () => {
    const parsed = parseFloat(draft)
    if (!Number.isFinite(parsed)) {
      // Empty / unparseable → revert to last committed value
      setDraft(fmt(value ?? 0))
      return
    }
    const clamped = Math.min(MAX_LOUVRE_AREA, Math.max(MIN_LOUVRE_AREA, parsed))
    setDraft(fmt(clamped))
    if (clamped !== value) onCommit(clamped)
  }

  return (
    <input
      ref={inputRef}
      type="number"
      min={MIN_LOUVRE_AREA}
      max={MAX_LOUVRE_AREA}
      step={0.05}
      value={draft}
      disabled={disabled}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      className="w-14 px-1 py-0.5 text-xxs text-navy border border-light-grey rounded text-right tabular-nums focus:outline-none focus:border-teal disabled:opacity-30 disabled:bg-off-white"
      title={title}
    />
  )
}

// Brief 28-IM IM-M2 add 3: q50 unit toggle. Engine stores in canonical
// m³/(h·m²). UI display toggles between m³/(h·m²) and l/(s·m²) (factor of
// 1/3.6). Both are valid pressurisation-test conventions; some BRUKL
// reports list q50 in l/(s·m²) (often labelled q₅₀_l).
function Airtightness({ q50, derivedN50, derivedOperational, onChange }) {
  const [unit, setUnit] = useState('m3_h_m2')  // 'm3_h_m2' | 'l_s_m2'
  const q50_ls = q50 / 3.6
  return (
    <CollapsibleSection title="Airtightness">
      <div className="flex items-center justify-between mb-1">
        <label className="text-xxs text-mid-grey">
          Air permeability q₅₀
        </label>
        <div className="flex bg-off-white rounded text-xxs">
          <button
            onClick={() => setUnit('m3_h_m2')}
            className={`px-1.5 py-0.5 rounded-l transition-colors ${unit === 'm3_h_m2' ? 'bg-white text-navy font-medium shadow-sm' : 'text-mid-grey'}`}
            title="m³/(h·m²) @ 50 Pa"
          >m³/h·m²</button>
          <button
            onClick={() => setUnit('l_s_m2')}
            className={`px-1.5 py-0.5 rounded-r transition-colors ${unit === 'l_s_m2' ? 'bg-white text-navy font-medium shadow-sm' : 'text-mid-grey'}`}
            title="l/(s·m²) @ 50 Pa — equivalent (×1/3.6)"
          >l/s·m²</button>
        </div>
      </div>
      <div className="flex items-center gap-2 mb-1">
        <input
          type="range" min={1} max={25} step={0.1}
          value={q50}
          onChange={e => onChange(parseFloat(e.target.value))}
          className="flex-1 h-[3px] accent-navy"
        />
        <span className="text-caption font-semibold text-navy w-16 text-right tabular-nums">
          {unit === 'm3_h_m2' ? q50.toFixed(2) : q50_ls.toFixed(2)}
        </span>
      </div>
      <div className="flex items-center justify-end mb-1">
        <span className="text-xxs text-mid-grey/80 tabular-nums">
          {unit === 'm3_h_m2'
            ? `= ${q50_ls.toFixed(2)} l/s·m² @ 50 Pa`
            : `= ${q50.toFixed(2)} m³/h·m² @ 50 Pa`}
        </span>
      </div>
      {/* Zone labels under the slider — units agnostic */}
      <div className="flex justify-between text-xxs text-mid-grey/80 mb-2 px-1">
        <span title="Passive House / well-detailed">≤3 best</span>
        <span title="Compliance baseline">3–10 typical</span>
        <span title="Untested / poor detail">&gt;10 leaky</span>
      </div>
      {/* Derived values (engine output) */}
      <div className="space-y-0.5 mb-1">
        <div className="flex items-center justify-between text-xxs">
          <span className="text-mid-grey">→ n₅₀ (ACH @ 50 Pa)</span>
          <span className="text-navy tabular-nums">{derivedN50?.toFixed(2) ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between text-xxs">
          <span className="text-mid-grey">→ operational ACH</span>
          <span className="text-navy tabular-nums font-semibold">{derivedOperational?.toFixed(3) ?? '—'}</span>
        </div>
      </div>
      <p className="text-xxs text-mid-grey/80 italic">
        n₅₀ = q₅₀ × envelope area / volume · operational ≈ n₅₀ / 20 (ATTMA TSL1)
      </p>
    </CollapsibleSection>
  )
}

function InputsColumn({ library, onInspectConstruction, liveResult }) {
  const { params, updateParam, constructions, updateConstruction } = useContext(ProjectContext)
  const { length, width, num_floors, floor_height, orientation, wwr, name, infiltration_ach, window_count } = params
  const ach = infiltration_ach ?? 0.5
  // Brief 28-IM Bug 2: q50-derived airtightness. Engine returns operational/
  // n50/q50 values inside losses_at_setpoint.fabric_leakage. Use those for
  // the derived-value badges under the slider.
  const fabricLeakage = liveResult?.losses_at_setpoint?.fabric_leakage
  const q50 = Number(params?.fabric?.air_permeability_q50 ?? fabricLeakage?.q50_m3_per_h_m2 ?? 5)
  const derivedN50 = fabricLeakage?.n50_ach
  const derivedOperational = fabricLeakage?.operational_ach
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

  // ── Permanent openings (louvres) — per-facade Include memory ──────────────
  // Operable windows + window-open schedule now live in /operation (the
  // Ventilation & Operation module). They still write to params.openings
  // but the UI for them is no longer here.
  const openings = params.openings ?? {}
  const [louvreMemory, setLouvreMemory] = useState(() => ({
    north: (openings?.north?.louvre_area_m2 ?? 0) > 0 ? openings.north.louvre_area_m2 : 0.5,
    south: (openings?.south?.louvre_area_m2 ?? 0) > 0 ? openings.south.louvre_area_m2 : 0.5,
    east:  (openings?.east?.louvre_area_m2  ?? 0) > 0 ? openings.east.louvre_area_m2  : 0.5,
    west:  (openings?.west?.louvre_area_m2  ?? 0) > 0 ? openings.west.louvre_area_m2  : 0.5,
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

  const anyOpenings = ['north','south','east','west'].some(f =>
    (openings?.[f]?.louvre_area_m2 ?? 0) > 0
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
                <WindowCountInput
                  value={window_count?.[fac.key]}
                  defaultValue={fac.defaultCount}
                  disabled={!included}
                  onCommit={n => updateParam('window_count', { [fac.key]: n })}
                  title={`${facadeLabel(fac.num, orientation)} window count`}
                />
                <span className={`text-xxs w-4 ${included ? 'text-mid-grey' : 'text-light-grey'}`}>win</span>
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

        {/* ── Permanent openings ── Always-open envelope holes (louvres,
              trickle vents, similar). Operable windows + schedule live in
              /operation — they're an operational behaviour, not envelope geometry.
              Single-zone wind-driven flow: Q = Cd · A · √Cw · v_wind. */}
        <CollapsibleSection title={`Permanent openings${anyOpenings ? ' · active' : ''}`} defaultOpen={anyOpenings}>
          <div className="mb-2">
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

          <p className="text-xxs text-mid-grey mt-2 mb-1">Louvres (always open, m² per facade)</p>
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
                <LouvreAreaInput
                  value={area}
                  disabled={!included}
                  onCommit={v => setLouvreFor(fac.key, v)}
                  title={`${facadeLabel(fac.num, orientation)} louvre area (m²)`}
                />
                <span className={`text-xxs w-4 ${included ? 'text-mid-grey' : 'text-light-grey'}`}>m²</span>
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
              selectedChoice={constructions?.[el.key] ?? null}
              onSelect={updateConstruction}
              onInspect={onInspectConstruction}
            />
          ))}
        </CollapsibleSection>

        {/* ── Airtightness (Brief 28-IM Bug 2 + add 3 unit toggle) ── */}
        <Airtightness
          q50={q50}
          derivedN50={derivedN50}
          derivedOperational={derivedOperational}
          onChange={(v) => updateParam('fabric', { air_permeability_q50: v })}
        />

      </div>
    </div>
  )
}

// ── Brief 28-IM §2.2: centre-column view switcher ────────────────────────────
//
// Building tab tabs (per §3.1 + §5.2): Heat Balance / Profiles / Monthly /
// Summary. Heat Balance is the primary view; Profiles + Monthly + Summary are
// time-aggregation views.
//
// Brief 28-IM §15.2 stuck-point fallbacks honoured:
//   - Profiles tab uses the engine's free-running zone temperature trace
//     (already exposed) — fancier hourly-loss-by-element trace queued.
//   - Monthly tab distributes annual losses proportionally to heating
//     degree-hour weighting (crude pro-rata) — proper monthly engine
//     aggregation is a follow-up.
//   - Summary table shows engine output verbatim alongside derived metrics.

const MODULES_FABRIC = ['fabric', 'thermal_bridging', 'fabric_leakage', 'permanent_vents']

const CENTRE_TABS = [
  { id: 'heat-balance', label: 'Heat Balance' },
  { id: 'profiles',     label: 'Profiles' },
  { id: 'monthly',      label: 'Monthly' },
  { id: 'summary',      label: 'Summary' },
]

function BuildingCentreTabs({ view, onChange, instantResult, simBalance, simulationInfo, orientationDeg }) {
  // Coerce older persisted layout values ('3d' from the previous toggle) to
  // the default centre view of the new tab set.
  const activeView = CENTRE_TABS.some(t => t.id === view) ? view : 'heat-balance'

  return (
    <div className="w-full h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex-shrink-0 flex items-center gap-0 border-b border-light-grey bg-white px-2 pt-2">
        {CENTRE_TABS.map(t => {
          const active = t.id === activeView
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={`px-3 py-1.5 text-caption transition-colors border-b-2 -mb-px ${
                active
                  ? 'border-navy text-navy font-medium'
                  : 'border-transparent text-mid-grey hover:text-navy'
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeView === 'heat-balance' && (
          <HeatBalance
            liveData={instantResult?.heat_balance}
            simulationData={simBalance}
            simulationInfo={simulationInfo}
            orientationDeg={orientationDeg}
            onElementClick={() => {}}
            mode="envelope-only"
            modules={MODULES_FABRIC}
          />
        )}
        {activeView === 'profiles' && (
          <BuildingProfilesView instantResult={instantResult} />
        )}
        {activeView === 'monthly' && (
          <BuildingMonthlyView instantResult={instantResult} />
        )}
        {activeView === 'summary' && (
          <BuildingSummaryView instantResult={instantResult} simBalance={simBalance} />
        )}
      </div>
    </div>
  )
}

function BuildingProfilesView({ instantResult }) {
  const trace = instantResult?.free_running?.hourly_temperature_c
  if (!trace || trace.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-mid-grey text-xxs">
        Hourly trace not available — load weather data.
      </div>
    )
  }
  // Downsample 8760 hourly → 365 daily means for a readable chart.
  const daily = []
  for (let d = 0; d < 365; d++) {
    let sum = 0, n = 0
    for (let h = 0; h < 24; h++) {
      const i = d * 24 + h
      if (i < trace.length) { sum += trace[i]; n++ }
    }
    daily.push({ day: d + 1, t: n > 0 ? Math.round((sum / n) * 10) / 10 : null })
  }
  // Inline SVG line plot — keeps the dependency surface light and avoids
  // recharts importer bloat at the building tab level.
  const W = 900, H = 320, pad = 36
  const tMin = -5, tMax = 35
  const xs = (i) => pad + (i / 364) * (W - pad * 2)
  const ys = (v) => H - pad - ((v - tMin) / (tMax - tMin)) * (H - pad * 2)
  const path = daily.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xs(i)} ${ys(p.t)}`).join(' ')
  const monthMarkers = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334].map((d, i) =>
    ({ d, label: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i] }))
  return (
    <div className="w-full h-full overflow-auto p-4">
      <p className="text-caption font-semibold text-navy">Zone temperature trace · free-running · °C</p>
      <p className="text-xxs text-mid-grey mb-3">
        Free-running zone temperature, no heating or cooling. Initial T_zone = T_out
        at hour 0. Trace shows building's thermal response to weather, no
        setpoint-convergence transient. Daily mean of the 8760-hour series.
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-4xl border border-light-grey rounded bg-white">
        {/* Comfort band shading 20-26°C */}
        <rect x={pad} y={ys(26)} width={W - pad * 2} height={ys(20) - ys(26)} fill="#16A34A" fillOpacity="0.06" />
        {/* Y axis ticks */}
        {[-5, 0, 5, 10, 15, 20, 25, 30, 35].map(v => (
          <g key={v}>
            <line x1={pad} x2={W - pad} y1={ys(v)} y2={ys(v)} stroke="#E5E7EB" strokeWidth="0.5" />
            <text x={pad - 6} y={ys(v) + 3} textAnchor="end" fontSize="9" fill="#6B7280">{v}</text>
          </g>
        ))}
        {/* Month markers */}
        {monthMarkers.map(m => (
          <text key={m.d} x={xs(m.d)} y={H - 12} textAnchor="start" fontSize="9" fill="#6B7280">{m.label}</text>
        ))}
        {/* Trace */}
        <path d={path} fill="none" stroke="#0F172A" strokeWidth="1.2" />
        {/* Axis labels */}
        <text x={W / 2} y={H - 2} textAnchor="middle" fontSize="10" fill="#6B7280">Day of year</text>
        <text x={10} y={20} fontSize="10" fill="#6B7280">°C</text>
      </svg>
      <p className="text-xxs text-mid-grey italic mt-3">
        Static engine, free-running zone temperature. Dynamic-vs-Static overlay
        + per-element loss profile queued for follow-up (Brief 28-IM §15.2
        stuck-point fallback acknowledged).
      </p>
    </div>
  )
}

function BuildingMonthlyView({ instantResult }) {
  const los = instantResult?.losses_at_setpoint
  const gia = instantResult?.heat_balance?.metadata?.gia_m2 ?? 0
  if (!los || gia === 0) {
    return (
      <div className="h-full flex items-center justify-center text-mid-grey text-xxs">
        Monthly aggregation requires engine output — load weather data.
      </div>
    )
  }
  // Brief 28-IM IM-M2 add 2: true per-month engine aggregation.
  // Engine emits monthly_heating_loss_kwh[12] per element + glazing has
  // monthly_solar_transmission_kwh[12]. Sum per-element loss arrays
  // component-wise to get the per-month total fabric loss.
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const _z = () => new Array(12).fill(0)
  const _add = (out, arr) => { if (Array.isArray(arr)) for (let i = 0; i < 12; i++) out[i] += (arr[i] ?? 0) }
  const lossMonthly = _z()
  _add(lossMonthly, los.external_wall?.monthly_heating_loss_kwh)
  _add(lossMonthly, los.roof?.monthly_heating_loss_kwh)
  _add(lossMonthly, los.ground_floor?.monthly_heating_loss_kwh)
  _add(lossMonthly, los.glazing?.monthly_heating_loss_kwh)
  _add(lossMonthly, los.fabric_leakage?.monthly_heating_loss_kwh)
  _add(lossMonthly, los.permanent_vents?.monthly_heating_loss_kwh)
  _add(lossMonthly, los.thermal_bridging?.monthly_heating_loss_kwh)
  const solarMonthly = los.glazing?.monthly_solar_transmission_kwh ?? _z()
  const data = months.map((m, i) => ({
    month: m,
    loss:  Math.round(lossMonthly[i]),
    solar: Math.round(solarMonthly[i] ?? 0),
  }))
  const maxBar = Math.max(...data.map(d => Math.max(d.loss, d.solar)), 1)

  return (
    <div className="w-full h-full overflow-auto p-4">
      <p className="text-caption font-semibold text-navy">Monthly heat loss vs solar gain · kWh</p>
      <p className="text-xxs text-mid-grey mb-3">
        Per-month aggregation of the 8760-hour engine trace. Loss = fabric +
        leakage + permanent vents + thermal bridging. Solar = transmitted
        through glazing (all facades, no util factor).
      </p>
      <div className="flex items-end gap-2 max-w-4xl mt-4" style={{ height: 280 }}>
        {data.map(d => (
          <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
            <div className="text-xxs text-amber-700 tabular-nums">{d.solar > 1000 ? (d.solar/1000).toFixed(1)+'k' : d.solar}</div>
            <div className="w-full bg-amber-500/70 rounded-sm" style={{ height: `${(d.solar / maxBar) * 120}px` }} title={`${d.solar} kWh solar`} />
            <div className="text-xxs text-mid-grey">{d.month}</div>
            <div className="w-full bg-slate-500/70 rounded-sm" style={{ height: `${(d.loss / maxBar) * 120}px` }} title={`${d.loss} kWh loss`} />
            <div className="text-xxs text-slate-700 tabular-nums">{d.loss > 1000 ? (d.loss/1000).toFixed(1)+'k' : d.loss}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-4 text-xxs text-mid-grey">
        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-amber-500/70 rounded-sm" /> Solar transmission (above)</div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-slate-500/70 rounded-sm" /> Fabric heat loss (below)</div>
      </div>
    </div>
  )
}

function BuildingSummaryView({ instantResult, simBalance }) {
  const los = instantResult?.losses_at_setpoint
  const demand = instantResult?.demand
  const fr = instantResult?.free_running
  if (!los || !demand) {
    return (
      <div className="h-full flex items-center justify-center text-mid-grey text-xxs">
        Summary requires engine output — load weather data.
      </div>
    )
  }
  const tb = los.thermal_bridging ?? {}
  const fl = los.fabric_leakage ?? {}
  const rows = [
    ['External wall', los.external_wall?.heating_loss_kwh, los.external_wall?.area_m2, 'm²'],
    ['Roof',          los.roof?.heating_loss_kwh,          los.roof?.area_m2,          'm²'],
    ['Ground floor',  los.ground_floor?.heating_loss_kwh,  los.ground_floor?.area_m2,  'm²'],
    ['Glazing',       los.glazing?.heating_loss_kwh,       los.glazing?.area_m2,       'm²'],
    ['Fabric leakage', fl.heating_loss_kwh,                fl.operational_ach,         'ACH'],
    ['Permanent vents', los.permanent_vents?.heating_loss_kwh, null, ''],
    ['Thermal bridging', tb.heating_loss_kwh,              tb.total_H_TB_W_per_K,      'W/K'],
  ]
  const totalLoss = rows.reduce((s, r) => s + (r[1] ?? 0), 0)
  const simHeatingMwh = simBalance?.demand?.heating_demand_mwh ?? null

  return (
    <div className="w-full h-full overflow-auto p-4">
      <p className="text-caption font-semibold text-navy">Building summary · envelope</p>
      <p className="text-xxs text-mid-grey mb-3">
        Per-element annual heat loss · setpoint convention (Brief 28k) · Bridgewater post-BRUKL inputs.
      </p>

      <table className="w-full max-w-3xl text-xxs border-collapse">
        <thead>
          <tr className="border-b border-light-grey text-mid-grey uppercase tracking-wider">
            <th className="text-left py-2 pr-3 font-medium">Element</th>
            <th className="text-right py-2 pr-3 font-medium">Heat loss (kWh/yr)</th>
            <th className="text-right py-2 pr-3 font-medium">% of total</th>
            <th className="text-right py-2 font-medium">Characteristic</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, kwh, char, unit]) => (
            <tr key={label} className="border-b border-light-grey/50">
              <td className="py-1.5 pr-3 text-navy">{label}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-navy">
                {kwh != null ? Math.round(kwh).toLocaleString() : '—'}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-mid-grey">
                {kwh != null && totalLoss > 0 ? ((kwh / totalLoss) * 100).toFixed(1) + '%' : '—'}
              </td>
              <td className="py-1.5 text-right tabular-nums text-mid-grey">
                {char != null ? `${typeof char === 'number' ? (char < 1 ? char.toFixed(3) : Math.round(char).toLocaleString()) : char} ${unit}` : '—'}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-navy/30 font-semibold">
            <td className="py-2 pr-3 text-navy">Total fabric heat loss</td>
            <td className="py-2 pr-3 text-right tabular-nums text-navy">{Math.round(totalLoss).toLocaleString()}</td>
            <td className="py-2 pr-3 text-right tabular-nums text-mid-grey">100%</td>
            <td className="py-2 text-right" />
          </tr>
        </tbody>
      </table>

      <div className="mt-6 grid grid-cols-2 gap-4 max-w-3xl">
        <div className="bg-white border border-light-grey rounded p-3">
          <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">Heating demand</p>
          <p className="text-caption text-navy font-semibold">
            Static: <span className="tabular-nums">{demand.heating_demand_mwh?.toFixed(1)} MWh/yr</span>
          </p>
          {simHeatingMwh != null && (
            <p className="text-xxs text-mid-grey">
              Dynamic: <span className="tabular-nums">{simHeatingMwh.toFixed(1)} MWh/yr</span>
            </p>
          )}
        </div>
        <div className="bg-white border border-light-grey rounded p-3">
          <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">Cooling demand</p>
          <p className="text-caption text-navy font-semibold">
            Static: <span className="tabular-nums">{demand.cooling_demand_mwh?.toFixed(1)} MWh/yr</span>
          </p>
        </div>
        <div className="bg-white border border-light-grey rounded p-3">
          <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">Free-running zone temp</p>
          <p className="text-caption text-navy font-semibold tabular-nums">
            mean {fr?.annual_mean_c?.toFixed(1)} °C
          </p>
          <p className="text-xxs text-mid-grey tabular-nums">
            min {fr?.winter_min_c?.toFixed(1)} · max {fr?.summer_max_c?.toFixed(1)} °C
          </p>
        </div>
        <div className="bg-white border border-light-grey rounded p-3">
          <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">Comfort hours</p>
          <p className="text-caption text-navy font-semibold tabular-nums">
            {demand.comfort_hours?.toLocaleString() ?? '—'} hrs
          </p>
          <p className="text-xxs text-mid-grey tabular-nums">
            under {demand.underheating_hours?.toLocaleString() ?? '—'} · over {demand.overheating_hours?.toLocaleString() ?? '—'}
          </p>
        </div>
      </div>

      <p className="text-xxs text-mid-grey/80 italic mt-4 max-w-3xl">
        Static-vs-Dynamic per-element comparison + BRUKL diagnostic annotation queued
        for follow-up (Brief 28-IM §11.3, §15.2). Engine output values verbatim.
      </p>
    </div>
  )
}

function BuildingRightColumn({ params, instantResult }) {
  const [view, setView] = useState('3d')   // '3d' | 'live'
  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-shrink-0 flex items-center justify-between border-b border-light-grey px-2 pt-2 pb-1">
        <div className="flex bg-off-white rounded text-xxs">
          <button
            onClick={() => setView('3d')}
            className={`px-2.5 py-1 rounded-l transition-colors ${view === '3d' ? 'bg-white text-navy font-medium shadow-sm' : 'text-mid-grey'}`}
          >3D Model</button>
          <button
            onClick={() => setView('live')}
            className={`px-2.5 py-1 rounded-r transition-colors ${view === 'live' ? 'bg-white text-navy font-medium shadow-sm' : 'text-mid-grey'}`}
          >Live Results</button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {view === '3d'
          ? <BuildingViewer3D params={params ?? {}} />
          : <BuildingLiveResultsPanel instantResult={instantResult} />}
      </div>
    </div>
  )
}

function BuildingLiveResultsPanel({ instantResult }) {
  const demand = instantResult?.demand
  const los = instantResult?.losses_at_setpoint
  if (!demand || !los) {
    return <div className="p-4 text-xxs text-mid-grey">Load weather to see live results.</div>
  }
  const fabricUA = (los.external_wall?.area_m2 ?? 0) * 0  // placeholder
  const totalHTB = los.thermal_bridging?.total_H_TB_W_per_K ?? 0
  const fabricLeakageACH = los.fabric_leakage?.operational_ach ?? 0
  return (
    <div className="p-4 space-y-3 overflow-auto">
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey">Heating demand</p>
        <p className="text-2xl text-navy font-semibold tabular-nums">{demand.heating_demand_mwh?.toFixed(1)} <span className="text-xxs text-mid-grey">MWh/yr</span></p>
      </div>
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey">Cooling demand</p>
        <p className="text-2xl text-navy font-semibold tabular-nums">{demand.cooling_demand_mwh?.toFixed(1)} <span className="text-xxs text-mid-grey">MWh/yr</span></p>
      </div>
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey">Thermal bridging</p>
        <p className="text-caption text-navy tabular-nums">H_TB = {totalHTB.toFixed(2)} <span className="text-xxs text-mid-grey">W/K</span></p>
      </div>
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey">Operational ACH</p>
        <p className="text-caption text-navy tabular-nums">{fabricLeakageACH.toFixed(3)} <span className="text-xxs text-mid-grey">{los.fabric_leakage?.source ?? ''}</span></p>
      </div>
    </div>
  )
}

// ── Main three-column layout ──────────────────────────────────────────────────

export default function BuildingDefinition() {
  const { params, constructions, systems, currentProjectId, saveStatus, comfortBand } = useContext(ProjectContext)
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
  // Building module is locked to envelope-only mode (State 1) per Brief 26
  // and the state contract. The envelope-only path in calculateInstant
  // ignores gains, systems, operable windows etc. — the Building view is
  // purely envelope-vs-weather. Comfort band drives the demand derivation
  // (Part 1) at the lower/upper bound rather than against system setpoints.
  const instantResult = useMemo(
    () => calculateInstant(params, constructions, systems, libraryData, weatherData, hourlySolar, null, {
      mode: 'envelope-only',
      comfortBand,
    }),
    [params, constructions, systems, libraryData, weatherData, hourlySolar, comfortBand]
  )

  // Simulation balance — fetched per (projectId, runId). Lets the Live |
  // Simulation toggle in the centre panel actually flip between sources
  // instead of being permanently disabled on the Simulation pill.
  //
  // Mode is `envelope-only` here: the Building module is locked to State 1
  // per the state contract (Building == envelope view, gains/operation/systems
  // live in their own modules). The backend's State 1 path returns the contract
  // output shape — demand row, free-running stats, comfort band echo, ventilation
  // split into fabric_leakage + permanent_vents — that the HeatBalance component
  // renders unconditionally if the keys are present.
  const { data: simBalance } = useSimulationBalance(currentProjectId, simCtx?.runId, 'envelope-only')
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
  // setRight + toggleRight removed with the Live Results Panel.
  const setCentreView = (v) => setLayout(l => ({ ...l, centre: v }))

  return (
    <div className="flex h-[calc(100vh-3rem)] relative">
      {/* Left: inputs */}
      <div className="flex-shrink-0 z-10" style={{ width: layout.left }}>
        <InputsColumn
          library={library}
          onInspectConstruction={setInspectConstruction}
          liveResult={instantResult}
        />
      </div>

      <ResizeHandle onResize={setLeft} />

      {/* Centre — Brief 28-IM §2.2 view switcher: Heat Balance / Profiles /
          Monthly / Summary (3D moved to right column per §2.1) */}
      <div className="flex-1 relative bg-off-white flex flex-col min-w-0">
        <BuildingCentreTabs
          view={layout.centre}
          onChange={setCentreView}
          instantResult={instantResult}
          simBalance={simBalance}
          simulationInfo={simulationInfo}
          orientationDeg={orientationDeg}
        />
      </div>

      {/* Right column — Brief 28-IM §2.1 right (380-480 px): 3D / Live Results */}
      <div className="flex-shrink-0 bg-white border-l border-light-grey" style={{ width: 420 }}>
        <BuildingRightColumn params={params} instantResult={instantResult} />
      </div>

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
