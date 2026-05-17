/**
 * SummaryView.jsx — Internal Gains module headline tab.
 *
 * Brief 28a Part 3a (2026-05-14): introduced as the new default landing
 *                                 tab with minimal headline numbers.
 * Brief 28a Part 3b (2026-05-14): folded the DeltaView content here
 *                                 (paired demand bars + hours / free-
 *                                 running deltas + per-gain attribution)
 *                                 and added the deferred Brief 28a Part 2
 *                                 sub-step 3 gains-vs-demand stacked bar
 *                                 with unit toggle. The standalone Delta
 *                                 tab gets removed from the tab strip.
 *
 * Layout:
 *   1. Headline stat cards (4-up): gains total, heating, cooling, comfort hours
 *   2. Gains vs demand — stacked bar with kWh / kWh-per-m^2 unit toggle
 *   3. Demand paired bars — State 1 vs State 2 for heating + cooling
 *   4. Comfort impact — hours deltas + annual-mean T shift
 *   5. What gains contribute — per-gain attribution with sub-profiles
 *   6. Footnote
 */

import { useState } from 'react'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { useStateComparison } from './useStateComparison.js'
import { GAIN_COLOURS } from '../gainColours.js'
// Brief 28-IM-Polish POL-M2: shared cross-module pill + totals badge.
import EnginePill from '../../../shared/EnginePill.jsx'
import ChartTotalsBadge from '../../../shared/ChartTotalsBadge.jsx'
// Brief 28-IM-Polish POL-M3 §7.2: cross-chart reconciliation row.
import ReconciliationRow from '../../../shared/ReconciliationRow.jsx'

const HEATING_COLOUR = '#DC2626'
const COOLING_COLOUR = '#00AEEF'

function fmtMWh(v)  { return v == null ? '—' : `${Number(v).toFixed(1)} MWh` }
function fmtKWh(v)  { return v == null ? '—' : `${Math.round(v).toLocaleString()} kWh` }
function fmtKWhM2(kwh, gia) {
  if (kwh == null || !gia) return '—'
  return `${Math.round(kwh / gia)} kWh/m²·yr`
}

// ── Headline stat card ───────────────────────────────────────────────────────
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

// ── Paired bar (State 1 vs State 2, same metric) ─────────────────────────────
function BarPair({ label, state1Value, state2Value, accent, unit = 'MWh' }) {
  const max = Math.max(state1Value ?? 0, state2Value ?? 0, 0.01)
  const w1 = ((state1Value ?? 0) / max) * 100
  const w2 = ((state2Value ?? 0) / max) * 100
  const delta = (state2Value ?? 0) - (state1Value ?? 0)
  const Arrow = delta < 0 ? ArrowDown : delta > 0 ? ArrowUp : Minus
  const arrowColor = delta < 0 ? 'text-green-600' : delta > 0 ? 'text-red-600' : 'text-mid-grey'

  return (
    <div className="mb-4">
      <div className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5">{label}</div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xxs text-mid-grey w-32 flex-shrink-0">State 1 (envelope only)</span>
          <div className="flex-1 h-3 bg-off-white rounded relative overflow-hidden">
            <div className="absolute inset-y-0 left-0 rounded"
                 style={{ width: `${w1}%`, backgroundColor: accent, opacity: 0.55 }} />
          </div>
          <span className="text-caption text-navy font-medium tabular-nums w-20 text-right">
            {Number(state1Value ?? 0).toFixed(1)} {unit}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xxs text-mid-grey w-32 flex-shrink-0">State 2 (with gains)</span>
          <div className="flex-1 h-3 bg-off-white rounded relative overflow-hidden">
            <div className="absolute inset-y-0 left-0 rounded"
                 style={{ width: `${w2}%`, backgroundColor: accent }} />
          </div>
          <span className="text-caption text-navy font-medium tabular-nums w-20 text-right">
            {Number(state2Value ?? 0).toFixed(1)} {unit}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 mt-1 ml-32 text-xxs tabular-nums">
        <Arrow size={11} className={arrowColor} />
        <span className={`font-medium ${arrowColor}`}>
          {delta >= 0 ? '+' : ''}{Number(delta).toFixed(1)} {unit}
        </span>
        <span className="text-mid-grey/70 ml-1">from gains</span>
      </div>
    </div>
  )
}

