# Brief 28-IM Gate IM-M4.5 — Phase 1: Dynamic Engine Audit & Parity

**Date:** 2026-05-17
**Status:** Phase 1 (read-only audit) complete; Phase 2 not yet authorised.
**Author:** IM-M4.5 audit pass.
**Reviewer:** Chris (decides Phase 2 scope).

---

## TL;DR

Dynamic is **not currently reachable** on the live Bridgewater project. Even before the assembler reaches EnergyPlus the Python crashes on a one-line schema mismatch introduced when Brief 28k Gate 3+ moved `construction_choices` from `{element: "library_id"}` to `{element: {library_id, u_value_override}}`. The Static engine has a `resolveChoice()` helper for the new shape; the Dynamic assembler does not.

**Static has one additional confirmed bug**, surfaced by Chris and verified numerically in this audit: the per-vent `enabled` flag is exposed in the `consumption.ventilation[].enabled` output but never honoured by the engine math. Toggling all three Bridgewater vent systems off leaves fan_electricity = 25.9 MWh and space_heating delivered = 347.9 MWh — identical to "all on". `computeVentilationEnergy` and the State 2 mech vent loss loop both iterate `ventSystems` without checking the flag. Root-cause patch is a single early-continue gate at three sites (§5.4 below).

Of the eleven IM-M1 / IM-M2 / IM-M4 engine features audited, Dynamic understands one (`mode` flag) cleanly, accepts but discards one (per-opening natvent geometry — assembler emits it, parser collapses it), and is missing or actively mismatched on nine. The Systems module's entire `consumption.*` shape (the §8.1 contract) does not exist anywhere in the Python pipeline.

UI side: only one Static/Dynamic toggle in the entire app actually switches the rendered data source — `EngineToggle` inside `HeatBalance.jsx`, used by Building's Heat Balance tab. Everywhere else the toggle is absent, stubbed (Internal Gains: literal placeholder text "Engine toggle inline (Part 11)"), or shows a hardcoded "Static" badge. There is no silent-fallback risk because Dynamic is structurally unavailable across IM-M2 / IM-M3 / IM-M4 — and the user has no way to learn that from the UI either.

The brief's framing of "Dynamic is verified per-module but not blocking" was the right call at the time but has since drifted into **Dynamic is unmaintained**. Before IM-M5 (Results) and IM-M6 (Roadmap), one of three decisions is needed:
  1. Fix Dynamic to parity (engine + parser + UI fallback states), measured against the IM-M4 §8.1 contract. Estimated scope: large.
  2. Document Dynamic as out-of-service and remove every Static/Dynamic toggle / engine-badge from the UI so users aren't misled.
  3. Hybrid: fix the crash (so Dynamic at least produces SOME output for the modules that already have toggle wiring), document the rest as unavailable.

This document records the audit data only. Phase 2 fix scope is Chris's call.

---

## 0 — How Dynamic gets called

For reference. Both Static and Dynamic are exercised against the same Bridgewater project (`14b4a5b1-8c73-4acb-8b65-1d22f05ec969`) using the post-IM-M4 seed (`scripts/seed_bridgewater_v25_systems.mjs`).

| Engine | Entry point | Wiring |
|---|---|---|
| Static | `frontend/src/utils/instantCalc.js` `calculateInstant(building, constructions, systems, libraryData, weatherData, hourlySolar, null, options)` | Called from every IM module; auto-routes to State 3 v2.5 path when `systems_config_v25` + `system_templates` library are present (`instantCalc.js` line ~4554). |
| Dynamic | `POST /api/projects/{id}/simulate?mode=full\|envelope-only\|envelope-gains` | `api/routers/projects.py` line 427 calls `assemble_epjson()` then `run_simulation()`; the typed `/api/simulate` POST in `api/routers/simulate.py` is the same pipeline taking inline params. |

EnergyPlus binary on this PC: `C:\EnergyPlusV24-1-0\energyplus.exe` (v24.1.0-9d7789a3ac, found OK after setting `ENERGYPLUS_DIR`). The committed `nza_engine/config.py:17` default is `/Applications/EnergyPlus-25-2-0` (a macOS path baked in when the engine was first built on a Mac). That's a separate small finding — `go.bat` exports the right path locally so it doesn't normally bite users, but a fresh clone on Windows would.

---

