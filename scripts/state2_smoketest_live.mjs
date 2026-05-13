/**
 * scripts/state2_smoketest_live.mjs
 *
 * Brief 27 Part 2 verification — confirms `_calculateState2` produces:
 *   • A State 2-shaped output (state=2, mode='envelope-gains', etc.)
 *   • Numbers within BREDEM-derived expected ranges from
 *     docs/state_2_expected_ranges.md
 *
 * Bridgewater scaling note: the project's persisted `occupancy.occupancy_rate`
 * is 1.0 (user-set), not the BREDEM derivation's 0.75 reference assumption.
 * For people / lighting (proportional) the gains scale linearly by 1.33×.
 * For equipment the baseload component (24/7, occupancy-independent) damps
 * the scaling — expect roughly +7-10% over the BREDEM range, not +33%.
 *
 * Usage:
 *   node scripts/state2_smoketest_live.mjs [project_id]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'

const PROJECT_ID = process.argv[2] || '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fetchJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

// ── Load project + library + weather ─────────────────────────────────────────
const project = await fetchJson(`${API}/api/projects/${PROJECT_ID}`)
const constructionsLib = await fetchJson(`${API}/api/library/constructions`)
const constructionsArr = constructionsLib.constructions ?? []
const libraryData = {
  constructions: constructionsArr.map(c => ({
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    config_json: c.config_json ?? c,
  })),
}
const building = project.building_config
const systems = project.systems_config ?? {}
const constructions = project.construction_choices
const comfortBand = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}

const weatherFile = building.weather_file || project.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), wind_speed = new Float32Array(N)
const direct_normal = new Float32Array(N), diffuse_horizontal = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6])
  direct_normal[i] = parseFloat(p[14]); diffuse_horizontal[i] = parseFloat(p[15])
  wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, building.orientation || 0)

// ── Run State 2 ──────────────────────────────────────────────────────────────
const result = calculateInstant(
  { ...building, comfort_band: comfortBand },
  constructions, systems, libraryData,
  weatherData, hourlySolar, null,
  { mode: 'envelope-gains', comfortBand },
)

// Also run State 1 separately as the contract reference for delta sanity check.
const state1 = calculateInstant(
  { ...building, comfort_band: comfortBand },
  constructions, systems, libraryData,
  weatherData, hourlySolar, null,
  { mode: 'envelope-only', comfortBand },
)

console.log()
console.log('═════════════════════════════════════════════════════════════════════')
console.log('  STATE 2 SMOKE TEST — LIVE ENGINE (Brief 27 Part 2)')
console.log('═════════════════════════════════════════════════════════════════════')
console.log(`  Project: ${project.name} (${PROJECT_ID})`)
console.log(`  occupancy.occupancy_rate: ${building.occupancy?.occupancy_rate}`)
console.log(`  occupancy.density: ${JSON.stringify(building.occupancy?.density)}`)
console.log(`  num_bedrooms: ${building.num_bedrooms}`)
console.log()
console.log('── Shape ──────────────────────────────────────────────────────────')
console.log(`  state:                  ${result.state} (expect 2)`)
console.log(`  mode:                   ${result.mode} (expect envelope-gains)`)
console.log(`  inputs_used:            ${result.inputs_used?.length} paths`)
console.log(`  has gains.people:       ${'people'    in (result.gains ?? {})}`)
console.log(`  has gains.lighting:     ${'lighting'  in (result.gains ?? {})}`)
console.log(`  has gains.equipment:    ${'equipment' in (result.gains ?? {})}`)
console.log(`  has state1_delta:       ${'state1_delta' in result}`)
console.log(`  has occupancy_summary:  ${'occupancy_summary' in result}`)
console.log()
console.log('── Demand (State 2 with gains) ──────────────────────────────────────')
console.log(`  Heating demand: ${result.demand.heating_demand_mwh.toFixed(1)} MWh`)
console.log(`  Cooling demand: ${result.demand.cooling_demand_mwh.toFixed(1)} MWh`)
console.log(`  Underheating hours: ${result.demand.underheating_hours}`)
console.log(`  Overheating hours:  ${result.demand.overheating_hours}`)
console.log(`  Comfort hours:      ${result.demand.comfort_hours}`)
console.log()
console.log('── Internal gains ───────────────────────────────────────────────────')
console.log(`  People sensible:     ${result.gains.people.sensible_kwh.toLocaleString()} kWh`)
console.log(`     peak:             ${result.gains.people.peak_kw.toFixed(2)} kW`)
console.log(`     hours active:     ${result.gains.people.hours_active}`)
console.log(`  Lighting:            ${result.gains.lighting.kwh.toLocaleString()} kWh`)
console.log(`     effective LPD:    ${result.gains.lighting.effective_lpd_w_per_m2.toFixed(2)} W/m²`)
console.log(`     peak:             ${result.gains.lighting.peak_kw.toFixed(2)} kW`)
console.log(`     hours active:     ${result.gains.lighting.hours_active}`)
console.log(`  Equipment (total):   ${result.gains.equipment.kwh.toLocaleString()} kWh`)
console.log(`     baseload:         ${result.gains.equipment.baseload_kwh.toLocaleString()} kWh`)
console.log(`     active:           ${result.gains.equipment.active_kwh.toLocaleString()} kWh`)
console.log(`     peak:             ${result.gains.equipment.peak_kw.toFixed(2)} kW`)
console.log()
console.log('── State 1 → State 2 delta ─────────────────────────────────────────')
console.log(`  Heating change: ${result.state1_delta.heating_demand_change_mwh >= 0 ? '+' : ''}${result.state1_delta.heating_demand_change_mwh} MWh`)
console.log(`  Cooling change: ${result.state1_delta.cooling_demand_change_mwh >= 0 ? '+' : ''}${result.state1_delta.cooling_demand_change_mwh} MWh`)
console.log(`  Overheating hours change: ${result.state1_delta.overheating_hours_change >= 0 ? '+' : ''}${result.state1_delta.overheating_hours_change}`)
console.log(`  Annual mean T change:     ${result.state1_delta.free_running_temp_change_annual_mean_c >= 0 ? '+' : ''}${result.state1_delta.free_running_temp_change_annual_mean_c}°C`)
console.log()
console.log('── Occupancy summary ────────────────────────────────────────────────')
console.log(`  Average occupants:    ${result.occupancy_summary.average_occupants}`)
console.log(`  Peak occupants:       ${result.occupancy_summary.peak_occupants}`)
console.log(`  Annual occupant-hrs:  ${result.occupancy_summary.annual_occupant_hours.toLocaleString()}`)
console.log()
console.log('── Free running (State 2 temperature trace) ────────────────────────')
console.log(`  Annual mean:  ${result.free_running.annual_mean_c}°C  (State 1: ${state1.free_running.annual_mean_c}°C)`)
console.log(`  Winter min:   ${result.free_running.winter_min_c}°C   (State 1: ${state1.free_running.winter_min_c}°C)`)
console.log(`  Summer max:   ${result.free_running.summer_max_c}°C   (State 1: ${state1.free_running.summer_max_c}°C)`)
console.log()

// ── Range checks ─────────────────────────────────────────────────────────────
// 1.33×-scaled ranges per Brief 27 (Bridgewater occupancy_rate = 1.0).
// Equipment range is per the user's brief — expect actual to come in BELOW
// this because baseload (occupancy-independent) damps the scaling.
const RANGES = {
  'Heating demand (MWh)':   [result.demand.heating_demand_mwh, 125, 165],
  'Cooling demand (MWh)':   [result.demand.cooling_demand_mwh, 107, 140],
  'People kWh':             [result.gains.people.sensible_kwh,  67_000,  87_000],
  'Lighting kWh':           [result.gains.lighting.kwh,         67_000,  93_000],
  'Equipment kWh':          [result.gains.equipment.kwh,       147_000, 200_000],
}

console.log('── 1.33×-scaled expected range check (Bridgewater) ─────────────────')
let allInRange = true
for (const [label, [actual, lo, hi]] of Object.entries(RANGES)) {
  const ok = actual >= lo && actual <= hi
  if (!ok) allInRange = false
  const marker = ok ? '✓' : '✗'
  const range = `[${lo.toLocaleString()} – ${hi.toLocaleString()}]`
  console.log(`  ${marker} ${label.padEnd(22)} ${String(actual.toLocaleString()).padStart(10)}   range ${range}`)
}
console.log()
console.log('═════════════════════════════════════════════════════════════════════')
if (allInRange) {
  console.log('  ✓ ALL METRICS WITHIN 1.33×-SCALED RANGES')
} else {
  console.log('  ⚠ ONE OR MORE METRICS OUTSIDE RANGE — investigate (HIGH suggests')
  console.log('    double-counting, LOW suggests missing gains, but equipment')
  console.log('    below range is expected because its baseload damps scaling)')
}
console.log('═════════════════════════════════════════════════════════════════════')
process.exit(allInRange ? 0 : 1)
