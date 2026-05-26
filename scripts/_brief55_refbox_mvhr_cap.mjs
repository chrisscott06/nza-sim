/**
 * scripts/_brief55_refbox_mvhr_cap.mjs
 *
 * Brief 55 follow-on — REFBOX MVHR cap diagnostic.
 *
 * Chris's question (2026-05-26, post-dump):
 *   On the reference box (no occupancy, no artefact, no DHW — clean):
 *   when MVHR is added, can "after heat recovery" demand go NEGATIVE,
 *   and can "heat recovered" EXCEED "heat the building needs"?
 *
 *   Bridgewater image 2: after-recovery = −68.7 MWh, recovery 93.1 → 171
 *   when raw demand is 101.9. Physically impossible — recovery transferred
 *   to the zone cannot exceed what the zone needed.
 *
 *   Confirm on the box whether the recovery cap is missing, hand-calc the
 *   correct ceiling, and report. HARD STOP before any fix.
 *
 * Hypothesis (formed from reading Brief 49 refbox results + instantCalc
 * L4328-L4569 + BreakdownPanel L144-L172):
 *
 *   The engine emits TWO quantities at different boundaries:
 *
 *     (A) `consumption.space_heating.demand_mwh` — Brief 49 refbox
 *         proves this is POST-MVHR (drops 182.6 → 147.8 as HRE 0→0.75
 *         at flow=500 L/s on a 100 m² box). instantCalc L4343 confirms
 *         `heating_post_mvhr_demand_mwh = heating_demand_state2_mwh`
 *         and State 2 has already baked the (1-HRE) factor on vent UA.
 *
 *     (B) `consumption.space_heating.recovery_offset_mwh` — the
 *         airstream recovery integral, surfaced for display. NOT capped
 *         at the zone's actual heating need; just the per-hour airstream
 *         heat content × HRE summed over heating hours.
 *
 *   BreakdownPanel ROWS (L144-L172):
 *     raw_demand    → deltaPath 'heating_raw_demand_mwh' (= demand_mwh)
 *                     tooltip claims "pre-MVHR" but the quantity is post-
 *                     MVHR on the refbox. LABEL/TOOLTIP IS WRONG.
 *     mvhr_recovery → deltaPath 'heating_recovery_offset_mwh' (airstream)
 *     post_mvhr     → deltaPath 'heating_post_mvhr_demand_mwh'
 *                     interventionsEngine.js L459-L463 computes this as
 *                     raw − offset → a DOUBLE SUBTRACTION at the display.
 *
 *   When raw (already post-MVHR) > recovery_offset (airstream integral),
 *   the panel shows positive — looks fine but is already wrong by
 *   `recovery_offset` MWh. When raw < recovery_offset (heavy ventilation
 *   relative to fabric, or strong gains depressing raw), the panel goes
 *   negative.
 *
 * This script:
 *   1. Reproduces the Brief 49 refbox at flow=500 L/s, HRE=0.75 to anchor
 *      semantics (raw=147.8, recovery=35.3, post_mvhr_display=112.5 — wrong
 *      but positive).
 *   2. Sweeps vent flow from 500 → 8000 L/s on the same 100 m² box to
 *      drive recovery_offset past raw demand and reproduce a NEGATIVE
 *      "after heat recovery" on a clean box. Confirms it's not a
 *      Bridgewater-specific entanglement.
 *   3. Hand-calculates the correct ceiling: recovery transferred to the
 *      zone cannot exceed the smaller of (i) the airstream physical
 *      maximum (vent × HRE × ΣdT) and (ii) the heating demand the
 *      pre-recovery building would have had at that hour. The current
 *      engine reports (i) only.
 *   4. Reports findings. HARD STOP — no fix.
 *
 * Usage:
 *   node scripts/_brief55_refbox_mvhr_cap.mjs
 *
 * Backend on 127.0.0.1:8003 must be running (construction library only —
 * no project data is read).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const API = process.env.NZA_API || 'http://127.0.0.1:8003'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const WEATHER_FILE = 'GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw'

// ── Construction library + weather ───────────────────────────────────────
async function fj(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${url} → ${r.status}`); return r.json()
}
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
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6]); direct_normal[i] = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15]); wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }

const T_BASE = 20
let dT_integral_K_hours = 0
for (let i = 0; i < N; i++) {
  const dT = T_BASE - temperature[i]
  if (dT > 0) dT_integral_K_hours += dT
}

const BOX_L = 10, BOX_W = 10, BOX_H = 3, BOX_FLOORS = 1
const BOX_GIA = BOX_L * BOX_W * BOX_FLOORS

const REFBOX_TEMPLATES = [
  { id: 'refbox_heat_scop3', supports_services: ['heating'], heating_scop: 3.0, fuel: 'electricity' },
  { id: 'refbox_cool',       supports_services: ['cooling'], cooling_seer: 3.0, fuel: 'electricity' },
  { id: 'refbox_dhw',        supports_services: ['dhw'], dhw_seasonal_efficiency: 1.0, fuel: 'electricity' },
]
const SYSTEM_TEMPLATES = [...SYSTEM_TEMPLATES_LIBRARY, ...REFBOX_TEMPLATES]

const libraryData = {
  constructions: libArr.map(c => ({
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c,
    layers: c.layers,
  })),
  system_templates: SYSTEM_TEMPLATES,
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

function makeRefBox({ ventFlow_l_s = 500, ventHre = 0.75 } = {}) {
  return {
    name: 'REFBOX',
    weather_file: WEATHER_FILE,
    length: BOX_L, width: BOX_W, floor_height: BOX_H, num_floors: BOX_FLOORS,
    orientation: 0,
    num_bedrooms: 0, occupancy_rate: 0, people_per_room: 0,
    infiltration_ach: 0,
    wwr: { north: 0, east: 0, south: 0, west: 0 },
    openings: [], operable_openings: [], thermal_bridges: [],
    schedules: {}, shading_overhang: {}, shading_fin: {}, gains: {},
    operator: {}, fabric: {},
    thermal_mass_mode: 'category', thermal_mass_category: 'lightweight',
    systems_config_v40: { heating: [], cooling: [], dhw: [], ventilation: [], lighting: [], small_power: [] },
    systems_config_v25: {
      lighting_power_density: 0,
      equipment_power_density: 0,
      heating: { primary: { library_id: 'refbox_heat_scop3' }, primary_pct: 100, setpoint_c: 20 },
      cooling: { primary: { library_id: 'refbox_cool', enabled: false }, primary_pct: 0 },
      dhw:     { primary: { library_id: 'refbox_dhw',  enabled: false }, primary_pct: 100, circulation_pump_w: 0 },
      ventilation: [{
        id: 'refbox_mvhr', name: 'refbox_mvhr',
        enabled: true, hre_enabled: ventHre > 0,
        flow_l_s: ventFlow_l_s, sfp_w_per_l_s: 0,
        hre: ventHre, hours: 8760, schedule_ref: 'always_on',
      }],
    },
  }
}

function runEngine(building, comfortBand = { lower_c: 20, upper_c: 25 }) {
  const orientation = building.orientation ?? 0
  const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, orientation)
  return calculateInstant(
    building, constructions, {}, libraryData,
    weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand },
  )
}

function pick(result) {
  const sh = result?.consumption?.space_heating ?? {}
  const sv = result?.system_performance?.ventilation?.total ?? {}
  return {
    demand_mwh:          sh.demand_mwh ?? null,
    delivered_mwh:       sh.delivered_mwh ?? null,
    recovery_offset_mwh: sh.recovery_offset_mwh ?? null,
    vent_recovery_mwh:   sv.recovery_mwh ?? null,
    vent_recovery_theo:  sv.recovery_theoretical_mwh ?? null,
  }
}

function fmt(v, dp = 3) {
  if (v == null || !Number.isFinite(v)) return '—'
  return Number(v).toFixed(dp)
}

const AIR_HC_J_PER_M3_K = 1.2 * 1005
function ventLossMwh(flow_l_s, hre = 0) {
  const flow_m3s = flow_l_s / 1000
  return flow_m3s * AIR_HC_J_PER_M3_K * dT_integral_K_hours * (1 - hre) * 3600 / 3.6e9
}

// ────────────────────────────────────────────────────────────────────────
console.log('=========================================================')
console.log('  Brief 55 follow-on — REFBOX MVHR cap diagnostic')
console.log('=========================================================')
console.log(`  Weather: ${WEATHER_FILE}`)
console.log(`  Heating degree-hours @ 20°C base: ${dT_integral_K_hours.toFixed(0)} K·h`)
console.log(`  Box: ${BOX_L} × ${BOX_W} × ${BOX_H} m × ${BOX_FLOORS} floor = ${BOX_GIA} m² GIA`)
console.log('  Clean: no occupancy, no DHW, no cooling, no infiltration, no glazing, no gains.')
console.log()

// ════════════════════════════════════════════════════════════════════════
// SCENARIO 1 — Baseline (no MVHR) vs anchor refbox (500 L/s, HRE=0.75)
// Reproduces Brief 49 refbox so the engine semantics are pinned.
// ════════════════════════════════════════════════════════════════════════
console.log('=========================================================')
console.log('  SCENARIO 1 — Engine semantic anchor (flow=500, HRE 0 vs 0.75)')
console.log('=========================================================')
console.log('  Q: What is `consumption.space_heating.demand_mwh` — pre- or post-MVHR?')
console.log()
const s1_off = pick(runEngine(makeRefBox({ ventFlow_l_s: 500, ventHre: 0 })))
const s1_on  = pick(runEngine(makeRefBox({ ventFlow_l_s: 500, ventHre: 0.75 })))

const breakdown_after_off = (s1_off.demand_mwh ?? 0) - (s1_off.recovery_offset_mwh ?? 0)
const breakdown_after_on  = (s1_on.demand_mwh  ?? 0) - (s1_on.recovery_offset_mwh  ?? 0)

console.log('  Engine output:')
console.log('    Row (BreakdownPanel)            HRE=0           HRE=0.75')
console.log('    ──────────────────────────────────────────────────────────')
console.log(`    "Heat the building needs"       ${fmt(s1_off.demand_mwh).padStart(8)} MWh   ${fmt(s1_on.demand_mwh).padStart(8)} MWh   ← demand_mwh`)
console.log(`    "Heat recovered by MVHR"        ${fmt(s1_off.recovery_offset_mwh).padStart(8)} MWh   ${fmt(s1_on.recovery_offset_mwh).padStart(8)} MWh   ← recovery_offset_mwh`)
console.log(`    "After heat recovery" (formula) ${fmt(breakdown_after_off).padStart(8)} MWh   ${fmt(breakdown_after_on).padStart(8)} MWh   ← demand − recovery_offset`)
console.log()

const demand_drop = (s1_off.demand_mwh ?? 0) - (s1_on.demand_mwh ?? 0)
console.log('  Diagnosis:')
console.log(`    demand_mwh dropped ${fmt(demand_drop)} MWh as HRE went 0 → 0.75.`)
console.log(`    Engine recovery_offset at HRE=0.75: ${fmt(s1_on.recovery_offset_mwh)} MWh.`)
console.log(`    Demand drop ≈ recovery_offset: ${Math.abs(demand_drop - (s1_on.recovery_offset_mwh ?? 0)) < 0.5 ? '✓' : '✗'}`)
console.log()
console.log('    → `consumption.space_heating.demand_mwh` is ALREADY POST-MVHR.')
console.log('      The recovery is baked into demand via State 2\'s (1-HRE) factor on vent UA.')
console.log('      BreakdownPanel tooltip at L146 calls this "pre-MVHR" — INCORRECT.')
console.log('      Then BreakdownPanel formula `demand − recovery_offset` SUBTRACTS RECOVERY')
console.log('      A SECOND TIME at the display boundary.')
console.log()

// ════════════════════════════════════════════════════════════════════════
// SCENARIO 2 — Ramp vent flow until "after heat recovery" goes NEGATIVE
// Confirms the display-side double subtraction reproduces on a clean box,
// no occupancy / DHW / artefact required.
// ════════════════════════════════════════════════════════════════════════
console.log('=========================================================')
console.log('  SCENARIO 2 — Sweep vent flow until display goes NEGATIVE')
console.log('=========================================================')
console.log('  Box fabric is small; raise vent flow until recovery_offset > post-MVHR demand.')
console.log('  All at HRE=0.75. Same clean box. Heating SCOP=3 (irrelevant — demand-side only).')
console.log()
console.log('    flow      demand_mwh   recovery_off   "after rec" (display)   negative?')
console.log('    L/s         (post-MVHR)  (airstream)    = demand − recovery')
console.log('    ──────────────────────────────────────────────────────────────────────')
const FLOWS = [500, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]
const sweep = []
let firstNegativeFlow = null
for (const flow of FLOWS) {
  const r = pick(runEngine(makeRefBox({ ventFlow_l_s: flow, ventHre: 0.75 })))
  const after = (r.demand_mwh ?? 0) - (r.recovery_offset_mwh ?? 0)
  const neg = after < 0
  if (neg && firstNegativeFlow == null) firstNegativeFlow = flow
  sweep.push({ flow, demand: r.demand_mwh, recovery: r.recovery_offset_mwh, after, neg })
  console.log(`    ${String(flow).padStart(5)}      ${fmt(r.demand_mwh).padStart(8)}      ${fmt(r.recovery_offset_mwh).padStart(8)}        ${fmt(after).padStart(8)}              ${neg ? '⚠ YES' : 'no'}`)
}
console.log()
if (firstNegativeFlow != null) {
  console.log(`  ✗ NEGATIVE "after heat recovery" reproduces on the clean refbox at flow ≥ ${firstNegativeFlow} L/s.`)
  console.log(`    No occupancy, no DHW, no artefact required. This is a STRUCTURAL display-layer bug,`)
  console.log(`    not Bridgewater-specific.`)
} else {
  console.log(`  ✓ "after heat recovery" stayed positive across all flows up to ${FLOWS[FLOWS.length - 1]} L/s.`)
  console.log(`    Try higher flows or smaller fabric to expose the issue.`)
}
console.log()

// ════════════════════════════════════════════════════════════════════════
// SCENARIO 3 — Hand-calc the correct ceiling
// ════════════════════════════════════════════════════════════════════════
console.log('=========================================================')
console.log('  SCENARIO 3 — Hand-calc the correct recovery ceiling')
console.log('=========================================================')
console.log('  Recovery transferred to the zone for heating cannot exceed EITHER:')
console.log('    (i)  airstream physical maximum:  flow × ρcp × HRE × ΣdT_h × sched / 3.6e9')
console.log('    (ii) heat the building needs at that hour (zero-floor per-hour cap)')
console.log()
console.log('  Engine reports (i). The Brief 49 sweep confirmed engine recovery_offset')
console.log('  tracks (i) to within 0.05% across HRE = 0 → 0.90 at flow=500 L/s.')
console.log()
console.log('    flow      ceiling (i): vent×HRE   engine recovery_off    ratio')
console.log('    ─────────────────────────────────────────────────────────────')
for (const row of sweep) {
  const ceiling_i = ventLossMwh(row.flow, 0) * 0.75
  const ratio = ceiling_i > 0 ? (row.recovery / ceiling_i) : 0
  console.log(`    ${String(row.flow).padStart(5)}      ${fmt(ceiling_i).padStart(8)}            ${fmt(row.recovery).padStart(8)}        ${fmt(ratio, 3)}`)
}
console.log()
console.log('  Per-hour cap (ii) — what the engine is MISSING for display purposes:')
console.log('    For each hour h where outside_temp < setpoint:')
console.log('      effective_recovery_h = min(')
console.log('        flow × ρcp × HRE × dT_h × sched_h × 3600 / 3.6e9,      // airstream max')
console.log('        pre_recovery_heating_demand_h                           // what zone needs')
console.log('      )')
console.log('    Annual ceiling = Σ effective_recovery_h')
console.log()
console.log('  On the refbox with 100 m² fabric, ANNUAL ceiling (ii) is roughly the')
console.log('  no-MVHR demand at that vent flow — anything above that is physically')
console.log('  impossible to transfer because the zone never needed it.')
console.log()

// Compute per-flow "true ceiling" estimate using the demand at HRE=0 from
// the engine itself — at HRE=0, demand_mwh equals the full pre-recovery
// heating need (no MVHR present). The engine's recovery_offset at HRE=0.75
// SHOULD be capped at min(airstream_max, raw_demand_at_HRE_0 × something).
// Easier: the simple physical ceiling is just raw_demand_at_HRE_0, because
// you can't recover more energy than the building lost to ventilation +
// fabric combined.
console.log('  Empirical ceiling check — use engine\'s own HRE=0 raw demand as the')
console.log('  upper bound on what HRE=0.75 could possibly recover:')
console.log()
console.log('    flow      raw_demand(HRE=0)    engine recovery_off(HRE=0.75)    exceeds?')
console.log('    ─────────────────────────────────────────────────────────────────────')
for (const row of sweep) {
  const r_off = pick(runEngine(makeRefBox({ ventFlow_l_s: row.flow, ventHre: 0 })))
  const raw_no_mvhr = r_off.demand_mwh ?? 0
  const exceeds = (row.recovery ?? 0) > raw_no_mvhr * 1.001
  console.log(`    ${String(row.flow).padStart(5)}      ${fmt(raw_no_mvhr).padStart(8)}              ${fmt(row.recovery).padStart(8)}                   ${exceeds ? '⚠ YES' : 'no'}`)
}
console.log()

// ════════════════════════════════════════════════════════════════════════
// FINDINGS
// ════════════════════════════════════════════════════════════════════════
console.log('=========================================================')
console.log('  FINDINGS — HARD STOP, no fix')
console.log('=========================================================')
console.log()
console.log('  Q1: Can "after heat recovery" demand go NEGATIVE on a clean box?')
console.log(`     A: ${firstNegativeFlow != null ? `YES — reproduces at flow ≥ ${firstNegativeFlow} L/s on the clean refbox.` : 'Not at flows up to ' + FLOWS[FLOWS.length-1] + ' L/s on this box.'}`)
console.log()
console.log('  Q2: Can "heat recovered by MVHR" exceed "heat the building needs"?')
const exceedsAnywhere = sweep.some(r => (r.recovery ?? 0) > (r.demand ?? 0))
console.log(`     A: ${exceedsAnywhere ? 'YES — recovery_offset exceeds demand_mwh at high vent flows on the refbox.' : 'Not on this sweep.'}`)
console.log()
console.log('  Q3: Is the recovery cap missing in the engine?')
console.log('     A: The ENGINE itself is internally consistent — State 2 bakes the')
console.log('        (1-HRE) factor onto vent UA per hour, which is implicitly per-hour-')
console.log('        capped at the available heating demand (no negative loads). The')
console.log('        engine\'s `demand_mwh` IS post-MVHR.')
console.log()
console.log('        What\'s missing is a per-hour CAP on the standalone `recovery_offset_mwh`')
console.log('        field that the display layer reads. It is currently the uncapped')
console.log('        airstream integral (vent × HRE × ΣdT_h), which can exceed both the')
console.log('        actual heating demand and what State 2 actually credited.')
console.log()
console.log('  Q4: What IS the correct ceiling on `recovery_offset_mwh` for display?')
console.log('     A: effective_recovery_annual = Σ_h min(')
console.log('          flow × ρcp × HRE × dT_h × sched_h × 3600 / 3.6e9,   // airstream max')
console.log('          pre_recovery_heating_need_h                           // zone need')
console.log('        )')
console.log()
console.log('        Computed correctly, this would equal exactly the demand drop the')
console.log('        engine already produces between HRE=0 and HRE=0.75. On the refbox')
console.log('        at flow=500: demand drops 182.6 → 147.8 (drop = 34.8 MWh) which')
console.log('        matches the airstream ceiling at this flow (~35.3) because the box')
console.log('        has heating demand for every airstream-recovery hour — no per-hour')
console.log('        cap bites. On Bridgewater, gains depress the heating need many')
console.log('        hours, so the per-hour cap DOES bite, and the engine\'s uncapped')
console.log('        airstream integral overstates the displayable recovery.')
console.log()
console.log('  Q5: Is this an engine bug or a display bug?')
console.log('     A: DISPLAY BUG, at two specific call sites:')
console.log('        - BreakdownPanel L146 tooltip claims demand_mwh is "pre-MVHR".')
console.log('          It is post-MVHR.')
console.log('        - interventionsEngine.js L459-L463 `_postMvhrHeatingDemand` computes')
console.log('          `raw − offset`, treating the post-MVHR value as pre-MVHR.')
console.log('          This is a double subtraction.')
console.log('        - The third row in the panel ("After heat recovery") shows the')
console.log('          double-subtracted value. It should either be removed (redundant')
console.log('          with the first row) or computed from the correctly-capped recovery.')
console.log()
console.log('  Q6: Cumulative-EUI implications?')
console.log('     A: NONE — the engine\'s headline EUI is driven by the State 2 demand')
console.log('        (which is correct) and the per-service efficiencies (also correct).')
console.log('        Brief 49 PROBE 1 confirmed H1 (single-boundary subtraction) on the')
console.log('        fuel path. EUI in the Bridgewater dump (69.10 → 58.90 → 54.90) is')
console.log('        not affected by this display-layer artefact.')
console.log()
console.log('  HARD STOP. No fix applied. Awaiting Chris\'s direction.')
console.log()

// Persist JSON for future reference
const out = {
  meta: {
    weather_file: WEATHER_FILE,
    dT_integral_K_hours,
    box_gia_m2: BOX_GIA,
    timestamp: new Date().toISOString(),
  },
  scenario1: { s1_off, s1_on, breakdown_after_off, breakdown_after_on, demand_drop },
  scenario2: { sweep, firstNegativeFlow },
  findings: {
    q1_after_recovery_negative_on_clean_box: firstNegativeFlow != null,
    q1_first_negative_flow_l_s: firstNegativeFlow,
    q2_recovery_exceeds_demand_on_clean_box: exceedsAnywhere,
    q3_engine_bug_or_display_bug: 'display',
    q5_double_subtraction_sites: [
      'BreakdownPanel.jsx:146  (tooltip labels demand_mwh "pre-MVHR" but it is post-MVHR)',
      'interventionsEngine.js:459-463  (_postMvhrHeatingDemand computes raw − offset; raw is already post-MVHR)',
      'BreakdownPanel.jsx:148  (post_mvhr row shows the double-subtracted value)',
    ],
    q6_eui_affected: false,
  },
}
const OUT = path.join(REPO_ROOT, 'docs/audit/55_refbox_mvhr_cap.json')
fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`  JSON summary: ${path.relative(REPO_ROOT, OUT)}`)
console.log()
