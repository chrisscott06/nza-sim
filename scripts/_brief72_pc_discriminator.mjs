/**
 * Brief 72 PC discriminator — regression on RE-CREATED Bridgewater.
 *
 * Sister to scripts/_brief72_p2_discriminator.mjs. Two key differences:
 *
 *   1. Fixtures the re-created Bridgewater project to
 *      docs/audit/fixtures/bridgewater_post_recreate.json. The fixture
 *      is the regression artefact; subsequent re-runs replay from disk
 *      so the live DB stays untouched (Brief 72 PA Rule 1 — preferred
 *      fixture-path pattern for read-only diagnostics).
 *
 *   2. Project has zero persisted interventions (it was just re-seeded).
 *      So this script BUILDS a singleton Occupancy-4 stack in-memory:
 *        { id: 'occ4', label: 'Occupancy 4', enabled: true,
 *          patches: [{ op: 'set',
 *                      path: 'building.occupancy.density.value',
 *                      value: 4 }] }
 *      and injects it as building.interventions before calling
 *      calculateInstant.
 *
 * Run:
 *   cd C:\Users\ChrisScott\Dev\nza-sim
 *   node scripts/_brief72_pc_discriminator.mjs
 *
 * Output is JSON. Save verbatim to docs/audit/72_auxiliary_loads_dhw_shape.md
 * §pc-regression for the post-recreation, post-P3 anchor.
 *
 * Expected (P3 engine edits already on disk — uncommitted):
 *   - dhw_demand_baseline_mwh  ≈ 421 MWh   (138 × 3 × 1.0 = 414 effective
 *                                            vs 207 effective pre-P3)
 *   - dhw_demand_after0_mwh    ≈ 561.5 MWh (138 × 4 × 1.0 = 552 effective
 *                                            at density 4 — Occupancy 4
 *                                            intervention target)
 *
 * If dhw_demand_baseline_mwh comes back as ~210.5 MWh, the P3 edits to
 * instantCalc.js / systemsEngine.js did not take effect on this code path —
 * stop and investigate before continuing to P3 close.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const API         = 'http://127.0.0.1:8002'
const PROJECT_ID  = '3561c5a6-9a3f-4b5c-9e3d-72b449658d9a'  // re-created HIX Bridgewater
const __dirname   = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT   = path.resolve(__dirname, '..')
const FIXTURE_DIR = path.join(REPO_ROOT, 'docs/audit/fixtures')
const FIXTURE     = path.join(FIXTURE_DIR, 'bridgewater_post_recreate.json')

async function fj(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

// 1. Fixture project + library (write-once; subsequent runs replay from disk).
fs.mkdirSync(FIXTURE_DIR, { recursive: true })
let project, libArr
if (fs.existsSync(FIXTURE)) {
  const cached = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'))
  project = cached.project
  libArr  = cached.lib_constructions ?? []
  process.stderr.write(`[fixture] replayed from ${FIXTURE}\n`)
} else {
  project = await fj(`${API}/api/projects/${PROJECT_ID}`)
  const libResp = await fj(`${API}/api/library/constructions`)
  libArr = libResp.constructions ?? []
  fs.writeFileSync(FIXTURE, JSON.stringify({
    fetched_at:      new Date().toISOString(),
    project_id:      PROJECT_ID,
    source_endpoint: `${API}/api/projects/${PROJECT_ID}`,
    project,
    lib_constructions: libArr,
  }, null, 2))
  process.stderr.write(`[fixture] wrote ${FIXTURE} (project ${project.name})\n`)
}

const constructions = project.construction_choices
const systems       = {}
const baseBuilding  = project.building_config
const dbCb          = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}

// 2. Inject the singleton Occupancy-4 stack.
const occ4 = {
  id: 'occ4',
  label: 'Occupancy 4',
  theme: 'Occupancy',
  enabled: true,
  patches: [
    { op: 'set', path: 'building.occupancy.density.value', value: 4 },
  ],
}
const building = { ...baseBuilding, interventions: [occ4] }

// 3. Weather + solar (same as P2 — read from current/weather_file).
const epwPath  = path.join(REPO_ROOT, 'data/weather/current', building.weather_file)
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

const libraryData = {
  constructions: libArr.map(c => ({
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c,
    layers: c.layers,
  })),
  system_templates:  SYSTEM_TEMPLATES_LIBRARY,
  library_systems:   baseBuilding?.library_systems   ?? [],
  library_schedules: baseBuilding?.library_schedules ?? [],
}

// 4. Run engine.
const engineResult = calculateInstant(
  building,
  constructions, systems, libraryData,
  weatherData, hourlySolar, null,
  { mode: 'full', comfortBand: dbCb, engine: 'v2.5' },
)
const stackResult = engineResult?.consumption?.interventions ?? engineResult?.interventions ?? null

if (!stackResult || !Array.isArray(stackResult.interventions) || stackResult.interventions.length === 0) {
  console.log(JSON.stringify({
    error: 'no_stack_result',
    note: 'singleton occ4 stack did not produce stackResult — investigate before continuing',
    engineResultKeys: Object.keys(engineResult || {}),
  }, null, 2))
  process.exit(1)
}

const baseline = stackResult.baseline
const after0   = stackResult.interventions[0]?.result
const mdelta   = stackResult.interventions[0]?.marginal_delta
const cdelta   = stackResult.interventions[0]?.cumulative_delta

const dump = {
  brief: 'Brief 72 PC discriminator (regression on re-created Bridgewater)',
  source: 'node scripts/_brief72_pc_discriminator.mjs',
  fixture: 'docs/audit/fixtures/bridgewater_post_recreate.json',
  project_id: PROJECT_ID,
  project_name: project.name,
  injected_intervention: occ4,
  stack_interventions_count: stackResult.interventions.length,

  ref_equality_baseline_eq_after0: baseline === after0,
  intervention_0_id:               stackResult.interventions[0]?.id ?? null,
  intervention_0_enabled:          stackResult.interventions[0]?.enabled ?? null,

  eui_baseline_kwh_per_m2:         baseline?.consumption?.total?.kwh_per_m2_yr ?? null,
  eui_after0_kwh_per_m2:           after0?.consumption?.total?.kwh_per_m2_yr ?? null,
  eui_marginal_delta_kwh_per_m2:   mdelta?.eui_kwh_per_m2?.delta ?? null,
  eui_cumulative_delta_kwh_per_m2: cdelta?.eui_kwh_per_m2?.delta ?? null,

  heat_demand_baseline_mwh:  baseline?.consumption?.space_heating?.demand_mwh ?? null,
  heat_demand_after0_mwh:    after0?.consumption?.space_heating?.demand_mwh ?? null,
  cool_demand_baseline_mwh:  baseline?.consumption?.space_cooling?.demand_mwh ?? null,
  cool_demand_after0_mwh:    after0?.consumption?.space_cooling?.demand_mwh ?? null,
  dhw_demand_baseline_mwh:   baseline?.consumption?.dhw?.demand_mwh ?? null,
  dhw_demand_after0_mwh:     after0?.consumption?.dhw?.demand_mwh ?? null,

  elec_total_baseline_mwh:   baseline?.consumption?.total?.electricity_mwh ?? null,
  elec_total_after0_mwh:     after0?.consumption?.total?.electricity_mwh ?? null,
  gas_total_baseline_mwh:    baseline?.consumption?.total?.gas_mwh ?? null,
  gas_total_after0_mwh:      after0?.consumption?.total?.gas_mwh ?? null,

  building_num_bedrooms:        baseBuilding?.num_bedrooms ?? null,
  building_people_per_room:     baseBuilding?.people_per_room ?? baseBuilding?.occupancy?.people_per_room ?? null,
  building_occupancy_density:   baseBuilding?.occupancy?.density?.value ?? null,
  building_occupancy_basis:     baseBuilding?.occupancy?.density?.basis ?? null,
  building_occupancy_rate:      baseBuilding?.occupancy?.occupancy_rate ?? baseBuilding?.occupancy_rate ?? null,

  expected_post_p3: {
    dhw_demand_baseline_mwh_min: 410,
    dhw_demand_baseline_mwh_max: 430,
    dhw_demand_after0_mwh_min:   550,
    dhw_demand_after0_mwh_max:   575,
    note: '138 num_bedrooms × density × occupancy_rate; density 3→4 ⇒ DHW × 4/3',
  },
}

console.log(JSON.stringify(dump, null, 2))
