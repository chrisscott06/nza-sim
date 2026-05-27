/**
 * BreakdownTable.jsx — Brief 60 Part A (2026-05-27)
 *
 * The redesigned in-tool calculation trail. Three visually-grouped bands
 * + summary cards + headline. Replaces the on-screen role the old
 * BreakdownPanel (Trail/Matrix audit-trail) played for "what changed";
 * the old panel is preserved beside this one for per-intervention chain
 * navigation (Brief 48 Part 3).
 *
 * Inputs (both already computed by VisualiserHost — no engine call here):
 *   - baselineResult     — calculateInstant output for the baseline (no
 *                          interventions)
 *   - cumulativeResult   — calculateInstant output for the final cumulative
 *                          state (all enabled interventions applied)
 *
 * Reads (no derived physics — pure display):
 *   consumption.{space_heating, space_cooling, dhw}.{demand_mwh,
 *     delivered_mwh, electricity_mwh, gas_mwh, scop_effective,
 *     seer_effective}
 *   consumption.brief40.{ventilation, lighting, small_power, dhw}
 *   consumption.total.{electricity_mwh, gas_mwh, kwh_per_m2_yr}
 *   carbon_kg_co2_per_m2 (top-level)
 *
 * Brief 60 A2 ships the table layout + all rows; A3 adds the inline
 * `delivered ÷ efficiency = fuel` arithmetic with the efficiency value
 * full-strength while the rest of the line is muted, plus the narrative
 * footnote. A2 still shows the per-row arithmetic but in a simpler form;
 * the polish lands in A3.
 *
 * Engine git diff: 0 lines (this is the entire delivery for Part A — all
 * required data already in engine output; map confirmed in
 * docs/audit/60_panel_redesign.md).
 *
 * The 110.30 EUI Bridgewater anchor must hold when no interventions
 * are present (Band 1/2/3 all "—" Δ; baseline column reads 110.30).
 */

import { Info } from 'lucide-react'
import { useUISettings } from '../../../../context/UISettingsContext.jsx'
import { toDisplay as toDisplayUnit, KIND as DISPLAY_KIND, getGia } from './unitFmt.js'

const TONE = {
  good:    'text-green-700',
  bad:     'text-red-700',
  neutral: 'text-mid-grey',
}

const NOISE_THRESHOLD = {
  mwh:                0.05,
  kwh_per_m2_yr:      0.05,
  kgco2_per_m2_yr:    0.05,
  unitless:           0.005,
}

// ── Small helpers (mirror BreakdownPanel.jsx conventions) ─────────────
function pickNumber(obj, path, fallback = null) {
  if (!obj || typeof path !== 'string') return fallback
  let cur = obj
  for (const seg of path.split('.')) {
    if (cur == null) return fallback
    cur = cur[seg]
  }
  return (typeof cur === 'number' && Number.isFinite(cur)) ? cur : fallback
}

function fmtValue(v, unit = 'mwh') {
  if (v == null || !Number.isFinite(v)) return '—'
  if (unit === 'unitless') return v.toFixed(2)
  if (Math.abs(v) >= 100) return v.toFixed(0)
  return v.toFixed(1)
}

function fmtDelta(v, unit = 'mwh') {
  if (v == null || !Number.isFinite(v)) return '—'
  const threshold = NOISE_THRESHOLD[unit] ?? 0.05
  if (Math.abs(v) < threshold) return '—'
  const sign = v < 0 ? '−' : '+'
  if (unit === 'unitless') return `${sign}${Math.abs(v).toFixed(2)}`
  if (Math.abs(v) >= 10)   return `${sign}${Math.abs(v).toFixed(1)}`
  return `${sign}${Math.abs(v).toFixed(1)}`
}

function deltaTone(v, unit = 'mwh', { goodWhenPositive = false } = {}) {
  if (v == null || !Number.isFinite(v)) return 'neutral'
  const threshold = NOISE_THRESHOLD[unit] ?? 0.05
  if (Math.abs(v) < threshold) return 'neutral'
  if (goodWhenPositive) return v > 0 ? 'good' : 'bad'
  return v < 0 ? 'good' : 'bad'
}

