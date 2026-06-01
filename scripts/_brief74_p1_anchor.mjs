/**
 * Brief 74 P1 — Bridgewater anchor capture (post-Brief-73 close).
 *
 * Like Brief 73's P1 anchor but additionally captures:
 *   - Heat Balance Σ gains + Σ losses + Net residual (the "+16 MWh
 *     balanced" Brief 73 close was tracking — about to move when
 *     P5 adds the mech vent loss ribbon)
 *   - per-loss-element breakdown so we can detect double-counting in
 *     P5 (gates c + e)
 *   - Energy Flows-shape inputs (consumption.brief40.ventilation
 *     total_fan_electrical_mwh, lighting + small_power + auxiliary
 *     electricity rollups) for the v40 systems_flow port diagnostic
 *     in P2/P3
 *
 * Live API read (project_id 3561c5a6-9a3f-4b5c-9e3d-72b449658d9a).
 *
 * Run:
 *   cd C:\Users\ChrisScott\Dev\nza-sim
 *   node scripts/_brief74_p1_anchor.mjs
 *
 * Output JSON. Save verbatim to docs/audit/74_p1_anchor_output.json.
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
  building, constructions, {}, libraryData,
  weatherData, hourlySolar, null,
  { mode: 'full', comfortBand: dbCb, engine: 'v2.5' },
)
const c  = result?.consumption ?? {}
const hb = result?.heat_balance ?? {}
const ig = hb?.annual?.gains?.internal ?? {}
const ll = hb?.annual?.losses ?? {}
const lg = hb?.annual?.gains ?? {}
const totals = hb?.annual?.totals ?? {}

const anchor = {
  brief: 'Brief 74 P1 — Bridgewater anchor (post-Brief-73 close)',
  source: 'node scripts/_brief74_p1_anchor.mjs',
  tip_sha: 'b9a9bd6',
  project_id: PROJECT_ID,
  project_name: project.name,
  captured_at: new Date().toISOString(),

  building: {
    num_bedrooms:      building?.num_bedrooms ?? null,
    occupancy_density: building?.occupancy?.density ?? null,
    occupancy_rate:    building?.occupancy?.occupancy_rate ?? building?.occupancy_rate ?? null,
    geometry_gia_m2:   hb?.metadata?.gia_m2 ?? null,
    reported_gia_m2:   building?.reported_gia ?? null,
    weather_file:      building?.weather_file ?? null,
    comfort_band_c:    dbCb,
  },

  totals: {
    eui_kwh_per_m2:    c?.total?.kwh_per_m2_yr ?? null,
    electricity_mwh:   c?.total?.electricity_mwh ?? null,
    gas_mwh:           c?.total?.gas_mwh ?? null,
  },

  heat_balance_annual: {
    losses_kwh:        totals?.losses_kwh ?? null,
    gains_kwh:         totals?.gains_kwh ?? null,
    net_residual_kwh:  totals?.gains_kwh != null && totals?.losses_kwh != null
                       ? totals.gains_kwh - totals.losses_kwh
                       : null,
    losses_per_element: {
      external_wall:   ll?.external_wall  ?? null,
      roof:            ll?.roof           ?? null,
      ground_floor:    ll?.ground_floor   ?? null,
      glazing:         ll?.glazing        ?? null,
      thermal_bridging:ll?.thermal_bridging?? null,
      fabric_leakage:  ll?.fabric_leakage ?? null,
      permanent_vents: ll?.permanent_vents?? null,
      // The brief's headline finding: are any mech-vent loss fields
      // already on the loss block? Logged so P4 diagnostic knows what
      // to look for.
      ventilation:           ll?.ventilation           ?? null,
      mechanical_ventilation:ll?.mechanical_ventilation?? null,
      mech_vent:             ll?.mech_vent             ?? null,
      vent_loss:             ll?.vent_loss             ?? null,
      vent_exhaust:          ll?.vent_exhaust          ?? null,
      all_loss_keys:         Object.keys(ll ?? {}),
    },
    gains_per_element: {
      solar_south: lg?.solar?.south ?? null,
      solar_east:  lg?.solar?.east  ?? null,
      solar_west:  lg?.solar?.west  ?? null,
      solar_north: lg?.solar?.north ?? null,
      people:      ig?.people     ?? null,
      equipment:   ig?.equipment  ?? null,
      lighting:    ig?.lighting   ?? null,
      auxiliary:   ig?.auxiliary  ?? null,
    },
  },

  per_service: {
    heat_demand_mwh:       c?.space_heating?.demand_mwh ?? null,
    heat_delivered_mwh:    c?.space_heating?.delivered_mwh ?? null,
    cool_demand_mwh:       c?.space_cooling?.demand_mwh ?? null,
    cool_delivered_mwh:    c?.space_cooling?.delivered_mwh ?? null,
    dhw_demand_mwh:        c?.dhw?.demand_mwh ?? null,
    dhw_delivered_mwh:     c?.dhw?.delivered_mwh ?? null,
    vent_fan_total_mwh:    c?.brief40?.ventilation?.total_fan_electrical_mwh ?? null,
    vent_per_system: (c?.brief40?.ventilation?.systems ?? []).map(s => ({
      id: s.id, label: s.label,
      fan_electrical_mwh: s.fan_electrical_mwh,
      sfp_w_per_lps: s.sfp_w_per_lps,
      flow_rate: s.flow_rate, flow_rate_basis: s.flow_rate_basis,
      recovery_sensible_pct: s.recovery_sensible_pct,
      summer_bypass: s.summer_bypass,
    })),
  },

  // For P2 systems_flow port diagnostic — does the result have a
  // top-level systems_flow field on the State 3 path?
  systems_flow_status: {
    present_at_root:           result?.systems_flow != null,
    present_under_consumption: c?.systems_flow != null,
    keys_at_root:              Object.keys(result ?? {}),
    keys_under_consumption:    Object.keys(c ?? {}),
  },
}

console.log(JSON.stringify(anchor, null, 2))
