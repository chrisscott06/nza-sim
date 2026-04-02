/**
 * ProjectPicker.jsx
 *
 * Dropdown panel that opens when the project name in the TopBar is clicked.
 * Shows all projects, lets the user switch, create new, or delete.
 */

import { useContext, useEffect, useRef, useState } from 'react'
import { Plus, Trash2, FolderOpen, Check, Clock } from 'lucide-react'
import { ProjectContext } from '../../context/ProjectContext.jsx'

function formatDate(ts) {
  if (!ts) return '—'
  const d = new Date(ts.replace(' ', 'T') + 'Z')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatRelative(ts) {
  if (!ts) return ''
  const d = new Date(ts.replace(' ', 'T') + 'Z')
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60)    return 'just now'
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function ProjectPicker({ onClose }) {
  const ctx = useContext(ProjectContext)
  const { projects, currentProjectId, createProject, loadProject, deleteProject } = ctx

  const [newName, setNewName]         = useState('')
  const [showNew, setShowNew]         = useState(false)
  const [creating, setCreating]       = useState(false)
  const [deletingId, setDeletingId]   = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const panelRef = useRef(null)
  const newInputRef = useRef(null)

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Focus new-project input when shown
  useEffect(() => {
    if (showNew) newInputRef.current?.focus()
  }, [showNew])

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      await createProject(newName.trim())
      setNewName('')
      setShowNew(false)
      onClose()
    } finally {
      setCreating(false)
    }
  }

  async function handleLoad(id) {
    if (id === currentProjectId) { onClose(); return }
    await loadProject(id)
    onClose()
  }

  async function handleDelete(id) {
    if (confirmDelete !== id) {
      setConfirmDelete(id)
      return
    }
    setDeletingId(id)
    try {
      await deleteProject(id)
      setConfirmDelete(null)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div
      ref={panelRef}
      className="
        absolute left-4 top-14 z-50 w-80
        bg-white border border-light-grey rounded-lg shadow-xl
        overflow-hidden
      "
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-light-grey flex items-center justify-between">
        <span className="text-caption font-semibold text-navy uppercase tracking-wide">Projects</span>
        <button
          onClick={() => { setShowNew(v => !v); setConfirmDelete(null) }}
          className="flex items-center gap-1 text-caption text-magenta hover:text-magenta/80 font-medium"
        >
          <Plus size={13} />
          New Project
        </button>
      </div>

      {/* New project form */}
      {showNew && (
        <div className="px-4 py-3 border-b border-light-grey bg-off-white flex gap-2">
          <input
            ref={newInputRef}
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            placeholder="Project name…"
            className="
              flex-1 px-2 py-1.5 text-caption border border-light-grey rounded
              bg-white text-navy placeholder:text-mid-grey focus:outline-none
              focus:ring-1 focus:ring-magenta
            "
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="
              px-3 py-1.5 text-caption rounded bg-magenta text-white
              disabled:opacity-50 hover:bg-magenta/90
            "
          >
            {creating ? '…' : 'Create'}
          </button>
        </div>
      )}

      {/* Project list */}
      <div className="max-h-80 overflow-y-auto">
        {projects.length === 0 ? (
          <div className="px-4 py-6 text-center text-caption text-mid-grey">
            No projects yet
          </div>
        ) : (
          projects.map(project => {
            const isCurrent = project.id === currentProjectId
            return (
              <div
                key={project.id}
                className={`
                  group flex items-center gap-3 px-4 py-3 cursor-pointer
                  border-b border-light-grey last:border-0
                  hover:bg-off-white transition-colors
                  ${isCurrent ? 'bg-blue-50/50' : ''}
                `}
                onClick={() => handleLoad(project.id)}
              >
                {/* Active indicator */}
                <div className="w-4 flex-shrink-0">
                  {isCurrent && <Check size={14} className="text-magenta" />}
                </div>

                {/* Project info */}
                <div className="flex-1 min-w-0">
                  <p className={`text-caption font-medium truncate ${isCurrent ? 'text-navy' : 'text-dark-grey'}`}>
                    {project.name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-mid-grey flex items-center gap-1">
                      <Clock size={10} />
                      {formatRelative(project.updated_at)}
                    </span>
                    {project.simulation_count > 0 && (
                      <span className="text-xs text-mid-grey">
                        · {project.simulation_count} run{project.simulation_count !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>

                {/* Delete button — not on current project */}
                {!isCurrent && (
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(project.id) }}
                    disabled={deletingId === project.id}
                    className={`
                      flex-shrink-0 opacity-0 group-hover:opacity-100
                      p-1 rounded transition-all
                      ${confirmDelete === project.id
                        ? 'opacity-100 text-coral hover:bg-coral/10'
                        : 'text-mid-grey hover:text-coral hover:bg-coral/10'}
                    `}
                    title={confirmDelete === project.id ? 'Click again to confirm delete' : 'Delete project'}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
