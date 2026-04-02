"""
nza_engine/library/schedules.py

Pre-defined EnergyPlus Schedule:Compact definitions for a hotel building.

Schedule values are fractional (0–1) multipliers applied to peak densities
defined in loads.py, except for thermostat setpoint schedules which are
in degrees Celsius.

All schedules follow EnergyPlus Schedule:Compact syntax:
  Through: MM/DD     — date range
  For: Weekdays      — day type
  Until: HH:MM, val  — value until this time

Hotel building schedule basis:
  - Bedroom occupancy: high night, low day (typical hotel pattern)
  - Corridor occupancy: inverse — higher during movement hours
  - Lighting: follows occupancy with dusk/dawn offsets
  - Equipment: loose correlation with occupancy
  - HVAC setpoints: 21°C/24°C occupied, 18°C/28°C setback
  - DHW: morning (06:00–10:00) and evening (17:00–22:00) peaks

Source basis: CIBSE Guide A Table 6.x, NCM activity database (hotel).
"""

from typing import Any

# ── Schedule:Compact builder helper ──────────────────────────────────────────

def _compact(name: str, type_limits: str, data: list[str]) -> dict:
    """
    Build a Schedule:Compact epJSON object.

    Parameters
    ----------
    name        : EnergyPlus object name (key in the epJSON dict)
    type_limits : "Fraction" | "Temperature" | "On/Off" | etc.
    data        : list of Through/For/Until strings (schedule body)
    """
    obj: dict[str, Any] = {
        "schedule_type_limits_name": type_limits,
    }
    for i, line in enumerate(data, start=1):
        obj[f"field_{i}"] = line
    return obj


# ── Schedule type limits ──────────────────────────────────────────────────────
# These must be declared in the epJSON alongside the schedules.

SCHEDULE_TYPE_LIMITS: dict[str, dict] = {
    "Fraction": {
        "lower_limit_value": 0.0,
        "upper_limit_value": 1.0,
        "numeric_type": "Continuous",
    },
    "Temperature": {
        "lower_limit_value": -60.0,
        "upper_limit_value": 200.0,
        "numeric_type": "Continuous",
        "unit_type": "Temperature",
    },
    "On/Off": {
        "lower_limit_value": 0,
        "upper_limit_value": 1,
        "numeric_type": "Discrete",
    },
}


# ── Hotel schedule definitions ────────────────────────────────────────────────
#
# Pattern key for hotel bedrooms (fraction of peak occupancy):
#   00:00–06:00  0.90  (guests asleep)
#   06:00–08:00  0.70  (waking, some checking out)
#   08:00–12:00  0.30  (most guests out for breakfast/activities)
#   12:00–14:00  0.20  (checkout / low period)
#   14:00–18:00  0.40  (check-in begins, afternoon rest)
#   18:00–22:00  0.70  (guests returning, evening in room)
#   22:00–24:00  0.90  (guests settled for night)
#
# Weekends: slightly higher daytime fractions (leisure guests stay in)
# ─────────────────────────────────────────────────────────────────────────────

SCHEDULES: dict[str, dict] = {}

# ── Bedroom occupancy ─────────────────────────────────────────────────────────
SCHEDULES["hotel_bedroom_occupancy"] = _compact(
    "hotel_bedroom_occupancy", "Fraction",
    [
        "Through: 12/31",
        "For: Weekdays",
        "Until: 06:00, 0.90",
        "Until: 08:00, 0.70",
        "Until: 12:00, 0.30",
        "Until: 14:00, 0.20",
        "Until: 18:00, 0.40",
        "Until: 22:00, 0.70",
        "Until: 24:00, 0.90",
        "For: Saturday Sunday",
        "Until: 07:00, 0.90",
        "Until: 10:00, 0.75",
        "Until: 14:00, 0.50",
        "Until: 18:00, 0.55",
        "Until: 22:00, 0.80",
        "Until: 24:00, 0.90",
        "For: Holidays",
        "Until: 24:00, 0.90",
        "For: SummerDesignDay",
        "Until: 24:00, 0.70",
        "For: WinterDesignDay",
        "Until: 24:00, 0.90",
    ],
)

