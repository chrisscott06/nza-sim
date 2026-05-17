import { useContext, useEffect, useRef, useState } from 'react'
import { Play, Loader2, CheckCircle2, AlertCircle, ChevronDown, ExternalLink, Zap, Activity } from 'lucide-react'
import { SimulationContext } from '../../context/SimulationContext.jsx'
import { ProjectContext } from '../../context/ProjectContext.jsx'
import { useUISettings } from '../../context/UISettingsContext.jsx'
import ProjectPicker from './ProjectPicker.jsx'

// Chris UX overhaul (2026-05-17) — app-global engine + unit toggles in the
// top bar. Replaces per-view toggles in HeatBalance / SummaryView / etc.
// Flipping either here flips it across every chart and Σ badge in the app.
function GlobalToggles({ hasSimulation }) {
  const { engineMode, setEngineMode, unit, setUnit } = useUISettings()
  const segCls = (active) =>
    `flex items-center gap-1 px-2 py-1 text-xxs transition-colors ${
      active ? 'bg-white text-navy font-medium shadow-sm' : 'text-mid-grey hover:text-navy'
    }`
  const dynDisabled = !hasSimulation
  return (
    <div className="flex items-center gap-2">
      {/* Engine mode — Static / Dynamic / Both */}
      <div
        className="flex items-center bg-off-white rounded-md p-0.5 border border-light-grey"
        title="Engine source — applies to all charts"
      >
        <button
          onClick={() => setEngineMode('static')}
          className={`${segCls(engineMode === 'static')} rounded`}
          title="Static — instant in-browser calculation"
        >
          <Zap size={10} />
          Static
        </button>
        <button
          onClick={() => dynDisabled ? null : setEngineMode('dynamic')}
          disabled={dynDisabled}
          className={`${segCls(engineMode === 'dynamic')} rounded disabled:opacity-40 disabled:cursor-not-allowed`}
          title={dynDisabled ? 'No Dynamic run yet — click Run Dynamic first' : 'Dynamic — last EnergyPlus run'}
        >
          <Activity size={10} />
          Dynamic
        </button>
        <button
          onClick={() => dynDisabled ? null : setEngineMode('both')}
          disabled={dynDisabled}
          className={`${segCls(engineMode === 'both')} rounded disabled:opacity-40 disabled:cursor-not-allowed`}
          title={dynDisabled ? 'No Dynamic run yet' : 'Show both engines side by side'}
        >
          Both
        </button>
      </div>

      {/* Unit — kWh/m²·a / kWh */}
      <div
        className="flex items-center bg-off-white rounded-md p-0.5 border border-light-grey"
        title="Display unit — applies to all numbers"
      >
        <button
          onClick={() => setUnit('kwh_per_m2')}
          className={`${segCls(unit === 'kwh_per_m2')} rounded`}
        >
          kWh/m²·a
        </button>
        <button
          onClick={() => setUnit('kwh')}
          className={`${segCls(unit === 'kwh')} rounded`}
        >
          kWh
        </button>
      </div>
    </div>
  )
}

/* Toast notification shown after simulation completes or errors */
function Toast({ message, type, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div
      className={`
        fixed bottom-4 right-4 z-50 flex items-center gap-2
        px-3 py-2 rounded-lg shadow-lg text-white text-caption
        transition-all duration-300
        ${type === 'success' ? 'bg-green-600' : 'bg-coral'}
      `}
    >
      {type === 'success'
        ? <CheckCircle2 size={13} />
        : <AlertCircle size={13} />
      }
      <span>{message}</span>
    </div>
  )
}

