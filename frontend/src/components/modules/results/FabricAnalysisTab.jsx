import { useContext } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell, LabelList,
} from 'recharts'
import { SimulationContext } from '../../../context/SimulationContext.jsx'
import DataCard from '../../ui/DataCard.jsx'
import ModuleEmptyState from '../../ui/ModuleEmptyState.jsx'
import {
  TICK_STYLE, TOOLTIP_STYLE, TOOLTIP_WRAPPER_STYLE,
  GRID_STYLE, AXIS_PROPS,
} from '../../../data/chartTokens.js'
import { Layers } from 'lucide-react'

/* ── Facade colours ──────────────────────────────────────────────────────────── */
const WALL_COLORS  = { north: '#7C3AED', south: '#A78BFA', east: '#C4B5FD', west: '#DDD6FE' }
const SOLAR_COLORS = { north: '#92400E', south: '#D97706', east: '#F59E0B', west: '#FCD34D' }

function HeatLossTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const v = payload[0]?.value ?? 0
  return (
    <div style={TOOLTIP_STYLE}>
      <p className="font-medium">{label}</p>
      <p style={{ color: v >= 0 ? '#DC2626' : '#3B82F6' }}>
        {v >= 0 ? 'Net gain' : 'Net loss'}: {Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh/yr
      </p>
    </div>
  )
}

function SolarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={TOOLTIP_STYLE}>
      <p className="font-medium">{label} facade</p>
      <p style={{ color: '#D97706' }}>Solar gain: {(payload[0]?.value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh/yr</p>
    </div>
  )
}

