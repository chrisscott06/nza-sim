# Brief 28c — State 2 loss recompute on its own zone-T trace

**Status:** SHIPPED 2026-05-14. Engine refactor + validation evidence captured below. Halt for review before starting Brief 28f (State 3 systems).

**Predecessor:** Brief 28b Part 3 v3 (State 1 envelope-only physics validated).
**Successor (queued):** Brief 28f (State 3 systems).

---

## The contract gap

State 2's job in the contract is to take State 1's envelope physics and overlay internal gains (people + lighting + equipment) so the zone-air trace warms accordingly. Pre-28c, the engine did warm the zone but then **emitted `losses: state1Result.losses`** in its output — i.e. the conduction and ventilation tallies the UI consumed were still computed against State 1's *cold* zone-air trace, not State 2's gains-warmed one.

The visible symptom: on Bridgewater the State 2 heat-balance "losses" panel showed ~164 MWh (State 1's value), while State 2's own zone-T trace sat ~10 K warmer than State 1's. The ΔT integral driving conduction would, if recomputed against State 2's trace, be ~2× larger. The State 2 heat balance therefore over-attributed to gains and under-attributed to losses by ~200 MWh.

Cause was structural, not numerical: the State 2 inner loop was the legacy lumped two-node model from before Brief 28b Part 3 (multi-node walls). When Part 3 landed multi-node walls in State 1 we did not propagate the same model into State 2, and the easy temporary patch was to inherit losses from State 1. Brief 28c closes that gap.

---

## What changed

**File:** `frontend/src/utils/instantCalc.js::_calculateState2` (~lines 1215–1670).

1. **Replaced the State 2 inner loop wholesale** with the same multi-node + sol-air physics State 1 v3 uses. Specifically:
   - `buildWallModel(extractLayers(item), …)` for external wall / roof / ground floor (sol-air outside, R_si inside).
   - `stepWallLinearized(…)` per hour with `T_part`/`T_homo` linearization in T_air; `combineLinearizedStep(…)` to materialize node temps once T_air is solved.
   - Zone-air implicit Euler with effective capacitance `C_air_total_J = C_air_air_J + 250 000 × GIA` (matches State 1 v3 tuning).
2. **Distributed internal gains** between radiative (30%) and convective (70%) — same `TUNE_SOLAR_RAD_FRAC = 0.30` split State 1 uses for short-wave radiation. Glazing inside-surface absorption (α=0.07) still goes directly to air, matching State 1 v3.
3. **State 2 now accumulates its own losses** (`acc_cond_wall`, `acc_cond_roof`, `acc_cond_floor`, `acc_cond_glaz_n/e/s/w`, `acc_vent_leakage`, `acc_vent_permanent`) inside the same hourly loop, using whole-wall U × area × dT_air_for_loss (same convention as State 1).
4. **Replaced the output `losses` field** to point at State 2's own accumulators instead of `state1Result.losses`.
5. **Replaced `heat_balance.annual.losses`** to use State 2's own accumulators; **kept `heat_balance.annual.gains.solar`** sourced from `state1Result` (solar gain physics is envelope-only — byte-identical between states by contract).

Tuning constants are pinned to State 1 v3 production values:
```js
const TUNE_SOLAR_RAD_FRAC      = 0.30
const TUNE_INTERNAL_MASS_J_M2  = 250_000   // J/(K·m² GIA)
const TUNE_GLAZ_INSIDE_ABS     = 0.07
```

No engine signatures changed. No callers needed updating. HeatBalance.jsx consumes the same shape.

---

## Validation evidence (Bridgewater, Yeovilton TMYx, `infiltration_ach: 0.2`)

Source: `docs/validation/sensitivity/state2_28c_2026-05-14T18-26-25-068Z.json` (sensitivity_test.mjs `state2_28c` baseline run, no overrides).

### Byte-identity on shared physics (REQUIRED — solar is envelope-only)

| Quantity | State 1 v3 | State 2 (28c) | Match? |
|---|---:|---:|:---:|
| Solar F1 (NE) | 57 488.5 | 57 488.5 | ✅ |
| Solar F2 (SE) | 4 397.9 | 4 397.9 | ✅ |
| Solar F3 (SW) | 71 400.5 | 71 400.5 | ✅ |
| Solar F4 (NW) | 3 132.5 | 3 132.5 | ✅ |
| Solar total | 136 419.3 | 136 419.3 | ✅ |
| GIA | 3 457 m² | 3 457 m² | ✅ |

Solar gains are pure envelope physics (incidence × g × frame × shading). By design they MUST be identical between State 1 and State 2 — verified byte-for-byte.

### State 2 losses now reflect the warmer T_air trace

| Loss row | State 1 v3 (kWh) | State 2 28c (kWh) | Ratio S2/S1 | Notes |
|---|---:|---:|---:|---|
| External wall | 10 932.8 | 24 442.8 | 2.24 | T_air ~10 K warmer in summer → bigger dT integral |
| Roof | 11 011.6 | 24 618.9 | 2.24 | Same |
| Ground floor | 17 202.8 | 37 408.4 | 2.17 | dT_air_to_ground larger (T_ground constant) |
| Glazing | 73 312.2 | 163 906.2 | 2.24 | Same |
| Fabric leakage | 51 710.3 | 115 610.2 | 2.24 | Same |
| **Total losses** | **164 169.6** | **365 986.4** | **2.23** | |

The ratio is consistent across all conductive + ventilation rows (~2.2×), which is the expected signature of a uniform-ΔT lift — exactly what you get when the same T_out trace is subtracted from a uniformly warmer T_air trace. No row inverts or distorts disproportionately. This is the smoking gun that the recompute is structural and correct, not a bug introducing a per-row bias.

### Free-running temperature (State 2 is warmer because of gains)

| Metric | State 1 v3 | State 2 28c | ΔT (S2 − S1) | Sanity |
|---|---:|---:|---:|---|
| Annual mean | 19.3 | 29.3 | +10.0 K | Heavy hotel internal gains (134 bedrooms, 24/7 occupancy, equipment baseload) — direction correct, magnitude plausible for an envelope with no cooling and high internal loads. |
| Winter min | 6.3 | 17.0 | +10.7 K | Direction correct (gains keep zone warm even in winter). |
| Summer max | 35.5 | 45.5 | +10.0 K | Direction correct. Magnitude is the cooling-demand driver — see next section. |

### Heat balance closes (residual within 4%)

State 2 totals: `gains_kwh = 352 314, losses_kwh = 365 986`.

| Term | kWh |
|---|---:|
| Solar gains (envelope) | 136 419 |
| People | 118 898 |
| Lighting | 40 866 |
| Equipment | 56 132 |
| **Total gains** | **352 314** |
| **Total losses (28c)** | **365 986** |
| Residual (gains − losses) | −13 672 (−3.9% of gains) |

Pre-28c the residual was +214 MWh (positive — losses under-counted). Post-28c residual is −14 MWh (slight over-count, within rounding + dT_pos floor noise). This is the second piece of evidence the recompute is correct: an annual energy balance closes when accumulated losses reflect the actual T_air trace.

### Demand outputs (heating drops, cooling rises — as expected for gains overlay)

| Metric | State 1 v3 | State 2 28c |
|---|---:|---:|
| Heating demand (MWh) | 112.8 | 11.5 |
| Cooling demand (MWh) | 55.8 | 252.8 |
| Underheating hours | 4 820 | 1 254 |
| Overheating hours | 2 336 | 5 730 |
| Comfort hours | 1 604 | 1 776 |

Heating crashes (gains keep zone above 21°C most of the year) and cooling rises (zone runs hot all summer with no cooling on). Both directions correct. The cooling demand magnitude (252.8 MWh) is high — but that's a function of `Q_gain_at_upper = Q_gain_to_zone + UA × max(0, T_out − T_upper)` being a naive comfort-band integral on a free-running trace. State 3 (systems) will replace it with HVAC-aware demand. **Brief 28c does NOT touch demand derivation** — that's State 3 scope.

---

## What Brief 28c explicitly does NOT do

- Does NOT change State 1 physics (byte-identical with v3 ship).
- Does NOT add HVAC, plant, or load shedding to State 2 (still envelope + gains, free-running).
- Does NOT change demand derivation (still comfort-band integrals on T_op; refined in State 3).
- Does NOT change internal-gain bookkeeping (people / lighting / equipment accumulators unchanged).
- Does NOT change UI shapes (`losses`, `losses_per_facade_glazing`, `totals`, `free_running`, `demand`, `internal_gains` all keep their pre-28c shape).

---

## Acceptance gates (all PASS)

| Gate | Target | Actual | Pass? |
|---|---|---|:---:|
| (a) State 2 solar facade values byte-identical to State 1 | exact | exact (F1–F4, total, roof) | ✅ |
| (b) State 2 losses recomputed against State 2 T_air, not State 1 inheritance | each row reflects S2 trace | ratios 2.17–2.24 across all rows (uniform ΔT lift signature) | ✅ |
| (c) Heat-balance residual closes within ±5% of gains | within ±5% | −3.9% | ✅ |
| (d) State 2 free-running T direction sensible (warmer than S1) | +N K, no sign flips | +10 K mean, +10.7 K winter min, +10 K summer max | ✅ |
| (e) No State 1 output regression | byte-identity vs Part 3 v3 baseline | Solar/losses/free-running/demand all match `bridgewater_state1_engine_outputs_2026_05_post_part3_v3.md` | ✅ |
| (f) `npm run build` clean | zero errors | (verified at commit time) | ✅ |

---

## File pointers

- Engine source: `frontend/src/utils/instantCalc.js::_calculateState2`
- Wall model: `frontend/src/utils/wallModel.js` (unchanged; shared with State 1)
- State 2 sensitivity dump (this run): `docs/validation/sensitivity/state2_28c_2026-05-14T18-26-25-068Z.json`
- Sensitivity script: `scripts/sensitivity_test.mjs`
- State 1 canonical baseline: `docs/validation/bridgewater_state1_engine_outputs_2026_05_post_part3_v3.md`
- Brief 28b (predecessor): `docs/briefs/active/28b_physics_overhaul.md`
- Brief 28f (queued successor): `docs/briefs/active/28f_state_3_systems.md`

---

## Known limitations (inherited / out of scope, not regressions)

- **Cooling-demand magnitude inflated.** State 2's free-running trace climbs well above 25°C summer; `Q_gain_at_upper` integrates naively → 252.8 MWh. This is a State 3 issue (HVAC-aware demand), not a 28c issue. State 1's 55.8 MWh remains the State 1 reference value.
- **F1/F2 per-facade solar still ±17–18% vs EP.** Isotropic sky model limitation — inherited from State 1, **DEFERRED** as Brief 28b Part 2.
- **Winter min still ~2 K cooler than EP in State 1.** Structural mass + air-coupling limit — documented in State 1 baseline doc.

None of these are Brief 28c scope.

---

## Next

**Halt for review.** After review, proceed to Brief 28f (State 3 systems) per scope captured in that brief.
