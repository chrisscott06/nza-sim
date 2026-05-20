/**
 * InterventionsModule.jsx — Brief 41 Parts 3 + 4 (page-level)
 *
 * Routes at /interventions. Composition:
 *   - Header: "Interventions" + subhead
 *   - Tab switcher: Stack | Comparison (Comparison is Part 5)
 *   - Stack tab content: InterventionStackView with baseline +
 *     intervention rows + drag-and-drop + enable toggles + "+ Add"
 *   - Brief 41 Part 4: InterventionEditorPopout (replaces the Part 3
 *     stub). Draggable, two-column layout (curated editor + live
 *     preview) with patch capture and Save / Cancel semantics. Part 5
 *     adds the Comparison full-page view.
 *
 * Data flow:
 *   - Reads `params.interventions` from ProjectContext.
 *   - Calls calculateInstant(...) to compute engine result + per-row
 *     deltas (engine populates `consumption.interventions` when
 *     params.interventions is non-empty — see Brief 41 Part 2 wiring).
 *   - Writes through updateParam('interventions', ...) for add /
 *     toggle / reorder / save / delete.
 */

import { useContext, useEffect, useMemo, useState } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { WeatherContext } from '../../../context/WeatherContext.jsx'
import { useHourlySolar } from '../../../hooks/useHourlySolar.js'
import { calculateInstant } from '../../../utils/instantCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../../../data/systemTemplatesLibrary.js'
import InterventionStackView from './InterventionStackView.jsx'
import InterventionEditorPopout from './InterventionEditorPopout.jsx'
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
    // Accept State 3 (consumption.total.kwh_per_m2_yr / results.energy.kwh_per_m2_yr /
    // energy_use.totals.eui_kwh_per_m2), degree-day fallback (eui_kWh_m2),
    // and historical eui_kWh_per_m2 / results_summary shapes.
    const eui    = baseline.consumption?.total?.kwh_per_m2_yr ?? baseline.results?.energy?.kwh_per_m2_yr ?? baseline.energy_use?.totals?.eui_kwh_per_m2 ?? baseline.eui_kwh_per_m2 ?? baseline.eui_kWh_per_m2 ?? baseline.eui_kWh_m2 ?? baseline.results_summary?.eui_kWh_per_m2 ?? null
    const carbon = baseline.carbon_kg_co2_per_m2 ?? baseline.results?.carbon?.today?.kgCO2_per_m2_yr ?? baseline.carbon_kgco2_per_m2 ?? baseline.carbon_kgCO2_m2 ?? baseline.consumption?.carbon_kgco2_per_m2 ?? null
    return {
      eui:    Number.isFinite(eui)    ? Number(eui)    : null,
      carbon: Number.isFinite(carbon) ? Number(carbon) : null,
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

  const handleEdit = (id) => setEditingId(id)
  const handleCloseEditor = () => setEditingId(null)

  const handleSaveEditing = (updatedIntervention) => {
    if (!editingId) return
    const next = interventions.map(i =>
      i.id === editingId ? { ...i, ...updatedIntervention, id: editingId } : i
    )
    updateParam('interventions', next)
    setEditingId(null)
  }

  const handleDeleteEditing = () => {
    if (!editingId) return
    const next = interventions.filter(i => i.id !== editingId)
    updateParam('interventions', next)
    setEditingId(null)
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
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
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
            onToggleEnabled={handleToggleEnabled}
            onReorder={handleReorder}
            onEdit={handleEdit}
            onAdd={handleAdd}
            onSaveToLibrary={handleSaveToLibrary}
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

      {/* Brief 41 Part 4 — draggable editor pop-out with patch capture
          + live preview. Replaces the Part 3 stub. */}
      <InterventionEditorPopout
        intervention={editing}
        baselineConfig={baselineConfig}
        weatherData={weatherData}
        hourlySolar={hourlySolar}
        scheduleProfiles={null}
        onSave={handleSaveEditing}
        onCancel={handleCloseEditor}
        onDelete={handleDeleteEditing}
      />

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
