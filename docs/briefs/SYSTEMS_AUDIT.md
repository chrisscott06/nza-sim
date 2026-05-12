# NZA Sim — Systems Implementation Audit

End-to-end audit of how each building system is wired through UI → state → instant calc → EnergyPlus emit. Written so the receiving Claude can grep field names verbatim.

All file paths are absolute on Chris's machine: `C:\Users\ChrisScott\Dev\nza-sim\…`. Line numbers refer to the state of the repo at the time of writing.

---

## 0. Cross-cutting: what's good, what's missing

### What the codebase already does well
- **Demand-based system slots.** `systems_config` has been migrated from flat keys (`hvac_type`, `dhw_primary`, …) to a demand-keyed shape (`space_heating.primary`, `space_cooling.primary`, `dhw.primary`/`secondary`, `ventilation.primary`) with `share` and `efficiency_override`. See `frontend/src/context/ProjectContext.jsx:72-171` (DEFAULT_SYSTEMS + `migrateSystemsConfig`). Flat aliases are still maintained for backward compat.
- **Single-source-of-truth library for system templates.** All system-level constants live in `nza_engine/library/systems.py` (`_SYSTEMS` dict, `list_systems()`, `get_system()`).
- **Ideal Loads vs Detailed mode toggle.** `systems.mode` switches between `ZoneHVAC:IdealLoadsAirSystem` and the real VRF / gas-baseboard / MVHR / DHW stack. Branching happens in `nza_engine/generators/epjson_assembler.py:689-808`.
- **VRF performance curves are real.** `hvac_vrf.py` ships with the full set of biquadratic / cubic / quadratic curves from `VRFMultispeedFan.idf`, including capacity-vs-temp boundary curves and PLR EIR modifiers.
- **MVHR has plate-HX physics.** `HeatExchanger:AirToAir:SensibleAndLatent` with sensible effectiveness at 100%/75% airflow, paired with two `Fan:SystemModel` objects per zone, and NodeList plumbing so the ERV co-exists with the VRF terminal unit (`hvac_ventilation.py:84-267`).
- **Live calc is decoupled.** `frontend/src/utils/instantCalc.js` does its own degree-day + EPW-hourly steady-state calc keyed off the same library identifiers (`SYSTEM_DEFAULTS` dict at lines 18-41). It deliberately ignores EnergyPlus details so sliders update under 50 ms.

### Where it's thin — recurring patterns
- **No system-level Inspector.** Constructions have `ConstructionInspector.jsx` (clickable U-value badge → side panel → editable layers, save-as-copy, Y-factor preset). Systems have *nothing equivalent*. The closest thing is `SystemEditor.jsx` (a modal in the Library Browser only — `frontend/src/components/modules/library/SystemEditor.jsx`, 7 system types, ~30 LOC of fields). Per-demand inspection of curve coefficients, defrost strategy, fan SFP breakdown, tank stratification etc. is not exposed.
- **Most slider overrides only land on one parameter.** `efficiency_override` writes a single COP/SCOP/SEER/efficiency number that overrides the rated value — it does not let the user edit the curves, defrost time fraction, condenser inlet temp limits, etc.
- **Instant calc has many baked-in constants.** `UK_HDD = 2200`, `UK_CDD = 150`, `HOTEL_OPERATING_HOURS = 2200`, `HOTEL_EQUIP_HOURS = 1800`, `DHW_L_PER_PERSON_DAY = 26.6`, utilisation factor `0.60`, cooling-gain fraction `0.25` — all at `instantCalc.js:50-94, 372-415`.
- **Schedule overrides only work on a fixed list of types.** `_SCHEDULE_TYPE_TO_DEFAULT_NAME` (`epjson_assembler.py:560-568`) maps 7 schedule types to 7 hard-coded compact-schedule names. Anything outside that list is silently ignored.
- **Library Browser flow exists for systems but is shallower than constructions.** Clicking a system in the Library Browser shows the raw `config_json` and a Duplicate button (`SystemEditor.jsx`). There is no equivalent of the Construction Inspector's per-layer breakdown, no "compare two systems" view.

### "What's NOT in Systems" notes
- **Building → Openings (passive ventilation) is no longer a system.** Per-facade louvre area + openable-window fraction live in `params.openings` (Building module), and emit `ZoneVentilation:WindAndStackOpenArea` from `_build_openings_objects` at `epjson_assembler.py:263-340`. The systems library used to carry an entry for this; it is now removed (see comment at `nza_engine/library/systems.py:329-330`).
- **Infiltration is also not a system.** It comes from `building_params.infiltration_ach` (default `0.5`, `epjson_assembler.py:73`) and emits one `ZoneInfiltration:DesignFlowRate` object per zone.

---

## 1. Space Heating

### 1.1 UI surface area
- **Page:** `/systems` route → `frontend/src/components/modules/SystemsZones.jsx`. The three-column layout is the canonical UI; the older one-tab-per-system (`HVACTab.jsx`, `DHWTab.jsx`, `VentilationTab.jsx`, `LightingTab.jsx`) still exists in `frontend/src/components/modules/systems/` but is not the entry point used by `App.jsx:38`.
- **Component:** `InputsColumn` → "Space Heating" `AccordionSection` (`SystemsZones.jsx:315-368`).
- **Visible fields:**
  - Primary system `<select>` filtered to library items where `serves === 'heating' || 'heating_and_cooling'` (`SystemsZones.jsx:220-224`).
  - Efficiency override slider — label switches between `Seasonal efficiency` (gas, range 0.7–1.0, step 0.01) and `SCOP` (electricity, range 1.5–6.0, step 0.1) (`SystemsZones.jsx:324-334`).
  - "Combined VRF" italic note when the same library item also serves cooling.
  - Mini sparkline of the `heating_setpoint` schedule (clickable → opens schedule editor on the right pane).
  - Add Secondary (bivalent) button — adds `{ system: 'gas_boiler_heating', share: 0.2 }`. UI exposes `share` slider 5–50%, system select, remove.
