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
import SummaryView         from './canvas/SummaryView.jsx'
// DeltaView removed from imports — its content lives in SummaryView as of
// Brief 28a Part 3b (2026-05-14). File kept on disk as deprecated; will be
// deleted at Brief 28a Part 7 close-out.
import LoadShapeView       from './canvas/LoadShapeView.jsx'
// Brief 28a Part 3c (2026-05-14): FreeRunningView + HourlyProfileView +
// AnnualBreakdownView are now consumed by LoadShapeView's internal sub-view
// toggle. The three files stay on disk for now (LoadShapeView imports them);
// Parts 4-5 will replace them with a unified Pablo-pattern time-series view.
import HeatBalanceView     from './canvas/HeatBalanceView.jsx'
// Brief 28a Part 3d (2026-05-14): ThreeDView import removed — '3d' tab
// dropped from the tab strip. ThreeDView.jsx kept on disk (no multi-zone
// content yet; placeholder removed until that brief lands).
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
  // Brief 28a Part 3a (2026-05-14): default tab flipped 'schedule' → 'summary'.
  // Summary is the new headline landing tab. Schedule remains accessible but
  // is no longer the default — users land on outputs, not the editor.
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY))
    if (saved && typeof saved === 'object') {
      return {
        left:          clamp(Number(saved.left) || LEFT_DEFAULT, LEFT_MIN, LEFT_MAX),
        tab:           TAB_KEYS.includes(saved.tab) ? saved.tab : 'summary',
        activeSection: ['occupancy','lighting','equipment'].includes(saved.activeSection)
                         ? saved.activeSection : 'occupancy',
      }
    }
  } catch {}
  return { left: LEFT_DEFAULT, tab: 'summary', activeSection: 'occupancy' }
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

// ── Tab definitions ─────────────────────────────────────────────────────────
// Brief 28a Part 3a (2026-05-14): new Summary tab inserted as the headline.
// Brief 28a Part 3b (2026-05-14): 'delta' tab removed — content folded
//   into Summary (paired bars + comfort impact + per-gain attribution +
//   new gains-vs-demand stacked bar with unit toggle).
// Brief 28a Part 3c (2026-05-14): 'freerunning' + 'hourly' + 'breakdown'
//   consolidated into a single 'loadshape' tab with an internal sub-view
//   toggle. The three sub-components remain reachable via the toggle.
//   Parts 4-5 will rewrite this as a unified Pablo time-series view.
// Brief 28a Part 3d (2026-05-14): '3d' tab removed (no multi-zone content
//   yet; placeholder removed until that brief lands). ThreeDView.jsx kept
//   on disk for future revival. Tab 'loadshape' renamed user-facing label
//   to 'Conditions' (Chris: "Load shape" is industry jargon; "Conditions"
//   is accurate, doesn't lock to a single lens, and the eventual unified
//   viewport in Parts 4-5 will host temperature traces + profiles +
//   hourly distributions etc. -- all conditions). Internal key 'loadshape'
//   kept stable so saved layout prefs don't lose state.
const TABS = [
  { key: 'schedule',    label: 'Schedule',     fullWidth: true,  hasEngineToggle: false, isSchedule: true                  },
  { key: 'summary',     label: 'Summary',      fullWidth: false, hasEngineToggle: true,  headline: true                    },
  { key: 'balance',     label: 'Heat balance', fullWidth: false, hasEngineToggle: true                                     },
  { key: 'loadshape',   label: 'Conditions',   fullWidth: true,  hasEngineToggle: true                                     },
]
const TAB_KEYS = TABS.map(t => t.key)