function nativeKindFor(nativeUnit) {
  if (nativeUnit === 'mwh')             return DISPLAY_KIND.MWH
  if (nativeUnit === 'kwh_per_m2_yr')   return DISPLAY_KIND.KWH_M2
  if (nativeUnit === 'kgco2_per_m2_yr') return DISPLAY_KIND.KG_M2
  return DISPLAY_KIND.UNITLESS
}
function convertForDisplay(value, nativeUnit, displayUnit, gia_m2) {
  return toDisplayUnit(value, nativeKindFor(nativeUnit), displayUnit, gia_m2)
}
function displayUnitLabel(nativeUnit, displayUnit) {
  if (nativeUnit === 'unitless')         return ''
  if (nativeUnit === 'kgco2_per_m2_yr') {
    return displayUnit === 'kwh_per_m2' ? 'kgCO₂/m²·yr' : 'tCO₂'
  }
  return displayUnit === 'kwh_per_m2' ? 'kWh/m²·yr' : 'MWh'
}

// ── Engine-result extractors per row (no math, just reads) ────────────

function readDemand(r) {
  return {
    heating:  pickNumber(r, 'consumption.space_heating.demand_mwh') ?? pickNumber(r, 'demand.heating_demand_mwh'),
    cooling:  pickNumber(r, 'consumption.space_cooling.demand_mwh') ?? pickNumber(r, 'demand.cooling_demand_mwh'),
    dhw:      pickNumber(r, 'consumption.dhw.demand_mwh') ?? pickNumber(r, 'consumption.brief40.dhw.demand_at_comfort_mwh'),
  }
}

function readPerService(r, service) {
  // service ∈ {space_heating, space_cooling, dhw}
  return {
    delivered:   pickNumber(r, `consumption.${service}.delivered_mwh`),
    electricity: pickNumber(r, `consumption.${service}.electricity_mwh`) ?? 0,
    gas:         pickNumber(r, `consumption.${service}.gas_mwh`) ?? 0,
    scop:        pickNumber(r, `consumption.${service}.scop_effective`),
    seer:        pickNumber(r, `consumption.${service}.seer_effective`),
  }
}

function readDhwEff(r) {
  // brief40.dhw.blended_efficiency is the engine's blended η across systems
  return pickNumber(r, 'consumption.brief40.dhw.blended_efficiency')
}

function readVentilationFanTotal(r) {
  // Prefer brief40 total (sums per-system v40 fan_electrical_mwh);
  // fallback to consumption.ventilation[].fan_electricity_mwh sum.
  const b40 = pickNumber(r, 'consumption.brief40.ventilation.total_fan_electrical_mwh')
  if (b40 != null) return b40
  const vents = r?.consumption?.ventilation
  if (Array.isArray(vents)) {
    return vents.reduce((s, v) => s + (Number(v?.fan_electricity_mwh) || 0), 0)
  }
  return null
}

function readVentSystems(r) {
  // Per-system list for ventilation breakdown (sfp_w_per_lps, flow_rate,
  // fan_electrical_mwh). Used in A3 for inline arithmetic per-system.
  return r?.consumption?.brief40?.ventilation?.systems ?? []
}

function readLightingTotal(r) {
  return pickNumber(r, 'consumption.brief40.lighting.total_delivered_electrical_mwh')
      ?? pickNumber(r, 'consumption.lighting.electricity_mwh')
}

function readSmallPowerTotal(r) {
  return pickNumber(r, 'consumption.brief40.small_power.total_delivered_electrical_mwh')
      ?? pickNumber(r, 'consumption.small_power.electricity_mwh')
}

function readLightingGain(r) {
  return (pickNumber(r, 'heat_balance.annual.gains.internal.lighting.kwh') ?? 0) / 1000
}

function readSmallPowerGain(r) {
  return (pickNumber(r, 'heat_balance.annual.gains.internal.equipment.kwh') ?? 0) / 1000
}

function readFuelTotals(r) {
  return {
    electricity: pickNumber(r, 'consumption.total.electricity_mwh'),
    gas:         pickNumber(r, 'consumption.total.gas_mwh'),
  }
}

function readHeadline(r) {
  return {
    eui:    pickNumber(r, 'consumption.total.kwh_per_m2_yr'),
    carbon: pickNumber(r, 'carbon_kg_co2_per_m2'),
  }
}

