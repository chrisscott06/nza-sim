import { useContext, useEffect, useRef, useState } from 'react'
import { Play, Loader2, CheckCircle2, AlertCircle, ChevronDown, ExternalLink, Zap, Activity } from 'lucide-react'
import { SimulationContext } from '../../context/SimulationContext.jsx'
import { ProjectContext } from '../../context/ProjectContext.jsx'
import { useUISettings } from '../../context/UISettingsContext.jsx'
import { useWeather } from '../../context/WeatherContext.jsx'
import { useHourlySolar } from '../../hooks/useHourlySolar.js'
import { calculateInstant } from '../../utils/instantCalc.js'
import { exportAssumptionsXlsx } from '../../utils/assumptionsExport.js'
import ProjectPicker from './ProjectPicker.jsx'

// ── Baseline control (global, every module) ──────────────────────────────────
// The pinned project baseline interventions measure against. Shows sync state,
// with Save/Update, Restore, and Export-baseline-to-Excel. Project-level, so it
// lives in the top bar rather than any one module.
function _fmtBaselineTs(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}
function BaselineControl() {
  const ctx = useContext(ProjectContext)
  const { weatherData } = useWeather()
  const params = ctx?.params
  const hourlySolar = useHourlySolar(weatherData, params?.orientation ?? 0)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!ctx?.currentProjectId) return null
  const drift = ctx.baselineDrift || { pinned: false, drifted: false }

  const chip = !drift.pinned
    ? { label: 'No baseline', cls: 'text-mid-grey border-light-grey bg-white' }
    : drift.drifted
      ? { label: '⚠ Baseline changed', cls: 'text-amber-700 border-amber-300 bg-amber-50' }
      : { label: '✓ Baseline', cls: 'text-green-700 border-green-300 bg-green-50' }

  const handleExportBaseline = async () => {
    setBusy(true)
    try {
      const snap = ctx.baselineSnapshot
      const cfg = snap?.building_config ?? params
      const constr = snap?.construction_choices ?? ctx.constructions
      const cb = snap?.comfort_band ?? ctx.comfortBand
      let libList = []
      try { const r = await fetch('/api/library/constructions'); const d = await r.json(); libList = d.constructions ?? [] } catch {}
      let occ = null
      try {
        const s2 = calculateInstant(cfg, constr, ctx.systems, { constructions: libList },
          weatherData, hourlySolar, null, { mode: 'envelope-gains', comfortBand: cb, _skipInterventions: true })
        occ = s2?.occupancy_summary ?? null
      } catch { /* occupancy line escalates in the collector */ }
      exportAssumptionsXlsx({
        building: cfg, constructions: constr, libraryData: { constructions: libList },
        occupancySummary: occ,
        meta: { scenarioName: (params?.name || 'project') + (snap ? ' — baseline' : ' — current') },
      })
    } finally { setBusy(false); setOpen(false) }
  }
  const act = (fn) => () => { fn?.(); setOpen(false) }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 px-2 py-1 rounded text-xxs font-medium border ${chip.cls}`}
        title="Project baseline — the pinned inputs interventions measure against"
      >
        {chip.label}
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-light-grey rounded-lg shadow-lg z-50 p-2 text-xxs">
          <p className="px-1.5 py-1 text-mid-grey leading-snug">
            {!drift.pinned
              ? 'No baseline pinned. Interventions compare against the live project until you pin one.'
              : drift.drifted
                ? <>⚠ Project inputs have changed since the pinned baseline ({_fmtBaselineTs(drift.saved_at)}). Interventions still measure against the pin.</>
                : <>✓ Baseline pinned ({_fmtBaselineTs(drift.saved_at)}). Project matches it.</>}
          </p>
          <div className="h-px bg-light-grey my-1" />
          <button onClick={act(ctx.saveBaseline)} className="w-full text-left px-1.5 py-1.5 rounded hover:bg-off-white text-navy font-medium">
            {drift.pinned ? 'Update baseline to current inputs' : 'Pin current inputs as baseline'}
          </button>
          {drift.pinned && (
            <button onClick={act(ctx.restoreToBaseline)}
              className={`w-full text-left px-1.5 py-1.5 rounded hover:bg-off-white ${drift.drifted ? 'text-navy font-medium' : 'text-mid-grey'}`}>
              Restore project to baseline
            </button>
          )}
          <div className="h-px bg-light-grey my-1" />
          <button onClick={handleExportBaseline} disabled={busy}
            className="w-full text-left px-1.5 py-1.5 rounded hover:bg-off-white text-navy disabled:opacity-50">
            {busy ? 'Exporting…' : `⬇ Export ${drift.pinned ? 'baseline' : 'current inputs'} to Excel`}
          </button>
        </div>
      )}
    </div>
  )
}

// Chris UX overhaul (2026-05-17) — app-global engine + unit toggles in the
// top bar. Replaces per-view toggles in HeatBalance / SummaryView / etc.
// Flipping either here flips it across every chart and Σ badge in the app.
//
// Brief 32 Part 1 (2026-05-18): Dynamic + Both segments hidden from the UI
// while the Dynamic engine is under reconstruction (Brief 30, paused). The
// Dynamic backend code (sql_parser.py, epjson_assembler.py, simulation
// API endpoints) remains in place per Brief 32 §1.5 — only the UI surface
// changes. The useUISettings engineMode value is still 'static' by default
// and force-set to 'static' below until the Dynamic engine returns. The
// commented-out segments restore as-is when Brief 30 resumes.
function GlobalToggles({ hasSimulation }) {
  const { engineMode, setEngineMode, unit, setUnit } = useUISettings()
  // Force Static while Dynamic is hidden (Brief 32 Part 1). Without this,
  // a stale localStorage value of 'dynamic' or 'both' from before the brief
  // would leak through.
  useEffect(() => {
    if (engineMode !== 'static') setEngineMode('static')
  }, [engineMode, setEngineMode])
  const segCls = (active) =>
    `flex items-center gap-1 px-2 py-1 text-xxs transition-colors ${
      active ? 'bg-white text-navy font-medium shadow-sm' : 'text-mid-grey hover:text-navy'
    }`
  return (
    <div className="flex items-center gap-2">
      {/* Brief 32 Part 1: engine-mode segmented control hidden. The
          Static / Dynamic / Both buttons return when Brief 30 closes.
          See docs/briefs/active/32_static_completion.md §1. */}

      {/* Display mode — Per m² / Total. Applies to every energy + carbon
          number in the app. 2026-05-26 (Chris walkthrough): label changed
          from "kWh/m²·a / kWh" to "Per m² / Total" because the toggle
          drives BOTH energy (kWh ↔ MWh) AND carbon (kgCO₂/m² ↔ tCO₂),
          so a unit-specific label was misleading. Internal storage keys
          stay 'kwh_per_m2' / 'kwh' for back-compat. */}
      <div
        className="flex items-center bg-off-white rounded-md p-0.5 border border-light-grey"
        title="Display mode — Per m² shows intensities (kWh/m²·yr, kgCO₂/m²·yr); Total shows absolutes (MWh, tCO₂)"
      >
        <button
          onClick={() => setUnit('kwh_per_m2')}
          className={`${segCls(unit === 'kwh_per_m2')} rounded`}
        >
          Per m²
        </button>
        <button
          onClick={() => setUnit('kwh')}
          className={`${segCls(unit === 'kwh')} rounded`}
        >
          Total
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

        {/* Project baseline control (global) — the pinned inputs interventions
            measure against; Save / Restore / Export-baseline. */}
        <BaselineControl />

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

        {/* Brief 32 Part 1 (2026-05-18): "Run Dynamic" button hidden while
            the Dynamic engine is under reconstruction (Brief 30, paused).
            handleRun / detectedMode / buttonClass / buttonContent stay
            wired so the button restores cleanly when Brief 30 resumes.
            Original JSX:

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
        */}
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
