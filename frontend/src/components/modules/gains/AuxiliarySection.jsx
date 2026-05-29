/**
 * AuxiliarySection.jsx — Internal Gains module, AUXILIARY block.
 *
 * Brief 72 P7 (2026-05-29). Mounts below Equipment per the brief. Modelled
 * on EquipmentSection (no standby_factor, single magnitude rather than
 * baseload/active split). Six-item preset picker via
 * `auxiliaryTemplatesFor` (universal across building types — a pump is a
 * pump). Each profile carries a first-class `gain_fraction` edited
 * inline on the profile panel.
 *
 * Live readout reads `annual.auxiliary` from useAnnualGains (which P5
 * was already producing through engine wiring — useAnnualGains exposes
 * the same per-category shape as lighting/equipment).
 *
 * Empty state: the auxiliary profiles array starts empty for both new
 * and migrated projects (P4). The Add button surfaces the picker; the
 * empty state shows a neutral hint inviting the user to opt in.
 */

import { useContext, useCallback } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { useProjectMutation } from '../../../hooks/useProjectMutation.js'
import MultiProfileList from './MultiProfileList.jsx'
import { auxiliaryTemplatesFor, buildingTypeOf } from '../../../data/loadTypeLibrary.js'
import { GAIN_COLOURS } from './gainColours.js'

const REL_LABELS = {
  proportional:              'proportional',
  proportional_with_spill:   'proportional + spill',
  independent:               'independent',
  always_on:                 'always on',
}

export default function AuxiliarySection({
  annual,
  onEditSchedule,
  activeProfileId,
  onSelectProfile,
}) {
  const { params } = useContext(ProjectContext)
  const { mutate } = useProjectMutation()
  const auxiliary = params?.gains?.auxiliary
  const profiles  = auxiliary?.profiles ?? []
  const buildingType = buildingTypeOf(params)
  const templates = auxiliaryTemplatesFor(buildingType)
  const a = annual?.auxiliary

  const handleProfilesChange = useCallback((nextProfiles) => {
    mutate('building.gains', {
      ...(params?.gains ?? {}),
      auxiliary: { ...(params?.gains?.auxiliary ?? {}), profiles: nextProfiles },
    })
  }, [params, mutate])

  const renderDetail = (profile) => {
    const magStr  = profile.magnitude  ? `${profile.magnitude.value}`  : '?'
    const unit    = profile.magnitude?.unit ?? 'w_per_m2'
    const unitDisp = unit.replace('w_per_m2', 'W/m²').replace('w_per_room', 'W/room').replace('total_w', 'W')
    const gfPct   = Math.round(((profile.gain_fraction ?? 1.0)) * 100)
    return (
      <>
        {magStr} {unitDisp}
        {' · '}{Math.round((profile.area_share ?? 0) * 100)}% area
        {' · '}{gfPct}% heat
        {' · '}{REL_LABELS[profile.relationship_to_occupancy] ?? profile.relationship_to_occupancy ?? '?'}
      </>
    )
  }

  return (
    <div className="space-y-3 text-caption">
      {/* ── Live aggregate readout ─────────────────────────────────────── */}
      <div className="px-2 py-1.5 bg-off-white border-l-2 rounded-r text-xxs tabular-nums"
           style={{ borderLeftColor: GAIN_COLOURS.auxiliary }}>
        <div className="flex justify-between">
          <span className="text-mid-grey">Annual electricity</span>
          <span className="text-navy font-medium">
            {a?.electricity_kwh != null ? `${(a.electricity_kwh / 1000).toFixed(1)} MWh` : '—'}
          </span>
        </div>
        <div className="flex justify-between pl-3">
          <span className="text-mid-grey/80 text-xxs">· of which heat gain</span>
          <span className="text-mid-grey">
            {a?.kwh != null ? `${(a.kwh / 1000).toFixed(1)} MWh` : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-mid-grey">Per m²</span>
          <span className="text-navy font-medium">
            {a?.electricity_kwh != null && annual?.gia_m2
              ? `${(a.electricity_kwh / annual.gia_m2).toFixed(1)} kWh/m²·yr`
              : '—'}
          </span>
        </div>
        <div className="flex justify-between mt-1 pt-1 border-t border-light-grey/40">
          <span className="text-mid-grey">Peak</span>
          <span className="text-navy font-medium">
            {a?.peak_kw != null ? `${a.peak_kw.toFixed(1)} kW` : '—'}
          </span>
        </div>
      </div>

      {/* Empty-state hint — only when no profiles yet. The Add button is
          still surfaced by MultiProfileList; this just gives users a
          mental model when the section first appears. */}
      {profiles.length === 0 && (
        <div className="text-xxs text-mid-grey/70 italic px-2">
          No auxiliary loads. Add one to model external lighting,
          catering, pumps, lifts, or small power.
        </div>
      )}

      {/* ── Profile list ───────────────────────────────────────────────── */}
      <MultiProfileList
        profiles={profiles}
        onProfilesChange={handleProfilesChange}
        activeProfileId={activeProfileId}
        onSelectProfile={onSelectProfile}
        onEditSchedule={onEditSchedule}
        category="auxiliary"
        templates={templates}
        accent={GAIN_COLOURS.auxiliary}
        renderDetail={renderDetail}
        annualPerProfile={a?.profiles ?? []}
        giaM2={annual?.gia_m2}
      />
    </div>
  )
}
