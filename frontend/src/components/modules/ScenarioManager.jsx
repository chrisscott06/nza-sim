/**
 * ScenarioManager.jsx
 *
 * Main scenario management module. Uses ExplorerLayout with:
 *  - Left sidebar: ScenarioList (all scenarios, run buttons, New Scenario)
 *  - Main area: selected scenario detail (config summary, changes list, results)
 */

import { useCallback, useContext, useEffect, useState } from 'react'
import { ArrowRight, Edit2, Pencil, GitCompareArrows } from 'lucide-react'
import ExplorerLayout from '../ui/ExplorerLayout.jsx'
import DataCard from '../ui/DataCard.jsx'
import ScenarioList from './scenarios/ScenarioList.jsx'
import CreateScenarioModal from './scenarios/CreateScenarioModal.jsx'
import ScenarioEditor from './scenarios/ScenarioEditor.jsx'
import ComparisonView from './scenarios/ComparisonView.jsx'
import { ProjectContext } from '../../context/ProjectContext.jsx'

// ── API helpers ────────────────────────────────────────────────────────────────

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }))
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }
  if (res.status === 204) return null
  return res.json()
}

// ── Changes list ───────────────────────────────────────────────────────────────

function categoryLabel(cat) {
  if (cat === 'construction') return 'Fabric'
  if (cat === 'systems')      return 'Systems'
  if (cat === 'building')     return 'Building'
  return cat
}

function paramLabel(param) {
  return param
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function ChangeRow({ change }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-light-grey last:border-0">
      <span className="text-xxs text-mid-grey w-16 flex-shrink-0 mt-0.5">
        {categoryLabel(change.category)}
      </span>
      <span className="text-xxs font-medium text-dark-grey w-28 flex-shrink-0 mt-0.5">
        {paramLabel(change.parameter)}
      </span>
      <div className="flex-1 flex items-center gap-1 min-w-0 flex-wrap">
        <span className="text-xxs text-mid-grey line-through">{change.baseline_display}</span>
        <ArrowRight size={10} className="text-mid-grey flex-shrink-0" />
        <span className="text-xxs text-navy font-medium">{change.scenario_display}</span>
      </div>
    </div>
  )
}

// ── Config summary table ───────────────────────────────────────────────────────

function ConfigRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-light-grey last:border-0 gap-2 min-w-0">
      <span className="text-xxs text-mid-grey flex-shrink-0">{label}</span>
      <span className="text-xxs font-medium text-dark-grey truncate text-right" title={value ?? '—'}>{value ?? '—'}</span>
    </div>
  )
}

function ScenarioConfigSummary({ scenario }) {
  const bc = scenario.building_config ?? {}
  const cc = scenario.construction_choices ?? {}
  const sys = scenario.systems_config ?? {}

  return (
    <div className="grid grid-cols-3 gap-4">
      {/* Building */}
      <div>
        <p className="text-xxs font-semibold text-navy uppercase tracking-wider mb-2">Building</p>
        <ConfigRow label="Length"      value={bc.length ? `${bc.length} m` : null} />
        <ConfigRow label="Width"       value={bc.width ? `${bc.width} m` : null} />
        <ConfigRow label="Floors"      value={bc.num_floors} />
        <ConfigRow label="Floor H"     value={bc.floor_height ? `${bc.floor_height} m` : null} />
        <ConfigRow label="Orientation" value={bc.orientation != null ? `${bc.orientation}°` : null} />
      </div>

      {/* Constructions */}
      <div>
        <p className="text-xxs font-semibold text-navy uppercase tracking-wider mb-2">Fabric</p>
        <ConfigRow label="Ext. Wall"    value={cc.external_wall} />
        <ConfigRow label="Roof"         value={cc.roof} />
        <ConfigRow label="Ground Floor" value={cc.ground_floor} />
        <ConfigRow label="Glazing"      value={cc.glazing} />
      </div>

      {/* Systems */}
      <div>
        <p className="text-xxs font-semibold text-navy uppercase tracking-wider mb-2">Systems</p>
        <ConfigRow label="HVAC"        value={sys.hvac_type} />
        <ConfigRow label="Ventilation" value={sys.ventilation_type} />
        <ConfigRow label="DHW Primary" value={sys.dhw_primary} />
        <ConfigRow label="LPD"         value={sys.lighting_power_density ? `${sys.lighting_power_density} W/m²` : null} />
        <ConfigRow label="Simulation"  value={sys.mode} />
      </div>
    </div>
  )
}

// ── Results DataCards ──────────────────────────────────────────────────────────

