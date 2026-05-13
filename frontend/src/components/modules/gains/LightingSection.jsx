/**
 * LightingSection.jsx — left-panel input section for the Internal Gains
 * module's LIGHTING block.
 *
 * Brief 27 Part 4 — SCAFFOLD with live input-side readout (annual / peak)
 * driven by `useAnnualGains`. Part 6 fills in the editable inputs +
 * relationship-to-occupancy selector + lighting schedule editor.
 */

import { useContext } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { GAIN_COLOURS } from './gainColours.js'

export default function LightingSection({ annual }) {
  const { params } = useContext(ProjectContext)
  const lighting = params?.gains?.lighting
  const l = annual?.lighting

  return (
    <div className="space-y-2 text-caption text-mid-grey">
      <div className="px-2 py-1.5 bg-off-white border-l-2 rounded-r text-xxs tabular-nums"
           style={{ borderLeftColor: GAIN_COLOURS.lighting }}>
        <div className="flex justify-between">
          <span className="text-mid-grey">Annual</span>
          <span className="text-navy font-medium">
            {l?.kwh != null ? `${(l.kwh / 1000).toFixed(1)} MWh` : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-mid-grey">Peak</span>
          <span className="text-navy font-medium">
            {l?.peak_kw != null ? `${l.peak_kw.toFixed(1)} kW` : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-mid-grey">Effective LPD</span>
          <span className="text-navy font-medium">
            {l?.effective_lpd_w_per_m2 != null && annual?.ready
              ? `${l.effective_lpd_w_per_m2.toFixed(2)} W/m²`
              : '—'}
          </span>
        </div>
      </div>

      <div className="px-2 py-1.5 bg-white border border-light-grey/60 rounded text-xxs">
        <div className="font-mono text-mid-grey">
          {lighting?.magnitude
            ? `${lighting.magnitude.value} ${lighting.magnitude.unit.replace('w_per_m2', 'W/m²').replace('w_per_room', 'W/room').replace('total_w', 'W total')}`
            : '— (not configured)'}
        </div>
        <div className="text-mid-grey/80 mt-0.5">
          {lighting?.relationship_to_occupancy
            ? `Relationship: ${lighting.relationship_to_occupancy.replace(/_/g, ' ')}`
            : '— relationship not set'}
        </div>
      </div>

      <p className="text-xxs italic text-mid-grey/70 px-1">
        Editable LPD, relationship-to-occupancy selector, daylight factor,
        and lighting schedule editor land in Part 6.
      </p>
    </div>
  )
}
