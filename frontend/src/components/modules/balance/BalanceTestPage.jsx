/**
 * BalanceTestPage.jsx — temporary route at /balance-test
 *
 * Mounts the HeatBalance component fed from live instantCalc + cached
 * EnergyPlus run. Used for Part 3-4 verification; will be replaced when
 * /results tab and pop-out integrations land in Parts 6-7.
 */

import { useContext, useEffect, useMemo, useState } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { WeatherContext } from '../../../context/WeatherContext.jsx'
import { SimulationContext } from '../../../context/SimulationContext.jsx'
import { calculateInstant, calculateInstantDegreeDay } from '../../../utils/instantCalc.js'
import HeatBalance from './HeatBalance.jsx'

// ── Hook: fetch + cache the simulation balance for a (projectId, runId) ─────
function useSimulationBalance(projectId, runId) {
  const [data, setData]   = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setData(null); setError(null)
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

export default function BalanceTestPage() {
  const { params, constructions, systems, currentProjectId, saveStatus } = useContext(ProjectContext)
  const weatherCtx = useContext(WeatherContext)
  const simCtx     = useContext(SimulationContext)

  const liveResult = useMemo(() => {
    if (weatherCtx?.weatherData && weatherCtx?.hourlySolar) {
      return calculateInstant(params || {}, constructions || {}, systems || {}, {}, weatherCtx.weatherData, weatherCtx.hourlySolar)
    }
    return calculateInstantDegreeDay(params || {}, constructions || {}, systems || {}, {})
  }, [params, constructions, systems, weatherCtx?.weatherData, weatherCtx?.hourlySolar])

  const { data: simBalance } = useSimulationBalance(currentProjectId, simCtx?.runId)

  const simulationInfo = simCtx?.runId ? {
    runId: simCtx.runId,
    ranAt: simCtx.results?.created_at ?? simCtx.results?.ranAt ?? null,
    // Stale heuristic: project saved after sim ran (saveStatus has cycled
    // through 'saving'/'saved' since runId was set). Conservative: also
    // mark stale if EUI live vs sim diverges by >20%.
    isStale: saveStatus === 'saving' || saveStatus === 'saved',
  } : null

  return (
    <div className="h-[calc(100vh-3rem)] bg-off-white p-6">
      <div className="max-w-5xl mx-auto h-full bg-white rounded-xl border border-light-grey overflow-hidden">
        <HeatBalance
          liveData={liveResult?.heat_balance}
          simulationData={simBalance}
          simulationInfo={simulationInfo}
          onElementClick={(key, meta) => console.log('clicked', key, meta)}
        />
      </div>
    </div>
  )
}
