/**
 * scripts/state1_isolation_live.mjs
 *
 * Brief 26 Part 9 — state isolation regression test (live engine).
 *
 * Per the state contract:
 *   "State isolation is non-negotiable: a State 1 computation must produce
 *    identical output regardless of any value in gains/operation/systems."
 *
 * This script walks `FORBIDDEN_ENVELOPE_ONLY_INPUTS` from stateMode.js
 * (canonical list — not hand-rolled) and confirms the live engine's
 * `_calculateEnvelopeOnly` returns output deep-equal to baseline for each
 * forbidden input set to an unambiguously-distorting value.
 *
 * Bar: byte-identical via canonical JSON. Float tolerance is zero.
 *
 * Pair this with scripts/state1_isolation_epjson.py for the EP-path
 * coverage (assembler byte-identity).
 *
 * Usage:
 *   node scripts/state1_isolation_live.mjs [project_id]
 *   exit code 0 = all pass; 1 = any leak
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { FORBIDDEN_ENVELOPE_ONLY_INPUTS } from '../frontend/src/utils/stateMode.js'

const PROJECT_ID = process.argv[2] || '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

// ── Absurd values ────────────────────────────────────────────────────────────
//
// Each chosen to be physically wrong if leaked into the State 1 calc.
// Not "different from default" — actively distorting. If the contract
// holds, setting these has zero effect on State 1 output.
const ABSURD = {
  // Legacy occupancy
  'params.num_bedrooms':            9999,
  'params.occupancy_rate':           9.99,
  'params.people_per_room':           5.0,
  // Internal loads — 100 W/m² each is roughly 10× a real installation
  'systems.lighting_power_density':  100,
  'systems.equipment_power_density': 100,
  'systems.lighting_control':       'always-on-9999',
  // v2.3 occupancy (Brief 27)
  'occupancy.occupancy_rate':            9.99,
  'occupancy.density':                   { value: 999, basis: 'per_m2' },
  'occupancy.sensible_w_per_person':     9999,
  'occupancy.latent_w_per_person':       9999,
  'occupancy.schedule':                  { weekday: Array(24).fill(99), saturday: Array(24).fill(99), sunday: Array(24).fill(99), monthly_multipliers: Array(12).fill(99), exceptions: [] },
  'occupancy.schedule.exceptions':       [{ name: 'absurd', start_date: '01-01', end_date: '12-31', weekday: Array(24).fill(99), saturday: Array(24).fill(99), sunday: Array(24).fill(99) }],
  // v2.3 gains (Brief 27)
  'gains.lighting.magnitude':                  { value: 999, unit: 'w_per_m2' },
  'gains.lighting.relationship_to_occupancy':  'always_on',
  'gains.lighting.spill_minutes':              999,
  'gains.lighting.daylight_factor':            0.01,
  'gains.lighting.schedule':                   { weekday: Array(24).fill(99) },
  'gains.equipment.baseload':                  { value: 999, unit: 'w_per_m2' },
  'gains.equipment.active':                    { value: 999, unit: 'w_per_m2' },
  'gains.equipment.relationship_to_occupancy': 'independent',
  'gains.equipment.standby_factor':            0.99,
  'gains.equipment.schedule':                  { weekday: Array(24).fill(99) },
  // Systems — extreme setpoints + impossible COPs
  'systems.space_heating':   { setpoint_heating_c: 35, cop: 99 },
  'systems.space_cooling':   { setpoint_cooling_c:  5, cop: 99 },
  'systems.dhw':             { setpoint_c: 99, cop: 99 },
  'systems.ventilation':     { ventilation_ach: 99 },
  'systems.hvac_type':              'invalid-system-9999',
  'systems.dhw_primary':            'invalid-dhw-9999',
  'systems.dhw_preheat':            99,
  'systems.dhw_setpoint':           99,
  'systems.ventilation_type':       'invalid-vent-9999',
  'systems.ventilation_control':    'invalid-control-9999',
  'systems.sfp_override':           99,
  'systems.cop_heating':            99,
  'systems.mvhr_efficiency':         0.99,
  // Operable windows — 99% openable on every facade, always open
  'openings.schedule':              'always',
  'openings.{face}.openable_fraction': 0.99,  // applied to all four faces
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function fetchJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

/** Canonical JSON: keys sorted recursively, no whitespace. */
function canonical(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(o)
  if (Array.isArray(o)) return '[' + o.map(canonical).join(',') + ']'
  const keys = Object.keys(o).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}'
}

