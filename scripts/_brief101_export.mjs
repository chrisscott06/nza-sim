/** Brief 101 — re-export Bridgewater_Hotel_interventions.xlsx from the live DB, using the
 * SAME buildInterventionsWorkbook the UI download uses (now with lifecycle £/tonne + the
 * Assumptions sheet). Engine untouched — pure consumer. Writes the file to repo root.
 * Run (backend up): node scripts/_brief101_export.mjs */
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'
import * as XLSX from '../frontend/node_modules/xlsx/xlsx.mjs'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { runInterventionStack } from '../frontend/src/utils/interventionsEngine.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'
import { buildInterventionsWorkbook } from '../frontend/src/utils/interventionExport.js'
import { computeInterventionMetrics } from '../frontend/src/utils/interventionMetrics.js'

const API = 'http://127.0.0.1:8002', PID = '12cf7cc4-9bdc-41bc-ab4e-24e044fbad9d'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const proj = await (await fetch(`${API}/api/projects/${PID}`)).json()
const libArr = (await (await fetch(`${API}/api/library/constructions`)).json()).constructions ?? []
const building = proj.building_config, constructions = proj.construction_choices
const comfortBand = { lower_c: proj.comfort_band_lower_c ?? 20, upper_c: proj.comfort_band_upper_c ?? 26 }
const interventions = building.interventions ?? []
const gia = building.length * building.width * (building.num_floors ?? 5)
const epw = fs.readFileSync(path.join(REPO, 'data/weather/current', building.weather_file), 'utf-8').split(/\r?\n/)
const lat = +epw[0].split(',')[6]; const Dl = epw.slice(8).filter(l => l.trim()); const N = Dl.length
const mo = new Int8Array(N), dy = new Int8Array(N), hr = new Int8Array(N), te = new Float32Array(N), dn = new Float32Array(N), df = new Float32Array(N), ws = new Float32Array(N)
for (let i = 0; i < N; i++) { const p = Dl[i].split(','); mo[i] = +p[1]; dy[i] = +p[2]; hr[i] = +p[3]; te[i] = +p[6]; dn[i] = +p[14]; df[i] = +p[15]; ws[i] = +p[21] }
const wd = { temperature: te, direct_normal: dn, diffuse_horizontal: df, wind_speed: ws, month: mo, day: dy, hour: hr }
const hs = computeHourlySolarByFacade(wd, lat, building.orientation ?? 0)
const lib = { constructions: libArr.map(c => ({ name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K, y_factor: 1, g_value: c.config_json?.g_value, config_json: c.config_json ?? c, layers: c.layers })), system_templates: SYSTEM_TEMPLATES_LIBRARY, library_systems: building?.library_systems ?? [], library_schedules: building?.library_schedules ?? [] }
const runEngine = (cfg) => calculateInstant(cfg.building ?? building, cfg.constructions ?? constructions, cfg.systems ?? {}, cfg.libraryData ?? lib, wd, hs, null, { mode: 'full', comfortBand, engine: 'v2.5', _skipInterventions: true })
const baseCfg = { building, constructions, systems: {}, libraryData: lib, comfortBand }
const isolatedRows = interventions.map(iv => {
  const stack = runInterventionStack(baseCfg, [{ id: iv.id, label: iv.label, patches: iv.patches, enabled: true }], runEngine, lib)
  return { id: iv.id, cumulativeDelta: stack.interventions[0].cumulative_delta, isolatedResult: { baseline: stack.baseline } }
})
const wb = buildInterventionsWorkbook({ interventions, isolatedRows, projectDefaults: building.cost_defaults, gia })
const OUT = path.join(REPO, 'Bridgewater_Hotel_interventions.xlsx')
fs.writeFileSync(OUT, XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }))
console.log('wrote', OUT, `(${(fs.statSync(OUT).size / 1024).toFixed(0)} KB) · sheets:`, wb.SheetNames.join(', '))
// spot-check DHW ASHP £/tonne (lifecycle) + a fabric measure (unchanged)
const rowById = Object.fromEntries(isolatedRows.map(r => [r.id, r]))
for (const iv of interventions) {
  if (!/1\.4|full DHW off gas|Brise soleil/.test(iv.label)) continue
  const m = computeInterventionMetrics(iv, rowById[iv.id]?.cumulativeDelta, building.cost_defaults, gia)
  console.log(`  ${iv.label.slice(0,34).padEnd(36)} life=${m.measureLifeYears} repl=${m.replacements} capex=£${Math.round(m.costTotal)} £/t=${m.poundsPerTonne?.toFixed(0)}`)
}
