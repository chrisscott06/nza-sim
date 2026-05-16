/**
 * scripts/_check_28k_gate1_diagnostics.mjs
 *
 * Brief 28k Gate 1 — diagnostic pass after spreadsheet WWR alignment.
 * Logs the three parameter sets Chris asked about (2026-05-16):
 *   1. wall sol-air parameters (α, h_out) as ACTUALLY built by buildWallModel
 *   2. roof sol-air parameters (α, h_out)
 *   3. ground floor temperature value + U source
 * Then re-runs the per-element comparison against the updated targets and
 * marks permanent vents INFORMATIONAL (per Chris's accept of BS 5925).
 *
 * Does NOT change engine code. Halt-and-report only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'
import { buildWallModel, extractLayers, solAirT, SOLAR_ABS_DEFAULT, H_OUT_DEFAULT } from '../frontend/src/utils/wallModel.js'

const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fj(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} ${r.status}`)
  return r.json()
}

// Updated spreadsheet targets after WWR alignment (Chris 2026-05-16)
// Source: Bridgewater_Bottom_Up_Energy_Model.xlsx::05_Heat_Loss (in repo root)
const TARGETS = [
  ['External wall F1 (NE)',  r => r.losses_at_setpoint.external_wall.by_face.F1.heating_loss_kwh,  5929, 'check'],
  ['External wall F2 (SE)',  r => r.losses_at_setpoint.external_wall.by_face.F2.heating_loss_kwh,  3012, 'check'],
  ['External wall F3 (SW)',  r => r.losses_at_setpoint.external_wall.by_face.F3.heating_loss_kwh, 10898, 'check'],
  ['External wall F4 (NW)',  r => r.losses_at_setpoint.external_wall.by_face.F4.heating_loss_kwh,  3239, 'check'],
  ['External walls total',   r => r.losses_at_setpoint.external_wall.heating_loss_kwh,            23078, 'check'],
  ['Roof',                   r => r.losses_at_setpoint.roof.heating_loss_kwh,                      9788, 'check'],
  ['Ground floor',           r => r.losses_at_setpoint.ground_floor.heating_loss_kwh,             16225, 'check'],
  ['Glazing F1 (NE)',        r => r.losses_at_setpoint.glazing.by_face.F1.heating_loss_kwh,      62537, 'check'],
  ['Glazing F2 (SE)',        r => r.losses_at_setpoint.glazing.by_face.F2.heating_loss_kwh,        569, 'check'],
  ['Glazing F3 (SW)',        r => r.losses_at_setpoint.glazing.by_face.F3.heating_loss_kwh,      13645, 'check'],
  ['Glazing F4 (NW)',        r => r.losses_at_setpoint.glazing.by_face.F4.heating_loss_kwh,        569, 'check'],
  ['Glazing total',          r => r.losses_at_setpoint.glazing.heating_loss_kwh,                 77319, 'check'],
  ['Background infiltration',r => r.losses_at_setpoint.fabric_leakage.heating_loss_kwh,          79991, 'check'],
  ['Permanent vents',        r => r.losses_at_setpoint.permanent_vents.heating_loss_kwh,         51994, 'info' ],
  ['TOTAL excl. perm. vents',r => r.losses_at_setpoint.totals.total_heating_loss_kwh
                                  - r.losses_at_setpoint.permanent_vents.heating_loss_kwh,    206400, 'check'],
  ['TOTAL all rows',         r => r.losses_at_setpoint.totals.total_heating_loss_kwh,          258394, 'info' ],
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
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
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
const epwLat = parseFloat(epwLines[0].split(',')[6])
const hourlySolar = computeHourlySolarByFacade(weatherData, epwLat, bc.orientation ?? 0)
const cb = { lower_c: project.comfort_band_lower_c ?? 21, upper_c: project.comfort_band_upper_c ?? 25 }

// ─── DIAGNOSTIC BLOCK ─────────────────────────────────────────────────────
// Reconstruct engine's wall models with the same opts instantCalc passes
function findItem(slot) {
  const ref = cc?.[slot]
  if (!ref) return null
  const libId = (typeof ref === 'object') ? (ref.library_id ?? ref.id ?? ref.name) : ref
  return libraryData.constructions.find(c =>
    c.name === libId || c.config_json?.library_id === libId || c.config_json?.name === libId
  ) ?? libraryData.constructions.find(c => c.name === libId)
}
const wallItem  = findItem('external_wall')
const roofItem  = findItem('roof')
const floorItem = findItem('ground_floor')
const wallModel  = buildWallModel(extractLayers(wallItem),  { solar_abs: 0.6, h_out: 25 })
const roofModel  = buildWallModel(extractLayers(roofItem),  { solar_abs: 0.7, h_out: 25 })
const floorModel = buildWallModel(extractLayers(floorItem), { R_so: 0.0, solar_abs: 0, h_out: 1e9 })

const T_ground_engine = (() => { let s = 0; for (let i = 0; i < N; i++) s += temperature[i]; return s / N })()

const U_wall_layers  = wallModel.type === 'mass' ? 1 / wallModel.R_total : wallModel.U
const U_roof_layers  = roofModel.type === 'mass' ? 1 / roofModel.R_total : roofModel.U
const U_floor_layers = floorModel.type === 'mass' ? 1 / floorModel.R_total : floorModel.U

// Mirror engine's pickWholeWallU precedence: override → published → layer-computed
function pickU(item, U_layers) {
  const ov = item?.config_json?.u_value_override ?? item?.u_value_override
  if (Number.isFinite(ov) && ov > 0) return { value: ov, source: 'u_value_override' }
  const pub = item?.u_value_W_per_m2K ?? item?.config_json?.u_value_W_per_m2K
  if (Number.isFinite(pub) && pub > 0) return { value: pub, source: 'u_value_W_per_m2K (library published)' }
  return { value: U_layers, source: 'layer-computed (1 / R_total)' }
}
const wallU  = pickU(wallItem,  U_wall_layers)
const roofU  = pickU(roofItem,  U_roof_layers)
const floorU = pickU(floorItem, U_floor_layers)

console.log()
console.log('=== Brief 28k Gate 1 — diagnostic parameters ===')
console.log()
console.log(`Project: Bridgewater (${PROJECT_ID})  /  Weather: ${bc.weather_file}`)
console.log(`Setpoints: heating ${cb.lower_c} °C, cooling ${cb.upper_c} °C`)
console.log()
console.log('── 1. Wall sol-air + U parameters')
console.log(`   extWallModel.solar_abs (α)   :  ${wallModel.solar_abs}      (spreadsheet 0.6)`)
console.log(`   extWallModel.h_out           :  ${wallModel.h_out}     W/m²K (spreadsheet 25)`)
console.log(`   Layer-computed U             :  ${U_wall_layers.toFixed(4)} W/m²K (R_total ${wallModel.R_total?.toFixed(3)} m²K/W)`)
console.log(`   Engine wholeWallU_ext        :  ${wallU.value.toFixed(4)} W/m²K  ← source: ${wallU.source}`)
console.log()
console.log('── 2. Roof sol-air + U parameters')
console.log(`   roofModel.solar_abs (α)      :  ${roofModel.solar_abs}      (spreadsheet 0.7)`)
console.log(`   roofModel.h_out              :  ${roofModel.h_out}     W/m²K (spreadsheet 25)`)
console.log(`   Layer-computed U             :  ${U_roof_layers.toFixed(4)} W/m²K (R_total ${roofModel.R_total?.toFixed(3)} m²K/W)`)
console.log(`   Engine wholeWallU_roof       :  ${roofU.value.toFixed(4)} W/m²K  ← source: ${roofU.source}`)
console.log()
console.log('── 3. Ground floor temperature + U parameters')
console.log(`   Engine T_ground convention   :  annual mean of T_out from EPW`)
console.log(`   Engine T_ground value        :  ${T_ground_engine.toFixed(3)} °C   (spreadsheet 11.26)`)
console.log(`   Implied (T_heat − T_ground)  :  ${(cb.lower_c - T_ground_engine).toFixed(3)} K`)
console.log(`   floorModel.solar_abs         :  ${floorModel.solar_abs}        (no solar on slab)`)
console.log(`   floorModel.h_out             :  ${floorModel.h_out}    (engine sets 1e9 to bypass sol-air for floor)`)
console.log(`   Layer-computed U             :  ${U_floor_layers.toFixed(4)} W/m²K (R_total ${floorModel.R_total?.toFixed(3)} m²K/W)`)
console.log(`   Engine wholeWallU_floor      :  ${floorU.value.toFixed(4)} W/m²K  ← source: ${floorU.source}`)
console.log()
console.log('── wallModel module defaults (used if instantCalc passes nothing)')
console.log(`   SOLAR_ABS_DEFAULT            :  ${SOLAR_ABS_DEFAULT}`)
console.log(`   H_OUT_DEFAULT                :  ${H_OUT_DEFAULT}`)
console.log()

// ─── Run engine and report ───────────────────────────────────────────────
const result = calculateInstant(
  bc, cc, {}, libraryData, weatherData, hourlySolar, null,
  { mode: 'envelope-only', comfortBand: cb }
)
const lsp = result.losses_at_setpoint

console.log('=== Per-element comparison vs updated spreadsheet (post-WWR alignment) ===')
console.log()
console.log(`Tolerance: ±${TOLERANCE_PCT}% per row  (permanent vents marked INFO per Chris's accept of BS 5925)`)
console.log()
const colLabel = 'Element'.padEnd(28)
const colEngine = 'Engine kWh'.padStart(12)
const colHand = 'Hand-calc kWh'.padStart(14)
const colDelta = 'Δ kWh'.padStart(10)
const colPct = 'Δ %'.padStart(8)
const colVerdict = 'Verdict'.padStart(8)
console.log(`${colLabel} ${colEngine} ${colHand} ${colDelta} ${colPct}   ${colVerdict}`)
console.log('─'.repeat(28 + 1 + 12 + 1 + 14 + 1 + 10 + 1 + 8 + 3 + 8))

const rows = []
for (const [label, accessor, target, kind] of TARGETS) {
  const engine = accessor(result)
  const delta = engine - target
  const pct = (delta / target) * 100
  const pass = Math.abs(pct) <= TOLERANCE_PCT
  const verdict = (kind === 'info') ? 'INFO' : (pass ? 'PASS' : 'FAIL')
  rows.push({ label, engine, target, delta, pct, pass, kind, verdict })
  console.log(
    `${label.padEnd(28)} ${engine.toFixed(0).padStart(12)} ${target.toFixed(0).padStart(14)} ${delta.toFixed(0).padStart(10)} ${pct.toFixed(2).padStart(7)}%   ${verdict.padStart(8)}`
  )
}
console.log()

const checked = rows.filter(r => r.kind === 'check')
const fails = checked.filter(r => !r.pass)
const passes = checked.filter(r => r.pass)
console.log(`Summary (excluding INFO rows): ${passes.length}/${checked.length} PASS · ${fails.length} FAIL`)
if (fails.length === 0) {
  console.log(`✓ All checked rows within ±${TOLERANCE_PCT}% — Gate 1 PASSES`)
} else {
  console.log(`✗ Gate 1 FAILS — ${fails.length} row(s) outside ±${TOLERANCE_PCT}% (excluding INFO permanent vents)`)
  console.log()
  console.log('Failing rows:')
  for (const r of fails) console.log(`  • ${r.label}: ${r.pct >= 0 ? '+' : ''}${r.pct.toFixed(2)}%`)
}
console.log()
console.log('HALT per Brief 28k. Engine code unchanged. Diagnostic parameters logged above.')
