/**
 * SummaryView.jsx — Internal Gains module headline tab.
 *
 * Brief 28a Part 3a (2026-05-14): placeholder Summary tab introduced as
 * the new default landing tab for Internal Gains. The fuller layout
 * (paired-bar Delta + per-gain attribution + gains-vs-demand stacked
 * bar) lands in:
 *   - Part 3b: Delta content folded in here (from the existing
 *     DeltaView, which gets removed from the tab strip in 3b too).
 *   - Part 2 sub-step 3 (originally deferred): the stacked-bar gains-
 *     vs-demand chart with unit toggle. Fused into 3b along with the
 *     Delta fold so both pieces of the headline live in one place.
 *
 * For 3a, the view shows the bare headline numbers so the default tab
 * is functional from the moment it ships. Nothing user-facing is
 * removed; the Delta tab is still in the tab strip pending 3b.
 */

import { useStateComparison } from './useStateComparison.js'
import EngineBadge from './EngineBadge.jsx'

function fmtMWh(v) {
  if (v == null) return '—'
  return `${Number(v).toFixed(1)} MWh`
}

function fmtKWhM2(kwh, gia) {
  if (kwh == null || !gia) return '—'
  return `${Math.round(kwh / gia)} kWh/m²·yr`
}

export default function SummaryView() {
  const { state1, state2, ready, libraryLoading } = useStateComparison()

  if (!ready) {
    return (
      <div className="mx-auto px-6 py-8 max-w-[1000px]">
        <p className="text-caption text-mid-grey">
          {libraryLoading ? 'Loading constructions library…' : 'Waiting for engine output…'}
        </p>
      </div>
    )
  }

  const gia = state2?.heat_balance?.metadata?.gia_m2 ?? 0
  const s1_demand = state1?.demand ?? {}
  const s2_demand = state2?.demand ?? {}
  const s2_gains  = state2?.gains   ?? {}

  // Internal gains sum (kWh) — from state2 top-level gains block
  const gains_kwh = (s2_gains.people?.total_kwh ?? 0) * 1000
                  + (s2_gains.lighting?.total_kwh ?? 0) * 1000
                  + (s2_gains.equipment?.total_kwh ?? 0) * 1000
  // Convert to MWh for the headline
  const gains_mwh = gains_kwh / 1_000_000

  const heating_change = (s2_demand.heating_demand_mwh ?? 0) - (s1_demand.heating_demand_mwh ?? 0)
  const cooling_change = (s2_demand.cooling_demand_mwh ?? 0) - (s1_demand.cooling_demand_mwh ?? 0)

  return (
    <div className="mx-auto px-6 py-5 max-w-[1000px]">
      <div className="pb-3 border-b border-light-grey mb-5">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-navy">Summary</h2>
          <EngineBadge />
        </div>
        <p className="text-xxs text-mid-grey mt-0.5">
          Headline numbers for the State 2 (envelope + internal gains) balance.
          State 1 → State 2 delta + gains-vs-demand chart land in Brief 28a Part 3b.
        </p>
      </div>

      {/* Headline stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Internal gains"
              primary={fmtMWh(gains_mwh)}
              sub={fmtKWhM2(gains_kwh / 1000, gia)} />
        <Stat label="Heating demand"
              primary={fmtMWh(s2_demand.heating_demand_mwh)}
              sub={fmtKWhM2(s2_demand.heating_demand_mwh * 1000, gia)}
              delta={heating_change}
              deltaUnit="MWh" />
        <Stat label="Cooling demand"
              primary={fmtMWh(s2_demand.cooling_demand_mwh)}
              sub={fmtKWhM2(s2_demand.cooling_demand_mwh * 1000, gia)}
              delta={cooling_change}
              deltaUnit="MWh" />
        <Stat label="Comfort hours"
              primary={`${s2_demand.comfort_hours ?? '—'}`}
              sub={`of 8,760 (${Math.round((s2_demand.comfort_hours ?? 0) / 8760 * 100)}%)`} />
      </div>

      <div className="text-xxs text-mid-grey/80 italic leading-tight">
        Detailed State 1 → State 2 delta with paired bars + per-profile attribution
        is still on the <strong>State 1 → State 2</strong> tab. Brief 28a Part 3b
        folds that content here and removes the standalone Delta tab. The gains-vs-
        demand stacked bar chart (Brief 28a Part 2 sub-step 3) also lands in 3b.
      </div>
    </div>
  )
}

function Stat({ label, primary, sub, delta, deltaUnit }) {
  return (
    <div className="bg-white border border-light-grey rounded-lg p-3 tabular-nums">
      <div className="text-xxs uppercase tracking-wider text-mid-grey mb-1">{label}</div>
      <div className="text-h3 font-semibold text-navy">{primary}</div>
      <div className="text-xxs text-mid-grey mt-0.5">{sub}</div>
      {delta != null && (
        <div className={`text-xxs mt-1 font-medium ${delta > 0.05 ? 'text-red-600' : delta < -0.05 ? 'text-green-600' : 'text-mid-grey'}`}>
          {delta > 0 ? '+' : ''}{delta.toFixed(1)} {deltaUnit} vs State 1
        </div>
      )}
    </div>
  )
}
