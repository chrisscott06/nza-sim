/**
 * EquipmentSection.jsx — left-panel input section for the Internal Gains
 * module's EQUIPMENT block.
 *
 * Brief 27 Part 4 — SCAFFOLD with live input-side readout. Splits
 * baseload + active in the readout because the live engine treats them
 * as two distinct gain streams (baseload 24/7, active occupancy-driven).
 * Part 6 fills in the editable inputs.
 */

import { useContext } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { GAIN_COLOURS } from './gainColours.js'

export default function EquipmentSection({ annual }) {
  const { params } = useContext(ProjectContext)
  const equipment = params?.gains?.equipment
  const e = annual?.equipment

  return (
    <div className="space-y-2 text-caption text-mid-grey">
      <div className="px-2 py-1.5 bg-off-white border-l-2 rounded-r text-xxs tabular-nums"
           style={{ borderLeftColor: GAIN_COLOURS.equipment }}>
        <div className="flex justify-between">
          <span className="text-mid-grey">Annual</span>
          <span className="text-navy font-medium">
            {e?.kwh != null ? `${(e.kwh / 1000).toFixed(1)} MWh` : '—'}
          </span>
        </div>
        <div className="flex justify-between pl-3">
          <span className="text-mid-grey/80 text-xxs">· baseload (24/7)</span>
          <span className="text-mid-grey">
            {e?.baseload_kwh != null && annual?.ready ? `${(e.baseload_kwh / 1000).toFixed(1)} MWh` : '—'}
          </span>
        </div>
        <div className="flex justify-between pl-3">
          <span className="text-mid-grey/80 text-xxs">· active (scheduled)</span>
          <span className="text-mid-grey">
            {e?.active_kwh != null && annual?.ready ? `${(e.active_kwh / 1000).toFixed(1)} MWh` : '—'}
          </span>
        </div>
        <div className="flex justify-between mt-1 pt-1 border-t border-light-grey/40">
          <span className="text-mid-grey">Peak</span>
          <span className="text-navy font-medium">
            {e?.peak_kw != null ? `${e.peak_kw.toFixed(1)} kW` : '—'}
          </span>
        </div>
      </div>

      <div className="px-2 py-1.5 bg-white border border-light-grey/60 rounded text-xxs">
        <div className="font-mono text-mid-grey">
          {equipment?.baseload && equipment?.active
            ? `${equipment.baseload.value} base + ${equipment.active.value} active ${equipment.baseload.unit.replace('w_per_m2', 'W/m²').replace('w_per_room', 'W/room').replace('total_w', 'W total')}`
            : '— (not configured)'}
        </div>
        <div className="text-mid-grey/80 mt-0.5">
          {equipment?.relationship_to_occupancy
            ? `Active: ${equipment.relationship_to_occupancy.replace(/_/g, ' ')}, standby floor ${((equipment.standby_factor ?? 0.1) * 100).toFixed(0)}%`
            : '— relationship not set'}
        </div>
      </div>

      <p className="text-xxs italic text-mid-grey/70 px-1">
        Editable baseload + active power, relationship-to-occupancy
        selector, standby factor, and equipment schedule editor land in
        Part 6.
      </p>
    </div>
  )
}