// ── Hours delta row ──────────────────────────────────────────────────────────
function HoursDelta({ label, state1Value, state2Value, isGood }) {
  const delta = (state2Value ?? 0) - (state1Value ?? 0)
  const Arrow = delta < 0 ? ArrowDown : delta > 0 ? ArrowUp : Minus
  const trendIsImprovement = (isGood === 'down' && delta < 0) || (isGood === 'up' && delta > 0)
  const arrowColor = delta === 0 ? 'text-mid-grey' : (trendIsImprovement ? 'text-green-600' : 'text-red-600')

  return (
    <div className="flex items-center justify-between py-1 text-caption">
      <span className="text-mid-grey">{label}</span>
      <div className="flex items-center gap-2 tabular-nums">
        <span className="text-mid-grey/80 text-xxs">{(state1Value ?? 0).toLocaleString()}</span>
        <span className="text-mid-grey/50 text-xxs">→</span>
        <span className="text-navy font-medium">{(state2Value ?? 0).toLocaleString()}</span>
        <span className={`text-xxs font-medium flex items-center gap-0.5 ${arrowColor}`}>
          <Arrow size={10} />
          {delta >= 0 ? '+' : ''}{delta.toLocaleString()}
        </span>
      </div>
    </div>
  )
}

// ── Per-gain attribution ─────────────────────────────────────────────────────
function GainContribution({ label, accent, totalKwh, subProfiles, suffix }) {
  if (totalKwh == null || totalKwh === 0) return null
  return (
    <div className="border-l-2 pl-3 py-1" style={{ borderLeftColor: accent }}>
      <div className="flex justify-between text-caption">
        <span className="font-medium text-navy flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: accent }} />
          {label}
        </span>
        <span className="tabular-nums text-navy font-medium">
          +{fmtMWh(totalKwh / 1000)}
        </span>
      </div>
      {suffix && (
        <div className="text-xxs text-mid-grey/70 mt-0.5">{suffix}</div>
      )}
      {Array.isArray(subProfiles) && subProfiles.length > 1 && (
        <div className="mt-1.5 space-y-0.5 text-xxs">
          {subProfiles.map(p => (
            <div key={p.id} className="flex justify-between pl-3 text-mid-grey/80">
              <span className="truncate">└ {p.label}</span>
              <span className="tabular-nums text-mid-grey">+{(p.kwh / 1000).toFixed(1)} MWh</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Gains-vs-demand stacked bar (Brief 28a Part 2 sub-step 3) ────────────────
// Left side: internal gains stacked (people / lighting / equipment).
// Right side: demand stacked (heating + cooling).
// Unit toggle: kWh (totals) vs kWh/m^2.yr (intensity).
function GainsVsDemandBar({ peopleKwh, lightingKwh, equipmentKwh, heatingKwh, coolingKwh, gia, unit }) {
  const conv = (kwh) => unit === 'kwh_per_m2' ? (kwh / (gia || 1)) : kwh
  const fmtVal = (kwh) => unit === 'kwh_per_m2'
    ? `${Math.round(kwh / (gia || 1))} kWh/m²·yr`
    : `${(kwh / 1000).toFixed(1)} MWh`

  const peopleV    = conv(peopleKwh    ?? 0)
  const lightingV  = conv(lightingKwh  ?? 0)
  const equipmentV = conv(equipmentKwh ?? 0)
  const heatingV   = conv(heatingKwh   ?? 0)
  const coolingV   = conv(coolingKwh   ?? 0)

  const gainsTotal  = peopleV + lightingV + equipmentV
  const demandTotal = heatingV + coolingV
  const scale = Math.max(gainsTotal, demandTotal, 0.01)

  const seg = (value, colour, label) => {
    const widthPct = (value / scale) * 100
    if (widthPct < 0.5) return null
    return (
      <div className="h-full flex items-center justify-end pr-2 text-xxs text-white font-medium relative group"
           style={{ width: `${widthPct}%`, backgroundColor: colour, minWidth: 4 }}
           title={`${label}: ${fmtVal(unit === 'kwh_per_m2' ? value * (gia || 1) : value)}`}>
        {widthPct > 10 && label}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5 flex items-center justify-between">
          <span>Internal gains (stacked)</span>
          <span className="text-navy font-medium tabular-nums">{fmtVal(unit === 'kwh_per_m2' ? gainsTotal * (gia || 1) : gainsTotal)}</span>
        </div>
        <div className="h-6 bg-off-white rounded overflow-hidden flex">
          {seg(peopleV,    GAIN_COLOURS.occupancy, 'People')}
          {seg(lightingV,  GAIN_COLOURS.lighting,  'Lighting')}
          {seg(equipmentV, GAIN_COLOURS.equipment, 'Equipment')}
        </div>
      </div>
      <div>
        <div className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5 flex items-center justify-between">
          <span>Demand (stacked: heating + cooling)</span>
          <span className="text-navy font-medium tabular-nums">{fmtVal(unit === 'kwh_per_m2' ? demandTotal * (gia || 1) : demandTotal)}</span>
        </div>
        <div className="h-6 bg-off-white rounded overflow-hidden flex">
          {seg(heatingV, HEATING_COLOUR, 'Heating')}
          {seg(coolingV, COOLING_COLOUR, 'Cooling')}
        </div>
      </div>
    </div>
  )
}

// ── Main view ────────────────────────────────────────────────────────────────
export default function SummaryView() {
  const { state1, state2, ready, libraryLoading } = useStateComparison()
  const [unit, setUnit] = useState(() => {
    try { return localStorage.getItem('nza-summary-unit') || 'kwh_per_m2' }
    catch { return 'kwh_per_m2' }
  })
  const setUnitPersisted = (u) => {
    setUnit(u)
    try { localStorage.setItem('nza-summary-unit', u) } catch {}
  }

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

  const gia    = state2?.heat_balance?.metadata?.gia_m2 ?? 0
  const s1d    = state1?.demand ?? {}
  const s2d    = state2?.demand ?? {}
  const s2g    = state2?.gains  ?? {}
  const s2fr   = state2?.free_running ?? {}
  const s1fr   = state1?.free_running ?? {}
  const people    = s2g.people
  const lighting  = s2g.lighting
  const equipment = s2g.equipment

  const peopleKwh    = (people?.sensible_kwh    ?? people?.total_kwh ?? 0)
  const lightingKwh  = (lighting?.total_kwh     ?? 0)
  const equipmentKwh = (equipment?.total_kwh    ?? 0)
  const gains_total_kwh = peopleKwh + lightingKwh + equipmentKwh
  const heatingKwh = (s2d.heating_demand_mwh ?? 0) * 1000
  const coolingKwh = (s2d.cooling_demand_mwh ?? 0) * 1000

  const heating_change = (s2d.heating_demand_mwh ?? 0) - (s1d.heating_demand_mwh ?? 0)
  const cooling_change = (s2d.cooling_demand_mwh ?? 0) - (s1d.cooling_demand_mwh ?? 0)

  // Brief 28-IM-Polish POL-M3 §7.2 — cross-chart total reconciliation.
  // Per-category gain totals come from two engine feeds:
  //   A: state2.gains.{cat}.total_kwh           — what Heat Balance + this Summary use
  //   B: losses_at_setpoint.internal_gains_monthly.{cat}_kwh[12] — what Monthly sums
  // Same physics step ⇒ must agree. Surfaced as a tolerance-checked row.
  const gainsMonthly = state2?.losses_at_setpoint?.internal_gains_monthly ?? {}
  const _sumArr = (arr) => Array.isArray(arr) ? arr.reduce((s, v) => s + (v ?? 0), 0) : 0
  const reconciliationRows = [
    {
      label: 'People gains',
      a_label: 'Heat Balance',  a_value: (peopleKwh ?? 0) / 1000,
      b_label: 'Monthly sum',   b_value: _sumArr(gainsMonthly.people_kwh) / 1000,
      unit: 'MWh',
    },
    {
      label: 'Lighting gains',
      a_label: 'Heat Balance',  a_value: (lightingKwh ?? 0) / 1000,
      b_label: 'Monthly sum',   b_value: _sumArr(gainsMonthly.lighting_kwh) / 1000,
      unit: 'MWh',
    },
    {
      label: 'Equipment gains',
      a_label: 'Heat Balance',  a_value: (equipmentKwh ?? 0) / 1000,
      b_label: 'Monthly sum',   b_value: _sumArr(gainsMonthly.equipment_kwh) / 1000,
      unit: 'MWh',
    },
  ]

  return (
    // Brief 28a Part 5 walkthrough scroll fix (2026-05-14): wrap in a
    // bounded outer container that owns the internal scroll. Page-level
    // scroll banned per Pablo discipline; Summary is a multi-panel
    // dashboard view so internal scrolling within the canvas is allowed.
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-6 py-5 max-w-[1000px] space-y-5">
      {/* ── Title ────────────────────────────────────────────────────── */}
      <div className="pb-3 border-b border-light-grey">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-navy">Summary</h2>
            <EnginePill mode="static" />
          </div>
          <ChartTotalsBadge label="Σ gains" value_kwh={gains_total_kwh} gia_m2={gia} />
        </div>
        <p className="text-xxs text-mid-grey mt-0.5">
          Internal gains shift the envelope's energy balance. State 1 = envelope alone
          (no gains). State 2 = envelope + your configured internal gains. Deltas show
          what gains alone contribute.
        </p>
      </div>

      {/* ── Headline stat cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Internal gains"
              primary={fmtMWh(gains_total_kwh / 1000)}
              sub={fmtKWhM2(gains_total_kwh, gia)} />
        <Stat label="Heating demand"
              primary={fmtMWh(s2d.heating_demand_mwh)}
              sub={fmtKWhM2(s2d.heating_demand_mwh * 1000, gia)}
              delta={heating_change}
              deltaUnit="MWh" />
        <Stat label="Cooling demand"
              primary={fmtMWh(s2d.cooling_demand_mwh)}
              sub={fmtKWhM2(s2d.cooling_demand_mwh * 1000, gia)}
              delta={cooling_change}
              deltaUnit="MWh" />
        <Stat label="Comfort hours"
              primary={`${s2d.comfort_hours ?? '—'}`}
              sub={`of 8,760 (${Math.round((s2d.comfort_hours ?? 0) / 8760 * 100)}%)`} />
      </div>

      {/* Brief 28c caveat (2026-05-14): at State 2 the demand numbers above
          are free-running comfort-band integrals — what a perfect system would
          deliver to hold the zone in band, assuming no operable windows and
          unlimited plant. Real cooling demand in particular can be much lower
          once operable windows (State 2.5) and HVAC plant limits (State 3)
          are applied. Treat State 2 cooling demand as an upper-bound, not a
          design figure. */}
      <div className="bg-off-white border border-light-grey rounded px-3 py-2 text-xxs text-mid-grey leading-snug">
        <strong className="text-navy">Note:</strong> Heating and cooling demand
        at State 2 are <em>free-running comfort-band integrals</em> — the energy
        a perfect system would deliver to hold the zone in band, given the
        gains alone. Operable windows (State 2.5) typically reduce cooling
        demand; HVAC plant capacity and deadband (State 3) refine both numbers
        toward what a real system would deliver.
      </div>

      {/* ── Gains vs Demand stacked bar (Brief 28a Part 2 sub-step 3) ── */}
      <div className="bg-white border border-light-grey rounded p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xxs uppercase tracking-wider text-mid-grey">Gains vs demand</div>
          <div className="flex items-center bg-off-white rounded-lg p-0.5 text-xxs">
            <button
              onClick={() => setUnitPersisted('kwh')}
              className={`px-2 py-0.5 rounded transition-colors ${unit === 'kwh' ? 'bg-white text-navy font-medium shadow-sm' : 'text-mid-grey hover:text-navy'}`}>
              kWh
            </button>
            <button
              onClick={() => setUnitPersisted('kwh_per_m2')}
              className={`px-2 py-0.5 rounded transition-colors ${unit === 'kwh_per_m2' ? 'bg-white text-navy font-medium shadow-sm' : 'text-mid-grey hover:text-navy'}`}>
              kWh/m²·yr
            </button>
          </div>
        </div>
        <GainsVsDemandBar
          peopleKwh={peopleKwh}
          lightingKwh={lightingKwh}
          equipmentKwh={equipmentKwh}
          heatingKwh={heatingKwh}
          coolingKwh={coolingKwh}
          gia={gia}
          unit={unit}
        />
      </div>

      {/* ── Demand paired bars (State 1 vs State 2) ─────────────────── */}
      <div className="bg-white border border-light-grey rounded p-5">
        <BarPair label="Heating demand"
                 state1Value={s1d.heating_demand_mwh}
                 state2Value={s2d.heating_demand_mwh}
                 accent={HEATING_COLOUR} />
        <BarPair label="Cooling demand"
                 state1Value={s1d.cooling_demand_mwh}
                 state2Value={s2d.cooling_demand_mwh}
                 accent={COOLING_COLOUR} />
      </div>

      {/* ── Comfort impact (hours + free-running shift) ─────────────── */}
      <div className="bg-white border border-light-grey rounded p-5">
        <div className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Comfort impact</div>
        <HoursDelta label="Overheating hours"  state1Value={s1d.overheating_hours}  state2Value={s2d.overheating_hours}  isGood="down" />
        <HoursDelta label="Underheating hours" state1Value={s1d.underheating_hours} state2Value={s2d.underheating_hours} isGood="down" />
        <HoursDelta label="Comfort hours"      state1Value={s1d.comfort_hours}      state2Value={s2d.comfort_hours}      isGood="up" />
        <div className="flex items-center justify-between py-1 text-caption mt-2 pt-2 border-t border-light-grey/60">
          <span className="text-mid-grey">Annual mean free-running T</span>
          <div className="flex items-center gap-2 tabular-nums">
            <span className="text-mid-grey/80 text-xxs">{(s1fr.annual_mean_c ?? 0).toFixed(1)} °C</span>
            <span className="text-mid-grey/50 text-xxs">→</span>
            <span className="text-navy font-medium">{(s2fr.annual_mean_c ?? 0).toFixed(1)} °C</span>
            <span className={`text-xxs font-medium ${
              (s2fr.annual_mean_c - s1fr.annual_mean_c) >= 0 ? 'text-red-600' : 'text-green-600'
            }`}>
              {(s2fr.annual_mean_c - s1fr.annual_mean_c) >= 0 ? '+' : ''}
              {(s2fr.annual_mean_c - s1fr.annual_mean_c).toFixed(1)} °C
            </span>
          </div>
        </div>
      </div>

      {/* ── What gains contribute ───────────────────────────────────── */}
      <div className="bg-white border border-light-grey rounded p-5">
        <div className="text-xxs uppercase tracking-wider text-mid-grey mb-3">What gains contribute</div>
        <div className="space-y-2">
          <GainContribution
            label="People"
            accent={GAIN_COLOURS.occupancy}
            totalKwh={people?.sensible_kwh ?? people?.total_kwh}
            suffix={state2?.occupancy_summary
              ? `${Math.round(state2.occupancy_summary.average_occupants ?? 0)} avg occupants · ${Math.round(state2.occupancy_summary.peak_occupants ?? 0)} peak`
              : null} />
          <GainContribution
            label="Lighting"
            accent={GAIN_COLOURS.lighting}
            totalKwh={lighting?.total_kwh}
            subProfiles={lighting?.profiles}
            suffix={lighting?.effective_lpd_w_per_m2
              ? `Effective LPD ${lighting.effective_lpd_w_per_m2.toFixed(2)} W/m² across ${lighting.profiles?.length ?? 1} profile${(lighting.profiles?.length ?? 1) > 1 ? 's' : ''}`
              : null} />
          <GainContribution
            label="Equipment"
            accent={GAIN_COLOURS.equipment}
            totalKwh={equipment?.total_kwh}
            subProfiles={equipment?.profiles}
            suffix={equipment != null
              ? `Baseload ${fmtKWh(equipment.total_baseload_kwh)} (24/7) + active ${fmtKWh(equipment.total_active_kwh)}`
              : null} />
        </div>
      </div>

      {/* ── Cross-chart reconciliation (Brief POL-M3 §7.2) ──────────── */}
      <div className="bg-white border border-light-grey rounded p-5">
        <div className="text-xxs uppercase tracking-wider text-mid-grey mb-2">
          Cross-chart reconciliation
        </div>
        <p className="text-xxs text-mid-grey/80 mb-3">
          Same total via two engine paths — annual aggregation vs 12-month sum.
          Agreement (≤0.5%) ⇒ engine consistent. Mismatch ⇒ engine bug surfaced.
        </p>
        <ReconciliationRow rows={reconciliationRows} />
      </div>

      {/* ── Footnote ────────────────────────────────────────────────── */}
      {/* Brief 29 Commit B (cleanup): previous footnote attributed Static's
          summer-max over-prediction to "the lumped two-node mass model" with
          a specific 8.8K magnitude claim on Bridgewater. That attribution
          predates Brief 29's audit and is treated as undefended until the
          audit's Part 4 (Internal Gains) cross-engine reconciliation lands
          and either defends the 8.8K number with a heat-balance derivation
          (per Hard Rule 2) or identifies a hidden integrand term. Footnote
          stripped to a neutral engine-source label until then. */}
      <p className="text-xxs italic text-mid-grey/70">
        Numbers from the <strong>Static engine</strong> (in-browser physics).
        The top-bar Static / Dynamic toggle is the single switch.
      </p>
      </div>
    </div>
  )
}
