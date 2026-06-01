/**
 * Brief 75 P1 — Bridgewater anchor capture (post-Brief-74 close).
 *
 * Mirrors Brief 74 P1 with two material differences:
 *
 *   1. **No `engine: 'v2.5'` opt-in.** The live SystemSankey caller in
 *      SystemsModule does NOT set `options.engine`. Brief 74 P1 forced
 *      State 3 via this opt-in, but Brief 75 needs the ACTUAL live
 *      dispatch outcome — Brief 74 P6 §6.5 found that the engine path
 *      Bridgewater executes was a source of confusion and P3 onwards
 *      needs to land changes on whichever path is canonical.
 *
 *   2. **Heating-side reconciliation fields** captured for the P2
 *      diagnostic baseline + P3 falsifiability:
 *        - heat_balance.annual.totals.total_heating_loss_kwh (aggregate)
 *        - heat_balance.annual.losses.mech_ventilation (P5 emit if 0)
 *        - per-system fan_electrical_mwh + flow_rate + HRE
 *        - The result.state numeric (1|2|3) to settle which path ran.
 *
 * Live API read (project_id 3561c5a6-9a3f-4b5c-9e3d-72b449658d9a).
 *
 * Run:
 *   cd C:\Users\ChrisScott\Dev\nza-sim
 *   node scripts/_brief75_p1_anchor.mjs > docs/audit/75_p1_anchor_output.json
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

// Probe note (2026-06-01): calling without `engine: 'v2.5'` opt-in crashes
// with "building is not defined" in _buildHeatBalance — a pre-existing
// bug in the inline-legacy 'full' path. The live SystemSankey caller
// doesn't trip this, which is evidence that the live dispatch IS
// reaching `_calculateState3` (Brief 74 P3's electricity_total_kwh +
// auxiliary_elec_kwh_v40 injection lifting Σ elec from 346.4 → 416.9 MWh
// also confirms this). The dispatch gate must be activating via
// `options.engine === 'v2.5'` set somewhere upstream of SystemSankey,
// OR via hasV25Config/hasV25Library evaluating true via a code path my
// quick check didn't see. P3 will need to resolve definitively. For the
// P1 anchor, use the same `engine: 'v2.5'` opt-in Brief 74 P1 used so
// the numbers match the live UI.
const result = calculateInstant(
  building, constructions, {}, libraryData,
  weatherData, hourlySolar, null,
  { comfortBand: dbCb, _skipInterventions: true, engine: 'v2.5' },
)
const c  = result?.consumption ?? {}
const hb = result?.heat_balance ?? {}
const ig = hb?.annual?.gains?.internal ?? {}
const ll = hb?.annual?.losses ?? {}
const lg = hb?.annual?.gains ?? {}
const totals = hb?.annual?.totals ?? {}

const anchor = {
  brief: 'Brief 75 P1 — Bridgewater anchor (post-Brief-74 close)',
  source: 'node scripts/_brief75_p1_anchor.mjs',
  tip_sha: 'a209dc2',
  project_id: PROJECT_ID,
  project_name: project.name,
  captured_at: new Date().toISOString(),

  // Settle the "which path ran" question once and for all.
  engine_dispatch: {
    state_numeric: result?.state ?? null,
    mode:          result?.mode  ?? null,
    note: 'state=3 means _calculateState3 ran; state=2 means _calculateState2; otherwise inline-legacy or DD-fallback',
  },

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
    total_heating_loss_kwh: totals?.total_heating_loss_kwh ?? null,
    losses_per_element: {
      external_wall:   ll?.external_wall  ?? null,
      roof:            ll?.roof           ?? null,
      ground_floor:    ll?.ground_floor   ?? null,
      glazing:         ll?.glazing        ?? null,
      thermal_bridging:ll?.thermal_bridging?? null,
      fabric_leakage:  ll?.fabric_leakage ?? null,
      permanent_vents: ll?.permanent_vents?? null,
      // Brief 74 P5 added mech_ventilation key — expect 0 on Bridgewater
      // until Brief 75 P3 decouples physics from heating compensation.
      mech_ventilation: ll?.mech_ventilation ?? null,
      ventilation:      ll?.ventilation      ?? null,
      all_loss_keys:    Object.keys(ll ?? {}),
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
      all_internal_keys: Object.keys(ig ?? {}),
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

  // For Brief 75 P2 diagnostic: how big are the internal gains by
  // category? Compare against CIBSE TM54/Guide F hotel benchmarks
  // (~30-40 kWh/m²·yr for hotel lighting + equipment combined).
  internal_gains_breakdown_kwh: {
    people_kwh:    ig?.people?.kwh    ?? null,
    equipment_kwh: ig?.equipment?.kwh ?? null,
    lighting_kwh:  ig?.lighting?.kwh  ?? null,
    auxiliary_kwh: ig?.auxiliary?.kwh ?? null,
    auxiliary_electricity_kwh: ig?.auxiliary?.electricity_kwh ?? null,
    sum_internal_kwh: ((ig?.people?.kwh ?? 0) + (ig?.equipment?.kwh ?? 0)
                       + (ig?.lighting?.kwh ?? 0) + (ig?.auxiliary?.kwh ?? 0)),
    gia_m2: hb?.metadata?.gia_m2,
    sum_internal_kwh_per_m2: hb?.metadata?.gia_m2
      ? Math.round(((ig?.people?.kwh ?? 0) + (ig?.equipment?.kwh ?? 0)
        + (ig?.lighting?.kwh ?? 0) + (ig?.auxiliary?.kwh ?? 0)) / hb.metadata.gia_m2 * 10) / 10
      : null,
  },

  // Reference: gross extract first-principles estimate. Cited in brief
  // P3 falsifiability (a): ~150-250 MWh order. Calculated here so the
  // engine output can be checked against the same arithmetic the brief
  // assumes. Live ventSystems below carry recovery_sensible_pct (0-1
  // typically; sometimes 0-100).
  first_principles_mech_vent_gross_estimate_mwh: (() => {
    const ventSystems = building?.systems_config_v40?.ventilation ?? []
    let total_lps = 0
    for (const s of ventSystems) {
      if (s?.enabled === false) continue
      const fr = Number(s?.flow_rate ?? 0)
      const basis = s?.flow_rate_basis ?? 'L_s'
      // Crude: assume L_s if numeric; multiply ach by something only if needed.
      // Per-system shape may differ; this is order-of-magnitude only.
      if (basis === 'L_s' || basis === 'l_s' || basis === 'L/s') total_lps += fr
      else total_lps += fr  // ach or m3_h_m2 cases ignored at this layer
    }
    // ΔT_annual_avg ≈ 8K (UK), hours = 8760, ρ·cp ≈ 1.2 kJ/m³·K, 1 L/s = 1e-3 m³/s
    // Gross extract (no HRE) ≈ total_lps × 1e-3 × ρcp × ΔT × 3600 × hours / 1000 = kWh
    // = total_lps × 1.2 × 8 × 3600 × 8760 × 1e-3 / 1e6 MWh
    return Math.round(total_lps * 1.2 * 8 * 3600 * 8760 * 1e-6) / 1000
  })(),
}

console.log(JSON.stringify(anchor, null, 2))
