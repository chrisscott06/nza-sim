/**
 * ScenarioEditor.jsx
 *
 * Inline editor for a non-baseline scenario. Shows construction dropdowns,
 * key systems parameters, and live changes_from_baseline comparison.
 *
 * Auto-saves changes via PUT API (500ms debounce).
 * Calls onDone() to return to the summary view.
 */

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Loader2 } from 'lucide-react'

// ── API helpers ────────────────────────────────────────────────────────────────

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }))
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

// ── Construction elements ──────────────────────────────────────────────────────

const CONSTRUCTION_ELEMENTS = [
  { key: 'external_wall', label: 'External Wall' },
  { key: 'roof',          label: 'Roof' },
  { key: 'ground_floor',  label: 'Ground Floor' },
  { key: 'glazing',       label: 'Glazing' },
]

const SYSTEM_FIELDS = [
  { key: 'hvac_type',        label: 'HVAC System',       type: 'system-select', category: 'hvac' },
  { key: 'ventilation_type', label: 'Ventilation',        type: 'system-select', category: 'ventilation' },
  { key: 'dhw_primary',      label: 'DHW Primary',        type: 'system-select', category: 'dhw' },
  { key: 'dhw_preheat',      label: 'DHW Preheat',        type: 'system-select', category: 'dhw' },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function categoryLabel(cat) {
  if (cat === 'construction') return 'Fabric'
  if (cat === 'systems')      return 'Systems'
  if (cat === 'building')     return 'Building'
  return cat
}

function paramLabel(param) {
  return param.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Field components ───────────────────────────────────────────────────────────

function FieldRow({ label, baselineValue, currentValue, children }) {
  const changed = baselineValue !== undefined && baselineValue !== currentValue
  return (
    <div className={`py-2.5 border-b border-light-grey last:border-0 ${changed ? 'bg-teal/5' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="w-32 flex-shrink-0">
          <p className="text-xxs font-medium text-dark-grey pt-1">{label}</p>
          {changed && baselineValue != null && (
            <p className="text-xxs text-mid-grey mt-0.5 line-through">{String(baselineValue)}</p>
          )}
        </div>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  )
}

function SelectField({ value, options, onChange, placeholder = '— select —' }) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value || null)}
      className="
        w-full px-2 py-1.5 text-caption text-navy
        border border-light-grey rounded bg-white
        focus:outline-none focus:border-teal transition-colors
        appearance-none cursor-pointer
      "
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2395A5A6' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 8px center',
        paddingRight: '28px',
      }}
    >
      <option value="">{placeholder}</option>
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  )
}

function SliderField({ value, min, max, step, unit, onChange }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value ?? min}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 accent-teal"
      />
      <span className="text-caption font-medium text-navy w-16 text-right">
        {value ?? min} {unit}
      </span>
    </div>
  )
}

// ── Change list ────────────────────────────────────────────────────────────────

function LiveChangeList({ changes }) {
  if (changes.length === 0) {
    return (
      <p className="text-xxs text-mid-grey italic">No changes from baseline yet.</p>
    )
  }
  return (
    <div className="space-y-1">
      {changes.map((c, i) => (
        <div key={i} className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xxs text-mid-grey">{categoryLabel(c.category)} /</span>
          <span className="text-xxs font-medium text-dark-grey">{paramLabel(c.parameter)}:</span>
          <span className="text-xxs text-mid-grey line-through">{c.baseline_display}</span>
          <ArrowRight size={10} className="text-mid-grey flex-shrink-0" />
          <span className="text-xxs font-semibold text-teal">{c.scenario_display}</span>
        </div>
      ))}
    </div>
  )
}

// ── ScenarioEditor ─────────────────────────────────────────────────────────────

export default function ScenarioEditor({ scenario, baseline, projectId, onDone, onScenarioUpdated }) {
  // Local editable copies of the config sections
  const [constructions, setConstructions] = useState({ ...scenario.construction_choices })
  const [systems, setSystems]             = useState({ ...scenario.systems_config })

  // Library data
  const [constructionLib, setConstructionLib] = useState([])
  const [systemLib, setSystemLib]             = useState([])

  // Changes list (updated after each save)
  const [changes, setChanges] = useState(scenario.changes_from_baseline ?? [])

  // Save status
  const [saveStatus, setSaveStatus] = useState('idle') // 'idle' | 'saving' | 'saved'
  const debounceRef = useRef(null)

  // ── Load library data ─────────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/library/constructions')
      .then(r => r.json())
      .then(d => setConstructionLib(d.constructions ?? []))
      .catch(() => {})

    fetch('/api/library/systems')
      .then(r => r.json())
      .then(d => setSystemLib(d.systems ?? []))
      .catch(() => {})
  }, [])

  // ── Auto-save ─────────────────────────────────────────────────────────────

  function scheduleUpdate(updatedConstructions, updatedSystems) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSaveStatus('saving')

    debounceRef.current = setTimeout(async () => {
      try {
        const updated = await apiFetch(
          `/api/projects/${projectId}/scenarios/${scenario.id}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              construction_choices: updatedConstructions,
              systems_config: updatedSystems,
            }),
          }
        )
        setChanges(updated.changes_from_baseline ?? [])
        setSaveStatus('saved')
        onScenarioUpdated(updated)
        setTimeout(() => setSaveStatus('idle'), 1500)
      } catch (err) {
        console.error('[ScenarioEditor] Save failed:', err)
        setSaveStatus('idle')
      }
    }, 500)
  }

  function updateConstruction(key, value) {
    const next = { ...constructions, [key]: value }
    setConstructions(next)
    scheduleUpdate(next, systems)
  }

  function updateSystem(key, value) {
    const next = { ...systems, [key]: value }
    setSystems(next)
    scheduleUpdate(constructions, next)
  }

  // ── Derived data ───────────────────────────────────────────────────────────

  const baselineCC  = baseline?.construction_choices ?? {}
  const baselineSys = baseline?.systems_config ?? {}

  // Group systems by category for filtering
  function systemOptions(category) {
    return systemLib
      .filter(s => !category || s.category === category)
      .map(s => ({ value: s.name, label: s.display_name || s.name }))
  }

  function constructionOptions() {
    return constructionLib.map(c => ({
      value: c.name,
      label: c.display_name || c.description || c.name,
    }))
  }

  function uValue(name) {
    const c = constructionLib.find(x => x.name === name)
    return c?.u_value_W_per_m2K != null ? `U = ${Number(c.u_value_W_per_m2K).toFixed(2)}` : null
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-heading font-semibold text-navy">Edit: {scenario.name}</h1>
          <p className="text-caption text-mid-grey mt-0.5">
            Changes are auto-saved and compared against the baseline.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveStatus === 'saving' && (
            <span className="flex items-center gap-1 text-xxs text-mid-grey">
              <Loader2 size={11} className="animate-spin" /> Saving…
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1 text-xxs text-green-600">
              <Check size={11} /> Saved
            </span>
          )}
          <button
            className="px-3 py-1.5 rounded bg-navy text-white text-xxs font-medium hover:bg-navy/80 transition-colors"
            onClick={onDone}
          >
            Done Editing
          </button>
        </div>
      </div>

      {/* Live changes list */}
      <div className="bg-teal/5 border border-teal/20 rounded-xl p-4">
        <p className="text-caption font-semibold text-navy mb-2">
          {changes.length === 0
            ? 'No changes from baseline'
            : `${changes.length} change${changes.length !== 1 ? 's' : ''} from baseline`}
        </p>
        <LiveChangeList changes={changes} />
      </div>

      {/* Fabric */}
      <div className="bg-white rounded-xl border border-light-grey p-4">
        <p className="text-caption font-semibold text-navy mb-1">Fabric</p>
        <p className="text-xxs text-mid-grey mb-3">
          Strikethrough shows the baseline value where it differs.
        </p>
        {CONSTRUCTION_ELEMENTS.map(el => {
          const currentVal = constructions[el.key]
          const baselineVal = baselineCC[el.key]
          const u = uValue(currentVal)
          return (
            <FieldRow
              key={el.key}
              label={el.label}
              baselineValue={baselineVal}
              currentValue={currentVal}
            >
              <SelectField
                value={currentVal}
                options={constructionOptions()}
                onChange={val => updateConstruction(el.key, val)}
              />
              {u && <p className="text-xxs text-mid-grey mt-1">{u} W/m²K</p>}
            </FieldRow>
          )
        })}
      </div>

      {/* Systems */}
      <div className="bg-white rounded-xl border border-light-grey p-4">
        <p className="text-caption font-semibold text-navy mb-1">Systems</p>
        <p className="text-xxs text-mid-grey mb-3">
          Strikethrough shows the baseline value where it differs.
        </p>

        {/* Simulation mode toggle */}
        <FieldRow
          label="Sim Mode"
          baselineValue={baselineSys.mode}
          currentValue={systems.mode}
        >
          <div className="flex gap-1.5">
            {[
              { v: 'detailed', l: 'Detailed' },
              { v: 'ideal',    l: 'Ideal Loads' },
            ].map(opt => (
              <button
                key={opt.v}
                onClick={() => updateSystem('mode', opt.v)}
                className={`px-2 py-1 text-xxs rounded border transition-colors ${
                  systems.mode === opt.v
                    ? 'bg-teal text-white border-teal'
                    : 'bg-white text-mid-grey border-light-grey hover:border-teal'
                }`}
              >
                {opt.l}
              </button>
            ))}
          </div>
          {systems.mode === 'ideal' && (
            <p className="text-xxs text-amber-600 mt-1">⚠ Ideal Loads bypasses real HVAC — EUI will be unrealistically low</p>
          )}
        </FieldRow>

        {SYSTEM_FIELDS.map(field => {
          const currentVal = systems[field.key]
          const baselineVal = baselineSys[field.key]
          return (
            <FieldRow
              key={field.key}
              label={field.label}
              baselineValue={baselineVal}
              currentValue={currentVal}
            >
              <SelectField
                value={currentVal}
                options={systemOptions(field.category)}
                onChange={val => updateSystem(field.key, val)}
              />
            </FieldRow>
          )
        })}

        {/* Natural ventilation toggle */}
        <FieldRow
          label="Natural Vent"
          baselineValue={baselineSys.natural_ventilation}
          currentValue={systems.natural_ventilation}
        >
          <div className="flex items-center gap-2 py-1">
            <button
              className={`relative w-9 h-5 rounded-full transition-colors ${
                systems.natural_ventilation ? 'bg-teal' : 'bg-light-grey'
              }`}
              onClick={() => updateSystem('natural_ventilation', !systems.natural_ventilation)}
              aria-checked={systems.natural_ventilation}
              role="switch"
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  systems.natural_ventilation ? 'translate-x-4' : ''
                }`}
              />
            </button>
            <span className="text-xxs text-dark-grey">
              {systems.natural_ventilation ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </FieldRow>

        {/* LPD slider */}
        <FieldRow
          label="Lighting (LPD)"
          baselineValue={baselineSys.lighting_power_density}
          currentValue={systems.lighting_power_density}
        >
          <SliderField
            value={systems.lighting_power_density}
            min={3}
            max={20}
            step={0.5}
            unit="W/m²"
            onChange={val => updateSystem('lighting_power_density', val)}
          />
        </FieldRow>
      </div>
    </div>
  )
}
