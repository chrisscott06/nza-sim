/**
 * useStateComparison.js — run State 1 + State 2 live-engine calcs in one
 * memoised pass and expose both results for the Delta diagnostic view.
 *
 * Brief 27 Revised Part 11. Used by DeltaView (headline diagnostic),
 * Heat balance, Free-running. Each canvas tab that needs both states
 * pulls from this hook so the engine work runs once per input change,
 * not once per tab.
 *
 * Fetches the constructions library on mount (cached) so the State 1
 * lumped-capacitance physics gets the real U-values for the project's
 * construction choices.
 *
 * Returns:
 *   { state1, state2, ready, libraryLoading }
 */

import { useContext, useEffect, useMemo, useState } from 'react'
import { ProjectContext } from '../../../../context/ProjectContext.jsx'
import { WeatherContext } from '../../../../context/WeatherContext.jsx'
import { useHourlySolar } from '../../../../hooks/useHourlySolar.js'
import { calculateInstant } from '../../../../utils/instantCalc.js'

// Module-level cache so navigating away + back doesn't re-fetch.
let _libraryDataCache = null

export function useStateComparison() {
  const { params, constructions, systems, comfortBand } = useContext(ProjectContext)
  const { weatherData } = useContext(WeatherContext)
  const hourlySolar = useHourlySolar(weatherData, params?.orientation ?? 0)

  const [libraryData, setLibraryData] = useState(_libraryDataCache)

  useEffect(() => {
    if (_libraryDataCache) return
    let cancelled = false
    fetch('/api/library/constructions')
      .then(r => r.ok ? r.json() : { constructions: [] })
      .then(data => {
        if (cancelled) return
        const arr = data?.constructions ?? []
        const built = {
          constructions: arr.map(c => ({
            name: c.name,
            u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
            y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
            config_json: c.config_json ?? c,
          })),
        }
        _libraryDataCache = built
        setLibraryData(built)
      })
      .catch(() => { if (!cancelled) setLibraryData({ constructions: [] }) })
    return () => { cancelled = true }
  }, [])

  return useMemo(() => {
    if (!params || !weatherData || !hourlySolar || !libraryData) {
      return { state1: null, state2: null, ready: false, libraryLoading: !libraryData }
    }
    const cb = comfortBand ?? { lower_c: 20, upper_c: 26 }
    const buildingWithComfort = { ...params, comfort_band: cb }

    const state1 = calculateInstant(
      buildingWithComfort, constructions ?? {}, systems ?? {}, libraryData,
      weatherData, hourlySolar, null,
      { mode: 'envelope-only', comfortBand: cb },
    )
    const state2 = calculateInstant(
      buildingWithComfort, constructions ?? {}, systems ?? {}, libraryData,
      weatherData, hourlySolar, null,
      { mode: 'envelope-gains', comfortBand: cb },
    )

    return { state1, state2, ready: true, libraryLoading: false }
  }, [params, constructions, systems, comfortBand, weatherData, hourlySolar, libraryData])
}
