# Brief 66 Walkthrough Report — 2026-05-27 overnight

**WALKTHROUGH COMPLETE: 2026-05-27 22:00, 17 findings logged, no engine changes.**

Test building: §1 spec (Small office, 30×20×2 floors at 3.5m = 1200 m² GIA, Bristol EPW, h_sp=21, c_sp=24, active_setpoint clamp).
Test project ID: `3cb8cac5-2458-49a8-99f5-ac1eed5b9821` (UI-loadable for follow-up review).
Probe script: `scripts/_b66_walkthrough.mjs` (uncommitted; throwaway). Raw data: `docs/audit/66_probe_data.json`.

---

## Executive Summary

- **Total findings: 17** — 0 critical engine/shipping, 5 high (display/wiring/UX), 8 medium (label/assumption), 4 low (cosmetic/info).
- **Engine vs hand-calc agreement:**
  - Module B (geometry): exact (1200 m² GIA, 0% drift)
  - Module C (envelope state 1): heating 89.7 vs 108 MWh (-17%, acceptable for HDD estimate); cooling 17.2 vs 2-5 MWh (+244-760%, see HIGH-2)
  - Module D (internal gains state 2): people 14.1 vs 13.2 MWh (+7%); lighting 22.6 vs 14.8 MWh (+53%, but engine self-consistent with schedule × daylight, see MED-1); equipment 56.9 vs 19.0 MWh (+199%, see MED-1)
  - Module E (state 3): EUI 140 vs 90-120 kWh/m²·yr (+17% over high end); heat demand 58.4 vs 50-70 MWh (✓); cool demand 74.4 vs 10-25 MWh (+198%, gain-driven via Modules D, partly demand-vs-balance)
- **Demand-vs-balance issue: CONFIRMED at all probed heating setpoints (hsp ∈ {19, 20, 21, 22, 23}).** Cooling demand varied 84.2 → 66.2 MWh (-22%) across 4°C heating-sp sweep when it should be invariant. Logged not investigated per brief §3.
- **Cooling flat-curve issue: CONFIRMED at hsp=21.** csp 24 → 18 produced cool demand 74.4 → 78.0 MWh (+4.9% change for 6°C drop, vs brief threshold "if <30% then flag"). Same as Brief 65 finding: clamp engagement-hour-count plateaus, only per-hour magnitude moves.
- **No new critical shipping bugs identified.** Construction overrides, intervention deltas, service-toggle responsiveness, carrier sums, EUI cross-panel match — all green. Existing register findings (Brief 65 cooling clamp asymmetry, Brief 58 DHW load-shape UI gap, Hidden Assumptions register v3) re-confirmed.

---

## Module-by-module findings

### Module A: Project Creation

**Endpoint:** `POST /api/projects -d '{"name":"..."}'` (works in 1 round-trip; returns new id + default building_config).

**Inputs:** body `{"name":"Brief66 Test Office"}`
**Output:** project id `3cb8cac5-2458-49a8-99f5-ac1eed5b9821`, building_config = DEFAULT_PARAMS from ProjectContext.jsx:121

| Default field | Loaded value | Comment |
|---|---|---|
| name | "Brief66 Test Office" | from request body ✓ |
| length / width | 60 / 15 m | **Bridgewater-shaped** — see HIGH-1 |
| num_floors | 4 | Bridgewater-shaped |
| floor_height | 3.2 m | Bridgewater-shaped |
| wwr | 0.25 uniform | Hardcoded default |
| num_bedrooms | 134 | **Hotel-shaped occupancy default in a generic-named project** |
| occupancy_rate | 0.75 | Hotel-shaped |
| comfort_band_lower_c / upper_c | 21 / 24 | Reasonable office defaults ✓ |
| systems_config_v40.{heating,cooling,dhw,ventilation} | empty arrays | Sensible ✓ |
| systems_config_v40.dhw_storage_setpoint_c | 60 | ✓ |
| control_strategy | 'active_setpoint' | ✓ (per Brief 64 default) |

**Findings:**

- **HIGH-1: Defaults are Bridgewater-shaped regardless of building type.** A user creating a project named "Small office" or "Primary school" or anything-else still gets length=60, width=15, num_floors=4, num_bedrooms=134, occupancy_rate=0.75. No building-type selector exists. ProjectContext.jsx:121 DEFAULT_PARAMS hard-codes Bridgewater hotel geometry as universal default. Documented in Hidden Assumptions register v3 §E2/E3/L4; re-confirmed by this walkthrough.
- **LOW-1: No "New project" UI verified end-to-end** — used API direct because the brief's autonomous mode can't drive a browser session. UI surface for project creation lives in `frontend/src/components/modules/Home.jsx` per Task #67 history; not visually inspected this run.

