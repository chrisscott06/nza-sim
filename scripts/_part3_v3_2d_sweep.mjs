/**
 * scripts/_part3_v3_2d_sweep.mjs — 2D sweep (mass × absorption) for Part 3 v3.
 *
 * Pure 1D absorption sweep showed summer max regression past halt threshold.
 * Hypothesis: combining higher mass (which damps summer max) with absorption
 * (which raises mean T) can satisfy both criteria simultaneously.
 *
 * Cells: mass ∈ [100, 150, 200, 250] × absorption ∈ [0.05, 0.07, 0.10, 0.12]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const API = 'http://127.0.0.1:8002'
const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'

const EP_REF = { annual_mean_c: 19.8, summer_max_c: 35.4, winter_min_c: 8.3, heating_demand_mwh: 110.2, cooling_demand_mwh: 61.7 }

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json() }

const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const lib = await fj(`${API}/api/library/constructions`)
const libArr = Array.isArray(lib) ? lib : (lib.constructions ?? [])
const libraryData = {
  constructions: libArr.map(c => ({
    name: c.name, type: c.type ?? c.config_json?.type,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c, layers: c.layers,
  })),
}
const bc = project.building_config
const cc = project.construction_choices

const epwPath = path.join(REPO_ROOT, 'data/weather/current', bc.weather_file)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const epwLat = parseFloat(epwLines[0].split(',')[6])
const dl = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dl.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), direct_normal = new Float32Array(N)
const diffuse_horizontal = new Float32Array(N), wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dl[i].split(',')
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6]); direct_normal[i] = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15]); wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, epwLat, bc.orientation ?? 0)
const cb = { lower_c: project.comfort_band_lower_c ?? 20, upper_c: project.comfort_band_upper_c ?? 26 }

function run(absorption, mass_kJ) {
  const r = calculateInstant(
    { ...bc, comfort_band: cb }, cc, {}, libraryData,
    weatherData, hourlySolar, null,
    { mode: 'envelope-only', comfortBand: cb,
      tuning: {
        glazing_inside_absorption_fraction: absorption,
        internal_mass_J_per_K_per_m2: mass_kJ * 1000,
      } },
  )
  return {
    mean: r.free_running.annual_mean_c, max: r.free_running.summer_max_c, min: r.free_running.winter_min_c,
    heat: r.demand.heating_demand_mwh, cool: r.demand.cooling_demand_mwh,
  }
}

const absorptions = [0.05, 0.07, 0.10, 0.12]
const masses = [100, 150, 200, 250]

console.log()
console.log('=== Part 3 v3 2D sweep: absorption × mass (Bridgewater env-only) ===')
console.log(`EP target: mean ${EP_REF.annual_mean_c} | max ${EP_REF.summer_max_c} | min ${EP_REF.winter_min_c} | heat ${EP_REF.heating_demand_mwh} | cool ${EP_REF.cooling_demand_mwh}`)
console.log()
console.log('Pass criteria (all 4):')
console.log('  (a) mean T within 0.5 K of EP 19.8')
console.log('  (b) summer max within 0.5 K of EP 35.4')
console.log('  (c) winter min improves (above v2 baseline of 4.2 K)')
console.log('  (d) cooling demand moves toward EP 61.7')
console.log()

const results = []
for (const m of masses) {
  console.log(`-- mass = ${m} kJ/(K·m²) --`)
  console.log('  α        mean    max    min    heat   cool    Δmean     Δmax     Δmin     Δcool    Pass?')
  console.log('  ----   ------ ------ ------  ------ ------    ------   ------   ------   ------    -----')
  for (const a of absorptions) {
    const out = run(a, m)
    const dmean = out.mean - EP_REF.annual_mean_c
    const dmax  = out.max - EP_REF.summer_max_c
    const dmin  = out.min - EP_REF.winter_min_c
    const dcool = out.cool - EP_REF.cooling_demand_mwh
    const passes_a = Math.abs(dmean) <= 0.5
    const passes_b = Math.abs(dmax) <= 0.5
    const passes_c = out.min > 4.2
    const passes_d = (out.cool >= 40.3 && out.cool <= 61.7 * 1.5) // moved toward EP from v2 baseline 40.3
    const all = passes_a && passes_b && passes_c && passes_d
    results.push({ absorption: a, mass: m, out, passes: { a: passes_a, b: passes_b, c: passes_c, d: passes_d, all } })
    console.log(
      `  ${a.toFixed(2)}   ${out.mean.toFixed(2).padStart(6)} ${out.max.toFixed(2).padStart(6)} ${out.min.toFixed(2).padStart(6)}` +
      `  ${out.heat.toFixed(1).padStart(6)} ${out.cool.toFixed(1).padStart(6)}` +
      `    ${(dmean >= 0 ? '+' : '') + dmean.toFixed(2)} K ${(dmax >= 0 ? '+' : '') + dmax.toFixed(2)} K ${(dmin >= 0 ? '+' : '') + dmin.toFixed(2)} K  ${(dcool >= 0 ? '+' : '') + dcool.toFixed(1)} MWh` +
      `   ${passes_a ? '✓a' : '✗a'} ${passes_b ? '✓b' : '✗b'} ${passes_c ? '✓c' : '✗c'} ${passes_d ? '✓d' : '✗d'}` +
      (all ? '  ←  PASS ALL' : '')
    )
  }
  console.log()
}

const passing = results.filter(r => r.passes.all)
console.log('=== SUMMARY ===')
console.log(`Total cells: ${results.length}`)
console.log(`Cells passing all 4 criteria: ${passing.length}`)
if (passing.length > 0) {
  console.log('Pass cells (closest to EP mean first):')
  passing.sort((x, y) => Math.abs(x.out.mean - EP_REF.annual_mean_c) - Math.abs(y.out.mean - EP_REF.annual_mean_c))
  for (const p of passing) {
    console.log(`  α=${p.absorption}  mass=${p.mass} kJ/(K·m²)  → mean=${p.out.mean.toFixed(2)}  max=${p.out.max.toFixed(2)}  min=${p.out.min.toFixed(2)}  cool=${p.out.cool.toFixed(1)}`)
  }
}

const outPath = path.join(REPO_ROOT, 'docs/validation/_part3_v3_2d_sweep_dump.json')
fs.writeFileSync(outPath, JSON.stringify({ ep_ref: EP_REF, results, passing }, null, 2))
console.log()
console.log(`Wrote: ${outPath}`)
