import { useContext, useEffect, useState } from 'react'
import { Play, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { SimulationContext } from '../../context/SimulationContext.jsx'
import { BuildingContext } from '../../context/BuildingContext.jsx'

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

export default function TopBar() {
  const { status, results, error, runSimulation } = useContext(SimulationContext)
  const buildingCtx = useContext(BuildingContext)
  const buildingName = buildingCtx?.params?.name || 'NZA Simulate'
  const [toast, setToast] = useState(null)

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

  const handleRun = () => {
    if (status === 'running') return
    setToast(null)
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
      <header className="h-12 bg-white border-b border-light-grey flex items-center px-4 gap-4 flex-shrink-0">
        {/* Project name — reads dynamically from BuildingContext */}
        <span className="text-section font-medium text-navy">{buildingName}</span>

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
