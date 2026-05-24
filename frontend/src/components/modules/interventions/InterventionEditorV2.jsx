/**
 * InterventionEditorV2.jsx — Brief 46 Part 1 (2026-05-21)
 *
 * The new intervention editor shell. V2 suffix during the build to
 * avoid colliding with the old editor (`InterventionEditorPopout.jsx`).
 * Renamed to `InterventionEditorPopout.jsx` at Brief 46 Part 5 when the
 * old editor is deleted.
 *
 * Layout (inside a draggable SchedulePopout):
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ Header: "Editing intervention: <label>" · Drag · Reset · ×  │
 *   ├──────────┬─────────────────────────────────────────────────┤
 *   │ EditorNav│ EditorPane                                       │
 *   │ (left,   │   (active section's component — placeholder      │
 *   │ collapse)│    in Part 1; wired in Parts 2-4)                │
 *   │          │                                                  │
 *   │ Building │                                                  │
 *   │ IG       │                                                  │
 *   │ Operation│                                                  │
 *   │ Systems  │                                                  │
 *   │          │                                                  │
 *   │ + PatchList (collapsible drawer at bottom of pane in        │
 *   │   future iteration; Part 1 stub)                            │
 *   ├──────────┴─────────────────────────────────────────────────┤
 *   │ EditorFooter: label · Σ patches · EUI · Δ · Cancel · Save   │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Architecture (Brief 46 Part 1):
 *   - Wraps the entire body in `<InterventionCaptureProvider>` so any
 *     `useProjectMutation` call from within routes to capture mode.
 *   - Local state owns the editing label / theme / notes. Patch state
 *     is owned by the capture context.
 *   - Runs the engine on `baseline + currentPatches` to compute the
 *     preview EUI / carbon for the footer. The Brief 41 Part 2
 *     `runInterventionStack` is reused — single-intervention path.
 *
 * Part 1 does NOT render any section composers yet. The right pane
 * shows a placeholder "Select a section from the left." until Parts
 * 2-4 land. The old editor remains operational and is the default
 * entry point — V2 is unreachable from the UI until Part 5.
 *
 * Position persistence: `nza-intervention-editor-popout-position`
 * localStorage key (preserved from Brief 41 Part 4). When the V2
 * shell becomes the default at Part 5, existing users' last-known
 * position carries over.
 */

import { useEffect, useMemo, useState } from 'react'
import SchedulePopout from '../../shared/SchedulePopout.jsx'
import { InterventionCaptureProvider } from '../../../context/InterventionCaptureContext.jsx'
import { runInterventionStack } from '../../../utils/interventionsEngine.js'
import { calculateInstant } from '../../../utils/instantCalc.js'
import EditorNav from './EditorNav.jsx'
import EditorFooter from './EditorFooter.jsx'
// Brief 46 Part 2b (2026-05-21): right-pane section composers scaffolded.
// Brief 46 Part 2c (2026-05-22): Building composer wired to real
// extracted subsections.
// Brief 46 Part 3 (2026-05-22): Internal Gains + Operation composers
// wired — IG mounts the same OccupancySection / LightingSection /
// EquipmentSection that the main /gains page renders; Operation
// mounts OpeningRow lists with Add buttons.
import BuildingSection       from './sections/BuildingSection.jsx'
import InternalGainsSection  from './sections/InternalGainsSection.jsx'
import OperationSection      from './sections/OperationSection.jsx'

const INTERVENTIONS_ACCENT = '#E84393'

function pickFirst(result, paths) {
  if (!result) return null
  for (const path of paths) {
    let cur = result
    for (const seg of path.split('.')) {
      if (cur == null) break
      cur = cur[seg]
    }
    if (Number.isFinite(cur)) return cur
  }
  return null
}

function pullEui(result) {
  return pickFirst(result, [
    'consumption.total.kwh_per_m2_yr',
    'results.energy.kwh_per_m2_yr',
    'energy_use.totals.eui_kwh_per_m2',
  ])
}

function pullCarbon(result) {
  return pickFirst(result, [
    'carbon_kg_co2_per_m2',
    'results.carbon.today.kgCO2_per_m2_yr',
    'consumption.carbon_kgco2_per_m2',
  ])
}

/**
 * EditorPaneBody — renders the right-pane content based on the active
 * section selection. Part 1 ships placeholders; Parts 2-4 add the real
 * section composers (BuildingSection / InternalGainsSection /
 * OperationSection / SystemsSection).
 */
function EditorPaneBody({ active }) {
  if (!active) {
    return (
      <div className="h-full flex items-center justify-center text-xxs text-mid-grey p-6 text-center">
        <div>
          <p className="mb-1">Select a section from the left.</p>
          <p className="text-mid-grey/70">
            Building, Internal Gains, Operation, and Systems each expose the same controls available in the main app. Every change here is captured as a patch against the baseline.
          </p>
        </div>
      </div>
    )
  }
  // Brief 46 Part 2c (Building) + Part 3 (IG + Operation) wired.
  // Systems composer lands in Part 4.
  if (active.startsWith('building.'))  return <BuildingSection      active={active} />
  if (active.startsWith('gains.'))     return <InternalGainsSection active={active} />
  if (active.startsWith('operation.')) return <OperationSection     active={active} />
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-sm w-full rounded border border-dashed border-light-grey bg-off-white/30 p-6 text-center">
        <p className="text-xxs text-mid-grey/80 mb-2">{labelFor(active)}</p>
        <p className="text-caption font-medium text-navy mb-1">Not yet wired</p>
        <p className="text-xxs text-mid-grey">
          This section will be wired into the new editor in a later step.
        </p>
      </div>
    </div>
  )
}

