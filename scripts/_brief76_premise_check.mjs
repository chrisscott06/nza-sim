/**
 * Brief 76 premise check — read-only diagnostic.
 *
 * The architect (Claude Chat) has proposed Brief 76 to extend the State 3
 * dispatch gate at `instantCalc.js:6668` to recognise v40-shape projects,
 * on the hypothesis that Bridgewater currently dispatches to inline-legacy
 * `_calculateInstantBaseline 'full'`. The hypothesis links the broken
 * per-system mech vent rendering on the Heat Balance Sankey to this
 * dispatch gap.
 *
 * Chris asks Code to verify before acting on the brief.
 *
 * This probe answers four questions:
 *
 *   Q1. Which engine path is Bridgewater dispatching to right now? Evaluate
 *       `hasV25Config` and `hasV25Library` directly using the same logic
 *       as `_calculateInstantBaseline:6666-6668`, side-by-side with
 *       `result.state` (the engine-self-reported state numeric).
 *   Q2. What's in `result.heat_balance.losses_at_setpoint.ventilation`?
 *       Empty array? Populated with per-system entries that have zero
 *       heat_loss_kwh? Absent entirely?
 *   Q3. (Code reads the renderer separately — out of scope for this probe.)
 *   Q4. Does the evidence support the architect's dispatch-gap hypothesis,
 *       or point elsewhere?
 *
 * Run:
 *   cd C:\Users\ChrisScott\Dev\nza-sim
 *   node scripts/_brief76_premise_check.mjs > docs/audit/76_premise_check_output.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const API         = 'http://127.0.0.1:8002'
const PROJECT_ID  = '3561c5a6-9a3f-4b5c-9e3d-72b449658d9a'
const __dirname   = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT   = path.resolve(__dirname, '..')

async function fj(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${url} → ${r.status}`); return r.json()
}

const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const libArr  = (await fj(`${API}/api/library/constructions`)).constructions ?? []
const constructions = project.construction_choices
const building = project.building_config
const dbCb = { lower_c: project.comfort_band_lower_c ?? 20, upper_c: project.comfort_band_upper_c ?? 26 }

const epwPath = path.join(REPO_ROOT, 'data/weather/current', building.weather_file)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), direct_normal = new Float32Array(N)
const diffuse_horizontal = new Float32Array(N), wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6]); direct_normal[i] = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15]); wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, building.orientation ?? 0)

// Build libraryData TWO ways to mirror the live caller exactly.
//
// Variant A: with SYSTEM_TEMPLATES_LIBRARY attached as system_templates.
//   This is what scripts/_brief73_p1_anchor.mjs and Brief 74's P1 probe
//   used. It causes `hasV25Library` to evaluate true.
//
// Variant B: without system_templates. The actual frontend ProjectContext
//   loader may or may not attach SYSTEM_TEMPLATES_LIBRARY into libraryData
//   under that field name — we need to check both to identify which
//   matches the live UI.
const libraryDataA = {
  constructions: libArr.map(c => ({
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    g_value: c.config_json?.g_value, config_json: c.config_json ?? c, layers: c.layers,
  })),
  system_templates:  SYSTEM_TEMPLATES_LIBRARY,
  library_systems:   building?.library_systems   ?? [],
  library_schedules: building?.library_schedules ?? [],
}
const libraryDataB = {
  constructions: libraryDataA.constructions,
  // No system_templates key.
  library_systems:   building?.library_systems   ?? [],
  library_schedules: building?.library_schedules ?? [],
}

// Reproduce the gate evaluation exactly as it appears at
// instantCalc.js:6666-6668.
function evaluateGate(building, libraryData, options = {}) {
  const mode = options.mode ?? 'full'
  const hasV25Config  = building.systems_config_v25
                        && Object.keys(building.systems_config_v25).length > 0
  const hasV25Library = Array.isArray(libraryData?.system_templates)
                        && libraryData.system_templates.length > 0
  const optsEngineV25 = options.engine === 'v2.5'
  const fires_state3 = mode === 'full' && (optsEngineV25 || (hasV25Config && hasV25Library))
  return {
    mode,
    hasV25Config_value: building.systems_config_v25,
    hasV25Config_evaluated: !!hasV25Config,
    hasV25Config_keys_length: building.systems_config_v25
      ? Object.keys(building.systems_config_v25).length : 0,
    hasV25Library_array_check: Array.isArray(libraryData?.system_templates),
    hasV25Library_length: Array.isArray(libraryData?.system_templates)
      ? libraryData.system_templates.length : 0,
    hasV25Library_evaluated: hasV25Library,
    options_engine: options.engine ?? null,
    fires_state3_branch: fires_state3,
    will_dispatch_to: fires_state3 ? '_calculateState3 (State 3)' : 'inline-legacy `full` path (`_calculateInstantBaseline` body from L6675)',
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Q1 — Gate evaluation, four combinations.
// ──────────────────────────────────────────────────────────────────────────
//
// Live SystemSankey at `SystemsModule.jsx:378-385` calls calculateInstant
// without `options.engine`. We don't know if its libraryData has
// system_templates populated. Test both with and without.

const Q1 = {
  description: 'Gate evaluation reproducing instantCalc.js:6666-6668 logic exactly.',
  matrix: {
    'lib_A_no_engine_opt': evaluateGate(building, libraryDataA, {}),
    'lib_A_with_engine_v2.5_opt': evaluateGate(building, libraryDataA, { engine: 'v2.5' }),
    'lib_B_no_engine_opt': evaluateGate(building, libraryDataB, {}),
    'lib_B_with_engine_v2.5_opt': evaluateGate(building, libraryDataB, { engine: 'v2.5' }),
  },
}

// ──────────────────────────────────────────────────────────────────────────
// Q2 — losses_at_setpoint.ventilation contents on State 3 result.
// ──────────────────────────────────────────────────────────────────────────
//
// Run with engine: 'v2.5' to force State 3 (matches the live UI dispatch
// per evidence in Brief 75 P1). Then inspect what's at
// `result.heat_balance.losses_at_setpoint.ventilation` and adjacent paths.

const result = calculateInstant(
  building, constructions, {}, libraryDataA,
  weatherData, hourlySolar, null,
  { comfortBand: dbCb, _skipInterventions: true, engine: 'v2.5' },
)

const hb = result?.heat_balance ?? {}

function safe(obj) {
  try { return JSON.parse(JSON.stringify(obj)) } catch (e) { return '[unserialisable]' }
}

const Q2 = {
  description: 'losses_at_setpoint.ventilation contents on Bridgewater today.',
  result_state: result?.state,
  result_mode: result?.mode,
  heat_balance_top_level_keys: Object.keys(hb),
  has_losses_at_setpoint: 'losses_at_setpoint' in hb,
  losses_at_setpoint_keys: hb.losses_at_setpoint ? Object.keys(hb.losses_at_setpoint) : null,
  losses_at_setpoint_ventilation: safe(hb.losses_at_setpoint?.ventilation ?? null),
  losses_at_setpoint_ventilation_type: Array.isArray(hb.losses_at_setpoint?.ventilation)
    ? `array length ${hb.losses_at_setpoint.ventilation.length}`
    : hb.losses_at_setpoint?.ventilation == null
    ? 'absent / null'
    : typeof hb.losses_at_setpoint.ventilation,
  // Brief 74 P5 added the aggregate:
  losses_annual_keys: hb.annual?.losses ? Object.keys(hb.annual.losses) : null,
  losses_annual_mech_ventilation: safe(hb.annual?.losses?.mech_ventilation ?? null),
  // Brief 73 P5-redux Part B added per-service ventilation breakdown:
  has_brief40_ventilation: 'ventilation' in (result?.consumption?.brief40 ?? {}),
  brief40_ventilation_systems_count: result?.consumption?.brief40?.ventilation?.systems?.length ?? null,
  brief40_ventilation_first_system_keys: result?.consumption?.brief40?.ventilation?.systems?.[0]
    ? Object.keys(result.consumption.brief40.ventilation.systems[0]) : null,
}

// ──────────────────────────────────────────────────────────────────────────
// Q3 — Renderer iteration: Code reads HeatBalance.jsx + BalanceSankey.jsx
//       separately. See diagnostic report. Out of scope for this probe.
// ──────────────────────────────────────────────────────────────────────────

const report = {
  brief: 'Brief 76 premise check — read-only diagnostic',
  source: 'node scripts/_brief76_premise_check.mjs',
  captured_at: new Date().toISOString(),
  Q1_dispatch_gate: Q1,
  Q2_losses_at_setpoint: Q2,
  note: 'Q3 (renderer iteration) covered separately in the diagnostic write-up.',
}

console.log(JSON.stringify(report, null, 2))