// ── Tab content dispatcher ──────────────────────────────────────────────────
function TabContent({
  tab, activeSection, params, updateParam,
  editingExceptionId, onEnterEditMode, onExitEditMode,
  activeLightingId, activeEquipmentId,
  onActiveLightingChange, onActiveEquipmentChange,
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
      const activeProfileId = category === 'lighting' ? activeLightingId : activeEquipmentId
      // Resolve the active profile by id; fall back to profiles[0] when no
      // explicit selection (typical first-load case) or when the active id
      // has been deleted (recovery).
      const activeIdx = (() => {
        if (activeProfileId) {
          const idx = profiles.findIndex(p => p.id === activeProfileId)
          if (idx >= 0) return idx
        }
        return 0
      })()
      parentSchedule = profiles[activeIdx]?.schedule
      // Tag the active profile in the canvas header so the user can see
      // which profile they're authoring even when the canvas is the only
      // visible surface.
      label = `${GAIN_LABELS[category]}${profiles.length > 1 ? ` · ${profiles[activeIdx]?.label ?? ''}` : ''}`
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

    // Part 10 wiring: pass per-section profile selector + area coverage.
    let profileSelector = null
    let areaShareTotal  = null
    if (activeSection === 'lighting' || activeSection === 'equipment') {
      const category = activeSection
      const profiles = params?.gains?.[category]?.profiles ?? []
      const activeId = category === 'lighting' ? activeLightingId : activeEquipmentId
      const onChange = category === 'lighting' ? onActiveLightingChange : onActiveEquipmentChange
      profileSelector = {
        profiles: profiles.map(p => ({ id: p.id, label: p.label })),
        activeId,
        onChange,
      }
      areaShareTotal = profiles.reduce((s, p) => s + Number(p.area_share ?? 0), 0)
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
        profileSelector={profileSelector}
        areaShareTotal={areaShareTotal}
      />
    )
  }

  // Brief 27 Revised Part 11: real canvas views. Brief 28a Part 3a adds
  // Summary. Part 3b removes 'delta' (content folded into Summary).
  // Part 3c collapses 'freerunning' / 'hourly' / 'breakdown' into 'loadshape'.
  // Part 3d removes '3d' tab (ThreeDView.jsx kept on disk for future revival).
  switch (tab) {
    case 'summary':   return <SummaryView />
    case 'loadshape': return <LoadShapeView />
    case 'balance':   return <HeatBalanceView />
    default:          return null
  }
}

// ── Main module ──────────────────────────────────────────────────────────────
export default function InternalGainsModule() {
  const [prefs, setPrefs] = useState(loadLayoutPrefs)
  const { left, tab, activeSection } = prefs

  // Brief 27 Revised Part 8: which exception (if any) is being edited
  // in the centre canvas. Not persisted to localStorage — edit mode
  // is a session-local activity, not a project setting.
  const [editingExceptionId, setEditingExceptionId] = useState(null)

  // Brief 27 Revised Part 10: active profile id per category. Session-
  // local; defaults to first profile on first render via the section
  // components. Drives the centre-canvas Schedule tab + the per-section
  // active-profile highlight.
  const [activeLightingId,  setActiveLightingId]  = useState(null)
  const [activeEquipmentId, setActiveEquipmentId] = useState(null)

  const { params, updateParam } = useContext(ProjectContext)
  const annual = useAnnualGains()

  useEffect(() => {
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(prefs)) } catch {}
  }, [prefs])

  // Auto-select the first profile per category on mount (or after the
  // active one is deleted). Keeps the centre-canvas Schedule tab and the
  // section's active highlight aligned with a real profile.
  useEffect(() => {
    const lightingProfiles = params?.gains?.lighting?.profiles ?? []
    if (lightingProfiles.length > 0 && !lightingProfiles.find(p => p.id === activeLightingId)) {
      setActiveLightingId(lightingProfiles[0].id)
    }
  }, [params?.gains?.lighting?.profiles, activeLightingId])

  useEffect(() => {
    const equipmentProfiles = params?.gains?.equipment?.profiles ?? []
    if (equipmentProfiles.length > 0 && !equipmentProfiles.find(p => p.id === activeEquipmentId)) {
      setActiveEquipmentId(equipmentProfiles[0].id)
    }
  }, [params?.gains?.equipment?.profiles, activeEquipmentId])

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
                activeProfileId={activeLightingId}
                onSelectProfile={setActiveLightingId}
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
                activeProfileId={activeEquipmentId}
                onSelectProfile={setActiveEquipmentId}
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
              activeLightingId={activeLightingId}
              activeEquipmentId={activeEquipmentId}
              onActiveLightingChange={setActiveLightingId}
              onActiveEquipmentChange={setActiveEquipmentId}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
