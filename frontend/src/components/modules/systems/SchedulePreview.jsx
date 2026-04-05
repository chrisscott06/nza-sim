/**
 * SchedulePreview.jsx
 *
 * Right-panel schedule view in the Systems module.
 * Shows a 24-hour day profile chart for a selectable demand type.
 * When the user assigns a different schedule, the instant calc updates via
 * the onAssign callback.
 */

import { useNavigate } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import DayProfileChart from '../profiles/DayProfileChart.jsx'

// ── Demand → schedule_type mapping ─────────────────��──────────────────────────

const DEMAND_OPTIONS = [
  { id: 'occupancy',     label: 'Occupancy',     schedType: 'occupancy' },
  { id: 'lighting',      label: 'Lighting',      schedType: 'lighting' },
  { id: 'small_power',   label: 'Small Power',   schedType: 'equipment' },
  { id: 'space_heating', label: 'Space Heating', schedType: 'heating_setpoint' },
  { id: 'space_cooling', label: 'Space Cooling', schedType: 'cooling_setpoint' },
  { id: 'dhw',           label: 'DHW',           schedType: 'dhw' },
]

export default function SchedulePreview({
  schedules = [],
  scheduleType,          // demand key (e.g. 'space_heating')
  onScheduleTypeChange,  // (demandKey) => void
  assignments = {},      // { [demandKey]: scheduleId }
  onAssign,              // (demandKey, scheduleId) => void
}) {
  const navigate     = useNavigate()
  const demand       = DEMAND_OPTIONS.find(d => d.id === scheduleType) ?? DEMAND_OPTIONS[0]
  const typeSchedules = schedules.filter(s => s.config_json?.schedule_type === demand.schedType)

  // Active schedule for this demand (assigned or first available)
  const assignedId    = assignments[demand.id] ?? typeSchedules[0]?.id ?? null
  const activeSchedule = typeSchedules.find(s => s.id === assignedId) ?? typeSchedules[0] ?? null

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white">

      {/* Demand selector */}
      <div className="px-3 py-2.5 border-b border-light-grey flex-shrink-0">
        <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1.5">
          Preview schedule for
        </label>
        <select
          value={demand.id}
          onChange={e => onScheduleTypeChange?.(e.target.value)}
          className="w-full px-2 py-1.5 text-caption border border-light-grey rounded bg-white focus:outline-none focus:border-teal transition-colors"
        >
          {DEMAND_OPTIONS.map(d => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>
      </div>

      {/* Schedule selector (if multiple available) */}
      {typeSchedules.length > 1 && (
        <div className="px-3 py-2 border-b border-light-grey flex-shrink-0">
          <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1.5">
            Active schedule
          </label>
          <select
            value={assignedId ?? ''}
            onChange={e => onAssign?.(demand.id, e.target.value)}
            className="w-full px-2 py-1.5 text-caption border border-teal/40 rounded bg-teal/5 focus:outline-none focus:border-teal transition-colors"
          >
            {typeSchedules.map(s => (
              <option key={s.id} value={s.id}>
                {s.display_name ?? s.name}
              </option>
            ))}
          </select>
          <p className="text-xxs text-teal mt-1">Changing this updates the live instant calc</p>
        </div>
      )}

      {/* Chart */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {activeSchedule ? (
          <>
            <p className="text-xxs font-medium text-navy px-1 mb-1">
              {activeSchedule.display_name ?? activeSchedule.name}
            </p>
            <DayProfileChart schedule={activeSchedule} />
          </>
        ) : (
          <div className="h-32 flex items-center justify-center text-xxs text-mid-grey">
            No {demand.label} schedule in library
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-light-grey p-3">
        <button
          onClick={() => navigate('/profiles')}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xxs text-teal border border-teal/30 rounded-lg hover:bg-teal/5 transition-colors"
        >
          <ExternalLink size={10} />
          Edit Schedules →
        </button>
      </div>
    </div>
  )
}
