// Model-2 DHW gas re-anchor — brief bridgwater-model2-calibrated Part 3 (step 14).
// Applies steps 1-13 (in-service adjustments), then converges DHW demand
// (L/person/day, tap basis) by bisection until modelled DHW gas = 207.7 MWh,
// under the new 60/40 gas:HP split and gas eta 0.85 (held at evidenced values).
// Gas-anchoring rule (design note): converge demand, never hand-pick it.
//   node scripts/_model2_dhw_anchor.mjs <fixture.json>
import fs from 'node:fs'
const R = 'file:///C:/Users/ChrisScott/Dev/nza-sim/frontend/src'
const { calculateInstant } = await import(`${R}/utils/instantCalc.js`)
const { computeHourlySolarByFacade } = await import(`${R}/utils/solarCalc.js`)
const { SYSTEM_TEMPLATES_LIBRARY } = await import(`${R}/data/systemTemplatesLibrary.js`)
const fx = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'))
const REPO = 'C:/Users/ChrisScott/Dev/nza-sim'
const clone = (o) => JSON.parse(JSON.stringify(o))

const B = clone(fx.building_config)
const C = clone(fx.construction_choices)
const CB = { ...(fx.comfort_band || { lower_c: 21, upper_c: 24 }) }
const b0 = fx.building_config
const epw = fs.readFileSync(`${REPO}/data/weather/current/${b0.weather_file}`, 'utf-8').split(/\r?\n/)
const lat = parseFloat(epw[0].split(',')[6]); const dl = epw.slice(8).filter((l) => l.trim()); const N = dl.length
const w = { temperature: new Float32Array(N), direct_normal: new Float32Array(N), diffuse_horizontal: new Float32Array(N), wind_speed: new Float32Array(N), month: new Int8Array(N), day: new Int8Array(N), hour: new Int8Array(N) }
for (let i = 0; i < N; i++) { const p = dl[i].split(','); w.month[i] = +p[1]; w.day[i] = +p[2]; w.hour[i] = +p[3]; w.temperature[i] = +p[6]; w.direct_normal[i] = +p[14]; w.diffuse_horizontal[i] = +p[15]; w.wind_speed[i] = +p[21] }
const hs = computeHourlySolarByFacade(w, lat, b0.orientation ?? 0)
const libraryData = { constructions: fx.library_constructions.map((c) => ({ name: c.name, u_value_W_per_m2K: c.u_value_W_per_m2K, y_factor: c.y_factor ?? 1, g_value: c.g_value, config_json: c.config_json, layers: c.layers })), system_templates: SYSTEM_TEMPLATES_LIBRARY, library_systems: b0.library_systems ?? [], library_schedules: b0.library_schedules ?? [] }

// ── apply steps 1-13 (same as _model2_waterfall.mjs) ──────────────────────────
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

function runL(L) {
  B.systems_config_v40.dhw_demand_litres_per_person_per_day = L
  const r = calculateInstant(B, C, {}, libraryData, w, hs, null, { mode: 'full', comfortBand: CB, engine: 'v2.5', _skipInterventions: true })
  const c = r.consumption
  return { gas: c.total.gas_mwh, dhw_g: c.dhw.gas_mwh, dhw_e: c.dhw.electricity_mwh, eui: c.total.kwh_per_m2_yr, elec: c.total.electricity_mwh }
}

const TARGET = 207.7
console.log(`start L=48.2 -> gas ${runL(48.2).gas.toFixed(3)} (target ${TARGET})`)
// bisect on total gas (== DHW gas; gas serves DHW only)
let lo = 40, hi = 90
for (let i = 0; i < 40; i++) {
  const mid = (lo + hi) / 2
  const g = runL(mid).gas
  if (Math.abs(g - TARGET) < 0.02) { lo = hi = mid; break }
  if (g < TARGET) lo = mid; else hi = mid
}
const Lc = (lo + hi) / 2
const res = runL(Lc)
const v60 = Lc * 30 / 50 // tap 40C, cold 10C, storage 60C -> hot_fraction 0.6 -> V60 = V40 x 30/50
console.log('\n=== CONVERGED (step 14) ===')
console.log(`L/p/day (tap 40C basis): ${Lc.toFixed(2)}`)
console.log(`60C-equivalent V60 = ${Lc.toFixed(2)} x 30/50 = ${v60.toFixed(1)} L/p/day  (Model-1 was 28.9)`)
console.log(`modelled gas: ${res.gas.toFixed(3)} MWh  (target 207.7, delta ${((res.gas - TARGET) / TARGET * 100).toFixed(3)}%)`)
console.log(`dhw_gas ${res.dhw_g.toFixed(3)}, dhw_elec ${res.dhw_e.toFixed(3)}`)
console.log(`EUI after step 14: ${res.eui.toFixed(1)}   elec ${res.elec.toFixed(3)} MWh`)
console.log(`\nResidual preview (step 15, Part 4): 572.4 - ${res.elec.toFixed(3)} = ${(572.4 - res.elec).toFixed(1)} MWh electricity`)
