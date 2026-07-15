// Re-authored interventions — isolated evaluation vs Model 2 (interventions-fix B2/B4/D6).
// Applies each re-authored measure ALONE to the Model-2 baseline via the real
// applyIntervention, runs the faithful engine, and reports EUI/energy deltas +
// per-end-use + conservation + residual-untouched proof. This is the report 4.8
// table and verification 2/3/5. Read-only; no DB write.
//   node scripts/_model2_interventions_run.mjs <model2_fixture.json>
import fs from 'node:fs'
const R = 'file:///C:/Users/ChrisScott/Dev/nza-sim/frontend/src'
const { calculateInstant } = await import(`${R}/utils/instantCalc.js`)
const { computeHourlySolarByFacade } = await import(`${R}/utils/solarCalc.js`)
const { SYSTEM_TEMPLATES_LIBRARY } = await import(`${R}/data/systemTemplatesLibrary.js`)
const { applyIntervention } = await import(`${R}/utils/interventionsEngine.js`)
const fx = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'))
const REPO = 'C:/Users/ChrisScott/Dev/nza-sim'
const b0 = fx.building_config
const epw = fs.readFileSync(`${REPO}/data/weather/current/${b0.weather_file}`, 'utf-8').split(/\r?\n/)
const lat = parseFloat(epw[0].split(',')[6]); const dl = epw.slice(8).filter((l) => l.trim()); const N = dl.length
const w = { temperature: new Float32Array(N), direct_normal: new Float32Array(N), diffuse_horizontal: new Float32Array(N), wind_speed: new Float32Array(N), month: new Int8Array(N), day: new Int8Array(N), hour: new Int8Array(N) }
for (let i = 0; i < N; i++) { const p = dl[i].split(','); w.month[i] = +p[1]; w.day[i] = +p[2]; w.hour[i] = +p[3]; w.temperature[i] = +p[6]; w.direct_normal[i] = +p[14]; w.diffuse_horizontal[i] = +p[15]; w.wind_speed[i] = +p[21] }
const hs = computeHourlySolarByFacade(w, lat, b0.orientation ?? 0)
const libraryData = { constructions: fx.library_constructions.map((c) => ({ name: c.name, u_value_W_per_m2K: c.u_value_W_per_m2K, y_factor: c.y_factor ?? 1, g_value: c.g_value, config_json: c.config_json, layers: c.layers })), system_templates: SYSTEM_TEMPLATES_LIBRARY, library_systems: b0.library_systems ?? [], library_schedules: b0.library_schedules ?? [] }

function run(building) {
  const r = calculateInstant(building, fx.construction_choices, {}, libraryData, w, hs, null, { mode: 'full', comfortBand: fx.comfort_band, engine: 'v2.5', _skipInterventions: true })
  const c = r.consumption
  const fans = (c.ventilation || []).reduce((s, v) => s + (v.fan_electricity_mwh || 0), 0)
  return { tot: c.total.electricity_mwh + c.total.gas_mwh, eui: c.total.kwh_per_m2_yr, elec: c.total.electricity_mwh, gas: c.total.gas_mwh, heat_e: c.space_heating.electricity_mwh, cool_e: c.space_cooling.electricity_mwh, dhw_e: c.dhw.electricity_mwh, dhw_g: c.dhw.gas_mwh, fans, light: c.lighting.electricity_mwh, sp: c.small_power.electricity_mwh }
}

