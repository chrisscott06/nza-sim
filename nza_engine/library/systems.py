"""
nza_engine/library/systems.py

HVAC and services system templates for hotel buildings.

Each template defines parameters that feed into:
  - EnergyPlus HVAC object generation (in the assembler)
  - Simplified energy calculations (SCOP, SEER, SFP, etc.)
  - UI display in the Systems & Zones module

Fields
------
serves          : 'heating' | 'cooling' | 'heating_and_cooling' | 'dhw' | 'ventilation'
fuel_type       : 'electricity' | 'gas' | 'renewable' | None
efficiency_type : 'scop' | 'seer' | 'thermal_efficiency' | 'sfp' | 'heat_recovery' | 'cop'
efficiency_value: the rated seasonal performance value
has_heat_rejection : bool — true for cooling systems that reject heat outdoors
has_exhaust_waste  : bool — true for ventilation systems without heat recovery

Usage
-----
    from nza_engine.library.systems import list_systems, get_system

    all_systems = list_systems()
    vrf = get_system("vrf_standard")
"""

from typing import Any

# ── System template library ───────────────────────────────────────────────────

_SYSTEMS: dict[str, dict[str, Any]] = {

    # ── Heating systems ──────────────────────────────────────────────────────

    "gas_boiler_heating": {
        "display_name":         "Gas Boiler — Condensing (Heating)",
        "type":                 "gas_boiler",
        "category":             "heating",
        "serves":               "heating",
        "description":          "Condensing gas boiler for space heating via radiators or underfloor heating. High carbon intensity — generally not preferred for new hotels targeting net zero.",
        "efficiency":           0.92,
        "efficiency_type":      "thermal_efficiency",
        "efficiency_value":     0.92,
        "fuel_type":            "gas",
        "has_heat_rejection":   False,
        "has_exhaust_waste":    True,   # flue losses
    },

    "vrf_heating": {
        "display_name":         "VRF System — Heating Mode",
        "type":                 "vrf",
        "category":             "heating",
        "serves":               "heating",
        "description":          "VRF system operating in heating mode only. High SCOP makes this the preferred choice for decarbonised heating in hotel bedrooms.",
        "scop":                 3.5,
        "efficiency_type":      "scop",
        "efficiency_value":     3.5,
        "fan_power_w_per_m2":   3.0,
        "min_outdoor_temp_c":   -15.0,
        "fuel_type":            "electricity",
        "has_heat_rejection":   False,  # absorbs heat in heating mode
        "has_exhaust_waste":    False,
    },

    "ashp_heating": {
        "display_name":         "Air Source Heat Pump — Space Heating",
        "type":                 "ashp",
        "category":             "heating",
        "serves":               "heating",
        "description":          "Centralised ASHP providing space heating via a heat distribution network. Cooling provided separately (e.g. chiller or VRF in cooling mode).",
        "scop":                 3.2,
        "efficiency_type":      "scop",
        "efficiency_value":     3.2,
        "fan_power_w_per_m2":   2.0,
        "min_outdoor_temp_c":   -10.0,
        "fuel_type":            "electricity",
        "has_heat_rejection":   False,
        "has_exhaust_waste":    False,
    },

    "electric_panel_heating": {
        "display_name":         "Electric Panel Heaters",
        "type":                 "electric_panel",
        "category":             "heating",
        "serves":               "heating",
        "description":          "Direct electric resistance heating panels. 100% efficient at point of use but high running cost and carbon. Useful as a baseline comparison or for individual room override.",
        "efficiency":           1.0,
        "efficiency_type":      "thermal_efficiency",
        "efficiency_value":     1.0,
        "fuel_type":            "electricity",
        "has_heat_rejection":   False,
        "has_exhaust_waste":    False,
    },

    # ── Cooling systems ──────────────────────────────────────────────────────

    "vrf_cooling": {
        "display_name":         "VRF System — Cooling Mode",
        "type":                 "vrf",
        "category":             "cooling",
        "serves":               "cooling",
        "description":          "VRF system operating in cooling mode only. Rejects heat to outdoor air. Commonly paired with a gas boiler or ASHP for heating.",
        "seer":                 3.2,
        "efficiency_type":      "seer",
        "efficiency_value":     3.2,
        "fan_power_w_per_m2":   3.0,
        "fuel_type":            "electricity",
        "has_heat_rejection":   True,
        "has_exhaust_waste":    False,
    },

    "split_system_cooling": {
        "display_name":         "Split AC System",
        "type":                 "split_ac",
        "category":             "cooling",
        "serves":               "cooling",
        "description":          "Conventional split-system air conditioning. Lower efficiency than VRF. Suitable for smaller areas or supplementary cooling.",
        "seer":                 2.8,
        "efficiency_type":      "seer",
        "efficiency_value":     2.8,
        "fan_power_w_per_m2":   3.5,
        "fuel_type":            "electricity",
        "has_heat_rejection":   True,
        "has_exhaust_waste":    False,
    },

    "none_cooling": {
        "display_name":         "No Mechanical Cooling",
        "type":                 "natural_cooling",
        "category":             "cooling",
        "serves":               "cooling",
        "description":          "Reliance on natural ventilation and passive cooling only. Only appropriate if the building has low cooling loads or effective passive design.",
        "seer":                 None,
        "efficiency_type":      None,
        "efficiency_value":     None,
        "fuel_type":            None,
        "has_heat_rejection":   False,
        "has_exhaust_waste":    False,
    },

    # ── Combined heating & cooling systems ───────────────────────────────────

    "vrf_standard": {
        "display_name":         "VRF System — Standard",
        "type":                 "vrf",
        "category":             "hvac",
        "serves":               "heating_and_cooling",
        "description":          "Variable Refrigerant Flow split system. Industry-standard choice for hotel bedrooms. Provides both heating and cooling from a single outdoor unit.",
        "scop":                 3.5,
        "seer":                 3.2,
        "heating_cop":          3.5,    # backward compat
        "cooling_eer":          3.2,    # backward compat
        "efficiency_type":      "scop",
        "efficiency_value":     3.5,
        "fan_power_w_per_m2":   3.0,
        "min_outdoor_temp_c":   -15.0,
        "defrost_strategy":     "reverse_cycle",
        "fuel_type":            "electricity",
        "has_heat_rejection":   True,   # in cooling mode
        "has_exhaust_waste":    False,
    },

    "vrf_high_efficiency": {
        "display_name":         "VRF System — High Efficiency",
        "type":                 "vrf",
        "category":             "hvac",
        "serves":               "heating_and_cooling",
        "description":          "Premium VRF system with higher SCOP/SEER. Suitable for BREEAM Excellent or net-zero carbon projects.",
        "scop":                 4.2,
        "seer":                 4.0,
        "heating_cop":          4.2,    # backward compat
        "cooling_eer":          4.0,    # backward compat
        "efficiency_type":      "scop",
        "efficiency_value":     4.2,
        "fan_power_w_per_m2":   2.5,
        "min_outdoor_temp_c":   -20.0,
        "defrost_strategy":     "reverse_cycle",
        "fuel_type":            "electricity",
        "has_heat_rejection":   True,
        "has_exhaust_waste":    False,
    },

    "ashp_space": {
        "display_name":         "Air Source Heat Pump — Space Heating",
        "type":                 "ashp",
        "category":             "hvac",
        "serves":               "heating",
        "description":          "Centralised ASHP providing space heating via a heat distribution network. Cooling provided separately (e.g. chiller).",
        "scop":                 3.0,
        "heating_cop":          3.0,    # backward compat
        "cooling_eer":          None,
        "efficiency_type":      "scop",
        "efficiency_value":     3.0,
        "fan_power_w_per_m2":   2.0,
        "min_outdoor_temp_c":   -10.0,
        "fuel_type":            "electricity",
        "has_heat_rejection":   False,
        "has_exhaust_waste":    False,
    },

    "gas_boiler_standard": {
        "display_name":         "Gas Boiler — Condensing Standard",
        "type":                 "gas_boiler",
        "category":             "hvac",
        "serves":               "heating",
        "description":          "Condensing gas boiler for space heating. Common legacy plant. High carbon intensity — generally not preferred for new hotels.",
        "efficiency":           0.92,
        "heating_cop":          0.92,   # backward compat
        "cooling_eer":          None,
        "efficiency_type":      "thermal_efficiency",
        "efficiency_value":     0.92,
        "fuel_type":            "gas",
        "has_heat_rejection":   False,
        "has_exhaust_waste":    True,   # flue losses
    },

    # ── DHW systems ──────────────────────────────────────────────────────────

    "gas_boiler_dhw": {
        "display_name":         "Gas Boiler — DHW",
        "type":                 "gas_boiler_dhw",
        "category":             "dhw",
        "serves":               "dhw",
        "description":          "Condensing gas boiler for domestic hot water. Typically the primary DHW system, optionally paired with ASHP preheat.",
        "efficiency":           0.92,
        "efficiency_type":      "thermal_efficiency",
        "efficiency_value":     0.92,
        "fuel_type":            "gas",
        "has_heat_rejection":   False,
        "has_exhaust_waste":    True,   # flue losses
    },

    "ashp_dhw": {
        "display_name":         "ASHP — DHW Preheat",
        "type":                 "ashp_dhw",
        "category":             "dhw",
        "serves":               "dhw",
        "description":          "Air source heat pump for domestic hot water pre-heating. Preheat to 45°C; top up to 60°C with electric immersion or gas boiler.",
        "cop":                  2.8,
        "efficiency_type":      "cop",
        "efficiency_value":     2.8,
        "hot_water_setpoint_c": 60.0,
        "preheat_setpoint_c":   45.0,
        "fuel_type":            "electricity",
        "has_heat_rejection":   False,
        "has_exhaust_waste":    False,
    },

    "ashp_dhw_preheat": {
        "display_name":         "ASHP — DHW Preheat Stage",
        "type":                 "ashp_dhw",
        "category":             "dhw",
        "serves":               "dhw",
        "description":          "ASHP preheat stage for domestic hot water. Heats from mains temperature (~10°C) to preheat setpoint (45°C). Gas boiler or immersion tops up to 60°C.",
        "cop":                  2.8,
        "efficiency_type":      "cop",
        "efficiency_value":     2.8,
        "hot_water_setpoint_c": 60.0,
        "preheat_setpoint_c":   45.0,
        "fuel_type":            "electricity",
        "has_heat_rejection":   False,
        "has_exhaust_waste":    False,
    },

    "electric_immersion": {
        "display_name":         "Electric Immersion — DHW",
        "type":                 "electric_immersion",
        "category":             "dhw",
        "serves":               "dhw",
        "description":          "Direct electric water heating. 100% efficient at point of use but high running cost. Often used as backup.",
        "efficiency":           1.0,
        "efficiency_type":      "thermal_efficiency",
        "efficiency_value":     1.0,
        "fuel_type":            "electricity",
        "has_heat_rejection":   False,
        "has_exhaust_waste":    False,
    },

    "solar_thermal_dhw": {
        "display_name":         "Solar Thermal — DHW Preheat",
        "type":                 "solar_thermal",
        "category":             "dhw",
        "serves":               "dhw",
        "description":          "Solar thermal panels for DHW preheat. Zero operating emissions. Contribution varies by season — backup system always required.",
        "efficiency":           0.5,    # annual average solar fraction
        "efficiency_type":      "thermal_efficiency",
        "efficiency_value":     0.5,
        "fuel_type":            "renewable",
        "has_heat_rejection":   False,
        "has_exhaust_waste":    False,
    },

    # ── Ventilation systems ──────────────────────────────────────────────────

    "mev_standard": {
        "display_name":         "Mechanical Extract Ventilation",
        "type":                 "mev",
        "category":             "ventilation",
        "serves":               "ventilation",
        "description":          "Centralised mechanical extract with trickle vent supply. No heat recovery. Standard for UK hotel bedrooms under Part F.",
        "specific_fan_power":   1.5,     # W/(l/s) — renamed from sfp for clarity
        "sfp":                  1.5,     # backward compat
        "heat_recovery_efficiency": 0.0,
        "efficiency_type":      "sfp",
        "efficiency_value":     1.5,
        "fuel_type":            "electricity",
        "has_heat_rejection":   False,
        "has_exhaust_waste":    True,    # all exhaust heat wasted
    },

    "mvhr_standard": {
        "display_name":         "MVHR — Mechanical Ventilation with Heat Recovery",
        "type":                 "mvhr",
        "category":             "ventilation",
        "serves":               "ventilation",
        "description":          "Balanced supply and extract with heat recovery. Recovers 75-85% of exhaust heat. Reduces heating demand significantly.",
        "specific_fan_power":   1.8,     # W/(l/s) — higher than MEV due to supply fan
        "sfp":                  1.8,     # backward compat
        "heat_recovery_efficiency": 0.82,
        "efficiency_type":      "heat_recovery",
        "efficiency_value":     0.82,
        "fuel_type":            "electricity",
        "has_heat_rejection":   False,
        "has_exhaust_waste":    False,   # heat is recovered
    },

    "natural_vent_windows": {
        "display_name":         "Natural Ventilation — Opening Windows",
        "type":                 "natural_ventilation",
        "category":             "ventilation",
        "serves":               "ventilation",
        "description":          "Openable windows with occupant-controlled ventilation. Provides summer cooling potential but causes heating losses in winter.",
        "specific_fan_power":   0.0,
        "sfp":                  0.0,
        "heat_recovery_efficiency": 0.0,
        "efficiency_type":      "sfp",
        "efficiency_value":     0.0,
        "opening_threshold_temp_c": 22.0,
        "max_opening_fraction": 0.5,
        "fuel_type":            None,
        "has_heat_rejection":   False,
        "has_exhaust_waste":    True,    # no recovery
    },
}

