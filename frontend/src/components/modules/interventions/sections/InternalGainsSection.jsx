/**
 * InternalGainsSection.jsx — Brief 46 Part 3 (2026-05-22)
 *
 * Editor-pane composer for the Internal Gains section. Dispatches by
 * active subsection to the same OccupancySection / LightingSection /
 * EquipmentSection components that the main `/gains` page renders in
 * its left column — Brief 46 Principle 3 (two contexts, one
 * implementation).
 *
 * Subsection map (matches EditorNav `gains.*` ids):
 *   gains.occupancy → OccupancySection
 *   gains.lighting  → LightingSection
 *   gains.equipment → EquipmentSection
 *
 * `annual` is passed as `null` because the live engine-derived gain
 * readout at the top of each section (Annual / Per m² / Peak / etc.)
 * isn't yet wired to the editor's preview engine result. The sections
 * degrade gracefully — when `annual` is null, the readout shows "—".
 * Chris's walkthrough at Part 6 may identify whether wiring the
 * preview engine through here is worth the perf cost; if so, it's a
 * one-line change to pass `liveResult?.annual` from the editor shell.
 *
 * `onEditSchedule` is a no-op for now — per Brief 46 Part 1 Q1
 * directive, the schedule sub-popout (so the editor can host the
 * schedule editor without z-index conflicts) is deferred. Schedules
 * remain editable on the main `/gains` and `/operation` pages; the
 * intervention captures the gains block as a patch when any
 * non-schedule input is edited.
 *
 * Lighting + Equipment sections additionally need `activeProfileId` /
 * `onSelectProfile` for the multi-profile UI; we own that state at
 * this composer level since each subsection mount is independent.
 */

import { useState } from 'react'
import OccupancySection from '../../gains/OccupancySection.jsx'
import LightingSection  from '../../gains/LightingSection.jsx'
import EquipmentSection from '../../gains/EquipmentSection.jsx'
import { useEditorChrome } from '../EditorChromeContext.jsx'

const SUBSECTION_LABELS = {
  'gains.occupancy': 'Occupancy',
  'gains.lighting':  'Lighting',
  'gains.equipment': 'Equipment',
}

function SectionFrame({ active, accent = '#F97316', children }) {
  const label = SUBSECTION_LABELS[active] ?? active
  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-light-grey">
        <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: accent }} />
        <h3 className="text-caption font-semibold text-navy">Internal Gains · {label}</h3>
      </div>
      {children}
    </div>
  )
}

export default function InternalGainsSection({ active }) {
  // Profile selection for the multi-profile UI on Lighting / Equipment.
  const [activeLightingProfileId,  setActiveLightingProfileId]  = useState(null)
  const [activeEquipmentProfileId, setActiveEquipmentProfileId] = useState(null)

  // Brief 46 Part 6 fix: wire onEditSchedule to the editor's chrome
  // context. OccupancySection edits the embedded params.occupancy.
  // schedule; Lighting/Equipment edit the active profile's embedded
  // schedule on params.gains.<category>.profiles[idx].schedule.
  const chrome = useEditorChrome()

  if (active === 'gains.occupancy') {
    return (
      <SectionFrame active={active}>
        <OccupancySection annual={null} onEditSchedule={chrome.openOccupancyScheduleEditor} />
      </SectionFrame>
    )
  }
  if (active === 'gains.lighting') {
    return (
      <SectionFrame active={active}>
        <LightingSection
          annual={null}
          onEditSchedule={() => {
            // Resolve the selected profile index from its id. Default
            // to 0 if nothing selected (most projects have a single
            // lighting profile).
            // Note: section will resolve activeProfileId to an index
            // when it calls onEditSchedule; we mirror that lookup here.
            chrome.openGainsProfileScheduleEditor('lighting', 0)
          }}
          activeProfileId={activeLightingProfileId}
          onSelectProfile={setActiveLightingProfileId}
        />
      </SectionFrame>
    )
  }
  if (active === 'gains.equipment') {
    return (
      <SectionFrame active={active}>
        <EquipmentSection
          annual={null}
          onEditSchedule={() => chrome.openGainsProfileScheduleEditor('equipment', 0)}
          activeProfileId={activeEquipmentProfileId}
          onSelectProfile={setActiveEquipmentProfileId}
        />
      </SectionFrame>
    )
  }
  return (
    <div className="p-4">
      <div className="rounded border border-dashed border-light-grey bg-off-white/30 p-6 text-center">
        <p className="text-caption font-medium text-navy mb-1">Not yet wired</p>
        <p className="text-xxs text-mid-grey">
          This Internal Gains subsection will appear here in a later step.
        </p>
      </div>
    </div>
  )
}
