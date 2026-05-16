/**
 * scripts/_get_static_from_file_json.mjs
 *
 * Brief 28e Gate E4b helper: reads a synthetic project JSON from argv[2]
 * (NOT from the API — for transient test projects that aren't persisted).
 * Runs the Static engine in the mode specified by argv[3] (envelope-only,
 * envelope-gains, or full; defaults to envelope-gains).
 *
 * The project JSON must include:
 *   {
 *     building_config: {...},     // matches API shape
 *     construction_choices: {...}, // matches API shape
 *     comfort_band_lower_c: number,
 *     comfort_band_upper_c: number,
 *   }
 *
 * Library data + weather are loaded from the live system (so the constructions
 * the synthetic config references must exist in the library API and the EPW
 * must exist in data/weather/current/).
 *
 * Emits the full Static result as JSON to stdout for Python consumption.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

const projectFilePath = process.argv[2]
const mode = process.argv[3] || 'envelope-gains'
if (!projectFilePath) {
  console.error('Usage: node _get_static_from_file_json.mjs <project.json> [mode]')
  process.exit(2)
}

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json() }

const project = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'))
const lib = await fj(`${API}/api/library/constructions`)
const libraryData = {
  constructions: (lib.constructions ?? []).map(c => ({
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c,
    layers: c.layers,
  })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
}

const bc = project.building_config
const cc = project.construction_choices
const epwPath = path.join(REPO_ROOT, 'data/weather/current', bc.weather_file)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const dl = epwLines.slice(8).filter(l => l.trim())
const N = dl.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), direct_normal = new Float32Array(N)
const diffuse_horizontal = new Float32Array(N), wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dl[i].split(',')
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6]); direct_normal[i] = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15]); wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const epwLat = parseFloat(epwLines[0].split(',')[6])
const hourlySolar = computeHourlySolarByFacade(weatherData, epwLat, bc.orientation ?? 0)
const cb = {
  lower_c: project.comfort_band_lower_c ?? 21,
  upper_c: project.comfort_band_upper_c ?? 25,
}

const result = calculateInstant(bc, cc, {}, libraryData, weatherData, hourlySolar, null,
                                { mode, comfortBand: cb })

process.stdout.write(JSON.stringify({
  mode,
  setpoints_c: { heating: cb.lower_c, cooling: cb.upper_c },
  weather_file: bc.weather_file,
  losses_at_setpoint: result.losses_at_setpoint,
  demand: result.demand,
  free_running_mean_c: result.free_running?.annual_mean_c ?? result.heat_balance?.free_running?.annual_mean_c,
}, null, 2))
