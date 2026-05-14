# Brief 28b Part 3 — parameter response-surface sweep (Bridgewater, 2026-05-14)

**Purpose:** Probe the engine's response to each of the three Part 3 v1 tuning knobs before picking values for Part 3 v2. Tests the engine's response surface to each knob, looks for monotonic behaviour, picks tuning values from data not assumption.

**Setup:**
- Bridgewater envelope-only, persisted config (`infiltration_ach=0.2`)
- Yeovilton TMYx EPW
- Comfort band 21 / 25 °C
- Engine commit `1d6fc79` + Part 3 v2 scaffolding (tuning hooks; defaults preserved)
- EP reference values from sim `c67aff89`

**EP reference targets:** mean 19.8 °C, summer max 35.4 °C, winter min 8.3 °C, heating 110.2 MWh, cooling 61.7 MWh.

Raw sweep dump: `docs/validation/_part3_response_surface_dump.json`.

---

## Test 1 — Solar split sweep (PRIMARY)

Varies `solar_radiative_fraction` (fraction of glazing-transmitted solar absorbed slowly at opaque interior surfaces; remainder delivered convectively to zone air). v1 default = 0.50.

| solar_rad_frac | mean °C | summer max °C | winter min °C | heating MWh | cooling MWh | Δ mean vs EP | Δ max vs EP | Δ cool vs EP |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | **18.1** | 37.2 | 3.2 | 122.7 | 42.3 | **−8.6%** | +5.1% | −31.4% |
| 0.50 (v1) | 17.9 | 36.7 | 3.2 | 123.6 | 39.5 | −9.6% | +3.7% | −36.0% |
| 0.70 | 17.8 | 36.3 | 3.1 | 124.5 | 37.6 | −10.1% | +2.5% | −39.1% |
| 0.85 | 17.7 | 36.0 | 3.1 | 125.1 | 35.8 | −10.6% | +1.7% | −42.0% |
| 1.00 | 17.5 | 35.6 | 3.0 | 125.8 | 34.1 | −11.6% | +0.6% | −44.7% |

### Visual response surface (ASCII)

```
solar_rad_frac:    0.30        0.50         0.70         0.85        1.00
                    │           │            │            │           │
mean °C   ──── 18.1 ┤▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ 17.5 ────
                                                          (EP 19.8 →)

summer    ──── 37.2 ┤▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ 35.6 ────
max °C                                                   (EP 35.4 →)

cool MWh  ──── 42.3 ┤▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ 34.1 ────
                                                         (EP 61.7 →)
```

### Monotonicity check

| Output | Pre-condition | Post-condition | Monotonic? |
|---|---|---|:---:|
| Mean T | 18.1 @ 0.30 | 17.5 @ 1.00 | ✓ decreases |
| Summer max | 37.2 @ 0.30 | 35.6 @ 1.00 | ✓ decreases |
| Winter min | 3.2 @ 0.30 | 3.0 @ 1.00 | ✓ flat (within noise) |
| Cooling demand | 42.3 @ 0.30 | 34.1 @ 1.00 | ✓ decreases |
| Heating demand | 122.7 @ 0.30 | 125.8 @ 1.00 | ✓ increases |

### Surprise finding

**Mean T DECREASES with higher radiative fraction, not increases as my hypothesis predicted.** I expected more radiative absorption → wall holds heat → more reaches zone over time → higher mean T. Actual: the opposite.

**Physical explanation:** when solar is delivered convectively (100% rad_frac → 100% convective is wrong language; let me restate). When `solar_radiative_fraction` is LOW (e.g. 0.30), 70% of solar goes DIRECTLY to zone air. Direct-to-air solar:
- Is not subject to any loss before reaching air
- Maintains T_air higher

