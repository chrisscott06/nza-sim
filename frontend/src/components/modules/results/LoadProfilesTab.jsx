import { useContext, useState, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import { SimulationContext } from '../../../context/SimulationContext.jsx'
import ModuleEmptyState from '../../ui/ModuleEmptyState.jsx'
import {
  TICK_STYLE, TOOLTIP_STYLE, TOOLTIP_WRAPPER_STYLE, LEGEND_STYLE,
  GRID_STYLE, AXIS_PROPS,
} from '../../../data/chartTokens.js'
import { Activity } from 'lucide-react'

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const SERIES = [
  { key: 'heating_W',   label: 'Heating',   color: '#DC2626', fillOpacity: 0.5 },
  { key: 'cooling_W',   label: 'Cooling',   color: '#3B82F6', fillOpacity: 0.5 },
]

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={TOOLTIP_STYLE}>
      <p className="font-medium mb-1">Hour {label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.stroke }}>
          {p.name}: {(p.value ?? 0).toFixed(0)} W/m²
        </p>
      ))}
    </div>
  )
}

export default function LoadProfilesTab() {
  const { status, results } = useContext(SimulationContext)
  const [selectedMonth, setSelectedMonth] = useState(0) // 0 = full year

  if (status !== 'complete' || !results?.hourly_profiles) {
    return (
      <ModuleEmptyState
        icon={Activity}
        title="No results yet"
        description="Run a simulation to see hourly load profiles."
        className="p-6"
      />
    )
  }

  const profiles = results.hourly_profiles ?? []

  // Filter by month (1-indexed), or show all if selectedMonth === 0
  // Sample every Nth point to keep the chart responsive
  const chartData = useMemo(() => {
    let filtered = profiles
    if (selectedMonth > 0) {
      filtered = profiles.filter(r => r.month === selectedMonth)
    }
    // Downsample to ~720 points max for performance
    const step = Math.max(1, Math.floor(filtered.length / 720))
    return filtered
      .filter((_, i) => i % step === 0)
      .map((r, i) => ({
        hour: selectedMonth > 0
          ? r.hour_of_day ?? (i % 24)
          : Math.round(r.hour_of_year ?? i),
        heating_W: r.heating_W_per_m2 ?? 0,
        cooling_W: r.cooling_W_per_m2 ?? 0,
      }))
  }, [profiles, selectedMonth])

  const xLabel = selectedMonth > 0 ? 'Hour of day' : 'Hour of year'

  // Peak values
  const peakHeating = chartData.reduce((m, r) => Math.max(m, r.heating_W), 0)
  const peakCooling = chartData.reduce((m, r) => Math.max(m, r.cooling_W), 0)

  return (
    <div className="p-4 space-y-4">
      {/* Month selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xxs uppercase tracking-wider text-mid-grey">Month:</span>
        {[{ label: 'All', value: 0 }, ...MONTH_NAMES.map((m, i) => ({ label: m, value: i + 1 }))].map(opt => (
          <button
            key={opt.value}
            onClick={() => setSelectedMonth(opt.value)}
            className={`
              text-xxs px-2 py-0.5 rounded border transition-colors
              ${selectedMonth === opt.value
                ? 'bg-navy text-white border-navy'
                : 'bg-white text-mid-grey border-light-grey hover:border-navy hover:text-navy'
              }
            `}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="bg-white rounded-lg border border-light-grey p-3">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              {SERIES.map(s => (
                <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={s.color} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={s.color} stopOpacity={0.05} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid {...GRID_STYLE} vertical={false} />
            <XAxis
              dataKey="hour"
              {...AXIS_PROPS}
              label={{ value: xLabel, position: 'insideBottom', offset: -2, style: { ...TICK_STYLE, fontSize: 8 } }}
            />
            <YAxis
              {...AXIS_PROPS}
              label={{ value: 'W/m²', angle: -90, position: 'insideLeft', offset: 8, style: { ...TICK_STYLE, fontSize: 8 } }}
            />
            <Tooltip content={<CustomTooltip />} wrapperStyle={TOOLTIP_WRAPPER_STYLE} />
            <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" iconSize={7} />
            {SERIES.map(s => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={1}
                fill={`url(#grad-${s.key})`}
                dot={false}
                activeDot={{ r: 3 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Peak stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white rounded border border-light-grey px-3 py-2" style={{ borderLeft: '3px solid #DC2626' }}>
          <p className="text-metric text-navy font-medium">{peakHeating.toFixed(1)}</p>
          <p className="text-xxs text-mid-grey mt-0.5 uppercase tracking-wider">Peak Heating W/m²</p>
        </div>
        <div className="bg-white rounded border border-light-grey px-3 py-2" style={{ borderLeft: '3px solid #3B82F6' }}>
          <p className="text-metric text-navy font-medium">{peakCooling.toFixed(1)}</p>
          <p className="text-xxs text-mid-grey mt-0.5 uppercase tracking-wider">Peak Cooling W/m²</p>
        </div>
      </div>
    </div>
  )
}
