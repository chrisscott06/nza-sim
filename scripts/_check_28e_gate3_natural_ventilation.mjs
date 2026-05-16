/**
 * scripts/_check_28e_gate3_natural_ventilation.mjs
 *
 * Brief 28e Gate E3 validation: independent hand-calc of operable-opening
 * natural ventilation heat loss against the Static engine output. Verifies
 * the Brief 28e §A.2 wind+stack physics is correctly implemented.
 *
 * Two hand-calc variants:
 *   (a) Design constant: assume T_zone = 21°C (heating setpoint) for every
 *       open hour. Independent of any engine T_op trace. This is the
 *       "physical reasonability" check — what would the door lose if the
 *       building were always at design heating temperature when the door is
 *       open. Expected to be within ~10% of either engine state.
 *
 *   (b) Engine-T_op-trace replay: read the engine's per-hour T_op trace
 *       (from result.free_running.hourly_temperature_c) and use it as the
 *       T_zone reference. Same inputs, same formula → must match engine
 *       output within rounding (proves the engine's integration is correct
 *       code-path independently of how it was coded).
 *
 * Both use:
 *   - Same Yeovilton TMYx EPW (T_out, v_wind per hour)
 *   - Same opening config (gf_entrance_door from Bridgewater state)
 *   - Same schedule resolver from frontend/src/utils/scheduleLibrary.js
 *     (already separately tested; importing it is fine)
 *   - Brief 28e §A.2 formula re-implemented inline (NOT importing from
 *     instantCalc.js — that's the engine code we're validating)
 *
 * Tolerance per Chris's Gate E3 spec: ±5% on variant (b) is strict (must
 * match engine exactly within rounding). Variant (a) is informational —
 * documents the design-condition number for the spreadsheet.
 *
 * Also confirms Brief 28k Gate 1-3 regression: per-element fabric losses
 * unchanged after Brief 28e additions.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'
import { resolveScheduleAtHour } from '../frontend/src/utils/scheduleLibrary.js'

const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

// Brief 28e §A.2 constants (re-declared here, NOT imported from engine, to
// keep the hand-calc independent of engine code).
const AIR_RHO = 1.2          // kg/m³
const AIR_CP  = 1005         // J/(kg·K)
const GRAVITY = 9.81         // m/s²

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json() }

// ─── Inputs ───────────────────────────────────────────────────────────────────
const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const lib = await fj(`${API}/api/library/constructions`)
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
const openings = bc.operable_openings ?? []
if (openings.length === 0) {
  console.error('No operable_openings in Bridgewater state — re-run seed first.')
  process.exit(2)
}

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
const cb = { lower_c: project.comfort_band_lower_c ?? 21, upper_c: project.comfort_band_upper_c ?? 25 }

// ─── Hand-calc function ──────────────────────────────────────────────────────
function handCalcOpeningHeatLoss(opening, T_zone_provider) {
  const Cd = Number(opening.discharge_coefficient ?? 0.6)
  const A  = Number(opening.area_m2 ?? 0)
  const Cw = Number(opening.wind_coefficient ?? 0.25)
  const H  = Number(opening.height_m ?? 1.0)
  const T_heat = cb.lower_c
  const T_cool = cb.upper_c
  const mode = opening.control?.mode ?? 'permanent'
  const sched_ref = opening.control?.schedule_ref ?? null

  let heat_loss_Wh = 0
  let cool_gain_Wh = 0
  let open_hours = 0
  let flow_sum_m3s = 0
  let dT_sum_K = 0

  for (let h = 0; h < N; h++) {
    let is_open = false
    if (mode === 'permanent') {
      is_open = true
    } else if (mode === 'scheduled' && sched_ref) {
      const frac = resolveScheduleAtHour(sched_ref, h, weatherData)
      is_open = frac > 0.5
    }
    // temperature mode: hand-calc treats it as 'open whenever T_zone > threshold'
    // with no hysteresis (sticky-state would require engine T_op trace). For
    // Bridgewater (scheduled mode), this branch isn't exercised.
    else if (mode === 'temperature') {
      const T_zone = T_zone_provider(h)
      const threshold = Number(opening.control.open_above_zone_c ?? 22.0)
      is_open = T_zone > threshold
      if (opening.control.require_outside_cooler && !(temperature[h] < T_zone)) is_open = false
    }
    if (!is_open) continue

    const T_zone = T_zone_provider(h)
    const T_out = temperature[h]
    const v_wind = wind_speed[h] || 0
    const dT_abs = Math.abs(T_zone - T_out)
    const T_avg_K = 0.5 * (T_zone + T_out) + 273.15
    const Q_wind  = Cd * A * Math.sqrt(Cw * v_wind * v_wind)
    const Q_stack = Cd * A * Math.sqrt(Math.max(0, 2 * GRAVITY * H * dT_abs / Math.max(T_avg_K, 1)))
    const Q_open  = Math.sqrt(Q_wind * Q_wind + Q_stack * Q_stack)   // m³/s
    const UA_open = AIR_RHO * AIR_CP * Q_open                         // W/K

    heat_loss_Wh += UA_open * Math.max(0, T_heat - T_out)
    cool_gain_Wh += UA_open * Math.max(0, T_out - T_cool)
    open_hours += 1
    flow_sum_m3s += Q_open
    dT_sum_K += dT_abs
  }

  return {
    heat_loss_kwh:          Math.round(heat_loss_Wh / 1000 * 10) / 10,
    cooling_gain_kwh:       Math.round(cool_gain_Wh / 1000 * 10) / 10,
    open_hours,
    avg_flow_when_open_l_s: open_hours > 0 ? Math.round(flow_sum_m3s * 1000 / open_hours) : 0,
    avg_dT_when_open_k:     open_hours > 0 ? Math.round(dT_sum_K / open_hours * 10) / 10 : 0,
  }
}

// ─── Run engine ──────────────────────────────────────────────────────────────
const s1 = calculateInstant(bc, cc, {}, libraryData, weatherData, hourlySolar, null,
                            { mode: 'envelope-only',  comfortBand: cb })
const s2 = calculateInstant(bc, cc, {}, libraryData, weatherData, hourlySolar, null,
                            { mode: 'envelope-gains', comfortBand: cb })

const door = openings[0]   // Bridgewater has exactly one: gf_entrance_door

// Variant (a): design constant T_zone = 21°C
const hand_a = handCalcOpeningHeatLoss(door, () => cb.lower_c)

// Variant (b): replay engine T_op trace from State 1
const s1_trace = s1.free_running?.hourly_temperature_c
const s2_trace = s2.free_running?.hourly_temperature_c
let hand_b_s1 = null, hand_b_s2 = null
if (s1_trace && s1_trace.length === N) {
  // Engine uses T_op_prev (previous hour's value); replay must do the same.
  hand_b_s1 = handCalcOpeningHeatLoss(door, (h) => h === 0 ? cb.lower_c : s1_trace[h - 1])
}
if (s2_trace && s2_trace.length === N) {
  hand_b_s2 = handCalcOpeningHeatLoss(door, (h) => h === 0 ? cb.lower_c : s2_trace[h - 1])
}

// Engine outputs
const eng_s1 = s1.losses_at_setpoint?.natural_ventilation?.find(o => o.id === door.id)
const eng_s2 = s2.losses_at_setpoint?.natural_ventilation?.find(o => o.id === door.id)

// ─── Brief 28k regression check ──────────────────────────────────────────────
const BRIEF28K_BASELINES = {
  external_wall:    17966,
  roof:              9174,
  ground_floor:      9589,
  glazing:          77319,
  fabric_leakage:   90617,
  permanent_vents: 120782,
  thermal_bridging:237813,
}

console.log()
console.log('=== Brief 28e Gate E3 — natural ventilation hand-calc validation ===')
console.log()
console.log(`Opening under test : ${door.id} (${door.name})`)
console.log(`  facade           : ${door.facade}`)
console.log(`  area_m2          : ${door.area_m2}`)
console.log(`  height_m         : ${door.height_m}`)
console.log(`  Cd               : ${door.discharge_coefficient}`)
console.log(`  Cw               : ${door.wind_coefficient}`)
console.log(`  control          : ${door.control?.mode}, schedule_ref=${door.control?.schedule_ref ?? '(none)'}`)
console.log(`  Weather          : ${bc.weather_file}`)
console.log(`  Setpoints        : heating ${cb.lower_c} °C, cooling ${cb.upper_c} °C`)
console.log()

function pct(a, b) { return b === 0 ? 0 : (a - b) / b * 100 }

console.log('── Engine output (from losses_at_setpoint.natural_ventilation[]) ──')
console.log(`  State 1 (envelope-only)  : heat_loss ${eng_s1.heat_loss_kwh.toFixed(1)} kWh, cool_gain ${eng_s1.cooling_gain_kwh.toFixed(1)} kWh, open_hours ${eng_s1.open_hours}, avg_flow ${eng_s1.avg_flow_when_open_l_s} L/s, avg_dT ${eng_s1.avg_dT_when_open_k} K`)
console.log(`  State 2 (envelope+gains) : heat_loss ${eng_s2.heat_loss_kwh.toFixed(1)} kWh, cool_gain ${eng_s2.cooling_gain_kwh.toFixed(1)} kWh, open_hours ${eng_s2.open_hours}, avg_flow ${eng_s2.avg_flow_when_open_l_s} L/s, avg_dT ${eng_s2.avg_dT_when_open_k} K`)
console.log()

console.log('── Hand-calc variant (a): design constant T_zone = 21 °C ──')
console.log(`  heat_loss   : ${hand_a.heat_loss_kwh.toFixed(1)} kWh   (Δ vs State 1 engine: ${pct(hand_a.heat_loss_kwh, eng_s1.heat_loss_kwh).toFixed(2)}%, Δ vs State 2 engine: ${pct(hand_a.heat_loss_kwh, eng_s2.heat_loss_kwh).toFixed(2)}%)`)
console.log(`  cool_gain   : ${hand_a.cooling_gain_kwh.toFixed(1)} kWh`)
console.log(`  open_hours  : ${hand_a.open_hours}   (should match engine: ${eng_s1.open_hours})`)
console.log(`  avg_flow    : ${hand_a.avg_flow_when_open_l_s} L/s`)
console.log(`  avg_dT      : ${hand_a.avg_dT_when_open_k} K`)
console.log()

if (hand_b_s1) {
  console.log('── Hand-calc variant (b₁): engine State 1 T_op_prev trace replay ──')
  const d = pct(hand_b_s1.heat_loss_kwh, eng_s1.heat_loss_kwh)
  console.log(`  heat_loss   : ${hand_b_s1.heat_loss_kwh.toFixed(1)} kWh   (Δ vs State 1 engine: ${d.toFixed(3)}%)   ${Math.abs(d) < 0.5 ? '✓ CODE-PATH MATCH' : '✗ MISMATCH'}`)
  console.log(`  cool_gain   : ${hand_b_s1.cooling_gain_kwh.toFixed(1)} kWh   (Δ: ${pct(hand_b_s1.cooling_gain_kwh, eng_s1.cooling_gain_kwh).toFixed(3)}%)`)
  console.log(`  open_hours  : ${hand_b_s1.open_hours}`)
  console.log(`  avg_flow    : ${hand_b_s1.avg_flow_when_open_l_s} L/s`)
  console.log(`  avg_dT      : ${hand_b_s1.avg_dT_when_open_k} K`)
  console.log()
}
if (hand_b_s2) {
  console.log('── Hand-calc variant (b₂): engine State 2 T_op_prev trace replay ──')
  const d = pct(hand_b_s2.heat_loss_kwh, eng_s2.heat_loss_kwh)
  console.log(`  heat_loss   : ${hand_b_s2.heat_loss_kwh.toFixed(1)} kWh   (Δ vs State 2 engine: ${d.toFixed(3)}%)   ${Math.abs(d) < 0.5 ? '✓ CODE-PATH MATCH' : '✗ MISMATCH'}`)
  console.log(`  cool_gain   : ${hand_b_s2.cooling_gain_kwh.toFixed(1)} kWh   (Δ: ${pct(hand_b_s2.cooling_gain_kwh, eng_s2.cooling_gain_kwh).toFixed(3)}%)`)
  console.log(`  open_hours  : ${hand_b_s2.open_hours}`)
  console.log(`  avg_flow    : ${hand_b_s2.avg_flow_when_open_l_s} L/s`)
  console.log(`  avg_dT      : ${hand_b_s2.avg_dT_when_open_k} K`)
  console.log()
}

// ─── Brief 28k regression check ──────────────────────────────────────────────
console.log('── Brief 28k Gate 1-3 regression (per-element fabric losses) ──')
let regression_fails = 0
const tol_pct = 0.5
const cols = ['external_wall', 'roof', 'ground_floor', 'glazing', 'fabric_leakage', 'permanent_vents', 'thermal_bridging']
console.log(`  ${'Row'.padEnd(20)} ${'Baseline'.padStart(10)}  ${'State 1'.padStart(10)}  ${'State 2'.padStart(10)}  Δ % (S1)  Δ % (S2)`)
for (const k of cols) {
  const base = BRIEF28K_BASELINES[k]
  const v1 = s1.losses_at_setpoint[k]?.heating_loss_kwh ?? 0
  const v2 = s2.losses_at_setpoint[k]?.heating_loss_kwh ?? 0
  const p1 = pct(v1, base)
  const p2 = pct(v2, base)
  const ok = Math.abs(p1) < tol_pct && Math.abs(p2) < tol_pct
  if (!ok) regression_fails++
  console.log(`  ${k.padEnd(20)} ${base.toFixed(0).padStart(10)}  ${v1.toFixed(0).padStart(10)}  ${v2.toFixed(0).padStart(10)}  ${p1.toFixed(2).padStart(7)}%  ${p2.toFixed(2).padStart(7)}%  ${ok ? '✓' : '✗'}`)
}
console.log()
if (regression_fails === 0) {
  console.log('  ✓ All Brief 28k baseline rows preserved within ±0.5%')
} else {
  console.log(`  ✗ ${regression_fails} row(s) regressed`)
}
console.log()

// ─── PASS / FAIL ─────────────────────────────────────────────────────────────
console.log('=== Gate E3 verdict ===')
console.log()

const code_path_ok_s1 = hand_b_s1 && Math.abs(pct(hand_b_s1.heat_loss_kwh, eng_s1.heat_loss_kwh)) < 0.5
const code_path_ok_s2 = hand_b_s2 && Math.abs(pct(hand_b_s2.heat_loss_kwh, eng_s2.heat_loss_kwh)) < 0.5
if (code_path_ok_s1 && code_path_ok_s2) {
  console.log('  ✓ Code-path verification (variant b): hand-calc replay matches engine within rounding')
  console.log('    for both State 1 and State 2. Engine math is correctly implementing Brief 28e §A.2.')
} else {
  console.log('  ✗ Code-path verification FAILS:')
  if (!code_path_ok_s1) console.log(`    State 1: hand-calc ${hand_b_s1?.heat_loss_kwh} vs engine ${eng_s1.heat_loss_kwh} — Δ ${pct(hand_b_s1?.heat_loss_kwh ?? 0, eng_s1.heat_loss_kwh).toFixed(3)}%`)
  if (!code_path_ok_s2) console.log(`    State 2: hand-calc ${hand_b_s2?.heat_loss_kwh} vs engine ${eng_s2.heat_loss_kwh} — Δ ${pct(hand_b_s2?.heat_loss_kwh ?? 0, eng_s2.heat_loss_kwh).toFixed(3)}%`)
}
console.log()

const da = Math.abs(pct(hand_a.heat_loss_kwh, eng_s1.heat_loss_kwh))
console.log(`  Hand-calc variant (a) at design T_zone=21°C: ${hand_a.heat_loss_kwh.toFixed(0)} kWh`)
console.log(`    vs State 1 engine (free-running ~16°C avg): Δ ${pct(hand_a.heat_loss_kwh, eng_s1.heat_loss_kwh).toFixed(2)}%`)
console.log(`    vs State 2 engine (gain-warmed ~22°C avg) : Δ ${pct(hand_a.heat_loss_kwh, eng_s2.heat_loss_kwh).toFixed(2)}%`)
console.log(`    Variant (a) is a design-condition reference; expected to land between State 1 and State 2.`)
console.log()
console.log(regression_fails === 0 && code_path_ok_s1 && code_path_ok_s2
  ? '✓ Gate E3 PASSES — code-path validated + zero regression on Brief 28k rows'
  : '✗ Gate E3 has issues — see above')
console.log()
console.log('Spreadsheet update note (Gate E3 §1): the canonical hand-calc number to add')
console.log('to Bridgewater_Bottom_Up_Energy_Model.xlsx → 05_Heat_Loss + 08_Heat_Balance is:')
console.log(`  "Operable openings (natural ventilation, gf_entrance_door)" = ${eng_s1.heat_loss_kwh.toFixed(0)} kWh`)
console.log(`  using State 1 T_op_prev trace (free-running zone), or ${hand_a.heat_loss_kwh.toFixed(0)} kWh under`)
console.log(`  design constant T_zone=21°C assumption. Engine State 1 = ${eng_s1.heat_loss_kwh.toFixed(0)} kWh by construction.`)
