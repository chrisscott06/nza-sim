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

### Acceptable-defence rubric for cross-engine Δ (Chris call 2026-05-17, standing rule for Part 3)

Any claim that a Δ between Static and Dynamic is "defensible" must satisfy ALL FOUR:

1. **Named** — the mechanism is a specific identifiable physics difference (e.g. "EP Berdahl-Martin sky long-wave vs Static dry-bulb approximation"), not a vague class ("Static is just less accurate" — explicitly banned per Hard Rule 2).
2. **Quantified** — the mechanism contributes X MWh annually on the audit baseline config, computed not asserted. If X < 2% of demand it's a rounding contributor; aggregate small contributions separately and label as "noise floor."
3. **Cited** — textbook source + page per Hard Rule 2 (CIBSE Guide A, ASHRAE Fundamentals, BS EN ISO 13790, Hens, or equivalent).
4. **Reproducible** — changing a known input (e.g. roof U-value, glazing g-value, ground temp) predicts in advance which engine moves and by how much. Test runs both engines; assertion passes if measured Δ matches prediction within 10%.

**If Part 3 cannot produce all four for any single mechanism that explains the +8% gap, the gap stays undefended.** Decision queued for the post-audit ship brief: ship both engines as-is, downgrade Static to "indicative only," or fix Static. Brief 29 will not invent a mechanism to close the gap.

---

## Notes for Part 2 (Building Dynamic) — superseded by Part 2 section below.

---

## Module: Building (envelope-only)   Engine: Dynamic

### Heat balance on this module (state the physics)

The Dynamic State 1 demand is **NOT computed by EnergyPlus.** This is the critical finding. EP is run with thermostat setpoints widened to `−60°C` heating / `+100°C` cooling so the `ZoneHVAC:IdealLoadsAirSystem` never engages within realistic weather; EP reports the hourly free-running zone temperature trace. Demand against the comfort band is then computed **in Python in the parser** (`sql_parser.py::_get_heat_balance_state1`), using the SAME demand-integral formula family as Static but with EP-derived T_zone instead of Static's lumped 2-node T_air.

This means there are TWO consumers of EP output:

1. **What EP emits to SQL** — hourly traces of zone temperatures, surface heat transfer, etc. These are not the demand.
2. **What the parser computes from those traces** — demand integrals, per-element loss accumulators, comfort hours.

The audit must walk both layers.

**EP per-hour physical balance** (what EP runs):

```
C_zone × dT_zone/dt = Σ Q_in − Σ Q_out

Σ Q_in =
  + Solar transmitted through fenestration → zone air      (FullExterior solar_distribution)
  + People sensible heat × density (state1: density = 0)
  + Lights heat to zone × LPD (state1: LPD = 0)
  + ElectricEquipment heat to zone × EPD (state1: EPD = 0)
  + Q_ideal_loads (≈ 0 because setpoints widened)

Σ Q_out =
  + Surface inside face conduction (multi-layer CTF wall model)
    via BuildingSurface:Detailed + Construction layers
  + ZoneInfiltration:DesignFlowRate × ρcp × (T_zone − T_out)
    schedule = "hotel_ventilation_continuous"
  + ZoneVentilation:WindandStackOpenArea (louvres)
    schedule = "openings_always_on" (always-on),
    height_difference = 0 (stack term suppressed),
    C_d = 0.6
  + ZoneVentilation:WindandStackOpenArea (operable openings)
    Brief 29 Commit A: SUPPRESSED in state1 (state1 or state2 → emit {})
```

**Parser per-hour demand integral** (`sql_parser.py:1670-1676`):

