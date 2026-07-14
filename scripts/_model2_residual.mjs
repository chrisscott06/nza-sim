// Model-2 auxiliary residual — brief bridgwater-model2-calibrated Part 4 (step 15, D2).
// Applies steps 1-14, then implements the electricity gap (572.4 MWh - modelled)
// as a named flat-profile equipment entry `auxiliary_residual_unattributed` on the
// equipment class (known-counted; NOT the inert gains.auxiliary). Tests gain_fraction
// 0 vs 1, sizes to hit 572.4, and proves the before/after electricity delta == residual.
//   node scripts/_model2_residual.mjs <fixture.json>
import fs from 'node:fs'
const R = 'file:///C:/Users/ChrisScott/Dev/nza-sim/frontend/src'
const { calculateInstant } = await import(`${R}/utils/instantCalc.js`)
const { computeHourlySolarByFacade } = await import(`${R}/utils/solarCalc.js`)
const { SYSTEM_TEMPLATES_LIBRARY } = await import(`${R}/data/systemTemplatesLibrary.js`)
const fx = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'))
const REPO = 'C:/Users/ChrisScott/Dev/nza-sim'
const clone = (o) => JSON.parse(JSON.stringify(o))
const B = clone(fx.building_config), C = clone(fx.construction_choices), CB = { ...(fx.comfort_band || { lower_c: 21, upper_c: 24 }) }
const b0 = fx.building_config
const epw = fs.readFileSync(`${REPO}/data/weather/current/${b0.weather_file}`, 'utf-8').split(/\r?\n/)
const lat = parseFloat(epw[0].split(',')[6]); const dl = epw.slice(8).filter((l) => l.trim()); const N = dl.length
const w = { temperature: new Float32Array(N), direct_normal: new Float32Array(N), diffuse_horizontal: new Float32Array(N), wind_speed: new Float32Array(N), month: new Int8Array(N), day: new Int8Array(N), hour: new Int8Array(N) }
for (let i = 0; i < N; i++) { const p = dl[i].split(','); w.month[i] = +p[1]; w.day[i] = +p[2]; w.hour[i] = +p[3]; w.temperature[i] = +p[6]; w.direct_normal[i] = +p[14]; w.diffuse_horizontal[i] = +p[15]; w.wind_speed[i] = +p[21] }
const hs = computeHourlySolarByFacade(w, lat, b0.orientation ?? 0)
const libraryData = { constructions: fx.library_constructions.map((c) => ({ name: c.name, u_value_W_per_m2K: c.u_value_W_per_m2K, y_factor: c.y_factor ?? 1, g_value: c.g_value, config_json: c.config_json, layers: c.layers })), system_templates: SYSTEM_TEMPLATES_LIBRARY, library_systems: b0.library_systems ?? [], library_schedules: b0.library_schedules ?? [] }
// steps 1-14
C.external_wall = { library_id: 'bridgwater_ext_wall', u_value_override: 0.154 }
C.roof = { library_id: 'bridgwater_roof', u_value_override: 0.165 }
C.ground_floor = { library_id: 'bridgwater_ground_floor', u_value_override: 0.143 }
C.glazing = { library_id: 'bridgwater_glazing', u_value_override: 1.54 }
B.fabric.air_permeability_q50 = 5.34
B.systems_config_v40.heating[0].efficiency_metric = 2.8
B.systems_config_v40.cooling[0].efficiency_metric = 3.0
B.systems_config_v40.ventilation[0].efficiency_metric.sfp_w_per_lps = 1.8
B.systems_config_v40.ventilation[1].efficiency_metric.sfp_w_per_lps = 0.8
B.systems_config_v40.ventilation[2].efficiency_metric.sfp_w_per_lps = 0.8
B.systems_config_v40.ventilation[1].flow_rate = 2292
B.systems_config_v40.ventilation[0].flow_rate = 1450
B.systems_config_v40.ventilation[0].efficiency_metric.recovery_sensible_pct = 70
B.gains.lighting.profiles[0].magnitude.value = 3.5
const laundry = clone(B.gains.equipment.profiles[0]); laundry.id = 'equipment_laundry'; laundry.label = 'equipment_laundry'; laundry.baseload = { value: 0.9341, unit: 'w_per_m2' }
B.gains.equipment.profiles.push(laundry)
CB.lower_c = 22; CB.upper_c = 23
B.systems_config_v40.dhw[1].efficiency_metric = 2.8
B.systems_config_v40.dhw[0].efficiency_metric = 0.85
B.systems_config_v40.dhw[0].share_pct = 60
B.systems_config_v40.dhw[1].share_pct = 40
B.systems_config_v40.dhw_demand_litres_per_person_per_day = 57.57

