/**
 * load_fixture.mjs — Brief 81 NZA-Sim fixture loader (pure-Node, no live DB).
 *
 * Maps a Bridgewater-Box-shaped YAML fixture (validation/fixtures/*.yaml) onto
 * the inputs NZA-Sim's JS engine expects, and runs it. This is the NZA-Sim
 * half of the Brief 81 validation harness — the EnergyPlus half (P5–P7) reads
 * the SAME fixture so the two engines are compared at the output level.
 *
 * Divergence D4 (audit §1): we run the engine PURE-NODE from the fixture, the
 * way Briefs 74–77 anchor probes did — no writes to the live DB. The fixture is
 * the reproducible source of truth.
 *
 * YAML parsing: the project ships no Node YAML dependency, so we shell out to
 * the system Python (PyYAML 6.x, already required by the P6/P7 harness) for the
 * parse. One subprocess per load; this is a validation harness, not hot path.
 *
 * Exports:
 *   loadFixtureYaml(path)            → parsed fixture object
 *   buildEngineInputs(fixture, root) → { building, constructions, libraryData,
 *                                        comfortBand, weatherData, hourlySolar }
 *   runEngine(inputs)                → calculateInstant(...) result (State 3)
 *   loadAndRun(path, root)           → { fixture, inputs, result }
 *
 * Reused by: validation/nza_sim/run_box_anchor.mjs (P2) and the P8 extractor.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../../frontend/src/data/systemTemplatesLibrary.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(__dirname, '..', '..')

// ── YAML → object via PyYAML ────────────────────────────────────────────────
export function loadFixtureYaml(yamlPath) {
  const out = execFileSync(
    'python',
    ['-c', 'import sys,yaml,json; print(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf-8"))))', yamlPath],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
  )
  return JSON.parse(out)
}

// ── 24-hour rectangular schedule from an "HH:MM-HH:MM" window ────────────────
// Returns a 24-element array: 1.0 for hours in [startHour, endHour), else 0.0.
function rectSchedule24(windowStr) {
  const m = String(windowStr).match(/^(\d{1,2}):\d{2}-(\d{1,2}):\d{2}$/)
  if (!m) throw new Error(`bad schedule window: ${windowStr}`)
  const start = Number(m[1]), end = Number(m[2])
  const arr = new Array(24).fill(0)
  for (let h = 0; h < 24; h++) if (h >= start && h < end) arr[h] = 1.0
  return arr
}

function scheduleBlock(windowStr) {
  const day = rectSchedule24(windowStr)
  return {
    weekday: day.slice(),
    saturday: day.slice(),
    sunday: day.slice(),
    monthly_multipliers: new Array(12).fill(1.0),
    exceptions: [],
  }
}

// ── EPW → weatherData typed arrays (mirrors scripts/_brief75_p1_anchor.mjs) ──
function loadWeather(fixture, repoRoot) {
  const epwName = fixture?.weather?.epw_file
  const epwPath = path.join(repoRoot, 'data', 'weather', 'current', epwName)
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
  return {
    weatherData: { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour },
    latitude,
    N,
  }
}

// ── Fixture → engine inputs ─────────────────────────────────────────────────
export function buildEngineInputs(fixture, repoRoot = REPO_ROOT) {
  const g = fixture.geometry
  const env = fixture.envelope
  const ig = fixture.internal_gains
  const occWindow = ig.occupancy.schedule_occupied_hours

  // construction_choices → names resolved in libraryData below.
  const constructions = {
    external_wall: 'box_wall',
    roof: 'box_roof',
    ground_floor: 'box_floor',
    glazing: 'box_glazing',
  }

  const cw = env.constructions
  const libraryData = {
    constructions: [
      { name: 'box_wall',  u_value_W_per_m2K: cw.external_wall.u_value_W_per_m2K, y_factor: cw.external_wall.y_factor ?? 1.0, layers: cw.external_wall.layers ?? [] },
      { name: 'box_roof',  u_value_W_per_m2K: cw.roof.u_value_W_per_m2K,          y_factor: cw.roof.y_factor ?? 1.0,          layers: cw.roof.layers ?? [] },
      { name: 'box_floor', u_value_W_per_m2K: cw.ground_floor.u_value_W_per_m2K,  y_factor: cw.ground_floor.y_factor ?? 1.0,  layers: cw.ground_floor.layers ?? [] },
      { name: 'box_glazing', u_value_W_per_m2K: cw.glazing.u_value_W_per_m2K, g_value: cw.glazing.g_value, y_factor: 1.0, layers: [] },
    ],
    system_templates: SYSTEM_TEMPLATES_LIBRARY,
    library_systems: [],
    library_schedules: [],
  }

  const s = fixture.systems
  const v = (fixture.ventilation ?? [])[0] ?? {}

  const building = {
    name: fixture.meta?.title ?? 'Bridgewater-Box',
    // geometry
    length: g.length_m,
    width: g.width_m,
    num_floors: g.num_floors,
    floor_height: g.floor_height_m,
    orientation: g.orientation_deg ?? 0,
    wwr: { ...g.wwr },
    num_bedrooms: 0,                 // unused: occupancy density basis is 'total'
    reported_gia: g.gia_m2 ?? null,
    weather_file: fixture.weather?.epw_file ?? null,
    location: {
      latitude: fixture.weather?.latitude ?? null,
      longitude: fixture.weather?.longitude ?? null,
      name: fixture.weather?.location_name ?? null,
    },
    // envelope
    control_strategy: 'active_setpoint',
    thermal_mass_mode: 'auto',
    thermal_mass_category: 'medium',
    infiltration_ach: env.infiltration.ach_constant,   // q50 omitted → exactly this ACH
    thermal_bridges: {
      mode: env.thermal_bridging.mode,                 // 'manual_h_tb'
      h_tb_W_per_K: env.thermal_bridging.h_tb_W_per_K, // 2.0
    },
    openings: { site_exposure: 'normal', flow_mode: 'single_sided', cd: 0.25, schedule: 'never' },
    operable_openings: [],
    // occupancy
    occupancy: {
      occupancy_rate: ig.occupancy.occupancy_rate,
      density: { value: ig.occupancy.people, basis: 'total' },
      sensible_w_per_person: ig.occupancy.sensible_W_per_person,
      latent_w_per_person: ig.occupancy.latent_W_per_person,
      schedule: scheduleBlock(occWindow),
    },
    // gains
    gains: {
      lighting: {
        profiles: [{
          id: 'box_lighting',
          label: 'Lighting',
          magnitude: { value: ig.lighting.w_per_m2, unit: 'w_per_m2' },
          relationship_to_occupancy: 'independent',
          gain_fraction: ig.lighting.gain_fraction ?? 1.0,
          area_share: 1.0,
          spill_minutes: 0,
          schedule: scheduleBlock(ig.lighting.schedule_on_hours),
        }],
      },
      equipment: {
        profiles: [{
          id: 'box_equipment',
          label: 'Equipment',
          baseload: { value: ig.equipment.baseload_w_per_m2, unit: 'w_per_m2' },
          active: { value: ig.equipment.active_w_per_m2, unit: 'w_per_m2' },
          relationship_to_occupancy: 'independent',
          gain_fraction: ig.equipment.gain_fraction ?? 1.0,
          area_share: 1.0,
          standby_factor: 0,
          schedule: scheduleBlock(ig.equipment.schedule_active_hours),
        }],
      },
      auxiliary: { profiles: [] },    // box: no auxiliary loads
    },
    // systems v40
    systems_config_v40: {
      heating_setpoint_mode: 'follow_comfort',
      heating_setpoint_c: null,
      cooling_setpoint_mode: 'follow_comfort',
      cooling_setpoint_c: null,
      dhw_storage_setpoint_c: ig.dhw.storage_setpoint_c,
      dhw_tap_outlet_temp_c: ig.dhw.tap_outlet_temp_c,
      dhw_cold_supply_temp_c: ig.dhw.cold_supply_temp_c,
      dhw_demand_basis: ig.dhw.basis,
      dhw_demand_litres_per_person_per_day: ig.dhw.litres_per_person_per_day,
      dhw_demand_litres_per_m2_per_day: 1.1,
      dhw_load_shape: ig.dhw.load_shape ?? 'flat',
      heating: [{
        id: 'box_heat_gas', label: 'Gas boiler', service: 'heating', source: s.heating.fuel,
        efficiency_metric: s.heating.efficiency, share_pct: 100,
        control_mechanism: 'thermostat', control_schedule_id: null, capacity_kw: null, enabled: true,
      }],
      cooling: [{
        id: 'box_cool_ac', label: 'Split AC', service: 'cooling', source: s.cooling.fuel,
        efficiency_metric: s.cooling.efficiency, share_pct: 100,
        control_mechanism: 'thermostat', control_schedule_id: null, capacity_kw: null, enabled: true,
      }],
      dhw: [{
        id: 'box_dhw_gas', label: 'Gas water heater', service: 'dhw', source: s.dhw.fuel,
        efficiency_metric: s.dhw.efficiency, share_pct: 100,
        control_mechanism: 'always_on', control_schedule_id: null, capacity_kw: null, enabled: true,
      }],
      ventilation: [{
        id: v.id ?? 'box_mvhr', label: 'MVHR', service: 'ventilation', source: v.fuel ?? 'electricity',
        library_id: 'mvhr_standard',
        efficiency_metric: { sfp_w_per_lps: v.sfp_w_per_lps, recovery_sensible_pct: v.hre_sensible_pct },
        flow_rate: v.flow_l_s, flow_rate_basis: v.flow_rate_basis ?? 'constant',
        control_mechanism: 'always_on', control_schedule_id: null,
        summer_bypass: v.summer_bypass === true, capacity_kw: null, enabled: true,
      }],
      lighting: [{
        id: 'box_lighting', label: 'Lighting (baseline)', service: 'lighting', source: 'electricity',
        efficiency_metric: null, setpoint: null, control_mechanism: 'constant',
        control_schedule_id: null, control_factor: 1, share_pct: 100, capacity_kw: null, enabled: true,
      }],
      small_power: [{
        id: 'box_small_power', label: 'Small power (baseline)', service: 'small_power', source: 'electricity',
        efficiency_metric: null, setpoint: null, control_mechanism: 'constant',
        control_schedule_id: null, control_factor: 1, share_pct: 100, capacity_kw: null, enabled: true,
      }],
    },
    library_systems: [],
    schema_version: 3,
  }

  const comfortBand = {
    lower_c: fixture.comfort_band.lower_c,
    upper_c: fixture.comfort_band.upper_c,
  }

  const { weatherData, latitude } = loadWeather(fixture, repoRoot)
  const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, building.orientation ?? 0)

  return { building, constructions, libraryData, comfortBand, weatherData, hourlySolar }
}

// ── Run the engine on built inputs (forces State 3 / v2.5, no interventions) ─
export function runEngine(inputs) {
  return calculateInstant(
    inputs.building, inputs.constructions, {}, inputs.libraryData,
    inputs.weatherData, inputs.hourlySolar, null,
    { comfortBand: inputs.comfortBand, _skipInterventions: true, engine: 'v2.5' },
  )
}

export function loadAndRun(yamlPath, repoRoot = REPO_ROOT) {
  const fixture = loadFixtureYaml(yamlPath)
  const inputs = buildEngineInputs(fixture, repoRoot)
  const result = runEngine(inputs)
  return { fixture, inputs, result }
}
