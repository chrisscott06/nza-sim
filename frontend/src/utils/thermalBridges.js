/**
 * thermalBridges.js
 *
 * Brief 28-TB-Simple Gate TB-V1: junction-based thermal bridging (ISO 14683
 * standard physics) — supersedes the SBEM α-multiplier convention Brief 28L
 * introduced.
 *
 * Public API:
 *   computeThermalBridges(building, geometry, areaUaWperK)
 *     → { mode, multiplier, total_H_TB_W_per_K, junctions: [...],
 *         derived_alpha_pct, y_value_W_per_m2K_derived }
 *
 * The engine (instantCalc.js _calculateEnvelopeOnly + _calculateState2) calls
 * this once per run and consumes `total_H_TB_W_per_K` as the building's
 * thermal-bridge heat transfer coefficient:
 *
 *   TB_loss_h = total_H_TB × max(0, T_setpoint − T_out)
 *   TB_gain_h = total_H_TB × max(0, T_out − T_setpoint_cooling)
 *
 * Modes (per Brief 28-TB-Simple Part A schema):
 *   'iso14683_auto'  — auto-compute junction lengths from geometry, apply
 *                      ISO 14683 default ψ values × user-set multiplier
 *   'manual_h_tb'    — user supplied H_TB directly in W/K (overrides
 *                      auto-computation entirely)
 *   'absent'         — H_TB = 0 (no thermal bridging modelled)
 *
 * Backward compat (Brief 28L migration):
 *   If `building.thermal_bridges` is absent BUT legacy
 *   `building.fabric.thermal_bridging_alpha_pct` is present, the helper
 *   logs a one-shot deprecation warning and treats as `manual_h_tb` with
 *   `h_tb_W_per_K = (alpha / 100) × area_UA`. This preserves the Brief 28L
 *   numerical behaviour for any project that hasn't been re-seeded under
 *   Brief 28-TB-Simple.
 *
 * Why area_UA is passed in rather than recomputed: instantCalc.js already
 * resolves the per-element U-values and areas to compute area_UA — we accept
 * it as an input to avoid duplicating that resolution here. The helper stays
 * pure-functional over (building, geometry, areaUaWperK).
 */

import {
  JUNCTION_TYPES, ISO14683_DEFAULT_PSI, JUNCTION_LABELS, ORDERED_JUNCTION_TYPES,
} from '../data/thermalBridgesLibrary.js'

// One-shot warning dedup so we don't spam the console once per hour-loop call.
let _legacyAlphaWarned = false

/**
 * Compute auto junction lengths from existing geometry, using the V1
 * approximations recorded in Brief 28-TB-Simple Part A.
 *
 * Inputs:
 *   building.length, .width, .num_floors, .floor_height      — geometry
 *   geometry.glazing.{north,south,east,west}                  — per-facade glazing m²
 *   building.operable_openings[] (optional)                   — doors / vents
 *
 * Returns map: { junction_type: length_in_metres }
 *
 * V1 window perimeter approximation: brief explicitly accepts the coarse
 * `4 × √(facade_glazing_area)` per facade as a placeholder until per-window
 * itemised geometry exists. Documented in the brief; called out inline.
 */
function autoComputeJunctionLengths(building, geometry) {
  const L  = Number(building?.length ?? 0)
  const W  = Number(building?.width ?? 0)
  const NF = Number(building?.num_floors ?? 0)
  const FH = Number(building?.floor_height ?? 0)
  const total_height = NF * FH
  const perimeter    = 2 * (L + W)

  // Per-facade window perimeter via 4 × √(area) — see V1 comment above.
  const glaz = geometry?.glazing ?? {}
  let window_perimeter_total = 0
  for (const face of ['north', 'south', 'east', 'west']) {
    const area = Number(glaz[face] ?? 0)
    if (area > 0) window_perimeter_total += 4 * Math.sqrt(area)
  }

  // Door perimeters: sum across opening_type === 'door' entries in
  // operable_openings. Each door's perimeter = 2 × (width + height), where
  // width = area / height. Falls back to a unit door if height is missing.
  let door_perimeter_total = 0
  const operable = Array.isArray(building?.operable_openings) ? building.operable_openings : []
  for (const o of operable) {
    if ((o?.opening_type ?? '').toLowerCase() !== 'door') continue
    const area = Number(o?.area_m2 ?? 0)
    const h    = Number(o?.height_m ?? 0)
    if (!(area > 0) || !(h > 0)) continue
    const width = area / h
    door_perimeter_total += 2 * (width + h)
  }

  return {
    [JUNCTION_TYPES.WALL_TO_ROOF]:               perimeter,
    [JUNCTION_TYPES.WALL_TO_GROUND_FLOOR]:       perimeter,
    [JUNCTION_TYPES.WALL_TO_INTERMEDIATE_FLOOR]: perimeter * Math.max(0, NF - 1),
    [JUNCTION_TYPES.EXTERNAL_CORNER]:            4 * total_height,
    [JUNCTION_TYPES.WINDOW_PERIMETER]:           window_perimeter_total,
    [JUNCTION_TYPES.DOOR_PERIMETER]:             door_perimeter_total,
  }
}

/**
 * Build the canonical thermal-bridge result for ISO 14683 auto-mode.
 * Returns the full result shape (mode, multiplier, total_H_TB_W_per_K,
 * junctions[], derived diagnostics).
 */
