# State 1 + State 2 invariance tests — break-the-building runbook

**Purpose.** Probe engine behaviour across the input space. The hand-calc
spreadsheet validates at ONE point (Bridgewater as configured today). These
tests check that the engine responds the right way when inputs change —
direction and rough magnitude where calculable. Together they form the
validation discipline.

**Status:** Predictions filled in (read-only). "Actual" columns are
placeholders to fill during a joint walkthrough session.

---

## Validation discipline (going forward)

**A State is not complete until BOTH of these pass:**

1. **Hand-calc validation** (`docs/validation/bridgewater_baseline_inputs.md`
   + the hand-calc spreadsheet Chris and I are building). Compares engine
   output against first-principles hand calculations at a single
   well-understood point. Tolerance ±15% per `docs/state_contracts.md`
   contract bands — "engine-vs-first-principles".
2. **Break-the-building invariance tests** (this document). Probes engine
   behaviour across a span of input changes. Pass criteria are **binary**
   per test: the engine responds in the predicted direction with no
   contract violations. Where State-to-State byte-identity applies (e.g.
   solar gain on shared envelope inputs), tolerance is **zero**.

**Zero-tolerance rule (Chris, 2026-05-14):** Solar gain depends only on
envelope inputs. State 1 (Building module) and State 2 (Internal Gains
module) MUST emit byte-identical solar values for the same building
config. Facade compass labels MUST be identical too. Any difference is
a bug regardless of magnitude. The ±15% engine-vs-hand-calc tolerance
**never** applies engine-vs-itself.

**Re-running this runbook:** Each test row lists a method (config edit
+ where to apply it). Future automation candidate — wrap the existing
`scripts/_validation_dump.mjs` to override config fields + run + diff.

---

## Conventions

- **Reference:** Bridgewater as persisted (see
  `docs/validation/bridgewater_baseline_inputs.md`).
- **Baseline State 1 values (live engine, 2026-05-14, project `cfdedcb`):**
  - Solar facade sum: 136.4 MWh (F1 57.5 / F2 4.4 / F3 71.4 / F4 3.1)
  - Solar incl roof (`totals.gains_kwh`): 182.9 MWh
  - External wall loss: 16.5 MWh
  - Roof loss: 11.1 MWh
  - Ground floor loss: 15.3 MWh
  - Glazing loss: 83.2 MWh
  - Fabric leakage: 58.7 MWh
  - Total losses: 184.7 MWh
  - Heating demand: 103.4 MWh
  - Cooling demand: 108.6 MWh
  - Comfort hours: 881
  - Underheating hours: 4,430
  - Overheating hours: 3,449
  - Free-running annual mean: 21.2 °C; winter min 4.0; summer max 44.2
- **Method shorthand:** "Edit `params.X` to Y" means edit the field on the
  persisted building config (`PUT /api/projects/{id}`) and reload, OR
  monkey-patch in a one-shot script via `scripts/_validation_dump.mjs` with
  a config override. For tests where direct UI editing exists (geometry,
  comfort band), prefer the UI so the full reactivity chain runs.

---

## Section A — State 1 geometry invariants

