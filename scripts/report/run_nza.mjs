/**
 * Brief 96 P5 — NZA-Sim isolated + cumulative runs against report_baseline_v1.
 *
 * Reuses the Brief 93 anchor's engine setup (weather/solar/libraryData) and drives the
 * SAME engine entry points the app uses: calculateInstant (baseline, _skipInterventions)
 * + runInterventionStack (interventionsEngine) for isolated singletons and the cumulative
 * phasing spine. NO engine change — pure consumer. Reads the intervention definitions from
 * docs/report/data/interventions.json (exported from the Python source of truth).
 *
 * Output: docs/report/data/nza_runs.json — baseline + per-ref isolated absolutes +
 * cumulative-spine running absolutes, each as {eui, elec_mwh, gas_mwh, heating_mwh,
 * cooling_mwh}. Same-path DHW/VRF caveats per OVERNIGHT_FINDINGS (cumulative DHW = lower
 * bound; 3.2 uses its post-3.1 override in the spine).
 *
 * Run: node scripts/report/run_nza.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../../frontend/src/utils/solarCalc.js'
import { runInterventionStack } from '../../frontend/src/utils/interventionsEngine.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../../frontend/src/data/systemTemplatesLibrary.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const FIXTURE = path.join(REPO_ROOT, 'validation/fixtures/report_baseline_v1.yaml')
const DEFS = path.join(REPO_ROOT, 'docs/report/data/interventions.json')
const OUT = path.join(REPO_ROOT, 'docs/report/data/nza_runs.json')

function loadYamlViaVenv(p) {
  const py = path.join(REPO_ROOT, 'validation/.venv/bin/python')
  const out = execFileSync(py, ['-c', 'import yaml,json,sys; json.dump(yaml.safe_load(open(sys.argv[1])), sys.stdout)', p],
    { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 })
  return JSON.parse(out)
}

// ── engine setup (mirrors _brief93_anchor.mjs) ───────────────────────────────
const fx = loadYamlViaVenv(FIXTURE)
const building = fx.building_config
const constructions = fx.construction_choices
const comfortBand = { lower_c: fx.comfort_band?.lower_c ?? 21, upper_c: fx.comfort_band?.upper_c ?? 24 }
const libArr = fx.library_constructions ?? []

const epwPath = path.join(REPO_ROOT, 'data/weather/current', building.weather_file)
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
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, building.orientation ?? 0)
const libraryData = {
  constructions: libArr.map(c => ({
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    g_value: c.config_json?.g_value, config_json: c.config_json ?? c, layers: c.layers,
  })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
  library_systems: building?.library_systems ?? [],
  library_schedules: building?.library_schedules ?? [],
}

const runEngine = (cfg) => calculateInstant(
  cfg.building ?? building, cfg.constructions ?? constructions, cfg.systems ?? {},
  cfg.libraryData ?? libraryData, weatherData, hourlySolar, null,
  { mode: 'full', comfortBand, engine: 'v2.5', _skipInterventions: true },
)
const baselineConfig = { building, constructions, systems: {}, libraryData, comfortBand }

function extract(result) {
  const c = result?.consumption ?? {}
  return {
    eui: r1(c?.total?.kwh_per_m2_yr),
    elec_mwh: r3(c?.total?.electricity_mwh),
    gas_mwh: r3(c?.total?.gas_mwh),
    heating_mwh: r1(c?.space_heating?.demand_mwh),
    cooling_mwh: r1(c?.space_cooling?.demand_mwh),
    dhw_mwh: r1(c?.dhw?.demand_mwh),
  }
}
const r1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null)
const r3 = v => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null)

// ── runs ─────────────────────────────────────────────────────────────────────
const defs = JSON.parse(fs.readFileSync(DEFS, 'utf-8'))
const byRef = Object.fromEntries(defs.interventions.map(d => [d.ref, d]))

const baseline = extract(runEngine(baselineConfig))
console.error(`[nza] baseline EUI ${baseline.eui} | heat ${baseline.heating_mwh} | cool ${baseline.cooling_mwh}`)

// isolated — every modellable (Class A/B) alone against the bare baseline
const isolated = {}
for (const d of defs.interventions.filter(x => x.modellable)) {
  const singleton = [{ id: d.ref, label: d.name, patches: d.patches, enabled: true }]
  const stack = runInterventionStack(baselineConfig, singleton, runEngine, libraryData)
  isolated[d.ref] = extract(stack.interventions[0].result)
  console.error(`[nza] isolated ${d.ref} EUI ${isolated[d.ref].eui}`)
}

// cumulative — the phasing spine, modellable only (C/D skipped, recorded); 3.2 uses its
// post-3.1 override so it composes on the commissioned state (anti-double-count).
const spineMod = [], skips = []
for (const ref of defs.spine) {
  const d = byRef[ref]
  if (d.modellable) {
    const patches = (ref === '3.2' && d.cumulative_patch_override) ? d.cumulative_patch_override : d.patches
    spineMod.push({ id: ref, label: d.name, patches, enabled: true })
  } else {
    skips.push({ ref, reason: d.off_model ? 'off_model' : d.enabling ? 'enabling' : 'no_patch' })
  }
}
const cumStack = runInterventionStack(baselineConfig, spineMod, runEngine, libraryData)
const cumulative = cumStack.interventions.map((row, i) => ({ ref: spineMod[i].id, ...extract(row.result) }))
const finalCum = cumulative[cumulative.length - 1]
console.error(`[nza] cumulative final EUI ${finalCum.eui} (baseline ${baseline.eui}); ${skips.length} skipped`)

fs.writeFileSync(OUT, JSON.stringify({
  _meta: { fixture: 'report_baseline_v1', engine: 'v2.5', generated_by: 'scripts/report/run_nza.mjs' },
  baseline, isolated,
  cumulative: { order: spineMod.map(s => s.id), skips, states: cumulative },
}, null, 1))
console.error(`[nza] wrote ${path.relative(REPO_ROOT, OUT)}`)
