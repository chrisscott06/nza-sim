/**
 * RoadmapModule.jsx — Brief 28-IM Gate IM-M6 (Retrofit Roadmap).
 *
 * Full-width single-column layout for the sequenced intervention surface:
 *   Top:       year slider (2026-2050) + adaptive KPI strip for the selected year
 *   Middle:    trajectory chart — building kgCO₂/m² + EUI + CRREM target line,
 *              with vertical step markers at each intervention year. Hover for
 *              per-year tooltip including per-intervention contributions.
 *   Bottom-L:  intervention timeline cards — install-year marginal headline,
 *              sparkline showing per-year marginal 2026-2050 (the compounding
 *              story), edit / delete buttons.
 *   Bottom-R:  intervention picker / editor modal (opens on Add / Edit).
 *
 * The engine (`utils/roadmapEngine.js`) runs leave-one-out marginal
 * attribution per year per intervention. This UI consumes that output.
 *
 * Stuck-point fallbacks per Brief 28-IM §15.2 honoured:
 *   - Drag-and-drop timeline → numeric year input per card (used here).
 *   - Per-intervention modal → inline form (still a modal, but compact).
 *   - Sankey on trajectory → step markers + line chart (used here).
 *   - Dynamic on endpoints → deferred; explicit user button queued for
 *     Brief 28-DynamicParity. Static-only roadmap is the V1 ship.
 */

import { useContext, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ProjectContext } from '../../context/ProjectContext.jsx'
import { WeatherContext } from '../../context/WeatherContext.jsx'
import { useHourlySolar } from '../../hooks/useHourlySolar.js'
import { computeRoadmap } from '../../utils/roadmapEngine.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../../data/systemTemplatesLibrary.js'

const ACCENT = '#9333EA'        // roadmap theme — violet-700 (distinct from results teal)
const ROADMAP_YEARS = 25
const Y_START = 2026
const Y_END = 2050

const TYPE_OPTIONS = [
  { value: 'fabric_airtightness', label: 'Improve airtightness (q50)',         category: 'Fabric' },
  { value: 'fabric_walls',        label: 'Upgrade walls U-value',              category: 'Fabric' },
  { value: 'fabric_roof',         label: 'Upgrade roof U-value',               category: 'Fabric' },
  { value: 'fabric_glazing',      label: 'Upgrade glazing U / g-value',        category: 'Fabric' },
  { value: 'systems_dhw_swap',    label: 'Change DHW fuel mix',                category: 'Systems' },
  { value: 'systems_heating_swap',label: 'Replace heating system',             category: 'Systems' },
  { value: 'ventilation_add_hre', label: 'Add HRE to a ventilation system',    category: 'Systems' },
  { value: 'operation_lpd',       label: 'Reduce lighting power density',      category: 'Operation' },
  { value: 'operation_setpoint',  label: 'Adjust heating / cooling setpoint',  category: 'Operation' },
]

const TYPE_COLOURS = {
  fabric_airtightness: '#A1887F',
  fabric_walls:        '#A1887F',
  fabric_roof:         '#A1887F',
  fabric_glazing:      '#A1887F',
  systems_dhw_swap:    '#F97316',
  systems_heating_swap:'#DC2626',
  ventilation_add_hre: '#06B6D4',
  operation_lpd:       '#F59E0B',
  operation_setpoint:  '#8B5CF6',
}

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

