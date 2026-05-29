/**
 * Brief 72 P5 falsifiability — gain_fraction directionality.
 *
 * Loads the cached PC fixture (Bridgewater post-recreate) and runs two
 * variants:
 *   A. baseline                          (all gain_fraction = 1.0)
 *   B. equipment gain_fraction patched to 0.5 (extract-hood-like catering)
 *
 * Predictions (Brief 72 design note B.8 #2 — catering @ 0.50 splits):
 *   heat_demand_B  >  heat_demand_A   (less zone heat → heating works harder)
 *   cool_demand_B  <  cool_demand_A   (less zone heat → cooling works less)
 *   elec_total_B   ≈  elec_total_A    (same electricity, same fuel rollup)
 *   dhw_demand_B   ≈  dhw_demand_A    (DHW path unaffected)
 *   gain.equipment.kwh_B            ≈  gain.equipment.kwh_A × 0.5
 *   gain.equipment.electricity_kwh_B ≈ gain.equipment.electricity_kwh_A
 *
 * The first invariant is the boundary discipline (Brief 72 Principle 4):
 * gain_kwh and electricity_kwh must move independently — gain_kwh drops
 * with gain_fraction, electricity_kwh does not.
 *
 * Run:
 *   cd C:\Users\ChrisScott\Dev\nza-sim
 *   node scripts/_brief72_p5_falsifiability.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const FIXTURE   = path.join(REPO_ROOT, 'docs/audit/fixtures/bridgewater_post_recreate.json')

const cached = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'))
const baseProject = cached.project
const libArr      = cached.lib_constructions ?? []

const constructions = baseProject.construction_choices
const systems       = {}
const baseBuilding  = baseProject.building_config
const dbCb          = {
  lower_c: baseProject.comfort_band_lower_c ?? 20,
  upper_c: baseProject.comfort_band_upper_c ?? 26,
}

const epwPath  = path.join(REPO_ROOT, 'data/weather/current', baseBuilding.weather_file)
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
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, baseBuilding.orientation ?? 0)

const libraryData = {
  constructions: libArr.map(c => ({
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c,
    layers: c.layers,
  })),
  system_templates:  SYSTEM_TEMPLATES_LIBRARY,
  library_systems:   baseBuilding?.library_systems   ?? [],
  library_schedules: baseBuilding?.library_schedules ?? [],
}

function patchEquipmentGainFraction(building, value) {
  // Deep-clone the equipment profiles and patch gain_fraction.
  const profiles = (building?.gains?.equipment?.profiles ?? []).map(p => ({
    ...p,
    gain_fraction: value,
  }))
  return {
    ...building,
    gains: {
      ...building.gains,
      equipment: { ...(building.gains?.equipment ?? {}), profiles },
    },
  }
}

function runScenario(building, label) {
  const result = calculateInstant(
    building,
    constructions, systems, libraryData,
    weatherData, hourlySolar, null,
    { mode: 'full', comfortBand: dbCb, engine: 'v2.5' },
  )
  const c = result?.consumption ?? {}
  const eqInternal = result?.heat_balance?.annual?.gains?.internal?.equipment
                  ?? result?.state2?.heat_balance?.annual?.gains?.internal?.equipment
  return {
    label,
    eui_kwh_per_m2:        c?.total?.kwh_per_m2_yr ?? null,
    heat_demand_mwh:       c?.space_heating?.demand_mwh ?? null,
    cool_demand_mwh:       c?.space_cooling?.demand_mwh ?? null,
    dhw_demand_mwh:        c?.dhw?.demand_mwh ?? null,
    elec_total_mwh:        c?.total?.electricity_mwh ?? null,
    equipment_gain_kwh:        eqInternal?.kwh ?? null,
    equipment_electricity_kwh: eqInternal?.electricity_kwh ?? null,
  }
}

const A = runScenario(baseBuilding, 'A: gain_fraction = 1.0 (baseline)')
const B = runScenario(patchEquipmentGainFraction(baseBuilding, 0.5),
                      'B: equipment gain_fraction = 0.5')

function delta(b, a) { return Math.round((b - a) * 100) / 100 }

const verdict = {
  brief: 'Brief 72 P5 falsifiability — gain_fraction directionality',
  scenarios: { A, B },
  deltas_B_minus_A: {
    eui:               delta(B.eui_kwh_per_m2, A.eui_kwh_per_m2),
    heat_demand_mwh:   delta(B.heat_demand_mwh, A.heat_demand_mwh),
    cool_demand_mwh:   delta(B.cool_demand_mwh, A.cool_demand_mwh),
    dhw_demand_mwh:    delta(B.dhw_demand_mwh,  A.dhw_demand_mwh),
    elec_total_mwh:    delta(B.elec_total_mwh,  A.elec_total_mwh),
    equipment_gain_kwh:        delta(B.equipment_gain_kwh ?? 0,        A.equipment_gain_kwh ?? 0),
    equipment_electricity_kwh: delta(B.equipment_electricity_kwh ?? 0, A.equipment_electricity_kwh ?? 0),
  },
  expected_directions: {
    heat_demand: 'heat_B > heat_A (less zone heat → heating works harder)',
    cool_demand: 'cool_B < cool_A (less zone heat → cooling works less)',
    elec_total:  'elec_B ≈ elec_A  (same electricity, same fuel rollup)',
    dhw_demand:  'dhw_B  ≈ dhw_A   (DHW path unaffected)',
    boundary_invariant:
      'equipment_gain_kwh halves; equipment_electricity_kwh holds (Principle 4 boundary discipline)',
  },
}

console.log(JSON.stringify(verdict, null, 2))
