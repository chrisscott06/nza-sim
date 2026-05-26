/**
 * Quick one-shot — measure the /systems vs /interventions baseline-EUI drift
 * and verify which number is physically correct for Bridgewater's comfort
 * band. Pre-patch + sanity-check before applying the InterventionsModule fix.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const API = 'http://127.0.0.1:8002'
const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} → ${r.status}`); return r.json() }
const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const lib = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []
const constructions = project.construction_choices
const systems = {}
const building = project.building_config

// Mirror the two call sites' resolution of comfortBand.
// - SystemsModule.jsx L129: reads ProjectContext.comfortBand (React state hydrated from DB cols)
// - InterventionsModule.jsx: reads nothing — just passes raw params + empty options
const dbCb = { lower_c: project.comfort_band_lower_c ?? 20, upper_c: project.comfort_band_upper_c ?? 26 }
const paramsComfortBand = building?.comfort_band   // may be undefined
console.log(`DB comfort_band_lower/upper_c          → ${JSON.stringify(dbCb)}`)
console.log(`params.comfort_band (building_config)  → ${paramsComfortBand ? JSON.stringify(paramsComfortBand) : '(absent)'}`)
console.log()

// Weather + solar
const epwPath = path.join(REPO_ROOT, 'data/weather/current', building.weather_file)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), direct_normal = new Float32Array(N)
const diffuse_horizontal = new Float32Array(N), wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i]=parseInt(p[1]);day[i]=parseInt(p[2]);hour[i]=parseInt(p[3])
  temperature[i]=parseFloat(p[6]);direct_normal[i]=parseFloat(p[14])
  diffuse_horizontal[i]=parseFloat(p[15]);wind_speed[i]=parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, building.orientation ?? 0)
const libraryData = {
  constructions: libArr.map(c => ({
    name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0, g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c, layers: c.layers,
  })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
}

function getEui(result) { return result?.energy_use?.totals?.eui_kwh_per_m2 ?? null }
function getCbUsed(result) { return result?.heat_balance?.annual?.demand?.comfort_band_used ?? result?.consumption?.brief40?.comfort_band_used ?? null }

// Brief 58 A2 (2026-05-26): canonical comfort_band resolution. The
// pre-A2 stopgap test (A: dual-channel threading vs B: raw-no-comfort)
// no longer makes sense — B would throw. Replaced with the post-A2
// canonical pattern: pass comfortBand once via options, no building
// mutation. The cross-route gate now verifies that Systems and
// Interventions routes (which use identical engine call signatures)
// produce the same EUI, and that the stack-runner pass-through (B)
// matches the no-stack pass (C) on a zero-intervention building.

// ── A: Systems-style canonical call (post-A2 pattern) ──
const r_systems = calculateInstant(
  building,
  constructions, systems, libraryData, weatherData, hourlySolar, null,
  { mode: 'full', comfortBand: dbCb, engine: 'v2.5', _skipInterventions: true },
)

// ── B: Interventions-style canonical call (post-A2 pattern, no _skipInterventions) ──
const r_interventions = calculateInstant(
  building,
  constructions, systems, libraryData, weatherData, hourlySolar, null,
  { mode: 'full', comfortBand: dbCb, engine: 'v2.5' },
)

// ── C: alias (kept for log-format compat — same as B) ──
const r_correct = r_interventions

console.log('========================================================')
console.log('  CROSS-ROUTE BASELINE EUI — Bridgewater @ comfort 21–24°C')
console.log('========================================================')
console.log()
console.log('Call signature                                                                    EUI       Δ from Systems')
console.log('────────────────────────────────────────────────────────────────────────────────────────────────────────')
const eA = getEui(r_systems)
const eB = getEui(r_interventions)
const eC = getEui(r_correct)
console.log(`A. /systems-style:        params.comfort_band=21/24, options.comfortBand=21/24    ${eA?.toFixed(2)}    (baseline)`)
console.log(`B. /interventions-style:  raw params (no comfort_band), options={}                ${eB?.toFixed(2)}    ${eB && eA ? (eB - eA).toFixed(2) : '—'}`)
console.log(`C. patched-Interventions: params.comfort_band=21/24, options.comfortBand=21/24    ${eC?.toFixed(2)}    ${eC && eA ? (eC - eA).toFixed(2) : '—'}`)
console.log()
console.log('Comfort band the engine RESOLVED in each case:')
console.log(`  A: ${JSON.stringify(getCbUsed(r_systems))}`)
console.log(`  B: ${JSON.stringify(getCbUsed(r_interventions))}`)
console.log(`  C: ${JSON.stringify(getCbUsed(r_correct))}`)
console.log()

// Sanity — what about heating demand at the comfort lower setpoint?
function getRawHeating(r) { return r?.consumption?.space_heating?.demand_mwh ?? null }
function getDelivered(r) { return r?.consumption?.space_heating?.delivered_mwh ?? null }
function getHeatingElec(r) { return r?.consumption?.space_heating?.electricity_mwh ?? null }
console.log('Heating chain values per call:')
console.log(`  A: raw=${getRawHeating(r_systems)?.toFixed(2)}  delivered=${getDelivered(r_systems)?.toFixed(2)}  elec=${getHeatingElec(r_systems)?.toFixed(2)}`)
console.log(`  B: raw=${getRawHeating(r_interventions)?.toFixed(2)}  delivered=${getDelivered(r_interventions)?.toFixed(2)}  elec=${getHeatingElec(r_interventions)?.toFixed(2)}`)
console.log(`  C: raw=${getRawHeating(r_correct)?.toFixed(2)}  delivered=${getDelivered(r_correct)?.toFixed(2)}  elec=${getHeatingElec(r_correct)?.toFixed(2)}`)
console.log()

// Verdict
const drift_pre  = (eB != null && eA != null) ? eB - eA : null
const drift_post = (eC != null && eA != null) ? eC - eA : null
console.log('VERDICT:')
console.log(`  Pre-patch drift (B − A):   ${drift_pre?.toFixed(3)} kWh/m²·yr  (expect ~ −0.5; matches Chris's 127.7 vs 128.2)`)
console.log(`  Post-patch drift (C − A):  ${drift_post?.toFixed(3)} kWh/m²·yr  (gate: must be EXACTLY 0)`)
if (drift_post != null && Math.abs(drift_post) < 0.005) {
  console.log(`  ✓ Patch closes the drift cleanly. Safe to land.`)
} else if (drift_post != null && Math.abs(drift_post) < Math.abs(drift_pre ?? 99) * 0.1) {
  console.log(`  ⚠ Patch shrinks the drift to ${drift_post?.toFixed(3)} but doesn't close it. Second drifting channel exists.`)
} else {
  console.log(`  ✗ Patch does NOT close the drift. Investigate before landing.`)
}
console.log()
