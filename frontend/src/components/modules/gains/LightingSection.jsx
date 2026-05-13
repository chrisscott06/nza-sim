/**
 * LightingSection.jsx — Internal Gains module, LIGHTING block.
 *
 * Brief 27 Revised Part 10. v2.4 multi-profile UI. Reads/writes
 * `params.gains.lighting.profiles[]`. Each profile carries its own
 * magnitude, relationship_to_occupancy, area_share, and schedule.
 *
 * Active profile selection is module-level state (lifted to
 * InternalGainsModule) so it persists across tab switches and so the
 * centre canvas Schedule tab knows which profile to edit.
 */

import { useContext, useCallback } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import MultiProfileList from './MultiProfileList.jsx'
import { lightingTemplatesFor, buildingTypeOf } from '../../../data/loadTypeLibrary.js'
import { GAIN_COLOURS } from './gainColours.js'

const REL_LABELS = {
  proportional_with_spill: 'prop + spill',
  proportional:            'proportional',
  independent:             'independent',
  always_on:               'always on',
}

export default function LightingSection({
  annual,
  onEditSchedule,
  activeProfileId,
  onSelectProfile,
}) {
  const { params, updateParam } = useContext(ProjectContext)
  const lighting = params?.gains?.lighting
  const profiles = lighting?.profiles ?? []
  const buildingType = buildingTypeOf(params)
  const templates = lightingTemplatesFor(buildingType)
  const l = annual?.lighting

  const handleProfilesChange = useCallback((nextProfiles) => {
    updateParam('gains', {
      ...(params?.gains ?? {}),
      lighting: { ...(params?.gains?.lighting ?? {}), profiles: nextProfiles },
    })
  }, [params, updateParam])

  const renderDetail = (profile) => {
    const mag = profile.magnitude
    return (
      <>
        {mag ? `${mag.value} ${mag.unit.replace('w_per_m2', 'W/m²').replace('w_per_room', 'W/room').replace('total_w', 'W')}` : '— LPD'}
        {' · '}{Math.round((profile.area_share ?? 0) * 100)}% area
        {' · '}{REL_LABELS[profile.relationship_to_occupancy] ?? profile.relationship_to_occupancy ?? '?'}
      </>
    )
  }

  return (
    <div className="space-y-3 text-caption">
      {/* ── Live aggregate readout ─────────────────────────────────────── */}
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

      {/* ── Profile list ───────────────────────────────────────────────── */}
      <MultiProfileList
        profiles={profiles}
        onProfilesChange={handleProfilesChange}
        activeProfileId={activeProfileId}
        onSelectProfile={onSelectProfile}
        onEditSchedule={onEditSchedule}
        category="lighting"
        templates={templates}
        accent={GAIN_COLOURS.lighting}
        renderDetail={renderDetail}
        annualPerProfile={l?.profiles ?? []}
      />
    </div>
  )
}
