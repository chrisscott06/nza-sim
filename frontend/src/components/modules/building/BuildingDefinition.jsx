/**
 * BuildingDefinition.jsx — three-column live workspace
 *
 * Left (w-72):   All building inputs (geometry + fabric + airtightness)
 * Centre (flex-1): 3D building viewer
 * Right (w-80):  LiveResultsPanel — instant-calc results
 *
 * Brief 46 Part 2c (2026-05-22): the five Building-input subsections
 * (Geometry / Glazing / Shading / Openings / Fabric) plus Airtightness
 * + Comfort band were extracted from this file's monolithic
 * `InputsColumn` into `./buildingSections.jsx` as self-contained named
 * exports per Chris's Option A directive at Part 2a close. `InputsColumn`
 * below is now a thin assembler; ThermalBridgesPanel is re-exported
 * from buildingSections.jsx so the left column has a single import
 * source. The same named exports back the editor's BuildingSection
 * composer — two consumers, one implementation, mutations route
 * automatically via useProjectMutation (Brief 46 Q2 design).
 */

import { useState, useContext, useEffect, useMemo, useRef, useCallback } from 'react'
import { NavLink } from 'react-router-dom'
import BuildingViewer3D from './BuildingViewer3D.jsx'
// LiveResultsPanel removed — premature at the Building stage (no systems/gains
// defined yet). EUI / fuel split / monthly bars now live in /results after
// a simulation has actually been run. See docs/briefs/Brief_24_Building_Module.md.
import ExpandedSankeyOverlay from './ExpandedSankeyOverlay.jsx'
import HeatBalance from '../balance/HeatBalance.jsx'
import WeatherSynchronisedProfile from '../../profiles/WeatherSynchronisedProfile.jsx'
// Brief 44 Part 5 (2026-05-21) — Building module adopts the shared
// InteractiveProfileVisualiser for its profile-over-time tab.
import InteractiveProfileVisualiser from '../../shared/InteractiveProfileVisualiser/InteractiveProfileVisualiser.jsx'
import ConstructionInspector from '../../library/ConstructionInspector.jsx'
// Brief 28-IM-Polish (Bug 2.1, Bug 2.6, §4.1, §4.2, IA 3.1, IA 3.2):
//   - ThermalBridgesPanel: building-level TB section in left column
//   - LiveResultsStrip: always-visible KPI strip below 3D viewer
//   - EnginePill / ChartTotalsBadge: chart consistency rules
//   - ComfortBandLeftPanel: setpoint sliders live in left column (IA 3.1)
//
// Brief 46 Part 2c (2026-05-22): all left-column sections imported from
// the single extracted file. ThermalBridges + Comfort + Airtightness now
// follow the same pattern as Geometry/Glazing/Shading/Openings/Fabric.
import {
  GeometrySection,
  GlazingSection,
  ShadingSection,
  OpeningsSection,
  FabricSection,
  AirtightnessSection,
  ComfortBandSection,
  ThermalBridgesPanel,
} from './buildingSections.jsx'
import LiveResultsStrip from '../../shared/LiveResultsStrip.jsx'
import EnginePill from '../../shared/EnginePill.jsx'
import ChartTotalsBadge from '../../shared/ChartTotalsBadge.jsx'
import ReconciliationRow from '../../shared/ReconciliationRow.jsx'
// Chris UX overhaul (2026-05-17): right-column ComfortDemandCard replaces
// the LiveResultsStrip and absorbs the comfort-band editor + comfort-hours
// strip + free-running stats that used to sit at the bottom of HeatBalance.
import ComfortDemandCard from '../../shared/ComfortDemandCard.jsx'
// Chris UX request (2026-05-17): diverging monthly bars — fixed middle
// axis with gains UP and losses DOWN. Replaces the bottom-anchored stack.
import DivergingMonthlyChart from '../../shared/DivergingMonthlyChart.jsx'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { SimulationContext } from '../../../context/SimulationContext.jsx'
import { useWeather } from '../../../context/WeatherContext.jsx'
import { useHourlySolar } from '../../../hooks/useHourlySolar.js'
import { useSimulationBalance } from '../../../hooks/useSimulationBalance.js'
import { calculateInstant } from '../../../utils/instantCalc.js'

// ── Layout: resizable columns ────────────────────────────────────────────────
// Persisted column widths so users can size to their screen / focus area.
const LAYOUT_STORAGE_KEY = 'nza-building-layout'
const LEFT_DEFAULT  = 288   // px (was w-72)
const RIGHT_DEFAULT = 420   // px — matches the 380-480 band in Brief 28-IM §2.1
const LEFT_MIN  = 220
const LEFT_MAX  = 520
const RIGHT_MIN = 320
const RIGHT_MAX = 560

function loadLayoutPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY))
    if (saved && typeof saved === 'object') {
      return {
        left:        clamp(Number(saved.left)  || LEFT_DEFAULT,  LEFT_MIN,  LEFT_MAX),
        right:       clamp(Number(saved.right) || RIGHT_DEFAULT, RIGHT_MIN, RIGHT_MAX),
        rightHidden: !!saved.rightHidden,
        centre:      ['3d', 'heat-balance'].includes(saved.centre) ? saved.centre : '3d',
      }
    }
  } catch {}
  return { left: LEFT_DEFAULT, right: RIGHT_DEFAULT, rightHidden: false, centre: '3d' }
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)) }

/**
 * ResizeHandle — vertical drag handle between columns. Calls onResize(dx)
 * for every pixel of horizontal movement while the user drags.
 */
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
      className="w-1 flex-shrink-0 cursor-col-resize bg-light-grey/0 hover:bg-teal/40 active:bg-teal/60 transition-colors relative group"
      onMouseDown={handleMouseDown}
      title="Drag to resize"
    >
      <div className="absolute inset-y-0 -inset-x-1.5" />
    </div>
  )
}

// ── Left column — all inputs ──────────────────────────────────────────────────
//
// Brief 46 Part 2c (2026-05-22): InputsColumn is now a thin assembler.
// The five input subsections + Airtightness + Comfort band + Thermal
// bridges all live in buildingSections.jsx as self-contained named
// exports. This function owns the single-expand accordion state + the
// module header, and forwards `accordionProps(id)` so only one section
// is expanded at a time across the panel.
function InputsColumn({ library, onInspectConstruction, liveResult }) {
  // Single-expand accordion for the entire Building left panel —
  // Geometry / Glazing / Shading / Openings / Fabric / Thermal bridges /
  // Airtightness / Comfort band. Click an open section to collapse it.
  const [openSection, setOpenSection] = useState('geometry')
  const toggleAccordion = (id) => setOpenSection(prev => prev === id ? null : id)
  const accordionProps = (id) => ({
    isOpen: openSection === id,
    onToggle: () => toggleAccordion(id),
  })

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-white border-r border-light-grey">
      {/* Module header with warm earth accent */}
      <div
        className="px-3 pt-2 pb-2 border-b border-light-grey"
        style={{ borderTopWidth: '3px', borderTopColor: '#A1887F', borderTopStyle: 'solid' }}
      >
        <NavLink to="/project" className="text-xxs text-mid-grey hover:text-navy transition-colors">
          ← Overview
        </NavLink>
        <p className="text-caption font-medium mt-0.5" style={{ color: '#A1887F' }}>Building</p>
        <p className="text-xxs text-mid-grey">Geometry, fabric &amp; airtightness</p>
      </div>

      <div className="p-3 space-y-0">
        <GeometrySection   {...accordionProps('geometry')} />
        <GlazingSection    {...accordionProps('glazing')} />
        <ShadingSection    {...accordionProps('shading')} />
        <OpeningsSection   {...accordionProps('openings')} />
        <FabricSection
          library={library}
          onInspectConstruction={onInspectConstruction}
          {...accordionProps('fabric')}
        />
        <ThermalBridgesPanel engineResult={liveResult} {...accordionProps('thermal_bridges')} />
        <AirtightnessSection liveResult={liveResult} {...accordionProps('airtightness')} />
        <ComfortBandSection  {...accordionProps('comfort')} />
      </div>
    </div>
  )
}

// ── Brief 28-IM §2.2: centre-column view switcher ────────────────────────────
//
// Building tab tabs (per §3.1 + §5.2): Heat Balance / Profiles / Monthly /
// Summary. Heat Balance is the primary view; Profiles + Monthly + Summary are
// time-aggregation views.
//
// Brief 28-IM §15.2 stuck-point fallbacks honoured:
//   - Profiles tab uses the engine's free-running zone temperature trace
//     (already exposed) — fancier hourly-loss-by-element trace queued.
//   - Monthly tab distributes annual losses proportionally to heating
//     degree-hour weighting (crude pro-rata) — proper monthly engine
//     aggregation is a follow-up.
//   - Summary table shows engine output verbatim alongside derived metrics.

const MODULES_FABRIC = ['fabric', 'thermal_bridging', 'fabric_leakage', 'permanent_vents']

const CENTRE_TABS = [
  { id: 'heat-balance', label: 'Heat Balance' },
  { id: 'profiles',     label: 'Profiles' },
  { id: 'monthly',      label: 'Monthly' },
  { id: 'summary',      label: 'Summary' },
]

