/**
 * openingCoefficients.js — Brief 33 Part 2 (2026-05-18).
 *
 * C_d derivation for passive envelope openings used by the Static engine's
 * permanent-vent flow correlations. Per-opening, geometry-aware.
 *
 * Sources:
 *   - CIBSE Guide A §4.6 and Table 4.20 (sharp-edge orifice / slot / louvre)
 *   - AIVC Technical Note 32 (Liddament 1996) — slot aspect-ratio coefficients
 *   - BS EN 16798-7 §6.4 (single-sided correlation context)
 *
 * Replaces the hard-coded Cd = 0.6 that lived in _calculateEnvelopeOnly
 * (instantCalc.js). The new dispatch is per-opening:
 *
 *   cross-flow:    Q = computeCd(opening) · A · sqrt(Cw) · v_wind
 *   single-sided:  Q = 0.025 · A · v_wind · min(1.0, computeCd(opening) / 0.6)
 *
 * The single-sided restriction factor is an engineering correction documented
 * verbatim in docs/audit/29_permanent_vent_methodology.md §"C_d derivation and
 * the single-sided restriction factor". The empirical 0.025 coefficient from
 * BS EN 16798-7 is calibrated for typical-window-grade openings (effective
 * C_d 0.5–0.65); applying it unscaled to slot trickle vents with mesh and flap
 * (C_d ≈ 0.25) would overstate flow. The min(1.0, …) cap means openings as
 * permissive as the reference do not scale up.
 */

// ── Base C_d by opening type ─────────────────────────────────────────────────
// 'slot' and 'trickle_vent' share the same aspect-ratio interpolation —
// trickle_vent is a labelling convenience that lets the UI render trickle-
// specific copy ("trickle vent", default resistance 'mesh' + 'flap'), but
// the physics is the same long-narrow-slot relation.
const BASE_CD = {
  orifice:      0.61,   // sharp-edged opening — CIBSE Guide A §4.6
  louvre:       0.40,   // 45° fixed blades — CIBSE Guide A Table 4.20
  fixed_grille: 0.40,   // similar order of magnitude
}

// CIBSE Guide A Table 4.20 + AIVC TN32: slot C_d falls with aspect ratio.
// Anchors: (AR, Cd) = (1, 0.61), (5, 0.58), (10, 0.50), (50, 0.42),
// (100, 0.38), and saturates at 0.38 beyond AR 100.
const SLOT_AR_ANCHORS = [
  { ar:   1, cd: 0.61 },
  { ar:   5, cd: 0.58 },
  { ar:  10, cd: 0.50 },
  { ar:  50, cd: 0.42 },
  { ar: 100, cd: 0.38 },
]

// Internal-resistance multipliers applied AFTER the base C_d. Multiplicative
// because each feature is roughly independent (mesh adds boundary-layer drag,
// flap adds a movable obstruction, acoustic baffle adds tortuous path).
const RESISTANCE_MULTIPLIERS = {
  mesh:            0.85,
  flap:            0.70,
  acoustic_baffle: 0.60,
}

// Allowed enums (used by validators / UI dropdowns + checkboxes)
export const OPENING_TYPES         = ['orifice', 'slot', 'louvre', 'trickle_vent', 'fixed_grille']
export const INTERNAL_RESISTANCES  = ['mesh', 'flap', 'acoustic_baffle']

