/**
 * scripts/_part3_v3_sweep.mjs — Glazing inside-surface absorption sweep.
 * Brief 28b Part 3 v3.
 *
 * Sweeps `glazing_inside_absorption_fraction` ∈ [0.03, 0.05, 0.07, 0.10, 0.15]
 * holding the v2 defaults for the other knobs. Captures mean T, summer max,
 * winter min, heating + cooling demand. Used to pick the v3 default value.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const API = 'http://127.0.0.1:8002'
const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'

const EP_REF = {
  annual_mean_c: 19.8,
  summer_max_c: 35.4,
  winter_min_c: 8.3,
  heating_demand_mwh: 110.2,
  cooling_demand_mwh: 61.7,
}

async function fetchJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

const project = await fetchJson(`${API}/api/projects/${PROJECT_ID}`)
const lib = await fetchJson(`${API}/api/library/constructions`)
const libArr = Array.isArray(lib) ? lib : (lib.constructions ?? Object.values(lib))
const libraryData = {
  constructions: libArr.map(c => ({
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

const weatherFile = buildingConfig.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const headerLine = epwLines[0].split(',')
const epwLatitude = parseFloat(headerLine[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N)
const direct_normal = new Float32Array(N), diffuse_horizontal = new Float32Array(N)
const wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i]        = parseFloat(p[6])
  direct_normal[i]      = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15])
  wind_speed[i]         = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const orientation = buildingConfig.orientation ?? 0
const hourlySolar = computeHourlySolarByFacade(weatherData, epwLatitude, orientation)
const comfortBand = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}

function run(absorption) {
  const r = calculateInstant(
    { ...buildingConfig, comfort_band: comfortBand },
    constructionChoices, {}, libraryData,
    weatherData, hourlySolar, null,
    {
      mode: 'envelope-only',
      comfortBand,
      tuning: { glazing_inside_absorption_fraction: absorption },
    },
  )
  return {
    annual_mean_c: r.free_running?.annual_mean_c ?? null,
    summer_max_c:  r.free_running?.summer_max_c  ?? null,
    winter_min_c:  r.free_running?.winter_min_c  ?? null,
    heating_demand_mwh: r.demand?.heating_demand_mwh ?? null,
    cooling_demand_mwh: r.demand?.cooling_demand_mwh ?? null,
  }
}

function pct(s, e) {
  if (e == null || e === 0) return '—'
  return ((s - e) / e * 100).toFixed(1) + '%'
}

const values = [0.00, 0.03, 0.05, 0.07, 0.10, 0.15]
const results = []

console.log()
console.log('=== Part 3 v3 sweep: glazing_inside_absorption_fraction ===')
console.log(`(v2 defaults: solar_radiative_fraction=0.30, internal_mass=100 kJ/(K·m²))`)
console.log(`EP reference: mean=${EP_REF.annual_mean_c} max=${EP_REF.summer_max_c} min=${EP_REF.winter_min_c} heat=${EP_REF.heating_demand_mwh}MWh cool=${EP_REF.cooling_demand_mwh}MWh`)
console.log()
console.log('  α_inside    mean    max    min   heat MWh  cool MWh    Δmean    Δmax    Δmin    Δcool')
console.log('  --------  ------ ------ ------  --------  --------    ------  ------  ------  -------')
for (const a of values) {
  const out = run(a)
  results.push({ absorption: a, out })
  console.log(
    `  ${a.toFixed(2).padStart(8)}` +
    `  ${out.annual_mean_c.toFixed(2).padStart(6)}` +
    ` ${out.summer_max_c.toFixed(2).padStart(6)}` +
    ` ${out.winter_min_c.toFixed(2).padStart(6)}` +
    `  ${out.heating_demand_mwh.toFixed(1).padStart(8)}` +
    `  ${out.cooling_demand_mwh.toFixed(1).padStart(8)}` +
    `    ${pct(out.annual_mean_c, EP_REF.annual_mean_c).padStart(6)}` +
    `  ${pct(out.summer_max_c, EP_REF.summer_max_c).padStart(6)}` +
    `  ${pct(out.winter_min_c, EP_REF.winter_min_c).padStart(6)}` +
    `  ${pct(out.cooling_demand_mwh, EP_REF.cooling_demand_mwh).padStart(7)}`
  )
}

// Monotonicity check
const meanT = results.map(r => r.out.annual_mean_c)
const summerMax = results.map(r => r.out.summer_max_c)
const winterMin = results.map(r => r.out.winter_min_c)
function isMonotonic(arr, direction) {
  for (let i = 1; i < arr.length; i++) {
    if (direction === 'inc' && arr[i] < arr[i-1] - 1e-3) return false
    if (direction === 'dec' && arr[i] > arr[i-1] + 1e-3) return false
  }
  return true
}
console.log()
console.log('Monotonicity check:')
console.log(`  Mean T:     ${isMonotonic(meanT, 'inc') ? '✓ increasing' : isMonotonic(meanT, 'dec') ? '✓ decreasing' : '✗ non-monotonic'}`)
console.log(`  Summer max: ${isMonotonic(summerMax, 'inc') ? '✓ increasing' : isMonotonic(summerMax, 'dec') ? '✓ decreasing' : '✗ non-monotonic'}`)
console.log(`  Winter min: ${isMonotonic(winterMin, 'inc') ? '✓ increasing' : isMonotonic(winterMin, 'dec') ? '✓ decreasing' : '✗ non-monotonic'}`)
console.log()

// Best mean-T match
let best_idx = 0, best_delta = Infinity
results.forEach((r, i) => {
  const d = Math.abs(r.out.annual_mean_c - EP_REF.annual_mean_c)
  if (d < best_delta) { best_delta = d; best_idx = i }
})
const best = results[best_idx]
console.log(`Best mean-T match: α_inside = ${best.absorption} (Δ=${best_delta.toFixed(2)} K from EP ${EP_REF.annual_mean_c}°C)`)
console.log(`  -> summer max: ${best.out.summer_max_c.toFixed(2)} vs EP ${EP_REF.summer_max_c} (Δ ${(best.out.summer_max_c - EP_REF.summer_max_c).toFixed(2)} K)`)
console.log(`  -> winter min: ${best.out.winter_min_c.toFixed(2)} vs EP ${EP_REF.winter_min_c} (Δ ${(best.out.winter_min_c - EP_REF.winter_min_c).toFixed(2)} K)`)
console.log(`  -> cooling:    ${best.out.cooling_demand_mwh.toFixed(1)} vs EP ${EP_REF.cooling_demand_mwh} MWh`)

// Halt check: summer max not regressed past 0.5 K from EP
const summer_gap = Math.abs(best.out.summer_max_c - EP_REF.summer_max_c)
console.log()
console.log(`Halt trigger check: summer max gap = ${summer_gap.toFixed(2)} K`)
if (summer_gap > 0.5) {
  console.log('  ⚠  Summer max regressed past 0.5 K — flag for review')
} else {
  console.log('  ✓ Summer max within 0.5 K target')
}

// Write JSON
const outPath = path.join(REPO_ROOT, 'docs/validation/_part3_v3_sweep_dump.json')
fs.writeFileSync(outPath, JSON.stringify({ ep_ref: EP_REF, results, best }, null, 2))
console.log()
console.log(`Wrote: ${outPath}`)
