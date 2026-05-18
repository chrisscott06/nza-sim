/**
 * AnnualHeatmap.jsx — 8,760-hour carpet plot of an assembled v2.4 schedule.
 *
 * Brief 27 Revised Part 8. Shows the user the FINAL assembled pattern
 * (default schedule × monthly multipliers + exception periods) so they
 * can verify that exceptions land on the right dates and produce the
 * intended hourly shape.
 *
 * Layout:
 *   - Top row: exception markers (one strip per exception spanning its
 *     date range, in red-orange to signal "different from default")
 *   - Main carpet: 24 rows (hour of day, 0 at bottom, 23 at top) × 365
 *     columns (day of year, Jan 1 left, Dec 31 right). Cell colour
 *     interpolates from off-white (0) → accent (≥1).
 *   - Bottom row: month axis labels.
 *
 * Rendered via HTML5 Canvas (not SVG / div grid) because 8,760 cells
 * × React render cost is meaningful — Canvas paints in 5-10 ms vs
 * 200+ ms for an equivalent SVG tree, and a useEffect-driven redraw on
 * schedule-change keeps things tight.
 *
 * Clicking the canvas surfaces a "click anywhere to jump into edit
 * mode on that day's exception" affordance (deferred to a follow-up;
 * Part 8 just renders the visualisation + exception strips, no click-
 * to-edit yet).
 */

import { useRef, useEffect, useMemo, useState } from 'react'
import {
  decomposeHourForHeatmap,
  exceptionDayRanges,
  fractionForHour,
} from './exceptions.js'

const COLS = 365
const ROWS = 24
const CELL_W = 2.7   // px — yields ~985 px-wide carpet
const CELL_H = 9     // px — yields 216 px-tall carpet
const EXCEPTION_STRIP_H = 10  // px above the carpet
const MONTH_LABEL_H = 14      // px below the carpet

const MONTH_BOUNDARIES = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365]
const MONTH_LABELS     = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Mix two hex colours. t=0 returns hex1, t=1 returns hex2.
function mixHex(hex1, hex2, t) {
  const a = parseInt(hex1.slice(1), 16)
  const b = parseInt(hex2.slice(1), 16)
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `rgb(${r},${g},${bl})`
}

