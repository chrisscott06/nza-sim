/**
 * SystemEditorCard.jsx — Brief 40 Part 3 (2026-05-19)
 *
 * Per-system editor card for the Systems module's new section-list shape.
 * Service-aware fields driven by `system.service` ∈ heating / cooling /
 * dhw / ventilation / lighting / small_power.
 *
 * Card structure (audit doc §2 + brief Part 3 step 3.2):
 *   ┌─ IDENTITY ─────────────────────────┐  label, share
 *   ┌─ ENERGY ───────────────────────────┐  source, efficiency (service-specific shape)
 *   ┌─ CONTROL ──────────────────────────┐  setpoint (heating/cooling), mechanism, schedule
 *   ┌─ DIAGNOSTIC (only when setpoint ≠ comfort) ─┐  demand vs delivered + delta
 *   ┌─ LIBRARY ──────────────────────────┐  save current to library
 *
 * Read-side: `system` is the per-Brief-40 schema object. `engineSystem` is
 * the computed `consumption.brief40.{service}.systems[i]` entry from
 * systemsEngine — carries delivered_mwh / source_energy_mwh / delta_vs_comfort.
 * When `engineSystem` is null the diagnostic block hides.
 *
 * Write-side: `onUpdate(patch)` merges the patch into the system entry
 * (parent maintains the index into `systems_config_v40.{service}[i]` and
 * calls updateParam).
 *
 * Brief 42 per-opening cd / flow_mode pattern reused: `setpoint: null`
 * means "follow comfort band" — a flag, not an inheritance link. Editing
 * to a custom value severs the relationship.
 */

import { useState } from 'react'

// Service colour palette per Brief 37 Part 1 / SYSTEMS_SERVICE_COLOURS
export const SERVICE_COLOURS = {
  heating:     '#DC2626',  // red
  cooling:     '#00AEEF',  // cyan-bright
  dhw:         '#EC4899',  // pink
  ventilation: '#14B8A6',  // teal-500
  lighting:    '#F59E0B',  // amber
  small_power: '#8B5CF6',  // violet
}

// Per-service source options (audit doc §2.x)
export const SOURCE_OPTIONS = {
  heating: [
    { value: 'electricity',      label: 'Electricity (direct)' },
    { value: 'gas',              label: 'Gas (boiler)' },
    { value: 'oil',              label: 'Oil (boiler)' },
    { value: 'biomass',          label: 'Biomass' },
    { value: 'district_heating', label: 'District heating' },
    { value: 'ambient_air',      label: 'Ambient — air-source heat pump' },
    { value: 'ambient_ground',   label: 'Ambient — ground-source heat pump' },
  ],
  cooling: [
    { value: 'electricity',      label: 'Electricity (vapour-compression)' },
    { value: 'district_cooling', label: 'District cooling' },
  ],
  dhw: [
    { value: 'electricity',          label: 'Electricity (immersion / instant)' },
    { value: 'gas',                  label: 'Gas (boiler)' },
    { value: 'oil',                  label: 'Oil (boiler)' },
    { value: 'biomass',              label: 'Biomass' },
    { value: 'district_heating',     label: 'District heating' },
    { value: 'ambient_air',          label: 'Ambient — air-source heat pump' },
    { value: 'ambient_ground',       label: 'Ambient — ground-source heat pump' },
    { value: 'solar_thermal_assisted', label: 'Solar thermal assisted (out of scope)' },
  ],
  ventilation: [
    { value: 'electricity', label: 'Electricity (mechanical)' },
    { value: 'natural',     label: 'Natural (out of Systems scope)' },
  ],
  lighting:    [{ value: 'electricity', label: 'Electricity' }],
  small_power: [{ value: 'electricity', label: 'Electricity' }],
}

