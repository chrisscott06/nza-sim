/**
 * Brief 60 Part A walkthrough finding — reconcile per-service electricity
 * deltas against the FUEL TOTALS row.
 *
 * Reads Bridgewater + its on-disk intervention stack, computes baseline
 * vs final cumulative result, surfaces every electricity-bearing field
 * with its delta, sums them and compares to consumption.total
 * .electricity_mwh delta. Read-only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'
import {
  runInterventionStack,
  migrateInterventionPatches,
} from '../frontend/src/utils/interventionsEngine.js'

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

const baselineForDiff = { systems_config_v40: baseBuilding.systems_config_v40 }
const stack = (baseBuilding.interventions ?? []).map(intv => {
  const from = Number.isInteger(intv?.schema_version) ? intv.schema_version : 1
  return migrateInterventionPatches(intv, from, 3, baselineForDiff)
})
function runEngine(cfg) {
  return calculateInstant(cfg.building, cfg.constructions, cfg.systems, cfg.libraryData,
    weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand: cb, _skipInterventions: true })
}
const baselineCfg = { building: baseBuilding, constructions, systems: {}, libraryData }
const stackResult = runInterventionStack(baselineCfg, stack, runEngine, libraryData)

const before = stackResult.baseline
let lastEnabledIdx = -1
for (let i = stackResult.interventions.length - 1; i >= 0; i--) {
  if (stackResult.interventions[i]?.enabled !== false && stackResult.interventions[i]?.result) { lastEnabledIdx = i; break }
}
const after = lastEnabledIdx >= 0 ? stackResult.interventions[lastEnabledIdx].result : before

console.log('Stack: ' + stack.map((i, idx) => (idx + 1) + '. ' + i.label + (i.enabled === false ? '(off)' : '')).join(' -> '))
console.log()

function pn(r, p) { let c = r; for (const s of p.split('.')) { if (c == null) return null; c = c[s] } return (typeof c === 'number' && Number.isFinite(c)) ? c : null }

const lines = []
function show(label, before_v, after_v) {
  const d = (after_v ?? 0) - (before_v ?? 0)
  lines.push({ label, before: before_v, after: after_v, delta: d })
}

show('consumption.space_heating.electricity_mwh', pn(before, 'consumption.space_heating.electricity_mwh'), pn(after, 'consumption.space_heating.electricity_mwh'))
show('consumption.space_cooling.electricity_mwh', pn(before, 'consumption.space_cooling.electricity_mwh'), pn(after, 'consumption.space_cooling.electricity_mwh'))
show('consumption.dhw.electricity_mwh',           pn(before, 'consumption.dhw.electricity_mwh'),           pn(after, 'consumption.dhw.electricity_mwh'))
show('consumption.dhw.circulation_pump_mwh',      pn(before, 'consumption.dhw.circulation_pump_mwh'),      pn(after, 'consumption.dhw.circulation_pump_mwh'))
show('consumption.lighting.electricity_mwh',      pn(before, 'consumption.lighting.electricity_mwh'),      pn(after, 'consumption.lighting.electricity_mwh'))
show('consumption.small_power.electricity_mwh',   pn(before, 'consumption.small_power.electricity_mwh'),   pn(after, 'consumption.small_power.electricity_mwh'))

const before_fan_v25 = (before?.consumption?.ventilation ?? []).reduce((s, v) => s + (Number(v?.fan_electricity_mwh) || 0), 0)
const after_fan_v25  = (after?.consumption?.ventilation  ?? []).reduce((s, v) => s + (Number(v?.fan_electricity_mwh) || 0), 0)
show('SUM consumption.ventilation[].fan_electricity_mwh (v25 SFP path)', before_fan_v25, after_fan_v25)
show('consumption.brief40.ventilation.total_fan_electrical_mwh (v40 SFP path)', pn(before, 'consumption.brief40.ventilation.total_fan_electrical_mwh'), pn(after, 'consumption.brief40.ventilation.total_fan_electrical_mwh'))

show('consumption.total.electricity_mwh', pn(before, 'consumption.total.electricity_mwh'), pn(after, 'consumption.total.electricity_mwh'))
show('consumption.brief40.totals.fuel_split.electricity_kWh / 1000',
     (pn(before, 'consumption.brief40.totals.fuel_split.electricity_kWh') ?? 0) / 1000,
     (pn(after,  'consumption.brief40.totals.fuel_split.electricity_kWh') ?? 0) / 1000)

console.log('Per-electricity-term -- baseline / after / delta MWh')
console.log('-'.repeat(120))
for (const r of lines) {
  const b = r.before != null ? r.before.toFixed(3) : '-'
  const a = r.after  != null ? r.after.toFixed(3)  : '-'
  const d = r.delta != null ? (r.delta >= 0 ? '+' : '') + r.delta.toFixed(3) : '-'
  console.log('  ' + r.label.padEnd(75) + '  ' + b.padStart(10) + '  ' + a.padStart(10) + '  ' + d.padStart(10))
}
console.log()

const get = (sub) => (lines.find(l => l.label.includes(sub))?.delta ?? 0)
const dHeat    = get('space_heating.electricity')
const dCool    = get('space_cooling.electricity')
const dDhwElec = lines.find(l => l.label === 'consumption.dhw.electricity_mwh')?.delta ?? 0
const dDhwPump = get('circulation_pump')
const dLight   = get('lighting.electricity')
const dSp      = get('small_power.electricity')
const dFan_b40 = get('brief40.ventilation.total_fan_electrical_mwh')
const dFan_v25 = get('SUM consumption.ventilation')
const dTotal   = lines.find(l => l.label === 'consumption.total.electricity_mwh')?.delta ?? 0
const dB40Tot  = get('brief40.totals.fuel_split.electricity_kWh')

const sum_using_b40 = dHeat + dCool + dDhwElec + dDhwPump + dLight + dSp + dFan_b40
const sum_using_v25 = dHeat + dCool + dDhwElec + dDhwPump + dLight + dSp + dFan_v25

console.log('Sum using brief40 fan (what new panel reads): ' + sum_using_b40.toFixed(3) + '  vs consumption.total delta = ' + dTotal.toFixed(3) + '  -> unexplained = ' + (dTotal - sum_using_b40).toFixed(3))
console.log('Sum using v25 fan (consumption.ventilation[]): ' + sum_using_v25.toFixed(3) + '  vs consumption.total delta = ' + dTotal.toFixed(3) + '  -> unexplained = ' + (dTotal - sum_using_v25).toFixed(3))
console.log('brief40 totals path delta: ' + dB40Tot.toFixed(3) + '  vs consumption.total delta = ' + dTotal.toFixed(3))
console.log()
console.log('Hypotheses ranked by absolute delta contribution:')
const contribs = [
  ['DHW circulation pump (not surfaced in panel)', dDhwPump],
  ['v25 fan minus brief40 fan (SFP source mismatch)', dFan_v25 - dFan_b40],
  ['Heating elec', dHeat],
  ['Cooling elec', dCool],
  ['Fan (brief40 - what panel reads)', dFan_b40],
  ['Fan (v25 - what total sums?)', dFan_v25],
  ['DHW elec (boiler/heat-pump)', dDhwElec],
  ['Lighting elec', dLight],
  ['Small power elec', dSp],
]
contribs.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).forEach(([k, v]) => console.log('  ' + k.padEnd(50) + ' = ' + (v >= 0 ? '+' : '') + v.toFixed(3) + ' MWh'))

fs.writeFileSync(path.join(REPO_ROOT, 'docs/audit/60_a_reconcile.json'), JSON.stringify({
  stack: stack.map(i => ({ id: i.id, label: i.label, enabled: i.enabled })),
  per_term_lines: lines,
  diffs: { dHeat, dCool, dDhwElec, dDhwPump, dLight, dSp, dFan_b40, dFan_v25, dTotal, dB40Tot,
           sum_using_b40, sum_using_v25,
           unexplained_b40: dTotal - sum_using_b40, unexplained_v25: dTotal - sum_using_v25 },
  baseline_consumption: before?.consumption,
  after_consumption: after?.consumption,
}, null, 2))
console.log()
console.log('Wrote docs/audit/60_a_reconcile.json (full consumption sub-blocks for both states)')
