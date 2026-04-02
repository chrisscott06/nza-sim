/**
 * ProfilesEditor.jsx
 *
 * Profiles & Schedules module — /profiles route.
 * ExplorerLayout: sidebar with filters + schedule list, main area with ScheduleViewer.
 */

import { useState, useEffect, useContext } from 'react'
import { Clock, Search, X, Check } from 'lucide-react'
import ExplorerLayout  from '../ui/ExplorerLayout.jsx'
import ScheduleViewer  from './profiles/ScheduleViewer.jsx'
import { ProjectContext } from '../../context/ProjectContext.jsx'

// ── Filter config ──────────────────────────────────────────────────────────────

const SCHEDULE_TYPES = [
  { id: 'all',              label: 'All Types' },
  { id: 'occupancy',        label: 'Occupancy' },
  { id: 'lighting',         label: 'Lighting' },
  { id: 'equipment',        label: 'Equipment' },
  { id: 'heating_setpoint', label: 'Heating Setpoint' },
  { id: 'cooling_setpoint', label: 'Cooling Setpoint' },
  { id: 'dhw',              label: 'DHW' },
]

const ZONE_TYPES = [
  { id: 'all',        label: 'All Zones' },
  { id: 'bedroom',    label: 'Bedroom' },
  { id: 'corridor',   label: 'Corridor' },
  { id: 'reception',  label: 'Reception' },
  { id: 'office',     label: 'Office' },
  { id: 'retail',     label: 'Retail' },
]

// ── Type colour dots ───────────────────────────────────────────────────────────

const TYPE_DOT = {
  occupancy:         'bg-blue-400',
  lighting:          'bg-yellow-400',
  equipment:         'bg-orange-400',
  heating_setpoint:  'bg-red-400',
  cooling_setpoint:  'bg-sky-400',
  dhw:               'bg-teal-400',
}

// ── Sidebar ────────────────────────────────────────────────────────────────────

