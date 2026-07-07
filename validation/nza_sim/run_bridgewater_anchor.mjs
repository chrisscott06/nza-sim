/**
 * run_bridgewater_anchor.mjs — Brief 81 P3 falsifiability check.
 *
 * Loads validation/fixtures/bridgewater_v1.yaml (the FROZEN project-dump fixture
 * produced by export_bridgewater_fixture.py) and runs NZA-Sim's JS engine
 * PURE-NODE (State 3 / v2.5 — no live DB; divergence D4). It then compares the
 * headline metrics against the Brief 77 live anchor and asserts agreement within
 * ±1% across every headline metric.
 *
 * This is the P3 falsifiability test the brief demands: "Hand-load the YAML …
 * Run the engine. Compare to Brief 77 anchor … Must agree within ±1% across all
 * headline metrics." If the fixture is a faithful freeze, the pure-Node run
 * reproduces the live numbers; any drift means the freeze lost information.
 *
 * Why this does NOT use load_fixture.mjs::loadAndRun:
 *   That loader is BOX-SCHEMA-specific (kind: hand_authored). Bridgewater v1 is
 *   kind: project_dump — building_config is the live engine `building` param
 *   verbatim, so we map it 1:1 here, exactly as scripts/_brief75_p1_anchor.mjs
 *   maps the live /api/projects + /api/library/constructions responses.
 *
 * Run:
 *   cd C:\Users\ChrisScott\Dev\nza-sim
 *   node validation/nza_sim/run_bridgewater_anchor.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../../frontend/src/data/systemTemplatesLibrary.js'
import { loadFixtureYaml, REPO_ROOT } from './load_fixture.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(REPO_ROOT, 'validation', 'fixtures', 'bridgewater_v1.yaml')
const OUT_DIR = path.join(__dirname, 'results')
const OUT_FILE = path.join(OUT_DIR, 'bridgewater_v1.json')

const round = (x, dp = 3) =>
  x == null || Number.isNaN(Number(x)) ? null : Math.round(Number(x) * 10 ** dp) / 10 ** dp

// ── Brief 77 live anchor (the freeze target) ────────────────────────────────
// Source of truth: docs/audit/77_p1_anchor_before.json — the committed live
// capture of HIX Bridgewater at the post-Brief-77, most-defensible state
// (identical to 76_p4_anchor_after.json: Brief 77 was a per-system vent
// RENDERING change, not a physics change, so engine outputs are unchanged).
// Values are taken verbatim from that file (kWh → MWh, 2 dp). P3
// falsifiability: the pure-Node fixture run must match these within ±1% or the
// YAML freeze lost information.
//   losses_kwh        522556.3  → 522.56 MWh
//   gains_kwh         488011.1  → 488.01 MWh
//   net_residual_kwh  -34545.2  → -34.55 MWh
//   mech_ventilation  326175.5  → 326.18 MWh
//   dhw_demand 263.183 · vent_fan 41.962 · elec 387.221 · gas 204.698
// Carbon is NOT in the committed anchor, so it has no authoritative target and
// is reported (in `headline`) for information only — never pass/fail-tested.
const BRIEF77_ANCHOR = {
  eui_kwh_per_m2_yr:  { value: 143.5,  unit: 'kWh/m²·yr' },
  heating_demand_mwh: { value: 98.3,   unit: 'MWh' },
  cooling_demand_mwh: { value: 53.1,   unit: 'MWh' },
  dhw_demand_mwh:     { value: 263.18, unit: 'MWh' },
  vent_fan_mwh:       { value: 41.96,  unit: 'MWh' },
  electricity_mwh:    { value: 387.22, unit: 'MWh' },
  gas_mwh:            { value: 204.70, unit: 'MWh' },
  sum_losses_mwh:     { value: 522.56, unit: 'MWh' },
  sum_gains_mwh:      { value: 488.01, unit: 'MWh' },
  net_residual_mwh:   { value: -34.55, unit: 'MWh' },
  mech_vent_loss_mwh: { value: 326.18, unit: 'MWh' },
}
const TOL_PCT = 1.0  // ±1% per the brief

// ── Load fixture + map to engine inputs (1:1 with the live path) ─────────────
const fixture = loadFixtureYaml(FIXTURE)
const building = fixture.building_config                       // verbatim engine `building`
const constructions = fixture.construction_choices            // verbatim `constructions`
const comfortBand = {
  lower_c: fixture?.project?.comfort_band?.lower_c ?? 21,
  upper_c: fixture?.project?.comfort_band?.upper_c ?? 24,
}

// EPW → weatherData typed arrays (identical to _brief75_p1_anchor.mjs).
const epwName = fixture?.weather?.epw_file ?? building?.weather_file
const epwPath = path.join(REPO_ROOT, 'data', 'weather', 'current', epwName)
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

// library.constructions → libraryData.constructions, SAME mapping as the live
// anchor probe (scripts/_brief75_p1_anchor.mjs). Fixture items are already in
// the /api/library/constructions list shape (flattened fields + derived
// layers, no nested config_json), so config_json?.x ?? x resolves to x and
// config_json ?? c resolves to c.
const libArr = fixture?.library?.constructions ?? []
const libraryData = {
  constructions: libArr.map(c => ({
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    g_value: c.config_json?.g_value ?? c.g_value,
    config_json: c.config_json ?? c,
    layers: c.layers,
  })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
  library_systems: building?.library_systems ?? [],
  library_schedules: building?.library_schedules ?? [],
}

const result = calculateInstant(
  building, constructions, {}, libraryData,
  weatherData, hourlySolar, null,
  { comfortBand, _skipInterventions: true, engine: 'v2.5' },
)

const c = result?.consumption ?? {}
const hb = result?.heat_balance ?? {}
const ig = hb?.annual?.gains?.internal ?? {}
const ll = hb?.annual?.losses ?? {}
const lg = hb?.annual?.gains ?? {}
const totals = hb?.annual?.totals ?? {}

const lkwh = k => round(ll?.[k]?.kwh)
const skwh = d => round(lg?.solar?.[d]?.kwh)
const ikwh = k => round(ig?.[k]?.kwh)

const lossesKwh = totals?.losses_kwh ?? null
const gainsKwh = totals?.gains_kwh ?? null
const mechVentLossKwh = ll?.mech_ventilation?.kwh ?? null

// ── Headline (the metrics under ±1% test) ────────────────────────────────────
const headline = {
  eui_kwh_per_m2_yr:    round(c?.total?.kwh_per_m2_yr, 2),
  heating_demand_mwh:   round(c?.space_heating?.demand_mwh, 2),
  cooling_demand_mwh:   round(c?.space_cooling?.demand_mwh, 2),
  dhw_demand_mwh:       round(c?.dhw?.demand_mwh, 2),
  vent_fan_mwh:         round(c?.brief40?.ventilation?.total_fan_electrical_mwh, 2),
  electricity_mwh:      round(c?.total?.electricity_mwh, 2),
  gas_mwh:              round(c?.total?.gas_mwh, 2),
  sum_losses_mwh:       round(lossesKwh != null ? lossesKwh / 1000 : null, 2),
  sum_gains_mwh:        round(gainsKwh != null ? gainsKwh / 1000 : null, 2),
  net_residual_mwh:     round(gainsKwh != null && lossesKwh != null ? (gainsKwh - lossesKwh) / 1000 : null, 2),
  mech_vent_loss_mwh:   round(mechVentLossKwh != null ? mechVentLossKwh / 1000 : null, 2),
  carbon_kg_co2_per_m2: round(result?.carbon_kg_co2_per_m2, 2),
}

// ── ±1% comparison vs Brief 77 anchor ────────────────────────────────────────
const comparison = {}
let allPass = true
for (const [k, target] of Object.entries(BRIEF77_ANCHOR)) {
  const actual = headline[k]
  const tgt = target.value
  // Net residual is a signed near-zero quantity; a 1% relative tolerance on a
  // ~37 MWh value (≈0.37 MWh) is meaningful and reported the same way.
  const deltaPct = (actual != null && tgt) ? round((actual - tgt) / Math.abs(tgt) * 100, 3) : null
  const pass = deltaPct != null && Math.abs(deltaPct) <= TOL_PCT
  if (!pass) allPass = false
  comparison[k] = {
    brief77: tgt,
    fixture_run: actual,
    delta_pct: deltaPct,
    pass,
    unit: target.unit,
  }
}

const anchor = {
  brief: 'Brief 81 P3 — Bridgewater v1 frozen-anchor falsifiability',
  source: 'node validation/nza_sim/run_bridgewater_anchor.mjs',
  fixture: fixture?.meta?.fixture_id ?? 'bridgewater_v1',
  fixture_schema_version: fixture?.meta?.schema_version ?? null,
  fixture_captured_at: fixture?.meta?.captured_at ?? null,
  source_project_id: fixture?.meta?.source_project_id ?? null,
  captured_at: new Date().toISOString(),

  engine_dispatch: {
    state_numeric: result?.state ?? null,
    mode: result?.mode ?? null,
    note: 'state=3 → _calculateState3 ran (systems overlay applied), as forced by engine:v2.5',
  },

  geometry: {
    gia_m2: round(hb?.metadata?.gia_m2, 1),
    reported_gia_m2: building?.reported_gia ?? null,
    weather_file: epwName,
    latitude,
    comfort_band_c: comfortBand,
  },

  // ── FALSIFIABILITY VERDICT (the P3 deliverable) ──────────────────────────
  falsifiability: {
    tolerance_pct: TOL_PCT,
    target: 'Brief 77 live anchor (post-Brief-77, most-defensible state)',
    all_within_tolerance: allPass,
    comparison,
  },

  headline,

  totals: {
    eui_kwh_per_m2_yr: round(c?.total?.kwh_per_m2_yr, 2),
    electricity_mwh: round(c?.total?.electricity_mwh, 2),
    gas_mwh: round(c?.total?.gas_mwh, 2),
    district_heat_mwh: round(c?.total?.district_heat_mwh, 2),
  },

  per_service: {
    heating: {
      demand_mwh: round(c?.space_heating?.demand_mwh, 2),
      delivered_mwh: round(c?.space_heating?.delivered_mwh, 2),
      recovery_offset_mwh: round(c?.space_heating?.recovery_offset_mwh, 2),
    },
    cooling: {
      demand_mwh: round(c?.space_cooling?.demand_mwh, 2),
      delivered_mwh: round(c?.space_cooling?.delivered_mwh, 2),
    },
    dhw: {
      demand_mwh: round(c?.dhw?.demand_mwh, 2),
      delivered_mwh: round(c?.dhw?.delivered_mwh, 2),
      electricity_mwh: round(c?.dhw?.electricity_mwh, 2),
      gas_mwh: round(c?.dhw?.gas_mwh, 2),
    },
    ventilation: {
      total_fan_electrical_mwh: round(c?.brief40?.ventilation?.total_fan_electrical_mwh, 2),
      systems: (c?.brief40?.ventilation?.systems ?? []).map(s => ({
        id: s.id,
        label: s.label,
        fan_electrical_mwh: round(s.fan_electrical_mwh, 3),
        sfp_w_per_lps: s.sfp_w_per_lps,
        flow_rate: s.flow_rate,
        flow_rate_basis: s.flow_rate_basis,
        recovery_sensible_pct: s.recovery_sensible_pct,
        summer_bypass: s.summer_bypass,
      })),
    },
  },

  heat_balance_annual: {
    losses_kwh: round(lossesKwh, 1),
    losses_kwh_per_m2: round(totals?.losses_kwh_per_m2, 2),
    gains_kwh: round(gainsKwh, 1),
    gains_kwh_per_m2: round(totals?.gains_kwh_per_m2, 2),
    losses_per_element: {
      external_wall: lkwh('external_wall'),
      roof: lkwh('roof'),
      ground_floor: lkwh('ground_floor'),
      glazing: lkwh('glazing'),
      thermal_bridging: lkwh('thermal_bridging'),
      fabric_leakage: lkwh('fabric_leakage'),
      permanent_vents: lkwh('permanent_vents'),
      mech_ventilation: lkwh('mech_ventilation'),
      all_loss_keys: Object.keys(ll ?? {}),
    },
    gains_per_element: {
      solar_north: skwh('north'),
      solar_south: skwh('south'),
      solar_east: skwh('east'),
      solar_west: skwh('west'),
      solar_total: round(lg?.solar?.total_kwh, 1),
      people: ikwh('people'),
      lighting: ikwh('lighting'),
      equipment: ikwh('equipment'),
      auxiliary: ikwh('auxiliary'),
      all_internal_keys: Object.keys(ig ?? {}),
    },
  },

  _result_keys: Object.keys(result ?? {}),
  _consumption_keys: Object.keys(c ?? {}),
}

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_FILE, JSON.stringify(anchor, null, 2) + '\n', 'utf-8')

// ── Human-readable summary ───────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n)
const padL = (s, n) => String(s).padStart(n)
console.log('═══════════════════════════════════════════════════════════════════════')
console.log(' Bridgewater v1 frozen-anchor falsifiability (Brief 81 P3)')
console.log('═══════════════════════════════════════════════════════════════════════')
console.log(` engine state : ${anchor.engine_dispatch.state_numeric}   GIA: ${anchor.geometry.gia_m2} m²   comfort: ${comfortBand.lower_c}–${comfortBand.upper_c} °C`)
console.log(` weather      : ${epwName}`)
console.log('───────────────────────────────────────────────────────────────────────')
console.log(` ${pad('metric', 24)}${padL('Brief77', 11)}${padL('fixture', 11)}${padL('Δ%', 9)}  verdict`)
console.log('───────────────────────────────────────────────────────────────────────')
for (const [k, v] of Object.entries(comparison)) {
  console.log(` ${pad(k, 24)}${padL(v.brief77, 11)}${padL(v.fixture_run, 11)}${padL(v.delta_pct, 9)}  ${v.pass ? 'PASS' : 'FAIL ✗'}`)
}
console.log('───────────────────────────────────────────────────────────────────────')
console.log(` VERDICT: ${allPass ? 'PASS — all headline metrics within ±1% of Brief 77 anchor' : 'FAIL — at least one metric exceeds ±1%'}`)
console.log('═══════════════════════════════════════════════════════════════════════')
console.log(`\nwrote ${path.relative(REPO_ROOT, OUT_FILE)}`)

if (!allPass) process.exitCode = 1
