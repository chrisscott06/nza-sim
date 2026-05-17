# Brief 29 — First-Principles Audit FINDINGS

**Audit reference state:** Bridgewater envelope-only, comfort band 21–24 °C, post Commit A (`39a828c`).
**Audit started:** 2026-05-17.
**Sign-off discipline:** Chris signs off Part 1 before Part 2 begins; Parts 1–3 before Parts 4+.

---

## Module: Building (envelope-only)   Engine: Static

### Heat balance on this module (state the physics)

Single-zone, hourly energy balance for the envelope acting alone against the weather. No occupancy, no systems, no operable windows (state contract). The model is lumped: one zone air node `T_air`, one wall mass state `TS_wall`, one roof mass state `TS_roof`, one floor mass state `TS_floor`. The integration is implicit Euler in `T_air` per hour.

**Per-hour balance (W):**

```
C_air/Δt · (T_air^{n+1} − T_air^n) = ΣQ_in − ΣQ_out

ΣQ_in =
  Q_solar_through_glazing_to_zone_air
    = (1 − SOLAR_RADIATIVE_FRACTION) · Q_solar_glaz_zone   +   TUNE_GLAZ_INSIDE_ABS · Q_glaz_incident_post_shading
  + Q_solar_to_inside_surf (radiative fraction; reaches T_air indirectly via wall step)

ΣQ_out =
  U_eff_wall  × A_wall_opaque       × (T_air − T_inside_node_wall)
  + U_eff_roof  × A_roof              × (T_air − T_inside_node_roof)
  + U_eff_floor × A_ground            × (T_air − T_inside_node_floor)
  + UA_glaz                          × (T_air − T_out)
  + UA_leakage                       × (T_air − T_out)
  + UA_permanent(t)                  × (T_air − T_out)     [wind-driven, recomputed hourly]
```

`T_inside_node_*` are the implicit-Euler updates from the lumped wall mass; sol-air boundary condition on exterior side using per-facade incident solar.

**Per-hour heating/cooling demand integrand (setpoint convention, Brief 28k):**

```
hourly_heat_loss_Wh =
  U_ext  · Σ_face (A_face · max(0, T_heat − T_sa_face))      [external walls]
  + U_roof  · A_roof        · max(0, T_heat − T_sa_roof)     [roof]
  + U_floor · A_ground      · max(0, T_heat − T_ground)      [ground floor]
  + Σ_face UA_glaz_face     · max(0, T_heat − T_out)         [glazing]
  + (UA_leakage + UA_permanent(t)) · max(0, T_heat − T_out)  [air leakage + permanent vents]
  + H_TB                    · max(0, T_heat − T_out)         [thermal bridging, ISO 14683]
  + nv_heat_h_total                                          [operable openings, FORCED 0 in State 1 per Commit A]

H_weather = hourly_heat_loss_Wh − H_floor_const
C_weather = hourly_cool_gain_Wh − C_floor_const

If H_weather > 0:                                            [winter / heating direction]
  heating_h = max(0, hourly_heat_loss_Wh − Q_solar_through_glazing_Wh)
  cooling_h = max(0, Q_solar_through_glazing_Wh − hourly_heat_loss_Wh)
Else if C_weather > 0:                                       [summer / cooling direction]
  heating_h = 0
  cooling_h = hourly_cool_gain_Wh + Q_solar_through_glazing_Wh
Else (shoulder):
  heating_h = 0, cooling_h = 0

acc_heating_demand_Wh += heating_h
acc_cooling_demand_Wh += cooling_h
```

**Symbol → code map:**

