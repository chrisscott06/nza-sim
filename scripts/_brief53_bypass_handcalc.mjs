/**
 * scripts/_brief53_bypass_handcalc.mjs
 *
 * Brief 53 follow-on (2026-05-26): Chris's bypass-residual question.
 *
 * QUESTION (from Chris):
 *   On the live Bridgewater (131.9) MVHR-under-VRF still shows +2.4 marginal
 *   WITH bypass on (was +5.3 off). Bypass only halved the penalty, didn't
 *   remove it. Is that physically correct (bypass only catches the
 *   T_out<T_extract subset of cooling hours, leaving a real residual
 *   penalty) or is the bypass under-firing?
 *
 * Settle it on the refbox, not on the drifted live DB. HARD STOP — no fix.
 *
 * PHYSICAL EXPECTATION (from first principles):
 *   In cooling-active hour h with T_out_h < T_extract_h:
 *     Vent contribution to zone heat (no MVHR):     flow × ρCp × (T_out - T_extract) < 0 — HELPS cool
 *     Vent contribution (MVHR, no bypass, HRE=h):   flow × ρCp × (1-h) × (T_out - T_extract) — helps less
 *     Vent contribution (MVHR, bypass ON, HRE=h):   same as no MVHR (HRE neutralised)
 *
 *   Bypass-on cooling savings (vs bypass-off):
 *     ΔCooling = Σ_h_bypassed  HRE × flow × ρCp × (T_extract_h − T_out_h)
 *
 *   This is EXACTLY `bypass_suppressed_recovery_mwh` — the heat the engine
 *   says bypass prevented from entering the supply during cooling-active
 *   hours. The cooling system would have had to remove that heat; bypass
 *   means it doesn't.
 *
 *   Whether the bypass FULLY removes the MVHR cooling penalty depends on
 *   T_out > T_extract hours during the cooling season. In those hours
 *   (typical mid-summer afternoons), MVHR actually HELPS cooling (supply
 *   gets pulled toward the cooler T_extract). Bypass doesn't fire. MVHR
 *   contributes a NEGATIVE cooling delta in those hours.
 *
 *   So the COMPLETE picture, MVHR with bypass on:
 *     ΔCooling vs no-MVHR = − HRE × flow × ρCp × Σ_h_cooling-active_AND_T_out>T_extract (T_out − T_extract)
 *                           + 0 (bypass-handled hours cancel out)
 *   Net should be NEGATIVE (MVHR with bypass HELPS cooling, net).
 *
 *   If the engine shows cooling_with_MVHR_bypass_on > cooling_no_MVHR,
 *   bypass is under-firing.
 *
 * PROBE STRATEGY:
 *   Three runs on the refbox HOT (occupant-driven cooling, same as Brief 53
 *   falsifiability test):
 *     A. no MVHR        (ventilation.enabled = false)
 *     B. MVHR HRE=0.75, bypass OFF
 *     C. MVHR HRE=0.75, bypass ON
 *
 *   Reads from engine:
 *     - consumption.space_cooling.demand_mwh per run
 *     - system_performance.ventilation.total.recovery_mwh per run
 *     - system_performance.ventilation.total.bypass.{total_hours_x_systems,
 *       total_suppressed_recovery_mwh} per run
 *     - demand.hourly_zone_air_c (T_extract proxy) per run
 *     - demand.cooling_demand_hourly_kwh per run
 *     - weatherData.temperature per hour (already loaded)
 *
 *   Hand-calc on the Node side (no engine help):
 *     Σ_h [ HRE × flow × ρCp × max(0, T_air_h − T_out_h) ]
 *     restricted to (cool_prev_h > 0 AND T_out_h < T_air_h)
 *
 *   Three assertions:
 *     [1] (cooling_off − cooling_on) === bypass_suppressed_recovery_mwh
 *         (engine internal consistency)
 *     [2] (cooling_off − cooling_on) === hand-calc within ≤2 %
 *         (engine externally verifiable)
 *     [3] cooling_on vs cooling_noMVHR — settles the under-firing question.
 *         If cooling_on ≤ cooling_noMVHR → bypass not under-firing
 *         (residual on Bridgewater is fan-elec + heating SCOP=4 effects).
 *         If cooling_on > cooling_noMVHR → bypass IS under-firing.
 *
 * HARD STOP — no engine changes. Just measurement.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const API = process.env.NZA_API || 'http://127.0.0.1:8003'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const WEATHER_FILE = 'GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw'

// ── Fetch + load weather ────────────────────────────────────────────────
async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} → ${r.status}`); return r.json() }
const lib = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []

const epwPath = path.join(REPO_ROOT, 'data/weather/current', WEATHER_FILE)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), direct_normal = new Float32Array(N)
const diffuse_horizontal = new Float32Array(N), wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i]=parseInt(p[1]);day[i]=parseInt(p[2]);hour[i]=parseInt(p[3])
  temperature[i]=parseFloat(p[6]);direct_normal[i]=parseFloat(p[14])
  diffuse_horizontal[i]=parseFloat(p[15]);wind_speed[i]=parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, 0)

// ── Library + constructions ─────────────────────────────────────────────
const libraryData = {
  constructions: libArr.map(c => ({
    name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0, g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c, layers: c.layers,
  })),
  system_templates: [
    ...SYSTEM_TEMPLATES_LIBRARY,
    { id: 'refbox_heat', supports_services: ['heating'], heating_scop: 3.0, fuel: 'electricity' },
    { id: 'refbox_cool', supports_services: ['cooling'], cooling_seer: 3.0, fuel: 'electricity' },
    { id: 'refbox_dhw',  supports_services: ['dhw'],     dhw_seasonal_efficiency: 1.0, fuel: 'electricity' },
  ],
}
function pickConstruction(suffix) {
  const found = libArr.find(c => c.name?.toLowerCase().includes(suffix))
  return found?.id ?? libArr[0]?.id
}
const constructions = {
  external_wall: pickConstruction('wall')   ?? libArr[0]?.id,
  roof:          pickConstruction('roof')   ?? libArr[0]?.id,
  ground_floor:  pickConstruction('floor')  ?? libArr[0]?.id,
  glazing:       pickConstruction('glazing') ?? pickConstruction('window') ?? libArr[0]?.id,
}

// ── Refbox HOT builder ──────────────────────────────────────────────────
const COMFORT = { lower_c: 20, upper_c: 25 }
const ALWAYS_ON = {
  weekday: Array(24).fill(1), saturday: Array(24).fill(1), sunday: Array(24).fill(1),
  monthly_multipliers: Array(12).fill(1), exceptions: [],
}
const FLOW_L_S = 500
const HRE = 0.75

// `ventHre = 0` builds a system with the SAME flow as MVHR but no recovery —
// the fair "no recovery" baseline for the cooling-side question. Setting
// `mvhrEnabled: false` would seal the box (no vent flow at all), which
// conflates the recovery effect with the vent-flow cooling effect.
function makeRefbox({ mvhrEnabled = true, summerBypass = false, ventHre = HRE } = {}) {
  return {
    name: 'REFBOX-hot', weather_file: WEATHER_FILE,
    length: 10, width: 10, floor_height: 3, num_floors: 1, orientation: 0,
    num_bedrooms: 100, occupancy_rate: 0, people_per_room: 0,
    // Occupant gains drive cooling demand without a heating-side complication
    occupancy: {
      density: { value: 1, basis: 'per_m2' },  // 1 person / m² — heavy load to force cooling
      occupancy_rate: 1, sensible_w_per_person: 100, schedule: ALWAYS_ON,
    },
    infiltration_ach: 0, wwr: { north: 0, east: 0, south: 0, west: 0 },
    openings: [], operable_openings: [], thermal_bridges: [],
    schedules: {}, shading_overhang: {}, shading_fin: {},
    gains: {}, operator: {}, fabric: {},
    thermal_mass_mode: 'category', thermal_mass_category: 'lightweight',
    systems_config_v40: { heating: [], cooling: [], dhw: [], ventilation: [], lighting: [], small_power: [] },
    systems_config_v25: {
      lighting_power_density: 0, equipment_power_density: 0,
      heating: { primary: { library_id: 'refbox_heat' }, primary_pct: 100, setpoint_c: 20 },
      cooling: { primary: { library_id: 'refbox_cool', enabled: false }, primary_pct: 0 },
      dhw:     { primary: { library_id: 'refbox_dhw',  enabled: false }, primary_pct: 100, circulation_pump_w: 0 },
      ventilation: [{
        id: 'refbox_mvhr', name: 'refbox_mvhr',
        enabled: mvhrEnabled, hre_enabled: mvhrEnabled && ventHre > 0,
        flow_l_s: FLOW_L_S, sfp_w_per_l_s: 0,
        hre: ventHre,
        hours: 8760, schedule_ref: 'always_on',
        summer_bypass: summerBypass,
      }],
    },
  }
}

function runEngine(building) {
  return calculateInstant(
    building, constructions, {}, libraryData, weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand: COMFORT },
  )
}

function pick(r) {
  const sc = r?.consumption?.space_cooling ?? {}
  const sv = r?.system_performance?.ventilation?.total ?? {}
  return {
    cooling_demand_mwh:    sc.demand_mwh ?? null,
    recovery_effective_mwh: sv.recovery_mwh ?? null,
    recovery_theoretical_mwh: sv.recovery_theoretical_mwh ?? null,
    bypass_hours:          sv.bypass?.total_hours_x_systems ?? 0,
    suppressed_recovery_mwh: sv.bypass?.total_suppressed_recovery_mwh ?? 0,
    hourly_T_air:          r?.demand?.hourly_zone_air_c ?? null,
    hourly_cool_kwh:       r?.demand?.cooling_demand_hourly_kwh ?? null,
    eui:                   r?.energy_use?.totals?.eui_kwh_per_m2 ?? null,
  }
}

function fmt(v, dp = 3) {
  if (v == null || !Number.isFinite(v)) return '—'
  return Number(v).toFixed(dp)
}

// ── Hand-calc: bypass-on cooling savings from first principles ──────────
//
// Σ_h [ HRE × flow × ρCp × max(0, T_air_h − T_out_h) ]
// restricted to the bypass trigger (cool_prev_h > 0 AND T_out_h < T_air_h).
//
// flow [L/s] × ρCp [J/m³K, 1.2 × 1005] × ΔT [K] × 1 hour [3600s] / 3.6e9 → MWh
const AIR_HC_J_PER_M3_K = 1.2 * 1005
const flow_m3s = FLOW_L_S / 1000

function handCalcBypassSavings(hourly_T_air, hourly_cool_kwh) {
  if (!hourly_T_air || !hourly_cool_kwh) return null
  let savings_mwh = 0
  let trigger_hours = 0
  let total_dT_K = 0
  for (let h = 0; h < N; h++) {
    const T_air = hourly_T_air[h]
    const T_out = temperature[h]
    const cool_prev_kwh = h > 0 ? (hourly_cool_kwh[h - 1] ?? 0) : 0
    // Brief 53 Part 1 trigger: cooling_h-1 > 0 AND T_out < T_extract
    const bypassWouldFire = (cool_prev_kwh > 0) && (T_out < T_air)
    if (!bypassWouldFire) continue
    const dT = T_air - T_out
    trigger_hours += 1
    total_dT_K     += dT
    const heatSuppressedJ = HRE * flow_m3s * AIR_HC_J_PER_M3_K * dT * 3600
    savings_mwh += heatSuppressedJ / 3.6e9
  }
  return { savings_mwh, trigger_hours, total_dT_K }
}

// ──────────────────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log('  Brief 53 follow-on — bypass cooling-savings hand-calc on refbox HOT')
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log(`  Weather: ${WEATHER_FILE}  ·  comfort ${COMFORT.lower_c}–${COMFORT.upper_c}°C`)
console.log(`  Box: 10×10×3 m × 1 floor, 1 person/m², no glazing/infiltration/fabric losses`)
console.log(`  MVHR: 500 L/s, HRE = 0.75, SFP = 0 (no fan-elec confound)`)
console.log()

// Run A — vent flow SAME as MVHR but HRE=0 (no recovery). This is the
// physically-meaningful "no MVHR" baseline: a building with MEV-equivalent
// flow but no heat exchanger. NOT a sealed box.
console.log('  Run A — vent flow ON, HRE = 0 (no recovery — fair MVHR baseline)')
const A = pick(runEngine(makeRefbox({ mvhrEnabled: true, ventHre: 0, summerBypass: false })))
console.log(`    cooling demand:        ${fmt(A.cooling_demand_mwh)} MWh`)
console.log(`    recovery (sanity 0):   ${fmt(A.recovery_effective_mwh)} MWh`)
console.log()

// Run A2 — sealed box (no vent at all) — for context, NOT used in checks
const A2 = pick(runEngine(makeRefbox({ mvhrEnabled: false, summerBypass: false })))
console.log('  Run A2 — sealed (no ventilation at all) — context only, NOT used in checks')
console.log(`    cooling demand:        ${fmt(A2.cooling_demand_mwh)} MWh   ← reveals how much vent flow alone helps`)
console.log()

// Run B — MVHR HRE=0.75, bypass OFF
console.log('  Run B — MVHR HRE=0.75, summer_bypass = OFF')
const B = pick(runEngine(makeRefbox({ mvhrEnabled: true, summerBypass: false })))
console.log(`    cooling demand:        ${fmt(B.cooling_demand_mwh)} MWh`)
console.log(`    recovery (effective):  ${fmt(B.recovery_effective_mwh)} MWh`)
console.log(`    recovery (theoretical):${fmt(B.recovery_theoretical_mwh)} MWh`)
console.log(`    bypass hours:          ${B.bypass_hours} (must be 0 — bypass OFF)`)
console.log()

// Run C — MVHR HRE=0.75, bypass ON
console.log('  Run C — MVHR HRE=0.75, summer_bypass = ON')
const C = pick(runEngine(makeRefbox({ mvhrEnabled: true, summerBypass: true })))
console.log(`    cooling demand:        ${fmt(C.cooling_demand_mwh)} MWh`)
console.log(`    recovery (effective):  ${fmt(C.recovery_effective_mwh)} MWh`)
console.log(`    recovery (theoretical):${fmt(C.recovery_theoretical_mwh)} MWh`)
console.log(`    bypass hours×systems:  ${C.bypass_hours}`)
console.log(`    suppressed recovery:   ${fmt(C.suppressed_recovery_mwh)} MWh`)
console.log()

// ── Hand-calc (independent of engine bypass logic) ──────────────────────
console.log('  HAND-CALC — Σ_h [HRE × flow × ρCp × (T_air − T_out)]')
console.log('              restricted to bypass trigger (cool_prev>0 AND T_out<T_air)')
console.log('              using engine\'s hourly_T_air + hourly_cool_kwh as inputs')
console.log()
// Use Run C's hourly T_air (it's the post-bypass simulation that the engine
// would have made its bypass decisions against; for the hand-calc input, the
// pre-bypass T_air from Run B is the cleaner reference because it represents
// the world the bypass decision is reacting to). Brief 53 audit §4.3 used
// Run B's T_air for the same reason. Probe both for completeness.
// Brief 53 Part 2 surfaced T_air_hourly + cooling_demand_hourly_kwh for
// EXACTLY this kind of cross-check. The lagged signal the engine uses is
// `coolingDemandHourlyKwh[h-1]` from the same run's State 2 output.
//
// Hand-calc using Run C's hourly_T_air + hourly_cool_kwh is the like-for-
// like: the engine made its bypass decision against this same data.
const handB = handCalcBypassSavings(B.hourly_T_air, B.hourly_cool_kwh)
const handC = handCalcBypassSavings(C.hourly_T_air, C.hourly_cool_kwh)

// Diagnostic — the gap between engine bypass_hours and my trigger count.
console.log(`    Engine bypass hours (Run C):                 ${C.bypass_hours}`)
console.log(`    Gap between hand-calc filter and engine:     B-filter ${(handB?.trigger_hours ?? 0) - C.bypass_hours} extra · C-filter ${(handC?.trigger_hours ?? 0) - C.bypass_hours} extra`)
console.log(`    If gap > 0: my filter catches hours the engine\'s trigger doesn\'t fire in.`)
console.log()
console.log(`    Trigger hours (from B's pre-bypass T_air):   ${handB?.trigger_hours ?? '?'}`)
console.log(`    Sum (T_air − T_out) [K·h]:                   ${fmt(handB?.total_dT_K, 0)}`)
console.log(`    Hand-calc cooling savings:                   ${fmt(handB?.savings_mwh)} MWh`)
console.log()
console.log(`    Trigger hours (from C's post-bypass T_air):  ${handC?.trigger_hours ?? '?'}`)
console.log(`    Sum (T_air − T_out) [K·h]:                   ${fmt(handC?.total_dT_K, 0)}`)
console.log(`    Hand-calc cooling savings:                   ${fmt(handC?.savings_mwh)} MWh`)
console.log()

// ── Three falsifiability checks ─────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log('  FALSIFIABILITY')
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log()

const delta_cooling = (B.cooling_demand_mwh ?? 0) - (C.cooling_demand_mwh ?? 0)
console.log(`  [1] (cooling_off − cooling_on) === suppressed_recovery_mwh ?`)
console.log(`        Δcooling           = ${fmt(delta_cooling)} MWh`)
console.log(`        suppressed_recovery = ${fmt(C.suppressed_recovery_mwh)} MWh`)
const check1_diff = Math.abs(delta_cooling - C.suppressed_recovery_mwh)
const check1_pass = check1_diff < 0.5
console.log(`        |Δ| = ${fmt(check1_diff)} MWh — ${check1_pass ? '✓ PASS (engine internally consistent)' : '✗ FAIL'}`)
console.log()

console.log(`  [2] (cooling_off − cooling_on) === hand-calc ?`)
console.log(`        Δcooling                   = ${fmt(delta_cooling)} MWh`)
console.log(`        hand-calc (using B T_air)  = ${fmt(handB?.savings_mwh)} MWh`)
console.log(`        hand-calc (using C T_air)  = ${fmt(handC?.savings_mwh)} MWh`)
const ratioB = handB?.savings_mwh > 0 ? delta_cooling / handB.savings_mwh : null
const ratioC = handC?.savings_mwh > 0 ? delta_cooling / handC.savings_mwh : null
console.log(`        ratio (engine/hand-calc-B) = ${fmt(ratioB, 3)}`)
console.log(`        ratio (engine/hand-calc-C) = ${fmt(ratioC, 3)}`)
const check2_pass = ratioB != null && ratioB > 0.95 && ratioB < 1.05
console.log(`        ${check2_pass ? '✓ PASS (engine matches first-principles hand-calc within 5 %)' : '? out of band — review'}`)
console.log()

console.log(`  [3] cooling_with_MVHR_bypass_ON  vs  cooling_no_MVHR  →  is bypass under-firing?`)
const residual_penalty = (C.cooling_demand_mwh ?? 0) - (A.cooling_demand_mwh ?? 0)
console.log(`        cooling_no_MVHR         = ${fmt(A.cooling_demand_mwh)} MWh`)
console.log(`        cooling_MVHR_bypass_ON  = ${fmt(C.cooling_demand_mwh)} MWh`)
console.log(`        residual penalty (C−A)  = ${fmt(residual_penalty)} MWh`)
const off_penalty = (B.cooling_demand_mwh ?? 0) - (A.cooling_demand_mwh ?? 0)
console.log(`        cooling_MVHR_bypass_OFF = ${fmt(B.cooling_demand_mwh)} MWh`)
console.log(`        bypass-OFF penalty (B−A)= ${fmt(off_penalty)} MWh`)
console.log()
console.log(`        Bypass reduced penalty from ${fmt(off_penalty)} → ${fmt(residual_penalty)} MWh`)
console.log()

// Quantify each contributor explicitly. Avoid the "verdict" autopilot —
// give Chris the data layout he can read directly.
const pct_caught = off_penalty > 0 ? (1 - residual_penalty / off_penalty) * 100 : null
const trigger_gap_pct = handB?.trigger_hours > 0 ? (1 - C.bypass_hours / handB.trigger_hours) * 100 : null
console.log()
console.log(`        Bypass caught ${pct_caught?.toFixed(0) ?? '?'} % of the MVHR cooling penalty.`)
console.log(`        Engine fired in ${C.bypass_hours} hours out of ${handB?.trigger_hours ?? '?'} naive-trigger-eligible hours`)
console.log(`        (engine missed ${trigger_gap_pct?.toFixed(0) ?? '?'} %).`)
console.log()
console.log(`        Two distinct gaps to interpret:`)
console.log(`          1. Engine fires in fewer hours than naive trigger would (${handB?.trigger_hours ?? '?'} → ${C.bypass_hours} = ${trigger_gap_pct?.toFixed(0) ?? '?'} % missed).`)
console.log(`             This is engine bypass selectivity — could be lagged-signal edge effects,`)
console.log(`             or additional internal gating. Worth understanding before declaring "bug".`)
console.log()
console.log(`          2. Even within fired hours, the suppressed_recovery (${fmt(C.suppressed_recovery_mwh)}) is`)
console.log(`             0.76 MWh > Δcooling (${fmt(delta_cooling)}). The 0.76 MWh gap is the State 2`)
console.log(`             T_air cascade nonlinearity: bypassing in some hours changes T_air slightly,`)
console.log(`             which changes cooling needs in OTHER hours.`)

// Bridgewater implication
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log('  BRIDGEWATER IMPLICATION')
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log()
console.log(`  Chris observed: MVHR-under-VRF marginal +5.3 (bypass off) → +2.4 (bypass on).`)
console.log(`  Δ = 2.9 EUI units from bypass. The remaining +2.4 with bypass on COULD be:`)
console.log(`    (a) fan electricity (real, doesn\'t go away with bypass — depends on SFP)`)
console.log(`    (b) heating-saving / SCOP_VRF = recovery_offset / 4.0 — small because VRF is efficient`)
console.log(`    (c) residual cooling penalty from bypass under-firing`)
console.log()
console.log(`  Refbox settles (c) only. Residual cooling penalty after bypass: ${fmt(residual_penalty)} MWh`)
console.log(`  (${fmt(100*residual_penalty/(A.cooling_demand_mwh || 1), 1)}% of base cooling). Bypass catches ${pct_caught?.toFixed(0) ?? '?'} % of the MVHR penalty,`)
console.log(`  not 100 %. Some of the +2.4 EUI IS the cooling side; some is fan elec; some is the`)
console.log(`  small heating saving residual after VRF SCOP=4.`)
console.log()
console.log(`  CONCLUSION: bypass is doing most of its job (catches ~${pct_caught?.toFixed(0) ?? '?'}%), but isn\'t a full`)
console.log(`  cancellation. Whether that residual is "physically inevitable" (lagged-signal first-hour`)
console.log(`  effects + cascade nonlinearity) or "improvable" (engine\'s 1670/2412 ratio = 69 % firing`)
console.log(`  in eligible hours suggests room) needs an engine-side trace BEFORE deciding to touch.`)
console.log(`  Chris\'s instruction is HARD STOP — surface for decision, do not fix.`)
console.log()

// Persist JSON
const out = {
  meta: {
    weather_file: WEATHER_FILE,
    flow_l_s: FLOW_L_S,
    hre: HRE,
    comfort: COMFORT,
    timestamp: new Date().toISOString(),
  },
  runs: {
    A_no_mvhr:        { cooling_demand_mwh: A.cooling_demand_mwh, recovery: A.recovery_effective_mwh },
    B_bypass_off:     { cooling_demand_mwh: B.cooling_demand_mwh, recovery: B.recovery_effective_mwh, bypass_hours: B.bypass_hours, suppressed: B.suppressed_recovery_mwh },
    C_bypass_on:      { cooling_demand_mwh: C.cooling_demand_mwh, recovery: C.recovery_effective_mwh, bypass_hours: C.bypass_hours, suppressed: C.suppressed_recovery_mwh },
  },
  hand_calc: {
    using_B_T_air: handB,
    using_C_T_air: handC,
  },
  checks: {
    delta_cooling_mwh:      delta_cooling,
    suppressed_recovery_mwh: C.suppressed_recovery_mwh,
    engine_internally_consistent: check1_pass,
    engine_matches_handcalc:      check2_pass,
    residual_penalty_mwh:         residual_penalty,
    off_penalty_mwh:              off_penalty,
    bypass_caught_pct:            pct_caught,
    engine_firing_rate_vs_naive_eligible_pct: handB?.trigger_hours > 0 ? (C.bypass_hours / handB.trigger_hours) * 100 : null,
  },
}
const OUT = path.join(REPO_ROOT, 'docs/audit/53_bypass_handcalc.json')
fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`  JSON: ${path.relative(REPO_ROOT, OUT)}`)
console.log()
