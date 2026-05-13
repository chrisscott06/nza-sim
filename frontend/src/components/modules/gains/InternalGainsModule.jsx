/**
 * InternalGainsModule.jsx — /gains route
 *
 * The State 2 input + visualisation module. Per the v2.3 state contract
 * (docs/state_contracts.md), this module owns:
 *   - building_config.occupancy.*  — first-class occupancy block
 *   - building_config.gains.*      — lighting + equipment gain definitions
 *
 * Brief 27 Part 4 — UI SCAFFOLD ONLY. Establishes the layout shell that
 * Parts 5–7 fill in. Follows docs/ui_principles.md (v1.0):
 *
 *   - Two columns: left input panel (resizable, 288px default), centre
 *     canvas (flex-1). No right column — pre-simulation results are
 *     not meaningful at the gain-definition stage; live engine output
 *     is reachable via the Heat balance / Free-running tabs instead.
 *   - Left panel uses CollapsibleSection bounding boxes (principle #4),
 *     mirroring the Building module's GEOMETRY / FABRIC / etc. pattern.
 *     Three sections: OCCUPANCY, LIGHTING, EQUIPMENT — each a separate
 *     component file so Parts 5/6 can expand them independently.
 *   - Centre canvas uses a tab strip (principle: multi-tab pattern).
 *     Five tabs: Summary | Hourly profile | Annual breakdown |
 *     Heat balance | Free-running. Tab content is placeholder until
 *     Part 7. Tabs that earn full-width data (hourly profile, free-
 *     running annual trace) use full width; tabular summaries cap at
 *     ~1000px per principle #3.
 *   - Engine toggle (Live | Simulation) lives inline with the tab title
 *     for tabs whose output depends on engine choice (Heat balance,
 *     Free-running). Pre-engine tabs (Summary inputs, Hourly profile
 *     from live-engine helpers, Annual breakdown) don't surface it.
 *
 * Brief 27 Part 9 deletes /profiles in favour of this module.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { Flame } from 'lucide-react'
import OccupancySection from './OccupancySection.jsx'
import LightingSection  from './LightingSection.jsx'
import EquipmentSection from './EquipmentSection.jsx'

const GAINS_ACCENT = '#EA580C'  // warm vermillion — internal gains

// ── Layout: resizable left column (matches Building module's contract) ──────
const LAYOUT_STORAGE_KEY = 'nza-gains-layout'
const LEFT_DEFAULT = 288
const LEFT_MIN = 220
const LEFT_MAX = 520

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)) }

function loadLayoutPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY))
    if (saved && typeof saved === 'object') {
      return {
        left: clamp(Number(saved.left) || LEFT_DEFAULT, LEFT_MIN, LEFT_MAX),
        tab:  TAB_KEYS.includes(saved.tab) ? saved.tab : 'summary',
      }
    }
  } catch {}
  return { left: LEFT_DEFAULT, tab: 'summary' }
}

function ResizeHandle({ onResize }) {
  const startX = useRef(null)
  const handleMouseDown = useCallback((e) => {
    e.preventDefault()
    startX.current = e.clientX
    const onMove = (ev) => {
      if (startX.current == null) return
      const dx = ev.clientX - startX.current
      startX.current = ev.clientX
      onResize(dx)
    }
    const onUp = () => {
      startX.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [onResize])

  return (
    <div
      className="w-1 flex-shrink-0 cursor-col-resize bg-light-grey/0 hover:bg-orange-500/40 active:bg-orange-500/60 transition-colors relative group"
      onMouseDown={handleMouseDown}
      title="Drag to resize"
    >
      <div className="absolute inset-y-0 -inset-x-1.5" />
    </div>
  )
}

// ── Left-panel section header (mirrors Building's CollapsibleSection) ───────
function CollapsibleSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left transition-opacity"
        style={{ backgroundColor: GAINS_ACCENT }}
      >
        <span className="text-white text-xxs font-semibold uppercase tracking-wider">{title}</span>
        <span className="text-white/70 text-xs leading-none">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="pt-2 pb-1 px-1">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Tab definitions ──────────────────────────────────────────────────────────
// Each tab's `fullWidth: true` means it earns the full centre canvas width
// (chart spans a year, hourly grid, etc.). `fullWidth: false` constrains to
// ~1000px per ui_principles.md #3.
const TABS = [
  { key: 'summary',     label: 'Summary',           fullWidth: false, hasEngineToggle: false },
  { key: 'hourly',      label: 'Hourly profile',    fullWidth: true,  hasEngineToggle: false },
  { key: 'breakdown',   label: 'Annual breakdown',  fullWidth: false, hasEngineToggle: false },
  { key: 'balance',     label: 'Heat balance',      fullWidth: false, hasEngineToggle: true  },
  { key: 'freerunning', label: 'Free-running',      fullWidth: true,  hasEngineToggle: true  },
]
const TAB_KEYS = TABS.map(t => t.key)

// ── Placeholder canvas content (Part 7 fills these in) ──────────────────────
function PlaceholderTab({ tab }) {
  const t = TABS.find(x => x.key === tab) ?? TABS[0]
  return (
    <div className={`mx-auto px-6 py-8 ${t.fullWidth ? 'w-full' : 'max-w-[1000px]'}`}>
      <div className="border border-dashed border-light-grey rounded-lg px-6 py-12 text-center bg-off-white/30">
        <div className="text-mid-grey text-caption">
          <Flame size={24} strokeWidth={1.5} className="mx-auto mb-3 text-orange-500/60" />
          <div className="font-semibold text-navy mb-1">{t.label}</div>
          <div className="text-xxs italic text-mid-grey/80">
            Content lands in Brief 27 Part 7.
          </div>
        </div>
      </div>

      {/* Brief preview of what this tab will hold — sets expectations for Part 7 */}
      <div className="mt-4 px-2 text-xxs text-mid-grey/70 leading-relaxed">
        {tab === 'summary' && (
          <p>
            Three stacked stat cards: total annual gain MWh (people + lighting +
            equipment), peak instantaneous gain kW, and average vs peak occupant
            count. Single-card grouping per UI principle #2; no full-width content.
          </p>
        )}
        {tab === 'hourly' && (
          <p>
            Typical-week stacked bars showing people / lighting / equipment gain
            kW for each of 7 × 24 hours, with a day-type toggle (Mon / Sat / Sun).
            Full-width — horizontal axis carries time, principle #3 exception.
          </p>
        )}
        {tab === 'breakdown' && (
          <p>
            Annual MWh by category and by month. Stacked-bar chart with the
            three gain colours threaded through inputs, charts, and balance
            flows (UI checklist Section H).
          </p>
        )}
        {tab === 'balance' && (
          <p>
            Heat-balance contribution from gains: heating offset (winter, gains
            into deficit hours), cooling add (summer, gains during surplus),
            and neutral (gains during comfort hours). Engine toggle inline.
          </p>
        )}
        {tab === 'freerunning' && (
          <p>
            Annual zone temperature trace, State 2 overlaid on State 1 baseline
            so the gain impact on T is visually obvious. Full-width — annual
            time series justifies the horizontal space. Engine toggle inline.
          </p>
        )}
      </div>
    </div>
  )
}

