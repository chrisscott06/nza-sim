/**
 * carbonFactors.js — single source of truth for fuel-to-carbon factors.
 *
 * Brief 68 Part A (B1 register fix, 2026-05-28): three local declarations
 * existed before this module —
 *   • BEIS_2024_FACTORS.electricity        = 0.207 (instantCalc.js:4246)
 *   • CARBON_KG_PER_KWH.electricity        = 0.193 (systemsEngine.js:43)
 *   • GRID_INTENSITY_2026                  = 0.145 (instantCalc.js:238)
 *
 * — and a false comment at systemsEngine.js:39 claimed they matched.
 * They didn't (0.193 vs 0.207 differ by 7.3%). On Bridgewater the carbon
 * KPI could disagree between the v2.5 systems carbon path (which used
 * BEIS_2024_FACTORS) and the carrier-sum brief40 path (which used
 * CARBON_KG_PER_KWH).
 *
 * All headline-carbon paths now import from this module. The trajectory
 * file (data/ukGridCarbonTrajectory.js) and the CRREM-display year maps
 * (CRREMModule.jsx, results/CRREMTab.jsx) remain on their own data —
 * different purpose (projection over time, not single-point current
 * factor) and the brief's gate covers Home/Systems/Energy Flows only.
 * Cross-trajectory harmonisation is queued as a follow-up.
 *
 * Two electricity factors are kept separate and named unambiguously
 * because they serve different purposes:
 *
 *   • ELECTRICITY_CURRENT  — present-day Scope 2 carbon per delivered
 *                            kWh of UK grid electricity. Used for the
 *                            headline "today's carbon" KPI shown on
 *                            Home / Systems / Energy Flows.
 *
 *   • ELECTRICITY_FES_2026 — National Grid Future Energy Scenarios
 *                            ("Leading the Way") projection for 2026.
 *                            Used by the older inline-legacy carbon
 *                            path which still computes a 2026-anchored
 *                            number (logged for harmonisation under
 *                            the inline-legacy follow-up brief).
 *
 * Source: UK DESNZ (formerly BEIS) Greenhouse Gas Conversion Factors —
 * 2024 publication, UK grid electricity Scope 2 location-based factor.
 * Update annually when DESNZ publishes new figures. Do NOT change values
 * without also updating the "Source" comment.
 */

// ── Current-grid factors ─────────────────────────────────────────────────────

/** kg CO2e per kWh delivered — UK grid electricity, DESNZ 2024 published. */
export const ELECTRICITY_CURRENT = 0.207

/** kg CO2e per kWh delivered — natural gas combustion (near-stoichiometric,
 *  decarbonises only with biogas / hydrogen blending — not modelled in V1). */
export const GAS = 0.183

/** kg CO2e per kWh delivered — heating oil. */
export const OIL = 0.249

/** kg CO2e per kWh delivered — wood chip / pellet biomass.
 *  Small residual from supply-chain emissions; combustion CO2 is biogenic. */
export const BIOMASS = 0.039

/** kg CO2e per kWh delivered — UK average district heating network
 *  (gas-CHP dominated). Operator-specific values should override when known. */
export const DISTRICT_HEATING = 0.170

/** kg CO2e per kWh delivered — placeholder for district cooling networks.
 *  Currently duplicates the electricity factor. **A real value requires the
 *  operator's chiller mix + transmission losses** — flag it on operator
 *  data ingest rather than treating this placeholder as authoritative. */
export const DISTRICT_COOLING_PLACEHOLDER = ELECTRICITY_CURRENT

/** kg CO2e per kWh — ambient sources (air / ground) used by heat pumps.
 *  The compressor work is counted as electricity; the ambient "fuel" itself
 *  carries no emissions. */
export const AMBIENT_HEAT_SOURCE = 0

// ── Projected-grid factors ───────────────────────────────────────────────────

/** kg CO2e per kWh — National Grid FES "Leading the Way" 2026 projection.
 *  Used by the inline-legacy carbon path (instantCalc.js dynamic-engine
 *  branch). Queued for harmonisation alongside the rest of the inline-legacy
 *  path. */
export const ELECTRICITY_FES_2026 = 0.145

// ── Aggregate lookup map ─────────────────────────────────────────────────────

/**
 * Carbon-factor map keyed by canonical fuel name. Use when an engine needs
 * lookup-by-fuel-string (e.g. summing a mixed carrier set). Frozen so a
 * consumer can't mutate it in place — every site sees the same values.
 */
export const CARBON_FACTORS_CURRENT = Object.freeze({
  electricity:      ELECTRICITY_CURRENT,
  gas:              GAS,
  oil:              OIL,
  biomass:          BIOMASS,
  district_heating: DISTRICT_HEATING,
  district_cooling: DISTRICT_COOLING_PLACEHOLDER,
  ambient_air:      AMBIENT_HEAT_SOURCE,
  ambient_ground:   AMBIENT_HEAT_SOURCE,
})
