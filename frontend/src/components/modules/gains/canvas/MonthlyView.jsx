/**
 * MonthlyView.jsx — Internal Gains tab Monthly view.
 *
 * Brief 28-IM IM-M2 add 2: consumes the engine's true per-month aggregation
 * (losses_at_setpoint.{element}.monthly_heating_loss_kwh[12] +
 * internal_gains_monthly.{category}_kwh[12]). Replaces the CIBSE Guide A
 * weighting placeholder used in earlier iterations.
 */

import { useStateComparison } from './useStateComparison.js'
import EngineBadge from './EngineBadge.jsx'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function _z() { return new Array(12).fill(0) }
function _add(out, arr) {
  if (Array.isArray(arr)) for (let i = 0; i < 12; i++) out[i] += (arr[i] ?? 0)
}

export default function MonthlyView() {
  const { state2, ready, libraryLoading } = useStateComparison()

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

  const los = state2?.losses_at_setpoint
  // internal_gains_monthly is emitted inside losses_at_setpoint by the State 2
  // engine (same IIFE; saves a separate top-level field). Consumer reads it
  // alongside the per-element monthly arrays.
  const gainsMonthly = state2?.losses_at_setpoint?.internal_gains_monthly

  if (!los || !gainsMonthly) {
    return (
      <div className="h-full flex items-center justify-center text-mid-grey text-xxs">
        Engine output not yet available for monthly aggregation.
      </div>
    )
  }

  // Loss side (fabric + leakage + permanent vents + thermal bridging — same
  // categories as Building module's Monthly view, per Brief 28-IM §3.2
  // "OUT-Losses: same as Building (read-only display)").
  const lossMonthly = _z()
  _add(lossMonthly, los.external_wall?.monthly_heating_loss_kwh)
  _add(lossMonthly, los.roof?.monthly_heating_loss_kwh)
  _add(lossMonthly, los.ground_floor?.monthly_heating_loss_kwh)
  _add(lossMonthly, los.glazing?.monthly_heating_loss_kwh)
  _add(lossMonthly, los.fabric_leakage?.monthly_heating_loss_kwh)
  _add(lossMonthly, los.permanent_vents?.monthly_heating_loss_kwh)
  _add(lossMonthly, los.thermal_bridging?.monthly_heating_loss_kwh)

  // Internal gains side — three category arrays from engine.
  const peopleM    = gainsMonthly.people_kwh ?? _z()
  const lightingM  = gainsMonthly.lighting_kwh ?? _z()
  const equipmentM = gainsMonthly.equipment_kwh ?? _z()

  // Net demand approximation (loss minus internal gains; ignores solar so
  // user reads it as "what fabric+ventilation needed before mechanical
  // heating + before solar offsets"). Engine's setpoint demand is the
  // authoritative number; this is a per-month visual.
  const netDemand = lossMonthly.map((l, i) => Math.max(0, l - peopleM[i] - lightingM[i] - equipmentM[i]))

  const totalGain = (gain) => Math.round(gain.reduce((s, v) => s + v, 0))
  const grandLoss = Math.round(lossMonthly.reduce((s, v) => s + v, 0))

  const maxBar = Math.max(
    ...lossMonthly,
    ...peopleM.map((p, i) => p + lightingM[i] + equipmentM[i]),
    1,
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-6 py-5 max-w-[1100px]">
        <div className="pb-3 border-b border-light-grey mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-navy">Monthly</h2>
            <EngineBadge />
          </div>
          <p className="text-xxs text-mid-grey mt-0.5">
            Per-month aggregation of the 8760-hour engine trace. Internal gains
            (people / lighting / equipment) stacked above; fabric heat loss
            stacked below. Net heating-demand-before-systems indicated by a
            line overlay (loss minus internal gains, before solar).
          </p>
        </div>

        <div className="flex items-end gap-2 mt-4" style={{ height: 320 }}>
          {MONTHS.map((m, i) => {
            const totalGain_i = peopleM[i] + lightingM[i] + equipmentM[i]
            return (
              <div key={m} className="flex-1 flex flex-col items-center gap-1">
                <div className="text-xxs text-mid-grey tabular-nums">
                  {totalGain_i > 1000 ? (totalGain_i/1000).toFixed(1)+'k' : Math.round(totalGain_i)}
                </div>
                {/* Stacked gains: equipment / lighting / people, biggest at bottom */}
                <div className="w-full flex flex-col items-stretch">
                  {equipmentM[i] > 0.01 && (
                    <div className="bg-violet-400" style={{ height: `${(equipmentM[i] / maxBar) * 130}px` }} title={`Equipment ${Math.round(equipmentM[i])} kWh`} />
                  )}
                  {lightingM[i] > 0.01 && (
                    <div className="bg-violet-300" style={{ height: `${(lightingM[i] / maxBar) * 130}px` }} title={`Lighting ${Math.round(lightingM[i])} kWh`} />
                  )}
                  {peopleM[i] > 0.01 && (
                    <div className="bg-violet-600" style={{ height: `${(peopleM[i] / maxBar) * 130}px` }} title={`People ${Math.round(peopleM[i])} kWh`} />
                  )}
                </div>
                <div className="text-xxs text-mid-grey font-medium">{m}</div>
                <div className="w-full bg-slate-500/70 rounded-sm" style={{ height: `${(lossMonthly[i] / maxBar) * 130}px` }} title={`Loss ${Math.round(lossMonthly[i])} kWh`} />
                <div className="text-xxs text-slate-700 tabular-nums">
                  {lossMonthly[i] > 1000 ? (lossMonthly[i]/1000).toFixed(1)+'k' : Math.round(lossMonthly[i])}
                </div>
                <div className="text-xxs text-amber-700 italic tabular-nums">
                  {netDemand[i] > 100 ? '↓'+Math.round(netDemand[i]) : ''}
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-4 mt-4 text-xxs text-mid-grey">
          <div className="flex items-center gap-1"><div className="w-3 h-3 bg-violet-600 rounded-sm" /> People ({totalGain(peopleM).toLocaleString()} kWh)</div>
          <div className="flex items-center gap-1"><div className="w-3 h-3 bg-violet-300 rounded-sm" /> Lighting ({totalGain(lightingM).toLocaleString()} kWh)</div>
          <div className="flex items-center gap-1"><div className="w-3 h-3 bg-violet-400 rounded-sm" /> Equipment ({totalGain(equipmentM).toLocaleString()} kWh)</div>
          <div className="flex items-center gap-1"><div className="w-3 h-3 bg-slate-500/70 rounded-sm" /> Fabric loss ({grandLoss.toLocaleString()} kWh)</div>
          <div className="flex items-center gap-1 text-amber-700"><span>↓</span> Net heating demand (loss − gains)</div>
        </div>
      </div>
    </div>
  )
}
