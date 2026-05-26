/**
 * PhysicsView.jsx — Brief 47 Part 4 (2026-05-24)
 *
 * Live "physics sanity" view for the right-pane visualiser. Reuses
 * existing components (Brief 47 Principle 4: reuse, don't rebuild):
 *
 *   - `HeatBalance` (Brief 28-IM, mode='full') — Sankey or rows layout
 *     of the cumulative heat balance for the current stack state.
 *     Lets Chris catch whether a fabric / gains / systems change makes
 *     physical sense (the "infiltration heat-balance check" Brief 47
 *     Principle 3 calls out).
 *
 * The component takes the same `cumulativeResult` the BeforeAfterBars
 * + Waterfall use — single source of truth from the engine. A small
 * delta badge above the Sankey shows "+/-X kWh/m²·yr vs baseline" so
 * the user can see at a glance whether the current stack state is
 * better or worse than the unedited baseline.
 *
 * Brief 47 explicitly defers carbon-trajectory-over-time + pathway
 * data to a follow-on brief; this view is point-in-time only.
 */

import HeatBalance from '../../balance/HeatBalance.jsx'
import { useUISettings } from '../../../../context/UISettingsContext.jsx'
import { toDisplay, KIND, getGia } from './unitFmt.js'

const INTERVENTIONS_ACCENT = '#E84393'

function pickFirst(result, paths) {
  if (!result) return null
  for (const path of paths) {
    let cur = result
    for (const seg of path.split('.')) {
      if (cur == null) break
      cur = cur[seg]
    }
    if (Number.isFinite(cur)) return cur
  }
  return null
}

function pullEui(r) {
  return pickFirst(r, [
    'consumption.total.kwh_per_m2_yr',
    'results.energy.kwh_per_m2_yr',
  ])
}

export default function PhysicsView({ baselineResult, cumulativeResult, orientationDeg = 0 }) {
  const { unit } = useUISettings()
  const heatBalance = cumulativeResult?.heat_balance ?? null
  const baselineEui = pullEui(baselineResult)
  const cumulativeEui = pullEui(cumulativeResult)
  const delta = (cumulativeEui != null && baselineEui != null) ? (cumulativeEui - baselineEui) : null

  // Convert the delta through the unit helper so the badge matches the
  // global TopBar toggle. The wrapped <HeatBalance> below already honours
  // the same toggle internally (Brief 28-IM Chris UX overhaul 2026-05-17).
  const gia = getGia(baselineResult)
  const deltaConv = delta != null ? toDisplay(delta, KIND.KWH_M2, unit, gia) : { value: null, label: 'kWh/m²·yr' }

  if (!heatBalance) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-center text-xxs text-mid-grey">
        <div className="max-w-sm">
          <p className="font-medium text-navy mb-1">Heat balance unavailable</p>
          <p className="text-mid-grey/80">
            The engine hasn't returned a heat-balance breakdown for the current stack state. Confirm weather data is loaded.
          </p>
        </div>
      </div>
    )
  }

  const deltaValue = deltaConv.value
  const deltaText = deltaValue == null
    ? '—'
    : Math.abs(deltaValue) < 0.05
      ? `0.0 ${deltaConv.label} vs baseline`
      : `${deltaValue < 0 ? '−' : '+'}${Math.abs(deltaValue).toFixed(1)} ${deltaConv.label} vs baseline`
  const deltaTone = deltaValue == null
    ? 'text-mid-grey'
    : Math.abs(deltaValue) < 0.05
      ? 'text-mid-grey'
      : deltaValue < 0 ? 'text-green-700' : 'text-red-700'

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 px-4 py-2 border-b border-light-grey bg-white flex items-baseline justify-between gap-3">
        <div>
          <p className="text-caption font-semibold text-navy">Heat balance — current stack state</p>
          <p className="text-xxs text-mid-grey italic">Every term entering / leaving the zone, with the cumulative impact of all enabled interventions applied.</p>
        </div>
        <span
          className={`flex-shrink-0 text-caption font-semibold tabular-nums ${deltaTone}`}
          title="EUI delta vs the unedited baseline"
        >
          {deltaText}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <HeatBalance
          liveData={heatBalance}
          simulationData={null}
          simulationInfo={null}
          orientationDeg={orientationDeg}
          onElementClick={() => {}}
          mode="full"
        />
      </div>
    </div>
  )
}
