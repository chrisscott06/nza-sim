/**
 * InterventionsModule.jsx — Brief 41 Part 3 (page-level)
 *
 * Routes at /interventions. Composition:
 *   - Header: "Interventions" + subhead
 *   - Tab switcher: Stack | Comparison (Comparison is Part 5)
 *   - Stack tab content: InterventionStackView with baseline +
 *     intervention rows + drag-and-drop + enable toggles + "+ Add"
 *   - Stub editor pop-out: clicking "+ Add" or a row's edit creates /
 *     edits an intervention. Full editor pop-out (with the building
 *     model embedded + live preview) is Brief 41 Part 4.
 *
 * Data flow:
 *   - Reads `params.interventions` from ProjectContext.
 *   - Calls calculateInstant(...) to compute engine result + per-row
 *     deltas (engine populates `consumption.interventions` when
 *     params.interventions is non-empty — see Brief 41 Part 2 wiring).
 *   - Writes through updateParam('interventions', ...) for add /
 *     toggle / reorder / delete.
 *
 * Part 3 ships the shell. Parts 4-5 expand the editor + comparison
 * view. Part 6 walkthrough + close.
 */

import { useContext, useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { WeatherContext } from '../../../context/WeatherContext.jsx'
import { useHourlySolar } from '../../../hooks/useHourlySolar.js'
import { calculateInstant } from '../../../utils/instantCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../../../data/systemTemplatesLibrary.js'
import InterventionStackView from './InterventionStackView.jsx'

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

function StubEditorPopout({ intervention, onClose, onUpdate, onDelete }) {
  if (!intervention) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40">
      <div className="bg-white rounded-2xl shadow-2xl w-[560px] max-w-[90vw] p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-xxs uppercase tracking-wider text-mid-grey font-medium">
              Editing intervention (stub — full editor in Part 4)
            </p>
            <h2 className="text-heading font-semibold text-navy truncate">
              {intervention.label || '(unnamed intervention)'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-light-grey/40 text-mid-grey">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xxs font-medium text-mid-grey uppercase tracking-wider mb-1">Label</label>
            <input
              type="text"
              value={intervention.label || ''}
              onChange={(e) => onUpdate({ label: e.target.value })}
              placeholder="e.g. Fabric upgrade — south retrofit"
              className="w-full px-3 py-2 rounded-lg border border-light-grey text-caption text-navy focus:outline-none focus:border-navy"
            />
          </div>
          <div>
            <label className="block text-xxs font-medium text-mid-grey uppercase tracking-wider mb-1">Theme (optional)</label>
            <input
              type="text"
              value={intervention.theme || ''}
              onChange={(e) => onUpdate({ theme: e.target.value || null })}
              placeholder="e.g. Ventilation strategy, Phase 1, Compliance baseline"
              className="w-full px-3 py-2 rounded-lg border border-light-grey text-caption text-navy focus:outline-none focus:border-navy"
            />
            <p className="text-xxs text-mid-grey mt-1">
              Free-text. Same string across interventions clusters them in a future theme-grouped view (Brief 42).
            </p>
          </div>
          <div>
            <label className="block text-xxs font-medium text-mid-grey uppercase tracking-wider mb-1">Notes (optional)</label>
            <textarea
              value={intervention.notes || ''}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              rows={2}
              placeholder="Free-text notes — not consumed by the engine"
              className="w-full px-3 py-2 rounded-lg border border-light-grey text-caption text-navy focus:outline-none focus:border-navy resize-none"
            />
          </div>
          <div className="rounded-lg border border-dashed border-light-grey p-4 bg-off-white/50">
            <p className="text-xxs text-mid-grey">
              <span className="font-semibold text-navy">Part 4 lands the full editor here:</span> a draggable pop-out
              with the building model on the left (Building / Internal Gains / Operation / Systems sub-modules,
              wrapped in a patch-capture context) and a live preview on the right (KPI strip + paired Sankeys +
              patch list). For now this stub just lets you name the intervention and toggle / reorder it in the
              stack.
            </p>
            <p className="text-xxs text-mid-grey mt-2">
              Patches in this intervention:{' '}
              <span className="font-semibold text-navy">{intervention.patches?.length ?? 0}</span>
              {' '}— Part 4 builds the patch-capture UI.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-light-grey">
          <button
            onClick={onDelete}
            className="px-3 py-1.5 rounded-lg border border-light-grey text-xxs font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            Delete intervention
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-white text-xxs font-medium hover:opacity-90 transition-opacity"
            style={{ backgroundColor: INTERVENTIONS_ACCENT }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

export default function InterventionsModule() {
  const { params, constructions, systems, updateParam } = useContext(ProjectContext)
  const { weatherData } = useContext(WeatherContext)
  const hourlySolar = useHourlySolar(weatherData, params?.orientation ?? 0)

  const [tab, setTab] = useState('stack')   // 'stack' | 'comparison' (Comparison is Part 5)
  const [editingId, setEditingId] = useState(null)

  const interventions = Array.isArray(params?.interventions) ? params.interventions : []

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
    const eui    = baseline.eui_kwh_per_m2 ?? baseline.eui_kWh_per_m2 ?? baseline.results_summary?.eui_kWh_per_m2 ?? null
    const carbon = baseline.carbon_kgco2_per_m2 ?? baseline.carbon_kgCO2_m2 ?? baseline.consumption?.carbon_kgco2_per_m2 ?? null
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

  const handleUpdateEditing = (patch) => {
    if (!editingId) return
    const next = interventions.map(i =>
      i.id === editingId ? { ...i, ...patch } : i
    )
    updateParam('interventions', next)
  }

  const handleDeleteEditing = () => {
    if (!editingId) return
    const next = interventions.filter(i => i.id !== editingId)
    updateParam('interventions', next)
    setEditingId(null)
  }

  const editing = editingId ? interventions.find(i => i.id === editingId) : null

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

        {/* Tab switcher */}
        <div className="flex items-center gap-1 border-b border-light-grey">
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
            disabled
            className="px-3 py-2 text-caption font-medium text-mid-grey/50 cursor-not-allowed border-b-2 border-transparent"
            title="Comparison view ships in Brief 41 Part 5"
          >
            Comparison <span className="text-xxs">(Part 5)</span>
          </button>
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
          />
        )}
      </div>

      {/* Stub editor pop-out (Part 4 will replace with the full one) */}
      <StubEditorPopout
        intervention={editing}
        onClose={handleCloseEditor}
        onUpdate={handleUpdateEditing}
        onDelete={handleDeleteEditing}
      />
    </div>
  )
}
