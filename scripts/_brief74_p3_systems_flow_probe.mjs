/**
 * Brief 74 P3 probe — dump the new systems_flow emit on the v40 path.
 * Verifies:
 *   - systems_flow appears at result top level
 *   - has nodes + links arrays
 *   - includes an auxiliary node + grid→auxiliary + auxiliary→aux_del links
 *   - sum of grid→* links ≈ electricity_total_kwh (no double-count, no drop)
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

const sf = result?.systems_flow
const totalElec = result?.consumption?.total?.electricity_mwh ?? 0
const totalGas  = result?.consumption?.total?.gas_mwh ?? 0

const linkSumByStyle = {}
const linkSumBySource = {}
for (const l of (sf?.links ?? [])) {
  linkSumByStyle[l.style] = (linkSumByStyle[l.style] ?? 0) + l.value_kWh
  linkSumBySource[l.source] = (linkSumBySource[l.source] ?? 0) + l.value_kWh
}

const out = {
  brief: 'Brief 74 P3 probe — systems_flow on v40 path',
  systems_flow_present: sf != null,
  node_count: sf?.nodes?.length ?? 0,
  link_count: sf?.links?.length ?? 0,
  node_ids: (sf?.nodes ?? []).map(n => n.id),
  has_auxiliary_node: (sf?.nodes ?? []).some(n => n.id === 'auxiliary'),
  has_aux_del_node:   (sf?.nodes ?? []).some(n => n.id === 'aux_del'),
  link_styles:        Object.keys(linkSumByStyle),
  link_sum_kwh_by_style:  linkSumByStyle,
  link_sum_kwh_by_source: linkSumBySource,
  totals_check: {
    engine_electricity_mwh: totalElec,
    engine_gas_mwh:         totalGas,
    grid_out_mwh:           (linkSumBySource.grid ?? 0) / 1000,
    gas_out_mwh:            (linkSumBySource.gas ?? 0) / 1000,
    delta_grid_vs_engine_mwh: Math.round(((linkSumBySource.grid ?? 0) / 1000 - totalElec) * 100) / 100,
    delta_gas_vs_engine_mwh:  Math.round(((linkSumBySource.gas ?? 0) / 1000 - totalGas) * 100) / 100,
  },
  auxiliary_link_kwh: (sf?.links ?? [])
    .filter(l => l.source === 'auxiliary' || l.target === 'auxiliary')
    .map(l => ({ source: l.source, target: l.target, value_kWh: l.value_kWh, style: l.style })),
}

console.log(JSON.stringify(out, null, 2))
