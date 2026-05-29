/**
 * Brief 73 P1 — Bridgewater anchor capture (post-Brief-72 close).
 *
 * Fetches LIVE Bridgewater from the API (not the cached PC fixture
 * because Chris may have authored auxiliary profiles + other edits in
 * the manual walkthrough between Brief 72 close and Brief 73 land that
 * the post-recreate fixture doesn't carry).
 *
 * Runs calculateInstant with no intervention stack (clean baseline) and
 * dumps the full anchor table the brief expects:
 *
 *   EUI, Σ electricity, Σ gas
 *   Heating / Cooling / DHW: demand + delivered + per-system rollups
 *   Ventilation: fan electricity total + per-system rollups
 *   Lighting / Small Power: delivered
 *   Auxiliary: gain + electricity (the new Brief 72 P5 fields)
 *   Carbon, building metadata
 *
 * Run:
 *   cd C:\Users\ChrisScott\Dev\nza-sim
 *   node scripts/_brief73_p1_anchor.mjs
 *
 * Output is JSON. Save verbatim to docs/audit/73_p1_anchor_output.json
 * and quote into docs/audit/73_ventilation_auxiliary_lighting.md §1.
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

async function fj(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const libResp = await fj(`${API}/api/library/constructions`)
const libArr  = libResp.constructions ?? []

const constructions = project.construction_choices
const systems       = {}
const building      = project.building_config
const dbCb          = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}

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
  library_systems:   building?.library_systems   ?? [],
  library_schedules: building?.library_schedules ?? [],
}

const result = calculateInstant(
  building,
  constructions, systems, libraryData,
  weatherData, hourlySolar, null,
  { mode: 'full', comfortBand: dbCb, engine: 'v2.5' },
)
const c = result?.consumption ?? {}
const ig = result?.heat_balance?.annual?.gains?.internal
        ?? result?.state2?.heat_balance?.annual?.gains?.internal ?? {}

function systemsList(svc) {
  const ssvc = c?.[svc] ?? {}
  return (ssvc.systems ?? []).map(s => ({
    id: s.id, label: s.label, enabled: s.enabled,
    share_pct: s.share_pct ?? null,
    source_energy_mwh: s.source_energy_mwh ?? null,
    delivered_thermal_mwh: s.delivered_thermal_mwh ?? null,
    source_fuel: s.source_fuel ?? null,
    // ventilation specifics
    fan_electrical_mwh: s.fan_electrical_mwh ?? null,
    flow_rate_lps: s.flow_rate_lps ?? null,
    sfp_w_per_lps: s.sfp_w_per_lps ?? null,
    // share-validation tells
    validation_error: s.validation_error ?? null,
  }))
}

const anchor = {
  brief: 'Brief 73 P1 — Bridgewater clean anchor (post-Brief-72 close)',
  source: 'node scripts/_brief73_p1_anchor.mjs',
  tip_sha: '3e21f3b',
  project_id: PROJECT_ID,
  project_name: project.name,
  captured_at: new Date().toISOString(),

  building: {
    num_bedrooms:        building?.num_bedrooms ?? null,
    occupancy_density:   building?.occupancy?.density ?? null,
    occupancy_rate:      building?.occupancy?.occupancy_rate ?? building?.occupancy_rate ?? null,
    geometry_gia_m2:     result?.geometry?.geometry_gia_m2
                       ?? result?.consumption?.geometry?.geometry_gia_m2
                       ?? (building?.length ?? 0) * (building?.width ?? 0) * (building?.num_floors ?? 0),
    reported_gia_m2:     building?.reported_gia ?? null,
    weather_file:        building?.weather_file ?? null,
    comfort_band_c:      dbCb,
  },

  totals: {
    eui_kwh_per_m2:      c?.total?.kwh_per_m2_yr ?? null,
    total_mwh:           c?.total?.kwh != null ? c.total.kwh / 1000 : null,
    electricity_mwh:     c?.total?.electricity_mwh ?? null,
    gas_mwh:             c?.total?.gas_mwh ?? null,
    carbon_kg_per_m2:    c?.total?.carbon_kg_per_m2 ?? c?.total?.kgCO2e_per_m2_yr ?? null,
    carbon_t_total:      c?.total?.carbon_kg != null ? c.total.carbon_kg / 1000 : null,
  },

  space_heating: {
    demand_mwh:          c?.space_heating?.demand_mwh ?? null,
    delivered_mwh:       c?.space_heating?.delivered_mwh ?? null,
    systems:             systemsList('space_heating'),
  },
  space_cooling: {
    demand_mwh:          c?.space_cooling?.demand_mwh ?? null,
    delivered_mwh:       c?.space_cooling?.delivered_mwh ?? null,
    systems:             systemsList('space_cooling'),
  },
  dhw: {
    demand_mwh:          c?.dhw?.demand_mwh ?? null,
    delivered_mwh:       c?.dhw?.delivered_mwh ?? null,
    systems:             systemsList('dhw'),
  },
  ventilation: {
    // headline — the brief expects this to be 0 (THE BUG)
    fan_total_mwh:       c?.ventilation?.total_fan_electrical_mwh
                       ?? c?.ventilation?.fan_electrical_mwh ?? null,
    systems:             systemsList('ventilation'),
  },
  lighting: {
    delivered_mwh:       c?.lighting?.total_delivered_electrical_mwh
                       ?? c?.lighting?.delivered_mwh ?? null,
    systems:             systemsList('lighting'),
  },
  small_power: {
    delivered_mwh:       c?.small_power?.total_delivered_electrical_mwh
                       ?? c?.small_power?.delivered_mwh ?? null,
    systems:             systemsList('small_power'),
  },

  internal_gains: {
    people:    ig?.people    ?? null,
    lighting:  ig?.lighting  ?? null,
    equipment: ig?.equipment ?? null,
    auxiliary: ig?.auxiliary ?? null,
    auxiliary_profile_count:
      Array.isArray(building?.gains?.auxiliary?.profiles)
        ? building.gains.auxiliary.profiles.length : 0,
    auxiliary_profile_labels:
      (building?.gains?.auxiliary?.profiles ?? []).map(p =>
        `${p.label}: ${p.magnitude?.value ?? '?'} ${p.magnitude?.unit ?? ''} × gain ${Math.round((p.gain_fraction ?? 1) * 100)}%`
      ),
  },

  expected_per_brief: {
    eui_kwh_per_m2:    163.5,
    electricity_mwh:   314.2,
    gas_mwh:           360.3,
    fan_total_mwh:     0,       // THE BUG
    lighting_mwh:      56.3,
    small_power_mwh:   172.1,
    dhw_mwh:           421.1,
    note: 'Brief notes "If your numbers diverge materially, log it and proceed". This run is the anchor; expected is for reference.',
  },
}

console.log(JSON.stringify(anchor, null, 2))
