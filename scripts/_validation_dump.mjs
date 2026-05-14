/**
 * scripts/_validation_dump.mjs
 *
 * One-shot dump for Brief 28-validation spreadsheet (2026-05-14). Pulls:
 *   1. Bridgewater project config + construction library (via running backend)
 *   2. Yeovilton EPW: parsed annual stats (HDD/CDD, irradiance per cardinal
 *      direction, mean/max/min T, wind)
 *   3. Static-engine State 1 output (calculateInstant with mode=envelope-only)
 *
 * Writes JSON to docs/validation/_dump.json for the markdown formatter to
 * pick up. Run once per validation refresh.
 *
 * Usage:
 *   node scripts/_validation_dump.mjs
 *
 * Requires: backend running on 127.0.0.1:8002
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'

const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'  // HIX Bridgewater
const API = 'http://127.0.0.1:8002'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fetchJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

// ── 1. Project config + library ───────────────────────────────────────────
const project = await fetchJson(`${API}/api/projects/${PROJECT_ID}`)
const constructionsLib = await fetchJson(`${API}/api/library/constructions`)
const constructionsArr = Array.isArray(constructionsLib)
  ? constructionsLib
  : (constructionsLib.constructions ?? Object.values(constructionsLib))
const libraryData = {
  constructions: constructionsArr.map(c => ({
    name: c.name,
    type: c.type ?? c.config_json?.type,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c,
    layers: c.layers,
  })),
}

const buildingConfig = project.building_config
const constructionChoices = project.construction_choices

// Pull only the constructions referenced by Bridgewater
const referencedConstructionNames = new Set(
  Object.values(constructionChoices ?? {}).filter(Boolean)
)
const referencedConstructions = libraryData.constructions.filter(
  c => referencedConstructionNames.has(c.name),
)

// ── 2. Parse Yeovilton EPW ────────────────────────────────────────────────
const weatherFile = buildingConfig.weather_file || project.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const headerLine = epwLines[0].split(',')
const epwLatitude = parseFloat(headerLine[6])
const epwLongitude = parseFloat(headerLine[7])
const epwTimezone = parseFloat(headerLine[8])
const epwElevation = parseFloat(headerLine[9])
const epwLocationName = headerLine[1] + ', ' + headerLine[2]

const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N)
const dewpoint = new Float32Array(N)
const direct_normal = new Float32Array(N), diffuse_horizontal = new Float32Array(N)
const global_horizontal = new Float32Array(N)
const wind_speed = new Float32Array(N), wind_dir = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i] = parseInt(p[1])
  day[i]   = parseInt(p[2])
  hour[i]  = parseInt(p[3])
  temperature[i]        = parseFloat(p[6])
  dewpoint[i]           = parseFloat(p[7])
  global_horizontal[i]  = parseFloat(p[13])
  direct_normal[i]      = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15])
  wind_dir[i]           = parseFloat(p[20])
  wind_speed[i]         = parseFloat(p[21])
}

// EPW summary stats
const tMean = temperature.reduce((s, v) => s + v, 0) / N
const tMax  = Math.max(...temperature)
const tMin  = Math.min(...temperature)
// Summer max / winter min by season
let summerMax = -Infinity, winterMin = Infinity
for (let i = 0; i < N; i++) {
  const m = month[i]
  if (m >= 6 && m <= 8 && temperature[i] > summerMax) summerMax = temperature[i]
  if ((m === 12 || m <= 2) && temperature[i] < winterMin) winterMin = temperature[i]
}
const windMean = wind_speed.reduce((s, v) => s + v, 0) / N
const windMax  = Math.max(...wind_speed)
const ghiAnnual = global_horizontal.reduce((s, v) => s + v, 0) / 1000  // kWh/m²/yr
const dniAnnual = direct_normal.reduce((s, v) => s + v, 0) / 1000
const dhiAnnual = diffuse_horizontal.reduce((s, v) => s + v, 0) / 1000

// HDD / CDD against base temperatures (daily-aggregation, then sum)
function degreeDays(baseC, cooling = false) {
  let acc = 0
  for (let d = 0; d < N; d += 24) {
    let dayMean = 0
    for (let h = 0; h < 24 && d + h < N; h++) dayMean += temperature[d + h]
    dayMean /= 24
    if (cooling) acc += Math.max(0, dayMean - baseC)
    else         acc += Math.max(0, baseC - dayMean)
  }
  return acc
}
const HDD_15p5 = degreeDays(15.5, false)
const CDD_22   = degreeDays(22, true)

// Irradiance per cardinal + ordinal direction via the production solar helper
// (so the numbers exactly match what the engine sees). We rotate orientation
// to project each "compass" direction onto F1 (= building-local north).
const weatherDataForSolar = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const DIRECTIONS = [
  { name: 'N',  rotateBy: 0   },
  { name: 'NE', rotateBy: 315 },  // To make F1 face NE we need to rotate building by -45° (or +315°)
  { name: 'E',  rotateBy: 270 },
  { name: 'SE', rotateBy: 225 },
  { name: 'S',  rotateBy: 180 },
  { name: 'SW', rotateBy: 135 },
  { name: 'W',  rotateBy: 90  },
  { name: 'NW', rotateBy: 45  },
]
// Easier: rotate orientation so F1 looks at each cardinal. With orientation=0,
// F1 = N (per facadeLabel.js BASE_ANGLES). Rotate clockwise.
const irradianceByDirection = {}
for (const dir of DIRECTIONS) {
  const sol = computeHourlySolarByFacade(weatherDataForSolar, epwLatitude, dir.rotateBy)
  // f1 is the facade that ends up facing `dir.name` after rotation
  const annualKWh = Array.from(sol.f1).reduce((s, v) => s + v, 0) / 1000  // Wh/m² → kWh/m²
  irradianceByDirection[dir.name] = annualKWh
}

// ── 3. Static-engine State 1 output ───────────────────────────────────────
const comfortBand = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}
const orientation = buildingConfig.orientation || 0
const hourlySolar = computeHourlySolarByFacade(weatherDataForSolar, epwLatitude, orientation)

const state1 = calculateInstant(
  { ...buildingConfig, comfort_band: comfortBand },
  constructionChoices, {}, libraryData,
  weatherDataForSolar, hourlySolar, null,
  { mode: 'envelope-only', comfortBand },
)

// Hourly T_op stats for the doc
const T_hourly = state1.free_running?.hourly_temperature_c
let TopMean = null, TopStd = null
if (T_hourly && T_hourly.length > 0) {
  TopMean = T_hourly.reduce((s, v) => s + v, 0) / T_hourly.length
  const variance = T_hourly.reduce((s, v) => s + (v - TopMean) ** 2, 0) / T_hourly.length
  TopStd = Math.sqrt(variance)
}

// Strip the hourly array from the dumped state1 so the JSON stays compact;
// keep summary stats instead.
const state1Compact = {
  state: state1.state,
  mode: state1.mode,
  comfort_band_used: state1.comfort_band_used,
  gains: state1.gains,
  losses: state1.losses,
  free_running: {
    annual_mean_c: state1.free_running?.annual_mean_c,
    winter_min_c:  state1.free_running?.winter_min_c,
    summer_max_c:  state1.free_running?.summer_max_c,
    hourly_mean_c: TopMean,
    hourly_std_c:  TopStd,
    hourly_count:  T_hourly?.length ?? 0,
  },
  demand: state1.demand,
  heat_balance: state1.heat_balance,
}

// ── Write dump ────────────────────────────────────────────────────────────
const dump = {
  generated_at: new Date().toISOString(),
  project: {
    id: PROJECT_ID,
    name: project.name,
    address: project.address,
    weather_file: weatherFile,
    comfort_band: comfortBand,
    building_config: buildingConfig,
    construction_choices: constructionChoices,
    systems_config: project.systems_config ?? null,
  },
  library_constructions_referenced: referencedConstructions,
  weather: {
    file:        weatherFile,
    location:    epwLocationName,
    latitude:    epwLatitude,
    longitude:   epwLongitude,
    timezone:    epwTimezone,
    elevation_m: epwElevation,
    hours:       N,
    temperature: {
      mean_c:       tMean,
      max_c:        tMax,
      min_c:        tMin,
      summer_max_c: summerMax,
      winter_min_c: winterMin,
    },
    wind: { mean_m_s: windMean, max_m_s: windMax },
    ghi_annual_kwh_per_m2: ghiAnnual,
    dni_annual_kwh_per_m2: dniAnnual,
    dhi_annual_kwh_per_m2: dhiAnnual,
    hdd_15p5_baseC: HDD_15p5,
    cdd_22_baseC:   CDD_22,
    irradiance_by_compass_kwh_per_m2_yr: irradianceByDirection,
  },
  state1: state1Compact,
}

const outPath = path.join(REPO_ROOT, 'docs/validation/_dump.json')
fs.writeFileSync(outPath, JSON.stringify(dump, null, 2))
console.log('Wrote', outPath, '— size:', fs.statSync(outPath).size, 'bytes')