/* Save status indicator */
function SaveIndicator({ status }) {
  if (status === 'idle') return null

  const configs = {
    saving: { icon: <Loader2 size={11} className="animate-spin" />, label: 'Saving…',  colour: 'text-mid-grey' },
    saved:  { icon: <CheckCircle2 size={11} />,                      label: 'Saved',    colour: 'text-green-600' },
    error:  { icon: <AlertCircle size={11} />,                       label: 'Save failed', colour: 'text-coral' },
  }

  const cfg = configs[status]
  if (!cfg) return null

  return (
    <span className={`flex items-center gap-1 text-caption ${cfg.colour}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  )
}

export default function TopBar() {
  const { status, results, error, runSimulation, detectedMode } = useContext(SimulationContext)
  const projectCtx = useContext(ProjectContext)
  const buildingName = projectCtx?.params?.name || 'NZA Simulate'
  const saveStatus = projectCtx?.saveStatus ?? 'idle'
  const [toast, setToast] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pendingRunRef = useRef(false)   // true if we're waiting for save to finish

  /* Show toast when simulation completes or errors */
  useEffect(() => {
    if (status === 'complete' && results) {
      const eui = results.summary?.eui_kWh_per_m2 ?? '—'
      setToast({ message: `Simulation complete — EUI: ${eui} kWh/m²`, type: 'success' })
    }
    if (status === 'error' && error) {
      setToast({ message: error, type: 'error' })
    }
  }, [status, results, error])

  /* Trigger simulation once a pending save completes (manual run queued during save) */
  useEffect(() => {
    if (pendingRunRef.current && saveStatus === 'saved') {
      pendingRunRef.current = false
      runSimulation()
    }
  }, [saveStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpenPopOut = () => {
    const width  = 1200
    const height = 800
    const left   = window.screenX + window.outerWidth
    const top    = window.screenY
    window.open(
      '/popout',
      'nza-simulate-popout',
      `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`,
    )
  }

  const handleRun = () => {
    if (status === 'running') return
    setToast(null)
    if (saveStatus === 'saving') {
      // Changes are still being debounced — queue the run
      pendingRunRef.current = true
      return
    }
    runSimulation()
  }

  /* Button appearance by status */
  const buttonClass = (() => {
    if (status === 'running')  return 'bg-magenta opacity-80 cursor-not-allowed animate-pulse'
    if (status === 'complete') return 'bg-green-600 hover:bg-green-700'
    if (status === 'error')    return 'bg-coral hover:bg-coral/90'
    return 'bg-magenta hover:bg-magenta/90'
  })()

  const buttonContent = (() => {
    if (status === 'running')
      return <><Loader2 size={13} className="animate-spin" /><span>Running Dynamic…</span></>
    if (status === 'complete')
      return <><CheckCircle2 size={13} /><span>Re-run Dynamic</span></>
    if (status === 'error')
      return <><AlertCircle size={13} /><span>Retry Dynamic</span></>
    return <><Play size={13} fill="currentColor" /><span>Run Dynamic</span></>
  })()

  return (
    <>
      <header className="h-12 bg-white border-b border-light-grey flex items-center px-4 gap-4 flex-shrink-0 relative">
        {/* Project name — click to open picker */}
        <button
          onClick={() => setPickerOpen(v => !v)}
          className="flex items-center gap-1.5 text-section font-medium text-navy hover:text-magenta transition-colors"
        >
          {buildingName}
          <ChevronDown size={14} className={`transition-transform ${pickerOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Project picker dropdown */}
        {pickerOpen && <ProjectPicker onClose={() => setPickerOpen(false)} />}

        {/* Save status indicator */}
        <SaveIndicator status={saveStatus} />

        <div className="flex-1" />

        {/* Global engine + unit toggles — Chris UX overhaul (2026-05-17).
            App-wide; replaces per-view toggles in each module's header. */}
        <GlobalToggles hasSimulation={status === 'complete' && !!results} />

        {/* Pop-out results window */}
        <button
          onClick={handleOpenPopOut}
          title="Open results pop-out window (second screen)"
          className="flex items-center gap-1 px-2 py-1 rounded text-xxs border border-light-grey bg-white text-mid-grey hover:border-navy hover:text-navy transition-colors"
        >
          <ExternalLink size={11} />
          Pop Out
        </button>

        {/* Auto-simulate removed (Chris UX overhaul 2026-05-17). The toggle
            existed in SimulationContext as autoSimulate / setAutoSimulate
            but was visually noisy in the top bar. Re-run Dynamic is the
            single explicit run trigger; auto on every change was too eager
            on a real Dynamic run (EnergyPlus seconds, not browser ms). */}

        {/* Run Dynamic button — Brief 28a Part 8: tooltip shows the state-
            aware mode that will actually trigger (envelope-only / envelope-
            gains / envelope-gains-operation / full), based on which config
            sections are populated on the current project. */}
        <button
          onClick={handleRun}
          disabled={status === 'running'}
          title={
            status === 'running'
              ? 'EnergyPlus is running…'
              : `Run EnergyPlus in ${detectedMode ?? 'full'} mode\n` +
                (detectedMode === 'envelope-only'
                  ? '— State 1, fastest run; no internal gains, no systems'
                  : detectedMode === 'envelope-gains'
                    ? '— State 2; envelope + internal gains, no real systems, no operable windows'
                    : detectedMode === 'envelope-gains-operation'
                      ? '— State 2.5; adds operable windows. Falls through to envelope-gains until Brief 30 lands the assembler support.'
                      : '— State 3; full model: envelope + gains + operation + real systems')
          }
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded
            text-white text-caption font-medium
            transition-all duration-200 select-none
            ${buttonClass}
          `}
        >
          {buttonContent}
        </button>
      </header>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </>
  )
}
