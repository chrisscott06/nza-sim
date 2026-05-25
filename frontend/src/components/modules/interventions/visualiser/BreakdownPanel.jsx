/**
 * BreakdownPanel.jsx — Brief 48 Part 2 (2026-05-25)
 *
 * Per-intervention audit-trail panel. The diagnostic instrument the brief
 * calls for — surfaces the engine's working-out as plain-language rows so
 * the user can sanity-check "is the engine counting everything it should?"
 *
 * Progressive disclosure (brief §UX):
 *   Level 1 — Headline. One calm line per few key metrics that matter.
 *             Always visible. No engine jargon.
 *   Level 2 — Audit trail. Boundary rows explicit (raw / post-MVHR /
 *             delivered / fuel), grouped, plain-language labels with
 *             precise term in tooltip. Zero-rows suppressed to "no change".
 *   Level 3 — Chain context (Part 3, not this commit).
 *
 * Two framings:
 *   Vs step above (default) — this intervention's marginal contribution.
 *   Vs original building    — total change from baseline.
 * Toggle at the top — only ONE column of Δ shown at a time, not two
 * competing equal columns (would feel like a spreadsheet).
 *
 * Data: reads from the `marginal_delta` + `cumulative_delta` shape that
 * Brief 48 Part 1 extended in `interventionsEngine.js`. The boundary-
 * named fields (heating_raw_demand_mwh, heating_recovery_offset_mwh,
 * heating_post_mvhr_demand_mwh) drive the demand-side rows; existing
 * per_service + per_fuel drive the delivered-side and fuel rows.
 *
 * Live recompute: receives `intervention` + the relevant delta object
 * via props from the parent. When the parent's stackResult re-runs
 * (Brief 47 live-update loop), props change → React re-renders → trail
 * updates in the same React batch. No internal engine call.
 *
 * Brief 48 Principle 4 (calm, not overwhelming): the rendered panel
 * passes the narrate-test — a reader who doesn't know the engine should
 * be able to say "this lowers heat demand and raises electricity"
 * without help. Tone-coloured numbers (green saving / red increase /
 * neutral grey) carry direction; section headers carry context.
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight, Info } from 'lucide-react'

const TONE = {
  good:    'text-green-700',
  bad:     'text-red-700',
  neutral: 'text-mid-grey',
}

// Per-quantity suppression threshold. A delta with absolute value below
// the threshold is rendered as "no change" (or hidden if the section is
// empty). Tuned to skip noise but surface anything meaningful at the
// MWh / kWh/m²·yr / kgCO₂/m²·yr scales the panel uses.
const NOISE_THRESHOLD = {
  mwh:                0.05,   // any per-service or per-fuel value
  kwh_per_m2_yr:      0.05,   // EUI
  kgco2_per_m2_yr:    0.05,   // operational carbon
  unitless:           0.005,  // efficiency (SCOP / SEER)
}

function unitFor(metricKey) {
  if (metricKey.endsWith('_mwh')) return 'mwh'
  if (metricKey === 'eui_kwh_per_m2') return 'kwh_per_m2_yr'
  if (metricKey === 'carbon_kgco2_per_m2') return 'kgco2_per_m2_yr'
  return 'unitless'
}

function unitLabel(unit) {
  if (unit === 'mwh')             return 'MWh'
  if (unit === 'kwh_per_m2_yr')   return 'kWh/m²·yr'
  if (unit === 'kgco2_per_m2_yr') return 'kgCO₂/m²·yr'
  return ''
}

function fmtValue(v, unit) {
  if (v == null || !Number.isFinite(v)) return '—'
  if (unit === 'unitless') return v.toFixed(2)
  if (Math.abs(v) >= 100) return v.toFixed(0)
  if (Math.abs(v) >= 10)  return v.toFixed(1)
  return v.toFixed(1)
}

function fmtDelta(v, unit) {
  if (v == null || !Number.isFinite(v)) return '—'
  const threshold = NOISE_THRESHOLD[unit] ?? 0.05
  if (Math.abs(v) < threshold) return 'no change'
  const sign = v < 0 ? '−' : '+'
  if (unit === 'unitless') return `${sign}${Math.abs(v).toFixed(2)}`
  if (Math.abs(v) >= 10)   return `${sign}${Math.abs(v).toFixed(1)}`
  return `${sign}${Math.abs(v).toFixed(1)}`
}

/**
 * Tone for a delta. Heating "saving" semantics: lower demand / lower
 * fuel = good (green); higher delivered electricity for a fan is also a
 * sign-flip we colour as red (the user can read the headline and decide
 * if it's an acceptable trade-off, but the panel surfaces direction
 * honestly — Brief 48 §UX "direction is instantly readable").
 *
 * Efficiency (SCOP/SEER) is the exception: HIGHER is better, so the
 * sign convention flips. Caller passes `goodWhenPositive: true` for
 * efficiency rows.
 */
