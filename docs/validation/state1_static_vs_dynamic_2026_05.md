# State 1 — Static vs Dynamic engine comparison (Bridgewater, 2026-05-14)

---

## Brief 28b Part 3 v1 update (2026-05-14T16:xx)

**Multi-node implicit RC mass model landed.** Headline change: summer max
gap closed from 8.8 K → 1.3 K. Other improvements + new failures listed below.

Engine commit (next push). New components:
- `frontend/src/utils/wallModel.js` — per-layer multi-node implicit RC solver, sol-air helper, Thomas tridiagonal.
- `_calculateEnvelopeOnly` refactor — sol-air boundary on opaque walls + roof, distributed solar (50% to opaque inside surfaces, 50% directly to zone air, EP `FullInteriorAndExterior` analogue), zone-air implicit step with internal-mass term (50 kJ/(K·m²) of GIA — partitions + furniture proxy), linearised zone-air balance, drop 5% roof-solar heuristic.
- `_calculateState2` inner loop **NOT YET REFACTORED** — still uses the old lumped two-node model for its own T_op trace + demand. Shared physics (solar, fabric losses) still routes through `_calculateEnvelopeOnly` so the State 1 ↔ State 2 byte-identity contract holds on those. Refactor queued as Part 3 v2.

### Updated row-by-row comparison

Pass/Fail threshold ±15 % per Chris's contract bands.

| Row | Pre-Part-3 Static | Part 3 v1 Static | Dynamic (EP) | Pre Δ% | Post Δ% | Verdict change |
|---|---:|---:|---:|---:|---:|---|
| Solar F1 (N→NE) | 57.5 | 57.5 | 47.0 | −18.2% | −18.2% | unchanged (Part 2 territory) |
| Solar F2 (E→SE) | 4.4 | 4.4 | 5.1 | +17.1% | +17.1% | unchanged (Part 2 territory) |
| Solar F3 (S→SW) | 71.4 | 71.4 | 77.6 | +8.7% | +8.7% | unchanged |
| Solar F4 (W→NW) | 3.1 | 3.1 | 3.2 | +3.6% | +3.6% | unchanged |
| **Solar roof** | 46.5 | **0** | 0 | −100% | **0%** | **METHODOLOGY → fixed.** 5% heuristic dropped; sol-air absorbs it into wall conduction path. |
| Solar total (facade) | 136.4 | 136.4 | 133.0 | −2.5% | −2.5% | PASS unchanged |
| External wall loss | 16.5 | **9.0** | 15.4 | −6.8% | **+70.8%** | **REGRESSION.** New T_air lower → smaller dT × A integral. |
| Roof loss | 11.1 | 9.1 | 10.4 | −6.8% | **+14.1%** | regressed slightly, still within ±15% |
| Ground floor loss | 15.3 | 14.7 | 14.2 | −6.8% | **−3.2%** | **improved** |
| Glazing loss | 83.2 | 60.4 | 77.5 | −6.8% | **+28.3%** | **REGRESSION.** |
| Fabric leakage | 58.7 | 42.6 | 54.7 | −6.8% | **+28.3%** | **REGRESSION.** |
| Total losses | 184.7 | 135.8 | 172.2 | −6.8% | **+26.8%** | regressed |
| Annual mean T (°C) | 21.2 | **17.9** | 19.8 | −6.6% | **+10.6%** | regressed (Static now colder than EP) |
| **Summer max T (°C)** | **44.2** | **36.7** | **35.4** | **−19.9%** | **+3.5%** | **HUGE WIN — gap 8.8 K → 1.3 K** ✓✓✓ |
| Winter min T (°C) | 4.0 | 3.2 | 8.3 | +107.5% | +159.4% | regressed slightly |
| Heating demand (MWh) | 103.4 | **123.6** | 110.2 | +6.6% | **−10.8%** | within ±15% on other side |
| Cooling demand (MWh) | 108.6 | **39.5** | 61.7 | −43.2% | **+56.2%** | over-corrected (was 43% high, now 36% low) |
| Comfort hours | 881 | 1816 | 1396 | +58.5% | −23.1% | improved magnitude, sign flipped |
| Underheating hours | 4,430 | 5,529 | 4,618 | +4.2% | −16.5% | regressed |
| Overheating hours | 3,449 | 1,415 | 2,746 | −20.4% | +94.1% | sign flipped (was high, now low) |

