/**
 * ZoneTempTab — Systems centre view, Brief 70.
 *
 * Surfaces the Brief 67/69 demand-model trace: the hourly zone air
 * temperature + heating/cooling demand power, so users can see what the
 * engine is doing instead of inferring from totals.
 *
 * Part 1 (this commit): annual heatmap + 6-tile KPI strip + title block.
 * Part 2 (next): day-zoom panel below, opened by clicking any cell.
 * Part 3 (after that): week-zoom + free_running compare overlay.
 *
 * No engine work in any part — all numbers come from
 * `result.demand.{hourly_zone_air_c, heating_demand_hourly_kwh,
 *                  cooling_demand_hourly_kwh, effective_*_setpoint_c}`,
 * which the State 3 result exposes via the `...state2Result` spread at
 * instantCalc.js:5043.
 */

import ZoneTempKpiStrip from './ZoneTempKpiStrip.jsx'
import ZoneTempHeatmap  from './ZoneTempHeatmap.jsx'

export default function ZoneTempTab({ result }) {
  const hasTrace = !!(result?.demand?.hourly_zone_air_c?.length)

  return (
    <div className="w-full h-full overflow-auto p-3">
      {/* Title + description */}
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
        <p className="text-caption font-semibold text-navy">Zone temperature · annual</p>
        <p className="text-xxs text-mid-grey italic max-w-[60%] text-right">
          Hourly indoor air temperature across the year. Colour shows zone temp
          (blue below heating SP, red above cooling SP, grey inside the dead band).
          Hours outside the band are when conditioning fired — that's where the
          demand totals on the right come from.
        </p>
      </div>

      {/* KPI strip */}
      <div className="mb-3">
        <ZoneTempKpiStrip result={result} />
      </div>

      {/* Heatmap card */}
      <div className="bg-white border border-light-grey rounded-lg p-3">
        <ZoneTempHeatmap result={result} />
      </div>

      {!hasTrace && (
        <p className="text-xxs text-mid-grey italic mt-3">
          The zone-temperature trace populates as soon as the live engine pass
          completes — any input edit triggers a re-render.
        </p>
      )}

      {/* Footer footnote */}
      <p className="text-xxs text-mid-grey italic mt-3">
        Engine source: <code>result.demand.hourly_zone_air_c</code> (Brief 67/69
        zone-temperature demand model). Clicking a cell opens a daily zoom
        view — that view lands in Part 2 of Brief 70.
      </p>
    </div>
  )
}
