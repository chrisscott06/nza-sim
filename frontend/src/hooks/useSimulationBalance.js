/**
 * useSimulationBalance.js
 *
 * Fetch the heat-balance object for a given simulation run and cache by
 * (projectId, runId, mode). Used by every HeatBalance call site so the
 * Simulation toggle has data to show.
 *
 * The `mode` parameter is the same state-contract mode string the rest of
 * the codebase uses (see `utils/stateMode.js`): 'envelope-only', 'full',
 * 'envelope-gains', 'envelope-gains-operation'. The backend's
 * `/balance` endpoint returns a different output shape per mode — State 1
 * adds `demand`, `free_running`, `comfort_band_used`, splits ventilation
 * into `fabric_leakage` + `permanent_vents`, etc.
 *
 * Brief 26.1 Part 2 fix: this hook previously hardcoded a no-mode fetch,
 * which made the backend default to `mode='full'`. The Building module's
 * envelope-only Sim view therefore got the full-mode shape and rendered
 * the legacy Heat Balance without the State 1 specific elements. Mode is
 * now an explicit parameter so each caller declares what shape they want.
 */

import { useEffect, useState } from 'react'

export function useSimulationBalance(projectId, runId, mode = 'full') {
  const [data, setData]   = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setData(null)
    setError(null)
    if (!projectId || !runId) return
    let cancelled = false
    const qs = mode && mode !== 'full' ? `?mode=${encodeURIComponent(mode)}` : ''
    fetch(`/api/projects/${projectId}/simulations/${runId}/balance${qs}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(b => { if (!cancelled) setData(b) })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [projectId, runId, mode])

  return { data, error }
}
