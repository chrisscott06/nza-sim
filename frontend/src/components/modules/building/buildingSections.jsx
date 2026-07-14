/**
 * buildingSections.jsx — Brief 46 Part 2c (2026-05-22)
 *
 * Self-contained Building-subsection components. Extracted from
 * `BuildingDefinition.jsx`'s monolithic `InputsColumn` per Chris's
 * Option A directive at Brief 46 Part 2a close:
 *
 *   "Each subsection's named export must be self-contained — own state,
 *    own labels, own component-level memoisation. No prop-drilling from
 *    BuildingDefinition that BuildingSection has to also fake."
 *
 * Same components, two consumers:
 *
 *   - Main app: `BuildingDefinition.jsx`'s `InputsColumn` is now a thin
 *     assembler — wires `accordionProps(id)` to each section and hands
 *     `library` + `liveResult` to the sections that need them.
 *   - Editor: `interventions/sections/BuildingSection.jsx` dispatches
 *     by active subsection (e.g. `building.air_permeability` →
 *     `<AirtightnessSection />`).
 *
 * Each section uses `useProjectMutation` from Brief 46 Part 2a, so
 * mutations route to capture mode when wrapped in the editor's
 * `InterventionCaptureProvider` and to ProjectContext otherwise.
 *
 * Shared helpers (CollapsibleSection, Field, NumberInput, CompassRose,
 * UValueBadge, ConstructionSelect, WindowCountInput, LouvreAreaInput,
 * achLabel, facadeLabel, FACADES, etc.) live in this file because the
 * sections need them; they were previously module-scoped in
 * BuildingDefinition.jsx and are now exported here for the sections.
 *
 * Already-standalone components re-exported for one-place imports:
 *   - ThermalBridgesPanel (its own file)
 *
 * The Brief 46 Part 5 sweep will retire any duplicated definitions that
 * remain in BuildingDefinition.jsx after this extraction settles.
 */

import { useState, useContext, useEffect, useRef } from 'react'
import { Pencil, Lock, Unlock } from 'lucide-react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { useProjectMutation } from '../../../hooks/useProjectMutation.js'
import { cwProvenance } from '../../../utils/openingCoefficients.js'
import ThermalBridgesPanel from './ThermalBridgesPanel.jsx'
// Brief 47 Part 4 (2026-05-24): per-control change flags. PatchedInputBadge
// renders a small accent dot beside any input whose path matches an
// active patch in the capture context (exact or prefix). Outside the
// editor it's a no-op pass-through.
import PatchedInputBadge from '../interventions/PatchedInputBadge.jsx'

// ── Module-scoped constants ────────────────────────────────────────────────

export const BUILDING_ACCENT = '#A1887F'

// F1=north (0°), F2=east (90°), F3=south (180°), F4=west (270°)
export function facadeLabel(facadeNumber, orientationDeg) {
  const baseAngles = { 1: 0, 2: 90, 3: 180, 4: 270 }
  const trueAngle = (baseAngles[facadeNumber] + orientationDeg) % 360
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const compass = directions[Math.round(trueAngle / 45) % 8]
  return `F${facadeNumber} (${compass})`
}

export const FACADES = [
  { num: 1, key: 'north', defaultCount: 8 },
  { num: 2, key: 'east',  defaultCount: 3 },
  { num: 3, key: 'south', defaultCount: 8 },
  { num: 4, key: 'west',  defaultCount: 3 },
]

export const CONSTRUCTION_ELEMENTS = [
  { key: 'external_wall', label: 'External Wall', types: ['wall'] },
  { key: 'roof',          label: 'Roof',          types: ['roof'] },
  { key: 'ground_floor',  label: 'Ground Floor',  types: ['floor', 'ground_floor'] },
  { key: 'glazing',       label: 'Glazing',       types: ['glazing', 'window'] },
]

function achLabel(ach) {
  if (ach < 0.3)  return { text: 'Very airtight', color: 'text-green-600' }
  if (ach <= 0.6) return { text: 'Good',          color: 'text-green-600' }
  if (ach <= 1.0) return { text: 'Average',        color: 'text-amber-600' }
  return                  { text: 'Leaky',          color: 'text-red-600' }
}

const MIN_WINDOWS_PER_FACADE = 1
const MAX_WINDOWS_PER_FACADE = 40

const MIN_LOUVRE_AREA = 0
const MAX_LOUVRE_AREA = 20

// ── Shared visual primitives ───────────────────────────────────────────────

