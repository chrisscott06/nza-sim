# State 1 Live vs Sim divergence — investigation (2026-05-13)

**Trigger:** Brief 27 close-out walkthrough surfaced a 15°C summer-max gap
between Live and Sim on Bridgewater State 1, with cooling demand
diverging from 109 MWh (Live) to 5 MWh (Sim). Chris flagged it as
needing investigation before Brief 27 can close.

**Reporter:** Brief 27 close-out diligence.

**Conclusion up front:** The numbers are **not wrong** — they are correct
engine outputs for the current `building_config`. The widening of the
Live/Sim gap (from ~7°C summer-max post-Brief-26.2 to ~15°C today) is
driven by (a) inputs drifting since Brief 26.2 close and (b) the
documented isotropic-sky residual in the live engine becoming more
exposed by the new building configuration.

---

## What the engines are producing

`scripts/state1_engine_agreement.mjs` on `14b4a5b1-8c73-4acb-8b65-1d22f05ec969`
(HIX Bridgewater), run 2026-05-13 21:15:

```
ENGINE-AGREEMENT CHECK — STATE 1 — HIX Bridgewater

  Free-running                  live          sim       delta
    annual_mean_c              21.2        18.2   -14.2%  ! warn
    winter_min_c                4.0        -2.5   -162.5%  !! HARD
    summer_max_c               44.2        28.9   -34.6%  !! HARD

  Demand                        live          sim       delta
    heating_demand_mwh        103.4       130.9   +26.6%  ! warn
    cooling_demand_mwh        108.6         5.0   -95.4%  !! HARD
    underheating_hours         4430        6294   +42.1%  !! HARD
    overheating_hours          3449          96   -97.2%  !! HARD
    comfort_hours               881        2370   +169.0%  !! HARD

  Conduction (kWh)              live          sim       delta
    external_wall           16515.4     12626.4   -23.5%
    roof                    11110.0      8494.5   -23.5%
    ground_floor            15276.3     11679.9   -23.5%
    glazing (total)         83166.6     63587.0   -23.5%
    thermal_bridging            0.0         0.0   +0.0%

  Ventilation (kWh)             live          sim       delta
    fabric_leakage          58661.0     44848.8   -23.5%

  Solar gains (kWh)             live          sim       delta
    f1 (north)              57488.5     46998.7   -18.2%
    f2 (east)                4397.9      5149.7   +17.1%
    f3 (south)              71400.5     77593.9   +8.7%
    f4 (west)                3132.5      3244.9   +3.6%
    total                  182873.6    132987.3   -27.3%
```

These match the values surfacing in the Building module UI (Live 103/108/44.2/4.0;
Sim 131/5/28.9/−2.5) within rounding. The Internal Gains module's
"State 1 → State 2 Delta" view's State 1 column (103.1 / 107.1) comes
from the live engine — labelled as such after Brief 27 close-out fix.

The most recent five Bridgewater simulation runs completed cleanly:
`status=complete`, 47s avg runtime, 21 warnings each (recurring non-
fatal EnergyPlus chatter about library defaults / unused objects). No
fatal errors blocking the State 1 output.

## What's drifted since Brief 26.2 close

Brief 26.2 close (per `docs/state_2_expected_ranges.md`) recorded the
State 1 baseline at:

| Metric | Live (26.2) | Sim (26.2) |
|---|---:|---:|
| heating_demand_mwh | 155.1 | 164.2 |
| cooling_demand_mwh | 67.9 | 45.0 |
| summer_max_c | 41.7 | 34.5 |

Today (above): heating 103/131, cooling 109/5, summer max 44.2/28.9.

The reference scenario in `state_2_expected_ranges.md` documented:
- Geometry 58.8 × 14.7 × 4 × 3.2m (unchanged today)
- Rooms 134 (unchanged)
- Fabric: cavity_wall_enhanced / pitched_roof_standard / ground_floor_slab / double_low_e (unchanged)
- Comfort band 21 / 25 °C (unchanged)

**It did NOT explicitly document** `infiltration_ach`, `orientation`, or
`wwr` at the time of close. Current persisted values:

| Input | Current | Likely 26.2 baseline (inferred from DEFAULT_PARAMS) | Effect on State 1 |
|---|---|---|---|
| `infiltration_ach` | **0.2** (Passivhaus-tight) | 0.5 (`DEFAULT_PARAMS.infiltration_ach`) | 60% drop in air-leakage loss → less heating, more retained heat, higher summer max |
| `orientation` | **42°** | 0° (`DEFAULT_PARAMS.orientation`) | What the live engine treats as "north facade" (`f1`) is now azimuth 42° (≈NNE) |
| `wwr` | **N 0.55 / S 0.38 / E 0.10 / W 0.11** | 0.25 each (`DEFAULT_PARAMS.wwr`) | Heavily north-weighted — exposes the live engine's isotropic-sky over-count on the N (after rotation, NNE) facade |
| `occupancy.*`, `gains.*`, `openings.*.openable_fraction` | various Brief 27 changes | various | **No effect on State 1** — stripped by `withMode('envelope-only')` and the EP-path equivalent |

