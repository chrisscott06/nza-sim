/**
 * extract.mjs — Brief 81 P8 NZA-Sim result extractor (EnergyPlus-parallel schema).
 *
 * Runs NZA-Sim's JS engine pure-Node (State 3 / v2.5 — no live DB) via
 * load_fixture.mjs and emits validation/nza_sim/results/bridgewater_box_v1.json
 * in the SAME normalised schema as the P7 EnergyPlus reference
 * (validation/energyplus/results/bridgewater_box_v1.json), so the P9 comparison
 * (validation/compare.py) can diff the two files field-by-field.
 *
 * Design rule (per brief): extract NZA-Sim's NATIVE outputs only. Where NZA-Sim
 * has no analogue for an EnergyPlus field (per-facade wall conduction, the
 * OA / heat-recovery demand split) the field is null with an explanatory note.
 * Nothing is fabricated or fudged to match EnergyPlus.
 *
 * Units: NZA-Sim reports kWh internally; this extract expresses energy in MWh
 * to parallel P7. Fabric losses are NZA-Sim positive magnitudes (EnergyPlus
 * reports them negative); P9 compares |x|. See per-block _note fields.
 *
 * This supersedes run_box_anchor.mjs as the producer of
 * results/bridgewater_box_v1.json — the anchor script now writes
 * results/bridgewater_box_v1.anchor.json (richer human-readable breakdown).
 *
 * Brief 82 P2 (additive, opt-in): pass --hourly-temps to ALSO write an 8760-row
 * hourly trace CSV (validation/nza_sim/results/bridgewater_box_v1_hourly_temps.csv)
 * with the same schema as the EnergyPlus side (validation/energyplus/
 * extract_hourly_temps.py). The default invocation (no flag) is unchanged — it
 * still writes only the P8 comparison JSON. The hourly zone-air trace already
 * exists on the standard result payload (result.demand.hourly_zone_air_c, set in
 * instantCalc.js State 2 at L3282) — NO engine code change is needed.
 *
 * Run:
 *   cd C:\Users\ChrisScott\Dev\nza-sim
 *   node validation/nza_sim/extract.mjs                 # P8 JSON only (unchanged)
 *   node validation/nza_sim/extract.mjs --hourly-temps  # also write P2 hourly CSV
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAndRun, REPO_ROOT } from './load_fixture.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(REPO_ROOT, 'validation', 'fixtures', 'bridgewater_box_v1.yaml')
const OUT_DIR = path.join(__dirname, 'results')
const OUT_FILE = path.join(OUT_DIR, 'bridgewater_box_v1.json')
const HOURLY_OUT_FILE = path.join(OUT_DIR, 'bridgewater_box_v1_hourly_temps.csv')
const WANT_HOURLY = process.argv.includes('--hourly-temps')

// Match P7's rounding: 6 dp for MWh fields, 3 dp for monthly kWh / temps.
const r6 = x => (x == null || Number.isNaN(Number(x)) ? null : Math.round(Number(x) * 1e6) / 1e6)
const r3 = x => (x == null || Number.isNaN(Number(x)) ? null : Math.round(Number(x) * 1e3) / 1e3)
const sum = arr => arr.reduce((a, b) => a + (b ?? 0), 0)

// Non-leap calendar (the EPW/run is a single 8760-hour FULL YEAR, no leap day).
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Aggregate an 8760-hour array into 12 monthly values (sum or mean). */
function monthlyFromHourly(arr, agg = 'sum') {
  const out = []
  let h = 0
  for (const dim of DAYS_IN_MONTH) {
    const hrs = dim * 24
    const slice = arr.slice(h, h + hrs)
    out.push(agg === 'mean' ? sum(slice) / slice.length : sum(slice))
    h += hrs
  }
  return out
}

/** Aggregate a 365-day array of hourly-SUMS into 12 monthly means (per-hour). */
function monthlyMeanFromDailySum(dailySum) {
  const out = []
  let d = 0
  for (const dim of DAYS_IN_MONTH) {
    const slice = dailySum.slice(d, d + dim)
    out.push(sum(slice) / (dim * 24)) // daily values are sums of 24 hourly samples
    d += dim
  }
  return out
}

const { fixture, inputs, result } = loadAndRun(FIXTURE, REPO_ROOT)

const c = result?.consumption ?? {}
const d = result?.demand ?? {}
const hb = result?.heat_balance?.annual ?? {}
const ll = hb?.losses ?? {}
const lg = hb?.gains ?? {}
const ig = lg?.internal ?? {}
const solar = lg?.solar ?? {}
const totals = hb?.totals ?? {}

