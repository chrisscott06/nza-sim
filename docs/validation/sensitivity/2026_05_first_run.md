# Sensitivity tests — first run (2026-05-14)

**Tests:** A1 (double length) + A2 (rotate 90°). Both envelope-only (State 1).
Baseline established in the same run for consistency — see "Baseline note" below.

**Method:** `scripts/state_sensitivity_test.mjs` applies overrides to the
fetched Bridgewater config in memory only. Persisted DB config untouched.

**Raw JSON outputs** in this directory:
- `baseline_2026-05-14T14-00-15-534Z.json`
- `A1_double_length_2026-05-14T14-01-12-742Z.json`
- `A2_rotate_90_2026-05-14T14-01-18-805Z.json`

---

## ⚠ Baseline note — config changed between morning extract and this run

The persisted Bridgewater config has `infiltration_ach: 0.1` at the time
of this run (2026-05-14T14:00 UTC). This morning's extract
(`docs/validation/_dump.json`, generated 2026-05-14T13:24 UTC) had
`infiltration_ach: 0.2`. The config was edited in the live app between
those two times — likely during Chris's live repro investigation. Effects
on State 1 outputs:

| Field | Morning (ach=0.2) | Now (ach=0.1) | Reason |
|---|---:|---:|---|
| Fabric leakage kWh | 58,661 | 34,817 | UA_leakage halves with ach |
| External wall loss kWh | 16,515 | 19,605 | Less infiltration → warmer zone → more dT_air-positive hours → more conduction |
| Roof loss kWh | 11,110 | 13,188 | same |
| Ground floor loss kWh | 15,276 | 18,134 | same |
| Glazing loss kWh | 83,167 | 98,723 | same |
| Heating demand MWh | 103.4 | 79.6 | Less infiltration loss → less heat needed |
| Cooling demand MWh | 108.6 | 122.4 | Warmer zone → more cooling needed |
| Annual mean T °C | 21.2 | 22.9 | Less air change → less coupling to outside |
| Summer max T °C | 44.2 | 47.1 | Same |

Solar values UNCHANGED across the edit (solar depends only on geometry +
orientation + glazing area + g-value + shading factors + weather). The
fact that ALL non-solar metrics moved together is exactly what you'd
expect from halving infiltration, and is consistent with the engine's
two-node mass model.

**Implication:** the morning's `bridgewater_state1_engine_outputs_2026_05.md`
docs are stale w.r.t. the current persisted config. Recommend either
re-generating them or annotating as a historical snapshot. The
sensitivity tests below use the *current* baseline so deltas are
honest.

---

## Configuration matrix

| Field | Baseline | A1: length 2× | A2: rotate 90° |
|---|---:|---:|---:|
| Length m | 58.8 | **117.6** | 58.8 |
| Width m | 14.7 | 14.7 | 14.7 |
| Floors | 4 | 4 | 4 |
| Floor height m | 3.2 | 3.2 | 3.2 |
| Orientation ° | 42 | 42 | **132** |
| Infiltration ACH | 0.1 | 0.1 | 0.1 |
| WWR N/S/E/W | 0.55 / 0.38 / 0.10 / 0.11 | same | same |
| GIA m² | 3,457 | **6,915** | 3,457 |
| Volume m³ | 11,062 | **22,125** | 11,062 |

---

## Side-by-side results

### Compass labels (engine-canonical, derived from `params.orientation`)

| Facade | Baseline | A1 | A2 |
|---|---|---|---|
| F1 (building-local north) | NE | NE | **SE** |
| F2 (building-local east)  | SE | SE | **SW** |
| F3 (building-local south) | SW | SW | **NW** |
| F4 (building-local west)  | NW | NW | **NE** |

A1 doesn't rotate → labels identical to baseline. A2 rotates 90° CW → each facade label advances 2 positions in the compass (NE → SE → SW → NW → NE).

### Solar gain (kWh/year)

