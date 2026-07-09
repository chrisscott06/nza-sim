/**
 * _brief97_ashp_acceptance.mjs — Brief 97 P5 worked-example acceptance.
 *
 * Builds the design note's ASHP retrofit cost plan from line items and asserts
 * the NRM2 roll-up matches £95,941 exactly (Brief 91 design note §"What changed",
 * node-verified in docs/audit/91_cost_plan_builder.md §3). This is the canonical
 * acceptance; Brief 97 P5.4's "4 × ASHP @ £14k" phrasing is illustrative
 * ("to the region of").
 *
 * Run: node scripts/_brief97_ashp_acceptance.mjs
 */
import {
  newGroup, newLine, computeGroupSubtotal, computeLinesTotal,
  computeOnCostsBreakdown, computeCostPlanTotal,
} from '../frontend/src/utils/costModel.js'

let failures = 0
const eq = (name, got, want, tol = 0) => {
  const ok = Math.abs(got - want) <= tol
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got £${got.toLocaleString('en-GB')} want £${want.toLocaleString('en-GB')}`)
  if (!ok) failures++
}

const cost = {
  groups: [
    newGroup({ name: 'Enabling works', lines: [
      newLine({ name: 'Strip out & dispose existing gas boilers', quantity: 2, unit: 'nr', rate: 1200 }),
      newLine({ name: 'Decommission gas supply', quantity: 1, unit: 'item', rate: 800 }),
    ] }),
    newGroup({ name: 'Main equipment', lines: [
      newLine({ name: 'ASHP unit 60kW', quantity: 2, unit: 'nr', rate: 18000 }),
      newLine({ name: 'Buffer vessel 500L', quantity: 1, unit: 'nr', rate: 2200 }),
    ] }),
    newGroup({ name: 'Installation', lines: [
      newLine({ name: 'Primary pipework alterations', quantity: 45, unit: 'm', rate: 140 }),
      newLine({ name: 'Controls upgrade', quantity: 1, unit: 'item', rate: 4500 }),
      newLine({ name: 'Commissioning', quantity: 60, unit: 'hr', rate: 85 }),
    ] }),
    newGroup({ name: "Builder's work in connection", lines: [
      newLine({ name: 'Penetrations & making good', quantity: 1, unit: 'sum', rate: 4200 }),
    ] }),
  ],
  // on_costs null → project defaults (12 / 10 / 8 / 15 / 5)
  on_costs: { design_fees_pct: null, prelims_pct: null, ohp_pct: null, contingency_pct: null, inflation_pct: null },
  template_origin: null, notes: '',
}

eq('Enabling works subtotal', computeGroupSubtotal(cost.groups[0]), 3200)
eq('Main equipment subtotal', computeGroupSubtotal(cost.groups[1]), 38200)
eq('Installation subtotal',   computeGroupSubtotal(cost.groups[2]), 15900)
eq('BWIC subtotal',           computeGroupSubtotal(cost.groups[3]), 4200)
eq('lines total',             computeLinesTotal(cost), 61500)

const b = computeOnCostsBreakdown(cost, null)
eq('design fees @12%', b.design_fees, 7380)
eq('prelims @10%',     b.prelims, 6150)
eq('OHP @8%',          b.ohp, 4920)
eq('subtotal w/ works', b.subtotal_with_works, 79950)
eq('contingency @15%', b.contingency, 11993, 1)
eq('inflation @5%',    b.inflation, 3998, 1)
eq('TOTAL',            computeCostPlanTotal(cost, null), 95941, 1)

console.log(`\n${failures === 0 ? 'ALL PASS — ASHP worked example = £95,941' : failures + ' FAILURE(S)'}`)
process.exit(failures === 0 ? 0 : 1)
