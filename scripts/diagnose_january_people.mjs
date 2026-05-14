/**
 * scripts/diagnose_january_people.mjs
 *
 * Brief 28a Part 5 walkthrough Finding 3 — investigate why People appears
 * nearly invisible on the Conditions tab's Gain profile chart despite
 * representing 26% of annual gain total.
 *
 * Hand calc (Chris):
 *   134 rooms x 1.5 ppl/room x 0.75 occupancy x 75 W sensible
 *     = 11,306 W = 11.3 kW peak People sensible
 *
 * If real, the band shouldn't be visually swallowed by Lighting (6.9 kW
 * peak) or Equipment.
 *
 * Three hypotheses to test:
 *   1. Schedule data read by computeHourlyGains doesn't match the Schedule
 *      tab. (engine vs UI mismatch)
 *   2. People kW values are correct but visual scale issue (would explain
 *      "invisible band" if People is actually small).
 *   3. Xmas exception (24-12 to 01-07) is bleeding into all of January.
 *
 * This script:
 *   - Loads Bridgewater config + EPW + library from the DB.
 *   - Imports computeHourlyGains + decomposeHour + findActiveException
 *     directly (no React, no UI -- pure engine output).
 *   - For each hour h in [0, 744) (January 1 to January 31), prints
 *     People kW + which exception (if any) is active + schedule fraction.
 *   - Aggregates: per-day min/max/mean People kW for January.
 *   - Compares to expected peak from the hand calc.
 *
 * Usage:
 *   node scripts/diagnose_january_people.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import {
  computeHourlyGains,
  decomposeHour,
  findActiveException,
  computeTotalOccupants,
} from '../frontend/src/utils/instantCalc.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'

// ── Load Bridgewater ──────────────────────────────────────────────────────
const db = new DatabaseSync(path.join(REPO_ROOT, 'data/nza_sim.db'))
const row = db.prepare(
  'SELECT building_config, weather_file FROM projects WHERE id = ?'
).get(PROJECT_ID)
db.close()

if (!row) {
  console.error(`Project ${PROJECT_ID} not found`)
  process.exit(1)
}

const building = JSON.parse(row.building_config)
const weatherFile = row.weather_file || building.weather_file

// ── Load EPW (we need temperature + month + hour arrays) ───────────────────
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N)
const hour  = new Int8Array(N)
const temperature = new Float32Array(N)
const direct_normal = new Float32Array(N)
const diffuse_horizontal = new Float32Array(N)
const wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i] = parseInt(p[1]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6])
  direct_normal[i] = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15])
  wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, hour }

// ── Geometry / GIA ─────────────────────────────────────────────────────────
const L  = Number(building.length || 0)
const W  = Number(building.width  || 0)
const nF = Number(building.num_floors || 0)
const gia = L * W * nF
const numBedrooms = Number(building.num_bedrooms ?? 0)
const occupancyRate = Number(building.occupancy_rate ?? building.occupancy?.occupancy_rate ?? 0)
const peoplePerRoom = Number(building.people_per_room ?? 0)
const sensibleWPerPerson = Number(building.occupancy?.sensible_w_per_person ?? 75)
const totalOccupants100 = computeTotalOccupants(building, gia)
const effectiveOccupants = totalOccupants100 * occupancyRate
const handCalcPeakW = effectiveOccupants * sensibleWPerPerson

console.log()
console.log('===============================================================================')
console.log('  JANUARY PEOPLE DIAGNOSTIC — Bridgewater')
console.log('===============================================================================')
console.log()
console.log(`  GIA: ${gia} m^2 (${L} x ${W} x ${nF} floors)`)
console.log(`  num_bedrooms:       ${numBedrooms}`)
console.log(`  people_per_room:    ${peoplePerRoom}`)
console.log(`  occupancy_rate:     ${occupancyRate}`)
console.log(`  sensible_w_per_person: ${sensibleWPerPerson}`)
console.log(`  occupancy.density:  ${JSON.stringify(building.occupancy?.density)}`)
console.log(`  totalOccupants100:  ${totalOccupants100} (computeTotalOccupants helper)`)
console.log(`  effectiveOccupants: ${effectiveOccupants.toFixed(1)} (= total x occupancy_rate)`)
console.log(`  Hand-calc peak W:   ${handCalcPeakW.toFixed(0)} W = ${(handCalcPeakW / 1000).toFixed(2)} kW`)
console.log()
console.log('  occupancy.schedule structure:')
const sched = building.occupancy?.schedule ?? {}
console.log(`    weekday[24]:       ${JSON.stringify(sched.weekday?.slice(0, 6))} ... (first 6 of 24)`)
console.log(`    saturday[24]:      ${JSON.stringify(sched.saturday?.slice(0, 6))} ...`)
console.log(`    sunday[24]:        ${JSON.stringify(sched.sunday?.slice(0, 6))} ...`)
console.log(`    monthly_multipliers[12]: ${JSON.stringify(sched.monthly_multipliers)}`)
console.log(`    exceptions: ${JSON.stringify(sched.exceptions, null, 2)}`)
console.log()

// ── Walk all of January (hours 0..743) ─────────────────────────────────────
const JAN_START = 0
const JAN_END   = 24 * 31  // 744

const perHour = []
let janPeopleSumW = 0
let janPeoplePeakW = 0
let janPeoplePeakHour = -1
let janZeroHours = 0
const perDay = []  // [{ day, min, max, mean, zeroHours, exceptionId }]

for (let day = 0; day < 31; day++) {
  let dayMin = Infinity, dayMax = -Infinity, daySum = 0, dayZero = 0
  let dayExceptionId = null
  for (let h = day * 24; h < (day + 1) * 24; h++) {
    const decomp = decomposeHour(h, weatherData)
    const exc = findActiveException(sched.exceptions, decomp.dateMMDD)
    const g = computeHourlyGains(building, h, weatherData, gia)
    perHour.push({ hour: h, day: day + 1, hod: decomp.hourOfDay, dayType: decomp.dayType, dateMMDD: decomp.dateMMDD, exception: exc?.id ?? null, people_W: g.people })
    janPeopleSumW += g.people
    if (g.people > janPeoplePeakW) { janPeoplePeakW = g.people; janPeoplePeakHour = h }
    if (g.people === 0) janZeroHours++
    if (g.people < dayMin) dayMin = g.people
    if (g.people > dayMax) dayMax = g.people
    daySum += g.people
    if (g.people === 0) dayZero++
    if (exc) dayExceptionId = exc.id
  }
  perDay.push({
    day: day + 1,
    minW: dayMin,
    maxW: dayMax,
    meanW: daySum / 24,
    zeroHours: dayZero,
    exceptionId: dayExceptionId,
  })
}

const janPeopleMeanW = janPeopleSumW / (24 * 31)

console.log('===============================================================================')
console.log('  HOURLY VALUES — first 48 hours (Jan 1-2)')
console.log('===============================================================================')
console.log()
console.log('  hour day hod  dayType    dateMMDD exception        people_W   people_kW')
console.log('  ---- --- ---  ---------  -------- ---------------  ---------  ---------')
for (let i = 0; i < 48; i++) {
  const r = perHour[i]
  console.log(
    `  ${String(r.hour).padStart(4)} ${String(r.day).padStart(3)} ${String(r.hod).padStart(3)}  ` +
    `${(r.dayType || '').padEnd(9)}  ${(r.dateMMDD || '').padEnd(8)} ${(r.exception || '').padEnd(15)} ` +
    `${String(Math.round(r.people_W)).padStart(9)}  ${(r.people_W / 1000).toFixed(2).padStart(9)}`,
  )
}
console.log()

console.log('===============================================================================')
console.log('  HOURLY VALUES — Jan 11 (the hour Chris flagged in tooltip)')
console.log('===============================================================================')
console.log()
console.log('  hour day hod  dayType    dateMMDD exception        people_W   people_kW')
console.log('  ---- --- ---  ---------  -------- ---------------  ---------  ---------')
for (let h = 10 * 24; h < 11 * 24; h++) {
  const r = perHour[h]
  console.log(
    `  ${String(r.hour).padStart(4)} ${String(r.day).padStart(3)} ${String(r.hod).padStart(3)}  ` +
    `${(r.dayType || '').padEnd(9)}  ${(r.dateMMDD || '').padEnd(8)} ${(r.exception || '').padEnd(15)} ` +
    `${String(Math.round(r.people_W)).padStart(9)}  ${(r.people_W / 1000).toFixed(2).padStart(9)}`,
  )
}
console.log()

console.log('===============================================================================')
console.log('  PER-DAY SUMMARY — Jan 1..31')
console.log('===============================================================================')
console.log()
console.log('  day  exception        min_kW  max_kW  mean_kW  zero_hrs')
console.log('  ---  ---------------  ------  ------  -------  --------')
for (const d of perDay) {
  console.log(
    `  ${String(d.day).padStart(3)}  ${(d.exceptionId || '').padEnd(15)}  ` +
    `${(d.minW / 1000).toFixed(2).padStart(6)}  ${(d.maxW / 1000).toFixed(2).padStart(6)}  ` +
    `${(d.meanW / 1000).toFixed(2).padStart(7)}  ${String(d.zeroHours).padStart(8)}`,
  )
}
console.log()

console.log('===============================================================================')
console.log('  JANUARY AGGREGATES')
console.log('===============================================================================')
console.log()
console.log(`  Peak People W:      ${Math.round(janPeoplePeakW)} = ${(janPeoplePeakW / 1000).toFixed(2)} kW`)
console.log(`                      (at hour ${janPeoplePeakHour}, day ${Math.floor(janPeoplePeakHour / 24) + 1}, hod ${janPeoplePeakHour % 24})`)
console.log(`  Mean People W:      ${Math.round(janPeopleMeanW)} = ${(janPeopleMeanW / 1000).toFixed(2)} kW`)
console.log(`  Zero hours:         ${janZeroHours} of ${24 * 31} (${(janZeroHours / (24 * 31) * 100).toFixed(0)}%)`)
console.log()
console.log(`  Hand-calc peak:     ${(handCalcPeakW / 1000).toFixed(2)} kW`)
console.log(`  Ratio (engine/hand): ${(janPeoplePeakW / handCalcPeakW).toFixed(2)} x`)
console.log()

// Also pull a couple of months for context
console.log('===============================================================================')
console.log('  CROSS-CHECK — Peak People W per month')
console.log('===============================================================================')
console.log()
const monthlyPeaks = new Array(12).fill(0)
for (let h = 0; h < 8760; h++) {
  const decomp = decomposeHour(h, weatherData)
  const g = computeHourlyGains(building, h, weatherData, gia)
  const mi = decomp.monthIdx
  if (g.people > monthlyPeaks[mi]) monthlyPeaks[mi] = g.people
}
const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
for (let m = 0; m < 12; m++) {
  console.log(`  ${monthLabels[m]}: peak People = ${(monthlyPeaks[m] / 1000).toFixed(2)} kW`)
}
console.log()
