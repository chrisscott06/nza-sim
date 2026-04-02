# HVAC Implementation Notes — Brief 07

**Date:** 2026-04-02
**EnergyPlus version:** 25.2.0 (`/Applications/EnergyPlus-25-2-0/`)
**Purpose:** Object selection and connection sketch for detailed HVAC mode

---

## Context

Current simulation uses `ZoneHVAC:IdealLoadsAirSystem` — this provides ideal heating/cooling with no equipment-level detail. Brief 07 adds a "detailed HVAC mode" that uses real system objects with COP curves, fan energy, and fuel-specific DHW. This is what makes MVHR, ASHP, and VRF show their real benefit vs. ideal loads.

The assembler (`nza_engine/generators/epjson_assembler.py`) already accepts `systems_config` — we extend `_build_hvac_*` to branch on `systems_config["mode"]`.

---

## Decision: HVACTemplate vs Native Objects

**HVACTemplate objects ARE in the epJSON schema** (`Energy+.schema.epJSON` confirms `HVACTemplate:Zone:VRF`, `HVACTemplate:System:VRF`, etc.). However:

- The existing assembler has a comment: "(not HVACTemplate which needs ExpandObjects)"
- The runner (`runner.py`) calls EnergyPlus directly — no ExpandObjects step
- ExpandObjects exists at `/Applications/EnergyPlus-25-2-0/ExpandObjects` but is not called

**Decision: Use native objects throughout.** HVACTemplate requires a pre-processing step we don't have wired up. Native objects are more explicit, more debuggable, and work directly in the epJSON pipeline.

---

## System Objects by HVAC Mode

### 1. VRF (Variable Refrigerant Flow)

**Not using:** `HVACTemplate:Zone:VRF` / `HVACTemplate:System:VRF` (requires ExpandObjects)

**Using:** `ZoneHVAC:PackagedTerminalHeatPump` (PTHP) as VRF surrogate

Why PTHP as surrogate:
- Native object — no expansion needed
- Has DX cooling + DX heating coils with COP inputs
- Per-zone, matches VRF zonal topology
- Supports cooling/heating COP that reflects VRF performance
- Simpler than assembling `AirConditioner:VariableRefrigerantFlow` + `ZoneHVAC:TerminalUnit:VariableRefrigerantFlow` (which requires 20+ objects)

Object chain per zone:
```
ZoneHVAC:PackagedTerminalHeatPump
  ├── Fan:SystemModel (supply)
  ├── Coil:Cooling:DX:SingleSpeed (with COP curve)
  ├── Coil:Heating:DX:SingleSpeed (with COP curve)
  └── Coil:Heating:Electric (supplemental, minimal capacity)
ZoneHVAC:EquipmentList → links to zone
ZoneHVAC:EquipmentConnections → air nodes
```

Performance curves: Use EnergyPlus default curves (CapFT, EIRFT, EIRFPLR) — these give realistic COP degradation at part load and off-design temperatures. Rated COP from `systems_config["cop_cooling"]` / `["cop_heating"]`.

---

### 2. MVHR (Mechanical Ventilation with Heat Recovery)

**Using:** `ZoneHVAC:EnergyRecoveryVentilator` + `HeatExchanger:AirToAir:SensibleAndLatent` + two `Fan:SystemModel`

Why:
- All native, no expansion
- `ZoneHVAC:EnergyRecoveryVentilator` is purpose-built for balanced ventilation with heat recovery
- `HeatExchanger:AirToAir:SensibleAndLatent` takes explicit sensible/latent effectiveness inputs — directly maps to MVHR efficiency from `systems_config["heat_recovery_efficiency"]`

Object chain per zone:
```
ZoneHVAC:EnergyRecoveryVentilator
  ├── HeatExchanger:AirToAir:SensibleAndLatent
  │     sensible_effectiveness_at_100_percent_heating_air_flow = heat_recovery_efficiency
  │     sensible_effectiveness_at_100_percent_cooling_air_flow = heat_recovery_efficiency
  ├── Fan:SystemModel (supply — inlet side)
  └── Fan:SystemModel (exhaust — outlet side)
ZoneHVAC:EquipmentList → links to zone
```

