/**
 * InternalGainsModule.jsx — /gains route
 *
 * Brief 27 Revised Part 7: centre-canvas schedule editor + context-
 * sensitive tab strip. Per the v2.4 contract's UI rule, the schedule
 * editor lives in the centre canvas; the left panel holds magnitude /
 * structural inputs + a read-only mini-profile + an "Edit schedule →"
 * affordance.
 *
 * Active-section model:
 *   The first canvas tab is "Schedule" and renders the editor for the
 *   currently-active section in the left panel. Clicking a left-panel
 *   section header activates that section. Clicking a section's
 *   MiniProfile or "Edit schedule" link activates the section AND
 *   switches the centre canvas to the Schedule tab.
 *
 * Tab strip (7 tabs per the revised brief):
 *   1. Schedule: <active gain>  — context-sensitive workspace
 *   2. State 1 → State 2        — headline diagnostic, engine toggle
 *   3. Heat balance             — engine toggle
 *   4. Free-running             — full-width, engine toggle
 *   5. Hourly profile           — full-width
 *   6. Annual breakdown
 *   7. 3D Model                 — full-width
 *
 * Colour discipline (carried from Part 4 refinement):
 *   - Module accent #EA580C lives in structural surfaces only:
 *     sidebar active indicator, module title bar, tab strip underline.
 *   - Section header colours are gain-specific so each section identifies
 *     its gain at a glance.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { Flame } from 'lucide-react'
import OccupancySection from './OccupancySection.jsx'
import LightingSection  from './LightingSection.jsx'
import EquipmentSection from './EquipmentSection.jsx'
import { GAIN_COLOURS, GAIN_LABELS } from './gainColours.js'
import { useAnnualGains } from './useAnnualGains.js'
import ScheduleEditorCanvas from './canvas/ScheduleEditorCanvas.jsx'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { useContext } from 'react'

const GAINS_ACCENT = '#EA580C'

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
        left:          clamp(Number(saved.left) || LEFT_DEFAULT, LEFT_MIN, LEFT_MAX),
        tab:           TAB_KEYS.includes(saved.tab) ? saved.tab : 'schedule',
        activeSection: ['occupancy','lighting','equipment'].includes(saved.activeSection)
                         ? saved.activeSection : 'occupancy',
      }
    }
  } catch {}
  return { left: LEFT_DEFAULT, tab: 'schedule', activeSection: 'occupancy' }
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

// ── Section bounding box ────────────────────────────────────────────────────
function CollapsibleSection({ title, accent, onActivate, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  const handleClick = () => {
    if (onActivate) onActivate()
    setOpen(o => !o)
  }
  return (
    <div className="mb-2">
      <button
        onClick={handleClick}
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

// ── Tab definitions (v2.4 — 7 tabs, Schedule first + context-sensitive) ─────
const TABS = [
  { key: 'schedule',    label: 'Schedule',          fullWidth: true,  hasEngineToggle: false, isSchedule: true   },
  { key: 'delta',       label: 'State 1 → State 2', fullWidth: false, hasEngineToggle: true,  headline: true     },
  { key: 'balance',     label: 'Heat balance',      fullWidth: false, hasEngineToggle: true                       },
  { key: 'freerunning', label: 'Free-running',      fullWidth: true,  hasEngineToggle: true                       },
  { key: 'hourly',      label: 'Hourly profile',    fullWidth: true,  hasEngineToggle: false                     },
  { key: 'breakdown',   label: 'Annual breakdown',  fullWidth: false, hasEngineToggle: false                     },
  { key: '3d',          label: '3D Model',          fullWidth: true,  hasEngineToggle: false                     },
]
const TAB_KEYS = TABS.map(t => t.key)

// ── Tab content dispatcher ──────────────────────────────────────────────────
function TabContent({
  tab, activeSection, params, updateParam,
  editingExceptionId, onEnterEditMode, onExitEditMode,
}) {
  // Schedule tab — wires to the centre-canvas editor and the v2.4 contract's
  // section-of-interest data path.
  if (tab === 'schedule') {
    const accent = GAIN_COLOURS[activeSection]

    // Read schedule + onChange wiring per the active section. v2.4 multi-
    // profile arrives in Parts 9/10; for now Lighting + Equipment edit the
    // (single) gains.lighting.schedule / gains.equipment.schedule which the
    // current data model still uses.
    // v2.4 multi-profile (Part 9): Lighting + Equipment now live under
    // `gains.{category}.profiles[]`. Until Part 10 wires the multi-profile
    // selector, the Schedule tab routes to profiles[0] — the "active"
    // profile. Occupancy stays single-object (not multi-profile).
    let parentSchedule, parentOnChange, label
    if (activeSection === 'occupancy') {
      parentSchedule = params?.occupancy?.schedule
      label = GAIN_LABELS.occupancy
      parentOnChange = (next) => updateParam('occupancy', { ...(params?.occupancy ?? {}), schedule: next })
    } else if (activeSection === 'lighting' || activeSection === 'equipment') {
      const category = activeSection
      label = GAIN_LABELS[category]
      const profiles = params?.gains?.[category]?.profiles ?? []
      const activeIdx = 0  // Part 10 wires real selection
      parentSchedule = profiles[activeIdx]?.schedule
      parentOnChange = (next) => {
        const nextProfiles = profiles.slice()
        if (nextProfiles[activeIdx]) {
          nextProfiles[activeIdx] = { ...nextProfiles[activeIdx], schedule: next }
        }
        updateParam('gains', {
          ...(params?.gains ?? {}),
          [category]: { ...(params?.gains?.[category] ?? {}), profiles: nextProfiles },
        })
      }
    }

    // Resolve the currently-edited exception (if any). Stale ID falls
    // through to default-mode rendering and the next render clears it.
    const editingException = editingExceptionId
      ? (parentSchedule?.exceptions ?? []).find(e => e.id === editingExceptionId) ?? null
      : null

    // Exception writer: replaces the matching exception in
    // parentSchedule.exceptions[] with patched curve fields.
    const exceptionOnChange = (curvePatch) => {
      if (!editingException || !parentOnChange || !parentSchedule) return
      const nextExceptions = (parentSchedule.exceptions ?? []).map(e =>
        e.id === editingException.id ? { ...e, ...curvePatch } : e
      )
      parentOnChange({ ...parentSchedule, exceptions: nextExceptions })
    }

    return (
      <ScheduleEditorCanvas
        gainType={activeSection}
        gainLabel={label}
        parentSchedule={parentSchedule}
        parentOnChange={parentOnChange}
        editingException={editingException}
        exceptionOnChange={exceptionOnChange}
        onEnterEditMode={onEnterEditMode}
        onExitEditMode={onExitEditMode}
        accent={accent}
      />
    )
  }

  // All other tabs — placeholder until Brief 27 Revised Part 11 builds them out.
  const t = TABS.find(x => x.key === tab) ?? TABS[0]
  return (
    <div className={`mx-auto px-6 py-8 ${t.fullWidth ? 'w-full' : 'max-w-[1000px]'}`}>
      <div className="border border-dashed border-light-grey rounded-lg px-6 py-12 text-center bg-off-white/30">
        <Flame size={24} strokeWidth={1.5} className="mx-auto mb-3 text-orange-500/60" />
        <div className="font-semibold text-navy mb-1">
          {t.label} {t.headline && <span className="text-xxs text-orange-600 ml-1">· HEADLINE</span>}
        </div>
        <div className="text-xxs italic text-mid-grey/80">
          Lands in Brief 27 Revised Part 11.
        </div>
      </div>
      <div className="mt-4 px-2 text-xxs text-mid-grey/70 leading-relaxed">
        {tab === 'delta' && (
          <p><strong className="text-navy/80">Headline diagnostic.</strong> Bar-pair view: "Internal gains reduce heating by X MWh, increase cooling by Y MWh," plus per-profile attribution (which load type contributed most). Engine toggle inline.</p>
        )}
        {tab === 'balance' && <p>Gains in the full heat balance flow: where each gain category lands relative to fabric losses, solar gain, and the comfort band. Engine toggle inline.</p>}
        {tab === 'freerunning' && <p>Annual zone temperature trace, State 2 overlaid on State 1 baseline so the gain impact is visually obvious. Full-width, engine toggle inline.</p>}
        {tab === 'hourly' && <p>Typical-week stacked bars showing people / lighting / equipment gain kW for each of 7 × 24 hours, with day-type and month selectors.</p>}
        {tab === 'breakdown' && <p>Annual MWh by category and by month. Stacked-bar chart with the three gain colours (purple / gold / orange).</p>}
        {tab === '3d' && <p>3D zone model with gain heatmaps painted onto surfaces (where applicable). Useful at multi-zone but informational at single-zone.</p>}
      </div>
    </div>
  )
}

// ── Main module ──────────────────────────────────────────────────────────────
export default function InternalGainsModule() {
  const [prefs, setPrefs] = useState(loadLayoutPrefs)
  const { left, tab, activeSection } = prefs

  // Brief 27 Revised Part 8: which exception (if any) is being edited
  // in the centre canvas. Not persisted to localStorage — edit mode
  // is a session-local activity, not a project setting.
  const [editingExceptionId, setEditingExceptionId] = useState(null)

  const { params, updateParam } = useContext(ProjectContext)
  const annual = useAnnualGains()

  useEffect(() => {
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(prefs)) } catch {}
  }, [prefs])

  const onResizeLeft = useCallback((dx) => {
    setPrefs(p => ({ ...p, left: clamp(p.left + dx, LEFT_MIN, LEFT_MAX) }))
  }, [])

  // Any tab change or section change exits exception edit mode — keeps the
  // banner from persisting into a context where it no longer makes sense.
  const setTab = useCallback((next) => {
    setEditingExceptionId(null)
    setPrefs(p => ({ ...p, tab: next }))
  }, [])
  const setActiveSection = useCallback((next) => {
    setEditingExceptionId(null)
    setPrefs(p => ({ ...p, activeSection: next }))
  }, [])
  const onEditSchedule = useCallback((section) => {
    setEditingExceptionId(null)
    setPrefs(p => ({ ...p, activeSection: section, tab: 'schedule' }))
  }, [])

  const onEnterEditMode = useCallback((excId) => setEditingExceptionId(excId), [])
  const onExitEditMode  = useCallback(() => setEditingExceptionId(null), [])

  const activeTab = TABS.find(t => t.key === tab) ?? TABS[0]
  const scheduleTabLabel = `Schedule: ${GAIN_LABELS[activeSection] ?? '—'}`

  return (
    <div className="h-full flex flex-col">
      {/* Module header */}
      <div className="h-1 flex-shrink-0" style={{ backgroundColor: GAINS_ACCENT }} />
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

      {/* Body: left panel + centre canvas */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel */}
        <div
          className="bg-white border-r border-light-grey overflow-y-auto overflow-x-hidden flex-shrink-0"
          style={{ width: `${left}px` }}
        >
          <div className="px-3 py-2.5">
            <CollapsibleSection
              title="Occupancy"
              accent={GAIN_COLOURS.occupancy}
              onActivate={() => setActiveSection('occupancy')}
            >
              <OccupancySection
                annual={annual}
                onEditSchedule={() => onEditSchedule('occupancy')}
              />
            </CollapsibleSection>

            <CollapsibleSection
              title="Lighting"
              accent={GAIN_COLOURS.lighting}
              onActivate={() => setActiveSection('lighting')}
            >
              <LightingSection
                annual={annual}
                onEditSchedule={() => onEditSchedule('lighting')}
              />
            </CollapsibleSection>

            <CollapsibleSection
              title="Equipment"
              accent={GAIN_COLOURS.equipment}
              onActivate={() => setActiveSection('equipment')}
            >
              <EquipmentSection
                annual={annual}
                onEditSchedule={() => onEditSchedule('equipment')}
              />
            </CollapsibleSection>
          </div>
        </div>

        <ResizeHandle onResize={onResizeLeft} />

        {/* Centre canvas */}
        <div className="flex-1 flex flex-col overflow-hidden bg-off-white/40">
          {/* Tab strip — context-sensitive Schedule label */}
          <div className="flex-shrink-0 border-b border-light-grey bg-white relative">
            <div className="flex justify-center">
              <div className="inline-flex">
                {TABS.map(t => {
                  const isActive = t.key === tab
                  const label = t.isSchedule ? scheduleTabLabel : t.label
                  return (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      className={`
                        px-4 py-2 text-caption transition-colors relative
                        ${isActive ? 'text-navy font-semibold' : 'text-mid-grey hover:text-navy'}
                      `}
                    >
                      {label}
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

            {activeTab.hasEngineToggle && (
              <div className="absolute right-4 top-2 text-xxs text-mid-grey italic">
                Engine toggle inline (Part 11)
              </div>
            )}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            <TabContent
              tab={tab}
              activeSection={activeSection}
              params={params}
              updateParam={updateParam}
              editingExceptionId={editingExceptionId}
              onEnterEditMode={onEnterEditMode}
              onExitEditMode={onExitEditMode}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
