/**
 * Brief 94 Part 2 — strategy-as-references migration test (node, no test runner in repo).
 *
 * Falsifiable (brief §Part 2): N applied interventions → N library items + N ordered
 * refs, zero data loss; loading twice migrates once. Plus edge cases (disabled, empty,
 * duplicate id, stale ordered_intervention_ids ignored).
 *
 * Run: node scripts/_brief94_migration_test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  migrateStrategyRefs,
  resolveStrategyInterventions,
  hasStrategyRefs,
  makeStrategyRef,
} from '../frontend/src/utils/strategyModel.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

let pass = 0, fail = 0
const ok  = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ FAIL: ${name}`) } }

// ── Fixture: the real Bridgewater interventions state (captured from 12cf7cc4) ──
const fixture = JSON.parse(fs.readFileSync(
  path.join(REPO, 'docs/audit/fixtures/94_bridgewater_interventions.json'), 'utf-8'))
const bc = { interventions: fixture.interventions, strategies: fixture.strategies }
const N = bc.interventions.length

console.log(`\n── Fixture: Bridgewater — ${N} applied interventions ──`)
console.log(`   legacy ordered_intervention_ids (STALE): ${JSON.stringify(fixture.strategies?.[0]?.ordered_intervention_ids)}`)

const migrated = migrateStrategyRefs(bc)
const strat = migrated[0]

// ── Core falsifiable: N interventions → N ordered refs, zero data loss ──
console.log('\n── Core: lossless N→N, order + enabled preserved ──')
ok('exactly one strategy', migrated.length === 1)
ok(`N refs === N interventions (${strat.refs.length} === ${N})`, strat.refs.length === N)
ok('order preserved: refs[i].library_id === interventions[i].id',
  strat.refs.every((r, i) => r.library_id === bc.interventions[i].id))
ok('order field is 0..N-1 in sequence',
  strat.refs.every((r, i) => r.order === i))
ok('enabled preserved from each library item',
  strat.refs.every((r, i) => r.enabled === (bc.interventions[i].enabled !== false)))
ok('zero data loss: set(ref library_ids) === set(intervention ids)',
  eq([...strat.refs.map(r => r.library_id)].sort(), [...bc.interventions.map(iv => iv.id)].sort()))
ok('every ref resolves to a real library item (no ghosts)',
  strat.refs.every(r => bc.interventions.some(iv => iv.id === r.library_id)))
ok('no duplicate library_id in the strategy',
  new Set(strat.refs.map(r => r.library_id)).size === strat.refs.length)

// ── Stale ordered_intervention_ids must be IGNORED (it listed 6 with a ghost int_led) ──
console.log('\n── Stale legacy shape ignored ──')
ok('result carries NO ordered_intervention_ids (old shape not written back)',
  !('ordered_intervention_ids' in strat))
ok('ghost id int_led (in legacy list, not in library) is absent from refs',
  !strat.refs.some(r => r.library_id === 'int_led'))
ok('interventions dropped from legacy list are still present (Occupancy 2 / Air perm 1.9 / New)',
  ['int_021d8687-4e7b-4015-a12d-b08cff955310',
   'int_9e8760d5-711c-4c9a-b3fb-8ff9a31a15b7',
   'int_3279a9c9-a690-4310-9236-9df96dec2bc2'].every(id => strat.refs.some(r => r.library_id === id)))
ok('strategy id/name preserved from prior', strat.id === 'strategy_default' && strat.name === 'Strategy 1')

// ── Idempotent: loading twice migrates once ──
console.log('\n── Idempotent (load twice migrates once) ──')
const bc2 = { interventions: bc.interventions, strategies: migrated }
const migrated2 = migrateStrategyRefs(bc2)
ok('already-refs bc returns strategies unchanged (same reference)', migrated2 === migrated)
ok('double-migrate deep-equals single-migrate', eq(migrateStrategyRefs(bc2), migrated))
ok('hasStrategyRefs true after migration, false before',
  hasStrategyRefs(bc2) === true && hasStrategyRefs({ interventions: bc.interventions, strategies: [] }) === false)

// ── Library untouched (definitions own their params) ──
console.log('\n── Library untouched ──')
ok('interventions array identity unchanged', bc2.interventions === bc.interventions)
ok('interventions content unchanged', eq(bc.interventions, fixture.interventions))

// ── Canonical read path resolves ordered, enabled-annotated library items ──
console.log('\n── resolveStrategyInterventions (Rule 11 read path) ──')
const resolved = resolveStrategyInterventions(bc)
ok(`resolves N items (${resolved.length} === ${N})`, resolved.length === N)
ok('resolved order matches interventions order',
  resolved.every((r, i) => r.id === bc.interventions[i].id))
ok('resolved items carry enabled + params (label present)',
  resolved.every(r => 'enabled' in r && 'label' in r && 'patches' in r))

// ── Synthetic edge cases ──
console.log('\n── Synthetic edge cases ──')
ok('empty interventions → empty refs',
  migrateStrategyRefs({ interventions: [], strategies: [] })[0].refs.length === 0)
const withDisabled = { interventions: [
  { id: 'a', enabled: true }, { id: 'b', enabled: false }, { id: 'c' } ], strategies: [] }
const md = migrateStrategyRefs(withDisabled)[0].refs
ok('disabled intervention → ref.enabled false; missing enabled → true',
  md[0].enabled === true && md[1].enabled === false && md[2].enabled === true)
const withDup = { interventions: [{ id: 'x' }, { id: 'x' }, { id: 'y' }], strategies: [] }
ok('duplicate library_id de-duped to first occurrence',
  eq(migrateStrategyRefs(withDup)[0].refs.map(r => r.library_id), ['x', 'y']))
ok('makeStrategyRef normalises enabled (0/false → false, undefined → true)',
  makeStrategyRef('z').enabled === true && makeStrategyRef('z', false).enabled === false)

console.log(`\n${'─'.repeat(48)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
