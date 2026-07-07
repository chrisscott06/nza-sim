/**
 * run_box_anchor.mjs — Brief 81 P2 NZA-Sim Bridgewater-Box anchor capture.
 *
 * Loads validation/fixtures/bridgewater_box_v1.yaml via load_fixture.mjs,
 * runs NZA-Sim's JS engine pure-Node (State 3 / v2.5 — no live DB), and writes
 * the anchor to validation/nza_sim/results/bridgewater_box_v1.json.
 *
 * The anchor is the Phase-4 comparison target for EnergyPlus. Per the brief it
 * captures: EUI, heating demand, cooling demand, mech-vent loss, Σ losses,
 * Σ gains, Net residual. We also capture per-element losses/gains + per-service
 * delivered/source energy + fuel split so the P9 comparison has full breakdown.
 *
 * NOTE (P8): the canonical P9 comparison input is now produced by extract.mjs in
 * the EnergyPlus-parallel schema → results/bridgewater_box_v1.json. This P2 script
 * is retained for its richer human-readable breakdown and writes to a distinct
 * file (results/bridgewater_box_v1.anchor.json) so the two never collide.
 *
 * Run:
 *   cd C:\Users\ChrisScott\Dev\nza-sim
 *   node validation/nza_sim/run_box_anchor.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAndRun, REPO_ROOT } from './load_fixture.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(REPO_ROOT, 'validation', 'fixtures', 'bridgewater_box_v1.yaml')
const OUT_DIR = path.join(__dirname, 'results')
const OUT_FILE = path.join(OUT_DIR, 'bridgewater_box_v1.anchor.json')

const round = (x, dp = 3) =>
  x == null || Number.isNaN(Number(x)) ? null : Math.round(Number(x) * 10 ** dp) / 10 ** dp

const { fixture, result } = loadAndRun(FIXTURE, REPO_ROOT)

const c = result?.consumption ?? {}
const hb = result?.heat_balance ?? {}
const ig = hb?.annual?.gains?.internal ?? {}
const ll = hb?.annual?.losses ?? {}
const lg = hb?.annual?.gains ?? {}
const totals = hb?.annual?.totals ?? {}

// Per-element losses/gains are objects { kwh, kwh_per_m2, ... }; read .kwh.
const lkwh = k => round(ll?.[k]?.kwh)
const skwh = d => round(lg?.solar?.[d]?.kwh)
const ikwh = k => round(ig?.[k]?.kwh)

const lossesKwh = totals?.losses_kwh ?? null
const gainsKwh = totals?.gains_kwh ?? null
const mechVentLossKwh = ll?.mech_ventilation?.kwh ?? null
const heatDeliveredMwh = c?.space_heating?.delivered_mwh ?? null
const coolDeliveredMwh = c?.space_cooling?.delivered_mwh ?? null

// Heat-balance closure: losses should be met by gains + net system delivery
// (heating − cooling) ± thermal-mass storage swing. The non-zero remainder is
// absorbed by storage + the 21–24 °C free-float deadband (dynamic model).
const closureResidualKwh =
  lossesKwh != null && gainsKwh != null && heatDeliveredMwh != null && coolDeliveredMwh != null
    ? round(lossesKwh - (gainsKwh + heatDeliveredMwh * 1000 - coolDeliveredMwh * 1000))
    : null

const sumElementLosses = round(
  ['external_wall', 'roof', 'ground_floor', 'glazing', 'thermal_bridging',
    'fabric_leakage', 'permanent_vents', 'mech_ventilation']
    .reduce((a, k) => a + (ll?.[k]?.kwh ?? 0), 0))
const sumSolar = round(['north', 'south', 'east', 'west']
  .reduce((a, d) => a + (lg?.solar?.[d]?.kwh ?? 0), 0))
const sumInternal = round(['people', 'lighting', 'equipment', 'auxiliary']
  .reduce((a, k) => a + (ig?.[k]?.kwh ?? 0), 0))

const anchor = {
  brief: 'Brief 81 P2 — Bridgewater-Box NZA-Sim anchor',
  source: 'node validation/nza_sim/run_box_anchor.mjs',
  fixture: fixture?.meta?.fixture_id ?? 'bridgewater_box_v1',
  fixture_schema_version: fixture?.meta?.schema_version ?? null,
  captured_at: new Date().toISOString(),

  engine_dispatch: {
    state_numeric: result?.state ?? null,
    mode: result?.mode ?? null,
    note: 'state=3 → _calculateState3 ran (systems overlay applied), as forced by engine:v2.5',
  },

  geometry: {
    gia_m2: hb?.metadata?.gia_m2 ?? null,
    reported_gia_m2: fixture?.geometry?.gia_m2 ?? null,
    volume_m3: fixture?.geometry?.volume_m3 ?? null,
    weather_file: fixture?.weather?.epw_file ?? null,
    comfort_band_c: { lower_c: fixture?.comfort_band?.lower_c, upper_c: fixture?.comfort_band?.upper_c },
  },

  // ── HEADLINE ANCHOR (the Phase-4 comparison target) ──────────────────────
  headline: {
    eui_kwh_per_m2_yr: round(c?.total?.kwh_per_m2_yr, 2),
    heating_demand_mwh: round(c?.space_heating?.demand_mwh),
    cooling_demand_mwh: round(c?.space_cooling?.demand_mwh),
    dhw_demand_mwh: round(c?.dhw?.demand_mwh),
    mech_vent_loss_kwh: round(mechVentLossKwh),
    sum_losses_kwh: round(lossesKwh),
    sum_gains_kwh: round(gainsKwh),
    // Two residual conventions, both reported to avoid ambiguity in P9:
    net_residual_gains_minus_losses_kwh:
      lossesKwh != null && gainsKwh != null ? round(gainsKwh - lossesKwh) : null,
    balance_closure_residual_kwh: closureResidualKwh,
  },

  // ── FUEL / DELIVERED-ENERGY TOTALS ───────────────────────────────────────
  totals: {
    eui_kwh_per_m2_yr: round(c?.total?.kwh_per_m2_yr, 2),
    electricity_mwh: round(c?.total?.electricity_mwh),
    gas_mwh: round(c?.total?.gas_mwh),
    district_heat_mwh: round(c?.total?.district_heat_mwh),
  },

  per_service: {
    heating: {
      demand_mwh: round(c?.space_heating?.demand_mwh),
      delivered_mwh: round(c?.space_heating?.delivered_mwh),
      fuel: c?.space_heating?.primary?.fuel ?? null,
      fuel_mwh: round(c?.space_heating?.primary?.fuel_mwh ?? c?.space_heating?.gas_mwh),
      efficiency: c?.space_heating?.primary?.efficiency ?? null,
      // MVHR recovery offsets demand before the boiler sees it (Brief 75 P5).
      recovery_offset_mwh: round(c?.space_heating?.recovery_offset_mwh),
    },
    cooling: {
      demand_mwh: round(c?.space_cooling?.demand_mwh),
      delivered_mwh: round(c?.space_cooling?.delivered_mwh),
      fuel: c?.space_cooling?.primary?.fuel ?? null,
      fuel_mwh: round(c?.space_cooling?.primary?.fuel_mwh ?? c?.space_cooling?.electricity_mwh),
      efficiency: c?.space_cooling?.primary?.efficiency ?? null,
    },
    dhw: {
      demand_mwh: round(c?.dhw?.demand_mwh),
      delivered_mwh: round(c?.dhw?.delivered_mwh),
      fuel_mwh: round(c?.dhw?.gas_mwh || c?.dhw?.electricity_mwh),
      electricity_mwh: round(c?.dhw?.electricity_mwh),
      gas_mwh: round(c?.dhw?.gas_mwh),
    },
    ventilation: {
      total_fan_electrical_mwh: round(c?.brief40?.ventilation?.total_fan_electrical_mwh),
      systems: (c?.brief40?.ventilation?.systems ?? []).map(s => ({
        id: s.id,
        label: s.label,
        fan_electrical_mwh: round(s.fan_electrical_mwh),
        sfp_w_per_lps: s.sfp_w_per_lps,
        flow_rate: s.flow_rate,
        flow_rate_basis: s.flow_rate_basis,
        recovery_sensible_pct: s.recovery_sensible_pct,
        summer_bypass: s.summer_bypass,
      })),
    },
  },

  // ── HEAT-BALANCE BREAKDOWN ───────────────────────────────────────────────
  heat_balance_annual: {
    losses_kwh: round(lossesKwh),
    losses_kwh_per_m2: round(totals?.losses_kwh_per_m2, 2),
    gains_kwh: round(gainsKwh),
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
      _sum_check_kwh: sumElementLosses,
      all_loss_keys: Object.keys(ll ?? {}),
    },
    gains_per_element: {
      solar_north: skwh('north'),
      solar_south: skwh('south'),
      solar_east: skwh('east'),
      solar_west: skwh('west'),
      solar_total: round(lg?.solar?.total_kwh ?? sumSolar),
      people: ikwh('people'),
      lighting: ikwh('lighting'),
      equipment: ikwh('equipment'),
      auxiliary: ikwh('auxiliary'),
      internal_total: sumInternal,
      _sum_check_kwh: round((sumSolar ?? 0) + (sumInternal ?? 0)),
      all_internal_keys: Object.keys(ig ?? {}),
      all_gain_keys: Object.keys(lg ?? {}),
    },
  },

  // ── FIRST-PRINCIPLES RECONCILIATION (self-documents anchor validity) ─────
  reconciliation: {
    // hand-calc targets, computed independently of the engine
    expected: {
      lighting_mwh: round(5 * 100 * 14 * 365 / 1e6),          // 5 W/m²·14h·365d
      equipment_mwh: round((3 * 24 + 2 * 14) * 100 * 365 / 1e6), // 3 base 24h + 2 active 14h
      fan_mwh: round(1.5 * 50 * 8760 / 1e6),                  // SFP·flow·hours
      cooling_elec_mwh: round((c?.space_cooling?.demand_mwh ?? 0) / 3.0),
      people_kwh: round(2.8 * 75 * 14 * 365 / 1000),          // 2.8 ppl·75W·14h·365d
      dhw_demand_mwh: round(2.8 * 80 * 50 * (4.18 / 3600) * 365 / 1000), // 224 L/d·50K
      gas_mwh: round(((c?.space_heating?.demand_mwh ?? 0) / 0.9) + ((c?.dhw?.demand_mwh ?? 0) / 0.8)),
    },
    element_loss_sum_vs_total_kwh: { sum: sumElementLosses, total: round(lossesKwh) },
    gain_sum_vs_total_kwh: { sum: round((sumSolar ?? 0) + (sumInternal ?? 0)), total: round(gainsKwh) },
  },

  // Top-level result keys, for first-run structure verification.
  _result_keys: Object.keys(result ?? {}),
  _consumption_keys: Object.keys(c ?? {}),
  _totals_keys: Object.keys(totals ?? {}),
}

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_FILE, JSON.stringify(anchor, null, 2) + '\n', 'utf-8')

// Human-readable summary to stdout.
const h = anchor.headline
console.log('═══════════════════════════════════════════════════════════════')
console.log(' Bridgewater-Box NZA-Sim anchor (Brief 81 P2)')
console.log('═══════════════════════════════════════════════════════════════')
console.log(` engine state         : ${anchor.engine_dispatch.state_numeric}`)
console.log(` GIA                  : ${anchor.geometry.gia_m2} m²`)
console.log(` comfort band         : ${anchor.geometry.comfort_band_c.lower_c}–${anchor.geometry.comfort_band_c.upper_c} °C`)
console.log('───────────────────────────────────────────────────────────────')
console.log(` EUI                  : ${h.eui_kwh_per_m2_yr} kWh/m²·yr`)
console.log(` heating demand       : ${h.heating_demand_mwh} MWh`)
console.log(` cooling demand       : ${h.cooling_demand_mwh} MWh`)
console.log(` DHW demand           : ${h.dhw_demand_mwh} MWh`)
console.log(` mech-vent loss       : ${h.mech_vent_loss_kwh} kWh`)
console.log(` Σ losses             : ${h.sum_losses_kwh} kWh`)
console.log(` Σ gains              : ${h.sum_gains_kwh} kWh`)
console.log(` net (gains−losses)   : ${h.net_residual_gains_minus_losses_kwh} kWh`)
console.log(` balance closure res. : ${h.balance_closure_residual_kwh} kWh (absorbed by storage + deadband)`)
console.log('───────────────────────────────────────────────────────────────')
console.log(` electricity          : ${anchor.totals.electricity_mwh} MWh`)
console.log(` gas                  : ${anchor.totals.gas_mwh} MWh`)
console.log('───────────────────────────────────────────────────────────────')
console.log(` loss keys            : ${anchor.heat_balance_annual.losses_per_element.all_loss_keys.join(', ')}`)
console.log(` internal-gain keys   : ${anchor.heat_balance_annual.gains_per_element.all_internal_keys.join(', ')}`)
console.log(` consumption keys     : ${anchor._consumption_keys.join(', ')}`)
console.log('═══════════════════════════════════════════════════════════════')
console.log(`\nwrote ${path.relative(REPO_ROOT, OUT_FILE)}`)