| # | Input change | Method | Predicted direction | Predicted magnitude | State-to-State byte-identity | Actual | Pass/fail | Notes |
|---|---|---|---|---|---|---|---|---|
| A1 | Double GIA (e.g. `num_floors` 4 → 8) | UI: Building → Geometry, change num_floors | Heating + cooling demand both roughly 2× (more volume to condition); per-m² metrics roughly unchanged; solar facade values 2× too (glazing area doubles with floor count); fabric_leakage 2× (volume doubles); T_op trace closer to T_out (mass scales with surface area, not as fast as volume — net coupling shifts) | Demand ~2×; per-m² ~unchanged | Solar facades + losses byte-identical State 1 ↔ State 2 at the new config | (fill) | (pass/fail) | |
| A2 | Rotate 90° (orientation 42° → 132°) | UI: Building → Geometry → orientation | F1 (was facing NE) now faces SE → solar F1 should approach Chris's old F2 value; F3 (was SW) now faces NW → drops; total solar drops (S/W mix moves to N/E) | F1 ~50→70 MWh range; F3 ~50→40 range; total down by 5-10% | Byte-identical State 1 ↔ State 2 | (fill) | (pass/fail) | |
| A3 | Rotate 180° (orientation 42° → 222°) | UI: Building → Geometry → orientation | F1 (was N) now S → big solar increase; F3 (was S) now N → big drop. Symmetric swap with F1↔F3 and F2↔F4 if WWR were symmetric — it isn't (N=0.55, S=0.38) so total may move | F1 60→90 MWh; F3 70→40 MWh; total within 5% of baseline | Byte-identical State 1 ↔ State 2 | (fill) | (pass/fail) | |
| A4 | Halve floor height (3.2 → 1.6 m) | UI: Building → Geometry → floor_height | Volume halves → fabric_leakage halves. Wall areas halve → wall loss + facade glazing area halve → glazing loss + facade solar halve. Roof + ground unchanged. Surface-vs-volume coupling shifts. | Solar facades ~halve; wall loss + glazing loss ~halve; roof/ground losses unchanged | Byte-identical State 1 ↔ State 2 | (fill) | (pass/fail) | |

---

## Section B — State 1 envelope invariants

| # | Input change | Method | Predicted direction | Predicted magnitude | State-to-State byte-identity | Actual | Pass/fail | Notes |
|---|---|---|---|---|---|---|---|---|
| B1 | Zero U-values on all four constructions | UI: assign library items with U=0, OR override constructions to a fictitious zero-U lib entry | Conduction losses → 0 (all four elements). Glazing loss → 0. Solar gains unchanged (g-value still 0.42). T_op trace shifts toward perfect adiabatic — internal gains stack indefinitely. Demand → roof-dominated only (the 0.05 opaque-roof solar coupling). Engine should NOT crash; should produce stable hourly trace. | All conduction losses = 0; total_loss = fabric_leakage only (~58.7 MWh); cooling demand way up (no path for heat to escape) | Byte-identical State 1 ↔ State 2 | (fill) | (pass/fail) | |
| B2 | Zero glazing (WWR=0 on all four facades) | UI: Building → Glazing → set all four WWR to 0 | Glazing area = 0 → glazing loss = 0, solar through windows = 0. Only roof solar contributes (~46 MWh × 0.05 transmission ≈ 2.3 MWh). Wall opaque area increases (wall_area = facade_area × 1.0). Heating demand way up (no solar offset). Cooling demand way down. | Solar facade sum → ~0; glazing loss → 0; ext_wall loss up ~10% (larger area); heating demand up 30-50%; cooling demand down 80%+ | Byte-identical State 1 ↔ State 2 | (fill) | (pass/fail) | |
| B3 | Zero infiltration (`infiltration_ach` 0.2 → 0) | UI: Building → Fabric → ACH | `UA_leakage` = 0 → fabric_leakage loss = 0. Total loss drops by 58.7 MWh. Less venting means warmer night-time T_op, slightly less heating demand. Cooling demand slightly up (no nighttime purge). | fabric_leakage → 0; total_loss ~126 MWh; heating_demand down 15-20 MWh; cooling_demand up ~5-10 MWh | Byte-identical State 1 ↔ State 2 | (fill) | (pass/fail) | |
| B4 | Double infiltration (`infiltration_ach` 0.2 → 0.4) | UI: Building → Fabric → ACH | fabric_leakage ~2× (~117 MWh). Heating demand significantly up; cooling demand significantly down (heat purges out). Summer max T_op drops a few degrees. | fabric_leakage ~117 MWh; total_loss ~243 MWh; heating_demand up 30-50%; cooling_demand down 30%+ | Byte-identical State 1 ↔ State 2 | (fill) | (pass/fail) | |
| B5 | Zero shading (all `shading_overhang.depth_m` 0.5 → 0, all `shading_fin` 0) | UI: Building → Shading | Solar gains UP across all facades (full irradiance, no obstruction). Conduction losses unchanged. Cooling demand UP. Heating demand DOWN. | Solar facades up 10-20% (depending on facade); total solar up ~10%; cooling demand up 15-25%; heating demand down 10-15% | Byte-identical State 1 ↔ State 2 | (fill) | (pass/fail) | |

