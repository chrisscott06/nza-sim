import { NavLink, useLocation } from 'react-router-dom'
import {
  Home,
  Building2,
  Thermometer,
  Clock,
  FileSpreadsheet,
  BarChart3,
  GitCompare,
  BookOpen,
} from 'lucide-react'
import { accentForPath } from '../../data/moduleThemes.js'

const TOP_ITEMS = [
  { to: '/',         icon: Home,        label: 'Home' },
  { to: '/building', icon: Building2,   label: 'Building' },
  { to: '/systems',  icon: Thermometer, label: 'Systems' },
  { to: '/profiles', icon: Clock,       label: 'Profiles' },
]

const BOTTOM_ITEMS = [
  { to: '/consumption', icon: FileSpreadsheet, label: 'Consumption' },
  { to: '/results',     icon: BarChart3,       label: 'Results'     },
  { to: '/scenarios',   icon: GitCompare,      label: 'Scenarios'   },
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

      {/* Top navigation items */}
      <div className="flex flex-col pt-1">
        {TOP_ITEMS.map(item => (
          <NavItem key={item.to} {...item} />
        ))}
      </div>

      {/* Divider */}
      <div className="my-2 mx-3 border-t border-white/12" />

      {/* Bottom navigation items (output modules) */}
      <div className="flex flex-col">
        {BOTTOM_ITEMS.map(item => (
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
