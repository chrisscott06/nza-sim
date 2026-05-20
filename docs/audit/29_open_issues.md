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
| Status | **STATIC FIXED** by Brief 33 Part 1 (this commit) — two-branch topology dispatch (`cross` / `single_sided`); Bridgewater migrated to `single_sided`. Dynamic path deferred to Brief 30 resumption. Live engine verification pending Bridgewater walkthrough; see `docs/audit/32_vent_fix_verification.md`. |
| Current value (pre-fix) | 120.8 MWh (Static, cross-flow with default C_d on a cellular hotel topology) |
| Expected value (post-fix, Part 1 alone) | Bridgewater on `single_sided` with hard-coded global C_d 0.6: low-double-digit MWh range (hand-calc ~14 MWh at mean-wind, mean-ΔT, heating hours). Engine output is what it integrates over the actual EPW. Brief 33 Part 2 will further reduce this via the C_d restriction factor for trickle vents. |
| Root cause | No `flow_mode` field on `building.openings[*]`. Static engine hardcoded cross-flow wind-only correlation at `instantCalc.js:~1011`. Dynamic engine emits `ZoneVentilation:WindandStackOpenArea` (cross-flow). Bridgewater's envelope-level topology is **single-sided** (cellular layout; each room has a trickle vent on one façade; no cross-flow path between opposite façades). Whether the building also has mechanical extract is a Systems-module fact and does not change the envelope-level classification — that was the scope error in Brief 32 Part 2's first attempt at this fix. |
| Worked-example reference | `docs/audit/29_permanent_vent_methodology.md` — Cases A (cross-flow) and B (single-sided) reproduced with live engine inputs. |
| Fix history | **Brief 32 Part 2 (`341eeff`):** added three-branch dispatch (`cross` / `single_sided` / `balanced_mechanical`) and `mech_extract_lps_per_room` field. `balanced_mechanical` and `mech_extract_lps_per_room` were a Building/Systems scope violation — mechanical concepts in the envelope module. **Brief 33 Part 1 (this commit):** reverted that scope violation. Schema is now `flow_mode: 'cross' \| 'single_sided'`, default `'single_sided'`. `mech_extract_lps_per_room` field removed; Bridgewater migrated from `balanced_mechanical` → `single_sided` via `scripts/33_bridgewater_single_sided_migration.py`; obsolete `scripts/32_bridgewater_balanced_mech_migration.py` removed (`git rm`). C_d still hard-coded 0.6 in both branches — Brief 33 Part 2 closes that (Issue #3). Stack term still absent in `cross` branch — Issue #4 deferred. |
| Fix deferred (Dynamic) | `epjson_assembler.py` still emits `ZoneVentilation:WindandStackOpenArea` for all louvres. Frozen at HEAD `54407e3` pending Brief 30 resumption (per Brief 32 §1.5). Brief 30 Phase 1.x will rework when Dynamic resumes. |

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

## #13 — Dynamic State 1 T_air clamping at 21.0 °C — FIXED 2026-05-18 (re-diagnosed root cause)

| Field | Value |
|---|---|
| Module | Building (envelope-only) |
| Engine | Dynamic (via API) |
| Severity | **S3** |
| Status | **FIXED** (Brief 30 Phase 1.0 commit) — re-diagnosed root cause, see "Re-diagnosis 2026-05-18" section below. Regression test at `scripts/test_api_simulate_mode.py`. |

### Re-diagnosis 2026-05-18 (Brief 30 Phase 1.0)

The original 2026-05-17 diagnosis below said the cause was "VRF terminal units delivering tempered outdoor air via `ZoneVentilation:DesignFlowRate` even with the thermostat widened to ±60°C / ±100°C." That diagnosis was **one layer too shallow** — the VRF and DesignFlowRate objects were not supposed to be in the State 1 epJSON at all. They appeared because:

**Root cause (corrected):** `POST /api/projects/{id}/simulate` declared its `mode` parameter as `mode: str = "full"`. FastAPI's default for simple-typed parameters with defaults on POST endpoints treats them as **query-string-only**. The JSON body `{"mode":"envelope-only"}` from yesterday's curl was silently dropped, and the endpoint ran with the default `mode="full"`. The resulting simulation emitted the full State 3 epJSON (VRF + DSOA + thermostat at 21°C / 24°C + full occupancy + lights + equipment). The parser then took that SQL and ran `_get_heat_balance_state1` on it, mis-interpreting a full-system simulation as State 1.

**Evidence:** When the API is called with `mode` as a query parameter — `POST .../simulate?mode=envelope-only` — the State 1 assembler path executes correctly and produces:

| Quantity | mode-as-body (silently dropped → mode=full) | mode-as-query (Phase 1.0 fix honoured) |
|---|---|---|
| `ZoneHVAC:TerminalUnit:VariableRefrigerantFlow` | 5 | 0 |
| `ZoneVentilation:DesignFlowRate` | 5 | 0 |
| `DesignSpecification:OutdoorAir` | 5 | 0 |
| `Sizing:Zone` | 5 | 0 |
| Schedule:Constant `state1_heating_setpoint` (−60 °C) | absent | present |
| Mean T_air | **21.11 °C** (clamped) | **15.51 °C** (free-running) |
| % hours near 21.0 ± 0.05 K | **29.5%** | **0.4%** (noise floor) |
| Stdev T_air | 1.87 K | 5.32 K |

### Four-candidate assessment, corrected

| Candidate | Original verdict | Corrected verdict |
|---|---|---|
| (a) IdealLoads OA conditioning | "ELIMINATED — actual HVAC is VRF, not IdealLoads" | **NEW NOTE:** the State 1 path actually DOES emit IdealLoads (with state1 ±60/±100 setpoints). The pre-Phase-1.0 baseline had VRF only because mode=full was running, not because the State 1 path emits VRF. |
| (b) Sizing-phase initialisation | "Partial contribution at most" | Confirmed: with mode=envelope-only correctly invoked, Sizing:Zone is not emitted (assembler skips it). Not the cause. |
| (c) Warmup days bleed-through | "Eliminated — 43,800 rows clean" | Unchanged. Not the cause. |
| (d) Schedule:Compact 21°C | "Eliminated — no such schedule" | Unchanged. Not the cause. |
| (e) VRF + DesignFlowRate not muted | "MOST LIKELY CAUSE" | **WRONG**. VRF and DesignFlowRate were emitted because mode=full ran, not because State 1 mode failed to suppress them. Phase 1.0 corrects the API; State 1 mode WAS already capable of suppressing them. |
| **(f) NEW — API endpoint silently drops mode parameter from JSON body** | not in original list | **ACTUAL ROOT CAUSE.** Confirmed by query-vs-body test in `scripts/test_api_simulate_mode.py`. |

### Fix shape

`api/routers/projects.py:428` — `simulate_project` endpoint now accepts `mode` from BOTH query string and JSON body via a `SimulateProjectBody` Pydantic model + `Body(default_factory=...)`. Body fields override query defaults when explicitly set. The frontend (which has always used query string, `SimulationContext.jsx:165`) is unaffected. Curl callers using JSON body are now honoured.

### Regression test

`scripts/test_api_simulate_mode.py` exercises three forms:
1. `POST .../simulate?mode=envelope-only` (query string) → asserts no `ZoneHVAC:*` etc. in epJSON
2. `POST .../simulate` with body `{"mode":"envelope-only"}` → same assertions
3. `POST .../simulate` with no mode → asserts default `mode="full"` produces a full-system epJSON

Test passes against the Phase 1.0 backend. Would have caught the original bug.

### Lessons captured

Two Bible lessons added (see `29_bible_lesson_to_append.md`):
1. API parameter binding can silently disable a feature — only end-to-end tests catch it.
2. When "the real root cause" keeps being one layer deeper, more layers remain — keep diagnosing.

### Original 2026-05-17 diagnostic (kept for traceability — partially incorrect, see Re-diagnosis above)
| Diagnostic | `scripts/_state1_strip_regression.py` (renamed from `_issue13_diagnostic.py` in Brief 30 Phase 0) ran a minimal envelope-only EP build with all HVAC, thermostat, sizing, mechanical-vent, and zero-density gain objects stripped. Baseline (with everything) mean T_air = 21.11 °C, 29.5% of all 43,800 rows pinned within ±0.05 K of 21.0; stripped run mean T_air = 14.74 °C, 0.6% near 21.0 (noise floor), stdev jumped 1.87 K → 5.25 K. The clamping was caused by something in the stripped object set. |
| Wrong initial guess | Issue #13's candidate (a) named `ZoneHVAC:IdealLoadsAirSystem`. The actual epJSON for this project emits `ZoneHVAC:TerminalUnit:VariableRefrigerantFlow` (5 entries) + `ZoneVentilation:DesignFlowRate` (5 entries, balanced-mechanical OA) — not IdealLoads. My pre-diagnostic guess was based on the assembler code path I'd read; the actual epJSON differs because Bridgewater's `systems_config.hvac_type` selects VRF, not the ideal-loads branch. |
| Eliminated by evidence | (a) IdealLoads — not present in epJSON. (b) Sizing-phase initialisation — partial contribution at most; stripping `Sizing:Zone` alone would have been a much smaller mean shift than the observed 6.4 K. (c) Warmup bleed-through — eliminated: 43,800 rows = 5 zones × 8,760 h cleanly, no warmup contamination. (d) Schedule:Compact 21°C mis-application — no such schedule exists in the model. |
| Most likely cause (per evidence) | **(e, new) — VRF terminal units delivering tempered outdoor air via `ZoneVentilation:DesignFlowRate` even with the thermostat widened to ±60°C / ±100°C.** VRF terminal units have `cooling_supply_air_flow_rate_when_no_cooling_is_needed` and `heating_supply_air_flow_rate_when_no_heating_is_needed` parameters that default to autosized non-zero values, so the system delivers air continuously. Supply air temperature is regulated by the VRF outdoor-unit logic independent of the zone thermostat. Combined with the 8 l/s/person `DesignSpecification:OutdoorAir` rate (5 zones × ~25 people each at hotel-bedroom density), this delivers a substantial conditioned-air flow that pins zone air near the supply temperature. |
| Narrowing test attempted | A second script (`_issue13_narrow.py`) attempted to strip only VRF + dependents while keeping the thermostat. EP fatalled with `InitZoneAirSetpoints` because the thermostat references the equipment chain that was removed. Script deleted in Brief 30 Phase 0 cleanup (single-shot diagnostic, no ongoing use). |
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

By severity (after Brief 30 Phase 1.0 re-diagnosis 2026-05-18):
- **S3:** 4 total — #1 FIXED (commit 39a828c), #13 FIXED (Brief 30 Phase 1.0), #2 open, #6 open
- **S2:** 5 open — #3, #4, #8, #11, #12 — and the grouping note still applies to #2/#3/#4
- **S1:** 4 — #5 cosmetic, #7 defer, #9 verify, #10 cleanup

**Brief 29 escalation threshold (>5 S2+ in a single module)** was triggered pre-Phase-1.0. Now: 4 S2+ open (Building module, both engines). Threshold still on the line; remains a watch-list item for Brief 30 phases.

**Fix-brief grouping decisions:**
- Issues #2, #3, #4 — single rework of `_calculateEnvelopeOnly`'s permanent-vent block (Chris call 2026-05-17, both engines).
- Issues #8, #11, #12 — single rework of `_get_heat_balance_state1` to consume EP's per-element variables AND emit `losses_at_setpoint`. The two read-side and one write-side fixes touch the same function; doing them together is cheaper than three commits.
- Issue #13 must be resolved standalone first — it may invalidate any reconciliation built on top.
- Issue #6 (integrand-vs-display invariant) is a cross-cutting infrastructure fix, separate brief, precondition for any new module.

**Standing by for Chris's sign-off on Part 1 before beginning Part 2 (Building Dynamic).**

---

## #14 — Internal Gains reads `systems_config_v25.ventilation` (scope contamination)

| Field | Value |
|---|---|
| Module | Internal Gains (envelope-gains / State 2) |
| Engine | Static (`_calculateState2`) |
| Severity | **S2** |
| Status | **OPEN** — fix deferred to Systems-module rework |
| Discovered | Brief 36 Part 1 audit (2026-05-18) |
| Location | `frontend/src/utils/instantCalc.js:2371` — `building.systems_config_v25.ventilation` read at the top of `_calculateState2`. Surfaces in `state2.losses_at_setpoint.ventilation[]` (line 3060), `acc_mech_vent_heat_per_system`, `acc_mech_vent_cool_per_system`, `daily_mech_vent_per_system`, `monthly_mech_vent_per_system`. |
| Scope violation | Per CLAUDE.md "Module scopes": mechanical ventilation (MVHR, MEV, fan power, heat-recovery effectiveness) is owned by the Systems module. The Internal Gains module computes occupancy / lighting / equipment heat gains; it should not read systems concepts. |
| Why this is currently tolerable | The Internal Gains UI filters mech-vent out of the displayed Heat Balance: `HeatBalanceView` passes `modules: ['fabric', 'thermal_bridging', 'fabric_leakage', 'permanent_vents', 'internal_gains']` to the shared HeatBalance component — `ventilation` is not in the allowlist. The gain integrand itself (people / lighting / equipment) is clean. The only contamination is in the engine read + State 2 result object's `losses_at_setpoint.ventilation` block. |
| Fix scope (when Systems is reworked) | Move the per-system mechanical ventilation computation into the Systems engine path. State 2 should only see envelope + internal gains. State 3 (Systems-on) would then own the mech-vent term and feed back as an upstream change to the zone heat balance, not as a direct read inside Internal Gains. |
| Cross-references | CLAUDE.md "Module scopes" Internal Gains / Operation / Systems stubs (Brief 33 Part 3). |

---

## #15 — Lighting `independent` mode applies `occupancy_rate` scaling inconsistently with equipment `independent` mode

| Field | Value |
|---|---|
| Module | Internal Gains (Static) |
| Engine | Static (`computeHourlyGains` + `lightingFractionForHour`) |
| Severity | **S2** |
| Status | **OPEN** |
| Discovered | Brief 36 Part 1 audit (2026-05-18) |
| Location | `frontend/src/utils/instantCalc.js`:`lightingFractionForHour` (line 1974) — unconditionally multiplies by `occupancy_rate`. Called from `computeHourlyGains` line 2073/2076 even when `profile.relationship_to_occupancy === 'independent'` (and no active exception). |
| Current value | An `independent` lighting profile (e.g. emergency lighting, always-on egress) with `occupancy_rate = 0.75` outputs **75%** of its scheduled power — the engine applies the building-wide occupancy_rate even though the profile's relationship is meant to be independent of occupancy. |
| Expected value | `independent` mode should produce `pFrac = schedule × monthly_multiplier` with no occupancy_rate scaling — matching equipment's `independent` branch at `equipmentFractionForHour` line 1989-1994 which correctly does `return v * mm` without occupancy_rate. |
| Root cause | `lightingFractionForHour` has a single code path that always multiplies by `occupancy_rate`. There is no `if (relationship === 'independent')` branch to suppress that scaling. The branching at `computeHourlyGains` line 2063 only picks which schedule to look up; the per-hour multiplier path is the same. |
| Asymmetry with equipment | `equipmentFractionForHour` (line 1987) has the correct branching: `independent` returns `v · mm` (no occupancy_rate), `proportional` returns `max(standby, v · mm · occupancy_rate)`. Lighting should mirror this. |
| Why not caught by reconciliation row | The Heat Balance ↔ Monthly reconciliation in SummaryView compares two *display* paths of the same engine output. Both paths sum the same buggy integrand. Display-vs-display consistency holds; integrand-vs-physical-intent does not. Same shape as the Brief 29 Issue #1 door bug at the integrand-defining layer — except here the consequence is a wrong scaling factor on a real term, not a hidden ghost term. |
| Fix scope | Branch on `relationship_to_occupancy` inside `lightingFractionForHour`. When `'independent'`, skip the `occupancy_rate` multiply (mirroring equipment's branch). When `'proportional'` / `'proportional_with_spill'`, retain it. The exception-override branch at line 2066-2071 already skips occupancy_rate scaling (correctly); this fix aligns the no-exception path. Single-file fix in `instantCalc.js`; verify Bridgewater's headline lighting kWh moves only if it has an `independent` profile (default profile is `proportional_with_spill`, so default Bridgewater is unaffected — fix is for users who configure independent emergency lighting). |
| Cross-references | Brief 36 Part 1 §"Sanity-check hand-calcs" (`docs/audit/32_static_audit_FINDINGS.md`). |

---

## #16 — `ProjectDashboard.jsx` reads non-existent `instantResult.eui` field (always undefined)

| Field | Value |
|---|---|
| Module | Home / Project Dashboard |
| Engine | Static (any path through `calculateInstant`) |
| Severity | **S1** |
| Status | **OPEN** |
| Discovered | Brief 39 Part 1 consumer audit (2026-05-19) |
| Location | `frontend/src/pages/ProjectDashboard.jsx:219` — `const modelledEui = results?.summary?.eui_kWh_per_m2 ?? instantResult?.eui ?? null`. The `instantResult?.eui` fallback reads a field that doesn't exist on any of the five `calculateInstant` result shapes. The real field on inline-legacy is `eui_kWh_m2` (instantCalc.js line 5534); on State 3 it's `eui_kwh_per_m2`. |
| Current value | The expression always evaluates `instantResult?.eui` → `undefined` → falls through to the final `null` fallback. Effectively, when `results?.summary?.eui_kWh_per_m2` is absent, the dashboard shows "—" instead of the instant-calc estimate it intended to. |
| Expected value | When the saved-simulation EUI is absent, the dashboard should show the instant-calc estimate. That's what the `?? instantResult?.eui` fallback was meant to do — but the field name is wrong. |
| Root cause | Field name mismatch — the original author probably typed the intuitive short name `eui` rather than the actual `eui_kWh_m2`. No test caught it because there's no test that exercises the dashboard in the no-simulation-result branch with a populated instant-calc result. |
| Fix scope | Single-line fix: read both possible names: `instantResult?.eui_kWh_m2 ?? instantResult?.eui_kwh_per_m2`. **Not in scope of Brief 39** — logged here for a future small-fix pass. |
| Why this is currently tolerable | The dashboard shows "—" instead of a number in the no-simulation case. Cosmetic; no decision impact. |
| Cross-references | `docs/audit/39_calculation_flow_map.md` "Inline-legacy rationalisation — deferred" section §"Consumer audit findings". |

---

## #17 — Operable-opening flow_mode dispatch absent (same class as Issue #2)

| Field | Value |
|---|---|
| Module | Building (envelope-only), Operation, Internal Gains |
| Engine | Static (State 1 + State 2 + inline-legacy) |
| Severity | **S2** — wrong-numbers, bounded magnitude depending on opening size, visible to user; not S3 because the system isn't physically delivering service through an always-open opening in production buildings. |
| Status | **FIXED** by Brief 41 Parts 0–7 (commits `6c99373` Part 0 diagnostic, `4b3b984` Part 1 engine dispatch, `68aca29` Part 2 schema cleanup, `d72a216` Part 3 migration, `afdcb51` Part 4 UI, `a5f3d5c` Part 5 reconciliation code-side, `5bbdbd1` Part 7 UI mirror). Per-opening cd/flow_mode UX is Brief 42's territory. |
| Discovered | Bridgewater walkthrough 2026-05-19 (4 m² always-open door surfaced 646.3 MWh annual loss). |
| Location | `frontend/src/utils/instantCalc.js`:1354 (State 1 Q_wind), 2718 (State 2 Q_wind), 5255 (inline-legacy Q_window) — all pre-fix. |
| Current value (pre-fix) | Bridgewater 4 m² × 2 m permanent door: 646.3 MWh/yr (cross-flow correlation on UK coastal weather). |
| Expected value (post-fix) | Single-digit to low-double-digit MWh under single_sided dispatch with building-wide cd 0.29 (10-30 MWh physics-defensible bracket; no calibration target). Bridgewater post-fix value to be backfilled into `docs/audit/41_operable_openings_diagnostic.md` §"Brief 41 Part 5 — Bridgewater reconciliation" after the walkthrough. Walkthrough rolls into Brief 42's per-opening UI verification. |
| Root cause | Brief 28e Gate E2 introduced per-opening wind+stack physics with cross-flow Q_wind formula (`Cd × A × √(Cw × v²)`). Brief 33/34 added flow_mode dispatch for permanent vents only; operable openings missed the sweep. Brief 39 Part 3 verified the State 1 → State 2 mirror was faithful but didn't audit the correlation itself — *mirror-correctness ≠ physics-correctness*. |
| Same class as | Issue #2 (permanent-vent flow_mode dispatch absent in State 2 + inline-legacy — fixed by Brief 39). |
| Fix delivered | Three-location parity per CLAUDE.md Rule 14: State 1 + State 2 + inline-legacy all dispatch on flow_mode for operable openings. Temperature-mode keeps stack term (height_m retained); always/scheduled modes wind-only. |
| Cross-references | `docs/audit/41_operable_openings_diagnostic.md` (Part 0 audit), `docs/audit/29_permanent_vent_methodology.md` §"Operable openings: wind-vs-wind+stack physics split by control mode", CLAUDE.md Rule 14 (extended to call out operable openings). |

---

## #18 — DHW validation failure zeroes consumption.dhw.demand_mwh + delivered

| Field | Value |
|---|---|
| Module | Systems |
| Engine | Static (v40 displacement path) |
| Severity | **S4** — minor UX gap; not wrong-numbers because validation failure correctly blocks compute and the user sees the share-mismatch warning in the section header. The visual that's lost is "demand exists but isn't being served". |
| Status | **OPEN** — deferred. Logged at Brief 40 Part 5b Section C walkthrough Item 9 (2026-05-19). |
| Discovered | Brief 40 Part 5b Section C 15-item browser walkthrough on Bridgewater 2026-05-19 (`fb2e439`). |
| Location | `frontend/src/utils/systemsEngine.js` `_computeDhw` validation-failure return block (~line 295). |
| Behaviour | When DHW v40 systems' enabled share_pct sum != 100 within ½pp tolerance, `_computeDhw` returns `{ error: '...', demand_at_comfort_mwh: 0, delivered_total_mwh: 0, ...zeros..., systems: [] }`. The v40-to-v25 adapter `v40ServiceBlockToV25Shape` propagates the zeros; `_calculateState3` reads `dhw_demand_displayed_mwh` from `brief40Computed.dhw.demand_at_comfort_mwh` (= 0) and sets `consumption.dhw.demand_mwh = 0`. Sankey's DHW demand bar disappears entirely — both demand AND delivered are zero. |
| Why this is currently tolerable | (a) The share-validation warning IS visible in the section header (amber badge "⚠ N%"); (b) the Normalise quick-fix is one click; (c) heating + cooling validation-failure cases preserve their headline demand and only zero delivered — DHW is the outlier. |
| Expected fix | When validation fails, preserve `demand_at_comfort_mwh` from the building's lead DHW physics fields (so user can see "demand X / delivered 0" and understand what's unserved). Roughly five lines in `_computeDhw`'s validation-fail return block. Same pattern should be considered for `_computeHeatingOrCooling` if its current behaviour is also zero-demand (verify before fixing). |
| Cross-references | `docs/audit/40_walkthrough_diagnosis.md` §12 Item 9 (verbatim findings). |

---

## #19 — DEFAULT_PARAMS systems_config_v40 load-fallback is whole-object

| Field | Value |
|---|---|
| Module | Systems / ProjectContext |
| Engine | n/a (load-side) |
| Severity | **S4** — minor; no wrong-numbers. Symptom: thin-entry defaults (lighting + small_power Internal-Gains-linked seeds) don't re-apply once a project has any v40 content. |
| Status | **OPEN** — deferred. Logged at Brief 40 Part 5b diagnosis (2026-05-19). |
| Discovered | Brief 40 walkthrough diagnostic `d0b8e4b` (finding #4) and Part 5b Section C migration (small_power confirmed empty on Bridgewater after `--force` migration). |
| Location | `frontend/src/context/ProjectContext.jsx` project-loader at line ~712: `systems_config_v40: bc.systems_config_v40 ?? DEFAULT_PARAMS.systems_config_v40`. |
| Behaviour | The `??` fallback fires only when `bc.systems_config_v40` is `undefined` or `null`. Once bc has v40 populated (even partially via UI edits or migration), the DEFAULT_PARAMS seed for lighting + small_power doesn't re-apply on load. Bridgewater's small_power array is currently empty for this reason (the field was absent in the pre-migration bc, the migration's `existing_v40.get("small_power") or []` returned empty, and the load-side fallback didn't re-fill from DEFAULT_PARAMS). |
| Why this is currently tolerable | The v40 displacement check is per-service — when v40.{service} is empty/absent, v25 pass-through wins for that service. Bridgewater's small_power EUI contribution still comes from `state2Result.heat_balance.annual.gains.internal.equipment.kwh` (the v25 path), so the headline EUI is unaffected. The visible gap: the Systems left panel's SMALL POWER section is empty (no card), and the user can't apply controls on small power without manually adding a system. |
| Expected fix | Per-service load-side merge instead of whole-object fallback. Roughly: read `v40From = bc.systems_config_v40 ?? {}`, build per-service `v40From.{service} ?? DEFAULT_PARAMS.systems_config_v40.{service}`, assemble. Five-line change. Bridgewater post-fix: small_power thin entry re-seeded on next load. |
| Cross-references | `docs/audit/40_walkthrough_diagnosis.md` §5 (finding #4), §12 Item 1 (post-migration state confirms empty small_power array). |

---

## #20 — Interventions editor: full main-app UI in patch-capture context deferred

| Field | Value |
|---|---|
| Module | Interventions (Brief 41) |
| Engine | n/a (UI scope) |
| Severity | **S2** — not wrong-numbers; a UX limitation of the curated editor that ships in Brief 41 Part 4.1. The curated editor exposes high-value patch targets across Envelope, Internal Gains, and all six v40 Systems services, sufficient to trigger all 10 verification matrix rows (Notion §V; engine-verified 2026-05-20). The deferred work is the brief's original "Wrap arbitrary main-app UI in a patch-capture context" affordance — letting the user navigate Building / Internal Gains / Systems / Operation sub-modules inside the editor pop-out and have every change captured as a patch. |
| Status | **OPEN** — deferred to a future brief (Brief 42 territory). |
| Discovered | Brief 41 Part 4 pre-implementation scope escalation (2026-05-20). Chris-approved "Pragmatic curated editor" with the explicit follow-up that the wrap-main-app-UI work is deferred until the curated editor has been used and specific gaps surface. |
| Location | `frontend/src/components/modules/interventions/InterventionEditorBuildingView.jsx` is the curated editor. The "wrap main-app UI" follow-up would replace or augment it with a `PatchCaptureProvider` that wraps the actual Building / Internal Gains / Systems / Operation module components, intercepting `updateParam` calls and writing patches instead of mutating ProjectContext. |
| Architectural question owned by the follow-up brief | Patch granularity — atomic-per-leaf (one patch per leaf field, e.g. `building.openings.south.cd`) vs compound-per-key (one patch per top-level `updateParam` blob, e.g. `building.openings = {...}`). The curated editor in Part 4.1 uses atomic-per-leaf throughout, which keeps the patch list clean and override-detection per Notion §10 ("two interventions patching the same field → last-write-wins") working correctly. The wrap-main-app-UI design needs to either (a) translate top-level updateParam writes into multiple atomic patches via a per-key splitter, or (b) accept compound patches at the cost of override-detection granularity. The decision belongs to whichever brief lands the wrap-main-app-UI work, not Part 4.1. |
| Why this is currently tolerable | The curated editor covers all 10 Notion §V matrix rows. The user can express Brief 41-scope interventions (fabric / plant / demand / ventilation / lighting controls / setpoints / shading / occupancy) without leaving the editor. The discoverability gap is real but bounded: someone wanting to patch a field NOT in the curated list (e.g. weather location, schedule-curve overrides, specific construction layer property) has to either widen the curation (small editor change) or wait for the wrap-main-app-UI follow-up. |
| Expected fix scope | A future brief implements `PatchCaptureProvider` + a sub-sidebar inside the editor pop-out for navigating modules. Estimate ~6-8 hours including the patch-granularity design + per-module wiring + dedupe handling. Should land alongside theme-grouped UI (Brief 42) since both touch the editor surface. |
| Dual-write pattern in vent fields | Part 4.1 establishes a precedent for fields where v40 + v25 dual-write is needed (ventilation SFP + recovery — State 2 demand-side reads v25, State 3 delivery reads v40). The wrap-main-app-UI follow-up should generalise this pattern: if a wrapped main-app input writes to a v25 field that has a v40 counterpart, the capture context should dual-write (or vice versa). |
| Cross-references | `docs/briefs/active/41_interventions_module.md` §Part 4 §4.4 (the deferred original spec); Notion design note §V "Visualisation verification matrix" (the engine-side acceptance criterion that the curated editor meets in full); Brief 41 STATUS.md Part 4.1 entry. |

---

## #21 — DHW demand fields are per-system; should be per-service

| Field | Value |
|---|---|
| Module | Systems |
| Engine | Static (v40 + v25 DHW paths) |
| Severity | **S1** — user-visible AND structurally wrong. Multiple DHW systems can carry inconsistent demand fields with no defined precedence; engine behaviour when two systems disagree is undefined. |
| Status | **OPEN** — surfaced 2026-05-20 during Brief 41 Part 5 walkthrough. To be addressed by **Brief 42 — Systems UX**. |
| Discovered | Brief 41 Part 5 walkthrough on Bridgewater. Bridgewater has two DHW v40 entries (gas + ASHP); each carries its own `demand_litres_per_m2_day` / `demand_litres_per_person_per_day` / `demand_basis` / `tap_outlet_temp_c` / `cold_supply_temp_c` fields. |
| Location | `frontend/src/utils/systemsEngine.js` `_computeDhw` reads demand fields from the per-system block. `frontend/src/components/modules/systems/SystemEditorCard.jsx` exposes them as per-system editable inputs (Brief 40 Part 3 schema). |
| Behaviour | DHW demand is a building / service property (single source of truth for L/person/day or L/m²/day + tap-mix temperatures), not a system property. Multiple systems share the demand via `share_pct`. The current per-system schema creates ambiguity: if user sets gas DHW's demand to 50 L/person/day and ASHP's to 80 L/person/day, what's the actual demand? The engine's current behaviour appears to use the first-enabled system's demand (`enabledSystems[0]`), which is fragile + surprising + invisible to the user. |
| Expected fix | Move `demand_litres_per_m2_day`, `demand_litres_per_person_per_day`, `demand_basis`, `tap_outlet_temp_c`, `cold_supply_temp_c` to a service-level block at the top of the DHW section (e.g. `params.systems_config_v40.dhw_service = { demand_basis, demand_litres_per_..., tap_outlet_temp_c, cold_supply_temp_c }`). Per-system DHW entries retain only `source, efficiency_metric, setpoint, share_pct, control_mechanism, enabled`. Engine reads service-level for demand calc; multiplies by share for delivered/fuel per system. UI exposes service-level fields ONCE per service (in the section header or a service-level expandable block), not once per system. Migration: existing per-system fields collapsed to service-level (first non-null wins; warn on disagreement). |
| Cross-references | Brief 40 audit doc §4 (DHW tap-mix mathematics — math is correct; the per-system home is the bug). Brief 41 Part 5 walkthrough findings. To be addressed by **Brief 42 — Systems UX**. |

---

## #22 — System editor needs a draggable pop-out (Brief 40 Part 5c deferred work)

| Field | Value |
|---|---|
| Module | Systems |
| Engine | n/a (UI scope) |
| Severity | **S1** — user-visible. The left panel (~300 px) is too cramped to author a full system; the per-system editor's Identity / Energy / Control / Diagnostic / Library / source groups don't fit comfortably. Authoring any non-trivial DHW or Ventilation system is uncomfortable. |
| Status | **OPEN** — Brief 40 Part 5c originally scoped this work but was skipped after Section C walkthrough verdict that "the section-list UX works cleanly." That verdict reflected the Bridgewater test stack which used near-default values; the cramped UX surfaces once a user tries to author or significantly edit a system in earnest. Resurfaced 2026-05-20 during Brief 41 Part 5 walkthrough. To be addressed by **Brief 42 — Systems UX**. |
| Discovered | Brief 41 Part 5 walkthrough on Bridgewater. The full SystemEditorCard rendered inside the ~300 px left column doesn't have enough horizontal space for the multi-field Energy block, DHW tap-mix fields, ventilation SFP + recovery fields, Diagnostic comfort-vs-setpoint table, or the source / control / library group spread. |
| Location | `frontend/src/components/modules/SystemsModule.jsx` (left panel layout); `frontend/src/components/modules/systems/SystemEditorCard.jsx` (current full editor — needs to move into a pop-out). |
| Behaviour | Each system is currently a collapsible card in the left panel with an inline-expanded full editor when clicked. The editor card's content doesn't fit comfortably; field labels truncate, numeric inputs are narrow, and the Library group's actions overflow. Combined with the single-expand accordion shipped 2026-05-20 (`a92d563`), only one system is visible at a time, which improves readability but doesn't solve the fundamental width problem. |
| Expected fix | Refactor to a draggable pop-out using the established Brief 37 `SchedulePopout` chrome (already reused by Brief 41 Part 4 `InterventionEditorPopout` — proven pattern). localStorage key: `nza-system-editor-popout-position`. Left panel becomes a SUMMARY row per system: label, share %, headline efficiency (e.g. SCOP 3.5 / η 0.85 / SEER 4.0 / SFP 1.4), on/off toggle, edit button. Click edit → pop-out opens with the full SystemEditorCard inside; Save / Cancel commit/discard via `updateSystem(service, idx, patch)`. Mirrors the interventions editor pop-out shape so users have one consistent editor chrome across the app. Per-service summary block at the top of each service section can absorb shared fields once #21 lands (DHW service-level demand). |
| Cross-references | `docs/briefs/archive/40_part_5b_wiring_and_toggles_COMPLETED.md` §"Operational mode" (the Part 5c skip decision); `docs/briefs/archive/40_systems_library_architecture_COMPLETED.md` (Brief 40 close — recorded Part 5c as skipped); Brief 41 Part 4 `InterventionEditorPopout` (the established pattern); Brief 37 `SchedulePopout` (shared chrome). To be addressed by **Brief 42 — Systems UX** alongside #21. |
