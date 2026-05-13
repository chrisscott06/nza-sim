/**
 * AnnualBreakdownView.jsx — annual MWh by gain category, with monthly
 * distribution and per-profile breakdown.
 *
 * Brief 27 Revised Part 11. Pairs naturally with the Delta view: Delta
 * answers "how do gains affect demand?", Annual breakdown answers
 * "where does the gain energy come from?"
 *
 * Layout:
 *   - Top totals row: People / Lighting / Equipment annual MWh + peak kW
 *   - Monthly stacked-bar chart (12 months × 3 stacked categories)
 *   - Per-profile table for Lighting + Equipment
 */

import { useMemo } from 'react'
import { useStateComparison } from './useStateComparison.js'
import { useAnnualGains } from '../useAnnualGains.js'
import { useContext } from 'react'
import { ProjectContext } from '../../../../context/ProjectContext.jsx'
import { WeatherContext } from '../../../../context/WeatherContext.jsx'
import { GAIN_COLOURS } from '../gainColours.js'
import { computeHourlyGains } from '../../../../utils/instantCalc.js'

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function useMonthlyGains() {
  const { params } = useContext(ProjectContext)
  const { weatherData } = useContext(WeatherContext)
  return useMemo(() => {
    if (!params || !weatherData?.temperature?.length) {
      return { months: [], maxMonth: 0 }
    }
    const gia = (params.length || 0) * (params.width || 0) * (params.num_floors || 0)
    if (gia <= 0) return { months: [], maxMonth: 0 }
    const n = weatherData.temperature.length
    const monthsAcc = new Array(12).fill(null).map(() => ({ people: 0, lighting: 0, equipment: 0 }))
    for (let h = 0; h < n; h++) {
      const month = weatherData.month?.[h]
      if (!month) continue
      const m = month - 1
      const g = computeHourlyGains(params, h, weatherData, gia)
      monthsAcc[m].people    += g.people
      monthsAcc[m].lighting  += g.lighting
      monthsAcc[m].equipment += g.equipment
    }
    let maxMonth = 0
    for (const m of monthsAcc) {
      const t = m.people + m.lighting + m.equipment
      if (t > maxMonth) maxMonth = t
    }
    return { months: monthsAcc, maxMonth }
  }, [params, weatherData])
}

function StatCard({ label, accent, kwh, peakKw, profilesCount }) {
  return (
    <div className="bg-white border border-light-grey rounded p-3 border-l-4" style={{ borderLeftColor: accent }}>
      <div className="text-xxs uppercase tracking-wider text-mid-grey">{label}</div>
      <div className="text-h3 font-semibold text-navy mt-0.5 tabular-nums">
        {kwh != null ? `${(kwh / 1000).toFixed(1)} MWh` : '—'}
      </div>
      <div className="text-xxs text-mid-grey mt-0.5 tabular-nums">
        Peak {peakKw?.toFixed(1) ?? '—'} kW
        {profilesCount != null && (
          <span className="ml-2">· {profilesCount} profile{profilesCount === 1 ? '' : 's'}</span>
        )}
      </div>
    </div>
  )
}

