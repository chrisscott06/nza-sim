/**
 * scripts/_brief61_consistency_sweep.mjs
 *
 * Brief 61 — Engine source-consistency audit (READ-ONLY DIAGNOSTIC).
 *
 * Sweeps every Systems-module input across 2-3 values, runs the engine
 * on Bridgewater, and records for each:
 *
 *   - DEMAND        (consumption.space_*.demand_mwh, consumption.dhw.demand_mwh)
 *   - DELIVERED     (consumption.space_*.delivered_mwh, consumption.dhw.delivered_mwh)
 *   - FUEL          (consumption.{service}.{electricity,gas}_mwh)
 *   - HEAT BALANCE  (heat_balance.annual.losses + gains, mech_vent integrals)
 *   - TOTALS        (consumption.total.electricity_mwh, gas_mwh, kwh_per_m2_yr)
 *   - PARITY        (baseline edit vs equivalent intervention — same after-stack
 *                    cumulative result?)
 *
 * Output: docs/audit/61_consistency_sweep.json (machine-readable; the matrix
 *         + grouped findings are written separately into 61_consistency_matrix.md
 *         by the architect from this trace).
 *
 * READ-ONLY. No engine touches. The probe just observes.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const API = 'http://127.0.0.1:8003'
const PID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
async function fj(u) { const r = await fetch(u); return r.json() }

const project = await fj(`${API}/api/projects/${PID}`)
const lib = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []
const constructions = project.construction_choices
const baseBuilding = JSON.parse(JSON.stringify(project.building_config))
const comfortBand = { lower_c: project.comfort_band_lower_c ?? 20, upper_c: project.comfort_band_upper_c ?? 26 }

const weatherFile = baseBuilding.weather_file || project.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month=new Int8Array(N), day=new Int8Array(N), hour=new Int8Array(N)
const temperature=new Float32Array(N), direct_normal=new Float32Array(N)
const diffuse_horizontal=new Float32Array(N), wind_speed=new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i]=parseInt(p[1]); day[i]=parseInt(p[2]); hour[i]=parseInt(p[3])
  temperature[i]=parseFloat(p[6]); direct_normal[i]=parseFloat(p[14])
  diffuse_horizontal[i]=parseFloat(p[15]); wind_speed[i]=parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, Number(baseBuilding.orientation ?? 0))
const libraryData = {
  constructions: libArr.map(c => ({ name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K, y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0, g_value: c.config_json?.g_value, config_json: c.config_json ?? c, layers: c.layers })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
}

function pn(r, p) { let c = r; for (const s of p.split('.')) { if (c == null) return null; c = c[s] } return (typeof c === 'number' && Number.isFinite(c)) ? c : null }

function readSnapshot(r) {
  return {
    // Demand-side (State 2 OUTPUT)
    demand_heating_mwh: pn(r, 'consumption.space_heating.demand_mwh'),
    demand_cooling_mwh: pn(r, 'consumption.space_cooling.demand_mwh'),
    demand_dhw_mwh:     pn(r, 'consumption.dhw.demand_mwh'),
    // Delivered (post-systems)
    delivered_heating_mwh: pn(r, 'consumption.space_heating.delivered_mwh'),
    delivered_cooling_mwh: pn(r, 'consumption.space_cooling.delivered_mwh'),
    delivered_dhw_mwh:     pn(r, 'consumption.dhw.delivered_mwh'),
    // Fuel per service
    heat_elec_mwh: pn(r, 'consumption.space_heating.electricity_mwh') ?? 0,
    heat_gas_mwh:  pn(r, 'consumption.space_heating.gas_mwh') ?? 0,
    cool_elec_mwh: pn(r, 'consumption.space_cooling.electricity_mwh') ?? 0,
    dhw_elec_mwh:  pn(r, 'consumption.dhw.electricity_mwh') ?? 0,
    dhw_gas_mwh:   pn(r, 'consumption.dhw.gas_mwh') ?? 0,
    fan_elec_mwh:  pn(r, 'consumption.brief40.ventilation.total_fan_electrical_mwh') ?? 0,
    light_elec_mwh: pn(r, 'consumption.brief40.lighting.total_delivered_electrical_mwh') ?? 0,
    sp_elec_mwh:   pn(r, 'consumption.brief40.small_power.total_delivered_electrical_mwh') ?? 0,
    // Totals
    total_elec_mwh: pn(r, 'consumption.total.electricity_mwh'),
    total_gas_mwh:  pn(r, 'consumption.total.gas_mwh'),
    eui_kwh_per_m2: pn(r, 'consumption.total.kwh_per_m2_yr'),
    carbon_kg_per_m2: pn(r, 'carbon_kg_co2_per_m2'),
    // Heat balance — losses + gains (State 2 OUTPUT)
    hb_loss_external_wall_mwh: (pn(r, 'heat_balance.annual.losses.external_wall.kwh') ?? 0) / 1000,
    hb_loss_glazing_mwh:       (pn(r, 'heat_balance.annual.losses.glazing.kwh') ?? 0) / 1000,
    hb_loss_fabric_leakage_mwh:(pn(r, 'heat_balance.annual.losses.fabric_leakage.kwh') ?? 0) / 1000,
    hb_loss_permanent_vents_mwh:(pn(r, 'heat_balance.annual.losses.permanent_vents.kwh') ?? 0) / 1000,
    hb_gain_lighting_mwh:      (pn(r, 'heat_balance.annual.gains.internal.lighting.kwh') ?? 0) / 1000,
    hb_gain_equipment_mwh:     (pn(r, 'heat_balance.annual.gains.internal.equipment.kwh') ?? 0) / 1000,
    hb_gain_people_mwh:        (pn(r, 'heat_balance.annual.gains.internal.people.kwh') ?? 0) / 1000,
    hb_gain_solar_mwh:         (pn(r, 'heat_balance.annual.gains.solar.total_kwh') ?? 0) / 1000,
    // Per-system mech vent integrals (State 2 OUTPUT)
    vent_heat_loss_mvhr_kwh:     pn(r, 'losses_at_setpoint.ventilation.0.heat_loss_kwh'),
    vent_heat_loss_bedroom_kwh:  pn(r, 'losses_at_setpoint.ventilation.1.heat_loss_kwh'),
    vent_heat_loss_toilet_kwh:   pn(r, 'losses_at_setpoint.ventilation.2.heat_loss_kwh'),
    vent_fan_mvhr_kwh:           pn(r, 'losses_at_setpoint.ventilation.0.fan_kwh'),
    // State 2 occupancy (per Brief 58 B3 + B4)
    state2_avg_occupants:        pn(r, 'occupancy_summary.average_occupants'),
    state2_peak_occupants:       pn(r, 'occupancy_summary.peak_occupants'),
    // Brief40 per-system breakdowns for source-tracking
    b40_heating_scop:           pn(r, 'consumption.space_heating.scop_effective'),
    b40_cooling_seer:           pn(r, 'consumption.space_cooling.seer_effective'),
    b40_dhw_blended_eff:        pn(r, 'consumption.brief40.dhw.blended_efficiency'),
    // GIA + comfort band echo
    gia_m2:                     pn(r, 'metadata.gia_m2') ?? pn(r, 'heat_balance.metadata.gia_m2'),
    comfort_lower_c:            pn(r, 'comfort_band_used.lower_c'),
    comfort_upper_c:            pn(r, 'comfort_band_used.upper_c'),
  }
}

function runOnce(mutate) {
  const b = JSON.parse(JSON.stringify(baseBuilding))
  if (typeof mutate === 'function') mutate(b)
  return calculateInstant(b, constructions, {}, libraryData, weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand, _skipInterventions: true })
}

const baseline = runSnapshot(null)
function runSnapshot(mutate) {
  return readSnapshot(runOnce(mutate))
}

// ── Sweep specs ────────────────────────────────────────────────────────
// Each sweep: { name, axis (UI name), values, mutate(building, value) }
const SWEEPS = [
  // ── PART 1: Known-bug setpoints ─────────────────────────────────────
  {
    name: 'heating_setpoint',
    axis: 'systems_config_v40.heating_setpoint_c (mode=custom)',
    values: [21, 24, 28],
    mutate: (b, v) => {
      b.systems_config_v40.heating_setpoint_mode = 'custom'
      b.systems_config_v40.heating_setpoint_c = v
    },
  },
  {
    name: 'cooling_setpoint',
    axis: 'systems_config_v40.cooling_setpoint_c (mode=custom)',
    values: [18, 21, 24],
    mutate: (b, v) => {
      b.systems_config_v40.cooling_setpoint_mode = 'custom'
      b.systems_config_v40.cooling_setpoint_c = v
    },
  },
  // ── PART 2: System swaps + efficiencies ─────────────────────────────
  {
    name: 'heating_scop',
    axis: 'systems_config_v40.heating[0].efficiency_metric',
    values: [0.85, 2.5, 4.0],   // gas-boiler-η, mid HP, high HP
    mutate: (b, v) => {
      if (b.systems_config_v40?.heating?.[0]) b.systems_config_v40.heating[0].efficiency_metric = v
    },
  },
  {
    name: 'cooling_seer',
    axis: 'systems_config_v40.cooling[0].efficiency_metric',
    values: [2.5, 3.5, 5.0],
    mutate: (b, v) => {
      if (b.systems_config_v40?.cooling?.[0]) b.systems_config_v40.cooling[0].efficiency_metric = v
    },
  },
  {
    name: 'dhw_eff_primary',
    axis: 'systems_config_v40.dhw[0].efficiency_metric',
    values: [0.7, 0.9, 1.0],
    mutate: (b, v) => {
      if (b.systems_config_v40?.dhw?.[0]) b.systems_config_v40.dhw[0].efficiency_metric = v
    },
  },
  {
    name: 'dhw_demand_basis_perm2',
    axis: 'systems_config_v40.dhw_demand_basis = per_m2 + L/m2',
    values: [0.5, 1.1, 2.0],
    mutate: (b, v) => {
      b.systems_config_v40.dhw_demand_basis = 'per_m2'
      b.systems_config_v40.dhw_demand_litres_per_m2_per_day = v
    },
  },
  {
    name: 'dhw_basis_perperson_litres',
    axis: 'systems_config_v40.dhw_demand_litres_per_person_per_day (basis=per_person)',
    values: [40, 80, 150],
    mutate: (b, v) => {
      b.systems_config_v40.dhw_demand_basis = 'per_person'
      b.systems_config_v40.dhw_demand_litres_per_person_per_day = v
    },
  },
  {
    name: 'dhw_load_shape',
    axis: 'systems_config_v40.dhw_load_shape (Brief 58 B4)',
    values: ['flat', 'follow_occupancy'],
    mutate: (b, v) => { b.systems_config_v40.dhw_load_shape = v },
  },
  // ── PART 2: Ventilation ─────────────────────────────────────────────
  {
    name: 'vent_flow_bedroom_v40',
    axis: 'v40.ventilation[id=vent_bedroom_extract].flow_rate (Brief 59 P1 path)',
    values: [1000, 2208, 3000],
    mutate: (b, v) => {
      for (const s of (b.systems_config_v40?.ventilation ?? [])) {
        if (s.id === 'vent_bedroom_extract') s.flow_rate = v
      }
    },
  },
  {
    name: 'vent_sfp_mvhr_v40',
    axis: 'v40.ventilation[id=vent_mvhr_gf_public].efficiency_metric.sfp_w_per_lps',
    values: [1.0, 1.8, 2.5],
    mutate: (b, v) => {
      for (const s of (b.systems_config_v40?.ventilation ?? [])) {
        if (s.id === 'vent_mvhr_gf_public') s.efficiency_metric.sfp_w_per_lps = v
      }
    },
  },
  {
    name: 'vent_hre_mvhr_v40',
    axis: 'v40.ventilation[id=vent_mvhr_gf_public].efficiency_metric.recovery_sensible_pct',
    values: [60, 75, 90],
    mutate: (b, v) => {
      for (const s of (b.systems_config_v40?.ventilation ?? [])) {
        if (s.id === 'vent_mvhr_gf_public') s.efficiency_metric.recovery_sensible_pct = v
      }
    },
  },
  {
    name: 'summer_bypass_mvhr',
    axis: 'v40.ventilation[id=vent_mvhr_gf_public].summer_bypass',
    values: [false, true],
    mutate: (b, v) => {
      for (const s of (b.systems_config_v40?.ventilation ?? [])) {
        if (s.id === 'vent_mvhr_gf_public') s.summer_bypass = v
      }
    },
  },
  // ── PART 2: Lighting + small power (Brief 58 C coupling) ────────────
  {
    name: 'lighting_control_factor',
    axis: 'v40.lighting[0].control_factor',
    values: [0.5, 0.86, 1.0],
    mutate: (b, v) => {
      if (b.systems_config_v40?.lighting?.[0]) b.systems_config_v40.lighting[0].control_factor = v
    },
  },
  {
    name: 'lighting_enabled',
    axis: 'v40.lighting[0].enabled',
    values: [false, true],
    mutate: (b, v) => {
      if (b.systems_config_v40?.lighting?.[0]) b.systems_config_v40.lighting[0].enabled = v
    },
  },
  {
    name: 'small_power_control_factor',
    axis: 'v40.small_power[0].control_factor',
    values: [0.5, 1.0, 1.5],
    mutate: (b, v) => {
      if (b.systems_config_v40?.small_power?.[0]) b.systems_config_v40.small_power[0].control_factor = v
    },
  },
]

// ── Run all sweeps ────────────────────────────────────────────────────
const results = {
  generated_at: new Date().toISOString(),
  project: { id: PID, name: project.name, gia_m2: 4322 },
  baseline,
  sweeps: [],
}

for (const sweep of SWEEPS) {
  const points = []
  for (const v of sweep.values) {
    const snap = runSnapshot(b => sweep.mutate(b, v))
    points.push({ value: v, snap })
  }
  results.sweeps.push({ name: sweep.name, axis: sweep.axis, values: sweep.values, points })
}

// ── Detect frozen / unresponsive fields per sweep ─────────────────────
// For each sweep, for each tracked output field, mark whether the
// field moved across the sweep range. A field that DOES move when the
// input is changed is "responsive"; one that DOESN'T is "FROZEN".
// Both classifications are useful — frozen-when-it-shouldn't-be is a
// bug, but frozen-when-it-shouldn't-be requires interpretation.

const TRACK_FIELDS = [
  'demand_heating_mwh', 'demand_cooling_mwh', 'demand_dhw_mwh',
  'delivered_heating_mwh', 'delivered_cooling_mwh', 'delivered_dhw_mwh',
  'heat_elec_mwh', 'heat_gas_mwh', 'cool_elec_mwh',
  'dhw_elec_mwh', 'dhw_gas_mwh',
  'fan_elec_mwh', 'light_elec_mwh', 'sp_elec_mwh',
  'total_elec_mwh', 'total_gas_mwh', 'eui_kwh_per_m2', 'carbon_kg_per_m2',
  'hb_loss_external_wall_mwh', 'hb_loss_glazing_mwh', 'hb_loss_fabric_leakage_mwh', 'hb_loss_permanent_vents_mwh',
  'hb_gain_lighting_mwh', 'hb_gain_equipment_mwh', 'hb_gain_people_mwh', 'hb_gain_solar_mwh',
  'vent_heat_loss_mvhr_kwh', 'vent_heat_loss_bedroom_kwh', 'vent_heat_loss_toilet_kwh',
  'vent_fan_mvhr_kwh',
  'b40_heating_scop', 'b40_cooling_seer', 'b40_dhw_blended_eff',
]

for (const sweep of results.sweeps) {
  const frozen = []
  const moved  = []
  for (const f of TRACK_FIELDS) {
    const vals = sweep.points.map(p => p.snap[f]).filter(v => v != null)
    if (vals.length < 2) continue
    const minV = Math.min(...vals)
    const maxV = Math.max(...vals)
    const range = maxV - minV
    // Tolerance: 0.1% of mean abs, or 0.005 absolute floor
    const meanAbs = vals.reduce((s, v) => s + Math.abs(v), 0) / vals.length
    const tol = Math.max(0.005, meanAbs * 0.001)
    if (range > tol) {
      moved.push({ field: f, min: minV, max: maxV, range, mean: meanAbs })
    } else {
      frozen.push({ field: f, value: vals[0] })
    }
  }
  sweep.classification = { moved, frozen }
}

// ── Baseline-vs-intervention parity probe (Part 4) ────────────────────
// For a representative subset of sweeps that have an obvious
// intervention-path equivalent, also run as an intervention patch and
// compare against the baseline-edit result.

import { runInterventionStack } from '../frontend/src/utils/interventionsEngine.js'

const PARITY_TESTS = [
  // [sweep name, value, intervention-patch builder (path + value)]
  ['vent_flow_bedroom_v40', 1500, () => [{
    id: 'parity_test_p1', op: 'set',
    path: 'building.systems_config_v40.ventilation[id=vent_bedroom_extract].flow_rate',
    value: 1500, source: 'inline',
  }]],
  ['heating_scop', 4.0, () => [{
    id: 'parity_test_p2', op: 'set',
    path: 'building.systems_config_v40.heating[id=' + (baseBuilding.systems_config_v40?.heating?.[0]?.id ?? '') + '].efficiency_metric',
    value: 4.0, source: 'inline',
  }]],
  ['vent_hre_mvhr_v40', 90, () => [{
    id: 'parity_test_p3', op: 'set',
    path: 'building.systems_config_v40.ventilation[id=vent_mvhr_gf_public].efficiency_metric.recovery_sensible_pct',
    value: 90, source: 'inline',
  }]],
  ['lighting_control_factor', 0.5, () => [{
    id: 'parity_test_p4', op: 'set',
    path: 'building.systems_config_v40.lighting[id=default_lighting].control_factor',
    value: 0.5, source: 'inline',
  }]],
]

function runEngineWithStack(building) {
  return calculateInstant(building, constructions, {}, libraryData, weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand, _skipInterventions: true })
}

results.parity = []
for (const [sweepName, value, patchBuilder] of PARITY_TESTS) {
  const sweep = results.sweeps.find(s => s.name === sweepName)
  if (!sweep) continue
  const baselineEditPoint = sweep.points.find(p => p.value === value)
  if (!baselineEditPoint) continue

  // Apply as intervention
  const intv = {
    id: 'parity_intv',
    label: 'Parity test',
    enabled: true,
    schema_version: 3,
    patches: patchBuilder(),
  }
  const cfg = { building: baseBuilding, constructions, systems: {}, libraryData }
  const stackResult = runInterventionStack(cfg, [intv], runEngineWithStack, libraryData)
  const intervResult = stackResult.interventions[0]?.result
  const intervSnap = intervResult ? readSnapshot(intervResult) : null

  const interventionTotalElec = intervSnap?.total_elec_mwh
  const baselineEditTotalElec = baselineEditPoint.snap.total_elec_mwh
  const interventionEui = intervSnap?.eui_kwh_per_m2
  const baselineEditEui = baselineEditPoint.snap.eui_kwh_per_m2

  results.parity.push({
    sweepName, value,
    baselineEditSnap: baselineEditPoint.snap,
    interventionSnap: intervSnap,
    delta: {
      total_elec_mwh:    interventionTotalElec != null && baselineEditTotalElec != null ? interventionTotalElec - baselineEditTotalElec : null,
      eui_kwh_per_m2:    interventionEui != null && baselineEditEui != null ? interventionEui - baselineEditEui : null,
    },
    identical: (interventionTotalElec != null && baselineEditTotalElec != null && Math.abs(interventionTotalElec - baselineEditTotalElec) < 0.1)
            && (interventionEui != null && baselineEditEui != null && Math.abs(interventionEui - baselineEditEui) < 0.05),
  })
}

// ── Persist + print summary ───────────────────────────────────────────
const outPath = path.join(REPO_ROOT, 'docs/audit/61_consistency_sweep.json')
fs.writeFileSync(outPath, JSON.stringify(results, null, 2))

console.log('Brief 61 — Consistency sweep done.')
console.log('Sweeps run: ' + results.sweeps.length)
console.log()
console.log('PER-SWEEP CLASSIFICATION (moved vs frozen tracked fields):')
console.log('='.repeat(110))
for (const s of results.sweeps) {
  console.log('SWEEP: ' + s.name + '  (axis: ' + s.axis + ')')
  console.log('  values: ' + JSON.stringify(s.values))
  console.log('  MOVED fields (' + s.classification.moved.length + '):  ' +
    s.classification.moved.map(m => `${m.field} [${m.min.toFixed(2)} → ${m.max.toFixed(2)}, range ${m.range.toFixed(2)}]`).join('; '))
  console.log('  FROZEN fields (' + s.classification.frozen.length + '): ' +
    s.classification.frozen.map(f => `${f.field}=${f.value != null ? f.value.toFixed(2) : 'null'}`).join('; '))
  console.log()
}
console.log('PARITY TESTS (baseline edit vs equivalent intervention):')
console.log('='.repeat(110))
for (const p of results.parity) {
  console.log(`  ${p.sweepName}=${p.value}  identical=${p.identical ? '✓' : '✗ FAIL'}` +
    `  | Δtotal_elec=${p.delta.total_elec_mwh != null ? p.delta.total_elec_mwh.toFixed(3) : '-'}  ΔEUI=${p.delta.eui_kwh_per_m2 != null ? p.delta.eui_kwh_per_m2.toFixed(3) : '-'}`)
}
console.log()
console.log('Wrote ' + outPath)
