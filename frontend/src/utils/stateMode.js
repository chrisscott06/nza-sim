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
  // v2.3 gains block — State 2 territory. Kept on the forbidden list
  // for legacy projects that have not been migrated yet (the engine no
  // longer reads them, but the test asserts byte-identity regardless).
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
  // v2.4 multi-profile gains — Brief 27 Revised Part 9.
  'gains.lighting.profiles',
  'gains.equipment.profiles',
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

// ── Brief 28a Part 8: State-aware Dynamic run detection ─────────────────────
//
// When the user clicks "Run Dynamic" in the top bar, we want the simulation
// triggered to match the current project state -- envelope-only if only the
// envelope is defined, envelope-gains if gains added, envelope-gains-operation
// if operable windows configured, full if real systems are set.
//
// Foundation: Brief 28 prereq's envelope-only EP pipeline + the
// `simulation_mode` column on `simulation_runs`. The backend `/simulate`
// endpoint already accepts a `mode` query param; this helper provides the
// frontend side of the detection.
//
// Predicates are conservative: return true only when the config is GENUINELY
// populated for that state's inputs. A populated-but-zeroed config returns
// false. Matches the conservativeness of the FORBIDDEN_*_INPUTS lists.

const IDEAL_LOADS_SYSTEM_KEYS = new Set([
  '', 'none', 'none_heating', 'none_cooling',
  'ideal_loads', 'ideal_loads_heating', 'ideal_loads_cooling',
])

/**
 * Does the project have at least one real (non-ideal-loads) HVAC system
 * configured? Real systems put the project at State 3.
 *
 * Checks systems.space_heating.primary.system (the v2.x demand-keyed shape).
 * Falls back to systems.hvac_type for legacy projects that haven't migrated
 * to the demand-keyed shape yet.
 */
export function hasRealSystems(systems) {
  if (!systems) return false
  const sh = systems.space_heating?.primary?.system
  if (sh && !IDEAL_LOADS_SYSTEM_KEYS.has(String(sh))) return true
  const sc = systems.space_cooling?.primary?.system
  if (sc && !IDEAL_LOADS_SYSTEM_KEYS.has(String(sc))) return true
  const dhw = systems.dhw?.primary?.system
  if (dhw && !IDEAL_LOADS_SYSTEM_KEYS.has(String(dhw))) return true
  // Legacy fallback
  const hvac = systems.hvac_type
  if (hvac && !IDEAL_LOADS_SYSTEM_KEYS.has(String(hvac))) return true
  return false
}

/**
 * Does the project have operable windows configured? Operable windows
 * (controlled openings) put the project at State 2.5.
 *
 * Checks for a non-empty openings.schedule object OR any face with a
 * non-zero openable_fraction.
 */
export function hasOperableWindows(building) {
  if (!building?.openings) return false
  const sched = building.openings.schedule
  if (sched && typeof sched === 'object') {
    const keys = Object.keys(sched)
    if (keys.length > 0) return true
  }
  for (const face of ['north', 'south', 'east', 'west']) {
    const f = building.openings[face]
    const frac = Number(f?.openable_fraction ?? 0)
    if (frac > 0) return true
  }
  return false
}

/**
 * Does the project have non-zero internal gains configured? Any of:
 *   - occupancy.density.value > 0 (v2.3 occupancy block)
 *   - any lighting profile with magnitude.value > 0
 *   - any equipment profile with baseload.value > 0 OR active.value > 0
 *   - legacy params.num_bedrooms > 0 (pre-v2.3 occupancy)
 *
 * Returns true if ANY of these is true. Conservative: a populated-but-zeroed
 * config returns false.
 */
export function hasInternalGains(building) {
  if (!building) return false
  // v2.3 occupancy
  const occDensity = Number(building.occupancy?.density?.value ?? 0)
  if (occDensity > 0) return true
  // Legacy num_bedrooms occupancy
  const numBeds = Number(building.num_bedrooms ?? 0)
  if (numBeds > 0) return true
  // v2.4 lighting profiles
  const lightingProfiles = building.gains?.lighting?.profiles ?? []
  for (const p of lightingProfiles) {
    if (Number(p?.magnitude?.value ?? 0) > 0) return true
  }
  // v2.4 equipment profiles
  const equipmentProfiles = building.gains?.equipment?.profiles ?? []
  for (const p of equipmentProfiles) {
    if (Number(p?.baseload?.value ?? 0) > 0) return true
    if (Number(p?.active?.value ?? 0) > 0) return true
  }
  return false
}

/**
 * Detect which state the project's current config represents, returning the
 * canonical mode string for use with `/api/projects/{id}/simulate?mode=...`.
 *
 * Order matters — returns the MOST SPECIFIC state that matches. A project
 * with both gains and systems is `'full'`, not `'envelope-gains'`.
 *
 * Returns: 'envelope-only' | 'envelope-gains' | 'envelope-gains-operation' | 'full'
 */
export function detectProjectState(building, systems) {
  if (hasRealSystems(systems))         return MODES.FULL
  if (hasOperableWindows(building))    return MODES.ENVELOPE_GAINS_OPERATION
  if (hasInternalGains(building))      return MODES.ENVELOPE_GAINS
  return MODES.ENVELOPE_ONLY
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
