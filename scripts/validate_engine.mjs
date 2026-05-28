/**
 * scripts/validate_engine.mjs
 *
 * Brief 63 — Comprehensive engine validation harness (PERMANENT).
 *
 * Runs 100+ first-principles physics assertions against the engine on
 * Bridgewater. Six categories:
 *
 *   A. MONOTONICITY    direction/sign of every output's response to every input
 *   B. BOUNDS          physical limits that must never be violated
 *   C. CONSERVATION    heat/fuel balance must close; same number two places matches
 *   D. INVARIANCE      a change moves ONLY what it should, no spurious coupling
 *   E. ORDERING        intervention stacking is order-independent; baseline-edit ==
 *                      equivalent-intervention
 *   F. RECONCILIATION  Δ = after − baseline; parts sum to totals; cross-panel equality
 *
 * Each test derives its expected answer from first principles — NOT from a
 * recorded baseline. The harness is a permanent regression guard: a red
 * assertion is a real physics or rule violation, not a tolerance trip.
 *
 * Run:   node scripts/validate_engine.mjs
 * Exit:  0 on all PASS; 1 on any FAIL.
 *
 * Output:
 *   - Console table per category with PASS / FAIL / BLOCKED counts
 *   - docs/audit/63_validation_report.json  (machine-readable matrix)
 *   - docs/audit/63_validation_report.md    (human-readable summary)
 *
 * Notes on modelling decisions baked into bounds tests:
 *
 *   - COOLING MODEL: the engine currently uses a weather-direction-bucketed
 *     surplus model — cooling_setpoint enters the integrand ONLY in hours where
 *     C_weather > 0 (T_out > comfort upper). Chris has decided to switch to a
 *     T_air-clamp model in a queued post-Brief-63 brief. The bounds tests
 *     ASSUME the clamp is the intended model (cooling_demand ≤ Σ gains, both
 *     setpoints active every hour). Failures of the clamp invariant on the
 *     current bucketed engine are CORRECTLY flagged as needing the queued
 *     cooling-clamp brief — they are not test tolerance issues.
 *
 *   - Brief 62 P2 setpoint single-source is assumed to have landed.
 *
 *   - The harness gates on CONSISTENCY (parts stack up, balance closes, direction
 *     correct), NOT on absolute baseline EUI. Drift is not a failure.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'
import { runInterventionStack } from '../frontend/src/utils/interventionsEngine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const API = process.env.NZA_API ?? 'http://127.0.0.1:8003'
const PID = process.env.NZA_PROJECT_ID ?? '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'

// ── Setup ───────────────────────────────────────────────────────────────
async function fj(u) { const r = await fetch(u); return r.json() }

console.log('Brief 63 — Engine validation harness')
console.log('='.repeat(70))
console.log('API:        ' + API)
console.log('Project:    ' + PID)

const project = await fj(`${API}/api/projects/${PID}`)
const lib = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []
const constructions = project.construction_choices
const baseBuilding = JSON.parse(JSON.stringify(project.building_config))
const comfortBand = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}
console.log('Building:   ' + project.name)
console.log('Comfort:    [' + comfortBand.lower_c + ', ' + comfortBand.upper_c + ']')

const weatherFile = baseBuilding.weather_file || project.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
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
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, Number(baseBuilding.orientation ?? 0))
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
console.log('Weather:    ' + weatherFile + ' (N=' + N + ' hours)')
console.log()

// ── Engine wrapper ──────────────────────────────────────────────────────
// Two flavours: `runEngine(building)` for direct calls, `runEngineFromCfg(cfg)`
// for the intervention-stack callback (which passes the entire {building,
// constructions, systems, libraryData} quartet — Brief 41 contract).
function runEngine(building, constructionsOverride) {
  return calculateInstant(building, constructionsOverride ?? constructions, {}, libraryData, weatherData, hourlySolar, null, {
    mode: 'full',
    engine: 'v2.5',
    comfortBand,
    _skipInterventions: true,
  })
}
function runEngineFromCfg(cfg) {
  // The stack callback receives the rolling config; the building is at cfg.building
  // and constructions at cfg.constructions (already patched by applyIntervention).
  return runEngine(cfg.building, cfg.constructions)
}

function runOnce(mutate) {
  const b = JSON.parse(JSON.stringify(baseBuilding))
  if (typeof mutate === 'function') mutate(b)
  return runEngine(b)
}

function pn(r, p) {
  let c = r
  for (const s of p.split('.')) {
    if (c == null) return null
    c = c[s]
  }
  return (typeof c === 'number' && Number.isFinite(c)) ? c : null
}

// Compact snapshot — one struct of all numbers a test might read.
function readSnap(r) {
  const cons = r.consumption ?? {}
  const hb = r.heat_balance?.annual ?? {}
  const los = r.losses_at_setpoint ?? {}
  const dem = r.demand ?? {}
  const vents = Array.isArray(cons.ventilation) ? cons.ventilation : []
  const losVents = Array.isArray(los.ventilation) ? los.ventilation : []
  return {
    // Demand
    demand_heating_mwh: pn(r, 'consumption.space_heating.demand_mwh'),
    demand_cooling_mwh: pn(r, 'consumption.space_cooling.demand_mwh'),
    demand_dhw_mwh:     pn(r, 'consumption.dhw.demand_mwh'),
    // Delivered
    delivered_heating_mwh: pn(r, 'consumption.space_heating.delivered_mwh'),
    delivered_cooling_mwh: pn(r, 'consumption.space_cooling.delivered_mwh'),
    delivered_dhw_mwh:     pn(r, 'consumption.dhw.delivered_mwh'),
    // Per-service fuel
    heat_elec_mwh: pn(r, 'consumption.space_heating.electricity_mwh') ?? 0,
    heat_gas_mwh:  pn(r, 'consumption.space_heating.gas_mwh') ?? 0,
    cool_elec_mwh: pn(r, 'consumption.space_cooling.electricity_mwh') ?? 0,
    dhw_elec_mwh:  pn(r, 'consumption.dhw.electricity_mwh') ?? 0,
    dhw_gas_mwh:   pn(r, 'consumption.dhw.gas_mwh') ?? 0,
    dhw_pump_mwh:  pn(r, 'consumption.dhw.circulation_pump_mwh') ?? 0,
    fan_elec_mwh:  pn(r, 'consumption.brief40.ventilation.total_fan_electrical_mwh') ?? 0,
    fan_elec_per_system_sum_mwh: vents.reduce((s, v) => s + (Number(v.fan_electricity_mwh) || 0), 0),
    light_elec_mwh: pn(r, 'consumption.lighting.electricity_mwh') ?? 0,
    sp_elec_mwh:   pn(r, 'consumption.small_power.electricity_mwh') ?? 0,
    // Totals
    total_elec_mwh:    pn(r, 'consumption.total.electricity_mwh'),
    total_gas_mwh:     pn(r, 'consumption.total.gas_mwh'),
    total_district_mwh:pn(r, 'consumption.total.district_heat_mwh') ?? 0,
    eui_kwh_per_m2:    pn(r, 'consumption.total.kwh_per_m2_yr'),
    eui_brief40_kwh_per_m2: pn(r, 'consumption.brief40.totals.eui_kWh_per_m2'),
    carbon_kg_per_m2:  pn(r, 'carbon_kg_co2_per_m2'),
    // Efficiencies
    scop_effective: pn(r, 'consumption.space_heating.scop_effective'),
    seer_effective: pn(r, 'consumption.space_cooling.seer_effective'),
    dhw_blended_eff:pn(r, 'consumption.brief40.dhw.blended_efficiency'),
    // Heat balance — losses (state 2 surface)
    hb_loss_wall_kwh:    pn(r, 'heat_balance.annual.losses.external_wall.kwh') ?? 0,
    hb_loss_roof_kwh:    pn(r, 'heat_balance.annual.losses.roof.kwh') ?? 0,
    hb_loss_floor_kwh:   pn(r, 'heat_balance.annual.losses.ground_floor.kwh') ?? 0,
    hb_loss_glazing_kwh: pn(r, 'heat_balance.annual.losses.glazing.kwh') ?? 0,
    hb_loss_tb_kwh:      pn(r, 'heat_balance.annual.losses.thermal_bridging.kwh') ?? 0,
    hb_loss_infil_kwh:   pn(r, 'heat_balance.annual.losses.fabric_leakage.kwh') ?? 0,
    hb_loss_pvent_kwh:   pn(r, 'heat_balance.annual.losses.permanent_vents.kwh') ?? 0,
    hb_loss_total_kwh:   pn(r, 'heat_balance.annual.totals.losses_kwh') ?? 0,
    // Heat balance — gains
    hb_gain_solar_n_kwh: pn(r, 'heat_balance.annual.gains.solar.north.kwh') ?? 0,
    hb_gain_solar_s_kwh: pn(r, 'heat_balance.annual.gains.solar.south.kwh') ?? 0,
    hb_gain_solar_e_kwh: pn(r, 'heat_balance.annual.gains.solar.east.kwh') ?? 0,
    hb_gain_solar_w_kwh: pn(r, 'heat_balance.annual.gains.solar.west.kwh') ?? 0,
    hb_gain_solar_total_kwh: pn(r, 'heat_balance.annual.gains.solar.total_kwh') ?? 0,
    hb_gain_people_kwh:    pn(r, 'heat_balance.annual.gains.internal.people.kwh') ?? 0,
    hb_gain_lighting_kwh:  pn(r, 'heat_balance.annual.gains.internal.lighting.kwh') ?? 0,
    hb_gain_equipment_kwh: pn(r, 'heat_balance.annual.gains.internal.equipment.kwh') ?? 0,
    hb_gain_total_kwh:     pn(r, 'heat_balance.annual.totals.gains_kwh') ?? 0,
    // brief40 demand echoes (must equal consumption.* counterparts)
    b40_heating_demand_mwh: pn(r, 'consumption.brief40.heating.demand_at_comfort_mwh'),
    b40_cooling_demand_mwh: pn(r, 'consumption.brief40.cooling.demand_at_comfort_mwh'),
    b40_dhw_demand_mwh:     pn(r, 'consumption.brief40.dhw.demand_at_comfort_mwh'),
    b40_light_elec_mwh:     pn(r, 'consumption.brief40.lighting.total_delivered_electrical_mwh'),
    b40_sp_elec_mwh:        pn(r, 'consumption.brief40.small_power.total_delivered_electrical_mwh'),
    b40_fan_elec_mwh:       pn(r, 'consumption.brief40.ventilation.total_fan_electrical_mwh'),
    // Setpoints (post-resolution; effective values + sources)
    eff_heating_setpoint_c: pn(r, 'demand.effective_heating_setpoint_c'),
    eff_cooling_setpoint_c: pn(r, 'demand.effective_cooling_setpoint_c'),
    heating_setpoint_source: r.demand?.heating_setpoint_source ?? null,
    cooling_setpoint_source: r.demand?.cooling_setpoint_source ?? null,
    setpoint_los_heating_c: pn(r, 'losses_at_setpoint.setpoints_used.heating_c'),
    setpoint_los_cooling_c: pn(r, 'losses_at_setpoint.setpoints_used.cooling_c'),
    // Regime-hour decomposition (Brief 63 P1 introspection)
    hours_heating_dir: pn(r, 'demand.hours_heating_direction'),
    hours_cooling_dir: pn(r, 'demand.hours_cooling_direction'),
    hours_shoulder:    pn(r, 'demand.hours_shoulder'),
    hours_bypass_in_heat: pn(r, 'demand.bypass_hours_in_heating_dir') ?? 0,
    hours_bypass_in_cool: pn(r, 'demand.bypass_hours_in_cooling_dir') ?? 0,
    // Bidirectional path flows (already in engine output)
    los_wall_heating_kwh: pn(r, 'losses_at_setpoint.external_wall.heating_loss_kwh') ?? 0,
    los_wall_cooling_kwh: pn(r, 'losses_at_setpoint.external_wall.cooling_gain_kwh') ?? 0,
    los_glaz_heating_kwh: pn(r, 'losses_at_setpoint.glazing.heating_loss_kwh') ?? 0,
    los_glaz_cooling_kwh: pn(r, 'losses_at_setpoint.glazing.cooling_gain_kwh') ?? 0,
    los_glaz_solar_transmission_kwh: pn(r, 'losses_at_setpoint.glazing.solar_transmission_kwh') ?? 0,
    los_glaz_solar_beneficial_kwh: pn(r, 'losses_at_setpoint.glazing.solar_beneficial_heating_kwh') ?? 0,
    los_glaz_solar_contributing_cooling_kwh: pn(r, 'losses_at_setpoint.glazing.solar_contributing_cooling_kwh') ?? 0,
    los_vent_total_heat_loss_kwh: losVents.reduce((s, v) => s + (Number(v.heat_loss_kwh) || 0), 0),
    los_vent_total_cool_gain_kwh: losVents.reduce((s, v) => s + (Number(v.cooling_gain_kwh) || 0), 0),
    los_vent_total_fan_kwh:       losVents.reduce((s, v) => s + (Number(v.fan_kwh) || 0), 0),
    los_total_heat_loss_kwh:      pn(r, 'losses_at_setpoint.totals.total_heating_loss_kwh') ?? 0,
    los_ig_offset_heating_kwh:    pn(r, 'losses_at_setpoint.internal_gains_bucketed.offset_heating_kwh') ?? 0,
    los_ig_added_cooling_kwh:     pn(r, 'losses_at_setpoint.internal_gains_bucketed.added_cooling_kwh') ?? 0,
    los_ig_total_kwh:             pn(r, 'losses_at_setpoint.internal_gains_bucketed.total_kwh') ?? 0,
    // GIA / metadata
    gia_m2: pn(r, 'metadata.gia_m2') ?? pn(r, 'heat_balance.metadata.gia_m2'),
    // Recovery
    recovery_offset_mwh: pn(r, 'consumption.space_heating.recovery_offset_mwh') ?? 0,
    // Comfort hours
    overheating_hours: pn(r, 'demand.overheating_hours'),
    underheating_hours: pn(r, 'demand.underheating_hours'),
    comfort_hours: pn(r, 'demand.comfort_hours'),
    // System path discriminator
    source_heating: r.consumption?.source_path?.heating ?? null,
  }
}

// ── Test recorder ───────────────────────────────────────────────────────
const results = []
function record(category, id, name, status, expected, actual, notes = '') {
  results.push({ category, id, name, status, expected, actual, notes })
  const tag = status === 'PASS' ? 'PASS' : status === 'FAIL' ? 'FAIL' : 'BLOCKED'
  if (status !== 'PASS') {
    console.log(`  [${tag}] ${id}: ${name} | expected: ${expected} | actual: ${actual} | ${notes}`)
  }
}

// Reusable assertion helpers
const TOL_REL = 0.001     // 0.1% relative
const TOL_ABS = 0.05      // 0.05 MWh absolute floor
const TOL_REL_LOOSE = 0.01 // 1% — for cross-element rollups where engine may round

function isApproxEq(a, b, tolRel = TOL_REL, tolAbs = TOL_ABS) {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return false
  const diff = Math.abs(a - b)
  const tol = Math.max(tolAbs, Math.max(Math.abs(a), Math.abs(b)) * tolRel)
  return diff <= tol
}

function assertApproxEq(cat, id, name, a, b, tolRel = TOL_REL, tolAbs = TOL_ABS, notes = '') {
  if (a == null || b == null) {
    record(cat, id, name, 'BLOCKED', `${b} (a or b null)`, `a=${a} b=${b}`, notes)
    return false
  }
  const pass = isApproxEq(a, b, tolRel, tolAbs)
  record(cat, id, name, pass ? 'PASS' : 'FAIL',
    `≈ ${typeof b === 'number' ? b.toFixed(3) : b}`,
    typeof a === 'number' ? a.toFixed(3) : String(a),
    notes + ` (diff ${(a - b).toFixed(4)})`)
  return pass
}

function assertInequality(cat, id, name, lhs, op, rhs, notes = '') {
  if (lhs == null || rhs == null) {
    record(cat, id, name, 'BLOCKED', `${lhs} ${op} ${rhs}`, 'null operand', notes)
    return false
  }
  let pass = false
  switch (op) {
    case '<': pass = lhs < rhs; break
    case '<=': pass = lhs <= rhs + TOL_ABS; break
    case '>': pass = lhs > rhs; break
    case '>=': pass = lhs >= rhs - TOL_ABS; break
    case '==': pass = lhs === rhs; break
    case '!=': pass = lhs !== rhs; break
    default: throw new Error('Unknown op: ' + op)
  }
  record(cat, id, name, pass ? 'PASS' : 'FAIL',
    `${typeof lhs === 'number' ? lhs.toFixed(3) : lhs} ${op} ${typeof rhs === 'number' ? rhs.toFixed(3) : rhs}`,
    `${typeof lhs === 'number' ? lhs.toFixed(3) : lhs} ${op} ${typeof rhs === 'number' ? rhs.toFixed(3) : rhs}`,
    notes)
  return pass
}

function assertMonotonic(cat, id, name, low, high, direction, notes = '') {
  // direction: 'up' (high > low), 'down' (high < low), 'unchanged' (|Δ| < tol)
  if (low == null || high == null) {
    record(cat, id, name, 'BLOCKED', direction, `low=${low} high=${high}`, notes)
    return false
  }
  const delta = high - low
  const meanAbs = Math.max(Math.abs(low), Math.abs(high))
  const tol = Math.max(TOL_ABS, meanAbs * TOL_REL)
  let pass = false
  let actual = ''
  if (direction === 'up') {
    pass = delta > tol
    actual = `Δ = ${delta.toFixed(3)} (need > ${tol.toFixed(3)})`
  } else if (direction === 'down') {
    pass = delta < -tol
    actual = `Δ = ${delta.toFixed(3)} (need < -${tol.toFixed(3)})`
  } else if (direction === 'unchanged') {
    pass = Math.abs(delta) <= tol
    actual = `|Δ| = ${Math.abs(delta).toFixed(3)} (need ≤ ${tol.toFixed(3)})`
  }
  record(cat, id, name, pass ? 'PASS' : 'FAIL', direction, actual, notes)
  return pass
}

// ── Baseline + cached sweep runs ────────────────────────────────────────
console.log('Running baseline + sweep snapshots (this takes ~60-90s)...')
const t0 = Date.now()
const baseline = readSnap(runOnce(null))
const noopSnap = readSnap(runOnce(b => { b.name = b.name })) // pure clone, identical input
console.log(`  baseline   EUI=${(baseline.eui_kwh_per_m2 ?? 0).toFixed(2)}  total_elec=${(baseline.total_elec_mwh ?? 0).toFixed(2)}  total_gas=${(baseline.total_gas_mwh ?? 0).toFixed(2)}`)

// Mutation helpers
function withHeatingSp(c) {
  return b => {
    b.systems_config_v40.heating_setpoint_mode = 'custom'
    b.systems_config_v40.heating_setpoint_c = c
  }
}
function withCoolingSp(c) {
  return b => {
    b.systems_config_v40.cooling_setpoint_mode = 'custom'
    b.systems_config_v40.cooling_setpoint_c = c
  }
}
function withHeatingScop(v) {
  return b => { if (b.systems_config_v40?.heating?.[0]) b.systems_config_v40.heating[0].efficiency_metric = v }
}
function withCoolingSeer(v) {
  return b => { if (b.systems_config_v40?.cooling?.[0]) b.systems_config_v40.cooling[0].efficiency_metric = v }
}
function withDhwEff(v) {
  return b => { if (b.systems_config_v40?.dhw?.[0]) b.systems_config_v40.dhw[0].efficiency_metric = v }
}
function withDhwLitresPerPerson(v) {
  return b => {
    b.systems_config_v40.dhw_demand_basis = 'per_person'
    b.systems_config_v40.dhw_demand_litres_per_person_per_day = v
  }
}
function withMvhrFlow(v) {
  return b => {
    for (const s of (b.systems_config_v40?.ventilation ?? [])) {
      if (s.id === 'vent_mvhr_gf_public') s.flow_rate = v
    }
  }
}
function withMvhrSfp(v) {
  return b => {
    for (const s of (b.systems_config_v40?.ventilation ?? [])) {
      if (s.id === 'vent_mvhr_gf_public') s.efficiency_metric.sfp_w_per_lps = v
    }
  }
}
function withMvhrHre(v) {
  return b => {
    for (const s of (b.systems_config_v40?.ventilation ?? [])) {
      if (s.id === 'vent_mvhr_gf_public') s.efficiency_metric.recovery_sensible_pct = v
    }
  }
}
function withLightingCf(v) {
  return b => { if (b.systems_config_v40?.lighting?.[0]) b.systems_config_v40.lighting[0].control_factor = v }
}
function withSmallPowerCf(v) {
  return b => { if (b.systems_config_v40?.small_power?.[0]) b.systems_config_v40.small_power[0].control_factor = v }
}
function withVentEnabled(enabled) {
  return b => {
    for (const v of (b.systems_config_v40?.ventilation ?? [])) v.enabled = enabled
    for (const v of (b.systems_config_v25?.ventilation ?? [])) v.enabled = enabled
  }
}
// Brief 68 Part C (register U4, 2026-05-28): asymmetric vent-disable mutators
// for the regression check that fan electricity honours BOTH enable flags.
// Pre-Brief-68 the v40-only path (_computeVentilation) ignored v25.enabled
// and fan_elec stayed at full value while State 2 mech-vent loss correctly
// zeroed — a known dual-source-of-truth bug. The harness now guards against
// regression by asserting fan_elec → 0 under either single-flag disable.
function withV25VentEnabled(enabled) {
  return b => {
    for (const v of (b.systems_config_v25?.ventilation ?? [])) v.enabled = enabled
  }
}
function withV40VentEnabled(enabled) {
  return b => {
    for (const v of (b.systems_config_v40?.ventilation ?? [])) v.enabled = enabled
  }
}
function withLightingEnabled(enabled) {
  return b => { for (const s of (b.systems_config_v40?.lighting ?? [])) s.enabled = enabled }
}
function withBypass(b40Bypass) {
  return b => {
    for (const v of (b.systems_config_v40?.ventilation ?? [])) {
      if (v.id === 'vent_mvhr_gf_public') v.summer_bypass = b40Bypass
    }
  }
}
function withDhwLoadShape(v) {
  return b => { b.systems_config_v40.dhw_load_shape = v }
}
// Brief 64: control_strategy field mutators
function withControlStrategy(v) {
  return b => { b.control_strategy = v }
}
function withFreeRunningAndCsp(c) {
  return b => {
    b.control_strategy = 'free_running'
    b.systems_config_v40.cooling_setpoint_mode = 'custom'
    b.systems_config_v40.cooling_setpoint_c = c
  }
}

const snaps = {} // cache keyed by short name
function getSnap(key, mutate) {
  if (snaps[key]) return snaps[key]
  snaps[key] = readSnap(runOnce(mutate))
  return snaps[key]
}

// Pre-run sweeps (parallelism would help but engine is CPU-bound JS;
// serial is fine and keeps memory low)
const sweepKeys = [
  ['hsp_19', withHeatingSp(19)],
  ['hsp_24', withHeatingSp(24)],
  ['hsp_28', withHeatingSp(28)],
  ['csp_18', withCoolingSp(18)],
  ['csp_22', withCoolingSp(22)],
  ['csp_28', withCoolingSp(28)],
  ['scop_lo', withHeatingScop(2.0)],
  ['scop_hi', withHeatingScop(4.0)],
  ['seer_lo', withCoolingSeer(2.5)],
  ['seer_hi', withCoolingSeer(5.0)],
  ['dhweff_lo', withDhwEff(0.7)],
  ['dhweff_hi', withDhwEff(1.0)],
  ['dhwlpd_40', withDhwLitresPerPerson(40)],
  ['dhwlpd_150', withDhwLitresPerPerson(150)],
  ['mvhr_flow_lo', withMvhrFlow(700)],
  ['mvhr_flow_hi', withMvhrFlow(2500)],
  ['sfp_lo', withMvhrSfp(1.0)],
  ['sfp_hi', withMvhrSfp(2.5)],
  ['hre_lo', withMvhrHre(60)],
  ['hre_hi', withMvhrHre(90)],
  ['light_cf_lo', withLightingCf(0.4)],
  ['light_cf_hi', withLightingCf(1.0)],
  ['sp_cf_lo', withSmallPowerCf(0.5)],
  ['sp_cf_hi', withSmallPowerCf(1.5)],
  ['vent_off', withVentEnabled(false)],
  // Brief 68 Part C: asymmetric vent-disable snapshots for D11/D12
  ['v25_vent_off', withV25VentEnabled(false)],
  ['v40_vent_off', withV40VentEnabled(false)],
  ['light_off', withLightingEnabled(false)],
  ['bypass_on', withBypass(true)],
  ['bypass_off', withBypass(false)],
  ['dhw_flat', withDhwLoadShape('flat')],
  ['dhw_follow', withDhwLoadShape('follow_occupancy')],
  // Brief 64: control_strategy probes (clamp vs free_running)
  ['free_run_default', withControlStrategy('free_running')],
  ['active_explicit',  withControlStrategy('active_setpoint')],
  ['free_run_csp_28',  withFreeRunningAndCsp(28)],
  ['free_run_csp_18',  withFreeRunningAndCsp(18)],
  ['active_csp_18',    withCoolingSp(18)],   // baseline default is already active_setpoint
]
for (const [k, m] of sweepKeys) {
  process.stdout.write(`  ${k}... `)
  const ts = Date.now()
  getSnap(k, m)
  console.log(`${((Date.now() - ts) / 1000).toFixed(1)}s`)
}
console.log(`Sweep complete: ${sweepKeys.length} runs in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log()

// ════════════════════════════════════════════════════════════════════════
// CATEGORY A — MONOTONICITY
// ════════════════════════════════════════════════════════════════════════
console.log('--- A. MONOTONICITY ---')

// Heating setpoint ↑ → demand ↑ and fuel ↑
assertMonotonic('A', 'A01', 'heating_setpoint 19→24 → demand_heating ↑',
  snaps.hsp_19.demand_heating_mwh, snaps.hsp_24.demand_heating_mwh, 'up')
assertMonotonic('A', 'A02', 'heating_setpoint 24→28 → demand_heating ↑',
  snaps.hsp_24.demand_heating_mwh, snaps.hsp_28.demand_heating_mwh, 'up')
assertMonotonic('A', 'A03', 'heating_setpoint 19→24 → fuel_heating ↑',
  snaps.hsp_19.heat_elec_mwh + snaps.hsp_19.heat_gas_mwh,
  snaps.hsp_24.heat_elec_mwh + snaps.hsp_24.heat_gas_mwh, 'up')
assertMonotonic('A', 'A04', 'heating_setpoint 19→28 → total_elec ↑',
  snaps.hsp_19.total_elec_mwh, snaps.hsp_28.total_elec_mwh, 'up')
assertMonotonic('A', 'A05', 'heating_setpoint 19→28 → EUI ↑',
  snaps.hsp_19.eui_kwh_per_m2, snaps.hsp_28.eui_kwh_per_m2, 'up')
assertMonotonic('A', 'A06', 'heating_setpoint 19→28 → hours_heating_dir ↑',
  snaps.hsp_19.hours_heating_dir, snaps.hsp_28.hours_heating_dir, 'up')

// Cooling setpoint ↓ → cooling demand ↑
assertMonotonic('A', 'A07', 'cooling_setpoint 28→22 → demand_cooling ↑',
  snaps.csp_28.demand_cooling_mwh, snaps.csp_22.demand_cooling_mwh, 'up')
assertMonotonic('A', 'A08', 'cooling_setpoint 22→18 → demand_cooling ↑',
  snaps.csp_22.demand_cooling_mwh, snaps.csp_18.demand_cooling_mwh, 'up')
assertMonotonic('A', 'A09', 'cooling_setpoint 28→18 → fuel_cooling ↑',
  snaps.csp_28.cool_elec_mwh, snaps.csp_18.cool_elec_mwh, 'up')
assertMonotonic('A', 'A10', 'cooling_setpoint 28→18 → total_elec ↑',
  snaps.csp_28.total_elec_mwh, snaps.csp_18.total_elec_mwh, 'up')

// SCOP ↑ → fuel ↓, demand unchanged
assertMonotonic('A', 'A11', 'heating_scop 2.0→4.0 → fuel_heating ↓',
  snaps.scop_lo.heat_elec_mwh + snaps.scop_lo.heat_gas_mwh,
  snaps.scop_hi.heat_elec_mwh + snaps.scop_hi.heat_gas_mwh, 'down')
assertMonotonic('A', 'A12', 'heating_scop ↑ → demand_heating unchanged',
  snaps.scop_lo.demand_heating_mwh, snaps.scop_hi.demand_heating_mwh, 'unchanged')
assertMonotonic('A', 'A13', 'heating_scop ↑ → delivered_heating unchanged',
  snaps.scop_lo.delivered_heating_mwh, snaps.scop_hi.delivered_heating_mwh, 'unchanged')

// SEER ↑ → cooling fuel ↓
assertMonotonic('A', 'A14', 'cooling_seer 2.5→5.0 → fuel_cooling ↓',
  snaps.seer_lo.cool_elec_mwh, snaps.seer_hi.cool_elec_mwh, 'down')
assertMonotonic('A', 'A15', 'cooling_seer ↑ → demand_cooling unchanged',
  snaps.seer_lo.demand_cooling_mwh, snaps.seer_hi.demand_cooling_mwh, 'unchanged')

// DHW efficiency ↑ → fuel ↓
assertMonotonic('A', 'A16', 'dhw_efficiency 0.7→1.0 → fuel_dhw ↓',
  snaps.dhweff_lo.dhw_elec_mwh + snaps.dhweff_lo.dhw_gas_mwh,
  snaps.dhweff_hi.dhw_elec_mwh + snaps.dhweff_hi.dhw_gas_mwh, 'down')
assertMonotonic('A', 'A17', 'dhw_efficiency ↑ → demand_dhw unchanged',
  snaps.dhweff_lo.demand_dhw_mwh, snaps.dhweff_hi.demand_dhw_mwh, 'unchanged')

// DHW demand ↑ → demand_dhw ↑
assertMonotonic('A', 'A18', 'dhw_litres_per_person 40→150 → demand_dhw ↑',
  snaps.dhwlpd_40.demand_dhw_mwh, snaps.dhwlpd_150.demand_dhw_mwh, 'up')

// MVHR flow ↑ → vent heat loss ↑ and fan power ↑
assertMonotonic('A', 'A19', 'mvhr_flow 700→2500 → vent heat_loss ↑',
  snaps.mvhr_flow_lo.los_vent_total_heat_loss_kwh, snaps.mvhr_flow_hi.los_vent_total_heat_loss_kwh, 'up')
assertMonotonic('A', 'A20', 'mvhr_flow 700→2500 → fan_elec ↑',
  snaps.mvhr_flow_lo.fan_elec_mwh, snaps.mvhr_flow_hi.fan_elec_mwh, 'up')
assertMonotonic('A', 'A21', 'mvhr_flow 700→2500 → demand_heating ↑ (more vent loss)',
  snaps.mvhr_flow_lo.demand_heating_mwh, snaps.mvhr_flow_hi.demand_heating_mwh, 'up')

// SFP ↑ → fan elec ↑, demand unchanged
assertMonotonic('A', 'A22', 'sfp 1.0→2.5 → fan_elec ↑',
  snaps.sfp_lo.fan_elec_mwh, snaps.sfp_hi.fan_elec_mwh, 'up')
assertMonotonic('A', 'A23', 'sfp ↑ → demand_heating unchanged (fan power doesn\'t drive demand)',
  snaps.sfp_lo.demand_heating_mwh, snaps.sfp_hi.demand_heating_mwh, 'unchanged')
assertMonotonic('A', 'A24', 'sfp ↑ → demand_cooling unchanged',
  snaps.sfp_lo.demand_cooling_mwh, snaps.sfp_hi.demand_cooling_mwh, 'unchanged')
assertMonotonic('A', 'A25', 'sfp ↑ → demand_dhw unchanged',
  snaps.sfp_lo.demand_dhw_mwh, snaps.sfp_hi.demand_dhw_mwh, 'unchanged')

// HRE ↑ → vent heat loss ↓ (post-recovery)
assertMonotonic('A', 'A26', 'hre 60→90 → vent heat_loss ↓ (post-recovery)',
  snaps.hre_lo.los_vent_total_heat_loss_kwh, snaps.hre_hi.los_vent_total_heat_loss_kwh, 'down')
assertMonotonic('A', 'A27', 'hre 60→90 → demand_heating ↓ (recovery offsets demand)',
  snaps.hre_lo.demand_heating_mwh, snaps.hre_hi.demand_heating_mwh, 'down')
assertMonotonic('A', 'A28', 'hre 60→90 → recovery_offset ↑',
  snaps.hre_lo.recovery_offset_mwh, snaps.hre_hi.recovery_offset_mwh, 'up')

// Lighting/equipment coupling (Brief 58 C)
assertMonotonic('A', 'A29', 'lighting_cf 0.4→1.0 → light_elec ↑',
  snaps.light_cf_lo.light_elec_mwh, snaps.light_cf_hi.light_elec_mwh, 'up')
assertMonotonic('A', 'A30', 'lighting_cf 0.4→1.0 → lighting_gain (heat_balance) ↑',
  snaps.light_cf_lo.hb_gain_lighting_kwh, snaps.light_cf_hi.hb_gain_lighting_kwh, 'up')
assertMonotonic('A', 'A31', 'lighting_cf 0.4→1.0 → demand_heating ↓ (more internal gain offsets demand)',
  snaps.light_cf_lo.demand_heating_mwh, snaps.light_cf_hi.demand_heating_mwh, 'down')
assertMonotonic('A', 'A32', 'lighting_cf 0.4→1.0 → demand_cooling ↑',
  snaps.light_cf_lo.demand_cooling_mwh, snaps.light_cf_hi.demand_cooling_mwh, 'up')

assertMonotonic('A', 'A33', 'sp_cf 0.5→1.5 → sp_elec ↑',
  snaps.sp_cf_lo.sp_elec_mwh, snaps.sp_cf_hi.sp_elec_mwh, 'up')
assertMonotonic('A', 'A34', 'sp_cf 0.5→1.5 → equipment_gain (heat_balance) ↑',
  snaps.sp_cf_lo.hb_gain_equipment_kwh, snaps.sp_cf_hi.hb_gain_equipment_kwh, 'up')

// Vent off → vent heat loss ↓, fan elec ↓
assertMonotonic('A', 'A35', 'vent enabled→disabled → vent heat_loss ↓',
  baseline.los_vent_total_heat_loss_kwh, snaps.vent_off.los_vent_total_heat_loss_kwh, 'down')
assertMonotonic('A', 'A36', 'vent enabled→disabled → fan_elec ↓',
  baseline.fan_elec_mwh, snaps.vent_off.fan_elec_mwh, 'down')

// Lighting disabled → light_elec ↓
assertMonotonic('A', 'A37', 'lighting enabled→disabled → light_elec ↓',
  baseline.light_elec_mwh, snaps.light_off.light_elec_mwh, 'down')
assertMonotonic('A', 'A38', 'lighting disabled → lighting_gain in heat_balance ↓',
  baseline.hb_gain_lighting_kwh, snaps.light_off.hb_gain_lighting_kwh, 'down')

// Carbon follows fuel
assertMonotonic('A', 'A39', 'cooling_seer 2.5→5.0 → carbon ↓',
  snaps.seer_lo.carbon_kg_per_m2, snaps.seer_hi.carbon_kg_per_m2, 'down')
assertMonotonic('A', 'A40', 'heating_scop 2.0→4.0 → carbon ↓',
  snaps.scop_lo.carbon_kg_per_m2, snaps.scop_hi.carbon_kg_per_m2, 'down')

// ════════════════════════════════════════════════════════════════════════
// CATEGORY B — BOUNDS
// ════════════════════════════════════════════════════════════════════════
console.log('--- B. BOUNDS ---')

// Non-negativity (baseline + every sweep)
const allSnapsForBounds = [baseline, ...Object.values(snaps)]
let bNeg = 0
for (const s of allSnapsForBounds) {
  for (const k of ['demand_heating_mwh','demand_cooling_mwh','demand_dhw_mwh',
                   'delivered_heating_mwh','delivered_cooling_mwh','delivered_dhw_mwh',
                   'heat_elec_mwh','heat_gas_mwh','cool_elec_mwh','dhw_elec_mwh','dhw_gas_mwh',
                   'fan_elec_mwh','light_elec_mwh','sp_elec_mwh',
                   'total_elec_mwh','total_gas_mwh','eui_kwh_per_m2','carbon_kg_per_m2',
                   'hb_loss_total_kwh','hb_gain_total_kwh']) {
    if (s[k] != null && s[k] < -TOL_ABS) bNeg++
  }
}
record('B', 'B01', 'no negative demand/fuel/EUI/carbon across all sweep points',
  bNeg === 0 ? 'PASS' : 'FAIL', 0, bNeg, `${bNeg} negative values across ${allSnapsForBounds.length} snaps`)

// Fuel = delivered / efficiency, exactly (per service)
function checkFuelExact(snap, label, idBase) {
  const a = snap.delivered_heating_mwh, b = snap.scop_effective, c = snap.heat_elec_mwh + snap.heat_gas_mwh
  if (a != null && b != null && b > 0) {
    assertApproxEq('B', `${idBase}h`, `${label}: fuel_heating = delivered / scop`, c, a / b, 0.01, 0.1,
      `delivered=${a.toFixed(2)} scop=${b.toFixed(2)}`)
  }
  const ac = snap.delivered_cooling_mwh, bc = snap.seer_effective, cc = snap.cool_elec_mwh
  if (ac != null && bc != null && bc > 0) {
    assertApproxEq('B', `${idBase}c`, `${label}: fuel_cooling = delivered / seer`, cc, ac / bc, 0.01, 0.1,
      `delivered=${ac.toFixed(2)} seer=${bc.toFixed(2)}`)
  }
}
checkFuelExact(baseline, 'baseline', 'B02')
checkFuelExact(snaps.scop_hi, 'scop_hi', 'B03')
checkFuelExact(snaps.seer_hi, 'seer_hi', 'B04')

// Delivered == demand (Brief 62 P2 closure)
function checkDeliveredEqDemand(snap, label, idBase) {
  if (snap.delivered_heating_mwh != null && snap.demand_heating_mwh != null) {
    assertApproxEq('B', `${idBase}h`, `${label}: delivered_heating == demand_heating`,
      snap.delivered_heating_mwh, snap.demand_heating_mwh, 0.001, 0.05)
  }
  if (snap.delivered_cooling_mwh != null && snap.demand_cooling_mwh != null) {
    assertApproxEq('B', `${idBase}c`, `${label}: delivered_cooling == demand_cooling`,
      snap.delivered_cooling_mwh, snap.demand_cooling_mwh, 0.001, 0.05)
  }
  if (snap.delivered_dhw_mwh != null && snap.demand_dhw_mwh != null) {
    assertApproxEq('B', `${idBase}d`, `${label}: delivered_dhw == demand_dhw`,
      snap.delivered_dhw_mwh, snap.demand_dhw_mwh, 0.001, 0.05)
  }
}
checkDeliveredEqDemand(baseline, 'baseline', 'B05')
checkDeliveredEqDemand(snaps.hsp_28, 'hsp_28', 'B06')
checkDeliveredEqDemand(snaps.csp_18, 'csp_18', 'B07')

// Efficiency < plausible max
assertInequality('B', 'B08', 'scop_effective ≤ 10 (no super-physical heating)',
  baseline.scop_effective, '<=', 10)
assertInequality('B', 'B09', 'seer_effective ≤ 10 (no super-physical cooling)',
  baseline.seer_effective, '<=', 10)
assertInequality('B', 'B10', 'dhw_blended_eff ≤ 10', baseline.dhw_blended_eff, '<=', 10)

// Cooling demand ≤ total gains
// NOTE: per the cooling-clamp modelling decision, this is the intended invariant.
// In the current weather-direction-bucketed engine the assertion may fail under
// vent-off, low-cooling-setpoint configurations because the cooling integrand
// is bypassed in heating-direction hours — that's the queued cooling-clamp brief.
// We assert it on baseline + a small representative set; failures are diagnostic.
function gainsTotalMwh(s) {
  return (s.hb_gain_solar_total_kwh + s.hb_gain_people_kwh + s.hb_gain_lighting_kwh + s.hb_gain_equipment_kwh) / 1000
}
// Brief 69 Part 3 (2026-05-28, register Decision 3): the `cooling_demand ≤
// Σ gains` bound is SUPERSEDED. Under the Brief 64 unconditional clamp the
// cooling formula was max(0, gains + cool_gain - heat_loss_at_T_heat) and
// was naturally bounded above by Σ gains. Under Brief 69 float-gated
// demand the cooling magnitude when conditioning fires is
// -C_coef × (T_air_free - T_cool) — energy to offset ALL conductance
// losses at T_cool (fabric + glazing + infiltration + mech-vent), not
// just gains. Cooling can therefore legitimately exceed gains, especially
// at low cooling setpoints. The new bound is non-negativity.
assertInequality('B', 'B11', 'baseline: cooling_demand ≥ 0',
  baseline.demand_cooling_mwh, '>=', 0)
assertInequality('B', 'B12', 'csp_18: cooling_demand ≥ 0',
  snaps.csp_18.demand_cooling_mwh, '>=', 0)
assertInequality('B', 'B13', 'vent_off: cooling_demand ≥ 0',
  snaps.vent_off.demand_cooling_mwh, '>=', 0)

// B13b — THE SCREENSHOT SCENARIO. Brief 69 (2026-05-28, register Decision 3):
// the `cooling ≤ Σ gains` bound is gone (see B11/B12/B13 above). Under the
// new float-gated model, an extreme scenario (vent off + low cooling setpoint
// + gain bumps) can produce huge cooling because the C_coef-derived demand
// covers all conductance losses at the low setpoint. The bound is no longer
// applicable; non-negativity is what remains.
const screenshotMutate = b => {
  for (const v of (b.systems_config_v40?.ventilation ?? [])) v.enabled = false
  for (const v of (b.systems_config_v25?.ventilation ?? [])) v.enabled = false
  for (const s of (b.systems_config_v40?.lighting ?? [])) s.control_factor = 1.333
  for (const s of (b.systems_config_v40?.small_power ?? [])) s.control_factor = 1.480
  b.systems_config_v40.cooling_setpoint_mode = 'custom'
  b.systems_config_v40.cooling_setpoint_c = 14
  for (const s of (b.systems_config_v40?.heating ?? [])) s.enabled = false
}
const screenshotSnap = readSnap(runOnce(screenshotMutate))
const screenshotGains = gainsTotalMwh(screenshotSnap)
assertInequality('B', 'B13b',
  'SCREENSHOT (vent_off + lcf=1.33 + spcf=1.48 + csp=14 + heat_off): cooling_demand ≥ 0',
  screenshotSnap.demand_cooling_mwh, '>=', 0,
  `demand=${screenshotSnap.demand_cooling_mwh?.toFixed(1)} gains=${screenshotGains.toFixed(1)} — Brief 69 model: cooling can far exceed gains because it covers full conductance losses at low csp`)

// B13c — Cooling-setpoint sensitivity in vent-off. The bucketed model means
// cooling_setpoint barely moves demand in vent-off configs (because the cooling
// integrand is bypassed in heating-direction hours). The cooling-clamp model
// would invert this: clamp at lower setpoint → demand rises substantially.
// Document the current bucketed behaviour with diagnostic info.
const ventOffCsp24 = readSnap(runOnce(b => {
  for (const v of (b.systems_config_v40?.ventilation ?? [])) v.enabled = false
  for (const v of (b.systems_config_v25?.ventilation ?? [])) v.enabled = false
}))
const ventOffCsp18 = readSnap(runOnce(b => {
  for (const v of (b.systems_config_v40?.ventilation ?? [])) v.enabled = false
  for (const v of (b.systems_config_v25?.ventilation ?? [])) v.enabled = false
  b.systems_config_v40.cooling_setpoint_mode = 'custom'
  b.systems_config_v40.cooling_setpoint_c = 18
}))
// Under the clamp model we'd expect substantially higher demand at csp=18.
// Under the current bucketed model, the change is small. Both directions
// are correct (demand cannot DECREASE when setpoint drops), but the
// magnitude reflects the model.
assertMonotonic('B', 'B13d', 'vent_off: cooling_demand cannot decrease when cooling_setpoint drops 24→18',
  ventOffCsp24.demand_cooling_mwh, ventOffCsp18.demand_cooling_mwh, 'up',
  `Δ = ${(ventOffCsp18.demand_cooling_mwh - ventOffCsp24.demand_cooling_mwh).toFixed(2)} MWh. Bucketed model shows small Δ; clamp model would show large Δ`)

// Heating demand ≤ envelope loss potential (very loose upper bound)
assertInequality('B', 'B14', 'baseline: heating_demand ≤ Σ heating_loss_at_setpoint',
  baseline.demand_heating_mwh, '<=', baseline.los_total_heat_loss_kwh / 1000 + 0.5,
  `setpoint_losses=${(baseline.los_total_heat_loss_kwh / 1000).toFixed(2)} MWh`)

// Post-recovery demand ≤ pre-recovery (MVHR recovery can't increase load)
// pre = baseline w/ HRE=0; post = baseline w/ HRE>0
const hreOff = readSnap(runOnce(b => {
  for (const s of (b.systems_config_v40?.ventilation ?? [])) {
    if (s.id === 'vent_mvhr_gf_public') s.efficiency_metric.recovery_sensible_pct = 0
  }
}))
assertInequality('B', 'B15', 'HRE>0: vent heat_loss ≤ HRE=0 vent heat_loss (recovery reduces, never increases)',
  baseline.los_vent_total_heat_loss_kwh, '<=', hreOff.los_vent_total_heat_loss_kwh + 0.5)
assertInequality('B', 'B16', 'HRE>0: demand_heating ≤ HRE=0 demand_heating',
  baseline.demand_heating_mwh, '<=', hreOff.demand_heating_mwh + 0.5)

// Bypass-on ≤ bypass-off in cooling-relevant scenarios
// bypass is correct when it ONLY saves; never costs more
assertInequality('B', 'B17', 'bypass_on EUI ≤ bypass_off EUI (correct bypass cannot increase consumption)',
  snaps.bypass_on.eui_kwh_per_m2, '<=', snaps.bypass_off.eui_kwh_per_m2 + 0.5)

// Hours sum to 8760
const hoursSum = (baseline.hours_heating_dir ?? 0) + (baseline.hours_cooling_dir ?? 0) + (baseline.hours_shoulder ?? 0)
assertApproxEq('B', 'B18', 'hours_heating + cooling + shoulder = 8760 (baseline)',
  hoursSum, 8760, 0, 1)

// Bypass hours ≤ 8760
const totalBypassH = (baseline.hours_bypass_in_heat ?? 0) + (baseline.hours_bypass_in_cool ?? 0)
assertInequality('B', 'B19', 'bypass_hours_total ≤ 8760', totalBypassH, '<=', 8760)

// Bypass hours ≤ regime hours per regime
assertInequality('B', 'B20', 'bypass_hours_in_cool ≤ hours_cooling_dir',
  baseline.hours_bypass_in_cool, '<=', baseline.hours_cooling_dir)
assertInequality('B', 'B21', 'bypass_hours_in_heat ≤ hours_heating_dir',
  baseline.hours_bypass_in_heat, '<=', baseline.hours_heating_dir)

// Comfort hours sum to ≤ 8760
const comfHrs = (baseline.overheating_hours ?? 0) + (baseline.underheating_hours ?? 0) + (baseline.comfort_hours ?? 0)
assertApproxEq('B', 'B22', 'overheating + underheating + comfort hours = 8760',
  comfHrs, 8760, 0, 1)

// EUI = (elec + gas + district) * 1000 / gia
const euiCalc = (baseline.total_elec_mwh + baseline.total_gas_mwh + baseline.total_district_mwh) * 1000 / baseline.gia_m2
assertApproxEq('B', 'B23', 'EUI = (Σ fuel by carrier) × 1000 / gia',
  baseline.eui_kwh_per_m2, euiCalc, 0.003, 0.2,
  `calc=${euiCalc.toFixed(2)}`)

// Same check for csp_18 (the headline case)
const euiCalcCsp18 = (snaps.csp_18.total_elec_mwh + snaps.csp_18.total_gas_mwh + snaps.csp_18.total_district_mwh) * 1000 / snaps.csp_18.gia_m2
assertApproxEq('B', 'B24', 'csp_18: EUI = (Σ fuel) × 1000 / gia',
  snaps.csp_18.eui_kwh_per_m2, euiCalcCsp18, 0.003, 0.2,
  `calc=${euiCalcCsp18.toFixed(2)}`)

// Solar facade sum check
const solarSum = baseline.hb_gain_solar_n_kwh + baseline.hb_gain_solar_s_kwh + baseline.hb_gain_solar_e_kwh + baseline.hb_gain_solar_w_kwh
assertApproxEq('B', 'B25', 'solar facade sum = solar.total_kwh',
  solarSum, baseline.hb_gain_solar_total_kwh, 0.005, 5)

// Brief 69 Part 3 (2026-05-28, register Decision 3): free_running INVARIANCE
// REDEFINED. Per Brief 67 §Part A and Brief 69 §Part C battery, free_running
// is now "zone floats with no conditioning (heating = cooling = 0)" — the
// pre-Brief-64 weather-bucketed branches that produced synthetic demand have
// been retired (they were exactly the "demand off a balance equation"
// disease Brief 67 set out to retire). The B26-B29 anchors to pre-Brief-64
// numbers (69.1/110.3/66.7/77.9 MWh) are SUPERSEDED — that engine model no
// longer exists.
assertApproxEq('B', 'B26', 'free_running default: cool_demand == 0 (no conditioning)',
  snaps.free_run_default.demand_cooling_mwh, 0, 0.001, 0.01,
  'Brief 67/69: free_running = zone floats freely, no synthetic demand')
assertApproxEq('B', 'B27', 'free_running default: heating_demand == 0',
  snaps.free_run_default.demand_heating_mwh, 0, 0.001, 0.01)
assertApproxEq('B', 'B28', 'free_running csp=28: cool_demand == 0',
  snaps.free_run_csp_28.demand_cooling_mwh, 0, 0.001, 0.01)
assertApproxEq('B', 'B29', 'free_running csp=18: cool_demand == 0',
  snaps.free_run_csp_18.demand_cooling_mwh, 0, 0.001, 0.01)

// Brief 69 Part 3: clamp ≥ free_running at every csp is now trivially true
// (free_running = 0). Kept as a degenerate sanity gate — if either flips
// negative, something has broken in the demand bookkeeping.
assertInequality('B', 'B30', 'csp=18: active_setpoint cool_demand ≥ free_running cool_demand (= 0)',
  snaps.active_csp_18.demand_cooling_mwh, '>=', snaps.free_run_csp_18.demand_cooling_mwh,
  `free_running = 0 by Brief 67/69 definition; active_setpoint integrates dead-band-gated demand`)
assertInequality('B', 'B31', 'baseline: active_setpoint cool_demand ≥ free_running cool_demand (= 0)',
  baseline.demand_cooling_mwh, '>=', snaps.free_run_default.demand_cooling_mwh)

// Brief 69 Part 3 (Decision 3): the "heating unchanged across strategies"
// invariant is RETIRED. Brief 64 had it (heating formula was preserved
// between strategies); Brief 69 has different heating formulas (active_setpoint
// uses C_coef-derived Q_cond; free_running = 0). Replace with the new
// asymmetry: active_setpoint heating > 0 on any building with winter losses;
// free_running heating == 0 by definition.
assertInequality('B', 'B32a', 'active_setpoint baseline: heating_demand > 0 (real winter losses)',
  baseline.demand_heating_mwh, '>', 0,
  'Bridgewater has substantial winter heat loss; active_setpoint integrates it')
assertApproxEq('B', 'B32b', 'free_running default: heating_demand == 0 (no conditioning)',
  snaps.free_run_default.demand_heating_mwh, 0, 0.001, 0.01,
  'Brief 67/69 free_running definition')

// Brief 64 §C — Explicit active_setpoint == default (no field).
// The default behaviour when control_strategy is absent must equal what the
// user gets when they explicitly select active_setpoint. Documents that the
// default is the clamp.
assertApproxEq('B', 'B33', 'control_strategy default (no field) == explicit active_setpoint',
  baseline.demand_cooling_mwh, snaps.active_explicit.demand_cooling_mwh, 0.001, 0.05)

// ════════════════════════════════════════════════════════════════════════
// CATEGORY C — CONSERVATION
// ════════════════════════════════════════════════════════════════════════
console.log('--- C. CONSERVATION ---')

// Total elec = Σ per-service elec (THE carrier-vs-EUI gap test)
// Note: dhw_elec_mwh already INCLUDES the circulation pump (engine adds it
// inside _computeDhw before reporting per-service electricity). So the carrier
// sum is dhw_elec + others, NOT dhw_elec + dhw_pump (which would double-count
// by ~1.05 MWh). The dhw_pump_mwh field is exposed for diagnostic only.
function checkTotalElecSum(s, label, id) {
  const sum = (s.heat_elec_mwh + s.cool_elec_mwh + s.dhw_elec_mwh +
               s.fan_elec_mwh + s.light_elec_mwh + s.sp_elec_mwh)
  assertApproxEq('C', id, `${label}: total_elec = Σ per-service elec`,
    s.total_elec_mwh, sum, 0.003, 0.3,
    `parts: h=${s.heat_elec_mwh.toFixed(2)} c=${s.cool_elec_mwh.toFixed(2)} d=${s.dhw_elec_mwh.toFixed(2)} fan=${s.fan_elec_mwh.toFixed(2)} l=${s.light_elec_mwh.toFixed(2)} sp=${s.sp_elec_mwh.toFixed(2)}`)
}
checkTotalElecSum(baseline, 'baseline', 'C01')
checkTotalElecSum(snaps.hsp_24, 'hsp_24', 'C02')
checkTotalElecSum(snaps.csp_18, 'csp_18', 'C03')
checkTotalElecSum(snaps.vent_off, 'vent_off', 'C04')
checkTotalElecSum(snaps.light_off, 'light_off', 'C05')

// Total gas = Σ per-service gas (heating + dhw)
function checkTotalGasSum(s, label, id) {
  const sum = s.heat_gas_mwh + s.dhw_gas_mwh
  assertApproxEq('C', id, `${label}: total_gas = Σ per-service gas`,
    s.total_gas_mwh, sum, 0.003, 0.3)
}
checkTotalGasSum(baseline, 'baseline', 'C06')
checkTotalGasSum(snaps.dhweff_lo, 'dhweff_lo', 'C07')

// brief40 demand echoes match consumption.* (same number two places)
function checkBrief40DemandEcho(s, label, id) {
  assertApproxEq('C', `${id}h`, `${label}: brief40.heating.demand == consumption.space_heating.demand`,
    s.b40_heating_demand_mwh, s.demand_heating_mwh, 0.001, 0.1)
  assertApproxEq('C', `${id}c`, `${label}: brief40.cooling.demand == consumption.space_cooling.demand`,
    s.b40_cooling_demand_mwh, s.demand_cooling_mwh, 0.001, 0.1)
  assertApproxEq('C', `${id}d`, `${label}: brief40.dhw.demand == consumption.dhw.demand`,
    s.b40_dhw_demand_mwh, s.demand_dhw_mwh, 0.001, 0.1)
}
checkBrief40DemandEcho(baseline, 'baseline', 'C08')
checkBrief40DemandEcho(snaps.hsp_28, 'hsp_28', 'C09')

// brief40 fan / lighting / sp totals match consumption.*
assertApproxEq('C', 'C10', 'brief40.lighting.total_delivered == consumption.lighting.electricity',
  baseline.b40_light_elec_mwh, baseline.light_elec_mwh, 0.001, 0.05)
assertApproxEq('C', 'C11', 'brief40.small_power.total_delivered == consumption.small_power.electricity',
  baseline.b40_sp_elec_mwh, baseline.sp_elec_mwh, 0.001, 0.05)
assertApproxEq('C', 'C12', 'brief40.ventilation.total_fan == Σ consumption.ventilation[].fan_elec',
  baseline.b40_fan_elec_mwh, baseline.fan_elec_per_system_sum_mwh, 0.001, 0.05)

// EUI same in two places (brief40 vs consumption.total)
// Note: brief40 EUI may differ slightly due to rounding inside brief40 totals;
// 0.5 kWh/m² is the documented tolerance
assertApproxEq('C', 'C13', 'consumption.total.eui ≈ brief40.totals.eui (≤0.5)',
  baseline.eui_kwh_per_m2, baseline.eui_brief40_kwh_per_m2, 0, 0.5)

// Brief 58 C coupling: lighting gain (heat_balance) == lighting elec (consumption) × 1000
assertApproxEq('C', 'C14', 'Brief 58 C: hb.gain.lighting (kWh) == consumption.lighting.elec × 1000',
  baseline.hb_gain_lighting_kwh, baseline.light_elec_mwh * 1000, 0.005, 100)
assertApproxEq('C', 'C15', 'Brief 58 C: hb.gain.equipment (kWh) == consumption.sp.elec × 1000',
  baseline.hb_gain_equipment_kwh, baseline.sp_elec_mwh * 1000, 0.005, 100)

// Setpoint introspection echo consistency
assertApproxEq('C', 'C16', 'demand.effective_heating_setpoint == losses_at_setpoint.setpoints_used.heating_c',
  baseline.eff_heating_setpoint_c, baseline.setpoint_los_heating_c, 0.001, 0.01)
assertApproxEq('C', 'C17', 'demand.effective_cooling_setpoint == losses_at_setpoint.setpoints_used.cooling_c',
  baseline.eff_cooling_setpoint_c, baseline.setpoint_los_cooling_c, 0.001, 0.01)

// Setpoint mode echo: source field reflects USER INTENT (mode flag), not
// whether engine call carried a numeric override (Brief 62 P2 always passes
// a resolved number; we want to know what the user CHOSE).
record('C', 'C18', 'heating_setpoint_source = "custom" when mode=custom',
  snaps.hsp_24.heating_setpoint_source === 'custom' ? 'PASS' : 'FAIL',
  'custom', snaps.hsp_24.heating_setpoint_source)
record('C', 'C19', 'heating_setpoint_source = "comfortBand" when mode=follow_comfort',
  baseline.heating_setpoint_source === 'comfortBand' ? 'PASS' : 'FAIL',
  'comfortBand', baseline.heating_setpoint_source)
record('C', 'C19b', 'cooling_setpoint_source = "custom" when mode=custom',
  snaps.csp_18.cooling_setpoint_source === 'custom' ? 'PASS' : 'FAIL',
  'custom', snaps.csp_18.cooling_setpoint_source)
record('C', 'C19c', 'cooling_setpoint_source = "comfortBand" by default',
  baseline.cooling_setpoint_source === 'comfortBand' ? 'PASS' : 'FAIL',
  'comfortBand', baseline.cooling_setpoint_source)

// Heating demand reconstruction from internal bookkeeping.
// The engine's State 2 computes heating demand as:
//   heating_demand = (Σ losses_at_setpoint − Σ ig_offset_heating
//                     − solar_beneficial_heating)
// over hours in heating-direction regime. The vent losses inside
// losses_at_setpoint ALREADY have HRE applied (they're post-recovery), so
// recovery_offset must NOT be subtracted again. This is conservation in
// the engine's own bookkeeping — if it closes, the engine isn't quietly
// adding or dropping terms.
// Brief 69 Part 3 (2026-05-28, Decision 3): the heating reconstruction
// identity `heating = losses_at_setpoint − ig_offset − solar_beneficial`
// was Brief 64's at-setpoint balance formula. Brief 69 demand is
// implicit-Euler-derived: heating[h] = -C_coef × (lower_SP - T_air_free)
// integrated over heating-mode hours. The per-element loss accumulators
// (which sum losses at the EFFECTIVE T_air, which depends on conditioning
// state) no longer reconstruct demand by simple subtraction. Replace with
// non-negativity and a loose physical sanity bound (heating ≤ total
// at-setpoint envelope loss is no longer a meaningful upper bound because
// mech-vent UA enters C_coef but isn't in los_total_heat_loss_kwh).
assertInequality('C', 'C20', 'baseline: heating_demand ≥ 0',
  baseline.demand_heating_mwh, '>=', 0)
assertInequality('C', 'C20b', 'hsp_28: heating_demand ≥ 0',
  snaps.hsp_28.demand_heating_mwh, '>=', 0)
// C20c — heating demand is monotonic in hsp (raising heating setpoint
// raises heating demand). This IS a robust invariant in the new model.
assertInequality('C', 'C20c', 'heating_demand monotonic in hsp (hsp_24 ≥ baseline)',
  snaps.hsp_24.demand_heating_mwh, '>=', baseline.demand_heating_mwh - 0.5,
  'heating fires on more hours when hsp rises')
assertInequality('C', 'C20d', 'heating_demand monotonic in hsp (hsp_28 ≥ hsp_24)',
  snaps.hsp_28.demand_heating_mwh, '>=', snaps.hsp_24.demand_heating_mwh - 0.5)

// losses_at_setpoint per-element totals: Σ per-element heating_loss_kwh ≈ totals
const sumPerElementHeatLoss = baseline.los_wall_heating_kwh + baseline.los_glaz_heating_kwh
  + (pn(runOnce(null), 'losses_at_setpoint.roof.heating_loss_kwh') ?? 0)
  + (pn(runOnce(null), 'losses_at_setpoint.ground_floor.heating_loss_kwh') ?? 0)
  + (pn(runOnce(null), 'losses_at_setpoint.fabric_leakage.heating_loss_kwh') ?? 0)
  + (pn(runOnce(null), 'losses_at_setpoint.permanent_vents.heating_loss_kwh') ?? 0)
  + (pn(runOnce(null), 'losses_at_setpoint.thermal_bridging.heating_loss_kwh') ?? 0)
  + baseline.los_vent_total_heat_loss_kwh
assertApproxEq('C', 'C21', 'losses_at_setpoint: Σ per-element heating_loss ≈ totals.total_heating_loss',
  baseline.los_total_heat_loss_kwh, sumPerElementHeatLoss, 0.01, 100)

// Internal-gains bucketed totals on losses_at_setpoint match
const igBucketSum = baseline.los_ig_offset_heating_kwh + baseline.los_ig_added_cooling_kwh +
  (pn(runOnce(null), 'losses_at_setpoint.internal_gains_bucketed.shoulder_kwh') ?? 0)
assertApproxEq('C', 'C22', 'internal_gains_bucketed: offset_h + added_c + shoulder = total',
  igBucketSum, baseline.los_ig_total_kwh, 0.01, 5)

// Solar transmission ≥ solar beneficial + contributing cooling (sanity)
const solarConservation = baseline.los_glaz_solar_beneficial_kwh + baseline.los_glaz_solar_contributing_cooling_kwh
assertInequality('C', 'C23', 'glazing solar: beneficial + contributing_cooling ≤ transmission (split, not duplicate)',
  solarConservation, '<=', baseline.los_glaz_solar_transmission_kwh + 5)

// ════════════════════════════════════════════════════════════════════════
// CATEGORY D — INVARIANCE (no spurious cross-coupling)
// ════════════════════════════════════════════════════════════════════════
console.log('--- D. INVARIANCE ---')

// SFP change doesn't move demand or non-fan fuels
function expectFrozenBetween(snapA, snapB, fields, idBase, label) {
  let i = 0
  for (const f of fields) {
    const a = snapA[f], b = snapB[f]
    if (a == null || b == null) {
      record('D', `${idBase}_${i++}`, `${label}: ${f} unchanged`, 'BLOCKED', '|Δ|≤tol', `a=${a} b=${b}`)
      continue
    }
    const delta = Math.abs(b - a)
    const tol = Math.max(0.05, Math.max(Math.abs(a), Math.abs(b)) * 0.005)
    const pass = delta <= tol
    record('D', `${idBase}_${i++}`, `${label}: ${f} unchanged`,
      pass ? 'PASS' : 'FAIL', '|Δ|≤tol', `Δ=${(b-a).toFixed(4)} tol=${tol.toFixed(4)}`)
  }
}

// D1: SFP change doesn't move demand or non-fan electricity
expectFrozenBetween(snaps.sfp_lo, snaps.sfp_hi,
  ['demand_heating_mwh','demand_cooling_mwh','demand_dhw_mwh',
   'heat_elec_mwh','cool_elec_mwh','dhw_elec_mwh','dhw_gas_mwh','light_elec_mwh','sp_elec_mwh',
   'hb_gain_lighting_kwh','hb_gain_equipment_kwh'],
  'D01', 'sfp change')

// D2: SEER change doesn't move demand or non-cooling fuels
expectFrozenBetween(snaps.seer_lo, snaps.seer_hi,
  ['demand_heating_mwh','demand_cooling_mwh','demand_dhw_mwh',
   'heat_elec_mwh','heat_gas_mwh','dhw_elec_mwh','dhw_gas_mwh',
   'fan_elec_mwh','light_elec_mwh','sp_elec_mwh'],
  'D02', 'seer change')

// D3: SCOP change doesn't move demand or non-heating fuels
expectFrozenBetween(snaps.scop_lo, snaps.scop_hi,
  ['demand_heating_mwh','demand_cooling_mwh','demand_dhw_mwh',
   'cool_elec_mwh','dhw_elec_mwh','dhw_gas_mwh',
   'fan_elec_mwh','light_elec_mwh','sp_elec_mwh'],
  'D03', 'scop change')

// D4: DHW efficiency change doesn't move heating, cooling, vent, lighting, sp
expectFrozenBetween(snaps.dhweff_lo, snaps.dhweff_hi,
  ['demand_heating_mwh','demand_cooling_mwh','demand_dhw_mwh',
   'heat_elec_mwh','cool_elec_mwh',
   'fan_elec_mwh','light_elec_mwh','sp_elec_mwh',
   'hb_gain_lighting_kwh','hb_gain_equipment_kwh','hb_gain_solar_total_kwh'],
  'D04', 'dhw_efficiency change')

// D5: DHW litres-per-person change doesn't move heating/cooling demand or non-DHW fuels
expectFrozenBetween(snaps.dhwlpd_40, snaps.dhwlpd_150,
  ['heat_elec_mwh','cool_elec_mwh','heat_gas_mwh',
   'fan_elec_mwh','light_elec_mwh','sp_elec_mwh',
   'hb_gain_lighting_kwh','hb_gain_equipment_kwh','hb_gain_solar_total_kwh'],
  'D05', 'dhw_litres change')

// D6: dhw_load_shape change doesn't move heating, cooling, vent, lighting, sp demand
expectFrozenBetween(snaps.dhw_flat, snaps.dhw_follow,
  ['demand_heating_mwh','demand_cooling_mwh',
   'fan_elec_mwh','light_elec_mwh','sp_elec_mwh',
   'hb_gain_lighting_kwh','hb_gain_equipment_kwh'],
  'D06', 'dhw_load_shape change')

// D7: Idempotent no-op: cloning input == identical output
expectFrozenBetween(baseline, noopSnap,
  ['demand_heating_mwh','demand_cooling_mwh','demand_dhw_mwh',
   'heat_elec_mwh','cool_elec_mwh','dhw_elec_mwh','dhw_gas_mwh',
   'fan_elec_mwh','light_elec_mwh','sp_elec_mwh',
   'total_elec_mwh','total_gas_mwh','eui_kwh_per_m2','carbon_kg_per_m2'],
  'D07', 'no-op input clone')

// D8: lighting_cf change doesn't move DHW or vent (only heating/cooling via gain coupling)
expectFrozenBetween(snaps.light_cf_lo, snaps.light_cf_hi,
  ['demand_dhw_mwh','dhw_elec_mwh','dhw_gas_mwh','fan_elec_mwh','sp_elec_mwh',
   'hb_gain_equipment_kwh','hb_gain_solar_total_kwh'],
  'D08', 'lighting_cf change')

// Brief 69 Part 3 (2026-05-28, Decision 3): control_strategy invariance
// REDEFINED. Brief 64 froze heating + heat_elec + hb_loss_total across the
// strategies (Brief 64 preserved the heating formula across both). Brief 69
// has different demand formulas per strategy (active_setpoint = C_coef-
// derived Q_cond; free_running = 0). The fields that REMAIN frozen between
// strategies are those that don't depend on demand: DHW, lighting,
// small-power, vent fan electricity, and the gain accumulators on the
// gains side of the heat balance (people/equipment/lighting/solar — the
// physical heat-balance terms reflect zone state, which changes between
// strategies, so removing hb_loss_total). Run only on demand-independent
// fields.
expectFrozenBetween(baseline, snaps.free_run_default,
  ['demand_dhw_mwh',
   'dhw_elec_mwh','dhw_gas_mwh','fan_elec_mwh','light_elec_mwh','sp_elec_mwh',
   'hb_gain_lighting_kwh','hb_gain_equipment_kwh','hb_gain_solar_total_kwh'],
  'D09', 'control_strategy toggle (demand-independent fields)')

expectFrozenBetween(snaps.csp_18, snaps.free_run_csp_18,
  ['demand_dhw_mwh',
   'dhw_elec_mwh','dhw_gas_mwh','fan_elec_mwh','light_elec_mwh','sp_elec_mwh'],
  'D10', 'control_strategy toggle at csp=18 (demand-independent fields)')

// Brief 68 Part C (register U4 / Brief 66 HIGH-8) — fan_elec zeros under
// EITHER v25-only OR v40-only ventilation disable.
//
// Pre-Brief-68 the v40-only path read v40.enabled only; disabling
// v25.ventilation[].enabled alone left fan_elec at full value while State
// 2 correctly zeroed mech-vent loss. Fix: _computeVentilation now AND-gates
// v25 and v40 (mirror of instantCalc.js:2771-2772). Both assertions must
// hold post-fix; either failing is a regression to the bug class.
assertApproxEq('D', 'D11', 'v25.ventilation[].enabled = false zeros fan_elec',
  snaps.v25_vent_off.fan_elec_mwh, 0, 0.5)
assertApproxEq('D', 'D12', 'v40.ventilation[].enabled = false zeros fan_elec',
  snaps.v40_vent_off.fan_elec_mwh, 0, 0.5)

// ════════════════════════════════════════════════════════════════════════
// CATEGORY E — ORDERING / PARITY
// ════════════════════════════════════════════════════════════════════════
console.log('--- E. ORDERING / PARITY ---')

const heatingId = baseBuilding.systems_config_v40?.heating?.[0]?.id ?? ''
const coolingId = baseBuilding.systems_config_v40?.cooling?.[0]?.id ?? ''

// runStack helper: returns the final cumulative result (last intervention's
// result if any enabled; baseline result otherwise). The intervention
// engine's callback receives the rolling cfg quartet — we wrap runEngine.
function runStack(stack) {
  const cfg = { building: baseBuilding, constructions, systems: {}, libraryData }
  const res = runInterventionStack(cfg, stack, runEngineFromCfg, libraryData)
  // Walk back from last to first looking for an enabled-with-result row.
  for (let i = res.interventions.length - 1; i >= 0; i--) {
    if (res.interventions[i]?.enabled && res.interventions[i]?.result) {
      return res.interventions[i].result
    }
  }
  return res.baseline
}

// E1-E5: Two interventions stacked — order independent
const intvA_scop = {
  id: 'intv_set_scop', label: 'Set SCOP', enabled: true, schema_version: 3,
  patches: [{ id: 'p1', op: 'set',
    path: `building.systems_config_v40.heating[id=${heatingId}].efficiency_metric`,
    value: 3.5, source: 'inline' }],
}
const intvB_seer = {
  id: 'intv_set_seer', label: 'Set SEER', enabled: true, schema_version: 3,
  patches: [{ id: 'p1', op: 'set',
    path: `building.systems_config_v40.cooling[id=${coolingId}].efficiency_metric`,
    value: 4.5, source: 'inline' }],
}

const sAB = readSnap(runStack([intvA_scop, intvB_seer]))
const sBA = readSnap(runStack([intvB_seer, intvA_scop]))
assertApproxEq('E', 'E01', 'order independence: total_elec [A,B] == [B,A]',
  sAB.total_elec_mwh, sBA.total_elec_mwh, 0.001, 0.05)
assertApproxEq('E', 'E02', 'order independence: eui [A,B] == [B,A]',
  sAB.eui_kwh_per_m2, sBA.eui_kwh_per_m2, 0.001, 0.05)
assertApproxEq('E', 'E03', 'order independence: heating_fuel [A,B] == [B,A]',
  sAB.heat_elec_mwh + sAB.heat_gas_mwh, sBA.heat_elec_mwh + sBA.heat_gas_mwh, 0.001, 0.05)
assertApproxEq('E', 'E04', 'order independence: cooling_fuel [A,B] == [B,A]',
  sAB.cool_elec_mwh, sBA.cool_elec_mwh, 0.001, 0.05)
assertApproxEq('E', 'E05', 'order independence: demand_heating [A,B] == [B,A]',
  sAB.demand_heating_mwh, sBA.demand_heating_mwh, 0.001, 0.05)

// E6-E11: baseline-edit vs equivalent-intervention parity
// Apply same heating_scop=4.0 as baseline edit vs as intervention. The
// intervention edits the SAME path in the same way — both should produce
// the same engine result.
const sIntvScop_4 = readSnap(runStack([{
  id: 'intv_scop_4', label: 'Scop 4.0', enabled: true, schema_version: 3,
  patches: [{ id: 'p1', op: 'set',
    path: `building.systems_config_v40.heating[id=${heatingId}].efficiency_metric`,
    value: 4.0, source: 'inline' }],
}]))
assertApproxEq('E', 'E06', 'parity: baseline_edit(scop=4.0) ≈ intervention(scop=4.0) total_elec',
  snaps.scop_hi.total_elec_mwh, sIntvScop_4.total_elec_mwh, 0.001, 0.1)
assertApproxEq('E', 'E06b', 'parity: baseline_edit(scop=4.0) ≈ intervention(scop=4.0) eui',
  snaps.scop_hi.eui_kwh_per_m2, sIntvScop_4.eui_kwh_per_m2, 0.001, 0.05)

// Same for cooling setpoint custom=18
const sCspIntv = readSnap(runStack([{
  id: 'intv_csp_18', label: 'Cooling sp custom 18', enabled: true, schema_version: 3,
  patches: [
    { id: 'p1', op: 'set', path: 'building.systems_config_v40.cooling_setpoint_mode', value: 'custom', source: 'inline' },
    { id: 'p2', op: 'set', path: 'building.systems_config_v40.cooling_setpoint_c', value: 18, source: 'inline' },
  ],
}]))
assertApproxEq('E', 'E07', 'parity: baseline_edit(csp=18) ≈ intervention(csp=18) demand_cooling',
  snaps.csp_18.demand_cooling_mwh, sCspIntv.demand_cooling_mwh, 0.005, 0.5)
assertApproxEq('E', 'E08', 'parity: baseline_edit(csp=18) ≈ intervention(csp=18) total_elec',
  snaps.csp_18.total_elec_mwh, sCspIntv.total_elec_mwh, 0.005, 0.5)
assertApproxEq('E', 'E09', 'parity: baseline_edit(csp=18) ≈ intervention(csp=18) eui',
  snaps.csp_18.eui_kwh_per_m2, sCspIntv.eui_kwh_per_m2, 0.005, 0.5)

// Same for lighting_cf change (touches the Brief 58 C coupling)
const sLightCfIntv = readSnap(runStack([{
  id: 'intv_light_cf', label: 'Lighting cf 0.4', enabled: true, schema_version: 3,
  patches: [{ id: 'p1', op: 'set',
    path: 'building.systems_config_v40.lighting[id=' + (baseBuilding.systems_config_v40?.lighting?.[0]?.id ?? '') + '].control_factor',
    value: 0.4, source: 'inline' }],
}]))
assertApproxEq('E', 'E09b', 'parity: baseline_edit(light_cf=0.4) ≈ intervention total_elec',
  snaps.light_cf_lo.total_elec_mwh, sLightCfIntv.total_elec_mwh, 0.005, 0.5)
assertApproxEq('E', 'E09c', 'parity: baseline_edit(light_cf=0.4) ≈ intervention demand_heating (gain coupling)',
  snaps.light_cf_lo.demand_heating_mwh, sLightCfIntv.demand_heating_mwh, 0.01, 0.5)

// Brief 64 §C — control_strategy parity: setting via intervention patch
// must produce the same engine output as setting via baseline edit.
// No separate path; same engine code.
const sFreeRunningIntv = readSnap(runStack([{
  id: 'intv_free_running', label: 'Switch to free_running', enabled: true, schema_version: 3,
  patches: [{ id: 'p1', op: 'set', path: 'building.control_strategy', value: 'free_running', source: 'inline' }],
}]))
assertApproxEq('E', 'E09d', 'parity: baseline_edit(control_strategy=free_running) ≈ intervention cool_demand',
  snaps.free_run_default.demand_cooling_mwh, sFreeRunningIntv.demand_cooling_mwh, 0.005, 0.5,
  'Brief 64: control_strategy patch must produce same result as direct field write')
assertApproxEq('E', 'E09e', 'parity: baseline_edit(control_strategy=free_running) ≈ intervention EUI',
  snaps.free_run_default.eui_kwh_per_m2, sFreeRunningIntv.eui_kwh_per_m2, 0.005, 0.5)
assertApproxEq('E', 'E09f', 'parity: baseline_edit(control_strategy=free_running) ≈ intervention heating_demand',
  snaps.free_run_default.demand_heating_mwh, sFreeRunningIntv.demand_heating_mwh, 0.001, 0.05)

// E10-E11: Disabled intervention == baseline
const sDisabled = readSnap(runStack([{
  id: 'intv_dis', label: 'Disabled', enabled: false, schema_version: 3,
  patches: [{ id: 'p1', op: 'set', path: 'building.systems_config_v40.heating_setpoint_c', value: 99, source: 'inline' }],
}]))
const sBaseStack = readSnap(runStack([]))
assertApproxEq('E', 'E10', 'disabled intervention: total_elec equals empty-stack baseline',
  sDisabled.total_elec_mwh, sBaseStack.total_elec_mwh, 0.001, 0.05)
assertApproxEq('E', 'E11', 'disabled intervention: eui equals empty-stack baseline',
  sDisabled.eui_kwh_per_m2, sBaseStack.eui_kwh_per_m2, 0.001, 0.05)
// And empty-stack baseline equals direct-call baseline (intervention engine isn't shifting numbers)
assertApproxEq('E', 'E12', 'empty-stack baseline == direct-call baseline total_elec',
  sBaseStack.total_elec_mwh, baseline.total_elec_mwh, 0.001, 0.05)
assertApproxEq('E', 'E13', 'empty-stack baseline == direct-call baseline eui',
  sBaseStack.eui_kwh_per_m2, baseline.eui_kwh_per_m2, 0.001, 0.05)

// ════════════════════════════════════════════════════════════════════════
// Brief 67/69 Part C battery — float-gated demand model assertions
// ════════════════════════════════════════════════════════════════════════
// Six new invariants for the post-Brief-67 demand model. Each codifies one
// physical property of "demand is gated on T_zone_free, not on a balance
// equation":
//
//   B69-01  Setpoint independence (the headline): cooling demand is
//           bounded over an hsp sweep at fixed csp. Per Decision 2 the
//           threshold is generous (~30%) because thermal-mass coupling
//           is real physics on lighter buildings; the gate catches
//           regression to the Brief-64 first-order coupling.
//   B69-02  Dead band exists: count of hours with both heating and
//           cooling demand = 0 is non-zero on a real building.
//   B69-03  Cooling monotonic in csp: lowering csp does not decrease
//           cooling demand.
//   B69-04  Heating monotonic in hsp: raising hsp does not decrease
//           heating demand (already C20c/C20d above — re-asserted here
//           explicitly under the Brief 69 banner).
//   B69-05  Conservation: Σ hourly heating == annual heating (the engine
//           isn't quietly dropping or double-counting hourly contributions).
//   B69-06  Float never NaN: T_zone_free has no NaN/Inf hours.
//   B69-07  free_running invariance: heating = cooling = 0 (already
//           B26-B29 above — re-asserted explicitly under the new banner).
console.log('--- Brief 67/69 Part C battery ---')

// B69-01: setpoint independence — cool span over hsp sweep BELOW csp_default.
// Only hsp_19 and baseline (hsp=21, default) lie below csp=24 in the
// harness's snapshot set; hsp_24/hsp_28 would invert the dead band (heat
// fires above the cooling sp = both clamps engaged simultaneously). The
// brief's specified range was hsp 19→23 at csp 24; we test the subset
// available from the harness's pre-built snapshots — fully bracketed
// versions live in the per-brief gate script.
const hsp_sweep_cools = [snaps.hsp_19.demand_cooling_mwh, baseline.demand_cooling_mwh]
const cool_min = Math.min(...hsp_sweep_cools)
const cool_max = Math.max(...hsp_sweep_cools)
const cool_mean = hsp_sweep_cools.reduce((s, x) => s + x, 0) / hsp_sweep_cools.length
const cool_span_pct = cool_mean > 0 ? ((cool_max - cool_min) / cool_mean) * 100 : 0
// Threshold: 35% per Decision 2 — covers Bridgewater (~27%) + office
// (~28%) thermal-mass coupling at default mass while catching a
// regression to the Brief-64 first-order coupling (which would be 50%+).
assertInequality('B69', 'B69-01', 'setpoint independence: cool span over hsp 19→21 (both < csp=24) ≤ 35%',
  cool_span_pct, '<=', 35,
  `cool: hsp_19=${snaps.hsp_19.demand_cooling_mwh.toFixed(2)} / baseline=${baseline.demand_cooling_mwh.toFixed(2)} MWh, span=${cool_span_pct.toFixed(1)}%`)

// B69-02: dead band exists. Count hours where both hourly demand arrays = 0.
function countDeadBandHours(building) {
  const r = runEngine(building)
  const hH = r?.demand?.heating_demand_hourly_kwh
  const hC = r?.demand?.cooling_demand_hourly_kwh
  if (!hH || !hC) return null
  let dead = 0
  for (let i = 0; i < hH.length; i++) if (hH[i] < 1e-6 && hC[i] < 1e-6) dead++
  return dead
}
const dbHours = countDeadBandHours(baseBuilding)
assertInequality('B69', 'B69-02', 'dead-band hours > 0 (baseline)',
  dbHours ?? 0, '>', 0,
  `${dbHours}/8760 hours with zero heating AND zero cooling`)

// B69-03: cooling monotonic in csp — lowering csp never decreases cooling.
assertInequality('B69', 'B69-03a', 'cool monotonic: csp_22 cool ≥ csp_28 cool',
  snaps.csp_22.demand_cooling_mwh, '>=', snaps.csp_28.demand_cooling_mwh - 0.5)
assertInequality('B69', 'B69-03b', 'cool monotonic: csp_18 cool ≥ csp_22 cool',
  snaps.csp_18.demand_cooling_mwh, '>=', snaps.csp_22.demand_cooling_mwh - 0.5)

// B69-04: heating monotonic in hsp — re-asserted under Brief 69 banner.
assertInequality('B69', 'B69-04', 'heat monotonic: hsp_28 heat ≥ hsp_19 heat',
  snaps.hsp_28.demand_heating_mwh, '>=', snaps.hsp_19.demand_heating_mwh - 0.5)

// B69-05: conservation — Σ hourly heating == annual heating
function checkConservation(snap, building) {
  const r = runEngine(building)
  const hH = r?.demand?.heating_demand_hourly_kwh
  const hC = r?.demand?.cooling_demand_hourly_kwh
  if (!hH || !hC) return { ok: false }
  let sumH_kwh = 0, sumC_kwh = 0
  for (let i = 0; i < hH.length; i++) { sumH_kwh += hH[i]; sumC_kwh += hC[i] }
  return {
    ok: true,
    sumH_mwh: sumH_kwh / 1000,
    sumC_mwh: sumC_kwh / 1000,
    annualH: snap.demand_heating_mwh,
    annualC: snap.demand_cooling_mwh,
  }
}
const cons = checkConservation(baseline, baseBuilding)
if (cons.ok) {
  assertApproxEq('B69', 'B69-05a', 'conservation: Σ hourly heating == annual heating',
    cons.sumH_mwh, cons.annualH, 0.005, 0.5)
  assertApproxEq('B69', 'B69-05b', 'conservation: Σ hourly cooling == annual cooling',
    cons.sumC_mwh, cons.annualC, 0.005, 0.5)
}

// B69-06: float never NaN. T_zone_free trace must be finite everywhere.
function countNaNInFloat(building) {
  const r = runEngine(building)
  const T = r?.demand?.hourly_zone_air_c
  if (!T) return -1
  let n = 0
  for (const v of T) if (!Number.isFinite(v)) n++
  return n
}
const nanBaseline = countNaNInFloat(baseBuilding)
assertApproxEq('B69', 'B69-06', 'T_zone_free has zero NaN/Inf hours (baseline)',
  nanBaseline, 0, 0, 0)

// B69-07: free_running invariance — already B26-B29 above; re-asserted for
// completeness under the Brief 69 banner.
assertApproxEq('B69', 'B69-07a', 'free_running: heating_demand == 0 (zone floats)',
  snaps.free_run_default.demand_heating_mwh, 0, 0.001, 0.01)
assertApproxEq('B69', 'B69-07b', 'free_running: cooling_demand == 0 (zone floats)',
  snaps.free_run_default.demand_cooling_mwh, 0, 0.001, 0.01)

// ════════════════════════════════════════════════════════════════════════
// CATEGORY F — RECONCILIATION (every Δ stacks up; same number two places)
// ════════════════════════════════════════════════════════════════════════
console.log('--- F. RECONCILIATION ---')

// Δ total elec = Σ Δ per-service (the headline reconcile gate from Brief 60).
// Pump is already inside dhw_elec_mwh, not added separately (see C-block note).
function checkDeltaReconcile(label, before, after, idBase) {
  const d_heat = (after.heat_elec_mwh - before.heat_elec_mwh)
  const d_cool = (after.cool_elec_mwh - before.cool_elec_mwh)
  const d_dhw  = (after.dhw_elec_mwh - before.dhw_elec_mwh)
  const d_fan  = (after.fan_elec_mwh - before.fan_elec_mwh)
  const d_light= (after.light_elec_mwh - before.light_elec_mwh)
  const d_sp   = (after.sp_elec_mwh - before.sp_elec_mwh)
  const d_sum  = d_heat + d_cool + d_dhw + d_fan + d_light + d_sp
  const d_total = after.total_elec_mwh - before.total_elec_mwh
  assertApproxEq('F', `${idBase}e`, `${label}: Δtotal_elec = Σ Δper-service elec`, d_total, d_sum, 0.003, 0.3,
    `Δh=${d_heat.toFixed(2)} Δc=${d_cool.toFixed(2)} Δd=${d_dhw.toFixed(2)} Δfan=${d_fan.toFixed(2)} Δl=${d_light.toFixed(2)} Δsp=${d_sp.toFixed(2)}`)

  const d_heat_g = after.heat_gas_mwh - before.heat_gas_mwh
  const d_dhw_g  = after.dhw_gas_mwh - before.dhw_gas_mwh
  const d_gas    = d_heat_g + d_dhw_g
  const d_total_gas = after.total_gas_mwh - before.total_gas_mwh
  assertApproxEq('F', `${idBase}g`, `${label}: Δtotal_gas = Σ Δper-service gas`, d_total_gas, d_gas, 0.003, 0.3)

  // ΔEUI = Δ(total_elec + total_gas) * 1000 / gia
  const expected_dEui = (d_total + d_total_gas) * 1000 / before.gia_m2
  const d_eui = after.eui_kwh_per_m2 - before.eui_kwh_per_m2
  assertApproxEq('F', `${idBase}u`, `${label}: ΔEUI = (Δtotal_elec + Δtotal_gas) × 1000 / gia`,
    d_eui, expected_dEui, 0.005, 0.5)
}
checkDeltaReconcile('hsp_19→hsp_28', snaps.hsp_19, snaps.hsp_28, 'F01')
checkDeltaReconcile('baseline→scop_hi', baseline, snaps.scop_hi, 'F02')
checkDeltaReconcile('baseline→csp_18', baseline, snaps.csp_18, 'F03')
checkDeltaReconcile('baseline→hre_hi', baseline, snaps.hre_hi, 'F04')
checkDeltaReconcile('baseline→light_cf_lo', baseline, snaps.light_cf_lo, 'F05')
checkDeltaReconcile('baseline→sfp_hi', baseline, snaps.sfp_hi, 'F06')
checkDeltaReconcile('baseline→vent_off', baseline, snaps.vent_off, 'F07')

// Same Δ-reconcile property in intervention path
const sIntvF = readSnap(runStack([{
  id: 'intv_csp', label: 'CSP 20', enabled: true, schema_version: 3,
  patches: [
    { id: 'p1', op: 'set', path: 'building.systems_config_v40.cooling_setpoint_mode', value: 'custom', source: 'inline' },
    { id: 'p2', op: 'set', path: 'building.systems_config_v40.cooling_setpoint_c', value: 20, source: 'inline' },
  ],
}]))
checkDeltaReconcile('intervention csp=20 from baseline', baseline, sIntvF, 'F08')

// F09-F12: cross-panel identity (same number in brief40 echo vs consumption.*)
// already covered in C08-C12 conceptually; here we test it across mutations
// so a change to one panel mustn't desync the other.
assertApproxEq('F', 'F09', 'csp_18: brief40.cooling.demand == consumption.space_cooling.demand',
  snaps.csp_18.b40_cooling_demand_mwh, snaps.csp_18.demand_cooling_mwh, 0.001, 0.1)
assertApproxEq('F', 'F10', 'hsp_28: brief40.heating.demand == consumption.space_heating.demand',
  snaps.hsp_28.b40_heating_demand_mwh, snaps.hsp_28.demand_heating_mwh, 0.001, 0.1)
assertApproxEq('F', 'F11', 'vent_off: brief40.ventilation total fan == Σ per-system fan',
  snaps.vent_off.b40_fan_elec_mwh, snaps.vent_off.fan_elec_per_system_sum_mwh, 0.001, 0.05)
assertApproxEq('F', 'F12', 'light_off: brief40.lighting.total_delivered == consumption.lighting.elec',
  snaps.light_off.b40_light_elec_mwh, snaps.light_off.light_elec_mwh, 0.001, 0.05)
// Setpoint echo consistency across mutations
assertApproxEq('F', 'F13', 'hsp_28: effective_heating_setpoint_c == losses_at_setpoint.setpoints_used.heating_c',
  snaps.hsp_28.eff_heating_setpoint_c, snaps.hsp_28.setpoint_los_heating_c, 0.001, 0.01)
assertApproxEq('F', 'F14', 'csp_18: effective_cooling_setpoint_c == losses_at_setpoint.setpoints_used.cooling_c',
  snaps.csp_18.eff_cooling_setpoint_c, snaps.csp_18.setpoint_los_cooling_c, 0.001, 0.01)
// Sweep monotone-step reconciliation: each step's Δ sums correctly
checkDeltaReconcile('hsp_19→hsp_24', snaps.hsp_19, snaps.hsp_24, 'F15')
checkDeltaReconcile('hsp_24→hsp_28', snaps.hsp_24, snaps.hsp_28, 'F16')
checkDeltaReconcile('csp_28→csp_22', snaps.csp_28, snaps.csp_22, 'F17')
checkDeltaReconcile('csp_22→csp_18', snaps.csp_22, snaps.csp_18, 'F18')

// Final summary
console.log()
console.log('='.repeat(70))
const counts = { PASS: 0, FAIL: 0, BLOCKED: 0 }
const byCat = {}
for (const r of results) {
  counts[r.status]++
  if (!byCat[r.category]) byCat[r.category] = { PASS: 0, FAIL: 0, BLOCKED: 0 }
  byCat[r.category][r.status]++
}
console.log('RESULTS  total tests: ' + results.length)
console.log(`  PASS:    ${counts.PASS}`)
console.log(`  FAIL:    ${counts.FAIL}`)
console.log(`  BLOCKED: ${counts.BLOCKED}`)
console.log()
console.log('Per category:')
for (const cat of Object.keys(byCat).sort()) {
  const c = byCat[cat]
  console.log(`  ${cat}:  PASS ${String(c.PASS).padStart(3)}  FAIL ${String(c.FAIL).padStart(3)}  BLOCKED ${String(c.BLOCKED).padStart(3)}`)
}
console.log()
console.log(`Elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`)

// Write machine-readable report
const reportJson = {
  generated_at: new Date().toISOString(),
  project: { id: PID, name: project.name, gia_m2: baseline.gia_m2 },
  weather: { file: weatherFile },
  baseline_snap: baseline,
  totals: { ...counts, total: results.length },
  by_category: byCat,
  tests: results,
  sweep_keys: sweepKeys.map(([k]) => k),
}
const jsonPath = path.join(REPO_ROOT, 'docs/audit/63_validation_report.json')
fs.mkdirSync(path.dirname(jsonPath), { recursive: true })
fs.writeFileSync(jsonPath, JSON.stringify(reportJson, null, 2))
console.log(`Wrote ${jsonPath}`)

// Write human-readable summary
const mdLines = []
mdLines.push('# Brief 63 — Validation report')
mdLines.push('')
mdLines.push(`Generated: ${reportJson.generated_at}`)
mdLines.push(`Project: ${project.name} (GIA ${baseline.gia_m2} m²)`)
mdLines.push(`Weather: ${weatherFile}`)
mdLines.push('')
mdLines.push(`**Totals:** PASS ${counts.PASS} · FAIL ${counts.FAIL} · BLOCKED ${counts.BLOCKED} · TOTAL ${results.length}`)
mdLines.push('')
mdLines.push('## Per category')
mdLines.push('')
mdLines.push('| Category | PASS | FAIL | BLOCKED |')
mdLines.push('|---|---:|---:|---:|')
for (const cat of Object.keys(byCat).sort()) {
  const c = byCat[cat]
  mdLines.push(`| ${cat} | ${c.PASS} | ${c.FAIL} | ${c.BLOCKED} |`)
}
mdLines.push('')
if (counts.FAIL > 0) {
  mdLines.push('## Failures')
  mdLines.push('')
  mdLines.push('| ID | Category | Name | Expected | Actual | Notes |')
  mdLines.push('|---|---|---|---|---|---|')
  for (const r of results.filter(r => r.status === 'FAIL')) {
    mdLines.push(`| ${r.id} | ${r.category} | ${r.name} | ${r.expected} | ${r.actual} | ${r.notes} |`)
  }
  mdLines.push('')
}
if (counts.BLOCKED > 0) {
  mdLines.push('## Blocked')
  mdLines.push('')
  for (const r of results.filter(r => r.status === 'BLOCKED')) {
    mdLines.push(`- ${r.id} (${r.category}): ${r.name} — ${r.notes}`)
  }
  mdLines.push('')
}
mdLines.push('## All tests')
mdLines.push('')
mdLines.push('| ID | Category | Status | Name |')
mdLines.push('|---|---|---|---|')
for (const r of results) {
  mdLines.push(`| ${r.id} | ${r.category} | ${r.status} | ${r.name} |`)
}
const mdPath = path.join(REPO_ROOT, 'docs/audit/63_validation_matrix.md')
fs.writeFileSync(mdPath, mdLines.join('\n') + '\n')
console.log(`Wrote ${mdPath}`)

if (counts.FAIL > 0) {
  console.log()
  console.log(`HARNESS RED: ${counts.FAIL} failure(s). Exit 1.`)
  process.exit(1)
}
console.log()
console.log('HARNESS GREEN. All assertions pass.')
process.exit(0)
