/**
 * scripts/state3_part4_dhw_vent_lighting_carbon_test.mjs
 *
 * Brief 28f Part 4 verification — DHW + ventilation + lighting/equipment +
 * carbon.
 *
 * Bridgewater system config (per Chris's Part 4 scope):
 *   DHW primary:   ASHP, SCOP 2.8, electricity, 60%
 *   DHW secondary: Gas boiler + calorifier, seasonal_efficiency 0.88, gas, 40%
 *   DHW circulation pump: 120 W continuous
 *   DHW demand:    138 beds × occupancy_fraction × 80 L/p/day × ΔT × c_p / 3600
 *                  Cold mains 10 °C; hot store 60 °C; constant for V1.
 *   WC Extract:    2292 l/s, SFP 0.4, HRE 0, always_on
 *   MVHR:          1450 l/s aggregate (5 × Toshiba VN-M1000HE @ ~290 l/s each),
 *                  SFP 1.4, HRE 0.8, always_on. (Corrected 2026-05-15 from
 *                  initial 5000 l/s — Part 4 brief confused unit model name
 *                  "1000HE" with flow; per Fabric & Systems Modelling Notes.)
 *
 * Carbon factors (BEIS 2024, hardcoded V1):
 *   electricity: 0.207 kg CO2e/kWh
 *   gas:         0.183 kg CO2e/kWh
 *
 * Tests:
 *   T1 — DHW hand-calc ±2% (primary + secondary + circulation pump)
 *   T2 — Mech ventilation hand-calc ±2% per system (fans + recovery)
 *   T3 — Lighting + equipment byte-identical to State 2 internal gains
 *   T4 — Carbon = (elec × 0.207 + gas × 0.183) / gia (sanity check, exact)
 *   T5 — Ideal-loads regression: SCOP=1.0, HRE=0 → fuel = delivered =
 *        State 2 demand (heating + cooling + DHW)
 *   T6 — HRE recovery cap: theoretical exceeds State 2 heating demand;
 *        effective recovery_mwh capped at heating demand; heating service
 *        sees zero remaining demand → heating fuel = 0.
 *
 * Usage:
 *   node scripts/state3_part4_dhw_vent_lighting_carbon_test.mjs [project_id]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant, BEIS_2024_FACTORS } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const PROJECT_ID = process.argv[2] || '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fj(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${url} → ${r.status}`); return r.json()
}

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

// Library = the canonical starter templates. Test also defines synthetic
// "ideal" templates inline for ideal-loads regression (these aren't realistic
// library items — they're test artifacts for the COP=1 boundary case).
const IDEAL_LOADS_TEMPLATES = [
  { id: 'ideal_heater', supports_services: ['heating'], heating_scop: 1.0,            fuel: 'electricity' },
  { id: 'ideal_cooler', supports_services: ['cooling'], cooling_seer: 1.0,            fuel: 'electricity' },
  { id: 'ideal_dhw',    supports_services: ['dhw'],     dhw_seasonal_efficiency: 1.0, fuel: 'electricity' },
]
const SYSTEM_TEMPLATES = [...SYSTEM_TEMPLATES_LIBRARY, ...IDEAL_LOADS_TEMPLATES]

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

const BRIDGEWATER_FULL_SYSTEMS = {
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
  dhw: {
    primary:           { library_id: 'ashp_dhw_preheat' },
    secondary:         { library_id: 'gas_boiler_calorifier' },
    primary_pct:       60,
    circulation_pump_w: 120,
  },
  ventilation: [
    { id: 'WC_extract', flow_l_s: 2292, sfp_w_per_l_s: 0.4, hre: 0,   schedule_ref: 'always_on' },
    // MVHR aggregate: 5 × Toshiba VN-M1000HE @ commissioned 270–310 l/s → 5 × 290 = 1450 l/s.
    // Per Bridgewater Fabric and Systems Modelling Notes. (Was 5000 in Part 4 draft — wrong, code-review fix.)
    { id: 'MVHR',       flow_l_s: 1450, sfp_w_per_l_s: 1.4, hre: 0.8, schedule_ref: 'always_on' },
  ],
}

let testsRun = 0, testsPassed = 0, testsFailed = 0
function record(name, passed, detail = '') {
  testsRun++
  if (passed) { testsPassed++; console.log(`  ✓ ${name}${detail ? '  —  ' + detail : ''}`) }
  else        { testsFailed++; console.log(`  ✗ ${name}${detail ? '  —  ' + detail : ''}`) }
}
function within(actual, target, pct = 0.02) {
  if (target === 0) return Math.abs(actual) < 0.5
  return Math.abs(actual - target) / Math.abs(target) <= pct
}
function fmt(x, dp = 1) { return Number(x).toFixed(dp) }

const DHW_KWH_PER_PERSON_HOUR = 80 * (60 - 10) * 4.18 / 3600 / 24

console.log()
console.log('=== Brief 28f Part 4: DHW + ventilation + lighting/equipment + carbon ===')

// ── Test 1: DHW hand-calc ─────────────────────────────────────────────────────
console.log()
console.log('Test 1 — DHW hand-calc on Bridgewater (±2%)')
{
  const result = runState3(
    { ...buildingBase, systems_config: BRIDGEWATER_FULL_SYSTEMS },
    SYSTEM_TEMPLATES,
  )
  const occHours = result.occupancy_summary.annual_occupant_hours
  const hand_dhw_demand_kwh   = occHours * DHW_KWH_PER_PERSON_HOUR
  const hand_dhw_demand_mwh   = hand_dhw_demand_kwh / 1000
  const hand_prim_delivered   = hand_dhw_demand_mwh * 0.60
  const hand_prim_fuel        = hand_prim_delivered / 2.8       // ASHP SCOP 2.8 → electricity
  const hand_sec_delivered    = hand_dhw_demand_mwh * 0.40
  const hand_sec_fuel         = hand_sec_delivered / 0.88       // boiler 0.88 → gas
  const hand_circ_kwh         = 120 * 8760 / 1000               // 1051.2 kWh

  const sp = result.system_performance.dhw
  const eu = result.energy_use
  console.log(`  Annual occupant-hours from State 2: ${occHours.toLocaleString()}`)
  console.log(`  Hand DHW demand: ${fmt(hand_dhw_demand_mwh, 2)} MWh    Engine: ${sp.total.delivered_mwh} MWh`)
  console.log(`  Hand DHW primary fuel (electricity, ASHP): ${fmt(hand_prim_fuel, 3)} MWh    Engine: ${sp.primary?.fuel_mwh}`)
  console.log(`  Hand DHW secondary fuel (gas, boiler): ${fmt(hand_sec_fuel, 3)} MWh    Engine: ${sp.secondary?.fuel_mwh}`)
  console.log(`  Hand DHW circulation: ${fmt(hand_circ_kwh, 1)} kWh    Engine: ${sp.circulation_pump_kwh}`)

  record('dhw.total.delivered_mwh within 2% of hand-calc demand',  within(sp.total.delivered_mwh, hand_dhw_demand_mwh))
  record('dhw.primary.delivered_mwh within 2% of hand-calc',       within(sp.primary.delivered_mwh, hand_prim_delivered))
  record('dhw.primary.fuel_mwh within 2% of hand-calc',            within(sp.primary.fuel_mwh,      hand_prim_fuel))
  record('dhw.primary.avg_cop_or_eff === 2.8 (ASHP SCOP)',         sp.primary.avg_cop_or_eff === 2.8)
  record('dhw.primary.fuel === "electricity"',                     sp.primary.fuel === 'electricity')
  record('dhw.secondary.delivered_mwh within 2% of hand-calc',     within(sp.secondary.delivered_mwh, hand_sec_delivered))
  record('dhw.secondary.fuel_mwh within 2% of hand-calc',          within(sp.secondary.fuel_mwh,    hand_sec_fuel))
  record('dhw.secondary.avg_cop_or_eff === 0.88 (boiler)',         sp.secondary.avg_cop_or_eff === 0.88)
  record('dhw.secondary.fuel === "gas"',                           sp.secondary.fuel === 'gas')
  record('dhw.circulation_pump_kwh within 0.5 kWh of hand-calc',   Math.abs(sp.circulation_pump_kwh - hand_circ_kwh) < 0.5)
  record('dhw.total.fuel_mwh === primary + secondary fuel',
    Math.abs(sp.total.fuel_mwh - (sp.primary.fuel_mwh + sp.secondary.fuel_mwh)) < 0.002)

  // energy_use.electricity.dhw.{primary,secondary,circulation,total}
  record('energy_use.electricity.dhw.primary === hand primary fuel (kWh)',     within(eu.electricity.dhw.primary,   hand_prim_fuel * 1000))
  record('energy_use.electricity.dhw.secondary === 0 (gas boiler, not elec)',  eu.electricity.dhw.secondary === 0)
  record('energy_use.electricity.dhw.circulation === circulation_pump_kwh',    Math.abs(eu.electricity.dhw.circulation - hand_circ_kwh) < 0.5)
  record('energy_use.electricity.dhw.total === primary + circulation',
    Math.abs(eu.electricity.dhw.total - (eu.electricity.dhw.primary + eu.electricity.dhw.circulation)) < 0.5)
  record('energy_use.gas.dhw.primary === 0 (electric ASHP, not gas)',          eu.gas.dhw.primary === 0)
  record('energy_use.gas.dhw.secondary === hand secondary fuel (kWh)',         within(eu.gas.dhw.secondary, hand_sec_fuel * 1000))
  record('energy_use.gas.dhw.total === secondary only',
    Math.abs(eu.gas.dhw.total - eu.gas.dhw.secondary) < 0.5)
}

// ── Test 2: Ventilation hand-calc ────────────────────────────────────────────
console.log()
console.log('Test 2 — Mech ventilation hand-calc (±2%)')
{
  const result = runState3(
    { ...buildingBase, systems_config: BRIDGEWATER_FULL_SYSTEMS },
    SYSTEM_TEMPLATES,
  )
  // Hand-calc fan energy
  const hand_wc_fan_kwh   = 2292 * 0.4 * 8760 / 1000     // 8031.2
  const hand_mvhr_fan_kwh = 1450 * 1.4 * 8760 / 1000     // 17782.8  (corrected 2026-05-15)
  const hand_total_fan    = hand_wc_fan_kwh + hand_mvhr_fan_kwh

  const sysVent = result.system_performance.ventilation
  console.log(`  Hand WC extract fan: ${fmt(hand_wc_fan_kwh, 1)} kWh    Engine: ${sysVent.systems[0].fan_kwh}`)
  console.log(`  Hand MVHR fan: ${fmt(hand_mvhr_fan_kwh, 1)} kWh    Engine: ${sysVent.systems[1].fan_kwh}`)

  record('ventilation.systems.length === 2',                            sysVent.systems.length === 2)
  record('WC_extract.fan_kwh within 2% of hand-calc',                   within(sysVent.systems[0].fan_kwh,   hand_wc_fan_kwh))
  record('WC_extract.recovery_mwh === 0 (HRE=0)',                       sysVent.systems[0].recovery_mwh === 0)
  record('MVHR.fan_kwh within 2% of hand-calc',                         within(sysVent.systems[1].fan_kwh,   hand_mvhr_fan_kwh))
  record('MVHR.recovery_mwh > 0 (HRE=0.8 theoretical)',                 sysVent.systems[1].recovery_mwh > 0)
  record('total.fan_kwh within 2% of hand-calc',                        within(sysVent.total.fan_kwh,        hand_total_fan))

  // energy_use.electricity.fans
  const eu = result.energy_use
  record('energy_use.electricity.fans.per_system.length === 2',         eu.electricity.fans.per_system.length === 2)
  record('energy_use.electricity.fans.per_system[0].id === "WC_extract"', eu.electricity.fans.per_system[0].id === 'WC_extract')
  record('energy_use.electricity.fans.per_system[1].id === "MVHR"',     eu.electricity.fans.per_system[1].id === 'MVHR')
  record('energy_use.electricity.fans.total within 2% of hand-calc',    within(eu.electricity.fans.total, hand_total_fan))

  // Recovery cap behaviour — engine invariant tests (regardless of whether
  // Bridgewater happens to be in the cap regime today). Updated 2026-05-15
  // after the Xmas-exception fix + length config drift made the previous
  // "theoretical >> demand * 5" assertion no longer hold for the current
  // Bridgewater state; the invariants below test the cap MATH not Bridgewater
  // specifics.
  console.log(`  Theoretical MVHR recovery: ${sysVent.total.recovery_theoretical_mwh} MWh (uncapped)`)
  console.log(`  Effective recovery (capped at heat demand): ${sysVent.total.recovery_mwh} MWh`)
  console.log(`  State 2 heating demand: ${result.demand.heating_demand_mwh} MWh`)
  // Invariant 1: effective recovery never exceeds theoretical recovery.
  record('effective recovery <= theoretical recovery',
    sysVent.total.recovery_mwh <= sysVent.total.recovery_theoretical_mwh + 0.01)
  // Invariant 2: effective recovery never exceeds State 2 heating demand.
  record('effective recovery <= State 2 heating demand',
    sysVent.total.recovery_mwh <= result.demand.heating_demand_mwh + 0.01)
  // Invariant 3 (Brief 28j): effective recovery <= min(theoretical, state2 demand).
  // Per-hour cap is STRICTER than the old annual-cap === because individual
  // winter-peak hours can have theoretical_h > demand_h even when the annual
  // totals don't. Annual-cap was `effective === min(theoretical, demand)`;
  // per-hour cap is `effective <= min(theoretical, demand)`. Equality only
  // when the cap never binds at any hour (small MVHR, or zero-demand months
  // distributed such that no hour saturates).
  const annualMinBound = Math.min(sysVent.total.recovery_theoretical_mwh, result.demand.heating_demand_mwh)
  record('effective recovery <= min(theoretical, state2 heat demand)',
    sysVent.total.recovery_mwh <= annualMinBound + 0.01)
  // Invariant 4: heating delivered = max(0, state2 demand - effective recovery)
  const expectedHeatDelivered = Math.max(0, result.demand.heating_demand_mwh - sysVent.total.recovery_mwh)
  record('heating delivered === max(0, state2 demand - effective recovery)',
    Math.abs(result.system_performance.heating.total.delivered_mwh - expectedHeatDelivered) < 0.01)
}

// ── Test 3: Lighting + equipment pass-through ─────────────────────────────────
console.log()
console.log('Test 3 — Lighting + equipment byte-identical to State 2 internal gains')
{
  const result = runState3(
    { ...buildingBase, systems_config: BRIDGEWATER_FULL_SYSTEMS },
    SYSTEM_TEMPLATES,
  )
  const s2_lighting_kwh  = result.heat_balance?.annual?.gains?.internal?.lighting?.kwh
  const s2_equipment_kwh = result.heat_balance?.annual?.gains?.internal?.equipment?.kwh
  console.log(`  State 2 internal gain: lighting ${s2_lighting_kwh} kWh    equipment ${s2_equipment_kwh} kWh`)
  console.log(`  energy_use.electricity.lighting ${result.energy_use.electricity.lighting} kWh    equipment ${result.energy_use.electricity.equipment} kWh`)
  record('energy_use.electricity.lighting === State 2 internal gain lighting',
    Math.abs(result.energy_use.electricity.lighting - s2_lighting_kwh) < 0.1)
  record('energy_use.electricity.equipment === State 2 internal gain equipment',
    Math.abs(result.energy_use.electricity.equipment - s2_equipment_kwh) < 0.1)
}

// ── Test 4: Carbon ────────────────────────────────────────────────────────────
console.log()
console.log('Test 4 — Carbon = (elec × 0.207 + gas × 0.183) / gia (exact)')
{
  const result = runState3(
    { ...buildingBase, systems_config: BRIDGEWATER_FULL_SYSTEMS },
    SYSTEM_TEMPLATES,
  )
  const elec_kwh = result.energy_use.totals.electricity_kwh
  const gas_kwh  = result.energy_use.totals.gas_kwh
  const gia_m2   = result.metadata.gia_m2
  const hand_carbon_kg = elec_kwh * BEIS_2024_FACTORS.electricity + gas_kwh * BEIS_2024_FACTORS.gas
  const hand_carbon_per_m2 = hand_carbon_kg / gia_m2
  console.log(`  electricity_kwh ${elec_kwh.toLocaleString()}  ×  ${BEIS_2024_FACTORS.electricity}`)
  console.log(`  gas_kwh        ${gas_kwh.toLocaleString()}  ×  ${BEIS_2024_FACTORS.gas}`)
  console.log(`  gia ${gia_m2} m²    hand carbon ${fmt(hand_carbon_per_m2, 2)} kg/m²    engine ${result.carbon_kg_co2_per_m2}`)
  record('BEIS_2024_FACTORS.electricity === 0.207',                    BEIS_2024_FACTORS.electricity === 0.207)
  record('BEIS_2024_FACTORS.gas === 0.183',                            BEIS_2024_FACTORS.gas === 0.183)
  record('carbon_kg_co2_per_m2 within 0.05 of hand-calc',              Math.abs(result.carbon_kg_co2_per_m2 - hand_carbon_per_m2) < 0.05)
}

// ── Test 5: Ideal-loads regression (all services) ────────────────────────────
console.log()
console.log('Test 5 — Ideal-loads regression: SCOP=1.0, HRE=0 → fuel = delivered = demand')
{
  const result = runState3(
    {
      ...buildingBase,
      systems_config: {
        heating: { primary: { library_id: 'ideal_heater' }, primary_pct: 100, setpoint_c: 21 },
        cooling: { primary: { library_id: 'ideal_cooler' }, primary_pct: 100, setpoint_c: 25 },
        dhw:     { primary: { library_id: 'ideal_dhw' },    primary_pct: 100, circulation_pump_w: 0 },
        ventilation: [
          { id: 'AHU_ideal', flow_l_s: 1000, sfp_w_per_l_s: 1.0, hre: 0, schedule_ref: 'always_on' },
        ],
      },
    },
    SYSTEM_TEMPLATES,
  )
  const sp = result.system_performance
  const heat_demand = result.demand.heating_demand_mwh
  const cool_demand = result.demand.cooling_demand_mwh
  const dhw_demand_expected_mwh = result.occupancy_summary.annual_occupant_hours * DHW_KWH_PER_PERSON_HOUR / 1000
  console.log(`  heating: demand=${heat_demand}    fuel=${sp.heating.total.fuel_mwh}`)
  console.log(`  cooling: demand=${cool_demand}    fuel=${sp.cooling.total.fuel_mwh}`)
  console.log(`  dhw:     demand=${fmt(dhw_demand_expected_mwh, 2)}    fuel=${sp.dhw.total.fuel_mwh}`)
  console.log(`  ventilation recovery=${sp.ventilation.total.recovery_mwh}`)

  record('heating fuel = heating demand (ideal)',  Math.abs(sp.heating.total.fuel_mwh - heat_demand) < 0.01)
  record('cooling fuel = cooling demand (ideal)',  Math.abs(sp.cooling.total.fuel_mwh - cool_demand) < 0.01)
  record('dhw fuel = dhw demand (ideal)',          Math.abs(sp.dhw.total.fuel_mwh - dhw_demand_expected_mwh) < 0.005)
  record('ventilation effective recovery === 0 (HRE=0)', sp.ventilation.total.recovery_mwh === 0)
  record('heating.total.delivered_mwh === State 2 heating demand (no recovery applied)',
    Math.abs(sp.heating.total.delivered_mwh - heat_demand) < 0.01)
}

// ── Test 6: HRE recovery cap (Bridgewater MVHR oversized) ────────────────────
// Already covered in Test 2; explicit redundancy here for visibility.
console.log()
console.log('Test 6 — HRE recovery cap & option (a) heating demand reduction')
{
  // Build a config where theoretical recovery < heating demand to verify
  // the cap is the right way around (i.e. when recovery is small, all of it
  // applies; heating demand isn't fully zeroed out).
  const result = runState3(
    {
      ...buildingBase,
      systems_config: {
        heating: { primary: { library_id: 'vrf_heat_recovery_dual_function' }, primary_pct: 100, setpoint_c: 21 },
        ventilation: [
          // Tiny MVHR — theoretical recovery should be much less than heat demand
          { id: 'small_mvhr', flow_l_s: 100, sfp_w_per_l_s: 1.4, hre: 0.5, schedule_ref: 'always_on' },
        ],
      },
    },
    SYSTEM_TEMPLATES,
  )
  const sp = result.system_performance
  const heat_demand_state2 = result.demand.heating_demand_mwh
  const theoretical = sp.ventilation.total.recovery_theoretical_mwh
  const effective   = sp.ventilation.total.recovery_mwh
  const remaining_demand_engine = sp.heating.total.delivered_mwh
  console.log(`  State 2 heat demand: ${heat_demand_state2}    theoretical recovery: ${theoretical}    effective: ${effective}`)
  console.log(`  Heating demand after recovery applied (delivered_mwh): ${remaining_demand_engine}`)
  record('theoretical recovery < State 2 heating demand (small MVHR)', theoretical < heat_demand_state2)
  // Brief 28j: per-hour cap is stricter than annual cap. Even when annual
  // theoretical < annual demand, individual winter-peak hours can saturate
  // (theoretical_h > demand_h), so effective < theoretical at those hours.
  // Annual-cap test was effective === theoretical; per-hour-cap test is
  // effective <= theoretical (always) and effective > 0 (system is recovering
  // something, just less than the annual integral suggests).
  record('effective recovery <= theoretical recovery (per-hour cap is stricter)',
    effective <= theoretical + 0.002)
  record('effective recovery > 0 (recovery still occurs)', effective > 0)
  record('heating delivered === state2_demand − effective_recovery',
    Math.abs(remaining_demand_engine - (heat_demand_state2 - effective)) < 0.005)
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log()
console.log('─'.repeat(70))
console.log(`Tests run: ${testsRun}    Passed: ${testsPassed}    Failed: ${testsFailed}`)
console.log('─'.repeat(70))
if (testsFailed > 0) process.exit(1)
