/**
 * scripts/detect_project_state_smoketest.mjs
 *
 * Brief 28a Part 8 — smoketest for detectProjectState helper.
 *
 * Two-section test:
 *
 *   Section A — synthetic configs isolating each predicate path:
 *     A1. empty config                                    -> 'envelope-only'
 *     A2. + occupancy (no systems, no openings)           -> 'envelope-gains'
 *     A3. + operable windows                              -> 'envelope-gains-operation'
 *     A4. + real systems (everything else can be present) -> 'full'
 *
 *   Section B — real Bridgewater config rewound through state hierarchy:
 *     B1. Bridgewater as-is (gains + windows + systems)   -> 'full'
 *     B2. Bridgewater with systems stripped               -> 'envelope-gains-operation'
 *         (Bridgewater has openings.schedule "occupied" +
 *         openable_fraction 0.3 -- operable windows ARE
 *         configured, even if the user didn't explicitly think
 *         of it that way; the predicate honours the config.)
 *     B3. Bridgewater with systems AND openings stripped  -> 'envelope-gains'
 *     B4. Bridgewater with everything stripped            -> 'envelope-only'
 *
 * Exit 0 on all pass; exit 1 on any fail.
 *
 * Usage:
 *   node scripts/detect_project_state_smoketest.mjs
 */

import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  detectProjectState,
  hasRealSystems,
  hasOperableWindows,
  hasInternalGains,
  MODES,
} from '../frontend/src/utils/stateMode.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969' // HIX Bridgewater

const db = new DatabaseSync(path.join(REPO_ROOT, 'data/nza_sim.db'))
const row = db.prepare(
  'SELECT name, building_config, systems_config FROM projects WHERE id = ?'
).get(PROJECT_ID)
db.close()

if (!row) {
  console.error(`Project ${PROJECT_ID} not found`)
  process.exit(1)
}

const building = JSON.parse(row.building_config)
const systems  = JSON.parse(row.systems_config ?? '{}')

let allPass = true
function check(label, got, want) {
  const ok = got === want
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  console.log(`        got:  ${JSON.stringify(got)}`)
  console.log(`        want: ${JSON.stringify(want)}`)
  if (!ok) allPass = false
}

console.log()
console.log('============================================================')
console.log('  STATE 1 / 2 / 2.5 / 3 DETECTION SMOKETEST -- Brief 28a Part 8')
console.log('============================================================')
console.log()
console.log(`  Project: ${row.name} (${PROJECT_ID})`)
console.log()

// ── Section A: synthetic configs isolating each predicate ──────────────
console.log('  Section A — synthetic configs')
console.log()

const emptyBuilding = { length: 60, width: 15, num_floors: 4, num_bedrooms: 0 }
const emptySystems  = {}

check(
  "  A1. detectProjectState(empty, empty)   -> 'envelope-only'",
  detectProjectState(emptyBuilding, emptySystems),
  MODES.ENVELOPE_ONLY,
)

const withOccupancy = {
  ...emptyBuilding,
  occupancy: { density: { value: 0.05, basis: 'per_m2' }, occupancy_rate: 0.75 },
}
check(
  "  A2. + occupancy                          -> 'envelope-gains'",
  detectProjectState(withOccupancy, emptySystems),
  MODES.ENVELOPE_GAINS,
)

const withOperableWindows = {
  ...withOccupancy,
  openings: {
    schedule: { weekday: new Array(24).fill(0.5), saturday: new Array(24).fill(0.5), sunday: new Array(24).fill(0.5) },
    north: { openable_fraction: 0.3 },
  },
}
check(
  "  A3. + operable windows                   -> 'envelope-gains-operation'",
  detectProjectState(withOperableWindows, emptySystems),
  MODES.ENVELOPE_GAINS_OPERATION,
)

const withRealSystems = {
  space_heating: { primary: { system: 'vrf_standard' } },
}
check(
  "  A4. + real systems                       -> 'full'",
  detectProjectState(withOperableWindows, withRealSystems),
  MODES.FULL,
)

console.log()

// ── Section B: real Bridgewater config ─────────────────────────────────
console.log('  Section B — real Bridgewater config')
console.log()
console.log('  Predicate checks on Bridgewater as-loaded:')
console.log(`        hasRealSystems     = ${hasRealSystems(systems)}`)
console.log(`        hasOperableWindows = ${hasOperableWindows(building)}    (note: openings.schedule="occupied", north.openable_fraction=0.3)`)
console.log(`        hasInternalGains   = ${hasInternalGains(building)}`)
console.log()

check(
  "  B1. Bridgewater as-is                    -> 'full'",
  detectProjectState(building, systems),
  MODES.FULL,
)

const noSystems = {}
check(
  "  B2. Bridgewater - systems                -> 'envelope-gains-operation'",
  detectProjectState(building, noSystems),
  MODES.ENVELOPE_GAINS_OPERATION,
)

const buildingNoOpenings = { ...building, openings: undefined }
check(
  "  B3. Bridgewater - systems - openings     -> 'envelope-gains'",
  detectProjectState(buildingNoOpenings, noSystems),
  MODES.ENVELOPE_GAINS,
)

const buildingStripped = {
  ...building,
  openings: undefined,
  num_bedrooms: 0,
  occupancy: { density: { value: 0, basis: 'per_m2' } },
  gains: {
    lighting:  { profiles: [] },
    equipment: { profiles: [] },
  },
}
check(
  "  B4. Bridgewater - everything             -> 'envelope-only'",
  detectProjectState(buildingStripped, noSystems),
  MODES.ENVELOPE_ONLY,
)
console.log()

console.log('============================================================')
if (allPass) {
  console.log('  ALL PASS -- detection logic correct on all 8 scenarios (4 synthetic + 4 Bridgewater rewinds)')
  console.log('============================================================')
  process.exit(0)
} else {
  console.log('  SOME FAILED -- detectProjectState needs inspection')
  console.log('============================================================')
  process.exit(1)
}
