/**
 * carbonReads.js — Brief 89 (Brief C): the ONE canonical read path for carbon
 * factors and CRREM decarbonisation targets, for the interventions / Brief-C
 * boundary.
 *
 * Engine Discipline (Bible Rule 11, from Brief 88): one canonical quantity, one
 * canonical exposure point, one canonical read path everywhere. Carbon factors
 * and CRREM targets follow the same rule. Read year carbon factors and CRREM
 * targets ONLY through these helpers — never re-implement grid-factor lookup or
 * re-interpolate the CRREM curve in a consumer.
 *
 * Canonical sources (the interventions boundary — see audit 89 §2 for why these
 * and not the others that coexist for separate boundaries):
 *   - year electricity factor  → data/ukGridCarbonTrajectory.js (gCO₂/kWh → kg)
 *   - year gas factor          → data/ukGridCarbonTrajectory.js (flat 0.184)
 *   - CRREM target (EUI+carbon)→ data/crremPathwayUkHotel.js (v2.07 UK Hotel)
 *
 * Distinct boundaries deliberately NOT routed here (Brief 88 discipline):
 *   - the engine's own carbon path (data/carbonFactors.js single-point factors,
 *     data/crremTargets.js v2.04) — engine-internal, untouched by Brief 89;
 *   - the Results CRREMTab (its own backend-benchmark fetch + GRID_INTENSITY).
 */

import {
  ukGridIntensityForYear,
  GAS_CARBON_FACTOR_gCO2_per_kWh,
} from '../data/ukGridCarbonTrajectory.js'
import { CRREM_PATHWAYS, CRREM_DEFAULT_PICK } from '../data/crremPathwayUkHotel.js'

/** Canonical year electricity carbon factor, kgCO₂e/kWh (UK grid trajectory). */
export function readElectricityFactor(year) {
  return ukGridIntensityForYear(year) / 1000
}

/** Canonical year gas carbon factor, kgCO₂e/kWh (UK natural gas, ~constant). */
export function readGasFactor(year) {            // eslint-disable-line no-unused-vars
  return GAS_CARBON_FACTOR_gCO2_per_kWh / 1000
}

/**
 * Canonical fuel→factor dispatch for the lifetime-carbon math. Extend here when
 * a new fuel carrier enters scope (oil, biomass, district heat — future brief).
 * Unknown fuels return null so callers can flag rather than silently zero.
 */
export function readFuelFactor(fuel, year) {
  switch (fuel) {
    case 'electricity': return readElectricityFactor(year)
    case 'gas':         return readGasFactor(year)
    default:            return null
  }
}

function pickKey({ country = 'UK', property_type = 'hotel', pathway = '1.5C' } = {}) {
  return `${country}|${property_type}|${pathway}`
}

function lerpField(curve, year, field) {
  if (year <= curve[0].year)               return curve[0][field]
  if (year >= curve[curve.length - 1].year) return curve[curve.length - 1][field]
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i], b = curve[i + 1]
    if (year >= a.year && year <= b.year) {
      const t = (year - a.year) / (b.year - a.year)
      return a[field] + t * (b[field] - a[field])
    }
  }
  return curve[curve.length - 1][field]
}

/**
 * Canonical CRREM target for a year on the project's pathway. Returns BOTH axes:
 *   { eui_kwh_m2, carbon_kg_m2 }
 * `pick` = { country, property_type, pathway }; defaults to UK Hotel 1.5°C.
 * Linear interpolation between published waypoints; clamps outside 2020–2060.
 * Returns null for an unknown pathway (caller flags rather than guesses).
 */
export function readCrremTarget(year, pick = CRREM_DEFAULT_PICK) {
  const entry = CRREM_PATHWAYS[pickKey(pick)]
  if (!entry) return null
  return {
    eui_kwh_m2:   lerpField(entry.curve, year, 'eui'),
    carbon_kg_m2: lerpField(entry.curve, year, 'carbon'),
  }
}

/** True when the requested pathway exists in the v1 registry. */
export function hasCrremPathway(pick = CRREM_DEFAULT_PICK) {
  return !!CRREM_PATHWAYS[pickKey(pick)]
}
