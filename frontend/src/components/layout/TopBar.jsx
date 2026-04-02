import { useContext, useEffect, useRef, useState } from 'react'
import { Play, Loader2, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react'
import { SimulationContext } from '../../context/SimulationContext.jsx'
import { ProjectContext } from '../../context/ProjectContext.jsx'
import ProjectPicker from './ProjectPicker.jsx'

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
  const { status, results, error, runSimulation } = useContext(SimulationContext)
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

  /* Auto-trigger simulation once a pending save completes */
  useEffect(() => {
    if (pendingRunRef.current && saveStatus === 'saved') {
      pendingRunRef.current = false
      runSimulation()
    }
  }, [saveStatus]) // eslint-disable-line react-hooks/exhaustive-deps

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
      return <><Loader2 size={13} className="animate-spin" /><span>Simulating…</span></>
    if (status === 'complete')
      return <><CheckCircle2 size={13} /><span>Re-run Simulation</span></>
    if (status === 'error')
      return <><AlertCircle size={13} /><span>Retry Simulation</span></>
    return <><Play size={13} fill="currentColor" /><span>Run Simulation</span></>
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

        {/* Run Simulation button */}
        <button
          onClick={handleRun}
          disabled={status === 'running'}
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