function BuildingCentreTabs({ view, onChange, instantResult, simBalance, simulationInfo, orientationDeg }) {
  // Coerce older persisted layout values ('3d' from the previous toggle) to
  // the default centre view of the new tab set.
  const activeView = CENTRE_TABS.some(t => t.id === view) ? view : 'heat-balance'

  return (
    <div className="w-full h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex-shrink-0 flex items-center gap-0 border-b border-light-grey bg-white px-2 pt-2">
        {CENTRE_TABS.map(t => {
          const active = t.id === activeView
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={`px-3 py-1.5 text-caption transition-colors border-b-2 -mb-px ${
                active
                  ? 'border-navy text-navy font-medium'
                  : 'border-transparent text-mid-grey hover:text-navy'
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeView === 'heat-balance' && (
          <HeatBalance
            liveData={instantResult?.heat_balance}
            simulationData={simBalance}
            simulationInfo={simulationInfo}
            orientationDeg={orientationDeg}
            onElementClick={() => {}}
            mode="envelope-only"
            modules={MODULES_FABRIC}
          />
        )}
        {activeView === 'profiles' && (
          <BuildingProfilesView instantResult={instantResult} />
        )}
        {activeView === 'monthly' && (
          <BuildingMonthlyView instantResult={instantResult} />
        )}
        {activeView === 'summary' && (
          <BuildingSummaryView instantResult={instantResult} simBalance={simBalance} />
        )}
      </div>
    </div>
  )
}

function BuildingProfilesView({ instantResult }) {
  // Brief 28-IM IM-M2 (Profiles upgrade): swap the previous free-running
  // zone temperature trace for the WeatherSynchronisedProfile chart strip.
  // Brief 28-IM-Polish Bug 2.7 / Bug 2.9 / Bug 2.10 / §4.1 / §4.2:
  //   - Static/Dynamic pill top-left of the chart area
  //   - Σ totals badge top-right (sum of loss + sum of solar)
  //   - Chart fills full available height (no fixed 520 px)
  //   - Caption stays as fine-print under the chart, not as chrome above
  const dp = instantResult?.daily_profiles
  if (!dp) {
    return (
      <div className="h-full flex items-center justify-center text-mid-grey text-xxs">
        Profiles require engine output — load weather data.
      </div>
    )
  }
  const losses = dp.heat_loss_kwh
  const solar  = dp.solar_transmission_kwh_per_facade
  const w      = dp.weather
  // Weather signals: engine emits sums per day; convert to means here so
  // the chart unit (°C / m/s / W/m²) is right.
  const t_out_mean_c    = (w?.t_out_sum_c ?? []).map(v => v / 24)
  const wind_mean_ms    = (w?.wind_sum_ms ?? []).map(v => v / 24)
  const ghi_mean_w_m2   = (w?.ghi_sum_w_per_m2 ?? []).map(v => v / 24)

  // Totals for the badge: sum of all per-element daily losses, and sum of
  // solar transmission across facades. Match the Heat Balance figures.
  const sumArr = (a) => Array.isArray(a) ? a.reduce((s, v) => s + (v ?? 0), 0) : 0
  const totalLossKwh =
      sumArr(losses?.external_wall) + sumArr(losses?.roof) + sumArr(losses?.ground_floor)
    + sumArr(losses?.glazing) + sumArr(losses?.thermal_bridging)
    + sumArr(losses?.fabric_leakage) + sumArr(losses?.permanent_vents)
  const totalSolarKwh =
      sumArr(solar?.north) + sumArr(solar?.east) + sumArr(solar?.south) + sumArr(solar?.west)
  const gia = instantResult?.heat_balance?.metadata?.gia_m2 ?? instantResult?.metadata?.gia_m2 ?? 0

  // Brief 44 Part 5 (2026-05-21) — Building Profiles uses the shared
  // InteractiveProfileVisualiser. Simple by default: single layer
  // "Total heat loss" (synthesised by summing per-element losses);
  // user opts into individual envelope elements + solar gains.

  // Synthesise "Total heat loss" as a daily-sum across all envelope
  // elements so the user gets one informative signal as the default.
  const elements = [losses?.external_wall, losses?.roof, losses?.ground_floor,
                    losses?.glazing, losses?.thermal_bridging, losses?.fabric_leakage,
                    losses?.permanent_vents]
  const total_loss_daily_kwh = (Array.isArray(elements[0]) ? elements[0].length : 0) > 0
    ? Array.from({ length: elements[0].length }, (_, d) =>
        elements.reduce((s, arr) => s + (arr?.[d] ?? 0), 0))
    : []
  const total_solar_daily_kwh = (Array.isArray(solar?.north) ? solar.north.length : 0) > 0
    ? Array.from({ length: solar.north.length }, (_, d) =>
        (solar.north?.[d] ?? 0) + (solar.east?.[d] ?? 0)
      + (solar.south?.[d] ?? 0) + (solar.west?.[d] ?? 0))
    : []

  const layers = [
    { id: 'total_loss',   label: 'Total heat loss',   colour: '#1F2937', daily_kwh: total_loss_daily_kwh },
    { id: 'wall',         label: 'External wall',    colour: '#6B7280', daily_kwh: losses?.external_wall ?? [] },
    { id: 'roof',         label: 'Roof',             colour: '#9CA3AF', daily_kwh: losses?.roof ?? [] },
    { id: 'floor',        label: 'Ground floor',     colour: '#D1D5DB', daily_kwh: losses?.ground_floor ?? [] },
    { id: 'glazing',      label: 'Glazing',          colour: '#4B5563', daily_kwh: losses?.glazing ?? [] },
    { id: 'tb',           label: 'Thermal bridging', colour: '#475569', daily_kwh: losses?.thermal_bridging ?? [] },
    { id: 'infiltration', label: 'Infiltration',     colour: '#7DD3FC', daily_kwh: losses?.fabric_leakage ?? [] },
    { id: 'permvent',     label: 'Permanent vents',  colour: '#0EA5E9', daily_kwh: losses?.permanent_vents ?? [] },
    { id: 'total_solar',  label: 'Total solar gain', colour: '#D97706', daily_kwh: total_solar_daily_kwh },
    { id: 'solar_n',      label: 'Solar N',          colour: '#FCD34D', daily_kwh: solar?.north ?? [] },
    { id: 'solar_e',      label: 'Solar E',          colour: '#FBBF24', daily_kwh: solar?.east ?? [] },
    { id: 'solar_s',      label: 'Solar S',          colour: '#F59E0B', daily_kwh: solar?.south ?? [] },
    { id: 'solar_w',      label: 'Solar W',          colour: '#EAB308', daily_kwh: solar?.west ?? [] },
  ]

  return (
    <div className="w-full h-full flex flex-col overflow-auto p-3">
      <div className="flex-shrink-0 flex items-center justify-between gap-2 mb-2">
        <EnginePill mode="static" />
        <div className="flex items-center gap-2">
          <ChartTotalsBadge label="Σ losses" value_kwh={totalLossKwh} gia_m2={gia} />
          <ChartTotalsBadge label="Σ solar"  value_kwh={totalSolarKwh} gia_m2={gia} />
        </div>
      </div>
      <InteractiveProfileVisualiser
        layers={layers}
        weather={{ t_out_c: t_out_mean_c, wind_ms: wind_mean_ms, ghi_w_per_m2: ghi_mean_w_m2 }}
        defaultLayerIds={['total_loss']}
        defaultMode="single_line"
        module="building"
        height={420}
        caption="Per-element envelope heat losses (positive = loss to outside) and solar transmission per facade. Default: total heat loss across all envelope terms. Toggle individual elements to drill down; switch to Stacked area for compositional view; zoom by quarter/month/day. Weather strip overlays outdoor temp / wind / solar."
      />
    </div>
  )
}

function BuildingMonthlyView({ instantResult }) {
  // Brief 28-IM-Polish Bug 2.7 / Bug 2.9 / Bug 2.10 / §4.1 / §4.2:
  //   - Engine pill top-left of the chart area
  //   - Σ totals badge top-right (Σ losses + Σ solar — same numbers the
  //     Heat Balance view shows, proving cross-view reconciliation per §4.4)
  //   - Bars fill the full available vertical space (was a fixed 280 px
  //     container with 120 px max-height segments)
  //   - Caption stays small under the chart, not as chrome above
  const los = instantResult?.losses_at_setpoint
  const gia = instantResult?.heat_balance?.metadata?.gia_m2 ?? 0
  if (!los || gia === 0) {
    return (
      <div className="h-full flex items-center justify-center text-mid-grey text-xxs">
        Monthly aggregation requires engine output — load weather data.
      </div>
    )
  }
  // Brief 28-IM IM-M2 add 2: true per-month engine aggregation.
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const _z = () => new Array(12).fill(0)
  const _add = (out, arr) => { if (Array.isArray(arr)) for (let i = 0; i < 12; i++) out[i] += (arr[i] ?? 0) }
  const lossMonthly = _z()
  _add(lossMonthly, los.external_wall?.monthly_heating_loss_kwh)
  _add(lossMonthly, los.roof?.monthly_heating_loss_kwh)
  _add(lossMonthly, los.ground_floor?.monthly_heating_loss_kwh)
  _add(lossMonthly, los.glazing?.monthly_heating_loss_kwh)
  _add(lossMonthly, los.fabric_leakage?.monthly_heating_loss_kwh)
  _add(lossMonthly, los.permanent_vents?.monthly_heating_loss_kwh)
  _add(lossMonthly, los.thermal_bridging?.monthly_heating_loss_kwh)
  const solarMonthly = los.glazing?.monthly_solar_transmission_kwh ?? _z()
  // `months` array still used by DivergingMonthlyChart's default; kept above
  // for the future case where a project wants to localise month labels.
  const totalLossKwh  = lossMonthly.reduce((s, v) => s + v, 0)
  const totalSolarKwh = solarMonthly.reduce((s, v) => s + (v ?? 0), 0)

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-shrink-0 flex items-center justify-between gap-2 px-4 pt-2 pb-1">
        <div className="flex items-center gap-2">
          <EnginePill mode="static" />
          <span className="text-caption font-semibold text-navy">Monthly heat loss vs solar gain</span>
        </div>
        <div className="flex items-center gap-2">
          <ChartTotalsBadge label="Σ losses" value_kwh={totalLossKwh}  gia_m2={gia} />
          <ChartTotalsBadge label="Σ solar"  value_kwh={totalSolarKwh} gia_m2={gia} />
        </div>
      </div>

      {/* Chris UX request (2026-05-17): diverging-bars chart. Months on a
          fixed horizontal axis through the middle; solar (gains) grows UP,
          fabric loss grows DOWN. Reads as two opposing seasonal curves. */}
      <div className="flex-1 min-h-0 px-4 pb-2 flex flex-col">
        <div className="flex-1 min-h-0 max-w-5xl mx-auto w-full flex flex-col">
          <DivergingMonthlyChart
            gainsStacks={[
              { key: 'solar',  label: 'Solar transmission', color: '#F59E0B', values: solarMonthly },
            ]}
            lossesStacks={[
              { key: 'fabric', label: 'Fabric heat loss',   color: '#475569', values: lossMonthly },
            ]}
            height={320}
            unit="kWh"
          />
        </div>
        <p className="text-xxs text-mid-grey/80 italic flex-shrink-0 mt-1">
          12 bars sum to the Σ totals above (reconciles with Heat Balance figures).
        </p>
      </div>
    </div>
  )
}

function BuildingSummaryView({ instantResult, simBalance }) {
  // Brief 28-IM-Polish:
  //   - IA 3.3: drop the Heating / Cooling / Free-running / Comfort-hours
  //     cards from the right side of this view — they now live in the
  //     LiveResultsStrip below the 3D viewer. Summary keeps the diagnostic
  //     per-element table + comfort-hours micro-row + convention notes.
  //   - Bug 2.7: Static/Dynamic pill in the header
  //   - Bug 2.10: Σ totals badge in the header (matches Heat Balance figure)
  //   - Bug 2.11: refined Δ% empty state when no Dynamic run is available
  //   - Bug 2.8: fabric-gap magnitude diagnostic in the convention notes
  const los = instantResult?.losses_at_setpoint
  const demand = instantResult?.demand
  if (!los || !demand) {
    return (
      <div className="h-full flex items-center justify-center text-mid-grey text-xxs">
        Summary requires engine output — load weather data.
      </div>
    )
  }
  const tb = los.thermal_bridging ?? {}
  const fl = los.fabric_leakage ?? {}
  const rows = [
    ['External wall',    los.external_wall?.heating_loss_kwh, los.external_wall?.area_m2, 'm²'],
    ['Roof',             los.roof?.heating_loss_kwh,          los.roof?.area_m2,          'm²'],
    ['Ground floor',     los.ground_floor?.heating_loss_kwh,  los.ground_floor?.area_m2,  'm²'],
    ['Glazing',          los.glazing?.heating_loss_kwh,       los.glazing?.area_m2,       'm²'],
    ['Infiltration',     fl.heating_loss_kwh,                 fl.operational_ach,         'ACH'],
    ['Permanent vents',  los.permanent_vents?.heating_loss_kwh, null,                     ''],
    ['Thermal bridging', tb.heating_loss_kwh,                 tb.total_H_TB_W_per_K,      'W/K'],
  ]
  const totalLoss = rows.reduce((s, r) => s + (r[1] ?? 0), 0)
  const gia = instantResult?.heat_balance?.metadata?.gia_m2 ?? 0

  // Brief 28-IM-Polish POL-M3 §7.2 — cross-chart total reconciliation.
  // Compute the same fabric-loss total via the per-element monthly arrays
  // (Source B, what the Monthly view sums) and compare against the per-
  // element annual scalars (Source A, what the Heat Balance pane sums + the
  // table above). If both come from the same engine step they MUST agree
  // — divergence ⇒ engine bug. Surfaced as a tolerance-checked row.
  const _sumMonthly = (arr) => Array.isArray(arr) ? arr.reduce((s, v) => s + (v ?? 0), 0) : 0
  const monthlyFabricSum_kwh =
      _sumMonthly(los.external_wall?.monthly_heating_loss_kwh)
    + _sumMonthly(los.roof?.monthly_heating_loss_kwh)
    + _sumMonthly(los.ground_floor?.monthly_heating_loss_kwh)
    + _sumMonthly(los.glazing?.monthly_heating_loss_kwh)
    + _sumMonthly(los.fabric_leakage?.monthly_heating_loss_kwh)
    + _sumMonthly(los.permanent_vents?.monthly_heating_loss_kwh)
    + _sumMonthly(los.thermal_bridging?.monthly_heating_loss_kwh)
  const reconciliationRows = [{
    label: 'Total fabric loss',
    a_label: 'Heat Balance (annual sum)',
    a_value: totalLoss / 1000,
    b_label: 'Monthly (12-month sum)',
    b_value: monthlyFabricSum_kwh / 1000,
    unit: 'MWh',
  }]

  // Brief 28-IM-Polish Bug 2.8: cumulative Static-vs-Dynamic fabric gap.
  // simBalance carries the Dynamic heating demand (envelope-only mode).
  // Building's STATIC `totalLoss` is the sum of `heating_loss_kwh` across
  // envelope elements (kWh). Dynamic-equivalent fabric loss isn't a
  // single field in simBalance — we use heating_demand_mwh as the closest
  // observable proxy. If Dynamic isn't run, the diagnostic stays neutral.
  const simHeatingMwh = simBalance?.demand?.heating_demand_mwh ?? null
  const staticFabricMwh = totalLoss / 1000
  const dynamicAvailable = simHeatingMwh != null
  const fabricGapPct = dynamicAvailable && staticFabricMwh > 0
    ? Math.round(((simHeatingMwh - staticFabricMwh) / staticFabricMwh) * 100)
    : null

  return (
    <div className="w-full h-full overflow-auto">
      <div className="px-4 pt-2 pb-1 flex items-center justify-between gap-2 sticky top-0 bg-white border-b border-light-grey">
        <div className="flex items-center gap-2">
          {/* Brief 32 Part 1: pill pinned to 'static'; Dynamic comparison restores when Brief 30 closes. */}
          <EnginePill mode="static" dynamicReady={false} />
          <span className="text-caption font-semibold text-navy">Building summary · envelope</span>
        </div>
        <ChartTotalsBadge label="Σ fabric loss" value_kwh={totalLoss} gia_m2={gia} />
      </div>

      <div className="p-4">
        <p className="text-xxs text-mid-grey mb-3">
          Per-element annual heat loss · setpoint convention (Brief 28k) · Bridgewater
          post-BRUKL inputs. Headline demand + EUI + comfort numbers are in the Live
          Results strip below the 3D viewer (Brief 28-IM-Polish IA 3.3) — this view is
          the diagnostic.
        </p>

        <table className="w-full max-w-3xl text-xxs border-collapse">
          <thead>
            <tr className="border-b border-light-grey text-mid-grey uppercase tracking-wider">
              <th className="text-left py-2 pr-3 font-medium">Element</th>
              <th className="text-right py-2 pr-3 font-medium">Heat loss (kWh/yr)</th>
              <th className="text-right py-2 pr-3 font-medium">% of total</th>
              <th className="text-right py-2 font-medium">Characteristic</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, kwh, char, unit]) => (
              <tr key={label} className="border-b border-light-grey/50">
                <td className="py-1.5 pr-3 text-navy">{label}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-navy">
                  {kwh != null ? Math.round(kwh).toLocaleString() : '—'}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-mid-grey">
                  {kwh != null && totalLoss > 0 ? ((kwh / totalLoss) * 100).toFixed(1) + '%' : '—'}
                </td>
                <td className="py-1.5 text-right tabular-nums text-mid-grey">
                  {char != null ? `${typeof char === 'number' ? (char < 1 ? char.toFixed(3) : Math.round(char).toLocaleString()) : char} ${unit}` : '—'}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-navy/30 font-semibold">
              <td className="py-2 pr-3 text-navy">Total fabric heat loss</td>
              <td className="py-2 pr-3 text-right tabular-nums text-navy">{Math.round(totalLoss).toLocaleString()}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-mid-grey">100%</td>
              <td className="py-2 text-right" />
            </tr>
          </tbody>
        </table>

        {/* Brief 28-IM-Polish POL-M3 §7.2: cross-chart reconciliation.
            Brief 29 Commit B (cleanup): renamed and reframed. This row
            only checks DISPLAY-TO-DISPLAY consistency — the same total
            computed via the per-element annual scalar (used by the table
            above) vs the 12-month sum (used by the Monthly view). It does
            NOT verify integrand-vs-display: the door bug (commit 39a828c)
            slipped through this exact check because both displays were
            iterating the same incomplete element list. The audit (Brief 29
            Part 1) installs the proper integrand-vs-display invariant. */}
        <div className="mt-4 max-w-3xl">
          <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5">
            Display-to-display consistency
            <span className="ml-2 normal-case text-mid-grey/70 italic">
              (does NOT verify integrand-vs-display — see Brief 29 audit)
            </span>
          </p>
          <ReconciliationRow rows={reconciliationRows} />
        </div>

        {/* Brief 32 Part 1 (2026-05-18): Static-vs-Dynamic fabric-gap
            diagnostic (Brief 28-IM-Polish Bug 2.11 / POL-M1) hidden while
            the Dynamic engine is under reconstruction (Brief 30, paused).
            simHeatingMwh / staticFabricMwh / dynamicAvailable / fabricGapPct
            are computed above and left in place so this panel restores
            cleanly when Brief 30 returns. */}

        {/* Brief 29 Commit B (cleanup): the per-component "Convention notes
            (Static vs Dynamic)" block that lived here made magnitude claims
            (sky LW raises roof loss "slightly", T_ground differs "5–10%",
            BS 5925 vents agree "±5%", TB under-reports by ~11 MWh) without
            textbook citations or numerical defence on Bridgewater specifically.
            The "Cumulative effect: Dynamic 21% lower than Static fabric loss"
            line was a particular casualty — it derived its 21% from the buggy
            pre-door-fix 200 vs 252 MWh ratio. Post Commit A the ratio is
            210 vs 252 (~17%) and even that is undefended until Brief 29 Part 3
            (cross-engine reconciliation) lands. Removed; the audit
            (docs/audit/29_first_principles_audit_FINDINGS.md) is the place
            for defended numbers. */}
        <p className="text-xxs italic text-mid-grey/70 mt-4 max-w-3xl">
          Static vs Dynamic decomposition is under audit (Brief 29 Part 3) —
          see <code>docs/audit/29_first_principles_audit_FINDINGS.md</code>.
          Comfort hours (Static): {demand.comfort_hours?.toLocaleString() ?? '—'} hrs
          · under-heated {demand.underheating_hours?.toLocaleString() ?? '—'}
          · over-heated {demand.overheating_hours?.toLocaleString() ?? '—'}
        </p>
      </div>
    </div>
  )
}

/* Brief 28-IM-Polish Bug 2.6 / IA 3.2: BuildingRightColumn replaces the
   3D / Live Results TAB toggle with an always-visible 3D viewer on top
   plus a compact Live Results strip below. The strip is the four IA-3.2
   KPIs (Heating demand · Cooling demand · EUI · Annual mean T). The
   previous `BuildingLiveResultsPanel` (which burned ~400 px of width to
   show 4 KPIs in lots of whitespace) is removed in favour of the shared
   `LiveResultsStrip` component. */
function BuildingRightColumn({ params, instantResult, comfortBand, setComfortBand }) {
  // Chris UX overhaul (2026-05-17): the four-KPI LiveResultsStrip was
  // replaced by ComfortDemandCard — same heating/cooling/EUI/mean-T plus
  // the comfort-band editor + comfort-hours strip + free-running min/max
  // that previously lived at the bottom of the HeatBalance view (and were
  // visually duplicating the strip).
  //
  // The EnginePill in the 3D viewer header is also gone — engine source
  // is a top-bar global now, so labelling the 3D viewer "Static" was
  // misleading (a Dynamic toggle in the top bar would still show this as
  // Static, because the 3D viewer is a geometry render, not an engine
  // output).
  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-shrink-0 flex items-center justify-between border-b border-light-grey px-3 py-1.5">
        <p className="text-xxs uppercase tracking-wider text-mid-grey">3D model</p>
      </div>
      <div className="flex-1 min-h-0">
        <BuildingViewer3D params={params ?? {}} />
      </div>
      <ComfortDemandCard
        instantResult={instantResult}
        comfortBand={comfortBand}
        onComfortBandChange={setComfortBand}
        loading={!instantResult}
      />
    </div>
  )
}

// ── Main three-column layout ──────────────────────────────────────────────────

export default function BuildingDefinition() {
  const { params, constructions, systems, currentProjectId, saveStatus, comfortBand, setComfortBand } = useContext(ProjectContext)
  const simCtx = useContext(SimulationContext)
  const [library, setLibrary] = useState([])
  const [libraryData, setLibraryData] = useState({})
  const [showSankey, setShowSankey] = useState(false)
  const [sankeyResult, setSankeyResult] = useState(null)

  // ── Construction Inspector — opens when user clicks a U-value badge ───────
  const [inspectConstruction, setInspectConstruction] = useState(null)

  // Weather + solar (shared computation with LiveResultsPanel)
  const { weatherData } = useWeather()
  const orientationDeg = Number(params?.orientation ?? 0)
  const hourlySolar = useHourlySolar(weatherData, orientationDeg)
  // Building module is locked to envelope-only mode (State 1) per Brief 26
  // and the state contract. The envelope-only path in calculateInstant
  // ignores gains, systems, operable windows etc. — the Building view is
  // purely envelope-vs-weather. Comfort band drives the demand derivation
  // (Part 1) at the lower/upper bound rather than against system setpoints.
  const instantResult = useMemo(
    // Brief 44 Part 5d (2026-05-21): _skipInterventions per perf audit D.1.
    () => calculateInstant(params, constructions, systems, libraryData, weatherData, hourlySolar, null, {
      mode: 'envelope-only',
      comfortBand,
      _skipInterventions: true,
    }),
    [params, constructions, systems, libraryData, weatherData, hourlySolar, comfortBand]
  )

  // Simulation balance — fetched per (projectId, runId). Lets the Live |
  // Simulation toggle in the centre panel actually flip between sources
  // instead of being permanently disabled on the Simulation pill.
  //
  // Mode is `envelope-only` here: the Building module is locked to State 1
  // per the state contract (Building == envelope view, gains/operation/systems
  // live in their own modules). The backend's State 1 path returns the contract
  // output shape — demand row, free-running stats, comfort band echo, ventilation
  // split into fabric_leakage + permanent_vents — that the HeatBalance component
  // renders unconditionally if the keys are present.
  const { data: simBalance } = useSimulationBalance(currentProjectId, simCtx?.runId, 'envelope-only')
  const simulationInfo = simCtx?.runId ? {
    runId: simCtx.runId,
    ranAt: simCtx.results?.created_at ?? null,
    isStale: saveStatus === 'saving' || saveStatus === 'saved',
  } : null

  useEffect(() => {
    fetch('/api/library/constructions')
      .then(r => r.ok ? r.json() : { constructions: [] })
      .then(d => {
        const items = d.constructions ?? []
        setLibrary(items)
        setLibraryData({ constructions: items })
      })
      .catch(() => {})
  }, [])

  // ── Layout state (resizable columns, centre view, right hide) ─────────────
  const [layout, setLayout] = useState(loadLayoutPrefs)
  useEffect(() => {
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout)) } catch {}
  }, [layout])

  const setLeft       = (dx) => setLayout(l => ({ ...l, left:  clamp(l.left  + dx, LEFT_MIN,  LEFT_MAX) }))
  // Brief 28-IM-Polish Bug 2.5: restore right-column resize. Handle sits
  // between centre and right, drags ←/→. Inverted dx (drag right shrinks
  // the right column) since handle is at the centre-side edge of right.
  const setRight      = (dx) => setLayout(l => ({ ...l, right: clamp(l.right - dx, RIGHT_MIN, RIGHT_MAX) }))
  const setCentreView = (v) => setLayout(l => ({ ...l, centre: v }))

  return (
    <div className="flex h-[calc(100vh-3rem)] relative">
      {/* Left: inputs */}
      <div className="flex-shrink-0 z-10" style={{ width: layout.left }}>
        <InputsColumn
          library={library}
          onInspectConstruction={setInspectConstruction}
          liveResult={instantResult}
        />
      </div>

      <ResizeHandle onResize={setLeft} />

      {/* Centre — Brief 28-IM §2.2 view switcher: Heat Balance / Profiles /
          Monthly / Summary (3D moved to right column per §2.1) */}
      <div className="flex-1 relative bg-off-white flex flex-col min-w-0">
        <BuildingCentreTabs
          view={layout.centre}
          onChange={setCentreView}
          instantResult={instantResult}
          simBalance={simBalance}
          simulationInfo={simulationInfo}
          orientationDeg={orientationDeg}
        />
      </div>

      {/* Brief 28-IM-Polish Bug 2.5: right column now resizable, mirroring
          the left handle. Drag the handle ←/→ to grow/shrink. */}
      <ResizeHandle onResize={setRight} />

      {/* Right column — Brief 28-IM §2.1 right (380-480 px): 3D + always-on
          Live Results strip (replaced the 3D / Live Results tab toggle —
          Brief 28-IM-Polish Bug 2.6 / IA 3.2). */}
      <div className="flex-shrink-0 bg-white border-l border-light-grey" style={{ width: layout.right }}>
        <BuildingRightColumn
          params={params}
          instantResult={instantResult}
          comfortBand={comfortBand}
          setComfortBand={setComfortBand}
        />
      </div>

      {/* Expanded Sankey overlay — covers centre + right columns */}
      {showSankey && sankeyResult && (
        <div className="absolute top-0 bottom-0 right-0 z-20" style={{ left: layout.left + 4 }}>
          <ExpandedSankeyOverlay
            result={sankeyResult}
            orientation={params.orientation ?? 0}
            onClose={() => setShowSankey(false)}
          />
        </div>
      )}

      {/* Construction Inspector — opens when a U-value badge is clicked. */}
      <ConstructionInspector
        open={!!inspectConstruction}
        constructionName={inspectConstruction}
        initialMode="view"
        onClose={() => setInspectConstruction(null)}
        onSaved={() => {
          // Re-fetch library after save so any U-value updates reflect immediately.
          fetch('/api/library/constructions')
            .then(r => r.ok ? r.json() : { constructions: [] })
            .then(d => {
              const items = d.constructions ?? []
              setLibrary(items)
              setLibraryData({ constructions: items })
            })
            .catch(() => {})
        }}
      />
    </div>
  )
}
