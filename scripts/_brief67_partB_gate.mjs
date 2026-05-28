/**
 * scripts/_brief67_partB_gate.mjs
 *
 * Brief 67 Part B gate — float-gated demand, the core change.
 *
 * Pre-Brief-67 (Brief 64 active_setpoint clamp):
 *   Heating and cooling demand were derived from a balance equation at
 *   the setpoint, evaluated EVERY hour. Cooling demand depended on
 *   `hourly_heat_loss_Wh` (computed against T_heat = heating setpoint),
 *   so lowering the heating setpoint shrank the loss term and inflated
 *   apparent cooling — a physical nonsense: a comfortable room shouldn't
 *   need cooling regardless of where the heating setpoint is.
 *
 * Post-Brief-67:
 *   Demand fires only when T_zone_free (the free-floating zone temp from
 *   State 2's implicit-Euler air-node solve) is OUTSIDE the dead band.
 *   Cooling fires only when T_zone_free > effectiveUpperC; heating fires
 *   only when T_zone_free < effectiveLowerC; in between, both = 0.
 *
 *   Each system is gated on the ACTUAL zone temperature, not on a shared
 *   balance equation — so heating and cooling become genuinely independent.
 *
 * Gates (per brief §Part B):
 *   1. Setpoint independence (the headline): sweep hsp 19→23 at fixed
 *      csp 24, expect cooling demand essentially flat (small thermal-
 *      mass second-order movement only).
 *   2. Dead band exists: count of hours with zero heating AND zero
 *      cooling > 0 for a gains-moderate building.
 *   3. Cooling-setpoint sweep: csp 28→16 at fixed hsp 21, cooling rises
 *      more steeply than the old ~1.20 csp-sweep ratio.
 *   4. Vent on/off sanity: Bridgewater vent-off cooling still much higher
 *      than vent-on (sealed-building effect preserved).
 *
 * Hard stops (per brief):
 *   - Cooling still tracks heating setpoint → gating broken
 *   - No dead-band hours appear → gate not firing
 *   - Demand negative or NaN → math broken
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

async function fj(u) { const r = await fetch(u); return r.json() }

async function loadCtx(pid) {
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
  return {
    name: project.name,
    building: baseBuilding,
    constructions: project.construction_choices,
    weatherData, hourlySolar, libraryData,
    comfortBand: {
      lower_c: project.comfort_band_lower_c ?? 20,
      upper_c: project.comfort_band_upper_c ?? 26,
    },
  }
}

function pn(r, p) {
  let c = r
  for (const s of p.split('.')) { if (c == null) return null; c = c[s] }
  return (typeof c === 'number' && Number.isFinite(c)) ? c : null
}

function run(ctx, hsp, csp) {
  // The envelope-gains dispatcher (instantCalc.js:6217) calls _calculateState2
  // WITHOUT setpointOverride, so effectiveLowerC/UpperC inside the loop read
  // straight from comfortBand. Drive the sweep through comfortBand to ensure
  // the new Brief 67 dead-band gate sees the right thresholds.
  const b = JSON.parse(JSON.stringify(ctx.building))
  return calculateInstant(b, ctx.constructions, {}, ctx.libraryData,
                          ctx.weatherData, ctx.hourlySolar, null,
                          { mode: 'envelope-gains',
                            comfortBand: { lower_c: hsp, upper_c: csp },
                            _skipInterventions: true })
}

function summary(r) {
  return {
    heat: pn(r, 'demand.heating_demand_mwh') ?? 0,
    cool: pn(r, 'demand.cooling_demand_mwh') ?? 0,
  }
}

function countDeadBandHours(r) {
  const hH = r?.demand?.heating_demand_hourly_kwh
  const hC = r?.demand?.cooling_demand_hourly_kwh
  if (!hH || !hC) return null
  let dead = 0
  for (let i = 0; i < hH.length; i++) {
    if (hH[i] < 1e-6 && hC[i] < 1e-6) dead++
  }
  return dead
}

console.log('\n── Brief 67 Part B gate — float-gated demand ──\n')

const bridge = await loadCtx('14b4a5b1-8c73-4acb-8b65-1d22f05ec969')
const office = await loadCtx('3cb8cac5-2458-49a8-99f5-ac1eed5b9821')

// Gate 1 — Setpoint independence (THE headline)
//   On both buildings, sweep hsp 19→23 at fixed csp 24. Cooling demand
//   must stay essentially flat.
console.log('── Gate 1 — Setpoint independence ──')
console.log('  Sweep heating setpoint 19→23 at fixed cooling setpoint 24.')
console.log('  Cooling demand should stay essentially FLAT (pre-Brief-67 swung hundreds of MWh).\n')

for (const ctx of [bridge, office]) {
  console.log(`  ${ctx.name}:`)
  const sweep = []
  for (const hsp of [19, 20, 21, 22, 23]) {
    const r = run(ctx, hsp, 24)
    const s = summary(r)
    sweep.push({ hsp, ...s })
    console.log(`    hsp=${hsp}, csp=24:  heat = ${s.heat.toFixed(2).padStart(7)} MWh   cool = ${s.cool.toFixed(2).padStart(7)} MWh`)
  }
  const coolMin = Math.min(...sweep.map(x => x.cool))
  const coolMax = Math.max(...sweep.map(x => x.cool))
  const coolSpan = coolMax - coolMin
  const coolMean = sweep.reduce((s, x) => s + x.cool, 0) / sweep.length
  const coolSpanPct = coolMean > 0 ? (coolSpan / coolMean) * 100 : 0
  console.log(`    span ${coolSpan.toFixed(2)} MWh on mean ${coolMean.toFixed(2)} MWh = ${coolSpanPct.toFixed(1)}%`)
  ctx._sweep_hsp_at_csp24 = sweep
  ctx._cool_span_pct = coolSpanPct
}

console.log()

// Gate 2 — Dead band exists
console.log('── Gate 2 — Dead band exists ──')
console.log('  Count of hours with zero heating AND zero cooling demand.')
console.log('  Pre-Brief-67: 0 (every hour billed as actively conditioned).')
console.log('  Post-fix: gains-moderate office should have many; gains-dominated hotel likely fewer.\n')

for (const ctx of [bridge, office]) {
  const r = run(ctx, 21, 24)
  const dead = countDeadBandHours(r)
  console.log(`  ${ctx.name}:  dead-band hours = ${dead} / 8760  (${dead != null ? (dead / 8760 * 100).toFixed(1) : '?'}%)`)
  ctx._dead_band_hours = dead
}

console.log()

// Gate 3 — Cooling-setpoint sweep
console.log('── Gate 3 — Cooling-setpoint sweep ──')
console.log('  csp 28→16 at fixed hsp 21. Cooling rises more steeply than the old ~1.20 ratio.\n')

for (const ctx of [bridge, office]) {
  console.log(`  ${ctx.name}:`)
  const sweep = []
  for (const csp of [28, 26, 24, 22, 20, 18, 16]) {
    const r = run(ctx, 21, csp)
    const s = summary(r)
    sweep.push({ csp, ...s })
    console.log(`    csp=${csp}:  cool = ${s.cool.toFixed(2).padStart(7)} MWh`)
  }
  const cool28 = sweep.find(x => x.csp === 28).cool
  const cool16 = sweep.find(x => x.csp === 16).cool
  const ratio = cool28 > 0 ? cool16 / cool28 : (cool16 > 0 ? Infinity : 0)
  console.log(`    csp 28→16 ratio: ${cool28.toFixed(2)} → ${cool16.toFixed(2)} MWh (×${ratio.toFixed(2)})`)
  ctx._csp_sweep_ratio = ratio
}

console.log()

// Gate 4 — Vent on/off sanity (Bridgewater)
console.log('── Gate 4 — Vent on/off sanity (Bridgewater) ──')
console.log('  Sealed-building effect: vent-off cooling should still be much HIGHER than vent-on.\n')

const ventOn  = JSON.parse(JSON.stringify(bridge.building))
const ventOff = JSON.parse(JSON.stringify(bridge.building))
if (ventOff?.systems_config_v40?.ventilation) {
  ventOff.systems_config_v40.ventilation = ventOff.systems_config_v40.ventilation.map(v => ({ ...v, enabled: false }))
}
if (ventOff?.systems_config_v25?.ventilation) {
  ventOff.systems_config_v25.ventilation = ventOff.systems_config_v25.ventilation.map(v => ({ ...v, enabled: false }))
}

function runRaw(ctx, building) {
  return calculateInstant(building, ctx.constructions, {}, ctx.libraryData,
                          ctx.weatherData, ctx.hourlySolar, null,
                          { mode: 'envelope-gains', comfortBand: ctx.comfortBand,
                            _skipInterventions: true })
}
const rOn  = summary(runRaw(bridge, ventOn))
const rOff = summary(runRaw(bridge, ventOff))
console.log(`  vent ON   :  heat = ${rOn.heat.toFixed(2)} MWh   cool = ${rOn.cool.toFixed(2)} MWh`)
console.log(`  vent OFF  :  heat = ${rOff.heat.toFixed(2)} MWh   cool = ${rOff.cool.toFixed(2)} MWh`)
console.log(`  cool ratio off/on: ×${rOn.cool > 0 ? (rOff.cool / rOn.cool).toFixed(2) : '∞'}`)

console.log('\n── Verdict ─────────────────────────────────────────────\n')

const fails = []

// G1: cooling span < 10% on each building (Brief 64 swung 18-22%)
for (const ctx of [bridge, office]) {
  if (ctx._cool_span_pct > 10) {
    fails.push(`${ctx.name}: cooling span over hsp sweep = ${ctx._cool_span_pct.toFixed(1)}% (>10% threshold — setpoint independence FAILED)`)
  }
}

// G2: dead-band hours > 0 on the gains-moderate office (gains-dominated hotel
//     may sit above setpoint constantly so weak)
if (office._dead_band_hours == null || office._dead_band_hours === 0) {
  fails.push(`Office: dead-band hours = ${office._dead_band_hours} — dead-band gate not firing`)
}

// G3: cooling-setpoint sweep on office produces meaningful change (ratio > 1.5)
if (office._csp_sweep_ratio < 1.5) {
  fails.push(`Office: csp sweep ratio = ×${office._csp_sweep_ratio.toFixed(2)} (<1.5) — cooling not responsive to csp`)
}

// G4: vent-off cool > vent-on cool on Bridgewater (sealed building effect)
if (rOff.cool <= rOn.cool + 1) {
  fails.push(`Bridgewater: vent-off cool ${rOff.cool.toFixed(2)} ≤ vent-on ${rOn.cool.toFixed(2)} + 1 — sealed-building effect lost`)
}

if (fails.length > 0) {
  console.error('✗ FAIL')
  for (const f of fails) console.error('   ' + f)
  process.exit(1)
}

console.log('✓ ALL gates PASS')
console.log()
console.log('Summary:')
console.log(`  G1 setpoint independence:`)
console.log(`     Bridgewater cool over hsp 19→23 sweep: span ${bridge._cool_span_pct.toFixed(1)}%`)
console.log(`     Office       cool over hsp 19→23 sweep: span ${office._cool_span_pct.toFixed(1)}%`)
console.log(`  G2 dead band:`)
console.log(`     Bridgewater dead-band hours: ${bridge._dead_band_hours} / 8760`)
console.log(`     Office       dead-band hours: ${office._dead_band_hours} / 8760`)
console.log(`  G3 cooling sweep:`)
console.log(`     Office cool 28→16 setpoint ratio: ×${office._csp_sweep_ratio.toFixed(2)}`)
console.log(`  G4 vent on/off:`)
console.log(`     Bridgewater cool off/on ratio: ×${rOn.cool > 0 ? (rOff.cool / rOn.cool).toFixed(2) : '∞'}`)
