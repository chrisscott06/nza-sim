/**
 * semanticColour.js — Brief 97 P2 (Interventions Studio).
 *
 * ONE source of truth for value colour across the Interventions Studio (Library
 * isolated view + Strategy). Kills the uniform-grey wall: numbers that represent
 * a delta pick colour by sign, headings/totals go bold navy, grey is demoted to
 * label/axis text only.
 *
 * Hex constants mirror the CSS `@theme` tokens in index.css (--color-saving /
 * --color-increase / --color-cost) so charts + inline styles agree with the
 * Tailwind utility classes (text-saving / text-increase / text-cost). Keep the
 * two in sync.
 *
 *   saving   — a reduction / good outcome  (green)
 *   increase — a rise / adverse outcome    (red)
 *   cost     — money, neutral + consistent (navy)
 *   heading  — headings & totals           (navy, use with font-semibold)
 *   muted    — labels / axes only          (mid-grey)
 */

export const SEMANTIC = {
  saving:   '#16A34A',
  increase: '#DC2626',
  cost:     '#2B2A4C',
  heading:  '#2B2A4C',
  muted:    '#6B7280',
}

// A delta smaller than this (absolute) reads as "no change" → muted, not green/red.
export const DELTA_EPSILON = 0.05

/**
 * Colour (hex) for a signed delta. By convention a *saving* is negative (energy,
 * carbon, cost fall), so `savingIsNegative` defaults true; pass false for metrics
 * where positive is the good direction (e.g. carbon *saved*). Near-zero → muted.
 */
export function deltaColour(value, { savingIsNegative = true, epsilon = DELTA_EPSILON } = {}) {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < epsilon) return SEMANTIC.muted
  const isSaving = savingIsNegative ? value < 0 : value > 0
  return isSaving ? SEMANTIC.saving : SEMANTIC.increase
}

/** Tailwind class variant of deltaColour (for text where a class is cleaner than inline style). */
export function deltaClass(value, { savingIsNegative = true, epsilon = DELTA_EPSILON } = {}) {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < epsilon) return 'text-mid-grey'
  const isSaving = savingIsNegative ? value < 0 : value > 0
  return isSaving ? 'text-saving' : 'text-increase'
}
