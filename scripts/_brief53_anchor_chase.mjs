/**
 * scripts/_brief53_anchor_chase.mjs
 *
 * Brief 53 anchor recovery — systematic field-by-field probe.
 * In-memory mutations only (no DB writes). Targets verification backend (8003).
 *
 * Tries successively-broader reverts to identify what combination of v40
 * field values produces EUI = 128.20 exactly.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const API = process.env.NZA_API || 'http://127.0.0.1:8003'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(url); return r.json() }
const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const lib = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []
const constructions = project.construction_choices
const comfortBand = { lower_c: project.comfort_band_lower_c ?? 20, upper_c: project.comfort_band_upper_c ?? 26 }
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
    { mode: 'full', engine: 'v2.5', comfortBand })
}
function eui(r) { return r?.energy_use?.totals?.eui_kwh_per_m2 }

// Mutators (in-memory)
function setVentFlowsToV25(b) {
  const v25Map = new Map((b.systems_config_v25?.ventilation ?? []).map(v => [v.id ?? v.name, v]))
  const vent = (b.systems_config_v40?.ventilation ?? []).map(s => {
    const v25 = v25Map.get(s.id) ?? v25Map.get(s.label)
    return v25?.flow_l_s != null ? { ...s, flow_rate: v25.flow_l_s } : s
  })
  return { ...b, systems_config_v40: { ...b.systems_config_v40, ventilation: vent } }
}
function setHeatingShares(b, primary = 95, secondary = 5) {
  const heat = (b.systems_config_v40?.heating ?? []).map((s, i) =>
    i === 0 ? { ...s, share_pct: primary } : i === 1 ? { ...s, share_pct: secondary } : s)
  return { ...b, systems_config_v40: { ...b.systems_config_v40, heating: heat } }
}
function setHeatingEff(b, primaryEff) {
  const heat = (b.systems_config_v40?.heating ?? []).map((s, i) =>
    i === 0 ? { ...s, efficiency_metric: primaryEff } : s)
  return { ...b, systems_config_v40: { ...b.systems_config_v40, heating: heat } }
}
function setCoolingEff(b, eff) {
  const cool = (b.systems_config_v40?.cooling ?? []).map((s, i) =>
    i === 0 ? { ...s, efficiency_metric: eff } : s)
  return { ...b, systems_config_v40: { ...b.systems_config_v40, cooling: cool } }
}
function setDhwEff(b, primaryEff, secondaryEff) {
  const dhw = (b.systems_config_v40?.dhw ?? []).map((s, i) => {
    if (i === 0 && primaryEff != null) return { ...s, efficiency_metric: primaryEff }
    if (i === 1 && secondaryEff != null) return { ...s, efficiency_metric: secondaryEff }
    return s
  })
  return { ...b, systems_config_v40: { ...b.systems_config_v40, dhw } }
}
function setLightingControlFactor(b, cf) {
  const lighting = (b.systems_config_v40?.lighting ?? []).map((s, i) =>
    i === 0 ? { ...s, control_factor: cf } : s)
  return { ...b, systems_config_v40: { ...b.systems_config_v40, lighting } }
}
function setDhwShares(b, primaryPct, secondaryPct) {
  const dhw = (b.systems_config_v40?.dhw ?? []).map((s, i) =>
    i === 0 ? { ...s, share_pct: primaryPct } : i === 1 ? { ...s, share_pct: secondaryPct } : s)
  return { ...b, systems_config_v40: { ...b.systems_config_v40, dhw } }
}

const scenarios = [
  ['As-stored', b => b],
  ['Heating share 95/5',           b => setHeatingShares(b)],
  ['Vent flows → v25',             b => setVentFlowsToV25(b)],
  ['Both (share + flow)',          b => setVentFlowsToV25(setHeatingShares(b))],
  ['+ heating eff 5.12 (library)', b => setHeatingEff(setVentFlowsToV25(setHeatingShares(b)), 5.12)],
  ['+ DHW preheat 3.0 (library)',  b => setDhwEff(setHeatingEff(setVentFlowsToV25(setHeatingShares(b)), 5.12), null, 3.0)],
  ['+ cooling SEER 3.51 (library)',b => setCoolingEff(setDhwEff(setHeatingEff(setVentFlowsToV25(setHeatingShares(b)), 5.12), null, 3.0), 3.51)],
  ['ONLY heating eff 5.12',        b => setHeatingEff(b, 5.12)],
  ['ONLY DHW preheat 3.0',         b => setDhwEff(b, null, 3.0)],
  ['ONLY cooling SEER 3.51',       b => setCoolingEff(b, 3.51)],
  ['heating eff 5.12 + share 95/5', b => setHeatingShares(setHeatingEff(b, 5.12))],
  ['heating eff 5.12 + vent flows v25', b => setVentFlowsToV25(setHeatingEff(b, 5.12))],
  ['heating eff 5.12 + cooling 3.51', b => setCoolingEff(setHeatingEff(b, 5.12), 3.51)],
  ['heating eff 5.12 + DHW 3.0',   b => setDhwEff(setHeatingEff(b, 5.12), null, 3.0)],
  ['eff 5.12 + vent flows + cooling 3.51', b => setCoolingEff(setVentFlowsToV25(setHeatingEff(b, 5.12)), 3.51)],
  ['eff 5.12 + vent flows + share 95/5', b => setHeatingShares(setVentFlowsToV25(setHeatingEff(b, 5.12)))],
  // Fine-tune heating eff around 5.00 (since 5.12 alone went 0.50 below; 5.12+vent went 0.10 below)
  ['heating eff 4.95 + vent flows v25', b => setVentFlowsToV25(setHeatingEff(b, 4.95))],
  ['heating eff 5.00 + vent flows v25', b => setVentFlowsToV25(setHeatingEff(b, 5.00))],
  ['heating eff 5.05 + vent flows v25', b => setVentFlowsToV25(setHeatingEff(b, 5.05))],
  // ── Step 2b documented-clean-state hypothesis (Chris's hint list):
  //   heating share 95/5 + DHW 65/35 + vent flows → v25, but PRESERVE
  //   the heating eff = 2.8 (current calibration) and find what extra
  //   field closes the gap to 128.20.
  ['DOC: share 95/5 + vent flows v25 (heating eff 2.8 kept)',
    b => setVentFlowsToV25(setHeatingShares(b))],
  ['DOC + lighting control_factor 0.85',
    b => setLightingControlFactor(setVentFlowsToV25(setHeatingShares(b)), 0.85)],
  ['DOC + lighting control_factor 0.80',
    b => setLightingControlFactor(setVentFlowsToV25(setHeatingShares(b)), 0.80)],
  ['DOC + lighting control_factor 0.70',
    b => setLightingControlFactor(setVentFlowsToV25(setHeatingShares(b)), 0.70)],
  // Maybe DHW preheat eff drift only:
  ['DOC + DHW preheat eff 3.0',
    b => setDhwEff(setVentFlowsToV25(setHeatingShares(b)), null, 3.0)],
  // Maybe nothing further drifted — anchor was at eff=5.0 hack:
  ['DOC + heating eff 5.0 (hack)',
    b => setHeatingEff(setVentFlowsToV25(setHeatingShares(b)), 5.0)],
  // Fine-tune control_factor around 0.85
  ['DOC + lighting control_factor 0.87',
    b => setLightingControlFactor(setVentFlowsToV25(setHeatingShares(b)), 0.87)],
  ['DOC + lighting control_factor 0.86',
    b => setLightingControlFactor(setVentFlowsToV25(setHeatingShares(b)), 0.86)],
  ['DOC + lighting control_factor 0.88',
    b => setLightingControlFactor(setVentFlowsToV25(setHeatingShares(b)), 0.88)],
  // Also: small_power control_factor (independent of lighting)
  ['DOC + lighting cf 0.85 + tweaks',
    b => {
      const x = setLightingControlFactor(setVentFlowsToV25(setHeatingShares(b)), 0.85)
      // Cooling SEER 3.51 (library):
      return setCoolingEff(x, 3.51)
    }],
]

console.log()
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log('  Brief 53 — anchor chase (verification DB)')
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log(`  Backend:  ${API}`)
console.log(`  Target:   128.20 kWh/m²·yr`)
console.log()
console.log('  Current v40 efficiencies:')
console.log(`    heating[0]: ${baseBuilding.systems_config_v40.heating[0]?.efficiency_metric}  (library 5.12)`)
console.log(`    heating[1]: ${baseBuilding.systems_config_v40.heating[1]?.efficiency_metric}  (library 1.0)`)
console.log(`    cooling[0]: ${baseBuilding.systems_config_v40.cooling[0]?.efficiency_metric}  (library 3.51)`)
console.log(`    dhw[0]:     ${baseBuilding.systems_config_v40.dhw[0]?.efficiency_metric}  (library 0.90)`)
console.log(`    dhw[1]:     ${baseBuilding.systems_config_v40.dhw[1]?.efficiency_metric}  (library 3.0)`)
console.log()
console.log('  Δ from 128.20:')

const TARGET = 128.20
let best = { name: '', eui: 999, delta: 999 }
for (const [name, mut] of scenarios) {
  const r = runEngine(mut(baseBuilding))
  const e = eui(r)
  const d = e - TARGET
  const flag = Math.abs(d) < 0.05 ? ' ✓ ANCHOR MATCH' : ''
  console.log(`    ${name.padEnd(40)} EUI ${e?.toFixed(2)}  (Δ ${d >= 0 ? '+' : ''}${d.toFixed(2)})${flag}`)
  if (Math.abs(d) < Math.abs(best.delta)) best = { name, eui: e, delta: d }
}
console.log()
console.log(`  Closest scenario: "${best.name}"  EUI ${best.eui?.toFixed(2)}  (Δ ${best.delta >= 0 ? '+' : ''}${best.delta.toFixed(2)})`)
console.log()
