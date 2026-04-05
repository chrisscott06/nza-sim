/**
 * ProfilesEditor.jsx — three-column live workspace
 *
 * Left (w-64):   Schedule list with type filter (no zone filter), prev/next nav, create button
 * Centre (flex-1): Schedule viewer/editor (day chart + heatmap)
 * Right (w-80):  ProfilesLiveResults — statistics + 24-hour preview
 */

import { useState, useEffect, useContext } from 'react'
import { Search, X, Check, Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import ScheduleViewer  from './profiles/ScheduleViewer.jsx'
import ScheduleEditor  from './profiles/ScheduleEditor.jsx'
import ProfilesLiveResults from './profiles/ProfilesLiveResults.jsx'
import { ProjectContext } from '../../context/ProjectContext.jsx'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip zone-type words from schedule display names (e.g. "Hotel Bedroom — Occupancy" → "Hotel — Occupancy") */
function cleanScheduleName(name) {
  if (!name) return name
  const ZONE_WORDS = ['Bedroom', 'Corridor', 'Reception', 'Office', 'Retail', 'Bathroom', 'Common Area']
  let cleaned = name
  for (const word of ZONE_WORDS) {
    cleaned = cleaned.replace(new RegExp(`\\b${word}\\b\\s*—?\\s*`, 'i'), '').trim()
  }
  return cleaned.replace(/^[— ]+/, '').replace(/[— ]+$/, '').trim() || name
}

// ── Type config ───────────────────────────────────────────────────────────────

const SCHEDULE_TYPES = [
  { id: 'all',              label: 'All' },
  { id: 'occupancy',        label: 'Occupancy' },
  { id: 'lighting',         label: 'Lighting' },
  { id: 'equipment',        label: 'Equipment' },
  { id: 'heating_setpoint', label: 'Heating SP' },
  { id: 'cooling_setpoint', label: 'Cooling SP' },
  { id: 'dhw',              label: 'DHW' },
]

const TYPE_DOT = {
  occupancy:         '#3B82F6',
  lighting:          '#F59E0B',
  equipment:         '#8B5CF6',
  heating_setpoint:  '#DC2626',
  cooling_setpoint:  '#06B6D4',
  dhw:               '#F97316',
}

// ── Create dialog ──────────────────────────────────────────────────────────────

function CreateDialog({ schedules, onConfirm, onCancel }) {
  const [name,      setName]      = useState('My Custom Schedule')
  const [schedType, setSchedType] = useState('occupancy')
  const [template,  setTemplate]  = useState('')

  function handleCreate() {
    const base = schedules.find(s => s.id === template)
    const blankDays = { weekday: Array(24).fill(0.5), saturday: Array(24).fill(0.5), sunday: Array(24).fill(0.5) }
    const blankMult = Array(12).fill(1)
    onConfirm({
      display_name: name,
      name,
      config_json: {
        schedule_type:       schedType,
        day_types:           base ? { ...(base.config_json?.day_types ?? blankDays) } : blankDays,
        monthly_multipliers: base ? [...(base.config_json?.monthly_multipliers ?? blankMult)] : blankMult,
      },
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl border border-light-grey shadow-xl p-6 w-80 space-y-4">
        <h3 className="text-caption font-semibold text-navy">Create Custom Schedule</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">Name</label>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus
              className="w-full px-2 py-1.5 text-caption border border-light-grey rounded focus:outline-none focus:border-teal" />
          </div>
          <div>
            <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">Schedule Type</label>
            <select value={schedType} onChange={e => setSchedType(e.target.value)}
              className="w-full px-2 py-1.5 text-caption border border-light-grey rounded bg-white focus:outline-none">
              {['occupancy','lighting','equipment','heating_setpoint','cooling_setpoint','dhw'].map(t => (
                <option key={t} value={t}>{t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">Base Template (optional)</label>
            <select value={template} onChange={e => setTemplate(e.target.value)}
              className="w-full px-2 py-1.5 text-caption border border-light-grey rounded bg-white focus:outline-none">
              <option value="">— blank —</option>
              {schedules.map(s => (
                <option key={s.id} value={s.id}>{s.display_name ?? s.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onCancel}
            className="flex-1 py-1.5 text-caption border border-light-grey rounded-lg text-mid-grey hover:text-navy transition-colors">
            Cancel
          </button>
          <button onClick={handleCreate} disabled={!name.trim()}
            className="flex-1 py-1.5 text-caption bg-navy text-white rounded-lg hover:bg-opacity-90 transition-colors disabled:opacity-60">
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Left column ───────────────────────────────────────────────────────────────

function ScheduleListColumn({
  schedules, loading, error,
  typeFilter, setTypeFilter,
  search, setSearch,
  selectedId, onSelect, onNavigate,
  onCreateClick,
}) {
  const filtered = schedules.filter(s => {
    const cfg = s.config_json ?? {}
    if (typeFilter !== 'all' && cfg.schedule_type !== typeFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!(s.display_name ?? s.name ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  const currentIdx = filtered.findIndex(s => s.id === selectedId)

  function handlePrev() {
    if (currentIdx > 0) onNavigate(filtered[currentIdx - 1])
  }
  function handleNext() {
    if (currentIdx < filtered.length - 1) onNavigate(filtered[currentIdx + 1])
  }

  return (
    <div className="h-full flex flex-col bg-white border-r border-light-grey">
      {/* Module header with purple accent */}
      <div
        className="flex-shrink-0 px-3 pt-2.5 pb-2 border-b border-light-grey"
        style={{ borderTopWidth: '3px', borderTopColor: '#8B5CF6', borderTopStyle: 'solid' }}
      >
        <p className="text-caption font-medium" style={{ color: '#8B5CF6' }}>Profiles</p>
        <p className="text-xxs text-mid-grey">Browse and assign schedule templates</p>
      </div>

      {/* Search */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-light-grey">
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-mid-grey" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full pl-6 pr-6 py-1 text-caption border border-light-grey rounded bg-white focus:outline-none focus:border-purple-400 transition-colors"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-mid-grey hover:text-navy">
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Type filter pills */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-light-grey">
        <div className="flex flex-wrap gap-1">
          {SCHEDULE_TYPES.map(t => (
            <button
              key={t.id}
              onClick={() => setTypeFilter(t.id)}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xxs transition-colors border ${
                typeFilter === t.id
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'text-mid-grey border-light-grey hover:border-purple-400 hover:text-purple-700'
              }`}
            >
              {t.id !== 'all' && (
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: TYPE_DOT[t.id] ?? '#9E9E9E', opacity: typeFilter === t.id ? 0.7 : 1 }} />
              )}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Prev / Next navigation */}
      {filtered.length > 1 && currentIdx >= 0 && (
        <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-light-grey bg-off-white">
          <button
            onClick={handlePrev}
            disabled={currentIdx === 0}
            className="flex items-center gap-0.5 text-xxs text-mid-grey hover:text-navy disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={12} /> Prev
          </button>
          <span className="text-xxs text-mid-grey">{currentIdx + 1} / {filtered.length}</span>
          <button
            onClick={handleNext}
            disabled={currentIdx === filtered.length - 1}
            className="flex items-center gap-0.5 text-xxs text-mid-grey hover:text-navy disabled:opacity-30 transition-colors"
          >
            Next <ChevronRight size={12} />
          </button>
        </div>
      )}

      {/* Schedule list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="p-4 text-center text-caption text-mid-grey">Loading schedules…</div>
        )}
        {error && (
          <div className="p-4 text-center text-caption text-red-600">Failed to load: {error}</div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="p-4 text-center text-caption text-mid-grey">No schedules match</div>
        )}
        {!loading && !error && filtered.map(s => {
          const cfg = s.config_json ?? {}
          const isSelected = s.id === selectedId
          const dotColor = TYPE_DOT[cfg.schedule_type] ?? '#9E9E9E'

          return (
            <button
              key={s.id}
              onClick={() => onSelect(s)}
              className={`w-full text-left px-3 py-2 border-b border-light-grey/60 transition-colors ${
                isSelected ? 'bg-purple-50 border-l-2 border-l-purple-400 pl-2.5' : 'hover:bg-off-white'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1" style={{ backgroundColor: dotColor }} />
                <div className="min-w-0 flex-1">
                  <p className={`text-caption truncate ${isSelected ? 'font-medium text-navy' : 'text-dark-grey'}`}>
                    {cleanScheduleName(s.display_name ?? s.name)}
                  </p>
                  <p className="text-xxs text-mid-grey truncate capitalize">
                    {(cfg.schedule_type ?? '').replace(/_/g, ' ')}
                  </p>
                </div>
                {isSelected && <Check size={11} className="flex-shrink-0 text-purple-600 ml-auto mt-0.5" />}
              </div>
            </button>
          )
        })}
      </div>

      {/* Footer: create button */}
      <div className="flex-shrink-0 border-t border-light-grey p-3">
        <button
          onClick={onCreateClick}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-caption border border-dashed border-purple-300 rounded-lg text-purple-700 hover:bg-purple-50 transition-colors"
        >
          <Plus size={12} /> Create Custom
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
  const [search,      setSearch]      = useState('')
  const [assignMsg,   setAssignMsg]   = useState(null)
  const [showCreate,  setShowCreate]  = useState(false)
  const [editingSched, setEditingSched] = useState(null)
  const [detailCache, setDetailCache] = useState({})

  function loadSchedules() {
    fetch('/api/library?type=schedule')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => { setSchedules(data); setLoading(false) })
      .catch(err => { setError(err.message); setLoading(false) })
  }

  useEffect(() => { loadSchedules() }, [])

  useEffect(() => {
    if (!selected || detailCache[selected.id]) return
    fetch(`/api/library/${selected.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setDetailCache(c => ({ ...c, [data.id]: data })) })
      .catch(() => {})
  }, [selected])

  useEffect(() => {
    if (schedules.length > 0 && !selected) {
      setSelected(schedules.find(s => s.name === 'hotel_bedroom_occupancy') ?? schedules[0])
    }
  }, [schedules])

  function handleAssign(schedule) {
    if (!currentProjectId) return
    const cfg = schedule.config_json ?? {}
    const key = `${cfg.zone_type ?? 'general'}_${cfg.schedule_type ?? 'schedule'}`
    fetch(`/api/projects/${currentProjectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedule_assignments: { [key]: schedule.id } }),
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(() => { setAssignMsg(`Assigned: ${schedule.display_name ?? schedule.name}`); setTimeout(() => setAssignMsg(null), 3000) })
      .catch(() => { setAssignMsg('Assignment failed'); setTimeout(() => setAssignMsg(null), 3000) })
  }

  function handleEditorSaved(newItem) {
    loadSchedules()
    setDetailCache(c => ({ ...c, [newItem.id]: newItem }))
    setSelected(newItem)
    setEditingSched(null)
    setAssignMsg(`"${newItem.display_name ?? newItem.name}" saved`)
    setTimeout(() => setAssignMsg(null), 3000)
  }

  const selectedDetail = selected ? (detailCache[selected.id] ?? selected) : null

  return (
    <>
      {showCreate && (
        <CreateDialog
          schedules={schedules}
          onConfirm={initial => { setShowCreate(false); setEditingSched(initial) }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {assignMsg && (
        <div className="fixed bottom-4 right-4 z-50 bg-navy text-white text-caption px-4 py-2 rounded-lg shadow-lg">
          {assignMsg}
        </div>
      )}

      <div className="flex h-[calc(100vh-3rem)]">
        {/* Left: schedule list */}
        <div className="w-64 flex-shrink-0">
          <ScheduleListColumn
            schedules={schedules}
            loading={loading}
            error={error}
            typeFilter={typeFilter}
            setTypeFilter={setTypeFilter}
            search={search}
            setSearch={setSearch}
            selectedId={selected?.id}
            onSelect={s => { setSelected(s); setEditingSched(null) }}
            onNavigate={s => { setSelected(s); setEditingSched(null) }}
            onCreateClick={() => setShowCreate(true)}
          />
        </div>

        {/* Centre: schedule viewer / editor */}
        <div className="flex-1 overflow-y-auto bg-off-white">
          {editingSched ? (
            <ScheduleEditor
              initialSchedule={editingSched}
              onSaved={handleEditorSaved}
              onCancel={() => setEditingSched(null)}
            />
          ) : (
            <ScheduleViewer
              schedule={selectedDetail}
              onAssign={handleAssign}
              onEditCopy={s => setEditingSched(detailCache[s.id] ?? s)}
            />
          )}
        </div>

        {/* Right: live results / statistics */}
        <div className="w-80 flex-shrink-0">
          <ProfilesLiveResults schedule={selectedDetail} />
        </div>
      </div>
    </>
  )
}
