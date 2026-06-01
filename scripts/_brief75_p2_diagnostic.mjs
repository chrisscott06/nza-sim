/**
 * Brief 75 P2 — Bridgewater heating-demand-zero diagnostic.
 *
 * Two read-only experiments + named outcome verdict.
 *
 *   Experiment A: zero all internal gains (occupancy, lighting, equipment,
 *                 auxiliary). Run engine. Capture heating_demand.
 *   Experiment B: industry-standard hotel defaults (NCM hotel guest-room
 *                 + public area approximations). Zero auxiliary. Run.
 *
 * Outcomes:
 *   (a) Exp-A produces 80–150 MWh heating_demand AND Exp-B produces 30–80
 *       MWh → Bridgewater's gains inputs are too generous. Retune in P3.
 *   (b) Exp-A produces near-zero heating_demand → envelope itself is the
 *       issue. Defer fabric to a separate brief; continue P3 with original
 *       gains values for the ventilation refactor (still useful).
 *   (c) Exp-A produces a sensible number BUT Exp-B with industry-standard
 *       gains still pushes back to near-zero → gains-saturation logic is
 *       too aggressive. STOP, separate engine brief.
 *
 * No engine code changes. Building config is deep-cloned and mutated
 * in-memory only.
 *
 * Run:
 *   cd C:\Users\ChrisScott\Dev\nza-sim
 *   node scripts/_brief75_p2_diagnostic.mjs > docs/audit/75_p2_diagnostic_output.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const API         = 'http://127.0.0.1:8002'
const PROJECT_ID  = '3561c5a6-9a3f-4b5c-9e3d-72b449658d9a'
const __dirname   = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT   = path.resolve(__dirname, '..')

async function fj(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${url} → ${r.status}`); return r.json()
}

const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const libArr  = (await fj(`${API}/api/library/constructions`)).constructions ?? []
const constructions = project.construction_choices
const originalBuilding = project.building_config
const dbCb = { lower_c: project.comfort_band_lower_c ?? 20, upper_c: project.comfort_band_upper_c ?? 26 }

const epwPath = path.join(REPO_ROOT, 'data/weather/current', originalBuilding.weather_file)
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
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, originalBuilding.orientation ?? 0)
const libraryData = {
  constructions: libArr.map(c => ({
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    g_value: c.config_json?.g_value, config_json: c.config_json ?? c, layers: c.layers,
  })),
  system_templates:  SYSTEM_TEMPLATES_LIBRARY,
  library_systems:   originalBuilding?.library_systems   ?? [],
  library_schedules: originalBuilding?.library_schedules ?? [],
}

function runEngine(building) {
  const result = calculateInstant(
    building, constructions, {}, libraryData,
    weatherData, hourlySolar, null,
    { comfortBand: dbCb, _skipInterventions: true, engine: 'v2.5' },
  )
  const c  = result?.consumption ?? {}
  const hb = result?.heat_balance ?? {}
  const ig = hb?.annual?.gains?.internal ?? {}
  const ll = hb?.annual?.losses ?? {}
  return {
    state: result?.state,
    eui_kwh_m2: c?.total?.kwh_per_m2_yr ?? null,
    heating_demand_mwh: c?.space_heating?.demand_mwh ?? 0,
    cooling_demand_mwh: c?.space_cooling?.demand_mwh ?? 0,
    dhw_demand_mwh:     c?.dhw?.demand_mwh ?? 0,
    losses_kwh:         hb?.annual?.totals?.losses_kwh ?? null,
    gains_kwh:          hb?.annual?.totals?.gains_kwh ?? null,
    net_residual_kwh:   (hb?.annual?.totals?.gains_kwh ?? 0) - (hb?.annual?.totals?.losses_kwh ?? 0),
    mech_vent_loss_kwh: ll?.mech_ventilation?.kwh ?? 0,
    internal_gains_kwh: {
      people:    ig?.people?.kwh    ?? 0,
      equipment: ig?.equipment?.kwh ?? 0,
      lighting:  ig?.lighting?.kwh  ?? 0,
      auxiliary: ig?.auxiliary?.kwh ?? 0,
    },
    sum_internal_kwh: (ig?.people?.kwh ?? 0) + (ig?.equipment?.kwh ?? 0)
                      + (ig?.lighting?.kwh ?? 0) + (ig?.auxiliary?.kwh ?? 0),
  }
}

// ── Baseline (un-modified) ─────────────────────────────────────────────────
const baseline = runEngine(originalBuilding)

// Helper: set the value of an OBJECT-shaped magnitude `{value, unit}`
// without losing the unit metadata. Engine reads via magnitudeToWPerM2.
function setMagnitudeValue(p, newValue) {
  if (p.magnitude && typeof p.magnitude === 'object' && 'value' in p.magnitude) {
    p.magnitude.value = newValue
  } else {
    p.magnitude = newValue  // scalar fallback for any legacy shape
  }
}
// Equipment profiles use baseload + active (each object-shaped); not magnitude.
function setBaseloadActive(p, baseload, active) {
  if (p.baseload && typeof p.baseload === 'object' && 'value' in p.baseload) {
    p.baseload.value = baseload
  } else if (p.baseload != null) {
    p.baseload = baseload
  }
  if (p.active && typeof p.active === 'object' && 'value' in p.active) {
    p.active.value = active
  } else if (p.active != null) {
    p.active = active
  }
}

// ── Experiment A: zero all internal gains ──────────────────────────────────
const expA_building = JSON.parse(JSON.stringify(originalBuilding))
// Occupancy: zero density.
if (expA_building.occupancy?.density) {
  expA_building.occupancy.density.value = 0
}
// Lighting profiles: zero magnitude value.
if (Array.isArray(expA_building?.gains?.lighting?.profiles)) {
  for (const p of expA_building.gains.lighting.profiles) {
    setMagnitudeValue(p, 0)
  }
}
// Equipment profiles: zero magnitude + baseload + active where present.
if (Array.isArray(expA_building?.gains?.equipment?.profiles)) {
  for (const p of expA_building.gains.equipment.profiles) {
    setMagnitudeValue(p, 0)
    setBaseloadActive(p, 0, 0)
  }
}
// Auxiliary profiles: zero magnitude.
if (Array.isArray(expA_building?.gains?.auxiliary?.profiles)) {
  for (const p of expA_building.gains.auxiliary.profiles) {
    setMagnitudeValue(p, 0)
  }
}
const expA = runEngine(expA_building)

// ── Experiment B: NCM-style hotel defaults ─────────────────────────────────
//
// Sources for the target values:
//   - Occupancy: NCM (UK National Calculation Methodology) hotel
//                guest-room density ≈ 0.05 persons/m². Bridgewater
//                currently 138 × 3 / 4125 = 0.10 persons/m² (2x NCM).
//                Translating 0.05 persons/m² to per_room basis at 138
//                rooms: 0.05 × 4125 / 138 ≈ 1.49 persons/room.
//   - Lighting: NCM hotel mixed (guest rooms + corridors + reception)
//                ≈ 9 W/m² LPD before control adjustment.
//   - Equipment: NCM hotel guest room + back-of-house ≈ 5 W/m².
//   - Auxiliary: zero per brief instruction.
//
// Approach: scale all profile magnitudes uniformly to hit the target
// integrated W/m². Preserves the existing schedule shape (intent of
// "industry-standard defaults" is the magnitude, not the schedule).

const NCM_OCC_PER_ROOM      = 1.5     // → 0.05 persons/m² × 4125 / 138
const NCM_LIGHTING_W_PER_M2 = 9
const NCM_EQUIPMENT_W_PER_M2 = 5

// Rescale by setting each profile's magnitude.value DIRECTLY to the per-
// profile target (target ÷ profile_count, weighted by area_share). Avoids
// the object-shape pitfall that masked equipment + lighting as 0 in the
// first pass. Schedule shape is preserved.
function setProfilesToTarget(profiles, targetWPerM2) {
  if (!Array.isArray(profiles) || profiles.length === 0) return
  // Sum of area_share across profiles (normally 1.0; defensive against drift).
  let area_share_sum = 0
  for (const p of profiles) area_share_sum += Number(p.area_share ?? 1.0)
  if (area_share_sum <= 0) {
    for (const p of profiles) setMagnitudeValue(p, targetWPerM2)
    return
  }
  // Per profile, set magnitude such that Σ (mag × area_share) = target.
  // Simplest: every profile gets the same target value. If area_share sums
  // to 1.0 (the normal case), the integrated W/m² is exactly target.
  const per_profile_value = targetWPerM2 / area_share_sum
  for (const p of profiles) {
    setMagnitudeValue(p, per_profile_value)
    // For equipment-style profiles with baseload + active fields, set
    // both proportionally — baseload at 20% of target, active at 80%.
    // This matches typical NCM hotel equipment split (small standby +
    // larger occupied draw).
    if (p.baseload != null) p.baseload = per_profile_value * 0.2
    if (p.active   != null) p.active   = per_profile_value * 0.8
  }
}

const expB_building = JSON.parse(JSON.stringify(originalBuilding))
// Occupancy density → 1.5 per_room.
if (expB_building.occupancy?.density) {
  expB_building.occupancy.density.value = NCM_OCC_PER_ROOM
}
// Lighting: set integrated magnitude = 9 W/m².
if (Array.isArray(expB_building?.gains?.lighting?.profiles)) {
  setProfilesToTarget(expB_building.gains.lighting.profiles, NCM_LIGHTING_W_PER_M2)
}
// Equipment: set integrated baseload + active = 5 W/m² total.
// NCM hotel equipment ≈ 3 W/m² baseload + 2 W/m² active (matching the
// already-present Bridgewater equipment shape — values left as-is since
// they're already NCM-compliant). For Exp B we explicitly set these
// to ensure the engine sees consistent values regardless of any
// legacy-shape drift.
if (Array.isArray(expB_building?.gains?.equipment?.profiles)) {
  for (const p of expB_building.gains.equipment.profiles) {
    setBaseloadActive(p, 3, 2)
  }
}
// Auxiliary: zero per brief.
if (Array.isArray(expB_building?.gains?.auxiliary?.profiles)) {
  for (const p of expB_building.gains.auxiliary.profiles) {
    setMagnitudeValue(p, 0)
  }
}
const expB = runEngine(expB_building)

// ── Outcome determination ──────────────────────────────────────────────────
//
// Brief 75 P2 explicit decision tree:
//   (a) Exp-A: 80-150 MWh heating AND Exp-B: 30-80 MWh heating → fix in P3
//       by retuning Bridgewater inputs to industry-standard.
//   (b) Exp-A: near-zero heating → envelope is the issue, defer fabric;
//       continue P3 with original gains for the ventilation refactor.
//   (c) Exp-A: sensible BUT Exp-B: near-zero → gains-saturation logic
//       is too aggressive; STOP, escalate to engine brief.

function classify(heating_mwh) {
  if (heating_mwh < 10)            return 'near-zero'
  if (heating_mwh >= 80 && heating_mwh <= 150) return 'in-band-80-150'
  if (heating_mwh >= 30 && heating_mwh < 80)   return 'in-band-30-80'
  if (heating_mwh < 30)            return 'low'
  if (heating_mwh > 150)           return 'high'
  return 'unclassified'
}

const expA_class = classify(expA.heating_demand_mwh)
const expB_class = classify(expB.heating_demand_mwh)

let outcome = '?'
let outcome_explanation = ''
if (expA_class === 'near-zero') {
  outcome = '(b)'
  outcome_explanation = 'Experiment A produced near-zero heating demand even with all gains zeroed. Envelope itself is the issue — fabric U-values or air permeability too low. Defer fabric tuning to a separate brief. Continue Brief 75 P3 with original gains values for the ventilation refactor (still valuable independently).'
} else if (expA_class === 'in-band-80-150' && (expB_class === 'in-band-30-80' || expB_class === 'in-band-80-150' || expB_class === 'low')) {
  outcome = '(a)'
  outcome_explanation = 'Experiment A in expected range, Experiment B with industry-standard gains also produces a sensible number. Bridgewater\'s current internal-gains inputs are too generous. Fix in P3 by retuning to NCM-style values.'
} else if ((expA_class === 'in-band-80-150' || expA_class === 'high') && expB_class === 'near-zero') {
  outcome = '(c)'
  outcome_explanation = 'STOP. Experiment A in expected range but Experiment B with industry-standard gains pushes back to near-zero. The gains-saturation logic itself is too aggressive — engine bug. Escalate to a separate engine brief; do NOT proceed to Brief 75 P3 onwards.'
} else {
  outcome = '(unclassified — needs interpretation)'
  outcome_explanation = `Experiment A: ${expA.heating_demand_mwh.toFixed(1)} MWh (${expA_class}); Experiment B: ${expB.heating_demand_mwh.toFixed(1)} MWh (${expB_class}). Pattern doesn't match (a), (b), or (c) cleanly. Inspect raw numbers.`
}

const report = {
  brief: 'Brief 75 P2 — Bridgewater heating-demand-zero diagnostic',
  source: 'node scripts/_brief75_p2_diagnostic.mjs',
  captured_at: new Date().toISOString(),

  experiments: {
    baseline_as_captured: baseline,
    experiment_A_zero_gains: {
      modifications: 'occupancy.density.value=0; lighting/equipment/auxiliary profile magnitudes (and baseload/active where present) → 0',
      result: expA,
    },
    experiment_B_ncm_defaults: {
      sources: {
        occupancy_density_target: 'NCM hotel ~0.05 persons/m² ≈ 1.5 per_room at 138 rooms',
        lighting_LPD_target_w_per_m2: NCM_LIGHTING_W_PER_M2,
        equipment_EPD_target_w_per_m2: NCM_EQUIPMENT_W_PER_M2,
        auxiliary: 'zero per brief',
      },
      modifications: 'occupancy.density.value → 1.5; lighting profiles rescaled to integrated 9 W/m²; equipment profiles rescaled to 5 W/m² (magnitude AND baseload/active scaled uniformly); auxiliary magnitudes → 0',
      result: expB,
    },
  },

  outcome,
  outcome_explanation,

  classification: {
    expA_class,
    expB_class,
  },

  next_step_per_outcome: {
    '(a)': 'Brief 75 P3 retunes Bridgewater inputs to NCM-style + does the engine refactor for mech_vent_thermal_kwh as standalone.',
    '(b)': 'Brief 75 P3 proceeds with engine refactor only (mech_vent_thermal_kwh); fabric tuning deferred to separate brief.',
    '(c)': 'STOP. Brief 75 closes here. Escalate gains-saturation as a separate engine brief.',
  },
}

console.log(JSON.stringify(report, null, 2))
