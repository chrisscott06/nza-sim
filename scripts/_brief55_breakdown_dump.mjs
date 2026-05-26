/**
 * scripts/_brief55_breakdown_dump.mjs
 *
 * Self-tracing diagnostic dump of the BreakdownPanel.
 *
 * Runs the engine for a given intervention stack (default: whatever
 * order is on the verification DB), then writes the EXACT data the UI
 * panel renders — every row, every column ("vs step above" /
 * "vs original") — to:
 *
 *   docs/audit/55_breakdown_dump.md      (human-readable tables)
 *   docs/audit/55_breakdown_dump.json    (structured for diff'ing across runs)
 *
 * Use case: I diagnose from the file instead of asking Chris to
 * screenshot the panel. Re-run with different stack orders to compare
 * what happens to a given intervention's marginal between, say,
 * [A, B] vs [B, A].
 *
 * Targets the verification backend (:8003). Read-only — no DB writes.
 *
 * Usage:
 *   node scripts/_brief55_breakdown_dump.mjs                            ← default Bridgewater, on-disk order
 *   node scripts/_brief55_breakdown_dump.mjs --order=VRF,MVHR           ← reorder by label substring match
 *   node scripts/_brief55_breakdown_dump.mjs --project=<UUID>           ← different project
 *   node scripts/_brief55_breakdown_dump.mjs --out=docs/audit/foo.md    ← custom output stem
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'
import {
  runInterventionStack,
  computeDelta,
  migrateInterventionPatches,
} from '../frontend/src/utils/interventionsEngine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

// ── Args ──────────────────────────────────────────────────────────────
const ARGS = Object.fromEntries(
  process.argv.slice(2).map(a => {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq < 0) return [a.slice(2), true]
      return [a.slice(2, eq), a.slice(eq + 1)]
    }
    return [a, true]
  })
)
const API        = process.env.NZA_API || 'http://127.0.0.1:8003'
const PROJECT_ID = ARGS.project || '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const ORDER_HINT = typeof ARGS.order === 'string' ? ARGS.order.split(',').map(s => s.trim()) : null
const OUT_STEM   = ARGS.out || 'docs/audit/55_breakdown_dump'

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(url); return r.json() }

// ── Load project + library + weather ─────────────────────────────────
const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const lib     = await fj(`${API}/api/library/constructions`)
const libArr  = lib.constructions ?? []
const constructions = project.construction_choices
const comfortBand = {
  lower_c: project.comfort_band_lower_c ?? 20,
  upper_c: project.comfort_band_upper_c ?? 26,
}
const baseBuilding = { ...project.building_config }

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
const orientation = Number(baseBuilding.orientation ?? 0)
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, orientation)
const libraryData = {
  constructions: libArr.map(c => ({
    name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0, g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c, layers: c.layers,
  })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
}

// ── Migrate legacy whole-object patches to field-level (Brief 55 Part 2) ─
const baselineForDiff = { systems_config_v40: baseBuilding.systems_config_v40 }
const allInterventions = (baseBuilding.interventions ?? []).map(intv => {
  const from = Number.isInteger(intv?.schema_version) ? intv.schema_version : 1
  return migrateInterventionPatches(intv, from, 3, baselineForDiff)
})

// ── Apply optional --order reordering ────────────────────────────────
let stack = allInterventions
if (ORDER_HINT) {
  const remaining = [...allInterventions]
  const reordered = []
  for (const hint of ORDER_HINT) {
    const re = new RegExp(hint, 'i')
    const idx = remaining.findIndex(i => re.test(i.label ?? ''))
    if (idx >= 0) reordered.push(...remaining.splice(idx, 1))
  }
  stack = [...reordered, ...remaining]
}
const stackLabels = stack.map(i => i.label)

// ── Run the engine cumulatively over the stack ────────────────────────
function runEngine(cfg) {
  return calculateInstant(
    cfg.building, cfg.constructions, cfg.systems, cfg.libraryData,
    weatherData, hourlySolar, null,
    { mode: 'full', engine: 'v2.5', comfortBand, _skipInterventions: true },
  )
}
const baselineCfg = { building: baseBuilding, constructions, systems: {}, libraryData }
const stackResult = runInterventionStack(baselineCfg, stack, runEngine, libraryData)

// ── Row spec (verbatim from BreakdownPanel.jsx ROWS at L144-172) ──────
const SECTIONS = {
  'Demand side — what the building needs': [
    { key: 'raw_demand',     label: 'Heat the building needs',  path: 'heating_raw_demand_mwh',           unit: 'MWh',     goodPositive: false },
    { key: 'mvhr_recovery',  label: 'Heat recovered by MVHR',   path: 'heating_recovery_offset_mwh',       unit: 'MWh',     goodPositive: true },
    { key: 'post_mvhr',      label: 'After heat recovery',      path: 'heating_post_mvhr_demand_mwh',      unit: 'MWh',     goodPositive: false },
    { key: 'cooling_demand', label: 'Cooling demand',            path: 'cooling_demand_mwh',                unit: 'MWh',     goodPositive: false },
    { key: 'dhw_demand',     label: 'Hot water demand',          path: 'per_service.dhw.demand_mwh',        unit: 'MWh',     goodPositive: false },
  ],
  'Delivered by systems': [
    { key: 'heat_del',       label: 'Heating delivered',         path: 'per_service.heating.delivered_mwh', unit: 'MWh',     goodPositive: false },
    { key: 'heat_eff',       label: 'Heating efficiency',         path: 'per_service.heating.efficiency',    unit: 'ratio',   goodPositive: true },
    { key: 'cool_del',       label: 'Cooling delivered',         path: 'per_service.cooling.delivered_mwh', unit: 'MWh',     goodPositive: false },
    { key: 'cool_eff',       label: 'Cooling efficiency',         path: 'per_service.cooling.efficiency',    unit: 'ratio',   goodPositive: true },
    { key: 'dhw_del',        label: 'Hot water delivered',       path: 'per_service.dhw.delivered_mwh',     unit: 'MWh',     goodPositive: false },
  ],
  'Fuel consumed': [
    { key: 'total_elec',     label: 'Total electricity',         path: 'per_fuel.electricity_mwh',          unit: 'MWh',     goodPositive: false },
    { key: 'total_gas',      label: 'Total gas',                  path: 'per_fuel.gas_mwh',                  unit: 'MWh',     goodPositive: false },
    { key: 'heat_elec',      label: 'Heating electricity',       path: 'per_service.heating.electricity_mwh', unit: 'MWh',   goodPositive: false },
    { key: 'heat_gas',       label: 'Heating gas',                path: 'per_service.heating.gas_mwh',       unit: 'MWh',     goodPositive: false },
    { key: 'dhw_elec',       label: 'Hot water electricity',     path: 'per_service.dhw.electricity_mwh',   unit: 'MWh',     goodPositive: false },
    { key: 'dhw_gas',        label: 'Hot water gas',              path: 'per_service.dhw.gas_mwh',           unit: 'MWh',     goodPositive: false },
    { key: 'cool_elec',      label: 'Cooling electricity',       path: 'per_service.cooling.electricity_mwh', unit: 'MWh',   goodPositive: false },
  ],
  'Headline': [
    { key: 'eui',            label: 'EUI',                        path: 'eui_kwh_per_m2',                    unit: 'kWh/m²',  goodPositive: false },
    { key: 'carbon',         label: 'Operational carbon',         path: 'carbon_kgco2_per_m2',               unit: 'kgCO₂/m²',goodPositive: false },
  ],
}

function pickDelta(deltaObj, path) {
  if (!deltaObj || typeof path !== 'string') return null
  let cur = deltaObj
  for (const seg of path.split('.')) { if (cur == null) return null; cur = cur[seg] }
  return cur ?? null
}

const r2 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100
const sigDelta = v => v == null ? '—' : (v > 0 ? '+' : '') + r2(v)
const fmtAbs = v => v == null ? '—' : r2(v).toString()

// ── Build the per-intervention audit-trail records ────────────────────
// stackResult.interventions[i] has:
//   - id, label, enabled
//   - marginal_delta  → vs prior cumulative state ("vs step above")
//   - cumulative_delta → vs baseline ("vs original")
const records = []
for (let i = 0; i < stackResult.interventions.length; i++) {
  const intvRow = stackResult.interventions[i]
  const intv = stack[i]
  const rec = {
    index: i,
    id: intv.id,
    label: intv.label,
    enabled: intv.enabled !== false,
    n_patches: (intv.patches ?? []).length,
    sections: {},
  }
  for (const [sectionTitle, rows] of Object.entries(SECTIONS)) {
    const sectionOut = []
    for (const r of rows) {
      const margin = pickDelta(intvRow.marginal_delta, r.path)
      const cum    = pickDelta(intvRow.cumulative_delta, r.path)
      sectionOut.push({
        key: r.key,
        label: r.label,
        unit: r.unit,
        good_when_positive: r.goodPositive,
        path: r.path,
        vs_step_above: margin == null ? null : {
          baseline: margin.from, after: margin.to, delta: margin.delta, delta_pct: margin.delta_pct,
        },
        vs_original: cum == null ? null : {
          baseline: cum.from, after: cum.to, delta: cum.delta, delta_pct: cum.delta_pct,
        },
      })
    }
    rec.sections[sectionTitle] = sectionOut
  }
  records.push(rec)
}

// ── Write JSON ────────────────────────────────────────────────────────
const jsonOut = path.join(REPO_ROOT, `${OUT_STEM}.json`)
fs.mkdirSync(path.dirname(jsonOut), { recursive: true })
fs.writeFileSync(jsonOut, JSON.stringify({
  generated_at: new Date().toISOString(),
  api: API,
  project: { id: PROJECT_ID, name: project.name, comfort_band: comfortBand, gia_m2: stackResult.baseline?.metadata?.gia_m2 ?? stackResult.baseline?.heat_balance?.metadata?.gia_m2 ?? null },
  stack: stackLabels,
  baseline: {
    eui_kwh_per_m2: stackResult.baseline?.energy_use?.totals?.eui_kwh_per_m2 ?? null,
    consumption_total: stackResult.baseline?.consumption?.total ?? null,
  },
  interventions: records,
}, null, 2))

// ── Write Markdown ────────────────────────────────────────────────────
const mdOut = path.join(REPO_ROOT, `${OUT_STEM}.md`)
const lines = []
const baseEui = stackResult.baseline?.energy_use?.totals?.eui_kwh_per_m2
lines.push(`# Breakdown-panel audit-trail dump`)
lines.push('')
lines.push(`Generated: ${new Date().toISOString()}`)
lines.push(`Source backend: \`${API}\`  ·  Project: **${project.name}** (\`${PROJECT_ID}\`)`)
lines.push(`Comfort band: ${comfortBand.lower_c}–${comfortBand.upper_c} °C`)
lines.push(`Baseline EUI: **${baseEui?.toFixed(2)} kWh/m²·yr**`)
lines.push(`Stack order: ${stackLabels.map((l, i) => `${i + 1}. ${l}`).join('  →  ')}`)
lines.push('')

for (const rec of records) {
  const intvRow = stackResult.interventions[rec.index]
  const afterEui = intvRow?.result?.energy_use?.totals?.eui_kwh_per_m2
  const marginEui = pickDelta(intvRow.marginal_delta, 'eui_kwh_per_m2')?.delta
  const cumEui    = pickDelta(intvRow.cumulative_delta, 'eui_kwh_per_m2')?.delta
  lines.push(`## ${rec.index + 1}. ${rec.label}${rec.enabled ? '' : '  (disabled)'}`)
  lines.push('')
  lines.push(`After-stack EUI: **${afterEui?.toFixed(2)} kWh/m²·yr**  ·  marginal Δ EUI: ${sigDelta(marginEui)}  ·  cumulative Δ EUI: ${sigDelta(cumEui)}`)
  lines.push(`Patches: ${rec.n_patches}`)
  lines.push('')
  for (const [sectionTitle, rows] of Object.entries(rec.sections)) {
    lines.push(`### ${sectionTitle}`)
    lines.push('')
    lines.push('| Row | Baseline | After | Δ vs step above | Δ vs original | Unit |')
    lines.push('|---|---:|---:|---:|---:|:---|')
    for (const r of rows) {
      const margin = r.vs_step_above
      const cum    = r.vs_original
      const base   = cum?.baseline ?? margin?.baseline
      const after  = cum?.after    ?? margin?.after
      lines.push(`| ${r.label} | ${fmtAbs(base)} | ${fmtAbs(after)} | ${sigDelta(margin?.delta)} | ${sigDelta(cum?.delta)} | ${r.unit} |`)
    }
    lines.push('')
  }
}
fs.writeFileSync(mdOut, lines.join('\n'))

// ── Console summary ──────────────────────────────────────────────────
console.log()
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log('  Breakdown-panel audit-trail dump')
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log(`  Backend:    ${API}`)
console.log(`  Project:    ${project.name} (${PROJECT_ID})`)
console.log(`  Baseline:   EUI ${baseEui?.toFixed(2)} kWh/m²·yr`)
console.log(`  Stack:      ${stackLabels.join('  →  ')}`)
console.log()
for (const rec of records) {
  const intvRow = stackResult.interventions[rec.index]
  const afterEui = intvRow?.result?.energy_use?.totals?.eui_kwh_per_m2
  const cumEui   = pickDelta(intvRow.cumulative_delta, 'eui_kwh_per_m2')?.delta
  const margEui  = pickDelta(intvRow.marginal_delta, 'eui_kwh_per_m2')?.delta
  console.log(`  ${rec.index + 1}. ${rec.label}`)
  console.log(`     After-stack EUI: ${afterEui?.toFixed(2)}  ·  marginal Δ: ${sigDelta(margEui)}  ·  cumulative Δ: ${sigDelta(cumEui)}`)
}
console.log()
console.log(`  Markdown: ${path.relative(REPO_ROOT, mdOut)}`)
console.log(`  JSON:     ${path.relative(REPO_ROOT, jsonOut)}`)
console.log()
