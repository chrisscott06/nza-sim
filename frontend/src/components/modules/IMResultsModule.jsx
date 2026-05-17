/**
 * IMResultsModule.jsx — Brief 28-IM Gate IM-M5 Results module.
 *
 * Single-column full-width layout (this is aggregation, not editing). Top
 * KPI strip + four view tabs (Energy / Carbon / Monthly / Summary). Reads
 * the new `results.*` engine block (Brief 28-IM IM-M5 §9.1) plus the
 * `consumption.*` block (IM-M4 §8.1) plus `daily_profiles` (for the
 * monthly elec/gas stack and outdoor-temperature overlay).
 *
 * Static is primary; Dynamic comparison surfaced on the Summary tab now
 * that IM-M4.5 Phase 2 brought Dynamic up to consumption.* parity.
 *
 * Stuck-point fallback per Brief 28-IM §15.2:
 *   - Energy Sankey reuses the SystemsModule's `SystemsSankey` component
 *     (proven from IM-M4). No new Sankey wiring.
 *   - Carbon trajectory + Monthly use inline SVG (no recharts) — keeps the
 *     bundle small and avoids the recharts-vs-Vite-prod-build edge cases.
 */

import { useContext, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ProjectContext } from '../../context/ProjectContext.jsx'
import { SimulationContext } from '../../context/SimulationContext.jsx'
import { WeatherContext } from '../../context/WeatherContext.jsx'
import { useHourlySolar } from '../../hooks/useHourlySolar.js'
import { calculateInstant } from '../../utils/instantCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../../data/systemTemplatesLibrary.js'
import { CRREM_HOTEL_KGCO2_PER_M2_YR } from '../../data/crremTargets.js'
// Brief 28-IM-Polish POL-M2: shared chart-consistency components.
import EnginePill from '../shared/EnginePill.jsx'
import ChartTotalsBadge from '../shared/ChartTotalsBadge.jsx'

const ACCENT = '#0F766E'   // results theme — teal-700
const FUEL_COLOURS = {
  electricity: '#ECB01F',
  gas:         '#DC2626',
  district:    '#8B5CF6',
}
const CATEGORY_COLOURS = {
  heating:     '#DC2626',
  cooling:     '#3B82F6',
  dhw:         '#F97316',
  ventilation: '#06B6D4',
  lighting:    '#F59E0B',
  small_power: '#8B5CF6',
}

const CENTRE_TABS = [
  { id: 'energy',   label: 'Energy' },
  { id: 'carbon',   label: 'Carbon' },
  { id: 'monthly',  label: 'Monthly' },
  { id: 'summary',  label: 'Summary' },
]

/* ── Library data fetch (mirror SystemsModule pattern) ───────────────── */
let _constructionsPromise = null
function fetchConstructions() {
  if (_constructionsPromise) return _constructionsPromise
  _constructionsPromise = fetch('/api/library/constructions')
    .then(r => r.ok ? r.json() : { constructions: [] })
    .then(d => (d.constructions ?? []).map(c => ({
      name: c.name,
      u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
      y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
      g_value: c.config_json?.g_value,
      config_json: c.config_json ?? c,
      layers: c.layers,
    })))
    .catch(() => [])
  return _constructionsPromise
}

