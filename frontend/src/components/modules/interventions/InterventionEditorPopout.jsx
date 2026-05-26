/**
 * InterventionEditorPopout.jsx — the canonical intervention editor.
 *
 * Built across Brief 46 Parts 1 → 5 (2026-05-21 → 2026-05-22). During
 * the build it lived as `InterventionEditorV2.jsx` to avoid colliding
 * with the pre-Brief-46 editor (also named InterventionEditorPopout
 * before the rebuild). Brief 46 Part 5 deleted the old file and
 * renamed V2 → canonical name; this file is what opens on every
 * "Add intervention" / edit-pencil click.
 *
 * Layout (inside a draggable SchedulePopout):
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ Header: "Editing intervention: <label>" · Drag · Reset · ×  │
 *   ├──────────┬─────────────────────────────────────────────────┤
 *   │ EditorNav│ EditorPane                                       │
 *   │ (left,   │   Dispatches by active subsection to:            │
 *   │ collapse)│     building.*  → BuildingSection      (Part 2c) │
 *   │          │     gains.*     → InternalGainsSection (Part 3)  │
 *   │ Building │     operation.* → OperationSection     (Part 3)  │
 *   │ IG       │     systems.*   → SystemsSection       (Part 4)  │
 *   │ Operation│                                                  │
 *   │ Systems  │                                                  │
 *   ├──────────┴─────────────────────────────────────────────────┤
 *   │ EditorFooter: label · Σ patches · EUI · Δ · Cancel · Save   │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Architecture (Brief 46 Part 1, refined through Part 4):
 *   - Wraps the entire body in `<InterventionCaptureProvider>` so any
 *     `useProjectMutation` call from within routes to capture mode.
 *     Each section composer mounts the SAME components the main app
 *     uses for that module's left column — Brief 46 Principle 3.
 *     No parallel UI implementations.
 *   - Local state owns the editing label. Patch state is owned by the
 *     capture context.
 *   - Runs the engine on `baseline + currentPatches` to compute the
 *     preview EUI / carbon for the footer. The Brief 41 Part 2
 *     `runInterventionStack` is reused — single-intervention path.
 *
 * Position persistence: `nza-intervention-editor-popout-position`
 * localStorage key (preserved from Brief 41 Part 4 — the pre-Brief-46
 * editor's key, so existing users' last-known position carries over).
 */

import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import SchedulePopout from '../../shared/SchedulePopout.jsx'
import { confirm } from '../../shared/ConfirmDialog.jsx'
import UnifiedScheduleEditor from '../../shared/scheduleEditor/UnifiedScheduleEditor.jsx'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { InterventionCaptureProvider, useInterventionCapture } from '../../../context/InterventionCaptureContext.jsx'
import { runInterventionStack } from '../../../utils/interventionsEngine.js'
import { calculateInstant } from '../../../utils/instantCalc.js'
import { useProjectMutation } from '../../../hooks/useProjectMutation.js'
import EditorNav from './EditorNav.jsx'
import EditorFooter from './EditorFooter.jsx'
import PatchedProjectContextProvider from './PatchedProjectContextProvider.jsx'
import { EditorChromeProvider } from './EditorChromeContext.jsx'
import ChangeList from './ChangeList.jsx'
// Brief 46 Part 2b (2026-05-21): right-pane section composers scaffolded.
// Brief 46 Part 2c (2026-05-22): Building composer wired to real
// extracted subsections.
// Brief 46 Part 3 (2026-05-22): Internal Gains + Operation composers
// wired — IG mounts the same OccupancySection / LightingSection /
// EquipmentSection that the main /gains page renders; Operation
// mounts OpeningRow lists with Add buttons.
// Brief 46 Part 4 (2026-05-22): Systems composer mounts the same
// InputsColumn that the main /systems page renders — service
// accordions + SystemSummaryRows + SystemEditorPopout, all routing
// through useProjectMutation for capture-mode dispatch.
import BuildingSection       from './sections/BuildingSection.jsx'
import InternalGainsSection  from './sections/InternalGainsSection.jsx'
import OperationSection      from './sections/OperationSection.jsx'
import SystemsSection        from './sections/SystemsSection.jsx'

