/**
 * StrategyView.jsx — Brief 87 (interventions UX rework)
 *
 * The composed Strategy view (right pane of the Strategy page): a fixed strategy
 * headline + a TABBED visualiser so the user never has to scroll between charts:
 *   • Waterfall    — cumulative marginal attribution (EUIWaterfall)
 *   • Heat balance — baseline vs strategy-final, side-by-side by default, with a
 *                    SINGLE shared Rows/Stacked/Sankey toggle driving both panels
 *                    + per-panel show/hide (you can collapse to just one)
 *   • Carbon       — CRREM lifetime-carbon trajectory (placeholder, Brief C)
 *
 * Each tab's chart sits in a bounded-height container, which fixes the
 * heat-balance "keeps growing" ResponsiveContainer loop (it was rendering in an
 * unbounded auto-height column before). No engine work — pure consumer view.
 */
import { useState } from 'react'
import EUIWaterfall from './EUIWaterfall.jsx'
import HeatBalance, { LayoutToggle } from '../balance/HeatBalance.jsx'

const SAVE_GREEN = '#16A34A'
const INCREASE_RED = '#DC2626'
const ACCENT = '#E84393'

const TABS = [
  ['waterfall', 'Waterfall'],
  ['heatbalance', 'Heat balance'],
  ['carbon', 'Carbon'],
]

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

/** Show/hide chip for the baseline / final heat-balance panels. */
function PanelToggle({ active, onClick, accent, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-xxs font-semibold border transition-colors ${
        active ? 'text-white' : 'text-mid-grey border-light-grey hover:text-navy'
      }`}
      style={active ? { backgroundColor: accent ?? ACCENT, borderColor: accent ?? ACCENT } : undefined}
    >
      {children}
    </button>
  )
}

function HBPanel({ label, accent, result, orientationDeg, layout }) {
  return (
    <div className="flex flex-col min-h-0 border rounded overflow-hidden" style={accent ? { borderColor: accent + '66' } : { borderColor: '#E5E7EB' }}>
      <div
        className="flex-shrink-0 text-xxs uppercase tracking-wider font-semibold text-center py-1 bg-off-white/50"
        style={accent ? { color: accent } : { color: '#6B7280' }}
      >
        {label}
      </div>
      <div className="flex-1 min-h-0">
        <HeatBalance
          liveData={result?.heat_balance}
          simulationData={null}
          simulationInfo={null}
          orientationDeg={orientationDeg}
          onElementClick={() => {}}
          mode="full"
          layout={layout}
          hideLayoutToggle
        />
      </div>
    </div>
  )
}

export default function StrategyView({ strategyName = 'Strategy 1', interventions = [], stackResult, orientationDeg = 0 }) {
  const [tab, setTab] = useState('waterfall')
  const [showBaseline, setShowBaseline] = useState(true)
  const [showFinal, setShowFinal] = useState(true)
  const [hbLayout, setHbLayout] = useState('rows')

  const rows = stackResult?.interventions ?? []
  const lastEnabled = [...rows].reverse().find((r) => r?.enabled)
  const cumEUI = lastEnabled?.cumulative_delta?.eui_kwh_per_m2
  const cumTot = lastEnabled?.cumulative_delta?.total_delivered_mwh
  const cumCarbon = lastEnabled?.cumulative_delta?.carbon_kgco2_per_m2

  const baselineEUI = cumEUI?.from
  const finalEUI = cumEUI?.to ?? baselineEUI
  const savingEUI = Number.isFinite(baselineEUI) && Number.isFinite(finalEUI) ? finalEUI - baselineEUI : null
  const finalResult = lastEnabled?.result ?? stackResult?.baseline ?? null
  const baselineResult = stackResult?.baseline ?? null
  const enabledCount = rows.filter((r) => r?.enabled).length
  const savingAccent = savingEUI != null ? (savingEUI < -0.05 ? SAVE_GREEN : savingEUI > 0.05 ? INCREASE_RED : undefined) : undefined

  // Never let both panels be hidden.
  const toggleBaseline = () => setShowBaseline((v) => (v && !showFinal ? v : !v))
  const toggleFinal = () => setShowFinal((v) => (v && !showBaseline ? v : !v))
  const bothOn = showBaseline && showFinal

  return (
    <div className="flex flex-col h-full">
      {/* Strategy headline (always visible) */}
      <div className="flex-shrink-0 border-b border-light-grey bg-white px-4 py-3">
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

      {/* Tab bar */}
      <div className="flex-shrink-0 flex items-center gap-1 px-4 pt-2 border-b border-light-grey bg-white">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
              tab === id ? '' : 'text-mid-grey border-transparent hover:text-navy'
            }`}
            style={tab === id ? { borderColor: ACCENT, color: ACCENT } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content — bounded height so charts never run away */}
      <div className="flex-1 min-h-0 overflow-auto p-4">
        {tab === 'waterfall' && (
          <div className="rounded-lg border border-light-grey/70 bg-white p-3">
            <EUIWaterfall interventions={interventions} stackResult={stackResult} />
          </div>
        )}

        {tab === 'heatbalance' && (
          <div className="flex flex-col gap-3 h-full">
            {/* One set of controls for both panels: which to show + a single
                Rows/Stacked/Sankey toggle that drives both. */}
            <div className="flex-shrink-0 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xxs uppercase tracking-wider text-mid-grey/60 font-semibold">Show</span>
                <PanelToggle active={showBaseline} onClick={toggleBaseline}>Baseline</PanelToggle>
                <PanelToggle active={showFinal} onClick={toggleFinal} accent={ACCENT}>Strategy final</PanelToggle>
              </div>
              <LayoutToggle layout={hbLayout} onChange={setHbLayout} />
            </div>

            {!finalResult ? (
              <p className="text-xs text-mid-grey/60 italic">Add interventions to the strategy to see the composed heat balance.</p>
            ) : (
              <div className={`flex-1 min-h-0 grid ${bothOn ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                {showBaseline && <HBPanel label="Baseline" result={baselineResult} orientationDeg={orientationDeg} layout={hbLayout} />}
                {showFinal && <HBPanel label="Strategy final" accent={ACCENT} result={finalResult} orientationDeg={orientationDeg} layout={hbLayout} />}
              </div>
            )}
          </div>
        )}

        {tab === 'carbon' && (
          <div className="rounded-lg border border-dashed border-light-grey bg-white/40 p-5 flex flex-col items-center justify-center text-center h-full min-h-[260px]">
            <div className="text-xs uppercase tracking-wider text-mid-grey/60 font-semibold mb-1">CRREM trajectory</div>
            <div className="text-sm text-mid-grey/55 max-w-md">
              Cumulative operational carbon vs the CRREM decarbonisation pathway, 2025–2050 — when (if) this strategy meets the target.
            </div>
            <div className="text-xxs text-mid-grey/40 mt-2">TBD — Brief C (CRREM lifetime carbon)</div>
          </div>
        )}
      </div>
    </div>
  )
}
