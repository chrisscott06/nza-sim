/**
 * scripts/_brief58_c_lighting.mjs
 *
 * Brief 58 Part C — Lighting/gains decoupling fix verification.
 *
 * Three Bridgewater runs:
 *   1. Baseline (v40 lighting cf=0.86, enabled).
 *   2. Lighting disabled (v40 lighting enabled=false).
 *   3. Lighting at cf=1.0 (un-dimmed reference for arithmetic check).
 *
 * Gates (from docs/audit/58_lighting.md §5):
 *   C-G1  Baseline lighting gain   = 76.537 × 0.86 = 65.822 MWh (±0.5)
 *   C-G2  Baseline lighting elec   = 65.822 MWh (±0.5, unchanged)
 *   C-G3  Baseline equipment gain  = 78.864 MWh (cf=1, unchanged)
 *   C-G4  Baseline equipment elec  = 78.864 MWh (unchanged)
 *   C-G5  Disabled lighting gain   = 0 (±0.05)
 *   C-G6  Disabled lighting elec   = 0 (±0.05)
 *   C-G7  Disabled → heating demand RISES vs baseline
 *   C-G8  Disabled → cooling demand FALLS vs baseline
 *   C-G9  Δheating + |Δcooling| bounded by ≤ 76.537 MWh
 *   C-D1  Baseline EUI moves 109.9 → expected +1..+3 (document, not gate)
 *
 * Writes docs/audit/58_c_lighting.json. Read-only over the API.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const API = process.env.NZA_API || 'http://127.0.0.1:8003'
const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json() }

const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const lib     = await fj(`${API}/api/library/constructions`)
const libArr  = lib.constructions ?? []
const constructions = project.construction_choices
const comfortBand = { lower_c: project.comfort_band_lower_c ?? 20, upper_c: project.comfort_band_upper_c ?? 26 }
const baseBuilding = JSON.parse(JSON.stringify(project.building_config))

const weatherFile = baseBuilding.weather_file || project.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
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
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, Number(baseBuilding.orientation ?? 0))
const libraryData = {
  constructions: libArr.map(c => ({ name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K, y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0, g_value: c.config_json?.g_value, config_json: c.config_json ?? c, layers: c.layers })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
}

function runOnce(mutate) {
  const b = JSON.parse(JSON.stringify(baseBuilding))
  if (typeof mutate === 'function') mutate(b)
  const r = calculateInstant(b, constructions, {}, libraryData, weatherData, hourlySolar, null, { mode: 'full', engine: 'v2.5', comfortBand, _skipInterventions: true })
  const hb = r?.heat_balance?.annual ?? {}
  const ig = hb?.gains?.internal ?? {}
  const b40 = r?.consumption?.brief40
  return {
    eui_kwh_per_m2:                b40?.totals?.eui_kWh_per_m2 ?? null,
    heating_demand_mwh:            r?.demand?.heating_demand_mwh ?? null,
    cooling_demand_mwh:            r?.demand?.cooling_demand_mwh ?? null,
    lighting_gain_mwh:             (ig?.lighting?.kwh ?? 0) / 1000,
    equipment_gain_mwh:            (ig?.equipment?.kwh ?? 0) / 1000,
    people_gain_mwh:               (ig?.people?.kwh ?? 0) / 1000,
    lighting_electricity_mwh:      b40?.lighting?.total_delivered_electrical_mwh ?? null,
    small_power_electricity_mwh:   b40?.small_power?.total_delivered_electrical_mwh ?? null,
    lighting_systems_view:         b40?.lighting?.systems ?? null,
  }
}

const baseline = runOnce(null)
const disabled = runOnce(b => {
  for (const s of (b.systems_config_v40?.lighting ?? [])) s.enabled = false
})
const undimmed = runOnce(b => {
  for (const s of (b.systems_config_v40?.lighting ?? [])) s.control_factor = 1.0
})

// Baseline lighting (current Bridgewater): cf=0.86, expected gain =
// pre-Part-C gain × 0.86. The pre-Part-C lighting gain on Bridgewater
// is 76.537 MWh (captured before the fix); the expected new gain is
// 76.537 × 0.86 = 65.822 MWh.
const PRE_PARTC_LIGHTING_GAIN_MWH = 76.537
const EXPECTED_BASELINE_LIGHTING_GAIN = PRE_PARTC_LIGHTING_GAIN_MWH * 0.86
const EXPECTED_BASELINE_LIGHTING_ELEC = PRE_PARTC_LIGHTING_GAIN_MWH * 0.86 // gain == electricity (1:1 in Part C)
const EXPECTED_BASELINE_EQUIPMENT_GAIN = 78.864
const EXPECTED_BASELINE_EQUIPMENT_ELEC = 78.864

const dHeating_disabled = (disabled.heating_demand_mwh ?? 0) - (baseline.heating_demand_mwh ?? 0)
const dCooling_disabled = (disabled.cooling_demand_mwh ?? 0) - (baseline.cooling_demand_mwh ?? 0)
const dEUI_baseline_vs_pre_partc = (baseline.eui_kwh_per_m2 ?? 0) - 109.9  // pre-Part-C anchor

const gates = {
  'C-G1 baseline lighting gain matches 76.537×0.86':       Math.abs((baseline.lighting_gain_mwh ?? 0) - EXPECTED_BASELINE_LIGHTING_GAIN) < 0.5,
  'C-G2 baseline lighting electricity = gain (cf in gain)': Math.abs((baseline.lighting_electricity_mwh ?? 0) - EXPECTED_BASELINE_LIGHTING_ELEC) < 0.5,
  'C-G3 baseline equipment gain unchanged':                 Math.abs((baseline.equipment_gain_mwh ?? 0) - EXPECTED_BASELINE_EQUIPMENT_GAIN) < 0.5,
  'C-G4 baseline equipment electricity unchanged':          Math.abs((baseline.small_power_electricity_mwh ?? 0) - EXPECTED_BASELINE_EQUIPMENT_ELEC) < 0.5,
  'C-G5 disabled → lighting gain = 0':                       Math.abs(disabled.lighting_gain_mwh ?? -1) < 0.05,
  'C-G6 disabled → lighting electricity = 0':                Math.abs(disabled.lighting_electricity_mwh ?? -1) < 0.05,
  'C-G7 disabled → heating demand RISES':                    dHeating_disabled > 0,
  'C-G8 disabled → cooling demand FALLS':                    dCooling_disabled < 0,
  'C-G9 magnitude bounded by lighting gain (≤ 76.54 MWh)':   (Math.abs(dHeating_disabled) + Math.abs(dCooling_disabled)) <= 76.6,
}
const all_pass = Object.values(gates).every(Boolean)

const out = {
  generated_at: new Date().toISOString(),
  brief: '58 Part C — Lighting/gains decoupling',
  api: API,
  project: { id: PROJECT_ID, name: project.name, gia_m2: 4322 },
  expected: {
    pre_partc_lighting_gain_mwh: PRE_PARTC_LIGHTING_GAIN_MWH,
    baseline_lighting_cf:        0.86,
    baseline_lighting_gain_new:  EXPECTED_BASELINE_LIGHTING_GAIN,
    baseline_lighting_elec_new:  EXPECTED_BASELINE_LIGHTING_ELEC,
    baseline_equipment_gain:     EXPECTED_BASELINE_EQUIPMENT_GAIN,
    baseline_equipment_elec:     EXPECTED_BASELINE_EQUIPMENT_ELEC,
  },
  runs: {
    baseline,       // current v40.lighting cf=0.86 enabled
    disabled,       // v40.lighting enabled=false
    undimmed,       // v40.lighting cf=1.0 (sanity)
  },
  diffs: {
    disabled_minus_baseline: {
      heating_demand_mwh: dHeating_disabled,
      cooling_demand_mwh: dCooling_disabled,
      lighting_gain_mwh:  (disabled.lighting_gain_mwh ?? 0) - (baseline.lighting_gain_mwh ?? 0),
      lighting_elec_mwh:  (disabled.lighting_electricity_mwh ?? 0) - (baseline.lighting_electricity_mwh ?? 0),
      eui_kwh_per_m2:     (disabled.eui_kwh_per_m2 ?? 0) - (baseline.eui_kwh_per_m2 ?? 0),
    },
    eui_anchor_move_from_pre_partc: dEUI_baseline_vs_pre_partc,
  },
  gates,
  all_pass,
}

const outPath = path.join(REPO_ROOT, 'docs/audit/58_c_lighting.json')
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(out, null, 2))

console.log('Brief 58 Part C — Lighting/gains decoupling')
console.log('--------------------------------------------')
console.log(`Baseline:  EUI=${baseline.eui_kwh_per_m2}  heating=${baseline.heating_demand_mwh}  cooling=${baseline.cooling_demand_mwh}  light_gain=${baseline.lighting_gain_mwh?.toFixed(3)}  light_elec=${baseline.lighting_electricity_mwh}  equip_gain=${baseline.equipment_gain_mwh?.toFixed(3)}  equip_elec=${baseline.small_power_electricity_mwh}`)
console.log(`Disabled:  EUI=${disabled.eui_kwh_per_m2}  heating=${disabled.heating_demand_mwh}  cooling=${disabled.cooling_demand_mwh}  light_gain=${disabled.lighting_gain_mwh?.toFixed(3)}  light_elec=${disabled.lighting_electricity_mwh}`)
console.log(`Undimmed (cf=1.0): EUI=${undimmed.eui_kwh_per_m2}  heating=${undimmed.heating_demand_mwh}  cooling=${undimmed.cooling_demand_mwh}  light_gain=${undimmed.lighting_gain_mwh?.toFixed(3)}`)
console.log(`ΔEUI (disable - baseline): ${out.diffs.disabled_minus_baseline.eui_kwh_per_m2?.toFixed(2)} kWh/m²·yr`)
console.log(`ΔEUI anchor move (baseline vs pre-Part-C 109.9): ${dEUI_baseline_vs_pre_partc.toFixed(2)} kWh/m²·yr`)
console.log('Gates:')
for (const [k, v] of Object.entries(gates)) console.log(`  ${v ? '✓' : '✗'} ${k}`)
console.log(all_pass ? 'Part C PASS' : 'Part C FAIL')
console.log(`Wrote ${outPath}`)
process.exit(all_pass ? 0 : 1)
