/**
 * scripts/state3_part5_engine_inputs_test.mjs
 *
 * Brief 28f Part 5.1 + 5.2 — engine input surfacing:
 *   5.1 DHW formula parameters as project inputs
 *   5.2 Ventilation schedule_ref lookup against State 2 schedule infrastructure
 *
 * Tests:
 *   T1 — DHW byte-identity at defaults (80/60/10) vs Part 4 ship values
 *   T2 — DHW scales correctly with non-default litres_per_person_per_day
 *   T3 — DHW scales correctly with non-default store_temperature_c
 *   T4 — DHW scales correctly with non-default cold_mains_temperature_c
 *   T5 — DHW demand = 0 when store ≤ cold mains (clamping)
 *   T6 — Ventilation schedule_ref = 'always_on' → hours_active = 8760 (regression)
 *   T7 — Ventilation schedule_ref = absent (null/undefined) → hours_active = 8760
 *   T8 — Ventilation schedule_ref = profile id resolves; hours_active reflects
 *        the profile's mean schedule fraction
 *   T9 — Ventilation fan_kwh scales linearly with hours_active reduction
 *   T10 — Ventilation HRE recovery scales by schedule_factor (hours_active/8760)
 *   T11 — Unresolved schedule_ref falls back to 8760 + warning visible via
 *         schedule_source === 'unresolved_fallback'
 *
 * Usage:
 *   node scripts/state3_part5_engine_inputs_test.mjs [project_id]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const PROJECT_ID = process.argv[2] || '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} → ${r.status}`); return r.json() }

const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const lib = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []
const constructions = project.construction_choices
const comfortBand = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}
// Strip systems_config_v25 from the test base; tests construct their own.
const buildingBase = { ...project.building_config, systems_config_v25: undefined }

const weatherFile = buildingBase.weather_file || project.weather_file
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

// All templates from the canonical library (Brief 28f Part 5.3 ship).
// Part 5.1 + 5.2 tests only need DHW templates, but importing the whole
// library is harmless and keeps the test in sync with library updates.
const SYSTEM_TEMPLATES = SYSTEM_TEMPLATES_LIBRARY

function libraryDataWith(templates) {
  return {
    constructions: libArr.map(c => ({
      name: c.name,
      u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
      y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
      g_value: c.config_json?.g_value,
      config_json: c.config_json ?? c,
      layers: c.layers,
    })),
    system_templates: templates,
  }
}

function runState3(building, templates = SYSTEM_TEMPLATES) {
  const ld = libraryDataWith(templates)
  const orientation = building.orientation ?? 0
  const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, orientation)
  return calculateInstant(
    building, constructions, {}, ld,
    weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand },
  )
}

let testsRun = 0, testsPassed = 0, testsFailed = 0
function record(name, passed, detail = '') {
  testsRun++
  if (passed) { testsPassed++; console.log(`  ✓ ${name}${detail ? '  —  ' + detail : ''}`) }
  else        { testsFailed++; console.log(`  ✗ ${name}${detail ? '  —  ' + detail : ''}`) }
}
function within(actual, target, pct = 0.005) {
  if (target === 0) return Math.abs(actual) < 0.5
  return Math.abs(actual - target) / Math.abs(target) <= pct
}
function fmt(x, dp = 2) { return Number(x).toFixed(dp) }

const DHW_PRIMARY_DHW_CFG = {
  primary:           { library_id: 'ashp_dhw_preheat' },
  secondary:         { library_id: 'gas_boiler_calorifier' },
  primary_pct:       60,
  circulation_pump_w: 120,
}

console.log()
console.log('=== Brief 28f Parts 5.1 + 5.2: engine input surfacing tests ===')

// ── Test 1: DHW byte-identity at defaults ───────────────────────────────────
console.log()
console.log('Test 1 — DHW byte-identity at defaults (80 L / 60 °C / 10 °C)')
{
  const result_explicit = runState3({
    ...buildingBase,
    systems_config: {
      dhw: {
        ...DHW_PRIMARY_DHW_CFG,
        litres_per_person_per_day:  80,
        store_temperature_c:        60,
        cold_mains_temperature_c:   10,
      },
    },
  })
  const result_implicit = runState3({
    ...buildingBase,
    systems_config: { dhw: { ...DHW_PRIMARY_DHW_CFG } },     // defaults omitted entirely
  })
  console.log(`  explicit defaults DHW demand: ${result_explicit.system_performance.dhw.total.delivered_mwh} MWh`)
  console.log(`  implicit defaults DHW demand: ${result_implicit.system_performance.dhw.total.delivered_mwh} MWh`)
  record('explicit defaults match implicit defaults byte-identically',
    result_explicit.system_performance.dhw.total.delivered_mwh === result_implicit.system_performance.dhw.total.delivered_mwh)
  // Hand-calc verification: DHW demand = annual_occupant_hours × 0.1935 / 1000.
  // (Was previously a brittle "== 306.785 MWh" hardcoded check; updated
  // 2026-05-15 to test the formula invariant after the Xmas-exception fix
  // changed Bridgewater's annual occupant hours.)
  const occHours = result_implicit.occupancy_summary?.annual_occupant_hours ?? 0
  const KWH_PER_PERSON_HOUR_DEFAULT = 80 * (60 - 10) * 4.18 / 3600 / 24
  const handDemandMwh = occHours * KWH_PER_PERSON_HOUR_DEFAULT / 1000
  record('DHW demand at defaults === annual_occupant_hours × 0.1935 kWh/p/h (formula invariant)',
    Math.abs(result_implicit.system_performance.dhw.total.delivered_mwh - handDemandMwh) < 0.02)
}

// ── Test 2: DHW scales with litres_per_person_per_day ───────────────────────
console.log()
console.log('Test 2 — DHW scales with litres_per_person_per_day')
{
  const baseline = runState3({
    ...buildingBase,
    systems_config: { dhw: { ...DHW_PRIMARY_DHW_CFG } },
  })
  const doubled = runState3({
    ...buildingBase,
    systems_config: { dhw: { ...DHW_PRIMARY_DHW_CFG, litres_per_person_per_day: 160 } },
  })
  const ratio = doubled.system_performance.dhw.total.delivered_mwh / baseline.system_performance.dhw.total.delivered_mwh
  console.log(`  baseline 80 L/p/day: ${baseline.system_performance.dhw.total.delivered_mwh} MWh`)
  console.log(`  160 L/p/day:         ${doubled.system_performance.dhw.total.delivered_mwh} MWh    ratio=${fmt(ratio, 4)} (expected 2.0)`)
  record('DHW demand doubles when L/p/day doubles', within(ratio, 2.0, 0.001))

  const half = runState3({
    ...buildingBase,
    systems_config: { dhw: { ...DHW_PRIMARY_DHW_CFG, litres_per_person_per_day: 40 } },
  })
  const halfRatio = half.system_performance.dhw.total.delivered_mwh / baseline.system_performance.dhw.total.delivered_mwh
  console.log(`  40 L/p/day:          ${half.system_performance.dhw.total.delivered_mwh} MWh    ratio=${fmt(halfRatio, 4)} (expected 0.5)`)
  record('DHW demand halves when L/p/day halves',  within(halfRatio, 0.5, 0.001))
}

// ── Test 3: DHW scales with store_temperature_c ─────────────────────────────
console.log()
console.log('Test 3 — DHW scales with store_temperature_c (ΔT = store − cold_mains)')
{
  // Default: store 60, cold 10 → ΔT = 50.
  // Store 35, cold 10 → ΔT = 25. Ratio = 25/50 = 0.5.
  const baseline = runState3({
    ...buildingBase,
    systems_config: { dhw: { ...DHW_PRIMARY_DHW_CFG } },
  })
  const lowerStore = runState3({
    ...buildingBase,
    systems_config: { dhw: { ...DHW_PRIMARY_DHW_CFG, store_temperature_c: 35 } },
  })
  const ratio = lowerStore.system_performance.dhw.total.delivered_mwh / baseline.system_performance.dhw.total.delivered_mwh
  console.log(`  store 60 °C: ${baseline.system_performance.dhw.total.delivered_mwh} MWh`)
  console.log(`  store 35 °C: ${lowerStore.system_performance.dhw.total.delivered_mwh} MWh    ratio=${fmt(ratio, 4)} (expected 0.5)`)
  record('DHW demand scales (store−cold)/50 with store_temperature_c', within(ratio, 0.5, 0.001))
}

// ── Test 4: DHW scales with cold_mains_temperature_c ────────────────────────
console.log()
console.log('Test 4 — DHW scales with cold_mains_temperature_c')
{
  // store 60, cold 10 → ΔT 50. cold 5 → ΔT 55. Ratio 55/50 = 1.1.
  const baseline = runState3({
    ...buildingBase,
    systems_config: { dhw: { ...DHW_PRIMARY_DHW_CFG } },
  })
  const colderMains = runState3({
    ...buildingBase,
    systems_config: { dhw: { ...DHW_PRIMARY_DHW_CFG, cold_mains_temperature_c: 5 } },
  })
  const ratio = colderMains.system_performance.dhw.total.delivered_mwh / baseline.system_performance.dhw.total.delivered_mwh
  console.log(`  cold 10 °C: ${baseline.system_performance.dhw.total.delivered_mwh} MWh`)
  console.log(`  cold  5 °C: ${colderMains.system_performance.dhw.total.delivered_mwh} MWh    ratio=${fmt(ratio, 4)} (expected 1.1)`)
  record('DHW demand scales 55/50 = 1.1 when cold mains drops from 10 to 5', within(ratio, 1.1, 0.001))
}

// ── Test 5: DHW clamps to 0 when store ≤ cold ────────────────────────────────
console.log()
console.log('Test 5 — DHW demand clamps to 0 when store ≤ cold mains (ΔT non-negative)')
{
  const result = runState3({
    ...buildingBase,
    systems_config: { dhw: { ...DHW_PRIMARY_DHW_CFG, store_temperature_c: 10, cold_mains_temperature_c: 10 } },
  })
  console.log(`  store=cold=10 °C: DHW demand=${result.system_performance.dhw.total.delivered_mwh}, fuel=${result.system_performance.dhw.total.fuel_mwh}`)
  record('DHW demand === 0 when ΔT === 0', result.system_performance.dhw.total.delivered_mwh === 0)
  record('DHW fuel === 0 when demand === 0', result.system_performance.dhw.total.fuel_mwh === 0)
  // Circulation pump still runs (independent of demand)
  record('circulation pump still runs even with zero DHW demand',
    result.system_performance.dhw.circulation_pump_kwh > 0)
}

// ── Test 6 + 7: schedule_ref 'always_on' / absent → 8760 ────────────────────
console.log()
console.log('Test 6 + 7 — Ventilation schedule_ref = "always_on" / absent → hours_active = 8760')
{
  const explicit = runState3({
    ...buildingBase,
    systems_config: {
      ventilation: [{ id: 'AHU_explicit', flow_l_s: 1000, sfp_w_per_l_s: 1.0, hre: 0, schedule_ref: 'always_on' }],
    },
  })
  const implicit = runState3({
    ...buildingBase,
    systems_config: {
      ventilation: [{ id: 'AHU_implicit', flow_l_s: 1000, sfp_w_per_l_s: 1.0, hre: 0 /* no schedule_ref */ }],
    },
  })
  const e = explicit.system_performance.ventilation.systems[0]
  const i = implicit.system_performance.ventilation.systems[0]
  console.log(`  schedule_ref='always_on': hours_active=${e.hours_active}, source=${e.schedule_source}`)
  console.log(`  schedule_ref absent:      hours_active=${i.hours_active}, source=${i.schedule_source}`)
  record("'always_on' → hours_active === 8760",          e.hours_active === 8760)
  record("'always_on' → schedule_source === 'always_on'", e.schedule_source === 'always_on')
  record('absent → hours_active === 8760',                i.hours_active === 8760)
  record("absent → schedule_source === 'always_on'",      i.schedule_source === 'always_on')
}

