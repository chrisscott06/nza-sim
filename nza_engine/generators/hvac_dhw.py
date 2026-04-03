"""
nza_engine/generators/hvac_dhw.py

Generates EnergyPlus epJSON objects for domestic hot water (DHW) systems.

Supported configurations:
  gas_boiler_dhw  — single WaterHeater:Mixed, NaturalGas fuel
  ashp_dhw        — two-tank cascade: electric ASHP preheat tank → gas boost tank

Both modes use WaterHeater:Mixed in standalone mode (no plant loop connection).
EnergyPlus calculates energy from the use-flow schedule × peak flow × temperature rise
and reports it under WaterSystems:NaturalGas and/or WaterSystems:Electricity meters.

Two-tank cascade for ASHP preheat:
  Tank 1 (ASHP, electric):
    cold water enters at cold_water_temp (10°C)
    heats to preheat_setpoint (45°C)
    electricity = (45-10) / (60-10) fraction of total DHW energy × 1/ashp_cop
  Tank 2 (gas booster):
    "cold water" enters at preheat_setpoint (45°C)
    heats to delivery_setpoint (60°C)
    gas = (60-45) / (60-10) fraction of total DHW energy / boiler_efficiency

The two tanks are not hydraulically connected (standalone mode); each has a
separate cold_water_supply_temperature_schedule simulating the cascade effect.
This gives the correct energy split without requiring a full plant loop.

Reference: EnergyPlus I/O Reference — WaterHeater:Mixed
"""

from __future__ import annotations

# ── Constant schedule names (Schedule:Constant objects added to epJSON) ────────
_SCHED_60C   = "DHW_Setpoint_60C"       # 60°C delivery setpoint (legionella-safe)
_SCHED_45C   = "DHW_Preheat_Setpoint"   # 45°C ASHP preheat setpoint
_SCHED_20C   = "DHW_Ambient_20C"        # 20°C tank ambient (indoor plant room)
_SCHED_10C   = "DHW_ColdWater_10C"      # 10°C mains cold water (UK average annual)

# ── DHW demand / flow defaults ─────────────────────────────────────────────────
_DHW_DEMAND_SCHEDULE = "hotel_dhw_demand"   # fraction schedule (0-1) in library
_LITRES_PER_ROOM_PER_DAY = 45.0             # UK CIBSE Guide G hotel benchmark
_M2_PER_ROOM = 40.0                         # gross area per bedroom (for estimation)
_COLD_WATER_TEMP_C = 10.0                   # UK mains water (annual average)
# hotel_dhw_demand schedule: weighted average of all fractional values ≈ 0.65
# Used to invert: peak_flow = daily_volume / (avg_fraction × 86400 s/day)
_DHW_SCHEDULE_AVG_FRACTION = 0.65
_WATER_DENSITY_KG_M3 = 1000.0              # water density kg/m³
_WATER_CP_J_KG_K    = 4186.0               # specific heat capacity J/(kg·K)
_SIZING_FACTOR       = 1.25                # safety margin on heater capacity


def _constant_schedules() -> dict:
    """
    Build Schedule:Constant objects for DHW temperature setpoints.

    Using Schedule:Constant avoids conflicts with the existing Schedule:Compact
    entries in the model.  All four constants are always added — only some will
    be referenced depending on the DHW configuration chosen.
    """
    return {
        "Schedule:Constant": {
            _SCHED_60C: {
                "schedule_type_limits_name": "Temperature",
                "hourly_value": 60.0,
            },
            _SCHED_45C: {
                "schedule_type_limits_name": "Temperature",
                "hourly_value": 45.0,
            },
            _SCHED_20C: {
                "schedule_type_limits_name": "Temperature",
                "hourly_value": 20.0,
            },
            _SCHED_10C: {
                "schedule_type_limits_name": "Temperature",
                "hourly_value": 10.0,
            },
        }
    }


def _effective_rooms(
    zone_floor_area_m2: float,
    num_zones: int,
    num_bedrooms: int | None = None,
    occupancy_rate: float = 1.0,
) -> float:
    """
    Return effective occupied room count for DHW sizing.

    When num_bedrooms is supplied (from building params), scale it by
    occupancy_rate so that DHW demand reflects actual hotel occupancy.
    Falls back to GIA-based estimate when num_bedrooms is not available.
    """
    if num_bedrooms is not None and num_bedrooms > 0:
        return max(num_bedrooms * occupancy_rate, 1.0)
    gia_m2 = zone_floor_area_m2 * num_zones
    return max(gia_m2 / _M2_PER_ROOM, 5.0)


