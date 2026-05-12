/**
 * scripts/state1_engine_agreement.mjs
 *
 * Brief 26 Part 6 — engine-agreement check.
 *
 * Runs the live engine (`_calculateEnvelopeOnly` via `calculateInstant`)
 * on the same building config + weather + library that just drove the
 * EnergyPlus simulation, then prints the State 1 outputs side-by-side.
 *
 * Usage:
 *   node scripts/state1_engine_agreement.mjs <project_id> <run_id>
 *
 * Contract tolerances (per docs/state_contracts.md):
 *   <5%  → silent
 *   5–10% → soft flag
 *   10–30% → persistent warning
 *   >30%   → hard warning (investigate before Part 7)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'

const PROJECT_ID = process.argv[2] || '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'  // HIX Bridgewater
const RUN_ID = process.argv[3]
const API = 'http://127.0.0.1:8002'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

// ── 1. Fetch building config + library from running backend ───────────────────

async function fetchJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

const project = await fetchJson(`${API}/api/projects/${PROJECT_ID}`)
const constructionsLib = await fetchJson(`${API}/api/library/constructions`)
const constructionsArr = Array.isArray(constructionsLib)
  ? constructionsLib
  : (constructionsLib.constructions ?? Object.values(constructionsLib))
const libraryData = {
  constructions: constructionsArr.map(c => ({
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    config_json: c.config_json ?? c,
  })),
}

const buildingConfig = project.building_config
const constructionChoices = project.construction_choices

// ── 2. Parse the EPW into the WeatherContext shape ────────────────────────────

const weatherFile = buildingConfig.weather_file || project.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
console.log('Loading EPW:', epwPath)

const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const headerLine = epwLines[0].split(',')
const latitude = parseFloat(headerLine[6])
console.log('Latitude:', latitude)

const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N)
const direct_normal = new Float32Array(N), diffuse_horizontal = new Float32Array(N)
const wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i] = parseInt(p[1])
  hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6])
  direct_normal[i] = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15])
  wind_speed[i] = parseFloat(p[21])
}
console.log('EPW hours:', N, '| mean T:', (temperature.reduce((s,v)=>s+v,0)/N).toFixed(1))

const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, hour }

// ── 3. Hourly solar by facade ─────────────────────────────────────────────────

const orientation = buildingConfig.orientation || 0
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, orientation)
const annualSolar = {
  f1: Array.from(hourlySolar.f1).reduce((a,b)=>a+b,0) / 1000,
  f2: Array.from(hourlySolar.f2).reduce((a,b)=>a+b,0) / 1000,
  f3: Array.from(hourlySolar.f3).reduce((a,b)=>a+b,0) / 1000,
  f4: Array.from(hourlySolar.f4).reduce((a,b)=>a+b,0) / 1000,
}
console.log('Annual solar by facade (kWh/m²):',
  Object.fromEntries(Object.entries(annualSolar).map(([k,v]) => [k, v.toFixed(1)])))

// ── 4. Run live engine in envelope-only mode ──────────────────────────────────

const comfortBand = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}
console.log('Comfort band:', comfortBand)

const live = calculateInstant(
  { ...buildingConfig, comfort_band: comfortBand },
  constructionChoices, {}, libraryData,
  weatherData, hourlySolar, null,
  { mode: 'envelope-only', comfortBand },
)

// ── 5. Fetch simulation State 1 output ────────────────────────────────────────

let runIdToUse = RUN_ID
if (!runIdToUse) {
  const sims = await fetchJson(`${API}/api/projects/${PROJECT_ID}/simulations`)
  runIdToUse = sims[0]?.id
}
console.log('Sim run_id:', runIdToUse)
const sim = await fetchJson(
  `${API}/api/projects/${PROJECT_ID}/simulations/${runIdToUse}/balance?mode=envelope-only`
)

// ── 6. Side-by-side print with tolerance flagging ─────────────────────────────

function flag(live, sim) {
  if (live === null || live === undefined || sim === null || sim === undefined) return ''
  const denom = Math.max(Math.abs(live), 1e-6)
  const pct = ((sim - live) / denom) * 100
  let label = ''
  const absPct = Math.abs(pct)
  if (absPct < 5)        label = '✓ silent'
  else if (absPct < 10)  label = '~ soft'
  else if (absPct < 30)  label = '! warn'
  else                   label = '!! HARD'
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%  ${label}`
}

const f = (n, d=1) => (n == null) ? 'null' : Number(n).toFixed(d)

console.log()
console.log('═════════════════════════════════════════════════════════════════════')
console.log('  ENGINE-AGREEMENT CHECK — STATE 1 — HIX Bridgewater')
console.log('═════════════════════════════════════════════════════════════════════')
console.log()

const fr_live = live.free_running ?? {}
const fr_sim = sim.free_running ?? {}
console.log('  Free-running                  live          sim       delta')
console.log(`    annual_mean_c        ${f(fr_live.annual_mean_c).padStart(10)}  ${f(fr_sim.annual_mean_c).padStart(10)}   ${flag(fr_live.annual_mean_c, fr_sim.annual_mean_c)}`)
console.log(`    winter_min_c         ${f(fr_live.winter_min_c).padStart(10)}  ${f(fr_sim.winter_min_c).padStart(10)}   ${flag(fr_live.winter_min_c, fr_sim.winter_min_c)}`)
console.log(`    summer_max_c         ${f(fr_live.summer_max_c).padStart(10)}  ${f(fr_sim.summer_max_c).padStart(10)}   ${flag(fr_live.summer_max_c, fr_sim.summer_max_c)}`)
console.log()

const d_live = live.demand ?? {}
const d_sim = sim.demand ?? {}
console.log('  Demand                        live          sim       delta')
console.log(`    heating_demand_mwh   ${f(d_live.heating_demand_mwh).padStart(10)}  ${f(d_sim.heating_demand_mwh).padStart(10)}   ${flag(d_live.heating_demand_mwh, d_sim.heating_demand_mwh)}`)
console.log(`    cooling_demand_mwh   ${f(d_live.cooling_demand_mwh).padStart(10)}  ${f(d_sim.cooling_demand_mwh).padStart(10)}   ${flag(d_live.cooling_demand_mwh, d_sim.cooling_demand_mwh)}`)
console.log(`    underheating_hours   ${f(d_live.underheating_hours, 0).padStart(10)}  ${f(d_sim.underheating_hours, 0).padStart(10)}   ${flag(d_live.underheating_hours, d_sim.underheating_hours)}`)
console.log(`    overheating_hours    ${f(d_live.overheating_hours, 0).padStart(10)}  ${f(d_sim.overheating_hours, 0).padStart(10)}   ${flag(d_live.overheating_hours, d_sim.overheating_hours)}`)
console.log(`    comfort_hours        ${f(d_live.comfort_hours, 0).padStart(10)}  ${f(d_sim.comfort_hours, 0).padStart(10)}   ${flag(d_live.comfort_hours, d_sim.comfort_hours)}`)
console.log()

const lc_live = (live.losses ?? {}).conduction ?? {}
const lc_sim = (sim.losses ?? {}).conduction ?? {}
const glaz_live = (lc_live.glazing) ? Object.values(lc_live.glazing).reduce((a,b)=>a+b,0) : 0
const glaz_sim  = (lc_sim.glazing)  ? Object.values(lc_sim.glazing).reduce((a,b)=>a+b,0) : 0
console.log('  Conduction (kWh)              live          sim       delta')
console.log(`    external_wall        ${f(lc_live.external_wall).padStart(10)}  ${f(lc_sim.external_wall).padStart(10)}   ${flag(lc_live.external_wall, lc_sim.external_wall)}`)
console.log(`    roof                 ${f(lc_live.roof).padStart(10)}  ${f(lc_sim.roof).padStart(10)}   ${flag(lc_live.roof, lc_sim.roof)}`)
console.log(`    ground_floor         ${f(lc_live.ground_floor).padStart(10)}  ${f(lc_sim.ground_floor).padStart(10)}   ${flag(lc_live.ground_floor, lc_sim.ground_floor)}`)
console.log(`    glazing (total)      ${f(glaz_live).padStart(10)}  ${f(glaz_sim).padStart(10)}   ${flag(glaz_live, glaz_sim)}`)
console.log(`    thermal_bridging     ${f(lc_live.thermal_bridging).padStart(10)}  ${f(lc_sim.thermal_bridging).padStart(10)}   ${flag(lc_live.thermal_bridging, lc_sim.thermal_bridging)}`)
console.log()

const lv_live = (live.losses ?? {}).ventilation ?? {}
const lv_sim = (sim.losses ?? {}).ventilation ?? {}
console.log('  Ventilation (kWh)             live          sim       delta')
console.log(`    fabric_leakage       ${f(lv_live.fabric_leakage).padStart(10)}  ${f(lv_sim.fabric_leakage).padStart(10)}   ${flag(lv_live.fabric_leakage, lv_sim.fabric_leakage)}`)
console.log(`    permanent_vents      ${f(lv_live.permanent_vents).padStart(10)}  ${f(lv_sim.permanent_vents).padStart(10)}   ${flag(lv_live.permanent_vents, lv_sim.permanent_vents)}`)
console.log()

const gs_live = (live.gains ?? {}).solar ?? {}
const gs_sim = (sim.gains ?? {}).solar ?? {}
console.log('  Solar gains (kWh)             live          sim       delta')
console.log(`    f1 (north)           ${f(gs_live.f1).padStart(10)}  ${f(gs_sim.f1).padStart(10)}   ${flag(gs_live.f1, gs_sim.f1)}`)
console.log(`    f2 (east)            ${f(gs_live.f2).padStart(10)}  ${f(gs_sim.f2).padStart(10)}   ${flag(gs_live.f2, gs_sim.f2)}`)
console.log(`    f3 (south)           ${f(gs_live.f3).padStart(10)}  ${f(gs_sim.f3).padStart(10)}   ${flag(gs_live.f3, gs_sim.f3)}`)
console.log(`    f4 (west)            ${f(gs_live.f4).padStart(10)}  ${f(gs_sim.f4).padStart(10)}   ${flag(gs_live.f4, gs_sim.f4)}`)
console.log(`    total                ${f(gs_live.total).padStart(10)}  ${f(gs_sim.total).padStart(10)}   ${flag(gs_live.total, gs_sim.total)}`)
console.log()
console.log('═════════════════════════════════════════════════════════════════════')
console.log('  Contract bounds (v2.2 Bridgewater):')
console.log('    heating  150–250 MWh | cooling   5–20 MWh')
console.log('    underheat 4500–6500h | overheat 200–600h')
console.log('═════════════════════════════════════════════════════════════════════')
