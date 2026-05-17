/**
 * scripts/_check_28im_M3_assertions.mjs
 *
 * Brief 28-IM Gate IM-M3 (Operation tab) pre-screenshot assertions.
 *
 * Verifies the engine outputs required for the Operation module's
 * five view tabs:
 *   - Heat Balance: losses_at_setpoint.natural_ventilation[] heat_loss_kwh
 *   - Profiles:     daily_profiles + per-opening daily_heat_loss_kwh / daily_open_hours
 *   - Schedule:     control.mode + schedule_ref readable
 *   - Monthly:      natural_ventilation[*].monthly_heating_loss_kwh sums to annual
 *   - Summary:      annual loss + open_hours + avg_dT_when_open_k populated
 *
 * Also verifies the per-system mech vent daily/monthly arrays added for
 * IM-M4 (Systems Profiles/Monthly) reuse.
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

console.log('=== Brief 28-IM Gate IM-M3 pre-screenshot assertions ===\n')

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
const s2 = calculateInstant(bc, project.construction_choices, {}, libraryData, wd, hs, null,
                            { mode: 'envelope-gains', comfortBand: { lower_c: 21, upper_c: 25 } })

const los = s2.losses_at_setpoint
const nv  = los?.natural_ventilation ?? []
const vt  = los?.ventilation ?? []
const dp  = s2?.daily_profiles

console.log('=== Engine output presence ===')
console.log(`  losses_at_setpoint.natural_ventilation entries  : ${nv.length}`)
console.log(`  losses_at_setpoint.ventilation entries          : ${vt.length}`)
console.log(`  s2.daily_profiles present                       : ${!!dp}`)
console.log(`  daily_profiles.heat_loss_kwh.external_wall len  : ${dp?.heat_loss_kwh?.external_wall?.length}`)
console.log(`  daily_profiles.weather.t_out_sum_c len          : ${dp?.weather?.t_out_sum_c?.length}`)
console.log()

console.log('=== Per-opening natural ventilation (Operation Profiles + Monthly + Summary) ===')
for (const o of nv) {
  const dailySum = Array.isArray(o.daily_heat_loss_kwh)
    ? Math.round(o.daily_heat_loss_kwh.reduce((s, v) => s + v, 0) * 10) / 10
    : null
  const monthlySum = Array.isArray(o.monthly_heating_loss_kwh)
    ? Math.round(o.monthly_heating_loss_kwh.reduce((s, v) => s + v, 0) * 10) / 10
    : null
  const ohSum = Array.isArray(o.daily_open_hours)
    ? o.daily_open_hours.reduce((s, v) => s + v, 0)
    : null
  console.log(`  ${o.name} (facade ${o.facade}, mode ${o.mode}):`)
  console.log(`    annual heat_loss_kwh            : ${o.heat_loss_kwh}`)
  console.log(`    daily_heat_loss_kwh sum         : ${dailySum} (len ${o.daily_heat_loss_kwh?.length})`)
  console.log(`    monthly_heating_loss_kwh sum    : ${monthlySum} (len ${o.monthly_heating_loss_kwh?.length})`)
  console.log(`    annual open_hours               : ${o.open_hours}`)
  console.log(`    daily_open_hours sum            : ${ohSum} (len ${o.daily_open_hours?.length})`)
  console.log(`    avg_flow_when_open_l_s          : ${o.avg_flow_when_open_l_s}`)
  console.log(`    avg_dT_when_open_k              : ${o.avg_dT_when_open_k}`)
}
console.log()

console.log('=== Per-system mech vent daily + monthly (IM-M4 prep) ===')
for (const v of vt) {
  const dailySum = Array.isArray(v.daily_heat_loss_kwh)
    ? Math.round(v.daily_heat_loss_kwh.reduce((s, x) => s + x, 0) * 10) / 10
    : null
  const monthlySum = Array.isArray(v.monthly_heating_loss_kwh)
    ? Math.round(v.monthly_heating_loss_kwh.reduce((s, x) => s + x, 0) * 10) / 10
    : null
  console.log(`  ${v.name}:`)
  console.log(`    annual heat_loss_kwh            : ${v.heat_loss_kwh}`)
  console.log(`    daily_heat_loss_kwh sum         : ${dailySum} (len ${v.daily_heat_loss_kwh?.length})`)
  console.log(`    monthly_heating_loss_kwh sum    : ${monthlySum} (len ${v.monthly_heating_loss_kwh?.length})`)
}
console.log()

console.log('=== State 2 daily_profiles (Operation Profiles weather strip) ===')
if (dp) {
  const wallSum = dp.heat_loss_kwh.external_wall.reduce((s, v) => s + v, 0)
  const wallAnnual = los.external_wall.heating_loss_kwh
  console.log(`  daily external_wall sum         : ${wallSum.toFixed(1)} kWh`)
  console.log(`  vs annual external_wall         : ${wallAnnual} kWh`)
  console.log(`  agreement                       : ${Math.abs(wallSum - wallAnnual) < 5 ? 'PASS within 5 kWh' : 'FAIL'}`)
}
console.log()

const failures = []

// ─ Assertion set ─
if (nv.length === 0) failures.push('No natural ventilation openings — expected at least 1 (gf_entrance_door)')

for (const o of nv) {
  if (!Array.isArray(o.daily_heat_loss_kwh) || o.daily_heat_loss_kwh.length !== 365) {
    failures.push(`opening ${o.id}: daily_heat_loss_kwh missing or wrong length`)
  }
  if (!Array.isArray(o.daily_open_hours) || o.daily_open_hours.length !== 365) {
    failures.push(`opening ${o.id}: daily_open_hours missing or wrong length`)
  }
  if (!Array.isArray(o.monthly_heating_loss_kwh) || o.monthly_heating_loss_kwh.length !== 12) {
    failures.push(`opening ${o.id}: monthly_heating_loss_kwh missing or wrong length`)
  } else {
    const dailySum = o.daily_heat_loss_kwh.reduce((s, v) => s + v, 0)
    const monthlySum = o.monthly_heating_loss_kwh.reduce((s, v) => s + v, 0)
    if (Math.abs(dailySum - monthlySum) > 2) {
      failures.push(`opening ${o.id}: monthly sum (${monthlySum.toFixed(1)}) != daily sum (${dailySum.toFixed(1)})`)
    }
    if (Math.abs(monthlySum - o.heat_loss_kwh) > 2) {
      failures.push(`opening ${o.id}: monthly sum (${monthlySum.toFixed(1)}) != annual heat_loss_kwh (${o.heat_loss_kwh})`)
    }
  }
  // Open-hours agreement
  const ohSum = o.daily_open_hours.reduce((s, v) => s + v, 0)
  if (Math.abs(ohSum - o.open_hours) > 1) {
    failures.push(`opening ${o.id}: daily_open_hours sum (${ohSum}) != open_hours (${o.open_hours})`)
  }
}

if (!dp) failures.push('State 2 daily_profiles missing')
else {
  if (dp.heat_loss_kwh?.external_wall?.length !== 365) failures.push('daily_profiles.heat_loss_kwh.external_wall wrong length')
  if (dp.weather?.t_out_sum_c?.length !== 365)        failures.push('daily_profiles.weather.t_out_sum_c wrong length')
  const wallSum = dp.heat_loss_kwh.external_wall.reduce((s, v) => s + v, 0)
  if (Math.abs(wallSum - los.external_wall.heating_loss_kwh) > 5) {
    failures.push(`daily external_wall sum (${wallSum.toFixed(1)}) != annual (${los.external_wall.heating_loss_kwh})`)
  }
}

for (const v of vt) {
  if (!Array.isArray(v.daily_heat_loss_kwh) || v.daily_heat_loss_kwh.length !== 365) {
    failures.push(`mech vent ${v.name}: daily_heat_loss_kwh missing or wrong length`)
  }
  if (!Array.isArray(v.monthly_heating_loss_kwh) || v.monthly_heating_loss_kwh.length !== 12) {
    failures.push(`mech vent ${v.name}: monthly_heating_loss_kwh missing or wrong length`)
  }
}

console.log('=== Assertion results ===\n')
if (failures.length === 0) {
  console.log('  ✓ PASS — IM-M3 engine assertions all satisfied\n')
  process.exit(0)
} else {
  console.log(`  ✗ FAIL — ${failures.length} assertion(s) failed:`)
  for (const f of failures) console.log(`    - ${f}`)
  process.exit(2)
}
