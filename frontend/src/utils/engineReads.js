/**
 * engineReads.js — Brief 88: the ONE canonical read path for the instant engine's
 * headline outputs.
 *
 * Engine Discipline (Bible): one canonical quantity, one canonical exposure point
 * in the engine output, one canonical read path everywhere. The modelled
 * (instant-engine) EUI lives at `consumption.total.kwh_per_m2_yr`. Read it ONLY
 * through `readModelledEui()` — never re-subscribe to the deprecated top-level
 * `eui_kWh_m2` alias or the `energy_use.totals.*` / `results.energy.*` shapes.
 * Those independently-computed aliases are a boundary-mismatch in waiting: two
 * exposures of the same quantity can silently diverge (Brief 88 root cause —
 * Systems read `eui_kWh_m2`, Strategy read `consumption.total.kwh_per_m2_yr`).
 *
 * NB: this is the INSTANT engine's EUI. The EnergyPlus *simulation* EUI is a
 * DIFFERENT boundary at `results.summary.eui_kWh_per_m2` — do not route it here.
 */

/** Canonical modelled (instant-engine) EUI, kWh/m²·yr. Null when unavailable. */
export function readModelledEui(result) {
  const v = result?.consumption?.total?.kwh_per_m2_yr
  return Number.isFinite(v) ? v : null
}
