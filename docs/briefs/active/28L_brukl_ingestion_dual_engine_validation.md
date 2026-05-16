# Brief 28L — BRUKL ingestion + dual-engine validation

**Status:** Active
**Author:** Chris (with Claude Chat)
**Date opened:** 2026-05-16
**Builds on:** Brief 28k (heat loss setpoint convention) — Gates 1, 2, 3 PASSed
**Validation evidence:** `Bridgewater_Bottom_Up_Energy_Model.xlsx` (project root) + EnergyPlus outputs

---

## Background

Brief 28k corrected the Static engine to compute heat loss against fixed setpoints using sol-air on opaque elements, T_out on glazing and ventilation, with no free-running gate. The convention math validated against the hand-calc spreadsheet across Gates 1, 2, and 3 within tolerance.

Two things remain before the foundation can be declared complete:

**1. Bridgewater's persisted inputs don't match BRUKL design intent.** Investigation of the BRUKL/as-built Fabric & Systems Assumptions Schedule (`26002-NZA-XX-XX-SC-X-0010_v2.xlsx`) revealed that fabric U-values, thermal bridging, ventilation flows, and glazing g-value all differ from current persisted values. Static is running on placeholder defaults, not Bridgewater's actual design.

**2. The Dynamic engine (EnergyPlus) has not been validated against the post-28k Static engine.** Brief 28k validated Static against the hand-calc spreadsheet. EnergyPlus is the historical gold-standard implementation of the standard convention. The dual-engine architecture's credibility depends on both engines producing similar results under the same inputs.

This brief addresses both as a single coordinated piece of work.

---

## Scope

### In scope

**Part A — BRUKL ingestion to Bridgewater's persisted state**

1. Update fabric U-values via per-project `u_value_override` mechanism on Bridgewater's construction_choices:
   - Wall: 0.18 → 0.14 W/m²K
   - Roof: 0.16 → 0.15 W/m²K
   - Ground floor: 0.22 → 0.13 W/m²K
   - Glazing: 1.40 W/m²K (unchanged ✓)

2. Update glazing g-value via per-project override:
   - Glazing g: 0.42 → 0.50 (area-weighted from BRUKL: G1 bedroom 0.56, G3 curtain wall 0.27)

3. Update air infiltration:
   - `building_config.infiltration_ach`: 0.20 → 0.23 ac/h
   - Source: BRUKL air permeability 4.64 m³/h·m² @ 50 Pa, applied at /20 rule of thumb

4. Add thermal bridging engine input + math:
   - New schema field: `building_config.fabric.thermal_bridging_alpha_pct` (default 18, BRUKL-notional)
   - Bridgewater value: 200 (from BRUKL Technical Data Sheet α = 200.31%)
   - Engine math (option (a) per earlier ruling): `effective_fabric_UA = area_UA × (1 + α/100)`
   - Driving temperature: T_out (no sol-air on thermal bridges)
   - Include in shoulder gate test (H_weather)
   - Output: separate line `losses_at_setpoint.thermal_bridging.{heating_loss_kwh, cooling_gain_kwh}`

5. Restructure Bridgewater ventilation array to BRUKL configuration:
   ```
   ventilation: [
     { name: 'mvhr_gf_public',        flow_L_s: 1425, hre: 0.80, sfp: 1.4, hours: 8760 },
     { name: 'bedroom_extract',       flow_L_s: 2208, hre: 0.00, sfp: 0.4, hours: 8760 },
     { name: 'public_toilet_extract', flow_L_s: 210,  hre: 0.00, sfp: 0.4, hours: 8760 },
   ]
   ```
   Each system is its own line in `losses_at_setpoint.ventilation[]`. Heat loss per system:
   `flow × ρ × Cp × (1 - HRE) × max(0, T_setpoint - T_out)` integrated hourly.

6. Permanent vents: keep current 1.0 m² NE + 0.76 m² SW (1.76 m² total). Source: earlier review. Trickle vent equivalent area pending Renson IEMAH065 datasheet retrieval — flagged but not blocking.

**Part B — Static engine re-run with BRUKL inputs**

Re-run Brief 28k Gates 1, 2, 3 validator against updated Bridgewater configuration. Capture realised numbers per element, demand-level outputs, and solar/gain bucketing.

**Part C — Dynamic engine validation against Static**

