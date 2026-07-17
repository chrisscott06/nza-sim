// Final-P02 Part 6 — results generator. Runs each costed measure isolated vs
// pinned Model 2, computes energy + lifetime carbon + all-in cost metrics, and
// emits the print-ready report-4.8 markdown table + the results doc.
// Reproducible: node scripts/_final_p02_results.mjs
import fs from 'node:fs'
const R = 'file:///C:/Users/ChrisScott/Dev/nza-sim/frontend/src'
const { calculateInstant } = await import(`${R}/utils/instantCalc.js`)
const { computeHourlySolarByFacade } = await import(`${R}/utils/solarCalc.js`)
const { SYSTEM_TEMPLATES_LIBRARY } = await import(`${R}/data/systemTemplatesLibrary.js`)
const { runInterventionStack } = await import(`${R}/utils/interventionsEngine.js`)
const { computeLifetimeCarbon, perFuelFromDeltaRecord, defaultLifetimeYears } = await import(`${R}/utils/lifetimeCarbon.js`)
const { computeAnnualOperationalSaving, computeSimplePayback, computePoundsPerTonne, computeLifecycleCapex } = await import(`${R}/utils/costModel.js`)

const fx = JSON.parse(fs.readFileSync('docs/audit/fixtures/final_p02_model2_costed.json', 'utf-8'))
const b0 = fx.building_config
const GIA = 4215
const tariffs = fx.cost_plan.tariffs
const epw = fs.readFileSync(`data/weather/current/${b0.weather_file}`, 'utf-8').split(/\r?\n/)
const lat = parseFloat(epw[0].split(',')[6]); const dl = epw.slice(8).filter(l => l.trim()); const N = dl.length
const w = { temperature: new Float32Array(N), direct_normal: new Float32Array(N), diffuse_horizontal: new Float32Array(N), wind_speed: new Float32Array(N), month: new Int8Array(N), day: new Int8Array(N), hour: new Int8Array(N) }
for (let i = 0; i < N; i++) { const p = dl[i].split(','); w.month[i] = +p[1]; w.day[i] = +p[2]; w.hour[i] = +p[3]; w.temperature[i] = +p[6]; w.direct_normal[i] = +p[14]; w.diffuse_horizontal[i] = +p[15]; w.wind_speed[i] = +p[21] }
const hs = computeHourlySolarByFacade(w, lat, b0.orientation ?? 0)
const libraryData = { constructions: fx.library_constructions.map(c => ({ name: c.name, u_value_W_per_m2K: c.u_value_W_per_m2K, y_factor: c.y_factor ?? 1, g_value: c.g_value, config_json: c.config_json, layers: c.layers })), system_templates: SYSTEM_TEMPLATES_LIBRARY, library_systems: b0.library_systems ?? [], library_schedules: b0.library_schedules ?? [] }
const runEngine = (cfg) => calculateInstant(cfg.building, cfg.constructions, cfg.systems ?? {}, libraryData, w, hs, null, { mode: 'full', comfortBand: fx.comfort_band, engine: 'v2.5', _skipInterventions: true })
const baselineConfig = { building: b0, constructions: fx.construction_choices, systems: {}, libraryData }