- **Hidden behind defaults:**
  - Performance curves (all biquadratic / cubic / quadratic VRF curves at `hvac_vrf.py:39-314`). Not editable from the UI.
  - Defrost strategy (hard-coded `Resistive` / `Timed`, time fraction `0.058333`, `hvac_vrf.py:387-391`).
  - Crankcase heater power (`15.0 W`, `hvac_vrf.py:383`).
  - Min/max condenser inlet temps (`-20 / 20°C heating`, `-5 / 43°C cooling`, `hvac_vrf.py:333-353`).
  - Heating setpoint schedule (always `hotel_heating_setpoint`, 18°C setback / 21°C occupied, no per-zone variation).
  - Sizing factors (`zone_heating_sizing_factor: 1.25`, `epjson_assembler.py:450`).
  - Fraction radiant for gas baseboard (`0.30`, `hvac_heating_boiler.py:71`).

### 1.2 Data model
- **State key:** `systems.space_heating.primary` = `{ system: <library name>, share: 1.0, efficiency_override: <number|null> }`. `systems.space_heating.secondary` is null or same shape.
- **Defaults:** `gas_boiler_standard` primary, no secondary (`ProjectContext.jsx:76-80`).
- **Backward-compat aliases:** `systems.hvac_type`, `systems.cop_heating`, `systems.cop_override` — written through by `updateSystem` (`ProjectContext.jsx:398-440`).
- **Library entries** (`systems.py`): `gas_boiler_standard`, `gas_boiler_heating`, `vrf_standard`, `vrf_high_efficiency`, `vrf_heating`, `ashp_heating`, `ashp_space`, `electric_panel_heating`. Each has `serves`, `category`, `efficiency_type` (`scop|thermal_efficiency|cop`), `efficiency_value`, `fuel_type`, `fan_power_w_per_m2`, `min_outdoor_temp_c`, `defrost_strategy`, `has_heat_rejection`, `has_exhaust_waste`.
- **Schedule references:** `hotel_heating_setpoint` (Schedule:Compact, `schedules.py:228-241`).

### 1.3 Live calc (`instantCalc.js`)
- Uses `SYSTEM_DEFAULTS` lookup at `instantCalc.js:18-41` keyed on the system name.
- `calculateInstantDegreeDay` lines 376-403: reads `systems.space_heating.primary.system` + `efficiency_override`, falls back to `SYSTEM_DEFAULTS[key].eff` (e.g. 3.5 for vrf_standard, 0.92 for gas_boiler_standard). Same for secondary; combines via `share`.
- Heating thermal demand: `heating_thermal = max(0, heat_losses - heat_gains × 0.60)` where `0.60` is a bedroom-specific utilisation factor, `instantCalc.js:367-374`. `heat_losses = total_fabric + infiltration_kWh + vent_kWh`.
- Fuel split routing at `instantCalc.js:391-403` switches on `shDef.fuel === 'gas' | 'electricity'` and divides by `sh_eff`. Result feeds `heating_gas` or `heating_electricity` totals.
- **Constants baked in:** `UK_HDD = 2200`, `AIR_HEAT_CAPACITY = 0.33 kWh/m³/K`, utilisation factor `0.60`. No part-load curves, no outdoor temp dependency — heating is steady-state.

### 1.4 EnergyPlus emit
Branches at `epjson_assembler.py:691-738` on whether the primary heating system is gas or electric.

**Gas baseboard branch** (`generate_gas_baseboard_system`, `hvac_heating_boiler.py`):
- One `ZoneHVAC:Baseboard:Convective:Gas` per zone (`{zone}_GasBaseboard`) with `availability_schedule_name: hotel_ventilation_continuous`, `nominal_capacity: Autosize`, `efficiency: <slider value>`, `fraction_radiant: 0.30`.
- One `ZoneHVAC:EquipmentList` per zone (heating_seq=1, cooling_seq=0).
- One `ZoneHVAC:EquipmentConnections` per zone wiring `{zone}_Supply` / `{zone}_Air` / `{zone}_Return`.
- `ThermostatSetpoint:DualSetpoint` referencing `hotel_heating_setpoint` + `hotel_cooling_setpoint` schedules.
- `ZoneControl:Thermostat` referencing the dual-setpoint and `ThermostatControlType_DualSetpoint` schedule.
- If cooling system is non-`none_cooling`, VRF cooling is layered on top via `add_vrf_cooling_to_baseboard` — VRF terminal units appended to the same equipment list with cooling_seq=1, heating_seq=0.

