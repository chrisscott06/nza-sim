# State 1 Live vs Sim divergence — investigation (2026-05-13)

> **[CORRECTED 2026-05-14]** Per `docs/physics_audit_2026_05.md`, two
> load-bearing claims in this investigation were overstated and one
> was an artefact of comparison methodology. See inline `[CORRECTED
> 2026-05-14]` blocks. Headline:
> - The "38% solar over-count / 50 GWh phantom solar" was a
>   pre-shading-vs-post-shading methodology error. Apples-to-apples
>   aggregate deviation is +1% (with ±19% per-facade redistribution
>   NNE vs SSW). See `physics_audit_2026_05.md` Audit 3.
> - The "23.5% uniform conduction divergence" was an artefact of
>   comparing Static (free-running) vs Dynamic (HVAC-clamped at 18°C
>   night / 21°C day). A true `mode=envelope-only` EP run with wide
>   setpoints is queued as the Brief 28 prerequisite. The 23.5% figure
>   is provisional. See `physics_audit_2026_05.md` Audit 1.
> - The HDKR/Perez solar model fix (now Brief 28b Part 2) is still
>   warranted, but its expected impact on State 1 agreement is smaller
>   than this doc originally claimed. The likely dominant cause of
>   Static's 44.2°C summer max is the lumped two-node thermal mass
>   model, not the sky model. See `physics_audit_2026_05.md` Audit 4
>   and Brief 28b Part 3.

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

> **[CORRECTED 2026-05-14]** The 38% / 50 GWh figures above came from
> comparing the Live engine's **pre-shading solar accumulator** (the
> raw input to the absorber, before overhang + fin shading is applied)
> against the Sim engine's **post-shading transmitted solar** (the
> shaded, glazing-attenuated total that actually reaches the zone).
> They are different quantities and were never directly comparable.
>
> Per `docs/physics_audit_2026_05.md` Audit 3, the apples-to-apples
> comparison (both engines, post-shading transmitted solar) on
> Bridgewater is:
>
> | Orientation | WWR  | Live vs Sim (post-shading transmitted) |
> |-------------|------|-----------------------------------------|
> | F1 (NNE)    | 0.55 | +19% Live over Sim                      |
> | F2 (SE)     | 0.10 | within ±5%                              |
> | F3 (SSW)    | 0.38 | −10% Live under Sim                     |
> | F4 (NW)     | 0.11 | within ±5%                              |
> | **Aggregate**| —   | **+1% Live over Sim**                   |
>
> The per-facade ±19% redistribution between NNE and SSW is real and is
> what the HDKR/Perez upgrade in Brief 28b Part 2 addresses. The "50
> GWh phantom solar" figure does not exist as a real engine divergence.
> The downstream reasoning (260 GJ extra heat, 3°C annual mean gap
> attributed to solar over-count flowing through lumped-capacitance) is
> therefore unsupported.
>
> The likely real driver of Static's high summer max (44.2°C) is the
> lumped two-node thermal mass model — see `physics_audit_2026_05.md`
> Audit 4 and the Brief 28b Part 3 multi-layer CTF mass-model overhaul.

The fabric conduction line items differ by exactly 23.5% across **all**
elements — that's the signature of an indoor-temperature-driven
divergence (not an element-specific one). U × A is identical; only ΔT
integral differs, and that's because Live's indoor T is higher.

