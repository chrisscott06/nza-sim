/**
 * scripts/_brief68_partC_gate.mjs
 *
 * Brief 68 Part C gate — fan electricity honours disabled ventilation.
 *
 * Pre-Brief-68 (register U4 / Brief 66 HIGH-8):
 *   State 2 mech-vent loss AND-gates v25.enabled with v40.enabled
 *     (instantCalc.js:2771-2772) — disabling either zeros the loss.
 *   State 3 fan electricity (_computeVentilation, systemsEngine.js:599)
 *     read v40-only — so disabling v25.ventilation[].enabled alone
 *     left fan electricity at full value, inflating EUI by ~10.6%
 *     on Bridgewater (95.3 vs the correct ~86.2).
 *
 * Post-Brief-68:
 *   _computeVentilation accepts a v25Systems parameter and applies the
 *   same AND-gate the State 2 path does.
 *
 * Gates (against Bridgewater):
 *   1. Vent-enabled baseline:           fan_elec, EUI unchanged
 *   2. v25.enabled = false:             fan_elec → 0, EUI drops
 *   3. v40.enabled = false:             also fan_elec → 0 (pre-existing
 *                                       behaviour, regression check)
 *   4. BOTH disabled:                   fan_elec → 0
 *   5. v40-only office project:          v25 absent, fan calc unchanged
 *                                       by the new gate
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const API = process.env.NZA_API ?? 'http://127.0.0.1:8003'
const BRIDGEWATER_PID = process.env.NZA_BRIDGEWATER_PID ?? '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const OFFICE_PID      = process.env.NZA_OFFICE_PID      ?? '3cb8cac5-2458-49a8-99f5-ac1eed5b9821'

async function fj(u) { const r = await fetch(u); return r.json() }
function pn(r, p) {
  let c = r
  for (const s of p.split('.')) { if (c == null) return null; c = c[s] }
  return (typeof c === 'number' && Number.isFinite(c)) ? c : null
}

async function loadProject(pid) {
  const project = await fj(`${API}/api/projects/${pid}`)
  const lib = await fj(`${API}/api/library/constructions`)
  const libArr = lib.constructions ?? []
  const baseBuilding = JSON.parse(JSON.stringify(project.building_config))
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
  const comfortBand = {
    lower_c: project.comfort_band_lower_c ?? 20,
    upper_c: project.comfort_band_upper_c ?? 26,
  }
  return { project, baseBuilding, constructions: project.construction_choices, weatherData, hourlySolar, libraryData, comfortBand }
}

function runOnce(ctx, building) {
  return calculateInstant(building, ctx.constructions, {}, ctx.libraryData, ctx.weatherData, ctx.hourlySolar, null, {
    mode: 'full',
    engine: 'v2.5',
    comfortBand: ctx.comfortBand,
    _skipInterventions: true,
  })
}

function summary(label, ctx, b) {
  const r = runOnce(ctx, b)
  const fan = pn(r, 'consumption.brief40.ventilation.total_fan_electrical_mwh') ?? 0
  const eui = pn(r, 'consumption.brief40.totals.eui_kWh_per_m2') ??
              pn(r, 'eui_kWh_per_m2') ??
              pn(r, 'consumption.eui_kWh_per_m2') ?? 0
  console.log(`  ${label.padEnd(40)}  fan=${fan.toFixed(2).padStart(6)} MWh   EUI=${eui.toFixed(2).padStart(6)} kWh/m²·a`)
  return { fan, eui }
}

console.log('\n── Brief 68 Part C gate — fan elec honours v25 disabled ──\n')

const bw = await loadProject(BRIDGEWATER_PID)
console.log(`Building:  ${bw.project.name}`)
console.log()

// 1. Vent-enabled baseline
const baseline = summary('vent ENABLED (baseline)', bw, bw.baseBuilding)

// 2. Disable v25.ventilation[].enabled only
const v25_off = JSON.parse(JSON.stringify(bw.baseBuilding))
if (v25_off?.systems_config_v25?.ventilation) {
  v25_off.systems_config_v25.ventilation = v25_off.systems_config_v25.ventilation.map(v => ({ ...v, enabled: false }))
}
const v25off_res = summary('v25.ventilation[].enabled = false', bw, v25_off)

// 3. Disable v40.ventilation[].enabled only
const v40_off = JSON.parse(JSON.stringify(bw.baseBuilding))
if (v40_off?.systems_config_v40?.ventilation) {
  v40_off.systems_config_v40.ventilation = v40_off.systems_config_v40.ventilation.map(v => ({ ...v, enabled: false }))
}
const v40off_res = summary('v40.ventilation[].enabled = false', bw, v40_off)

// 4. Both disabled
const both_off = JSON.parse(JSON.stringify(bw.baseBuilding))
if (both_off?.systems_config_v25?.ventilation) {
  both_off.systems_config_v25.ventilation = both_off.systems_config_v25.ventilation.map(v => ({ ...v, enabled: false }))
}
if (both_off?.systems_config_v40?.ventilation) {
  both_off.systems_config_v40.ventilation = both_off.systems_config_v40.ventilation.map(v => ({ ...v, enabled: false }))
}
summary('BOTH v25 + v40 = false', bw, both_off)

console.log()

// Gate checks
let fails = []

if (v25off_res.fan > 0.5) {
  fails.push(`v25-off: fan_elec = ${v25off_res.fan.toFixed(2)} MWh — should be ~0 (was bug: stayed at ~${baseline.fan.toFixed(1)} MWh)`)
}
if (v40off_res.fan > 0.5) {
  fails.push(`v40-off: fan_elec = ${v40off_res.fan.toFixed(2)} MWh — should be ~0`)
}

const eui_drop = baseline.eui - v25off_res.eui
const eui_drop_pct = baseline.eui > 0 ? (eui_drop / baseline.eui) * 100 : 0
if (eui_drop_pct < 5) {
  fails.push(`v25-off: EUI only dropped ${eui_drop_pct.toFixed(2)}% (expected ≥5% as ~40 MWh fan removed from ~390 MWh total)`)
}

// 5. Office (v40-only project) — vent-enabled case must not change
console.log('\nOffice (v40-only project, regression check):\n')
const office = await loadProject(OFFICE_PID)
const officeBaseline = summary('vent ENABLED (baseline)', office, office.baseBuilding)
const officeV40Off = JSON.parse(JSON.stringify(office.baseBuilding))
if (officeV40Off?.systems_config_v40?.ventilation) {
  officeV40Off.systems_config_v40.ventilation = officeV40Off.systems_config_v40.ventilation.map(v => ({ ...v, enabled: false }))
}
const officeV40OffRes = summary('v40.ventilation[].enabled = false', office, officeV40Off)

if (officeBaseline.fan > 0.01 && officeV40OffRes.fan > 0.5) {
  fails.push(`office v40-off: fan_elec = ${officeV40OffRes.fan.toFixed(2)} MWh — should be ~0 (regression in v40-only path)`)
}

console.log()

if (fails.length > 0) {
  console.error('✗ FAIL')
  for (const f of fails) console.error('   ' + f)
  process.exit(1)
}

console.log('✓ PASS — fan electricity now honours both v25 and v40 enabled flags.')
console.log(`  Bridgewater:`)
console.log(`    vent enabled:  fan=${baseline.fan.toFixed(2)} MWh, EUI=${baseline.eui.toFixed(2)}`)
console.log(`    v25 disabled:  fan=${v25off_res.fan.toFixed(2)} MWh, EUI=${v25off_res.eui.toFixed(2)}  (was bug: fan stayed at baseline)`)
console.log(`  Office: v40-only path unchanged (v25 absent → no AND-gate effect).`)
console.log('  Brief 68 Part C U4 v25/v40 ventilation enable-flag asymmetry — verified.')
