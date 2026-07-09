"""
nza_engine/generators/hvac_heating_boiler.py

Generates EnergyPlus epJSON objects for a gas-fired space-heating system.

Brief 98-pre (2026-07-09): the previous implementation emitted
`ZoneHVAC:Baseboard:Convective:Gas`, which **does not exist in the EnergyPlus
25.2.0 schema** (valid convective baseboards are `:Water` and `:Electric` only —
there is no gas convective baseboard object). Every gas-heated building fatalled
at input processing. See docs/audit/98pre_gas_heating_fix.md.

Replacement: a per-zone **`ZoneHVAC:UnitHeater`** driven by a
**`Coil:Heating:Fuel`** (fuel = NaturalGas) and a constant-volume fan. This is a
self-contained zone gas heater — no hot-water plant loop — that EnergyPlus
validates and runs. Gas fuel accounting is exact: total building gas = Σ zone
fuel-coil input / burner efficiency. (Difference vs the old intent: a warm-air
unit heater adds a small supply-fan electricity term where a wet baseboard would
not — documented, negligible at these flow rates. The wet alternative
`Boiler:HotWater` + `ZoneHVAC:Baseboard:Convective:Water` needs a full plant loop,
for which nza_engine has no scaffolding yet.)

EnergyPlus objects generated (all present in Energy+.schema.epJSON 25.2.0)
--------------------------------------------------------------------------
Coil:Heating:Fuel               — per zone (the gas burner)
Fan:ConstantVolume              — per zone (supply fan)
ZoneHVAC:UnitHeater             — per zone (the unit itself)
ZoneHVAC:EquipmentList          — per zone
ZoneHVAC:EquipmentConnections   — per zone (incl. the zone exhaust node the unit draws from)
ThermostatSetpoint:DualSetpoint — per zone
ZoneControl:Thermostat          — per zone
"""

from __future__ import annotations


