/**
 * Brief 62 follow-up — hunt for the ~400 MWh cooling demand scenario.
 *
 * My earlier probe (scripts/_brief62_vent_off_diag.mjs) got vent-off
 * cooling demand 135.8 MWh on plain Bridgewater. Chris reports ~400.
 * Trying combinations to see which (if any) produces ~400 — or to
 * confirm none does. Read-only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const API = 'http://127.0.0.1:8003'
const PID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
async function fj(u) { const r = await fetch(u); return r.json() }

const project = await fj(`${API}/api/projects/${PID}`)
const lib = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []
const constructions = project.construction_choices
const cb = { lower_c: project.comfort_band_lower_c ?? 20, upper_c: project.comfort_band_upper_c ?? 26 }
const baseBuilding = JSON.parse(JSON.stringify(project.building_config))
const weatherFile = baseBuilding.weather_file || project.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month=new Int8Array(N), day=new Int8Array(N), hour=new Int8Array(N)
const temperature=new Float32Array(N), direct_normal=new Float32Array(N)
const diffuse_horizontal=new Float32Array(N), wind_speed=new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i]=parseInt(p[1]); day[i]=parseInt(p[2]); hour[i]=parseInt(p[3])
  temperature[i]=parseFloat(p[6]); direct_normal[i]=parseFloat(p[14])
  diffuse_horizontal[i]=parseFloat(p[15]); wind_speed[i]=parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, Number(baseBuilding.orientation ?? 0))
const libraryData = {
  constructions: libArr.map(c => ({ name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K, y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0, g_value: c.config_json?.g_value, config_json: c.config_json ?? c, layers: c.layers })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
}
function pn(r, p) { let c = r; for (const s of p.split('.')) { if (c == null) return null; c = c[s] } return (typeof c === 'number' && Number.isFinite(c)) ? c : null }
function runOnce(label, mutate) {
  const b = JSON.parse(JSON.stringify(baseBuilding))
  if (typeof mutate === 'function') mutate(b)
  const r = calculateInstant(b, constructions, {}, libraryData, weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand: cb, _skipInterventions: true })
  const ig = r?.heat_balance?.annual?.gains?.internal ?? {}
  const sg = r?.heat_balance?.annual?.gains?.solar ?? {}
  const gain_total = ((ig?.people?.kwh ?? 0) + (ig?.lighting?.kwh ?? 0) + (ig?.equipment?.kwh ?? 0) + (sg?.total_kwh ?? 0)) / 1000
  return {
    label,
    demand_h: pn(r, 'consumption.space_heating.demand_mwh'),
    demand_c: pn(r, 'consumption.space_cooling.demand_mwh'),
    delivered_h: pn(r, 'consumption.space_heating.delivered_mwh'),
    delivered_c: pn(r, 'consumption.space_cooling.delivered_mwh'),
    cool_elec_mwh: pn(r, 'consumption.space_cooling.electricity_mwh'),
    eui: pn(r, 'consumption.total.kwh_per_m2_yr'),
    gain_total,
  }
}
function disableVent(b) {
  for (const v of (b.systems_config_v40?.ventilation ?? [])) v.enabled = false
  for (const v of (b.systems_config_v25?.ventilation ?? [])) v.enabled = false
}
function setCustomSp(b, h, c) {
  if (h != null) { b.systems_config_v40.heating_setpoint_mode = 'custom'; b.systems_config_v40.heating_setpoint_c = h }
  if (c != null) { b.systems_config_v40.cooling_setpoint_mode = 'custom'; b.systems_config_v40.cooling_setpoint_c = c }
}
function bumpGains(b, factor) {
  for (const s of (b.systems_config_v40?.lighting ?? [])) s.control_factor = factor
  for (const s of (b.systems_config_v40?.small_power ?? [])) s.control_factor = factor
}

const scenarios = [
  // Plain
  ['A0 plain baseline', null],
  ['A1 vent OFF (no other change)', b => disableVent(b)],
  // Setpoint combinations
  ['B1 vent OFF + cool=18 custom', b => { disableVent(b); setCustomSp(b, null, 18) }],
  ['B2 vent OFF + cool=18 + heat=21 explicit', b => { disableVent(b); setCustomSp(b, 21, 18) }],
  ['B3 vent OFF + cool=15 custom (very low)', b => { disableVent(b); setCustomSp(b, null, 15) }],
  // Combinations with gain bump
  ['C1 vent OFF + cool=18 + gain bump 1.5x (lighting+sp)', b => { disableVent(b); setCustomSp(b, null, 18); bumpGains(b, 1.5) }],
  ['C2 vent OFF + cool=15 + gain bump 2.0x', b => { disableVent(b); setCustomSp(b, null, 15); bumpGains(b, 2.0) }],
  ['C3 vent OFF + cool=15 + gain bump 3.0x', b => { disableVent(b); setCustomSp(b, null, 15); bumpGains(b, 3.0) }],
  // Reverse polarity: heating system OFF + vent off + everything pushing cooling
  ['D1 vent OFF + cool=18 + ALL heating systems disabled', b => {
    disableVent(b); setCustomSp(b, null, 18)
    for (const s of (b.systems_config_v40?.heating ?? [])) s.enabled = false
  }],
  // Reverse comfort band — low cool upper, ridiculous gain bump
  ['E1 vent OFF + cool=15 + gain 3x + ALL heating OFF', b => {
    disableVent(b); setCustomSp(b, null, 15); bumpGains(b, 3.0)
    for (const s of (b.systems_config_v40?.heating ?? [])) s.enabled = false
  }],
  // Solar amplification (envelope opening?)
  ['F1 vent OFF + cool=18 + 3x WWR via override', b => {
    disableVent(b); setCustomSp(b, null, 18)
    // Triple WWR — drastically increase solar gain entry
    if (b.wwr != null) b.wwr = Math.min(0.95, b.wwr * 3)
  }],
]

console.log('Brief 62 follow-up — Hunt for ~400 MWh cooling demand on Bridgewater')
console.log('='.repeat(120))
const results = []
for (const [label, mutate] of scenarios) {
  const s = runOnce(label, mutate)
  results.push(s)
  const flag = (s.demand_c >= 380 && s.demand_c <= 420) ? ' ← MATCHES ~400' : (s.demand_c > s.gain_total) ? ' ← EXCEEDS GAINS (unphysical)' : ''
  console.log(`  ${s.label.padEnd(70)} demand_c=${(s.demand_c ?? 0).toFixed(1).padStart(8)}  delivered_c=${(s.delivered_c ?? 0).toFixed(1).padStart(8)}  cool_elec=${(s.cool_elec_mwh ?? 0).toFixed(1).padStart(8)}  total_gain=${(s.gain_total ?? 0).toFixed(1).padStart(8)}  EUI=${(s.eui ?? 0).toFixed(1).padStart(7)}${flag}`)
}
console.log()
const maxDemand = Math.max(...results.map(r => r.demand_c ?? 0))
const maxScenario = results.find(r => (r.demand_c ?? 0) === maxDemand)
console.log(`Maximum cooling demand across all scenarios: ${maxDemand.toFixed(1)} MWh  (${maxScenario?.label})`)
const anyHit = results.find(r => r.demand_c >= 380 && r.demand_c <= 420)
if (anyHit) console.log(`✓ Found a ~400 MWh match: ${anyHit.label}`)
else console.log(`✗ No scenario produces ~400 MWh cooling demand on Bridgewater. Max ${maxDemand.toFixed(1)} MWh under the tested permutations.`)

fs.writeFileSync(path.join(REPO_ROOT, 'docs/audit/62_400_hunt.json'), JSON.stringify({
  generated_at: new Date().toISOString(),
  comfortBand: cb,
  results,
  max_demand_mwh: maxDemand,
  hit_400: !!anyHit,
}, null, 2))
console.log('Wrote docs/audit/62_400_hunt.json')
