/**
 * scripts/_brief55_part4_badge_precision.mjs
 *
 * Brief 55 Part 4 verification — PatchedInputBadge precision + per-field
 * change flags after the field-level patch migration.
 *
 * VERIFICATION (per Chris): print the truth table for the badge
 * predicate against a representative set of patch/badge combinations.
 * Inspection-based — the falsifiability statement is "badges highlight
 * ONLY the changed field"; this fixture demonstrates that.
 *
 * Two predicates exercised:
 *   1. `useHasPatchOnPath`-style — exact + reverse-prefix
 *      (patch covers badge by being a parent path)
 *   2. `EditorNav.patchOwnerSubsection` — routes a patch to a
 *      specific Systems section (heating / cooling / dhw / ventilation
 *      / lighting / small_power)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

// Mirror of useProjectMutation.useHasPatchOnPath matching logic (the
// predicate inside the useMemo). Pure function — same rule applied
// per patch.
function patchMatchesBadge(patchPath, badgePath) {
  if (typeof patchPath !== 'string' || typeof badgePath !== 'string') return false
  if (patchPath === badgePath) return true                        // exact
  if (badgePath.startsWith(patchPath + '.')) return true          // patch covers badge (legacy whole-object)
  return false
}

// Mirror of EditorNav.patchOwnerSubsection (Systems-only here for brevity).
function patchOwnerSubsection(p) {
  if (p.startsWith('building.systems_config_v40.heating'))     return 'systems.heating'
  if (p.startsWith('building.systems_config_v40.cooling'))     return 'systems.cooling'
  if (p.startsWith('building.systems_config_v40.dhw'))         return 'systems.dhw'
  if (p.startsWith('building.systems_config_v40.ventilation')) return 'systems.ventilation'
  if (p.startsWith('building.systems_config_v40.lighting'))    return 'systems.lighting'
  if (p.startsWith('building.systems_config_v40.small_power')) return 'systems.small_power'
  if (p === 'building.systems_config_v40') return 'systems.heating'  // legacy default
  return null
}

console.log()
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log('  Brief 55 Part 4 — Badge precision verification (truth table)')
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log()

// ── Truth table A: field-level patch → which badges fire? ──────────
//
// Realistic scenario: user edits ONE field, "set heating[id=X].efficiency_metric = 4".
// Question: which badges in the editor pop-out light up?
//
// Expectation (Brief 55 falsifiability #7): the heating[X].efficiency_metric
// badge — and ONLY that — should fire. Sibling fields, other systems,
// other services must all read FALSE.
console.log('  TRUTH TABLE A — single field-level patch')
console.log('  ─────────────────────────────────────────────────────────────────────────────')
const patch_A = 'building.systems_config_v40.heating[id=sys_heat_1].efficiency_metric'
console.log(`  Captured patch: ${patch_A}`)
console.log()
console.log('    Badge path                                                            fires?  expected')
console.log('    ────────────────────────────────────────────────────────────────────  ─────  ─────────')
const tableA = [
  // Exact match — must fire
  [patch_A,                                                                                'YES'],
  // Sibling field in same system — must NOT fire
  ['building.systems_config_v40.heating[id=sys_heat_1].share_pct',                        'NO'],
  ['building.systems_config_v40.heating[id=sys_heat_1].enabled',                          'NO'],
  // Different system in same service — must NOT fire
  ['building.systems_config_v40.heating[id=sys_heat_2].efficiency_metric',                'NO'],
  // Different service — must NOT fire
  ['building.systems_config_v40.ventilation[id=vent_1].flow_rate',                        'NO'],
  ['building.systems_config_v40.cooling[id=sys_cool_1].efficiency_metric',                'NO'],
  // Parent path — must NOT fire (parent badges don't reflect deep child changes)
  ['building.systems_config_v40.heating',                                                  'NO'],
  ['building.systems_config_v40',                                                          'NO'],
  // Service-level field in same v40 — must NOT fire
  ['building.systems_config_v40.heating_setpoint_mode',                                    'NO'],
  // Unrelated branch — must NOT fire
  ['building.infiltration_ach',                                                            'NO'],
]
let passCountA = 0
for (const [badge, expected] of tableA) {
  const fired = patchMatchesBadge(patch_A, badge)
  const ok = (fired ? 'YES' : 'NO') === expected
  if (ok) passCountA++
  const truncated = badge.length > 68 ? badge.slice(0, 65) + '...' : badge.padEnd(68)
  console.log(`    ${truncated}  ${(fired ? 'YES' : 'NO').padEnd(5)}  ${expected.padEnd(5)}  ${ok ? '✓' : '✗'}`)
}
console.log()
console.log(`    Table A: ${passCountA}/${tableA.length} expected outcomes match`)
console.log()

// ── Truth table B: nested-object leaf patch (vent efficiency_metric) ───
//
// Ventilation's efficiency_metric is itself an object — the diff utility
// recurses into it. So a patch at
//   ...vent[id=X].efficiency_metric.recovery_sensible_pct
// is the leaf for the recovery_sensible_pct input. The
// efficiency_metric.sfp_w_per_lps input (sibling at the SAME object
// level) must NOT light up.
console.log('  TRUTH TABLE B — nested-object leaf patch (vent.efficiency_metric.X)')
console.log('  ─────────────────────────────────────────────────────────────────────────────')
const patch_B = 'building.systems_config_v40.ventilation[id=vent_1].efficiency_metric.recovery_sensible_pct'
console.log(`  Captured patch: ${patch_B}`)
console.log()
console.log('    Badge path                                                            fires?  expected')
console.log('    ────────────────────────────────────────────────────────────────────  ─────  ─────────')
const tableB = [
  [patch_B,                                                                                  'YES'],
  // Sibling nested leaf — must NOT fire
  ['building.systems_config_v40.ventilation[id=vent_1].efficiency_metric.sfp_w_per_lps',     'NO'],
  ['building.systems_config_v40.ventilation[id=vent_1].efficiency_metric.recovery_latent_pct','NO'],
  // Same-system sibling at vent root — must NOT fire
  ['building.systems_config_v40.ventilation[id=vent_1].flow_rate',                           'NO'],
  ['building.systems_config_v40.ventilation[id=vent_1].share_pct',                           'NO'],
  // Parent of patch (the whole efficiency_metric object) — must NOT fire
  ['building.systems_config_v40.ventilation[id=vent_1].efficiency_metric',                   'NO'],
  // Different vent system — must NOT fire
  ['building.systems_config_v40.ventilation[id=vent_2].efficiency_metric.recovery_sensible_pct','NO'],
]
let passCountB = 0
for (const [badge, expected] of tableB) {
  const fired = patchMatchesBadge(patch_B, badge)
  const ok = (fired ? 'YES' : 'NO') === expected
  if (ok) passCountB++
  const truncated = badge.length > 68 ? badge.slice(0, 65) + '...' : badge.padEnd(68)
  console.log(`    ${truncated}  ${(fired ? 'YES' : 'NO').padEnd(5)}  ${expected.padEnd(5)}  ${ok ? '✓' : '✗'}`)
}
console.log()
console.log(`    Table B: ${passCountB}/${tableB.length} expected outcomes match`)
console.log()

// ── Truth table C: legacy whole-object patch (back-compat) ─────────
//
// Before Brief 55 Part 2 migration runs, a saved project may carry a
// `set` patch on `building.systems_config_v40` with the entire v40 as
// value. Until the migration converts it to field-level patches, badges
// at any v40 sub-control SHOULD light up (via prefix-match) so the UI
// at least signals "something changed" — even if it can't tell which
// specific field.
console.log('  TRUTH TABLE C — legacy whole-object patch (back-compat fallback)')
console.log('  ─────────────────────────────────────────────────────────────────────────────')
const patch_C = 'building.systems_config_v40'
console.log(`  Captured patch (legacy whole-object): ${patch_C}`)
console.log()
console.log('    Badge path                                                            fires?  expected')
console.log('    ────────────────────────────────────────────────────────────────────  ─────  ─────────')
const tableC = [
  [patch_C,                                                                                'YES'],
  // Any v40 sub-control — must fire (prefix-match back-compat)
  ['building.systems_config_v40.heating[id=sys_heat_1].efficiency_metric',                'YES'],
  ['building.systems_config_v40.ventilation[id=vent_1].efficiency_metric.sfp_w_per_lps',  'YES'],
  ['building.systems_config_v40.heating_setpoint_mode',                                    'YES'],
  // Outside v40 — must NOT fire
  ['building.infiltration_ach',                                                            'NO'],
  ['constructions.external_wall',                                                          'NO'],
]
let passCountC = 0
for (const [badge, expected] of tableC) {
  const fired = patchMatchesBadge(patch_C, badge)
  const ok = (fired ? 'YES' : 'NO') === expected
  if (ok) passCountC++
  const truncated = badge.length > 68 ? badge.slice(0, 65) + '...' : badge.padEnd(68)
  console.log(`    ${truncated}  ${(fired ? 'YES' : 'NO').padEnd(5)}  ${expected.padEnd(5)}  ${ok ? '✓' : '✗'}`)
}
console.log()
console.log(`    Table C: ${passCountC}/${tableC.length} expected outcomes match`)
console.log()

// ── Truth table D: EditorNav section routing for field-level patches ─
console.log('  TRUTH TABLE D — EditorNav.patchOwnerSubsection (per-field flag plumbing)')
console.log('  ─────────────────────────────────────────────────────────────────────────────')
console.log()
console.log('    Patch path                                                            → subsection')
console.log('    ────────────────────────────────────────────────────────────────────  ─────────────────')
const tableD = [
  ['building.systems_config_v40.heating[id=X].efficiency_metric',     'systems.heating'],
  ['building.systems_config_v40.heating[id=X].share_pct',             'systems.heating'],
  ['building.systems_config_v40.cooling[id=X].efficiency_metric',     'systems.cooling'],
  ['building.systems_config_v40.dhw[id=X].share_pct',                 'systems.dhw'],
  ['building.systems_config_v40.ventilation[id=X].flow_rate',         'systems.ventilation'],
  ['building.systems_config_v40.ventilation[id=X].efficiency_metric.sfp_w_per_lps', 'systems.ventilation'],
  ['building.systems_config_v40.lighting[id=X].control_factor',       'systems.lighting'],
  ['building.systems_config_v40.small_power[id=X].control_factor',    'systems.small_power'],
  ['building.systems_config_v40.heating_setpoint_mode',               'systems.heating'],
  ['building.systems_config_v40',                                     'systems.heating'],  // legacy default
]
let passCountD = 0
for (const [patchPath, expectedSub] of tableD) {
  const actual = patchOwnerSubsection(patchPath)
  const ok = actual === expectedSub
  if (ok) passCountD++
  const truncated = patchPath.length > 68 ? patchPath.slice(0, 65) + '...' : patchPath.padEnd(68)
  console.log(`    ${truncated}  ${(actual ?? 'null').padEnd(17)}  ${ok ? '✓' : '✗'}`)
}
console.log()
console.log(`    Table D: ${passCountD}/${tableD.length} expected routings match`)
console.log()

const totalPass = passCountA + passCountB + passCountC + passCountD
const totalTests = tableA.length + tableB.length + tableC.length + tableD.length
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log(`  Overall: ${totalPass}/${totalTests} predicate outcomes correct`)
console.log('═══════════════════════════════════════════════════════════════════════════════')

const out = path.join(REPO_ROOT, 'docs/audit/55_part4_badge_precision.json')
fs.writeFileSync(out, JSON.stringify({
  tableA: { passes: passCountA, total: tableA.length },
  tableB: { passes: passCountB, total: tableB.length },
  tableC: { passes: passCountC, total: tableC.length },
  tableD: { passes: passCountD, total: tableD.length },
  total: { passes: totalPass, total: totalTests },
}, null, 2))
console.log(`  JSON: ${path.relative(REPO_ROOT, out)}`)
process.exitCode = totalPass === totalTests ? 0 : 1
