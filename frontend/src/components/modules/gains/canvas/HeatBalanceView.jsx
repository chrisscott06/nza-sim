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
        <h2 className="text-base font-semibold text-navy">Heat balance</h2>
        <p className="text-xxs text-mid-grey mt-0.5">
          Annual gains and losses through the State 2 (envelope + internal gains)
          balance. Multi-profile lighting + equipment surface as their per-
          category aggregates here; for the per-profile slice see the Annual
          breakdown tab.
        </p>
      </div>
      <HeatBalance balance={state2} mode="envelope-gains" />
    </div>
  )
}
