/**
 * EquipmentSection.jsx — Internal Gains module, EQUIPMENT block.
 *
 * Brief 27 Revised Part 7 — schedule editor moved to centre canvas.
 * Multi-profile data model + UI lands in Parts 9/10.
 */

import { useContext } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import MiniProfile from './MiniProfile.jsx'
import { GAIN_COLOURS } from './gainColours.js'

export default function EquipmentSection({ annual, onEditSchedule }) {
  const { params } = useContext(ProjectContext)
  const equipment = params?.gains?.equipment
  // v2.4: read profiles[0] as the "active" one until Part 10 wires
  // multi-profile selection. The canvas Schedule tab also edits
  // profiles[0]'s schedule.
  const activeProfile = equipment?.profiles?.[0] ?? null
  const profileCount = equipment?.profiles?.length ?? 0
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
        {activeProfile ? (
          <>
            <div className="font-mono text-mid-grey">
              {activeProfile.label ?? 'Profile 1'} —{' '}
              {activeProfile.baseload && activeProfile.active
                ? `${activeProfile.baseload.value} base + ${activeProfile.active.value} active ${activeProfile.baseload.unit.replace('w_per_m2', 'W/m²').replace('w_per_room', 'W/room').replace('total_w', 'W total')}`
                : 'no magnitudes'}
              {profileCount > 1 && (
                <span className="ml-1 text-mid-grey/70">(+{profileCount - 1} more)</span>
              )}
            </div>
            <div className="text-mid-grey/80 mt-0.5">
              {activeProfile.relationship_to_occupancy
                ? `Active: ${activeProfile.relationship_to_occupancy.replace(/_/g, ' ')} · standby ${((activeProfile.standby_factor ?? 0.1) * 100).toFixed(0)}% · ${Math.round((activeProfile.area_share ?? 1) * 100)}% of GIA`
                : '— relationship not set'}
            </div>
          </>
        ) : (
          <div className="font-mono text-mid-grey">— (no profiles configured)</div>
        )}
      </div>

      <MiniProfile
        schedule={activeProfile?.schedule}
        accent={GAIN_COLOURS.equipment}
        onEdit={onEditSchedule}
        label={profileCount > 1 ? 'Profile 1 weekday' : 'Weekday schedule'}
      />

      <p className="text-xxs italic text-mid-grey/70 px-1">
        Multi-profile selector + editable baseload / active / area share
        / standby + per-profile schedules land in Brief 27 Revised Part 10.
        For now the canvas Schedule tab edits Profile 1's schedule.
      </p>
    </div>
  )
}