# ── Corridor / common area occupancy ─────────────────────────────────────────
SCHEDULES["hotel_corridor_occupancy"] = _compact(
    "hotel_corridor_occupancy", "Fraction",
    [
        "Through: 12/31",
        "For: Weekdays",
        "Until: 06:00, 0.10",
        "Until: 09:00, 0.50",
        "Until: 12:00, 0.35",
        "Until: 14:00, 0.30",
        "Until: 18:00, 0.40",
        "Until: 22:00, 0.45",
        "Until: 24:00, 0.15",
        "For: Saturday Sunday",
        "Until: 07:00, 0.10",
        "Until: 11:00, 0.55",
        "Until: 14:00, 0.45",
        "Until: 18:00, 0.45",
        "Until: 22:00, 0.50",
        "Until: 24:00, 0.15",
        "For: Holidays",
        "Until: 24:00, 0.30",
        "For: SummerDesignDay",
        "Until: 24:00, 0.35",
        "For: WinterDesignDay",
        "Until: 24:00, 0.35",
    ],
)

# ── Bedroom lighting ──────────────────────────────────────────────────────────
# Lights on before bed (22:00), off during sleep, on briefly in morning
SCHEDULES["hotel_bedroom_lighting"] = _compact(
    "hotel_bedroom_lighting", "Fraction",
    [
        "Through: 12/31",
        "For: Weekdays",
        "Until: 06:00, 0.05",    # night light only
        "Until: 08:00, 0.60",    # morning getting-up
        "Until: 18:00, 0.10",    # room empty / daylight
        "Until: 22:00, 0.80",    # evening in room
        "Until: 24:00, 0.20",    # settling for sleep
        "For: Saturday Sunday",
        "Until: 07:00, 0.05",
        "Until: 10:00, 0.65",
        "Until: 18:00, 0.15",
        "Until: 22:00, 0.80",
        "Until: 24:00, 0.20",
        "For: Holidays",
        "Until: 24:00, 0.30",
        "For: SummerDesignDay",
        "Until: 24:00, 0.40",
        "For: WinterDesignDay",
        "Until: 24:00, 0.50",
    ],
)

# ── Corridor lighting ─────────────────────────────────────────────────────────
SCHEDULES["hotel_corridor_lighting"] = _compact(
    "hotel_corridor_lighting", "Fraction",
    [
        "Through: 12/31",
        "For: Weekdays Saturday Sunday",
        "Until: 07:00, 0.50",    # dimmed at night
        "Until: 23:00, 0.80",    # daytime and evening
        "Until: 24:00, 0.50",
        "For: Holidays",
        "Until: 24:00, 0.65",
        "For: SummerDesignDay",
        "Until: 24:00, 0.60",
        "For: WinterDesignDay",
        "Until: 24:00, 0.70",
    ],
)

# ── Bedroom equipment (TV, phone charging, hairdryer) ─────────────────────────
SCHEDULES["hotel_bedroom_equipment"] = _compact(
    "hotel_bedroom_equipment", "Fraction",
    [
        "Through: 12/31",
        "For: Weekdays",
        "Until: 06:00, 0.10",    # standby
        "Until: 08:00, 0.50",    # morning use (hairdryer, TV news)
        "Until: 18:00, 0.05",    # room empty
        "Until: 22:00, 0.70",    # evening TV use
        "Until: 24:00, 0.20",    # standby/charging overnight
        "For: Saturday Sunday",
        "Until: 07:00, 0.10",
        "Until: 10:00, 0.55",
        "Until: 18:00, 0.15",
        "Until: 22:00, 0.70",
        "Until: 24:00, 0.20",
        "For: Holidays",
        "Until: 24:00, 0.30",
        "For: SummerDesignDay",
        "Until: 24:00, 0.30",
        "For: WinterDesignDay",
        "Until: 24:00, 0.30",
    ],
)

# ── Common area equipment (lifts, vending, signage) ───────────────────────────
SCHEDULES["hotel_common_equipment"] = _compact(
    "hotel_common_equipment", "Fraction",
    [
        "Through: 12/31",
        "For: Weekdays Saturday Sunday Holidays",
        "Until: 07:00, 0.40",    # vending/standby overnight
        "Until: 22:00, 0.80",    # daytime operational
        "Until: 24:00, 0.50",
        "For: SummerDesignDay",
        "Until: 24:00, 0.70",
        "For: WinterDesignDay",
        "Until: 24:00, 0.70",
    ],
)