> **[CORRECTED 2026-05-14]** The 23.5%-uniform-across-elements signature
> is real (U × A × ΔT integral is genuinely the same up to a single
> multiplicative factor across all elements), but the attribution above
> to "Live's indoor T is higher because of solar over-count" is wrong
> in two ways:
>
> 1. **Solar over-count framing is wrong.** Per the correction above
>    and `physics_audit_2026_05.md` Audit 3, aggregate transmitted
>    solar agrees to +1%. There is no 50 GWh of phantom solar driving
>    a 3°C indoor-T offset.
>
> 2. **The comparison was not apples-to-apples.** The Live engine here
>    is genuinely free-running (ideal loads at −60/+100°C setpoints,
>    no real conditioning). The Sim figures in the table at the top of
>    this doc came from a Dynamic EP run that was HVAC-clamped (18°C
>    night / 21°C day setback). One engine is unconditioned; the other
>    is conditioned. Of course the ΔT integrand differs uniformly —
>    the conditioned engine has its T held in the comfort band most of
>    the year, the unconditioned engine drifts. That's a comparison
>    artefact, not a physics divergence.
>
> A true `mode=envelope-only` EP run with wide setpoints exists in the
> assembler (`epjson_assembler.py:1358` supports −60/+100°C) but has
> not been persisted yet. Brief 28 prerequisite (`docs/briefs/active/
> 28_prereq_free_running_ep.md`) ships it. When that run lands, the
> engine_agreement script will be re-run against comparable free-
> running Dynamic output. The 23.5% figure is provisional and almost
> certainly will not survive apples-to-apples comparison.

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

> **[CORRECTED 2026-05-14]** "Largest impact on State 1 free-running
> temperature accuracy" is overstated. Per `physics_audit_2026_05.md`,
> the HDKR/Perez fix's expected impact on summer max is small (the
> dominant divergence cause is the mass model, not the sky model).
>
> The work is now structured across the May 2026 batch (see
> `docs/briefs/batch_orchestration_2026_05.md`):
> - **Brief 28 prerequisite** — persist a free-running EP run so the
>   engine comparison is honest. Without this, all the "Live high by
>   X%" claims in this doc are confounded with HVAC clamping.
> - **Brief 28a** — engine toggle wiring + UX (terminology rename
>   "Live → Static", "Simulation → Dynamic", kWh/m²·yr readouts,
>   canvas restructure).
> - **Brief 28b Part 2** — isotropic → HDKR sky model. Addresses the
>   real ±19% per-facade redistribution between NNE and SSW.
> - **Brief 28b Part 3** — multi-layer CTF (or simplified multi-node)
>   thermal mass model. Expected dominant lever for closing the
>   Static-Dynamic summer-max gap.
>
> Re-baselining `state_2_expected_ranges.md` happens after both physics
> fixes land (Brief 28b Part 5), with the new Bridgewater Static vs
> Dynamic numbers measured against the now-correct free-running
> Dynamic trace.

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

---

## Update 2026-05-14 — Brief 28 prereq Option C+ findings

The Brief 28 prereq (free-running EP simulation) landed via Option C+:
zero the People density placeholder, persist a genuine envelope-only EP
run for Bridgewater, repoint `state1_engine_agreement.mjs` to use it.
New persisted run: **`8d7fc517`** (`simulation_mode='envelope-only'`,
runtime 35.4 s, 20 warnings, 0 fatal). The engine-agreement comparison
is now Static-truly-free-running vs Dynamic-truly-free-running.

### Corrected comparison (`8d7fc517`)

| Metric                  | Live (Static) | Sim free-running | Δ           | Previous Sim (HVAC-clamped re-parse) |
|-------------------------|---------------|------------------|-------------|--------------------------------------|
| annual_mean_c           | 21.2 °C       | **19.8 °C**      | −6.6%       | 18.2 °C                              |
| winter_min_c            |  4.0 °C       |  **8.3 °C**      | +107%       | −2.5 °C                              |
| summer_max_c            | 44.2 °C       | **35.4 °C**      | −19.9%      | 28.9 °C                              |
| heating_demand_mwh      | 103.4         | **110.2**        | +6.6%       | 130.9                                |
| cooling_demand_mwh      | 108.6         |  **61.7**        | −43.2%      | 5.0                                  |
| underheating_hours      | 4430          |  4618            | +4.2%       | 6294                                 |
| overheating_hours       | 3449          |  2746            | −20.4%      | 96                                   |
| Conduction (any element)| —             | —                | **−6.8%**   | −23.5%                               |
| Fabric leakage          | —             | —                | **−6.8%**   | −23.5%                               |

### Verdicts vs prior findings

