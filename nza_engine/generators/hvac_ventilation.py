"""
nza_engine/generators/hvac_ventilation.py

Generates EnergyPlus epJSON objects for mechanical ventilation:

  mev_standard  — Mechanical Extract Ventilation (exhaust only, no heat recovery)
                  ZoneVentilation:DesignFlowRate (exhaust type) with fan pressure/
                  efficiency parameters so EnergyPlus reports fan electricity.
                  Fresh supply air enters via the existing infiltration model.

  mvhr_standard — Mechanical Ventilation with Heat Recovery (balanced ERV)
                  ZoneHVAC:EnergyRecoveryVentilator
                  + HeatExchanger:AirToAir:SensibleAndLatent (plate, sensible only)
                  + two Fan:SystemModel per zone (supply + exhaust).
                  The ERV is registered in each zone's EquipmentList alongside
                  the VRF terminal unit, and EquipmentConnections is updated to
                  use NodeList objects (one zone inlet list, one zone exhaust list).

MVHR node topology (draw-through supply; zone → HX → exhaust fan):

  SUPPLY (outdoor → HX → supply fan → zone inlet NodeList):
    {z}_ERV_OA_In        (OutdoorAir:Node → outdoor air conditions)
      → HX supply_air_inlet_node_name
      → HX supply_air_outlet_node_name = {z}_ERV_HX_Sup_Out
      → supply fan air_inlet_node_name
      → supply fan air_outlet_node_name = {z}_ERV_Sup_Out
      → zone inlet NodeList: [{z}_TU_Outlet, {z}_ERV_Sup_Out]

  EXHAUST (zone exhaust NodeList → HX → exhaust fan → outdoor):
    zone exhaust NodeList: [{z}_TU_Inlet, {z}_ERV_Exh_In]
      → HX exhaust_air_inlet_node_name   ← MUST appear in EquipmentConnections exhaust list
      → HX exhaust_air_outlet_node_name = {z}_ERV_HX_Exh_Out
      → exhaust fan air_inlet_node_name
      → exhaust fan air_outlet_node_name = {z}_ERV_Exh_Out  (to outdoor)

Reference example: /Applications/EnergyPlus-25-2-0/ExampleFiles/HVACStandAloneERV_Economizer.idf
"""

from __future__ import annotations

# Naming conventions from hvac_vrf.py (must stay in sync)
_VRF_TU_SUFFIX      = "_VRF_TU"       # ZoneHVAC:TerminalUnit:VariableRefrigerantFlow name
_VRF_TU_INLET_SUFF  = "_TU_Inlet"     # zone exhaust → VRF TU inlet
_VRF_TU_OUTLET_SUFF = "_TU_Outlet"    # VRF TU outlet → zone supply

_VENT_AVAIL_SCHED = "hotel_ventilation_continuous"  # always-on schedule

# Occupancy used to derive design flow rates
# Must match nza_engine/library/loads.py hotel_bedroom values
_PEOPLE_PER_M2      = 0.025   # 1 person per 40 m²
_FRESH_AIR_L_S_PER_PERSON = 8.0   # CIBSE Guide A — bedroom occupancy


# ── MEV ───────────────────────────────────────────────────────────────────────

def _mev_objects(
    zone_names: list[str],
    flow_m3s_per_person: float,
    schedule: str,
    fan_pressure_pa: float,
    fan_total_efficiency: float,
) -> dict:
    """
    One ZoneVentilation:DesignFlowRate (exhaust type) per zone.

    EnergyPlus uses fan_pressure_rise and fan_total_efficiency to calculate
    fan electricity, which appears under the Fans:Electricity meter.
    Supply air for MEV enters through the existing infiltration model.
    """
    vent = {}
    for z in zone_names:
        vent[f"{z}_MEV_Exhaust"] = {
            "zone_or_zonelist_or_space_or_spacelist_name": z,
            "schedule_name": schedule,
            "design_flow_rate_calculation_method": "Flow/Person",
            "flow_rate_per_person": flow_m3s_per_person,
            "ventilation_type": "Exhaust",
            "fan_pressure_rise": fan_pressure_pa,
            "fan_total_efficiency": fan_total_efficiency,
        }
    return {"ZoneVentilation:DesignFlowRate": vent}


