/**
 * ukGridCarbonTrajectory.js — Brief 28-IM Gate IM-M5 §15.3
 *
 * UK grid carbon intensity trajectory 2024–2050 with linear interpolation
 * between waypoints. Used by:
 *   - results.carbon.trajectory  (per-year per-m² carbon for the Results
 *                                 Carbon tab line chart)
 *   - Brief 28-IM IM-M6 Retrofit Roadmap (intervention impact projection)
 *
 * Source: DESNZ Green Book Supplementary Guidance (2024) + National Grid
 * ESO Future Energy Scenarios. Values are PROJECTIONS — they reflect
 * committed policy + central-case decarbonisation pathways and should be
 * updated when newer official forecasts are published (typically annual).
 *
 * 2024  ~190 gCO2/kWh   (current UK grid average, BEIS published value)
 * 2026  ~150 gCO2/kWh   (interpolation point — coal phase-out + renewables build-out)
 * 2030  ~50  gCO2/kWh   (committed pathway — 95% low-carbon electricity)
 * 2035  ~15  gCO2/kWh   (target — note uncertainty around storage + nuclear)
 * 2040  ~8   gCO2/kWh   (near-zero — residual from long-cycle plant)
 * 2050  ~5   gCO2/kWh   (net zero scenario — final-mile decarbonisation)
 *
 * Gas factor stays flat at 184 gCO2/kWh — natural-gas combustion emissions
 * are stoichiometric and do not decarbonise. (Biogas substitution + hydrogen
 * blending would change this; not modelled in V1.)
 */

export const UK_GRID_TRAJECTORY = Object.freeze([
  { year: 2024, gCO2_per_kWh: 190 },
  { year: 2026, gCO2_per_kWh: 150 },
  { year: 2030, gCO2_per_kWh: 50  },
  { year: 2035, gCO2_per_kWh: 15  },
  { year: 2040, gCO2_per_kWh: 8   },
  { year: 2050, gCO2_per_kWh: 5   },
])

export const GAS_CARBON_FACTOR_gCO2_per_kWh = 184  // DESNZ, stable

/**
 * Linear interpolation between trajectory waypoints. Returns gCO2/kWh for
 * any year in [2024, 2050]. Out-of-range years clamp to the nearest
 * waypoint (callers should not request years outside the policy horizon).
 */
export function ukGridIntensityForYear(year) {
  const traj = UK_GRID_TRAJECTORY
  if (year <= traj[0].year)                return traj[0].gCO2_per_kWh
  if (year >= traj[traj.length - 1].year)  return traj[traj.length - 1].gCO2_per_kWh
  for (let i = 0; i < traj.length - 1; i++) {
    const a = traj[i], b = traj[i + 1]
    if (year >= a.year && year <= b.year) {
      const t = (year - a.year) / (b.year - a.year)
      return a.gCO2_per_kWh + t * (b.gCO2_per_kWh - a.gCO2_per_kWh)
    }
  }
  return traj[traj.length - 1].gCO2_per_kWh
}

/**
 * Full year-by-year trajectory 2024..2050 (27 entries). Each entry carries
 * the interpolated grid intensity for that year. Consumer (Results Carbon
 * tab) multiplies its building's annual electricity_mwh by this number to
 * project per-year per-m² carbon under "grid decarbonisation only — no
 * roadmap interventions" assumptions.
 */
export function buildUkGridYearlyTrajectory(startYear = 2024, endYear = 2050) {
  const out = []
  for (let y = startYear; y <= endYear; y++) {
    out.push({ year: y, gCO2_per_kWh: Math.round(ukGridIntensityForYear(y) * 10) / 10 })
  }
  return out
}
