/**
 * Brief 93 — Bridgewater consolidation anchor (adapted from _brief75_p1_anchor.mjs).
 *
 * UNTRACKED on purpose: the SAME script runs across all four branch checkouts so
 * ONLY the engine (frontend/src/utils/*) varies. Reads project 12cf7cc4
 * "Bridgewater Hotel" (the rebuilt/canonical baseline) live from the backend
 * (served READ-ONLY from chris/interventions-rework-ux per Brief 93 method note).
 *
 * Captures Design-Decision-4 metrics: EUI, elec, gas, heating, cooling, mech-vent,
 * + the 12-month heating-loss and gains SHAPE (the State-2 per-element monthly
 * arrays — the demand-shape `result.monthly` lives on the inline-legacy path the
 * v2.5 anchor doesn't hit, so the envelope monthly-loss shape is the proxy, which
 * is the more sensitive physics-regression detector). Pure engine run, no DB write.
 *
 * Run: node scripts/_brief93_anchor.mjs > /tmp/anchor_<branch>.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const API        = 'http://127.0.0.1:8002'
const PROJECT_ID = '12cf7cc4-9bdc-41bc-ab4e-24e044fbad9d'   // Bridgewater Hotel (canonical baseline)
const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT  = path.resolve(__dirname, '..')
const r1 = v => (v == null || !Number.isFinite(v)) ? null : Math.round(v * 10) / 10
const arr12 = a => Array.isArray(a) ? a.slice(0, 12).map(v => Math.round((v ?? 0))) : null

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} → ${r.status}`); return r.json() }

// ── Source selection (Brief 94) ──────────────────────────────────────────────
// Default: live backend/DB (`api:` — Chris's playground; fine for ad-hoc checks).
// `--fixture[=PATH]`: run the engine DIRECTLY against a committed frozen fixture,
// no API/DB. This is the REGRESSION reference (Brief 94: never use the mutable live
// DB as a regression baseline again). Fixture is YAML; node has no YAML parser and
// the repo has no node project, so we reuse the validation venv's pyyaml to parse.
const argv        = process.argv.slice(2)
const FIXTURE_ARG = argv.find(a => a === '--fixture' || a.startsWith('--fixture='))
const FIXTURE     = !!FIXTURE_ARG
const FIXTURE_PATH = (FIXTURE_ARG && FIXTURE_ARG.includes('='))
  ? path.resolve(REPO_ROOT, FIXTURE_ARG.split('=')[1])
  : path.join(REPO_ROOT, 'validation/fixtures/bridgewater_anchor_v2.yaml')

function loadYamlViaVenv(p) {
  const py = path.join(REPO_ROOT, 'validation/.venv/bin/python')
  if (!fs.existsSync(py)) throw new Error(`--fixture needs the validation venv (pyyaml) at ${py} — provision: python3 -m venv validation/.venv && validation/.venv/bin/pip install pyyaml`)
  const out = execFileSync(py, ['-c', 'import yaml,json,sys; json.dump(yaml.safe_load(open(sys.argv[1])), sys.stdout)', p], { encoding: 'utf-8', maxBuffer: 128 * 1024 * 1024 })
  return JSON.parse(out)
}

let building, constructions, dbCb, libArr, projectName, sourceLabel
if (FIXTURE) {
  const fx = loadYamlViaVenv(FIXTURE_PATH)
  building      = fx.building_config
  constructions = fx.construction_choices
  dbCb          = { lower_c: fx.comfort_band?.lower_c ?? 20, upper_c: fx.comfort_band?.upper_c ?? 26 }
  libArr        = fx.library_constructions ?? []
  projectName   = fx._meta?.source_project ?? 'Bridgewater (fixture)'
  sourceLabel   = `fixture:${path.relative(REPO_ROOT, FIXTURE_PATH)}`
} else {
  const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
  libArr        = (await fj(`${API}/api/library/constructions`)).constructions ?? []
  constructions = project.construction_choices
  building      = project.building_config
  dbCb          = { lower_c: project.comfort_band_lower_c ?? 20, upper_c: project.comfort_band_upper_c ?? 26 }
  projectName   = project.name
  sourceLabel   = `api:${PROJECT_ID}`
}

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
const libraryData = {
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

const result = calculateInstant(
  building, constructions, {}, libraryData, weatherData, hourlySolar, null,
  { comfortBand: dbCb, _skipInterventions: true, engine: 'v2.5' },
)

const c   = result?.consumption ?? {}
const hb  = result?.heat_balance ?? {}
const ll  = hb?.annual?.losses ?? {}
const ig  = hb?.annual?.gains?.internal ?? {}
const los = result?.losses_at_setpoint ?? hb?.losses_at_setpoint ?? {}

// 12-month heating-loss shape: Σ per-element monthly_heating_loss_kwh
const LOSS_ELEMENTS = ['external_wall', 'roof', 'ground_floor', 'glazing', 'fabric_leakage', 'permanent_vents', 'thermal_bridging']
const monthlyHeatingLoss = new Array(12).fill(0)
for (const el of LOSS_ELEMENTS) {
  const a = los?.[el]?.monthly_heating_loss_kwh
  if (Array.isArray(a)) for (let i = 0; i < 12; i++) monthlyHeatingLoss[i] += (a[i] ?? 0)
}
// 12-month gains shape (cooling drivers): internal gains + solar transmission
const igm = los?.internal_gains_monthly ?? {}
const monthlyGains = new Array(12).fill(0)
for (const k of ['people_kwh', 'lighting_kwh', 'equipment_kwh', 'auxiliary_kwh']) {
  const a = igm?.[k]; if (Array.isArray(a)) for (let i = 0; i < 12; i++) monthlyGains[i] += (a[i] ?? 0)
}
const solarM = los?.glazing?.monthly_solar_transmission_kwh
if (Array.isArray(solarM)) for (let i = 0; i < 12; i++) monthlyGains[i] += (solarM[i] ?? 0)

console.log(JSON.stringify({
  brief: 'Brief 93 consolidation anchor',
  project_id: PROJECT_ID,
  project_name: projectName,
  source: sourceLabel,
  git_head: process.env.GIT_HEAD ?? null,
  engine_dispatch: { state_numeric: result?.state ?? null, mode: result?.mode ?? null },
  gia_m2: hb?.metadata?.gia_m2 ?? null,

  // ── Design Decision 4 headline metrics ──
  headline: {
    eui_kwh_per_m2:      c?.total?.kwh_per_m2_yr ?? null,
    electricity_mwh:     c?.total?.electricity_mwh ?? null,
    gas_mwh:             c?.total?.gas_mwh ?? null,
    heating_demand_mwh:  c?.space_heating?.demand_mwh ?? null,
    heating_delivered_mwh: c?.space_heating?.delivered_mwh ?? null,
    cooling_demand_mwh:  c?.space_cooling?.demand_mwh ?? null,
    cooling_delivered_mwh: c?.space_cooling?.delivered_mwh ?? null,
    dhw_demand_mwh:      c?.dhw?.demand_mwh ?? null,
    mech_vent_fan_mwh:   c?.brief40?.ventilation?.total_fan_electrical_mwh ?? null,
    mech_vent_loss_kwh:  ll?.mech_ventilation ?? ll?.ventilation ?? null,
  },

  heat_balance_annual: {
    losses_kwh: hb?.annual?.totals?.losses_kwh ?? null,
    gains_kwh:  hb?.annual?.totals?.gains_kwh ?? null,
    losses_per_element: {
      external_wall: ll?.external_wall ?? null, roof: ll?.roof ?? null,
      ground_floor: ll?.ground_floor ?? null, glazing: ll?.glazing ?? null,
      thermal_bridging: ll?.thermal_bridging ?? null, fabric_leakage: ll?.fabric_leakage ?? null,
      permanent_vents: ll?.permanent_vents ?? null, mech_ventilation: ll?.mech_ventilation ?? null,
    },
    gains_internal: {
      people: ig?.people?.kwh ?? ig?.people ?? null, lighting: ig?.lighting?.kwh ?? ig?.lighting ?? null,
      equipment: ig?.equipment?.kwh ?? ig?.equipment ?? null, auxiliary: ig?.auxiliary?.kwh ?? ig?.auxiliary ?? null,
    },
  },

  // ── 12-month shape (method: State-2 per-element monthly arrays; see header) ──
  monthly_shape: {
    method: 'Σ per-element losses_at_setpoint.monthly_heating_loss_kwh (heating) + internal_gains_monthly + solar (gains). result.monthly demand-shape is inline-legacy only; v2.5 anchor uses envelope monthly loss as the proxy.',
    heating_loss_kwh_by_month: arr12(monthlyHeatingLoss),
    gains_kwh_by_month:        arr12(monthlyGains),
    monthly_loss_source_present: LOSS_ELEMENTS.some(el => Array.isArray(los?.[el]?.monthly_heating_loss_kwh)),
  },
}, null, 2))
