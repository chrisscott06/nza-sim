/**
 * scripts/_brief55_part5_conflicts.mjs
 *
 * Brief 55 Part 5 verification — confirm `computeFieldConflicts` finds
 * the legacy Bridgewater same-field collisions and correctly flags the
 * "likely capture artefact" cases.
 *
 * On Bridgewater (verification DB :8003 with Brief 55 Part 2 migration
 * applied at load-time), the two enabled interventions:
 *   • "MVHR Bedrooms" → migrated to field-level patches including
 *     heating[id=...18672].share_pct = 90  ← unintended (capture artefact)
 *     heating[id=...24675].share_pct = 10  ← unintended
 *   • "VRF 4.0"       → migrated to:
 *     heating[id=...18672].efficiency_metric = 4
 *     heating[id=...18672].share_pct = 100
 *     heating[id=...24675].share_pct = ... (or remove)
 *
 * Expected conflict detection:
 *   - heating[id=...18672].share_pct: MVHR (90) vs VRF (100) — likely
 *     artefact on MVHR (label="MVHR Bedrooms", path=heating service)
 *   - heating[id=...24675].share_pct: MVHR (10) vs VRF (...) — also
 *     likely artefact on MVHR
 *
 * Read-only — runs the in-memory migration + analysis only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrateInterventionPatches } from '../frontend/src/utils/interventionsEngine.js'

// Inlined from InterventionStackView.jsx (Node can't import JSX directly).
// Keep behavior in sync with the JSX source.
function _isLikelyArtefact(intvLabel, patchPath) {
  if (typeof intvLabel !== 'string' || typeof patchPath !== 'string') return false
  const label = intvLabel.toLowerCase()
  const m = patchPath.match(/systems_config_v\d+\.(heating|cooling|dhw|ventilation|lighting|small_power)/)
  if (!m) return false
  const fieldService = m[1]
  const labelService =
      /mvhr|vent|hre|extract|airflow|fan/.test(label) ? 'ventilation'
    : /vrf|ashp|scop|boiler|heat\b|heating/.test(label) ? 'heating'
    : /cool/.test(label)                          ? 'cooling'
    : /dhw|hot water/.test(label)                 ? 'dhw'
    : /light/.test(label)                         ? 'lighting'
    : /small power|appliance/.test(label)         ? 'small_power'
    : null
  if (labelService == null) return false
  return labelService !== fieldService
}
function computeFieldConflicts(interventions) {
  const interventionHasConflict = new Set()
  const patchConflicts = new Map()
  if (!Array.isArray(interventions)) return { interventionHasConflict, patchConflicts }
  const pathOwners = new Map()
  for (const intv of interventions) {
    if (!intv || intv.enabled === false) continue
    const patches = Array.isArray(intv.patches) ? intv.patches : []
    for (const p of patches) {
      if (!p || (p.op !== 'set' && p.op !== 'replace')) continue
      if (!p.path) continue
      const owners = pathOwners.get(p.path) ?? []
      owners.push({ intvId: intv.id, intvLabel: intv.label ?? '(unnamed)', patchId: p.id, value: p.value })
      pathOwners.set(p.path, owners)
    }
  }
  for (const [pathStr, owners] of pathOwners) {
    if (owners.length < 2) continue
    for (let i = 0; i < owners.length - 1; i++) {
      const self = owners[i]
      const later = owners[i + 1]
      interventionHasConflict.add(self.intvId)
      patchConflicts.set(self.patchId, {
        interventionId: self.intvId,
        otherInterventionId: later.intvId,
        otherInterventionLabel: later.intvLabel,
        otherValue: later.value,
        likelyArtefact: _isLikelyArtefact(self.intvLabel, pathStr),
      })
    }
  }
  return { interventionHasConflict, patchConflicts }
}

const API = process.env.NZA_API || 'http://127.0.0.1:8003'
const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

// Suppress React import resolution since we only need computeFieldConflicts
// (which is a pure function in the JSX module — node can resolve it).
async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(url); return r.json() }

const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const baseline = { systems_config_v40: project.building_config.systems_config_v40 }

// Migrate the on-disk interventions to v3 (in-memory only).
const migrated = (project.building_config.interventions ?? []).map(intv => {
  const from = Number.isInteger(intv?.schema_version) ? intv.schema_version : 1
  return migrateInterventionPatches(intv, from, 3, baseline)
})

const { interventionHasConflict, patchConflicts } = computeFieldConflicts(migrated)

console.log()
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log('  Brief 55 Part 5 — Field-level conflict detection (Bridgewater legacy data)')
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log()
console.log(`  Interventions on Bridgewater (post-migration):`)
for (const intv of migrated) {
  const flag = interventionHasConflict.has(intv.id) ? '⚠' : '✓'
  console.log(`    ${flag} "${intv.label}" — ${intv.patches?.length ?? 0} patches`)
}
console.log()
console.log(`  Field-level conflicts found: ${patchConflicts.size}`)
console.log()

let artefactCount = 0
let realCount = 0
const conflicts = []
for (const intv of migrated) {
  for (const p of (intv.patches ?? [])) {
    const c = patchConflicts.get(p.id)
    if (!c) continue
    conflicts.push({ intv: intv.label, path: p.path, thisValue: p.value, ...c })
    if (c.likelyArtefact) artefactCount++; else realCount++
  }
}

console.log('  Conflicts:')
console.log('  ─────────────────────────────────────────────────────────────────────────────')
for (const c of conflicts) {
  const flag = c.likelyArtefact ? '⚠ ARTEFACT  ' : '✗ CONFLICT  '
  console.log(`    ${flag} "${c.intv}" sets`)
  console.log(`        ${c.path}`)
  console.log(`        value=${JSON.stringify(c.thisValue)}  (other: "${c.otherInterventionLabel}" sets ${JSON.stringify(c.otherValue)})`)
}
console.log()
console.log(`  Summary: ${artefactCount} likely artefact(s), ${realCount} other conflict(s)`)
console.log()

// Acceptance: we expect AT LEAST ONE artefact conflict on MVHR's
// heating[18672].share_pct edit (the one Chris called out in Part 2
// debrief).
const hasExpectedArtefact = conflicts.some(c =>
  c.intv === 'MVHR Bedrooms' && /heating.*share_pct/.test(c.path) && c.likelyArtefact
)
console.log(`  ${hasExpectedArtefact ? '✓' : '✗'} Expected artefact found: MVHR Bedrooms vs VRF 4.0 on heating[…].share_pct`)
console.log()

// JSON dump
const out = path.join(REPO_ROOT, 'docs/audit/55_part5_conflicts.json')
fs.writeFileSync(out, JSON.stringify({
  intervention_with_conflict: [...interventionHasConflict],
  conflicts,
  summary: { artefacts: artefactCount, real: realCount, total: conflicts.length },
  expected_artefact_found: hasExpectedArtefact,
}, null, 2))
console.log(`  JSON: ${path.relative(REPO_ROOT, out)}`)
process.exitCode = hasExpectedArtefact ? 0 : 1
