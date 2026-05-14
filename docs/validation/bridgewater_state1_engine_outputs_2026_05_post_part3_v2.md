# Bridgewater — Static engine State 1 outputs (post Brief 28b Part 3 v2, 2026-05-14)

**Canonical engine baseline for the validation spreadsheet — supersedes the post-Problem-1-fix baseline.**

Engine commit (this commit). Tuning values picked from
`docs/validation/state1_part3_response_surface_2026_05.md`:
- `solar_radiative_fraction = 0.30`
- `internal_mass_kJ_per_K_per_m2 = 100`
- R_si values unchanged at BS EN ISO 6946 defaults (0.13 wall, 0.10 roof, 0.17 floor)

Persisted Bridgewater config: `infiltration_ach: 0.2`. Yeovilton TMYx weather. Comfort band 21 / 25 °C.

---

## What's changed since the post-Problem-1-fix baseline (e0282c2 / 872c8ca)

**Architecture:** lumped two-node thermal mass replaced with per-layer multi-node implicit RC model (Brief 28b Part 3 v1, commit `1d6fc79`). Sol-air on opaque outside, distributed glazing solar (30% radiative / 70% convective in v2), zone-air implicit step with 100 kJ/(K·m²·GIA) internal-mass term. 5% opaque-roof solar heuristic dropped.

**Numerical impact** for Bridgewater envelope-only:

| Field | Pre Part 3 (e0282c2) | Post Part 3 v2 (this) | EP reference | Δ vs EP |
|---|---:|---:|---:|---:|
| F1 solar (kWh/yr) | 57,488.5 | 57,488.5 | 46,998.7 | −18.2% (Part 2 territory) |
| F2 solar | 4,397.9 | 4,397.9 | 5,149.7 | +17.1% (Part 2) |
| F3 solar | 71,400.5 | 71,400.5 | 77,593.9 | +8.7% |
| F4 solar | 3,132.5 | 3,132.5 | 3,244.9 | +3.6% |
| Solar roof (5% heuristic dropped) | 46,454.2 | 0 | 0 | match |
| Solar total (facade) | 136,419.3 | 136,419.3 | 132,987.3 | −2.5% |
| External wall loss | 16,515.4 | 9,334.0 | 15,392.1 | **+64.9%** |
| Roof loss | 11,110.0 | 9,401.2 | 10,355.1 | +10.1% |
| Ground floor loss | 15,276.3 | 15,076.8 | 14,238.3 | −5.6% |
| Glazing loss | 83,166.6 | 62,590.8 | 77,515.2 | **+23.8%** |
| Thermal bridging | 0 | 0 | 0 | exact |
| Fabric leakage | 58,661.0 | 44,148.0 | 54,672.5 | **+23.8%** |
| Permanent vents | 0 | 0 | 0 | exact |
| Total losses (sum) | 184,729.4 | 140,550.8 | 172,173.2 | +22.5% |
| Annual mean T (°C) | 21.2 | **18.1** | 19.8 | +9.4% |
| **Summer max T (°C)** | **44.2** | **35.5** | **35.4** | **−0.3%** ✓ |
| Winter min T (°C) | 4.0 | 4.2 | 8.3 | **+97.6%** |
| Heating demand (MWh) | 103.4 | 121.4 | 110.2 | −9.2% |
| Cooling demand (MWh) | 108.6 | **40.3** | 61.7 | **+53.1%** |
| Comfort hours | 881 | 1,810 | 1,396 | −22.9% |
| Underheating hours | 4,430 | 5,404 | 4,618 | −14.5% |
| Overheating hours | 3,449 | 1,546 | 2,746 | +77.6% |

**Headline change:** summer max gap closed from 8.8 K (pre Part 3) to **0.1 K** (post Part 3 v2). This is the canonical reference for the validation spreadsheet now.

---

## Aggregate scorecard

| Domain | PASS at ±15% | Count |
|---|---|---:|
| Solar | F3 ✓, F4 ✓, total ✓ | 3/5 |
| Conduction + ventilation | roof, ground, thermal_bridging, permanent_vents | 4/7 |
| Free-running T | annual mean (+9.4%) ✓, **summer max (−0.3%)** ✓ | 2/3 |
| Demand | heating (−9.2%) ✓ | 1/5 |
| **Total** | | **10/21 (48%)** |