function deltaTone(v, unit, { goodWhenPositive = false } = {}) {
  if (v == null || !Number.isFinite(v)) return 'neutral'
  const threshold = NOISE_THRESHOLD[unit] ?? 0.05
  if (Math.abs(v) < threshold) return 'neutral'
  if (goodWhenPositive) return v > 0 ? 'good' : 'bad'
  return v < 0 ? 'good' : 'bad'
}

/**
 * Extract a metric record from a delta object via a dot-path. Returns
 * a `{ from, to, delta, delta_pct } | null` shape (the deltaRecord
 * shape from interventionsEngine.js).
 */
function pickDelta(deltaObj, path) {
  if (!deltaObj || typeof deltaObj !== 'object' || !path) return null
  let cur = deltaObj
  for (const seg of path.split('.')) {
    if (cur == null) return null
    cur = cur[seg]
  }
  return cur ?? null
}

/**
 * Row spec — { key, label, tooltip, deltaPath, goodWhenPositive? }.
 * `deltaPath` resolves against the active delta object (marginal or
 * cumulative). `goodWhenPositive` flips the tone for efficiency rows.
 */
const ROWS = {
  demand: [
    { key: 'raw_demand',     label: 'Heat the building needs',  tooltip: 'Raw State 2 zone demand · pre-MVHR (consumption.space_heating.demand_mwh)', deltaPath: 'heating_raw_demand_mwh' },
    { key: 'mvhr_recovery',  label: 'Heat recovered by MVHR',   tooltip: 'MVHR recovery credit applied to heating demand (consumption.space_heating.recovery_offset_mwh)', deltaPath: 'heating_recovery_offset_mwh', goodWhenPositive: true },
    { key: 'post_mvhr',      label: 'After heat recovery',      tooltip: 'Post-MVHR heating demand — what systems are sized to (raw − recovery)', deltaPath: 'heating_post_mvhr_demand_mwh' },
    { key: 'cooling_demand', label: 'Cooling demand',            tooltip: 'Cooling load at the zone (consumption.space_cooling.demand_mwh)', deltaPath: 'cooling_demand_mwh' },
    { key: 'dhw_demand',     label: 'Hot water demand',          tooltip: 'Tap-mix-corrected DHW demand (consumption.dhw.demand_mwh)', deltaPath: 'per_service.dhw.demand_mwh' },
  ],
  delivered: [
    { key: 'heat_del',  label: 'Heating delivered',     tooltip: 'Energy delivered by heating systems (consumption.space_heating.delivered_mwh)', deltaPath: 'per_service.heating.delivered_mwh' },
    { key: 'heat_eff',  label: 'Heating efficiency',     tooltip: 'Seasonal COP / efficiency of the heating system mix', deltaPath: 'per_service.heating.efficiency', goodWhenPositive: true },
    { key: 'cool_del',  label: 'Cooling delivered',     tooltip: 'Energy delivered by cooling systems (consumption.space_cooling.delivered_mwh)', deltaPath: 'per_service.cooling.delivered_mwh' },
    { key: 'cool_eff',  label: 'Cooling efficiency',     tooltip: 'Seasonal EER / efficiency of the cooling system mix', deltaPath: 'per_service.cooling.efficiency', goodWhenPositive: true },
    { key: 'dhw_del',   label: 'Hot water delivered',   tooltip: 'Energy delivered by DHW systems (consumption.dhw.delivered_mwh)', deltaPath: 'per_service.dhw.delivered_mwh' },
  ],
  fuel: [
    { key: 'total_elec', label: 'Total electricity',     tooltip: 'All electricity consumed across the building (consumption.total.electricity_mwh)', deltaPath: 'per_fuel.electricity_mwh' },
    { key: 'total_gas',  label: 'Total gas',              tooltip: 'All gas consumed across the building (consumption.total.gas_mwh)', deltaPath: 'per_fuel.gas_mwh' },
    { key: 'heat_elec',  label: 'Heating electricity',   tooltip: 'Per-service: electricity used by heating systems', deltaPath: 'per_service.heating.electricity_mwh' },
    { key: 'heat_gas',   label: 'Heating gas',            tooltip: 'Per-service: gas used by heating systems', deltaPath: 'per_service.heating.gas_mwh' },
    { key: 'dhw_elec',   label: 'Hot water electricity', tooltip: 'Per-service: electricity used by DHW systems', deltaPath: 'per_service.dhw.electricity_mwh' },
    { key: 'dhw_gas',    label: 'Hot water gas',          tooltip: 'Per-service: gas used by DHW systems', deltaPath: 'per_service.dhw.gas_mwh' },
    { key: 'cool_elec',  label: 'Cooling electricity',   tooltip: 'Per-service: electricity used by cooling systems', deltaPath: 'per_service.cooling.electricity_mwh' },
  ],
  headline: [
    { key: 'eui',    label: 'EUI',                tooltip: 'Energy Use Intensity — all delivered energy per m² of GIA per year', deltaPath: 'eui_kwh_per_m2' },
    { key: 'carbon', label: 'Operational carbon', tooltip: 'Annual operational carbon per m² of GIA — driven by the fuel mix × emission factors', deltaPath: 'carbon_kgco2_per_m2' },
  ],
}

