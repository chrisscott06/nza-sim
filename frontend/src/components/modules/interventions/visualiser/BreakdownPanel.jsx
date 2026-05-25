/**
 * BreakdownPanel.jsx — Brief 48 Part 2 (2026-05-25) + Parts 3 + 4
 *
 * Per-intervention audit-trail panel. The diagnostic instrument the brief
 * calls for — surfaces the engine's working-out as plain-language rows so
 * the user can sanity-check "is the engine counting everything it should?"
 *
 * Progressive disclosure (brief §UX):
 *   Level 1 — Headline. Top 3 movers, always visible, no engine jargon.
 *   Level 2 — Audit trail. Boundary rows explicit (raw / post-MVHR /
 *             delivered / fuel), grouped, plain-language labels with
 *             precise term in tooltip. Zero-rows suppressed.
 *   Level 3 — Chain context (Part 3). Position-in-chain + clickable
 *             predecessor (the state this row's marginal is computed
 *             against) + clickable successor list. Helps the user
 *             reason about reorder / dependency by navigating the
 *             chain in place. Pure list arithmetic — no engine call.
 *
 * Two framings:
 *   Vs step above (default) — this intervention's marginal contribution.
 *   Vs original building    — total change from baseline.
 * Toggle at the top — only ONE column of Δ shown at a time, not two
 * competing equal columns (would feel like a spreadsheet).
 *
 * Self-contained: owns its own intervention picker and chain navigation.
 * Parent passes the full `interventions` + `stackInterventions` arrays +
 * `selectedId` + `onSelectId` callback (parent handles localStorage
 * persistence). When the user clicks a predecessor / successor in the
 * chain block, the panel calls onSelectId to navigate.
 *
 * Data: reads from the `marginal_delta` + `cumulative_delta` shape that
 * Brief 48 Part 1 extended in `interventionsEngine.js`. The boundary-
 * named fields (heating_raw_demand_mwh, heating_recovery_offset_mwh,
 * heating_post_mvhr_demand_mwh) drive the demand-side rows; existing
 * per_service + per_fuel drive the delivered-side and fuel rows.
 *
 * Live recompute: when the parent's stackResult re-runs (Brief 47
 * live-update loop), the panel's looked-up delta records change →
 * React re-renders → trail updates in the same React batch. No internal
 * engine call.
 *
 * Brief 48 Principle 3 (surface, don't recompute): chain-context
 * predecessor / successor identification is pure list-position
 * arithmetic; no new engine pass for Level 3.
 *
 * Brief 48 Principle 4 (calm, not overwhelming): the rendered panel
 * passes the narrate-test — a reader who doesn't know the engine should
 * be able to say "this lowers heat demand and raises electricity"
 * without help. Tone-coloured numbers (green saving / red increase /
 * neutral grey) carry direction; section headers carry context.
 */

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Info, ArrowUp, ArrowDown } from 'lucide-react'

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

/**
 * Matrix view (Part 4) — whole-stack overview. Rows = interventions,
 * columns = key metrics, cells = tone-coloured Δ. Reuses the same per-row
 * marginal_delta / cumulative_delta records that Trail mode reads — just
 * laid out as rows-of-metrics instead of one-intervention's-rows-of-metrics.
 *
 * Same framing toggle applies: the active framing decides whether each
 * cell shows the marginal Δ (vs step above) or the cumulative Δ (vs
 * original baseline).
 *
 * Click a row to make it the selected intervention so the user can flip
 * back to Trail and read the audit trail of that row in one click.
 */
const MATRIX_COLUMNS = [
  { key: 'heat',  label: 'Heat',   deltaPath: 'heating_post_mvhr_demand_mwh', unit: 'mwh' },
  { key: 'cool',  label: 'Cool',   deltaPath: 'cooling_demand_mwh',           unit: 'mwh' },
  { key: 'dhw',   label: 'Hot wtr', deltaPath: 'per_service.dhw.demand_mwh',  unit: 'mwh' },
  { key: 'elec',  label: 'Elec',   deltaPath: 'per_fuel.electricity_mwh',     unit: 'mwh' },
  { key: 'gas',   label: 'Gas',    deltaPath: 'per_fuel.gas_mwh',             unit: 'mwh' },
  { key: 'eui',   label: 'EUI',    deltaPath: 'eui_kwh_per_m2',               unit: 'kwh_per_m2_yr' },
  { key: 'co2',   label: 'CO₂',    deltaPath: 'carbon_kgco2_per_m2',          unit: 'kgco2_per_m2_yr' },
]

