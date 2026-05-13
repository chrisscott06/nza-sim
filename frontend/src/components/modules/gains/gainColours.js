/**
 * gainColours.js — local colour palette for the Internal Gains module.
 *
 * Per docs/ui_principles.md feedback during Brief 27 Part 4: gain colours
 * should be visually distinct (purple/gold/orange) where the user
 * configures and reads each gain category. The existing global palette in
 * `frontend/src/data/balanceColours.js:INTERNAL_COLOURS` ships three
 * shades of violet because they sit inside a heat-balance STACK there —
 * the "internal gains" category needs to read as a single visual group
 * against fabric / solar / mechanical neighbours.
 *
 * Inside this module, those three categories ARE the three main
 * sections and three first-class outputs. Distinct hues make scanning
 * (which gain am I looking at?) faster. Brief 28 cross-cutting design
 * pass will decide whether to harmonise globally; for now this is a
 * module-local palette that doesn't disturb the Heat Balance views.
 */

export const GAIN_COLOURS = {
  occupancy: '#8B5CF6',  // violet-500 — people
  lighting:  '#F59E0B',  // amber-500 — gold
  equipment: '#FB923C',  // orange-400
}

export const GAIN_LABELS = {
  occupancy: 'Occupancy',
  lighting:  'Lighting',
  equipment: 'Equipment',
}
