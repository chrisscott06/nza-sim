/**
 * EditorNav.jsx — Brief 46 Part 1 (2026-05-21)
 *
 * Left collapsible nav for the intervention editor pop-out. Mirrors the
 * main-app module structure so the editor uses the same mental model
 * (and the same controls) as the main pages.
 *
 * Sections (top-level, collapsible):
 *   - Building          (Part 2 fills its subsections)
 *   - Internal Gains    (Part 3)
 *   - Operation         (Part 3)
 *   - Systems           (Part 4)
 *
 * Each section has subsections that the user clicks to set the active
 * pane on the right. Click the section header to expand/collapse the
 * subsection list.
 *
 * Active selection state lives in the parent (`InterventionEditorPopout`)
 * via `active` and `onActiveChange` props. `active` is a string like
 * `'building.fabric'` or `'systems.heating'`. The parent renders the
 * matching section's component in the right pane.
 *
 * Patch-presence badges: a small dot next to each section / subsection
 * indicates the section has at least one patch captured. The dot reads
 * from `patchPaths` — a Set of patch path strings — so the parent can
 * compute this from `currentPatches` once and pass it down.
 *
 * Brief 46 Part 1 ships the static structure with placeholder
 * subsections. Parts 2-4 may refine the subsection list to match each
 * module's actual control groups.
 */

import { ChevronDown, ChevronRight, Layers } from 'lucide-react'
import { useState } from 'react'

// Section definitions. Each subsection's `id` is the value passed to
// `onActiveChange` and matched in the parent's renderer.
const SECTIONS = [
  {
    id: 'building',
    label: 'Building',
    accent: '#0EA5E9',   // sky blue (matches main app Building accent)
    subsections: [
      { id: 'building.air_permeability', label: 'Air permeability' },
      { id: 'building.orientation',      label: 'Orientation' },
      { id: 'building.glazing',          label: 'Glazing ratios' },
      { id: 'building.fabric',           label: 'Fabric (constructions)' },
      { id: 'building.shading',          label: 'Shading' },
    ],
  },
  {
    id: 'gains',
    label: 'Internal Gains',
    accent: '#F97316',   // orange (Flame icon family)
    subsections: [
      { id: 'gains.occupancy', label: 'Occupancy' },
      { id: 'gains.lighting',  label: 'Lighting' },
      { id: 'gains.equipment', label: 'Equipment' },
    ],
  },
  {
    id: 'operation',
    label: 'Operation',
    accent: '#10B981',   // teal (Wind icon family)
    subsections: [
      { id: 'operation.openings',          label: 'Operable openings' },
      { id: 'operation.thresholds',        label: 'Control thresholds' },
      { id: 'operation.permanent_vent',    label: 'Permanent vent flow' },
    ],
  },
  {
    id: 'systems',
    label: 'Systems',
    accent: '#DC2626',   // red (Thermometer icon family)
    subsections: [
      { id: 'systems.heating',     label: 'Heating' },
      { id: 'systems.cooling',     label: 'Cooling' },
      { id: 'systems.dhw',         label: 'DHW' },
      { id: 'systems.ventilation', label: 'Ventilation' },
      { id: 'systems.lighting',    label: 'Lighting (electrical)' },
      { id: 'systems.small_power', label: 'Small power' },
    ],
  },
]

/**
 * Brief 47 Part 2.3 (2026-05-24): nav-level patch flags.
 *
 * `patchOwnerSection(path)` returns the EditorNav section id that owns
 * this patch path — `building` / `gains` / `operation` / `systems` — or
 * null if no owner.
 *
 * `patchOwnerSubsection(path)` returns the subsection id within the
 * owner section, or null if the path is too coarse to attribute (the
 * change list still surfaces these — the nav-flag heuristic is best-
 * effort).
 *
 * Brief 46 (Parts 2c-4) captured most edits as WHOLE-OBJECT/ARRAY
 * snapshots — `building.fabric`, `building.occupancy`, `building.gains`,
 * `building.systems_config_v40`, `building.operable_openings`,
 * `building.schedules` — so the matcher routes those whole-snapshot
 * paths to the appropriate subsection (e.g. `building.fabric` ⇒
 * `building.air_permeability`, since AirtightnessSection captures
 * fabric.air_permeability_q50 by replacing the whole fabric object).
 *
 * The previous Brief 46 matcher used substring heuristics that broke
 * for these whole-snapshot paths (e.g. `'building.fabric'.includes(
 * 'q50')` = false). Replaced here with explicit prefix/equality rules.
 */
function patchOwnerSection(path) {
  if (typeof path !== 'string') return null
  // Internal Gains-owned paths
  if (path === 'building.occupancy' || path.startsWith('building.occupancy.')) return 'gains'
  if (path === 'building.gains'     || path.startsWith('building.gains.'))     return 'gains'
  // Operation-owned paths
  if (path === 'building.operable_openings' || path.startsWith('building.operable_openings.')) return 'operation'
  // Systems-owned paths
  if (path === 'building.systems_config_v40' || path.startsWith('building.systems_config_v40.')) return 'systems'
  // Schedules: attributed to gains (occupancy/lighting/equipment use
  // schedules) but Operation + Systems also reference schedule_refs;
  // the change list disambiguates by content.
  if (path === 'building.schedules' || path.startsWith('building.schedules.')) return 'gains'
  // Building-owned (catch-all): everything else under building.* + the
  // constructions slice + comfort_band (lives in the Building section
  // even though its capture path is top-level).
  if (path.startsWith('building.'))      return 'building'
  if (path === 'constructions'           || path.startsWith('constructions.')) return 'building'
  if (path === 'comfort_band'            || path.startsWith('comfort_band.'))  return 'building'
  return null
}

