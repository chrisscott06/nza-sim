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
 * Check whether a patch path falls under a section / subsection id.
 *
 * The id-to-patch-prefix mapping is conventional:
 *   building.air_permeability → 'building.q50' OR 'building.air_permeability'
 *   building.fabric           → 'constructions.*'
 *   gains.occupancy           → 'building.internal_gains.occupancy.*'
 *   operation.openings        → 'building.openings.*' OR 'building.natural_ventilation.*'
 *   systems.heating           → 'building.systems_config_v40.heating.*'
 *
 * Parts 2-4 may tighten these prefixes as the section composers land.
 * Part 1 just uses the leading path token for a coarse-grained match —
 * good enough for the patch-presence dots.
 */
function patchMatchesSection(patchPath, sectionId) {
  if (typeof patchPath !== 'string') return false
  if (sectionId === 'building') return patchPath.startsWith('building.') || patchPath.startsWith('constructions.')
  if (sectionId === 'gains')    return patchPath.includes('internal_gains') || patchPath.includes('schedules.')
  if (sectionId === 'operation') return patchPath.includes('openings') || patchPath.includes('natural_ventilation') || patchPath.includes('permanent_vent')
  if (sectionId === 'systems')  return patchPath.includes('systems_config_v40') || patchPath.includes('systems.')
  return false
}

function patchMatchesSubsection(patchPath, subId) {
  if (typeof patchPath !== 'string') return false
  // Subsection ids encode the path prefix in a coarse-grained way.
  // E.g. 'systems.heating' → matches paths containing 'systems_config_v40.heating'.
  if (subId.startsWith('systems.')) {
    const service = subId.slice('systems.'.length)
    return patchPath.includes(`systems_config_v40.${service}`)
  }
  if (subId === 'building.fabric') return patchPath.startsWith('constructions.')
  if (subId === 'building.air_permeability') return patchPath.includes('q50') || patchPath.includes('air_permeability')
  if (subId === 'building.orientation') return patchPath.endsWith('.orientation') || patchPath.includes('building.orientation')
  if (subId === 'building.glazing') return patchPath.includes('wwr') || patchPath.includes('glazing_ratio')
  if (subId === 'building.shading') return patchPath.includes('overhang') || patchPath.includes('shading')
  if (subId === 'gains.occupancy') return patchPath.includes('occupancy') || (patchPath.includes('schedules.') && patchPath.includes('occ'))
  if (subId === 'gains.lighting') return patchPath.includes('lighting') && !patchPath.includes('systems_config_v40')
  if (subId === 'gains.equipment') return patchPath.includes('equipment')
  if (subId === 'operation.openings') return patchPath.includes('natural_ventilation') || (patchPath.includes('openings') && !patchPath.includes('permanent'))
  if (subId === 'operation.thresholds') return patchPath.includes('threshold')
  if (subId === 'operation.permanent_vent') return patchPath.includes('permanent_vent') || patchPath.includes('openings.cd')
  return false
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
