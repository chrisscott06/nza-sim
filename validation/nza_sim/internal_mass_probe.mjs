/**
 * internal_mass_probe.mjs - Brief 84b P5 (read-only sensitivity probe).
 *
 * Quantifies how much of the ~+1 C free-float zone-temp delta (NZA warmer than EP)
 * is attributable to NZA's lumped internal-mass capacitance term. Uses the engine's
 * EXISTING tuning hook `opts.tuning.internal_mass_J_per_K_per_m2` (instantCalc.js
 * L2602, also used by tests) - NO engine code change, NO persisted change.
 *
 * For each internal-mass value it re-runs the engine, then over the FIXED reference
 * set of EnergyPlus-unconditioned hours computes the mean free-float delta
 *   delta_ff = mean( NZA hourly_zone_air_free_c  -  EP zone_mean_air_temp_c )
 * (NZA's pre-clamp free-float trace isolates the mass effect from NZA's own clamping;
 * over EP-unconditioned hours EP's zone temp IS its free-float).
 *
 * default = 250000 J/K/m2 (live); 100000 = the value the tuning comment cites as the
 * summer-max best match; 50000 = lightweight; 0 = no internal mass (EP-box-like).
 *
 * Reads:  validation/fixtures/bridgewater_box_v1.yaml
 *         validation/energyplus/results/bridgewater_box_v1_hourly_temps.csv
 * Run:    node validation/nza_sim/internal_mass_probe.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { calculateInstant } from '../../frontend/src/utils/instantCalc.js'
import { loadFixtureYaml, buildEngineInputs, REPO_ROOT } from './load_fixture.mjs'

const FIXTURE = path.join(REPO_ROOT, 'validation', 'fixtures', 'bridgewater_box_v1.yaml')
const EP_CSV = path.join(REPO_ROOT, 'validation', 'energyplus', 'results', 'bridgewater_box_v1_hourly_temps.csv')
const EPS = 1e-6

const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN)
const f = (x, n = 3) => (x == null || Number.isNaN(x) ? 'n/a' : x.toFixed(n))

// EP hourly: zone temp + demand + hour-of-day
function loadEp() {
  const lines = fs.readFileSync(EP_CSV, 'utf-8').split(/\r?\n/).filter(l => l.length)
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',')
    rows.push({
      hour: parseInt(p[3]), zt: parseFloat(p[4]), odb: parseFloat(p[5]),
      heat: parseFloat(p[6]), cool: parseFloat(p[7]),
    })
  }
  return rows
}

const ep = loadEp()
const epFree = ep.map(r => r.heat <= EPS && r.cool <= EPS)  // EP unconditioned (fixed reference set)
const nEpFree = epFree.filter(Boolean).length

const inputs = buildEngineInputs(loadFixtureYaml(FIXTURE), REPO_ROOT)

function runWithMass(massJ) {
  const opts = { comfortBand: inputs.comfortBand, _skipInterventions: true, engine: 'v2.5' }
  if (massJ != null) opts.tuning = { internal_mass_J_per_K_per_m2: massJ }
  const result = calculateInstant(
    inputs.building, inputs.constructions, {}, inputs.libraryData,
    inputs.weatherData, inputs.hourlySolar, null, opts,
  )
  const ff = Array.from(result.demand.hourly_zone_air_free_c)
  const heat = Array.from(result.demand.heating_demand_hourly_kwh)
  const cool = Array.from(result.demand.cooling_demand_hourly_kwh)
  // delta over EP-unconditioned hours (fixed set)
  const all = [], night = [], day = []
  let nzaFreeHrs = 0
  for (let h = 0; h < ep.length; h++) {
    if (heat[h] <= EPS && cool[h] <= EPS) nzaFreeHrs++
    if (!epFree[h]) continue
    const d = ff[h] - ep[h].zt
    all.push(d)
    const ho = ep[h].hour
    if (ho >= 1 && ho <= 6 || ho >= 22) night.push(d); else if (ho >= 11 && ho <= 16) day.push(d)
  }
  return {
    massJ, meanAll: mean(all), meanNight: mean(night), meanDay: mean(day),
    nzaFreeHrs, nHeat: heat.filter(x => x > EPS).length, nCool: cool.filter(x => x > EPS).length,
    Hsum: heat.reduce((s, x) => s + x, 0), Csum: cool.reduce((s, x) => s + x, 0),
  }
}

const masses = [250000, 100000, 50000, 25000, 0]
const rows = masses.map(runWithMass)

console.log(`[mass-probe] EP-unconditioned reference hours: ${nEpFree}`)
console.log(`[mass-probe] internal_mass(J/K/m2) | freefloat delta (all / night / midday, C) | NZA free hrs | NZA heat/cool kWh`)
for (const r of rows) {
  console.log(`  ${String(r.massJ).padStart(7)} | ${f(r.meanAll)} / ${f(r.meanNight)} / ${f(r.meanDay)} | ${String(r.nzaFreeHrs).padStart(4)} | ${r.Hsum.toFixed(0)}/${r.Csum.toFixed(0)}`)
}
// linear-ish attribution
const base = rows[0], zero = rows[rows.length - 1]
console.log(`[mass-probe] delta at default(250k)=${f(base.meanAll)} C; at 0=${f(zero.meanAll)} C; `
  + `mass accounts for ${f(base.meanAll - zero.meanAll)} C (${f(100*(base.meanAll-zero.meanAll)/base.meanAll,0)}%), `
  + `residual at mass=0 is ${f(zero.meanAll)} C.`)
