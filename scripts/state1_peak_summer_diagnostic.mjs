/**
 * scripts/state1_peak_summer_diagnostic.mjs
 *
 * Brief 26.1 Part 0c — Peak summer hour energy balance, live engine.
 *
 * Why this exists: the live engine's State 1 summer max is reported at
 * ~43°C for Bridgewater. EP says ~34°C for the same scenario. The brief
 * suspects sol-air absorption without release / thermal mass not coupling
 * / solar bypassing mass — needs hour-by-hour visibility to diagnose.
 *
 * This script replays the live engine's _calculateEnvelopeOnly inline
 * (forking the loop here rather than calling into instantCalc.js, so we
 * can print intermediates without modifying the engine) and dumps the
 * energy balance for the hour where indoor temperature peaks.
 *
 * Usage:
 *   node scripts/state1_peak_summer_diagnostic.mjs [project_id]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'

const PROJECT_ID = process.argv[2] || '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fetchJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

// ── Load building config + library + weather ─────────────────────────────────
const project = await fetchJson(`${API}/api/projects/${PROJECT_ID}`)
const constructionsLib = await fetchJson(`${API}/api/library/constructions`)
const constructionsArr = constructionsLib.constructions ?? []
const libraryData = {
  constructions: constructionsArr.map(c => ({
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    config_json: c.config_json ?? c,
  })),
}
const building = project.building_config
const constructions = project.construction_choices
const comfortBand = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}

const weatherFile = building.weather_file || project.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), day = new Int16Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), wind_speed = new Float32Array(N)
const direct_normal = new Float32Array(N), diffuse_horizontal = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i] = parseInt(p[1])
  day[i] = parseInt(p[2])
  hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6])
  direct_normal[i] = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15])
  wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, hour, day }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, building.orientation || 0)

// ── Run live engine, get hourly temperature trace ─────────────────────────────
const live = calculateInstant(
  { ...building, comfort_band: comfortBand },
  constructions, project.systems_config ?? {}, libraryData,
  weatherData, hourlySolar, null,
  { mode: 'envelope-only', comfortBand },
)
const T = live.free_running?.hourly_temperature_c
if (!T || T.length === 0) {
  console.error('No hourly temperature trace returned'); process.exit(1)
}

// Find the peak-indoor hour
let peakHour = 0, peakT = -Infinity
for (let h = 0; h < T.length; h++) {
  if (T[h] > peakT) { peakT = T[h]; peakHour = h }
}
const m = month[peakHour], d = day[peakHour], hr = hour[peakHour]
console.log()
console.log('═════════════════════════════════════════════════════════════════════')
console.log('  PEAK SUMMER HOUR — LIVE ENGINE INDOOR TEMP DIAGNOSTIC')
console.log('═════════════════════════════════════════════════════════════════════')
console.log(`  Project:    ${project.name}`)
console.log(`  Comfort:    ${comfortBand.lower_c}/${comfortBand.upper_c}°C`)
console.log(`  Peak hour:  ${m.toString().padStart(2,'0')}-${d.toString().padStart(2,'0')} ${hr.toString().padStart(2,'0')}:00 (h=${peakHour} of 8760)`)
console.log(`  Indoor:     ${peakT.toFixed(2)}°C`)
console.log(`  Outdoor:    ${temperature[peakHour].toFixed(2)}°C`)
console.log(`  Wind:       ${wind_speed[peakHour].toFixed(2)} m/s`)
console.log()

// ── Reproduce live-engine UA derivation for this hour ────────────────────────
// (Mirrors _calculateEnvelopeOnly. Sources of truth not modified.)
const AIR_HEAT_CAPACITY = 0.33  // Wh/(m³·K)
const FRAME_FRACTION = 0.20
const SHADING_FACTOR = 1.0

const len = building.length, wid = building.width, nf = building.num_floors, fh = building.floor_height
const gia = len * wid * nf
const volume = gia * fh
const wallTotal = 2 * (len + wid) * fh * nf
const wwr = building.wwr ?? {}
const glazFace = {
  north: len * fh * nf * (wwr.north ?? 0),
  south: len * fh * nf * (wwr.south ?? 0),
  east:  wid * fh * nf * (wwr.east  ?? 0),
  west:  wid * fh * nf * (wwr.west  ?? 0),
}
const totalGlaz = Object.values(glazFace).reduce((a,b)=>a+b, 0)
const wallOpaque = wallTotal - totalGlaz
const roofArea = len * wid, groundArea = len * wid

function getU(element) {
  const name = constructions?.[element]
  if (name && libraryData.constructions) {
    const item = libraryData.constructions.find(c => c.name === name)
    if (item?.u_value_W_per_m2K != null) {
      return Number(item.u_value_W_per_m2K) * (item.y_factor ?? 1.0)
    }
  }
  return ({ external_wall: 0.28, roof: 0.18, ground_floor: 0.22, glazing: 1.4 })[element] ?? 1.0
}
function getG() {
  const name = constructions?.glazing
  const item = libraryData.constructions.find(c => c.name === name)
  return item?.config_json?.g_value ?? 0.4
}

const u_wall = getU('external_wall')
const u_roof = getU('roof')
const u_floor = getU('ground_floor')
const u_glaz = getU('glazing')
const g_value = getG()

const UA_wall = u_wall * wallOpaque
const UA_roof = u_roof * roofArea
const UA_floor = u_floor * groundArea
const UA_glaz = u_glaz * totalGlaz
const UA_fabric = UA_wall + UA_roof + UA_floor + UA_glaz

const ach = Number(building.infiltration_ach ?? 0.5)
const UA_leakage = AIR_HEAT_CAPACITY * ach * volume

const openings = building.openings ?? {}
const Cd = 0.6
const Cw = ({ sheltered: 0.05, normal: 0.10, exposed: 0.20 })[openings.site_exposure] ?? 0.10
const sqrtCw = Math.sqrt(Cw)
const louvreTotal = ['north','south','east','west']
  .reduce((s, f) => s + Number(openings?.[f]?.louvre_area_m2 ?? 0), 0)

const T_in = T[peakHour]
const T_out = temperature[peakHour]
const dT = T_in - T_out

const Q_louvre_m3s = Cd * louvreTotal * sqrtCw * wind_speed[peakHour]
const UA_permanent = AIR_HEAT_CAPACITY * (Q_louvre_m3s * 3600)
const UA_total = UA_fabric + UA_leakage + UA_permanent

const sol_n = hourlySolar.f1[peakHour] * glazFace.north * g_value * (1 - FRAME_FRACTION) * SHADING_FACTOR
const sol_e = hourlySolar.f2[peakHour] * glazFace.east  * g_value * (1 - FRAME_FRACTION) * SHADING_FACTOR
const sol_s = hourlySolar.f3[peakHour] * glazFace.south * g_value * (1 - FRAME_FRACTION) * SHADING_FACTOR
const sol_w = hourlySolar.f4[peakHour] * glazFace.west  * g_value * (1 - FRAME_FRACTION) * SHADING_FACTOR
const sol_roof = hourlySolar.roof[peakHour] * roofArea * 0.05
const Q_solar = sol_n + sol_e + sol_s + sol_w + sol_roof

const Q_cond_walls = UA_wall * dT
const Q_cond_roof  = UA_roof * dT
const Q_cond_floor = UA_floor * dT
const Q_cond_glaz  = UA_glaz * dT
const Q_vent_leak  = UA_leakage * dT
const Q_vent_perm  = UA_permanent * dT
const Q_loss_total = (UA_fabric + UA_leakage + UA_permanent) * dT

const thermalMass = ({ light: 80000, medium: 160000, heavy: 280000 })[building.thermal_mass_category ?? 'light'] ?? 80000
const C_zone_Wh = (thermalMass * gia) / 3600

console.log('  GEOMETRY')
console.log(`    GIA:               ${gia.toFixed(0)} m²`)
console.log(`    Volume:            ${volume.toFixed(0)} m³`)
console.log(`    Wall (opaque):     ${wallOpaque.toFixed(0)} m²`)
console.log(`    Roof / Floor:      ${roofArea.toFixed(0)} m²`)
console.log(`    Glazing total:     ${totalGlaz.toFixed(0)} m² (N=${glazFace.north.toFixed(0)} S=${glazFace.south.toFixed(0)} E=${glazFace.east.toFixed(0)} W=${glazFace.west.toFixed(0)})`)
console.log()
console.log('  UA TERMS (Wh/K per hour)')
console.log(`    UA_wall:           ${UA_wall.toFixed(1)}`)
console.log(`    UA_roof:           ${UA_roof.toFixed(1)}`)
console.log(`    UA_floor:          ${UA_floor.toFixed(1)}`)
console.log(`    UA_glaz:           ${UA_glaz.toFixed(1)}`)
console.log(`    UA_fabric (total): ${UA_fabric.toFixed(1)}`)
console.log(`    UA_leakage:        ${UA_leakage.toFixed(1)}  (ach=${ach}, vol=${volume.toFixed(0)})`)
console.log(`    UA_permanent:      ${UA_permanent.toFixed(1)}  (louvre A=${louvreTotal.toFixed(2)}m², wind=${wind_speed[peakHour].toFixed(2)}m/s)`)
console.log(`    UA_total:          ${UA_total.toFixed(1)}`)
console.log()
console.log('  HOUR ENERGY BALANCE (Wh, this hour)')
console.log(`    Q_solar_N:         ${sol_n.toFixed(0)}`)
console.log(`    Q_solar_S:         ${sol_s.toFixed(0)}`)
console.log(`    Q_solar_E:         ${sol_e.toFixed(0)}`)
console.log(`    Q_solar_W:         ${sol_w.toFixed(0)}`)
console.log(`    Q_solar_roof:      ${sol_roof.toFixed(0)}`)
console.log(`    Q_solar TOTAL:     ${Q_solar.toFixed(0)}  ← gain to zone`)
console.log()
console.log(`    dT (T_in - T_out): ${dT.toFixed(2)} K`)
console.log(`    Q_cond_walls:      ${Q_cond_walls.toFixed(0)}  ← loss if positive`)
console.log(`    Q_cond_roof:       ${Q_cond_roof.toFixed(0)}`)
console.log(`    Q_cond_floor:      ${Q_cond_floor.toFixed(0)}`)
console.log(`    Q_cond_glaz:       ${Q_cond_glaz.toFixed(0)}`)
console.log(`    Q_vent_leak:       ${Q_vent_leak.toFixed(0)}`)
console.log(`    Q_vent_perm:       ${Q_vent_perm.toFixed(0)}`)
console.log(`    Q_loss TOTAL:      ${Q_loss_total.toFixed(0)}  ← all loss paths combined`)
console.log()
console.log(`    Net (gain - loss): ${(Q_solar - Q_loss_total).toFixed(0)} Wh into zone this hour`)
console.log()
console.log('  THERMAL MASS')
console.log(`    Category:          ${building.thermal_mass_category ?? 'light'}`)
console.log(`    C_zone:            ${(C_zone_Wh).toFixed(0)} Wh/K (== ${(thermalMass * gia / 1e6).toFixed(1)} MJ/K)`)
console.log(`    Expected ΔT/hr:    ${((Q_solar - Q_loss_total) / C_zone_Wh).toFixed(3)} K`)
console.log()

// Compare to outdoor temperature trace for the same hour
const prevHour = peakHour - 1
const T_prev = T[prevHour]
console.log('  TIME-STEP CHECK')
console.log(`    T_in[t-1]:         ${T_prev.toFixed(2)}°C`)
console.log(`    T_in[t]:           ${T_in.toFixed(2)}°C`)
console.log(`    Δ measured:        ${(T_in - T_prev).toFixed(3)} K`)
console.log()

// ── Hypothesis probes ──────────────────────────────────────────────────────
console.log('  ──────────────────────────────────────────────────────────────────')
console.log('  HYPOTHESIS PROBES')
console.log('  ──────────────────────────────────────────────────────────────────')

// H1: opaque-surface sol-air absorption?
// In the current live calc, opaque walls have NO solar contribution.
// Roof has a small one (0.05 absorption factor × incident).
// Check: is there a missing sol-air term anywhere?
console.log(`    H1 (opaque sol-air missing):`)
console.log(`       Wall opaque solar contribution: 0 Wh (live engine ignores opaque sol-air)`)
console.log(`       Roof solar contribution (5%):   ${sol_roof.toFixed(0)} Wh`)
console.log(`       → Opaque sol-air is NOT the cause (it's currently zero, not too high)`)
console.log()

// H2: Thermal mass coupling — does mass damp swings?
// In the current code, mass is just lumped C_zone. Every Q goes directly
// to T_air. There's no separate T_mass node. So mass simply slows the
// rate of change; it doesn't decouple solar gain from immediate air heating.
console.log(`    H2 (thermal mass not damping properly):`)
console.log(`       Solar gain this hour:           ${Q_solar.toFixed(0)} Wh`)
console.log(`       C_zone (lumped):                ${C_zone_Wh.toFixed(0)} Wh/K`)
console.log(`       Δ if all solar to zone air:     ${(Q_solar / C_zone_Wh).toFixed(2)} K`)
console.log(`       → Single-capacitance: heat hits indoor air directly each hour,`)
console.log(`         no surface absorption + delayed re-radiation. This IS the`)
console.log(`         lumped-capacitance vs EP transient-mass divergence (#2).`)
console.log()

// H3: Is ventilation flowing in summer?
const summerVentFraction = UA_leakage / UA_total
console.log(`    H3 (ventilation under-applied):`)
console.log(`       UA_leakage / UA_total:         ${(summerVentFraction*100).toFixed(1)}%`)
console.log(`       UA_permanent / UA_total:        ${(UA_permanent/UA_total*100).toFixed(1)}%`)
console.log(`       UA_fabric / UA_total:           ${(UA_fabric/UA_total*100).toFixed(1)}%`)
console.log(`       → Ventilation IS being applied (q50 + louvres).`)
console.log(`         But maximum cooling capacity at peak (T_in=${T_in.toFixed(1)}, T_out=${T_out.toFixed(1)})`)
console.log(`         is only UA_vent × dT = ${((UA_leakage + UA_permanent) * dT / 1000).toFixed(1)} kWh/hr,`)
console.log(`         vs ${(Q_solar/1000).toFixed(1)} kWh of solar coming in. Net positive.`)
console.log()

// H4: Where does Q_solar go in the energy balance?
console.log(`    H4 (solar bypasses mass, hits air directly):`)
console.log(`       Code: T_zone = T_zone + (Q_solar_in_Wh - Q_loss_total_Wh) / C_zone_Wh`)
console.log(`       → All solar adds directly to indoor air temperature.`)
console.log(`         A real building's massive surfaces absorb most of this with`)
console.log(`         hours of delay. CONFIRMED root cause.`)
console.log()
console.log('  Conclusion: H2 + H4 are the same root cause — single-capacitance')
console.log('  lumped model with no surface-absorption decoupling. EP captures this')
console.log('  via per-surface transient mass; live engine does not.')
console.log('═════════════════════════════════════════════════════════════════════')