// ── Test 8: schedule_ref = profile id resolves ──────────────────────────────
console.log()
console.log('Test 8 — schedule_ref = profile id resolves; hours_active reflects mean fraction')
{
  // Pull an existing lighting profile id from Bridgewater's State 2 config.
  const lightingProfile0 = buildingBase?.gains?.lighting?.profiles?.[0]
  if (!lightingProfile0?.id) {
    console.log('  Skipping — no lighting profile available on this project')
  } else {
    const profileId = lightingProfile0.id
    const sched = lightingProfile0.schedule
    const avg = arr => (Array.isArray(arr) && arr.length > 0)
      ? arr.reduce((s, v) => s + Number(v ?? 0), 0) / arr.length : 0
    const wkAvg = avg(sched?.weekday)
    const satAvg = avg(sched?.saturday ?? sched?.weekday)
    const sunAvg = avg(sched?.sunday   ?? sched?.saturday ?? sched?.weekday)
    const expected_hours = 24 * (261 * wkAvg + 52 * satAvg + 52 * sunAvg)
    console.log(`  Resolving against lighting profile id="${profileId}"`)
    console.log(`  Mean fractions  wk=${fmt(wkAvg, 3)}  sat=${fmt(satAvg, 3)}  sun=${fmt(sunAvg, 3)}`)
    console.log(`  Expected hours_active ≈ ${Math.round(expected_hours)} (vs 8760 always-on)`)

    const result = runState3({
      ...buildingBase,
      systems_config: {
        ventilation: [{ id: 'AHU_profiled', flow_l_s: 1000, sfp_w_per_l_s: 1.0, hre: 0, schedule_ref: profileId }],
      },
    })
    const v = result.system_performance.ventilation.systems[0]
    console.log(`  Engine hours_active=${v.hours_active}, source=${v.schedule_source}`)
    record('schedule_source === "profile"', v.schedule_source === 'profile')
    record('hours_active matches weighted-day-count formula within 1%',
      Math.abs(v.hours_active - expected_hours) / Math.max(expected_hours, 1) < 0.01)
    record('hours_active < 8760 (profile is not always-on)', v.hours_active < 8760)
  }
}

