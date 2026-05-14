/**
 * scripts/profile_static_engine.mjs
 *
 * Brief 27 cleanup Part 3 -- profile Finding 2 (slow State 1 -> State 2
 * transition). Measures _calculateEnvelopeOnly + _calculateState2 in
 * isolation to determine whether the engine itself is slow or the bottleneck
 * is elsewhere (library fetch, mounting overhead, React StrictMode double-
 * rendering).
 *
 * Expected: sub-second on a modern machine. If wall-clock is multi-second,
 * the engine itself needs optimisation. If sub-second, the bottleneck is
 * I/O or React, not compute.
 *
 * Usage:
 *   node scripts/profile_static_engine.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'

// ── Load project + library ───────────────────────────────────────────────
const db = new DatabaseSync(path.join(REPO_ROOT, 'data/nza_sim.db'))
const t0_db = performance.now()
const projRow = db.prepare(
  'SELECT name, building_config, construction_choices, systems_config, weather_file FROM projects WHERE id = ?'
).get(PROJECT_ID)
const libRows = db.prepare(
  "SELECT name, config_json FROM library_items WHERE library_type = 'construction'"
).all()
const t1_db = performance.now()
console.log(`  DB load:            ${(t1_db - t0_db).toFixed(1)} ms  (${libRows.length} constructions)`)

const building = JSON.parse(projRow.building_config)
const constructions = JSON.parse(projRow.construction_choices)
const weatherFile = projRow.weather_file || building.weather_file
const libraryData = {
  constructions: libRows.map(r => {
    const cfg = JSON.parse(r.config_json)
    return { name: r.name, u_value_W_per_m2K: cfg.u_value_W_per_m2K, y_factor: cfg.y_factor ?? 1.0, config_json: cfg }
  }),
}
db.close()

// ── EPW parse ────────────────────────────────────────────────────────────
const t0_epw = performance.now()
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
const t1_epw = performance.now()
console.log(`  EPW parse:          ${(t1_epw - t0_epw).toFixed(1)} ms  (${N} hours)`)

// ── Solar precompute ─────────────────────────────────────────────────────
const t0_solar = performance.now()
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, building.orientation ?? 0)
const t1_solar = performance.now()
console.log(`  Solar precompute:   ${(t1_solar - t0_solar).toFixed(1)} ms`)

// ── Engine timing ────────────────────────────────────────────────────────
const cb = { lower_c: 21, upper_c: 25 }
const buildingWithCb = { ...building, comfort_band: cb }

console.log()
console.log('  === Cold runs ===')
const t0_s1 = performance.now()
const state1 = calculateInstant(
  buildingWithCb, constructions, {}, libraryData,
  weatherData, hourlySolar, null,
  { mode: 'envelope-only', comfortBand: cb }
)
const t1_s1 = performance.now()
console.log(`  state1 cold:        ${(t1_s1 - t0_s1).toFixed(1)} ms`)

const t0_s2 = performance.now()
const state2 = calculateInstant(
  buildingWithCb, constructions, {}, libraryData,
  weatherData, hourlySolar, null,
  { mode: 'envelope-gains', comfortBand: cb }
)
const t1_s2 = performance.now()
console.log(`  state2 cold:        ${(t1_s2 - t0_s2).toFixed(1)} ms`)

// Run them 4 more times to see warm timing
console.log()
console.log('  === Warm runs (×4) ===')
for (let i = 0; i < 4; i++) {
  const t0_s1w = performance.now()
  calculateInstant(buildingWithCb, constructions, {}, libraryData, weatherData, hourlySolar, null, { mode: 'envelope-only', comfortBand: cb })
  const t1_s1w = performance.now()
  const t0_s2w = performance.now()
  calculateInstant(buildingWithCb, constructions, {}, libraryData, weatherData, hourlySolar, null, { mode: 'envelope-gains', comfortBand: cb })
  const t1_s2w = performance.now()
  console.log(`  iter ${i+1}: state1 ${(t1_s1w - t0_s1w).toFixed(1)} ms · state2 ${(t1_s2w - t0_s2w).toFixed(1)} ms`)
}

console.log()
console.log('  state1 demand:', state1.demand?.heating_demand_mwh?.toFixed(1) + ' MWh heating')
console.log('  state2 demand:', state2.demand?.heating_demand_mwh?.toFixed(1) + ' MWh heating')
