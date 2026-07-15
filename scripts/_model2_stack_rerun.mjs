// B4 — re-run the PERSISTED interventions isolated vs Model 2 through the
// production runInterventionStack + computeDelta path (interventions-fix D6).
// Verifies B2's persistence AND produces the report 4.8 table. Read-only.
//   node scripts/_model2_stack_rerun.mjs <model2_ints_fixture.json>
import fs from 'node:fs'
const R = 'file:///C:/Users/ChrisScott/Dev/nza-sim/frontend/src'
const { calculateInstant } = await import(`${R}/utils/instantCalc.js`)
const { computeHourlySolarByFacade } = await import(`${R}/utils/solarCalc.js`)
const { SYSTEM_TEMPLATES_LIBRARY } = await import(`${R}/data/systemTemplatesLibrary.js`)
const { runInterventionStack } = await import(`${R}/utils/interventionsEngine.js`)
const fx = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'))
const REPO = 'C:/Users/ChrisScott/Dev/nza-sim'
const b0 = fx.building_config
const epw = fs.readFileSync(`${REPO}/data/weather/current/${b0.weather_file}`, 'utf-8').split(/\r?\n/)
const lat = parseFloat(epw[0].split(',')[6]); const dl = epw.slice(8).filter((l) => l.trim()); const N = dl.length
const w = { temperature: new Float32Array(N), direct_normal: new Float32Array(N), diffuse_horizontal: new Float32Array(N), wind_speed: new Float32Array(N), month: new Int8Array(N), day: new Int8Array(N), hour: new Int8Array(N) }
for (let i = 0; i < N; i++) { const p = dl[i].split(','); w.month[i] = +p[1]; w.day[i] = +p[2]; w.hour[i] = +p[3]; w.temperature[i] = +p[6]; w.direct_normal[i] = +p[14]; w.diffuse_horizontal[i] = +p[15]; w.wind_speed[i] = +p[21] }
const hs = computeHourlySolarByFacade(w, lat, b0.orientation ?? 0)
const libraryData = { constructions: fx.library_constructions.map((c) => ({ name: c.name, u_value_W_per_m2K: c.u_value_W_per_m2K, y_factor: c.y_factor ?? 1, g_value: c.g_value, config_json: c.config_json, layers: c.layers })), system_templates: SYSTEM_TEMPLATES_LIBRARY, library_systems: b0.library_systems ?? [], library_schedules: b0.library_schedules ?? [] }
const runEngine = (cfg) => calculateInstant(cfg.building, cfg.constructions, cfg.systems ?? {}, libraryData, w, hs, null, { mode: 'full', comfortBand: fx.comfort_band, engine: 'v2.5', _skipInterventions: true })
const baselineConfig = { building: b0, constructions: fx.construction_choices, systems: {}, libraryData }

const fmt = (n) => (n == null ? ' n/a ' : (n >= 0 ? '+' : '') + n.toFixed(2))
const withPatches = fx.interventions.filter((i) => (i.patches || []).length > 0)
console.log(`Model-2 interventions with patches: ${withPatches.length}\n`)
console.log('id            | dEUI  | dElec | dGas  | dTotal MWh')
let threw = 0
for (const iv of withPatches) {
  let d
  try {
    const iso = runInterventionStack(baselineConfig, [{ ...iv, enabled: true }], runEngine, libraryData)
    d = iso.interventions[0].cumulative_delta
  } catch (e) { console.log(`${iv.id.padEnd(13)} | THREW: ${e.message}`); threw++; continue }
  const eui = d.eui_kwh_per_m2?.delta
  const el = d.per_fuel?.electricity_mwh?.delta
  const gs = d.per_fuel?.gas_mwh?.delta
  const tot = (el ?? 0) + (gs ?? 0)
  console.log(`${iv.id.padEnd(13)} | ${fmt(eui)} | ${fmt(el)} | ${fmt(gs)} | ${fmt(tot)}`)
}
console.log(`\n${threw} threw. Sign-flip check (must be savings): 1_3 3_1 3_2 4_2 2_2 (see rows above).`)
