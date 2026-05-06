/**
 * BalanceTestPage.jsx — temporary route at /balance-test
 *
 * Mounts the HeatBalance component fed from live instantCalc.
 * Used for Part 3 verification; will be replaced when /results tab and
 * pop-out integrations land in Part 6/7.
 */

import { useContext, useMemo } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { WeatherContext } from '../../../context/WeatherContext.jsx'
import { calculateInstant, calculateInstantDegreeDay } from '../../../utils/instantCalc.js'
import HeatBalance from './HeatBalance.jsx'

export default function BalanceTestPage() {
  const { params, constructions, systems } = useContext(ProjectContext)
  const weatherCtx = useContext(WeatherContext)
  const weatherData = weatherCtx?.weatherData
  const hourlySolar = weatherCtx?.hourlySolar

  const result = useMemo(() => {
    if (weatherData && hourlySolar) {
      return calculateInstant(params || {}, constructions || {}, systems || {}, {}, weatherData, hourlySolar)
    }
    return calculateInstantDegreeDay(params || {}, constructions || {}, systems || {}, {})
  }, [params, constructions, systems, weatherData, hourlySolar])

  return (
    <div className="h-[calc(100vh-3rem)] bg-off-white p-6">
      <div className="max-w-5xl mx-auto h-full bg-white rounded-xl border border-light-grey overflow-hidden">
        <HeatBalance
          data={result?.heat_balance}
          source="live"
          onElementClick={(key, meta) => console.log('clicked', key, meta)}
        />
      </div>
    </div>
  )
}