# ── Public API ────────────────────────────────────────────────────────────────

def list_systems(category: str | None = None, serves: str | None = None) -> list[dict]:
    """
    Return a summary list of all available system templates.

    Parameters
    ----------
    category : str | None
        Filter by category: "heating", "cooling", "hvac", "dhw", "ventilation". None returns all.
    serves : str | None
        Filter by serves field: "heating", "cooling", "heating_and_cooling", "dhw", "ventilation".
    """
    result = []
    for name, data in _SYSTEMS.items():
        if category and data.get("category") != category:
            continue
        if serves and data.get("serves") != serves:
            continue
        result.append({
            "name":                     name,
            "display_name":             data["display_name"],
            "type":                     data["type"],
            "category":                 data["category"],
            "serves":                   data.get("serves"),
            "description":              data["description"],
            "fuel_type":                data.get("fuel_type"),
            "efficiency_type":          data.get("efficiency_type"),
            "efficiency_value":         data.get("efficiency_value"),
            "has_heat_rejection":       data.get("has_heat_rejection", False),
            "has_exhaust_waste":        data.get("has_exhaust_waste", False),
            # Keep legacy fields for backward compat
            "heating_cop":              data.get("heating_cop") or data.get("scop") or data.get("cop"),
            "cooling_eer":              data.get("cooling_eer") or data.get("seer"),
            "efficiency":               data.get("efficiency"),
            "specific_fan_power":       data.get("specific_fan_power") or data.get("sfp"),
            "heat_recovery_efficiency": data.get("heat_recovery_efficiency"),
        })
    return result


def get_system(name: str) -> dict:
    """
    Return the full template dict for a named system.

    Raises KeyError if not found.
    """
    if name not in _SYSTEMS:
        available = ", ".join(_SYSTEMS.keys())
        raise KeyError(f"System '{name}' not found. Available: {available}")
    return dict(_SYSTEMS[name])