# ── MVHR ──────────────────────────────────────────────────────────────────────

def _mvhr_zone_objects(
    zone_name: str,
    flow_m3s: float,
    heat_recovery_efficiency: float,
    schedule: str,
) -> dict:
    """
    Build MVHR objects for one zone.

    Returns a dict keyed by EnergyPlus object type.  The EquipmentList and
    EquipmentConnections entries replace the VRF-generated ones by including
    both the VRF terminal unit and the ERV in the same list, and using
    NodeList objects for zone inlet/exhaust so both systems share the nodes.
    """
    z = zone_name

    # VRF names (from hvac_vrf.py conventions)
    vrf_tu       = f"{z}{_VRF_TU_SUFFIX}"
    vrf_inlet    = f"{z}{_VRF_TU_INLET_SUFF}"    # zone exhaust → VRF TU
    vrf_outlet   = f"{z}{_VRF_TU_OUTLET_SUFF}"   # VRF TU → zone supply

    # ERV component names
    erv_name   = f"{z}_ERV"
    hx_name    = f"{z}_ERV_HX"
    sup_fan    = f"{z}_ERV_SupFan"
    exh_fan    = f"{z}_ERV_ExhFan"
    list_name  = f"{z}_EquipList"
    air_node   = f"{z}_Air"
    ret_node   = f"{z}_Return"

    # ERV node names
    oa_in        = f"{z}_ERV_OA_In"         # outdoor air inlet to HX
    hx_sup_out   = f"{z}_ERV_HX_Sup_Out"   # HX supply outlet → sup fan inlet
    erv_sup_out  = f"{z}_ERV_Sup_Out"      # sup fan outlet → zone inlet NodeList
    erv_exh_in   = f"{z}_ERV_Exh_In"      # zone exhaust NodeList → HX exhaust inlet
    hx_exh_out   = f"{z}_ERV_HX_Exh_Out"  # HX exhaust outlet → exh fan inlet
    erv_exh_out  = f"{z}_ERV_Exh_Out"     # exh fan outlet → outdoor (no EP object)

    # NodeList names
    inlet_nl   = f"{z}_InletNodeList"
    exhaust_nl = f"{z}_ExhaustNodeList"

    # Effectiveness at 75% flow is slightly higher (typical plate HX behaviour)
    eff_100 = heat_recovery_efficiency
    eff_75  = min(eff_100 * 1.04, 0.97)

    result: dict[str, dict] = {}

    # ── Heat exchanger ────────────────────────────────────────────────────────
    result.setdefault("HeatExchanger:AirToAir:SensibleAndLatent", {})[hx_name] = {
        "availability_schedule_name":                              schedule,
        "nominal_supply_air_flow_rate":                           flow_m3s,
        "sensible_effectiveness_at_100_percent_heating_air_flow": eff_100,
        "latent_effectiveness_at_100_percent_heating_air_flow":   0.0,
        "sensible_effectiveness_at_100_percent_cooling_air_flow": eff_100,
        "latent_effectiveness_at_100_percent_cooling_air_flow":   0.0,
        "sensible_effectiveness_at_75_percent_heating_air_flow":  eff_75,
        "latent_effectiveness_at_75_percent_heating_air_flow":    0.0,
        "sensible_effectiveness_at_75_percent_cooling_air_flow":  eff_75,
        "latent_effectiveness_at_75_percent_cooling_air_flow":    0.0,
        "supply_air_inlet_node_name":   oa_in,
        "supply_air_outlet_node_name":  hx_sup_out,
        # Zone exhaust goes DIRECTLY into the HX (EnergyPlus requires this node
        # to appear in the zone EquipmentConnections exhaust list).
        "exhaust_air_inlet_node_name":  erv_exh_in,
        "exhaust_air_outlet_node_name": hx_exh_out,
        "heat_exchanger_type":    "Plate",
        "frost_control_type":     "None",
        "threshold_temperature":  1.7,
        "initial_defrost_time_fraction":           0.083,
        "rate_of_defrost_time_fraction_increase":  0.012,
        "economizer_lockout": "Yes",
    }

    # ── Supply fan: HX outlet → zone inlet NodeList ───────────────────────────
    result.setdefault("Fan:SystemModel", {})[sup_fan] = {
        "air_inlet_node_name":              hx_sup_out,
        "air_outlet_node_name":             erv_sup_out,
        "design_maximum_air_flow_rate":     flow_m3s,
        "speed_control_method":             "Discrete",
        "electric_power_minimum_flow_rate_fraction": 1.0,
        "design_pressure_rise":             250.0,           # Pa — MVHR duct system
        "motor_efficiency":                 0.9,
        "motor_in_air_stream_fraction":     1.0,
        "design_electric_power_consumption": "Autosize",
        "design_power_sizing_method":       "PowerPerFlowPerPressure",
        "electric_power_per_unit_flow_rate_per_unit_pressure": 1.66667,
        "fan_total_efficiency":             0.7,
        "end_use_subcategory":              "General",
        "number_of_speeds":                 1,
    }

    # ── Exhaust fan: HX exhaust outlet → outdoor ─────────────────────────────
    # Zone air first passes through the HX (heat exchange), then the fan pulls
    # the cooled exhaust to outdoor.  EnergyPlus requires the HX exhaust_air_inlet
    # to be the node that appears in the zone EquipmentConnections exhaust list.
    result.setdefault("Fan:SystemModel", {})[exh_fan] = {
        "air_inlet_node_name":              hx_exh_out,
        "air_outlet_node_name":             erv_exh_out,
        "design_maximum_air_flow_rate":     flow_m3s,
        "speed_control_method":             "Discrete",
        "electric_power_minimum_flow_rate_fraction": 1.0,
        "design_pressure_rise":             250.0,
        "motor_efficiency":                 0.9,
        "motor_in_air_stream_fraction":     0.0,    # exhaust fan — not in supply stream
        "design_electric_power_consumption": "Autosize",
        "design_power_sizing_method":       "PowerPerFlowPerPressure",
        "electric_power_per_unit_flow_rate_per_unit_pressure": 1.66667,
        "fan_total_efficiency":             0.7,
        "end_use_subcategory":              "General",
        "number_of_speeds":                 1,
    }

    # ── ERV wrapper ───────────────────────────────────────────────────────────
    result.setdefault("ZoneHVAC:EnergyRecoveryVentilator", {})[erv_name] = {
        "availability_schedule_name":    schedule,
        "heat_exchanger_object_type":    "HeatExchanger:AirToAir:SensibleAndLatent",
        "heat_exchanger_name":           hx_name,
        "supply_air_flow_rate":          flow_m3s,
        "exhaust_air_flow_rate":         flow_m3s,
        "supply_air_fan_object_type":    "Fan:SystemModel",
        "supply_air_fan_name":           sup_fan,
        "exhaust_air_fan_object_type":   "Fan:SystemModel",
        "exhaust_air_fan_name":          exh_fan,
        "economizer_lockout":            "No",
    }

    # ── Outdoor air node for ERV supply inlet ─────────────────────────────────
    result.setdefault("OutdoorAir:Node", {})[oa_in] = {}

    # ── NodeLists — zone inlet and exhaust shared between VRF TU and ERV ──────
    # Inlet NodeList: zone receives supply from both the VRF TU and ERV supply fan
    result.setdefault("NodeList", {})[inlet_nl] = {
        "nodes": [
            {"node_name": vrf_outlet},
            {"node_name": erv_sup_out},
        ]
    }
    # Exhaust NodeList: both the VRF TU inlet and ERV exhaust fan draw from zone
    result.setdefault("NodeList", {})[exhaust_nl] = {
        "nodes": [
            {"node_name": vrf_inlet},
            {"node_name": erv_exh_in},
        ]
    }

    # ── Equipment list — VRF TU (sequence 1) + ERV (sequence 2) ──────────────
    # Overrides the VRF-generated EquipmentList for this zone.
    result.setdefault("ZoneHVAC:EquipmentList", {})[list_name] = {
        "load_distribution_scheme": "SequentialLoad",
        "equipment": [
            {
                "zone_equipment_object_type": (
                    "ZoneHVAC:TerminalUnit:VariableRefrigerantFlow"
                ),
                "zone_equipment_name":                      vrf_tu,
                "zone_equipment_cooling_sequence":          1,
                "zone_equipment_heating_or_no_load_sequence": 1,
            },
            {
                "zone_equipment_object_type": (
                    "ZoneHVAC:EnergyRecoveryVentilator"
                ),
                "zone_equipment_name":                      erv_name,
                "zone_equipment_cooling_sequence":          2,
                "zone_equipment_heating_or_no_load_sequence": 2,
            },
        ],
    }

    # ── Equipment connections — use NodeList names instead of single nodes ─────
    # Overrides the VRF-generated EquipmentConnections for this zone.
    result.setdefault("ZoneHVAC:EquipmentConnections", {})[f"{z}_EquipConn"] = {
        "zone_name":                             z,
        "zone_conditioning_equipment_list_name": list_name,
        "zone_air_inlet_node_or_nodelist_name":  inlet_nl,
        "zone_air_exhaust_node_or_nodelist_name": exhaust_nl,
        "zone_air_node_name":                    air_node,
        "zone_return_air_node_or_nodelist_name": ret_node,
    }

    return result


