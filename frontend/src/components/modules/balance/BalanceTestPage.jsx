/**
 * BalanceTestPage.jsx — temporary route at /balance-test
 *
 * Mounts the HeatBalance component fed from live instantCalc + cached
 * EnergyPlus run. Used for Part 3-4 verification; will be replaced when
 * /results tab and pop-out integrations land in Parts 6-7.
 */

import { useContext, useEffect, useMemo, useState } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { useWeather } from '../../../context/WeatherContext.jsx'
import { SimulationContext } from '../../../context/SimulationContext.jsx'
import { calculateInstant, calculateInstantDegreeDay } from '../../../utils/instantCalc.js'
import { useSimulationBalance } from '../../../hooks/useSimulationBalance.js'
import { useHourlySolar } from '../../../hooks/useHourlySolar.js'
import HeatBalance from './HeatBalance.jsx'
import DrillDown from './DrillDown.jsx'

export default function BalanceTestPage() {
  const { params, constructions, systems, currentProjectId, saveStatus } = useContext(ProjectContext)
  // Brief 28-TB-Simple TB-V1 fix: previously this page read weatherCtx.hourlySolar
  // which doesn't exist on WeatherContext — that fall-through into
  // calculateInstantDegreeDay broke the post-Brief 28k+ display contract by
  // never running the hourly engine path. useHourlySolar is the canonical
  // hook (BuildingDefinition uses the same).
  const { weatherData } = useWeather()
  const orientationDeg = Number(params?.orientation ?? 0)
  const hourlySolar = useHourlySolar(weatherData, orientationDeg)
  const simCtx     = useContext(SimulationContext)
  const [drillKey, setDrillKey] = useState(null)
  const [libraryData, setLibraryData] = useState({ constructions: [] })

  useEffect(() => {
    fetch('/api/library?type=construction')
      .then(r => r.ok ? r.json() : [])
      .then(items => setLibraryData({ constructions: items ?? [] }))
      .catch(() => {})
  }, [])

  // Brief 28-TB-Simple TB-V1: drive calculateInstant in 'envelope-gains'
  // mode (State 2) so /balance-test exercises the post-Brief 28k+ engine
  // path with losses_at_setpoint per-element / per-system / per-opening
  // breakdown. Default 'full' (State 3 / legacy) doesn't carry the new
  // shape. Backward-compat: when no v2.5 systems config is loaded, State 2
  // is still the right path for a Heat Balance display because it
  // includes mechanical ventilation but not heating/cooling system
  // efficiencies — exactly the scope of a pre-systems heat balance.
  const liveResult = useMemo(() => {
    if (weatherData && hourlySolar) {
      return calculateInstant(
        params || {}, constructions || {}, systems || {}, {},
        weatherData, hourlySolar, null,
        { mode: 'envelope-gains' },
      )
    }
    return calculateInstantDegreeDay(params || {}, constructions || {}, systems || {}, {})
  }, [params, constructions, systems, weatherData, hourlySolar])

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

  return (
    <div className="h-[calc(100vh-3rem)] bg-off-white p-6">
      <div className="max-w-5xl mx-auto h-full bg-white rounded-xl border border-light-grey overflow-hidden">
        <HeatBalance
          liveData={liveResult?.heat_balance}
          simulationData={simBalance}
          simulationInfo={simulationInfo}
          orientationDeg={orientationDeg}
          onElementClick={(key) => setDrillKey(key)}
          mode="envelope-gains"
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
