/**
 * scripts/verify_state2_heat_balance_shape.mjs
 *
 * Brief 27 cleanup Part 3 (corrected close-out) -- verify state2 from
 * _calculateState2 has the shape HeatBalance.jsx expects under
 * state2.heat_balance.
 *
 * Specifically:
 *   - state2.heat_balance.annual              exists
 *   - state2.heat_balance.annual.totals       has losses_kwh + gains_kwh
 *   - state2.heat_balance.annual.gains.solar  has per-facade nodes
 *   - state2.heat_balance.annual.gains.internal.{people,equipment,lighting}
 *     -- the fix moved these from gains.* to gains.internal.*
 *   - state2.heat_balance.annual.losses       has per-element nodes
 *   - state2.heat_balance.metadata.gia_m2     exists
 *
 * Usage:
 *   node scripts/verify_state2_heat_balance_shape.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sqlite3 from 'node:sqlite'  // node 22+ built-in sqlite

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'

// ── Load project + constructions library directly from SQLite ─────────────
const { DatabaseSync } = sqlite3
const db = new DatabaseSync(path.join(REPO_ROOT, 'data/nza_sim.db'))
const projRow = db.prepare(
  'SELECT name, building_config, construction_choices, systems_config, weather_file FROM projects WHERE id = ?'
).get(PROJECT_ID)
if (!projRow) { console.error(`Project ${PROJECT_ID} not found`); process.exit(1) }
const building = JSON.parse(projRow.building_config)
const constructions = projRow.construction_choices ? JSON.parse(projRow.construction_choices) : {}
const systems = projRow.systems_config ? JSON.parse(projRow.systems_config) : {}
const weatherFile = projRow.weather_file || building.weather_file

const libRows = db.prepare(
  "SELECT name, config_json FROM library_items WHERE library_type = 'construction'"
).all()
const libraryData = {
  constructions: libRows.map(r => {
    const cfg = JSON.parse(r.config_json)
    return {
      name: r.name,
      u_value_W_per_m2K: cfg.u_value_W_per_m2K,
      y_factor: cfg.y_factor ?? 1.0,
      config_json: cfg,
    }
  }),
}
db.close()

// ── Weather + solar ──────────────────────────────────────────────────────
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), direct_normal = new Float32Array(N),
      diffuse_horizontal = new Float32Array(N), wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i] = parseInt(p[1]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6]); direct_normal[i] = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15]); wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, building.orientation ?? 0)

// ── Run state2 ────────────────────────────────────────────────────────────
const cb = { lower_c: 21, upper_c: 25 }
const state2 = calculateInstant(
  { ...building, comfort_band: cb },
  constructions, {}, libraryData,
  weatherData, hourlySolar, null,
  { mode: 'envelope-gains', comfortBand: cb }
)

// ── Check shape ───────────────────────────────────────────────────────────
const checks = []
function check(label, ok, value) {
  checks.push({ label, ok, value })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${value !== undefined ? ` = ${value}` : ''}`)
}

console.log()
console.log('============================================================')
console.log('  STATE 2 HEAT_BALANCE SHAPE VERIFICATION')
console.log('============================================================')
console.log()
console.log(`  Project: ${projRow.name}`)
console.log(`  Top-level state2 keys: ${Object.keys(state2).join(', ')}`)
console.log()

const hb = state2.heat_balance
check('state2.heat_balance exists', hb != null)
check('state2.heat_balance.annual exists (HeatBalance empty-state check)', hb?.annual != null)
check('state2.heat_balance.annual.totals exists', hb?.annual?.totals != null)
check('state2.heat_balance.annual.totals.losses_kwh > 0', (hb?.annual?.totals?.losses_kwh ?? 0) > 0, hb?.annual?.totals?.losses_kwh)
check('state2.heat_balance.annual.totals.gains_kwh > 0', (hb?.annual?.totals?.gains_kwh ?? 0) > 0, hb?.annual?.totals?.gains_kwh)
check('state2.heat_balance.annual.gains.solar exists', hb?.annual?.gains?.solar != null)
check('state2.heat_balance.annual.gains.internal exists (Brief 27 cleanup Part 3 fix)', hb?.annual?.gains?.internal != null)
check('state2.heat_balance.annual.gains.internal.people exists', hb?.annual?.gains?.internal?.people != null)
check('state2.heat_balance.annual.gains.internal.lighting exists', hb?.annual?.gains?.internal?.lighting != null)
check('state2.heat_balance.annual.gains.internal.equipment exists', hb?.annual?.gains?.internal?.equipment != null)
check('state2.heat_balance.annual.losses.external_wall exists', hb?.annual?.losses?.external_wall != null)
check('state2.heat_balance.metadata.gia_m2 > 0', (hb?.metadata?.gia_m2 ?? 0) > 0, hb?.metadata?.gia_m2)

// Critical: people/lighting/equipment should NOT be at gains.* directly anymore
check('state2.heat_balance.annual.gains.people is NOT at top level (moved to .internal.people)', hb?.annual?.gains?.people == null)
check('state2.heat_balance.annual.gains.lighting is NOT at top level', hb?.annual?.gains?.lighting == null)
check('state2.heat_balance.annual.gains.equipment is NOT at top level', hb?.annual?.gains?.equipment == null)

console.log()
const allOk = checks.every(c => c.ok)
console.log('============================================================')
console.log(`  ${allOk ? 'ALL PASS' : 'SOME FAILED'} (${checks.filter(c => c.ok).length}/${checks.length})`)
console.log('============================================================')
process.exit(allOk ? 0 : 1)
