// Final-P02 Part 4/6 — conservation + residual-untouched, reading the
// RE-AUTHORED fx.interventions (not hardcoded). Applies each measure alone via
// the production applyIntervention, checks residual byte-identity + per-end-use.
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
const runEngine = (cfg) => calculateInstant(cfg.building, cfg.constructions, cfg.systems ?? {}, libraryData, w, hs, null, { mode: 'full', comfortBand: fx.comfort_band, engine: 'v2.5', _skipInterventions: true })
const enduse = (c) => ({ dhw: c.dhw.electricity_mwh + c.dhw.gas_mwh, fans: (c.ventilation || []).reduce((s, v) => s + (v.fan_electricity_mwh || 0), 0), light: c.lighting.electricity_mwh, sp: c.small_power.electricity_mwh, heat: c.space_heating.electricity_mwh, cool: c.space_cooling.electricity_mwh })
const resVal = (b) => (b.gains?.equipment?.profiles?.find(p => p.id === 'auxiliary_residual_unattributed') || {}).baseload?.value

const baseCfg = { building: b0, constructions: fx.construction_choices, systems: {} }
const base = enduse(runEngine(baseCfg).consumption)
const RES_BASE = resVal(b0)
console.log('residual base =', RES_BASE, 'W/m²\n')
console.log('id                          | dEUI  | end-use deltas (MWh)                         | residual')
const fmt = n => (n >= 0 ? '+' : '') + n.toFixed(2)
let resFail = []
for (const iv of fx.interventions.filter(i => (i.patches || []).length > 0)) {
  const cfg = applyIntervention(baseCfg, { ...iv, enabled: true }, libraryData)
  const c = runEngine(cfg).consumption
  const eu = enduse(c)
  const res = resVal(cfg.building)
  if (Math.abs((res ?? 0) - (RES_BASE ?? 0)) > 1e-9) resFail.push(iv.id)
  const deltas = ['dhw', 'fans', 'light', 'sp', 'heat', 'cool'].filter(k => Math.abs(eu[k] - base[k]) > 0.01).map(k => `${k} ${fmt(eu[k] - base[k])}`).join('  ')
  console.log(`${iv.id.padEnd(27)} | ${(c.total.kwh_per_m2_yr - 185.1).toFixed(2).padStart(5)} | ${deltas.padEnd(44)} | ${res === RES_BASE ? 'untouched' : 'CHANGED'}`)
}
console.log(`\nRESIDUAL: ${resFail.length === 0 ? 'PASS — untouched by every measure' : 'FAIL — ' + resFail.join(', ')}`)
