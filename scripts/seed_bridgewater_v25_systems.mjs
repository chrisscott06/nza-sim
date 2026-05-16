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

// ── Bridgewater fabric-level inputs ───────────────────────────────────────
//
// Brief 28L's fabric.thermal_bridging_alpha_pct = 200 (SBEM α convention,
// "200% of area-UA") has been DEPRECATED by Brief 28-TB-Simple in favour of
// ISO 14683 junction-based physics (see BRIDGEWATER_THERMAL_BRIDGES below).
// The α=200 number has been removed from the seed body; it's a stale BRUKL
// reporting artefact, not modelling input. The schema field
// `fabric.thermal_bridging_alpha_pct` stays alive as a deprecated read-only
// fallback (engine logs deprecation warning + α/100 × area_UA conversion
// for any project not yet re-seeded under Brief 28-TB-Simple).
const BRIDGEWATER_FABRIC = {
  // (no fabric-level overrides currently; reserved for future use)
}

// ── Brief 28-TB-Simple: Bridgewater thermal bridges ───────────────────────
//
// ISO 14683 auto-computation with multiplier 1.0 — typical UK Notional /
// AD L compliance-quality detailing, no specific psi-value calculations
// available. Junction lengths derived from geometry; ψ defaults from
// frontend/src/data/thermalBridgesLibrary.js (ISO 14683 Table A.2 typical
// values). Expected H_TB for Bridgewater post-WWR-correction: ~95-100 W/K,
// annual TB loss ~10-12 MWh/yr at Yeovilton.
//
// BRUKL Technical Data Sheet reports α = 200.31% (SBEM convention,
// non-standard reading); this is recorded as observation only in
// docs/research/sbem_thermal_bridging_convention.md, not consumed by the
// engine. See docs/briefs/active/28tb_thermal_bridging_simple.md for the
// reframe rationale.
const BRIDGEWATER_THERMAL_BRIDGES = {
  mode:       'iso14683_auto',
  multiplier: 1.0,
}

// ── Brief 28e: Bridgewater operable openings ──────────────────────────────
//
// One realistic V1 entry: a 2m × 2m main entrance door on the south facade,
// scheduled open during business hours (09:00-18:00 Mon-Fri). No bedroom
// windows — real Bridgewater bedrooms don't open. Permanent louvres
// (configured in `openings.{face}.louvre_area_m2`) stay unchanged.
//
// Control modes per Brief 28e §A.1:
//   - permanent:   always open
//   - scheduled:   open per `schedule_ref` (uses the schedule library)
//   - temperature: open when zone T > threshold (with hysteresis +
//                  optional `require_outside_cooler` gate)
//
// Note: `require_outside_cooler` is a temperature-mode-only field per
// Brief 28e ruling 3 (2026-05-16). Engine ignores it in permanent and
// scheduled modes; the schedule encodes user intent there.
const BRIDGEWATER_OPERABLE_OPENINGS = [
  {
    id:                  'gf_entrance_door',
    name:                'Main entrance door (south)',
    facade:              'south',
    area_m2:             4.0,
    height_m:            2.0,
    discharge_coefficient: 0.6,
    wind_coefficient:    0.25,        // BS 5925 typical sheltered/open door
    opening_type:        'door',
    parent_glazing_face: null,        // doors add envelope area, not glazing
    control: {
      mode:                  'scheduled',
      schedule_ref:          'business_hours_09_18_weekdays',
      open_above_zone_c:     22.0,    // unused for 'scheduled' but pre-populated
      hysteresis_c:          1.0,     // ditto
      require_outside_cooler: true,    // ditto — temperature-mode only
    },
  },
]

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
  // Brief 28-TB-Simple Bridgewater geometry correction:
  // wwr.north was 0.55 (overstated NE glazing as 517 m² of 940 m² wall);
  // CAD-measured real NE glazing is 339 m² of 964 m² wall, giving WWR = 0.351.
  // Phantom heat loss at the over-glazed WWR: ~+19.5 MWh/yr (diagnosis in
  // docs/research/sbem_thermal_bridging_convention.md). The wwr.south /
  // .east / .west values look right against CAD; only north needed fixing.
  // (Engine schema is a single WWR per facade — future Brief 28-PerFacade-
  // GlazingArea can extend to itemised per-window if/when needed.)
  wwr: { north: 0.35, south: 0.12, east: 0.02, west: 0.02 },
  // Brief 28-TB-Simple supersedes Brief 28k's thermal_bridging_alpha_pct
  // mechanism. See BRIDGEWATER_FABRIC + BRIDGEWATER_THERMAL_BRIDGES above.
  fabric:           BRIDGEWATER_FABRIC,
  thermal_bridges:  BRIDGEWATER_THERMAL_BRIDGES,
  systems_config_v25: BRIDGEWATER_V25,
  // Brief 28e: operable openings (entrance door scheduled during business hours).
  // Engine math lands at Gate E2; Gate E1 just persists the schema.
  operable_openings: BRIDGEWATER_OPERABLE_OPENINGS,
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
console.log(`         thermal_bridges → mode=${BRIDGEWATER_THERMAL_BRIDGES.mode}, multiplier=${BRIDGEWATER_THERMAL_BRIDGES.multiplier} (Brief 28-TB-Simple ISO 14683)`)
console.log(`         wwr.north → ${BUILDING_CORRECTIONS.wwr.north} (was 0.55; Brief 28-TB-Simple NE glazing correction)`)
console.log(`         infiltration_ach → ${BUILDING_CORRECTIONS.infiltration_ach}`)
console.log(`         ventilation systems: ${BRIDGEWATER_V25.ventilation.length} (mvhr_gf_public 1425, bedroom_extract 2208, public_toilet_extract 210 L/s)`)
console.log(`         operable_openings: ${BRIDGEWATER_OPERABLE_OPENINGS.length} → ${BRIDGEWATER_OPERABLE_OPENINGS.map(o => `${o.id} (${o.area_m2}m² ${o.facade}, ${o.control.mode}: ${o.control.schedule_ref ?? o.control.mode})`).join('; ')}`)

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