| Symbol | Code symbol | File:line |
|---|---|---|
| `T_heat`, `T_cool` | `comfortBand.lower_c`, `comfortBand.upper_c` | instantCalc.js:1151–1152 |
| `T_air` (zone air) | `T_air` | instantCalc.js:1083 (solved each hour) |
| `T_sa_face` | `T_sa_wall_n_h` etc. | instantCalc.js:1153–1156 |
| `T_ground` | weather constant | passed in |
| `T_out` | `weatherData.temperature[h]` | instantCalc.js:977 |
| `Q_solar_through_glazing_Wh` | `sol_n + sol_e + sol_s + sol_w` | instantCalc.js:981–985 |
| `U_eff_wall`, `U_eff_roof`, `U_eff_floor` | `stepWall.U_eff` etc. | instantCalc.js:1047–1056 |
| `UA_glaz_face` | `glaz_face_UA(face)` | helper defined earlier |
| `UA_leakage` | `UA_leakage` (constant) | instantCalc.js:803 |
| `UA_permanent` | `UA_permanent` (hourly, wind-driven) | instantCalc.js:1003–1004 |
| `H_TB` | `total_H_TB_W_per_K` | from `total_H_TB_W_per_K` accumulator |
| `nv_heat_h_total` | `nv_heat_h_total` | instantCalc.js:1262–1291 (loop body, now skipped) |
| `H_floor_const`, `C_floor_const` | as named | instantCalc.js:795–796 |
| `hourly_heat_loss_Wh` | as named | instantCalc.js:1326–1345 |
| `acc_heating_demand_Wh` | as named | instantCalc.js:866, 1392 |

### Code traversal

Every variable that contributes to `hourly_heat_loss_Wh` (the demand integrand at `instantCalc.js:1326-1345`):

| Term | In balance above? | File:line in integrand | Annual MWh (Bridgewater audit baseline) |
|---|---|---|---|
| Q_conduction_walls (4 facades × sol-air) | ✓ | 1327–1330 | 20.0 |
| Q_conduction_roof (sol-air) | ✓ | 1331 | 9.2 |
| Q_conduction_floor (T_ground) | ✓ | 1332 | 9.6 |
| Q_conduction_glazing (4 faces × dT_heat_out) | ✓ | 1333–1334 | 54.6 |
| Q_air_leakage (UA_leakage × dT_heat_out) | ✓ | 1335 (first half) | 27.0 |
| Q_permanent_vent (UA_permanent(t) × dT_heat_out) | ✓ | 1335 (second half) | 120.8 |
| Q_thermal_bridging (H_TB × dT_heat_out) | ✓ | 1336 | 10.4 |
| Q_natural_vent (operable openings) | ✓ (zero in State 1) | 1337 | **0.0** (was 202.4 pre-Commit-A) |
| **Σ annual integrand** | | | **251.5 MWh** |

Solar credit term subtracted in heating-direction hours:

| Term | File:line | Annual MWh credited (Bridgewater) |
|---|---|---|
| Q_solar_through_glazing (g-value × frame × shading × incident) | 981–985, 1369 | 99.4 (gross) / ~58 (credited inside H>0 hours) |

Demand identity (Bridgewater audit baseline):
```
Σ_h max(0, hourly_heat_loss_h − Q_solar_h) over H_weather > 0 hours
= 194.3 MWh   (matches reported)
```

**No integrand terms found outside the balance above.** Post Commit A the `nv_heat_h_total` term is structurally still in the integrand but is guaranteed to be 0 because `operableOpenings = []` at the top of the function. The integrand is now complete and consistent with the stated heat balance.

### Display traversal

| Term | Sankey | Rows | Stacked | Summary (table) | Monthly | Profiles |
|---|---|---|---|---|---|---|
| Q_conduction_walls | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Q_conduction_roof | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Q_conduction_floor | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Q_conduction_glazing | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Q_air_leakage | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Q_permanent_vent | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Q_thermal_bridging | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Q_natural_vent (operable) | n/a (zero) | n/a | n/a | n/a | n/a | n/a |
| Q_solar_through_glazing (gain) | ✓ | ✓ | ✓ | n/a (gain only on right column) | ✓ | ✓ |
| **Display ghost terms** | none | none | none | none | none | none |

**Post Commit A, display and integrand are aligned.** The display-to-display reconciliation that exists today (`losses_at_setpoint.{element}.heating_loss_kwh` vs `losses_at_setpoint.{element}.monthly_heating_loss_kwh[12]`) is internal-consistency only and was relabelled in Commit B. The integrand-vs-display invariant the brief mandates is queued as Audit Finding #6.

