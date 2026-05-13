/**
 * EquipmentSection.jsx — Internal Gains module, EQUIPMENT block.
 *
 * Brief 27 Revised Part 10. Multi-profile equivalent of LightingSection,
 * splitting each profile into baseload + active per the v2.4 contract.
 */

import { useContext, useCallback } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import MultiProfileList from './MultiProfileList.jsx'
import { equipmentTemplatesFor, buildingTypeOf } from '../../../data/loadTypeLibrary.js'
import { GAIN_COLOURS } from './gainColours.js'

const REL_LABELS = {
  proportional: 'proportional',
  independent:  'independent',
  always_on:    'always on',
}

export default function EquipmentSection({
  annual,
  onEditSchedule,
  activeProfileId,
  onSelectProfile,
}) {
  const { params, updateParam } = useContext(ProjectContext)
  const equipment = params?.gains?.equipment
  const profiles = equipment?.profiles ?? []
  const buildingType = buildingTypeOf(params)
  const templates = equipmentTemplatesFor(buildingType)
  const e = annual?.equipment

  const handleProfilesChange = useCallback((nextProfiles) => {
    updateParam('gains', {
      ...(params?.gains ?? {}),
      equipment: { ...(params?.gains?.equipment ?? {}), profiles: nextProfiles },
    })
  }, [params, updateParam])

  const renderDetail = (profile) => {
    const baseStr = profile.baseload  ? `${profile.baseload.value}`  : '?'
    const actStr  = profile.active    ? `${profile.active.value}`    : '?'
    const unit    = profile.baseload?.unit ?? profile.active?.unit ?? 'w_per_m2'
    const unitDisp = unit.replace('w_per_m2', 'W/m²').replace('w_per_room', 'W/room').replace('total_w', 'W')
    return (
      <>
        {baseStr} base + {actStr} active {unitDisp}
        {' · '}{Math.round((profile.area_share ?? 0) * 100)}% area
        {' · '}{REL_LABELS[profile.relationship_to_occupancy] ?? profile.relationship_to_occupancy ?? '?'}
      </>
    )
  }

  return (
    <div className="space-y-3 text-caption">
      {/* ── Live aggregate readout ─────────────────────────────────────── */}
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

      {/* ── Profile list ───────────────────────────────────────────────── */}
      <MultiProfileList
        profiles={profiles}
        onProfilesChange={handleProfilesChange}
        activeProfileId={activeProfileId}
        onSelectProfile={onSelectProfile}
        onEditSchedule={onEditSchedule}
        category="equipment"
        templates={templates}
        accent={GAIN_COLOURS.equipment}
        renderDetail={renderDetail}
        annualPerProfile={e?.profiles ?? []}
      />
    </div>
  )
}