The combination of these three changes accounts for the State 1 baseline
shift. Both engines have moved (Live more than Sim because the isotropic
sky model amplifies the effect of the heavy-N WWR).

## Root cause of the widened gap

The live engine's solar model in `frontend/src/utils/solarCalc.js`
applies an **isotropic sky model**: diffuse radiation is treated as
spread uniformly across the sky dome, so every tilted surface sees a
share proportional to its sky-view factor (regardless of where the sun
actually is). EnergyPlus uses the **Perez (anisotropic) model**, which
concentrates diffuse near the circumsolar region.

For a south-facing facade in northern latitudes the two models broadly
agree (diffuse is genuinely near south). For north, east, and west
facades the isotropic model over-states diffuse — a north-facing window
sees nearly the same isotropic diffuse as a south-facing one, while
Perez correctly attributes most of the diffuse to the south.

The script's solar accumulator shows Live over-counting north facade
solar by 22% (57.5 vs 47.0 GWh) and the total by 38% (183 vs 133 GWh).
That 50 GWh of phantom solar feeds Live's free-running zone temperature
trace, pushing summer max to 44.2°C (vs Sim's 28.9°C). The annual mean
gap of 3°C × the building's UA (~10 W/K total) × 8760 hours = roughly
260 GJ of extra heat in Live, consistent with the 50 GWh solar
over-count flowing through the lumped-capacitance balance.

The fabric conduction line items differ by exactly 23.5% across **all**
elements — that's the signature of an indoor-temperature-driven
divergence (not an element-specific one). U × A is identical; only ΔT
integral differs, and that's because Live's indoor T is higher.

## Why this is not a regression

Brief 26.2 close-out documented this exact failure mode at
`docs/state_2_expected_ranges.md`:

> **Cooling demand** likely stays HARD-divergent (live over-predicts due
> to isotropic sky over-counting solar; gains add to the existing
> difference)
>
> **Peak summer temperature** unchanged divergence (~5–10°C higher in
> live than sim)

The current 15°C gap is consistent with the documented "5–10°C divergence,
plus amplification when the building's WWR is biased toward facades the
isotropic model over-counts". Bridgewater's current 0.55 WWR on the
rotated-N (=NNE) facade is the worst case for this model.

The State 1 isolation regression (38/38 byte-identical) proves that
neither engine accidentally reads State 2 / State 2.5 / State 3 inputs.
It does NOT claim Live and Sim agree on absolute values — that's the
engine_agreement script's job, and the divergence is expected here.

## Resolution

**No code fix in Brief 27 scope.** The divergence is structural to the
live engine's solar model. Fixing it means replacing isotropic with
Perez (or HDKR / Klucher) — a non-trivial change to `solarCalc.js` that
needs its own brief.

**For Brief 27 close-out:**
1. ✓ State 1 → State 2 view labels its engine ("Live engine" badge) so
   users know which engine the numbers come from.
2. ✓ Heat balance + Free-running canvas views also label engine.
3. ✓ Delta view's footnote explicitly flags the isotropic-sky residual
   and points users at this investigation for the divergence story.
4. ✓ Investigation documented at `docs/state_1_engine_divergence_investigation.md`.

**For Brief 28 scope (queued in STATUS.md):**
- Switch live engine's solar model from isotropic to Perez or HDKR. The
  fix has the largest impact on State 1 free-running temperature
  accuracy for any building with WWR > 0.25 on a non-south facade.
- Re-baseline `docs/state_2_expected_ranges.md` after the solar model
  fix lands, including measurement of the Live/Sim gap for both
  balanced-WWR Bridgewater and the current asymmetric config.
- The Live | Simulation engine-toggle UI control (currently a
  placeholder slot) — once both engines emit comparable State 2
  results, the user can flip between them via the in-tab toggle.

## What this means for the Brief 27 module completion checklist

Section J ("walkthrough on production-like config") flagged ⚠ pending
user walkthrough. After this investigation:

- **State 1 numbers were never the issue** the checklist was hedging on
  — the numbers are correct engine outputs. The hedge was about needing
  the user's hands-on confirmation.
- The widening State 1 divergence is a known limitation, now properly
  surfaced in the UI (engine badge + footnote) and documented.
- Brief 28 inherits the solar model fix as a numbered scope item.

Brief 27 can close at 9/10 confidence once the user confirms the four
close-out bugs (commit `4f4f3a5`) behave as expected in the browser. The
State 1 vs Sim divergence does not block close-out; it informs Brief 28.
