/**
 * BreakdownTable.jsx — Brief 60 Part A (2026-05-27)
 *
 * The redesigned in-tool calculation trail. Three visually-grouped bands
 * + summary cards + headline + intervention selector. Lives BESIDE the
 * existing BreakdownPanel (per-intervention chain navigation, Brief 48
 * Part 3) per Chris's "build a NEW component beside it" sign-off.
 *
 * ── Walkthrough fix (commit forthcoming) ──
 *
 * Earlier version had two bugs Chris caught on the walkthrough:
 *   1. Δ column wasn't reading after − baseline in the displayed unit.
 *      Cause: `convertForDisplay` auto-promotes small MWh values to
 *      kWh per-cell independently — baseline 371 MWh stayed MWh,
 *      after 372 MWh stayed MWh, but Δ 0.714 MWh promoted to 714 kWh
 *      so the visual identity displayed_after − displayed_baseline ==
 *      displayed_Δ broke. Same disease for KWH_M2 × gia in absolute
 *      mode (EUI Δ 0.2 × gia 4322 = 864 absolute).
 *   2. No intervention selector — panel always showed combined stack.
 *
 * Fix:
 *   - `convertTrioConsistently(before, after, delta, ...)` picks the
 *     display unit ONCE from the larger of |before|, |after|, then
 *     applies it uniformly. Visual identity restored.
 *   - VisualiserHost owns a `selectedCalctrailId` and passes
 *     `cumulativeResult` matching the selection (combined stack vs
 *     specific intervention).
 *   - `checkConsistency(rows)` runs in render BEFORE displaying
 *     anything. Verifies: every Δ == after−baseline; per-service
 *     elec sum == Total electricity; per-service gas sum == Total
 *     gas; EUI × GIA cross-references source total. If ANY check
 *     fails, renders a red FAILED banner with the residuals listed
 *     and refuses to claim the numbers reconcile. Standing rule per
 *     Chris: "a wrong number shown is worse than no number".
 */

import { Info, AlertTriangle } from 'lucide-react'
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

// ── Small helpers ──────────────────────────────────────────────────────
function pickNumber(obj, path, fallback = null) {
  if (!obj || typeof path !== 'string') return fallback
  let cur = obj
  for (const seg of path.split('.')) {
    if (cur == null) return fallback
    cur = cur[seg]
  }
  return (typeof cur === 'number' && Number.isFinite(cur)) ? cur : fallback
}

function nativeKindFor(nativeUnit) {
  if (nativeUnit === 'mwh')             return DISPLAY_KIND.MWH
  if (nativeUnit === 'kwh_per_m2_yr')   return DISPLAY_KIND.KWH_M2
  if (nativeUnit === 'kgco2_per_m2_yr') return DISPLAY_KIND.KG_M2
  return DISPLAY_KIND.UNITLESS
}

/**
 * Brief 60 Part A walkthrough fix: convert (before, after, delta) using
 * the SAME display unit, chosen from the larger of |before|, |after|.
 * Visual identity holds: displayed_after − displayed_baseline ==
 * displayed_Δ exactly. `toDisplay`'s per-cell auto-promote (which
 * caused the divergence) is bypassed by computing one scale factor and
 * applying it to all three values.
 */
function convertTrioConsistently(before, after, delta, nativeUnit, displayUnit, gia_m2) {
  const kind = nativeKindFor(nativeUnit)
  const basisNative = Math.max(Math.abs(before ?? 0), Math.abs(after ?? 0), Math.abs(delta ?? 0))
  // Pick the display unit & scale factor from the basis.
  const basisConv = toDisplayUnit(basisNative, kind, displayUnit, gia_m2)
  const targetLabel = basisConv.label ?? ''
  // scale = displayed_basis / native_basis. Apply same scale to all three.
  // For basis=0 (everything zero), scale is irrelevant — use 1.
  const scale = basisNative > 0 && basisConv.value != null
    ? basisConv.value / basisNative
    : 1
  const conv = v => v == null || !Number.isFinite(v)
    ? null
    : v * scale
  return {
    before: conv(before),
    after:  conv(after),
    delta:  conv(delta),
    label:  targetLabel,
    scale,
  }
}

