/**
 * scripts/_get_static_envelope_gains_json.mjs
 *
 * Brief 28L Gate L4 helper: run the Static envelope-gains (State 2) engine
 * on Bridgewater with current persisted state (post-BRUKL seed) and emit the
 * losses_at_setpoint block + demand + occupancy_summary + internal-gain
 * bucketing as JSON to stdout. Consumed by the Python Gate L4 Dynamic
 * comparison script.
 *
 * Mirrors _get_static_envelope_only_json.mjs but uses mode='envelope-gains'.
 *
 * Not for user consumption — used as a subprocess from
 * scripts/_check_28L_gate4_dynamic_state2.py.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json() }

const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
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
const dl = epwLines.slice(8).filter(l => l.trim().length > 0)
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
const cb = { lower_c: project.comfort_band_lower_c ?? 21, upper_c: project.comfort_band_upper_c ?? 25 }

const s2 = calculateInstant(bc, cc, {}, libraryData, weatherData, hourlySolar, null, { mode: 'envelope-gains', comfortBand: cb })
process.stdout.write(JSON.stringify({
  mode: 'envelope-gains',
  setpoints_c: { heating: cb.lower_c, cooling: cb.upper_c },
  weather_file: bc.weather_file,
  losses_at_setpoint: s2.losses_at_setpoint,
  demand: s2.demand,
  // State 2 has the internal-gains output block; useful for diagnostics.
  gains: s2.gains,
  occupancy_summary: s2.occupancy_summary,
}, null, 2))
