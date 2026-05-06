/**
 * firstPrinciples.js
 *
 * Compute order-of-magnitude expected heat flows from raw inputs only,
 * no engine. Used by the HeatBalance drill-down to compare:
 *   first-principles  vs  instantCalc  vs  EnergyPlus
 * If all three agree → confidence in inputs. If first-principles diverges
 * from instantCalc → likely JS bug. If both frontends diverge from
 * EnergyPlus → real dynamic effect or epJSON generation issue.
 *
 * All formulae deliberately simple; full-detail dynamics are EnergyPlus's job.
 */

import { SOLAR_BY_COMPASS, getSolarRadiation } from './instantCalc.js'

// UK averages — annual heating-degree-hours (base 15.5°C × 24 h/day × 365 d/yr)
// Backend's HDD uses 18°C base; this is a rough approximation. For a precise
// match the consumer can pass a custom HDH via opts.
const UK_HDH_18C = 52800   // 2200 K·d × 24 — approximate

const DEFAULT_U_VALUES = {
  external_wall: 0.28,
  roof:          0.18,
  ground_floor:  0.22,
  glazing:       1.40,
}
const DEFAULT_G_VALUE = 0.42
const AIR_HEAT_CAPACITY = 0.33   // kWh/m³/K (ρ × cp for air)

// ── Geometry helpers (mirror computeGeometry in instantCalc) ─────────────────

function computeAreas(building) {
  const L  = Number(building?.length || 0)
  const W  = Number(building?.width || 0)
  const nf = Number(building?.num_floors || 0)
  const fh = Number(building?.floor_height || 0)
  const wwr = building?.wwr || {}

  const perimH = nf * fh
  const faceLen = { north: L, south: L, east: W, west: W }
  const glazing = {}, wall_opaque = {}
  for (const f of ['north', 'south', 'east', 'west']) {
    const gross = faceLen[f] * perimH
    const r = Number(wwr[f] ?? 0)
    glazing[f]    = gross * r
    wall_opaque[f] = gross * (1 - r)
  }
  const totalGlazing = glazing.north + glazing.south + glazing.east + glazing.west
  const totalWall    = wall_opaque.north + wall_opaque.south + wall_opaque.east + wall_opaque.west
  return {
    gia:          L * W * nf,
    volume:       L * W * nf * fh,
    floor_area:   L * W,
    glazing,      total_glazing: totalGlazing,
    wall_opaque,  total_wall:    totalWall,
  }
}

function getU(constructions, element, libraryData) {
  const name = constructions?.[element]
  if (name && libraryData?.constructions) {
    const item = libraryData.constructions.find(c => c.name === name)
    if (item?.u_value_W_per_m2K != null) return Number(item.u_value_W_per_m2K)
  }
  return DEFAULT_U_VALUES[element] ?? 1.0
}

function getG(constructions, libraryData) {
  const name = constructions?.glazing
  if (name && libraryData?.constructions) {
    const item = libraryData.constructions.find(c => c.name === name)
    if (item?.config_json?.g_value != null) return Number(item.config_json.g_value)
  }
  return DEFAULT_G_VALUE
}

// ── Per-element first-principles ──────────────────────────────────────────────

/**
 * Returns:
 *   { kwh, kwh_per_m2, formula, terms: [{label, value, unit}] }
 *
 * `formula` is a human-readable formula string for display.
 * `terms` lists the numeric inputs so the drill-down can show them in a table.
 */
