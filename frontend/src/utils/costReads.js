/**
 * costReads.js — Brief 90 (Brief B): the ONE canonical read path for cost rates,
 * project cost defaults, and energy prices (Bible Rule 11, extending Brief 88/89).
 *
 * Read project defaults / energy prices / type rates ONLY through these helpers —
 * never import `costLibrary.js` directly in a consumer. A project override
 * (`params.cost_defaults`) wins over the library default; the library is the floor.
 */
import {
  PROJECT_COST_DEFAULTS, INTERVENTION_TYPES,
} from '../data/costLibrary.js'

/** Canonical project-level default for a key, project override winning over library. */
export function readProjectDefault(key, projectDefaults = null) {
  const v = projectDefaults?.[key]
  if (v != null && v !== '') return Number(v)
  return PROJECT_COST_DEFAULTS[key]
}

/** Canonical energy price (£/kWh) for a fuel. */
export function readEnergyPrice(fuel, projectDefaults = null) {
  if (fuel === 'electricity') return readProjectDefault('electricity_price_per_kWh', projectDefaults)
  if (fuel === 'gas')         return readProjectDefault('gas_price_per_kWh', projectDefaults)
  return null
}

/**
 * Canonical type-default cost seed for an intervention type/theme, or null when
 * no seed exists yet (rates pending Applemore — caller falls back to £0 / direct
 * entry, never a fabricated number).
 */
export function readRateForIntervention(typeOrTheme) {
  if (!typeOrTheme) return null
  const key = String(typeOrTheme).toLowerCase().trim().replace(/\s+/g, '_')
  return INTERVENTION_TYPES[key] ?? null
}

/** True once any per-type rate seeds exist (i.e. Applemore has been ingested). */
export function hasSeededRates() {
  return Object.keys(INTERVENTION_TYPES).length > 0
}
