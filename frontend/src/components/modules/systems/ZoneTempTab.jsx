/**
 * ZoneTempTab — Systems centre view, Brief 70.
 *
 * Surfaces the Brief 67/69 demand-model trace: the FREE-FLOATING zone air
 * temperature + heating/cooling demand power. The free trace shows what
 * the building would reach with no conditioning — the diagnostic signal
 * the post-clamp T_zone hides (the clamp holds it in band by design).
 *
 * Part 1 (this commit): annual heatmap + 6-tile KPI strip.
 * Part 2 (next): day-zoom panel opened by clicking any cell.
 * Part 3 (after that): week-zoom + free_running compare overlay.
 *
 * No engine work in this tab — the free trace was added to the result
 * shape as `result.demand.hourly_zone_air_free_c` alongside the existing
 * `hourly_zone_air_c` (post-clamp, Brief 53 T_extract proxy).
 */

import { useState } from 'react'
import { Info } from 'lucide-react'
import ZoneTempKpiStrip from './ZoneTempKpiStrip.jsx'
import ZoneTempHeatmap  from './ZoneTempHeatmap.jsx'

function InfoPopover() {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-mid-grey hover:text-navy hover:bg-off-white transition-colors"
        title="What is this view?"
      >
        <Info size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-10 w-[340px] bg-white border border-light-grey rounded-md shadow-lg p-3 text-xxs text-dark-grey leading-snug">
          <p className="font-medium text-navy mb-1">What this shows</p>
          <p>
            The free-floating indoor air temperature, hour by hour, across the
            whole year — i.e. <em>what the building would do with no heating
            or cooling running</em>.
          </p>
          <p className="mt-1.5">
            Blue cells = the float dips below the heating setpoint
            (conditioning would fire to lift the zone). Red = the float rises
            above the cooling setpoint (conditioning would fire to remove
            heat). Grey = the float sits in the dead band (no conditioning
            needed).
          </p>
          <p className="mt-1.5 text-mid-grey">
            Engine source: <code>result.demand.hourly_zone_air_free_c</code>
            (Brief 67/69 zone-temperature demand model).
          </p>
        </div>
      )}
    </div>
  )
}

export default function ZoneTempTab({ result }) {
  const hasTrace = !!(result?.demand?.hourly_zone_air_free_c?.length
                       ?? result?.demand?.hourly_zone_air_c?.length)

  return (
    <div className="w-full h-full overflow-auto p-3">
      {/* Compact title row — just the heading + info popover, no big text. */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-caption font-semibold text-navy">Zone temperature · annual (free-floating)</p>
        <InfoPopover />
      </div>

      <div className="mb-3">
        <ZoneTempKpiStrip result={result} />
      </div>

      <div className="bg-white border border-light-grey rounded-lg p-3">
        <ZoneTempHeatmap result={result} />
      </div>

      {!hasTrace && (
        <p className="text-xxs text-mid-grey italic mt-3">
          The trace populates as soon as the live engine pass completes —
          any input edit triggers a re-render.
        </p>
      )}
    </div>
  )
}