function ScenarioResults({ latestRunId, projectId }) {
  const [results, setResults] = useState(null)
  const [loading, setLoading]  = useState(false)

  useEffect(() => {
    if (!latestRunId || !projectId) return
    setLoading(true)
    apiFetch(`/api/projects/${projectId}/simulations/${latestRunId}`)
      .then(data => setResults(data))
      .catch(() => setResults(null))
      .finally(() => setLoading(false))
  }, [latestRunId, projectId])

  if (!latestRunId) return null
  if (loading) {
    return (
      <div className="grid grid-cols-4 gap-3 animate-pulse">
        {[1,2,3,4].map(i => (
          <div key={i} className="h-16 bg-light-grey rounded-lg" />
        ))}
      </div>
    )
  }
  if (!results) return null

  const s = results.results_summary ?? {}
  const ae = results.annual_energy ?? {}

  return (
    <div className="grid grid-cols-4 gap-3">
      <DataCard
        label="EUI"
        value={s.eui_kWh_per_m2 != null ? Number(s.eui_kWh_per_m2).toFixed(1) : null}
        unit="kWh/m²"
        accent="teal"
      />
      <DataCard
        label="Heating"
        value={ae.heating_kWh != null ? Math.round(ae.heating_kWh / 1000) : null}
        unit="MWh/yr"
        accent="heating-red"
      />
      <DataCard
        label="Cooling"
        value={ae.cooling_kWh != null ? Math.round(ae.cooling_kWh / 1000) : null}
        unit="MWh/yr"
        accent="cooling-blue"
      />
      <DataCard
        label="Total Energy"
        value={s.total_energy_kWh != null ? Math.round(s.total_energy_kWh / 1000) : null}
        unit="MWh/yr"
        accent="navy"
      />
    </div>
  )
}

// ── Main content area ──────────────────────────────────────────────────────────

function ScenarioDetail({ scenario, projectId, onEdit }) {
  const changes = scenario.changes_from_baseline ?? []

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-heading font-semibold text-navy">{scenario.name}</h1>
            {scenario.is_baseline && (
              <span className="px-2 py-0.5 rounded-full bg-teal/10 text-teal text-xxs font-medium border border-teal/20">
                Baseline
              </span>
            )}
          </div>
          {scenario.description && (
            <p className="text-caption text-mid-grey mt-1">{scenario.description}</p>
          )}
        </div>
        {onEdit && (
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-light-grey text-xxs font-medium text-dark-grey hover:border-navy hover:text-navy transition-colors"
            onClick={onEdit}
          >
            <Pencil size={12} /> Edit
          </button>
        )}
      </div>

      {/* Changes from baseline (non-baseline scenarios only) */}
      {!scenario.is_baseline && (
        <div className="bg-white rounded-xl border border-light-grey p-4">
          <p className="text-caption font-semibold text-navy mb-3">
            {changes.length === 0
              ? 'No changes from baseline'
              : `${changes.length} change${changes.length !== 1 ? 's' : ''} from baseline`}
          </p>
          {changes.length > 0 && (
            <div>
              {changes.map((c, i) => <ChangeRow key={i} change={c} />)}
            </div>
          )}
          {changes.length === 0 && (
            <p className="text-xxs text-mid-grey">
              This scenario is an exact copy of the baseline. Edit it to make changes.
            </p>
          )}
        </div>
      )}

      {/* Results */}
      {scenario.latest_run_id && (
        <div className="bg-white rounded-xl border border-light-grey p-4">
          <p className="text-caption font-semibold text-navy mb-3">Latest Simulation Results</p>
          <ScenarioResults latestRunId={scenario.latest_run_id} projectId={projectId} />
        </div>
      )}

      {/* Configuration summary */}
      <div className="bg-white rounded-xl border border-light-grey p-4">
        <p className="text-caption font-semibold text-navy mb-3">Configuration</p>
        <ScenarioConfigSummary scenario={scenario} />
      </div>
    </div>
  )
}

function EmptyState({ onNew }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-12 h-12 rounded-full bg-navy/5 flex items-center justify-center mb-4">
        <Edit2 size={20} className="text-navy/40" />
      </div>
      <h2 className="text-heading font-semibold text-navy mb-2">No scenarios yet</h2>
      <p className="text-caption text-mid-grey mb-4 max-w-xs">
        Create scenarios to compare different building configurations and find the best design options.
      </p>
      <button
        className="px-4 py-2 rounded-lg bg-navy text-white text-caption font-medium hover:bg-navy/80 transition-colors"
        onClick={onNew}
      >
        Create First Scenario
      </button>
    </div>
  )
}

// ── ScenarioManager ────────────────────────────────────────────────────────────

