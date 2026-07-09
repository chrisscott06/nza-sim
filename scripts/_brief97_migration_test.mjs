/**
 * _brief97_migration_test.mjs — Brief 97 P4 falsifiable.
 *
 * Proves the Brief 90 → Brief 91/97 cost migration is LOSSLESS and IDEMPOTENT:
 *   - the Brief 90 DHW demo headline (£215,040) migrates to the grouped
 *     line-item model summing to £215,040 (±£1);
 *   - migrating twice equals migrating once (load-twice migrates once).
 *
 * Pure engine code, no backend/DB. Run:
 *   node scripts/_brief97_migration_test.mjs
 */
import {
  migrateCostShape, computeCostPlanTotal, computeLinesTotal,
} from '../frontend/src/utils/costModel.js'

let failures = 0
const assert = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  if (!cond) failures++
}

// ── The Brief 90 DHW demo headline (docs/audit/90_nrm2_cost_model.md §Part 2):
// equipment 120,000 + installation 30,000 + additional 10,000 (works 160,000)
// + derived design 13,440 + delivery 5,760 + contingency 35,840 = 215,040.
const B90 = {
  cost: {
    mode: 'headline',
    headline: {
      design_engineering:         13440,
      equipment:                  120000,
      installation_commissioning: 30000,
      additional_measures:        10000,
      project_delivery:           5760,
      contingency:                35840,
    },
  },
}
const HEADLINE_SUM = Object.values(B90.cost.headline).reduce((s, v) => s + v, 0)
assert('headline sums to £215,040', HEADLINE_SUM === 215040, `got ${HEADLINE_SUM}`)

// ── Migrate once ──────────────────────────────────────────────────────────────
const once = migrateCostShape(B90)
const totalOnce = computeCostPlanTotal(once.cost)          // no project defaults: migrated on_costs are 0
assert('migrated shape is grouped (cost.groups array)', Array.isArray(once.cost.groups))
assert('single migrated group', once.cost.groups.length === 1, `${once.cost.groups.length} groups`)
assert('6 non-zero headline lines carried', once.cost.groups[0].lines.length === 6,
  `${once.cost.groups[0].lines.length} lines`)
assert('migrated on_costs all zero (no double on-costing)',
  Object.values(once.cost.on_costs).every(v => v === 0))
assert('lossless: computeCostPlanTotal == £215,040 (±£1)', Math.abs(totalOnce - 215040) <= 1,
  `got £${totalOnce.toLocaleString('en-GB')}`)
assert('lines total == £215,040 (on-costs are 0)', Math.abs(computeLinesTotal(once.cost) - 215040) <= 1,
  `got £${computeLinesTotal(once.cost).toLocaleString('en-GB')}`)

// ── Idempotency: migrate the already-migrated shape ─────────────────────────────
const twice = migrateCostShape(once)
const totalTwice = computeCostPlanTotal(twice.cost)
assert('idempotent: re-migrate is a no-op (same object)', twice === once)
assert('idempotent: total still £215,040', Math.abs(totalTwice - 215040) <= 1,
  `got £${totalTwice.toLocaleString('en-GB')}`)

// ── Absent / already-new costs pass through untouched ──────────────────────────
assert('no-cost intervention passes through', migrateCostShape({ id: 'x' }).cost === undefined)
const already = { cost: { groups: [], on_costs: {}, template_origin: null, notes: '' } }
assert('already-new-shape passes through unchanged', migrateCostShape(already) === already)

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`)
process.exit(failures === 0 ? 0 : 1)
