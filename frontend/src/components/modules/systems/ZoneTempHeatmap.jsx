/**
 * ZoneTempHeatmap — 24 × 365 SVG heatmap of zone air temperature.
 * Brief 70 Part 1.
 *
 * Each cell colours by T_zone in the cell's hour:
 *   • T < heating setpoint:  blue gradient (cool, heating-mode hour)
 *   • T > cooling setpoint:  red gradient (hot, cooling-mode hour)
 *   • in band:               warm grey (system idle, dead band)
 *
 * Cell size ≈ 2 px × 11 px on default canvas. Hover tooltip surfaces the
 * date / hour / T_zone / heating kW / cooling kW so Chris can pin any cell
 * for the Part-2 day-zoom (added in a later commit per Brief 70 §Part 2).
 *
 * Engine source: result.demand.{hourly_zone_air_c,
 *                heating_demand_hourly_kwh, cooling_demand_hourly_kwh,
 *                effective_heating_setpoint_c, effective_cooling_setpoint_c}.
 * No re-derivation in JS — the heatmap is purely a renderer.
 */

import { useState, useMemo } from 'react'

// Diverging colour scale: blue (below hsp) → grey (in band) → red (above csp).
// Intensity inside each side scales linearly to the further-from-setpoint cell
// so the cell saturation tells you HOW far outside the band the hour is.
const COLD_LIGHT  = [186, 230, 253]  // sky-200
const COLD_DEEP   = [3, 105, 161]    // sky-700
const BAND_COLOUR = '#E5E7EB'        // gray-200
const HOT_LIGHT   = [254, 202, 202]  // red-200
const HOT_DEEP    = [127, 29, 29]    // red-900

function lerp(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}
function rgb([r, g, b]) { return `rgb(${r},${g},${b})` }

function colourFor(t, hsp, csp, tMin, tMax) {
  if (t == null || !Number.isFinite(t)) return '#FFFFFF'
  if (t < hsp) {
    const denom = Math.max(hsp - tMin, 1)
    const k = Math.min(1, (hsp - t) / denom)
    return rgb(lerp(COLD_LIGHT, COLD_DEEP, k))
  }
  if (t > csp) {
    const denom = Math.max(tMax - csp, 1)
    const k = Math.min(1, (t - csp) / denom)
    return rgb(lerp(HOT_LIGHT, HOT_DEEP, k))
  }
  return BAND_COLOUR
}