**VRF / ASHP branch** (`generate_vrf_system`, `hvac_vrf.py`):
- Shared performance curves: `Curve:Biquadratic` ×8, `Curve:Cubic` ×8, `Curve:Quadratic` ×4, `Curve:Linear` ×2.
- One `AirConditioner:VariableRefrigerantFlow` outdoor unit named `VRF_Heat_Pump`, `gross_rated_heating_cop` set from `efficiency_override` or library `scop`.
- One `ZoneTerminalUnitList` named `VRF_Terminal_Unit_List`.
- Per zone: `ZoneHVAC:TerminalUnit:VariableRefrigerantFlow`, `Coil:Heating:DX:VariableRefrigerantFlow`, `Coil:Cooling:DX:VariableRefrigerantFlow`, `Fan:SystemModel`, `ZoneHVAC:EquipmentList`, `ZoneHVAC:EquipmentConnections`, `ThermostatSetpoint:DualSetpoint`, `ZoneControl:Thermostat`.
- Sizing objects via `_build_sizing_objects` (`epjson_assembler.py:421-487`): `DesignSpecification:OutdoorAir`, `Sizing:Zone`, `SizingPeriod:DesignDay` (winter `-5°C`, summer `32°C`).

### 1.5 EP capability we're NOT using
1. **Outdoor reset / weather-compensation curves on gas boilers.** We model gas heating as `Baseboard:Convective:Gas` with a single efficiency. No `Boiler:HotWater` with `nominal_thermal_efficiency` + `efficiency_curve_name` (PLF-vs-PLR or condensing-curve), no plant loop, no return-water-temp-driven condensation logic.
2. **Editable VRF defrost cycle.** Hard-coded `defrost_strategy: Resistive`, `defrost_control: Timed`, `defrost_time_period_fraction: 0.058333`. EnergyPlus supports `ReverseCycle` defrost with on-demand control and `Curve:Biquadratic` for defrost EIR.
3. **Variable-speed compressor + multi-stage curves.** We use a single rated COP. EnergyPlus `AirConditioner:VariableRefrigerantFlow:FluidTemperatureControl[:HR]` exposes refrigerant temperature controls and explicit compressor/evaporator/condenser models.
4. **Zone-level setpoint schedules / setback by zone.** All zones share `hotel_heating_setpoint`. EnergyPlus allows per-zone `ZoneControl:Thermostat:OperativeTemperature` with adaptive comfort or per-zone occupancy-driven setpoints.
5. **Heat recovery between heating and cooling zones.** `heat_pump_waste_heat_recovery: No` is hard-coded (`hvac_vrf.py:373`). Real VRF systems can run in heat-recovery mode (3-pipe), recovering heat from cooling zones to heating zones.

### 1.6 Schedules / dependencies
- `hotel_heating_setpoint` (Schedule:Compact, hourly setpoint °C). Frontend mini-sparkline reads `librarySchedules` from `/api/library?type=schedule`.
- Coupled to **Space Cooling** via the same VRF outdoor unit when `serves === 'heating_and_cooling'`. UI shows "Linked to Space Cooling — same VRF unit" italic badge.
- Coupled to **Ventilation** via the shared availability schedule `hotel_ventilation_continuous` (`hvac_vrf.py:36`) — VRF terminal unit availability follows ventilation, not occupancy, to avoid morning re-heat spikes.
- Coupled to **DHW** only when both use a gas boiler (separate gas meters, but shared fuel; modelled separately).

---

## 2. Space Cooling

### 2.1 UI surface area
- Same page (`SystemsZones.jsx`), "Space Cooling" `AccordionSection` at `SystemsZones.jsx:370-408`.
- **Visible fields:**
  - Primary system `<select>` filtered to `serves === 'cooling' || 'heating_and_cooling'`.
  - SEER slider (1.5–7.0, step 0.1) — only shown when item has SEER and is not heating-only.
  - "Linked to Space Heating — same VRF unit" italic note when `isCombinedVRF` (`SystemsZones.jsx:289, 388-390`).
  - Mini sparkline of `cooling_setpoint` schedule.
  - Add Secondary cooling (`split_system_cooling` default).
- **Hidden:**
  - Cooling setpoint schedule (`hotel_cooling_setpoint`, 28°C setback / 24°C occupied) — not editable.
  - Sensible heat ratio (`Autosize`).
  - Condenser air-cooled vs water-cooled (hard-coded `AirCooled`, `hvac_vrf.py:394`).
  - Crankcase / part-load curves.

### 2.2 Data model
- **State key:** `systems.space_cooling.primary` = `{ system, share, efficiency_override }`.
- **Defaults:** `vrf_standard` primary (`ProjectContext.jsx:81-85`).
- **Library entries:** `vrf_cooling`, `split_system_cooling`, `none_cooling` (cooling-only) plus the combined `vrf_standard`, `vrf_high_efficiency`. `none_cooling` has `seer: None`, `efficiency_value: None`, `fuel_type: None`.
- **Schedule:** `hotel_cooling_setpoint` (Schedule:Compact).

### 2.3 Live calc
- `instantCalc.js:407-417`: `cooling_thermal = max(0, (total_solar + total_internal) × 0.25 - UK_CDD × gia × 0.001)`. The `0.25` is `COOLING_GAIN_FRACTION` (line 414) — a UK-climate hand-waved single number.
- `cooling_electricity = cooling_thermal / sc_eer_val` (line 417). `sc_is_none` short-circuits to 0.

