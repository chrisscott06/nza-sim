/**
 * EUIWaterfall.jsx — Brief 47 Part 5b (2026-05-24)
 *
 * Stepped vertical waterfall — the standard Excel-style "Increase /
 * Decrease / Total" layout. Replaces the Brief 45 horizontal-bar
 * version per Chris's mid-walkthrough redesign request.
 *
 * Visual shape:
 *
 *   ┌──┐                                              ┌──┐
 *   │  │  Baseline                                    │  │  After
 *   │  │  (total)                                     │  │  stack
 *   │  │                                              │  │  (total)
 *   │  │     ┌──┐                                     │  │
 *   │  │     │  │ ↓                                   │  │
 *   │  │     └──┘     ┌──┐                            │  │
 *   │  │              │  │ ↓     ┌──┐                 │  │
 *   │  │              └──┘       │  │ ↑               │  │
 *   │  │                         └──┘                 │  │
 *   └──┘                                              └──┘
 *    │      │           │           │                   │
 *  Base  Fabric      Lighting    Plant              Cumulative
 *
 * Each intervention is a floating bar showing its marginal delta:
 *   - green (savings)  — bar drops from previous cumulative to new cumulative
 *   - red   (increase) — bar rises from previous cumulative to new cumulative
 *   - grey  (neutral)  — disabled / empty / zero
 * First + last columns are full grounded bars showing the absolute
 * baseline + final cumulative EUI.
 *
 * Reuses the same `interventions` + `stackResult` props the previous
 * version consumed — `pullEui` / `pullMarginalDelta` fallback lists
 * unchanged. No new computation, no new engine call. Brief 45
 * Principle §4: presentation-only.
 *
 * Rendered as SVG with a fixed column width and horizontal scroll when
 * the stack exceeds container width — keeps every column legible
 * regardless of intervention count.
 */

const COLORS = {
  total:    '#94A3B8',  // slate-400 — baseline + final
  savings:  '#16A34A',  // green-600 — reductions
  increase: '#DC2626',  // red-600   — increases
  neutral:  '#CBD5E1',  // slate-300 — disabled / empty / zero
  axis:     '#E5E7EB',  // grey-200  — gridlines
  axisText: '#6B7280',  // grey-500  — labels
  connector:'#94A3B8',  // dashed step connectors
}

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

function pullEui(result) {
  return pickFirst(result, [
    'consumption.total.kwh_per_m2_yr',
    'results.energy.kwh_per_m2_yr',
    'energy_use.totals.eui_kwh_per_m2',
    'eui_kwh_per_m2',
    'eui_kWh_per_m2',
    'eui_kWh_m2',
  ])
}

function pullMarginalDelta(row) {
  const rec = row?.marginal_delta?.eui_kwh_per_m2
  if (!rec || !Number.isFinite(rec.delta)) return null
  return rec.delta
}

function fmtEui(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 100) return v.toFixed(0)
  if (Math.abs(v) >= 10)  return v.toFixed(1)
  return v.toFixed(2)
}

function fmtDeltaSigned(v) {
  if (!Number.isFinite(v) || Math.abs(v) < 0.05) return '0.0'
  const sign = v < 0 ? '−' : '+'
  return `${sign}${Math.abs(v).toFixed(1)}`
}

/** Compute the series of bars + steps: baseline → per-intervention → final cumulative. */
function buildSeries(interventions, stackResult) {
  const baselineEui = pullEui(stackResult?.baseline)
  const rows = Array.isArray(stackResult?.interventions) ? stackResult.interventions : []
  const series = []
  series.push({
    kind: 'total',
    label: 'Baseline',
    value: baselineEui,
  })
  let running = baselineEui
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const intervention = interventions[i] ?? null
    const enabled = row?.enabled !== false && intervention?.enabled !== false
    const patchCount = Array.isArray(intervention?.patches) ? intervention.patches.length : 0
    const empty = patchCount === 0
    const delta = pullMarginalDelta(row) ?? 0
    const to = enabled && !empty ? (Number.isFinite(running + delta) ? running + delta : running) : running
    series.push({
      kind: 'step',
      label: intervention?.label || `Intervention ${i + 1}`,
      from: running,
      to,
      delta: enabled && !empty ? delta : 0,
      enabled,
      empty,
    })
    running = to
  }
  // Final cumulative (only if we have at least one step — otherwise the
  // single baseline column says it all).
  if (rows.length > 0) {
    series.push({
      kind: 'total',
      label: 'After stack',
      value: running,
    })
  }
  return series
}

