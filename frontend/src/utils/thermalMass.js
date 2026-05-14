/**
 * frontend/src/utils/thermalMass.js
 *
 * Brief 26.1 Part 5 — thermal mass derivation from construction layers.
 *
 * Replaces the Brief 26 Part 7 "Light/Medium/Heavy" dropdown with a
 * value derived from the actual construction stack. Per Part 1 of this
 * brief the library is 100% complete (every layer has thickness +
 * density + specific_heat), so the derivation is feasible without
 * library housekeeping.
 *
 * Methodology (matches `scripts/state1_library_audit.py`):
 *   1. For each construction, identify the principal insulation layer
 *      (highest R-value, or conductivity < 0.05 W/mK).
 *   2. Sum thermal mass (thickness × density × specific_heat) of layers
 *      on the INDOOR side of the insulation.
 *   3. Express as kJ/(K·m²) of construction surface area.
 *
 * Library layer-order convention quirk: walls + roofs are stored
 * OUTSIDE-first; ground floors are stored INDOOR-first (library bug
 * #6 in docs/state_1_divergences.md). This module compensates by
 * reading the construction `type` field and reversing the "inside" side
 * for floor-type constructions.
 *
 * Total building C_mass (J/K) = Σ(per-construction mass × that
 * construction's surface area). The live engine consumes this number
 * directly as C_mass_J — NO further multiplication by GIA (the per-GIA
 * normalisation in the old dropdown path was per-m² of GIA, not per-m²
 * of construction surface; mixing them double-counts).
 *
 * Verification target: HIX Bridgewater derived 138 kWh/K (= 497 MJ/K),
 * vs Brief 26's default 'light' lumped value of 77 kWh/K. 1.8× more.
 */

// CIBSE TM52 thermal-mass categories — kJ/(K·m²) of construction surface
// area. Bands match the legacy dropdown values from Brief 26 Part 7
// (80 / 160 / 280 kJ/K/m²-GIA), reinterpreted here per-surface for
// consistency with derivation.
export const TM52_BAND = {
  light:  [0, 120],
  medium: [120, 220],
  heavy:  [220, Infinity],
}

export function categoriseMass(kJ_per_m2K) {
  for (const [cat, [lo, hi]] of Object.entries(TM52_BAND)) {
    if (kJ_per_m2K >= lo && kJ_per_m2K < hi) return cat
  }
  return 'heavy'
}

/** Read the ordered list of layer names from a Construction object. */
function layerOrder(epjson, constructionName) {
  const c = (epjson?.Construction ?? {})[constructionName]
  if (!c) return []
  const layers = []
  if (c.outside_layer) layers.push(c.outside_layer)
  for (let i = 2; i <= 10; i++) {
    const n = c[`layer_${i}`]
    if (n) layers.push(n)
  }
  return layers
}

/**
 * Compute the effective indoor-facing thermal mass of a single
 * construction, in kJ/(K·m²) of construction surface area.
 *
 * Returns { mass_kJ_per_m2K, category, layers, insulation_idx, inside_layers, outside_layers }
 * or { mass_kJ_per_m2K: 0, ... } for glazing / undefined / malformed inputs.
 */
