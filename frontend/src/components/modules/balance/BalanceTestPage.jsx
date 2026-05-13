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
import { useSimulationBalance } from '../../../hooks/useSimulationBalance.js'
import HeatBalance from './HeatBalance.jsx'
import DrillDown from './DrillDown.jsx'

export default function BalanceTestPage() {
  const { params, constructions, systems, currentProjectId, saveStatus } = useContext(ProjectContext)
  const weatherCtx = useContext(WeatherContext)
  const simCtx     = useContext(SimulationContext)
  const [drillKey, setDrillKey] = useState(null)
  const [libraryData, setLibraryData] = useState({ constructions: [] })

  useEffect(() => {
    fetch('/api/library?type=construction')
      .then(r => r.ok ? r.json() : [])
      .then(items => setLibraryData({ constructions: items ?? [] }))
      .catch(() => {})
  }, [])

  const liveResult = useMemo(() => {
    if (weatherCtx?.weatherData && weatherCtx?.hourlySolar) {
      return calculateInstant(params || {}, constructions || {}, systems || {}, {}, weatherCtx.weatherData, weatherCtx.hourlySolar)
    }
    return calculateInstantDegreeDay(params || {}, constructions || {}, systems || {}, {})
  }, [params, constructions, systems, weatherCtx?.weatherData, weatherCtx?.hourlySolar])

  // Test harness defaults to full-model shape; flip to 'envelope-only' to
  // exercise the State 1 contract output path manually.
  const { data: simBalance } = useSimulationBalance(currentProjectId, simCtx?.runId, 'full')

  const simulationInfo = simCtx?.runId ? {
    runId: simCtx.runId,
    ranAt: simCtx.results?.created_at ?? simCtx.results?.ranAt ?? null,
    // Stale heuristic: project saved after sim ran (saveStatus has cycled
    // through 'saving'/'saved' since runId was set). Conservative: also
    // mark stale if EUI live vs sim diverges by >20%.
    isStale: saveStatus === 'saving' || saveStatus === 'saved',
  } : null

  const orientationDeg = Number(params?.orientation ?? 0)

  return (
    <div className="h-[calc(100vh-3rem)] bg-off-white p-6">
      <div className="max-w-5xl mx-auto h-full bg-white rounded-xl border border-light-grey overflow-hidden">
        <HeatBalance
          liveData={liveResult?.heat_balance}
          simulationData={simBalance}
          simulationInfo={simulationInfo}
          orientationDeg={orientationDeg}
          onElementClick={(key) => setDrillKey(key)}
        />
      </div>
      <DrillDown
        elementKey={drillKey}
        open={!!drillKey}
        onClose={() => setDrillKey(null)}
        building={params}
        constructions={constructions}
        libraryData={libraryData}
        liveData={liveResult?.heat_balance}
        simulationData={simBalance}
        orientationDeg={orientationDeg}
      />
    </div>
  )
}