export default function ScenarioManager() {
  const { currentProjectId } = useContext(ProjectContext)

  const [scenarios, setScenarios]       = useState([])
  const [selectedId, setSelectedId]     = useState(null)
  const [isEditing, setIsEditing]       = useState(false)
  const [showCompare, setShowCompare]   = useState(false)
  const [showModal, setShowModal]       = useState(false)
  const [runStatuses, setRunStatuses]   = useState({}) // { [id]: 'idle'|'running'|'complete'|'error' }
  const [runAllProgress, setRunAllProgress] = useState(null)

  const selectedScenario = scenarios.find(s => s.id === selectedId) ?? null
  const baselineScenario = scenarios.find(s => s.is_baseline) ?? null

  // ── Load scenarios ──────────────────────────────────────────────────────────

  const loadScenarios = useCallback(async () => {
    if (!currentProjectId) return
    try {
      let data = await apiFetch(`/api/projects/${currentProjectId}/scenarios`)

      // Auto-create baseline if this project has no scenarios yet
      if (data.length === 0) {
        try {
          await apiFetch(`/api/projects/${currentProjectId}/scenarios`, {
            method: 'POST',
            body: JSON.stringify({ name: 'Baseline', source: 'baseline' }),
          })
          data = await apiFetch(`/api/projects/${currentProjectId}/scenarios`)
        } catch (err) {
          console.error('[ScenarioManager] Auto-baseline creation failed:', err)
        }
      }

      setScenarios(data)
      // Auto-select baseline or first scenario
      if (data.length > 0 && !selectedId) {
        const baseline = data.find(s => s.is_baseline) ?? data[0]
        setSelectedId(baseline.id)
      }
    } catch (err) {
      console.error('[ScenarioManager] Load failed:', err)
    }
  }, [currentProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setScenarios([])
    setSelectedId(null)
    setIsEditing(false)
    setRunStatuses({})
    setRunAllProgress(null)
    loadScenarios()
  }, [currentProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Create scenario ─────────────────────────────────────────────────────────

  async function handleCreate({ name, description, source }) {
    const created = await apiFetch(`/api/projects/${currentProjectId}/scenarios`, {
      method: 'POST',
      body: JSON.stringify({ name, description, source }),
    })
    await loadScenarios()
    setSelectedId(created.id)
  }

  // ── Run single scenario ─────────────────────────────────────────────────────

  async function handleRun(scenarioId) {
    setRunStatuses(p => ({ ...p, [scenarioId]: 'running' }))
    try {
      await apiFetch(`/api/projects/${currentProjectId}/scenarios/${scenarioId}/simulate`, {
        method: 'POST',
      })
      setRunStatuses(p => ({ ...p, [scenarioId]: 'complete' }))
      await loadScenarios() // refresh EUI values
    } catch (err) {
      console.error('[ScenarioManager] Simulation failed:', err)
      setRunStatuses(p => ({ ...p, [scenarioId]: 'error' }))
    }
  }

  // ── Run all scenarios sequentially ──────────────────────────────────────────

  async function handleRunAll() {
    if (runAllProgress) return
    const toRun = scenarios.filter(s => runStatuses[s.id] !== 'running')
    let current = 0
    for (const scenario of toRun) {
      current++
      setRunAllProgress({ current, total: toRun.length })
      await handleRun(scenario.id)
    }
    setRunAllProgress(null)
  }

  // ── Scenario updated by editor ───────────────────────────────────────────────

  function handleScenarioUpdated(updated) {
    setScenarios(prev => prev.map(s => s.id === updated.id ? { ...s, ...updated } : s))
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const sidebar = (
    <div className="flex flex-col h-full">
      <ScenarioList
        scenarios={scenarios}
        selectedId={showCompare ? null : selectedId}
        runStatuses={runStatuses}
        onSelect={id => { setSelectedId(id); setIsEditing(false); setShowCompare(false) }}
        onRun={handleRun}
        onRunAll={handleRunAll}
        onNew={() => setShowModal(true)}
        runAllProgress={runAllProgress}
      />
      {scenarios.length > 1 && (
        <div className="px-3 py-2 border-t border-light-grey">
          <button
            className={`w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border text-xxs font-medium transition-colors ${
              showCompare
                ? 'border-navy bg-navy text-white'
                : 'border-light-grey text-dark-grey hover:border-navy hover:text-navy'
            }`}
            onClick={() => { setShowCompare(v => !v); setIsEditing(false) }}
          >
            <GitCompareArrows size={11} />
            {showCompare ? 'Exit Compare' : 'Compare All'}
          </button>
        </div>
      )}
    </div>
  )

  function renderMainContent() {
    if (scenarios.length === 0) {
      return <EmptyState onNew={() => setShowModal(true)} />
    }

    if (showCompare) {
      return (
        <ComparisonView
          scenarios={scenarios}
          projectId={currentProjectId}
        />
      )
    }

    if (!selectedScenario) {
      return (
        <div className="flex items-center justify-center h-full">
          <p className="text-caption text-mid-grey">Select a scenario to view details</p>
        </div>
      )
    }
    if (isEditing && !selectedScenario.is_baseline) {
      return (
        <ScenarioEditor
          scenario={selectedScenario}
          baseline={baselineScenario}
          projectId={currentProjectId}
          onDone={() => setIsEditing(false)}
          onScenarioUpdated={handleScenarioUpdated}
        />
      )
    }
    return (
      <ScenarioDetail
        scenario={selectedScenario}
        projectId={currentProjectId}
        onEdit={selectedScenario.is_baseline ? null : () => setIsEditing(true)}
      />
    )
  }

  return (
    <>
      <ExplorerLayout sidebar={sidebar} sidebarWidth="w-72">
        {renderMainContent()}
      </ExplorerLayout>

      {showModal && (
        <CreateScenarioModal
          scenarios={scenarios}
          onClose={() => setShowModal(false)}
          onCreate={handleCreate}
        />
      )}
    </>
  )
}