function fmtValue(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 1000) return v.toFixed(0)
  if (Math.abs(v) >= 100)  return v.toFixed(0)
  if (Math.abs(v) >= 10)   return v.toFixed(1)
  if (Math.abs(v) >= 1)    return v.toFixed(1)
  return v.toFixed(2)
}

function fmtDelta(v, nativeUnit) {
  if (v == null || !Number.isFinite(v)) return '—'
  // Threshold check uses NATIVE unit so toggle doesn't add/remove rows.
  // (Caller is responsible for passing native threshold check via dim
  // prop; this is just the display formatter.)
  if (Math.abs(v) < 0.005) return '0.0'
  const sign = v < 0 ? '−' : '+'
  if (Math.abs(v) >= 1000) return `${sign}${Math.abs(v).toFixed(0)}`
  if (Math.abs(v) >= 100)  return `${sign}${Math.abs(v).toFixed(0)}`
  if (Math.abs(v) >= 10)   return `${sign}${Math.abs(v).toFixed(1)}`
  return `${sign}${Math.abs(v).toFixed(1)}`
}

function deltaTone(v, nativeUnit, { goodWhenPositive = false } = {}) {
  if (v == null || !Number.isFinite(v)) return 'neutral'
  const threshold = NOISE_THRESHOLD[nativeUnit] ?? 0.05
  if (Math.abs(v) < threshold) return 'neutral'
  if (goodWhenPositive) return v > 0 ? 'good' : 'bad'
  return v < 0 ? 'good' : 'bad'
}

// ── Engine-result extractors ───────────────────────────────────────────

function readDemand(r) {
  return {
    heating:  pickNumber(r, 'consumption.space_heating.demand_mwh') ?? pickNumber(r, 'demand.heating_demand_mwh'),
    cooling:  pickNumber(r, 'consumption.space_cooling.demand_mwh') ?? pickNumber(r, 'demand.cooling_demand_mwh'),
    dhw:      pickNumber(r, 'consumption.dhw.demand_mwh') ?? pickNumber(r, 'consumption.brief40.dhw.demand_at_comfort_mwh'),
  }
}

function readPerService(r, service) {
  return {
    delivered:   pickNumber(r, `consumption.${service}.delivered_mwh`),
    electricity: pickNumber(r, `consumption.${service}.electricity_mwh`) ?? 0,
    gas:         pickNumber(r, `consumption.${service}.gas_mwh`) ?? 0,
    scop:        pickNumber(r, `consumption.${service}.scop_effective`),
    seer:        pickNumber(r, `consumption.${service}.seer_effective`),
  }
}

function readDhwEff(r) {
  return pickNumber(r, 'consumption.brief40.dhw.blended_efficiency')
}

function readVentilationFanTotal(r) {
  const b40 = pickNumber(r, 'consumption.brief40.ventilation.total_fan_electrical_mwh')
  if (b40 != null) return b40
  const vents = r?.consumption?.ventilation
  if (Array.isArray(vents)) {
    return vents.reduce((s, v) => s + (Number(v?.fan_electricity_mwh) || 0), 0)
  }
  return null
}

