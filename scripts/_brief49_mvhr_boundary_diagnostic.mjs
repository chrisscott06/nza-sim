/**
 * scripts/_brief49_mvhr_boundary_diagnostic.mjs
 *
 * Brief 49 — MVHR recovery boundary diagnostic. Read-only Node harness.
 *
 * Runs the engine TWICE on clean Bridgewater:
 *   (A) ventilation as-saved (MVHR enabled)
 *   (B) MVHR system toggled enabled:false (every non-MVHR vent system
 *       — e.g. WC extract — kept as-is so the only change is the
 *       MVHR's fan + recovery)
 *
 * Prints the numbers Brief 49 §7.5 needs to decide between H1 / H2 / H3:
 *   per_service.heating.delivered_mwh   (and Δ)
 *   per_service.heating.electricity_mwh (and Δ)
 *   system_performance.ventilation.total.fan_kwh
 *   system_performance.ventilation.total.recovery_mwh
 *   State 2 ventilation heat-loss component (for H3 plausibility)
 *   total electricity                   (and Δ)
 *   EUI                                  (and Δ)
 *
 * Applies the verdict logic Chris specified:
 *   Δheating-elec ≈ +16–22 AND fan ≈ 17.5 MWh → H1 confirmed (real fan/heat cancellation)
 *   Δheating-elec ≈ 0                          → H2 reopens
 *   Vent loss can't supply 61 MWh             → H3
 *
 * Does NOT modify the database. Does NOT touch the engine code. Read-
 * only investigation. Loads project + library via the running FastAPI
 * backend on 127.0.0.1:8002 (same pattern as state3_part4_*.mjs).
 *
 * Usage:
 *   node scripts/_brief49_mvhr_boundary_diagnostic.mjs [project_id]
 *
 * Default project_id is the HIX Bridgewater id.
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
console.log('  Brief 49 — MVHR recovery boundary diagnostic harness')
console.log('========================================================')
console.log(`  Project:        ${project.name} (${PROJECT_ID})`)
console.log(`  Weather file:   ${baseBuilding.weather_file || project.weather_file}`)
console.log(`  Comfort band:   ${comfortBand.lower_c} – ${comfortBand.upper_c} °C`)
console.log()

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

// ── Build library shape (matches state3_part4 test script convention) ────
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

// ── Engine call helper ────────────────────────────────────────────────────
function runEngine(building) {
  return calculateInstant(
    building, constructions, {}, libraryData,
    weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand },
  )
}

// ── Locate the MVHR ventilation system + build the OFF-toggle building ──
//
// Clean Bridgewater carries BOTH v25 AND v40 ventilation arrays. The State
// 2 engine reads v25 directly (instantCalc.js line 2530); State 3 reads
// v40 via `v40VentilationToV25List` when present + valid. The v40 path
// validates that enabled systems' share_pct sums to 100% — disabling
// without rebalancing trips the validation, the engine silently falls
// back to v25, and the "disabled" MVHR is still active in State 2 + State 3.
//
// To truly disable MVHR we need to:
//   1. Remove (or set enabled:false on) the MVHR in v25 ventilation
//   2. Remove (or set enabled:false on) the MVHR in v40 ventilation
//   3. Rebalance v40 share_pct so the remaining enabled systems sum to 100%
//
// MVHR identification: hre > 0 on v25 OR recovery_sensible_pct > 0 on v40.
function findMvhrSystemIds(building) {
  const ids = new Set()
  const v25 = building?.systems_config_v25?.ventilation ?? []
  for (const sys of v25) {
    if (Number(sys?.hre ?? 0) > 0) ids.add(sys.id ?? sys.name)
  }
  const v40 = building?.systems_config_v40?.ventilation ?? []
  for (const sys of v40) {
    const hre = Number(sys?.efficiency_metric?.recovery_sensible_pct ?? 0)
    if (hre > 0) ids.add(sys.id)
  }
  return [...ids]
}

const mvhrIds = findMvhrSystemIds(baseBuilding)
if (mvhrIds.length === 0) {
  console.error('No MVHR (hre > 0) ventilation systems found. Aborting.')
  process.exit(1)
}
console.log(`  MVHR system(s) detected: ${mvhrIds.join(', ')}`)

function withMvhrToggled(building, enabled) {
  // v25 path
  const v25Cfg  = building?.systems_config_v25
  const v25Vent = (v25Cfg?.ventilation ?? []).map(sys =>
    mvhrIds.includes(sys.id ?? sys.name) ? { ...sys, enabled } : sys
  )

  // v40 path: toggle enabled AND rebalance share_pct so remaining
  // enabled systems sum to 100% (otherwise _validateShares fails and the
  // engine silently falls back to v25 — defeating the toggle).
  const v40Cfg  = building?.systems_config_v40
  let v40Vent = (v40Cfg?.ventilation ?? []).map(sys =>
    mvhrIds.includes(sys.id) ? { ...sys, enabled } : sys
  )
  if (!enabled) {
    const remaining = v40Vent.filter(s => s.enabled !== false)
    const remSum = remaining.reduce((s, x) => s + Number(x?.share_pct ?? 0), 0)
    if (remSum > 0 && Math.abs(remSum - 100) > 0.05) {
      const scale = 100 / remSum
      v40Vent = v40Vent.map(s =>
        s.enabled !== false ? { ...s, share_pct: Number((Number(s.share_pct ?? 0) * scale).toFixed(2)) } : s
      )
    }
  }

  return {
    ...building,
    systems_config_v25: v25Cfg ? { ...v25Cfg, ventilation: v25Vent } : v25Cfg,
    systems_config_v40: v40Cfg ? { ...v40Cfg, ventilation: v40Vent } : v40Cfg,
  }
}

// ── HRE-only-zero variant ────────────────────────────────────────────────
// Sets the MVHR's HRE to 0 (or hre_enabled:false) but leaves the system
// enabled (airflow + fan still running). This is closer to what Chris
// likely observed in the UI ("MVHR off" preserving raw demand at 90.3).
function withMvhrHreZeroed(building) {
  const v25Cfg  = building?.systems_config_v25
  const v25Vent = (v25Cfg?.ventilation ?? []).map(sys =>
    mvhrIds.includes(sys.id ?? sys.name) ? { ...sys, hre: 0, hre_enabled: false } : sys
  )
  const v40Cfg  = building?.systems_config_v40
  const v40Vent = (v40Cfg?.ventilation ?? []).map(sys =>
    mvhrIds.includes(sys.id)
      ? { ...sys, efficiency_metric: { ...(sys.efficiency_metric ?? {}), recovery_sensible_pct: 0, recovery_latent_pct: 0 } }
      : sys
  )
  return {
    ...building,
    systems_config_v25: v25Cfg ? { ...v25Cfg, ventilation: v25Vent } : v25Cfg,
    systems_config_v40: v40Cfg ? { ...v40Cfg, ventilation: v40Vent } : v40Cfg,
  }
}

// ── Run all three states ──────────────────────────────────────────────────
console.log()
console.log('Running engine — State A (MVHR fully enabled)...')
const buildingON  = withMvhrToggled(baseBuilding, true)
const resultON    = runEngine(buildingON)

console.log('Running engine — State B (MVHR fully disabled — system removed)...')
const buildingOFF = withMvhrToggled(baseBuilding, false)
const resultOFF   = runEngine(buildingOFF)

console.log('Running engine — State C (HRE = 0 only — system kept, recovery off, fans still run)...')
const buildingC = withMvhrHreZeroed(baseBuilding)
const resultC   = runEngine(buildingC)

// ── Extract the diagnostic numbers ────────────────────────────────────────
function pick(result) {
  const sh    = result?.consumption?.space_heating ?? {}
  const sv    = result?.system_performance?.ventilation?.total ?? {}
  const eu    = result?.energy_use?.totals ?? {}
  const s2    = result?.heat_balance?.annual?.losses ?? {}
  const s2vent = s2?.ventilation ?? null
  const s2venta = s2?.ventilation_air_change ?? null
  return {
    sh_demand_mwh:       sh.demand_mwh ?? null,           // RAW (display denominator)
    sh_delivered_mwh:    sh.delivered_mwh ?? null,        // post-MVHR × share
    sh_electricity_mwh:  sh.electricity_mwh ?? null,      // per-service heating elec
    sh_gas_mwh:          sh.gas_mwh ?? null,
    sh_recovery_off_mwh: sh.recovery_offset_mwh ?? null,
    vent_fan_kwh:        sv.fan_kwh ?? null,
    vent_recovery_mwh:   sv.recovery_mwh ?? null,
    vent_recovery_theo:  sv.recovery_theoretical_mwh ?? null,
    elec_total_kwh:      eu.electricity_kwh ?? null,
    gas_total_kwh:       eu.gas_kwh ?? null,
    eui:                 eu.eui_kwh_per_m2 ?? null,
    s2_vent_loss_kwh:    typeof s2vent === 'number' ? s2vent : (s2vent?.kwh ?? s2venta?.kwh ?? null),
    s2_raw:              s2,
  }
}

const A = pick(resultON)
const B = pick(resultOFF)
const C = pick(resultC)

function fmt(v, dp = 1) {
  if (v == null || !Number.isFinite(v)) return '—'
  return Number(v).toFixed(dp)
}

console.log()
console.log('========================================================')
console.log('  RESULTS — clean Bridgewater, MVHR ON vs OFF')
console.log('========================================================')
console.log()
console.log('  Boundaries surfaced (consumption.space_heating):')
console.log('    Quantity                          MVHR ON       MVHR OFF      Δ (OFF − ON)')
console.log('    ────────────────────────────────────────────────────────────────────────')
console.log(`    demand_mwh        (RAW, pre-MVHR)  ${fmt(A.sh_demand_mwh, 2).padStart(8)} MWh    ${fmt(B.sh_demand_mwh, 2).padStart(8)} MWh    ${fmt((B.sh_demand_mwh ?? 0) - (A.sh_demand_mwh ?? 0), 2).padStart(8)} MWh`)
console.log(`    delivered_mwh     (post-MVHR)      ${fmt(A.sh_delivered_mwh, 2).padStart(8)} MWh    ${fmt(B.sh_delivered_mwh, 2).padStart(8)} MWh    ${fmt((B.sh_delivered_mwh ?? 0) - (A.sh_delivered_mwh ?? 0), 2).padStart(8)} MWh`)
console.log(`    recovery_offset_mwh                ${fmt(A.sh_recovery_off_mwh, 2).padStart(8)} MWh    ${fmt(B.sh_recovery_off_mwh, 2).padStart(8)} MWh    ${fmt((B.sh_recovery_off_mwh ?? 0) - (A.sh_recovery_off_mwh ?? 0), 2).padStart(8)} MWh`)
console.log(`    electricity_mwh   (heating fuel)   ${fmt(A.sh_electricity_mwh, 2).padStart(8)} MWh    ${fmt(B.sh_electricity_mwh, 2).padStart(8)} MWh    ${fmt((B.sh_electricity_mwh ?? 0) - (A.sh_electricity_mwh ?? 0), 2).padStart(8)} MWh  ← SMOKING GUN`)
console.log(`    gas_mwh           (heating fuel)   ${fmt(A.sh_gas_mwh, 2).padStart(8)} MWh    ${fmt(B.sh_gas_mwh, 2).padStart(8)} MWh    ${fmt((B.sh_gas_mwh ?? 0) - (A.sh_gas_mwh ?? 0), 2).padStart(8)} MWh`)
console.log()
console.log('  Ventilation (system_performance.ventilation.total):')
console.log('    Quantity                          MVHR ON       MVHR OFF      Δ (OFF − ON)')
console.log('    ────────────────────────────────────────────────────────────────────────')
console.log(`    fan_kwh           (all vents)      ${fmt(A.vent_fan_kwh / 1000, 2).padStart(8)} MWh    ${fmt(B.vent_fan_kwh / 1000, 2).padStart(8)} MWh    ${fmt(((B.vent_fan_kwh ?? 0) - (A.vent_fan_kwh ?? 0)) / 1000, 2).padStart(8)} MWh  ← CANCELLATION CANDIDATE`)
console.log(`    recovery_mwh      (effective)      ${fmt(A.vent_recovery_mwh, 2).padStart(8)} MWh    ${fmt(B.vent_recovery_mwh, 2).padStart(8)} MWh    ${fmt((B.vent_recovery_mwh ?? 0) - (A.vent_recovery_mwh ?? 0), 2).padStart(8)} MWh`)
console.log(`    recovery_theo_mwh (uncapped)       ${fmt(A.vent_recovery_theo, 2).padStart(8)} MWh    ${fmt(B.vent_recovery_theo, 2).padStart(8)} MWh    ${fmt((B.vent_recovery_theo ?? 0) - (A.vent_recovery_theo ?? 0), 2).padStart(8)} MWh`)
console.log()
console.log('  Totals (energy_use.totals):')
console.log('    Quantity                          MVHR ON       MVHR OFF      Δ (OFF − ON)')
console.log('    ────────────────────────────────────────────────────────────────────────')
console.log(`    electricity_kwh   (whole bldg)     ${fmt(A.elec_total_kwh / 1000, 2).padStart(8)} MWh    ${fmt(B.elec_total_kwh / 1000, 2).padStart(8)} MWh    ${fmt(((B.elec_total_kwh ?? 0) - (A.elec_total_kwh ?? 0)) / 1000, 2).padStart(8)} MWh  ← OBSERVED ≈ 0`)
console.log(`    gas_kwh           (whole bldg)     ${fmt(A.gas_total_kwh / 1000, 2).padStart(8)} MWh    ${fmt(B.gas_total_kwh / 1000, 2).padStart(8)} MWh    ${fmt(((B.gas_total_kwh ?? 0) - (A.gas_total_kwh ?? 0)) / 1000, 2).padStart(8)} MWh`)
console.log(`    EUI                                ${fmt(A.eui, 2).padStart(8)} kWh/m²·yr  ${fmt(B.eui, 2).padStart(8)} kWh/m²·yr  ${fmt((B.eui ?? 0) - (A.eui ?? 0), 2).padStart(8)} kWh/m²·yr`)
console.log()
console.log('  State 2 ventilation loss component (heat_balance.annual.losses):')
console.log(`    Loss keys present (MVHR ON): ${Object.keys(A.s2_raw).join(', ')}`)
console.log(`    ventilation loss field         ${fmt(A.s2_vent_loss_kwh / 1000, 2).padStart(8)} MWh / yr  (NOT a separate line in heat_balance — implicit in heating_demand)`)
console.log(`    Δ raw demand (OFF − ON) = ${fmt((B.sh_demand_mwh ?? 0) - (A.sh_demand_mwh ?? 0), 2)} MWh — this IS the MVHR's contribution to State 2 demand (net of HRE)`)
console.log()
console.log('  Variant State C — HRE = 0 only (system + fan kept, recovery off):')
console.log('    Quantity                          MVHR ON       State C       Δ (C − ON)')
console.log('    ────────────────────────────────────────────────────────────────────────')
console.log(`    raw demand                         ${fmt(A.sh_demand_mwh, 2).padStart(8)} MWh    ${fmt(C.sh_demand_mwh, 2).padStart(8)} MWh    ${fmt((C.sh_demand_mwh ?? 0) - (A.sh_demand_mwh ?? 0), 2).padStart(8)} MWh`)
console.log(`    delivered_mwh                      ${fmt(A.sh_delivered_mwh, 2).padStart(8)} MWh    ${fmt(C.sh_delivered_mwh, 2).padStart(8)} MWh    ${fmt((C.sh_delivered_mwh ?? 0) - (A.sh_delivered_mwh ?? 0), 2).padStart(8)} MWh`)
console.log(`    recovery_offset_mwh                ${fmt(A.sh_recovery_off_mwh, 2).padStart(8)} MWh    ${fmt(C.sh_recovery_off_mwh, 2).padStart(8)} MWh    ${fmt((C.sh_recovery_off_mwh ?? 0) - (A.sh_recovery_off_mwh ?? 0), 2).padStart(8)} MWh`)
console.log(`    heating electricity                ${fmt(A.sh_electricity_mwh, 2).padStart(8)} MWh    ${fmt(C.sh_electricity_mwh, 2).padStart(8)} MWh    ${fmt((C.sh_electricity_mwh ?? 0) - (A.sh_electricity_mwh ?? 0), 2).padStart(8)} MWh`)
console.log(`    fan_kwh                            ${fmt(A.vent_fan_kwh / 1000, 2).padStart(8)} MWh    ${fmt(C.vent_fan_kwh / 1000, 2).padStart(8)} MWh    ${fmt(((C.vent_fan_kwh ?? 0) - (A.vent_fan_kwh ?? 0)) / 1000, 2).padStart(8)} MWh`)
console.log(`    electricity_total                  ${fmt(A.elec_total_kwh / 1000, 2).padStart(8)} MWh    ${fmt(C.elec_total_kwh / 1000, 2).padStart(8)} MWh    ${fmt(((C.elec_total_kwh ?? 0) - (A.elec_total_kwh ?? 0)) / 1000, 2).padStart(8)} MWh`)
console.log(`    EUI                                ${fmt(A.eui, 2).padStart(8)}              ${fmt(C.eui, 2).padStart(8)}              ${fmt((C.eui ?? 0) - (A.eui ?? 0), 2).padStart(8)}`)
console.log()

// ── Hand-calc cross-checks (from Chris's note) ────────────────────────────
const HAND_SFP = 1.40, HAND_FLOW = 1425, HAND_HRE = 0.75
const HAND_FAN_CONT_MWH = HAND_SFP * HAND_FLOW * 8760 / 1000 / 1000

console.log('  Hand-calc cross-check (Chris\'s real MVHR system values):')
console.log(`    SFP × flow × 8760 = ${HAND_SFP} × ${HAND_FLOW} × 8760 / 1e6 = ${fmt(HAND_FAN_CONT_MWH, 2)} MWh continuous MVHR fan`)
console.log(`    HRE = ${HAND_HRE}  (degree-day recovery ceiling ≈ 67 MWh per Chris)`)
console.log()

// ── Verdict logic ────────────────────────────────────────────────────────
const delta_heating_elec   = (B.sh_electricity_mwh ?? 0) - (A.sh_electricity_mwh ?? 0)
const delta_heating_deliv  = (B.sh_delivered_mwh   ?? 0) - (A.sh_delivered_mwh   ?? 0)
const delta_total_elec_mwh = ((B.elec_total_kwh ?? 0) - (A.elec_total_kwh ?? 0)) / 1000
const fan_mvhr_mwh         = ((A.vent_fan_kwh ?? 0) - (B.vent_fan_kwh ?? 0)) / 1000  // fan in ON state minus OFF = the MVHR fan contribution
const recovery_eff_mwh     = A.vent_recovery_mwh ?? 0
const s2_vent_loss_mwh     = (A.s2_vent_loss_kwh ?? 0) / 1000

console.log('========================================================')
console.log('  VERDICT')
console.log('========================================================')
console.log()
console.log(`  Δ heating delivered  (OFF − ON)  = ${fmt(delta_heating_deliv, 2)} MWh   [expect ≈ +recovery_eff (~61)]`)
console.log(`  Δ heating electricity (OFF − ON) = ${fmt(delta_heating_elec, 2)} MWh   [if H1: ≈ recovery_eff/SCOP ≈ 16–22 MWh]`)
console.log(`  Δ total electricity   (OFF − ON) = ${fmt(delta_total_elec_mwh, 2)} MWh   [observed ≈ 0]`)
console.log(`  MVHR fan contribution (ON state) = ${fmt(fan_mvhr_mwh, 2)} MWh   [hand-calc ≈ ${fmt(HAND_FAN_CONT_MWH, 2)} MWh]`)
console.log(`  Effective recovery (ON state)    = ${fmt(recovery_eff_mwh, 2)} MWh   [hand-calc ceiling ≈ 67 MWh]`)
console.log(`  State 2 ventilation loss          = ${fmt(s2_vent_loss_mwh, 2)} MWh`)
console.log()

// Decision tree
let verdict = null
let reasoning = []

// H3 first: can ventilation physically supply the recovery?
const max_phys_recovery = s2_vent_loss_mwh * HAND_HRE  // crudest plausibility: vent_loss × HRE
if (s2_vent_loss_mwh > 0 && recovery_eff_mwh > s2_vent_loss_mwh * 1.05) {
  verdict = 'H3 (recovery magnitude overstated)'
  reasoning.push(`Effective recovery ${fmt(recovery_eff_mwh)} MWh > ventilation airstream heat content ${fmt(s2_vent_loss_mwh)} MWh — physically impossible.`)
} else if (Math.abs(delta_heating_elec) < 1.0) {
  verdict = 'H2 (fuel path NOT crediting recovery — reopens)'
  reasoning.push(`Δ heating electricity ≈ 0 MWh despite Δ delivered = ${fmt(delta_heating_deliv)} MWh. Code trace had ruled this out; live engine disagrees — find the missed path.`)
} else if (delta_heating_elec > 5 && delta_heating_elec < 30) {
  verdict = 'H1 (display + fuel both correct; total-elec flatness is real cancellation)'
  reasoning.push(`Δ heating electricity = ${fmt(delta_heating_elec)} MWh ≈ recovery_eff / SCOP. Heating fuel correctly responds to MVHR toggle.`)
  if (Math.abs(fan_mvhr_mwh - HAND_FAN_CONT_MWH) < 2) {
    reasoning.push(`MVHR fan ${fmt(fan_mvhr_mwh)} MWh matches hand-calc ${fmt(HAND_FAN_CONT_MWH)} MWh — fan side correct too.`)
  }
  if (Math.abs(delta_heating_elec - fan_mvhr_mwh) < 3) {
    reasoning.push(`Δ heating elec (${fmt(delta_heating_elec)}) ≈ MVHR fan (${fmt(fan_mvhr_mwh)}) — they cancel, explaining total Δ ≈ 0.`)
  } else {
    reasoning.push(`Δ heating elec (${fmt(delta_heating_elec)}) DOES NOT closely match MVHR fan (${fmt(fan_mvhr_mwh)}); residual = ${fmt(delta_heating_elec - fan_mvhr_mwh)} MWh — explains the small observed Δ total elec ${fmt(delta_total_elec_mwh)}.`)
  }
} else {
  verdict = 'UNCLEAR (results don\'t fit any of H1/H2/H3 cleanly)'
  reasoning.push(`Δ heating electricity = ${fmt(delta_heating_elec)} MWh — outside the expected range of either H1 (~16–22) or H2 (~0). Manual re-investigation needed.`)
}

console.log(`  >> ${verdict}`)
for (const r of reasoning) console.log(`     · ${r}`)
console.log()
console.log(`  Bridgewater anchor (MVHR ON, EUI):    ${fmt(A.eui, 2)} kWh/m²·yr   [expect ≈ 121.9]`)
console.log()

// ── Emit a JSON summary for the audit doc to consume ─────────────────────
const summary = {
  project_id:          PROJECT_ID,
  project_name:        project.name,
  mvhr_ids_toggled:    mvhrIds,
  hand_calc_inputs:    { SFP_W_per_l_s: HAND_SFP, flow_l_s: HAND_FLOW, HRE: HAND_HRE,
                         continuous_fan_mwh: HAND_FAN_CONT_MWH },
  state_A_mvhr_on:     A,
  state_B_mvhr_off:    B,
  state_C_hre_zero:    C,
  deltas: {
    heating_delivered_mwh:  delta_heating_deliv,
    heating_electricity_mwh: delta_heating_elec,
    total_electricity_mwh:   delta_total_elec_mwh,
    mvhr_fan_mwh:            fan_mvhr_mwh,
  },
  verdict, reasoning,
}
const OUT = path.join(REPO_ROOT, 'docs/audit/_brief49_diagnostic_run.json')
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2))
console.log(`  JSON summary written to: ${path.relative(REPO_ROOT, OUT)}`)
console.log()