def generate_gas_heating_system(
    zone_names: list[str],
    efficiency: float = 0.92,
) -> dict:
    """
    Generate a gas-fired ZoneHVAC:UnitHeater (fuel coil + fan) per zone.

    Parameters
    ----------
    zone_names : list[str]
        EnergyPlus zone names (must match zones in geometry).
    efficiency : float
        Gas burner efficiency, 0–1 (default 0.92 = condensing boiler).

    Returns
    -------
    dict
        epJSON-compatible dict keyed by EnergyPlus object type.
    """
    fuel_coils    = {}
    fans          = {}
    unit_heaters  = {}
    equip_lists   = {}
    equip_conns   = {}
    thermostats   = {}
    zone_controls = {}

    # Gas burner efficiency must be ≤ 1.0. If the caller passes a value > 1 (a
    # COP/SCOP mistakenly routed here from a mislabelled config — the exact
    # gas/VRF confusion Brief 98-pre found), fall back to a condensing-boiler
    # default rather than emit an object EnergyPlus rejects.
    eff = float(efficiency)
    eff = round(eff if 0.0 < eff <= 1.0 else 0.92, 4)

    for zone_name in zone_names:
        uh_name    = f"{zone_name}_GasUnitHeater"
        coil_name  = f"{zone_name}_GasCoil"
        fan_name   = f"{zone_name}_GasFan"
        list_name  = f"{zone_name}_EquipList"
        air_node   = f"{zone_name}_Air"
        return_node = f"{zone_name}_Return"
        tstat_name = f"{zone_name}_DualSetpoint"
        ctrl_name  = f"{zone_name}_TstatCtrl"

        # Node chain: zone exhaust → fan → coil → zone supply
        exhaust_node = f"{zone_name}_UH_Inlet"    # zone air the unit draws from
        fan_out_node = f"{zone_name}_UH_FanOut"   # fan → coil
        supply_node  = f"{zone_name}_UH_Supply"   # coil → zone (unit outlet)

        # Supply fan (constant volume) ───────────────────────────────────────
        fans[fan_name] = {
            "availability_schedule_name": "hotel_ventilation_continuous",
            "fan_total_efficiency": 0.7,
            "pressure_rise": 75.0,               # Pa — low, a terminal unit heater
            "maximum_flow_rate": "Autosize",
            "motor_efficiency": 0.9,
            "motor_in_airstream_fraction": 1.0,
            "air_inlet_node_name": exhaust_node,
            "air_outlet_node_name": fan_out_node,
        }

        # Gas heating coil ───────────────────────────────────────────────────
        fuel_coils[coil_name] = {
            "availability_schedule_name": "hotel_ventilation_continuous",
            "fuel_type": "NaturalGas",
            "burner_efficiency": eff,
            "nominal_capacity": "Autosize",
            "air_inlet_node_name": fan_out_node,
            "air_outlet_node_name": supply_node,
        }

        # Unit heater (fan + fuel coil) ──────────────────────────────────────
        unit_heaters[uh_name] = {
            "availability_schedule_name": "hotel_ventilation_continuous",
            "air_inlet_node_name": exhaust_node,
            "air_outlet_node_name": supply_node,
            "supply_air_fan_object_type": "Fan:ConstantVolume",
            "supply_air_fan_name": fan_name,
            "maximum_supply_air_flow_rate": "Autosize",
            "heating_coil_object_type": "Coil:Heating:Fuel",
            "heating_coil_name": coil_name,
            # Fan cycles with the heating call (no continuous fan when idle).
            "supply_air_fan_operation_during_no_heating": "No",
        }

        # Equipment list: heating only (cooling handled by VRF/free cooling).
        equip_lists[list_name] = {
            "load_distribution_scheme": "SequentialLoad",
            "equipment": [
                {
                    "zone_equipment_object_type": "ZoneHVAC:UnitHeater",
                    "zone_equipment_name": uh_name,
                    "zone_equipment_cooling_sequence": 0,
                    "zone_equipment_heating_or_no_load_sequence": 1,
                }
            ],
        }

        # Equipment connections — the exhaust node is what the unit draws from.
        equip_conns[f"{zone_name}_EquipConn"] = {
            "zone_name": zone_name,
            "zone_conditioning_equipment_list_name": list_name,
            "zone_air_inlet_node_or_nodelist_name":  supply_node,
            "zone_air_exhaust_node_or_nodelist_name": exhaust_node,
            "zone_air_node_name":                    air_node,
            "zone_return_air_node_or_nodelist_name": return_node,
        }

        # Thermostat setpoints + control (unchanged from the prior version).
        thermostats[tstat_name] = {
            "heating_setpoint_temperature_schedule_name": "hotel_heating_setpoint",
            "cooling_setpoint_temperature_schedule_name": "hotel_cooling_setpoint",
        }
        zone_controls[ctrl_name] = {
            "zone_or_zonelist_name":      zone_name,
            "control_type_schedule_name": "ThermostatControlType_DualSetpoint",
            "control_1_object_type":      "ThermostatSetpoint:DualSetpoint",
            "control_1_name":             tstat_name,
        }

    return {
        "Coil:Heating:Fuel":               fuel_coils,
        "Fan:ConstantVolume":              fans,
        "ZoneHVAC:UnitHeater":             unit_heaters,
        "ZoneHVAC:EquipmentList":          equip_lists,
        "ZoneHVAC:EquipmentConnections":   equip_conns,
        "ThermostatSetpoint:DualSetpoint": thermostats,
        "ZoneControl:Thermostat":          zone_controls,
    }


# Back-compat alias: the assembler historically imported this name.
generate_gas_baseboard_system = generate_gas_heating_system


def add_vrf_cooling_to_baseboard(
    heating_objects: dict,
    vrf_objects: dict,
) -> dict:
    """
    Merge VRF cooling objects into an existing gas-heating (unit-heater) setup:
    the gas unit heater handles heating (heating_seq=1, cooling_seq=0); a VRF
    terminal unit is added to each zone's equipment list for cooling
    (cooling_seq=1, heating_seq=0). EquipmentConnections / thermostats stay from
    the heating side (same node names / one thermostat per zone).
    """
    import copy
    merged = copy.deepcopy(heating_objects)

    for obj_type, items in vrf_objects.items():
        if obj_type == "ZoneHVAC:EquipmentList":
            for list_name, vrf_equip_data in items.items():
                if list_name in merged.get("ZoneHVAC:EquipmentList", {}):
                    existing = merged["ZoneHVAC:EquipmentList"][list_name]
                    existing["equipment"] = existing.get("equipment", []) + vrf_equip_data.get("equipment", [])
                else:
                    merged.setdefault("ZoneHVAC:EquipmentList", {})[list_name] = vrf_equip_data
        elif obj_type in (
            "ZoneHVAC:EquipmentConnections",
            "ThermostatSetpoint:DualSetpoint",
            "ZoneControl:Thermostat",
        ):
            # Kept from the heating side — skip VRF duplicates (same names).
            pass
        else:
            merged.setdefault(obj_type, {}).update(items)

    return merged