/**
 * The Level 1 headline. The first three meaningful rows from the
 * intervention's marginal_delta — typically heating-demand-side change,
 * a fuel-side change, and EUI. Each rendered as "Label  ±X unit" with
 * tone colour. No section headers, no boundaries, no jargon.
 *
 * The rule: pick the three rows whose marginal Δ has the largest
 * absolute magnitude (after normalising by typical scale per unit
 * family), so a fabric intervention surfaces heat-demand changes and a
 * plant-electrification surfaces fuel-side changes. Pure ordering rule
 * — no physics judgement.
 */
function pickHeadlineRows(marginalDelta) {
  // Candidates: post-MVHR demand, total elec, total gas, EUI, carbon.
  const candidates = [
    { label: 'Heat demand', deltaPath: 'heating_post_mvhr_demand_mwh',  unit: 'mwh',            goodWhenPositive: false },
    { label: 'Cooling',     deltaPath: 'cooling_demand_mwh',             unit: 'mwh',            goodWhenPositive: false },
    { label: 'Hot water',   deltaPath: 'per_service.dhw.demand_mwh',     unit: 'mwh',            goodWhenPositive: false },
    { label: 'Electricity', deltaPath: 'per_fuel.electricity_mwh',       unit: 'mwh',            goodWhenPositive: false },
    { label: 'Gas',         deltaPath: 'per_fuel.gas_mwh',               unit: 'mwh',            goodWhenPositive: false },
    { label: 'EUI',         deltaPath: 'eui_kwh_per_m2',                 unit: 'kwh_per_m2_yr',  goodWhenPositive: false },
    { label: 'Carbon',      deltaPath: 'carbon_kgco2_per_m2',            unit: 'kgco2_per_m2_yr', goodWhenPositive: false },
  ]
  const scored = candidates.map(c => {
    const rec = pickDelta(marginalDelta, c.deltaPath)
    const delta = rec?.delta
    return { ...c, delta }
  }).filter(c => Number.isFinite(c.delta) && Math.abs(c.delta) >= (NOISE_THRESHOLD[c.unit] ?? 0.05))
   // Sort by absolute delta — biggest movers first
   .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  return scored.slice(0, 3)
}