### Reconciliation

```
Σ integrand terms (annual)    = 251.5 MWh   (post Commit A)
Σ displayed loss terms        = 251.5 MWh   (7 envelope elements, Summary table)
Q_solar credited in H > 0     ≈  57.2 MWh   (Σ hourly_heat_loss_when_H_gt_0 − Σ demand_when_H_gt_0)
Reported heating demand       = 194.3 MWh
Identity:
    251.5 − 57.2 = 194.3       ✓ within rounding (gap < 0.1 MWh)

X (integrand) vs Y (display)  = 0.0 MWh Δ   ✓ within ±1% invariant
Z (demand) derivable from X + Q_solar:  ✓
```

### Defended numbers (Bridgewater audit baseline)

| Number | Defence |
|---|---|
| Heating demand 194.3 MWh | = `Σ_h max(0, hourly_heat_loss − Q_solar)` over H_weather > 0 hours = 251.5 − 57.2 = 194.3 ✓ |
| Cooling demand 44.0 MWh | = `Σ_h max(0, Q_solar − hourly_heat_loss)` over H_weather > 0 hours + `Σ_h (hourly_cool_gain + Q_solar)` over C_weather > 0 hours. Quasi-defended; full per-regime split not separately captured in instrumentation yet. **Partially defended.** |
| EUI 55.1 kWh/m²·yr | = (194.3 + 44.0) × 1000 / 4,322 = 55.1 ✓ |
| Σ fabric loss 251.5 MWh | = sum of 7 setpoint-convention element accumulators (table reproduces) ✓ |
| Permanent vents 120.8 MWh | UNDEFENDED — engine reports Case A (cross-flow with C_d 0.6) but Bridgewater topology is balanced mechanical (Case C ≈ 24–85 MWh). See `29_permanent_vent_methodology.md`. **5× over-stated for this building.** Issue #2 in open list. |
| Solar gain 99.4 MWh | Defendable from g-value × frame × shading × ∫Σ_face A_face · incident_h; not independently re-derived in this audit pass. Marked **defensible-pending-spreadsheet**. |
| Comfort hours 1,916 / 8,760 (22%) | Defended from `T_op` integral; computed at `instantCalc.js:1295-1297`. |
| Annual mean T 16.1 °C | Defended from `T_hourly` annual mean. |
| Winter min 5.7°C / Summer max 30.6°C | Defended from monthly-filtered T_hourly extrema. |

### Open issues found

Numbered list of every discrepancy. Severity: 1 (cosmetic / docs) / 2 (number off but defensible direction) / 3 (number off in a way that breaks decisions).

