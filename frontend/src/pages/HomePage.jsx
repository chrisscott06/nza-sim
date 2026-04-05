/**
 * HomePage.jsx — project landing page
 *
 * Shows all projects as cards. Click a card to load the project and
 * navigate to /building. "New Project" card creates a new project.
 */

import { useContext, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Plus, Clock, Zap, BarChart3 } from 'lucide-react'
import { ProjectContext } from '../context/ProjectContext.jsx'

function formatDate(ts) {
  if (!ts) return '—'
  const d = new Date(ts.replace(' ', 'T') + 'Z')
  const now = new Date()
  const diffDays = Math.floor((now - d) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7)  return `${diffDays} days ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function dimSummary(p) {
  const L   = p.bc_length     ?? null
  const W   = p.bc_width      ?? null
  const fl  = p.bc_num_floors ?? null
  const gia = (L && W && fl) ? Math.round(L * W * fl).toLocaleString() : null
  return { L, W, fl, gia }
}

function ProjectCard({ project, isCurrent, onLoad }) {
  const { L, W, fl, gia } = dimSummary(project)
  const eui = project.latest_eui != null ? Math.round(project.latest_eui) : null

  return (
    <button
      onClick={() => onLoad(project.id)}
      className={`
        w-full text-left p-4 rounded-xl border transition-all group
        hover:shadow-md hover:border-magenta/40
        ${isCurrent ? 'border-magenta/50 bg-white shadow-sm' : 'border-light-grey bg-white'}
      `}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
            isCurrent ? 'bg-magenta/10' : 'bg-off-white'
          }`}>
            <Building2 size={16} className={isCurrent ? 'text-magenta' : 'text-mid-grey'} />
          </div>
          <div className="min-w-0">
            <p className={`text-caption font-semibold truncate group-hover:text-magenta transition-colors ${
              isCurrent ? 'text-magenta' : 'text-navy'
            }`}>
              {project.name}
            </p>
            {isCurrent && (
              <p className="text-xxs text-magenta/70">Currently loaded</p>
            )}
          </div>
        </div>
        {eui != null && (
          <div className="flex items-center gap-1 flex-shrink-0 bg-navy/5 rounded px-1.5 py-0.5">
            <Zap size={9} className="text-gold" />
            <span className="text-xxs font-semibold text-navy">{eui}</span>
            <span className="text-xxs text-mid-grey">kWh/m²</span>
          </div>
        )}
      </div>

      {gia && (
        <p className="text-xxs text-dark-grey mb-2">
          {L}m × {W}m × {fl} fl — <span className="font-medium text-navy">{gia} m² GIA</span>
        </p>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-xxs text-mid-grey">
          <Clock size={9} />
          <span>{formatDate(project.updated_at)}</span>
        </div>
        {project.simulation_count > 0 && (
          <div className="flex items-center gap-1 text-xxs text-mid-grey">
            <BarChart3 size={9} />
            <span>{project.simulation_count} run{project.simulation_count !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>
    </button>
  )
}

function NewProjectCard({ onCreate }) {
  return (
    <button
      onClick={onCreate}
      className="
        w-full p-4 rounded-xl border border-dashed border-light-grey bg-white
        hover:border-magenta/40 transition-all group
        flex flex-col items-center justify-center gap-2 min-h-[120px]
      "
    >
      <div className="w-8 h-8 rounded-full border border-dashed border-mid-grey flex items-center justify-center group-hover:border-magenta/60 transition-colors">
        <Plus size={16} className="text-mid-grey group-hover:text-magenta transition-colors" />
      </div>
      <p className="text-caption text-mid-grey group-hover:text-magenta transition-colors font-medium">
        New Project
      </p>
    </button>
  )
}

export default function HomePage() {
  const { projects, currentProjectId, loadProject, createProject, isLoading } = useContext(ProjectContext)
  const navigate = useNavigate()

  const handleLoad = useCallback(async (id) => {
    if (id !== currentProjectId) await loadProject(id)
    navigate('/project')
  }, [currentProjectId, loadProject, navigate])

  const handleCreate = useCallback(async () => {
    await createProject()
    navigate('/building')
  }, [createProject, navigate])

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-mid-grey text-caption">
        Loading projects…
      </div>
    )
  }

  const recent = projects.slice(0, 3)
  const older  = projects.slice(3)

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-10">

        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-navy mb-1">NZA Simulate</h1>
          <p className="text-xs text-mid-grey">Building energy simulation — select a project or create a new one</p>
        </div>

        {recent.length > 0 && (
          <section className="mb-8">
            <p className="text-xxs uppercase tracking-wider text-mid-grey mb-3">
              {projects.length <= 3 ? 'Projects' : 'Recent'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {recent.map(p => (
                <ProjectCard key={p.id} project={p} isCurrent={p.id === currentProjectId} onLoad={handleLoad} />
              ))}
              {projects.length < 6 && <NewProjectCard onCreate={handleCreate} />}
            </div>
          </section>
        )}

        {older.length > 0 && (
          <section className="mb-8">
            <p className="text-xxs uppercase tracking-wider text-mid-grey mb-3">All Projects</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {older.map(p => (
                <ProjectCard key={p.id} project={p} isCurrent={p.id === currentProjectId} onLoad={handleLoad} />
              ))}
              <NewProjectCard onCreate={handleCreate} />
            </div>
          </section>
        )}

        {projects.length === 0 && (
          <div className="rounded-xl border border-dashed border-light-grey bg-white p-10 text-center">
            <Building2 size={32} className="text-light-grey mx-auto mb-3" />
            <p className="text-caption font-medium text-navy mb-1">No projects yet</p>
            <p className="text-xs text-mid-grey mb-4">Create your first building energy simulation project</p>
            <button
              onClick={handleCreate}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-navy text-white text-caption font-medium hover:bg-navy/85 transition-colors"
            >
              <Plus size={14} />
              New Project
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
