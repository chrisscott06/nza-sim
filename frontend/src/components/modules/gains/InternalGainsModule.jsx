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
import AuxiliarySection from './AuxiliarySection.jsx'
import { GAIN_COLOURS, GAIN_LABELS } from './gainColours.js'
import { useAnnualGains } from './useAnnualGains.js'
// Brief 37 Part 3 (2026-05-18): ScheduleEditorCanvas swapped for the
// shared UnifiedScheduleEditor. ScheduleEditorCanvas + its tab-host
// helpers are slated for deletion in Brief 37 Part 4 once Chris's
// walkthrough confirms parity.
import UnifiedScheduleEditor from '../../shared/scheduleEditor/UnifiedScheduleEditor.jsx'
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
import MonthlyView         from './canvas/MonthlyView.jsx'
// Brief 28a Part 3d (2026-05-14): ThreeDView import removed — '3d' tab
// dropped from the tab strip. ThreeDView.jsx kept on disk (no multi-zone
// content yet; placeholder removed until that brief lands).
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { useContext } from 'react'
// Brief 28-IM-Polish POL-M2: shared cross-module strip + chart-consistency
// components from POL-M1. Used here to align Internal Gains with Building's
// reference pattern (always-visible KPI strip + Static/Dynamic pill +
// totals badge on every chart).
import LiveResultsStrip from '../../shared/LiveResultsStrip.jsx'
import { useStateComparison } from './canvas/useStateComparison.js'
// Brief 36 Part 3 (2026-05-18): shared draggable pop-out chrome. Replaces
// the centre-canvas "Schedule" tab — the editor now opens as a movable
// floating panel via the existing Edit-schedule links in the left panel,
// per the §3.4 alternative. Tab strip drops from 5 tabs to 4.
import SchedulePopout from '../../shared/SchedulePopout.jsx'

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
// Inline-polish 2026-05-20: supports controlled open/onToggle for the
// single-expand accordion pattern used in the left panel. When isOpen +
// onToggle are provided, parent manages state (only one section open at
// a time across the panel). When omitted, falls back to local state for
// any callers that want independent collapse/expand.
function CollapsibleSection({ title, accent, onActivate, children, isOpen, onToggle, defaultOpen = true }) {
  const [localOpen, setLocalOpen] = useState(defaultOpen)
  const controlled = typeof isOpen === 'boolean' && typeof onToggle === 'function'
  const open = controlled ? isOpen : localOpen
  const handleClick = () => {
    if (onActivate) onActivate()
    if (controlled) onToggle()
    else setLocalOpen(o => !o)
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
// Brief 28a Part 5 walkthrough Finding 1 (2026-05-14): user-facing label
//   renamed again 'Conditions' -> 'Profiles'. Rationale (Chris): "Profiles"
//   matches the schedule-driven nature of what the tab actually shows
//   (People/Lighting/Equipment time-varying profiles), and aligns with
//   how the rest of the tool talks about gains. Internal key 'loadshape'
//   + localStorage keys 'nza-conditions-*' kept stable per Chris's call
//   on internal-vs-user-facing churn. Internal filename LoadShapeView.jsx
//   stays for now; cosmetic file rename queued for Part 7 close-out.
// Brief 36 Part 3 (2026-05-18): 'schedule' tab removed. Schedule editor now
// lives in a draggable pop-out (SchedulePopout) opened via the left-panel
// "Edit schedule" affordances. Per the brief §3.4 alternative: tab strip
// drops from 5 tabs to 4 and the centre canvas stops hosting workspace-
// activity content (cleaner — main canvas reads results, pop-out edits
// inputs).
const TABS = [
  { key: 'summary',     label: 'Summary',      fullWidth: false, hasEngineToggle: true,  headline: true                    },
  { key: 'balance',     label: 'Heat balance', fullWidth: false, hasEngineToggle: true                                     },
  { key: 'loadshape',   label: 'Profiles',     fullWidth: true,  hasEngineToggle: true                                     },
  // Brief 28-IM IM-M2: Monthly view added — per-month engine aggregation
  // of internal gains + fabric loss for monthly read-out comparable to
  // Building's Monthly view.
  { key: 'monthly',     label: 'Monthly',      fullWidth: true,  hasEngineToggle: true                                     },
]
const TAB_KEYS = TABS.map(t => t.key)

// ── Tab content dispatcher ──────────────────────────────────────────────────
// Brief 36 Part 3: the 'schedule' tab content is gone — schedule editing now
// happens in a SchedulePopout (see SchedulePopoutHost below the main module).
// The centre canvas is purely results / diagnostics now.
function TabContent({ tab }) {
  switch (tab) {
    case 'summary':   return <SummaryView />
    case 'loadshape': return <LoadShapeView />
    case 'balance':   return <HeatBalanceView />
    case 'monthly':   return <MonthlyView />
    default:          return null
  }
}

// ── Schedule pop-out resolver ──────────────────────────────────────────────
// Brief 36 Part 3: pulled out of the old TabContent 'schedule' branch.
// Resolves the parent schedule + onChange + exception wiring per the
// active section / profile, then renders ScheduleEditorCanvas inside the
// SchedulePopout. All the prop-resolution logic that used to live in
// TabContent moves here unchanged — only the host changed from canvas to
// pop-out.
function resolveScheduleSection({
  activeSection, params, updateParam,
  activeLightingId, activeEquipmentId, activeAuxiliaryId,
}) {
  let parentSchedule = null
  let parentOnChange = null
  let label = '—'
  if (activeSection === 'occupancy') {
    parentSchedule = params?.occupancy?.schedule
    label = GAIN_LABELS.occupancy
    parentOnChange = (next) => updateParam('occupancy', { ...(params?.occupancy ?? {}), schedule: next })
  } else if (activeSection === 'lighting' || activeSection === 'equipment' || activeSection === 'auxiliary') {
    const category = activeSection
    const profiles = params?.gains?.[category]?.profiles ?? []
    const activeProfileId =
      category === 'lighting'  ? activeLightingId  :
      category === 'equipment' ? activeEquipmentId :
                                 activeAuxiliaryId
    const activeIdx = (() => {
      if (activeProfileId) {
        const idx = profiles.findIndex(p => p.id === activeProfileId)
        if (idx >= 0) return idx
      }
      return 0
    })()
    parentSchedule = profiles[activeIdx]?.schedule
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
  return { parentSchedule, parentOnChange, label }
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
  // Brief 72 P7 (2026-05-29): same session-local active-profile pattern
  // for the auxiliary section.
  const [activeAuxiliaryId, setActiveAuxiliaryId] = useState(null)

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

  useEffect(() => {
    const auxiliaryProfiles = params?.gains?.auxiliary?.profiles ?? []
    if (auxiliaryProfiles.length > 0 && !auxiliaryProfiles.find(p => p.id === activeAuxiliaryId)) {
      setActiveAuxiliaryId(auxiliaryProfiles[0].id)
    }
  }, [params?.gains?.auxiliary?.profiles, activeAuxiliaryId])

  const onResizeLeft = useCallback((dx) => {
    setPrefs(p => ({ ...p, left: clamp(p.left + dx, LEFT_MIN, LEFT_MAX) }))
  }, [])

  // Brief 36 Part 3: schedule editing migrated to a draggable pop-out.
  // schedulePopoutOpen tracks open/closed; activeSection determines which
  // schedule the pop-out edits when open. onEditSchedule sets the section
  // AND opens the pop-out in one go.
  const [schedulePopoutOpen, setSchedulePopoutOpen] = useState(false)

  // Any tab change or section change exits exception edit mode — keeps the
  // banner from persisting into a context where it no longer makes sense.
  // Tab guard: legacy persisted prefs may have tab: 'schedule' — coerce to
  // 'summary' so the no-longer-existing schedule tab key doesn't strand the
  // canvas on a null view.
  const setTab = useCallback((next) => {
    setEditingExceptionId(null)
    const safe = TAB_KEYS.includes(next) ? next : 'summary'
    setPrefs(p => ({ ...p, tab: safe }))
  }, [])
  const setActiveSection = useCallback((next) => {
    setEditingExceptionId(null)
    setPrefs(p => ({ ...p, activeSection: next }))
  }, [])

  // Inline-polish 2026-05-20: single-expand accordion for the left
  // panel — only one of Occupancy / Lighting / Equipment is expanded at
  // a time. Independent from `activeSection` (which drives the schedule
  // popout's context); clicking a closed section opens it AND becomes
  // the active section; clicking the open section collapses it without
  // changing the active section.
  const [openSection, setOpenSection] = useState(activeSection)
  const toggleAccordion = useCallback((id) => {
    setOpenSection(prev => prev === id ? null : id)
  }, [])
  const onEditSchedule = useCallback((section) => {
    setEditingExceptionId(null)
    setPrefs(p => ({ ...p, activeSection: section }))
    setSchedulePopoutOpen(true)
  }, [])

  const onEnterEditMode = useCallback((excId) => setEditingExceptionId(excId), [])
  const onExitEditMode  = useCallback(() => setEditingExceptionId(null), [])

  // Coerce legacy 'schedule' tab to a valid view if the persisted pref
  // survived the Brief 36 Part 3 tab-strip change.
  const safeTab = TAB_KEYS.includes(tab) ? tab : 'summary'
  const activeTab = TABS.find(t => t.key === safeTab) ?? TABS[0]

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
              isOpen={openSection === 'occupancy'}
              onToggle={() => toggleAccordion('occupancy')}
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
              isOpen={openSection === 'lighting'}
              onToggle={() => toggleAccordion('lighting')}
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
              isOpen={openSection === 'equipment'}
              onToggle={() => toggleAccordion('equipment')}
            >
              <EquipmentSection
                annual={annual}
                onEditSchedule={() => onEditSchedule('equipment')}
                activeProfileId={activeEquipmentId}
                onSelectProfile={setActiveEquipmentId}
              />
            </CollapsibleSection>

            {/* Brief 72 P7 (2026-05-29) — auxiliary section mounted below
                Equipment. Empty profiles array by default (P4 schema);
                the section's empty-state hint invites opt-in. */}
            <CollapsibleSection
              title="Auxiliary"
              accent={GAIN_COLOURS.auxiliary}
              onActivate={() => setActiveSection('auxiliary')}
              isOpen={openSection === 'auxiliary'}
              onToggle={() => toggleAccordion('auxiliary')}
            >
              <AuxiliarySection
                annual={annual}
                onEditSchedule={() => onEditSchedule('auxiliary')}
                activeProfileId={activeAuxiliaryId}
                onSelectProfile={setActiveAuxiliaryId}
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
                  const isActive = t.key === safeTab
                  const label = t.label
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

            {/* Brief 28-IM IM-M4.5 Phase 2 (item 3 / UI honesty): the
                pre-existing "Engine toggle inline (Part 11)" placeholder
                was promising functionality that never landed — Internal
                Gains' canvas views are Static-only by design (gains profile
                evaluation is a Static-engine concept; Dynamic gets the
                gains via emitted Schedule:Compact and reports them as
                annual InteriorLights:Electricity / InteriorEquipment:
                Electricity meters, not as a per-profile breakdown).
                Removed the placeholder rather than ship a toggle that
                would silently render Static under "Dynamic". */}
          </div>

          {/* Tab content. Brief 28a Part 5 walkthrough finding (2026-05-14):
              overflow changed auto -> hidden. Each tab view now bounds its
              own height; whole-page scroll banned per Pablo discipline. If a
              view's content truly exceeds the canvas, it manages an internal
              scroll region (see SummaryView). */}
          <div className="flex-1 overflow-hidden min-h-0">
            <TabContent tab={safeTab} />
          </div>

          {/* Brief 28-IM-Polish POL-M2 IA 3.2: always-visible KPI strip.
              Internal Gains has no 3D viewer in a right column, so the
              strip sits at the BOTTOM of the centre canvas — visible
              regardless of which view tab is active. Four KPIs per the
              brief's mapping: Heating demand (with gains) · Cooling demand
              (with gains) · Annual gains total · Net offset (State 1 → 2
              heating reduction). */}
          <InternalGainsStrip annual={annual} />
        </div>
      </div>

      {/* Brief 36 Part 3: schedule editor lives in a draggable pop-out.
          Opens via onEditSchedule from the left-panel sections. The
          ScheduleEditorCanvas body is unchanged — only the host changed
          from centre canvas to floating panel. Non-blocking backdrop means
          the main window stays interactive while editing. */}
      {schedulePopoutOpen && (() => {
        const accent = GAIN_COLOURS[activeSection] ?? GAINS_ACCENT
        const { parentSchedule, parentOnChange, label } = resolveScheduleSection({
          activeSection, params, updateParam,
          activeLightingId, activeEquipmentId, activeAuxiliaryId,
        })
        const editingException = editingExceptionId
          ? (parentSchedule?.exceptions ?? []).find(e => e.id === editingExceptionId) ?? null
          : null
        const exceptionOnChange = (curvePatch) => {
          if (!editingException || !parentOnChange || !parentSchedule) return
          const nextExceptions = (parentSchedule.exceptions ?? []).map(e =>
            e.id === editingException.id ? { ...e, ...curvePatch } : e
          )
          parentOnChange({ ...parentSchedule, exceptions: nextExceptions })
        }
        let profileSelector = null
        let areaShareTotal  = null
        if (activeSection === 'lighting' || activeSection === 'equipment' || activeSection === 'auxiliary') {
          const category = activeSection
          const profiles = params?.gains?.[category]?.profiles ?? []
          const activeId =
            category === 'lighting'  ? activeLightingId  :
            category === 'equipment' ? activeEquipmentId :
                                       activeAuxiliaryId
          const onChange =
            category === 'lighting'  ? setActiveLightingId  :
            category === 'equipment' ? setActiveEquipmentId :
                                       setActiveAuxiliaryId
          profileSelector = {
            profiles: profiles.map(p => ({ id: p.id, label: p.label })),
            activeId,
            onChange,
          }
          areaShareTotal = profiles.reduce((s, p) => s + Number(p.area_share ?? 0), 0)
        }
        return (
          <SchedulePopout
            isOpen
            onClose={() => setSchedulePopoutOpen(false)}
            title={`Schedule · ${label}`}
            accent={accent}
            persistKey="nza-schedule-popout-position-gains"
          >
            <UnifiedScheduleEditor
              schedule={parentSchedule}
              onChange={parentOnChange}
              accent={accent}
              mode="live"
              enableExceptions
              contextLabel={label}
              editingException={editingException}
              onExceptionChange={exceptionOnChange}
              onEnterExceptionEdit={onEnterEditMode}
              onExitExceptionEdit={onExitEditMode}
            />
            {/* Profile selector / area coverage (lighting + equipment only)
                are surfaced in the left-panel sections now that the canvas
                tab is gone; not duplicated inside the pop-out. _profileSelector
                + _areaShareTotal kept resolved above for the dev-mode
                inspector + restoration in a follow-up if needed. */}
            {void [profileSelector, areaShareTotal]}
          </SchedulePopout>
        )
      })()}
    </div>
  )
}

/* Brief 28-IM-Polish POL-M2 IA 3.2: 4-KPI strip for Internal Gains.
   Uses useStateComparison (already used by SummaryView) so the React
   render path can dedupe the engine pass — no extra cost beyond what
   SummaryView already triggers. Falls back to a loading skeleton until
   weather + library load. */
function InternalGainsStrip({ annual }) {
  const { state1, state2, ready } = useStateComparison()
  if (!ready || !annual?.ready) {
    return <LiveResultsStrip loading />
  }
  const gia = annual.gia_m2 || 0
  const gainsTotalKwh = (annual.people?.kwh ?? 0)
                       + (annual.lighting?.kwh ?? 0)
                       + (annual.equipment?.kwh ?? 0)
  const heatingS1 = state1?.demand?.heating_demand_mwh ?? null
  const heatingS2 = state2?.demand?.heating_demand_mwh ?? null
  const coolingS2 = state2?.demand?.cooling_demand_mwh ?? null
  // Net offset: how much internal gains reduced heating demand (S1 - S2).
  // Positive = gains helped heating (typical winter behaviour).
  const heatingOffset = (heatingS1 != null && heatingS2 != null)
    ? Math.round((heatingS1 - heatingS2) * 10) / 10
    : null
  const items = [
    {
      label: 'Heating demand', accent: '#DC2626',
      value: heatingS2 != null ? heatingS2.toFixed(1) : '—',
      unit: 'MWh/yr',
      sub: heatingS1 != null ? `State 1 (no gains): ${heatingS1.toFixed(1)} MWh/yr` : 'with internal gains',
    },
    {
      label: 'Cooling demand', accent: '#00AEEF',
      value: coolingS2 != null ? coolingS2.toFixed(1) : '—',
      unit: 'MWh/yr',
      sub: 'with internal gains',
    },
    {
      label: 'Annual gains', accent: '#EA580C',
      value: (gainsTotalKwh / 1000).toFixed(1),
      unit: 'MWh/yr',
      sub: gia > 0 ? `${Math.round(gainsTotalKwh / gia)} kWh/m²·yr` : '',
    },
    {
      label: 'Net heating offset', accent: '#16A34A',
      value: heatingOffset != null ? (heatingOffset > 0 ? '−' : '+') + Math.abs(heatingOffset).toFixed(1) : '—',
      unit: 'MWh/yr',
      sub: heatingOffset != null && heatingS1 > 0
        ? `${Math.round(heatingOffset / heatingS1 * 100)}% reduction from State 1`
        : '',
    },
  ]
  return <LiveResultsStrip items={items} />
}
