/**
 * scripts/state1_shading_diagnostic.mjs
 *
 * Brief 26.1 follow-up — confirm whether shading inputs (overhangs + fins)
 * actually move solar gains in each engine.
 *
 * Tests THREE shading configs on Bridgewater:
 *   1. No shading (all zero on every facade)
 *   2. Current persisted config (whatever the user has set)
 *   3. Extreme shading on F3 South (2 m overhang + 1 m fins)
 *
 * For each, prints:
 *   - Live-engine solar per facade (kWh)
 *   - Live-engine summer_max_c
 *   - shadingFactors as returned by computeShadingFactors()
 *
 * If LIVE solar values don't change between configs → live engine ignores
 *   shading. (Suspicion: SHADING_FACTOR hardcoded to 1.0 in _calculateEnvelopeOnly.)
 * If only EP solar doesn't change → Brief 23's longstanding EP shading bug
 *   is still unresolved.
 *
 * EP runs are skipped by default (each takes ~3s × 3 = 9s); pass --ep to
 * include them.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant, computeShadingFactors } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'

const PROJECT_ID = process.argv[2] || '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const RUN_EP = process.argv.includes('--ep')
const API = 'http://127.0.0.1:8002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function fetchJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

// ── Load project + library + weather ────────────────────────────────────────
const project = await fetchJson(`${API}/api/projects/${PROJECT_ID}`)
const lib = await fetchJson(`${API}/api/library/constructions`)
const libraryData = {
  constructions: (lib.constructions ?? []).map(c => ({
    name: c.name,
    type: c.type ?? c.config_json?.type,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    config_json: c.config_json ?? c,
    layers: c.layers,
  })),
}
const baseBuilding = project.building_config
const comfortBand = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}

const weatherFile = baseBuilding.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const lines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(lines[0].split(',')[6])
const data = lines.slice(8).filter(l => l.trim())
const N = data.length
const month = new Int8Array(N), day = new Int16Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), wind_speed = new Float32Array(N)
const direct_normal = new Float32Array(N), diffuse_horizontal = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = data[i].split(',')
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6])
  direct_normal[i] = parseFloat(p[14]); diffuse_horizontal[i] = parseFloat(p[15])
  wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, hour, day }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, baseBuilding.orientation || 0)

// ── Shading configs to test ──────────────────────────────────────────────────
const ZERO = {
  shading_overhang: { north: {depth_m: 0, offset_m: 0}, south: {depth_m: 0, offset_m: 0},
                      east:  {depth_m: 0, offset_m: 0}, west:  {depth_m: 0, offset_m: 0} },
  shading_fin:      { north: {left_depth_m: 0, right_depth_m: 0}, south: {left_depth_m: 0, right_depth_m: 0},
                      east:  {left_depth_m: 0, right_depth_m: 0}, west:  {left_depth_m: 0, right_depth_m: 0} },
}
const CURRENT = {
  shading_overhang: baseBuilding.shading_overhang ?? ZERO.shading_overhang,
  shading_fin:      baseBuilding.shading_fin      ?? ZERO.shading_fin,
}
const EXTREME = {
  shading_overhang: { ...ZERO.shading_overhang, south: {depth_m: 2.0, offset_m: 0} },
  shading_fin:      { ...ZERO.shading_fin,      south: {left_depth_m: 1.0, right_depth_m: 1.0} },
}

const scenarios = [
  { label: 'NO SHADING (all zero)',    building: { ...baseBuilding, ...ZERO } },
  { label: 'CURRENT persisted config', building: { ...baseBuilding, ...CURRENT } },
  { label: 'EXTREME on F3 South (2m overhang + 1m fins)', building: { ...baseBuilding, ...EXTREME } },
]

console.log()
console.log('═════════════════════════════════════════════════════════════════════')
console.log('  SHADING DIAGNOSTIC — does shading move solar gains?')
console.log('═════════════════════════════════════════════════════════════════════')
console.log()

for (const { label, building } of scenarios) {
  const sf = computeShadingFactors(building)
  const live = calculateInstant(
    { ...building, comfort_band: comfortBand },
    project.construction_choices, project.systems_config ?? {}, libraryData,
    weatherData, hourlySolar, null,
    { mode: 'envelope-only', comfortBand },
  )
  console.log(`  ${label}`)
  console.log(`    shadingFactors:  N=${sf.north.toFixed(2)}  S=${sf.south.toFixed(2)}  E=${sf.east.toFixed(2)}  W=${sf.west.toFixed(2)}`)
  const solar = live.gains?.solar ?? {}
  console.log(`    live solar kWh:  f1(N)=${(solar.f1 ?? 0).toFixed(0).padStart(7)}  f2(E)=${(solar.f2 ?? 0).toFixed(0).padStart(7)}  f3(S)=${(solar.f3 ?? 0).toFixed(0).padStart(7)}  f4(W)=${(solar.f4 ?? 0).toFixed(0).padStart(7)}  total=${(solar.total ?? 0).toFixed(0)}`)
  console.log(`    live summer_max: ${live.free_running?.summer_max_c?.toFixed(1)}°C`)
  console.log(`    live cooling MWh: ${live.demand?.cooling_demand_mwh?.toFixed(1)}`)
  console.log()
}

// ── EP path (optional) ──────────────────────────────────────────────────────
if (RUN_EP) {
  console.log('  ───────────────────────────────────────────────────────────────────')
  console.log('  EP SIMULATION RUNS (each ~3s)')
  console.log('  ───────────────────────────────────────────────────────────────────')

  async function patchAndSim(label, building) {
    // PUT the project's building_config to the test config, run sim, restore.
    // /projects/{id}/building is a merge-update — we send only the shading
    // keys we want to test so other fields stay intact.
    const r = await fetch(`${API}/api/projects/${PROJECT_ID}/building`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shading_overhang: building.shading_overhang,
        shading_fin:      building.shading_fin,
      }),
    })
    if (!r.ok) {
      console.log(`    ${label}: PUT failed ${r.status}`)
      return null
    }
    const sim = await fetch(`${API}/api/projects/${PROJECT_ID}/simulate?scenario_name=ShadingDiag&mode=envelope-only`, {
      method: 'POST',
    }).then(r => r.json())
    if (!sim.run_id) {
      console.log(`    ${label}: SIM FAILED — ${JSON.stringify(sim).slice(0, 200)}`)
      return null
    }
    const balance = await fetchJson(`${API}/api/projects/${PROJECT_ID}/simulations/${sim.run_id}/balance?mode=envelope-only`)
    return balance
  }

  for (const { label, building } of scenarios) {
    const bal = await patchAndSim(label, building)
    if (!bal) continue
    const losses = bal?.annual?.losses ?? {}
    const gains  = bal?.annual?.gains?.solar ?? {}
    console.log(`  ${label}`)
    console.log(`    EP solar kWh:    N=${(gains.north?.kwh ?? 0).toFixed(0).padStart(7)}  S=${(gains.south?.kwh ?? 0).toFixed(0).padStart(7)}  E=${(gains.east?.kwh ?? 0).toFixed(0).padStart(7)}  W=${(gains.west?.kwh ?? 0).toFixed(0).padStart(7)}  total=${(gains.total_kwh ?? 0).toFixed(0)}`)
    console.log(`    EP summer_max:   ${bal.free_running?.summer_max_c?.toFixed(1)}°C`)
    console.log(`    EP cooling MWh:  ${bal.demand?.cooling_demand_mwh?.toFixed(1)}`)
    console.log()
  }
  // Restore original config
  await fetch(`${API}/api/projects/${PROJECT_ID}/building`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shading_overhang: baseBuilding.shading_overhang,
      shading_fin:      baseBuilding.shading_fin,
    }),
  })
  console.log('  (project config restored)')
}

console.log('═════════════════════════════════════════════════════════════════════')
