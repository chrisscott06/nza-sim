// Model-2 (in-service calibrated) waterfall harness — brief bridgwater-model2-calibrated Part 2.
// Applies the 13 evidence-cited in-service adjustments CUMULATIVELY in the brief's
// canonical order, running the faithful instant engine (calculateInstant, full mode,
// backend-parsed construction layers) after each step and recording EUI. Steps 14
// (DHW re-anchor) and 15 (residual) are Parts 3-4 and handled separately.
//
// Read-only: computes the waterfall numbers for the report (3.6 ΔEUI column) + the
// audit note. Does not write the DB. Usage:
//   node scripts/_model2_waterfall.mjs <fixture.json>
// where fixture = { building_config, construction_choices, comfort_band, library_constructions }
// sourced from the pinned Model-1 baseline with backend-parsed layers.
import fs from 'node:fs'
const R = 'file:///C:/Users/ChrisScott/Dev/nza-sim/frontend/src'
const { calculateInstant } = await import(`${R}/utils/instantCalc.js`)
const { computeHourlySolarByFacade } = await import(`${R}/utils/solarCalc.js`)
const { SYSTEM_TEMPLATES_LIBRARY } = await import(`${R}/data/systemTemplatesLibrary.js`)

const fx = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'))
const REPO = 'C:/Users/ChrisScott/Dev/nza-sim'
const clone = (o) => JSON.parse(JSON.stringify(o))

// weather + solar (shared across all runs)
const b0 = fx.building_config
const epw = fs.readFileSync(`${REPO}/data/weather/current/${b0.weather_file}`, 'utf-8').split(/\r?\n/)
const lat = parseFloat(epw[0].split(',')[6])
const dl = epw.slice(8).filter((l) => l.trim()); const N = dl.length
const w = { temperature: new Float32Array(N), direct_normal: new Float32Array(N), diffuse_horizontal: new Float32Array(N), wind_speed: new Float32Array(N), month: new Int8Array(N), day: new Int8Array(N), hour: new Int8Array(N) }
for (let i = 0; i < N; i++) { const p = dl[i].split(','); w.month[i] = +p[1]; w.day[i] = +p[2]; w.hour[i] = +p[3]; w.temperature[i] = +p[6]; w.direct_normal[i] = +p[14]; w.diffuse_horizontal[i] = +p[15]; w.wind_speed[i] = +p[21] }
const hs = computeHourlySolarByFacade(w, lat, b0.orientation ?? 0)
const libraryData = { constructions: fx.library_constructions.map((c) => ({ name: c.name, u_value_W_per_m2K: c.u_value_W_per_m2K, y_factor: c.y_factor ?? 1, g_value: c.g_value, config_json: c.config_json, layers: c.layers })), system_templates: SYSTEM_TEMPLATES_LIBRARY, library_systems: b0.library_systems ?? [], library_schedules: b0.library_schedules ?? [] }

function run(building, constructions, comfortBand) {
  const r = calculateInstant(building, constructions, {}, libraryData, w, hs, null, { mode: 'full', comfortBand, engine: 'v2.5', _skipInterventions: true })
  const c = r.consumption
  const fans = (c.ventilation || []).reduce((s, v) => s + (v.fan_electricity_mwh || 0), 0)
  return {
    eui: c.total.kwh_per_m2_yr, elec: c.total.electricity_mwh, gas: c.total.gas_mwh,
    heat_e: c.space_heating.electricity_mwh, heat_dem: c.space_heating.demand_mwh,
    cool_e: c.space_cooling.electricity_mwh, cool_dem: c.space_cooling.demand_mwh,
    dhw_e: c.dhw.electricity_mwh, dhw_g: c.dhw.gas_mwh, fans,
    light: c.lighting.electricity_mwh, sp: c.small_power.electricity_mwh,
  }
}

// ── evolving cumulative state ────────────────────────────────────────────────
const B = clone(fx.building_config)   // building_config
const C = clone(fx.construction_choices) // construction_choices
const CB = { ...(fx.comfort_band || { lower_c: 21, upper_c: 24 }) }

// Laundry baseload (step 10): area from baseline small_power = Σbaseload×A×8760.
// baseline 4 W/m² → 147.727 MWh → A = 147.727e6/(4×8760) = 4216.0 m².
// Target +34.5 MWh → baseload = 34.5e6/(4216.0×8760) = 0.9341 W/m². Verified below.
const LAUNDRY_WM2 = 0.9341

