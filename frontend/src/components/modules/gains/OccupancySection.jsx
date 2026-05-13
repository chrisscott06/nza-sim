/**
 * OccupancySection.jsx — left-panel input section for the Internal Gains
 * module's OCCUPANCY block.
 *
 * Reads / writes `params.occupancy.*` per the v2.3 state contract:
 *   - occupancy_rate              (fraction)
 *   - density.{value, basis}      (per_room | per_m2 | total | per_workstation)
 *   - sensible_w_per_person       (heat W/person, default 75)
 *   - latent_w_per_person         (heat W/person, default 55)
 *   - schedule.{weekday, saturday, sunday, monthly_multipliers, exceptions}
 *
 * Brief 27 Part 4 — SCAFFOLD ONLY. Part 5 fills in the inputs + inline
 * ScheduleEditor. UI principles reference: docs/ui_principles.md.
 */

import { useContext } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'

export default function OccupancySection() {
  const { params } = useContext(ProjectContext)
  const occ = params?.occupancy

  return (
    <div className="space-y-2 text-caption text-mid-grey">
      <div className="px-2 py-1.5 bg-off-white border border-light-grey/60 rounded text-xxs">
        <div className="font-mono text-mid-grey">
          {occ?.density
            ? `${occ.density.value} ${occ.density.basis === 'per_room' ? 'people/room' : occ.density.basis}`
            : '— (not configured)'}
        </div>
        <div className="text-mid-grey/80 mt-0.5">
          {occ?.occupancy_rate != null
            ? `Occupancy rate: ${(occ.occupancy_rate * 100).toFixed(0)}%`
            : '— Occupancy rate not set'}
        </div>
      </div>
      <p className="text-xxs italic text-mid-grey/70 px-1">
        Density, occupancy rate, heat per person, and the inline schedule
        editor land in Part 5.
      </p>
    </div>
  )
}
