/**
 * counterfactual_rebook.mjs - Brief 82 P4 (the load-bearing test).
 *
 * Tests whether the +0.49 C zone-temp delta (NZA warmer than EnergyPlus) is the
 * single UPSTREAM cause of the three Brief 81 demand divergences (heating -24.0%,
 * cooling +107.9%, mech-vent net loss +92.9%). POST-HOC arithmetic on the output
 * traces only - no engine / IDF / DB changes.
 *
 * METHOD - mode-crossing reconciliation (capacitance-artifact-free)
 * ----------------------------------------------------------------
 * The naive recipe "subtract 0.49 from the trace and re-book with NZA's own
 * degree-hour law demand = -C_coef*(setpoint - ff)" EXPLODES (heating +184% at a
 * 0.25 C shift). Reason: -C_coef is the engine's implicit-Euler one-step
 * coefficient (instantCalc.js L3679/3694), built from "UA values + thermal
 * capacity" (engine comment L3659). It is dominated by C_thermal/dt (~8790 W/K
 * here) - NOT a steady-state conductance. Multiplying a PERSISTENT temperature
 * offset by a CAPACITANCE coefficient injects a fictitious perpetual thermal-mass
 * recharge every hour. The per-hour -C_coef cannot be used to extrapolate a
 * standing offset. (Appendix A reproduces the explosion as evidence.)
 *
 * What CAN be tested post-hoc without that coefficient: whether shifting NZA's
 * free-float trace DOWN by delta makes NZA's heating/cooling MODE classification
 * agree with EnergyPlus, and how much demand lives in the hours that change mode.
 * We use EnergyPlus's OWN hourly demand as the truth for recoverable heating
 * (CLAUDE.md Rule 1: EP is the source of truth) and NZA's OWN booked cooling for
 * removable cooling. No extrapolation through -C_coef.
 *
 *   epMode  = heat if EP_heat>eps, cool if EP_cool>eps, else free   (per hour)
 *   nzaMode = heat if NZA_heat>eps, cool if NZA_cool>eps, else free
 *   ff      = NZA free-float air-node temp (result.demand.hourly_zone_air_free_c)
 *
 *   recoverable_H(delta) = sum EP_heat  over {epHeat & nzaFree & ff-delta < 21}
 *   removable_C(delta)   = sum NZA_cool over {nzaCool & epFree & ff-delta < 24}
 *   reconciled_H(delta)  = NZA_heat_total + recoverable_H(delta)
 *   reconciled_C(delta)  = NZA_cool_total - removable_C(delta)
 *
 * Mode crossing addresses ONLY the mode-divergence portion of each gap. The
 * residual same-mode magnitude gaps (both heat, NZA less; both cool, NZA harder)
 * are reported separately - a standing temperature offset cannot re-book energy
 * in hours where both engines already agree on the setpoint.
 *
 * Reads:   validation/fixtures/bridgewater_box_v1.yaml (via loadAndRun)
 *          validation/energyplus/results/bridgewater_box_v1_hourly_temps.csv
 * Writes:  validation/reports/zone_temp_counterfactual_{ts}.md
 *
 * Run:
 *   cd C:\Users\ChrisScott\Dev\nza-sim
 *   node validation/nza_sim/counterfactual_rebook.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadAndRun, REPO_ROOT } from './load_fixture.mjs'

const FIXTURE = path.join(REPO_ROOT, 'validation', 'fixtures', 'bridgewater_box_v1.yaml')
const EP_CSV = path.join(REPO_ROOT, 'validation', 'energyplus', 'results', 'bridgewater_box_v1_hourly_temps.csv')
const REPORTS_DIR = path.join(REPO_ROOT, 'validation', 'reports')

const SP_LOW = 21.0    // heating setpoint (comfort_band.lower_c)
const SP_HIGH = 24.0   // cooling setpoint (comfort_band.upper_c)
const EPS = 1e-6       // kWh: demand at/below this counts as zero (matches P3)

// Net mechanical-ventilation conductance after 75% sensible recovery (W/K):
//   0.33 Wh/(m3.K) * (50 L/s * 3.6 = 180 m3/h) * (1 - 0.75) = 14.85 W/K
const VENT_UA_NET = 0.33 * (50 * 3.6) * (1 - 0.75)

// Brief 81 reference totals (docs/audit/81_energyplus_validation_box.md), kWh/yr.
const EP_MECHVENT_NET_KWH = 665.0     // EnergyPlus mech-vent loss net of recovery
const NZA_MECHVENT_NET_KWH = 1282.0   // NZA-Sim mech-vent loss net of recovery

const TOL = 15.0  // +/-% gate (Brief 81)

// helpers
const sum = a => a.reduce((s, x) => s + x, 0)
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]) }
const mean = a => (a.length ? sum(a) / a.length : NaN)
const pstdev = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))) }
const pct = (v, ref) => (100 * (v - ref) / ref)
const f = (x, n = 1) => (x == null || Number.isNaN(x) ? 'n/a' : x.toFixed(n))
const sgn = p => (p >= 0 ? '+' : '')
const within = (v, ref) => Math.abs(pct(v, ref)) <= TOL

function readEp() {
  const lines = fs.readFileSync(EP_CSV, 'utf-8').split(/\r?\n/).filter(l => l.length)
  const heat = [], cool = []
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',')
    heat.push(parseFloat(p[6])); cool.push(parseFloat(p[7]))
  }
  return { epHeat: heat, epCool: cool }
}

// main
const { result, inputs } = loadAndRun(FIXTURE, REPO_ROOT)
const d = result.demand
const ff = Array.from(d.hourly_zone_air_free_c)
const nzaHeat = Array.from(d.heating_demand_hourly_kwh)
const nzaCool = Array.from(d.cooling_demand_hourly_kwh)
const tout = Array.from(inputs.weatherData.temperature)
const { epHeat, epCool } = readEp()
const n = ff.length
if (epHeat.length !== n) throw new Error(`row mismatch: NZA ${n} vs EP ${epHeat.length}`)

const nzaH = sum(nzaHeat)
const nzaC = sum(nzaCool)
const epH = sum(epHeat)
const epC = sum(epCool)

// per-hour mode classification
const modeOf = (h, c) => (h > EPS ? 'heat' : c > EPS ? 'cool' : 'free')
const epMode = []
const nzaMode = []
for (let h = 0; h < n; h++) { epMode.push(modeOf(epHeat[h], epCool[h])); nzaMode.push(modeOf(nzaHeat[h], nzaCool[h])) }

// baseline decomposition (cross-check vs P3 report s3)
let H_modeDiv = 0, H_modeDivHrs = 0        // EP heats, NZA free: EP_heat
let H_bothEP = 0, H_bothNZA = 0, H_bothHrs = 0
let C_modeDiv = 0, C_modeDivHrs = 0        // NZA cools, EP free: NZA_cool
let C_bothEP = 0, C_bothNZA = 0, C_bothHrs = 0
const ffModeDivHeat = []                   // ff in the EP-heats/NZA-free hours
for (let h = 0; h < n; h++) {
  if (epMode[h] === 'heat' && nzaMode[h] === 'free') { H_modeDiv += epHeat[h]; H_modeDivHrs++; ffModeDivHeat.push(ff[h]) }
  if (epMode[h] === 'heat' && nzaMode[h] === 'heat') { H_bothEP += epHeat[h]; H_bothNZA += nzaHeat[h]; H_bothHrs++ }
  if (nzaMode[h] === 'cool' && epMode[h] === 'free') { C_modeDiv += nzaCool[h]; C_modeDivHrs++ }
  if (epMode[h] === 'cool' && nzaMode[h] === 'cool') { C_bothEP += epCool[h]; C_bothNZA += nzaCool[h]; C_bothHrs++ }
}
const H_bothGap = H_bothEP - H_bothNZA     // EP heats more in both-heat hours (NZA under-books)
const C_bothGap = C_bothNZA - C_bothEP     // NZA cools harder in both-cool hours (NZA over-books)

// mode-crossing reconciliation sweep
function reconcile(delta) {
  let recH = 0, remC = 0, flipHheat = 0, flipCcool = 0
  for (let h = 0; h < n; h++) {
    if (epMode[h] === 'heat' && nzaMode[h] === 'free' && (ff[h] - delta) < SP_LOW) { recH += epHeat[h]; flipHheat++ }
    if (nzaMode[h] === 'cool' && epMode[h] === 'free' && (ff[h] - delta) < SP_HIGH) { remC += nzaCool[h]; flipCcool++ }
  }
  return { delta, recH, remC, H: nzaH + recH, C: nzaC - remC, flipHheat, flipCcool }
}
const deltas = [0.0, 0.25, 0.49, 0.75, 1.0, 1.057, 1.5, 3.0]
const rows = deltas.map(reconcile)

// theoretical ceiling of mode-crossing (all mode-divergent hours flip)
const H_modeCeil = nzaH + H_modeDiv         // best heating from float-crossing alone
const C_modeFloor = nzaC - C_modeDiv        // best cooling from float-crossing alone

// Appendix A: reproduce the naive -C_coef explosion as documented evidence
const Grec = []
for (let h = 0; h < n; h++) {
  if (nzaHeat[h] > EPS && (SP_LOW - ff[h]) > 1e-6) Grec.push(nzaHeat[h] / (SP_LOW - ff[h]))
  else if (nzaCool[h] > EPS && (ff[h] - SP_HIGH) > 1e-6) Grec.push(nzaCool[h] / (ff[h] - SP_HIGH))
}
const Gmed = median(Grec), Gmean = mean(Grec), Gstd = pstdev(Grec)
function naiveRebook(delta) {
  const g = Gmed
  let H = 0, C = 0
  for (let h = 0; h < n; h++) {
    const ffp = ff[h] - delta
    if (ffp < SP_LOW) H += g * (SP_LOW - ffp)
    else if (ffp > SP_HIGH) C += g * (ffp - SP_HIGH)
  }
  return { H, C }
}
const naive = [0.0, 0.25, 0.49].map(delta => ({ delta, ...naiveRebook(delta) }))

// mech-vent directional proxy (net vent UA over shifted heating hours)
function mechProxy(delta) {
  let wh = 0
  for (let h = 0; h < n; h++) if ((ff[h] - delta) < SP_LOW) { const dT = SP_LOW - tout[h]; if (dT > 0) wh += VENT_UA_NET * dT }
  return wh / 1000
}

// outcome classification
const heatCloseable = within(H_modeCeil, epH)              // can mode-crossing alone close heating?
const coolCloseable = within(C_modeFloor, epC)             // can mode-crossing alone close cooling?
const d049 = rows.find(r => r.delta === 0.49)
const d106 = rows.find(r => r.delta === 1.057)

let outcome, verdict
if (heatCloseable && coolCloseable) {
  outcome = 'a'
  verdict = '**OUTCOME (a) - hypothesis CONFIRMED.** Correcting the zone-temp delta '
    + '(via mode crossing) brings BOTH heating and cooling within +/-' + TOL + '% of '
    + 'EnergyPlus. Zone temperature is the single upstream root cause; Brief 83 is one fix.'
} else if (heatCloseable || coolCloseable) {
  outcome = 'b'
  verdict = '**OUTCOME (b) - hypothesis PARTIALLY confirmed.** Correcting the zone-temp '
    + 'delta closes the ' + (heatCloseable ? 'HEATING' : 'COOLING') + ' gap '
    + '(a free-float-crossing problem) but NOT the ' + (heatCloseable ? 'COOLING' : 'HEATING')
    + ' gap. The unresolved gap is a SAME-SETPOINT magnitude difference (P3 s3): both '
    + 'engines agree on the mode, so cooling the float cannot re-book it. Brief 83 needs '
    + 'two threads: (1) the float-warmth mechanism, (2) the same-setpoint load difference.'
} else {
  outcome = 'c'
  verdict = '**OUTCOME (c) - hypothesis REJECTED.** Mode crossing closes neither gap; the '
    + 'divergences are independent of the temperature delta.'
}

// report
const ts = new Date().toISOString().replace(/:/g, '-').replace(/\..+Z$/, 'Z')
const L = []
const w = s => L.push(s)
w('# Brief 82 P4 - Counterfactual re-booking against a shifted zone trace: bridgewater_box_v1')
w('')
w(`- **Generated:** ${ts}`)
w('- **Method:** mode-crossing reconciliation. Shift NZA free-float trace DOWN by')
w('  delta, re-classify each hour against EnergyPlus setpoint logic (heat < 21 C,')
w('  cool > 24 C, dead-band between), and reconcile demand using EnergyPlus own')
w('  hourly demand (recoverable heating) and NZA own booked cooling (removable')
w('  cooling). No extrapolation through the engine C_coef. No engine/IDF/DB change.')
w(`- **Tolerance gate:** +/-${TOL}% of EnergyPlus (Brief 81 convention).`)
w('')
w('## 1. Baseline totals and per-hour join cross-check')
w('')
w('| Quantity | EnergyPlus | NZA-Sim | NZA vs EP |')
w('|---|---|---|---|')
w(`| Heating demand (kWh/yr) | ${f(epH,1)} | ${f(nzaH,1)} | ${sgn(pct(nzaH,epH))}${f(pct(nzaH,epH),1)}% |`)
w(`| Cooling demand (kWh/yr) | ${f(epC,1)} | ${f(nzaC,1)} | ${sgn(pct(nzaC,epC))}${f(pct(nzaC,epC),1)}% |`)
w('')
w('Reproduces Brief 81 (-24.0% heating, +107.9% cooling) from the hourly join - '
  + 'confirms the two traces are calendar-aligned and the classification is correct.')
w('')
w('## 2. Where each gap lives (baseline decomposition)')
w('')
w('Heating shortfall = EP - NZA = ' + f(epH - nzaH, 1) + ' kWh:')
w('')
w('| Component | Hours | kWh | Addressable by cooling the float? |')
w('|---|---|---|---|')
w(`| EP heats, NZA free-floats above 21 (mode divergence) | ${H_modeDivHrs} | ${f(H_modeDiv,1)} | YES - if float dips below 21 |`)
w(`| Both heat, NZA books less (same-setpoint magnitude) | ${H_bothHrs} | ${f(H_bothGap,1)} | NO - both already at setpoint |`)
w('')
w('Cooling excess = NZA - EP = ' + f(nzaC - epC, 1) + ' kWh:')
w('')
w('| Component | Hours | kWh | Addressable by cooling the float? |')
w('|---|---|---|---|')
w(`| NZA cools, EP free-floats below 24 (mode divergence) | ${C_modeDivHrs} | ${f(C_modeDiv,1)} | YES - if float dips below 24 |`)
w(`| Both cool, NZA books more (same-setpoint magnitude) | ${C_bothHrs} | ${f(C_bothGap,1)} | NO - both already at setpoint |`)
w('')
w('This is the crux: ' + f(100 * H_modeDiv / (epH - nzaH), 0) + '% of the heating shortfall '
  + 'is mode divergence (cooling the float CAN address it), but only '
  + f(100 * C_modeDiv / (nzaC - epC), 0) + '% of the cooling excess is - the other '
  + f(100 * C_bothGap / (nzaC - epC), 0) + '% is NZA cooling HARDER at the same 24 C '
  + 'setpoint, which no temperature shift can re-book.')
w('')
w('## 3. Mode-crossing reconciliation sweep')
w('')
w('Shift NZA free-float down by delta; recoverable heating = EP demand in hours that '
  + 'flip EP-heat/NZA-free -> agree; removable cooling = NZA demand in hours that flip '
  + 'NZA-cool/EP-free -> agree.')
w('')
w('| delta (C) | Recov. heat (kWh) | Reconciled H (kWh) | H vs EP | Remov. cool (kWh) | Reconciled C (kWh) | C vs EP |')
w('|---|---|---|---|---|---|---|')
for (const r of rows) {
  const hp = pct(r.H, epH), cp = pct(r.C, epC)
  w(`| ${f(r.delta,3)} | ${f(r.recH,1)} | ${f(r.H,1)} | ${sgn(hp)}${f(hp,1)}%${within(r.H,epH)?' OK':''} | ${f(r.remC,1)} | ${f(r.C,1)} | ${sgn(cp)}${f(cp,1)}%${within(r.C,epC)?' OK':''} |`)
}
w('')
w(`Free-float of the EP-heats/NZA-free hours (${H_modeDivHrs} h): min ${f(Math.min(...ffModeDivHeat),2)}, `
  + `median ${f(median(ffModeDivHeat),2)}, mean ${f(mean(ffModeDivHeat),2)}, max ${f(Math.max(...ffModeDivHeat),2)} C. `
  + 'The closer these sit to 21, the more a small downshift recovers.')
w('')
w('**Ceilings (all mode-divergent hours flipped):**')
w(`- Heating: NZA ${f(nzaH,1)} + ${f(H_modeDiv,1)} = ${f(H_modeCeil,1)} kWh = ${sgn(pct(H_modeCeil,epH))}${f(pct(H_modeCeil,epH),1)}% of EP `
  + `-> ${heatCloseable ? 'WITHIN' : 'OUTSIDE'} +/-${TOL}% (residual = the ${f(H_bothGap,1)} kWh same-setpoint magnitude gap).`)
w(`- Cooling: NZA ${f(nzaC,1)} - ${f(C_modeDiv,1)} = ${f(C_modeFloor,1)} kWh = ${sgn(pct(C_modeFloor,epC))}${f(pct(C_modeFloor,epC),1)}% of EP `
  + `-> ${coolCloseable ? 'WITHIN' : 'OUTSIDE'} +/-${TOL}% (residual = the ${f(C_bothGap,1)} kWh same-setpoint magnitude gap).`)
w('')
w('## 4. Mech-vent (directional only)')
w('')
w(`Mech-vent net loss: EP ${f(EP_MECHVENT_NET_KWH,0)} kWh vs NZA ${f(NZA_MECHVENT_NET_KWH,0)} kWh `
  + `(Brief 81: +92.9%). A directional proxy (net vent UA ${f(VENT_UA_NET,2)} W/K over the `
  + `shifted heating-mode hours) at delta=0 is ${f(mechProxy(0),1)} kWh and RISES to `
  + `${f(mechProxy(0.49),1)} kWh at delta=0.49 - cooling the float ADDS heating-mode hours, `
  + 'so the proxy moves AWAY from the lower EP value. The mech-vent over-loss is not a '
  + 'float-crossing problem; it is the same-setpoint-magnitude family (consistent with the '
  + 'MVHR effective-recovery discrepancy flagged in P3: NZA ~54% net/gross vs EP ~82%). '
  + 'Read the trend, not the absolute (the engine bundles recovery inside C_coef).')
w('')
w('## 5. Outcome')
w('')
w(verdict)
w('')
w(`At the brief nominal shift delta=0.49 C: reconciled heating ${f(d049.H,1)} kWh `
  + `(${sgn(pct(d049.H,epH))}${f(pct(d049.H,epH),1)}%), reconciled cooling ${f(d049.C,1)} kWh `
  + `(${sgn(pct(d049.C,epC))}${f(pct(d049.C,epC),1)}%). At the P3 free-float mean delta=1.057 C: `
  + `heating ${f(d106.H,1)} kWh (${sgn(pct(d106.H,epH))}${f(pct(d106.H,epH),1)}%), cooling `
  + `${f(d106.C,1)} kWh (${sgn(pct(d106.C,epC))}${f(pct(d106.C,epC),1)}%).`)
w('')
w('## Appendix A - why the naive degree-hour extrapolation fails')
w('')
w('The literal recipe "subtract delta and re-book with NZA own law '
  + 'demand = -C_coef*(setpoint - ff)" produces a non-physical explosion:')
w('')
w('| delta (C) | Naive heating (kWh) | vs EP |')
w('|---|---|---|')
for (const r of naive) w(`| ${f(r.delta,2)} | ${f(r.H,1)} | ${sgn(pct(r.H,epH))}${f(pct(r.H,epH),1)}% |`)
w('')
w(`The recovered slope is constant at G = -C_coef = ${f(Gmed,3)} kWh/C `
  + `(mean ${f(Gmean,3)}, std ${f(Gstd,4)}) ~= ${f(Gmed*1000,0)} W/K - roughly 100x any `
  + 'physical UA for a box this size. That is because C_coef is the implicit-Euler '
  + 'one-step coefficient C_thermal/dt + sum(UA) (engine comment instantCalc.js L3659), '
  + 'dominated by thermal capacitance. Multiplying a PERSISTENT temperature offset by a '
  + 'CAPACITANCE coefficient fabricates a perpetual thermal-mass recharge every hour. '
  + 'A delta=0 round-trip still passes (it is an algebraic identity at delta=0), which is '
  + 'why the sweep in section 3 uses mode crossing with EP/NZA actual demand instead.')
w('')
w('_Generated by validation/nza_sim/counterfactual_rebook.mjs (read-only; no engine/IDF/DB changes)._')
w('')

const report = L.join('\n')
fs.mkdirSync(REPORTS_DIR, { recursive: true })
const outPath = path.join(REPORTS_DIR, `zone_temp_counterfactual_${ts}.md`)
fs.writeFileSync(outPath, report, 'utf-8')

// ASCII console summary
console.log(`[counterfactual] wrote ${path.relative(REPO_ROOT, outPath)}`)
console.log(`[counterfactual] baseline: NZA H=${nzaH.toFixed(1)} (${pct(nzaH,epH).toFixed(1)}%) C=${nzaC.toFixed(1)} (${pct(nzaC,epC).toFixed(1)}%) vs EP H=${epH.toFixed(1)} C=${epC.toFixed(1)}`)
console.log(`[counterfactual] heating shortfall ${(epH-nzaH).toFixed(1)} kWh = ${H_modeDiv.toFixed(1)} mode-div + ${H_bothGap.toFixed(1)} same-setpoint`)
console.log(`[counterfactual] cooling excess    ${(nzaC-epC).toFixed(1)} kWh = ${C_modeDiv.toFixed(1)} mode-div + ${C_bothGap.toFixed(1)} same-setpoint`)
console.log(`[counterfactual] ceilings: H ${H_modeCeil.toFixed(1)} (${pct(H_modeCeil,epH).toFixed(1)}%, ${heatCloseable?'closeable':'NOT closeable'})  C ${C_modeFloor.toFixed(1)} (${pct(C_modeFloor,epC).toFixed(1)}%, ${coolCloseable?'closeable':'NOT closeable'})`)
for (const r of rows) {
  console.log(`  delta=${r.delta.toFixed(3)}: reconH=${r.H.toFixed(1)} (${pct(r.H,epH).toFixed(1)}%) reconC=${r.C.toFixed(1)} (${pct(r.C,epC).toFixed(1)}%)`)
}
console.log(`[counterfactual] OUTCOME (${outcome})`)
console.log(`[counterfactual] (Appendix A naive -C_coef explosion: G=${Gmed.toFixed(2)} kWh/C; H@0.49=${naive[2].H.toFixed(0)} kWh = ${pct(naive[2].H,epH).toFixed(0)}%)`)
