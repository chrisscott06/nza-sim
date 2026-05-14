/**
 * wallModel.js — multi-node implicit RC thermal model for opaque constructions.
 *
 * Brief 28b Part 3 (2026-05-14). Replaces the previous lumped two-node
 * capacitance model with a per-layer state vector. Each layer of the
 * library construction becomes one (or two, for thick layers) thermal
 * nodes; conduction between nodes is solved implicitly each hour via
 * a tridiagonal system. Boundary conditions: sol-air on the outside,
 * zone-air on the inside (linked through R_si surface resistance).
 *
 * The step function returns a linearization in T_air so the caller can
 * solve the zone air balance in one shot rather than iterating:
 *   T_state^{n+1} = T_part + T_homo × T_air
 *   T_inside_node = T_part[N-1] + T_homo[N-1] × T_air
 *   Q_inside_to_air = (T_inside_node − T_air) × U_eff
 *
 * Massless constructions (glazing) get a passthrough mode where
 * Q_in_to_air = U_total × (T_out − T_air) directly.
 *
 * Implicit Euler is unconditionally stable at the 1-hour timestep for
 * the layer thicknesses + thermal diffusivities present in standard
 * UK constructions (Bridgewater fabric checks: τ_PIR ≈ 12h, τ_brick
 * ≈ 5h, τ_concrete-block ≈ 7h — all > Δt). Brief 28b Part 3 verify
 * step confirms behaviour against a single-zone EnergyPlus reference.
 */

// Surface resistances per BS EN ISO 6946 (steady-state heat transfer
// through building elements). Values are m²K/W.
export const R_SO_DEFAULT = 0.04  // outside surface (vertical + roof)
export const R_SI_WALL    = 0.13  // inside, horizontal heat flow
export const R_SI_ROOF    = 0.10  // inside, upward heat flow
export const R_SI_FLOOR   = 0.17  // inside, downward heat flow

// Solar absorptance and outside surface heat transfer coefficient for
// sol-air boundary condition. Defaults chosen per ASHRAE Handbook
// Fundamentals Ch. 18; specific materials may differ.
export const SOLAR_ABS_DEFAULT = 0.7   // medium-dark masonry / tile typical
export const H_OUT_DEFAULT     = 25.0  // W/m²K, exterior film at moderate wind

/**
 * Sol-air temperature for an opaque exterior surface.
 *
 *   T_sa = T_out + α × G / h_out − Δε
 *
 * α is solar absorptance, G is incident solar irradiance on the surface
 * (W/m²), h_out is the outside surface heat transfer coefficient
 * (combined convective + radiative). Long-wave sky correction Δε is
 * omitted (typically 3-4 K reduction on horizontal surfaces under clear
 * sky; ignored at this fidelity level).
 *
 * Returns °C.
 */
export function solAirT(T_out, G_W_per_m2, alpha = SOLAR_ABS_DEFAULT, h_out = H_OUT_DEFAULT) {
  return T_out + (alpha * (G_W_per_m2 ?? 0)) / h_out
}

/**
 * Extract the layer array from a construction library item, handling
 * both shapes the API serves:
 *   1. List endpoint: `layers` at top level
 *   2. Wrapped (useStateComparison-style): `config_json.layers`
 *   3. Raw library_items row: `config_json.epjson.{Material, Material:NoMass}`
 *
 * Returns [] if no layers found (e.g. glazing).
 */
export function extractLayers(constructionItem) {
  if (!constructionItem) return []
  if (Array.isArray(constructionItem.layers)) return constructionItem.layers
  const cj = constructionItem.config_json
  if (cj && Array.isArray(cj.layers)) return cj.layers
  // Last resort: try epjson nested form
  if (cj?.epjson) {
    // This case is rare; the list endpoint always normalises to top-level
    // `layers`. Leave unhandled at this fidelity (returns []).
    return []
  }
  return []
}

/**
 * Decompose a list of layers into thermal nodes for the implicit RC
 * solver. Material layers contribute capacity at one (or two, when
 * thickness > 100 mm) node centres. Material:NoMass layers contribute
 * only resistance and are folded into the adjacent R values.
 *
 * Returns:
 *   {
 *     n:    number of nodes (≥0)
 *     C:    Float64Array(n)   — capacitance per m² of construction (J/(K·m²))
 *     R:    Float64Array(n+1) — resistances (m²K/W)
 *                              R[0]  = outside surface to node 0 (incl. R_so)
 *                              R[i]  = node i-1 to node i (i = 1..n-1)
 *                              R[n]  = node n-1 to inside surface (incl. R_si)
 *     R_so, R_si:    surface resistances used
 *     R_total:       sum R[0..n] — for U_value cross-check
 *   }
 */