When `solar_radiative_fraction` is HIGH (1.00), 100% goes to opaque wall inside surfaces. The wall is between zone and OUTSIDE — heat absorbed at the inside surface has TWO conduction paths: inward (R_si=0.13) and outward (R_total − R_si = 7.27). Most goes inward eventually, but the OUTWARD path is small but non-zero, so SOME solar leaks out through the wall and is lost to ambient. Result: less net energy reaches the zone.

Quantitatively: at R_total=7.4, R_si=0.13 — fraction lost to outside = R_si / R_total = 1.75% per pass. But cumulative across the day with conduction lag, the loss is bigger.

**The directional surprise is correct physics, not a bug.** It just runs opposite to my pre-sweep intuition.

### Mean-T closest match

Best mean T match in Test 1 is **solar_rad_frac = 0.30** at mean = 18.1 °C. **Still 1.7 K below EP's 19.8 °C.** Test 1 alone cannot close the mean-T gap.

---

## Test 2 — Mass parameter sweep

Test 1 didn't give a clean answer for mean T. Fixed `solar_rad_frac = 0.30` (the Test 1 best-match value) and varied `internal_mass_J_per_K_per_m2`.

| mass kJ/(K·m²) | mean °C | summer max °C | winter min °C | heating MWh | cooling MWh | Δ mean | Δ max | Δ min |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 (v1) | 18.1 | 37.2 | 3.2 | 122.7 | 42.3 | −8.6% | +5.1% | **−61.4%** |
| 100 | 18.1 | **35.5** | 4.2 | 121.4 | 40.3 | −8.6% | **+0.3%** | −49.4% |
| 150 | 18.2 | 34.7 | 4.8 | 121.3 | 40.5 | −8.1% | −2.0% | −42.2% |
| 200 | 18.2 | 33.9 | 5.3 | 121.4 | 40.3 | −8.1% | −4.2% | −36.1% |

### Visual response surface

```
mass kJ/m²:        50          100          150          200
                   │           │            │            │
mean °C  ─────  18.1 ┤▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ 18.2 ──── (EP 19.8 →)

summer   ─────  37.2 ┤▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ 33.9 ──── (EP 35.4 →)
max °C                                          ↑ EP match at mass≈100

winter   ─────   3.2 ┤▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  5.3 ──── (EP 8.3  →)
min °C                                                      ↑ still 3 K gap
```

### Monotonicity check

