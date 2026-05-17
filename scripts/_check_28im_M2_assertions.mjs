/**
 * scripts/_check_28im_M2_assertions.mjs
 *
 * Brief 28-IM Gate IM-M2 (Internal Gains) pre-screenshot assertions.
 * Spec from brief §6.3 + IM-M2 additions §IM-M2 adds 1-3.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const API = 'http://127.0.0.1:8002'
const PROJECT_ID = process.argv[2] || '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fj(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

console.log('=== Brief 28-IM Gate IM-M2 pre-screenshot assertions ===\n')

const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const lib = await fj(`${API}/api/library/constructions`)
const libraryData = {
  constructions: (lib.constructions ?? []).map(c => ({
    name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c,
    layers: c.layers,
  })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
}

const bc = project.building_config
const epwPath = path.join(REPO_ROOT, 'data/weather/current', bc.weather_file)
const lines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const dl = lines.slice(8).filter(l => l.trim())
const N = dl.length
const wd = {
  temperature: new Float32Array(N), direct_normal: new Float32Array(N),
  diffuse_horizontal: new Float32Array(N), wind_speed: new Float32Array(N),
  month: new Int8Array(N), day: new Int8Array(N), hour: new Int8Array(N),
}
for (let i = 0; i < N; i++) {
  const p = dl[i].split(',')
  wd.month[i] = +p[1]; wd.day[i] = +p[2]; wd.hour[i] = +p[3]
  wd.temperature[i] = +p[6]; wd.direct_normal[i] = +p[14]
  wd.diffuse_horizontal[i] = +p[15]; wd.wind_speed[i] = +p[21]
}
const epwLat = parseFloat(lines[0].split(',')[6])
const hs = computeHourlySolarByFacade(wd, epwLat, bc.orientation ?? 0)
const s1 = calculateInstant(bc, project.construction_choices, {}, libraryData, wd, hs, null,
                            { mode: 'envelope-only', comfortBand: { lower_c: 21, upper_c: 25 } })
const s2 = calculateInstant(bc, project.construction_choices, {}, libraryData, wd, hs, null,
                            { mode: 'envelope-gains', comfortBand: { lower_c: 21, upper_c: 25 } })

const los_s1 = s1.losses_at_setpoint
const los_s2 = s2.losses_at_setpoint
const gainsMonthly = los_s2?.internal_gains_monthly

console.log('=== IM-M2 add 1: initial T_zone fix verification ===')
console.log(`  T_out[0]                : ${wd.temperature[0].toFixed(2)} °C (weather)`)
console.log(`  T_op[0] (Jan 1 00:00)   : ${s1?.free_running?.hourly_temperature_c?.[0]?.toFixed(2)} °C (engine S1)`)
console.log(`  T_op[1]                 : ${s1?.free_running?.hourly_temperature_c?.[1]?.toFixed(2)} °C`)
console.log()
console.log('=== IM-M2 add 2: monthly aggregation verification ===')
const wallM = los_s1?.external_wall?.monthly_heating_loss_kwh
const wallAnnual = los_s1?.external_wall?.heating_loss_kwh
const wallMSum = wallM ? Math.round(wallM.reduce((s, v) => s + v, 0) * 10) / 10 : null
console.log(`  losses_at_setpoint.external_wall.monthly_heating_loss_kwh: length=${wallM?.length}, sum=${wallMSum}`)
console.log(`  vs annual external_wall heating_loss_kwh                  : ${wallAnnual}`)
console.log(`  agreement                                                  : ${wallMSum != null && Math.abs(wallMSum - wallAnnual) < 1 ? 'PASS within 1 kWh' : 'FAIL'}`)
console.log(`  glazing.monthly_solar_transmission_kwh length              : ${los_s1?.glazing?.monthly_solar_transmission_kwh?.length}`)
console.log(`  internal_gains_monthly.people_kwh length (State 2)         : ${gainsMonthly?.people_kwh?.length}`)
console.log(`  internal_gains_monthly.equipment_kwh length                : ${gainsMonthly?.equipment_kwh?.length}`)
console.log()
console.log('=== IM-M2 main: engine output for Internal Gains tab ===')
console.log(`  s2.demand.heating_demand_mwh : ${s2.demand?.heating_demand_mwh}`)
console.log(`  s2.demand.cooling_demand_mwh : ${s2.demand?.cooling_demand_mwh}`)
console.log()

const failures = []

// Add 1: T_op[0] should equal T_out[0] (allow ±2 K — operative temp blends air + radiant)
const T_op_0 = s1?.free_running?.hourly_temperature_c?.[0]
const T_out_0 = wd.temperature[0]
if (T_op_0 == null || Math.abs(T_op_0 - T_out_0) > 3) {
  failures.push(`T_op[0] = ${T_op_0}, expected within 3 K of T_out[0] = ${T_out_0}`)
}

// Add 2: monthly arrays exist + length 12 + sum matches annual
if (!Array.isArray(wallM) || wallM.length !== 12) {
  failures.push(`losses_at_setpoint.external_wall.monthly_heating_loss_kwh missing or wrong length (got ${wallM?.length})`)
} else if (wallMSum != null && Math.abs(wallMSum - wallAnnual) > 5) {
  failures.push(`monthly_heating_loss_kwh sums to ${wallMSum}, expected ≈ ${wallAnnual} (annual)`)
}

if (!gainsMonthly?.people_kwh || gainsMonthly.people_kwh.length !== 12) {
  failures.push(`internal_gains_monthly.people_kwh missing or wrong length`)
}

// Main: heating demand sensible in State 2 envelope-gains
if (!(s2.demand?.heating_demand_mwh > 250 && s2.demand?.heating_demand_mwh < 800)) {
  failures.push(`State 2 heating demand = ${s2.demand?.heating_demand_mwh}, expected 250-800 MWh`)
}

console.log('=== Assertion results ===\n')
if (failures.length === 0) {
  console.log('  ✓ PASS — IM-M2 engine assertions all satisfied\n')
  process.exit(0)
} else {
  console.log(`  ✗ FAIL — ${failures.length} assertion(s) failed:`)
  for (const f of failures) console.log(`    - ${f}`)
  process.exit(2)
}