```
Read each hour from SQL:
  T_air = "Zone Mean Air Temperature"     (line 1521)
  T_op  = "Zone Operative Temperature"    (line 1522)
  solar_face = "Surface Outside Face Incident Solar Radiation Rate per Area"
                converted to transmitted via g_value × glazing_area × frame   (line 1527)
  T_out, v_wind, months from EPW

Per-hour:
  Q_solar_in_Wh = (sol_n + sol_s + sol_e + sol_w) × 1000
  UA_permanent  = AIR_HEAT_CAPACITY × Cd × A × √Cw × v_wind × 3600
  UA_total      = UA_fabric + UA_leakage + UA_permanent

  If T_op < lower_c:
    heating_h = max(0, UA_total × max(0, lower_c − T_out) − Q_solar_in_Wh)
    acc_heating_demand_Wh += heating_h
  Elif T_op > upper_c:
    cooling_h = Q_solar_in_Wh + UA_total × max(0, T_out − upper_c)
    acc_cooling_demand_Wh += cooling_h
```

**The Dynamic-parser demand formula is NOT formula-identical to Static's.** Differences:

| Aspect | Static | Dynamic-parser |
|---|---|---|
| Loss-side terms | per-element `max(0, T_set − T_driving)` summed, where T_driving is sol-air for walls/roof, T_ground for floor, T_out for glazing/leakage/vents | lumped `UA_total × max(0, T_set − T_out)` — single T_out driver for ALL elements, no per-facade sol-air |
| Demand gating | by `H_weather > 0` (weather pushes envelope for heating) | by `T_op < lower_c` (zone is actually below setpoint) |
| Solar credit | per-hour `max(0, loss − Q_solar)` | per-hour `max(0, UA_total · ΔT − Q_solar)` |
| Source of T_zone | Static lumped 2-node | EP CTF + Output:Variable trace |

These are genuinely different demand integrals. **This is a structural Part 3 issue** — claims that Static and Dynamic agree within X% are not comparing the same physical quantity computed two ways; they're comparing two formulas applied to two different T_zone traces.

### Code traversal

EnergyPlus objects emitted in State 1 mode (assembled in `epjson_assembler.py::assemble_epjson`):

| EP object | File:line | Purpose | State 1 gating |
|---|---|---|---|
| `Building` | 1613 | `solar_distribution: "FullExterior"`, `north_axis: orientation` | n/a — geometry header |
| `SimulationControl` | 1625 | zone+system+plant sizing on | n/a |
| `Timestep` | 1635 | 4 per hour | n/a |
| `ShadowCalculation` | 1644 | PolygonClipping, DetailedSkyDiffuseModeling | n/a |
| `BuildingSurface:Detailed` | 1693 | envelope walls/roof/floor | n/a |
| `FenestrationSurface:Detailed` | 1694 | glazing | n/a |
| `Construction` / `Material` / `WindowMaterial:SimpleGlazingSystem` | 1700–1703 | wall layers + glazing g-value | n/a |
| `Zone` | (from geom) | one per floor (5 zones for Bridgewater) | n/a |
| `ZoneInfiltration:DesignFlowRate` | `_build_infiltration_objects:285` | air leakage, AirChanges/Hour method, ach from `building.infiltration_ach` | **NOT state1-gated** — schedule = `hotel_ventilation_continuous` regardless. Likely correct (leakage is fabric, always present) but the schedule name is semantically suspicious (sounds like mechanical-vent schedule). **Issue #9 below.** |
| `ZoneVentilation:WindandStackOpenArea` (louvres) | `_build_openings_objects:304`, called with `state1 = state1 or state2` | per-zone louvre opening, `height_difference = 0`, `discharge_coefficient = 0.6` | gated correctly (kept in state1) |
| `ZoneVentilation:WindandStackOpenArea` (operable) | `_build_operable_openings_objects:389`, gated at `:1368` | per-opening per-zone door/window, `height_difference = entry.height_m`, `C_d = entry.discharge_coefficient ?? 0.6` | **state1-gated post Commit A** ✓ |
| `ZoneHVAC:IdealLoadsAirSystem` | `_build_hvac_ideal_loads:495` | perfect heating/cooling delivery | emitted; effectively muted by widened setpoints below |
| `ThermostatSetpoint:DualSetpoint` | `:561` | dual setpoint per zone | **state1: references `state1_heating_setpoint` / `state1_cooling_setpoint` Schedule:Constant** at `−60` / `+100` (line 1584). Effectively disables IdealLoads. |
| `ZoneControl:Thermostat` | `:569` | thermostat per zone | n/a |
| `People` | `_build_people_objects` | occupancy | state1: density_override = 0.0 |
| `Lights` | `_build_lights_objects` | lighting heat gain | state1: lpd_override = 0.0 |
| `ElectricEquipment` | `_build_equipment_objects` | equipment heat gain | state1: epd_override = 0.0 |
| `Schedule:Constant` (state1 setpoints + openings_always_on) | `:1584`, `:1376` | constant value schedules | n/a |
| HVAC plant (DHW, VRF, MVHR, gas boilers) | various | system equipment | **"emitted but near-zero output" per docstring at `:1187`** — contract gap, see Issue #10 |
| `Output:Variable` × ~25 | `_output_variables:648` | hourly traces (see list below) | n/a |
| `Output:Meter` × 12 | `_output_meters:703` | facility-level meters | n/a |