## 1 — Does Dynamic run on Bridgewater today?

**No. The assembler crashes before EnergyPlus is invoked.**

Reproduced directly via Python from the project root:

```
$ ENERGYPLUS_DIR='C:\EnergyPlusV24-1-0' python -c "..."   # script body in audit notes
=== mode=envelope-only ===
  Assembler FAILED: TypeError: cannot use 'dict' as a set element (unhashable type: 'dict')
=== mode=envelope-gains ===
  Assembler FAILED: TypeError: cannot use 'dict' as a set element (unhashable type: 'dict')
=== mode=full ===
  Assembler FAILED: TypeError: cannot use 'dict' as a set element (unhashable type: 'dict')
```

Root cause — `nza_engine/generators/epjson_assembler.py:1183`:
```python
used_constructions = set(construction_choices.values()) | {_INTERIOR_CONSTRUCTION}
```

`construction_choices` on Bridgewater (post-Brief-28k seed) is shaped `{ "external_wall": { "library_id": "cavity_wall_enhanced", "u_value_override": 0.14 }, ... }`. Each value is a dict, not a hashable string, so `set(...)` blows up.

Knock-on bug (would surface immediately after a one-line fix to line 1183): `_substitute_constructions` at `epjson_assembler.py:134-149` calls `choices.get("external_wall", "default_name")` expecting a string id; same dict-vs-string mismatch. The Static engine has `resolveChoice()` in `instantCalc.js` to unwrap `{library_id, u_value_override}` consistently.

API-level reproduction: `POST /api/projects/{id}/simulate?mode=full` returns HTTP 500 with body `Internal Server Error` regardless of `mode`.

**Implication for the audit.** Because Dynamic cannot run end-to-end against Bridgewater, the per-module side-by-side comparison tables (§3 below) have empty Dynamic columns. The audit therefore pivots from "compare two columns of numbers" to "compare two engine schemas": what would Dynamic emit IF it ran, vs what Static emits today. That's §2.

---

## 2 — Engine schema audit (Static vs Dynamic)

This is the core finding. For each IM-M1 / M2 / M4 feature, audit whether the Dynamic assembler/parser pipeline supports it.

Verdicts: **MATCH** = present with equivalent semantics. **MISSING** = absent; would silently 0 or drop. **MISMATCH** = partially present but semantically different. **CRASH** = pipeline blows up on this input. **N/A** = doesn't map cleanly to EP physics.

