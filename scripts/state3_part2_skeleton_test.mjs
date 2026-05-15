/**
 * scripts/state3_part2_skeleton_test.mjs
 *
 * Brief 28f Part 2 verification — confirms `_calculateState3` skeleton:
 *
 * Test 1 — Byte-identity on State 2 fields:
 *   With no systems configured, State 3 output must equal State 2 output
 *   across every State 2 contract field (solar, losses, free_running, demand,
 *   internal_gains, heat_balance, occupancy_summary, state1_delta, etc.).
 *   State 3 adds energy_use / system_performance / carbon — those are
 *   verified to be present with the right shape (all zeros).
 *
 * Test 2 — Library-strict halt on missing template:
 *   Configure a heating primary with a library_id that does not exist in
 *   libraryData.system_templates. Assert MissingLibraryField is thrown
 *   with the sub-system path AND the library_id.
 *
 * Test 3 — Library-strict halt on missing required field:
 *   Configure a heating primary referencing a template that exists but
 *   lacks heating_scop (and lacks the alternate heating_seasonal_efficiency
 *   / heating_cop). Assert MissingLibraryField is thrown naming the
 *   field "heating_scop" and the sub-system path "systems.heating.primary".
 *
 * Test 4 — Library-strict halt on supports_services exclusion:
 *   Configure a heating primary referencing a template that has
 *   cooling_seer but not supports_services=['heating']. Assert
 *   MissingLibraryField thrown referencing supports_services.
 *
 * Test 5 — Ventilation inline-field requirement:
 *   Configure a ventilation system with library_id absent and one of
 *   flow_l_s / sfp_w_per_l_s / hre missing. Assert MissingLibraryField
 *   thrown naming that field.
 *
 * Usage:
 *   node scripts/state3_part2_skeleton_test.mjs [project_id]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant, MissingLibraryField } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'

const PROJECT_ID = process.argv[2] || '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fetchJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

// ── Load project + library + weather ─────────────────────────────────────────
const project = await fetchJson(`${API}/api/projects/${PROJECT_ID}`)
const constructionsLib = await fetchJson(`${API}/api/library/constructions`)
const constructionsArr = constructionsLib.constructions ?? []
const libraryData = {
  constructions: constructionsArr.map(c => ({
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c,
    layers: c.layers,
  })),
  system_templates: [],   // Part 2 tests inject these per case
}
const buildingBase = project.building_config
const constructions = project.construction_choices
const comfortBand = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}

const weatherFile = buildingBase.weather_file || project.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month  = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), direct_normal = new Float32Array(N)
const diffuse_horizontal = new Float32Array(N), wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6]); direct_normal[i] = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15]); wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, buildingBase.orientation ?? 0)

// ── Test helpers ─────────────────────────────────────────────────────────────
let testsRun = 0, testsPassed = 0, testsFailed = 0
function record(name, passed, detail = '') {
  testsRun++
  if (passed) { testsPassed++; console.log(`  ✓ ${name}${detail ? '  —  ' + detail : ''}`) }
  else        { testsFailed++; console.log(`  ✗ ${name}${detail ? '  —  ' + detail : ''}`) }
}

function runState2(building) {
  return calculateInstant(
    building, constructions, {}, libraryData,
    weatherData, hourlySolar, null,
    { mode: 'envelope-gains', comfortBand },
  )
}
function runState3(building) {
  return calculateInstant(
    building, constructions, {}, libraryData,
    weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand },
  )
}

// ── Test 1: byte-identity on State 2 fields ──────────────────────────────────
console.log()
console.log('=== Brief 28f Part 2: State 3 skeleton tests ===')
console.log()
console.log('Test 1 — Byte-identity: State 3 (no systems) vs State 2')
{
  // Use a building config with NO systems_config — exercises the validation
  // pass-through and the empty-overlay return.
  const buildingNoSys = { ...buildingBase, systems_config: undefined }
  const s2 = runState2(buildingNoSys)
  const s3 = runState3(buildingNoSys)

  // Field-by-field byte-identity (deepEqual via JSON serialization, but
  // BEFORE serialization we have to skip the State 3-added keys).
  const ignoreKeys = new Set(['state', 'mode', 'energy_use', 'system_performance', 'carbon_kg_co2_per_m2'])
  const s2Keys = Object.keys(s2).filter(k => !ignoreKeys.has(k))
  for (const k of s2Keys) {
    const s2json = JSON.stringify(s2[k])
    const s3json = JSON.stringify(s3[k])
    record(
      `field "${k}" byte-identical`,
      s2json === s3json,
      s2json === s3json ? '' : `S2 len=${s2json.length} S3 len=${s3json.length}`,
    )
  }

  // State 3-added fields exist with the right shape
  record('state === 3',                              s3.state === 3)
  record('mode === "full"',                          s3.mode === 'full')
  record('energy_use present',                       typeof s3.energy_use === 'object' && s3.energy_use !== null)
  record('energy_use.electricity present',           typeof s3.energy_use?.electricity === 'object')
  record('energy_use.electricity.heating.total === 0', s3.energy_use?.electricity?.heating?.total === 0)
  record('energy_use.gas present',                   typeof s3.energy_use?.gas === 'object')
  record('energy_use.gas.total === 0',               s3.energy_use?.gas?.total === 0)
  record('energy_use.totals.eui_kwh_per_m2 === 0',   s3.energy_use?.totals?.eui_kwh_per_m2 === 0)
  record('system_performance.heating.total.fuel_mwh === 0', s3.system_performance?.heating?.total?.fuel_mwh === 0)
  record('system_performance.cooling.total.fuel_mwh === 0', s3.system_performance?.cooling?.total?.fuel_mwh === 0)
  record('system_performance.dhw.circulation_pump_kwh === 0', s3.system_performance?.dhw?.circulation_pump_kwh === 0)
  record('system_performance.ventilation.systems === []', Array.isArray(s3.system_performance?.ventilation?.systems) && s3.system_performance.ventilation.systems.length === 0)
  record('carbon_kg_co2_per_m2 === 0',               s3.carbon_kg_co2_per_m2 === 0)
}

// ── Test 2: halt on missing library template ─────────────────────────────────
console.log()
console.log('Test 2 — Halt on missing library template (id not found)')
{
  const buildingBadHeating = {
    ...buildingBase,
    systems_config: {
      heating: { primary: { library_id: 'nonexistent_template_999' }, primary_pct: 100 },
    },
  }
  let caught = null
  try { runState3(buildingBadHeating) } catch (e) { caught = e }
  record('throws MissingLibraryField',           caught instanceof MissingLibraryField)
  record('subSystemPath === "systems.heating.primary"', caught?.subSystemPath === 'systems.heating.primary')
  record('libraryId === "nonexistent_template_999"',    caught?.libraryId === 'nonexistent_template_999')
  record('fieldName mentions "not found"',              typeof caught?.fieldName === 'string' && caught.fieldName.includes('not found'))
}

// ── Test 3: halt on missing required scalar efficiency field ─────────────────
console.log()
console.log('Test 3 — Halt on missing required field (heating_scop absent)')
{
  const libWithBrokenTemplate = {
    ...libraryData,
    system_templates: [
      {
        id: 'broken_heating',
        name: 'Heater without an SCOP',
        supports_services: ['heating'],
        // intentionally missing: heating_scop / heating_seasonal_efficiency / heating_cop
        fuel: 'gas',
      },
    ],
  }
  const buildingWithBroken = {
    ...buildingBase,
    systems_config: {
      heating: { primary: { library_id: 'broken_heating' }, primary_pct: 100 },
    },
  }
  let caught = null
  try {
    calculateInstant(
      buildingWithBroken, constructions, {}, libWithBrokenTemplate,
      weatherData, hourlySolar, null,
      { mode: 'full', engine: 'v2.5', comfortBand },
    )
  } catch (e) { caught = e }
  record('throws MissingLibraryField',                    caught instanceof MissingLibraryField)
  record('subSystemPath === "systems.heating.primary"',   caught?.subSystemPath === 'systems.heating.primary')
  record('libraryId === "broken_heating"',                caught?.libraryId === 'broken_heating')
  record('fieldName === "heating_scop"',                  caught?.fieldName === 'heating_scop')
}

// ── Test 4: halt when template doesn't declare the service ──────────────────
console.log()
console.log('Test 4 — Halt on supports_services exclusion (cooling-only template used for heating)')
{
  const libWithCoolingOnly = {
    ...libraryData,
    system_templates: [
      {
        id: 'cooling_only_unit',
        name: 'Chiller, cooling-only',
        supports_services: ['cooling'],
        cooling_seer: 4.2,
        fuel: 'electricity',
      },
    ],
  }
  const buildingUsesCoolingOnlyForHeating = {
    ...buildingBase,
    systems_config: {
      heating: { primary: { library_id: 'cooling_only_unit' }, primary_pct: 100 },
    },
  }
  let caught = null
  try {
    calculateInstant(
      buildingUsesCoolingOnlyForHeating, constructions, {}, libWithCoolingOnly,
      weatherData, hourlySolar, null,
      { mode: 'full', engine: 'v2.5', comfortBand },
    )
  } catch (e) { caught = e }
  record('throws MissingLibraryField',                  caught instanceof MissingLibraryField)
  record('subSystemPath === "systems.heating.primary"', caught?.subSystemPath === 'systems.heating.primary')
  record('libraryId === "cooling_only_unit"',           caught?.libraryId === 'cooling_only_unit')
  record('fieldName mentions "supports_services"',      typeof caught?.fieldName === 'string' && caught.fieldName.includes('supports_services'))
}

// ── Test 5: ventilation inline-field requirement ────────────────────────────
console.log()
console.log('Test 5 — Halt on ventilation system missing inline required field')
{
  const buildingWithBadVent = {
    ...buildingBase,
    systems_config: {
      ventilation: [
        // library_id absent, flow_l_s absent → must halt naming flow_l_s
        { id: 'AHU-1', sfp_w_per_l_s: 1.6, hre: 0.85 },
      ],
    },
  }
  let caught = null
  try { runState3(buildingWithBadVent) } catch (e) { caught = e }
  record('throws MissingLibraryField',                                  caught instanceof MissingLibraryField)
  record('subSystemPath starts "systems.ventilation[0]"',               typeof caught?.subSystemPath === 'string' && caught.subSystemPath.startsWith('systems.ventilation[0]'))
  record('fieldName === "flow_l_s"',                                    caught?.fieldName === 'flow_l_s')
}

// ── Test 6: dual-function library item accepted from heating AND cooling ────
console.log()
console.log('Test 6 — Dual-function library item: same id from heating.primary AND cooling.primary')
{
  const libWithVRF = {
    ...libraryData,
    system_templates: [
      {
        id: 'vrf_dual_function',
        name: 'VRF heat recovery',
        supports_services: ['heating', 'cooling'],
        heating_scop: 3.1,
        cooling_seer: 4.2,
        fuel: 'electricity',
      },
    ],
  }
  const buildingDualFn = {
    ...buildingBase,
    systems_config: {
      heating: { primary: { library_id: 'vrf_dual_function' }, primary_pct: 100 },
      cooling: { primary: { library_id: 'vrf_dual_function' }, primary_pct: 100 },
    },
  }
  let result = null, errCaught = null
  try {
    result = calculateInstant(
      buildingDualFn, constructions, {}, libWithVRF,
      weatherData, hourlySolar, null,
      { mode: 'full', engine: 'v2.5', comfortBand },
    )
  } catch (e) { errCaught = e }
  record('no exception thrown', errCaught == null, errCaught?.message ?? '')
  record('result.state === 3',  result?.state === 3)
  record('result.mode === "full"', result?.mode === 'full')
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log()
console.log('─'.repeat(70))
console.log(`Tests run: ${testsRun}    Passed: ${testsPassed}    Failed: ${testsFailed}`)
console.log('─'.repeat(70))
if (testsFailed > 0) process.exit(1)
