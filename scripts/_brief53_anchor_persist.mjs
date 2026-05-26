/**
 * scripts/_brief53_anchor_persist.mjs
 *
 * REWRITTEN 2026-05-26 (Chris's "do NOT capture verification DB from
 * drifted state" instruction): persist the DOCUMENTED clean Bridgewater
 * state to the verification DB. Confirmed by _brief53_anchor_chase.mjs
 * to reproduce EUI = 128.20 EXACTLY (matches the Brief 50 close anchor).
 *
 * Three fields are reverted (this is the entire contamination footprint
 * that the stray autosave touched — see Step 3 diff in
 * docs/audit/53_anchor_drift_diagnosis.md):
 *
 *   1. v40.heating[].share_pct:    [90, 10] → [95, 5]
 *      (matches v25.heating.primary_pct = 95)
 *   2. v40.ventilation[].flow_rate: [1431, 2292, 479] → [1425, 2208, 210]
 *      (matches v25.ventilation[].flow_l_s — Brief 50 documented value)
 *   3. v40.lighting[0].control_factor: 1.00 → 0.86
 *      ("Daylight dimming" calibration value — drifted to 1.00 = no
 *      dimming during stray autosave; restoring to 0.86 returns the
 *      anchor exactly)
 *
 * Fields that are NOT reverted (these are Chris's calibration values
 * the anchor was set at, NOT library defaults):
 *   - v40.heating[0].efficiency_metric = 2.8 (library 5.12; Chris's
 *     deliberate VRF calibration value, not a drift)
 *   - v40.dhw[1].efficiency_metric = 2.5 (library 3.0; ASHP calibration)
 *   - v40.cooling[0].efficiency_metric = 3.5 (library 3.51; rounding)
 *
 * The earlier 2026-05-26 14:xx attempt that wrote efficiency_metric=5.0
 * was a fudge — one of multiple combinations that happen to produce
 * 128.20 numerically, but not the documented clean state. This is the
 * correct reconstruction.
 *
 * Refuses to write to live DB (port 8002). Targets verification only.
 */
const API = process.env.NZA_API || 'http://127.0.0.1:8003'
const PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'

if (API.includes(':8002')) {
  console.error('ABORT — refusing to write to the live DB (port 8002).')
  console.error('       Verification backend on 8003 is the only allowed target.')
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
const v40 = { ...(bc.systems_config_v40 ?? {}) }

// Snapshot the drifted values for the diff log (Step 3).
const drifted = {
  heating_shares: (v40.heating ?? []).map(s => s.share_pct),
  vent_flows:     (v40.ventilation ?? []).map(s => s.flow_rate),
  lighting_cf:    (v40.lighting ?? []).map(s => s.control_factor),
}

// ── Revert 1: heating share 90/10 → 95/5 (matches v25 primary_pct=95) ──
v40.heating = (v40.heating ?? []).map((s, i) =>
  i === 0 ? { ...s, share_pct: 95 } :
  i === 1 ? { ...s, share_pct: 5 }  : s
)

// ── Revert 2: vent flow_rate → v25 flow_l_s mirror ──────────────────
const v25Map = new Map((bc.systems_config_v25?.ventilation ?? []).map(v => [v.id ?? v.name, v]))
v40.ventilation = (v40.ventilation ?? []).map(s => {
  const v25 = v25Map.get(s.id) ?? v25Map.get(s.label)
  return v25?.flow_l_s != null ? { ...s, flow_rate: v25.flow_l_s } : s
})

// ── Revert 3: lighting control_factor 1.00 → 0.86 (daylight dimming) ──
v40.lighting = (v40.lighting ?? []).map((s, i) =>
  i === 0 ? { ...s, control_factor: 0.86 } : s
)

bc.systems_config_v40 = v40

// ── Print the diff being applied ──────────────────────────────────────
console.log('  Reverts to be applied (verification DB only):')
console.log()
console.log(`  Field 1 — v40.heating[].share_pct:`)
console.log(`    drifted:       [${drifted.heating_shares.join(', ')}]`)
console.log(`    documented:    [95, 5]`)
console.log()
console.log(`  Field 2 — v40.ventilation[].flow_rate (mirror v25 flow_l_s):`)
for (let i = 0; i < v40.ventilation.length; i++) {
  console.log(`    ${v40.ventilation[i].id.padEnd(28)} ${String(drifted.vent_flows[i]).padStart(6)} → ${String(v40.ventilation[i].flow_rate).padStart(6)} L/s`)
}
console.log()
console.log(`  Field 3 — v40.lighting[0].control_factor:`)
console.log(`    drifted:       ${drifted.lighting_cf[0]}`)
console.log(`    documented:    0.86  (daylight dimming)`)
console.log()

console.log('  PUT /api/projects/{id}/building …')
await fj(`${API}/api/projects/${PROJECT_ID}/building`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(bc),
})
console.log('  Persisted.')
console.log()