// ── Component pieces ──────────────────────────────────────────────────

function SummaryCard({ label, dBefore, dAfter, unit = 'mwh', displayUnit, gia_m2 }) {
  const delta = (dAfter != null && dBefore != null) ? (dAfter - dBefore) : null
  const tone = deltaTone(delta, unit)
  const conv = convertForDisplay(delta, unit, displayUnit, gia_m2)
  const label_u = displayUnitLabel(unit, displayUnit)
  return (
    <div className="px-3 py-2 bg-off-white rounded border border-light-grey/60">
      <p className="text-xxs uppercase tracking-wider text-mid-grey">{label}</p>
      <p className={`mt-0.5 text-base font-semibold tabular-nums ${TONE[tone]}`}>
        {fmtDelta(conv.value, unit)}
        <span className="text-xxs font-normal text-mid-grey/80 ml-1">{conv.label || label_u}</span>
      </p>
    </div>
  )
}

function ThreeColRow({
  label, tooltip, before, after, unit = 'mwh',
  goodWhenPositive = false, displayUnit, gia_m2, dim = false, indent = false,
  arithmetic = null,   // optional inline arithmetic JSX shown below the label
}) {
  const delta = (before != null && after != null) ? (after - before) : null
  const tone = deltaTone(delta, unit, { goodWhenPositive })
  const bothNull = before == null && after == null
  const beforeConv = convertForDisplay(before, unit, displayUnit, gia_m2)
  const afterConv  = convertForDisplay(after,  unit, displayUnit, gia_m2)
  const deltaConv  = convertForDisplay(delta,  unit, displayUnit, gia_m2)
  const unitLabel  = displayUnitLabel(unit, displayUnit)
  const dimCls     = dim ? 'opacity-40' : ''
  return (
    <tr className={`border-t border-light-grey/40 hover:bg-off-white/30 ${dimCls}`}>
      <td className={`py-1.5 ${indent ? 'pl-6' : 'pl-2'} pr-3 text-xxs text-navy`}>
        <span className="inline-flex items-center gap-1">
          {label}
          {tooltip && (
            <span title={tooltip} className="text-mid-grey/40 hover:text-mid-grey">
              <Info size={10} />
            </span>
          )}
        </span>
        {arithmetic && (
          <div className="mt-0.5 text-xxs text-mid-grey/70 font-mono tabular-nums">{arithmetic}</div>
        )}
      </td>
      <td className="py-1.5 px-2 text-right text-xxs tabular-nums text-mid-grey/80">
        {bothNull ? '—' : fmtValue(beforeConv.value, unit)}
      </td>
      <td className="py-1.5 px-2 text-right text-xxs tabular-nums text-navy">
        {bothNull ? '—' : fmtValue(afterConv.value, unit)}
      </td>
      <td className={`py-1.5 px-2 text-right text-xxs tabular-nums font-medium ${TONE[tone]}`}>
        {fmtDelta(deltaConv.value, unit)}
      </td>
      <td className="py-1.5 pl-2 pr-2 text-xxs text-mid-grey/70 whitespace-nowrap">
        {unitLabel}
      </td>
    </tr>
  )
}

function BandHeader({ title, subtitle }) {
  return (
    <div className="mt-4 first:mt-0 px-2 pt-2 pb-1">
      <p className="text-xxs uppercase tracking-wider text-mid-grey font-semibold">{title}</p>
      {subtitle && <p className="text-xxs text-mid-grey/60 italic mt-0.5">{subtitle}</p>}
    </div>
  )
}

function TableShell({ children }) {
  return (
    <table className="w-full">
      <thead>
        <tr className="text-mid-grey/60">
          <th className="text-left font-medium text-xxs uppercase tracking-wider pl-2 pr-3 pb-1"></th>
          <th className="text-right font-medium text-xxs uppercase tracking-wider px-2 pb-1">Baseline</th>
          <th className="text-right font-medium text-xxs uppercase tracking-wider px-2 pb-1">After</th>
          <th className="text-right font-medium text-xxs uppercase tracking-wider px-2 pb-1">Δ</th>
          <th className="text-left font-normal text-xxs normal-case pl-2 pb-1 text-mid-grey/50">unit</th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  )
}

