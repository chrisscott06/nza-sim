/**
 * HeatBalanceTab.jsx — tab inside /results
 *
 * Wraps HeatBalance + DrillDown with live + simulation data sources.
 * Mirrors BalanceTestPage but lives inside the Results dashboard tabs.
 */

import { useContext, useEffect, useMemo, useState } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { WeatherContext } from '../../../context/WeatherContext.jsx'
import { SimulationContext } from '../../../context/SimulationContext.jsx'
import { calculateInstant, calculateInstantDegreeDay } from '../../../utils/instantCalc.js'
import { useSimulationBalance } from '../../../hooks/useSimulationBalance.js'
import HeatBalance from '../balance/HeatBalance.jsx'
import DrillDown from '../balance/DrillDown.jsx'

export default function HeatBalanceTab() {
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

  // Results module is the State 3 (full model) view — explicit mode so a future
  // contract change to the default doesn't silently re-shape this view.
  const { data: simBalance } = useSimulationBalance(currentProjectId, simCtx?.runId, 'full')

  const simulationInfo = simCtx?.runId ? {
    runId: simCtx.runId,
    ranAt: simCtx.results?.created_at ?? null,
    isStale: saveStatus === 'saving' || saveStatus === 'saved',
  } : null

  const orientationDeg = Number(params?.orientation ?? 0)

  return (
    <div className="h-full bg-off-white p-4">
      <div className="h-full bg-white rounded-xl border border-light-grey overflow-hidden">
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