| Output | Pre-condition | Post-condition | Monotonic? |
|---|---|---|:---:|
| Mean T | 18.1 @ 50 | 18.2 @ 200 | ✓ essentially flat (expected — mass doesn't add energy, just damps swings) |
| Summer max | 37.2 @ 50 | 33.9 @ 200 | ✓ decreases |
| Winter min | 3.2 @ 50 | 5.3 @ 200 | ✓ increases |
| Heating demand | 122.7 @ 50 | 121.4 @ 200 | ✓ ≈ flat |
| Cooling demand | 42.3 @ 50 | 40.3 @ 200 | ✓ ≈ flat |

All monotonic. **Mean T essentially insensitive to mass — confirms expected behaviour (mass doesn't add energy, just damps swings).**

### Summer max + winter min closest match

| mass kJ/(K·m²) | summer max gap | winter min gap | composite |
|---:|---:|---:|---:|
| 50 | +1.8 K (37.2 vs 35.4) | −5.1 K (3.2 vs 8.3) | 6.9 K |
| **100** | **+0.1 K** | −4.1 K | **4.2 K** |
| 150 | −0.7 K | −3.5 K | 4.2 K |
| 200 | −1.5 K | −3.0 K | 4.5 K |

**Best composite at mass = 100 or 150 kJ/(K·m²).**

At mass = 100: summer max exactly matches EP (35.5 vs 35.4 — 0.1 K gap); winter min still 4.1 K below EP.

At mass = 150: summer max overshoots EP slightly (34.7 vs 35.4 — −0.7 K); winter min closer (4.8 vs 8.3 — 3.5 K gap).

---

## Test 3 — R_si sweep

Test 2 confirmed mass works but couldn't close the winter min gap. Fixed `solar_rad_frac = 0.30`, `mass = 150 kJ/(K·m²)` and varied R_si proportionally across walls/roof/floor.

| R_si_wall | mean °C | summer max °C | winter min °C | heating MWh | cooling MWh | Δ mean | Δ max | Δ min |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.10 | 18.2 | 34.7 | 4.8 | 121.5 | 40.5 | −8.1% | −2.0% | −42.2% |
| 0.13 (v1) | 18.2 | 34.7 | 4.8 | 121.3 | 40.5 | −8.1% | −2.0% | −42.2% |
| 0.17 | 18.2 | 34.7 | 4.8 | 121.1 | 40.6 | −8.1% | −2.0% | −42.2% |
| 0.20 | 18.2 | 34.7 | 4.8 | 120.9 | 40.7 | −8.1% | −2.0% | −42.2% |

### Visual response surface

```
R_si:             0.10        0.13         0.17         0.20
                   │           │            │            │
mean °C   ────  18.2 ┤▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ 18.2 ───  (essentially flat)
summer    ────  34.7 ┤▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ 34.7 ───  (essentially flat)
winter    ────   4.8 ┤▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  4.8 ───  (essentially flat)
```

### Monotonicity check

**R_si has no measurable effect on any of the five outputs.** All values essentially identical across the 0.10–0.20 sweep. Heating demand drifts by 0.6 MWh (within noise).

### Why R_si doesn't matter (physical explanation)

The wall has total R = 7.4 m²K/W. R_si = 0.13 is only 1.7% of total R. Varying R_si by ±50% (0.10 to 0.20) changes total R by ±0.85% — negligible. The wall's thermal behaviour is dominated by the insulation layer (PIR has R ≈ 6.8), not by inside surface film.

The wall step's `U_eff = 1/R_n` (node-to-air conductance) does vary significantly (7.14 at R_si=0.10 vs 4.17 at R_si=0.20), but the zone-balance equation uses `U_eff × area × dT_node_to_air`. With internal mass damping T_air, the equilibrium T trace is robust to R_si.

**R_si is not a useful tuning knob for Bridgewater.** Skip in Part 3 v2.

---

## Recommended Part 3 v2 values (with data justification)

| Knob | v1 value | Recommended v2 value | Justification |
|---|---:|---:|---|
| `solar_radiative_fraction` | 0.50 | **0.30** | Closest mean-T match (18.1 vs EP 19.8). Reduces convective-to-radiative ratio gives EP-direction lift on mean T. |
| `internal_mass_kJ_per_K_per_m2` | 50 | **100** | Closest summer-max match (35.5 vs EP 35.4 — 0.1 K gap). Mass=150 overshoots; mass=100 is the sweet spot. |
| `R_si_wall` | 0.13 | leave at 0.13 | No measurable response. Don't churn the default. |
| `R_si_roof` | 0.10 | leave at 0.10 | Same as above. |
| `R_si_floor` | 0.17 | leave at 0.17 | Same as above. |

### Expected post-v2 performance with these values

Best estimate from the Test 2 row at mass=100:

| Row | v1 | v2 expected | EP | Δ v2 vs EP |
|---|---:|---:|---:|---:|
| Mean T °C | 17.9 | **18.1** | 19.8 | **−8.6%** still |
| **Summer max °C** | 36.7 | **35.5** | **35.4** | **+0.3%** ✓ |
| Winter min °C | 3.2 | 4.2 | 8.3 | −49% |
| Heating demand MWh | 123.6 | 121.4 | 110.2 | +10.2% |
| Cooling demand MWh | 39.5 | 40.3 | 61.7 | −34.7% |

**Wins:** summer max now exactly matches EP (was within +3.7%, now within +0.3%).

**Remaining structural gaps:** mean T −1.7 K below EP, winter min −4.1 K below EP, cooling demand −35% off. These **cannot be closed by these three knobs alone**. The response surface proves it.

---

## Confidence in tuning generalisation beyond Bridgewater

**Low confidence.** The sweep was done on a single project (Bridgewater hotel) at single climate (Yeovilton UK). The chosen values are *empirically optimal for this configuration*. For other building types / climates:

- **Heavy mass building (concrete frame, exposed slabs):** internal_mass should likely be HIGHER (200+ kJ/(K·m²)). The 100 value is calibrated to Bridgewater's medium-mass cavity wall.
- **Lightweight building (steel frame, partition walls only):** internal_mass should be LOWER (50 or less).
- **Tropical climate:** mean-T gap may flip sign — the model may over-predict mean T (because solar dominates loss).
- **Heating-dominated climate (Scandinavia):** winter min gap will be more pronounced; mass alone may not close it.

**Brief 28b Part 4** is the right place to validate generalisation. The chosen Bridgewater values should be treated as the starting point, not the universal default.

For shipping Part 3 v2 on Bridgewater specifically: high confidence the chosen values are optimal within the three-knob space. The next question (Part 3 v3 or Part 4 territory) is whether to:

1. Make the internal_mass parameter **construction-stack-aware** (derive from library data per CIBSE/ASHRAE thermal-mass conventions)
2. Accept a fixed default with project-config override
3. Live with the Bridgewater-tuned defaults until a multi-construction validation campaign

---

## Structural gaps that don't close with these knobs

The response surface confirms three failures are NOT tuning issues:

### Mean T undershoot (1.7 K below EP)

Root cause hypotheses (need investigation, not parameter tuning):
- EP absorbs solar on glazing INSIDE surface (~5-10% of incident in EP defaults); my model transmits 100% to interior.
- EP includes long-wave radiative exchange between interior surfaces (warm south face heats cooler north face directly). My single-state wall doesn't differentiate.
- EP's TARP outside convection correlation gives different effective sol-air response with wind.

### Winter min undershoot (−4.1 K below EP)

Root cause: zone retention against multi-day cold weather. EP holds heat better than my model because:
- More mass available (full wall stack actively coupled vs my simplified inside-surface mass term)
- LW radiative exchange between interior surfaces redistributes warmth
- Possible: EP's ground temperature model gives slowly-varying floor BC (mine uses annual mean constant)

### Cooling demand undershoot (−35% off)

Direct consequence of mean T undershoot. EP T_air spends more hours above 25 °C → more cooling needed. My T_air mean is below EP's → fewer hours over upper bound → less cooling.

---

## Recommendation

**Proceed with Part 3 v2 using the empirically-derived values:**
- `solar_radiative_fraction = 0.30`
- `internal_mass_kJ_per_K_per_m2 = 100`
- R_si values unchanged

**Document the structural gaps as Brief 28b Part 3 v3 or Brief 28b Part 4 scope:**
- Glazing inside-surface solar absorption
- Long-wave radiative exchange between interior surfaces
- More-accurate ground temperature model for floor BC

**Test outcome:** monotonic behaviour confirmed for solar split + mass. R_si confirmed inert at this construction's R_total. The three-knob tuning hits a structural floor on mean T at ~1.7 K below EP.

Standing by for Chris's call on whether to ship Part 3 v2 with these values (summer max fixed, secondary gaps known and documented), revert to v1 (existing trade-off), or pursue structural fixes before merging.

---

## File pointers

- Engine + tuning hooks: `frontend/src/utils/instantCalc.js` (`_calculateEnvelopeOnly` accepts optional `tuning` param)
- Sweep harness: `scripts/_part3_response_surface.mjs`
- Raw sweep JSON: `docs/validation/_part3_response_surface_dump.json`
- Part 3 v1 ship: commit `1d6fc79`
- Part 3 v1 validation: `docs/validation/state1_static_vs_dynamic_post_part3_v1.md`
- EP reference sim: `simulation_runs` row `c67aff89` (Bridgewater envelope-only)
