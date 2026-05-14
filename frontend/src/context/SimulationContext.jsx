/**
 * SimulationContext.jsx
 *
 * Manages simulation state for the current project.
 *
 * - runSimulation() calls POST /api/projects/{id}/simulate — the backend reads
 *   all inputs (building, constructions, systems, schedules) from the DB.
 * - On project change, automatically restores the latest successful simulation
 *   results from the DB so they survive page refresh.
 * - Results are normalised to a consistent shape regardless of whether they
 *   came from a live run or were loaded from the DB.
 */

import { createContext, useState, useContext, useEffect, useRef } from 'react'
import { ProjectContext } from './ProjectContext.jsx'

export const SimulationContext = createContext(null)

// ── Normalise DB row → same shape as live simulate response ─────────────────
// Exported so ResultsDashboard can normalize scenario results the same way.

export function normalizeDbResult(row) {
  const ed = row.envelope_heat_flow  // detailed per-facade data
  // Reconstruct basic envelope summary from detailed data so FabricAnalysisTab
  // works after page refresh without needing a separate DB column.
  const envelope = ed ? {
    fabric_conduction_kWh:  ed.summary?.total_fabric_loss_kWh     ?? 0,
    solar_gain_kWh:         ed.summary?.total_solar_gain_kWh      ?? 0,
    infiltration_loss_kWh:  ed.infiltration?.annual_heat_loss_kWh ?? 0,
    infiltration_gain_kWh:  ed.infiltration?.annual_heat_gain_kWh ?? 0,
  } : null

  return {
    run_id:            row.id,
    id:                row.id,
    project_id:        row.project_id,
    scenario_name:     row.scenario_name,
    status:            row.status,
    summary:           row.results_summary,
    monthly_energy:    row.results_monthly,
    annual_energy:     row.annual_energy,
    hourly_profiles:   row.hourly_profiles,
    envelope,
    envelope_detailed: ed,
    sankey_data:       row.sankey_data,
    warnings:          row.energyplus_warnings,
    simulation_time_seconds: row.simulation_time_seconds,
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function SimulationProvider({ children }) {
  const [status,         setStatus]         = useState('idle')   // idle | running | complete | error
  const [runId,          setRunId]          = useState(null)
  const [results,        setResults]        = useState(null)
  const [error,          setError]          = useState(null)
  const [resultsLoading, setResultsLoading] = useState(false)   // true while fetching from DB
  // Brief 28a Part 3d (2026-05-14): auto-simulate default flipped true -> false.
  // The Halt 3 saveSource gating (2026-05-14) prevents system-saves from
  // triggering a surprise Dynamic run, but the default behaviour Chris wants
  // is Dynamic-runs-only-when-explicitly-requested. Power users can enable
  // the toggle from the top bar for auto-Dynamic-on-edit; saveSource gating
  // remains as a safety net for that path.
  const [autoSimulate,   setAutoSimulate]   = useState(false)   // off by default; user opts in via top bar toggle

  const { currentProjectId, saveStatus, saveSource } = useContext(ProjectContext)
  const autoTimerRef = useRef(null)

  // When the project changes, restore the latest complete simulation from the DB
  useEffect(() => {
    if (!currentProjectId) return

    setResults(null)
    setRunId(null)
    setStatus('idle')
    setError(null)
    setResultsLoading(true)

    fetch(`/api/projects/${currentProjectId}/simulations`)
      .then(r => r.ok ? r.json() : [])
      .then(runs => {
        const latest = runs.find(r => r.status === 'complete')
        if (!latest) return null
        return fetch(`/api/projects/${currentProjectId}/simulations/${latest.id}`)
          .then(r => r.ok ? r.json() : null)
      })
      .then(row => {
        if (!row) return
        setResults(normalizeDbResult(row))
        setRunId(row.id)
        setStatus('complete')
      })
      .catch(err => console.error('[SimulationContext] Failed to load latest results:', err))
      .finally(() => setResultsLoading(false))
  }, [currentProjectId])

  // ── Auto-simulate: fire 2 seconds after a USER save completes ────────────
  // Brief 27 cleanup walkthrough Finding 2 fix (2026-05-14): gate on
  // saveSource === 'user' so system-saves (project-load normalisations,
  // migrations, internal updates) don't trigger a surprise 30-45s Dynamic
  // EP run. The Static engine renders state immediately; Dynamic stays
  // explicit (user clicks "Run Dynamic") or fires only after deliberate
  // user edits.
  useEffect(() => {
    if (!autoSimulate || !currentProjectId) return

    if (saveStatus === 'saving') {
      // User is still making changes — cancel any pending auto-sim timer
      if (autoTimerRef.current) {
        clearTimeout(autoTimerRef.current)
        autoTimerRef.current = null
      }
    }

    if (saveStatus === 'saved' && saveSource === 'user') {
      // User edit just completed — start 2s delay before triggering Dynamic.
      // System-saves (saveSource === 'system' or null) do NOT auto-simulate.
      autoTimerRef.current = setTimeout(() => {
        autoTimerRef.current = null
        runSimulation()
      }, 2000)
    }

    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current)
    }
  }, [saveStatus, saveSource, autoSimulate, currentProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Run simulation ─────────────────────────────────────────────────────────

  async function runSimulation() {
    if (!currentProjectId) {
      console.warn('[SimulationContext] No project selected')
      return
    }

    setStatus('running')
    setError(null)

    try {
      const response = await fetch(
        `/api/projects/${currentProjectId}/simulate`,
        { method: 'POST' },
      )

      if (!response.ok) {
        const detail = await response.json().catch(() => ({ detail: 'Unknown error' }))
        throw new Error(detail.detail ?? `HTTP ${response.status}`)
      }

      const data = await response.json()
      setResults(data)
      setRunId(data.run_id)
      setStatus('complete')
    } catch (err) {
      console.error('[SimulationContext] Error:', err)
      setError(err.message ?? 'Simulation failed')
      setStatus('error')
    }
  }

  return (
    <SimulationContext.Provider value={{ status, runId, results, error, resultsLoading, runSimulation, autoSimulate, setAutoSimulate }}>
      {children}
    </SimulationContext.Provider>
  )
}
