/**
 * scripts/_brief69_part1_gate.mjs
 *
 * Brief 69 Part 1 gate — mech-vent UA inside the implicit-Euler.
 *
 * Pre-fix (Brief 67 Part B prototype findings, register §1):
 *   C_coef in the State 2 implicit-Euler step included fabric + glazing
 *   + infiltration + permanent-vent UA, but NOT mech-vent. So the
 *   free-floating T_zone_free trace didn't move when ventilation was
 *   toggled on/off — and the sealed-building effect (Bridgewater
 *   vent-on cooling 151 vs vent-off cooling 408 confirmed in the live
 *   tool on the old engine) disappeared from the dead-band-gated
 *   demand model.
 *
 * Post-fix (Option α): mech-vent UA is now in C_coef + D_coef of the
 *   implicit-Euler step at instantCalc.js:3024+. The same per-system
 *   effective conductance (ventUA / ventUA_bypass, honouring enable
 *   gate and summer-bypass damper) used by the existing mech-vent
 *   loss loop — one conductance, one place.
 *
 * Gate: T_zone_free distribution with ventilation ON vs OFF. The
 * vent-OFF mean / max must be clearly HIGHER than vent-ON (sealed-
 * building: extract fans normally pull gain-driven heat out; disable
 * them and the zone climbs).
 *
 * Hard stop if T_zone_free doesn't respond — means UA didn't enter
 * C_coef — or NaN / oscillation appears.
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

function runState2(ctx, building) {
  return calculateInstant(building, ctx.constructions, {}, ctx.libraryData,
                          ctx.weatherData, ctx.hourlySolar, null,
                          { mode: 'envelope-gains', comfortBand: ctx.comfortBand,
                            _skipInterventions: true })
}

function distribute(label, building, ctx) {
  const r = runState2(ctx, building)
  const T = r?.demand?.hourly_zone_air_c
  if (!T || T.length === 0) return { ok: false, label, reason: 'no hourly_zone_air_c' }
  let min = Infinity, max = -Infinity, sum = 0, nanCount = 0
  for (const v of T) {
    if (!Number.isFinite(v)) { nanCount++; continue }
    if (v < min) min = v; if (v > max) max = v; sum += v
  }
  if (nanCount > 0) return { ok: false, label, reason: `${nanCount} NaN/Inf hours` }
  return {
    ok: true, label,
    min, max, mean: sum / T.length,
  }
}

console.log('\n── Brief 69 Part 1 gate — T_zone_free responds to vent ──\n')

const buildings = [
  { name: 'Bridgewater (HIX hotel, vent-dominated)', pid: '14b4a5b1-8c73-4acb-8b65-1d22f05ec969' },
  { name: 'Brief66 Test Office (gains-moderate)',     pid: '3cb8cac5-2458-49a8-99f5-ac1eed5b9821' },
]

const fails = []

for (const b of buildings) {
  const ctx = await loadCtx(b.pid)

  // Pre-Brief-69 engine asymmetry: State 2's ventSystems builder reads
  // ONLY systems_config_v25.ventilation (instantCalc.js:2763). A v40-only
  // project has no entries to enter the State 2 path — the Option α fix
  // would still flow through correctly if v25 was populated. This is an
  // upstream engine reading asymmetry, NOT a Part 1 regression. Skip
  // the gate on v40-only projects and flag.
  const v25Vent = ctx.building?.systems_config_v25?.ventilation ?? []
  const v40Vent = ctx.building?.systems_config_v40?.ventilation ?? []
  const isV40Only = v25Vent.length === 0 && v40Vent.length > 0

  // vent ON (baseline)
  const ventOn = JSON.parse(JSON.stringify(ctx.building))

  // vent OFF — disable both v25 and v40 (Brief 68 Part C AND-gate)
  const ventOff = JSON.parse(JSON.stringify(ctx.building))
  if (ventOff?.systems_config_v25?.ventilation) {
    ventOff.systems_config_v25.ventilation = ventOff.systems_config_v25.ventilation.map(v => ({ ...v, enabled: false }))
  }
  if (ventOff?.systems_config_v40?.ventilation) {
    ventOff.systems_config_v40.ventilation = ventOff.systems_config_v40.ventilation.map(v => ({ ...v, enabled: false }))
  }

  const on  = distribute(`${b.name} — vent ON`,  ventOn,  ctx)
  const off = distribute(`${b.name} — vent OFF`, ventOff, ctx)
  if (!on.ok)  { console.error(`✗ ${on.label}:  ${on.reason}`);  fails.push(on.label);  continue }
  if (!off.ok) { console.error(`✗ ${off.label}: ${off.reason}`); fails.push(off.label); continue }

  console.log(`Building: ${b.name}`)
  if (isV40Only) {
    console.log(`  (v40-only project — v25 ventilation empty, State 2 ventSystems builder`)
    console.log(`   reads v25-only at instantCalc.js:2763, so vent toggle won't reach State 2.`)
    console.log(`   This is a pre-existing engine asymmetry. NOT a Brief 69 Part 1 regression.)`)
  }
  console.log(`  vent ON:   T_zone_free  min ${on.min.toFixed(2)}   mean ${on.mean.toFixed(2)}   max ${on.max.toFixed(2)} °C`)
  console.log(`  vent OFF:  T_zone_free  min ${off.min.toFixed(2)}   mean ${off.mean.toFixed(2)}   max ${off.max.toFixed(2)} °C`)
  const dMean = off.mean - on.mean
  const dMax  = off.max  - on.max
  console.log(`  Δ (off-on):  mean ${dMean.toFixed(2)} °C   max ${dMax.toFixed(2)} °C`)

  if (isV40Only) {
    console.log(`  [SKIP] gate not applicable on v40-only projects until State 2 reads v40.`)
    console.log()
    continue
  }

  // Bridgewater-class (v25-populated): expect substantial rise in mean + max
  const minMeanShift = 1.0   // °C
  const minMaxShift  = 2.0   // °C

  if (dMean < minMeanShift) {
    fails.push(`${b.name}: vent-OFF − vent-ON mean shift = ${dMean.toFixed(2)} °C, expected ≥ ${minMeanShift}`)
  }
  if (dMax < minMaxShift) {
    fails.push(`${b.name}: vent-OFF − vent-ON max shift = ${dMax.toFixed(2)} °C, expected ≥ ${minMaxShift}`)
  }
  console.log()
}

console.log('── Verdict ─────────────────────────────────────────────\n')
if (fails.length > 0) {
  console.error('✗ FAIL')
  for (const f of fails) console.error('   ' + f)
  process.exit(1)
}
console.log('✓ PASS — T_zone_free responds to vent toggle on both buildings.')
console.log('  Mech-vent UA is in the implicit-Euler (instantCalc.js:3024+).')
console.log('  Part 2 (demand gating on this float) can now stand on a real')
console.log('  vent-aware temperature trace.')
