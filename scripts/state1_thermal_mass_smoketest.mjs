/**
 * scripts/state1_thermal_mass_smoketest.mjs
 *
 * Brief 26 Part 7 — thermal mass dropdown wiring smoke test.
 *
 * Runs the live engine on the same building config three times, varying
 * only `thermal_mass_category` (light / medium / heavy). The live engine's
 * State 1 free-running temperature trace MUST change with the dropdown —
 * if it doesn't, the wiring is broken.
 *
 * Expected qualitative behaviour:
 *   light  → biggest peak-to-peak swing; widest disagreement with EP
 *   medium → intermediate
 *   heavy  → tightest swing; narrowest disagreement with EP
 *     (EP integrates real layered mass; heavy converges toward EP)
 *
 * Usage:
 *   node scripts/state1_thermal_mass_smoketest.mjs [project_id]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'

const PROJECT_ID = process.argv[2] || '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'  // HIX Bridgewater
const API = 'http://127.0.0.1:8002'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fetchJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

// ── Fetch project + library ───────────────────────────────────────────────────
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
    config_json: c.config_json ?? c,
    layers: c.layers,
  })),
}

const buildingConfig = project.building_config
const constructionChoices = project.construction_choices
const comfortBand = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}

// ── Load EPW ─────────────────────────────────────────────────────────────────
const weatherFile = buildingConfig.weather_file || project.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N)
const direct_normal = new Float32Array(N), diffuse_horizontal = new Float32Array(N)
const wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i] = parseInt(p[1]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6])
  direct_normal[i] = parseFloat(p[14]); diffuse_horizontal[i] = parseFloat(p[15])
  wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, buildingConfig.orientation || 0)

// Brief 26.1 Part 5: this smoke test is now in OVERRIDE mode. The Auto
// derivation path is exercised separately below by varying the chosen
// constructions (not the category) so both wiring paths are confirmed.

// ── Override-mode test: vary thermal_mass_category at fixed constructions ────
const results = {}
for (const mass of ['light', 'medium', 'heavy']) {
  const live = calculateInstant(
    { ...buildingConfig, thermal_mass_mode: 'override', thermal_mass_category: mass, comfort_band: comfortBand },
    constructionChoices, {}, libraryData,
    weatherData, hourlySolar, null,
    { mode: 'envelope-only', comfortBand },
  )
  results[mass] = {
    annual_mean_c:        live.free_running?.annual_mean_c,
    winter_min_c:         live.free_running?.winter_min_c,
    summer_max_c:         live.free_running?.summer_max_c,
    swing_c:              (live.free_running?.summer_max_c ?? 0) - (live.free_running?.winter_min_c ?? 0),
    heating_demand_mwh:   live.demand?.heating_demand_mwh,
    cooling_demand_mwh:   live.demand?.cooling_demand_mwh,
    underheating_hours:   live.demand?.underheating_hours,
    overheating_hours:    live.demand?.overheating_hours,
    comfort_hours:        live.demand?.comfort_hours,
  }
}

const f = (n, d = 1) => n == null ? 'null' : Number(n).toFixed(d).padStart(8)

console.log()
console.log('═════════════════════════════════════════════════════════════════════')
console.log('  THERMAL MASS DROPDOWN — WIRING SMOKE TEST (live engine, State 1)')
console.log('═════════════════════════════════════════════════════════════════════')
console.log()
console.log('                              light    medium     heavy')
console.log('  annual_mean_c            ' + ['light','medium','heavy'].map(m => f(results[m].annual_mean_c)).join('  '))
console.log('  winter_min_c             ' + ['light','medium','heavy'].map(m => f(results[m].winter_min_c)).join('  '))
console.log('  summer_max_c             ' + ['light','medium','heavy'].map(m => f(results[m].summer_max_c)).join('  '))
console.log('  swing_c (max − min)      ' + ['light','medium','heavy'].map(m => f(results[m].swing_c)).join('  '))
console.log('  heating_demand_mwh       ' + ['light','medium','heavy'].map(m => f(results[m].heating_demand_mwh)).join('  '))
console.log('  cooling_demand_mwh       ' + ['light','medium','heavy'].map(m => f(results[m].cooling_demand_mwh)).join('  '))
console.log('  underheating_hours       ' + ['light','medium','heavy'].map(m => f(results[m].underheating_hours, 0)).join('  '))
console.log('  overheating_hours        ' + ['light','medium','heavy'].map(m => f(results[m].overheating_hours, 0)).join('  '))
console.log('  comfort_hours            ' + ['light','medium','heavy'].map(m => f(results[m].comfort_hours, 0)).join('  '))
console.log()

// ── Pass / fail verdict ──────────────────────────────────────────────────────
const swing = results
const lightSwing  = swing.light.swing_c
const mediumSwing = swing.medium.swing_c
const heavySwing  = swing.heavy.swing_c

const monotonic = lightSwing > mediumSwing && mediumSwing > heavySwing
const sensitivity_c = lightSwing - heavySwing

console.log(`  Light swing:  ${lightSwing.toFixed(1)}°C`)
console.log(`  Heavy swing:  ${heavySwing.toFixed(1)}°C`)
console.log(`  Sensitivity:  ${sensitivity_c.toFixed(1)}°C (light − heavy)`)
console.log()

if (monotonic && sensitivity_c > 1) {
  console.log('  ✓ OVERRIDE WIRING OK — swing monotonically decreases with mass,')
  console.log('    sensitivity > 1°C. Live engine respects the manual category.')
} else if (sensitivity_c < 0.1) {
  console.log('  ✗ OVERRIDE WIRING BROKEN — temperature trace barely changes with mass.')
  console.log('    UI value is likely not reaching `_calculateEnvelopeOnly`.')
} else {
  console.log('  ~ Suspicious — swing changes but not monotonically.')
}
console.log()

// ── Auto-mode test: vary construction choices, expect derived mass to follow ─
//
// Swap roof: pitched_roof_standard (10 kJ/m²K, light) → flat_roof_standard
// (304 kJ/m²K, heavy). The derived total mass should jump correspondingly
// and the live engine should respond. If the auto path is broken, the two
// would produce identical numbers.
import { deriveBuildingMass } from '../frontend/src/utils/thermalMass.js'
console.log('  AUTO-MODE TEST — vary construction choices, observe derived C_mass:')
console.log()
console.log('  scenario              derived (kJ/m²K-GIA)   summer_max   heating MWh')
console.log('  ' + '-'.repeat(70))
for (const [label, overrideConstructions] of [
  ['default (pitched roof)', constructionChoices],
  ['heavy roof swap',        { ...constructionChoices, roof: 'flat_roof_standard' }],
  ['heavy walls swap',       { ...constructionChoices, external_wall: 'cavity_wall_standard' /* still medium 150 */ }],
]) {
  const derived = deriveBuildingMass(buildingConfig, overrideConstructions, libraryData)
  const live = calculateInstant(
    { ...buildingConfig, thermal_mass_mode: 'auto', comfort_band: comfortBand },
    overrideConstructions, {}, libraryData,
    weatherData, hourlySolar, null,
    { mode: 'envelope-only', comfortBand },
  )
  console.log(`  ${label.padEnd(22)}${(derived.total_kJ_per_m2K_GIA ?? 0).toFixed(0).padStart(8)}        ${(live.free_running?.summer_max_c ?? 0).toFixed(1).padStart(7)}       ${(live.demand?.heating_demand_mwh ?? 0).toFixed(1).padStart(6)}`)
}
console.log()
console.log('  Auto wiring OK if derived mass and summer_max differ across rows.')
console.log('═════════════════════════════════════════════════════════════════════')
