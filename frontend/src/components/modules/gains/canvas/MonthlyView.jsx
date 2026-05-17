/**
 * MonthlyView.jsx — Internal Gains tab Monthly view.
 *
 * Brief 28-IM IM-M2 add 2: consumes the engine's true per-month aggregation
 * (losses_at_setpoint.{element}.monthly_heating_loss_kwh[12] +
 * internal_gains_monthly.{category}_kwh[12]). Replaces the CIBSE Guide A
 * weighting placeholder used in earlier iterations.
 */

import { useStateComparison } from './useStateComparison.js'
// Brief 28-IM-Polish POL-M2: shared pill + totals badge.
import EnginePill from '../../../shared/EnginePill.jsx'
import ChartTotalsBadge from '../../../shared/ChartTotalsBadge.jsx'
// Chris UX request (2026-05-17): diverging-bars chart — fixed middle axis
// with gains UP and losses DOWN. Same component as Building / Operation.
import DivergingMonthlyChart from '../../../shared/DivergingMonthlyChart.jsx'

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
  // Chris UX request (2026-05-17): also show solar gains here. Same source
  // as Building Monthly view — losses_at_setpoint.glazing.monthly_solar_transmission_kwh.
  const solarM     = los.glazing?.monthly_solar_transmission_kwh ?? _z()

  const totalGain = (gain) => Math.round(gain.reduce((s, v) => s + v, 0))
  const grandLoss = Math.round(lossMonthly.reduce((s, v) => s + v, 0))
  const grandSolar = totalGain(solarM)
  const grandInternal = totalGain(peopleM) + totalGain(lightingM) + totalGain(equipmentM)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-6 py-5 max-w-[1100px]">
        <div className="pb-3 border-b border-light-grey mb-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold text-navy">Monthly</h2>
              <EnginePill mode="static" />
            </div>
            <div className="flex items-center gap-2">
              <ChartTotalsBadge label="Σ gains"   value_kwh={grandInternal + grandSolar} gia_m2={state2?.heat_balance?.metadata?.gia_m2 ?? 0} />
              <ChartTotalsBadge label="Σ losses"  value_kwh={grandLoss}                  gia_m2={state2?.heat_balance?.metadata?.gia_m2 ?? 0} />
            </div>
          </div>
          <p className="text-xxs text-mid-grey mt-0.5">
            Per-month aggregation of the 8760-hour engine trace. Months sit on
            a fixed horizontal axis through the middle; gains (solar + people +
            lighting + equipment) grow upward, fabric heat loss grows downward.
          </p>
        </div>

        {/* Chris UX request (2026-05-17): diverging-bars chart with solar
            now included (was missing in the previous Monthly view). */}
        <div className="mt-4">
          <DivergingMonthlyChart
            gainsStacks={[
              { key: 'solar',     label: `Solar (${grandSolar.toLocaleString()} kWh)`,           color: '#F59E0B', values: solarM },
              { key: 'people',    label: `People (${totalGain(peopleM).toLocaleString()} kWh)`, color: '#7C3AED', values: peopleM },
              { key: 'lighting',  label: `Lighting (${totalGain(lightingM).toLocaleString()} kWh)`, color: '#C4B5FD', values: lightingM },
              { key: 'equipment', label: `Equipment (${totalGain(equipmentM).toLocaleString()} kWh)`, color: '#A78BFA', values: equipmentM },
            ]}
            lossesStacks={[
              { key: 'fabric',    label: `Fabric loss (${grandLoss.toLocaleString()} kWh)`,    color: '#475569', values: lossMonthly },
            ]}
            height={320}
            unit="kWh"
          />
        </div>
      </div>
    </div>
  )
}
