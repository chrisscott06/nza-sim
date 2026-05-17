/**
 * WeatherSynchronisedProfile.jsx
 *
 * Brief 28-IM Profiles upgrade — reusable component for the Building /
 * Operation / Systems Profiles tabs. Renders a vertically-stacked panel
 * of 4 charts sharing one x-axis (day of year) with a synchronised
 * crosshair on hover:
 *
 *   1. Primary load (kW)         — stacked area by category + optional
 *                                   line overlays (e.g. solar per facade)
 *   2. Outdoor dry-bulb temp (°C) — single line
 *   3. Wind speed (m/s)          — single line
 *   4. Global horizontal solar (W/m²) — single line
 *
 * All four charts share the same x-domain (day 1-365). Hovering anywhere
 * produces a tooltip showing the day index + values across all four
 * panes. Click to pin (not implemented in V1; queued).
 *
 * Inline SVG — no recharts dependency. Keeps the bundle light and gives
 * full control over the crosshair / synchronisation.
 *
 * Props:
 *   primary: {
 *     title:        'Heat loss at setpoint',
 *     unit:         'kW',
 *     stacks: [                 // stacked area, positive direction (downward = loss)
 *       { key, label, color, daily_kwh: number[365] },
 *       ...
 *     ],
 *     lines: [                  // optional line overlays (e.g. solar per facade)
 *       { key, label, color, daily_kwh: number[365], dashed?: boolean },
 *       ...
 *     ],
 *   }
 *   weather: {
 *     t_out_mean_c:   number[365],
 *     wind_mean_ms:   number[365],
 *     ghi_mean_w_per_m2: number[365],
 *   }
 *   height?: number (default 480) — total stack height in px
 *
 * Daily aggregation: caller passes daily-summed kWh per stack/line; the
 * component converts to mean kW (kWh/24) for display. Weather signals
 * are passed as means already (caller-side /24 — keeps the prop unit
 * sensible: °C / m/s / W/m²).
 */

import { useMemo, useState, useRef } from 'react'

const MONTH_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Brief 28-IM-Polish POL-M3 §7.1 — Profile zoom/pan presets.
//
// Range buttons drive a viewport [dayStart, dayEnd]; xs() is rescaled so
// the visible window stretches across the whole chart width. The brief's
// preferred interaction was a Recharts <Brush>, but this component is
// hand-rolled SVG, so the documented fallback ("Range preset buttons only,
// no drag-to-zoom") applies. A brush track at the bottom shows the
// viewport position within the full year for orientation.
const FULL_YEAR = [0, 364]
const QUARTER_RANGES = [
  { label: 'Q1', range: [0, 89] },
  { label: 'Q2', range: [90, 180] },
  { label: 'Q3', range: [181, 272] },
  { label: 'Q4', range: [273, 364] },
]
const MONTH_RANGES = MONTH_DAYS.map((startDay, i) => ({
  label: MONTH_LABELS[i],
  range: [startDay, i === 11 ? 364 : MONTH_DAYS[i + 1] - 1],
}))
function _dayToLabel(d) {
  // Convert day-of-year [0..364] → "DD MMM"
  let monthIdx = 0
  for (let i = 0; i < 12; i++) if (MONTH_DAYS[i] <= d) monthIdx = i
  const dayInMonth = d - MONTH_DAYS[monthIdx] + 1
  return `${dayInMonth} ${MONTH_LABELS[monthIdx]}`
}

function _z365() { return new Array(365).fill(0) }

// Daily kWh → daily mean kW (sum over 24 hours, divide by 24)
function _kwhToKw(arr) { return (arr ?? _z365()).map(v => v / 24) }

