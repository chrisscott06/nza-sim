/**
 * scripts/state2_diagnostic_hourly_gains.mjs
 *
 * Diagnostic: dump the hourly gain profile for Bridgewater on two sample days:
 *   - Jan 15  (mid-winter weekday)
 *   - July 15 (mid-summer Sunday under TMY Jan-1=Monday assumption)
 *
 * Two questions to answer:
 *
 * 1. Is `proportional_with_spill` lighting behaving as designed?
 *    Expectation: lights follow the LIGHTING schedule, scaled by
 *    occupancy_rate, with daylight dimming during 09:00–16:00. They should
 *    NOT be on at 90% overnight when guests are asleep.
 *
 * 2. Does the people-gain profile genuinely peak overnight in winter?
 *    If yes, the heating-offset explanation in Part 2 holds. If gains are
 *    roughly uniform, the heating-demand collapse needs a different
 *    explanation.
 *
 * Usage:
 *   node scripts/state2_diagnostic_hourly_gains.mjs [project_id]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { computeHourlyGains, decomposeHour } from '../frontend/src/utils/instantCalc.js'

const PROJECT_ID = process.argv[2] || '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fetchJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

const project = await fetchJson(`${API}/api/projects/${PROJECT_ID}`)
const building = project.building_config

// ── Load weather (only for the month/day/hour columns — temp not needed) ─────
const weatherFile = building.weather_file || project.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i] = parseInt(p[1])
  day[i] = parseInt(p[2])
  hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6])
}
const weatherData = { temperature, month, day, hour }

// GIA from building
const gia = (building.length || 0) * (building.width || 0) * (building.num_floors || 0)
console.log()
console.log('═════════════════════════════════════════════════════════════════════')
console.log('  STATE 2 HOURLY GAIN PROFILE — BRIDGEWATER DIAGNOSTIC')
console.log('═════════════════════════════════════════════════════════════════════')
console.log(`  Project: ${project.name}`)
console.log(`  GIA:                    ${gia.toFixed(0)} m²`)
console.log(`  Rooms:                  ${building.num_bedrooms}`)
console.log(`  occupancy_rate:         ${building.occupancy?.occupancy_rate}`)
console.log(`  occupancy.density:      ${JSON.stringify(building.occupancy?.density)}`)
console.log(`  Lighting magnitude:     ${JSON.stringify(building.gains?.lighting?.magnitude)}`)
console.log(`  Lighting rel:           ${building.gains?.lighting?.relationship_to_occupancy}`)
console.log(`  Lighting daylight_factor: ${building.gains?.lighting?.daylight_factor}`)
console.log(`  Equipment baseload:     ${JSON.stringify(building.gains?.equipment?.baseload)}`)
console.log(`  Equipment active:       ${JSON.stringify(building.gains?.equipment?.active)}`)
console.log(`  Equipment rel:          ${building.gains?.equipment?.relationship_to_occupancy}`)
console.log()

function findHourOfYear(targetMonth, targetDay, targetHour /* 0-23 */) {
  for (let h = 0; h < N; h++) {
    if (month[h] === targetMonth && day[h] === targetDay && (hour[h] - 1) === targetHour) {
      return h
    }
  }
  return -1
}

function dumpDay(label, m, d) {
  const h0 = findHourOfYear(m, d, 0)
  if (h0 < 0) {
    console.log(`(${label}: hour 0 not found in EPW)`)
    return
  }
  const { dayType, monthIdx } = decomposeHour(h0, weatherData)
  console.log(`── ${label} (${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}, dayType=${dayType}, monthIdx=${monthIdx}, T_out range from EPW) ─────`)
  console.log('  hr   T_out  presence  people_kW  light_kW  equip_kW  baseload  active   total_kW')

  let day_people = 0, day_light = 0, day_equip = 0, day_baseload = 0, day_active = 0
  for (let h = 0; h < 24; h++) {
    const hh = h0 + h
    const T_out = temperature[hh]
    const g = computeHourlyGains(building, hh, weatherData, gia)
    const peo_kW = g.people / 1000
    const lit_kW = g.lighting / 1000
    const eq_kW  = g.equipment / 1000
    const base_kW = g.equipment_baseload / 1000
    const act_kW  = g.equipment_active / 1000
    const tot_kW = g.total / 1000
    day_people   += g.people
    day_light    += g.lighting
    day_equip    += g.equipment
    day_baseload += g.equipment_baseload
    day_active   += g.equipment_active
    console.log(
      `  ${String(h).padStart(2, '0')}  ${T_out.toFixed(1).padStart(5)}  ` +
      `${g.presence.toFixed(2)}      ` +
      `${peo_kW.toFixed(2).padStart(7)}  ` +
      `${lit_kW.toFixed(2).padStart(6)}    ` +
      `${eq_kW.toFixed(2).padStart(5)}    ` +
      `${base_kW.toFixed(2).padStart(5)}   ` +
      `${act_kW.toFixed(2).padStart(5)}    ` +
      `${tot_kW.toFixed(2).padStart(6)}`
    )
  }
  console.log(`  ─────────────────────────────────────────────────────────────────────`)
  console.log(`  daily kWh:        people=${(day_people/1000).toFixed(1)}  light=${(day_light/1000).toFixed(1)}  equip=${(day_equip/1000).toFixed(1)}  (baseload ${(day_baseload/1000).toFixed(1)} + active ${(day_active/1000).toFixed(1)})`)
  console.log(`  daily total: ${((day_people + day_light + day_equip)/1000).toFixed(1)} kWh`)
  console.log()
  return { day_people, day_light, day_equip, day_baseload, day_active }
}

