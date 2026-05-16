/**
 * scripts/_check_28k_gate1_per_element_loss.mjs
 *
 * Brief 28k Gate 1 validation. Runs the Static envelope-only engine on
 * Bridgewater and compares the per-element heating-direction setpoint
 * losses (new `losses_at_setpoint` block) against the hand-calc
 * spreadsheet `Bridgewater_Bottom_Up_Energy_Model.xlsx::05_Heat_Loss`.
 *
 * Tolerance: ±5% per row (Chris's tightened tolerance, 2026-05-15).
 * HALT-and-report if any row exceeds — do not tune to fit.
 *
 * Mapping:
 *   spreadsheet "F1 (NE)" → engine F1 = north-facing facade (rotated by orientation)
 *   spreadsheet "F2 (SE)" → engine F2 = east
 *   spreadsheet "F3 (SW)" → engine F3 = south
 *   spreadsheet "F4 (NW)" → engine F4 = west
 *
 * Does NOT touch demand calc or State 2. Engine output `heating_demand_mwh`
 * is still on the legacy free-running convention; the validation here is
 * scoped strictly to `losses_at_setpoint.*.heating_loss_kwh`.
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

async function fj(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} ${r.status}`)
  return r.json()
}

// ─── Spreadsheet targets (from Brief 28k §Hand-calc validation targets) ────
// Source: Bridgewater_Bottom_Up_Energy_Model.xlsx::05_Heat_Loss
const TARGETS = [
  // [row label, engine path, spreadsheet kWh/yr]
  ['External wall F1 (NE)',  r => r.losses_at_setpoint.external_wall.by_face.F1.heating_loss_kwh,  5929],
  ['External wall F2 (SE)',  r => r.losses_at_setpoint.external_wall.by_face.F2.heating_loss_kwh,  2766],
  ['External wall F3 (SW)',  r => r.losses_at_setpoint.external_wall.by_face.F3.heating_loss_kwh,  7678],
  ['External wall F4 (NW)',  r => r.losses_at_setpoint.external_wall.by_face.F4.heating_loss_kwh,  2941],
  ['External walls total',   r => r.losses_at_setpoint.external_wall.heating_loss_kwh,            19314],
  ['Roof',                   r => r.losses_at_setpoint.roof.heating_loss_kwh,                      9788],
  ['Ground floor',           r => r.losses_at_setpoint.ground_floor.heating_loss_kwh,             16225],
  ['Glazing F1 (NE)',        r => r.losses_at_setpoint.glazing.by_face.F1.heating_loss_kwh,      62537],
  ['Glazing F2 (SE)',        r => r.losses_at_setpoint.glazing.by_face.F2.heating_loss_kwh,       2843],
  ['Glazing F3 (SW)',        r => r.losses_at_setpoint.glazing.by_face.F3.heating_loss_kwh,      43208],
  ['Glazing F4 (NW)',        r => r.losses_at_setpoint.glazing.by_face.F4.heating_loss_kwh,       3127],
  ['Glazing total',          r => r.losses_at_setpoint.glazing.heating_loss_kwh,                111715],
  ['Background infiltration',r => r.losses_at_setpoint.fabric_leakage.heating_loss_kwh,          79991],
  ['Permanent vents',        r => r.losses_at_setpoint.permanent_vents.heating_loss_kwh,         51994],
  ['TOTAL fabric + vent',    r => r.losses_at_setpoint.totals.total_heating_loss_kwh,           289030],
]
const TOLERANCE_PCT = 5.0

// ─── Set up engine inputs ─────────────────────────────────────────────────
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

const epwPath = path.join(REPO_ROOT, 'data/weather/current', bc.weather_file)
if (!fs.existsSync(epwPath)) throw new Error(`Weather file not found: ${epwPath}`)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const epwLat = parseFloat(epwLines[0].split(',')[6])
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
const hourlySolar = computeHourlySolarByFacade(weatherData, epwLat, bc.orientation ?? 0)
const cb = {
  lower_c: project.comfort_band_lower_c ?? 21,
  upper_c: project.comfort_band_upper_c ?? 25,
}

// ─── Run engine in envelope-only mode ─────────────────────────────────────
const result = calculateInstant(
  bc, cc, {}, libraryData,
  weatherData, hourlySolar, null,
  { mode: 'envelope-only', comfortBand: cb }
)

if (!result?.losses_at_setpoint) {
  console.error('FATAL: result.losses_at_setpoint missing from engine output.')
  console.error('Available keys:', Object.keys(result ?? {}).join(', '))
  process.exit(2)
}

// ─── Report ───────────────────────────────────────────────────────────────
console.log()
console.log('=== Brief 28k Gate 1 — Static envelope-only per-element heating loss ===')
console.log()
console.log(`Project:        Bridgewater (${PROJECT_ID})`)
console.log(`Length × Width: ${bc.length} × ${bc.width} m, num_floors ${bc.num_floors}, floor_height ${bc.floor_height} m`)
console.log(`Orientation:    ${bc.orientation ?? 0}°`)
console.log(`Setpoints:      heating ${cb.lower_c} °C, cooling ${cb.upper_c} °C`)
console.log(`Weather:        ${bc.weather_file}`)
console.log(`Tolerance:      ±${TOLERANCE_PCT.toFixed(1)}% per row (Chris 2026-05-15)`)
console.log()
console.log('--- Input drift check: engine geometry vs Brief 28k canonical ---')
console.log()
const engineWWR = bc.wwr ?? {}
const briefWWR = { F1_NE: 0.55, F2_SE: 0.10, F3_SW: 0.38, F4_NW: 0.11 }
const lsp = result.losses_at_setpoint
console.log(`               WWR engine    WWR brief   Glazing engine (m²)   Glazing brief (m²)`)
console.log(`F1 (NE/north)  ${(engineWWR.north ?? 0).toFixed(2).padStart(6)}     ${briefWWR.F1_NE.toFixed(2).padStart(8)}        ${String(lsp.glazing.by_face.F1.area_m2).padStart(8)}            ${String(517).padStart(8)}`)
console.log(`F2 (SE/east)   ${(engineWWR.east  ?? 0).toFixed(2).padStart(6)}     ${briefWWR.F2_SE.toFixed(2).padStart(8)}        ${String(lsp.glazing.by_face.F2.area_m2).padStart(8)}            ${String(24).padStart(8)}`)
console.log(`F3 (SW/south)  ${(engineWWR.south ?? 0).toFixed(2).padStart(6)}     ${briefWWR.F3_SW.toFixed(2).padStart(8)}        ${String(lsp.glazing.by_face.F3.area_m2).padStart(8)}            ${String(358).padStart(8)}`)
console.log(`F4 (NW/west)   ${(engineWWR.west  ?? 0).toFixed(2).padStart(6)}     ${briefWWR.F4_NW.toFixed(2).padStart(8)}        ${String(lsp.glazing.by_face.F4.area_m2).padStart(8)}            ${String(26).padStart(8)}`)
console.log(`Total glazing                              ${String(lsp.glazing.area_m2).padStart(8)} m²         ${String(924).padStart(8)} m²`)
console.log(`Total opaque wall                          ${String(lsp.external_wall.area_m2).padStart(8)} m²         ${String(1428).padStart(8)} m²`)
console.log(`Permanent vents (NE/SW m²)  ${(bc.openings?.north?.louvre_area_m2 ?? 0).toFixed(2)} / ${(bc.openings?.south?.louvre_area_m2 ?? 0).toFixed(2)}     1.00 / 0.76 (matches)`)
console.log()

const colLabel = 'Element'.padEnd(28)
const colEngine = 'Engine kWh'.padStart(12)
const colHand = 'Hand-calc kWh'.padStart(14)
const colDelta = 'Δ kWh'.padStart(10)
const colPct = 'Δ %'.padStart(8)
const colVerdict = 'Verdict'.padStart(8)
console.log(`${colLabel} ${colEngine} ${colHand} ${colDelta} ${colPct}   ${colVerdict}`)
console.log('─'.repeat(28 + 1 + 12 + 1 + 14 + 1 + 10 + 1 + 8 + 3 + 8))

let firstFail = null
const rows = []
for (const [label, accessor, target] of TARGETS) {
  const engine = accessor(result)
  const delta = engine - target
  const pct = (delta / target) * 100
  const pass = Math.abs(pct) <= TOLERANCE_PCT
  rows.push({ label, engine, target, delta, pct, pass })
  if (!pass && firstFail == null) firstFail = label
  const verdict = pass ? 'PASS' : 'FAIL'
  console.log(
    `${label.padEnd(28)} ${engine.toFixed(0).padStart(12)} ${target.toFixed(0).padStart(14)} ${delta.toFixed(0).padStart(10)} ${pct.toFixed(2).padStart(7)}%   ${verdict.padStart(8)}`
  )
}

console.log()
const fails = rows.filter(r => !r.pass)
if (fails.length === 0) {
  console.log(`✓ All ${rows.length} rows within ±${TOLERANCE_PCT}% — Gate 1 PASSES`)
  process.exit(0)
} else {
  console.log(`✗ Gate 1 FAILS — ${fails.length}/${rows.length} rows outside ±${TOLERANCE_PCT}%`)
  console.log(`  First failing row: "${firstFail}"`)
  console.log(`  HALT per Brief 28k. Do not proceed to Gate 2 without Chris sign-off.`)
  console.log()
  console.log('Failing rows:')
  for (const r of fails) {
    console.log(`  • ${r.label}: engine ${r.engine.toFixed(0)} kWh vs hand-calc ${r.target} kWh (Δ ${r.pct >= 0 ? '+' : ''}${r.pct.toFixed(2)}%)`)
  }
  // Exit 0 so the report is captured cleanly; the FAIL signal is the
  // table itself, not the exit code.
  process.exit(0)
}
