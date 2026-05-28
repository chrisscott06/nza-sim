/**
 * scripts/_brief67_partA_gate.mjs
 *
 * Brief 67 Part A gate — T_zone_free trajectory exists, is sensible.
 *
 * Discovery during Part A read-through:
 *   State 2's hour-loop ALREADY computes a free-floating zone-air
 *   temperature with full physics — fabric losses, solar gain (transmitted
 *   + absorbed), internal gains (people/lighting/equipment), ventilation
 *   loss, infiltration loss, and a thermal-mass implicit-Euler step.
 *   The implicit-Euler step (instantCalc.js:3018-3031) has NO conditioning
 *   feedback — heating/cooling power is not subtracted from the air
 *   balance. So T_air there IS T_zone_free as Brief 67 defines it:
 *   "the zone air temperature resulting from the full heat balance with
 *   NO active heating/cooling."
 *
 *   The array is surfaced at the State 2 result as
 *   `losses_at_setpoint.hourly_zone_air_c` (instantCalc.js:3877).
 *
 *   ⇒ NO engine change needed for Part A. Reuse this existing trace
 *      (per Brief 67's "avoid a second temperature path — two-sources-
 *      of-truth is the recurring disease").
 *
 * This script:
 *   1. Loads Bridgewater + the Brief 66 test office.
 *   2. Runs both with State 2 control_strategy='active_setpoint' (current
 *      default — Brief 64) and reads `hourly_zone_air_c`.
 *   3. Computes the annual distribution: min, max, mean, p10, p50, p90,
 *      hours per 1°C bin.
 *   4. Hand-calc gate: physically-sensible distribution
 *      (winter night dips below heating setpoint; gains-heavy office
 *       summer afternoon exceeds cooling setpoint).
 *
 * Hard stops (per brief §Part A):
 *   • T_zone_free constant across the year   ⇒ float isn't being computed
 *   • T_zone_free pinned to a setpoint       ⇒ engine still clamping mid-loop
 *   • Any NaN in the trace                   ⇒ math broken
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

function runState2(ctx) {
  return calculateInstant(ctx.building, ctx.constructions, {}, ctx.libraryData,
                          ctx.weatherData, ctx.hourlySolar, null,
                          { mode: 'envelope-gains', comfortBand: ctx.comfortBand,
                            _skipInterventions: true })
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.floor((p / 100) * (sorted.length - 1))
  return sorted[idx]
}

function summarise(label, ctx) {
  const r = runState2(ctx)
  // Source: instantCalc.js:3877 — T_air_hourly is surfaced under `demand`,
  // labelled hourly_zone_air_c. T_op (operative = ½(T_air+T_radiant)) is
  // at free_running.hourly_temperature_c. Brief 67 demand gating reads
  // T_air not T_op, so use the demand path.
  const T = r?.demand?.hourly_zone_air_c
  if (!T || T.length === 0) {
    return { ok: false, label, reason: `no hourly_zone_air_c on result.demand` }
  }
  // Coerce Float32Array → array for sort etc.
  const Tarr = Array.from(T)
  let nanCount = 0
  for (const v of Tarr) if (!Number.isFinite(v)) nanCount++
  if (nanCount > 0) {
    return { ok: false, label, reason: `${nanCount} NaN/Inf hours in hourly_zone_air_c` }
  }

  let min = Infinity, max = -Infinity, sum = 0
  for (const v of Tarr) { if (v < min) min = v; if (v > max) max = v; sum += v }
  const mean = sum / Tarr.length
  const p10 = percentile(Tarr, 10)
  const p50 = percentile(Tarr, 50)
  const p90 = percentile(Tarr, 90)

  // 1°C bins from floor(min) to ceil(max) — inclusive on lower
  const minBin = Math.floor(min), maxBin = Math.ceil(max)
  const bins = new Map()
  for (let b = minBin; b <= maxBin; b++) bins.set(b, 0)
  for (const v of Tarr) bins.set(Math.floor(v), (bins.get(Math.floor(v)) ?? 0) + 1)

  return {
    ok: true, label,
    n: Tarr.length,
    min, max, mean, p10, p50, p90,
    bins,
    comfortBand: ctx.comfortBand,
  }
}

console.log('\n── Brief 67 Part A gate — T_zone_free trajectory sanity ──\n')

const buildings = [
  { name: 'Bridgewater (HIX hotel)',           pid: '14b4a5b1-8c73-4acb-8b65-1d22f05ec969' },
  { name: 'Brief66 Test Office (gains-mod)',   pid: '3cb8cac5-2458-49a8-99f5-ac1eed5b9821' },
]

const results = []
for (const b of buildings) {
  const ctx = await loadCtx(b.pid)
  const r = summarise(b.name, ctx)
  if (!r.ok) {
    console.error(`\n✗ FAIL — ${r.label}: ${r.reason}`)
    process.exit(1)
  }
  results.push(r)
}

for (const r of results) {
  console.log(`\nBuilding:  ${r.label}`)
  console.log(`Comfort:   [${r.comfortBand.lower_c}, ${r.comfortBand.upper_c}] °C`)
  console.log(`Hours:     ${r.n}`)
  console.log(`T_zone_free:`)
  console.log(`  min      ${r.min.toFixed(2)} °C`)
  console.log(`  max      ${r.max.toFixed(2)} °C`)
  console.log(`  mean     ${r.mean.toFixed(2)} °C`)
  console.log(`  p10/50/90  ${r.p10.toFixed(1)} / ${r.p50.toFixed(1)} / ${r.p90.toFixed(1)} °C`)
  console.log(`  span     ${(r.max - r.min).toFixed(2)} °C`)
  // 1°C bin distribution (compact)
  const sorted = [...r.bins.entries()].sort((a, b) => a[0] - b[0])
  const totalH = sorted.reduce((s, [_, c]) => s + c, 0)
  console.log(`  bin histogram (1°C bins, ${sorted.length} bins, ${totalH} hours):`)
  // Compress to one line per 5°C, with hours-in-band
  let bandStart = sorted[0][0]
  let bandHours = 0
  for (const [b, c] of sorted) {
    bandHours += c
    if (b - bandStart >= 4 || b === sorted[sorted.length - 1][0]) {
      const bandEnd = b
      const bar = '█'.repeat(Math.min(40, Math.round(bandHours / totalH * 40)))
      console.log(`    [${String(bandStart).padStart(3)}, ${String(bandEnd).padStart(3)})  ${String(bandHours).padStart(5)} h  ${bar}`)
      bandStart = b + 1
      bandHours = 0
    }
  }
}

// ── Hand-calc gates ─────────────────────────────────────────────────────
const gates = []
const office = results.find(r => r.label.includes('Office'))
const bridge = results.find(r => r.label.includes('Bridgewater'))

// 1. Span: non-constant (i.e. real trace, not pinned)
for (const r of results) {
  const span = r.max - r.min
  gates.push({
    name: `${r.label}: T_zone_free span > 5 °C (free-floating, not pinned)`,
    pass: span > 5,
    detail: `span = ${span.toFixed(2)} °C`,
  })
}

// 2. Office (gains-moderate): summer maximum exceeds upper setpoint
gates.push({
  name: `Office: summer max > upper setpoint (gains push above cooling sp)`,
  pass: office.max > office.comfortBand.upper_c,
  detail: `max = ${office.max.toFixed(2)} °C, upper sp = ${office.comfortBand.upper_c} °C`,
})

// 3. Both: winter min falls below heating setpoint (free-floating, no heating fired)
gates.push({
  name: `Office: winter min < lower setpoint (no conditioning ⇒ zone dips)`,
  pass: office.min < office.comfortBand.lower_c,
  detail: `min = ${office.min.toFixed(2)} °C, lower sp = ${office.comfortBand.lower_c} °C`,
})
gates.push({
  name: `Bridgewater: winter min < lower setpoint (no conditioning ⇒ zone dips)`,
  pass: bridge.min < bridge.comfortBand.lower_c,
  detail: `min = ${bridge.min.toFixed(2)} °C, lower sp = ${bridge.comfortBand.lower_c} °C`,
})

// 4. Both: mean within a plausible UK indoor range. Free-floating gains-
//    dominated buildings (Bridgewater hotel with 401-person peak occupancy)
//    drift HIGH when uncooled, so the upper bound has to be wide enough to
//    reflect "this building NEEDS cooling" rather than fail the gate.
for (const r of results) {
  gates.push({
    name: `${r.label}: mean ∈ [5, 35] °C (UK indoor plausibility, free-floating)`,
    pass: r.mean >= 5 && r.mean <= 35,
    detail: `mean = ${r.mean.toFixed(2)} °C`,
  })
}

// 5. Both: max is finite and < 60 °C (sanity — no thermal runaway)
for (const r of results) {
  gates.push({
    name: `${r.label}: max finite and < 60 °C (no thermal runaway)`,
    pass: Number.isFinite(r.max) && r.max < 60,
    detail: `max = ${r.max.toFixed(2)} °C`,
  })
}

console.log('\n── Gates ───────────────────────────────────────────────\n')
let failed = 0
for (const g of gates) {
  const mark = g.pass ? '✓' : '✗'
  console.log(`  ${mark}  ${g.name}`)
  console.log(`        ${g.detail}`)
  if (!g.pass) failed++
}

console.log()
if (failed > 0) {
  console.error(`✗ ${failed} gate(s) FAILED — T_zone_free is not behaving physically.`)
  console.error(`  Per brief §Part A: HARD STOP if T_zone_free is constant, pinned, or NaN.`)
  process.exit(1)
}
console.log(`✓ All ${gates.length} gates PASS — T_zone_free trace is physically sensible.`)
console.log(`  Brief 67 Part A diagnostic backbone — verified.`)
console.log(`  Source: instantCalc.js:3031 (State 2 implicit-Euler T_air step,`)
console.log(`  surfaced at result.demand.hourly_zone_air_c, line 3877).`)
console.log(`  No engine change for Part A — diagnostic exists already.`)
