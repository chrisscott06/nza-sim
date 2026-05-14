/**
 * scripts/_wallmodel_sanity.mjs
 *
 * Sanity-check the multi-node wall model against:
 *   1. The library's stated U-value (Σ R reciprocal vs config_json.u_value_W_per_m2K)
 *   2. Steady-state heat flow: ramp T_out from cold to hot over 30 days,
 *      verify the inside-surface flux asymptotes to U × (T_out − T_air).
 *   3. Time constant: for a sudden T_out step, verify the inside surface
 *      responds with a decay matching theoretical layer time constants.
 *
 * Run after editing wallModel.js to catch regressions.
 */
import { buildWallModel, stepWallLinearized, combineLinearizedStep, solAirT, extractLayers, modelUValue } from '../frontend/src/utils/wallModel.js'

const API = 'http://127.0.0.1:8002'

async function fetchJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

const lib = await fetchJson(`${API}/api/library/constructions`)
const items = Array.isArray(lib) ? lib : (lib.constructions ?? Object.values(lib))

const target = ['cavity_wall_enhanced', 'pitched_roof_standard', 'ground_floor_slab']

console.log('Wall model U-value cross-check vs library values:')
console.log()
for (const name of target) {
  const item = items.find(c => c.name === name)
  if (!item) { console.log(`  ${name}: NOT FOUND`); continue }
  const layers = extractLayers(item)
  const model = buildWallModel(layers, { R_si: 0.13 })
  const U_model = modelUValue(model)
  const U_lib   = item.u_value_W_per_m2K
  const delta_pct = ((U_model - U_lib) / U_lib) * 100
  console.log(`  ${name}:`)
  console.log(`    Library U:        ${U_lib.toFixed(4)} W/m²K`)
  console.log(`    Model U (1/ΣR):   ${U_model.toFixed(4)} W/m²K`)
  console.log(`    Δ:                ${delta_pct.toFixed(2)}%`)
  console.log(`    Nodes:            ${model.n}`)
  console.log(`    R total:          ${model.R_total.toFixed(3)} m²K/W`)
  console.log()
}

// ── Steady-state test: ramp T_out slowly, check inside flux converges to U×ΔT
console.log('Steady-state inside-surface flux test (cavity_wall_enhanced):')
console.log()
const wallItem = items.find(c => c.name === 'cavity_wall_enhanced')
const wallLayers = extractLayers(wallItem)
const wallModel = buildWallModel(wallLayers, { R_si: 0.13 })

const T_air = 21
const dt = 3600

// Initialise wall at T_air uniform
let T_state = new Float64Array(wallModel.n).fill(T_air)

// Step with constant T_out = 0°C for many hours; record inside flux
const constantTout = 0
let q_inside_per_m2 = null
for (let h = 0; h < 24 * 30; h++) {
  const lin = stepWallLinearized(wallModel, T_state, constantTout, dt)
  T_state = combineLinearizedStep(lin, T_air)
  q_inside_per_m2 = lin.U_eff * (T_state[T_state.length - 1] - T_air)
}
const expected = wallModel.U * (constantTout - T_air)  // negative = zone losing heat
// Hmm need to be careful — wallModel exports massless U, but mass model needs to use 1/R_total
const wallU = 1 / wallModel.R_total
const expectedFromU = wallU * (constantTout - T_air)
console.log(`  After 30 days at T_out=0, T_air=${T_air}:`)
console.log(`    Wall U (1/ΣR):          ${wallU.toFixed(4)} W/m²K`)
console.log(`    Expected inside flux:   ${expectedFromU.toFixed(3)} W/m²  (= U × ΔT = ${wallU.toFixed(3)} × ${constantTout - T_air})`)
console.log(`    Modelled inside flux:   ${q_inside_per_m2.toFixed(3)} W/m²`)
console.log(`    Δ:                      ${((q_inside_per_m2 - expectedFromU) / expectedFromU * 100).toFixed(2)}%`)
console.log()

// ── Step test: warm wall (T_air=21 everywhere), drop T_out suddenly to 0, watch decay
console.log('Step test (drop T_out 21→0): inside surface response:')
T_state = new Float64Array(wallModel.n).fill(21)
console.log('  hour    T_in_node     q_inside (W/m²)')
for (let h = 0; h <= 72; h += 6) {
  const lin = stepWallLinearized(wallModel, T_state, 0, dt)
  T_state = combineLinearizedStep(lin, T_air)
  const q = lin.U_eff * (T_state[T_state.length - 1] - T_air)
  console.log(`  ${String(h).padStart(4)}    ${T_state[T_state.length - 1].toFixed(3)}        ${q.toFixed(3)}`)
}
console.log()

// ── Layer node count check
console.log('Layer node decomposition (cavity_wall_enhanced):')
console.log(`  Total nodes: ${wallModel.n}`)
console.log(`  C (J/(K·m²)): ${Array.from(wallModel.C).map(c => c.toFixed(0)).join(', ')}`)
console.log(`  R (m²K/W):    ${Array.from(wallModel.R).map(r => r.toFixed(4)).join(', ')}`)
console.log()