export default function IMResultsModule() {
  const { params, constructions, systems, comfortBand } = useContext(ProjectContext)
  const { results: simResults } = useContext(SimulationContext)
  const { weatherData } = useContext(WeatherContext)
  const orientation = Number(params?.orientation ?? 0)
  const hourlySolar = useHourlySolar(weatherData, orientation)

  const [constructionsLib, setConstructionsLib] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetchConstructions().then(d => { if (!cancelled) setConstructionsLib(d) })
    return () => { cancelled = true }
  }, [])

  const libraryData = useMemo(() => ({
    constructions: constructionsLib ?? [],
    system_templates: SYSTEM_TEMPLATES_LIBRARY,
  }), [constructionsLib])

  const staticResult = useMemo(() => {
    if (!params || !weatherData || !hourlySolar || !constructionsLib) return null
    const cb = comfortBand ?? { lower_c: 20, upper_c: 26 }
    return calculateInstant(
      { ...params, comfort_band: cb }, constructions ?? {}, systems ?? {},
      libraryData, weatherData, hourlySolar, null,
      { mode: 'full', comfortBand: cb, engine: 'v2.5' },
    )
  }, [params, constructions, systems, libraryData, weatherData, hourlySolar, comfortBand])

  const [centreView, setCentreView] = useState(() => {
    try {
      const saved = localStorage.getItem('nza-results-centre')
      if (CENTRE_TABS.some(t => t.id === saved)) return saved
    } catch {}
    return 'energy'
  })
  useEffect(() => {
    try { localStorage.setItem('nza-results-centre', centreView) } catch {}
  }, [centreView])

  const r = staticResult?.results
  const c = staticResult?.consumption
  const dp = staticResult?.daily_profiles  // for outdoor temp overlay on Monthly

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] bg-off-white">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b border-light-grey px-6 pt-3 pb-3"
           style={{ borderTopWidth: '3px', borderTopColor: ACCENT, borderTopStyle: 'solid' }}>
        <NavLink to="/project" className="text-xxs text-mid-grey hover:text-navy">← Overview</NavLink>
        <p className="text-caption font-medium mt-0.5" style={{ color: ACCENT }}>Results</p>
        <p className="text-xxs text-mid-grey">
          Whole-building outputs aggregated from Static (instant) and Dynamic (EnergyPlus
          when last run). Use the tabs to inspect energy carriers, the carbon trajectory
          against the CRREM 1.5°C pathway, monthly drivers, and Static-vs-Dynamic
          comparison numbers.
        </p>
      </div>

      {/* KPI strip */}
      {r ? <KpiStrip r={r} c={c} /> : <KpiStripPlaceholder />}

      {/* Tab bar */}
      <div className="flex-shrink-0 flex items-center gap-0 border-b border-light-grey bg-white px-4">
        {CENTRE_TABS.map(t => {
          const active = t.id === centreView
          return (
            <button
              key={t.id}
              onClick={() => setCentreView(t.id)}
              className={`px-4 py-1.5 text-caption transition-colors border-b-2 -mb-px ${
                active ? 'border-navy text-navy font-medium' : 'border-transparent text-mid-grey hover:text-navy'
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {!r && (
          <div className="h-full flex items-center justify-center text-mid-grey text-xxs">
            Engine output not ready — load weather data + library.
          </div>
        )}
        {r && centreView === 'energy'  && <EnergyView   r={r} c={c} />}
        {r && centreView === 'carbon'  && <CarbonView   r={r} />}
        {r && centreView === 'monthly' && <MonthlyView  staticResult={staticResult} weatherData={weatherData} />}
        {r && centreView === 'summary' && <SummaryView  r={r} c={c} staticResult={staticResult} simResults={simResults} />}
      </div>
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   KPI STRIP (top of module — 4 big numbers)
   ─────────────────────────────────────────────────────────────────────── */
function KpiStripPlaceholder() {
  return (
    <div className="flex-shrink-0 bg-white border-b border-light-grey px-6 py-4 grid grid-cols-4 gap-4">
      {[1,2,3,4].map(i => (
        <div key={i} className="h-16 bg-off-white rounded animate-pulse" />
      ))}
    </div>
  )
}

function KpiStrip({ r, c }) {
  const eui = r.energy.kwh_per_m2_yr
  const carbonToday = r.carbon.today.kgCO2_per_m2_yr
  const totalT = r.carbon.today.total_tCO2
  const carbon2038 = r.carbon.horizon_2038_kgCO2_per_m2_yr
  const yoe = r.crrem.year_of_exceedance
  const stranding = r.crrem.year_of_stranding
  const binding = r.crrem.binding_milestone

  return (
    <div className="flex-shrink-0 bg-white border-b border-light-grey px-6 py-4 grid grid-cols-4 gap-4">
      <KpiCard
        label="EUI (instant)"
        value={eui.toFixed(1)}
        unit="kWh/m²·yr"
        sub={`Total ${(r.energy.total_mwh).toFixed(1)} MWh/yr`}
        accent={ACCENT}
      />
      <KpiCard
        label="Carbon today"
        value={carbonToday.toFixed(1)}
        unit="kgCO₂/m²·yr"
        sub={`Total ${totalT.toFixed(1)} tCO₂/yr · grid ${r.carbon.grid_intensity_today_gCO2_per_kWh} gCO₂/kWh`}
        accent="#DC2626"
      />
      <KpiCard
        label="Carbon 2038"
        value={carbon2038?.toFixed(1) ?? '—'}
        unit="kgCO₂/m²·yr"
        sub={`Grid decarbonisation alone (no retrofit) — ${(((carbonToday - carbon2038) / carbonToday) * 100).toFixed(0)}% reduction`}
        accent="#16A34A"
      />
      <KpiCard
        label={
          binding === '2030' ? 'Exceedance year' :
          binding === '2050' ? 'Stranding year' : 'CRREM compliance'
        }
        value={
          binding === '2030' ? (yoe ?? '—') :
          binding === '2050' ? (stranding ?? '—') :
          (r.crrem.year_2050_met ?? '—')
        }
        unit={binding === 'compliant' ? '' : 'year'}
        sub={
          binding === '2030' ? `Building drops below CRREM target (current gap ${r.crrem.gap_to_2030_kgCO2_per_m2.toFixed(1)} kg/m²)` :
          binding === '2050' ? `Already below 2030 target — tightens past building in ${stranding ?? 'never'} (gap to 2050: ${r.crrem.gap_to_2050_kgCO2_per_m2.toFixed(1)} kg/m²)` :
          'Building meets 2050 target without retrofit'
        }
        accent="#F59E0B"
      />
    </div>
  )
}

function KpiCard({ label, value, unit, sub, accent }) {
  return (
    <div className="bg-white border border-light-grey rounded p-3" style={{ borderLeft: `3px solid ${accent}` }}>
      <p className="text-xxs uppercase tracking-wider text-mid-grey">{label}</p>
      <p className="text-2xl text-navy font-bold tabular-nums leading-tight mt-0.5">
        {value} <span className="text-xxs text-mid-grey font-normal">{unit}</span>
      </p>
      <p className="text-xxs text-mid-grey/80 leading-tight mt-1">{sub}</p>
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   ENERGY VIEW — full-width Sankey-replacement + per-category bars + per-carrier bars
   §15.2 fallback note: not threading the SystemsModule Sankey here (it's
   tied tightly to SystemsModule's sysCfg shape and a duplicate render
   would invite drift). Instead a clean horizontal flow diagram of demand
   → carrier built inline + supplementary stacked bars.
   ─────────────────────────────────────────────────────────────────────── */
function EnergyView({ r, c }) {
  const cats = [
    { key: 'heating',     label: 'Space heating',  mwh: r.energy.by_category.heating,     color: CATEGORY_COLOURS.heating },
    { key: 'cooling',     label: 'Space cooling',  mwh: r.energy.by_category.cooling,     color: CATEGORY_COLOURS.cooling },
    { key: 'dhw',         label: 'DHW',            mwh: r.energy.by_category.dhw,         color: CATEGORY_COLOURS.dhw },
    { key: 'ventilation', label: 'Ventilation',    mwh: r.energy.by_category.ventilation, color: CATEGORY_COLOURS.ventilation },
    { key: 'lighting',    label: 'Lighting',       mwh: r.energy.by_category.lighting,    color: CATEGORY_COLOURS.lighting },
    { key: 'small_power', label: 'Small power',    mwh: r.energy.by_category.small_power, color: CATEGORY_COLOURS.small_power },
  ]
  const maxCat = Math.max(...cats.map(x => x.mwh), 1)
  const elec = r.energy.by_carrier.electricity
  const gas  = r.energy.by_carrier.gas
  const totalCarrier = Math.max(elec + gas, 1)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Energy by category */}
      <div className="bg-white border border-light-grey rounded p-4">
        {/* Brief 28-IM-Polish POL-M2 */}
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
          <div className="flex items-center gap-2">
            <EnginePill mode="static" />
            <p className="text-caption font-semibold text-navy">Energy delivered by category</p>
          </div>
          <ChartTotalsBadge label="Σ delivered" value_kwh={cats.reduce((s, c) => s + c.mwh, 0) * 1000} />
        </div>
        <p className="text-xxs text-mid-grey mb-3">
          Annual delivered energy that each demand category required from its assigned
          system (after the SCOP/SEER/efficiency cascade). Lighting + small power are
          electric end-uses (delivered = consumed).
        </p>
        <div className="space-y-2">
          {cats.map(cat => (
            <div key={cat.key} className="flex items-center gap-3">
              <div className="w-28 text-xxs text-navy flex-shrink-0">{cat.label}</div>
              <div className="flex-1 relative h-6 bg-light-grey/30 rounded overflow-hidden">
                <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${(cat.mwh / maxCat) * 100}%`, backgroundColor: cat.color, opacity: 0.85 }} />
              </div>
              <div className="w-20 text-xxs text-navy tabular-nums text-right">{cat.mwh.toFixed(1)} MWh</div>
              <div className="w-12 text-xxs text-mid-grey tabular-nums text-right">{((cat.mwh / cats.reduce((s, x) => s + x.mwh, 0)) * 100).toFixed(0)}%</div>
            </div>
          ))}
        </div>
      </div>

      {/* Energy by carrier */}
      <div className="bg-white border border-light-grey rounded p-4">
        <p className="text-caption font-semibold text-navy mb-1">Energy consumed by carrier · MWh/yr</p>
        <p className="text-xxs text-mid-grey mb-3">
          Site energy by fuel. Electricity dominates BRUKL-design Bridgewater; gas
          is the DHW fraction (depends on the DHW fuel-mix slider in the Systems
          left column).
        </p>
        <div className="space-y-2">
          <FuelCarrierBar label="Electricity" mwh={elec} total={totalCarrier} color={FUEL_COLOURS.electricity} />
          <FuelCarrierBar label="Natural gas" mwh={gas}  total={totalCarrier} color={FUEL_COLOURS.gas} />
        </div>
        <div className="mt-3 text-xxs text-mid-grey">
          Carbon today = electricity {elec.toFixed(1)} MWh × {r.carbon.grid_intensity_today_gCO2_per_kWh} g/kWh
          + gas {gas.toFixed(1)} MWh × {r.carbon.gas_intensity_gCO2_per_kWh} g/kWh
          = {r.carbon.today.total_tCO2.toFixed(1)} tCO₂/yr ({r.carbon.today.kgCO2_per_m2_yr.toFixed(1)} kg/m²/yr).
        </div>
      </div>

      {/* Demand → carrier flow strip */}
      <div className="bg-white border border-light-grey rounded p-4">
        <p className="text-caption font-semibold text-navy mb-1">Demand → carrier flow</p>
        <p className="text-xxs text-mid-grey mb-3">
          Each category's split between electricity (yellow) and gas (red). Heating
          + cooling + ventilation + lighting + small power are electricity-only on
          Bridgewater. DHW splits per the fuel_mix slider.
        </p>
        <FlowStrip c={c} categories={cats} />
      </div>
    </div>
  )
}