### Aggregate scorecard

| Domain | Pre-Part-3 PASS | Post-Part-3 PASS |
|---|---:|---:|
| Solar | 3/5 | 3/5 (no change) |
| Roof solar methodology | FAIL | **PASS** |
| Conduction + leakage + total | 6/6 | 2/6 |
| Free-running T | 1/3 | **2/3** (summer max fixed) |
| Demand + comfort hours | 2/5 | 1/5 |
| **All rows** | **13/21** (62%) | **9/21** (43%) |

### Honest read

**Net pass rate decreased** from 13/21 to 9/21. **But** the most operationally significant failure — the 8.8 K summer max gap, which cascaded into −43% cooling demand and +60% overheating hours — is fixed. The new failures are all symptoms of the same root cause: **my zone T_air trace is 2 K below EP's mean and bottoms out at 3 K instead of 8 K in winter**. With less zone T, dT × A integrated over the year is smaller, so every steady-state UA × ΔT loss line item reads low.

The 2 K mean-T discrepancy is the next thing to chase. Hypotheses:
1. EP has additional internal mass I'm not representing (50 kJ/(K·m²) might be low — try 100–200).
2. EP's solar absorbed by opaque inside surfaces convects to zone air faster than my model (the 50%/50% split may need to be 30%/70% radiative/convective).
3. EP includes long-wave radiative exchange between interior surfaces (north wall warms via radiation from south wall). My single-state collapsed wall doesn't differentiate, so this isn't relevant in v1.
4. EP's wall-to-air convection coefficient (h_int → R_si) might be different from BS EN ISO 6946 0.13 m²K/W default. Smaller R_si → tighter wall-air coupling.

**Recommendation: ship Part 3 v1, accept the trade-off** (summer max is the more operationally critical failure mode — a 9 K over-prediction of peak T mis-sizes cooling). Tune the secondary regressions in Part 3 v2 or as part of Part 4 validation.

### What's queued

- **Part 3 v2:** tune internal-mass parameter + solar convective split via test buildings (heavy mass, light mass, glazed-heavy). Target: get zone T_air mean within ±1 K of EP across construction types.
- **Part 3 v2:** refactor `_calculateState2` inner loop to share the same multi-node model (currently still uses lumped two-node; mass model inconsistency between State 1 free-running and State 2 free-running).
- **Part 2 (HDKR/Perez):** F1 / F2 per-facade solar redistribution (unchanged by Part 3 v1).
- **Brief 28b Part 4:** validation across construction types (lightweight, medium, heavyweight) using new model.

### Sensitivity tests post-Part-3 v1

A1 (length 2×) — PASS:
- F1 + F3 solar exactly 2× (length-dependent glazing scales as expected)
- F2 + F4 unchanged (width-dependent areas)
- All losses scale within 5% of expected linear behaviour
- Summer max stable at 35.5 °C (vs 35.6 baseline)
- Heating demand 247.6 = 123.6 × 2.00 ✓

A2 (rotate 90°) — PASS:
- F1 NE→SE +81%, F3 SW→NW −41%, F2 +10%, F4 −15% — same redistribution as before fix
- Annual mean T shifts +0.8 K (more sun on bigger glazed facade)
- Summer max +2.3 K (peak orientation effect)
- Engine determinism preserved

---

**Trigger:** Final State 1 validation step before declaring State 1 done.
Compare the two engines on the same envelope physics, same weather,
same fabric, and find out which numbers agree and which don't.

**Project:** HIX Bridgewater, `14b4a5b1-8c73-4acb-8b65-1d22f05ec969`.
Canonical config — `infiltration_ach: 0.2`, current library fabric
values, no manual edits. Comfort band 21 / 25 °C. Yeovilton TMYx weather.

**Static engine:** `frontend/src/utils/instantCalc.js` at commit `872c8ca`
(post Problem 1/1a/2/3 fix batch). Extracted via
`scripts/state_sensitivity_test.mjs baseline_post_ach_restore` and the
post-fix engine `_validation_dump.mjs`.