// ── A3 inline arithmetic — Band 2 row sub-line ────────────────────────
//
// Renders the per-service arithmetic with the efficiency value
// full-strength (text-navy font-medium) and the rest of the line muted
// (text-mid-grey/70). For services without an efficiency (ventilation,
// lighting, small_power) renders the appropriate identity form.

function arithmeticHeating(after) {
  if (after.delivered == null || after.scop == null) return null
  const elec = after.electricity ?? 0
  const gas  = after.gas ?? 0
  const fuelSum = elec + gas
  return (
    <span>
      {after.delivered.toFixed(1)} ÷ <span className="text-navy font-medium">{after.scop.toFixed(2)}</span> = {fuelSum.toFixed(1)}
      <span className="ml-2 text-mid-grey/50">
        ({elec.toFixed(1)} elec + {gas.toFixed(1)} gas)
      </span>
    </span>
  )
}
function arithmeticCooling(after) {
  if (after.delivered == null || after.seer == null) return null
  const elec = after.electricity ?? 0
  return (
    <span>
      {after.delivered.toFixed(1)} ÷ <span className="text-navy font-medium">{after.seer.toFixed(2)}</span> = {elec.toFixed(1)} elec
    </span>
  )
}
function arithmeticDhw(after, eff) {
  if (after.delivered == null || eff == null) return null
  const elec = after.electricity ?? 0
  const gas  = after.gas ?? 0
  const fuelSum = elec + gas
  return (
    <span>
      {after.delivered.toFixed(1)} ÷ <span className="text-navy font-medium">{eff.toFixed(2)}</span> = {fuelSum.toFixed(1)}
      <span className="ml-2 text-mid-grey/50">
        ({elec.toFixed(1)} elec + {gas.toFixed(1)} gas)
      </span>
    </span>
  )
}
function arithmeticVentilation(ventSystems) {
  if (!Array.isArray(ventSystems) || ventSystems.length === 0) return null
  return (
    <span>
      {ventSystems.map((s, i) => (
        <span key={s.id ?? i}>
          {i > 0 && <span className="text-mid-grey/40"> + </span>}
          <span className="text-mid-grey/70">{(Number(s.sfp_w_per_lps) || 0).toFixed(2)} × {(Number(s.flow_rate) || 0).toFixed(0)} × 8760/1000</span>
        </span>
      ))}
      <span className="text-mid-grey/40"> = </span>
      <span className="text-navy font-medium">{ventSystems.reduce((a, s) => a + (Number(s.fan_electrical_mwh) || 0), 0).toFixed(1)}</span>
      <span className="text-mid-grey/50 ml-1">MWh fan elec (SFP × flow)</span>
    </span>
  )
}
function arithmeticIdentity1to1(elec, gain, label) {
  if (elec == null) return null
  const matchOk = Math.abs((gain ?? 0) - elec) < 0.05
  return (
    <span>
      gain {gain != null ? gain.toFixed(1) : '—'} <span className="text-mid-grey/40">=</span> electricity <span className="text-navy font-medium">{elec.toFixed(1)}</span>
      <span className="ml-2 text-mid-grey/50">({label}; 1:1 post-Brief-58-C coupling{matchOk ? '' : ' — discrepancy'})</span>
    </span>
  )
}
function arithmeticAuxiliary() {
  return (
    <span className="italic text-mid-grey/60">
      no auxiliary loads configured (Brief 60 Part B will add catering / external lighting / pumps)
    </span>
  )
}