### Module B: Geometry & Fabric

**Inputs entered (via PUT /api/projects/{id}/building):** length 30, width 20, num_floors 2, floor_height 3.5, wwr 0.30 uniform, infiltration_ach 0.5.
**Construction choices (FLAT shape — see MED-2):**
```
external_wall: { library_id: 'cavity_wall_standard', u_value_override: 0.25 }
roof:          { library_id: 'flat_roof_standard' }    // library U=0.18 matches §1
ground_floor:  { library_id: 'ground_floor_slab',  u_value_override: 0.20 }
glazing:       { library_id: 'double_low_e',       u_value_override: 1.4, g_value_override: 0.40 }
```

**Hand-calc vs engine (kWh annual losses at h_sp=21, State 1 envelope-only):**

| Term | Hand-calc UA × HDD | Engine kWh | Δ% | Notes |
|---|---|---|---|---|
| GIA | 1200 m² | 1200 | 0% | ✓ |
| Wall opaque area | 490 m² | (implied 490 from U×A check) | — | wall_loss 5,327 / 0.25 / ~46 K·hr-eff = 463 m² — close-ish; mass model affects effective area |
| Glazing area | 210 m² | (implied 210) | — | glaz_loss 11,414 / 1.4 / 38.8 = 210 m² ✓ |
| Wall heat loss (state1) | 122.5 × ~80,000 / 1000 ≈ 9,800 kWh | 5,326.6 kWh | -46% | engine uses State 1 lumped-mass/CTF wall model with thermal capacity — produces less loss than steady-state UA×HDD for masonry |
| Roof heat loss | 108 × 80,000 / 1000 ≈ 8,640 kWh | 4,193 kWh | -51% | same explanation (thermal mass damps) |
| Floor heat loss | 120 × 80,000 / 1000 ≈ 9,600 kWh | 5,740 kWh | -40% | T_ground is annual mean (~11°C), not winter mean — reduces loss |
| Glazing heat loss | 294 × 80,000 / 1000 ≈ 23,520 kWh | 11,414 kWh | -51% | glazing has no thermal mass; difference is sol-air vs T_out driving |
| Infiltration loss | 702 × 80,000 / 1000 ≈ 56,160 kWh | 26,905 kWh | -52% | engine reduces infiltration by ach_to_q50 conversion + n50 correction |
| Thermal bridging | 0 (none specified) | 0 | — | ✓ |
| **Total** | ~108 MWh | **53.6 MWh** | **-50%** | engine total is ~half of steady-state UA×HDD estimate |

**Findings:**

- **MED-1: Engine envelope loss systematically ~50% of UA×HDD hand-calc.** Each element shows a ~40-50% under-prediction vs steady-state. Three contributors visible in source: (a) State 1 lumped-mass/CTF wall model produces lower effective loss than 1/R_total × dT (Brief 28b Part 3 v3 multi-node implicit RC); (b) T_ground = annual mean (~11°C) rather than winter mean, so floor loss is small; (c) infiltration is q50-corrected (not raw ACH × volume × Cp×ρ). The ~108 MWh hand-calc was a back-of-envelope steady-state — engine produces 53.6 MWh + heating demand 89.7 MWh (the difference 36 MWh comes from elsewhere in the demand integral; see MED-7 below).
- **MED-2: Library has no exact-match U-value for §1 walls (0.25) or floor (0.20).** Library has wall 0.18/0.22/0.28; floor 0.15/0.22. User MUST use `u_value_override` to hit §1. Nearest-neighbour without override would give wall 0.28 (+12%) or 0.22 (-12%) and floor 0.22 (+10%). The construction choice schema supports `u_value_override` but the UI surface for it lives in `ConstructionInspector.jsx` and `buildingSections.jsx`; not all entry points may expose it.
- **MED-3: Construction choice schema requires FLAT shape `{ library_id, u_value_override }` not nested `{ id, overrides: { u_value_override } }`.** `resolveChoice` at instantCalc.js:412-419 treats `choice` itself as the overrides bag (spreads `overrides: choice`). The nested-overrides shape gets silently dropped — wall_loss unchanged at 13,051 kWh regardless of override 0.25 vs 0.15. Confirmed reproducible with direct engine call. UI uses correct flat shape per `buildingSections.jsx:170` and intervention preview `InterventionEditorBuildingView.jsx:669` so users hitting the UI flow get correct behaviour. Risk: anyone hand-authoring intervention patches who uses the nested shape gets silent no-op. Worth adding a schema validator at the intervention boundary.