# ── Public API ────────────────────────────────────────────────────────────────

def generate_ventilation_system(
    zone_names: list[str],
    ventilation_type: str,
    zone_floor_area_m2: float,
    heat_recovery_efficiency: float = 0.85,
    flow_rate_l_s_per_person: float = _FRESH_AIR_L_S_PER_PERSON,
    ventilation_schedule: str = _VENT_AVAIL_SCHED,
) -> dict:
    """
    Generate mechanical ventilation epJSON objects for all zones.

    MEV  — returns ZoneVentilation:DesignFlowRate (exhaust) only.
           No EquipmentList changes required.

    MVHR — returns ERV + HX + 2 fans per zone, NodeLists, and overrides
           ZoneHVAC:EquipmentList and ZoneHVAC:EquipmentConnections to add
           the ERV alongside the VRF terminal unit.  The caller MUST merge
           using setdefault().update() at the object-type level (not a plain
           dict.update()) so that existing Fan:SystemModel entries from the
           VRF generator are preserved.

    Parameters
    ----------
    zone_names : list[str]
        EnergyPlus zone names (one per floor in our rectangular building).
    ventilation_type : str
        "mev_standard" or "mvhr_standard".
    zone_floor_area_m2 : float
        Floor area per zone (length × width, m²).  Used to calculate MVHR
        design flow rates from occupancy density × fresh-air rate per person.
    heat_recovery_efficiency : float
        Sensible effectiveness of the MVHR plate heat exchanger (0–1).
        Ignored for MEV.  Default: 0.85 (85% sensible recovery).
    flow_rate_l_s_per_person : float
        Design fresh-air rate per person (l/s).  Default: 8.0 (CIBSE Guide A).
    ventilation_schedule : str
        EnergyPlus schedule name for ventilation availability.

    Returns
    -------
    dict
        EnergyPlus object type → instance dict.  Merge into hvac_objects using:
            for obj_type, items in ventilation_objects.items():
                hvac_objects.setdefault(obj_type, {}).update(items)
    """
    flow_m3s_per_person = flow_rate_l_s_per_person / 1000.0

    if ventilation_type == "mvhr_standard":
        # Design flow rate per zone (m³/s)
        occupants_per_zone = _PEOPLE_PER_M2 * zone_floor_area_m2
        zone_flow_m3s = max(occupants_per_zone * flow_m3s_per_person, 0.01)

        result: dict = {}
        for z in zone_names:
            zone_objs = _mvhr_zone_objects(
                zone_name=z,
                flow_m3s=zone_flow_m3s,
                heat_recovery_efficiency=heat_recovery_efficiency,
                schedule=ventilation_schedule,
            )
            for obj_type, items in zone_objs.items():
                result.setdefault(obj_type, {}).update(items)
        return result

    # Default: MEV or any other/unrecognised ventilation type
    return _mev_objects(
        zone_names=zone_names,
        flow_m3s_per_person=flow_m3s_per_person,
        schedule=ventilation_schedule,
        fan_pressure_pa=150.0,     # Pa — typical MEV extract fan
        fan_total_efficiency=0.5,  # → SFP ≈ 0.3 W/(l/s)
    )