| Element | Baseline | A1 value | A1 Δ | A1 Δ% | A2 value | A2 Δ | A2 Δ% |
|---|---:|---:|---:|---:|---:|---:|---:|
| F1 | 57,488.5 | 114,977.0 | +57,488.5 | **+100.0%** | 104,273.1 | +46,784.6 | +81.4% |
| F2 | 4,397.9 | 4,397.9 | 0 | **0.0%** | 4,819.5 | +421.6 | +9.6% |
| F3 | 71,400.5 | 142,801.0 | +71,400.5 | **+100.0%** | 42,188.9 | −29,211.6 | −40.9% |
| F4 | 3,132.5 | 3,132.5 | 0 | **0.0%** | 2,667.1 | −465.4 | −14.9% |
| Roof | 46,454.2 | 92,908.5 | +46,454.3 | **+100.0%** | 46,454.2 | 0 | 0.0% |
| **Total** | **182,873.6** | **358,216.8** | +175,343.2 | **+95.9%** | **200,402.9** | +17,529.3 | +9.6% |

### Loss elements (kWh/year)

| Element | Baseline | A1 value | A1 Δ | A1 Δ% | A2 value | A2 Δ | A2 Δ% |
|---|---:|---:|---:|---:|---:|---:|---:|
| External wall | 19,604.7 | 33,740.7 | +14,136.0 | +72.1% | 21,459.1 | +1,854.4 | +9.5% |
| Roof | 13,188.2 | 26,623.1 | +13,434.9 | **+101.9%** | 14,435.7 | +1,247.5 | +9.5% |
| Ground floor | 18,133.8 | 36,606.7 | +18,472.9 | **+101.9%** | 19,849.1 | +1,715.3 | +9.5% |
| Glazing | 98,723.2 | 193,968.1 | +95,244.9 | +96.5% | 108,061.6 | +9,338.4 | +9.5% |
| Thermal bridging | 0.0 | 0.0 | 0 | — | 0.0 | 0 | — |
| Fabric leakage | 34,816.9 | 70,284.9 | +35,468.0 | **+101.9%** | 38,110.3 | +3,293.4 | +9.5% |
| Permanent vents | 0.0 | 0.0 | 0 | — | 0.0 | 0 | — |

### Demand (MWh/year)

| Field | Baseline | A1 value | A1 Δ | A1 Δ% | A2 value | A2 Δ | A2 Δ% |
|---|---:|---:|---:|---:|---:|---:|---:|
| Heating demand | 79.6 | 153.8 | +74.2 | +93.2% | 76.2 | −3.4 | −4.3% |
| Cooling demand | 122.4 | 241.1 | +118.7 | +97.0% | 139.2 | +16.8 | +13.7% |
| Comfort hours | 769 | 767 | −2 | — | 770 | +1 | — |
| Underheating hours | 3,983 | 3,960 | −23 | — | 3,799 | −184 | — |
| Overheating hours | 4,008 | 4,033 | +25 | — | 4,191 | +183 | — |

### Free-running zone temperature (°C)

| Field | Baseline | A1 value | A1 Δ | A2 value | A2 Δ |
|---|---:|---:|---:|---:|---:|
| Annual mean | 22.9 | 23.1 | +0.2 | 24.1 | +1.2 |
| Winter min | 5.2 | 5.3 | +0.1 | 5.1 | −0.1 |
| Summer max | 47.1 | 47.5 | +0.4 | 50.0 | +2.9 |

### Per-m² intensity checks (A1 only — A2 doesn't change GIA)

These confirm A1's per-area intensities stay roughly constant, which is
the predicted shape for "linear-in-size" envelope physics.

| Field | Baseline (kWh/m²·yr) | A1 (kWh/m²·yr) | Δ |
|---|---:|---:|---:|
| External wall loss / wall_opaque | 19,604.7 / 1,142 = 17.17 | 33,740.7 / 1,948 = 17.32 | +0.9% |
| Roof loss / roof area | 13,188.2 / 864 = 15.27 | 26,623.1 / 1,728 = 15.41 | +0.9% |
| Ground floor loss / ground area | 18,133.8 / 864 = 20.99 | 36,606.7 / 1,728 = 21.18 | +0.9% |
| Glazing loss / glazing area | 98,723.2 / 739 = 133.6 | 193,968.1 / 1,439 = 134.8 | +0.9% |
| Heating demand / GIA | 79.6 × 1000 / 3,457 = 23.0 | 153.8 × 1000 / 6,915 = 22.2 | −3.5% |
| Cooling demand / GIA | 122.4 × 1000 / 3,457 = 35.4 | 241.1 × 1000 / 6,915 = 34.9 | −1.4% |

