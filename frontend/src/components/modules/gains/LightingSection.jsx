/**
 * LightingSection.jsx — left-panel input section for the Internal Gains
 * module's LIGHTING block.
 *
 * Reads / writes `params.gains.lighting.*` per the v2.3 contract:
 *   - magnitude.{value, unit}                    (w_per_m2 | w_per_room | total_w)
 *   - relationship_to_occupancy                  (proportional_with_spill | proportional | independent | always_on)
 *   - spill_minutes                              (EP schedule generation)
 *   - daylight_factor                            (fraction during 09:00–16:00)
 *   - schedule.{weekday, saturday, sunday, monthly_multipliers, exceptions}
 *
 * Brief 27 Part 4 — SCAFFOLD ONLY. Part 6 fills in the inputs +
 * relationship-to-occupancy selector + lighting-specific schedule editor.
 */

import { useContext } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'

export default function LightingSection() {
  const { params } = useContext(ProjectContext)
  const lighting = params?.gains?.lighting

  return (
    <div className="space-y-2 text-caption text-mid-grey">
      <div className="px-2 py-1.5 bg-off-white border border-light-grey/60 rounded text-xxs">
        <div className="font-mono text-mid-grey">
          {lighting?.magnitude
            ? `${lighting.magnitude.value} ${lighting.magnitude.unit.replace('_', '/').replace('per', '/')}`
            : '— (not configured)'}
        </div>
        <div className="text-mid-grey/80 mt-0.5">
          {lighting?.relationship_to_occupancy
            ? `Relationship: ${lighting.relationship_to_occupancy.replace(/_/g, ' ')}`
            : '— relationship not set'}
        </div>
      </div>
      <p className="text-xxs italic text-mid-grey/70 px-1">
        LPD magnitude, relationship-to-occupancy selector, daylight
        factor, and the lighting schedule editor land in Part 6.
      </p>
    </div>
  )
}
