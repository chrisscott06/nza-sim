/**
 * BuildingSection.jsx — Brief 46 Part 2c (2026-05-22)
 *
 * Right-pane composer for the editor's Building section. Dispatches to
 * the same self-contained named exports that the main Building module
 * mounts in its left column — `building/buildingSections.jsx`. The
 * controls render identical inputs whether mounted here (in capture
 * mode via `InterventionCaptureProvider`) or in the main app (writing
 * through ProjectContext).
 *
 * Subsection map (matches EditorNav `building.*` ids):
 *   building.orientation      → GeometrySection
 *   building.glazing          → GlazingSection
 *   building.shading          → ShadingSection
 *   building.air_permeability → AirtightnessSection
 *   building.fabric           → FabricSection (needs constructions library)
 *
 * The Openings + Comfort band + Thermal bridges sections aren't yet
 * surfaced in the editor nav (Brief 46 Parts 3 / 4 / 5 will resolve
 * whether they live under Building or Operation per Brief 33's scope
 * statement). For now, the unmapped subsection ids land on the
 * fall-through "not yet wired" placeholder.
 *
 * The Fabric subsection needs a constructions library to populate the
 * picker. We fetch it once per composer instance — a separate fetch
 * from the main `/building` page's load, because the editor opens
 * over a different route. Cheap enough; if it shows up in perf
 * traces, Part 5 can hoist this to `InterventionEditorV2` and pass
 * down as a prop.
 */

import { useEffect, useState } from 'react'
import {
  GeometrySection,
  GlazingSection,
  ShadingSection,
  OpeningsSection,
  FabricSection,
  AirtightnessSection,
  ComfortBandSection,
} from '../../building/buildingSections.jsx'

const SUBSECTION_LABELS = {
  'building.air_permeability': 'Air permeability',
  'building.orientation':      'Orientation',
  'building.glazing':          'Glazing ratios',
  'building.fabric':           'Fabric (constructions)',
  'building.shading':          'Shading',
}

function NotWired({ active }) {
  const label = SUBSECTION_LABELS[active] ?? active
  return (
    <div className="p-4">
      <div className="flex items-center gap-2 pb-2 border-b border-light-grey">
        <span className="inline-block w-2 h-2 rounded-full bg-sky-500" />
        <h3 className="text-caption font-semibold text-navy">Building · {label}</h3>
      </div>
      <div className="mt-3 rounded border border-dashed border-light-grey bg-off-white/30 p-6 text-center">
        <p className="text-caption font-medium text-navy mb-1">Not yet wired</p>
        <p className="text-xxs text-mid-grey">
          The Building · {label} controls will appear here in a later step.
        </p>
      </div>
    </div>
  )
}

export default function BuildingSection({ active }) {
  // Library fetch for the Fabric subsection's construction picker.
  // Only fires when the user opens the Fabric subsection — the other
  // subsections don't need it.
  const [library, setLibrary] = useState([])
  const needsLibrary = active === 'building.fabric'
  useEffect(() => {
    if (!needsLibrary) return
    let cancelled = false
    fetch('/api/library/constructions')
      .then(r => r.ok ? r.json() : { constructions: [] })
      .then(d => { if (!cancelled) setLibrary(d.constructions ?? []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [needsLibrary])

  return (
    <div className="p-3 space-y-0">
      {active === 'building.orientation'      && <GeometrySection   defaultOpen />}
      {active === 'building.glazing'          && <GlazingSection    defaultOpen />}
      {active === 'building.shading'          && <ShadingSection    defaultOpen />}
      {active === 'building.air_permeability' && <AirtightnessSection defaultOpen />}
      {active === 'building.fabric'           && (
        <FabricSection library={library} onInspectConstruction={() => {}} defaultOpen />
      )}
      {/* Subsections not in EditorNav yet — show placeholder so the user
          isn't surprised when a future nav addition lands here */}
      {!SUBSECTION_LABELS[active] && <NotWired active={active} />}
    </div>
  )
}
