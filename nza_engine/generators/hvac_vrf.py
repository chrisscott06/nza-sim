"""
nza_engine/generators/hvac_vrf.py

Generates EnergyPlus epJSON objects for a VRF (Variable Refrigerant Flow)
heating and cooling system.

Uses native EnergyPlus objects:
  AirConditioner:VariableRefrigerantFlow  — outdoor unit (condenser)
  ZoneTerminalUnitList                    — links outdoor unit to indoor units
  ZoneHVAC:TerminalUnit:VariableRefrigerantFlow — per-zone indoor unit
  Coil:Cooling:DX:VariableRefrigerantFlow — per-zone DX cooling coil
  Coil:Heating:DX:VariableRefrigerantFlow — per-zone DX heating coil
  Fan:SystemModel                         — per-zone supply fan
  ZoneHVAC:EquipmentList                  — per-zone equipment list
  ZoneHVAC:EquipmentConnections           — per-zone node wiring
  ThermostatSetpoint:DualSetpoint         — per-zone thermostat setpoints
  ZoneControl:Thermostat                  — per-zone thermostat control
  Curve:Biquadratic / Cubic / Quadratic   — VRF performance curves

Performance curves taken from EnergyPlus example file VRFMultispeedFan.idf
(representative real-world VRF system from Japanese manufacturer data).

Reference example: /Applications/EnergyPlus-25-2-0/ExampleFiles/VRFMultispeedFan.idf
"""

from __future__ import annotations


# ── Shared curve names (added once, shared across all zones) ─────────────────
_OA_NODE_NAME = "VRF_Condenser_OA_Node"
_TU_LIST_NAME = "VRF_Terminal_Unit_List"
_VRF_UNIT_NAME = "VRF_Heat_Pump"
# VRF TU availability: use a constant-1 schedule so the TU is always able to
# condition the zone (thermostat controls on/off). If we use occupancy here the
# TU turns off at night, the zone drifts cold, and morning re-heat is enormous.
_VRF_AVAIL_SCHED = "hotel_ventilation_continuous"


