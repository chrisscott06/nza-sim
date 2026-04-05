/**
 * MonthlyComparisonChart.jsx
 *
 * Monthly actual consumption bars with CRREM annual EUI target line.
 * Shows actual EUI, CRREM target for current year, and performance gap.
 *
 * Props:
 *   monthly   — array of { month: 'YYYY-MM', kwh: number } from API
 *   fuelType  — 'electricity' | 'gas'
 *   gia       — gross internal area (m²) for EUI calculation
 */

import { useMemo } from 'react'
import {
  ComposedChart,
  Bar,
  ReferenceLine,
  XAxis, YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { CheckCircle2, AlertTriangle, AlertOctagon } from 'lucide-react'

// ── CRREM 1.5°C pathway — UK Hotel EUI targets (CRREM V2.07, real values) ─────
const CRREM_EUI = {
  2020: 264.0, 2021: 248.6, 2022: 234.1, 2023: 220.4, 2024: 207.6,
  2025: 195.5, 2026: 184.1, 2027: 173.3, 2028: 163.2, 2029: 153.7,
  2030: 144.7, 2031: 136.3, 2032: 128.3, 2033: 120.8, 2034: 113.8,
  2035: 107.1, 2036: 100.9,
  // Plateau at 95 from 2037 — grid decarbonisation means no further EUI reduction needed
  2037:  95.0, 2038:  95.0, 2039:  95.0, 2040:  95.0, 2041:  95.0,
  2042:  95.0, 2043:  95.0, 2044:  95.0, 2045:  95.0, 2046:  95.0,
  2047:  95.0, 2048:  95.0, 2049:  95.0, 2050:  95.0,
}

function crremTarget(year) {
  if (year in CRREM_EUI) return CRREM_EUI[year]
  // Linear interpolation between nearest known years
  const years = Object.keys(CRREM_EUI).map(Number).sort((a, b) => a - b)
  const lo = Math.max(...years.filter(y => y <= year))
  const hi = Math.min(...years.filter(y => y >= year))
  if (lo === hi) return CRREM_EUI[lo]
  const t = (year - lo) / (hi - lo)
  return CRREM_EUI[lo] + t * (CRREM_EUI[hi] - CRREM_EUI[lo])
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function MonthlyComparisonChart({ monthly = [], fuelType = 'electricity', gia = 0 }) {
  const isElec  = fuelType === 'electricity'
  const barColor = isElec ? '#CA8A04' : '#DC2626'

  // ── Build chart data ──────────────────────────────────────────────────────
  const { chartData, totalKwh, yearForCrrem } = useMemo(() => {
    if (!monthly.length) return { chartData: [], totalKwh: 0, yearForCrrem: new Date().getFullYear() }

    // Determine dominant year (most common YYYY in month strings)
    const yearCounts = {}
    for (const row of monthly) {
      const yr = row.month?.slice(0, 4)
      if (yr) yearCounts[yr] = (yearCounts[yr] ?? 0) + 1
    }
    const yr = Number(Object.keys(yearCounts).sort((a, b) => yearCounts[b] - yearCounts[a])[0])

    let total = 0
    const rows = monthly.map(row => {
      const mo = Number(row.month?.slice(5, 7)) - 1
      total += row.kwh ?? 0
      return {
        name: MONTH_ABBR[mo] ?? row.month,
        kwh:  Math.round(row.kwh ?? 0),
      }
    })

    return { chartData: rows, totalKwh: total, yearForCrrem: yr || new Date().getFullYear() }
  }, [monthly])

  // ── EUI calculations ──────────────────────────────────────────────────────
  const actualEui  = gia > 0 ? Math.round(totalKwh / gia) : null
  const targetEui  = Math.round(crremTarget(yearForCrrem))
  const gap        = actualEui != null ? actualEui - targetEui : null
  const gapPct     = actualEui && targetEui ? Math.round((gap / targetEui) * 100) : null

  // CRREM threshold line value in kWh for the chart (target EUI × GIA / 12 months avg)
  // We draw it as a horizontal reference line at that monthly kWh value
  const monthlyTargetKwh = gia > 0 && targetEui ? Math.round((targetEui * gia) / 12) : null

  const status = gap == null ? null
    : gap <= 0             ? 'compliant'
    : gapPct <= 20         ? 'at-risk'
    :                        'non-compliant'

  const statusConfig = {
    compliant:      { icon: CheckCircle2,  color: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0', label: 'Compliant' },
    'at-risk':      { icon: AlertTriangle,  color: '#D97706', bg: '#FFFBEB', border: '#FDE68A', label: 'At risk' },
    'non-compliant':{ icon: AlertOctagon,   color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', label: 'Non-compliant' },
  }
  const sc = status ? statusConfig[status] : null

  if (!chartData.length) {
    return (
      <div className="flex items-center justify-center h-40 text-xxs text-mid-grey">
        No monthly data to display.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Status banner */}
      {sc && actualEui != null && (
        <div
          className="flex items-center justify-between px-3 py-2 rounded-lg border"
          style={{ backgroundColor: sc.bg, borderColor: sc.border }}
        >
          <div className="flex items-center gap-2">
            <sc.icon size={14} style={{ color: sc.color }} />
            <div>
              <span className="text-xxs font-semibold" style={{ color: sc.color }}>{sc.label}</span>
              {gap != null && (
                <span className="text-xxs ml-2" style={{ color: sc.color }}>
                  {gap > 0 ? `${gap} kWh/m² above` : `${Math.abs(gap)} kWh/m² below`} CRREM {yearForCrrem} target
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 text-right">
            <div>
              <p className="text-xxs text-mid-grey">Actual EUI</p>
              <p className="text-xs font-bold tabular-nums" style={{ color: sc.color }}>{actualEui} kWh/m²</p>
            </div>
            <div>
              <p className="text-xxs text-mid-grey">CRREM target</p>
              <p className="text-xs font-bold tabular-nums text-navy">{targetEui} kWh/m²</p>
            </div>
            {gapPct != null && (
              <div>
                <p className="text-xxs text-mid-grey">Gap</p>
                <p className="text-xs font-bold tabular-nums" style={{ color: sc.color }}>
                  {gap > 0 ? '+' : ''}{gapPct}%
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="bg-light-grey/15 rounded-lg p-3">
        <p className="text-xxs font-semibold text-mid-grey uppercase tracking-wide mb-2">
          Monthly consumption — {yearForCrrem}
          {gia > 0 && <span className="font-normal ml-1">(GIA {Math.round(gia).toLocaleString()} m²)</span>}
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E6E6E6" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 9, fill: '#95A5A6' }}
              axisLine={false}
              tickLine={false}
            />
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
                name === 'kwh' ? `${value.toLocaleString()} kWh` : `${value.toLocaleString()} kWh (avg monthly target)`,
                name === 'kwh' ? (isElec ? 'Electricity' : 'Gas') : 'CRREM target',
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: 9, color: '#95A5A6', paddingTop: 4 }}
              formatter={(value) => value === 'kwh' ? (isElec ? 'Electricity (kWh)' : 'Gas (kWh)') : 'CRREM monthly avg target'}
            />

            <Bar dataKey="kwh" fill={barColor} radius={[2, 2, 0, 0]} opacity={0.85} />

            {/* CRREM average monthly target line */}
            {monthlyTargetKwh && (
              <ReferenceLine
                y={monthlyTargetKwh}
                stroke="#2B2A4C"
                strokeDasharray="5 3"
                strokeWidth={1.5}
                label={{ value: `CRREM ${yearForCrrem}`, position: 'insideTopRight', fontSize: 9, fill: '#2B2A4C', dy: -4 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Footer note */}
      {!gia && (
        <p className="text-xxs text-mid-grey/70 text-center">
          Set GIA in Building module to calculate EUI and CRREM comparison.
        </p>
      )}
    </div>
  )
}