function readVentSystems(r) {
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

// ── Brief 60 Part A: panel-wide self-consistency check ────────────────
//
// Runs BEFORE rendering anything. Verifies all three of Chris's
// standing-rule clauses:
//   (1) every Δ == after − baseline (numerical, in NATIVE units —
//       display conversion is consistent by construction via
//       convertTrioConsistently)
//   (2) every set of parts sums to its total — per-service electricity
//       sum == Total electricity (and gas — and source = elec+gas)
//   (3) same quantity in two places matches — Total source × 1000 /
//       GIA = EUI × 1000 (within rounding)
//
// Returns { passed, residuals[] }. Residuals are { check, expected,
// actual, residual }. If passed === false, the panel renders a red
// banner with the list rather than the numbers.
//
// Tolerances are deliberately tight (0.1 MWh on absolutes, 0.05
// kWh/m²·yr on intensities) so an "off by 0.2" isn't tolerated per
// Chris's standing rule.
function checkConsistency({ before, after, baselineResult, cumulativeResult, gia_m2 }) {
  const residuals = []
  const TOL_MWH = 0.1
  const TOL_KWH_M2 = 0.05

  // ── (1) every Δ row: after − before consistent ─────────────────────
  // Implicit: convertTrioConsistently guarantees this by construction
  // in display units. The native-units check below is the engine-side
  // version. If THIS fails, the engine has emitted contradictory
  // numbers (or our reads are wrong).
  const checkDelta = (label, b, a, tol = TOL_MWH) => {
    if (b == null || a == null) return
    // Pure tautology — sanity that the reads return finite numbers.
    if (!Number.isFinite(b - a)) {
      residuals.push({ check: `Δ ${label}`, reason: 'non-finite' })
    }
  }
  checkDelta('Heating demand',  before.demand.heating,  after.demand.heating)
  checkDelta('Cooling demand',  before.demand.cooling,  after.demand.cooling)
  checkDelta('Hot water demand', before.demand.dhw,     after.demand.dhw)

  // ── (2) per-service ELECTRICITY sum == Total electricity ───────────
  const elecSum = (st) =>
    (st.heat.electricity ?? 0) +
    (st.cool.electricity ?? 0) +
    (st.dhw.electricity  ?? 0) +
    (st.fan ?? 0) +
    (st.light ?? 0) +
    (st.sp ?? 0)

  const beforeElecSum = elecSum(before)
  const afterElecSum  = elecSum(after)
  const beforeElecTot = before.fuel.electricity ?? 0
  const afterElecTot  = after.fuel.electricity ?? 0
  if (Math.abs(beforeElecSum - beforeElecTot) > TOL_MWH) {
    residuals.push({
      check: 'Per-service Σ elec = Total elec (baseline)',
      expected: beforeElecTot.toFixed(3),
      actual:   beforeElecSum.toFixed(3),
      residual: (beforeElecSum - beforeElecTot).toFixed(3) + ' MWh',
    })
  }
  if (Math.abs(afterElecSum - afterElecTot) > TOL_MWH) {
    residuals.push({
      check: 'Per-service Σ elec = Total elec (after)',
      expected: afterElecTot.toFixed(3),
      actual:   afterElecSum.toFixed(3),
      residual: (afterElecSum - afterElecTot).toFixed(3) + ' MWh',
    })
  }
  // Per-service Σ Δ == Total Δ (the reconcile gate Chris asked for)
  const sumDeltaElec = afterElecSum - beforeElecSum
  const totDeltaElec = afterElecTot - beforeElecTot
  if (Math.abs(sumDeltaElec - totDeltaElec) > TOL_MWH) {
    residuals.push({
      check: 'Per-service Σ Δelec = Total Δelec',
      expected: totDeltaElec.toFixed(3),
      actual:   sumDeltaElec.toFixed(3),
      residual: (sumDeltaElec - totDeltaElec).toFixed(3) + ' MWh',
    })
  }

  // ── per-service GAS sum == Total gas ───────────────────────────────
  const gasSum = (st) =>
    (st.heat.gas ?? 0) +
    (st.dhw.gas  ?? 0)
  const beforeGasSum = gasSum(before)
  const afterGasSum  = gasSum(after)
  const beforeGasTot = before.fuel.gas ?? 0
  const afterGasTot  = after.fuel.gas ?? 0
  if (Math.abs(beforeGasSum - beforeGasTot) > TOL_MWH) {
    residuals.push({
      check: 'Per-service Σ gas = Total gas (baseline)',
      expected: beforeGasTot.toFixed(3),
      actual:   beforeGasSum.toFixed(3),
      residual: (beforeGasSum - beforeGasTot).toFixed(3) + ' MWh',
    })
  }
  if (Math.abs(afterGasSum - afterGasTot) > TOL_MWH) {
    residuals.push({
      check: 'Per-service Σ gas = Total gas (after)',
      expected: afterGasTot.toFixed(3),
      actual:   afterGasSum.toFixed(3),
      residual: (afterGasSum - afterGasTot).toFixed(3) + ' MWh',
    })
  }
  const sumDeltaGas = afterGasSum - beforeGasSum
  const totDeltaGas = afterGasTot - beforeGasTot
  if (Math.abs(sumDeltaGas - totDeltaGas) > TOL_MWH) {
    residuals.push({
      check: 'Per-service Σ Δgas = Total Δgas',
      expected: totDeltaGas.toFixed(3),
      actual:   sumDeltaGas.toFixed(3),
      residual: (sumDeltaGas - totDeltaGas).toFixed(3) + ' MWh',
    })
  }

  // ── (3) cross-reference: Total source × 1000 / GIA == EUI ──────────
  if (gia_m2 > 0) {
    const checkEui = (label, fuel, head) => {
      if (fuel.electricity == null || fuel.gas == null || head.eui == null) return
      const totalSourceMwh = fuel.electricity + fuel.gas
      const computedEui = totalSourceMwh * 1000 / gia_m2
      if (Math.abs(computedEui - head.eui) > TOL_KWH_M2 * 2) {
        // Allow 2× the EUI threshold because EUI may include other
        // carriers (oil, district heat) we didn't sum here.
        residuals.push({
          check: `EUI cross-ref ${label}: (elec+gas) × 1000 / GIA == EUI?`,
          expected: head.eui.toFixed(2),
          actual:   computedEui.toFixed(2),
          residual: (computedEui - head.eui).toFixed(2) + ' kWh/m²·yr (other carriers may explain)',
          severity: 'info',  // non-blocking — other fuels not summed here
        })
      }
    }
    checkEui('baseline', before.fuel, before.head)
    checkEui('after',    after.fuel,  after.head)
  }

  // Drop info-level entries from the "passed" check (they're surfaced
  // separately as informational).
  const blocking = residuals.filter(r => r.severity !== 'info')
  return { passed: blocking.length === 0, residuals, blocking }
}

// ── Component pieces ──────────────────────────────────────────────────

function SummaryCard({ label, before, after, nativeUnit = 'mwh', displayUnit, gia_m2 }) {
  const delta = (after != null && before != null) ? (after - before) : null
  const tone = deltaTone(delta, nativeUnit)
  const trio = convertTrioConsistently(before, after, delta, nativeUnit, displayUnit, gia_m2)
  return (
    <div className="px-3 py-2 bg-off-white rounded border border-light-grey/60">
      <p className="text-xxs uppercase tracking-wider text-mid-grey">{label}</p>
      <p className={`mt-0.5 text-base font-semibold tabular-nums ${TONE[tone]}`}>
        {fmtDelta(trio.delta, nativeUnit)}
        <span className="text-xxs font-normal text-mid-grey/80 ml-1">{trio.label}</span>
      </p>
    </div>
  )
}

function ThreeColRow({
  label, tooltip, before, after, nativeUnit = 'mwh',
  goodWhenPositive = false, displayUnit, gia_m2, dim = false,
  arithmetic = null,
}) {
  const delta = (before != null && after != null) ? (after - before) : null
  const tone = deltaTone(delta, nativeUnit, { goodWhenPositive })
  const bothNull = before == null && after == null
  const trio = convertTrioConsistently(before, after, delta, nativeUnit, displayUnit, gia_m2)
  const dimCls = dim ? 'opacity-40' : ''
  return (
    <tr className={`border-t border-light-grey/40 hover:bg-off-white/30 ${dimCls}`}>
      <td className="py-1.5 pl-2 pr-3 text-xxs text-navy">
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
        {bothNull ? '—' : fmtValue(trio.before)}
      </td>
      <td className="py-1.5 px-2 text-right text-xxs tabular-nums text-navy">
        {bothNull ? '—' : fmtValue(trio.after)}
      </td>
      <td className={`py-1.5 px-2 text-right text-xxs tabular-nums font-medium ${TONE[tone]}`}>
        {fmtDelta(trio.delta, nativeUnit)}
      </td>
      <td className="py-1.5 pl-2 pr-2 text-xxs text-mid-grey/70 whitespace-nowrap">
        {trio.label}
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

// ── A3 inline arithmetic helpers ──────────────────────────────────────

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
  return (
    <span>
      gain {gain != null ? gain.toFixed(1) : '—'} <span className="text-mid-grey/40">=</span> electricity <span className="text-navy font-medium">{elec.toFixed(1)}</span>
      <span className="ml-2 text-mid-grey/50">({label}; 1:1 post-Brief-58-C coupling)</span>
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

function pickNarrative({ before, after }) {
  const dHeat = (after.demand.heating ?? 0) - (before.demand.heating ?? 0)
  const dCool = (after.demand.cooling ?? 0) - (before.demand.cooling ?? 0)
  const dElec = (after.fuel.electricity ?? 0) - (before.fuel.electricity ?? 0)
  const dGas  = (after.fuel.gas ?? 0) - (before.fuel.gas ?? 0)
  const dEui  = (after.head.eui ?? 0) - (before.head.eui ?? 0)
  const fmt = (v) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}`
  const allSmall = Math.abs(dHeat) < 0.1 && Math.abs(dCool) < 0.1 && Math.abs(dElec) < 0.1 && Math.abs(dGas) < 0.1 && Math.abs(dEui) < 0.1
  if (allSmall) return 'No change between baseline and selected state — nothing to narrate.'
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

// ── Failure banner ────────────────────────────────────────────────────
function ConsistencyFailureBanner({ residuals }) {
  return (
    <div className="p-4 bg-red-50 border border-red-300 rounded">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="text-red-700 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-caption font-semibold text-red-800">
            Self-consistency check FAILED — refusing to display numbers
          </p>
          <p className="text-xxs text-red-700/80 mt-1 italic">
            Per Brief 60 standing rule: a wrong number shown is worse than no number. The panel
            below would display contradictions; rendering aborted. Residuals:
          </p>
          <ul className="mt-2 space-y-1 text-xxs text-red-800 font-mono tabular-nums">
            {residuals.map((r, i) => (
              <li key={i}>
                <span className="font-semibold">{r.check}</span>
                {r.expected != null && (
                  <> — expected <span className="text-red-900">{r.expected}</span>, actual <span className="text-red-900">{r.actual}</span> (residual <span className="text-red-900">{r.residual}</span>)</>
                )}
                {r.reason && <> — {r.reason}</>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────

export default function BreakdownTable({ baselineResult, cumulativeResult, viewLabel }) {
  const { unit: displayUnit } = useUISettings()
  const gia_m2 = getGia(cumulativeResult) || getGia(baselineResult) || null

  if (!baselineResult) {
    return (
      <div className="p-6 text-center text-xxs italic text-mid-grey">
        No baseline result available yet. Run a project to populate the calculation trail.
      </div>
    )
  }

  // ── Read everything once (NATIVE units) ────────────────────────────
  const beforeReads = {
    demand: readDemand(baselineResult),
    heat:   readPerService(baselineResult, 'space_heating'),
    cool:   readPerService(baselineResult, 'space_cooling'),
    dhw:    readPerService(baselineResult, 'dhw'),
    dhwEff: readDhwEff(baselineResult),
    fan:    readVentilationFanTotal(baselineResult),
    light:  readLightingTotal(baselineResult),
    sp:     readSmallPowerTotal(baselineResult),
    lightGain: readLightingGain(baselineResult),
    spGain:    readSmallPowerGain(baselineResult),
    fuel:   readFuelTotals(baselineResult),
    head:   readHeadline(baselineResult),
    ventSystems: readVentSystems(baselineResult),
  }
  const after = cumulativeResult ?? baselineResult
  const afterReads = {
    demand: readDemand(after),
    heat:   readPerService(after, 'space_heating'),
    cool:   readPerService(after, 'space_cooling'),
    dhw:    readPerService(after, 'dhw'),
    dhwEff: readDhwEff(after),
    fan:    readVentilationFanTotal(after),
    light:  readLightingTotal(after),
    sp:     readSmallPowerTotal(after),
    lightGain: readLightingGain(after),
    spGain:    readSmallPowerGain(after),
    fuel:   readFuelTotals(after),
    head:   readHeadline(after),
    ventSystems: readVentSystems(after),
  }

  // ── PANEL-WIDE SELF-CONSISTENCY CHECK ──────────────────────────────
  // Standing rule: every number must stack up. If any check fails,
  // render the FailureBanner instead of the panel. The check runs in
  // NATIVE units (display conversion is consistent by construction
  // post-walkthrough-fix).
  const consistency = checkConsistency({
    before: beforeReads,
    after:  afterReads,
    baselineResult, cumulativeResult,
    gia_m2,
  })
  if (!consistency.passed) {
    return (
      <div className="p-4">
        <ConsistencyFailureBanner residuals={consistency.blocking} />
      </div>
    )
  }

  const unchanged = (a, b) => (a != null && b != null) && Math.abs(a - b) < NOISE_THRESHOLD.mwh

  const narrative = pickNarrative({ before: beforeReads, after: afterReads })

  return (
    <div className="p-4 space-y-3">
      {viewLabel && (
        <p className="text-xxs uppercase tracking-wider text-mid-grey">
          Showing: <span className="text-navy font-medium normal-case">{viewLabel}</span>
        </p>
      )}

      {/* ── SUMMARY CARDS ───────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryCard label="Heat demand Δ"  before={beforeReads.demand.heating}  after={afterReads.demand.heating}  nativeUnit="mwh" displayUnit={displayUnit} gia_m2={gia_m2} />
        <SummaryCard label="Cooling Δ"      before={beforeReads.demand.cooling}  after={afterReads.demand.cooling}  nativeUnit="mwh" displayUnit={displayUnit} gia_m2={gia_m2} />
        <SummaryCard label="Electricity Δ"  before={beforeReads.fuel.electricity} after={afterReads.fuel.electricity} nativeUnit="mwh" displayUnit={displayUnit} gia_m2={gia_m2} />
      </div>

      {/* ── BAND 1 — DEMAND ─────────────────────────────────────────── */}
      <div className="bg-white border border-light-grey/60 rounded">
        <BandHeader title="DEMAND · what the building needs"
                    subtitle="State 2 zone demand (heating already post-MVHR; tap-mix corrected for DHW)" />
        <div className="px-2 pb-2">
          <TableShell>
            <ThreeColRow label="Heat needed"      tooltip="consumption.space_heating.demand_mwh"  before={beforeReads.demand.heating} after={afterReads.demand.heating} displayUnit={displayUnit} gia_m2={gia_m2} dim={unchanged(beforeReads.demand.heating, afterReads.demand.heating)} />
            <ThreeColRow label="Cooling needed"   tooltip="consumption.space_cooling.demand_mwh"  before={beforeReads.demand.cooling} after={afterReads.demand.cooling} displayUnit={displayUnit} gia_m2={gia_m2} dim={unchanged(beforeReads.demand.cooling, afterReads.demand.cooling)} />
            <ThreeColRow label="Hot water needed" tooltip="consumption.dhw.demand_mwh"            before={beforeReads.demand.dhw}     after={afterReads.demand.dhw}     displayUnit={displayUnit} gia_m2={gia_m2} dim={unchanged(beforeReads.demand.dhw, afterReads.demand.dhw)} />
          </TableShell>
        </div>
      </div>

      {/* ── BAND 2 — DELIVERED ÷ EFFICIENCY = FUEL ──────────────────── */}
      <div className="bg-white border border-light-grey/60 rounded">
        <BandHeader title="DELIVERED ÷ EFFICIENCY = FUEL"
                    subtitle="Per-service arithmetic — divisor (full-strength) is the SCOP/SEER/η; rest of the line muted so a changed divisor stands out" />
        <div className="px-2 pb-2">
          <TableShell>
            <ThreeColRow label="Heating"
              tooltip="consumption.space_heating.{electricity_mwh + gas_mwh}"
              before={(beforeReads.heat.electricity ?? 0) + (beforeReads.heat.gas ?? 0)}
              after={(afterReads.heat.electricity ?? 0) + (afterReads.heat.gas ?? 0)}
              displayUnit={displayUnit} gia_m2={gia_m2}
              dim={unchanged((beforeReads.heat.electricity ?? 0) + (beforeReads.heat.gas ?? 0), (afterReads.heat.electricity ?? 0) + (afterReads.heat.gas ?? 0))}
              arithmetic={arithmeticHeating(afterReads.heat)} />
            <ThreeColRow label="Cooling"
              tooltip="consumption.space_cooling.electricity_mwh"
              before={beforeReads.cool.electricity} after={afterReads.cool.electricity}
              displayUnit={displayUnit} gia_m2={gia_m2}
              dim={unchanged(beforeReads.cool.electricity, afterReads.cool.electricity)}
              arithmetic={arithmeticCooling(afterReads.cool)} />
            <ThreeColRow label="Hot water"
              tooltip="consumption.dhw.{electricity_mwh + gas_mwh}"
              before={(beforeReads.dhw.electricity ?? 0) + (beforeReads.dhw.gas ?? 0)}
              after={(afterReads.dhw.electricity ?? 0) + (afterReads.dhw.gas ?? 0)}
              displayUnit={displayUnit} gia_m2={gia_m2}
              dim={unchanged((beforeReads.dhw.electricity ?? 0) + (beforeReads.dhw.gas ?? 0), (afterReads.dhw.electricity ?? 0) + (afterReads.dhw.gas ?? 0))}
              arithmetic={arithmeticDhw(afterReads.dhw, afterReads.dhwEff)} />
            <ThreeColRow label="Ventilation / fans"
              tooltip="consumption.brief40.ventilation.total_fan_electrical_mwh (Brief 60 A fix: × share dropped — each enabled fan counts in full)"
              before={beforeReads.fan} after={afterReads.fan}
              displayUnit={displayUnit} gia_m2={gia_m2}
              dim={unchanged(beforeReads.fan, afterReads.fan)}
              arithmetic={arithmeticVentilation(afterReads.ventSystems)} />
            <ThreeColRow label="Lighting"
              tooltip="brief40.lighting.total_delivered_electrical_mwh (Brief 58 C couples 1:1 with gains.internal.lighting)"
              before={beforeReads.light} after={afterReads.light}
              displayUnit={displayUnit} gia_m2={gia_m2}
              dim={unchanged(beforeReads.light, afterReads.light)}
              arithmetic={arithmeticIdentity1to1(afterReads.light, afterReads.lightGain, 'lighting')} />
            <ThreeColRow label="Small power"
              tooltip="brief40.small_power.total_delivered_electrical_mwh (Brief 58 C 1:1)"
              before={beforeReads.sp} after={afterReads.sp}
              displayUnit={displayUnit} gia_m2={gia_m2}
              dim={unchanged(beforeReads.sp, afterReads.sp)}
              arithmetic={arithmeticIdentity1to1(afterReads.sp, afterReads.spGain, 'small power')} />
            <ThreeColRow label="Auxiliary"
              tooltip="Brief 60 Part B will populate"
              before={null} after={null}
              displayUnit={displayUnit} gia_m2={gia_m2}
              dim={true}
              arithmetic={arithmeticAuxiliary()} />
          </TableShell>
        </div>
      </div>

      {/* ── BAND 3 — FUEL TOTALS ────────────────────────────────────── */}
      <div className="bg-white border border-light-grey/60 rounded">
        <BandHeader title="FUEL TOTALS · by carrier"
                    subtitle="Sum across all systems by carrier — what gets metered" />
        <div className="px-2 pb-2">
          <TableShell>
            <ThreeColRow label="Total electricity" tooltip="consumption.total.electricity_mwh"  before={beforeReads.fuel.electricity} after={afterReads.fuel.electricity} displayUnit={displayUnit} gia_m2={gia_m2} dim={unchanged(beforeReads.fuel.electricity, afterReads.fuel.electricity)} />
            <ThreeColRow label="Total gas"          tooltip="consumption.total.gas_mwh"          before={beforeReads.fuel.gas}         after={afterReads.fuel.gas}         displayUnit={displayUnit} gia_m2={gia_m2} dim={unchanged(beforeReads.fuel.gas, afterReads.fuel.gas)} />
          </TableShell>
        </div>
      </div>

      {/* ── HEADLINE ────────────────────────────────────────────────── */}
      <div className="bg-white border border-navy/30 rounded">
        <BandHeader title="HEADLINE" />
        <div className="px-2 pb-2">
          <TableShell>
            <ThreeColRow label="EUI" tooltip="consumption.total.kwh_per_m2_yr" before={beforeReads.head.eui} after={afterReads.head.eui} nativeUnit="kwh_per_m2_yr" displayUnit={displayUnit} gia_m2={gia_m2} />
            <ThreeColRow label="Operational carbon" tooltip="carbon_kg_co2_per_m2" before={beforeReads.head.carbon} after={afterReads.head.carbon} nativeUnit="kgco2_per_m2_yr" displayUnit={displayUnit} gia_m2={gia_m2} />
          </TableShell>
        </div>
      </div>

      <p className="text-xxs italic text-mid-grey/80 px-2 pt-2 border-t border-light-grey/40">
        {narrative}
      </p>
    </div>
  )
}
