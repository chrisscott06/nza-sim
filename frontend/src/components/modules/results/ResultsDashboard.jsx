import { useState, useContext, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play } from 'lucide-react'
import ExplorerLayout from '../../ui/ExplorerLayout.jsx'
import ErrorBoundary from '../../ui/ErrorBoundary.jsx'
import TabBar from '../../ui/TabBar.jsx'
import OverviewTab from './OverviewTab.jsx'
import EnergyFlowsTab from './EnergyFlowsTab.jsx'
import EnergyBalanceTab from './EnergyBalanceTab.jsx'
import LoadProfilesTab from './LoadProfilesTab.jsx'
import FabricAnalysisTab from './FabricAnalysisTab.jsx'
import CRREMTab from './CRREMTab.jsx'
import { SimulationContext, normalizeDbResult } from '../../../context/SimulationContext.jsx'
import { ProjectContext } from '../../../context/ProjectContext.jsx'

function ResultsSkeleton() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="h-5 bg-light-grey rounded w-48" />
      <div className="grid grid-cols-3 gap-3">
        {[1,2,3].map(i => (
          <div key={i} className="h-20 bg-light-grey rounded-xl" />
        ))}
      </div>
      <div className="h-48 bg-light-grey rounded-xl" />
      <div className="h-32 bg-light-grey rounded-xl" />
    </div>
  )
}

const TABS = [
  { id: 'overview',  label: 'Overview'         },
  { id: 'flows',     label: 'Energy Flows'     },
  { id: 'balance',   label: 'Energy Balance'   },
  { id: 'profiles',  label: 'Load Profiles'    },
  { id: 'fabric',    label: 'Fabric Analysis'  },
  { id: 'crrem',     label: 'CRREM & Carbon'   },
]

