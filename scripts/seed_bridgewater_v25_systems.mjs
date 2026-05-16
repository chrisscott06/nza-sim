/**
 * scripts/seed_bridgewater_v25_systems.mjs
 *
 * Brief 28f Part 5.7 — seeds Bridgewater's v2.5 systems config into the
 * project's `building_config.systems_config_v25` field via the existing
 * PUT /api/projects/{id}/building endpoint (deep-merge accepts arbitrary
 * new keys per the backend code review 2026-05-15).
 *
 * Also applies the project-config corrections logged in
 * docs/validation/state3_part4_findings_2026_05_15.md:
 *   - num_floors:           4 → 5 (4 storeys above + ground in UK floor-counting)
 *   - num_bedrooms:         134 (unchanged; already correct)
 *   - length:               58.8 (unchanged)
 *   - width:                14.7 (unchanged)
 *   - MVHR flow:            1450 L/s (per Fabric & Systems Modelling Notes:
 *                            5 × Toshiba VN-M1000HE @ ~290 L/s commissioned)
 *
 * The v2.5 systems config it writes mirrors the BRIDGEWATER_FULL_SYSTEMS
 * test fixture from scripts/state3_part4_dhw_vent_lighting_carbon_test.mjs.
 *
 * After seeding, re-runs the engine via the live API path to capture
 * canonical post-correction State 3 outputs (which will differ from the
 * pre-correction numbers because the GIA goes 3,457 → 4,322 m² so envelope
 * grows + demand grows).
 *
 * Usage:
 *   node scripts/seed_bridgewater_v25_systems.mjs [project_id]
 *
 * Idempotent — running twice writes the same config, no side-effects.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const PROJECT_ID = process.argv[2] || '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fj(url, opts = {}) {
  const r = await fetch(url, opts)
  if (!r.ok) throw new Error(`${url} → ${r.status}: ${await r.text()}`)
  return r.json()
}

// ── Bridgewater v2.5 systems config (canonical) ─────────────────────────────
const BRIDGEWATER_V25 = {
  heating: {
    primary:     { library_id: 'vrf_heat_recovery_dual_function' },
    secondary:   { library_id: 'electric_panel_heater' },
    primary_pct: 95,
    setpoint_c:  21,
  },
  cooling: {
    primary:     { library_id: 'vrf_heat_recovery_dual_function' },
    secondary:   { library_id: 'dx_split_cooling' },
    primary_pct: 95,
    setpoint_c:  25,
  },
  dhw: {
    primary:           { library_id: 'ashp_dhw_preheat' },
    secondary:         { library_id: 'gas_boiler_calorifier' },
    primary_pct:       60,
    circulation_pump_w: 120,
    // V1 defaults for DHW formula -- explicit for clarity (omitting these
    // would yield identical engine output via default constants).
    litres_per_person_per_day: 80,
    store_temperature_c:       60,
    cold_mains_temperature_c:  10,
  },
  // Brief 28k Gate 3+ (2026-05-16): per-BRUKL/as-built schedule
  // (26002-NZA-XX-XX-SC-X-0010 v2), Bridgewater has THREE distinct mechanical
  // ventilation systems, not the previous two-entry "MVHR + WC_extract"
  // simplification. Each contributes its own heat loss line in the State 2
  // setpoint demand. See docs/sources/bridgewater_assumptions_schedule.md
  // for the OneDrive path to the canonical project record.
  //
  //   - mvhr_gf_public:        5 × Toshiba VN-M1000HE serving the GF public
  //                            areas (staff/comms/restaurant). HRE 0.80.
  //   - bedroom_extract:       Single roof fan EF R.01 serving all bedrooms
  //                            via trickle-vent inlet. EXTRACT-ONLY, no HR.
  //                            This was previously invisible to State 2 and
  //                            is the single biggest under-counted heat loss
  //                            mechanism (~230 MWh/yr at 2208 L/s).
  //   - public_toilet_extract: 210 L/s small extract for public WCs.
  ventilation: [
    { name: 'mvhr_gf_public',       library_id: 'mvhr_with_hr',     flow_l_s: 1425, sfp_w_per_l_s: 1.4, hre: 0.80, hours: 8760, schedule_ref: 'always_on' },
    { name: 'bedroom_extract',      library_id: 'wc_extract_no_hr', flow_l_s: 2208, sfp_w_per_l_s: 0.4, hre: 0.0,  hours: 8760, schedule_ref: 'always_on' },
    { name: 'public_toilet_extract',library_id: 'wc_extract_no_hr', flow_l_s:  210, sfp_w_per_l_s: 0.4, hre: 0.0,  hours: 8760, schedule_ref: 'always_on' },
  ],
}

// ── Bridgewater per-project construction overrides (Brief 28k Gate 3+) ─────
//
// BRUKL/as-built U-values from 26002-NZA-XX-XX-SC-X-0010 v2 (Fabric & Systems
// Assumptions Schedule). These are project-scoped overrides on top of the
// shared library entries — the library is NOT modified. The engine's
// pickWholeWallU + getGValue + getUValue helpers honour the override fields
// in precedence order: u_value_override → u_value_W_per_m2K → layer-computed.
//
//   wall   0.18 → 0.14 W/m²K  (BRUKL Criterion 2 area-weighted)
//   roof   0.16 → 0.15
//   floor  0.22 → 0.13        (biggest change — much better insulated than assumed)
//   glaz   1.40           ✓   (no U change; g-value override only)
//   glaz   g 0.42 → 0.50     (BRUKL area-weighted: bedroom G1 g=0.56,
//                             curtain wall G3 g=0.27)
const BRIDGEWATER_CONSTRUCTION_CHOICES = {
  external_wall: { library_id: 'cavity_wall_enhanced',  u_value_override: 0.14 },
  roof:          { library_id: 'pitched_roof_standard', u_value_override: 0.15 },
  ground_floor:  { library_id: 'ground_floor_slab',     u_value_override: 0.13 },
  glazing:       { library_id: 'double_low_e',          g_value_override: 0.50 },
}

// ── Bridgewater fabric-level inputs (Brief 28k Gate 3+) ────────────────────
//
// thermal_bridging_alpha_pct: BRUKL Technical Data Sheet shows total thermal
// bridging α = 200.31% of fabric transfer coefficient. Notional/Part L
// baseline is 18%. Bridgewater's α=200% indicates poor thermal-bridge
// detailing — junctions are ~2× the area-element fabric losses.
const BRIDGEWATER_FABRIC = {
  thermal_bridging_alpha_pct: 200,
}

// ── Bridgewater canonical geometry + counts ────────────────────────────────
//
// Seed-owned canonical values (Chris's directive 2026-05-15 after the
// length-drift episode): the seed explicitly owns all geometry + count
// fields it cares about, so re-runs restore canonical state regardless of
// drift from in-UI experimentation. Without this, "playing with the model"
// in the Building Definition module silently leaves diverged DB state that
// future re-seeds can't detect.
//
// Future architectural fix (queued behind the complete-loop work): a
// project-level `canonical_baseline_locked: true` flag that prevents the
// UI from auto-saving over these fields without explicit confirmation.
const BUILDING_CORRECTIONS = {
  length:       58.8,   // canonical (State 1 validation baseline + all docs since)
  width:        14.7,
  num_floors:   5,      // 4 above + ground; UK floor-counting
  num_bedrooms: 134,    // per consumption-analysis note (134 keys; supersedes fabric doc's 138 beds)
  // Brief 28k Gate 3+ (2026-05-16): BRUKL air permeability 4.64 m³/h·m² @ 50 Pa
  // → rule-of-thumb /20 ≈ 0.23 ac/h background infiltration.
  infiltration_ach: 0.23,
  // Brief 28k Gate 3+: fabric.thermal_bridging_alpha_pct = 200 (BRUKL Tech Data
  // Sheet shows α = 200.31% of fabric transfer coefficient).
  fabric: BRIDGEWATER_FABRIC,
  systems_config_v25: BRIDGEWATER_V25,
}

/**
 * Issue 2 fix (Chris testing 2026-05-15): Bridgewater's occupancy schedule
 * had a "Xmas" exception (Dec 24 – Jan 7 with all-zero weekday/saturday/
 * sunday) inherited from a generic hotel-bedroom load-type template. Under
 * Home Office continuous-occupancy operation (Dec 2022 onwards) the building
 * isn't actually closed Christmas to New Year, so that exception zeros out
 * 64,000+ person-hours unrealistically and shows as a sharp Jan 1-7 gap in
 * the Profiles view. Drop the exception. Idempotent — empty if already
 * cleared.
 *
 * If the project's actual operation ever does include a Christmas shutdown,
 * the exception can be re-added via the Internal Gains schedule editor.
 */