1. **[S3, FIXED in Commit A `39a828c`]** Operable openings included in State 1 demand integral but not in display. Engine emitted 202 MWh "New door (north)" natvent loss that didn't appear in the Summary table. Two engines agreed on a wrong answer (Static 384, Dynamic 359) because they shared a wrong upstream input.
2. **[S3]** Permanent-vent loss over-stated by ~5× on Bridgewater (engine reports Case A cross-flow 120.8 MWh; correct topology is Case C balanced mechanical ~24–85 MWh). Root cause: no `flow_mode` field on `building.openings[*]`; Static hardcodes cross-flow wind correlation. See `29_permanent_vent_methodology.md`.
3. **[S2]** Discharge coefficient `C_d = 0.6` hardcoded in Static (`instantCalc.js:807`) and applied to all openings regardless of geometry. Slot geometry (trickle vent, aspect > 10:1) actually has C_d = 0.35–0.40. Over-states flow by ~50% under cross-flow path. Cross-references Issue #2 — fix scope shared.
4. **[S2]** Stack term missing in Static permanent-vent flow. Static uses `Q = Cd · A · √Cw · v` (wind-only). Stack contribution at Bridgewater (16 m × 12 K winter ΔT) is ~7–8 Pa, comparable to wind ~10 Pa. Real ~30% under-estimate on the cross-flow path. Only matters once #2 is resolved (cross-flow may still be correct for some buildings). Partly mitigated by also under-stating C_d, but two wrongs ≠ right.
5. **[S1]** Source-code constant `AIR_HEAT_CAPACITY = 0.33` labelled `kWh/m³/K` in the comment at `instantCalc.js:121` but used dimensionally as `Wh/m³/K`. Magnitude matches physical value (1206 J/(m³·K) → 0.335 Wh/(m³·K)) so numbers are correct; only the label is wrong. Cosmetic.
6. **[S2, METHODOLOGY GAP]** No integrand-vs-display invariant exists in code. The display-to-display reconciliation (POL-M3 `ReconciliationRow`) does not catch a hidden integrand term — the door bug slipped through it. Brief 29 deliverable #4 (integrand-vs-display invariant test) will close this. Until then, every new integrand term added by future briefs is at risk of the same class of bug.
7. **[S1, DATA-SHAPE NOTE]** `building_config.operable_openings[*]` schema shows `area_m2: 2` for the Bridgewater "Main Entrance NE", but pre-fix engine emission to `losses_at_setpoint.natural_ventilation[*].area_m2` reported `6`. Possible derivation/multiplier between input and emission. Audit it under Part 5 (Operation / State 2.5) where this opening properly belongs and the field is used.

### Cross-engine consistency check

Bridgewater audit baseline (post Commit A):

| Term | Static MWh | Dynamic MWh | Δ | Defensible mechanism (with citation) |
|---|---|---|---|---|
| Heating demand | 194.3 | 209.8 | +15.5 (+8%) | UNDEFENDED — full reconciliation queued for Part 3. Possible contributors include sol-air vs full surface heat balance, sky long-wave (Berdahl-Martin in EP vs dry-bulb approx in Static), T_ground source. None of these have been numerically defended yet per Brief 29 Hard Rule 2. |
| Cooling demand | 44.0 | 16.9 | −27.1 (−62%) | UNDEFENDED — large directional Δ. Likely solar-handling difference (Static credits 99.4 MWh solar, Dynamic credits 82.3 MWh). Investigate in Part 3. |
| Solar gain | 99.4 | 82.3 | −17.1 (−17%) | Likely EP `FullExterior` solar distribution + WindowMaterial layer model with per-hour incidence-angle adjustment vs Static's `g_value × shading × incident` formula. Magnitude direction is consistent with EP being more thorough; magnitude itself is **UNDEFENDED** until Part 3. |
| Permanent vents (display) | 120.8 | not surfaced in setpoint format by parser | n/a | Different display contract; Part 2 will list Dynamic's per-element emission keys. |

**The cross-engine Δ on heating demand is +8% post Commit A vs +6% pre-fix (small change because the door bug affected both engines roughly equally). Tolerable in direction; magnitude not yet defended per Hard Rule 2.**

---

## Notes for Part 2 (Building Dynamic)

Open items the Part 2 audit needs to close:
- Confirm `_build_state1_zone_objects` does not silently emit an internal-mass or infiltration object that duplicates the Static `UA_leakage` term.
- Confirm the EP `ZoneVentilation:WindandStackOpenArea` object for the louvres uses the same C_d and area as the Static path, and document whether it includes the stack term (it should, per the EP IDD).
- Reconcile the 99.4 (Static) vs 82.3 (Dynamic) solar gain — is the difference in `glazing g-value` interpretation, `solar_distribution` setting, or frame-fraction handling?
- Verify `_get_heat_balance_state1` populates `losses_at_setpoint.{element}.heating_loss_kwh` per element so the integrand-vs-display invariant can apply uniformly to both engines. The audit baseline showed Dynamic emits these as 0 — that's either a parser gap or a deliberate "Dynamic doesn't compute setpoint-convention values; use the live integrand instead" choice.

**Standing by for Chris's sign-off on Part 1 (Building Static) before beginning Part 2.**
