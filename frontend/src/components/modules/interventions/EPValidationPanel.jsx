// Brief 95 P6 — "Validate with EnergyPlus" panel (strategy view).
//
// Cumulative-chain toggle + per-intervention isolated checkboxes → a run selection.
// The live "N runs · ~est · M cached" count comes from POST /api/ep/batch/plan, which
// hashes the CURRENT project config server-side — so after editing a definition + Apply,
// its states show as "will run", never as stale cached hits. Run → POST /batch/start
// (non-blocking) → poll /batch/{id} for live per-state status.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, CheckCircle2, XCircle, Database, Play } from 'lucide-react'

const INTERVENTIONS_ACCENT = '#E5506A'
const STATUS = {
  queued:  { label: 'queued',  cls: 'text-mid-grey/60' },
  running: { label: 'running', cls: 'text-navy' },
  done:    { label: 'done',    cls: 'text-green-600' },
  cached:  { label: 'cached',  cls: 'text-mid-grey/70' },
  failed:  { label: 'failed',  cls: 'text-red-600' },
}

export default function EPValidationPanel({ interventions = [], projectId, onResultsChanged }) {
  const [cumulative, setCumulative] = useState(true)
  const [isolated, setIsolated] = useState(() => new Set())
  const [plan, setPlan] = useState(null)        // { states, n_runs, n_cached }
  const [batchId, setBatchId] = useState(null)
  const [progress, setProgress] = useState(null) // { states: [...] }
  const pollRef = useRef(null)

  const selection = useMemo(
    () => ({ cumulative, isolated: [...isolated] }),
    [cumulative, isolated],
  )

  // Live plan (current-hash cache count) — re-runs whenever the selection OR the
  // interventions (edits) change, so cached reflects the CURRENT config.
  const refreshPlan = useCallback(async () => {
    if (!projectId) return
    try {
      const r = await fetch('/api/ep/batch/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selection, project_id: projectId }),
      })
      setPlan(await r.json())
    } catch { setPlan({ error: 'plan failed', states: [] }) }
  }, [projectId, selection])

  // Fold in ORDER + ENABLED (not just patches): reordering/toggling changes the
  // cumulative chain, so the plan (run count + cached flags) must re-evaluate.
  const ivSig = interventions
    .map((i, idx) => `${idx}:${i.id}:${i.enabled !== false ? 1 : 0}:${JSON.stringify(i.patches || [])}`)
    .join('|')
  useEffect(() => { refreshPlan() }, [refreshPlan, ivSig])

  const poll = useCallback((id) => {
    clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/ep/batch/${id}`)
        const d = await r.json()
        setProgress(d)
        const states = d.states || []
        if (states.length && states.every(s => ['done', 'cached', 'failed'].includes(s.status))) {
          clearInterval(pollRef.current)
          refreshPlan()          // refresh cached count now that runs are stored
          onResultsChanged?.()   // repopulate the NZA|EP|Δ% columns + trajectory (Brief 95 P7)
        }
      } catch { /* keep polling */ }
    }, 1500)
  }, [refreshPlan, onResultsChanged])

  useEffect(() => () => clearInterval(pollRef.current), [])

  const run = async () => {
    setProgress(null)
    const r = await fetch('/api/ep/batch/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selection, project_id: projectId }),
    })
    const { batch_id } = await r.json()
    if (batch_id) { setBatchId(batch_id); poll(batch_id) }
  }

  const toggleIso = (id) => setIsolated(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const nRuns = plan?.n_runs ?? 0
  const nCached = plan?.n_cached ?? 0
  const estMin = Math.max(1, Math.ceil(nRuns * 0.5))   // ~0.5 min/run headroom (actual ≈1 s)
  const running = progress && (progress.states || []).some(s => s.status === 'running' || s.status === 'queued')

  return (
    <div className="rounded-xl border border-light-grey bg-white p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Database size={15} style={{ color: INTERVENTIONS_ACCENT }} />
        <h3 className="text-sm font-semibold text-navy">Validate with EnergyPlus</h3>
        <span className="ml-auto text-xxs text-mid-grey">EP 25-2-0 · side-by-side, non-destructive</span>
      </div>

      <label className="flex items-center gap-2 text-xs text-navy cursor-pointer">
        <input type="checkbox" checked={cumulative} onChange={e => setCumulative(e.target.checked)} />
        Cumulative chain (baseline + each step in order)
      </label>

      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey/70 mb-1">Isolated runs</p>
        <div className="space-y-1 max-h-40 overflow-auto">
          {interventions.map(iv => {
            const nzaOnly = iv._nza_sim_only   // reserved: none in the current stack
            return (
              <label key={iv.id}
                className={`flex items-center gap-2 text-xs ${nzaOnly ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer text-navy'}`}>
                <input type="checkbox" disabled={nzaOnly}
                  checked={isolated.has(iv.id)} onChange={() => toggleIso(iv.id)} />
                <span className="truncate">{iv.label || '(untitled)'}</span>
                {nzaOnly ? <span className="text-[10px] text-mid-grey ml-auto flex-shrink-0">NZA-Sim only</span> : null}
              </label>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1 border-t border-light-grey/60">
        <span className="text-xs text-navy tabular-nums">
          <strong>{nRuns}</strong> run{nRuns === 1 ? '' : 's'} · ~{estMin} min · <span className="text-mid-grey">{nCached} cached</span>
        </span>
        <button type="button" onClick={run} disabled={running || (nRuns === 0 && nCached === 0)}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-medium disabled:opacity-40 hover:opacity-90"
          style={{ backgroundColor: INTERVENTIONS_ACCENT }}>
          {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          {running ? 'Running…' : 'Run EnergyPlus'}
        </button>
      </div>

      {progress?.states?.length ? (
        <div className="space-y-0.5 pt-1">
          {progress.states.map(s => {
            const st = STATUS[s.status] || STATUS.queued
            const Icon = s.status === 'done' ? CheckCircle2 : s.status === 'failed' ? XCircle
              : s.status === 'running' ? Loader2 : s.status === 'cached' ? Database : Loader2
            return (
              <div key={s.config_hash} className="flex items-center gap-2 text-xxs">
                <Icon size={11} className={`${st.cls} ${s.status === 'running' ? 'animate-spin' : ''} flex-shrink-0`} />
                <span className="truncate text-navy">{s.descriptor}</span>
                <span className={`ml-auto ${st.cls}`}>{st.label}
                  {s.results ? ` · EUI ${s.results.eui_kwh_per_m2_yr}` : ''}</span>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