1. Configure Bridgewater Dynamic run with same BRUKL inputs (U-values, ventilation, thermal bridging, ACH, g-value).
2. Run Dynamic in envelope-only mode (no internal gains, no systems). Extract:
   - Per-surface conduction: `Surface Outside Face Conduction Heat Transfer Energy` summed by surface type
   - `Zone Infiltration Total Heat Loss Energy`
   - Ideal Loads outputs if heating/cooling enabled at wide setpoints
3. Run Dynamic at State 2 (internal gains active, no HVAC). Extract same outputs plus zone temperature trace.
4. Compare Static vs Dynamic per element and at demand level.

### Out of scope (deferred to later briefs)

- LPD calibration. Lighting and equipment power densities remain at persisted values (1.5/1.5 W/m²) which are placeholder. BRUKL p.27 retrieval or NCM defaults required — defer to Brief 28M.
- Separate VRF ground floor system (SCOP 4.93 / SEER 3.29). Currently merged with bedroom VRF (SCOP 5.12 / SEER 3.51) in model. Lower priority — defer.
- Trickle vent equivalent area (Renson IEMAH065 datasheet). Currently using 1.76 m² placeholder. Action item, non-blocking.
- Display layer rework. Engine produces correct numbers; UI consumes them. Display brief to follow.
- Brief 28f Part 5.4 (Systems UI rewrite). Parked.
- Brief 28e (windows + doors). Parked.
- Brief 28g/h/i (calibration ingester, pathway library, interventions). Parked.

### Not changing

- Brief 28k convention work — Gates 1-3 PASSed, no engine changes to convention.
- State 3 systems pipeline.
- Brief 28j hourly MVHR recovery cap mechanics.
- Wall physics (`stepWallLinearized`) — internal sol-air already correct.

---

## Engine changes

### File: `frontend/src/utils/instantCalc.js`

**New input fields read:**
- `building_config.fabric.thermal_bridging_alpha_pct` (default 18 if absent)

**Per-project override mechanism for U-values:**
Already supported via `pickWholeWallU` precedence: `u_value_override → u_value_W_per_m2K → layer-computed`. Apply overrides on Bridgewater's `construction_choices` via seed script, not by editing shared library entries.

**Thermal bridging accumulator in `_calculateEnvelopeOnly` and `_calculateState2`:**

Declare near other setpoint-convention accumulators:
```javascript
let acc_heat_loss_thermal_bridging = 0
let acc_cool_gain_thermal_bridging = 0
const alpha_tb = (building?.fabric?.thermal_bridging_alpha_pct ?? 18) / 100
```

Per hour, after computing area-UA terms:
```javascript
const fabric_UA_areas = (
  wholeWallU_ext * total_wall_opaque +
  wholeWallU_roof * roof_area +
  wholeWallU_floor * ground_area +
  U_glaz * total_glaz_area
)
const tb_heat_h = fabric_UA_areas * alpha_tb * Math.max(0, T_heat - T_out)
const tb_cool_h = fabric_UA_areas * alpha_tb * Math.max(0, T_out - T_cool)
acc_heat_loss_thermal_bridging += tb_heat_h
acc_cool_gain_thermal_bridging += tb_cool_h
```

Include `tb_heat_h` in `H_weather` for the shoulder gate test:
```javascript
H_weather = ... + tb_heat_h
C_weather = ... + tb_cool_h
```

Output:
```javascript
losses_at_setpoint.thermal_bridging = {
  heating_loss_kwh: r1(acc_heat_loss_thermal_bridging / 1000),
  cooling_gain_kwh: r1(acc_cool_gain_thermal_bridging / 1000),
  alpha_pct: alpha_tb * 100,
}
```

Add `acc_heat_loss_thermal_bridging` and `acc_cool_gain_thermal_bridging` to the totals.

**Ventilation accumulator restructure:**

Currently single `fabric_leakage` and `permanent_vents` accumulators. Add per-system mechanical ventilation:

Read `building_config.systems_config_v25.ventilation` array (or equivalent). For each entry:
```javascript
const flow_kg_per_s = entry.flow_L_s * rho_air / 1000
const UA_per_vent = flow_kg_per_s * Cp_air * (1 - entry.hre)
const heat_loss_h = UA_per_vent * Math.max(0, T_heat - T_out)
const cool_gain_h = UA_per_vent * Math.max(0, T_out - T_cool)
acc_vent[entry.name].heating += heat_loss_h
acc_vent[entry.name].cooling += cool_gain_h
```

