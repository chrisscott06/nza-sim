/**
 * LightingSection.jsx — Internal Gains module, LIGHTING block.
 *
 * Brief 27 Revised Part 7 — schedule editor moved to centre canvas.
 * This section keeps:
 *   - Live readout (annual MWh / peak kW / effective LPD)
 *   - Magnitude + relationship + daylight inputs (placeholder until
 *     Brief 27 Revised Part 10 introduces the profile list)
 *   - Read-only MiniProfile of the lighting schedule
 *   - "Edit schedule →" link that activates the centre-canvas Schedule
 *     tab on this section
 *
 * v2.4 multi-profile data model arrives in Part 9 + UI in Part 10. For now
 * this section still operates on the v2.3 single-quantity shape; reads
 * `params.gains.lighting.schedule` for the MiniProfile (preset migration
 * filled this in for every project).
 */

import { useContext } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import MiniProfile from './MiniProfile.jsx'
import { GAIN_COLOURS } from './gainColours.js'

export default function LightingSection({ annual, onEditSchedule }) {
  const { params } = useContext(ProjectContext)
  const lighting = params?.gains?.lighting
  // v2.4: read the first profile as the "active" one until Part 10 wires
  // a real profile selector. profiles[0] is what the canvas Schedule tab
  // edits in this same arrangement, so the MiniProfile + readout stay
  // consistent with what gets authored.
  const activeProfile = lighting?.profiles?.[0] ?? null
  const profileCount = lighting?.profiles?.length ?? 0
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
        {activeProfile ? (
          <>
            <div className="font-mono text-mid-grey">
              {activeProfile.label ?? 'Profile 1'} —{' '}
              {activeProfile.magnitude
                ? `${activeProfile.magnitude.value} ${activeProfile.magnitude.unit.replace('w_per_m2', 'W/m²').replace('w_per_room', 'W/room').replace('total_w', 'W total')}`
                : 'no magnitude'}
              {profileCount > 1 && (
                <span className="ml-1 text-mid-grey/70">(+{profileCount - 1} more)</span>
              )}
            </div>
            <div className="text-mid-grey/80 mt-0.5">
              {activeProfile.relationship_to_occupancy
                ? `${activeProfile.relationship_to_occupancy.replace(/_/g, ' ')} · ${Math.round((activeProfile.area_share ?? 1) * 100)}% of GIA`
                : '— relationship not set'}
            </div>
          </>
        ) : (
          <div className="font-mono text-mid-grey">— (no profiles configured)</div>
        )}
      </div>

      {/* Read-only mini-profile (profile 0's schedule) + Edit-schedule link */}
      <MiniProfile
        schedule={activeProfile?.schedule}
        accent={GAIN_COLOURS.lighting}
        onEdit={onEditSchedule}
        label={profileCount > 1 ? 'Profile 1 weekday' : 'Weekday schedule'}
      />

      <p className="text-xxs italic text-mid-grey/70 px-1">
        Multi-profile selector + editable LPD / relationship / area share
        + per-profile preview land in Brief 27 Revised Part 10. For now
        the canvas Schedule tab edits Profile 1's schedule.
      </p>
    </div>
  )
}
