import { useContext } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import { SimulationContext } from '../../../context/SimulationContext.jsx'
import ModuleEmptyState from '../../ui/ModuleEmptyState.jsx'
import {
  TICK_STYLE, TOOLTIP_STYLE, TOOLTIP_WRAPPER_STYLE, LEGEND_STYLE,
  GRID_STYLE, AXIS_PROPS,
} from '../../../data/chartTokens.js'
import { BarChart3 } from 'lucide-react'

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

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
        <p key={p.dataKey} style={{ color: p.fill }}>
          {p.name}: {p.value?.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh
        </p>
      ))}
      <p className="border-t border-light-grey mt-1 pt-1 font-medium text-navy">
        Total: {total.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh
      </p>
    </div>
  )
}

export default function EnergyBalanceTab({ activeResults } = {}) {
  const ctx = useContext(SimulationContext)
  const status  = activeResults ? 'complete' : ctx.status
  const results = activeResults ?? ctx.results

  // API returns monthly_energy as a dict of 12-value arrays:
  // { heating_kWh: [jan, feb, ...], cooling_kWh: [...], ... }
  const me = results?.monthly_energy

  if (status !== 'complete' || !me) {
    return (
      <ModuleEmptyState
        icon={BarChart3}
        title="No results yet"
        description="Run a simulation to see the monthly energy balance."
        className="p-6"
      />
    )
  }

  // Transform dict of arrays → array of month objects
  const chartData = MONTH_LABELS.map((month, i) => ({
    month,
    heating_kWh:   Math.round(me.heating_kWh?.[i]   ?? 0),
    cooling_kWh:   Math.round(me.cooling_kWh?.[i]   ?? 0),
    lighting_kWh:  Math.round(me.lighting_kWh?.[i]  ?? 0),
    equipment_kWh: Math.round(me.equipment_kWh?.[i] ?? 0),
  }))

  // Annual totals
  const totals = SERIES.map(s => ({
    label: s.label,
    color: s.color,
    total: chartData.reduce((sum, r) => sum + (r[s.key] ?? 0), 0),
  }))

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-3">Monthly energy by end-use</p>
        <div className="bg-white rounded-lg border border-light-grey p-3">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID_STYLE} vertical={false} />
              <XAxis dataKey="month" {...AXIS_PROPS} />
              <YAxis
                {...AXIS_PROPS}
                tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                label={{
                  value: 'kWh',
                  angle: -90,
                  position: 'insideLeft',
                  offset: 8,
                  style: { ...TICK_STYLE, fontSize: 8 },
                }}
              />
              <Tooltip content={<CustomTooltip />} wrapperStyle={TOOLTIP_WRAPPER_STYLE} />
              <Legend wrapperStyle={LEGEND_STYLE} iconType="square" iconSize={8} />
              {SERIES.map(s => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stackId="a"
                  fill={s.color}
                  radius={s.key === 'equipment_kWh' ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Annual totals */}
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Annual totals</p>
        <div className="grid grid-cols-2 gap-2">
          {totals.map(t => (
            <div
              key={t.label}
              className="bg-white rounded border border-light-grey px-3 py-2"
              style={{ borderLeft: `3px solid ${t.color}` }}
            >
              <p className="text-metric text-navy font-medium leading-none">
                {t.total >= 1000
                  ? `${(t.total / 1000).toFixed(1)}k`
                  : t.total.toLocaleString()}
              </p>
              <p className="text-xxs text-mid-grey mt-0.5">
                <span className="uppercase tracking-wider">{t.label}</span>
                <span className="ml-1">kWh/yr</span>
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
