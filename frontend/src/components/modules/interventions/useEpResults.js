/**
 * useEpResults.js — Brief 95 P7 (EnergyPlus results, read side)
 *
 * Fetches the EnergyPlus batch results for the CURRENT project config and exposes
 * them keyed by state descriptor, so the per-intervention views can render a
 * NZA-Sim | EP | Δ% comparison beside their own numbers.
 *
 * Data flow (read-only — never triggers an EP run; that's EPValidationPanel):
 *   1. POST /api/ep/batch/plan with a FULL selection (cumulative + every isolated)
 *      → the CURRENT config hash + cached flag for every state. Because the hash is
 *      over the current resolved config, an edited-then-Applied definition yields a
 *      NEW hash → its cached flag flips false (Brief 95 P6 invariant, reused here).
 *   2. For each cached (done) state, GET /api/ep/result/{hash} → the stored EP result.
 *
 * Stale-guard (the P7 requirement): we remember, per descriptor, the last hash we
 * showed a FRESH result for. On refresh:
 *   - current hash is cached      → status 'fresh'  (show EP value + Δ%)
 *   - current hash NOT cached, but we previously showed a result under a DIFFERENT
 *     hash                        → status 'stale'  (grey the old EP figure, "re-run")
 *   - otherwise                   → status 'none'   (em-dash — never run)
 * This guarantees a stale EP number is NEVER presented as if it matched the current
 * config: after edit+Apply the figure greys to "stale — re-run", and re-running
 * repopulates it fresh.
 *
 * NZA-Sim-only detection is hash-based and needs no server flag: an intervention
 * whose patches are all nza_sim_only produces a patch-free isolated config identical
 * to the baseline, so its isolated hash === baseline hash. Consumers use
 * `isNzaOnly(id)` for the badge.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const EMPTY = { byDesc: {}, states: [], baselineHash: null, loading: false }

export function useEpResults(projectId, interventions = []) {
  const [data, setData] = useState(EMPTY)
  const memRef = useRef({})   // descriptor -> { hash, result }  (last FRESH result seen this session)

  // Re-fetch whenever the project OR the resolved strategy changes. The signature
  // MUST fold in ORDER (index) and the ENABLED flag as well as patches: disabling or
  // reordering a measure changes the cumulative EP chain (new hashes), and if the
  // signature ignored those the view would keep showing an old EP figure as current
  // (a stale number presented as fresh — the exact failure the guard must prevent).
  const ivSig = interventions
    .map((i, idx) => `${idx}:${i.id}:${i.enabled !== false ? 1 : 0}:${JSON.stringify(i.patches || [])}`)
    .join('|')

  const refresh = useCallback(async () => {
    if (!projectId) { setData(EMPTY); return }
    setData(d => ({ ...d, loading: true }))
    try {
      const allIds = interventions.map(i => i.id)
      const r = await fetch('/api/ep/batch/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selection: { cumulative: true, isolated: allIds }, project_id: projectId }),
      })
      const plan = await r.json()
      const planStates = Array.isArray(plan?.states) ? plan.states : []

      const resolved = await Promise.all(planStates.map(async (s) => {
        if (s.cached) {
          try {
            const rr = await fetch(`/api/ep/result/${s.config_hash}`)
            const d = await rr.json()
            if (d?.results) {
              memRef.current[s.descriptor] = { hash: s.config_hash, result: d.results }
              return { descriptor: s.descriptor, hash: s.config_hash, status: 'fresh', result: d.results }
            }
          } catch { /* fall through to stale/none */ }
        }
        const mem = memRef.current[s.descriptor]
        if (mem && mem.hash !== s.config_hash) {
          return { descriptor: s.descriptor, hash: s.config_hash, status: 'stale', result: mem.result }
        }
        return { descriptor: s.descriptor, hash: s.config_hash, status: 'none', result: null }
      }))

      const byDesc = {}
      for (const st of resolved) byDesc[st.descriptor] = st
      const baselineHash = byDesc.baseline?.hash ?? null
      setData({ byDesc, states: resolved, baselineHash, loading: false })
    } catch {
      setData({ ...EMPTY, loading: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, ivSig])

  useEffect(() => { refresh() }, [refresh])

  const byDesc = data.byDesc
  const isNzaOnly = useCallback((id) => {
    const iso = byDesc[`isolated:${id}`]
    return !!(iso && data.baselineHash && iso.hash === data.baselineHash)
  }, [byDesc, data.baselineHash])

  return { ...data, isNzaOnly, refresh }
}

export default useEpResults