// ── Footnote (A3) — plain-English story line ──────────────────────────
function pickNarrative({ beforeDem, afterDem, beforeFuel, afterFuel, beforeHead, afterHead }) {
  const dHeat = (afterDem?.heating ?? 0) - (beforeDem?.heating ?? 0)
  const dCool = (afterDem?.cooling ?? 0) - (beforeDem?.cooling ?? 0)
  const dElec = (afterFuel?.electricity ?? 0) - (beforeFuel?.electricity ?? 0)
  const dGas  = (afterFuel?.gas ?? 0) - (beforeFuel?.gas ?? 0)
  const dEui  = (afterHead?.eui ?? 0) - (beforeHead?.eui ?? 0)
  const fmt = (v) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}`
  const allSmall = Math.abs(dHeat) < 0.1 && Math.abs(dCool) < 0.1 && Math.abs(dElec) < 0.1 && Math.abs(dGas) < 0.1 && Math.abs(dEui) < 0.1
  if (allSmall) {
    return 'No interventions applied — baseline only. Add an intervention in the stack to see the calculation trail respond.'
  }
  const parts = []
  if (Math.abs(dHeat) >= 0.5) parts.push(`Heat demand ${fmt(dHeat)} MWh`)
  if (Math.abs(dCool) >= 0.5) parts.push(`cooling ${fmt(dCool)} MWh`)
  const demandSentence = parts.length > 0 ? parts.join(', ') + '. ' : ''
  const fuelParts = []
  if (Math.abs(dElec) >= 0.5) fuelParts.push(`electricity ${fmt(dElec)} MWh`)
  if (Math.abs(dGas)  >= 0.5) fuelParts.push(`gas ${fmt(dGas)} MWh`)
  const fuelSentence = fuelParts.length > 0 ? `Fuel: ${fuelParts.join(', ')}. ` : ''
  const euiSentence = Math.abs(dEui) >= 0.1 ? `EUI ${fmt(dEui)} kWh/m²·yr.` : ''
  return demandSentence + fuelSentence + euiSentence
}

// ── Main component ─────────────────────────────────────────────────────

export default function BreakdownTable({ baselineResult, cumulativeResult }) {
  const { unit: displayUnit } = useUISettings()
  const gia_m2 = getGia(cumulativeResult) || getGia(baselineResult) || null

  if (!baselineResult) {
    return (
      <div className="p-6 text-center text-xxs italic text-mid-grey">
        No baseline result available yet. Run a project to populate the calculation trail.
      </div>
    )
  }

  // ── Read everything once ────────────────────────────────────────────
  const beforeDem  = readDemand(baselineResult)
  const afterDem   = readDemand(cumulativeResult ?? baselineResult)
  const beforeHeat = readPerService(baselineResult, 'space_heating')
  const afterHeat  = readPerService(cumulativeResult ?? baselineResult, 'space_heating')
  const beforeCool = readPerService(baselineResult, 'space_cooling')
  const afterCool  = readPerService(cumulativeResult ?? baselineResult, 'space_cooling')
  const beforeDhw  = readPerService(baselineResult, 'dhw')
  const afterDhw   = readPerService(cumulativeResult ?? baselineResult, 'dhw')
  const beforeDhwEff = readDhwEff(baselineResult)
  const afterDhwEff  = readDhwEff(cumulativeResult ?? baselineResult)
  const beforeFanTotal = readVentilationFanTotal(baselineResult)
  const afterFanTotal  = readVentilationFanTotal(cumulativeResult ?? baselineResult)
  const afterVentSys   = readVentSystems(cumulativeResult ?? baselineResult)
  const beforeLight    = readLightingTotal(baselineResult)
  const afterLight     = readLightingTotal(cumulativeResult ?? baselineResult)
  const beforeLightGain= readLightingGain(baselineResult)
  const afterLightGain = readLightingGain(cumulativeResult ?? baselineResult)
  const beforeSp       = readSmallPowerTotal(baselineResult)
  const afterSp        = readSmallPowerTotal(cumulativeResult ?? baselineResult)
  const beforeSpGain   = readSmallPowerGain(baselineResult)
  const afterSpGain    = readSmallPowerGain(cumulativeResult ?? baselineResult)
  const beforeFuel  = readFuelTotals(baselineResult)
  const afterFuel   = readFuelTotals(cumulativeResult ?? baselineResult)
  const beforeHead  = readHeadline(baselineResult)
  const afterHead   = readHeadline(cumulativeResult ?? baselineResult)

  // ── "Unchanged" rule — band 2 row dim when before≈after at MWh scale
  const unchanged = (a, b) => (a != null && b != null) && Math.abs(a - b) < NOISE_THRESHOLD.mwh

  const narrative = pickNarrative({
    beforeDem, afterDem, beforeFuel, afterFuel, beforeHead, afterHead,
  })

  return (
    <div className="p-4 space-y-3">
      {/* ── SUMMARY CARDS ───────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryCard label="Heat demand Δ"  dBefore={beforeDem.heating}     dAfter={afterDem.heating}     unit="mwh" displayUnit={displayUnit} gia_m2={gia_m2} />
        <SummaryCard label="Cooling Δ"      dBefore={beforeDem.cooling}     dAfter={afterDem.cooling}     unit="mwh" displayUnit={displayUnit} gia_m2={gia_m2} />
        <SummaryCard label="Electricity Δ"  dBefore={beforeFuel.electricity} dAfter={afterFuel.electricity} unit="mwh" displayUnit={displayUnit} gia_m2={gia_m2} />
      </div>

      {/* ── BAND 1 — DEMAND ─────────────────────────────────────────── */}
      <div className="bg-white border border-light-grey/60 rounded">
        <BandHeader
          title="DEMAND · what the building needs"
          subtitle="State 2 zone demand (heating already post-MVHR; tap-mix corrected for DHW)"
        />
        <div className="px-2 pb-2">
          <TableShell>
            <ThreeColRow label="Heat needed"     tooltip="consumption.space_heating.demand_mwh — already post-MVHR via (1-HRE) factor on vent UA inside _calculateState2" before={beforeDem.heating} after={afterDem.heating} displayUnit={displayUnit} gia_m2={gia_m2} dim={unchanged(beforeDem.heating, afterDem.heating)} />
            <ThreeColRow label="Cooling needed"  tooltip="consumption.space_cooling.demand_mwh" before={beforeDem.cooling} after={afterDem.cooling} displayUnit={displayUnit} gia_m2={gia_m2} dim={unchanged(beforeDem.cooling, afterDem.cooling)} />
            <ThreeColRow label="Hot water needed" tooltip="consumption.dhw.demand_mwh — Brief 58 B3 headcount basis × tap-mix correction" before={beforeDem.dhw} after={afterDem.dhw} displayUnit={displayUnit} gia_m2={gia_m2} dim={unchanged(beforeDem.dhw, afterDem.dhw)} />
          </TableShell>
        </div>
      </div>

      {/* ── BAND 2 — DELIVERED ÷ EFFICIENCY = FUEL ──────────────────── */}
      <div className="bg-white border border-light-grey/60 rounded">
        <BandHeader
          title="DELIVERED ÷ EFFICIENCY = FUEL"
          subtitle="Per-service arithmetic — the divisor (full-strength) is the SCOP/SEER/η; the rest of the line is muted so a changed divisor stands out"
        />
        <div className="px-2 pb-2">
          <TableShell>
            <ThreeColRow
              label="Heating"
              tooltip="consumption.space_heating.{delivered_mwh, electricity_mwh, gas_mwh, scop_effective}"
              before={(beforeHeat.electricity ?? 0) + (beforeHeat.gas ?? 0)}
              after={(afterHeat.electricity ?? 0) + (afterHeat.gas ?? 0)}
              displayUnit={displayUnit} gia_m2={gia_m2}
              dim={unchanged((beforeHeat.electricity ?? 0) + (beforeHeat.gas ?? 0), (afterHeat.electricity ?? 0) + (afterHeat.gas ?? 0))}
              arithmetic={arithmeticHeating(afterHeat)}
            />
            <ThreeColRow
              label="Cooling"
              tooltip="consumption.space_cooling.{delivered_mwh, electricity_mwh, seer_effective}"
              before={beforeCool.electricity}
              after={afterCool.electricity}
              displayUnit={displayUnit} gia_m2={gia_m2}
              dim={unchanged(beforeCool.electricity, afterCool.electricity)}
              arithmetic={arithmeticCooling(afterCool)}
            />
            <ThreeColRow
              label="Hot water"
              tooltip="consumption.dhw.{delivered_mwh, electricity_mwh, gas_mwh} + consumption.brief40.dhw.blended_efficiency"
              before={(beforeDhw.electricity ?? 0) + (beforeDhw.gas ?? 0)}
              after={(afterDhw.electricity ?? 0) + (afterDhw.gas ?? 0)}
              displayUnit={displayUnit} gia_m2={gia_m2}
              dim={unchanged((beforeDhw.electricity ?? 0) + (beforeDhw.gas ?? 0), (afterDhw.electricity ?? 0) + (afterDhw.gas ?? 0))}
              arithmetic={arithmeticDhw(afterDhw, afterDhwEff)}
            />
            <ThreeColRow
              label="Ventilation / fans"
              tooltip="consumption.brief40.ventilation.systems[*].{sfp_w_per_lps, flow_rate, fan_electrical_mwh} — sum of per-system fan power. NEW in Brief 60 Part A."
              before={beforeFanTotal}
              after={afterFanTotal}
              displayUnit={displayUnit} gia_m2={gia_m2}
              dim={unchanged(beforeFanTotal, afterFanTotal)}
              arithmetic={arithmeticVentilation(afterVentSys)}
            />
            <ThreeColRow
              label="Lighting"
              tooltip="consumption.brief40.lighting.total_delivered_electrical_mwh — Brief 58 C couples 1:1 with gains.internal.lighting.kwh post v40 modulation"
              before={beforeLight}
              after={afterLight}
              displayUnit={displayUnit} gia_m2={gia_m2}
              dim={unchanged(beforeLight, afterLight)}
              arithmetic={arithmeticIdentity1to1(afterLight, afterLightGain, 'lighting')}
            />
            <ThreeColRow
              label="Small power"
              tooltip="consumption.brief40.small_power.total_delivered_electrical_mwh — Brief 58 C couples 1:1 with gains.internal.equipment.kwh post v40 modulation"
              before={beforeSp}
              after={afterSp}
              displayUnit={displayUnit} gia_m2={gia_m2}
              dim={unchanged(beforeSp, afterSp)}
              arithmetic={arithmeticIdentity1to1(afterSp, afterSpGain, 'small power')}
            />
            <ThreeColRow
              label="Auxiliary"
              tooltip="Brief 60 Part B will populate (external lighting, catering, pumps, other small power)"
              before={null}
              after={null}
              displayUnit={displayUnit} gia_m2={gia_m2}
              dim={true}
              arithmetic={arithmeticAuxiliary()}
            />
          </TableShell>
        </div>
      </div>

      {/* ── BAND 3 — FUEL TOTALS ────────────────────────────────────── */}
      <div className="bg-white border border-light-grey/60 rounded">
        <BandHeader
          title="FUEL TOTALS · by carrier"
          subtitle="Sum across all systems by carrier — what gets metered"
        />
        <div className="px-2 pb-2">
          <TableShell>
            <ThreeColRow label="Total electricity" tooltip="consumption.total.electricity_mwh"  before={beforeFuel.electricity} after={afterFuel.electricity} displayUnit={displayUnit} gia_m2={gia_m2} dim={unchanged(beforeFuel.electricity, afterFuel.electricity)} />
            <ThreeColRow label="Total gas"          tooltip="consumption.total.gas_mwh"          before={beforeFuel.gas}         after={afterFuel.gas}         displayUnit={displayUnit} gia_m2={gia_m2} dim={unchanged(beforeFuel.gas, afterFuel.gas)} />
          </TableShell>
        </div>
      </div>

      {/* ── HEADLINE ────────────────────────────────────────────────── */}
      <div className="bg-white border border-navy/30 rounded">
        <BandHeader title="HEADLINE" />
        <div className="px-2 pb-2">
          <TableShell>
            <ThreeColRow label="EUI"               tooltip="consumption.total.kwh_per_m2_yr — source energy ÷ reported GIA"   before={beforeHead.eui}    after={afterHead.eui}    unit="kwh_per_m2_yr"   displayUnit={displayUnit} gia_m2={gia_m2} />
            <ThreeColRow label="Operational carbon" tooltip="carbon_kg_co2_per_m2 — driven by the fuel mix × emission factors" before={beforeHead.carbon} after={afterHead.carbon} unit="kgco2_per_m2_yr" displayUnit={displayUnit} gia_m2={gia_m2} />
          </TableShell>
        </div>
      </div>

      {/* ── Footnote (A3) — plain-English story line ─────────────────── */}
      <p className="text-xxs italic text-mid-grey/80 px-2 pt-2 border-t border-light-grey/40">
        {narrative}
      </p>
    </div>
  )
}
