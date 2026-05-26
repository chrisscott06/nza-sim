/**
 * unitFmt.js — Interventions module shared unit-toggle helpers (2026-05-26).
 *
 * The global UISettingsContext owns `unit` ∈ {'kwh', 'kwh_per_m2'} via the
 * TopBar toggle. (Internal keys kept for back-compat with localStorage —
 * the visible labels are now "Per m²" / "Total" since 2026-05-26 to
 * reflect that the toggle drives BOTH energy AND carbon.)
 *
 * The Interventions visualisers (Waterfall, Before/After, Heat balance,
 * Breakdown, Comparison) + the editor footer + the stack row deltas all
 * need to render energy + carbon in the chosen unit.
 *
 * Engine emits values in these native shapes:
 *   - EUI:        kWh/m²·yr (intensity)         → e.g., `eui_kwh_per_m2`, 128.20
 *   - ABSOLUTE:   demand/delivered/fuel in MWh  → e.g., `heating_demand_mwh`, 238.3
 *   - CARBON:     kgCO₂/m²·yr (intensity)       → e.g., `carbon_kgco2_per_m2`, 14.30
 *
 * Both energy AND carbon honour the toggle (2026-05-26 update — Chris
 * walkthrough). Efficiency (SCOP/SEER ratio) is the only kind that
 * never converts.
 *
 * Display modes:
 *   - displayUnit === 'kwh_per_m2'   → everything as intensity
 *                                     (kWh/m²·yr + kgCO₂/m²·yr)
 *   - displayUnit === 'kwh'          → everything as absolute
 *                                     (auto-MWh for energy, auto-tCO₂ for carbon)
 *
 * This helper:
 *   - getGia(result) — robust GIA extraction from any engine result shape
 *   - toDisplay(value, kind, displayUnit, gia) — convert + pick display unit
 *   - displayUnitLabel(kind, displayUnit) — the string label for axes/headers
 */

export const KIND = {
  MWH:      'mwh',              // absolute energy in MWh (most engine fields)
  KWH_M2:   'kwh_per_m2_yr',    // intensity (e.g., EUI)
  KG_M2:    'kgco2_per_m2_yr',  // carbon intensity — never toggles
  UNITLESS: 'unitless',         // efficiency / ratio — never toggles
}

/** GIA from any engine result shape. Returns 0 when missing. */
export function getGia(result) {
  if (!result) return 0
  return (
    result.metadata?.gia_m2 ??
    result.heat_balance?.metadata?.gia_m2 ??
    result.gia_m2 ??
    0
  )
}

/**
 * Convert a native-kind value to the chosen display unit. Returns
 * `{ value, label }` where `value` is the number to render (auto-promoted
 * to MWh for large absolute values) and `label` is the unit string.
 *
 * `displayUnit` is the global toggle value from `useUISettings().unit`.
 */
export function toDisplay(value, kind, displayUnit, gia_m2) {
  // Null / non-finite values still get a sensible label
  if (value == null || !Number.isFinite(value)) {
    return { value: null, label: kindFallbackLabel(kind, displayUnit) }
  }

  // Untoggleable: efficiency (SCOP/SEER ratio)
  if (kind === KIND.UNITLESS) return { value, label: '' }

  if (displayUnit === 'kwh_per_m2') {
    // ── intensity mode ──
    if (kind === KIND.KWH_M2) return { value, label: 'kWh/m²·yr' }
    if (kind === KIND.KG_M2)  return { value, label: 'kgCO₂/m²·yr' }
    if (kind === KIND.MWH) {
      if (gia_m2 > 0) {
        return { value: (value * 1000) / gia_m2, label: 'kWh/m²·yr' }
      }
      // GIA unavailable — fall back to native MWh rather than crash
      return { value, label: 'MWh' }
    }
  } else {
    // ── absolute (kwh) mode ──
    //   Energy: auto-promote to MWh for legibility
    //   Carbon: auto-promote to tCO₂ when ≥ 1000 kg
    if (kind === KIND.KWH_M2) {
      if (gia_m2 > 0) {
        const abs_kwh = value * gia_m2
        if (Math.abs(abs_kwh) >= 1000) return { value: abs_kwh / 1000, label: 'MWh' }
        return { value: abs_kwh, label: 'kWh' }
      }
      return { value, label: 'kWh/m²·yr' }
    }
    if (kind === KIND.MWH) {
      // Already MWh; promote down to kWh only for very small values
      if (Math.abs(value) < 1) return { value: value * 1000, label: 'kWh' }
      return { value, label: 'MWh' }
    }
    if (kind === KIND.KG_M2) {
      if (gia_m2 > 0) {
        const abs_kg = value * gia_m2
        if (Math.abs(abs_kg) >= 1000) return { value: abs_kg / 1000, label: 'tCO₂' }
        return { value: abs_kg, label: 'kgCO₂' }
      }
      return { value, label: 'kgCO₂/m²·yr' }
    }
  }

  return { value, label: '' }
}

/** Just the label without converting a value — for axis labels etc. */
export function displayUnitLabel(kind, displayUnit) {
  if (kind === KIND.UNITLESS) return ''
  if (displayUnit === 'kwh_per_m2') {
    if (kind === KIND.KG_M2) return 'kgCO₂/m²·yr'
    return 'kWh/m²·yr'
  }
  // Absolute mode
  if (kind === KIND.KG_M2) return 'tCO₂'   // assumes typical building scale
  return 'MWh'
}

function kindFallbackLabel(kind, displayUnit) {
  if (kind === KIND.UNITLESS) return ''
  if (displayUnit === 'kwh_per_m2') {
    return kind === KIND.KG_M2 ? 'kgCO₂/m²·yr' : 'kWh/m²·yr'
  }
  return kind === KIND.KG_M2 ? 'tCO₂' : 'MWh'
}

/**
 * Format a converted display value with sensible precision. Caller has
 * already chosen the unit via `toDisplay` — this just makes a string.
 */
export function fmtValue(value, opts = {}) {
  const { dp } = opts
  if (value == null || !Number.isFinite(value)) return '—'
  if (dp != null) return value.toFixed(dp)
  if (Math.abs(value) >= 1000) return value.toFixed(0)
  if (Math.abs(value) >= 100)  return value.toFixed(0)
  if (Math.abs(value) >= 10)   return value.toFixed(1)
  if (Math.abs(value) >= 1)    return value.toFixed(1)
  return value.toFixed(2)
}

/** Signed delta format — e.g., '+12.4', '−3.1', '0.0'. */
export function fmtDeltaSigned(value, opts = {}) {
  const { dp = 1, threshold = 0.05 } = opts
  if (value == null || !Number.isFinite(value)) return '—'
  if (Math.abs(value) < threshold) return (0).toFixed(dp)
  const sign = value < 0 ? '−' : '+'
  return `${sign}${Math.abs(value).toFixed(dp)}`
}