Flow rate: from `systems_config["ventilation_rate_l_s_m2"]` × zone floor area, converted to m³/s.

Note: `ZoneHVAC:EnergyRecoveryVentilator` does **not** condition the supply air (no heating/cooling coil). It must be paired with the space conditioning system (PTHP or IdealLoads).

---

### 3. MEV (Mechanical Extract Ventilation)

**Using:** `Fan:ZoneExhaust` + `ZoneVentilation:DesignFlowRate` (supply air from infiltration/natural)

Why:
- Minimal object count — MEV is just an exhaust fan, supply is uncontrolled
- `Fan:ZoneExhaust` is native and simple: zone name, flow rate, fan efficiency, pressure rise
- Supply handled by existing `ZoneVentilation:DesignFlowRate` (already in assembler)

Object chain per zone:
```
Fan:ZoneExhaust
  zone_name = zone
  fan_total_efficiency = 0.5
  pressure_rise = 150 Pa
  maximum_flow_rate = ventilation_flow_m3_s
ZoneVentilation:DesignFlowRate (supply, natural, existing object)
```

No heat recovery — that's the point of MEV.

---

### 4. Natural Ventilation

No new objects. Existing `ZoneVentilation:DesignFlowRate` with `ventilation_type = Natural` continues to be used. No fan energy. No heat recovery.

---

### 5. Gas Boiler DHW

**Using:** `WaterHeater:Mixed` with `NaturalGas` fuel

Required fields confirmed in schema:
- `setpoint_temperature_schedule_name` — schedule at 60°C (legionella safe)
- `heater_fuel_type` = `NaturalGas`
- `heater_thermal_efficiency` — from `systems_config["dhw_efficiency"]` (e.g. 0.88)
- `ambient_temperature_indicator` = `Schedule` + a 20°C ambient schedule

Supporting objects:
```
WaterHeater:Mixed
  heater_fuel_type = NaturalGas
  heater_thermal_efficiency = dhw_efficiency
  setpoint_temperature_schedule_name = DHW_Setpoint_60C
  tank_volume = 0.5 m³ (per zone, or lumped for building)
  use_side_effectiveness = 1.0
  source_side_effectiveness = 1.0
Schedule:Compact (DHW_Setpoint_60C) → constant 60°C
Schedule:Compact (DHW_Ambient_20C) → constant 20°C
```

Results: EnergyPlus reports `Water Heater NaturalGas Energy` — this will appear as gas consumption in results, enabling fuel split.

---

### 6. ASHP DHW Preheat

**Approach:** Two-tank cascade
- Tank 1: `WaterHeater:Mixed` with `Electricity`, high efficiency (represents heat pump, COP ~2.5–3.5)
- Tank 2: `WaterHeater:Mixed` with `NaturalGas`, low setpoint (backup booster if needed)

Why not `WaterHeater:HeatPump:WrappedCondenser`:
- Requires `Coil:WaterHeating:AirToWaterHeatPump:Pumped` + `Fan:SystemModel` + air node connections
- Complex to assemble correctly from parametric inputs
- Two-tank approximation gives correct energy split with minimal objects
- Can be upgraded to full HPWH in a future brief

```
WaterHeater:Mixed (ASHP_preheat)
  heater_fuel_type = Electricity
  heater_thermal_efficiency = cop_dhw (e.g. 3.0, treated as COP)
  setpoint_temperature_schedule_name = DHW_Preheat_50C

WaterHeater:Mixed (Gas_boost)
  heater_fuel_type = NaturalGas
  heater_thermal_efficiency = 0.88
  setpoint_temperature_schedule_name = DHW_Setpoint_60C
  source_side_inlet/outlet → from preheat tank use-side
```

---

### 7. Fan Objects

