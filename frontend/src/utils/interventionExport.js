/**
 * interventionExport.js — Brief 100 P3.
 *
 * Exports the whole Interventions Library to a single XLSX workbook (4 sheets):
 *   Summary    — one row/intervention: metrics (EUI Δ, energy Δ, lifetime carbon,
 *                £/tonne, annual saving, payback, capex) + class/flag + off-model.
 *   Calc trail — per intervention: per-service demand baseline→post→Δ (all six
 *                services) + per-fuel electricity/gas + total delivered.
 *   Cost plans — per intervention: every cost line (group/line/qty/unit/rate/total)
 *                + the on-costs summary.
 *   Narratives — label + the plain-language "how it works" narrative + off-model basis.
 *
 * Metrics come from computeInterventionMetrics (the SAME helper the isolated view uses)
 * so the workbook can't drift from the screen. Download via the Blob+anchor pattern
 * (mirrors ChartPrintModal) — no backend, CSP-safe.
 */
import * as XLSX from 'xlsx'
import { computeInterventionMetrics, interventionFlag } from './interventionMetrics.js'

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : '')
const r0 = (v) => (Number.isFinite(v) ? Math.round(v) : '')

/** Build the 4-sheet workbook (pure — no DOM; testable in node). */
export function buildInterventionsWorkbook({ interventions = [], isolatedRows = [], projectDefaults = null, gia = 0 }) {
  const rowById = Object.fromEntries((isolatedRows || []).map((r) => [r.id, r]))
  const wb = XLSX.utils.book_new()

  // ── Sheet 1: Summary ───────────────────────────────────────────────────────
  const summary = interventions.map((iv) => {
    const d = rowById[iv.id]?.cumulativeDelta ?? null
    const m = computeInterventionMetrics(iv, d, projectDefaults, gia)
    return {
      'Label': iv.label,
      'Class / flag': m.flag,
      'Theme': iv.theme || '',
      'Off-model': m.isOffModel ? 'yes' : '',
      'EUI Δ (kWh/m²)': r1(m.euiDelta),
      'Energy Δ (MWh/yr)': r1(m.deliveredMwhDelta),
      // Emissions CHANGE (negative = reduction), same sign convention as EUI Δ /
      // Energy Δ and the on-screen card. lifeTco2e is tonnes SAVED (positive), so negate.
      'Lifetime carbon Δ (tCO₂e)': Number.isFinite(m.lifeTco2e) ? r1(-m.lifeTco2e) : '',
      '£ / tonne CO₂': m.poundsPerTonne != null ? r0(m.poundsPerTonne) : '',
      'Annual saving (£/yr)': r0(m.annualSaving || 0),
      'Payback (yr)': m.payback != null ? r1(m.payback) : '',
      'Capex (£)': r0(m.costTotal || 0),
    }
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary')

  // ── Sheet 2: Calc trail (per-service demand + per-fuel) ────────────────────
  const calc = []
  for (const iv of interventions) {
    const d = rowById[iv.id]?.cumulativeDelta ?? null
    const ps = d?.per_service || {}
    const line = (metric, rec) => calc.push({
      'Label': iv.label, 'Metric': metric,
      'Baseline (MWh)': r1(rec?.from), 'Post (MWh)': r1(rec?.to),
      'Δ (MWh)': r1(rec?.delta), 'Δ%': r1(rec?.delta_pct),
    })
    line('Heating demand', d?.heating_demand_mwh)
    line('Cooling demand', d?.cooling_demand_mwh)
    line('DHW demand', ps.dhw?.demand_mwh)
    line('Ventilation demand', ps.ventilation?.demand_mwh)
    line('Lighting', ps.lighting?.delivered_mwh)
    line('Small power', ps.small_power?.delivered_mwh)
    line('Electricity (delivered)', d?.per_fuel?.electricity_mwh)
    line('Gas (delivered)', d?.per_fuel?.gas_mwh)
    line('Total delivered energy', d?.total_delivered_mwh)
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(calc), 'Calc trail')

  // ── Sheet 3: Cost plans (lines + on-costs) ─────────────────────────────────
  const costRows = []
  for (const iv of interventions) {
    for (const g of (iv.cost?.groups || [])) {
      for (const l of (g.lines || [])) {
        costRows.push({
          'Label': iv.label, 'Group': g.name, 'Line item': l.name,
          'Qty': l.quantity, 'Unit': l.unit, 'Rate (£)': l.rate,
          'Line total (£)': (Number(l.quantity) || 0) * (Number(l.rate) || 0),
        })
      }
    }
    const oc = iv.cost?.on_costs || {}
    costRows.push({
      'Label': iv.label, 'Group': '(on-costs)',
      'Line item': `contingency ${oc.contingency_pct || 0}% · fees ${oc.design_fees_pct || 0}% · prelims ${oc.prelims_pct || 0}% · OHP ${oc.ohp_pct || 0}% · inflation ${oc.inflation_pct || 0}%`,
    })
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(costRows), 'Cost plans')

  // ── Sheet 4: Narratives ────────────────────────────────────────────────────
  const narr = interventions.map((iv) => ({
    'Label': iv.label, 'Class / flag': interventionFlag(iv),
    'How this works (energy + cost)': iv.notes || '',
    'Off-model basis': iv.off_model?.basis || '',
  }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(narr), 'Narratives')
  return wb
}

/** Build + trigger a browser download of the interventions workbook. */
export function exportInterventionsXlsx({ interventions = [], isolatedRows = [], projectDefaults = null, gia = 0, projectName = 'project' }) {
  const wb = buildInterventionsWorkbook({ interventions, isolatedRows, projectDefaults, gia })

  // ── Download ───────────────────────────────────────────────────────────────
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${String(projectName || 'project').replace(/[^a-z0-9]+/gi, '_')}_interventions.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(a.href)
}
