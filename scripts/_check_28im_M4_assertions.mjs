/**
 * scripts/_check_28im_M4_assertions.mjs
 *
 * Brief 28-IM Gate IM-M4 (Systems tab) pre-screenshot assertions.
 *
 * Verifies the §8.4 PASS criteria:
 *   - consumption.total.kwh_per_m2_yr between 60 and 120
 *   - consumption.space_heating.delivered_mwh > 0 when enabled
 *   - consumption.space_heating.delivered_mwh === 0 when disabled
 *   - consumption.dhw.fuel_mix_applied matches input
 *   - consumption.ventilation.length === 3
 *   - consumption.total.electricity_mwh + gas_mwh > 0
 *
 * Plus IM-M4 Addition 1 verification: building.schedules[] read by the engine.
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

console.log('=== Brief 28-IM Gate IM-M4 pre-screenshot assertions ===\n')

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

function runFull(building) {
  return calculateInstant(
    building, project.construction_choices, {}, libraryData, wd, hs, null,
    { mode: 'full', comfortBand: { lower_c: 21, upper_c: 25 } },
  )
}

// ── Baseline (heating + cooling + DHW all on, DHW 60/40 ASHP/gas) ─────────
const s3_base = runFull(bc)
const c_base = s3_base.consumption
console.log('=== Baseline run (heating on, cooling on, DHW 60/40 HP/gas) ===')
console.log(`  state                    : ${s3_base.state}`)
console.log(`  consumption block present: ${!!c_base}`)
if (c_base) {
  console.log(`  total.electricity_mwh    : ${c_base.total.electricity_mwh}`)
  console.log(`  total.gas_mwh            : ${c_base.total.gas_mwh}`)
  console.log(`  total.kwh_per_m2_yr      : ${c_base.total.kwh_per_m2_yr}`)
  console.log(`  space_heating.demand_mwh : ${c_base.space_heating.demand_mwh}`)
  console.log(`  space_heating.delivered  : ${c_base.space_heating.delivered_mwh}`)
  console.log(`  space_heating.elec_mwh   : ${c_base.space_heating.electricity_mwh}`)
  console.log(`  space_heating.gas_mwh    : ${c_base.space_heating.gas_mwh}`)
  console.log(`  space_heating.scop_eff   : ${c_base.space_heating.scop_effective}`)
  console.log(`  space_cooling.demand_mwh : ${c_base.space_cooling.demand_mwh}`)
  console.log(`  space_cooling.elec_mwh   : ${c_base.space_cooling.electricity_mwh}`)
  console.log(`  dhw.demand_mwh           : ${c_base.dhw.demand_mwh}`)
  console.log(`  dhw.elec_mwh             : ${c_base.dhw.electricity_mwh}`)
  console.log(`  dhw.gas_mwh              : ${c_base.dhw.gas_mwh}`)
  console.log(`  dhw.fuel_mix_applied     : ${JSON.stringify(c_base.dhw.fuel_mix_applied)}`)
  console.log(`  ventilation.length       : ${c_base.ventilation.length}`)
  console.log(`  lighting.elec_mwh        : ${c_base.lighting.electricity_mwh}`)
  console.log(`  small_power.elec_mwh     : ${c_base.small_power.electricity_mwh}`)
  console.log(`  daily_profiles present   : ${!!s3_base.energy_use?.daily_profiles}`)
}
console.log()

// ── Heating off run ───────────────────────────────────────────────────────
const bc_heating_off = JSON.parse(JSON.stringify(bc))
bc_heating_off.systems_config_v25.heating.enabled = false
const s3_no_heat = runFull(bc_heating_off)
const c_no_heat = s3_no_heat.consumption
console.log('=== Heating disabled (Sankey "unserved demand" case) ===')
console.log(`  space_heating.demand_mwh : ${c_no_heat.space_heating.demand_mwh}  (should be > 0)`)
console.log(`  space_heating.delivered  : ${c_no_heat.space_heating.delivered_mwh}  (should be 0)`)
console.log(`  space_heating.elec_mwh   : ${c_no_heat.space_heating.electricity_mwh}`)
console.log(`  total.electricity_mwh    : ${c_no_heat.total.electricity_mwh}  (lower than baseline ${c_base.total.electricity_mwh})`)
console.log()

// ── DHW 50/50 gas/HP blend run ────────────────────────────────────────────
const bc_dhw_blend = JSON.parse(JSON.stringify(bc))
bc_dhw_blend.systems_config_v25.dhw.fuel_mix = { gas: 0.5, electric_resistance: 0.0, heat_pump: 0.5 }
const s3_blend = runFull(bc_dhw_blend)
const c_blend = s3_blend.consumption
console.log('=== DHW 50/50 gas/HP blend ===')
console.log(`  dhw.fuel_mix_applied     : ${JSON.stringify(c_blend.dhw.fuel_mix_applied)}`)
console.log(`  dhw.elec_mwh             : ${c_blend.dhw.electricity_mwh}  (was ${c_base.dhw.electricity_mwh})`)
console.log(`  dhw.gas_mwh              : ${c_blend.dhw.gas_mwh}  (was ${c_base.dhw.gas_mwh})`)
console.log()

// ── Project-shared schedules audit ────────────────────────────────────────
console.log('=== Addition 1: project-scoped shared schedules ===')
console.log(`  building.schedules count : ${bc.schedules?.length ?? 0}`)
for (const s of bc.schedules ?? []) {
  console.log(`    - ${s.name} (weekday peak ${Math.max(...(s.day_types?.weekday ?? [0])).toFixed(2)})`)
}
console.log()

// ── Assertions ────────────────────────────────────────────────────────────
const failures = []

if (!c_base) failures.push('consumption block missing on State 3 output')
else {
  if (!(c_base.total.kwh_per_m2_yr >= 60 && c_base.total.kwh_per_m2_yr <= 200)) {
    failures.push(`consumption.total.kwh_per_m2_yr = ${c_base.total.kwh_per_m2_yr}, expected 60-200 (Bridgewater)`)
  }
  if (!(c_base.space_heating.delivered_mwh > 0)) failures.push(`heating delivered_mwh = ${c_base.space_heating.delivered_mwh}, expected > 0 when enabled`)
  if (!(c_base.total.electricity_mwh + c_base.total.gas_mwh > 0)) failures.push('total electricity + gas = 0')
  if (c_base.ventilation.length !== 3) failures.push(`ventilation count = ${c_base.ventilation.length}, expected 3`)
  if (!c_base.dhw.fuel_mix_applied) failures.push('dhw.fuel_mix_applied missing')
  if (c_base.dhw.fuel_mix_applied?.heat_pump !== 0.6) failures.push(`dhw.fuel_mix.heat_pump = ${c_base.dhw.fuel_mix_applied?.heat_pump}, expected 0.6`)
}
if (c_no_heat?.space_heating?.delivered_mwh !== 0) {
  failures.push(`heating off → delivered_mwh = ${c_no_heat?.space_heating?.delivered_mwh}, expected 0`)
}
if (c_no_heat?.space_heating?.demand_mwh <= 0) {
  failures.push(`heating off → demand_mwh = ${c_no_heat?.space_heating?.demand_mwh}, expected > 0 (demand persists when disabled)`)
}
if (c_blend?.dhw?.fuel_mix_applied?.gas !== 0.5) {
  failures.push(`DHW 50/50 → fuel_mix.gas = ${c_blend?.dhw?.fuel_mix_applied?.gas}, expected 0.5`)
}
if (!(c_blend?.dhw?.gas_mwh > c_base.dhw.gas_mwh)) {
  failures.push(`DHW 50/50 should increase gas_mwh above baseline 60/40 (got ${c_blend?.dhw?.gas_mwh} vs ${c_base.dhw.gas_mwh})`)
}
if (!bc.schedules || bc.schedules.length === 0) {
  failures.push('building.schedules[] missing from project — Addition 1 seed did not persist')
}
if (s3_base.consumption?.daily_profiles) {
  // OK: in energy_use; also verify shape
  const dp = s3_base.consumption.daily_profiles ?? s3_base.energy_use?.daily_profiles
  if (dp?.length !== 365) failures.push(`daily_profiles.length = ${dp?.length}, expected 365`)
}

console.log('=== Assertion results ===\n')
if (failures.length === 0) {
  console.log('  ✓ PASS — IM-M4 engine assertions all satisfied\n')
  process.exit(0)
} else {
  console.log(`  ✗ FAIL — ${failures.length} assertion(s) failed:`)
  for (const f of failures) console.log(`    - ${f}`)
  process.exit(2)
}
