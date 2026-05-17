/**
 * HeatBalanceView.jsx — embeds the existing /balance HeatBalance
 * component fed with the State 2 result, so users see where gains
 * land in the full heat-balance flow (alongside fabric, solar,
 * mechanical heating if present).
 *
 * Brief 27 Revised Part 11.
 */

import { useContext } from 'react'
import { useStateComparison } from './useStateComparison.js'
import HeatBalance from '../../balance/HeatBalance.jsx'
// Brief 28-IM-Polish POL-M2: shared cross-module chart-consistency
// components. Local EngineBadge replaced with shared EnginePill so the
// pattern matches Building / Operation / Systems / Results.
import EnginePill from '../../../shared/EnginePill.jsx'
import ChartTotalsBadge from '../../../shared/ChartTotalsBadge.jsx'
import { ProjectContext } from '../../../../context/ProjectContext.jsx'

export default function HeatBalanceView() {
  const { state2, ready, libraryLoading } = useStateComparison()
  // Brief 28a Part 5 walkthrough Finding HB1a (2026-05-14): pass
  // orientationDeg so facade compass labels match the Building module
  // (where `BuildingDefinition.jsx:860` passes the same value). Without
  // this, labels default to 0 deg regardless of `params.orientation` and
  // Internal Gains shows "F1 (N)" while Building shows "F1 (NE)" for the
  // same facade at orientation 42 deg.
  const { params } = useContext(ProjectContext)
  const orientationDeg = Number(params?.orientation ?? 0)

  if (!ready) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto px-6 py-8 max-w-[1000px]">
          <p className="text-caption text-mid-grey">
            {libraryLoading ? 'Loading constructions library…' : 'Waiting for engine output…'}
          </p>
        </div>
      </div>
    )
  }

  // The existing HeatBalance component reads from `heat_balance.annual`
  // (gains + losses + totals) and `demand` (heating / cooling / hour
  // distributions). Our State 2 output mirrors that exact shape per the
  // v2.4 contract — pass directly through.
  return (
    // Brief 28a Part 5 walkthrough scroll fix (2026-05-14): bounded outer
    // container with internal overflow. Tab content area is overflow-hidden;
    // HeatBalance is a multi-section dashboard so internal scroll is fine.
    <div className="h-full overflow-y-auto">
    <div className="mx-auto px-6 py-5 max-w-[1100px]">
      <div className="pb-3 border-b border-light-grey mb-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-navy">Heat balance</h2>
            <EnginePill mode="static" />
          </div>
          {/* Brief 28-IM-Polish POL-M2 §4.1: chart totals badge in the
              header so the user can verify cross-view consistency with
              Summary + Monthly. Σ shown is annual gain TOTAL (people +
              lighting + equipment) since this is the gains-side hero. */}
          <ChartTotalsBadge
            label="Σ gains"
            value_kwh={
              ((state2?.heat_balance?.annual?.gains?.internal?.people?.kwh ?? 0)
              + (state2?.heat_balance?.annual?.gains?.internal?.lighting?.kwh ?? 0)
              + (state2?.heat_balance?.annual?.gains?.internal?.equipment?.kwh ?? 0))
            }
            gia_m2={state2?.heat_balance?.metadata?.gia_m2 ?? 0}
          />
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
      <HeatBalance
        liveData={state2?.heat_balance}
        mode="envelope-gains"
        orientationDeg={orientationDeg}
        modules={['fabric', 'thermal_bridging', 'fabric_leakage', 'permanent_vents', 'internal_gains']}
      />
    </div>
    </div>
  )
}
