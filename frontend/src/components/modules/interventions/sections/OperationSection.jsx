/**
 * OperationSection.jsx — Brief 46 Part 3 (2026-05-22)
 *
 * Editor-pane composer for the Operation section. Renders the same
 * per-opening editor that the main `/operation` page uses (OpeningRow),
 * with Add buttons + facade-chip strip. Mutations route through
 * `useProjectMutation` — capture mode lands a whole-array patch on
 * `building.operable_openings`; main-app mode falls through to
 * `updateParam('operable_openings', …)` (identity-by-construction).
 *
 * Subsection map (matches EditorNav `operation.*` ids):
 *   operation.openings       → list + Add buttons + per-opening editor
 *   operation.thresholds     → "Edit per-opening — coming in a later step"
 *                              placeholder. The per-opening temperature
 *                              thresholds live INSIDE each OpeningRow's
 *                              expanded editor under "Control" — the
 *                              thresholds subsection is redundant once
 *                              the openings list is present. Kept as a
 *                              nav item for discoverability; Brief 46
 *                              Part 5 will decide whether to consolidate
 *                              with operation.openings or surface a
 *                              dedicated "all thresholds at a glance"
 *                              view.
 *   operation.permanent_vent → "Edit in Building → Permanent openings"
 *                              placeholder. Per CLAUDE.md Module scopes,
 *                              permanent vents are Building scope; the
 *                              nav item exists because Brief 46 Part 1's
 *                              SECTIONS array conflates them. Brief 46
 *                              Part 5 will move it under Building or
 *                              drop it.
 *
 * Schedule editor is NOT yet hosted as a nested SchedulePopout from
 * inside this composer — per Brief 46 Part 1 Q1 directive, schedule
 * sub-popout nesting is deferred. `openScheduleEditor` is a no-op
 * here; users can still edit schedules from the main /operation page
 * and the resulting params are reflected in the editor's capture.
 */

import { useContext, useState } from 'react'
import { ProjectContext } from '../../../../context/ProjectContext.jsx'
import { useUI } from '../../../../context/UIContext.jsx'
import { useProjectMutation } from '../../../../hooks/useProjectMutation.js'
import { useEditorChrome } from '../EditorChromeContext.jsx'
import {
  OPENING_TYPE_OPTIONS,
  OpeningRow,
  deepMergeOpening,
  nextId,
  newOpening,
} from '../../OperationModule.jsx'

const FACADES = [
  { num: 1, key: 'north' },
  { num: 2, key: 'east'  },
  { num: 3, key: 'south' },
  { num: 4, key: 'west'  },
]

const ACCENT = '#10B981'  // matches EditorNav operation accent

function NotWired({ heading, body }) {
  return (
    <div className="rounded border border-dashed border-light-grey bg-off-white/30 p-6 text-center">
      <p className="text-caption font-medium text-navy mb-1">{heading}</p>
      <p className="text-xxs text-mid-grey">{body}</p>
    </div>
  )
}

function OpeningsEditor() {
  const { params } = useContext(ProjectContext)
  const { mutate } = useProjectMutation()
  const { selectedOpeningId, setSelectedOpeningId, clearSelection } = useUI()
  const [pendingType, setPendingType] = useState(null)
  const chrome = useEditorChrome()

  const openings = Array.isArray(params?.operable_openings) ? params.operable_openings : []
  const orientation = Number(params?.orientation ?? 0)

  // writeList routes through mutate so capture mode lands a single
  // whole-array patch at 'building.operable_openings' (most recent
  // wins via patchCapture dedupe).
  const writeList = (next) => mutate('building.operable_openings', next)

  const addOpening = (type, facade) => {
    const entry = { ...newOpening(type, facade), id: nextId(openings, type, facade) }
    writeList([...openings, entry])
    setSelectedOpeningId(entry.id)
    setPendingType(null)
  }
  const updateOpening = (id, partial) => {
    writeList(openings.map(o => o.id === id ? deepMergeOpening(o, partial) : o))
  }
  const deleteOpening = (id) => {
    writeList(openings.filter(o => o.id !== id))
    if (selectedOpeningId === id) clearSelection()
  }

  return (
    <div className="space-y-2.5">
      {/* Add buttons */}
      <div className="space-y-1.5">
        <p className="text-xxs uppercase tracking-wider text-mid-grey">Add opening</p>
        <div className="flex gap-1">
          {OPENING_TYPE_OPTIONS.map(t => (
            <button
              key={t.value}
              onClick={() => setPendingType(p => p === t.value ? null : t.value)}
              className={`flex-1 text-xxs px-2 py-1.5 rounded border transition-colors ${
                pendingType === t.value
                  ? 'border-emerald-700 bg-emerald-700 text-white'
                  : 'border-emerald-700 text-emerald-700 hover:bg-emerald-50'
              }`}
            >
              + {t.label}
            </button>
          ))}
        </div>
        {pendingType && (
          <div className="flex gap-1 mt-1">
            {FACADES.map(f => (
              <button
                key={f.key}
                onClick={() => addOpening(pendingType, f.key)}
                className="flex-1 text-xxs px-1 py-1 rounded border border-light-grey text-navy hover:bg-off-white"
                title={`Add ${pendingType} to ${f.key} facade`}
              >
                F{f.num} {f.key[0].toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* List */}
      {openings.length === 0 ? (
        <p className="text-xxs text-mid-grey italic px-1 py-2">
          No operable openings on the baseline yet. Add one above, or set
          some up on the main /operation page first and they'll appear
          here as the intervention's starting point.
        </p>
      ) : (
        <div className="space-y-1.5">
          {openings.map(o => (
            <OpeningRow
              key={o.id}
              opening={o}
              selected={selectedOpeningId === o.id}
              orientation={orientation}
              onSelect={() => setSelectedOpeningId(o.id)}
              onUpdate={(partial) => updateOpening(o.id, partial)}
              onDelete={() => deleteOpening(o.id)}
              openScheduleEditor={chrome.openNamedScheduleEditor}
              allSched={Array.isArray(params?.schedules) ? params.schedules : []}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function OperationSection({ active }) {
  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-light-grey">
        <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: ACCENT }} />
        <h3 className="text-caption font-semibold text-navy">
          Operation · {
            active === 'operation.openings'       ? 'Operable openings'    :
            active === 'operation.thresholds'     ? 'Control thresholds'    :
            active === 'operation.permanent_vent' ? 'Permanent vent flow'   : active
          }
        </h3>
      </div>
      {active === 'operation.openings' && <OpeningsEditor />}
      {active === 'operation.thresholds' && (
        <NotWired
          heading="Edit thresholds per opening"
          body="Each opening's temperature thresholds (open_above_zone_c, hysteresis_c, require_outside_cooler) live in the Control block of the Operable openings subsection. Switch to that subsection to edit them. A dedicated all-thresholds-at-a-glance view may land in a later step."
        />
      )}
      {active === 'operation.permanent_vent' && (
        <NotWired
          heading="Permanent vent flow lives in Building"
          body="Per CLAUDE.md module scopes, permanent vents (trickle vents, fixed louvres) are passive envelope features owned by the Building module. Set them up under Building → Permanent openings on the main page or in this editor's Building section."
        />
      )}
    </div>
  )
}