export function deriveConstructionMass(constructionItem) {
  const empty = {
    mass_kJ_per_m2K: 0, category: 'light',
    layers: [], insulation_idx: null,
    inside_layers: [], outside_layers: [],
  }
  if (!constructionItem) return empty

  const cfg = constructionItem.config_json ?? {}
  const epjson = cfg?.epjson ?? {}
  const ctype = (constructionItem.type ?? cfg?.type ?? '').toLowerCase()

  // The library list endpoint (Brief 26.1 Part 5) returns layer data as a
  // top-level `layers` array, ordered outside→inside (or indoor-first for
  // floors per the library convention). The detail endpoint and any code
  // that hands us a raw library_items.config_json row still has the full
  // epjson nested form. Support both.
  //
  // Brief 28a Part 5 walkthrough Finding HB1 root-cause (2026-05-14):
  // also accept `config_json.layers` for the case where a consumer wraps
  // the raw library row inside `config_json` (e.g. useStateComparison's
  // shape after the wrap pattern). Otherwise the C_mass derivation
  // silently falls through to the empty-layers branch and the engine
  // diverges between consumers that wrap vs. don't.
  let rawLayers = constructionItem.layers ?? constructionItem.config_json?.layers
  if (!rawLayers || !Array.isArray(rawLayers)) {
    const ordered = layerOrder(epjson, constructionItem.name ?? cfg?.name)
    const materials = epjson.Material ?? {}
    const nomass = epjson['Material:NoMass'] ?? {}
    rawLayers = ordered.map(ln => {
      if (materials[ln]) {
        return { name: ln, kind: 'Material', ...materials[ln] }
      }
      if (nomass[ln]) {
        return { name: ln, kind: 'Material:NoMass', thermal_resistance: nomass[ln].thermal_resistance ?? null }
      }
      return { name: ln, kind: 'MISSING' }
    })
  }

  // Glazing has no opaque mass term — by Part 1 convention.
  const isGlazing = ctype === 'glazing' ||
    Object.keys(epjson?.WindowMaterial ?? {}).length > 0 ||
    Object.keys(epjson?.['WindowMaterial:SimpleGlazingSystem'] ?? {}).length > 0 ||
    rawLayers.length === 0
  if (isGlazing) return { ...empty, isGlazing: true }

  // Normalise to internal layer record shape regardless of source.
  const layers = rawLayers.map(ly => ({
    name: ly.name,
    kind: ly.kind ?? 'Material',
    thickness_m: ly.thickness ?? ly.thickness_m ?? null,
    conductivity_WmK: ly.conductivity ?? ly.conductivity_WmK ?? null,
    density_kgm3: ly.density ?? ly.density_kgm3 ?? 0,
    specific_heat_JkgK: ly.specific_heat ?? ly.specific_heat_JkgK ?? 0,
    R_m2K_W: ly.thermal_resistance ?? ly.R_m2K_W ?? null,
  }))

  // Identify principal insulation layer — highest R, with conductivity
  // hint < 0.05 W/mK as a tiebreaker.
  let insulation_idx = null
  let best_R = -1
  layers.forEach((ly, i) => {
    const t = ly.thickness_m ?? 0
    const cond = ly.conductivity_WmK ?? 0
    const R = (cond > 0 && t) ? t / cond : (ly.R_m2K_W ?? 0)
    if (R > best_R) {
      best_R = R
      insulation_idx = i
    }
  })

  // Split inside/outside based on construction type.
  // - wall/roof: layers are stored OUTSIDE-first → inside is AFTER insulation
  // - floor:     layers are stored INDOOR-first  → inside is BEFORE insulation
  // (See divergences §6 for library convention quirk.)
  const isFloor = ctype === 'floor' || ctype === 'ground_floor'
  let inside_layers = []
  let outside_layers = []
  if (insulation_idx === null) {
    outside_layers = layers
  } else if (isFloor) {
    inside_layers = layers.slice(0, insulation_idx)
    outside_layers = layers.slice(insulation_idx)
  } else {
    inside_layers = layers.slice(insulation_idx + 1)
    outside_layers = layers.slice(0, insulation_idx + 1)
  }

  const layerMass = (ly) => {
    const t = ly.thickness_m ?? 0
    const rho = ly.density_kgm3 ?? 0
    const cp = ly.specific_heat_JkgK ?? 0
    return (t * rho * cp) / 1000  // → kJ/(K·m²)
  }
  const mass = inside_layers.reduce((s, ly) => s + layerMass(ly), 0)

  return {
    mass_kJ_per_m2K: Math.round(mass * 10) / 10,
    category: categoriseMass(mass),
    layers, insulation_idx, inside_layers, outside_layers,
    isGlazing: false,
  }
}

/**
 * Compute total building thermal mass from the chosen construction stack +
 * envelope geometry. Returns the C_mass in J/K consumable by the live
 * engine, plus per-element breakdown for display.
 *
 *   building          — ProjectContext params (geometry + wwr)
 *   constructions     — ProjectContext construction_choices
 *                       { external_wall, roof, ground_floor, glazing }
 *   libraryData       — { constructions: [...] } from /api/library/constructions
 *
 * Returns:
 *   {
 *     total_J_per_K, total_Wh_per_K, total_kJ_per_m2K_GIA,
 *     by_element: { external_wall, roof, ground_floor: { area_m2, mass_kJ_per_m2K, total_kJ_per_K, category } },
 *     effective_category,
 *     ok: true | false
 *   }
 *
 * If a required construction isn't assigned or can't be resolved, falls
 * back to the legacy thermal_mass_category × GIA path on the affected
 * element. ok=false flags incomplete input.
 */
