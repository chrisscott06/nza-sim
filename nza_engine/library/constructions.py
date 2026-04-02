"""
nza_engine/library/constructions.py

Pre-defined construction buildups for EnergyPlus.

Each construction is returned as a dict of epJSON-ready objects:
  - "Material"                       — opaque layers with thickness
  - "Material:NoMass"                — (used where needed)
  - "WindowMaterial:SimpleGlazingSystem" — glazing (U + g-value)
  - "Construction"                   — ordered layer list

All U-values are indicative (based on CIBSE Guide A and NCM typical values)
and are documented alongside layer properties for cross-checking.

Layer conductivity, density, and specific heat values are taken from:
  - CIBSE Guide A Table 3.4 / 3.6
  - ASHRAE HOF 2021
  - EnergyPlus default material database

Usage
-----
    from nza_engine.library.constructions import get_construction, list_constructions

    all_constructions = list_constructions()
    epjson_objects = get_construction("cavity_wall_standard")
"""

from copy import deepcopy
from typing import Any

# ── Material helpers ───────────────────────────────────────────────────────────

def _mat(name: str, thickness: float, conductivity: float,
         density: float, specific_heat: float,
         roughness: str = "MediumRough") -> dict:
    """EnergyPlus Material object (opaque layer)."""
    return {
        "roughness": roughness,
        "thickness": thickness,
        "conductivity": conductivity,
        "density": density,
        "specific_heat": specific_heat,
    }


def _mat_nomass(name: str, thermal_resistance: float,
                roughness: str = "MediumRough") -> dict:
    """EnergyPlus Material:NoMass object (resistance-only layer)."""
    return {
        "roughness": roughness,
        "thermal_resistance": thermal_resistance,
    }


def _construction(layer_names: list[str]) -> dict:
    """EnergyPlus Construction object — ordered outside to inside."""
    obj: dict[str, Any] = {}
    field_names = [
        "outside_layer",
        "layer_2", "layer_3", "layer_4", "layer_5",
        "layer_6", "layer_7", "layer_8", "layer_9", "layer_10",
    ]
    for field, layer in zip(field_names, layer_names):
        obj[field] = layer
    return obj


# ── Construction definitions ──────────────────────────────────────────────────
#
# Each entry in _CONSTRUCTIONS is a dict with:
#   "summary"       — human-readable description and indicative U-value
#   "Material"      — {name: epJSON Material object}
#   "Material:NoMass" — {name: epJSON Material:NoMass object}
#   "WindowMaterial:SimpleGlazingSystem" — (glazing only)
#   "Construction"  — {name: epJSON Construction object}
#
# Construction name keys match the name used in the Construction object.
# ─────────────────────────────────────────────────────────────────────────────

_CONSTRUCTIONS: dict[str, dict] = {}

# ── Walls ─────────────────────────────────────────────────────────────────────

_CONSTRUCTIONS["cavity_wall_standard"] = {
    "summary": {
        "description": "Brick outer leaf, 100mm mineral wool cavity, dense concrete block inner, plasterboard",
        "u_value_W_per_m2K": 0.28,
        "thermal_mass": "medium",
        "type": "wall",
    },
    "Material": {
        "CavWall_Std_BrickOuter": _mat(
            "CavWall_Std_BrickOuter",
            thickness=0.102, conductivity=0.77, density=1700, specific_heat=800,
            roughness="Rough",
        ),
        "CavWall_Std_MineralWool100": _mat(
            "CavWall_Std_MineralWool100",
            thickness=0.100, conductivity=0.038, density=15, specific_heat=1030,
        ),
        "CavWall_Std_ConcreteBlock": _mat(
            "CavWall_Std_ConcreteBlock",
            thickness=0.100, conductivity=0.51, density=1400, specific_heat=1000,
        ),
        "CavWall_Std_Plasterboard": _mat(
            "CavWall_Std_Plasterboard",
            thickness=0.013, conductivity=0.16, density=950, specific_heat=840,
            roughness="Smooth",
        ),
    },
    "Material:NoMass": {},
    "WindowMaterial:SimpleGlazingSystem": {},
    "Construction": {
        "cavity_wall_standard": _construction([
            "CavWall_Std_BrickOuter",
            "CavWall_Std_MineralWool100",
            "CavWall_Std_ConcreteBlock",
            "CavWall_Std_Plasterboard",
        ]),
    },
}

