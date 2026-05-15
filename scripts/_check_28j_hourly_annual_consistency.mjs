/**
 * scripts/_check_28j_hourly_annual_consistency.mjs
 *
 * Quick consistency check for Chris's secondary issue (2026-05-15):
 * verify that sum(heating_demand_hourly_kwh) === heating_demand_mwh × 1000.
 * Both come from State 2's same accumulator loop, so they MUST match by
 * construction -- this is the validation that the hourly array I added
 * in Brief 28j wasn't accidentally diverged from the annual aggregate.
 *
 * Also reconstructs the heating-fuel chain to verify the engine math:
 *   state2_heating_demand
 *     - sum(min(theoretical_h, demand_h))     [Brief 28j per-hour cap]
 *     = heating_demand_for_systems
 *     / weighted_scop
 *     = heating_fuel
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json() }

const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const lib = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []
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
const bc = project.building_config
const cc = project.construction_choices

const epwPath = path.join(REPO_ROOT, 'data/weather/current', bc.weather_file)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const epwLat = parseFloat(epwLines[0].split(',')[6])
const dl = epwLines.slice(8).filter(l => l.trim().length > 0)
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
const hourlySolar = computeHourlySolarByFacade(weatherData, epwLat, bc.orientation ?? 0)
const cb = { lower_c: project.comfort_band_lower_c ?? 21, upper_c: project.comfort_band_upper_c ?? 25 }

const result = calculateInstant(bc, cc, {}, libraryData, weatherData, hourlySolar, null, { mode: 'full', comfortBand: cb })

const annual_demand_mwh = result.demand.heating_demand_mwh
const hourly_array = result.demand.heating_demand_hourly_kwh
const hourly_sum_kwh = hourly_array.reduce((s, v) => s + v, 0)
const hourly_sum_mwh = hourly_sum_kwh / 1000
const expected_kwh = annual_demand_mwh * 1000
const consistency_delta_kwh = Math.abs(hourly_sum_kwh - expected_kwh)
const consistency_pct = consistency_delta_kwh / Math.max(expected_kwh, 1e-9) * 100

console.log()
console.log('=== Brief 28j consistency check: hourly vs annual ===')
console.log()
console.log(`State 2 annual heating demand:           ${annual_demand_mwh.toFixed(4)} MWh`)
console.log(`Sum of hourly_heating_demand_kwh:        ${hourly_sum_mwh.toFixed(4)} MWh`)
console.log(`Δ:                                       ${(hourly_sum_mwh - annual_demand_mwh).toFixed(4)} MWh`)
console.log(`Δ % of annual:                           ${consistency_pct.toFixed(4)} %`)
console.log()
const PASS_THRESHOLD_PCT = 0.1  // 0.1% tolerance for rounding artefacts
if (consistency_pct < PASS_THRESHOLD_PCT) {
  console.log(`✓ PASS — sum(hourly) === annual within ${PASS_THRESHOLD_PCT}% (the annual aggregate IS the sum)`)
} else {
  console.log(`✗ FAIL — divergence > ${PASS_THRESHOLD_PCT}% threshold. Engine bug.`)
  process.exit(1)
}

console.log()
console.log('=== Heating-fuel chain reconstruction ===')
console.log()
const sp = result.system_performance.heating
const ventTotal = result.system_performance.ventilation.total
const effective_recovery = ventTotal.recovery_mwh
const theoretical_recovery = ventTotal.recovery_theoretical_mwh
const heating_for_systems = Math.max(0, annual_demand_mwh - effective_recovery)
const delivered = sp.total.delivered_mwh
const fuel = sp.total.fuel_mwh

// Weighted SCOP from the configured split
const v25 = bc.systems_config_v25 ?? {}
const heat = v25.heating ?? {}
const primary_pct = (heat.primary_pct ?? 100) / 100
const primary_scop = SYSTEM_TEMPLATES_LIBRARY.find(t => t.id === heat.primary?.library_id)?.heating_scop ?? 1
const sec_scop = heat.secondary ? (SYSTEM_TEMPLATES_LIBRARY.find(t => t.id === heat.secondary?.library_id)?.heating_scop ?? 1) : null
const weighted_scop_inv = primary_pct / primary_scop + (sec_scop != null ? (1 - primary_pct) / sec_scop : 0)
const weighted_scop = weighted_scop_inv > 0 ? 1 / weighted_scop_inv : Infinity

console.log(`State 2 heating demand (annual):         ${annual_demand_mwh.toFixed(2)} MWh`)
console.log(`Theoretical MVHR recovery:               ${theoretical_recovery.toFixed(2)} MWh`)
console.log(`Effective MVHR recovery (per-hour cap):  ${effective_recovery.toFixed(2)} MWh`)
console.log(`= Heating-for-systems demand:            ${heating_for_systems.toFixed(2)} MWh`)
console.log(`  Engine heating.total.delivered:        ${delivered} MWh    Δ ${(delivered - heating_for_systems).toFixed(4)}`)
console.log()
console.log(`Weighted SCOP (${primary_pct*100}% × SCOP ${primary_scop} + ${(1-primary_pct)*100}% × SCOP ${sec_scop ?? '—'}):`)
console.log(`                                         = ${weighted_scop.toFixed(3)}`)
console.log(`Expected fuel = delivered / weighted_scop = ${(heating_for_systems / weighted_scop).toFixed(3)} MWh`)
console.log(`Engine heating.total.fuel_mwh:           ${fuel} MWh`)
console.log()
const fuel_delta = Math.abs(fuel - heating_for_systems / weighted_scop)
if (fuel_delta < 0.05) {
  console.log(`✓ Fuel chain math closes within 0.05 MWh`)
} else {
  console.log(`✗ Fuel chain math diverges by ${fuel_delta.toFixed(3)} MWh`)
}
