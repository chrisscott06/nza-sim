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
 * Brief 27 Part 4 — SCAFFOLD with live input-side readout (annual / peak)
 * driven by `useAnnualGains`. Part 5 fills in the inputs + inline
 * ScheduleEditor. UI principles reference: docs/ui_principles.md.
 */

import { useContext } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { GAIN_COLOURS } from './gainColours.js'

export default function OccupancySection({ annual }) {
  const { params } = useContext(ProjectContext)
  const occ = params?.occupancy
  const p = annual?.people

  return (
    <div className="space-y-2 text-caption text-mid-grey">
      {/* Live readout — annual + peak, updates as inputs change */}
      <div className="px-2 py-1.5 bg-off-white border-l-2 rounded-r text-xxs tabular-nums"
           style={{ borderLeftColor: GAIN_COLOURS.occupancy }}>
        <div className="flex justify-between">
          <span className="text-mid-grey">Annual</span>
          <span className="text-navy font-medium">
            {p?.kwh != null ? `${(p.kwh / 1000).toFixed(1)} MWh` : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-mid-grey">Peak</span>
          <span className="text-navy font-medium">
            {p?.peak_kw != null ? `${p.peak_kw.toFixed(1)} kW` : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-mid-grey">Avg occupants</span>
          <span className="text-navy font-medium">
            {p?.hours_active && annual?.ready
              ? `${(p.kwh * 1000 / 75 / 8760).toFixed(0)}`
              : '—'}
          </span>
        </div>
      </div>

      {/* Current configuration — read-only summary, Part 5 swaps in inputs */}
      <div className="px-2 py-1.5 bg-white border border-light-grey/60 rounded text-xxs">
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
        Editable density, occupancy rate, heat per person, and inline
        24-hour schedule editor land in Part 5.
      </p>
    </div>
  )
}
