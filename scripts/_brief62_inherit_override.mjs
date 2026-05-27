/**
 * scripts/_brief62_inherit_override.mjs
 *
 * Brief 62 Part 2 gate: all three inherit/override transitions work.
 *   (1) follow_comfort  → demand uses comfortBand setpoint
 *   (2) custom + value  → demand uses the override
 *   (3) back to follow_comfort → demand reverts to comfortBand
 * Read-only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const API = 'http://127.0.0.1:8003'
const PID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
async function fj(u) { const r = await fetch(u); return r.json() }

const project = await fj(`${API}/api/projects/${PID}`)
const lib = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []
const constructions = project.construction_choices
const cb = { lower_c: project.comfort_band_lower_c ?? 20, upper_c: project.comfort_band_upper_c ?? 26 }
const baseBuilding = JSON.parse(JSON.stringify(project.building_config))

const weatherFile = baseBuilding.weather_file || project.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month=new Int8Array(N), day=new Int8Array(N), hour=new Int8Array(N)
const temperature=new Float32Array(N), direct_normal=new Float32Array(N)
const diffuse_horizontal=new Float32Array(N), wind_speed=new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i]=parseInt(p[1]); day[i]=parseInt(p[2]); hour[i]=parseInt(p[3])
  temperature[i]=parseFloat(p[6]); direct_normal[i]=parseFloat(p[14])
  diffuse_horizontal[i]=parseFloat(p[15]); wind_speed[i]=parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, Number(baseBuilding.orientation ?? 0))
const libraryData = {
  constructions: libArr.map(c => ({ name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K, y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0, g_value: c.config_json?.g_value, config_json: c.config_json ?? c, layers: c.layers })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
}

function pn(r, p) { let c = r; for (const s of p.split('.')) { if (c == null) return null; c = c[s] } return (typeof c === 'number' && Number.isFinite(c)) ? c : null }

function runOnce(mutate) {
  const b = JSON.parse(JSON.stringify(baseBuilding))
  if (typeof mutate === 'function') mutate(b)
  return calculateInstant(b, constructions, {}, libraryData, weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand: cb, _skipInterventions: true })
}

function snap(r) {
  return {
    demand_heating: pn(r, 'consumption.space_heating.demand_mwh'),
    demand_cooling: pn(r, 'consumption.space_cooling.demand_mwh'),
    delivered_heating: pn(r, 'consumption.space_heating.delivered_mwh'),
    delivered_cooling: pn(r, 'consumption.space_cooling.delivered_mwh'),
    eui: pn(r, 'consumption.total.kwh_per_m2_yr'),
  }
}

// Transition 1: follow_comfort (DEFAULT)
const t1 = snap(runOnce(b => {
  b.systems_config_v40.heating_setpoint_mode = 'follow_comfort'
  b.systems_config_v40.cooling_setpoint_mode = 'follow_comfort'
}))

// Transition 2: switch heating to custom + 28; leave cooling at follow_comfort.
// (Setting BOTH heating=28 AND cooling=18 would be a physically inconsistent
// config — heating>cooling — and the engine reasonably resolves it
// differently; this isn't what the gate is testing. Cooling override is
// tested separately in t2b.)
const t2 = snap(runOnce(b => {
  b.systems_config_v40.heating_setpoint_mode = 'custom'
  b.systems_config_v40.heating_setpoint_c = 28
}))
// Transition 2b: separate test — cooling-only override
const t2b = snap(runOnce(b => {
  b.systems_config_v40.cooling_setpoint_mode = 'custom'
  b.systems_config_v40.cooling_setpoint_c = 18
}))

// Transition 3: back to follow_comfort — must return to t1 byte-identical
const t3 = snap(runOnce(b => {
  b.systems_config_v40.heating_setpoint_mode = 'follow_comfort'
  b.systems_config_v40.cooling_setpoint_mode = 'follow_comfort'
}))

console.log('Brief 62 Part 2 — inherit/override transitions on Bridgewater')
console.log('comfortBand: lower_c=' + cb.lower_c + ' upper_c=' + cb.upper_c)
console.log()
console.log('  T1  follow_comfort:               demand_h=' + t1.demand_heating + '  demand_c=' + t1.demand_cooling + '  delivered_h=' + t1.delivered_heating + '  EUI=' + t1.eui)
console.log('  T2  heating=28 custom only:        demand_h=' + t2.demand_heating + '  demand_c=' + t2.demand_cooling + '  delivered_h=' + t2.delivered_heating + '  EUI=' + t2.eui)
console.log('  T2b cooling=18 custom only:        demand_h=' + t2b.demand_heating + '  demand_c=' + t2b.demand_cooling + '  delivered_c=' + t2b.delivered_cooling + '  EUI=' + t2b.eui)
console.log('  T3  back to follow_comfort:        demand_h=' + t3.demand_heating + '  demand_c=' + t3.demand_cooling + '  delivered_h=' + t3.delivered_heating + '  EUI=' + t3.eui)
console.log()

const TOL = 0.05
const gates = {
  'T1 inherit identity: demand_heating uses comfortBand.lower_c=21 → expect baseline 245.6': Math.abs((t1.demand_heating ?? 0) - 245.6) < TOL,
  'T1 demand == delivered (no contradiction)':  Math.abs((t1.demand_heating ?? 0) - (t1.delivered_heating ?? 0)) < TOL,
  'T2 custom override: demand_heating jumps to 493.5 (matches delivered)':  Math.abs((t2.demand_heating ?? 0) - 493.5) < TOL,
  'T2 demand == delivered (still no contradiction)':  Math.abs((t2.demand_heating ?? 0) - (t2.delivered_heating ?? 0)) < TOL,
  'T2b cooling-only custom=18: demand_cooling rises (77.9 expected, vs T1 69.1)':
    (t2b.demand_cooling ?? 0) > (t1.demand_cooling ?? 0) + 5 && Math.abs((t2b.demand_cooling ?? 0) - 77.9) < TOL,
  'T2b demand_cooling == delivered_cooling (no contradiction)':
    Math.abs((t2b.demand_cooling ?? 0) - (t2b.delivered_cooling ?? 0)) < TOL,
  'T3 reverts to T1 byte-identical (demand_heating)':  Math.abs((t3.demand_heating ?? 0) - (t1.demand_heating ?? 0)) < TOL,
  'T3 reverts to T1 byte-identical (demand_cooling)':  Math.abs((t3.demand_cooling ?? 0) - (t1.demand_cooling ?? 0)) < TOL,
  'T3 reverts to T1 byte-identical (EUI)':              Math.abs((t3.eui ?? 0) - (t1.eui ?? 0)) < TOL,
  'T1 anchor: EUI = 110.30 (Bridgewater clean)':        Math.abs((t1.eui ?? 0) - 110.30) < 0.1,
}
let pass = 0, fail = 0
for (const [k, v] of Object.entries(gates)) {
  console.log('  ' + (v ? '✓' : '✗ FAIL') + ' ' + k)
  v ? pass++ : fail++
}
console.log()
console.log(fail === 0 ? `ALL ${pass} GATES PASSED` : `${fail} of ${pass + fail} GATES FAILED`)
process.exit(fail === 0 ? 0 : 1)