export function CollapsibleSection({ title, children, isOpen, onToggle, defaultOpen = true }) {
  const [localOpen, setLocalOpen] = useState(defaultOpen)
  const controlled = typeof isOpen === 'boolean' && typeof onToggle === 'function'
  const open = controlled ? isOpen : localOpen
  const handleClick = () => {
    if (controlled) onToggle()
    else setLocalOpen(o => !o)
  }
  return (
    <div className="mb-2">
      <button
        onClick={handleClick}
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

export function Field({ label, children }) {
  return (
    <div className="space-y-1 mb-2">
      <label className="text-xxs uppercase tracking-wider text-mid-grey">{label}</label>
      {children}
    </div>
  )
}

export function NumberInput({ value, onChange, min, max, step = 1 }) {
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

export function CompassRose({ orientation }) {
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

export function UValueBadge({ u }) {
  if (u == null) return null
  const color = u <= 0.18 ? '#16A34A' : u <= 0.28 ? '#ECB01F' : '#DC2626'
  return (
    <span className="text-xxs font-semibold px-1 py-0.5 rounded" style={{ backgroundColor: color + '20', color }}>
      U {Number(u).toFixed(2)}
    </span>
  )
}

// Brief 28-IM Bug 1: pre-28L projects use a bare string library_id;
// 28L+ persists `{library_id, u_value_override, g_value_override}`.
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

export function ConstructionSelect({ elementKey, label, library, types, selectedChoice, onSelect, onInspect }) {
  const { library_id, u_value_override, g_value_override } = _resolveChoice(selectedChoice)
  const filtered = library.filter(c => types.some(t => (c.type ?? '').toLowerCase() === t))
  const items = filtered.length > 0 ? filtered : library
  const selected = items.find(c => c.name === library_id)
  const effectiveU = u_value_override ?? selected?.u_value_W_per_m2K

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

  // Glazing g-value (SHGC): Auto = library value; Override = project-scoped
  // g_value_override that BOTH the Static engine (getGValue) and EnergyPlus
  // (_apply_glazing_overrides in the assembler) honour. Written in the same
  // object shape as u_value_override so the two overrides coexist.
  const isGlazing = elementKey === 'glazing'
  const libraryG = selected?.g_value != null ? Number(selected.g_value) : null
  const gOverrideActive = g_value_override != null && g_value_override > 0
  const effectiveG = gOverrideActive ? g_value_override : libraryG

  const setGOverride = (val) => {
    const base = (selectedChoice && typeof selectedChoice === 'object')
      ? selectedChoice
      : { library_id }
    onSelect(elementKey, { ...base, library_id, g_value_override: Math.round(val * 100) / 100 })
  }
  const clearGOverride = () => {
    const base = (selectedChoice && typeof selectedChoice === 'object')
      ? selectedChoice
      : { library_id }
    onSelect(elementKey, { ...base, library_id, g_value_override: null })
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

      {isGlazing && selected && libraryG != null && (
        <div className="mt-1 flex items-center gap-1.5">
          <span className="text-xxs text-mid-grey">g-value</span>
          <input
            type="number"
            min={0.1} max={0.9} step={0.01}
            value={effectiveG ?? ''}
            onChange={e => {
              const v = Number(e.target.value)
              if (Number.isFinite(v) && v > 0) setGOverride(v)
            }}
            title={gOverrideActive
              ? `Project override g = ${effectiveG.toFixed(2)} (library g = ${libraryG.toFixed(2)}). Applied to the live engine and EnergyPlus.`
              : `Library g = ${libraryG.toFixed(2)}. Type to set a project-specific override.`}
            className="w-16 px-1.5 py-0.5 text-xxs text-navy text-right border border-light-grey rounded focus:outline-none focus:border-teal"
          />
          {gOverrideActive
            ? (
              <button
                type="button"
                onClick={clearGOverride}
                className="text-xxs text-teal hover:text-navy underline"
                title={`Reset to library g = ${libraryG.toFixed(2)}`}
              >override · reset</button>
            )
            : <span className="text-xxs text-mid-grey">library</span>}
        </div>
      )}
    </div>
  )
}

// ── Window-count input — caps at MAX, local draft so clearing doesn't snap ─

export function WindowCountInput({ value, defaultValue, onCommit, disabled, title }) {
  const [draft, setDraft] = useState(String(value ?? defaultValue))
  useEffect(() => { setDraft(String(value ?? defaultValue)) }, [value, defaultValue])

  // Self-heal legacy out-of-range values once on mount.
  useEffect(() => {
    if (value != null && value > MAX_WINDOWS_PER_FACADE) {
      onCommit(MAX_WINDOWS_PER_FACADE)
    }
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

// ── Louvre-area input — local draft to avoid the "0" disabling itself ──────

export function LouvreAreaInput({ value, onCommit, disabled, title }) {
  const fmt = (v) => (Number.isFinite(v) ? Number(v).toFixed(2) : '')
  const [draft, setDraft] = useState(fmt(value ?? 0))
  const inputRef = useRef(null)
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setDraft(fmt(value ?? 0))
    }
  }, [value])

  const commit = () => {
    const parsed = parseFloat(draft)
    if (!Number.isFinite(parsed)) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Section components — each one self-contained per Chris's Option A directive
// (own state, own labels, own component-level memoisation).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GeometrySection — name + length/width/floors/floor_height + orientation
 * (with lock + compass rose) + GIA/volume readouts.
 *
 * Self-contained state: `orientationLocked` (local-only convenience lock).
 */
export function GeometrySection({ isOpen, onToggle }) {
  const { params } = useContext(ProjectContext)
  const { mutate } = useProjectMutation()
  const { length, width, num_floors, floor_height, orientation, name } = params ?? {}
  const [orientationLocked, setOrientationLocked] = useState(false)

  const gia = (length ?? 0) * (width ?? 0) * (num_floors ?? 0)
  const vol = gia * (floor_height ?? 0)

  return (
    <CollapsibleSection title="Geometry" isOpen={isOpen} onToggle={onToggle}>
      <Field label="Building name">
        <input
          type="text"
          value={name ?? ''}
          onChange={e => mutate('building.name', e.target.value)}
          className="w-full px-2 py-1 text-caption text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-teal transition-colors"
        />
      </Field>

      <div className="grid grid-cols-2 gap-1.5 mb-2">
        <Field label="Length (m)">
          <NumberInput value={length} min={1} max={500} onChange={v => mutate('building.length', v)} />
        </Field>
        <Field label="Width (m)">
          <NumberInput value={width} min={1} max={500} onChange={v => mutate('building.width', v)} />
        </Field>
        <Field label="Floors">
          <NumberInput value={num_floors} min={1} max={20} onChange={v => mutate('building.num_floors', v)} />
        </Field>
        <Field label="Floor height (m)">
          <NumberInput value={floor_height} min={2.0} max={6.0} step={0.1} onChange={v => mutate('building.floor_height', v)} />
        </Field>
      </div>

      <Field label={`Orientation — ${orientation}°${orientationLocked ? ' (locked)' : ''}`}>
        <div className="flex items-center gap-2">
          <PatchedInputBadge path="building.orientation">
            <input
              type="range" min={0} max={359} step={1}
              value={orientation}
              onChange={e => mutate('building.orientation', Number(e.target.value))}
              disabled={orientationLocked}
              className="flex-1 h-[3px] accent-navy disabled:opacity-30 w-full"
            />
          </PatchedInputBadge>
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
  )
}

/**
 * GlazingSection — per-facade Include checkbox + WWR slider + window count.
 *
 * Self-contained state: `wwrMemory` per facade — restores the last
 * non-zero WWR when the user re-ticks Include after unticking it.
 */
export function GlazingSection({ isOpen, onToggle }) {
  const { params } = useContext(ProjectContext)
  const { mutate } = useProjectMutation()
  const wwr          = params?.wwr ?? {}
  const window_count = params?.window_count ?? {}
  const orientation  = params?.orientation ?? 0

  const [wwrMemory, setWwrMemory] = useState(() => ({
    north: (wwr.north ?? 0) > 0 ? wwr.north : 0.25,
    south: (wwr.south ?? 0) > 0 ? wwr.south : 0.25,
    east:  (wwr.east  ?? 0) > 0 ? wwr.east  : 0.25,
    west:  (wwr.west  ?? 0) > 0 ? wwr.west  : 0.25,
  }))

  const setWwrFor = (face, v) => {
    if (v > 0) setWwrMemory(m => ({ ...m, [face]: v }))
    mutate(`building.wwr.${face}`, v)
  }
  const toggleWindowInclude = (face, include) => {
    const current = wwr?.[face] ?? 0
    if (include) {
      const restore = wwrMemory[face] > 0 ? wwrMemory[face] : 0.25
      mutate(`building.wwr.${face}`, restore)
    } else {
      if (current > 0) setWwrMemory(m => ({ ...m, [face]: current }))
      mutate(`building.wwr.${face}`, 0)
    }
  }

  return (
    <CollapsibleSection title="Glazing (WWR)" isOpen={isOpen} onToggle={onToggle}>
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
            <PatchedInputBadge path={`building.wwr.${fac.key}`}>
              <input
                type="range" min={0} max={100} step={1}
                value={Math.round((wwr[fac.key] ?? 0) * 100)}
                onChange={e => setWwrFor(fac.key, Number(e.target.value) / 100)}
                disabled={!included}
                className="flex-1 h-[3px] accent-navy disabled:opacity-30 w-full"
              />
            </PatchedInputBadge>
            <span className={`text-xxs w-7 text-right ${included ? 'text-navy' : 'text-light-grey'}`}>
              {Math.round((wwr[fac.key] ?? 0) * 100)}%
            </span>
            <WindowCountInput
              value={window_count?.[fac.key]}
              defaultValue={fac.defaultCount}
              disabled={!included}
              onCommit={n => mutate(`building.window_count.${fac.key}`, n)}
              title={`${facadeLabel(fac.num, orientation)} window count`}
            />
            <span className={`text-xxs w-4 ${included ? 'text-mid-grey' : 'text-light-grey'}`}>win</span>
          </div>
        )
      })}
    </CollapsibleSection>
  )
}

/**
 * ShadingSection — per-facade reveal depth applied as a 4-edge frame
 * (drives overhang.depth_m + fin.left_depth_m + fin.right_depth_m
 * together for the per-window 3D frame to match the EnergyPlus shading
 * objects emitted per fenestration).
 *
 * Self-contained state: `shadingMemory` per facade.
 */
export function ShadingSection({ isOpen, onToggle }) {
  const { params } = useContext(ProjectContext)
  const { mutate } = useProjectMutation()
  const shadingOverhang = params?.shading_overhang ?? {}
  const shadingFin      = params?.shading_fin      ?? {}
  const orientation     = params?.orientation ?? 0

  const anyShading = ['north','south','east','west'].some(f =>
    (shadingOverhang[f]?.depth_m ?? 0) > 0 ||
    (shadingFin[f]?.left_depth_m ?? 0) > 0 ||
    (shadingFin[f]?.right_depth_m ?? 0) > 0
  )

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

  const setShadingFor = (face, v) => {
    if (v > 0) setShadingMemory(m => ({ ...m, [face]: v }))
    mutate(`building.shading_overhang.${face}`, { depth_m: v, offset_m: 0 })
    mutate(`building.shading_fin.${face}`,      { left_depth_m: v, right_depth_m: v })
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

  return (
    <CollapsibleSection title={`Shading${anyShading ? ' · active' : ''}`} isOpen={isOpen} onToggle={onToggle}>
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
            <PatchedInputBadge path={`building.shading_overhang.${fac.key}`}>
              <input
                type="range" min={0} max={1.5} step={0.05}
                value={reveal}
                onChange={e => setShadingFor(fac.key, Number(e.target.value))}
                disabled={!included}
                className="flex-1 h-[3px] accent-navy disabled:opacity-30 w-full"
              />
            </PatchedInputBadge>
            <span className={`text-xxs w-12 text-right tabular-nums ${included ? 'text-navy' : 'text-light-grey'}`}>
              {reveal.toFixed(2)} m
            </span>
          </div>
        )
      })}
    </CollapsibleSection>
  )
}