`Output:Variable` requested (the integrand-side data feed for the parser):

| Variable | Used by parser? |
|---|---|
| `Zone Mean Air Temperature` | ✓ (line 1521) |
| `Zone Operative Temperature` | ✓ (line 1522) |
| `Zone Ideal Loads Supply Air Total Heating Energy` | NOT consumed in State 1 path (IdealLoads is muted) |
| `Zone Ideal Loads Supply Air Total Cooling Energy` | NOT consumed in State 1 path |
| `Zone People Occupant Count`, `Zone People Total Heating Energy` | not used in State 1 (density 0) |
| `Zone Lights Electricity Energy`, `Zone Lights Total Heating Energy` | not used in State 1 (LPD 0) |
| `Zone Electric Equipment Electricity Energy`, `…Heating Energy` | not used in State 1 (EPD 0) |
| `Zone Infiltration Sensible Heat Loss/Gain Energy` | **NOT consumed by State 1 parser** — parser recomputes from `UA_leakage × dT_air` using its own ach × volume. **Issue #8 below.** |
| `Zone Ventilation Sensible Heat Loss/Gain Energy` | **NOT consumed by State 1 parser** — same recompute pattern. **Issue #8.** |
| `Fan Electricity Energy` | not used in State 1 |
| `Surface Inside Face Conduction Heat Transfer Energy` | **NOT consumed by State 1 parser** — parser recomputes from `U_value × area × dT_air`. **Issue #8.** |
| `Surface Outside Face Sunlit Fraction` | (diagnostic only) |
| `Surface Outside Face Incident Solar Radiation Rate per Area` | ✓ (used to derive transmitted solar per face) |
| `Zone Windows Total Transmitted Solar Radiation Energy` | NOT consumed (parser computes its own via incident × g × area × frame) |
| `Surface Window Transmitted Solar Radiation Energy` | NOT consumed |
| `Zone Ideal Loads Heat Recovery Total Heating/Cooling Energy` | not used in State 1 |
| `Baseboard Gas Energy`, `Baseboard Total Heating Energy`, `Baseboard Electricity Energy` | not used in State 1 |

**The parser pulls only 3 variables out of EP's ~25:** Zone Mean Air T, Zone Operative T, Surface Outside Face Incident Solar Radiation Rate per Area. Everything else is recomputed in Python from EP's T_zone trace + the engine's own ach / U / area inputs. **The Dynamic State 1 path uses EP only as a T_zone solver — the rest of the integrand is Static-style arithmetic.** Issue #8 below.

### Display traversal

