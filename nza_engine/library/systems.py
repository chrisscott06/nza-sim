"""
nza_engine/library/systems.py

HVAC and services system templates for hotel buildings.

Each template defines parameters that feed into:
  - EnergyPlus HVAC object generation (in the assembler)
  - Simplified energy calculations (COP, SFP, etc.)
  - UI display in the Systems & Zones module

Usage
-----
    from nza_engine.library.systems import list_systems, get_system

    all_systems = list_systems()
    vrf = get_system("vrf_standard")
"""

from typing import Any

# ── System template library ───────────────────────────────────────────────────

_SYSTEMS: dict[str, dict[str, Any]] = {

    # ── HVAC — Space heating & cooling ──────────────────────────────────────────

    "vrf_standard": {
        "display_name":         "VRF System — Standard",
        "type":                 "vrf",
        "category":             "hvac",
        "description":          "Variable Refrigerant Flow split system. Industry-standard choice for hotel bedrooms. Provides both heating and cooling from a single outdoor unit.",
        "heating_cop":          3.5,
        "cooling_eer":          3.2,
        "fan_power_w_per_m2":   3.0,
        "min_outdoor_temp_c":   -15.0,
        "defrost_strategy":     "reverse_cycle",
        "fuel_type":            "electricity",
    },

    "vrf_high_efficiency": {
        "display_name":         "VRF System — High Efficiency",
        "type":                 "vrf",
        "category":             "hvac",
        "description":          "Premium VRF system with higher COP/EER. Suitable for BREEAM Excellent or net-zero carbon projects.",
        "heating_cop":          4.2,
        "cooling_eer":          4.0,
        "fan_power_w_per_m2":   2.5,
        "min_outdoor_temp_c":   -20.0,
        "defrost_strategy":     "reverse_cycle",
        "fuel_type":            "electricity",
    },

    "ashp_space": {
        "display_name":         "Air Source Heat Pump — Space Heating",
        "type":                 "ashp",
        "category":             "hvac",
        "description":          "Centralised ASHP providing space heating via a heat distribution network. Cooling provided separately (e.g. chiller).",
        "heating_cop":          3.0,
        "cooling_eer":          None,
        "fan_power_w_per_m2":   2.0,
        "min_outdoor_temp_c":   -10.0,
        "fuel_type":            "electricity",
    },

    "gas_boiler_standard": {
        "display_name":         "Gas Boiler — Condensing Standard",
        "type":                 "gas_boiler",
        "category":             "hvac",
        "description":          "Condensing gas boiler for space heating. Common legacy plant. High carbon intensity — generally not preferred for new hotels.",
        "efficiency":           0.92,
        "heating_cop":          0.92,
        "cooling_eer":          None,
        "fuel_type":            "gas",
    },

    # ── DHW ─────────────────────────────────────────────────────────────────────

    "ashp_dhw": {
        "display_name":         "ASHP — Domestic Hot Water",
        "type":                 "ashp_dhw",
        "category":             "dhw",
        "description":          "Air source heat pump for domestic hot water pre-heating. Preheat to 45°C; top up to 60°C with electric immersion or gas.",
        "heating_cop":          2.8,
        "hot_water_setpoint_c": 60.0,
        "preheat_setpoint_c":   45.0,
        "fuel_type":            "electricity",
    },

    "gas_boiler_dhw": {
        "display_name":         "Gas Boiler — DHW Backup",
        "type":                 "gas_boiler_dhw",
        "category":             "dhw",
        "description":          "Condensing gas boiler for domestic hot water backup / top-up. Typically paired with ASHP preheat.",
        "efficiency":           0.92,
        "fuel_type":            "gas",
    },

    "electric_immersion": {
        "display_name":         "Electric Immersion — DHW Backup",
        "type":                 "electric_immersion",
        "category":             "dhw",
        "description":          "Direct electric water heating. 100% efficient at point of use but high running cost. Often used as backup.",
        "efficiency":           1.0,
        "fuel_type":            "electricity",
    },

    # ── Ventilation ──────────────────────────────────────────────────────────────

    "mev_standard": {
        "display_name":         "Mechanical Extract Ventilation",
        "type":                 "mev",
        "category":             "ventilation",
        "description":          "Centralised mechanical extract with trickle vent supply. No heat recovery. Standard for UK hotel bedrooms under Part F.",
        "specific_fan_power":   1.5,   # W/(l/s)
        "heat_recovery_efficiency": 0.0,
        "fuel_type":            "electricity",
    },

    "mvhr_standard": {
        "display_name":         "MVHR — Mechanical Ventilation with Heat Recovery",
        "type":                 "mvhr",
        "category":             "ventilation",
        "description":          "Balanced supply and extract with heat recovery. Recovers 75-85% of exhaust heat. Reduces heating demand significantly.",
        "specific_fan_power":   1.8,   # W/(l/s) — higher than MEV due to supply fan
        "heat_recovery_efficiency": 0.82,
        "fuel_type":            "electricity",
    },

    "natural_vent_windows": {
        "display_name":         "Natural Ventilation — Opening Windows",
        "type":                 "natural_ventilation",
        "category":             "ventilation",
        "description":          "Openable windows with occupant-controlled ventilation. Provides summer cooling potential but causes heating losses in winter.",
        "specific_fan_power":   0.0,
        "heat_recovery_efficiency": 0.0,
        "opening_threshold_temp_c": 22.0,
        "max_opening_fraction": 0.5,
        "fuel_type":            None,
    },
}

# ── Public API ────────────────────────────────────────────────────────────────

def list_systems(category: str | None = None) -> list[dict]:
    """
    Return a summary list of all available system templates.

    Parameters
    ----------
    category : str | None
        Filter by category: "hvac", "dhw", "ventilation". None returns all.
    """
    result = []
    for name, data in _SYSTEMS.items():
        if category and data.get("category") != category:
            continue
        result.append({
            "name":         name,
            "display_name": data["display_name"],
            "type":         data["type"],
            "category":     data["category"],
            "description":  data["description"],
            "fuel_type":    data.get("fuel_type"),
            "heating_cop":  data.get("heating_cop"),
            "cooling_eer":  data.get("cooling_eer"),
            "efficiency":   data.get("efficiency"),
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
