/**
 * crremTargets.js — Brief 28-IM Gate IM-M5 §15.3
 *
 * CRREM Global Pathways v2.04 — Hotel / Hospitality (International) — 1.5°C
 * aligned carbon-intensity targets kgCO2/m²/yr.
 *
 * Source: CRREM Global Pathways v2.04 dataset, "Hotel - International"
 * sheet, kgCO2e/m²·yr column. Linear interpolation between published
 * waypoints used for any year that's not explicitly listed.
 *
 * Used by:
 *   - Results module Carbon tab — overlay against the building's per-year
 *     carbon trajectory; mark the year-of-exceedance (the first year where
 *     the building's projected carbon crosses BELOW the CRREM target).
 *   - Brief 28-IM IM-M6 Retrofit Roadmap — intervention sizing against
 *     2030 / 2040 milestone gaps.
 *
 * Future expansion: per-asset-class targets (Office, Retail, Hospital,
 * etc.) live in the same CRREM dataset — wire when other building types
 * land in the tool. V1 carries Hotel International only.
 */

export const CRREM_HOTEL_KGCO2_PER_M2_YR = Object.freeze([
  { year: 2024, target: 33.0 },
  { year: 2030, target: 17.5 },
  { year: 2040, target: 8.2  },
  { year: 2050, target: 2.8  },
])

/**
 * Interpolated CRREM target for any year in the 2024–2050 horizon. Used
 * by the year-of-exceedance comparison + by the Carbon tab overlay line.
 */
export function crremTargetForYear(year) {
  const t = CRREM_HOTEL_KGCO2_PER_M2_YR
  if (year <= t[0].year)              return t[0].target
  if (year >= t[t.length - 1].year)   return t[t.length - 1].target
  for (let i = 0; i < t.length - 1; i++) {
    const a = t[i], b = t[i + 1]
    if (year >= a.year && year <= b.year) {
      const k = (year - a.year) / (b.year - a.year)
      return a.target + k * (b.target - a.target)
    }
  }
  return t[t.length - 1].target
}

/**
 * Build the year-by-year CRREM target trajectory 2024..2050 for chart
 * overlay against the building's own projected carbon.
 */
export function buildCrremYearlyTargets(startYear = 2024, endYear = 2050) {
  const out = []
  for (let y = startYear; y <= endYear; y++) {
    out.push({ year: y, target: Math.round(crremTargetForYear(y) * 100) / 100 })
  }
  return out
}