// Report-order themes + display labels + flags
const THEME_ORDER = ['Hot water', 'Ventilation', 'Heating & cooling', 'Room loads', 'Communal']
const FLAG = {
  int_hiex_1_2: 'WWHR — at-refurb basis; flagged OUT of the immediate investment stack (specification policy).',
  int_hiex_2_1a: 'MVHR full flow — conditional on bypass + SFP ≤1.2 (verified against retained ductwork) + full design flow. Mutually exclusive with fan duty.',
  int_hiex_2_1b: 'MVHR reduced flow — sensitivity; full flow wins once fans are cheap. Mutually exclusive with fan duty.',
  int_hiex_2_2: 'Fan duty — mutually exclusive with MVHR (acts on the system MVHR replaces).',
  int_hiex_1_4: 'Larger ASHP — DHW 100% ASHP annually (gas calorifiers retained as peak/backup, no annual load in this representation). Running-cost rises with electrification; see Appendix A.',
  int_hiex_4_2: 'Keycard — capex under review pending room-wiring survey. −4.5 is a normal-trading benchmark; optimistic under Home Office occupancy.',
}
const rows = []
for (const iv of fx.interventions.filter(i => i.cost_category && (i.patches || []).length > 0)) {
  const iso = runInterventionStack(baselineConfig, [{ ...iv, enabled: true }], runEngine, libraryData)
  const d = iso.interventions[0].cumulative_delta
  const euiDelta = d.eui_kwh_per_m2?.delta
  const perFuel = perFuelFromDeltaRecord(d.per_fuel)
  const lifetimeYears = iv.lifetime_years ?? defaultLifetimeYears(iv.theme)
  const lifetime = computeLifetimeCarbon(perFuel, { lifetimeYears })
  const lifeTco2e = lifetime?.lifetime_carbon_saved_tco2e
  const annualSaving = computeAnnualOperationalSaving(d.per_fuel, tariffs)
  const allIn = iv.all_in_capex_gbp
  const lifecycle = computeLifecycleCapex(allIn, iv.measure_life_years)
  const gpt = computePoundsPerTonne(lifecycle, lifeTco2e)
  const payback = allIn > 0 ? computeSimplePayback(allIn, annualSaving) : (allIn === 0 ? 0 : null)
  const theme = THEME_ORDER.find(t => t.toLowerCase() === (iv.theme || '').toLowerCase()) ?? iv.theme
  rows.push({ id: iv.id, theme, label: iv.label, euiDelta, lifeTco2e, gpt, payback, allIn, cat: iv.cost_category, mult: iv.cost_multiplier, annualSaving, lifecycle })
}

const gbp = n => n == null ? '—' : '£' + Math.round(n).toLocaleString('en-GB')
const yrs = p => p == null ? 'no payback' : p === 0 ? 'n/a (£0)' : p >= 999 ? '>100' : p.toFixed(1)
const themeKey = t => THEME_ORDER.findIndex(x => x.toLowerCase() === (t || '').toLowerCase())
rows.sort((a, b) => (themeKey(a.theme) - themeKey(b.theme)) || 0)

let md = '| Theme | Intervention | EUI Δ (kWh/m²) | Lifetime tCO₂e | £/tCO₂e (all-in) | Payback (all-in) | Capex (all-in) |\n'
md += '|---|---|---:|---:|---:|---:|---:|\n'
let lastTheme = null
for (const r of rows) {
  const theme = r.theme === lastTheme ? '' : r.theme; lastTheme = r.theme
  const flag = FLAG[r.id] ? ' ¹' : ''
  // £0-capex measures deliver carbon for free → £0/tonne, immediate payback.
  const gptCell = r.allIn === 0 && r.lifeTco2e > 0 ? '£0' : (r.gpt != null ? gbp(r.gpt) : '—')
  md += `| ${theme} | ${r.label}${flag} | ${r.euiDelta.toFixed(1)} | ${r.lifeTco2e != null ? r.lifeTco2e.toFixed(0) : '—'} | ${gptCell} | ${yrs(r.payback)} | ${gbp(r.allIn)} |\n`
}
console.log(md)
console.log('\n--- flags ---')
for (const r of rows) if (FLAG[r.id]) console.log(`¹ ${r.label}: ${FLAG[r.id]}`)
console.log('\n--- diagnostics (id | cat ×mult | annual£saved | lifecycleCapex | lifeTco2e) ---')
for (const r of rows) console.log(`${r.id.padEnd(27)} | ${r.cat.padEnd(10)} ×${r.mult} | £${Math.round(r.annualSaving)} | £${Math.round(r.lifecycle)} | ${r.lifeTco2e?.toFixed(1)}`)

// persist rows JSON for the doc writer / audit
fs.writeFileSync('docs/audit/fixtures/final_p02_48_rows.json', JSON.stringify(rows, null, 1))
