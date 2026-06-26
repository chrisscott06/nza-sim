/**
 * CrremStrandingDiagram.jsx — Brief 89 (Brief C) Part 5/6: the canonical CRREM
 * stranding diagram for the Strategy view, matching the client-report style.
 *
 * Two parallel charts sharing the x-axis (2020–2050):
 *   • Top    — GHG intensity (kgCO₂e/m²·yr)
 *   • Bottom — Energy intensity (kWh/m²·yr)
 * Each carries: CRREM decarbonisation target (dark navy), asset-performance curve
 * (blue), red-circle misalignment-year marker, current-year diamond, and the
 * translucent excess-emissions area post-misalignment. Part 6 adds the
 * baseline-vs-strategy overlay (showBaseline).
 *
 * v1 assumptions (design note): strategy reaches its final state in year 1;
 * energy intensity is then flat (kWh doesn't decarbonise); GHG intensity declines
 * as the electricity portion follows the UK grid trajectory. All carbon factors +
 * CRREM targets via the canonical helpers (Bible Rule 11). No engine changes.
 */
import { useMemo } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ReferenceDot, Legend, ResponsiveContainer,
} from 'recharts'
import { carbonIntensityForYear } from '../../../../utils/lifetimeCarbon.js'
import { readCrremTarget, hasCrremPathway } from '../../../../utils/carbonReads.js'

const TARGET = '#2B2A4C'  // dark navy
const ASSET  = '#2563EB'  // blue
const BASE   = '#94A3B8'  // grey (baseline overlay)
const RED    = '#DC2626'
const START = 2020, END = 2050
const r1 = n => (n == null || !Number.isFinite(n)) ? null : Math.round(n * 10) / 10

function firstCrossYear(data, assetKey, targetKey) {
  for (const d of data) {
    if (d[assetKey] != null && d[targetKey] != null && d[assetKey] > d[targetKey]) return d.year
  }
  return null
}
const valAt = (data, year, key) => data.find(d => d.year === year)?.[key] ?? null

function HeadlineNum({ label, value, sub, accent }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-[96px]">
      <div className="text-xxs uppercase tracking-wider text-mid-grey/70 font-semibold">{label}</div>
      <div className="text-base font-semibold tabular-nums" style={{ color: accent ?? '#1F2937' }}>{value}</div>
      {sub ? <div className="text-xxs text-mid-grey/60 tabular-nums">{sub}</div> : null}
    </div>
  )
}