// Site exposure → wind-pressure coefficient C_w. Single source of truth for
// the UI provenance tooltip + the engine (currently both read the same
// lookup, but exporting it keeps that link explicit instead of duplicating).
// Per CIBSE Guide A.
export const CW_BY_SITE_EXPOSURE = {
  sheltered: 0.05,
  normal:    0.10,
  exposed:   0.20,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function interpolate(x, x0, x1, y0, y1) {
  if (x <= x0) return y0
  if (x >= x1) return y1
  return y0 + (y1 - y0) * ((x - x0) / (x1 - x0))
}

function slotBaseCd(aspectRatio) {
  if (!isFinite(aspectRatio) || aspectRatio < 1) return SLOT_AR_ANCHORS[0].cd
  for (let i = 0; i < SLOT_AR_ANCHORS.length - 1; i++) {
    const a = SLOT_AR_ANCHORS[i]
    const b = SLOT_AR_ANCHORS[i + 1]
    if (aspectRatio <= b.ar) return interpolate(aspectRatio, a.ar, b.ar, a.cd, b.cd)
  }
  return SLOT_AR_ANCHORS[SLOT_AR_ANCHORS.length - 1].cd
}

function aspectRatioFromDims(width_mm, height_mm) {
  const longer  = Math.max(Number(width_mm) || 0, Number(height_mm) || 0)
  const shorter = Math.min(Number(width_mm) || 0, Number(height_mm) || 0)
  if (shorter <= 0) return 1
  return longer / shorter
}

/**
 * baseCd — type-dependent base discharge coefficient before resistance
 * multipliers. Falls back to 0.61 (sharp orifice) for unknown / malformed
 * types so the engine never sees NaN; the UI is responsible for validation.
 */
function baseCd(opening) {
  const t = opening?.type
  if (t === 'orifice' || t === 'louvre' || t === 'fixed_grille') return BASE_CD[t]
  if (t === 'slot' || t === 'trickle_vent') {
    return slotBaseCd(aspectRatioFromDims(opening?.width_mm, opening?.height_mm))
  }
  return BASE_CD.orifice
}

/**
 * computeCd — derive C_d for a single opening from geometry + resistance.
 *
 * Input:
 *   {
 *     type: 'orifice' | 'slot' | 'louvre' | 'trickle_vent' | 'fixed_grille',
 *     width_mm?: number, height_mm?: number,
 *     internal_resistance?: Array<'mesh' | 'flap' | 'acoustic_baffle'>,
 *   }
 *
 * Output: C_d in (0, ~0.65]. Engine consumes it directly in cross-flow,
 * or via min(1.0, C_d / 0.6) as the single-sided restriction factor.
 */
export function computeCd(opening) {
  let cd = baseCd(opening)
  const features = Array.isArray(opening?.internal_resistance) ? opening.internal_resistance : []
  for (const f of features) {
    const m = RESISTANCE_MULTIPLIERS[f]
    if (typeof m === 'number') cd *= m
  }
  return cd
}

/**
 * cdProvenance — build a human-readable provenance string for the UI tooltip.
 *
 * Example output (Bridgewater trickle vent):
 *   "base 0.39 from slot AR 87:1 · × 0.85 mesh · × 0.70 flap → 0.23"
 */
export function cdProvenance(opening) {
  const t = opening?.type ?? 'orifice'
  const base = baseCd(opening)
  let basePart
  if (t === 'slot' || t === 'trickle_vent') {
    const ar = aspectRatioFromDims(opening?.width_mm, opening?.height_mm)
    basePart = `base ${base.toFixed(2)} from ${t === 'trickle_vent' ? 'trickle vent' : 'slot'} AR ${ar.toFixed(0)}:1`
  } else {
    basePart = `base ${base.toFixed(2)} from ${t}`
  }
  const features = Array.isArray(opening?.internal_resistance) ? opening.internal_resistance : []
  const mults = features
    .map(f => RESISTANCE_MULTIPLIERS[f] ? `× ${RESISTANCE_MULTIPLIERS[f].toFixed(2)} ${f}` : null)
    .filter(Boolean)
  const final = computeCd(opening)
  return [basePart, ...mults].join(' · ') + ` → ${final.toFixed(2)}`
}

/**
 * cwProvenance — human-readable provenance for the building-wide C_w
 * surfaced on the Permanent Openings panel. Single source: site_exposure.
 */
export function cwProvenance(siteExposure) {
  const exp = siteExposure ?? 'normal'
  const cw = CW_BY_SITE_EXPOSURE[exp] ?? CW_BY_SITE_EXPOSURE.normal
  return {
    cw,
    text: `${cw.toFixed(2)} from ${exp.charAt(0).toUpperCase() + exp.slice(1)} site exposure per CIBSE Guide A`,
  }
}
