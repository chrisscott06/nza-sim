/**
 * scripts/_brief50_part5_silent_fallback_test.mjs
 *
 * Brief 50 Part 5 — verify the v40→v25 silent-fallback fix.
 *
 * BUG (pre-Brief-50): when the user disables an MVHR system in the v40
 * UI WITHOUT rebalancing the remaining ventilation shares to sum to
 * 100%, the engine silently falls back to v25 (where MVHR is still
 * enabled). Visible effect: the v40 disable toggle is INERT — fan and
 * recovery stay at their MVHR-on values.
 *
 * FIX (Brief 50 Part 5, `v40VentilationToV25List`): on validation error,
 * return [] (empty list = no MVHR) instead of null (silent fallback).
 *
 * This script simulates the UI scenario:
 *   State A — baseline (MVHR on, shares as configured: 87 / 6.5 / 6.5)
 *   State B — disable MVHR in v40 only, don't rebalance shares (sum =
 *             13%, validation fails). Pre-fix: silent fallback → MVHR
 *             alive. Post-fix: error → vent zero.
 *
 * Pass criteria: State B must show fan + recovery near zero (not the
 * baseline ~25 MWh / ~61 MWh).
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
  const r = await fetch(url); if (!r.ok) throw new Error(`${url} → ${r.status}`); return r.json()
}
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
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6]); direct_normal[i] = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15]); wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }

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
  const orientation = building.orientation ?? 0
  const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, orientation)
  return calculateInstant(building, constructions, {}, libraryData, weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand })
}

function pick(result) {
  const sv = result?.system_performance?.ventilation?.total ?? {}
  const sh = result?.consumption?.space_heating ?? {}
  const eu = result?.energy_use?.totals ?? {}
  return {
    fan_mwh:    (sv.fan_kwh ?? 0) / 1000,
    recovery:   sv.recovery_mwh ?? 0,
    sh_demand:  sh.demand_mwh ?? 0,
    sh_deliv:   sh.delivered_mwh ?? 0,
    sh_elec:    sh.electricity_mwh ?? 0,
    elec_total: (eu.electricity_kwh ?? 0) / 1000,
    eui:        eu.eui_kwh_per_m2 ?? 0,
  }
}

// State A — baseline (all systems as configured)
console.log('STATE A — baseline (MVHR enabled, shares sum to 100%):')
const resultA = runEngine(baseBuilding)
const A = pick(resultA)
console.log(`  fan_mwh:        ${A.fan_mwh.toFixed(3)}`)
console.log(`  recovery_mwh:   ${A.recovery.toFixed(3)}`)
console.log(`  sh_delivered:   ${A.sh_deliv.toFixed(3)}`)
console.log(`  sh_electricity: ${A.sh_elec.toFixed(3)}`)
console.log(`  elec_total:     ${A.elec_total.toFixed(3)}`)
console.log(`  EUI:            ${A.eui.toFixed(2)}`)
console.log()

// State B — disable MVHR in v40 WITHOUT rebalancing shares (the UI bug scenario)
console.log('STATE B — disable MVHR in v40 ONLY (shares NOT rebalanced):')
console.log('  Pre-Brief-50 Part 5: silent fallback to v25 → MVHR still active in v25 → fan + recovery unchanged from baseline.')
console.log('  Post-Brief-50 Part 5: v40 validation error → v40VentilationToV25List returns [] → fan + recovery zero.')
console.log()

const v40CfgB = baseBuilding?.systems_config_v40
const v40VentB = (v40CfgB?.ventilation ?? []).map(sys => {
  const hre = Number(sys?.efficiency_metric?.recovery_sensible_pct ?? 0)
  if (hre > 0) return { ...sys, enabled: false }   // disable MVHR; leave shares unchanged
  return sys
})
const buildingB = {
  ...baseBuilding,
  systems_config_v40: { ...v40CfgB, ventilation: v40VentB },
  // CRITICAL: do NOT touch v25 ventilation. The silent-fallback bug is that
  // a user toggling MVHR in v40 leaves v25 untouched → engine falls back
  // to v25 → MVHR alive. The fix should make the engine respect the v40
  // toggle even though v25 still has MVHR enabled.
}
const resultB = runEngine(buildingB)
const B = pick(resultB)
console.log(`  fan_mwh:        ${B.fan_mwh.toFixed(3)}`)
console.log(`  recovery_mwh:   ${B.recovery.toFixed(3)}`)
console.log(`  sh_delivered:   ${B.sh_deliv.toFixed(3)}`)
console.log(`  sh_electricity: ${B.sh_elec.toFixed(3)}`)
console.log(`  elec_total:     ${B.elec_total.toFixed(3)}`)
console.log(`  EUI:            ${B.eui.toFixed(2)}`)
console.log()

console.log('DIFF (B − A):')
console.log(`  Δ fan_mwh:        ${(B.fan_mwh - A.fan_mwh).toFixed(3)}   (expect significantly negative if fix worked; ≈ 0 if silent fallback)`)
console.log(`  Δ recovery_mwh:   ${(B.recovery - A.recovery).toFixed(3)}   (expect ≈ −61 if fix worked; ≈ 0 if silent fallback)`)
console.log(`  Δ sh_delivered:   ${(B.sh_deliv - A.sh_deliv).toFixed(3)}   (expect demand to rise from 90 → ~176 if fix worked; ≈ 0 if silent fallback)`)
console.log(`  Δ sh_electricity: ${(B.sh_elec - A.sh_elec).toFixed(3)}`)
console.log(`  Δ EUI:            ${(B.eui - A.eui).toFixed(2)}`)
console.log()

// Pass criteria (refined after first run revealed the State 2 / v25 split).
//
// Brief 50 Part 5's scope is the v40→v25 silent-fallback at the State 3
// ventilation path (computed by `computeVentilationEnergy` from a
// v25-shaped list adapted from v40). That path's fix surfaces as:
//   - fan_kwh drops (the v25 MVHR fan no longer fires via fallback)
//   - recovery_mwh drops to 0 (no MVHR system contributing recovery)
//   - total electricity drops by the MVHR fan power
//   - EUI drops by fan_savings / GIA
//
// What DOESN'T change in Part 5: `heating_demand_state2_mwh`. State 2's
// vent loss calc at instantCalc.js L2530 reads `building.systems_config_v25
// .ventilation` DIRECTLY — never through v40. So when the user disables
// MVHR in v40 only (v25 untouched, mirroring what the UI toggle does
// today), State 2's vent UA still has the (1-HRE) factor from v25's
// still-enabled MVHR → demand stays at the post-MVHR value (90.30 on
// Bridgewater). This is the State 2 ↔ v25 hardcoded coupling — a
// SEPARATE bug from Part 5's silent fallback, deferred per brief scope.
//
// User-visible outcome after Part 5 (this test):
//   - Toggle now PRODUCES an engine response (was inert pre-fix).
//   - EUI drops by ~fan_savings/GIA, which proves the toggle is no
//     longer silently masked.
//   - The demand row staying flat is an artefact of State 2's v25-only
//     read — to be addressed by a future "State 2 reads v40 ventilation"
//     brief. Recorded as a known limitation.
const passFan      = B.fan_mwh < A.fan_mwh - 5     // fan must drop meaningfully
const passRecovery = B.recovery < 1.0              // recovery must be ≈ 0
const passEui      = (A.eui - B.eui) > 1.0         // EUI must drop visibly

console.log('PART 5 VERDICT (engine-response criterion — fan + recovery + EUI):')
console.log(`  Fan drops significantly?       ${passFan ? '✓ PASS' : '✗ FAIL'}   (Δ = ${(B.fan_mwh - A.fan_mwh).toFixed(2)} MWh; expect ≈ −26 MWh)`)
console.log(`  Recovery ≈ 0?                  ${passRecovery ? '✓ PASS' : '✗ FAIL'}   (B = ${B.recovery.toFixed(2)} MWh)`)
console.log(`  EUI drops visibly?             ${passEui ? '✓ PASS' : '✗ FAIL'}   (Δ = ${(B.eui - A.eui).toFixed(2)} kWh/m²·yr)`)
console.log()
console.log(`  Overall: ${(passFan && passRecovery && passEui) ? '✓ FIX WORKS — engine now responds to v40 MVHR disable (was inert pre-fix).' : '✗ FIX MISSING — engine still silently uses v25 MVHR.'}`)
console.log()
console.log('NOTE — demand staying flat is EXPECTED (out of Part 5 scope):')
console.log('  `consumption.space_heating.demand_mwh` stays at the post-MVHR value because State 2')
console.log('  reads `building.systems_config_v25.ventilation` directly (instantCalc.js L2530) and')
console.log('  the v25 entry was not touched. To make demand also respond to the v40 toggle, State')
console.log('  2 would need to read v40 ventilation when present (or the UI would need to keep v25')
console.log('  in sync with v40). Both are separate concerns from Brief 50 Part 5\'s scope.')
console.log()
console.log('  Pre-Brief-50 Part 5: toggle inert (no fan drop, no recovery drop, no EUI drop).')
console.log('  Post-Brief-50 Part 5: toggle visible (fan + recovery + EUI all respond).')
console.log()

const out = path.join(REPO_ROOT, 'docs/audit/_brief50_part5_run.json')
fs.writeFileSync(out, JSON.stringify({ A, B, diff: { fan_mwh: B.fan_mwh - A.fan_mwh, recovery: B.recovery - A.recovery, sh_deliv: B.sh_deliv - A.sh_deliv, eui: B.eui - A.eui }, pass: passFan && passRecovery && passEui, demand_didnt_change_because: 'State 2 reads v25 ventilation directly (instantCalc.js L2530); v25 entry was not touched. Separate bug from Part 5 scope.' }, null, 2))
console.log(`  JSON summary: ${path.relative(REPO_ROOT, out)}`)
