/**
 * scripts/_check_28k_gate3_prep_gains.mjs
 *
 * Brief 28k Gate 3 — PREP STEP (not validation).
 * Runs the CURRENT _calculateState2 (still legacy free-running convention,
 * unchanged by Brief 28k so far) on Bridgewater and logs the internal-gain
 * numbers + effective hours, so Chris can align spreadsheet 07_Internal_Gains
 * to the engine's profile-driven numbers before Gate 3 implementation.
 *
 * Does NOT change engine code. Does NOT run Gate 3 logic yet.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json() }

const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const lib = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []
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
}

const bc = project.building_config
const cc = project.construction_choices
const gia = bc.length * bc.width * bc.num_floors

const epwPath = path.join(REPO_ROOT, 'data/weather/current', bc.weather_file)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const dl = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dl.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), direct_normal = new Float32Array(N)
const diffuse_horizontal = new Float32Array(N), wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dl[i].split(',')
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6]); direct_normal[i] = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15]); wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const epwLat = parseFloat(epwLines[0].split(',')[6])
const hourlySolar = computeHourlySolarByFacade(weatherData, epwLat, bc.orientation ?? 0)
const cb = { lower_c: project.comfort_band_lower_c ?? 21, upper_c: project.comfort_band_upper_c ?? 25 }

// Run CURRENT _calculateState2 (legacy convention; Brief 28k hasn't touched it yet)
const state2 = calculateInstant(
  bc, cc, {}, libraryData, weatherData, hourlySolar, null,
  { mode: 'envelope-gains', comfortBand: cb }
)

// Extract gain values from heat_balance
const internal = state2.heat_balance?.annual?.gains?.internal ?? {}
const people_kwh    = internal.people?.kwh    ?? 0
const lighting_kwh  = internal.lighting?.kwh  ?? 0
const equipment_kwh = internal.equipment?.kwh ?? 0
const total_internal_kwh = people_kwh + lighting_kwh + equipment_kwh

// Occupancy summary
const occ = state2.occupancy_summary ?? {}
const annual_occupant_hours = occ.annual_occupant_hours ?? 0
const average_occupants     = occ.average_occupants     ?? 0
const peak_occupants        = occ.peak_occupants        ?? 0

// Project-level gain inputs (peak LPD / EPD from gains config)
// Lighting: sum of magnitude across profiles, weighted by area_share
const lightingProfiles = bc.gains?.lighting?.profiles ?? []
const equipmentProfiles = bc.gains?.equipment?.profiles ?? []
const peak_LPD_w_m2 = lightingProfiles.reduce(
  (sum, p) => sum + (Number(p.magnitude?.value ?? 0) * Number(p.area_share ?? 1)), 0
)
// Equipment: baseload + active (peak). area_share weighted.
const peak_EPD_w_m2 = equipmentProfiles.reduce(
  (sum, p) => sum + ((Number(p.baseload?.value ?? 0) + Number(p.active?.value ?? 0)) * Number(p.area_share ?? 1)), 0
)
// Baseload-only EPD (always on portion)
const baseload_EPD_w_m2 = equipmentProfiles.reduce(
  (sum, p) => sum + (Number(p.baseload?.value ?? 0) * Number(p.area_share ?? 1)), 0
)

// Effective hours: annual kWh ÷ (peak density × GIA / 1000)
// peak density in W/m² × GIA in m² = total W at peak = peak kW × 1000
// So: hours = kWh × 1000 / (W/m² × m²) = kWh × 1000 / W = h
const effective_lighting_hours  = peak_LPD_w_m2 > 0
  ? (lighting_kwh * 1000) / (peak_LPD_w_m2 * gia) : 0
const effective_equipment_hours = peak_EPD_w_m2 > 0
  ? (equipment_kwh * 1000) / (peak_EPD_w_m2 * gia) : 0

// Occupancy-related: total possible occupant-hours at full density (134 rooms × 1.5/room = 201 ppl × 8760 hrs = 1,760,760)
const peak_people = (bc.num_bedrooms ?? 0) * (bc.people_per_room ?? 0) * (bc.occupancy_rate ?? 1)
const max_possible_occupant_hours = peak_people * 8760
const occupant_hour_fraction = max_possible_occupant_hours > 0
  ? annual_occupant_hours / max_possible_occupant_hours : 0
// Annual heat from people = sensible_w_per_person × annual_occupant_hours / 1000
const sensible_w_per_person = Number(bc.occupancy?.sensible_w_per_person ?? 75)
const expected_people_kwh = (sensible_w_per_person * annual_occupant_hours) / 1000

console.log()
console.log('=== Brief 28k Gate 3 — internal-gain alignment prep ===')
console.log()
console.log(`Project:  Bridgewater (${PROJECT_ID})`)
console.log(`Weather:  ${bc.weather_file}`)
console.log(`GIA:      ${gia.toFixed(0)} m²`)
console.log()
console.log('Engine internal gains (current State 2, legacy convention — unchanged by Brief 28k so far):')
console.log()
console.log(`  annual_internal_gain_people_kwh     :  ${people_kwh.toFixed(1).padStart(10)} kWh   ${(people_kwh/gia).toFixed(2).padStart(7)} kWh/m²`)
console.log(`  annual_internal_gain_lighting_kwh   :  ${lighting_kwh.toFixed(1).padStart(10)} kWh   ${(lighting_kwh/gia).toFixed(2).padStart(7)} kWh/m²`)
console.log(`  annual_internal_gain_equipment_kwh  :  ${equipment_kwh.toFixed(1).padStart(10)} kWh   ${(equipment_kwh/gia).toFixed(2).padStart(7)} kWh/m²`)
console.log(`  annual_internal_gain_total_kwh      :  ${total_internal_kwh.toFixed(1).padStart(10)} kWh   ${(total_internal_kwh/gia).toFixed(2).padStart(7)} kWh/m²`)
console.log()
console.log('Occupancy arithmetic:')
console.log(`  Peak occupants (134 rms × 1.5 × 1.0)             :  ${peak_people.toFixed(1).padStart(8)} people`)
console.log(`  Engine peak_occupants                            :  ${peak_occupants.toFixed(1).padStart(8)} people`)
console.log(`  Engine average_occupants                         :  ${average_occupants.toFixed(2).padStart(8)} people`)
console.log(`  Engine annual_occupant_hours (profile integral)  :  ${annual_occupant_hours.toString().padStart(8)} person-h`)
console.log(`  Max possible (peak × 8760)                       :  ${max_possible_occupant_hours.toFixed(0).padStart(8)} person-h`)
console.log(`  Occupant-hour fraction (occupancy schedule × wd/we/holiday × monthly)  :  ${(occupant_hour_fraction*100).toFixed(2)}%`)
console.log(`  Sensible heat per person                         :  ${sensible_w_per_person} W/person`)
console.log(`  Implied people gain = ${sensible_w_per_person} W × ${annual_occupant_hours} pers-h / 1000  :  ${expected_people_kwh.toFixed(0).padStart(8)} kWh  ${expected_people_kwh.toFixed(0) === people_kwh.toFixed(0) ? '✓ matches engine' : 'engine ' + people_kwh.toFixed(0)}`)
console.log()
console.log('Lighting effective hours:')
console.log(`  Peak LPD (area-share-weighted across profiles)   :  ${peak_LPD_w_m2.toFixed(2).padStart(8)} W/m²`)
console.log(`  Peak lighting power                              :  ${(peak_LPD_w_m2 * gia / 1000).toFixed(2).padStart(8)} kW`)
console.log(`  Engine annual lighting kWh                       :  ${lighting_kwh.toFixed(0).padStart(8)} kWh`)
console.log(`  Effective hours @ peak                           :  ${effective_lighting_hours.toFixed(0).padStart(8)} h/yr   (of 8760 = ${(effective_lighting_hours/8760*100).toFixed(1)}%)`)
console.log(`  Note: includes daylight_factor reduction (0.16 for Bridgewater) baked into engine integration`)
console.log()
console.log('Equipment effective hours:')
console.log(`  Peak EPD (baseload + active, area-share-weighted) :  ${peak_EPD_w_m2.toFixed(2).padStart(8)} W/m²`)
console.log(`  Baseload-only EPD                                 :  ${baseload_EPD_w_m2.toFixed(2).padStart(8)} W/m²`)
console.log(`  Peak equipment power                              :  ${(peak_EPD_w_m2 * gia / 1000).toFixed(2).padStart(8)} kW`)
console.log(`  Engine annual equipment kWh                       :  ${equipment_kwh.toFixed(0).padStart(8)} kWh`)
console.log(`  Effective hours @ peak                            :  ${effective_equipment_hours.toFixed(0).padStart(8)} h/yr   (of 8760 = ${(effective_equipment_hours/8760*100).toFixed(1)}%)`)
console.log(`  Note: baseload is always-on (24/7), active scales by schedule + occupancy relationship + monthly multipliers`)
console.log()
console.log('Spreadsheet alignment values (use these in 07_Internal_Gains as direct kWh inputs):')
console.log(`  people     :  ${people_kwh.toFixed(0)} kWh`)
console.log(`  lighting   :  ${lighting_kwh.toFixed(0)} kWh`)
console.log(`  equipment  :  ${equipment_kwh.toFixed(0)} kWh`)
console.log(`  TOTAL      :  ${total_internal_kwh.toFixed(0)} kWh   (${(total_internal_kwh/gia).toFixed(2)} kWh/m²)`)
console.log()
console.log('Engine code unchanged. _calculateState2 still on legacy free-running convention.')
console.log('Ready for Gate 3 implementation once Chris confirms spreadsheet aligned to these values.')
