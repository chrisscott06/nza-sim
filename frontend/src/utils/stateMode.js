/**
 * stateMode.js — single home for state-routing logic.
 *
 * Per `docs/state_contracts.md`, NZA Sim models buildings progressively in
 * five states (1 envelope / 2 gains / 2.5 operation / 3 full / 4 reconciliation).
 * Each state has a defined `inputs_used` list and ignores everything else.
 *
 * State isolation is non-negotiable: a State 1 computation must produce identical
 * output regardless of any value in gains/operation/systems. Sprinkling
 * `if (mode === 'envelope-only')` checks through the codebase is how state isolation
 * leaks. Every state-aware decision routes through this file.
 *
 * Mode-string naming follows the state contract:
 *   'envelope-only'             → State 1
 *   'envelope-gains'            → State 2 (future)
 *   'envelope-gains-operation'  → State 2.5 (future)
 *   'full'                      → State 3 (current default)
 *
 * Established by Brief 26 Part 0 (mode-routing scaffold). Brief 26 Part 3
 * fills in the real envelope-only physics; later parts add State 2 / 2.5.
 */

/** Canonical mode identifiers — match the state contract's `mode` field. */
export const MODES = {
  ENVELOPE_ONLY:            'envelope-only',          // State 1
  ENVELOPE_GAINS:           'envelope-gains',         // State 2
  ENVELOPE_GAINS_OPERATION: 'envelope-gains-operation', // State 2.5
  FULL:                     'full',                   // State 3
}

/** Map mode → numeric state per contract `state` field. */
export const STATE_NUMBER = {
  'envelope-only':            1,
  'envelope-gains':           2,
  'envelope-gains-operation': 2.5,
  'full':                     3,
}

/** Default mode for any component that doesn't explicitly request one. */
export const DEFAULT_MODE = MODES.FULL

export const isEnvelopeOnly        = (mode) => mode === MODES.ENVELOPE_ONLY
export const isEnvelopeGains       = (mode) => mode === MODES.ENVELOPE_GAINS
export const isEnvelopeGainsOp     = (mode) => mode === MODES.ENVELOPE_GAINS_OPERATION
export const isFull                = (mode) => mode === MODES.FULL

/**
 * Inputs an envelope-only computation is *forbidden* from reading. Any code path
 * that consumes these while in envelope-only mode is a contract violation.
 * Exported so a test harness (Brief 26 Part 9 regression) can enumerate them.
 */
export const FORBIDDEN_ENVELOPE_ONLY_INPUTS = Object.freeze([
  // Legacy occupancy inputs — State 2 territory (kept while
  // `nza_engine/generators/hvac_dhw.py` still reads them).
  'params.num_bedrooms',
  'params.occupancy_rate',
  'params.people_per_room',
  'systems.lighting_power_density',
  'systems.equipment_power_density',
  'systems.lighting_control',
  // v2.3 occupancy as a first-class block — State 2 territory.
  // (Brief 27 Part 0/1 introduced these; Part 2 enforces them.)
  'occupancy.occupancy_rate',
  'occupancy.density',
  'occupancy.sensible_w_per_person',
  'occupancy.latent_w_per_person',
  'occupancy.schedule',
  'occupancy.schedule.exceptions',
  // v2.3 gains block — State 2 territory.
  'gains.lighting.magnitude',
  'gains.lighting.relationship_to_occupancy',
  'gains.lighting.spill_minutes',
  'gains.lighting.daylight_factor',
  'gains.lighting.schedule',
  'gains.equipment.baseload',
  'gains.equipment.active',
  'gains.equipment.relationship_to_occupancy',
  'gains.equipment.standby_factor',
  'gains.equipment.schedule',
  // Systems — State 3 territory
  'systems.space_heating',
  'systems.space_cooling',
  'systems.dhw',
  'systems.ventilation',
  'systems.hvac_type',
  'systems.dhw_primary',
  'systems.dhw_preheat',
  'systems.dhw_setpoint',
  'systems.ventilation_type',
  'systems.ventilation_control',
  'systems.sfp_override',
  'systems.cop_heating',
  'systems.mvhr_efficiency',
  // Operable windows — State 2.5 territory
  'openings.schedule',
  'openings.{face}.openable_fraction',
])

export function isForbiddenAtEnvelopeOnly(path) {
  if (!path) return false
  const normalised = path.replace(/openings\.[ns ew]+/i, 'openings.{face}')
  return FORBIDDEN_ENVELOPE_ONLY_INPUTS.includes(normalised)
}

