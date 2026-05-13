/**
 * scripts/state2_multiprofile_smoketest.mjs
 *
 * Brief 27 Revised Part 9 — verify multi-profile additive behaviour.
 *
 * Three runs against Bridgewater:
 *   1. Single profile (default after v2.4 migration): bedroom lighting at
 *      8 W/m² × area_share 1.0.
 *   2. Two profiles: bedroom 8 W/m² × area_share 0.7 + corridor 2 W/m² ×
 *      area_share 0.3, corridor on always-on schedule.
 *   3. Reduce bedroom area_share to 0.6 to verify weighting is being
 *      applied, not just summed naively.
 *
 * The lighting kWh should change in each case in line with the engine
 * math: effective_LPD = Σ (profile_LPD × profile_area_share).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'

const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fetchJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} -> ${r.status}`)
  return r.json()
}

const project = await fetchJson(`${API}/api/projects/${PROJECT_ID}`)
const constructionsLib = await fetchJson(`${API}/api/library/constructions`)
const libraryData = {
  constructions: (constructionsLib.constructions ?? []).map(c => ({
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    config_json: c.config_json ?? c,
  })),
}
const baseBuilding = project.building_config
const systems = project.systems_config ?? {}
const constructions = project.construction_choices
const comfortBand = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}

// Weather
const weatherFile = baseBuilding.weather_file || project.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), wind_speed = new Float32Array(N)
const direct_normal = new Float32Array(N), diffuse_horizontal = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6])
  direct_normal[i] = parseFloat(p[14]); diffuse_horizontal[i] = parseFloat(p[15])
  wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, baseBuilding.orientation || 0)

function runState2(building) {
  return calculateInstant(
    { ...building, comfort_band: comfortBand },
    constructions, systems, libraryData,
    weatherData, hourlySolar, null,
    { mode: 'envelope-gains', comfortBand },
  )
}

function summarise(result, label) {
  const l = result.gains.lighting
  console.log(`${label}:`)
  console.log(`  lighting total:    ${l.total_kwh.toLocaleString()} kWh`)
  console.log(`  effective LPD:     ${l.effective_lpd_w_per_m2.toFixed(2)} W/m²`)
  console.log(`  total peak:        ${l.total_peak_kw.toFixed(2)} kW`)
  console.log(`  profiles (${l.profiles.length}):`)
  for (const p of l.profiles) {
    console.log(`    ${p.label.padEnd(22)} kwh=${String(p.kwh.toLocaleString()).padStart(10)} peak=${p.peak_kw.toFixed(2)} kW hrs=${p.hours_active}`)
  }
  console.log()
}

console.log()
console.log('═════════════════════════════════════════════════════════════════════')
console.log('  STATE 2 MULTI-PROFILE SMOKETEST — Brief 27 Revised Part 9')
console.log('═════════════════════════════════════════════════════════════════════')
console.log()

// ── Run 1: single profile (as migrated v2.3 → v2.4) ─────────────────────────
const run1 = runState2(baseBuilding)
summarise(run1, 'RUN 1 — single profile, area_share 1.0 (post-migration baseline)')
const single_kwh = run1.gains.lighting.total_kwh

// ── Run 2: bedroom area_share 0.7 + corridor 2 W/m² always-on area_share 0.3 ─
const b2 = JSON.parse(JSON.stringify(baseBuilding))
b2.gains.lighting.profiles[0].area_share = 0.7
b2.gains.lighting.profiles.push({
  id: 'corridor_lighting_test',
  label: 'Corridor lighting',
  magnitude: { value: 2, unit: 'w_per_m2' },
  relationship_to_occupancy: 'always_on',
  area_share: 0.3,
  schedule: b2.gains.lighting.profiles[0].schedule,  // unused for always_on, kept for completeness
  _provenance: { source: 'multiprofile_smoketest', confidence: 'medium' },
})
const run2 = runState2(b2)
summarise(run2, 'RUN 2 — bedroom 8 W/m² × 0.7 area + corridor 2 W/m² always-on × 0.3 area')
const two_kwh = run2.gains.lighting.total_kwh

// ── Run 3: weighted differently to prove area_share affects engine output ────
const b3 = JSON.parse(JSON.stringify(b2))
b3.gains.lighting.profiles[0].area_share = 0.6
b3.gains.lighting.profiles[1].area_share = 0.4
const run3 = runState2(b3)
summarise(run3, 'RUN 3 — bedroom × 0.6 + corridor × 0.4 (weighting check)')
const three_kwh = run3.gains.lighting.total_kwh

// ── Diagnostic ───────────────────────────────────────────────────────────────
console.log('── Additivity checks ────────────────────────────────────────────────')
const corridor_only_estimate = 2 * 3458 * 0.3 * 8760 / 1000  // always-on × area_share
const bedroom_at_07           = single_kwh * 0.7  // bedroom scales linearly with area_share
const expected_run2           = bedroom_at_07 + corridor_only_estimate
console.log(`  Expected RUN 2 (bedroom×0.7 + corridor 2 W/m² × 0.3 × 8760):`)
console.log(`     bedroom @ 0.7 area = ${bedroom_at_07.toFixed(0).padStart(10)} kWh`)
console.log(`     corridor 2 W/m² × 0.3 × 8760 = ${corridor_only_estimate.toFixed(0).padStart(10)} kWh`)
console.log(`     expected total = ${expected_run2.toFixed(0).padStart(10)} kWh`)
console.log(`     actual RUN 2 total = ${two_kwh.toFixed(0).padStart(10)} kWh`)
const drift_pct = Math.abs(two_kwh - expected_run2) / expected_run2 * 100
console.log(`     drift = ${drift_pct.toFixed(2)}%`)

console.log()
console.log('── Effective LPD check ─────────────────────────────────────────────')
console.log(`  RUN 1: ${run1.gains.lighting.effective_lpd_w_per_m2.toFixed(2)} W/m² (1 profile @ 8 × 1.0 = 8)`)
console.log(`  RUN 2: ${run2.gains.lighting.effective_lpd_w_per_m2.toFixed(2)} W/m² (expect 8×0.7 + 2×0.3 = 6.2)`)
console.log(`  RUN 3: ${run3.gains.lighting.effective_lpd_w_per_m2.toFixed(2)} W/m² (expect 8×0.6 + 2×0.4 = 5.6)`)

const ok =
  Math.abs(run1.gains.lighting.effective_lpd_w_per_m2 - 8.0) < 0.05 &&
  Math.abs(run2.gains.lighting.effective_lpd_w_per_m2 - 6.2) < 0.05 &&
  Math.abs(run3.gains.lighting.effective_lpd_w_per_m2 - 5.6) < 0.05 &&
  drift_pct < 10

console.log()
console.log('═════════════════════════════════════════════════════════════════════')
if (ok) {
  console.log('  ✓ MULTI-PROFILE ADDITIVE BEHAVIOUR VERIFIED')
} else {
  console.log('  ✗ One or more checks failed — see above')
}
console.log('═════════════════════════════════════════════════════════════════════')
process.exit(ok ? 0 : 1)
