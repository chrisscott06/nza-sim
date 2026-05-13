/**
 * HourlyProfileView.jsx — typical-day stacked-bar visualisation of
 * people / lighting / equipment gain kW for each of 24 hours.
 *
 * Brief 27 Revised Part 11. Lets the user sanity-check the schedule
 * shape and gain composition at hourly resolution. Day-type selector
 * (Weekday / Saturday / Sunday) + month selector.
 *
 * Full-width per UI principle #3 — horizontal axis carries time.
 */

import { useMemo, useState } from 'react'
import { useContext } from 'react'
import { ProjectContext } from '../../../../context/ProjectContext.jsx'
import { WeatherContext } from '../../../../context/WeatherContext.jsx'
import { GAIN_COLOURS } from '../gainColours.js'
import { computeHourlyGains, decomposeHour } from '../../../../utils/instantCalc.js'

const DAY_TYPES = [
  { key: 'weekday',  label: 'Weekday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday',   label: 'Sunday' },
]

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Average over all hours of the requested day-type in the selected month
// (or all months when month === 'all'). Returns 24 entries of
// { people, lighting, equipment } in kW.
function useHourlyDayAverage(dayType, monthFilter) {
  const { params } = useContext(ProjectContext)
  const { weatherData } = useContext(WeatherContext)

  return useMemo(() => {
    if (!params || !weatherData?.temperature?.length) return null
    const gia = (params.length || 0) * (params.width || 0) * (params.num_floors || 0)
    if (gia <= 0) return null

    const accum = new Array(24).fill(null).map(() => ({ p: 0, l: 0, e: 0, n: 0 }))
    const n = weatherData.temperature.length
    for (let h = 0; h < n; h++) {
      const { dayType: dt, hourOfDay, monthIdx } = decomposeHour(h, weatherData)
      if (dt !== dayType) continue
      if (monthFilter !== 'all' && monthIdx !== monthFilter) continue
      const g = computeHourlyGains(params, h, weatherData, gia)
      const a = accum[hourOfDay]
      a.p += g.people
      a.l += g.lighting
      a.e += g.equipment
      a.n += 1
    }
    return accum.map(a => a.n > 0 ? {
      people:    a.p / a.n / 1000,
      lighting:  a.l / a.n / 1000,
      equipment: a.e / a.n / 1000,
    } : { people: 0, lighting: 0, equipment: 0 })
  }, [params, weatherData, dayType, monthFilter])
}

export default function HourlyProfileView() {
  const [dayType, setDayType]       = useState('weekday')
  const [monthFilter, setMonthFilter] = useState('all')

  const hourly = useHourlyDayAverage(dayType, monthFilter)

  if (!hourly) {
    return (
      <div className="px-6 py-8">
        <p className="text-caption text-mid-grey">Waiting for weather + engine to compute hourly gain breakdown.</p>
      </div>
    )
  }

  const maxKW = Math.max(0.01, ...hourly.map(h => h.people + h.lighting + h.equipment))
  const dailyTotal = hourly.reduce((s, h) => s + h.people + h.lighting + h.equipment, 0)

  return (
    <div className="w-full px-6 py-5 space-y-4">
      {/* Title + controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold text-navy">Hourly gain profile</h2>
          <p className="text-xxs text-mid-grey mt-0.5">
            Stacked gain (kW) by hour for a typical day. Mean across all matching
            day-types in the selected month (or year).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {DAY_TYPES.map(d => (
              <button
                key={d.key}
                onClick={() => setDayType(d.key)}
                className={`px-2 py-0.5 text-xxs rounded border transition-colors ${
                  dayType === d.key
                    ? 'border-mid-grey bg-navy text-white'
                    : 'border-light-grey text-mid-grey hover:border-mid-grey'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <select
            value={monthFilter}
            onChange={e => setMonthFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
            className="px-2 py-0.5 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-mid-grey"
          >
            <option value="all">All months</option>
            {MONTH_LABELS.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* The grid */}
      <div className="bg-white border border-light-grey rounded p-4">
        <div className="space-y-1.5">
          {/* Bar grid */}
          <div className="relative h-56">
            <div className="absolute inset-0 flex items-end gap-px">
              {hourly.map((h, i) => {
                const total = h.people + h.lighting + h.equipment
                const tH = (total / maxKW) * 100
                const pH = (h.people    / Math.max(0.01, total)) * tH
                const lH = (h.lighting  / Math.max(0.01, total)) * tH
                const eH = (h.equipment / Math.max(0.01, total)) * tH
                return (
                  <div key={i} className="flex-1 flex flex-col-reverse h-full group relative">
                    <div style={{ height: `${pH}%`, backgroundColor: GAIN_COLOURS.occupancy, opacity: 0.9 }} />
                    <div style={{ height: `${lH}%`, backgroundColor: GAIN_COLOURS.lighting,  opacity: 0.9 }} />
                    <div style={{ height: `${eH}%`, backgroundColor: GAIN_COLOURS.equipment, opacity: 0.9 }} />
                    {/* Hover tooltip */}
                    <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2 py-1 bg-navy text-white rounded text-xxs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity tabular-nums pointer-events-none z-10">
                      <div>{String(i).padStart(2, '0')}:00 · {total.toFixed(1)} kW</div>
                      <div className="text-white/80">
                        P {h.people.toFixed(1)} · L {h.lighting.toFixed(1)} · E {h.equipment.toFixed(1)} kW
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {/* Y axis label */}
            <div className="absolute -left-6 top-0 text-xxs text-mid-grey">{maxKW.toFixed(0)} kW</div>
            <div className="absolute -left-6 bottom-0 text-xxs text-mid-grey">0</div>
          </div>
          {/* X axis */}
          <div className="flex gap-px">
            {hourly.map((_, i) => (
              <div key={i} className="flex-1 text-center text-xxs text-mid-grey">
                {i % 3 === 0 ? String(i).padStart(2, '0') : ''}
              </div>
            ))}
          </div>
        </div>

        {/* Legend + daily total */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-light-grey/60">
          <div className="flex gap-3 text-xxs">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: GAIN_COLOURS.occupancy }} />
              People
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: GAIN_COLOURS.lighting }} />
              Lighting
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: GAIN_COLOURS.equipment }} />
              Equipment
            </span>
          </div>
          <div className="text-xxs text-mid-grey tabular-nums">
            Daily total: <span className="text-navy font-medium">{dailyTotal.toFixed(1)} kWh</span>
            <span className="ml-2">peak: <span className="text-navy font-medium">{maxKW.toFixed(1)} kW</span></span>
          </div>
        </div>
      </div>
    </div>
  )
}
