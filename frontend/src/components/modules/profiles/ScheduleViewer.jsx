/**
 * ScheduleViewer.jsx
 *
 * Main content panel for a selected schedule.
 * Toggles between DayProfileChart and HeatmapView.
 * Shows name, type badge, assign button, and edit-copy button.
 */

import { useState } from 'react'
import { BarChart2, Grid, Clock } from 'lucide-react'
import DayProfileChart from './DayProfileChart.jsx'
import HeatmapView     from './HeatmapView.jsx'

const TYPE_COLOURS = {
  occupancy:         'bg-blue-50 text-blue-700 border-blue-200',
  lighting:          'bg-yellow-50 text-yellow-700 border-yellow-200',
  equipment:         'bg-orange-50 text-orange-700 border-orange-200',
  heating_setpoint:  'bg-red-50 text-red-700 border-red-200',
  cooling_setpoint:  'bg-sky-50 text-sky-700 border-sky-200',
  dhw:               'bg-teal-50 text-teal-700 border-teal-200',
}

function TypeBadge({ type }) {
  const cls = TYPE_COLOURS[type] ?? 'bg-gray-50 text-gray-600 border-gray-200'
  const label = type
    ? type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : 'Schedule'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${cls}`}>
      <Clock size={10} />
      {label}
    </span>
  )
}

export default function ScheduleViewer({ schedule, onAssign, onEditCopy }) {
  const [view, setView] = useState('chart') // 'chart' | 'heatmap'

  if (!schedule) {
    return (
      <div className="flex items-center justify-center h-full text-caption text-mid-grey">
        <div className="text-center">
          <Clock size={32} className="mx-auto mb-3 text-light-grey" />
          <p>Select a schedule from the sidebar to view its profile</p>
        </div>
      </div>
    )
  }

  const cfg = schedule.config_json ?? {}

  return (
    <div className="p-6 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-section font-semibold text-navy mb-1">
            {schedule.display_name ?? schedule.name}
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            <TypeBadge type={cfg.schedule_type} />
            {cfg.zone_type && (
              <span className="text-xs text-mid-grey capitalize">{cfg.zone_type.replace(/_/g, ' ')}</span>
            )}
            {cfg.building_type && (
              <span className="text-xs text-mid-grey capitalize">{cfg.building_type.replace(/_/g, ' ')}</span>
            )}
            {schedule.is_default && (
              <span className="text-xs text-mid-grey border border-light-grey rounded px-1.5 py-px">Default</span>
            )}
          </div>
          {schedule.description && (
            <p className="text-xs text-mid-grey mt-2 max-w-lg">{schedule.description}</p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
          {onEditCopy && (
            <button
              onClick={() => onEditCopy(schedule)}
              className="px-3 py-1.5 text-caption border border-light-grey rounded-lg text-mid-grey hover:text-navy hover:border-navy transition-colors"
            >
              Edit Copy
            </button>
          )}
          {onAssign && (
            <button
              onClick={() => onAssign(schedule)}
              className="px-3 py-1.5 text-caption bg-navy text-white rounded-lg hover:bg-opacity-90 transition-colors"
            >
              Assign to Project
            </button>
          )}
        </div>
      </div>

      {/* View toggle */}
      <div className="flex items-center gap-1 bg-off-white rounded-lg p-0.5 w-fit mb-5">
        <button
          onClick={() => setView('chart')}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-md text-caption transition-colors
            ${view === 'chart' ? 'bg-white text-navy shadow-sm font-medium' : 'text-mid-grey hover:text-navy'}
          `}
        >
          <BarChart2 size={14} />
          Day Profile
        </button>
        <button
          onClick={() => setView('heatmap')}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-md text-caption transition-colors
            ${view === 'heatmap' ? 'bg-white text-navy shadow-sm font-medium' : 'text-mid-grey hover:text-navy'}
          `}
        >
          <Grid size={14} />
          Annual Heatmap
        </button>
      </div>

      {/* Chart area */}
      <div className="bg-white rounded-xl border border-light-grey p-5">
        {view === 'chart'
          ? <DayProfileChart schedule={schedule} />
          : <HeatmapView     schedule={schedule} />
        }
      </div>
    </div>
  )
}