function computeAuto(building, geometry, multiplier) {
  const lengths = autoComputeJunctionLengths(building, geometry)
  const junctions = []
  let total_H_TB = 0

  for (const type of ORDERED_JUNCTION_TYPES) {
    const length_m = lengths[type] ?? 0
    const psi      = ISO14683_DEFAULT_PSI[type] ?? 0
    // Multiplier applies uniformly across all junctions (Brief 28-TB-Simple
    // Part A: "multiplies the auto-computed H_TB").
    const contribution = length_m * psi * multiplier
    total_H_TB += contribution
    junctions.push({
      type,
      label:                JUNCTION_LABELS[type] ?? type,
      psi_W_per_mK:         psi,
      length_m:             Math.round(length_m * 10) / 10,
      contribution_W_per_K: Math.round(contribution * 100) / 100,
    })
  }

  return { junctions, total_H_TB_W_per_K: total_H_TB }
}

/**
 * Main entry — called once per engine run from instantCalc.js.
 *
 * @param {object} building       — building_config object (must have
 *                                   length/width/num_floors/floor_height)
 * @param {object} geometry       — output of computeGeometry: must have
 *                                   .glazing.{north,south,east,west} and
 *                                   .total_wall_opaque + .roof_area +
 *                                   .ground_area + .total_glazing
 *                                   (latter four used for y_value derivation)
 * @param {number} areaUaWperK    — Σ(U_i × A_i) precomputed by caller —
 *                                   used as the fallback denominator for
 *                                   the legacy α conversion AND as the
 *                                   denominator for the derived_alpha_pct
 *                                   diagnostic
 *
 * @returns {object} result with:
 *   mode:                  'iso14683_auto' | 'manual_h_tb' | 'absent' |
 *                          'legacy_alpha_fallback'
 *   multiplier:            number (1.0 when not specified)
 *   total_H_TB_W_per_K:    number (engine consumes this)
 *   junctions:             array of per-junction breakdowns (empty for
 *                          manual / legacy / absent modes)
 *   derived_alpha_pct:     diagnostic — H_TB / (H_TB + area_UA) × 100
 *                          per BRUKL's official definition. NOT consumed
 *                          by engine math, just emitted for observation.
 *   y_value_W_per_m2K_derived:  H_TB / total_envelope_area, ISO 14683
 *                          equivalent Y-value. NOT consumed by engine
 *                          math, just emitted for observation.
 */
export function computeThermalBridges(building, geometry, areaUaWperK) {
  const tb = building?.thermal_bridges
  const legacy_alpha = Number(building?.fabric?.thermal_bridging_alpha_pct)

  let mode, total_H_TB_W_per_K, junctions, multiplier

  if (tb && tb.mode === 'absent') {
    mode = 'absent'
    total_H_TB_W_per_K = 0
    junctions = []
    multiplier = 1.0
  }
  else if (tb && tb.mode === 'manual_h_tb') {
    mode = 'manual_h_tb'
    total_H_TB_W_per_K = Number(tb.h_tb_W_per_K) || 0
    junctions = []
    multiplier = 1.0
  }
  else if (tb && tb.mode === 'iso14683_auto') {
    mode = 'iso14683_auto'
    multiplier = Number(tb.multiplier ?? 1.0) || 1.0
    const auto = computeAuto(building, geometry, multiplier)
    junctions = auto.junctions
    total_H_TB_W_per_K = auto.total_H_TB_W_per_K
  }
  else if (Number.isFinite(legacy_alpha) && legacy_alpha > 0) {
    // Backward-compat: legacy Brief 28L α field. One-shot deprecation
    // warning + α/100 × area_UA fallback. Preserves Brief 28L numerical
    // behaviour for un-re-seeded projects.
    if (!_legacyAlphaWarned) {
      console.warn(
        '[thermalBridges] DEPRECATION: building.fabric.thermal_bridging_alpha_pct = '
        + `${legacy_alpha} is from Brief 28L's SBEM α convention. Brief 28-TB-Simple `
        + 'replaces it with ISO 14683 junction-based physics. Treating as '
        + 'manual_h_tb fallback (h_tb = α/100 × area_UA). Re-run the seed to migrate.',
      )
      _legacyAlphaWarned = true
    }
    mode = 'legacy_alpha_fallback'
    total_H_TB_W_per_K = (legacy_alpha / 100) * (Number(areaUaWperK) || 0)
    junctions = []
    multiplier = 1.0
  }
  else {
    // No thermal bridging configured anywhere. Equivalent to mode='absent'.
    mode = 'absent'
    total_H_TB_W_per_K = 0
    junctions = []
    multiplier = 1.0
  }

  // Diagnostic derived values — NOT consumed by engine math. Emitted so
  // downstream UI / validators can compare against BRUKL reporting without
  // the engine needing to take a stance on the α convention.
  const HTC_total = total_H_TB_W_per_K + (Number(areaUaWperK) || 0)
  const derived_alpha_pct = HTC_total > 0
    ? Math.round((total_H_TB_W_per_K / HTC_total) * 1000) / 10  // 0-100 with 1 dp
    : 0

  const total_envelope_area = (geometry?.total_wall_opaque ?? 0)
                            + (geometry?.roof_area ?? 0)
                            + (geometry?.ground_area ?? 0)
                            + (geometry?.total_glazing ?? 0)
  const y_value_W_per_m2K_derived = total_envelope_area > 0
    ? Math.round((total_H_TB_W_per_K / total_envelope_area) * 1000) / 1000
    : 0

  return {
    mode,
    multiplier,
    total_H_TB_W_per_K: Math.round(total_H_TB_W_per_K * 100) / 100,
    junctions,
    derived_alpha_pct,
    y_value_W_per_m2K_derived,
  }
}

/**
 * Test-only helper to clear the one-shot deprecation warning flag.
 * Not exported in normal use; only useful in unit tests that need to
 * re-trigger the warning. Defined for completeness — current tests don't
 * call it.
 */
export function _resetDeprecationWarning() {
  _legacyAlphaWarned = false
}
