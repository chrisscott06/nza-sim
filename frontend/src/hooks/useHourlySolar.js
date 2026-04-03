/**
 * useHourlySolar.js
 *
 * Memoised hook that precomputes hourly solar radiation on each building facade.
 * Recomputes only when orientation, latitude, or the weather data changes.
 * For all other parameter changes (U-values, occupancy, etc.) the cached result
 * is reused — the expensive solar computation (≈5ms) is skipped entirely.
 */

import { useMemo } from 'react'
import { computeHourlySolarByFacade } from '../utils/solarCalc.js'

/**
 * @param {object|null} weatherData   — from WeatherContext
 * @param {number}      orientationDeg — building.orientation (degrees, clockwise from N)
 * @returns {object|null} { f1, f2, f3, f4, roof } Float32Array(8760) or null
 */
export function useHourlySolar(weatherData, orientationDeg) {
  const latitude = weatherData?.location?.latitude ?? 51.5

  return useMemo(() => {
    if (!weatherData) return null
    return computeHourlySolarByFacade(weatherData, latitude, orientationDeg)
  }, [weatherData, latitude, orientationDeg])
}