/** Apply ABSURD[path] = value to either `building` or `systems` cluster. */
function applyAbsurd(building, systems, path, value) {
  building = structuredClone(building)
  systems  = structuredClone(systems)
  if (path === 'openings.{face}.openable_fraction') {
    building.openings = building.openings ?? {}
    for (const f of ['north','south','east','west']) {
      building.openings[f] = { ...(building.openings[f] ?? {}), openable_fraction: value }
    }
    return { building, systems }
  }
  const [root, ...rest] = path.split('.')
  // occupancy.* and gains.* are v2.3 building_config nested blocks — same
  // storage rule as `openings`: walk inside `building`, materialising the
  // root object if absent.
  if (root === 'occupancy' || root === 'gains') {
    building[root] = building[root] ?? {}
    let cursor = building[root]
    if (rest.length === 0) {
      // path was just 'occupancy' or 'gains' — clobber the whole block.
      building[root] = value
      return { building, systems }
    }
    for (let i = 0; i < rest.length - 1; i++) {
      cursor[rest[i]] = cursor[rest[i]] ?? {}
      cursor = cursor[rest[i]]
    }
    cursor[rest[rest.length - 1]] = value
    return { building, systems }
  }
  const target = root === 'params' ? building :
                 root === 'systems' ? systems :
                 root === 'openings' ? (building.openings = building.openings ?? {}) :
                 null
  if (!target) throw new Error(`Unknown root in forbidden path: ${path}`)
  let cursor = root === 'openings' ? building.openings : target
  for (let i = 0; i < rest.length - 1; i++) {
    cursor[rest[i]] = cursor[rest[i]] ?? {}
    cursor = cursor[rest[i]]
  }
  cursor[rest[rest.length - 1]] = value
  return { building, systems }
}

// ── Load project + library + weather + solar ─────────────────────────────────
const project = await fetchJson(`${API}/api/projects/${PROJECT_ID}`)
const constructionsLib = await fetchJson(`${API}/api/library/constructions`)
const constructionsArr = constructionsLib.constructions ?? []
const libraryData = {
  constructions: constructionsArr.map(c => ({
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    config_json: c.config_json ?? c,
  })),
}
const building = project.building_config
const systems = project.systems_config ?? {}
const constructions = project.construction_choices
const comfortBand = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}

const weatherFile = building.weather_file || project.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), wind_speed = new Float32Array(N)
const direct_normal = new Float32Array(N), diffuse_horizontal = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i] = parseInt(p[1]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6])
  direct_normal[i] = parseFloat(p[14]); diffuse_horizontal[i] = parseFloat(p[15])
  wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, building.orientation || 0)

function runState1(b, s) {
  return calculateInstant(
    { ...b, comfort_band: comfortBand },
    constructions, s, libraryData,
    weatherData, hourlySolar, null,
    { mode: 'envelope-only', comfortBand },
  )
}

// ── Baseline ─────────────────────────────────────────────────────────────────
const baseline = runState1(building, systems)
const baselineCanonical = canonical(baseline)
const baselineBytes = baselineCanonical.length

console.log()
console.log('═════════════════════════════════════════════════════════════════════')
console.log('  STATE 1 ISOLATION REGRESSION — LIVE ENGINE')
console.log('═════════════════════════════════════════════════════════════════════')
console.log(`  Project:        ${project.name} (${PROJECT_ID})`)
console.log(`  Baseline bytes: ${baselineBytes}`)
console.log(`  Forbidden list: ${FORBIDDEN_ENVELOPE_ONLY_INPUTS.length} paths`)
console.log()

const failures = []
let passed = 0

// ── Per-path enumeration ─────────────────────────────────────────────────────
for (const fpath of FORBIDDEN_ENVELOPE_ONLY_INPUTS) {
  if (!(fpath in ABSURD)) {
    console.log(`  SKIP ${fpath.padEnd(48)} (no absurd value defined in test)`)
    continue
  }
  const { building: bMod, systems: sMod } = applyAbsurd(building, systems, fpath, ABSURD[fpath])
  const out = runState1(bMod, sMod)
  const outCanonical = canonical(out)
  if (outCanonical === baselineCanonical) {
    console.log(`  ✓ ${fpath.padEnd(48)} byte-identical`)
    passed++
  } else {
    console.log(`  ✗ ${fpath.padEnd(48)} LEAKED — output differs from baseline`)
    failures.push({ path: fpath, value: ABSURD[fpath], delta_bytes: outCanonical.length - baselineBytes })
  }
}

// ── Combined: every forbidden input absurd at once ──────────────────────────
let b = building, s = systems
for (const [fpath, v] of Object.entries(ABSURD)) {
  ({ building: b, systems: s } = applyAbsurd(b, s, fpath, v))
}
const combinedOut = runState1(b, s)
const combinedCanonical = canonical(combinedOut)
console.log()
if (combinedCanonical === baselineCanonical) {
  console.log(`  ✓ COMBINED (all forbidden absurd at once)        byte-identical`)
  passed++
} else {
  console.log(`  ✗ COMBINED (all forbidden absurd at once)        LEAKED`)
  failures.push({ path: 'COMBINED', value: 'all', delta_bytes: combinedCanonical.length - baselineBytes })
}

// ── Verdict ──────────────────────────────────────────────────────────────────
console.log()
console.log('═════════════════════════════════════════════════════════════════════')
if (failures.length === 0) {
  console.log(`  ✓ ALL PASS — ${passed} scenarios, every State 1 output byte-identical`)
  console.log('═════════════════════════════════════════════════════════════════════')
  process.exit(0)
} else {
  console.log(`  ✗ ${failures.length} LEAK(S) — state isolation contract violated`)
  for (const f of failures) {
    console.log(`    ${f.path}: delta ${f.delta_bytes >= 0 ? '+' : ''}${f.delta_bytes} bytes`)
  }
  console.log('═════════════════════════════════════════════════════════════════════')
  process.exit(1)
}
