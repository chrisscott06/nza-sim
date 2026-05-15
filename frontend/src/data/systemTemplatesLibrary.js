/**
 * systemTemplatesLibrary.js — V1 starter library of HVAC + DHW + ventilation
 * system templates for Brief 28f Part 5.3 (State 3 systems UI integration).
 *
 * Purpose
 * -------
 * State 3 v2.5 engine resolves every sub-system reference by `library_id`
 * against a library `system_templates` collection. This file is the V1
 * source of that collection — a frontend constants file rather than a
 * backend API endpoint, per Brief 28f Part 5 decision (b).
 *
 * The shape below is **deliberately structured to map 1:1 to a future
 * backend `system_templates` table**:
 *   each top-level object → one row;
 *   each scalar field     → one column;
 *   `supports_services`   → join table or JSON column;
 *   `provenance`          → JSON column or normalised metadata table.
 * When backend persistence lands, migrating this file becomes a one-shot
 * import script.
 *
 * Consumer pattern
 * ----------------
 *   import { SYSTEM_TEMPLATES_LIBRARY } from '@/data/systemTemplatesLibrary'
 *   const libraryData = { constructions: [...], system_templates: SYSTEM_TEMPLATES_LIBRARY }
 *   calculateInstant(building, constructions, {}, libraryData, ...)
 *
 * Each template has:
 *   id                  — stable identifier (engine reads this; never changes)
 *   name                — short human-readable label for UI pickers
 *   description         — longer description with data-provenance flag in
 *                         plain English (so users reading the template
 *                         can see where the number came from)
 *   supports_services   — array of services the template can serve
 *                         (subset of ['heating','cooling','dhw','ventilation'])
 *   {service}_efficiency — scalar per supported service (see contract v2.5):
 *                         heating_scop, cooling_seer, dhw_seasonal_efficiency,
 *                         hre (vent only)
 *   fuel                — 'electricity' | 'gas'  (vent items still set
 *                         'electricity' for fan power)
 *   provenance          — structured metadata for programmatic use:
 *                         { source, confidence, reference, notes }
 *                         (mirrors the project provenance schema from
 *                         docs/state_contracts.md cross-cutting concepts)
 *
 * Per-project override pattern (future work, NOT implemented yet)
 * ---------------------------------------------------------------
 * Library values are the canonical defaults. Real-world calibration will
 * surface cases where the actual installed unit performs differently from
 * design intent. Pattern for future:
 *
 *   systems.heating.primary.heating_scop_override        — overrides template.heating_scop
 *   systems.cooling.primary.cooling_seer_override        — overrides template.cooling_seer
 *   systems.dhw.primary.dhw_seasonal_efficiency_override — overrides template.dhw_seasonal_efficiency
 *
 * Engine resolution rule (when implemented): `efficiency = override ?? template`
 * The library remains the source of truth; overrides are per-project tuning,
 * tracked separately for provenance (e.g. "calibrated 2026-06 against
 * measured Q1 2026 data").
 *
 * UI for editing overrides + the engine wiring land in a later brief —
 * triggered when measured-data ingest + calibration workflow exposes the
 * need. Until then, calibration adjustments require library edits (acceptable
 * for V1 with one canonical project).
 */

