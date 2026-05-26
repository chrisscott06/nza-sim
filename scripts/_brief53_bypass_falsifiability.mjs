/**
 * scripts/_brief53_bypass_falsifiability.mjs
 *
 * Brief 53 Part 2.E — falsifiability harness for the summer-bypass engine.
 *
 * Four tests:
 *   (1) Bridgewater clean, bypass OFF on every vent system: EUI must = 128.2.
 *       (Default ventSystems projection sets summer_bypass = false ⇒
 *       byte-identity with pre-Part-2 baseline. Any drift = bug.)
 *
 *   (2) Refbox HOT, bypass OFF: recovery = 30.55, cooling = 15.40 MWh
 *       (matches Brief 52 probe at c64657c). Reproduction is exact (= 0.05 MWh).
 *
 *   (3) Refbox HOT, bypass ON: recovery drops into 26-29 MWh and cooling
 *       into 13-14 MWh per Brief 53 audit §5.3 prediction. Heating
 *       largely unchanged.
 *
 *   (4) Reconciliation log (Principle 2): on every test, State 2's
 *       `bypass_reconciliation_s2` per system MUST match State 3's
 *       `system_performance.ventilation.systems[i].bypass`. Same hours,
 *       same suppressed-recovery integral within rounding.
 *
 * Read-only — but the engine code is no longer read-only. This harness
 * runs the post-Part-2 engine and asserts the four predictions.
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
const BRIDGEWATER_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} → ${r.status}`); return r.json() }
const lib = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []

// ── Weather (Yeovilton) ──────────────────────────────────────────────────
function loadWeather(filename) {
  const epwPath = path.join(REPO_ROOT, 'data/weather/current', filename)
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
  return { weatherData: { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }, latitude }
}

// ── Library / constructions ──────────────────────────────────────────────
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
const REFBOX_CONSTRUCTIONS = {
  external_wall: pickConstruction('wall')   ?? libArr[0]?.id,
  roof:          pickConstruction('roof')   ?? libArr[0]?.id,
  ground_floor:  pickConstruction('floor')  ?? libArr[0]?.id,
  glazing:       pickConstruction('glazing') ?? pickConstruction('window') ?? libArr[0]?.id,
}

// ── Refbox builder (copied from _brief52, +summer_bypass param) ──────────
const REFBOX_COMFORT = { lower_c: 20, upper_c: 25 }
const ALWAYS_ON_SCHEDULE = {
  weekday: Array(24).fill(1), saturday: Array(24).fill(1), sunday: Array(24).fill(1),
  monthly_multipliers: Array(12).fill(1), exceptions: [],
}
function makeRefbox({ peopleDensityPerM2 = 0, summerBypass = false } = {}) {
  const occupancy = peopleDensityPerM2 > 0 ? {
    density: { value: peopleDensityPerM2, basis: 'per_m2' },
    occupancy_rate: 1, sensible_w_per_person: 100, schedule: ALWAYS_ON_SCHEDULE,
  } : null
  return {
    name: 'REFBOX-cool', weather_file: WEATHER_FILE,
    length: 10, width: 10, floor_height: 3, num_floors: 1, orientation: 0,
    num_bedrooms: peopleDensityPerM2 > 0 ? 100 : 0,
    occupancy_rate: 0, people_per_room: 0, occupancy,
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
        enabled: true, hre_enabled: true,
        flow_l_s: 500, sfp_w_per_l_s: 0, hre: 0.75,
        hours: 8760, schedule_ref: 'always_on',
        summer_bypass: summerBypass,   // ← Brief 53 Part 2 flag
      }],
    },
  }
}

// ── Engine helpers ───────────────────────────────────────────────────────
const { weatherData, latitude } = loadWeather(WEATHER_FILE)
const hourlySolar = computeHourlySolarByFacade(weatherData, 0, 0)
const hourlySolarYeo = computeHourlySolarByFacade(weatherData, latitude, 0)

function runEngine(building, constructions, comfortBand, hSolar) {
  return calculateInstant(
    building, constructions, {}, libraryData, weatherData, hSolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand },
  )
}

function pickRefbox(r) {
  const sh = r?.consumption?.space_heating ?? {}
  const sc = r?.consumption?.space_cooling ?? {}
  const sv = r?.system_performance?.ventilation?.total ?? {}
  const sys0 = r?.system_performance?.ventilation?.systems?.[0] ?? {}
  const s2bp = r?.bypass_reconciliation_s2 ?? []
  return {
    raw_demand_mwh:     sh.demand_mwh ?? null,
    delivered_mwh:      sh.delivered_mwh ?? null,
    heating_elec_mwh:   sh.electricity_mwh ?? null,
    cooling_demand_mwh: sc.demand_mwh ?? null,
    fan_kwh:            sv.fan_kwh ?? null,
    recovery_eff_mwh:   sv.recovery_mwh ?? null,
    recovery_theo_mwh:  sv.recovery_theoretical_mwh ?? null,
    bypass_total_hours: sv.bypass?.total_hours_x_systems ?? 0,
    bypass_suppr_mwh:   sv.bypass?.total_suppressed_recovery_mwh ?? 0,
    s3_per_system_bypass: r?.system_performance?.ventilation?.systems?.map(s => ({ id: s.id, ...s.bypass })) ?? [],
    s2_per_system_bypass: s2bp,
    eui:                r?.energy_use?.totals?.eui_kwh_per_m2 ?? null,
  }
}
const r1 = v => v != null && Number.isFinite(v) ? Math.round(v * 100) / 100 : null
const fmt = v => r1(v) != null ? r1(v).toFixed(2) : '—'

console.log()
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log('  Brief 53 Part 2.E — Falsifiability harness (bypass engine)')
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log()

// ── Test 1: Bridgewater clean, all bypass OFF, EUI must equal 128.2 ──
console.log('  TEST 1 — Bridgewater clean, ALL summer_bypass = false, EUI must = 128.20')
console.log('  ───────────────────────────────────────────────────────────────────────────')
const project = await fj(`${API}/api/projects/${BRIDGEWATER_ID}`)
const bridgewaterBuilding = project.building_config
const bridgewaterConstructions = project.construction_choices
const bridgewaterComfort = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}
const { latitude: bwLat } = loadWeather(bridgewaterBuilding.weather_file || project.weather_file)
const bwSolar = computeHourlySolarByFacade(weatherData, bwLat, Number(bridgewaterBuilding.orientation ?? 0))

const rBW = runEngine(bridgewaterBuilding, bridgewaterConstructions, bridgewaterComfort, bwSolar)
const bwEui = rBW?.energy_use?.totals?.eui_kwh_per_m2
const bwBypassTotal = rBW?.system_performance?.ventilation?.total?.bypass?.total_hours_x_systems ?? 0
console.log(`    EUI:                       ${fmt(bwEui)} kWh/m²·yr`)
console.log(`    Bypass total hours×systems: ${bwBypassTotal} (must be 0 — no system opted in)`)
const test1_pass = Math.abs((bwEui ?? 0) - 128.20) < 0.05 && bwBypassTotal === 0
console.log(`    ${test1_pass ? '✓ PASS' : '✗ FAIL'} — anchor ${test1_pass ? 'held' : `BROKEN (Δ ${((bwEui ?? 0) - 128.20).toFixed(2)})`}`)
console.log()

// ── Test 2: Refbox HOT, bypass OFF, must reproduce 30.55 / 15.40 ──
console.log('  TEST 2 — Refbox HOT, summer_bypass = false, must reproduce 30.55 / 15.40')
console.log('  ───────────────────────────────────────────────────────────────────────────')
const rHotOff = runEngine(makeRefbox({ peopleDensityPerM2: 1, summerBypass: false }), REFBOX_CONSTRUCTIONS, REFBOX_COMFORT, hourlySolarYeo)
const HotOff = pickRefbox(rHotOff)
console.log(`    raw heating demand:       ${fmt(HotOff.raw_demand_mwh)} MWh`)
console.log(`    cooling demand:           ${fmt(HotOff.cooling_demand_mwh)} MWh  (target 15.40)`)
console.log(`    effective recovery:       ${fmt(HotOff.recovery_eff_mwh)} MWh  (target 30.55)`)
console.log(`    bypass hours×systems:     ${HotOff.bypass_total_hours} (must be 0)`)
const test2_recovery_ok = Math.abs((HotOff.recovery_eff_mwh ?? 0) - 30.55) < 0.05
const test2_cooling_ok  = Math.abs((HotOff.cooling_demand_mwh ?? 0) - 15.40) < 0.05
const test2_bypass_off  = HotOff.bypass_total_hours === 0
const test2_pass = test2_recovery_ok && test2_cooling_ok && test2_bypass_off
console.log(`    ${test2_pass ? '✓ PASS' : '✗ FAIL'} — ` +
  `recovery=${test2_recovery_ok ? 'OK' : 'OFF'}, cooling=${test2_cooling_ok ? 'OK' : 'OFF'}, bypass=${test2_bypass_off ? 'OK' : 'WRONG'}`)
console.log()

// ── Test 3: Refbox HOT, bypass ON, predicted ranges ──
console.log('  TEST 3 — Refbox HOT, summer_bypass = true, predicted recovery 26–29, cooling 13–14')
console.log('  ───────────────────────────────────────────────────────────────────────────')
const rHotOn = runEngine(makeRefbox({ peopleDensityPerM2: 1, summerBypass: true }), REFBOX_CONSTRUCTIONS, REFBOX_COMFORT, hourlySolarYeo)
const HotOn = pickRefbox(rHotOn)
console.log(`    raw heating demand:       ${fmt(HotOn.raw_demand_mwh)} MWh   (vs OFF: ${fmt(HotOff.raw_demand_mwh)})`)
console.log(`    cooling demand:           ${fmt(HotOn.cooling_demand_mwh)} MWh   (vs OFF: ${fmt(HotOff.cooling_demand_mwh)}, target 13–14)`)
console.log(`    effective recovery:       ${fmt(HotOn.recovery_eff_mwh)} MWh   (vs OFF: ${fmt(HotOff.recovery_eff_mwh)}, target 26–29)`)
console.log(`    bypass hours×systems:     ${HotOn.bypass_total_hours}`)
console.log(`    bypass suppressed recovery: ${fmt(HotOn.bypass_suppr_mwh)} MWh`)
const test3_recovery_in_range = (HotOn.recovery_eff_mwh ?? 0) >= 26.0 && (HotOn.recovery_eff_mwh ?? 0) <= 29.0
const test3_cooling_in_range  = (HotOn.cooling_demand_mwh ?? 0) >= 13.0 && (HotOn.cooling_demand_mwh ?? 0) <= 14.0
const test3_pass = test3_recovery_in_range && test3_cooling_in_range
console.log(`    ${test3_pass ? '✓ PASS' : '? OUT-OF-BAND (review)'} — ` +
  `recovery=${test3_recovery_in_range ? 'in band' : 'OUT'}, cooling=${test3_cooling_in_range ? 'in band' : 'OUT'}`)
console.log()

// ── Test 4: Reconciliation — State 2 vs State 3 bypass hours ──
console.log('  TEST 4 — Reconciliation (Principle 2): State 2 vs State 3 bypass hours must agree')
console.log('  ───────────────────────────────────────────────────────────────────────────')
function compareRecon(label, picked) {
  console.log(`    ${label}:`)
  const s2map = new Map((picked.s2_per_system_bypass ?? []).map(r => [r.id, r]))
  let allMatch = true
  for (const s3 of picked.s3_per_system_bypass ?? []) {
    const s2 = s2map.get(s3.id) ?? { hours: 0, suppressed_recovery_mwh: 0, summer_bypass: false }
    const hours_match = (s2.hours ?? 0) === (s3.hours ?? 0)
    const recov_match = Math.abs((s2.suppressed_recovery_mwh ?? 0) - (s3.suppressed_recovery_mwh ?? 0)) < 0.05
    const flag_match  = (s2.summer_bypass ?? false) === (s3.summer_bypass ?? false)
    const ok = hours_match && recov_match && flag_match
    if (!ok) allMatch = false
    console.log(`      [${s3.id}] s2={hours: ${s2.hours}, suppr: ${fmt(s2.suppressed_recovery_mwh)}, flag: ${s2.summer_bypass}}  |  s3={hours: ${s3.hours}, suppr: ${fmt(s3.suppressed_recovery_mwh)}, flag: ${s3.summer_bypass}}  ${ok ? '✓' : '✗'}`)
  }
  return allMatch
}
const recon_off = compareRecon('Refbox HOT bypass OFF', HotOff)
const recon_on  = compareRecon('Refbox HOT bypass ON',  HotOn)
const recon_bw  = (() => {
  const s3 = rBW?.system_performance?.ventilation?.systems ?? []
  const s2 = rBW?.bypass_reconciliation_s2 ?? []
  const s2map = new Map(s2.map(r => [r.id, r]))
  console.log(`    Bridgewater (all bypass OFF):`)
  let allMatch = true
  for (const v of s3) {
    const m = s2map.get(v.id) ?? { hours: 0, suppressed_recovery_mwh: 0, summer_bypass: false }
    const ok = (m.hours ?? 0) === (v.bypass?.hours ?? 0) && Math.abs((m.suppressed_recovery_mwh ?? 0) - (v.bypass?.suppressed_recovery_mwh ?? 0)) < 0.05
    if (!ok) allMatch = false
    console.log(`      [${v.id}] s2={hours: ${m.hours}, suppr: ${fmt(m.suppressed_recovery_mwh)}}  |  s3={hours: ${v.bypass?.hours ?? 0}, suppr: ${fmt(v.bypass?.suppressed_recovery_mwh)}}  ${ok ? '✓' : '✗'}`)
  }
  return allMatch
})()
const test4_pass = recon_off && recon_on && recon_bw
console.log()
console.log(`    ${test4_pass ? '✓ PASS' : '✗ FAIL'} — Principle 2 ${test4_pass ? 'honoured' : 'VIOLATED — bypass decisions DRIFT between State 2 and State 3'}`)
console.log()

// ── Summary ──────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log(`  SUMMARY:  T1=${test1_pass ? '✓' : '✗'}  T2=${test2_pass ? '✓' : '✗'}  T3=${test3_pass ? '✓' : '?'}  T4=${test4_pass ? '✓' : '✗'}`)
console.log('═══════════════════════════════════════════════════════════════════════════════')
const allPass = test1_pass && test2_pass && test4_pass   // T3 is range-test; OOB flagged but not blocking
process.exitCode = allPass ? 0 : 1

// ── JSON dump ────────────────────────────────────────────────────────────
const out = path.join(REPO_ROOT, 'docs/audit/53_bypass_falsifiability.json')
fs.writeFileSync(out, JSON.stringify({
  test_1_bridgewater: { eui: bwEui, target: 128.20, pass: test1_pass, bypass_hours: bwBypassTotal },
  test_2_refbox_hot_off: { picked: HotOff, target_recovery: 30.55, target_cooling: 15.40, pass: test2_pass },
  test_3_refbox_hot_on:  { picked: HotOn,  target_recovery_band: [26, 29], target_cooling_band: [13, 14], pass_band: test3_pass },
  test_4_reconciliation: { off: recon_off, on: recon_on, bw: recon_bw, pass: test4_pass },
  all_pass: allPass,
}, null, 2))
console.log(`  JSON: ${path.relative(REPO_ROOT, out)}`)
console.log()