function clearOccupancyXmasException(currentOccupancy) {
  if (!currentOccupancy?.schedule?.exceptions) return currentOccupancy
  const filtered = currentOccupancy.schedule.exceptions.filter(e =>
    !(e?.name === 'Xmas' || e?.id?.includes('xmas') || /^24-12$/.test(e?.start_date ?? '')),
  )
  return {
    ...currentOccupancy,
    schedule: { ...currentOccupancy.schedule, exceptions: filtered },
  }
}

/**
 * Brief 28k Gate 3 prep (2026-05-16): Bridgewater's persisted occupancy
 * density was 2.0/room (peak booking capacity) while `people_per_room` was
 * 1.5 (standard hotel occupancy assumption — couple/single mix). The engine
 * uses `occupancy.density.value` for the State 2 people-gain integration,
 * resulting in a +33% over-count of people sensible gain.
 *
 * Per Chris's ruling: 1.5/room is canonical hotel intent. Force the seed
 * to set density to 1.5 so engine + people_per_room agree and future drift
 * is auto-corrected. (Note: Bridgewater's actual current operation is Home
 * Office single-occupier at 1.0/room — deferred as too-many-changes-at-once
 * for this brief.)
 */
function setOccupancyDensity(currentOccupancy, valuePerRoom = 1.5) {
  if (!currentOccupancy) return currentOccupancy
  return {
    ...currentOccupancy,
    density: {
      ...(currentOccupancy.density ?? {}),
      value: valuePerRoom,
      basis: 'per_room',
    },
  }
}