### 2.4 EnergyPlus emit
- When primary cooling = `none_cooling`: VRF is generated with `provide_cooling=False`, equipment list cooling sequence set to 0 (`epjson_assembler.py:733-738`).
- When VRF combined heating+cooling: a single `AirConditioner:VariableRefrigerantFlow` with both heating and cooling rated values + curves (`hvac_vrf.py:317-399`).
- When gas-heating + VRF cooling: gas baseboard handles heating (heating_seq=1, cooling_seq=0), VRF terminal unit handles cooling (cooling_seq=1, heating_seq=0); merged via `add_vrf_cooling_to_baseboard` (`hvac_heating_boiler.py:124-178`).
- Heat rejection: implicit via `condenser_type: AirCooled` + `condenser_inlet_node_name: VRF_Condenser_OA_Node`. Output captured in `Cooling:Electricity` and `Heating:Electricity` meters.

### 2.5 EP capability we're NOT using
1. **Cooling tower / water-cooled condenser.** Hard-coded air-cooled. EnergyPlus supports `condenser_type: WaterCooled` with `CondenserLoop` and `CoolingTower:VariableSpeed`/`SingleSpeed`.
2. **Economizer (free cooling) modes.** `economizer_lockout: Yes` on the MVHR heat exchanger (`hvac_ventilation.py:157`). MVHR has it baked off; VRF doesn't expose an outside-air economiser at all.
3. **Latent / dehumidification control.** `dehumidification_control_type: None` for ideal loads; VRF coils are sensible-only via the curves we ship. `LatentLoadControl` is not modelled.
4. **DOAS coupling.** Currently MVHR supplies fixed-flow neutral air; there's no `AirLoopHVAC:OutdoorAirSystem` with a dedicated outdoor air unit for cooling-mode latent rejection.
5. **Variable cooling setpoint by occupancy.** Only `hotel_cooling_setpoint` (single weekly profile) is available.

### 2.6 Schedules / dependencies
- `hotel_cooling_setpoint` (Schedule:Compact, °C).
- Tightly coupled to Space Heating when both demands use the same VRF library entry (`isCombinedVRF` check at `SystemsZones.jsx:289` — `serves === 'heating_and_cooling'`).
- Heat rejection from cooling is shown as a Sankey "Heat Rejection" node in `instantCalc.js:597-600`, with a "Recovery opportunity: add ASHP preheat to DHW" hint.

---

## 3. Domestic Hot Water (DHW)

### 3.1 UI surface area
- **Component:** "DHW" `AccordionSection` at `SystemsZones.jsx:411-468`.
- **Visible fields:**
  - Primary system `<select>` filtered to `serves === 'dhw' && !name.includes('preheat')` (`SystemsZones.jsx:232-236`).
  - Primary efficiency slider — `Seasonal efficiency` (gas, 0.7–1.0) or `COP` (heat pump, 1.5–5.0).
  - Preheat (secondary) `<select>` — None / `ashp_dhw` / `solar_thermal_dhw` / `ashp_dhw_preheat`. Filter: `serves === 'dhw' && (type === 'ashp_dhw' || name.includes('solar') || name.includes('preheat'))`.
  - "ASHP heats 10→45°C · Boiler tops up to 60°C" italic green note when secondary present.
  - DHW setpoint number input (45–70°C, step 1).
  - Preheat setpoint number input (30–55°C, step 1) — only shown when secondary present.
  - Mini sparkline of `dhw` schedule.
- **Hidden:**
  - Tank volume (computed from peak flow ÷ 24, clamped ≥ 0.2 m³, `hvac_dhw.py:124-133`).
  - Heater capacity (computed from `peak_flow × ρ × Cp × ΔT × 1.25 / efficiency`, `hvac_dhw.py:136-150`).
  - Cold water inlet temp (hard-coded 10°C, `_COLD_WATER_TEMP_C`).
  - Tank ambient temp (hard-coded 20°C, `_SCHED_20C`).
  - Tank loss coefficients (both 0.0, `hvac_dhw.py:174-175, 218-219`).
  - Deadband (`2.0 K`).
  - Litres per room per day (`45.0`, `hvac_dhw.py:42`).
  - Sizing factor (`1.25`).

### 3.2 Data model
- **State key:** `systems.dhw.primary` and `systems.dhw.secondary` = `{ system, share, efficiency_override }`. Plus flat `systems.dhw_setpoint` (60), `systems.dhw_preheat_setpoint` (45).
- **Defaults:** `gas_boiler_dhw` primary, no secondary (`ProjectContext.jsx:86-90`).
- **Library entries:** `gas_boiler_dhw`, `ashp_dhw`, `ashp_dhw_preheat`, `electric_immersion`, `solar_thermal_dhw`. Each carries `efficiency_value`, `cop`, `hot_water_setpoint_c`, `preheat_setpoint_c`.
- **Schedule:** `hotel_dhw_demand` (Schedule:Compact, fractional 0–1).

### 3.3 Live calc
- `instantCalc.js:436-481`. Uses occupant-based DHW: `DHW_L_PER_PERSON_DAY = 26.6` × `avg_occupants` × 365 × `WATER_SHC` × (60-10) → kWh thermal.
- Reads `systems.dhw.primary` + `systems.dhw.secondary` (with flat-key fallback).
- Splits thermal demand by `share`, divides by `efficiency_override` → `dhw_gas_kWh` or `dhw_elec_kWh`. Renewable (solar) is counted as zero grid energy.
- Constants: `DHW_LITRES_PER_M2_DAY = 1.1`, `WATER_SHC = 4.18 / 3600 kWh/L/K`, `DHW_COLD_TEMP = 10`, `DHW_SETPOINT = 60`.

