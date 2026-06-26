/**
 * costModel.js — Brief 90 (Brief B): NRM2 cost computations + the per-intervention
 * cost data shape + migration. Pure functions; project defaults + energy prices
 * via costReads (Bible Rule 11). No engine changes.
 *
 * Boundaries kept explicit (Bible): "annual delivered electricity/gas kWh saved"
 * (from the engine per-fuel delta) → "annual operational £ saved" (× energy price)
 * → "simple payback years" (total cost ÷ annual £ saved).
 */
import { readProjectDefault, readEnergyPrice } from './costReads.js'

export const PAYBACK_CLAMP_YEARS = 999

/** The six Headline line keys (kept in sync with costLibrary HEADLINE_LINES). */
const HEADLINE_KEYS = [
  'design_engineering', 'equipment', 'installation_commissioning',
  'additional_measures', 'project_delivery', 'contingency',
]

const num = v => (v == null || v === '' || !Number.isFinite(Number(v))) ? 0 : Number(v)

/** Default empty cost object for a new/migrated intervention (Headline mode, £0). */
export function emptyCost() {
  return {
    mode: 'headline',
    headline: Object.fromEntries(HEADLINE_KEYS.map(k => [k, null])),
    detailed: null,            // NRM2 elemental tree — Detailed mode (future / Applemore)
    computed_total: 0,
  }
}

/** Ensure an intervention carries a valid `.cost` (lossless migration). */
export function migrateInterventionCost(intervention) {
  if (intervention?.cost?.mode) return intervention
  return { ...intervention, cost: emptyCost() }
}

/** Sum of the six Headline lines (missing → £0). */
export function computeHeadlineTotal(headline) {
  return HEADLINE_KEYS.reduce((s, k) => s + num(headline?.[k]), 0)
}

/**
 * Derive the three % lines (design, delivery, contingency) from the works lines
 * (equipment + installation + additional) and project defaults. Used by the
 * "use defaults" affordance; the user can then override any line.
 */
export function deriveHeadlineLines(headline, projectDefaults = null) {
  const works = num(headline?.equipment) + num(headline?.installation_commissioning) + num(headline?.additional_measures)
  const feePct      = readProjectDefault('design_fees_pct', projectDefaults) / 100
  const designShare = readProjectDefault('design_share_of_fee', projectDefaults)
  const deliveryShare = readProjectDefault('delivery_share_of_fee', projectDefaults)
  const contingencyPct = readProjectDefault('contingency_pct', projectDefaults) / 100
  const inflationPct   = readProjectDefault('inflation_pct', projectDefaults) / 100

  const feeBudget = works * feePct
  const design_engineering = Math.round(feeBudget * designShare)
  const project_delivery   = Math.round(feeBudget * deliveryShare)
  const subtotal = works + design_engineering + project_delivery
  const contingency = Math.round(subtotal * (contingencyPct + inflationPct))
  return { design_engineering, project_delivery, contingency }
}

/** Total cost for an intervention's `.cost`, whichever mode is active. */
export function computeCostTotal(cost) {
  if (!cost) return 0
  if (cost.mode === 'detailed' && cost.detailed) return computeDetailedTotal(cost.detailed)
  return computeHeadlineTotal(cost.headline)
}

/** Detailed NRM2 elemental total (Σ 0–8 Building Works + on-costs 9–14). v1 shell. */
export function computeDetailedTotal(detailed, projectDefaults = null) {
  if (!detailed) return 0
  const buildingWorks = (detailed.categories ?? []).reduce((catSum, cat) =>
    catSum + (cat.lines ?? []).reduce((s, l) => s + num(l.quantity) * num(l.rate), 0), 0)
  // On-costs as % of Building Works (prelims + OHP + fees + risks + inflation).
  const pct = k => readProjectDefault(k, projectDefaults) / 100
  const onCosts = buildingWorks * (pct('prelims_pct') + pct('ohp_pct') + pct('design_fees_pct') + pct('contingency_pct') + pct('inflation_pct'))
  return Math.round(buildingWorks + onCosts)
}

/**
 * Annual operational £ saved from an intervention's per-fuel delta record
 * (interventionsEngine `per_fuel.{electricity,gas}_mwh.delta`, MWh; delta =
 * post − baseline, so a saving is negative). Returns £/yr (can be negative for a
 * measure that costs more to run, e.g. a fuel switch to pricier electricity).
 */
export function computeAnnualOperationalSaving(perFuelDelta, projectDefaults = null) {
  const savedKwh = (key) => -num(perFuelDelta?.[key]?.delta) * 1000   // baseline − post
  const elecSaved = savedKwh('electricity_mwh')
  const gasSaved  = savedKwh('gas_mwh')
  return elecSaved * readEnergyPrice('electricity', projectDefaults)
       + gasSaved  * readEnergyPrice('gas', projectDefaults)
}

/** Simple payback (years), clamped; null when there's no positive annual saving. */
export function computeSimplePayback(totalCost, annualSavingGbp) {
  if (!(totalCost > 0)) return 0
  if (!(annualSavingGbp > 0)) return null            // never pays back
  return Math.min(PAYBACK_CLAMP_YEARS, totalCost / annualSavingGbp)
}

/** £ per tonne CO₂ saved over lifetime; null when no positive carbon saving. */
export function computePoundsPerTonne(totalCost, lifetimeTco2e) {
  if (!(totalCost > 0) || !(lifetimeTco2e > 0)) return null
  return totalCost / lifetimeTco2e
}
