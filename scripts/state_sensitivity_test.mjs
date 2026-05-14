/**
 * scripts/state_sensitivity_test.mjs
 *
 * Sensitivity / invariance test runner. Loads Bridgewater (or another
 * project) config from the running backend, applies in-memory overrides
 * to the building config, runs the Static engine, and writes the result
 * to `docs/validation/sensitivity/<test_name>_<timestamp>.json`.
 *
 * The persisted Bridgewater config is NEVER modified — overrides are
 * applied to the in-memory copy only. Re-runnable any time without
 * affecting the live app.
 *
 * Usage:
 *   node scripts/state_sensitivity_test.mjs <test_name> <override_json> [--gains] [--project=ID]
 *
 * Examples:
 *   node scripts/state_sensitivity_test.mjs A1_double_length '{"length": 117.6}'
 *   node scripts/state_sensitivity_test.mjs A2_rotate_90 '{"orientation": 132}'
 *   node scripts/state_sensitivity_test.mjs E1_zero_occupancy '{"occupancy":{"occupancy_rate":0}}' --gains
 *   node scripts/state_sensitivity_test.mjs baseline '{}'    # no override, dumps baseline
 *
 * Flags:
 *   --gains          Also run mode='envelope-gains' (State 2). Default off.
 *   --project=<id>   Override project ID. Default: HIX Bridgewater.
 *
 * Output JSON shape: see `buildResultPayload()` below. Includes the
 * post-override building config so the caller can verify the override
 * landed where expected.
 *
 * Brief 28a Part 5 walkthrough Finding HB1-4 validation (2026-05-14):
 * supports the State 1 invariance test runbook at
 * docs/validation/state_1_invariance_tests.md.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const API = 'http://127.0.0.1:8002'
const DEFAULT_PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'

// ── CLI ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const testName = args[0]
const overrideJsonRaw = args[1]
if (!testName || overrideJsonRaw == null) {
  console.error('Usage: node scripts/state_sensitivity_test.mjs <test_name> <override_json> [--gains] [--project=ID]')
  console.error('Example: node scripts/state_sensitivity_test.mjs A1_double_length \'{"length": 117.6}\'')
  process.exit(1)
}
const overrides = JSON.parse(overrideJsonRaw)
const runGains = args.includes('--gains')
const projectArg = args.find(a => a.startsWith('--project='))
const PROJECT_ID = projectArg ? projectArg.split('=')[1] : DEFAULT_PROJECT_ID

// ── Deep-merge override into building config ──────────────────────────────
function deepMerge(target, source) {
  if (source == null) return target
  if (typeof source !== 'object' || Array.isArray(source)) return source
  const out = Array.isArray(target) ? [...(target ?? [])] : { ...(target ?? {}) }
  for (const [k, v] of Object.entries(source)) {
    if (v != null && typeof v === 'object' && !Array.isArray(v)
        && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v)
    } else {
      out[k] = v
    }
  }
  return out
}

// ── Compass labels for engine-emitted facade keys (orientation-aware) ─────
//
// Mirrors `frontend/src/utils/facadeLabel.js::facadeLabel` so the dump
// reports the same compass letter the Building module UI shows. Internal
// Gains UI bug (Problem 1a) currently ignores orientation; this dump
// always uses orientation so the engine-canonical label is captured.
const BASE_ANGLES = { 1: 0, 2: 90, 3: 180, 4: 270 }
const FACE_TO_NUM = { north: 1, east: 2, south: 3, west: 4 }
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
function compassFor(face, orientationDeg) {
  const num = FACE_TO_NUM[face]
  const trueAngle = ((BASE_ANGLES[num] ?? 0) + Number(orientationDeg ?? 0) + 360) % 360
  return DIRS[Math.round(trueAngle / 45) % 8]
}

// ── Fetch project + library ───────────────────────────────────────────────
async function fetchJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}
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

// ── Apply overrides — IN MEMORY ONLY ──────────────────────────────────────
const buildingBaseline = project.building_config
const buildingOverridden = deepMerge(buildingBaseline, overrides)
const constructionChoices = project.construction_choices

// ── Parse the EPW ─────────────────────────────────────────────────────────
const weatherFile = buildingOverridden.weather_file || project.weather_file
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
  month[i] = parseInt(p[1])
  day[i]   = parseInt(p[2])
  hour[i]  = parseInt(p[3])
  temperature[i]        = parseFloat(p[6])
  direct_normal[i]      = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15])
  wind_speed[i]         = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }

// ── Solar uses POST-OVERRIDE orientation ──────────────────────────────────
const orientation = buildingOverridden.orientation ?? 0
const hourlySolar = computeHourlySolarByFacade(weatherData, epwLatitude, orientation)

// ── Comfort band ──────────────────────────────────────────────────────────
const comfortBand = {
  lower_c: buildingOverridden.comfort_band?.lower_c ?? project.comfort_band_lower_c ?? 20,
  upper_c: buildingOverridden.comfort_band?.upper_c ?? project.comfort_band_upper_c ?? 26,
}

// ── Run State 1 ───────────────────────────────────────────────────────────
const state1 = calculateInstant(
  { ...buildingOverridden, comfort_band: comfortBand },
  constructionChoices, {}, libraryData,
  weatherData, hourlySolar, null,
  { mode: 'envelope-only', comfortBand },
)

// ── Optionally run State 2 ────────────────────────────────────────────────
let state2 = null
if (runGains) {
  state2 = calculateInstant(
    { ...buildingOverridden, comfort_band: comfortBand },
    constructionChoices, {}, libraryData,
    weatherData, hourlySolar, null,
    { mode: 'envelope-gains', comfortBand },
  )
}

// ── Build the result payload ──────────────────────────────────────────────
function summariseState(result, orientationDeg) {
  if (!result) return null
  const gainsSolarTop = result.gains?.solar ?? {}
  const hb = result.heat_balance ?? {}
  const losses = hb.annual?.losses ?? {}
  const solarHB = hb.annual?.gains?.solar ?? {}
  const T_hourly = result.free_running?.hourly_temperature_c
  let TopMean = null, TopStd = null
  if (T_hourly && T_hourly.length > 0) {
    TopMean = T_hourly.reduce((s, v) => s + v, 0) / T_hourly.length
    const variance = T_hourly.reduce((s, v) => s + (v - TopMean) ** 2, 0) / T_hourly.length
    TopStd = Math.sqrt(variance)
  }
  return {
    state: result.state,
    mode: result.mode,
    solar_facades: {
      F1: { kwh: gainsSolarTop.f1, compass: compassFor('north', orientationDeg) },
      F2: { kwh: gainsSolarTop.f2, compass: compassFor('east',  orientationDeg) },
      F3: { kwh: gainsSolarTop.f3, compass: compassFor('south', orientationDeg) },
      F4: { kwh: gainsSolarTop.f4, compass: compassFor('west',  orientationDeg) },
      roof: { kwh: gainsSolarTop.roof },
      total_kwh: gainsSolarTop.total,
    },
    losses: {
      external_wall:    losses.external_wall?.kwh ?? null,
      roof:             losses.roof?.kwh ?? null,
      ground_floor:     losses.ground_floor?.kwh ?? null,
      glazing:          losses.glazing?.kwh ?? null,
      thermal_bridging: losses.thermal_bridging?.kwh ?? null,
      fabric_leakage:   losses.fabric_leakage?.kwh ?? null,
      permanent_vents:  losses.permanent_vents?.kwh ?? null,
    },
    losses_per_facade_glazing: {
      F1: result.losses?.conduction?.glazing?.f1 ?? null,
      F2: result.losses?.conduction?.glazing?.f2 ?? null,
      F3: result.losses?.conduction?.glazing?.f3 ?? null,
      F4: result.losses?.conduction?.glazing?.f4 ?? null,
    },
    totals: hb.annual?.totals ?? null,
    metadata: hb.metadata ?? null,
    demand: result.demand ?? null,
    free_running: {
      annual_mean_c: result.free_running?.annual_mean_c,
      winter_min_c:  result.free_running?.winter_min_c,
      summer_max_c:  result.free_running?.summer_max_c,
      hourly_mean_c: TopMean,
      hourly_std_c:  TopStd,
      hourly_count:  T_hourly?.length ?? 0,
    },
    // For State 2 we also surface internal gains
    internal_gains: result.gains?.people ? {
      people_kwh:    result.gains.people.total_kwh ?? null,
      people_peak_kw: result.gains.people.peak_kw ?? null,
      lighting_kwh:  result.gains.lighting?.total_kwh ?? null,
      equipment_kwh: result.gains.equipment?.total_kwh ?? null,
    } : null,
  }
}

const payload = {
  generated_at: new Date().toISOString(),
  test_name: testName,
  project_id: PROJECT_ID,
  project_name: project.name,
  baseline_orientation: buildingBaseline.orientation ?? 0,
  effective_orientation: orientation,
  overrides,
  building_config_used: buildingOverridden,
  weather_file: weatherFile,
  comfort_band: comfortBand,
  state1: summariseState(state1, orientation),
  state2: state2 ? summariseState(state2, orientation) : null,
}

// ── Write the JSON output ─────────────────────────────────────────────────
const ts = new Date().toISOString().replace(/[:.]/g, '-')
const outDir = path.join(REPO_ROOT, 'docs/validation/sensitivity')
fs.mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, `${testName}_${ts}.json`)
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2))

console.log()
console.log(`Test: ${testName}`)
console.log(`Project: ${project.name} (${PROJECT_ID})`)
console.log(`Overrides applied:`, overrides)
console.log(`Effective orientation: ${orientation}°`)
console.log(`Weather: ${weatherFile}`)
console.log(`Comfort band: ${comfortBand.lower_c} / ${comfortBand.upper_c} °C`)
console.log()
console.log('── State 1 summary ──')
console.log(`  Solar F1 (${payload.state1.solar_facades.F1.compass}): ${payload.state1.solar_facades.F1.kwh.toFixed(1)} kWh`)
console.log(`  Solar F2 (${payload.state1.solar_facades.F2.compass}): ${payload.state1.solar_facades.F2.kwh.toFixed(1)} kWh`)
console.log(`  Solar F3 (${payload.state1.solar_facades.F3.compass}): ${payload.state1.solar_facades.F3.kwh.toFixed(1)} kWh`)
console.log(`  Solar F4 (${payload.state1.solar_facades.F4.compass}): ${payload.state1.solar_facades.F4.kwh.toFixed(1)} kWh`)
console.log(`  Solar roof: ${payload.state1.solar_facades.roof.kwh.toFixed(1)} kWh`)
console.log(`  Total solar: ${payload.state1.solar_facades.total_kwh.toFixed(1)} kWh`)
console.log()
console.log(`  External wall loss: ${payload.state1.losses.external_wall?.toFixed(1)} kWh`)
console.log(`  Roof loss: ${payload.state1.losses.roof?.toFixed(1)} kWh`)
console.log(`  Ground floor loss: ${payload.state1.losses.ground_floor?.toFixed(1)} kWh`)
console.log(`  Glazing loss: ${payload.state1.losses.glazing?.toFixed(1)} kWh`)
console.log(`  Thermal bridging: ${payload.state1.losses.thermal_bridging?.toFixed(1)} kWh`)
console.log(`  Fabric leakage: ${payload.state1.losses.fabric_leakage?.toFixed(1)} kWh`)
console.log(`  Permanent vents: ${payload.state1.losses.permanent_vents?.toFixed(1)} kWh`)
console.log()
console.log(`  Heating demand: ${payload.state1.demand?.heating_demand_mwh?.toFixed(1)} MWh`)
console.log(`  Cooling demand: ${payload.state1.demand?.cooling_demand_mwh?.toFixed(1)} MWh`)
console.log(`  Comfort hours: ${payload.state1.demand?.comfort_hours}`)
console.log(`  Underheating hours: ${payload.state1.demand?.underheating_hours}`)
console.log(`  Overheating hours: ${payload.state1.demand?.overheating_hours}`)
console.log()
console.log(`  Annual mean T: ${payload.state1.free_running.annual_mean_c?.toFixed(1)} °C`)
console.log(`  Winter min: ${payload.state1.free_running.winter_min_c?.toFixed(1)} °C`)
console.log(`  Summer max: ${payload.state1.free_running.summer_max_c?.toFixed(1)} °C`)
console.log(`  GIA: ${payload.state1.metadata?.gia_m2} m²`)
console.log()
if (state2) {
  console.log('── State 2 summary (envelope-gains) ──')
  console.log(`  People: ${payload.state2.internal_gains?.people_kwh?.toFixed(0)} kWh, peak ${payload.state2.internal_gains?.people_peak_kw?.toFixed(2)} kW`)
  console.log(`  Lighting: ${payload.state2.internal_gains?.lighting_kwh?.toFixed(0)} kWh`)
  console.log(`  Equipment: ${payload.state2.internal_gains?.equipment_kwh?.toFixed(0)} kWh`)
  console.log(`  Heating demand: ${payload.state2.demand?.heating_demand_mwh?.toFixed(1)} MWh`)
  console.log(`  Cooling demand: ${payload.state2.demand?.cooling_demand_mwh?.toFixed(1)} MWh`)
  console.log()
}
console.log(`Wrote: ${outPath}`)
console.log(`Size:  ${fs.statSync(outPath).size} bytes`)
