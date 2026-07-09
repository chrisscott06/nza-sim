import { NavLink, useLocation } from 'react-router-dom'
import {
  Home,
  ClipboardList,
  Building2,
  Wind,
  Thermometer,
  Flame,
  FileSpreadsheet,
  BarChart3,
  BookOpen,
  Cloud,
  Route as RouteIcon,
  Layers,
} from 'lucide-react'
import { accentForPath } from '../../data/moduleThemes.js'

// Sidebar grouping — inputs (top) → outputs (middle) → reference (bottom)
//
// Two separator lines split the sidebar into three visual groups:
//   • INPUT_ITEMS    — things you set up to define the building
//   • OUTPUT_ITEMS   — analysis tabs that depend on a configured baseline
//   • Library        — global reference, pinned to the very bottom
//
// History:
//   • Brief 27 Part 7  — input-to-output workflow established.
//   • Brief 41 (2026-05-20) — /scenarios removed, /interventions added.
//   • Plan Part C  (2026-05-28) — Consumption + CRREM hoisted from a
//     separate bottom group into the main inputs/outputs grouping. All
//     route names left as-is (no Profiles/Scenarios renames).
//
// "Overview" is a label rename of the existing /information route — the URL
// stays /information for backward compatibility.
const INPUT_ITEMS = [
  { to: '/',            icon: Home,            label: 'Home' },
  { to: '/information', icon: ClipboardList,   label: 'Overview' },
  { to: '/weather',     icon: Cloud,           label: 'Weather' },
  { to: '/building',    icon: Building2,       label: 'Building' },
  { to: '/gains',       icon: Flame,           label: 'Internal Gains' },
  { to: '/operation',   icon: Wind,            label: 'Operation' },
  { to: '/systems',     icon: Thermometer,     label: 'Systems' },
  { to: '/consumption', icon: FileSpreadsheet, label: 'Consumption' },
]

const OUTPUT_ITEMS = [
  { to: '/results',     icon: BarChart3,       label: 'Results' },
  // Brief 41 — Interventions: Pattern Y declarative patches against the
  // baseline; engine runs cumulative state for each enabled intervention.
  { to: '/interventions', icon: Layers,        label: 'Interventions' },
  // Brief 28-IM IM-M6 — Retrofit Roadmap: sequenced interventions against
  // CRREM 1.5°C target with per-year leave-one-out marginal attribution.
  { to: '/roadmap',     icon: RouteIcon,       label: 'Roadmap' },
]

function NavItem({ to, icon: Icon, label }) {
  const location = useLocation()
  // Exact match for root, prefix match for others
  const isActive = to === '/'
    ? location.pathname === '/'
    : location.pathname.startsWith(to)

  // Use current path's accent for active indicator (shows active module colour)
  const accent = accentForPath(location.pathname)

  return (
    <div className="relative group">
      <NavLink
        to={to}
        className={`
          flex items-center justify-center w-full h-11
          transition-colors duration-150 relative
          ${isActive
            ? 'bg-white/10'
            : 'hover:bg-white/6'
          }
        `}
      >
        {/* Module-coloured active indicator */}
        {isActive && (
          <span
            className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full"
            style={{ backgroundColor: accent }}
          />
        )}
        <Icon
          size={18}
          strokeWidth={isActive ? 2 : 1.5}
          className={isActive ? 'text-white' : 'text-white/55'}
        />
      </NavLink>

      {/* Tooltip */}
      <div
        className="
          pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50
          px-2 py-1 rounded text-xxs font-medium text-white bg-navy border border-white/10
          whitespace-nowrap shadow-lg
          opacity-0 group-hover:opacity-100 transition-opacity duration-150 delay-300
        "
      >
        {label}
      </div>
    </div>
  )
}

export default function Sidebar() {
  return (
    <nav className="w-14 min-h-screen bg-navy flex flex-col flex-shrink-0 select-none">
      {/* Logo mark */}
      <NavLink
        to="/"
        className="h-12 flex items-center justify-center border-b border-white/8 hover:bg-white/8 transition-colors"
        title="Projects"
      >
        <span className="text-white font-medium text-caption tracking-widest">N</span>
      </NavLink>

      {/* Input modules (top) */}
      <div className="flex flex-col pt-1">
        {INPUT_ITEMS.map(item => (
          <NavItem key={item.to} {...item} />
        ))}
      </div>

      {/* Divider — inputs / outputs */}
      <div className="my-2 mx-3 border-t border-white/12" />

      {/* Output modules (middle) */}
      <div className="flex flex-col">
        {OUTPUT_ITEMS.map(item => (
          <NavItem key={item.to} {...item} />
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Library — separated at the very bottom */}
      <div className="my-2 mx-3 border-t border-white/12" />
      <div className="pb-2">
        <NavItem to="/library" icon={BookOpen} label="Library" />
      </div>
    </nav>
  )
}