---

## Section C — Weather extremes

**Note:** Currently no tropical/polar EPW files in the project. These rows
are placeholders; obtaining and configuring them is queued.

| # | Input change | Method | Predicted direction | Predicted magnitude | State-to-State byte-identity | Actual | Pass/fail | Notes |
|---|---|---|---|---|---|---|---|---|
| C1 | Switch to a tropical EPW (e.g. Singapore TMYx) | Upload EPW + set `weather_file` | Heating demand → ~0 (annual mean > 25 °C). Cooling demand way up. Solar gains higher annual total but more uniform across facades (sun closer to overhead). HDD ≈ 0; CDD high. | heating < 5 MWh; cooling > 300 MWh; solar facades within 30-50% of each other (less N-S asymmetry) | Byte-identical State 1 ↔ State 2 | **queued — no tropical EPW** | (queued) | Source candidate: climate.onebuilding.org SGP_Singapore.486980_IWEC. Add to `data/weather/current/` to unblock. |
| C2 | Switch to a polar EPW (e.g. Reykjavik or northern Sweden TMYx) | Upload EPW + set `weather_file` | Heating demand way up. Cooling demand → ~0. Winter min T_op very low. Solar facades much lower (low sun angle, short days). | heating > 500 MWh; cooling < 5 MWh; winter_min_c < -5; solar total < 80 MWh | Byte-identical State 1 ↔ State 2 | **queued — no polar EPW** | (queued) | Source candidate: climate.onebuilding.org ISL_Reykjavik.040300_IWEC. |
| C3 | Hot summer week only (custom 168-hour weather slice) | Custom script | Tests overheating-only behaviour at hourly granularity. Useful for catching summer max bugs. | Summer max T_op > 40 °C confirms Static lumped-mass over-prediction (Brief 28b territory) | n/a (short-window test) | **queued** | Defer until Brief 28b. |

---

## Section D — Comfort band

