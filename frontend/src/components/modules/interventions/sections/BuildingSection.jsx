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

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-light-grey">
        <span className="inline-block w-2 h-2 rounded-full bg-sky-500" />
        <h3 className="text-caption font-semibold text-navy">Building · {label}</h3>
      </div>

      <div className="rounded border border-dashed border-light-grey bg-off-white/30 p-4 space-y-2">
        <p className="text-xxs text-mid-grey">
          <strong className="text-navy">Brief 46 Part 2b scaffold.</strong> This composer renders the editor's right pane for the Building section. The five subsections (Air permeability, Orientation, Glazing ratios, Fabric, Shading) currently live inline in <code className="text-xxs">BuildingDefinition.jsx</code>'s <code className="text-xxs">InputsColumn</code> function — Brief 46 Part 2c extracts them as self-contained named exports in <code className="text-xxs">building/buildingSections.jsx</code> per Chris's Option A directive.
        </p>
        <p className="text-xxs text-mid-grey">
          The Part 2a refactor (commit <code className="text-xxs">34c5c3c</code>) already wired the 33 Building mutation entry points through <code className="text-xxs">useProjectMutation</code>. When the extracted subsections mount inside this composer, their mutations route through the capture context automatically — the editor and the main app share the same control implementations, exactly as Brief 46 Principle 3 calls for.
        </p>
        <p className="text-xxs text-mid-grey/70 italic">
          Active subsection: <code className="text-xxs not-italic">{active}</code>
        </p>
      </div>
    </div>
  )
}
