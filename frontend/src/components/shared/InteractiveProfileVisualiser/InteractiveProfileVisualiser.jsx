/**
 * InteractiveProfileVisualiser.jsx — Brief 44 Part 3 (2026-05-21)
 *
 * Shared time-profile chart used across Systems / Building / Internal Gains /
 * Operation modules. Simple by default, layered by choice.
 *
 * Design principles (Brief 44 §3, Principle 3 + Notion design note):
 *   - DEFAULT VIEW: one signal only (the most informative layer for the
 *     module). Year axis. Clean.
 *   - LAYERED BY CHOICE: the user opts into additional layers via
 *     checkboxes with colour swatches. No layer is forced on.
 *   - CHART MODE TOGGLE: single line (default), stacked area, small
 *     multiples.
 *   - WEATHER OVERLAY: off by default. Three independent toggles
 *     (outdoor temp, wind, solar). Rendered as a thin trace beneath
 *     the primary chart — never crammed onto the same axis.
 *   - TIME-AXIS TOGGLE: Year / Quarter / Month / Day. Smooth rescale.
 *   - DAY SCRUBBER: hover/drag to read values at any hour when viewing
 *     a single day.
 *   - REACTIVITY: re-renders within the same render cycle as upstream
 *     edits because data layers come in as props.
 *
 * Component API
 *   <InteractiveProfileVisualiser
 *     layers={[
 *       { id: 'electricity', label: 'Electricity (kW)', colour: '#ECB01F',
 *         daily_kwh: [365 numbers] }, ...
 *     ]}
 *     weather={{ t_out_c: [365], wind_ms: [365], ghi_w_per_m2: [365] }}
 *     defaultLayerIds={['electricity']}
 *     defaultMode="single_line"        // 'single_line' | 'stacked_area' | 'small_multiples'
 *     module="systems"                 // free-form label, used in titles
 *     caption?: string                 // optional descriptive caption beneath
 *   />
 *
 * Data shape contract
 *   Each layer provides `daily_kwh` — an array of 365 daily totals (kWh).
 *   The component converts to average kW per day by dividing by 24.
 *   Future extension: optional `hourly_kw` arrays of 8760 — when present,
 *   the Day view uses them; when absent, the day view shows the day's
 *   daily-average flat line (V1 acceptable per Brief 38 §V1 spec).
 *
 *   Weather arrays are at daily resolution (365 numbers). t_out_c is daily
 *   mean °C; wind_ms is daily mean m/s; ghi_w_per_m2 is daily mean W/m².
 */

import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, ComposedChart, LineChart, AreaChart,
  Line, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'

// Non-leap year day-of-year → date label
const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_START_DAY = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]   // non-leap cum days
const MONTH_END_DAY   = [30, 58, 89, 119, 150, 180, 211, 242, 272, 303, 333, 364]

function dayOfYearToMonthDay(doy) {
  let m = 0
  while (m < 11 && MONTH_START_DAY[m + 1] <= doy) m++
  const d = doy - MONTH_START_DAY[m] + 1
  return { month: m, day: d, label: `${MONTH_NAMES_SHORT[m]} ${d}` }
}

const QUARTERS = [
  { id: 'Q1', label: 'Q1 (Jan–Mar)', startDoy: 0,   endDoy: 89  },
  { id: 'Q2', label: 'Q2 (Apr–Jun)', startDoy: 90,  endDoy: 180 },
  { id: 'Q3', label: 'Q3 (Jul–Sep)', startDoy: 181, endDoy: 272 },
  { id: 'Q4', label: 'Q4 (Oct–Dec)', startDoy: 273, endDoy: 364 },
]

const WEATHER_LAYERS = [
  { id: 'temp',  label: 'Outdoor temp (°C)',   colour: '#6B7280', dataKey: 't_out_c' },
  { id: 'wind',  label: 'Wind speed (m/s)',    colour: '#38BDF8', dataKey: 'wind_ms' },
  { id: 'solar', label: 'Solar GHI (W/m²)',    colour: '#F59E0B', dataKey: 'ghi_w_per_m2' },
]

// ── Helpers ─────────────────────────────────────────────────────────────

function kwhPerDayToKwAvg(arr) {
  if (!Array.isArray(arr)) return []
  return arr.map(v => (v ?? 0) / 24)
}