// ── Test 9: fan_kwh scales linearly with hours_active reduction ─────────────
console.log()
console.log('Test 9 — Ventilation fan_kwh scales linearly with hours_active reduction')
{
  const alwaysOn = runState3({
    ...buildingBase,
    systems_config: {
      ventilation: [{ id: 'AHU', flow_l_s: 1000, sfp_w_per_l_s: 1.0, hre: 0, schedule_ref: 'always_on' }],
    },
  })
  const lightingProfile0 = buildingBase?.gains?.lighting?.profiles?.[0]
  if (lightingProfile0?.id) {
    const profiled = runState3({
      ...buildingBase,
      systems_config: {
        ventilation: [{ id: 'AHU', flow_l_s: 1000, sfp_w_per_l_s: 1.0, hre: 0, schedule_ref: lightingProfile0.id }],
      },
    })
    const v1 = alwaysOn.system_performance.ventilation.systems[0]
    const v2 = profiled.system_performance.ventilation.systems[0]
    const fan_ratio_expected   = v2.hours_active / v1.hours_active
    const fan_ratio_actual     = v2.fan_kwh / v1.fan_kwh
    console.log(`  always-on fan ${v1.fan_kwh} kWh; profiled fan ${v2.fan_kwh} kWh`)
    console.log(`  Expected ratio = hours_active ratio = ${fmt(fan_ratio_expected, 4)};   Actual fan ratio = ${fmt(fan_ratio_actual, 4)}`)
    record('fan_kwh ratio === hours_active ratio (within 0.1%)',
      Math.abs(fan_ratio_actual - fan_ratio_expected) < 0.001)
  } else {
    console.log('  Skipping — no lighting profile available')
  }
}

