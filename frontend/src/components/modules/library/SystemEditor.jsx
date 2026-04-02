/**
 * SystemEditor.jsx
 *
 * Modal editor for creating custom system templates in the library.
 * Accepts an optional initialItem for the duplicate workflow.
 */

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'

// ── System type definitions ───────────────────────────────────────────────────

const SYSTEM_TYPES = [
  { value: 'vrf',              label: 'VRF',                category: 'hvac'        },
  { value: 'ashp',             label: 'ASHP (Space Heating)', category: 'hvac'      },
  { value: 'gas_boiler',       label: 'Gas Boiler',          category: 'hvac'       },
  { value: 'ashp_dhw',         label: 'ASHP (DHW)',           category: 'dhw'        },
  { value: 'gas_boiler_dhw',   label: 'Gas Boiler (DHW)',     category: 'dhw'        },
  { value: 'mev',              label: 'MEV',                  category: 'ventilation' },
  { value: 'mvhr',             label: 'MVHR',                 category: 'ventilation' },
  { value: 'natural_ventilation', label: 'Natural Ventilation', category: 'ventilation' },
]

// Default parameter values per system type
const TYPE_DEFAULTS = {
  vrf:              { heating_cop: 3.5, cooling_eer: 3.2, fan_power_w_per_m2: 3.0, min_outdoor_temp_c: -15.0, fuel_type: 'electricity' },
  ashp:             { heating_cop: 3.0, cooling_eer: null, fan_power_w_per_m2: 2.0, min_outdoor_temp_c: -10.0, fuel_type: 'electricity' },
  gas_boiler:       { efficiency: 0.92, heating_cop: 0.92, fuel_type: 'gas' },
  ashp_dhw:         { heating_cop: 2.8, hot_water_setpoint_c: 60, fuel_type: 'electricity' },
  gas_boiler_dhw:   { efficiency: 0.90, fuel_type: 'gas' },
  mev:              { specific_fan_power: 0.8, fuel_type: 'electricity' },
  mvhr:             { specific_fan_power: 1.2, heat_recovery_efficiency: 0.85, fuel_type: 'electricity' },
  natural_ventilation: { opening_threshold_c: 22, max_opening_fraction: 0.5, fuel_type: 'none' },
}

// ── Field component ───────────────────────────────────────────────────────────

function FieldRow({ label, note, children }) {
  return (
    <div>
      <label className="text-xxs uppercase tracking-wider text-mid-grey block mb-1">{label}</label>
      {children}
      {note && <p className="text-xxs text-mid-grey mt-0.5">{note}</p>}
    </div>
  )
}