_CONSTRUCTIONS["cavity_wall_enhanced"] = {
    "summary": {
        "description": "Brick outer leaf, 150mm PIR cavity insulation, dense concrete block, plasterboard",
        "u_value_W_per_m2K": 0.18,
        "thermal_mass": "medium",
        "type": "wall",
    },
    "Material": {
        "CavWall_Enh_BrickOuter": _mat(
            "CavWall_Enh_BrickOuter",
            thickness=0.102, conductivity=0.77, density=1700, specific_heat=800,
            roughness="Rough",
        ),
        "CavWall_Enh_PIR150": _mat(
            "CavWall_Enh_PIR150",
            thickness=0.150, conductivity=0.022, density=30, specific_heat=1400,
        ),
        "CavWall_Enh_ConcreteBlock": _mat(
            "CavWall_Enh_ConcreteBlock",
            thickness=0.100, conductivity=0.51, density=1400, specific_heat=1000,
        ),
        "CavWall_Enh_Plasterboard": _mat(
            "CavWall_Enh_Plasterboard",
            thickness=0.013, conductivity=0.16, density=950, specific_heat=840,
            roughness="Smooth",
        ),
    },
    "Material:NoMass": {},
    "WindowMaterial:SimpleGlazingSystem": {},
    "Construction": {
        "cavity_wall_enhanced": _construction([
            "CavWall_Enh_BrickOuter",
            "CavWall_Enh_PIR150",
            "CavWall_Enh_ConcreteBlock",
            "CavWall_Enh_Plasterboard",
        ]),
    },
}

_CONSTRUCTIONS["timber_frame_standard"] = {
    "summary": {
        "description": "Brick outer leaf, cavity, OSB sheathing, 140mm mineral wool between studs, plasterboard",
        "u_value_W_per_m2K": 0.22,
        "thermal_mass": "low",
        "type": "wall",
    },
    "Material": {
        "TF_Std_BrickOuter": _mat(
            "TF_Std_BrickOuter",
            thickness=0.102, conductivity=0.77, density=1700, specific_heat=800,
            roughness="Rough",
        ),
        "TF_Std_OSB": _mat(
            "TF_Std_OSB",
            thickness=0.012, conductivity=0.13, density=650, specific_heat=1700,
        ),
        "TF_Std_MineralWool140": _mat(
            "TF_Std_MineralWool140",
            thickness=0.140, conductivity=0.038, density=15, specific_heat=1030,
        ),
        "TF_Std_Plasterboard": _mat(
            "TF_Std_Plasterboard",
            thickness=0.013, conductivity=0.16, density=950, specific_heat=840,
            roughness="Smooth",
        ),
    },
    "Material:NoMass": {
        "TF_Std_AirCavity": _mat_nomass("TF_Std_AirCavity", thermal_resistance=0.18),
    },
    "WindowMaterial:SimpleGlazingSystem": {},
    "Construction": {
        "timber_frame_standard": _construction([
            "TF_Std_BrickOuter",
            "TF_Std_AirCavity",
            "TF_Std_OSB",
            "TF_Std_MineralWool140",
            "TF_Std_Plasterboard",
        ]),
    },
}

# ── Roofs ─────────────────────────────────────────────────────────────────────

_CONSTRUCTIONS["flat_roof_standard"] = {
    "summary": {
        "description": "Concrete deck, vapour barrier, 120mm PIR insulation, waterproofing",
        "u_value_W_per_m2K": 0.18,
        "thermal_mass": "high",
        "type": "roof",
    },
    "Material": {
        "FlatRoof_Std_Waterproof": _mat(
            "FlatRoof_Std_Waterproof",
            thickness=0.005, conductivity=0.20, density=1100, specific_heat=1000,
            roughness="MediumSmooth",
        ),
        "FlatRoof_Std_PIR120": _mat(
            "FlatRoof_Std_PIR120",
            thickness=0.120, conductivity=0.022, density=30, specific_heat=1400,
        ),
        "FlatRoof_Std_VapourBarrier": _mat(
            "FlatRoof_Std_VapourBarrier",
            thickness=0.002, conductivity=0.19, density=920, specific_heat=2090,
        ),
        "FlatRoof_Std_ConcreteDeck": _mat(
            "FlatRoof_Std_ConcreteDeck",
            thickness=0.150, conductivity=1.13, density=2000, specific_heat=1000,
        ),
    },
    "Material:NoMass": {},
    "WindowMaterial:SimpleGlazingSystem": {},
    "Construction": {
        "flat_roof_standard": _construction([
            "FlatRoof_Std_Waterproof",
            "FlatRoof_Std_PIR120",
            "FlatRoof_Std_VapourBarrier",
            "FlatRoof_Std_ConcreteDeck",
        ]),
    },
}

