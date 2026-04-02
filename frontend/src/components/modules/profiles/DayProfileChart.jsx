/**
 * DayProfileChart.jsx
 *
 * Recharts AreaChart showing weekday / saturday / sunday 24-hour profiles.
 * Below the chart: monthly multipliers as a mini bar chart.
 */

import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'

const HOUR_LABELS = [
  '00','01','02','03','04','05','06','07','08','09','10','11',
  '12','13','14','15','16','17','18','19','20','21','22','23',
]

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const DAY_COLOURS = {
  weekday:  '#2B2A4C',
  saturday: '#0D9488',
  sunday:   '#9B6DFF',
}

function yLabel(scheduleType) {
  if (scheduleType === 'heating_setpoint' || scheduleType === 'cooling_setpoint') return '°C'
  return 'Fraction'
}

export default function DayProfileChart({ schedule }) {
  if (!schedule) return null

  const cfg    = schedule.config_json ?? {}
  const days   = cfg.day_types ?? {}
  const months = cfg.monthly_multipliers ?? []
  const type   = cfg.schedule_type ?? ''

  // Build 24-row data for the area chart
  const hourlyData = HOUR_LABELS.map((h, i) => ({
    hour:     h,
    weekday:  days.weekday?.[i]  ?? null,
    saturday: days.saturday?.[i] ?? null,
    sunday:   days.sunday?.[i]   ?? null,
  }))

  // Monthly data
  const monthlyData = MONTH_LABELS.map((m, i) => ({
    month: m,
    value: months[i] ?? 1,
  }))

  const yDomain = (type === 'heating_setpoint' || type === 'cooling_setpoint')
    ? ['auto', 'auto']
    : [0, 1]

  const availableDays = Object.keys(days)

  return (
    <div className="space-y-6">
      {/* 24-hour profile */}
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-3">24-Hour Profile</p>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={hourlyData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <defs>
              {availableDays.map(day => (
                <linearGradient key={day} id={`grad-${day}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={DAY_COLOURS[day]} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={DAY_COLOURS[day]} stopOpacity={0.03} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#E8ECEF" />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 10, fill: '#95A5A6' }}
              tickLine={false}
              interval={3}
            />
            <YAxis
              domain={yDomain}
              tick={{ fontSize: 10, fill: '#95A5A6' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => Number(v).toFixed(1)}
              label={{ value: yLabel(type), angle: -90, position: 'insideLeft', offset: 12, fontSize: 9, fill: '#95A5A6' }}
            />
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #E8ECEF', background: '#fff' }}
              formatter={(v, name) => [Number(v).toFixed(2), name]}
              labelFormatter={h => `Hour ${h}:00`}
            />
            <Legend
              iconSize={10}
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              formatter={name => name.charAt(0).toUpperCase() + name.slice(1)}
            />
            {availableDays.map(day => (
              <Area
                key={day}
                type="monotone"
                dataKey={day}
                stroke={DAY_COLOURS[day]}
                strokeWidth={1.8}
                fill={`url(#grad-${day})`}
                dot={false}
                activeDot={{ r: 3 }}
                connectNulls
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Monthly multipliers */}
      {monthlyData.length > 0 && (
        <div>
          <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Monthly Multipliers</p>
          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={monthlyData} margin={{ top: 0, right: 8, left: -10, bottom: 0 }}>
              <XAxis
                dataKey="month"
                tick={{ fontSize: 9, fill: '#95A5A6' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={[0, 'auto']}
                tick={{ fontSize: 9, fill: '#95A5A6' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => v.toFixed(1)}
                width={28}
              />
              <Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #E8ECEF' }}
                formatter={v => [Number(v).toFixed(2), 'Multiplier']}
              />
              <Bar dataKey="value" fill="#2B2A4C" opacity={0.75} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
