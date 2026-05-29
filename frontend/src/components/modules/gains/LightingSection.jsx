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
import { useProjectMutation } from '../../../hooks/useProjectMutation.js'
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
  // Brief 46 Part 3 (2026-05-22): mutations routed through
  // useProjectMutation so this section works both in the main /gains
  // page AND inside the intervention editor's InternalGainsSection.
  // mutate('building.gains', wholeGainsObj) falls through to
  // updateParam('gains', wholeGainsObj) in main-app mode and lands a
  // single-path patch in capture mode.
  const { params } = useContext(ProjectContext)
  const { mutate } = useProjectMutation()
  const lighting = params?.gains?.lighting
  const profiles = lighting?.profiles ?? []
  const buildingType = buildingTypeOf(params)
  const templates = lightingTemplatesFor(buildingType)
  const l = annual?.lighting

  const handleProfilesChange = useCallback((nextProfiles) => {
    mutate('building.gains', {
      ...(params?.gains ?? {}),
      lighting: { ...(params?.gains?.lighting ?? {}), profiles: nextProfiles },
    })
  }, [params, mutate])

  // Brief 72 P8 (2026-05-29): section-level gain_fraction editor. Sets
  // gain_fraction uniformly across all profiles in the section. The
  // display value is the area-share-weighted average of the per-profile
  // values; when profiles disagree the box still shows the average and
  // editing collapses them onto a single value (the brief's UX: one
  // editor per section, not per profile, because lighting/equipment
  // profiles share a category-level gain assumption — auxiliary's
  // per-preset variance lives on its profile panels per P7).
  //
  // Principle 3 (orthogonality): this editor touches gain_fraction only;
  // daylight_factor is per-profile on the panel and stays independent.
  const totalArea = profiles.reduce((s, p) => s + Number(p.area_share ?? 0), 0) || 1
  const weightedGF = profiles.length === 0
    ? 1.0
    : profiles.reduce((s, p) => s + (Number(p.gain_fraction ?? 1.0) * Number(p.area_share ?? 0)), 0) / totalArea
  const gfPctDisplay = Math.round(weightedGF * 100)

  const handleGainFractionChange = useCallback((pct) => {
    const v = Math.max(0, Math.min(1, Number(pct) / 100))
    const nextProfiles = profiles.map(p => ({ ...p, gain_fraction: v }))
    mutate('building.gains', {
      ...(params?.gains ?? {}),
      lighting: { ...(params?.gains?.lighting ?? {}), profiles: nextProfiles },
    })
  }, [profiles, params, mutate])

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
          <span className="text-mid-grey">Per m²</span>
          <span className="text-navy font-medium">
            {l?.kwh != null && annual?.gia_m2 ? `${(l.kwh / annual.gia_m2).toFixed(1)} kWh/m²·yr` : '—'}
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
        {/* Brief 72 P8 (2026-05-29): inline gain_fraction editor on the
            section header. One value applies to all lighting profiles
            (category-level assumption). For per-profile variance, edit
            on the profile panel. Daylight factor stays independent
            per profile. */}
        <div className="flex justify-between mt-1 pt-1 border-t border-light-grey/40 items-center">
          <span className="text-mid-grey">Heat gain</span>
          <span className="flex items-center gap-1">
            <input
              type="number" min={0} max={100} step={5}
              value={gfPctDisplay}
              onChange={e => handleGainFractionChange(e.target.value)}
              className="w-12 px-1 py-0 text-xxs text-navy text-right tabular-nums border border-light-grey rounded focus:outline-none focus:border-mid-grey"
            />
            <span className="text-xxs text-mid-grey">%</span>
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
        giaM2={annual?.gia_m2}
      />
    </div>
  )
}
