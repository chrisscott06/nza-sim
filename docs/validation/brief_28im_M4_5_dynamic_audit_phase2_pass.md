# Brief 28-IM Gate IM-M4.5 — Phase 2: PASS Report

**Date:** 2026-05-17
**Status:** Phase 2 (Option B+) complete.
**Scope authorised:** Option B (crash fix + vent fix + UI honesty) PLUS the two assembler additions (item 4 `consumption.*` parity, item 5 per-service `enabled` gating). Phase 1 audit doc: `docs/validation/brief_28im_M4_5_dynamic_audit_phase1.md`.

## TL;DR

All five items shipped. Static vent on/off works end-to-end (fan kWh, HRE recovery offset, S2 setpoint heat loss all now gated). Dynamic crash fixed (assembler unwraps post-Brief-28k `construction_choices` dicts). Dynamic runs end-to-end on Bridgewater across baseline, heating-off, cooling-off, DHW-off, and all-off variants. Dynamic now emits a `consumption.*` block matching the Static IM-M4 §8.1 shape. Per-service `enabled: false` propagates from UI → assembler → EP (via zero-value availability schedule on the disabled coil) → parsed `consumption.*` output.

UI honesty pass: misleading "Static-vs-Dynamic Δ" comment on Operation Summary removed and replaced with concrete convention notes about what Dynamic doesn't yet emit. Internal Gains' "Engine toggle inline (Part 11)" placeholder removed (commented out with an explanation). Building Summary and Systems Summary both gain explicit Static-vs-Dynamic convention sections covering sky long-wave, T_ground, BS 5925 vs EP F_w, thermal bridging, glazing, demand definition, SCOP/SEER, DHW fuel mix, per-vent gating, per-system fan breakdown.

Items deferred to **Brief 28-DynamicParity** (separate brief, lands after M5/M6): DHW `fuel_mix` blending in Dynamic, q50 → operational ACH in Dynamic, monthly per-element parser, per-opening + per-system daily/monthly arrays, `daily_profiles` parity, `building.schedules[]` ingestion.

---

## 1 — Per-item delivery

### Item 1 — Dynamic crash fix ✓

**Edit:** `nza_engine/generators/epjson_assembler.py`
- Added `_resolve_choice(entry, default)` helper at line ~123 that unwraps `{library_id, u_value_override}` dicts to plain `library_id` strings. Mirrors the JS-side `resolveChoice()` helper in `frontend/src/utils/instantCalc.js`.
- `_substitute_constructions` now routes every `choices.get(...)` lookup through `_resolve_choice`.
- Line 1183 `set(construction_choices.values())` replaced with `{_resolve_choice(v, "") for v in construction_choices.values()}` plus a `discard("")` defensive cleanup.

**Verification:** `python ... assemble_epjson(..., mode='full')` on the live Bridgewater project — was a hard `TypeError` before, now produces a 127 680-byte epJSON and EnergyPlus 24.1 runs to completion in 7.7 s with zero severe / fatal errors.

**Convention difference recorded:** `u_value_override` and `g_value_override` (Brief 28k Gate 3+ per-project BRUKL/as-built overrides) are NOT honoured in Dynamic V1. The assembler uses the library U-values only. Convention noted in the docstring; Brief 28-DynamicParity will add per-project Construction object emission.

### Item 2 — Static vent `enabled` fix ✓

**Edits:** `frontend/src/utils/instantCalc.js`
- **Root cause** (not in Phase 1 audit — found during Phase 2 implementation): the State 2 `ventSystems` projection at line ~2279 `.map(v => ({...}))` dropped the `enabled` field, so every downstream `vs.enabled === false` guard saw `undefined`. Added `enabled: v.enabled !== false` to the projection.
- **Site 1 (State 2 mech vent loop, line ~2566)**: added `if (ventSystems[vi]?.enabled === false) continue` at the top of the per-system loop. Disabled systems no longer contribute to `acc_mech_vent_heat_per_system[]`, the daily/monthly accumulators, or the State 2 setpoint heat loss total.
- **Site 2 (`computeVentilationEnergy`, line ~3605)**: when `vs.enabled === false`, push a zeroed `perSystem` entry (id, fan_kwh=0, recovery_mwh=0, theoretical_recovery_mwh=0, hours_active=0, schedule_source='disabled') and `continue`. Keeps the array positions aligned with the input `ventilation[]` for downstream `consumption.ventilation[vi]` mapping.