def _peak_flow_m3s(
    zone_floor_area_m2: float,
    num_zones: int,
    num_bedrooms: int | None = None,
    occupancy_rate: float = 1.0,
) -> float:
    """
    Estimate DHW peak use flow rate (m³/s) from building size.

    EnergyPlus computes: actual_flow = peak_flow × schedule_fraction × dt
    The schedule runs continuously with an average fraction of ~0.65.
    To achieve the target daily volume, set:
      peak_flow = daily_volume_m3 / (avg_schedule_fraction × 86400)

    When num_bedrooms is supplied, peak flow scales with actual occupied rooms
    rather than a GIA-based estimate, giving occupancy-sensitive DHW demand.
    """
    rooms = _effective_rooms(zone_floor_area_m2, num_zones, num_bedrooms, occupancy_rate)
    daily_m3 = rooms * _LITRES_PER_ROOM_PER_DAY / 1000.0
    peak_flow = daily_m3 / (_DHW_SCHEDULE_AVG_FRACTION * 86400.0)
    return round(peak_flow, 7)


def _tank_volume_m3(
    zone_floor_area_m2: float,
    num_zones: int,
    num_bedrooms: int | None = None,
    occupancy_rate: float = 1.0,
) -> float:
    """Estimate tank volume — approx 1 hour of peak demand (m³)."""
    rooms = _effective_rooms(zone_floor_area_m2, num_zones, num_bedrooms, occupancy_rate)
    daily_m3 = rooms * _LITRES_PER_ROOM_PER_DAY / 1000.0
    return round(max(daily_m3 / 24.0, 0.2), 3)


def _heater_capacity_w(
    peak_flow_m3s: float,
    delivery_temp_c: float,
    cold_water_temp_c: float,
    efficiency: float,
) -> float:
    """
    Calculate explicit heater capacity (W) from peak flow and temperature rise.

    Using Autosize requires a WaterHeater:Sizing companion object which adds
    complexity.  An explicit capacity is simpler and avoids that requirement.
    """
    temp_rise = delivery_temp_c - cold_water_temp_c
    thermal_power = peak_flow_m3s * _WATER_DENSITY_KG_M3 * _WATER_CP_J_KG_K * temp_rise
    return round(thermal_power / efficiency * _SIZING_FACTOR, 0)


def _gas_boiler_tank(
    name: str,
    peak_flow_m3s: float,
    tank_vol_m3: float,
    efficiency: float,
    setpoint_sched: str,
    cold_water_sched: str,
    delivery_temp_c: float = 60.0,
    cold_temp_c: float = _COLD_WATER_TEMP_C,
) -> dict:
    """Build a standalone NaturalGas WaterHeater:Mixed."""
    capacity_w = _heater_capacity_w(peak_flow_m3s, delivery_temp_c, cold_temp_c, efficiency)
    return {
        name: {
            "tank_volume":                   tank_vol_m3,
            "setpoint_temperature_schedule_name": setpoint_sched,
            "deadband_temperature_difference":    2.0,
            "heater_maximum_capacity":       capacity_w,
            "heater_minimum_capacity":       0.0,
            "heater_fuel_type":              "NaturalGas",
            "heater_thermal_efficiency":     efficiency,
            "on_cycle_loss_coefficient_to_ambient_temperature":  0.0,
            "off_cycle_loss_coefficient_to_ambient_temperature": 0.0,
            "ambient_temperature_indicator": "Schedule",
            "ambient_temperature_schedule_name": _SCHED_20C,
            "use_flow_rate_fraction_schedule_name": _DHW_DEMAND_SCHEDULE,
            "peak_use_flow_rate":            peak_flow_m3s,
            "cold_water_supply_temperature_schedule_name": cold_water_sched,
            # Standalone mode — no use-side or source-side node connections
        }
    }


def _ashp_preheat_tank(
    name: str,
    peak_flow_m3s: float,
    tank_vol_m3: float,
    ashp_cop: float,
    preheat_setpoint_sched: str,
    cold_water_sched: str,
    preheat_temp_c: float = 45.0,
    cold_temp_c: float = _COLD_WATER_TEMP_C,
) -> dict:
    """
    Build a standalone Electricity WaterHeater:Mixed representing an ASHP preheat.

    The ASHP COP is modelled as thermal_efficiency > 1.0 (EnergyPlus allows this
    for water heaters to represent heat pump performance — input energy is
    electrical, output is thermal at the COP multiple).
    """
    # Capacity: enough to heat from cold water to preheat setpoint at peak demand
    # Thermal efficiency = COP → EnergyPlus uses (thermal_output / efficiency) as electric input
    # We want: elec_input = thermal_output / COP, so set efficiency = COP
    capacity_w = _heater_capacity_w(peak_flow_m3s, preheat_temp_c, cold_temp_c, ashp_cop)
    return {
        name: {
            "tank_volume":                   tank_vol_m3,
            "setpoint_temperature_schedule_name": preheat_setpoint_sched,
            "deadband_temperature_difference":    2.0,
            "heater_maximum_capacity":       capacity_w,
            "heater_minimum_capacity":       0.0,
            "heater_fuel_type":              "Electricity",
            # Thermal efficiency = COP for heat pump representation.
            # EnergyPlus accepts efficiency > 1.0 for this purpose.
            "heater_thermal_efficiency":     ashp_cop,
            "on_cycle_loss_coefficient_to_ambient_temperature":  0.0,
            "off_cycle_loss_coefficient_to_ambient_temperature": 0.0,
            "ambient_temperature_indicator": "Schedule",
            "ambient_temperature_schedule_name": _SCHED_20C,
            "use_flow_rate_fraction_schedule_name": _DHW_DEMAND_SCHEDULE,
            "peak_use_flow_rate":            peak_flow_m3s,
            "cold_water_supply_temperature_schedule_name": cold_water_sched,
        }
    }