// kWh -> MWh element readers.
const lossMwh = k => r6((ll?.[k]?.kwh ?? 0) / 1000)
const solarMwh = dir => r6((solar?.[dir]?.kwh ?? 0) / 1000)
const igMwh = k => r6((ig?.[k]?.kwh ?? 0) / 1000)

// Precise demand from hourly integrands (most directly comparable to EP supply-air).
const hHeat = d?.heating_demand_hourly_kwh ?? []
const hCool = d?.cooling_demand_hourly_kwh ?? []
const hZoneT = d?.hourly_zone_air_c ?? []
const heatingDemandMwh = r6(sum(hHeat) / 1000)
const coolingDemandMwh = r6(sum(hCool) / 1000)
const zoneMeanC = r3(sum(hZoneT) / hZoneT.length)

const monthlyHeatingKwh = monthlyFromHourly(hHeat, 'sum').map(r3)
const monthlyCoolingKwh = monthlyFromHourly(hCool, 'sum').map(r3)
const monthlyZoneTC = monthlyFromHourly(hZoneT, 'mean').map(r3)
const dailyOutSum = result?.daily_profiles?.weather?.t_out_sum_c ?? []
const monthlyOutC = monthlyMeanFromDailySum(dailyOutSum).map(r3)

const out = {
  brief: 'Brief 81 P8 - Bridgewater-Box NZA-Sim extract',
  source: 'node validation/nza_sim/extract.mjs',
  fixture: fixture?.meta?.fixture_id ?? 'bridgewater_box_v1',
  fixture_schema_version: fixture?.meta?.schema_version ?? null,
  captured_at: new Date().toISOString(),

  engine: {
    name: 'NZA-Sim',
    version: 'v2.5 (instantCalc dynamic engine)',
    state: result?.state ?? null,
    mode: result?.mode ?? null,
    weather_epw: fixture?.weather?.epw_file ?? null,
    note:
      'Pure-Node run via validation/nza_sim/load_fixture.mjs (no live DB). engine:v2.5 ' +
      'forces State 3 (_calculateState3 — systems overlay applied). Same fixture and ' +
      'EPW as the EnergyPlus reference.',
  },

  geometry: {
    gia_m2: hb?.metadata?.gia_m2 ?? fixture?.geometry?.gia_m2 ?? null,
    volume_m3: fixture?.geometry?.volume_m3 ?? null,
    weather_file: fixture?.weather?.epw_file ?? null,
    comfort_band_c: {
      lower_c: fixture?.comfort_band?.lower_c ?? null,
      upper_c: fixture?.comfort_band?.upper_c ?? null,
    },
  },

  demand_mwh: {
    heating: heatingDemandMwh,
    cooling: coolingDemandMwh,
    consumption_heating: r6(c?.space_heating?.demand_mwh),
    consumption_cooling: r6(c?.space_cooling?.demand_mwh),
    _note:
      'NZA-Sim net space heating/cooling demand (MWh), integrated from the hourly ' +
      'demand profile. NZA models a single net zone demand AFTER MVHR recovery — the ' +
      'analogue of EnergyPlus heating/cooling_supply_air_sensible. NZA has no separate ' +
      'OA / heat-recovery demand decomposition (recovery is applied as a loss offset; ' +
      'see mech_ventilation_mwh). consumption_* are the engine consumption-block values ' +
      '(rounded to 0.1 MWh internally) and equal the hourly integral within rounding.',
  },

  fabric_conduction_mwh: {
    wall_south: null,
    wall_north: null,
    wall_east: null,
    wall_west: null,
    external_wall_sum: lossMwh('external_wall'),
    roof: lossMwh('roof'),
    ground_floor: lossMwh('ground_floor'),
    thermal_bridge: lossMwh('thermal_bridging'),
    _note:
      'NZA-Sim losses_per_element (POSITIVE loss magnitudes; EnergyPlus reports these ' +
      'negative — P9 compares |x|). NZA reports a single combined external_wall loss ' +
      '(no per-facade split), so the four wall_* facades are null. Glazing conduction ' +
      'is reported under windows_mwh.conduction_loss to parallel EnergyPlus, which keeps ' +
      'windows out of this fabric set.',
  },

  windows_mwh: {
    transmitted_solar: {
      south: solarMwh('south'),
      north: solarMwh('north'),
      east: solarMwh('east'),
      west: solarMwh('west'),
      sum_facades: r6(
        (solarMwh('south') ?? 0) + (solarMwh('north') ?? 0) + (solarMwh('east') ?? 0) + (solarMwh('west') ?? 0)
      ),
      enclosure_total: r6((solar?.total_kwh ?? 0) / 1000),
    },
    conduction_loss: {
      sum: lossMwh('glazing'),
      _per_facade_note: 'NZA reports a single combined glazing conduction loss (no per-facade split).',
    },
    _note:
      'transmitted_solar = NZA solar gain through glazing per facade (the direct ' +
      'analogue of EnergyPlus Surface Window Transmitted Solar). conduction_loss = NZA ' +
      'glazing U-value loss; maps to EnergyPlus windows_mwh.heat_loss. NZA does not ' +
      'separate window convective heat-gain the way EnergyPlus does.',
  },

  infiltration_mwh: {
    sensible_loss: lossMwh('fabric_leakage'),
    _note:
      "NZA-Sim 'fabric_leakage' loss (infiltration via ach_constant 0.5). Maps to " +
      'EnergyPlus Zone Infiltration sensible loss. NZA does not report an infiltration ' +
      'sensible-gain or latent term separately.',
  },

  mech_ventilation_mwh: {
    loss: lossMwh('mech_ventilation'),
    recovery_offset: r6(c?.space_heating?.recovery_offset_mwh),
    fan_electrical: r6(c?.brief40?.ventilation?.total_fan_electrical_mwh),
    _note:
      'NZA mechanical-ventilation sensible loss AFTER MVHR recovery, plus the recovery ' +
      'offset removed before the boiler sees demand, plus fan electrical energy. ' +
      'EnergyPlus models the same physics inside the ideal-loads demand as ' +
      'oa_sensible_heating minus heat_recovery_sensible_heating; P9 maps this block to ' +
      'that EnergyPlus net OA term.',
  },

  internal_gains_mwh: {
    people: igMwh('people'),
    lighting: igMwh('lighting'),
    equipment: igMwh('equipment'),
    auxiliary: igMwh('auxiliary'),
    _note:
      'NZA internal heat gains. NZA people gain is sensible-equivalent (no separate ' +
      'latent split) — compare against EnergyPlus people_sensible. lighting/equipment ' +
      'are 100% convective gains and equal their electricity meters.',
  },

  zone_temperature: {
    mean_air_temp_annual_c: zoneMeanC,
    _note: 'Annual = mean of 8760 hourly zone-air values; monthly array under "monthly".',
  },

  monthly: {
    month_labels: MONTH_LABELS,
    heating_supply_air_sensible_kwh: monthlyHeatingKwh,
    cooling_supply_air_sensible_kwh: monthlyCoolingKwh,
    zone_mean_air_temp_c: monthlyZoneTC,
    outdoor_drybulb_c: monthlyOutC,
    _note:
      'Heating/cooling = monthly sums of NZA hourly demand; temps = monthly means of ' +
      'NZA hourly zone air; outdoor = monthly mean of the EPW daily drybulb profile. ' +
      'Field names mirror the EnergyPlus reference for P9 monthly-correlation (>=0.85).',
  },

  derived_delivered: {
    _note:
      'NZA-Sim consumption per-service rollup through the fixture system layer. Parallel ' +
      'to the EnergyPlus derived_delivered block. These ARE NZA native outputs (not ' +
      'recomputed), unlike the EnergyPlus side where DHW/fan are closed-form.',
    heating: {
      demand_mwh: r6(c?.space_heating?.demand_mwh),
      efficiency: c?.space_heating?.primary?.efficiency ?? null,
      fuel: c?.space_heating?.primary?.fuel ?? null,
      fuel_mwh: r6(c?.space_heating?.primary?.fuel_mwh ?? c?.space_heating?.gas_mwh),
      recovery_offset_mwh: r6(c?.space_heating?.recovery_offset_mwh),
    },
    cooling: {
      demand_mwh: r6(c?.space_cooling?.demand_mwh),
      eer: c?.space_cooling?.primary?.efficiency ?? null,
      fuel: c?.space_cooling?.primary?.fuel ?? null,
      fuel_mwh: r6(c?.space_cooling?.primary?.fuel_mwh ?? c?.space_cooling?.electricity_mwh),
    },
    dhw: {
      demand_mwh: r6(c?.dhw?.demand_mwh),
      fuel_mwh: r6(c?.dhw?.gas_mwh || c?.dhw?.electricity_mwh),
      fuel: c?.dhw?.gas_mwh ? 'gas' : c?.dhw?.electricity_mwh ? 'electricity' : null,
    },
    ventilation: {
      fan_electrical_mwh: r6(c?.brief40?.ventilation?.total_fan_electrical_mwh),
    },
    lighting_mwh: r6(c?.lighting?.electricity_mwh ?? igMwh('lighting')),
    equipment_mwh: r6(c?.small_power?.electricity_mwh ?? igMwh('equipment')),
  },

  headline: {
    eui_kwh_per_m2_yr: r3(c?.total?.kwh_per_m2_yr),
    heating_demand_mwh: heatingDemandMwh,
    cooling_demand_mwh: coolingDemandMwh,
    dhw_demand_mwh: r6(c?.dhw?.demand_mwh),
    electricity_mwh: r6(c?.total?.electricity_mwh),
    gas_mwh: r6(c?.total?.gas_mwh),
  },

  totals: {
    eui_kwh_per_m2_yr: r3(c?.total?.kwh_per_m2_yr),
    electricity_mwh: r6(c?.total?.electricity_mwh),
    gas_mwh: r6(c?.total?.gas_mwh),
    district_heat_mwh: r6(c?.total?.district_heat_mwh ?? 0),
  },
}

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf-8')