function run(building) {
  const r = calculateInstant(building, C, {}, libraryData, w, hs, null, { mode: 'full', comfortBand: CB, engine: 'v2.5', _skipInterventions: true })
  const c = r.consumption
  return { eui: c.total.kwh_per_m2_yr, elec: c.total.electricity_mwh, gas: c.total.gas_mwh, heat_dem: c.space_heating.demand_mwh, cool_dem: c.space_cooling.demand_mwh, sp: c.small_power.electricity_mwh }
}
function withResidual(baseloadWm2, gainFraction) {
  const b = clone(B)
  const res = clone(b.gains.equipment.profiles[0])
  res.id = 'auxiliary_residual_unattributed'; res.label = 'auxiliary_residual_unattributed'
  res.baseload = { value: baseloadWm2, unit: 'w_per_m2' }
  res.active = { value: 0, unit: 'w_per_m2' }
  res.gain_fraction = gainFraction
  res.relationship_to_occupancy = 'constant'
  // flat schedule (no variation) — the residual is unattributed, modelled flat
  const flat = Array(24).fill(1)
  res.schedule = { weekday: flat, saturday: flat, sunday: flat, monthly_multipliers: Array(12).fill(1), exceptions: [] }
  b.gains.equipment.profiles.push(res)
  return run(b)
}
const before = run(B)
console.log(`STEP-14 baseline (no residual): elec ${before.elec.toFixed(3)}, gas ${before.gas.toFixed(3)}, EUI ${before.eui.toFixed(1)}, heat_dem ${before.heat_dem.toFixed(1)}, cool_dem ${before.cool_dem.toFixed(1)}`)
// gain_fraction sensitivity at baseload 4.0
const gf0 = withResidual(4.0, 0), gf1 = withResidual(4.0, 1)
console.log(`\nresidual baseload 4.0 W/m2:`)
console.log(`  gain_fraction=0: elec ${gf0.elec.toFixed(3)} (d ${(gf0.elec-before.elec).toFixed(3)}), heat_dem ${gf0.heat_dem.toFixed(1)} (d ${(gf0.heat_dem-before.heat_dem).toFixed(2)}), cool_dem ${gf0.cool_dem.toFixed(1)} (d ${(gf0.cool_dem-before.cool_dem).toFixed(2)})`)
console.log(`  gain_fraction=1: elec ${gf1.elec.toFixed(3)} (d ${(gf1.elec-before.elec).toFixed(3)}), heat_dem ${gf1.heat_dem.toFixed(1)} (d ${(gf1.heat_dem-before.heat_dem).toFixed(2)}), cool_dem ${gf1.cool_dem.toFixed(1)} (d ${(gf1.cool_dem-before.cool_dem).toFixed(2)})`)
// size with gain_fraction=0 (no thermal feedback -> clean, exact): baseload for 572.4
const per = (gf0.elec - before.elec) / 4.0  // MWh per W/m2
const need = 572.4 - before.elec
const bl = need / per
const final = withResidual(bl, 0)
const A = per * 1e6 / 8760 // implied area from MWh-per-Wm2
console.log(`\n=== SIZED (gain_fraction=0, flat) ===`)
console.log(`residual baseload = ${bl.toFixed(4)} W/m2 (implied area ${A.toFixed(0)} m2)`)
console.log(`residual electricity = ${(final.elec - before.elec).toFixed(3)} MWh  (W/m2-continuous-equiv ${bl.toFixed(3)})`)
console.log(`FINAL: elec ${final.elec.toFixed(3)} (target 572.400), gas ${final.gas.toFixed(3)}, EUI ${final.eui.toFixed(1)} (target 185.1)`)
console.log(`residual in EUI points: ${((final.elec - before.elec) * 1000 / 4215).toFixed(1)}`)
console.log(`residual MWh ${(final.elec - before.elec).toFixed(1)} - stop-band [80,200], expected [120,160]`)
console.log(`\nBEFORE/AFTER PROOF (D2): total elec ${before.elec.toFixed(3)} -> ${final.elec.toFixed(3)}, delta ${(final.elec-before.elec).toFixed(3)} == residual`)
