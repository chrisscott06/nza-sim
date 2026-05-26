/**
 * InterventionsModule.jsx — Brief 41 Parts 3 + 4 (page-level)
 *                         + Brief 43 Part 1 (2026-05-20)
 *
 * Routes at /interventions. Composition:
 *   - Header: "Interventions" + subhead
 *   - Tab switcher: Stack | Comparison (Comparison is Part 5)
 *   - Stack tab content: InterventionStackView with baseline +
 *     intervention rows + drag-and-drop + enable toggles + "+ Add"
 *   - Brief 41 Part 4: InterventionEditorPopout — draggable, two-
 *     column body (curated editor + live preview).
 *   - Brief 43 Part 1: pop-out defaults to right-anchored position so
 *     the stack in the main canvas remains visible. Switching between
 *     interventions while the pop-out is dirty fires an unsaved-
 *     changes guard (bespoke confirm dialog before discarding —
 *     see components/shared/ConfirmDialog.jsx).
 *   - Container max-width bumped from max-w-5xl → max-w-6xl so the
 *     stack rows have more breathing room beside the pop-out.
 *
 * Data flow:
 *   - Reads `params.interventions` from ProjectContext.
 *   - Calls calculateInstant(...) to compute engine result + per-row
 *     deltas (engine populates `consumption.interventions` when
 *     params.interventions is non-empty — see Brief 41 Part 2 wiring).
 *   - Writes through updateParam('interventions', ...) for add /
 *     toggle / reorder / save / delete.
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { WeatherContext } from '../../../context/WeatherContext.jsx'
import { useHourlySolar } from '../../../hooks/useHourlySolar.js'
import { calculateInstant } from '../../../utils/instantCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../../../data/systemTemplatesLibrary.js'
import InterventionStackView from './InterventionStackView.jsx'
import { confirm } from '../../shared/ConfirmDialog.jsx'
// Brief 46 Part 5 (2026-05-22): the pre-Brief-46 InterventionEditorPopout
// has been deleted; the new V2-built editor (built across Parts 1–4)
// was renamed to InterventionEditorPopout.jsx as the canonical name.
// This import opens the rebuilt editor on every "Add intervention" /
// edit-pencil click.
import InterventionEditorPopout from './InterventionEditorPopout.jsx'
import { computeFieldConflicts } from './InterventionStackView.jsx'
import VisualiserHost from './visualiser/VisualiserHost.jsx'
// Brief 47 Part 1 (2026-05-24): Library feature cut entirely per design
// note. InterventionLibrary.jsx no longer imported.
// Brief 47 Part 3 (2026-05-24): ComparisonView no longer mounted — the
// Stack | Comparison tab switcher is retired in favour of the
// inputs-left / visualiser-right layout.
// Brief 47 Part 4 (2026-05-24): visualiser switcher wired in the right
// pane (Waterfall / Before-after / Heat balance), reusing existing
// EUIWaterfall + HeatBalance components plus a small new
// BeforeAfterBars. ComparisonView fully subsumed by the switcher —
// file stays in the repo for now; safe to delete at Part 5 close.

const INTERVENTIONS_ACCENT = '#E84393'
const CURRENT_SCHEMA_VERSION = 1   // Mirrors DEFAULT_PARAMS.schema_version

/**
 * Generate a stable UUID. crypto.randomUUID is available in evergreen
 * browsers; fall back to Math.random for older runtimes (unlikely to
 * fire — dev server requires a modern browser).
 */
