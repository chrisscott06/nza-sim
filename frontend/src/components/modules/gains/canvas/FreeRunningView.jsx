/**
 * FreeRunningView.jsx — annual zone-temperature trace, State 2 overlaid
 * on State 1 baseline.
 *
 * Brief 27 Revised Part 11. The free-running tab in the Internal Gains
 * module. Full-width per the v2.4 UI rule (annual time series carries
 * data horizontally).
 *
 * 8,760 hours rendered via HTML5 Canvas. State 1 trace (envelope alone,
 * the colder one) drawn in mid-grey; State 2 trace (with gains, the
 * warmer one) drawn in the gains-module accent. Comfort band shaded
 * behind both. Hover for hour-of-year + both temperatures.
 */

import { useRef, useEffect, useMemo, useState } from 'react'
import { useStateComparison } from './useStateComparison.js'
import { useContext } from 'react'
import { ProjectContext } from '../../../../context/ProjectContext.jsx'

const CANVAS_H = 240
const PADDING = { top: 14, right: 24, bottom: 24, left: 36 }

export default function FreeRunningView() {
  const { state1, state2, ready, libraryLoading } = useStateComparison()
  const { comfortBand } = useContext(ProjectContext)
  const canvasRef = useRef(null)
  const wrapRef   = useRef(null)
  const [hover, setHover] = useState(null)
  const [width, setWidth] = useState(0)

  // Measure container width
  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setWidth(e.contentRect.width)
    })
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  const s1Trace = state1?.free_running?.hourly_temperature_c
  const s2Trace = state2?.free_running?.hourly_temperature_c
  const bandLo  = comfortBand?.lower_c ?? 20
  const bandHi  = comfortBand?.upper_c ?? 26

  // Y-axis range — auto-fit to data with a 1°C margin.
  const yRange = useMemo(() => {
    if (!s1Trace || !s2Trace) return { min: 10, max: 30 }
    let min = Infinity, max = -Infinity
    for (let i = 0; i < s1Trace.length; i++) {
      if (s1Trace[i] < min) min = s1Trace[i]
      if (s1Trace[i] > max) max = s1Trace[i]
      if (s2Trace[i] < min) min = s2Trace[i]
      if (s2Trace[i] > max) max = s2Trace[i]
    }
    return { min: Math.floor(min - 1), max: Math.ceil(max + 1) }
  }, [s1Trace, s2Trace])

  // Redraw the canvas when data, width, or comfort band changes
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !width || !s1Trace || !s2Trace) return
    const dpr = window.devicePixelRatio || 1
    const w = width
    const h = CANVAS_H
    cv.width  = w * dpr
    cv.height = h * dpr
    cv.style.width  = `${w}px`
    cv.style.height = `${h}px`
    const ctx = cv.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    const plotW = w - PADDING.left - PADDING.right
    const plotH = h - PADDING.top  - PADDING.bottom
    const xFor = (i) => PADDING.left + (i / 8759) * plotW
    const yFor = (t) => PADDING.top + (1 - (t - yRange.min) / Math.max(1, yRange.max - yRange.min)) * plotH

    // Comfort band shading
    ctx.fillStyle = 'rgba(0, 174, 239, 0.06)'
    ctx.fillRect(PADDING.left, yFor(bandHi), plotW, yFor(bandLo) - yFor(bandHi))
    ctx.strokeStyle = 'rgba(0, 174, 239, 0.4)'
    ctx.lineWidth = 0.6
    ctx.beginPath(); ctx.moveTo(PADDING.left, yFor(bandLo)); ctx.lineTo(PADDING.left + plotW, yFor(bandLo)); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(PADDING.left, yFor(bandHi)); ctx.lineTo(PADDING.left + plotW, yFor(bandHi)); ctx.stroke()

    // Y-axis ticks
    ctx.fillStyle = '#888'
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'right'
    const tickStep = Math.ceil((yRange.max - yRange.min) / 5)
    for (let t = Math.ceil(yRange.min / tickStep) * tickStep; t <= yRange.max; t += tickStep) {
      const y = yFor(t)
      ctx.fillText(`${t}°C`, PADDING.left - 4, y)
      ctx.strokeStyle = 'rgba(0,0,0,0.05)'
      ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(PADDING.left, y); ctx.lineTo(PADDING.left + plotW, y); ctx.stroke()
    }

    // Month boundary verticals
    const monthDays = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365]
    ctx.strokeStyle = 'rgba(0,0,0,0.08)'
    ctx.lineWidth = 0.5
    for (let m = 1; m < 12; m++) {
      const x = xFor(monthDays[m] * 24)
      ctx.beginPath(); ctx.moveTo(x, PADDING.top); ctx.lineTo(x, PADDING.top + plotH); ctx.stroke()
    }

    // State 1 line — mid-grey
    ctx.strokeStyle = '#94A3B8'
    ctx.lineWidth = 0.7
    ctx.beginPath()
    for (let i = 0; i < s1Trace.length; i++) {
      const x = xFor(i)
      const y = yFor(s1Trace[i])
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // State 2 line — gains accent
    ctx.strokeStyle = '#EA580C'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    for (let i = 0; i < s2Trace.length; i++) {
      const x = xFor(i)
      const y = yFor(s2Trace[i])
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // X-axis month labels
    ctx.fillStyle = '#888'
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    for (let m = 0; m < 12; m++) {
      const mid = (monthDays[m] + monthDays[m + 1]) / 2
      ctx.fillText(monthLabels[m], xFor(mid * 24), PADDING.top + plotH + 4)
    }

    ctx.scale(1 / dpr, 1 / dpr)
  }, [s1Trace, s2Trace, width, yRange, bandLo, bandHi])

  // Hover handling
  const onMove = (e) => {
    if (!s1Trace || !s2Trace || !width) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const plotW = width - PADDING.left - PADDING.right
    if (x < PADDING.left || x > PADDING.left + plotW) { setHover(null); return }
    const t = (x - PADDING.left) / plotW
    const hourOfYear = Math.max(0, Math.min(8759, Math.round(t * 8759)))
    const dayOfYear  = Math.floor(hourOfYear / 24)
    const hourOfDay  = hourOfYear % 24
    const monthDays = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    let mIdx = 0
    while (mIdx < 11 && monthDays[mIdx + 1] <= dayOfYear) mIdx++
    const day = dayOfYear - monthDays[mIdx] + 1
    setHover({
      x,
      monthLabel: monthLabels[mIdx],
      day,
      hour: hourOfDay,
      s1: s1Trace[hourOfYear],
      s2: s2Trace[hourOfYear],
    })
  }

  if (!ready) {
    return (
      <div className="px-6 py-8">
        <p className="text-caption text-mid-grey">
          {libraryLoading ? 'Loading constructions library…' : 'Waiting for engine to compute zone temperatures.'}
        </p>
      </div>
    )
  }

  const s1fr = state1.free_running
  const s2fr = state2.free_running

  return (
    <div className="w-full px-6 py-5 space-y-4">
      {/* Title */}
      <div>
        <h2 className="text-base font-semibold text-navy">Free-running zone temperature</h2>
        <p className="text-xxs text-mid-grey mt-0.5">
          Annual hourly trace. <span className="text-mid-grey/80">Grey</span> = State 1
          (envelope only); <span style={{ color: '#EA580C' }} className="font-medium">orange</span> =
          State 2 (with gains). Comfort band shaded blue.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-light-grey rounded p-3">
          <div className="text-xxs uppercase tracking-wider text-mid-grey">Annual mean</div>
          <div className="text-h3 font-semibold text-navy mt-0.5 tabular-nums">{s2fr.annual_mean_c} °C</div>
          <div className="text-xxs text-mid-grey mt-0.5 tabular-nums">
            State 1: {s1fr.annual_mean_c}°C ·{' '}
            <span className={s2fr.annual_mean_c >= s1fr.annual_mean_c ? 'text-red-600' : 'text-green-600'}>
              {s2fr.annual_mean_c >= s1fr.annual_mean_c ? '+' : ''}{(s2fr.annual_mean_c - s1fr.annual_mean_c).toFixed(1)}°C from gains
            </span>
          </div>
        </div>
        <div className="bg-white border border-light-grey rounded p-3">
          <div className="text-xxs uppercase tracking-wider text-mid-grey">Winter min</div>
          <div className="text-h3 font-semibold text-navy mt-0.5 tabular-nums">{s2fr.winter_min_c} °C</div>
          <div className="text-xxs text-mid-grey mt-0.5 tabular-nums">
            State 1: {s1fr.winter_min_c}°C
          </div>
        </div>
        <div className="bg-white border border-light-grey rounded p-3">
          <div className="text-xxs uppercase tracking-wider text-mid-grey">Summer max</div>
          <div className="text-h3 font-semibold text-navy mt-0.5 tabular-nums">{s2fr.summer_max_c} °C</div>
          <div className="text-xxs text-mid-grey mt-0.5 tabular-nums">
            State 1: {s1fr.summer_max_c}°C
          </div>
        </div>
      </div>

      {/* The trace */}
      <div ref={wrapRef} className="bg-white border border-light-grey rounded p-3 relative">
        <canvas
          ref={canvasRef}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
        {hover && (
          <div
            className="pointer-events-none absolute z-10 px-2 py-1 text-xxs bg-navy text-white rounded shadow-lg tabular-nums whitespace-nowrap"
            style={{ left: Math.min(hover.x + 12, width - 180), top: 8 }}
          >
            <div>{hover.monthLabel} {String(hover.day).padStart(2, '0')} · {String(hover.hour).padStart(2, '0')}:00</div>
            <div className="text-white/80">
              State 1: {hover.s1?.toFixed(1)}°C ·{' '}
              <span style={{ color: '#FFB088' }}>State 2: {hover.s2?.toFixed(1)}°C</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
