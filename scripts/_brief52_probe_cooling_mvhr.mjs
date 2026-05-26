/**
 * scripts/_brief52_probe_cooling_mvhr.mjs
 *
 * Read-only probe for the upcoming ventilation brief (provisional Brief 52).
 *
 * QUESTION (Chris, post-Brief-50 walkthrough): "MVHR Bedrooms: heat recovered
 * drops 63.2 → 24.4 while cooling rises +83.9". Is recovery correctly gated
 * to heating-mode hours (gains-dominated physics — recovery only credits
 * when the building actually needs heat), or computed as a flat annual
 * fraction of ventilation loss regardless of cooling state (bug)?
 *
 * APPROACH: Use the refbox geometry (clean, hand-calculable). Run two
 * scenarios:
 *
 *   COLD: LPD = 0, EPD = 0   (existing refbox — heating-dominated)
 *   HOT:  LPD = 25, EPD = 25  (high gains, pushes into cooling for part of year)
 *
 * Other refbox settings unchanged: 100 m² box, no infiltration, no
 * occupants, no DHW, SFP = 0, HRE = 0.75, vent flow 500 L/s, single
 * heating system at SCOP 3.0. Comfort band 20–25 °C.
 *
 * GATE LOGIC (from `computeVentilationEnergy`, instantCalc.js L3939-3966):
 *
 *   for (h = 0; h < 8760; h++) {
 *     const dT = T_setpoint − T_out[h]
 *     if (dT > 0) {                                ← outer gate (T_out < setpoint)
 *       theoretical_h = flow × ρcp × HRE × dT × ...
 *       demand_h      = heatingDemandHourlyKwh[h] × 1000
 *       effective_Wh += min(theoretical_h, demand_h) ← inner cap (per-hour demand)
 *     }
 *   }
 *
 * If gating works correctly:
 *   - Outer gate: cooling hours (T_out > setpoint) contribute 0
 *   - Inner cap: hours where gains absorb the heating need contribute 0
 *   → HOT box recovery should be substantially less than COLD box
 *   → Cooling demand in HOT should be non-zero
 *
 * If recovery is NOT gated to gains-aware heating demand:
 *   - Recovery stays ≈ proportional to vent × HRE × dT_out_integral
 *   - HOT box recovery ≈ COLD box recovery (unchanged)
 *   → BUG. Brief needed.
 *
 * Read-only probe. No code changes. No verdict on a fix, just a verdict on
 * the gating behaviour.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const WEATHER_FILE = 'GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw'

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} → ${r.status}`); return r.json() }
const lib = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []

const epwPath = path.join(REPO_ROOT, 'data/weather/current', WEATHER_FILE)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), direct_normal = new Float32Array(N)
const diffuse_horizontal = new Float32Array(N), wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i]=parseInt(p[1]);day[i]=parseInt(p[2]);hour[i]=parseInt(p[3])
  temperature[i]=parseFloat(p[6]);direct_normal[i]=parseFloat(p[14])
  diffuse_horizontal[i]=parseFloat(p[15]);wind_speed[i]=parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const orientation = 0
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, orientation)
const libraryData = {
  constructions: libArr.map(c => ({
    name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0, g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c, layers: c.layers,
  })),
  system_templates: [
    ...SYSTEM_TEMPLATES_LIBRARY,
    { id: 'refbox_heat', supports_services: ['heating'], heating_scop: 3.0, fuel: 'electricity' },
    { id: 'refbox_cool', supports_services: ['cooling'], cooling_seer: 3.0, fuel: 'electricity' },
    { id: 'refbox_dhw',  supports_services: ['dhw'],     dhw_seasonal_efficiency: 1.0, fuel: 'electricity' },
  ],
}
function pickConstruction(suffix) {
  const found = libArr.find(c => c.name?.toLowerCase().includes(suffix))
  return found?.id ?? libArr[0]?.id
}
const constructions = {
  external_wall: pickConstruction('wall')   ?? libArr[0]?.id,
  roof:          pickConstruction('roof')   ?? libArr[0]?.id,
  ground_floor:  pickConstruction('floor')  ?? libArr[0]?.id,
  glazing:       pickConstruction('glazing') ?? pickConstruction('window') ?? libArr[0]?.id,
}

const COMFORT = { lower_c: 20, upper_c: 25 }
const BOX_GIA = 100  // 10×10×3 box

// Gain injection: State 2 reads from `building.occupancy` (people gains)
// + `building.gains.{lighting,equipment}.profiles[]` (per-profile multi-
// schema), NOT from systems_config_v25.lighting_power_density (that's the
// inline-legacy 'full' path). Use occupancy as the single knob — 1 person /
// m² × 100 W × 8760 h = 87.6 MWh / yr of people heat, plenty to push a
// 100 m² box into cooling mode.
const ALWAYS_ON_SCHEDULE = {
  weekday:  Array(24).fill(1),
  saturday: Array(24).fill(1),
  sunday:   Array(24).fill(1),
  monthly_multipliers: Array(12).fill(1),
  exceptions: [],
}

function makeBox({ peopleDensityPerM2 = 0 } = {}) {
  const occupancy = peopleDensityPerM2 > 0
    ? {
        density:                 { value: peopleDensityPerM2, basis: 'per_m2' },
        occupancy_rate:          1,
        sensible_w_per_person:   100,   // bumped from default 75 for stronger gain signal
        schedule:                ALWAYS_ON_SCHEDULE,
      }
    : null
  return {
    name: 'REFBOX-cool',
    weather_file: WEATHER_FILE,
    length: 10, width: 10, floor_height: 3, num_floors: 1,
    orientation: 0,
    num_bedrooms: peopleDensityPerM2 > 0 ? 100 : 0,
    occupancy_rate: 0, people_per_room: 0,   // legacy fields — unused by State 2 when `occupancy` is set
    occupancy,
    infiltration_ach: 0,
    wwr: { north: 0, east: 0, south: 0, west: 0 },
    openings: [], operable_openings: [], thermal_bridges: [],
    schedules: {}, shading_overhang: {}, shading_fin: {},
    gains: {}, operator: {}, fabric: {},
    thermal_mass_mode: 'category', thermal_mass_category: 'lightweight',
    systems_config_v40: { heating: [], cooling: [], dhw: [], ventilation: [], lighting: [], small_power: [] },
    systems_config_v25: {
      lighting_power_density: 0,    // unused by State 2 (legacy inline-full path only)
      equipment_power_density: 0,   // unused by State 2 (legacy inline-full path only)
      heating: { primary: { library_id: 'refbox_heat' }, primary_pct: 100, setpoint_c: 20 },
      cooling: { primary: { library_id: 'refbox_cool', enabled: false }, primary_pct: 0 },
      dhw:     { primary: { library_id: 'refbox_dhw',  enabled: false }, primary_pct: 100, circulation_pump_w: 0 },
      ventilation: [{
        id: 'refbox_mvhr', name: 'refbox_mvhr',
        enabled: true, hre_enabled: true,
        flow_l_s: 500, sfp_w_per_l_s: 0,
        hre: 0.75,
        hours: 8760, schedule_ref: 'always_on',
      }],
    },
  }
}

function runEngine(building) {
  return calculateInstant(
    building, constructions, {}, libraryData, weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand: COMFORT },
  )
}

function pick(r) {
  const sh = r?.consumption?.space_heating ?? {}
  const sc = r?.consumption?.space_cooling ?? {}
  const sv = r?.system_performance?.ventilation?.total ?? {}
  const s2 = r?.heat_balance?.annual?.gains?.internal ?? {}
  const eu = r?.energy_use?.totals ?? {}
  return {
    raw_demand_mwh:     sh.demand_mwh ?? null,
    delivered_mwh:      sh.delivered_mwh ?? null,
    recovery_offset:    sh.recovery_offset_mwh ?? null,
    heating_elec_mwh:   sh.electricity_mwh ?? null,
    cooling_demand_mwh: sc.demand_mwh ?? null,
    fan_kwh:            sv.fan_kwh ?? null,
    vent_recovery_eff:  sv.recovery_mwh ?? null,
    vent_recovery_theo: sv.recovery_theoretical_mwh ?? null,
    int_people_kwh:     s2.people?.kwh ?? null,
    int_lighting_kwh:   s2.lighting?.kwh ?? null,
    int_equipment_kwh:  s2.equipment?.kwh ?? null,
    eui:                eu.eui_kwh_per_m2 ?? null,
  }
}

// ── Hand-calc reference quantities (Yeovilton, 500 L/s, HRE 0.75) ──────────
const AIR_HC_J_PER_M3_K = 1.2 * 1005
const T_set_lower = COMFORT.lower_c
const T_set_upper = COMFORT.upper_c
let dT_integral_at_lower = 0
let heating_hours = 0
let cooling_hours_out = 0  // T_out > upper
for (let i = 0; i < N; i++) {
  const T = temperature[i]
  const dT_heat = T_set_lower - T
  if (dT_heat > 0) { dT_integral_at_lower += dT_heat; heating_hours++ }
  if (T > T_set_upper) cooling_hours_out++
}
const flow_m3s = 0.5  // 500 L/s
const HRE = 0.75
const theoretical_recovery_uncapped_mwh = flow_m3s * AIR_HC_J_PER_M3_K * HRE * dT_integral_at_lower * 3600 / 3.6e9

console.log()
console.log('═════════════════════════════════════════════════════════════════════════════════════')
console.log('  PROBE — MVHR recovery gating in cooling-mode hours (refbox)')
console.log('═════════════════════════════════════════════════════════════════════════════════════')
console.log()
console.log(`  Weather: ${WEATHER_FILE}`)
console.log(`  Box: 100 m² GIA, comfort ${T_set_lower}–${T_set_upper} °C, HRE 0.75, SFP 0, vent 500 L/s`)
console.log(`  Heating-degree-hours @ ${T_set_lower}°C base:  ${dT_integral_at_lower.toFixed(0)} K·h   (${heating_hours} hours with T_out < ${T_set_lower}°C)`)
console.log(`  Hours with T_out > ${T_set_upper}°C (outer-gate cooling hours):  ${cooling_hours_out}`)
console.log(`  Hand-calc theoretical recovery (uncapped, vent × HRE × Σ dT):  ${theoretical_recovery_uncapped_mwh.toFixed(2)} MWh / yr`)
console.log()

// ── Scenario A — COLD (no gains) ─────────────────────────────────────────────
console.log('  ─ SCENARIO A — COLD (no occupants, no internal gains) ──')
const rA = runEngine(makeBox({ peopleDensityPerM2: 0 }))
const A = pick(rA)
console.log(`    raw heating demand:      ${A.raw_demand_mwh?.toFixed(2)} MWh`)
console.log(`    delivered (= raw, post-Brief-50): ${A.delivered_mwh?.toFixed(2)} MWh`)
console.log(`    heating electricity:     ${A.heating_elec_mwh?.toFixed(2)} MWh  (at SCOP 3.0)`)
console.log(`    cooling demand:          ${A.cooling_demand_mwh?.toFixed(2)} MWh`)
console.log(`    effective recovery:      ${A.vent_recovery_eff?.toFixed(2)} MWh   (engine "system_performance.ventilation.total.recovery_mwh")`)
console.log(`    theoretical recovery:    ${A.vent_recovery_theo?.toFixed(2)} MWh   (uncapped)`)
console.log(`    int people kWh:          ${(A.int_people_kwh ?? 0).toFixed(0)}`)
console.log(`    int lighting kWh:        ${(A.int_lighting_kwh ?? 0).toFixed(0)}`)
console.log(`    int equipment kWh:       ${(A.int_equipment_kwh ?? 0).toFixed(0)}`)
console.log(`    EUI:                     ${A.eui?.toFixed(2)} kWh/m²·yr`)
console.log()

// ── Scenario B — HOT (large internal gains) ──────────────────────────────────
console.log('  ─ SCENARIO B — HOT (1 person/m² × 100 W × always-on — 87.6 MWh/yr of people gain) ──')
const rB = runEngine(makeBox({ peopleDensityPerM2: 1 }))
const B = pick(rB)
console.log(`    raw heating demand:      ${B.raw_demand_mwh?.toFixed(2)} MWh`)
console.log(`    delivered:               ${B.delivered_mwh?.toFixed(2)} MWh`)
console.log(`    heating electricity:     ${B.heating_elec_mwh?.toFixed(2)} MWh`)
console.log(`    cooling demand:          ${B.cooling_demand_mwh?.toFixed(2)} MWh  ← high gains should push this above 0`)
console.log(`    effective recovery:      ${B.vent_recovery_eff?.toFixed(2)} MWh   ← THE SMOKING GUN`)
console.log(`    theoretical recovery:    ${B.vent_recovery_theo?.toFixed(2)} MWh`)
console.log(`    int people kWh:          ${(B.int_people_kwh ?? 0).toFixed(0)}   ← should be ~87,600 (1 person/m² × 100 m² × 100 W × 8760 h)
    int lighting kWh:        ${(B.int_lighting_kwh ?? 0).toFixed(0)}`)
console.log(`    int equipment kWh:       ${(B.int_equipment_kwh ?? 0).toFixed(0)}`)
console.log(`    EUI:                     ${B.eui?.toFixed(2)} kWh/m²·yr`)
console.log()

// ── Δ analysis ───────────────────────────────────────────────────────────────
const d_recovery     = (B.vent_recovery_eff ?? 0) - (A.vent_recovery_eff ?? 0)
const d_recovery_pct = (A.vent_recovery_eff ?? 0) > 0 ? (d_recovery / (A.vent_recovery_eff ?? 1)) * 100 : 0
const d_heat_demand  = (B.raw_demand_mwh ?? 0) - (A.raw_demand_mwh ?? 0)
const d_cool_demand  = (B.cooling_demand_mwh ?? 0) - (A.cooling_demand_mwh ?? 0)

console.log('  ─ Δ (HOT − COLD) ──')
console.log(`    Δ recovery (effective):  ${d_recovery.toFixed(2)} MWh   (${d_recovery_pct.toFixed(1)}%  of COLD)`)
console.log(`    Δ heating demand:        ${d_heat_demand.toFixed(2)} MWh`)
console.log(`    Δ cooling demand:        +${d_cool_demand.toFixed(2)} MWh`)
console.log(`    Δ theoretical recovery:  ${((B.vent_recovery_theo ?? 0) - (A.vent_recovery_theo ?? 0)).toFixed(2)} MWh   (should be 0 — theoretical depends only on flow+HRE+T_out)`)
console.log()

// ── Verdict ──────────────────────────────────────────────────────────────────
const dropped_significantly = d_recovery < -2.0  // any meaningful drop
const theoretical_stable    = Math.abs(((B.vent_recovery_theo ?? 0) - (A.vent_recovery_theo ?? 0))) < 0.5
const cooling_emerged       = (B.cooling_demand_mwh ?? 0) > 1.0

console.log('  ─ VERDICT ──')
if (cooling_emerged) {
  console.log(`    ✓ Cooling demand emerged in HOT box  (${B.cooling_demand_mwh?.toFixed(1)} MWh) → scenario is gains-dominated as intended.`)
} else {
  console.log(`    ⚠ Cooling demand did NOT emerge (${B.cooling_demand_mwh?.toFixed(2)} MWh). Crank LPD/EPD higher.`)
}
if (theoretical_stable) {
  console.log(`    ✓ Theoretical recovery is stable across COLD vs HOT (depends only on flow × HRE × T_out integral).`)
} else {
  console.log(`    ✗ Theoretical recovery shifted between COLD and HOT — unexpected (it's T_out-only).`)
}
if (dropped_significantly) {
  console.log(`    ✓ Effective recovery DROPPED ${Math.abs(d_recovery).toFixed(1)} MWh (${Math.abs(d_recovery_pct).toFixed(0)}%) in HOT vs COLD.`)
  console.log(`      → engine's per-hour cap min(theoretical_h, heating_demand_h) IS gating recovery to hours where the building actually wants heat.`)
  console.log(`      → Recovery is correctly gated to (a) hours with T_out < setpoint AND (b) hours where gains-aware demand > 0.`)
  console.log(`      → VERDICT: gating works. Chris's "63.2 → 24.4 while cooling +83.9" is correct gains-dominated physics.`)
} else {
  console.log(`    ✗ Effective recovery did NOT drop materially despite cooling demand emerging.`)
  console.log(`      → Engine is computing recovery as a flat fraction of ventilation loss, NOT gated to actual heating demand.`)
  console.log(`      → VERDICT: BUG. Recovery is accruing in hours where the building doesn't want heat.`)
}
console.log()

// ── JSON summary ─────────────────────────────────────────────────────────────
const out = path.join(REPO_ROOT, 'docs/audit/_brief52_probe_cooling_mvhr.json')
fs.writeFileSync(out, JSON.stringify({
  meta: { weather: WEATHER_FILE, comfort: COMFORT, heating_hours, dT_integral_at_lower, theoretical_recovery_uncapped_mwh },
  cold: A,
  hot:  B,
  deltas: { recovery: d_recovery, recovery_pct: d_recovery_pct, heat_demand: d_heat_demand, cool_demand: d_cool_demand },
  verdict: dropped_significantly ? 'GATED_CORRECTLY' : 'NOT_GATED',
}, null, 2))
console.log(`  JSON: ${path.relative(REPO_ROOT, out)}`)
console.log()