The Dynamic-parser emits `heat_balance.annual.losses` with 7 envelope element keys + free-running `annual.gains.solar` (4 facades + total). **It does NOT emit `losses_at_setpoint`** (confirmed in audit baseline dump: `losses_at_setpoint keys: MISSING`).

| Term | EP emits? | Parser-computed? | Frontend displays? |
|---|---|---|---|
| Q_conduction_walls (free-running) | indirect (T_zone trace) | ✓ `acc_cond_wall` (`sql_parser.py:1626, 1639`) | ✓ as `annual.losses.external_wall.kwh` |
| Q_conduction_roof | indirect | ✓ | ✓ |
| Q_conduction_floor | indirect | ✓ | ✓ |
| Q_conduction_glazing (4 faces) | indirect | ✓ per face | ✓ as `annual.losses.glazing.kwh` (sum) |
| Q_thermal_bridging | indirect (parser uses U_envelope − U_clear-edge uplift) | ✓ `UA_bridging × dT` | ✓ (Bridgewater dump showed 0.0 — see Issue #11) |
| Q_air_leakage | EP emits `Zone Infiltration Sensible Heat Loss Energy` (not consumed) | ✓ `UA_leakage × dT` recomputed | ✓ as `annual.losses.fabric_leakage.kwh` |
| Q_permanent_vent | EP emits `Zone Ventilation Sensible Heat Loss Energy` (not consumed) | ✓ `UA_permanent(t) × dT` recomputed | ✓ as `annual.losses.permanent_vents.kwh` |
| Q_natural_vent (operable openings) | n/a (state1-gated) | n/a | n/a |
| `losses_at_setpoint.*` block | n/a | **NOT emitted** | Sankey + Rows + Stacked + Summary table read this on Static path; on Dynamic they get nothing → display falls back to `annual.losses` (free-running convention values). **Cross-engine display inconsistency — see Issue #12.** |
| Solar gain (per face + total) | indirect (Incident Solar variable) | ✓ via `g × area × frame × incident` | ✓ |

### Reconciliation

Bridgewater audit baseline (Dynamic, post Commit A):

```
Σ free-running losses (annual.losses)     = 344.1 MWh   (parser-computed from EP T_zone)
Σ losses_at_setpoint (Brief 28k shape)    = NOT EMITTED
Solar (parser-computed from EP incident)  = 82.3 MWh
Reported heating demand                   = 209.8 MWh
Reported cooling demand                   = 16.9 MWh
Mean T_air (parser read from EP)          = 21.1 °C   ← SUSPICIOUS
Comfort hours                             = 3,684 / 8,760 (42%)

Identity check (parser formula at sql_parser.py:1670-1676):
  Demand = Σ_h UA_total × max(0, lower_c − T_out) − Q_solar  over hours where T_op < lower_c
  This integrates over fewer hours than Static (Static gates on H_weather > 0, an envelope condition;
  Dynamic-parser gates on T_op < 21°C, which depends on the zone trace).

Cannot perform integrand-vs-display invariant here because:
  (1) Dynamic doesn't emit losses_at_setpoint, so there is no setpoint-convention display.
  (2) The free-running annual.losses values (344 MWh) are NOT what enters the demand integral.
      The integral uses lumped UA_total × dT, not per-element max(0, T_air − T_out).
  (3) The 344 MWh free-running display value reflects T_zone hovering near 21°C all year (mean 21.1 °C);
      Static's 128 MWh free-running reflects T_zone running closer to T_out (mean 16.1 °C).

The reconciliation invariant the brief mandates does not cleanly apply to Dynamic State 1 in its
current shape. **Issue #12 — Dynamic State 1 needs a losses_at_setpoint emission for the invariant
to be uniform across engines.**
```

### Defended numbers (Bridgewater audit baseline, Dynamic)

| Number | Defence |
|---|---|
| Heating demand 209.8 MWh | = `Σ_h UA_total(h) × max(0, 21 − T_out_h) − Q_solar_h` over hours where `T_op_h < 21`. Parser formula. **Defended in shape; magnitude not independently re-derived.** |
| Cooling demand 16.9 MWh | = parser formula for cooling. Similar shape, opposite gating. Partially defended. |
| Mean T_air 21.1 °C | **UNDEFENDED — SUSPICIOUS.** The trace shows runs of exactly `21.0` across many hours (e.g. h64–h89 mostly = 21.00). Free-running zone with no internal gains and no HVAC should NOT pin at 21°C. Investigate (Issue #13). |
| `annual.losses.permanent_vents` 122.4 MWh | = `UA_permanent(t) × (T_air − T_out)` integrated. With T_air ≈ 21 °C ≈ T_set, this happens to converge to Static's setpoint value (120.8) — but only because T_air pins at 21. If the trace clamping is real, this number is **artificially inflated** by the same root cause as #13. |
| `annual.losses.fabric_leakage` 90.9 MWh | Same — high because mean T_air is 21.1 °C. Static free-running was 13.7 MWh (mean T_air 16 °C); Dynamic free-running being ~6× higher is consistent with the 5K T_air difference. **Undefended pending #13.** |
| Solar gain 82.3 MWh | Parser computes from EP's `Surface Outside Face Incident Solar Radiation Rate per Area × g × area × frame_correction`. Lower than Static's 99.4 MWh by 17 MWh; the EP-side incidence-angle adjustment is the named mechanism (per Window 7 / ISO 15099 — citation pending). **Defensible-pending Part 3 numerical decomposition.** |
| Comfort hours 3,684 / 8,760 (42%) | = count of hours where `lower_c ≤ T_op ≤ upper_c`. Defended by formula; magnitude depends on T_op trace which inherits the #13 question. |
| EP solar_distribution = "FullExterior" | Chris's Q4: this means all transmitted solar lands on zone air (no per-surface interior tracking). Different from Static's 70/30 convective/radiative split. Possible contributor to Dynamic's higher T_air. **Mechanism named, magnitude pending Part 3.** |

### Open issues found (Part 2 additions, continuing from #1–#7)

8. **[S2]** Dynamic State 1 parser ignores EP's own loss meters and recomputes everything in Python from T_zone + project inputs. Variables requested but unused: `Zone Infiltration Sensible Heat Loss/Gain Energy`, `Zone Ventilation Sensible Heat Loss/Gain Energy`, `Surface Inside Face Conduction Heat Transfer Energy`, `Zone Windows Total Transmitted Solar Radiation Energy`. EP's own per-element accounting is the more thorough answer (it accounts for sol-air, surface convection coefficients, sky long-wave) than recomputing in Python from T_air. **The Dynamic path is currently Static-with-EP-T_zone, not full-EP.** This explains why "Dynamic" isn't materially more accurate than Static for envelope losses.
9. **[S1]** `ZoneInfiltration:DesignFlowRate.schedule_name = "hotel_ventilation_continuous"` (`_build_infiltration_objects:297`). Semantically suspicious — an infiltration object (uncontrolled fabric leakage) referencing a "hotel ventilation" schedule. Should be `always_on` or equivalent. Verify the schedule's actual hourly values are 1.0; if they vary with occupancy, fabric leakage drops during unoccupied hours — incorrect for a State 1 fabric integrand.
10. **[S1]** "HVAC plant beyond Ideal Loads (DHW, VRF, MVHR, gas boilers) is still emitted but the Ideal-Loads-driven zone temperatures mean it produces near-zero output during the run" (docstring `:1187`). Contract violation: State 1 should be envelope-only with NO HVAC plant emitted. Emitting and muting risks (a) longer EP runtime, (b) spurious meter values, (c) accidental engagement if a future change touches the muting setpoints. Strip them at State 1.
11. **[S2]** Dynamic-parser thermal bridging shows **0.0 MWh** in `annual.losses.thermal_bridging` despite Static computing 10.4 MWh and despite the parser code at `sql_parser.py:1490-1495` computing `UA_bridging` from U_envelope − U_clear-edge uplift. Either the construction library entries don't carry the U_clear-edge field so the uplift is always 0, or the Bridgewater constructions library specifies them equal. Either way: Dynamic systematically under-reports envelope loss by the TB amount. Cross-references Static finding (Brief 28-TB-Simple's whole point was that Dynamic can't do TB natively).
12. **[S2]** Dynamic State 1 parser does NOT emit `losses_at_setpoint` block — only `annual.losses` (free-running convention). The Sankey + Rows + Stacked + Summary table all read `losses_at_setpoint` on Static; on Dynamic they fall back to free-running. **Cross-engine display divergence:** flipping the top-bar engine toggle silently changes the loss convention being displayed without telling the user. The integrand-vs-display invariant (Issue #6) cannot be applied uniformly until Dynamic emits the setpoint block.
13. **[S3]** Dynamic State 1 mean T_air = 21.1 °C with hourly trace clamping at exactly 21.0 across many runs of hours. A free-running zone with no internal gains and no HVAC should NOT pin at the heating setpoint. Possible causes: IdealLoads outdoor-air ventilation engaging at design rate (delivers conditioned air despite muted setpoints), sizing-phase initialisation contaminating the trace, EP warmup days bleeding through the output filter, or a Schedule:Compact referencing 21°C inadvertently. **Investigate immediately — if true, Dynamic envelope-only is reading the wrong T_zone and every defended number in this section is wrong.** Likely accounts for the +8% heating-demand Δ between Static and Dynamic; would shift Dynamic heating demand if corrected.

### Cross-engine consistency check

Bridgewater audit baseline (post Commit A):

| Term | Static MWh | Dynamic MWh | Δ | Defensible mechanism (4-rubric check) |
|---|---|---|---|---|
| Heating demand | 194.3 | 209.8 | +15.5 (+8%) | UNDEFENDED. Candidate mechanisms named but quantification pending Part 3 — and Issue #13 (T_air clamping) may invalidate the comparison entirely until resolved. |
| Cooling demand | 44.0 | 16.9 | −27.1 (−62%) | UNDEFENDED. Most likely the gating difference (Static: hours where weather pushes for cooling; Dynamic-parser: hours where T_op > 24°C). Dynamic's mean T_op stays in band thanks to apparent T_air clamping → fewer cooling-demand hours. **If #13 resolves the clamping, this Δ may shrink dramatically.** |
| Solar gain | 99.4 | 82.3 | −17.1 (−17%) | Mechanism **named** (EP SimpleGlazingSystem incidence-angle adjustment vs Static `g × area × frame × shading`), not yet **quantified** per-hour, citation **pending** (Window 7 / ISO 15099), reproducibility test **pending** (change g uniformly, predict same fractional change on both). 1/4 of rubric. |
| Fabric loss displayed (Σ 7 envelope) | 251.5 (setpoint) | 344.1 (free-running) | n/a — **different conventions** | Display ghost. Issue #12. Cannot compare until Dynamic emits setpoint block. |
| Mean T_zone | 16.1 °C | 21.1 °C | +5.0 K | UNDEFENDED. Static's lumped 2-node losing heat too fast vs Dynamic's CTF retaining heat (would be defensible if true) — OR Dynamic's T_zone is contaminated by Issue #13. **Cannot defend either way until #13 is resolved.** |

**Part 3 (cross-engine reconciliation) is blocked on Issue #13.** A 5 K T_zone divergence is large; it could legitimately come from real model differences (lumped vs CTF, solar distribution), but Issue #13's trace-clamping evidence suggests measurement artifact rather than physics. Resolve before defending any cross-engine number.

---

**Standing by for Chris sign-off on Part 2 before Part 3 begins.**