| # | Feature | Static path | Dynamic path / status | Verdict |
|---|---|---|---|---|
| 0 | `construction_choices` dict-shaped ingestion (Brief 28k Gate 3+) | `instantCalc.js` `resolveChoice()` unwraps `{library_id, u_value_override}` | `epjson_assembler.py:1183` does `set(construction_choices.values())` over raw dicts; `_substitute_constructions` (l. 134-149) calls `choices.get("external_wall", …)` expecting a string id | **CRASH** |
| 1 | q50 → operational ACH (IM-M1) | `instantCalc.js:110` `deriveOperationalACH(building, geometry)` reads `building.fabric.air_permeability_q50`, computes n50, applies divide-by-20 rule | `_build_infiltration_objects` at `epjson_assembler.py:257-273` only consumes `building_params.get("infiltration_ach", 0.5)`; `air_permeability_q50` is never grepped anywhere in `nza_engine/` | **MISSING** |
| 2 | Per-element `monthly_heating_loss_kwh[12]` (IM-M2) | `instantCalc.js` State 2 ~2870-3110 emits 12-value arrays per envelope element + per-vent-system + per-opening | `sql_parser.get_envelope_heat_flow_detailed` returns ONLY annual per-face conduction; `get_monthly_energy_by_enduse` returns building-wide monthly per end-use only — never both axes crossed | **MISSING** |
| 3 | Thermal bridging via ISO 14683 H_TB (Brief 28-TB-Simple) | `losses_at_setpoint.thermal_bridging.{heating_loss_kwh, total_H_TB_W_per_K}` from `building.thermal_bridges[]` | `thermal_bridges` grepped: zero matches in `nza_engine/`. No `Construction:*` augmentation, no extra infiltration term, no surface conductance bump | **MISSING** |
| 4 | `mode` flag (envelope-only / envelope-gains / full) | Static reads `mode` from options | `assemble_epjson(..., mode="full")` at line 1121-1248: `state1 = mode == "envelope-only"`, `state2 = mode == "envelope-gains"`. State 1 zeros density + widens setpoints; State 2 emits gains + free-running. "envelope-gains-operation" and "full" both fall through. | **MATCH (partial)** |
| 5 | `consumption.*` block (IM-M4 §8.1) | `instantCalc.js` ~3720-3990 emits `{space_heating, space_cooling, dhw, ventilation[], lighting, small_power, total{electricity_mwh, gas_mwh, kwh_per_m2_yr}}` | `api/routers/projects.py:534-558` returns `summary`, `annual_energy`, `monthly_energy`, `envelope`, `envelope_detailed`, `hourly_profiles` — none named `consumption`. `annual_energy = {heating_kWh, cooling_kWh, lighting_kWh, equipment_kWh}` has no demand/delivered split, no SCOP/SEER, no DHW node. `get_energy_by_fuel` splits Electricity vs NaturalGas building-wide only — no per-service attribution. **`SystemsModule.jsx:142` reads `result?.consumption ?? null` — Dynamic would silently empty every Systems tab.** | **MISSING** |
| 6 | `enabled: false` per-service (IM-M4 §8.1) | Static checks `systems_config_v25.{heating,cooling,dhw}.enabled === false → delivered_mwh = 0` | `enabled` grepped across `nza_engine/generators/`: one hit (unrelated comment). `_build_hvac_ideal_loads`, `generate_vrf_system`, `generate_dhw_system`, `generate_ventilation_system` always emit objects; capacities are autosized regardless of the flag | **MISSING** |
| 7 | DHW `fuel_mix` blending (IM-M4 §8.1) | Static reads `systems.dhw.fuel_mix = {gas, electric_resistance, heat_pump}` and apportions demand across three carriers | `epjson_assembler.py:1438-1462` reads `systems_cfg["dhw"]["primary"]["system"]` + `["secondary"]["system"]` only. `generate_dhw_system` in `hvac_dhw.py` only knows `dhw_primary` / `dhw_preheat` strings — no fuel-mix vector ingestion | **MISMATCH** |
| 8 | Per-system mech vent monthly + daily arrays (IM-M2 + IM-M3 + IM-M4) | Static `losses_at_setpoint.ventilation[].{daily_heat_loss_kwh, monthly_heating_loss_kwh}` + `consumption.ventilation[].fan_electricity_mwh` per system | `generate_ventilation_system` emits one MEV/MVHR per zone, but `get_monthly_energy_by_enduse` returns building-wide `fans_kWh[12]`; `get_envelope_heat_flow_detailed` lumps mech-vent heat loss under `Zone Ventilation Sensible Heat Loss` aggregate. No per-system or daily arrays | **MISSING** |
| 9 | Per-opening natural ventilation (Brief 28e / IM-M3) | Static `losses_at_setpoint.natural_ventilation[].{heat_loss_kwh, monthly_heating_loss_kwh, daily_heat_loss_kwh, daily_open_hours, avg_flow_when_open_l_s, avg_dT_when_open_k}` per opening | Assembler side: `_build_operable_openings_objects` (l. 361-464) DOES emit one `ZoneVentilation:WindandStackOpenArea` per opening per zone (✓). Parser side: NO per-opening extraction — `Zone Ventilation Sensible Heat Loss Energy` is summed across all such objects in `get_envelope_heat_flow` (l. 501) and `hourly_profiles` (l. 559) | **MISMATCH** (input matches, output collapsed) |
| 10 | `building.schedules[]` shared schedules (IM-M4 Addition 1) | `frontend/src/utils/scheduleLibrary.js` prefers `building.schedules` over hardcoded `SCHEDULES` | Grep `building.schedules` in `nza_engine/`: zero matches. Assembler only ingests `building.gains.{lighting,equipment,occupancy}.profiles` + `schedule_overrides` keyed by `schedule_type` | **MISSING** |
| 11 | `daily_profiles` arrays on State 3 results (IM-M4) | Static `consumption.daily_profiles.delivered_kwh_per_day.{heating, cooling, dhw, fans, lighting, small_power}` + `fuel_kwh_per_day.{electricity, gas}` (365-element arrays each) | `sql_parser.get_typical_day_profiles` returns 4 representative 24-h day profiles (peak heating / peak cooling / typical winter / typical summer). `get_hourly_profiles` returns 8760 series but never aggregated to 365 daily totals. No fuel-split daily output exists | **MISSING** |