### 3.4 EnergyPlus emit
`generate_dhw_system` in `nza_engine/generators/hvac_dhw.py:229-326`:
- Always writes 4 `Schedule:Constant` objects: `DHW_Setpoint_60C`, `DHW_Preheat_Setpoint`, `DHW_Ambient_20C`, `DHW_ColdWater_10C`.
- **Gas-only path:** one `WaterHeater:Mixed` named `DHW_Gas_Boiler`, `heater_fuel_type: NaturalGas`, `heater_thermal_efficiency: <slider>`, `setpoint_temperature_schedule_name: DHW_Setpoint_60C`, `cold_water_supply_temperature_schedule_name: DHW_ColdWater_10C`, `peak_use_flow_rate: <calc>`, `use_flow_rate_fraction_schedule_name: hotel_dhw_demand`. Standalone (no plant loop).
- **ASHP-preheat path** ("two-tank cascade"): `DHW_ASHP_Preheat` (`heater_fuel_type: Electricity`, `heater_thermal_efficiency = COP` — EP allows >1 here to encode heat-pump COP) targeted at 45°C from 10°C cold water. `DHW_Gas_Boost` heats 45→60°C; the gas tank's `cold_water_supply_temperature_schedule_name` is set to `DHW_Preheat_Setpoint` so EP sees 45°C as its inlet. Tanks are NOT hydraulically connected — the cascade is simulated via the cold-water inlet schedule trick.
- Tank volume: 60% to ASHP, 40% to gas boost when cascade.
- Peak flow scaled by `num_bedrooms × occupancy_rate` when bedroom count is supplied (`hvac_dhw.py:82-122`); falls back to GIA-based estimate.

### 3.5 EP capability we're NOT using
1. **Recirculation losses.** Real hotel DHW circuits have continuous pumped recirculation (typically 10–20% of total DHW load). We don't model `WaterHeater:Sizing` with recirculation flow or any `Pipe:Indoor` losses.
2. **Stratified tank.** `WaterHeater:Mixed` is a single-node stirred tank. `WaterHeater:Stratified` would expose stratification, multiple inlets/outlets, and immersion heater placement effects.
3. **Heat-pump-water-heater with real coil.** `WaterHeater:HeatPump:PumpedCondenser` has explicit condenser coil, evaporator inlet conditions, COP-vs-temperature curve. We approximate by using `efficiency > 1` on a `WaterHeater:Mixed` — energy is correct but the COP is not temp-dependent.
4. **Real plant loop with primary/secondary pumps.** No `PlantLoop`, no `Pump:VariableSpeed`, no `SetpointManager:OutdoorAirReset` for the DHW circuit.
5. **Solar thermal with real collector.** Library has `solar_thermal_dhw` but the assembler doesn't emit `SolarCollector:FlatPlate:Water` + storage tank + plant loop. The instant calc just zeros out grid energy at solar fraction `0.5`.
6. **Tank standby / ambient losses.** `on_cycle_loss_coefficient_to_ambient_temperature: 0.0` and `off_cycle: 0.0` — set to zero. Real cylinders lose 1–2 W/K to plant rooms.
7. **Legionella thermal disinfection cycle.** No scheduled high-temperature flush.

### 3.6 Schedules / dependencies
- `hotel_dhw_demand` (Schedule:Compact, fractional, average ≈ 0.65 used in peak-flow inversion at `hvac_dhw.py:46`).
- Loosely coupled to occupancy via `num_bedrooms × occupancy_rate` peak flow scaling.
- Coupled to Space Heating only when both use a gas boiler (shared gas meter, separate plant).
- Recovery hint in Sankey: VRF heat-rejection → ASHP-DHW-preheat opportunity (`instantCalc.js:578-581`).

---

## 4. Mechanical Ventilation (MEV / MVHR)

### 4.1 UI surface area
- **Component:** "Ventilation" `AccordionSection` at `SystemsZones.jsx:471-500`.
- **Visible fields:**
  - System type `<select>` filtered to `serves === 'ventilation'`.
  - Specific fan power slider (`sfp_override`, 0–3.0 W/(l/s), step 0.1).
  - Heat recovery efficiency slider (`efficiency_override` on ventilation, 50–95%, step 1, only visible when `venSys.startsWith('mvhr')`).
  - Control strategy `<select>`: `continuous` / `occupied` / `timer` (`SystemsZones.jsx:256-260`).
  - Mini sparkline of `occupancy` schedule.
- **Hidden:**
  - Fresh-air rate per person (hard-coded `_FRESH_AIR_L_S_PER_PERSON = 8.0` in `hvac_ventilation.py:51`, also `_VENT_M3_PER_S_PER_PERSON = 0.008` in `epjson_assembler.py:77`).
  - Fan pressure rise (`250 Pa` MVHR, `150 Pa` MEV — `hvac_ventilation.py:167, 188, 341`).
  - Fan total efficiency (`0.7` MVHR, `0.5` MEV).
  - Sensible-vs-latent split (latent eff = 0 always).
  - 75%-flow effectiveness curve (computed as `min(eff_100 × 1.04, 0.97)`, `hvac_ventilation.py:130`).
  - Frost control (`frost_control_type: None`, threshold 1.7°C — disabled).