export default function AnnualHeatmap({ schedule, accent = '#8B5CF6', highlightExceptionId = null }) {
  const canvasRef = useRef(null)
  const [hover, setHover] = useState(null)  // { hour, frac, day, month, exception }

  // Precompute the 8,760 fractions once per schedule change. ~5 ms typical.
  const grid = useMemo(() => {
    const arr = new Float32Array(8760)
    const exc = new Array(8760).fill(null)
    if (!schedule) return { arr, exc }
    for (let h = 0; h < 8760; h++) {
      const r = fractionForHour(schedule, h)
      arr[h] = r.frac
      exc[h] = r.exception ? r.exception.id : null
    }
    return { arr, exc }
  }, [schedule])

  // Redraw the canvas when grid (schedule) or highlight changes.
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    const totalW = COLS * CELL_W
    const carpetH = ROWS * CELL_H
    const totalH = EXCEPTION_STRIP_H + carpetH + MONTH_LABEL_H
    cv.width  = totalW * dpr
    cv.height = totalH * dpr
    cv.style.width  = `${totalW}px`
    cv.style.height = `${totalH}px`
    const ctx = cv.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, totalW, totalH)

    // ── 1. Exception markers strip (top) ─────────────────────────────────
    if (schedule?.exceptions?.length) {
      const stripY = 0
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, stripY, totalW, EXCEPTION_STRIP_H)
      schedule.exceptions.forEach(exc => {
        const ranges = exceptionDayRanges(exc)
        const isHighlighted = highlightExceptionId === exc.id
        const fill = isHighlighted ? '#EA580C' : '#FB923C'
        const alpha = isHighlighted ? 0.95 : 0.5
        ctx.globalAlpha = alpha
        ctx.fillStyle = fill
        ranges.forEach(r => {
          const x0 = r.from * CELL_W
          const w  = (r.to - r.from + 1) * CELL_W
          ctx.fillRect(x0, stripY, Math.max(2, w), EXCEPTION_STRIP_H - 2)
        })
        ctx.globalAlpha = 1
      })
    }

    // ── 2. Carpet plot ──────────────────────────────────────────────────
    const carpetY = EXCEPTION_STRIP_H
    // Background
    ctx.fillStyle = '#F9F9F8'
    ctx.fillRect(0, carpetY, totalW, carpetH)

    for (let dayIdx = 0; dayIdx < COLS; dayIdx++) {
      for (let hr = 0; hr < ROWS; hr++) {
        const h = dayIdx * 24 + hr
        const v = Math.max(0, Math.min(1, grid.arr[h]))
        if (v < 0.005) continue  // skip near-zero cells (off-white background shows through)
        // Hour 0 at bottom of carpet, hour 23 at top.
        const y = carpetY + (23 - hr) * CELL_H
        const x = dayIdx * CELL_W
        ctx.fillStyle = mixHex('#F9F9F8', accent, v)
        ctx.fillRect(x, y, CELL_W + 0.5, CELL_H + 0.5)
      }
    }

    // Hour-of-day axis hints (faint horizontal lines at 06, 12, 18)
    ctx.fillStyle = 'rgba(0,0,0,0.06)'
    for (const hr of [6, 12, 18]) {
      const y = carpetY + (23 - hr) * CELL_H - 0.5
      ctx.fillRect(0, y, totalW, 1)
    }

    // Month boundary lines
    ctx.fillStyle = 'rgba(0,0,0,0.10)'
    for (let i = 1; i < MONTH_BOUNDARIES.length - 1; i++) {
      const x = MONTH_BOUNDARIES[i] * CELL_W - 0.5
      ctx.fillRect(x, carpetY, 1, carpetH)
    }

    // ── 3. Month labels (bottom) ────────────────────────────────────────
    const labelsY = carpetY + carpetH
    ctx.fillStyle = '#888888'
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
    ctx.textBaseline = 'top'
    for (let i = 0; i < 12; i++) {
      const mid = (MONTH_BOUNDARIES[i] + MONTH_BOUNDARIES[i + 1]) / 2
      ctx.fillText(MONTH_LABELS[i], mid * CELL_W - 8, labelsY + 1)
    }

    ctx.scale(1 / dpr, 1 / dpr)
  }, [grid, schedule, accent, highlightExceptionId])

  // Hover tooltip
  const onMove = (e) => {
    const cv = canvasRef.current
    if (!cv || !schedule) return
    const rect = cv.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const carpetY = EXCEPTION_STRIP_H
    if (y < carpetY || y > carpetY + ROWS * CELL_H) {
      setHover(null)
      return
    }
    const dayIdx = Math.floor(x / CELL_W)
    const hr     = 23 - Math.floor((y - carpetY) / CELL_H)
    if (dayIdx < 0 || dayIdx >= COLS || hr < 0 || hr > 23) {
      setHover(null)
      return
    }
    const h = dayIdx * 24 + hr
    const { month, day } = decomposeHourForHeatmap(h)
    const excId = grid.exc[h]
    const exception = excId
      ? schedule.exceptions?.find(e => e.id === excId)
      : null
    setHover({
      hour: hr,
      frac: grid.arr[h],
      day,
      month,
      exception,
      mouseX: x,
      mouseY: y,
    })
  }

  const visibleExceptions = schedule?.exceptions ?? []
  const totalCanvasW = COLS * CELL_W
  const totalCanvasH = EXCEPTION_STRIP_H + ROWS * CELL_H + MONTH_LABEL_H

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xxs uppercase tracking-wider text-mid-grey">Annual heatmap</h3>
        <div className="flex items-center gap-3 text-xxs text-mid-grey">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-2 rounded-sm bg-off-white border border-light-grey"></span>
            0
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: accent }}></span>
            1
          </span>
          {visibleExceptions.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: '#FB923C', opacity: 0.6 }}></span>
              exception
            </span>
          )}
        </div>
      </div>

      <div
        className="relative inline-block bg-white border border-light-grey rounded p-2"
        style={{ width: `${totalCanvasW + 16}px`, maxWidth: '100%' }}
      >
        <canvas
          ref={canvasRef}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          style={{ display: 'block', cursor: 'crosshair' }}
        />

        {/* Vertical hour-axis ticks (right side, just for reference) */}
        <div
          className="absolute pointer-events-none text-xxs text-mid-grey/70 tabular-nums"
          style={{ right: 4, top: 8 + EXCEPTION_STRIP_H, height: ROWS * CELL_H }}
        >
          <div style={{ position: 'absolute', top: 0 }}>23</div>
          <div style={{ position: 'absolute', top: (23 - 18) * CELL_H }}>18</div>
          <div style={{ position: 'absolute', top: (23 - 12) * CELL_H }}>12</div>
          <div style={{ position: 'absolute', top: (23 - 6) * CELL_H }}>06</div>
          <div style={{ position: 'absolute', top: (23 - 0) * CELL_H }}>00</div>
        </div>

        {/* Hover tooltip */}
        {hover && (
          <div
            className="pointer-events-none absolute z-10 px-2 py-1 text-xxs bg-navy text-white rounded shadow-lg whitespace-nowrap tabular-nums"
            style={{
              left:  Math.min(hover.mouseX + 12, totalCanvasW - 140),
              top:   Math.max(0, hover.mouseY - 36),
            }}
          >
            <div>
              {MONTH_LABELS[hover.month - 1]} {String(hover.day).padStart(2,'0')} ·{' '}
              {String(hover.hour).padStart(2,'0')}:00
            </div>
            <div className="text-white/80">
              fraction <strong className="text-white">{hover.frac.toFixed(2)}</strong>
              {hover.exception && (
                <span className="ml-1">
                  · in <em>{hover.exception.name}</em>
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Exception legend (rows below the heatmap, click to highlight) — Part 8 keeps this simple. */}
      {visibleExceptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xxs">
          {visibleExceptions.map(exc => {
            const isHi = exc.id === highlightExceptionId
            return (
              <span
                key={exc.id}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${
                  isHi ? 'border-orange-500 bg-orange-50' : 'border-light-grey bg-white'
                }`}
              >
                {exc.icon && <span>{exc.icon}</span>}
                <span className={isHi ? 'text-orange-700 font-medium' : 'text-mid-grey'}>
                  {exc.name}
                </span>
                <span className="text-mid-grey/70">
                  ({exc.start_date} → {exc.end_date})
                </span>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
