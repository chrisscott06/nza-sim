/**
 * AddSystemButton.jsx — Brief 40 Part 3 (2026-05-19)
 *
 * Per-service "+ Add system" affordance. Click opens a small modal with
 * two paths:
 *   1) Load from library — picks a saved system from `params.library_systems`
 *      filtered to the current service
 *   2) Start blank — inserts a system with sensible defaults per the source
 *
 * Defaults at insert time (brief Part 3 step 3.4):
 *   - Heating: GSHP/ASHP → ambient_air, SCOP 3.0; gas → gas, η 0.92;
 *     electric → electricity, η 1.0
 *   - Cooling: electricity, SEER 3.0
 *   - DHW: electricity η 0.95 (immersion) / gas η 0.85 / heat pump SCOP 2.5
 *   - Ventilation: SFP 1.5, recovery 0% (MEV); SFP 1.8, recovery 82% (MVHR)
 *   - Lighting: control_mechanism 'constant', control_factor 1.0
 *   - Small power: control_factor 1.0
 *
 * Library entries are namespaced by service — a heating system can't be
 * loaded into a cooling section. Surfaced in the modal as filtered list
 * + dimmed "wrong service" entries.
 */

import { useState } from 'react'
import { SERVICE_COLOURS } from './SystemEditorCard.jsx'

// Per-service blank-add archetypes. User picks one, gets a seeded system.
//
// VRF + DX additions (2026-05-19) — refrigerant-based systems alongside
// the existing wet-system (boiler, chiller) + air-source / ground-source
// heat pump options:
//
//   VRF (Variable Refrigerant Flow): refrigerant distributed directly to
//   indoor units, heat-pump cycle in both modes. Appears in both heating
//   and cooling archetype lists because a real VRF system serves both
//   services on the same refrigerant loop. For now each archetype creates
//   an INDEPENDENT v40 entry (one in heating, one in cooling) — the user
//   can pick "VRF" in both heating + cooling sections to model a dual-
//   function installation. Linked-system semantics (shared identity +
//   heat-recovery credit between paired heating + cooling demands) is
//   not yet in the schema — that's a Brief 40 follow-up candidate
//   (potential Part 5d or successor brief).
//
//   DX split: direct-expansion split unit, cooling-only. Common backup
//   cooling for areas not served by VRF (comms rooms, plant rooms with
//   year-round cooling). Refrigerant-based like VRF but without the
//   heating mode.
const BLANK_ARCHETYPES = {
  heating: [
    { key: 'gas_boiler',     label: 'Gas boiler',                source: 'gas',             efficiency_metric: 0.92 },
    { key: 'vrf',            label: 'VRF (heat pump, refrigerant)', source: 'ambient_air',  efficiency_metric: 4.5  },
    { key: 'ashp',           label: 'Air-source heat pump',      source: 'ambient_air',     efficiency_metric: 3.0  },
    { key: 'gshp',           label: 'Ground-source heat pump',   source: 'ambient_ground',  efficiency_metric: 3.5  },
    { key: 'electric',       label: 'Electric (direct)',         source: 'electricity',     efficiency_metric: 1.0  },
    { key: 'district',       label: 'District heating',          source: 'district_heating', efficiency_metric: 0.95 },
    { key: 'biomass',        label: 'Biomass boiler',            source: 'biomass',         efficiency_metric: 0.85 },
    { key: 'oil_boiler',     label: 'Oil boiler',                source: 'oil',             efficiency_metric: 0.88 },
  ],
  cooling: [
    { key: 'vrf',            label: 'VRF (refrigerant)',          source: 'electricity',     efficiency_metric: 3.5 },
    { key: 'dx_split',       label: 'DX split (refrigerant)',     source: 'electricity',     efficiency_metric: 4.0 },
    { key: 'vapour_comp',    label: 'Vapour-compression chiller (wet)', source: 'electricity', efficiency_metric: 3.0 },
    { key: 'district',       label: 'District cooling',           source: 'district_cooling', efficiency_metric: 1.0 },
  ],
  dhw: [
    { key: 'immersion',      label: 'Electric immersion',         source: 'electricity', efficiency_metric: 0.95 },
    { key: 'gas_boiler',     label: 'Gas combi / boiler',          source: 'gas',         efficiency_metric: 0.85 },
    { key: 'heat_pump',      label: 'Heat pump (ASHP)',            source: 'ambient_air', efficiency_metric: 2.5  },
    { key: 'district',       label: 'District heating',            source: 'district_heating', efficiency_metric: 0.95 },
  ],
  ventilation: [
    { key: 'mev',            label: 'MEV (extract only)',  source: 'electricity',
      efficiency_metric: { sfp_w_per_lps: 1.5, recovery_sensible_pct: 0,  recovery_latent_pct: 0 } },
    { key: 'mvhr',           label: 'MVHR (with recovery)', source: 'electricity',
      efficiency_metric: { sfp_w_per_lps: 1.8, recovery_sensible_pct: 82, recovery_latent_pct: 0 } },
  ],
  lighting: [
    { key: 'constant',       label: 'Lighting (no controls)',     control_mechanism: 'constant',          control_factor: 1.0  },
    { key: 'dimming',        label: 'Lighting (daylight dimming)', control_mechanism: 'daylight_dimming', control_factor: 0.70 },
  ],
  small_power: [
    { key: 'baseline',       label: 'Small power (baseline)', control_mechanism: 'constant', control_factor: 1.0 },
  ],
}

