import { useContext } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts'
import { SimulationContext } from '../../../context/SimulationContext.jsx'
import ModuleEmptyState from '../../ui/ModuleEmptyState.jsx'
import {
  TICK_STYLE, TOOLTIP_STYLE, TOOLTIP_WRAPPER_STYLE,
  GRID_STYLE, AXIS_PROPS,
} from '../../../data/chartTokens.js'
import { Layers } from 'lucide-react'

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const v = payload[0]?.value ?? 0
  return (
    <div style={TOOLTIP_STYLE}>
      <p className="font-medium mb-1">{label}</p>
      <p style={{ color: v >= 0 ? '#DC2626' : '#3B82F6' }}>
        {v >= 0 ? 'Heat gain' : 'Heat loss'}: {Math.abs(v).toFixed(0)} kWh/yr
      </p>
    </div>
  )
}

export default function FabricAnalysisTab() {
  const { status, results } = useContext(SimulationContext)

  if (status !== 'complete' || !results?.envelope_heat_flow?.length) {
    return (
      <ModuleEmptyState
        icon={Layers}
        title="No results yet"
        description="Run a simulation to see the fabric heat flow analysis."
        className="p-6"
      />
    )
  }

  // Sort by absolute heat flow descending for visual impact
  const raw = [...results.envelope_heat_flow]
    .sort((a, b) => Math.abs(b.net_heat_flow_kWh) - Math.abs(a.net_heat_flow_kWh))
    .slice(0, 20) // show top 20 surfaces

  const chartData = raw.map(r => ({
    name: (r.surface_name ?? 'Unknown').replace(/_/g, ' '),
    value: Math.round(r.net_heat_flow_kWh ?? 0),
    type: r.surface_type ?? '',
  }))

  // Total gains vs losses
  const gains  = chartData.filter(d => d.value >  0).reduce((s, d) => s + d.value, 0)
  const losses = chartData.filter(d => d.value <= 0).reduce((s, d) => s + d.value, 0)

  return (
    <div className="p-4 space-y-4">

      {/* Summary */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white rounded border border-light-grey px-3 py-2" style={{ borderLeft: '3px solid #DC2626' }}>
          <p className="text-metric text-navy font-medium">
            +{gains >= 1000 ? `${(gains / 1000).toFixed(1)}k` : gains.toLocaleString()}
          </p>
          <p className="text-xxs text-mid-grey mt-0.5 uppercase tracking-wider">Solar / conduction gains kWh</p>
        </div>
        <div className="bg-white rounded border border-light-grey px-3 py-2" style={{ borderLeft: '3px solid #3B82F6' }}>
          <p className="text-metric text-navy font-medium">
            {losses >= -1000
              ? losses.toLocaleString()
              : `${(losses / 1000).toFixed(1)}k`}
          </p>
          <p className="text-xxs text-mid-grey mt-0.5 uppercase tracking-wider">Fabric heat losses kWh</p>
        </div>
      </div>

      {/* Horizontal bar chart */}
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">
          Heat flow by surface — top {chartData.length} (kWh/yr)
        </p>
        <div className="bg-white rounded-lg border border-light-grey p-3">
          <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 22)}>
            <BarChart
              layout="vertical"
              data={chartData}
              margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
            >
              <CartesianGrid {...GRID_STYLE} horizontal={false} />
              <XAxis
                type="number"
                {...AXIS_PROPS}
                tickFormatter={v => v >= 1000 || v <= -1000 ? `${(v / 1000).toFixed(0)}k` : v}
                label={{ value: 'kWh/yr', position: 'insideBottom', offset: -2, style: { ...TICK_STYLE, fontSize: 8 } }}
              />
              <YAxis
                type="category"
                dataKey="name"
                {...AXIS_PROPS}
                width={110}
                tick={{ ...TICK_STYLE, fontSize: 8 }}
              />
              <Tooltip content={<CustomTooltip />} wrapperStyle={TOOLTIP_WRAPPER_STYLE} />
              <ReferenceLine x={0} stroke="#95A5A6" strokeWidth={1} />
              <Bar dataKey="value" name="Net heat flow" radius={[0, 2, 2, 0]}>
                {chartData.map((entry, index) => (
                  <Cell
                    key={index}
                    fill={entry.value >= 0 ? '#DC262655' : '#3B82F655'}
                    stroke={entry.value >= 0 ? '#DC2626' : '#3B82F6'}
                    strokeWidth={1}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xxs text-mid-grey mt-1">
          Red = net heat gain into zone · Blue = net heat loss from zone
        </p>
      </div>
    </div>
  )
}