function StrandingPanel({ data, title, unit, targetKey, assetKey, baseKey, excessKey, baseExcessKey, showBaseline, currentYear }) {
  const misalign = firstCrossYear(data, assetKey, targetKey)
  const baseMisalign = showBaseline ? firstCrossYear(data, baseKey, targetKey) : null
  const assetNow = valAt(data, currentYear, assetKey)

  return (
    <div className="rounded-lg border border-light-grey/70 bg-white px-2 pt-2 pb-1">
      <div className="flex items-baseline justify-between px-1">
        <div className="text-xxs uppercase tracking-wider text-mid-grey/70 font-semibold">{title}</div>
        <div className="text-xxs text-mid-grey/50">
          {misalign ? <>misalignment <span className="font-semibold" style={{ color: RED }}>{misalign}</span></> : <span className="text-green-600 font-semibold">aligned to 2050</span>}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={190}>
        <ComposedChart data={data} margin={{ top: 8, right: 10, left: -4, bottom: 0 }}>
          <XAxis dataKey="year" tick={{ fontSize: 9, fill: '#95A5A6' }} ticks={[2020, 2025, 2030, 2035, 2040, 2045, 2050]} />
          <YAxis tick={{ fontSize: 9, fill: '#95A5A6' }} width={42} domain={[0, 'auto']} />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #E5E7EB' }}
            formatter={(v, name) => [v == null ? '—' : `${v} ${unit}`, name]}
            labelFormatter={y => `Year ${y}`}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} iconSize={9} />

          {/* excess-emissions area (post-misalignment) */}
          {showBaseline && (
            <Area dataKey={baseExcessKey} stroke="none" fill={BASE} fillOpacity={0.18} name="Baseline excess" isAnimationActive={false} legendType="none" />
          )}
          <Area dataKey={excessKey} stroke="none" fill={RED} fillOpacity={0.13} name="Excess emissions" isAnimationActive={false} legendType="none" />

          {/* CRREM target */}
          <Line dataKey={targetKey} stroke={TARGET} strokeWidth={2} strokeDasharray="5 3" dot={false} name="CRREM target" isAnimationActive={false} />
          {/* baseline (no interventions) — Part 6 overlay */}
          {showBaseline && (
            <Line dataKey={baseKey} stroke={BASE} strokeWidth={1.5} strokeDasharray="2 2" dot={false} name="Baseline" isAnimationActive={false} />
          )}
          {/* strategy asset performance */}
          <Line dataKey={assetKey} stroke={ASSET} strokeWidth={2.5} dot={false} name="Strategy" isAnimationActive={false} />

          {/* current-year diamond */}
          {assetNow != null && (
            <ReferenceDot x={currentYear} y={assetNow} r={6} fill={ASSET} stroke="#fff" strokeWidth={2} shape="diamond" isFront />
          )}
          {/* misalignment red circle(s) */}
          {misalign != null && (
            <ReferenceDot x={misalign} y={valAt(data, misalign, targetKey)} r={6} fill="#fff" stroke={RED} strokeWidth={2.5} isFront />
          )}
          {showBaseline && baseMisalign != null && (
            <ReferenceDot x={baseMisalign} y={valAt(data, baseMisalign, targetKey)} r={5} fill="#fff" stroke={BASE} strokeWidth={2} isFront />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function CrremStrandingDiagram({
  finalFuels, baseFuels, gia, finalEUI, baselineEUI,
  lifetimeCarbonSaved, pick, showBaseline = false, currentYear,
}) {
  const yr = currentYear ?? new Date().getFullYear()

  const data = useMemo(() => {
    if (!(gia > 0)) return []
    const rows = []
    for (let y = START; y <= END; y++) {
      const tgt = readCrremTarget(y, pick) || {}
      const carbonAsset = r1(carbonIntensityForYear(finalFuels, gia, y))
      const carbonBase  = r1(carbonIntensityForYear(baseFuels, gia, y))
      const carbonTgt   = r1(tgt.carbon_kg_m2)
      const energyAsset = r1(finalEUI)        // flat — energy intensity doesn't decarbonise (v1)
      const energyBase  = r1(baselineEUI)
      const energyTgt   = r1(tgt.eui_kwh_m2)
      rows.push({
        year: y,
        carbonTarget: carbonTgt, carbonAsset, carbonBase,
        energyTarget: energyTgt, energyAsset, energyBase,
        carbonExcess:     (carbonAsset != null && carbonTgt != null && carbonAsset > carbonTgt) ? [carbonTgt, carbonAsset] : null,
        carbonBaseExcess: (carbonBase  != null && carbonTgt != null && carbonBase  > carbonTgt) ? [carbonTgt, carbonBase]  : null,
        energyExcess:     (energyAsset != null && energyTgt != null && energyAsset > energyTgt) ? [energyTgt, energyAsset] : null,
        energyBaseExcess: (energyBase  != null && energyTgt != null && energyBase  > energyTgt) ? [energyTgt, energyBase]  : null,
      })
    }
    return rows
  }, [finalFuels, baseFuels, gia, finalEUI, baselineEUI, pick])

  if (pick && !hasCrremPathway(pick)) {
    return <p className="text-xs text-mid-grey/60 italic">No CRREM curve for {pick.property_type} yet — v1 carries UK Hotel 1.5°C only. Set the project building type to Hotel, or wait for more pathways in a future brief.</p>
  }
  if (!(gia > 0) || data.length === 0) {
    return <p className="text-xs text-mid-grey/60 italic">Add interventions to the strategy to see the CRREM trajectory.</p>
  }

  const energyMisalign = firstCrossYear(data, 'energyAsset', 'energyTarget')
  const carbonMisalign = firstCrossYear(data, 'carbonAsset', 'carbonTarget')
  const crremEuiNow    = r1(valAt(data, yr, 'energyTarget'))
  const fmtYr = y => y == null ? 'Compliant' : String(y)

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* CRREM headline numbers */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 px-1">
        <HeadlineNum label="Strategy EUI" value={`${r1(finalEUI) ?? '—'}`} sub="kWh/m²·yr" />
        <HeadlineNum label="CRREM EUI target" value={`${crremEuiNow ?? '—'}`} sub={`kWh/m²·yr · ${yr}`} accent={TARGET} />
        <HeadlineNum label="Energy misalignment" value={fmtYr(energyMisalign)} accent={energyMisalign ? RED : '#16A34A'} />
        <HeadlineNum label="Carbon misalignment" value={fmtYr(carbonMisalign)} sub="grid buys time" accent={carbonMisalign ? RED : '#16A34A'} />
        <HeadlineNum label="Lifetime carbon saved" value={Number.isFinite(lifetimeCarbonSaved) ? `${lifetimeCarbonSaved >= 0 ? '+' : '−'}${Math.abs(lifetimeCarbonSaved).toFixed(0)} tCO₂e` : '—'} sub="by 2050" accent="#16A34A" />
      </div>

      {/* Two stacked charts */}
      <div className="flex flex-col gap-3">
        <StrandingPanel
          data={data} title="GHG intensity (kgCO₂e/m²·yr)" unit="kgCO₂/m²"
          targetKey="carbonTarget" assetKey="carbonAsset" baseKey="carbonBase"
          excessKey="carbonExcess" baseExcessKey="carbonBaseExcess"
          showBaseline={showBaseline} currentYear={yr}
        />
        <StrandingPanel
          data={data} title="Energy intensity (kWh/m²·yr)" unit="kWh/m²"
          targetKey="energyTarget" assetKey="energyAsset" baseKey="energyBase"
          excessKey="energyExcess" baseExcessKey="energyBaseExcess"
          showBaseline={showBaseline} currentYear={yr}
        />
      </div>
    </div>
  )
}