/**
 * Inputs an envelope-gains (State 2) computation is *forbidden* from reading.
 * State 2 admits occupancy.* + gains.* (v2.3) but forbids real systems
 * (State 3 territory) and operable windows (State 2.5 territory). Legacy
 * occupancy fields are also forbidden where superseded by v2.3 inputs;
 * `params.num_bedrooms` is NOT forbidden because it remains the count input
 * for `occupancy.density.basis === 'per_room'`.
 *
 * Brief 27 Part 8 isolation regression iterates this list against
 * _calculateState2 / assemble_epjson(mode='envelope-gains').
 */
export const FORBIDDEN_ENVELOPE_GAINS_INPUTS = Object.freeze([
  // Legacy occupancy fields superseded by v2.3 occupancy block.
  // params.num_bedrooms is INTENTIONALLY ABSENT — still used as the room
  // count for per_room density basis.
  'params.occupancy_rate',
  'params.people_per_room',
  // Legacy load fields superseded by v2.3 gains block.
  'systems.lighting_power_density',
  'systems.equipment_power_density',
  'systems.lighting_control',
  // Systems — State 3 territory
  'systems.space_heating',
  'systems.space_cooling',
  'systems.dhw',
  'systems.ventilation',
  'systems.hvac_type',
  'systems.dhw_primary',
  'systems.dhw_preheat',
  'systems.dhw_setpoint',
  'systems.ventilation_type',
  'systems.ventilation_control',
  'systems.sfp_override',
  'systems.cop_heating',
  'systems.mvhr_efficiency',
  // Operable windows — State 2.5 territory
  'openings.schedule',
  'openings.{face}.openable_fraction',
])

export function isForbiddenAtEnvelopeGains(path) {
  if (!path) return false
  const normalised = path.replace(/openings\.[ns ew]+/i, 'openings.{face}')
  return FORBIDDEN_ENVELOPE_GAINS_INPUTS.includes(normalised)
}

/**
 * Loss-element rendering order per mode. Imported by HeatBalance views to
 * filter and order loss items. Each mode defines what *belongs on the losses
 * side* — items not in the list are hidden, even if data is present.
 *
 * envelope-only: only envelope conduction + the two ventilation streams.
 * Cooling (a system service) and openings_window (State 2.5 input) excluded.
 * Ventilation never combined — `infiltration` legacy key listed alongside
 * the State-1-correct `fabric_leakage` / `permanent_vents` pair while Brief
 * 26 Part 3 swaps in the new physics.
 *
 * full: existing canonical order (preserves current behaviour).
 */
const LOSS_ORDERS = {
  [MODES.ENVELOPE_ONLY]: [
    'external_wall',
    'roof',
    'ground_floor',
    'glazing',
    'thermal_bridging',
    'fabric_leakage',
    'permanent_vents',
    // Legacy keys retained so the view doesn't regress before Part 3 lands.
    'infiltration',
    'openings_louvre',
  ],
  [MODES.FULL]: [
    'external_wall',
    'roof',
    'ground_floor',
    'glazing',
    'infiltration',
    'openings_louvre',
    'openings_window',
    'ventilation',
    'cooling',
  ],
}

/**
 * Gain-element rendering order per mode. envelope-only sees only solar;
 * People / Equipment / Lighting are State 2, mechanical Heating is a State 3
 * service. full keeps the existing canonical order.
 */
const GAIN_ORDERS = {
  [MODES.ENVELOPE_ONLY]: [
    'solar_south',
    'solar_east',
    'solar_west',
    'solar_north',
  ],
  [MODES.FULL]: [
    'solar_south',
    'solar_east',
    'solar_west',
    'solar_north',
    'people',
    'equipment',
    'lighting',
    'heating',
  ],
}

/** Get the canonical loss-element order for a given mode. */
export function loadOrderFor(mode) {
  return LOSS_ORDERS[mode] ?? LOSS_ORDERS[DEFAULT_MODE]
}

/** Get the canonical gain-element order for a given mode. */
export function gainOrderFor(mode) {
  return GAIN_ORDERS[mode] ?? GAIN_ORDERS[DEFAULT_MODE]
}

/**
 * Human-readable badge text for the state-mode badge shown above the
 * Heat Balance view. Briefs 26+ surface this on every state-locked module.
 */
export function modeBadgeText(mode) {
  switch (mode) {
    case MODES.ENVELOPE_ONLY:            return 'Envelope only — no occupancy, no systems, no operable windows'
    case MODES.ENVELOPE_GAINS:           return 'Envelope + internal gains — no systems, no operable windows'
    case MODES.ENVELOPE_GAINS_OPERATION: return 'Envelope + gains + passive operation — no mechanical systems'
    case MODES.FULL:                     return 'Full model — envelope, gains, operation, and systems'
    default:                             return ''
  }
}
