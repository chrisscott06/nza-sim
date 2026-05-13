/**
 * Quick tracer for Brief 26.1 Part 3 debugging.
 * Dumps T_op, T_mass, T_air for the peak week.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fetchJson(url) { return (await fetch(url)).json() }

const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const project = await fetchJson(`http://127.0.0.1:8002/api/projects/${PROJECT_ID}`)
const lib = await fetchJson(`http://127.0.0.1:8002/api/library/constructions`)
const libraryData = {
  constructions: (lib.constructions ?? []).map(c => ({
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? 1.0,
    config_json: c.config_json ?? c,
  })),
}
const building = project.building_config
const weatherFile = building.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const lines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(lines[0].split(',')[6])
const data = lines.slice(8).filter(l => l.trim())
const N = data.length
const month = new Int8Array(N), day = new Int16Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), wind_speed = new Float32Array(N)
const direct_normal = new Float32Array(N), diffuse_horizontal = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = data[i].split(',')
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6])
  direct_normal[i] = parseFloat(p[14]); diffuse_horizontal[i] = parseFloat(p[15])
  wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, hour, day }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, building.orientation || 0)

const comfortBand = { lower_c: project.comfort_band_lower_c ?? 20, upper_c: project.comfort_band_upper_c ?? 26 }
const live = calculateInstant(
  { ...building, comfort_band: comfortBand },
  project.construction_choices, project.systems_config ?? {}, libraryData,
  weatherData, hourlySolar, null,
  { mode: 'envelope-only', comfortBand },
)
const T = live.free_running.hourly_temperature_c

// Find peak day
let peakH = 0
for (let h = 0; h < T.length; h++) if (T[h] > T[peakH]) peakH = h
console.log(`Peak: h=${peakH}, m=${month[peakH]}, d=${day[peakH]}, T_op=${T[peakH].toFixed(2)}`)

// Dump 72 hours around peak
const start = Math.max(0, peakH - 24)
const end = Math.min(T.length, peakH + 48)
console.log()
console.log('  hour  | mo dy hr | T_out  Q_solar |  T_op   ')
console.log('--------|----------|-----------------|--------')
for (let h = start; h < end; h += 1) {
  const sol = hourlySolar.f1[h] + hourlySolar.f2[h] + hourlySolar.f3[h] + hourlySolar.f4[h]
  const marker = h === peakH ? '<- PEAK' : ''
  console.log(`  ${h.toString().padStart(4)}  | ${month[h]} ${day[h].toString().padStart(2)} ${hour[h].toString().padStart(2)}   | ${temperature[h].toFixed(1).padStart(5)} ${(sol/1000).toFixed(2).padStart(7)} | ${T[h].toFixed(2).padStart(6)}  ${marker}`)
}
