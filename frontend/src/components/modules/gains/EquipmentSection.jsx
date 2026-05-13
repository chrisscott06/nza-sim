/**
 * EquipmentSection.jsx — left-panel input section for the Internal Gains
 * module's EQUIPMENT block.
 *
 * Reads / writes `params.gains.equipment.*` per the v2.3 contract:
 *   - baseload.{value, unit}     (24/7 occupancy-independent load)
 *   - active.{value, unit}       (occupancy-driven load)
 *   - relationship_to_occupancy  (proportional | independent)
 *   - standby_factor             (floor when occupancy = 0)
 *   - schedule.{weekday, saturday, sunday, monthly_multipliers, exceptions}
 *
 * Brief 27 Part 4 — SCAFFOLD ONLY. Part 6 fills in.
 */

import { useContext } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'

export default function EquipmentSection() {
  const { params } = useContext(ProjectContext)
  const equipment = params?.gains?.equipment

  return (
    <div className="space-y-2 text-caption text-mid-grey">
      <div className="px-2 py-1.5 bg-off-white border border-light-grey/60 rounded text-xxs">
        <div className="font-mono text-mid-grey">
          {equipment?.baseload && equipment?.active
            ? `${equipment.baseload.value} base + ${equipment.active.value} active ${equipment.baseload.unit.replace('_', '/').replace('per', '/')}`
            : '— (not configured)'}
        </div>
        <div className="text-mid-grey/80 mt-0.5">
          {equipment?.relationship_to_occupancy
            ? `Active: ${equipment.relationship_to_occupancy.replace(/_/g, ' ')}, standby floor ${(equipment.standby_factor ?? 0.1) * 100}%`
            : '— relationship not set'}
        </div>
      </div>
      <p className="text-xxs italic text-mid-grey/70 px-1">
        Baseload + active power, relationship-to-occupancy, standby
        factor, and the equipment schedule editor land in Part 6.
      </p>
    </div>
  )
}
