/**
 * scripts/_brief68_partE_gate.mjs
 *
 * Brief 68 Part E gate — Internal Gains vs Systems cooling parity.
 *
 * Pre-Brief-68 (Brief 66 MED-8 / CONS-1, register G9/A7):
 *   • Internal Gains panel "Cooling demand": 82.5 MWh (calls calculateInstant
 *     with mode='envelope-gains'; the State 2 instance sees no v40 systems
 *     config because withMode dropped it)
 *   • Systems panel "Cooling demand":        75.7 MWh (full State 3 path
 *     with v40 ventilation flow + cooling-setpoint clamp)
 *   ⇒ 8.2% drift on the SAME building.
 *
 * Post-Brief-68: withMode('envelope-gains') now passes systems_config_v40
 * through. The two stages see the same config and the numbers reconcile.
 *
 * Gate: build a 'envelope-gains' call (mirrors useStateComparison) and a
 * 'full' call (mirrors Systems' headline path) on Bridgewater; assert the
 * cooling demand agrees within 1%.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const API = process.env.NZA_API ?? 'http://127.0.0.1:8003'
const PID = process.env.NZA_PROJECT_ID ?? '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'

async function fj(u) { const r = await fetch(u); return r.json() }
function pn(r, p) {
  let c = r
  for (const s of p.split('.')) { if (c == null) return null; c = c[s] }
  return (typeof c === 'number' && Number.isFinite(c)) ? c : null
}

const project = await fj(`${API}/api/projects/${PID}`)
const lib = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []
const constructions = project.construction_choices
const baseBuilding = JSON.parse(JSON.stringify(project.building_config))
const comfortBand = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}

const weatherFile = baseBuilding.weather_file || project.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), direct_normal = new Float32Array(N)
const diffuse_horizontal = new Float32Array(N), wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6]); direct_normal[i] = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15]); wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, Number(baseBuilding.orientation ?? 0))
const libraryData = {
  constructions: libArr.map(c => ({
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c,
    layers: c.layers,
  })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
}

function runMode(mode) {
  return calculateInstant(baseBuilding, constructions, {}, libraryData, weatherData, hourlySolar, null, {
    mode,
    engine: 'v2.5',
    comfortBand,
    _skipInterventions: true,
  })
}

const igResult = runMode('envelope-gains')   // mirrors useStateComparison's State 2 call
const sysResult = runMode('full')             // mirrors Systems module's full path

const igCool  = pn(igResult,  'demand.cooling_demand_mwh') ?? pn(igResult,  'cooling_demand_mwh')
const sysCool = pn(sysResult, 'demand.cooling_demand_mwh') ?? pn(sysResult, 'cooling_demand_mwh')

console.log('\n── Brief 68 Part E gate — IG vs Systems cooling parity ──\n')
console.log(`Building:  ${project.name}`)
console.log()
console.log(`  Internal Gains (mode='envelope-gains'): cool = ${igCool != null ? igCool.toFixed(2) : 'null'} MWh`)
console.log(`  Systems        (mode='full'):           cool = ${sysCool != null ? sysCool.toFixed(2) : 'null'} MWh`)

if (igCool == null || sysCool == null) {
  console.error('\n✗ FAIL — could not read cooling demand from one or both result paths.')
  process.exit(1)
}

const drift_mwh = Math.abs(igCool - sysCool)
const drift_pct = Math.max(igCool, sysCool) > 0 ? (drift_mwh / Math.max(igCool, sysCool)) * 100 : 0

console.log(`  drift:                                  ${drift_mwh.toFixed(2)} MWh (${drift_pct.toFixed(2)}%)`)

// Tolerance: 1% of the larger value. Pre-fix drift was ~8.2%; post-fix
// should be byte-exact in principle (same config seen by both stages),
// allowing for any rounding the engine does at output.
if (drift_pct > 1.0) {
  console.error(`\n✗ FAIL — IG vs Systems cooling drift ${drift_pct.toFixed(2)}% (>1% tolerance).`)
  console.error(`  Pre-Brief-68: ~8.2% drift (82.5 vs 75.7).`)
  console.error(`  Post-fix expectation: drift ≤ 1% (rounding only).`)
  process.exit(1)
}

console.log(`\n✓ PASS — IG and Systems cooling demand agree within ${drift_pct.toFixed(2)}% (≤1% tol; was ~8.2%).`)
console.log(`  Brief 68 Part E MED-8 / G9 allowlist drift fixed — envelope-gains now sees v40.`)
