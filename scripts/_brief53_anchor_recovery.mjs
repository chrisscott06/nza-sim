/**
 * scripts/_brief53_anchor_recovery.mjs
 *
 * Brief 53 anchor-recovery diagnosis — hand-revert v40 heating share_pct
 * 90/10 → 95/5 (matching v25 primary_pct=95) IN MEMORY and check whether
 * EUI returns to 128.20 exactly.
 *
 * If yes: the entire 128.20 → 131.90 delta came from the auto-rebalance,
 * the anchor is fully recoverable by reverting one input (no DB backup
 * needed).
 *
 * If no: there's more drift to chase.
 *
 * Read-only. Does NOT modify the saved project (no PUT to API).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}`); return r.json() }

const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const lib = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []
const constructions = project.construction_choices
const comfortBand = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}
const baseBuilding = project.building_config

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

const libraryDataPlain = {
  constructions: libArr.map(c => ({
    name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0, g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c, layers: c.layers,
  })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
}

// Same library + 3 refbox stubs (mimics the falsifiability harness's library).
const libraryDataWithRefbox = {
  ...libraryDataPlain,
  system_templates: [
    ...SYSTEM_TEMPLATES_LIBRARY,
    { id: 'refbox_heat', supports_services: ['heating'], heating_scop: 3.0, fuel: 'electricity' },
    { id: 'refbox_cool', supports_services: ['cooling'], cooling_seer: 3.0, fuel: 'electricity' },
    { id: 'refbox_dhw',  supports_services: ['dhw'],     dhw_seasonal_efficiency: 1.0, fuel: 'electricity' },
  ],
}

// Used by all runs below — set to PLAIN by default.
const libraryData = libraryDataPlain

function runEngine(building, lib = libraryData) {
  return calculateInstant(building, constructions, {}, lib, weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand })
}

console.log()
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log('  Brief 53 anchor recovery — hand-revert v40 heating share_pct 90/10 → 95/5')
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log()

// CURRENT (as-stored) — anchor at 131.90 per falsifiability T1
const rCurr = runEngine(baseBuilding)
const euiCurr = rCurr?.energy_use?.totals?.eui_kwh_per_m2

// HAND-REVERTED VARIANTS:
//   (A) heating share only: v40 heating 90→95, 10→5
//   (B) vent flows only: v40 vent flow_rate matched to v25 flow_l_s
//   (C) both
const v40 = baseBuilding.systems_config_v40
const v25Vent = baseBuilding.systems_config_v25.ventilation ?? []
const v25HeatPct = baseBuilding.systems_config_v25.heating?.primary_pct ?? 95
const v25VentByName = new Map(v25Vent.map(v => [v.id ?? v.name, v]))

function revertHeating(b) {
  const heat = (b.systems_config_v40?.heating ?? []).map((s, i) => {
    if (i === 0) return { ...s, share_pct: v25HeatPct }
    if (i === 1) return { ...s, share_pct: 100 - v25HeatPct }
    return s
  })
  return { ...b, systems_config_v40: { ...b.systems_config_v40, heating: heat } }
}
function revertVentFlows(b) {
  const vent = (b.systems_config_v40?.ventilation ?? []).map(s => {
    const v25 = v25VentByName.get(s.id) ?? v25VentByName.get(s.label)
    if (v25?.flow_l_s != null) return { ...s, flow_rate: v25.flow_l_s }
    return s
  })
  return { ...b, systems_config_v40: { ...b.systems_config_v40, ventilation: vent } }
}

const rRev_A = runEngine(revertHeating(baseBuilding))
const rRev_B = runEngine(revertVentFlows(baseBuilding))
const rRev_C = runEngine(revertVentFlows(revertHeating(baseBuilding)))
const euiRev_A = rRev_A?.energy_use?.totals?.eui_kwh_per_m2
const euiRev_B = rRev_B?.energy_use?.totals?.eui_kwh_per_m2
const euiRev_C = rRev_C?.energy_use?.totals?.eui_kwh_per_m2

// Cross-check: same as-stored building but run with library INCLUDING refbox stubs
// (the falsifiability harness's library shape).
const rWithRefbox = runEngine(baseBuilding, libraryDataWithRefbox)
const euiWithRefbox = rWithRefbox?.energy_use?.totals?.eui_kwh_per_m2

const rRev = rRev_C  // back-compat for output below
const euiRev = euiRev_C

console.log(`  Current v40 heating share_pct:    [${baseBuilding.systems_config_v40.heating.map(s => s.share_pct).join(', ')}]`)
console.log(`  Current v40 vent flow_rate:       [${baseBuilding.systems_config_v40.ventilation.map(s => s.flow_rate).join(', ')}]`)
console.log(`  v25 heating primary_pct:           ${v25HeatPct}`)
console.log(`  v25 ventilation flow_l_s:         [${v25Vent.map(s => s.flow_l_s).join(', ')}]`)
console.log()
console.log(`  EUI (A) as-stored, plain lib:           ${euiCurr?.toFixed(2)} kWh/m²·yr`)
console.log(`  EUI (B) v40 heating share → v25:        ${euiRev_A?.toFixed(2)} kWh/m²·yr`)
console.log(`  EUI (C) v40 vent flows → v25:           ${euiRev_B?.toFixed(2)} kWh/m²·yr`)
console.log(`  EUI (D) both reverted (plain lib):      ${euiRev_C?.toFixed(2)} kWh/m²·yr`)
console.log(`  EUI (E) as-stored, +refbox library:     ${euiWithRefbox?.toFixed(2)} kWh/m²·yr  ← falsifiability harness shape`)
console.log(`  Target anchor:                          128.20 kWh/m²·yr`)
console.log()

const dAnchor = (euiRev ?? 0) - 128.20
const recoverable = Math.abs(dAnchor) < 0.05
console.log(`  Δ from anchor (reverted):  ${dAnchor >= 0 ? '+' : ''}${dAnchor.toFixed(2)}`)
console.log(`  ${recoverable ? '✓ ANCHOR RECOVERABLE' : '✗ NOT FULLY RECOVERABLE — more drift to chase'}`)
console.log()

// Also: per-service breakdown of consumption to show what 5% share shift does
function pickSh(r, svc) {
  const s = r?.consumption?.[svc] ?? {}
  return { demand: s.demand_mwh, delivered: s.delivered_mwh, elec: s.electricity_mwh, gas: s.gas_mwh }
}
console.log(`  Space heating breakdown (MWh):`)
const aSh = pickSh(rCurr, 'space_heating')
const bSh = pickSh(rRev, 'space_heating')
console.log(`    demand   (curr → rev):  ${aSh.demand?.toFixed(2)} → ${bSh.demand?.toFixed(2)}`)
console.log(`    delivered:              ${aSh.delivered?.toFixed(2)} → ${bSh.delivered?.toFixed(2)}`)
console.log(`    electricity:            ${aSh.elec?.toFixed(2)} → ${bSh.elec?.toFixed(2)}`)
console.log(`    gas:                    ${aSh.gas?.toFixed(2)} → ${bSh.gas?.toFixed(2)}`)
console.log()

const outPath = path.join(REPO_ROOT, 'docs/audit/53_anchor_recovery.json')
fs.writeFileSync(outPath, JSON.stringify({
  current: { share_pct: baseBuilding.systems_config_v40.heating.map(s => s.share_pct), eui: euiCurr },
  reverted: { share_pct: [95, 5], eui: euiRev },
  delta_from_anchor: dAnchor,
  recoverable,
}, null, 2))
console.log(`  JSON: ${path.relative(REPO_ROOT, outPath)}`)