export default function FabricAnalysisTab({ activeResults } = {}) {
  const ctx = useContext(SimulationContext)
  const status  = activeResults ? 'complete' : ctx.status
  const results = activeResults ?? ctx.results

  const ed  = results?.envelope_detailed   // rich per-facade data (Part 5+)
  const env = results?.envelope            // simple summary (always present)

  if (status !== 'complete' || (!ed && !env)) {
    return (
      <ModuleEmptyState
        icon={Layers}
        title="No results yet"
        description="Run a simulation to see the fabric heat flow analysis."
        className="p-6"
      />
    )
  }

  const FACES = ['north', 'south', 'east', 'west']

  // Build heat loss chart data
  const heatLossData = ed ? [
    ...FACES.map(f => ({
      name:  `${f.charAt(0).toUpperCase() + f.slice(1)} wall`,
      value: Math.round(ed.walls[f]?.net_kWh ?? 0),
      color: WALL_COLORS[f],
    })),
    { name: 'Roof',         value: Math.round(ed.roof?.net_kWh ?? 0),         color: '#6B7280' },
    { name: 'Ground floor', value: Math.round(ed.ground_floor?.net_kWh ?? 0), color: '#78350F' },
    { name: 'Infiltration', value: -Math.round((ed.infiltration?.annual_heat_loss_kWh ?? 0) - (ed.infiltration?.annual_heat_gain_kWh ?? 0)), color: '#9CA3AF' },
  ].filter(d => d.value !== 0).sort((a, b) => a.value - b.value)
  : [
    { name: 'Fabric conduction', value: Math.round(env?.fabric_conduction_kWh ?? 0),  color: '#7C3AED' },
    { name: 'Solar gains',       value: Math.round(env?.solar_gain_kWh ?? 0),          color: '#D97706' },
    { name: 'Infiltration loss', value: -Math.round(env?.infiltration_loss_kWh ?? 0),  color: '#9CA3AF' },
  ].filter(d => d.value !== 0).sort((a, b) => a.value - b.value)

  // Solar gains by facade
  const solarData = ed
    ? FACES.map(f => ({
        face:  f.charAt(0).toUpperCase() + f.slice(1),
        value: Math.round(ed.glazing[f]?.solar_gain_kWh ?? 0),
        color: SOLAR_COLORS[f],
      }))
    : []

  // Summary values
  const summary = ed?.summary ?? {}
  const totalSolar       = summary.total_solar_gain_kWh   ?? (env?.solar_gain_kWh         ?? 0)
  const totalFabricLoss  = summary.total_fabric_loss_kWh  ?? (Math.abs(env?.fabric_conduction_kWh ?? 0))
  const totalInfilLoss   = ed?.infiltration?.annual_heat_loss_kWh ?? (env?.infiltration_loss_kWh ?? 0)
  const netBalance       = summary.net_balance_kWh ?? (totalSolar - totalFabricLoss - totalInfilLoss)
  const bestSolarFace    = ed ? FACES.reduce((best, f) => (ed.glazing[f]?.solar_gain_kWh ?? 0) > (ed.glazing[best]?.solar_gain_kWh ?? 0) ? f : best, 'south') : 'south'

  return (
    <div className="p-4 space-y-4">

      {/* Summary DataCards */}
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Annual envelope summary</p>
        <div className="grid grid-cols-2 gap-2">
          <DataCard label="Total solar gains"   value={Math.round(totalSolar).toLocaleString()}      unit="kWh/yr" accent="gold"         />
          <DataCard label="Fabric heat loss"    value={Math.round(totalFabricLoss).toLocaleString()}  unit="kWh/yr" accent="heating-red"  />
          <DataCard label="Infiltration loss"   value={Math.round(totalInfilLoss).toLocaleString()}   unit="kWh/yr" accent="cooling-blue" />
          <DataCard label="Net balance"         value={(netBalance >= 0 ? '+' : '') + Math.round(netBalance).toLocaleString()} unit="kWh/yr" accent={netBalance >= 0 ? 'green' : 'heating-red'} />
        </div>
      </div>

      {/* Heat flow chart */}
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">
          Net heat flows by element {!ed ? '(run a new simulation for per-facade detail)' : ''}
        </p>
        <div className="bg-white rounded-lg border border-light-grey p-3">
          <ResponsiveContainer width="100%" height={Math.max(180, heatLossData.length * 30)}>
            <BarChart
              layout="vertical"
              data={heatLossData}
              margin={{ top: 4, right: 48, left: 4, bottom: 0 }}
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
                width={90}
                tick={{ ...TICK_STYLE, fontSize: 9 }}
              />
              <Tooltip content={<HeatLossTooltip />} wrapperStyle={TOOLTIP_WRAPPER_STYLE} />
              <ReferenceLine x={0} stroke="#95A5A6" strokeWidth={1} />
              <Bar dataKey="value" name="Net heat flow" radius={[0, 3, 3, 0]}>
                {heatLossData.map((entry, i) => (
                  <Cell key={i} fill={entry.color + '44'} stroke={entry.color} strokeWidth={1.5} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xxs text-mid-grey mt-1">Positive = net heat gain · Negative = net heat loss</p>
      </div>

      {/* Solar gains by facade (only when detailed data available) */}
      {solarData.length > 0 && (
        <div>
          <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Solar gains by facade</p>
          <div className="bg-white rounded-lg border border-light-grey p-3">
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={solarData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID_STYLE} vertical={false} />
                <XAxis dataKey="face" {...AXIS_PROPS} />
                <YAxis
                  {...AXIS_PROPS}
                  tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                  label={{ value: 'kWh/yr', angle: -90, position: 'insideLeft', offset: 8, style: { ...TICK_STYLE, fontSize: 8 } }}
                />
                <Tooltip content={<SolarTooltip />} wrapperStyle={TOOLTIP_WRAPPER_STYLE} />
                <Bar dataKey="value" name="Solar gain" radius={[3, 3, 0, 0]}>
                  {solarData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xxs text-mid-grey mt-1">
            Best solar facade: <span className="font-medium text-navy">{bestSolarFace.charAt(0).toUpperCase() + bestSolarFace.slice(1)}</span>{' '}
            ({Math.round(ed?.glazing[bestSolarFace]?.solar_gain_kWh ?? 0).toLocaleString()} kWh/yr)
          </p>
        </div>
      )}

    </div>
  )
}