// ── Test 10: HRE recovery scales by schedule_factor ─────────────────────────
console.log()
console.log('Test 10 — HRE recovery scales by schedule_factor (hours_active / 8760)')
{
  const lightingProfile0 = buildingBase?.gains?.lighting?.profiles?.[0]
  if (!lightingProfile0?.id) {
    console.log('  Skipping — no lighting profile available')
  } else {
    const alwaysOn = runState3({
      ...buildingBase,
      systems_config: {
        ventilation: [{ id: 'MVHR', flow_l_s: 1450, sfp_w_per_l_s: 1.4, hre: 0.8, schedule_ref: 'always_on' }],
      },
    })
    const profiled = runState3({
      ...buildingBase,
      systems_config: {
        ventilation: [{ id: 'MVHR', flow_l_s: 1450, sfp_w_per_l_s: 1.4, hre: 0.8, schedule_ref: lightingProfile0.id }],
      },
    })
    const v1 = alwaysOn.system_performance.ventilation.systems[0]
    const v2 = profiled.system_performance.ventilation.systems[0]
    const schedule_factor      = v2.hours_active / v1.hours_active
    // Brief 28j: comparing THEORETICAL (uncapped) recovery against schedule
    // factor is the meaningful linearity test. The effective recovery
    // (recovery_mwh) goes through the per-hour cap, which is non-linear in
    // schedule_factor (cap binds in some hours and not others). Theoretical
    // recovery is the pre-cap annual integral that scales linearly with
    // schedule_factor — that's what this test validates.
    const theoretical_ratio = v2.theoretical_recovery_mwh / v1.theoretical_recovery_mwh
    const effective_ratio   = v2.recovery_mwh / v1.recovery_mwh
    console.log(`  always-on theoretical ${v1.theoretical_recovery_mwh} MWh; profiled theoretical ${v2.theoretical_recovery_mwh} MWh`)
    console.log(`  always-on effective   ${v1.recovery_mwh} MWh; profiled effective   ${v2.recovery_mwh} MWh`)
    console.log(`  schedule_factor = ${fmt(schedule_factor, 4)};   theoretical_ratio = ${fmt(theoretical_ratio, 4)};   effective_ratio = ${fmt(effective_ratio, 4)}`)
    record('theoretical recovery ratio === schedule_factor (within 0.1%)',
      Math.abs(theoretical_ratio - schedule_factor) < 0.001)
    record('effective recovery scales monotonically with schedule_factor (<= 1)',
      effective_ratio > 0 && effective_ratio <= 1.001)
  }
}

// ── Test 11: unresolved schedule_ref → fallback + diagnostic ────────────────
console.log()
console.log('Test 11 — Unresolved schedule_ref → 8760 fallback + schedule_source diagnostic')
{
  const result = runState3({
    ...buildingBase,
    systems_config: {
      ventilation: [{ id: 'AHU_bad', flow_l_s: 1000, sfp_w_per_l_s: 1.0, hre: 0, schedule_ref: 'does_not_exist_xyz' }],
    },
  })
  const v = result.system_performance.ventilation.systems[0]
  console.log(`  schedule_ref='does_not_exist_xyz': hours_active=${v.hours_active}, source=${v.schedule_source}`)
  record('unresolved schedule_ref falls back to hours_active === 8760',  v.hours_active === 8760)
  record('schedule_source === "unresolved_fallback" (diagnosable)',       v.schedule_source === 'unresolved_fallback')
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log()
console.log('─'.repeat(70))
console.log(`Tests run: ${testsRun}    Passed: ${testsPassed}    Failed: ${testsFailed}`)
console.log('─'.repeat(70))
if (testsFailed > 0) process.exit(1)
