/**
 * WeatherModule.jsx — /weather
 *
 * Inspector for the EPW weather file currently assigned to the project.
 * Shows location metadata, annual stats, HDD/CDD at multiple bases, and
 * monthly + hourly visualisations of the data EnergyPlus is using.
 *
 * No import — that's WeatherSelector's job. This is purely the read view.
 */

import { useContext, useEffect, useMemo, useState } from 'react'
import {
  Cloud, Thermometer, Droplet, Wind, Sun, AlertCircle,
} from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, ComposedChart,
  Area, AreaChart, Brush,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend,
} from 'recharts'
import { ProjectContext } from '../../context/ProjectContext.jsx'

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Methodology metadata — drives the badge in the header and the
// "what does this mean" note. Keys match what the backend returns.
const METHODOLOGY_META = {
  TMYx: {
    full: 'TMYx — Typical Meteorological Year (extended)',
    bg: '#DBEAFE', colour: '#1D4ED8',
    note: 'Each month is a real contiguous hourly record from a single year, selected (via the Finkelstein-Schafer statistic) to be most representative across a multi-year period. Best for typical-year energy demand. Sourced from climate.onebuilding.org.',
  },
  TMY: {
    full: 'TMY — Typical Meteorological Year',
    bg: '#DBEAFE', colour: '#1D4ED8',
    note: 'A representative year synthesised from selected real months across a long-term record. Use for typical heating/cooling demand. Not suitable for overheating-risk or peak-load sizing.',
  },
  TMY3: {
    full: 'TMY3 — Typical Meteorological Year (NREL, USA)',
    bg: '#DBEAFE', colour: '#1D4ED8',
    note: 'NREL\'s TMY3 dataset for US locations. Same idea as TMY: selected representative months from a long-term record. Best for typical-year demand.',
  },
  TRY: {
    full: 'TRY — Test Reference Year (CIBSE convention)',
    bg: '#DCFCE7', colour: '#15803D',
    note: 'CIBSE test reference year. Typical-year selection for energy demand assessment. Use this for normal heating/cooling demand modelling.',
  },
  DSY: {
    full: 'DSY — Design Summer Year (CIBSE convention)',
    bg: '#FEE2E2', colour: '#B91C1C',
    note: 'A near-95th-percentile warm year, used for overheating-risk assessment under CIBSE TM52. NOT suitable for typical-year energy demand — heating loads will be understated.',
  },
  HDY: {
    full: 'HDY — Heating Design Year',
    bg: '#FEE2E2', colour: '#B91C1C',
    note: 'A cold year used for sizing heating systems against worst-case demand. NOT suitable for typical-year energy demand.',
  },
  CDY: {
    full: 'CDY — Cooling Design Year',
    bg: '#FED7AA', colour: '#C2410C',
    note: 'A hot year used for sizing cooling systems. NOT suitable for typical-year energy demand.',
  },
}

// Common UK and international HDD/CDD benchmarks for context.
const HDD_BENCHMARKS_18C = {
  London:           2200,
  Manchester:       2400,
  Edinburgh:        2700,
  Helsinki:         5000,
  'New York':       2800,
  'San Francisco':  1400,
}

