/**
 * InterventionEditorBuildingView.jsx — Brief 41 Part 4
 *
 * Curated editor exposing the highest-value patch targets for the
 * Interventions module. Wraps a set of inputs that, on edit, capture
 * a patch via the `capture` callback rather than mutating the
 * ProjectContext baseline (audit doc §6 contract — baseline never
 * changes).
 *
 * Per Brief 41 Part 4 pragmatic scope (Chris-approved): this ships a
 * focused subset of edits rather than wrapping arbitrary main-app
 * components in a patch-capture context. The brief's full
 * "navigate-between-modules-inside-the-popout" affordance is deferred
 * to Brief 42 where the patch-granularity question (atomic-per-leaf
 * vs compound-per-key) can be designed properly.
 *
 * Section list:
 *   - Envelope: infiltration ACH, wall/roof/glazing construction
 *   - Internal Gains: occupancy rate, lighting load
 *   - Systems: per-system enable/efficiency/share for heating /
 *     cooling / DHW; ventilation SFP + sensible recovery; lighting
 *     control_mechanism + control_factor
 *
 * The `currentConfig` prop is the engine-quartet AFTER applying all
 * captured patches so far — the editor reads current values from it
 * (so the user sees the running edit state, not stale baseline).
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { newPatchId } from './patchCapture.js'

const CONTROL_OPTIONS = [
  { value: 'constant',         label: 'Constant (no control)',  factor: 1.00 },
  { value: 'daylight_dimming', label: 'Daylight dimming',       factor: 0.70 },
  { value: 'occupancy_sensors', label: 'Occupancy sensors',     factor: 0.85 },
  { value: 'both',             label: 'Daylight + occupancy',    factor: 0.55 },
]

function Section({ title, color = '#E84393', defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-light-grey rounded-lg bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-off-white/50 transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="text-xxs font-semibold uppercase tracking-wider" style={{ color }}>{title}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-light-grey">
          {children}
        </div>
      )}
    </div>
  )
}

function NumberInput({ label, value, onChange, unit, step = 0.01, min, max, placeholder }) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex-1 text-xxs text-mid-grey">{label}</label>
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        className="w-20 px-2 py-1 rounded border border-light-grey text-xxs tabular-nums text-right text-navy focus:outline-none focus:border-navy"
      />
      {unit && <span className="flex-shrink-0 text-xxs text-mid-grey w-12">{unit}</span>}
    </div>
  )
}

function SelectInput({ label, value, onChange, options, placeholder = '—' }) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex-1 text-xxs text-mid-grey">{label}</label>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="flex-shrink-0 w-48 px-2 py-1 rounded border border-light-grey text-xxs text-navy focus:outline-none focus:border-navy"
      >
        <option value="">{placeholder}</option>
        {options.map(o => (
          <option key={o.value ?? o} value={o.value ?? o}>
            {o.label ?? o}
          </option>
        ))}
      </select>
    </div>
  )
}

function ToggleInput({ label, value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex-1 text-xxs text-mid-grey">{label}</label>
      <button
        type="button"
        onClick={() => onChange(value === false)}
        className="flex-shrink-0 px-2 py-0.5 rounded text-xxs font-medium"
        style={{
          backgroundColor: value !== false ? '#DCFCE7' : '#E5E7EB',
          color: value !== false ? '#166534' : '#6B7280',
        }}
      >
        {value !== false ? 'enabled' : 'disabled'}
      </button>
    </div>
  )
}

function ServiceBlock({ system, service, capture }) {
  const sysId = system?.id
  if (!sysId) return null
  const baseHeating = service === 'heating' || service === 'cooling' || service === 'dhw'
  const baseVent    = service === 'ventilation'
  const baseLight   = service === 'lighting' || service === 'small_power'

  return (
    <div className="rounded border border-light-grey/70 bg-off-white/40 p-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xxs font-semibold text-navy truncate flex-1">{system.label || sysId}</span>
        <span className="text-xxs text-mid-grey/60 truncate" title={sysId}>{sysId}</span>
      </div>
      <ToggleInput
        label="Enabled"
        value={system.enabled !== false}
        onChange={(next) => capture({ id: newPatchId(), op: 'set', path: `building.systems_config_v40.${service}[id=${sysId}].enabled`, value: next, source: 'inline' })}
      />
      {baseHeating && (
        <>
          <NumberInput
            label={service === 'heating' ? 'Efficiency (η / SCOP)' : (service === 'cooling' ? 'Efficiency (SEER)' : 'Efficiency (η / SCOP)')}
            value={system.efficiency_metric}
            onChange={(v) => capture({ id: newPatchId(), op: 'set', path: `building.systems_config_v40.${service}[id=${sysId}].efficiency_metric`, value: v, source: 'inline' })}
            step={0.05}
          />
          <NumberInput
            label="Share"
            value={system.share_pct}
            onChange={(v) => capture({ id: newPatchId(), op: 'set', path: `building.systems_config_v40.${service}[id=${sysId}].share_pct`, value: v, source: 'inline' })}
            unit="%"
            step={1}
            min={0}
            max={100}
          />
        </>
      )}
      {baseVent && (
        <>
          <NumberInput
            label="SFP"
            value={system.sfp_w_per_l_per_s}
            onChange={(v) => capture({ id: newPatchId(), op: 'set', path: `building.systems_config_v40.ventilation[id=${sysId}].sfp_w_per_l_per_s`, value: v, source: 'inline' })}
            unit="W/l·s⁻¹"
            step={0.1}
          />
          <NumberInput
            label="Sensible recovery"
            value={system.recovery_sensible_pct}
            onChange={(v) => capture({ id: newPatchId(), op: 'set', path: `building.systems_config_v40.ventilation[id=${sysId}].recovery_sensible_pct`, value: v, source: 'inline' })}
            unit="%"
            step={1}
            min={0}
            max={100}
          />
        </>
      )}
      {baseLight && (
        <>
          <SelectInput
            label="Control mechanism"
            value={system.control_mechanism}
            onChange={(v) => {
              // Capture both the mechanism and the default control_factor for that mechanism.
              capture({ id: newPatchId(), op: 'set', path: `building.systems_config_v40.${service}[id=${sysId}].control_mechanism`, value: v, source: 'inline' })
              const def = CONTROL_OPTIONS.find(o => o.value === v)?.factor
              if (def != null) {
                capture({ id: newPatchId(), op: 'set', path: `building.systems_config_v40.${service}[id=${sysId}].control_factor`, value: def, source: 'inline' })
              }
            }}
            options={CONTROL_OPTIONS}
          />
          <NumberInput
            label="Control factor"
            value={system.control_factor}
            onChange={(v) => capture({ id: newPatchId(), op: 'set', path: `building.systems_config_v40.${service}[id=${sysId}].control_factor`, value: v, source: 'inline' })}
            step={0.05}
            min={0}
            max={1}
          />
        </>
      )}
    </div>
  )
}

export default function InterventionEditorBuildingView({
  currentConfig,
  libraryData,
  capture,
}) {
  const b = currentConfig?.building ?? {}
  const c = currentConfig?.constructions ?? {}
  const sysCfg = b.systems_config_v40 ?? {}

  const constructionsLib = Array.isArray(libraryData?.constructions) ? libraryData.constructions : []
  const constructionOptions = constructionsLib.map(item => ({
    value: item.name || item.id,
    label: `${item.name || item.id}${item.u_value_W_per_m2K != null ? ` (U ${Number(item.u_value_W_per_m2K).toFixed(2)})` : ''}`,
  }))

  const lightingProfile = (b.gains?.lighting?.profiles ?? [])[0]
  const equipmentProfile = (b.gains?.equipment?.profiles ?? [])[0]

  return (
    <div className="space-y-3">
      {/* Envelope */}
      <Section title="Envelope">
        {/*
          Air permeability (q50) is the canonical airtightness input
          per Brief 28-IM Bug 2; the engine prefers it over the legacy
          `infiltration_ach` field via deriveOperationalACH(). Patching
          q50 directly is the path that actually moves the engine.
          Typical UK ranges:
            - 10.0 m³/h·m² — leaky 1970s commercial
            - 5.0          — Part L 2013 minimum
            - 3.0          — best-practice new build
            - 1.0          — EnerPHit retrofit
            - 0.6          — Passivhaus
        */}
        <NumberInput
          label="Air permeability (q50)"
          value={b.fabric?.air_permeability_q50}
          onChange={(v) => capture({ id: newPatchId(), op: 'set', path: 'building.fabric.air_permeability_q50', value: v, source: 'inline' })}
          unit="m³/(h·m²)"
          step={0.1}
          min={0}
        />
        <SelectInput
          label="External wall"
          value={c.external_wall}
          onChange={(v) => capture({ id: newPatchId(), op: 'set', path: 'constructions.external_wall', value: v, source: 'inline' })}
          options={constructionOptions}
        />
        <SelectInput
          label="Roof"
          value={c.roof}
          onChange={(v) => capture({ id: newPatchId(), op: 'set', path: 'constructions.roof', value: v, source: 'inline' })}
          options={constructionOptions}
        />
        <SelectInput
          label="Glazing"
          value={c.glazing}
          onChange={(v) => capture({ id: newPatchId(), op: 'set', path: 'constructions.glazing', value: v, source: 'inline' })}
          options={constructionOptions}
        />
      </Section>

      {/* Internal Gains */}
      <Section title="Internal Gains" defaultOpen={false}>
        <NumberInput
          label="Occupancy rate"
          value={b.occupancy_rate ?? b.occupancy?.occupancy_rate}
          onChange={(v) => {
            // v2.3 + legacy mirror — both patched (audit doc §5 mentions both paths)
            capture({ id: newPatchId(), op: 'set', path: 'building.occupancy_rate', value: v, source: 'inline' })
            capture({ id: newPatchId(), op: 'set', path: 'building.occupancy.occupancy_rate', value: v, source: 'inline' })
          }}
          step={0.05}
          min={0}
          max={1}
        />
        {lightingProfile && (
          <NumberInput
            label="Lighting load"
            value={lightingProfile?.magnitude?.value}
            onChange={(v) => capture({
              id: newPatchId(), op: 'set',
              path: `building.gains.lighting.profiles[id=${lightingProfile.id}].magnitude.value`,
              value: v, source: 'inline',
            })}
            unit="W/m²"
            step={0.5}
            min={0}
          />
        )}
        {equipmentProfile && (
          <NumberInput
            label="Equipment active"
            value={equipmentProfile?.active?.value}
            onChange={(v) => capture({
              id: newPatchId(), op: 'set',
              path: `building.gains.equipment.profiles[id=${equipmentProfile.id}].active.value`,
              value: v, source: 'inline',
            })}
            unit="W/m²"
            step={0.5}
            min={0}
          />
        )}
      </Section>

      {/* Heating systems */}
      {(sysCfg.heating ?? []).length > 0 && (
        <Section title="Heating systems" defaultOpen={false}>
          {sysCfg.heating.map(sys => (
            <ServiceBlock key={sys.id} system={sys} service="heating" capture={capture} />
          ))}
        </Section>
      )}

      {/* Cooling systems */}
      {(sysCfg.cooling ?? []).length > 0 && (
        <Section title="Cooling systems" defaultOpen={false}>
          {sysCfg.cooling.map(sys => (
            <ServiceBlock key={sys.id} system={sys} service="cooling" capture={capture} />
          ))}
        </Section>
      )}

      {/* DHW systems */}
      {(sysCfg.dhw ?? []).length > 0 && (
        <Section title="DHW systems" defaultOpen={false}>
          {sysCfg.dhw.map(sys => (
            <ServiceBlock key={sys.id} system={sys} service="dhw" capture={capture} />
          ))}
        </Section>
      )}

      {/* Ventilation systems */}
      {(sysCfg.ventilation ?? []).length > 0 && (
        <Section title="Ventilation systems" defaultOpen={false}>
          {sysCfg.ventilation.map(sys => (
            <ServiceBlock key={sys.id} system={sys} service="ventilation" capture={capture} />
          ))}
        </Section>
      )}

      {/* Lighting controls (thin entries) */}
      {(sysCfg.lighting ?? []).length > 0 && (
        <Section title="Lighting controls" defaultOpen={false}>
          {sysCfg.lighting.map(sys => (
            <ServiceBlock key={sys.id} system={sys} service="lighting" capture={capture} />
          ))}
        </Section>
      )}

      {/* Small power controls (thin entries) */}
      {(sysCfg.small_power ?? []).length > 0 && (
        <Section title="Small power controls" defaultOpen={false}>
          {sysCfg.small_power.map(sys => (
            <ServiceBlock key={sys.id} system={sys} service="small_power" capture={capture} />
          ))}
        </Section>
      )}
    </div>
  )
}
