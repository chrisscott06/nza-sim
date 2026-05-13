"""
nza_engine/generators/epjson_assembler.py

Assembles a complete, valid EnergyPlus epJSON file from:
  - Parametric building geometry (Part 2)
  - Fabric construction library (Part 3)
  - Hotel schedules and loads library (Part 4)

The geometry generator uses placeholder construction names (EXT_WALL, ROOF, etc.).
This assembler substitutes those with real construction names from the library,
merges all epJSON object types into a single dict, and writes the result to disk.

Usage
-----
    from nza_engine.generators.epjson_assembler import assemble_epjson

    path = assemble_epjson(
        building_params={...},
        construction_choices={
            "external_wall": "cavity_wall_standard",
            "roof": "flat_roof_standard",
            "ground_floor": "ground_floor_slab",
            "glazing": "double_low_e",
        },
        weather_file_path="/path/to/weather.epw",
        output_path="data/simulations/test/input.epJSON",
    )
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from nza_engine.generators.geometry import (
    generate_building_geometry,
    PLACEHOLDER_EXT_WALL,
    PLACEHOLDER_ROOF,
    PLACEHOLDER_GROUND_FLOOR,
    PLACEHOLDER_GLAZING,
    PLACEHOLDER_INT_FLOOR_CEIL,
)
from nza_engine.library.constructions import get_construction
from nza_engine.library.schedules import (
    get_all_schedules,
    get_schedule_type_limits,
    library_schedule_to_compact,
    v23_schedule_to_compact,
)
from nza_engine.library.loads import get_zone_loads
from nza_engine.generators.hvac_vrf import generate_vrf_system
from nza_engine.generators.hvac_ventilation import generate_ventilation_system
from nza_engine.generators.hvac_dhw import generate_dhw_system
from nza_engine.generators.hvac_heating_boiler import (
    generate_gas_baseboard_system,
    add_vrf_cooling_to_baseboard,
)


# ── Construction placeholder → construction_choices key ───────────────────────
_PLACEHOLDER_TO_CHOICE = {
    PLACEHOLDER_EXT_WALL:      "external_wall",
    PLACEHOLDER_ROOF:          "roof",
    PLACEHOLDER_GROUND_FLOOR:  "ground_floor",
    PLACEHOLDER_GLAZING:       "glazing",
    PLACEHOLDER_INT_FLOOR_CEIL: "interior_floor_ceiling",
}

# Interior floor/ceiling always uses the same library construction
_INTERIOR_CONSTRUCTION = "interior_floor_ceiling"

# Default infiltration rate (ACH) — can be overridden via building_params
DEFAULT_INFILTRATION_ACH = 0.5

# Ventilation (fresh air) design flow per person — m³/s
# Bedrooms: 8 l/s/person = 0.008 m³/s/person
_VENT_M3_PER_S_PER_PERSON = 0.008


def _deep_merge(base: dict, overlay: dict) -> dict:
    """Recursively merge overlay into base (overlay wins on conflict)."""
    result = dict(base)
    for key, value in overlay.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def _parse_epw_location(epw_path: Path) -> dict:
    """
    Extract site location from EPW file header line 1.

    EPW header format (comma-separated):
      LOCATION, city, state, country, data_source, WMO, lat, lon, tz_offset, elevation
    """
    try:
        with open(epw_path, "r", errors="replace") as f:
            first_line = f.readline().strip()
        parts = first_line.split(",")
        if len(parts) >= 10 and parts[0].strip().upper() == "LOCATION":
            return {
                "name": parts[1].strip(),
                "latitude": float(parts[6]),
                "longitude": float(parts[7]),
                "time_zone": float(parts[8]),
                "elevation": float(parts[9]),
            }
    except Exception:
        pass
    # Fallback — UK generic
    return {
        "name": "Default UK Site",
        "latitude": 51.5,
        "longitude": -0.1,
        "time_zone": 0.0,
        "elevation": 10.0,
    }


def _substitute_constructions(
    surfaces: dict,
    windows: dict,
    choices: dict[str, str],
) -> None:
    """
    Replace placeholder construction names in surfaces and windows in-place.

    choices maps: "external_wall" → "cavity_wall_standard" etc.
    Interior floor/ceiling uses the fixed _INTERIOR_CONSTRUCTION name.
    """
    placeholder_map: dict[str, str] = {
        PLACEHOLDER_EXT_WALL:      choices.get("external_wall",  "cavity_wall_standard"),
        PLACEHOLDER_ROOF:          choices.get("roof",           "flat_roof_standard"),
        PLACEHOLDER_GROUND_FLOOR:  choices.get("ground_floor",   "ground_floor_slab"),
        PLACEHOLDER_INT_FLOOR_CEIL: _INTERIOR_CONSTRUCTION,
    }
    glazing_name = choices.get("glazing", "double_low_e")

    for surface in surfaces.values():
        ph = surface.get("construction_name", "")
        if ph in placeholder_map:
            surface["construction_name"] = placeholder_map[ph]

    for window in windows.values():
        if window.get("construction_name") == PLACEHOLDER_GLAZING:
            window["construction_name"] = glazing_name


def _collect_construction_epjson(construction_names: set[str]) -> dict:
    """
    Retrieve epJSON material/construction dicts for all used constructions.
    Returns a merged dict of Material, Material:NoMass, WindowMaterial, Construction.
    """
    merged: dict[str, dict] = {
        "Material": {},
        "Material:NoMass": {},
        "WindowMaterial:SimpleGlazingSystem": {},
        "Construction": {},
    }
    for name in construction_names:
        data = get_construction(name)
        for section in merged:
            merged[section].update(data.get(section, {}))
    return merged


def _build_people_objects(
    zones: dict,
    zone_type: str = "hotel_bedroom",
    density_override: float | None = None,
) -> dict:
    """
    Build EnergyPlus People objects for each zone.

    Parameters
    ----------
    zones : dict
        Zone names to create People objects for.
    zone_type : str
        Library zone type (default "hotel_bedroom").
    density_override : float | None
        If provided, use this occupancy density (people/m²) instead of the
        library default.  Computed from: avg_occupants / GIA where
        avg_occupants = num_bedrooms × occupancy_rate × people_per_room.
    """
    loads = get_zone_loads(zone_type)
    density = density_override if density_override is not None else loads["occupancy_density_people_per_m2"]
    # Guard against zero density
    density = max(density, 1e-4)

    people = {}
    for zone_name in zones:
        people[f"{zone_name}_People"] = {
            "zone_or_zonelist_or_space_or_spacelist_name": zone_name,
            "number_of_people_schedule_name": loads["occupancy_schedule"],
            "number_of_people_calculation_method": "People/Area",
            "people_per_floor_area": round(density, 6),
            "fraction_radiant": 0.30,
            "sensible_heat_fraction": 1.0 - loads["latent_fraction"],
            "activity_level_schedule_name": "hotel_bedroom_occupancy",
        }
    return people


def _build_lights_objects(
    zones: dict,
    zone_type: str = "hotel_bedroom",
    lpd_override: float | None = None,
) -> dict:
    loads = get_zone_loads(zone_type)
    lpd = lpd_override if lpd_override is not None else loads["lighting_power_density_W_per_m2"]
    lights = {}
    for zone_name in zones:
        lights[f"{zone_name}_Lights"] = {
            "zone_or_zonelist_or_space_or_spacelist_name": zone_name,
            "schedule_name": loads["lighting_schedule"],
            "design_level_calculation_method": "Watts/Area",
            "watts_per_floor_area": lpd,
            "return_air_fraction": 0.0,
            "fraction_radiant": 0.32,
            "fraction_visible": 0.25,
        }
    return lights


def _build_equipment_objects(
    zones: dict,
    zone_type: str = "hotel_bedroom",
    epd_override: float | None = None,
) -> dict:
    loads = get_zone_loads(zone_type)
    epd = epd_override if epd_override is not None else loads["equipment_power_density_W_per_m2"]
    equip = {}
    for zone_name in zones:
        equip[f"{zone_name}_Equip"] = {
            "zone_or_zonelist_or_space_or_spacelist_name": zone_name,
            "schedule_name": loads["equipment_schedule"],
            "design_level_calculation_method": "Watts/Area",
            "watts_per_floor_area": epd,
            "fraction_radiant": 0.30,
            "fraction_latent": 0.00,
            "fraction_lost": 0.00,
        }
    return equip


def _build_infiltration_objects(
    zones: dict, building_length: float, building_width: float,
    floor_height: float, ach: float = DEFAULT_INFILTRATION_ACH,
) -> dict:
    """
    Build ZoneInfiltration:DesignFlowRate objects for each zone.
    Uses AirChanges/Hour method.
    """
    infiltration = {}
    for zone_name in zones:
        infiltration[f"{zone_name}_Infiltration"] = {
            "zone_or_zonelist_or_space_or_spacelist_name": zone_name,
            "schedule_name": "hotel_ventilation_continuous",  # overridable via ventilation schedule assignment
            "design_flow_rate_calculation_method": "AirChanges/Hour",
            "air_changes_per_hour": ach,
        }
    return infiltration


def _build_openings_objects(zones: dict, building_params: dict, state1: bool = False) -> dict:
    """
    Build ZoneVentilation:WindAndStackOpenArea objects from the per-facade
    openings schema (building_params['openings']).

    Two streams emitted per zone (when non-zero):
      - <zone>_OpeningsLouvre   — always-open louvre area, AlwaysOnDiscrete schedule
      - <zone>_OpeningsWindow   — operable window area, schedule per user choice

    Zone area allocation: louvre/window areas are facade totals; we split them
    evenly across the zones (one zone per floor) so each floor receives a
    proportional share. Stack term is suppressed (single-zone passive model —
    cross-flow is not modelled until rooms are split into separate zones).

    State 1 mode (Brief 26 Part 5): forces the openable-window stream to
    zero. Operable windows are a State 2.5 input — at State 1 they must not
    contribute, regardless of params.openings.openable_fraction. Louvres
    (permanent envelope geometry) are kept.
    """
    openings = building_params.get("openings") or {}
    if not openings:
        return {}

    faces = ("north", "south", "east", "west")
    louvre_total   = sum(float((openings.get(f) or {}).get("louvre_area_m2", 0) or 0)   for f in faces)
    openable_total = 0.0 if state1 else sum(
        float((openings.get(f) or {}).get("openable_fraction", 0) or 0)
        * float((building_params.get("wwr") or {}).get(f, 0))
        # Facade glazing area per face = wwr × facade_area
        * 2.0 * (
            (float(building_params.get("length", 60))) if f in ("north", "south")
            else (float(building_params.get("width", 15)))
        )
        * float(building_params.get("floor_height", 3.0)) * float(building_params.get("num_floors", 1))
        for f in faces
    )

    n_zones = max(1, len(zones))
    louvre_per_zone   = round(louvre_total   / n_zones, 3)
    openable_per_zone = round(openable_total / n_zones, 3)

    schedule_choice = openings.get("schedule", "never")
    # Map UI schedule → EnergyPlus schedule reference. We emit a constant
    # always-on schedule (`openings_always_on` = 1.0) ourselves and reuse the
    # existing hotel_bedroom_occupancy for "occupied".
    if schedule_choice == "always":
        window_sched = "openings_always_on"
    elif schedule_choice in ("occupied", "summer_day"):
        # No dedicated summer-day schedule yet — the operating fraction is
        # already cold-shoulder driven by occupancy, which is good enough.
        window_sched = "hotel_bedroom_occupancy"
    else:
        window_sched = None  # 'never' — don't emit the window object

    common = dict(
        opening_effectiveness="Autocalculate",
        effective_angle=90.0,
        height_difference=0.0,                # stack term off — single-zone, single-sided
        discharge_coefficient_for_opening=0.6,
        minimum_indoor_temperature=-100.0,
        maximum_indoor_temperature=100.0,
        minimum_outdoor_temperature=-100.0,
        maximum_outdoor_temperature=100.0,
        maximum_wind_speed=40.0,
    )

    out: dict = {}
    for zone_name in zones:
        if louvre_per_zone > 0:
            out[f"{zone_name}_OpeningsLouvre"] = {
                "zone_or_space_name": zone_name,
                "opening_area": louvre_per_zone,
                "opening_area_fraction_schedule_name": "openings_always_on",
                **common,
            }
        if window_sched is not None and openable_per_zone > 0:
            out[f"{zone_name}_OpeningsWindow"] = {
                "zone_or_space_name": zone_name,
                "opening_area": openable_per_zone,
                "opening_area_fraction_schedule_name": window_sched,
                **common,
            }
    return out


def _build_hvac_ideal_loads(zones: dict, state1: bool = False) -> tuple[dict, dict, dict, dict, dict]:
    """
    Build native ZoneHVAC:IdealLoadsAirSystem HVAC objects for each zone.

    Returns 5 dicts for the epJSON:
      - ZoneHVAC:IdealLoadsAirSystem
      - ZoneHVAC:EquipmentList
      - ZoneHVAC:EquipmentConnections
      - ThermostatSetpoint:DualSetpoint
      - ZoneControl:Thermostat
    """
    ideal_loads   = {}
    equip_lists   = {}
    equip_conns   = {}
    thermostats   = {}
    zone_controls = {}

    for zone_name in zones:
        supply_node = f"{zone_name}_Supply"
        return_node = f"{zone_name}_Return"
        air_node    = f"{zone_name}_Air"
        equip_name  = f"{zone_name}_IdealLoads"
        list_name   = f"{zone_name}_EquipList"
        tstat_name  = f"{zone_name}_DualSetpoint"
        ctrl_name   = f"{zone_name}_TstatCtrl"

        # ZoneHVAC:IdealLoadsAirSystem — perfect system, no real HVAC effects
        ideal_loads[equip_name] = {
            "zone_supply_air_node_name": supply_node,
            "maximum_heating_supply_air_temperature": 50.0,
            "minimum_cooling_supply_air_temperature": 13.0,
            "maximum_heating_supply_air_humidity_ratio": 0.0156,
            "minimum_cooling_supply_air_humidity_ratio": 0.0077,
            "heating_limit": "NoLimit",
            "cooling_limit": "NoLimit",
            "dehumidification_control_type": "None",
            "humidification_control_type": "None",
        }

        # ZoneHVAC:EquipmentList
        equip_lists[list_name] = {
            "load_distribution_scheme": "SequentialLoad",
            "equipment": [
                {
                    "zone_equipment_object_type": "ZoneHVAC:IdealLoadsAirSystem",
                    "zone_equipment_name": equip_name,
                    "zone_equipment_cooling_sequence": 1,
                    "zone_equipment_heating_or_no_load_sequence": 1,
                }
            ],
        }

        # ZoneHVAC:EquipmentConnections
        equip_conns[f"{zone_name}_EquipConn"] = {
            "zone_name": zone_name,
            "zone_conditioning_equipment_list_name": list_name,
            "zone_air_inlet_node_or_nodelist_name": supply_node,
            "zone_air_node_name": air_node,
            "zone_return_air_node_or_nodelist_name": return_node,
        }

        # ThermostatSetpoint:DualSetpoint
        # In State 1 envelope-only mode we point the thermostat at wide
        # Schedule:Constant setpoints (5°C heating / 50°C cooling) so the
        # Ideal Loads system never engages within realistic UK weather. The
        # zone runs free against the envelope.
        thermostats[tstat_name] = {
            "heating_setpoint_temperature_schedule_name":
                "state1_heating_setpoint" if state1 else "hotel_heating_setpoint",
            "cooling_setpoint_temperature_schedule_name":
                "state1_cooling_setpoint" if state1 else "hotel_cooling_setpoint",
        }

        # ZoneControl:Thermostat
        zone_controls[ctrl_name] = {
            "zone_or_zonelist_name": zone_name,
            "control_type_schedule_name": "ThermostatControlType_DualSetpoint",
            "control_1_object_type": "ThermostatSetpoint:DualSetpoint",
            "control_1_name": tstat_name,
        }

    return ideal_loads, equip_lists, equip_conns, thermostats, zone_controls


def _build_sizing_objects(zones: dict) -> dict:
    """
    Build zone sizing objects needed for detailed HVAC mode (VRF, etc.).

    ZoneHVAC:IdealLoadsAirSystem can autosize without these objects,
    but Fan:SystemModel and VRF coils require Sizing:Zone + design days.

    Uses conservative UK/Northern-Europe design conditions:
      Heating: -5°C OA (worst-case winter), Cooling: 32°C OA (peak summer)
    """
    # Shared outdoor air design spec (8 l/s/person for hotel bedrooms)
    dsoa = {}
    for zone_name in zones:
        dsoa[f"{zone_name}_DSOA"] = {
            "outdoor_air_method": "Flow/Person",
            "outdoor_air_flow_per_person": _VENT_M3_PER_S_PER_PERSON,
        }

    # Zone sizing (one entry per zone)
    sizing_zone = {}
    for zone_name in zones:
        sizing_zone[f"{zone_name}_Sizing"] = {
            "zone_or_zonelist_name": zone_name,
            "zone_cooling_design_supply_air_temperature": 14.0,
            "zone_heating_design_supply_air_temperature": 40.0,
            "zone_cooling_design_supply_air_humidity_ratio": 0.009,
            "zone_heating_design_supply_air_humidity_ratio": 0.004,
            "design_specification_outdoor_air_object_name": f"{zone_name}_DSOA",
            "zone_heating_sizing_factor": 1.25,
            "zone_cooling_sizing_factor": 1.15,
        }

    # Design days — conservative European values
    design_days = {
        "Heating Design Day": {
            "month": 1, "day_of_month": 21,
            "day_type": "WinterDesignDay",
            "maximum_dry_bulb_temperature": -5.0,
            "daily_dry_bulb_temperature_range": 0.0,
            "humidity_condition_type": "WetBulb",
            "wetbulb_or_dewpoint_at_maximum_dry_bulb": -5.0,
            "barometric_pressure": 101325.0,
            "wind_speed": 3.0,
            "wind_direction": 270.0,
            "solar_model_indicator": "ASHRAEClearSky",
            "sky_clearness": 0.0,
        },
        "Cooling Design Day": {
            "month": 7, "day_of_month": 21,
            "day_type": "SummerDesignDay",
            "maximum_dry_bulb_temperature": 32.0,
            "daily_dry_bulb_temperature_range": 11.0,
            "humidity_condition_type": "WetBulb",
            "wetbulb_or_dewpoint_at_maximum_dry_bulb": 22.0,
            "barometric_pressure": 101325.0,
            "wind_speed": 3.5,
            "wind_direction": 270.0,
            "solar_model_indicator": "ASHRAEClearSky",
            "sky_clearness": 1.0,
        },
    }

    return {
        "DesignSpecification:OutdoorAir": dsoa,
        "Sizing:Zone": sizing_zone,
        "SizingPeriod:DesignDay": design_days,
    }


def _output_variables() -> dict:
    """
    Build Output:Variable request objects for key simulation outputs.
    Timestep = Hourly to keep file sizes manageable.
    """
    vars_to_request = [
        # Zone temperatures — both air and operative. Air drives conduction
        # losses (UA × (T_air − T_out)); operative is what occupants feel
        # and is the right index for comfort-band hour counts. Used by the
        # State 1 parser to derive demand and underheat/comfort/overheat.
        "Zone Mean Air Temperature",
        "Zone Operative Temperature",
        "Zone Ideal Loads Supply Air Total Heating Energy",
        "Zone Ideal Loads Supply Air Total Cooling Energy",
        "Zone People Occupant Count",
        "Zone People Total Heating Energy",         # internal gain from occupants
        "Zone Lights Electricity Energy",
        "Zone Lights Total Heating Energy",         # actual heat dumped to zone (often == elec)
        "Zone Electric Equipment Electricity Energy",
        "Zone Electric Equipment Total Heating Energy",  # heat to zone from equipment
        "Zone Hot Water Equipment Electricity Energy",   # DHW if modeled as hot water equip
        "Zone Infiltration Sensible Heat Loss Energy",
        "Zone Infiltration Sensible Heat Gain Energy",
        "Zone Ventilation Sensible Heat Loss Energy",    # mechanical vent heat loss
        "Zone Ventilation Sensible Heat Gain Energy",    # mechanical vent heat gain
        "Fan Electricity Energy",                        # fan energy (if fan objects present)
        "Surface Inside Face Conduction Heat Transfer Energy",
        # Diagnostics for shading investigation (Brief 26.2):
        # Sunlit Fraction is the textbook indicator — drops below 1.0 when
        # any external shading geometry obstructs the surface. Incident Solar
        # is the next step downstream — drops proportionally to Sunlit Fraction
        # when shading is being applied to the radiation calculation.
        "Surface Outside Face Sunlit Fraction",
        "Surface Outside Face Incident Solar Radiation Rate per Area",
        # Solar gains — use Energy (J) which works with SimpleGlazingSystem.
        # Rate (W) is not generated with simplified glazing in EP 25.2.
        "Zone Windows Total Transmitted Solar Radiation Energy",
        "Surface Window Transmitted Solar Radiation Energy",
        "Zone Ideal Loads Heat Recovery Total Heating Energy",
        "Zone Ideal Loads Heat Recovery Total Cooling Energy",
        # Gas convective baseboard (ZoneHVAC:Baseboard:Convective:Gas)
        "Baseboard Gas Energy",
        "Baseboard Total Heating Energy",
        "Baseboard Electricity Energy",
    ]
    result = {}
    for i, var in enumerate(vars_to_request, start=1):
        result[f"OutputVar_{i:02d}_{var.replace(' ', '_')[:30]}"] = {
            "key_value": "*",
            "variable_name": var,
            "reporting_frequency": "Hourly",
        }
    return result


def _output_meters() -> dict:
    """Build Output:Meter objects for facility-level totals."""
    meters = [
        "Electricity:Facility",
        "Gas:Facility",
        "NaturalGas:Facility",
        "Heating:EnergyTransfer",
        "Cooling:EnergyTransfer",
        "InteriorLights:Electricity",
        "InteriorEquipment:Electricity",
        "Fans:Electricity",
        "Cooling:Electricity",
        "Heating:Electricity",
        "WaterSystems:Electricity",
        "WaterSystems:NaturalGas",
    ]
    result = {}
    for i, meter in enumerate(meters, start=1):
        result[f"OutputMeter_{i:02d}_{meter.split(':')[0]}"] = {
            "key_name": meter,
            "reporting_frequency": "Hourly",
        }
    return result


## Map schedule_type → default Schedule:Compact name(s) used in the model
_SCHEDULE_TYPE_TO_DEFAULT_NAME: dict[str, str] = {
    "occupancy":        "hotel_bedroom_occupancy",
    "lighting":         "hotel_bedroom_lighting",
    "equipment":        "hotel_bedroom_equipment",
    "heating_setpoint": "hotel_heating_setpoint",
    "cooling_setpoint": "hotel_cooling_setpoint",
    "dhw":              "hotel_dhw_demand",
    "ventilation":      "hotel_ventilation_continuous",  # controls infiltration/vent rate
}


# ── Brief 27 Part 3 — State 2 (envelope + internal gains) helpers ───────────
#
# State 2 emits People/Lights/ElectricEquipment using:
#   - Density values computed from `building_config.occupancy.*` and
#     `building_config.gains.*` (v2.3 contract)
#   - Custom Schedule:Compact objects derived from each gain's
#     `relationship_to_occupancy` + the v2.3 schedule shape
#
# Schedule semantics mirror the live engine (frontend/src/utils/instantCalc.js
# `_calculateState2` + `lightingFractionForHour` / `equipmentFractionForHour`):
#
#   independent           — pure lighting/equipment schedule lookup
#   always_on             — constant 1.0
#   proportional          — occupancy schedule × occupancy_rate, with floor
#                           (standby_factor for equipment)
#   proportional_with_spill — lighting's own schedule × occupancy_rate, with
#                             daylight dimming during 09:00–16:00
#
# Equipment baseload is emitted as a SEPARATE ElectricEquipment object with
# an always-on schedule, mirroring the live engine's "baseload is occupancy-
# independent" semantics. Total equipment = baseload (24/7) + active (scheduled).


def _v23_compute_occupancy_density(building_params: dict, gia_m2: float) -> float:
    """
    People density (people/m²) from v2.3 occupancy block.

    Handles density.basis = per_room | per_m2 | total | per_workstation.
    Multiplies by occupancy_rate so the EP density already encodes both the
    headcount-at-100% and the average occupancy fraction. Schedule emits
    the per-hour presence (no further occupancy_rate scaling).
    """
    occ = building_params.get("occupancy") or {}
    d = occ.get("density") or {"value": 1.5, "basis": "per_room"}
    value = float(d.get("value", 1.5) or 0)
    basis = d.get("basis", "per_room")
    rate = float(occ.get("occupancy_rate", 0.75) or 0.75)
    nrooms = int(building_params.get("num_bedrooms", 0) or 0)

    if basis == "per_room":
        total = nrooms * value
    elif basis == "per_m2":
        total = gia_m2 * value
    elif basis == "total":
        total = value
    elif basis == "per_workstation":
        # Schema doesn't carry a workstation count yet — treat value as total.
        total = value
    else:
        total = nrooms * value

    if gia_m2 <= 0:
        return 0.0
    return (total * rate) / gia_m2


def _v23_magnitude_to_w_per_m2(magnitude: dict, building_params: dict, gia_m2: float) -> float:
    """Convert {value, unit} → W/m² of GIA. Mirrors live engine helper."""
    if not magnitude:
        return 0.0
    v = float(magnitude.get("value", 0) or 0)
    unit = magnitude.get("unit", "w_per_m2")
    nrooms = int(building_params.get("num_bedrooms", 0) or 0)
    if unit == "w_per_m2":
        return v
    if unit == "w_per_room":
        return v * nrooms / max(1.0, gia_m2)
    if unit == "total_w":
        return v / max(1.0, gia_m2)
    return v


def _v23_derived_lighting_schedule(building_params: dict) -> dict:
    """
    Build a Schedule:Compact representing the lighting fraction for each
    hour, accounting for relationship_to_occupancy. The fraction is
    'fraction of installed LPD that's drawing power'.

    `proportional_with_spill` (default) — lighting schedule × occupancy_rate,
    with daylight dimming during 09:00–16:00 (hour indices 9..16 inclusive).

    `proportional` — occupancy schedule × occupancy_rate (no daylight dim;
    lights only on when somebody walks in).

    `independent` — pure lighting schedule (no occupancy scaling).

    `always_on` — constant 1.0 across all hours.
    """
    occ = building_params.get("occupancy") or {}
    occ_rate = float(occ.get("occupancy_rate", 0.75) or 0.75)
    occ_sched = occ.get("schedule") or {}

    gains = building_params.get("gains") or {}
    lighting = gains.get("lighting") or {}
    rel = lighting.get("relationship_to_occupancy", "proportional_with_spill")
    lsched = lighting.get("schedule") or occ_sched
    daylight = float(lighting.get("daylight_factor", 0.6) or 0.6)

    def _flat_24(value: float) -> list[float]:
        return [value] * 24

    if rel == "always_on":
        wk = sa = su = _flat_24(1.0)
        mm = [1.0] * 12
        excs = []
    elif rel == "independent":
        wk = list(lsched.get("weekday", _flat_24(0.0)))
        sa = list(lsched.get("saturday", wk))
        su = list(lsched.get("sunday", wk))
        mm = list(lsched.get("monthly_multipliers", [1.0] * 12))
        excs = list(lsched.get("exceptions", []) or [])
    elif rel == "proportional":
        wk_o = occ_sched.get("weekday", _flat_24(0.0))
        sa_o = occ_sched.get("saturday", wk_o)
        su_o = occ_sched.get("sunday", wk_o)
        wk = [min(1.0, v * occ_rate) for v in wk_o]
        sa = [min(1.0, v * occ_rate) for v in sa_o]
        su = [min(1.0, v * occ_rate) for v in su_o]
        mm = list(occ_sched.get("monthly_multipliers", [1.0] * 12))
        excs = list(occ_sched.get("exceptions", []) or [])
    else:  # proportional_with_spill (default)
        wk_l = list(lsched.get("weekday", _flat_24(0.0)))
        sa_l = list(lsched.get("saturday", wk_l))
        su_l = list(lsched.get("sunday", wk_l))
        # Apply occupancy_rate scaling + daylight dimming (9..16 inclusive).
        def _apply(arr):
            out = []
            for h, v in enumerate(arr):
                f = float(v) * occ_rate
                if 9 <= h <= 16 and daylight < 1:
                    f *= daylight
                out.append(min(1.0, f))
            return out
        wk = _apply(wk_l)
        sa = _apply(sa_l)
        su = _apply(su_l)
        mm = list(lsched.get("monthly_multipliers", [1.0] * 12))
        excs = list(lsched.get("exceptions", []) or [])

    return v23_schedule_to_compact(
        weekday=wk, saturday=sa, sunday=su,
        monthly_multipliers=mm, exceptions=excs,
        schedule_type="lighting",
    )


def _v23_derived_equipment_active_schedule(building_params: dict) -> dict:
    """
    Active-equipment fraction schedule. Baseload is emitted as a separate
    ElectricEquipment object with a constant always-on schedule.

    `proportional` (default) — max(standby_factor, equipment_schedule × occupancy_rate).
    `independent` — pure equipment schedule.
    """
    occ = building_params.get("occupancy") or {}
    occ_rate = float(occ.get("occupancy_rate", 0.75) or 0.75)
    occ_sched = occ.get("schedule") or {}

    gains = building_params.get("gains") or {}
    equipment = gains.get("equipment") or {}
    rel = equipment.get("relationship_to_occupancy", "proportional")
    esched = equipment.get("schedule") or occ_sched
    standby = float(equipment.get("standby_factor", 0.10) or 0)

    def _flat_24(v):
        return [v] * 24

    if rel == "independent":
        wk = list(esched.get("weekday", _flat_24(0.0)))
        sa = list(esched.get("saturday", wk))
        su = list(esched.get("sunday", wk))
        mm = list(esched.get("monthly_multipliers", [1.0] * 12))
        excs = list(esched.get("exceptions", []) or [])
    else:  # proportional (default)
        wk_e = list(esched.get("weekday", _flat_24(0.0)))
        sa_e = list(esched.get("saturday", wk_e))
        su_e = list(esched.get("sunday", wk_e))
        wk = [max(standby, min(1.0, float(v) * occ_rate)) for v in wk_e]
        sa = [max(standby, min(1.0, float(v) * occ_rate)) for v in sa_e]
        su = [max(standby, min(1.0, float(v) * occ_rate)) for v in su_e]
        mm = list(esched.get("monthly_multipliers", [1.0] * 12))
        excs = list(esched.get("exceptions", []) or [])

    return v23_schedule_to_compact(
        weekday=wk, saturday=sa, sunday=su,
        monthly_multipliers=mm, exceptions=excs,
        schedule_type="equipment",
    )


def _v23_derived_occupancy_schedule(building_params: dict) -> dict:
    """
    People fraction schedule from `building_config.occupancy.schedule`.
    The occupancy density already includes `occupancy_rate`, so this
    schedule is the per-hour PRESENCE fraction only.
    """
    occ = building_params.get("occupancy") or {}
    sched = occ.get("schedule") or {}
    wk = list(sched.get("weekday", [0] * 24))
    sa = list(sched.get("saturday", wk))
    su = list(sched.get("sunday", wk))
    mm = list(sched.get("monthly_multipliers", [1.0] * 12))
    excs = list(sched.get("exceptions", []) or [])
    return v23_schedule_to_compact(
        weekday=wk, saturday=sa, sunday=su,
        monthly_multipliers=mm, exceptions=excs,
        schedule_type="occupancy",
    )


# ── Brief 27 Revised Part 10 — per-profile schedule derivation ──────────────
#
# Each lighting / equipment profile carries its own relationship_to_occupancy
# + magnitude + (optional) schedule + area_share. The engine emits one
# `Lights` / `ElectricEquipment` object per profile per zone, each pointing
# at a Schedule:Compact whose values mirror the live engine's
# fractionForHour math for that profile's relationship.

def _v24_lighting_profile_schedule(profile: dict, building_params: dict) -> dict:
    """
    Derive a Schedule:Compact for a single v2.4 lighting profile, applying
    the same relationship_to_occupancy semantics as the live engine.

    Returns the Schedule:Compact dict. Caller is responsible for giving it
    a unique name and splicing into all_schedules.
    """
    rel = profile.get("relationship_to_occupancy", "proportional_with_spill")
    occ = building_params.get("occupancy") or {}
    occ_rate = float(occ.get("occupancy_rate", 0.75) or 0.75)
    occ_sched = occ.get("schedule") or {}

    if rel == "always_on":
        return v23_schedule_to_compact(
            weekday=[1.0] * 24, saturday=[1.0] * 24, sunday=[1.0] * 24,
            schedule_type="lighting",
        )

    if rel == "independent":
        psched = profile.get("schedule") or occ_sched
        return v23_schedule_to_compact(
            weekday=list(psched.get("weekday",  [0] * 24)),
            saturday=list(psched.get("saturday", psched.get("weekday", [0] * 24))),
            sunday=list(psched.get("sunday",     psched.get("weekday", [0] * 24))),
            monthly_multipliers=list(psched.get("monthly_multipliers", [1.0] * 12)),
            exceptions=list(psched.get("exceptions", []) or []),
            schedule_type="lighting",
        )

    if rel == "proportional":
        # Pure occupancy × occupancy_rate (no standby floor on lighting).
        wk_o = list(occ_sched.get("weekday",  [0] * 24))
        sa_o = list(occ_sched.get("saturday", wk_o))
        su_o = list(occ_sched.get("sunday",   wk_o))
        return v23_schedule_to_compact(
            weekday=[min(1.0, v * occ_rate) for v in wk_o],
            saturday=[min(1.0, v * occ_rate) for v in sa_o],
            sunday=[min(1.0, v * occ_rate) for v in su_o],
            monthly_multipliers=list(occ_sched.get("monthly_multipliers", [1.0] * 12)),
            exceptions=list(occ_sched.get("exceptions", []) or []),
            schedule_type="lighting",
        )

    # 'proportional_with_spill' (default) — lighting schedule × occupancy_rate
    # × daylight dim during 09:00–16:00.
    psched = profile.get("schedule") or occ_sched
    daylight = float(profile.get("daylight_factor", 0.6) or 0.6)

    def _apply(arr):
        return [
            min(1.0, float(v) * occ_rate * (daylight if (9 <= h <= 16 and daylight < 1) else 1))
            for h, v in enumerate(arr)
        ]

    wk = list(psched.get("weekday",  [0] * 24))
    sa = list(psched.get("saturday", wk))
    su = list(psched.get("sunday",   wk))
    return v23_schedule_to_compact(
        weekday=_apply(wk), saturday=_apply(sa), sunday=_apply(su),
        monthly_multipliers=list(psched.get("monthly_multipliers", [1.0] * 12)),
        exceptions=list(psched.get("exceptions", []) or []),
        schedule_type="lighting",
    )


def _v24_equipment_active_profile_schedule(profile: dict, building_params: dict) -> dict:
    """
    Active-equipment fraction schedule for a single v2.4 equipment profile.
    Baseload is emitted with a constant always-on schedule by the caller.
    """
    rel = profile.get("relationship_to_occupancy", "proportional")
    occ = building_params.get("occupancy") or {}
    occ_rate = float(occ.get("occupancy_rate", 0.75) or 0.75)
    occ_sched = occ.get("schedule") or {}
    standby = float(profile.get("standby_factor", 0.10) or 0)

    if rel == "always_on":
        return v23_schedule_to_compact(
            weekday=[1.0] * 24, saturday=[1.0] * 24, sunday=[1.0] * 24,
            schedule_type="equipment",
        )

    if rel == "independent":
        psched = profile.get("schedule") or occ_sched
        return v23_schedule_to_compact(
            weekday=list(psched.get("weekday",  [0] * 24)),
            saturday=list(psched.get("saturday", psched.get("weekday", [0] * 24))),
            sunday=list(psched.get("sunday",     psched.get("weekday", [0] * 24))),
            monthly_multipliers=list(psched.get("monthly_multipliers", [1.0] * 12)),
            exceptions=list(psched.get("exceptions", []) or []),
            schedule_type="equipment",
        )

    # 'proportional' — equipment schedule × occupancy_rate, with standby floor.
    psched = profile.get("schedule") or occ_sched
    wk = list(psched.get("weekday",  [0] * 24))
    sa = list(psched.get("saturday", wk))
    su = list(psched.get("sunday",   wk))

    def _apply(arr):
        return [max(standby, min(1.0, float(v) * occ_rate)) for v in arr]

    return v23_schedule_to_compact(
        weekday=_apply(wk), saturday=_apply(sa), sunday=_apply(su),
        monthly_multipliers=list(psched.get("monthly_multipliers", [1.0] * 12)),
        exceptions=list(psched.get("exceptions", []) or []),
        schedule_type="equipment",
    )


def _emit_state2_lighting_profiles(building_params, zones, all_schedules, gia):
    """
    Emit one Lights object per (zone × profile) plus the per-profile
    Schedule:Compact. Returns the Lights dict to splice into the epJSON.
    Profile LPD = magnitude × area_share (engine math).
    """
    lights = {}
    profiles = (building_params.get("gains") or {}).get("lighting", {}).get("profiles") or []
    for i, profile in enumerate(profiles):
        lpd = _v23_magnitude_to_w_per_m2(profile.get("magnitude"), building_params, gia)
        area_share = float(profile.get("area_share", 1.0) or 0)
        effective_lpd = lpd * area_share
        if effective_lpd <= 0:
            continue
        # Per-profile schedule, named uniquely.
        sched_name = f"v24_lighting_{profile.get('id', i)}"
        all_schedules[sched_name] = _v24_lighting_profile_schedule(profile, building_params)
        for zone_name in zones:
            lights[f"{zone_name}_Lights_{profile.get('id', i)}"] = {
                "zone_or_zonelist_or_space_or_spacelist_name": zone_name,
                "schedule_name": sched_name,
                "design_level_calculation_method": "Watts/Area",
                "watts_per_floor_area": round(effective_lpd, 4),
                "return_air_fraction": 0.0,
                "fraction_radiant": 0.32,
                "fraction_visible": 0.25,
            }
    return lights


def _emit_state2_equipment_profiles(building_params, zones, all_schedules, gia):
    """
    Emit ElectricEquipment objects per (zone × profile). Each profile
    contributes up to two objects per zone:
      - <zone>_Equip_<id>_baseload  — always-on at baseload × area_share
      - <zone>_Equip_<id>_active    — scheduled at active × area_share
    Skipped if the corresponding magnitude is zero.
    """
    equipment = {}
    profiles = (building_params.get("gains") or {}).get("equipment", {}).get("profiles") or []
    for i, profile in enumerate(profiles):
        area_share = float(profile.get("area_share", 1.0) or 0)
        baseload_w = _v23_magnitude_to_w_per_m2(profile.get("baseload"), building_params, gia) * area_share
        active_w   = _v23_magnitude_to_w_per_m2(profile.get("active"),   building_params, gia) * area_share

        if baseload_w > 0:
            for zone_name in zones:
                equipment[f"{zone_name}_Equip_{profile.get('id', i)}_baseload"] = {
                    "zone_or_zonelist_or_space_or_spacelist_name": zone_name,
                    "schedule_name": "openings_always_on",  # reused; constant 1.0
                    "design_level_calculation_method": "Watts/Area",
                    "watts_per_floor_area": round(baseload_w, 4),
                    "fraction_radiant": 0.30,
                    "fraction_latent": 0.00,
                    "fraction_lost": 0.00,
                }

        if active_w > 0:
            sched_name = f"v24_equipment_active_{profile.get('id', i)}"
            all_schedules[sched_name] = _v24_equipment_active_profile_schedule(profile, building_params)
            for zone_name in zones:
                equipment[f"{zone_name}_Equip_{profile.get('id', i)}_active"] = {
                    "zone_or_zonelist_or_space_or_spacelist_name": zone_name,
                    "schedule_name": sched_name,
                    "design_level_calculation_method": "Watts/Area",
                    "watts_per_floor_area": round(active_w, 4),
                    "fraction_radiant": 0.30,
                    "fraction_latent": 0.00,
                    "fraction_lost": 0.00,
                }
    return equipment


def assemble_epjson(
    building_params: dict,
    construction_choices: dict[str, str],
    weather_file_path: str | Path,
    output_path: str | Path | None = None,
    systems_config: dict | None = None,
    schedule_overrides: dict[str, dict] | None = None,
    mode: str = "full",
) -> dict:
    """
    Assemble a complete epJSON dict for the given building.

    Parameters
    ----------
    building_params : dict
        Parametric building description (see geometry.generate_building_geometry)
    construction_choices : dict
        Maps "external_wall", "roof", "ground_floor", "glazing" to library names
    weather_file_path : str | Path
        Path to an EPW weather file (used to extract Site:Location)
    output_path : str | Path | None
        If provided, write the epJSON to this path. Parent dirs are created.
    systems_config : dict | None
        Optional systems configuration from the frontend (mode, hvac_type,
        lighting_power_density, etc.)
    schedule_overrides : dict[str, dict] | None
        Optional mapping of assignment key → library config_json.
        Each entry replaces the corresponding default schedule in the model.
        Keys are formatted as "{zone_type}_{schedule_type}" (e.g.
        "bedroom_occupancy") or just the schedule_type string.
        The schedule_type field inside config_json determines which default
        schedule is replaced.
    mode : str
        State-contract mode per docs/state_contracts.md. Defaults to "full"
        (State 3, current behaviour). When set to "envelope-only" (State 1):

          - People / Lights / ElectricEquipment emit with zero density
            (no occupancy, no internal gains).
          - Ideal Loads thermostat setpoints widened to 5°C heating /
            50°C cooling so the zone runs free — the system never engages
            within realistic outdoor weather, letting EP report the true
            free-running zone temperature trace.
          - Operable-window ZoneVentilation:WindandStackOpenArea objects
            are suppressed (only louvre permanent openings remain).
          - ZoneInfiltration:DesignFlowRate stays as normal (fabric leakage).
          - All HVAC plant beyond Ideal Loads (DHW, VRF, MVHR, gas boilers)
            is still emitted but the Ideal-Loads-driven zone temperatures
            mean it produces near-zero output during the run.

        Other modes ("envelope-gains", "envelope-gains-operation") will be
        wired in by future briefs; for now they fall through to "full".

    Returns
    -------
    dict — the complete epJSON structure
    """
    weather_file_path = Path(weather_file_path)

    # ── 1. Generate geometry ──────────────────────────────────────────────────
    geom = generate_building_geometry(building_params)
    zones = geom["Zone"]
    surfaces = geom["BuildingSurface:Detailed"]
    windows = geom["FenestrationSurface:Detailed"]
    meta = geom["_metadata"]

    # ── 2. Substitute construction placeholders ───────────────────────────────
    _substitute_constructions(surfaces, windows, construction_choices)

    # ── 3. Collect all required construction epJSON objects ───────────────────
    used_constructions = set(construction_choices.values()) | {_INTERIOR_CONSTRUCTION}
    construction_epjson = _collect_construction_epjson(used_constructions)

    # ── 4. Site location from EPW ─────────────────────────────────────────────
    loc = _parse_epw_location(weather_file_path)

    # ── 5. Schedules ──────────────────────────────────────────────────────────
    all_schedules = get_all_schedules()
    schedule_type_limits = get_schedule_type_limits()

    # Apply user schedule overrides: replace default Schedule:Compact entries
    # with converted library schedules.  The config_json schedule_type field
    # determines which default name is replaced.
    if schedule_overrides:
        for _key, cfg in schedule_overrides.items():
            sched_type = cfg.get("schedule_type", "")
            default_name = _SCHEDULE_TYPE_TO_DEFAULT_NAME.get(sched_type)
            if default_name and default_name in all_schedules:
                all_schedules[default_name] = library_schedule_to_compact(cfg)

    # ── 6. Internal loads ─────────────────────────────────────────────────────
    # All zones treated as hotel_bedroom for this rectangular massing model
    # Apply systems_config overrides where relevant
    sc = systems_config or {}
    lpd_override = sc.get("lighting_power_density")  # W/m², None = use library default
    epd_override = sc.get("equipment_power_density")  # W/m², None = use library default

    # Lighting-control multiplier — coarse approximation of EP Daylighting:Controls.
    # We scale the LPD rather than emit Daylighting:Controls (which needs daylight
    # reference points + glare calcs + per-zone illuminance setpoints — a much
    # bigger lift). Direction is right: manual lights left on > sensors > dimming.
    _lighting_control_factors = {
        "manual":            1.20,  # people forget to switch off
        "occupancy_sensing": 0.80,  # ~20% saving from PIR sensors (CIBSE Lighting Guide 9)
        "daylight_dimming":  0.60,  # ~40% saving from photocell + dimming
    }
    _light_ctrl = sc.get("lighting_control", "occupancy_sensing")
    _light_factor = _lighting_control_factors.get(_light_ctrl, 1.0)
    if lpd_override is not None:
        lpd_override = float(lpd_override) * _light_factor

    # Ventilation-control schedule — pick the right Schedule:Compact name.
    # All three exist in nza_engine/library/schedules.py.
    _vent_control_schedules = {
        "continuous": "hotel_ventilation_continuous",
        "occupied":   "hotel_ventilation_occupied",
        "timer":      "hotel_ventilation_timer",
    }
    _vent_ctrl = sc.get("ventilation_control", "continuous")
    vent_schedule = _vent_control_schedules.get(_vent_ctrl, "hotel_ventilation_continuous")

    # ── State 1 envelope-only / State 2 envelope-gains modes ──────────────
    # Both states use the wide-setpoint ideal-loads thermostat (no real HVAC
    # service) and suppress operable windows (State 2.5 territory).
    #
    # State 1 (Brief 26 Part 5): Strip People/Lights/Equipment to zero
    # density so internal gains can't contaminate the State 1 output.
    #
    # State 2 (Brief 27 Part 3): Emit People/Lights/Equipment using
    # densities + derived schedules from v2.3 `occupancy.*` + `gains.*`.
    # Equipment baseload is emitted as a SEPARATE always-on object so it
    # mirrors the live engine's "baseload is 24/7, occupancy-independent"
    # semantics.
    state1 = (mode == "envelope-only")
    state2 = (mode == "envelope-gains")

    # Occupancy density — legacy fallback path (used only when v2.3
    # occupancy block isn't present and we're in 'full' mode).
    _num_bedrooms    = int(building_params.get("num_bedrooms",    0) or 0)
    _occupancy_rate  = float(building_params.get("occupancy_rate",  0.75) or 0.75)
    _people_per_room = float(building_params.get("people_per_room", 1.5)  or 1.5)
    _gia = (float(building_params.get("length", 60)) *
            float(building_params.get("width",  15)) *
            float(building_params.get("num_floors", 4)))

    # State 2 (Brief 27 Revised Part 10) — v2.4 multi-profile emission.
    # Occupancy density still single-object; lighting + equipment iterate
    # profiles[] and emit one Lights / ElectricEquipment per profile per
    # zone, each with its own Schedule:Compact.
    _state2_density = _v23_compute_occupancy_density(building_params, _gia) if state2 else 0.0

    if state1:
        _density_override = 0.0   # State 1: no people
        lpd_override = 0.0        # State 1: no lights
        epd_override = 0.0        # State 1: no equipment
    elif state2:
        _density_override = _state2_density
        # v2.4: the legacy single-object lights/equipment are emitted with
        # zero density (placeholder rows); per-profile objects below carry
        # the real emission.
        lpd_override = 0.0
        epd_override = 0.0
    elif _num_bedrooms > 0 and _gia > 0:
        _avg_occupants = _num_bedrooms * _occupancy_rate * _people_per_room
        _density_override = _avg_occupants / _gia
    else:
        _density_override = None  # use library default

    # ── State 2 schedule emission for occupancy ───────────────────────────
    # Occupancy stays single-object — splice the derived schedule into
    # all_schedules under the name the People objects already reference.
    if state2:
        all_schedules["hotel_bedroom_occupancy"] = _v23_derived_occupancy_schedule(building_params)
        # Legacy schedule names left untouched — per-profile schedules below
        # have unique names so they coexist without clobbering.

    people_objects  = _build_people_objects(zones, density_override=_density_override)
    # In state2 the v2.3-shape Lights / ElectricEquipment objects emit at
    # ZERO density (the per-profile objects below carry the real loads).
    # In state1 both are zero. In 'full' / other modes they use library
    # defaults.
    lights_objects  = _build_lights_objects(zones, lpd_override=lpd_override)
    equip_objects   = _build_equipment_objects(zones, epd_override=epd_override)

    # ── State 2 per-profile multi-profile emission (Brief 27 Revised Part 10) ──
    if state2:
        # Lighting: one Lights object per profile per zone.
        lighting_profile_objects = _emit_state2_lighting_profiles(
            building_params, zones, all_schedules, _gia,
        )
        lights_objects.update(lighting_profile_objects)

        # Equipment: baseload + active objects per profile per zone.
        equipment_profile_objects = _emit_state2_equipment_profiles(
            building_params, zones, all_schedules, _gia,
        )
        equip_objects.update(equipment_profile_objects)
    infil_objects   = _build_infiltration_objects(
        zones,
        building_params["length"],
        building_params["width"],
        building_params["floor_height"],
        ach=building_params.get("infiltration_ach", DEFAULT_INFILTRATION_ACH),
    )

    # ── 6b. Openings — wind-driven natural ventilation ────────────────────────
    # Reads the per-facade openings dict from building_params (Building →
    # Openings). Louvres always-open, openable windows on a schedule. Single-zone,
    # no stack (single-side wind only).
    # State 1 + State 2 both suppress operable windows (State 2.5 territory).
    # The `state1` kwarg name is kept for backward compatibility; semantically
    # it means "suppress operable-window stream".
    natural_vent_objects = _build_openings_objects(zones, building_params, state1=(state1 or state2))

    # Always-on schedule referenced by louvres + 'always' window mode.
    # Also referenced by the State 2 baseload-equipment object, so we emit
    # it whenever state2 is true even if there are no operable openings.
    # Merged into the final hvac_objects below so it doesn't get overwritten
    # by the DHW Schedule:Constant set.
    openings_const_schedules = {
        "openings_always_on": {
            "schedule_type_limits_name": "Fraction",
            "hourly_value": 1.0,
        },
    } if (natural_vent_objects or state2) else {}

    # ── 7. HVAC — branch on hvac_mode ─────────────────────────────────────────
    # "ideal_loads" (default): ZoneHVAC:IdealLoadsAirSystem — perfect, no real system effects
    # "detailed": real VRF objects with performance curves, real COP, fan energy
    #
    # Brief 26 Part 5: State 1 envelope-only mode forces ideal loads regardless
    # of the user's systems_config.mode. State 1 doesn't care about VRF curves
    # or boiler efficiencies — we just need a quiet thermostat with extreme
    # setpoints so the zone runs free against the envelope.
    # Renamed from `mode` to `hvac_mode` to avoid shadowing the state-contract
    # `mode` function parameter (previously caused State 1 to silently fall
    # back to detailed-mode + occupancy thermostat schedules).
    # State 1 + State 2 both force ideal loads with wide setpoints — neither
    # state involves real HVAC; both need the free-running zone temperature
    # trace, with State 2 adding internal gains on top.
    hvac_mode = "ideal_loads" if (state1 or state2) else sc.get("mode", "ideal_loads")

    if hvac_mode == "detailed":
        # ── Parse demand-based system assignments (with flat-key fallbacks) ──
        systems_cfg = sc.get("systems", {})

        # Space heating
        sh_prim    = systems_cfg.get("space_heating", {}).get("primary", {})
        sh_sys_key = sh_prim.get("system") or sc.get("hvac_type", "vrf_standard")
        sh_eff     = float(sh_prim.get("efficiency_override") or sc.get("cop_heating", 3.5))

        # Space cooling
        sc_prim    = systems_cfg.get("space_cooling", {}).get("primary", {})
        sc_sys_key = sc_prim.get("system") or sc.get("hvac_type", "vrf_standard")
        sc_eer     = float(sc_prim.get("efficiency_override") or sc.get("cop_cooling", 3.2))

        # Gas-fired heating systems modelled as ZoneHVAC:Baseboard:Convective:Gas
        _GAS_HEATING_KEYS = {"gas_boiler_heating", "gas_boiler_combi"}
        sh_is_gas  = sh_sys_key in _GAS_HEATING_KEYS
        sc_is_none = sc_sys_key in {"none_cooling"}

        if sh_is_gas:
            # Gas baseboard heating; VRF added on top if cooling is required
            bb_objects = generate_gas_baseboard_system(
                zone_names=list(zones.keys()),
                efficiency=sh_eff,
            )
            if sc_is_none:
                # Heating only — no active cooling system
                hvac_objects = bb_objects
            else:
                # Gas baseboard heating + VRF cooling-only
                vrf_cool_objects = generate_vrf_system(
                    zone_names=list(zones.keys()),
                    heating_cop=sh_eff,   # not used for heating; COP field required
                    cooling_eer=sc_eer,
                    provide_heating=False,
                    provide_cooling=True,
                )
                hvac_objects = add_vrf_cooling_to_baseboard(bb_objects, vrf_cool_objects)
        else:
            # VRF (or ASHP) handles both heating and optionally cooling
            hvac_objects = generate_vrf_system(
                zone_names=list(zones.keys()),
                heating_cop=sh_eff,
                cooling_eer=sc_eer,
                provide_heating=True,
                provide_cooling=not sc_is_none,
            )

        # Zone sizing objects are required for Fan:SystemModel and VRF coil autosizing
        sizing_objects = _build_sizing_objects(zones)
        hvac_objects.update(sizing_objects)

        # Ventilation — MEV (exhaust only) or MVHR (balanced ERV with heat recovery)
        # Must merge at the object-type level (setdefault+update) so that VRF Fan:SystemModel
        # entries are preserved while MVHR Fan:SystemModel entries are added alongside them.
        vent_prim    = systems_cfg.get("ventilation", {}).get("primary", {})
        vent_type    = vent_prim.get("system") or sc.get("ventilation_type", "mev_standard")
        # efficiency_override is stored as 0–100 integer (percentage); convert to 0–1 fraction
        _vent_eff_raw = vent_prim.get("efficiency_override")
        if _vent_eff_raw is not None:
            mvhr_eff = float(_vent_eff_raw) / 100.0
        else:
            mvhr_eff = float(sc.get("mvhr_efficiency", 0.85))
        zone_floor_area = building_params["length"] * building_params["width"]
        vent_objects = generate_ventilation_system(
            zone_names=list(zones.keys()),
            ventilation_type=vent_type,
            zone_floor_area_m2=zone_floor_area,
            heat_recovery_efficiency=mvhr_eff,
            ventilation_schedule=vent_schedule,
        )
        for obj_type, items in vent_objects.items():
            hvac_objects.setdefault(obj_type, {}).update(items)

        # DHW — read demand-based structure first, fall back to flat keys
        dhw_prim_cfg   = systems_cfg.get("dhw", {}).get("primary", {})
        dhw_sec_cfg    = systems_cfg.get("dhw", {}).get("secondary", {})
        dhw_primary    = dhw_prim_cfg.get("system") or sc.get("dhw_primary", "gas_boiler_dhw")
        dhw_preheat    = dhw_sec_cfg.get("system") or sc.get("dhw_preheat", "none")
        dhw_efficiency = float(
            dhw_prim_cfg.get("efficiency_override") or sc.get("dhw_efficiency", 0.92)
        )
        ashp_cop       = float(
            dhw_sec_cfg.get("efficiency_override") or sc.get("ashp_cop_dhw", 2.8)
        )

        # Pass actual bedroom count + occupancy so peak flow scales with real demand
        dhw_objects = generate_dhw_system(
            zone_floor_area_m2=zone_floor_area,
            num_zones=len(zones),
            num_bedrooms=_num_bedrooms if _num_bedrooms > 0 else None,
            occupancy_rate=_occupancy_rate,
            dhw_primary=dhw_primary,
            dhw_preheat=dhw_preheat,
            boiler_efficiency=dhw_efficiency,
            dhw_setpoint=float(sc.get("dhw_setpoint", 60.0)),
            dhw_preheat_setpoint=float(sc.get("dhw_preheat_setpoint", 45.0)),
            ashp_cop=ashp_cop,
        )
        for obj_type, items in dhw_objects.items():
            hvac_objects.setdefault(obj_type, {}).update(items)
        # Inject always-on schedule for openings (must coexist with DHW constants)
        if openings_const_schedules:
            hvac_objects.setdefault("Schedule:Constant", {}).update(openings_const_schedules)
    else:
        # Ideal loads — ZoneHVAC:IdealLoadsAirSystem (not HVACTemplate which needs ExpandObjects)
        ideal_loads, equip_lists, equip_conns, dual_setpoints, zone_controls = (
            _build_hvac_ideal_loads(zones, state1=(state1 or state2))
        )
        hvac_objects = {
            "ZoneHVAC:IdealLoadsAirSystem": ideal_loads,
            "ZoneHVAC:EquipmentList":       equip_lists,
            "ZoneHVAC:EquipmentConnections": equip_conns,
            "ThermostatSetpoint:DualSetpoint": dual_setpoints,
            "ZoneControl:Thermostat":        zone_controls,
        }
        # State 1 setpoint constants — extreme bounds (-60°C heating /
        # +100°C cooling) so the IdealLoads system never engages within any
        # plausible weather. The zone truly runs free against the envelope;
        # EP reports the free-running zone temperature hour by hour. Demand
        # against the comfort band is derived post-hoc in the parser, not
        # by EP. Bounds match the Temperature ScheduleTypeLimits range
        # (lower -60, upper 200) defined in nza_engine/library/schedules.py.
        if state1:
            hvac_objects.setdefault("Schedule:Constant", {}).update({
                "state1_heating_setpoint": {
                    "schedule_type_limits_name": "Temperature",
                    "hourly_value": -60.0,
                },
                "state1_cooling_setpoint": {
                    "schedule_type_limits_name": "Temperature",
                    "hourly_value": 100.0,
                },
            })
        if openings_const_schedules:
            # MERGE, don't assign — the state1 block above just added the
            # state1_heating_setpoint / state1_cooling_setpoint Schedule:Constant
            # entries that the IdealLoads thermostat refers to. A naïve
            # `hvac_objects["Schedule:Constant"] = dict(openings_const_schedules)`
            # wipes them and produces "schedule item not found" severe errors
            # that abort the EP run before any output is generated.
            # Bug was latent until a project carried non-zero louvre area on
            # any facade (which is what populates openings_const_schedules).
            hvac_objects.setdefault("Schedule:Constant", {}).update(openings_const_schedules)

    # ThermostatControlType_DualSetpoint schedule is already in schedules.py
    # ThermostatControlType ScheduleTypeLimits is already in schedule_type_limits

    # ── 8. Assemble the full epJSON dict ──────────────────────────────────────
    epjson: dict[str, Any] = {
        "Version": {
            "Version 1": {"version_identifier": "25.2"}
        },

        "Building": {
            building_params.get("name", "Building"): {
                "north_axis": float(building_params.get("orientation", 0.0)),
                "terrain": "Urban",
                "loads_convergence_tolerance_value": 0.04,
                "temperature_convergence_tolerance_value": 0.4,
                "solar_distribution": "FullExterior",
                "maximum_number_of_warmup_days": 25,
                "minimum_number_of_warmup_days": 6,
            }
        },

        "SimulationControl": {
            "SimulationControl 1": {
                "do_zone_sizing_calculation": "Yes",
                "do_system_sizing_calculation": "Yes",
                "do_plant_sizing_calculation": "Yes",
                "run_simulation_for_sizing_periods": "No",
                "run_simulation_for_weather_file_run_periods": "Yes",
            }
        },

        "Timestep": {
            "Timestep 1": {"number_of_timesteps_per_hour": 4}
        },

        # Explicit ShadowCalculation — defaults are PolygonClipping +
        # Periodic 20-day + SimpleSkyDiffuseModeling. The simple sky
        # diffuse algorithm doesn't account for shading reductions on
        # diffuse solar; switch to detailed so external overhangs/fins
        # actually reduce solar gain.
        "ShadowCalculation": {
            "ShadowCalculation 1": {
                "shading_calculation_method": "PolygonClipping",
                "shading_calculation_update_frequency_method": "Timestep",
                "shading_calculation_update_frequency": 1,
                "maximum_figures_in_shadow_overlap_calculations": 15000,
                "polygon_clipping_algorithm": "SutherlandHodgman",
                "sky_diffuse_modeling_algorithm": "DetailedSkyDiffuseModeling",
            }
        },

        "RunPeriod": {
            "Annual Run": {
                "begin_month": 1,
                "begin_day_of_month": 1,
                "end_month": 12,
                "end_day_of_month": 31,
                "day_of_week_for_start_day": "Monday",
                "use_weather_file_holidays_and_special_days": "Yes",
                "use_weather_file_dst_indicators": "Yes",
                "apply_weekend_holiday_rule": "No",
                "use_weather_file_rain_indicators": "Yes",
                "use_weather_file_snow_indicators": "Yes",
            }
        },

        "Site:Location": {
            loc["name"]: {
                "latitude": loc["latitude"],
                "longitude": loc["longitude"],
                "time_zone": loc["time_zone"],
                "elevation": loc["elevation"],
            }
        },

        "GlobalGeometryRules": {
            "GlobalGeometryRules 1": {
                "starting_vertex_position": "UpperLeftCorner",
                "vertex_entry_direction": "Counterclockwise",
                "coordinate_system": "Relative",
                "daylighting_reference_point_coordinate_system": "Relative",
                "rectangular_surface_coordinate_system": "Relative",
            }
        },

        "ScheduleTypeLimits": schedule_type_limits,
        "Schedule:Compact": all_schedules,

        "Zone": zones,
        "BuildingSurface:Detailed": surfaces,
        "FenestrationSurface:Detailed": windows,
        # Pass-through any shading objects the geometry generator produced
        **({"Shading:Overhang": geom["Shading:Overhang"]} if geom.get("Shading:Overhang") else {}),
        **({"Shading:Fin":      geom["Shading:Fin"]}      if geom.get("Shading:Fin")      else {}),
        **({"Shading:Building:Detailed": geom["Shading:Building:Detailed"]}
           if geom.get("Shading:Building:Detailed") else {}),

        "Material": construction_epjson["Material"],
        "Material:NoMass": construction_epjson["Material:NoMass"],
        "WindowMaterial:SimpleGlazingSystem": (
            construction_epjson["WindowMaterial:SimpleGlazingSystem"]
        ),
        "Construction": construction_epjson["Construction"],

        "People": people_objects,
        "Lights": lights_objects,
        "ElectricEquipment": equip_objects,
        "ZoneInfiltration:DesignFlowRate": infil_objects,

        # HVAC — keys injected dynamically based on mode (ideal_loads or detailed VRF)
        **hvac_objects,

        **({"ZoneVentilation:WindandStackOpenArea": natural_vent_objects}
           if natural_vent_objects else {}),

        "Output:Variable": _output_variables(),
        "Output:Meter": _output_meters(),

        # Generate a full RDD (report data dictionary) listing all available variables
        "Output:VariableDictionary": {
            "Output:VariableDictionary 1": {
                "key_field": "IDF",
                "sort_option": "Name",
            }
        },

        "OutputControl:Table:Style": {
            "OutputControl:Table:Style 1": {"column_separator": "HTML"}
        },

        "Output:SQLite": {
            "Output:SQLite 1": {"option_type": "SimpleAndTabular"}
        },

        "Output:Table:SummaryReports": {
            "Output:Table:SummaryReports 1": {
                "report_1_name": "AllSummary"
            }
        },
    }

    # Remove empty dicts (epJSON validators may complain)
    epjson = {k: v for k, v in epjson.items() if v}

    # ── 9. Write to disk if path given ────────────────────────────────────────
    if output_path is not None:
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(epjson, f, indent=2)

    return epjson
