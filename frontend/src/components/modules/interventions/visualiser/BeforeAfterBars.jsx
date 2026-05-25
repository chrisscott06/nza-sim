/**
 * BeforeAfterBars.jsx — Brief 47 Part 4 (2026-05-24)
 *
 * Small "baseline → cumulative" two-bar comparison for the right-pane
 * visualiser. The waterfall view shows the per-intervention breakdown;
 * this view shows the single overall before/after delta as compact bars
 * that read at a glance.
 *
 * Reads from the same `stackResult` shape EUIWaterfall uses:
 *   stackResult.baseline.consumption.total.kwh_per_m2_yr
 *   stackResult.interventions[last enabled].result.consumption.total.kwh_per_m2_yr
 *
 * Two metrics shown side-by-side: EUI (kWh/m²·yr) and Carbon
 * (kgCO₂/m²·yr). Each metric has a baseline bar + a cumulative bar +
 * a delta pill with the percentage saving (green) or increase (red).
 *
 * Presentation-only — no new computation. Brief 47 Principle 4.
 */

const INTERVENTIONS_ACCENT = '#E84393'

function pickFirst(result, paths) {
  if (!result) return null
  for (const path of paths) {
    let cur = result
    for (const seg of path.split('.')) {
      if (cur == null) break
      cur = cur[seg]
    }
    if (Number.isFinite(cur)) return cur
  }
  return null
}

function pullEui(r) {
  return pickFirst(r, [
    'consumption.total.kwh_per_m2_yr',
    'results.energy.kwh_per_m2_yr',
    'energy_use.totals.eui_kwh_per_m2',
  ])
}

function pullCarbon(r) {
  return pickFirst(r, [
    'carbon_kg_co2_per_m2',
    'results.carbon.today.kgCO2_per_m2_yr',
    'consumption.carbon_kgco2_per_m2',
  ])
}

function findCumulativeResult(stackResult) {
  if (!stackResult) return null
  const rows = Array.isArray(stackResult.interventions) ? stackResult.interventions : []
  // Walk backwards to find the last ENABLED intervention — its `result`
  // is the cumulative state after all enabled patches have been applied.
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    if (row && row.enabled !== false && row.result) return row.result
  }
  // No enabled interventions → cumulative === baseline.
  return stackResult.baseline ?? null
}

function fmtDelta(delta, unit) {
  if (!Number.isFinite(delta)) return { text: '—', tone: 'neutral' }
  if (Math.abs(delta) < 0.05) return { text: `0.0 ${unit}`, tone: 'neutral' }
  const sign = delta < 0 ? '−' : '+'
  const tone = delta < 0 ? 'good' : 'bad'
  return { text: `${sign}${Math.abs(delta).toFixed(1)} ${unit}`, tone }
}

function fmtPct(baseline, current) {
  if (!Number.isFinite(baseline) || !Number.isFinite(current) || baseline === 0) return null
  const pct = ((current - baseline) / baseline) * 100
  if (!Number.isFinite(pct)) return null
  const sign = pct < 0 ? '−' : '+'
  return `${sign}${Math.abs(pct).toFixed(1)}%`
}

function MetricBars({ label, unit, baseline, current }) {
  const max = Math.max(baseline ?? 0, current ?? 0, 1)
  const baselinePct = ((baseline ?? 0) / max) * 100
  const currentPct = ((current ?? 0) / max) * 100
  const delta = (current != null && baseline != null) ? (current - baseline) : null
  const deltaFmt = fmtDelta(delta, unit)
  const pct = fmtPct(baseline, current)

  return (
    <div className="rounded-lg border border-light-grey bg-white p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xxs uppercase tracking-wider font-semibold text-mid-grey">{label}</span>
        <span className={`text-caption font-semibold tabular-nums ${
          deltaFmt.tone === 'good' ? 'text-green-700' :
          deltaFmt.tone === 'bad'  ? 'text-red-700'   : 'text-mid-grey'
        }`}>
          {deltaFmt.text}{pct && <span className="text-xxs font-normal ml-1">({pct})</span>}
        </span>
      </div>

      {/* Baseline bar */}
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-xxs text-mid-grey">Baseline</span>
          <span className="text-caption tabular-nums text-navy">
            {baseline != null ? `${baseline.toFixed(1)} ${unit}` : '—'}
          </span>
        </div>
        <div className="h-3 bg-light-grey/30 rounded">
          <div
            className="h-full rounded transition-all"
            style={{ width: `${baselinePct}%`, backgroundColor: '#9CA3AF' }}
          />
        </div>
      </div>

      {/* Cumulative (after all enabled interventions) bar */}
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-xxs text-mid-grey">After stack</span>
          <span className="text-caption tabular-nums font-semibold text-navy">
            {current != null ? `${current.toFixed(1)} ${unit}` : '—'}
          </span>
        </div>
        <div className="h-3 bg-light-grey/30 rounded">
          <div
            className="h-full rounded transition-all"
            style={{ width: `${currentPct}%`, backgroundColor: INTERVENTIONS_ACCENT }}
          />
        </div>
      </div>
    </div>
  )
}

export default function BeforeAfterBars({ stackResult }) {
  const baselineResult = stackResult?.baseline ?? null
  const cumulativeResult = findCumulativeResult(stackResult)

  const baselineEui    = pullEui(baselineResult)
  const cumulativeEui  = pullEui(cumulativeResult)
  const baselineCarbon = pullCarbon(baselineResult)
  const cumulativeCarbon = pullCarbon(cumulativeResult)

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div>
        <p className="text-caption font-semibold text-navy">Before vs after</p>
        <p className="text-xxs text-mid-grey italic mt-0.5">
          Cumulative impact of all enabled interventions, against the unedited baseline.
        </p>
      </div>
      <MetricBars
        label="Energy Use Intensity"
        unit="kWh/m²·yr"
        baseline={baselineEui}
        current={cumulativeEui}
      />
      <MetricBars
        label="Operational Carbon"
        unit="kgCO₂/m²·yr"
        baseline={baselineCarbon}
        current={cumulativeCarbon}
      />
    </div>
  )
}
