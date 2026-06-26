/**
 * lifetimeCarbon.js — Brief 89 (Brief C): per-intervention lifetime operational
 * carbon saved, fuel-switching aware, integrated year-by-year against the UK
 * grid decarbonisation trajectory.
 *
 * Methodology (design note §"CRREM methodology"):
 *   Δ_y      = Σ_fuel (baseline_kWh - post_kWh) × carbon_factor_y_fuel
 *   lifetime = Σ Δ_y for y in [startYear, min(endYear, startYear+lifetime-1)]
 *
 * The general formula is the SAME for every regime — single-fuel and
 * fuel-switching alike. Single-fuel = one fuel term; fuel switching = two terms
 * with opposite signs (gas saved is positive, electricity added is negative).
 * Per-year integration is required: the grid decarbonises, so an electricity
 * SAVING shrinks over time and an electricity ADDITION grows more carbon-
 * efficient. `lifetime ≠ year-1 × years`.
 *
 * Carbon factors come ONLY through carbonReads (Bible Rule 11). No engine
 * changes — this consumes the engine's per-fuel kWh deltas and applies factors.
 */

import { readFuelFactor } from './carbonReads.js'

export const CRREM_ANALYSIS_START = 2025
export const CRREM_ANALYSIS_END   = 2050

/**
 * Default intervention lifetimes (years) by Library category. Sensible per the
 * design note ("Per-intervention lifetime inputs"); user-overridable per
 * intervention in Part 4. Setpoint/occupancy/control changes have no embodied
 * lifetime — the saving lasts as long as the setting holds — so they're treated
 * as the analysis horizon (25y).
 */
export const CATEGORY_LIFETIME_YEARS = Object.freeze({
  systems:     18,   // heat pumps / plant — 15–20
  hvac:        18,   // alias for systems/plant
  dhw:         18,   // DHW heat pump
  heating:     18,
  cooling:     18,
  lighting:    12,   // LED + controls — 10–15
  ventilation: 20,   // MVHR / BMS-tied — 15–20
  solar:       30,   // brise soleil / fixed shading — long-life fabric-like
  shading:     30,
  fabric:      45,   // insulation — 40–50
  envelope:    45,
  operation:   25,   // setpoint / occupancy / control — analysis horizon
  small_power: 25,   // plug-load management — behavioural/control, horizon
  equipment:   12,
  default:     25,
})

/**
 * Resolve a default lifetime (years) for an intervention from its category or
 * theme string (e.g. the `intervention.theme` chip: "Systems", "Small power").
 * Normalises case + spaces so "Small power" → small_power. Unknown → 25y horizon.
 */
export function defaultLifetimeYears(categoryOrTheme) {
  if (!categoryOrTheme) return CATEGORY_LIFETIME_YEARS.default
  const key = String(categoryOrTheme).toLowerCase().trim().replace(/\s+/g, '_')
  return CATEGORY_LIFETIME_YEARS[key] ?? CATEGORY_LIFETIME_YEARS.default
}

/**
 * Convert an interventionsEngine per_fuel delta record (values in MWh, shape
 * `{ electricity_mwh: {from,to}, gas_mwh: {from,to} }`) into the kWh per-fuel
 * map this module integrates. `from` = baseline annual, `to` = post annual.
 * Boundary names kept explicit (Bible): annual delivered electricity / gas kWh.
 */
export function perFuelFromDeltaRecord(perFuelRecord) {
  const out = {}
  const MAP = { electricity: 'electricity_mwh', gas: 'gas_mwh' }
  for (const [fuel, key] of Object.entries(MAP)) {
    const rec = perFuelRecord?.[key]
    if (!rec) continue
    out[fuel] = { from_kwh: (rec.from ?? 0) * 1000, to_kwh: (rec.to ?? 0) * 1000 }
  }
  return out
}

/**
 * Per-intervention lifetime operational carbon saved.
 *
 * @param {Object} perFuel  { [fuel]: { from_kwh, to_kwh } } — baseline (from) +
 *                          post-intervention (to) annual delivered kWh.
 * @param {Object} opts     { lifetimeYears=25, startYear=2025, endYear=2050 }
 * @returns {{
 *   lifetime_carbon_saved_tco2e: number,
 *   lifetime_carbon_saved_kg: number,
 *   annual_by_year: Array<{ year, saved_kg, saved_tco2e, per_fuel_kg }>,
 *   horizon: { startYear, lastYear, lifetimeYears },
 *   unknown_fuels: string[],
 * }}
 */
export function computeLifetimeCarbon(perFuel = {}, opts = {}) {
  const startYear = opts.startYear ?? CRREM_ANALYSIS_START
  const endYear   = opts.endYear   ?? CRREM_ANALYSIS_END
  const lifetimeYears = Math.max(0, Math.round(opts.lifetimeYears ?? 25))
  const lastYear  = Math.min(endYear, startYear + lifetimeYears - 1)

  const fuels = Object.keys(perFuel)
  const unknownFuels = fuels.filter(f => readFuelFactor(f, startYear) == null)

  const annual = []
  let totalKg = 0
  for (let y = startYear; y <= lastYear; y++) {
    let yearKg = 0
    const perFuelKg = {}
    for (const fuel of fuels) {
      const factor = readFuelFactor(fuel, y)
      if (factor == null) continue                 // unknown carrier — surfaced via unknown_fuels
      const { from_kwh = 0, to_kwh = 0 } = perFuel[fuel] || {}
      const kg = (from_kwh - to_kwh) * factor       // saved (+) or added (−)
      perFuelKg[fuel] = kg
      yearKg += kg
    }
    totalKg += yearKg
    annual.push({ year: y, saved_kg: yearKg, saved_tco2e: yearKg / 1000, per_fuel_kg: perFuelKg })
  }

  return {
    lifetime_carbon_saved_tco2e: totalKg / 1000,
    lifetime_carbon_saved_kg: totalKg,
    annual_by_year: annual,
    horizon: { startYear, lastYear, lifetimeYears },
    unknown_fuels: unknownFuels,
  }
}

/**
 * Per-year carbon INTENSITY (kgCO₂e/m²·yr) for a building state, for the CRREM
 * stranding chart's asset-performance line. Electricity decarbonises with the
 * grid; gas stays flat. `fuelsKwh` = { electricity, gas } annual delivered kWh.
 */
export function carbonIntensityForYear(fuelsKwh, giaM2, year) {
  if (!giaM2 || giaM2 <= 0) return null
  let kg = 0
  for (const [fuel, kwh] of Object.entries(fuelsKwh || {})) {
    const factor = readFuelFactor(fuel, year)
    if (factor == null || !kwh) continue
    kg += kwh * factor
  }
  return kg / giaM2
}
