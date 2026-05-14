/**
 * scripts/_part3_response_surface.mjs
 *
 * Brief 28b Part 3 v2 — parameter response-surface sweep. Probes the
 * engine's response to each of the three tuning knobs introduced in
 * Part 3 v1:
 *   1. solar_radiative_fraction (Test 1 — primary)
 *   2. internal_mass_J_per_K_per_m2 (Test 2 — conditional)
 *   3. R_si_wall / R_si_roof / R_si_floor (Test 3 — conditional)
 *
 * Records: annual mean T, summer max T, winter min T, cooling demand,
 * heating demand. Writes a wide CSV-style table per test plus a JSON
 * with the full raw output. Used by
 * docs/validation/state1_part3_response_surface_2026_05.md to pick
 * the best-match tuning values for Part 3 v2.
 *
 * Usage:
 *   node scripts/_part3_response_surface.mjs
 *
 * Requires backend running on 127.0.0.1:8002 (uses Bridgewater config +
 * Yeovilton EPW + current library).
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

// EP reference values for Bridgewater envelope-only (sim c67aff89,
// captured 2026-05-14T14:58Z). Used in pass/fail check.
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

// ── Bootstrap: load project, library, weather, hourly solar once ──────
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

console.log(`Bridgewater env-only, Yeovilton TMYx, comfort ${comfortBand.lower_c}/${comfortBand.upper_c}°C`)
console.log(`EP reference: mean=${EP_REF.annual_mean_c} max=${EP_REF.summer_max_c} min=${EP_REF.winter_min_c}  heat=${EP_REF.heating_demand_mwh}MWh  cool=${EP_REF.cooling_demand_mwh}MWh`)
console.log()

// ── Single run helper ──────────────────────────────────────────────────
function run(tuning) {
  const r = calculateInstant(
    { ...buildingConfig, comfort_band: comfortBand },
    constructionChoices, {}, libraryData,
    weatherData, hourlySolar, null,
    { mode: 'envelope-only', comfortBand, tuning },
  )
  return {
    annual_mean_c: r.free_running?.annual_mean_c ?? null,
    summer_max_c:  r.free_running?.summer_max_c  ?? null,
    winter_min_c:  r.free_running?.winter_min_c  ?? null,
    heating_demand_mwh: r.demand?.heating_demand_mwh ?? null,
    cooling_demand_mwh: r.demand?.cooling_demand_mwh ?? null,
  }
}

function pct(static_val, ep_val) {
  if (ep_val == null || ep_val === 0) return '—'
  return ((static_val - ep_val) / ep_val * 100).toFixed(1) + '%'
}

function formatRow(values, fmt = (v) => v.toFixed(2).padStart(7)) {
  return values.map(fmt).join('')
}

function asciiBar(value, min, max, width = 24) {
  const n = Math.max(0, Math.min(width, Math.round((value - min) / (max - min) * width)))
  return '['.padEnd(n + 1, '█').padEnd(width + 1) + ']'
}

const allResults = {
  ep_ref: EP_REF,
  test1: { name: 'Solar split sweep', knob: 'solar_radiative_fraction', values: [0.30, 0.50, 0.70, 0.85, 1.00], runs: [] },
  test2: { name: 'Mass parameter sweep', knob: 'internal_mass_kJ_per_K_per_m2', values: [50, 100, 150, 200], runs: [], best_solar_split: null },
  test3: { name: 'R_si sweep', knob: 'R_si', values: [0.10, 0.13, 0.17, 0.20], runs: [], best_solar_split: null, best_mass: null },
}

// ── Test 1 ─────────────────────────────────────────────────────────────
console.log('=== TEST 1: Solar split sweep =========================================')
console.log()
console.log('  rad_frac    mean   max    min   heat MWh  cool MWh    Δmean    Δmax    Δcool')
console.log('  --------  ------ ------ ------  --------  --------    ------  ------  -------')
for (const f of allResults.test1.values) {
  const out = run({ solar_radiative_fraction: f })
  allResults.test1.runs.push({ tuning: { solar_radiative_fraction: f }, out })
  console.log(
    `  ${f.toFixed(2).padStart(8)}` +
    `  ${out.annual_mean_c.toFixed(1).padStart(6)}` +
    ` ${out.summer_max_c.toFixed(1).padStart(6)}` +
    ` ${out.winter_min_c.toFixed(1).padStart(6)}` +
    `  ${out.heating_demand_mwh.toFixed(1).padStart(8)}` +
    `  ${out.cooling_demand_mwh.toFixed(1).padStart(8)}` +
    `    ${pct(out.annual_mean_c, EP_REF.annual_mean_c).padStart(6)}` +
    `  ${pct(out.summer_max_c, EP_REF.summer_max_c).padStart(6)}` +
    `  ${pct(out.cooling_demand_mwh, EP_REF.cooling_demand_mwh).padStart(7)}`
  )
}

// Find closest mean-T match
let test1_best_idx = 0
let test1_best_delta = Infinity
allResults.test1.runs.forEach((r, i) => {
  const d = Math.abs(r.out.annual_mean_c - EP_REF.annual_mean_c)
  if (d < test1_best_delta) { test1_best_delta = d; test1_best_idx = i }
})
const test1_best = allResults.test1.runs[test1_best_idx]
console.log()
console.log(`  Closest mean-T match to EP (${EP_REF.annual_mean_c}°C): solar_rad_frac = ${test1_best.tuning.solar_radiative_fraction} (Δ ${test1_best_delta.toFixed(2)} K)`)
console.log()

// ── Test 2 ─────────────────────────────────────────────────────────────
const fix_solar = test1_best.tuning.solar_radiative_fraction
allResults.test2.best_solar_split = fix_solar
console.log('=== TEST 2: Mass parameter sweep (solar_rad_frac fixed at ' + fix_solar + ') ====')
console.log()
console.log('  mass kJ/m²   mean   max    min   heat MWh  cool MWh    Δmean    Δmax    Δmin')
console.log('  ----------  ------ ------ ------  --------  --------    ------  ------  ------')
for (const m of allResults.test2.values) {
  const out = run({
    solar_radiative_fraction: fix_solar,
    internal_mass_J_per_K_per_m2: m * 1000,
  })
  allResults.test2.runs.push({ tuning: { solar_radiative_fraction: fix_solar, internal_mass_J_per_K_per_m2: m * 1000 }, out })
  console.log(
    `  ${String(m).padStart(10)}` +
    `  ${out.annual_mean_c.toFixed(1).padStart(6)}` +
    ` ${out.summer_max_c.toFixed(1).padStart(6)}` +
    ` ${out.winter_min_c.toFixed(1).padStart(6)}` +
    `  ${out.heating_demand_mwh.toFixed(1).padStart(8)}` +
    `  ${out.cooling_demand_mwh.toFixed(1).padStart(8)}` +
    `    ${pct(out.annual_mean_c, EP_REF.annual_mean_c).padStart(6)}` +
    `  ${pct(out.summer_max_c, EP_REF.summer_max_c).padStart(6)}` +
    `  ${pct(out.winter_min_c, EP_REF.winter_min_c).padStart(6)}`
  )
}

// Pick best by composite winter_min + summer_max
let test2_best_idx = 0, test2_best_score = Infinity
allResults.test2.runs.forEach((r, i) => {
  const s = Math.abs(r.out.summer_max_c - EP_REF.summer_max_c) + Math.abs(r.out.winter_min_c - EP_REF.winter_min_c)
  if (s < test2_best_score) { test2_best_score = s; test2_best_idx = i }
})
const test2_best = allResults.test2.runs[test2_best_idx]
console.log()
console.log(`  Closest summer+winter match: internal_mass = ${test2_best.tuning.internal_mass_J_per_K_per_m2/1000} kJ/(K·m²) (Δsum ${test2_best_score.toFixed(2)} K)`)
console.log()

// ── Test 3 ─────────────────────────────────────────────────────────────
const fix_mass = test2_best.tuning.internal_mass_J_per_K_per_m2
allResults.test3.best_solar_split = fix_solar
allResults.test3.best_mass = fix_mass
console.log('=== TEST 3: R_si sweep (solar_rad_frac=' + fix_solar + ', mass=' + (fix_mass/1000) + ' kJ/m²) ===')
console.log()
console.log('  R_si        mean   max    min   heat MWh  cool MWh    Δmean    Δmax    Δmin')
console.log('  ----------  ------ ------ ------  --------  --------    ------  ------  ------')
for (const r_si of allResults.test3.values) {
  const out = run({
    solar_radiative_fraction: fix_solar,
    internal_mass_J_per_K_per_m2: fix_mass,
    R_si_wall: r_si,
    R_si_roof: r_si * (0.10 / 0.13),  // scale ratio to match default
    R_si_floor: r_si * (0.17 / 0.13),
  })
  allResults.test3.runs.push({
    tuning: { solar_radiative_fraction: fix_solar, internal_mass_J_per_K_per_m2: fix_mass, R_si_wall: r_si },
    out,
  })
  console.log(
    `  ${r_si.toFixed(2).padStart(10)}` +
    `  ${out.annual_mean_c.toFixed(1).padStart(6)}` +
    ` ${out.summer_max_c.toFixed(1).padStart(6)}` +
    ` ${out.winter_min_c.toFixed(1).padStart(6)}` +
    `  ${out.heating_demand_mwh.toFixed(1).padStart(8)}` +
    `  ${out.cooling_demand_mwh.toFixed(1).padStart(8)}` +
    `    ${pct(out.annual_mean_c, EP_REF.annual_mean_c).padStart(6)}` +
    `  ${pct(out.summer_max_c, EP_REF.summer_max_c).padStart(6)}` +
    `  ${pct(out.winter_min_c, EP_REF.winter_min_c).padStart(6)}`
  )
}
console.log()

// ── Write raw results ──────────────────────────────────────────────────
const outPath = path.join(REPO_ROOT, 'docs/validation/_part3_response_surface_dump.json')
fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2))
console.log(`Wrote: ${outPath}`)
console.log(`Size:  ${fs.statSync(outPath).size} bytes`)
