/**
 * gainColours.js — local colour palette for the Internal Gains module.
 *
 * Brief 36 Part 2 (2026-05-18): unified to three shades of purple
 * matching the Sankey's `INTERNAL_COLOURS` in
 * `frontend/src/data/balanceColours.js`. The earlier purple/gold/orange
 * palette made the same gain category read differently across views
 * (e.g. lighting was gold in the section header but light-violet in
 * the Sankey). Same gain = same colour everywhere is the discipline.
 *
 * Mapping is identical to `INTERNAL_COLOURS`:
 *   occupancy → violet-500 (deepest)  — matches Sankey People
 *   equipment → violet-400 (medium)   — matches Sankey Equipment
 *   lighting  → violet-300 (lightest) — matches Sankey Lighting
 *
 * Note: the Sankey orders People (top, deepest) > Equipment (middle) >
 * Lighting (bottom, lightest) — see `LOSS_ORDER` + `GAIN_ORDER` in
 * balanceColours.js. The gainColours module mirrors that depth ordering
 * even though brief §2.2 phrased lighting as the "medium" anchor (a
 * misstatement against the actual Sankey palette). Truth-of-Sankey wins
 * because the brief's intent is "same colour everywhere", and the Sankey
 * is what the user already sees.
 *
 * The module's structural accent (GAINS_ACCENT = '#EA580C') stays as the
 * module identity colour in title bar / tab strip / sidebar active
 * indicator — that's not a gain category and is not changed here.
 */

export const GAIN_COLOURS = {
  occupancy: '#8B5CF6',  // violet-500 — people  (deepest)
  equipment: '#A78BFA',  // violet-400 — equipment (medium)
  lighting:  '#C4B5FD',  // violet-300 — lighting  (lightest)
  // Brief 72 P6 (2026-05-29): auxiliary loads. Sits outside the violet
  // gain family deliberately — auxiliary plug/equipment loads (external
  // lighting, catering hoods, pumps, lifts, small power) are independent
  // infrastructure rather than occupancy-driven internal gains. Neutral
  // gray-600 marks that distinction. Same hex appears in
  // balanceColours.js INTERNAL_COLOURS — both palettes must stay in
  // lockstep (single source of truth requires updating in the same
  // commit, Rule 14 spirit applied to UI palettes per the brief).
  auxiliary: '#4B5563',  // gray-600 — auxiliary
}

export const GAIN_LABELS = {
  occupancy: 'Occupancy',
  lighting:  'Lighting',
  equipment: 'Equipment',
  // Brief 72 P6 (2026-05-29): auxiliary label.
  auxiliary: 'Auxiliary',
}
