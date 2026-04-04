/**
 * ModelComparisonChart.jsx
 *
 * Overlays actual metered monthly consumption (solid bars) against the
 * modelled monthly energy demand (outline bars).
 * Shows the performance gap and informational breakdown panel.
 *
 * Props:
 *   monthly      — array of { month: 'YYYY-MM', kwh: number } from API (actual)
 *   fuelType     — 'electricity' | 'gas'
 *   gia          — gross internal area (m²)
 *   instantResult — result from calculateInstant (has monthly.heating_kWh etc.)
 *   simResult    — latest EnergyPlus result (has monthly_energy)
 */

import { useMemo } from 'react'
import {
  ComposedChart,
  Bar,
  XAxis, YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function ModelComparisonChart({
  monthly = [],
  fuelType = 'electricity',
  gia = 0,
  instantResult = null,
  simResult = null,
}) {
  const isElec    = fuelType === 'electricity'
  const actualColor  = isElec ? '#CA8A04' : '#DC2626'

  // ── Build chart data ──────────────────────────────────────────────────────
  const { chartData, totalActual, totalModelled } = useMemo(() => {
    // Get modelled monthly values — prefer EnergyPlus, fall back to instant calc
    let modelledMonthly = null

    if (simResult?.monthly_energy) {
      // EnergyPlus monthly_energy is keyed by end-use; sum total delivered energy
      const me = typeof simResult.monthly_energy === 'string'
        ? JSON.parse(simResult.monthly_energy)
        : simResult.monthly_energy
      if (Array.isArray(me)) {
        // Array of 12 objects or numbers
        modelledMonthly = me.map(m => (typeof m === 'number' ? m : (m?.total ?? 0)))
      } else if (me && typeof me === 'object') {
        // Could be keyed by month name
        modelledMonthly = MONTH_ABBR.map(m => me[m] ?? me[m.toLowerCase()] ?? 0)
      }
    }

    if (!modelledMonthly && instantResult?.monthly) {
      // Sum heating + cooling + DHW from instant calc monthly arrays
      const { heating_kWh = [], cooling_kWh = [], dhw_kWh = [] } = instantResult.monthly
      modelledMonthly = MONTH_ABBR.map((_, i) => (heating_kWh[i] ?? 0) + (cooling_kWh[i] ?? 0) + (dhw_kWh?.[i] ?? 0))
    }

    // Build chart rows from actual data
    let totalActual = 0
    let totalModelled = 0
    const rows = MONTH_ABBR.map((label, i) => {
      const row  = monthly.find(d => Number(d.month?.slice(5, 7)) === i + 1)
      const act  = Math.round(row?.kwh ?? 0)
      const mod  = modelledMonthly ? Math.round(modelledMonthly[i] ?? 0) : null
      totalActual   += act
      if (mod != null) totalModelled += mod
      return { name: label, actual: act, modelled: mod }
    })

    return { chartData: rows, totalActual, totalModelled }
  }, [monthly, simResult, instantResult])

  const actualEui   = gia > 0 ? Math.round(totalActual   / gia) : null
  const modelledEui = gia > 0 && totalModelled > 0 ? Math.round(totalModelled / gia) : null
  const gapKwh      = totalModelled > 0 ? totalActual - totalModelled : null
  const gapPct      = totalModelled > 0 ? Math.round((gapKwh / totalModelled) * 100) : null

  const hasModel = chartData.some(r => r.modelled != null && r.modelled > 0)

  return (
    <div className="flex flex-col gap-4">
      {/* Gap summary */}
      {hasModel && gapPct != null && (
        <div className="grid grid-cols-3 gap-2">
          <GapCard label="Actual"   value={actualEui != null ? `${actualEui} kWh/m²` : `${Math.round(totalActual / 1000)} MWh`} color={actualColor} />
          <GapCard label="Modelled" value={modelledEui != null ? `${modelledEui} kWh/m²` : `${Math.round(totalModelled / 1000)} MWh`} color="#2B2A4C" />
          <GapCard
            label="Performance gap"
            value={`${gapPct > 0 ? '+' : ''}${gapPct}%`}
            color={gapPct > 50 ? '#DC2626' : gapPct > 20 ? '#D97706' : '#16A34A'}
            sub={gapKwh != null ? `${Math.round(gapKwh / 1000)} MWh above modelled` : null}
          />
        </div>
      )}

      {!hasModel && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xxs text-amber-700">
          No model data available. Run a simulation or ensure the instant calc is receiving weather data.
        </div>
      )}

      {/* Chart */}
      <div className="bg-light-grey/15 rounded-lg p-3">
        <p className="text-xxs font-semibold text-mid-grey uppercase tracking-wide mb-2">
          Actual vs modelled monthly energy
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E6E6E6" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#95A5A6' }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 9, fill: '#95A5A6' }}
              axisLine={false}
              tickLine={false}
              width={48}
              tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
            />
            <Tooltip
              contentStyle={{ fontSize: 10, padding: '4px 8px', border: '1px solid #E6E6E6', borderRadius: 4, background: '#fff' }}
              formatter={(value, name) => [
                `${value.toLocaleString()} kWh`,
                name === 'actual' ? (isElec ? 'Actual electricity' : 'Actual gas') : 'Modelled energy',
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 9, color: '#95A5A6', paddingTop: 4 }} />
            {/* Actual: solid fill */}
            <Bar dataKey="actual"   fill={actualColor}  radius={[2, 2, 0, 0]} opacity={0.8} name={isElec ? 'Actual electricity' : 'Actual gas'} />
            {/* Modelled: outline only */}
            {hasModel && (
              <Bar dataKey="modelled" fill="transparent" stroke="#2B2A4C" strokeWidth={1.5} radius={[2, 2, 0, 0]} name="Modelled energy" />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Explanatory panel */}
      {hasModel && gapPct != null && gapPct > 10 && (
        <div className="flex flex-col gap-2">
          <p className="text-xxs font-semibold text-mid-grey uppercase tracking-wide">Possible explanations for the gap</p>
          <div className="flex flex-col gap-1.5">
            {[
              { title: 'Higher occupancy density',    desc: 'Model assumes standard hotel occupancy — actual building may operate at higher density' },
              { title: 'System degradation',          desc: 'Model assumes design efficiencies — real COPs and boiler efficiencies may be lower' },
              { title: 'Unmetered loads',             desc: 'Model excludes lifts, kitchen equipment, laundry, vending machines, and IT loads' },
              { title: 'Extended operating hours',    desc: 'Model assumes scheduled operating hours — actual building may run 24/7' },
              { title: 'Controls and commissioning',  desc: 'Simultaneous heating and cooling, poor BMS settings, or lack of seasonal changeover' },
            ].map(({ title, desc }) => (
              <div key={title} className="flex gap-2 p-2 bg-light-grey/30 rounded">
                <span className="w-1 h-1 rounded-full bg-mid-grey flex-shrink-0 mt-1.5" />
                <div>
                  <p className="text-xxs font-medium text-navy">{title}</p>
                  <p className="text-xxs text-mid-grey mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xxs text-mid-grey/60 mt-1">
            Brief 16 will make these factors interactive — adjust reality factors to close the gap.
          </p>
        </div>
      )}
    </div>
  )
}

function GapCard({ label, value, color, sub }) {
  return (
    <div className="bg-light-grey/30 rounded p-2.5">
      <p className="text-xxs text-mid-grey">{label}</p>
      <p className="text-xs font-bold tabular-nums mt-0.5" style={{ color }}>{value}</p>
      {sub && <p className="text-xxs text-mid-grey/70 mt-0.5">{sub}</p>}
    </div>
  )
}
