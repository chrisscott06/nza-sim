/**
 * scripts/_brief53_residual_probe_v2.mjs
 *
 * Brief 53 §1.4 — uses the EXACT buildLossesMap + flattenGains the UI uses,
 * across every mode/module combo that renders the heat balance.
 *
 * Mirrors HeatBalance.jsx call sites:
 *   - Results HeatBalanceTab          → mode='full',           modules=null
 *   - BuildingDefinition              → mode=detectState,      modules=['fabric','thermal_bridging','fabric_leakage','permanent_vents']
 *   - InternalGains HeatBalanceView   → mode=ENVELOPE_GAINS,   modules=['fabric','thermal_bridging','fabric_leakage','permanent_vents','internal_gains']
 *   - OperationModule                 → mode=detectState,      modules=MODULES_OPERATION
 *
 * Plus the FULL no-module-filter is what the Results page shows. That's the
 * one Chris sees +10 on.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'
import { MODES, gainOrderFor, loadOrderFor } from '../frontend/src/utils/stateMode.js'

// ── Inlined from HeatBalance.jsx (Node can't import JSX) ─────────────────
const MODULE_CATEGORY_KEYS = Object.freeze({
  fabric:                 new Set(['external_wall', 'roof', 'ground_floor', 'glazing']),
  thermal_bridging:       new Set(['thermal_bridging']),
  fabric_leakage:         new Set(['fabric_leakage', 'infiltration']),
  permanent_vents:        new Set(['permanent_vents', 'openings_louvre']),
  internal_gains:         new Set([]),
  natural_ventilation:    'prefix:natvent_',
  mechanical_ventilation: new Set(['ventilation']).add('prefix:ventilation_'),
})
function _modulesToCategoryMatcher(modules) {
  if (!Array.isArray(modules) || modules.length === 0) return () => true
  const allowed = new Set()
  const prefixes = []
  for (const mod of modules) {
    const entry = MODULE_CATEGORY_KEYS[mod]
    if (!entry) continue
    if (typeof entry === 'string' && entry.startsWith('prefix:')) prefixes.push(entry.slice(7))
    else if (entry instanceof Set) for (const v of entry) {
      if (typeof v === 'string' && v.startsWith('prefix:')) prefixes.push(v.slice(7))
      else allowed.add(v)
    }
  }
  return (key) => allowed.has(key) || prefixes.some(p => key.startsWith(p))
}
function _normaliseSetpointNode(node, gia) {
  if (!node) return null
  const kwh = node.heating_loss_kwh ?? 0
  if (!(kwh > 0.01)) return null
  const kwh_per_m2 = (node.kwh_per_m2 != null && Number.isFinite(node.kwh_per_m2)) ? node.kwh_per_m2 : (gia > 0 ? kwh / gia : 0)
  return { ...node, kwh, kwh_per_m2 }
}
function buildLossesMap(data, mode, modules) {
  const setpoint = data?.losses_at_setpoint
  const legacyLosses = data?.annual?.losses ?? {}
  const gia = data?.metadata?.gia_m2 ?? 0
  const allowed = new Set(loadOrderFor(mode))
  const losses = { ...legacyLosses }
  if (setpoint) {
    for (const k of ['external_wall', 'roof', 'ground_floor', 'glazing', 'fabric_leakage', 'permanent_vents', 'thermal_bridging']) {
      const sp = _normaliseSetpointNode(setpoint[k], gia)
      if (sp) losses[k] = sp
    }
  }
  const baseOrder = loadOrderFor(mode).filter(k => allowed.has(k))
  const orderWithNew = []
  let perSystemVentAppended = false
  const appendPerSystemVent = () => {
    if (perSystemVentAppended) return
    perSystemVentAppended = true
    const ventSystems = setpoint?.ventilation ?? []
    for (const v of ventSystems) {
      if ((v.heat_loss_kwh ?? 0) > 0.01) {
        const key = `ventilation_${v.name}`
        const kwh = v.heat_loss_kwh
        const kwh_per_m2 = gia > 0 ? kwh / gia : 0
        losses[key] = { kwh, kwh_per_m2, _label: `Ventilation: ${v.name}` }
        orderWithNew.push(key)
      }
    }
  }
  for (const k of baseOrder) {
    orderWithNew.push(k)
    if (k === 'ventilation') appendPerSystemVent()
  }
  appendPerSystemVent()
  const natvents = setpoint?.natural_ventilation ?? []
  for (const o of natvents) {
    if ((o.heat_loss_kwh ?? 0) > 0.01) {
      const key = `natvent_${o.id}`
      const kwh = o.heat_loss_kwh
      const kwh_per_m2 = gia > 0 ? kwh / gia : 0
      losses[key] = { kwh, kwh_per_m2, _label: `Operable: ${o.name || o.id}` }
      orderWithNew.push(key)
    }
  }
  if (orderWithNew.includes('cooling')) {
    const mwh = data?.demand?.cooling_demand_mwh
    if (mwh != null && mwh > 0.01) {
      const kwh = mwh * 1000
      losses.cooling = { kwh, kwh_per_m2: gia > 0 ? kwh / gia : 0, synthetic: true }
    }
  }
  const moduleMatcher = _modulesToCategoryMatcher(modules)
  const orderedKeys = orderWithNew
    .filter(k => {
      if (k === 'cooling') return losses.cooling != null
      if (k === 'ventilation' && orderWithNew.some(x => x.startsWith('ventilation_'))) return false
      if (!moduleMatcher(k)) return false
      return losses[k] != null
    })
    .filter(k => !k.startsWith('openings_') || (losses[k]?.kwh ?? 0) > 0.01)
    .filter(k => !['fabric_leakage', 'permanent_vents', 'thermal_bridging'].includes(k) || (losses[k]?.kwh ?? 0) > 0.01)
  return { orderedKeys, losses }
}

const PROJECT_ID = process.argv[2] || '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fj(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

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
console.log('  Brief 53 §1.4 (v2) — using REAL buildLossesMap + flattenGains')
console.log('========================================================')
console.log(`  Project:  ${project.name}`)
console.log(`  Comfort:  ${comfortBand.lower_c} – ${comfortBand.upper_c} °C`)

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
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6]); direct_normal[i] = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15]); wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const orientation = baseBuilding.orientation ?? 0
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

const result = calculateInstant(
  baseBuilding, constructions, {}, libraryData,
  weatherData, hourlySolar, null,
  { mode: 'full', engine: 'v2.5', comfortBand },
)
const hb = result?.heat_balance ?? {}
const gia = hb?.metadata?.gia_m2 ?? 0
const r1 = v => Math.round((v ?? 0) * 10) / 10
const r2 = v => Math.round((v ?? 0) * 100) / 100
const perM2 = (kwh) => gia > 0 ? r2(kwh / gia) : 0

// Replicate flattenGains for a given mode (since HeatBalance.jsx doesn't export it)
function flattenGainsLocal(data, mode) {
  const gains = data?.annual?.gains ?? {}
  const allowed = new Set(gainOrderFor(mode))
  const out = []
  for (const face of ['south', 'east', 'west', 'north']) {
    if (!allowed.has(`solar_${face}`)) continue
    const node = gains?.solar?.[face]
    if (!node) continue
    out.push({ key: `solar_${face}`, kwh: node.kwh ?? 0 })
  }
  for (const k of ['people', 'equipment', 'lighting']) {
    if (!allowed.has(k)) continue
    const node = gains?.internal?.[k]
    if (!node) continue
    out.push({ key: k, kwh: node.kwh ?? 0 })
  }
  if (allowed.has('heating')) {
    const engineHeating = gains?.heating
    if (engineHeating?.kwh != null) {
      out.push({ key: 'heating', kwh: engineHeating.kwh })
    } else {
      const mwh = data?.demand?.heating_demand_mwh
      if (mwh != null && mwh > 0.01) {
        out.push({ key: 'heating', kwh: mwh * 1000, synthetic: true })
      }
    }
  }
  return out
}

function flattenLossesLocal(data, mode, modules) {
  const { orderedKeys, losses } = buildLossesMap(data, mode, modules)
  return orderedKeys.map(k => ({ key: k, label: losses[k]?._label ?? k, kwh: losses[k]?.kwh ?? 0 }))
}

function runForView(label, mode, modules) {
  const gains = flattenGainsLocal(hb, mode)
  const losses = flattenLossesLocal(hb, mode, modules)
  const totalGains = gains.reduce((s, x) => s + x.kwh, 0)
  const totalLosses = losses.reduce((s, x) => s + x.kwh, 0)
  const residualKwh = totalGains - totalLosses
  const residualPerM2 = perM2(residualKwh)
  const lossThreshold5 = 5
  const lossThreshold10pct = 0.10 * totalLosses / gia
  const flagged = Math.abs(residualPerM2) > lossThreshold5 || Math.abs(residualPerM2) > lossThreshold10pct

  console.log()
  console.log('────────────────────────────────────────────────────────')
  console.log(`  ${label}`)
  console.log(`    mode=${mode}  modules=${modules ? JSON.stringify(modules) : 'null (all)'}`)
  console.log('────────────────────────────────────────────────────────')
  console.log(`  GAINS:`)
  for (const g of gains) console.log(`    ${g.key.padEnd(22)} ${r1(g.kwh).toString().padStart(12)} kWh  (${perM2(g.kwh).toString().padStart(6)} kWh/m²)`)
  console.log(`    ${'TOTAL'.padEnd(22)} ${r1(totalGains).toString().padStart(12)} kWh  (${perM2(totalGains).toString().padStart(6)} kWh/m²)`)
  console.log(`  LOSSES:`)
  for (const l of losses) console.log(`    ${l.key.padEnd(22)} ${r1(l.kwh).toString().padStart(12)} kWh  (${perM2(l.kwh).toString().padStart(6)} kWh/m²)`)
  console.log(`    ${'TOTAL'.padEnd(22)} ${r1(totalLosses).toString().padStart(12)} kWh  (${perM2(totalLosses).toString().padStart(6)} kWh/m²)`)
  console.log(`  RESIDUAL:           ${r1(residualKwh).toString().padStart(12)} kWh  (${residualPerM2.toString().padStart(6)} kWh/m²)  → ${flagged ? '⚠️  FLAGGED' : '✓ balanced'}`)
  return { label, mode, modules, gains, losses, totalGains, totalLosses, residualKwh, residualPerM2, flagged }
}

console.log()
console.log('========================================================')
console.log(`  GIA = ${gia} m²`)

const views = [
  runForView('Results / HeatBalanceTab (full, no module filter)', 'full', null),
  runForView('Building tab',          'envelope-only', ['fabric', 'thermal_bridging', 'fabric_leakage', 'permanent_vents']),
  runForView('Internal Gains tab',    'envelope-gains', ['fabric', 'thermal_bridging', 'fabric_leakage', 'permanent_vents', 'internal_gains']),
  runForView('Full mode + ALL modules but built explicitly', 'full', ['fabric', 'thermal_bridging', 'fabric_leakage', 'permanent_vents', 'internal_gains', 'mechanical_ventilation']),
]

// Sum check: in "Results full" view, what's MISSING from displayed losses
// vs the engine's total_heating_loss accumulator?
console.log()
console.log('========================================================')
console.log('  Engine integrand vs displayed losses (Results full view)')
console.log('========================================================')
const setpoint = hb?.losses_at_setpoint ?? result?.losses_at_setpoint ?? {}
const totalHeatLossAccum = setpoint?.totals?.total_heating_loss_kwh ?? 0
console.log(`  Engine: losses_at_setpoint.totals.total_heating_loss_kwh = ${r1(totalHeatLossAccum)} kWh (${perM2(totalHeatLossAccum)} kWh/m²)`)

const resultsFullLosses = views[0].losses
const resultsFullCoolingKwh = (resultsFullLosses.find(l => l.key === 'cooling')?.kwh) ?? 0
const resultsFullDisplayedHeatLosses = views[0].totalLosses - resultsFullCoolingKwh
console.log(`  Display (Results full): Σ heating-loss lines (excluding synthetic cooling) = ${r1(resultsFullDisplayedHeatLosses)} kWh (${perM2(resultsFullDisplayedHeatLosses)} kWh/m²)`)
console.log(`  Δ (engine integrand − displayed heating loss):                                  ${r1(totalHeatLossAccum - resultsFullDisplayedHeatLosses)} kWh (${perM2(totalHeatLossAccum - resultsFullDisplayedHeatLosses)} kWh/m²)`)

// Specifically: which engine terms are NOT in the 'full' loss order?
console.log()
console.log('  Per-element engine integrand vs Results-full display:')
const checks = [
  ['external_wall',    setpoint?.external_wall?.heating_loss_kwh    ?? 0],
  ['roof',             setpoint?.roof?.heating_loss_kwh             ?? 0],
  ['ground_floor',     setpoint?.ground_floor?.heating_loss_kwh     ?? 0],
  ['glazing',          setpoint?.glazing?.heating_loss_kwh          ?? 0],
  ['fabric_leakage',   setpoint?.fabric_leakage?.heating_loss_kwh   ?? 0],
  ['permanent_vents',  setpoint?.permanent_vents?.heating_loss_kwh  ?? 0],
  ['thermal_bridging', setpoint?.thermal_bridging?.heating_loss_kwh ?? 0],
]
for (const [k, v] of checks) {
  const isInFullOrder = loadOrderFor('full').includes(k)
  const inDisplay = resultsFullLosses.find(l => l.key === k) != null
  console.log(`    ${k.padEnd(22)} engine=${r1(v).toString().padStart(10)} kWh   in_full_order=${isInFullOrder}   displayed=${inDisplay}`)
}
const ventSum = (setpoint?.ventilation ?? []).reduce((s, v) => s + (v.heat_loss_kwh ?? 0), 0)
console.log(`    ${'mech_vent (Σ)'.padEnd(22)} engine=${r1(ventSum).toString().padStart(10)} kWh   in_full_order=true (per-system)   displayed=true`)
const natvSum = (setpoint?.natural_ventilation ?? []).reduce((s, v) => s + (v.heat_loss_kwh ?? 0), 0)
console.log(`    ${'natvent (Σ)'.padEnd(22)} engine=${r1(natvSum).toString().padStart(10)} kWh   in_full_order=true (per-opening)  displayed=${natvSum > 0.01 ? 'true' : 'n/a (0)'}`)

// Save raw
const outPath = path.join(REPO_ROOT, 'docs/audit/53_residual_probe_v2_raw.json')
fs.writeFileSync(outPath, JSON.stringify({ project_id: PROJECT_ID, gia, comfortBand, views, engine_total_heat_loss_kwh: totalHeatLossAccum }, null, 2))
console.log()
console.log(`  Raw dump: ${path.relative(REPO_ROOT, outPath)}`)
console.log()
