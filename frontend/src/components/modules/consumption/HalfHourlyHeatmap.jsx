/**
 * HalfHourlyHeatmap.jsx
 *
 * Carpet plot: time-of-day (Y axis, 0–47 slots) vs date (X axis, daily columns).
 * Cell colour intensity mapped to kWh — reveals operating hours, overnight baseload,
 * seasonal changes, and data gaps.
 *
 * Props:
 *   datasetId      — consumption dataset id
 *   projectId      — project id
 *   fuelType       — 'electricity' | 'gas'
 *   intervalMinutes — 30 or 60
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { RefreshCw } from 'lucide-react'

const CHUNK_DAYS = 90 // how many days to fetch at a time

export default function HalfHourlyHeatmap({
  datasetId,
  projectId,
  fuelType = 'electricity',
  intervalMinutes = 30,
}) {
  const [records,  setRecords]  = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const canvasRef = useRef(null)

  const isElec = fuelType === 'electricity'
  // Colour ramp: low = light, high = deep
  const baseHue = isElec ? 45 : 0  // amber for electricity, red for gas

  const slotsPerDay = Math.round(1440 / intervalMinutes)

  // ── Load records (full year, paginated in one fetch for now) ─────────────
  useEffect(() => {
    if (!datasetId) return
    setLoading(true)
    setError(null)
    fetch(`/api/projects/${projectId}/consumption/${datasetId}/records`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => setRecords(data.records ?? []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [datasetId, projectId])

  // ── Build heatmap matrix: { day -> slot -> kwh } ──────────────────────────
  const { matrix, days, maxKwh } = useMemo(() => {
    if (!records) return { matrix: {}, days: [], maxKwh: 0 }

    const map = {}
    let max = 0

    for (const rec of records) {
      if (!rec.timestamp) continue
      const day  = rec.timestamp.slice(0, 10)
      const [hh, mm] = rec.timestamp.slice(11, 16).split(':').map(Number)
      const slot = Math.floor((hh * 60 + mm) / intervalMinutes)
      if (!map[day]) map[day] = {}
      map[day][slot] = (rec.kwh ?? 0)
      if ((rec.kwh ?? 0) > max) max = rec.kwh ?? 0
    }

    const days = Object.keys(map).sort()
    return { matrix: map, days, maxKwh: max }
  }, [records, intervalMinutes])

  // ── Draw canvas ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current || !days.length) return
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')

    const cellW = Math.max(2, Math.floor(canvas.width  / days.length))
    const cellH = Math.max(2, Math.floor(canvas.height / slotsPerDay))

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    for (let di = 0; di < days.length; di++) {
      const day = days[di]
      for (let slot = 0; slot < slotsPerDay; slot++) {
        const kwh = matrix[day]?.[slot] ?? null
        if (kwh === null) {
          ctx.fillStyle = '#F1F5F9'  // light slate for missing
        } else {
          const t = maxKwh > 0 ? kwh / maxKwh : 0
          // Map t to lightness: 95% (low) → 20% (high)
          const lightness = Math.round(95 - t * 75)
          const saturation = Math.round(60 + t * 30)
          ctx.fillStyle = `hsl(${baseHue}, ${saturation}%, ${lightness}%)`
        }
        ctx.fillRect(di * cellW, slot * cellH, cellW, cellH)
      }
    }
  }, [days, matrix, maxKwh, slotsPerDay, baseHue])

  // ── Tooltip state ─────────────────────────────────────────────────────────
  const [tooltip, setTooltip] = useState(null)
  const containerRef = useRef(null)

  function onMouseMove(e) {
    if (!canvasRef.current || !days.length) return
    const rect    = canvasRef.current.getBoundingClientRect()
    const x       = e.clientX - rect.left
    const y       = e.clientY - rect.top
    const cellW   = rect.width  / days.length
    const cellH   = rect.height / slotsPerDay
    const di      = Math.min(Math.floor(x / cellW), days.length - 1)
    const slot    = Math.min(Math.floor(y / cellH), slotsPerDay - 1)
    const day     = days[di]
    const kwh     = matrix[day]?.[slot] ?? null
    const hour    = Math.floor(slot * intervalMinutes / 60)
    const min     = (slot * intervalMinutes) % 60
    const timeStr = `${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}`
    setTooltip({ day, timeStr, kwh, x: e.clientX - (containerRef.current?.getBoundingClientRect().left ?? 0), y: e.clientY - (containerRef.current?.getBoundingClientRect().top ?? 0) })
  }

  function onMouseLeave() { setTooltip(null) }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <RefreshCw size={14} className="text-mid-grey animate-spin" />
      </div>
    )
  }

  if (error) {
    return <p className="text-xxs text-red-500">Failed to load heatmap data: {error}</p>
  }

  if (!days.length) {
    return <p className="text-xxs text-mid-grey">No records available for heatmap.</p>
  }

  // Y-axis labels (every 4 hours)
  const yLabels = []
  for (let h = 0; h < 24; h += 4) {
    yLabels.push({ label: `${String(h).padStart(2,'0')}:00`, slot: Math.floor(h * 60 / intervalMinutes) })
  }

  // X-axis sample labels (every ~2 months)
  const xLabelInterval = Math.max(1, Math.floor(days.length / 6))
  const xLabels = days
    .map((d, i) => ({ day: d, idx: i }))
    .filter((_, i) => i % xLabelInterval === 0)

  const canvasH = slotsPerDay * 4  // 4px per slot
  const canvasW = Math.min(days.length * 3, 1200)  // max 1200px

  return (
    <div className="flex flex-col gap-3" ref={containerRef}>
      {/* Stats */}
      <div className="flex gap-4">
        <Stat label="Days"       value={days.length.toLocaleString()} />
        <Stat label="Peak slot"  value={`${maxKwh.toFixed(2)} kWh`} />
        <Stat label="Interval"   value={`${intervalMinutes} min`} />
        <Stat label="Time slots" value={slotsPerDay.toString()} />
      </div>

      {/* Heatmap + Y-axis wrapper */}
      <div className="bg-light-grey/15 rounded-lg p-3">
        <p className="text-xxs font-semibold text-mid-grey uppercase tracking-wide mb-2">
          Load heatmap — time of day vs date
        </p>
        <div className="flex gap-2">
          {/* Y-axis */}
          <div className="flex flex-col justify-between" style={{ height: canvasH }}>
            {yLabels.map(({ label }) => (
              <span key={label} className="text-xxs text-mid-grey leading-none">{label}</span>
            ))}
          </div>

          {/* Canvas */}
          <div className="flex-1 overflow-x-auto relative">
            <canvas
              ref={canvasRef}
              width={canvasW}
              height={canvasH}
              style={{ display: 'block', width: '100%', height: canvasH, imageRendering: 'pixelated', cursor: 'crosshair' }}
              onMouseMove={onMouseMove}
              onMouseLeave={onMouseLeave}
            />

            {/* X-axis */}
            <div className="flex mt-1" style={{ width: canvasW }}>
              {xLabels.map(({ day, idx }) => (
                <span
                  key={day}
                  className="text-xxs text-mid-grey"
                  style={{ position: 'absolute', left: `${(idx / days.length) * 100}%`, transform: 'translateX(-50%)' }}
                >
                  {day.slice(5)} {/* MM-DD */}
                </span>
              ))}
            </div>

            {/* Tooltip */}
            {tooltip && (
              <div
                className="pointer-events-none absolute z-20 bg-navy text-white text-xxs rounded px-2 py-1 shadow whitespace-nowrap"
                style={{ left: tooltip.x + 10, top: tooltip.y - 24 }}
              >
                {tooltip.day} {tooltip.timeStr} — {tooltip.kwh != null ? `${tooltip.kwh.toFixed(3)} kWh` : 'no data'}
              </div>
            )}
          </div>
        </div>

        {/* Colour legend */}
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xxs text-mid-grey">Low</span>
          <div
            className="flex-1 h-2 rounded"
            style={{
              background: `linear-gradient(to right, hsl(${baseHue},60%,95%), hsl(${baseHue},90%,20%))`,
            }}
          />
          <span className="text-xxs text-mid-grey">High ({maxKwh.toFixed(2)} kWh)</span>
          <span className="ml-2 w-4 h-2 rounded" style={{ backgroundColor: '#F1F5F9', border: '1px solid #E6E6E6', display: 'inline-block' }} />
          <span className="text-xxs text-mid-grey">Missing</span>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="flex flex-col">
      <span className="text-xxs text-mid-grey">{label}</span>
      <span className="text-xs font-semibold text-navy tabular-nums">{value}</span>
    </div>
  )
}