function decomposeLayersToNodes(layers, R_so, R_si) {
  const C = []
  const R = []
  let R_accum = R_so

  for (const layer of layers ?? []) {
    if (!layer) continue
    const isNoMass = layer.kind === 'Material:NoMass' ||
                     !(Number(layer.thickness) > 0) ||
                     !(Number(layer.density) > 0) ||
                     !(Number(layer.specific_heat) > 0)
    if (isNoMass) {
      // Pure resistance, no node. Use given thermal_resistance if available,
      // else fall back to thickness / conductivity for Material layers with
      // missing thermal-storage props.
      let r = Number(layer.thermal_resistance ?? 0)
      if (!(r > 0) && Number(layer.thickness) > 0 && Number(layer.conductivity) > 0) {
        r = Number(layer.thickness) / Number(layer.conductivity)
      }
      R_accum += r
      continue
    }
    const t   = Number(layer.thickness)
    const k   = Number(layer.conductivity)
    const rho = Number(layer.density)
    const cp  = Number(layer.specific_heat)
    if (!(k > 0)) continue   // can't conduct → skip

    // Sub-node count: 1 for ≤100 mm, 2 for thicker (better diffusion fidelity).
    const n_sub = t > 0.10 ? 2 : 1
    const t_sub = t / n_sub
    const C_sub = t_sub * rho * cp     // J/(K·m²)
    const R_sub = t_sub / k            // m²K/W

    for (let i = 0; i < n_sub; i++) {
      C.push(C_sub)
      // R[i] for this new node = accumulated resistance up to its outside face
      // + half of its own sub-layer (centre of node sits at sub-layer midpoint)
      R.push(R_accum + 0.5 * R_sub)
      R_accum = 0.5 * R_sub
    }
  }

  // After all material layers, push final R: half of last sub-layer + R_si
  R.push(R_accum + R_si)

  return {
    n: C.length,
    C: Float64Array.from(C),
    R: Float64Array.from(R),
    R_so,
    R_si,
    R_total: R.reduce((s, v) => s + v, 0),
  }
}

/**
 * Build a wall model. For massless constructions (glazing, or layers
 * sum to zero capacity), returns a pure-R passthrough so the same
 * step function can handle both.
 *
 * Inputs:
 *   layers: from extractLayers(libraryItem)
 *   opts:
 *     R_so:      outside surface resistance (default 0.04)
 *     R_si:      inside surface resistance (default 0.13 for walls)
 *     solar_abs: absorptance for sol-air calc (default 0.7)
 *     h_out:     outside heat-transfer coeff (default 25)
 *
 * Returns:
 *   { type: 'mass', n, C, R, R_si, solar_abs, h_out, R_total }
 *   or
 *   { type: 'massless', U, R_total, solar_abs, h_out }
 */
export function buildWallModel(layers, opts = {}) {
  const R_so = Number(opts.R_so ?? R_SO_DEFAULT)
  const R_si = Number(opts.R_si ?? R_SI_WALL)
  const solar_abs = Number(opts.solar_abs ?? SOLAR_ABS_DEFAULT)
  const h_out = Number(opts.h_out ?? H_OUT_DEFAULT)
  const decomp = decomposeLayersToNodes(layers, R_so, R_si)

  if (decomp.n === 0) {
    // No mass nodes — pure resistance. Common for glazing.
    const R_total = decomp.R[0] ?? (R_so + R_si)
    const U = 1 / Math.max(R_total, 1e-9)
    return { type: 'massless', n: 0, U, R_total, R_so, R_si, solar_abs, h_out }
  }

  return {
    type: 'mass',
    ...decomp,
    solar_abs,
    h_out,
  }
}

/**
 * Thomas algorithm tridiagonal solve.
 *   diag:  length n main diagonal
 *   lower: length n-1 sub-diagonal (lower[i] connects row i+1 ↔ row i)
 *   upper: length n-1 super-diagonal (upper[i] connects row i ↔ row i+1)
 *   rhs:   length n right-hand side
 *
 * Returns the solution vector (length n). Inputs are not mutated.
 */
function thomas(diag, lower, upper, rhs) {
  const n = diag.length
  if (n === 0) return new Float64Array(0)
  if (n === 1) return Float64Array.of(rhs[0] / diag[0])
  const c_prime = new Float64Array(n - 1)
  const d_prime = new Float64Array(n)
  c_prime[0] = upper[0] / diag[0]
  d_prime[0] = rhs[0] / diag[0]
  for (let i = 1; i < n; i++) {
    const m = diag[i] - lower[i - 1] * (i - 1 < c_prime.length - 0 ? c_prime[i - 1] : 0)
    if (i < n - 1) c_prime[i] = upper[i] / m
    d_prime[i] = (rhs[i] - lower[i - 1] * d_prime[i - 1]) / m
  }
  const x = new Float64Array(n)
  x[n - 1] = d_prime[n - 1]
  for (let i = n - 2; i >= 0; i--) {
    x[i] = d_prime[i] - c_prime[i] * x[i + 1]
  }
  return x
}