### 4.2 Data model
- **State key:** `systems.ventilation.primary` = `{ system, share, efficiency_override }`. Plus `systems.sfp_override` and `systems.ventilation_control`.
- **Defaults:** `mvhr_standard`, SFP 1.8, control `continuous` (`ProjectContext.jsx:91-95, 104`).
- **Library entries:** `mev_standard` (sfp 1.5, hre 0.0), `mvhr_standard` (sfp 1.8, hre 0.82). Both have `specific_fan_power` and `heat_recovery_efficiency` fields.
- **Schedule:** Currently always `hotel_ventilation_continuous`. The control-strategy dropdown writes to `systems.ventilation_control` but the assembler does NOT pick a different schedule based on it — `_VENT_AVAIL_SCHED = "hotel_ventilation_continuous"` is hard-coded in `hvac_ventilation.py:46`. The `hotel_ventilation_occupied` and `hotel_ventilation_timer` Schedule:Compact entries exist (`schedules.py:283-314`) but aren't wired up.

### 4.3 Live calc
- `instantCalc.js:305-316, 425-433`. Reads `systems.ventilation.primary.system` + `efficiency_override` (percentage 0–100, divided by 100 for fraction).
- Vent heat loss: `vent_kWh = AIR_HEAT_CAPACITY × vent_ach × volume × UK_HDD × 24 / 1000 × (1 - heat_recovery)`. `vent_ach` is hard-coded `0.5`.
- Fan electricity: `vent_fans_kWh = sfp_override × q_vent_ls × HOTEL_OPERATING_HOURS / 1000`.

### 4.4 EnergyPlus emit
`generate_ventilation_system` in `nza_engine/generators/hvac_ventilation.py:272-343`.

**MEV path** (`_mev_objects`, lines 56-81):
- One `ZoneVentilation:DesignFlowRate` per zone (`{zone}_MEV_Exhaust`), `ventilation_type: Exhaust`, `flow_rate_per_person: 0.008 m³/s`, `fan_pressure_rise: 150 Pa`, `fan_total_efficiency: 0.5`. Supply air sneaks in via the existing infiltration model.

**MVHR path** (`_mvhr_zone_objects`, lines 86-267):
- One `HeatExchanger:AirToAir:SensibleAndLatent` per zone (`{zone}_ERV_HX`), plate type, sensible-only, `frost_control_type: None`.
- Two `Fan:SystemModel` per zone (`_ERV_SupFan`, `_ERV_ExhFan`), `design_pressure_rise: 250 Pa`, `electric_power_per_unit_flow_rate_per_unit_pressure: 1.66667`.
- One `ZoneHVAC:EnergyRecoveryVentilator` per zone wrapping the HX + fans.
- One `OutdoorAir:Node` per zone for ERV supply inlet (`{zone}_ERV_OA_In`).
- Two `NodeList` per zone (inlet + exhaust) shared between VRF terminal unit and ERV supply/exhaust.
- Overrides the VRF-generated `ZoneHVAC:EquipmentList` to add the ERV at sequence 2 alongside the VRF TU at sequence 1.

### 4.5 EP capability we're NOT using
1. **Demand-controlled ventilation (DCV).** No CO₂- or occupancy-driven flow modulation. EnergyPlus has `Controller:MechanicalVentilation` + `DesignSpecification:OutdoorAir` with `outdoor_air_method: ProportionalControlBasedOnOccupancySchedule` and `Controller:OutdoorAir` with CO₂ setpoints.
2. **Frost protection.** `frost_control_type: None` — real MVHR units modulate or pre-heat below 0°C OA. EP supports `MinimumExhaustTemperature`, `ExhaustAirRecirculation`, electric pre-heater objects.
3. **Latent recovery (ERV).** `latent_effectiveness_*: 0.0` everywhere. Real enthalpy wheels recover 50–70% latent. Set `heat_exchanger_type: Rotary` + non-zero latent eff.
4. **Variable-speed fans / staged extract.** Both fans are single-speed (`number_of_speeds: 1`, `speed_control_method: Discrete` but only one entry). Pressure-driven boost during cooking / boost-button events not modelled.
5. **Mixing-box bypass for free cooling.** No summer bypass damper. Could be modelled with `economizer_lockout: No` plus a temperature controller.
6. **Different schedules for control strategy.** UI offers `continuous / occupied / timer` but only `hotel_ventilation_continuous` is plumbed. Wiring `ventilation_control` → schedule choice is one of the lowest-hanging fixes.

### 4.6 Schedules / dependencies
- `hotel_ventilation_continuous` (always-on) — hard-wired.
- `hotel_ventilation_occupied`, `hotel_ventilation_timer` — exist in library but not consumed.
- VRF terminal unit availability uses the ventilation schedule (`_VRF_AVAIL_SCHED = "hotel_ventilation_continuous"`, `hvac_vrf.py:36`) so VRF + MVHR are tightly coupled in node plumbing.
- `ZoneInfiltration:DesignFlowRate.schedule_name = "hotel_ventilation_continuous"` (`epjson_assembler.py:256`) — infiltration is also coupled.

---

## 5. Lighting

### 5.1 UI surface area
- **Component:** "Lighting" `AccordionSection` at `SystemsZones.jsx:503-525`.
- **Visible fields:**
  - LPD slider (0–20 W/m², step 0.5) — `systems.lighting_power_density`.
  - LPD presets: `LED` (4), `Fluor` (8), `Incan` (16) (`SystemsZones.jsx:264`).
  - Control strategy `<select>`: `manual` / `occupancy_sensing` / `daylight_dimming` (`SystemsZones.jsx:250-254`).
  - Mini sparkline of `lighting` schedule.
