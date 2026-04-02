/**
 * ScenarioList.jsx
 *
 * Sidebar list of all scenarios for the current project.
 * Each card shows name, baseline badge, change count, latest EUI, run button.
 */

import { Play, Loader2, CheckCircle, AlertCircle, Star } from 'lucide-react'

function StatusIcon({ status }) {
  if (status === 'running')  return <Loader2  size={12} className="text-teal animate-spin" />
  if (status === 'complete') return <CheckCircle size={12} className="text-green-500" />
  if (status === 'error')    return <AlertCircle size={12} className="text-red-500" />
  return null
}

function ScenarioCard({ scenario, selected, runStatus, onSelect, onRun }) {
  const changeCount = scenario.changes_from_baseline?.length ?? 0
  const eui = scenario.latest_eui
  const isRunning = runStatus === 'running'

  return (
    <div
      role="button"
      tabIndex={0}
      className={`
        w-full text-left px-3 py-2.5 rounded-lg border transition-all cursor-pointer
        ${selected
          ? 'border-navy bg-navy/5 shadow-sm'
          : 'border-light-grey bg-white hover:border-mid-grey'}
      `}
      onClick={onSelect}
      onKeyDown={e => e.key === 'Enter' && onSelect()}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="flex-1 min-w-0">
          {/* Name + badges */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-caption font-medium text-navy truncate">{scenario.name}</span>
            {scenario.is_baseline && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-px rounded-full bg-teal/10 text-teal text-xxs font-medium border border-teal/20">
                <Star size={9} /> Baseline
              </span>
            )}
          </div>
          {/* Change count / EUI */}
          <div className="mt-0.5 flex items-center gap-2">
            {scenario.is_baseline ? (
              <span className="text-xxs text-mid-grey">Project baseline</span>
            ) : (
              <span className="text-xxs text-mid-grey">
                {changeCount === 0 ? 'No changes' : `${changeCount} change${changeCount !== 1 ? 's' : ''}`}
              </span>
            )}
            {eui != null && (
              <span className="text-xxs font-medium text-dark-grey">
                {Number(eui).toFixed(1)} kWh/m²
              </span>
            )}
            {eui == null && !isRunning && (
              <span className="text-xxs text-light-grey italic">Not run</span>
            )}
          </div>
        </div>
        {/* Run button + status */}
        <div className="flex items-center gap-1 mt-0.5">
          <StatusIcon status={runStatus} />
          {runStatus !== 'running' && (
            <button
              className="p-1 rounded hover:bg-teal/10 text-mid-grey hover:text-teal transition-colors"
              onClick={e => { e.stopPropagation(); onRun() }}
              title="Run simulation for this scenario"
            >
              <Play size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ScenarioList({
  scenarios,
  selectedId,
  runStatuses,   // { [scenarioId]: 'idle'|'running'|'complete'|'error' }
  onSelect,
  onRun,
  onRunAll,
  onNew,
  runAllProgress, // null | { current, total }
}) {
  const hasScenarios = scenarios.length > 0
  const isRunningAll = runAllProgress != null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-light-grey">
        <p className="text-caption font-medium text-navy">Scenarios</p>
        <p className="text-xxs text-mid-grey mt-0.5">Compare building configurations</p>
      </div>

      {/* Actions */}
      <div className="px-3 py-2 border-b border-light-grey flex gap-2">
        <button
          className="flex-1 px-2 py-1.5 rounded bg-navy text-white text-xxs font-medium hover:bg-navy/80 transition-colors"
          onClick={onNew}
        >
          + New Scenario
        </button>
        {hasScenarios && scenarios.length > 1 && (
          <button
            className={`px-2 py-1.5 rounded border text-xxs font-medium transition-colors ${
              isRunningAll
                ? 'border-teal/30 bg-teal/10 text-teal cursor-not-allowed'
                : 'border-light-grey text-dark-grey hover:border-teal hover:text-teal'
            }`}
            onClick={!isRunningAll ? onRunAll : undefined}
            disabled={isRunningAll}
          >
            {isRunningAll
              ? `${runAllProgress.current}/${runAllProgress.total}`
              : 'Run All'}
          </button>
        )}
      </div>

      {/* Run All progress bar */}
      {isRunningAll && (
        <div className="px-3 py-1.5 bg-teal/5 border-b border-teal/20">
          <p className="text-xxs text-teal font-medium">
            Running {runAllProgress.current} of {runAllProgress.total}…
          </p>
          <div className="mt-1 h-1 bg-teal/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal rounded-full transition-all duration-300"
              style={{ width: `${(runAllProgress.current / runAllProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Scenario list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {scenarios.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-caption text-mid-grey">No scenarios yet</p>
            <p className="text-xxs text-light-grey mt-1">Create your first scenario to get started.</p>
          </div>
        ) : (
          scenarios.map(s => (
            <ScenarioCard
              key={s.id}
              scenario={s}
              selected={s.id === selectedId}
              runStatus={runStatuses[s.id] ?? 'idle'}
              onSelect={() => onSelect(s.id)}
              onRun={() => onRun(s.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}
