/**
 * scripts/_check_28tb_v1_assertions.mjs
 *
 * Brief 28-TB-Simple Gate TB-V1: pre-screenshot engine assertions.
 *
 * Chris's TB-V1 instruction: "before capturing, hit the API endpoint and
 * assert: losses_at_setpoint.thermal_bridging.heating_loss_kwh exists and
 * is in 8,000-18,000 kWh range; losses_at_setpoint.natural_ventilation.length
 * === 1; losses_at_setpoint.ventilation.length === 3; demand.heating_demand_mwh
 * between 400 and 600. If any assert fails, halt the helper BEFORE screenshot
 * and surface the actual numbers. This prevents shipping a 'looks fine'
 * screenshot of stale state."
 *
 * Implementation:
 *   - `losses_at_setpoint` lives in the BROWSER engine output, not on the
 *     backend API. Hits the backend for the Bridgewater project state, runs
 *     calculateInstant locally (same code path the browser exercises), then
 *     asserts against the result.
 *   - Exits 0 on PASS, 2 on FAIL (assertion). Distinguished from script
 *     errors (exit 1).
 *   - Prints actual numbers regardless of pass/fail, so the halt report
 *     captures the engine state at this moment.
 *
 * Usage:
 *   node scripts/_check_28tb_v1_assertions.mjs                # default project
 *   node scripts/_check_28tb_v1_assertions.mjs <project_id>   # explicit
 *
 * Pre-reqs:
 *   - Backend running on 127.0.0.1:8002
 *   - Bridgewater seed has been re-run under Brief 28-TB-Simple (so
 *     thermal_bridges block is persisted + WWR.north = 0.35)
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const API = 'http://127.0.0.1:8002'
const DEFAULT_PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'  // Bridgewater HIX
const PROJECT_ID = process.argv[2] || DEFAULT_PROJECT_ID

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fj(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

console.log('=== Brief 28-TB-Simple TB-V1 pre-screenshot assertions ===')
console.log()
console.log(`Project: ${PROJECT_ID}`)
console.log(`API:     ${API}`)
console.log()

// Fetch project state + libraries
const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const lib = await fj(`${API}/api/library/constructions`)

// TB-V1b Operation tab assertion (per Chris's TB-V1b instruction): verify
// that building_config.operable_openings is on the wire with the expected
// gf_entrance_door entry. This is the persisted-state half — confirms the
// ProjectContext allowlist will have something to surface. UI rendering
// verification still requires the screenshot.
const persistedOpenings = project?.building_config?.operable_openings ?? []
console.log('=== Persisted state (project API response) ===')
console.log()
console.log(`  building_config.operable_openings.length : ${persistedOpenings.length}`)
for (const o of persistedOpenings) {
  console.log(`    - id=${o.id}  facade=${o.facade}  area=${o.area_m2}  mode=${o?.control?.mode}`)
}
console.log()

const libraryData = {
  constructions: (lib.constructions ?? []).map(c => ({
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c,
    layers: c.layers,
  })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
}

const bc = project.building_config
const cc = project.construction_choices

// Load EPW for Bridgewater (Yeovilton TMYx — file path matches what
// engine validation scripts use)
const epwPath = path.join(REPO_ROOT, 'data/weather/current', bc.weather_file)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const dl = epwLines.slice(8).filter(l => l.trim())
const N = dl.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), direct_normal = new Float32Array(N)
const diffuse_horizontal = new Float32Array(N), wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dl[i].split(',')
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6]); direct_normal[i] = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15]); wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const epwLat = parseFloat(epwLines[0].split(',')[6])
const hourlySolar = computeHourlySolarByFacade(weatherData, epwLat, bc.orientation ?? 0)

const comfortBand = {
  lower_c: project.comfort_band_lower_c ?? 21,
  upper_c: project.comfort_band_upper_c ?? 25,
}

// Run engine in envelope-gains (State 2) — matches what the Building tab
// Heat Balance toggle and /balance-test render.
const result = calculateInstant(bc, cc, {}, libraryData, weatherData, hourlySolar, null,
                                 { mode: 'envelope-gains', comfortBand })

const losses = result.losses_at_setpoint ?? {}
const demand = result.demand ?? {}
const tb     = losses.thermal_bridging ?? {}

// Surface the actual numbers (PASS or FAIL — Chris wants these visible)
console.log('=== Engine output (envelope-gains, State 2) ===')
console.log()
console.log(`  losses_at_setpoint.thermal_bridging:`)
console.log(`    mode                       : ${tb.mode}`)
console.log(`    multiplier                 : ${tb.multiplier}`)
console.log(`    total_H_TB_W_per_K         : ${tb.total_H_TB_W_per_K}`)
console.log(`    heating_loss_kwh           : ${tb.heating_loss_kwh}`)
console.log(`    derived_alpha_pct          : ${tb.derived_alpha_pct}`)
console.log(`    y_value_W_per_m2K_derived  : ${tb.y_value_W_per_m2K_derived}`)
if (Array.isArray(tb.junctions)) {
  console.log(`    junctions (${tb.junctions.length}):`)
  for (const j of tb.junctions) {
    console.log(`      - ${j.type.padEnd(28)} L=${String(j.length_m).padStart(7)} m  psi=${j.psi_W_per_mK}  -> ${j.contribution_W_per_K} W/K`)
  }
}
console.log()
console.log(`  losses_at_setpoint.natural_ventilation: ${(losses.natural_ventilation ?? []).length} entries`)
for (const o of losses.natural_ventilation ?? []) {
  console.log(`    - id=${o.id}  facade=${o.facade}  heat_loss=${o.heat_loss_kwh} kWh  open_hours=${o.open_hours}`)
}
console.log()
console.log(`  losses_at_setpoint.ventilation:        ${(losses.ventilation ?? []).length} entries`)
for (const v of losses.ventilation ?? []) {
  console.log(`    - ${v.name.padEnd(24)} flow=${v.flow_l_s} L/s  hre=${v.hre}  heat_loss=${v.heat_loss_kwh} kWh`)
}
console.log()
console.log(`  demand.heating_demand_mwh : ${demand.heating_demand_mwh}`)
console.log(`  demand.cooling_demand_mwh : ${demand.cooling_demand_mwh}`)
console.log()

// Assertions (per Chris's TB-V1 instruction + TB-V1b Operation tab addition)
const failures = []

// TB-V1b: verify the persisted state has the Bridgewater gf_entrance_door
// — the precondition for the OperationModule to render anything. The UI
// allowlist fix (ProjectContext._applyProject) is verified by screenshot.
if (persistedOpenings.length !== 1) {
  failures.push(`building_config.operable_openings.length = ${persistedOpenings.length}, expected 1 (gf_entrance_door from Bridgewater seed)`)
} else if (persistedOpenings[0].id !== 'gf_entrance_door') {
  failures.push(`building_config.operable_openings[0].id = "${persistedOpenings[0].id}", expected "gf_entrance_door"`)
}

if (!(tb.heating_loss_kwh > 0)) {
  failures.push(`thermal_bridging.heating_loss_kwh missing or zero (got ${tb.heating_loss_kwh})`)
} else if (tb.heating_loss_kwh < 8000 || tb.heating_loss_kwh > 18000) {
  failures.push(`thermal_bridging.heating_loss_kwh = ${tb.heating_loss_kwh} kWh, outside expected 8,000–18,000 kWh range`)
}

const natventLen = (losses.natural_ventilation ?? []).length
if (natventLen !== 1) {
  failures.push(`losses_at_setpoint.natural_ventilation.length = ${natventLen}, expected 1 (the gf_entrance_door)`)
}

const ventLen = (losses.ventilation ?? []).length
if (ventLen !== 3) {
  failures.push(`losses_at_setpoint.ventilation.length = ${ventLen}, expected 3 (mvhr_gf_public + bedroom_extract + public_toilet_extract)`)
}

const hdMwh = demand.heating_demand_mwh
if (!(hdMwh > 0)) {
  failures.push(`demand.heating_demand_mwh missing or zero (got ${hdMwh})`)
} else if (hdMwh < 400 || hdMwh > 600) {
  failures.push(`demand.heating_demand_mwh = ${hdMwh} MWh, outside expected 400–600 MWh range`)
}

console.log('=== Assertion results ===')
console.log()
if (failures.length === 0) {
  console.log('  ✓ PASS — all 4 assertions satisfied')
  console.log()
  console.log('Safe to capture screenshot.')
  process.exit(0)
} else {
  console.log(`  ✗ FAIL — ${failures.length} assertion(s) failed:`)
  for (const f of failures) console.log(`    - ${f}`)
  console.log()
  console.log('HALT screenshot capture. Investigate before commit.')
  process.exit(2)
}