function ProfilesSidebar({
  schedules, loading, error,
  typeFilter, setTypeFilter,
  zoneFilter, setZoneFilter,
  search, setSearch,
  selectedId, onSelect,
}) {
  const filtered = schedules.filter(s => {
    const cfg = s.config_json ?? {}
    if (typeFilter !== 'all' && cfg.schedule_type !== typeFilter) return false
    if (zoneFilter !== 'all' && cfg.zone_type !== zoneFilter)     return false
    if (search) {
      const q = search.toLowerCase()
      if (!(s.display_name ?? s.name ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-3 pt-3 pb-2 border-b border-light-grey">
        <p className="text-caption font-medium text-navy">Profiles & Schedules</p>
        <p className="text-xxs text-mid-grey mt-0.5">Browse and assign schedule templates</p>
      </div>

      {/* Search */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-light-grey">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mid-grey" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search schedules…"
            className="w-full pl-7 pr-7 py-1.5 text-caption border border-light-grey rounded bg-white focus:outline-none focus:border-teal transition-colors"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-mid-grey hover:text-navy">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Schedule type filter — compact horizontal pills */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-light-grey">
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5">Type</p>
        <div className="flex flex-wrap gap-1">
          {SCHEDULE_TYPES.map(t => (
            <button
              key={t.id}
              onClick={() => setTypeFilter(t.id)}
              className={`
                flex items-center gap-1 px-2 py-0.5 rounded text-xxs transition-colors border
                ${typeFilter === t.id
                  ? 'bg-navy text-white border-navy'
                  : 'text-mid-grey border-light-grey hover:border-navy hover:text-navy'}
              `}
            >
              {t.id !== 'all' && (
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${TYPE_DOT[t.id] ?? 'bg-gray-400'} ${typeFilter === t.id ? 'opacity-70' : ''}`} />
              )}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Zone type filter */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-light-grey">
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5">Zone</p>
        <div className="flex flex-wrap gap-1">
          {ZONE_TYPES.map(z => (
            <button
              key={z.id}
              onClick={() => setZoneFilter(z.id)}
              className={`
                px-2 py-0.5 rounded text-xxs transition-colors border
                ${zoneFilter === z.id
                  ? 'bg-navy text-white border-navy'
                  : 'text-mid-grey border-light-grey hover:border-navy hover:text-navy'}
              `}
            >
              {z.label}
            </button>
          ))}
        </div>
      </div>

      {/* Schedule list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="p-4 text-center text-caption text-mid-grey">Loading schedules…</div>
        )}
        {error && (
          <div className="p-4 text-center text-caption text-red-600">Failed to load: {error}</div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="p-4 text-center text-caption text-mid-grey">No schedules match your filters</div>
        )}

        {!loading && !error && filtered.map(s => {
          const cfg = s.config_json ?? {}
          const isSelected = s.id === selectedId
          const dotCls = TYPE_DOT[cfg.schedule_type] ?? 'bg-gray-400'

          return (
            <button
              key={s.id}
              onClick={() => onSelect(s)}
              className={`
                w-full text-left px-3 py-2.5 border-b border-light-grey/60 transition-colors
                ${isSelected ? 'bg-navy/5 border-l-2 border-l-navy pl-2.5' : 'hover:bg-off-white'}
              `}
            >
              <div className="flex items-start gap-2">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${dotCls}`} />
                <div className="min-w-0">
                  <p className={`text-caption truncate ${isSelected ? 'font-medium text-navy' : 'text-dark-grey'}`}>
                    {s.display_name ?? s.name}
                  </p>
                  <p className="text-xxs text-mid-grey truncate capitalize">
                    {cfg.zone_type?.replace(/_/g, ' ')}
                    {cfg.building_type ? ` · ${cfg.building_type}` : ''}
                  </p>
                </div>
                {isSelected && <Check size={12} className="flex-shrink-0 text-navy ml-auto mt-0.5" />}
              </div>
            </button>
          )
        })}
      </div>

      {/* Footer: create button placeholder */}
      <div className="flex-shrink-0 border-t border-light-grey p-3">
        <button
          disabled
          className="w-full py-1.5 text-caption border border-dashed border-light-grey rounded-lg text-mid-grey cursor-not-allowed"
          title="Coming in Part 10"
        >
          + Create Custom Schedule
        </button>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ProfilesEditor() {
  const { currentProjectId } = useContext(ProjectContext)

  const [schedules,   setSchedules]   = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [selected,    setSelected]    = useState(null)
  const [typeFilter,  setTypeFilter]  = useState('all')
  const [zoneFilter,  setZoneFilter]  = useState('all')
  const [search,      setSearch]      = useState('')
  const [assignMsg,   setAssignMsg]   = useState(null)

  // Fetch full detail when a schedule is selected
  const [detailCache, setDetailCache] = useState({})

  useEffect(() => {
    fetch('/api/library?type=schedule')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => { setSchedules(data); setLoading(false) })
      .catch(err => { setError(err.message); setLoading(false) })
  }, [])

  // When selected changes, load full detail if not cached
  useEffect(() => {
    if (!selected) return
    if (detailCache[selected.id]) return
    fetch(`/api/library/${selected.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) setDetailCache(c => ({ ...c, [data.id]: data }))
      })
      .catch(() => {})
  }, [selected])

  // Auto-select first schedule on load
  useEffect(() => {
    if (schedules.length > 0 && !selected) {
      // Pick hotel_bedroom_occupancy as the default selection
      const defaultSched = schedules.find(s => s.name === 'hotel_bedroom_occupancy') ?? schedules[0]
      setSelected(defaultSched)
    }
  }, [schedules])

  function handleAssign(schedule) {
    if (!currentProjectId) return
    const cfg = schedule.config_json ?? {}
    // Build a simple assignment key from zone_type + schedule_type
    const key = `${cfg.zone_type ?? 'general'}_${cfg.schedule_type ?? 'schedule'}`
    fetch(`/api/projects/${currentProjectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedule_assignments: { [key]: schedule.id } }),
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(() => {
        setAssignMsg(`Assigned: ${schedule.display_name ?? schedule.name}`)
        setTimeout(() => setAssignMsg(null), 3000)
      })
      .catch(() => {
        setAssignMsg('Assignment failed')
        setTimeout(() => setAssignMsg(null), 3000)
      })
  }

  // Use the cached full detail if available, otherwise the list item
  const selectedDetail = selected
    ? (detailCache[selected.id] ?? selected)
    : null

  return (
    <ExplorerLayout
      sidebarWidth="w-72"
      sidebar={
        <ProfilesSidebar
          schedules={schedules}
          loading={loading}
          error={error}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          zoneFilter={zoneFilter}
          setZoneFilter={setZoneFilter}
          search={search}
          setSearch={setSearch}
          selectedId={selected?.id}
          onSelect={setSelected}
        />
      }
    >
      {/* Assign notification toast */}
      {assignMsg && (
        <div className="fixed bottom-4 right-4 z-50 bg-navy text-white text-caption px-4 py-2 rounded-lg shadow-lg">
          {assignMsg}
        </div>
      )}

      <ScheduleViewer
        schedule={selectedDetail}
        onAssign={handleAssign}
        onEditCopy={null}
      />
    </ExplorerLayout>
  )
}