**The 23.5% uniform conduction divergence WAS the HVAC-clamping
artefact, almost entirely.** The corrected comparison shows the
across-all-elements ΔT-integrand difference dropped from −23.5% to
−6.8%. The remaining 6.8% is real physics divergence (Static's annual
mean T of 21.2 °C vs Sim's 19.8 °C — a 1.4 K offset that flows through
conduction uniformly). That residual is consistent with the lumped vs
multi-layer mass model story.

**Mass-model summer-max story holds, smaller magnitude.** The Static
free-running engine still over-predicts summer max compared to Dynamic
free-running, but the gap is **8.8 K (44.2 → 35.4 °C)**, not the ~15 K
the previous HVAC-clamped comparison showed. Brief 28b Part 3
(multi-layer CTF / multi-node mass model) is still the right fix; the
magnitude target should be revised to "close the 8.8 K gap" rather
than "close the 15 K gap."

**Winter-min flipped sign.** Dynamic free-running shows +8.3 °C winter
min, not the −2.5 °C the HVAC-clamped re-parse showed. Static's 4.0 °C
is now LOWER than Dynamic's 8.3 °C — Static may be **under-predicting**
winter min by ~4 K because its lumped two-node lacks thermal storage
that EP's full construction stack provides. This is the same mass
model story playing out on the opposite seasonal extreme.

**Cooling demand divergence is real but smaller.** Static 108.6 MWh vs
Dynamic 61.7 MWh = −43% (Static high). The previous −95% was almost
entirely the HVAC-clamping artefact (clamped Sim T → no cooling
demand). The real −43% comes from Static's summer-max over-prediction
flowing through the demand integral.

### Open question — solar aggregate disagreement

The corrected engine-agreement output still shows total annual solar
gain Live 182,873 kWh vs Sim 132,987 kWh = **−27.3%** aggregate.
`docs/physics_audit_2026_05.md` Audit 3 reported the apples-to-apples
post-shading transmitted aggregate at +1%. These two numbers cannot
both be right. The per-facade ratios from engine_agreement
(Live −22% on NNE, Live +8.7% on SSW) roughly match the audit's +19% /
−10% per-facade finding, but the aggregate doesn't reconcile.

Probable cause: `state1_engine_agreement.mjs` may be reading the live
engine's pre-shading or pre-glazing-attenuation solar accumulator
(`live.gains.solar.*`) and comparing it to the parser's post-shading
transmitted figure (`sim.gains.solar.*`). The audit drilled into this
precisely and found the +1% aggregate at the post-shading-transmitted
boundary on both sides.

Filed as a follow-up — clarify which solar accumulator each side reads
and reconcile the aggregate. Likely lives in Brief 28b Part 2 (solar
model upgrade) scope since the HDKR fix touches the same code path.

### Implications for the May 2026 batch

- **Brief 28b Part 2 (HDKR/Perez solar)** — still warranted for the
  ±19% per-facade redistribution between NNE and SSW. Aggregate impact
  remains uncertain pending the solar accumulator reconciliation above.
- **Brief 28b Part 3 (multi-layer CTF mass model)** — confirmed as the
  dominant physics fix needed. Revised target: close the 8.8 K
  summer-max gap and the ~4 K winter-min sign-flip. Expected to also
  shrink the 6.8 K residual conduction delta toward zero.
- **`docs/state_2_expected_ranges.md` re-baseline** (Brief 28b Part 5)
  should use these new free-running Dynamic numbers as the comparison
  baseline rather than the historical HVAC-clamped re-parse numbers.

### How to reproduce

1. Ensure `simulation_mode` column exists on `simulation_runs`:
   `python scripts/migrate_add_simulation_mode.py` (idempotent).
2. Persist the envelope-only EP run:
   ```
   $env:ENERGYPLUS_DIR = "C:\EnergyPlusV26-1-0"
   python scripts/run_envelope_only_sim_bridgewater.py
   ```
3. Re-run the agreement check (auto-picks the newest envelope-only run):
   ```
   node scripts/state1_engine_agreement.mjs
   ```
   Or pass the run_id explicitly: `node scripts/state1_engine_agreement.mjs <project_id> <run_id>`.