def _vrf_performance_curves() -> dict:
    """
    Standard VRF performance curves from EnergyPlus VRFMultispeedFan.idf example.

    These curves model how cooling capacity and COP vary with:
    - Outdoor temperature (biquadratic: f(Twb_indoor, Tdb_outdoor))
    - Part-load ratio (cubic/quadratic)

    The curves are normalised so that at rated conditions they return ~1.0,
    applying a multiplier to the rated COP/capacity specified on the outdoor unit.
    """
    return {
        "Curve:Biquadratic": {
            # Cooling capacity vs temperature (low outdoor temp range)
            "VRFCoolCapFT": {
                "coefficient1_constant": 0.576882692,
                "coefficient2_x":        0.017447952,
                "coefficient3_x_2":      0.000583269,
                "coefficient4_y":       -1.76324e-6,
                "coefficient5_y_2":     -7.474e-9,
                "coefficient6_x_y":     -1.30413e-7,
                "minimum_value_of_x": 15, "maximum_value_of_x": 24,
                "minimum_value_of_y": -5, "maximum_value_of_y": 23,
                "input_unit_type_for_x": "Temperature",
                "input_unit_type_for_y": "Temperature",
                "output_unit_type": "Dimensionless",
            },
            # Cooling capacity vs temperature (high outdoor temp range)
            "VRFCoolCapFTHi": {
                "coefficient1_constant": 0.6867358,
                "coefficient2_x":        0.0207631,
                "coefficient3_x_2":      0.0005447,
                "coefficient4_y":       -0.0016218,
                "coefficient5_y_2":     -4.259e-7,
                "coefficient6_x_y":     -0.0003392,
                "minimum_value_of_x": 15, "maximum_value_of_x": 24,
                "minimum_value_of_y": 16, "maximum_value_of_y": 43,
                "input_unit_type_for_x": "Temperature",
                "input_unit_type_for_y": "Temperature",
                "output_unit_type": "Dimensionless",
            },
            # Cooling EIR vs temperature (low range)
            "VRFCoolEIRFT": {
                "coefficient1_constant": 0.989010541,
                "coefficient2_x":       -0.02347967,
                "coefficient3_x_2":      0.000199711,
                "coefficient4_y":        0.005968336,
                "coefficient5_y_2":     -1.0289e-7,
                "coefficient6_x_y":     -0.00015686,
                "minimum_value_of_x": 15, "maximum_value_of_x": 24,
                "minimum_value_of_y": -5, "maximum_value_of_y": 23,
                "input_unit_type_for_x": "Temperature",
                "input_unit_type_for_y": "Temperature",
                "output_unit_type": "Dimensionless",
            },
            # Cooling EIR vs temperature (high range)
            "VRFCoolEIRFTHi": {
                "coefficient1_constant": 0.14351470,
                "coefficient2_x":        0.01860035,
                "coefficient3_x_2":     -0.0003954,
                "coefficient4_y":        0.02485219,
                "coefficient5_y_2":      0.00016329,
                "coefficient6_x_y":     -0.0006244,
                "minimum_value_of_x": 15, "maximum_value_of_x": 24,
                "minimum_value_of_y": 16, "maximum_value_of_y": 43,
                "input_unit_type_for_x": "Temperature",
                "input_unit_type_for_y": "Temperature",
                "output_unit_type": "Dimensionless",
            },
            # Piping length correction
            "VRFCoolingLengthCorrectionFactor": {
                "coefficient1_constant": 1.0693794,
                "coefficient2_x":       -0.0014951,
                "coefficient3_x_2":      2.56e-6,
                "coefficient4_y":       -0.1151104,
                "coefficient5_y_2":      0.0511169,
                "coefficient6_x_y":     -0.0004369,
                "minimum_value_of_x": 8,   "maximum_value_of_x": 175,
                "minimum_value_of_y": 0.5, "maximum_value_of_y": 1.5,
                "input_unit_type_for_x": "Temperature",
                "input_unit_type_for_y": "Temperature",
                "output_unit_type": "Dimensionless",
            },
            # Heating capacity vs temperature (low range: f(Tdb_indoor, Twb_outdoor))
            "VRFHeatCapFT": {
                "coefficient1_constant": 1.014599599,
                "coefficient2_x":       -0.002506703,
                "coefficient3_x_2":     -0.000141599,
                "coefficient4_y":        0.026931595,
                "coefficient5_y_2":      1.83538e-6,
                "coefficient6_x_y":     -0.000358147,
                "minimum_value_of_x": 15, "maximum_value_of_x": 27,
                "minimum_value_of_y": -20, "maximum_value_of_y": 15,
                "input_unit_type_for_x": "Temperature",
                "input_unit_type_for_y": "Temperature",
                "output_unit_type": "Dimensionless",
            },
            # Heating capacity vs temperature (high range)
            "VRFHeatCapFTHi": {
                "coefficient1_constant": 1.161134821,
                "coefficient2_x":        0.027478868,
                "coefficient3_x_2":     -0.00168795,
                "coefficient4_y":        0.001783378,
                "coefficient5_y_2":      2.03208e-6,
                "coefficient6_x_y":     -6.8969e-5,
                "minimum_value_of_x": 15, "maximum_value_of_x": 27,
                "minimum_value_of_y": -10, "maximum_value_of_y": 15,
                "input_unit_type_for_x": "Temperature",
                "input_unit_type_for_y": "Temperature",
                "output_unit_type": "Dimensionless",
            },
            # Heating EIR vs temperature (low range)
            "VRFHeatEIRFT": {
                "coefficient1_constant": 0.87465501,
                "coefficient2_x":       -0.01319754,
                "coefficient3_x_2":      0.00110307,
                "coefficient4_y":       -0.0133118,
                "coefficient5_y_2":      0.00089017,
                "coefficient6_x_y":     -0.00012766,
                "minimum_value_of_x": 15, "maximum_value_of_x": 27,
                "minimum_value_of_y": -20, "maximum_value_of_y": 12,
                "input_unit_type_for_x": "Temperature",
                "input_unit_type_for_y": "Temperature",
                "output_unit_type": "Dimensionless",
            },
            # Heating EIR vs temperature (high range)
            "VRFHeatEIRFTHi": {
                "coefficient1_constant": 2.504005146,
                "coefficient2_x":       -0.05736767,
                "coefficient3_x_2":      4.07336e-5,
                "coefficient4_y":       -0.12959669,
                "coefficient5_y_2":      0.00135839,
                "coefficient6_x_y":      0.00317047,
                "minimum_value_of_x": 15, "maximum_value_of_x": 27,
                "minimum_value_of_y": -10, "maximum_value_of_y": 15,
                "input_unit_type_for_x": "Temperature",
                "input_unit_type_for_y": "Temperature",
                "output_unit_type": "Dimensionless",
            },
        },

        "Curve:Cubic": {
            # Cooling capacity boundary (splits low/high temp curves)
            "VRFCoolCapFTBoundary": {
                "coefficient1_constant": 25.73473775,
                "coefficient2_x":       -0.03150043,
                "coefficient3_x_2":     -0.01416595,
                "coefficient4_x_3":      0.0,
                "minimum_value_of_x": 11, "maximum_value_of_x": 30,
                "input_unit_type_for_x": "Temperature",
                "output_unit_type": "Temperature",
            },
            # Cooling EIR boundary
            "VRFCoolEIRFTBoundary": {
                "coefficient1_constant": 25.73473775,
                "coefficient2_x":       -0.03150043,
                "coefficient3_x_2":     -0.01416595,
                "coefficient4_x_3":      0.0,
                "minimum_value_of_x": 15, "maximum_value_of_x": 24,
                "input_unit_type_for_x": "Temperature",
                "output_unit_type": "Temperature",
            },
            # Cooling EIR vs PLR (low part-load)
            "VRFCoolingEIRLowPLR": {
                "coefficient1_constant": 0.4628123,
                "coefficient2_x":       -1.0402406,
                "coefficient3_x_2":      2.17490997,
                "coefficient4_x_3":     -0.5974817,
                "minimum_value_of_x": 0.0, "maximum_value_of_x": 1.0,
                "input_unit_type_for_x": "Dimensionless",
                "output_unit_type": "Dimensionless",
            },
            # Heating capacity boundary
            "VRFHeatCapFTBoundary": {
                "coefficient1_constant": -7.6000882,
                "coefficient2_x":        3.05090016,
                "coefficient3_x_2":     -0.1162844,
                "coefficient4_x_3":      0.0,
                "minimum_value_of_x": 15, "maximum_value_of_x": 27,
                "input_unit_type_for_x": "Temperature",
                "output_unit_type": "Temperature",
            },
            # Heating EIR boundary
            "VRFHeatEIRFTBoundary": {
                "coefficient1_constant": -7.6000882,
                "coefficient2_x":        3.05090016,
                "coefficient3_x_2":     -0.1162844,
                "coefficient4_x_3":      0.0,
                "minimum_value_of_x": 15, "maximum_value_of_x": 27,
                "minimum_curve_output": -20, "maximum_curve_output": 15,
                "input_unit_type_for_x": "Temperature",
                "output_unit_type": "Temperature",
            },
            # Heating EIR vs PLR (low)
            "VRFHeatingEIRLowPLR": {
                "coefficient1_constant": 0.1400093,
                "coefficient2_x":        0.6415002,
                "coefficient3_x_2":      0.1339047,
                "coefficient4_x_3":      0.0845859,
                "minimum_value_of_x": 0.0, "maximum_value_of_x": 1.0,
                "input_unit_type_for_x": "Dimensionless",
                "output_unit_type": "Dimensionless",
            },
            # Terminal unit cooling coil capacity vs temperature (cubic in zone conditions)
            "VRFTUCoolCapFT": {
                "coefficient1_constant": 0.504547273506488,
                "coefficient2_x":        0.0288891279198444,
                "coefficient3_x_2":     -0.0000108194186506770,
                "coefficient4_x_3":      0.0000101359395177008,
                "minimum_value_of_x": 0.0, "maximum_value_of_x": 50.0,
                "minimum_curve_output": 0.5, "maximum_curve_output": 1.5,
                "input_unit_type_for_x": "Temperature",
                "output_unit_type": "Dimensionless",
            },
            # Terminal unit heating coil capacity vs temperature
            "VRFTUHeatCapFT": {
                "coefficient1_constant": -0.390708928227928,
                "coefficient2_x":         0.261815023760162,
                "coefficient3_x_2":      -0.0130431603151873,
                "coefficient4_x_3":       0.000178131745997821,
                "minimum_value_of_x": 0.0, "maximum_value_of_x": 50.0,
                "minimum_curve_output": 0.5, "maximum_curve_output": 1.5,
                "input_unit_type_for_x": "Temperature",
                "output_unit_type": "Dimensionless",
            },
        },

        "Curve:Quadratic": {
            # Part-load fraction correlation (both cooling and heating)
            "VRFCPLFFPLR": {
                "coefficient1_constant": 0.85,
                "coefficient2_x":        0.15,
                "coefficient3_x_2":      0.0,
                "minimum_value_of_x": 0.0, "maximum_value_of_x": 1.0,
                "minimum_curve_output": 0.85, "maximum_curve_output": 1.0,
            },
            # Cooling EIR at high PLR (above 1.0)
            "VRFCoolingEIRHiPLR": {
                "coefficient1_constant": 1.0,
                "coefficient2_x":        0.0,
                "coefficient3_x_2":      0.0,
                "minimum_value_of_x": 1.0, "maximum_value_of_x": 1.5,
            },
            # Heating EIR at high PLR
            "VRFHeatingEIRHiPLR": {
                "coefficient1_constant": 2.4294355,
                "coefficient2_x":       -2.235887,
                "coefficient3_x_2":      0.8064516,
                "minimum_value_of_x": 1.0, "maximum_value_of_x": 1.5,
            },
            # Terminal unit flow fraction modifier (shared by cooling and heating coils)
            "VRFACCoolCapFFF": {
                "coefficient1_constant": 0.8,
                "coefficient2_x":        0.2,
                "coefficient3_x_2":      0.0,
                "minimum_value_of_x": 0.5, "maximum_value_of_x": 1.5,
            },
        },

        "Curve:Linear": {
            # Cooling combination ratio correction
            "VRFCoolingCombRatio": {
                "coefficient1_constant": 0.618055,
                "coefficient2_x":        0.381945,
                "minimum_value_of_x": 1.0, "maximum_value_of_x": 1.5,
                "minimum_curve_output": 1.0, "maximum_curve_output": 1.2,
            },
            # Heating combination ratio correction
            "VRFHeatingCombRatio": {
                "coefficient1_constant": 0.96034,
                "coefficient2_x":        0.03966,
                "minimum_value_of_x": 1.0, "maximum_value_of_x": 1.5,
                "minimum_curve_output": 1.0, "maximum_curve_output": 1.023,
            },
        },
    }