export function deriveBuildingMass(building, constructions, libraryData) {
  const length = Number(building?.length ?? 0)
  const width = Number(building?.width ?? 0)
  const nf = Number(building?.num_floors ?? 0)
  const fh = Number(building?.floor_height ?? 0)
  const wwr = building?.wwr ?? {}

  // Areas — opaque envelope facing indoor air.
  const gross_wall = 2 * (length + width) * fh * nf
  const glaz_total =
      length * fh * nf * Number(wwr.north ?? 0)
    + length * fh * nf * Number(wwr.south ?? 0)
    + width  * fh * nf * Number(wwr.east  ?? 0)
    + width  * fh * nf * Number(wwr.west  ?? 0)
  const wall_opaque = Math.max(0, gross_wall - glaz_total)
  const roof_area = length * width
  const ground_area = length * width
  const gia = length * width * nf || 1

  const lib = libraryData?.constructions ?? []
  const byName = new Map(lib.map(c => [c.name, c]))

  function elementMass(elementKey) {
    const chosenName = constructions?.[elementKey]
    const item = byName.get(chosenName)
    if (!item) return null
    const d = deriveConstructionMass(item)
    return {
      construction_name: chosenName,
      mass_kJ_per_m2K: d.mass_kJ_per_m2K,
      category: d.category,
      detail: d,
    }
  }

  const wallElement = elementMass('external_wall')
  const roofElement = elementMass('roof')
  const floorElement = elementMass('ground_floor')

  const by_element = {
    external_wall: {
      area_m2: Math.round(wall_opaque),
      ...wallElement,
      total_kJ_per_K: wallElement ? wallElement.mass_kJ_per_m2K * wall_opaque : 0,
    },
    roof: {
      area_m2: Math.round(roof_area),
      ...roofElement,
      total_kJ_per_K: roofElement ? roofElement.mass_kJ_per_m2K * roof_area : 0,
    },
    ground_floor: {
      area_m2: Math.round(ground_area),
      ...floorElement,
      total_kJ_per_K: floorElement ? floorElement.mass_kJ_per_m2K * ground_area : 0,
    },
  }

  const total_kJ_per_K =
      by_element.external_wall.total_kJ_per_K
    + by_element.roof.total_kJ_per_K
    + by_element.ground_floor.total_kJ_per_K
  const total_J_per_K = total_kJ_per_K * 1000
  const total_Wh_per_K = total_J_per_K / 3600
  const total_kJ_per_m2K_GIA = total_kJ_per_K / gia

  return {
    ok: !!(wallElement && roofElement && floorElement),
    total_J_per_K,
    total_Wh_per_K,
    total_kJ_per_K,
    total_kJ_per_m2K_GIA: Math.round(total_kJ_per_m2K_GIA * 10) / 10,
    by_element,
    effective_category: categoriseMass(total_kJ_per_m2K_GIA),
  }
}

/**
 * Resolve the C_mass (Wh/K, ready for the live engine's two-node loop)
 * to use for this building. Honours the new `thermal_mass_mode`:
 *   'auto'      (default) → derived from constructions
 *   'override'           → use thermal_mass_category × GIA, like Brief 26
 *
 * If mode='auto' but derivation isn't possible (constructions not chosen,
 * library not loaded), falls back to the override path so the live engine
 * always has a defensible number.
 */
const THERMAL_MASS_J_PER_K_PER_M2_GIA = {
  light:   80_000,
  medium:  160_000,
  heavy:   280_000,
}

export function resolveCmass(building, constructions, libraryData) {
  const mode = building?.thermal_mass_mode ?? 'auto'
  const gia = Math.max(1, Number(building?.length ?? 0) * Number(building?.width ?? 0) * Number(building?.num_floors ?? 0))

  if (mode === 'auto') {
    const derived = deriveBuildingMass(building, constructions, libraryData)
    if (derived.ok && derived.total_J_per_K > 0) {
      return {
        C_mass_J: derived.total_J_per_K,
        C_mass_Wh: derived.total_Wh_per_K,
        source: 'derived',
        derived,
      }
    }
    // Fallback when derivation can't run yet (no library loaded etc.)
  }

  const cat = building?.thermal_mass_category ?? 'light'
  const per_m2K = THERMAL_MASS_J_PER_K_PER_M2_GIA[cat] ?? THERMAL_MASS_J_PER_K_PER_M2_GIA.light
  const C_mass_J = per_m2K * gia
  return {
    C_mass_J,
    C_mass_Wh: C_mass_J / 3600,
    source: mode === 'auto' ? 'fallback' : 'override',
    category: cat,
  }
}