function MonthlyStack({ months, maxMonth }) {
  if (!months.length) {
    return <p className="text-caption text-mid-grey">No monthly data yet — waiting for weather + engine.</p>
  }
  const colW = 100 / 12
  return (
    <div className="space-y-1.5">
      <div className="relative h-44">
        <div className="absolute inset-0 flex items-end gap-px">
          {months.map((m, i) => {
            const total = m.people + m.lighting + m.equipment
            const h = (total / Math.max(1, maxMonth)) * 100
            const pH = (m.people    / Math.max(1, total)) * h
            const lH = (m.lighting  / Math.max(1, total)) * h
            const eH = (m.equipment / Math.max(1, total)) * h
            return (
              <div key={i} className="flex-1 flex flex-col-reverse h-full relative group">
                <div style={{ height: `${pH}%`, backgroundColor: GAIN_COLOURS.occupancy, opacity: 0.9 }} />
                <div style={{ height: `${lH}%`, backgroundColor: GAIN_COLOURS.lighting,  opacity: 0.9 }} />
                <div style={{ height: `${eH}%`, backgroundColor: GAIN_COLOURS.equipment, opacity: 0.9 }} />
                {/* Hover tooltip */}
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2 py-1 bg-navy text-white rounded text-xxs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity tabular-nums pointer-events-none z-10">
                  <div>{MONTH_LABELS[i]}: {(total / 1000).toFixed(1)} MWh</div>
                  <div className="text-white/80">
                    P {(m.people/1000).toFixed(1)} · L {(m.lighting/1000).toFixed(1)} · E {(m.equipment/1000).toFixed(1)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex gap-px">
        {MONTH_LABELS.map((m, i) => (
          <div key={i} className="flex-1 text-center text-xxs text-mid-grey">{m}</div>
        ))}
      </div>
    </div>
  )
}

function ProfileTable({ category, profiles, accent }) {
  if (!profiles || profiles.length === 0) return null
  const total = profiles.reduce((s, p) => s + (p.kwh ?? 0), 0)
  return (
    <div className="bg-white border border-light-grey rounded p-3">
      <div className="text-xxs uppercase tracking-wider text-mid-grey mb-2">
        {category} profiles
      </div>
      <div className="space-y-1">
        {profiles.map(p => {
          const pct = total > 0 ? (p.kwh / total) * 100 : 0
          return (
            <div key={p.id} className="flex items-center gap-2 text-caption">
              <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: accent }} />
              <span className="flex-1 text-navy">{p.label}</span>
              <span className="w-20 text-right text-mid-grey tabular-nums">{(p.kwh / 1000).toFixed(1)} MWh</span>
              <span className="w-12 text-right text-mid-grey/70 tabular-nums">{pct.toFixed(0)}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function AnnualBreakdownView() {
  const annual = useAnnualGains()
  const { months, maxMonth } = useMonthlyGains()

  if (!annual.ready) {
    return (
      <div className="mx-auto px-6 py-8 max-w-[1000px]">
        <p className="text-caption text-mid-grey">Waiting for engine output…</p>
      </div>
    )
  }

  const { people, lighting, equipment } = annual

  return (
    <div className="mx-auto px-6 py-6 max-w-[1000px] space-y-5">
      <div className="pb-3 border-b border-light-grey">
        <h2 className="text-base font-semibold text-navy">Annual breakdown</h2>
        <p className="text-xxs text-mid-grey mt-0.5">
          Where the gain energy comes from. Top row: annual + peak per
          category. Below: month-by-month stacking + per-profile attribution.
        </p>
      </div>

      {/* Totals row */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="People"    accent={GAIN_COLOURS.occupancy} kwh={people.kwh}    peakKw={people.peak_kw}    profilesCount={1} />
        <StatCard label="Lighting"  accent={GAIN_COLOURS.lighting}  kwh={lighting.kwh}  peakKw={lighting.peak_kw}  profilesCount={lighting.profiles?.length} />
        <StatCard label="Equipment" accent={GAIN_COLOURS.equipment} kwh={equipment.kwh} peakKw={equipment.peak_kw} profilesCount={equipment.profiles?.length} />
      </div>

      {/* Monthly stack */}
      <div className="bg-white border border-light-grey rounded p-4">
        <div className="text-xxs uppercase tracking-wider text-mid-grey mb-3">Monthly distribution (MWh)</div>
        <MonthlyStack months={months} maxMonth={maxMonth} />
        <div className="flex gap-3 mt-3 text-xxs">
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
      </div>

      {/* Per-profile tables */}
      <div className="grid grid-cols-2 gap-3">
        <ProfileTable category="Lighting"  profiles={lighting.profiles}  accent={GAIN_COLOURS.lighting} />
        <ProfileTable category="Equipment" profiles={equipment.profiles} accent={GAIN_COLOURS.equipment} />
      </div>
    </div>
  )
}
