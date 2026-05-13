/**
 * useStateComparison.js — run State 1 + State 2 live-engine calcs in one
 * memoised pass and expose both results for the Delta diagnostic view.
 *
 * Brief 27 Revised Part 11. Used by DeltaView (headline diagnostic),
 * Heat balance, Free-running.
 *
 * Constructions library is fetched once per app session via a SHARED
 * IN-FLIGHT PROMISE so concurrent mounts (e.g. switching tabs while the
 * fetch hasn't completed) all await the same fetch and resolve together.
 *
 * Brief 27 close-out Bug 3 fix: the previous implementation used a
 * module-level `_libraryDataCache` and a useEffect that short-circuited
 * with `if (_libraryDataCache) return`. If component A's fetch
 * completed BETWEEN component B's first render and its useEffect, the
 * short-circuit fired but component B's `setLibraryData` was never
 * called — so libraryData stayed null and `ready` stayed false
 * indefinitely. Shared-promise pattern is race-free.
 */

import { useContext, useEffect, useMemo, useState } from 'react'
import { ProjectContext } from '../../../../context/ProjectContext.jsx'
import { WeatherContext } from '../../../../context/WeatherContext.jsx'
import { useHourlySolar } from '../../../../hooks/useHourlySolar.js'
import { calculateInstant } from '../../../../utils/instantCalc.js'

// Shared in-flight (or resolved) promise. First useEffect to mount
// initialises it; subsequent mounts await the same promise.
let _libraryDataPromise = null

function fetchLibraryData() {
  if (_libraryDataPromise) return _libraryDataPromise
  _libraryDataPromise = fetch('/api/library/constructions')
    .then(r => r.ok ? r.json() : { constructions: [] })
    .then(data => {
      const arr = data?.constructions ?? []
      return {
        constructions: arr.map(c => ({
          name: c.name,
          u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
          y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
          config_json: c.config_json ?? c,
        })),
      }
    })
    .catch(() => ({ constructions: [] }))
  return _libraryDataPromise
}

export function useStateComparison() {
  const { params, constructions, systems, comfortBand } = useContext(ProjectContext)
  const { weatherData } = useContext(WeatherContext)
  const hourlySolar = useHourlySolar(weatherData, params?.orientation ?? 0)

  const [libraryData, setLibraryData] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchLibraryData().then(data => {
      if (!cancelled) setLibraryData(data)
    })
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
