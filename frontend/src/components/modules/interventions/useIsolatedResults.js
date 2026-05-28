/**
 * useIsolatedResults.js
 *
 * Brief 71 Part 1 — Isolated evaluation hook for the Interventions module.
 *
 * Runs each intervention ALONE against the untouched baseline by reusing
 * `runInterventionStack` with a singleton list (Principle 1: reuse the engine,
 * never re-implement it). The result is one row per intervention with the
 * isolated cumulative_delta — i.e. the building delta when ONLY this measure
 * is applied.
 *
 * Isolated ≠ marginal:
 *   - In the COMBINED stack, intervention i's `marginal_delta` is computed on
 *     top of all enabled interventions above it (compounded baseline shifts).
 *   - In the ISOLATED pass, every measure is measured from the same untouched
 *     baseline — useful for ranking measures by standalone impact but they
 *     DO NOT sum to the combined total (Principle 4).
 *
 * Falsifiability #1: when the first intervention in the stack is enabled, its
 * isolated `cumulative_delta` MUST equal its `marginal_delta` in the full
 * stack (because nothing was applied before it — isolated and stacked baseline
 * are identical for the first row). The console assertion below is removed in
 * Part 2 once the Isolated view is the visible source of truth.
 *
 * Memoisation: `[interventions, baselineConfig]`. The cost is one extra
 * runInterventionStack call per intervention — for Bridgewater (N=2) that's
 * 2 × ~550 ms baseline + patched runs ≈ ~2 s additional on first render and
 * any time interventions or baselineConfig change identity (per the perf
 * audit, Brief 44 Part 5d).
 */

import { useMemo } from 'react'
import { runInterventionStack } from '../../../utils/interventionsEngine.js'

/**
 * @param {Array<object>} interventions  — Full list (including disabled rows).
 * @param {object} baselineConfig        — `{ building, constructions, systems, libraryData }`
 *                                          shaped exactly as `runInterventionStack` expects.
 * @param {Function} runEngine           — `(cfg) => result` engine closure used by
 *                                          the combined stack call upstream.
 * @param {object} libraryData           — Library bundle for patch resolution.
 * @param {object} [stackResult]         — Optional combined stack result. When
 *                                          provided, the hook fires falsifiability
 *                                          #1 (first-enabled isolated == first-enabled
 *                                          marginal) as a console assertion. Removed
 *                                          in Part 2.
 * @returns {Array<{
 *   id: string|null,
 *   label: string,
 *   theme: string|null,
 *   enabled: boolean,
 *   isolatedResult: object,
 *   cumulativeDelta: object|null,
 * }>}
 */
export function useIsolatedResults(interventions, baselineConfig, runEngine, libraryData, stackResult = null) {
  return useMemo(() => {
    if (!Array.isArray(interventions) || interventions.length === 0) return []
    if (!baselineConfig || typeof runEngine !== 'function') return []

    const rows = interventions.map((intervention) => {
      // Force-enable the singleton copy so disabled rows still produce a
      // visible isolated number — the Isolated view shows all (Principle 3
      // implicit: enabled is a stack-membership signal, not a "delete me").
      const singleton = [{ ...intervention, enabled: true }]
      const isolated = runInterventionStack(baselineConfig, singleton, runEngine, libraryData)
      const row = isolated?.interventions?.[0] ?? null
      return {
        id:               intervention?.id ?? null,
        label:            intervention?.label ?? intervention?.id ?? '(untitled)',
        theme:            intervention?.theme ?? null,
        enabled:          intervention?.enabled !== false,
        isolatedResult:   isolated,
        cumulativeDelta:  row?.cumulative_delta ?? null,
      }
    })

    // Falsifiability #1 — first-enabled isolated cumulative_delta must equal
    // its marginal_delta in the full combined stack. The combined-stack-side
    // marginal for the FIRST enabled row is computed from baseline → +1
    // (nothing else applied above it), so by construction it equals the
    // isolated cumulative_delta. If this assertion fires, the isolated pass
    // is NOT reusing engine semantics correctly — escalate per the brief.
    //
    // Removed in Part 2 once the Isolated view renders the comparison visibly.
    if (stackResult && Array.isArray(stackResult.interventions) && stackResult.interventions.length > 0) {
      const firstEnabledIdx = interventions.findIndex(i => i?.enabled !== false)
      if (firstEnabledIdx >= 0) {
        const isoCum = rows[firstEnabledIdx]?.cumulativeDelta
        const stkMrg = stackResult.interventions[firstEnabledIdx]?.marginal_delta
        const isoEUI = isoCum?.energy_use?.totals?.eui_kwh_per_m2?.delta
                    ?? isoCum?.eui?.delta
                    ?? null
        const stkEUI = stkMrg?.energy_use?.totals?.eui_kwh_per_m2?.delta
                    ?? stkMrg?.eui?.delta
                    ?? null
        if (Number.isFinite(isoEUI) && Number.isFinite(stkEUI)) {
          const drift = Math.abs(isoEUI - stkEUI)
          if (drift > 0.05) {
            // eslint-disable-next-line no-console
            console.warn(
              '[Brief 71 falsifiability #1 FAIL] ' +
              `isolated[0].cumulative_delta.EUI (${isoEUI.toFixed(3)}) !== ` +
              `stack[0].marginal_delta.EUI (${stkEUI.toFixed(3)}) — ` +
              `drift ${drift.toFixed(3)} kWh/m². Isolated pass may not be ` +
              'reusing engine semantics correctly. Escalate (see brief).'
            )
          } else {
            // eslint-disable-next-line no-console
            console.log(
              '[Brief 71 falsifiability #1 PASS] ' +
              `isolated[0]=${isoEUI.toFixed(3)} stack[0]=${stkEUI.toFixed(3)} ` +
              `kWh/m² (drift ${drift.toFixed(3)})`
            )
          }
        }
      }
    }

    return rows
  }, [interventions, baselineConfig, runEngine, libraryData, stackResult])
}

export default useIsolatedResults