---

## Observations vs. predictions

### Test A1 — Double length (`length: 58.8 → 117.6`)

**Predicted:** all gains/losses ~2×, per-m² constant.

**Actual:** depends on which dimension scales with length:

- **Doubles cleanly (×2.00):**
  - F1 solar (north glazing area = length × floor_height × num_floors × WWR_N — scales with length)
  - F3 solar (south, same logic)
  - Roof solar (roof area = length × width — scales with length)
  - Roof + ground losses (areas scale with length)
  - Fabric leakage (volume = length × width × num_floors × floor_height — scales with length)
- **Doesn't change (×1.00):**
  - F2 solar + F4 solar (east + west glazing areas depend on width × floor_height, not length)
- **Partial scaling:**
  - External wall loss: 1.72× (N + S walls grow with length, E + W walls don't; ext_wall total scales as `0.70 × 2× + 0.30 × 1× = 1.70` based on baseline opaque-wall apportionment)
  - Glazing loss: 1.96× (N + S glazing dominate the area, E + W are small contributors)
  - Total solar: 1.96× (same logic — F1 + F3 dominate)

**Pass criteria:**

| Item | Predicted | Actual | Pass/fail |
|---|---|---|---|
| F1 solar doubles | ×2.00 | ×2.00 (57,488.5 → 114,977.0, ratio 2.000) | **PASS** |
| F3 solar doubles | ×2.00 | ×2.00 (71,400.5 → 142,801.0, ratio 2.000) | **PASS** |
| F2 solar unchanged | ×1.00 | ×1.00 (4,397.9 → 4,397.9, exact) | **PASS** |
| F4 solar unchanged | ×1.00 | ×1.00 (3,132.5 → 3,132.5, exact) | **PASS** |
| Roof solar doubles | ×2.00 | ×2.0000 (46,454.2 → 92,908.5, ratio 2.0000) | **PASS** |
| Roof loss doubles | ×2.00 | ×2.019 | **PASS** (small uplift expected — T trace shifts when GIA doubles) |
| Ground floor loss doubles | ×2.00 | ×2.019 | **PASS** (same reasoning) |
| Fabric leakage doubles | ×2.00 | ×2.019 | **PASS** (same reasoning) |
| External wall loss × 1.70 | ×1.70 | ×1.721 | **PASS** |
| Glazing loss × 1.95 | ×1.95 | ×1.965 | **PASS** |
| Demand roughly doubles | ~×2 | Heating ×1.93, Cooling ×1.97 | **PASS** |
| Per-m² intensities constant | ±5% | Wall +0.9%, Roof +0.9%, Floor +0.9%, Glazing +0.9%, Heat-EUI −3.5%, Cool-EUI −1.4% | **PASS** |
| Annual mean T unchanged | ±0.5 K | +0.2 K | **PASS** |

**Overall A1 verdict: PASS.** Engine responds correctly to geometry doubling.
The "~2×" prediction is too coarse — the actual shape depends on which
inputs scale with length (N + S walls, glazing, roof, ground, volume) vs.
which don't (E + W walls, glazing). All scalings are physically correct.

The small +1.9% uplift on the "should-be-exactly-2×" items (roof loss,
ground loss, fabric leakage) is from the integration window — A1 has
slightly more dT_air-positive hours because the bigger building has a
slightly different T_op trace (mass scales with surface area, not as
fast as volume; net coupling shifts).

### Test A2 — Rotate 90° (`orientation: 42 → 132`)

**Predicted:** F1 rises (NE → SE), F3 falls (SW → NW), F2/F4 also shift.

**Actual:**

| Facade | Baseline compass | A2 compass | Predicted direction | Actual | Pass/fail |
|---|---|---|---|---|---|
| F1 | NE | SE | UP (NE is dimmer than SE) | +81.4% (57,488 → 104,273) | **PASS** |
| F2 | SE | SW | slight change (SE 867 ≈ SW 806 kWh/m²·yr) | +9.6% (4,398 → 4,820) | **PASS** |
| F3 | SW | NW | DOWN (SW is brightest after S; NW is dimmest after N) | −40.9% (71,401 → 42,189) | **PASS** |
| F4 | NW | NE | slight change (NW 503 vs NE 448 kWh/m²·yr — NE slightly dimmer) | −14.9% (3,133 → 2,667) | **PASS** |
| Total solar | — | — | small net change | +9.6% (182,874 → 200,403) | **PASS** |

The +81%/−41% asymmetry on F1 and F3 reflects two effects: (a) F1 has
the biggest glazing area (414 m²) so its facade-direction change dominates
the total-solar shift, and (b) the SE-to-NW pair has the biggest
irradiance spread of any rotation by 90°.

**Loss elements all move +9-10% uniformly with A2.** This is consistent
physics: rotating the building changes solar absorption, which warms the
zone, which increases the integral of (dT_air when dT_air > 0). Conduction
losses scale with this integral. All four loss elements scaling with
identical +9.5% is the signature of a uniform T-trace shift — exactly the
expected shape.

**Free-running summer max rises +2.9 K (47.1 → 50.0).** Consistent with
the rotated building catching more solar at peak (F1 SE-facing in summer
gets strong morning + midday sun on its large glazing area).

**Overall A2 verdict: PASS.** Solar gains shift in the predicted direction
on every facade. The asymmetric magnitudes (+81% / −41% on the big
facades, −15% / +10% on the small ones) reflect both the irradiance
spread and the glazing-area weighting, both correct.

---

## Cross-cutting observations

1. **Engine is deterministic and reproducible.** Re-running with `{}`
   override (baseline) twice produced byte-identical output both times.
   The script can be trusted for invariance assertions.

2. **A2 didn't change GIA — losses moved +9.5% despite same envelope
   geometry.** This is the expected physics: rotation changes the solar
   loading on the mass node, which raises T_air, which integrates more
   conduction. *This means the engine DOES propagate temperature trace
   changes into conduction loss accumulators — a useful data point for
   the Problem 4 contract question (does State 2 do the same with
   internal gains? Code says no; this proves the mechanism exists in
   State 1, it just isn't wired through into State 2.)*

3. **Irradiance-table labeling bug spotted in this morning's extract.**
   The `DIRECTIONS` rotateBy values in `_validation_dump.mjs` were
   inverted 180° relative to the convention. Recomputed values:
   N 378.9 / NE 448.4 / E 629.5 / SE 806.5 / S 889.1 / SW 866.9 / W
   711.1 / NW 503.4 kWh/m²·yr. The morning's `yeovilton_epw_summary.md`
   should be updated. The State 1 + State 2 engine outputs are
   unaffected (different code path through `computeHourlySolarByFacade`
   driven by `params.orientation`, not by the diagnostic loop).

4. **The +1.9% uplift on A1's "should-double" losses** suggests the
   engine couples solar to T_air to conduction tightly. Worth confirming
   on B1 (zero U-values) and B3 (zero infiltration) — those tests should
   isolate the coupling and produce cleaner exact-zero results.

---

## Next tests to run

Section B (envelope invariants) is the next batch: B1 zero U-values, B2
zero glazing, B3 zero infiltration, B4 double infiltration, B5 zero
shading. All scriptable with the same harness. Each should land in a
new sensitivity-test JSON file + a comparison row in this doc (or a
followup doc).

Section F (cross-State byte-identity) is unblocked too — re-run any test
with `--gains` flag and compare `state1.solar_facades` vs
`state2.solar_facades` byte-for-byte.

---

## File pointers

- Script: `scripts/state_sensitivity_test.mjs`
- Raw JSON: `docs/validation/sensitivity/*.json` (this directory)
- Runbook: `docs/validation/state_1_invariance_tests.md`
- Baseline inputs: `docs/validation/bridgewater_baseline_inputs.md`
- Earlier State 1 extract (stale wrt current config): `docs/validation/bridgewater_state1_engine_outputs_2026_05.md`
- EPW summary (irradiance table needs correction): `docs/validation/yeovilton_epw_summary.md`
