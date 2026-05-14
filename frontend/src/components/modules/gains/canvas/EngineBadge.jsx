/**
 * EngineBadge.jsx — small chip labelling which engine produced the
 * numbers in an engine-dependent canvas view.
 *
 * Brief 27 close-out follow-up. The State 1 → State 2 Delta view + the
 * Heat balance + Free-running views all surface engine output that comes
 * from the Static engine (instantCalc.js) right now. Without labelling,
 * the numbers look like they could be from either engine — and Brief 28
 * prereq close (2026-05-14) confirmed real Static vs Dynamic divergences
 * (lumped two-node mass model, summer-max ~8.8K gap on Bridgewater) so
 * it MATTERS which engine the user is reading.
 *
 * Tooltip explains the engine choice + that the Static | Dynamic toggle
 * will land when the State 2 EP results plumbing carries through
 * (Brief 28a Part 5). Terminology renamed Live -> Static, Simulation ->
 * Dynamic per Brief 28a Part 1.
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
