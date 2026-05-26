/**
 * scripts/_brief55_part2_synthetic.mjs
 *
 * Brief 55 Part 2 — synthetic clean falsifiability fixture.
 *
 * The legacy Bridgewater interventions surface a SAME-FIELD CONFLICT
 * after migration (MVHR Bedrooms' snapshot was captured against a
 * drifted heating-share view, so its field-level patches collide with
 * VRF 4.0's on `heating[18672].share_pct`). That conflict is real —
 * Part 5's job to surface to the user.
 *
 * This synthetic test takes the verification DB Bridgewater (no
 * interventions) and constructs TWO clean field-level interventions on
 * DISJOINT paths:
 *   - "SCOP up to 4"      → set heating[18672].efficiency_metric = 4
 *   - "MVHR bedrooms HRE" → set ventilation[bedroom_extract].efficiency_metric.recovery_sensible_pct = 75
 *
 * Different paths → must compose. Cumulative MUST be order-independent.
 * This is the falsifiability gate for Brief 55 Part 2.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'
import { applyIntervention } from '../frontend/src/utils/interventionsEngine.js'

const API = process.env.NZA_API || 'http://127.0.0.1:8003'
const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(url); return r.json() }

const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const lib     = await fj(`${API}/api/library/constructions`)
const libArr  = lib.constructions ?? []
const constructions = project.construction_choices
const comfortBand = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}
// Strip the legacy interventions for this test — we want a pure baseline
// + our two synthetic field-level interventions only.
const baseBuilding = { ...project.building_config, interventions: [] }

// Weather
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
  month[i]=parseInt(p[1]);day[i]=parseInt(p[2]);hour[i]=parseInt(p[3])
  temperature[i]=parseFloat(p[6]);direct_normal[i]=parseFloat(p[14])
  diffuse_horizontal[i]=parseFloat(p[15]);wind_speed[i]=parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const orientation = Number(baseBuilding.orientation ?? 0)
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, orientation)

const libraryData = {
  constructions: libArr.map(c => ({
    name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0, g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c, layers: c.layers,
  })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
}

function runEngine(b) {
  return calculateInstant(b, constructions, {}, libraryData, weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand, _skipInterventions: true })
}
const eui = r => r?.energy_use?.totals?.eui_kwh_per_m2

// ── Synthetic interventions (field-level, disjoint paths) ───────────
const intvScopUp = {
  id: 'int_synth_scop',
  label: 'SCOP up to 4',
  enabled: true,
  schema_version: 3,
  patches: [
    {
      id: 'patch_synth_scop_a',
      source: 'inline',
      op: 'set',
      path: 'building.systems_config_v40.heating[id=sys_heating_1779261680582_18672].efficiency_metric',
      value: 4,
    },
  ],
}
const intvBedroomMvhr = {
  id: 'int_synth_mvhr',
  label: 'MVHR bedrooms HRE',
  enabled: true,
  schema_version: 3,
  patches: [
    {
      id: 'patch_synth_mvhr_a',
      source: 'inline',
      op: 'set',
      path: 'building.systems_config_v40.ventilation[id=vent_bedroom_extract].efficiency_metric.recovery_sensible_pct',
      value: 75,
    },
    {
      // Brief 50 Part 6 single-source-of-truth: HRE must also be updated
      // on v25 because State 2 reads v25's hre (with v40-fallback override).
      // Without this v25 mirror, State 2's vent UA stays at (1-0)=1 (no
      // recovery) — making the synthetic intervention engine-invisible.
      // Realistic intervention authoring would always include this dual
      // write; we mirror it here.
      id: 'patch_synth_mvhr_b',
      source: 'inline',
      op: 'set',
      path: 'building.systems_config_v25.ventilation[id=vent_bedroom_extract].hre',
      value: 0.75,
    },
  ],
}

function applyStack(building, intvs) {
  let cfg = { building, constructions, systems: {}, libraryData }
  for (const intv of intvs) cfg = applyIntervention(cfg, intv, libraryData)
  return cfg.building
}

const rBase = runEngine(baseBuilding)
const e0 = eui(rBase)

const bA = applyStack(baseBuilding, [intvScopUp, intvBedroomMvhr])   // SCOP then MVHR
const bB = applyStack(baseBuilding, [intvBedroomMvhr, intvScopUp])   // MVHR then SCOP
const rA = runEngine(bA)
const rB = runEngine(bB)
const eA = eui(rA), eB = eui(rB)

// ── Gate 1 (PRIMARY): array-shape equality ───────────────────────────
function arraysDeepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}
function summarise(arr) {
  return (arr ?? []).map(s => ({
    id: s.id,
    label: s.label,
    eff: s.efficiency_metric,
    share: s.share_pct,
    enabled: s.enabled,
  }))
}

const hA = bA.systems_config_v40?.heating ?? []
const hB = bB.systems_config_v40?.heating ?? []
const vA = bA.systems_config_v40?.ventilation ?? []
const vB = bB.systems_config_v40?.ventilation ?? []
const heatMatch = arraysDeepEqual(summarise(hA), summarise(hB))
const ventMatch = arraysDeepEqual(
  vA.map(s => ({ id: s.id, recov: s.efficiency_metric?.recovery_sensible_pct })),
  vB.map(s => ({ id: s.id, recov: s.efficiency_metric?.recovery_sensible_pct })),
)

// Also check v25 ventilation HRE
const v25A = bA.systems_config_v25?.ventilation ?? []
const v25B = bB.systems_config_v25?.ventilation ?? []
const v25Match = arraysDeepEqual(
  v25A.map(s => ({ id: s.id, hre: s.hre })),
  v25B.map(s => ({ id: s.id, hre: s.hre })),
)

console.log()
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log('  Brief 55 Part 2 — Synthetic clean falsifiability (field-level, disjoint paths)')
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log()
console.log(`  Baseline (no interventions):                ${e0?.toFixed(2)} kWh/m²·yr`)
console.log()
console.log('  Interventions (synthetic, FIELD-LEVEL, disjoint paths):')
console.log(`    • "SCOP up to 4"      → 1 patch: heating[18672].efficiency_metric = 4`)
console.log(`    • "MVHR bedrooms HRE" → 2 patches: vent[bedroom_extract].efficiency_metric.recovery_sensible_pct = 75`)
console.log(`                                       v25.vent[bedroom_extract].hre = 0.75`)
console.log()
console.log('  GATE 1 (PRIMARY) — array-shape + value equality across orders:')
console.log(`    heating array (A vs B): ${heatMatch ? '✓ identical' : '✗ DIFFERS'}`)
console.log(`      A: ${JSON.stringify(summarise(hA))}`)
console.log(`      B: ${JSON.stringify(summarise(hB))}`)
console.log(`    ventilation array (A vs B): ${ventMatch ? '✓ identical' : '✗ DIFFERS'}`)
console.log(`    v25 ventilation HRE (A vs B): ${v25Match ? '✓ identical' : '✗ DIFFERS'}`)
console.log()
console.log('  GATE 2 — Cumulative EUI:')
console.log(`    Order A — [SCOP, MVHR]: ${eA?.toFixed(2)} kWh/m²·yr`)
console.log(`    Order B — [MVHR, SCOP]: ${eB?.toFixed(2)} kWh/m²·yr`)
console.log(`    Δ:                       ${(eA - eB)?.toFixed(2)} kWh/m²·yr  →  ${Math.abs(eA - eB) < 0.05 ? '✓ PASS (converged)' : '✗ FAIL'}`)
console.log()

const allPass = heatMatch && ventMatch && v25Match && Math.abs(eA - eB) < 0.05
console.log(`  ${allPass ? '✓ ALL GATES PASS — Brief 55 Part 2 acceptance criteria met' : '✗ AT LEAST ONE GATE FAILED'}`)
console.log()

// Dump
const out = path.join(REPO_ROOT, 'docs/audit/55_part2_synthetic.json')
fs.writeFileSync(out, JSON.stringify({
  baseline_eui: e0,
  order_A: { stack: ['SCOP up to 4', 'MVHR bedrooms HRE'], eui: eA, heating: summarise(hA), vent_recov: vA.map(s => ({ id: s.id, recov: s.efficiency_metric?.recovery_sensible_pct })) },
  order_B: { stack: ['MVHR bedrooms HRE', 'SCOP up to 4'], eui: eB, heating: summarise(hB), vent_recov: vB.map(s => ({ id: s.id, recov: s.efficiency_metric?.recovery_sensible_pct })) },
  delta_kwh_per_m2: eA - eB,
  heating_match: heatMatch,
  vent_v40_match: ventMatch,
  vent_v25_match: v25Match,
  all_pass: allPass,
}, null, 2))
console.log(`  JSON: ${path.relative(REPO_ROOT, out)}`)
process.exitCode = allPass ? 0 : 1