function labelFor(active) {
  // Best-effort cosmetic — later parts will replace this with section-specific headers.
  const parts = (active ?? '').split('.')
  return parts.map(p => p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())).join(' · ')
}

export default function InterventionEditorV2({
  intervention,
  baselineConfig,
  weatherData,
  hourlySolar,
  scheduleProfiles,
  onSave,
  onCancel,
  onDelete,
  onDirtyChange,
}) {
  const isOpen = !!intervention

  // Local label / theme / notes state. Patches state lives in the
  // capture context provider below.
  const [localLabel, setLocalLabel] = useState(intervention?.label ?? '')
  const [localPatches, setLocalPatches] = useState(intervention?.patches ?? [])

  // Reset local label + patches when intervention id changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setLocalLabel(intervention?.label ?? '')
    setLocalPatches(intervention?.patches ?? [])
  }, [intervention?.id])

  // Active section selection (left nav → right pane).
  const [active, setActive] = useState(null)

  // Compute the preview engine result. Single-intervention stack run
  // — same code path as the old editor's preview (Brief 41 Part 4).
  const { baselineEui, baselineCarbon, previewEui, previewCarbon } = useMemo(() => {
    if (!baselineConfig || !intervention) {
      return { baselineEui: null, baselineCarbon: null, previewEui: null, previewCarbon: null }
    }
    try {
      const editIntervention = {
        ...intervention,
        enabled: true,
        patches: localPatches,
      }
      const stack = runInterventionStack(
        baselineConfig,
        [editIntervention],
        (cfg) => calculateInstant(
          cfg.building, cfg.constructions, cfg.systems, cfg.libraryData,
          weatherData, hourlySolar, scheduleProfiles,
          { _skipInterventions: true },
        ),
        baselineConfig.libraryData,
      )
      const baseline = stack.baseline
      const after    = stack.interventions[0]?.result
      return {
        baselineEui:    pullEui(baseline),
        baselineCarbon: pullCarbon(baseline),
        previewEui:     pullEui(after),
        previewCarbon:  pullCarbon(after),
      }
    } catch (err) {
      console.warn('[InterventionEditorV2] preview engine threw:', err)
      return { baselineEui: null, baselineCarbon: null, previewEui: null, previewCarbon: null }
    }
  }, [baselineConfig, intervention, localPatches, weatherData, hourlySolar, scheduleProfiles])

  // Dirty tracking — compares localPatches + localLabel against the
  // persisted intervention. Parent uses it for the switch-intervention
  // guard. Simple shape check; Brief 46 Part 5 can tighten if needed.
  const isDirty = useMemo(() => {
    if (!intervention) return false
    if ((intervention.label ?? '') !== (localLabel ?? '').trim() && (localLabel ?? '').trim() !== '') return true
    const persisted = Array.isArray(intervention.patches) ? intervention.patches : []
    if (persisted.length !== localPatches.length) return true
    for (let i = 0; i < persisted.length; i++) {
      const a = persisted[i], b = localPatches[i]
      if (!a || !b) return true
      if (a.op !== b.op || a.path !== b.path) return true
      if (JSON.stringify(a.value ?? null) !== JSON.stringify(b.value ?? null)) return true
      if (JSON.stringify(a.match ?? null) !== JSON.stringify(b.match ?? null)) return true
    }
    return false
  }, [intervention, localLabel, localPatches])

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  // Save / Cancel handlers.
  const canSave = !!(localLabel ?? '').trim()
  const handleSave = () => {
    if (!canSave) return
    onSave?.({
      ...intervention,
      label: localLabel.trim(),
      patches: localPatches,
    })
  }
  const handleCancel = () => {
    if (isDirty) {
      if (!window.confirm('Discard unsaved changes to this intervention?')) return
    }
    onCancel?.()
  }

  // Re-seed local patches when capture context emits onChange.
  // The provider lifts its local state into our localPatches so the
  // engine recompute fires inside this component's useMemo above.
  const handleCapturedPatchesChange = (nextPatches) => {
    setLocalPatches(nextPatches)
  }

  return (
    <SchedulePopout
      isOpen={isOpen}
      onClose={handleCancel}
      title={`Editing intervention: ${intervention?.label || '(new)'}`}
      accent={INTERVENTIONS_ACCENT}
      persistKey="nza-intervention-editor-popout-position"
      defaultPosition="right"
    >
      <InterventionCaptureProvider
        intervention={{ ...intervention, patches: localPatches }}
        baselineConfig={baselineConfig}
        onChange={handleCapturedPatchesChange}
      >
        <div className="flex flex-col" style={{ height: 'calc(100vh - 7rem)', maxHeight: 'calc(100vh - 7rem)' }}>
          {/* Body: left nav + right pane */}
          <div className="flex-1 min-h-0 flex">
            <EditorNav
              active={active}
              onActiveChange={setActive}
              currentPatches={localPatches}
            />
            <div className="flex-1 min-w-0 overflow-auto">
              <EditorPaneBody active={active} />
            </div>
          </div>

          {/* Footer */}
          <EditorFooter
            label={localLabel}
            onLabelChange={setLocalLabel}
            baselineEui={baselineEui}
            baselineCarbon={baselineCarbon}
            previewEui={previewEui}
            previewCarbon={previewCarbon}
            onCancel={handleCancel}
            onSave={handleSave}
            canSave={canSave}
            saveDisabledReason={!canSave ? 'Label is required' : null}
          />
        </div>
      </InterventionCaptureProvider>
    </SchedulePopout>
  )
}
