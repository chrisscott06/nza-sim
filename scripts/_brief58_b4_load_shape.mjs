/**
 * scripts/_brief58_b4_load_shape.mjs
 *
 * Brief 58 B4 — DHW load-shape toggle verification.
 *
 * Loads Bridgewater from the verification backend (:8003), runs the
 * engine twice (`dhw_load_shape = 'flat'` and `'follow_occupancy'`),
 * and asserts the B4 gates:
 *
 *   1. demand_at_comfort_mwh IDENTICAL across both shapes (the toggle
 *      redistributes timing — never changes the annual draw).
 *   2. sum(hourly_kwh) / 1000 ≈ demand_at_comfort_mwh in each shape
 *      (within 0.01 MWh) — the engine's profile generation conserves
 *      the integral.
 *   3. load_shape returned == load_shape requested (no silent fallback
 *      to 'flat' — verifies the State 2 presence array reached the
 *      engine).
 *   4. The two hourly profiles ARE actually different (Σ |Δ| > 0) and
 *      the follow_occupancy profile has the expected variance pattern
 *      (some hours zero, peak hours non-zero).
 *   5. Total EUI unchanged across both runs (the toggle is timing-only;
 *      annual fuel + carbon are invariant).
 *
 * Writes a JSON trace to docs/audit/58_b4_load_shape.json. Read-only
 * over the API.
 *
 * Usage:
 *   node scripts/_brief58_b4_load_shape.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const API        = process.env.NZA_API || 'http://127.0.0.1:8003'
const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json() }

const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const lib     = await fj(`${API}/api/library/constructions`)
const libArr  = lib.constructions ?? []
const constructions = project.construction_choices
const comfortBand = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}
const baseBuilding = JSON.parse(JSON.stringify(project.building_config))

const weatherFile = baseBuilding.weather_file || project.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), direct_normal = new Float32Array(N)
const diffuse_horizontal = new Float32Array(N), wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i]=parseInt(p[1]);day[i]=parseInt(p[2]);hour[i]=parseInt(p[3])
  temperature[i]=parseFloat(p[6]);direct_normal[i]=parseFloat(p[14])
  diffuse_horizontal[i]=parseFloat(p[15]);wind_speed[i]=parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const orientation = Number(baseBuilding.orientation ?? 0)
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, orientation)
const libraryData = {
  constructions: libArr.map(c => ({
    name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0, g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c, layers: c.layers,
  })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
}

function runOnce(loadShape) {
  // Deep-clone the building so the two runs are isolated
  const building = JSON.parse(JSON.stringify(baseBuilding))
  if (building.systems_config_v40) {
    building.systems_config_v40.dhw_load_shape = loadShape
  }
  // Engine receives Float32Array on systems_config_v40 — _computeDhw
  // reads serviceLevel.dhw_load_shape direct from cfg.
  const result = calculateInstant(
    building, constructions, {}, libraryData,
    weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand, _skipInterventions: true },
  )
  const b40 = result?.consumption?.brief40 ?? null
  const dhw = b40?.dhw ?? null
  // The hourly_kwh is a Float32Array — convert to a regular Array for JSON.
  const hourly = dhw?.hourly_kwh ?? null
  const hourlyArr = hourly ? Array.from(hourly) : null
  let sum_kwh = 0
  if (hourlyArr) for (let i = 0; i < hourlyArr.length; i++) sum_kwh += hourlyArr[i]
  // Peak / min / coefficient-of-variation diagnostics on the hourly
  // array. CV = stdev / mean — zero for a uniform (flat) profile,
  // positive for any redistribution.
  let peak_kwh = 0, min_kwh = Infinity, hours_zero = 0
  if (hourlyArr) {
    for (let i = 0; i < hourlyArr.length; i++) {
      const v = hourlyArr[i]
      if (v > peak_kwh) peak_kwh = v
      if (v < min_kwh)  min_kwh  = v
      if (v < 1e-9) hours_zero++
    }
  }
  const mean_kwh = hourlyArr ? sum_kwh / hourlyArr.length : 0
  let var_sum = 0
  if (hourlyArr) for (let i = 0; i < hourlyArr.length; i++) {
    const d = hourlyArr[i] - mean_kwh
    var_sum += d * d
  }
  const stdev_kwh = hourlyArr ? Math.sqrt(var_sum / hourlyArr.length) : 0
  const cv       = mean_kwh > 0 ? stdev_kwh / mean_kwh : 0
  return {
    requested_shape:        loadShape,
    actual_shape:           dhw?.load_shape ?? null,
    demand_at_comfort_mwh:  dhw?.demand_at_comfort_mwh ?? null,
    delivered_total_mwh:    dhw?.delivered_total_mwh ?? null,
    sum_hourly_mwh:         sum_kwh / 1000,
    integral_residual_mwh:  (sum_kwh / 1000) - (dhw?.demand_at_comfort_mwh ?? 0),
    peak_kwh,
    min_kwh: Number.isFinite(min_kwh) ? min_kwh : null,
    hours_zero,
    mean_kwh,
    stdev_kwh,
    cv,
    eui_kwh_per_m2:         b40?.totals?.eui_kWh_per_m2 ?? null,
    annual_source_kwh:      b40?.totals?.annual_source_kWh ?? null,
    hourly_kwh:             hourlyArr, // captured for diff
  }
}

const runFlat = runOnce('flat')
const runFollow = runOnce('follow_occupancy')

// ── Diff the two shapes ──
let diff_abs_kwh = 0, diff_max_kwh = 0
if (runFlat.hourly_kwh && runFollow.hourly_kwh) {
  for (let i = 0; i < runFlat.hourly_kwh.length; i++) {
    const d = Math.abs(runFlat.hourly_kwh[i] - runFollow.hourly_kwh[i])
    diff_abs_kwh += d
    if (d > diff_max_kwh) diff_max_kwh = d
  }
}

// ── Gate checks ──
//
// Note: a "zero off-hours" test is INVALID for hotels — guests are
// present overnight, so a 24/7 occupancy schedule never reaches zero.
// The right invariant is coefficient-of-variation: flat MUST have
// CV = 0 (uniform), follow_occupancy MUST have CV > 0 (redistributed).
const gates = {
  G1_demand_identical:            (Math.abs((runFlat.demand_at_comfort_mwh ?? 0) - (runFollow.demand_at_comfort_mwh ?? 0)) < 0.01),
  G2a_flat_integral:              (Math.abs(runFlat.integral_residual_mwh)   < 0.01),
  G2b_follow_integral:            (Math.abs(runFollow.integral_residual_mwh) < 0.01),
  G3a_flat_shape_returned:        (runFlat.actual_shape   === 'flat'),
  G3b_follow_shape_returned:      (runFollow.actual_shape === 'follow_occupancy'),
  G4_shapes_actually_differ:      (diff_abs_kwh > 1.0), // total |Δ| across 8760 hours, kWh
  G4b_flat_cv_zero:               (runFlat.cv < 1e-6),  // flat must be uniform
  G4c_follow_cv_positive:         (runFollow.cv > 0.01), // follow must redistribute meaningfully
  G5_eui_identical:               (Math.abs((runFlat.eui_kwh_per_m2 ?? 0) - (runFollow.eui_kwh_per_m2 ?? 0)) < 0.01),
}
const all_pass = Object.values(gates).every(Boolean)

// ── Strip the bulky hourly arrays from the persisted output ──
const trim = ({ hourly_kwh: _hk, ...rest }) => rest
const out = {
  generated_at: new Date().toISOString(),
  brief: '58 B4 — DHW load-shape toggle',
  api: API,
  project: { id: PROJECT_ID, name: project.name },
  gates,
  all_pass,
  diff_total_kwh:  Math.round(diff_abs_kwh * 100) / 100,
  diff_max_h_kwh:  Math.round(diff_max_kwh * 1000) / 1000,
  runs: { flat: trim(runFlat), follow_occupancy: trim(runFollow) },
}

const outPath = path.join(REPO_ROOT, 'docs/audit/58_b4_load_shape.json')
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(out, null, 2))

// ── Console summary ──
console.log('Brief 58 B4 — DHW load-shape toggle')
console.log('-----------------------------------')
console.log(`flat              demand_at_comfort=${runFlat.demand_at_comfort_mwh} MWh  sum_hourly=${runFlat.sum_hourly_mwh.toFixed(4)} MWh  shape=${runFlat.actual_shape}  peak_h=${runFlat.peak_kwh.toFixed(3)} kWh  min_h=${runFlat.min_kwh.toFixed(3)}  CV=${runFlat.cv.toFixed(4)}  EUI=${runFlat.eui_kwh_per_m2}`)
console.log(`follow_occupancy  demand_at_comfort=${runFollow.demand_at_comfort_mwh} MWh  sum_hourly=${runFollow.sum_hourly_mwh.toFixed(4)} MWh  shape=${runFollow.actual_shape}  peak_h=${runFollow.peak_kwh.toFixed(3)} kWh  min_h=${runFollow.min_kwh.toFixed(3)}  CV=${runFollow.cv.toFixed(4)}  EUI=${runFollow.eui_kwh_per_m2}`)
console.log(`diff_total=${out.diff_total_kwh} kWh   diff_max_h=${out.diff_max_h_kwh} kWh`)
console.log('Gates:')
for (const [k, v] of Object.entries(gates)) console.log(`  ${v ? '✓' : '✗'} ${k}`)
console.log(all_pass ? 'B4 PASS' : 'B4 FAIL')
console.log(`Wrote ${outPath}`)
process.exit(all_pass ? 0 : 1)
