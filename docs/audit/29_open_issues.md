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
| Fix scope | Data-model: add `flow_mode: 'cross' \| 'single_sided' \| 'balanced_mechanical'` field; default cross. Per-opening `C_d` field. Static: branch on `flow_mode`. Dynamic: emit `ZoneVentilation:DesignFlowRate` for balanced_mechanical, `WindandStackOpenArea` otherwise. **Cross-references #3.** |

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
| Severity | **S2** |
| Status | **OPEN — Brief 29 deliverable #4** |
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

## Total: 7 issues found in Part 1 (Building Static)

By severity:
- **S3:** 2 (#1 fixed, #2 open)
- **S2:** 3 (#3 open, #4 open, #6 open)
- **S1:** 2 (#5 cosmetic, #7 defer)

Brief 29 escalation threshold (>5 issues at S2+ in a single module) is **NOT** triggered: 4 issues at S2+ in this module.

**Standing by for Chris's sign-off on Part 1 before beginning Part 2 (Building Dynamic).**
