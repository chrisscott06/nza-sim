// Unit tests for the relative patch ops (interventions-fix brief B1/D1).
// Standalone Node harness (repo has no vitest/jest — matches the existing
// scripts/validate_engine.mjs convention). Asserts scale/delta arithmetic,
// nested/index/id-match path resolution, and fail-loud path-miss behaviour.
//   node scripts/_interventions_ops_test.mjs
import { applyPatch } from '../frontend/src/utils/interventionsEngine.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error(`  FAIL: ${name}`) } }
const throws = (name, fn) => {
  try { fn(); fail++; console.error(`  FAIL: ${name} — expected throw, none thrown`) }
  catch { pass++ }
}
const cfg = () => ({
  building: {
    x: 100,
    fabric: { air_permeability_q50: 4.64 },
    systems_config_v40: {
      heating: [{ id: 'h0', efficiency_metric: 2.8 }],
      dhw: [{ id: 'g', share_pct: 60 }, { id: 'a', efficiency_metric: 2.8 }],
      dhw_demand_litres_per_person_per_day: 57.57,
    },
    label: 'text',
  },
})

// scale — factor multiply
ok('scale ×0.8', applyPatch(cfg(), { op: 'scale', path: 'building.x', value: 0.8 }).building.x === 80)
ok('scale ×1.25', Math.abs(applyPatch(cfg(), { op: 'scale', path: 'building.systems_config_v40.dhw_demand_litres_per_person_per_day', value: 0.805 }).building.systems_config_v40.dhw_demand_litres_per_person_per_day - 57.57 * 0.805) < 1e-9)
// delta — additive
ok('delta +0.4', Math.abs(applyPatch(cfg(), { op: 'delta', path: 'building.systems_config_v40.dhw[1].efficiency_metric', value: 0.4 }).building.systems_config_v40.dhw[1].efficiency_metric - 3.2) < 1e-9)
ok('delta -1 (widen setpoint style)', applyPatch(cfg(), { op: 'delta', path: 'building.x', value: -1 }).building.x === 99)
// index + id-match path resolution
ok('scale via [index]', applyPatch(cfg(), { op: 'scale', path: 'building.systems_config_v40.heating[0].efficiency_metric', value: 2 }).building.systems_config_v40.heating[0].efficiency_metric === 5.6)
ok('delta via [id=]', Math.abs(applyPatch(cfg(), { op: 'delta', path: 'building.systems_config_v40.dhw[id=a].efficiency_metric', value: 0.4 }).building.systems_config_v40.dhw[1].efficiency_metric - 3.2) < 1e-9)
// immutability — input config never mutated
const c0 = cfg(); applyPatch(c0, { op: 'scale', path: 'building.x', value: 0.5 }); ok('input not mutated', c0.building.x === 100)
// FAIL LOUD — path miss throws (both ops)
throws('scale on missing path throws', () => applyPatch(cfg(), { op: 'scale', path: 'building.nope.deep', value: 0.5 }))
throws('delta on missing array id throws', () => applyPatch(cfg(), { op: 'delta', path: 'building.systems_config_v40.dhw[id=zzz].efficiency_metric', value: 1 }))
throws('scale on non-numeric current throws', () => applyPatch(cfg(), { op: 'scale', path: 'building.label', value: 2 }))
throws('delta with non-numeric operand throws', () => applyPatch(cfg(), { op: 'delta', path: 'building.x', value: 'abc' }))
// regression — set still overwrites, add still works
ok('set still overwrites', applyPatch(cfg(), { op: 'set', path: 'building.x', value: 7 }).building.x === 7)
ok('set on missing path is graceful (unchanged)', applyPatch(cfg(), { op: 'set', path: 'building.nope.deep', value: 7 }).building.x === 100)

console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}`)
process.exit(fail ? 1 : 0)