Output:
```javascript
losses_at_setpoint.ventilation = [
  { name: 'mvhr_gf_public', heat_loss_kwh: ..., cool_gain_kwh: ..., flow_L_s: 1425, hre: 0.80 },
  { name: 'bedroom_extract', heat_loss_kwh: ..., cool_gain_kwh: ..., flow_L_s: 2208, hre: 0.0 },
  ...
]
```

Include ventilation heat losses in `H_weather` for shoulder gate.

Keep existing `fabric_leakage` (infiltration ACH) and `permanent_vents` (1.76 m² louvres) as separate lines.

### File: `scripts/seed_bridgewater_v25_systems.mjs`

Add idempotent updates for:
- Per-project U-value overrides on construction_choices: wall 0.14, roof 0.15, floor 0.13
- Glazing g-value override: 0.50
- `infiltration_ach`: 0.23
- `fabric.thermal_bridging_alpha_pct`: 200
- Ventilation array: 3-entry config as specified above

### Files not changed

- `frontend/src/utils/wallModel.js` — no change
- `frontend/src/utils/computeVentilationEnergy.js` — no change (still consumes ventilation array for fan power + MVHR recovery at State 3; State 2 reads same array independently for heat loss)
- `frontend/src/data/libraryData.js` — no change (per-project overrides used)

---

## Hand-calc validation targets

Spreadsheet to be updated in parallel with this brief. New targets per element after BRUKL corrections:

### Static envelope-only (Brief 28k Gate 1 re-run)

Per-element heating-direction loss at 21°C setpoint, BRUKL fabric values:

| Element | Spreadsheet kWh/yr | Tolerance | Engine output |
|---|---:|---:|---|
| External walls (sum F1-F4) | ~18,000 | ±5% | `losses_at_setpoint.external_wall.heating_loss_kwh` |
| Roof | ~9,200 | ±5% | `losses_at_setpoint.roof.heating_loss_kwh` |
| Ground floor | ~9,600 | ±5% | `losses_at_setpoint.ground_floor.heating_loss_kwh` |
| Glazing (sum F1-F4) | ~77,300 | ±5% | `losses_at_setpoint.glazing.heating_loss_kwh` |
| Background infiltration | ~92,000 | ±5% | `losses_at_setpoint.fabric_leakage.heating_loss_kwh` |
| Permanent vents | ~52,000 | ±5% (existing INFO) | `losses_at_setpoint.permanent_vents.heating_loss_kwh` |
| Thermal bridging | ~226,000 | ±5% | `losses_at_setpoint.thermal_bridging.heating_loss_kwh` |
| MVHR GF public | ~30,000 | ±10% | `losses_at_setpoint.ventilation[mvhr_gf_public].heat_loss_kwh` |
| Bedroom extract | ~230,000 | ±10% | `losses_at_setpoint.ventilation[bedroom_extract].heat_loss_kwh` |
| Public toilet extract | ~22,000 | ±10% | `losses_at_setpoint.ventilation[public_toilet_extract].heat_loss_kwh` |

(Spreadsheet exact targets to be recomputed once BRUKL values applied — preliminary estimates from earlier review.)

Per-element cooling-direction gain at 25°C setpoint — small absolute numbers, ±25% tolerance.

### Static State 2 (Brief 28k Gate 3 re-run with BRUKL)

Same per-element loss numbers as State 1 (invariance — proven in Gate 3 PASS).

Internal gains: unchanged at 186 MWh (people 108, lighting 38, equipment 39, baseline) — LPDs deferred.

Net heating demand: expected ~300-450 MWh (raw envelope ~660 MWh including thermal bridging and bedroom extract, minus useful internal gains ~165 MWh, minus beneficial solar ~30 MWh, minus MVHR recovery on GF ~25 MWh).

Net cooling demand: expected ~80-130 MWh.

### Dynamic vs Static comparison

Per-surface conduction (Dynamic) vs `losses_at_setpoint.{element}` (Static): ±15% per element.

Ideal Loads heating energy (Dynamic) vs `heating_demand_mwh` (Static): ±15%.

Ideal Loads cooling energy (Dynamic) vs `cooling_demand_mwh` (Static): ±20% (cooling demand is small absolute, ratio amplifies).

### Measured energy reconciliation (informational, not pass/fail)

