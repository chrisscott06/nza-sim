/**
 * useSimulationBalance.js
 *
 * Fetch the heat-balance object for a given simulation run and cache by
 * (projectId, runId). Used by every HeatBalance call site so the
 * Simulation toggle has data to show.
 */

import { useEffect, useState } from 'react'

export function useSimulationBalance(projectId, runId) {
  const [data, setData]   = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setData(null)
    setError(null)
    if (!projectId || !runId) return
    let cancelled = false
    fetch(`/api/projects/${projectId}/simulations/${runId}/balance`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(b => { if (!cancelled) setData(b) })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [projectId, runId])

  return { data, error }
}