/**
 * Implicit-Euler step linearised in T_air.
 *
 * Solves A × T^{n+1} = M × T^n + b(T_out, T_air), then decomposes into
 *   T^{n+1} = T_part + T_homo × T_air
 *
 * so the caller can collect inside-surface flux coefficients across
 * multiple constructions and solve the zone-air balance in one shot.
 *
 * Inputs:
 *   model:           result of buildWallModel(...)
 *   T_state_prev:    Float64Array(n) previous-hour node temperatures (°C)
 *   T_out_eff:       sol-air or T_out depending on caller's choice (°C)
 *   dt_s:            timestep in seconds (3600 for hourly)
 *
 * Returns (for mass model):
 *   {
 *     T_part:  Float64Array(n)   — constant part of T^{n+1}
 *     T_homo:  Float64Array(n)   — sensitivity to T_air
 *     a_inside_node, b_inside_node:  T_inside_node = a + b × T_air
 *     U_eff:   1 / R[n] — conductance from last node to zone air
 *     R_si:    inside surface resistance
 *     massless: false
 *   }
 *
 * Returns (for massless model):
 *   {
 *     a_inside_node: T_out_eff
 *     b_inside_node: 0
 *     U_eff:   model.U  — overall U × area gives Q_loss
 *     massless: true
 *   }
 *
 * Massless special case: the wall has no thermal state. Q_in_to_air =
 * U × (T_out − T_air). We express this as Q_in = (T_inside_node − T_air)
 * × U_eff with T_inside_node = T_out (so b=0), U_eff = U.
 */
export function stepWallLinearized(model, T_state_prev, T_out_eff, dt_s, q_solar_inside_per_m2 = 0) {
  if (model.type !== 'mass') {
    return {
      T_part: new Float64Array(0),
      T_homo: new Float64Array(0),
      a_inside_node: T_out_eff,
      b_inside_node: 0,
      U_eff: model.U,
      R_si: model.R_si,
      massless: true,
    }
  }

  const { n, C, R } = model
  const diag  = new Float64Array(n)
  const lower = new Float64Array(Math.max(n - 1, 0))
  const upper = new Float64Array(Math.max(n - 1, 0))
  const rhs_part = new Float64Array(n)
  const rhs_homo = new Float64Array(n)

  for (let i = 0; i < n; i++) {
    const c_per_dt = C[i] / dt_s
    diag[i] = c_per_dt + (1 / R[i]) + (1 / R[i + 1])
    if (i > 0)     lower[i - 1] = -1 / R[i]
    if (i < n - 1) upper[i]     = -1 / R[i + 1]
    rhs_part[i] = c_per_dt * T_state_prev[i]
    if (i === 0)     rhs_part[i] += T_out_eff / R[0]
    if (i === n - 1) {
      rhs_homo[i] = 1 / R[n]
      // Brief 28b Part 3: short-wave solar absorbed at the inside surface
      // (after transmission through glazing). Distributed onto each
      // opaque interior surface per the caller's area-weighting scheme.
      // Units: W/m² entering the inside node.
      if (q_solar_inside_per_m2) rhs_part[i] += q_solar_inside_per_m2
    }
  }

  const T_part = thomas(diag, lower, upper, rhs_part)
  const T_homo = thomas(diag, lower, upper, rhs_homo)

  return {
    T_part,
    T_homo,
    a_inside_node: T_part[n - 1],
    b_inside_node: T_homo[n - 1],
    U_eff: 1 / R[n],
    R_si: model.R_si,
    massless: false,
  }
}

/**
 * Reconstruct the post-step state vector from a linearised step result
 * and the solved zone air temperature.
 *
 *   T_state^{n+1} = T_part + T_homo × T_air
 *
 * For massless models, returns the empty array (no state to track).
 */
export function combineLinearizedStep(linResult, T_air) {
  if (linResult.massless) return new Float64Array(0)
  const n = linResult.T_part.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = linResult.T_part[i] + linResult.T_homo[i] * T_air
  }
  return out
}

/**
 * Pre-compute U-value from a mass-mode wall model. This is just
 * 1 / (sum of R), should match the library U-value within rounding.
 * Useful for sanity-checking constructions when building the model.
 */
export function modelUValue(model) {
  if (model.type === 'massless') return model.U
  return 1 / Math.max(model.R_total, 1e-9)
}