Total electricity bottom-up vs measured 560 MWh — gap expected because LPDs are at placeholder values. Document the gap.
Total gas bottom-up vs measured 200 MWh — should already be within 15% from earlier DHW work.

---

## Halt gates

Five gates, each requires code review by Chris before proceeding.

### Gate L1 — BRUKL inputs applied

Implement Part A: seed updates for U-value overrides, g-value override, ACH, thermal bridging field, ventilation array restructure.

**Halt and report:**
- Diff of `scripts/seed_bridgewater_v25_systems.mjs` showing all input changes
- Diff of `frontend/src/utils/instantCalc.js` showing thermal bridging accumulator + ventilation per-system handling
- Confirmation that `pickWholeWallU` precedence is respected (override → top-level → layer-computed)
- Test pass count (existing tests should still pass — Brief 28k tests stay green)

**Chris reviews code diff before approving Gate L2.**

PASS criteria: code review clean, tests green, schema valid.
FAIL: any code question or test regression → halt, fix, re-report.

### Gate L2 — Static engine re-run with BRUKL

Run Brief 28k Gate 1, 2, 3 validators against updated Bridgewater. Report per-element numbers.

**Halt and report:**
- Per-element heating loss table (Static post-BRUKL vs spreadsheet)
- Demand-level outputs (`heating_demand_mwh`, `cooling_demand_mwh`)
- Solar bucketing (beneficial/cooling/shoulder)
- Conservation invariants
- Compare to spreadsheet targets per the table in this brief

**Chris reviews before approving Gate L3.**

PASS: all per-element rows within ±5% of spreadsheet, conservation invariants tight, demand in expected ranges.
FAIL: any row outside tolerance → halt and investigate. Do not proceed to Dynamic comparison until Static is right.

### Gate L3 — Dynamic engine envelope-only with BRUKL

Configure Bridgewater Dynamic with matching BRUKL inputs. Run envelope-only (no internal gains, no HVAC). Extract per-surface conduction outputs.

**Halt and report:**
- EnergyPlus input file (epJSON) confirming inputs match Static (U-values per construction, ventilation array, infiltration)
- Per-surface conduction outputs from EP, summed by surface type
- Comparison table: Static `losses_at_setpoint.{element}` vs Dynamic per-surface sum
- Identification of any deltas above ±15%

**Chris reviews before approving Gate L4.**

PASS: all per-element comparisons within ±15%.
FAIL: any element outside tolerance → halt, diagnose root cause (parameter difference, integration method, etc.), do not proceed.

### Gate L4 — Dynamic State 2 with BRUKL

Run Dynamic at State 2 (internal gains active, no HVAC clamping). Extract zone temperature trace and surface conduction.

**Halt and report:**
- Zone temperature trace mean (Dynamic) vs Static free-running zone mean
- Per-surface conduction at State 2 vs Static `losses_at_setpoint.{element}` at State 2
- Invariance check: Dynamic per-surface conduction should match Gate L3 envelope-only values (gain-independence)
- Heating/cooling demand if Ideal Loads run separately at setpoints

**Chris reviews before approving Gate L5.**

PASS: invariance holds, per-element within ±15%, free-running zone mean within 1K.
FAIL: any disagreement → halt.

### Gate L5 — Final validation documentation

Write `docs/validation/brief_28L_validation.md` covering:
- All five gates with PASS/FAIL status
- Per-element comparison tables for Static, Dynamic, and spreadsheet
- BRUKL input changes applied with source references
- Outstanding calibration items (LPDs, trickle vents, VRF ground floor split)
- Measured energy comparison (informational)
- Sign-off statement

Also write `docs/validation/brief_28k_validation.md` (Gate 4 of Brief 28k, deferred until now). Captures convention math validation across Gates 1-3 of Brief 28k.

**Chris reviews both documents before declaring Brief 28L closed.**

---

## Code review discipline

This brief makes code review explicit at each halt gate. Chris reads the actual diff before approving any subsequent gate. Text reports from Claude Code are necessary but not sufficient.

For each gate, Claude Code:
1. Commits the changes locally with descriptive commit message
2. Pushes to a branch (or to main if discipline allows)
3. Reports back with: gate number, code diff link or summary, validation script output, PASS/FAIL per criterion
4. Halts and waits

Chris then:
1. Pulls the latest
2. Reads the diff
3. Approves the gate or flags issues

No subsequent gate proceeds without Chris's explicit approval.