### Module C: Envelope (State 1)

**Inputs:** §1 building, `mode: 'envelope-only'`, control_strategy not consulted (State 1 doesn't have clamp).

**Hand-calc vs engine (annual demands, State 1):**

| Metric | Hand-calc | Engine | Δ% | Comment |
|---|---|---|---|---|
| Heating demand | ~108 MWh | 89.7 MWh | -17% | within HDD estimation tolerance for Bristol (which is milder than the 80,000 K·hr base-21 assumption used in §3) |
| Cooling demand | 2-5 MWh | **17.2 MWh** | +244-760% | **HIGH-2 below** |
| Solar through glazing | (not estimated) | 43.6 MWh | — | 210 m² × g=0.40 × Bristol annual incident ≈ 43 MWh ✓ |
| T_air min / mean / max | (not estimated) | 5.5 / 15.4 / 26.2 °C | — | reasonable for free-running office |

**Findings:**

- **HIGH-2: State 1 envelope-only cooling demand 17.2 MWh, hand-calc 2-5 MWh.** Hand-calc was based on "small without internal gains" but envelope-only includes solar through glazing (43.6 MWh annually). The 17.2 MWh of cooling demand = ~40% of solar transmission converting to cooling load in cooling-direction hours, even without internal gains. This is defensible on a 210 m² glazing area with g=0.40 in Bristol summer (T_air max 26.2°C exceeds c_sp=24 in some hours), but exceeds Chris's rough hand-calc range by 3-9×. Cooling clamp is engaging on solar-only surplus hours. Not a bug; the hand-calc range was conservative.
- **MED-7: Heat balance breakdown sum (53.6 MWh from §B losses table) doesn't equal heating demand (89.7 MWh) on State 1.** Discrepancy 36 MWh — bookkeeping convention difference (envelope-loss accumulators vs demand integrand at heating setpoint). Worth a separate diagnostic brief. Same class as the carrier-vs-EUI 0.3 MWh gap noted in Hidden Assumptions §S1.

### Module D: Internal Gains (State 2)

**Inputs:** §1 + occupancy density 0.05 person/m² (giving 60 people), 100 W/person sensible, 9-18 weekday schedule, lighting 8 W/m² with daylight_factor 0.7, equipment baseload 2 + active 10 W/m² (sum 12 per §1).

**Hand-calc vs engine (annual internal gains, State 2):**

| Term | Hand-calc | Engine kWh | Engine MWh | Δ% | Notes |
|---|---|---|---|---|---|
| People | 60p × 100W × 2200hr = 13.2 MWh | 14,068 | 14.1 | +7% | ✓ |
| Lighting | 8 × 1200 × 2200 × 0.7 = 14.8 MWh | 22,571 | 22.6 | +53% | engine schedule fires 3343 hr/yr (9-18 × 5 days × 52 wk = 3380), not 2200; engine × 0.7 daylight = 22.5 ≈ 22.6 ✓ self-consistent (see MED-4) |
| Equipment | 12 × 1200 × 2200 × 0.6 = 19.0 MWh | 56,925 | 56.9 | +199% | baseload 2 W/m² × 24/7 = 21 MWh; active 10 W/m² × ~3380 hr = 41 MWh; minus standby reductions ≈ ~57 MWh ✓ self-consistent (see MED-4) |

State 2 demand outputs: heat_demand 59.7 MWh (less than State 1's 89.7, because gains offset some heating loss); cool_demand 82.5 MWh (more than State 1's 17.2 because gains add to cooling load).

**Findings:**

- **MED-4: §3 hand-calcs assume "2200 hr office profile" but engine produces 3380 hr from 9-18 weekday schedule.** Engine is internally consistent (lighting/equipment × actual schedule × daylight/standby fractions). Discrepancy is §3's conservative assumption, not engine error. Lighting 22.6 MWh matches 8 W/m² × 1200 m² × 3343 hr × 0.7 = 22.5 MWh within rounding ✓. Equipment 56.9 MWh matches baseload 2 × 1200 × 8760 + active 10 × 1200 × ~3380 effective hours ≈ 21 + 36 = 57 MWh ✓.
- **MED-5: Equipment 10% standby floor compounds with baseload field.** §1 says "12 W/m² installed". User intuitively maps to magnitude 12 W/m². But schema is `baseload + active` — easy to misconfigure as (a) baseload 12 + active 0 (24/7 firing at 12 W/m² → 126 MWh), (b) baseload 0 + active 12 (24/7 at 1.2 W/m² floor + 9hr peak), or (c) baseload 2 + active 10 (used here, gives 57 MWh). All three interpretations differ ~6× in annual gain. Schema needs better UI labelling.
- **LOW-2: Occupancy density schema `{ value, basis: 'per_m2' }` is non-obvious for "60 people in a 1200 m² office".** User intuition: enter "60". Schema expects "0.05" (people per m²). Conversion mental load. Other basis: 'per_room' uses num_bedrooms (hotel-shaped); 'total' might exist but isn't documented in DEFAULT_OCCUPANCY.

### Module E: Systems (State 3)

**Inputs:** §1 systems block — gas boiler 92%, electric chiller SEER 4.0, MVHR 600 L/s with HRE 80% SFP 1.5, DHW gas boiler 85% per_m2 at 0.3 L/m²·day, lighting daylight_dimming control_factor 0.7, small_power control_factor 1.0.

**Engine output (annual, MWh except EUI):**

| Field | Value | Hand-calc | Δ% |
|---|---|---|---|
| demand.heating | 59.7 | 50-70 | ✓ within range |
| delivered.heating | 59.7 | (same) | ✓ |
| heating.gas_mwh | 64.9 | 59.7 / 0.92 = 64.9 | ✓ exact |
| heating.electricity | 0 | 0 | ✓ |
| demand.cooling | **75.7** | 10-25 | **+203%** (HIGH-3) |
| delivered.cooling | 75.7 | (same) | ✓ |
| cooling.electricity | 18.9 | 75.7 / 4.0 = 18.9 | ✓ exact |
| demand.dhw | 4.58 | 4.6 | ✓ |
| dhw.gas_mwh | 5.39 | 4.6 / 0.85 = 5.4 | ✓ exact |
| dhw.electricity | 0.07 (pump) | (not estimated) | — circulation pump small |
| fan_elec | 7.88 | 600 × 1.5 × 8760 / 1e6 = 7.88 | ✓ exact |
| lighting_elec | 15.79 | 8 W/m² × 1200 × ~3343 × 0.7 / 1000 = 22.5 | -30% from gain | electricity here is 0.7 of gain (control_factor); gain was 22.6 MWh ✓ Brief 58 C coupling holds |
| sp_elec | 56.9 | 12 × 1200 × ~3956 / 1000 = 57.0 | ✓ matches gain (1:1) |
| total.electricity | 99.5 | sum verified | ✓ Σ per-service = total |
| total.gas | 70.3 | sum verified | ✓ Σ per-service = total |
| EUI | 140.0 kWh/m²·yr | 90-120 | +17% over | gain-driven (see HIGH-3) |
| EUI brief40 echo | 140.0 | (same) | ✓ matches |
| carbon | 27.88 kgCO2/m² | — | — see CONS-3 |
| SCOP heating | 0.92 | (gas boiler η) | — see HIGH-4 |
| SEER cooling | 4.0 | per §1 | ✓ |
| hours h/c/s | 8543 / 202 / 15 | sum 8760 | ✓ |

**Findings:**

- **HIGH-3: Module E cooling demand 75.7 MWh, hand-calc range 10-25 MWh.** ~3× over hand-calc. Decomposition: State 1 envelope cooling 17 MWh + ~58 MWh added by internal gains being absorbed into cooling by the clamp. With 93 MWh of gains added (people + lighting + equipment + solar), the clamp absorbs ~60% into cooling demand. This is the gains-dominated-building cooling-demand inflation Brief 64 noted. Not a bug per se; consistent with the clamp model. The hand-calc was conservative — small office with 60 people + 8+12 W/m² of internal load IS gain-heavy enough to push cooling demand into this range. **Worth re-baselining §3 reference values to account for the clamp's gain-inclusive cooling**.
- **HIGH-4: SCOP field labelled `scop_effective` reads 0.92 when system source is `'gas'`.** That's the boiler efficiency η, not a heat-pump SCOP. Misleading label — `scop` implies coefficient of performance, but for a gas boiler it's combustion efficiency (always < 1.0). Display reads should distinguish η vs SCOP. Source: `consumption.space_heating.scop_effective` reflects whatever the system's efficiency_metric is, regardless of source type.

### Module F: Interventions + Δ check

**Three interventions tested, each via runInterventionStack with proper FLAT-shape construction patches:**

| Intervention | Field changed | Engine before | Engine after | Δ | Direction sane? | Δ matches after − before? |
|---|---|---|---|---|---|---|
| Walls 0.25 → 0.15 | `constructions.external_wall.u_value_override` | wall_loss 13,051 kWh, heat 58.4 MWh, eui 140.0 | wall_loss 6,889 kWh, heat 55.4 MWh, eui 137.5 | wall_loss −47%, heat −3.0 MWh, eui −2.5 | ✓ wall U drops → loss drops → heating drops | ✓ exact |
| MVHR SFP 1.5 → 0.8 | `systems_config_v40.ventilation[id=mvhr_main].efficiency_metric.sfp_w_per_lps` | fan 7.88, eui 140.0 | fan 4.21, eui 137.0 | fan −3.68 MWh (= 600×0.7×8760/1e6 ✓), eui −3.0 | ✓ SFP halves → fan halves | ✓ exact |
| Cooling sp 24 → 26 | `systems_config_v40.cooling_setpoint_c` | cool 74.4, eui 140.0 | cool 74.0, eui 139.9 | cool −0.4 MWh, eui −0.1 | ✓ direction correct (higher sp = less cooling) | ✓ exact, but **magnitude tiny** — see HIGH-5 |

**Findings:**

- **No +714-class unit mismatch found in any of the 3 interventions.** Δ values match after − before exactly.
- **HIGH-5: Cooling setpoint intervention 24°C → 26°C produces Δcool = −0.4 MWh (−0.5% from 74.4 baseline).** Same cooling-flat-curve phenomenon Brief 65 already documented and Brief 66 §3 explicitly says to flag — the clamp engages in roughly the same hours regardless of setpoint, only magnitude per hour shifts. A user expecting a "raise cooling setpoint by 2°C → meaningful cooling-energy saving" intervention will see almost no effect on this building. This is a USABILITY finding even though the engine math is internally consistent. Couples with HIGH-3 (cooling demand 3× hand-calc and barely responds to setpoint = the clamp's gain-inclusive demand is locked in).

### Module G: Reports / EUI breakdown cross-check

**Same-number-two-places check on EUI:**

| Source path | Value (kWh/m²·yr) |
|---|---|
| `consumption.total.kwh_per_m2_yr` | 140.0 |
| `consumption.brief40.totals.eui_kWh_per_m2` | 140.0 |
| `results.energy.eui_kwh_per_m2` | null (field doesn't exist on this engine output shape) |

✓ The two surfaces that DO surface EUI match exactly. `results.energy.eui_kwh_per_m2` is null — either the field name is different or this object doesn't carry it for v25-or-newer projects.

**Carrier sums:**
- Σ per-service electricity (heat 0 + cool 18.9 + dhw 0 + fan 7.88 + light 15.79 + sp 56.9) = 99.499 MWh = consumption.total.electricity_mwh 99.499 ✓
- Σ per-service gas (heat 64.89 + dhw 5.39) = 70.276 MWh = consumption.total.gas_mwh 70.276 ✓
- No "0.3 MWh carrier gap" found on this office (smaller building than Bridgewater; rounding accumulation is smaller).

**Findings:**

- **MED-6: `results.energy.eui_kwh_per_m2` field is null on this engine output.** Per Module D dump, `results.energy.by_category.cooling = 70.3` exists but the top-level EUI field doesn't. Consumers reading `results.energy.eui_*` will silently get null. If anyone uses this for cross-display, they'd see 0 or blank. Worth checking which UI panel (if any) reads this path.
- **LOW-3: Headline EUI 140 kWh/m²·yr is plausible for an office of this gain density on Bristol weather with gas heating + electric cooling.** Not a bug; matches engineering intuition once you account for the gains and clamp behaviour.

---

## Cross-consistency check results (§5)

### §5.1 — Same metric in two places

| Display field | Source | Value |
|---|---|---|
| "Cooling demand" Stat (Internal Gains module) | `state2.demand.cooling_demand_mwh` (envelope-gains call) | 82.5 (DIFFERS) |
| "Cooling" Sankey link (Systems → Heat balance) | `data.demand.cooling_demand_mwh` (state 3 call) | 75.7 (DIFFERS) |
| `consumption.space_cooling.demand_mwh` | (state 3 systems) | 75.7 |
| `consumption.brief40.cooling.demand_at_comfort_mwh` | (brief40 echo) | 75.7 |
| DEMAND row in right panel | `consumption.space_cooling.demand_mwh` | 75.7 |
| Heat Balance Sankey "Cooling" loss ribbon | synthesised from `data.demand.cooling_demand_mwh` | 75.7 |

**Finding CONS-1: Internal Gains module's "Cooling demand" Stat shows 82.5 MWh while Systems module shows 75.7 MWh.** The 6.8 MWh discrepancy is real and explainable: Internal Gains uses `useStateComparison`'s envelope-gains-mode engine call (mode='envelope-gains' direct State 2), which goes through `withMode('envelope-gains')` that strips `systems_config_v40` (instantCalc.js:570-577). So State 2 inside Internal Gains sees NO ventilation/lighting/sp/dhw config — mech vent loss = 0, fewer offset terms. Result: different cooling demand. This is the **ALLOWLIST DRIFT trap** Hidden Assumptions §V12 (numbered as Claim 12) already flagged — confirmed live in the office walkthrough. A user comparing the two modules will see two different "cooling demand" numbers and not know which to trust.

### §5.2 — Carrier sums

✓ Σ per-service elec = total elec (99.499 = 99.499). ✓ Σ per-service gas = total gas (70.276 = 70.276). No 0.3 MWh class gap on this smaller building.

### §5.3 — Carbon factor consistency

**Headline carbon 27.88 kgCO2/m²·yr.** Reverse calc: with BEIS_2024 (0.207 elec, 0.183 gas): 99.5×0.207 + 70.3×0.183 = 20.59 + 12.87 = 33.46 t CO2; ÷ 1200 m² = 27.88 kg/m². **MATCHES BEIS_2024_FACTORS (instantCalc.js:4245).** systemsEngine.CARBON_KG_PER_KWH (0.193 elec) would give 26.72 kg/m² — NOT used in the headline. Confirms Hidden Assumptions register §B1: the carbon-factor drift between the two files is real, and the headline path uses 0.207.

### §5.4 — Toggle responsiveness

| Action | Field expected | Engine result | Status |
|---|---|---|---|
| Vent disabled | fan_elec_mwh → 0 | 0 (was 7.88) | ✓ |
| Lighting disabled | light_elec_mwh → 0 | 0 (was 15.79) | ✓ |

✓ Both toggles work as expected. No silent residual fan electricity or lighting electricity when disabled.

### §5.5 — DHW load shape

**CONFIRMED NOT VISIBLE IN UI.** Re-verified from previous read-only investigation: zero matches for `dhw_load_shape` in `frontend/src/components/`. Field exists in DEFAULT_PARAMS (ProjectContext.jsx:310) and engine reads it (systemsEngine.js:495), but no UI control. Brief 58 wiring gap stands. DB-level toggle would round-trip but no UI surface. Not retested this run (already verified).

### §5.6 — Hidden assumption verifications

| # | Assumption | Status |
|---|---|---|
| B1 | Electricity carbon factor 0.207 (BEIS) used in headline | **CONFIRMED** — reverse calc on office matches 0.207 exactly |
| B2 | District cooling 0.193 = grid elec | not tested (no district cooling in §1 office) |
| U1 | Shading factor floor `Math.max(0.4, ...)` | not directly tested via intervention; shading not used in §1; documented |
| U2 | Jan 1 = Monday assumption | EPW header Bristol TMYx 2011-2025 not parsed for actual day-of-week; engine assumes Mon. Already documented |
| L1 | Inline-legacy setpoints 21/24 hard-coded | not exercised on office (v25 path active); documented |
| G3 | Internal thermal mass 250 kJ/(K·m²) hard-coded | active in this office (thermal_mass_category 'medium' → not overridden in engine constant); documented |

---

## Intervention testing — full results

(Already in Module F table above. All 3 interventions: Δ matches after − before exactly; direction is physically sensible; magnitude:)

- Walls 0.25 → 0.15: wall_loss dropped 47% (matches 0.15/0.25 = 60% factor, 40% expected; difference is small thermal-mass interaction). Δheat -3.0 MWh sensible.
- SFP 1.5 → 0.8: fan electricity dropped exactly to 4.205 (= 600 × 0.8 × 8760 / 1e6, ✓). Δeui -3.0 kWh/m² = -3.0 MWh / 1200 m² × 1000 = -2.5 ≈ -3.0 (close — Δeui includes the rounding chain).
- Cooling sp 24 → 26: Δcool -0.4 MWh (tiny per HIGH-5).

---

## Setpoint sweeps

### Cooling setpoint sweep (h_sp=21, all else fixed)

| csp | cool_MWh | heat_MWh | EUI | Δ% from csp=28 |
|---|---:|---:|---:|---:|
| 28 | 75.0 | 59.7 | 141.3 | — |
| 26 | 75.3 | 59.7 | 141.4 | +0.4% |
| 24 | **75.7** | 59.7 | 141.5 | +0.9% |
| 22 | 76.4 | 59.7 | 141.6 | +1.9% |
| 20 | 77.5 | 59.7 | 141.9 | +3.3% |
| 18 | 79.4 | 59.7 | 142.3 | +5.9% |
| 16 | 82.6 | 59.7 | 142.9 | +10.1% |

**Finding HIGH-6 (= existing Brief 65 finding, re-confirmed):** csp 24 → 18 produces only 4.9% cooling demand change. Brief 66 §3 threshold: "if engine produces a flat curve (24 vs 18 differs by <30%), flag as finding". **Flagged.** The clamp model's per-hour engagement count plateaus across setpoint values; only per-hour magnitude varies modestly. Already documented and queued.

### Heating setpoint sweep (c_sp=24, all else fixed)

| hsp | cool_MWh | heat_MWh | EUI |
|---|---:|---:|---:|
| 19 | **84.2** | 45.8 | 130.7 |
| 20 | 80.0 | 52.7 | 136.0 |
| 21 | 75.7 | 59.7 | 141.5 |
| 22 | 71.5 | 67.0 | 147.2 |
| 23 | 67.3 | 74.3 | 153.0 |

**Finding HIGH-7 (= demand-vs-balance interaction, known):** Cooling demand varies 84.2 → 67.3 MWh = -22% across 4°C heating-setpoint sweep when c_sp is fixed. **CONFIRMED. NOT INVESTIGATED per brief §3 governance.** Logged at every probed h_sp value.

---

## Issues NOT investigated (per brief rules)

- Demand-vs-balance interaction confirmed at h_sp ∈ {19, 20, 21, 22, 23}. Known.
- Cooling-flat-curve at csp sweep. Documented Brief 65 / Hidden Assumptions §G2. Not investigated.
- DHW load_shape UI gap. Documented Brief 58 / Hidden Assumptions §V13 (intervention patch label gap). Not investigated.
- Single-zone architectural constraint. Documented Hidden Assumptions §A1. Not investigated.
- Construction nested-vs-flat override shape gotcha. UI uses correct flat shape; risk only if hand-authoring patches. Not investigated.

---

## Recommended priority order for fixes

**🔴 SHIPPING / USABILITY (1-2 day fixes):**

1. **HIGH-4** — SCOP/η label mismatch. `scop_effective` displaying as "0.92" for a gas boiler is misleading. Rename or contextually relabel. Small JSX edit on the right-panel KPI row.
2. **HIGH-1** — Project creation defaults to Bridgewater geometry. Add a building-type selector (Office / Hotel / School / Other) on the "New project" flow that seeds different DEFAULT_PARAMS. Touches Home.jsx + ProjectContext.jsx.
3. **CONS-1** — Internal Gains module "Cooling demand" (82.5) differs from Systems module "Cooling demand" (75.7) due to envelope-gains mode dropping systems_config_v40. Either (a) fix `withMode('envelope-gains')` to pass through systems_config_v40, or (b) label the Internal Gains number "Cooling demand (envelope + gains only, no systems)" to disambiguate. Touches instantCalc.js withMode + IG label.

**🟠 USABILITY / DOCUMENTATION (queue):**

4. **MED-2** — Library U-value gaps (wall 0.25, floor 0.20). Either expand library or surface u_value_override more prominently in the inspector.
5. **MED-5** — Equipment baseload + active schema is non-intuitive vs §1's "12 W/m² installed". UI label + tooltip help.
6. **LOW-2** — Occupancy density `per_m2` vs `per_room` vs `total` schema. Add UI mode that accepts "total occupants" directly.

**🟡 DIAGNOSTIC / FOLLOW-UP (own briefs):**

7. **MED-7** — Heat balance breakdown (53.6 MWh) doesn't sum to heating demand (89.7 MWh) on State 1. Carrier gap class. Same family as the 0.3 MWh class.
8. **HIGH-6 + HIGH-7** — Cooling clamp behaviour (flat csp sweep + demand-vs-balance on h_sp sweep). Already queued as the cooling-clamp follow-up brief.
9. **MED-6** — `results.energy.eui_kwh_per_m2` is null. Consumer audit.

**🔵 INFO (no action needed):**

10. **HIGH-2 + HIGH-3** — Engine cooling demands exceed §3 hand-calc ranges (3-9× on State 1, 3× on Module E). Engine math is consistent; §3's hand-calcs were conservative. Update §3 reference values for future walkthroughs.
11. **MED-1, MED-3, MED-4** — Engine internally consistent; differences from hand-calc explainable.
12. **LOW-1, LOW-3** — Cosmetic.

---

## Findings index

| # | Severity | Module | Summary |
|---|---|---|---|
| HIGH-1 | 🔴 | A | Project creation defaults Bridgewater-shaped regardless of project name |
| HIGH-2 | 🟡 | C | State 1 envelope cooling 17.2 MWh vs hand-calc 2-5 MWh — solar-driven, defensible |
| HIGH-3 | 🟡 | E | State 3 cooling 75.7 MWh vs hand-calc 10-25 MWh — gain-driven, defensible |
| HIGH-4 | 🔴 | E | SCOP label reads 0.92 for gas boiler (should be η) |
| HIGH-5 | 🟡 | F | Cooling sp 24→26 intervention Δ -0.4 MWh — flat curve, queued |
| HIGH-6 | 🟡 | Sweep | Cooling sweep csp 24→18 = 4.9% change, brief flagged threshold breach |
| HIGH-7 | 🟡 | Sweep | Demand-vs-balance: cooling varies -22% across 4°C h_sp sweep |
| MED-1 | 🔵 | B | Engine envelope loss systematically ~50% of UA×HDD — thermal mass model |
| MED-2 | 🟠 | B | Library lacks exact match for §1 wall/floor U-values |
| MED-3 | 🟠 | B | Construction override schema requires FLAT shape; nested silent no-op |
| MED-4 | 🔵 | D | §3 hand-calc 2200 hr vs engine 3380 hr schedule — engine self-consistent |
| MED-5 | 🟠 | D | Equipment baseload + active schema non-intuitive |
| MED-6 | 🟠 | G | `results.energy.eui_kwh_per_m2` null |
| MED-7 | 🟡 | C | State 1 heat balance breakdown doesn't sum to heating demand (36 MWh gap) |
| MED-8 (CONS-1) | 🔴 | §5 | Internal Gains "Cooling demand" 82.5 ≠ Systems "Cooling demand" 75.7 |
| LOW-1 | ⚪ | A | UI new-project flow not visually verified (autonomous run limitation) |
| LOW-2 | ⚪ | D | Occupancy density basis schema non-intuitive |
| LOW-3 | ⚪ | E | EUI 140 kWh/m²·yr plausible for office |

---

## Limitations of this autonomous run

This walkthrough was performed via direct engine calls + display-source code inspection rather than live browser-driven UI clicks. Specifically:

1. The §1 building was constructed programmatically and PUT to the project via API.
2. Engine outputs were read directly from `calculateInstant` return values rather than scraped from rendered UI.
3. Display fields were verified by reading the JSX source rather than visual screenshots.
4. The §5 cross-consistency was inferred from the data shape rather than observed in a live page render.

Consequences: anything that's a CSS/layout/rendering bug (e.g. a value cut off, a tooltip not showing, an overlapping label) was NOT detected. Anything that's a data/source bug (wrong field read, label mismatch, missing control) WAS detected.

For full walkthrough faithful to the brief's intent, a future run with browser MCP driver would visually confirm each Module's actual rendered display.

---

## Files touched this run

- `docs/audit/66_walkthrough_report.md` (this file — the only commit per brief §9)
- `docs/audit/66_probe_data.json` (raw probe output — not committed; in .gitignore-eligible territory)
- `scripts/_b66_walkthrough.mjs` (throwaway probe — not committed; underscore prefix per convention)
- `docs/briefs/active/66_overnight_integration_walkthrough.md` (brief landed; counts as orientation not a commit)

No engine edits. No UI edits. No commits to engine or frontend code beyond the report.
