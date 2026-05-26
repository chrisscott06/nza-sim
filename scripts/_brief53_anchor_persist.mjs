/**
 * scripts/_brief53_anchor_persist.mjs
 *
 * Persist the anchor-restoring values to the VERIFICATION DB (:8003).
 *
 * The anchor-chase probe found:
 *   - v40 heating[0].efficiency_metric: 2.8 → 5.0
 *   - v40 ventilation flow_rate: drifted values → v25 flow_l_s mirror
 *   yields EUI = 128.20 exactly on Bridgewater.
 *
 * This script PUTs those changes to the verification DB ONLY.
 * The live DB (port 8002) is NOT touched.
 *
 * Run once. After persisting, Brief 53 verification probes default-read
 * 128.20 as the anchor.
 */
const API = process.env.NZA_API || 'http://127.0.0.1:8003'
const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'

// Safety: refuse to write to live DB. The verification backend (8003) was set up
// with NZA_DB_FILE=nza_sim_cc.db; anything else and we abort.
if (API.includes(':8002')) {
  console.error('ABORT — refusing to write to the live DB (port 8002).')
  console.error('       Set NZA_API to the verification backend (8003) or omit (defaults to 8003).')
  process.exit(2)
}

async function fj(url, opts = {}) {
  const r = await fetch(url, opts)
  if (!r.ok) throw new Error(`${url} → ${r.status} ${r.statusText}\n${await r.text()}`)
  return r.status === 204 ? null : r.json()
}

console.log()
console.log(`  Reading project from ${API} …`)
const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const bc = { ...project.building_config }

// 1) Restore v40 heating[0].efficiency_metric: 2.8 → 5.0
const v40 = { ...(bc.systems_config_v40 ?? {}) }
v40.heating = (v40.heating ?? []).map((s, i) =>
  i === 0 ? { ...s, efficiency_metric: 5.0 } : s
)

// 2) Restore v40 ventilation flow_rate to mirror v25 flow_l_s
const v25Map = new Map((bc.systems_config_v25?.ventilation ?? []).map(v => [v.id ?? v.name, v]))
v40.ventilation = (v40.ventilation ?? []).map(s => {
  const v25 = v25Map.get(s.id) ?? v25Map.get(s.label)
  return v25?.flow_l_s != null ? { ...s, flow_rate: v25.flow_l_s } : s
})

bc.systems_config_v40 = v40

console.log('  Diff to be applied:')
console.log(`    v40 heating[0].efficiency_metric: ${project.building_config.systems_config_v40.heating[0]?.efficiency_metric} → 5.0`)
for (const [i, v] of v40.ventilation.entries()) {
  const orig = project.building_config.systems_config_v40.ventilation[i]?.flow_rate
  console.log(`    v40 ventilation[${i}].flow_rate ("${v.id}"): ${orig} → ${v.flow_rate}`)
}
console.log()

console.log('  PUT /api/projects/{id}/building …')
await fj(`${API}/api/projects/${PROJECT_ID}/building`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(bc),
})
console.log('  Persisted.')
console.log()
console.log('  Now re-running the anchor-chase probe to confirm "As-stored" reads 128.20…')
console.log()
