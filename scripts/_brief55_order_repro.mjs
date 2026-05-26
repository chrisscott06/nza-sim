/**
 * scripts/_brief55_order_repro.mjs
 *
 * Brief 55 Part 1 — reproduce the 130/124 order-dependence on the
 * verification DB. Read-only. Targets verification backend (:8003).
 *
 * The verification DB Bridgewater carries TWO enabled interventions
 * with WHOLE-OBJECT `building.systems_config_v40` snapshots:
 *   - "MVHR Bedrooms" — adds bedroom MVHR via a v40 snapshot
 *   - "VRF 4.0"       — upgrades VRF heating to SCOP 4 via a v40 snapshot
 *
 * We re-run the stack TWICE with the patches in different orders and
 * compare cumulative EUI. The brief predicts: same set → different
 * cumulative EUI because the LAST snapshot wins (overwriting whatever
 * earlier ones set). 130 ≠ 124.
 *
 * Captured here as the PRE-FIX baseline; Part 2 must collapse this
 * to one number.
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
const baseBuilding = project.building_config

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

function runEngine(buildingForRun) {
  return calculateInstant(
    buildingForRun, constructions, {}, libraryData, weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand, _skipInterventions: true },
  )
}
const eui = r => r?.energy_use?.totals?.eui_kwh_per_m2

// ── Baseline (no interventions) ──────────────────────────────────────
const r0 = runEngine(baseBuilding)
const e0 = eui(r0)

// ── Pull the two interventions stored on Bridgewater ────────────────
const interventions = (baseBuilding.interventions ?? []).filter(i => i?.enabled !== false)
const mvhr = interventions.find(i => /mvhr/i.test(i.label ?? ''))
const vrf  = interventions.find(i => /vrf/i.test(i.label ?? ''))

console.log()
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log('  Brief 55 Part 1 — 130/124 order-dependence reproduction (verification DB)')
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log()
console.log(`  Backend:      ${API}`)
console.log(`  Baseline EUI: ${e0?.toFixed(2)} kWh/m²·yr  (no interventions)`)
console.log()
console.log(`  Interventions on Bridgewater:`)
for (const intv of interventions) {
  const patchPaths = (intv.patches ?? []).map(p => `${p.op}:${p.path}`).join(' | ')
  console.log(`    [${intv.enabled ? '✓' : '×'}] ${intv.label}`)
  console.log(`         patches: ${patchPaths}`)
}
console.log()

if (!mvhr || !vrf) {
  console.log('  Missing one or both interventions — abort.')
  process.exit(1)
}

// Apply via the engine's existing applyIntervention helper. This walks each
// patch in order; each patch is `op:set` on `building.systems_config_v40`
// with a WHOLE-OBJECT value → last-write-wins (the bug).
function applyStack(building, intvs) {
  let cfg = { building, constructions, systems: {}, libraryData }
  for (const intv of intvs) cfg = applyIntervention(cfg, intv, libraryData)
  return cfg.building
}

const buildingA = applyStack(baseBuilding, [vrf,  mvhr])   // [VRF, MVHR]
const buildingB = applyStack(baseBuilding, [mvhr, vrf ])   // [MVHR, VRF]

const rA = runEngine(buildingA)
const rB = runEngine(buildingB)
const eA = eui(rA)
const eB = eui(rB)

console.log(`  Cumulative after-stack EUI:`)
console.log(`    Order A — [VRF 4.0, MVHR Bedrooms]: ${eA?.toFixed(2)} kWh/m²·yr`)
console.log(`    Order B — [MVHR Bedrooms, VRF 4.0]: ${eB?.toFixed(2)} kWh/m²·yr`)
console.log(`    Δ:                                  ${(eA-eB)?.toFixed(2)} kWh/m²·yr`)
console.log()

// Inspect what each cumulative building actually carries on v40 heating
// (the field the two patches both touch via whole-object snapshot).
function describeHeating(b) {
  const h = b?.systems_config_v40?.heating ?? []
  return h.map(s => `${s.label ?? s.id}: eff=${s.efficiency_metric}, share=${s.share_pct}, enabled=${s.enabled}`).join(' || ')
}
console.log('  Final v40.heating state after each stack:')
console.log('    A: ' + describeHeating(buildingA))
console.log('    B: ' + describeHeating(buildingB))
console.log()
console.log('  ⇒ The LAST-applied intervention\'s whole-object snapshot wins. Different')
console.log('    final heating state → different EUI. This is Finding D, the snapshot')
console.log('    collision Brief 55 will fix by storing field-level edits instead.')
console.log()

// Save fixture
const out = path.join(REPO_ROOT, 'docs/audit/55_order_repro.json')
fs.writeFileSync(out, JSON.stringify({
  baseline_eui: e0,
  order_A: { stack: ['VRF 4.0', 'MVHR Bedrooms'], eui: eA, final_heating: describeHeating(buildingA) },
  order_B: { stack: ['MVHR Bedrooms', 'VRF 4.0'], eui: eB, final_heating: describeHeating(buildingB) },
  delta_kwh_per_m2: eA - eB,
}, null, 2))
console.log(`  JSON: ${path.relative(REPO_ROOT, out)}`)
console.log()
