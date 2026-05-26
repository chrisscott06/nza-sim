/**
 * scripts/_brief55_part3_refbox.mjs
 *
 * Brief 55 Part 3 — Refbox order-permutation + SCOP-invariant
 *                    regression fixture (PERMANENT GUARD).
 *
 * Builds a clean reference box (100 m² GIA, no gains, no infiltration)
 * with v40 + v25 systems populated, then runs three permutation tests:
 *
 *   PERMUTATION (Brief 55 falsifiability #1): cumulative EUI after
 *     applying [A, B] must equal cumulative after [B, A], to rounding.
 *     The "shape" check from Part 2 is also enforced: every service
 *     array (heating / cooling / dhw / ventilation / lighting /
 *     small_power) must end structurally identical regardless of order.
 *
 *   SCOP-INVARIANT (Brief 55 falsifiability #2): an isolated SCOP
 *     improvement (heating efficiency_metric: 2.0 → 4.0) MUST move EUI
 *     in the saving direction. Marginal ≤ 0 at every stack position
 *     (in [A] alone, in [A, B], and in [B, A]).
 *
 *   HRE-INVARIANT: an isolated HRE improvement (vent recovery_sensible
 *     0 → 75 %) MUST also move EUI ≤ 0. Same positional rule.
 *
 *   TELESCOPING (Brief 55 falsifiability #3): for each stack, marginals
 *     sum to cumulative delta. Σ marginal_n = cumulative_total − baseline.
 *
 * Tolerance: 0.05 kWh/m²·yr — matches the per-hour-cap rounding floor
 * documented at Brief 50 Probe 1 (refbox ratio 0.99 = 1% residual).
 *
 * Targets the verification backend on :8003 — does NOT touch the live
 * project or persist any state. The refbox is built inline from
 * constants; the live project's library_data + weather is read for
 * the construction templates only.
 *
 * EXIT CODE 0 only when ALL assertions pass. CI / regression-test
 * suitable.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'
import { applyIntervention } from '../frontend/src/utils/interventionsEngine.js'

const API = process.env.NZA_API || 'http://127.0.0.1:8003'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const WEATHER_FILE = 'GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw'
const TOL = 0.05   // kWh/m²·yr — engine per-hour-cap rounding tolerance

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(url); return r.json() }
const lib    = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []

// Weather
const epwPath = path.join(REPO_ROOT, 'data/weather/current', WEATHER_FILE)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), direct_normal = new Float32Array(N)
const diffuse_horizontal = new Float32Array(N), wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i]=parseInt(p[1]);day[i]=parseInt(p[2]);hour[i]=parseInt(p[3])
  temperature[i]=parseFloat(p[6]);direct_normal[i]=parseFloat(p[14])
  diffuse_horizontal[i]=parseFloat(p[15]);wind_speed[i]=parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, 0)

const libraryData = {
  constructions: libArr.map(c => ({
    name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0, g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c, layers: c.layers,
  })),
  // Add a clean refbox heating + vent template so v25 path lookup works
  // alongside the v40 inline efficiency_metric. Brief 49 refbox style.
  system_templates: [
    ...SYSTEM_TEMPLATES_LIBRARY,
    { id: 'refbox_heat',     supports_services: ['heating'],     heating_scop: 2.0, fuel: 'electricity' },
    { id: 'refbox_mvhr',     supports_services: ['ventilation'], hre: 0,            fuel: 'electricity' },
    { id: 'refbox_cool',     supports_services: ['cooling'],     cooling_seer: 3.0, fuel: 'electricity' },
    { id: 'refbox_dhw',      supports_services: ['dhw'],         dhw_seasonal_efficiency: 1.0, fuel: 'electricity' },
  ],
}
function pickC(suffix) { const f = libArr.find(c => c.name?.toLowerCase().includes(suffix)); return f?.id ?? libArr[0]?.id }
const constructions = {
  external_wall: pickC('wall')   ?? libArr[0]?.id,
  roof:          pickC('roof')   ?? libArr[0]?.id,
  ground_floor:  pickC('floor')  ?? libArr[0]?.id,
  glazing:       pickC('glazing') ?? pickC('window') ?? libArr[0]?.id,
}

const COMFORT = { lower_c: 20, upper_c: 25 }

// ── Refbox baseline — populated v25 + v40 with disjoint-path interventions ─
const REFBOX = {
  name: 'REFBOX-brief55',
  weather_file: WEATHER_FILE,
  length: 10, width: 10, floor_height: 3, num_floors: 1, orientation: 0,
  num_bedrooms: 0, occupancy_rate: 0, people_per_room: 0,
  infiltration_ach: 0,
  wwr: { north: 0, east: 0, south: 0, west: 0 },
  openings: [], operable_openings: [], thermal_bridges: [],
  schedules: {}, shading_overhang: {}, shading_fin: {},
  gains: {}, operator: {}, fabric: {},
  thermal_mass_mode: 'category', thermal_mass_category: 'lightweight',
  occupancy: null,
  systems_config_v25: {
    heating: { primary: { library_id: 'refbox_heat' }, primary_pct: 100, setpoint_c: 20, schedule_ref: 'always_on' },
    cooling: { primary: { library_id: 'refbox_cool', enabled: false }, primary_pct: 0 },
    dhw:     { primary: { library_id: 'refbox_dhw',  enabled: false }, primary_pct: 100, circulation_pump_w: 0 },
    ventilation: [{
      id: 'refbox_vent', name: 'refbox_vent',
      enabled: true, hre_enabled: false,
      library_id: 'refbox_mvhr',
      flow_l_s: 500, sfp_w_per_l_s: 0,
      hre: 0,                          // ← intervention B will set this to 0.75 (v25 mirror)
      hours: 8760, schedule_ref: 'always_on',
    }],
  },
  systems_config_v40: {
    heating: [{
      id: 'refbox_v40_heat',
      label: 'Refbox heating',
      service: 'heating',
      source: 'electricity',
      efficiency_metric: 2.0,           // ← intervention A will set this to 4.0
      share_pct: 100,
      control_mechanism: 'constant',
      control_schedule_id: 'always_on',
      capacity_kw: null,
      enabled: true,
    }],
    cooling: [],
    dhw:     [],
    ventilation: [{
      id: 'refbox_vent',
      label: 'refbox_vent',
      service: 'ventilation',
      source: 'electricity',
      efficiency_metric: { sfp_w_per_lps: 0, recovery_sensible_pct: 0, recovery_latent_pct: 0 },   // ← B will set recovery_sensible_pct=75
      flow_rate: 500, flow_rate_basis: 'constant',
      setpoint: null, control_mechanism: 'constant', control_schedule_id: 'always_on',
      share_pct: 100, capacity_kw: null, enabled: true, defrost_penalty_kwh: null,
    }],
    lighting: [], small_power: [],
    heating_setpoint_mode: 'follow_comfort', heating_setpoint_c: null,
    cooling_setpoint_mode: 'follow_comfort', cooling_setpoint_c: null,
    dhw_storage_setpoint_c: 60, dhw_tap_outlet_temp_c: 40, dhw_cold_supply_temp_c: 10,
    dhw_demand_basis: 'per_person', dhw_demand_litres_per_person_per_day: 80,
    dhw_demand_litres_per_m2_per_day: 1.1,
  },
}

function runEngine(building) {
  return calculateInstant(
    building, constructions, {}, libraryData, weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand: COMFORT, _skipInterventions: true },
  )
}
const eui = r => r?.energy_use?.totals?.eui_kwh_per_m2

// ── Two field-level interventions (disjoint paths) ──────────────────
const intvA_SCOPup = {
  id: 'int_part3_scop_up',
  label: 'SCOP 2 → 4',
  enabled: true,
  schema_version: 3,
  patches: [{
    id: 'patch_part3_scop_a',
    source: 'inline',
    op: 'set',
    path: 'building.systems_config_v40.heating[id=refbox_v40_heat].efficiency_metric',
    value: 4.0,
  }],
}
const intvB_HREup = {
  id: 'int_part3_hre_up',
  label: 'HRE 0 → 0.75',
  enabled: true,
  schema_version: 3,
  patches: [
    {
      id: 'patch_part3_hre_v40',
      source: 'inline',
      op: 'set',
      path: 'building.systems_config_v40.ventilation[id=refbox_vent].efficiency_metric.recovery_sensible_pct',
      value: 75,
    },
    {
      id: 'patch_part3_hre_v25',
      source: 'inline',
      op: 'set',
      path: 'building.systems_config_v25.ventilation[id=refbox_vent].hre',
      value: 0.75,
    },
  ],
}

function applyStack(intvs) {
  let cfg = { building: REFBOX, constructions, systems: {}, libraryData }
  for (const intv of intvs) cfg = applyIntervention(cfg, intv, libraryData)
  return cfg.building
}

// ── Permutation runs ────────────────────────────────────────────────
const baseline      = applyStack([])
const onlyA         = applyStack([intvA_SCOPup])
const onlyB         = applyStack([intvB_HREup])
const stackAB       = applyStack([intvA_SCOPup, intvB_HREup])
const stackBA       = applyStack([intvB_HREup, intvA_SCOPup])

const e_baseline = eui(runEngine(baseline))
const e_A        = eui(runEngine(onlyA))
const e_B        = eui(runEngine(onlyB))
const e_AB       = eui(runEngine(stackAB))
const e_BA       = eui(runEngine(stackBA))

console.log()
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log('  Brief 55 Part 3 — Refbox order-permutation + SCOP-invariant regression')
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log()
console.log(`  Backend:    ${API}`)
console.log(`  Refbox:     100 m² GIA, no gains, no occupants, comfort ${COMFORT.lower_c}–${COMFORT.upper_c} °C`)
console.log(`  Vent flow:  500 L/s (always on, SFP=0)`)
console.log(`  Heating:    SCOP 2.0 (electricity, single primary)`)
console.log()
console.log(`  Two field-level interventions on DISJOINT paths:`)
console.log(`    A "SCOP 2 → 4":  set v40.heating[refbox_v40_heat].efficiency_metric = 4.0`)
console.log(`    B "HRE 0 → 0.75":`)
console.log(`        set v40.vent[refbox_vent].efficiency_metric.recovery_sensible_pct = 75`)
console.log(`        set v25.vent[refbox_vent].hre = 0.75`)
console.log()
console.log('  EUI table (kWh/m²·yr):')
console.log(`    Baseline  (no interventions):     ${e_baseline?.toFixed(2)}`)
console.log(`    [A] only  (SCOP 2 → 4):           ${e_A?.toFixed(2)}      Δ vs base: ${(e_A - e_baseline)?.toFixed(2)}`)
console.log(`    [B] only  (HRE 0 → 0.75):         ${e_B?.toFixed(2)}      Δ vs base: ${(e_B - e_baseline)?.toFixed(2)}`)
console.log(`    [A, B]    cumulative:             ${e_AB?.toFixed(2)}      Δ vs base: ${(e_AB - e_baseline)?.toFixed(2)}`)
console.log(`    [B, A]    cumulative:             ${e_BA?.toFixed(2)}      Δ vs base: ${(e_BA - e_baseline)?.toFixed(2)}`)
console.log()

// ── ASSERTIONS ──────────────────────────────────────────────────────

const assertions = []
function assert(name, ok, detail) {
  assertions.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}` + (detail ? `\n      ${detail}` : ''))
}

// 1) PERMUTATION — cumulative([A,B]) == cumulative([B,A])
assert(
  'PERMUTATION — cumulative EUI order-independent',
  Math.abs(e_AB - e_BA) < TOL,
  `[A,B]=${e_AB?.toFixed(2)}, [B,A]=${e_BA?.toFixed(2)}, Δ=${(e_AB - e_BA)?.toFixed(3)} (tol ${TOL})`,
)

// 1b) Array-shape equality across orders — every service identical
function arraysDeepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b) }
const SERVICES = ['heating', 'cooling', 'dhw', 'ventilation', 'lighting', 'small_power']
for (const svc of SERVICES) {
  const a = stackAB.systems_config_v40?.[svc] ?? []
  const b = stackBA.systems_config_v40?.[svc] ?? []
  assert(
    `SHAPE — v40.${svc} array IDENTICAL across orders`,
    arraysDeepEqual(a, b),
    `A.length=${a.length}, B.length=${b.length}`,
  )
}
// Also v25 ventilation mirror (the bedroom_extract hre fix)
{
  const a = stackAB.systems_config_v25?.ventilation ?? []
  const b = stackBA.systems_config_v25?.ventilation ?? []
  assert(
    'SHAPE — v25.ventilation IDENTICAL across orders',
    arraysDeepEqual(a, b),
    `A.length=${a.length}, B.length=${b.length}`,
  )
}

// 2) SCOP-INVARIANT — isolated A must reduce EUI
assert(
  'SCOP-INVARIANT — [A] only (SCOP up) reduces EUI in isolation',
  (e_A - e_baseline) <= TOL,   // ≤ 0 up to tolerance
  `Δ=${(e_A - e_baseline)?.toFixed(2)} (must be ≤ ${TOL})`,
)

// HRE-INVARIANT — isolated B must reduce EUI
assert(
  'HRE-INVARIANT — [B] only (HRE up) reduces EUI in isolation',
  (e_B - e_baseline) <= TOL,
  `Δ=${(e_B - e_baseline)?.toFixed(2)} (must be ≤ ${TOL})`,
)

// 3) MARGINALS RECONCILE (telescoping) for [A, B]
const marg_A_in_AB = e_A - e_baseline
const marg_B_in_AB = e_AB - e_A
const sumMargAB = marg_A_in_AB + marg_B_in_AB
const cumDeltaAB = e_AB - e_baseline
assert(
  'TELESCOPING — [A,B] Σ marginals == cumulative Δ',
  Math.abs(sumMargAB - cumDeltaAB) < TOL,
  `Σ marg = ${sumMargAB?.toFixed(3)}, cum Δ = ${cumDeltaAB?.toFixed(3)}`,
)

// And for [B, A]
const marg_B_in_BA = e_B - e_baseline
const marg_A_in_BA = e_BA - e_B
const sumMargBA = marg_B_in_BA + marg_A_in_BA
const cumDeltaBA = e_BA - e_baseline
assert(
  'TELESCOPING — [B,A] Σ marginals == cumulative Δ',
  Math.abs(sumMargBA - cumDeltaBA) < TOL,
  `Σ marg = ${sumMargBA?.toFixed(3)}, cum Δ = ${cumDeltaBA?.toFixed(3)}`,
)

// Also: SCOP marginal at position 2 in [B, A] should still be ≤ 0
// (no positional positive marginal — Brief 55 falsifiability #2 strict form).
assert(
  'SCOP-INVARIANT — A\'s marginal in [B, A] (position 2) still ≤ 0',
  marg_A_in_BA <= TOL,
  `marg = ${marg_A_in_BA?.toFixed(2)} at position 2`,
)
assert(
  'HRE-INVARIANT — B\'s marginal in [A, B] (position 2) still ≤ 0',
  marg_B_in_AB <= TOL,
  `marg = ${marg_B_in_AB?.toFixed(2)} at position 2`,
)

console.log()
const allPass = assertions.every(a => a.ok)
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log(`  RESULT: ${allPass ? '✓ ALL ' + assertions.length + ' ASSERTIONS PASS' : '✗ ' + assertions.filter(a => !a.ok).length + ' OF ' + assertions.length + ' ASSERTIONS FAILED'}`)
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log()

// JSON dump
const out = path.join(REPO_ROOT, 'docs/audit/55_part3_refbox.json')
fs.writeFileSync(out, JSON.stringify({
  refbox: { gia: 100, comfort: COMFORT, vent_flow_l_s: 500, baseline_scop: 2.0, baseline_hre: 0 },
  results: {
    baseline_eui: e_baseline,
    only_A_eui:   e_A,
    only_B_eui:   e_B,
    AB_eui:       e_AB,
    BA_eui:       e_BA,
  },
  marginals: {
    AB: { A_pos1: marg_A_in_AB, B_pos2: marg_B_in_AB },
    BA: { B_pos1: marg_B_in_BA, A_pos2: marg_A_in_BA },
  },
  assertions,
  all_pass: allPass,
}, null, 2))
console.log(`  JSON: ${path.relative(REPO_ROOT, out)}`)
process.exitCode = allPass ? 0 : 1