function NumberInput({ value, onChange, min, max, step, unit }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={min} max={max} step={step ?? 0.1}
        value={value ?? ''}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="flex-1 px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal"
      />
      {unit && <span className="text-xxs text-mid-grey whitespace-nowrap">{unit}</span>}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SystemEditor({ initialItem = null, onSave, onClose }) {
  const [name,        setName]        = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [systemType,  setSystemType]  = useState('vrf')
  const [params,      setParams]      = useState({ ...TYPE_DEFAULTS.vrf })
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState(null)

  // Pre-populate from initialItem
  useEffect(() => {
    if (!initialItem) return
    const cfg = initialItem.config_json ?? {}
    setName(`${initialItem.name}_copy`)
    setDisplayName(`${initialItem.display_name || initialItem.name} (Copy)`)
    setDescription(cfg.description ?? '')
    const type = cfg.type ?? 'vrf'
    setSystemType(type)
    // Build params from cfg, falling back to defaults
    const defaults = TYPE_DEFAULTS[type] ?? {}
    setParams({
      ...defaults,
      heating_cop:             cfg.heating_cop ?? cfg.cop ?? defaults.heating_cop,
      cooling_eer:             cfg.cooling_eer ?? cfg.eer ?? defaults.cooling_eer,
      fan_power_w_per_m2:      cfg.fan_power_w_per_m2 ?? defaults.fan_power_w_per_m2,
      min_outdoor_temp_c:      cfg.min_outdoor_temp_c ?? defaults.min_outdoor_temp_c,
      efficiency:              cfg.efficiency ?? defaults.efficiency,
      specific_fan_power:      cfg.specific_fan_power ?? cfg.fan_power_W_per_ls ?? defaults.specific_fan_power,
      heat_recovery_efficiency: cfg.heat_recovery_efficiency ?? defaults.heat_recovery_efficiency,
      hot_water_setpoint_c:    cfg.hot_water_setpoint_c ?? defaults.hot_water_setpoint_c,
      opening_threshold_c:     cfg.opening_threshold_c ?? defaults.opening_threshold_c,
      max_opening_fraction:    cfg.max_opening_fraction ?? defaults.max_opening_fraction,
      fuel_type:               cfg.fuel_type ?? defaults.fuel_type ?? 'electricity',
    })
  }, [])

  function handleTypeChange(type) {
    setSystemType(type)
    setParams({ ...TYPE_DEFAULTS[type] ?? {} })
  }

  function setParam(key, value) {
    setParams(p => ({ ...p, [key]: value }))
  }

  async function handleSave() {
    if (!name.trim()) { setError('Name is required'); return }
    setError(null)
    setSaving(true)

    const typeDef = SYSTEM_TYPES.find(t => t.value === systemType)
    const config = {
      name:         name.trim(),
      display_name: displayName.trim() || name.trim(),
      description:  description.trim(),
      type:         systemType,
      category:     typeDef?.category ?? 'hvac',
      // Map to the field names the assembler and UI expect
      cop:          params.heating_cop,
      eer:          params.cooling_eer,
      heating_cop:  params.heating_cop,
      cooling_eer:  params.cooling_eer,
      efficiency:   params.efficiency,
      fan_power_w_per_m2:       params.fan_power_w_per_m2,
      fan_power_W_per_ls:       params.specific_fan_power,
      specific_fan_power:       params.specific_fan_power,
      heat_recovery_efficiency: params.heat_recovery_efficiency,
      min_outdoor_temp_c:       params.min_outdoor_temp_c,
      hot_water_setpoint_c:     params.hot_water_setpoint_c,
      fuel_type:    params.fuel_type,
    }

    try {
      const res = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          library_type: 'system',
          name:         name.trim(),
          display_name: displayName.trim() || name.trim(),
          description:  description.trim(),
          config_json:  config,
        }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? `HTTP ${res.status}`)
      }
      const created = await res.json()
      onSave(created)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-8">
      <div className="bg-white rounded-xl shadow-xl border border-light-grey w-full max-w-md mx-4">
        {/* Header */}
        <div className="px-5 py-4 border-b border-light-grey flex items-center justify-between">
          <div>
            <h2 className="text-section font-semibold text-navy">
              {initialItem ? 'Duplicate System' : 'New System Template'}
            </h2>
            <p className="text-xxs text-mid-grey mt-0.5">
              {initialItem ? `Editing a copy of ${initialItem.display_name || initialItem.name}` : 'Create a custom system for use in simulations'}
            </p>
          </div>
          <button onClick={onClose} className="text-mid-grey hover:text-navy">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Name and type */}
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Name (internal)">
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value.replace(/\s+/g, '_').toLowerCase())}
                placeholder="e.g. vrf_ultra_2030"
                className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal"
              />
            </FieldRow>
            <FieldRow label="System type">
              <select
                value={systemType}
                onChange={e => handleTypeChange(e.target.value)}
                className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-teal appearance-none"
              >
                {SYSTEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </FieldRow>
          </div>

          <FieldRow label="Display name">
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="e.g. Ultra-Efficient VRF (2030)"
              className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal"
            />
          </FieldRow>

          {/* Type-specific parameters */}
          <div className="bg-off-white rounded-lg border border-light-grey p-4 space-y-3">
            <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">Performance parameters</p>

            {/* VRF */}
            {systemType === 'vrf' && <>
              <FieldRow label="Heating COP" note="Typical range: 3.0–5.0">
                <NumberInput value={params.heating_cop} onChange={v => setParam('heating_cop', v)} min={1} max={7} step={0.1} unit="W/W" />
              </FieldRow>
              <FieldRow label="Cooling EER" note="Typical range: 2.5–5.0">
                <NumberInput value={params.cooling_eer} onChange={v => setParam('cooling_eer', v)} min={1} max={7} step={0.1} unit="W/W" />
              </FieldRow>
              <FieldRow label="Fan power">
                <NumberInput value={params.fan_power_w_per_m2} onChange={v => setParam('fan_power_w_per_m2', v)} min={0.5} max={8} step={0.5} unit="W/m²" />
              </FieldRow>
              <FieldRow label="Min outdoor temp">
                <NumberInput value={params.min_outdoor_temp_c} onChange={v => setParam('min_outdoor_temp_c', v)} min={-25} max={5} step={1} unit="°C" />
              </FieldRow>
            </>}

            {/* ASHP space heating */}
            {systemType === 'ashp' && <>
              <FieldRow label="Heating COP" note="Typical range: 2.5–4.5">
                <NumberInput value={params.heating_cop} onChange={v => setParam('heating_cop', v)} min={1} max={7} step={0.1} unit="W/W" />
              </FieldRow>
              <FieldRow label="Fan power">
                <NumberInput value={params.fan_power_w_per_m2} onChange={v => setParam('fan_power_w_per_m2', v)} min={0.5} max={8} step={0.5} unit="W/m²" />
              </FieldRow>
              <FieldRow label="Min outdoor temp">
                <NumberInput value={params.min_outdoor_temp_c} onChange={v => setParam('min_outdoor_temp_c', v)} min={-25} max={5} step={1} unit="°C" />
              </FieldRow>
            </>}

            {/* Gas Boiler */}
            {systemType === 'gas_boiler' && <>
              <FieldRow label="Seasonal efficiency" note="Condensing: 88–95%, Non-condensing: 70–82%">
                <NumberInput value={Math.round((params.efficiency ?? 0.92) * 100)} onChange={v => { setParam('efficiency', v / 100); setParam('heating_cop', v / 100) }} min={60} max={99} step={1} unit="%" />
              </FieldRow>
            </>}

            {/* ASHP DHW */}
            {systemType === 'ashp_dhw' && <>
              <FieldRow label="DHW COP" note="Typical range: 2.5–4.0">
                <NumberInput value={params.heating_cop} onChange={v => setParam('heating_cop', v)} min={1} max={6} step={0.1} unit="W/W" />
              </FieldRow>
              <FieldRow label="Hot water setpoint">
                <NumberInput value={params.hot_water_setpoint_c} onChange={v => setParam('hot_water_setpoint_c', v)} min={50} max={70} step={1} unit="°C" />
              </FieldRow>
            </>}

            {/* Gas Boiler DHW */}
            {systemType === 'gas_boiler_dhw' && <>
              <FieldRow label="Efficiency">
                <NumberInput value={Math.round((params.efficiency ?? 0.90) * 100)} onChange={v => setParam('efficiency', v / 100)} min={60} max={99} step={1} unit="%" />
              </FieldRow>
            </>}

            {/* MEV */}
            {systemType === 'mev' && <>
              <FieldRow label="Specific fan power" note="CIBSE Guide B: MEV 0.5–1.5 W/(l/s)">
                <NumberInput value={params.specific_fan_power} onChange={v => setParam('specific_fan_power', v)} min={0.3} max={3.0} step={0.1} unit="W/(l/s)" />
              </FieldRow>
            </>}

            {/* MVHR */}
            {systemType === 'mvhr' && <>
              <FieldRow label="Specific fan power" note="CIBSE Guide B: MVHR 1.0–2.0 W/(l/s)">
                <NumberInput value={params.specific_fan_power} onChange={v => setParam('specific_fan_power', v)} min={0.5} max={3.0} step={0.1} unit="W/(l/s)" />
              </FieldRow>
              <FieldRow label="Heat recovery efficiency" note="Typical range: 75–95%">
                <NumberInput value={Math.round((params.heat_recovery_efficiency ?? 0.85) * 100)} onChange={v => setParam('heat_recovery_efficiency', v / 100)} min={50} max={99} step={1} unit="%" />
              </FieldRow>
            </>}

            {/* Natural ventilation */}
            {systemType === 'natural_ventilation' && <>
              <FieldRow label="Opening threshold" note="Windows open when indoor temp exceeds this">
                <NumberInput value={params.opening_threshold_c} onChange={v => setParam('opening_threshold_c', v)} min={16} max={30} step={1} unit="°C" />
              </FieldRow>
              <FieldRow label="Max opening fraction" note="Fraction of window area that can open (0–1)">
                <NumberInput value={params.max_opening_fraction} onChange={v => setParam('max_opening_fraction', Math.min(1, Math.max(0, v)))} min={0.05} max={1.0} step={0.05} />
              </FieldRow>
            </>}
          </div>

          {error && (
            <p className="text-xxs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-light-grey flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-caption text-mid-grey hover:text-navy">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-caption bg-navy text-white rounded-lg hover:bg-navy/80 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save to Library'}
          </button>
        </div>
      </div>
    </div>
  )
}
