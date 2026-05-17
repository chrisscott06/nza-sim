# Brief 29 — Open Issues (numbered)

Severity scale:
- **S1** — cosmetic / docs / labelling. Numbers correct, presentation off.
- **S2** — number off but defensible direction; doesn't change end-user decisions (yet).
- **S3** — number off in a way that breaks decisions or violates building physics.

Status:
- **OPEN** — diagnosed, not fixed.
- **FIXED** — corrected; commit hash linked.
- **DOCS-ONLY** — finding is methodology / process; no code change planned for this audit pass.

---

## #1 — Operable openings included in State 1 demand integral but not in display

| Field | Value |
|---|---|
| Module | Building (envelope-only) |
| Engine | Static + Dynamic (both) |
| Severity | **S3** |
| Status | **FIXED** in commit [`39a828c`](../..) |
| Current value (pre-fix) | Static heating demand 384 MWh / Dynamic 359 MWh |
| Expected value (post-fix) | Static 194.3 MWh / Dynamic 209.8 MWh |
| Root cause | Brief 28e Gate E4 added operable-opening emission to both engines without the State 1 suppression that the louvre path already had. State 1's demand integral accumulated 202 MWh of "New door (north)" natvent loss. The 7-element Summary table didn't iterate the `natural_ventilation` sibling array, so the term was hidden. |
| Why missed by existing tests | The display-to-display reconciliation (POL-M3 `ReconciliationRow`) confirmed annual sum = monthly sum, but both displays iterated the same incomplete element list. Internal-consistency tests cannot catch a term that's hidden from all displays. |

---

## #2 — Permanent-vent loss over-stated ~5× on Bridgewater (wrong topology assumption)

| Field | Value |
|---|---|
| Module | Building (envelope-only) |
| Engine | Static + Dynamic (both) |
| Severity | **S3** |
| Status | **OPEN** |
| Current value | 120.8 MWh (Static); EP `WindandStackOpenArea` emits cross-flow with comparable magnitude on Dynamic |
| Expected value | ~24–85 MWh depending on integration method; ~24 MWh is the defensible audit number for Bridgewater (balanced mechanical, 134 rooms × 8 l/s extract, EPW-integrated ΔT) |
| Root cause | No `flow_mode` field on `building.openings[*]`. Static engine hardcodes cross-flow wind-only correlation at `instantCalc.js:1003-1004`. Dynamic engine emits `ZoneVentilation:WindandStackOpenArea` (cross-flow). Bridgewater's actual topology is **balanced mechanical** (cellular hotel with continuous bathroom extract; trickle vents are the makeup path, not the driver). |
| Worked-example reference | `docs/audit/29_permanent_vent_methodology.md` — Cases A / B / C reproduced with live engine inputs. |
| Fix scope | **Group with #3 and #4 — single coherent rework of `_calculateEnvelopeOnly`'s permanent-vent block (Chris call 2026-05-17). Do NOT fix piecemeal.** Data-model: add `flow_mode: 'cross' \| 'single_sided' \| 'balanced_mechanical'` field; default cross. Per-opening `C_d` field. Static: branch on `flow_mode`, add stack term to cross-flow path (#4), use slot-corrected C_d (#3). Dynamic: emit `ZoneVentilation:DesignFlowRate` for balanced_mechanical, `WindandStackOpenArea` otherwise. Single commit, single regression sweep. |

---

## #3 — Discharge coefficient C_d hardcoded to 0.6, no geometry awareness

| Field | Value |
|---|---|
| Module | Building (envelope-only) |
| Engine | Static |
| Severity | **S2** |
| Status | **OPEN** |
| Current value | C_d = 0.6 applied to all openings (`instantCalc.js:807`) |
| Expected value | Per CIBSE Guide A §4.6 + Table 4.20: 0.61 sharp orifice, 0.65 general louvre, **0.35–0.40 long narrow slot (aspect > 10:1)**. Bridgewater trickle vents are 15 mm × 1.2 m slots (aspect ~80:1) → C_d ≈ 0.40 not 0.6. Over-states flow by ~50% under the cross-flow path. |
| Root cause | Single hardcoded constant; no per-opening C_d field. |
| Fix scope | Same fix as #2 (per-opening `C_d` field, default by geometry classification). **Cross-references #2 — implement together.** |