const winterDay = dumpDay('Jan 15 (winter)', 1, 15)
const summerDay = dumpDay('Jul 15 (summer)', 7, 15)

// ── Lighting profile sanity check ─────────────────────────────────────────────
console.log('── LIGHTING DIAGNOSTIC ────────────────────────────────────────────')
console.log()
console.log('  Hotel-bedroom lighting design intent (from HOTEL_LIGHT preset):')
console.log('    ~0.05 overnight (corridor emergency only)')
console.log('    ~0.4–0.7 morning peak (06:00–07:00, guests waking)')
console.log('    ~0.1 daytime (rooms empty / cleaned)')
console.log('    ~0.5–0.8 evening peak (18:00–22:00, guests back)')
console.log('    ~0.05 late night (after 23:00)')
console.log('  With proportional_with_spill at occupancy_rate=1.0:')
console.log('    fraction = lighting_schedule[h] × monthly_multiplier × daylight_dim')
console.log('    daylight_dim = 0.6 during 09:00–16:00 (factor < 1)')
console.log()
console.log('  Expected daily kWh at full LPD (8 W/m² × 3458 m² = 27.66 kW):')
const sched = building.gains?.lighting?.schedule
if (sched?.weekday) {
  const wkSum = sched.weekday.reduce((s,v) => s+v, 0)
  const monthMult = sched.monthly_multipliers?.[0] ?? 1
  const lpd_w = (building.gains?.lighting?.magnitude?.value ?? 8) * gia
  console.log(`    Weekday schedule sum (no dim): ${wkSum.toFixed(2)} hr-fractions`)
  console.log(`    × Jan monthly mult ${monthMult.toFixed(2)} = ${(wkSum * monthMult).toFixed(2)}`)
  console.log(`    × occupancy_rate ${building.occupancy?.occupancy_rate.toFixed(2)} = ${(wkSum * monthMult * building.occupancy.occupancy_rate).toFixed(2)}`)
  console.log(`    × 27.66 kW × (no dim) = ${(wkSum * monthMult * building.occupancy.occupancy_rate * lpd_w / 1000).toFixed(1)} kWh/day`)
  // Compare to actual
  if (winterDay) {
    console.log(`    ACTUAL (Jan 15 incl. daylight dim): ${(winterDay.day_light/1000).toFixed(1)} kWh/day`)
  }
}

console.log()
console.log('── PEOPLE PHASING DIAGNOSTIC ──────────────────────────────────────')
console.log()
console.log('  Question: do people gains peak overnight in winter, when they\'d')
console.log('  maximally offset heating?')
if (winterDay) {
  // Re-derive overnight (00:00–05:00) vs daytime (10:00–15:00) average per hour
  const h0 = findHourOfYear(1, 15, 0)
  let overnight_W = 0, daytime_W = 0
  for (let h = 0; h < 6; h++) overnight_W += computeHourlyGains(building, h0 + h, weatherData, gia).people
  for (let h = 10; h < 16; h++) daytime_W += computeHourlyGains(building, h0 + h, weatherData, gia).people
  const overnight_avg_kW = overnight_W / 6 / 1000
  const daytime_avg_kW   = daytime_W   / 6 / 1000
  console.log(`  Winter Jan 15:`)
  console.log(`    avg people gain 00:00–05:00 = ${overnight_avg_kW.toFixed(2)} kW`)
  console.log(`    avg people gain 10:00–15:00 = ${daytime_avg_kW.toFixed(2)} kW`)
  console.log(`    overnight/daytime ratio = ${(overnight_avg_kW / Math.max(0.01, daytime_avg_kW)).toFixed(2)}×`)
  console.log()
  console.log('  Interpretation:')
  if (overnight_avg_kW > daytime_avg_kW * 1.5) {
    console.log('    ✓ People gains genuinely peak overnight (ratio > 1.5×).')
    console.log('      The hotel-occupancy phasing explanation HOLDS — gains land')
    console.log('      when heating would otherwise be needed, maximising offset.')
  } else if (overnight_avg_kW > daytime_avg_kW) {
    console.log('    ~ People gains modestly higher overnight (ratio < 1.5×).')
    console.log('      Phasing contributes but doesn\'t fully explain the heating')
    console.log('      collapse — investigate other paths.')
  } else {
    console.log('    ✗ People gains NOT overnight-peaked — heating-offset')
    console.log('      explanation FAILS. Investigate alternative causes.')
  }
}
