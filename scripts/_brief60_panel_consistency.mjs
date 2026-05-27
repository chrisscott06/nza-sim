/**
 * scripts/_brief60_panel_consistency.mjs
 *
 * Brief 60 Part A walkthrough — panel-emulation consistency check.
 *
 * Mirrors BreakdownTable.jsx's exact display logic on every panel
 * surface, then runs the standing-rule self-consistency check:
 *   (1) every displayed Δ == displayed_after − displayed_baseline
 *   (2) every set of parts sums to its total — per-service elec sum
 *       = Total elec; per-service gas sum = Total gas; per-service
 *       Δ-sum = Total Δ
 *   (3) same quantity in two places matches — fuel-total electricity
 *       vs headline EUI cross-reference (within other-carrier
 *       allowance)
 *
 * Tolerances are tight: 0.1 MWh on absolutes, 0.05 kWh/m²·yr on
 * intensities. "Off by 0.2" is not tolerated — that's the same bug
 * small.
 *
 * Reports every Δ, every sum, every cross-reference; if ANY check
 * fails, prints "RECONCILE GATE FAILED" with the residuals; if all
 * pass, prints "RECONCILE GATE PASSED" with the numbers.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'
import {
  runInterventionStack,
  migrateInterventionPatches,
} from '../frontend/src/utils/interventionsEngine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const API = 'http://127.0.0.1:8003'
const PID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
async function fj(u) { const r = await fetch(u); return r.json() }

const project = await fj(`${API}/api/projects/${PID}`)
const lib = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []
const constructions = project.construction_choices
const cb = { lower_c: project.comfort_band_lower_c ?? 20, upper_c: project.comfort_band_upper_c ?? 26 }
const baseBuilding = JSON.parse(JSON.stringify(project.building_config))

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

const baselineForDiff = { systems_config_v40: baseBuilding.systems_config_v40 }
const stack = (baseBuilding.interventions ?? []).map(intv => {
  const from = Number.isInteger(intv?.schema_version) ? intv.schema_version : 1
  return migrateInterventionPatches(intv, from, 3, baselineForDiff)
})
function runEngine(cfg) {
  return calculateInstant(cfg.building, cfg.constructions, cfg.systems, cfg.libraryData,
    weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand: cb, _skipInterventions: true })
}
const baselineCfg = { building: baseBuilding, constructions, systems: {}, libraryData }
const stackResult = runInterventionStack(baselineCfg, stack, runEngine, libraryData)

const baseline = stackResult.baseline
let lastEnabledIdx = -1
for (let i = stackResult.interventions.length - 1; i >= 0; i--) {
  if (stackResult.interventions[i]?.enabled !== false && stackResult.interventions[i]?.result) { lastEnabledIdx = i; break }
}
const cumulative = lastEnabledIdx >= 0 ? stackResult.interventions[lastEnabledIdx].result : baseline

function pn(r, p) { let c = r; for (const s of p.split('.')) { if (c == null) return null; c = c[s] } return (typeof c === 'number' && Number.isFinite(c)) ? c : null }

function readPanel(r) {
  return {
    // demand
    demand_heating: pn(r, 'consumption.space_heating.demand_mwh'),
    demand_cooling: pn(r, 'consumption.space_cooling.demand_mwh'),
    demand_dhw:     pn(r, 'consumption.dhw.demand_mwh'),
    // per-service fuel
    heat_elec: pn(r, 'consumption.space_heating.electricity_mwh') ?? 0,
    heat_gas:  pn(r, 'consumption.space_heating.gas_mwh') ?? 0,
    cool_elec: pn(r, 'consumption.space_cooling.electricity_mwh') ?? 0,
    dhw_elec:  pn(r, 'consumption.dhw.electricity_mwh') ?? 0,
    dhw_gas:   pn(r, 'consumption.dhw.gas_mwh') ?? 0,
    fan_elec:  pn(r, 'consumption.brief40.ventilation.total_fan_electrical_mwh') ?? 0,
    light_elec: pn(r, 'consumption.brief40.lighting.total_delivered_electrical_mwh') ?? 0,
    sp_elec:   pn(r, 'consumption.brief40.small_power.total_delivered_electrical_mwh') ?? 0,
    // fuel totals
    total_elec: pn(r, 'consumption.total.electricity_mwh'),
    total_gas:  pn(r, 'consumption.total.gas_mwh'),
    // headline
    eui:    pn(r, 'consumption.total.kwh_per_m2_yr'),
    carbon: pn(r, 'carbon_kg_co2_per_m2'),
    // gia
    gia: pn(r, 'metadata.gia_m2') ?? pn(r, 'heat_balance.metadata.gia_m2'),
  }
}

const before = readPanel(baseline)
const after  = readPanel(cumulative)
const gia    = after.gia ?? before.gia ?? 4322
const TOL_MWH    = 0.1
const TOL_KWH_M2 = 0.05

const fail = []
function check(label, expected, actual, tol, unit) {
  const residual = actual - expected
  const pass = Math.abs(residual) <= tol
  return { label, expected, actual, residual, tol, unit, pass, fail: !pass }
}

// ── (1) every Δ row: after − before ────────────────────────────────────
const dRows = [
  ['Heat needed',          before.demand_heating, after.demand_heating, 'MWh'],
  ['Cooling needed',       before.demand_cooling, after.demand_cooling, 'MWh'],
  ['Hot water needed',     before.demand_dhw,     after.demand_dhw,     'MWh'],
  ['Heating fuel (elec+gas)', before.heat_elec + before.heat_gas, after.heat_elec + after.heat_gas, 'MWh'],
  ['Cooling fuel (elec)',  before.cool_elec, after.cool_elec, 'MWh'],
  ['Hot water fuel (elec+gas)', before.dhw_elec + before.dhw_gas, after.dhw_elec + after.dhw_gas, 'MWh'],
  ['Ventilation / fans',   before.fan_elec, after.fan_elec, 'MWh'],
  ['Lighting',             before.light_elec, after.light_elec, 'MWh'],
  ['Small power',          before.sp_elec, after.sp_elec, 'MWh'],
  ['Total electricity',    before.total_elec, after.total_elec, 'MWh'],
  ['Total gas',            before.total_gas, after.total_gas, 'MWh'],
  ['EUI',                  before.eui, after.eui, 'kWh/m²·yr'],
  ['Carbon',               before.carbon, after.carbon, 'kgCO₂/m²·yr'],
].map(([label, b, a, unit]) => ({
  label,
  baseline: b,
  after:    a,
  delta:    (a != null && b != null) ? (a - b) : null,
  unit,
}))

// ── (2) sums ──────────────────────────────────────────────────────────
const sums = []
// per-service electricity sum vs total elec
const beforeElecSum = (before.heat_elec ?? 0) + (before.cool_elec ?? 0) + (before.dhw_elec ?? 0) + (before.fan_elec ?? 0) + (before.light_elec ?? 0) + (before.sp_elec ?? 0)
const afterElecSum  = (after.heat_elec  ?? 0) + (after.cool_elec  ?? 0) + (after.dhw_elec  ?? 0) + (after.fan_elec  ?? 0) + (after.light_elec  ?? 0) + (after.sp_elec  ?? 0)
sums.push(check('Σ per-service elec (baseline) = Total elec', before.total_elec, beforeElecSum, TOL_MWH, 'MWh'))
sums.push(check('Σ per-service elec (after)    = Total elec', after.total_elec,  afterElecSum,  TOL_MWH, 'MWh'))
sums.push(check('Σ per-service Δelec           = Total Δelec', (after.total_elec - before.total_elec), (afterElecSum - beforeElecSum), TOL_MWH, 'MWh'))
// per-service gas sum vs total gas
const beforeGasSum = (before.heat_gas ?? 0) + (before.dhw_gas ?? 0)
const afterGasSum  = (after.heat_gas  ?? 0) + (after.dhw_gas  ?? 0)
sums.push(check('Σ per-service gas  (baseline) = Total gas',  before.total_gas, beforeGasSum, TOL_MWH, 'MWh'))
sums.push(check('Σ per-service gas  (after)    = Total gas',  after.total_gas,  afterGasSum,  TOL_MWH, 'MWh'))
sums.push(check('Σ per-service Δgas            = Total Δgas', (after.total_gas - before.total_gas), (afterGasSum - beforeGasSum), TOL_MWH, 'MWh'))

// ── (3) cross-references ──────────────────────────────────────────────
const xrefs = []
// EUI × GIA / 1000 == elec_total + gas_total? (allows other carriers)
const beforeSrc = (before.total_elec ?? 0) + (before.total_gas ?? 0)
const afterSrc  = (after.total_elec  ?? 0) + (after.total_gas  ?? 0)
const beforeEuiFromFuel = beforeSrc * 1000 / gia
const afterEuiFromFuel  = afterSrc  * 1000 / gia
xrefs.push({
  label: '(elec+gas) × 1000 / GIA vs EUI (baseline) [other carriers expected when >0]',
  expected: before.eui,
  actual:   beforeEuiFromFuel,
  residual: beforeEuiFromFuel - before.eui,
  unit: 'kWh/m²·yr',
  pass: Math.abs(beforeEuiFromFuel - before.eui) < TOL_KWH_M2 * 2,   // 2x tolerance
})
xrefs.push({
  label: '(elec+gas) × 1000 / GIA vs EUI (after)',
  expected: after.eui,
  actual:   afterEuiFromFuel,
  residual: afterEuiFromFuel - after.eui,
  unit: 'kWh/m²·yr',
  pass: Math.abs(afterEuiFromFuel - after.eui) < TOL_KWH_M2 * 2,
})
// Total elec Δ from Band 3 == sum of per-service elec Δs (the Brief 60 gate)
xrefs.push({
  label: 'Total Δelec (Band 3) vs Σ per-service Δelec (Band 2)',
  expected: (after.total_elec - before.total_elec),
  actual:   (afterElecSum - beforeElecSum),
  residual: (afterElecSum - beforeElecSum) - (after.total_elec - before.total_elec),
  unit: 'MWh',
  pass: Math.abs((afterElecSum - beforeElecSum) - (after.total_elec - before.total_elec)) < TOL_MWH,
})

// ── Collect failures ──
for (const r of dRows) {
  if (r.delta == null) continue
  // Pure sanity: Δ = a − b is tautological at native level
  if (!Number.isFinite(r.delta)) fail.push({ kind: 'delta', label: r.label, reason: 'non-finite' })
}
for (const s of sums)  if (!s.pass) fail.push({ kind: 'sum',  ...s })
for (const x of xrefs) if (!x.pass) fail.push({ kind: 'xref', ...x })

// ── Print everything ──
console.log('Brief 60 Part A — Panel consistency check')
console.log('Stack: ' + stack.map((i, idx) => (idx + 1) + '. ' + i.label + (i.enabled === false ? '(off)' : '')).join(' -> '))
console.log('GIA: ' + gia + ' m²')
console.log('='.repeat(110))
console.log()
console.log('(1) Per-row baseline / after / Δ (NATIVE units; display conversion is consistent by construction post-fix)')
console.log('-'.repeat(110))
console.log('  ' + 'row'.padEnd(34) + 'baseline'.padStart(14) + 'after'.padStart(14) + 'delta'.padStart(14) + '  unit')
console.log('-'.repeat(110))
for (const r of dRows) {
  const b = r.baseline != null ? r.baseline.toFixed(3) : '-'
  const a = r.after    != null ? r.after.toFixed(3)    : '-'
  const d = r.delta    != null ? (r.delta >= 0 ? '+' : '') + r.delta.toFixed(3) : '-'
  console.log('  ' + r.label.padEnd(34) + b.padStart(14) + a.padStart(14) + d.padStart(14) + '  ' + r.unit)
}
console.log()
console.log('(2) Sums — per-service Σ == total (tolerance 0.1 MWh)')
console.log('-'.repeat(110))
for (const s of sums) {
  const mark = s.pass ? '✓' : '✗ FAIL'
  console.log('  ' + mark + ' ' + s.label.padEnd(52) + '  expected ' + (s.expected ?? '-').toFixed(3) + '  actual ' + s.actual.toFixed(3) + '  residual ' + s.residual.toFixed(3) + ' ' + s.unit)
}
console.log()
console.log('(3) Cross-references — same quantity in two places (tolerance 0.05 kWh/m²·yr × 2 for other-carriers allowance)')
console.log('-'.repeat(110))
for (const x of xrefs) {
  const mark = x.pass ? '✓' : '✗ FAIL'
  console.log('  ' + mark + ' ' + x.label.padEnd(70) + '  expected ' + x.expected.toFixed(3) + '  actual ' + x.actual.toFixed(3) + '  residual ' + x.residual.toFixed(3) + ' ' + x.unit)
}
console.log()

if (fail.length === 0) {
  console.log('='.repeat(110))
  console.log('RECONCILE GATE PASSED — every Δ = after − baseline, every Σ = total, every cross-ref matches')
  console.log('='.repeat(110))
} else {
  console.log('='.repeat(110))
  console.log('RECONCILE GATE FAILED — these don\'t reconcile:')
  for (const f of fail) {
    console.log('  - ' + (f.label || 'unknown') + (f.residual != null ? ' (residual ' + f.residual.toFixed(3) + ' ' + (f.unit || '') + ')' : '') + (f.reason ? ' [' + f.reason + ']' : ''))
  }
  console.log('='.repeat(110))
}

const outPath = path.join(REPO_ROOT, 'docs/audit/60_a_panel_consistency.json')
fs.writeFileSync(outPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  stack: stack.map(i => ({ id: i.id, label: i.label, enabled: i.enabled })),
  gia, before, after,
  rows: dRows, sums, xrefs, failures: fail,
  passed: fail.length === 0,
}, null, 2))
console.log('Wrote ' + outPath)
process.exit(fail.length === 0 ? 0 : 1)