---

## #4 — Stack term missing in Static permanent-vent flow

| Field | Value |
|---|---|
| Module | Building (envelope-only) |
| Engine | Static |
| Severity | **S2** |
| Status | **OPEN** |
| Current value | `Q_louvre_m3s = Cd · A · √Cw · v_wind` (wind-only, no stack) at `instantCalc.js:1003` |
| Expected value | Per CIBSE Guide A §4.6: `ΔP_total = √(ΔP_stack² + ΔP_wind²)`. For Bridgewater (16 m × 12 K winter ΔT): ΔP_stack ≈ 7–8 Pa, comparable to ΔP_wind ≈ 10 Pa. Wind-only correlation under-estimates total ΔP by ~30%. |
| Root cause | Static implements simplified CIBSE Guide A wind-only formula; assumes stack contribution negligible. Not true at building height ≥ 10 m. |
| Fix scope | Add stack term to Static permanent-vent flow. **Only matters once #2 is resolved** — cross-flow correlation is wrong for Bridgewater anyway; #4 affects buildings where cross-flow IS the right topology. |

---

## #5 — `AIR_HEAT_CAPACITY` constant mis-labelled (cosmetic)

| Field | Value |
|---|---|
| Module | (shared constant used by multiple engine paths) |
| Engine | Static |
| Severity | **S1** |
| Status | **OPEN** |
| Current value | `const AIR_HEAT_CAPACITY = 0.33  // kWh/m³/K` (`instantCalc.js:121`) |
| Expected value | Same magnitude, but units label should read `Wh/(m³·K)`. Physical value is ρ·c_p ≈ 1206 J/(m³·K) = 0.335 Wh/(m³·K). The code uses 0.33 dimensionally as Wh/(m³·K) (because `ach × volume = m³/h` and the product `0.33 × ach × volume` is taken as W/K — only works if 0.33 is Wh/(m³·K), not kWh). |
| Root cause | Constant author wrote kWh but meant Wh. Numbers downstream are correct because the dimensional usage is consistent within the file. Cosmetic only. |
| Fix scope | Edit the comment label; no code change. |

---

## #6 — No integrand-vs-display invariant (methodology gap)

