/**
 * Brief 73 P3 falsifiability — prove the share-guard removal lets
 * fan electricity through when shares ≠ 100%.
 *
 * Three scenarios against the live Bridgewater fixture (with engine
 * code already patched in P3):
 *
 *   A. baseline             (saved shares 33.3/33.3/33.3 → 99.9% — would pass guard)
 *   B. shares 100/100/100   (sums to 300% — would TRIP the old guard)
 *   C. shares 0/0/0         (sums to 0%   — would TRIP the old guard)
 *
 * Post-fix expectation: ALL THREE produce the SAME fan electricity total
 * (~41.96 MWh). Pre-fix, B and C would have returned 0 MWh fan electricity.
 *
 * Gate (b) of the brief: "Ventilation fan electricity is non-zero.
 * Expected ~42 MWh total based on pre-loss numbers (22.6 + 16.0 + 3.4)."
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const API = 'http://127.0.0.1:8002'
const PROJECT_ID = '3561c5a6-9a3f-4b5c-9e3d-72b449658d9a'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json() }
const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const libArr  = (await fj(`${API}/api/library/constructions`)).constructions ?? []
const baseBuilding = project.building_config
const dbCb = { lower_c: project.comfort_band_lower_c ?? 20, upper_c: project.comfort_band_upper_c ?? 26 }

const epwLines = fs.readFileSync(path.join(REPO_ROOT, 'data/weather/current', baseBuilding.weather_file), 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), direct_normal = new Float32Array(N), diffuse_horizontal = new Float32Array(N), wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6]); direct_normal[i] = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15]); wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, baseBuilding.orientation ?? 0)
const libraryData = {
  constructions: libArr.map(c => ({ name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K, y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0, g_value: c.config_json?.g_value, config_json: c.config_json ?? c, layers: c.layers })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY, library_systems: baseBuilding?.library_systems ?? [], library_schedules: baseBuilding?.library_schedules ?? [],
}

function withVentShares(building, share) {
  const vents = (building?.systems_config_v40?.ventilation ?? []).map(v => ({ ...v, share_pct: share }))
  return { ...building, systems_config_v40: { ...building.systems_config_v40, ventilation: vents } }
}

function run(building, label) {
  const r = calculateInstant(building, project.construction_choices, {}, libraryData, weatherData, hourlySolar, null,
    { mode: 'full', comfortBand: dbCb, engine: 'v2.5' })
  const v25 = r?.consumption?.ventilation ?? []
  const v40 = r?.consumption?.brief40?.ventilation ?? {}
  return {
    label,
    shares_input:                 (building?.systems_config_v40?.ventilation ?? []).map(v => v.share_pct),
    v25_per_system_fan_mwh:       v25.map(v => v.fan_electricity_mwh),
    v25_sum_fan_mwh:              v25.reduce((s, v) => s + (v.fan_electricity_mwh ?? 0), 0),
    v40_total_fan_electrical_mwh: v40.total_fan_electrical_mwh ?? null,
    v40_error:                    v40.error ?? null,
    eui_kwh_per_m2:               r?.consumption?.total?.kwh_per_m2_yr ?? null,
    electricity_mwh:              r?.consumption?.total?.electricity_mwh ?? null,
  }
}

const A = run(baseBuilding, 'A baseline (shares 33.3/33.3/33.3 — Σ=99.9%)')
const B = run(withVentShares(baseBuilding, 100), 'B shares 100/100/100 — Σ=300% (old guard would trip)')
const C = run(withVentShares(baseBuilding, 0),   'C shares 0/0/0     — Σ=0%   (old guard would trip)')

const verdict = {
  brief: 'Brief 73 P3 falsifiability — share-guard removal on ventilation',
  scenarios: { A, B, C },
  invariant_fan_total_independent_of_share: {
    A_total_fan_mwh: Math.round(A.v40_total_fan_electrical_mwh * 1000) / 1000,
    B_total_fan_mwh: Math.round(B.v40_total_fan_electrical_mwh * 1000) / 1000,
    C_total_fan_mwh: Math.round(C.v40_total_fan_electrical_mwh * 1000) / 1000,
    pass: Math.abs(A.v40_total_fan_electrical_mwh - B.v40_total_fan_electrical_mwh) < 0.01
       && Math.abs(A.v40_total_fan_electrical_mwh - C.v40_total_fan_electrical_mwh) < 0.01,
    note: 'All three should be equal — fan electricity = SFP × flow × hours, share_pct ignored per Brief 60 Part A.',
  },
}

console.log(JSON.stringify(verdict, null, 2))