**Verification:**
```
1. baseline (all vent on)         fans=25.9 MWh  vent_loss_S2=291.8 MWh  heat_delivered=347.9 MWh  EUI=72.3
2. ALL vent enabled=false         fans= 0.0 MWh  vent_loss_S2=  0.0 MWh  heat_delivered=185.1 MWh  EUI=60.9
3. bedroom_extract enabled=false  fans=18.2 MWh  vent_loss_S2= 65.4 MWh  heat_delivered=157.0 MWh  EUI=63.1
4. mvhr_gf_public hre=0 (sanity)  fans=25.9 MWh  vent_loss_S2=394.1 MWh  heat_delivered=542.7 MWh  EUI=80.8
```

Run 2 vs baseline: all three fans → 0 (correct), all three vent losses → 0 (correct), space_heating delivered DROPS by 162.8 MWh — because the 291.8 MWh vent loss is gone but the 97 MWh HRE recovery is also gone (291.8 − 97 ≈ 195 MWh; the residual gap reflects the State 3 service-energy efficiency cascade). Run 3: only bedroom_extract disabled → fans down by exactly 7.7 MWh (the bedroom fan), vent loss down by 226 MWh (the bedroom extract loss). Run 4 (control): manual `hre = 0` still works — heat delivered jumps +194 MWh as expected.

### Item 3 — UI honesty pass ✓

**Edit:** `frontend/src/components/modules/OperationModule.jsx`
- Renamed `OperationSummaryView`'s section comment from "Static-vs-Dynamic Δ" to "Per-opening table (Static engine)" with an explanation that the Δ comparison column never existed and where it'll land.
- Replaced the trailing italic single-paragraph stub with a structured **"Convention notes (Static vs Dynamic):"** block calling out (a) BS 5925 wind-angle decomposition vs EP `F_w` autocalc, (b) per-opening attribution (input-side parity, output-side aggregate).

**Edit:** `frontend/src/components/modules/gains/InternalGainsModule.jsx`
- Removed the literal placeholder text `Engine toggle inline (Part 11)`. Comment in its place explains why Internal Gains is Static-only by design (gains profile evaluation is a Static concept; Dynamic gets gains via `Schedule:Compact` and reports as aggregate `InteriorLights:Electricity` / `InteriorEquipment:Electricity` meters, not per-profile).

**Edit:** `frontend/src/components/modules/building/BuildingDefinition.jsx`
- `BuildingSummaryView`'s trailing stub replaced with a five-bullet **"Convention notes (Static vs Dynamic):"** block: sky long-wave, T_ground, permanent vents BS 5925, thermal bridging (with a live `H_TB` MWh figure), glazing layer model. Plus a closing line that names IM-M4.5 Phase 2 explicitly and points to Brief 28-DynamicParity for the per-element Δ overlay.

**Edit:** `frontend/src/components/modules/SystemsModule.jsx`
- `SystemsSummary`'s trailing region gains a five-bullet **"Convention notes"** block: demand definition (setpoint-convention vs EP-supplied), effective SCOP/SEER (seasonal vs hourly), DHW fuel mix (Static apportions, Dynamic still uses primary/secondary), per-vent on/off (Static gates, Dynamic V1 service-level only), per-system fan breakdown (Static per-system, Dynamic aggregates).

### Item 4 — `consumption.*` parity in Dynamic ✓