_CONSTRUCTIONS["flat_roof_enhanced"] = {
    "summary": {
        "description": "Concrete deck, vapour barrier, 200mm PIR insulation, waterproofing",
        "u_value_W_per_m2K": 0.11,
        "thermal_mass": "high",
        "type": "roof",
    },
    "Material": {
        "FlatRoof_Enh_Waterproof": _mat(
            "FlatRoof_Enh_Waterproof",
            thickness=0.005, conductivity=0.20, density=1100, specific_heat=1000,
            roughness="MediumSmooth",
        ),
        "FlatRoof_Enh_PIR200": _mat(
            "FlatRoof_Enh_PIR200",
            thickness=0.200, conductivity=0.022, density=30, specific_heat=1400,
        ),
        "FlatRoof_Enh_VapourBarrier": _mat(
            "FlatRoof_Enh_VapourBarrier",
            thickness=0.002, conductivity=0.19, density=920, specific_heat=2090,
        ),
        "FlatRoof_Enh_ConcreteDeck": _mat(
            "FlatRoof_Enh_ConcreteDeck",
            thickness=0.150, conductivity=1.13, density=2000, specific_heat=1000,
        ),
    },
    "Material:NoMass": {},
    "WindowMaterial:SimpleGlazingSystem": {},
    "Construction": {
        "flat_roof_enhanced": _construction([
            "FlatRoof_Enh_Waterproof",
            "FlatRoof_Enh_PIR200",
            "FlatRoof_Enh_VapourBarrier",
            "FlatRoof_Enh_ConcreteDeck",
        ]),
    },
}

_CONSTRUCTIONS["pitched_roof_standard"] = {
    "summary": {
        "description": "Tiles, battens, membrane, 200mm mineral wool between rafters, plasterboard",
        "u_value_W_per_m2K": 0.16,
        "thermal_mass": "low",
        "type": "roof",
    },
    "Material": {
        "PitchedRoof_Std_Tiles": _mat(
            "PitchedRoof_Std_Tiles",
            thickness=0.012, conductivity=0.84, density=1900, specific_heat=800,
            roughness="Rough",
        ),
        "PitchedRoof_Std_MineralWool200": _mat(
            "PitchedRoof_Std_MineralWool200",
            thickness=0.200, conductivity=0.038, density=15, specific_heat=1030,
        ),
        "PitchedRoof_Std_Plasterboard": _mat(
            "PitchedRoof_Std_Plasterboard",
            thickness=0.013, conductivity=0.16, density=950, specific_heat=840,
            roughness="Smooth",
        ),
    },
    "Material:NoMass": {
        "PitchedRoof_Std_Membrane": _mat_nomass("PitchedRoof_Std_Membrane", 0.06),
    },
    "WindowMaterial:SimpleGlazingSystem": {},
    "Construction": {
        "pitched_roof_standard": _construction([
            "PitchedRoof_Std_Tiles",
            "PitchedRoof_Std_Membrane",
            "PitchedRoof_Std_MineralWool200",
            "PitchedRoof_Std_Plasterboard",
        ]),
    },
}

# ── Ground floors ─────────────────────────────────────────────────────────────

_CONSTRUCTIONS["ground_floor_slab"] = {
    "summary": {
        "description": "Carpet, screed, 150mm concrete slab, 100mm XPS insulation, hardcore",
        "u_value_W_per_m2K": 0.22,
        "thermal_mass": "high",
        "type": "floor",
    },
    "Material": {
        "GFloor_Std_Carpet": _mat(
            "GFloor_Std_Carpet",
            thickness=0.010, conductivity=0.06, density=200, specific_heat=1300,
            roughness="MediumRough",
        ),
        "GFloor_Std_Screed": _mat(
            "GFloor_Std_Screed",
            thickness=0.065, conductivity=0.41, density=1200, specific_heat=840,
        ),
        "GFloor_Std_ConcreteSlab": _mat(
            "GFloor_Std_ConcreteSlab",
            thickness=0.150, conductivity=1.13, density=2000, specific_heat=1000,
        ),
        "GFloor_Std_XPS100": _mat(
            "GFloor_Std_XPS100",
            thickness=0.100, conductivity=0.033, density=35, specific_heat=1400,
        ),
    },
    "Material:NoMass": {},
    "WindowMaterial:SimpleGlazingSystem": {},
    "Construction": {
        "ground_floor_slab": _construction([
            "GFloor_Std_Carpet",
            "GFloor_Std_Screed",
            "GFloor_Std_ConcreteSlab",
            "GFloor_Std_XPS100",
        ]),
    },
}

_CONSTRUCTIONS["ground_floor_enhanced"] = {
    "summary": {
        "description": "Carpet, screed, 150mm concrete slab, 150mm XPS insulation, hardcore",
        "u_value_W_per_m2K": 0.15,
        "thermal_mass": "high",
        "type": "floor",
    },
    "Material": {
        "GFloor_Enh_Carpet": _mat(
            "GFloor_Enh_Carpet",
            thickness=0.010, conductivity=0.06, density=200, specific_heat=1300,
            roughness="MediumRough",
        ),
        "GFloor_Enh_Screed": _mat(
            "GFloor_Enh_Screed",
            thickness=0.065, conductivity=0.41, density=1200, specific_heat=840,
        ),
        "GFloor_Enh_ConcreteSlab": _mat(
            "GFloor_Enh_ConcreteSlab",
            thickness=0.150, conductivity=1.13, density=2000, specific_heat=1000,
        ),
        "GFloor_Enh_XPS150": _mat(
            "GFloor_Enh_XPS150",
            thickness=0.150, conductivity=0.033, density=35, specific_heat=1400,
        ),
    },
    "Material:NoMass": {},
    "WindowMaterial:SimpleGlazingSystem": {},
    "Construction": {
        "ground_floor_enhanced": _construction([
            "GFloor_Enh_Carpet",
            "GFloor_Enh_Screed",
            "GFloor_Enh_ConcreteSlab",
            "GFloor_Enh_XPS150",
        ]),
    },
}