const STEPS = [
  { n: 1, name: 'U-values wall/roof/floor/glazing +10% (as-built allowance)', apply: () => {
      C.external_wall = { library_id: 'bridgwater_ext_wall', u_value_override: 0.154 }
      C.roof = { library_id: 'bridgwater_roof', u_value_override: 0.165 }
      C.ground_floor = { library_id: 'bridgwater_ground_floor', u_value_override: 0.143 }
      C.glazing = { library_id: 'bridgwater_glazing', u_value_override: 1.54 }
    } },
  { n: 2, name: 'Air permeability 4.64→5.34 (+15%, in-service)', apply: () => { B.fabric.air_permeability_q50 = 5.34 } },
  { n: 3, name: 'Door-operation infiltration [E1: no discrete input — carried in residual]', skipped: true, apply: () => {} },
  { n: 4, name: 'Heating SCOP (VRF) 5.0→2.8 (DESNZ EoH field median)', apply: () => { B.systems_config_v40.heating[0].efficiency_metric = 2.8 } },
  { n: 5, name: 'Cooling SEER (VRF) 3.5→3.0 (field studies)', apply: () => { B.systems_config_v40.cooling[0].efficiency_metric = 3.0 } },
  { n: 6, name: 'SFP bedroom/mvhr/toilet 0.4/1.4/0.4→0.8/1.8/0.8', apply: () => {
      const v = B.systems_config_v40.ventilation
      v[0].efficiency_metric.sfp_w_per_lps = 1.8 // mvhr_gf_public
      v[1].efficiency_metric.sfp_w_per_lps = 0.8 // bedroom_extract
      v[2].efficiency_metric.sfp_w_per_lps = 0.8 // public_toilet_extract
    } },
  { n: 7, name: 'Fan duties bedroom 2208→2292, mvhr 1425→1450 (toilet 210)', apply: () => {
      const v = B.systems_config_v40.ventilation
      v[1].flow_rate = 2292 // bedroom_extract
      v[0].flow_rate = 1450 // mvhr_gf_public
    } },
  { n: 8, name: 'Heat recovery (mvhr) 80→70% (in-service exchanger)', apply: () => { B.systems_config_v40.ventilation[0].efficiency_metric.recovery_sensible_pct = 70 } },
  { n: 9, name: 'Lighting 2.5→3.5 W/m² (always-on communal/external)', apply: () => { B.gains.lighting.profiles[0].magnitude.value = 3.5 } },
  { n: 10, name: `Laundry NEW equipment_laundry (+34.5 MWh, ${LAUNDRY_WM2} W/m²)`, apply: () => {
      const laundry = clone(B.gains.equipment.profiles[0])
      laundry.id = 'equipment_laundry'; laundry.label = 'equipment_laundry'
      laundry.baseload = { value: LAUNDRY_WM2, unit: 'w_per_m2' }
      B.gains.equipment.profiles.push(laundry)
    } },
  { n: 11, name: 'Setpoints htg/clg 21/24→22/23 (occupant behaviour, no setback)', apply: () => { CB.lower_c = 22; CB.upper_c = 23 } },
  { n: 12, name: 'ASHP DHW COP 3.4→2.8, gas η 0.89→0.85 (high-lift / cycling)', apply: () => {
      B.systems_config_v40.dhw[1].efficiency_metric = 2.8 // ashp_dhw_preheat
      B.systems_config_v40.dhw[0].efficiency_metric = 0.85 // gas_boiler_calorifier
    } },
  { n: 13, name: 'DHW plant split gas:HP 75/25→60/40 (505-derived ASHP share)', apply: () => {
      B.systems_config_v40.dhw[0].share_pct = 60
      B.systems_config_v40.dhw[1].share_pct = 40
    } },
]

const GIA = 4215
const fmt = (x, d = 2) => (x >= 0 ? '+' : '') + x.toFixed(d)
const base = run(B, C, CB)
let prev = base.eui
console.log('STEP | EUI | dEUI | elec MWh | gas MWh | notes')
console.log(`  0 baseline (Model 1) | ${base.eui.toFixed(1)} |   -   | ${base.elec.toFixed(3)} | ${base.gas.toFixed(3)} |`)
const rows = [{ step: 0, name: 'Model 1 baseline', eui: base.eui, delta: null, elec: base.elec, gas: base.gas }]
for (const s of STEPS) {
  s.apply()
  const r = run(B, C, CB)
  const d = r.eui - prev
  rows.push({ step: s.n, name: s.name, eui: r.eui, delta: d, elec: r.elec, gas: r.gas, skipped: !!s.skipped,
    sp: r.sp, light: r.light, fans: r.fans, heat_e: r.heat_e, cool_e: r.cool_e, dhw_g: r.dhw_g })
  console.log(`  ${s.n} ${s.name.slice(0, 46)} | ${r.eui.toFixed(1)} | ${fmt(d, 2)} | ${r.elec.toFixed(3)} | ${r.gas.toFixed(3)} |${s.skipped ? ' SKIPPED' : ''}`)
  prev = r.eui
}
const final = rows[rows.length - 1]
console.log('\n=== SUMMARY ===')
console.log(`Model-1 EUI ${base.eui.toFixed(1)} -> after steps 1-13 EUI ${final.eui.toFixed(1)} (delta ${fmt(final.eui - base.eui, 1)})`)
console.log(`Sum of step deltas: ${fmt(rows.slice(1).reduce((a, r) => a + (r.delta || 0), 0), 1)} (== cumulative by construction)`)
console.log(`After step 13: elec ${final.elec.toFixed(3)} MWh, gas ${final.gas.toFixed(3)} MWh`)
console.log(`  small_power ${final.sp.toFixed(3)} (laundry step-10 check), lighting ${final.light.toFixed(3)}, fans ${final.fans.toFixed(3)}`)
console.log(`  dhw_gas ${final.dhw_g.toFixed(3)} (step-14 re-anchor target: 207.7; Part 3)`)
// step-10 laundry delta check
const s9 = rows.find(r => r.step === 9), s10 = rows.find(r => r.step === 10)
console.log(`\nLaundry check: small_power step9->step10 = ${fmt(s10.sp - s9.sp, 3)} MWh (target +34.5)`)
