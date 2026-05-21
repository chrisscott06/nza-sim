/**
 * EUIWaterfall.jsx — Brief 45 Part 3 (2026-05-21)
 *
 * Simple horizontal waterfall chart for the Comparison tab. Reads the
 * existing engine output (`consumption.interventions[]`) — no new
 * computation; reuses Brief 41 Part 2's marginal/cumulative delta shape.
 *
 * Layout:
 *
 *   Baseline                                      [██████████████████] 122.2
 *                                                      −63.1 ↓
 *   After "Fabric upgrade — south retrofit"       [████████          ]  59.1
 *                                                      −15.4 ↓
 *   After "Plant SCOP → 5.0"                      [█████             ]  43.7
 *                                                      +0.0
 *   New intervention (disabled — skipped)         [█████             ]  43.7
 *                                                      −2.1 ↓
 *   After "Demand control_factor → 0.5"           [████              ]  41.6
 *
 * Bars are right-aligned with a shared scale (longest = 100% bar width).
 * Marginal delta labels float between adjacent bars in muted text.
 * Disabled interventions render as muted/striped bars with "skipped" text.
 * Empty interventions (patches.length === 0) render as muted with "— no
 * patches" alongside the bar (the cumulative state at that point in the
 * stack stays the same as the previous row).
 *
 * Falsifiability:
 *   - Baseline EUI matches `stackResult.baseline.consumption.total.kwh_per_m2_yr`.
 *   - After-each-intervention EUI matches each row's
 *     `result.consumption.total.kwh_per_m2_yr` (or the parallel result
 *     fields used by ComparisonView's pullMetrics — same fallback list
 *     here for shape parity).
 *   - Marginal delta labels match `row.marginal_delta.eui_kwh_per_m2.delta`.
 *
 * Brief 45 Principle §4: no new calc. Data flows directly from the
 * engine; this component is presentation-only.
 */

const INTERVENTIONS_ACCENT = '#E84393'
const BAR_TRACK_BG = '#F3F4F6'   // light-grey/30-ish
const ACTIVE_BAR_BG = '#E84393'
const DISABLED_BAR_BG = '#9CA3AF'

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
  // Same fallback chain as ComparisonView.pullMetrics — keeps the two
  // surfaces reading from the same canonical engine fields.
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
  // computeDelta shape from interventionsEngine.js: row.marginal_delta.eui_kwh_per_m2 = { from, to, delta, delta_pct }.
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

function fmtDelta(v) {
  if (v == null || !Number.isFinite(v) || Math.abs(v) < 0.05) return '0.0'
  const sign = v < 0 ? '−' : '+'
  return `${sign}${Math.abs(v).toFixed(1)}`
}