### Engine schema verdict

Of eleven IM-M1/M2/M4 features audited, Dynamic produces a recognisable match for exactly one (`mode` flag) and emits one input-side equivalent that the parser collapses (per-opening natvent). The other nine are missing, mismatched, or actively crash before EP runs. **Dynamic understands the pre-Brief-28 envelope-loss-by-face shape and nothing from IM-M1 / M2 / M4 since.**

### What the assembler + parser would need to add (Phase 2 sketch — for scoping only)

1. **`resolveChoice()` Python port** into `_substitute_constructions` + line 1183 so dict-shaped `construction_choices` works end-to-end. Smallest possible fix; unblocks every Dynamic run on every post-Brief-28k project (i.e. every live project today).
2. **q50 + thermal bridging ingestion**: read `building.fabric.air_permeability_q50` and `building.thermal_bridges[]`, translate to per-zone infiltration ACH + an `H_TB`-equivalent surface adjustment (or a synthetic `ZoneInfiltration` "TB" object). Without these Dynamic systematically under-reports envelope loss vs Static.
3. **`enabled: false` handling**: branch `generate_*` calls on the per-service flag; when off, either skip the plant object entirely or set capacity to 0 with a flag in the run summary.
4. **DHW `fuel_mix`**: read the three-fraction vector, apportion DHW demand across multiple plant objects (one ASHP + one electric resistance + one gas-fired) instead of the legacy primary/secondary single-system path.
5. **`get_consumption(sql, building_params)` parser function** returning the IM-M4 §8.1 dict shape (per-service delivered/demand/electricity/gas/SCOP/SEER + per-system fan kWh + per-opening natvent + 365-element daily arrays). This is the single biggest piece of new work.
6. **`get_envelope_heat_flow_monthly_detailed(sql)`** parser function for the per-element × month matrix.
7. **`building.schedules[]` resolver port**: assembler should prefer project-shared schedules over the hardcoded `_SCHEDULE_LIBRARY` in `nza_engine/library/schedules.py`, mirroring the Static resolver.

