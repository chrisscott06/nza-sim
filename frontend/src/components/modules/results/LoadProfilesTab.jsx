import { useContext, useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import { SimulationContext } from '../../../context/SimulationContext.jsx'
import DataCard from '../../ui/DataCard.jsx'
import ModuleEmptyState from '../../ui/ModuleEmptyState.jsx'
import {
  TICK_STYLE, TOOLTIP_STYLE, TOOLTIP_WRAPPER_STYLE, LEGEND_STYLE,
  GRID_STYLE, AXIS_PROPS,
} from '../../../data/chartTokens.js'
import { Activity } from 'lucide-react'

/* ── Hour labels (00:00 … 23:00) ──────────────────────────────────────────── */
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)

const DAY_TYPES = [
  { key: 'peak_heating',   label: 'Peak Heating Day',      accent: '#DC2626' },
  { key: 'peak_cooling',   label: 'Peak Cooling Day',      accent: '#3B82F6' },
  { key: 'typical_winter', label: 'Typical Winter',        accent: '#8B5CF6' },
  { key: 'typical_summer', label: 'Typical Summer',        accent: '#ECB01F' },
]

const SERIES = [
  { key: 'heating_kWh',   label: 'Heating',   color: '#DC2626' },
  { key: 'cooling_kWh',   label: 'Cooling',   color: '#3B82F6' },
  { key: 'lighting_kWh',  label: 'Lighting',  color: '#ECB01F' },
  { key: 'equipment_kWh', label: 'Equipment', color: '#8B5CF6' },
]

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0)
  return (
    <div style={TOOLTIP_STYLE}>
      <p className="font-medium mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.stroke }}>
          {p.name}: {p.value?.toFixed(2)} kWh
        </p>
      ))}
      <p className="border-t border-light-grey mt-1 pt-1 font-medium text-navy">
        Total: {total.toFixed(2)} kWh
      </p>
    </div>
  )
}

export default function LoadProfilesTab() {
  const { status, results } = useContext(SimulationContext)
  const [selectedDayType, setSelectedDayType] = useState('peak_heating')

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

  const profiles = results.hourly_profiles
  const profile  = profiles[selectedDayType]

  if (!profile) {
    return (
      <ModuleEmptyState
        icon={Activity}
        title="Profile data unavailable"
        description="Run a new simulation to generate profile data."
        className="p-6"
      />
    )
  }

  // Build chart data — 24 hourly points
  const chartData = HOUR_LABELS.map((hour, h) => ({
    hour,
    heating_kWh:   profile.heating_kWh?.[h]   ?? 0,
    cooling_kWh:   profile.cooling_kWh?.[h]   ?? 0,
    lighting_kWh:  profile.lighting_kWh?.[h]  ?? 0,
    equipment_kWh: profile.equipment_kWh?.[h] ?? 0,
  }))

  // DataCard metrics
  const totalValues = chartData.map(d => d.heating_kWh + d.cooling_kWh + d.lighting_kWh + d.equipment_kWh)
  const peakDemand  = Math.max(...totalValues)
  const avgDemand   = totalValues.reduce((s, v) => s + v, 0) / 24
  const loadFactor  = peakDemand > 0 ? avgDemand / peakDemand : 0
  const midnight    = totalValues[0]
  const midday      = totalValues[12]

  const dayInfo = DAY_TYPES.find(d => d.key === selectedDayType)

  return (
    <div className="p-4 space-y-4">

      {/* Day type selector */}
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Day type</p>
        <div className="flex flex-wrap gap-2">
          {DAY_TYPES.map(dt => (
            <button
              key={dt.key}
              onClick={() => setSelectedDayType(dt.key)}
              className={`
                text-caption px-3 py-1.5 rounded border transition-colors
                ${selectedDayType === dt.key
                  ? 'text-white border-transparent'
                  : 'bg-white text-mid-grey border-light-grey hover:border-navy hover:text-navy'
                }
              `}
              style={selectedDayType === dt.key ? { backgroundColor: dt.accent, borderColor: dt.accent } : {}}
            >
              {dt.label}
            </button>
          ))}
        </div>
        {profile.label && (
          <p className="text-xxs text-mid-grey mt-1.5">{profile.label}</p>
        )}
      </div>

      {/* Stacked area chart */}
      <div className="bg-white rounded-lg border border-light-grey p-3">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 16 }}>
            <defs>
              {SERIES.map(s => (
                <linearGradient key={s.key} id={`grad-lp-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={s.color} stopOpacity={0.5} />
                  <stop offset="95%" stopColor={s.color} stopOpacity={0.05} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid {...GRID_STYLE} vertical={false} />
            <XAxis
              dataKey="hour"
              {...AXIS_PROPS}
              interval={2}
              label={{ value: 'Hour of day', position: 'insideBottom', offset: -10, style: { ...TICK_STYLE, fontSize: 8 } }}
            />
            <YAxis
              {...AXIS_PROPS}
              label={{ value: 'kWh', angle: -90, position: 'insideLeft', offset: 8, style: { ...TICK_STYLE, fontSize: 8 } }}
            />
            <Tooltip content={<CustomTooltip />} wrapperStyle={TOOLTIP_WRAPPER_STYLE} />
            <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" iconSize={7} />
            {SERIES.map(s => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stackId="a"
                stroke={s.color}
                strokeWidth={1.5}
                fill={`url(#grad-lp-${s.key})`}
                dot={false}
                activeDot={{ r: 3, stroke: s.color }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Metrics */}
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Day metrics</p>
        <div className="grid grid-cols-2 gap-2">
          <DataCard
            label="Peak demand"
            value={peakDemand.toFixed(1)}
            unit="kWh/hr"
            accent="navy"
          />
          <DataCard
            label="Average demand"
            value={avgDemand.toFixed(1)}
            unit="kWh/hr"
            accent="teal"
          />
          <DataCard
            label="Load factor"
            value={(loadFactor * 100).toFixed(0) + '%'}
            accent="gold"
          />
          <DataCard
            label="Midnight vs midday"
            value={`${midnight.toFixed(1)} / ${midday.toFixed(1)}`}
            unit="kWh"
            accent="slate"
          />
        </div>
      </div>

    </div>
  )
}
