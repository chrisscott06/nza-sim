/**
 * SystemEditorCard.jsx — Brief 40 Part 3 (2026-05-19)
 *                       + Brief 42 Part 3 (2026-05-20)
 *
 * Per-system editor card. Service-aware fields driven by
 * `system.service` ∈ heating / cooling / dhw / ventilation /
 * lighting / small_power.
 *
 * Brief 42 Part 3 (2026-05-20) — building-level field groups
 * removed from this card. They now live in `ServiceSectionHeader`
 * at the top of each service section in the left panel. This card
 * is the body of `SystemEditorPopout` and shows ONLY system-level
 * fields:
 *
 *   ┌─ IDENTITY ─────────┐  label, share
 *   ┌─ ENERGY ───────────┐  source, efficiency (service-specific shape)
 *   ┌─ CONTROL ──────────┐  mechanism, schedule (NO setpoint — service-level)
 *   ┌─ SOURCE (light/sp) ┐  link to Internal Gains read-only
 *   ┌─ DIAGNOSTIC ───────┐  delta vs comfort (read-only)
 *   ┌─ LIBRARY ──────────┐  save current to library
 *
 * Setpoint resolution: service-level (`{service}_setpoint_mode` +
 * `{service}_setpoint_c` on `systems_config_v40`). DHW storage/tap/
 * cold/demand also service-level. The card's CONTROL group renders
 * mechanism + schedule only.
 *
 * Read-side: `system` is the per-Brief-40 schema object (post-Brief-42:
 * no building-level fields). `engineSystem` is the computed
 * `consumption.brief40.{service}.systems[i]` entry from systemsEngine.
 *
 * Write-side: `onUpdate(patch)` merges the patch into the system entry
 * (parent maintains the index into `systems_config_v40.{service}[i]`).
 */

