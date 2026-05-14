/**
 * DeltaView.jsx — headline State 1 → State 2 diagnostic.
 *
 * Brief 27 Revised Part 11. The HEADLINE tab in the Internal Gains
 * module: shows the user what their gains actually do to the
 * envelope-only baseline, with per-profile attribution.
 *
 * Layout (per the revised brief mock):
 *   - Top: paired bars for Heating demand and Cooling demand (State 1 vs
 *     State 2), with delta arrow + label.
 *   - Middle: overheating-hours change + free-running annual-mean shift.
 *   - Bottom: "What gains contribute" — per-gain category totals, with
 *     a sub-list for lighting + equipment showing each profile's MWh.
 *
 * Per UI principles: constrained width (~1000 px) because this is a
 * stats-card view, not horizontally-data-bearing. Engine toggle inline
 * with the title for the Live | Simulation switch (placeholder until
 * the simulation result plumbing is wired — engine toggle is owned by
 * the module shell, not this view).
 */

import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { useStateComparison } from './useStateComparison.js'
import { GAIN_COLOURS } from '../gainColours.js'
import EngineBadge from './EngineBadge.jsx'

function fmtMWh(v) {
  if (v == null) return '—'
  return `${Number(v).toFixed(1)} MWh`
}
function fmtKWh(v) {
  if (v == null) return '—'
  return `${Math.round(v).toLocaleString()} kWh`
}

// Bar pair: small State 1 value vs State 2 value with a max-aligned baseline.
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
            <div
              className="absolute inset-y-0 left-0 rounded"
              style={{ width: `${w1}%`, backgroundColor: accent, opacity: 0.55 }}
            />
          </div>
          <span className="text-caption text-navy font-medium tabular-nums w-20 text-right">
            {Number(state1Value ?? 0).toFixed(1)} {unit}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xxs text-mid-grey w-32 flex-shrink-0">State 2 (with gains)</span>
          <div className="flex-1 h-3 bg-off-white rounded relative overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded"
              style={{ width: `${w2}%`, backgroundColor: accent }}
            />
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

function HoursDelta({ label, state1Value, state2Value, isGood }) {
  const delta = (state2Value ?? 0) - (state1Value ?? 0)
  const Arrow = delta < 0 ? ArrowDown : delta > 0 ? ArrowUp : Minus
  // isGood='down' means down-is-good (e.g. overheating ↓), 'up' means up-is-good (comfort ↑)
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

export default function DeltaView() {
  const { state1, state2, ready, libraryLoading } = useStateComparison()

  if (!ready) {
    return (
      <div className="mx-auto px-6 py-8 max-w-[1000px]">
        <p className="text-caption text-mid-grey">
          {libraryLoading
            ? 'Loading constructions library…'
            : 'Waiting for weather data and engine to compute State 1 + State 2.'}
        </p>
      </div>
    )
  }

  const s1d = state1?.demand ?? {}
  const s2d = state2?.demand ?? {}
  const s2g = state2?.gains ?? {}
  const s2fr = state2?.free_running ?? {}
  const s1fr = state1?.free_running ?? {}

  const people    = s2g.people
  const lighting  = s2g.lighting
  const equipment = s2g.equipment

  return (
    <div className="mx-auto px-6 py-6 max-w-[1000px] space-y-5">
      {/* Title */}
      <div className="pb-3 border-b border-light-grey">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-navy">Internal gains shift the envelope's energy balance</h2>
          <EngineBadge />
        </div>
        <p className="text-xxs text-mid-grey mt-0.5">
          State 1 = envelope alone (no gains). State 2 = envelope + your configured internal gains.
          Deltas show what gains alone contribute.
        </p>
      </div>

      {/* Demand bars */}
      <div className="bg-white border border-light-grey rounded p-5">
        <BarPair
          label="Heating demand"
          state1Value={s1d.heating_demand_mwh}
          state2Value={s2d.heating_demand_mwh}
          accent="#DC2626"
        />
        <BarPair
          label="Cooling demand"
          state1Value={s1d.cooling_demand_mwh}
          state2Value={s2d.cooling_demand_mwh}
          accent="#00AEEF"
        />
      </div>

      {/* Hour changes + free-running shift */}
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

      {/* What gains contribute */}
      <div className="bg-white border border-light-grey rounded p-5">
        <div className="text-xxs uppercase tracking-wider text-mid-grey mb-3">What gains contribute</div>
        <div className="space-y-2">
          <GainContribution
            label="People"
            accent={GAIN_COLOURS.occupancy}
            totalKwh={people?.sensible_kwh ?? people?.total_kwh}
            suffix={state2?.occupancy_summary
              ? `${Math.round(state2.occupancy_summary.average_occupants ?? 0)} avg occupants · ${Math.round(state2.occupancy_summary.peak_occupants ?? 0)} peak`
              : null}
          />
          <GainContribution
            label="Lighting"
            accent={GAIN_COLOURS.lighting}
            totalKwh={lighting?.total_kwh}
            subProfiles={lighting?.profiles}
            suffix={lighting?.effective_lpd_w_per_m2
              ? `Effective LPD ${lighting.effective_lpd_w_per_m2.toFixed(2)} W/m² across ${lighting.profiles?.length ?? 1} profile${(lighting.profiles?.length ?? 1) > 1 ? 's' : ''}`
              : null}
          />
          <GainContribution
            label="Equipment"
            accent={GAIN_COLOURS.equipment}
            totalKwh={equipment?.total_kwh}
            subProfiles={equipment?.profiles}
            suffix={equipment != null
              ? `Baseload ${fmtKWh(equipment.total_baseload_kwh)} (24/7) + active ${fmtKWh(equipment.total_active_kwh)}`
              : null}
          />
        </div>
      </div>

      {/* Footnote */}
      <p className="text-xxs italic text-mid-grey/70">
        Numbers from the <strong>Static engine</strong> — in-browser lumped-
        capacitance two-node model + multi-profile gain summing. The
        Dynamic toggle (EnergyPlus) lands when State 2 EP results plumbing
        wires through (Brief 28a Part 5). Static vs Dynamic State 1
        divergences are documented in
        <code>docs/state_1_engine_divergence_investigation.md</code> (updated
        2026-05-14) and <code>docs/state_2_expected_ranges.md</code>; the
        dominant driver of Static's summer-max over-prediction is the
        lumped two-node mass model (~8.8K gap on Bridgewater), not the
        sky model. Per-facade solar redistributes ±19% between NNE and
        SSW vs Dynamic — Brief 28b Part 2 lands the HDKR/Perez upgrade.
      </p>
    </div>
  )
}
