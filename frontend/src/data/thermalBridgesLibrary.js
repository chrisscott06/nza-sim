/**
 * thermalBridgesLibrary.js
 *
 * Brief 28-TB-Simple Gate TB-V1: default linear thermal transmittance (ψ) values
 * for junction types between building envelope elements, per ISO 14683 Table A.2
 * (Simplified methods and default values).
 *
 * These defaults give a "typical compliance-quality detailed building" Y-value
 * around 0.08-0.10 W/m²K when summed across the auto-computed junction lengths
 * for a standard non-domestic geometry. That's the ballpark UK Approved Document
 * L Notional buildings sit at.
 *
 * Users can override by:
 *   - Setting `building_config.thermal_bridges.multiplier > 1.0` for a building
 *     with worse-than-typical detailing (e.g. 1.5 for poor; 2.0 for very poor)
 *   - Switching to `building_config.thermal_bridges.mode = 'manual_h_tb'` and
 *     setting `h_tb_W_per_K` directly
 *
 * The brief deliberately uses a SMALLER junction set than ISO 14683 Annex C's
 * full table (which separates window head / jamb / sill, internal corners,
 * partition junctions, etc.). The V1 simplification:
 *   - Combines window head + jamb + sill into a single "window perimeter" with
 *     a length approximated as 4 × √(facade glazing area) per facade — coarse,
 *     acknowledged in the brief, refineable in a future per-window-itemised
 *     glazing brief
 *   - Combines external + internal corners into a single "external_corner"
 *     entry (Bridgewater is rectangular so only external corners matter)
 *   - No partition-to-external-wall junctions (single-zone massing model)
 *
 * Sources:
 *   - ISO 14683:2017 Annex A & C (linear thermal transmittance simplified
 *     methods and default values) — primary reference for the ψ numerics
 *   - UK SAP 2009 Appendix K Table K1 — domestic-side equivalent with similar
 *     ranges; cross-checked
 *   - docs/research/sbem_thermal_bridging_convention.md — diagnostic context
 */

// Junction type identifiers — used both as keys in the ψ-defaults table
// and as the canonical type strings on persisted thermal-bridge entries.
export const JUNCTION_TYPES = Object.freeze({
  WALL_TO_ROOF:                 'wall_to_roof',
  WALL_TO_GROUND_FLOOR:         'wall_to_ground_floor',
  WALL_TO_INTERMEDIATE_FLOOR:   'wall_to_intermediate_floor',
  EXTERNAL_CORNER:              'external_corner',
  WINDOW_PERIMETER:             'window_perimeter',
  DOOR_PERIMETER:               'door_perimeter',
})

/**
 * Default ψ (W/m·K) per junction type — ISO 14683 Table A.2 typical values.
 * Used when `building_config.thermal_bridges.mode === 'iso14683_auto'`.
 *
 * Numbers picked to align with UK AD L2A "Notional" compliance class — a
 * typical detailed building with no major thermal-bridge defects but no
 * specific psi-value calculations either.
 */
export const ISO14683_DEFAULT_PSI = Object.freeze({
  [JUNCTION_TYPES.WALL_TO_ROOF]:               0.08,
  [JUNCTION_TYPES.WALL_TO_GROUND_FLOOR]:       0.16,
  [JUNCTION_TYPES.WALL_TO_INTERMEDIATE_FLOOR]: 0.08,
  [JUNCTION_TYPES.EXTERNAL_CORNER]:            0.05,
  [JUNCTION_TYPES.WINDOW_PERIMETER]:           0.05,
  [JUNCTION_TYPES.DOOR_PERIMETER]:             0.10,
})

/**
 * Human-readable labels — used by the display layer (Sankey loss-line labels,
 * tooltips, drill-downs) and by validation reports.
 */
export const JUNCTION_LABELS = Object.freeze({
  [JUNCTION_TYPES.WALL_TO_ROOF]:               'Wall-to-roof',
  [JUNCTION_TYPES.WALL_TO_GROUND_FLOOR]:       'Wall-to-ground-floor',
  [JUNCTION_TYPES.WALL_TO_INTERMEDIATE_FLOOR]: 'Wall-to-intermediate-floor',
  [JUNCTION_TYPES.EXTERNAL_CORNER]:            'External corner',
  [JUNCTION_TYPES.WINDOW_PERIMETER]:           'Window perimeter',
  [JUNCTION_TYPES.DOOR_PERIMETER]:             'Door perimeter',
})

/**
 * Look up the default ψ for a junction type. Returns 0 (no contribution) for
 * unknown types so a malformed/older persisted state never crashes — the engine
 * just under-counts that line, which is conservative and surfaces as a visible
 * "missing junction" on the loss breakdown.
 */
export function defaultPsiFor(junctionType) {
  return ISO14683_DEFAULT_PSI[junctionType] ?? 0
}

/**
 * The full ordered list — used by `thermalBridges.js` to iterate junction
 * types in a deterministic order (matters for snapshot stability and for
 * Sankey link ordering).
 */
export const ORDERED_JUNCTION_TYPES = Object.freeze([
  JUNCTION_TYPES.WALL_TO_ROOF,
  JUNCTION_TYPES.WALL_TO_INTERMEDIATE_FLOOR,
  JUNCTION_TYPES.WALL_TO_GROUND_FLOOR,
  JUNCTION_TYPES.EXTERNAL_CORNER,
  JUNCTION_TYPES.WINDOW_PERIMETER,
  JUNCTION_TYPES.DOOR_PERIMETER,
])