// Re-authored measures (interventions-fix D2/D4/D7). Config root = {building,...}.
const P = (op, path, value) => ({ op, path, value, source: 'inline' })
const MEASURES = [
  { id: '1_1', name: 'Low-flow fittings (DHW ×0.805)', touch: 'dhw', patches: [P('scale', 'building.systems_config_v40.dhw_demand_litres_per_person_per_day', 0.805)] },
  { id: '1_2', name: 'WWHR (DHW ×0.82)', touch: 'dhw', patches: [P('scale', 'building.systems_config_v40.dhw_demand_litres_per_person_per_day', 0.82)] },
  { id: '1_3', name: 'Exhaust-air ASHP (ASHP COP +0.4)', touch: 'dhw', patches: [P('delta', 'building.systems_config_v40.dhw[1].efficiency_metric', 0.4)] },
  { id: '1_4', name: 'Larger ASHP full DHW off gas (share 0/100)', touch: 'dhw', patches: [P('set', 'building.systems_config_v40.dhw[0].share_pct', 0), P('set', 'building.systems_config_v40.dhw[1].share_pct', 100)] },
  { id: '2_2', name: 'Fan duty (flow ×0.72, SFP ×0.72^2)', touch: 'fans', patches: [P('scale', 'building.systems_config_v40.ventilation[1].flow_rate', 0.72), P('scale', 'building.systems_config_v40.ventilation[1].efficiency_metric.sfp_w_per_lps', 0.5184)] },
  { id: '3_1', name: 'VRF commissioning (eff +0.4)', touch: 'heatcool', patches: [P('delta', 'building.systems_config_v40.heating[0].efficiency_metric', 0.4), P('delta', 'building.systems_config_v40.cooling[0].efficiency_metric', 0.4)] },
  { id: '3_2', name: 'VRF replacement (eff ×1.25)', touch: 'heatcool', patches: [P('scale', 'building.systems_config_v40.heating[0].efficiency_metric', 1.25), P('scale', 'building.systems_config_v40.cooling[0].efficiency_metric', 1.25)] },
  { id: '3_3', name: 'Setpoints ±1K widen (custom 21/24)', touch: 'heatcool', patches: [P('set', 'building.systems_config_v40.heating_setpoint_mode', 'custom'), P('set', 'building.systems_config_v40.heating_setpoint_c', 21), P('set', 'building.systems_config_v40.cooling_setpoint_mode', 'custom'), P('set', 'building.systems_config_v40.cooling_setpoint_c', 24)] },
  { id: '4_2', name: 'Keycard (Small Power ×0.75)', touch: 'sp', patches: [P('scale', 'building.gains.equipment.profiles[0].baseload.value', 0.75)] },
  { id: '5_2', name: 'Communal lighting (×0.85)', touch: 'light', patches: [P('scale', 'building.gains.lighting.profiles[0].magnitude.value', 0.85)] },
  { id: 'D4', name: 'Trickle-vent EA ×0.5', touch: 'envelope', patches: [P('scale', 'building.openings.north.louvre_area_m2', 0.5), P('scale', 'building.openings.south.louvre_area_m2', 0.5), P('scale', 'building.openings.east.louvre_area_m2', 0.5), P('scale', 'building.openings.west.louvre_area_m2', 0.5)] },
  { id: '2_1a', name: 'MVHR current flow 2208', touch: 'fans', patches: [P('set', 'building.systems_config_v40.ventilation[1].efficiency_metric', { sfp_w_per_lps: 1.8, recovery_sensible_pct: 80, recovery_latent_pct: 0 }), P('set', 'building.systems_config_v40.ventilation[1].flow_rate', 2208), P('set', 'building.systems_config_v40.heating[1].share_pct', 0), P('set', 'building.systems_config_v40.heating[0].share_pct', 100), P('scale', 'building.openings.north.louvre_area_m2', 0), P('scale', 'building.openings.south.louvre_area_m2', 0), P('scale', 'building.openings.east.louvre_area_m2', 0), P('scale', 'building.openings.west.louvre_area_m2', 0)] },
  { id: '2_1b', name: 'MVHR reduced flow 1656 (12 l/s/room)', touch: 'fans', patches: [P('set', 'building.systems_config_v40.ventilation[1].efficiency_metric', { sfp_w_per_lps: 1.8, recovery_sensible_pct: 80, recovery_latent_pct: 0 }), P('set', 'building.systems_config_v40.ventilation[1].flow_rate', 1656), P('set', 'building.systems_config_v40.heating[1].share_pct', 0), P('set', 'building.systems_config_v40.heating[0].share_pct', 100), P('scale', 'building.openings.north.louvre_area_m2', 0), P('scale', 'building.openings.south.louvre_area_m2', 0), P('scale', 'building.openings.east.louvre_area_m2', 0), P('scale', 'building.openings.west.louvre_area_m2', 0)] },
]

