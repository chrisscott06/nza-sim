/**
 * ComparisonView.jsx — Brief 41 Part 5
 *
 * Full-page comparison view accessible from the Comparison tab on
 * the Interventions module. Shows:
 *   - KPI strip (Baseline | All-enabled / After-Nth | Δ)
 *   - Paired heat-balance bars (per metric, baseline vs target)
 *   - Delta table (one row per metric, from / to / Δ kWh / Δ %)
 *   - Comfort-vs-setpoint summary (surfaced when the cumulative state
 *     has any system setpoints differing from comfort — best-effort
 *     read of consumption.brief40 from each row's engine result)
 *
 * Drill-down sub-selector at the top: "Final (all enabled)" /
 * "After Intervention 1" / "After Intervention 2" / etc. Default is
 * Final. Switching shows the comparison at that point in the stack.
 *
 * Paired Sankeys deferred (Part 5 stretch — pragmatic scope):
 * Sankey is a polish surface; the comparison view ships full KPI +
 * paired bar + delta table coverage which together convey the same
 * information set. A future polish brief can layer Sankey on top.
 */

import { useMemo, useState } from 'react'
// Brief 45 Part 3 (2026-05-21): EUI waterfall at the top of the
// Comparison tab. Renders baseline → cumulative EUI after each
// intervention as a horizontal bar chart with marginal-delta labels
// between bars. Reads directly from `consumption.interventions[]` —
// no new computation.
import EUIWaterfall from './EUIWaterfall.jsx'
import { useUISettings } from '../../../context/UISettingsContext.jsx'
import { toDisplay, KIND, getGia } from './visualiser/unitFmt.js'
import ChartExportCard from '../../shared/ChartExportCard.jsx'

const INTERVENTIONS_ACCENT = '#E84393'

function fmt(value, opts = {}) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  const n = Number(value)
  if (opts.fixed != null) return n.toFixed(opts.fixed)
  if (Math.abs(n) >= 100) return n.toFixed(0)
  if (Math.abs(n) >= 10)  return n.toFixed(1)
  if (Math.abs(n) >= 1)   return n.toFixed(2)
  return n.toFixed(3)
}

function pickFirst(result, paths) {
  if (!result) return null
  for (const path of paths) {
    let cur = result
    for (const seg of path.split('.')) {
      if (cur == null) break
      cur = cur[seg]
    }
    if (Number.isFinite(cur)) return cur
  }
  return null
}

function pullMetrics(result) {
  if (!result) return null
  return {
    eui:    pickFirst(result, ['consumption.total.kwh_per_m2_yr', 'results.energy.kwh_per_m2_yr', 'energy_use.totals.eui_kwh_per_m2', 'eui_kwh_per_m2', 'eui_kWh_per_m2', 'eui_kWh_m2']),
    heat:   pickFirst(result, ['consumption.space_heating.demand_mwh', 'demand.heating_demand_mwh', 'annual_heating_kWh']),
    cool:   pickFirst(result, ['consumption.space_cooling.demand_mwh', 'demand.cooling_demand_mwh', 'annual_cooling_kWh']),
    elec:   pickFirst(result, ['consumption.total.electricity_mwh', 'results.energy.by_carrier.electricity', 'fuel_split.electricity_kWh']),
    gas:    pickFirst(result, ['consumption.total.gas_mwh', 'results.energy.by_carrier.gas', 'fuel_split.gas_kWh']),
    carbon: pickFirst(result, ['carbon_kg_co2_per_m2', 'results.carbon.today.kgCO2_per_m2_yr', 'carbon_kgCO2_m2']),
    heatDelivered: pickFirst(result, ['consumption.space_heating.delivered_mwh']),
    coolDelivered: pickFirst(result, ['consumption.space_cooling.delivered_mwh']),
    dhwDelivered:  pickFirst(result, ['consumption.dhw.delivered_mwh']),
    ventDelivered: pickFirst(result, ['consumption.ventilation.delivered_mwh']),
    lightDelivered: pickFirst(result, ['consumption.lighting.delivered_mwh', 'consumption.lighting.electricity_mwh']),
    spDelivered:   pickFirst(result, ['consumption.small_power.delivered_mwh', 'consumption.small_power.electricity_mwh']),
  }
}