export const SYSTEM_TEMPLATES_LIBRARY = [
  // ── Heating + cooling (dual-function) ─────────────────────────────────────
  {
    id:                'vrf_heat_recovery_dual_function',
    name:              'VRF heat recovery (heating + cooling)',
    description:
      'Toshiba SMMSe-class VRF heat-recovery unit, dual-function — single ' +
      'physical system serves both heating and cooling. BRUKL design-intent ' +
      'values per Bridgewater Fabric & Systems Modelling Notes; real-world ' +
      'calibration is likely to show lower COP/SEER due to part-load operation, ' +
      'defrost losses, and refrigerant degradation over time.',
    supports_services: ['heating', 'cooling'],
    heating_scop:      5.12,
    cooling_seer:      3.51,
    fuel:              'electricity',
    provenance: {
      source:     'BRUKL design intent',
      confidence: 'medium',
      reference:  'Bridgewater Fabric & Systems Modelling Notes',
      notes:      'Real-world likely lower; will be a calibration target',
    },
  },

  // ── Cooling-only ──────────────────────────────────────────────────────────
  {
    id:                'dx_split_cooling',
    name:              'DX split (cooling-only)',
    description:
      'Direct-expansion split unit, cooling-only. Typically used as backup ' +
      'cooling for areas not served by the primary VRF system (e.g. comms ' +
      'rooms, plant rooms with year-round cooling load). Design SEER value; ' +
      'real-world likely lower under UK climate.',
    supports_services: ['cooling'],
    cooling_seer:      5.62,
    fuel:              'electricity',
    provenance: {
      source:     'BRUKL design intent',
      confidence: 'medium',
      reference:  'Bridgewater Fabric & Systems Modelling Notes',
      notes:      'Real-world likely lower; calibration target',
    },
  },

  // ── Heating-only ──────────────────────────────────────────────────────────
  {
    id:                'electric_panel_heater',
    name:              'Electric panel heater',
    description:
      'Resistive electric panel heater. COP = 1.0 exactly by first principles ' +
      '(all input electricity becomes delivered heat). Used in stair cores, ' +
      'circulation spaces, or back-up zones where the primary VRF cannot ' +
      'reach. No realistic-world degradation — resistance heating is COP 1 ' +
      'regardless of operation.',
    supports_services: ['heating'],
    heating_scop:      1.0,
    fuel:              'electricity',
    provenance: {
      source:     'first principles',
      confidence: 'high',
      reference:  'Resistive electric = COP 1 by definition',
      notes:      'Not a calibration target; physical certainty',
    },
  },

  // ── DHW (primary) ─────────────────────────────────────────────────────────
  {
    id:                'ashp_dhw_preheat',
    name:              'Air-source heat pump (DHW preheat)',
    description:
      'ASHP serving as primary DHW heat source, typically preheating water ' +
      'to ~50 °C. Final temperature lift to 60 °C is handled by the gas ' +
      'boiler. Design SCOP; real-world likely lower under continuous high-' +
      'demand operation (Home Office regime) due to defrost cycles and the ' +
      'COP drop at cold ambient temperatures.',
    supports_services: ['dhw'],
    dhw_seasonal_efficiency: 2.8,
    fuel:              'electricity',
    provenance: {
      source:     'BRUKL design intent',
      confidence: 'medium',
      reference:  'Bridgewater Fabric & Systems Modelling Notes',
      notes:      'Real-world likely lower under continuous high-demand; calibration target',
    },
  },

  // ── DHW (secondary) ───────────────────────────────────────────────────────
  {
    id:                'gas_boiler_calorifier',
    name:              'Gas boiler with calorifier',
    description:
      'Gas-fired condensing boiler with hot-water calorifier. Serves as ' +
      'secondary DHW path and provides the final temperature lift on water ' +
      'preheated by the ASHP. Seasonal efficiency reflects BRUKL design ' +
      'value for a modern condensing boiler.',
    supports_services: ['dhw'],
    dhw_seasonal_efficiency: 0.88,
    fuel:              'gas',
    provenance: {
      source:     'BRUKL design intent',
      confidence: 'medium',
      reference:  'Bridgewater Fabric & Systems Modelling Notes',
      notes:      'Within typical UK condensing-boiler range 0.85-0.92',
    },
  },

  // ── Ventilation ───────────────────────────────────────────────────────────
  // For ventilation, the engine reads flow_l_s + sfp_w_per_l_s + hre from the
  // per-system inline fields (not the template). The template's hre + sfp
  // values below serve as UI defaults — when the user picks this template in
  // the Systems UI, these values pre-fill the system form. The engine itself
  // validates that the template `supports_services` includes 'ventilation'
  // and that `hre` is present (which it is below). flow_l_s is always
  // per-system (no sensible template default for a flow rate).
  {
    id:                'mvhr_with_hr',
    name:              'MVHR with heat recovery',
    description:
      'Mechanical ventilation with heat recovery — Toshiba VN-M1000HE class ' +
      'or similar. Provides supply + extract with cross-flow heat exchanger. ' +
      'HRE 80% is typical certified manufacturer value; real-world annual ' +
      'effectiveness may be lower (frost protection cycles, bypass operation ' +
      'during summer free cooling).',
    supports_services: ['ventilation'],
    hre:               0.8,
    default_sfp_w_per_l_s: 1.4,    // UI default; engine reads inline vs.sfp_w_per_l_s
    fuel:              'electricity',
    provenance: {
      source:     'Manufacturer test data',
      confidence: 'medium-high',
      reference:  'Toshiba VN-M1000HE datasheet (typical of UK hotel installations)',
      notes:      'Annual effectiveness may be lower than rated; calibration target',
    },
  },

  {
    id:                'wc_extract_no_hr',
    name:              'WC extract (no heat recovery)',
    description:
      'Extract-only ventilation for WC, plant, and back-of-house areas. No ' +
      'heat recovery. Low SFP because of short ductwork and small fan motor ' +
      'sizing. Typical for code-minimum extract applications.',
    supports_services: ['ventilation'],
    hre:               0.0,
    default_sfp_w_per_l_s: 0.4,
    fuel:              'electricity',
    provenance: {
      source:     'Design standard',
      confidence: 'high',
      reference:  'Building Regs Part F minimum extract — typical SFP range 0.3-0.5',
      notes:      'Low SFP is typical for short-duct extract; not a calibration target',
    },
  },
]

/**
 * Lookup helper — convenient for UI pickers + tests. Engine resolves via
 * libraryData.system_templates directly, but UI/tests can use this for
 * imports without going through libraryData.
 */
export function getSystemTemplate(id) {
  return SYSTEM_TEMPLATES_LIBRARY.find(t => t.id === id) ?? null
}

/**
 * Filter helper — list templates that support a service. Used by the UI
 * pickers to populate "choose a heating system" / "choose a cooling system"
 * / etc dropdowns.
 */
export function getSystemTemplatesForService(service) {
  return SYSTEM_TEMPLATES_LIBRARY.filter(t => Array.isArray(t.supports_services) && t.supports_services.includes(service))
}
