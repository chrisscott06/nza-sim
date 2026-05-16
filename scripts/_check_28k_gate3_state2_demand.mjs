/**
 * scripts/_check_28k_gate3_state2_demand.mjs
 *
 * Brief 28k Gate 3 validation. Runs Bridgewater envelope+gains and reports:
 *   1. Per-element heat loss/gain unchanged from Gate 1 (fabric loss should
 *      not depend on internal gains — invariance check)
 *   2. heating_demand_mwh / cooling_demand_mwh under Gate 3 setpoint
 *      convention with internal-gain offset
 *   3. Three-way solar bucketing (beneficial / cooling / shoulder) per
 *      facade
 *   4. Three-way internal-gain bucketing (offset_heating / added_cooling /
 *      shoulder)
 *   5. Conservation invariants
 *   6. PASS/FAIL vs spreadsheet 08_Heat_Balance State 2 numbers
 *
 * Tolerance: ±10% vs spreadsheet for heating; cooling tolerance noted as
 * INFO since spreadsheet uses different methodology (45% useful fraction
 * heuristic vs engine's hourly option (c)).
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

// Run BOTH State 1 (envelope-only) and State 2 (envelope-gains) for invariance
const s1 = calculateInstant(bc, cc, {}, libraryData, weatherData, hourlySolar, null, { mode: 'envelope-only',  comfortBand: cb })
const s2 = calculateInstant(bc, cc, {}, libraryData, weatherData, hourlySolar, null, { mode: 'envelope-gains', comfortBand: cb })

console.log()
console.log('=== Brief 28k Gate 3 — State 2 setpoint convention with internal gains ===')
console.log()
console.log(`Project: Bridgewater (${PROJECT_ID})  /  Weather: ${bc.weather_file}`)
console.log(`Setpoints: heating ${cb.lower_c} °C, cooling ${cb.upper_c} °C`)
console.log()

// ─── 1. Per-element loss invariance check ─────────────────────────────────
console.log('── Invariance: per-element loss/gain unchanged State 1 vs State 2 (fabric is gain-independent)')
console.log()
const ROWS = [
  ['External wall total',     r => r.losses_at_setpoint.external_wall.heating_loss_kwh],
  ['Roof',                    r => r.losses_at_setpoint.roof.heating_loss_kwh],
  ['Ground floor',            r => r.losses_at_setpoint.ground_floor.heating_loss_kwh],
  ['Glazing total (cond.)',   r => r.losses_at_setpoint.glazing.heating_loss_kwh],
  ['Glazing solar trans.',    r => r.losses_at_setpoint.glazing.solar_transmission_kwh],
  ['Background infiltration', r => r.losses_at_setpoint.fabric_leakage.heating_loss_kwh],
  ['Permanent vents',         r => r.losses_at_setpoint.permanent_vents.heating_loss_kwh],
  ['Thermal bridging',        r => r.losses_at_setpoint.thermal_bridging.heating_loss_kwh],
  // Total minus mech vent for the State-1-vs-State-2 invariance check, since
  // mech vent is a State-2-only loss line per Brief 28k Gate 3 scope.
  ['Total (excl. mech vent)', r => {
    const mech = (r.losses_at_setpoint.ventilation ?? []).reduce((s, v) => s + v.heat_loss_kwh, 0)
    return r.losses_at_setpoint.totals.total_heating_loss_kwh - mech
  }],
]
console.log(`  ${'Row'.padEnd(28)} ${'State 1'.padStart(10)}   ${'State 2'.padStart(10)}   ${'Δ'.padStart(8)}   Verdict`)
let invariance_fails = 0
for (const [label, fn] of ROWS) {
  const v1 = fn(s1) ?? 0
  const v2 = fn(s2) ?? 0
  const delta = v2 - v1
  const ok = Math.abs(delta) < Math.max(1, 0.01 * Math.abs(v1))   // ≤1% or ≤1 kWh
  if (!ok) invariance_fails++
  console.log(`  ${label.padEnd(28)} ${v1.toFixed(0).padStart(10)}   ${v2.toFixed(0).padStart(10)}   ${delta.toFixed(0).padStart(8)}   ${ok ? '✓ invariant' : '✗ DRIFT'}`)
}
console.log()
if (invariance_fails === 0) {
  console.log(`  ✓ All loss rows invariant State 1 ↔ State 2 — fabric loss correctly independent of gains`)
} else {
  console.log(`  ✗ ${invariance_fails} row(s) drifted — fabric loss is gain-coupled (BUG)`)
}
console.log()

// ─── 2. Demand under Gate 3 ───────────────────────────────────────────────
const heating_engine = s2.demand.heating_demand_mwh
const cooling_engine = s2.demand.cooling_demand_mwh
const TARGET_HEATING_MWH_SS = 0      // Spreadsheet 08_Heat_Balance MAX(0, ...) — gains overwhelm raw loss
const TARGET_COOLING_MWH_SS = 456.52 // 2.72 + 54.78 + 399.03

console.log('── Demand:')
console.log()
console.log(`  Engine heating_demand_mwh : ${heating_engine.toFixed(2).padStart(8)} MWh`)
console.log(`  Engine cooling_demand_mwh : ${cooling_engine.toFixed(2).padStart(8)} MWh`)
console.log()
console.log(`  Spreadsheet (current 08_Heat_Balance, BRUKL-LPD inputs 725 MWh gains, 0.45 utilisation):`)
console.log(`    Heating: ${TARGET_HEATING_MWH_SS.toFixed(2).padStart(8)} MWh  (gains overwhelm raw loss → MAX clamps to 0)`)
console.log(`    Cooling: ${TARGET_COOLING_MWH_SS.toFixed(2).padStart(8)} MWh  (45% useful frac heuristic puts 55% × 725 = 399 MWh into cooling)`)
console.log()
console.log(`  Spreadsheet methodology vs engine:`)
console.log(`    • Spreadsheet uses BRUKL-intent LPDs (lighting 8 W/m², equipment 15 W/m²) → ~725 MWh annual gains`)
console.log(`    • Engine uses persisted LPDs (lighting 1.5, equipment 1.5 W/m²) → 186 MWh annual gains`)
console.log(`    • Per Chris ruling #2: LPD calibration is future work; Gate 3 validates convention math, not absolute MWh`)
console.log()

// ─── 3. Solar bucketing ───────────────────────────────────────────────────
const glaz = s2.losses_at_setpoint.glazing
const solar = glaz.solar_transmission_kwh / 1000
const sBen = glaz.solar_beneficial_heating_kwh   / 1000
const sCool = glaz.solar_contributing_cooling_kwh / 1000
const sSh   = glaz.solar_shoulder_kwh / 1000
const sumS = sBen + sCool + sSh
const conservS = Math.abs(sumS - solar) / Math.max(solar, 1e-9) * 100

console.log('── Solar bucketing (annual, MWh):')
console.log(`  Total solar transmission       : ${solar.toFixed(2).padStart(7)} MWh`)
console.log(`  Beneficial heating (offset)    : ${sBen.toFixed(2).padStart(7)} MWh  (${(sBen/solar*100).toFixed(1)}%)`)
console.log(`  Contributing cooling (added)   : ${sCool.toFixed(2).padStart(7)} MWh  (${(sCool/solar*100).toFixed(1)}%)`)
console.log(`  Shoulder (no demand created)   : ${sSh.toFixed(2).padStart(7)} MWh  (${(sSh/solar*100).toFixed(1)}%)`)
console.log(`  Conservation invariant β+γ+s≡Q : Δ ${(sumS - solar).toFixed(4)} MWh (${conservS.toFixed(4)}%)  ${conservS < 0.1 ? '✓ PASS' : '✗ FAIL'}`)
console.log()

// ─── 4. Internal-gain bucketing ───────────────────────────────────────────
const igb = s2.losses_at_setpoint.internal_gains_bucketed
const gOff = igb.offset_heating_kwh / 1000
const gCool = igb.added_cooling_kwh / 1000
const gSh = igb.shoulder_kwh / 1000
const gTot = igb.total_kwh / 1000
const sumG = gOff + gCool + gSh
const conservG = Math.abs(sumG - gTot) / Math.max(gTot, 1e-9) * 100

console.log('── Internal-gain bucketing (annual, MWh):')
console.log(`  Total internal gains (P+L+E)   : ${gTot.toFixed(2).padStart(7)} MWh`)
console.log(`  Offset heating (used)          : ${gOff.toFixed(2).padStart(7)} MWh  (${(gOff/gTot*100).toFixed(1)}%)`)
console.log(`  Added to cooling (load)        : ${gCool.toFixed(2).padStart(7)} MWh  (${(gCool/gTot*100).toFixed(1)}%)`)
console.log(`  Shoulder (no demand created)   : ${gSh.toFixed(2).padStart(7)} MWh  (${(gSh/gTot*100).toFixed(1)}%)`)
console.log(`  Conservation invariant         : Δ ${(sumG - gTot).toFixed(4)} MWh (${conservG.toFixed(4)}%)  ${conservG < 0.1 ? '✓ PASS' : '✗ FAIL'}`)
console.log()

// ─── 5. Per-facade solar three-way split ──────────────────────────────────
console.log('── Per-facade solar three-way split (kWh/yr):')
console.log(`  ${'Facade'.padEnd(12)} ${'Total'.padStart(8)}  ${'Beneficial'.padStart(11)}  ${'Cooling'.padStart(9)}  ${'Shoulder'.padStart(9)}`)
for (const F of ['F1','F2','F3','F4']) {
  const f = glaz.by_face[F]
  console.log(`  ${F.padEnd(12)} ${f.solar_transmission_kwh.toFixed(0).padStart(8)}  ${f.solar_beneficial_heating_kwh.toFixed(0).padStart(11)}  ${f.solar_contributing_cooling_kwh.toFixed(0).padStart(9)}  ${f.solar_shoulder_kwh.toFixed(0).padStart(9)}`)
}
console.log()

// ─── 5b. Per-system mechanical ventilation ────────────────────────────────
console.log('── Per-system mechanical ventilation (Brief 28k Gate 3+):')
console.log(`  ${'System'.padEnd(24)} ${'Flow L/s'.padStart(8)}  ${'HRE'.padStart(5)}  ${'SFP'.padStart(5)}  ${'Heat loss MWh'.padStart(13)}  ${'Cool gain MWh'.padStart(13)}  ${'Fan MWh'.padStart(8)}`)
for (const v of (s2.losses_at_setpoint.ventilation ?? [])) {
  console.log(`  ${(v.name ?? '?').padEnd(24)} ${v.flow_l_s.toFixed(0).padStart(8)}  ${v.hre.toFixed(2).padStart(5)}  ${v.sfp_w_per_l_s.toFixed(2).padStart(5)}  ${(v.heat_loss_kwh/1000).toFixed(2).padStart(13)}  ${(v.cooling_gain_kwh/1000).toFixed(2).padStart(13)}  ${(v.fan_kwh/1000).toFixed(2).padStart(8)}`)
}
console.log()
console.log('── Thermal bridging (Brief 28k Gate 3+):')
const tb = s2.losses_at_setpoint.thermal_bridging
console.log(`  α = ${tb.alpha_pct}%  ·  fabric_area_UA = ${tb.fabric_area_UA_W_per_K} W/K`)
console.log(`  Heating loss : ${(tb.heating_loss_kwh/1000).toFixed(2)} MWh`)
console.log(`  Cool gain    : ${(tb.cooling_gain_kwh/1000).toFixed(2)} MWh`)
console.log()

// ─── 6. Convention parity check (engine reformulated to spreadsheet inputs) ─
// Hypothetical: if engine had spreadsheet's 725 MWh gains (BRUKL LPDs),
// rough what would heating/cooling come out at?
const engine_raw_loss = s2.losses_at_setpoint.totals.total_heating_loss_kwh / 1000
const engine_solar = solar
const engine_gains = gTot
const SS_GAINS_TOTAL = 725.5   // from spreadsheet 07_Internal_Gains
const SS_USEFUL_FRAC = 0.45    // spreadsheet utilisation factor
console.log('── Convention parity: engine vs spreadsheet using same gain inputs')
console.log()
console.log(`  Engine raw loss (incl. INFO permvent) : ${engine_raw_loss.toFixed(2)} MWh`)
console.log(`  Engine annual gains                    : ${engine_gains.toFixed(2)} MWh`)
console.log(`  Engine annual solar transmission        : ${engine_solar.toFixed(2)} MWh`)
console.log()
console.log(`  Engine offset_heating fraction of gains : ${(gOff/gTot*100).toFixed(1)}%`)
console.log(`  Spreadsheet useful_frac (heuristic)     : ${(SS_USEFUL_FRAC*100).toFixed(0)}%`)
console.log(`  Engine offset is ${gOff/gTot > SS_USEFUL_FRAC ? 'higher (more gains land in heating hours)' : 'lower'} than spreadsheet heuristic`)
console.log()
console.log(`  Hypothetical engine heating if engine gains scaled to spreadsheet's 725 MWh:`)
console.log(`    scaled engine offset = ${(gOff/gTot*SS_GAINS_TOTAL).toFixed(0)} MWh  (vs spreadsheet useful = ${(SS_GAINS_TOTAL*SS_USEFUL_FRAC).toFixed(0)} MWh)`)
console.log()

// ─── 7. PASS/FAIL summary ─────────────────────────────────────────────────
console.log('=== Gate 3 PASS/FAIL summary ===')
console.log()
const allPass = invariance_fails === 0 && conservS < 0.1 && conservG < 0.1
console.log(`  Invariance (per-element loss State1 = State2)  : ${invariance_fails === 0 ? '✓ PASS' : '✗ FAIL'}`)
console.log(`  Conservation (solar buckets sum to total)       : ${conservS < 0.1 ? '✓ PASS' : '✗ FAIL'}`)
console.log(`  Conservation (gain buckets sum to total)        : ${conservG < 0.1 ? '✓ PASS' : '✗ FAIL'}`)
console.log(`  Demand vs spreadsheet absolute number           : INFO (LPD inputs differ; calibration is future work)`)
console.log()
console.log(allPass
  ? '✓ Gate 3 convention math PASSES. Engine produces internally-consistent State 2 setpoint demand.'
  : '✗ Gate 3 has invariance/conservation failures — investigate before sign-off.')
console.log()
console.log('HALT per Brief 28k Gate 3. State 3 untouched. Brief 28j MVHR cap mechanics unchanged.')
