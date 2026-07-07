/**
 * internal_mass_sweep.mjs - Brief 85 P1.2 internal-mass sweep (read-only).
 *
 * Re-runs the NZA engine across a range of internal-mass values (via the now-live
 * opts.tuning hook, Brief 85 P0.3) and captures, per mass, how the free-float
 * zone-temp delta vs EnergyPlus and the demand/mech-vent metrics respond. Used to
 * partition the +1.10 C free-float delta between mass-explained and residual
 * solver-convention (Brief 85 Step 1).
 *
 * Read-only: passes opts.tuning, persists nothing in the engine. Writes a CSV
 * (validation/sweeps/85_internal_mass_sweep.csv) + an ASCII console table.
 *
 * Reads:  validation/fixtures/bridgewater_box_v1.yaml
 *         validation/energyplus/results/bridgewater_box_v1_mvhr_hourly.csv  (EP zone temp, outdoor,
 *                                                                            supply-air coil flags, net mech-vent)
 * Run:    node validation/nza_sim/internal_mass_sweep.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { calculateInstant } from '../../frontend/src/utils/instantCalc.js'
import { loadFixtureYaml, buildEngineInputs, REPO_ROOT } from './load_fixture.mjs'

const FIXTURE = path.join(REPO_ROOT, 'validation', 'fixtures', 'bridgewater_box_v1.yaml')
const EP_MVHR = path.join(REPO_ROOT, 'validation', 'energyplus', 'results', 'bridgewater_box_v1_mvhr_hourly.csv')
const SWEEP_DIR = path.join(REPO_ROOT, 'validation', 'sweeps')
const EPS = 1e-6
const EP_H = 3.2775, EP_C = 0.6768   // EnergyPlus heating / cooling demand (MWh), Brief 81

const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN)
const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))) }
const pearson = (xs, ys) => {
  const mx = mean(xs), my = mean(ys)
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < xs.length; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy }
  return (sxx === 0 || syy === 0) ? NaN : sxy / Math.sqrt(sxx * syy)
}
const f = (x, n = 3) => (x == null || Number.isNaN(x) ? 'n/a' : x.toFixed(n))
const pct = (v, ref) => 100 * (v - ref) / ref

// EP per-hour
const epLines = fs.readFileSync(EP_MVHR, 'utf-8').split(/\r?\n/).filter(l => l.length)
const ep = []
for (let i = 1; i < epLines.length; i++) {
  const p = epLines[i].split(',')
  ep.push({
    odb: parseFloat(p[4]), zt: parseFloat(p[5]),
    netH: parseFloat(p[10]), supH: parseFloat(p[12]), supC: parseFloat(p[13]),
    hour: parseInt(p[3]),
  })
}
const epFree = ep.map(r => r.supH <= EPS && r.supC <= EPS)     // EP unconditioned (fixed reference set)
const epHeatCoil = ep.map(r => r.supH > EPS)                   // EP heating coil running
const epNetH_coil = ep.reduce((s, r, h) => s + (epHeatCoil[h] ? r.netH : 0), 0) / 1000  // MWh (like-for-like baseline)

const inputs = buildEngineInputs(loadFixtureYaml(FIXTURE), REPO_ROOT)

function run(massJ) {
  const opts = { comfortBand: inputs.comfortBand, _skipInterventions: true, engine: 'v2.5' }
  if (massJ != null) opts.tuning = { internal_mass_J_per_K_per_m2: massJ }
  const r = calculateInstant(inputs.building, inputs.constructions, {}, inputs.libraryData,
    inputs.weatherData, inputs.hourlySolar, null, opts)
  const ff = Array.from(r.demand.hourly_zone_air_free_c)
  const heat = Array.from(r.demand.heating_demand_hourly_kwh)
  const cool = Array.from(r.demand.cooling_demand_hourly_kwh)
  const mvW = Array.from(r.demand.mech_vent_loss_hourly_w)
  const dAll = [], dNight = [], dDay = [], odb = [], dT = [], ffSub = []
  let nzaFree = 0, mvNzaCoil = 0
  for (let h = 0; h < ep.length; h++) {
    if (heat[h] <= EPS && cool[h] <= EPS) nzaFree++
    if (epHeatCoil[h]) mvNzaCoil += mvW[h]                       // NZA mech-vent over EP heating-coil hrs (W)
    if (!epFree[h]) continue
    const d = ff[h] - ep[h].zt
    dAll.push(d); odb.push(ep[h].odb); dT.push(ep[h].zt - ep[h].odb); ffSub.push(ff[h])
    const ho = ep[h].hour
    if (ho >= 1 && ho <= 6 || ho >= 22) dNight.push(d); else if (ho >= 11 && ho <= 16) dDay.push(d)
  }
  const Hsum = heat.reduce((s, x) => s + x, 0) / 1000   // MWh
  const Csum = cool.reduce((s, x) => s + x, 0) / 1000
  const mvLLF = mvNzaCoil / 1e6                          // MWh, NZA mech-vent over EP heating-coil hrs
  return {
    massJ, massMJ: massJ * 100 / 1e6,
    deltaMean: mean(dAll), deltaNight: mean(dNight), deltaDay: mean(dDay),
    rOdb: pearson(odb, dAll), rDt: pearson(dT, dAll),
    ffStd: std(ffSub), ffRange: Math.max(...ffSub) - Math.min(...ffSub),
    Hsum, Hpct: pct(Hsum, EP_H), Csum, Cpct: pct(Csum, EP_C),
    nzaFree, mvLLF, mvPct: pct(mvLLF, epNetH_coil),
  }
}

const masses = [0, 100000, 250000, 500000, 831513, 1000000]
const rows = masses.map(run)

// CSV
fs.mkdirSync(SWEEP_DIR, { recursive: true })
const hdr = 'internal_mass_J_per_K_per_m2,internal_mass_MJ_per_K,freefloat_delta_mean_c,freefloat_delta_night_c,freefloat_delta_midday_c,r_delta_outdoor,r_delta_dT,nza_freefloat_std_c,nza_freefloat_range_c,heating_mwh,heating_pct_vs_ep,cooling_mwh,cooling_pct_vs_ep,nza_freefloat_hours,mechvent_llf_mwh,mechvent_llf_pct_vs_ep'
const csv = [hdr, ...rows.map(r => [
  r.massJ, r.massMJ.toFixed(2), r.deltaMean.toFixed(4), r.deltaNight.toFixed(4), r.deltaDay.toFixed(4),
  r.rOdb.toFixed(3), r.rDt.toFixed(3), r.ffStd.toFixed(4), r.ffRange.toFixed(4),
  r.Hsum.toFixed(4), r.Hpct.toFixed(1), r.Csum.toFixed(4), r.Cpct.toFixed(1),
  r.nzaFree, r.mvLLF.toFixed(4), r.mvPct.toFixed(1),
].join(','))].join('\n') + '\n'
const outPath = path.join(SWEEP_DIR, '85_internal_mass_sweep.csv')
fs.writeFileSync(outPath, csv, 'utf-8')

// console
console.log(`[sweep] EP-unconditioned ref hours: ${epFree.filter(Boolean).length}; EP net mech-vent over heating-coil hrs: ${epNetH_coil.toFixed(4)} MWh`)
console.log(`[sweep] EP targets: heating ${EP_H} MWh, cooling ${EP_C} MWh`)
console.log('mass(MJ/K) | dMean | dNight | dMidday | r_odb | r_dT | ff_std | ff_range | heat(MWh,%) | cool(MWh,%) | mvLLF(%)')
for (const r of rows) {
  console.log(`${r.massMJ.toFixed(1).padStart(6)} | ${f(r.deltaMean)} | ${f(r.deltaNight)} | ${f(r.deltaDay)} | `
    + `${f(r.rOdb, 2)} | ${f(r.rDt, 2)} | ${f(r.ffStd)} | ${f(r.ffRange, 2)} | `
    + `${r.Hsum.toFixed(3)}/${r.Hpct.toFixed(0)}% | ${r.Csum.toFixed(3)}/${r.Cpct.toFixed(0)}% | ${r.mvPct.toFixed(1)}%`)
}
// mass_min + residual
const mm = rows.reduce((best, r) => (r.deltaMean < best.deltaMean ? r : best), rows[0])
console.log(`[sweep] mass_min = ${mm.massMJ.toFixed(1)} MJ/K (param ${mm.massJ}); delta_residual = ${mm.deltaMean.toFixed(3)} C`)
console.log(`[sweep] delta at 0 mass = ${rows[0].deltaMean.toFixed(3)} C; mass-explained = ${(rows[0].deltaMean - mm.deltaMean).toFixed(3)} C`)
console.log(`[sweep] wrote ${path.relative(REPO_ROOT, outPath)}`)