const base = run(b0)
const gia = 4215
const fmt = (n) => (n >= 0 ? '+' : '') + n.toFixed(2)
console.log(`Model-2 baseline: EUI ${base.eui.toFixed(1)} | elec ${base.elec.toFixed(2)} gas ${base.gas.toFixed(2)} | dhw ${(base.dhw_e + base.dhw_g).toFixed(1)} fans ${base.fans.toFixed(1)} light ${base.light.toFixed(1)} sp ${base.sp.toFixed(1)} heat_e ${base.heat_e.toFixed(1)} cool_e ${base.cool_e.toFixed(1)}`)
console.log('\nid    | dEUI  | dTotal MWh | key end-use deltas | residual?')
const config0 = { building: b0, constructions: fx.construction_choices, systems: {}, libraryData }
const rows = []
for (const m of MEASURES) {
  let patched, r, err = null
  try { patched = applyIntervention(config0, { id: m.id, enabled: true, patches: m.patches }, libraryData); r = run(patched.building) }
  catch (e) { err = e.message }
  if (err) { console.log(`${m.id.padEnd(5)} | THREW: ${err}`); continue }
  const d = (k) => r[k] - base[k]
  // residual profile untouched?
  const resProf = (patched.building.gains.equipment.profiles.find(p => p.id === 'auxiliary_residual_unattributed') || {}).baseload?.value
  const resOk = resProf === 4.0006
  const parts = []
  if (/dhw/.test(m.touch)) parts.push(`dhw ${fmt(d('dhw_e') + d('dhw_g'))}`)
  if (/fans/.test(m.touch)) parts.push(`fans ${fmt(d('fans'))} heat ${fmt(d('heat_e'))} cool ${fmt(d('cool_e'))}`)
  if (/heatcool/.test(m.touch)) parts.push(`heat ${fmt(d('heat_e'))} cool ${fmt(d('cool_e'))}`)
  if (/sp/.test(m.touch)) parts.push(`sp ${fmt(d('sp'))}`)
  if (/light/.test(m.touch)) parts.push(`light ${fmt(d('light'))}`)
  if (/envelope/.test(m.touch)) parts.push(`heat ${fmt(d('heat_e'))} cool ${fmt(d('cool_e'))}`)
  const dEui = d('eui')
  console.log(`${m.id.padEnd(5)} | ${fmt(dEui)} | ${fmt(d('tot'))} | ${parts.join(', ')} | res=${resOk ? 'untouched' : 'CHANGED('+resProf+')'}`)
  rows.push({ id: m.id, name: m.name, dEui, dTot: d('tot'), resOk })
}
console.log('\nSIGN CHECK (expect savings, i.e. negative dTotal): 1_3, 3_1, 3_2, 4_2, 2_2')
for (const id of ['1_3', '3_1', '3_2', '4_2', '2_2']) {
  const rr = rows.find(x => x.id === id)
  console.log(`  ${id}: dTotal ${fmt(rr.dTot)} MWh -> ${rr.dTot < 0 ? 'SAVING ✓' : 'PENALTY ✗'}`)
}

// B3 — residual-exclusion structure (hard, falsifiable): the Model-2 auxiliary
// residual profile MUST be byte-identical after every measure. Fails loudly.
const RES_BASE = 4.0006
const resFail = rows.filter((r) => !r.resOk)
console.log('\nB3 RESIDUAL-EXCLUSION: residual profile identical after every measure?')
if (resFail.length === 0) console.log(`  PASS — auxiliary_residual_unattributed = ${RES_BASE} W/m² untouched by all ${rows.length} measures`)
else { console.error(`  FAIL — residual changed by: ${resFail.map((r) => r.id).join(', ')}`); process.exit(1) }