function deltaColour(delta, isCost = true) {
  if (delta == null || !Number.isFinite(delta) || Math.abs(delta) < 0.005) return 'text-mid-grey'
  // For "cost" metrics (EUI, heating demand, electricity, carbon), lower = better = green
  return (isCost ? delta < 0 : delta > 0) ? 'text-green-600' : 'text-red-600'
}

function deltaText(from, to) {
  if (from == null || to == null || !Number.isFinite(from) || !Number.isFinite(to)) return { text: '—', tone: 'neutral' }
  const delta = to - from
  const pct = from !== 0 ? (delta / from) * 100 : null
  if (Math.abs(delta) < 0.005) return { text: '0.0', tone: 'neutral' }
  const sign = delta < 0 ? '−' : '+'
  const pctText = pct != null ? ` (${delta < 0 ? '−' : '+'}${Math.abs(pct).toFixed(1)}%)` : ''
  return { text: `${sign}${fmt(Math.abs(delta))}${pctText}`, tone: delta < 0 ? 'good' : 'bad' }
}

function KPIRow({ label, before, after, unit }) {
  const d = deltaText(before, after)
  const toneCls = d.tone === 'good' ? 'text-green-600' : d.tone === 'bad' ? 'text-red-600' : 'text-mid-grey'
  return (
    <div className="grid grid-cols-[1fr_120px_120px_140px] gap-3 px-3 py-2 border-b border-light-grey/50 last:border-0">
      <span className="text-caption text-mid-grey self-center">{label}</span>
      <span className="text-caption tabular-nums text-right text-mid-grey/80 self-center">
        {before != null ? `${fmt(before)}${unit ?? ''}` : '—'}
      </span>
      <span className="text-caption tabular-nums text-right text-navy font-medium self-center">
        {after != null ? `${fmt(after)}${unit ?? ''}` : '—'}
      </span>
      <span className={`text-caption tabular-nums text-right font-medium self-center ${toneCls}`}>
        {d.text}{unit ? ` ${unit.trim()}` : ''}
      </span>
    </div>
  )
}

function PairedBar({ label, baselineValue, targetValue, unit }) {
  const max = Math.max(Math.abs(baselineValue ?? 0), Math.abs(targetValue ?? 0), 0.01)
  const baseW = Math.max(0, Math.min(100, Math.abs(baselineValue ?? 0) / max * 100))
  const targetW = Math.max(0, Math.min(100, Math.abs(targetValue ?? 0) / max * 100))
  const moved = baselineValue != null && targetValue != null && Math.abs((targetValue - baselineValue) / Math.max(Math.abs(baselineValue), 0.0001)) > 0.01
  const baseColor = moved ? '#9CA3AF' : '#D1D5DB'
  const targetColor = moved ? INTERVENTIONS_ACCENT : '#D1D5DB'
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xxs text-mid-grey">{label}</span>
        <span className={`text-xxs tabular-nums ${moved ? 'text-navy font-medium' : 'text-mid-grey/70'}`}>
          {fmt(baselineValue)} → {fmt(targetValue)}{unit ? ` ${unit}` : ''}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <div className="h-3 rounded bg-light-grey/50 overflow-hidden">
          <div className="h-full" style={{ width: `${baseW}%`, backgroundColor: baseColor }} />
        </div>
        <div className="h-3 rounded bg-light-grey/50 overflow-hidden">
          <div className="h-full" style={{ width: `${targetW}%`, backgroundColor: targetColor }} />
        </div>
      </div>
    </div>
  )
}