// Build a new system entry from an archetype + parent service.
function seedSystem(service, arch) {
  const id = `sys_${service}_${Date.now()}_${Math.floor(Math.random() * 1000)}`
  const base = {
    id,
    label:       arch.label,
    service,
    share_pct:   100,
    capacity_kw: null,
    notes:       '',
    control_mechanism:   arch.control_mechanism ?? 'constant',
    control_schedule_id: null,
    // Brief 40 Part 5b Section B (2026-05-19): new systems seed enabled.
    // Engine treats missing `enabled` as true for backward compat with
    // existing v40 entries, but new systems get the field explicitly.
    enabled: true,
  }
  if (service === 'heating' || service === 'cooling') {
    return {
      ...base,
      source:            arch.source,
      efficiency_metric: arch.efficiency_metric,
      setpoint:          null,   // follow comfort by default
    }
  }
  if (service === 'dhw') {
    return {
      ...base,
      source:                            arch.source,
      efficiency_metric:                 arch.efficiency_metric,
      setpoint:                          60,    // legionella
      tap_outlet_temp_c:                 40,
      cold_supply_temp_c:                10,
      demand_basis:                      'per_m2',
      demand_litres_per_m2_day:          1.1,
      demand_litres_per_person_per_day:  null,
    }
  }
  if (service === 'ventilation') {
    return {
      ...base,
      source:               arch.source,
      efficiency_metric:    arch.efficiency_metric,
      flow_rate:            10,
      flow_rate_basis:      'per_person',
      setpoint:             null,
      defrost_penalty_kwh:  null,
    }
  }
  if (service === 'lighting' || service === 'small_power') {
    return {
      ...base,
      source:            'electricity',
      efficiency_metric: null,
      setpoint:          null,
      control_factor:    arch.control_factor ?? 1.0,
    }
  }
  return base
}

export default function AddSystemButton({ service, librarySystems = [], onAdd }) {
  const [open, setOpen] = useState(false)
  const accent = SERVICE_COLOURS[service] ?? '#00AEEF'
  const archetypes = BLANK_ARCHETYPES[service] ?? []
  const filteredLibrary = (librarySystems ?? []).filter(s => s?.service === service)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-xxs px-2 py-1 rounded border border-dashed text-mid-grey hover:text-navy hover:bg-off-white/50 transition-colors"
        style={{ borderColor: accent + '60' }}
      >
        + Add system
      </button>

      {open && (
        <>
          {/* Click-away */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Modal panel */}
          <div
            className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border rounded shadow-lg p-2 space-y-2 max-h-[400px] overflow-y-auto"
            style={{ borderColor: accent + '40' }}
          >
            {filteredLibrary.length > 0 && (
              <div>
                <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">From library</p>
                <div className="space-y-0.5">
                  {filteredLibrary.map(lib => (
                    <button
                      key={lib.id ?? lib.label}
                      onClick={() => {
                        // Library entry → reseed with fresh id + share 100
                        const fresh = { ...lib, id: `sys_${service}_${Date.now()}_${Math.floor(Math.random() * 1000)}`, share_pct: 100 }
                        onAdd(fresh)
                        setOpen(false)
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
                {archetypes.map(arch => (
                  <button
                    key={arch.key}
                    onClick={() => {
                      onAdd(seedSystem(service, arch))
                      setOpen(false)
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
      )}
    </div>
  )
}
