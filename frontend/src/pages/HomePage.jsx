import { useContext } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Thermometer, BarChart3, ArrowRight, Play, Clock } from 'lucide-react'
import { ProjectContext } from '../context/ProjectContext.jsx'
import { SimulationContext } from '../context/SimulationContext.jsx'

function formatDate(ts) {
  if (!ts) return '—'
  const d = new Date(ts.replace(' ', 'T') + 'Z')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function MetricPill({ label, value, unit }) {
  if (value == null) return null
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-navy/5 text-xs text-navy">
      <span className="font-semibold">{typeof value === 'number' ? value.toFixed(1) : value}</span>
      <span className="text-mid-grey">{unit}</span>
      <span className="text-mid-grey text-xs">{label}</span>
    </span>
  )
}

const QUICK_LINKS = [
  {
    href: '/building',
    icon: <Building2 size={20} />,
    title: 'Define Building',
    description: 'Set geometry, fabric and orientation',
    colour: 'text-blue-600 bg-blue-50',
  },
  {
    href: '/systems',
    icon: <Thermometer size={20} />,
    title: 'Configure Systems',
    description: 'HVAC, ventilation, DHW and lighting',
    colour: 'text-teal-600 bg-teal-50',
  },
  {
    href: '/results',
    icon: <BarChart3 size={20} />,
    title: 'View Results',
    description: 'Energy flows, profiles and analysis',
    colour: 'text-magenta bg-pink-50',
  },
]

export default function HomePage() {
  const projectCtx = useContext(ProjectContext)
  const simCtx     = useContext(SimulationContext)

  const project         = projectCtx?.currentProjectId ? {
    name:        projectCtx?.params?.name,
    created_at:  projectCtx?.projects?.find(p => p.id === projectCtx.currentProjectId)?.created_at,
    updated_at:  projectCtx?.projects?.find(p => p.id === projectCtx.currentProjectId)?.updated_at,
  } : null
  const simulations     = projectCtx?.projects?.find(p => p.id === projectCtx?.currentProjectId)
  const hasRuns         = simCtx?.results != null
  const latestResults   = simCtx?.results

  if (projectCtx?.isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-mid-grey text-caption">
        Loading project…
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-8 max-w-3xl mx-auto">
      {/* Project header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-navy mb-1">
          {project?.name ?? 'NZA Simulate'}
        </h1>
        <div className="flex items-center gap-4 text-xs text-mid-grey">
          {project?.created_at && (
            <span>Created {formatDate(project.created_at)}</span>
          )}
          {project?.updated_at && (
            <span className="flex items-center gap-1">
              <Clock size={11} />
              Last updated {formatDate(project.updated_at)}
            </span>
          )}
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {QUICK_LINKS.map(link => (
          <Link
            key={link.href}
            to={link.href}
            className="
              flex flex-col gap-3 p-4 rounded-xl border border-light-grey
              bg-white hover:border-magenta/30 hover:shadow-sm transition-all group
            "
          >
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${link.colour}`}>
              {link.icon}
            </div>
            <div>
              <p className="text-caption font-semibold text-navy group-hover:text-magenta transition-colors flex items-center gap-1">
                {link.title}
                <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
              </p>
              <p className="text-xs text-mid-grey mt-0.5">{link.description}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Simulation summary / getting started */}
      {hasRuns && latestResults ? (
        <div className="bg-white border border-light-grey rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-caption font-semibold text-navy">Latest Simulation</h2>
            <Link
              to="/results"
              className="text-xs text-magenta hover:underline flex items-center gap-1"
            >
              View full results <ArrowRight size={11} />
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            <MetricPill
              label="EUI"
              value={latestResults.summary?.eui_kWh_per_m2}
              unit="kWh/m²"
            />
            <MetricPill
              label="Heating"
              value={latestResults.summary?.heating_kWh != null
                ? Math.round(latestResults.summary.heating_kWh / 1000)
                : null}
              unit="MWh"
            />
            <MetricPill
              label="Cooling"
              value={latestResults.summary?.cooling_kWh != null
                ? Math.round(latestResults.summary.cooling_kWh / 1000)
                : null}
              unit="MWh"
            />
            <MetricPill
              label="GIA"
              value={latestResults.summary?.gia_m2}
              unit="m²"
            />
          </div>
        </div>
      ) : (
        <div className="bg-white border border-light-grey rounded-xl p-6">
          <h2 className="text-caption font-semibold text-navy mb-1">Getting started</h2>
          <p className="text-xs text-mid-grey mb-4">Follow these steps to run your first simulation.</p>
          <ol className="space-y-3">
            {[
              { step: '1', label: 'Define building geometry',    href: '/building', desc: 'Set floor dimensions, number of floors, height, and orientation' },
              { step: '2', label: 'Select fabric constructions', href: '/building', desc: 'Choose walls, roof, floor, and glazing from the construction library' },
              { step: '3', label: 'Configure systems',           href: '/systems',  desc: 'Choose HVAC, ventilation, DHW, and set lighting power density' },
              { step: '4', label: 'Run simulation',              href: null,        desc: 'Click "Run Simulation" in the top bar — EnergyPlus runs in seconds' },
              { step: '5', label: 'View results',                href: '/results',  desc: 'Explore load profiles, energy flows, fabric analysis, and carbon trajectory' },
            ].map(item => (
              <li key={item.step} className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-navy text-white flex-shrink-0 flex items-center justify-center text-xs font-semibold">
                  {item.step}
                </span>
                <div>
                  {item.href ? (
                    <Link to={item.href} className="text-caption font-medium text-navy hover:text-magenta transition-colors">
                      {item.label} →
                    </Link>
                  ) : (
                    <span className="text-caption font-medium text-navy">{item.label}</span>
                  )}
                  <p className="text-xs text-mid-grey mt-0.5">{item.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
