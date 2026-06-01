/**
 * Brief 73 P3 probe — dump the engine result's ventilation surface
 * to find where fan_total_mwh actually lives now that the guard is
 * removed.
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
const building = project.building_config
const dbCb = { lower_c: project.comfort_band_lower_c ?? 20, upper_c: project.comfort_band_upper_c ?? 26 }

const epwLines = fs.readFileSync(path.join(REPO_ROOT, 'data/weather/current', building.weather_file), 'utf-8').split(/\r?\n/)
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
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, building.orientation ?? 0)
const libraryData = {
  constructions: libArr.map(c => ({ name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K, y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0, g_value: c.config_json?.g_value, config_json: c.config_json ?? c, layers: c.layers })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY, library_systems: building?.library_systems ?? [], library_schedules: building?.library_schedules ?? [],
}

const result = calculateInstant(building, project.construction_choices, {}, libraryData, weatherData, hourlySolar, null, { mode: 'full', comfortBand: dbCb, engine: 'v2.5' })

const c = result?.consumption ?? {}
console.log('=== consumption keys ===')
console.log(Object.keys(c))
console.log()
console.log('=== consumption.ventilation ===')
console.log(JSON.stringify(c.ventilation, null, 2)?.slice(0, 2000))
console.log()
console.log('=== consumption.brief40?.ventilation ===')
console.log(JSON.stringify(c.brief40?.ventilation, null, 2)?.slice(0, 2000))
console.log()
console.log('=== consumption.systems (if exists) ===')
console.log(JSON.stringify(c.systems, null, 2)?.slice(0, 500))
console.log()
console.log('=== building.systems_config_v40.ventilation (input shape) ===')
console.log(JSON.stringify(building.systems_config_v40?.ventilation, null, 2)?.slice(0, 1500))
