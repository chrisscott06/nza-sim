/**
 * T1 — NZA-Sim isolated runs for the 5 measures vs report_baseline_v1.
 * Pure consumer of the NZA engine (calculateInstant + runInterventionStack). No engine
 * change. Mirrors scripts/report/run_nza.mjs setup exactly. Output: docs/audit/T1_nza_runs.json
 * Run: node scripts/_t1_nza.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { runInterventionStack } from '../frontend/src/utils/interventionsEngine.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')
const FIXTURE = path.join(REPO, 'validation/fixtures/report_baseline_v1.yaml')

function loadYaml(p) {
  const py = path.join(REPO, 'validation/.venv/bin/python')
  return JSON.parse(execFileSync(py, ['-c', 'import yaml,json,sys; json.dump(yaml.safe_load(open(sys.argv[1])), sys.stdout)', p],
    { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }))
}

const fx = loadYaml(FIXTURE)
const building = fx.building_config
const constructions = fx.construction_choices
const comfortBand = { lower_c: fx.comfort_band?.lower_c ?? 21, upper_c: fx.comfort_band?.upper_c ?? 24 }
const libArr = fx.library_constructions ?? []

const epwPath = path.join(REPO, 'data/weather/current', building.weather_file)
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
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, building.orientation ?? 0)
const libraryData = {
  constructions: libArr.map(c => ({
    name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    g_value: c.config_json?.g_value, config_json: c.config_json ?? c, layers: c.layers,
  })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
  library_systems: building?.library_systems ?? [],
  library_schedules: building?.library_schedules ?? [],
}
const runEngine = (cfg) => calculateInstant(
  cfg.building ?? building, cfg.constructions ?? constructions, cfg.systems ?? {},
  cfg.libraryData ?? libraryData, weatherData, hourlySolar, null,
  { mode: 'full', comfortBand, engine: 'v2.5', _skipInterventions: true })
const baselineConfig = { building, constructions, systems: {}, libraryData, comfortBand }
const r1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null)
const r3 = v => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null)
function extract(res) {
  const c = res?.consumption ?? {}
  // monthly electricity for T2 (MWh per month) if the engine exposes it
  const me = res?.monthly?.electricity_mwh ?? res?.consumption?.monthly?.electricity_mwh ?? null
  return {
    eui: r1(c?.total?.kwh_per_m2_yr), elec_mwh: r3(c?.total?.electricity_mwh), gas_mwh: r3(c?.total?.gas_mwh),
    heating_mwh: r1(c?.space_heating?.demand_mwh), cooling_mwh: r1(c?.space_cooling?.demand_mwh),
    dhw_mwh: r1(c?.dhw?.demand_mwh),
  }
}

const MEASURES = [
  { ref: 'air_perm_1.9', patches: [{ op: 'set', path: 'building.fabric.air_permeability_q50', value: 1.9 }] },
  { ref: '3.5_brise_soleil', patches: [
    { op: 'set', path: 'building.shading_overhang.south', value: { depth_m: 0.5, offset_m: 0 } },
    { op: 'set', path: 'building.shading_overhang.west', value: { depth_m: 0.5, offset_m: 0 } }] },
  { ref: 'vent_to_mvhr', patches: [{ op: 'set', path: 'building.systems_config_v40.ventilation[1].efficiency_metric',
    value: { sfp_w_per_lps: 1.8, recovery_sensible_pct: 80, recovery_latent_pct: 0 } }] },
  { ref: '2.1_mvhr_conversion', patches: [
    { op: 'set', path: 'building.systems_config_v40.ventilation[1].efficiency_metric',
      value: { sfp_w_per_lps: 1.8, recovery_sensible_pct: 80, recovery_latent_pct: 0 } },
    { op: 'set', path: 'building.systems_config_v40.heating[1].share_pct', value: 0 },
    { op: 'set', path: 'building.systems_config_v40.heating[0].share_pct', value: 100 }] },
  { ref: '3.3_setpoint_widen', patches: [
    { op: 'set', path: 'building.systems_config_v40.heating_setpoint_mode', value: 'custom' },
    { op: 'set', path: 'building.systems_config_v40.heating_setpoint_c', value: 20 },
    { op: 'set', path: 'building.systems_config_v40.cooling_setpoint_mode', value: 'custom' },
    { op: 'set', path: 'building.systems_config_v40.cooling_setpoint_c', value: 25 }] },
]

const baseline = extract(runEngine(baselineConfig))
console.error(`[nza] baseline EUI ${baseline.eui} | heat ${baseline.heating_mwh} | cool ${baseline.cooling_mwh}`)
const rows = {}
for (const m of MEASURES) {
  const stack = runInterventionStack(baselineConfig, [{ id: m.ref, label: m.ref, patches: m.patches, enabled: true }], runEngine, libraryData)
  rows[m.ref] = extract(stack.interventions[0].result)
  console.error(`[nza] ${m.ref}: EUI ${rows[m.ref].eui} | heat ${rows[m.ref].heating_mwh} | cool ${rows[m.ref].cooling_mwh}`)
}
const OUT = path.join(REPO, 'docs/audit/T1_nza_runs.json')
fs.writeFileSync(OUT, JSON.stringify({ baseline, rows }, null, 1))
console.error(`[nza] wrote ${path.relative(REPO, OUT)}`)
