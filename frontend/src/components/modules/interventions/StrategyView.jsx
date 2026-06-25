/**
 * StrategyView.jsx — Brief 87 Part 5 (interventions UX rework)
 *
 * The composed Strategy view (right pane of the Strategy page). Shows the
 * strategy's headline + the strategy-level visualisations:
 *   1. Strategy headline — final EUI, energy saved, carbon saved (year 1),
 *      + lifetime-carbon / capex / £-per-tonne placeholders (Brief B/C).
 *   2. Waterfall — cumulative marginal attribution (reuse EUIWaterfall).
 *   3. Heat balance — strategy final state (reuse PhysicsView → HeatBalance).
 *   4. CRREM trajectory — placeholder frame (Brief C populates).
 *
 * Consumes the existing stacked engine result (the active strategy = the
 * ordered intervention list for v1). No engine work — pure consumer view.
 */
import EUIWaterfall from './EUIWaterfall.jsx'
import PhysicsView from './visualiser/PhysicsView.jsx'

const SAVE_GREEN = '#16A34A'
const INCREASE_RED = '#DC2626'
const ACCENT = '#E84393'

function fmt(n, d = 1, suffix = '') {
  return Number.isFinite(n) ? `${n.toFixed(d)}${suffix}` : '—'
}
function signed(n, d = 1, suffix = '') {
  if (!Number.isFinite(n)) return '—'
  const sign = n < 0 ? '−' : '+'
  return `${sign}${Math.abs(n).toFixed(d)}${suffix}`
}

function Stat({ label, value, sub, accent, placeholder }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-[108px]">
      <div className="text-xxs uppercase tracking-wider text-mid-grey/70 font-semibold">{label}</div>
      {placeholder ? (
        <>
          <div className="text-base font-semibold text-mid-grey/40 tabular-nums">TBD</div>
          <div className="text-xxs text-mid-grey/50">{placeholder}</div>
        </>
      ) : (
        <>
          <div className="text-lg font-semibold tabular-nums" style={{ color: accent ?? '#1F2937' }}>{value}</div>
          {sub ? <div className="text-xxs text-mid-grey/70 tabular-nums">{sub}</div> : null}
        </>
      )}
    </div>
  )
}

export default function StrategyView({ strategyName = 'Strategy 1', interventions = [], stackResult, orientationDeg = 0 }) {
  const rows = stackResult?.interventions ?? []
  const lastEnabled = [...rows].reverse().find((r) => r?.enabled)
  const cumEUI = lastEnabled?.cumulative_delta?.eui_kwh_per_m2
  const cumTot = lastEnabled?.cumulative_delta?.total_delivered_mwh
  const cumCarbon = lastEnabled?.cumulative_delta?.carbon_kgco2_per_m2

  const baselineEUI = cumEUI?.from
  const finalEUI = cumEUI?.to ?? baselineEUI
  const savingEUI = Number.isFinite(baselineEUI) && Number.isFinite(finalEUI) ? finalEUI - baselineEUI : null
  const finalResult = lastEnabled?.result ?? stackResult?.baseline ?? null
  const enabledCount = rows.filter((r) => r?.enabled).length
  const savingAccent = savingEUI != null ? (savingEUI < -0.05 ? SAVE_GREEN : savingEUI > 0.05 ? INCREASE_RED : undefined) : undefined

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto h-full">
      {/* 1 — Strategy headline */}
      <div className="rounded-lg border border-light-grey/70 bg-white px-4 py-3">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="inline-block w-1.5 h-5 rounded-full" style={{ backgroundColor: ACCENT }} />
          <h2 className="text-sm font-semibold text-navy">{strategyName}</h2>
          <span className="text-xxs text-mid-grey/60">{enabledCount} measure{enabledCount === 1 ? '' : 's'} active</span>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Stat label="Final EUI" value={`${fmt(finalEUI)} kWh/m²`} sub={`baseline ${fmt(baselineEUI)}`} />
          <Stat label="Energy saved" accent={savingAccent} value={`${signed(savingEUI)} kWh/m²`} sub={cumTot ? `${signed(cumTot.delta)} MWh/yr` : null} />
          <Stat label="Carbon saved (yr 1)" accent={savingAccent} value={cumCarbon ? `${signed(cumCarbon.delta)} kgCO₂/m²` : '—'} />
          <Stat label="Lifetime carbon" placeholder="TBD — Brief C" />
          <Stat label="Total capex" placeholder="TBD — Brief B" />
          <Stat label="£ / tonne CO₂" placeholder="TBD — Brief B" />
        </div>
      </div>

      {/* 2 — Waterfall (cumulative marginal attribution) */}
      <div className="rounded-lg border border-light-grey/70 bg-white p-3">
        <EUIWaterfall interventions={interventions} stackResult={stackResult} />
      </div>

      {/* 3 — Heat balance, strategy final state */}
      <div className="rounded-lg border border-light-grey/70 bg-white p-3">
        <h3 className="text-xs uppercase tracking-wider font-semibold text-navy mb-2">
          Heat balance — strategy final state
        </h3>
        {finalResult ? (
          <PhysicsView baselineResult={stackResult?.baseline} cumulativeResult={finalResult} orientationDeg={orientationDeg} />
        ) : (
          <p className="text-xs text-mid-grey/60 italic">Add interventions to the strategy to see the composed heat balance.</p>
        )}
      </div>

      {/* 4 — CRREM trajectory (placeholder — Brief C) */}
      <div className="rounded-lg border border-dashed border-light-grey bg-white/40 p-5 flex flex-col items-center justify-center text-center min-h-[150px]">
        <div className="text-xs uppercase tracking-wider text-mid-grey/60 font-semibold mb-1">CRREM trajectory</div>
        <div className="text-sm text-mid-grey/55 max-w-md">
          Cumulative operational carbon vs the CRREM decarbonisation pathway, 2025–2050 — when (if) this strategy meets the target.
        </div>
        <div className="text-xxs text-mid-grey/40 mt-2">TBD — Brief C (CRREM lifetime carbon)</div>
      </div>
    </div>
  )
}
