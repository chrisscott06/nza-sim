/**
 * OperationModule.jsx — /operation
 *
 * Brief 28e Gate E5a: operable openings as first-class envelope features.
 * Replaces the per-facade `openable_fraction` sliders with a list UI over
 * `building_config.operable_openings`. Each entry is a door / window bank /
 * vent with three control modes (permanent / scheduled / temperature) and
 * its own per-opening physics (area, height, Cd, Cw — see Brief 28e §A.1).
 *
 * Selection state is held in UIContext (selectedOpeningId / selectedFacade)
 * — Gate E5a wires panel → selection; Gate E5b will wire selection → 3D
 * highlight + reverse-direction click-from-3D.
 *
 * Reads / writes:
 *   params.operable_openings         (Brief 28e native array; this module
 *                                     replaces it wholesale via updateParam)
 *   params.openings.*                (LEGACY — read for one-click conversion,
 *                                     never written here; engine still falls
 *                                     back to synthesiseOperableOpeningsFromLegacy
 *                                     if operable_openings is empty)
 *
 * Permanent envelope openings (louvres) and site exposure stay in
 * Building → Permanent openings — they're always-open geometry, distinct
 * from operable.
 */

import { useContext, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ProjectContext } from '../../context/ProjectContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { synthesiseOperableOpeningsFromLegacy } from '../../utils/instantCalc.js'
import BuildingViewer3D from './building/BuildingViewer3D.jsx'

const ACCENT = '#0E7490'  // operation theme — cyan-700

const FACADES = [
  { num: 1, key: 'north' },
  { num: 2, key: 'east'  },
  { num: 3, key: 'south' },
  { num: 4, key: 'west'  },
]
function facadeLabel(facadeNumber, orientationDeg) {
  const baseAngles = { 1: 0, 2: 90, 3: 180, 4: 270 }
  const trueAngle = (baseAngles[facadeNumber] + (orientationDeg ?? 0)) % 360
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const compass = directions[Math.round(trueAngle / 45) % 8]
  return `F${facadeNumber} (${compass})`
}
function facadeLabelByKey(key, orientationDeg) {
  const fac = FACADES.find(f => f.key === key)
  return fac ? facadeLabel(fac.num, orientationDeg) : key
}

// Schedules registered in scheduleLibrary.js (frontend) + schedules.py (backend).
// Names must agree across both sides — see Brief 28e Gate E2 §scheduleLibrary.
const SCHEDULE_OPTIONS = [
  { value: 'always_on',                     label: 'Always open (24/7)' },
  { value: 'business_hours_09_18_weekdays', label: 'Business hours (Mon–Fri 09–18)' },
  { value: 'hotel_ventilation_occupied',    label: 'Hotel occupied (06–23 full, night 0.3)' },
  { value: 'summer_day_daytime',            label: 'Summer day (May–Sept 08–20)' },
]

const OPENING_TYPE_OPTIONS = [
  { value: 'door',   label: 'Door',   defaultArea: 4.0,  defaultHeight: 2.0, defaultCw: 0.25 },
  { value: 'window', label: 'Window', defaultArea: 1.5,  defaultHeight: 1.2, defaultCw: 0.40 },
  { value: 'vent',   label: 'Vent',   defaultArea: 0.5,  defaultHeight: 0.5, defaultCw: 0.25 },
]