console.log()
console.log('=== Seed Bridgewater v2.5 systems config ===')
console.log()
console.log(`Project: ${PROJECT_ID}`)
console.log(`API:     ${API}`)
console.log()

// 1. Fetch current project for before/after comparison
const before = await fj(`${API}/api/projects/${PROJECT_ID}`)
console.log(`Before — num_floors=${before.building_config.num_floors}, num_bedrooms=${before.building_config.num_bedrooms}, length=${before.building_config.length}, width=${before.building_config.width}`)
console.log(`         systems_config_v25 present: ${!!before.building_config.systems_config_v25}`)
console.log(`         occupancy.schedule.exceptions: ${before.building_config.occupancy?.schedule?.exceptions?.length ?? 0}`)

// 2. PUT the corrections via the existing /building endpoint.
// Apply Xmas-exception strip + canonical occupancy density (1.5/room) alongside
// the systems / num_floors fixes so the seed produces a fully-corrected
// Bridgewater in one shot.
const correctedOccupancy = setOccupancyDensity(
  clearOccupancyXmasException(before.building_config.occupancy),
  1.5,
)
const correctionsToApply = {
  ...BUILDING_CORRECTIONS,
  occupancy: correctedOccupancy,
}
console.log()
console.log('Applying corrections via PUT /api/projects/{id}/building...')
const updated = await fj(`${API}/api/projects/${PROJECT_ID}/building`, {
  method:  'PUT',
  headers: { 'Content-Type': 'application/json' },
  body:    JSON.stringify(correctionsToApply),
})

// Brief 28k Gate 3+ (2026-05-16): apply per-project construction overrides
// via PUT /api/projects/{id}. Construction choices are stored at the project
// level (separate from building_config), so a separate PUT call is needed.
console.log('Applying construction overrides via PUT /api/projects/{id}...')
await fj(`${API}/api/projects/${PROJECT_ID}`, {
  method:  'PUT',
  headers: { 'Content-Type': 'application/json' },
  body:    JSON.stringify({ construction_choices: BRIDGEWATER_CONSTRUCTION_CHOICES }),
})
console.log(`         external_wall  u_value_override → ${BRIDGEWATER_CONSTRUCTION_CHOICES.external_wall.u_value_override} W/m²K`)
console.log(`         roof           u_value_override → ${BRIDGEWATER_CONSTRUCTION_CHOICES.roof.u_value_override} W/m²K`)
console.log(`         ground_floor   u_value_override → ${BRIDGEWATER_CONSTRUCTION_CHOICES.ground_floor.u_value_override} W/m²K`)
console.log(`         glazing        g_value_override → ${BRIDGEWATER_CONSTRUCTION_CHOICES.glazing.g_value_override}`)
console.log(`         fabric.thermal_bridging_alpha_pct → ${BRIDGEWATER_FABRIC.thermal_bridging_alpha_pct}%`)
console.log(`         infiltration_ach → ${BUILDING_CORRECTIONS.infiltration_ach}`)
console.log(`         ventilation systems: ${BRIDGEWATER_V25.ventilation.length} (mvhr_gf_public 1425, bedroom_extract 2208, public_toilet_extract 210 L/s)`)

console.log(`After  — num_floors=${updated.building_config.num_floors}, num_bedrooms=${updated.building_config.num_bedrooms}, length=${updated.building_config.length}, width=${updated.building_config.width}`)
console.log(`         systems_config_v25 present: ${!!updated.building_config.systems_config_v25}`)
console.log(`         occupancy.schedule.exceptions: ${updated.building_config.occupancy?.schedule?.exceptions?.length ?? 0}`)

// 3. Verify nested structure persisted correctly
const v25 = updated.building_config.systems_config_v25
if (!v25) { console.error('FAIL: systems_config_v25 not persisted'); process.exit(1) }
const ok = (
  v25.heating?.primary?.library_id === 'vrf_heat_recovery_dual_function' &&
  v25.cooling?.secondary?.library_id === 'dx_split_cooling' &&
  v25.dhw?.circulation_pump_w === 120 &&
  Array.isArray(v25.ventilation) && v25.ventilation.length === 2 &&
  v25.ventilation[1].flow_l_s === 1450
)
console.log(`Structure check: ${ok ? '✓ PASS' : '✗ FAIL'}`)
if (!ok) {
  console.log('Persisted v2.5 config:', JSON.stringify(v25, null, 2))
  process.exit(1)
}