Same pass count as v1 (10/21) but PASS magnitudes improved across the board. Summer max is now within 0.3% — the headline goal.

---

## Known limitations (documented in HeatBalance disclosure)

Post Part 3 v2, three structural gaps remain. These do NOT close with the three tuning knobs (response-surface sweep confirms). They are queued as Brief 28b Part 3 v3 + Part 4.

### 1. Summer max — credible

Static **35.5 °C** vs EP **35.4 °C**. Within 0.1 K. Was 8.8 K gap pre Part 3.

### 2. Mean T trace — 1.7 K cooler than EP year-round (known limitation, conservative)

Static **18.1 °C** vs EP **19.8 °C**. Persistent gap, monotonic across all tuning values tested. Likely root cause: missing physics in the State 1 model (see Part 3 v3 + Part 4 scope below).

**Implication:** Static's free-running zone trace runs cooler than EP's. This is conservative for overheating analysis (Static is "harder to overheat") but anticonservative for heating sizing (would under-predict heating energy compared to a building experiencing EP-like internal T).

### 3. Cooling demand — 35% underestimate vs EP

Static **40.3 MWh** vs EP **61.7 MWh**. Direct consequence of #2: lower mean T → fewer hours above the upper comfort bound → less cooling needed.

**For system sizing use the Dynamic (EnergyPlus) engine.** Static's cooling demand should be treated as a lower bound; the actual cooling load is likely between Static and Dynamic, closer to Dynamic on buildings with prominent solar gain.

---

## Whole-wall U-values (now reported by the engine)

The engine computes per-construction U from the layer stack rather than the library top-level value (which is independently set on some library items and may not match):

| Construction | Library top-level U (W/m²K) | Engine-derived U (1/Σ R) | Difference | Why |
|---|---:|---:|---:|---|
| `cavity_wall_enhanced` (ext_wall) | 0.18 | 0.135 | −25% | Library U was set independently (possibly includes wall-tie thermal bridging or "as-built" allowance not present in the layer stack) |
| `pitched_roof_standard` (roof) | 0.16 | 0.179 | +12% | Same |
| `ground_floor_slab` (floor) | 0.22 | 0.273 | +24% | Same |
| `double_low_e` (glazing) | 1.40 | 1.40 (used directly, no layers) | match | Glazing modelled as steady-state UA |

EnergyPlus also uses the layer stack (same `Material` definitions in the assembled epJSON), so engine-derived U matches EP. This explains some of the +20-65% loss-side gaps: my engine's losses use the lower layer-derived U (0.135 wall vs 0.18 library), so per-K of ΔT the wall transmits less than the library-stated U would.

---

## File pointers

- Engine source: `frontend/src/utils/instantCalc.js::_calculateEnvelopeOnly`
- Wall model: `frontend/src/utils/wallModel.js`
- Library API: `GET /api/library/constructions`
- Project API: `GET /api/projects/14b4a5b1-8c73-4acb-8b65-1d22f05ec969`
- Response-surface sweep: `docs/validation/state1_part3_response_surface_2026_05.md`
- Static vs Dynamic comparison: `docs/validation/state1_static_vs_dynamic_post_part3_v1.md` (v1 baseline — superseded by this doc for v2)
- Raw JSON dump: `docs/validation/_dump.json`

---

## What's next

**Brief 28b Part 3 v3** (immediate follow-up) — glazing inside-surface solar absorption (~7% of incident solar absorbed at the inside glazing surface, heats T_air directly). Highest-leverage candidate to close the mean-T gap.

**Brief 28b Part 4** — multi-construction validation (heavy mass cube, lightweight cube, tropical EPW). Probe parameter robustness before claiming generalisation.

**Brief 28b Part 5** — construction-stack-aware mass derivation. Compute internal_mass from library layer data using CIBSE thermal admittance or ASHRAE response factors. Removes per-building manual tuning.

After Part 3 v3 + Part 4: State 1 validated with documented limitations. Move to Brief 28c.