// Control mechanism options per service
export const CONTROL_MECHANISM_OPTIONS = {
  heating: [
    { value: 'constant',              label: 'Constant' },
    { value: 'weather_compensation',  label: 'Weather compensation' },
    { value: 'occupancy_driven',      label: 'Occupancy-driven' },
    { value: 'scheduled',             label: 'Scheduled' },
  ],
  cooling: [
    { value: 'constant',         label: 'Constant' },
    { value: 'occupancy_driven', label: 'Occupancy-driven' },
    { value: 'scheduled',        label: 'Scheduled' },
  ],
  dhw: [
    { value: 'constant',         label: 'Constant' },
    { value: 'occupancy_driven', label: 'Occupancy-driven' },
    { value: 'scheduled',        label: 'Scheduled (timed circulation)' },
  ],
  ventilation: [
    { value: 'constant',         label: 'Constant' },
    { value: 'occupancy_driven', label: 'Occupancy-driven (CO₂ / demand)' },
    { value: 'scheduled',        label: 'Scheduled' },
  ],
  lighting: [
    { value: 'constant',          label: 'Constant (no controls)' },
    { value: 'daylight_dimming',  label: 'Daylight dimming' },
    { value: 'occupancy_sensors', label: 'Occupancy sensors' },
    { value: 'both',              label: 'Both (daylight + occupancy)' },
  ],
  small_power: [
    { value: 'constant', label: 'Constant' },
  ],
}

// Default control_factor per lighting control_mechanism (editable seed; not fixed)
export const LIGHTING_CONTROL_FACTOR_DEFAULTS = {
  constant:          1.00,
  daylight_dimming:  0.70,
  occupancy_sensors: 0.70,
  both:              0.50,
}

// Efficiency label by source for heating (SCOP for heat-pump-class, η otherwise)
function heatingEfficiencyLabel(source) {
  if (source === 'ambient_air' || source === 'ambient_ground') return 'SCOP'
  if (source === 'district_heating' || source === 'electricity') return 'COP / η'
  return 'Seasonal η'   // gas / oil / biomass
}

// ── Card body ────────────────────────────────────────────────────────────────

