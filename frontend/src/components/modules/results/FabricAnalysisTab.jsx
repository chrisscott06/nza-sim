import { useContext } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts'
import { SimulationContext } from '../../../context/SimulationContext.jsx'
import DataCard from '../../ui/DataCard.jsx'
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
        {v >= 0 ? 'Net gain' : 'Net loss'}: {Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh/yr
      </p>
    </div>
  )
}

export default function FabricAnalysisTab() {
  const { status, results } = useContext(SimulationContext)

  // API returns results.envelope: { fabric_conduction_kWh, infiltration_loss_kWh,
  //   infiltration_gain_kWh, solar_gain_kWh }
  const envelope = results?.envelope

  if (status !== 'complete' || !envelope) {
    return (
      <ModuleEmptyState
        icon={Layers}
        title="No results yet"
        description="Run a simulation to see the fabric heat flow analysis."
        className="p-6"
      />
    )
  }

  const fabricConduction  = envelope.fabric_conduction_kWh  ?? 0
  const infiltrationLoss  = envelope.infiltration_loss_kWh  ?? 0
  const infiltrationGain  = envelope.infiltration_gain_kWh  ?? 0
  const solarGain         = envelope.solar_gain_kWh         ?? 0

  // Build chart data — net flows (negative = loss, positive = gain)
  const chartData = [
    { name: 'Solar gains',         value: Math.round(solarGain),        type: 'gain'   },
    { name: 'Infil. gain',         value: Math.round(infiltrationGain), type: 'gain'   },
    { name: 'Fabric conduction',   value: Math.round(fabricConduction), type: fabricConduction >= 0 ? 'gain' : 'loss' },
    { name: 'Infil. heat loss',    value: -Math.round(infiltrationLoss), type: 'loss'  },
  ].filter(d => d.value !== 0)
   .sort((a, b) => b.value - a.value)

  const totalGains  = chartData.filter(d => d.value > 0).reduce((s, d) => s + d.value, 0)
  const totalLosses = Math.abs(chartData.filter(d => d.value < 0).reduce((s, d) => s + d.value, 0))
  const netBalance  = totalGains - totalLosses

  return (
    <div className="p-4 space-y-4">

      {/* Summary DataCards */}
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Envelope summary</p>
        <div className="grid grid-cols-2 gap-2">
          <DataCard label="Solar gains"       value={Math.round(solarGain).toLocaleString()}        unit="kWh/yr" accent="gold"         />
          <DataCard label="Infiltration loss" value={Math.round(infiltrationLoss).toLocaleString()}  unit="kWh/yr" accent="cooling-blue" />
          <DataCard label="Fabric conduction" value={Math.round(Math.abs(fabricConduction)).toLocaleString()} unit="kWh/yr" accent={fabricConduction < 0 ? 'heating-red' : 'green'} />
          <DataCard label="Net balance"       value={(netBalance >= 0 ? '+' : '') + Math.round(netBalance).toLocaleString()} unit="kWh/yr" accent={netBalance >= 0 ? 'green' : 'heating-red'} />
        </div>
      </div>

      {/* Bar chart — net heat flows */}
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">
          Annual net heat flows (positive = gains into building)
        </p>
        <div className="bg-white rounded-lg border border-light-grey p-3">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              layout="vertical"
              data={chartData}
              margin={{ top: 4, right: 24, left: 4, bottom: 0 }}
            >
              <CartesianGrid {...GRID_STYLE} horizontal={false} />
              <XAxis
                type="number"
                {...AXIS_PROPS}
                tickFormatter={v => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                label={{ value: 'kWh/yr', position: 'insideBottom', offset: -2, style: { ...TICK_STYLE, fontSize: 8 } }}
              />
              <YAxis
                type="category"
                dataKey="name"
                {...AXIS_PROPS}
                width={120}
                tick={{ ...TICK_STYLE, fontSize: 9 }}
              />
              <Tooltip content={<CustomTooltip />} wrapperStyle={TOOLTIP_WRAPPER_STYLE} />
              <ReferenceLine x={0} stroke="#95A5A6" strokeWidth={1} />
              <Bar dataKey="value" name="Net heat flow" radius={[0, 3, 3, 0]}>
                {chartData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.value >= 0 ? '#DC262633' : '#3B82F633'}
                    stroke={entry.value >= 0 ? '#DC2626' : '#3B82F6'}
                    strokeWidth={1.5}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xxs text-mid-grey mt-1">
          Red bars = heat gain into building · Blue bars = heat loss from building
        </p>
      </div>

      {/* Physical interpretation */}
      <div className="bg-white rounded-lg border border-light-grey p-3 space-y-1">
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">Interpretation</p>
        <p className="text-caption text-dark-grey">
          Solar gains ({Math.round(solarGain).toLocaleString()} kWh/yr) offset{' '}
          {solarGain > 0 && infiltrationLoss > 0 ? `${Math.round((solarGain / infiltrationLoss) * 100)}%` : '—'}{' '}
          of infiltration heat loss.
        </p>
        {fabricConduction < 0 && (
          <p className="text-caption text-dark-grey">
            Fabric conduction is net negative ({Math.round(Math.abs(fabricConduction)).toLocaleString()} kWh/yr loss) — building loses more heat through the envelope than it gains.
          </p>
        )}
        <p className="text-xxs text-mid-grey mt-2">
          Per-facade breakdown (north/south/east/west) will be available in a future update.
        </p>
      </div>

    </div>
  )
}
