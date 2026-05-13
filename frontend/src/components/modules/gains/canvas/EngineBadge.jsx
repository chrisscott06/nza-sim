/**
 * EngineBadge.jsx — small chip labelling which engine produced the
 * numbers in an engine-dependent canvas view.
 *
 * Brief 27 close-out follow-up. The State 1 → State 2 Delta view + the
 * Heat balance + Free-running views all surface engine output that comes
 * from the LIVE engine (instantCalc.js) right now. Without labelling,
 * the numbers look like they could be from either engine — and the
 * Brief 26.2 close documented Live vs Sim divergences (isotropic sky
 * residual on solar gain, especially for high-WWR-on-side-facades
 * configs) so it MATTERS which engine the user is reading.
 *
 * Tooltip explains the engine choice + that the Live | Simulation
 * toggle will land when the State 2 EP results plumbing carries through
 * (Brief 28).
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
          ? 'Numbers from the live engine (instantCalc.js). The simulation toggle (EnergyPlus) lands once State 2 EP results plumbing is wired in Brief 28. See docs/state_2_part2_verification.md for Live vs Sim divergences.'
          : 'Numbers from the EnergyPlus simulation engine.'
      }
    >
      <Zap size={9} />
      {isLive ? 'Live engine' : 'Simulation'}
    </span>
  )
}