| Field | Value |
|---|---|
| Module | All modules |
| Engine | All engines |
| Severity | **S3** (Chris call 2026-05-17 — bumped from S2; this is the structural reason #1 shipped undetected) |
| Status | **OPEN — Brief 29 deliverable #4; precondition for shipping any new module** |
| Current value | Display-to-display reconciliation (POL-M3 `ReconciliationRow`) checks `annual sum = monthly sum`. Does NOT catch a term that's in the integrand but not in any display. |
| Expected value | A test that at every save / run, `Σ losses_at_setpoint.{element}.heating_loss_kwh + Σ losses_at_setpoint.natural_ventilation[*].heat_loss_kwh + Σ losses_at_setpoint.ventilation[*].heat_loss_kwh + … = Σ terms entering the demand integrand` within 1%. Fail loudly. |
| Root cause | The codebase currently has no test or runtime assertion that the displayed loss breakdown is complete. The door bug (#1) slipped through because both Sankey and Summary iterated a hardcoded 7-element key list, and `natural_ventilation` was a sibling array nobody iterated. |
| Fix scope | (a) Add the invariant as a unit test in the test runner. (b) Add a runtime assertion (dev-only) that logs a warning if invariant fails. (c) Replace the POL-M3 `ReconciliationRow` UI surface with this stronger check (label already updated in Commit B `6bd46b3` to make the limitation honest). |

---

## #7 — Data-shape note: operable opening area mismatch input → emission

| Field | Value |
|---|---|
| Module | Operation (State 2.5) — flagged in Building audit |
| Engine | Static |
| Severity | **S1** |
| Status | **OPEN — defer to Part 5 audit** |
| Current value | `building_config.operable_openings[0].area_m2 = 2` (project DB, Bridgewater "Main Entrance NE") |
| Pre-fix engine emission | `losses_at_setpoint.natural_ventilation[0].area_m2 = 6`, `name = "New door (north)"` |
| Root cause | Either (a) the user edited the opening between recording and engine run, (b) there's a derivation that multiplies area_m2 by another field (height?), or (c) `synthesiseOperableOpeningsFromLegacy()` produces a different opening than what the schema shows. Need to verify in Part 5. |
| Fix scope | Audit Part 5 (Operation / State 2.5) will trace this. Not blocking Part 1. |

---

---

## #8 — Dynamic State 1 parser ignores EP's own loss meters; recomputes in Python

| Field | Value |
|---|---|
| Module | Building (envelope-only) |
| Engine | Dynamic |
| Severity | **S2** |
| Status | **OPEN** |
| Current value | Parser reads only 3 of ~25 EP Output:Variables (`Zone Mean Air Temperature`, `Zone Operative Temperature`, `Surface Outside Face Incident Solar Radiation Rate per Area`). All other emitted variables (`Zone Infiltration Sensible Heat Loss/Gain Energy`, `Zone Ventilation Sensible Heat Loss/Gain Energy`, `Surface Inside Face Conduction Heat Transfer Energy`, `Zone Windows Total Transmitted Solar Radiation Energy`) are emitted to SQL and never consumed. |
| Expected value | EP's own per-element accounting (sol-air boundary conditions, surface convection coefficients h_int/h_ext, sky long-wave per Berdahl-Martin, multi-pane glazing with incidence-angle) should be the authoritative loss decomposition. The current path uses EP as a T_zone solver, then re-does the per-element arithmetic in Python — losing most of EP's accuracy. |
| Root cause | Historical: State 1 was the first parser path written, the convention copied from Static for consistency. Brief 28b Part 3 originally planned the EP-native parse but it didn't ship. |
| Consequence | "Dynamic" is currently Static-with-EP-T_zone, not full-EP. Cross-engine reconciliation is therefore measuring T_zone divergence, not engine-method divergence. |
| Fix scope | Rewrite `_get_heat_balance_state1` to consume EP's per-element variables directly. Cross-references #12 (uniform losses_at_setpoint emission needed). |

---

## #9 — `ZoneInfiltration:DesignFlowRate` uses occupancy-keyed schedule in State 1

| Field | Value |
|---|---|
| Module | Building (envelope-only) |
| Engine | Dynamic |
| Severity | **S1** |
| Status | **OPEN — verify behaviour first** |
| Current value | `schedule_name = "hotel_ventilation_continuous"` at `epjson_assembler.py:297` |
| Expected value | `always_on` (fraction 1.0 all hours) for fabric leakage in State 1. Leakage is uncontrolled envelope porosity; it doesn't change with occupancy. |
| Verification needed | Look up `hotel_ventilation_continuous` in `nza_engine/library/schedules.py`. If hourly_value is always 1.0, this is purely a naming smell (cosmetic). If it has a non-1.0 variation, fabric leakage drops at off-hours — incorrect for State 1. |
| Fix scope | Either rename the schedule to `always_on` for clarity, or replace the reference with the existing `openings_always_on` schedule. Trivial if confirmed always-on. |

---

## #10 — HVAC plant emitted-but-muted in State 1 (contract violation)

| Field | Value |
|---|---|
| Module | Building (envelope-only) |
| Engine | Dynamic |
| Severity | **S1** |
| Status | **OPEN** |
| Current value | Docstring at `epjson_assembler.py:1187`: *"All HVAC plant beyond Ideal Loads (DHW, VRF, MVHR, gas boilers) is still emitted but the Ideal-Loads-driven zone temperatures mean it produces near-zero output during the run."* |
| Expected value | State 1 contract per `docs/state_contracts.md` is envelope-only: no mechanical systems emitted at all. |
| Consequence | (a) longer EP runtime — more objects, more sizing iterations. (b) spurious meter values may show up on the dashboard. (c) accidental engagement risk if a future change touches the muting setpoints (Issue #13 is partly evidence this has happened). |
| Fix scope | Add a `if state1: return ...` early-out around DHW / VRF / MVHR / gas-boiler emission paths. |

---

## #11 — Dynamic-parser thermal bridging emits 0.0 MWh

| Field | Value |
|---|---|
| Module | Building (envelope-only) |
| Engine | Dynamic |
| Severity | **S2** |
| Status | **OPEN — needs library check** |
| Current value | `annual.losses.thermal_bridging.kwh = 0.0` on Bridgewater Dynamic baseline. Static reports 10.4 MWh from the same `H_TB × ΔT` formula via ISO 14683. |
| Expected value | Similar magnitude to Static. The parser code at `sql_parser.py:1490-1495` derives `UA_bridging = max(0, (u_envelope - u_clear_edge) × area)` per element. If U_envelope == U_clear_edge in the construction library, UA_bridging is 0. |
| Root cause hypothesis | The construction library entries don't carry a separate `u_clear_edge` field, so Static and Dynamic disagree on whether TB is included at all. Static uses an explicit `H_TB` accumulator from ISO 14683 junction tables; Dynamic-parser tries to back it out of construction U-values. Brief 28-TB-Simple's whole purpose was to land Static's explicit TB — Dynamic was queued and never landed. |
| Consequence | Dynamic systematically under-reports envelope loss by ~10–12 MWh (TB amount) on every project. Reinforces Issue #8. |
| Fix scope | Resolved together with #8 — rewrite the Dynamic parser to consume EP's per-element output and add an explicit `H_TB × ΔT` post-process term (since EP doesn't natively represent TB). |

---

## #12 — Dynamic State 1 does NOT emit `losses_at_setpoint`

| Field | Value |
|---|---|
| Module | Building (envelope-only) |
| Engine | Dynamic |
| Severity | **S2** |
| Status | **OPEN — blocks Issue #6 uniform invariant** |
| Current value | Dynamic parser emits `annual.losses` (free-running convention) only. `losses_at_setpoint` is missing from the Dynamic result. |
| Expected value | Same shape as Static: `losses_at_setpoint.{element}.heating_loss_kwh` per envelope element + sibling arrays (`natural_ventilation[]`, `ventilation[]`). |
| Consequence | (a) Sankey / Rows / Stacked / Summary table fall back to `annual.losses` (free-running) when engine toggle is Dynamic, silently changing the loss convention. (b) Integrand-vs-display invariant (Issue #6) cannot be applied uniformly across engines. (c) Cross-engine reconciliation comparing 251.5 (Static setpoint) vs 344.1 (Dynamic free-running) is comparing different physical quantities. |
| Fix scope | Add setpoint-convention accumulators to the Dynamic parser loop. Trivial — same formula as Static (`max(0, T_set − T_driving) × U × A`), independent of T_zone trace. |

---

## #13 — Dynamic State 1 T_air clamping at 21.0 °C — DIAGNOSED 2026-05-17

| Field | Value |
|---|---|
| Module | Building (envelope-only) |
| Engine | Dynamic |
| Severity | **S3** |
| Status | **DIAGNOSED — root cause identified, fix scope below, awaiting decision** |
| Diagnostic | `scripts/_issue13_diagnostic.py` ran a minimal envelope-only EP build with all HVAC, thermostat, sizing, mechanical-vent, and zero-density gain objects stripped. Baseline (with everything) mean T_air = 21.11 °C, 29.5% of all 43,800 rows pinned within ±0.05 K of 21.0; stripped run mean T_air = 14.74 °C, 0.6% near 21.0 (noise floor), stdev jumped 1.87 K → 5.25 K. The clamping was caused by something in the stripped object set. |
| Wrong initial guess | Issue #13's candidate (a) named `ZoneHVAC:IdealLoadsAirSystem`. The actual epJSON for this project emits `ZoneHVAC:TerminalUnit:VariableRefrigerantFlow` (5 entries) + `ZoneVentilation:DesignFlowRate` (5 entries, balanced-mechanical OA) — not IdealLoads. My pre-diagnostic guess was based on the assembler code path I'd read; the actual epJSON differs because Bridgewater's `systems_config.hvac_type` selects VRF, not the ideal-loads branch. |
| Eliminated by evidence | (a) IdealLoads — not present in epJSON. (b) Sizing-phase initialisation — partial contribution at most; stripping `Sizing:Zone` alone would have been a much smaller mean shift than the observed 6.4 K. (c) Warmup bleed-through — eliminated: 43,800 rows = 5 zones × 8,760 h cleanly, no warmup contamination. (d) Schedule:Compact 21°C mis-application — no such schedule exists in the model. |
| Most likely cause (per evidence) | **(e, new) — VRF terminal units delivering tempered outdoor air via `ZoneVentilation:DesignFlowRate` even with the thermostat widened to ±60°C / ±100°C.** VRF terminal units have `cooling_supply_air_flow_rate_when_no_cooling_is_needed` and `heating_supply_air_flow_rate_when_no_heating_is_needed` parameters that default to autosized non-zero values, so the system delivers air continuously. Supply air temperature is regulated by the VRF outdoor-unit logic independent of the zone thermostat. Combined with the 8 l/s/person `DesignSpecification:OutdoorAir` rate (5 zones × ~25 people each at hotel-bedroom density), this delivers a substantial conditioned-air flow that pins zone air near the supply temperature. |
| Narrowing test attempted | A second script (`scripts/_issue13_narrow.py`) attempted to strip only VRF + dependents while keeping the thermostat. EP fatalled with `InitZoneAirSetpoints` because the thermostat references the equipment chain that was removed. Definitive single-object isolation would require multiple targeted runs; time-boxed at 90 min and the headline cause is clear enough to commit. |
| Consequence (now confirmed) | Every Dynamic-side defended number in Part 2 is contaminated. Heating demand 209.8 MWh, cooling demand 16.9 MWh, fabric_leakage 90.9 MWh, permanent_vents 122.4 MWh — all derived from a T_zone trace that's pinned by VRF supply air, not free-running envelope physics. The +8% Static-vs-Dynamic heating-demand Δ that I documented as "UNDEFENDED" in Part 2 is now confirmed as a measurement artefact, not a real physics difference. |
| Cross-references | Issue #10 (HVAC plant emitted-but-muted in State 1 — contract violation). #13 is the consequence of #10 not actually muting anything. The "muted by ±60/+100 thermostat" assumption in the docstring at `epjson_assembler.py:1187` is wrong for VRF systems. |
| Fix scope (for the eventual fix brief, NOT this audit) | Genuinely envelope-only Dynamic requires either: (i) Strip ALL HVAC + thermostat + Sizing:Zone + DSOA + OutdoorAir:Node + mechanical vent from the State 1 epJSON, leaving only envelope geometry + permanent louvres + infiltration. (ii) Replace HVAC with `ZoneHVAC:EquipmentList` having an `ZoneHVAC:IdealLoadsAirSystem` with `outdoor_air_method = "NoFlow"` and confirm thermostat widening actually mutes it. Option (i) is cleaner — Issue #10's fix done properly. |
| Status | DIAGNOSED. **Blocks Part 3** until fix decision is made (Path A / B / C / D from the strategic implications note). |
| | (below: pre-diagnostic issue text, kept verbatim for traceability) |
| Current value | Bridgewater Dynamic baseline reports mean `T_air = 21.1 °C` with hourly trace showing extended runs of exactly `21.0` (e.g. h7–h17 all read 21.0; many similar runs across the year). |
| Expected value | A free-running zone (no internal gains, IdealLoads muted by ±setpoints) with mean UK weather should track somewhere between T_out_mean (~11 °C) and T_out_mean + solar/(UA·hours) (~16–18 °C). Static reports 16.1 °C mean and a continuously varying trace. Dynamic's clamping at exactly 21°C is not consistent with free-running behaviour. |
| Possible causes (to investigate in order of likelihood) | (a) `ZoneHVAC:IdealLoadsAirSystem` provides outdoor-air ventilation at design rate regardless of muted setpoints; the supply-air-temperature limits (50°C heating, ~14°C cooling) may be conditioning OA toward a default temperature. (b) Sizing-phase initialisation (`do_zone_sizing_calculation: Yes` at `:1627`) writes 21°C as the design indoor temperature and the Output:Variable trace includes it. (c) EP warmup days (6–25) bleed through the SQL output if the post-processor doesn't filter to RunPeriod. (d) A Schedule:Compact referencing 21°C constant is being mis-applied. |
| Consequence if real | Every Dynamic-side number in Part 2's defended-numbers table is suspect: heating demand, cooling demand, free-running mean/min/max, fabric_leakage, permanent_vents — all derived from this T_zone trace. The +8% Static-vs-Dynamic heating-demand Δ may not be a real physics difference; it may be the comparison reading an artificial T_zone. |
| Why Static doesn't share this | Static has no IdealLoads, no OA system, no sizing-phase initialisation, no warmup. Its T_air is solved entirely from the heat balance equation. |
| Fix scope | Diagnostic-first per Brief 29 Hard Rule 4. Possible actions: (a) inspect raw eplusout.sql to confirm the T_zone trace contains the clamped values (rules out parser bug). (b) Run a minimal EP envelope-only case with NO IdealLoads at all and check if T_zone matches Static. (c) If IdealLoads is the cause, remove it from State 1 entirely. |
| **Blocks** | Part 3 cross-engine reconciliation — no defensible mechanism for Static-vs-Dynamic Δ can be claimed while T_zone may be artefacted. |

---

## Total: 13 issues found in Parts 1 + 2 (Building both engines)

By severity (after Chris 2026-05-17 review + Part 2 additions):
- **S3:** 4 (#1 fixed, #2 open, #6 open, #13 open)
- **S2:** 6 (#3 open, #4 open, #8 open, #11 open, #12 open) — and the grouping note still applies to #2/#3/#4
- **S1:** 3 (#5 cosmetic, #7 defer, #9 verify, #10 cleanup) — actually 4

Recount: **S3 = 4, S2 = 5 (#3, #4, #8, #11, #12), S1 = 4 (#5, #7, #9, #10).**

**Brief 29 escalation threshold triggered** (>5 issues at S2+ in a single module: Building has 9 S2+ issues split across Static and Dynamic — 4 in Static counting #6, 5 in Dynamic counting #13). Escalation: notify Chris on sign-off, hold Part 3 until #13 is resolved.

**Fix-brief grouping decisions:**
- Issues #2, #3, #4 — single rework of `_calculateEnvelopeOnly`'s permanent-vent block (Chris call 2026-05-17, both engines).
- Issues #8, #11, #12 — single rework of `_get_heat_balance_state1` to consume EP's per-element variables AND emit `losses_at_setpoint`. The two read-side and one write-side fixes touch the same function; doing them together is cheaper than three commits.
- Issue #13 must be resolved standalone first — it may invalidate any reconciliation built on top.
- Issue #6 (integrand-vs-display invariant) is a cross-cutting infrastructure fix, separate brief, precondition for any new module.

**Standing by for Chris's sign-off on Part 1 before beginning Part 2 (Building Dynamic).**
