/**
 * FullYearView.jsx
 *
 * Full-year zoomable load profile view with brush navigation.
 * Fetches 8760-hour data from /api/simulate/{run_id}/hourly and shows
 * daily aggregates with a navigator brush that zooms to hourly when
 * the selected range is ≤ 13 days.
 */

import { useState, useEffect, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, Brush,
} from 'recharts'
import DataCard from '../../ui/DataCard.jsx'
import {
  TICK_STYLE, TOOLTIP_STYLE, TOOLTIP_WRAPPER_STYLE, LEGEND_STYLE,
  GRID_STYLE, AXIS_PROPS,
} from '../../../data/chartTokens.js'
import { Loader } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
const MONTH_NAMES  = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const ALL_SERIES = [
  { key: 'heating_kWh',   label: 'Heating',          color: '#DC2626', fuel: 'electricity' },
  { key: 'cooling_kWh',   label: 'Cooling',          color: '#3B82F6', fuel: 'electricity' },
  { key: 'lighting_kWh',  label: 'Lighting',         color: '#ECB01F', fuel: 'electricity' },
  { key: 'equipment_kWh', label: 'Equipment',        color: '#8B5CF6', fuel: 'electricity' },
  { key: 'dhw_kWh',       label: 'DHW',              color: '#F97316', fuel: 'gas'         },
  { key: 'fan_kWh',       label: 'Fans',             color: '#7C3AED', fuel: 'electricity' },
  { key: 'vent_loss_kWh', label: 'Ventilation loss', color: '#06B6D4', fuel: 'electricity' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function dayToLabel(d) {
  let m = 0
  for (let i = MONTH_STARTS.length - 1; i >= 0; i--) {
    if (d >= MONTH_STARTS[i]) { m = i; break }
  }
  const dom = d - MONTH_STARTS[m] + 1
  return `${dom} ${MONTH_NAMES[m]}`
}

function hourToLabel(d, h) {
  return `${dayToLabel(d)} ${String(h).padStart(2, '0')}:00`
}

/** Aggregate 8760-hour raw data into 365 daily totals. */
function buildDailyData(raw) {
  const days = []
  for (let d = 0; d < 365; d++) {
    const row = { day: d, label: dayToLabel(d) }
    for (const s of ALL_SERIES) {
      let sum = 0
      for (let h = 0; h < 24; h++) {
        sum += raw[s.key]?.[d * 24 + h] ?? 0
      }
      row[s.key] = +(sum.toFixed(2))
    }
    days.push(row)
  }
  return days
}

/** Extract hourly rows for a given day range from raw 8760 data. */
function buildHourlySlice(raw, startDay, endDay) {
  const rows = []
  for (let d = startDay; d <= Math.min(endDay, 364); d++) {
    for (let h = 0; h < 24; h++) {
      const i = d * 24 + h
      const row = { label: hourToLabel(d, h) }
      for (const s of ALL_SERIES) {
        row[s.key] = raw[s.key]?.[i] ?? 0
      }
      rows.push(row)
    }
  }
  return rows
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function CustomTooltipFY({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0)
  return (
    <div style={TOOLTIP_STYLE}>
      <p className="font-medium mb-1">{label}</p>
      {payload.map(p => (
        p.value > 0 && (
          <p key={p.dataKey} style={{ color: p.stroke }}>
            {p.name}: {p.value?.toFixed(2)} kWh
          </p>
        )
      ))}
      <p className="border-t border-light-grey mt-1 pt-1 font-medium text-navy">
        Total: {total.toFixed(2)} kWh
      </p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FullYearView({ results, fuelFilter }) {
  const [loading,    setLoading]    = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [rawData,    setRawData]    = useState(null)
  const [brushStart, setBrushStart] = useState(0)
  const [brushEnd,   setBrushEnd]   = useState(364)

  const runId = results?.run_id

  // Fetch full 8760-hour data whenever the run_id changes
  useEffect(() => {
    if (!runId) return
    setLoading(true)
    setFetchError(null)
    setRawData(null)
    setBrushStart(0)
    setBrushEnd(364)
    fetch(`/api/simulate/${runId}/hourly`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => setRawData(d))
      .catch(err => setFetchError(err.message))
      .finally(() => setLoading(false))
  }, [runId])

  const dailyData = useMemo(() => rawData ? buildDailyData(rawData) : [], [rawData])

  const visibleSeries = fuelFilter === 'all'
    ? ALL_SERIES
    : ALL_SERIES.filter(s => s.fuel === fuelFilter)

  const rangeSize = brushEnd - brushStart   // number of days
  const isHourly  = rangeSize <= 13

  // Detail chart data: hourly when zoomed in (≤13 days), daily slice otherwise
  const detailData = useMemo(() => {
    if (!rawData) return []
    if (isHourly) return buildHourlySlice(rawData, brushStart, brushEnd)
    return dailyData.slice(brushStart, brushEnd + 1)
  }, [rawData, dailyData, brushStart, brushEnd, isHourly])

  // Summary metrics for the selected range
  const { totalEnergy, peakDemand, avgDemand } = useMemo(() => {
    if (!detailData.length) return { totalEnergy: 0, peakDemand: 0, avgDemand: 0 }
    let total = 0, peak = 0
    for (const row of detailData) {
      const rowTotal = visibleSeries.reduce((s, ser) => s + (row[ser.key] ?? 0), 0)
      total += rowTotal
      if (rowTotal > peak) peak = rowTotal
    }
    return { totalEnergy: total, peakDemand: peak, avgDemand: total / detailData.length }
  }, [detailData, visibleSeries])

  const selectedLabel = `${dayToLabel(brushStart)} — ${dayToLabel(brushEnd)}`

  // X-axis interval for the detail chart
  const detailInterval = isHourly
    ? 23                                          // one label per day (every 24 hours)
    : Math.max(0, Math.floor(rangeSize / 7))     // ~7 ticks across the range

  // ── Render ──

  if (loading) return (
    <div className="flex items-center justify-center py-12 text-mid-grey gap-2">
      <Loader size={16} className="animate-spin" />
      <span className="text-caption">Loading full-year data…</span>
    </div>
  )

  if (fetchError) return (
    <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
      <p className="text-xxs text-red-600">
        <span className="font-medium">Could not load full-year data:</span> {fetchError}.
        {' '}Run a new simulation to generate hourly output files.
      </p>
    </div>
  )

  if (!rawData) return (
    <div className="bg-off-white border border-light-grey rounded-lg px-3 py-2">
      <p className="text-xxs text-mid-grey">No hourly data available. Run a simulation first.</p>
    </div>
  )

  return (
    <div className="space-y-3">

      {/* Selected range label + resolution badge */}
      <div className="flex items-center gap-3">
        <p className="text-caption text-navy font-medium">{selectedLabel}</p>
        <span className={`text-xxs px-2 py-0.5 rounded-full border ${
          isHourly
            ? 'bg-teal/10 border-teal/30 text-teal'
            : 'bg-off-white border-light-grey text-mid-grey'
        }`}>
          {isHourly ? 'Hourly detail' : `${rangeSize + 1} days — daily totals`}
        </span>
      </div>

      {/* Detail chart — zoomed view */}
      <div className="bg-white rounded-lg border border-light-grey p-3">
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={detailData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <defs>
              {ALL_SERIES.map(s => (
                <linearGradient key={s.key} id={`grad-fy-det-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={s.color} stopOpacity={0.5} />
                  <stop offset="95%" stopColor={s.color} stopOpacity={0.05} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid {...GRID_STYLE} vertical={false} />
            <XAxis
              dataKey="label"
              {...AXIS_PROPS}
              interval={detailInterval}
            />
            <YAxis
              {...AXIS_PROPS}
              label={{ value: 'kWh', angle: -90, position: 'insideLeft', offset: 8, style: { ...TICK_STYLE, fontSize: 8 } }}
            />
            <Tooltip content={<CustomTooltipFY />} wrapperStyle={TOOLTIP_WRAPPER_STYLE} />
            <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" iconSize={7} />
            {visibleSeries.map(s => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stackId="a"
                stroke={s.color}
                strokeWidth={1.5}
                fill={`url(#grad-fy-det-${s.key})`}
                dot={false}
                activeDot={{ r: 3 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Navigator chart — full year overview with Brush */}
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5">Full year — drag handles to zoom</p>
        <div className="bg-white rounded-lg border border-light-grey px-3 pt-2 pb-1">
          <ResponsiveContainer width="100%" height={90}>
            <AreaChart
              data={dailyData}
              margin={{ top: 2, right: 8, left: 0, bottom: 20 }}
            >
              <defs>
                {ALL_SERIES.map(s => (
                  <linearGradient key={s.key} id={`grad-fy-nav-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={s.color} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={s.color} stopOpacity={0.05} />
                  </linearGradient>
                ))}
              </defs>
              <XAxis
                dataKey="day"
                tickFormatter={d => MONTH_STARTS.includes(d) ? MONTH_NAMES[MONTH_STARTS.indexOf(d)] : ''}
                ticks={MONTH_STARTS}
                interval={0}
                tick={{ fontSize: 8, fill: '#9e9e9e' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide />
              {visibleSeries.map(s => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stackId="a"
                  stroke="none"
                  fill={`url(#grad-fy-nav-${s.key})`}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
              <Brush
                dataKey="day"
                startIndex={brushStart}
                endIndex={brushEnd}
                height={20}
                stroke="#00AEEF"
                fill="rgba(0,174,239,0.06)"
                travellerWidth={6}
                onChange={({ startIndex, endIndex }) => {
                  if (startIndex != null) setBrushStart(startIndex)
                  if (endIndex   != null) setBrushEnd(endIndex)
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Metrics for selected range */}
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Selected range metrics</p>
        <div className="grid grid-cols-3 gap-2">
          <DataCard
            label="Total energy"
            value={(totalEnergy / 1000).toFixed(1)}
            unit="MWh"
            accent="navy"
          />
          <DataCard
            label="Peak demand"
            value={peakDemand.toFixed(1)}
            unit="kWh/hr"
            accent="teal"
          />
          <DataCard
            label="Average demand"
            value={avgDemand.toFixed(1)}
            unit="kWh/hr"
            accent="gold"
          />
        </div>
      </div>

    </div>
  )
}