const INTERVENTIONS_ACCENT = '#E84393'

/**
 * Deep-clone the saved patches before seeding either localPatches (here)
 * or currentPatches (CaptureProvider). Brief 47 Part 1.2: editing must
 * not mutate the persisted intervention until Save.
 */
function cloneIncomingPatches(patches) {
  if (!Array.isArray(patches)) return []
  if (typeof structuredClone === 'function') {
    try { return structuredClone(patches) } catch { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(patches))
}

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
  // Brief 46 Part 2c (Building) + Part 3 (IG + Operation) + Part 4
  // (Systems) all wired.
  if (active.startsWith('building.'))  return <BuildingSection      active={active} />
  if (active.startsWith('gains.'))     return <InternalGainsSection active={active} />
  if (active.startsWith('operation.')) return <OperationSection     active={active} />
  if (active.startsWith('systems.'))   return <SystemsSection       active={active} />
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

export default function InterventionEditorPopout({
  intervention,
  baselineConfig,
  weatherData,
  hourlySolar,
  scheduleProfiles,
  patchConflicts,        // Brief 55 Part 5 — Map<patchId, {…conflict info…}>
  onSave,
  onCancel,
  onDelete,
  onDirtyChange,
  onLivePatchesChange,   // Brief 47 Part 4 — visualiser live update
}) {
  const isOpen = !!intervention

  // Local label state. Patches state is owned by the capture context
  // provider below; we keep a mirror in `localPatches` (updated via the
  // provider's onChange) only because the preview engine useMemo needs
  // a stable dependency to recompute on.
  //
  // Brief 47 Part 1.1 + 1.2 (2026-05-24): localPatches seeded from a
  // DEEP CLONE of intervention.patches so the preview engine on first
  // render sees the saved patches, not []. The provider below ALSO
  // seeds its currentPatches from intervention.patches directly — the
  // two seeds are independent but agree on initial value. The deep
  // clone protects the persisted intervention from accidental mutation.
  const [localLabel, setLocalLabel] = useState(intervention?.label ?? '')
  const [localPatches, setLocalPatches] = useState(
    () => cloneIncomingPatches(intervention?.patches)
  )

  // Reset local label + patches when intervention id changes (editor
  // switches to a different row without unmounting). Close-then-reopen
  // of the same intervention id remounts via SchedulePopout's
  // unmount-when-closed pattern, so the useState initialisers re-run.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setLocalLabel(intervention?.label ?? '')
    setLocalPatches(cloneIncomingPatches(intervention?.patches))
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
      console.warn('[InterventionEditorPopout] preview engine threw:', err)
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
  const handleCancel = async () => {
    if (isDirty) {
      if (!(await confirm({
        title: 'Discard unsaved changes?',
        message: 'Your edits to this intervention will be lost.',
        confirmText: 'Discard',
        tone: 'warning',
      }))) return
    }
    onCancel?.()
  }

  // Re-seed local patches when capture context emits onChange.
  // The provider lifts its local state into our localPatches so the
  // engine recompute fires inside this component's useMemo above.
  //
  // Brief 47 Part 4 (2026-05-24): also relay to the parent's
  // onLivePatchesChange so the InterventionsModule's right-pane
  // visualiser can re-run its engine pass against the live-edited
  // intervention. The two callbacks always agree; relaying both keeps
  // the editor's own preview-EUI footer and the visualiser in sync.
  const handleCapturedPatchesChange = (nextPatches) => {
    setLocalPatches(nextPatches)
    onLivePatchesChange?.(nextPatches)
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
      {/* Brief 47 Part 1.1 (2026-05-24): pass `intervention` DIRECTLY,
          not `{ ...intervention, patches: localPatches }`. The spread
          caused the reopen bug: on the render where this provider first
          mounted, localPatches was [] (the seeding useEffect hadn't
          fired yet) so currentPatches initialised to []. By passing
          `intervention` directly the provider's useState reads
          intervention.patches at mount, which is the saved patches. */}
      <InterventionCaptureProvider
        intervention={intervention}
        baselineConfig={baselineConfig}
        onChange={handleCapturedPatchesChange}
      >
        {/* Brief 46 Part 6 fix (2026-05-22): the PatchedProjectContextProvider
            overlays applyIntervention(baseline, currentPatches) on top of
            the outer ProjectContext so the section composers' reads
            reflect the captured state. Without this layer the controls
            render baseline values + write to capture — sliders snap back
            and lists don't update. See docs/audit/46_inert_controls_diagnosis.md
            for the diagnosis. */}
        <PatchedProjectContextProvider baselineConfig={baselineConfig}>
          <EditorBody
            active={active}
            setActive={setActive}
            localLabel={localLabel}
            setLocalLabel={setLocalLabel}
            localPatches={localPatches}
            baselineConfig={baselineConfig}
            baselineEui={baselineEui}
            baselineCarbon={baselineCarbon}
            previewEui={previewEui}
            previewCarbon={previewCarbon}
            handleCancel={handleCancel}
            handleSave={handleSave}
            canSave={canSave}
          />
        </PatchedProjectContextProvider>
      </InterventionCaptureProvider>
    </SchedulePopout>
  )
}

/**
 * EditorBody — body of the editor pop-out. Lifted out of the main
 * component so it can sit INSIDE PatchedProjectContextProvider and
 * use the patched ProjectContext via hooks (`useContext(ProjectContext)`
 * + `useProjectMutation` from within the schedule-editor wiring).
 *
 * Owns the nested schedule editor's state (editingSchedule + the
 * three open-handlers exposed via EditorChromeProvider). On save the
 * handlers route through `useProjectMutation.mutate(...)` which lands
 * in capture (because the EditorBody renders inside both the capture
 * provider and the patched provider — `isCapturing === true`).
 */
function EditorBody({
  active, setActive,
  localLabel, setLocalLabel,
  localPatches,
  baselineConfig,
  baselineEui, baselineCarbon, previewEui, previewCarbon,
  handleCancel, handleSave, canSave,
}) {
  // Read patched ProjectContext (so seeding from current state reflects
  // any prior captured edits — e.g. user adds a schedule patch, closes
  // the editor, reopens it; the new schedule body is what we seed from).
  const { params } = useContext(ProjectContext)
  const { mutate } = useProjectMutation()

  // Nested schedule editor state. Shape:
  //   { kind: 'occupancy', schedule }
  //   { kind: 'gains-profile', category, profileIdx, schedule }
  //   { kind: 'named', name, schedule }
  // `schedule` is the working draft mutated by UnifiedScheduleEditor's
  // onChange — committed via the save handler when the user clicks Save.
  const [editingSchedule, setEditingSchedule] = useState(null)

  // Seed helpers. Each opens the schedule editor with the right shape.
  const openOccupancyScheduleEditor = useCallback(() => {
    const sched = params?.occupancy?.schedule ?? null
    if (!sched) {
      console.warn('[InterventionEditorPopout] occupancy schedule missing on params')
      return
    }
    setEditingSchedule({
      kind: 'occupancy',
      schedule: {
        name:                'occupancy',
        display_name:        'Occupancy',
        schedule_type:       'occupancy',
        zone_type:           params?.occupancy?.zone_type ?? 'bedroom',
        weekday:             [...(sched.weekday ?? [])],
        saturday:            [...(sched.saturday ?? [])],
        sunday:              [...(sched.sunday ?? [])],
        monthly_multipliers: [...(sched.monthly_multipliers ?? Array(12).fill(1))],
        exceptions:          Array.isArray(sched.exceptions) ? [...sched.exceptions] : [],
      },
    })
  }, [params])

  const openGainsProfileScheduleEditor = useCallback((category, profileIdx) => {
    const profile = params?.gains?.[category]?.profiles?.[profileIdx] ?? null
    if (!profile) {
      console.warn(`[InterventionEditorPopout] ${category} profile[${profileIdx}] not found`)
      return
    }
    const sched = profile.schedule ?? null
    if (!sched) {
      console.warn(`[InterventionEditorPopout] ${category} profile[${profileIdx}] has no embedded schedule`)
      return
    }
    setEditingSchedule({
      kind: 'gains-profile',
      category,
      profileIdx,
      schedule: {
        name:                profile.id ?? `${category}_${profileIdx}`,
        display_name:        profile.label ?? `${category} profile ${profileIdx + 1}`,
        schedule_type:       category,
        zone_type:           'bedroom',
        weekday:             [...(sched.weekday ?? [])],
        saturday:            [...(sched.saturday ?? [])],
        sunday:              [...(sched.sunday ?? [])],
        monthly_multipliers: [...(sched.monthly_multipliers ?? Array(12).fill(1))],
        exceptions:          Array.isArray(sched.exceptions) ? [...sched.exceptions] : [],
      },
    })
  }, [params])

  const openNamedScheduleEditor = useCallback((scheduleName) => {
    const existing = (params?.schedules ?? []).find(s => s?.name === scheduleName || s?.id === scheduleName)
    setEditingSchedule({
      kind: 'named',
      name: scheduleName,
      schedule: existing
        ? {
            id:                  existing.id ?? scheduleName,
            name:                existing.name ?? scheduleName,
            display_name:        existing.display_name ?? scheduleName,
            schedule_type:       existing.schedule_type ?? 'occupancy',
            zone_type:           existing.zone_type ?? 'bedroom',
            weekday:             [...(existing.weekday ?? [])],
            saturday:            [...(existing.saturday ?? [])],
            sunday:              [...(existing.sunday ?? [])],
            monthly_multipliers: [...(existing.monthly_multipliers ?? Array(12).fill(1))],
            exceptions:          Array.isArray(existing.exceptions) ? [...existing.exceptions] : [],
          }
        : {
            id:                  scheduleName,
            name:                scheduleName,
            display_name:        scheduleName,
            schedule_type:       'occupancy',
            zone_type:           'bedroom',
            weekday:             Array(24).fill(0.5),
            saturday:            Array(24).fill(0.5),
            sunday:              Array(24).fill(0.5),
            monthly_multipliers: Array(12).fill(1),
            exceptions:          [],
          },
    })
  }, [params])

  const closeScheduleEditor = useCallback(() => setEditingSchedule(null), [])

  // Save handler — branches by editingSchedule.kind. Captures via mutate
  // (which routes through the surrounding InterventionCaptureProvider).
  const saveSchedule = useCallback(() => {
    if (!editingSchedule) return
    const draft = editingSchedule.schedule
    if (editingSchedule.kind === 'occupancy') {
      // Replace params.occupancy.schedule. Capture whole-occupancy patch.
      const occ = params?.occupancy ?? {}
      const nextOcc = {
        ...occ,
        schedule: {
          weekday:             draft.weekday  ?? [],
          saturday:            draft.saturday ?? [],
          sunday:              draft.sunday   ?? [],
          monthly_multipliers: draft.monthly_multipliers ?? Array(12).fill(1),
          exceptions:          Array.isArray(draft.exceptions) ? draft.exceptions : [],
        },
      }
      mutate('building.occupancy', nextOcc)
    } else if (editingSchedule.kind === 'gains-profile') {
      const { category, profileIdx } = editingSchedule
      const gains = params?.gains ?? {}
      const cat = gains[category] ?? {}
      const profiles = Array.isArray(cat.profiles) ? cat.profiles : []
      const nextProfiles = profiles.map((p, i) => i === profileIdx
        ? { ...p, schedule: {
            weekday:             draft.weekday  ?? [],
            saturday:            draft.saturday ?? [],
            sunday:              draft.sunday   ?? [],
            monthly_multipliers: draft.monthly_multipliers ?? Array(12).fill(1),
            exceptions:          Array.isArray(draft.exceptions) ? draft.exceptions : [],
          } }
        : p,
      )
      mutate('building.gains', { ...gains, [category]: { ...cat, profiles: nextProfiles } })
    } else if (editingSchedule.kind === 'named') {
      // Update params.schedules[] — replace by name or append.
      const list = Array.isArray(params?.schedules) ? params.schedules : []
      const slugName = (draft.name ?? draft.id ?? editingSchedule.name).toLowerCase().replace(/\s+/g, '_')
      const entry = {
        id:                  slugName,
        name:                slugName,
        display_name:        draft.display_name ?? draft.name ?? slugName,
        schedule_type:       draft.schedule_type ?? 'occupancy',
        zone_type:           draft.zone_type ?? 'bedroom',
        weekday:             draft.weekday  ?? [],
        saturday:            draft.saturday ?? [],
        sunday:              draft.sunday   ?? [],
        monthly_multipliers: draft.monthly_multipliers ?? Array(12).fill(1),
        exceptions:          Array.isArray(draft.exceptions) ? draft.exceptions : [],
      }
      const idx = list.findIndex(s => s?.id === slugName || s?.name === slugName)
      const next = idx >= 0 ? list.map((s, i) => i === idx ? entry : s) : [...list, entry]
      mutate('building.schedules', next)
    }
    setTimeout(() => setEditingSchedule(null), 200)
  }, [editingSchedule, params, mutate])

  const chromeValue = useMemo(() => ({
    openOccupancyScheduleEditor,
    openGainsProfileScheduleEditor,
    openNamedScheduleEditor,
  }), [openOccupancyScheduleEditor, openGainsProfileScheduleEditor, openNamedScheduleEditor])

  return (
    <EditorChromeProvider value={chromeValue}>
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

        {/* Brief 47 Part 2.1 (2026-05-24): always-visible change list.
            Mounted above the footer so it's visible regardless of which
            section is active in the right pane. Part 3 may relocate it
            as part of the inputs-left / visualiser-right restructure. */}
        <ChangeList
          baselineConfig={baselineConfig}
          libraryData={baselineConfig?.libraryData}
          patchConflicts={patchConflicts}
        />

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

      {/* Nested schedule editor — floats above the intervention editor.
          Uses a distinct persistKey so its drag position doesn't shadow
          the main app's schedule popout. */}
      <SchedulePopout
        isOpen={!!editingSchedule}
        onClose={closeScheduleEditor}
        title={editingSchedule
          ? `Schedule · ${editingSchedule.schedule?.display_name ?? editingSchedule.schedule?.name ?? 'untitled'}`
          : 'Schedule editor'}
        accent={INTERVENTIONS_ACCENT}
        persistKey="nza-intervention-editor-schedule-popout"
      >
        {editingSchedule && (
          <UnifiedScheduleEditor
            schedule={editingSchedule.schedule}
            onChange={(next) => setEditingSchedule(prev => prev ? { ...prev, schedule: { ...prev.schedule, ...next } } : prev)}
            accent={INTERVENTIONS_ACCENT}
            mode="library"
            enableExceptions
            contextLabel={editingSchedule.schedule?.display_name ?? editingSchedule.schedule?.name ?? ''}
            libraryMeta={{
              name:           editingSchedule.schedule?.display_name ?? editingSchedule.schedule?.name ?? '',
              schedule_type:  editingSchedule.schedule?.schedule_type ?? 'occupancy',
              zone_type:      editingSchedule.schedule?.zone_type ?? 'bedroom',
              onNameChange:   (v) => setEditingSchedule(prev => prev ? { ...prev, schedule: { ...prev.schedule, display_name: v } } : prev),
              onTypeChange:   (v) => setEditingSchedule(prev => prev ? { ...prev, schedule: { ...prev.schedule, schedule_type: v } } : prev),
              onZoneChange:   (v) => setEditingSchedule(prev => prev ? { ...prev, schedule: { ...prev.schedule, zone_type: v } } : prev),
              onSave:         saveSchedule,
              saving:         false,
              saveCta:        'Save to intervention',
            }}
          />
        )}
      </SchedulePopout>
    </EditorChromeProvider>
  )
}
