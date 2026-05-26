/**
 * scripts/_brief53_residual_probe.mjs
 *
 * Brief 53 §1.4 — Heat-balance +10 residual branch test.
 *
 * Pairs every Sankey-displayed line (the same logic HeatBalance.jsx +
 * BalanceSankey.jsx use) against the matching State 2 engine integrand.
 * Surfaces any unpaired or magnitude-divergent line: that line IS the
 * residual source.
 *
 * Branch test rule (Brief 53 audit §1.2):
 *   - If an unpaired Sankey line has NO engine counterpart at the
 *     displayed magnitude → likely Branch A (real missing demand term).
 *   - If every Sankey line maps cleanly to engine integrands and the
 *     residual decomposes from the demand integrand definition (e.g.
 *     gains in non-heating hours, util-factor unused) → Branch B
 *     (labelling / accounting gap).
 *
 * Read-only. Same engine, same comfort band, same weather as live.
 * Loads project + library + weather via the running FastAPI backend on
 * 127.0.0.1:8002, then runs the engine in-process (mirrors the Brief 49
 * harness pattern). No DB writes. No engine code changes.
 *
 * Usage:
 *   node scripts/_brief53_residual_probe.mjs [project_id]
 *
 * Default project = HIX Bridgewater.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const PROJECT_ID = process.argv[2] || '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const API = process.env.NZA_API || 'http://127.0.0.1:8003'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fj(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

// ── Load project + library ────────────────────────────────────────────────
const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const lib = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []
const constructions = project.construction_choices
const comfortBand = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}
const baseBuilding = project.building_config

console.log()
console.log('========================================================')
console.log('  Brief 53 §1.4 — Heat-balance residual branch test')
console.log('========================================================')
console.log(`  Project:        ${project.name} (${PROJECT_ID})`)
console.log(`  Weather file:   ${baseBuilding.weather_file || project.weather_file}`)
console.log(`  Comfort band:   ${comfortBand.lower_c} – ${comfortBand.upper_c} °C`)

// ── Load weather (EPW) ────────────────────────────────────────────────────
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
const orientation = baseBuilding.orientation ?? 0
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, orientation)

// ── Build library shape ──────────────────────────────────────────────────
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

// ── Engine call ──────────────────────────────────────────────────────────
const result = calculateInstant(
  baseBuilding, constructions, {}, libraryData,
  weatherData, hourlySolar, null,
  { mode: 'full', engine: 'v2.5', comfortBand },
)

// ── Pull GIA ──────────────────────────────────────────────────────────────
const gia = result?.heat_balance?.metadata?.gia_m2 ?? 0
const r1 = v => Math.round((v ?? 0) * 10) / 10
const r2 = v => Math.round((v ?? 0) * 100) / 100
const perM2 = (kwh) => gia > 0 ? r2(kwh / gia) : 0

console.log(`  GIA:            ${gia} m²`)
console.log()

// ── Pull GAINS as the Sankey would render them ────────────────────────────
// (mirrors HeatBalance.jsx flattenGains for full mode)
const hb = result?.heat_balance ?? {}
const gains = hb?.annual?.gains ?? {}
const losses = hb?.annual?.losses ?? {}
const setpoint = hb?.losses_at_setpoint ?? result?.losses_at_setpoint ?? {}
const demand = hb?.demand ?? {}

console.log('========================================================')
console.log('  GAINS (Sankey-side, as HeatBalance.jsx renders)')
console.log('========================================================')

const gainLines = []
function addGain(label, kwh, source) {
  const row = { label, kwh, kwh_per_m2: perM2(kwh), source }
  gainLines.push(row)
  console.log(`  ${label.padEnd(28)} ${r1(kwh).toString().padStart(10)} kWh  (${r2(kwh / gia).toString().padStart(6)} kWh/m²)  ← ${source}`)
}

// Solar by face (gains.solar.{south,east,west,north}.kwh)
for (const face of ['south', 'east', 'west', 'north']) {
  const node = gains?.solar?.[face]
  if (!node) continue
  addGain(`Solar — ${face}`, node.kwh ?? 0, `heat_balance.annual.gains.solar.${face}.kwh`)
}

// Internal gains
for (const k of ['people', 'lighting', 'equipment']) {
  const node = gains?.internal?.[k]
  if (!node) continue
  addGain(`Internal — ${k}`, node.kwh ?? 0, `heat_balance.annual.gains.internal.${k}.kwh`)
}

// Synthetic heating (heating demand surfaced as a gain in PHPP convention)
const heating_demand_mwh = demand?.heating_demand_mwh ?? 0
if (heating_demand_mwh > 0.01) {
  addGain('Heating (synthetic)', heating_demand_mwh * 1000,
    `data.demand.heating_demand_mwh × 1000  [synthesised in HeatBalance.jsx L324-353]`)
}

const totalGainsKwh = gainLines.reduce((s, r) => s + r.kwh, 0)
console.log('  ' + '─'.repeat(70))
console.log(`  ${'TOTAL GAINS'.padEnd(28)} ${r1(totalGainsKwh).toString().padStart(10)} kWh  (${perM2(totalGainsKwh).toString().padStart(6)} kWh/m²)`)
console.log()

// ── Pull LOSSES as the Sankey would render them ───────────────────────────
console.log('========================================================')
console.log('  LOSSES (Sankey-side, as HeatBalance.jsx renders)')
console.log('========================================================')

const lossLines = []
function addLoss(label, kwh, source) {
  const row = { label, kwh, kwh_per_m2: perM2(kwh), source }
  lossLines.push(row)
  console.log(`  ${label.padEnd(28)} ${r1(kwh).toString().padStart(10)} kWh  (${r2(kwh / gia).toString().padStart(6)} kWh/m²)  ← ${source}`)
}

// From losses_at_setpoint (Brief 28k+ shape — what HeatBalance.jsx prefers)
for (const elKey of ['external_wall', 'roof', 'ground_floor', 'glazing',
                     'fabric_leakage', 'permanent_vents', 'thermal_bridging']) {
  const node = setpoint?.[elKey]
  if (!node) continue
  const kwh = node?.heating_loss_kwh ?? 0
  if (kwh <= 0.01) continue
  addLoss(elKey, kwh, `losses_at_setpoint.${elKey}.heating_loss_kwh`)
}

// Per-system mech ventilation
const ventSystems = setpoint?.ventilation ?? []
for (const v of ventSystems) {
  if ((v.heat_loss_kwh ?? 0) > 0.01) {
    addLoss(`Vent: ${v.name}`, v.heat_loss_kwh, `losses_at_setpoint.ventilation[].heat_loss_kwh`)
  }
}

// Per-opening natural ventilation
const natvents = setpoint?.natural_ventilation ?? []
for (const o of natvents) {
  if ((o.heat_loss_kwh ?? 0) > 0.01) {
    addLoss(`Operable: ${o.name || o.id}`, o.heat_loss_kwh,
      `losses_at_setpoint.natural_ventilation[].heat_loss_kwh`)
  }
}

// Synthetic cooling (PHPP convention — cooling demand on loss side)
const cooling_demand_mwh = demand?.cooling_demand_mwh ?? 0
if (cooling_demand_mwh > 0.01) {
  addLoss('Cooling (synthetic)', cooling_demand_mwh * 1000,
    `data.demand.cooling_demand_mwh × 1000  [synthesised in HeatBalance.jsx L215-223]`)
}

const totalLossesKwh = lossLines.reduce((s, r) => s + r.kwh, 0)
console.log('  ' + '─'.repeat(70))
console.log(`  ${'TOTAL LOSSES'.padEnd(28)} ${r1(totalLossesKwh).toString().padStart(10)} kWh  (${perM2(totalLossesKwh).toString().padStart(6)} kWh/m²)`)
console.log()

// ── Residual ──────────────────────────────────────────────────────────────
const residualKwh = totalGainsKwh - totalLossesKwh
const residualPerM2 = perM2(residualKwh)
console.log('========================================================')
console.log('  RESIDUAL (Sankey display: gains − losses)')
console.log('========================================================')
console.log(`  netResidual = ${r1(residualKwh)} kWh  =  ${residualPerM2} kWh/m²·yr`)
console.log(`  (HeatBalance.jsx flags 'large residual' when |residual| > 5 kWh/m² or 10% of losses)`)
console.log(`  10% of losses = ${r2(0.10 * totalLossesKwh / gia)} kWh/m²  → flagged: ${Math.abs(residualPerM2) > 5 || Math.abs(residualKwh) > 0.1 * totalLossesKwh}`)
console.log()

// ── Cross-check: engine demand integrand vs synthetic value displayed ─────
console.log('========================================================')
console.log('  Engine integrand cross-checks')
console.log('========================================================')

// Total per-element heating-loss accumulator (setpoint convention)
const totalHeatLossAccum = setpoint?.totals?.total_heating_loss_kwh ?? 0
console.log(`  losses_at_setpoint.totals.total_heating_loss_kwh: ${r1(totalHeatLossAccum)} kWh`)
console.log(`  Σ per-element loss lines displayed:               ${r1(totalLossesKwh - cooling_demand_mwh * 1000)} kWh`)
console.log(`    Δ:                                              ${r1(totalHeatLossAccum - (totalLossesKwh - cooling_demand_mwh * 1000))} kWh`)
console.log()

// Heat balance equation (algebraic check)
//   In heating-direction hours: heating_Wh = max(0, hourly_heat_loss_Wh − offsetters_total)
//   In cooling-direction hours: cooling_Wh = hourly_cool_gain_Wh + offsetters_total
// Therefore: Σ_year (Q_S + Q_I) (gains side) + Σ heating_demand (synthetic gain)
//        vs Σ_{H-hrs} hourly_heat_loss (loss side) + Σ cooling_demand (synthetic loss)
//
// In heating hours: heating_demand = L − G  ⇒ G + heating_demand = L  (balances per hour)
// In cooling hours: cooling_demand = C + G  ⇒ G − cooling_demand = −C
//   ⇒ the cooling-hr gains effectively contribute −C to the residual after subtracting cooling_demand
// In shoulder hours: gains contribute fully to gains-side with NO matching loss-side
//   ⇒ shoulder-hour gains are the candidate-A residual source

// ── Algebraic decomposition (informational only — Branch B test) ──────────
const internalGainsKwh =
  (gains?.internal?.people?.kwh ?? 0) +
  (gains?.internal?.lighting?.kwh ?? 0) +
  (gains?.internal?.equipment?.kwh ?? 0)
const solarGainsKwh =
  (gains?.solar?.north?.kwh ?? 0) +
  (gains?.solar?.south?.kwh ?? 0) +
  (gains?.solar?.east?.kwh ?? 0) +
  (gains?.solar?.west?.kwh ?? 0)

console.log(`  Annual internal gains (Σ people + lighting + equipment):  ${r1(internalGainsKwh)} kWh`)
console.log(`  Annual solar gains    (Σ N + S + E + W transmission):      ${r1(solarGainsKwh)} kWh`)
console.log(`  Heating demand (synthetic gain on display):                ${r1(heating_demand_mwh * 1000)} kWh`)
console.log(`  Cooling demand (synthetic loss on display):                ${r1(cooling_demand_mwh * 1000)} kWh`)
console.log()

// ── Save raw dump for follow-up analysis ──────────────────────────────────
const outPath = path.join(REPO_ROOT, 'docs/audit/53_residual_probe_raw.json')
fs.writeFileSync(outPath, JSON.stringify({
  project_id: PROJECT_ID,
  gia,
  comfortBand,
  gainLines,
  lossLines,
  totals: { gains_kwh: totalGainsKwh, losses_kwh: totalLossesKwh, residual_kwh: residualKwh, residual_per_m2: residualPerM2 },
  engine_cross_checks: {
    total_heat_loss_accum_kwh: totalHeatLossAccum,
    displayed_loss_lines_sum_kwh: totalLossesKwh - cooling_demand_mwh * 1000,
    internal_gains_kwh: internalGainsKwh,
    solar_gains_kwh: solarGainsKwh,
    heating_demand_kwh: heating_demand_mwh * 1000,
    cooling_demand_kwh: cooling_demand_mwh * 1000,
  },
  // also surface State 2 demand block for follow-up
  demand_block: demand,
  setpoints_used: setpoint?.setpoints_used,
}, null, 2))
console.log(`  Raw dump written to: ${path.relative(REPO_ROOT, outPath)}`)
console.log()