/**
 * OpeningsSection — site exposure + per-facade louvre area + per-facade
 * C_d + flow_mode. Brief 42 Part 4 retired the building-wide cd /
 * flow_mode controls; each facade now declares its own physics.
 *
 * Self-contained state: `louvreMemory` per facade.
 */
export function OpeningsSection({ isOpen, onToggle }) {
  const { params } = useContext(ProjectContext)
  const { mutate } = useProjectMutation()
  const openings    = params?.openings ?? {}
  const orientation = params?.orientation ?? 0

  const [louvreMemory, setLouvreMemory] = useState(() => ({
    north: (openings?.north?.louvre_area_m2 ?? 0) > 0 ? openings.north.louvre_area_m2 : 0.5,
    south: (openings?.south?.louvre_area_m2 ?? 0) > 0 ? openings.south.louvre_area_m2 : 0.5,
    east:  (openings?.east?.louvre_area_m2  ?? 0) > 0 ? openings.east.louvre_area_m2  : 0.5,
    west:  (openings?.west?.louvre_area_m2  ?? 0) > 0 ? openings.west.louvre_area_m2  : 0.5,
  }))

  const setLouvreFor = (face, v) => {
    if (v > 0) setLouvreMemory(m => ({ ...m, [face]: v }))
    mutate(`building.openings.${face}`, { louvre_area_m2: v })
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

  const site_exposure = openings.site_exposure ?? 'normal'
  const cwp = cwProvenance(site_exposure)

  const setFacadeCd = (face, v) => {
    mutate(`building.openings.${face}`, { cd: v })
  }
  const setFacadeFlowMode = (face, v) => {
    mutate(`building.openings.${face}`, { flow_mode: v })
  }

  const anyOpenings = ['north','south','east','west'].some(f =>
    (openings?.[f]?.louvre_area_m2 ?? 0) > 0
  )

  return (
    <CollapsibleSection title={`Permanent openings${anyOpenings ? ' · active' : ''}`} isOpen={isOpen} onToggle={onToggle}>
      {/* Site exposure — only remaining building-wide control */}
      <div className="mb-3">
        <div className="flex items-baseline justify-between gap-2 mb-0.5">
          <label className="text-xxs text-mid-grey">Site exposure</label>
          <span
            className="text-xxs text-navy/70 tabular-nums cursor-help"
            title={`C_w = ${cwp.text}`}
          >
            C<sub>w</sub> = <span className="font-semibold text-navy">{cwp.cw.toFixed(2)}</span>
          </span>
        </div>
        <select
          value={site_exposure}
          onChange={e => mutate('building.openings.site_exposure', e.target.value)}
          className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-teal cursor-pointer"
          title="Wind-pressure coefficient: sheltered = 0.05, normal = 0.10, exposed = 0.20"
        >
          <option value="sheltered">Sheltered</option>
          <option value="normal">Normal</option>
          <option value="exposed">Exposed</option>
        </select>
      </div>

      <p className="text-xxs text-mid-grey mt-2 mb-1">Louvres (always open, m² per facade)</p>
      {FACADES.map(fac => {
        const area      = Number(openings?.[fac.key]?.louvre_area_m2 ?? 0)
        const included  = area > 0
        const facCd     = typeof openings?.[fac.key]?.cd === 'number' ? openings[fac.key].cd : 0.40
        const facFlow   = openings?.[fac.key]?.flow_mode ?? 'single_sided'
        return (
          <div key={`louvre-${fac.key}`} className={`mb-1.5 ${included ? 'pb-1.5 border-b border-light-grey/40 last:border-b-0 last:pb-0' : ''}`}>
            <div className="flex items-center gap-1">
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
            {included && (
              <div className="grid grid-cols-[1fr_auto] gap-2 mt-1 pl-5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xxs text-mid-grey w-6">C<sub>d</sub></span>
                  <input
                    type="range" min={0.15} max={0.65} step={0.01}
                    value={facCd}
                    onChange={e => setFacadeCd(fac.key, Number(e.target.value))}
                    className="flex-1 h-[3px] accent-navy"
                    title="Discharge coefficient — see docs/audit/29_permanent_vent_methodology.md for typical values (trickle vent 0.25 / louvre 0.40 / open window 0.60)"
                  />
                  <span className="text-xxs text-navy tabular-nums w-9 text-right">{facCd.toFixed(2)}</span>
                </div>
                <select
                  value={facFlow}
                  onChange={e => setFacadeFlowMode(fac.key, e.target.value)}
                  className="px-1 py-0.5 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-teal cursor-pointer"
                  title="Flow correlation: single-sided (BS EN 16798-7 §6.4 — one façade per room / cellular) or cross-flow (CIBSE Guide A §4.6 — opposite façades with open air path)"
                >
                  <option value="single_sided">Single-sided</option>
                  <option value="cross">Cross-flow</option>
                </select>
              </div>
            )}
          </div>
        )
      })}

      {anyOpenings && (
        <p className="text-xxs text-mid-grey/70 mt-2 leading-tight">
          C<sub>d</sub> reference: <span className="tabular-nums">0.25</span> trickle vent · <span className="tabular-nums">0.40</span> louvre · <span className="tabular-nums">0.60</span> open window. See methodology doc for typical values.
        </p>
      )}
    </CollapsibleSection>
  )
}

/**
 * FabricSection — constructions picker for the four envelope elements.
 *
 * Takes `library` as a prop (the constructions library; fetched at the
 * page level to avoid duplicate /api/library/constructions calls when
 * multiple modules want it). Uses `updateConstruction` from
 * ProjectContext via the delegate-to-existing-helpers Q2 design — when
 * capture mode is active, `updateConstruction` itself is wrapped to
 * route through `mutate('constructions.<key>', value)`, so the same
 * call site works in both modes.
 *
 * Why direct `updateConstruction` rather than mutate(): existing
 * library-aware components (ConstructionInspector, ConstructionPicker)
 * already call updateConstruction. Mirroring that call site keeps the
 * Brief 41 patch-shape stable (`constructions.<key>` carries a
 * `{library_id, u_value_override, g_value_override}` object).
 *
 * Brief 46 Part 5 may swap this for `mutate('constructions.<key>', …)`
 * once the capture context's construction patch shape is finalised.
 */
export function FabricSection({ library, onInspectConstruction, isOpen, onToggle }) {
  const { constructions, updateConstruction } = useContext(ProjectContext)

  return (
    <CollapsibleSection title="Fabric" isOpen={isOpen} onToggle={onToggle}>
      {CONSTRUCTION_ELEMENTS.map(el => (
        <ConstructionSelect
          key={el.key}
          elementKey={el.key}
          label={el.label}
          library={library ?? []}
          types={el.types}
          selectedChoice={constructions?.[el.key] ?? null}
          onSelect={updateConstruction}
          onInspect={onInspectConstruction}
        />
      ))}
    </CollapsibleSection>
  )
}

/**
 * AirtightnessSection — q50 slider with unit toggle (m³/h·m² ↔ l/s·m²).
 *
 * Takes `liveResult` as an optional prop for the derived n50 / operational
 * ACH display rows. Degrades gracefully to "—" when no engine result is
 * available (e.g. in the intervention editor before the preview engine
 * has run, or if the host doesn't pass one).
 *
 * Self-contained state: `unit` toggle.
 */
export function AirtightnessSection({ liveResult, isOpen, onToggle }) {
  const { params } = useContext(ProjectContext)
  const { mutate } = useProjectMutation()
  const fabricLeakage = liveResult?.losses_at_setpoint?.fabric_leakage
  const q50 = Number(params?.fabric?.air_permeability_q50 ?? fabricLeakage?.q50_m3_per_h_m2 ?? 5)
  const derivedN50 = fabricLeakage?.n50_ach
  const derivedOperational = fabricLeakage?.operational_ach

  const [unit, setUnit] = useState('m3_h_m2')  // 'm3_h_m2' | 'l_s_m2'
  const q50_ls = q50 / 3.6
  return (
    <CollapsibleSection title="Airtightness" isOpen={isOpen} onToggle={onToggle}>
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
        <PatchedInputBadge path="building.fabric.air_permeability_q50">
          <input
            type="range" min={1} max={25} step={0.1}
            value={q50}
            onChange={e => mutate('building.fabric', { air_permeability_q50: parseFloat(e.target.value) })}
            className="flex-1 h-[3px] accent-navy w-full"
          />
        </PatchedInputBadge>
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
      <div className="flex justify-between text-xxs text-mid-grey/80 mb-2 px-1">
        {unit === 'm3_h_m2' ? (
          <>
            <span title="Passive House / well-detailed">≤3 best</span>
            <span title="Compliance baseline">3–10 typical</span>
            <span title="Untested / poor detail">&gt;10 leaky</span>
          </>
        ) : (
          <>
            <span title="Passive House / well-detailed (≡ ≤3 m³/h·m²)">≤0.83 best</span>
            <span title="Compliance baseline (≡ 3–10 m³/h·m²)">0.83–2.78 typical</span>
            <span title="Untested / poor detail (≡ &gt;10 m³/h·m²)">&gt;2.78 leaky</span>
          </>
        )}
      </div>
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

/**
 * ComfortBandSection — heating + cooling setpoint sliders.
 *
 * Brief 28-IM-Polish IA 3.1: setpoint is an INPUT (affects the
 * calculation), so it lives in the left column. Brief 46 Part 2a routed
 * the writes through useProjectMutation; this extraction also fixes a
 * dangling-mutate bug introduced when the function was refactored
 * without importing the hook (a now-extinct codepath that called
 * `mutate(…)` while only `setComfortBand` was in scope — never noticed
 * because every project's persisted comfort band was already correct
 * and the runtime ReferenceError fired only on the first slider drag,
 * which Chris had not yet attempted on the affected build).
 */
/**
 * BuildingMetadataSection — Brief 58 A4 (2026-05-26).
 *
 * Single source of truth for the three genuinely building-level constants:
 *   - num_bedrooms (relabelled "Number of rooms" in the UI per A1 §3.4;
 *     storage field name unchanged to avoid a 20-file Rule-14 rename)
 *   - reported_gia (the EUI denominator; A3 engine surface)
 *       + geometry_gia (read-only, computed from length × width × num_floors)
 *       + divergence flag when |reported − geometry| / geometry > 10%
 *   - comfort_band (heating + cooling setpoints)
 *
 * Brief 58 Principle 1: "Each quantity lives where it physically belongs.
 * Building constants → metadata page. Occupancy and electrical loads →
 * Internal Gains." Occupancy is NOT here — people_per_room is Part B.
 *
 * Persistence: each input writes via `mutate(path, value)` → ProjectContext
 * → autosave PUT /api/projects/{id} → SQLite UPDATE + WAL_CHECKPOINT
 * (Brief 58 A4 server-side, projects.py L311+).
 */
export function BuildingMetadataSection({ isOpen, onToggle }) {
  const { params, comfortBand } = useContext(ProjectContext)
  const { mutate } = useProjectMutation()

  const numBedrooms = Number(params?.num_bedrooms ?? 0)
  const length      = Number(params?.length ?? 0)
  const width       = Number(params?.width ?? 0)
  const numFloors   = Number(params?.num_floors ?? 0)
  const geometryGia = Math.round(length * width * numFloors)

  // reported_gia null → defaults to geometry on the engine side.
  // Display: show user-set value when present, geometry otherwise.
  const reportedRaw = params?.reported_gia
  const reportedActive = reportedRaw != null && Number.isFinite(Number(reportedRaw)) && Number(reportedRaw) > 0
  const reportedDisplay = reportedActive ? Math.round(Number(reportedRaw)) : geometryGia

  // Brief 58 A4 §A4: divergence flag when |reported − geometry| / geometry > 10 %.
  const divergencePct = geometryGia > 0
    ? Math.abs(reportedDisplay - geometryGia) / geometryGia * 100
    : 0
  const divergenceFires = divergencePct > 10

  const lo = Number(comfortBand?.lower_c ?? 20)
  const hi = Number(comfortBand?.upper_c ?? 26)

  return (
    <CollapsibleSection title="Building metadata" isOpen={isOpen} onToggle={onToggle}>
      <div className="space-y-3">
        {/* ── Number of rooms ─────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <label className="text-xxs text-mid-grey">Number of rooms</label>
            <span className="text-xxs text-mid-grey/60">drives per-room occupancy density</span>
          </div>
          <PatchedInputBadge path="num_bedrooms">
            <input
              type="number"
              min={0}
              step={1}
              value={numBedrooms}
              onChange={e => mutate('num_bedrooms', Math.max(0, parseInt(e.target.value || '0', 10)))}
              className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white tabular-nums"
            />
          </PatchedInputBadge>
        </div>

        {/* ── Reported GIA (+ geometry read-only + divergence flag) ─ */}
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <label className="text-xxs text-mid-grey">Reported GIA</label>
            <span className="text-xxs text-mid-grey/60">EUI denominator</span>
          </div>
          <PatchedInputBadge path="reported_gia">
            <input
              type="number"
              min={0}
              step={1}
              value={reportedActive ? reportedDisplay : ''}
              placeholder={`${geometryGia} (geometry)`}
              onChange={e => {
                const raw = e.target.value.trim()
                if (raw === '') {
                  mutate('reported_gia', null)
                  return
                }
                const v = Number(raw)
                if (Number.isFinite(v) && v > 0) mutate('reported_gia', Math.round(v))
              }}
              className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white tabular-nums"
            />
          </PatchedInputBadge>
          <div className="flex items-center justify-between mt-1 text-xxs">
            <span className="text-mid-grey/80">
              Geometry GIA (length × width × floors)
            </span>
            <span className="text-mid-grey tabular-nums">{geometryGia} m²</span>
          </div>
          {divergenceFires && (
            <div className="mt-1.5 px-2 py-1 rounded text-xxs bg-amber-50 border border-amber-200 text-amber-800">
              ⚠ Reported and geometry diverge by {divergencePct.toFixed(1)} %
              (> 10 % threshold). Either a legitimate convention gap (net
              vs gross) or mis-entered geometry — confirm before relying
              on EUI.
            </div>
          )}
          <p className="text-xxs text-mid-grey/80 italic pt-1">
            Leave blank to use geometry GIA (default). Set a different value
            when reporting against an agency convention (BRUKL net internal
            area, etc.). Drives EUI display only — building physics stays
            on geometry.
          </p>
        </div>

        {/* ── Comfort band ────────────────────────────────────────── */}
        {/* 2026-05-28 (Chris-flag, post-Brief-69 walkthrough): cross-clamped
            so cooling can never go below heating. Brief 69's float-gated
            demand model is sensible only when the dead band has positive
            width; inverted setpoints produce a logical contradiction the
            engine handles via heating-priority but with spurious paired
            demand (heating + cooling fighting). 0.5°C minimum band width
            matches the slider step so the guard never blocks a single click. */}
        <div className="pt-2 border-t border-light-grey/60">
          <p className="text-xxs uppercase tracking-wider text-mid-grey/70 font-semibold mb-1.5">
            Comfort band
          </p>
          <div className="space-y-1.5">
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-xxs text-mid-grey">Heating setpoint</label>
                <span className="text-xxs text-navy tabular-nums">{lo.toFixed(1)} °C</span>
              </div>
              <PatchedInputBadge path="comfort_band.lower_c">
                <input
                  type="range" min={12} max={Math.min(26, hi - 0.5)} step={0.5}
                  value={lo}
                  onChange={e => mutate('comfort_band.lower_c', parseFloat(e.target.value))}
                  className="w-full h-[3px] accent-navy"
                />
              </PatchedInputBadge>
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-xxs text-mid-grey">Cooling setpoint</label>
                <span className="text-xxs text-navy tabular-nums">{hi.toFixed(1)} °C</span>
              </div>
              <PatchedInputBadge path="comfort_band.upper_c">
                <input
                  type="range" min={Math.max(20, lo + 0.5)} max={32} step={0.5}
                  value={hi}
                  onChange={e => mutate('comfort_band.upper_c', parseFloat(e.target.value))}
                  className="w-full h-[3px] accent-navy"
                />
              </PatchedInputBadge>
            </div>
            <p className="text-xxs text-mid-grey/80 italic pt-1">
              Drives heating/cooling demand against the setpoint convention.
              Wide bands (12 → 32) yield free-running behaviour; tight
              bands force more system work. Cooling cannot drop below heating
              (minimum 0.5 °C dead band).
            </p>
          </div>
        </div>
      </div>
    </CollapsibleSection>
  )
}

export function ComfortBandSection({ isOpen, onToggle }) {
  const { comfortBand } = useContext(ProjectContext)
  const { mutate } = useProjectMutation()
  const lo = Number(comfortBand?.lower_c ?? 20)
  const hi = Number(comfortBand?.upper_c ?? 26)
  return (
    <CollapsibleSection title="Comfort band (setpoints)" isOpen={isOpen} onToggle={onToggle}>
      <div className="space-y-1.5">
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <label className="text-xxs text-mid-grey">Heating setpoint</label>
            <span className="text-xxs text-navy tabular-nums">{lo.toFixed(1)} °C</span>
          </div>
          <PatchedInputBadge path="comfort_band.lower_c">
            <input
              type="range" min={12} max={Math.min(26, hi - 0.5)} step={0.5}
              value={lo}
              onChange={e => mutate('comfort_band.lower_c', parseFloat(e.target.value))}
              className="w-full h-[3px] accent-navy"
            />
          </PatchedInputBadge>
        </div>
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <label className="text-xxs text-mid-grey">Cooling setpoint</label>
            <span className="text-xxs text-navy tabular-nums">{hi.toFixed(1)} °C</span>
          </div>
          <PatchedInputBadge path="comfort_band.upper_c">
            <input
              type="range" min={Math.max(20, lo + 0.5)} max={32} step={0.5}
              value={hi}
              onChange={e => mutate('comfort_band.upper_c', parseFloat(e.target.value))}
              className="w-full h-[3px] accent-navy"
            />
          </PatchedInputBadge>
        </div>
        <p className="text-xxs text-mid-grey/80 italic pt-1">
          Drives heating/cooling demand against the setpoint convention (Brief 28k).
          Wide bands (12 → 32) yield free-running behaviour; tight bands force more system work.
          Cooling cannot drop below heating (minimum 0.5 °C dead band).
        </p>
      </div>
    </CollapsibleSection>
  )
}

// Re-export ThermalBridgesPanel for one-place imports from sister
// modules (BuildingDefinition.jsx + the editor's BuildingSection both
// import from this file).
export { ThermalBridgesPanel }

// Also export the unused achLabel for any external consumer that might
// want the same airtightness colour bands. (Currently unused outside
// this file, but kept exported because it was previously module-public
// on BuildingDefinition.jsx via the same pattern.)
export { achLabel }
