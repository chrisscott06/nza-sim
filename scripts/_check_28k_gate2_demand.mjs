/**
 * scripts/_check_28k_gate2_demand.mjs
 *
 * Brief 28k Gate 2 — demand calculation validation.
 * The free-running gate has been removed; demand is now integrated as
 * setpoint-anchored hourly heat balance:
 *   heating_h = max(0, fabric_vent_loss_at_setpoint_h − solar_through_glazing_h)
 *   cooling_h = fabric_vent_cool_gain_h + solar_through_glazing_h
 *
 * Validates Bridgewater envelope-only against the spreadsheet's
 * 08_Heat_Balance envelope-only equivalent.
 *
 * Tolerance: ±10% vs spreadsheet (Chris 2026-05-16).
 * Does NOT touch _calculateState2 or State 3.
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

// Spreadsheet 08_Heat_Balance envelope-only equivalents (MWh)
//   raw_loss             = 258.39    (from 05_Heat_Loss TOTAL)
//   useful_solar_gains   =  49.31    (deducted from heating side)
//   ⇒ heating envelope-only = 258.39 − 49.31 = 209.08 MWh
//   cooling fabric+vent  =   2.72
//   cooling solar (cooling-season fraction) = 63.40
//   ⇒ cooling envelope-only = 66.12 MWh
const TARGET_HEATING_MWH = 209.08
const TARGET_COOLING_MWH =  66.12
const TOLERANCE_PCT = 10.0

// ─── Set up engine inputs ─────────────────────────────────────────────────
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
const epwLat = parseFloat(epwLines[0].split(',')[6])
const hourlySolar = computeHourlySolarByFacade(weatherData, epwLat, bc.orientation ?? 0)
const cb = { lower_c: project.comfort_band_lower_c ?? 21, upper_c: project.comfort_band_upper_c ?? 25 }

const result = calculateInstant(
  bc, cc, {}, libraryData, weatherData, hourlySolar, null,
  { mode: 'envelope-only', comfortBand: cb }
)

const heating_engine = result.demand.heating_demand_mwh
const cooling_engine = result.demand.cooling_demand_mwh
const raw_loss_mwh = result.losses_at_setpoint.totals.total_heating_loss_kwh / 1000
const raw_cool_mwh = result.losses_at_setpoint.totals.total_cooling_gain_kwh / 1000
const glaz = result.losses_at_setpoint.glazing
const solar_trans_mwh = glaz.solar_transmission_kwh / 1000
const solar_beneficial_mwh = glaz.solar_beneficial_heating_kwh   / 1000
const solar_cooling_mwh    = glaz.solar_contributing_cooling_kwh / 1000
const solar_shoulder_mwh   = glaz.solar_shoulder_kwh             / 1000

// Q-conservation invariant: beneficial + cooling + shoulder ≡ solar_transmission
const bucket_sum = solar_beneficial_mwh + solar_cooling_mwh + solar_shoulder_mwh
const bucket_conservation_err_pct = Math.abs(bucket_sum - solar_trans_mwh) / Math.max(solar_trans_mwh, 1e-9) * 100

console.log()
console.log('=== Brief 28k Gate 2 — envelope-only demand vs spreadsheet ===')
console.log()
console.log(`Project: Bridgewater (${PROJECT_ID})  /  Weather: ${bc.weather_file}`)
console.log(`Setpoints: heating ${cb.lower_c} °C, cooling ${cb.upper_c} °C`)
console.log(`Tolerance: ±${TOLERANCE_PCT}% vs spreadsheet 08_Heat_Balance envelope-only`)
console.log()
console.log('Engine breakdown (Gate 1 numbers + Gate 2 demand derivation with option (c) + shoulder bucketing):')
console.log(`  Raw loss at setpoint (all rows, incl. INFO permvent):    ${raw_loss_mwh.toFixed(2)} MWh`)
console.log(`  Raw cool gain at setpoint:                                ${raw_cool_mwh.toFixed(2)} MWh`)
console.log(`  Solar transmission through glazing (annual):              ${solar_trans_mwh.toFixed(2)} MWh`)
console.log()
console.log('Solar bucketing (engine, annual):')
console.log(`  Beneficial heating (offset fabric loss):    ${solar_beneficial_mwh.toFixed(2).padStart(7)} MWh  (${(solar_beneficial_mwh/solar_trans_mwh*100).toFixed(1)}% of total)`)
console.log(`  Contributing cooling (added to load):       ${solar_cooling_mwh.toFixed(2).padStart(7)} MWh  (${(solar_cooling_mwh/solar_trans_mwh*100).toFixed(1)}% of total)`)
console.log(`  Shoulder (no setpoint demand created):      ${solar_shoulder_mwh.toFixed(2).padStart(7)} MWh  (${(solar_shoulder_mwh/solar_trans_mwh*100).toFixed(1)}% of total)`)
console.log(`  Sum of buckets vs solar_transmission_kwh:   Δ ${(bucket_sum - solar_trans_mwh).toFixed(3)} MWh (${bucket_conservation_err_pct.toFixed(4)}%)`)
const conservationOk = bucket_conservation_err_pct < 0.1
console.log(`  Conservation invariant:                     ${conservationOk ? '✓ PASS' : '✗ FAIL'}`)
console.log()
console.log('Per-facade solar three-way split (engine, kWh/yr):')
console.log(`  ${'Facade'.padEnd(12)} ${'Total'.padStart(8)}  ${'Beneficial'.padStart(11)}  ${'Cooling'.padStart(9)}  ${'Shoulder'.padStart(9)}`)
for (const F of ['F1','F2','F3','F4']) {
  const f = glaz.by_face[F]
  console.log(`  ${F.padEnd(12)} ${f.solar_transmission_kwh.toFixed(0).padStart(8)}  ${f.solar_beneficial_heating_kwh.toFixed(0).padStart(11)}  ${f.solar_contributing_cooling_kwh.toFixed(0).padStart(9)}  ${f.solar_shoulder_kwh.toFixed(0).padStart(9)}`)
}
console.log()

// Diagnostic: count shoulder hours by replaying the gate logic outside the engine
// (uses the same Gate 1 outputs to recompute H_weather and C_weather per hour).
// This is purely informational — confirms the gate behaviour without changing
// engine outputs.
{
  // Reload the engine and walk the loop conceptually for shoulder-hour counting.
  // Cheaper: redo just the H/C totals per hour using the same primitives.
  const { wallOpaqueByFace, glazing } = (() => ({
    wallOpaqueByFace: {
      north: bc.length * bc.floor_height * bc.num_floors * (1 - (bc.wwr?.north ?? 0)),
      south: bc.length * bc.floor_height * bc.num_floors * (1 - (bc.wwr?.south ?? 0)),
      east:  bc.width  * bc.floor_height * bc.num_floors * (1 - (bc.wwr?.east  ?? 0)),
      west:  bc.width  * bc.floor_height * bc.num_floors * (1 - (bc.wwr?.west  ?? 0)),
    },
    glazing: {
      north: bc.length * bc.floor_height * bc.num_floors * (bc.wwr?.north ?? 0),
      south: bc.length * bc.floor_height * bc.num_floors * (bc.wwr?.south ?? 0),
      east:  bc.width  * bc.floor_height * bc.num_floors * (bc.wwr?.east  ?? 0),
      west:  bc.width  * bc.floor_height * bc.num_floors * (bc.wwr?.west  ?? 0),
    },
  }))()
  // engine published whole-element Us (from BRUKL via u_value_W_per_m2K)
  const U_wall  = 0.18, U_roof = 0.16, U_glaz = 1.40
  const T_heat = cb.lower_c, T_cool = cb.upper_c
  const ach = bc.infiltration_ach ?? 0.5
  const volume = bc.length * bc.width * bc.num_floors * bc.floor_height
  const UA_leakage = 0.33 * ach * volume
  let heating_hours = 0, cooling_hours = 0, shoulder_hours = 0
  for (let h = 0; h < N; h++) {
    const T_out = temperature[h]
    const dT_heat_out = Math.max(0, T_heat - T_out)
    const dT_cool_out = Math.max(0, T_out - T_cool)
    // Sol-air per facade (alpha=0.6, h_out=25 for walls; alpha=0.7, h_out=25 for roof)
    const Tsa_n = T_out + (0.6 * (hourlySolar.f1[h] ?? 0)) / 25
    const Tsa_e = T_out + (0.6 * (hourlySolar.f2[h] ?? 0)) / 25
    const Tsa_s = T_out + (0.6 * (hourlySolar.f3[h] ?? 0)) / 25
    const Tsa_w = T_out + (0.6 * (hourlySolar.f4[h] ?? 0)) / 25
    const Tsa_roof = T_out + (0.7 * (hourlySolar.roof?.[h] ?? 0)) / 25
    // H_weather: walls + roof + glazing + vent (NO floor)
    const H_weather = U_wall * (wallOpaqueByFace.north * Math.max(0, T_heat - Tsa_n)
                              + wallOpaqueByFace.east  * Math.max(0, T_heat - Tsa_e)
                              + wallOpaqueByFace.south * Math.max(0, T_heat - Tsa_s)
                              + wallOpaqueByFace.west  * Math.max(0, T_heat - Tsa_w))
                   + U_roof * (bc.length * bc.width) * Math.max(0, T_heat - Tsa_roof)
                   + U_glaz * (glazing.north + glazing.east + glazing.south + glazing.west) * dT_heat_out
                   + UA_leakage * dT_heat_out
    const C_weather = U_wall * (wallOpaqueByFace.north * Math.max(0, Tsa_n - T_cool)
                              + wallOpaqueByFace.east  * Math.max(0, Tsa_e - T_cool)
                              + wallOpaqueByFace.south * Math.max(0, Tsa_s - T_cool)
                              + wallOpaqueByFace.west  * Math.max(0, Tsa_w - T_cool))
                   + U_roof * (bc.length * bc.width) * Math.max(0, Tsa_roof - T_cool)
                   + U_glaz * (glazing.north + glazing.east + glazing.south + glazing.west) * dT_cool_out
                   + UA_leakage * dT_cool_out
    if (H_weather > 0) heating_hours++
    else if (C_weather > 0) cooling_hours++
    else shoulder_hours++
  }
  console.log('Hour-count by weather-direction (gate diagnostic — informational, matches engine logic):')
  console.log(`  Heating-direction hours:  ${heating_hours.toString().padStart(4)} / 8760`)
  console.log(`  Cooling-direction hours:  ${cooling_hours.toString().padStart(4)} / 8760`)
  console.log(`  Shoulder hours:           ${shoulder_hours.toString().padStart(4)} / 8760`)
  console.log()
}

function compare(label, engine, target, kind = 'check') {
  const delta = engine - target
  const pct = (delta / target) * 100
  const pass = Math.abs(pct) <= TOLERANCE_PCT
  const verdict = kind === 'info' ? 'INFO' : (pass ? 'PASS' : 'FAIL')
  console.log(
    `  ${label.padEnd(36)}  engine ${engine.toFixed(2).padStart(8)}  hand-calc ${target.toFixed(2).padStart(8)}  Δ ${(delta>=0?'+':'')}${delta.toFixed(2).padStart(7)}  ${pct.toFixed(2).padStart(7)}%   ${verdict}`
  )
  return { label, engine, target, delta, pct, pass, kind, verdict }
}

console.log('Comparison:')
const rows = []
rows.push(compare('Heating demand (envelope-only)', heating_engine, TARGET_HEATING_MWH, 'check'))
rows.push(compare('Cooling demand (envelope-only)', cooling_engine, TARGET_COOLING_MWH, 'check'))
console.log()

// Sanity: expected range 200-260 MWh per Chris
const inRangeHeat = heating_engine >= 200 && heating_engine <= 260
console.log(`Sanity check: heating in Chris's expected 200-260 MWh range?  ${inRangeHeat ? 'YES ✓' : 'NO  ✗'}  (engine ${heating_engine.toFixed(1)} MWh)`)
const coolSmall = cooling_engine <= 30   // "small" qualitative threshold
console.log(`Sanity check: cooling 'small' (≤30 MWh, UK envelope-only)?    ${coolSmall ? 'YES ✓' : 'NO  ✗'}  (engine ${cooling_engine.toFixed(1)} MWh)`)
console.log()

const fails = rows.filter(r => r.kind === 'check' && !r.pass)
if (fails.length === 0) {
  console.log(`✓ Gate 2 PASSES — both checked rows within ±${TOLERANCE_PCT}% of spreadsheet`)
} else {
  console.log(`✗ Gate 2 FAILS — ${fails.length} row(s) outside ±${TOLERANCE_PCT}%`)
  for (const r of fails) console.log(`  • ${r.label}: ${r.pct >= 0 ? '+' : ''}${r.pct.toFixed(2)}%`)
}
console.log()
console.log('EP Ideal Loads comparison: not run this pass (would require regenerating Bridgewater epJSON with envelope-only + Ideal Loads at 21/25 setpoints). Documented as pending per brief.')
console.log()
console.log('HALT per Brief 28k Gate 2. _calculateState2 and State 3 untouched.')
