/**
 * Brief 62 follow-up — read-only diagnosis of vent-off cooling demand.
 *
 * Two checks from Chris:
 *   (1) Is Bridgewater's ~400 MWh cooling demand (vent off) within the
 *       total-annual-gains bound? If demand > total gains, it's
 *       unphysical (a bug). If demand ≤ gains, it's plausibly real
 *       physics.
 *   (2) With vent off, what fraction of 8760 hours is T_air >
 *       cooling_setpoint? Hypothesis: a sealed gains-heavy building
 *       sits above setpoint nearly all hours → already at near-max
 *       cooling → dropping the setpoint catches few additional hours,
 *       producing the observed setpoint-insensitivity.
 *
 * No engine touches. Probe runs three configs and reports.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const API = 'http://127.0.0.1:8003'
const PID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
async function fj(u) { const r = await fetch(u); return r.json() }

const project = await fj(`${API}/api/projects/${PID}`)
const lib = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []
const constructions = project.construction_choices
const cb = { lower_c: project.comfort_band_lower_c ?? 20, upper_c: project.comfort_band_upper_c ?? 26 }
const baseBuilding = JSON.parse(JSON.stringify(project.building_config))

const weatherFile = baseBuilding.weather_file || project.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month=new Int8Array(N), day=new Int8Array(N), hour=new Int8Array(N)
const temperature=new Float32Array(N), direct_normal=new Float32Array(N)
const diffuse_horizontal=new Float32Array(N), wind_speed=new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i]=parseInt(p[1]); day[i]=parseInt(p[2]); hour[i]=parseInt(p[3])
  temperature[i]=parseFloat(p[6]); direct_normal[i]=parseFloat(p[14])
  diffuse_horizontal[i]=parseFloat(p[15]); wind_speed[i]=parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, Number(baseBuilding.orientation ?? 0))
const libraryData = {
  constructions: libArr.map(c => ({ name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K, y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0, g_value: c.config_json?.g_value, config_json: c.config_json ?? c, layers: c.layers })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
}

function pn(r, p) { let c = r; for (const s of p.split('.')) { if (c == null) return null; c = c[s] } return (typeof c === 'number' && Number.isFinite(c)) ? c : null }

function runOnce(label, mutate) {
  const b = JSON.parse(JSON.stringify(baseBuilding))
  if (typeof mutate === 'function') mutate(b)
  const r = calculateInstant(b, constructions, {}, libraryData, weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand: cb, _skipInterventions: true })

  // Setpoint actually used (post Brief 62 — read from setpoints_used echo)
  const heatSp = pn(r, 'setpoints_used.heating_c') ?? cb.lower_c
  const coolSp = pn(r, 'setpoints_used.cooling_c') ?? cb.upper_c

  // Gains (annual, MWh)
  const ig = r?.heat_balance?.annual?.gains?.internal ?? {}
  const sg = r?.heat_balance?.annual?.gains?.solar ?? {}
  const gain_people    = (ig?.people?.kwh ?? 0) / 1000
  const gain_lighting  = (ig?.lighting?.kwh ?? 0) / 1000
  const gain_equipment = (ig?.equipment?.kwh ?? 0) / 1000
  const gain_solar     = (sg?.total_kwh ?? 0) / 1000

  // Hourly T_air series (Brief 53 P2.A)
  const T_air_hourly = r?.demand?.hourly_zone_air_c ?? null
  // Count hours T_air > cooling setpoint (and bands)
  let hrs_above_coolSp = 0, hrs_below_heatSp = 0, hrs_in_band = 0
  let total_T_minus_coolSp_when_above_Kh = 0   // K·h "cooling-driving" integral
  if (Array.isArray(T_air_hourly) || (T_air_hourly && T_air_hourly.length)) {
    for (let h = 0; h < T_air_hourly.length; h++) {
      const T = T_air_hourly[h]
      if (T > coolSp) {
        hrs_above_coolSp++
        total_T_minus_coolSp_when_above_Kh += (T - coolSp)
      } else if (T < heatSp) {
        hrs_below_heatSp++
      } else {
        hrs_in_band++
      }
    }
  }

  return {
    label,
    coolSp, heatSp,
    demand_heating_mwh: pn(r, 'consumption.space_heating.demand_mwh'),
    demand_cooling_mwh: pn(r, 'consumption.space_cooling.demand_mwh'),
    gain_people, gain_lighting, gain_equipment, gain_solar,
    gain_internal_total: gain_people + gain_lighting + gain_equipment,
    gain_total_all: gain_people + gain_lighting + gain_equipment + gain_solar,
    eui_kwh_per_m2: pn(r, 'consumption.total.kwh_per_m2_yr'),
    // Hour distribution
    hrs_above_coolSp,
    hrs_below_heatSp,
    hrs_in_band,
    hrs_total: (T_air_hourly?.length) ?? 0,
    pct_above_coolSp: T_air_hourly?.length ? (hrs_above_coolSp / T_air_hourly.length * 100) : null,
    // Cooling "driving force" integral
    sum_T_minus_coolSp_Kh: total_T_minus_coolSp_when_above_Kh,
    // Overheating hours from engine accumulator (separate measure)
    overheating_hours: pn(r, 'demand.overheating_hours'),
    underheating_hours: pn(r, 'demand.underheating_hours'),
    comfort_hours: pn(r, 'demand.comfort_hours'),
  }
}

const A = runOnce('A baseline: vent ON, cooling_setpoint=follow_comfort (24)', null)
const B = runOnce('B vent OFF (all vent.enabled=false), cooling=follow_comfort (24)', b => {
  for (const v of (b.systems_config_v40?.ventilation ?? [])) v.enabled = false
  for (const v of (b.systems_config_v25?.ventilation ?? [])) v.enabled = false
})
const C = runOnce('C vent OFF, cooling_setpoint=18 custom', b => {
  for (const v of (b.systems_config_v40?.ventilation ?? [])) v.enabled = false
  for (const v of (b.systems_config_v25?.ventilation ?? [])) v.enabled = false
  b.systems_config_v40.cooling_setpoint_mode = 'custom'
  b.systems_config_v40.cooling_setpoint_c = 18
})

function table(s) {
  return [
    `  cooling_setpoint_c (actually used) : ${s.coolSp}`,
    `  heating_setpoint_c (actually used) : ${s.heatSp}`,
    `  demand_heating_mwh                  : ${s.demand_heating_mwh}`,
    `  demand_cooling_mwh                  : ${s.demand_cooling_mwh}`,
    `  eui_kwh_per_m2                      : ${s.eui_kwh_per_m2}`,
    `  ── annual GAINS (MWh) ──`,
    `    people gain                       : ${s.gain_people.toFixed(2)}`,
    `    lighting gain                     : ${s.gain_lighting.toFixed(2)}`,
    `    equipment gain                    : ${s.gain_equipment.toFixed(2)}`,
    `    solar gain                        : ${s.gain_solar.toFixed(2)}`,
    `    ── INTERNAL Σ (p+l+e)             : ${s.gain_internal_total.toFixed(2)}`,
    `    ── TOTAL all (incl. solar)        : ${s.gain_total_all.toFixed(2)}`,
    `  ── hourly T_air vs setpoint counts ──`,
    `    hours_above_cooling_setpoint      : ${s.hrs_above_coolSp} / ${s.hrs_total}  (${s.pct_above_coolSp?.toFixed(1)}%)`,
    `    hours_below_heating_setpoint      : ${s.hrs_below_heatSp}`,
    `    hours_in_comfort_band             : ${s.hrs_in_band}`,
    `    Σ (T_air − coolSp) when above     : ${s.sum_T_minus_coolSp_Kh.toFixed(0)} K·h  (cooling driving force)`,
    `  ── engine accumulators ──`,
    `    overheating_hours                 : ${s.overheating_hours}`,
    `    underheating_hours                : ${s.underheating_hours}`,
    `    comfort_hours                     : ${s.comfort_hours}`,
  ].join('\n')
}

console.log('Brief 62 follow-up — vent-off cooling-demand diagnosis (read-only)')
console.log('=' .repeat(110))
console.log()
console.log(A.label); console.log(table(A)); console.log()
console.log(B.label); console.log(table(B)); console.log()
console.log(C.label); console.log(table(C)); console.log()

console.log('=' .repeat(110))
console.log('CHECK 1 — Is vent-off cooling demand within the total-gain bound?')
console.log('-' .repeat(110))
const ratio_B = B.gain_total_all > 0 ? (B.demand_cooling_mwh / B.gain_total_all * 100) : null
console.log(`  B vent-OFF demand_cooling = ${B.demand_cooling_mwh} MWh`)
console.log(`  B vent-OFF total gains    = ${B.gain_total_all.toFixed(2)} MWh (internal ${B.gain_internal_total.toFixed(2)} + solar ${B.gain_solar.toFixed(2)})`)
console.log(`  ratio demand/gain         = ${ratio_B?.toFixed(1)}%`)
const physical = (B.demand_cooling_mwh ?? 0) <= B.gain_total_all + 5   // small slack for floor-const / weather coupling
console.log(`  PHYSICAL (demand ≤ gains)? ${physical ? '✓ YES — within bound, real physics is possible' : '✗ NO — exceeds gains, unphysical → BUG'}`)
console.log()

console.log('CHECK 2 — Is the setpoint-insensitivity explained by near-100% cooling-hour occupancy?')
console.log('-' .repeat(110))
const dHrs_B_to_C = (C.hrs_above_coolSp ?? 0) - (B.hrs_above_coolSp ?? 0)
const dDemand_B_to_C = (C.demand_cooling_mwh ?? 0) - (B.demand_cooling_mwh ?? 0)
console.log(`  B vent-OFF coolSp=24 : ${B.hrs_above_coolSp}/${B.hrs_total} hours above coolSp (${B.pct_above_coolSp?.toFixed(1)}%)`)
console.log(`  C vent-OFF coolSp=18 : ${C.hrs_above_coolSp}/${C.hrs_total} hours above coolSp (${C.pct_above_coolSp?.toFixed(1)}%)`)
console.log(`  Δ hours captured by setpoint drop 24→18  : ${dHrs_B_to_C >= 0 ? '+' : ''}${dHrs_B_to_C} hours`)
console.log(`  Δ cooling demand 24→18                    : ${dDemand_B_to_C >= 0 ? '+' : ''}${dDemand_B_to_C.toFixed(1)} MWh`)
const near_saturation = (B.pct_above_coolSp ?? 0) >= 90   // arbitrary "near-100%" threshold
console.log(`  Near-saturation at coolSp=24 (≥90%)?    ${near_saturation ? '✓ YES — building above setpoint most of the year' : '— NO, plenty of headroom; setpoint should drive demand much harder'}`)
console.log()

const verdict = (physical && near_saturation) ? '✓ BOTH OBSERVATIONS ARE CORRECT PHYSICS (within bound + setpoint already near-saturated)'
              : (!physical) ? '✗ BUG — demand exceeds total gains, unphysical'
              : '⚠ MIXED — within physical bound but setpoint NOT near-saturated → setpoint-insensitivity needs another explanation'
console.log('VERDICT: ' + verdict)
console.log()

fs.writeFileSync(path.join(REPO_ROOT, 'docs/audit/62_vent_off_diag.json'), JSON.stringify({
  generated_at: new Date().toISOString(), A, B, C,
  check_1_physical: physical,
  check_1_ratio_pct: ratio_B,
  check_2_near_saturation: near_saturation,
  delta_hours_B_to_C: dHrs_B_to_C,
  delta_demand_B_to_C: dDemand_B_to_C,
  verdict,
}, null, 2))
console.log('Wrote docs/audit/62_vent_off_diag.json')
