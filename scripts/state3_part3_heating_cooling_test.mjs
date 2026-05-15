/**
 * scripts/state3_part3_heating_cooling_test.mjs
 *
 * Brief 28f Part 3 verification — heating + cooling primary + secondary
 * energy math.
 *
 * Bridgewater system config (per Chris's scope):
 *   Heating primary:   VRF        SCOP 5.12  @ 95%
 *   Heating secondary: Electric   COP  1.00  @  5%
 *   Cooling primary:   VRF        SEER 3.51  @ 95%
 *   Cooling secondary: DX splits  SEER 5.62  @  5%
 *
 * Tests:
 *   T1 — Hand-calc agreement on Bridgewater at ±2%
 *        Heating demand 11.5 MWh, cooling demand 252.8 MWh (State 2 outputs).
 *        Compare engine output vs hand-calc:
 *          delivered_mwh = demand × pct/100
 *          fuel_mwh      = delivered_mwh / efficiency
 *   T2 — Ideal-loads regression: SCOP=1.0 (single primary at 100%, no
 *        secondary) → energy_use.electricity.heating.total ===
 *        State 2 heating_demand_mwh × 1000. Same for cooling.
 *   T3 — A1 sensitivity (double length): demand scales ~2x, fuel scales
 *        ~2x, primary_pct unchanged at 95%, secondary at 5%.
 *   T4 — A2 sensitivity (rotate 90°): demand redistributes, fuel
 *        redistributes consistently, primary_pct unchanged at 95%.
 *   T5 — Per-fuel split: gas primary + electric secondary heating →
 *        energy_use.gas.heating.primary > 0, energy_use.electricity
 *        .heating.secondary > 0.
 *
 * Usage:
 *   node scripts/state3_part3_heating_cooling_test.mjs [project_id]
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

async function fj(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

// ── Load project + library + weather ─────────────────────────────────────────
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

// Bridgewater system templates: imported from the canonical library file.
// Part 3 uses the dual-function VRF as primary for BOTH heating and cooling
// (one physical system serves both jobs — same library_id appears in both
// systems.heating.primary AND systems.cooling.primary). Verified in Part 2
// test 6 that dual-function is supported. Hand-calc unchanged from inline
// templates because heating_scop and cooling_seer match (5.12 / 3.51).
const SYSTEM_TEMPLATES_BRIDGEWATER = SYSTEM_TEMPLATES_LIBRARY

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

function runState3(building, templates) {
  const ld = libraryDataWith(templates)
  const orientation = building.orientation ?? 0
  const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, orientation)
  return calculateInstant(
    building, constructions, {}, ld,
    weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand },
  )
}

const BRIDGEWATER_SYSTEMS = {
  heating: {
    primary:     { library_id: 'vrf_heat_recovery_dual_function' },
    secondary:   { library_id: 'electric_panel_heater' },
    primary_pct: 95,
    setpoint_c:  21,
  },
  cooling: {
    primary:     { library_id: 'vrf_heat_recovery_dual_function' },
    secondary:   { library_id: 'dx_split_cooling' },
    primary_pct: 95,
    setpoint_c:  25,
  },
}

// ── Test helpers ─────────────────────────────────────────────────────────────
let testsRun = 0, testsPassed = 0, testsFailed = 0
function record(name, passed, detail = '') {
  testsRun++
  if (passed) { testsPassed++; console.log(`  ✓ ${name}${detail ? '  —  ' + detail : ''}`) }
  else        { testsFailed++; console.log(`  ✗ ${name}${detail ? '  —  ' + detail : ''}`) }
}
function within(actual, target, pct = 0.02, label = '') {
  if (target === 0) return Math.abs(actual) < 0.5     // 0.5 kWh tolerance on zero
  const delta = Math.abs(actual - target) / Math.abs(target)
  return delta <= pct
}
function fmt(x, dp = 1) { return Number(x).toFixed(dp) }

console.log()
console.log('=== Brief 28f Part 3: heating + cooling energy math ===')

// ── Test 1: Hand-calc on Bridgewater ─────────────────────────────────────────
console.log()
console.log('Test 1 — Hand-calc agreement on Bridgewater (±2%)')
{
  const result = runState3(
    { ...buildingBase, systems_config: BRIDGEWATER_SYSTEMS },
    SYSTEM_TEMPLATES_BRIDGEWATER,
  )

  const heat_demand_mwh = result.demand.heating_demand_mwh   // State 2 number, rounded to 0.1
  const cool_demand_mwh = result.demand.cooling_demand_mwh
  console.log(`  State 2 heating demand: ${heat_demand_mwh} MWh   cooling demand: ${cool_demand_mwh} MWh`)

  // Hand-calc (per Chris's spec):
  //   heat primary:   delivered = 11.5 × 0.95 = 10.925 MWh    fuel = 10.925 / 5.12 = 2.134 MWh
  //   heat secondary: delivered = 11.5 × 0.05 =  0.575 MWh    fuel =  0.575 / 1.00 = 0.575 MWh
  //   heat total:                   11.500 MWh                    2.709 MWh
  //   cool primary:   delivered = 252.8 × 0.95 = 240.16 MWh   fuel = 240.16 / 3.51 = 68.421 MWh
  //   cool secondary: delivered = 252.8 × 0.05 = 12.64 MWh    fuel =  12.64 / 5.62 =  2.249 MWh
  //   cool total:                   252.80 MWh                    70.670 MWh
  const hand_heat_prim_del = heat_demand_mwh * 0.95
  const hand_heat_prim_fuel = hand_heat_prim_del / 5.12
  const hand_heat_sec_del = heat_demand_mwh * 0.05
  const hand_heat_sec_fuel = hand_heat_sec_del / 1.00
  const hand_heat_total_del = hand_heat_prim_del + hand_heat_sec_del
  const hand_heat_total_fuel = hand_heat_prim_fuel + hand_heat_sec_fuel
  const hand_cool_prim_del = cool_demand_mwh * 0.95
  const hand_cool_prim_fuel = hand_cool_prim_del / 3.51
  const hand_cool_sec_del = cool_demand_mwh * 0.05
  const hand_cool_sec_fuel = hand_cool_sec_del / 5.62
  const hand_cool_total_del = hand_cool_prim_del + hand_cool_sec_del
  const hand_cool_total_fuel = hand_cool_prim_fuel + hand_cool_sec_fuel

  const sp = result.system_performance
  console.log(`  Hand:   heat.prim   del=${fmt(hand_heat_prim_del, 3)}  fuel=${fmt(hand_heat_prim_fuel, 3)}     Engine: del=${sp.heating.primary?.delivered_mwh}  fuel=${sp.heating.primary?.fuel_mwh}`)
  console.log(`  Hand:   heat.sec    del=${fmt(hand_heat_sec_del, 3)}   fuel=${fmt(hand_heat_sec_fuel, 3)}      Engine: del=${sp.heating.secondary?.delivered_mwh}  fuel=${sp.heating.secondary?.fuel_mwh}`)
  console.log(`  Hand:   heat.total  del=${fmt(hand_heat_total_del, 3)}  fuel=${fmt(hand_heat_total_fuel, 3)}     Engine: del=${sp.heating.total.delivered_mwh}  fuel=${sp.heating.total.fuel_mwh}`)
  console.log(`  Hand:   cool.prim   del=${fmt(hand_cool_prim_del, 3)} fuel=${fmt(hand_cool_prim_fuel, 3)}   Engine: del=${sp.cooling.primary?.delivered_mwh}  fuel=${sp.cooling.primary?.fuel_mwh}`)
  console.log(`  Hand:   cool.sec    del=${fmt(hand_cool_sec_del, 3)}  fuel=${fmt(hand_cool_sec_fuel, 3)}     Engine: del=${sp.cooling.secondary?.delivered_mwh}  fuel=${sp.cooling.secondary?.fuel_mwh}`)
  console.log(`  Hand:   cool.total  del=${fmt(hand_cool_total_del, 3)} fuel=${fmt(hand_cool_total_fuel, 3)}   Engine: del=${sp.cooling.total.delivered_mwh}  fuel=${sp.cooling.total.fuel_mwh}`)

  // ±2% on every system_performance row
  record('heating.primary.delivered_mwh within 2%',   within(sp.heating.primary.delivered_mwh,   hand_heat_prim_del,  0.02))
  record('heating.primary.fuel_mwh within 2%',        within(sp.heating.primary.fuel_mwh,        hand_heat_prim_fuel, 0.02))
  record('heating.primary.avg_cop_or_eff === 5.12',   sp.heating.primary.avg_cop_or_eff === 5.12)
  record('heating.primary.fuel === "electricity"',    sp.heating.primary.fuel === 'electricity')
  record('heating.secondary.delivered_mwh within 2%', within(sp.heating.secondary.delivered_mwh, hand_heat_sec_del,   0.02))
  record('heating.secondary.fuel_mwh within 2%',      within(sp.heating.secondary.fuel_mwh,      hand_heat_sec_fuel,  0.02))
  record('heating.secondary.avg_cop_or_eff === 1.0',  sp.heating.secondary.avg_cop_or_eff === 1.0)
  record('heating.total.delivered_mwh within 2%',     within(sp.heating.total.delivered_mwh,     hand_heat_total_del, 0.02))
  record('heating.total.fuel_mwh within 2%',          within(sp.heating.total.fuel_mwh,          hand_heat_total_fuel, 0.02))

  record('cooling.primary.delivered_mwh within 2%',   within(sp.cooling.primary.delivered_mwh,   hand_cool_prim_del,  0.02))
  record('cooling.primary.fuel_mwh within 2%',        within(sp.cooling.primary.fuel_mwh,        hand_cool_prim_fuel, 0.02))
  record('cooling.primary.avg_cop_or_eff === 3.51',   sp.cooling.primary.avg_cop_or_eff === 3.51)
  record('cooling.secondary.delivered_mwh within 2%', within(sp.cooling.secondary.delivered_mwh, hand_cool_sec_del,   0.02))
  record('cooling.secondary.fuel_mwh within 2%',      within(sp.cooling.secondary.fuel_mwh,      hand_cool_sec_fuel,  0.02))
  record('cooling.secondary.avg_cop_or_eff === 5.62', sp.cooling.secondary.avg_cop_or_eff === 5.62)
  record('cooling.total.delivered_mwh within 2%',     within(sp.cooling.total.delivered_mwh,     hand_cool_total_del, 0.02))
  record('cooling.total.fuel_mwh within 2%',          within(sp.cooling.total.fuel_mwh,          hand_cool_total_fuel, 0.02))

  // energy_use leaves (kWh) — same numbers ×1000
  const eu = result.energy_use
  record('energy_use.electricity.heating.primary within 2% of hand-calc',     within(eu.electricity.heating.primary,   hand_heat_prim_fuel * 1000))
  record('energy_use.electricity.heating.secondary within 2% of hand-calc',   within(eu.electricity.heating.secondary, hand_heat_sec_fuel  * 1000))
  record('energy_use.electricity.heating.total within 2% of hand-calc',       within(eu.electricity.heating.total,     hand_heat_total_fuel * 1000))
  record('energy_use.electricity.cooling.primary within 2% of hand-calc',     within(eu.electricity.cooling.primary,   hand_cool_prim_fuel * 1000))
  record('energy_use.electricity.cooling.secondary within 2% of hand-calc',   within(eu.electricity.cooling.secondary, hand_cool_sec_fuel  * 1000))
  record('energy_use.electricity.cooling.total within 2% of hand-calc',       within(eu.electricity.cooling.total,     hand_cool_total_fuel * 1000))
  // Part 4: electricity.total now includes lighting + equipment + DHW + fans
  // (Bridgewater test config above has no DHW or ventilation configured, so
  // only heating + cooling fuel + lighting + equipment are non-zero).
  const expected_elec_total = (hand_heat_total_fuel + hand_cool_total_fuel) * 1000 + eu.electricity.lighting + eu.electricity.equipment
  record('energy_use.electricity.total === heat+cool fuel + lighting + equipment',  within(eu.electricity.total, expected_elec_total))
  record('energy_use.electricity.lighting > 0 (Part 4 pass-through)',                eu.electricity.lighting > 0)
  record('energy_use.electricity.equipment > 0 (Part 4 pass-through)',               eu.electricity.equipment > 0)
  record('energy_use.electricity.fans.total === 0 (no vent configured)',             eu.electricity.fans.total === 0)
  record('energy_use.electricity.dhw.total === 0 (no DHW configured)',               eu.electricity.dhw.total === 0)
  record('energy_use.gas.total === 0 (Bridgewater all electric, no gas DHW)',        eu.gas.total === 0)
  record('energy_use.totals.electricity_kwh matches electricity.total',              eu.totals.electricity_kwh === eu.electricity.total)
  record('energy_use.totals.gas_kwh === 0',                                          eu.totals.gas_kwh === 0)
  record('energy_use.totals.delivered_energy_kwh === electricity + gas',             Math.abs(eu.totals.delivered_energy_kwh - (eu.totals.electricity_kwh + eu.totals.gas_kwh)) < 0.1)

  const gia_m2 = result.metadata?.gia_m2 ?? result.heat_balance?.metadata?.gia_m2 ?? 0
  const expected_eui = expected_elec_total / gia_m2     // heat+cool fuel + lighting + equipment
  console.log(`  Expected EUI (heat+cool+lighting+equipment): ${fmt(expected_eui, 1)} kWh/m²·a    Engine: ${eu.totals.eui_kwh_per_m2}`)
  record('result.metadata.gia_m2 present at top level', gia_m2 > 0)
  record('eui_kwh_per_m2 within 2% of hand-calc',                             within(eu.totals.eui_kwh_per_m2, expected_eui))
}

// ── Test 2: Ideal-loads regression ───────────────────────────────────────────
console.log()
console.log('Test 2 — Ideal-loads regression (SCOP=1.0/SEER=1.0, single primary)')
{
  const idealTemplates = [
    {
      id: 'ideal_heater',
      name: 'Ideal heater (COP=1)',
      supports_services: ['heating'],
      heating_scop: 1.0,
      fuel: 'electricity',
    },
    {
      id: 'ideal_cooler',
      name: 'Ideal cooler (SEER=1)',
      supports_services: ['cooling'],
      cooling_seer: 1.0,
      fuel: 'electricity',
    },
  ]
  const result = runState3(
    {
      ...buildingBase,
      systems_config: {
        heating: { primary: { library_id: 'ideal_heater' }, primary_pct: 100 },
        cooling: { primary: { library_id: 'ideal_cooler' }, primary_pct: 100 },
      },
    },
    idealTemplates,
  )
  const eu = result.energy_use
  const heat_demand_kwh = result.demand.heating_demand_mwh * 1000
  const cool_demand_kwh = result.demand.cooling_demand_mwh * 1000
  console.log(`  heating: demand=${heat_demand_kwh} kWh    energy_use.electricity.heating.total=${eu.electricity.heating.total} kWh`)
  console.log(`  cooling: demand=${cool_demand_kwh} kWh    energy_use.electricity.cooling.total=${eu.electricity.cooling.total} kWh`)
  record('energy_use.electricity.heating.total === heat demand × 1000 (within 0.5 kWh)',
    Math.abs(eu.electricity.heating.total - heat_demand_kwh) < 0.5)
  record('energy_use.electricity.cooling.total === cool demand × 1000 (within 0.5 kWh)',
    Math.abs(eu.electricity.cooling.total - cool_demand_kwh) < 0.5)
  record('system_performance.heating.total.fuel_mwh === heat demand',
    Math.abs(result.system_performance.heating.total.fuel_mwh - result.demand.heating_demand_mwh) < 0.005)
  record('system_performance.cooling.total.fuel_mwh === cool demand',
    Math.abs(result.system_performance.cooling.total.fuel_mwh - result.demand.cooling_demand_mwh) < 0.005)
  record('heating.secondary === null (no secondary configured)',
    result.system_performance.heating.secondary === null)
  record('cooling.secondary === null (no secondary configured)',
    result.system_performance.cooling.secondary === null)
}

// ── Test 3: A1 sensitivity (double length) ──────────────────────────────────
// Per Chris's spec: "percentages unchanged, fuel scales with demand."
// The right invariant for the systems layer is: fuel_ratio == demand_ratio
// (the engine attributes demand × pct / efficiency internally consistently).
// Whether demand itself scales linearly with length is an envelope physics
// question (Brief 28b territory) — Bridgewater is heavily gain-dominated so
// demand does not scale 1:1 with length. State 3 just needs to scale fuel
// with demand at constant percentages.
console.log()
console.log('Test 3 — A1 sensitivity (length × 2): fuel_ratio == demand_ratio, splits unchanged')
{
  const baseline = runState3(
    { ...buildingBase, systems_config: BRIDGEWATER_SYSTEMS },
    SYSTEM_TEMPLATES_BRIDGEWATER,
  )
  const doubled = runState3(
    { ...buildingBase, length: (buildingBase.length ?? 58.8) * 2, systems_config: BRIDGEWATER_SYSTEMS },
    SYSTEM_TEMPLATES_BRIDGEWATER,
  )
  const sp1 = baseline.system_performance
  const sp2 = doubled.system_performance
  const heat_demand_ratio = doubled.demand.heating_demand_mwh / Math.max(baseline.demand.heating_demand_mwh, 1e-9)
  const cool_demand_ratio = doubled.demand.cooling_demand_mwh / Math.max(baseline.demand.cooling_demand_mwh, 1e-9)
  const heat_fuel_ratio   = sp2.heating.total.fuel_mwh / Math.max(sp1.heating.total.fuel_mwh, 1e-9)
  const cool_fuel_ratio   = sp2.cooling.total.fuel_mwh / Math.max(sp1.cooling.total.fuel_mwh, 1e-9)
  console.log(`  heating demand ${baseline.demand.heating_demand_mwh} → ${doubled.demand.heating_demand_mwh} (ratio ${fmt(heat_demand_ratio, 3)})   heating fuel ratio ${fmt(heat_fuel_ratio, 3)}`)
  console.log(`  cooling demand ${baseline.demand.cooling_demand_mwh} → ${doubled.demand.cooling_demand_mwh} (ratio ${fmt(cool_demand_ratio, 3)})   cooling fuel ratio ${fmt(cool_fuel_ratio, 3)}`)

  // Fuel scales with demand at constant efficiency mix.
  record('heating fuel_ratio == demand_ratio (within 1%)',
    Math.abs(heat_fuel_ratio - heat_demand_ratio) / heat_demand_ratio < 0.01,
    `fuel ${fmt(heat_fuel_ratio, 3)} vs demand ${fmt(heat_demand_ratio, 3)}`)
  record('cooling fuel_ratio == demand_ratio (within 1%)',
    Math.abs(cool_fuel_ratio - cool_demand_ratio) / cool_demand_ratio < 0.01,
    `fuel ${fmt(cool_fuel_ratio, 3)} vs demand ${fmt(cool_demand_ratio, 3)}`)

  // Split percentages unchanged
  const heat_pct_1 = sp1.heating.primary.delivered_mwh / sp1.heating.total.delivered_mwh
  const heat_pct_2 = sp2.heating.primary.delivered_mwh / sp2.heating.total.delivered_mwh
  const cool_pct_1 = sp1.cooling.primary.delivered_mwh / sp1.cooling.total.delivered_mwh
  const cool_pct_2 = sp2.cooling.primary.delivered_mwh / sp2.cooling.total.delivered_mwh
  record('heating primary share unchanged after length×2 (≈95%)',
    Math.abs(heat_pct_2 - heat_pct_1) < 0.001 && Math.abs(heat_pct_2 - 0.95) < 0.001,
    `baseline ${fmt(heat_pct_1*100, 2)}% / doubled ${fmt(heat_pct_2*100, 2)}%`)
  record('cooling primary share unchanged after length×2 (≈95%)',
    Math.abs(cool_pct_2 - cool_pct_1) < 0.001 && Math.abs(cool_pct_2 - 0.95) < 0.001,
    `baseline ${fmt(cool_pct_1*100, 2)}% / doubled ${fmt(cool_pct_2*100, 2)}%`)
}

// ── Test 4: A2 sensitivity (rotate 90°) ─────────────────────────────────────
console.log()
console.log('Test 4 — A2 sensitivity (rotate 90°): splits unchanged, fuel redistributes')
{
  const baseline = runState3(
    { ...buildingBase, systems_config: BRIDGEWATER_SYSTEMS },
    SYSTEM_TEMPLATES_BRIDGEWATER,
  )
  const rotated = runState3(
    { ...buildingBase, orientation: ((buildingBase.orientation ?? 0) + 90) % 360, systems_config: BRIDGEWATER_SYSTEMS },
    SYSTEM_TEMPLATES_BRIDGEWATER,
  )
  const sp1 = baseline.system_performance
  const sp2 = rotated.system_performance
  console.log(`  baseline heating fuel ${sp1.heating.total.fuel_mwh}   rotated ${sp2.heating.total.fuel_mwh}`)
  console.log(`  baseline cooling fuel ${sp1.cooling.total.fuel_mwh}   rotated ${sp2.cooling.total.fuel_mwh}`)

  const heat_pct_1 = sp1.heating.primary.delivered_mwh / Math.max(sp1.heating.total.delivered_mwh, 1e-9)
  const heat_pct_2 = sp2.heating.primary.delivered_mwh / Math.max(sp2.heating.total.delivered_mwh, 1e-9)
  const cool_pct_1 = sp1.cooling.primary.delivered_mwh / Math.max(sp1.cooling.total.delivered_mwh, 1e-9)
  const cool_pct_2 = sp2.cooling.primary.delivered_mwh / Math.max(sp2.cooling.total.delivered_mwh, 1e-9)
  record('heating primary share unchanged after rotate 90° (≈95%)',
    Math.abs(heat_pct_2 - heat_pct_1) < 0.001 && Math.abs(heat_pct_2 - 0.95) < 0.001,
    `baseline ${fmt(heat_pct_1*100, 2)}% / rotated ${fmt(heat_pct_2*100, 2)}%`)
  record('cooling primary share unchanged after rotate 90° (≈95%)',
    Math.abs(cool_pct_2 - cool_pct_1) < 0.001 && Math.abs(cool_pct_2 - 0.95) < 0.001,
    `baseline ${fmt(cool_pct_1*100, 2)}% / rotated ${fmt(cool_pct_2*100, 2)}%`)
  record('avg_cop_or_eff unchanged after rotation (scalar, independent of demand)',
    sp2.heating.primary.avg_cop_or_eff === sp1.heating.primary.avg_cop_or_eff &&
    sp2.cooling.primary.avg_cop_or_eff === sp1.cooling.primary.avg_cop_or_eff)
}

// ── Test 5: Per-fuel split (gas primary + electric secondary) ───────────────
console.log()
console.log('Test 5 — Per-fuel split: gas heating primary + electric secondary')
{
  const mixedFuelTemplates = [
    {
      id: 'gas_boiler',
      name: 'Gas condensing boiler',
      supports_services: ['heating'],
      heating_scop: 0.92,
      fuel: 'gas',
    },
    {
      id: 'elec_backup',
      name: 'Electric backup heater',
      supports_services: ['heating'],
      heating_scop: 1.0,
      fuel: 'electricity',
    },
  ]
  const result = runState3(
    {
      ...buildingBase,
      systems_config: {
        heating: {
          primary:   { library_id: 'gas_boiler' },
          secondary: { library_id: 'elec_backup' },
          primary_pct: 80,
        },
      },
    },
    mixedFuelTemplates,
  )
  const eu = result.energy_use
  const heat_demand_mwh = result.demand.heating_demand_mwh
  const expected_gas_prim_fuel_kwh   = heat_demand_mwh * 0.80 / 0.92 * 1000
  const expected_elec_sec_fuel_kwh   = heat_demand_mwh * 0.20 / 1.00 * 1000
  console.log(`  heat demand ${heat_demand_mwh} MWh`)
  console.log(`  gas.heating.primary=${eu.gas.heating.primary} kWh (hand ≈ ${fmt(expected_gas_prim_fuel_kwh, 1)})`)
  console.log(`  electricity.heating.secondary=${eu.electricity.heating.secondary} kWh (hand ≈ ${fmt(expected_elec_sec_fuel_kwh, 1)})`)
  record('gas.heating.primary > 0',                                eu.gas.heating.primary > 0)
  record('gas.heating.primary within 2% of hand-calc',             within(eu.gas.heating.primary,           expected_gas_prim_fuel_kwh))
  record('gas.heating.secondary === 0',                            eu.gas.heating.secondary === 0)
  record('gas.heating.total within 2% of primary',                 within(eu.gas.heating.total,             expected_gas_prim_fuel_kwh))
  record('electricity.heating.primary === 0',                      eu.electricity.heating.primary === 0)
  record('electricity.heating.secondary > 0',                      eu.electricity.heating.secondary > 0)
  record('electricity.heating.secondary within 2% of hand-calc',   within(eu.electricity.heating.secondary, expected_elec_sec_fuel_kwh))
  record('totals.gas_kwh === gas.heating.total',                   eu.totals.gas_kwh === eu.gas.total)
  // Part 4: totals.electricity_kwh now includes lighting + equipment in addition to heat.sec
  record('totals.electricity_kwh === electricity.heating.secondary + lighting + equipment',
    Math.abs(eu.totals.electricity_kwh - (eu.electricity.heating.secondary + eu.electricity.lighting + eu.electricity.equipment)) < 0.5)
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log()
console.log('─'.repeat(70))
console.log(`Tests run: ${testsRun}    Passed: ${testsPassed}    Failed: ${testsFailed}`)
console.log('─'.repeat(70))
if (testsFailed > 0) process.exit(1)