function fmt(v, opts = {}) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Number(v)
  if (opts.fixed != null) return n.toFixed(opts.fixed)
  if (Math.abs(n) >= 100) return n.toFixed(0)
  if (Math.abs(n) >= 10)  return n.toFixed(1)
  if (Math.abs(n) >= 1)   return n.toFixed(2)
  return n.toFixed(3)
}

function ToggleChip({ label, swatch, active, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xxs transition-colors ${
        active
          ? 'border-navy bg-navy/5 text-navy'
          : 'border-light-grey bg-white text-mid-grey hover:border-mid-grey'
      }`}
    >
      {swatch && (
        <span
          className="block w-2.5 h-2.5 rounded-sm flex-shrink-0"
          style={{ backgroundColor: swatch, opacity: active ? 1 : 0.4 }}
        />
      )}
      <span>{label}</span>
    </button>
  )
}

function ModePicker({ value, onChange, modes }) {
  const labels = { single_line: 'Single line', stacked_area: 'Stacked area', small_multiples: 'Small multiples' }
  return (
    <div className="inline-flex rounded-md border border-light-grey overflow-hidden">
      {modes.map(m => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`px-2 py-1 text-xxs transition-colors ${
            value === m ? 'bg-navy text-white' : 'bg-white text-mid-grey hover:bg-off-white'
          }`}
        >
          {labels[m] ?? m}
        </button>
      ))}
    </div>
  )
}

function TimeAxisPicker({ axis, onAxisChange, quarter, onQuarterChange, month, onMonthChange, day, onDayChange }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {['year', 'quarter', 'month', 'day'].map(a => (
        <button
          key={a}
          type="button"
          onClick={() => onAxisChange(a)}
          className={`px-2 py-0.5 text-xxs rounded transition-colors ${
            axis === a ? 'bg-navy text-white' : 'bg-white text-mid-grey hover:bg-off-white border border-light-grey'
          }`}
        >
          {a[0].toUpperCase() + a.slice(1)}
        </button>
      ))}
      {axis === 'quarter' && (
        <select
          value={quarter}
          onChange={e => onQuarterChange(e.target.value)}
          className="px-1 py-0.5 text-xxs border border-light-grey rounded text-navy"
        >
          {QUARTERS.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}
        </select>
      )}
      {axis === 'month' && (
        <select
          value={month}
          onChange={e => onMonthChange(Number(e.target.value))}
          className="px-1 py-0.5 text-xxs border border-light-grey rounded text-navy"
        >
          {MONTH_NAMES_SHORT.map((m, i) => <option key={i} value={i}>{m}</option>)}
        </select>
      )}
      {axis === 'day' && (
        <input
          type="number"
          min={0}
          max={364}
          value={day}
          onChange={e => onDayChange(Number(e.target.value))}
          className="w-16 px-1 py-0.5 text-xxs border border-light-grey rounded text-navy tabular-nums"
          title="Day of year (0 = Jan 1)"
        />
      )}
      {axis === 'day' && (
        <span className="text-xxs text-mid-grey">{dayOfYearToMonthDay(day).label}</span>
      )}
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────

export default function InteractiveProfileVisualiser({
  layers = [],
  weather = null,
  defaultLayerIds,
  defaultMode = 'single_line',
  module = 'profile',
  caption,
  chartModes = ['single_line', 'stacked_area', 'small_multiples'],
  height = 360,
}) {
  // Layer selection — default to the first declared default or, if none,
  // the first declared layer. Simple-by-default.
  const initialSelected = useMemo(() => {
    const ids = layers.map(l => l.id)
    if (Array.isArray(defaultLayerIds) && defaultLayerIds.length > 0) {
      return new Set(defaultLayerIds.filter(id => ids.includes(id)))
    }
    return new Set(ids.length > 0 ? [ids[0]] : [])
  }, [layers, defaultLayerIds])

  const [selectedIds, setSelectedIds] = useState(initialSelected)
  const [chartMode, setChartMode] = useState(defaultMode)
  const [timeAxis, setTimeAxis] = useState('year')
  const [quarter, setQuarter] = useState('Q1')
  const [month, setMonth] = useState(0)
  const [day, setDay] = useState(0)
  const [weatherOverlays, setWeatherOverlays] = useState(new Set())

  // Derived window over the 365-point arrays
  const window = useMemo(() => {
    if (timeAxis === 'year') return { startDoy: 0, endDoy: 364, dayMode: false }
    if (timeAxis === 'quarter') {
      const q = QUARTERS.find(qq => qq.id === quarter) ?? QUARTERS[0]
      return { startDoy: q.startDoy, endDoy: q.endDoy, dayMode: false }
    }
    if (timeAxis === 'month') {
      return { startDoy: MONTH_START_DAY[month], endDoy: MONTH_END_DAY[month], dayMode: false }
    }
    // day
    return { startDoy: day, endDoy: day, dayMode: true }
  }, [timeAxis, quarter, month, day])

  // Build the chart data — array of points indexed by day-of-year. Each point:
  //   { doy, label, <layerId>: kW_avg, t_out_c, wind_ms, ghi_w_per_m2 }
  const data = useMemo(() => {
    const out = []
    for (let d = window.startDoy; d <= window.endDoy; d++) {
      const point = { doy: d, label: dayOfYearToMonthDay(d).label }
      for (const layer of layers) {
        const kwAvg = layer.daily_kwh?.[d] != null ? layer.daily_kwh[d] / 24 : null
        point[layer.id] = kwAvg
      }
      if (weather) {
        point.t_out_c        = weather.t_out_c?.[d] ?? null
        point.wind_ms        = weather.wind_ms?.[d] ?? null
        point.ghi_w_per_m2   = weather.ghi_w_per_m2?.[d] ?? null
      }
      out.push(point)
    }
    return out
  }, [layers, weather, window])

  const selectedLayers = useMemo(
    () => layers.filter(l => selectedIds.has(l.id)),
    [layers, selectedIds]
  )

  const toggleLayer = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleWeather = (id) => {
    setWeatherOverlays(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── Render ────────────────────────────────────────────────────────────

  const primaryHeight = weatherOverlays.size > 0 ? Math.max(180, height - 110) : height
  const weatherHeight = 80
  const xKey = 'label'
  // Brief 44 follow-up (2026-05-21): explicit Y-axis width so the
  // primary chart and the weather strip line up vertically. Without
  // this, Recharts auto-sizes each chart's YAxis based on its own
  // tick label widths — the weather strip ends up narrower (~28 px)
  // while the primary's auto-width is ~40-48 px depending on data.
  // The mismatch makes the X axes drift horizontally. Pinning both to
  // 48 px guarantees the plot areas align.
  const Y_AXIS_WIDTH = 48
  const CHART_MARGIN = { top: 8, right: 8, bottom: 4, left: 0 }

  // Tooltip formatter — show kW per layer, plus weather context
  const tooltipFormatter = (value, name) => {
    const layer = layers.find(l => l.id === name)
    if (layer) return [`${fmt(value)} kW`, layer.label]
    const w = WEATHER_LAYERS.find(w => w.dataKey === name)
    if (w) {
      const units = { t_out_c: '°C', wind_ms: 'm/s', ghi_w_per_m2: 'W/m²' }
      return [`${fmt(value)} ${units[name] ?? ''}`, w.label]
    }
    return [fmt(value), name]
  }

  // Primary chart picker
  const renderPrimary = () => {
    if (selectedLayers.length === 0) {
      return (
        <div className="flex items-center justify-center text-xxs text-mid-grey italic" style={{ height: primaryHeight }}>
          Select one or more layers below to see the profile.
        </div>
      )
    }

    if (chartMode === 'small_multiples') {
      const cols = Math.min(3, selectedLayers.length)
      return (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {selectedLayers.map(l => (
            <div key={l.id} className="border border-light-grey rounded p-1.5 bg-white">
              <div className="flex items-baseline justify-between mb-0.5">
                <span className="text-xxs text-navy font-medium">{l.label}</span>
                <span className="text-xxs text-mid-grey" style={{ color: l.colour }}>●</span>
              </div>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                  <XAxis dataKey={xKey} hide />
                  <YAxis hide />
                  <Tooltip formatter={tooltipFormatter} labelStyle={{ fontSize: 10 }} contentStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey={l.id} stroke={l.colour} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      )
    }

    if (chartMode === 'stacked_area') {
      return (
        <ResponsiveContainer width="100%" height={primaryHeight}>
          <AreaChart data={data} margin={CHART_MARGIN}>
            <CartesianGrid stroke="#E5E7EB" strokeDasharray="2 2" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#6B7280' }} interval={Math.max(1, Math.floor(data.length / 12))} />
            <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10, fill: '#6B7280' }} label={{ value: 'kW', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#6B7280', offset: 0 }} />
            <Tooltip formatter={tooltipFormatter} contentStyle={{ fontSize: 11 }} labelStyle={{ fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {selectedLayers.map(l => (
              <Area key={l.id} type="monotone" dataKey={l.id} name={l.label} stackId="1" stroke={l.colour} fill={l.colour} fillOpacity={0.55} isAnimationActive={false} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )
    }

    // single_line (default)
    return (
      <ResponsiveContainer width="100%" height={primaryHeight}>
        <LineChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid stroke="#E5E7EB" strokeDasharray="2 2" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#6B7280' }} interval={Math.max(1, Math.floor(data.length / 12))} />
          <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10, fill: '#6B7280' }} label={{ value: 'kW', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#6B7280', offset: 0 }} />
          <Tooltip formatter={tooltipFormatter} contentStyle={{ fontSize: 11 }} labelStyle={{ fontSize: 11 }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {selectedLayers.map(l => (
            <Line key={l.id} type="monotone" dataKey={l.id} name={l.label} stroke={l.colour} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    )
  }

  const renderWeather = () => {
    if (weatherOverlays.size === 0 || !weather) return null
    const overlays = WEATHER_LAYERS.filter(w => weatherOverlays.has(w.id))
    return (
      <div className="mt-2 border border-light-grey rounded bg-off-white/30 p-1">
        <ResponsiveContainer width="100%" height={weatherHeight}>
          <LineChart data={data} margin={CHART_MARGIN}>
            <XAxis dataKey={xKey} tick={{ fontSize: 9, fill: '#9CA3AF' }} interval={Math.max(1, Math.floor(data.length / 12))} />
            <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 9, fill: '#9CA3AF' }} />
            <Tooltip formatter={tooltipFormatter} contentStyle={{ fontSize: 11 }} labelStyle={{ fontSize: 11 }} />
            {overlays.map(w => (
              <Line key={w.id} type="monotone" dataKey={w.dataKey} name={w.label} stroke={w.colour} strokeWidth={1} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    )
  }

  return (
    <div className="w-full flex flex-col">
      {/* Header — controls */}
      <div className="flex-shrink-0 flex flex-wrap items-center gap-3 px-1 py-1.5 mb-2">
        <TimeAxisPicker
          axis={timeAxis} onAxisChange={setTimeAxis}
          quarter={quarter} onQuarterChange={setQuarter}
          month={month}   onMonthChange={setMonth}
          day={day}       onDayChange={setDay}
        />
        <span className="text-mid-grey text-xxs">·</span>
        <ModePicker value={chartMode} onChange={setChartMode} modes={chartModes} />
      </div>

      {/* Primary chart */}
      <div className="flex-1 min-h-0">
        {renderPrimary()}
      </div>

      {/* Layer toggles */}
      <div className="flex-shrink-0 mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xxs uppercase tracking-wider text-mid-grey mr-1">Layers</span>
        {layers.map(l => (
          <ToggleChip
            key={l.id}
            label={l.label}
            swatch={l.colour}
            active={selectedIds.has(l.id)}
            onClick={() => toggleLayer(l.id)}
          />
        ))}
      </div>

      {/* Weather overlay toggles */}
      {weather && (
        <div className="flex-shrink-0 mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xxs uppercase tracking-wider text-mid-grey mr-1">Weather</span>
          {WEATHER_LAYERS.map(w => (
            <ToggleChip
              key={w.id}
              label={w.label}
              swatch={w.colour}
              active={weatherOverlays.has(w.id)}
              onClick={() => toggleWeather(w.id)}
            />
          ))}
        </div>
      )}

      {/* Weather chart (optional, beneath primary) */}
      {renderWeather()}

      {/* Caption */}
      {caption && (
        <p className="text-xxs text-mid-grey/80 leading-tight mt-2">{caption}</p>
      )}
    </div>
  )
}