def _build_outdoor_unit(
    zone_names: list[str],
    heating_cop: float,
    cooling_eer: float,
) -> dict:
    """
    Build the AirConditioner:VariableRefrigerantFlow outdoor unit object.

    The outdoor unit serves all zones. Rated COPs are from the system template;
    performance curves apply temperature and PLR corrections.
    """
    first_zone = zone_names[0]
    return {
        "AirConditioner:VariableRefrigerantFlow": {
            _VRF_UNIT_NAME: {
                "gross_rated_total_cooling_capacity": "Autosize",
                "gross_rated_cooling_cop": cooling_eer,
                "minimum_condenser_inlet_node_temperature_in_cooling_mode": -5.0,
                "maximum_condenser_inlet_node_temperature_in_cooling_mode": 43.0,

                # Cooling performance curves (low / boundary / high temperature)
                "cooling_capacity_ratio_modifier_function_of_low_temperature_curve_name": "VRFCoolCapFT",
                "cooling_capacity_ratio_boundary_curve_name": "VRFCoolCapFTBoundary",
                "cooling_capacity_ratio_modifier_function_of_high_temperature_curve_name": "VRFCoolCapFTHi",
                "cooling_energy_input_ratio_modifier_function_of_low_temperature_curve_name": "VRFCoolEIRFT",
                "cooling_energy_input_ratio_boundary_curve_name": "VRFCoolEIRFTBoundary",
                "cooling_energy_input_ratio_modifier_function_of_high_temperature_curve_name": "VRFCoolEIRFTHi",
                "cooling_energy_input_ratio_modifier_function_of_low_part_load_ratio_curve_name": "VRFCoolingEIRLowPLR",
                "cooling_energy_input_ratio_modifier_function_of_high_part_load_ratio_curve_name": "VRFCoolingEIRHiPLR",
                "cooling_combination_ratio_correction_factor_curve_name": "VRFCoolingCombRatio",
                "cooling_part_load_fraction_correlation_curve_name": "VRFCPLFFPLR",

                # Heating rated values
                "gross_rated_heating_capacity": "Autosize",
                "gross_rated_heating_cop": heating_cop,
                "minimum_condenser_inlet_node_temperature_in_heating_mode": -20.0,
                "maximum_condenser_inlet_node_temperature_in_heating_mode": 20.0,

                # Heating performance curves
                "heating_capacity_ratio_modifier_function_of_low_temperature_curve_name": "VRFHeatCapFT",
                "heating_capacity_ratio_boundary_curve_name": "VRFHeatCapFTBoundary",
                "heating_capacity_ratio_modifier_function_of_high_temperature_curve_name": "VRFHeatCapFTHi",
                "heating_energy_input_ratio_modifier_function_of_low_temperature_curve_name": "VRFHeatEIRFT",
                "heating_energy_input_ratio_boundary_curve_name": "VRFHeatEIRFTBoundary",
                "heating_energy_input_ratio_modifier_function_of_high_temperature_curve_name": "VRFHeatEIRFTHi",
                "heating_performance_curve_outdoor_temperature_type": "WetBulbTemperature",
                "heating_energy_input_ratio_modifier_function_of_low_part_load_ratio_curve_name": "VRFHeatingEIRLowPLR",
                "heating_energy_input_ratio_modifier_function_of_high_part_load_ratio_curve_name": "VRFHeatingEIRHiPLR",
                "heating_combination_ratio_correction_factor_curve_name": "VRFHeatingCombRatio",
                "heating_part_load_fraction_correlation_curve_name": "VRFCPLFFPLR",

                # System control
                "minimum_heat_pump_part_load_ratio": 0.25,
                "zone_name_for_master_thermostat_location": first_zone,
                "master_thermostat_priority_control_type": "LoadPriority",
                "zone_terminal_unit_list_name": _TU_LIST_NAME,
                "heat_pump_waste_heat_recovery": "No",

                # Piping (simple flat-building assumption)
                "equivalent_piping_length_used_for_piping_correction_factor_in_cooling_mode": 30.0,
                "vertical_height_used_for_piping_correction_factor": 10.0,
                "piping_correction_factor_for_length_in_cooling_mode_curve_name": "VRFCoolingLengthCorrectionFactor",
                "piping_correction_factor_for_height_in_cooling_mode_coefficient": -0.000386,
                "equivalent_piping_length_used_for_piping_correction_factor_in_heating_mode": 30.0,

                # Defrost (resistive, timed)
                "crankcase_heater_power_per_compressor": 15.0,
                "number_of_compressors": 2,
                "ratio_of_compressor_size_to_total_compressor_capacity": 0.5,
                "maximum_outdoor_dry_bulb_temperature_for_crankcase_heater": 7.0,
                "defrost_strategy": "Resistive",
                "defrost_control": "Timed",
                "defrost_time_period_fraction": 0.058333,
                "resistive_defrost_heater_capacity": "Autosize",
                "maximum_outdoor_dry_bulb_temperature_for_defrost_operation": 7.0,

                # Condenser: air-cooled, references outdoor air node
                "condenser_type": "AirCooled",
                "condenser_inlet_node_name": _OA_NODE_NAME,
                "fuel_type": "Electricity",
            }
        }
    }


