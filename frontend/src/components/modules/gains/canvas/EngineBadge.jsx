/**
 * EngineBadge.jsx — small chip labelling which engine produced the
 * numbers in an engine-dependent canvas view.
 *
 * Brief 27 close-out follow-up. Surfaces which engine (Static / Dynamic)
 * produced the data — important because the top-bar toggle (Brief 29
 * UX overhaul) lets the user flip globally; per-view chips confirm the
 * choice landed here.
 *
 * Brief 29 Commit B (cleanup): previous docstring referenced "real Static
 * vs Dynamic divergences (lumped two-node mass model, summer-max ~8.8K
 * gap on Bridgewater)" — that 8.8K figure is undefended per Brief 29
 * Hard Rule 2 and the lumped-2-node attribution is on the banned-
 * mechanisms list until the audit lands a heat-balance derivation.
 */

import { Zap } from 'lucide-react'

export default function EngineBadge({ engine = 'live' }) {
  const isLive = engine === 'live'
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xxs uppercase tracking-wider font-medium ${
        isLive
          ? 'bg-teal/15 text-teal border border-teal/30'
          : 'bg-mid-grey/15 text-mid-grey border border-mid-grey/30'
      }`}
      title={
        isLive
          ? 'Static engine — instant calculation from instantCalc.js, updates as you edit inputs. The Dynamic toggle (EnergyPlus) lands once State 2 EP results plumbing is wired in Brief 28a Part 5. See docs/state_1_engine_divergence_investigation.md for Static vs Dynamic divergences.'
          : 'Dynamic engine — full EnergyPlus simulation, run on demand.'
      }
    >
      <Zap size={9} />
      {isLive ? 'Static' : 'Dynamic'}
    </span>
  )
}