**Dynamic engine:** EnergyPlus 26.1.0 envelope-only sim,
`run_id = c67aff89`. Created by
`scripts/run_envelope_only_sim_bridgewater.py` at 2026-05-14T14:58Z.
Mode: **envelope-only** (Brief 28 prereq's `simulation_mode='envelope-only'`
column). Assembler strips occupancy / equipment / lighting gains, real
HVAC systems, operable windows, mechanical ventilation. Comfort band
read at runtime against the same 21 / 25 °C bounds. Reports natural
fabric losses + solar gains + free-running zone T trace + derived
heating/cooling demand. 8,760 hours, 17.1 s wall clock, 20 warnings,
0 fatal errors.

**Both engines run against the same persisted project config + same
EPW + same library at the time of this comparison.**

---

## Side-by-side comparison

Pass/Fail threshold per Chris's contract bands: silent ≤ 5 %, soft 5–10 %, **warn 10–30 % (FAIL at ±15 %)**, hard > 30 %. The "Pass/Fail at ±15 %" column applies a strict ±15 % gate.

### Solar gains (annual, kWh)

| Row | Static (live) | Dynamic (EP) | Δ absolute | Δ % | Pass/Fail (±15 %) |
|---|---:|---:|---:|---:|:---:|
| Solar F1 (north face → compass NE at orient 42°) | 57,488.5 | 46,998.7 | −10,489.8 | −18.2 % | **FAIL** |
| Solar F2 (east face → compass SE) | 4,397.9 | 5,149.7 | +751.8 | +17.1 % | **FAIL** |
| Solar F3 (south face → compass SW) | 71,400.5 | 77,593.9 | +6,193.4 | +8.7 % | PASS (soft) |
| Solar F4 (west face → compass NW) | 3,132.5 | 3,244.9 | +112.4 | +3.6 % | PASS |
| Solar roof (5 % opaque approximation in Static; not reported in EP) | 46,454.2 | 0.0 | −46,454.2 | −100 % | **METHODOLOGY** (see notes) |
| Solar total **excl. roof** (facade sum) | 136,419.4 | 132,987.2 | −3,432.2 | −2.5 % | PASS |
| Solar total **incl. roof** (engine-reported `totals.gains_kwh`) | 182,873.6 | 132,987.3 | −49,886.3 | −27.3 % | **FAIL** (driven by roof methodology) |

### Conduction + ventilation losses (annual, kWh)

| Row | Static (live) | Dynamic (EP) | Δ absolute | Δ % | Pass/Fail (±15 %) |
|---|---:|---:|---:|---:|:---:|
| External wall | 16,515.4 | 15,392.1 | −1,123.3 | −6.8 % | PASS (soft) |
| Roof | 11,110.0 | 10,355.1 | −754.9 | −6.8 % | PASS (soft) |
| Ground floor | 15,276.3 | 14,238.3 | −1,038.0 | −6.8 % | PASS (soft) |
| Glazing (all four facades combined) | 83,166.6 | 77,515.2 | −5,651.4 | −6.8 % | PASS (soft) |
| Fabric leakage (infiltration @ 0.2 ACH) | 58,661.0 | 54,672.5 | −3,988.5 | −6.8 % | PASS (soft) |
| Thermal bridging | 0.0 | 0.0 | 0 | — | PASS (y_factor 1.0 on all four constructions) |
| Permanent vents (louvres, area 0) | 0.0 | 0.0 | 0 | — | PASS |
| Total losses (engine-reported `totals.losses_kwh`) | 184,729.4 | 172,173.2 | −12,556.2 | −6.8 % | PASS (soft) |

### Free-running zone temperature (annual, °C)

| Row | Static (live) | Dynamic (EP) | Δ absolute | Δ % | Pass/Fail (±15 %) |
|---|---:|---:|---:|---:|:---:|
| Annual mean | 21.2 | 19.8 | −1.4 | −6.6 % | PASS (soft) |
| **Summer max** (Jun–Aug peak hour) | **44.2** | **35.4** | **−8.8** | **−19.9 %** | **FAIL** |
| **Winter min** (Dec–Feb low hour) | **4.0** | **8.3** | **+4.3** | **+107.5 %** | **FAIL** (hard) |

