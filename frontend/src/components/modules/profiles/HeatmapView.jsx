/**
 * HeatmapView.jsx
 *
 * Annual heatmap: X = month (Jan–Dec), Y = hour of day (0–23).
 * Cell colour intensity = schedule value × monthly multiplier.
 */

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const HOURS        = Array.from({ length: 24 }, (_, i) => i)

// Interpolate from white to the given hex colour
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return [r, g, b]
}

function interpolateColour(value, maxValue, accentHex = '#2B2A4C') {
  const [r2, g2, b2] = hexToRgb(accentHex)
  const t = maxValue > 0 ? Math.min(1, value / maxValue) : 0
  const r = Math.round(255 + (r2 - 255) * t)
  const g = Math.round(255 + (g2 - 255) * t)
  const b = Math.round(255 + (b2 - 255) * t)
  return `rgb(${r},${g},${b})`
}

export default function HeatmapView({ schedule, accentColour = '#2B2A4C' }) {
  if (!schedule) return null

  const cfg    = schedule.config_json ?? {}
  const days   = cfg.day_types ?? {}
  const months = cfg.monthly_multipliers ?? Array(12).fill(1)

  // Use weekday as the representative day type for the heatmap
  const weekday = days.weekday ?? days[Object.keys(days)[0]] ?? Array(24).fill(0)

  // Build grid: row = hour, col = month
  // cell value = weekday[hour] × months[month]
  const cells = HOURS.map(h =>
    MONTH_LABELS.map((_, m) => weekday[h] * (months[m] ?? 1))
  )

  const allValues = cells.flat()
  const maxValue  = Math.max(...allValues, 0.01)

  const CELL_W = 28
  const CELL_H = 14
  const LABEL_W = 28
  const HEADER_H = 20

  const totalWidth  = LABEL_W + MONTH_LABELS.length * CELL_W
  const totalHeight = HEADER_H + 24 * CELL_H

  return (
    <div>
      <p className="text-xxs uppercase tracking-wider text-mid-grey mb-3">Annual Pattern (Weekday)</p>
      <div className="overflow-x-auto">
        <svg
          width={totalWidth}
          height={totalHeight}
          style={{ display: 'block', maxWidth: '100%' }}
        >
          {/* Month header labels */}
          {MONTH_LABELS.map((m, mi) => (
            <text
              key={m}
              x={LABEL_W + mi * CELL_W + CELL_W / 2}
              y={14}
              textAnchor="middle"
              fontSize={9}
              fill="#95A5A6"
            >
              {m}
            </text>
          ))}

          {/* Hour rows */}
          {HOURS.map(h => (
            <g key={h}>
              {/* Hour label */}
              <text
                x={LABEL_W - 4}
                y={HEADER_H + h * CELL_H + CELL_H / 2 + 3}
                textAnchor="end"
                fontSize={8}
                fill="#95A5A6"
              >
                {String(h).padStart(2, '0')}
              </text>

              {/* Month cells */}
              {MONTH_LABELS.map((_, mi) => {
                const value = cells[h][mi]
                const fill  = interpolateColour(value, maxValue, accentColour)
                return (
                  <rect
                    key={mi}
                    x={LABEL_W + mi * CELL_W}
                    y={HEADER_H + h * CELL_H}
                    width={CELL_W - 1}
                    height={CELL_H - 1}
                    fill={fill}
                    rx={1}
                  >
                    <title>{`${MONTH_LABELS[mi]} ${String(h).padStart(2,'0')}:00 — ${value.toFixed(2)}`}</title>
                  </rect>
                )
              })}
            </g>
          ))}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-3">
        <span className="text-xxs text-mid-grey">Low</span>
        <svg width={120} height={10}>
          <defs>
            <linearGradient id="heatmap-legend" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"   stopColor="#ffffff" />
              <stop offset="100%" stopColor={accentColour} />
            </linearGradient>
          </defs>
          <rect x={0} y={0} width={120} height={10} fill="url(#heatmap-legend)" rx={3} />
        </svg>
        <span className="text-xxs text-mid-grey">High</span>
      </div>
    </div>
  )
}