// 4. Re-run engine via auto-detect path (no options.engine flag — should
//    auto-route to v2.5 because systems_config_v25 is now present).
console.log()
console.log('=== Capturing canonical post-correction Bridgewater outputs ===')
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

const building = updated.building_config
const constructions = updated.construction_choices
const comfortBand = {
  lower_c: updated.comfort_band_lower_c ?? 20,
  upper_c: updated.comfort_band_upper_c ?? 26,
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

// Auto-detect path: no options.engine flag — dispatcher should pick v2.5
// because building.systems_config_v25 is now present and non-empty.
const result = calculateInstant(
  building, constructions, {}, libraryData,
  weatherData, hourlySolar, null,
  { mode: 'full', comfortBand },
)

if (result.state !== 3) {
  console.error(`FAIL: expected state=3 after seeding, got state=${result.state}, mode=${result.mode}`)
  console.error('Dispatcher auto-detect of systems_config_v25 may have failed')
  process.exit(1)
}
console.log(`Auto-detect: ✓ engine routed to v2.5 (state=${result.state}, mode=${result.mode})`)

console.log()
const eu = result.energy_use
const sp = result.system_performance
const fr = result.free_running
const dem = result.demand
const gia = result.metadata?.gia_m2

console.log(`GIA:                        ${gia} m²`)
console.log(`State 2 free-running mean:  ${fr?.annual_mean_c}°C`)
console.log(`State 2 heating demand:     ${dem?.heating_demand_mwh} MWh`)
console.log(`State 2 cooling demand:     ${dem?.cooling_demand_mwh} MWh`)
console.log()
console.log('=== Energy use by fuel ===')
console.log(`Electricity total:  ${eu.totals.electricity_kwh.toLocaleString()} kWh`)
console.log(`Gas total:          ${eu.totals.gas_kwh.toLocaleString()} kWh`)
console.log(`Delivered:          ${eu.totals.delivered_energy_kwh.toLocaleString()} kWh`)
console.log(`EUI:                ${eu.totals.eui_kwh_per_m2} kWh/m²·a`)
console.log(`Carbon:             ${result.carbon_kg_co2_per_m2} kg CO2e/m²·a`)
console.log()
console.log('=== System performance — heating ===')
console.log(`  primary   ${sp.heating.primary?.fuel_mwh ?? 0} MWh fuel  (delivered ${sp.heating.primary?.delivered_mwh ?? 0})`)
console.log(`  secondary ${sp.heating.secondary?.fuel_mwh ?? 0} MWh fuel  (delivered ${sp.heating.secondary?.delivered_mwh ?? 0})`)
console.log(`  total     ${sp.heating.total.fuel_mwh} MWh fuel  (delivered ${sp.heating.total.delivered_mwh})`)
console.log('=== System performance — cooling ===')
console.log(`  primary   ${sp.cooling.primary?.fuel_mwh ?? 0} MWh fuel`)
console.log(`  secondary ${sp.cooling.secondary?.fuel_mwh ?? 0} MWh fuel`)
console.log(`  total     ${sp.cooling.total.fuel_mwh} MWh fuel`)
console.log('=== System performance — DHW ===')
console.log(`  primary   ${sp.dhw.primary?.fuel_mwh ?? 0} MWh fuel  (${sp.dhw.primary?.fuel ?? '-'})`)
console.log(`  secondary ${sp.dhw.secondary?.fuel_mwh ?? 0} MWh fuel  (${sp.dhw.secondary?.fuel ?? '-'})`)
console.log(`  circ pump ${sp.dhw.circulation_pump_kwh} kWh`)
console.log(`  total     ${sp.dhw.total.fuel_mwh} MWh fuel`)
console.log('=== System performance — ventilation ===')
for (const v of sp.ventilation.systems) {
  console.log(`  ${v.id.padEnd(12)} fan=${v.fan_kwh} kWh   recovery=${v.recovery_mwh} MWh   hours=${v.hours_active}   src=${v.schedule_source}`)
}
console.log(`  total fans          ${sp.ventilation.total.fan_kwh} kWh`)
console.log(`  effective recovery  ${sp.ventilation.total.recovery_mwh} MWh   (theoretical ${sp.ventilation.total.recovery_theoretical_mwh})`)
console.log()
console.log('=== Idempotency: re-running the seed should be a no-op ===')
console.log('(safe to re-run this script — PUT deep-merges, no destructive side effects)')
console.log()
