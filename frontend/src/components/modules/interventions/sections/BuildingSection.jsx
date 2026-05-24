/**
 * BuildingSection.jsx — Brief 46 Part 2b (2026-05-21)
 *
 * Composer for the Building section of the intervention editor's right
 * pane. Renders the active subsection's component based on the editor
 * nav's `active` prop (e.g. 'building.air_permeability',
 * 'building.fabric', 'building.geometry').
 *
 * Brief 46 Principle 3: reuse main-app input controls inside the
 * capture context — do not build parallel UI.
 *
 * **Part 2b status** (this session): composer scaffold + placeholder
 * subsection content. The Building module's inline subsections (live in
 * `BuildingDefinition.jsx`'s `InputsColumn`) have NOT been extracted
 * yet — they're still inline. Part 2c (next session) does the
 * mechanical extraction into `building/buildingSections.jsx` with
 * named exports (`GeometrySection`, `GlazingSection`, `ShadingSection`,
 * `OpeningsSection`, `FabricSection`, `ComfortBandSection`,
 * `AirtightnessSection`) per Chris's Option A directive at Brief 46
 * Part 2a close.
 *
 * Each extracted section will be self-contained (own state, own
 * labels, own memoisation) — no prop-drilling from `BuildingDefinition`
 * that this composer has to fake. Constraint from Chris's Part 2a
 * review.
 *
 * When Part 2c lands, the placeholder content below is replaced with:
 *
 *   {active === 'building.air_permeability' && <AirtightnessSection />}
 *   {active === 'building.orientation' && <OrientationSection />}
 *   {active === 'building.glazing' && <GlazingSection />}
 *   {active === 'building.fabric' && <FabricSection library={…} />}
 *   {active === 'building.shading' && <ShadingSection />}
 *
 * Each subsection internally uses `useProjectMutation` (refactored in
 * Part 2a); when this composer is rendered inside the editor's capture
 * context, mutations route to patch capture; when rendered on the
 * main Building page, they route to ProjectContext as today.
 */

const SUBSECTION_LABELS = {
  'building.air_permeability': 'Air permeability',
  'building.orientation':      'Orientation',
  'building.glazing':          'Glazing ratios',
  'building.fabric':           'Fabric (constructions)',
  'building.shading':          'Shading',
}

export default function BuildingSection({ active }) {
  const label = SUBSECTION_LABELS[active] ?? active

  // Brief 46 Part 2c-pre (2026-05-22): the five Building subsections
  // (Geometry / Glazing / Shading / Openings / Fabric) currently live
  // inline in BuildingDefinition.jsx's InputsColumn. Brief 46 Part 2c
  // (next session) extracts them as self-contained named exports per
  // Chris's Option A directive — at which point this composer renders
  // the real controls inside the capture context. For now, the right
  // pane shows a clear "not yet wired" placeholder so the new editor
  // shell can be exercised end-to-end without the impression that the
  // subsection content is broken.
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-light-grey">
        <span className="inline-block w-2 h-2 rounded-full bg-sky-500" />
        <h3 className="text-caption font-semibold text-navy">Building · {label}</h3>
      </div>

      <div className="rounded border border-dashed border-light-grey bg-off-white/30 p-6 text-center">
        <p className="text-caption font-medium text-navy mb-1">Not yet wired</p>
        <p className="text-xxs text-mid-grey">
          The Building · {label} controls will appear here in a later step.
        </p>
      </div>
    </div>
  )
}
