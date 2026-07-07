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
import CrremStrandingDiagram from './crrem/CrremStrandingDiagram.jsx'
import CrremPicker from './crrem/CrremPicker.jsx'
import EPTrajectory from './EPTrajectory.jsx'
import EPCompareCard from './EPCompareCard.jsx'
import { computeLifetimeCarbon, perFuelFromDeltaRecord, defaultLifetimeYears } from '../../../utils/lifetimeCarbon.js'
import { readModelledEui } from '../../../utils/engineReads.js'
import { getGia } from './visualiser/unitFmt.js'
import { computeCostTotal } from '../../../utils/costModel.js'

const gbpShort = (n) => {
  const v = Number(n) || 0
  if (v >= 1e6) return `£${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `£${Math.round(v / 1e3)}k`
  return `£${Math.round(v)}`
}

/** { electricity, gas } annual delivered kWh from an engine result. */
function fuelsKwhFromResult(res) {
  return {
    electricity: (res?.consumption?.total?.electricity_mwh ?? 0) * 1000,
    gas:         (res?.consumption?.total?.gas_mwh ?? 0) * 1000,
  }
}

const SAVE_GREEN = '#16A34A'
const INCREASE_RED = '#DC2626'
const ACCENT = '#E84393'

const TABS = [
  ['waterfall', 'Waterfall'],
  ['heatbalance', 'Heat balance'],
  ['carbon', 'Carbon'],
  ['epcompare', 'EnergyPlus'],
]

/** EP marginal ΔEUI table row: NZA marginal | EP marginal | Δ%. */
function MarginalRow({ label, nza, ep }) {
  const sgn = (v) => (!Number.isFinite(v) ? '—' : `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}`)
  const both = [nza, ep].every(Number.isFinite)
  const pct = both && nza !== 0 ? ((ep - nza) / Math.abs(nza)) * 100 : null
  const pctColour = pct == null ? '#9CA3AF' : Math.abs(pct) >= 50 ? '#DC2626' : Math.abs(pct) >= 25 ? '#D97706' : '#6B7280'
  return (
    <tr className="border-t border-light-grey/40">
      <td className="py-1.5 pr-3 text-mid-grey truncate max-w-[160px]"><span title={label}>{label}</span></td>
      <td className="py-1.5 px-2 text-right tabular-nums text-navy">{sgn(nza)}</td>
      <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: Number.isFinite(ep) ? '#1F2937' : undefined }}>
        {Number.isFinite(ep) ? sgn(ep) : <span className="text-mid-grey/40">—</span>}
      </td>
      <td className="py-1.5 pl-2 text-right tabular-nums" style={{ color: pctColour }}>
        {pct == null ? <span className="text-mid-grey/40">—</span> : `${pct < 0 ? '−' : '+'}${Math.abs(pct).toFixed(Math.abs(pct) >= 10 ? 0 : 1)}%`}
      </td>
    </tr>
  )
}

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

export default function StrategyView({ strategyName = 'Strategy 1', interventions = [], stackResult, orientationDeg = 0, crremPick, onCrremPathwayChange, epResults }) {
  const [tab, setTab] = useState('waterfall')
  const [showBaseline, setShowBaseline] = useState(true)
  const [showFinal, setShowFinal] = useState(true)
  const [hbLayout, setHbLayout] = useState('rows')
  const [crremCompare, setCrremCompare] = useState(true)   // CRREM baseline-vs-strategy overlay

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

  // Brief 89 (Brief C): CRREM stranding-diagram inputs + strategy lifetime carbon.
  const crremGia = getGia(baselineResult)
  const crremBaseEUI = readModelledEui(baselineResult)
  const crremFinalEUI = readModelledEui(finalResult) ?? crremBaseEUI
  const crremBaseFuels = fuelsKwhFromResult(baselineResult)
  const crremFinalFuels = fuelsKwhFromResult(finalResult)
  // Strategy lifetime carbon = Σ each enabled intervention's MARGINAL lifetime
  // carbon (marginals telescope to the cumulative; using marginals lets each
  // measure carry its own lifetime without double-counting).
  const strategyLifetimeTco2e = rows.filter(r => r?.enabled).reduce((sum, row) => {
    const iv = interventions.find(i => i.id === row.id) || {}
    const pf = perFuelFromDeltaRecord(row.marginal_delta?.per_fuel)
    const years = iv.lifetime_years ?? defaultLifetimeYears(iv.theme ?? iv.category)
    return sum + (computeLifetimeCarbon(pf, { lifetimeYears: years }).lifetime_carbon_saved_tco2e || 0)
  }, 0)

  // Brief 90 (Brief B): strategy capex = Σ enabled interventions' cost totals
  // (order-independent — unlike cumulative carbon). £/tonne = capex ÷ lifetime tCO₂e.
  const enabledCostTotal = rows.filter(r => r?.enabled).reduce((sum, row) => {
    const iv = interventions.find(i => i.id === row.id)
    return sum + (iv ? computeCostTotal(iv.cost) : 0)
  }, 0)
  const strategyPerTonne = enabledCostTotal > 0 && strategyLifetimeTco2e > 0
    ? enabledCostTotal / strategyLifetimeTco2e : null

  // Never let both panels be hidden.
  const toggleBaseline = () => setShowBaseline((v) => (v && !showFinal ? v : !v))
  const toggleFinal = () => setShowFinal((v) => (v && !showBaseline ? v : !v))
  const bothOn = showBaseline && showFinal

  // ── Brief 95 P7 — EnergyPlus overlay + side-by-side ───────────────────────
  // Enabled NZA rows (strategy order) align 1:1 by index with the EP cumulative
  // states (build_states walks the same ordered-enabled refs), so we zip by index
  // rather than by label — robust to duplicate labels. EP values are only surfaced
  // when FRESH (status), so a stale/un-run step is simply absent from the overlay.
  const enabledRows = rows.filter((r) => r?.enabled)
  const epCumStates = (epResults?.states ?? []).filter((s) => s.descriptor?.startsWith('cumulative:'))
  const epBaseline = epResults?.byDesc?.baseline ?? null
  const epFresh = (st) => (st && st.status === 'fresh' ? st.result : null)
  const labelFor = (row, i) => interventions.find((iv) => iv.id === row.id)?.label || row.label || `Step ${i + 1}`

  const trajSteps = [
    { label: 'Baseline', nza: baselineEUI, ep: epFresh(epBaseline)?.eui_kwh_per_m2_yr ?? null },
    ...enabledRows.map((r, i) => ({
      label: labelFor(r, i),
      nza: r?.cumulative_delta?.eui_kwh_per_m2?.to,
      ep: epFresh(epCumStates[i])?.eui_kwh_per_m2_yr ?? null,
    })),
  ]

  // Final cumulative state (full metric breakdown) — last enabled row vs last EP
  // cumulative state; falls back to the baseline when the strategy is empty.
  const lastRow = enabledRows[enabledRows.length - 1] ?? null
  const lastEpState = epCumStates[epCumStates.length - 1] ?? epBaseline
  const finalCd = lastRow?.cumulative_delta ?? null
  // Raw result (fresh OR stale) so a stale state shows the GREYED old figure per the
  // stale-guard; finalStatus drives the grey + "re-run" pill + Δ% suppression.
  const finalEpRes = lastEpState?.result ?? null
  const finalRows = [
    { label: 'EUI', unit: 'kWh/m²', nza: finalCd ? finalCd.eui_kwh_per_m2?.to : baselineEUI, ep: finalEpRes?.eui_kwh_per_m2_yr },
    { label: 'Heating demand', unit: 'MWh', nza: finalCd?.heating_demand_mwh?.to, ep: finalEpRes?.demand_mwh?.space_heating },
    { label: 'Cooling demand', unit: 'MWh', nza: finalCd?.cooling_demand_mwh?.to, ep: finalEpRes?.demand_mwh?.space_cooling },
  ]
  const finalStatus = lastEpState?.status ?? 'none'

  // Per-measure MARGINAL ΔEUI: NZA marginal vs EP marginal (cum[i] − cum[i−1]).
  const marginalRows = enabledRows.map((r, i) => {
    const cur = epFresh(epCumStates[i])
    const prev = i === 0 ? epFresh(epBaseline) : epFresh(epCumStates[i - 1])
    const epMarg = cur && prev ? cur.eui_kwh_per_m2_yr - prev.eui_kwh_per_m2_yr : null
    return { label: labelFor(r, i), nza: r?.marginal_delta?.eui_kwh_per_m2?.delta, ep: epMarg }
  })

  const anyEp = epResults?.states?.some((s) => s.status === 'fresh')

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
          <Stat
            label="Lifetime carbon"
            accent={strategyLifetimeTco2e > 0.05 ? SAVE_GREEN : strategyLifetimeTco2e < -0.05 ? INCREASE_RED : undefined}
            value={Number.isFinite(strategyLifetimeTco2e) ? `${signed(strategyLifetimeTco2e, 0)} tCO₂e` : '—'}
            sub="by 2050"
          />
          {enabledCostTotal > 0
            ? <Stat label="Total capex" value={gbpShort(enabledCostTotal)} sub="enabled measures" />
            : <Stat label="Total capex" placeholder="add costs in Library" />}
          {strategyPerTonne != null
            ? <Stat label="£ / tonne CO₂" value={gbpShort(strategyPerTonne)} sub="capex ÷ lifetime tCO₂e" />
            : <Stat label="£ / tonne CO₂" placeholder="add costs in Library" />}
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
          <div className="flex flex-col gap-2 h-full">
            <div className="flex-shrink-0 flex items-center justify-between gap-3 flex-wrap">
              {crremPick ? <CrremPicker pick={crremPick} onPathwayChange={onCrremPathwayChange} /> : <span />}
              <div className="flex items-center gap-2">
                <span className="text-xxs uppercase tracking-wider text-mid-grey/60 font-semibold">Compare</span>
                <PanelToggle active={crremCompare} onClick={() => setCrremCompare((v) => !v)}>
                  Baseline (no measures)
                </PanelToggle>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              <CrremStrandingDiagram
                finalFuels={crremFinalFuels}
                baseFuels={crremBaseFuels}
                gia={crremGia}
                finalEUI={crremFinalEUI}
                baselineEUI={crremBaseEUI}
                lifetimeCarbonSaved={strategyLifetimeTco2e}
                showBaseline={crremCompare}
                pick={crremPick}
              />
            </div>
          </div>
        )}

        {tab === 'epcompare' && (
          <div className="flex flex-col gap-3">
            {!anyEp && (
              <div className="rounded-lg border border-dashed border-light-grey bg-off-white/40 px-3 py-2 text-xxs text-mid-grey">
                No EnergyPlus results for the current config yet. Run them from the “Validate with EnergyPlus” panel
                (left). Numbers appear here once a fresh run exists; edited measures grey out until re-run.
              </div>
            )}

            <EPTrajectory steps={trajSteps} />

            <EPCompareCard
              title="Strategy final (cumulative)"
              subtitle="baseline + all enabled measures · absolute state values"
              epStatus={finalStatus}
              rows={finalRows}
            />

            <div className="rounded-lg border border-light-grey/70 bg-white px-3 py-2">
              <div className="text-xxs uppercase tracking-wider text-mid-grey/70 font-semibold pb-0.5">
                Marginal ΔEUI per measure
                <span className="ml-2 font-normal normal-case tracking-normal text-mid-grey/50">
                  each measure’s step, both engines
                </span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-xxs uppercase tracking-wider text-mid-grey/50">
                    <th className="text-left font-semibold py-1 pr-3">Measure</th>
                    <th className="text-right font-semibold py-1 px-2">NZA-Sim</th>
                    <th className="text-right font-semibold py-1 px-2">EnergyPlus</th>
                    <th className="text-right font-semibold py-1 pl-2">Δ%</th>
                  </tr>
                </thead>
                <tbody>
                  {marginalRows.length === 0
                    ? <tr><td colSpan={4} className="py-2 text-mid-grey/50 italic">No enabled measures.</td></tr>
                    : marginalRows.map((m, i) => <MarginalRow key={`${m.label}-${i}`} label={m.label} nza={m.nza} ep={m.ep} />)}
                </tbody>
              </table>
              <p className="text-xxs text-mid-grey/50 pt-1 italic">
                Marginal ΔEUI in kWh/m²·yr. EP marginal = EP(through this) − EP(through previous); shown only where both
                cumulative steps have a fresh run. Δ% is EP vs NZA-Sim.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