import { NavLink } from 'react-router-dom'
import { confirm } from '../../shared/ConfirmDialog.jsx'

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

  // Brief 40 Part 5b Section B (2026-05-19): per-system enable toggle.
  // `enabled !== false` is the on state — default true; existing v40
  // entries on disk that pre-date Part 5b are treated as enabled. The
  // toggle preserves share_pct on disk when disabled (engine ignores
  // disabled systems entirely; share validation only counts enabled).
  const isEnabled = system?.enabled !== false
  const handleToggleEnabled = (e) => {
    e.stopPropagation()  // don't fire expand/collapse
    onUpdate({ enabled: !isEnabled })
  }

  // ── Collapsed summary line ─────────────────────────────────────────────
  if (!expanded) {
    return (
      <div className={`border border-light-grey rounded bg-white ${!isEnabled ? 'opacity-50' : ''}`}>
        <div className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-off-white/50 transition-colors">
          <button
            onClick={handleToggleEnabled}
            className="flex-shrink-0 p-0.5 rounded hover:bg-light-grey/40 transition-colors"
            title={isEnabled ? 'Disable this system' : 'Enable this system'}
          >
            <span
              className="block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: isEnabled ? accent : '#9CA3AF' }}
            />
          </button>
          <button
            onClick={onToggleExpanded}
            className="flex-1 min-w-0 flex items-center gap-2 text-left"
          >
            <span className={`flex-1 min-w-0 truncate text-xxs font-medium ${isEnabled ? 'text-navy' : 'text-mid-grey line-through'}`}>
              {system?.label ?? '(unnamed)'}
            </span>
            <span className={`text-xxs tabular-nums ${shareInvalid && isEnabled ? 'text-amber-600' : 'text-mid-grey'}`}>
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
      </div>
    )
  }

  // ── Expanded editor ─────────────────────────────────────────────────────
  return (
    <div className={`border rounded bg-white ${!isEnabled ? 'opacity-50' : ''}`} style={{ borderColor: accent + '40' }}>
      {/* Card header */}
      <div
        className="flex items-center gap-2 px-2 py-1.5"
        style={{ backgroundColor: accent + '10', borderBottom: `1px solid ${accent}30` }}
      >
        <button
          onClick={handleToggleEnabled}
          className="flex-shrink-0 p-0.5 rounded hover:bg-light-grey/40 transition-colors"
          title={isEnabled ? 'Disable this system' : 'Enable this system'}
        >
          <span
            className="block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: isEnabled ? accent : '#9CA3AF' }}
          />
        </button>
        <span className={`flex-1 text-xxs font-semibold ${isEnabled ? 'text-navy' : 'text-mid-grey line-through'}`}>
          {system?.label ?? '(unnamed)'}
        </span>
        <button
          onClick={onToggleExpanded}
          className="text-xxs text-mid-grey hover:text-navy px-1"
          title="Collapse"
        >▴</button>
        <button
          onClick={async () => {
            if (await confirm({
              title: `Delete "${system?.label ?? 'this system'}"?`,
              message: 'The system will be removed. This cannot be undone.',
              confirmText: 'Delete',
              tone: 'danger',
            })) onDelete()
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
          {/* Brief 53 Part 5 (2026-05-26): ventilation share is a fixed
              numeric input, not a slider. Fixed-flow ventilation systems
              have a constant flow per the schema (flow_rate × flow_basis);
              a 0-100 % slider implied continuous variation that doesn't
              match the underlying physics. Heating / cooling / DHW retain
              the slider — those are genuinely continuous duty splits. */}
          {service === 'ventilation' ? (
            <div>
              <label className="block text-xxs text-mid-grey mb-0.5">
                Share (% of service)
                {shareInvalid && <span className="text-amber-600 ml-2">⚠ service shares ≠ 100%</span>}
              </label>
              <input
                type="number" min={0} max={100} step={1}
                value={Number(system?.share_pct ?? 0)}
                onChange={e => onUpdate({ share_pct: Number(e.target.value) })}
                className="w-full px-1.5 py-1 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-cyan-700 tabular-nums"
                title="Fixed-flow ventilation: each system contributes its full flow regardless of this share; share scales fan electrical accounting only."
              />
            </div>
          ) : (
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
          )}
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
            {/*
              Brief 42 Part 3: DHW storage / tap outlet / cold supply /
              demand basis / demand quantity REMOVED from this card —
              they're service-level and live in ServiceSectionHeader at
              the top of the DHW section.
            */}
            {service === 'dhw' && (
              <LabeledNumber
                label="Point-of-use η"
                value={Number(system?.efficiency_metric ?? 0.85)}
                onChange={v => onUpdate({ efficiency_metric: v })}
                min={0.1} max={6.0} step={0.01}
              />
            )}
            {service === 'ventilation' && (
              <VentilationFields system={system} onUpdate={onUpdate} />
            )}
          </Group>
        )}

        {/* CONTROL group — service-aware.
            Brief 42 Part 3: heating/cooling setpoint REMOVED from this card —
            it's service-level and lives in ServiceSectionHeader at the top of
            the heating/cooling sections. Only mechanism + schedule + control
            factor (lighting/small_power) remain. */}
        <Group title="Control">
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

        {/* SOURCE group — lighting + small_power only. Makes the link to
            Internal Gains visible: shows the annual gain figure that
            sources the load + the formula that produces delivered electrical
            after controls + share. Engine wiring: systemsEngine._computeThin
            reads gain_from_internal_gains_mwh from state2Result.heat_balance
            .annual.gains.internal.{lighting|equipment}.kwh; the Internal
            Gains module's lpd × gia × schedule_fraction integrand. */}
        {(service === 'lighting' || service === 'small_power') && (
          <Group title="Source — linked to Internal Gains">
            {engineSystem ? (
              <>
                <div className="flex justify-between items-baseline gap-2 text-xxs">
                  <span className="text-mid-grey">Annual gain</span>
                  <span className="text-navy tabular-nums font-medium whitespace-nowrap">
                    {(engineSystem.gain_from_internal_gains_mwh ?? 0).toFixed(1)} MWh/yr
                  </span>
                </div>
                <div className="flex justify-between items-baseline gap-2 text-xxs">
                  <span className="text-mid-grey">× control × share</span>
                  <span className="text-navy tabular-nums whitespace-nowrap">
                    × {Number(engineSystem.control_factor ?? 1).toFixed(2)} × {Number(system?.share_pct ?? 0)}%
                  </span>
                </div>
                <div className="flex justify-between items-baseline gap-2 text-xxs pt-1 border-t border-light-grey/40">
                  <span className="text-navy font-medium">= Delivered electrical</span>
                  <span className="text-navy tabular-nums font-semibold whitespace-nowrap">
                    {(engineSystem.delivered_electrical_mwh ?? 0).toFixed(1)} MWh/yr
                  </span>
                </div>
                <p className="text-xxs text-mid-grey/70 leading-tight pt-0.5">
                  Gain = (LPD or EPD) × GIA × schedule fraction × hours, computed in Internal Gains.
                </p>
              </>
            ) : (
              <p className="text-xxs text-mid-grey/70 leading-tight">
                Delivered electrical = annual gain × control_factor × share/100.
                Gain comes from Internal Gains (schedule × power density);
                controls applied here reduce delivered electrical while the
                heat-balance gain stays sourced from upstream.
              </p>
            )}
            <NavLink
              to="/gains"
              className="text-xxs text-navy underline hover:text-cyan-700 transition-colors"
            >
              Edit gain in Internal Gains →
            </NavLink>
          </Group>
        )}

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

// ── Ventilation-specific fields ──────────────────────────────────────────────

function VentilationFields({ system, onUpdate }) {
  const eff = system?.efficiency_metric ?? {}
  const hasRecovery = Number(eff?.recovery_sensible_pct ?? 0) > 0
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
      {/* Brief 53 Part 2 (2026-05-26): summer-bypass damper. Only meaningful
          when the system has heat recovery (HRE > 0). Suppresses recovery
          in hours where the zone wants cooling AND outside air is cooler
          than extract — the free-cooling trigger documented in
          docs/audit/53_ventilation.md §4.1. Default OFF; the 128.20
          Bridgewater anchor is computed with this OFF. */}
      {hasRecovery && (
        <label className="flex items-center gap-2 px-1 py-1.5 cursor-pointer text-xxs text-navy hover:text-cyan-700">
          <input
            type="checkbox"
            checked={system?.summer_bypass === true}
            onChange={e => onUpdate({ summer_bypass: e.target.checked })}
            className="w-3.5 h-3.5 rounded border-light-grey text-cyan-700 focus:ring-cyan-700 focus:ring-1"
          />
          <span className="flex-1">
            Summer bypass
            <span className="block text-xxs text-mid-grey font-normal">
              Open damper when zone wants cooling and T<sub>out</sub> &lt; T<sub>extract</sub>
            </span>
          </span>
        </label>
      )}
    </>
  )
}
