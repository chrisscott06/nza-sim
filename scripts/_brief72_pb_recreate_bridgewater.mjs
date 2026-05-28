/**
 * scripts/_brief72_pb_recreate_bridgewater.mjs — Brief 72 PB
 *
 * Re-creates "HIX Bridgewater" in the live DB after the 2026-05-28 22:34
 * DB-loss incident wiped the project state. Hits the anchor numbers in
 * docs/audit/72_auxiliary_loads_dhw_shape.md §1 within ~1-5% (brief PB
 * tolerance).
 *
 * Strategy: create via POST /api/projects, then PUT building merge with
 * the full canonical config (occupancy density 3 per_room, num_bedrooms
 * 138, geometry to hit GIA ~4125 m², 21/24 °C comfort, hotel schedules,
 * v40 systems matching the screenshots). Then PUT systems for v40 lighting
 * + small_power thin entries. Then PUT top-level comfort_band cols.
 *
 * Idempotent: deletes any existing project named "HIX Bridgewater" first.
 *
 * Usage:
 *   cd C:\Users\ChrisScott\Dev\nza-sim
 *   node scripts/_brief72_pb_recreate_bridgewater.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'
import { findPreset } from '../frontend/src/data/schedulePresets.js'

const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fj(url, opts = {}) {
  const r = await fetch(url, opts)
  if (!r.ok) throw new Error(`${url} → ${r.status}: ${await r.text()}`)
  return r.json()
}
const j = (body) => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const post = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

// ── Schedules from canonical hotel presets ─────────────────────────────────
const _occ = findPreset('occupancy',  'hotel_bedroom_overnight')
const _lit = findPreset('lighting',   'hotel_bedroom_lighting')
const _eqp = findPreset('equipment',  'hotel_bedroom_equipment')

// ── Bridgewater building_config ──────────────────────────────────────────
// Anchor reference: docs/audit/72_auxiliary_loads_dhw_shape.md §1.
// Geometry: 58.8 × 14.7 × 5 floors = 4321.8 m² geometry GIA, reported 4125.
const BRIDGEWATER_BUILDING = {
  name:         'HIX Bridgewater',
  length:       58.8,
  width:        14.7,
  num_floors:   5,
  floor_height: 3.2,
  orientation:  0.0,
  wwr: { north: 0.20, south: 0.20, east: 0.20, west: 0.20 },
  shading_overhang: {
    north: { depth_m: 0, offset_m: 0 },
    south: { depth_m: 0, offset_m: 0 },
    east:  { depth_m: 0, offset_m: 0 },
    west:  { depth_m: 0, offset_m: 0 },
  },
  shading_fin: {
    north: { left_depth_m: 0, right_depth_m: 0 },
    south: { left_depth_m: 0, right_depth_m: 0 },
    east:  { left_depth_m: 0, right_depth_m: 0 },
    west:  { left_depth_m: 0, right_depth_m: 0 },
  },
  // Brief 72 canonical headcount: 138 rooms × density 3 (per_room) × occ_rate 1.0
  num_bedrooms:    138,
  occupancy_rate:  1.0,
  // Phantom field — retired by Brief 72 P3 next commit. Set to 1.5 so re-created
  // Bridgewater reproduces the pre-P3 DHW phantom-decoupling for the PC
  // discriminator regression. After P3 lands and removes the field, the
  // engine will read density × num_bedrooms instead.
  people_per_room: 1.5,
  reported_gia:    4125,
  weather_file:    'GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw',
  location: {
    latitude:  51.087,
    longitude: -2.985,
    name:      'Bridgwater, Somerset',
  },
  control_strategy: 'active_setpoint',
  thermal_mass_mode:     'auto',
  thermal_mass_category: 'medium',
  infiltration_ach: 0.5,
  // Openings — minimal envelope (no permanent vents, no operable openings)
  openings: {
    site_exposure: 'normal',
    flow_mode:     'single_sided',
    cd:            0.25,
    schedule:      'never',
    north: { louvre_area_m2: 0, openable_fraction: 0, cd: null, flow_mode: null },
    south: { louvre_area_m2: 0, openable_fraction: 0, cd: null, flow_mode: null },
    east:  { louvre_area_m2: 0, openable_fraction: 0, cd: null, flow_mode: null },
    west:  { louvre_area_m2: 0, openable_fraction: 0, cd: null, flow_mode: null },
  },
  operable_openings: [],
  // Fabric: thermal bridging via H_TB direct = 120.82 W/K (Brief 28-TB-Simple manual).
  fabric: {},
  thermal_bridges: {
    mode:                 'simple_direct',
    total_H_TB_W_per_K:   120.82,
    junctions:            [],
    derived_alpha_pct:    null,
    multiplier:           1.0,
  },
  // Occupancy block (v2.3+)
  occupancy: {
    occupancy_rate: 1.0,
    density:        { value: 3, basis: 'per_room' },
    sensible_w_per_person: 75,
    latent_w_per_person:   55,
    schedule: {
      weekday:             [..._occ.schedule.weekday],
      saturday:            [..._occ.schedule.saturday],
      sunday:              [..._occ.schedule.sunday],
      monthly_multipliers: [..._occ.schedule.monthly_multipliers],
      exceptions:          [],
    },
    _provenance: { source: 'seeded_default', confidence: 'medium' },
  },
  // Gains block (v2.4)
  gains: {
    lighting: {
      profiles: [
        {
          id: 'default_lighting',
          label: 'Lighting',
          magnitude: { value: 8, unit: 'w_per_m2' },
          relationship_to_occupancy: 'proportional_with_spill',
          spill_minutes:   15,
          daylight_factor: 0.6,
          area_share: 1.0,
          schedule: {
            weekday:             [..._lit.schedule.weekday],
            saturday:            [..._lit.schedule.saturday],
            sunday:              [..._lit.schedule.sunday],
            monthly_multipliers: [..._lit.schedule.monthly_multipliers],
            exceptions:          [],
          },
        },
      ],
    },
    equipment: {
      profiles: [
        {
          id: 'default_equipment',
          label: 'Equipment',
          baseload: { value: 3, unit: 'w_per_m2' },
          active:   { value: 7, unit: 'w_per_m2' },
          relationship_to_occupancy: 'proportional',
          standby_factor: 0.10,
          area_share: 1.0,
          schedule: {
            weekday:             [..._eqp.schedule.weekday],
            saturday:            [..._eqp.schedule.saturday],
            sunday:              [..._eqp.schedule.sunday],
            monthly_multipliers: [..._eqp.schedule.monthly_multipliers],
            exceptions:          [],
          },
        },
      ],
    },
  },
  // ── Systems config v40 (Brief 40+ shape) ──
  // Brief 72 anchor: Heating 2 systems (90% VRF SCOP 2.8 + 10% panel COP 1),
  // Cooling 1 VRF EER 3.5, DHW 2 systems (ASHP 23% SCOP 2.5 + gas 77% η 0.90),
  // Vent 3 systems hitting 42 MWh total, Lighting 1 thin, Small Power 1 thin.
  systems_config_v40: {
    heating_setpoint_mode: 'follow_comfort',
    heating_setpoint_c:    null,
    cooling_setpoint_mode: 'follow_comfort',
    cooling_setpoint_c:    null,
    dhw_storage_setpoint_c:  60,
    dhw_tap_outlet_temp_c:   40,
    dhw_cold_supply_temp_c:  10,
    dhw_demand_basis:        'per_person',
    dhw_demand_litres_per_person_per_day: 80,
    dhw_demand_litres_per_m2_per_day:     1.1,
    dhw_load_shape:          'flat',
    heating: [
      {
        id: 'sys_heat_vrf', label: 'VRF heat recovery dual function',
        service: 'heating', source: 'electricity',
        library_id: 'vrf_heat_recovery_dual_function',
        efficiency_metric: 2.8,   // SCOP — engine reads as Number
        share_pct: 90, control_mechanism: 'thermostat', control_schedule_id: null,
        capacity_kw: null, notes: '', enabled: true,
      },
      {
        id: 'sys_heat_panel', label: 'Electric panel heater',
        service: 'heating', source: 'electricity',
        library_id: 'electric_panel_heater',
        efficiency_metric: 1.0,   // COP
        share_pct: 10, control_mechanism: 'thermostat', control_schedule_id: null,
        capacity_kw: null, notes: '', enabled: true,
      },
    ],
    cooling: [
      {
        id: 'sys_cool_vrf', label: 'VRF heat recovery dual function',
        service: 'cooling', source: 'electricity',
        library_id: 'vrf_heat_recovery_dual_function',
        efficiency_metric: 3.5,   // SEER
        share_pct: 100, control_mechanism: 'thermostat', control_schedule_id: null,
        capacity_kw: null, notes: '', enabled: true,
      },
    ],
    dhw: [
      {
        id: 'sys_dhw_ashp', label: 'DHW heat pump (ashp_dhw_preheat)',
        service: 'dhw', source: 'electricity',
        library_id: 'ashp_dhw_preheat',
        efficiency_metric: 2.5,   // SCOP
        share_pct: 23, control_mechanism: 'always_on', control_schedule_id: null,
        capacity_kw: null, notes: '', enabled: true,
      },
      {
        id: 'sys_dhw_gas', label: 'DHW gas (gas_boiler_calorifier)',
        service: 'dhw', source: 'gas',
        library_id: 'gas_boiler_calorifier',
        efficiency_metric: 0.90,  // combustion η
        share_pct: 77, control_mechanism: 'always_on', control_schedule_id: null,
        capacity_kw: null, notes: '', enabled: true,
      },
    ],
    ventilation: [
      {
        id: 'vent_mvhr_gf_public', label: 'mvhr_gf_public',
        service: 'ventilation', source: 'electricity',
        library_id: 'mvhr_standard',
        // Vent efficiency_metric IS an object — see systemsEngine.js L664
        efficiency_metric: { sfp_w_per_lps: 1.8, recovery_sensible_pct: 75 },
        flow_rate: 1435, flow_rate_basis: 'constant',
        share_pct: 100, control_mechanism: 'always_on', control_schedule_id: null,
        summer_bypass: true,
        capacity_kw: null, notes: '', enabled: true,
      },
      {
        id: 'vent_bedroom_extract', label: 'bedroom_extract',
        service: 'ventilation', source: 'electricity',
        library_id: 'mev_standard',
        efficiency_metric: { sfp_w_per_lps: 0.8, recovery_sensible_pct: 0 },
        flow_rate: 2280, flow_rate_basis: 'constant',
        share_pct: 100, control_mechanism: 'always_on', control_schedule_id: null,
        summer_bypass: false,
        capacity_kw: null, notes: '', enabled: true,
      },
      {
        id: 'vent_public_toilet_extract', label: 'public_toilet_extract',
        service: 'ventilation', source: 'electricity',
        library_id: 'mev_standard',
        efficiency_metric: { sfp_w_per_lps: 0.8, recovery_sensible_pct: 0 },
        flow_rate: 479, flow_rate_basis: 'constant',
        share_pct: 100, control_mechanism: 'always_on', control_schedule_id: null,
        summer_bypass: false,
        capacity_kw: null, notes: '', enabled: true,
      },
    ],
    lighting: [{
      id: 'default_lighting', label: 'Lighting (baseline)',
      service: 'lighting', source: 'electricity',
      efficiency_metric: null, setpoint: null,
      control_mechanism: 'constant', control_schedule_id: null,
      control_factor: 1.0, share_pct: 100,
      capacity_kw: null, notes: '', enabled: true,
    }],
    small_power: [{
      id: 'default_small_power', label: 'Small power (baseline)',
      service: 'small_power', source: 'electricity',
      efficiency_metric: null, setpoint: null,
      control_mechanism: 'constant', control_schedule_id: null,
      control_factor: 1.0, share_pct: 100,
      capacity_kw: null, notes: '', enabled: true,
    }],
  },
}

// ── Step 0: delete any existing project named 'HIX Bridgewater' (idempotent) ──
const existing = await fj(`${API}/api/projects`)
for (const p of existing) {
  if (p.name === 'HIX Bridgewater') {
    console.log(`[recreate] deleting stale "HIX Bridgewater" id=${p.id}`)
    const r = await fetch(`${API}/api/projects/${p.id}`, { method: 'DELETE' })
    if (!r.ok) console.warn(`[recreate] WARN delete ${p.id} returned ${r.status}`)
  }
}

// ── Step 1: create the project shell ────────────────────────────────────────
console.log('[recreate] POST /api/projects { name: "HIX Bridgewater" }')
const created = await fj(`${API}/api/projects`, post({ name: 'HIX Bridgewater' }))
const PID = created.id
console.log(`[recreate] created id=${PID}`)

// ── Step 2: PUT building (merge — sets occupancy, gains, systems_config_v40) ──
console.log(`[recreate] PUT /api/projects/${PID}/building`)
await fj(`${API}/api/projects/${PID}/building`, j(BRIDGEWATER_BUILDING))

// ── Step 3: PUT systems (top-level systems_config — separate from v40) ──
//   The legacy systems_config slot stays minimal (engine reads v40 first).
console.log(`[recreate] PUT /api/projects/${PID}/systems`)
await fj(`${API}/api/projects/${PID}/systems`, j({
  mode:                    'ideal',
  hvac_type:               'vrf_standard',
  ventilation_type:        'mvhr_standard',
  dhw_primary:             'gas_boiler_calorifier',
  dhw_preheat:             'ashp_dhw_preheat',
  dhw_setpoint:            60,
  dhw_preheat_setpoint:    45,
  lighting_power_density:  8.0,
  lighting_control:        'occupancy_sensor',
  pump_type:               'variable_speed',
}))

// ── Step 4: PUT top-level comfort_band cols ─────────────────────────────────
console.log(`[recreate] PUT /api/projects/${PID} (comfort_band cols)`)
await fj(`${API}/api/projects/${PID}`, j({
  comfort_band_lower_c: 21.0,
  comfort_band_upper_c: 24.0,
}))

// ── Step 5: run the engine to verify anchor gates ───────────────────────────
console.log('[recreate] running engine to verify anchor gates')
const project = await fj(`${API}/api/projects/${PID}`)
const lib     = await fj(`${API}/api/library/constructions`)
const libArr  = lib.constructions ?? []
const building      = project.building_config
const constructions = project.construction_choices
const systems       = {}

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
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
  library_systems:   building?.library_systems   ?? [],
  library_schedules: building?.library_schedules ?? [],
}
const dbCb = { lower_c: project.comfort_band_lower_c ?? 21, upper_c: project.comfort_band_upper_c ?? 24 }
const result = calculateInstant(
  building, constructions, systems, libraryData, weatherData, hourlySolar, null,
  { mode: 'full', comfortBand: dbCb, engine: 'v2.5', _skipInterventions: true },
)
const c = result?.consumption ?? {}
console.log('[recreate] consumption keys:', Object.keys(c))
if (c.brief40) console.log('[recreate] brief40 keys:', Object.keys(c.brief40))
if (c.brief40?.ventilation) console.log('[recreate] brief40.ventilation keys:', Object.keys(c.brief40.ventilation), 'systems count:', c.brief40.ventilation.systems?.length)
if (c.ventilation) console.log('[recreate] consumption.ventilation:', Array.isArray(c.ventilation) ? c.ventilation.length + ' items' : typeof c.ventilation)
const total_mwh = (c?.total?.electricity_mwh ?? 0) + (c?.total?.gas_mwh ?? 0)

const achieved = {
  project_id: PID,
  eui_kwh_per_m2:     c?.total?.kwh_per_m2_yr,
  total_mwh,
  electricity_mwh:    c?.total?.electricity_mwh,
  gas_mwh:            c?.total?.gas_mwh,
  carbon_kg_co2_per_m2: result?.carbon_kg_co2_per_m2 ?? result?.carbon?.today?.kgCO2_per_m2_yr,
  heat_demand_mwh:    c?.space_heating?.demand_mwh,
  cool_demand_mwh:    c?.space_cooling?.demand_mwh,
  dhw_demand_mwh:     c?.dhw?.demand_mwh,
  vent_fan_total_mwh: (() => {
    // brief40 ventilation block (Brief 40 v40 path) is the canonical source.
    const vsys = c?.brief40?.ventilation?.systems ?? c?.ventilation
    if (Array.isArray(vsys)) {
      return vsys.reduce((s, v) => s + ((v?.fan_electrical_kwh ?? v?.fan_electricity_mwh*1000 ?? v?.fan_kwh ?? 0) / 1000), 0)
    }
    return c?.brief40?.ventilation?.total_fan_electrical_mwh ?? 0
  })(),
  lighting_delivered_mwh:    c?.lighting?.delivered_mwh    ?? c?.lighting?.electricity_mwh,
  small_power_delivered_mwh: c?.small_power?.delivered_mwh ?? c?.small_power?.electricity_mwh,
  gia_m2: result?.metadata?.gia_m2,
}

// Anchor target table from audit §1
const anchor = {
  eui_kwh_per_m2:     130.0,
  total_mwh:          536.4,
  electricity_mwh:    356.3,
  gas_mwh:            180.1,
  carbon_kg_co2_per_m2: 24.4,
  heat_demand_mwh:    55.9,
  cool_demand_mwh:    87.6,
  dhw_demand_mwh:     210.5,
  vent_fan_total_mwh: 42.0,
  lighting_delivered_mwh:    128.6,
  small_power_delivered_mwh: 116.7,
  gia_m2:             4125,
}

const tolerance_pct = 0.05  // 5%, brief PB tolerance band
const report = {}
for (const k of Object.keys(anchor)) {
  const got    = achieved[k]
  const target = anchor[k]
  if (got == null) { report[k] = { target, achieved: null, status: 'NULL' }; continue }
  const dev = Math.abs(got - target) / Math.max(Math.abs(target), 1e-6)
  report[k] = {
    target,
    achieved: Math.round(got * 100) / 100,
    deviation_pct: Math.round(dev * 10000) / 100,
    status: dev <= tolerance_pct ? 'PASS' : 'FAIL',
  }
}

console.log('---ANCHOR COMPARISON---')
console.log(JSON.stringify({ project_id: PID, achieved, anchor_targets: anchor, report }, null, 2))