def generate_dhw_system(
    zone_floor_area_m2: float,
    num_zones: int,
    num_bedrooms: int | None = None,
    occupancy_rate: float = 1.0,
    dhw_primary: str = "gas_boiler_dhw",
    dhw_preheat: str = "none",
    boiler_efficiency: float = 0.92,
    dhw_setpoint: float = 60.0,
    dhw_preheat_setpoint: float = 45.0,
    ashp_cop: float = 2.8,
) -> dict:
    """
    Generate DHW system epJSON objects.

    Parameters
    ----------
    zone_floor_area_m2 : float
        Floor area per zone (m²) — used to estimate bedrooms and peak flow.
    num_zones : int
        Number of zones (floors) in the building.
    dhw_primary : str
        Primary DHW system: "gas_boiler_dhw".
    dhw_preheat : str
        Optional preheat: "ashp_dhw" or "none".
    boiler_efficiency : float
        Gas boiler thermal efficiency (0–1).  Default 0.92.
    dhw_setpoint : float
        DHW delivery temperature (°C).  Default 60°C (legionella-safe).
    dhw_preheat_setpoint : float
        ASHP preheat target temperature (°C).  Default 45°C.
    ashp_cop : float
        Heat pump COP for DHW preheat (dimensionless).  Default 2.8.

    Returns
    -------
    dict
        epJSON object type → instance dict.  Includes Schedule:Constant objects
        for temperature setpoints.  Merge into hvac_objects using:
            for obj_type, items in dhw_objects.items():
                hvac_objects.setdefault(obj_type, {}).update(items)
    """
    peak_flow = _peak_flow_m3s(zone_floor_area_m2, num_zones, num_bedrooms, occupancy_rate)
    tank_vol  = _tank_volume_m3(zone_floor_area_m2, num_zones, num_bedrooms, occupancy_rate)

    result: dict = {}

    # Always add constant temperature schedules
    for obj_type, items in _constant_schedules().items():
        result.setdefault(obj_type, {}).update(items)

    # ── Primary: gas boiler ───────────────────────────────────────────────────
    # Gas heats from cold water inlet temperature to delivery setpoint.
    # When ASHP preheat is active, the "cold water" entering the gas tank is
    # already at preheat_setpoint (simulated via cold_water_supply_temperature).
    if dhw_preheat == "ashp_dhw":
        # ASHP tank: cold mains → preheat_setpoint (electricity at COP)
        ashp_tank = _ashp_preheat_tank(
            name="DHW_ASHP_Preheat",
            peak_flow_m3s=peak_flow,
            tank_vol_m3=tank_vol * 0.6,
            ashp_cop=ashp_cop,
            preheat_setpoint_sched=_SCHED_45C,
            cold_water_sched=_SCHED_10C,
            preheat_temp_c=dhw_preheat_setpoint,
            cold_temp_c=_COLD_WATER_TEMP_C,
        )
        result.setdefault("WaterHeater:Mixed", {}).update(ashp_tank)

        # Gas booster tank: preheat_setpoint → delivery_setpoint
        # "Cold water" entering the gas tank is already at preheat setpoint
        gas_tank = _gas_boiler_tank(
            name="DHW_Gas_Boost",
            peak_flow_m3s=peak_flow,
            tank_vol_m3=tank_vol * 0.4,
            efficiency=boiler_efficiency,
            setpoint_sched=_SCHED_60C,
            cold_water_sched=_SCHED_45C,
            delivery_temp_c=dhw_setpoint,
            cold_temp_c=dhw_preheat_setpoint,
        )
        result.setdefault("WaterHeater:Mixed", {}).update(gas_tank)

    else:
        # Gas-only: cold mains → delivery_setpoint
        gas_tank = _gas_boiler_tank(
            name="DHW_Gas_Boiler",
            peak_flow_m3s=peak_flow,
            tank_vol_m3=tank_vol,
            efficiency=boiler_efficiency,
            setpoint_sched=_SCHED_60C,
            cold_water_sched=_SCHED_10C,
            delivery_temp_c=dhw_setpoint,
            cold_temp_c=_COLD_WATER_TEMP_C,
        )
        result.setdefault("WaterHeater:Mixed", {}).update(gas_tank)

    return result