export default function EUIWaterfall({ interventions = [], stackResult }) {
  if (!stackResult || !Array.isArray(stackResult.interventions)) {
    return (
      <div className="rounded-xl border border-dashed border-light-grey bg-off-white/30 p-4 text-xxs text-mid-grey">
        Waterfall renders after the engine produces an intervention stack. Add an intervention to see the cumulative EUI trajectory.
      </div>
    )
  }

  const baselineEui = pullEui(stackResult.baseline)
  const rows = stackResult.interventions

  // Bar data — one entry per stack position (baseline + each intervention row).
  // `cumEui` is the cumulative state at that row's result. For disabled rows
  // the engine returns the previous enabled state's result (audit doc §8.2),
  // so cumEui stays flat — and `marginal` is zero. Empty interventions
  // (patches.length === 0) also produce zero marginal but we surface that
  // distinctly in the row label.
  const bars = [
    {
      label: 'Baseline',
      sublabel: 'starting point',
      cumEui: baselineEui,
      marginal: null,     // no marginal for the baseline row
      enabled: true,
      isEmpty: false,
      isBaseline: true,
    },
    ...rows.map((row, i) => {
      const intervention = interventions[i] ?? null
      const isEnabled = row?.enabled !== false && intervention?.enabled !== false
      const patchCount = Array.isArray(intervention?.patches) ? intervention.patches.length : 0
      const isEmpty = patchCount === 0
      const cumEui = pullEui(row?.result)
      const marginal = pullMarginalDelta(row)
      const sublabel = !isEnabled
        ? 'disabled — skipped'
        : isEmpty
          ? 'no patches'
          : `${patchCount} ${patchCount === 1 ? 'patch' : 'patches'}`
      return {
        label: intervention?.label || `Intervention ${i + 1}`,
        sublabel,
        cumEui,
        marginal,
        enabled: isEnabled,
        isEmpty,
        isBaseline: false,
      }
    }),
  ]

  // Scale: longest absolute bar drives the width. If everything is null,
  // fall back to 1 so the divisor is safe.
  const maxAbs = Math.max(
    ...bars.map(b => (Number.isFinite(b.cumEui) ? Math.abs(b.cumEui) : 0)),
    1,
  )

  return (
    <div className="rounded-xl border border-light-grey bg-white p-4 space-y-1">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-caption font-semibold text-navy">EUI waterfall</p>
        <p className="text-xxs text-mid-grey">cumulative EUI after each enabled intervention · kWh/m²·yr</p>
      </div>

      <div className="space-y-2">
        {bars.map((b, i) => {
          const widthPct = Number.isFinite(b.cumEui)
            ? Math.max(2, Math.abs(b.cumEui) / maxAbs * 100)
            : 0
          const barColor = b.isBaseline
            ? DISABLED_BAR_BG
            : !b.enabled
              ? DISABLED_BAR_BG
              : b.isEmpty
                ? DISABLED_BAR_BG
                : ACTIVE_BAR_BG
          const muted = b.isBaseline || !b.enabled || b.isEmpty
          const prev = bars[i - 1]
          // Marginal label sits between the previous bar and this bar.
          // For the baseline row there's no marginal. For empty/disabled
          // rows we still show "0.0" so the user sees the no-effect
          // explicitly.
          const showMarginal = !b.isBaseline && prev && Number.isFinite(b.marginal)
          const marginalTone = !b.enabled || b.isEmpty
            ? 'text-mid-grey/50'
            : Number.isFinite(b.marginal) && Math.abs(b.marginal) >= 0.05
              ? (b.marginal < 0 ? 'text-green-600' : 'text-red-600')
              : 'text-mid-grey/60'

          return (
            <div key={i}>
              {/* Marginal label between previous bar and this one */}
              {showMarginal && (
                <div className="flex items-center gap-2 px-2 -mt-1.5 -mb-1.5">
                  <span className="w-44 flex-shrink-0" />
                  <span className={`text-xxs tabular-nums font-medium ${marginalTone}`}>
                    {fmtDelta(b.marginal)} kWh/m²
                  </span>
                  {Number.isFinite(b.marginal) && Math.abs(b.marginal) >= 0.05 && (
                    <span className={`text-xxs ${marginalTone}`}>{b.marginal < 0 ? '↓' : '↑'}</span>
                  )}
                </div>
              )}

              {/* Row: label + bar + value */}
              <div className="flex items-center gap-2 px-2">
                <div className="w-44 flex-shrink-0 min-w-0">
                  <p className={`text-xxs truncate ${muted ? 'text-mid-grey' : 'text-navy font-medium'}`} title={b.label}>
                    {b.label}
                  </p>
                  <p className="text-xxs text-mid-grey/60 truncate" title={b.sublabel}>
                    {b.sublabel}
                  </p>
                </div>
                <div
                  className="flex-1 h-4 rounded relative overflow-hidden"
                  style={{ backgroundColor: BAR_TRACK_BG }}
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded"
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: barColor,
                      opacity: muted ? 0.45 : 0.9,
                    }}
                  />
                </div>
                <div className="w-20 flex-shrink-0 text-right">
                  <span className={`text-caption tabular-nums ${muted ? 'text-mid-grey' : 'text-navy font-medium'}`}>
                    {fmtEui(b.cumEui)}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xxs text-mid-grey/70 leading-tight mt-3 pt-3 border-t border-light-grey/40">
        Each bar shows the cumulative EUI at that point in the stack. The label between two bars is the marginal contribution of the intervention applied in the lower row — green = saving, red = increase, grey = zero or skipped (disabled / empty). Reads directly from <span className="font-mono text-mid-grey">consumption.interventions[].marginal_delta</span> per Brief 41 Part 2.
      </p>
    </div>
  )
}
