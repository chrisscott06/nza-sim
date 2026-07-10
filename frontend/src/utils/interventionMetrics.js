/**
 * interventionMetrics.js — Brief 100.
 *
 * ONE canonical derivation of an intervention's isolated headline metrics from its
 * `cumulativeDelta` record + cost plan + optional `off_model` (Rule 11). Used by both
 * PerInterventionView (the isolated view) and the XLSX export so the two never drift.
 *
 * Off-model measures (PV, interlink, refrigerant) carry their effect in
 * `intervention.off_model`; it is ADDITIVE to the engine result (a measure can have
 * both engine patches and an off_model — e.g. 3.2 VRF energy + refrigerant carbon).
 */
import {
  computeCostTotal, computeLinesTotal, computeAnnualOperationalSaving,
  computeSimplePayback, computePoundsPerTonne, emptyCost,
} from './costModel.js'
import { computeLifetimeCarbon, perFuelFromDeltaRecord, defaultLifetimeYears } from './lifetimeCarbon.js'

/** Flag: 'off_model' | 'enabling' | 'simulated'/'derived' — parsed from notes tag,
 *  falling back to structure (off_model present, or no patches). */
export function interventionFlag(intervention) {
  const m = (intervention?.notes || '').match(/·\s*(simulated|derived|off_model|enabling)\s*\]/i)
  if (m) return m[1].toLowerCase()
  if (intervention?.off_model) return 'off_model'
  if ((intervention?.patches?.length ?? 0) === 0) return 'enabling'
  return 'simulated'
}

/**
 * @param {object} intervention  persisted intervention (may carry `off_model`, `cost`)
 * @param {object} cumulativeDelta  isolatedRow.cumulativeDelta (delta record) or null
 * @param {object} projectDefaults  params.cost_defaults
 * @param {number} gia  m² (for hasFuel guard; the caller does per-m² conversion)
 */
export function computeInterventionMetrics(intervention, cumulativeDelta, projectDefaults = null, gia = 0) {
  const d = cumulativeDelta ?? null
  const om = intervention?.off_model ?? null
  const isOffModel = !!om
  const omEuiDelta = Number(om?.eui_delta_kwh_m2 ?? 0) || 0
  const omDeliveredMwhDelta =
    -((Number(om?.annual_elec_kwh_saved ?? 0) || 0) + (Number(om?.annual_gas_kwh_saved ?? 0) || 0)) / 1000

  const euiDelta = om ? (Number(d?.eui_kwh_per_m2?.delta ?? 0) + omEuiDelta) : d?.eui_kwh_per_m2?.delta
  const deliveredMwhDelta = om ? (Number(d?.total_delivered_mwh?.delta ?? 0) + omDeliveredMwhDelta) : d?.total_delivered_mwh?.delta

  const perFuel = perFuelFromDeltaRecord(d?.per_fuel)
  const lifetimeYears = intervention?.lifetime_years
    ?? defaultLifetimeYears(intervention?.theme ?? intervention?.category)
  const hasFuel = gia > 0 && Object.keys(perFuel).length > 0
  const lifetime = (hasFuel || om)
    ? computeLifetimeCarbon(perFuel, { lifetimeYears, offModelTco2e: om?.lifetime_tco2e })
    : null
  const lifeTco2e = lifetime?.lifetime_carbon_saved_tco2e

  const cost = intervention?.cost ?? emptyCost()
  const costTotal = computeCostTotal(cost, projectDefaults)
  const linesTotal = computeLinesTotal(cost)
  const annualSaving = computeAnnualOperationalSaving(d?.per_fuel, projectDefaults, om?.annual_gbp_saved)
  const poundsPerTonne = costTotal > 0 && Number.isFinite(lifeTco2e) ? computePoundsPerTonne(costTotal, lifeTco2e) : null
  const payback = costTotal > 0 ? computeSimplePayback(costTotal, annualSaving) : null

  return {
    isOffModel, flag: interventionFlag(intervention),
    euiDelta, deliveredMwhDelta, lifeTco2e, annualSaving,
    costTotal, linesTotal, poundsPerTonne, payback,
    lifetimeYears, perFuel,
  }
}
