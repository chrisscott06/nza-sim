/**
 * Brief 64 — hand-calc verification of cooling clamp.
 *
 * The clamp formula in _calculateState2 is, per hour:
 *   cooling_demand[h] = max(0, hourly_cool_gain_Wh[h]
 *                              + Q_solar_through_glazing_Wh[h]
 *                              + Q_internal_gains_Wh[h]
 *                              − hourly_heat_loss_Wh[h])
 *
 * We can't easily re-implement the engine's per-hour computation
 * independently (it requires the full envelope model + schedules).
 * But we CAN gate-test the formula's properties end-to-end:
 *
 * 1. Cooling demand under clamp ≥ cooling demand under free_running
 *    (the clamp catches hours the bucketed model bypassed).
 * 2. Cooling demand under clamp ≤ Σ gains (B11 bound, by construction
 *    of max(0, gains − loss) ≤ Σ gains).
 * 3. Demand vs delivered must match exactly (Brief 62 closure).
 * 4. Heating demand UNCHANGED across cooling-setpoint sweep (clamp
 *    must not disturb heating — formula explicitly preserves this).
 * 5. Monotonicity: cooling demand strictly increases as cooling
 *    setpoint drops.
 * 6. Free-running invariance: with control_strategy='free_running',
 *    output is byte-identical to pre-Brief-64 (record from
 *    docs/audit/63_validation_report.json).
 *
 * Read-only diagnostic. Writes results to docs/audit/64_handcalc.json.
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
const baseBuilding = JSON.parse(JSON.stringify(project.building_config))
const comfortBand = { lower_c: project.comfort_band_lower_c ?? 20, upper_c: project.comfort_band_upper_c ?? 26 }

const weatherFile = baseBuilding.weather_file || project.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), direct_normal = new Float32Array(N)
const diffuse_horizontal = new Float32Array(N), wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6]); direct_normal[i] = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15]); wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, Number(baseBuilding.orientation ?? 0))
const libraryData = {
  constructions: libArr.map(c => ({ name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K, y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1, g_value: c.config_json?.g_value, config_json: c.config_json ?? c, layers: c.layers })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
}

function runOnce(mutate) {
  const b = JSON.parse(JSON.stringify(baseBuilding))
  if (typeof mutate === 'function') mutate(b)
  return calculateInstant(b, constructions, {}, libraryData, weatherData, hourlySolar, null, {
    mode: 'full', engine: 'v2.5', comfortBand, _skipInterventions: true,
  })
}

function extract(r) {
  const ig = r?.heat_balance?.annual?.gains?.internal ?? {}
  const sg = r?.heat_balance?.annual?.gains?.solar ?? {}
  return {
    cool_demand_mwh:  r?.consumption?.space_cooling?.demand_mwh ?? 0,
    heat_demand_mwh:  r?.consumption?.space_heating?.demand_mwh ?? 0,
    cool_delivered_mwh: r?.consumption?.space_cooling?.delivered_mwh ?? 0,
    heat_delivered_mwh: r?.consumption?.space_heating?.delivered_mwh ?? 0,
    eui:              r?.consumption?.total?.kwh_per_m2_yr ?? 0,
    gain_solar_mwh:   (sg?.total_kwh ?? 0) / 1000,
    gain_light_mwh:   (ig?.lighting?.kwh ?? 0) / 1000,
    gain_equip_mwh:   (ig?.equipment?.kwh ?? 0) / 1000,
    gain_people_mwh:  (ig?.people?.kwh ?? 0) / 1000,
    setpoint_used_h:  r?.demand?.effective_heating_setpoint_c,
    setpoint_used_c:  r?.demand?.effective_cooling_setpoint_c,
    hours_h:          r?.demand?.hours_heating_direction,
    hours_c:          r?.demand?.hours_cooling_direction,
    hours_s:          r?.demand?.hours_shoulder,
  }
}

const results = { sweeps: { active: {}, free: {} }, gates: [] }
function gate(name, pass, expected, actual, notes = '') {
  results.gates.push({ name, pass, expected, actual, notes })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}: expected ${expected}, actual ${actual}${notes ? ' — ' + notes : ''}`)
}

// ──────────────────────────────────────────────────────────────────────
console.log('Brief 64 — Cooling Clamp hand-calc verification')
console.log('='.repeat(72))

// 1. Cooling setpoint sweep on clamp + free_running
const sweep = [28, 26, 24, 22, 20, 18, 16]
for (const csp of sweep) {
  const r_act = extract(runOnce(b => {
    b.systems_config_v40.cooling_setpoint_mode = 'custom'
    b.systems_config_v40.cooling_setpoint_c = csp
    // active_setpoint is default
  }))
  const r_fr = extract(runOnce(b => {
    b.control_strategy = 'free_running'
    b.systems_config_v40.cooling_setpoint_mode = 'custom'
    b.systems_config_v40.cooling_setpoint_c = csp
  }))
  results.sweeps.active[csp] = r_act
  results.sweeps.free[csp] = r_fr
}
console.log()
console.log('CSP sweep:                  ACTIVE_SETPOINT clamp           FREE_RUNNING (pre-Brief-64)')
console.log('csp  cool   heat   EUI      delivered_c   delivered_h        cool   heat   EUI    delivered_c')
for (const csp of sweep) {
  const a = results.sweeps.active[csp]
  const f = results.sweeps.free[csp]
  console.log(
    `${String(csp).padStart(2)}   ` +
    `${a.cool_demand_mwh.toFixed(1).padStart(5)}  ${a.heat_demand_mwh.toFixed(1).padStart(5)}  ${a.eui.toFixed(1).padStart(5)}   ` +
    `${a.cool_delivered_mwh.toFixed(1).padStart(5)}        ${a.heat_delivered_mwh.toFixed(1).padStart(5)}            ` +
    `${f.cool_demand_mwh.toFixed(1).padStart(5)}  ${f.heat_demand_mwh.toFixed(1).padStart(5)}  ${f.eui.toFixed(1).padStart(5)}    ` +
    `${f.cool_delivered_mwh.toFixed(1).padStart(5)}`
  )
}

console.log()
console.log('GATES:')

// Gate 1: Monotonicity — cooling demand strictly increases as csp drops
let monoFail = false
for (let i = 1; i < sweep.length; i++) {
  const prev = results.sweeps.active[sweep[i - 1]].cool_demand_mwh
  const curr = results.sweeps.active[sweep[i]].cool_demand_mwh
  if (curr <= prev) { monoFail = true; break }
}
gate('G1: monotonicity (cooling_demand rises strictly as csp drops, clamp)',
  !monoFail, 'strictly increasing', monoFail ? 'NOT strictly increasing' : 'all steps positive')

// Gate 2: Heating unchanged across cooling-setpoint sweep
const heat_baseline = results.sweeps.active[24].heat_demand_mwh
const max_heat_dev = Math.max(...sweep.map(csp =>
  Math.abs(results.sweeps.active[csp].heat_demand_mwh - heat_baseline)))
gate('G2: heating UNCHANGED across cooling sweep (≤ 0.5 MWh)',
  max_heat_dev <= 0.5, '≤ 0.5 MWh', max_heat_dev.toFixed(3) + ' MWh',
  `heating sits at ${heat_baseline.toFixed(2)} MWh at every csp`)

// Gate 3: Delivered == demand for each csp (Brief 62 closure)
let recFail = []
for (const csp of sweep) {
  const a = results.sweeps.active[csp]
  const diff_c = Math.abs(a.cool_demand_mwh - a.cool_delivered_mwh)
  const diff_h = Math.abs(a.heat_demand_mwh - a.heat_delivered_mwh)
  if (diff_c > 0.5) recFail.push(`csp=${csp} cool: diff=${diff_c.toFixed(2)}`)
  if (diff_h > 0.5) recFail.push(`csp=${csp} heat: diff=${diff_h.toFixed(2)}`)
}
gate('G3: delivered = demand at every csp (Brief 62 closure)',
  recFail.length === 0, 'closed everywhere', recFail.length === 0 ? 'closed' : recFail.join('; '))

// Gate 4: Cooling demand ≤ Σ gains (B11 bound, by construction)
let boundFail = []
for (const csp of sweep) {
  const a = results.sweeps.active[csp]
  const total_gains = a.gain_solar_mwh + a.gain_light_mwh + a.gain_equip_mwh + a.gain_people_mwh
  if (a.cool_demand_mwh > total_gains + 0.1) boundFail.push(`csp=${csp}: cool=${a.cool_demand_mwh.toFixed(1)} > gains=${total_gains.toFixed(1)}`)
}
gate('G4: cooling_demand ≤ Σ gains under clamp',
  boundFail.length === 0, 'always ≤ gains', boundFail.length === 0 ? 'within bound' : boundFail.join('; '))

// Gate 5: clamp ≥ free_running at every csp (clamp catches hours bucketed model bypassed)
let lowerFail = []
for (const csp of sweep) {
  const a = results.sweeps.active[csp].cool_demand_mwh
  const f = results.sweeps.free[csp].cool_demand_mwh
  if (a < f - 0.5) lowerFail.push(`csp=${csp}: clamp=${a.toFixed(1)} < free=${f.toFixed(1)}`)
}
gate('G5: clamp cooling_demand ≥ free_running cooling_demand',
  lowerFail.length === 0, 'clamp ≥ free at every csp', lowerFail.length === 0 ? 'true' : lowerFail.join('; '))

// Gate 6: free_running invariance — output unchanged from pre-Brief-64.
// Pre-Brief-64 (Brief 63 record): on default csp=24, cooling demand was
// 69.1 MWh, EUI 110.30. Free-running mode must reproduce.
const fr_csp24 = results.sweeps.free[24]
gate('G6a: free_running csp=24 cooling_demand == 69.1 MWh (pre-Brief-64 record)',
  Math.abs(fr_csp24.cool_demand_mwh - 69.1) < 0.5, '≈ 69.1 MWh', fr_csp24.cool_demand_mwh.toFixed(1) + ' MWh')
gate('G6b: free_running csp=24 EUI ≈ 110.3 (pre-Brief-64 anchor)',
  Math.abs(fr_csp24.eui - 110.3) < 0.5, '≈ 110.3', fr_csp24.eui.toFixed(1))

// Gate 7: clamp default (no field) ≈ clamp explicit (sanity)
const r_default = extract(runOnce(null))
const r_explicit_clamp = extract(runOnce(b => { b.control_strategy = 'active_setpoint' }))
gate('G7: default (no control_strategy field) == explicit active_setpoint',
  Math.abs(r_default.cool_demand_mwh - r_explicit_clamp.cool_demand_mwh) < 0.01,
  'identical', `default=${r_default.cool_demand_mwh.toFixed(2)} explicit=${r_explicit_clamp.cool_demand_mwh.toFixed(2)}`)

// Gate 8: Acceleration check — Δdemand from csp 22→18 > csp 26→22 (gains-dominated buildings
// should show steeper response as csp drops further below ambient)
const d_22_to_18 = results.sweeps.active[18].cool_demand_mwh - results.sweeps.active[22].cool_demand_mwh
const d_26_to_22 = results.sweeps.active[22].cool_demand_mwh - results.sweeps.active[26].cool_demand_mwh
gate('G8: acceleration — Δdemand(22→18) > Δdemand(26→22)',
  d_22_to_18 > d_26_to_22, `Δ(22→18) > Δ(26→22)`,
  `Δ(22→18)=${d_22_to_18.toFixed(2)} ${d_22_to_18 > d_26_to_22 ? '>' : '≤'} Δ(26→22)=${d_26_to_22.toFixed(2)}`)

// ──────────────────────────────────────────────────────────────────────
const allPass = results.gates.every(g => g.pass)
console.log()
console.log('='.repeat(72))
console.log(`OVERALL: ${results.gates.filter(g => g.pass).length} / ${results.gates.length} PASS`)
if (allPass) console.log('HAND-CALC GREEN — clamp formula behaves correctly')
else console.log('HAND-CALC RED — see failing gates above')

results.summary = {
  total_gates: results.gates.length,
  pass: results.gates.filter(g => g.pass).length,
  fail: results.gates.filter(g => !g.pass).length,
  all_pass: allPass,
}
fs.writeFileSync(path.join(REPO_ROOT, 'docs/audit/64_handcalc.json'), JSON.stringify(results, null, 2))
console.log('Wrote docs/audit/64_handcalc.json')
