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
)
from nza_engine.library.loads import get_zone_loads
from nza_engine.generators.hvac_vrf import generate_vrf_system
from nza_engine.generators.hvac_ventilation import generate_ventilation_system


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


def _build_people_objects(zones: dict, zone_type: str = "hotel_bedroom") -> dict:
    """Build EnergyPlus People objects for each zone."""
    loads = get_zone_loads(zone_type)
    density = loads["occupancy_density_people_per_m2"]
    m2_per_person = 1.0 / density if density > 0 else 100.0
    metabolic = loads["metabolic_rate_W_per_person"]

    people = {}
    for zone_name in zones:
        people[f"{zone_name}_People"] = {
            "zone_or_zonelist_or_space_or_spacelist_name": zone_name,
            "number_of_people_schedule_name": loads["occupancy_schedule"],
            "number_of_people_calculation_method": "People/Area",
            "people_per_floor_area": density,
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


def _build_equipment_objects(zones: dict, zone_type: str = "hotel_bedroom") -> dict:
    loads = get_zone_loads(zone_type)
    equip = {}
    for zone_name in zones:
        equip[f"{zone_name}_Equip"] = {
            "zone_or_zonelist_or_space_or_spacelist_name": zone_name,
            "schedule_name": loads["equipment_schedule"],
            "design_level_calculation_method": "Watts/Area",
            "watts_per_floor_area": loads["equipment_power_density_W_per_m2"],
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


def _build_natural_ventilation_objects(
    zones: dict,
    building_params: dict,
    natural_vent_threshold: float = 22.0,
) -> dict:
    """
    Build ZoneVentilation:WindAndStackOpenArea objects for all zones.

    Opening area = 50% × average_wwr × perimeter facade area per floor.
    Windows open only when indoor temperature > threshold AND occupied
    (the opening_area_fraction_schedule_name uses the occupancy schedule).
    """
    length       = building_params["length"]
    width        = building_params["width"]
    floor_height = building_params["floor_height"]
    wwr          = building_params.get("wwr", {})
    avg_wwr      = (
        wwr.get("north", 0.25) + wwr.get("south", 0.25)
        + wwr.get("east", 0.25) + wwr.get("west", 0.25)
    ) / 4.0

    # Window area per zone (one zone per floor, all four facades)
    perimeter_m         = 2.0 * (length + width)
    facade_area_per_floor = perimeter_m * floor_height
    window_area_per_zone  = avg_wwr * facade_area_per_floor
    # Effective opening = 10% of total window area per floor zone.
    # 50% would be the absolute max (fully-open fraction of all glazing), but since one
    # EnergyPlus zone represents a whole floor, using 10% produces realistic ACH values
    # (~5–8 ACH at 5 m/s) without flooding the zone with unconstrained outdoor air.
    opening_area          = round(0.10 * window_area_per_zone, 2)

    nat_vent = {}
    for zone_name in zones:
        nat_vent[f"{zone_name}_NatVent"] = {
            "zone_or_space_name":                zone_name,
            "opening_area":                      opening_area,
            # Fraction = occupancy schedule (0 when unoccupied, 1 when occupied)
            "opening_area_fraction_schedule_name": "hotel_bedroom_occupancy",
            "opening_effectiveness":             "Autocalculate",
            "effective_angle":                   90.0,   # vertical opening
            "height_difference":                 1.0,    # m
            "discharge_coefficient_for_opening": 0.65,
            # Temperature controls: windows open when indoor > threshold
            "minimum_indoor_temperature":        natural_vent_threshold,
            "maximum_indoor_temperature":        100.0,  # no upper cap
            # Allow ventilation at any outdoor temp (winter draughts modelled naturally)
            "minimum_outdoor_temperature":       -100.0,
            "maximum_outdoor_temperature":       100.0,
            "maximum_wind_speed":                40.0,   # m/s — effectively unlimited
        }
    return nat_vent


def _build_hvac_ideal_loads(zones: dict) -> tuple[dict, dict, dict, dict, dict]:
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
        thermostats[tstat_name] = {
            "heating_setpoint_temperature_schedule_name": "hotel_heating_setpoint",
            "cooling_setpoint_temperature_schedule_name": "hotel_cooling_setpoint",
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
        "Zone Ideal Loads Supply Air Total Heating Energy",
        "Zone Ideal Loads Supply Air Total Cooling Energy",
        "Zone People Occupant Count",
        "Zone Lights Electricity Energy",
        "Zone Electric Equipment Electricity Energy",
        "Zone Hot Water Equipment Electricity Energy",   # DHW if modeled as hot water equip
        "Zone Infiltration Sensible Heat Loss Energy",
        "Zone Infiltration Sensible Heat Gain Energy",
        "Zone Ventilation Sensible Heat Loss Energy",    # mechanical vent heat loss
        "Zone Ventilation Sensible Heat Gain Energy",    # mechanical vent heat gain
        "Fan Electricity Energy",                        # fan energy (if fan objects present)
        "Surface Inside Face Conduction Heat Transfer Energy",
        # Solar gains — use Energy (J) which works with SimpleGlazingSystem
        # Rate (W) is not generated with simplified glazing in EP 25.2
        "Zone Windows Total Transmitted Solar Radiation Energy",
        "Surface Window Transmitted Solar Radiation Energy",
        "Zone Ideal Loads Heat Recovery Total Heating Energy",
        "Zone Ideal Loads Heat Recovery Total Cooling Energy",
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


def assemble_epjson(
    building_params: dict,
    construction_choices: dict[str, str],
    weather_file_path: str | Path,
    output_path: str | Path | None = None,
    systems_config: dict | None = None,
    schedule_overrides: dict[str, dict] | None = None,
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

    people_objects  = _build_people_objects(zones)
    lights_objects  = _build_lights_objects(zones, lpd_override=lpd_override)
    equip_objects   = _build_equipment_objects(zones)
    infil_objects   = _build_infiltration_objects(
        zones,
        building_params["length"],
        building_params["width"],
        building_params["floor_height"],
        ach=building_params.get("infiltration_ach", DEFAULT_INFILTRATION_ACH),
    )

    # ── 6b. Natural ventilation (openable windows) ────────────────────────────
    natural_vent_objects = {}
    if sc.get("natural_ventilation", False):
        threshold = float(sc.get("natural_vent_threshold", 22.0))
        natural_vent_objects = _build_natural_ventilation_objects(
            zones, building_params, natural_vent_threshold=threshold
        )

    # ── 7. HVAC — branch on mode ──────────────────────────────────────────────
    # "ideal_loads" (default): ZoneHVAC:IdealLoadsAirSystem — perfect, no real system effects
    # "detailed": real VRF objects with performance curves, real COP, fan energy
    mode = sc.get("mode", "ideal_loads")

    if mode == "detailed":
        heating_cop = float(sc.get("cop_heating", 3.5))
        cooling_eer = float(sc.get("cop_cooling", 3.2))
        # Currently VRF is the detailed HVAC system (vrf_standard, vrf_high_efficiency, ashp_system)
        hvac_objects = generate_vrf_system(
            zone_names=list(zones.keys()),
            heating_cop=heating_cop,
            cooling_eer=cooling_eer,
        )
        # Zone sizing objects are required for Fan:SystemModel and VRF coil autosizing
        sizing_objects = _build_sizing_objects(zones)
        hvac_objects.update(sizing_objects)

        # Ventilation — MEV (exhaust only) or MVHR (balanced ERV with heat recovery)
        # Must merge at the object-type level (setdefault+update) so that VRF Fan:SystemModel
        # entries are preserved while MVHR Fan:SystemModel entries are added alongside them.
        vent_type = sc.get("ventilation_type", "mev_standard")
        mvhr_eff  = float(sc.get("mvhr_efficiency", 0.85))
        zone_floor_area = building_params["length"] * building_params["width"]
        vent_objects = generate_ventilation_system(
            zone_names=list(zones.keys()),
            ventilation_type=vent_type,
            zone_floor_area_m2=zone_floor_area,
            heat_recovery_efficiency=mvhr_eff,
        )
        for obj_type, items in vent_objects.items():
            hvac_objects.setdefault(obj_type, {}).update(items)
    else:
        # Ideal loads — ZoneHVAC:IdealLoadsAirSystem (not HVACTemplate which needs ExpandObjects)
        ideal_loads, equip_lists, equip_conns, dual_setpoints, zone_controls = (
            _build_hvac_ideal_loads(zones)
        )
        hvac_objects = {
            "ZoneHVAC:IdealLoadsAirSystem": ideal_loads,
            "ZoneHVAC:EquipmentList":       equip_lists,
            "ZoneHVAC:EquipmentConnections": equip_conns,
            "ThermostatSetpoint:DualSetpoint": dual_setpoints,
            "ZoneControl:Thermostat":        zone_controls,
        }

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
                "solar_distribution": "FullInteriorAndExteriorWithReflections",
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