export default function SystemEditorCard({
  system,
  engineSystem,
  comfortBand,
  expanded,
  onToggleExpanded,
  onUpdate,
  onDelete,
  onSaveToLibrary,
  openScheduleEditor,
  shareInvalid = false,
}) {
  const service = system?.service ?? 'heating'
  const accent  = SERVICE_COLOURS[service] ?? '#00AEEF'
  const sources = SOURCE_OPTIONS[service]  ?? []
  const controls = CONTROL_MECHANISM_OPTIONS[service] ?? []

  // ── Collapsed summary line ─────────────────────────────────────────────
  if (!expanded) {
    return (
      <div className="border border-light-grey rounded bg-white">
        <button
          onClick={onToggleExpanded}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-off-white/50 transition-colors"
        >
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: accent }}
          />
          <span className="flex-1 min-w-0 truncate text-xxs font-medium text-navy">
            {system?.label ?? '(unnamed)'}
          </span>
          <span className={`text-xxs tabular-nums ${shareInvalid ? 'text-amber-600' : 'text-mid-grey'}`}>
            {Number(system?.share_pct ?? 0)}%
          </span>
          {service !== 'lighting' && service !== 'small_power' && service !== 'ventilation' && (
            <span className="text-xxs text-mid-grey/70 truncate max-w-[80px]">
              {system?.source ?? '—'}
              {typeof system?.efficiency_metric === 'number' && ` · η ${system.efficiency_metric.toFixed(2)}`}
            </span>
          )}
          <span className="text-xxs text-mid-grey">▾</span>
        </button>
      </div>
    )
  }

  // ── Expanded editor ─────────────────────────────────────────────────────
  return (
    <div className="border rounded bg-white" style={{ borderColor: accent + '40' }}>
      {/* Card header */}
      <div
        className="flex items-center gap-2 px-2 py-1.5"
        style={{ backgroundColor: accent + '10', borderBottom: `1px solid ${accent}30` }}
      >
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: accent }} />
        <span className="flex-1 text-xxs font-semibold text-navy">{system?.label ?? '(unnamed)'}</span>
        <button
          onClick={onToggleExpanded}
          className="text-xxs text-mid-grey hover:text-navy px-1"
          title="Collapse"
        >▴</button>
        <button
          onClick={() => {
            if (window.confirm(`Delete "${system?.label ?? 'this system'}"?`)) onDelete()
          }}
          className="text-xxs text-error hover:underline px-1"
          title="Delete this system"
        >✕</button>
      </div>

      <div className="p-2 space-y-2 text-xxs">
        {/* IDENTITY group */}
        <Group title="Identity">
          <LabeledInput
            label="Label"
            value={system?.label ?? ''}
            onChange={v => onUpdate({ label: v })}
          />
          <div>
            <label className="block text-xxs text-mid-grey mb-0.5">
              Share <span className="tabular-nums text-navy">{Number(system?.share_pct ?? 0)}%</span>
              {shareInvalid && <span className="text-amber-600 ml-2">⚠ service shares ≠ 100%</span>}
            </label>
            <input
              type="range" min={0} max={100} step={5}
              value={Number(system?.share_pct ?? 0)}
              onChange={e => onUpdate({ share_pct: Number(e.target.value) })}
              className="w-full h-[3px]"
              style={{ accentColor: accent }}
            />
          </div>
        </Group>

        {/* ENERGY group — service-aware */}
        {service !== 'lighting' && service !== 'small_power' && (
          <Group title="Energy">
            <LabeledSelect
              label="Source"
              value={system?.source ?? sources[0]?.value ?? 'electricity'}
              onChange={v => onUpdate({ source: v })}
              options={sources}
            />
            {service === 'heating' && (
              <LabeledNumber
                label={heatingEfficiencyLabel(system?.source)}
                value={Number(system?.efficiency_metric ?? 1.0)}
                onChange={v => onUpdate({ efficiency_metric: v })}
                min={0.1} max={6.0} step={0.05}
              />
            )}
            {service === 'cooling' && (
              <LabeledNumber
                label="SEER"
                value={Number(system?.efficiency_metric ?? 3.0)}
                onChange={v => onUpdate({ efficiency_metric: v })}
                min={0.5} max={8.0} step={0.1}
              />
            )}
            {service === 'dhw' && (
              <>
                <LabeledNumber
                  label="Point-of-use η"
                  value={Number(system?.efficiency_metric ?? 0.85)}
                  onChange={v => onUpdate({ efficiency_metric: v })}
                  min={0.1} max={6.0} step={0.01}
                />
                <DHWFields system={system} onUpdate={onUpdate} accent={accent} />
              </>
            )}
            {service === 'ventilation' && (
              <VentilationFields system={system} onUpdate={onUpdate} />
            )}
          </Group>
        )}

        {/* CONTROL group — service-aware */}
        <Group title="Control">
          {service === 'heating' || service === 'cooling' ? (
            <SetpointControl
              system={system}
              service={service}
              comfortBand={comfortBand}
              accent={accent}
              onUpdate={onUpdate}
            />
          ) : null}
          <LabeledSelect
            label="Mechanism"
            value={system?.control_mechanism ?? 'constant'}
            onChange={v => {
              const patch = { control_mechanism: v }
              if (service === 'lighting') {
                patch.control_factor = LIGHTING_CONTROL_FACTOR_DEFAULTS[v] ?? 1.0
              }
              onUpdate(patch)
            }}
            options={controls}
          />
          {system?.control_mechanism === 'scheduled' && openScheduleEditor && (
            <button
              onClick={() => openScheduleEditor(system.control_schedule_id ?? 'always_on')}
              className="text-xxs text-navy underline hover:text-cyan-700 transition-colors"
            >
              Open schedule editor →
            </button>
          )}
          {service === 'lighting' && (
            <LabeledNumber
              label="Control factor"
              value={Number(system?.control_factor ?? 1.0)}
              onChange={v => onUpdate({ control_factor: v })}
              min={0.0} max={1.0} step={0.05}
            />
          )}
          {service === 'small_power' && (
            <LabeledNumber
              label="Control factor"
              value={Number(system?.control_factor ?? 1.0)}
              onChange={v => onUpdate({ control_factor: v })}
              min={0.0} max={1.0} step={0.05}
            />
          )}
        </Group>

        {/* DIAGNOSTIC group — only when engine has computed it */}
        {engineSystem && (service === 'heating' || service === 'cooling') &&
         typeof engineSystem.delta_vs_comfort_mwh === 'number' &&
         Math.abs(engineSystem.delta_vs_comfort_mwh) > 0.1 && (
          <Group title="Diagnostic — comfort vs setpoint">
            <div className="space-y-0.5 text-xxs">
              <DiagRow label="Demand at comfort"           value={`${(engineSystem.demand_at_this_setpoint_mwh - engineSystem.delta_vs_comfort_mwh).toFixed(1)} MWh`} />
              <DiagRow label={`Delivered at ${engineSystem.setpoint_resolved}°C`} value={`${engineSystem.delivered_mwh.toFixed(1)} MWh`} />
              <DiagRow
                label="Δ"
                value={`${engineSystem.delta_vs_comfort_mwh > 0 ? '+' : ''}${engineSystem.delta_vs_comfort_mwh.toFixed(1)} MWh (${engineSystem.delta_vs_comfort_pct.toFixed(1)}%, ${engineSystem.delta_vs_comfort_mwh > 0 ? 'overdeliver' : 'underdeliver'})`}
                strong
              />
            </div>
          </Group>
        )}

        {/* LIBRARY group */}
        {onSaveToLibrary && (
          <Group title="Library">
            <button
              onClick={() => onSaveToLibrary(system)}
              className="w-full text-xxs px-2 py-1 rounded border border-light-grey text-navy hover:bg-off-white/50 transition-colors"
            >
              Save current as library item
            </button>
          </Group>
        )}
      </div>
    </div>
  )
}

