/**
 * scripts/audit_physics_helpers.mjs
 *
 * Throwaway helper for the 2026-05 physics audit. Pulls per-face glazing
 * conduction from the Static engine for Bridgewater so the audit table
 * can quote exact numbers. Not part of the regression suite.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'

const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const API = 'http://127.0.0.1:8002'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fetchJson(url) { const r = await fetch(url); return r.json() }

const project = await fetchJson(`${API}/api/projects/${PROJECT_ID}`)
const lib = await fetchJson(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? Object.values(lib)
const libraryData = { constructions: libArr.map(c => ({ name: c.name, type: c.type ?? c.config_json?.type, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K, y_factor: c.config_json?.y_factor ?? 1.0, config_json: c.config_json ?? c, layers: c.layers })) }

const epwPath = path.join(REPO_ROOT, 'data/weather/current', project.building_config.weather_file)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const lat = parseFloat(epwLines[0].split(',')[6])
const data = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = data.length
const month = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), wind_speed = new Float32Array(N)
const direct_normal = new Float32Array(N), diffuse_horizontal = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = data[i].split(',')
  month[i] = parseInt(p[1]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6])
  direct_normal[i] = parseFloat(p[14]); diffuse_horizontal[i] = parseFloat(p[15])
  wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, lat, project.building_config.orientation || 0)
const out = calculateInstant(
  { ...project.building_config, comfort_band: { lower_c: 21, upper_c: 25 } },
  project.construction_choices, {}, libraryData,
  weatherData, hourlySolar, null,
  { mode: 'envelope-only', comfortBand: { lower_c: 21, upper_c: 25 } },
)
console.log('STATIC losses.conduction (Bridgewater):')
console.log(JSON.stringify(out.losses.conduction, null, 2))
const glazSum = Object.values(out.losses.conduction.glazing).reduce((s, v) => s + v, 0)
console.log('STATIC glazing total:', glazSum.toFixed(1))
console.log('STATIC losses.ventilation:', JSON.stringify(out.losses.ventilation, null, 2))
console.log('STATIC free_running:', JSON.stringify(out.free_running ? { annual_mean_c: out.free_running.annual_mean_c, winter_min_c: out.free_running.winter_min_c, summer_max_c: out.free_running.summer_max_c } : null))
console.log('STATIC demand:', JSON.stringify(out.demand))
