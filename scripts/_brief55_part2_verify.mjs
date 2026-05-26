/**
 * scripts/_brief55_part2_verify.mjs
 *
 * Brief 55 Part 2 verification — runs the v2→v3 migration on the live
 * Bridgewater project's interventions, then applies the resulting
 * FIELD-LEVEL patch lists in BOTH orders and asserts:
 *
 *   GATE 1 (PRIMARY, Chris's call): final `v40.heating` array is the
 *     SAME SHAPE in both orders — same entry count, same per-entry
 *     fields. Direct structural equality test, not just EUI.
 *
 *   GATE 2: cumulative EUI converges to ONE number (Δ ≤ 0.05).
 *
 *   GATE 3: ENGINE FILES UNCHANGED — `git diff` over instantCalc.js
 *     and systemsEngine.js MUST be empty (run separately; this script
 *     only does the runtime check).
 *
 *   GATE 4: BASELINE — verification DB no-intervention EUI = 128.20
 *     exactly (unchanged from pre-Brief-55).
 *
 *   GATE 5: existing saved project opens — the migration produces
 *     valid field-level patches that the engine's applyPatch consumes
 *     without error.
 *
 * Targets verification backend (:8003). Read-only — does NOT persist
 * the migrated patches; the migration runs in-memory only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'
import { applyIntervention, migrateInterventionPatches } from '../frontend/src/utils/interventionsEngine.js'

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

function runEngine(b) {
  return calculateInstant(b, constructions, {}, libraryData, weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand, _skipInterventions: true })
}
const eui = r => r?.energy_use?.totals?.eui_kwh_per_m2

// ── Gate 4: baseline EUI ─────────────────────────────────────────────
const baseline = runEngine(baseBuilding)
const e0 = eui(baseline)
console.log()
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log('  Brief 55 Part 2 — Verification (verification DB :8003)')
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log()
console.log(`  GATE 4 — Baseline EUI (no interventions): ${e0?.toFixed(2)} kWh/m²·yr`)
console.log(`           Target: 128.20  →  ${Math.abs(e0 - 128.20) < 0.05 ? '✓ PASS (anchor held)' : '✗ FAIL'}`)
console.log()

// ── Migrate Bridgewater's interventions v1→v3 (in-memory) ────────────
const baselineForDiff = { systems_config_v40: baseBuilding.systems_config_v40 }
const sourceInterventions = (baseBuilding.interventions ?? []).filter(i => i?.enabled !== false)
const migrated = sourceInterventions.map(intv => {
  const from = Number.isInteger(intv?.schema_version) ? intv.schema_version : 1
  return migrateInterventionPatches(intv, from, 3, baselineForDiff)
})

console.log('  Migration v1→v3 walk-through:')
for (let i = 0; i < sourceInterventions.length; i++) {
  const src = sourceInterventions[i]
  const mig = migrated[i]
  const srcLegacy = src.patches?.length === 1 && src.patches[0].path === 'building.systems_config_v40'
  console.log(`    [${i}] "${src.label}"`)
  console.log(`         pre-migration:  ${src.patches?.length ?? 0} patch(es) — ${srcLegacy ? 'legacy whole-object snapshot' : 'mixed shape'}`)
  console.log(`         post-migration: ${mig.patches?.length ?? 0} field-level patches`)
  // Show the operations + paths of the migrated patches
  for (const p of (mig.patches ?? []).slice(0, 8)) {
    const summary = p.op === 'remove' ? `match=${JSON.stringify(p.match)}` :
                    typeof p.value === 'object' ? `value=<obj>` :
                    `value=${JSON.stringify(p.value)}`
    console.log(`           - ${p.op.padEnd(7)} ${p.path}  ${summary}`)
  }
  if ((mig.patches?.length ?? 0) > 8) console.log(`           ... +${mig.patches.length - 8} more`)
}
console.log()

// ── Apply stack in BOTH orders ──────────────────────────────────────
const mvhr_idx = migrated.findIndex(i => /mvhr/i.test(i.label ?? ''))
const vrf_idx  = migrated.findIndex(i => /vrf/i.test(i.label ?? ''))
if (mvhr_idx < 0 || vrf_idx < 0) {
  console.error('  Missing MVHR or VRF intervention — abort.')
  process.exit(1)
}
const mvhr = migrated[mvhr_idx]
const vrf  = migrated[vrf_idx]

function applyStack(building, intvs) {
  let cfg = { building, constructions, systems: {}, libraryData }
  for (const intv of intvs) cfg = applyIntervention(cfg, intv, libraryData)
  return cfg.building
}

const buildingA = applyStack(baseBuilding, [vrf, mvhr])   // [VRF, MVHR]
const buildingB = applyStack(baseBuilding, [mvhr, vrf])   // [MVHR, VRF]
const rA = runEngine(buildingA)
const rB = runEngine(buildingB)
const eA = eui(rA), eB = eui(rB)

// ── Gate 1 (PRIMARY): final v40.heating ARRAY SHAPE equality ────────
function normaliseSystemForCompare(s) {
  // Stable JSON representation independent of key order so deep-equal works.
  const sorted = {}
  for (const k of Object.keys(s ?? {}).sort()) sorted[k] = s[k]
  return JSON.stringify(sorted)
}
function arraysEqualByID(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false
  const byId_a = new Map(a.map(s => [s.id, normaliseSystemForCompare(s)]))
  const byId_b = new Map(b.map(s => [s.id, normaliseSystemForCompare(s)]))
  if (byId_a.size !== byId_b.size) return false
  for (const [id, json_a] of byId_a) {
    const json_b = byId_b.get(id)
    if (json_b !== json_a) return false
  }
  return true
}

const hA = buildingA.systems_config_v40?.heating ?? []
const hB = buildingB.systems_config_v40?.heating ?? []
const heatShapeMatch = arraysEqualByID(hA, hB)

console.log('  GATE 1 (PRIMARY) — final v40.heating ARRAY SHAPE equality:')
console.log(`    Order A — [VRF, MVHR] heating entries: ${hA.length}`)
for (const s of hA) console.log(`       ${s.id}: eff=${s.efficiency_metric} share=${s.share_pct} enabled=${s.enabled}`)
console.log(`    Order B — [MVHR, VRF] heating entries: ${hB.length}`)
for (const s of hB) console.log(`       ${s.id}: eff=${s.efficiency_metric} share=${s.share_pct} enabled=${s.enabled}`)
console.log(`    ${heatShapeMatch ? '✓ PASS — heating arrays IDENTICAL across orders' : '✗ FAIL — heating array shape differs'}`)
console.log()

// Also check cooling, DHW, ventilation, lighting, small_power for thoroughness.
const services = ['heating', 'cooling', 'dhw', 'ventilation', 'lighting', 'small_power']
console.log('  Cross-service array-shape equality (each service):')
for (const svc of services) {
  const arrA = buildingA.systems_config_v40?.[svc] ?? []
  const arrB = buildingB.systems_config_v40?.[svc] ?? []
  const match = arraysEqualByID(arrA, arrB)
  console.log(`    ${svc.padEnd(14)} A=${arrA.length} entries, B=${arrB.length} entries  →  ${match ? '✓ identical' : '✗ DIFFER'}`)
}
console.log()

// ── Gate 2: EUI convergence ──────────────────────────────────────────
console.log('  GATE 2 — Cumulative EUI:')
console.log(`    Order A — [VRF, MVHR]: ${eA?.toFixed(2)} kWh/m²·yr`)
console.log(`    Order B — [MVHR, VRF]: ${eB?.toFixed(2)} kWh/m²·yr`)
console.log(`    Δ:                     ${(eA - eB)?.toFixed(2)} kWh/m²·yr  →  ${Math.abs(eA - eB) < 0.05 ? '✓ PASS (converged)' : '✗ FAIL (still order-dependent)'}`)
console.log()

// ── Gate 5: deprecation markers? ─────────────────────────────────────
console.log('  GATE 5 — Migration health (existing saved project opens):')
const anyDeprecated = migrated.some(i => Array.isArray(i._deprecated_patches) && i._deprecated_patches.length > 0)
const anyEmptyMigrated = migrated.some(i => (i.patches?.length ?? 0) === 0)
console.log(`    Deprecation markers:    ${anyDeprecated ? '⚠ some patches deprecated (review)' : '✓ none'}`)
console.log(`    Empty post-migration:   ${anyEmptyMigrated ? '⚠ some interventions migrated to 0 patches' : '✓ all interventions retained patches'}`)
console.log(`    Engine accepted patches: ${eA != null && eB != null ? '✓ both stacks produced valid EUI' : '✗ engine errored'}`)
console.log()

// ── Overall summary ──────────────────────────────────────────────────
const allGates = {
  '4 baseline anchor':         Math.abs(e0 - 128.20) < 0.05,
  '1 heating array shape':     heatShapeMatch,
  '2 EUI convergence':         Math.abs(eA - eB) < 0.05,
  '5 engine accepts patches':  eA != null && eB != null,
}
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log('  SUMMARY')
console.log('═══════════════════════════════════════════════════════════════════════════════')
for (const [name, pass] of Object.entries(allGates)) {
  console.log(`    GATE ${name}: ${pass ? '✓ PASS' : '✗ FAIL'}`)
}
const allPass = Object.values(allGates).every(Boolean)
console.log()
console.log(`  ${allPass ? '✓ ALL GATES PASS — Part 2 acceptance criteria met' : '✗ AT LEAST ONE GATE FAILED — surface to Chris before proceeding'}`)
console.log()
console.log('  (GATE 3 — engine files unchanged — run `git diff` over instantCalc.js + systemsEngine.js separately.)')
console.log()

// JSON dump
const out = path.join(REPO_ROOT, 'docs/audit/55_part2_verify.json')
fs.writeFileSync(out, JSON.stringify({
  baseline_eui: e0,
  order_A: { stack: ['VRF 4.0', 'MVHR Bedrooms'], eui: eA, heating_count: hA.length, heating: hA },
  order_B: { stack: ['MVHR Bedrooms', 'VRF 4.0'], eui: eB, heating_count: hB.length, heating: hB },
  eui_delta: eA - eB,
  heating_shape_match: heatShapeMatch,
  gates: allGates,
  all_pass: allPass,
}, null, 2))
console.log(`  JSON: ${path.relative(REPO_ROOT, out)}`)
process.exitCode = allPass ? 0 : 1
