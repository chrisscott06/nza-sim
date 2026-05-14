/**
 * HeatBalanceView.jsx — embeds the existing /balance HeatBalance
 * component fed with the State 2 result, so users see where gains
 * land in the full heat-balance flow (alongside fabric, solar,
 * mechanical heating if present).
 *
 * Brief 27 Revised Part 11.
 */

import { useStateComparison } from './useStateComparison.js'
import HeatBalance from '../../balance/HeatBalance.jsx'
import EngineBadge from './EngineBadge.jsx'

export default function HeatBalanceView() {
  const { state2, ready, libraryLoading } = useStateComparison()

  if (!ready) {
    return (
      <div className="mx-auto px-6 py-8 max-w-[1000px]">
        <p className="text-caption text-mid-grey">
          {libraryLoading ? 'Loading constructions library…' : 'Waiting for engine output…'}
        </p>
      </div>
    )
  }

  // The existing HeatBalance component reads from `heat_balance.annual`
  // (gains + losses + totals) and `demand` (heating / cooling / hour
  // distributions). Our State 2 output mirrors that exact shape per the
  // v2.4 contract — pass directly through.
  return (
    <div className="mx-auto px-6 py-5 max-w-[1100px]">
      <div className="pb-3 border-b border-light-grey mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-navy">Heat balance</h2>
          <EngineBadge />
        </div>
        <p className="text-xxs text-mid-grey mt-0.5">
          Annual gains and losses through the State 2 (envelope + internal gains)
          balance. Multi-profile lighting + equipment surface as their per-
          category aggregates here; for the per-profile slice see the Annual
          breakdown tab.
        </p>
      </div>
      {/* Unwrap state2.heat_balance — _calculateState2 nests annual / metadata /
          losses / gains under .heat_balance (per the engine's design comment
          "Mirror the state1 heat_balance shape so the existing HeatBalance
          component renders State 2 without further changes"). Passing the
          full state2 object causes data.annual to be undefined and the
          "No heat balance data available" empty state fires. Brief 27 cleanup
          Part 3 (2026-05-14) fixed this after the Part 1 prop-rename was
          discovered to be necessary-but-insufficient via Chris's walkthrough. */}
      <HeatBalance liveData={state2?.heat_balance} mode="envelope-gains" />
    </div>
  )
}
