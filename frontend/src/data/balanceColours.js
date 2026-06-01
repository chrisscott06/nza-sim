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
  // Brief 72 P6 (2026-05-29): auxiliary loads — outside the violet
  // gain family deliberately. Auxiliary plug/equipment loads (external
  // lighting, catering hoods, pumps, lifts, small power) aren't an
  // occupancy-driven internal gain in the same way People / Equipment /
  // Lighting are — they're independent infrastructure that happens to
  // contribute heat. The neutral gray-600 (#4B5563) marks that
  // distinction visually while keeping the gain palette tonally
  // coherent. Same hex appears in gainColours.js — single source of
  // truth requires both files agree on this constant in the SAME
  // commit (Rule 14 spirit applied to UI palettes — pattern from the
  // brief).
  auxiliary: '#4B5563', // gray-600
}

// Mechanical
export const HEATING_COLOUR = '#DC2626' // red-600
export const COOLING_COLOUR = '#00AEEF' // Systems theme cyan

// Brief 37 Part 1 (2026-05-18): canonical Systems service-colour table.
// Single source of truth for the per-service accents used by the unified
// schedule editor, Systems daily-stacks, Systems Sankey, Results tabs,
// and any other consumer rendering per-service breakdowns.
//
// Decisions (Chris, chat-form authorisation 2026-05-18):
//   heating    #DC2626  red-600       (unchanged)
//   cooling    #00AEEF  cyan-bright   (unified — was mixed #3B82F6 in
//                                       Systems daily-stacks vs #00AEEF
//                                       in the global COOLING_COLOUR)
//   dhw        #EC4899  pink-500      (was #F97316 orange-500)
//   fans       #14B8A6  teal-500      (was #06B6D4 cyan-500 — conflicted
//                                       with Systems module identity cyan)
//   lighting   #F59E0B  amber-500     (unchanged; electricity end-use,
//                                       NOT to be confused with Internal
//                                       Gains' lighting-as-heat-gain,
//                                       which is violet-300)
//   small_pwr  #8B5CF6  violet-500    (unchanged)
//
// Module-wide identity accents (separate from service accents — these
// drive the module top stripe / sidebar active indicator / tab strip):
//   building    not exported here (lives in moduleThemes.js)
//   operation   '#0F766E' teal-700  (was '#0E7490' cyan-700 — "dark teal"
//                                     per chat-form authorisation)
//   systems     '#00AEEF' cyan-bright  (unchanged; same as cooling
//                                       service — intentional)
//   internal_gains  '#EA580C' orange  (unchanged; gain categories
//                                      themselves are the three purples)
export const SYSTEMS_SERVICE_COLOURS = {
  heating:     '#DC2626', // red-600
  cooling:     '#00AEEF', // cyan-bright (= COOLING_COLOUR)
  dhw:         '#EC4899', // pink-500
  fans:        '#14B8A6', // teal-500
  ventilation: '#14B8A6', // alias for fans (mech-vent / extract / supply)
  lighting:    '#F59E0B', // amber-500 (Systems electricity end-use)
  small_power: '#8B5CF6', // violet-500
}

export const OPERATION_ACCENT      = '#0F766E' // teal-700
export const SYSTEMS_ACCENT        = '#00AEEF' // cyan-bright
export const INTERNAL_GAINS_ACCENT = '#EA580C' // orange-600

// Fabric losses — grey family for conductive elements;
// air-flow losses (infiltration + permanent vents + mech vent) now in a
// green family (2026-05-28 — Chris's call): blue was reserved for the
// Cooling service (#00AEEF), so any air-flow term in a blue shade read as
// "cooling" at a glance. Greens give the air-flow group its own identity,
// gradiated from light (uncontrolled baseline leakage) to dark (engineered
// mechanical ventilation). Tealish-green (#14B8A6) is the Systems fan
// service colour and is intentionally avoided here so air-flow heat-loss
// doesn't clash with fan-electricity displays.
export const FABRIC_COLOURS = {
  external_wall:    '#6B7280', // grey-500
  roof:             '#475569', // slate-600
  ground_floor:     '#94A3B8', // slate-400
  glazing:          '#A1A1AA', // zinc-400
  thermal_bridging: '#374151', // grey-700 — Y-factor contribution surfaces here at State 1
  infiltration:     '#86EFAC', // green-300 — uncontrolled baseline crack leakage (lightest)
  fabric_leakage:   '#86EFAC', // green-300 — engine alias for infiltration; same colour, label "Infiltration"
  permanent_vents:  '#4ADE80', // green-400 — passive louvre flow
  openings_louvre:  '#22C55E', // green-500 — wind-driven louvres (State 2.5)
  openings_window:  '#16A34A', // green-600 — operable windows (State 2.5)
  ventilation:      '#047857', // emerald-700 — mechanical (MEV/MVHR), State 3 — darkest (most engineered)
  // Brief 74 P5 (2026-06-01): mech ventilation HEAT LOSS ribbon on Heat
  // Balance Sankey. Same emerald-700 family as the `ventilation` token
  // above so a single visual identity covers "mechanical ventilation"
  // across the Heat Balance Sankey (loss side) and the Energy Flows
  // Sankey (system node, where SERVICE_COLOURS.ventilation = '#14B8A6'
  // teal-500 is used). Two adjacent emerald/teal shades are an
  // intentional design choice — the Heat Balance Sankey is a thermal
  // view (heat moving out), Energy Flows is an electrical view (fans
  // consuming kWh). Same family signals "same service", different
  // shade signals "different physics being depicted".
  mech_ventilation: '#047857',
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
  // Brief 74 P5 (2026-06-01): canonical key for mech ventilation heat loss.
  mech_ventilation: 'Mech ventilation',
  cooling:          'Cooling',
  people:           'People',
  equipment:        'Equipment',
  lighting:         'Lighting',
  // Brief 72 P6 (2026-05-29): auxiliary loads label.
  auxiliary:        'Auxiliary',
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
// Brief 72 P6 (2026-05-29): auxiliary slots between equipment and lighting
// — same band as the other plug/equipment-class loads, distinct hex.
export const GAIN_ORDER  = ['solar_south', 'solar_east', 'solar_west', 'solar_north', 'people', 'equipment', 'auxiliary', 'lighting', 'heating']

export function colourForElement(elementKey) {
  if (elementKey.startsWith('solar_')) {
    return SOLAR_COLOURS[elementKey.slice(6)] ?? '#F59E0B'
  }
  if (elementKey === 'cooling') return COOLING_COLOUR
  if (elementKey === 'heating') return HEATING_COLOUR
  if (INTERNAL_COLOURS[elementKey]) return INTERNAL_COLOURS[elementKey]
  return FABRIC_COLOURS[elementKey] ?? '#9CA3AF'
}
