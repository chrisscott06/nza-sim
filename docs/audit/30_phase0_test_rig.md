# Brief 30 Phase 0.4 — Test rig

**Canonical test building:** HIX Bridgewater.
**Validation set:** Single-building. Flagged as a known limitation in each Phase N findings document (Chris call 2026-05-18 — sanity rig with single-zone cube is queued for a later brief).

## Bridgewater identifiers

| Field | Value |
|---|---|
| Project ID | `14b4a5b1-8c73-4acb-8b65-1d22f05ec969` |
| Project name | "HIX Bridgewater" |
| Brief 29 baseline run ID | `b8db113e` (Dynamic envelope-only, post Commit A door fix) |
| Baseline run path | `data/simulations/b8db113e/` (contains `input.epJSON`, `eplusout.sql`, `eplusout.rdd`, etc.) |
| Weather file | `data/weather/current/GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw` |
| GIA | 4,322 m² (58.8 × 14.7 × 5 floors) |
| Volume | 13,830 m³ |
| Orientation | 41° |
| Comfort band | 21.0 – 24.0 °C |
| WWR | N 0.35, S 0.12, E 0.02, W 0.02 |
| q50 | None (legacy `infiltration_ach = 0.23` is the active value) |
| num_bedrooms | 134 |
| Permanent louvres | N 1.00 m², S 0.76 m² (total 1.76 m²) |
| Operable openings | "Main Entrance NE" — 2 m² × 2 m, scheduled 09–18 weekdays. **Suppressed in State 1 post Commit A `39a828c`.** |
| HVAC system | VRF (per project's `systems_config.hvac_type`) |

## Static reference values (post Commit A `39a828c`, audit baseline)

These are reference values for context only. **Per Brief 30 Principle 3, Dynamic is NOT required to match these.** Disagreement is investigated and explained, not closed by adjustment.

| Quantity | Static value | Source |
|---|---|---|
| State 1 heating demand | 194.3 MWh/yr | `instantCalc.js::_calculateEnvelopeOnly`, post door fix |
| State 1 cooling demand | 44.0 MWh/yr | same |
| State 1 EUI (Static) | 55.1 kWh/m²·yr | (194.3 + 44.0) × 1000 / 4322 |
| State 1 displayed fabric losses (Σ 7 elements, setpoint convention) | 251.5 MWh/yr | `losses_at_setpoint` block |
| State 1 displayed solar gain (gross annual) | 99.4 MWh/yr | `losses_at_setpoint.glazing.monthly_solar_transmission_kwh` summed |
| State 1 displayed solar credited in heating hours | ~57.2 MWh/yr | derived from Brief 29 Part 1 reconciliation (`251.5 − 194.3 ≈ 57.2`) |
| State 1 Static T_air mean | 16.1 °C | `instantResult.free_running.annual_mean_c` |
| State 1 Static T_air winter min | 5.7 °C | `instantResult.free_running.winter_min_c` |
| State 1 Static T_air summer max | 30.6 °C | `instantResult.free_running.summer_max_c` |

Detailed per-element setpoint breakdown is documented in `29_first_principles_audit_FINDINGS.md` — that document is the single source of truth for the Static baseline. Reference, do not duplicate.

## Pre-Brief-30 Dynamic baseline (Issue #13 contaminated — DO NOT TARGET)

The Brief 29 Part 2 Dynamic-side numbers were captured before Issue #13 (T_air clamping) was diagnosed. These should NOT be used as Dynamic targets for Brief 30; they're recorded only for "did the rebuild move the number?" verification.

| Quantity | Pre-fix Dynamic | Genuinely-stripped Dynamic (Issue #13 diagnostic) |
|---|---|---|
| State 1 mean T_air | 21.1 °C (29.5% pinned at 21.0) | 14.7 °C (0.6% near 21.0 — noise floor) |
| State 1 stdev T_air | 1.87 K | 5.25 K |
| State 1 heating demand | 209.8 MWh/yr | (not computed in diagnostic — no demand integral) |

The "genuinely-stripped" run (from `scripts/_issue13_diagnostic.py` → `data/simulations/_diag_issue13_no_hvac/`) is the closest existing approximation to what Phase 1's State 1 strip should produce. **Phase 1 success criterion (single building):** State 1 rebuild produces a T_air trace that matches the genuinely-stripped diagnostic within 0.5 K on the annual mean. If Phase 1 produces 21.1 °C again, the strip is incomplete.

## Reproducer command

```bash
# Re-run the Issue #13 diagnostic / State 1 strip regression:
python scripts/_state1_strip_regression.py
# (formerly _issue13_diagnostic.py — renamed per Chris call 2026-05-18)
#
# Post Brief 30 Phase 1, this should report:
#   "T_zone trace difference between baseline and stripped: < 0.5 K mean,
#    clamping % unchanged (both ~0%)"
# because there's no HVAC to strip in the new State 1 epJSON.
```

## Single-building validation — known limitation

Each Phase N `FINDINGS.md` includes a section flagging:

> **Validation scope: single building.** All numbers in this document are computed against HIX Bridgewater only. A second test building (ideally a single-zone published-U-value cube, ASHRAE Standard 140 BESTest building, or CIBSE TM33 reference case) would triangulate engine behaviour but is queued as a separate brief. Until then, Bridgewater-specific findings may not generalise to other building topologies, climates, or system configurations.

This limitation also means Brief 30's State 1 expected-behaviour check (§1.5 — "Static and Dynamic T_zone within 2–3 K on monthly means") is a Bridgewater-only test. Other buildings could show wider divergence and reveal mechanisms that Bridgewater doesn't exercise.