function ResultsSidebar({ activeTab, onTabChange, scenarios, scenarioResults, selectedScenarioId, onScenarioChange }) {
  const { status, results, error } = useContext(SimulationContext)
  const { params } = useContext(ProjectContext)
  const navigate = useNavigate()

  const s = results?.summary
  const eui = s?.eui_kWh_per_m2

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-light-grey">
        <p className="text-caption font-medium text-navy">Results Dashboard</p>
        <p className="text-xxs text-mid-grey mt-0.5 truncate">{params?.name ?? 'Building'}</p>
      </div>

      {/* Status banner */}
      {status === 'idle' && (
        <div className="mx-3 mt-3 rounded border border-light-grey bg-off-white p-3 text-center">
          <p className="text-caption text-dark-grey font-medium">No simulation run</p>
          <p className="text-xxs text-mid-grey mt-1">Click Run Simulation in the toolbar to generate results.</p>
          <button
            onClick={() => navigate('/building')}
            className="mt-2 text-xxs text-teal hover:underline"
          >
            Go to Building Definition →
          </button>
        </div>
      )}

      {status === 'running' && (
        <div className="mx-3 mt-3 rounded border border-teal/30 bg-teal/5 p-3 text-center">
          <p className="text-caption text-teal font-medium animate-pulse">Simulating…</p>
          <p className="text-xxs text-mid-grey mt-1">EnergyPlus is running. This takes 5–30 seconds.</p>
        </div>
      )}

      {status === 'error' && (
        <div className="mx-3 mt-3 rounded border border-coral/30 bg-coral/5 p-3">
          <p className="text-caption text-coral font-medium">Simulation failed</p>
          <p className="text-xxs text-mid-grey mt-1 break-words">{error}</p>
        </div>
      )}

      {status === 'complete' && s && (
        <div className="mx-3 mt-3 rounded border border-green-200 bg-green-50 p-3">
          <p className="text-caption text-green-700 font-medium">Simulation complete</p>
          {eui != null && (
            <p className="text-xxs text-mid-grey mt-1">
              EUI: <span className="text-navy font-medium">{eui.toFixed(1)} kWh/m²</span>
            </p>
          )}
        </div>
      )}

      {/* Scenario selector (shown when scenarios exist with results) */}
      {scenarios.length > 0 && (
        <div className="mx-3 mt-3">
          <p className="text-xxs text-mid-grey mb-1">Viewing scenario</p>
          <div className="flex items-center gap-1">
            <select
              value={selectedScenarioId ?? ''}
              onChange={e => onScenarioChange(e.target.value || null)}
              className="flex-1 px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-teal"
            >
              <option value="">Project (latest run)</option>
              {scenarios.map(s => (
                <option key={s.id} value={s.id} disabled={!scenarioResults[s.id]}>
                  {s.name}{!scenarioResults[s.id] ? ' (not run)' : ''}
                </option>
              ))}
            </select>
          </div>
          {selectedScenarioId && (
            <button
              className="mt-1 text-xxs text-teal hover:underline"
              onClick={() => navigate('/scenarios')}
            >
              ← Back to scenarios
            </button>
          )}
        </div>
      )}

      {/* Tab navigation */}
      <div className="mt-2 border-b border-light-grey">
        <div className="flex flex-col">
          {TABS.map(tab => {
            const isActive = tab.id === activeTab
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`
                  relative text-left px-4 py-2 text-caption transition-colors
                  ${isActive
                    ? 'text-navy font-medium bg-off-white'
                    : 'text-mid-grey hover:text-dark-grey hover:bg-off-white/60'
                  }
                `}
              >
                {isActive && (
                  <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-teal rounded-r" />
                )}
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" />
    </div>
  )
}

export default function ResultsDashboard() {
  const [activeTab,          setActiveTab]          = useState('overview')
  const [selectedScenarioId, setSelectedScenarioId] = useState(null)
  const { resultsLoading }        = useContext(SimulationContext)
  const { currentProjectId }      = useContext(ProjectContext)

  // Load scenarios + their results for the CRREM multi-scenario overlay
  const [scenarios,        setScenarios]        = useState([])
  const [scenarioResults,  setScenarioResults]  = useState({}) // { [scenarioId]: simRunData }

  useEffect(() => {
    if (!currentProjectId) return
    fetch(`/api/projects/${currentProjectId}/scenarios`)
      .then(r => r.ok ? r.json() : [])
      .then(async data => {
        setScenarios(data)
        // Fetch results for scenarios that have been run
        const map = {}
        for (const s of data) {
          if (!s.latest_run_id) continue
          try {
            const res = await fetch(`/api/projects/${currentProjectId}/simulations/${s.latest_run_id}`)
            if (res.ok) map[s.id] = await res.json()
          } catch {}
        }
        setScenarioResults(map)
      })
      .catch(() => {})
  }, [currentProjectId])

  // When a scenario is selected, normalize its raw DB row to the same shape
  // that live simulate responses use, so all tabs get consistent data.
  const activeResults = selectedScenarioId && scenarioResults[selectedScenarioId]
    ? normalizeDbResult(scenarioResults[selectedScenarioId])
    : null

  const tabContent = {
    overview: <ErrorBoundary moduleName="Results Overview"><OverviewTab activeResults={activeResults} /></ErrorBoundary>,
    flows:    <ErrorBoundary moduleName="Energy Flows"><EnergyFlowsTab activeResults={activeResults} /></ErrorBoundary>,
    balance:  <ErrorBoundary moduleName="Energy Balance"><EnergyBalanceTab activeResults={activeResults} /></ErrorBoundary>,
    profiles: <ErrorBoundary moduleName="Load Profiles"><LoadProfilesTab activeResults={activeResults} /></ErrorBoundary>,
    fabric:   <ErrorBoundary moduleName="Fabric Analysis"><FabricAnalysisTab activeResults={activeResults} /></ErrorBoundary>,
    crrem:    <ErrorBoundary moduleName="CRREM & Carbon">
                <CRREMTab
                  scenarios={scenarios}
                  scenarioResults={scenarioResults}
                  focusScenarioId={selectedScenarioId}
                />
              </ErrorBoundary>,
  }

  return (
    <ExplorerLayout
      sidebarWidth="w-56"
      sidebar={
        <ResultsSidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          scenarios={scenarios}
          scenarioResults={scenarioResults}
          selectedScenarioId={selectedScenarioId}
          onScenarioChange={setSelectedScenarioId}
        />
      }
    >
      <div className="h-full overflow-y-auto">
        {resultsLoading ? <ResultsSkeleton /> : tabContent[activeTab]}
      </div>
    </ExplorerLayout>
  )
}
