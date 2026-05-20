/**
 * InterventionEditorBuildingView.jsx — Brief 41 Part 4
 *                                     + Brief 43 Part 2 (2026-05-20)
 *
 * Curated editor exposing the highest-value patch targets for the
 * Interventions module. Wraps a set of inputs that, on edit, capture
 * a patch via the `capture` callback rather than mutating the
 * ProjectContext baseline (audit doc §6 contract — baseline never
 * changes).
 *
 * Per Brief 41 Part 4 pragmatic scope (Chris-approved): this ships a
 * focused subset of edits rather than wrapping arbitrary main-app
 * components in a patch-capture context.
 *
 * Section list:
 *   - Envelope: infiltration ACH, wall/roof/glazing construction
 *   - Internal Gains: occupancy rate, lighting load
 *   - Systems: per-system enable/efficiency/share for heating /
 *     cooling / DHW; ventilation SFP + sensible recovery; lighting
 *     control_mechanism + control_factor
 *
 * Brief 43 Part 2 (2026-05-20): structural ops in the curated editor.
 * Each service section gains a "+ Add system" button (library / blank
 * archetype picker) that captures `op: 'add'`. Each existing system
 * gains ⊗ Remove and ⇄ Replace buttons that capture `op: 'remove'` /
 * `op: 'replace'` patches against the systems_config_v40.<service>
 * array. Reuses the BLANK_ARCHETYPES + seedSystem helpers from the
 * Systems module's AddSystemButton (Brief 40 Part 3 affordance).
 *
 * The `currentConfig` prop is the engine-quartet AFTER applying all
 * captured patches so far — the editor reads current values from it
 * (so the user sees the running edit state, not stale baseline).
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight, Plus, X, Repeat } from 'lucide-react'
import { newPatchId } from './patchCapture.js'
import { BLANK_ARCHETYPES, seedSystem } from '../systems/AddSystemButton.jsx'

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

// Brief 43 Part 2 — small picker shown when the user clicks "+ Add
// system" or "⇄ Replace". Surfaces library entries filtered by service
// + the blank archetypes from BLANK_ARCHETYPES. Calls onPick(seededSystem)
// with a fully-formed system entry; the caller wraps it in the
// appropriate add or replace patch.
function StructuralOpMenu({ service, librarySystems, onPick, onClose }) {
  const archetypes = BLANK_ARCHETYPES[service] ?? []
  const filteredLibrary = (librarySystems ?? []).filter(s => s?.service === service)
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-light-grey rounded shadow-lg p-2 space-y-2 max-h-[400px] overflow-y-auto">
        {filteredLibrary.length > 0 && (
          <div>
            <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">From library</p>
            <div className="space-y-0.5">
              {filteredLibrary.map(lib => (
                <button
                  key={lib.id ?? lib.label}
                  type="button"
                  onClick={() => {
                    // Inline-resolve: copy the library entry into the patch
                    // value with a fresh system uuid. Source stays 'library'
                    // so the patch list shows " — from library" provenance.
                    const fresh = {
                      ...lib,
                      id: `sys_${service}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                      share_pct: lib.share_pct ?? 100,
                      enabled: lib.enabled !== false,
                    }
                    onPick({ value: fresh, source: 'library' })
                    onClose()
                  }}
                  className="w-full text-left text-xxs px-1.5 py-1 rounded hover:bg-off-white/50 transition-colors"
                >
                  <span className="text-navy">{lib.label}</span>
                  {' '}
                  <span className="text-mid-grey">— {lib.source ?? '—'}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">Start blank</p>
          <div className="space-y-0.5">
            {archetypes.length === 0 && (
              <p className="text-xxs text-mid-grey/70 italic px-1.5 py-1">No archetypes for this service.</p>
            )}
            {archetypes.map(arch => (
              <button
                key={arch.key}
                type="button"
                onClick={() => {
                  onPick({ value: seedSystem(service, arch), source: 'inline' })
                  onClose()
                }}
                className="w-full text-left text-xxs px-1.5 py-1 rounded hover:bg-off-white/50 transition-colors text-navy"
              >
                {arch.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

// Brief 43 Part 2 — Add affordance per service. Pairs with the
// service-section header to capture an `op: 'add'` patch.
function AddSystemAffordance({ service, librarySystems, onCapture }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full text-xxs px-2 py-1 rounded border border-dashed border-mid-grey/40 text-mid-grey hover:text-navy hover:bg-off-white/50 transition-colors flex items-center justify-center gap-1"
      >
        <Plus size={11} /> Add system
      </button>
      {open && (
        <StructuralOpMenu
          service={service}
          librarySystems={librarySystems}
          onPick={({ value, source }) => {
            onCapture({
              id: newPatchId(),
              op: 'add',
              path: `building.systems_config_v40.${service}`,
              value,
              source,
            })
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

// Brief 43 Part 2 — Replace affordance for a specific existing system.
// Inlined into ServiceBlock's header. On pick, captures a `replace`
// patch where the value carries the OLD system's id + share_pct +
// enabled — so subsequent per-system field edits in this intervention
// (paths like `...heating[id=<old_id>].efficiency_metric`) continue to
// resolve cleanly, and the original slot's share + enable state survive
// the swap unless explicitly overridden.
function ReplaceSystemAffordance({ service, oldSystem, librarySystems, onCapture }) {
  const [open, setOpen] = useState(false)
  if (!oldSystem?.id) return null
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex-shrink-0 p-0.5 rounded text-mid-grey hover:text-amber-700 hover:bg-amber-50 transition-colors"
        title="Replace this system with a different one"
      >
        <Repeat size={11} />
      </button>
      {open && (
        <StructuralOpMenu
          service={service}
          librarySystems={librarySystems}
          onPick={({ value, source }) => {
            const idPreserved = {
              ...value,
              id: oldSystem.id,
              share_pct: oldSystem.share_pct ?? value.share_pct ?? 100,
              enabled: oldSystem.enabled !== false,
            }
            onCapture({
              id: newPatchId(),
              op: 'replace',
              path: `building.systems_config_v40.${service}`,
              match: { id: oldSystem.id },
              value: idPreserved,
              source,
            })
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

function ServiceBlock({ system, service, capture, librarySystems }) {
  const sysId = system?.id
  if (!sysId) return null
  const baseHeating = service === 'heating' || service === 'cooling' || service === 'dhw'
  const baseVent    = service === 'ventilation'
  const baseLight   = service === 'lighting' || service === 'small_power'

  const handleRemove = () => {
    if (!window.confirm(`Remove ${service} system "${system.label || sysId}" from this intervention?`)) return
    capture({
      id: newPatchId(),
      op: 'remove',
      path: `building.systems_config_v40.${service}`,
      match: { id: sysId },
    })
  }

  return (
    <div className="rounded border border-light-grey/70 bg-off-white/40 p-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xxs font-semibold text-navy truncate flex-1">{system.label || sysId}</span>
        <ReplaceSystemAffordance
          service={service}
          oldSystem={system}
          librarySystems={librarySystems}
          onCapture={capture}
        />
        <button
          type="button"
          onClick={handleRemove}
          className="flex-shrink-0 p-0.5 rounded text-mid-grey hover:text-red-600 hover:bg-red-50 transition-colors"
          title="Remove this system from the intervention"
        >
          <X size={11} />
        </button>
        <span className="text-xxs text-mid-grey/60 truncate max-w-[110px]" title={sysId}>{sysId}</span>
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
          {/*
            Per-system setpoint (heating + cooling). Brief 41 §V row 9
            acceptance: "Cooling setpoint custom 20°C (vs comfort 24°C)
            → comfort-vs-setpoint diagnostic appears; EUI rises;
            cooling electrical rises." `setpoint: null` means "follow
            comfort band" per CLAUDE.md Systems scope. Non-null
            triggers state2Recompute closure with the custom setpoint
            (Brief 40 audit doc §3 — per-system setpoint semantics).
            Empty input → null on save (follow comfort).
          */}
          {(service === 'heating' || service === 'cooling') && (
            <NumberInput
              label="Setpoint (blank = follow comfort)"
              value={system.setpoint}
              onChange={(v) => capture({ id: newPatchId(), op: 'set', path: `building.systems_config_v40.${service}[id=${sysId}].setpoint`, value: v, source: 'inline' })}
              unit="°C"
              step={0.5}
            />
          )}
        </>
      )}
      {baseVent && (
        <>
          {/*
            Ventilation: SFP and recovery fields live under
            `efficiency_metric.{sfp_w_per_lps, recovery_sensible_pct,
            recovery_latent_pct}` on v40 — NOT top-level on the
            system entry.

            Dual-write to v25 ventilation array entries with the same
            id (`hre`, `sfp_w_per_l_s`): State 2's demand calc reads
            v25 ventilation for envelope-recovery integration (Brief
            28j hourly recovery cap math). The v40 entry drives State
            3 delivered/electrical; the v25 entry drives State 2
            demand-side recovery. Until a follow-up engine brief
            consolidates these, the editor must mirror both so
            patches produce the predicted heating-demand response.
            See Brief 41 Part 4.1 STATUS + 29_open_issues.md.
          */}
          <NumberInput
            label="SFP"
            value={system.efficiency_metric?.sfp_w_per_lps}
            onChange={(v) => {
              capture({ id: newPatchId(), op: 'set', path: `building.systems_config_v40.ventilation[id=${sysId}].efficiency_metric.sfp_w_per_lps`, value: v, source: 'inline' })
              capture({ id: newPatchId(), op: 'set', path: `building.systems_config_v25.ventilation[id=${sysId}].sfp_w_per_l_s`, value: v, source: 'inline' })
            }}
            unit="W/l·s⁻¹"
            step={0.1}
          />
          <NumberInput
            label="Sensible recovery"
            value={system.efficiency_metric?.recovery_sensible_pct}
            onChange={(v) => {
              capture({ id: newPatchId(), op: 'set', path: `building.systems_config_v40.ventilation[id=${sysId}].efficiency_metric.recovery_sensible_pct`, value: v, source: 'inline' })
              capture({ id: newPatchId(), op: 'set', path: `building.systems_config_v25.ventilation[id=${sysId}].hre`, value: v / 100, source: 'inline' })
            }}
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

  // Brief 43 Part 2 — library systems (from params.library_systems via
  // libraryData) for the structural-op modals (add / replace).
  const librarySystems = Array.isArray(libraryData?.library_systems) ? libraryData.library_systems : []

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
        {/*
          Construction shape: `{ library_id: string, u_value_override: number|null }`.
          The engine prefers `u_value_override` when set (per
          getUValue in instantCalc), otherwise resolves library_id
          through libraryData.constructions. Patching the whole
          object replaces both — and we explicitly set
          u_value_override to null so library_id wins.
          A separate input for u_value_override could be added later
          if the user wants to author a specific U regardless of
          library — out of Part 4.1 scope.
        */}
        <SelectInput
          label="External wall"
          value={typeof c.external_wall === 'object' ? c.external_wall?.library_id : c.external_wall}
          onChange={(v) => capture({ id: newPatchId(), op: 'set', path: 'constructions.external_wall', value: { library_id: v, u_value_override: null }, source: 'inline' })}
          options={constructionOptions}
        />
        <SelectInput
          label="Roof"
          value={typeof c.roof === 'object' ? c.roof?.library_id : c.roof}
          onChange={(v) => capture({ id: newPatchId(), op: 'set', path: 'constructions.roof', value: { library_id: v, u_value_override: null }, source: 'inline' })}
          options={constructionOptions}
        />
        <SelectInput
          label="Glazing"
          value={typeof c.glazing === 'object' ? c.glazing?.library_id : c.glazing}
          onChange={(v) => capture({ id: newPatchId(), op: 'set', path: 'constructions.glazing', value: { library_id: v, u_value_override: null }, source: 'inline' })}
          options={constructionOptions}
        />
        {/*
          External shading — per-facade overhang depth (m). Brief 41 §V
          row 3 acceptance: "Reduce solar gain via shading → cooling
          demand drops; heating demand may rise slightly". South facade
          is typically the dominant solar driver; expose all four for
          completeness.
        */}
        <div className="pt-1 pb-0.5 text-xxs text-mid-grey/80 uppercase tracking-wider font-medium">External shading — overhang depth</div>
        {['south', 'east', 'west', 'north'].map(face => (
          <NumberInput
            key={`overhang-${face}`}
            label={`${face[0].toUpperCase() + face.slice(1)} overhang`}
            value={b.shading_overhang?.[face]?.depth_m}
            onChange={(v) => capture({ id: newPatchId(), op: 'set', path: `building.shading_overhang.${face}.depth_m`, value: v, source: 'inline' })}
            unit="m"
            step={0.1}
            min={0}
          />
        ))}
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
        {/*
          Occupancy density — number of people per the chosen basis
          (per_room / per_m2 / total / per_workstation). Brief 41 §V
          row 8 acceptance: "Reduce occupancy density → people gain
          narrows; heating demand rises slightly; cooling demand
          drops; lighting + equipment gains drop if linked to
          occupancy; DHW drops on per-person basis."
          The basis is held on params.occupancy.density.basis (not
          editable here in Part 4.1 — change basis through the
          Internal Gains module). User edits the value only.
        */}
        <NumberInput
          label={`Density (${b.occupancy?.density?.basis ?? 'per_room'})`}
          value={b.occupancy?.density?.value}
          onChange={(v) => capture({ id: newPatchId(), op: 'set', path: 'building.occupancy.density.value', value: v, source: 'inline' })}
          step={0.1}
          min={0}
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

      {/* Heating systems. Brief 43 Part 2: section always rendered so
          the user can `+ Add` the first heating system as part of the
          intervention even when the baseline has none. */}
      <Section title="Heating systems" defaultOpen={false}>
        {(sysCfg.heating ?? []).map(sys => (
          <ServiceBlock key={sys.id} system={sys} service="heating" capture={capture} librarySystems={librarySystems} />
        ))}
        {(sysCfg.heating ?? []).length === 0 && (
          <p className="text-xxs text-mid-grey/70 italic">No heating systems in the current config — add one to capture an `op: 'add'` patch.</p>
        )}
        <AddSystemAffordance service="heating" librarySystems={librarySystems} onCapture={capture} />
      </Section>

      {/* Cooling systems */}
      <Section title="Cooling systems" defaultOpen={false}>
        {(sysCfg.cooling ?? []).map(sys => (
          <ServiceBlock key={sys.id} system={sys} service="cooling" capture={capture} librarySystems={librarySystems} />
        ))}
        {(sysCfg.cooling ?? []).length === 0 && (
          <p className="text-xxs text-mid-grey/70 italic">No cooling systems in the current config.</p>
        )}
        <AddSystemAffordance service="cooling" librarySystems={librarySystems} onCapture={capture} />
      </Section>

      {/* DHW systems */}
      <Section title="DHW systems" defaultOpen={false}>
        {(sysCfg.dhw ?? []).map(sys => (
          <ServiceBlock key={sys.id} system={sys} service="dhw" capture={capture} librarySystems={librarySystems} />
        ))}
        {(sysCfg.dhw ?? []).length === 0 && (
          <p className="text-xxs text-mid-grey/70 italic">No DHW systems in the current config.</p>
        )}
        <AddSystemAffordance service="dhw" librarySystems={librarySystems} onCapture={capture} />
      </Section>

      {/* Ventilation systems */}
      <Section title="Ventilation systems" defaultOpen={false}>
        {(sysCfg.ventilation ?? []).map(sys => (
          <ServiceBlock key={sys.id} system={sys} service="ventilation" capture={capture} librarySystems={librarySystems} />
        ))}
        {(sysCfg.ventilation ?? []).length === 0 && (
          <p className="text-xxs text-mid-grey/70 italic">No ventilation systems in the current config.</p>
        )}
        <AddSystemAffordance service="ventilation" librarySystems={librarySystems} onCapture={capture} />
      </Section>

      {/* Lighting controls (thin entries) */}
      <Section title="Lighting controls" defaultOpen={false}>
        {(sysCfg.lighting ?? []).map(sys => (
          <ServiceBlock key={sys.id} system={sys} service="lighting" capture={capture} librarySystems={librarySystems} />
        ))}
        {(sysCfg.lighting ?? []).length === 0 && (
          <p className="text-xxs text-mid-grey/70 italic">No lighting entries in the current config.</p>
        )}
        <AddSystemAffordance service="lighting" librarySystems={librarySystems} onCapture={capture} />
      </Section>

      {/* Small power controls (thin entries) */}
      <Section title="Small power controls" defaultOpen={false}>
        {(sysCfg.small_power ?? []).map(sys => (
          <ServiceBlock key={sys.id} system={sys} service="small_power" capture={capture} librarySystems={librarySystems} />
        ))}
        {(sysCfg.small_power ?? []).length === 0 && (
          <p className="text-xxs text-mid-grey/70 italic">No small power entries in the current config.</p>
        )}
        <AddSystemAffordance service="small_power" librarySystems={librarySystems} onCapture={capture} />
      </Section>
    </div>
  )
}