// ── Main module ──────────────────────────────────────────────────────────────
export default function InternalGainsModule() {
  const [prefs, setPrefs] = useState(loadLayoutPrefs)
  const { left, tab } = prefs

  // Persist layout on change
  useEffect(() => {
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(prefs)) } catch {}
  }, [prefs])

  const onResizeLeft = useCallback((dx) => {
    setPrefs(p => ({ ...p, left: clamp(p.left + dx, LEFT_MIN, LEFT_MAX) }))
  }, [])

  const setTab = useCallback((next) => setPrefs(p => ({ ...p, tab: next })), [])

  const activeTab = TABS.find(t => t.key === tab) ?? TABS[0]

  return (
    <div className="h-full flex flex-col">
      {/* ── Module header (accent bar + title + breadcrumb) ─────────────── */}
      <div
        className="h-1 flex-shrink-0"
        style={{ backgroundColor: GAINS_ACCENT }}
      />
      <div className="px-4 py-2 border-b border-light-grey bg-white flex-shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame size={16} className="text-orange-600" />
          <span className="text-caption font-semibold text-navy">Internal Gains</span>
          <span className="text-xxs text-mid-grey">— State 2 contract</span>
        </div>
        <div className="text-xxs text-mid-grey">
          <NavLink to="/building" className="hover:text-navy transition-colors">← Building</NavLink>
          <span className="mx-2">·</span>
          <NavLink to="/results" className="hover:text-navy transition-colors">Results →</NavLink>
        </div>
      </div>

      {/* ── Body: left input panel + centre canvas ──────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel */}
        <div
          className="bg-white border-r border-light-grey overflow-y-auto overflow-x-hidden flex-shrink-0"
          style={{ width: `${left}px` }}
        >
          <div className="px-3 py-2.5">
            <CollapsibleSection title="Occupancy">
              <OccupancySection />
            </CollapsibleSection>

            <CollapsibleSection title="Lighting">
              <LightingSection />
            </CollapsibleSection>

            <CollapsibleSection title="Equipment">
              <EquipmentSection />
            </CollapsibleSection>
          </div>
        </div>

        {/* Resize handle */}
        <ResizeHandle onResize={onResizeLeft} />

        {/* Centre canvas */}
        <div className="flex-1 flex flex-col overflow-hidden bg-off-white/40">
          {/* Tab strip — centred per UI principles common-pattern */}
          <div className="flex-shrink-0 border-b border-light-grey bg-white">
            <div className="flex justify-center">
              <div className="inline-flex">
                {TABS.map(t => {
                  const isActive = t.key === tab
                  return (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      className={`
                        px-4 py-2 text-caption transition-colors relative
                        ${isActive ? 'text-navy font-semibold' : 'text-mid-grey hover:text-navy'}
                      `}
                    >
                      {t.label}
                      {isActive && (
                        <span
                          className="absolute left-3 right-3 bottom-0 h-[2px] rounded-t-sm"
                          style={{ backgroundColor: GAINS_ACCENT }}
                        />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Engine toggle — placed inline with the tab strip for tabs whose
                output depends on engine choice. Empty placeholder slot until
                Part 7 wires the actual control. */}
            {activeTab.hasEngineToggle && (
              <div className="absolute right-4 top-3 text-xxs text-mid-grey italic">
                Engine toggle inline (Part 7)
              </div>
            )}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            <PlaceholderTab tab={tab} />
          </div>
        </div>
      </div>
    </div>
  )
}