- **Older one-tab UI** (`LightingTab.jsx`, not the active route): same LPD slider + 4 control options including `occupancy_daylight`, plus an "Estimated lighting demand" panel using a baked `ANNUAL_HOURS = 3650` and `CONTROL_FACTOR` lookup (manual 1.0, occupancy 0.80, daylight 0.70, both 0.55).
- **Hidden:**
  - Schedule choice (`hotel_bedroom_lighting` from library zone-loads — `loads.py:47`).
  - Fraction radiant (0.32) / fraction visible (0.25) / return-air fraction (0.0) hard-coded in `epjson_assembler.py:222-223`.
  - The control-strategy value is stored in `systems.lighting_control` but NOT consumed by `epjson_assembler.py` — there is no `Daylighting:Controls` object emitted, no `Lights.fraction_replaceable` linked to occupancy. The dropdown is currently UI-only for the live calc.

### 5.2 Data model
- **State keys:** `systems.lighting_power_density` (default 8.0), `systems.lighting_control` (default `occupancy_sensing`).
- **Library entry per zone-type:** `loads.py:31-51` — `hotel_bedroom.lighting_power_density_W_per_m2 = 7.0`, `lighting_schedule = "hotel_bedroom_lighting"`. UI value overrides the library default via `lpd_override` parameter at `epjson_assembler.py:213`.
- **Schedule:** `hotel_bedroom_lighting` (Schedule:Compact). Library JSON form is in `_SCHEDULE_LIBRARY` at `schedules.py:508-524`.

### 5.3 Live calc
- `instantCalc.js:354-364`. `lighting_internal = lpd × gia × HOTEL_OPERATING_HOURS / 1000` where `HOTEL_OPERATING_HOURS = 2200`.
- The control-strategy is NOT applied in `instantCalc.js` — it's used only by the `LightingTab.jsx` legacy panel for its local "savings" display.

### 5.4 EnergyPlus emit
`_build_lights_objects` in `epjson_assembler.py:207-225`:
- One `Lights` object per zone (`{zone}_Lights`).
- `schedule_name: hotel_bedroom_lighting` (from `loads.py`).
- `design_level_calculation_method: Watts/Area`, `watts_per_floor_area: <slider>`.
- `return_air_fraction: 0.0`, `fraction_radiant: 0.32`, `fraction_visible: 0.25`. Remaining 43% is convective.
- Output meter: `InteriorLights:Electricity`.

### 5.5 EP capability we're NOT using
1. **Daylight-linked dimming.** No `Daylighting:Controls` reference points, no `Daylighting:ReferencePoint`, no DGI glare control. The Lighting object supports `daylight_lighting_control_type` linkage but we don't emit any.
2. **Occupancy-linked switching.** No `EnergyManagementSystem:Sensor` reading occupancy; no `Lights.fraction_replaceable_with_daylighting`. The control-strategy dropdown is cosmetic.
3. **Per-zone LPD.** Single LPD slider applies to all zones. EnergyPlus accepts per-zone Lights objects with different W/m². Corridors / public areas (which `loads.py` defines at 5–12 W/m²) are not separately modelled — we always treat the whole building as `hotel_bedroom`.
4. **Multiple lights objects per zone.** Could split task / ambient / exterior fixtures (`end_use_subcategory`) for sub-metering and tariff modelling.
5. **Time-of-use dimming based on grid carbon.** No EMS hooks.

### 5.6 Schedules / dependencies
- `hotel_bedroom_lighting` (Schedule:Compact). Coupled to occupancy implicitly via the `loads.py` zone-type bundle.
- Internal heat from lighting feeds the heat-balance gains stream (`Zone Lights Total Heating Energy` output variable).

---

## 6. Equipment / Plug Loads

### 6.1 UI surface area
- **Component:** "Small Power" `AccordionSection` at `SystemsZones.jsx:528-538`.
- **Visible fields:**
  - EPD slider (0–30 W/m², step 0.5).
  - Mini sparkline of `equipment` schedule.
  - Default helper text: "CIBSE Guide A hotel default: 15 W/m²".
- **No control strategy.** Plug loads have no UI for occupancy-sensors-on-sockets, no metered sub-circuits, no holiday mode.

### 6.2 Data model
- **State key:** `systems.equipment_power_density` (default 15.0).
- **Library entry per zone-type:** `loads.py:37` — `hotel_bedroom.equipment_power_density_W_per_m2 = 10.0`. The UI default 15.0 overrides this. Note the slight mismatch: UI default ≠ library default.
- **Schedule:** `hotel_bedroom_equipment` (Schedule:Compact, `loads.py:48`).

### 6.3 Live calc
- `instantCalc.js:355-363`. `equip_internal = epd × gia × HOTEL_EQUIP_HOURS × occupancy_rate / 1000` where `HOTEL_EQUIP_HOURS = 1800` and `occupancy_rate` comes from `building_params`.
- Annual energy: `equipment_kWh = epd × gia × HOTEL_EQUIP_HOURS / 1000` (without occupancy multiplier — annual total assumes the schedule integrates correctly).