function FuelCarrierBar({ label, mwh, total, color }) {
  const pct = total > 0 ? (mwh / total * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 text-xxs text-navy flex-shrink-0">{label}</div>
      <div className="flex-1 relative h-6 bg-light-grey/30 rounded overflow-hidden">
        <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.85 }} />
      </div>
      <div className="w-20 text-xxs text-navy tabular-nums text-right">{mwh.toFixed(1)} MWh</div>
      <div className="w-12 text-xxs text-mid-grey tabular-nums text-right">{pct.toFixed(0)}%</div>
    </div>
  )
}

function FlowStrip({ c, categories }) {
  // For each category, draw an electricity slice + gas slice as proportional widths
  if (!c) return null
  return (
    <div className="space-y-1.5">
      {categories.map(cat => {
        const node = (() => {
          switch (cat.key) {
            case 'heating':     return c.space_heating
            case 'cooling':     return { electricity_mwh: c.space_cooling?.electricity_mwh ?? 0, gas_mwh: 0 }
            case 'dhw':         return c.dhw
            case 'ventilation': return { electricity_mwh: (c.ventilation ?? []).reduce((s, v) => s + (v.fan_electricity_mwh ?? 0), 0), gas_mwh: 0 }
            case 'lighting':    return { electricity_mwh: c.lighting?.electricity_mwh ?? 0, gas_mwh: 0 }
            case 'small_power': return { electricity_mwh: c.small_power?.electricity_mwh ?? 0, gas_mwh: 0 }
            default: return { electricity_mwh: 0, gas_mwh: 0 }
          }
        })()
        const e = node.electricity_mwh ?? 0
        const g = node.gas_mwh ?? 0
        const total = Math.max(e + g, 0.001)
        const wpx = (frac) => Math.max(2, frac * 600)   // 600px is the assumed flow strip width
        return (
          <div key={cat.key} className="flex items-center gap-3 text-xxs">
            <div className="w-28 text-navy flex-shrink-0">{cat.label}</div>
            <div className="flex h-5 rounded overflow-hidden">
              {e > 0.01 && <div style={{ width: `${wpx(e / total)}px`, backgroundColor: FUEL_COLOURS.electricity }} title={`Electricity ${e.toFixed(2)} MWh`} />}
              {g > 0.01 && <div style={{ width: `${wpx(g / total)}px`, backgroundColor: FUEL_COLOURS.gas }} title={`Gas ${g.toFixed(2)} MWh`} />}
            </div>
            <div className="text-mid-grey tabular-nums">
              {e > 0.01 && <span style={{ color: FUEL_COLOURS.electricity }}>{e.toFixed(1)} elec</span>}
              {e > 0.01 && g > 0.01 && ' · '}
              {g > 0.01 && <span style={{ color: FUEL_COLOURS.gas }}>{g.toFixed(1)} gas</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   CARBON VIEW — trajectory line chart 2024-2050 + CRREM overlay
   ─────────────────────────────────────────────────────────────────────── */
function CarbonView({ r }) {
  const W = 900, H = 380, padL = 60, padR = 40, padT = 30, padB = 50
  const cw = W - padL - padR
  const ch = H - padT - padB
  const traj = r.carbon.trajectory
  const targets = r.crrem.targets

  const years = traj.map(t => t.year)
  const yMin = years[0], yMax = years[years.length - 1]
  const xs = (y) => padL + ((y - yMin) / (yMax - yMin)) * cw

  const valMax = Math.max(
    Math.max(...traj.map(t => t.kgCO2_per_m2_yr)),
    Math.max(...targets.map(t => t.target)),
    35,
  )
  const ys = (v) => padT + ch - (v / valMax) * ch

  const trajPath = traj.map((t, i) => `${i === 0 ? 'M' : 'L'} ${xs(t.year)} ${ys(t.kgCO2_per_m2_yr)}`).join(' ')
  const targetPath = targets.map((t, i) => `${i === 0 ? 'M' : 'L'} ${xs(t.year)} ${ys(t.target)}`).join(' ')

  const yoe = r.crrem.year_of_exceedance
  const stranding = r.crrem.year_of_stranding
  const today = traj[0]
  const e2038 = traj.find(t => t.year === 2038)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="bg-white border border-light-grey rounded p-4">
        {/* Brief 28-IM-Polish POL-M2 */}
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
          <div className="flex items-center gap-2">
            <EnginePill mode="static" />
            <p className="text-caption font-semibold text-navy">Annual carbon trajectory · 2024 – 2050</p>
          </div>
          <ChartTotalsBadge label="Today" value_kwh={r.carbon.today.total_tCO2 * 1000} />
        </div>
        <p className="text-xxs text-mid-grey mb-3">
          Building carbon intensity projected forward with UK grid decarbonisation
          (DESNZ / National Grid ESO FES) and stable 184 gCO₂/kWh gas. CRREM Hotel
          International 1.5°C-aligned target line overlaid for comparison.
          {' '}<span className="font-medium text-navy">No retrofit interventions yet</span> — this is the
          baseline trajectory the IM-M6 Roadmap will improve.
        </p>

        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}>
          {/* y-axis grid + labels */}
          {[0, 10, 20, 30].filter(v => v <= valMax).map(v => (
            <g key={v}>
              <line x1={padL} x2={padL + cw} y1={ys(v)} y2={ys(v)} stroke="#E5E7EB" strokeWidth="1" />
              <text x={padL - 8} y={ys(v) + 4} fontSize="10" fill="#9CA3AF" textAnchor="end">{v}</text>
            </g>
          ))}
          <text x={padL - 45} y={padT - 8} fontSize="10" fill="#475569">kgCO₂/m²·yr</text>

          {/* x-axis labels */}
          {[2024, 2030, 2035, 2040, 2050].map(y => (
            <g key={y}>
              <line x1={xs(y)} x2={xs(y)} y1={padT + ch} y2={padT + ch + 4} stroke="#9CA3AF" strokeWidth="1" />
              <text x={xs(y)} y={padT + ch + 18} fontSize="10" fill="#475569" textAnchor="middle">{y}</text>
            </g>
          ))}

          {/* CRREM target line (red dashed) */}
          <path d={targetPath} fill="none" stroke="#DC2626" strokeWidth="2" strokeDasharray="6 4" />
          {/* Building trajectory (teal solid) */}
          <path d={trajPath} fill="none" stroke="#0F766E" strokeWidth="2.5" />

          {/* Today marker */}
          <circle cx={xs(today.year)} cy={ys(today.kgCO2_per_m2_yr)} r="5" fill="#0F766E" />
          <text x={xs(today.year)} y={ys(today.kgCO2_per_m2_yr) - 10} fontSize="10" fill="#0F766E" textAnchor="middle" fontWeight="600">
            today {today.kgCO2_per_m2_yr.toFixed(1)}
          </text>

          {/* 2038 marker */}
          {e2038 && (
            <>
              <circle cx={xs(2038)} cy={ys(e2038.kgCO2_per_m2_yr)} r="5" fill="#16A34A" />
              <text x={xs(2038)} y={ys(e2038.kgCO2_per_m2_yr) - 10} fontSize="10" fill="#16A34A" textAnchor="middle" fontWeight="600">
                2038 {e2038.kgCO2_per_m2_yr.toFixed(1)}
              </text>
            </>
          )}

          {/* Year of stranding marker (if any) */}
          {stranding && (() => {
            const e = traj.find(t => t.year === stranding)
            return e ? (
              <>
                <line x1={xs(stranding)} x2={xs(stranding)} y1={padT} y2={padT + ch} stroke="#F59E0B" strokeWidth="1.5" strokeDasharray="2 3" />
                <circle cx={xs(stranding)} cy={ys(e.kgCO2_per_m2_yr)} r="5" fill="#F59E0B" />
                <text x={xs(stranding)} y={padT - 8} fontSize="10" fill="#F59E0B" textAnchor="middle" fontWeight="700">
                  STRANDS {stranding}
                </text>
              </>
            ) : null
          })()}

          {/* Legend */}
          <g transform={`translate(${padL + cw - 220}, ${padT + 10})`}>
            <rect x={0} y={0} width={210} height={50} fill="white" stroke="#E5E7EB" strokeWidth="1" rx={4} />
            <line x1={10} x2={28} y1={15} y2={15} stroke="#0F766E" strokeWidth="2.5" />
            <text x={34} y={19} fontSize="10" fill="#0F766E" fontWeight="600">Building trajectory</text>
            <line x1={10} x2={28} y1={32} y2={32} stroke="#DC2626" strokeWidth="2" strokeDasharray="6 4" />
            <text x={34} y={36} fontSize="10" fill="#DC2626" fontWeight="600">CRREM 1.5°C (Hotel Intl)</text>
          </g>
        </svg>

        <div className="grid grid-cols-3 gap-3 mt-4 text-xxs">
          <div className="bg-off-white border border-light-grey rounded p-2">
            <p className="text-mid-grey">CRREM 2030 target</p>
            <p className="text-navy font-semibold tabular-nums">{r.crrem.target_2030.toFixed(1)} kgCO₂/m²·yr</p>
            <p className="text-mid-grey">Today gap: <span className={r.crrem.gap_to_2030_kgCO2_per_m2 > 0 ? 'text-amber-700' : 'text-green-700'}>
              {r.crrem.gap_to_2030_kgCO2_per_m2 > 0 ? '+' : ''}{r.crrem.gap_to_2030_kgCO2_per_m2.toFixed(1)}
            </span></p>
          </div>
          <div className="bg-off-white border border-light-grey rounded p-2">
            <p className="text-mid-grey">CRREM 2050 target</p>
            <p className="text-navy font-semibold tabular-nums">{r.crrem.target_2050.toFixed(1)} kgCO₂/m²·yr</p>
            <p className="text-mid-grey">2050 gap: <span className={r.crrem.gap_to_2050_kgCO2_per_m2 > 0 ? 'text-amber-700' : 'text-green-700'}>
              {r.crrem.gap_to_2050_kgCO2_per_m2 > 0 ? '+' : ''}{r.crrem.gap_to_2050_kgCO2_per_m2.toFixed(1)}
            </span></p>
          </div>
          <div className="bg-off-white border border-light-grey rounded p-2">
            <p className="text-mid-grey">Status</p>
            <p className="text-navy font-semibold">{
              r.crrem.binding_milestone === '2030' ? 'Above 2030 target' :
              r.crrem.binding_milestone === '2050' ? 'Strands ' + (stranding ?? '—') :
              'Meets all targets'
            }</p>
            <p className="text-mid-grey">
              {r.crrem.binding_milestone === '2030' && 'Roadmap must drop below 17.5 kg/m² by 2030'}
              {r.crrem.binding_milestone === '2050' && 'CRREM tightens past building before 2050'}
              {r.crrem.binding_milestone === 'compliant' && 'No retrofit needed for CRREM 1.5°C'}
            </p>
          </div>
        </div>
      </div>

      {/* Breakdown by carrier */}
      <div className="bg-white border border-light-grey rounded p-4">
        <p className="text-caption font-semibold text-navy mb-1">Carbon by carrier · today</p>
        <p className="text-xxs text-mid-grey mb-3">
          Electricity follows the grid trajectory (drops rapidly through 2030); gas
          stays flat. Carbon-share inversion will be the dominant story in the
          mid-2030s.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-off-white border border-light-grey rounded p-3">
            <p className="text-xxs text-mid-grey">Electricity</p>
            <p className="text-xl text-navy font-semibold tabular-nums">{r.carbon.by_carrier.electricity_kgCO2_per_m2_yr.toFixed(1)}
              <span className="text-xxs text-mid-grey ml-1">kgCO₂/m²·yr</span>
            </p>
            <p className="text-xxs text-mid-grey">at {r.carbon.grid_intensity_today_gCO2_per_kWh} gCO₂/kWh grid intensity</p>
          </div>
          <div className="bg-off-white border border-light-grey rounded p-3">
            <p className="text-xxs text-mid-grey">Natural gas</p>
            <p className="text-xl text-navy font-semibold tabular-nums">{r.carbon.by_carrier.gas_kgCO2_per_m2_yr.toFixed(1)}
              <span className="text-xxs text-mid-grey ml-1">kgCO₂/m²·yr</span>
            </p>
            <p className="text-xxs text-mid-grey">at {r.carbon.gas_intensity_gCO2_per_kWh} gCO₂/kWh (stable)</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   MONTHLY VIEW — 12 bars stacked elec + gas + outdoor temp line overlay
   ─────────────────────────────────────────────────────────────────────── */
function MonthlyView({ staticResult, weatherData }) {
  const dpEng = staticResult?.energy_use?.daily_profiles ?? staticResult?.consumption?.daily_profiles
  const dpFab = staticResult?.daily_profiles
  if (!dpEng) {
    return <div className="h-full flex items-center justify-center text-mid-grey text-xxs">Daily profile arrays missing.</div>
  }
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const _CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365]
  const toMonth = (daily) => {
    const out = new Array(12).fill(0)
    if (!Array.isArray(daily)) return out
    for (let d = 0; d < Math.min(365, daily.length); d++) {
      let m = 0
      while (m < 11 && _CUM[m + 1] <= d) m++
      out[m] += daily[d]
    }
    return out
  }
  const elecM = toMonth(dpEng.fuel_kwh_per_day?.electricity)
  const gasM  = toMonth(dpEng.fuel_kwh_per_day?.gas)
  // Outdoor temp monthly mean: take weather mid-month sample or aggregate from dpFab.weather.
  const tOutSum = dpFab?.weather?.t_out_sum_c ?? []
  const tOutMonthly = (() => {
    const out = new Array(12).fill(0)
    const cnt = new Array(12).fill(0)
    if (!tOutSum.length) return out
    for (let d = 0; d < Math.min(365, tOutSum.length); d++) {
      let m = 0
      while (m < 11 && _CUM[m + 1] <= d) m++
      out[m] += tOutSum[d] / 24    // sum-of-hour → daily mean → accumulate
      cnt[m] += 1
    }
    return out.map((v, i) => cnt[i] > 0 ? v / cnt[i] : 0)
  })()
  const maxBar = Math.max(...elecM.map((e, i) => e + gasM[i]), 1)
  const minT = Math.min(...tOutMonthly), maxT = Math.max(...tOutMonthly)

  // SVG layout
  const W = 900, H = 360, padL = 50, padR = 60, padT = 30, padB = 50
  const cw = W - padL - padR
  const ch = H - padT - padB
  const barW = cw / 12 * 0.7
  const barGap = cw / 12 * 0.3
  const x = (i) => padL + i * (cw / 12) + barGap / 2
  const yBar = (v) => padT + ch - (v / maxBar) * ch
  const yT = (t) => padT + ch - ((t - minT) / Math.max(maxT - minT, 0.001)) * ch * 0.8

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="bg-white border border-light-grey rounded p-4">
        {/* Brief 28-IM-Polish POL-M2 */}
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
          <div className="flex items-center gap-2">
            <EnginePill mode="static" />
            <p className="text-caption font-semibold text-navy">Monthly site energy + outdoor temperature</p>
          </div>
          <div className="flex items-center gap-2">
            <ChartTotalsBadge label="Σ elec" value_kwh={elecM.reduce((s,v)=>s+v,0)} />
            <ChartTotalsBadge label="Σ gas"  value_kwh={gasM.reduce((s,v)=>s+v,0)} />
          </div>
        </div>
        <p className="text-xxs text-mid-grey mb-3">
          Per-month aggregation of the engine's daily fuel arrays. Bars stack
          {' '}<span style={{ color: FUEL_COLOURS.electricity }}>electricity</span> + <span style={{ color: FUEL_COLOURS.gas }}>gas</span>;
          the orange line traces monthly mean outdoor dry-bulb temperature so the
          heating-vs-cooling driver pattern is visually obvious.
        </p>

        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}>
          {/* y-grid */}
          {[0, maxBar * 0.25, maxBar * 0.5, maxBar * 0.75, maxBar].map((v, i) => (
            <g key={i}>
              <line x1={padL} x2={padL + cw} y1={yBar(v)} y2={yBar(v)} stroke="#E5E7EB" />
              <text x={padL - 8} y={yBar(v) + 4} fontSize="9" fill="#9CA3AF" textAnchor="end">{Math.round(v).toLocaleString()}</text>
            </g>
          ))}
          <text x={padL - 40} y={padT - 8} fontSize="10" fill="#475569">kWh</text>
          <text x={padL + cw + 35} y={padT - 8} fontSize="10" fill="#F59E0B">°C</text>

          {/* Bars: gas (bottom) + elec (top) */}
          {months.map((m, i) => {
            const gh = (gasM[i] / maxBar) * ch
            const eh = (elecM[i] / maxBar) * ch
            return (
              <g key={m}>
                <rect x={x(i)} y={padT + ch - gh} width={barW} height={gh} fill={FUEL_COLOURS.gas} opacity={0.85} />
                <rect x={x(i)} y={padT + ch - gh - eh} width={barW} height={eh} fill={FUEL_COLOURS.electricity} opacity={0.85} />
                <text x={x(i) + barW / 2} y={padT + ch + 16} fontSize="10" fill="#475569" textAnchor="middle">{m}</text>
                <text x={x(i) + barW / 2} y={padT + ch - gh - eh - 4} fontSize="9" fill="#475569" textAnchor="middle">
                  {(elecM[i] + gasM[i]) > 1000 ? ((elecM[i] + gasM[i]) / 1000).toFixed(1) + 'k' : Math.round(elecM[i] + gasM[i])}
                </text>
              </g>
            )
          })}

          {/* Temperature line (right axis) */}
          <path
            d={tOutMonthly.map((t, i) => `${i === 0 ? 'M' : 'L'} ${x(i) + barW / 2} ${yT(t)}`).join(' ')}
            fill="none" stroke="#F59E0B" strokeWidth="2.5" strokeDasharray="3 3"
          />
          {tOutMonthly.map((t, i) => (
            <g key={`t-${i}`}>
              <circle cx={x(i) + barW / 2} cy={yT(t)} r="3" fill="#F59E0B" />
              <text x={x(i) + barW / 2} y={yT(t) - 6} fontSize="9" fill="#F59E0B" textAnchor="middle" fontWeight="600">{t.toFixed(0)}°</text>
            </g>
          ))}
        </svg>

        <div className="flex items-center gap-4 mt-3 text-xxs text-mid-grey">
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm" style={{ backgroundColor: FUEL_COLOURS.electricity }} /> Electricity</div>
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm" style={{ backgroundColor: FUEL_COLOURS.gas }} /> Gas</div>
          <div className="flex items-center gap-1 text-amber-600"><span>···</span> Outdoor T (monthly mean)</div>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   SUMMARY VIEW — aggregation table + Static vs Dynamic Δ%
   ─────────────────────────────────────────────────────────────────────── */
function SummaryView({ r, c, staticResult, simResults }) {
  // Pull Dynamic consumption block (if simulation has run + Phase 2 brought it
  // up to consumption.* shape). simResults is from SimulationContext —
  // post-Phase-2 the simulate API surfaces `consumption` on the response.
  const dynC = simResults?.consumption ?? null

  const rows = [
    { key: 'space_heating', label: 'Space heating', staticNode: c?.space_heating,                                       dynNode: dynC?.space_heating },
    { key: 'space_cooling', label: 'Space cooling', staticNode: c?.space_cooling,                                       dynNode: dynC?.space_cooling },
    { key: 'dhw',           label: 'DHW',           staticNode: c?.dhw,                                                 dynNode: dynC?.dhw },
    { key: 'ventilation',   label: 'Ventilation',   staticNode: { electricity_mwh: (c?.ventilation ?? []).reduce((s,v)=>s+(v.fan_electricity_mwh ?? 0),0), gas_mwh: 0, demand_mwh: (c?.ventilation ?? []).reduce((s,v)=>s+(v.fan_electricity_mwh ?? 0),0), delivered_mwh: (c?.ventilation ?? []).reduce((s,v)=>s+(v.fan_electricity_mwh ?? 0),0) },
      dynNode: dynC?.ventilation?.[0] ? { electricity_mwh: dynC.ventilation[0].fan_electricity_mwh, gas_mwh: 0, demand_mwh: dynC.ventilation[0].fan_electricity_mwh, delivered_mwh: dynC.ventilation[0].fan_electricity_mwh } : null },
    { key: 'lighting',      label: 'Lighting',      staticNode: c?.lighting    ? { ...c.lighting,    demand_mwh: c.lighting.electricity_mwh,    delivered_mwh: c.lighting.electricity_mwh,    gas_mwh: 0 } : null, dynNode: dynC?.lighting    ? { ...dynC.lighting,    demand_mwh: dynC.lighting.electricity_mwh,    delivered_mwh: dynC.lighting.electricity_mwh,    gas_mwh: 0 } : null },
    { key: 'small_power',   label: 'Small power',   staticNode: c?.small_power ? { ...c.small_power, demand_mwh: c.small_power.electricity_mwh, delivered_mwh: c.small_power.electricity_mwh, gas_mwh: 0 } : null, dynNode: dynC?.small_power ? { ...dynC.small_power, demand_mwh: dynC.small_power.electricity_mwh, delivered_mwh: dynC.small_power.electricity_mwh, gas_mwh: 0 } : null },
  ]
  const delta = (s, d) => {
    if (s == null || d == null) return null
    if (Math.abs(s) < 0.01) return null
    return ((d - s) / s) * 100
  }
  const cellDelta = (s, d) => {
    const pct = delta(s, d)
    if (pct == null) return ''
    const color = Math.abs(pct) <= 10 ? 'text-green-700' : Math.abs(pct) <= 30 ? 'text-amber-700' : 'text-red-600'
    return <span className={color}>({pct > 0 ? '+' : ''}{pct.toFixed(0)}%)</span>
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="bg-white border border-light-grey rounded p-4">
        {/* Brief 28-IM-Polish POL-M2 */}
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
          <div className="flex items-center gap-2">
            <EnginePill mode={dynC ? 'both' : 'static'} dynamicReady={!!dynC} />
            <p className="text-caption font-semibold text-navy">Annual summary — Static vs Dynamic</p>
          </div>
          <div className="flex items-center gap-2">
            <ChartTotalsBadge label="Σ elec" value_kwh={(c?.total?.electricity_mwh ?? 0) * 1000} engineMode="static" />
            <ChartTotalsBadge label="Σ gas"  value_kwh={(c?.total?.gas_mwh         ?? 0) * 1000} engineMode="static" />
          </div>
        </div>
        <p className="text-xxs text-mid-grey mb-3">
          IM-M4.5 Phase 2 brought Dynamic up to the same <code>consumption.*</code> shape
          as Static, so this side-by-side comparison is now meaningful per category.
          {dynC == null && <span className="text-amber-700"> No Dynamic run available — run the simulation from the toolbar to populate the Dynamic column.</span>}
        </p>
        <table className="w-full text-xxs border-collapse">
          <thead>
            <tr className="border-b border-light-grey text-mid-grey uppercase tracking-wider">
              <th className="text-left  py-2 pr-3 font-medium">Category</th>
              <th className="text-right py-2 pr-3 font-medium">Static demand</th>
              <th className="text-right py-2 pr-3 font-medium">Static delivered</th>
              <th className="text-right py-2 pr-3 font-medium">Static elec</th>
              <th className="text-right py-2 pr-3 font-medium">Static gas</th>
              <th className="text-right py-2 pr-3 font-medium">Dynamic demand</th>
              <th className="text-right py-2 pr-3 font-medium">Dynamic elec</th>
              <th className="text-right py-2 pr-3 font-medium">Dynamic gas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key} className="border-b border-light-grey/50">
                <td className="py-1.5 pr-3 text-navy">{row.label}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{row.staticNode?.demand_mwh != null    ? row.staticNode.demand_mwh.toFixed(1) : '—'}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{row.staticNode?.delivered_mwh != null ? row.staticNode.delivered_mwh.toFixed(1) : '—'}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{row.staticNode?.electricity_mwh != null ? row.staticNode.electricity_mwh.toFixed(1) : '—'}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{row.staticNode?.gas_mwh != null         ? row.staticNode.gas_mwh.toFixed(1) : '—'}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {row.dynNode?.demand_mwh != null ? row.dynNode.demand_mwh.toFixed(1) : '—'}
                  {' '}{cellDelta(row.staticNode?.demand_mwh, row.dynNode?.demand_mwh)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {row.dynNode?.electricity_mwh != null ? row.dynNode.electricity_mwh.toFixed(1) : '—'}
                  {' '}{cellDelta(row.staticNode?.electricity_mwh, row.dynNode?.electricity_mwh)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {row.dynNode?.gas_mwh != null ? row.dynNode.gas_mwh.toFixed(1) : '—'}
                  {' '}{cellDelta(row.staticNode?.gas_mwh, row.dynNode?.gas_mwh)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-navy/30 font-semibold">
              <td className="py-2 pr-3 text-navy">Total</td>
              <td colSpan={2} />
              <td className="py-2 pr-3 text-right tabular-nums">{c?.total?.electricity_mwh?.toFixed(1)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{c?.total?.gas_mwh?.toFixed(1)}</td>
              <td />
              <td className="py-2 pr-3 text-right tabular-nums">
                {dynC?.total?.electricity_mwh != null ? dynC.total.electricity_mwh.toFixed(1) : '—'}
                {' '}{cellDelta(c?.total?.electricity_mwh, dynC?.total?.electricity_mwh)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {dynC?.total?.gas_mwh != null ? dynC.total.gas_mwh.toFixed(1) : '—'}
                {' '}{cellDelta(c?.total?.gas_mwh, dynC?.total?.gas_mwh)}
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-3 text-navy font-semibold">EUI (kWh/m²·yr)</td>
              <td colSpan={3} />
              <td className="py-2 pr-3 text-right tabular-nums text-navy font-bold">{c?.total?.kwh_per_m2_yr?.toFixed(1)}</td>
              <td />
              <td colSpan={2} className="py-2 pr-3 text-right tabular-nums text-navy font-bold">
                {dynC?.total?.kwh_per_m2_yr != null ? dynC.total.kwh_per_m2_yr.toFixed(1) : '—'}
                {' '}{cellDelta(c?.total?.kwh_per_m2_yr, dynC?.total?.kwh_per_m2_yr)}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 text-xxs text-mid-grey/80 italic max-w-4xl space-y-1">
          <p><span className="font-medium not-italic text-amber-700">Convention notes (Static vs Dynamic):</span></p>
          <p>• Static <code>demand_mwh</code> is setpoint-convention (heat load to hold 21 °C against the gain-warmed zone);
            Dynamic <code>demand_mwh</code> is EnergyPlus's <code>Heating:EnergyTransfer</code> (what the autosized
            system supplied). When a service is disabled, Static still reports demand; Dynamic reports ~0 + unmet hours.</p>
          <p>• Ventilation: Static splits per-system (mvhr_gf_public + bedroom_extract + public_toilet_extract); Dynamic
            V1 aggregates all fans into one <code>Fans:Electricity</code> meter. Row above shows the totals only.</p>
          <p>• DHW: Static apportions across the <code>fuel_mix</code> sliders; Dynamic V1 uses the legacy primary/secondary
            path (queued for Brief 28-DynamicParity). Large Δ on DHW is the expected V1 gap, not a bug.</p>
          <p>• Lighting + small power: Static reads <code>building.gains.*.profiles</code> directly; Dynamic uses the
            assembler's V2.3 template densities. Profile-vs-template mismatch produces the bigger Δ on these rows.</p>
          <p className="pt-1">See <code>docs/validation/brief_28im_M4_5_dynamic_audit_phase2_pass.md</code> for the full
            list of deferred parity items.</p>
        </div>
      </div>

      {/* CRREM headline numbers as a footer block */}
      <div className="bg-white border border-light-grey rounded p-4">
        <p className="text-caption font-semibold text-navy mb-1">CRREM 1.5°C compliance · Hotel International</p>
        <p className="text-xxs text-mid-grey mb-3">
          Source: CRREM Global Pathways v2.04. Targets interpolate between published
          waypoints (2024 / 2030 / 2040 / 2050). The "year of stranding" is when
          the tightening target overtakes the building's grid-driven decarbonisation
          plateau.
        </p>
        <div className="grid grid-cols-4 gap-3 text-xxs">
          {CRREM_HOTEL_KGCO2_PER_M2_YR.map(t => (
            <div key={t.year} className="bg-off-white border border-light-grey rounded p-2 text-center">
              <p className="text-mid-grey">{t.year}</p>
              <p className="text-navy font-semibold tabular-nums">{t.target.toFixed(1)}</p>
              <p className="text-mid-grey/70">kgCO₂/m²·yr</p>
            </div>
          ))}
        </div>
        <p className="text-xxs text-mid-grey mt-3">
          Bridgewater today {r.crrem.current_kgCO2_per_m2.toFixed(1)} kgCO₂/m²·yr — already
          below 2030 target ({r.crrem.target_2030.toFixed(1)}); strands in
          {' '}{r.crrem.year_of_stranding ?? '—'} when the target tightens past the
          building's grid-decarbonised floor (gap to 2050: {r.crrem.gap_to_2050_kgCO2_per_m2.toFixed(1)} kgCO₂/m²·yr).
          This is the gap the IM-M6 Roadmap targets.
        </p>
      </div>
    </div>
  )
}