// ASCII-only console summary (Windows cp1252).
const mh = out.headline
console.log('=================================================================')
console.log(' Bridgewater-Box NZA-Sim extract (Brief 81 P8)')
console.log('=================================================================')
console.log(` engine state    : ${out.engine.state} / ${out.engine.mode}`)
console.log(` GIA             : ${out.geometry.gia_m2} m2`)
console.log('-----------------------------------------------------------------')
console.log(` heating demand  : ${mh.heating_demand_mwh} MWh`)
console.log(` cooling demand  : ${mh.cooling_demand_mwh} MWh`)
console.log(` DHW demand      : ${mh.dhw_demand_mwh} MWh`)
console.log(` EUI             : ${mh.eui_kwh_per_m2_yr} kWh/m2.yr`)
console.log(` electricity     : ${mh.electricity_mwh} MWh`)
console.log(` gas             : ${mh.gas_mwh} MWh`)
console.log('-----------------------------------------------------------------')
console.log(` zone mean T     : ${out.zone_temperature.mean_air_temp_annual_c} C`)
console.log(` monthly heating : sum ${r3(sum(monthlyHeatingKwh))} kWh`)
console.log(` monthly cooling : sum ${r3(sum(monthlyCoolingKwh))} kWh`)
console.log('=================================================================')
console.log(`\nwrote ${path.relative(REPO_ROOT, OUT_FILE)}`)

