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
import { Pencil, Copy, Trash2 } from 'lucide-react'
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
// Brief 87 Part 5/6 — VisualiserHost retired: the Strategy page now uses
// StrategyView and the Library page uses PerInterventionView. VisualiserHost +
// its IsolatedView/BeforeAfterBars/BreakdownPanel/ComparisonView children are no
// longer mounted; full file deletion deferred to Part 6 close (post-walkthrough).
// Brief 87 Part 4 — Library/Strategy split + two-section per-intervention view.
import PerInterventionView from './PerInterventionView.jsx'
import CostEditorPopout from './cost/CostEditorPopout.jsx'
import StrategyView from './StrategyView.jsx'
import EPValidationPanel from './EPValidationPanel.jsx'
import { useIsolatedResults } from './useIsolatedResults.js'
import { useEpResults } from './useEpResults.js'
import { exportInterventionsXlsx } from '../../../utils/interventionExport.js'
import { getGia } from './visualiser/unitFmt.js'
// Brief 94 Part 3 — strategy = ordered refs into the library. The engine + stack
// view consume the RESOLVED strategy (order + enabled from refs); reorder / toggle /
// remove / add mutate strategies[0].refs, never the library definitions.
import {
  migrateStrategyRefs,
  resolveStrategyInterventions,
  reorderStrategyRefs,
  setStrategyRefEnabled,
  removeStrategyRef,
  addStrategyRef,
  strategyRefIdSet,
} from '../../../utils/strategyModel.js'
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
  const { params, constructions, systems, comfortBand, updateParam, currentProjectId } = useContext(ProjectContext)
  const { weatherData } = useContext(WeatherContext)
  const hourlySolar = useHourlySolar(weatherData, params?.orientation ?? 0)

  // Brief 47 Part 3 (2026-05-24): `tab` state retired — Stack | Comparison
  // switcher gone, replaced by inputs-left / visualiser-right split.
  const [editingId, setEditingId] = useState(null)
  // Brief 87 Part 4 — Library/Strategy page split. Library = author + the
  // per-intervention two-section view; Strategy = ordered composition (Part 5,
  // still the existing stack + visualiser for now). `selectedLibraryId` is the
  // intervention shown in the Library's right pane.
  const [page, setPage] = useState('library')
  const [selectedLibraryId, setSelectedLibraryId] = useState(null)
  // Brief 47 Part 1: library state (saveLibId / libraryPickerOpen) removed.
  // Brief 94 P5 — Apply-gated recalc: the editor no longer streams in-progress edits
  // into the global engine. Global numbers recompute ONLY when params change (Apply /
  // add / reorder / toggle). The old `livePatches` mirror is gone; the editor drives
  // its OWN debounced preview locally.
  // Brief 43 Part 1: dirty state surfaced by the editor pop-out via
  // onDirtyChange. Used to gate switching to a different intervention
  // and closing the pop-out without saving. Stored in a ref so event
  // handlers read the freshest value without stale-closure issues
  // through useState's async update batching.
  const editorDirtyRef = useRef(false)
  const handleDirtyChange = useCallback((dirty) => {
    editorDirtyRef.current = !!dirty
  }, [])

  // The LIBRARY: all intervention definitions (order not meaningful). Backs the
  // Library page + is the edit surface.
  const interventions = Array.isArray(params?.interventions) ? params.interventions : []

  // Brief 94 Part 3 — the composed STRATEGY: library items in ref order with
  // ref.enabled applied. The engine + the Strategy stack consume THIS, not the raw
  // library — so reordering/toggling refs moves the stack. Post-migration it equals
  // `interventions` exactly, so numbers stay byte-identical until the user acts.
  const strategyInterventions = useMemo(() => resolveStrategyInterventions(params), [params])
  const strategyRefIds = useMemo(() => strategyRefIdSet(params), [params])

  // Brief 89 (Brief C) Part 7: project-level CRREM pathway pick. v1 is single-
  // pathway — property type derives from the project building_type (single source
  // of truth), country fixed UK, pathway local (1.5°C; persistence + more curves
  // are a future brief). Applies to both Library + Strategy CRREM charts.
  const [crremPathway, setCrremPathway] = useState('1.5C')
  const crremPick = useMemo(() => ({
    country: 'UK',
    property_type: (params?.building_type || 'hotel').toLowerCase(),
    pathway: crremPathway,
  }), [params?.building_type, crremPathway])

  // Brief 90 (Brief B): project cost defaults + per-intervention cost persistence.
  const projectCostDefaults = params?.cost_defaults ?? null
  const updateInterventionCost = useCallback((id, cost) => {
    const next = (params?.interventions ?? []).map(iv => (iv.id === id ? { ...iv, cost } : iv))
    updateParam('interventions', next)
  }, [params?.interventions, updateParam])
  // Brief 101 P2: per-intervention assumption_notes (ENERGY/COST audit trail), editable.
  const updateInterventionAssumptionNotes = useCallback((id, assumption_notes) => {
    const next = (params?.interventions ?? []).map(iv => (iv.id === id ? { ...iv, assumption_notes } : iv))
    updateParam('interventions', next)
  }, [params?.interventions, updateParam])
  // Brief 97 P3/P5 — the RICS cost editor is a pop-out; this holds the
  // intervention whose plan is being edited (null = closed).
  const [costEditorIv, setCostEditorIv] = useState(null)
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

  // Brief 94 Part 3 — the engine stacks the STRATEGY (ordered, enabled refs resolved
  // to library items), not the raw library array. Brief 94 P5 — Apply-gated: no
  // in-progress editor edits are swapped in here, so the global result is frozen while
  // editing and recomputes once when params change (Apply / add / reorder / toggle).
  const paramsForEngine = useMemo(() => {
    if (!params) return params
    return { ...params, interventions: strategyInterventions }
  }, [params, strategyInterventions])

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
  //
  // Brief 58 A2 (2026-05-26): RETIRES the e462a21 stopgap above. Engine
  // requires comfortBand via options; ProjectContext.comfortBand is the
  // single resolution point. No defensive `?? {…}`, no
  // building.comfort_band mutation, no dual-channel threading. The brief
  // 's grep gate is satisfied: no call site composes comfort_band onto
  // the building object before calling the engine.
  const engineResult = useMemo(() => {
    if (!paramsForEngine) return null
    try {
      return calculateInstant(
        paramsForEngine,
        constructions, systems, libraryData, weatherData, hourlySolar, null,
        { mode: 'full', comfortBand, engine: 'v2.5' },
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
    // seven candidate paths and a legacy top-level alias won at initial
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

  // Brief 100 P3 — export the whole Library to one XLSX (metrics + calc trail +
  // cost plans + narratives). Numbers come from the same helper the isolated view uses.
  const handleExportXlsx = () => {
    const gia = getGia(isolatedRows[0]?.isolatedResult?.baseline) || 0
    exportInterventionsXlsx({
      interventions, isolatedRows, projectDefaults: projectCostDefaults, gia,
      projectName: params?.project_name || params?.name || 'bridgewater',
    })
  }

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

  // Brief 94 Part 3 — enable/disable is a STRATEGY-membership property: toggle the
  // ref, not the library definition. (A library item could be enabled in one
  // strategy, disabled in another — though v1 has a single strategy.)
  const handleToggleEnabled = (id) => {
    updateParam('strategies', setStrategyRefEnabled(migrateStrategyRefs(params), id))
  }

  // Reorder mutates ref ORDER (the strategy), never the library array. The stack
  // view hands back the reordered list of resolved items; we map to ids.
  const handleReorder = (reorderedList) => {
    const orderedIds = (Array.isArray(reorderedList) ? reorderedList : []).map(i => i.id)
    updateParam('strategies', reorderStrategyRefs(migrateStrategyRefs(params), orderedIds))
  }

  // Remove from STRATEGY = drop the ref. The library definition survives (Decision 4).
  const handleStrategyRemove = (id) => {
    updateParam('strategies', removeStrategyRef(migrateStrategyRefs(params), id))
  }

  // Add a library item to the strategy (duplicate-guarded in addStrategyRef).
  const handleAddFromLibrary = (id) => {
    updateParam('strategies', addStrategyRef(migrateStrategyRefs(params), id))
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
  // Brief 94 P4 — CLONE is a Library action: variants of a type are separate library
  // items (Decision 1). One click → "Copy of X", opened ready to edit. Deep-clones
  // patches with fresh UUIDs. Does NOT touch the strategy (a clone is a new definition,
  // not a strategy member — Decision 4 / Part 4.3).
  const handleClone = (id) => {
    const sourceIdx = interventions.findIndex(i => i.id === id)
    if (sourceIdx === -1) return
    const source = interventions[sourceIdx]
    const newPatchId = () => `patch_${(typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`
    const cloneId = newId('int')
    const cloned = {
      ...source,
      id: cloneId,
      label: `Copy of ${source.label ?? 'Intervention'}`,
      patches: Array.isArray(source.patches)
        ? source.patches.map(p => ({ ...p, id: newPatchId() }))
        : [],
    }
    const next = [
      ...interventions.slice(0, sourceIdx + 1),
      cloned,
      ...interventions.slice(sourceIdx + 1),
    ]
    updateParam('interventions', next)
    setSelectedLibraryId(cloneId)   // select the clone in the Library catalogue
    setEditingId(cloneId)           // …and open the editor — "ready to edit"
  }

  const editing = editingId ? interventions.find(i => i.id === editingId) : null

  // Brief 47 Part 1.3 (2026-05-24): list-level delete handler. Trash
  // icon on each stack row invokes this. Confirm-before-delete because
  // interventions can be expensive to rebuild. Closes the editor pop-out
  // if the deleted intervention is currently being edited.
  // Brief 94 P4 — deleting a LIBRARY item removes the definition. If it is
  // referenced by the strategy, the confirm names that impact and, on confirm, the
  // reference is dropped from the stack too (Decision 4 / Part 4.2).
  const handleLibraryDelete = async (id) => {
    const target = interventions.find(i => i.id === id)
    const label = target?.label || '(unnamed intervention)'
    const patchCount = Array.isArray(target?.patches) ? target.patches.length : 0
    const inStrategy = strategyRefIds.has(id)
    const bits = []
    if (patchCount > 0) bits.push(`${patchCount} patch${patchCount === 1 ? '' : 'es'} will be permanently removed`)
    if (inStrategy) bits.push('it will also be removed from your strategy')
    const message = (bits.length ? `${bits.join('; ')}. ` : '') + 'This cannot be undone.'
    if (!(await confirm({
      title: `Delete "${label}"?`,
      message,
      confirmText: 'Delete',
      tone: 'danger',
    }))) return
    updateParam('interventions', interventions.filter(i => i.id !== id))
    if (inStrategy) updateParam('strategies', removeStrategyRef(migrateStrategyRefs(params), id))
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
  // Brief 58 A2 (2026-05-26): include comfortBand so the editor's
  // single-intervention preview can thread it via options.comfortBand
  // when calling calculateInstant inside runInterventionStack.
  const baselineConfig = useMemo(() => ({
    building: params,
    constructions,
    systems,
    libraryData,
    comfortBand,
  }), [params, constructions, systems, libraryData, comfortBand])

  // Brief 71 Part 4 (2026-05-28): distinct theme values from the current
  // interventions list, alphabetised. Threaded to the editor popout so its
  // theme combobox surfaces existing tags as datalist autocomplete — tag
  // consistency without enforcing a closed vocabulary.
  const themeSuggestions = useMemo(() => {
    const set = new Set()
    for (const i of interventions ?? []) {
      const t = (i?.theme ?? '').trim()
      if (t) set.add(t)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [interventions])

  // Theme filter for the Library list — multi-select chips; empty set = show all.
  const [themeFilter, setThemeFilter] = useState(() => new Set())
  const toggleTheme = useCallback((t) => {
    setThemeFilter((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t); else next.add(t)
      return next
    })
  }, [])
  const filteredInterventions = useMemo(() => (
    themeFilter.size === 0
      ? (interventions ?? [])
      : (interventions ?? []).filter((iv) => themeFilter.has((iv?.theme ?? '').trim()))
  ), [interventions, themeFilter])

  // Brief 71 Part 3 (2026-05-28): runEngine closure for the Isolated view
  // (VisualiserHost → IsolatedView → useIsolatedResults → runInterventionStack).
  // Mirrors the inner closure calculateInstant builds at instantCalc.js:6991
  // for its own stack runner: same engine quartet, same weather/solar args,
  // _skipInterventions:true to avoid recursive stack dispatch when the
  // isolated hook calls runInterventionStack with singletons.
  const runEngine = useMemo(() => {
    return (cfg) => calculateInstant(
      cfg?.building ?? params,
      cfg?.constructions ?? constructions,
      cfg?.systems ?? systems,
      cfg?.libraryData ?? libraryData,
      weatherData,
      hourlySolar,
      null,
      { mode: 'full', comfortBand, engine: 'v2.5', _skipInterventions: true },
    )
  }, [params, constructions, systems, libraryData, weatherData, hourlySolar, comfortBand])

  // Brief 87 Part 4 — per-intervention isolated deltas for the Library view.
  // Reuses the existing Brief 71 hook (singleton stack per intervention), so no
  // new engine work. The selected intervention's row feeds PerInterventionView.
  const isolatedRows = useIsolatedResults(interventions, baselineConfig, runEngine, libraryData, stackResult)
  const selectedLibId = selectedLibraryId ?? interventions[0]?.id ?? null
  const selectedIntervention = interventions.find((i) => i.id === selectedLibId) ?? null
  const selectedIsolatedRow = isolatedRows.find((r) => r.id === selectedLibId) ?? null

  // Brief 95 P7 — EnergyPlus results (read side) for the CURRENT project config,
  // keyed by state descriptor. Powers the NZA-Sim | EP | Δ% columns + trajectory
  // overlay in both the Library (isolated) and Strategy (cumulative/marginal) views.
  // Uses the strategy interventions so labels/order match the EP cumulative chain.
  const epResults = useEpResults(currentProjectId, strategyInterventions)
  const selectedEpIso = epResults.byDesc?.[`isolated:${selectedLibId}`] ?? null
  const selectedEpNzaOnly = selectedLibId ? epResults.isNzaOnly(selectedLibId) : false

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
          {page === 'library'
            ? 'A catalogue of interventions. Select one to see its isolated impact and calc trail. Order has no meaning here — sequencing lives in the Strategy.'
            : 'Compose an ordered strategy from the Library. Order matters — each intervention compounds on top of the ones above it.'}
        </p>
        {/* Brief 87 Part 4 — Library | Strategy page tabs */}
        <div className="flex gap-1 mt-3">
          {[['library', 'Library'], ['strategy', 'Strategy']].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPage(id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                page === id ? 'text-white' : 'text-mid-grey hover:text-navy bg-light-grey/40'
              }`}
              style={page === id ? { backgroundColor: INTERVENTIONS_ACCENT } : undefined}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Body — Brief 47 Part 3: split into stack-left + visualiser-right.
          The Stack | Comparison tab switcher is retired; comparison is now
          one of the views inside the right-pane visualiser switcher
          (lands as part of Part 4). The library button never existed
          post-Brief-47 Part 1. */}
      <div className="flex-1 min-h-0 flex">
        {page === 'library' ? (
          <>
            {/* ── Library page — catalogue (left) + two-section per-intervention view (right) ── */}
            <aside className="flex-shrink-0 w-[420px] border-r border-light-grey bg-white overflow-auto">
              <div className="p-4 space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-xs uppercase tracking-wider font-semibold text-navy">Library</h2>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleExportXlsx}
                      disabled={interventions.length === 0}
                      className="text-xs font-semibold text-mid-grey hover:text-navy disabled:opacity-40"
                      title="Export all interventions (metrics + calc trail + cost plans + narratives) to an Excel workbook"
                    >
                      ⬇ Export XLSX
                    </button>
                    <button type="button" onClick={handleAdd} className="text-xs font-semibold" style={{ color: INTERVENTIONS_ACCENT }}>
                      + Add
                    </button>
                  </div>
                </div>
                {/* Theme filter — quick multi-select chips (empty = show all). */}
                {themeSuggestions.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1 pb-1">
                    {themeSuggestions.map((t) => {
                      const active = themeFilter.has(t)
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => toggleTheme(t)}
                          aria-pressed={active}
                          className={`text-xxs px-2 py-0.5 rounded-full border transition-colors ${
                            active ? 'text-white border-transparent' : 'text-mid-grey border-light-grey hover:border-mid-grey/50'
                          }`}
                          style={active ? { backgroundColor: INTERVENTIONS_ACCENT } : undefined}
                        >
                          {t}
                        </button>
                      )
                    })}
                    {themeFilter.size > 0 && (
                      <button type="button" onClick={() => setThemeFilter(new Set())} className="text-xxs px-1 text-mid-grey/60 hover:text-navy underline">
                        clear
                      </button>
                    )}
                  </div>
                )}
                {interventions.length === 0 ? (
                  <p className="text-xs text-mid-grey/60 italic">No interventions yet. Add one to start the catalogue.</p>
                ) : filteredInterventions.length === 0 ? (
                  <p className="text-xs text-mid-grey/60 italic">No interventions match the selected {themeFilter.size === 1 ? 'theme' : 'themes'}.</p>
                ) : (
                  filteredInterventions.map((iv) => {
                    const row = isolatedRows.find((r) => r.id === iv.id)
                    const euiD = row?.cumulativeDelta?.eui_kwh_per_m2?.delta
                    const isSel = iv.id === selectedLibId
                    return (
                      <div
                        key={iv.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedLibraryId(iv.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedLibraryId(iv.id) }}
                        className={`group cursor-pointer rounded-lg px-3 py-2 transition-colors ${
                          isSel ? 'border-2' : 'border border-light-grey/70 hover:border-light-grey'
                        }`}
                        style={isSel ? { borderColor: INTERVENTIONS_ACCENT } : undefined}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-navy truncate">{iv.label || '(untitled)'}</span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span
                              className="text-xs tabular-nums"
                              style={{ color: Number.isFinite(euiD) && euiD < -0.05 ? '#16A34A' : '#6B7280' }}
                            >
                              {!Number.isFinite(euiD) ? '—' : `${euiD < 0 ? '−' : '+'}${Math.abs(euiD).toFixed(1)} kWh/m²`}
                            </span>
                            <button
                              type="button"
                              title="Edit intervention"
                              onClick={(e) => { e.stopPropagation(); handleEdit(iv.id) }}
                              className="p-1 rounded text-mid-grey/40 hover:text-navy hover:bg-light-grey/50 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              type="button"
                              title="Clone — create an editable copy (a new library item)"
                              onClick={(e) => { e.stopPropagation(); handleClone(iv.id) }}
                              className="p-1 rounded text-mid-grey/40 hover:text-navy hover:bg-light-grey/50 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Copy size={13} />
                            </button>
                            <button
                              type="button"
                              title="Delete intervention"
                              onClick={(e) => { e.stopPropagation(); handleLibraryDelete(iv.id) }}
                              className="p-1 rounded text-mid-grey/40 hover:text-red-600 hover:bg-light-grey/50 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                        {iv.theme ? <span className="text-xxs text-mid-grey/60">{iv.theme}</span> : null}
                      </div>
                    )
                  })
                )}
              </div>
            </aside>
            <main className="flex-1 min-w-0 bg-off-white overflow-auto">
              {selectedIntervention ? (
                <PerInterventionView
                  intervention={selectedIntervention}
                  isolatedRow={selectedIsolatedRow}
                  crremPick={crremPick}
                  projectCostDefaults={projectCostDefaults}
                  onEditCost={setCostEditorIv}
                  onAssumptionNotesChange={updateInterventionAssumptionNotes}
                  epIso={selectedEpIso}
                  epBaseline={epResults.byDesc?.baseline ?? null}
                  epNzaOnly={selectedEpNzaOnly}
                />
              ) : (
                <div className="p-8 text-sm text-mid-grey/60">
                  Select an intervention from the Library to see its isolated impact and calc trail.
                </div>
              )}
            </main>
          </>
        ) : (
          <>
            {/* ── Strategy page — ordered stack (left) + composed StrategyView
                (right: headline + waterfall + final-state heat balance + CRREM). ── */}
            <aside className="flex-shrink-0 w-[440px] border-r border-light-grey bg-white overflow-auto">
              <div className="p-4">
                <InterventionStackView
                  interventions={strategyInterventions}
                  baselineSummary={baselineSummary}
                  stackResult={stackResult}
                  baselineConfig={baselineConfig}
                  onToggleEnabled={handleToggleEnabled}
                  onReorder={handleReorder}
                  onRemove={handleStrategyRemove}
                  library={interventions}
                  strategyRefIds={strategyRefIds}
                  onAddFromLibrary={handleAddFromLibrary}
                />
                <div className="mt-3">
                  <EPValidationPanel interventions={strategyInterventions} projectId={currentProjectId} onResultsChanged={epResults.refresh} />
                </div>
              </div>
            </aside>
            <main className="flex-1 min-w-0 bg-off-white overflow-hidden">
              <StrategyView
                strategyName={params?.strategies?.[0]?.name ?? 'Strategy 1'}
                interventions={strategyInterventions}
                stackResult={stackResult}
                orientationDeg={Number(params?.orientation ?? 0)}
                crremPick={crremPick}
                onCrremPathwayChange={setCrremPathway}
                epResults={epResults}
              />
            </main>
          </>
        )}
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
        themeSuggestions={themeSuggestions}
      />

      {/* Brief 97 P5 — RICS cost editor pop-out. Opened from the Library
          isolated view's Cost tab; commits the plan via updateInterventionCost. */}
      <CostEditorPopout
        isOpen={!!costEditorIv}
        intervention={costEditorIv}
        projectDefaults={projectCostDefaults}
        templates={params?.cost_template_library ?? []}
        onTemplatesChange={(lib) => updateParam('cost_template_library', lib)}
        onSave={updateInterventionCost}
        onClose={() => setCostEditorIv(null)}
      />

      {/* Brief 47 Part 1 (2026-05-24): library save/load modals removed. */}
    </div>
  )
}