# ── Heating setpoint ──────────────────────────────────────────────────────────
# 21°C occupied, 18°C setback (frost protection/unoccupied)
SCHEDULES["hotel_heating_setpoint"] = _compact(
    "hotel_heating_setpoint", "Temperature",
    [
        "Through: 12/31",
        "For: Weekdays",
        "Until: 06:00, 18.0",
        "Until: 22:00, 21.0",
        "Until: 24:00, 18.0",
        "For: Saturday Sunday",
        "Until: 07:00, 18.0",
        "Until: 23:00, 21.0",
        "Until: 24:00, 18.0",
        "For: Holidays",
        "Until: 24:00, 21.0",
        "For: SummerDesignDay",
        "Until: 24:00, 21.0",
        "For: WinterDesignDay",
        "Until: 24:00, 21.0",
    ],
)

# ── Cooling setpoint ──────────────────────────────────────────────────────────
# 24°C occupied, 28°C setback
SCHEDULES["hotel_cooling_setpoint"] = _compact(
    "hotel_cooling_setpoint", "Temperature",
    [
        "Through: 12/31",
        "For: Weekdays",
        "Until: 06:00, 28.0",
        "Until: 22:00, 24.0",
        "Until: 24:00, 28.0",
        "For: Saturday Sunday",
        "Until: 07:00, 28.0",
        "Until: 23:00, 24.0",
        "Until: 24:00, 28.0",
        "For: Holidays",
        "Until: 24:00, 24.0",
        "For: SummerDesignDay",
        "Until: 24:00, 24.0",
        "For: WinterDesignDay",
        "Until: 24:00, 28.0",
    ],
)

# ── DHW demand ────────────────────────────────────────────────────────────────
# Morning peak (06:00–10:00) and evening peak (17:00–22:00)
SCHEDULES["hotel_dhw_demand"] = _compact(
    "hotel_dhw_demand", "Fraction",
    [
        "Through: 12/31",
        "For: Weekdays",
        "Until: 06:00, 0.05",
        "Until: 09:00, 1.00",    # morning shower peak
        "Until: 12:00, 0.30",
        "Until: 17:00, 0.15",
        "Until: 21:00, 0.70",    # evening shower peak
        "Until: 24:00, 0.10",
        "For: Saturday Sunday",
        "Until: 07:00, 0.05",
        "Until: 11:00, 0.90",
        "Until: 14:00, 0.35",
        "Until: 17:00, 0.20",
        "Until: 22:00, 0.70",
        "Until: 24:00, 0.10",
        "For: Holidays",
        "Until: 24:00, 0.50",
        "For: SummerDesignDay",
        "Until: 24:00, 0.50",
        "For: WinterDesignDay",
        "Until: 24:00, 0.50",
    ],
)


# ── Public API ────────────────────────────────────────────────────────────────

def get_schedule(name: str) -> dict:
    """Return a single Schedule:Compact epJSON dict. Raises KeyError if not found."""
    if name not in SCHEDULES:
        available = ", ".join(SCHEDULES.keys())
        raise KeyError(f"Schedule '{name}' not found. Available: {available}")
    return dict(SCHEDULES[name])


def list_schedules() -> list[dict]:
    """Return a summary list of all available schedules with peak/min values."""
    result = []
    for name, sched in SCHEDULES.items():
        # Extract numeric values from the field entries
        values = []
        for k, v in sched.items():
            if k.startswith("field_") and isinstance(v, str) and "," in v:
                try:
                    val = float(v.split(",")[-1].strip())
                    values.append(val)
                except ValueError:
                    pass
        result.append({
            "name": name,
            "type_limits": sched.get("schedule_type_limits_name", ""),
            "min_value": min(values) if values else None,
            "max_value": max(values) if values else None,
        })
    return result


def get_all_schedules() -> dict:
    """Return all schedules as a 'Schedule:Compact' epJSON sub-dict."""
    return dict(SCHEDULES)


def get_schedule_type_limits() -> dict:
    """Return 'ScheduleTypeLimits' epJSON objects for all used types."""
    return dict(SCHEDULE_TYPE_LIMITS)