// Build SVG path string from points
function _linePath(values, xs, ys) {
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xs(i)} ${ys(v)}`).join(' ')
}

function _stackedAreaPaths(stacks, xs, ys) {
  // For each stack (in render order), build a polygon between the
  // cumulative baseline and the cumulative top. Positive direction = down
  // (heat loss). Baseline at y0 (= y(0)).
  const N = stacks[0]?.values?.length ?? 0
  if (N === 0) return []
  const cum = _z365()
  const paths = []
  for (const s of stacks) {
    const topVals = s.values.map((v, i) => cum[i] + (v ?? 0))
    // Polygon: top edge left→right, then bottom edge right→left
    const top = topVals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xs(i)} ${ys(v)}`).join(' ')
    const bot = cum.slice().reverse().map((v, i) => `L ${xs(N - 1 - i)} ${ys(v)}`).join(' ')
    paths.push({ key: s.key, label: s.label, color: s.color, d: top + ' ' + bot + ' Z', topVals })
    for (let i = 0; i < N; i++) cum[i] = topVals[i]
  }
  return paths
}

export default function WeatherSynchronisedProfile({ primary, weather, height = 480, caption }) {
  const [hoverDay, setHoverDay] = useState(null)
  // Brief 28-IM-Polish POL-M3 §7.1 — viewport state for zoom/pan.
  const [viewport, setViewport] = useState(FULL_YEAR)
  const [dayStart, dayEnd] = viewport
  const viewportSpan = Math.max(1, dayEnd - dayStart)  // guard divide-by-zero
  const isZoomed = viewport[0] !== 0 || viewport[1] !== 364
  const containerRef = useRef(null)

  // Pre-process all series into kW / kept-unit arrays
  const stacks = useMemo(() => (primary?.stacks ?? []).map(s => ({
    ...s, values: _kwhToKw(s.daily_kwh),
  })), [primary?.stacks])
  const lines  = useMemo(() => (primary?.lines ?? []).map(l => ({
    ...l, values: _kwhToKw(l.daily_kwh),
  })), [primary?.lines])
  const tOut = weather?.t_out_mean_c ?? _z365()
  const wind = weather?.wind_mean_ms ?? _z365()
  const ghi  = weather?.ghi_mean_w_per_m2 ?? _z365()

  // Layout constants
  // Brief 28-IM-Polish Bug 2.3 / 2.12: bumped padL 50 → 62 to leave room
  // for the y-axis tick number + unit label without overlap. Pane heights
  // rebalanced (Bug 2.12) so the primary kW pane is ~40% rather than
  // dominating; the three weather panes get equal share.
  // Brief POL-M3 §7.1: a 18px brush track now sits below the four panes
  // (between the month axis labels and the bottom of the SVG). padB stays
  // small because the month axis labels overlap with the brush track row.
  const W = 900
  const padL = 62
  const padR = 100  // room for line-overlay legend on right
  const padT = 22   // extra room at top of pane 1 for the unit label
  const padB = 22
  const BRUSH_H = 14
  const BRUSH_GAP = 6
  // Pane heights — primary slightly larger but not dominant
  const paneHeights = [0.40, 0.20, 0.20, 0.20]   // sum 1.0
  const paneGap = 8
  const usableH = height - padT - padB - paneGap * 3 - BRUSH_H - BRUSH_GAP
  const panes = paneHeights.map(h => Math.max(40, h * usableH))
  const paneYs = []
  let y = padT
  for (const h of panes) { paneYs.push(y); y += h + paneGap }
  const brushTop = y - paneGap + BRUSH_GAP   // just below the last pane

  // X axis: viewport day → padL..(W - padR)
  const xs = (i) => padL + ((i - dayStart) / viewportSpan) * (W - padL - padR)
  // Brush track uses the full year (always 0..364) regardless of zoom.
  const xs_full = (i) => padL + (i / 364) * (W - padL - padR)

  // Y axes per pane
  const primaryMax = (() => {
    let m = 0
    for (let i = 0; i < 365; i++) {
      let stackTop = 0
      for (const s of stacks) stackTop += (s.values[i] ?? 0)
      if (stackTop > m) m = stackTop
      for (const l of lines) { if ((l.values[i] ?? 0) > m) m = l.values[i] ?? 0 }
    }
    return m * 1.05 || 1
  })()
  const tMin = Math.min(-5, Math.floor(Math.min(...tOut) - 1))
  const tMax = Math.max(35, Math.ceil(Math.max(...tOut) + 1))
  const windMax = Math.max(8, Math.ceil(Math.max(...wind) + 1))
  const ghiMax  = Math.max(200, Math.ceil(Math.max(...ghi) + 50))

  const ysPrim = (v) => paneYs[0] + panes[0] - (v / primaryMax) * panes[0]
  const ysT    = (v) => paneYs[1] + panes[1] - ((v - tMin) / (tMax - tMin)) * panes[1]
  const ysW    = (v) => paneYs[2] + panes[2] - (v / windMax) * panes[2]
  const ysG    = (v) => paneYs[3] + panes[3] - (v / ghiMax)  * panes[3]

  const stackPaths = useMemo(() => _stackedAreaPaths(stacks, xs, ysPrim), [stacks, primaryMax])

  // Mouse-move handler: convert client X → day index inside viewport.
  // Brief POL-M3 §7.1: clamp to [dayStart, dayEnd] so the crosshair never
  // points at off-screen data when zoomed in.
  const onMove = (e) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const px = e.clientX - rect.left
    const svgW = rect.width
    const vbX = (px / svgW) * W
    const norm = (vbX - padL) / (W - padL - padR)
    if (norm < 0 || norm > 1) { setHoverDay(null); return }
    const d = Math.max(dayStart, Math.min(dayEnd, dayStart + Math.round(norm * viewportSpan)))
    setHoverDay(d)
  }
  const onLeave = () => setHoverDay(null)
  // Double-click anywhere in the chart resets zoom (brief §7.1).
  const onDoubleClick = () => setViewport(FULL_YEAR)

  // Tooltip data for hover day
  const tipData = hoverDay == null ? null : {
    day:    hoverDay + 1,
    stacks: stacks.map(s => ({ label: s.label, color: s.color, value: s.values[hoverDay] })),
    lines:  lines.map(l =>  ({ label: l.label, color: l.color, value: l.values[hoverDay] })),
    t_out:  tOut[hoverDay],
    wind:   wind[hoverDay],
    ghi:    ghi[hoverDay],
  }

  // Pane content needs to be clipped when the viewport zooms in so paths
  // computed from the full 365-point series don't bleed outside the chart.
  // Single clipPath covers all four panes' data area horizontally; vertical
  // extent is the full stack of panes (excluding the bottom brush track).
  const clipBottom = brushTop - BRUSH_GAP / 2
  const clipId = `profile-pane-clip-${stacks.length}-${lines.length}`

  return (
    <div className="w-full h-full overflow-auto p-4" ref={containerRef}>
      {primary?.title && (
        <p className="text-caption font-semibold text-navy">{primary.title} · {primary.unit}</p>
      )}
      {caption && <p className="text-xxs text-mid-grey mb-2">{caption}</p>}

      {/* Brief POL-M3 §7.1: range preset toolbar — Year · Q1-Q4 · Jan-Dec.
          Hand-rolled SVG component, so Recharts <Brush> is N/A; this is the
          documented fallback ("Range preset buttons only, no drag-to-zoom").
          Brush track inside the SVG shows viewport position; double-click
          on the chart resets. */}
      <div className="flex items-center gap-1 mb-2 text-xxs flex-wrap" style={{ maxWidth: 1100 }}>
        <button
          onClick={() => setViewport(FULL_YEAR)}
          className={`px-2 py-0.5 rounded border transition-colors ${
            !isZoomed
              ? 'bg-navy text-white border-navy'
              : 'bg-white text-mid-grey border-light-grey hover:border-navy hover:text-navy'
          }`}
        >Year</button>
        <span className="text-light-grey mx-1">·</span>
        {QUARTER_RANGES.map(q => {
          const active = viewport[0] === q.range[0] && viewport[1] === q.range[1]
          return (
            <button
              key={q.label}
              onClick={() => setViewport(q.range)}
              className={`px-1.5 py-0.5 rounded border transition-colors ${
                active
                  ? 'bg-navy text-white border-navy'
                  : 'bg-white text-mid-grey border-light-grey hover:border-navy hover:text-navy'
              }`}
            >{q.label}</button>
          )
        })}
        <span className="text-light-grey mx-1">·</span>
        {MONTH_RANGES.map(m => {
          const active = viewport[0] === m.range[0] && viewport[1] === m.range[1]
          return (
            <button
              key={m.label}
              onClick={() => setViewport(m.range)}
              className={`px-1.5 py-0.5 rounded border transition-colors ${
                active
                  ? 'bg-navy text-white border-navy'
                  : 'bg-white text-mid-grey border-light-grey hover:border-navy hover:text-navy'
              }`}
            >{m.label}</button>
          )
        })}
        <span className="ml-auto text-mid-grey tabular-nums">
          {_dayToLabel(dayStart)} – {_dayToLabel(dayEnd)}
          {isZoomed && <span className="ml-2 text-mid-grey/70">(double-click chart to reset)</span>}
        </span>
      </div>

      <div className="relative" style={{ width: '100%', maxWidth: 1100 }}>
        <svg
          viewBox={`0 0 ${W} ${height}`}
          className="w-full border border-light-grey rounded bg-white"
          onMouseMove={onMove}
          onMouseLeave={onLeave}
          onDoubleClick={onDoubleClick}
        >
          {/* Clip pane data to chart area so zoomed-in paths don't bleed
              into the y-axis label gutter or the brush track. */}
          <defs>
            <clipPath id={clipId}>
              <rect x={padL} y={padT - 2} width={W - padL - padR} height={clipBottom - padT + 2} />
            </clipPath>
          </defs>

          {/* Month tick marks across all panes — clip the vertical grid to
              the pane area, but float the month label above the brush
              track (brushTop - 3) so the labels stay readable. */}
          {MONTH_DAYS.map((d, i) => {
            const inView = d >= dayStart && d <= dayEnd
            if (!inView) return null
            return (
              <g key={`m${i}`}>
                <line x1={xs(d)} x2={xs(d)} y1={padT} y2={clipBottom} stroke="#F3F4F6" strokeWidth="0.5" />
                <text x={xs(d)} y={brushTop - 3} textAnchor="start" fontSize="9" fill="#9CA3AF">{MONTH_LABELS[i]}</text>
              </g>
            )
          })}

          {/* ── Pane 1: stacked area (heat loss) + line overlays (solar) ───
              Brief 28-IM-Polish Bug 2.3 / 2.12: unit label sits ABOVE the
              tick column (paneYs - 6) so max-value text at paneYs + 8 no
              longer overlaps it. */}
          <text x={padL - 6} y={paneYs[0] - 4} textAnchor="end" fontSize="9" fill="#475569" fontWeight="600">{primary?.unit ?? 'kW'}</text>
          <text x={padL - 6} y={paneYs[0] + panes[0] - 2} textAnchor="end" fontSize="9" fill="#9CA3AF">0</text>
          <text x={padL - 6} y={paneYs[0] + 10} textAnchor="end" fontSize="9" fill="#9CA3AF">{primaryMax.toFixed(0)}</text>
          {/* Y grid */}
          {[0.25, 0.5, 0.75].map(f => (
            <line key={f} x1={padL} x2={W - padR} y1={ysPrim(primaryMax * f)} y2={ysPrim(primaryMax * f)} stroke="#F3F4F6" strokeWidth="0.5" />
          ))}

          {/* All data-bearing geometry lives inside the clip so off-viewport
              days don't bleed past the chart edges. */}
          <g clipPath={`url(#${clipId})`}>
            {/* Stacked area paths */}
            {stackPaths.map(p => (
              <path key={p.key} d={p.d} fill={p.color} fillOpacity="0.7" stroke="none" />
            ))}
            {/* Line overlays */}
            {lines.map(l => (
              <path
                key={l.key}
                d={_linePath(l.values, xs, ysPrim)}
                fill="none"
                stroke={l.color}
                strokeWidth="1"
                strokeDasharray={l.dashed ? '3,2' : undefined}
              />
            ))}
            <path d={_linePath(Array.from(tOut), xs, ysT)} fill="none" stroke="#DC2626" strokeWidth="1.2" />
            <path d={_linePath(Array.from(wind), xs, ysW)} fill="none" stroke="#0891B2" strokeWidth="1.2" />
            <path d={_linePath(Array.from(ghi), xs, ysG)} fill="none" stroke="#F59E0B" strokeWidth="1.2" />
          </g>

          {/* ── Pane 2: outdoor temperature ─────────────────────────────── */}
          <text x={padL - 6} y={paneYs[1] - 4} textAnchor="end" fontSize="9" fill="#475569" fontWeight="600">°C</text>
          <text x={padL - 6} y={paneYs[1] + panes[1] - 2} textAnchor="end" fontSize="9" fill="#9CA3AF">{tMin}</text>
          <text x={padL - 6} y={paneYs[1] + 10} textAnchor="end" fontSize="9" fill="#9CA3AF">{tMax}</text>
          <line x1={padL} x2={W - padR} y1={ysT(0)} y2={ysT(0)} stroke="#E5E7EB" strokeWidth="0.5" />

          {/* ── Pane 3: wind ──────────────────────────────────────────── */}
          <text x={padL - 6} y={paneYs[2] - 4} textAnchor="end" fontSize="9" fill="#475569" fontWeight="600">m/s</text>
          <text x={padL - 6} y={paneYs[2] + panes[2] - 2} textAnchor="end" fontSize="9" fill="#9CA3AF">0</text>
          <text x={padL - 6} y={paneYs[2] + 10} textAnchor="end" fontSize="9" fill="#9CA3AF">{windMax}</text>

          {/* ── Pane 4: GHI ───────────────────────────────────────────── */}
          <text x={padL - 6} y={paneYs[3] - 4} textAnchor="end" fontSize="9" fill="#475569" fontWeight="600">W/m²</text>
          <text x={padL - 6} y={paneYs[3] + panes[3] - 2} textAnchor="end" fontSize="9" fill="#9CA3AF">0</text>
          <text x={padL - 6} y={paneYs[3] + 10} textAnchor="end" fontSize="9" fill="#9CA3AF">{ghiMax}</text>

          {/* ── Synchronised crosshair on hover ──────────────────────── */}
          {hoverDay != null && hoverDay >= dayStart && hoverDay <= dayEnd && (
            <g>
              <line x1={xs(hoverDay)} x2={xs(hoverDay)} y1={padT} y2={clipBottom} stroke="#0F172A" strokeOpacity="0.35" strokeWidth="0.8" strokeDasharray="2,2" />
              {/* Pane 1 dot for stacked-top */}
              {stackPaths.length > 0 && (
                <circle cx={xs(hoverDay)} cy={ysPrim(stackPaths[stackPaths.length - 1].topVals[hoverDay] ?? 0)} r="2.5" fill="#0F172A" />
              )}
              {/* Pane 2 dot */}
              <circle cx={xs(hoverDay)} cy={ysT(tOut[hoverDay] ?? 0)} r="2.5" fill="#DC2626" />
              {/* Pane 3 dot */}
              <circle cx={xs(hoverDay)} cy={ysW(wind[hoverDay] ?? 0)} r="2.5" fill="#0891B2" />
              {/* Pane 4 dot */}
              <circle cx={xs(hoverDay)} cy={ysG(ghi[hoverDay] ?? 0)} r="2.5" fill="#F59E0B" />
            </g>
          )}

          {/* ── Brush track (POL-M3 §7.1) ──────────────────────────────
              Full-year overview with the current viewport highlighted; no
              drag-to-resize in V1 (range buttons + double-click are the
              interaction model). Helps the user orient when zoomed in. */}
          <g>
            <rect x={padL} y={brushTop} width={W - padL - padR} height={BRUSH_H} fill="#F9FAFB" stroke="#E5E7EB" strokeWidth="0.5" />
            {MONTH_DAYS.map((d, i) => (
              <line key={`b${i}`} x1={xs_full(d)} x2={xs_full(d)} y1={brushTop} y2={brushTop + BRUSH_H / 2} stroke="#CBD5E1" strokeWidth="0.4" />
            ))}
            <rect
              x={xs_full(dayStart)} y={brushTop}
              width={Math.max(2, xs_full(dayEnd) - xs_full(dayStart))} height={BRUSH_H}
              fill="#0F172A" fillOpacity="0.18" stroke="#0F172A" strokeWidth="0.8"
            />
          </g>

          {/* Inline legend (top-right of pane 1) */}
          <g transform={`translate(${W - padR + 4}, ${paneYs[0]})`}>
            {stacks.map((s, i) => (
              <g key={`l-s-${s.key}`} transform={`translate(0, ${i * 12})`}>
                <rect x="0" y="0" width="8" height="8" fill={s.color} />
                <text x="11" y="7" fontSize="8" fill="#374151">{s.label}</text>
              </g>
            ))}
            {lines.map((l, i) => (
              <g key={`l-l-${l.key}`} transform={`translate(0, ${(stacks.length + i) * 12})`}>
                <line x1="0" x2="8" y1="4" y2="4" stroke={l.color} strokeWidth="1.2" strokeDasharray={l.dashed ? '3,2' : undefined} />
                <text x="11" y="7" fontSize="8" fill="#374151">{l.label}</text>
              </g>
            ))}
          </g>
        </svg>

        {/* Tooltip — pinned top-right under the legend */}
        {tipData && (
          <div className="absolute right-2 top-3 bg-white border border-light-grey rounded shadow-sm px-2 py-1.5 text-xxs pointer-events-none"
               style={{ minWidth: 180 }}>
            <p className="font-semibold text-navy mb-1">
              Day {tipData.day} · {MONTH_LABELS[(MONTH_DAYS.findIndex(d => d > tipData.day - 1) - 1 + 12) % 12]}{' '}
              {tipData.day - MONTH_DAYS[(MONTH_DAYS.findIndex(d => d > tipData.day - 1) - 1 + 12) % 12]}
            </p>
            {tipData.stacks.map(s => (
              <p key={s.label} className="flex justify-between gap-2">
                <span style={{ color: s.color }}>■</span>
                <span className="text-mid-grey flex-1">{s.label}</span>
                <span className="text-navy tabular-nums">{s.value?.toFixed(2)} {primary?.unit ?? 'kW'}</span>
              </p>
            ))}
            {tipData.lines.length > 0 && tipData.lines.some(l => (l.value ?? 0) > 0.01) && (
              <div className="border-t border-light-grey/60 my-1" />
            )}
            {tipData.lines.map(l => (l.value ?? 0) > 0.01 && (
              <p key={l.label} className="flex justify-between gap-2">
                <span style={{ color: l.color }}>━</span>
                <span className="text-mid-grey flex-1">{l.label}</span>
                <span className="text-navy tabular-nums">{l.value?.toFixed(2)}</span>
              </p>
            ))}
            <div className="border-t border-light-grey/60 my-1" />
            <p className="flex justify-between gap-2">
              <span className="text-mid-grey">T_out</span>
              <span className="text-navy tabular-nums">{tipData.t_out?.toFixed(1)} °C</span>
            </p>
            <p className="flex justify-between gap-2">
              <span className="text-mid-grey">Wind</span>
              <span className="text-navy tabular-nums">{tipData.wind?.toFixed(1)} m/s</span>
            </p>
            <p className="flex justify-between gap-2">
              <span className="text-mid-grey">GHI</span>
              <span className="text-navy tabular-nums">{Math.round(tipData.ghi)} W/m²</span>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
