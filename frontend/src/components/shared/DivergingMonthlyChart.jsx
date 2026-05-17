/**
 * DivergingMonthlyChart.jsx — Chris UX request (2026-05-17)
 *
 * Tornado / diverging-bars chart for monthly heat balance views. Month
 * labels sit on a fixed horizontal axis through the middle; gain stacks
 * grow UP from the axis (summer-peaked, e.g. solar transmission and
 * internal gains); loss stacks grow DOWN (winter-peaked, e.g. fabric
 * conduction + vents). Reads visually as two opposing curves intersecting
 * at the axis.
 *
 * Replaces the bottom-anchored stack pattern that lived in
 * BuildingMonthlyView + gains/canvas/MonthlyView + OperationMonthlyView.
 * Those layouts let the axis float (everything `justify-end`), which made
 * it hard to read summer-vs-winter shape.
 *
 * Props:
 *   gainsStacks:  [{ key, label, color, values: number[12] }]  (rendered top-to-bottom toward axis)
 *   lossesStacks: [{ key, label, color, values: number[12] }]  (rendered axis-to-bottom)
 *   months?:      string[12]  (defaults to Jan..Dec)
 *   height?:      number      (total px, default 320)
 *   unit?:        string      ('kWh', 'MWh', or 'kWh/m²·a')
 *   gia_m2?:      number      (optional — when set + unit === 'kWh/m²·a', values divided by gia)
 *
 * Bar scaling: maxBar = max across months of max(sum of gains, sum of losses).
 * Both halves use the same maxBar so the visual magnitude on either side is
 * comparable — the gain peak and loss peak share a scale.
 *
 * Per-column totals (sum of stacks at that month) are rendered above the
 * gain peak and below the loss peak, in tabular-nums for easy comparison
 * along the axis.
 */

const MONTHS_DEFAULT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function _fmt(v) {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1000) return (v / 1000).toFixed(1) + 'k'
  if (a >= 100)  return Math.round(v).toString()
  if (a >= 10)   return v.toFixed(0)
  return v.toFixed(1)
}

function _sumStacksAt(stacks, monthIdx) {
  let s = 0
  for (const st of stacks) s += (st.values?.[monthIdx] ?? 0)
  return s
}

export default function DivergingMonthlyChart({
  gainsStacks = [],
  lossesStacks = [],
  months = MONTHS_DEFAULT,
  height = 320,
  unit = 'kWh',
  gia_m2 = 0,
}) {
  // Convert to display unit (intensity is /m² — only when caller asked).
  const conv = (v) => unit === 'kWh/m²·a' && gia_m2 > 0 ? v / gia_m2 : v
  const G = gainsStacks.map(s => ({ ...s, values: (s.values ?? new Array(12).fill(0)).map(conv) }))
  const L = lossesStacks.map(s => ({ ...s, values: (s.values ?? new Array(12).fill(0)).map(conv) }))

  // Per-month totals for the labels above the gain peak + below the loss peak.
  const gainsTotalByMonth  = months.map((_, i) => _sumStacksAt(G, i))
  const lossesTotalByMonth = months.map((_, i) => _sumStacksAt(L, i))

  // Same maxBar drives both halves so the two sides are visually
  // comparable. If one side has no values, the other still gets the
  // full half height.
  const maxBar = Math.max(
    ...gainsTotalByMonth,
    ...lossesTotalByMonth,
    0.001,
  )

  // Layout constants
  const LABEL_ROW_PX     = 18
  const NUMBER_LINE_PX   = 12   // numeric total above the gain peak / below the loss peak
  const halfPx = Math.max(40, (height - LABEL_ROW_PX) / 2 - NUMBER_LINE_PX)

  return (
    <div className="w-full" style={{ minHeight: height }}>
      <div className="flex gap-2 items-stretch" style={{ height }}>
        {months.map((m, i) => {
          const gainsSum  = gainsTotalByMonth[i]
          const lossesSum = lossesTotalByMonth[i]
          const gainsHRatio  = gainsSum  / maxBar
          const lossesHRatio = lossesSum / maxBar

          return (
            <div key={m} className="flex-1 flex flex-col items-stretch">
              {/* Numeric total above gain peak */}
              <div className="text-xxs text-mid-grey/80 tabular-nums text-center" style={{ height: NUMBER_LINE_PX, lineHeight: `${NUMBER_LINE_PX}px` }}>
                {gainsSum > 0.5 ? _fmt(gainsSum) : ''}
              </div>

              {/* Upper half (gains) — children align toward axis (bottom).
                  Render stacks bottom-up (so first stack sits ON the axis,
                  last stack at the top of the peak). flex-col-reverse keeps
                  the source order matching visual order from axis upward. */}
              <div className="flex flex-col-reverse" style={{ height: halfPx }}>
                {G.map(stack => {
                  const v = stack.values[i] ?? 0
                  if (v < 0.001) return null
                  const hPx = (v / maxBar) * halfPx
                  return (
                    <div
                      key={stack.key}
                      className="w-full"
                      style={{ height: `${hPx}px`, backgroundColor: stack.color, opacity: 0.85 }}
                      title={`${stack.label}: ${_fmt(v)} ${unit} in ${m}`}
                    />
                  )
                })}
              </div>

              {/* Axis row — month label, fixed Y across all columns */}
              <div
                className="text-xxs text-navy font-medium text-center border-t border-b border-navy/30 bg-off-white/60"
                style={{ height: LABEL_ROW_PX, lineHeight: `${LABEL_ROW_PX}px` }}
              >
                {m}
              </div>

              {/* Lower half (losses) — children align toward axis (top).
                  Default flex-col with items-stretch so first stack sits ON
                  the axis, subsequent stacks below. */}
              <div className="flex flex-col" style={{ height: halfPx }}>
                {L.map(stack => {
                  const v = stack.values[i] ?? 0
                  if (v < 0.001) return null
                  const hPx = (v / maxBar) * halfPx
                  return (
                    <div
                      key={stack.key}
                      className="w-full"
                      style={{ height: `${hPx}px`, backgroundColor: stack.color, opacity: 0.85 }}
                      title={`${stack.label}: ${_fmt(v)} ${unit} in ${m}`}
                    />
                  )
                })}
              </div>

              {/* Numeric total below loss peak */}
              <div className="text-xxs text-mid-grey/80 tabular-nums text-center" style={{ height: NUMBER_LINE_PX, lineHeight: `${NUMBER_LINE_PX}px` }}>
                {lossesSum > 0.5 ? _fmt(lossesSum) : ''}
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend — gains on left, losses on right, axis label in middle */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xxs text-mid-grey">
        {G.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-mid-grey/70 italic">Gains ↑</span>
            {G.map(s => (
              <div key={s.key} className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.color, opacity: 0.85 }} />
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        )}
        {L.length > 0 && (
          <div className="flex items-center gap-3 ml-auto">
            <span className="text-mid-grey/70 italic">Losses ↓</span>
            {L.map(s => (
              <div key={s.key} className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.color, opacity: 0.85 }} />
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