function newId(prefix) {
  const raw = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}_${raw}`
}

export default function InterventionsModule() {
  const { params, constructions, systems, comfortBand, updateParam } = useContext(ProjectContext)
  const { weatherData } = useContext(WeatherContext)
  const hourlySolar = useHourlySolar(weatherData, params?.orientation ?? 0)

  // Brief 47 Part 3 (2026-05-24): `tab` state retired — Stack | Comparison
  // switcher gone, replaced by inputs-left / visualiser-right split.
  const [editingId, setEditingId] = useState(null)
  // Brief 47 Part 1: library state (saveLibId / libraryPickerOpen) removed.
  // Brief 47 Part 4 (2026-05-24): livePatches mirrors the editor's
  // in-progress currentPatches so the right-pane visualiser updates
  // live as the user edits in the (possibly off-screen) pop-out.
  // Set to null when the editor isn't dirty / open; engineResult then
  // consumes the saved params.interventions directly.
  const [livePatches, setLivePatches] = useState(null)
  const handleLivePatchesChange = useCallback((nextPatches) => {
    setLivePatches(Array.isArray(nextPatches) ? nextPatches : null)
  }, [])
  // Brief 43 Part 1: dirty state surfaced by the editor pop-out via
  // onDirtyChange. Used to gate switching to a different intervention
  // and closing the pop-out without saving. Stored in a ref so event
  // handlers read the freshest value without stale-closure issues
  // through useState's async update batching.
  const editorDirtyRef = useRef(false)
  const handleDirtyChange = useCallback((dirty) => {
    editorDirtyRef.current = !!dirty
  }, [])

  const interventions = Array.isArray(params?.interventions) ? params.interventions : []
  // Brief 47 Part 1: libraryInterventions reads removed — library cut.
  // The params.library_interventions field is left in DEFAULT_PARAMS for
  // backwards compatibility (existing projects may carry library entries
  // from Brief 41–46 era); no UI surface reads or writes them now.

  // Fetch constructions library (same pattern as SystemsModule).
  const [constructionsLib, setConstructionsLib] = useState([])
  useEffect(() => {
    let cancelled = false
    fetch('/api/library/constructions')
      .then(r => r.ok ? r.json() : { constructions: [] })
      .then(d => { if (!cancelled) setConstructionsLib(d.constructions ?? []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const libraryData = useMemo(() => ({
    constructions: constructionsLib,
    system_templates: SYSTEM_TEMPLATES_LIBRARY,
    library_systems: params?.library_systems ?? [],
    library_schedules: params?.library_schedules ?? [],
  }), [constructionsLib, params?.library_systems, params?.library_schedules])

  // Brief 47 Part 4 (2026-05-24): live-stack synthesis. When the editor
  // is open AND has emitted live patches via onLivePatchesChange, swap
  // the editing intervention's saved patches with the in-progress ones
  // for the engine pass so the right-pane visualiser reflects the
  // unsaved edit in real time. When no editor is open or no live patches
  // have been emitted yet, paramsForEngine === params and engineResult
  // is identical to before this Part landed.
  const paramsForEngine = useMemo(() => {
    if (!editingId || !Array.isArray(livePatches)) return params
    if (!params) return params
    const live = interventions.map(i =>
      i.id === editingId ? { ...i, patches: livePatches } : i
    )
    return { ...params, interventions: live }
  }, [params, interventions, editingId, livePatches])

  // Engine result with interventions block (when present).
  //
  // STOPGAP (2026-05-25): comfort_band is threaded into BOTH the building
  // config AND the options bag, mirroring SystemsModule's call signature
  // (SystemsModule.jsx L149–157). Pre-stopgap this module passed raw
  // `paramsForEngine` + empty options; Bridgewater's building_config has
  // no `comfort_band` key (the 21/24 value lives only on the DB columns
  // exposed via ProjectContext.comfortBand), so the engine fell back to
  // its hard-coded default {20, 26} → /interventions ran State 2 at 20°C
  // heating setpoint vs /systems' 21°C → 0.5 kWh/m²·yr baseline EUI drift.
  //
  // Verified: scripts/_baseline_drift_check.mjs — pre-stopgap drift
  // −0.50, post-stopgap 0.00 exactly (no residual second-channel drift).
  //
  // This is a stopgap because the comfort_band lives in three places
  // (DB cols, ProjectContext React state, optional building_config JSON
  // field) and every call site has to remember to thread it twice. The
  // canonical fix is single-source comfort_band resolution in the engine
  // — to land in the upcoming metadata-input-page brief (single source of
  // truth: num_rooms, comfort_band, peak_people_per_room resolved once,
  // threaded by no call site). Until then this stopgap keeps /systems
  // and /interventions baselines numerically identical. Do NOT add
  // _skipInterventions:true here — Interventions needs the stack runner.
  const engineResult = useMemo(() => {
    if (!paramsForEngine) return null
    const cb = comfortBand ?? paramsForEngine?.comfort_band ?? { lower_c: 20, upper_c: 26 }
    try {
      return calculateInstant(
        { ...paramsForEngine, comfort_band: cb },
        constructions, systems, libraryData, weatherData, hourlySolar, null,
        { mode: 'full', comfortBand: cb, engine: 'v2.5' },
      )
    } catch (err) {
      console.warn('[InterventionsModule] calculateInstant threw:', err)
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsForEngine, constructions, systems, libraryData, weatherData, hourlySolar, comfortBand])

  const stackResult = engineResult?.consumption?.interventions ?? engineResult?.interventions ?? null

  // Brief 55 Part 5: compute per-patch field-level conflicts across the
  // full intervention list. Threaded into the editor popout so PatchList
  // can mark conflicting patches with a Drop affordance.
  const { patchConflicts: globalPatchConflicts } = useMemo(
    () => computeFieldConflicts(interventions),
    [interventions],
  )

  const baselineSummary = useMemo(() => {
    const baseline = stackResult?.baseline ?? engineResult
    if (!baseline) return null
    // Brief 44 Part 2 (2026-05-21): the canonical result shape post-
    // Brief-28-IM-Polish IA 3.2 is `consumption.total.kwh_per_m2_yr` and
    // `carbon_kg_co2_per_m2`. The previous multi-path fallback walked
    // seven candidate paths and the legacy `eui_kWh_m2` won at initial
    // render (no saved interventions yet → engineResult fallback),
    // while the canonical path won post-save (stackResult.baseline has
    // consumption.total populated). The 169.1 → 89.0 flip Chris reported
    // in the Brief 43 walkthrough was exactly this. Drop the legacy
    // fallbacks and trust the canonical path; display "—" when not
    // available rather than reading stale alternate shapes.
    const euiRaw    = baseline.consumption?.total?.kwh_per_m2_yr
    const carbonRaw = baseline.carbon_kg_co2_per_m2
                     ?? baseline.results?.carbon?.today?.kgCO2_per_m2_yr   // Brief 28f shape — still in use for carbon
                     ?? baseline.consumption?.carbon_kgco2_per_m2
    return {
      eui:    Number.isFinite(euiRaw)    ? Number(euiRaw)    : null,
      carbon: Number.isFinite(carbonRaw) ? Number(carbonRaw) : null,
    }
  }, [stackResult, engineResult])

  // ── Mutators ─────────────────────────────────────────────────────────

  const handleAdd = () => {
    const id = newId('int')
    const fresh = {
      id,
      label: 'New intervention',
      notes: '',
      enabled: true,
      theme: null,
      capex_gbp: null,
      schema_version: CURRENT_SCHEMA_VERSION,
      patches: [],
    }
    updateParam('interventions', [...interventions, fresh])
    setEditingId(id)
  }

  const handleToggleEnabled = (id) => {
    const next = interventions.map(i =>
      i.id === id ? { ...i, enabled: i.enabled === false } : i
    )
    updateParam('interventions', next)
  }

  const handleReorder = (next) => {
    updateParam('interventions', next)
  }

  // Brief 43 Part 1: switching to a different intervention while the
  // editor is dirty fires an unsaved-changes guard. The pop-out's own
  // onClose guard handles close-without-save; this parent-side guard
  // handles user-clicks-a-different-edit-pencil-while-popout-is-open.
  const handleEdit = async (id) => {
    if (editingId && editingId !== id && editorDirtyRef.current) {
      if (!(await confirm({
        title: 'Discard unsaved changes?',
        message: 'Your edits to the current intervention will be lost when you switch.',
        confirmText: 'Discard',
        tone: 'warning',
      }))) return
    }
    setEditingId(id)
    // Reset dirty on switch — the popout will re-emit its dirty state
    // on the new intervention via onDirtyChange.
    editorDirtyRef.current = false
  }
  const handleCloseEditor = () => {
    setEditingId(null)
    editorDirtyRef.current = false
    setLivePatches(null)   // Brief 47 Part 4 — clear live override on close
  }

  const handleSaveEditing = (updatedIntervention) => {
    if (!editingId) return
    const next = interventions.map(i =>
      i.id === editingId ? { ...i, ...updatedIntervention, id: editingId } : i
    )
    updateParam('interventions', next)
    setEditingId(null)
    editorDirtyRef.current = false
    setLivePatches(null)   // Brief 47 Part 4 — saved patches now in params; clear live override
  }

  const handleDeleteEditing = () => {
    if (!editingId) return
    const next = interventions.filter(i => i.id !== editingId)
    updateParam('interventions', next)
    setEditingId(null)
    editorDirtyRef.current = false
    setLivePatches(null)   // Brief 47 Part 4
  }

  // Brief 45 Part 2 (2026-05-21): duplicate an intervention. Deep-clones
  // patches with fresh UUIDs (each patch gets a new id so patchCapture's
  // dedupe logic doesn't collide with the source), appends "(copy)" to
  // the label, inserts the duplicate immediately below the source row.
  // The engine re-runs naturally as the interventions array updates via
  // updateParam, producing fresh marginal/cumulative deltas for the new
  // row.
  const handleDuplicate = (id) => {
    const sourceIdx = interventions.findIndex(i => i.id === id)
    if (sourceIdx === -1) return
    const source = interventions[sourceIdx]
    const newPatchId = () => `patch_${(typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`
    const duplicated = {
      ...source,
      id: newId('int'),
      label: `${source.label ?? 'Intervention'} (copy)`,
      enabled: source.enabled !== false,
      patches: Array.isArray(source.patches)
        ? source.patches.map(p => ({ ...p, id: newPatchId() }))
        : [],
    }
    const next = [
      ...interventions.slice(0, sourceIdx + 1),
      duplicated,
      ...interventions.slice(sourceIdx + 1),
    ]
    updateParam('interventions', next)
  }

  const editing = editingId ? interventions.find(i => i.id === editingId) : null

  // Brief 47 Part 1.3 (2026-05-24): list-level delete handler. Trash
  // icon on each stack row invokes this. Confirm-before-delete because
  // interventions can be expensive to rebuild. Closes the editor pop-out
  // if the deleted intervention is currently being edited.
  const handleListDelete = async (id) => {
    const target = interventions.find(i => i.id === id)
    const label = target?.label || '(unnamed intervention)'
    const patchCount = Array.isArray(target?.patches) ? target.patches.length : 0
    const message = patchCount > 0
      ? `${patchCount} patch${patchCount === 1 ? '' : 'es'} will be permanently removed. This cannot be undone.`
      : 'This cannot be undone.'
    if (!(await confirm({
      title: `Delete "${label}"?`,
      message,
      confirmText: 'Delete',
      tone: 'danger',
    }))) return
    const next = interventions.filter(i => i.id !== id)
    updateParam('interventions', next)
    if (editingId === id) {
      setEditingId(null)
      editorDirtyRef.current = false
    }
  }

  // Brief 47 Part 1 (2026-05-24): library save / load handlers removed.
  // The InterventionLibrary.jsx components (SaveToLibraryModal,
  // LoadFromLibraryModal, LibraryStripButton) are no longer mounted
  // anywhere. params.library_interventions stays in the schema for
  // backwards compatibility but is no longer read or written by any UI.

  // Engine quartet that patches address as their root — built once per
  // render. The editor pop-out passes this to runInterventionStack +
  // applyIntervention so the live preview can render against the
  // current baseline.
  const baselineConfig = useMemo(() => ({
    building: params,
    constructions,
    systems,
    libraryData,
  }), [params, constructions, systems, libraryData])

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="h-[calc(100vh-3rem)] bg-off-white flex flex-col">
      {/* Header — full width, stays put when scrolling either pane.
          Brief 47 Part 3 (2026-05-24): centred max-w-6xl container
          retired; module is now full-width with inputs-left /
          visualiser-right split. */}
      <div className="flex-shrink-0 px-6 pt-5 pb-3 border-b border-light-grey bg-white">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-1 h-5 rounded-full"
            style={{ backgroundColor: INTERVENTIONS_ACCENT }}
          />
          <h1 className="text-heading font-semibold text-navy">Interventions</h1>
        </div>
        <p className="text-caption text-mid-grey mt-1 max-w-3xl">
          Stack interventions against the baseline. Each intervention compounds on top of the ones above it.
          Toggle, reorder, or click to edit. Baseline stays untouched.
        </p>
      </div>

      {/* Body — Brief 47 Part 3: split into stack-left + visualiser-right.
          The Stack | Comparison tab switcher is retired; comparison is now
          one of the views inside the right-pane visualiser switcher
          (lands as part of Part 4). The library button never existed
          post-Brief-47 Part 1. */}
      <div className="flex-1 min-h-0 flex">
        {/* Left pane — intervention stack */}
        <aside className="flex-shrink-0 w-[560px] border-r border-light-grey bg-white overflow-auto">
          <div className="p-4">
            <InterventionStackView
              interventions={interventions}
              baselineSummary={baselineSummary}
              stackResult={stackResult}
              baselineConfig={baselineConfig}
              onToggleEnabled={handleToggleEnabled}
              onReorder={handleReorder}
              onEdit={handleEdit}
              onAdd={handleAdd}
              onDuplicate={handleDuplicate}
              onDelete={handleListDelete}
            />
          </div>
        </aside>

        {/* Right pane — Brief 47 Part 4 visualiser surface. View switcher
            with Waterfall (reuse EUIWaterfall) / Before-after (new
            BeforeAfterBars) / Heat balance (reuse HeatBalance via
            PhysicsView). Live-update: engineResult re-runs with the
            editor's in-progress patches substituted into the editing
            intervention (see paramsForEngine useMemo); all three views
            consume the recomputed stackResult so the visualiser stays
            in sync with edits in the (potentially off-screen) pop-out. */}
        <main className="flex-1 min-w-0 bg-off-white overflow-hidden">
          <VisualiserHost
            interventions={interventions}
            stackResult={stackResult}
            orientationDeg={Number(params?.orientation ?? 0)}
          />
        </main>
      </div>

      {/* Brief 46 Part 5 (2026-05-22): the rebuilt InterventionEditorPopout
          (built across Parts 1–4, renamed from V2 at Part 5) opens on
          every Add intervention / edit-pencil click. All four sections
          (Building / IG / Operation / Systems) wire to the same
          components the main app pages render — Brief 46 Principle 3. */}
      <InterventionEditorPopout
        intervention={editing}
        baselineConfig={baselineConfig}
        weatherData={weatherData}
        hourlySolar={hourlySolar}
        scheduleProfiles={null}
        patchConflicts={globalPatchConflicts}
        onSave={handleSaveEditing}
        onCancel={handleCloseEditor}
        onDelete={handleDeleteEditing}
        onDirtyChange={handleDirtyChange}
        onLivePatchesChange={handleLivePatchesChange}
      />

      {/* Brief 47 Part 1 (2026-05-24): library save/load modals removed. */}
    </div>
  )
}