export default function WeatherModule() {
  const { params } = useContext(ProjectContext)
  const filename = params?.weather_file || 'default'

  const [data, setData]     = useState(null)
  const [error, setError]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [selectedVar, setSelectedVar] = useState('dry_bulb')

  useEffect(() => {
    if (!filename) return
    setLoading(true); setError(null); setData(null)
    fetch(`/api/weather/${encodeURIComponent(filename)}/inspect`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [filename])

  if (!filename || filename === 'default') {
    return <Empty message="Assign a weather file in the Building module to inspect it here." />
  }
  if (loading) return <Loading />
  if (error)   return <Empty message={`Failed to load weather: ${error}`} icon={AlertCircle} />
  if (!data)   return null

  const { location, annual, monthly, degree_days: dd, years, hourly, methodology } = data

  return (
    <div className="h-full overflow-y-auto bg-off-white">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">

        {/* Header — location + period + methodology */}
        <Section>
          <div className="flex items-baseline justify-between mb-1 gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-heading font-semibold text-navy">{location.city}</h1>
                {methodology && methodology !== 'Unknown' && (
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded text-xxs font-semibold"
                    style={{
                      backgroundColor: METHODOLOGY_META[methodology]?.bg ?? '#E5E7EB',
                      color: METHODOLOGY_META[methodology]?.colour ?? '#1F2937',
                    }}
                    title={METHODOLOGY_META[methodology]?.full ?? methodology}
                  >
                    {methodology}
                  </span>
                )}
              </div>
              <p className="text-xxs text-mid-grey mt-1">
                {location.country ? `${location.country} · ` : ''}
                {location.latitude.toFixed(3)}, {location.longitude.toFixed(3)} ·
                Elev {Math.round(location.elevation_m)} m ·
                TZ {location.time_zone >= 0 ? '+' : ''}{location.time_zone}
              </p>
              <p className="text-xxs text-mid-grey mt-0.5 font-mono break-all">{data.filename}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xxs uppercase tracking-wider text-mid-grey">Period</p>
              <p className="text-caption font-semibold text-navy">
                {years.min === years.max ? years.min : `${years.min}–${years.max}`}
              </p>
              <p className="text-xxs text-mid-grey mt-0.5">{years.all.length} year{years.all.length !== 1 ? 's' : ''} of data</p>
            </div>
          </div>
          {METHODOLOGY_META[methodology]?.note && (
            <p className="text-xxs text-dark-grey mt-3 pt-3 border-t border-light-grey leading-relaxed">
              <span className="font-semibold">{METHODOLOGY_META[methodology].full}:</span>{' '}
              {METHODOLOGY_META[methodology].note}
            </p>
          )}
        </Section>

        {/* Year-per-month — which actual year contributed each month */}
        {years.by_month && years.by_month.length > 0 && years.all.length > 1 && (
          <Section title="Year origin per month">
            <p className="text-xxs text-mid-grey mb-3">
              {methodology === 'TMYx' || methodology === 'TMY' || methodology === 'TMY3' || methodology === 'TRY'
                ? `Each month is real hourly data from a single specific year, selected to be most representative across the ${years.all.length}-year record. Not an average — preserves real weather patterns (cold snaps, heat waves). Hover or read the table below for the year contributing each month.`
                : `Year contributing each month of the file.`}
            </p>
            <div className="grid grid-cols-6 md:grid-cols-12 gap-1 text-xxs">
              {years.by_month.map(m => (
                <div key={m.month} className="bg-off-white rounded p-2 text-center">
                  <p className="text-mid-grey">{MONTH_LABELS[m.month - 1]}</p>
                  <p className="font-semibold text-navy tabular-nums">{m.year}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Annual KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi icon={Thermometer} label="Avg dry-bulb"  value={`${annual.t_avg} °C`} sub={`min ${annual.t_min} / max ${annual.t_max} °C`} colour="#DC2626" />
          <Kpi icon={Sun}         label="Annual GHI"    value={`${annual.ghi_kwh_per_m2} kWh/m²·yr`} sub={`DNI ${annual.dni_kwh_per_m2}, DHI ${annual.dhi_kwh_per_m2}`} colour="#F59E0B" />
          <Kpi icon={Wind}        label="Avg wind"      value={`${annual.wind_speed_avg} m/s`} colour="#06B6D4" />
          <Kpi icon={Cloud}       label="HDD (15.5°C)"  value={`${dd.hdd['15.5']}`} sub={`HDD18 ${dd.hdd['18']} · CDD22 ${dd.cdd['22']}`} colour="#475569" />
        </div>

        {/* HDD/CDD detail + benchmark comparison */}
        <Section title="Heating + cooling degree days">
          <p className="text-xxs text-mid-grey mb-3">
            Computed directly from the dry-bulb hourly series. The base
            temperature defines the threshold below (HDD) or above (CDD) which
            outdoor temperature contributes to demand.
          </p>
          <div className="grid grid-cols-2 gap-6">
            <DegreeDayTable label="Heating degree days" data={[
              ['12 °C', dd.hdd['12']],
              ['15 °C', dd.hdd['15']],
              ['15.5 °C (UK convention)', dd.hdd['15.5']],
              ['18 °C (US convention)', dd.hdd['18']],
            ]} />
            <DegreeDayTable label="Cooling degree days" data={[
              ['18 °C', dd.cdd['18']],
              ['22 °C', dd.cdd['22']],
              ['24 °C', dd.cdd['24']],
            ]} />
          </div>

          <div className="mt-4 pt-4 border-t border-light-grey">
            <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">
              HDD18 vs typical climates
            </p>
            <div className="space-y-1.5">
              {[
                ['This site', dd.hdd['18'], '#0F172A'],
                ...Object.entries(HDD_BENCHMARKS_18C).map(([k, v]) => [k, v, '#94A3B8']),
              ].sort((a, b) => a[1] - b[1]).map(([name, val, col]) => {
                const max = Math.max(dd.hdd['18'], ...Object.values(HDD_BENCHMARKS_18C))
                const pct = (val / max) * 100
                const isThis = name === 'This site'
                return (
                  <div key={name} className="flex items-center gap-3 text-xxs">
                    <span className={`w-28 text-right ${isThis ? 'text-navy font-semibold' : 'text-mid-grey'}`}>{name}</span>
                    <div className="flex-1 h-3 bg-off-white rounded">
                      <div
                        className="h-full rounded transition-all"
                        style={{ width: `${pct}%`, backgroundColor: col, opacity: isThis ? 1 : 0.5 }}
                      />
                    </div>
                    <span className={`w-16 text-right tabular-nums ${isThis ? 'font-semibold text-navy' : 'text-mid-grey'}`}>{val}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </Section>

        {/* Monthly summary */}
        <Section title="Monthly summary">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Dry-bulb temperature (°C)</p>
              <div className="h-[220px]">
                <ResponsiveContainer>
                  <ComposedChart data={monthly.map(m => ({ ...m, label: MONTH_LABELS[m.month - 1] }))}
                                 margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                    <Tooltip contentStyle={{ fontSize: 11 }} />
                    <Bar dataKey="t_avg" fill="#DC2626" name="Avg" />
                    <Line dataKey="t_min" stroke="#1D4ED8" strokeWidth={1.5} dot={{ r: 3 }} name="Min" />
                    <Line dataKey="t_max" stroke="#F59E0B" strokeWidth={1.5} dot={{ r: 3 }} name="Max" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Global solar irradiance (kWh/m²)</p>
              <div className="h-[220px]">
                <ResponsiveContainer>
                  <BarChart data={monthly.map(m => ({ ...m, label: MONTH_LABELS[m.month - 1] }))}
                            margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                    <Tooltip contentStyle={{ fontSize: 11 }} />
                    <Bar dataKey="ghi_kwh_per_m2" fill="#F59E0B" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </Section>

        {/* Time series — zoomable line chart with hourly / daily / monthly */}
        <Section title="Time series">
          <div className="flex flex-wrap items-center gap-3 mb-3 text-xxs">
            <span className="text-mid-grey">Variable:</span>
            <VariableToggle current={selectedVar} onChange={setSelectedVar} />
          </div>
          <TimeSeriesChart hourly={hourly} variable={selectedVar} />
        </Section>

        {/* Calendar heatmap — same data, year-at-a-glance overview */}
        <Section title="Year-at-a-glance heatmap">
          <p className="text-xxs text-mid-grey mb-3">
            24 hours × 365 days. Drag any cell on the time-series chart above
            to zoom; this heatmap stays as the always-on overview.
          </p>
          <DailyHeatmap hourly={hourly} variable={selectedVar} />
        </Section>

      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-xl border border-light-grey overflow-hidden">
      {title && (
        <div className="px-5 py-3 border-b border-light-grey">
          <h2 className="text-caption font-semibold text-navy">{title}</h2>
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  )
}

function Kpi({ icon: Icon, label, value, sub, colour }) {
  return (
    <div className="bg-white rounded-xl border border-light-grey p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center justify-center rounded-md w-7 h-7"
              style={{ backgroundColor: colour + '15', color: colour }}>
          <Icon size={14} />
        </span>
        <span className="text-xxs uppercase tracking-wider text-mid-grey">{label}</span>
      </div>
      <p className="text-heading font-bold text-navy tabular-nums">{value}</p>
      {sub && <p className="text-xxs text-mid-grey mt-1">{sub}</p>}
    </div>
  )
}

function DegreeDayTable({ label, data }) {
  return (
    <div>
      <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">{label}</p>
      <table className="w-full text-xxs">
        <tbody>
          {data.map(([base, val]) => (
            <tr key={base} className="border-b border-light-grey/60 last:border-b-0">
              <td className="py-1.5 text-dark-grey">{base}</td>
              <td className="py-1.5 text-right tabular-nums font-medium text-navy">{val}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const VARIABLES = [
  { id: 'dry_bulb',           label: 'Dry-bulb temp (°C)',  unit: '°C',     palette: 'temperature' },
  { id: 'wet_bulb',           label: 'Wet-bulb temp (°C)',  unit: '°C',     palette: 'temperature' },
  { id: 'humidity',           label: 'Relative humidity (%)', unit: '%',    palette: 'percent' },
  { id: 'global_horizontal',  label: 'Global horizontal solar (Wh/m²)', unit: 'Wh/m²', palette: 'solar' },
  { id: 'wind_speed',         label: 'Wind speed (m/s)',    unit: 'm/s',    palette: 'wind' },
]

function VariableToggle({ current, onChange }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {VARIABLES.map(v => (
        <button
          key={v.id}
          onClick={() => onChange(v.id)}
          className={`px-2.5 py-1 rounded text-xxs transition-colors ${
            current === v.id
              ? 'bg-navy text-white'
              : 'bg-off-white text-mid-grey hover:text-navy'
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  )
}

/**
 * TimeSeriesChart — zoomable line/area chart for one variable.
 *
 * Three resolutions:
 *   hourly   — 8760 points, brush enabled for drilling into a few days
 *   daily    — 365 points, daily mean (and min/max band for temperatures)
 *   monthly  — 12 points, monthly mean
 *
 * Switching resolution preserves the variable; switching variable preserves
 * the resolution.
 */
function TimeSeriesChart({ hourly, variable }) {
  const [resolution, setResolution] = useState('daily')
  const meta = VARIABLES.find(v => v.id === variable)
  const series = hourly[variable] ?? []

  const data = useMemo(() => {
    if (!series.length) return []

    if (resolution === 'hourly') {
      // 8760 points — keep month + day for tooltip
      return series.map((v, i) => ({
        idx: i,
        label: `${MONTH_LABELS[hourly.month[i] - 1]} ${hourly.day[i]} · ${String((hourly.hour[i] - 1) % 24).padStart(2, '0')}:00`,
        value: v,
      }))
    }

    if (resolution === 'daily') {
      // Bucket by (month, day) → mean / min / max
      const buckets = {}
      for (let i = 0; i < series.length; i++) {
        const key = `${hourly.month[i]}-${hourly.day[i]}`
        if (!buckets[key]) buckets[key] = []
        buckets[key].push(series[i])
      }
      const sortedKeys = Object.keys(buckets).sort((a, b) => {
        const [am, ad] = a.split('-').map(Number)
        const [bm, bd] = b.split('-').map(Number)
        return am === bm ? ad - bd : am - bm
      })
      return sortedKeys.map((k, idx) => {
        const arr = buckets[k]
        const [m, d] = k.split('-').map(Number)
        const mean = arr.reduce((s, v) => s + v, 0) / arr.length
        return {
          idx,
          label: `${MONTH_LABELS[m - 1]} ${d}`,
          value: round1(mean),
          min: round1(Math.min(...arr)),
          max: round1(Math.max(...arr)),
        }
      })
    }

    // Monthly
    const byMonth = {}
    for (let i = 0; i < series.length; i++) {
      const m = hourly.month[i]
      if (!byMonth[m]) byMonth[m] = []
      byMonth[m].push(series[i])
    }
    return Object.keys(byMonth).map(Number).sort((a, b) => a - b).map(m => {
      const arr = byMonth[m]
      const mean = arr.reduce((s, v) => s + v, 0) / arr.length
      return {
        idx: m - 1,
        label: MONTH_LABELS[m - 1],
        value: round1(mean),
        min: round1(Math.min(...arr)),
        max: round1(Math.max(...arr)),
      }
    })
  }, [series, hourly, resolution])

  const isTemperature = meta?.palette === 'temperature'
  const lineColour = isTemperature ? '#DC2626' : meta?.palette === 'solar' ? '#F59E0B' :
                     meta?.palette === 'wind' ? '#0369A1' : '#475569'

  // Sensible default brush window for hourly: a representative summer week
  const initialBrush = resolution === 'hourly'
    ? { startIndex: 4344, endIndex: 4512 }    // ~ early July, ~7 days
    : { startIndex: 0, endIndex: data.length - 1 }

  return (
    <>
      <div className="flex items-center gap-2 mb-3 text-xxs">
        <span className="text-mid-grey">Resolution:</span>
        <ResolutionToggle current={resolution} onChange={setResolution} />
        <span className="ml-auto text-mid-grey">
          {resolution === 'hourly' && 'Drag the brush below to pan/zoom across the 8,760-hour series'}
          {resolution === 'daily'  && '365 points (daily mean ± min/max band for temperatures)'}
          {resolution === 'monthly' && '12 monthly means'}
        </span>
      </div>
      <div className="h-[280px]">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 16, left: -10, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: '#9CA3AF' }}
              interval={resolution === 'hourly' ? 999 : resolution === 'daily' ? 30 : 0}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#9CA3AF' }}
              tickLine={false}
              axisLine={false}
              width={40}
              label={{
                value: meta?.unit ?? '',
                angle: -90, position: 'insideLeft', offset: 12,
                style: { fontSize: 10, fill: '#9CA3AF' },
              }}
            />
            <Tooltip
              contentStyle={{ fontSize: 11, padding: '4px 8px', borderRadius: 4, border: '1px solid #E5E7EB' }}
              formatter={(v) => [`${v} ${meta?.unit ?? ''}`, '']}
            />
            {/* min/max band for daily/monthly temperatures (where meaningful) */}
            {resolution !== 'hourly' && data[0]?.min != null && (
              <Area
                type="monotone" dataKey="max" stroke="none" fill={lineColour} fillOpacity={0.12}
                connectNulls dot={false} legendType="none"
              />
            )}
            {resolution !== 'hourly' && data[0]?.min != null && (
              <Area
                type="monotone" dataKey="min" stroke="none" fill="#FFFFFF" fillOpacity={1}
                connectNulls dot={false} legendType="none"
              />
            )}
            <Line
              type="monotone"
              dataKey="value"
              stroke={lineColour}
              strokeWidth={2}
              dot={resolution === 'monthly' ? { r: 3 } : false}
              isAnimationActive={false}
            />
            {resolution === 'hourly' && (
              <Brush
                dataKey="label"
                height={20}
                stroke="#94A3B8"
                travellerWidth={10}
                startIndex={initialBrush.startIndex}
                endIndex={initialBrush.endIndex}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

function ResolutionToggle({ current, onChange }) {
  const opts = [
    { id: 'hourly',  label: 'Hourly'  },
    { id: 'daily',   label: 'Daily'   },
    { id: 'monthly', label: 'Monthly' },
  ]
  return (
    <div className="flex items-center bg-off-white rounded-lg p-0.5">
      {opts.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-2.5 py-1 rounded text-xxs transition-colors ${
            current === o.id
              ? 'bg-white text-navy font-medium shadow-sm'
              : 'text-mid-grey hover:text-navy'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function round1(v) { return Math.round(v * 10) / 10 }

/**
 * Calendar heatmap: 24 rows (hour of day) × 365 cols (day of year).
 * Each cell coloured by value in the chosen variable.
 */
function DailyHeatmap({ hourly, variable }) {
  const series = hourly[variable] ?? []
  const meta   = VARIABLES.find(v => v.id === variable)

  // Compute domain (5-95th percentile to make outliers not wash colour out)
  const { vmin, vmax } = useMemo(() => {
    if (!series.length) return { vmin: 0, vmax: 1 }
    const sorted = [...series].sort((a, b) => a - b)
    return {
      vmin: sorted[Math.floor(sorted.length * 0.02)],
      vmax: sorted[Math.floor(sorted.length * 0.98)],
    }
  }, [series])

  function colour(val) {
    if (vmax === vmin) return '#E5E7EB'
    const t = Math.max(0, Math.min(1, (val - vmin) / (vmax - vmin)))
    if (meta?.palette === 'temperature') {
      // blue → white → red, anchored to typical comfort range
      if (t < 0.5) {
        const k = t * 2 // 0..1
        return interpHex('#1D4ED8', '#F8FAFC', k)
      }
      const k = (t - 0.5) * 2
      return interpHex('#F8FAFC', '#DC2626', k)
    }
    if (meta?.palette === 'solar') {
      return interpHex('#1F2937', '#F59E0B', t)
    }
    if (meta?.palette === 'wind') {
      return interpHex('#F0F9FF', '#0369A1', t)
    }
    return interpHex('#F1F5F9', '#475569', t)
  }

  // Build SVG: 24 rows × 365 columns
  const W = 920, H = 200
  const colW = W / 365
  const rowH = (H - 24) / 24

  // Tooltip
  const [hover, setHover] = useState(null)

  // Group series into [hour][doy]
  const grid = useMemo(() => {
    if (!series.length) return null
    const g = Array.from({ length: 24 }, () => Array(365).fill(null))
    let doy = 0, prevHour = -1
    for (let i = 0; i < series.length; i++) {
      const m = hourly.month[i]
      const d = hourly.day[i]
      const h = (hourly.hour[i] - 1) % 24
      // Approximate doy from month + day (close enough for layout)
      const doyApprox = Math.floor((m - 1) * 30.42 + d - 1)
      if (doyApprox >= 0 && doyApprox < 365) g[h][doyApprox] = series[i]
    }
    return g
  }, [series, hourly])

  if (!grid) return <p className="text-xxs text-mid-grey">No data.</p>

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none">
        {/* Heatmap grid */}
        <g>
          {grid.map((row, h) => row.map((val, d) => {
            if (val == null) return null
            return (
              <rect
                key={`${h}-${d}`}
                x={d * colW}
                y={(23 - h) * rowH + 12}
                width={colW + 0.5}
                height={rowH + 0.5}
                fill={colour(val)}
                onMouseEnter={() => setHover({ h, d, val })}
                onMouseLeave={() => setHover(null)}
              />
            )
          }))}
        </g>
        {/* Month dividers + labels */}
        {[0,31,59,90,120,151,181,212,243,273,304,334].map((doy, i) => (
          <g key={i}>
            <line x1={doy * colW} y1={12} x2={doy * colW} y2={H - 12}
                  stroke="#fff" strokeWidth={1} opacity={0.4} />
            <text x={doy * colW + 4} y={10} fontSize={9} fill="#9CA3AF">
              {MONTH_LABELS[i]}
            </text>
          </g>
        ))}
        {/* Hour labels (0, 6, 12, 18) */}
        {[0, 6, 12, 18].map(h => (
          <text key={h}
                x={W - 4} y={(23 - h) * rowH + 12 + rowH / 2}
                fontSize={8} fill="#9CA3AF" textAnchor="end" alignmentBaseline="middle">
            {String(h).padStart(2, '0')}:00
          </text>
        ))}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-2 text-xxs text-mid-grey">
        <span>{vmin.toFixed(1)} {meta?.unit}</span>
        <div className="flex-1 h-2 rounded" style={{
          background: meta?.palette === 'temperature'
            ? 'linear-gradient(to right, #1D4ED8, #F8FAFC, #DC2626)'
            : meta?.palette === 'solar'
              ? 'linear-gradient(to right, #1F2937, #F59E0B)'
              : meta?.palette === 'wind'
                ? 'linear-gradient(to right, #F0F9FF, #0369A1)'
                : 'linear-gradient(to right, #F1F5F9, #475569)',
        }} />
        <span>{vmax.toFixed(1)} {meta?.unit}</span>
      </div>

      {hover && (
        <p className="text-xxs text-dark-grey mt-2 tabular-nums">
          {hover.val.toFixed(1)} {meta?.unit} on day {hover.d + 1} at {String(hover.h).padStart(2, '0')}:00
        </p>
      )}
    </div>
  )
}

function interpHex(a, b, t) {
  const ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16)
  const br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16)
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const c = Math.round(ab + (bb - ab) * t)
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${c.toString(16).padStart(2,'0')}`
}

function Loading() {
  return (
    <div className="h-full flex items-center justify-center text-mid-grey text-xxs">
      Loading weather data…
    </div>
  )
}

function Empty({ message, icon: Icon = Cloud }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-mid-grey">
      <Icon size={32} className="text-light-grey" />
      <p className="text-xxs">{message}</p>
    </div>
  )
}