| # | Input change | Method | Predicted direction | Predicted magnitude | State-to-State byte-identity | Actual | Pass/fail | Notes |
|---|---|---|---|---|---|---|---|---|
| D1 | Widen comfort band to 18–28 °C | UI: HeatBalance → inline comfort band editor; press Enter | More hours in band. Heating + cooling demand both drop (smaller integrated deficit/surplus at the wider band edges). Underheating + overheating hours both drop. Solar + losses + free-running T trace UNCHANGED (comfort band doesn't affect physics, only demand derivation against the band). | comfort_hours up 30-50%; underheating + overheating both down 30-50%; heating_demand down ~30 MWh; cooling_demand down ~40 MWh; solar/losses/free-running byte-identical to baseline | Byte-identical State 1 ↔ State 2 | (fill) | (pass/fail) | |
| D2 | Narrow comfort band to 22–24 °C | UI: comfort band editor | Fewer hours in band. Heating + cooling demand both rise. Solar + losses + T trace UNCHANGED. | comfort_hours down 30-50%; heating + cooling demand up ~20 MWh each | Byte-identical State 1 ↔ State 2 | (fill) | (pass/fail) | |
| D3 | Comfort band inverted (lower > upper) | UI: should be refused | UI should reject the input; engine should never see lo > up. If engine sees it, undefined behaviour. | n/a — UI validation test | n/a | (fill) | (pass/fail) | This is a UI input validation test, not a physics invariance test. |

---

## Section E — State 2 invariants (require gain inputs)

These tests require the project to have non-zero occupancy/gains
(Bridgewater does — 268 occupants, lighting + 2 equipment profiles). Each
test perturbs gain inputs only; envelope physics stays untouched, so all
envelope-side outputs (solar, fabric losses) must remain byte-identical
across the change AND between State 1 ↔ State 2.

| # | Input change | Method | Predicted direction | Predicted magnitude | State-to-State byte-identity | Actual | Pass/fail | Notes |
|---|---|---|---|---|---|---|---|---|
| E1 | `occupancy.occupancy_rate` 1.0 → 0 | UI: Profiles → Occupancy → rate slider | People gain → 0. Lighting (proportional_with_spill) → 0 in occupied hours. Equipment with `relationship_to_occupancy: proportional` → 0; baseload of independent equipment unchanged. Heating demand UP (no internal gains to offset), cooling demand DOWN. Solar + fabric losses byte-identical to baseline State 2 ↔ State 1 envelope. | people_kwh → 0; lighting_kwh significantly reduced (only the daylight-dimmed schedule remains, no occupancy spill); equipment_kwh reduced by the proportional share; heating_demand up ~30-50 MWh; cooling_demand down ~30-50 MWh | Envelope outputs (solar, conduction losses) byte-identical to State 1 baseline | (fill) | (pass/fail) | |
| E2 | `occupancy.occupancy_rate` 1.0 → 0.5 | UI: same | All occupancy-proportional gains roughly halve. Independent profiles unchanged. People sensible halves. | people_kwh ~half; cooling/heating delta ~half of E1 | Envelope byte-identical | (fill) | (pass/fail) | |
| E3 | Zero LPD on bedroom lighting profile (`gains.lighting.profiles[0].magnitude.value` 2 → 0) | UI: Profiles → Lighting → Bedroom lighting → magnitude | Lighting gain → 0. People + equipment unchanged. Heating demand slightly up (less lighting = less heat). Cooling demand slightly down. Envelope unchanged. | lighting_kwh → 0; heating_demand up ~5-10 MWh; cooling_demand down ~5-10 MWh | Envelope byte-identical | (fill) | (pass/fail) | |
| E4 | Zero equipment baseload (both equipment profiles `.baseload.value` 1 → 0) | UI: Profiles → Equipment → baseload field on each profile | Equipment baseload component → 0. Active component unchanged. Total equipment_kwh drops by the baseload share. | equipment_baseload_kwh → 0; total equipment_kwh drops by ~30-50% (depends on baseload share of total); heating up ~10 MWh, cooling down ~10 MWh | Envelope byte-identical | (fill) | (pass/fail) | |
| E5 | Zero everything (occupancy_rate 0, LPD 0, baseload 0, active 0) | UI or script: zero all gain inputs | State 2 outputs become byte-identical to State 1 (no internal gains contribute). free-running T trace matches State 1 exactly. | All internal gain accumulators 0; State 2 demand = State 1 demand byte-identically; State 2 T_op trace = State 1 T_op trace | Byte-identical envelope **AND** byte-identical free-running/demand between State 1 and State 2 | (fill) | (pass/fail) | This is the strongest invariance test for State 2 — proves no internal-gain leakage into the envelope calc path. |

---

## Section F — Cross-State consistency invariants (zero-tolerance)

These are the bytes-MUST-match tests Chris's correction codified. Each
test sets a building config and asserts byte-identity between fields the
engine emits from both `_calculateEnvelopeOnly` (called from Building
module) and `_calculateState2` (called from Internal Gains module).

| # | Test | Method | Pass criteria | Actual | Pass/fail |
|---|---|---|---|---|---|
| F1 | Solar facade values match | `state1.heat_balance.annual.gains.solar.{north,south,east,west}.kwh` === `state2.heat_balance.annual.gains.solar.{north,south,east,west}.kwh` | Object equality on every facade kwh + kwh_per_m2 value | (fill) | (pass/fail) |
| F2 | Solar roof value matches | `state1.gains.solar.roof` === `state2.gains.solar.roof` (top-level, since state2 spreads `...state1Result.gains`) | Exact equality | (fill) | (pass/fail) |
| F3 | Conduction loss values match | For each key in `{external_wall, roof, ground_floor, glazing, thermal_bridging, fabric_leakage, permanent_vents}`: `state1.heat_balance.annual.losses[k].kwh` === `state2.heat_balance.annual.losses[k].kwh` | Object equality on every loss key | (fill) | (pass/fail) |
| F4 | Glazing per-facade loss matches | `state1.losses.conduction.glazing.{f1,f2,f3,f4}` === `state2.losses.conduction.glazing.{f1,f2,f3,f4}` | Exact equality on each facade glazing-loss | (fill) | (pass/fail) |
| F5 | Free-running trace agrees when gains zeroed (test E5) | With all internal gain inputs = 0: `state2.free_running.hourly_temperature_c[h]` === `state1.free_running.hourly_temperature_c[h]` for every h | Exact equality across 8,760 hours (tolerance: floating-point ε per element) | (fill) | (pass/fail) | Strictest invariance — proves State 2 with zero gains reduces exactly to State 1. |
| F6 | Facade compass labels match | For each face: `solarLabel(face, params.orientation)` in Building module === `solarLabel(face, params.orientation)` in Internal Gains module | String equality | (fill) | (pass/fail) | Currently FAILS — Problem 1a. Fix at `HeatBalanceView.jsx:59` (pass `orientationDeg={params.orientation}`). |

---

## Test methodology — how to run a row

### Manual (preferred for one-off walkthrough)
1. Open Bridgewater at port 5176.
2. Edit the input via the UI (geometry / fabric / shading / comfort band / gains as listed).
3. Open Building → Heat Balance. Screenshot or record the four facade solar values, four element losses, demand.
4. Without further edits, open Internal Gains → Heat balance tab. Record same.
5. Compare values. Byte-identity required (zero tolerance on shared physics).
6. Compare actual vs predicted direction. Fill in the Actual + Pass/fail columns of this doc.
7. Revert the input to baseline before moving to the next test.

### Scripted (preferred for re-running)
`scripts/_validation_dump.mjs` already loads the persisted Bridgewater config and runs the Static engine in envelope-only mode. To run a test:
1. Override fields in the loaded config (e.g. `buildingConfig.num_floors = 8`).
2. Re-run `calculateInstant` for both `mode: 'envelope-only'` and `mode: 'envelope-gains'`.
3. Diff `state1.heat_balance.annual.gains.solar` vs `state2.heat_balance.annual.gains.solar`.
4. Print PASS/FAIL.

Wrapping this into a test harness (`scripts/state_invariance_tests.mjs`?) is a follow-up — produces a CI-runnable matrix.

---

## Outcomes ledger

(filled after the walkthrough session)

| Date | Section | Tests run | Tests passed | Tests failed | Notes |
|---|---|---|---|---|---|
| _____ | A | _____ | _____ | _____ | _____ |
| _____ | B | _____ | _____ | _____ | _____ |
| _____ | C | _____ | _____ | _____ | _____ |
| _____ | D | _____ | _____ | _____ | _____ |
| _____ | E | _____ | _____ | _____ | _____ |
| _____ | F | _____ | _____ | _____ | _____ |

---

## Related docs

- `docs/state_2_heat_balance_discrepancies_2026_05.md` — the investigation
  that surfaced the need for these tests.
- `docs/validation/bridgewater_baseline_inputs.md` — single-point input
  reference (the spreadsheet's domain).
- `docs/validation/bridgewater_state1_engine_outputs_2026_05.md` — single-
  point engine output reference.
- `docs/validation/yeovilton_epw_summary.md` — weather summary for the
  single-point reference.
- `docs/state_contracts.md` — the engine contract these tests probe.