### Derived demand (vs comfort band 21 / 25 °C)

| Row | Static (live) | Dynamic (EP) | Δ absolute | Δ % | Pass/Fail (±15 %) |
|---|---:|---:|---:|---:|:---:|
| Heating demand (MWh) | 103.4 | 110.2 | +6.8 | +6.6 % | PASS (soft) |
| **Cooling demand (MWh)** | **108.6** | **61.7** | **−46.9** | **−43.2 %** | **FAIL** (hard) |
| **Comfort hours (in band, 8,760 total)** | **881** | **1,396** | **+515** | **+58.5 %** | **FAIL** (hard) |
| Underheating hours | 4,430 | 4,618 | +188 | +4.2 % | PASS |
| Overheating hours | 3,449 | 2,746 | −703 | −20.4 % | **FAIL** |

---

## Honest assessment per row

### Solar per facade — F1 over-attributed, F2 under-attributed; aggregate close

Static reads **18 % more** solar on F1 (NE-facing) and **17 % less** on F2 (SE-facing) than Dynamic. F3 (SW) and F4 (NW) are within ±10 %. **Aggregate facade solar agrees within 2.5 %** (136.4 vs 133.0 MWh).

Cause: Static uses an isotropic sky-diffuse split with simple cos(incidence) for direct beam. Dynamic uses EnergyPlus's full irradiance model (anisotropic sky + ground-reflected). The per-facade redistribution Static→Dynamic is the classic isotropic→HDKR/Perez correction — Static over-attributes diffuse to the lit hemisphere (N face still receives substantial diffuse) and under-attributes direct beam to the most-sunlit faces (SE picks up more morning direct).

