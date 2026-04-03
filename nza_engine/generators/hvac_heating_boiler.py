"""
nza_engine/generators/hvac_heating_boiler.py

Generates EnergyPlus epJSON objects for a gas-fired space heating system.
Uses ZoneHVAC:Baseboard:Convective:Gas — one per zone — which is equivalent
to a central gas boiler delivering heat to each zone via convective baseboard.

This is the correct EnergyPlus approach for "gas boiler" space heating without
building a full hot water plant loop. The energy accounting is identical: total
building gas consumption = sum of zone-level baseboard gas inputs.

EnergyPlus objects generated
-----------------------------
ZoneHVAC:Baseboard:Convective:Gas  — per zone (the heater itself)
ZoneHVAC:EquipmentList             — per zone (baseboard listed as heating-only)
ZoneHVAC:EquipmentConnections      — per zone (zone air node wiring)
ThermostatSetpoint:DualSetpoint    — per zone
ZoneControl:Thermostat             — per zone
"""

from __future__ import annotations


def generate_gas_baseboard_system(
    zone_names: list[str],
    efficiency: float = 0.92,
) -> dict:
    """
    Generate a gas-fired convective baseboard heating system for each zone.

    Parameters
    ----------
    zone_names : list[str]
        EnergyPlus zone names (must match zones in geometry).
    efficiency : float
        Gas burner efficiency, 0–1 (default 0.92 = condensing boiler).

    Returns
    -------
    dict
        epJSON-compatible dict with the following object types:
        - ZoneHVAC:Baseboard:Convective:Gas
        - ZoneHVAC:EquipmentList
        - ZoneHVAC:EquipmentConnections
        - ThermostatSetpoint:DualSetpoint
        - ZoneControl:Thermostat
    """
    baseboard_obj  = {}
    equip_lists    = {}
    equip_conns    = {}
    thermostats    = {}
    zone_controls  = {}

    for zone_name in zone_names:
        bb_name    = f"{zone_name}_GasBaseboard"
        list_name  = f"{zone_name}_EquipList"
        air_node   = f"{zone_name}_Air"
        # ZoneHVAC:EquipmentConnections still needs return/supply nodes even for
        # a purely-convective heater. EnergyPlus handles the zone air mass balance.
        supply_node = f"{zone_name}_Supply"
        return_node = f"{zone_name}_Return"
        tstat_name  = f"{zone_name}_DualSetpoint"
        ctrl_name   = f"{zone_name}_TstatCtrl"

        # Gas baseboard unit ─────────────────────────────────────────────────
        baseboard_obj[bb_name] = {
            "availability_schedule_name": "hotel_ventilation_continuous",
            "nominal_capacity": "Autosize",
            "efficiency": round(float(efficiency), 4),
            # Fraction radiant: 30% of heat delivered as radiation (ASHRAE)
            "fraction_radiant": 0.30,
        }

        # Equipment list: heating_sequence=1, cooling_sequence=0 (gas baseboard
        # never handles cooling — the zone relies on VRF or free cooling for that)
        equip_lists[list_name] = {
            "load_distribution_scheme": "SequentialLoad",
            "equipment": [
                {
                    "zone_equipment_object_type":
                        "ZoneHVAC:Baseboard:Convective:Gas",
                    "zone_equipment_name":
                        bb_name,
                    "zone_equipment_cooling_sequence":
                        0,
                    "zone_equipment_heating_or_no_load_sequence":
                        1,
                }
            ],
        }

        # Equipment connections (zone air node wiring)
        equip_conns[f"{zone_name}_EquipConn"] = {
            "zone_name": zone_name,
            "zone_conditioning_equipment_list_name": list_name,
            "zone_air_inlet_node_or_nodelist_name":  supply_node,
            "zone_air_node_name":                    air_node,
            "zone_return_air_node_or_nodelist_name": return_node,
        }

        # Thermostat setpoints
        thermostats[tstat_name] = {
            "heating_setpoint_temperature_schedule_name": "hotel_heating_setpoint",
            "cooling_setpoint_temperature_schedule_name": "hotel_cooling_setpoint",
        }

        # Zone thermostat control
        zone_controls[ctrl_name] = {
            "zone_or_zonelist_name":           zone_name,
            "control_type_schedule_name":      "ThermostatControlType_DualSetpoint",
            "control_1_object_type":           "ThermostatSetpoint:DualSetpoint",
            "control_1_name":                  tstat_name,
        }

    return {
        "ZoneHVAC:Baseboard:Convective:Gas": baseboard_obj,
        "ZoneHVAC:EquipmentList":            equip_lists,
        "ZoneHVAC:EquipmentConnections":     equip_conns,
        "ThermostatSetpoint:DualSetpoint":   thermostats,
        "ZoneControl:Thermostat":            zone_controls,
    }


def add_vrf_cooling_to_baseboard(
    baseboard_objects: dict,
    vrf_objects: dict,
) -> dict:
    """
    Merge VRF cooling objects into an existing gas-baseboard setup.

    When space heating = gas boiler AND space cooling = VRF, we need both
    systems in each zone's equipment list:
      - Gas baseboard handles heating (heating_seq=1, cooling_seq=0)
      - VRF terminal unit handles cooling (cooling_seq=1, heating_seq=0)

    This function merges the two sets of objects, combining the equipment
    lists so each zone has both pieces of equipment.

    Parameters
    ----------
    baseboard_objects : dict
        Output of generate_gas_baseboard_system().
    vrf_objects : dict
        Output of generate_vrf_system() — VRF is expected in cooling-only mode
        (provide_heating=False), so its equipment list entries have heating_seq=0.

    Returns
    -------
    dict
        Merged epJSON objects with combined equipment lists.
    """
    import copy
    merged = copy.deepcopy(baseboard_objects)

    for obj_type, items in vrf_objects.items():
        if obj_type == "ZoneHVAC:EquipmentList":
            # Merge VRF equipment entries into each zone's existing equipment list
            for list_name, vrf_equip_data in items.items():
                if list_name in merged.get("ZoneHVAC:EquipmentList", {}):
                    existing = merged["ZoneHVAC:EquipmentList"][list_name]
                    existing_items = existing.get("equipment", [])
                    vrf_items = vrf_equip_data.get("equipment", [])
                    existing["equipment"] = existing_items + vrf_items
                else:
                    merged.setdefault("ZoneHVAC:EquipmentList", {})[list_name] = vrf_equip_data
        elif obj_type in (
            "ZoneHVAC:EquipmentConnections",
            "ThermostatSetpoint:DualSetpoint",
            "ZoneControl:Thermostat",
        ):
            # These come from baseboard — skip VRF duplicates (same names)
            pass
        else:
            # All other object types (coils, fans, VRF outdoor unit, curves, etc.)
            merged.setdefault(obj_type, {}).update(items)

    return merged
