/**
 * Brief 62 follow-up — reproduce Chris's screenshot scenario.
 * From the Energy Flows panel:
 *   Lighting     102.0 MWh  → cf ≈ 76.5 × cf = 102.0  → cf ≈ 1.333
 *   Small power  116.7 MWh  → cf ≈ 78.9 × cf = 116.7  → cf ≈ 1.480
 *   Cooling demand 397.3 MWh
 *   No heating row visible
 *   Σ elec 362.0  Σ gas 147.7
 *
 * Hunt for the exact cf combination + setpoint/vent state that
 * reproduces 397.3 cooling demand. Check whether it exceeds the
 * total gains bound (= bug).
 *
 * Read-only.
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
  const gain_people = (ig?.people?.kwh ?? 0) / 1000
  const gain_light  = (ig?.lighting?.kwh ?? 0) / 1000
  const gain_equip  = (ig?.equipment?.kwh ?? 0) / 1000
  const gain_solar  = (sg?.total_kwh ?? 0) / 1000
  const gain_total  = gain_people + gain_light + gain_equip + gain_solar
  return {
    label,
    demand_h: pn(r, 'consumption.space_heating.demand_mwh'),
    demand_c: pn(r, 'consumption.space_cooling.demand_mwh'),
    delivered_c: pn(r, 'consumption.space_cooling.delivered_mwh'),
    cool_elec_mwh: pn(r, 'consumption.space_cooling.electricity_mwh'),
    total_elec: pn(r, 'consumption.total.electricity_mwh'),
    total_gas: pn(r, 'consumption.total.gas_mwh'),
    gain_people, gain_light, gain_equip, gain_solar, gain_total,
    ratio_demand_over_gain: gain_total > 0 ? (pn(r, 'consumption.space_cooling.demand_mwh') ?? 0) / gain_total : null,
  }
}

const TARGET_LIGHT = 102.0
const TARGET_SP    = 116.7
const TARGET_COOL  = 397.3

// Scenarios moving toward the screenshot
const sweeps = [
  ['baseline (cf=0.86 light, 1.0 sp, vent on, follow_comfort)', null],
  ['screenshot-match: vent OFF + light_cf=1.333 + sp_cf=1.480 + heating disabled + cool=14',
    b => {
      for (const v of (b.systems_config_v40?.ventilation ?? [])) v.enabled = false
      for (const v of (b.systems_config_v25?.ventilation ?? [])) v.enabled = false
      for (const s of (b.systems_config_v40?.lighting ?? [])) s.control_factor = 1.333
      for (const s of (b.systems_config_v40?.small_power ?? [])) s.control_factor = 1.480
      for (const s of (b.systems_config_v40?.heating ?? [])) s.enabled = false
      b.systems_config_v40.cooling_setpoint_mode = 'custom'
      b.systems_config_v40.cooling_setpoint_c = 14
    }],
  ['variant: same as above + heating still ON',
    b => {
      for (const v of (b.systems_config_v40?.ventilation ?? [])) v.enabled = false
      for (const v of (b.systems_config_v25?.ventilation ?? [])) v.enabled = false
      for (const s of (b.systems_config_v40?.lighting ?? [])) s.control_factor = 1.333
      for (const s of (b.systems_config_v40?.small_power ?? [])) s.control_factor = 1.480
      b.systems_config_v40.cooling_setpoint_mode = 'custom'
      b.systems_config_v40.cooling_setpoint_c = 14
    }],
  ['variant: vent OFF + cfs + cool=18',
    b => {
      for (const v of (b.systems_config_v40?.ventilation ?? [])) v.enabled = false
      for (const v of (b.systems_config_v25?.ventilation ?? [])) v.enabled = false
      for (const s of (b.systems_config_v40?.lighting ?? [])) s.control_factor = 1.333
      for (const s of (b.systems_config_v40?.small_power ?? [])) s.control_factor = 1.480
      b.systems_config_v40.cooling_setpoint_mode = 'custom'
      b.systems_config_v40.cooling_setpoint_c = 18
    }],
  ['variant: vent OFF + cfs + cool=24 (follow_comfort)',
    b => {
      for (const v of (b.systems_config_v40?.ventilation ?? [])) v.enabled = false
      for (const v of (b.systems_config_v25?.ventilation ?? [])) v.enabled = false
      for (const s of (b.systems_config_v40?.lighting ?? [])) s.control_factor = 1.333
      for (const s of (b.systems_config_v40?.small_power ?? [])) s.control_factor = 1.480
    }],
]

console.log('Brief 62 follow-up — match Chris\'s screenshot')
console.log('TARGET: demand_c=397.3, light=102.0, sp=116.7, Σelec=362, Σgas=147.7')
console.log('='.repeat(140))
const results = []
for (const [label, mutate] of sweeps) {
  const s = runOnce(label, mutate)
  results.push(s)
  const matchCool = (s.demand_c >= 380 && s.demand_c <= 415) ? ' ← MATCHES ~397' : ''
  const matchLight = (s.gain_light >= 100 && s.gain_light <= 104) ? ' ✓light' : ''
  const matchSp = (s.gain_equip >= 114 && s.gain_equip <= 119) ? ' ✓sp' : ''
  const exceedsBound = (s.demand_c > s.gain_total) ? ' 🔥 UNPHYSICAL — demand > total gains' : ''
  console.log(`  ${s.label}`)
  console.log(`     demand_c=${(s.demand_c ?? 0).toFixed(1)}  light=${s.gain_light.toFixed(1)}  sp=${s.gain_equip.toFixed(1)}  solar=${s.gain_solar.toFixed(1)}  total_gain=${s.gain_total.toFixed(1)}  ratio=${(s.ratio_demand_over_gain ?? 0).toFixed(2)}  Σelec=${(s.total_elec ?? 0).toFixed(1)}  Σgas=${(s.total_gas ?? 0).toFixed(1)}${matchCool}${matchLight}${matchSp}${exceedsBound}`)
}
console.log()
const closest = results.reduce((best, r) => {
  const d = Math.abs((r.demand_c ?? 0) - TARGET_COOL)
  const dBest = Math.abs((best.demand_c ?? 0) - TARGET_COOL)
  return d < dBest ? r : best
})
console.log(`Closest to 397.3: "${closest.label}"  demand_c=${(closest.demand_c ?? 0).toFixed(1)}  diff=${((closest.demand_c ?? 0) - TARGET_COOL).toFixed(1)}`)
console.log()

// Most important question: does any reproduction show demand > gain (the unphysical case)?
const anyUnphysical = results.find(r => r.demand_c > r.gain_total)
if (anyUnphysical) {
  console.log('🔥 FOUND unphysical scenario:')
  console.log('  ' + anyUnphysical.label)
  console.log('  demand_c=' + (anyUnphysical.demand_c ?? 0).toFixed(1) + '  total_gain=' + anyUnphysical.gain_total.toFixed(1) + '  excess=' + ((anyUnphysical.demand_c ?? 0) - anyUnphysical.gain_total).toFixed(1) + ' MWh')
  console.log('  This IS a bug — cooling demand cannot exceed available heat input.')
} else {
  console.log('No reproduced scenario has cooling demand > total gains. All within bound in my probes.')
}

fs.writeFileSync(path.join(REPO_ROOT, 'docs/audit/62_screenshot_match.json'), JSON.stringify({
  generated_at: new Date().toISOString(),
  target: { cooling_demand_mwh: TARGET_COOL, lighting_mwh: TARGET_LIGHT, sp_mwh: TARGET_SP },
  results,
  closest: closest.label,
  any_unphysical: !!anyUnphysical,
}, null, 2))
console.log('Wrote docs/audit/62_screenshot_match.json')