// ── Sub-blocks ───────────────────────────────────────────────────────────────

function Group({ title, children }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xxs uppercase tracking-wider text-mid-grey">{title}</p>
      {children}
    </div>
  )
}

function LabeledInput({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="block text-xxs text-mid-grey mb-0.5">{label}</label>
      <input
        type="text"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-1.5 py-1 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-cyan-700"
      />
    </div>
  )
}

function LabeledNumber({ label, value, onChange, min, max, step = 1 }) {
  return (
    <div>
      <label className="block text-xxs text-mid-grey mb-0.5">{label}</label>
      <input
        type="number" min={min} max={max} step={step}
        value={value ?? 0}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full px-1.5 py-1 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-cyan-700 tabular-nums"
      />
    </div>
  )
}

function LabeledSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-xxs text-mid-grey mb-0.5">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-1.5 py-1 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-cyan-700 cursor-pointer"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function DiagRow({ label, value, strong = false }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-mid-grey">{label}</span>
      <span className={`tabular-nums text-right ${strong ? 'font-semibold text-navy' : 'text-navy'}`}>{value}</span>
    </div>
  )
}

// ── Heating / cooling setpoint control ───────────────────────────────────────

function SetpointControl({ system, service, comfortBand, accent, onUpdate }) {
  const isHeating = service === 'heating'
  const comfortVal = isHeating ? (comfortBand?.lower_c ?? 21) : (comfortBand?.upper_c ?? 24)
  const followComfort = system?.setpoint == null
  const currentSetpoint = system?.setpoint ?? comfortVal

  return (
    <div className="space-y-1">
      <label className="block text-xxs text-mid-grey">Setpoint</label>
      <div className="flex items-center gap-1.5 text-xxs">
        <input
          type="radio"
          checked={followComfort}
          onChange={() => onUpdate({ setpoint: null })}
          className="flex-shrink-0"
          style={{ accentColor: accent }}
        />
        <span className={followComfort ? 'text-navy' : 'text-mid-grey'}>
          Follow comfort ({comfortVal}°C)
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-xxs">
        <input
          type="radio"
          checked={!followComfort}
          onChange={() => onUpdate({ setpoint: comfortVal })}
          className="flex-shrink-0"
          style={{ accentColor: accent }}
        />
        <span className={!followComfort ? 'text-navy' : 'text-mid-grey'}>Custom</span>
        {!followComfort && (
          <>
            <input
              type="range"
              min={isHeating ? 10 : 18}
              max={isHeating ? 28 : 32}
              step={0.5}
              value={Number(currentSetpoint)}
              onChange={e => onUpdate({ setpoint: Number(e.target.value) })}
              className="flex-1 h-[3px]"
              style={{ accentColor: accent }}
            />
            <span className="tabular-nums text-navy w-10 text-right">{Number(currentSetpoint).toFixed(1)}°C</span>
          </>
        )}
      </div>
    </div>
  )
}