This is the discipline correction from earlier session learnings: text PASS reports without code review have allowed silent issues through (e.g., Brief 28b validated against wrong target). Code review at each gate prevents recurrence.

---

## PASS / FAIL browser scenarios

After Gate L5 closes, run browser-level smoke tests:

### Scenario 1 — Bridgewater Building tab, Heat Balance view, envelope-only

**Setup:** Open Bridgewater, set state mode to envelope-only.

**Check:**
- Heat Balance shows setpoint-convention loss numbers
- External walls show ~18 MWh
- Glazing shows ~77 MWh
- Thermal bridging shows ~226 MWh (NEW LINE)
- Bedroom extract shows ~230 MWh (NEW LINE)
- MVHR GF shows ~30 MWh
- Total loss displays ~660 MWh

**PASS:** All visible, no NaN, no formula errors.
**FAIL:** Missing thermal bridging or per-system ventilation lines, or numbers outside ranges.

### Scenario 2 — Bridgewater Results > Energy & Carbon

**Setup:** Switch state to Full (State 3).

**Check:**
- Heating fuel (VRF electricity) reads in 30-50 MWh range
- DHW gas reads ~180 MWh
- Total electricity reads 200-300 MWh (low because LPDs deferred)
- Banner shows: "Model uncalibrated — LPDs at placeholder values pending BRUKL ingestion"

**PASS:** Numbers within expected ranges, banner visible.
**FAIL:** Heating fuel near zero, gas way off, or banner missing.

### Scenario 3 — Static vs Dynamic agreement

**Setup:** Run Dynamic. Compare with Static.

**Check:** Static `heating_demand_mwh` vs Dynamic Ideal Loads heating energy.

**PASS:** Within ±15%.
**FAIL:** Larger disagreement.

---

## Out of scope reminders

Stay parked until Brief 28L closes:
- Brief 28f Part 5.4 (Systems UI rewrite)
- Brief 28e (windows + doors)
- Brief 28g (calibration ingester)
- Brief 28h (pathway library)
- Brief 28i (interventions)
- State-mode toggle UI
- Internal Gains Dynamic toggle bug

Brief 28M will follow for LPD calibration once BRUKL p.27 or NCM defaults are available.

---

## File pointers

**Source:** `26002-NZA-XX-XX-SC-X-0010_-_Fabric___Systems_Assumptions_Schedule_v2.xlsx` (BRUKL assumptions extract, attached to chat)

**Engine:**
- `frontend/src/utils/instantCalc.js::_calculateEnvelopeOnly` (line ~406)
- `frontend/src/utils/instantCalc.js::_calculateState2` (line ~1216)
- `frontend/src/utils/instantCalc.js::pickWholeWallU` (module scope helper)

**Seed:**
- `scripts/seed_bridgewater_v25_systems.mjs`

**Validation:**
- `Bridgewater_Bottom_Up_Energy_Model.xlsx` (repo root)
- `scripts/_check_28k_gate1_per_element_loss.mjs` (existing)
- `scripts/_check_28k_gate2_demand.mjs` (existing)
- `scripts/_check_28k_gate3_state2_demand.mjs` (existing)
- `scripts/_check_28L_dynamic_comparison.mjs` (new — Claude Code creates)

**Briefs:**
- `docs/briefs/active/28k_heat_loss_setpoint_convention.md` (existing)
- `docs/briefs/active/28L_brukl_ingestion_dual_engine_validation.md` (this brief)

**Validation docs:**
- `docs/validation/brief_28k_validation.md` (to be written at Gate L5)
- `docs/validation/brief_28L_validation.md` (to be written at Gate L5)

---

## Acknowledgement

Brief 28L exists because Brief 28k validated convention math but didn't validate against Dynamic or against BRUKL-realistic inputs. The current Bridgewater state has wrong fabric U-values, wrong thermal bridging, wrong ventilation structure, and wrong glazing g-value. The Static engine is physically correct but the inputs aren't.

Brief 28L packages BRUKL ingestion and Dynamic validation into a single coordinated workstream rather than chasing each piece via chat clarifications. Five halt gates with code review at each prevents the slip pattern seen in Briefs 28b and 28k where text PASS reports were accepted without code review.

When Brief 28L closes, the engine has the right convention AND the right inputs AND has been validated against an independent reference (Dynamic). That's the foundation milestone.

---

**End of Brief 28L.**