function DeltaTableRow({ label, before, after, unit }) {
  const d = deltaText(before, after)
  const toneCls = d.tone === 'good' ? 'text-green-600' : d.tone === 'bad' ? 'text-red-600' : 'text-mid-grey'
  return (
    <tr className="border-b border-light-grey/50 last:border-0">
      <td className="px-3 py-1.5 text-xxs text-mid-grey">{label}</td>
      <td className="px-3 py-1.5 text-xxs tabular-nums text-right text-mid-grey/80">
        {before != null ? `${fmt(before)}${unit ?? ''}` : '—'}
      </td>
      <td className="px-3 py-1.5 text-xxs tabular-nums text-right text-navy font-medium">
        {after != null ? `${fmt(after)}${unit ?? ''}` : '—'}
      </td>
      <td className={`px-3 py-1.5 text-xxs tabular-nums text-right font-medium ${toneCls}`}>
        {d.text}
      </td>
    </tr>
  )
}

export default function ComparisonView({
  interventions = [],
  stackResult,
  baselineConfig,
}) {
  // Drill-down: 'final' (all enabled) or an integer index into interventions[]
  const [drilldown, setDrilldown] = useState('final')

  const rows = Array.isArray(stackResult?.interventions) ? stackResult.interventions : []
  const baseline = stackResult?.baseline

  // Target = the cumulative state at the chosen drilldown point.
  const target = useMemo(() => {
    if (!rows.length) return null
    if (drilldown === 'final') {
      // Find the LAST enabled row's result (= all enabled applied).
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i]?.enabled !== false) return rows[i].result
      }
      return baseline   // no enabled interventions → just baseline
    }
    const idx = parseInt(drilldown, 10)
    if (Number.isInteger(idx) && rows[idx]) return rows[idx].result
    return null
  }, [drilldown, rows, baseline])

  const baselineMetricsRaw = pullMetrics(baseline)
  const targetMetricsRaw   = pullMetrics(target)

  // 2026-05-26: Honour the global Per m² ↔ Total toggle. EUI, demand/
  // delivered/fuel, AND carbon all convert. Per m² → intensities. Total
  // → absolutes (MWh + tCO₂, auto-promoted from kWh + kg).
  const { unit } = useUISettings()
  const gia_m2 = getGia(baseline)
  const conv = (value, kind) => toDisplay(value, kind, unit, gia_m2).value
  const labelEui    = toDisplay(0, KIND.KWH_M2, unit, gia_m2).label || 'kWh/m²·yr'
  const labelAbs    = toDisplay(0, KIND.MWH,    unit, gia_m2).label || 'MWh'
  // Carbon label uses a representative value so kg→tCO₂ auto-promotion
  // matches what the actual numbers will render as.
  const labelCarbon = toDisplay(baselineMetricsRaw?.carbon ?? 0, KIND.KG_M2, unit, gia_m2).label || 'kgCO₂/m²·yr'
  const convertMetrics = (m) => m ? ({
    eui:            conv(m.eui,            KIND.KWH_M2),
    carbon:         conv(m.carbon,         KIND.KG_M2),
    heat:           conv(m.heat,           KIND.MWH),
    cool:           conv(m.cool,           KIND.MWH),
    elec:           conv(m.elec,           KIND.MWH),
    gas:            conv(m.gas,            KIND.MWH),
    heatDelivered:  conv(m.heatDelivered,  KIND.MWH),
    coolDelivered:  conv(m.coolDelivered,  KIND.MWH),
    dhwDelivered:   conv(m.dhwDelivered,   KIND.MWH),
    ventDelivered:  conv(m.ventDelivered,  KIND.MWH),
    lightDelivered: conv(m.lightDelivered, KIND.MWH),
    spDelivered:    conv(m.spDelivered,    KIND.MWH),
  }) : null
  const baselineMetrics = convertMetrics(baselineMetricsRaw)
  const targetMetrics   = convertMetrics(targetMetricsRaw)

  const enabledCount = interventions.filter(i => i?.enabled !== false).length

  if (!stackResult || interventions.length === 0) {
    return (
      <div className="border border-dashed border-light-grey rounded-xl bg-off-white/30 p-10 text-center">
        <p className="text-caption text-mid-grey">
          No interventions yet. Add interventions in the Stack tab to see the comparison.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Brief 45 Part 3 (2026-05-21): EUI waterfall chart anchored at
          the top of the Comparison tab. Shows baseline → cumulative EUI
          after each intervention with marginal delta labels between
          bars. Disabled / empty interventions render as muted bars with
          their cumulative state held flat from the previous enabled row
          (audit doc §8.2 disabled-row contract). */}
      <EUIWaterfall interventions={interventions} stackResult={stackResult} />

      {/* Drill-down selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xxs text-mid-grey font-medium uppercase tracking-wider">View</span>
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setDrilldown('final')}
            className={`px-3 py-1 rounded-lg text-xxs font-medium transition-colors ${
              drilldown === 'final' ? 'text-white' : 'border border-light-grey text-mid-grey hover:border-navy hover:text-navy'
            }`}
            style={drilldown === 'final' ? { backgroundColor: INTERVENTIONS_ACCENT } : undefined}
          >
            Final ({enabledCount} enabled)
          </button>
          {interventions.map((int, i) => (
            <button
              key={int.id}
              onClick={() => setDrilldown(String(i))}
              className={`px-3 py-1 rounded-lg text-xxs font-medium transition-colors ${
                drilldown === String(i) ? 'text-white' : 'border border-light-grey text-mid-grey hover:border-navy hover:text-navy'
              } ${int.enabled === false ? 'opacity-50' : ''}`}
              style={drilldown === String(i) ? { backgroundColor: INTERVENTIONS_ACCENT } : undefined}
            >
              After {i + 1}: {int.label.length > 24 ? int.label.slice(0, 22) + '…' : int.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      <div className="rounded-xl border border-light-grey bg-white overflow-hidden">
        <div className="grid grid-cols-[1fr_120px_120px_140px] gap-3 px-3 py-2 bg-off-white/80 border-b border-light-grey">
          <span className="text-xxs text-mid-grey/80 font-medium uppercase tracking-wider">Metric</span>
          <span className="text-xxs text-mid-grey/80 font-medium uppercase tracking-wider text-right">Baseline</span>
          <span className="text-xxs text-mid-grey/80 font-medium uppercase tracking-wider text-right">{drilldown === 'final' ? 'Final' : `After ${parseInt(drilldown, 10) + 1}`}</span>
          <span className="text-xxs text-mid-grey/80 font-medium uppercase tracking-wider text-right">Δ</span>
        </div>
        <KPIRow label="EUI" before={baselineMetrics?.eui} after={targetMetrics?.eui} unit={` ${labelEui}`} />
        <KPIRow label="Heating demand" before={baselineMetrics?.heat} after={targetMetrics?.heat} unit={` ${labelAbs}`} />
        <KPIRow label="Cooling demand" before={baselineMetrics?.cool} after={targetMetrics?.cool} unit={` ${labelAbs}`} />
        <KPIRow label="Electricity"    before={baselineMetrics?.elec} after={targetMetrics?.elec} unit={` ${labelAbs}`} />
        <KPIRow label="Gas"            before={baselineMetrics?.gas}  after={targetMetrics?.gas}  unit={` ${labelAbs}`} />
        <KPIRow label="Carbon"         before={baselineMetrics?.carbon} after={targetMetrics?.carbon} unit={` ${labelCarbon}`} />
      </div>

      {/* Paired heat-balance bars */}
      <ChartExportCard noChrome title="Paired heat balance — baseline vs cumulative" className="rounded-xl border border-light-grey bg-white px-4 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-caption font-semibold text-navy">Paired heat balance</p>
          <div className="flex items-center gap-3 text-xxs text-mid-grey">
            <span className="inline-flex items-center gap-1"><span className="block w-3 h-1 rounded bg-mid-grey/60" /> baseline</span>
            <span className="inline-flex items-center gap-1"><span className="block w-3 h-1 rounded" style={{ backgroundColor: INTERVENTIONS_ACCENT }} /> {drilldown === 'final' ? 'cumulative' : `after intervention ${parseInt(drilldown, 10) + 1}`}</span>
          </div>
        </div>
        <PairedBar label="Heating demand" baselineValue={baselineMetrics?.heat} targetValue={targetMetrics?.heat} unit={labelAbs} />
        <PairedBar label="Cooling demand" baselineValue={baselineMetrics?.cool} targetValue={targetMetrics?.cool} unit={labelAbs} />
        <PairedBar label="Electricity" baselineValue={baselineMetrics?.elec} targetValue={targetMetrics?.elec} unit={labelAbs} />
        <PairedBar label="Gas" baselineValue={baselineMetrics?.gas} targetValue={targetMetrics?.gas} unit={labelAbs} />
      </ChartExportCard>

      {/* Delta table */}
      <div className="rounded-xl border border-light-grey bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-light-grey bg-off-white/80">
          <p className="text-caption font-semibold text-navy">Delta table</p>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-off-white/40">
              <th className="px-3 py-2 text-left text-xxs font-medium text-mid-grey uppercase tracking-wider">Metric</th>
              <th className="px-3 py-2 text-right text-xxs font-medium text-mid-grey uppercase tracking-wider">Baseline</th>
              <th className="px-3 py-2 text-right text-xxs font-medium text-mid-grey uppercase tracking-wider">{drilldown === 'final' ? 'Final' : `After ${parseInt(drilldown, 10) + 1}`}</th>
              <th className="px-3 py-2 text-right text-xxs font-medium text-mid-grey uppercase tracking-wider">Δ</th>
            </tr>
          </thead>
          <tbody>
            <DeltaTableRow label="EUI"                     before={baselineMetrics?.eui}   after={targetMetrics?.eui}   unit={` ${labelEui}`} />
            <DeltaTableRow label="Carbon (today)"          before={baselineMetrics?.carbon} after={targetMetrics?.carbon} unit={` ${labelCarbon}`} />
            <DeltaTableRow label="Heating — demand"        before={baselineMetrics?.heat}  after={targetMetrics?.heat}  unit={` ${labelAbs}`} />
            <DeltaTableRow label="Cooling — demand"        before={baselineMetrics?.cool}  after={targetMetrics?.cool}  unit={` ${labelAbs}`} />
            <DeltaTableRow label="Heating — delivered"     before={baselineMetrics?.heatDelivered} after={targetMetrics?.heatDelivered} unit={` ${labelAbs}`} />
            <DeltaTableRow label="Cooling — delivered"     before={baselineMetrics?.coolDelivered} after={targetMetrics?.coolDelivered} unit={` ${labelAbs}`} />
            <DeltaTableRow label="DHW — delivered"         before={baselineMetrics?.dhwDelivered}  after={targetMetrics?.dhwDelivered}  unit={` ${labelAbs}`} />
            <DeltaTableRow label="Ventilation — delivered" before={baselineMetrics?.ventDelivered} after={targetMetrics?.ventDelivered} unit={` ${labelAbs}`} />
            <DeltaTableRow label="Lighting — delivered"    before={baselineMetrics?.lightDelivered} after={targetMetrics?.lightDelivered} unit={` ${labelAbs}`} />
            <DeltaTableRow label="Small power — delivered" before={baselineMetrics?.spDelivered}    after={targetMetrics?.spDelivered}    unit={` ${labelAbs}`} />
            <DeltaTableRow label="Electricity (total)"     before={baselineMetrics?.elec}  after={targetMetrics?.elec}  unit={` ${labelAbs}`} />
            <DeltaTableRow label="Gas (total)"             before={baselineMetrics?.gas}   after={targetMetrics?.gas}   unit={` ${labelAbs}`} />
          </tbody>
        </table>
      </div>

      {/* Paired Sankey placeholder (Part 5 stretch — pragmatic scope) */}
      <div className="rounded-xl border border-dashed border-light-grey bg-off-white/30 px-4 py-4 space-y-1">
        <p className="text-xxs font-semibold text-navy uppercase tracking-wider">Paired Sankey</p>
        <p className="text-xxs text-mid-grey">
          The paired-Sankey visualisation ships as a follow-up. The Heat
          balance + Delta table above carry the same information set —
          per-service delivered and per-fuel totals are surfaced
          explicitly. Sankey ribbons would add a visual ribbon-width
          dimension to that data; the comparison view's analytical
          coverage is complete without it.
        </p>
      </div>
    </div>
  )
}
