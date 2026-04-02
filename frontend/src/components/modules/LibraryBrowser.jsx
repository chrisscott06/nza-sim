/**
 * LibraryBrowser.jsx
 *
 * Full-page library browser — ExplorerLayout with filter sidebar + item grid.
 * Shows all library items: constructions, systems, schedules.
 * Clicking an item opens a detail panel on the right.
 */

import { useEffect, useState } from 'react'
import { Search, X, Layers, Thermometer, Clock, Check, Plus, Copy, Trash2 } from 'lucide-react'
import ExplorerLayout from '../ui/ExplorerLayout.jsx'
import ConstructionEditor from './library/ConstructionEditor.jsx'

// ── Type config ───────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  construction: {
    label:  'Construction',
    colour: 'bg-blue-100 text-blue-700',
    badge:  'bg-blue-50 border-blue-200 text-blue-700',
    icon:   <Layers size={14} />,
  },
  system: {
    label:  'System',
    colour: 'bg-green-100 text-green-700',
    badge:  'bg-green-50 border-green-200 text-green-700',
    icon:   <Thermometer size={14} />,
  },
  schedule: {
    label:  'Schedule',
    colour: 'bg-purple-100 text-purple-700',
    badge:  'bg-purple-50 border-purple-200 text-purple-700',
    icon:   <Clock size={14} />,
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function TypeBadge({ type, small = false }) {
  const cfg = TYPE_CONFIG[type]
  if (!cfg) return null
  return (
    <span className={`
      inline-flex items-center gap-1 rounded-full border font-medium
      ${cfg.badge}
      ${small ? 'px-1.5 py-px text-xs' : 'px-2 py-0.5 text-xs'}
    `}>
      {cfg.icon}
      {cfg.label}
    </span>
  )
}

function formatUValue(v) {
  if (v == null) return null
  return `U = ${Number(v).toFixed(2)} W/m²K`
}

function formatCOP(v) {
  if (v == null) return null
  return `COP ${Number(v).toFixed(1)}`
}

function keyMetric(item) {
  const cfg = item.config_json ?? {}
  if (item.library_type === 'construction') {
    return formatUValue(cfg.u_value_W_per_m2K)
  }
  if (item.library_type === 'system') {
    if (cfg.cop != null) return formatCOP(cfg.cop)
    if (cfg.eer != null) return `EER ${Number(cfg.eer).toFixed(1)}`
    return cfg.category ?? ''
  }
  if (item.library_type === 'schedule') {
    return cfg.schedule_type ?? cfg.zone_type ?? ''
  }
  return null
}

// ── Item Card ─────────────────────────────────────────────────────────────────

function ItemCard({ item, isSelected, onClick, onDuplicate, onDelete }) {
  const metric = keyMetric(item)
  return (
    <div
      onClick={onClick}
      className={`
        text-left w-full p-4 rounded-xl border transition-all cursor-pointer relative group
        ${isSelected
          ? 'border-magenta/50 bg-white shadow-md ring-1 ring-magenta/20'
          : 'border-light-grey bg-white hover:border-mid-grey hover:shadow-sm'}
      `}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <TypeBadge type={item.library_type} small />
        {!item.is_default && (
          <span className="text-xs text-teal font-medium">Custom</span>
        )}
        {item.is_default && (
          <span className="text-xs text-mid-grey">Default</span>
        )}
      </div>
      <p className="text-caption font-semibold text-navy truncate">
        {item.display_name || item.name}
      </p>
      {metric && (
        <p className="text-xs text-mid-grey mt-1">{metric}</p>
      )}
      {/* Action buttons (visible on hover) */}
      {item.library_type === 'construction' && (
        <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={e => { e.stopPropagation(); onDuplicate(item) }}
            className="p-1.5 rounded bg-off-white border border-light-grey text-mid-grey hover:text-navy hover:border-navy"
            title="Duplicate"
          >
            <Copy size={10} />
          </button>
          {!item.is_default && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(item) }}
              className="p-1.5 rounded bg-off-white border border-light-grey text-mid-grey hover:text-red-600 hover:border-red-200"
              title="Delete"
            >
              <Trash2 size={10} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function DetailPanel({ item, onClose }) {
  const [fullItem, setFullItem] = useState(null)

  useEffect(() => {
    if (!item) return
    fetch(`/api/library/${item.id}`)
      .then(r => r.json())
      .then(setFullItem)
      .catch(console.error)
  }, [item?.id])

  if (!item) return null

  const cfg = fullItem?.config_json ?? {}

  return (
    <div className="w-80 flex-shrink-0 border-l border-light-grey bg-white flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-light-grey flex items-start justify-between gap-3">
        <div>
          <TypeBadge type={item.library_type} />
          <h2 className="text-section font-semibold text-navy mt-1.5">
            {item.display_name || item.name}
          </h2>
          {item.description && (
            <p className="text-xs text-mid-grey mt-1">{item.description}</p>
          )}
        </div>
        <button onClick={onClose} className="text-mid-grey hover:text-navy mt-1">
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Construction detail */}
        {item.library_type === 'construction' && fullItem && (
          <>
            {/* Key metrics */}
            <div className="space-y-2">
              {cfg.u_value_W_per_m2K != null && (
                <div className="flex justify-between text-caption">
                  <span className="text-mid-grey">U-value</span>
                  <span className="font-semibold text-navy">{Number(cfg.u_value_W_per_m2K).toFixed(3)} W/m²K</span>
                </div>
              )}
              {cfg.type && (
                <div className="flex justify-between text-caption">
                  <span className="text-mid-grey">Type</span>
                  <span className="font-medium text-navy capitalize">{cfg.type.replace(/_/g, ' ')}</span>
                </div>
              )}
              {cfg.thermal_mass && (
                <div className="flex justify-between text-caption">
                  <span className="text-mid-grey">Thermal mass</span>
                  <span className="font-medium text-navy capitalize">{cfg.thermal_mass}</span>
                </div>
              )}
              {cfg.g_value != null && (
                <div className="flex justify-between text-caption">
                  <span className="text-mid-grey">g-value (SHGC)</span>
                  <span className="font-medium text-navy">{Number(cfg.g_value).toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* Layer buildup */}
            {cfg.epjson && (() => {
              const matKeys = Object.keys(cfg.epjson).filter(k =>
                k.startsWith('Material') || k.startsWith('WindowMaterial')
              )
              const constructionKey = Object.keys(cfg.epjson).find(k =>
                k === 'Construction'
              )
              if (!matKeys.length) return null

              return (
                <div>
                  <p className="text-xs font-semibold text-mid-grey uppercase tracking-wide mb-2">
                    Layer buildup
                  </p>
                  <div className="space-y-1.5">
                    {matKeys.flatMap(matType =>
                      Object.entries(cfg.epjson[matType] ?? {}).map(([name, mat]) => {
                        const thickness = mat.thickness != null
                          ? `${Math.round(mat.thickness * 1000)} mm`
                          : null
                        const conductivity = mat.conductivity != null
                          ? `λ ${mat.conductivity} W/mK`
                          : null

                        // Colour coding
                        const nameL = name.toLowerCase()
                        const colour = nameL.includes('insul')
                          ? 'bg-yellow-100 border-yellow-200'
                          : nameL.includes('plaster') || nameL.includes('board')
                          ? 'bg-blue-50 border-blue-200'
                          : nameL.includes('glass') || nameL.includes('glaz')
                          ? 'bg-sky-50 border-sky-200'
                          : 'bg-gray-100 border-gray-200'

                        return (
                          <div
                            key={name}
                            className={`px-3 py-2 rounded border text-xs ${colour}`}
                          >
                            <p className="font-medium text-navy">{name}</p>
                            <p className="text-mid-grey mt-0.5">
                              {[thickness, conductivity].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )
            })()}
          </>
        )}

        {/* System detail */}
        {item.library_type === 'system' && fullItem && (
          <div className="space-y-2">
            {[
              ['Category',    cfg.category],
              ['COP',         cfg.cop != null ? Number(cfg.cop).toFixed(1) : null],
              ['EER',         cfg.eer != null ? Number(cfg.eer).toFixed(1) : null],
              ['Fan power',   cfg.fan_power_W_per_ls != null ? `${cfg.fan_power_W_per_ls} W/(l/s)` : null],
              ['Heat recovery', cfg.heat_recovery_efficiency != null ? `${Math.round(cfg.heat_recovery_efficiency * 100)}%` : null],
              ['Min temp',    cfg.min_outdoor_temp_C != null ? `${cfg.min_outdoor_temp_C} °C` : null],
            ].filter(([, v]) => v != null).map(([label, value]) => (
              <div key={label} className="flex justify-between text-caption">
                <span className="text-mid-grey">{label}</span>
                <span className="font-medium text-navy capitalize">{String(value).replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        )}

        {/* Schedule detail */}
        {item.library_type === 'schedule' && fullItem && (
          <div className="space-y-3">
            {[
              ['Schedule type', cfg.schedule_type],
              ['Building type', cfg.building_type],
              ['Zone type',     cfg.zone_type],
            ].filter(([, v]) => v).map(([label, value]) => (
              <div key={label} className="flex justify-between text-caption">
                <span className="text-mid-grey">{label}</span>
                <span className="font-medium text-navy capitalize">{value}</span>
              </div>
            ))}
            {cfg.description && (
              <p className="text-xs text-mid-grey italic">{cfg.description}</p>
            )}
            {cfg.day_types?.weekday && (
              <div>
                <p className="text-xs font-semibold text-mid-grey uppercase tracking-wide mb-2">
                  Weekday profile (24h)
                </p>
                <div className="flex items-end gap-px h-12">
                  {cfg.day_types.weekday.map((v, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-purple-400 rounded-sm opacity-80"
                      style={{ height: `${Math.round(v * 100)}%` }}
                      title={`${i}:00 — ${v}`}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-xs text-mid-grey mt-1">
                  <span>00:00</span><span>12:00</span><span>23:00</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Filter Sidebar ────────────────────────────────────────────────────────────

const ALL_TYPES = ['construction', 'system', 'schedule']

function FilterSidebar({ activeTypes, onToggleType, search, onSearch }) {
  return (
    <div className="p-4 space-y-5">
      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mid-grey" />
        <input
          type="text"
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder="Search library…"
          className="
            w-full pl-8 pr-3 py-2 text-caption
            border border-light-grey rounded-lg bg-white
            placeholder:text-mid-grey text-navy
            focus:outline-none focus:ring-1 focus:ring-magenta
          "
        />
        {search && (
          <button
            onClick={() => onSearch('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-mid-grey hover:text-navy"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Type filters */}
      <div>
        <p className="text-xs font-semibold text-mid-grey uppercase tracking-wide mb-2">Type</p>
        <div className="space-y-1">
          {ALL_TYPES.map(type => {
            const cfg = TYPE_CONFIG[type]
            const isActive = activeTypes.includes(type)
            return (
              <button
                key={type}
                onClick={() => onToggleType(type)}
                className={`
                  w-full flex items-center gap-2 px-3 py-2 rounded-lg text-caption
                  transition-colors
                  ${isActive
                    ? `${cfg.colour} font-medium`
                    : 'text-dark-grey hover:bg-off-white'}
                `}
              >
                {cfg.icon}
                {cfg.label}
                {isActive && <Check size={12} className="ml-auto" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LibraryBrowser() {
  const [items, setItems]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [activeTypes, setActiveTypes] = useState([...ALL_TYPES])
  const [search, setSearch]         = useState('')
  const [selectedItem, setSelectedItem] = useState(null)

  // Editor state
  const [editorOpen,    setEditorOpen]    = useState(false)
  const [duplicateItem, setDuplicateItem] = useState(null)  // null = new, else item to copy

  // Fetch library items
  async function loadItems() {
    setLoading(true)
    try {
      const res = await fetch('/api/library')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setItems(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadItems() }, [])

  function toggleType(type) {
    setActiveTypes(prev =>
      prev.includes(type)
        ? prev.filter(t => t !== type)
        : [...prev, type]
    )
  }

  function handleEditorSave(newItem) {
    setEditorOpen(false)
    setDuplicateItem(null)
    loadItems()
  }

  function handleDuplicate(item) {
    setDuplicateItem(item)
    setEditorOpen(true)
  }

  async function handleDelete(item) {
    if (!confirm(`Delete "${item.display_name || item.name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/library/${item.id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`)
      if (selectedItem?.id === item.id) setSelectedItem(null)
      loadItems()
    } catch (err) {
      alert('Failed to delete: ' + err.message)
    }
  }

  // Filter items
  const filtered = items.filter(item => {
    if (!activeTypes.includes(item.library_type)) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        item.name.toLowerCase().includes(q) ||
        (item.display_name ?? '').toLowerCase().includes(q) ||
        (item.description ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  // Group by type for display
  const grouped = ALL_TYPES.reduce((acc, type) => {
    const group = filtered.filter(i => i.library_type === type)
    if (group.length) acc[type] = group
    return acc
  }, {})

  const sidebar = (
    <FilterSidebar
      activeTypes={activeTypes}
      onToggleType={toggleType}
      search={search}
      onSearch={setSearch}
    />
  )

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      {/* Filter sidebar */}
      <aside className="w-56 flex-shrink-0 bg-white border-r border-light-grey overflow-y-auto">
        {sidebar}
      </aside>

      {/* Item grid */}
      <div className="flex-1 overflow-y-auto bg-off-white p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-section font-semibold text-navy">Library</h1>
            <p className="text-xs text-mid-grey mt-0.5">
              {filtered.length} item{filtered.length !== 1 ? 's' : ''}
              {search ? ` matching "${search}"` : ''}
            </p>
          </div>
          <button
            onClick={() => { setDuplicateItem(null); setEditorOpen(true) }}
            className="flex items-center gap-1.5 px-3 py-2 text-caption text-white bg-navy rounded-lg hover:bg-navy/80 transition-colors"
          >
            <Plus size={13} />
            New Construction
          </button>
        </div>

        {loading && (
          <div className="text-caption text-mid-grey">Loading library…</div>
        )}
        {error && (
          <div className="text-caption text-coral">Failed to load library: {error}</div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-caption text-mid-grey">
            No items match your filters.
          </div>
        )}

        {/* Grouped sections */}
        {!loading && !error && Object.entries(grouped).map(([type, typeItems]) => (
          <div key={type} className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <TypeBadge type={type} />
              <span className="text-xs text-mid-grey">{typeItems.length} items</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {typeItems.map(item => (
                <ItemCard
                  key={item.id}
                  item={item}
                  isSelected={selectedItem?.id === item.id}
                  onClick={() => setSelectedItem(
                    selectedItem?.id === item.id ? null : item
                  )}
                  onDuplicate={handleDuplicate}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Detail panel */}
      {selectedItem && (
        <DetailPanel
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      )}

      {/* Construction editor modal */}
      {editorOpen && (
        <ConstructionEditor
          initialItem={duplicateItem}
          onSave={handleEditorSave}
          onClose={() => { setEditorOpen(false); setDuplicateItem(null) }}
        />
      )}
    </div>
  )
}
