/**
 * hiexCostRates.js — Brief 97 P7.
 *
 * Type-default cost rates DERIVED from the HIEX benchmark cost build-ups
 * (docs/report/HIEX_Intervention_Spec_and_Cost_Benchmarks.md, Brief 96). Every
 * rate here is a real sourced figure lifted from that document's line items —
 * NOT invented (Bible Rule 2). Each entry carries the unit it applies to, a
 * central rate, and the `source` string verbatim-ish from the benchmark so a QS
 * can trace provenance.
 *
 * Read ONLY through costReads (`listHiexRates` / `hiexRatesForUnit`) — never
 * import this file directly into an editor component (Bible Rule 11).
 *
 * The rate is the central; where the benchmark gave a band it's noted in `source`.
 * Units match costModel.UNITS ('kW', 'l/s', 'm²', 'nr', 'day', …).
 */

export const HIEX_COST_RATES = [
  // ── Plant, by capacity (£/kW) ──
  { key: 'ashp_supply',  label: 'ASHP plant (supply)',       unit: 'kW',  rate: 550,  source: 'HIEX 1.4 — commercial high-temp monobloc supply, 2024–25 trade' },
  { key: 'vrf_supply',   label: 'VRF plant (supply)',        unit: 'kW',  rate: 450,  source: 'HIEX 3.2 — VRF outdoor+indoor+FS-box supply, 2024–25 trade' },
  { key: 'pv_installed', label: 'PV array (installed)',      unit: 'kW',  rate: 1100, source: 'HIEX 7.1 — UK commercial rooftop £700–1,100/kWp, 2026 (top of band)' },

  // ── Ventilation, by flow (£/(l/s)) ──
  { key: 'mvhr_ahu',     label: 'MVHR / AHU plant (supply)', unit: 'l/s', rate: 12,   source: 'HIEX 2.1 — packaged AHU supply, £8–18/(l/s) mid-band, 2024–25' },

  // ── Fabric, by area (£/m²) ──
  { key: 'solar_film',   label: 'Glazing solar film',        unit: 'm²',  rate: 45,   source: 'HIEX 3.4 — film £25–70/m², 2024–25' },
  { key: 'brise_soleil', label: 'Brise soleil (blade area)', unit: 'm²',  rate: 550,  source: 'HIEX 3.5 — aluminium brise soleil £400–800/m² blade, 2024–25' },

  // ── Per-item / per-room / per-point (£/nr) ──
  { key: 'lowflow_room',    label: 'Low-flow fittings (per room)',   unit: 'nr', rate: 60,  source: 'HIEX 1.1 — hotel low-flow retrofit £40–100/room, 2025' },
  { key: 'keycard_room',    label: 'Keycard master switch (per room)', unit: 'nr', rate: 140, source: 'HIEX 4.2 — keycard switch + wiring, £80–200/room' },
  { key: 'led_fitting',     label: 'LED fitting (supply+fit)',       unit: 'nr', rate: 110, source: 'HIEX 5.2 — £80–150/fitting, 2024–25' },
  { key: 'pir_sensor',      label: 'PIR occupancy sensor',           unit: 'nr', rate: 90,  source: 'HIEX 5.2 — PIR points, 2024–25' },
  { key: 'openable_window', label: 'Openable-window conversion',     unit: 'nr', rate: 650, source: 'HIEX 3.x — fenestration £400–900/window, 2024–25' },
  { key: 'metering_point',  label: 'Sub-metering point (CT+comms)',  unit: 'nr', rate: 450, source: 'HIEX 4.1 — BSRIA-type metering £300–800/point' },
  { key: 'elec_submeter',   label: 'Electrical sub-meter point',     unit: 'nr', rate: 600, source: 'HIEX 6.x — £300–800/point BSRIA-type' },
  { key: 'water_meter',     label: 'Water meter',                    unit: 'nr', rate: 800, source: 'HIEX 6.x — BSRIA-type' },

  // ── Labour (£/day) ──
  { key: 'labour_plumbing',      label: 'Plumbing labour',        unit: 'day', rate: 350, source: 'HIEX 1.x — M&E day rates, 2025' },
  { key: 'labour_commissioning', label: 'Commissioning engineer', unit: 'day', rate: 550, source: 'HIEX 1.2/2.2 — M&E commissioning day rate, 2025' },
  { key: 'labour_controls',      label: 'Controls specialist',    unit: 'day', rate: 600, source: 'HIEX 3.3 — controls/BMS day rate, 2025' },
]

/**
 * On-cost default percentages carried from the HIEX build-ups' "on-costs (~40%)"
 * note, decomposed onto the NRM2 sequence used by costModel. These mirror
 * PROJECT_COST_DEFAULTS (fees 12 / prelims 10 / OHP 8 / contingency 15 /
 * inflation 5) — the HIEX ~40% is the informational cross-check, not a second
 * source of truth. Kept here so "Fill % lines from defaults" has a documented
 * provenance string.
 */
export const HIEX_ONCOST_NOTE = 'HIEX cost plans carry ~40% on-costs; NZA decomposes onto NRM2 fees 12 / prelims 10 / OHP 8 / contingency 15 / inflation 5.'