### 6.4 EnergyPlus emit
`_build_equipment_objects` in `epjson_assembler.py:228-241`:
- One `ElectricEquipment` object per zone (`{zone}_Equip`).
- `schedule_name: hotel_bedroom_equipment` (from `loads.py`).
- `design_level_calculation_method: Watts/Area`, `watts_per_floor_area: <library default — UI override is NOT plumbed in here>`. Note: the library `loads.py` value of 10.0 is used, not `systems.equipment_power_density` — this is a known gap (the lights override goes through, equipment override doesn't).
- `fraction_radiant: 0.30`, `fraction_latent: 0.0`, `fraction_lost: 0.0`. Remaining 70% is convective.
- Output meter: `InteriorEquipment:Electricity`.

### 6.5 EP capability we're NOT using
1. **EPD slider doesn't reach EnergyPlus.** `_build_equipment_objects` doesn't accept an `epd_override` parameter — it always uses the `loads.py` value. The slider only changes the live-calc number, not the simulation result. (Compare with `_build_lights_objects`, which does accept `lpd_override`.)
2. **End-use subcategories.** Could split refrigeration / IT / cooking / room equipment via `end_use_subcategory` for separate metering and tariff modelling.
3. **Latent gains from equipment.** `fraction_latent: 0.0`. Cooking equipment, dishwashers, bathrooms have substantial latent contribution.
4. **Schedule-driven standby vs active power.** Single fractional schedule with peak EPD. Real plug loads have fixed standby (TVs, set-top boxes) plus occupancy-driven active power.
5. **Process loads (kitchens, laundry).** No `OtherEquipment` or `GasEquipment` objects for hotel kitchens / laundry — these can be major drivers and currently fall outside the model.
6. **Hot water tap as a `WaterUse:Equipment`.** The DHW path uses `WaterHeater:Mixed` standalone with a `peak_use_flow_rate`, which doesn't represent individual fixtures (taps, showers, basins).

### 6.6 Schedules / dependencies
- `hotel_bedroom_equipment` (Schedule:Compact). Coupled to occupancy via the `loads.py` zone-type bundle.
- Internal heat feeds zone gains (`Zone Electric Equipment Total Heating Energy`).

---

## Cross-references for the receiving Claude

Key files for system briefs:

| Concern | Path |
|---|---|
| UI inputs (canonical) | `frontend/src/components/modules/SystemsZones.jsx` |
| Legacy per-system tabs | `frontend/src/components/modules/systems/{HVAC,DHW,Ventilation,Lighting}Tab.jsx` |
| Live results panel | `frontend/src/components/modules/systems/SystemsLiveResults.jsx` |
| Sankey diagram | `frontend/src/components/modules/systems/SystemSankey.jsx` |
| Schedule preview & assignment | `frontend/src/components/modules/systems/SchedulePreview.jsx` |
| Library Browser system editor | `frontend/src/components/modules/library/SystemEditor.jsx` |
| Construction Inspector (gold standard) | `frontend/src/components/library/ConstructionInspector.jsx` |
| Glazing Inspector | `frontend/src/components/library/GlazingInspector.jsx` |
| Project state + migration | `frontend/src/context/ProjectContext.jsx` (DEFAULT_SYSTEMS at line 72, migrate at 113) |
| Live calc | `frontend/src/utils/instantCalc.js` (SYSTEM_DEFAULTS at line 18) |
| epJSON assembly entry | `nza_engine/generators/epjson_assembler.py` |
| VRF generator | `nza_engine/generators/hvac_vrf.py` |
| Gas baseboard + bivalent merge | `nza_engine/generators/hvac_heating_boiler.py` |
| MEV / MVHR generator | `nza_engine/generators/hvac_ventilation.py` |
| DHW generator | `nza_engine/generators/hvac_dhw.py` |
| System library | `nza_engine/library/systems.py` |
| Schedule library (Schedule:Compact + visual JSON) | `nza_engine/library/schedules.py` |
| Zone-type loads | `nza_engine/library/loads.py` |

All instant-calc constants (HDD, CDD, operating hours, solar irradiance, utilisation factor) are at the top of `instantCalc.js` lines 50-94.

---

## Per-system "Inspector" gold-standard parity table

What the Construction Inspector exposes today, and the equivalent slot for each system:

| Inspector feature | Constructions (today) | Space Heating | Cooling | DHW | Ventilation | Lighting | Equipment |
|---|---|---|---|---|---|---|---|
| Clickable badge → side panel | ✓ U-value badge | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Layer-by-layer breakdown | ✓ thickness × λ | n/a — rated COP only | n/a | n/a | n/a | n/a | n/a |
| Editable inputs | thickness, λ, Y-factor | only `efficiency_override` slider | only `efficiency_override` | `efficiency_override`, setpoints | `sfp_override`, `efficiency_override` | `lighting_power_density`, `lighting_control` (cosmetic) | `equipment_power_density` (cosmetic — not plumbed) |
| Save-as-copy | ✓ POST custom item | ✗ (only via Library Browser modal) | ✗ | ✗ | ✗ | n/a | n/a |
| Save in-place (custom only) | ✓ PUT | ✗ | ✗ | ✗ | ✗ | n/a | n/a |
| Real-time live calc impact | ✓ U + Y → simulation | ✓ COP slider | ✓ EER slider | ✓ COP / efficiency | ✓ SFP / HRE | ✓ LPD only | live-calc only — EP emit ignores |

The receiving Claude can use this table to scope each system brief: name the inspector, decide what fields go into the side-panel, and call out which gaps to close in the EnergyPlus emit on the way through.