/** Build a "nice" Y-axis with N tick marks. Returns { max, ticks: number[] }. */
function buildYAxis(rawMax) {
  if (!Number.isFinite(rawMax) || rawMax <= 0) return { max: 1, ticks: [0, 1] }
  // Round max up to a "nice" number — multiples of 10/20/25/50 etc.
  const magnitudes = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000]
  let max = rawMax
  for (const step of magnitudes) {
    if (rawMax / step <= 8) { max = Math.ceil(rawMax / step) * step; break }
  }
  // Build ticks every (max / 5) values
  const tickStep = max / 5
  const ticks = [0, tickStep, tickStep * 2, tickStep * 3, tickStep * 4, max]
  return { max, ticks }
}

export default function EUIWaterfall({ interventions = [], stackResult }) {
  if (!stackResult || !Array.isArray(stackResult.interventions)) {
    return (
      <div className="rounded-xl border border-dashed border-light-grey bg-off-white/30 p-4 text-xxs text-mid-grey">
        Waterfall renders after the engine produces an intervention stack. Add an intervention to see the cumulative EUI trajectory.
      </div>
    )
  }

  const series = buildSeries(interventions, stackResult)

  // Scale: max of all values + a 10% headroom so the tallest bar has
  // room for its label above.
  const rawMax = Math.max(
    1,
    ...series.flatMap(s =>
      s.kind === 'total' ? [Number.isFinite(s.value) ? s.value : 0]
                         : [Number.isFinite(s.from) ? s.from : 0, Number.isFinite(s.to) ? s.to : 0]
    ),
  )
  const { max: yMax, ticks } = buildYAxis(rawMax * 1.1)

  // SVG layout — fixed column width, horizontal scroll if many cols.
  const colW = 88
  const pad = { top: 30, right: 16, bottom: 56, left: 56 }
  const innerH = 280
  const totalH = innerH + pad.top + pad.bottom
  const totalW = pad.left + pad.right + Math.max(1, series.length) * colW
  const innerLeft = pad.left
  const innerBottom = pad.top + innerH
  const innerRight = innerLeft + series.length * colW

  const yScale = (v) => pad.top + innerH - (innerH * (v / yMax))

  const barWidth = Math.min(48, colW * 0.55)

  return (
    <div className="rounded-xl border border-light-grey bg-white p-4 space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-caption font-semibold text-navy">EUI waterfall</p>
        <p className="text-xxs text-mid-grey">marginal Δ per intervention · kWh/m²·yr</p>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-xxs text-mid-grey">
        <span className="inline-flex items-center gap-1.5"><span className="block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS.total }} />Total</span>
        <span className="inline-flex items-center gap-1.5"><span className="block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS.savings }} />Saving</span>
        <span className="inline-flex items-center gap-1.5"><span className="block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS.increase }} />Increase</span>
        <span className="inline-flex items-center gap-1.5"><span className="block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS.neutral }} />Disabled / no patches</span>
      </div>

      <div className="overflow-x-auto">
        <svg width={totalW} height={totalH} role="img" aria-label="EUI waterfall chart">
          {/* Y-axis gridlines + labels */}
          {ticks.map((t, i) => {
            const y = yScale(t)
            return (
              <g key={i}>
                <line x1={innerLeft} y1={y} x2={innerRight} y2={y} stroke={COLORS.axis} strokeWidth={1} />
                <text x={innerLeft - 6} y={y + 3} textAnchor="end" fontSize="10" fill={COLORS.axisText}>
                  {t.toFixed(0)}
                </text>
              </g>
            )
          })}
          {/* X-axis baseline */}
          <line x1={innerLeft} y1={innerBottom} x2={innerRight} y2={innerBottom} stroke={COLORS.axisText} strokeWidth={1} />

          {/* Step connectors (dashed) — draw before bars so bars overlay */}
          {series.map((s, i) => {
            if (i === 0) return null
            const prev = series[i - 1]
            const prevTop = prev.kind === 'total' ? prev.value : prev.to
            const x1 = innerLeft + (i - 1) * colW + colW / 2 + barWidth / 2
            const x2 = innerLeft + i * colW + colW / 2 - barWidth / 2
            const y  = yScale(prevTop)
            return (
              <line
                key={`conn-${i}`}
                x1={x1} y1={y} x2={x2} y2={y}
                stroke={COLORS.connector} strokeWidth={1} strokeDasharray="3 3" opacity={0.6}
              />
            )
          })}

          {/* Bars */}
          {series.map((s, i) => {
            const cx = innerLeft + i * colW + colW / 2
            const bx = cx - barWidth / 2

            if (s.kind === 'total') {
              const v = Number.isFinite(s.value) ? s.value : 0
              const y = yScale(v)
              const h = innerBottom - y
              return (
                <g key={i}>
                  <rect x={bx} y={y} width={barWidth} height={Math.max(0, h)} fill={COLORS.total} rx={2} />
                  <text x={cx} y={y - 6} textAnchor="middle" fontSize="11" fill="#1F2937" fontWeight="600">
                    {fmtEui(v)}
                  </text>
                  <text x={cx} y={innerBottom + 18} textAnchor="middle" fontSize="11" fill={COLORS.axisText} fontWeight="500">
                    {s.label}
                  </text>
                </g>
              )
            }

            // step — floating bar between from + to
            const enabled = s.enabled && !s.empty && Math.abs(s.delta) >= 0.05
            const from = Number.isFinite(s.from) ? s.from : 0
            const to   = Number.isFinite(s.to)   ? s.to   : from
            const top    = Math.max(from, to)
            const bottom = Math.min(from, to)
            const y = yScale(top)
            const h = Math.max(2, yScale(bottom) - y)   // min 2 px for visibility
            const fill = !enabled
              ? COLORS.neutral
              : s.delta < 0 ? COLORS.savings : COLORS.increase

            // Label above the bar (for non-zero) or beside (for zero/disabled)
            const deltaLabel = enabled ? fmtDeltaSigned(s.delta) : (s.empty ? '— no patches' : 'disabled')
            const labelY = y - 6
            return (
              <g key={i}>
                <rect x={bx} y={y} width={barWidth} height={h} fill={fill} rx={2} opacity={enabled ? 1 : 0.55} />
                <text
                  x={cx} y={labelY}
                  textAnchor="middle" fontSize="11"
                  fill={enabled ? (s.delta < 0 ? '#15803D' : '#B91C1C') : COLORS.axisText}
                  fontWeight="600"
                >
                  {deltaLabel}
                </text>
                {/* X-axis label — truncate if long via title fallback */}
                <text x={cx} y={innerBottom + 18} textAnchor="middle" fontSize="11" fill={COLORS.axisText}>
                  {s.label.length > 12 ? s.label.slice(0, 11) + '…' : s.label}
                  <title>{s.label}</title>
                </text>
                {/* Sub-label (running total at this point) */}
                <text x={cx} y={innerBottom + 32} textAnchor="middle" fontSize="9" fill={COLORS.axisText} opacity={0.7}>
                  → {fmtEui(s.to)}
                </text>
              </g>
            )
          })}

          {/* Y-axis label */}
          <text
            x={pad.left - 40} y={pad.top + innerH / 2}
            textAnchor="middle" fontSize="10" fill={COLORS.axisText}
            transform={`rotate(-90, ${pad.left - 40}, ${pad.top + innerH / 2})`}
          >
            kWh/m²·yr
          </text>
        </svg>
      </div>

      <p className="text-xxs text-mid-grey italic pt-1">
        Each floating bar is one intervention's marginal contribution to the running EUI. Anchor bars at the ends show the baseline and the cumulative state after the stack. Reads directly from <code className="text-xxs">consumption.interventions[].marginal_delta</code> per Brief 41 Part 2.
      </p>
    </div>
  )
}
