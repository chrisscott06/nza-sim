// Canonical colour palette for the Heat Balance view.
// Used by both the bars component and (future) Sankey ribbons so the eye
// can track an element across views.

// Solar — yellow / orange family. South is brightest (most gain in N hemisphere).
export const SOLAR_COLOURS = {
  south: '#F59E0B', // amber-500
  east:  '#F97316', // orange-500
  west:  '#FB923C', // orange-400
  north: '#FBBF24', // amber-400
}

// Internal gains — purples, matching Profiles theme.
export const INTERNAL_COLOURS = {
  people:    '#8B5CF6', // violet-500
  equipment: '#A78BFA', // violet-400
  lighting:  '#C4B5FD', // violet-300
}

// Mechanical
export const HEATING_COLOUR = '#DC2626' // red-600
export const COOLING_COLOUR = '#00AEEF' // Systems theme cyan

// Fabric losses — grey family for conductive elements;
// air-flow losses (infiltration + permanent vents) paired in a blue family
// per Brief 33 Part 2 (2026-05-18) so the eye groups them as "air-flow"
// while still distinguishing baseline crack infiltration from intentional
// permanent vents.
export const FABRIC_COLOURS = {
  external_wall:    '#6B7280', // grey-500
  roof:             '#475569', // slate-600
  ground_floor:     '#94A3B8', // slate-400
  glazing:          '#A1A1AA', // zinc-400
  thermal_bridging: '#374151', // grey-700 — Y-factor contribution surfaces here at State 1
  infiltration:     '#7DD3FC', // sky-300 — softer/lighter blue (baseline q50-driven leakage)
  fabric_leakage:   '#7DD3FC', // sky-300 — engine-internal alias for infiltration; same colour, display label is "Infiltration"
  permanent_vents:  '#0EA5E9', // sky-500 — louvre flow, State-1-correct alias for openings_louvre
  openings_louvre:  '#0EA5E9', // sky-500 — wind-driven, distinct from baseline crack infiltration
  openings_window:  '#0284C7', // sky-600 — State 2.5 operable-window flow
  ventilation:      '#9CA3AF', // grey-400 — mechanical (MEV/MVHR), State 3 only
}

// Element labels.
// Brief 33 Part 2 (2026-05-18): the engine field `fabric_leakage` is
// surfaced in the UI as "Infiltration" — the term every building physicist
// uses. The engine key stays as fabric_leakage for back-compat with the
// existing results schema; only the display label changes.
export const LABELS = {
  external_wall:    'External wall',
  roof:             'Roof',
  ground_floor:     'Ground floor',
  glazing:          'Glazing',
  thermal_bridging: 'Thermal bridging',
  infiltration:     'Infiltration',
  fabric_leakage:   'Infiltration',
  permanent_vents:  'Permanent vents',
  openings_louvre:  'Openings — louvres',
  openings_window:  'Openings — windows',
  ventilation:      'Ventilation (mech.)',
  cooling:          'Cooling',
  people:           'People',
  equipment:        'Equipment',
  lighting:         'Lighting',
  heating:          'Heating',
  solar_north:      'Solar — North',
  solar_east:       'Solar — East',
  solar_south:      'Solar — South',
  solar_west:       'Solar — West',
}

// Stable order for stacking (top-to-bottom). State-3 canonical order.
// State-aware ordering lives in `utils/stateMode.js` (loadOrderFor / gainOrderFor)
// — components should call those helpers, not import these constants directly,
// except as a State 3 default fallback.
export const LOSS_ORDER  = ['external_wall', 'roof', 'ground_floor', 'glazing', 'infiltration', 'openings_louvre', 'openings_window', 'ventilation', 'cooling']
export const GAIN_ORDER  = ['solar_south', 'solar_east', 'solar_west', 'solar_north', 'people', 'equipment', 'lighting', 'heating']

export function colourForElement(elementKey) {
  if (elementKey.startsWith('solar_')) {
    return SOLAR_COLOURS[elementKey.slice(6)] ?? '#F59E0B'
  }
  if (elementKey === 'cooling') return COOLING_COLOUR
  if (elementKey === 'heating') return HEATING_COLOUR
  if (INTERNAL_COLOURS[elementKey]) return INTERNAL_COLOURS[elementKey]
  return FABRIC_COLOURS[elementKey] ?? '#9CA3AF'
}
