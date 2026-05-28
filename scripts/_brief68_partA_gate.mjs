/**
 * scripts/_brief68_partA_gate.mjs
 *
 * Brief 68 Part A gate — cross-panel carbon parity on Bridgewater.
 *
 * Before this brief, two carbon paths disagreed:
 *   • v2.5 systems carbon (instantCalc.js:4860, BEIS_2024_FACTORS.elec = 0.207)
 *   • brief40 carrier-sum carbon (systemsEngine.js:890, CARBON_KG_PER_KWH.elec = 0.193)
 * — a 7.3% drift in the electricity factor. The Brief 68 fix routes both
 * through data/carbonFactors.js (ELECTRICITY_CURRENT = 0.207).
 *
 * Loads the same Bridgewater config the validation harness uses (via the
 * verification backend at port 8003), runs the engine, and prints every
 * carbon field on the result.
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

const result = calculateInstant(baseBuilding, constructions, {}, libraryData, weatherData, hourlySolar, null, {
  mode: 'full',
  engine: 'v2.5',
  comfortBand,
  _skipInterventions: true,
})

function pn(r, p) {
  let c = r
  for (const s of p.split('.')) {
    if (c == null) return null
    c = c[s]
  }
  return (typeof c === 'number' && Number.isFinite(c)) ? c : null
}

// Candidate paths the various engine paths write carbon to. The v2.5 path
// (BEIS_2024_FACTORS) writes top-level carbon_kg_co2_per_m2; the brief40
// carrier-sum (CARBON_KG_PER_KWH) writes consumption.brief40.carbon_kgCO2_per_m2.
const candidates = [
  'carbon_kg_co2_per_m2',                                   // v2.5 systems (instantCalc.js:4861)
  'consumption.brief40.totals.carbon_kgCO2_per_m2',         // brief40 sum (systemsEngine.js:911)
  'results.carbon.today.kgCO2_per_m2_yr',                   // trajectory year-0 readout (separate scope)
  'results_summary.carbon_kgco2_per_m2',
  'carbon_kgCO2_m2',                                         // inline-legacy fields (separate scope)
]

console.log('\n── Bridgewater cross-panel carbon — Brief 68 Part A gate ──\n')
console.log('Building:   ' + project.name)
console.log('Comfort:    [' + comfortBand.lower_c + ', ' + comfortBand.upper_c + ']')
console.log()

const found = []
for (const p of candidates) {
  const v = pn(result, p)
  if (v != null) {
    console.log(`  ${p}`.padEnd(55), v.toFixed(3), 'kg CO2/m2/yr')
    found.push({ path: p, value: v })
  }
}

// Restrict the parity check to the two paths the brief explicitly calls out
// (v2.5 systems vs brief40 carrier sum) — those are the panels Home / Systems
// / Energy Flows read from. Trajectory + inline-legacy fields use a different
// (projected) factor and are deliberately on a separate scope.
const v25  = pn(result, 'carbon_kg_co2_per_m2')
const b40  = pn(result, 'consumption.brief40.totals.carbon_kgCO2_per_m2')

if (v25 == null || b40 == null) {
  console.error('\n✗ FAIL — could not read both v2.5 carbon and brief40 carbon from result.')
  console.error('  Brief 68 Part A gate requires both paths to exist.')
  process.exit(1)
}

const drift_kg = Math.abs(v25 - b40)
const drift_pct = v25 > 0 ? (drift_kg / v25) * 100 : 0

console.log()
console.log(`  v2.5 systems path:   ${v25.toFixed(3)} kg CO2/m2/yr`)
console.log(`  brief40 carrier sum: ${b40.toFixed(3)} kg CO2/m2/yr`)
console.log(`  drift:               ${drift_kg.toFixed(3)} kg/m2/yr  (${drift_pct.toFixed(3)}%)`)

// Tolerance: 1% — covers numerical rounding from the brief40 totals being
// rounded to 2 dp at output (systemsEngine.js:911 Math.round(x*100)/100).
// Pre-Brief-68 the gap was ~7.3% from a factor mismatch (0.193 vs 0.207).
// Any drift below 1% is rounding noise, not factor disagreement.
if (drift_pct > 1.0) {
  console.error(`\n✗ FAIL — paths drift by ${drift_pct.toFixed(3)}% (>1% tolerance).`)
  console.error('  Pre-Brief-68 drift was ~7.3% on electricity factor.')
  process.exit(1)
}

console.log(`\n✓ PASS — v2.5 and brief40 carbon agree within ${drift_pct.toFixed(3)}% (≤1% tol; was ~7.3%).`)
console.log('  Brief 68 Part A B1 single-source carbon factors: verified on Bridgewater.')