function MatrixCell({ deltaObj, col }) {
  const rec = pickDelta(deltaObj, col.deltaPath)
  const v = rec?.delta
  const threshold = NOISE_THRESHOLD[col.unit] ?? 0.05
  if (v == null || !Number.isFinite(v) || Math.abs(v) < threshold) {
    return <td className="px-2 py-1.5 text-right text-xxs tabular-nums text-mid-grey/30">—</td>
  }
  const tone = deltaTone(v, col.unit)
  return (
    <td className={`px-2 py-1.5 text-right text-xxs tabular-nums font-medium ${TONE[tone]}`}>
      {fmtDelta(v, col.unit)}
    </td>
  )
}

function MatrixView({ interventions, stackInterventions, framing, selectedId, onSelectId }) {
  if (!interventions || interventions.length === 0) {
    return (
      <div className="p-6 text-center text-xxs italic text-mid-grey">
        Add interventions to populate the matrix.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead className="sticky top-0 bg-white z-10">
          <tr className="border-b border-light-grey/60">
            <th className="text-left font-medium text-xxs uppercase tracking-wider text-mid-grey/70 pl-3 pr-2 pb-1.5 pt-1">
              Intervention
            </th>
            {MATRIX_COLUMNS.map(c => (
              <th
                key={c.key}
                className="text-right font-medium text-xxs uppercase tracking-wider text-mid-grey/70 px-2 pb-1.5 pt-1"
                title={`${c.label} — ${unitLabel(c.unit)}`}
              >
                {c.label}
              </th>
            ))}
            <th className="text-left font-normal text-xxs normal-case pl-2 pb-1.5 pt-1 text-mid-grey/40">
              unit
            </th>
          </tr>
        </thead>
        <tbody>
          {interventions.map((iv, idx) => {
            const row = stackInterventions?.[idx] ?? null
            const deltaObj = framing === 'marginal' ? row?.marginal_delta : row?.cumulative_delta
            const disabled = iv?.enabled === false
            const isSelected = selectedId && iv?.id === selectedId
            return (
              <tr
                key={iv?.id ?? idx}
                className={`border-t border-light-grey/40 cursor-pointer transition-colors ${
                  isSelected ? 'bg-off-white/70' : 'hover:bg-off-white/30'
                }`}
                onClick={() => onSelectId?.(iv?.id)}
              >
                <td className="pl-3 pr-2 py-1.5 text-xxs">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-mid-grey/70 tabular-nums">{idx + 1}.</span>
                    <span className={`truncate ${disabled ? 'text-mid-grey/60 italic' : 'text-navy'}`}>
                      {iv?.label || '(unnamed)'}{disabled ? ' · off' : ''}
                    </span>
                  </div>
                </td>
                {MATRIX_COLUMNS.map(c => (
                  <MatrixCell key={c.key} deltaObj={deltaObj} col={c} />
                ))}
                <td className="pl-2 py-1.5 text-xxs text-mid-grey/40 whitespace-nowrap">
                  {/* leave blank — each column has its own unit; the
                      header tooltip carries it. This column is just
                      padding-right symmetry with the Trail table. */}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-3 px-3 text-xxs italic text-mid-grey/70 leading-relaxed">
        Click a row to make it the selected intervention; flip back to Trail for its full audit. Cells show Δ versus the chosen framing; below-threshold values render as "—".
      </p>
    </div>
  )
}

/**
 * Compact one-line summary of an intervention's marginal headline,
 * used inside the chain block for predecessor / successor rows. Picks
 * the single biggest mover; if none, returns "no significant change".
 */
function summariseMarginal(marginalDelta) {
  const top = pickHeadlineRows(marginalDelta)[0]
  if (!top) return 'no significant change'
  const sign = top.delta < 0 ? '−' : '+'
  const num = Math.abs(top.delta) >= 10
    ? Math.abs(top.delta).toFixed(1)
    : Math.abs(top.delta).toFixed(1)
  return `${top.label} ${sign}${num} ${unitLabel(top.unit)}`
}

function ChainRow({ idx, intervention, summary, direction, onClick, active }) {
  const Icon = direction === 'up' ? ArrowUp : ArrowDown
  const directionLabel = direction === 'up' ? 'Above' : 'Below'
  const label = intervention?.label || `Intervention ${idx + 1}`
  const disabled = intervention?.enabled === false
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-start gap-2 text-left px-2 py-1.5 rounded transition-colors ${
        active ? 'bg-off-white' : 'hover:bg-off-white/60'
      }`}
    >
      <Icon size={11} className="text-mid-grey mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xxs text-mid-grey uppercase tracking-wider flex-shrink-0">
            {directionLabel} · {idx + 1}
          </span>
          <span className={`text-xxs font-medium truncate ${disabled ? 'text-mid-grey/60 italic' : 'text-navy'}`}>
            {label}{disabled ? ' · disabled' : ''}
          </span>
        </div>
        <p className="text-xxs text-mid-grey mt-0.5 truncate">{summary}</p>
      </div>
    </button>
  )
}

export default function BreakdownPanel({
  interventions,
  stackInterventions,
  selectedId,
  onSelectId,
}) {
  // Framing toggle — default to "vs step above" (the marginal/diagnostic
  // view that answers Finding D's reorder question). User can switch to
  // "vs original building" for the cumulative-from-baseline view.
  const [framing, setFraming] = useState('marginal')   // 'marginal' | 'cumulative'
  const [mode, setMode] = useState('trail')            // 'trail' | 'matrix' (Part 4)
  const [showDetail, setShowDetail] = useState(true)   // Level 2 expand
  const [showChain, setShowChain] = useState(true)     // Level 3 expand

  const list = Array.isArray(interventions) ? interventions : []
  const stack = Array.isArray(stackInterventions) ? stackInterventions : []

  // Resolve selected index by id; -1 when nothing selected or stale.
  const selectedIdx = useMemo(() => {
    if (!selectedId) return -1
    return list.findIndex(i => i?.id === selectedId)
  }, [list, selectedId])

  const selected = selectedIdx >= 0 ? list[selectedIdx] : null
  const selectedRow = selectedIdx >= 0 ? stack[selectedIdx] : null
  const marginalDelta = selectedRow?.marginal_delta ?? null
  const cumulativeDelta = selectedRow?.cumulative_delta ?? null

  // ── Empty state — no interventions in the stack at all. ──
  if (list.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <p className="text-caption font-semibold text-navy mb-1">No interventions yet</p>
          <p className="text-xxs text-mid-grey">
            Add an intervention in the stack on the left to start auditing what the engine does step-by-step.
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

  // ── Chain context: find immediate predecessor + all successors. ──
  // Only meaningful in Trail mode with a selected row. Pre-compute so
  // the JSX below stays readable; the Trail block guards on `selected`.
  let predecessorIdx = -1
  for (let i = selectedIdx - 1; i >= 0; i--) {
    if (list[i]?.enabled !== false) { predecessorIdx = i; break }
  }
  const predecessor = predecessorIdx >= 0 ? list[predecessorIdx] : null
  const predecessorRow = predecessorIdx >= 0 ? stack[predecessorIdx] : null

  const successors = []
  for (let i = selectedIdx + 1; i < list.length; i++) {
    successors.push({ idx: i, intervention: list[i], row: stack[i] })
  }

  // Header copy varies by mode.
  const headerTitle = mode === 'matrix'
    ? 'Whole-stack overview'
    : (selected ? (selected.label || '(unnamed intervention)') : 'No intervention selected')
  const headerSub = mode === 'matrix'
    ? `Matrix · ${list.length} intervention${list.length === 1 ? '' : 's'} · ${framingLabel}`
    : (selected ? `${selectedIdx + 1} of ${list.length} · Audit trail · ${framingLabel}` : 'Pick one from the dropdown above')

  return (
    <div className="h-full overflow-auto">
      <div className="p-4 space-y-4">
        {/* Header — title + mode toggle + framing toggle */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-light-grey">
          <div className="min-w-0">
            <p className="text-caption font-semibold text-navy truncate">{headerTitle}</p>
            <p className="text-xxs text-mid-grey italic mt-0.5">{headerSub}</p>
          </div>
          <div className="flex-shrink-0 flex items-center gap-2">
            {/* Mode toggle — Trail / Matrix (Part 4) */}
            <div
              className="flex items-center gap-0.5 text-xxs bg-off-white/60 rounded p-0.5"
              role="radiogroup"
              aria-label="View mode"
            >
              <button
                type="button"
                onClick={() => setMode('trail')}
                className={`px-2 py-1 rounded transition-colors ${
                  mode === 'trail' ? 'bg-white text-navy font-medium shadow-sm' : 'text-mid-grey hover:text-navy'
                }`}
                title="Audit trail for one intervention"
                role="radio"
                aria-checked={mode === 'trail'}
              >
                Trail
              </button>
              <button
                type="button"
                onClick={() => setMode('matrix')}
                className={`px-2 py-1 rounded transition-colors ${
                  mode === 'matrix' ? 'bg-white text-navy font-medium shadow-sm' : 'text-mid-grey hover:text-navy'
                }`}
                title="Whole-stack matrix — every intervention × key metrics"
                role="radio"
                aria-checked={mode === 'matrix'}
              >
                Matrix
              </button>
            </div>
            {/* Framing toggle — one selected, the other available; not two
                competing equal columns (brief §UX). Applies in both modes. */}
            <div
              className="flex items-center gap-0.5 text-xxs bg-off-white/60 rounded p-0.5"
              role="radiogroup"
              aria-label="Comparison framing"
            >
              <button
                type="button"
                onClick={() => setFraming('marginal')}
                className={`px-2 py-1 rounded transition-colors ${
                  framing === 'marginal' ? 'bg-white text-navy font-medium shadow-sm' : 'text-mid-grey hover:text-navy'
                }`}
                title="Marginal — each row vs the step above it"
                role="radio"
                aria-checked={framing === 'marginal'}
              >
                vs step above
              </button>
              <button
                type="button"
                onClick={() => setFraming('cumulative')}
                className={`px-2 py-1 rounded transition-colors ${
                  framing === 'cumulative' ? 'bg-white text-navy font-medium shadow-sm' : 'text-mid-grey hover:text-navy'
                }`}
                title="Cumulative — each row vs the unedited baseline"
                role="radio"
                aria-checked={framing === 'cumulative'}
              >
                vs original
              </button>
            </div>
          </div>
        </div>

        {mode === 'matrix' ? (
          <MatrixView
            interventions={list}
            stackInterventions={stack}
            framing={framing}
            selectedId={selectedId}
            onSelectId={onSelectId}
          />
        ) : !selected ? (
          <div className="px-2 py-6 text-center">
            <p className="text-xxs text-mid-grey italic">
              Pick an intervention from the dropdown to see its audit trail — or switch to Matrix to see the whole stack at a glance.
            </p>
          </div>
        ) : (
          <>
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

            {/* Level 3 — Chain context */}
            {(predecessor || successors.length > 0) && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowChain(s => !s)}
                  className="flex items-center gap-1.5 text-xxs text-mid-grey hover:text-navy transition-colors"
                  aria-expanded={showChain}
                >
                  {showChain ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {showChain ? 'Hide chain context' : 'Show chain context'}
                </button>
                {showChain && (
                  <div className="mt-2 pt-2 border-t border-light-grey/60 space-y-1">
                    {predecessor ? (
                      <ChainRow
                        idx={predecessorIdx}
                        intervention={predecessor}
                        summary={`This row's marginal is computed on top of: ${summariseMarginal(predecessorRow?.cumulative_delta)}`}
                        direction="up"
                        onClick={() => onSelectId?.(predecessor.id)}
                      />
                    ) : (
                      <div className="px-2 py-1.5">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-xxs text-mid-grey uppercase tracking-wider">Above</span>
                          <span className="text-xxs italic text-mid-grey">Project baseline (no enabled interventions above this row)</span>
                        </div>
                      </div>
                    )}
                    {successors.length === 0 ? (
                      <div className="px-2 py-1.5">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-xxs text-mid-grey uppercase tracking-wider">Below</span>
                          <span className="text-xxs italic text-mid-grey">Bottom of the stack — nothing flows downstream from this row.</span>
                        </div>
                      </div>
                    ) : (
                      successors.map(s => (
                        <ChainRow
                          key={s.intervention?.id ?? s.idx}
                          idx={s.idx}
                          intervention={s.intervention}
                          summary={summariseMarginal(s.row?.marginal_delta)}
                          direction="down"
                          onClick={() => onSelectId?.(s.intervention?.id)}
                        />
                      ))
                    )}
                    <p className="mt-2 px-2 text-xxs italic text-mid-grey/70 leading-relaxed">
                      Click a row to navigate. Successor rows show their own marginal — your edits to this intervention flow into the state they're computed against.
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
