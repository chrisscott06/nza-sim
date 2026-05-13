/**
 * InternalGainsModule.jsx — /gains route
 *
 * The State 2 input + visualisation module. Per the v2.3 state contract
 * (docs/state_contracts.md), this module owns:
 *   - building_config.occupancy.*  — first-class occupancy block
 *   - building_config.gains.*      — lighting + equipment gain definitions
 *
 * Brief 27 Part 4 — UI SCAFFOLD with live input-side feedback. Establishes
 * the layout shell that Parts 5–7 fill in. Follows docs/ui_principles.md (v1.0).
 *
 * Colour discipline (per Brief 27 Part 4 feedback):
 *   - Module accent (#EA580C vermillion) lives ONLY in structural surfaces:
 *     sidebar active indicator, module title bar, tab strip underline.
 *   - Section header colours are GAIN-SPECIFIC (purple / gold / orange),
 *     so the section header colour identifies which gain you're
 *     configuring without reading the title.
 *   - Brief 28 cross-cutting design pass will decide whether to harmonise
 *     INTERNAL_COLOURS in `data/balanceColours.js` (currently all violet
 *     shades — fine for Heat Balance stacks; suboptimal here).
 *
 * Live input-side readout: each section card shows annual MWh + peak kW
 * for its category, recomputing on every input change via the
 * `useAnnualGains` hook. This is INPUT-SIDE feedback — not pre-simulation
 * results — equivalent to a U-value badge updating as you swap
 * construction layers. Different concept from the dropped right results
 * panel.
 *
 * Brief 27 Part 9 deletes /profiles in favour of this module.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { Flame } from 'lucide-react'
import OccupancySection from './OccupancySection.jsx'
import LightingSection  from './LightingSection.jsx'
import EquipmentSection from './EquipmentSection.jsx'
import { GAIN_COLOURS } from './gainColours.js'
import { useAnnualGains } from './useAnnualGains.js'

const GAINS_ACCENT = '#EA580C'  // structural module identity — vermillion

// ── Layout: resizable left column ────────────────────────────────────────────
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
        tab:  TAB_KEYS.includes(saved.tab) ? saved.tab : 'delta',
      }
    }
  } catch {}
  return { left: LEFT_DEFAULT, tab: 'delta' }
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

// ── Section bounding box (gain-coloured header, mirrors Building pattern) ───
function CollapsibleSection({ title, accent, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left transition-opacity"
        style={{ backgroundColor: accent }}
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
//
// `fullWidth: true` → tab content earns full centre canvas width (horizontal
// data: time-series, hourly grids). Per ui_principles.md #3 exception.
// `fullWidth: false` → tab content constrained to ~1000px max.
//
// Order: Delta first because it's the headline State 2 diagnostic that
// answers "what does adding gains do to the building?". Summary second
// is the input-configuration overview that pairs naturally with the
// left-panel inputs. The remaining four tabs are progressively more
// detailed views.
const TABS = [
  { key: 'delta',       label: 'State 1 → State 2', fullWidth: false, hasEngineToggle: true,  headline: true  },
  { key: 'summary',     label: 'Summary',           fullWidth: false, hasEngineToggle: false, headline: false },
  { key: 'hourly',      label: 'Hourly profile',    fullWidth: true,  hasEngineToggle: false, headline: false },
  { key: 'breakdown',   label: 'Annual breakdown',  fullWidth: false, hasEngineToggle: false, headline: false },
  { key: 'balance',     label: 'Heat balance',      fullWidth: false, hasEngineToggle: true,  headline: false },
  { key: 'freerunning', label: 'Free-running',      fullWidth: true,  hasEngineToggle: true,  headline: false },
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
          <div className="font-semibold text-navy mb-1">
            {t.label} {t.headline && <span className="text-xxs text-orange-600 ml-1">· HEADLINE</span>}
          </div>
          <div className="text-xxs italic text-mid-grey/80">
            Content lands in Brief 27 Part 7.
          </div>
        </div>
      </div>

      {/* Brief preview of what this tab will hold — sets expectations for Part 7 */}
      <div className="mt-4 px-2 text-xxs text-mid-grey/70 leading-relaxed">
        {tab === 'delta' && (
          <>
            <p className="font-medium text-navy/80 mb-1">Headline diagnostic for State 2.</p>
            <p>
              A bar-pair showing how internal gains change demand vs the
              State 1 envelope-only baseline: "Internal gains reduce
              heating by X MWh, increase cooling by Y MWh." Plus overheating-
              hours change, comfort-hours change, and annual-mean
              free-running temperature shift. State 1 ↔ State 2 numbers
              side-by-side so the contribution is unambiguous. Engine
              toggle inline (live vs simulation deltas should agree to
              within ~10%).
            </p>
          </>
        )}
        {tab === 'summary' && (
          <p>
            Input-configuration overview as a single multi-row card per UI
            principle #2 — total annual gain MWh, peak instantaneous kW,
            avg vs peak occupant count, effective LPD. Pairs with the
            left-panel sections without duplicating their card-internal
            readouts.
          </p>
        )}
        {tab === 'hourly' && (
          <p>
            Typical-week stacked bars showing people / lighting / equipment
            gain kW for each of 7 × 24 hours, with a day-type toggle
            (Mon / Sat / Sun) and month selector. Full-width — horizontal
            axis carries time, principle #3 exception.
          </p>
        )}
        {tab === 'breakdown' && (
          <p>
            Annual MWh by category and by month. Stacked-bar chart with
            the three gain colours (purple / gold / orange) threaded
            through inputs, charts, and balance flows (UI checklist
            Section H).
          </p>
        )}
        {tab === 'balance' && (
          <p>
            Gains in the full heat balance flow: where each gain category
            lands (heating offset / cooling add / comfort-hour neutral)
            relative to fabric losses, solar gain, and the comfort band.
            Engine toggle inline.
          </p>
        )}
        {tab === 'freerunning' && (
          <p>
            Annual zone temperature trace, State 2 overlaid on State 1
            baseline so the gain impact on T_op is visually obvious. Full-
            width — annual time series justifies the horizontal space.
            Engine toggle inline.
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

  // Live input-side readout — single hook call, results passed down to
  // each section card via prop (avoids 3× duplicate 8760-hour loops).
  const annual = useAnnualGains()

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
      {/* ── Module header (vermillion structural accent + title) ────────── */}
      <div
        className="h-1 flex-shrink-0"
        style={{ backgroundColor: GAINS_ACCENT }}
      />
      <div className="px-4 py-2 border-b border-light-grey bg-white flex-shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame size={16} style={{ color: GAINS_ACCENT }} />
          <span className="text-caption font-semibold text-navy">Internal Gains</span>
          <span className="text-xxs text-mid-grey">— State 2 contract</span>
        </div>
        <div className="text-xxs text-mid-grey">
          <NavLink to="/building" className="hover:text-navy transition-colors">← Building</NavLink>
          <span className="mx-2">·</span>
          <NavLink to="/operation" className="hover:text-navy transition-colors">Operation →</NavLink>
        </div>
      </div>

      {/* ── Body: left input panel + centre canvas ──────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel — each section gets a gain-specific colour header */}
        <div
          className="bg-white border-r border-light-grey overflow-y-auto overflow-x-hidden flex-shrink-0"
          style={{ width: `${left}px` }}
        >
          <div className="px-3 py-2.5">
            <CollapsibleSection title="Occupancy" accent={GAIN_COLOURS.occupancy}>
              <OccupancySection annual={annual} />
            </CollapsibleSection>

            <CollapsibleSection title="Lighting" accent={GAIN_COLOURS.lighting}>
              <LightingSection annual={annual} />
            </CollapsibleSection>

            <CollapsibleSection title="Equipment" accent={GAIN_COLOURS.equipment}>
              <EquipmentSection annual={annual} />
            </CollapsibleSection>
          </div>
        </div>

        {/* Resize handle */}
        <ResizeHandle onResize={onResizeLeft} />

        {/* Centre canvas */}
        <div className="flex-1 flex flex-col overflow-hidden bg-off-white/40">
          {/* Tab strip — centred, with structural vermillion underline */}
          <div className="flex-shrink-0 border-b border-light-grey bg-white relative">
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

            {/* Engine toggle slot — appears only for engine-dependent tabs.
                Part 7 wires the actual segmented control. */}
            {activeTab.hasEngineToggle && (
              <div className="absolute right-4 top-2 text-xxs text-mid-grey italic">
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
