/**
 * ProfilesLiveResults.jsx
 *
 * Right column of the Profiles module three-column layout.
 * Shows schedule statistics and 24-hour profile chart for the selected schedule.
 */

import { useState, useMemo } from 'react'

const TYPE_COLOR = {
  occupancy:         '#3B82F6',
  lighting:          '#F59E0B',
  equipment:         '#8B5CF6',
  heating_setpoint:  '#DC2626',
  cooling_setpoint:  '#06B6D4',
  dhw:               '#F97316',
}

const DAY_TABS = [
  { id: 'weekday',  label: 'Weekday' },
  { id: 'saturday', label: 'Sat' },
  { id: 'sunday',   label: 'Sun' },
]

// ── Mini 24-hour bar chart ────────────────────────────────────────────────────

function HourlyBars({ values, color }) {
  if (!values || values.length === 0) return null
  const max = Math.max(...values, 0.01)

  return (
    <div className="flex items-end gap-px h-16">
      {values.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-t transition-all duration-100"
          style={{
            height: `${Math.max(4, (v / max) * 100)}%`,
            backgroundColor: color ?? '#8B5CF6',
            opacity: 0.7 + (v / max) * 0.3,
          }}
          title={`${i}:00 — ${(v * 100).toFixed(0)}%`}
        />
      ))}
    </div>
  )
}

// ── Metric row ────────────────────────────────────────────────────────────────

function Metric({ label, value, unit }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-light-grey last:border-0">
      <span className="text-xxs text-dark-grey">{label}</span>
      <span className="text-xxs font-semibold text-navy">
        {value}{unit ? <span className="font-normal text-mid-grey"> {unit}</span> : null}
      </span>
    </div>
  )
}

// ── Statistics helper ─────────────────────────────────────────────────────────

function scheduleStats(dayTypes) {
  if (!dayTypes) return null
  const wd  = dayTypes.weekday  ?? Array(24).fill(0)
  const sat = dayTypes.saturday ?? wd
  const sun = dayTypes.sunday   ?? wd

  const avgAll = Array.from({ length: 24 }, (_, h) => (wd[h] * 5 + sat[h] + sun[h]) / 7)
  const peak = Math.max(...avgAll)
  const avg  = avgAll.reduce((s, v) => s + v, 0) / 24

  const wdHours  = wd.filter(v => v > 0.1).length
  const satHours = sat.filter(v => v > 0.1).length
  const sunHours = sun.filter(v => v > 0.1).length
  const annualHours = wdHours * 52 + satHours * 52 + sunHours * 52

  return { peak, avg, annualHours, weekday: wd, saturday: sat, sunday: sun }
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function ProfilesLiveResults({ schedule }) {
  const [activeDay, setActiveDay] = useState('weekday')

  const cfg       = schedule?.config_json ?? {}
  const dayTypes  = cfg.day_types ?? null
  const schedType = cfg.schedule_type ?? 'occupancy'
  const color     = TYPE_COLOR[schedType] ?? '#8B5CF6'

  const stats = useMemo(() => scheduleStats(dayTypes), [dayTypes])
  const currentValues = stats?.[activeDay] ?? []

  if (!schedule) {
    return (
      <div className="h-full bg-white border-l border-light-grey flex items-center justify-center">
        <p className="text-caption text-mid-grey">Select a schedule</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-white border-l border-light-grey">
      <div className="p-3 space-y-4">

        {/* Header */}
        <div>
          <p className="text-xxs uppercase tracking-wider text-mid-grey">Schedule Preview</p>
          <p className="text-caption font-medium text-navy mt-0.5 truncate">
            {schedule.display_name ?? schedule.name}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-xxs text-mid-grey capitalize">
              {schedType.replace(/_/g, ' ')}
              {cfg.building_type ? ` · ${cfg.building_type}` : ''}
            </span>
          </div>
        </div>

        {/* 24-hour profile chart */}
        {stats && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xxs uppercase tracking-wider text-mid-grey">24-hour profile</p>
              <div className="flex gap-1">
                {DAY_TABS.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setActiveDay(t.id)}
                    className={`px-1.5 py-0.5 text-xxs rounded border transition-colors ${
                      activeDay === t.id
                        ? 'bg-purple-50 border-purple-300 text-purple-700'
                        : 'border-light-grey text-mid-grey hover:border-purple-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <HourlyBars values={currentValues} color={color} />
            <div className="flex justify-between mt-0.5">
              {[0, 6, 12, 18, 23].map(h => (
                <span key={h} className="text-xxs text-mid-grey">{h}:00</span>
              ))}
            </div>
          </div>
        )}

        {/* Statistics */}
        {stats && (
          <div>
            <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5">Statistics</p>
            <Metric
              label="Peak fraction"
              value={`${Math.round(stats.peak * 100)}%`}
              unit=""
            />
            <Metric
              label="Average fraction"
              value={`${Math.round(stats.avg * 100)}%`}
              unit=""
            />
            <Metric
              label="Annual operating hours"
              value={stats.annualHours.toLocaleString()}
              unit="h/yr"
            />
          </div>
        )}

        {/* Monthly multipliers */}
        {cfg.monthly_multipliers?.length === 12 && (
          <div>
            <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5">Monthly pattern</p>
            <div className="flex items-end gap-px h-10">
              {cfg.monthly_multipliers.map((v, i) => {
                const mmax = Math.max(...cfg.monthly_multipliers, 0.01)
                const months = ['J','F','M','A','M','J','J','A','S','O','N','D']
                return (
                  <div key={i} className="flex-1 flex flex-col items-center">
                    <div
                      className="w-full rounded-t"
                      style={{
                        height: `${Math.max(4, (v / mmax) * 32)}px`,
                        backgroundColor: color,
                        opacity: 0.6 + (v / mmax) * 0.4,
                      }}
                      title={`${months[i]}: ×${v.toFixed(2)}`}
                    />
                    <span className="text-mid-grey" style={{ fontSize: '6px' }}>{months[i]}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Custom badge */}
        {schedule.is_custom && (
          <div className="bg-purple-50 border border-purple-200 rounded p-2">
            <p className="text-xxs text-purple-700">Custom schedule — edits save to your library.</p>
          </div>
        )}
      </div>
    </div>
  )
}
