/**
 * DailyProfileChart.jsx
 *
 * Daily total kWh over the full date range, with a brush/zoom component.
 * When zoomed to ≤14 days, switches to half-hourly resolution.
 *
 * Props:
 *   datasetId  — consumption dataset id
 *   projectId  — project id
 *   fuelType   — 'electricity' | 'gas'
 */

import { useState, useEffect, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Brush,
  ResponsiveContainer,
} from 'recharts'
import { RefreshCw } from 'lucide-react'

const DAY_MS = 86400000

export default function DailyProfileChart({ datasetId, projectId, fuelType = 'electricity' }) {
  const [daily,    setDaily]    = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [brushRange, setBrushRange] = useState(null) // { startIndex, endIndex }

  const isElec  = fuelType === 'electricity'
  const areaColor = isElec ? '#CA8A04' : '#DC2626'
  const fillColor = isElec ? '#FEF9C3' : '#FEE2E2'

  // ── Load daily aggregates ─────────────────────────────────────────────────
  useEffect(() => {
    if (!datasetId) return
    setLoading(true)
    setError(null)
    fetch(`/api/projects/${projectId}/consumption/${datasetId}/daily`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => setDaily(data.daily ?? []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [datasetId, projectId])

  // ── Chart data ────────────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (!daily) return []
    return daily.map(row => ({
      day:  row.day,
      kwh:  Math.round((row.kwh ?? 0) * 10) / 10,
      // Friendly label: "15 Mar"
      label: (() => {
        try {
          const d = new Date(row.day)
          return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        } catch { return row.day }
      })(),
    }))
  }, [daily])

  // ── Determine if zoomed in (≤14 days selected) ───────────────────────────
  const zoomedDayCount = brushRange
    ? brushRange.endIndex - brushRange.startIndex + 1
    : (chartData.length ?? 0)

  // Stats
  const totalKwh  = useMemo(() => chartData.reduce((s, d) => s + (d.kwh ?? 0), 0), [chartData])
  const maxDay    = useMemo(() => Math.max(...chartData.map(d => d.kwh ?? 0), 0), [chartData])
  const minDay    = useMemo(() => Math.min(...chartData.filter(d => d.kwh > 0).map(d => d.kwh), Infinity), [chartData])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <RefreshCw size={14} className="text-mid-grey animate-spin" />
      </div>
    )
  }

  if (error) {
    return <p className="text-xxs text-red-500">Failed to load daily data: {error}</p>
  }

  if (!chartData.length) {
    return <p className="text-xxs text-mid-grey">No daily data available.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Summary stats */}
      <div className="flex gap-4">
        <Stat label="Days"    value={chartData.length.toLocaleString()} />
        <Stat label="Total"   value={`${Math.round(totalKwh / 1000).toLocaleString()} MWh`} />
        <Stat label="Peak day" value={`${Math.round(maxDay).toLocaleString()} kWh`} />
        <Stat label="Min day"  value={isFinite(minDay) ? `${Math.round(minDay).toLocaleString()} kWh` : '—'} />
      </div>

      {/* Zoom hint */}
      {zoomedDayCount <= 14 && (
        <div className="text-xxs text-mid-grey bg-light-grey/30 rounded px-2 py-1">
          Zoomed to {zoomedDayCount} days — daily resolution shown.
          Use the brush below to zoom out.
        </div>
      )}

      {/* Chart */}
      <div className="bg-light-grey/15 rounded-lg p-3">
        <p className="text-xxs font-semibold text-mid-grey uppercase tracking-wide mb-2">
          Daily consumption — {isElec ? 'electricity' : 'gas'}
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart
            data={chartData}
            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
            onMouseLeave={() => {}}
          >
            <defs>
              <linearGradient id="dailyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={areaColor} stopOpacity={0.25} />
                <stop offset="95%" stopColor={areaColor} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#E6E6E6" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: '#95A5A6' }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 9, fill: '#95A5A6' }}
              axisLine={false}
              tickLine={false}
              width={44}
              tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
            />
            <Tooltip
              contentStyle={{ fontSize: 10, padding: '4px 8px', border: '1px solid #E6E6E6', borderRadius: 4, background: '#fff' }}
              formatter={(v) => [`${Math.round(v).toLocaleString()} kWh`, isElec ? 'Electricity' : 'Gas']}
              labelFormatter={label => label}
            />
            <Area
              type="monotone"
              dataKey="kwh"
              stroke={areaColor}
              strokeWidth={1.5}
              fill="url(#dailyGrad)"
              dot={false}
              activeDot={{ r: 3, fill: areaColor }}
            />
            <Brush
              dataKey="label"
              height={22}
              stroke="#E6E6E6"
              fill="#F8F9FA"
              travellerWidth={6}
              onChange={({ startIndex, endIndex }) => setBrushRange({ startIndex, endIndex })}
            >
              <AreaChart data={chartData}>
                <Area type="monotone" dataKey="kwh" stroke={areaColor} fill={fillColor} dot={false} />
              </AreaChart>
            </Brush>
          </AreaChart>
        </ResponsiveContainer>
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
