/**
 * scripts/_brief53_bridgewater_bypass.mjs
 *
 * Brief 53 Part 3 verification — does the Heat balance Sankey's cooling
 * ribbon meaningfully shrink when summer_bypass turns ON on Bridgewater?
 *
 * Compares two engine passes on the LIVE Bridgewater project:
 *   (A) baseline — all bypass OFF (matches anchor 128.20)
 *   (B) bedrooms MVHR (bedroom_extract system) flipped to summer_bypass:true
 *
 * Reports the heat-balance Sankey ribbons (gain/loss + cooling synthetic)
 * + EUI so we know what the Heat balance tab will visually show.
 *
 * Read-only — does not modify the saved project.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const PROJECT_ID = process.argv[2] || '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} → ${r.status}`); return r.json() }

const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const lib = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []
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
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c,
    layers: c.layers,
  })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
}

function runEngine(building) {
  return calculateInstant(building, constructions, {}, libraryData, weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand })
}

// Find the MVHR-equipped system (the one with hre > 0) — bypass only has
// an effect on systems with recovery to suppress. On Bridgewater baseline
// this is vent_mvhr_gf_public; the bedroom_extract is extract-only (hre=0).
function findMvhrSystem(building) {
  const v25 = building?.systems_config_v25?.ventilation ?? []
  const m25 = v25.find(s => Number(s?.hre ?? 0) > 0)
  return m25 ? (m25.id ?? m25.name) : null
}

function withBypassOn(building, targetId) {
  const v25Cfg = building?.systems_config_v25
  const v25Vent = (v25Cfg?.ventilation ?? []).map(s =>
    (s.id ?? s.name) === targetId ? { ...s, summer_bypass: true } : s)
  const v40Cfg = building?.systems_config_v40
  const v40Vent = (v40Cfg?.ventilation ?? []).map(s =>
    s.id === targetId ? { ...s, summer_bypass: true } : s)
  return {
    ...building,
    systems_config_v25: v25Cfg ? { ...v25Cfg, ventilation: v25Vent } : v25Cfg,
    systems_config_v40: v40Cfg ? { ...v40Cfg, ventilation: v40Vent } : v40Cfg,
  }
}

const targetId = findMvhrSystem(baseBuilding)
console.log()
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log('  Brief 53 Part 3 — Bridgewater bypass on/off cooling-ribbon visibility')
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log(`  Target MVHR system: ${targetId ?? '(none found)'}`)
console.log()

if (!targetId) { console.log('  No MVHR system on Bridgewater — aborting.'); process.exit(1) }

// ── Bypass OFF (baseline anchor) ──
const rOff = runEngine(baseBuilding)
const rOn  = runEngine(withBypassOn(baseBuilding, targetId))

function ribbons(r) {
  const hb = r?.heat_balance ?? {}
  const sp = hb?.losses_at_setpoint ?? {}
  const gain = hb?.annual?.gains ?? {}
  const demand = hb?.demand ?? {}
  const gia = hb?.metadata?.gia_m2 ?? 1
  const per = kwh => Math.round(kwh / gia * 100) / 100
  return {
    gia,
    // gains-side
    solar_kwh:    Object.values(gain.solar ?? {}).reduce((s, n) => s + (n?.kwh ?? 0), 0),
    internal_kwh: Object.values(gain.internal ?? {}).reduce((s, n) => s + (n?.kwh ?? 0), 0),
    heating_synth_kwh: (demand.heating_demand_mwh ?? 0) * 1000,
    // losses-side (setpoint convention)
    external_wall_kwh: sp.external_wall?.heating_loss_kwh ?? 0,
    roof_kwh:          sp.roof?.heating_loss_kwh ?? 0,
    ground_floor_kwh:  sp.ground_floor?.heating_loss_kwh ?? 0,
    glazing_kwh:       sp.glazing?.heating_loss_kwh ?? 0,
    fabric_leakage_kwh:   sp.fabric_leakage?.heating_loss_kwh ?? 0,
    permanent_vents_kwh:  sp.permanent_vents?.heating_loss_kwh ?? 0,
    thermal_bridging_kwh: sp.thermal_bridging?.heating_loss_kwh ?? 0,
    mech_vent_total_kwh:  (sp.ventilation ?? []).reduce((s, v) => s + (v.heat_loss_kwh ?? 0), 0),
    cooling_synth_kwh:    (demand.cooling_demand_mwh ?? 0) * 1000,
    // mech-vent breakdown
    mech_vent_per_system: (sp.ventilation ?? []).map(v => ({ name: v.name, kwh: v.heat_loss_kwh ?? 0 })),
    // bypass log
    bypass_log: r?.bypass_reconciliation_s2 ?? [],
    eui: r?.energy_use?.totals?.eui_kwh_per_m2 ?? null,
    per_m2: per,
  }
}

const A = ribbons(rOff)
const B = ribbons(rOn)
const per = A.per_m2
const fmt = v => Math.round(v).toLocaleString()

console.log(`  GIA: ${A.gia} m²`)
console.log()
console.log('  HEAT-BALANCE RIBBONS (kWh and kWh/m²·yr):')
console.log('  ─────────────────────────────────────────────────────────────────────────────')
console.log('  Term                       OFF             ON              Δ           per m²')
console.log('  ─────────────────────────────────────────────────────────────────────────────')
const rows = [
  ['Solar (gain)',          A.solar_kwh,           B.solar_kwh],
  ['Internal (gain)',       A.internal_kwh,        B.internal_kwh],
  ['Heating synth (gain)',  A.heating_synth_kwh,   B.heating_synth_kwh],
  ['External wall',         A.external_wall_kwh,   B.external_wall_kwh],
  ['Roof',                  A.roof_kwh,            B.roof_kwh],
  ['Ground floor',          A.ground_floor_kwh,    B.ground_floor_kwh],
  ['Glazing',               A.glazing_kwh,         B.glazing_kwh],
  ['Fabric leakage',        A.fabric_leakage_kwh,  B.fabric_leakage_kwh],
  ['Permanent vents',       A.permanent_vents_kwh, B.permanent_vents_kwh],
  ['Thermal bridging',      A.thermal_bridging_kwh,B.thermal_bridging_kwh],
  ['Mech vent (Σ)',         A.mech_vent_total_kwh, B.mech_vent_total_kwh],
  ['COOLING synth (loss)',  A.cooling_synth_kwh,   B.cooling_synth_kwh],
]
for (const [label, a, b] of rows) {
  const d = b - a
  const flag = label === 'COOLING synth (loss)' ? '  ← COOLING RIBBON' : ''
  console.log(`  ${label.padEnd(24)}${fmt(a).padStart(12)}    ${fmt(b).padStart(12)}    ${(d >= 0 ? '+' : '') + fmt(d)}     ${per(d) >= 0 ? '+' : ''}${per(d).toFixed(2)}${flag}`)
}
console.log('  ─────────────────────────────────────────────────────────────────────────────')
console.log()
console.log('  Mech-vent per system (heat loss kWh):')
for (let i = 0; i < A.mech_vent_per_system.length; i++) {
  const a = A.mech_vent_per_system[i].kwh
  const b = B.mech_vent_per_system[i].kwh
  console.log(`    ${A.mech_vent_per_system[i].name.padEnd(28)} OFF ${fmt(a).padStart(10)}   ON ${fmt(b).padStart(10)}   Δ ${(b - a >= 0 ? '+' : '') + fmt(b - a).padStart(8)}   (per m²: ${per(b - a) >= 0 ? '+' : ''}${per(b - a).toFixed(2)})`)
}
console.log()

// Bypass log
console.log('  Bypass reconciliation log (State 2):')
for (const r of B.bypass_log) {
  console.log(`    [${r.id}] summer_bypass=${r.summer_bypass} hours=${r.hours} suppressed_recovery_mwh=${r.suppressed_recovery_mwh}`)
}
console.log()

const dEui = (B.eui ?? 0) - (A.eui ?? 0)
console.log(`  EUI OFF: ${A.eui?.toFixed(2)} kWh/m²·yr   ON: ${B.eui?.toFixed(2)} kWh/m²·yr   Δ: ${dEui >= 0 ? '+' : ''}${dEui.toFixed(2)}`)
console.log()

console.log('  COOLING RIBBON SHRINKAGE TEST:')
const dCool_kwh = B.cooling_synth_kwh - A.cooling_synth_kwh
const dCool_pct = A.cooling_synth_kwh > 0 ? (dCool_kwh / A.cooling_synth_kwh) * 100 : 0
console.log(`    Cooling synth OFF: ${fmt(A.cooling_synth_kwh)} kWh  (${per(A.cooling_synth_kwh).toFixed(2)} kWh/m²)`)
console.log(`    Cooling synth ON:  ${fmt(B.cooling_synth_kwh)} kWh  (${per(B.cooling_synth_kwh).toFixed(2)} kWh/m²)`)
console.log(`    Δ:                 ${dCool_kwh >= 0 ? '+' : ''}${fmt(dCool_kwh)} kWh  (${dCool_pct >= 0 ? '+' : ''}${dCool_pct.toFixed(1)}%)`)

const visible = Math.abs(per(dCool_kwh)) > 0.5
console.log(`    ${visible ? '✓ VISIBLE' : '⚠ TOO SMALL TO SEE'} — ribbon shrinkage ${visible ? 'will be perceptible in the Sankey' : 'may not be perceptible at default Sankey scale'}`)
console.log()

const out = path.join(REPO_ROOT, 'docs/audit/53_bridgewater_bypass.json')
fs.writeFileSync(out, JSON.stringify({ off: A, on: B, dEui, dCool_kwh, dCool_pct }, null, 2))
console.log(`  JSON: ${path.relative(REPO_ROOT, out)}`)
