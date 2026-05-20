/**
 * InterventionEditorPopout.jsx — Brief 41 Part 4
 *                              + Brief 43 Part 1 (2026-05-20)
 *
 * Reuses the shared Brief 37 SchedulePopout chrome (draggable,
 * persistent-position, non-blocking) with persistKey
 * 'nza-intervention-editor-popout-position'.
 *
 * Two-column body:
 *   - Left: InterventionEditorBuildingView (curated patch-capture editor)
 *   - Right: InterventionEditorPreview (KPI strip + heat-balance bars + patch list)
 * Sticky footer: Cancel + Save buttons.
 *
 * Local state pattern:
 *   - `(localPatches, setLocalPatches)` accumulates captures.
 *   - Each capture dedupe-appends via patchCapture.capturePatch.
 *   - currentConfig = applyIntervention(baselineConfig, { ...intervention, patches: localPatches })
 *     is the running edit state shown to the user.
 *   - interventionResult = engine(currentConfig) — re-runs on every
 *     localPatches change via useMemo.
 *
 * Save semantics:
 *   - Save commits localPatches into the intervention via onSave callback
 *     (parent writes back to params.interventions).
 *   - Cancel discards localPatches; intervention reverts to its
 *     pre-edit state.
 *   - If the engine returns a validation error (e.g. shares ≠ 100%
 *     for a service), Save is disabled with the error surfaced in
 *     the preview pane.
 *
 * Brief 43 Part 1 (2026-05-20):
 *   - Default position is right-anchored (`defaultPosition='right'`) so
 *     the popout opens beside the stack rather than over them.
 *   - Unsaved-changes guard: closing the popout (via × / Esc / Cancel)
 *     when the local patches differ from the intervention's persisted
 *     patches prompts a window.confirm. Switching to a different
 *     intervention while the popout is dirty is handled by the parent
 *     (it reads `isDirty` via the `onDirtyChange` callback).
 *   - `onDirtyChange(boolean)` callback notifies the parent of unsaved
 *     state changes so the parent can intercept edit-pencil clicks on
 *     other rows.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import SchedulePopout from '../../shared/SchedulePopout.jsx'
import {
  applyIntervention,
  runInterventionStack,
} from '../../../utils/interventionsEngine.js'
import { calculateInstant } from '../../../utils/instantCalc.js'
import { capturePatch, newPatchId, removePatch } from './patchCapture.js'
import InterventionEditorBuildingView from './InterventionEditorBuildingView.jsx'
import InterventionEditorPreview from './InterventionEditorPreview.jsx'

const INTERVENTIONS_ACCENT = '#E84393'

// Brief 43 Part 1: compare the local edit state against the persisted
// intervention to determine if there are unsaved changes. Used by the
// unsaved-changes guard on close + by the parent's switch-intervention
// guard. A deep-shape check is sufficient — patch ids are stable and
// the dedupe logic in capturePatch keeps the list normalised. JSON-
// stringify comparison is fine for the patch-list shapes we deal with
// (no circular references, deterministic key order in the shape we emit).
function computeDirty(intervention, localPatches, localLabel, localTheme, localNotes) {
  if (!intervention) return false
  const labelChanged = (intervention.label ?? '') !== (localLabel ?? '').trim() && (localLabel ?? '').trim() !== ''
  if (labelChanged) return true
  if ((intervention.theme ?? '') !== (localTheme ?? '')) return true
  if ((intervention.notes ?? '') !== (localNotes ?? '')) return true
  const persisted = Array.isArray(intervention.patches) ? intervention.patches : []
  const local = Array.isArray(localPatches) ? localPatches : []
  if (persisted.length !== local.length) return true
  // Compare shape — id may differ on freshly captured patches; compare
  // path + op + value + match instead.
  for (let i = 0; i < persisted.length; i++) {
    const a = persisted[i], b = local[i]
    if (!a || !b) return true
    if (a.op !== b.op || a.path !== b.path) return true
    if (JSON.stringify(a.value ?? null) !== JSON.stringify(b.value ?? null)) return true
    if (JSON.stringify(a.match ?? null) !== JSON.stringify(b.match ?? null)) return true
  }
  return false
}

export default function InterventionEditorPopout({
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

  // Local edit state — initialised from the intervention's existing
  // patches. Updates on capture / remove. On Save, the parent
  // persists this back into params.interventions.
  const [localPatches, setLocalPatches] = useState(intervention?.patches ?? [])
  const [localLabel,   setLocalLabel]   = useState(intervention?.label ?? '')
  const [localTheme,   setLocalTheme]   = useState(intervention?.theme ?? '')
  const [localNotes,   setLocalNotes]   = useState(intervention?.notes ?? '')

  // Reset local state whenever a different intervention is opened.
  // Using `intervention?.id` as the dependency so the reset fires
  // when the editor is opened on a different row.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useMemo(() => {
    setLocalPatches(intervention?.patches ?? [])
    setLocalLabel(intervention?.label ?? '')
    setLocalTheme(intervention?.theme ?? '')
    setLocalNotes(intervention?.notes ?? '')
  }, [intervention?.id])

  // Brief 43 Part 1: dirty tracking. Compute on every render, notify
  // parent on change. Parent uses this to gate switching to a different
  // intervention while changes are unsaved.
  const isDirty = useMemo(
    () => computeDirty(intervention, localPatches, localLabel, localTheme, localNotes),
    [intervention, localPatches, localLabel, localTheme, localNotes]
  )
  const lastDirtyRef = useRef(false)
  useEffect(() => {
    if (lastDirtyRef.current !== isDirty) {
      lastDirtyRef.current = isDirty
      onDirtyChange?.(isDirty)
    }
  }, [isDirty, onDirtyChange])

  // Apply the local patches to baseline to get the running edit
  // state — what the editor shows.
  const currentConfig = useMemo(() => {
    if (!baselineConfig) return null
    if (!intervention) return baselineConfig
    const editIntervention = {
      ...intervention,
      enabled: true,
      patches: localPatches,
    }
    return applyIntervention(baselineConfig, editIntervention, baselineConfig?.libraryData)
  }, [baselineConfig, intervention, localPatches])

  // Run the engine on baseline + on intervention to produce the
  // delta surface for the preview pane.
  const { baselineResult, interventionResult, validationError } = useMemo(() => {
    if (!baselineConfig || !intervention) {
      return { baselineResult: null, interventionResult: null, validationError: null }
    }
    try {
      const editIntervention = {
        ...intervention,
        enabled: true,
        patches: localPatches,
      }
      const stackOut = runInterventionStack(
        baselineConfig,
        [editIntervention],
        (cfg) => calculateInstant(
          cfg.building, cfg.constructions, cfg.systems, cfg.libraryData,
          weatherData, hourlySolar, scheduleProfiles,
          { _skipInterventions: true },
        ),
        baselineConfig.libraryData,
      )
      const baseline    = stackOut.baseline
      const interventionR = stackOut.interventions[0]?.result
      // Check engine for share-validation errors (Brief 40 Part 5b
      // returns { error: '...' } when shares don't sum to 100%).
      const findError = (r) => {
        if (!r || !r.consumption) return null
        for (const k of ['space_heating', 'space_cooling', 'dhw', 'ventilation']) {
          if (r.consumption[k]?.error) return r.consumption[k].error
        }
        return null
      }
      return {
        baselineResult: baseline,
        interventionResult: interventionR,
        validationError: findError(interventionR),
      }
    } catch (err) {
      console.warn('[InterventionEditorPopout] preview engine threw:', err)
      return { baselineResult: null, interventionResult: null, validationError: String(err?.message ?? err) }
    }
  }, [baselineConfig, intervention, localPatches, weatherData, hourlySolar, scheduleProfiles])

  // ── Capture / mutate handlers ──────────────────────────────────────

  const capture = (newPatch) => {
    setLocalPatches(prev => capturePatch(prev, newPatch))
  }
  const handleRemovePatch = (id) => {
    setLocalPatches(prev => removePatch(prev, id))
  }

  // Brief 43 Part 2: Normalise quick-fix. Parses the engine's
  // share-validation error to identify the offending service, then
  // captures `set` patches on each enabled system in that service to
  // scale their shares proportionally to 100%. Mirrors the Brief 40
  // Part 5b Normalise pattern but lifted into intervention-authoring
  // time (the patches are captured against the intervention, not
  // committed to the baseline).
  const handleNormaliseShares = () => {
    if (!validationError) return
    const m = validationError.match(/for service '([^']+)'/)
    if (!m) return
    const service = m[1]
    const list = currentConfig?.building?.systems_config_v40?.[service] ?? []
    if (!Array.isArray(list) || list.length === 0) return
    const enabledIndices = list.map((s, i) => s?.enabled !== false ? i : -1).filter(i => i >= 0)
    if (enabledIndices.length === 0) return
    const enabledSum = enabledIndices.reduce((s, i) => s + Number(list[i].share_pct ?? 0), 0)
    enabledIndices.forEach(i => {
      const sys = list[i]
      const cur = Number(sys.share_pct ?? 0)
      const next = enabledSum > 0
        ? Math.round((cur / enabledSum) * 100 * 10) / 10
        : Math.round((100 / enabledIndices.length) * 10) / 10
      capture({
        id: newPatchId(),
        op: 'set',
        path: `building.systems_config_v40.${service}[id=${sys.id}].share_pct`,
        value: next,
        source: 'inline',
      })
    })
  }

  // ── Save / Cancel ──────────────────────────────────────────────────

  const canSave = !validationError && !!localLabel?.trim()
  const handleSave = () => {
    if (!canSave) return
    onSave?.({
      ...intervention,
      label: localLabel.trim(),
      theme: localTheme?.trim() || null,
      notes: localNotes ?? '',
      patches: localPatches,
    })
  }

  // Brief 43 Part 1: unsaved-changes guard. Wraps onCancel (Esc / × /
  // Cancel button); window.confirm if dirty. The switch-intervention
  // guard lives in the parent — it intercepts edit-pencil clicks on
  // other rows based on `onDirtyChange` callback.
  const guardedCancel = () => {
    if (isDirty) {
      const patchCount = Array.isArray(localPatches) ? localPatches.length : 0
      const persistedCount = Array.isArray(intervention?.patches) ? intervention.patches.length : 0
      const diff = Math.abs(patchCount - persistedCount)
      const msg = diff > 0
        ? `Discard ${diff} unsaved patch change${diff === 1 ? '' : 's'}?`
        : `Discard unsaved changes to label / theme / notes?`
      if (!window.confirm(msg)) return
    }
    onCancel?.()
  }

  return (
    <SchedulePopout
      isOpen={isOpen}
      onClose={guardedCancel}
      title={`Editing intervention: ${intervention?.label || '(new)'}`}
      accent={INTERVENTIONS_ACCENT}
      persistKey="nza-intervention-editor-popout-position"
      defaultPosition="right"
    >
      {/* Two-column body + sticky footer */}
      <div className="flex flex-col" style={{ maxHeight: 'calc(100vh - 7rem)' }}>
        {/* Identity row (always visible) */}
        <div className="flex-shrink-0 border-b border-light-grey bg-off-white/40 px-4 py-3 space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xxs font-medium text-mid-grey uppercase tracking-wider mb-1">Label *</label>
              <input
                type="text"
                value={localLabel}
                onChange={(e) => setLocalLabel(e.target.value)}
                placeholder="e.g. Fabric upgrade — south retrofit"
                className="w-full px-2 py-1 rounded border border-light-grey text-xxs text-navy focus:outline-none focus:border-navy"
              />
            </div>
            <div>
              <label className="block text-xxs font-medium text-mid-grey uppercase tracking-wider mb-1">Theme</label>
              <input
                type="text"
                value={localTheme}
                onChange={(e) => setLocalTheme(e.target.value)}
                placeholder="e.g. Ventilation strategy, Phase 1"
                className="w-full px-2 py-1 rounded border border-light-grey text-xxs text-navy focus:outline-none focus:border-navy"
              />
            </div>
          </div>
        </div>

        {/* Editor + preview */}
        <div className="flex-1 overflow-auto px-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Left: editor */}
            <div>
              <p className="text-xxs font-semibold text-mid-grey uppercase tracking-wider mb-2">Edit (each change captured as a patch)</p>
              <InterventionEditorBuildingView
                currentConfig={currentConfig}
                libraryData={baselineConfig?.libraryData}
                capture={capture}
              />
            </div>
            {/* Right: live preview */}
            <div>
              <p className="text-xxs font-semibold text-mid-grey uppercase tracking-wider mb-2">Live preview (intervention vs baseline)</p>
              <InterventionEditorPreview
                baselineResult={baselineResult}
                interventionResult={interventionResult}
                patches={localPatches}
                baselineConfig={baselineConfig}
                libraryData={baselineConfig?.libraryData}
                onRemovePatch={handleRemovePatch}
                validationError={validationError}
                onNormaliseShares={handleNormaliseShares}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-light-grey bg-white px-4 py-2.5 flex items-center justify-between">
          <button
            onClick={onDelete}
            className="px-3 py-1.5 rounded-lg border border-light-grey text-xxs font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            Delete intervention
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={guardedCancel}
              className="px-3 py-1.5 rounded-lg border border-light-grey text-xxs font-medium text-mid-grey hover:bg-off-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="px-4 py-1.5 rounded-lg text-white text-xxs font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: INTERVENTIONS_ACCENT }}
              title={!canSave ? (validationError ?? 'Label is required') : 'Save changes to intervention'}
            >
              Save intervention
            </button>
          </div>
        </div>
      </div>
    </SchedulePopout>
  )
}