function patchOwnerSubsection(path) {
  if (typeof path !== 'string') return null
  // Building subsections
  if (path === 'building.fabric' || path.startsWith('building.fabric.')) return 'building.air_permeability'  // q50 lives in fabric
  if (path === 'constructions'   || path.startsWith('constructions.'))   return 'building.fabric'
  if (path.startsWith('building.wwr')          || path.startsWith('building.window_count')) return 'building.glazing'
  if (path.startsWith('building.shading_overhang') || path.startsWith('building.shading_fin')) return 'building.shading'
  if (path === 'building.orientation'  || path.startsWith('building.orientation.'))  return 'building.orientation'
  if (path === 'building.length' || path === 'building.width' || path === 'building.num_floors' ||
      path === 'building.floor_height' || path === 'building.name') return 'building.orientation'
  // openings.* (permanent vents — Building) maps loosely; defer attribution
  // since the EditorNav's Building section doesn't expose Permanent
  // openings as a sub-item (yet). Section-level dot still fires via
  // patchOwnerSection.
  if (path.startsWith('building.openings')) return null
  // Internal Gains subsections
  if (path === 'building.occupancy' || path.startsWith('building.occupancy.')) return 'gains.occupancy'
  if (path.startsWith('building.gains.lighting'))  return 'gains.lighting'
  if (path.startsWith('building.gains.equipment')) return 'gains.equipment'
  // Whole-gains snapshot — can't disambiguate; default to lighting (more common edit).
  if (path === 'building.gains') return 'gains.lighting'
  // Schedules whole-snapshot — best-effort to occupancy.
  if (path === 'building.schedules' || path.startsWith('building.schedules.')) return 'gains.occupancy'
  // Operation subsections
  if (path === 'building.operable_openings' || path.startsWith('building.operable_openings.')) return 'operation.openings'
  // Systems subsections — service-keyed
  if (path.startsWith('building.systems_config_v40.heating'))     return 'systems.heating'
  if (path.startsWith('building.systems_config_v40.cooling'))     return 'systems.cooling'
  if (path.startsWith('building.systems_config_v40.dhw'))         return 'systems.dhw'
  if (path.startsWith('building.systems_config_v40.ventilation')) return 'systems.ventilation'
  if (path.startsWith('building.systems_config_v40.lighting'))    return 'systems.lighting'
  if (path.startsWith('building.systems_config_v40.small_power')) return 'systems.small_power'
  // Whole-systems_config_v40 snapshot — can't disambiguate; default heating.
  if (path === 'building.systems_config_v40') return 'systems.heating'
  return null
}

function patchMatchesSection(patchPath, sectionId) {
  return patchOwnerSection(patchPath) === sectionId
}

function patchMatchesSubsection(patchPath, subId) {
  return patchOwnerSubsection(patchPath) === subId
}

function SectionPatchDot({ active, accent }) {
  if (!active) return null
  return (
    <span
      className="block w-1.5 h-1.5 rounded-full ml-auto flex-shrink-0"
      style={{ backgroundColor: accent }}
      title="This section has captured patches"
    />
  )
}

function Section({ section, active, onActiveChange, currentPatches, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const hasSectionPatches = currentPatches.some(p => patchMatchesSection(p.path, section.id))

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-xxs font-medium text-navy hover:bg-off-white/60 transition-colors"
      >
        {open ? <ChevronDown size={11} className="text-mid-grey flex-shrink-0" /> : <ChevronRight size={11} className="text-mid-grey flex-shrink-0" />}
        <span
          className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: section.accent }}
        />
        <span className="flex-1 text-left">{section.label}</span>
        <SectionPatchDot active={hasSectionPatches} accent={section.accent} />
      </button>
      {open && (
        <div className="flex flex-col pl-5 mt-0.5">
          {section.subsections.map(sub => {
            const isActive = active === sub.id
            const hasSubPatches = currentPatches.some(p => patchMatchesSubsection(p.path, sub.id))
            return (
              <button
                key={sub.id}
                type="button"
                onClick={() => onActiveChange?.(sub.id)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xxs transition-colors text-left ${
                  isActive
                    ? 'bg-off-white text-navy font-medium'
                    : 'text-mid-grey hover:text-navy hover:bg-off-white/50'
                }`}
              >
                <span className="flex-1 truncate">{sub.label}</span>
                {hasSubPatches && (
                  <span
                    className="block w-1 h-1 rounded-full flex-shrink-0"
                    style={{ backgroundColor: section.accent }}
                    title="Patches captured in this subsection"
                  />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function EditorNav({ active, onActiveChange, currentPatches = [] }) {
  return (
    <nav className="w-56 flex-shrink-0 border-r border-light-grey bg-off-white/30 overflow-y-auto">
      <div className="px-2 py-3 border-b border-light-grey">
        <p className="text-xxs uppercase tracking-wider text-mid-grey font-medium flex items-center gap-1.5">
          <Layers size={11} />
          Edit sections
        </p>
        <p className="text-xxs text-mid-grey/70 mt-0.5 leading-tight">
          Change any input that exists in the main app. Each edit is captured as a patch.
        </p>
      </div>
      <div className="p-1 space-y-0.5">
        {SECTIONS.map((s, i) => (
          <Section
            key={s.id}
            section={s}
            active={active}
            onActiveChange={onActiveChange}
            currentPatches={currentPatches}
            defaultOpen={i === 0}
          />
        ))}
      </div>
    </nav>
  )
}

// Export the SECTIONS array so the parent can resolve a sub id → label
// for the right pane header without duplicating the structure.
export { SECTIONS }