function Headline({ marginalDelta }) {
  const rows = pickHeadlineRows(marginalDelta)
  if (rows.length === 0) {
    return (
      <p className="text-caption text-mid-grey italic">
        This intervention has no captured changes — open it via the pencil to start editing.
      </p>
    )
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
      {rows.map((r, i) => {
        const tone = deltaTone(r.delta, r.unit, { goodWhenPositive: r.goodWhenPositive })
        return (
          <div key={i} className="flex items-baseline gap-1.5">
            <span className="text-xxs text-mid-grey uppercase tracking-wider">{r.label}</span>
            <span className={`text-caption font-semibold tabular-nums ${TONE[tone]}`}>
              {fmtDelta(r.delta, r.unit)}
              <span className="text-xxs font-normal text-mid-grey/80 ml-0.5">{unitLabel(r.unit)}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

function Row({ rowSpec, deltaObj, unitOverride }) {
  const rec = pickDelta(deltaObj, rowSpec.deltaPath)
  if (!rec || (!Number.isFinite(rec.from) && !Number.isFinite(rec.to))) return null

  // Render even when delta is zero — the row shows before + after values
  // (useful: "this intervention didn't touch X" is information). But mute
  // the delta cell when below threshold via fmtDelta's "no change".
  const unit = unitOverride ?? unitFor(rowSpec.deltaPath.split('.').pop())
  const tone = deltaTone(rec.delta, unit, { goodWhenPositive: rowSpec.goodWhenPositive })

  // Suppress zero-on-zero rows entirely (avoid noise — Brief 48 §UX
  // "An intervention that doesn't touch a given metric shows a quiet
  // 'no change' not a noisy zero-row. Don't make the user scan rows of
  // zeros to find the one thing that moved.")
  const bothZero = (rec.from ?? 0) === 0 && (rec.to ?? 0) === 0
  if (bothZero) return null

  return (
    <tr className="border-t border-light-grey/40 hover:bg-off-white/30">
      <td className="py-1.5 pl-2 pr-3 text-xxs text-navy">
        <span className="inline-flex items-center gap-1">
          {rowSpec.label}
          {rowSpec.tooltip && (
            <span title={rowSpec.tooltip} className="text-mid-grey/40 hover:text-mid-grey">
              <Info size={10} />
            </span>
          )}
        </span>
      </td>
      <td className="py-1.5 px-2 text-right text-xxs tabular-nums text-mid-grey/80">
        {fmtValue(rec.from, unit)}
      </td>
      <td className="py-1.5 px-2 text-right text-xxs tabular-nums text-navy">
        {fmtValue(rec.to, unit)}
      </td>
      <td className={`py-1.5 px-2 text-right text-xxs tabular-nums font-medium ${TONE[tone]}`}>
        {fmtDelta(rec.delta, unit)}
      </td>
      <td className="py-1.5 pl-2 pr-2 text-xxs text-mid-grey/70 whitespace-nowrap">
        {unitLabel(unit)}
      </td>
    </tr>
  )
}

function Section({ title, rows, deltaObj }) {
  // Render only if at least one row produces output (the row's bothZero
  // check filters silently). Compute that by attempting to extract each row.
  const visibleRows = rows.filter(r => {
    const rec = pickDelta(deltaObj, r.deltaPath)
    if (!rec) return false
    if (!Number.isFinite(rec.from) && !Number.isFinite(rec.to)) return false
    const bothZero = (rec.from ?? 0) === 0 && (rec.to ?? 0) === 0
    return !bothZero
  })

  if (visibleRows.length === 0) return null

  return (
    <div className="mt-4 first:mt-0">
      <p className="text-xxs uppercase tracking-wider text-mid-grey font-medium mb-1 px-2">{title}</p>
      <table className="w-full">
        <thead>
          <tr className="text-mid-grey/60">
            <th className="text-left font-medium text-xxs uppercase tracking-wider pl-2 pr-3 pb-1">Metric</th>
            <th className="text-right font-medium text-xxs uppercase tracking-wider px-2 pb-1">Baseline</th>
            <th className="text-right font-medium text-xxs uppercase tracking-wider px-2 pb-1">After</th>
            <th className="text-right font-medium text-xxs uppercase tracking-wider px-2 pb-1">Δ</th>
            <th className="text-left font-normal text-xxs normal-case pl-2 pb-1 text-mid-grey/50">unit</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map(r => <Row key={r.key} rowSpec={r} deltaObj={deltaObj} />)}
        </tbody>
      </table>
    </div>
  )
}

const INTERVENTIONS_ACCENT = '#E84393'

export default function BreakdownPanel({ intervention, marginalDelta, cumulativeDelta }) {
  // Framing toggle — default to "vs step above" (the marginal/diagnostic
  // view that answers Finding D's reorder question). User can switch to
  // "vs original building" for the cumulative-from-baseline view.
  const [framing, setFraming] = useState('marginal')   // 'marginal' | 'cumulative'
  const [showDetail, setShowDetail] = useState(true)   // Level 2 expand

  if (!intervention) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <p className="text-caption font-semibold text-navy mb-1">No intervention selected</p>
          <p className="text-xxs text-mid-grey">
            Pick an intervention from the dropdown above to see its audit trail — what changed, where in the chain, and what flowed downstream.
          </p>
        </div>
      </div>
    )
  }

  const activeDelta = framing === 'marginal' ? marginalDelta : cumulativeDelta
  const framingLabel = framing === 'marginal' ? 'vs step above' : 'vs original building'
  const framingHint = framing === 'marginal'
    ? "This intervention's marginal contribution on top of everything above it in the stack."
    : 'Total change from the unedited project baseline, including everything above this intervention.'

  return (
    <div className="h-full overflow-auto">
      <div className="p-4 space-y-4">
        {/* Header — intervention name + framing toggle */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-light-grey">
          <div className="min-w-0">
            <p className="text-caption font-semibold text-navy truncate">{intervention.label || '(unnamed intervention)'}</p>
            <p className="text-xxs text-mid-grey italic mt-0.5">
              Audit trail · {framingLabel}
            </p>
          </div>
          {/* Framing toggle — one selected, the other available; not two
              competing equal columns (brief §UX). */}
          <div
            className="flex-shrink-0 flex items-center gap-0.5 text-xxs bg-off-white/60 rounded p-0.5"
            role="radiogroup"
            aria-label="Comparison framing"
          >
            <button
              type="button"
              onClick={() => setFraming('marginal')}
              className={`px-2 py-1 rounded transition-colors ${
                framing === 'marginal'
                  ? 'bg-white text-navy font-medium shadow-sm'
                  : 'text-mid-grey hover:text-navy'
              }`}
              title="Marginal — this intervention's contribution on top of everything above it"
              role="radio"
              aria-checked={framing === 'marginal'}
            >
              vs step above
            </button>
            <button
              type="button"
              onClick={() => setFraming('cumulative')}
              className={`px-2 py-1 rounded transition-colors ${
                framing === 'cumulative'
                  ? 'bg-white text-navy font-medium shadow-sm'
                  : 'text-mid-grey hover:text-navy'
              }`}
              title="Cumulative — total change from the unedited baseline"
              role="radio"
              aria-checked={framing === 'cumulative'}
            >
              vs original
            </button>
          </div>
        </div>

        {/* Level 1 — Headline */}
        <Headline marginalDelta={activeDelta} />

        {/* Level 2 — Audit trail expand */}
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowDetail(s => !s)}
            className="flex items-center gap-1.5 text-xxs text-mid-grey hover:text-navy transition-colors"
            aria-expanded={showDetail}
          >
            {showDetail ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {showDetail ? 'Hide details' : 'Show details'}
          </button>
          {showDetail && (
            <div className="mt-2 pt-2 border-t border-light-grey/60">
              <Section title="Demand side · what the building needs" rows={ROWS.demand} deltaObj={activeDelta} />
              <Section title="Delivered by systems"                  rows={ROWS.delivered} deltaObj={activeDelta} />
              <Section title="Fuel consumed"                          rows={ROWS.fuel} deltaObj={activeDelta} />
              <Section title="Headline impact"                         rows={ROWS.headline} deltaObj={activeDelta} />
              <p className="mt-4 px-2 text-xxs italic text-mid-grey/70 leading-relaxed">
                {framingHint}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