Canonical: **Dynamic** (EnergyPlus's irradiance model is industry-standard).

Plausible explanation: per `docs/physics_audit_2026_05.md` Audit 3, the redistribution is ±19 % between NNE and SSW with aggregate ±1 %. Matches our observation closely.

**Fix planned: Brief 28b Part 2 (HDKR/Perez sky model upgrade). Status: NOT DONE.** Lives in `docs/briefs/active/28b_physics_overhaul.md`.

### Roof solar — methodology mismatch (not a physics bug)

Static models opaque-roof solar as a small explicit gain into the zone:
`hourlySolar.roof[h] × roof_area × 0.05` summed over 8,760 hours →
46,454 kWh/yr. Dynamic's envelope-only mode does NOT surface this as a
separate gain — EnergyPlus accounts for solar absorption at the outer
surface of the opaque roof construction, where most of it convects/
re-radiates away before reaching the zone via conduction. The 5 %
heuristic in Static is an approximation of "small radiant fraction reaches the interior".

The two engines model this differently. Neither is wrong; they answer
slightly different questions. The 46 MWh discrepancy on the total
solar number is real and worth flagging — but the cleanest path is
either to drop Static's heuristic (over-attributes ~46 MWh of gain
that EP doesn't see) or to surface an equivalent term in the
Dynamic-side balance.

Canonical: ambiguous. **The aggregate solar comparison should be done facade-only (excl. roof)** until the roof methodology is unified.

Fix planned: not in any active brief. Filed as a candidate for the validation spreadsheet to surface as a follow-up.

### Conduction losses — uniform −6.8 % low in Dynamic across all four elements + fabric leakage

Every fabric loss element + fabric leakage is uniformly lower in Dynamic by 6.8 %. The uniformity is the giveaway: it's not a U-value disagreement (which would scale individual elements differently), it's a **T-trace integration window** difference. Dynamic's free-running mean is 19.8 °C; Static's is 21.2 °C. With a 1.4 K higher zone temperature, Static's `dT_air > 0` integration accumulates more hours and larger ΔT values across every fabric element, so every element reads ~7 % more loss.

The root cause is the temperature trace, not the loss accumulator. The accumulator is correct.

Canonical: **Dynamic** (real T trace from CTF).

Plausible explanation: Static's lumped two-node mass model has less heat storage than EP's per-layer CTF → less diurnal damping → T_air drifts higher in summer / lower in winter / and the integrated mean comes out warmer (because the engine's lower bound is bounded by T_out but the upper bound has more headroom under solar forcing).

**Fix planned: Brief 28b Part 3 (multi-layer CTF mass model upgrade). Status: NOT DONE.** Expected to close most of the 6.8 % conduction gap by aligning the T trace with EP's.

### Free-running summer max — Static 44.2 °C vs Dynamic 35.4 °C (8.8 K gap)

This is the headline gap. Static under-stores heat in fabric layers → solar forcing has nowhere to go on hot afternoons → T_air spikes far above what EP sees.

**Important: the original "15 K summer max gap" from `docs/state_1_engine_divergence_investigation.md` was measured against an HVAC-clamped EP run (not envelope-only).** The proper envelope-only comparison here shows **8.8 K**, not 15 K. Still a substantial gap, but smaller than originally reported.

Canonical: **Dynamic** for peak summer comfort. The HeatBalance UI already
discloses this — `frontend/src/components/modules/balance/HeatBalance.jsx`
lines 475–484:
> "Static's lumped two-node mass model under-stores heat compared to
> EnergyPlus's per-layer construction — peak summer reads ~8.8 °C above
> Dynamic on Bridgewater. **For peak comfort assessment, the Dynamic
> view is canonical.** Annual mean and comfort-hour distribution agree
> silently between engines. Multi-layer CTF fix queued for Brief 28b
> Part 3."

**Fix planned: Brief 28b Part 3 (multi-layer CTF mass model). Status: NOT DONE.**

### Free-running winter min — Static 4.0 °C vs Dynamic 8.3 °C (4.3 K gap)

Same root cause, opposite direction. Static's under-storage lets the zone drift cooler at night (fabric can't release stored heat fast enough on cold winter nights). Dynamic's per-layer mass holds onto warmth longer.

The same Brief 28b Part 3 fix should close both summer max and winter min gaps.

### Cooling demand — Static 108.6 MWh vs Dynamic 61.7 MWh (76 % more in Static)

Direct downstream of summer max. Static reads many more hours above the 25 °C comfort upper, and each excess hour is larger (more °K above the bound), so the cumulative cooling demand integral comes out much larger. **This is THE failure mode that matters operationally** — a tool that says "you need 109 MWh of cooling" when EP says "62 MWh" is a 76 % overestimate that would meaningfully change a sizing decision.

Canonical: **Dynamic.** Brief 28b Part 3 should fix this by lowering Static's summer max trace into line with Dynamic.

### Comfort hours — Static 881 vs Dynamic 1,396 (Dynamic 58 % more)

Same root cause: Static's swingier T trace spends more hours outside the comfort band. Dynamic's better-damped trace stays in band more often. Direction confirms the mass-model story.

### Heating demand — passing ±15 %

Heating demand passes within 6.6 %. The mass-model issue affects winter min badly (8.3 → 4.0) but its effect on the *integrated* heating demand is smaller because the engine still triggers heating on every hour T_op < lower, and there are LOTS of such hours in a UK winter regardless of whether T_op dipped to 4.0 or 8.3. The peak excursion below the bound matters less than the total time spent below it.

### Underheating hours — passing ±15 %

4,430 (Static) vs 4,618 (Dynamic). Both engines agree the zone spends roughly half the year below the heating threshold. Difference is small (+4.2 %).

---

## Aggregate scorecard

| Domain | Rows | Pass at ±15 % | Fail at ±15 % | Pass rate |
|---|---:|---:|---:|---:|
| Solar (per facade + facade total) | 5 | 3 | 2 | 60 % |
| Roof solar | 1 | 0 | 1 (methodology) | 0 % |
| Conduction + ventilation | 6 | 6 | 0 | 100 % |
| Total losses | 1 | 1 | 0 | 100 % |
| Free-running T (mean / max / min) | 3 | 1 | 2 | 33 % |
| Demand + comfort hours | 5 | 2 | 3 | 40 % |
| **All comparable rows** | **21** | **13** | **8** | **62 %** |

Of the 8 failures:
- **4 attributable to mass model** (summer max, winter min, cooling demand, comfort hours, overheating hours — actually 5)
- **2 attributable to solar redistribution** (F1, F2 per-facade solar)
- **1 attributable to roof methodology** (roof solar; cascades into total solar)

### Direct mapping to active Brief 28b

| Failing row | Cause | Brief 28b part | Status |
|---|---|---|---|
| Solar F1 −18 % | Isotropic sky model over-attributes to N hemisphere | Part 2 (HDKR/Perez) | NOT DONE |
| Solar F2 +17 % | Same — under-attributes to lit hemisphere | Part 2 | NOT DONE |
| Solar total incl. roof −27 % | Roof methodology mismatch | (separate, not in 28b) | NOT FILED |
| Summer max −20 % (8.8 K gap) | Lumped two-node mass model | Part 3 (multi-layer CTF) | NOT DONE |
| Winter min +108 % (4.3 K gap) | Same mass model | Part 3 | NOT DONE |
| Cooling demand −43 % | Cascades from summer max | Part 3 | NOT DONE |
| Comfort hours +58 % | Cascades from T swings | Part 3 | NOT DONE |
| Overheating hours −20 % | Cascades from summer max | Part 3 | NOT DONE |

**Both halves of Brief 28b (Part 2 + Part 3) are still in `docs/briefs/active/28b_physics_overhaul.md`. Neither part has landed.**

---

## Recommendation

Per Chris's three options:
- (a) **Declare State 1 validated and move to State 2** — NOT advisable. 8 of 21 rows fail ±15 %. The mass-model gap on summer max + cooling demand is a known issue that will directly mislead users on overheating + cooling sizing.
- (b) **Halt and fix the worst Static/Dynamic disagreements first** — RECOMMENDED. Brief 28b Part 3 (multi-layer CTF) closes 5 of the 8 failures. Brief 28b Part 2 (HDKR/Perez solar) closes 2 more. Roof methodology is a small separate item.
- (c) **Adjust the Static engine to match Dynamic more closely** — this IS option (b) — Brief 28b is exactly the "fix Static to match Dynamic" work, scoped against EP as canonical.

**My recommendation: pursue (b). Brief 28b Part 3 first** (5 failures → likely ≤ 1 if Part 3 closes the mass gap to within 5 % on summer max). **Then Part 2** for per-facade solar (2 more failures resolved). **Then the roof methodology question** as a small standalone follow-up.

After Brief 28b lands:
- Re-run this comparison.
- If aggregate pass rate exceeds ~90 % (i.e. ≤ 2 of 21 rows still failing), declare State 1 validated against Dynamic and proceed to State 2 work.
- If failures persist, document them as known limitations with explicit user-facing disclosure on the HeatBalance pane (the existing disclosure text already does this for summer max — extend if needed).

---

## What's not blocking

The recently-shipped Problems 1 / 1a / 2 / 3 fix batch is unaffected. Building module and Internal Gains module's shared physics are byte-identical (see `docs/state_2_heat_balance_discrepancies_2026_05.md`). The Static engine internally is consistent. The Static vs Dynamic divergence is a separate, larger physics-model question — addressed by Brief 28b, not by additional Heat Balance display fixes.

`cfdedcb` parked work (Profiles rename / scroll fix / TotalEnergyBar) is unaffected. It can ship at any time without conflicting with this validation outcome.

---

## File pointers

- Static engine output: `docs/validation/_dump.json` (regenerated 2026-05-14T14:54Z) + `docs/validation/bridgewater_state1_engine_outputs_2026_05_post_problem1_fix.md`
- Dynamic engine sim record: `simulation_runs` row `c67aff89`, mode `envelope-only`, output dir `data/simulations/c67aff89/`
- Sim balance JSON: `GET /api/projects/14b4a5b1-8c73-4acb-8b65-1d22f05ec969/simulations/c67aff89/balance?mode=envelope-only`
- Engine-agreement comparison script: `scripts/state1_engine_agreement.mjs`
- Brief 28b master: `docs/briefs/active/28b_physics_overhaul.md`
- Earlier divergence investigation: `docs/state_1_engine_divergence_investigation.md` (with 2026-05-14 corrections inline)
- Physics audit underlying the 28b scope: `docs/physics_audit_2026_05.md` (Audits 1, 3, 4)