// ── Brief 82 P2: opt-in 8760-row hourly trace CSV ──────────────────────────
// Schema-identical to validation/energyplus/extract_hourly_temps.py:
//   hour_index, month, day, hour, zone_mean_air_temp_c, outdoor_drybulb_c,
//   heating_demand_kwh, cooling_demand_kwh
// hour_index is the 0-based ordinal hour of the year (0 = first hour). NZA index
// h maps to EPW row h -> the (h+1)-th hour of the year, aligning index-for-index
// with the EnergyPlus hour-ending TimeIndex (h+1). zone_mean_air_temp_c is the
// post-solve conditioned zone air temperature (result.demand.hourly_zone_air_c,
// instantCalc.js L3282) — the analogue of EnergyPlus 'Zone Mean Air Temperature'.
if (WANT_HOURLY) {
  const wd = inputs?.weatherData ?? {}
  const temp = wd.temperature ?? []
  const mon = wd.month ?? []
  const day = wd.day ?? []
  const hr = wd.hour ?? []
  const N = hZoneT.length
  const rr4 = x => (x == null || Number.isNaN(Number(x)) ? '' : Math.round(Number(x) * 1e4) / 1e4)
  const rr6 = x => (x == null || Number.isNaN(Number(x)) ? '' : Math.round(Number(x) * 1e6) / 1e6)
  const lines = ['hour_index,month,day,hour,zone_mean_air_temp_c,outdoor_drybulb_c,heating_demand_kwh,cooling_demand_kwh']
  for (let h = 0; h < N; h++) {
    lines.push([
      h,
      mon[h] ?? '',
      day[h] ?? '',
      hr[h] ?? '',
      rr4(hZoneT[h]),
      rr4(temp[h]),
      rr6(hHeat[h]),
      rr6(hCool[h]),
    ].join(','))
  }
  fs.writeFileSync(HOURLY_OUT_FILE, lines.join('\n') + '\n', 'utf-8')
  const meanT = sum(hZoneT) / N
  console.log(`wrote ${path.relative(REPO_ROOT, HOURLY_OUT_FILE)} (${N} rows)`)
  console.log(`NZA zone mean air temp = ${rr4(meanT)} C`)
}
