/**
 * scripts/_brief53_contamination_diff.mjs
 *
 * Brief 53 Step 3 — log the contamination footprint of the stray
 * autosaves at 14:49 + 14:51 on 2026-05-26.
 *
 * Field-by-field diff between:
 *   LIVE   = http://127.0.0.1:8002 (drifted, EUI 131.90, untouched)
 *   CLEAN  = http://127.0.0.1:8003 (re-seeded to documented anchor, EUI 128.20)
 *
 * Surfaces every building_config field that differs. The point isn't to
 * keep the drifted values — they're gone — but to know exactly what the
 * stray autosave was capable of touching, so we know how dangerous the
 * contamination was.
 */
const LIVE_API = 'http://127.0.0.1:8002'
const CLEAN_API = 'http://127.0.0.1:8003'
const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'

async function fj(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

const live  = await fj(`${LIVE_API}/api/projects/${PROJECT_ID}`)
const clean = await fj(`${CLEAN_API}/api/projects/${PROJECT_ID}`)

// Diff utility: walks two objects + records all leaf diffs.
function diffLeaves(a, b, path = [], out = []) {
  if (a === b) return out
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') {
    out.push({ path: path.join('.'), live: a, clean: b })
    return out
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    const n = Math.max(a?.length ?? 0, b?.length ?? 0)
    for (let i = 0; i < n; i++) diffLeaves(a?.[i], b?.[i], [...path, `[${i}]`], out)
    return out
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) diffLeaves(a[k], b[k], [...path, k], out)
  return out
}

const diffs = diffLeaves(live.building_config, clean.building_config, ['building_config'])

console.log()
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log('  Brief 53 Step 3 — Contamination footprint (live :8002 ↔ clean :8003)')
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log()
console.log(`  Live   EUI: 131.90  (drifted, untouched at user request)`)
console.log(`  Clean  EUI: 128.20  (documented reconstruction; this is the verification anchor)`)
console.log()
console.log(`  Total leaf diffs: ${diffs.length}`)
console.log()

if (diffs.length === 0) {
  console.log('  (No diffs — both DBs identical. Check inputs.)')
} else {
  console.log('  Field-by-field:')
  console.log('  ─────────────────────────────────────────────────────────────────────────────')
  for (const d of diffs) {
    const liveStr = JSON.stringify(d.live)
    const cleanStr = JSON.stringify(d.clean)
    // Truncate large blobs (e.g. interventions[].patches[].value)
    const fmt = s => (s ?? '').length > 80 ? (s.slice(0, 77) + '...') : s
    console.log(`    ${d.path}`)
    console.log(`      live  = ${fmt(liveStr)}`)
    console.log(`      clean = ${fmt(cleanStr)}`)
  }
}
console.log()
console.log('═══════════════════════════════════════════════════════════════════════════════')

// Categorise diffs by area so the contamination scope is legible.
const categories = {
  heating_share:     diffs.filter(d => /systems_config_v40\.heating\.\[\d+\]\.share_pct/.test(d.path)),
  vent_flow:         diffs.filter(d => /systems_config_v40\.ventilation\.\[\d+\]\.flow_rate/.test(d.path)),
  lighting_control:  diffs.filter(d => /systems_config_v40\.lighting\.\[\d+\]\.control_factor/.test(d.path)),
  other_systems_v40: diffs.filter(d => /systems_config_v40\./.test(d.path)
                                     && !/share_pct|flow_rate|control_factor/.test(d.path)),
  systems_v25:       diffs.filter(d => /systems_config_v25/.test(d.path)),
  interventions:     diffs.filter(d => /interventions/.test(d.path)),
  other:             diffs.filter(d => !/systems_config_v40|systems_config_v25|interventions/.test(d.path)),
}

console.log()
console.log('  Categorised contamination scope:')
console.log('  ─────────────────────────────────────────────────────────────────────────────')
for (const [cat, items] of Object.entries(categories)) {
  console.log(`    ${cat.padEnd(20)}: ${items.length} field(s)`)
  for (const d of items.slice(0, 5)) {
    console.log(`      • ${d.path}  ${JSON.stringify(d.live)} → ${JSON.stringify(d.clean)}`)
  }
  if (items.length > 5) console.log(`      … +${items.length - 5} more`)
}
console.log()