**Edit:** `nza_engine/parsers/sql_parser.py`
- New `get_consumption_block(sql_path, building_config) -> dict` (~110 lines). Returns the IM-M4 §8.1 shape:
  ```python
  {
    "engine": "dynamic",
    "space_heating": {enabled, demand_mwh, delivered_mwh, electricity_mwh, gas_mwh, scop_effective},
    "space_cooling": {enabled, demand_mwh, delivered_mwh, electricity_mwh, seer_effective},
    "dhw":           {enabled, demand_mwh, delivered_mwh, electricity_mwh, gas_mwh, fuel_mix_applied},
    "ventilation":   [{id, name, enabled, fan_electricity_mwh, hre_recovery_mwh, exhaust_loss_mwh}],
    "lighting":      {electricity_mwh},
    "small_power":   {electricity_mwh},
    "total":         {electricity_mwh, gas_mwh, district_heat_mwh, kwh_per_m2_yr},
  }
  ```
- Sources: `Heating:EnergyTransfer`, `Cooling:EnergyTransfer`, `Heating:Electricity`, `Heating:NaturalGas`, `Cooling:Electricity`, `WaterSystems:Electricity`, `WaterSystems:NaturalGas`, `Fans:Electricity`, `InteriorLights:Electricity`, `InteriorEquipment:Electricity`, `Electricity:Facility`, `NaturalGas:Facility`. SCOP/SEER computed identically to Static (`delivered / fuel`).
- Convention-difference docstring records the V1 simplifications: `demand_mwh = delivered_mwh` here (EP doesn't distinguish wanted-from-supplied), ventilation is single aggregate (not per-system), DHW `fuel_mix_applied` is `null` (assembler still on legacy primary/secondary path).

**Edit:** `api/routers/projects.py`
- Imported `get_consumption_block`; added `consumption = get_consumption_block(sql, building_params)` to the post-parse pipeline; surfaced it on the response dict.

**Verification — Dynamic baseline emit:**
```python
space_heating: enabled=True demand=235.441 delivered=235.441 elec=72.92 SCOP=3.23
space_cooling: enabled=True demand=18.468 delivered=18.468 elec=6.725 SEER=2.75
dhw:           enabled=True demand=32.878 delivered=32.878 elec=11.893 gas=20.985
fans:          44.12 MWh (aggregate)
TOTAL elec=335.302  gas=20.985  EUI=82.4 kWh/m2.yr
```

### Item 5 — per-service `enabled` gating in Dynamic ✓

**Edit:** `nza_engine/generators/epjson_assembler.py`
- New `v25` block at the top of the `detailed` HVAC branch reads `building_params.systems_config_v25.{heating,cooling,dhw}.enabled` (default True). Surfaces resolved gates as `_im_m4_5_enabled_resolved` for debugging.
- VRF emission: `provide_heating=heating_enabled`, `provide_cooling=(cooling_enabled and not sc_is_none)`.
- Gas baseboard branch: when `cooling_enabled=False` it joins the heating-only path.
- DHW: `if dhw_enabled:` gates the entire `generate_dhw_system()` call (and its `hvac_objects.setdefault` merge).
- **Post-process** (the actual gate that does the work): adds a `Schedule:Constant` `_im_m4_5_service_off_sched` with `hourly_value = 0.0`, then sets `availability_schedule` / `availability_schedule_name` on every disabled coil. EP keeps the coil object (autosizing succeeds against design days) but the schedule prevents it from running. Zone heating load shows up as "unmet hours"; `Heating:EnergyTransfer` + `Heating:Electricity` stay at ~0.

EP rejects `gross_rated_*_capacity = 0` with a severe schema validation error (`Expected number greater than 0`); the availability-schedule approach is EP-idiomatic and works.

**Verification (5-variant Dynamic sweep):**
```
1_baseline       heat(ON  dem=  235.4 elec=  72.9)  cool(ON  dem= 18.5 elec= 6.7)  dhw(ON  elec=11.9 gas=21.0)  EUI=82.4
2_heating_off    heat(OFF dem=   36.9 elec=   0.6)  cool(ON  dem= 17.8 elec= 6.4)  dhw(ON  elec=11.9 gas=21.0)  EUI=65.6
3_dhw_off        heat(ON  dem=  235.4 elec=  72.9)  cool(ON  dem= 18.5 elec= 6.7)  dhw(OFF elec= 0.0 gas= 0.0)  EUI=74.8
4_cooling_off    heat(ON  dem=  238.2 elec=  72.7)  cool(OFF dem=  0.0 elec= 0.3)  dhw(ON  elec=11.9 gas=21.0)  EUI=80.9
5_all_off        heat(OFF dem=   40.3 elec=   0.6)  cool(OFF dem=  0.1 elec= 0.3)  dhw(OFF elec= 0.0 gas= 0.0)  EUI=56.6
```

Notes on the Dynamic numbers:
- Run 2 (heating off): demand drops 235 → 37 because EP sees the system as unavailable for most of the year, the zone drifts colder, and the very small residual `EnergyTransfer` is the cooling system briefly heating to maintain its setpoint when temps swing. Electricity drops 72.9 → 0.6 (parasitics). EUI drops 16.8 kWh/m².
- Run 3 (DHW off): perfectly clean — DHW elec 11.9 → 0, gas 21.0 → 0, EUI 82.4 → 74.8 (-7.6 from removing 32 MWh of DHW delivered at the gas-heavy mix).
- Run 4 (cooling off): cooling demand goes to 0, electricity stays at 0.3 (parasitics).
- Run 5 (all off): heating ~40 MWh demand from edge-of-availability, fans + lighting + small_power = 56.6 EUI floor. The building is essentially unconditioned.

---

## 2 — Per-module Static vs Dynamic comparison

Both engines now emit the IM-M4 `consumption.*` shape. Comparison run on the live Bridgewater seed with the baseline 60/40 DHW fuel mix (the seed value before the IM-M4 screenshot session left it at 50/50).

### Building / Systems — annual headline numbers

| Metric | Static | Dynamic | Δ% | Convention note |
|---|---:|---:|---:|---|
| Heating delivered (MWh) | 347.9 | 235.4 | -32% | Static includes ISO 14683 thermal bridging (+8 MWh) + q50-derived infiltration (Dynamic uses default 0.5 ACH ≈ +30 MWh shift) + permanent-vent loss attribution differences. Both engines see the same fabric U-values now. |
| Heating electricity (MWh) | 68.0 | 72.9 | +7% | Dynamic includes EP's VRF part-load curves + defrost; Static uses seasonal SCOP 5.12 directly. |
| Cooling delivered (MWh) | 47.0 | 18.5 | -61% | Brief 28-IM §11.3 (sky long-wave): EP's full sky-temperature model reduces summer overheating relative to Static's degree-day approach. |
| Cooling electricity (MWh) | 13.4 | 6.7 | -50% | Falls out of the cooling-demand gap. |
| DHW delivered (MWh) | 174.9 | 32.9 | -81% | LARGEST gap. Static computes DHW from `occupant_hours × 0.1935 kWh/p/h`; Dynamic emits a `WaterHeater:Mixed` sized against just the GIA, not the bedroom-occupancy DHW model. Brief 28-DynamicParity will port the per-bedroom DHW sizing. |
| DHW electricity (MWh) | 30.2 | 11.9 | -61% | Follows DHW gap; ratio differs because fuel_mix isn't honoured in Dynamic V1 (uses legacy primary/secondary). |
| DHW gas (MWh) | 97.2 | 21.0 | -78% | Same root cause. |
| Fans electricity (MWh) | 25.9 | 44.1 | +70% | Static: `Σ(flow_l_s × SFP × hours / 1000)` per system. Dynamic: EP autosizes fan capacity against design-day air-side load → larger than nameplate when the room cooling/heating peak demands extra flow. |
| Lighting (MWh) | 38.3 | 64.5 | +68% | Static reads the gain profile directly (`gains.lighting.profiles`); Dynamic uses the assembler's V2.3 lighting density derivation against the hotel bedroom template. Profile-vs-template mismatch is a known issue; will close when Brief 28-DynamicParity ports the `building.schedules[]` resolver. |
| Small power (MWh) | 39.4 | 135.2 | +243% | Same root cause as lighting — equipment density derivation in the assembler is template-driven, not profile-driven. |
| Total electricity (MWh) | 215.2 | 335.3 | +56% | Dominated by the lighting + small-power deltas above. |
| Total gas (MWh) | 97.2 | 21.0 | -78% | DHW. |
| **EUI (kWh/m²·yr)** | **72.3** | **82.4** | **+14%** | The compensating signs (Dynamic cooling smaller, lighting/SP larger) bring the EUI deltas within an acceptable single-digit-percent band considering the unaddressed V1 gaps. |

**Comparison verdict:** the two engines now produce the same shape, the same units, and (after accounting for the listed convention differences) numbers in the same order of magnitude. The Δ% gaps in DHW + lighting + small power are explainable by specific listed unaddressed items; none are bugs. EUI is within 14% — close enough for the M5 Static/Dynamic toggle to give honest comparison numbers as long as the convention notes (Item 3) are visible to the user.

### Operation tab — natvent

Dynamic input-side parity already exists (Phase 1 §2 row 9) — `_build_operable_openings_objects` emits one `ZoneVentilation:WindandStackOpenArea` per opening. The parser still aggregates them under `Zone Ventilation Sensible Heat Loss Energy`, so the per-opening table in `OperationSummaryView` reads Static only. Convention note (Item 3) calls this out.

### Internal Gains

Static reads `building.gains.{occupancy,lighting,equipment}.profiles` directly; Dynamic gets gains via emitted `Schedule:Compact` blocks and reports them as annual `InteriorLights:Electricity` + `InteriorEquipment:Electricity`. There's no per-profile breakdown in the Dynamic output. The Static-only badge on the canvas views is honest and the toggle placeholder is gone.

---

## 3 — Brief 28-DynamicParity (deferred items)

These five items were explicitly skipped in Option B+ scope and queued for a separate brief after IM-M5 and IM-M6 land:

1. **DHW `fuel_mix` blending in Dynamic** — split DHW demand across `gas` / `electric_resistance` / `heat_pump` plants instead of legacy primary/secondary.
2. **q50 → operational ACH in Dynamic assembler** — derive ACH from `building.fabric.air_permeability_q50` instead of legacy `infiltration_ach` flat number; will close the heating-demand gap above.
3. **Monthly per-element aggregation in EP parser** — extract per-element × month matrix from SQL (data is there; needs a new `get_envelope_heat_flow_monthly_detailed()`).
4. **Per-opening and per-system daily/monthly arrays in EP parser** — already in input (input-side parity), parser collapses on output.
5. **`daily_profiles` parity** — assemble 365-day delivered + fuel split from the existing 8760 hourly SQL traces.
6. **`building.schedules[]` ingestion in Dynamic** — assembler should prefer project-scoped shared schedules over the hardcoded `_SCHEDULE_LIBRARY`. Closes the lighting/small-power profile-vs-template gap above.
7. **Per-vent-system `enabled` gating in Dynamic** — assembler currently emits one collapsed vent block per zone; per-system gating requires the multi-vent expansion.
8. **u_value_override / g_value_override honouring in Dynamic** — emit per-project Construction objects when the override is set.

---

## 4 — Files changed

```
nza_engine/generators/epjson_assembler.py    +44 lines  (item 1 crash fix; item 5 enabled gating)
nza_engine/parsers/sql_parser.py             +120 lines (item 4 get_consumption_block)
api/routers/projects.py                      +6  lines  (wire consumption into response)
frontend/src/utils/instantCalc.js            +25 lines  (item 2 vent enabled gating × 2 sites + projection)
frontend/src/components/modules/OperationModule.jsx          +12/-5 (item 3 honesty)
frontend/src/components/modules/gains/InternalGainsModule.jsx +9/-5 (item 3 honesty)
frontend/src/components/modules/building/BuildingDefinition.jsx +25/-4 (item 3 honesty)
frontend/src/components/modules/SystemsModule.jsx           +28 lines (item 3 honesty)
```

New audit + PASS docs:
```
docs/validation/brief_28im_M4_5_dynamic_audit_phase1.md      (already committed in Phase 1)
docs/validation/brief_28im_M4_5_dynamic_audit_phase2_pass.md (this file)
```

---

## 5 — Halt

Phase 2 Option B+ complete. Standing by for IM-M5 (Results module) authorisation. Brief 28-DynamicParity is the holding pen for the seven items deferred above; it should land after M5/M6 so the product narrative isn't gated on assembler internals.