export function firstPrinciplesFor(elementKey, building, constructions, libraryData = {}, opts = {}) {
  const areas  = computeAreas(building)
  const HDH    = opts.hdh ?? UK_HDH_18C
  const orient = Number(building?.orientation ?? 0)
  const gia    = Math.max(areas.gia, 1)

  // Helpers
  const r1   = (v) => Math.round(v * 10) / 10
  const perM = (v) => Math.round((v / gia) * 100) / 100

  switch (elementKey) {
    case 'external_wall': {
      const A = areas.total_wall
      const U = getU(constructions, 'external_wall', libraryData)
      const Q = U * A * HDH / 1000
      return {
        kwh: r1(Q),
        kwh_per_m2: perM(Q),
        formula: 'A × U × HDH / 1000',
        terms: [
          { label: 'Area (opaque)', value: r1(A),      unit: 'm²' },
          { label: 'U-value',        value: U,          unit: 'W/m²K' },
          { label: 'HDH (base 18°C)',value: r1(HDH),    unit: 'K·h' },
        ],
      }
    }
    case 'roof': {
      const A = areas.floor_area
      const U = getU(constructions, 'roof', libraryData)
      const Q = U * A * HDH / 1000
      return {
        kwh: r1(Q),
        kwh_per_m2: perM(Q),
        formula: 'A × U × HDH / 1000',
        terms: [
          { label: 'Roof area',      value: r1(A),    unit: 'm²' },
          { label: 'U-value',        value: U,        unit: 'W/m²K' },
          { label: 'HDH (base 18°C)',value: r1(HDH),  unit: 'K·h' },
        ],
      }
    }
    case 'ground_floor': {
      const A = areas.floor_area
      const U = getU(constructions, 'ground_floor', libraryData)
      const Q = U * A * HDH / 1000
      return {
        kwh: r1(Q),
        kwh_per_m2: perM(Q),
        formula: 'A × U × HDH / 1000',
        terms: [
          { label: 'Floor area',     value: r1(A),    unit: 'm²' },
          { label: 'U-value',        value: U,        unit: 'W/m²K' },
          { label: 'HDH (base 18°C)',value: r1(HDH),  unit: 'K·h' },
        ],
      }
    }
    case 'glazing': {
      const A = areas.total_glazing
      const U = getU(constructions, 'glazing', libraryData)
      const Q = U * A * HDH / 1000
      return {
        kwh: r1(Q),
        kwh_per_m2: perM(Q),
        formula: 'A × U × HDH / 1000  (transmission only — solar gains separate)',
        terms: [
          { label: 'Glazing area',   value: r1(A),    unit: 'm²' },
          { label: 'U-value',        value: U,        unit: 'W/m²K' },
          { label: 'HDH (base 18°C)',value: r1(HDH),  unit: 'K·h' },
        ],
      }
    }
    case 'infiltration': {
      const ach = Number(building?.infiltration_ach ?? 0.5)
      const Q = AIR_HEAT_CAPACITY * ach * areas.volume * HDH / 24 / 1000  // HDH already × 24
      // simplified: 0.33 kWh/m³K × ach × V × HDD × 24 / 1000  with HDH = HDD×24
      const Qsimple = AIR_HEAT_CAPACITY * ach * areas.volume * HDH / 1000
      return {
        kwh: r1(Qsimple),
        kwh_per_m2: perM(Qsimple),
        formula: '0.33 × ACH × V × HDH / 1000',
        terms: [
          { label: 'ACH',            value: ach,                unit: '/h' },
          { label: 'Volume',          value: r1(areas.volume),   unit: 'm³' },
          { label: 'HDH (base 18°C)', value: r1(HDH),            unit: 'K·h' },
          { label: 'ρ·cp (air)',      value: AIR_HEAT_CAPACITY,  unit: 'kWh/m³K' },
        ],
      }
    }
    case 'ventilation': {
      // Approximate: same as infiltration but at the design vent rate × (1 − HRE).
      // We don't know HRE here without systems; assume 0 for headline.
      const ventAch = 0.5
      const Q = AIR_HEAT_CAPACITY * ventAch * areas.volume * HDH / 1000
      return {
        kwh: r1(Q),
        kwh_per_m2: perM(Q),
        formula: '0.33 × ACH_vent × V × HDH × (1 − η_HRV) / 1000',
        terms: [
          { label: 'ACH (vent)',      value: ventAch,            unit: '/h' },
          { label: 'Volume',          value: r1(areas.volume),   unit: 'm³' },
          { label: 'HDH (base 18°C)', value: r1(HDH),            unit: 'K·h' },
          { label: 'η_HRV (assumed)', value: 0,                  unit: '—' },
        ],
      }
    }
    case 'cooling': {
      // Without dynamic simulation we can't say much; flag as N/A.
      return {
        kwh: null, kwh_per_m2: null,
        formula: 'Cooling demand is dynamic — first-principles N/A',
        terms: [],
      }
    }
    case 'heating': {
      // Heating fills the deficit between losses and useful gains. With no
      // dynamics, that's an output not an input — flag as N/A.
      return {
        kwh: null, kwh_per_m2: null,
        formula: 'Heating fills the deficit; not a first-principles input',
        terms: [],
      }
    }
    case 'solar_north':
    case 'solar_east':
    case 'solar_south':
    case 'solar_west': {
      const face = elementKey.split('_')[1]
      const A = areas.glazing[face] || 0
      const g = getG(constructions, libraryData)
      const G = getSolarRadiation(face, orient)   // kWh/m²/yr through this orientation
      // Useful gain ≈ A × g × G × frame_factor.  Frame ~0.8 typical.
      const FRAME = 0.8
      const Q = A * g * G * FRAME
      return {
        kwh: Math.round(Q),
        kwh_per_m2: perM(Q),
        formula: 'A × g × G_solar × frame_factor',
        terms: [
          { label: 'Glazing area',         value: r1(A),  unit: 'm²' },
          { label: 'g-value',              value: g,      unit: '—' },
          { label: 'Annual irradiation',   value: G,      unit: 'kWh/m²/yr' },
          { label: 'Frame factor',         value: FRAME,  unit: '—' },
        ],
      }
    }
    case 'people':
    case 'equipment':
    case 'lighting': {
      // Internal gains are schedule-driven and depend on densities + hours.
      // Without a calibrated schedule, first-principles is rough.
      return {
        kwh: null, kwh_per_m2: null,
        formula: 'Schedule-driven; first-principles N/A without operating-hours assumptions',
        terms: [],
      }
    }
    default:
      return { kwh: null, kwh_per_m2: null, formula: 'No first-principles available', terms: [] }
  }
}

// ── Spread / tolerance ───────────────────────────────────────────────────────

/**
 * Compute relative spread across non-null values. Returns the largest
 * percentage deviation from the mean of the available values.
 */
export function computeSpread(values) {
  const valid = values.filter(v => v != null && isFinite(v))
  if (valid.length < 2) return null
  const mean = valid.reduce((s, v) => s + v, 0) / valid.length
  if (mean === 0) return null
  const maxDev = Math.max(...valid.map(v => Math.abs(v - mean) / Math.abs(mean)))
  return Math.round(maxDev * 1000) / 10   // %  with 1 decimal
}

export function classifySpread(pct) {
  if (pct == null) return 'unknown'
  if (pct <= 10) return 'tight'
  if (pct <= 25) return 'moderate'
  return 'large'
}