def _build_zone_vrf(zone_name: str) -> dict:
    """
    Build all per-zone VRF objects:
      - ZoneHVAC:TerminalUnit:VariableRefrigerantFlow
      - Coil:Cooling:DX:VariableRefrigerantFlow
      - Coil:Heating:DX:VariableRefrigerantFlow
      - Fan:SystemModel
      - ZoneHVAC:EquipmentList
      - ZoneHVAC:EquipmentConnections
      - ThermostatSetpoint:DualSetpoint
      - ZoneControl:Thermostat

    Node chain (draw-through fan placement):
      Zone exhaust → TU Inlet → CCoil Inlet → CCoil Outlet → HCoil Inlet
                  → HCoil Outlet (= Fan Inlet) → Fan Outlet → TU Outlet → Zone supply
    """
    tu_name      = f"{zone_name}_VRF_TU"
    ccoil_name   = f"{zone_name}_VRF_CCoil"
    hcoil_name   = f"{zone_name}_VRF_HCoil"
    fan_name     = f"{zone_name}_VRF_Fan"
    list_name    = f"{zone_name}_EquipList"
    tstat_name   = f"{zone_name}_DualSetpoint"
    ctrl_name    = f"{zone_name}_TstatCtrl"

    # Nodes
    inlet_node   = f"{zone_name}_TU_Inlet"     # zone exhaust → TU
    outlet_node  = f"{zone_name}_TU_Outlet"    # TU → zone supply
    cc_out_node  = f"{zone_name}_CC_Outlet"    # cooling coil outlet
    hc_out_node  = f"{zone_name}_HC_Outlet"    # heating coil outlet (= fan inlet)
    air_node     = f"{zone_name}_Air"          # zone air node
    return_node  = f"{zone_name}_Return"       # zone return air node

    return {
        "ZoneHVAC:TerminalUnit:VariableRefrigerantFlow": {
            tu_name: {
                # Always available so thermostat can maintain temperature 24/7.
                # Using occupancy schedule here causes huge morning-reheat spikes.
                "terminal_unit_availability_schedule":       _VRF_AVAIL_SCHED,
                "terminal_unit_air_inlet_node_name":         inlet_node,
                "terminal_unit_air_outlet_node_name":        outlet_node,
                "cooling_supply_air_flow_rate":              "Autosize",
                "no_cooling_supply_air_flow_rate":           "Autosize",
                "heating_supply_air_flow_rate":              "Autosize",
                "no_heating_supply_air_flow_rate":           "Autosize",
                "cooling_outdoor_air_flow_rate":             0.0,
                "heating_outdoor_air_flow_rate":             0.0,
                "no_load_outdoor_air_flow_rate":             0.0,
                # Fan mode = 0 means fan runs only when there's a load (cycling mode)
                "supply_air_fan_operating_mode_schedule_name": _VRF_AVAIL_SCHED,
                "supply_air_fan_placement":                  "DrawThrough",
                "supply_air_fan_object_type":                "Fan:SystemModel",
                "supply_air_fan_object_name":                fan_name,
                "cooling_coil_object_type": "Coil:Cooling:DX:VariableRefrigerantFlow",
                "cooling_coil_object_name":                  ccoil_name,
                "heating_coil_object_type": "Coil:Heating:DX:VariableRefrigerantFlow",
                "heating_coil_object_name":                  hcoil_name,
                "zone_terminal_unit_on_parasitic_electric_energy_use":  30.0,
                "zone_terminal_unit_off_parasitic_electric_energy_use": 20.0,
            }
        },

        "Coil:Cooling:DX:VariableRefrigerantFlow": {
            ccoil_name: {
                "availability_schedule_name":    _VRF_AVAIL_SCHED,
                "gross_rated_total_cooling_capacity":       "Autosize",
                "gross_rated_sensible_heat_ratio":          "Autosize",
                "rated_air_flow_rate":                      "Autosize",
                "cooling_capacity_ratio_modifier_function_of_temperature_curve_name": "VRFTUCoolCapFT",
                "cooling_capacity_modifier_curve_function_of_flow_fraction_name":     "VRFACCoolCapFFF",
                "coil_air_inlet_node":  inlet_node,
                "coil_air_outlet_node": cc_out_node,
            }
        },

        "Coil:Heating:DX:VariableRefrigerantFlow": {
            hcoil_name: {
                "availability_schedule":   _VRF_AVAIL_SCHED,
                "gross_rated_heating_capacity":             "Autosize",
                "rated_air_flow_rate":                      "Autosize",
                "coil_air_inlet_node":  cc_out_node,
                "coil_air_outlet_node": hc_out_node,
                "heating_capacity_ratio_modifier_function_of_temperature_curve_name": "VRFTUHeatCapFT",
                "heating_capacity_modifier_function_of_flow_fraction_curve_name":     "VRFACCoolCapFFF",
            }
        },

        "Fan:SystemModel": {
            fan_name: {
                "air_inlet_node_name":   hc_out_node,
                "air_outlet_node_name":  outlet_node,
                "design_maximum_air_flow_rate":         "Autosize",
                "speed_control_method":                 "Discrete",
                "electric_power_minimum_flow_rate_fraction": 0.2,
                "design_pressure_rise":                 300.0,   # Pa — typical fan coil
                "motor_efficiency":                     0.9,
                "motor_in_air_stream_fraction":         1.0,
                "design_electric_power_consumption":    "Autosize",
                "design_power_sizing_method":           "PowerPerFlowPerPressure",
                "electric_power_per_unit_flow_rate_per_unit_pressure": 1.66667,
                "fan_total_efficiency":                 0.7,
                "end_use_subcategory":                  "General",
                "number_of_speeds":                     1,
            }
        },

        "ZoneHVAC:EquipmentList": {
            list_name: {
                "load_distribution_scheme": "SequentialLoad",
                "equipment": [
                    {
                        "zone_equipment_object_type": "ZoneHVAC:TerminalUnit:VariableRefrigerantFlow",
                        "zone_equipment_name":        tu_name,
                        "zone_equipment_cooling_sequence":               1,
                        "zone_equipment_heating_or_no_load_sequence":    1,
                    }
                ]
            }
        },

        "ZoneHVAC:EquipmentConnections": {
            f"{zone_name}_EquipConn": {
                "zone_name":                                zone_name,
                "zone_conditioning_equipment_list_name":    list_name,
                "zone_air_inlet_node_or_nodelist_name":     outlet_node,
                "zone_air_exhaust_node_or_nodelist_name":   inlet_node,
                "zone_air_node_name":                       air_node,
                "zone_return_air_node_or_nodelist_name":    return_node,
            }
        },

        "ThermostatSetpoint:DualSetpoint": {
            tstat_name: {
                "heating_setpoint_temperature_schedule_name": "hotel_heating_setpoint",
                "cooling_setpoint_temperature_schedule_name": "hotel_cooling_setpoint",
            }
        },

        "ZoneControl:Thermostat": {
            ctrl_name: {
                "zone_or_zonelist_name":           zone_name,
                "control_type_schedule_name":      "ThermostatControlType_DualSetpoint",
                "control_1_object_type":           "ThermostatSetpoint:DualSetpoint",
                "control_1_name":                  tstat_name,
            }
        },
    }


