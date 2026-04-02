"""
nza_engine/library/loads.py

Internal load definitions for hotel zone types.

Values are based on CIBSE Guide A Table 6.x and NCM activity database
entries for hotel/residential accommodation.

Peak density values (watts, people/m², etc.) are used with the fractional
schedules from schedules.py to compute instantaneous loads in EnergyPlus.

Each zone type entry contains:
  occupancy_density_people_per_m2 — peak occupancy
  lighting_power_density_W_per_m2 — installed lighting power (peak)
  equipment_power_density_W_per_m2 — installed small power (peak)
  ventilation_l_per_s_per_person   — fresh air rate (CIBSE Guide A / BB101)
  dhw_litres_per_person_per_day    — daily DHW demand at peak occupancy
  metabolic_rate_W_per_person      — sensible heat gain per person (CIBSE)
  latent_fraction                  — fraction of metabolic heat that is latent
"""

from typing import Any

# ── Zone type definitions ─────────────────────────────────────────────────────
# Occupancy note: EnergyPlus People object uses m²/person (floor area per person)
# We store people/m² here and invert in the assembler.

ZONE_LOADS: dict[str, dict[str, Any]] = {

    "hotel_bedroom": {
        "description": "Hotel bedroom/ensuite — single occupancy basis",
        # Peak: ~2 people per standard double room of ~22 m² = 0.091 ppl/m²
        "occupancy_density_people_per_m2": 0.09,
        # NCM hotel bedroom: 5 W/m² lighting, 10 W/m² small power
        "lighting_power_density_W_per_m2": 7.0,
        "equipment_power_density_W_per_m2": 10.0,
        # CIBSE Guide A: bedroom ventilation 8 l/s/person
        "ventilation_l_per_s_per_person": 8.0,
        # CIBSE TM57: hotel bedroom DHW ~50–80 l/person/day, use 65
        "dhw_litres_per_person_per_day": 65.0,
        # CIBSE Guide A: seated/resting adult ~75 W sensible, 50 W latent
        "metabolic_rate_W_per_person": 75.0,
        "latent_fraction": 0.40,
        # Schedule names (must exist in schedules.py)
        "occupancy_schedule": "hotel_bedroom_occupancy",
        "lighting_schedule": "hotel_bedroom_lighting",
        "equipment_schedule": "hotel_bedroom_equipment",
        "heating_setpoint_schedule": "hotel_heating_setpoint",
        "cooling_setpoint_schedule": "hotel_cooling_setpoint",
    },

    "hotel_corridor": {
        "description": "Hotel corridor, lift lobby, stairwell",
        # Corridors: low density transient use
        "occupancy_density_people_per_m2": 0.02,
        # NCM: corridors 5 W/m² lighting (largely standby)
        "lighting_power_density_W_per_m2": 5.0,
        "equipment_power_density_W_per_m2": 3.0,    # vending/signage/lifts
        # Ventilation: extract only for hotels, 10 l/s/person
        "ventilation_l_per_s_per_person": 10.0,
        "dhw_litres_per_person_per_day": 0.0,
        "metabolic_rate_W_per_person": 90.0,         # walking activity
        "latent_fraction": 0.35,
        "occupancy_schedule": "hotel_corridor_occupancy",
        "lighting_schedule": "hotel_corridor_lighting",
        "equipment_schedule": "hotel_common_equipment",
        "heating_setpoint_schedule": "hotel_heating_setpoint",
        "cooling_setpoint_schedule": "hotel_cooling_setpoint",
    },

    "hotel_reception": {
        "description": "Hotel reception, lobby, check-in area",
        # NCM reception: 0.2 ppl/m² at peak
        "occupancy_density_people_per_m2": 0.20,
        "lighting_power_density_W_per_m2": 12.0,
        "equipment_power_density_W_per_m2": 15.0,    # PCs, printers, screens
        "ventilation_l_per_s_per_person": 10.0,
        "dhw_litres_per_person_per_day": 0.0,
        "metabolic_rate_W_per_person": 90.0,
        "latent_fraction": 0.35,
        "occupancy_schedule": "hotel_corridor_occupancy",
        "lighting_schedule": "hotel_corridor_lighting",
        "equipment_schedule": "hotel_common_equipment",
        "heating_setpoint_schedule": "hotel_heating_setpoint",
        "cooling_setpoint_schedule": "hotel_cooling_setpoint",
    },

    "hotel_restaurant": {
        "description": "Hotel restaurant / bar / dining",
        # NCM restaurant: 0.5–1.0 ppl/m²; use 0.6 for hotel dining
        "occupancy_density_people_per_m2": 0.60,
        "lighting_power_density_W_per_m2": 15.0,
        "equipment_power_density_W_per_m2": 25.0,    # kitchen equipment
        "ventilation_l_per_s_per_person": 12.0,
        "dhw_litres_per_person_per_day": 5.0,
        "metabolic_rate_W_per_person": 90.0,
        "latent_fraction": 0.50,
        "occupancy_schedule": "hotel_corridor_occupancy",
        "lighting_schedule": "hotel_corridor_lighting",
        "equipment_schedule": "hotel_common_equipment",
        "heating_setpoint_schedule": "hotel_heating_setpoint",
        "cooling_setpoint_schedule": "hotel_cooling_setpoint",
    },
}


# ── Public API ────────────────────────────────────────────────────────────────

def get_zone_loads(zone_type: str) -> dict:
    """
    Return internal load definitions for a zone type.

    Parameters
    ----------
    zone_type : str — one of hotel_bedroom, hotel_corridor,
                      hotel_reception, hotel_restaurant

    Returns
    -------
    dict of load parameters

    Raises KeyError if zone_type is not found.
    """
    if zone_type not in ZONE_LOADS:
        available = ", ".join(ZONE_LOADS.keys())
        raise KeyError(
            f"Zone type '{zone_type}' not found. Available: {available}"
        )
    return dict(ZONE_LOADS[zone_type])


def list_zone_types() -> list[dict]:
    """Return a summary of all available zone types."""
    return [
        {
            "name": name,
            "description": data["description"],
            "occupancy_ppl_per_m2": data["occupancy_density_people_per_m2"],
            "lighting_W_per_m2": data["lighting_power_density_W_per_m2"],
            "equipment_W_per_m2": data["equipment_power_density_W_per_m2"],
        }
        for name, data in ZONE_LOADS.items()
    ]
