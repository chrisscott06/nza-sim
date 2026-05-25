/**
 * scripts/_brief49_refbox_test.mjs
 *
 * Brief 49 — known-answer REFERENCE BOX test fixture.
 *
 * Why this exists (per Chris's Brief 49 follow-up): Bridgewater is too
 * entangled — DHW, internal gains, cooling, multiple ventilation systems,
 * a non-zero MVHR fan ≈ heating savings. The fan/heat cancellation that
 * makes the live UI look flat is exactly what makes the toggle UNREADABLE
 * as a diagnosis. The reference box strips every confound away:
 *
 *   - Single zone, 10m × 10m × 3m
 *   - No internal gains (LPD=0, EPD=0, 0 occupants)
 *   - No DHW (occupancy = 0 → dhw_demand = 0 by construction)
 *   - No cooling
 *   - No infiltration, no glazing, no operable openings
 *   - Single heating system at KNOWN SCOP (configurable per probe)
 *   - Single ventilation system at KNOWN flow + HRE (configurable per probe)
 *   - SFP = 0 — no fan electricity. The Bridgewater "fan ≈ heating saving"
 *     cancellation cannot happen here. Toggling MVHR moves heating fuel
 *     and ONLY heating fuel.
 *   - v40 arrays empty — engine uses v25 path exclusively (no silent
 *     fallback dance).
 *
 * Every boundary is hand-calculable. Engine output is compared to the
 * hand-calc to decide between Hypothesis 1, 2, or 3.
 *
 * Three probes:
 *
 *   PROBE 1 — MVHR on→off via HRE toggle (with SFP=0)
 *     Run R0: HRE=0    Run R1: HRE=0.75
 *     With SFP=0, the ONLY total-electricity change is heating fuel.
 *     Expect Δ total_elec = Δ heating_elec.
 *     Hand-calc: if engine subtracts recovery ONCE (correct):
 *        Δ heating_elec_correct = (vent × HRE) / SCOP per single boundary
 *     If engine subtracts recovery TWICE (State 2 (1−HRE) + State 3 explicit):
 *        Δ heating_elec_engine ≈ 2 × (vent × HRE) / SCOP
 *     If H2 (fuel uses raw):
 *        Δ heating_elec_engine ≈ 0
 *
 *   PROBE 2 — SCOP 3.0 → 4.0 (everything else held)
 *     Delivered demand is HEATING DEMAND, unaffected by SCOP. Electricity
 *     should scale by 1/SCOP. Hand-calc: Δ elec = delivered × (1/3 − 1/4).
 *     If engine matches → SCOP applied to the right quantity (delivered).
 *     If not → SCOP applied to wrong quantity (raw demand, vent loss, etc.)
 *
 *   PROBE 3 — HRE 0 → 0.75 sweep (5 points)
 *     Recovery must scale LINEARLY with HRE and NEVER exceed the
 *     airstream's physical heat content (full vent loss). If recovery
 *     at HRE=0.75 exceeds 0.75 × vent_loss → H3 confirmed.
 *
 * Read-only investigation. Does NOT modify the engine. Does NOT modify
 * the database. Re-runnable as a test fixture for the future fix brief.
 *
 * Usage:
 *   node scripts/_brief49_refbox_test.mjs
 *
 * (Backend on 127.0.0.1:8002 must be running — used to fetch Bridgewater's
 * construction library, no project-level data is read.)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const WEATHER_FILE = 'GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw'

// ── Fetch construction library + load weather ────────────────────────────
async function fj(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${url} → ${r.status}`); return r.json()
}
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
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6]); direct_normal[i] = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15]); wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }

// Annual integrated heating-degree-hours at 20°C base (for hand-calc sanity).
const T_BASE = 20
let dT_integral_K_hours = 0
for (let i = 0; i < N; i++) {
  const dT = T_BASE - temperature[i]
  if (dT > 0) dT_integral_K_hours += dT
}

// ── Reference box: simple, known-answer building ─────────────────────────
const BOX_L = 10, BOX_W = 10, BOX_H = 3, BOX_FLOORS = 1
const BOX_GIA = BOX_L * BOX_W * BOX_FLOORS  // 100 m²

// Custom system templates: inline so we control SCOP + SFP + HRE exactly.
// Don't depend on library defaults — those drift across briefs.
const REFBOX_TEMPLATES = [
  // Heating systems at known SCOPs (one per probe variant)
  { id: 'refbox_heat_scop3', supports_services: ['heating'], heating_scop: 3.0, fuel: 'electricity' },
  { id: 'refbox_heat_scop4', supports_services: ['heating'], heating_scop: 4.0, fuel: 'electricity' },
  // Cooling stub (disabled in box, but resolver may want a template)
  { id: 'refbox_cool', supports_services: ['cooling'], cooling_seer: 3.0, fuel: 'electricity' },
  // DHW stub
  { id: 'refbox_dhw', supports_services: ['dhw'], dhw_seasonal_efficiency: 1.0, fuel: 'electricity' },
]

const SYSTEM_TEMPLATES = [...SYSTEM_TEMPLATES_LIBRARY, ...REFBOX_TEMPLATES]

const libraryData = {
  constructions: libArr.map(c => ({
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c,
    layers: c.layers,
  })),
  system_templates: SYSTEM_TEMPLATES,
}

// Pick simple construction choices from the library.
// (Just need SOMETHING that resolves — magnitudes don't matter for the
// double-counting test, only consistency.)
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

// Build the reference box building config.
function makeRefBox({ heatScop = 3.0, ventFlow_l_s = 500, ventHre = 0.75, ventSfp = 0, ventEnabled = true } = {}) {
  const heatLibId = heatScop === 4.0 ? 'refbox_heat_scop4' : 'refbox_heat_scop3'
  return {
    name: 'REFBOX',
    weather_file: WEATHER_FILE,
    length: BOX_L,
    width:  BOX_W,
    floor_height: BOX_H,
    num_floors:   BOX_FLOORS,
    orientation:  0,
    num_bedrooms:    0,     // zero occupancy → zero people gains AND zero DHW
    occupancy_rate:  0,
    people_per_room: 0,
    infiltration_ach: 0,    // no infiltration
    wwr:           { north: 0, east: 0, south: 0, west: 0 },  // no glazing
    openings:           [],
    operable_openings:  [],
    thermal_bridges:    [],
    schedules:          {},
    shading_overhang:   {},
    shading_fin:        {},
    gains: {},
    operator: {},
    fabric: {},
    thermal_mass_mode: 'category',
    thermal_mass_category: 'lightweight',
    // No v40 so engine uses v25 path exclusively (no silent fallback)
    systems_config_v40: { heating: [], cooling: [], dhw: [], ventilation: [], lighting: [], small_power: [] },
    systems_config_v25: {
      // Force LPD/EPD to 0 — no internal gains from lighting/equipment
      lighting_power_density: 0,
      equipment_power_density: 0,
      // Heating: single system at known SCOP
      heating: {
        primary:     { library_id: heatLibId },
        primary_pct: 100,
        setpoint_c:  20,
      },
      // Cooling: disabled (primary_pct=0)
      cooling: {
        primary:     { library_id: 'refbox_cool', enabled: false },
        primary_pct: 0,
      },
      // DHW: disabled (occupancy is 0, but also explicit primary disabled)
      dhw: {
        primary:     { library_id: 'refbox_dhw', enabled: false },
        primary_pct: 100,
        circulation_pump_w: 0,
      },
      // Ventilation: single system, configurable HRE / flow / SFP / enabled
      ventilation: [{
        id: 'refbox_mvhr',
        name: 'refbox_mvhr',
        enabled: ventEnabled,
        hre_enabled: ventHre > 0,
        flow_l_s: ventFlow_l_s,
        sfp_w_per_l_s: ventSfp,
        hre: ventHre,
        hours: 8760,
        schedule_ref: 'always_on',
      }],
    },
  }
}

function runEngine(building, comfortBand = { lower_c: 20, upper_c: 25 }) {
  const orientation = building.orientation ?? 0
  const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, orientation)
  return calculateInstant(
    building, constructions, {}, libraryData,
    weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand },
  )
}

function pick(result) {
  const sh = result?.consumption?.space_heating ?? {}
  const sv = result?.system_performance?.ventilation?.total ?? {}
  const eu = result?.energy_use?.totals ?? {}
  return {
    sh_demand_mwh:       sh.demand_mwh ?? null,           // RAW (display denominator)
    sh_delivered_mwh:    sh.delivered_mwh ?? null,        // post-MVHR × share
    sh_electricity_mwh:  sh.electricity_mwh ?? null,      // per-service heating elec
    sh_recovery_off_mwh: sh.recovery_offset_mwh ?? null,
    vent_fan_kwh:        sv.fan_kwh ?? null,
    vent_recovery_mwh:   sv.recovery_mwh ?? null,
    vent_recovery_theo:  sv.recovery_theoretical_mwh ?? null,
    elec_total_kwh:      eu.electricity_kwh ?? null,
    eui:                 eu.eui_kwh_per_m2 ?? null,
  }
}

function fmt(v, dp = 3) {
  if (v == null || !Number.isFinite(v)) return '—'
  return Number(v).toFixed(dp)
}

// ── Air physics constants ─────────────────────────────────────────────────
const AIR_HC_J_PER_M3_K = 1.2 * 1005  // ρ × cp
function ventLossMwh(flow_l_s, hre = 0) {
  // Annual integral: flow_m3s × ρcp × dT_integral_K_h × (1 - hre) × 3600 (s/h) / 1e6 (J→MWh)
  // The /1e6 is J→Wh; another /1000 would be Wh→kWh; another /1000 kWh→MWh
  // Carefully: flow_m3s × ρcp(J/m3K) × dT_K · hours × 3600 (s/h) = J. /1e6 = MJ. /3600 = kWh. /1000 = MWh.
  // Equivalently: flow_m3s × ρcp × dT_K · hours × 3600 / 3.6e9 = MWh
  const flow_m3s = flow_l_s / 1000
  const J = flow_m3s * AIR_HC_J_PER_M3_K * dT_integral_K_hours * (1 - hre) * 3600
  return J / 3.6e9
}

console.log('========================================================')
console.log('  Brief 49 — Reference box test fixture')
console.log('========================================================')
console.log(`  Weather: ${WEATHER_FILE}`)
console.log(`  Annual integrated heating-degree-hours @ 20°C base: ${dT_integral_K_hours.toFixed(0)} K·h`)
console.log(`  Box: ${BOX_L} × ${BOX_W} × ${BOX_H} m × ${BOX_FLOORS} floor = ${BOX_GIA} m² GIA`)
console.log('  Loads stripped: LPD=0, EPD=0, occupants=0, DHW disabled, cooling disabled, infiltration=0, WWR=0.')
console.log('  Ventilation: 500 L/s nominal, SFP=0 (no fan electricity), configurable HRE.')
console.log('  Heating: ASHP at configurable SCOP.')
console.log('  v40 systems empty → v25 path exclusive (no silent fallback).')
console.log()
console.log(`  Hand-calc reference (vent flow 500 L/s, no HRE):`)
console.log(`    vent_loss_no_hre = ${fmt(ventLossMwh(500, 0))} MWh / yr  (airstream heat content ceiling)`)
console.log(`    vent_loss_at_hre_0.75 = ${fmt(ventLossMwh(500, 0.75))} MWh / yr  (State 2 (1−HRE) reduction)`)
console.log()

const COMFORT = { lower_c: 20, upper_c: 25 }
const probeResults = {}

// ════════════════════════════════════════════════════════════════════════
// PROBE 1 — MVHR HRE toggle, SFP=0, fixed SCOP
// ════════════════════════════════════════════════════════════════════════
console.log('========================================================')
console.log('  PROBE 1 — MVHR HRE 0.75 → 0  (SFP=0, SCOP=3.0)')
console.log('========================================================')
const P1_FLOW = 500, P1_SCOP = 3.0
const r1_on  = runEngine(makeRefBox({ heatScop: P1_SCOP, ventFlow_l_s: P1_FLOW, ventHre: 0.75, ventSfp: 0 }), COMFORT)
const r1_off = runEngine(makeRefBox({ heatScop: P1_SCOP, ventFlow_l_s: P1_FLOW, ventHre: 0.00, ventSfp: 0 }), COMFORT)
const p1_on = pick(r1_on), p1_off = pick(r1_off)

// Hand-calc references
const p1_vent_loss_full = ventLossMwh(P1_FLOW, 0)                  // airstream heat content
const p1_recovery_max   = p1_vent_loss_full * 0.75                  // what HRE could recover
const p1_state2_vent_at_hre = ventLossMwh(P1_FLOW, 0.75)            // State 2's (1-HRE) contribution

// "Correct single-boundary" Δ delivered when toggling HRE from 0.75 → 0:
//   raw_off uses full vent loss; raw_on uses vent × (1-HRE).
//   raw_off - raw_on = vent × HRE = airstream recovery
//   If engine subtracts recovery once at one boundary: Δdelivered = vent × HRE
//   If engine subtracts at BOTH boundaries: Δdelivered ≈ 2 × vent × HRE (double)
const p1_correct_delta_delivered = p1_recovery_max               // single-boundary expectation
const p1_correct_delta_elec      = p1_recovery_max / P1_SCOP

const p1_engine_delta_delivered = (p1_off.sh_delivered_mwh ?? 0) - (p1_on.sh_delivered_mwh ?? 0)
const p1_engine_delta_elec      = (p1_off.sh_electricity_mwh ?? 0) - (p1_on.sh_electricity_mwh ?? 0)
const p1_engine_delta_total     = ((p1_off.elec_total_kwh ?? 0) - (p1_on.elec_total_kwh ?? 0)) / 1000

console.log('  Engine output:')
console.log('    Quantity                    HRE=0.75      HRE=0         Δ (OFF − ON)')
console.log('    ──────────────────────────────────────────────────────────────────')
console.log(`    raw demand (S2)              ${fmt(p1_on.sh_demand_mwh, 3).padStart(8)}     ${fmt(p1_off.sh_demand_mwh, 3).padStart(8)}     ${fmt((p1_off.sh_demand_mwh ?? 0) - (p1_on.sh_demand_mwh ?? 0), 3).padStart(8)}`)
console.log(`    delivered                   ${fmt(p1_on.sh_delivered_mwh, 3).padStart(8)}     ${fmt(p1_off.sh_delivered_mwh, 3).padStart(8)}     ${fmt(p1_engine_delta_delivered, 3).padStart(8)}`)
console.log(`    recovery_offset             ${fmt(p1_on.sh_recovery_off_mwh, 3).padStart(8)}     ${fmt(p1_off.sh_recovery_off_mwh, 3).padStart(8)}`)
console.log(`    heating electricity         ${fmt(p1_on.sh_electricity_mwh, 3).padStart(8)}     ${fmt(p1_off.sh_electricity_mwh, 3).padStart(8)}     ${fmt(p1_engine_delta_elec, 3).padStart(8)}`)
console.log(`    fan electricity (kWh)       ${fmt(p1_on.vent_fan_kwh, 3).padStart(8)}     ${fmt(p1_off.vent_fan_kwh, 3).padStart(8)}`)
console.log(`    TOTAL electricity (MWh)     ${fmt((p1_on.elec_total_kwh ?? 0) / 1000, 3).padStart(8)}     ${fmt((p1_off.elec_total_kwh ?? 0) / 1000, 3).padStart(8)}     ${fmt(p1_engine_delta_total, 3).padStart(8)}`)
console.log()
console.log('  Hand-calc reference:')
console.log(`    Airstream physical max (vent × HRE):    ${fmt(p1_recovery_max, 3)} MWh`)
console.log(`    Engine effective recovery (HRE=0.75):   ${fmt(p1_on.sh_recovery_off_mwh, 3)} MWh   ${p1_on.sh_recovery_off_mwh > p1_recovery_max * 1.05 ? '⚠ EXCEEDS PHYSICAL CEILING' : '✓ within ceiling'}`)
console.log()
console.log(`    Δ delivered if single-boundary (CORRECT):  ${fmt(p1_correct_delta_delivered, 3)} MWh`)
console.log(`    Δ delivered if DOUBLE-subtracted (BUG):   ${fmt(p1_correct_delta_delivered * 2, 3)} MWh`)
console.log(`    Δ delivered observed:                      ${fmt(p1_engine_delta_delivered, 3)} MWh`)
console.log()
console.log(`    Δ heating elec if single-boundary:         ${fmt(p1_correct_delta_elec, 3)} MWh`)
console.log(`    Δ heating elec if DOUBLE-subtracted:       ${fmt(p1_correct_delta_elec * 2, 3)} MWh`)
console.log(`    Δ heating elec if H2 (uses raw):           ≈ 0`)
console.log(`    Δ heating elec observed:                    ${fmt(p1_engine_delta_elec, 3)} MWh`)
console.log()
console.log(`    Δ TOTAL elec observed:                      ${fmt(p1_engine_delta_total, 3)} MWh`)
console.log(`    (SFP=0 → Δ total elec should = Δ heating elec.  Match? ${Math.abs(p1_engine_delta_total - p1_engine_delta_elec) < 0.01 ? '✓' : '✗'})`)

// Verdict for Probe 1
let p1_verdict = '?'
const ratio = p1_correct_delta_elec > 0.001 ? p1_engine_delta_elec / p1_correct_delta_elec : 0
if (Math.abs(p1_engine_delta_elec) < 0.05) {
  p1_verdict = 'H2 — fuel path does NOT credit recovery (Δheating elec ≈ 0 despite Δrecovery > 0)'
} else if (ratio > 0.8 && ratio < 1.2) {
  p1_verdict = `H1 — single-boundary subtraction. Δ elec ≈ recovery/SCOP (ratio ${ratio.toFixed(2)}). No double-counting on the fuel side.`
} else if (ratio > 1.7 && ratio < 2.3) {
  p1_verdict = `H3 — DOUBLE subtraction. Δ elec ≈ 2 × recovery/SCOP (ratio ${ratio.toFixed(2)}). State 2's (1-HRE) AND State 3's −recovery are both counting.`
} else {
  p1_verdict = `UNCLEAR — ratio ${ratio.toFixed(2)}. Outside expected H1 (≈1.0) / H2 (≈0) / H3 (≈2.0). Manual investigation.`
}
console.log()
console.log(`    PROBE 1 VERDICT: ${p1_verdict}`)
probeResults.probe1 = { p1_on, p1_off, p1_correct_delta_elec, p1_engine_delta_elec, p1_engine_delta_total, p1_recovery_max, ratio, verdict: p1_verdict }

// ════════════════════════════════════════════════════════════════════════
// PROBE 2 — SCOP 3.0 → 4.0, all else fixed
// ════════════════════════════════════════════════════════════════════════
console.log()
console.log('========================================================')
console.log('  PROBE 2 — SCOP 3.0 → 4.0  (HRE=0.75, SFP=0, vent fixed)')
console.log('========================================================')
const r2_s3 = runEngine(makeRefBox({ heatScop: 3.0, ventFlow_l_s: 500, ventHre: 0.75, ventSfp: 0 }), COMFORT)
const r2_s4 = runEngine(makeRefBox({ heatScop: 4.0, ventFlow_l_s: 500, ventHre: 0.75, ventSfp: 0 }), COMFORT)
const p2_s3 = pick(r2_s3), p2_s4 = pick(r2_s4)

const p2_delivered_s3 = p2_s3.sh_delivered_mwh ?? 0
const p2_delivered_s4 = p2_s4.sh_delivered_mwh ?? 0
const p2_expected_elec_s3 = p2_delivered_s3 / 3.0
const p2_expected_elec_s4 = p2_delivered_s4 / 4.0
const p2_engine_elec_s3 = p2_s3.sh_electricity_mwh ?? 0
const p2_engine_elec_s4 = p2_s4.sh_electricity_mwh ?? 0

console.log('  Engine output:')
console.log('    Quantity                    SCOP=3.0      SCOP=4.0')
console.log('    ──────────────────────────────────────────────────')
console.log(`    raw demand (S2)              ${fmt(p2_s3.sh_demand_mwh, 3).padStart(8)}     ${fmt(p2_s4.sh_demand_mwh, 3).padStart(8)}`)
console.log(`    delivered                   ${fmt(p2_delivered_s3, 3).padStart(8)}     ${fmt(p2_delivered_s4, 3).padStart(8)}`)
console.log(`    heating electricity         ${fmt(p2_engine_elec_s3, 3).padStart(8)}     ${fmt(p2_engine_elec_s4, 3).padStart(8)}`)
console.log()
console.log('  Hand-calc check (electricity should = delivered / SCOP):')
console.log(`    Expected elec (SCOP=3.0):    ${fmt(p2_expected_elec_s3, 3)}     Observed: ${fmt(p2_engine_elec_s3, 3)}     Match: ${Math.abs(p2_engine_elec_s3 - p2_expected_elec_s3) < 0.01 ? '✓' : '✗'}`)
console.log(`    Expected elec (SCOP=4.0):    ${fmt(p2_expected_elec_s4, 3)}     Observed: ${fmt(p2_engine_elec_s4, 3)}     Match: ${Math.abs(p2_engine_elec_s4 - p2_expected_elec_s4) < 0.01 ? '✓' : '✗'}`)
console.log(`    Delivered should NOT change with SCOP: Δdelivered = ${fmt(p2_delivered_s4 - p2_delivered_s3, 4)}  (expect 0)`)
const p2_verdict = (Math.abs(p2_engine_elec_s3 - p2_expected_elec_s3) < 0.01 && Math.abs(p2_engine_elec_s4 - p2_expected_elec_s4) < 0.01)
  ? '✓ SCOP correctly applied to delivered'
  : `✗ SCOP NOT applied to delivered — engine elec doesn't match delivered/SCOP. Suspect SCOP applied to wrong quantity.`
console.log()
console.log(`    PROBE 2 VERDICT: ${p2_verdict}`)
probeResults.probe2 = { p2_s3, p2_s4, p2_expected_elec_s3, p2_expected_elec_s4, verdict: p2_verdict }

// ════════════════════════════════════════════════════════════════════════
// PROBE 3 — HRE 0 → 0.75 sweep (linearity + ceiling)
// ════════════════════════════════════════════════════════════════════════
console.log()
console.log('========================================================')
console.log('  PROBE 3 — HRE sweep 0 → 0.75 (vent fixed, SFP=0, SCOP=3.0)')
console.log('========================================================')
const HRE_POINTS = [0.0, 0.25, 0.50, 0.75, 0.90]
const FLOW3 = 500
const ventLossFull = ventLossMwh(FLOW3, 0)
console.log(`  Airstream physical maximum (full vent loss): ${fmt(ventLossFull, 3)} MWh`)
console.log()
console.log('    HRE     recovery_engine    recovery_phys_max   ratio   linear?   exceeds ceiling?')
console.log('    ──────────────────────────────────────────────────────────────────────────')
let p3_max_ratio = 0
let p3_exceeds_ceiling = false
const sweep = []
for (const hre of HRE_POINTS) {
  const r = runEngine(makeRefBox({ heatScop: 3.0, ventFlow_l_s: FLOW3, ventHre: hre, ventSfp: 0 }), COMFORT)
  const p = pick(r)
  const recEngine = p.sh_recovery_off_mwh ?? 0
  const recMax    = ventLossFull * hre
  const ratio     = recMax > 0.001 ? recEngine / recMax : (recEngine === 0 ? 1 : Infinity)
  const exceeds   = hre > 0 && recEngine > ventLossFull * 1.05
  if (ratio > p3_max_ratio && Number.isFinite(ratio)) p3_max_ratio = ratio
  if (exceeds) p3_exceeds_ceiling = true
  sweep.push({ hre, recEngine, recMax, ratio, exceeds, raw: p.sh_demand_mwh, delivered: p.sh_delivered_mwh, elec: p.sh_electricity_mwh })
  console.log(`    ${hre.toFixed(2)}    ${fmt(recEngine, 3).padStart(8)} MWh   ${fmt(recMax, 3).padStart(8)} MWh   ${fmt(ratio, 2).padStart(5)}   ${ratio >= 0.95 && ratio <= 1.05 ? '✓' : '~'}        ${exceeds ? '⚠ YES' : '✓ no'}`)
}
const p3_verdict = p3_exceeds_ceiling
  ? `H3 confirmed at the airstream level — recovery exceeds physical vent loss at some HRE.`
  : (p3_max_ratio >= 0.95 && p3_max_ratio <= 1.05
    ? `✓ Recovery scales linearly with HRE and stays within the airstream ceiling. (Max ratio ${p3_max_ratio.toFixed(2)}.)`
    : `Recovery scales sub-linearly (max ratio ${p3_max_ratio.toFixed(2)}). Per-hour cap is biting — physically reasonable.`)
console.log()
console.log(`    PROBE 3 VERDICT: ${p3_verdict}`)
probeResults.probe3 = { sweep, p3_max_ratio, p3_exceeds_ceiling, verdict: p3_verdict, ventLossFull }

// ════════════════════════════════════════════════════════════════════════
// COMBINED VERDICT
// ════════════════════════════════════════════════════════════════════════
console.log()
console.log('========================================================')
console.log('  COMBINED VERDICT')
console.log('========================================================')
console.log(`  PROBE 1: ${probeResults.probe1.verdict}`)
console.log(`  PROBE 2: ${probeResults.probe2.verdict}`)
console.log(`  PROBE 3: ${probeResults.probe3.verdict}`)
console.log()

let combinedVerdict = ''
if (probeResults.probe1.verdict.startsWith('H3')) {
  combinedVerdict = 'H3 CONFIRMED — recovery is DOUBLE-SUBTRACTED across State 2 + State 3. Fix brief needs to pick which boundary owns the recovery.'
} else if (probeResults.probe1.verdict.startsWith('H2')) {
  combinedVerdict = 'H2 RE-OPENS — fuel path is NOT crediting recovery despite earlier static + Bridgewater evidence. Investigate.'
} else if (probeResults.probe1.verdict.startsWith('H1')) {
  combinedVerdict = 'H1 CONFIRMED via clean fixture — single-boundary subtraction is what the engine does on a no-fan, no-gain box. Bridgewater double-count appearance was an artefact of entangled paths.'
} else {
  combinedVerdict = `Indeterminate — PROBE 1 ratio outside expected ranges. Manual review needed.`
}
console.log(`  >> ${combinedVerdict}`)

// Write JSON summary
const summary = {
  meta: {
    weather_file: WEATHER_FILE,
    dT_integral_K_hours,
    box_gia_m2: BOX_GIA,
    timestamp: new Date().toISOString(),
  },
  probe1: probeResults.probe1,
  probe2: probeResults.probe2,
  probe3: probeResults.probe3,
  combined_verdict: combinedVerdict,
}
const OUT = path.join(REPO_ROOT, 'docs/audit/_brief49_refbox_run.json')
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2))
console.log()
console.log(`  JSON summary: ${path.relative(REPO_ROOT, OUT)}`)
console.log()