// ── DHW-specific extra fields ────────────────────────────────────────────────

function DHWFields({ system, onUpdate, accent }) {
  const basis = system?.demand_basis ?? 'per_m2'
  return (
    <>
      <LabeledNumber
        label="Storage setpoint (°C)"
        value={Number(system?.setpoint ?? 60)}
        onChange={v => onUpdate({ setpoint: v })}
        min={45} max={80} step={1}
      />
      <LabeledNumber
        label="Tap outlet (°C)"
        value={Number(system?.tap_outlet_temp_c ?? 40)}
        onChange={v => onUpdate({ tap_outlet_temp_c: v })}
        min={20} max={70} step={1}
      />
      <LabeledNumber
        label="Cold supply (°C)"
        value={Number(system?.cold_supply_temp_c ?? 10)}
        onChange={v => onUpdate({ cold_supply_temp_c: v })}
        min={2} max={20} step={1}
      />
      <LabeledSelect
        label="Demand basis"
        value={basis}
        onChange={v => onUpdate({ demand_basis: v })}
        options={[
          { value: 'per_m2',     label: 'Per m² (CIBSE TM54 style)' },
          { value: 'per_person', label: 'Per person (occupancy-driven)' },
        ]}
      />
      {basis === 'per_m2' && (
        <LabeledNumber
          label="Demand (L / m² / day)"
          value={Number(system?.demand_litres_per_m2_day ?? 1.1)}
          onChange={v => onUpdate({ demand_litres_per_m2_day: v, demand_litres_per_person_per_day: null })}
          min={0.1} max={10.0} step={0.1}
        />
      )}
      {basis === 'per_person' && (
        <LabeledNumber
          label="Demand (L / person / day)"
          value={Number(system?.demand_litres_per_person_per_day ?? 80)}
          onChange={v => onUpdate({ demand_litres_per_person_per_day: v, demand_litres_per_m2_day: null })}
          min={5} max={500} step={5}
        />
      )}
      <p className="text-xxs text-mid-grey/70 leading-tight">
        Tap-mix correction (Brief 40): the boiler heats only the hot fraction (
        {(((Number(system?.tap_outlet_temp_c ?? 40) - Number(system?.cold_supply_temp_c ?? 10)) /
          Math.max(Number(system?.setpoint ?? 60) - Number(system?.cold_supply_temp_c ?? 10), 1)) * 100).toFixed(0)}
        %) of total tap consumption, not the full tap litres.
      </p>
    </>
  )
}

// ── Ventilation-specific fields ──────────────────────────────────────────────

function VentilationFields({ system, onUpdate }) {
  const eff = system?.efficiency_metric ?? {}
  return (
    <>
      <LabeledNumber
        label="SFP (W per l/s)"
        value={Number(eff?.sfp_w_per_lps ?? 1.5)}
        onChange={v => onUpdate({ efficiency_metric: { ...eff, sfp_w_per_lps: v } })}
        min={0.1} max={5.0} step={0.05}
      />
      <LabeledNumber
        label="Recovery sensible (%)"
        value={Number(eff?.recovery_sensible_pct ?? 0)}
        onChange={v => onUpdate({ efficiency_metric: { ...eff, recovery_sensible_pct: v } })}
        min={0} max={95} step={1}
      />
      <LabeledNumber
        label="Recovery latent (%)"
        value={Number(eff?.recovery_latent_pct ?? 0)}
        onChange={v => onUpdate({ efficiency_metric: { ...eff, recovery_latent_pct: v } })}
        min={0} max={95} step={1}
      />
      <LabeledNumber
        label="Flow rate"
        value={Number(system?.flow_rate ?? 0)}
        onChange={v => onUpdate({ flow_rate: v })}
        min={0} step={0.5}
      />
      <LabeledSelect
        label="Flow basis"
        value={system?.flow_rate_basis ?? 'constant'}
        onChange={v => onUpdate({ flow_rate_basis: v })}
        options={[
          { value: 'per_person', label: 'Per person (l/s/person)' },
          { value: 'per_m2',     label: 'Per m² (l/s/m²)' },
          { value: 'constant',   label: 'Constant (l/s building total)' },
        ]}
      />
    </>
  )
}