export default function RoadmapModule() {
  const { params, constructions, systems, comfortBand, updateParam } = useContext(ProjectContext)
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

  const interventions = useMemo(
    () => Array.isArray(params?.roadmap?.interventions) ? params.roadmap.interventions : [],
    [params?.roadmap?.interventions]
  )

  // Debounce: roadmap is up to ~225 engine runs; debounce edits 600ms so
  // mid-keystroke changes don't queue endless recomputes.
  const [debouncedInterventions, setDebouncedInterventions] = useState(interventions)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedInterventions(interventions), 600)
    return () => clearTimeout(t)
  }, [interventions])

  const roadmapResult = useMemo(() => {
    if (!params || !weatherData || !hourlySolar || !constructionsLib) return null
    return computeRoadmap({
      baseline: params,
      constructions: constructions ?? {},
      systems:       systems ?? {},
      interventions: debouncedInterventions,
      weatherData, hourlySolar, libraryData,
      comfortBand: comfortBand ?? { lower_c: 20, upper_c: 26 },
    })
  }, [params, constructions, systems, debouncedInterventions, weatherData, hourlySolar, libraryData, comfortBand, constructionsLib])

  const [selectedYear, setSelectedYear] = useState(Y_END)
  const [editing, setEditing] = useState(null)  // { id?: ..., year, type, name, overrides }
  const [hoverYear, setHoverYear] = useState(null)

  const writeInterventions = (next) => updateParam('roadmap', { interventions: next })

  const handleAdd = () => {
    const nextYear = Math.min(Y_END, Math.max(Y_START + 1, selectedYear))
    setEditing({
      id: null,
      year: nextYear,
      sequence_in_year: 1,
      type: 'fabric_airtightness',
      name: 'New intervention',
      overrides: { q50: 3.0 },
    })
  }
  const handleEdit = (intv) => setEditing({ ...intv, _editingExisting: true })
  const handleDelete = (id) => {
    if (window.confirm(`Delete this intervention?`)) {
      writeInterventions(interventions.filter(i => i.id !== id))
    }
  }
  const handleSave = (entry) => {
    const id = entry.id ?? `i_${Date.now()}_${entry.type}`
    const next = entry._editingExisting
      ? interventions.map(i => i.id === entry.id ? { ...entry, id } : i)
      : [...interventions, { ...entry, id }]
    delete next[next.length - 1]._editingExisting
    writeInterventions(next)
    setEditing(null)
  }

  if (!roadmapResult) {
    return (
      <div className="flex flex-col h-[calc(100vh-3rem)] items-center justify-center text-mid-grey text-xxs">
        Loading roadmap engine…
      </div>
    )
  }

  const tCurr  = roadmapResult.trajectory.find(t => t.year === selectedYear)
  const tBase  = roadmapResult.baseline_trajectory.find(t => t.year === selectedYear)
  const yIdx   = selectedYear - Y_START
  const nextI  = interventions.find(i => i.year > selectedYear) ?? null

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] bg-off-white">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b border-light-grey px-6 pt-3 pb-3"
           style={{ borderTopWidth: '3px', borderTopColor: ACCENT, borderTopStyle: 'solid' }}>
        <NavLink to="/project" className="text-xxs text-mid-grey hover:text-navy">← Overview</NavLink>
        <p className="text-caption font-medium mt-0.5" style={{ color: ACCENT }}>Retrofit Roadmap</p>
        <p className="text-xxs text-mid-grey">
          Sequenced intervention surface against the UK grid decarbonisation
          trajectory. Each intervention's contribution is computed by leave-one-out
          marginal attribution per year — the same intervention can show different
          savings in different years because the grid intensity, the prior interventions,
          and the later interventions all change the marginal. Hover any year on the
          trajectory chart for per-intervention contributions.
        </p>
      </div>

      {/* Year slider + KPI strip */}
      <YearSliderAndKpis
        year={selectedYear}
        onYearChange={setSelectedYear}
        tCurr={tCurr}
        tBase={tBase}
        nextI={nextI}
        interventions={interventions}
      />

      {/* Trajectory chart */}
      <div className="flex-shrink-0 px-6 py-2 border-b border-light-grey bg-white">
        <TrajectoryChart
          roadmapResult={roadmapResult}
          interventions={interventions}
          selectedYear={selectedYear}
          onSelectYear={setSelectedYear}
          hoverYear={hoverYear}
          onHoverYear={setHoverYear}
        />
      </div>

      {/* Bottom: intervention timeline cards + add button */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-caption font-semibold text-navy">Interventions ({interventions.length})</p>
          <button
            onClick={handleAdd}
            className="text-xxs px-3 py-1 rounded text-white"
            style={{ backgroundColor: ACCENT }}
          >+ Add intervention</button>
        </div>
        {interventions.length === 0 ? (
          <div className="bg-white border border-dashed border-light-grey rounded-lg text-xxs text-mid-grey text-center py-12">
            No interventions yet. Click <span className="font-medium" style={{ color: ACCENT }}>+ Add intervention</span> to start building a roadmap.
            <br />
            The trajectory chart above shows the baseline (no-retrofit) carbon track.
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {roadmapResult.intervention_summaries.map(s => (
              <InterventionCard
                key={s.id}
                summary={s}
                intervention={interventions.find(i => i.id === s.id)}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Editor modal */}
      {editing && (
        <InterventionEditor
          entry={editing}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   Year slider + KPI strip
   ─────────────────────────────────────────────────────────────────────── */
function YearSliderAndKpis({ year, onYearChange, tCurr, tBase, nextI, interventions }) {
  if (!tCurr) {
    return <div className="flex-shrink-0 bg-white border-b border-light-grey px-6 py-4 text-xxs text-mid-grey">No trajectory data.</div>
  }
  const carbon = tCurr.kgCO2_per_m2_yr
  const target = tCurr.crrem_target_kgCO2_per_m2
  const baseline = tBase?.kgCO2_per_m2_yr ?? carbon
  const saving = baseline - carbon
  const gap = carbon - target
  const yearsToNext = nextI ? Math.max(0, nextI.year - year) : null
  return (
    <div className="flex-shrink-0 bg-white border-b border-light-grey px-6 py-3">
      <div className="flex items-center gap-4 mb-3">
        <span className="text-xxs uppercase tracking-wider text-mid-grey">Year</span>
        <input
          type="range" min={Y_START} max={Y_END} step={1}
          value={year}
          onChange={e => onYearChange(Number(e.target.value))}
          className="flex-1 h-1 accent-violet-700"
        />
        <span className="text-2xl font-bold text-navy tabular-nums w-16 text-center">{year}</span>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <KpiCard
          label="EUI (instant)"
          value={tCurr.eui?.toFixed(1)}
          unit="kWh/m²·yr"
          sub={`Total ${(((tCurr.elec_mwh ?? 0) + (tCurr.gas_mwh ?? 0))).toFixed(1)} MWh`}
          accent="#0F766E"
        />
        <KpiCard
          label="Carbon"
          value={carbon.toFixed(2)}
          unit="kgCO₂/m²·yr"
          sub={`Grid ${tCurr.grid_intensity_gCO2_per_kWh} g/kWh · save vs baseline ${saving.toFixed(2)}`}
          accent="#DC2626"
        />
        <KpiCard
          label="vs CRREM target"
          value={(gap > 0 ? '+' : '') + gap.toFixed(2)}
          unit="kgCO₂/m²·yr"
          sub={`Target ${target.toFixed(2)} kg/m²·yr (Hotel International)`}
          accent={gap > 0 ? '#F59E0B' : '#16A34A'}
        />
        <KpiCard
          label="Next intervention"
          value={yearsToNext == null ? '—' : yearsToNext === 0 ? 'Now' : yearsToNext}
          unit={yearsToNext == null ? '' : yearsToNext === 0 ? '' : 'years'}
          sub={nextI ? `${nextI.year} — ${nextI.name}` : `${interventions.length} planned, all before ${year}`}
          accent={ACCENT}
        />
      </div>
    </div>
  )
}

function KpiCard({ label, value, unit, sub, accent }) {
  return (
    <div className="bg-white border border-light-grey rounded p-2" style={{ borderLeft: `3px solid ${accent}` }}>
      <p className="text-xxs uppercase tracking-wider text-mid-grey">{label}</p>
      <p className="text-xl text-navy font-bold tabular-nums leading-tight mt-0.5">
        {value} <span className="text-xxs text-mid-grey font-normal">{unit}</span>
      </p>
      <p className="text-xxs text-mid-grey/80 leading-tight mt-0.5">{sub}</p>
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   Trajectory chart — kgCO₂ + CRREM target lines + EUI on second axis
   + intervention step markers + hover tooltip
   ─────────────────────────────────────────────────────────────────────── */
function TrajectoryChart({ roadmapResult, interventions, selectedYear, onSelectYear, hoverYear, onHoverYear }) {
  const W = 1300, H = 240, padL = 60, padR = 200, padT = 18, padB = 38
  const cw = W - padL - padR
  const ch = H - padT - padB

  const t  = roadmapResult.trajectory
  const tb = roadmapResult.baseline_trajectory
  const yMin = Y_START, yMax = Y_END

  // Two y-axes: left = kgCO2/m²·yr, right = EUI kWh/m²·yr
  const maxCarbon = Math.max(
    Math.max(...t.map(x => x.kgCO2_per_m2_yr)),
    Math.max(...tb.map(x => x.kgCO2_per_m2_yr)),
    Math.max(...t.map(x => x.crrem_target_kgCO2_per_m2)),
    20,
  )
  const maxEui = Math.max(...t.map(x => x.eui), ...tb.map(x => x.eui), 80)

  const xs    = (y) => padL + ((y - yMin) / (yMax - yMin)) * cw
  const ysC   = (v) => padT + ch - (v / maxCarbon) * ch
  const ysE   = (v) => padT + ch - (v / maxEui) * ch * 0.95

  const pathBase    = tb.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xs(p.year)} ${ysC(p.kgCO2_per_m2_yr)}`).join(' ')
  const pathRoadmap = t .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xs(p.year)} ${ysC(p.kgCO2_per_m2_yr)}`).join(' ')
  const pathCrrem   = t .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xs(p.year)} ${ysC(p.crrem_target_kgCO2_per_m2)}`).join(' ')
  const pathEui     = t .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xs(p.year)} ${ysE(p.eui)}`).join(' ')

  // Stranding year: first year where building > target after a compliant run
  let stranding = null
  let wasCompliant = false
  for (const p of t) {
    const ok = p.kgCO2_per_m2_yr <= p.crrem_target_kgCO2_per_m2
    if (ok) wasCompliant = true
    else if (wasCompliant) { stranding = p.year; break }
  }

  const tooltipYear = hoverYear ?? selectedYear
  const tooltipT = t.find(x => x.year === tooltipYear)
  const tooltipBase = tb.find(x => x.year === tooltipYear)

  return (
    <div>
      <p className="text-xxs text-mid-grey mb-1">
        Building kgCO₂/m²·yr (teal, with roadmap) vs baseline (grey dashed) vs CRREM target (red dashed).
        Vertical violet lines mark intervention years. Click on the chart to scrub the year slider.
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}
           onMouseLeave={() => onHoverYear(null)}
           onMouseMove={(e) => {
             const rect = e.currentTarget.getBoundingClientRect()
             const xPct = (e.clientX - rect.left) / rect.width
             const xSvg = xPct * W
             if (xSvg >= padL && xSvg <= padL + cw) {
               const yr = Math.round(yMin + ((xSvg - padL) / cw) * (yMax - yMin))
               onHoverYear(yr)
             }
           }}
           onClick={(e) => {
             const rect = e.currentTarget.getBoundingClientRect()
             const xPct = (e.clientX - rect.left) / rect.width
             const xSvg = xPct * W
             if (xSvg >= padL && xSvg <= padL + cw) {
               const yr = Math.round(yMin + ((xSvg - padL) / cw) * (yMax - yMin))
               onSelectYear(Math.max(yMin, Math.min(yMax, yr)))
             }
           }}
      >
        {/* Left y grid (carbon) */}
        {[0, 5, 10, 15, 20, 25, 30].filter(v => v <= maxCarbon * 1.1).map(v => (
          <g key={`gc-${v}`}>
            <line x1={padL} x2={padL + cw} y1={ysC(v)} y2={ysC(v)} stroke="#F1F5F9" />
            <text x={padL - 6} y={ysC(v) + 3} fontSize="9" fill="#94A3B8" textAnchor="end">{v}</text>
          </g>
        ))}
        <text x={padL - 38} y={padT - 4} fontSize="10" fill="#0F766E">kgCO₂/m²·yr</text>
        <text x={padL + cw + 4} y={padT - 4} fontSize="10" fill="#9333EA">kWh/m²·yr (EUI)</text>

        {/* X-axis */}
        {[2026, 2030, 2035, 2040, 2045, 2050].map(y => (
          <g key={`xa-${y}`}>
            <line x1={xs(y)} x2={xs(y)} y1={padT + ch} y2={padT + ch + 4} stroke="#94A3B8" />
            <text x={xs(y)} y={padT + ch + 16} fontSize="10" fill="#475569" textAnchor="middle">{y}</text>
          </g>
        ))}

        {/* Intervention step markers (violet vertical lines) */}
        {interventions.map(intv => (
          <g key={`im-${intv.id}`}>
            <line x1={xs(intv.year)} x2={xs(intv.year)} y1={padT} y2={padT + ch} stroke={ACCENT} strokeOpacity={0.25} strokeWidth={1} strokeDasharray="2 2" />
            <text x={xs(intv.year)} y={padT + 8} fontSize="8" fill={ACCENT} textAnchor="middle" fontWeight="600">{intv.id.match(/^i\d+/)?.[0] ?? ''}</text>
          </g>
        ))}

        {/* CRREM target line (red dashed) */}
        <path d={pathCrrem}   fill="none" stroke="#DC2626" strokeWidth="2"  strokeDasharray="6 4" opacity={0.7} />
        {/* Baseline (no retrofit) — grey dashed */}
        <path d={pathBase}    fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeDasharray="3 3" opacity={0.55} />
        {/* Roadmap (teal solid) */}
        <path d={pathRoadmap} fill="none" stroke="#0F766E" strokeWidth="2.5" />
        {/* EUI (violet, second axis) */}
        <path d={pathEui}     fill="none" stroke={ACCENT}  strokeWidth="1.5" opacity={0.6} />

        {/* Selected-year marker */}
        {tooltipT && (
          <g>
            <line x1={xs(tooltipYear)} x2={xs(tooltipYear)} y1={padT} y2={padT + ch} stroke="#0F172A" strokeOpacity={0.4} strokeWidth={1} />
            <circle cx={xs(tooltipYear)} cy={ysC(tooltipT.kgCO2_per_m2_yr)} r="4" fill="#0F766E" />
          </g>
        )}

        {/* Stranding marker (if any) */}
        {stranding && (
          <g>
            <line x1={xs(stranding)} x2={xs(stranding)} y1={padT} y2={padT + ch} stroke="#F59E0B" strokeWidth="1.5" strokeDasharray="2 4" />
            <text x={xs(stranding)} y={padT - 4} fontSize="9" fill="#F59E0B" textAnchor="middle" fontWeight="700">STRANDS {stranding}</text>
          </g>
        )}

        {/* Legend (right of chart) */}
        <g transform={`translate(${padL + cw + 8}, ${padT + 4})`}>
          <line x1={0} x2={18} y1={6} y2={6} stroke="#0F766E" strokeWidth="2.5" />
          <text x={22} y={9} fontSize="9" fill="#0F766E" fontWeight="600">Roadmap kgCO₂/m²·yr</text>
          <line x1={0} x2={18} y1={20} y2={20} stroke="#94A3B8" strokeWidth="1.5" strokeDasharray="3 3" />
          <text x={22} y={23} fontSize="9" fill="#475569">Baseline (no retrofit)</text>
          <line x1={0} x2={18} y1={34} y2={34} stroke="#DC2626" strokeWidth="2" strokeDasharray="6 4" />
          <text x={22} y={37} fontSize="9" fill="#DC2626" fontWeight="600">CRREM 1.5°C (Hotel)</text>
          <line x1={0} x2={18} y1={48} y2={48} stroke={ACCENT} strokeWidth="1.5" />
          <text x={22} y={51} fontSize="9" fill={ACCENT}>EUI kWh/m²·yr</text>
        </g>
      </svg>

      {/* Hover tooltip (textual, below chart) */}
      {tooltipT && (
        <div className="text-xxs text-mid-grey mt-1 flex items-center flex-wrap gap-x-4 gap-y-0.5">
          <span><span className="font-medium text-navy">{tooltipYear}</span> — roadmap <span className="font-medium text-navy">{tooltipT.kgCO2_per_m2_yr.toFixed(2)}</span> kg/m² · baseline <span className="font-medium">{tooltipBase?.kgCO2_per_m2_yr?.toFixed(2)}</span> kg/m² · target <span className="font-medium text-red-600">{tooltipT.crrem_target_kgCO2_per_m2.toFixed(2)}</span></span>
          <span>grid {tooltipT.grid_intensity_gCO2_per_kWh} g/kWh</span>
          <span>elec {tooltipT.elec_mwh.toFixed(0)} · gas {tooltipT.gas_mwh.toFixed(0)} MWh</span>
          <span>EUI {tooltipT.eui.toFixed(1)} kWh/m²·yr</span>
          {interventions.length > 0 && roadmapResult.intervention_summaries.length > 0 && (
            <span className="text-violet-700">
              attribution:{' '}
              {roadmapResult.intervention_summaries
                .filter(s => tooltipT.applied_intervention_ids.includes(s.id))
                .map(s => `${s.id.match(/^i\d+/)?.[0] ?? s.id}: ${roadmapResult.attribution[s.id][tooltipYear - Y_START].toFixed(2)}`)
                .join(' · ')}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   Intervention card — install-year marginal + sparkline + dependency badges
   ─────────────────────────────────────────────────────────────────────── */

// Brief 28-IM-Polish POL-M3 §7.3: shared trend classifier so the sparkline
// stroke and the card's text indicator stay in sync. growing = final > install
// (compounds with grid decarb), decaying = final < install/2 (depletes as the
// grid catches up), flat = anything in between.
function _classifyTrend(values, installIdx) {
  const installVal = values[installIdx] ?? 0
  const finalVal = values[values.length - 1] ?? 0
  if (finalVal > installVal * 1.05) return 'growing'
  if (finalVal < installVal * 0.5)  return 'decaying'
  return 'flat'
}
const TREND_COLOURS = {
  growing: '#16A34A', // green-600
  decaying:'#F59E0B', // amber-500
  flat:    '#94A3B8', // slate-400
}

function InterventionCard({ summary, intervention, onEdit, onDelete }) {
  const color = TYPE_COLOURS[summary.type] ?? '#94A3B8'

  const sparkline = summary.sparkline
  const installIdx = summary.year - Y_START
  const trend = _classifyTrend(sparkline, installIdx)

  return (
    <div className="bg-white border border-light-grey rounded p-3" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="flex items-start justify-between gap-1 mb-1">
        <div className="min-w-0 flex-1">
          <p className="text-xxs uppercase tracking-wider text-mid-grey">{summary.id.match(/^i\d+/)?.[0]} · {summary.year}</p>
          <p className="text-caption font-medium text-navy truncate">{summary.name}</p>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button onClick={() => onEdit(intervention)} className="text-xxs px-1.5 py-0.5 rounded border border-light-grey text-mid-grey hover:border-violet-700 hover:text-violet-700" title="Edit">✏️</button>
          <button onClick={() => onDelete(summary.id)} className="text-xxs px-1.5 py-0.5 rounded border border-light-grey text-mid-grey hover:border-red-600 hover:text-red-600" title="Delete">✕</button>
        </div>
      </div>

      {/* Headline marginal */}
      <p className="text-2xl font-bold text-navy tabular-nums leading-tight mt-1">
        −{summary.install_year_marginal_kgCO2.toFixed(2)}
        <span className="text-xxs text-mid-grey font-normal ml-1">kgCO₂/m²·yr install-year</span>
      </p>

      {/* Sparkline — per-year marginal 2026-2050. Brief POL-M3 §7.3:
          120×40 with year markers, install-year dot, hover tooltip, trend
          colour. Trend computed once and shared with the indicator below. */}
      <Sparkline values={sparkline} trend={trend} installYear={summary.year} />

      {/* Trend + secondary stats */}
      <div className="flex items-center gap-2 mt-1 text-xxs text-mid-grey">
        <span className={
          trend === 'growing' ? 'text-green-700 font-medium' :
          trend === 'decaying' ? 'text-amber-700 font-medium' :
          'text-mid-grey'
        }>
          {trend === 'growing' ? '↗ grows over time' : trend === 'decaying' ? '↘ decays over time' : '→ steady'}
        </span>
        <span>peak {summary.peak_marginal_kgCO2.toFixed(2)} @ {summary.peak_marginal_year}</span>
      </div>
    </div>
  )
}

// Brief 28-IM-Polish POL-M3 §7.3 — Sparkline polish.
//
// Geometry: viewBox 200 × 50 (was 200 × 32). Chart area 0-32; year-marker
// strip 36-44; tooltip floats in the bottom-right corner of the SVG so it
// doesn't add to the card height. CSS height bumped 32 → 50 to match.
//
// Markers: ticks at 2026 / 2030 / 2040 / 2050 with year labels; an install-
// year dot painted on the sparkline (was a dashed vertical line only).
//
// Trend colour: the stroke now derives from `trend` (passed in by the card,
// see `_classifyTrend`) rather than the per-intervention `TYPE_COLOURS`,
// per the brief's "growing = green / decaying = amber / stable = grey".
//
// Hover: useState for hoverIdx; on pointer move we map clientX → year index
// and float a small "YYYY · −X.XX" tooltip. Pointer-leave clears it.
function Sparkline({ values, trend, installYear }) {
  const W = 200
  const CHART_H = 32
  const STRIP_TOP = 36
  const STRIP_BOT = 44
  const H = 50  // viewBox + CSS height (room for year markers below chart)
  const N = values.length
  const maxV = Math.max(...values, 0.001)
  const x = (i) => (i / (N - 1)) * W
  const y = (v) => CHART_H - (v / maxV) * CHART_H * 0.9 - 2
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ')
  const installIdx = installYear - Y_START

  const stroke = TREND_COLOURS[trend] ?? TREND_COLOURS.flat
  const yearMarkers = [Y_START, 2030, 2040, Y_END]

  const [hoverIdx, setHoverIdx] = useState(null)
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const idx = Math.round((px / rect.width) * (N - 1))
    setHoverIdx(Math.max(0, Math.min(N - 1, idx)))
  }
  const onLeave = () => setHoverIdx(null)

  const tipYear = hoverIdx == null ? null : Y_START + hoverIdx
  const tipVal  = hoverIdx == null ? null : values[hoverIdx] ?? 0

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height: H, marginTop: 4 }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      {/* Install-year vertical guide (kept faint to emphasise the dot) */}
      <line x1={x(installIdx)} x2={x(installIdx)} y1={0} y2={CHART_H} stroke="#9333EA" strokeOpacity={0.25} strokeDasharray="1 2" />
      {/* Trend-coloured trace */}
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.6" />
      {/* Install-year dot — sits on the sparkline at the install marginal */}
      <circle cx={x(installIdx)} cy={y(values[installIdx] ?? 0)} r="2.4" fill="#9333EA" stroke="white" strokeWidth="0.8" />

      {/* Year-marker strip */}
      {yearMarkers.map(yr => {
        const ix = yr - Y_START
        const xpos = x(ix)
        const anchor = yr === Y_START ? 'start' : yr === Y_END ? 'end' : 'middle'
        return (
          <g key={yr}>
            <line x1={xpos} x2={xpos} y1={STRIP_TOP} y2={STRIP_TOP + 2} stroke="#CBD5E1" strokeWidth="0.6" />
            <text x={xpos} y={STRIP_BOT} fontSize="7" fill="#94A3B8" textAnchor={anchor}>{yr}</text>
          </g>
        )
      })}

      {/* Hover crosshair + tooltip */}
      {hoverIdx != null && (
        <g>
          <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={0} y2={CHART_H} stroke="#0F172A" strokeOpacity="0.3" strokeWidth="0.6" />
          <circle cx={x(hoverIdx)} cy={y(tipVal)} r="1.8" fill="#0F172A" />
          {/* Tooltip — anchored to right side of chart strip; never overflows */}
          <g transform={`translate(${W - 2}, ${STRIP_BOT - 0.5})`}>
            <text fontSize="7" fill="#0F172A" textAnchor="end">
              {tipYear} · −{tipVal.toFixed(2)} kg
            </text>
          </g>
        </g>
      )}
    </svg>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   Intervention editor modal
   ─────────────────────────────────────────────────────────────────────── */
function InterventionEditor({ entry, onCancel, onSave }) {
  const [draft, setDraft] = useState(entry)
  const set = (patch) => setDraft(d => ({ ...d, ...patch }))
  const setOv = (patch) => setDraft(d => ({ ...d, overrides: { ...(d.overrides ?? {}), ...patch } }))

  const type = draft.type
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-caption font-semibold text-navy">
            {draft._editingExisting ? 'Edit intervention' : 'Add intervention'}
          </p>
          <button onClick={onCancel} className="text-xxs text-mid-grey hover:text-navy">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Year">
            <input type="number" min={Y_START} max={Y_END} value={draft.year} onChange={e => set({ year: Number(e.target.value) })}
              className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white tabular-nums" />
          </Field>
          <Field label="Sequence (same year)">
            <input type="number" min={1} value={draft.sequence_in_year ?? 1} onChange={e => set({ sequence_in_year: Number(e.target.value) })}
              className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white tabular-nums" />
          </Field>
        </div>

        <Field label="Type">
          <select value={type} onChange={e => set({ type: e.target.value, overrides: defaultOverridesForType(e.target.value) })}
            className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white cursor-pointer">
            {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.category} — {o.label}</option>)}
          </select>
        </Field>

        <Field label="Name (display)">
          <input type="text" value={draft.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Replace gas boiler with ASHP"
            className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white" />
        </Field>

        {/* Type-specific override fields */}
        {type === 'fabric_airtightness' && (
          <Field label="New q50 (m³/(h·m²) at 50 Pa)">
            <input type="number" step={0.1} min={0.3} max={20} value={draft.overrides?.q50 ?? 3} onChange={e => setOv({ q50: Number(e.target.value) })}
              className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white tabular-nums" />
          </Field>
        )}
        {(type === 'fabric_walls' || type === 'fabric_roof') && (
          <Field label="New U-value (W/m²K)">
            <input type="number" step={0.01} min={0.08} max={2} value={draft.overrides?.u_value_override ?? 0.2}
              onChange={e => setOv({ u_value_override: Number(e.target.value) })}
              className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white tabular-nums" />
          </Field>
        )}
        {type === 'fabric_glazing' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="New U-value (W/m²K)">
              <input type="number" step={0.05} min={0.5} max={5.5} value={draft.overrides?.u_value_override ?? 1.4}
                onChange={e => setOv({ u_value_override: Number(e.target.value) })}
                className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white tabular-nums" />
            </Field>
            <Field label="New g-value (0-1)">
              <input type="number" step={0.05} min={0.1} max={0.9} value={draft.overrides?.g_value_override ?? 0.5}
                onChange={e => setOv({ g_value_override: Number(e.target.value) })}
                className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white tabular-nums" />
            </Field>
          </div>
        )}
        {type === 'systems_dhw_swap' && (
          <Field label="New DHW fuel mix (sum 1.0)">
            <div className="space-y-1">
              {['gas', 'electric_resistance', 'heat_pump'].map(k => (
                <div key={k} className="flex items-center gap-2 text-xxs">
                  <span className="w-32 text-mid-grey capitalize">{k.replace('_', ' ')}</span>
                  <input type="range" min={0} max={1} step={0.05}
                    value={draft.overrides?.fuel_mix?.[k] ?? 0}
                    onChange={e => setOv({ fuel_mix: { ...(draft.overrides?.fuel_mix ?? {}), [k]: Number(e.target.value) } })}
                    className="flex-1 accent-violet-700" />
                  <span className="w-10 text-right tabular-nums">{Math.round((draft.overrides?.fuel_mix?.[k] ?? 0) * 100)}%</span>
                </div>
              ))}
              <p className="text-xxs text-mid-grey">Sum: {Math.round(['gas','electric_resistance','heat_pump'].reduce((s,k)=>s+(draft.overrides?.fuel_mix?.[k] ?? 0), 0) * 100)}% (engine normalises)</p>
            </div>
          </Field>
        )}
        {type === 'systems_heating_swap' && (
          <Field label="New heating system library_id">
            <input type="text" value={draft.overrides?.library_id ?? 'ashp_dhw_preheat'}
              onChange={e => setOv({ library_id: e.target.value })}
              className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white" />
          </Field>
        )}
        {type === 'ventilation_add_hre' && (
          <div className="grid grid-cols-3 gap-2">
            <Field label="Vent index">
              <input type="number" min={0} value={draft.overrides?.vent_index ?? 0}
                onChange={e => setOv({ vent_index: Number(e.target.value) })}
                className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white tabular-nums" />
            </Field>
            <Field label="HRE η (0-1)">
              <input type="number" step={0.05} min={0.5} max={0.95} value={draft.overrides?.hre ?? 0.75}
                onChange={e => setOv({ hre: Number(e.target.value) })}
                className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white tabular-nums" />
            </Field>
            <Field label="New SFP (W/L/s)">
              <input type="number" step={0.05} min={0.2} max={3} value={draft.overrides?.sfp_w_per_l_s ?? 1.4}
                onChange={e => setOv({ sfp_w_per_l_s: Number(e.target.value) })}
                className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white tabular-nums" />
            </Field>
          </div>
        )}
        {type === 'operation_lpd' && (
          <Field label="Reduction (%) — negative = saving">
            <input type="number" step={5} min={-95} max={0} value={draft.overrides?.reduction_pct ?? -30}
              onChange={e => setOv({ reduction_pct: Number(e.target.value) })}
              className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white tabular-nums" />
          </Field>
        )}
        {type === 'operation_setpoint' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Heating setpoint (°C)">
              <input type="number" step={0.5} min={14} max={26} value={draft.overrides?.heating_c ?? 21}
                onChange={e => setOv({ heating_c: Number(e.target.value) })}
                className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white tabular-nums" />
            </Field>
            <Field label="Cooling setpoint (°C)">
              <input type="number" step={0.5} min={18} max={32} value={draft.overrides?.cooling_c ?? 25}
                onChange={e => setOv({ cooling_c: Number(e.target.value) })}
                className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white tabular-nums" />
            </Field>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-light-grey">
          <button onClick={onCancel} className="text-xxs px-3 py-1 rounded border border-light-grey text-mid-grey">Cancel</button>
          <button onClick={() => onSave(draft)} className="text-xxs px-3 py-1 rounded text-white" style={{ backgroundColor: ACCENT }}>
            {draft._editingExisting ? 'Save changes' : 'Add to roadmap'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-xxs uppercase tracking-wider text-mid-grey mb-0.5">{label}</p>
      {children}
    </div>
  )
}

function defaultOverridesForType(type) {
  switch (type) {
    case 'fabric_airtightness': return { q50: 2.0 }
    case 'fabric_walls':        return { u_value_override: 0.20 }
    case 'fabric_roof':         return { u_value_override: 0.13 }
    case 'fabric_glazing':      return { u_value_override: 1.0, g_value_override: 0.4 }
    case 'systems_dhw_swap':    return { fuel_mix: { gas: 0, electric_resistance: 0, heat_pump: 1 } }
    case 'systems_heating_swap':return { library_id: 'ashp_dhw_preheat' }
    case 'ventilation_add_hre': return { vent_index: 0, hre: 0.75, sfp_w_per_l_s: 1.4 }
    case 'operation_lpd':       return { reduction_pct: -30 }
    case 'operation_setpoint':  return { heating_c: 20, cooling_c: 26 }
    default: return {}
  }
}