(Items 5 + 6 are doable from the existing 8760 hourly traces in the SQL — the data is there, it's just an aggregation function. Items 2-4 require structural changes to the HVAC generators.)

---

## 3 — Static baseline numbers (the comparison rows that would have a partner column once Dynamic runs)

Captured against the current live Bridgewater project at `14b4a5b1...`, weather `GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw`, comfort band 21/25 °C. **DHW `fuel_mix` is currently at the 50/50 audit-session value (gas:0.5 / electric_resistance:0 / heat_pump:0.5), not the 60/40 baseline seed** — leftover from the IM-M4 screenshot session. The total elec/gas/EUI numbers reflect the 50/50 state.

### 3.1 Building (State 1, envelope-only)

| Element | Static (kWh/yr) | Dynamic | Δ | Convention note |
|---|---:|---:|---|---|
| External wall (1900 m²) | 20 020 | — (crash) | — | |
| Roof | 9 174 | — | — | |
| Ground floor | 9 589 | — | — | |
| Glazing | 54 578 | — | — | Solar transmission 99 397 kWh/yr (separate column on Static) |
| Fabric leakage | 26 971 | — | — | Static: op ACH 0.068, q50 4.64. Dynamic uses legacy `infiltration_ach` if present; Bridgewater seed dropped it in favour of q50, so Dynamic would fall back to engine default 0.5 ACH (huge bias). |
| Permanent vents | 120 782 | — | — | |
| Thermal bridging | 8 023 | — | — | Static: H_TB 92.94 W/K (ISO 14683). Dynamic: TB not represented at all. |
| **Heating demand** | **315.3 MWh** | — | — | |
| Cooling demand | 33.4 MWh | — | — | |
| Free-running mean / winter min / summer max | 16.1 / 5.7 / 30.6 °C | — | — | |
| Comfort hours / under / over | 2 037 / 6 336 / 387 h | — | — | |

### 3.2 Internal Gains (State 2 envelope-gains)

| Metric | Static | Dynamic | Convention note |
|---|---:|---:|---|
| People annual gain (kWh) | 108 438 | — | |
| Lighting annual gain (kWh) | 38 268 | — | |
| Equipment annual gain (kWh) | 39 432 | — | |
| S2 heating demand (MWh) | 445.1 | — | Higher than S1 because the State 2 setpoint convention drives demand against 21 °C; gains offset partial but envelope demand is computed without them on the loss side |
| S2 cooling demand (MWh) | 47 | — | |

### 3.3 Operation (State 2 per-opening natural ventilation)

| Opening | Static heat_loss_kwh | open_hours | avg_flow (L/s) | avg_ΔT (K) | Dynamic |
|---|---:|---:|---:|---:|---|
| Main entrance door (south, scheduled) | 145 584 | 2 349 | 6 730 | 9.2 | — (would emit `ZoneVentilation:WindandStackOpenArea` but parser collapses to aggregate; convention difference also expected: BS 5925 vs EP F_w autocalc — see Brief 28e Gate E4) |

### 3.4 Systems (State 3 consumption block)

DHW currently at the 50/50 audit setting:

| Category | Demand MWh | Delivered MWh | Elec MWh | Gas MWh | SCOP/SEER | Dynamic |
|---|---:|---:|---:|---:|---:|---|
| Space heating | 445.1 | 347.9 | 68.0 | 0.0 | SCOP 5.12 | — |
| Space cooling | 47.0 | 47.0 | 13.4 | 0.0 | SEER 3.51 | — |
| DHW (50/50 HP/gas) | 174.9 | 174.9 | 30.2 | 97.2 | — | — |
| Vent fans (per-system) | — | — | 17.5 + 7.7 + 0.7 | — | — | — |
| Lighting | — | — | 38.3 | — | — | — |
| Small power | — | — | 39.4 | — | — | — |
| **Total** | — | — | **215.2** | **97.2** | **EUI 72.3 kWh/m²·yr** | — |

(After resetting DHW back to the seed 60/40, EUI comes out at ~86.5 — that's the IM-M4 screenshot baseline. The 50/50 value of 72.3 here reflects the leftover slider state, recorded for honesty about the audit session.)

---

## 4 — UI Static / Dynamic toggle inventory

For each IM module, where does a toggle exist and what happens when Dynamic data is null?

| Module | Tab / View | Toggle present? | Component:line | Fallback when Dynamic missing |
|---|---|---|---|---|
| Building | Heat Balance | YES — wired | `building/BuildingDefinition.jsx:910-919` passes `simBalance` from `useSimulationBalance(projectId, simCtx.runId, 'envelope-only')` (l. 1264) into `HeatBalance`; toggle UI in `balance/HeatBalance.jsx:954-996` `EngineToggle`; state at l. 715; default-flips to 'simulation' only if Static is null (l. 717) | Silent — `engineMode` initialises to `'live'` (Static) so user sees Static unless they click Dynamic. Dynamic button is `disabled` when `hasSimulation === false`. Clicking with no data lands in the `!data` branch (l. 753) → "No simulation results yet — click Run Simulation". |
| Building | Profiles / Monthly | NO toggle | `BuildingProfilesView` / `BuildingMonthlyView` — Static-only | Renders Static silently. |
| Building | Summary | "Comparison" panel, not a toggle | `BuildingSummaryView` reads BOTH `instantResult` (Static, primary table) AND `simBalance?.demand?.heating_demand_mwh` (single comparison number) | Static rendered always; Dynamic single number shows as "—" when sim missing. No callout that Dynamic side is empty. |
| Operation | Heat Balance | NO active toggle — hardcoded Static | `OperationModule.jsx:414-423` passes `simulationData={null}` + `simulationInfo={null}` into `HeatBalance` — Dynamic button is permanently disabled even when a run exists | Silent Static; Dynamic button greyed out regardless. |
| Operation | Profiles / Schedule / Monthly | NO toggle | Static-only views | Static silently. |
| Operation | Summary | NO toggle, but the **comment** at l. 725 says "Static-vs-Dynamic Δ" — implementation has no Dynamic source. Every `eng?.*` lookup at l. 768-772 hits the Static `nv` array | Renders Static silently; the "Δ" promise in the comment is unfulfilled. |
| Systems | Sankey / Profiles / Schedule / Monthly / Summary | NO toggle anywhere | `SystemsModule.jsx:142` reads `result?.consumption ?? null`; tabs all gate on `consumption &&`; no `useSimulationBalance` import, no `EngineToggle` | Static silently. Because Dynamic doesn't emit `consumption.*` (row 5 above), the Systems module is structurally Static-only — wiring a toggle today would empty every tab. |
| Internal Gains | Schedule | NO (`hasEngineToggle: false` flag) | `gains/InternalGainsModule.jsx:174` | Static silently. |
| Internal Gains | Summary / Heat balance / Profiles / Monthly | `hasEngineToggle: true` flag set BUT toggle is a literal placeholder | `gains/InternalGainsModule.jsx:175-181` flag set + l. 467-471 renders italic text **"Engine toggle inline (Part 11)"**. Canvas views render an `EngineBadge` hardcoded to label the data as "Static"; tooltip at `canvas/EngineBadge.jsx:32` confirms "Dynamic toggle (EnergyPlus) lands once State 2 EP results plumbing is wired in Brief 28a Part 5." | Static silently. Badge correctly labels the data as Static — there is no fallback risk because there is no toggle. |

### UI toggle verdict

Only one toggle in the entire app actually switches the rendered data source — `EngineToggle` inside `HeatBalance.jsx` — and even that toggle is only fed real Dynamic data by **Building → Heat Balance**. Operation passes `simulationData={null}` hardcoded; Systems and Internal Gains don't wire it at all.

The toggle defaults to Static and the Dynamic button auto-disables when `simulationData` is null, so **there is no risk of silent stale-Dynamic data being shown**. But there is also no risk of the user noticing Dynamic is unmaintained, because everywhere except Building → Heat Balance the toggle is either absent, stubbed ("Engine toggle inline (Part 11)"), or shows a hardcoded "Static" badge.

The Operation Summary's "Static-vs-Dynamic Δ" comment is the closest thing to a misleading promise in the current UI — it implies a comparison the code never delivers.

---

## 5 — Static-side bugs found in this audit (independent of Dynamic work)

### 5.4 Vent system `enabled: false` doesn't gate anything

**Surfaced by:** Chris, confirmed numerically below.

**Symptom:** Toggling a vent system OFF in the Systems UI shows the `enabled=false` badge on the per-system row in Live Results but leaves every downstream number unchanged.

**Numerical confirmation** (Bridgewater current state, `node` invocation):

```
1. baseline (all vent on)                 fans=25.9 MWh   heating delivered=347.9 MWh   EUI=72.3 kWh/m2.yr
2. ALL ventilation enabled=false          fans=25.9 MWh   heating delivered=347.9 MWh   EUI=72.3 kWh/m2.yr
3. mvhr_gf_public hre=0 (other untouched) fans=25.9 MWh   heating delivered=542.7 MWh   EUI=80.8 kWh/m2.yr
```

Run 2 vs run 1: byte-identical output despite all three vent systems flagged off. Run 3 (different test, control): setting `hre = 0` directly DOES propagate — heating jumps +194 MWh — so the HRE recovery math is correct, it's just not gated.

**Root cause** — three sites in `frontend/src/utils/instantCalc.js`:

1. **`computeVentilationEnergy(ventSystems, ...)` at line 3562**: the loop body
   ```js
   for (let i = 0; i < ventSystems.length; i++) {
     const vs = ventSystems[i]
     const id = vs.id ?? `vent_${i}`
     const { hours: hours_active, ... } = hoursActiveForSchedule(...)
     const fan_kwh = (vs.flow_l_s * vs.sfp_w_per_l_s * hours_active) / 1000
     // ... HRE recovery accumulation ...
   }
   ```
   never checks `vs.enabled`. Every system contributes fan_kwh + recovery_mwh regardless.

2. **State 2 mech vent loss loop at line 2557**:
   ```js
   for (let vi = 0; vi < ventSystems.length; vi++) {
     const heat_h = ventUA[vi] * dT_heat_out
     ...
     acc_mech_vent_heat_per_system[vi] += heat_h
     daily_mech_vent_per_system[vi][_dd] += heat_h
     monthly_mech_vent_per_system[vi][_md] += heat_h
   }
   ```
   accumulates per-system loss into `losses_at_setpoint.ventilation[]` regardless of `enabled`.

3. **State 3 `consumption.ventilation[].fan_electricity_mwh` emit at line 3928**:
   ```js
   ventilation: ventResult.perSystem.map((v, vi) => {
     const cfgEntry = Array.isArray(sys.ventilation) ? sys.ventilation[vi] : null
     return {
       enabled:             cfgEntry?.enabled !== false,
       fan_electricity_mwh: r_mwh(v.fan_kwh / 1000),     // ← always emits raw
       hre_recovery_mwh:    r_mwh(v.recovery_mwh),       // ← always emits raw
       ...
     }
   })
   ```
   reads `enabled` for the output metadata field but doesn't zero the value field.

**Minimum fix scope (Phase 2):** Two early-continue gates — one in `computeVentilationEnergy` (line ~3597) and one in the State 2 mech vent loop (line ~2559). Plus a tiny "`enabled ? value : 0`" guard at the emit site (line 3928) for defensive symmetry. About 5-10 lines of code, no API/contract change.

**Knock-on visibility once gated**: with all three vent systems disabled, expect (a) `consumption.ventilation[].fan_electricity_mwh = 0` for each, (b) `losses_at_setpoint.ventilation[].heat_loss_kwh = 0` for each, (c) `space_heating.delivered_mwh` to INCREASE by ~97 MWh (the lost HRE recovery on the GF MVHR), and (d) `total.electricity_mwh` to drop by ~25.9 MWh (the fans). Net EUI direction: hard to predict without running — increased heat demand (× SCOP 5.12 → ~+19 MWh elec) probably outweighs the 25.9 MWh fan saving, so EUI rises. Worth recording the actual delta as a Phase 2 verification check.

---

## 6 — Phase 2 decision menu (for Chris)

Three options, smallest to largest. All include the Static vent fix from §5.4 as a no-cost baseline — it's a 5-line patch on a confirmed regression.

### Option A — "Crash fix + vent fix" (≈ half-day)
- Port `resolveChoice()` semantics into `_substitute_constructions` and line 1183 of `epjson_assembler.py`.
- Plus: gate `computeVentilationEnergy` + State 2 mech vent loop + State 3 consumption emit on `vs.enabled` (§5.4).
- That unblocks Dynamic for every project AND fixes the vent on/off Static bug. Result: Dynamic produces its current pre-IM output schema (annual_energy / monthly_energy / envelope / hourly_profiles / fuel_split) — nothing IM-M1/M2/M4-aware, but it RUNS.
- UI: leave existing toggles where they are. Building → Heat Balance starts working. Systems and Internal Gains stay Static-only with the existing stubs.
- Risk: invites the user to compare Static vs Dynamic without warnings about the schema gap. The numbers WILL diverge (q50 missing, TB missing, etc.).

### Option B — "A + annotate the gaps in Summary views" (≈ 1-2 days)
- Everything in A.
- Plus: add convention/feature-difference annotations in each module's Summary view. Document explicitly that Dynamic omits TB, omits q50-derived infiltration, uses BS 5925 convention for natvent, etc.
- Plus: remove the misleading "Static-vs-Dynamic Δ" comment from `OperationModule.jsx:725` (replace with honest "(Dynamic not yet wired)").
- Plus: remove the "Engine toggle inline (Part 11)" placeholder from `InternalGainsModule.jsx` (either ship the toggle stub disabled with a tooltip, or strip the flag).
- Risk: same divergence, but the UI is now honest about it.

### Option C — "Parity build" (full Phase 2 per brief, ≈ 1-2 weeks)
- Everything in B.
- Plus: implement assembler + parser items 2-7 from §2's "What the assembler would need to add" sketch.
- Plus: wire `useSimulationBalance` into Operation Heat Balance and Systems (passing `consumption`-shaped Dynamic output).
- Result: real Static-vs-Dynamic toggle works on every IM module. Comparison tables in §3 populate with both columns.
- Risk: largest implementation surface area before IM-M5 / M6.

**Recommendation (audit author's view, not binding):** Option B. The Static engine is now the source of truth for IM-M1/M2/M4; the user's day-to-day workflow doesn't need Dynamic to produce IM-shaped output for IM-M5 and IM-M6 to land. What it *does* need is honesty about which numbers are which. Option C is the right end state but parity work shouldn't gate IM-M5.

---

## 7 — Halt

Phase 1 complete. No code changed. Awaiting Chris's call on which option above to authorise for Phase 2.