def generate_vrf_system(
    zone_names: list[str],
    heating_cop: float = 3.5,
    cooling_eer: float = 3.2,
) -> dict:
    """
    Generate all EnergyPlus epJSON objects for a multi-zone VRF system.

    Returns a dict keyed by EnergyPlus object type, ready to merge into the
    main epJSON dict. Includes:
      - One outdoor unit (AirConditioner:VariableRefrigerantFlow)
      - One ZoneTerminalUnitList
      - Per zone: TU, cooling coil, heating coil, fan, equipment list,
                  equipment connections, thermostat setpoint, thermostat control
      - All required performance curves (shared)
      - Outdoor air node for condenser

    Parameters
    ----------
    zone_names : list[str]
        EnergyPlus zone names (one per floor in our rectangular massing model).
    heating_cop : float
        Rated system heating COP at standard conditions (7°C OA, 20°C RA).
    cooling_eer : float
        Rated system cooling EER/COP at standard conditions (35°C OA, 27°C WB RA).
    """
    # Start with shared performance curves
    result: dict[str, dict] = {}
    for obj_type, items in _vrf_performance_curves().items():
        result.setdefault(obj_type, {}).update(items)

    # Outdoor unit
    for obj_type, items in _build_outdoor_unit(zone_names, heating_cop, cooling_eer).items():
        result.setdefault(obj_type, {}).update(items)

    # Terminal unit list (lists all zone TU names)
    result["ZoneTerminalUnitList"] = {
        _TU_LIST_NAME: {
            "zone_terminal_unit_list_name": _TU_LIST_NAME,
            "terminal_units": [
                {"zone_terminal_unit_name": f"{z}_VRF_TU"}
                for z in zone_names
            ]
        }
    }

    # Outdoor air node for condenser
    result["OutdoorAir:Node"] = {
        _OA_NODE_NAME: {}   # empty → EnergyPlus uses weather file conditions
    }

    # Per-zone objects
    for zone_name in zone_names:
        zone_objs = _build_zone_vrf(zone_name)
        for obj_type, items in zone_objs.items():
            result.setdefault(obj_type, {}).update(items)

    return result