# ── Interior floor/ceiling (between hotel floors) ─────────────────────────────

_CONSTRUCTIONS["interior_floor_ceiling"] = {
    "summary": {
        "description": "Carpet, screed, 200mm reinforced concrete, plaster skim",
        "u_value_W_per_m2K": None,   # interior — no meaningful U-value
        "thermal_mass": "high",
        "type": "interior",
    },
    "Material": {
        "IntFloor_Carpet": _mat(
            "IntFloor_Carpet",
            thickness=0.010, conductivity=0.06, density=200, specific_heat=1300,
            roughness="MediumRough",
        ),
        "IntFloor_Screed": _mat(
            "IntFloor_Screed",
            thickness=0.065, conductivity=0.41, density=1200, specific_heat=840,
        ),
        "IntFloor_Concrete200": _mat(
            "IntFloor_Concrete200",
            thickness=0.200, conductivity=1.13, density=2000, specific_heat=1000,
        ),
        "IntFloor_Plaster": _mat(
            "IntFloor_Plaster",
            thickness=0.013, conductivity=0.50, density=1300, specific_heat=1000,
            roughness="Smooth",
        ),
    },
    "Material:NoMass": {},
    "WindowMaterial:SimpleGlazingSystem": {},
    "Construction": {
        "interior_floor_ceiling": _construction([
            "IntFloor_Carpet",
            "IntFloor_Screed",
            "IntFloor_Concrete200",
            "IntFloor_Plaster",
        ]),
    },
}

# ── Glazing ───────────────────────────────────────────────────────────────────

_CONSTRUCTIONS["double_low_e"] = {
    "summary": {
        "description": "Double glazing, low-e coating, argon filled",
        "u_value_W_per_m2K": 1.4,
        "g_value": 0.42,
        "thermal_mass": None,
        "type": "glazing",
    },
    "Material": {},
    "Material:NoMass": {},
    "WindowMaterial:SimpleGlazingSystem": {
        "double_low_e_glazing": {
            "u_factor": 1.4,
            "solar_heat_gain_coefficient": 0.42,
        },
    },
    "Construction": {
        "double_low_e": {
            "outside_layer": "double_low_e_glazing",
        },
    },
}

_CONSTRUCTIONS["triple_glazing"] = {
    "summary": {
        "description": "Triple glazing, double low-e coatings, argon filled",
        "u_value_W_per_m2K": 0.8,
        "g_value": 0.35,
        "thermal_mass": None,
        "type": "glazing",
    },
    "Material": {},
    "Material:NoMass": {},
    "WindowMaterial:SimpleGlazingSystem": {
        "triple_glazing_glazing": {
            "u_factor": 0.8,
            "solar_heat_gain_coefficient": 0.35,
        },
    },
    "Construction": {
        "triple_glazing": {
            "outside_layer": "triple_glazing_glazing",
        },
    },
}


# ── Public API ────────────────────────────────────────────────────────────────

def list_constructions() -> list[dict]:
    """
    Return a summary list of all available constructions.

    Returns
    -------
    list of dicts with keys: name, description, type, u_value_W_per_m2K
    """
    result = []
    for name, data in _CONSTRUCTIONS.items():
        s = data["summary"]
        entry = {
            "name": name,
            "description": s["description"],
            "type": s["type"],
            "u_value_W_per_m2K": s.get("u_value_W_per_m2K"),
        }
        if "g_value" in s:
            entry["g_value"] = s["g_value"]
        result.append(entry)
    return result


def get_construction(name: str) -> dict:
    """
    Return the full epJSON-ready definition for a construction.

    Returns a dict with keys:
        "Material"
        "Material:NoMass"
        "WindowMaterial:SimpleGlazingSystem"
        "Construction"

    Raises KeyError if the construction name is not found.
    """
    if name not in _CONSTRUCTIONS:
        available = ", ".join(_CONSTRUCTIONS.keys())
        raise KeyError(
            f"Construction '{name}' not found. Available: {available}"
        )
    data = deepcopy(_CONSTRUCTIONS[name])
    # Remove the internal summary key — not an epJSON object
    data.pop("summary", None)
    return data
