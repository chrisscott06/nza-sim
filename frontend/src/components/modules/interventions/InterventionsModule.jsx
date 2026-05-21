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
 *     changes guard (window.confirm before discarding).
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
import InterventionEditorPopout from './InterventionEditorPopout.jsx'
// Brief 46 Part 2b (2026-05-21): V2 editor accessible via ?editor=v2
// query param. Old editor remains the default. Dev toggle removed at
// Part 5 when V2 becomes the only entry point.
import InterventionEditorV2 from './InterventionEditorV2.jsx'
import ComparisonView from './ComparisonView.jsx'
import { SaveToLibraryModal, LoadFromLibraryModal, LibraryStripButton } from './InterventionLibrary.jsx'

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
  const { params, constructions, systems, updateParam } = useContext(ProjectContext)
  const { weatherData } = useContext(WeatherContext)
  const hourlySolar = useHourlySolar(weatherData, params?.orientation ?? 0)

  const [tab, setTab] = useState('stack')   // 'stack' | 'comparison'
  const [editingId, setEditingId] = useState(null)
  const [saveLibId, setSaveLibId] = useState(null)        // id of intervention to save → library
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false)
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
  const libraryInterventions = Array.isArray(params?.library_interventions) ? params.library_interventions : []

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

  // Engine result with interventions block (when present).
  const engineResult = useMemo(() => {
    if (!params) return null
    try {
      return calculateInstant(params, constructions, systems, libraryData, weatherData, hourlySolar, null, {})
    } catch (err) {
      console.warn('[InterventionsModule] calculateInstant threw:', err)
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, constructions, systems, libraryData, weatherData, hourlySolar])

  const stackResult = engineResult?.consumption?.interventions ?? engineResult?.interventions ?? null

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
  const handleEdit = (id) => {
    if (editingId && editingId !== id && editorDirtyRef.current) {
      if (!window.confirm('Discard unsaved changes to the current intervention?')) return
    }
    setEditingId(id)
    // Reset dirty on switch — the popout will re-emit its dirty state
    // on the new intervention via onDirtyChange.
    editorDirtyRef.current = false
  }
  const handleCloseEditor = () => {
    setEditingId(null)
    editorDirtyRef.current = false
  }

  const handleSaveEditing = (updatedIntervention) => {
    if (!editingId) return
    const next = interventions.map(i =>
      i.id === editingId ? { ...i, ...updatedIntervention, id: editingId } : i
    )
    updateParam('interventions', next)
    setEditingId(null)
    editorDirtyRef.current = false
  }

  const handleDeleteEditing = () => {
    if (!editingId) return
    const next = interventions.filter(i => i.id !== editingId)
    updateParam('interventions', next)
    setEditingId(null)
    editorDirtyRef.current = false
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

  // ── Library save / load ─────────────────────────────────────────────

  const handleSaveToLibrary = (id) => setSaveLibId(id)
  const handleCloseSaveLib = () => setSaveLibId(null)
  const handleConfirmSaveLib = (libraryEntry) => {
    updateParam('library_interventions', [...libraryInterventions, libraryEntry])
    setSaveLibId(null)
  }
  const handleOpenLibrary = () => setLibraryPickerOpen(true)
  const handleCloseLibrary = () => setLibraryPickerOpen(false)
  const handleLoadFromLibrary = (libEntry) => {
    // Create a fresh intervention from the library entry — give it a
    // new top-level id so the user can have multiple instances of the
    // same library entry in the stack. Patches are deep-copied at save
    // time (in SaveToLibraryModal); we shallow-copy here.
    const fresh = {
      id: newId('int'),
      label: libEntry.library_label || libEntry.label || 'Loaded intervention',
      notes: libEntry.notes ?? '',
      theme: libEntry.theme ?? null,
      enabled: true,
      capex_gbp: libEntry.capex_gbp ?? null,
      schema_version: libEntry.schema_version ?? CURRENT_SCHEMA_VERSION,
      patches: Array.isArray(libEntry.patches)
        ? libEntry.patches.map(p => ({ ...p, id: `patch_${(typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2)}` }))
        : [],
    }
    updateParam('interventions', [...interventions, fresh])
    setLibraryPickerOpen(false)
  }
  const handleDeleteFromLibrary = (libId) => {
    updateParam('library_interventions', libraryInterventions.filter(e => e.id !== libId))
  }

  const saveLibIntervention = saveLibId ? interventions.find(i => i.id === saveLibId) : null

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
    <div className="min-h-screen bg-off-white">
      {/* Brief 43 Part 1: container widened from max-w-5xl → max-w-6xl
          so the stack rows have more breathing room while the editor
          pop-out sits to the right. */}
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-1 h-5 rounded-full"
              style={{ backgroundColor: INTERVENTIONS_ACCENT }}
            />
            <h1 className="text-heading font-semibold text-navy">Interventions</h1>
          </div>
          <p className="text-caption text-mid-grey mt-1 max-w-2xl">
            Stack interventions against the baseline. Each intervention's effect compounds on top of the ones above it.
            Toggle, reorder, or click to edit. Baseline stays untouched.
          </p>
        </div>

        {/* Tab switcher + library button */}
        <div className="flex items-center justify-between border-b border-light-grey">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTab('stack')}
              className={`px-3 py-2 text-caption font-medium transition-colors border-b-2 ${
                tab === 'stack' ? 'border-navy text-navy' : 'border-transparent text-mid-grey hover:text-navy'
              }`}
            >
              Stack
            </button>
            <button
              onClick={() => setTab('comparison')}
              className={`px-3 py-2 text-caption font-medium transition-colors border-b-2 ${
                tab === 'comparison' ? 'border-navy text-navy' : 'border-transparent text-mid-grey hover:text-navy'
              }`}
            >
              Comparison
            </button>
          </div>
          <div className="pb-1">
            <LibraryStripButton libraryCount={libraryInterventions.length} onClick={handleOpenLibrary} />
          </div>
        </div>

        {/* Tab content */}
        {tab === 'stack' && (
          <InterventionStackView
            interventions={interventions}
            baselineSummary={baselineSummary}
            stackResult={stackResult}
            baselineConfig={baselineConfig}
            onToggleEnabled={handleToggleEnabled}
            onReorder={handleReorder}
            onEdit={handleEdit}
            onAdd={handleAdd}
            onSaveToLibrary={handleSaveToLibrary}
            onDuplicate={handleDuplicate}
          />
        )}
        {tab === 'comparison' && (
          <ComparisonView
            interventions={interventions}
            stackResult={stackResult}
            baselineConfig={baselineConfig}
          />
        )}
      </div>

      {/* Brief 46 Part 2b (2026-05-21): dev toggle to access the new
          editor. Default remains the old InterventionEditorPopout; appending
          `?editor=v2` to the URL routes to the new InterventionEditorV2
          shell instead. Old editor deleted at Brief 46 Part 5; toggle
          removed at the same time. */}
      {typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('editor') === 'v2' ? (
        <InterventionEditorV2
          intervention={editing}
          baselineConfig={baselineConfig}
          weatherData={weatherData}
          hourlySolar={hourlySolar}
          scheduleProfiles={null}
          onSave={handleSaveEditing}
          onCancel={handleCloseEditor}
          onDelete={handleDeleteEditing}
          onDirtyChange={handleDirtyChange}
        />
      ) : (
        /* Brief 41 Part 4 — draggable editor pop-out with patch capture
            + live preview. Brief 43 Part 1: default position is now
            right-anchored (set inside InterventionEditorPopout); the
            onDirtyChange callback feeds the parent's switch-intervention
            unsaved-changes guard. */
        <InterventionEditorPopout
          intervention={editing}
          baselineConfig={baselineConfig}
          weatherData={weatherData}
          hourlySolar={hourlySolar}
          scheduleProfiles={null}
          onSave={handleSaveEditing}
          onCancel={handleCloseEditor}
          onDelete={handleDeleteEditing}
          onDirtyChange={handleDirtyChange}
        />
      )}

      {/* Brief 41 Part 5 — library save/load modals */}
      <SaveToLibraryModal
        open={!!saveLibIntervention}
        intervention={saveLibIntervention}
        onClose={handleCloseSaveLib}
        onSave={handleConfirmSaveLib}
      />
      <LoadFromLibraryModal
        open={libraryPickerOpen}
        libraryEntries={libraryInterventions}
        onClose={handleCloseLibrary}
        onLoad={handleLoadFromLibrary}
        onDelete={handleDeleteFromLibrary}
      />
    </div>
  )
}