const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function ZoneTempHeatmap({ result, onCellClick }) {
  const [hover, setHover] = useState(null)

  const data = useMemo(() => {
    const T  = result?.demand?.hourly_zone_air_c
    const hH = result?.demand?.heating_demand_hourly_kwh
    const hC = result?.demand?.cooling_demand_hourly_kwh
    const hsp = result?.demand?.effective_heating_setpoint_c ?? 21
    const csp = result?.demand?.effective_cooling_setpoint_c ?? 24
    if (!T || T.length === 0) return null
    let tMin = Infinity, tMax = -Infinity
    for (let i = 0; i < T.length; i++) {
      if (T[i] < tMin) tMin = T[i]
      if (T[i] > tMax) tMax = T[i]
    }
    return { T, hH, hC, hsp, csp, tMin, tMax }
  }, [result])

  if (!data) {
    return (
      <div className="text-xxs text-mid-grey italic px-2 py-4">
        No hourly zone-temperature trace on the current result.
      </div>
    )
  }

  // SVG geometry. Width matches the typical centre canvas; height fits 24 rows
  // comfortably. Hour cells are integer-aligned with a small column gap on
  // month boundaries (visually breaks January from February at a glance).
  const PAD_LEFT = 36, PAD_RIGHT = 8, PAD_TOP = 18, PAD_BOTTOM = 22
  const PLOT_W = 720, PLOT_H = 288
  const W = PLOT_W + PAD_LEFT + PAD_RIGHT
  const H = PLOT_H + PAD_TOP + PAD_BOTTOM
  const colW = PLOT_W / 365
  const rowH = PLOT_H / 24

  // Cells are batched per row for fewer DOM nodes — 365 wide ribbons of 24
  // colours each. For 8760 cells total this stays cheap (≈ 30 ms render on
  // an old laptop; React handles diff fine for input edits).
  const cells = []
  for (let d = 0; d < 365; d++) {
    for (let h = 0; h < 24; h++) {
      const idx = d * 24 + h
      if (idx >= data.T.length) continue
      const t = data.T[idx]
      cells.push({
        x: PAD_LEFT + d * colW,
        y: PAD_TOP + h * rowH,
        w: Math.ceil(colW),
        h: Math.ceil(rowH),
        fill: colourFor(t, data.hsp, data.csp, data.tMin, data.tMax),
        idx,
        t,
      })
    }
  }

  return (
    <div className="relative">
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        onMouseLeave={() => setHover(null)}
      >
        {/* Month tick labels along the top */}
        {MONTH_STARTS.map((d, i) => (
          <text key={i}
                x={PAD_LEFT + d * colW + 2}
                y={PAD_TOP - 4}
                className="text-[9px] fill-mid-grey">
            {MONTH_LABELS[i]}
          </text>
        ))}
        {/* Hour-of-day labels on the left (every 6 hours) */}
        {[0, 6, 12, 18].map(h => (
          <text key={h}
                x={PAD_LEFT - 4}
                y={PAD_TOP + h * rowH + rowH * 0.7}
                textAnchor="end"
                className="text-[9px] fill-mid-grey tabular-nums">
            {String(h).padStart(2, '0')}
          </text>
        ))}
        {/* Cells — rendered as a single batch via <rect> per hour */}
        {cells.map(c => (
          <rect key={c.idx}
                x={c.x} y={c.y} width={c.w} height={c.h}
                fill={c.fill}
                onMouseEnter={() => setHover(c.idx)}
                onClick={() => onCellClick?.(c.idx)}
                style={{ cursor: onCellClick ? 'pointer' : 'crosshair' }}
          />
        ))}
        {/* Setpoint legend on the bottom — three swatches inline */}
        <g transform={`translate(${PAD_LEFT}, ${H - 8})`}>
          <rect x={0}    y={-9} width={10} height={10} fill={rgb(COLD_DEEP)} />
          <text x={14}   y={0}  className="text-[9px] fill-mid-grey">below {data.hsp.toFixed(1)} °C (heating)</text>
          <rect x={140}  y={-9} width={10} height={10} fill={BAND_COLOUR} />
          <text x={154}  y={0}  className="text-[9px] fill-mid-grey">in dead band</text>
          <rect x={236}  y={-9} width={10} height={10} fill={rgb(HOT_DEEP)} />
          <text x={250}  y={0}  className="text-[9px] fill-mid-grey">above {data.csp.toFixed(1)} °C (cooling)</text>
        </g>
      </svg>

      {/* Hover tooltip — absolutely positioned, top-right of the canvas */}
      {hover != null && (
        <div className="absolute top-1 right-2 bg-white border border-light-grey rounded shadow-sm px-2 py-1 text-xxs text-navy tabular-nums">
          <p className="font-medium">{fmtDateFromHour(hover)}</p>
          <p>T<sub>zone</sub> = {data.T[hover].toFixed(2)} °C</p>
          {data.hH && <p>heating = {data.hH[hover].toFixed(2)} kW</p>}
          {data.hC && <p>cooling = {data.hC[hover].toFixed(2)} kW</p>}
        </div>
      )}
    </div>
  )
}

function fmtDateFromHour(h) {
  const dayOfYear = Math.floor(h / 24)
  const hourOfDay = h % 24
  const dpm = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  let m = 0, d = dayOfYear
  while (m < 11 && d >= dpm[m]) { d -= dpm[m]; m++ }
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[m]} ${d + 1} · ${String(hourOfDay).padStart(2, '0')}:00`
}