// Generate a stable, human-readable id for a new opening.
function nextId(existing, type, facade) {
  const base = `${facade}_${type}`
  const seen = new Set((existing ?? []).map(o => o?.id).filter(Boolean))
  if (!seen.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${i}`
    if (!seen.has(candidate)) return candidate
  }
  return `${base}_${Date.now()}`
}

function newOpening(type, facade) {
  const t = OPENING_TYPE_OPTIONS.find(o => o.value === type) ?? OPENING_TYPE_OPTIONS[1]
  return {
    id:                    null,  // filled in by caller via nextId()
    name:                  `New ${t.label.toLowerCase()} (${facade})`,
    facade,
    area_m2:               t.defaultArea,
    height_m:              t.defaultHeight,
    discharge_coefficient: 0.6,
    wind_coefficient:      t.defaultCw,
    opening_type:          type,
    parent_glazing_face:   type === 'window' ? facade : null,
    control: {
      mode:                   'scheduled',
      schedule_ref:           'business_hours_09_18_weekdays',
      open_above_zone_c:      22.0,
      hysteresis_c:           1.0,
      require_outside_cooler: true,
    },
  }
}

export default function OperationModule() {
  const { params, updateParam } = useContext(ProjectContext)
  const { selectedOpeningId, setSelectedOpeningId, clearSelection } = useUI()

  const orientation = Number(params?.orientation ?? 0)
  const openings = useMemo(
    () => Array.isArray(params?.operable_openings) ? params.operable_openings : [],
    [params?.operable_openings],
  )

  // Detect legacy state that would synthesise something useful — used to
  // surface the "Convert legacy → native" CTA. Native takes precedence;
  // we only show the CTA when operable_openings is empty AND the legacy
  // schedule + at least one openable_fraction would synthesise rows.
  const legacyPreview = useMemo(() => {
    if (openings.length > 0) return []
    return synthesiseOperableOpeningsFromLegacy(params ?? {})
  }, [openings.length, params])

  // ── List ops (always overwrite operable_openings wholesale) ────────────
  const writeList = (next) => updateParam('operable_openings', next)

  const addOpening = (type, facade) => {
    const entry = { ...newOpening(type, facade), id: nextId(openings, type, facade) }
    const next = [...openings, entry]
    writeList(next)
    setSelectedOpeningId(entry.id)
  }

  const updateOpening = (id, partial) => {
    const next = openings.map(o => o.id === id ? deepMergeOpening(o, partial) : o)
    writeList(next)
  }

  const deleteOpening = (id) => {
    const next = openings.filter(o => o.id !== id)
    writeList(next)
    if (selectedOpeningId === id) clearSelection()
  }

  const convertLegacy = () => {
    if (legacyPreview.length === 0) return
    // Strip the `_synthesised_from_legacy` marker before persisting — these
    // are now first-class native entries.
    const cleaned = legacyPreview.map(({ _synthesised_from_legacy, ...rest }) => rest)
    writeList(cleaned)
  }

  return (
    <div className="h-full overflow-y-auto bg-off-white">
      {/* Module header with operation accent */}
      <div
        className="bg-white border-b border-light-grey px-6 pt-3 pb-3"
        style={{ borderTopWidth: '3px', borderTopColor: ACCENT, borderTopStyle: 'solid' }}
      >
        <NavLink to="/project" className="text-xxs text-mid-grey hover:text-navy transition-colors">
          ← Overview
        </NavLink>
        <p className="text-caption font-medium mt-0.5" style={{ color: ACCENT }}>Operation</p>
        <p className="text-xxs text-mid-grey">
          Operable openings — doors, windows, vents — defined per opening with
          their own control mode (always / scheduled / temperature-triggered).
        </p>
      </div>

      {/* Two-column layout: list panel on left, 3D viewer on right ──────── */}
      <div className="flex gap-6 px-6 py-6 max-w-[1400px] mx-auto items-start">
        {/* Panel column ─────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Legacy conversion CTA (only when operable_openings empty + legacy
              would synthesise something) ─────────────────────────────────── */}
          {openings.length === 0 && legacyPreview.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-caption font-medium text-amber-900 mb-1">
                Legacy operable-window settings detected
              </p>
              <p className="text-xxs text-amber-800 mb-3">
                This project uses the pre-Brief 28e per-facade <code>openable_fraction</code> +
                building-wide schedule. The engine still reads these correctly via
                compute-time synthesis, but to edit individual openings (different
                schedules per facade, doors, temperature triggers) convert them to
                first-class entries here. The {legacyPreview.length} synthesised{' '}
                {legacyPreview.length === 1 ? 'entry' : 'entries'} will be persisted:
              </p>
              <ul className="text-xxs text-amber-800 mb-3 space-y-0.5 ml-4 list-disc">
                {legacyPreview.map(p => (
                  <li key={p.id}>
                    <span className="font-medium">{p.name}</span>
                    {' '}— {p.area_m2.toFixed(2)} m² on {facadeLabelByKey(p.facade, orientation)},
                    schedule <code>{p.control.schedule_ref}</code>
                  </li>
                ))}
              </ul>
              <button
                onClick={convertLegacy}
                className="text-xs px-3 py-1.5 rounded bg-amber-700 text-white hover:bg-amber-800 transition-colors"
              >
                Convert {legacyPreview.length} legacy{' '}
                {legacyPreview.length === 1 ? 'entry' : 'entries'} to native
              </button>
            </div>
          )}

          {/* Operable openings list ────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-light-grey p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-caption font-semibold text-navy">Operable openings</p>
                <p className="text-xxs text-mid-grey">
                  {openings.length === 0
                    ? 'No operable openings yet — add a door, window bank, or vent below.'
                    : `${openings.length} ${openings.length === 1 ? 'entry' : 'entries'}.`}
                </p>
              </div>
              <div className="flex gap-1.5">
                {OPENING_TYPE_OPTIONS.map(t => (
                  <button
                    key={t.value}
                    onClick={() => addOpening(t.value, 'south')}
                    className="text-xxs px-2.5 py-1 rounded border border-cyan-700 text-cyan-700 hover:bg-cyan-50 transition-colors"
                    title={`Add a new ${t.label.toLowerCase()} (default south facade — change in editor)`}
                  >
                    + {t.label}
                  </button>
                ))}
              </div>
            </div>

            {openings.length === 0 && legacyPreview.length === 0 && (
              <div className="text-xxs text-mid-grey text-center py-8 border border-dashed border-light-grey rounded-lg">
                Use the buttons above to add your first opening.
              </div>
            )}

            <div className="space-y-2">
              {openings.map(opening => (
                <OpeningRow
                  key={opening.id}
                  opening={opening}
                  selected={selectedOpeningId === opening.id}
                  orientation={orientation}
                  onSelect={() => setSelectedOpeningId(opening.id)}
                  onUpdate={partial => updateOpening(opening.id, partial)}
                  onDelete={() => deleteOpening(opening.id)}
                />
              ))}
            </div>
          </div>

          {/* Footer note ─────────────────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-light-grey p-5">
            <p className="text-xxs text-mid-grey">
              <span className="font-medium text-dark-grey">Where things live:</span> Permanent
              envelope openings (louvres, trickle vents) and site exposure stay in{' '}
              <NavLink to="/building" className="text-navy underline">Building → Permanent openings</NavLink>
              {' '}— they're always-open geometry, distinct from operable. Occupancy schedules sit in{' '}
              <NavLink to="/gains" className="text-navy underline">Internal Gains</NavLink>.
              Mechanical ventilation (MEV / MVHR) lives in{' '}
              <NavLink to="/systems" className="text-navy underline">Systems</NavLink>.
            </p>
          </div>
        </div>

        {/* 3D viewer column ─────────────────────────────────────────────── */}
        <div className="hidden lg:block w-[480px] flex-shrink-0 sticky top-6">
          <div className="bg-white rounded-xl border border-light-grey overflow-hidden"
               style={{ height: '560px' }}>
            <BuildingViewer3D params={params ?? {}} />
          </div>
          <p className="text-xxs text-mid-grey mt-2 px-1">
            3D preview. Per-opening highlighting + bidirectional click selection
            comes in Brief 28e Gate E5b.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ── Per-opening collapsible row ────────────────────────────────────────── */
function OpeningRow({ opening, selected, orientation, onSelect, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const ctl = opening.control ?? {}
  const mode = ctl.mode ?? 'permanent'

  const modeBadgeClass =
    mode === 'permanent'   ? 'bg-mid-grey/15 text-dark-grey'      :
    mode === 'scheduled'   ? 'bg-cyan-700/15 text-cyan-800'        :
                             'bg-amber-600/15 text-amber-800'

  const summary = useMemo(() => {
    const a = opening.area_m2 ?? 0
    const h = opening.height_m ?? 0
    return `${a.toFixed(2)} m² × ${h.toFixed(2)} m tall on ${facadeLabelByKey(opening.facade, orientation)}`
  }, [opening.area_m2, opening.height_m, opening.facade, orientation])

  return (
    <div
      className={`rounded-lg border transition-colors ${
        selected
          ? 'border-cyan-700 ring-1 ring-cyan-700/30 bg-cyan-50/30'
          : 'border-light-grey bg-white hover:border-mid-grey'
      }`}
    >
      {/* Header row — clickable to select + expand toggle ──────────────── */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => { onSelect(); setExpanded(e => !e) }}
          className="flex-1 flex items-center gap-2 text-left min-w-0"
        >
          <span className={`text-xxs px-1.5 py-0.5 rounded ${modeBadgeClass} flex-shrink-0 capitalize`}>
            {mode}
          </span>
          <span className="text-caption text-navy font-medium truncate">{opening.name || opening.id}</span>
          <span className="text-xxs text-mid-grey truncate hidden sm:inline">— {summary}</span>
        </button>
        <button
          onClick={() => { onSelect(); setExpanded(e => !e) }}
          className="text-xxs text-mid-grey hover:text-navy px-1.5 py-0.5"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▴' : '▾'}
        </button>
        <button
          onClick={() => {
            if (window.confirm(`Delete "${opening.name || opening.id}"?`)) onDelete()
          }}
          className="text-xxs text-error hover:underline px-1.5 py-0.5"
          title="Delete this opening"
        >
          ✕
        </button>
      </div>

      {/* Expanded editor ─────────────────────────────────────────────────── */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-light-grey">
          {/* Name + facade + opening type ─────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <LabeledInput
              label="Name"
              value={opening.name ?? ''}
              onChange={v => onUpdate({ name: v })}
              placeholder="Main entrance door"
            />
            <LabeledSelect
              label="Facade"
              value={opening.facade ?? 'south'}
              onChange={v => onUpdate({
                facade: v,
                parent_glazing_face: opening.parent_glazing_face != null ? v : null,
              })}
              options={FACADES.map(f => ({ value: f.key, label: facadeLabel(f.num, orientation) }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <LabeledSelect
              label="Opening type"
              value={opening.opening_type ?? 'window'}
              onChange={v => onUpdate({
                opening_type: v,
                parent_glazing_face: v === 'window' ? (opening.facade ?? 'south') : null,
              })}
              options={OPENING_TYPE_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
            />
            <LabeledCheckbox
              label="Consumes glazing on parent facade"
              checked={opening.parent_glazing_face != null}
              onChange={c => onUpdate({ parent_glazing_face: c ? (opening.facade ?? 'south') : null })}
              hint="Doors leave this off (they add envelope area). Operable window banks on top of an existing glazed facade leave this on."
            />
          </div>

          {/* Geometry — area + height ───────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <LabeledNumber
              label="Area (m²)"
              value={opening.area_m2 ?? 0}
              onChange={v => onUpdate({ area_m2: v })}
              min={0} step={0.1}
              hint="Total open area when this opening is open."
            />
            <LabeledNumber
              label="Height (m)"
              value={opening.height_m ?? 0}
              onChange={v => onUpdate({ height_m: v })}
              min={0} step={0.1}
              hint="Stack-effect lever arm — top of opening minus bottom."
            />
          </div>

          {/* Advanced — Cd + Cw ─────────────────────────────────────────── */}
          <div>
            <button
              onClick={() => setShowAdvanced(s => !s)}
              className="text-xxs text-mid-grey hover:text-navy underline"
            >
              {showAdvanced ? 'Hide' : 'Show'} advanced coefficients
            </button>
            {showAdvanced && (
              <div className="grid grid-cols-2 gap-3 mt-2">
                <LabeledNumber
                  label="Discharge coefficient Cd"
                  value={opening.discharge_coefficient ?? 0.6}
                  onChange={v => onUpdate({ discharge_coefficient: v })}
                  min={0} max={1} step={0.05}
                  hint="Typically 0.6 for sharp-edged openings."
                />
                <LabeledNumber
                  label="Wind coefficient Cw"
                  value={opening.wind_coefficient ?? 0.25}
                  onChange={v => onUpdate({ wind_coefficient: v })}
                  min={0} max={1} step={0.05}
                  hint="BS 5925 typical: 0.25 for sheltered/door, 0.40 for openable window."
                />
              </div>
            )}
          </div>

          {/* Control mode ──────────────────────────────────────────────── */}
          <div className="pt-2 border-t border-light-grey">
            <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Control</p>
            <LabeledSelect
              label="Mode"
              value={mode}
              onChange={v => onUpdate({ control: { ...ctl, mode: v } })}
              options={[
                { value: 'permanent',   label: 'Permanent — always open' },
                { value: 'scheduled',   label: 'Scheduled — opens per schedule' },
                { value: 'temperature', label: 'Temperature-triggered — opens when zone too warm' },
              ]}
            />

            {(mode === 'scheduled' || mode === 'temperature') && (
              <div className="mt-2">
                <LabeledSelect
                  label={mode === 'temperature' ? 'Schedule (AND-combined with temperature gate)' : 'Schedule'}
                  value={ctl.schedule_ref ?? 'always_on'}
                  onChange={v => onUpdate({ control: { ...ctl, schedule_ref: v } })}
                  options={SCHEDULE_OPTIONS}
                />
              </div>
            )}

            {mode === 'temperature' && (
              <div className="space-y-2 mt-2">
                <div className="grid grid-cols-2 gap-3">
                  <LabeledNumber
                    label="Open above zone T (°C)"
                    value={ctl.open_above_zone_c ?? 22}
                    onChange={v => onUpdate({ control: { ...ctl, open_above_zone_c: v } })}
                    min={10} max={30} step={0.5}
                  />
                  <LabeledNumber
                    label="Hysteresis (°C)"
                    value={ctl.hysteresis_c ?? 1.0}
                    onChange={v => onUpdate({ control: { ...ctl, hysteresis_c: v } })}
                    min={0} max={5} step={0.5}
                    hint="Re-closes when zone drops below (open − hysteresis)."
                  />
                </div>
                <LabeledCheckbox
                  label="Only open if outside air is cooler than the zone"
                  checked={!!ctl.require_outside_cooler}
                  onChange={c => onUpdate({ control: { ...ctl, require_outside_cooler: c } })}
                  hint="Prevents opening when outdoor air would heat the zone further."
                />
                <p className="text-xxs text-mid-grey italic pt-1">
                  Note: EnergyPlus has no hysteresis on its temperature gate (each
                  timestep is independent) and approximates <code>require_outside_cooler</code>
                  via <code>maximum_outdoor_temperature</code>. Bridgewater uses scheduled
                  mode so this is moot; matters for projects actively using
                  temperature-mode interventions. See <code>docs/validation/brief_28e_validation.md</code>.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Small labelled-input primitives ────────────────────────────────────── */
function LabeledInput({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="block text-xxs text-mid-grey mb-1">{label}</label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-cyan-700"
      />
    </div>
  )
}

function LabeledNumber({ label, value, onChange, min, max, step, hint }) {
  return (
    <div>
      <label className="block text-xxs text-mid-grey mb-1">{label}</label>
      <input
        type="number"
        value={value}
        min={min} max={max} step={step}
        onChange={e => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
        className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-cyan-700 tabular-nums"
      />
      {hint && <p className="text-xxs text-mid-grey/80 mt-1">{hint}</p>}
    </div>
  )
}

function LabeledSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-xxs text-mid-grey mb-1">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-cyan-700 cursor-pointer"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function LabeledCheckbox({ label, checked, onChange, hint }) {
  return (
    <div>
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          className="accent-cyan-700 w-3.5 h-3.5 mt-0.5 flex-shrink-0"
        />
        <span className="text-xxs text-navy">{label}</span>
      </label>
      {hint && <p className="text-xxs text-mid-grey/80 mt-0.5 ml-5">{hint}</p>}
    </div>
  )
}

/* ── deepMergeOpening: merge partial updates into an opening with the
       nested `control` object handled correctly. ────────────────────────── */
function deepMergeOpening(current, partial) {
  const out = { ...current, ...partial }
  if (partial.control) {
    out.control = { ...(current.control ?? {}), ...partial.control }
  }
  return out
}