**Using:** `Fan:SystemModel` throughout (replaces older `Fan:ConstantVolume`, `Fan:VariableVolume`)

Why:
- Single object covers constant and variable speed
- Explicit motor efficiency, fan efficiency, pressure rise
- Results reported as `Fan Electricity Energy` — trackable per end use

Standard parameters:
```
Fan:SystemModel
  design_maximum_air_flow_rate = Autosize
  speed_control_method = Discrete (constant speed) or Continuous (VAV)
  electric_power_minimum_flow_rate_fraction = 0.25
  design_pressure_rise = 300 Pa (supply fan)
  motor_efficiency = 0.9
  fan_total_efficiency = 0.6
```

---

## Assembler Extension Plan

```python
def assemble_epjson(building_params, construction_choices, weather_file_path,
                    output_path=None, systems_config=None, schedule_overrides=None):
    ...
    mode = (systems_config or {}).get("mode", "ideal_loads")

    if mode == "ideal_loads":
        hvac = _build_hvac_ideal_loads(zones)
    else:
        hvac = _build_hvac_detailed(zones, systems_config)

    epjson.update(hvac)
```

`_build_hvac_detailed(zones, systems_config)` branches on:
- `systems_config["hvac_type"]` → "vrf", "ashp", "gas_boiler" → PTHP with appropriate COPs
- `systems_config["ventilation_type"]` → "mvhr", "mev", "natural" → ERV/exhaust/natural
- `systems_config["dhw_type"]` → "gas", "ashp" → WaterHeater:Mixed config

---

## Results Parsing Extension

New meter names to parse from EnergyPlus output:
| End use | EnergyPlus meter | Fuel |
|---------|-----------------|------|
| Cooling (VRF) | `Cooling:Electricity` | Electricity |
| Heating (VRF) | `Heating:Electricity` | Electricity |
| Fans (MVHR supply) | `Fans:Electricity` | Electricity |
| DHW (gas) | `WaterSystems:NaturalGas` | Gas |
| DHW (ASHP) | `WaterSystems:Electricity` | Electricity |

These will populate `results.fuel_split` → `{electricity_kWh, gas_kWh}` used by the frontend fuel toggle.

---

## What's NOT in Scope (Brief 07)

- Full AirConditioner:VariableRefrigerantFlow system (40+ objects) — PTHP surrogate is sufficient
- Ground source heat pump
- District heating
- Multi-zone air handling units (VAV boxes, AHU)
- Radiant floor heating
- Chiller plant

---

## Key Risks

1. **PTHP as VRF surrogate**: EUI will be close but not identical to a real VRF system. Clearly labelled as "simplified VRF" in UI.
2. **DHW loop**: EnergyPlus plant loop for DHW requires `PlantLoop`, `Pump:ConstantSpeed`, `SetpointManager`. The two-tank approach avoids this but may not reflect standby losses accurately.
3. **ExpandObjects not called**: Confirmed decision to avoid HVACTemplate. If we later need it, runner.py needs a pre-processing step: `subprocess.run([expandobjects_bin], cwd=output_dir)` before the main EnergyPlus call.
4. **Autosize**: Using Autosize for coil and fan capacities. EnergyPlus will size from design day. Must confirm design day is correctly specified in epJSON.

---

## File Locations

| File | Role |
|------|------|
| `nza_engine/generators/epjson_assembler.py` | Extend `_build_hvac_*` functions |
| `nza_engine/generators/hvac_detailed.py` | New module: `_build_hvac_detailed()` |
| `nza_engine/generators/dhw.py` | New module: `_build_dhw()` |
| `nza_engine/parsers/results_parser.py` | Extend to parse fuel-split meters |
| `api/simulate.py` | Pass `mode` from request to assembler |
| `frontend/src/components/modules/systems/HVACTab.jsx` | Add mode toggle (Ideal / Detailed) |
| `frontend/src/components/modules/scenarios/ScenarioEditor.jsx` | Expose mode in scenario params |
