"""
nza_engine/library/schedules.py

Pre-defined EnergyPlus Schedule:Compact definitions for a hotel building.

Schedule values are fractional (0–1) multipliers applied to peak densities
defined in loads.py, except for thermostat setpoint schedules (°C).

epJSON FORMAT — Schedule:Compact uses a "data" array with individual
{"field": value} items. "Until: HH:MM" and its value are separate entries.
Each "Through:" block MUST cover ALL day types via explicit listing or
"For: AllOtherDays" as the final catch-all.

Hotel building schedule basis:
  - Bedroom occupancy: high at night, low during the day
  - Corridor occupancy: inverse of bedrooms — higher during movement hours
  - Lighting: follows occupancy with dusk/dawn offsets
  - Equipment: loose correlation with occupancy
  - HVAC setpoints: 21°C/24°C occupied, 18°C/28°C setback
  - DHW: morning (06:00–10:00) and evening (17:00–22:00) peaks

Source basis: CIBSE Guide A Table 6.x, NCM activity database (hotel).
"""

from copy import deepcopy
from typing import Any


# ── Schedule:Compact builder ──────────────────────────────────────────────────

def _f(*fields) -> list[dict]:
    """Convert a sequence of Through/For/Until strings and values to data items."""
    result = []
    for item in fields:
        if isinstance(item, str) and item.startswith("Until: "):
            # Split "Until: HH:MM, value" → two separate entries if comma present
            parts = item.split(",", 1)
            result.append({"field": parts[0].strip()})
            if len(parts) == 2:
                val_str = parts[1].strip()
                try:
                    result.append({"field": float(val_str)})
                except ValueError:
                    result.append({"field": val_str})
        else:
            result.append({"field": item})
    return result


def _compact(name: str, type_limits: str, fields: list) -> dict:
    """Build a Schedule:Compact epJSON object."""
    data = []
    for item in fields:
        if isinstance(item, (int, float)):
            data.append({"field": item})
        elif isinstance(item, str) and item.startswith("Until: ") and "," in item:
            parts = item.split(",", 1)
            data.append({"field": parts[0].strip()})
            val_str = parts[1].strip()
            try:
                data.append({"field": float(val_str)})
            except ValueError:
                data.append({"field": val_str})
        else:
            data.append({"field": item})
    return {
        "schedule_type_limits_name": type_limits,
        "data": data,
    }


# ── Schedule type limits ──────────────────────────────────────────────────────

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
    "ThermostatControlType": {
        "lower_limit_value": 0,
        "upper_limit_value": 4,
        "numeric_type": "Discrete",
    },
}


# ── Hotel schedule definitions ────────────────────────────────────────────────
#
# Day type coverage within each Through block:
#   "For: Weekdays"       — Mon through Fri
#   "For: AllOtherDays"   — Sat, Sun, Holiday, SummerDesignDay,
#                           WinterDesignDay, CustomDay1, CustomDay2
#
# Using AllOtherDays as the final catch-all is the safest approach.
# ─────────────────────────────────────────────────────────────────────────────

SCHEDULES: dict[str, dict] = {}


# ── Bedroom occupancy ─────────────────────────────────────────────────────────
# Night-dominant: guests in rooms overnight, out during the day
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
        "For: AllOtherDays",    # Weekends, holidays, design days
        "Until: 07:00, 0.90",
        "Until: 10:00, 0.75",
        "Until: 14:00, 0.50",
        "Until: 18:00, 0.55",
        "Until: 22:00, 0.80",
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
        "For: AllOtherDays",
        "Until: 07:00, 0.10",
        "Until: 11:00, 0.55",
        "Until: 14:00, 0.45",
        "Until: 18:00, 0.45",
        "Until: 22:00, 0.50",
        "Until: 24:00, 0.15",
    ],
)

# ── Bedroom lighting ──────────────────────────────────────────────────────────
SCHEDULES["hotel_bedroom_lighting"] = _compact(
    "hotel_bedroom_lighting", "Fraction",
    [
        "Through: 12/31",
        "For: Weekdays",
        "Until: 06:00, 0.05",
        "Until: 08:00, 0.60",
        "Until: 18:00, 0.10",
        "Until: 22:00, 0.80",
        "Until: 24:00, 0.20",
        "For: AllOtherDays",
        "Until: 07:00, 0.05",
        "Until: 10:00, 0.65",
        "Until: 18:00, 0.15",
        "Until: 22:00, 0.80",
        "Until: 24:00, 0.20",
    ],
)

# ── Corridor lighting ─────────────────────────────────────────────────────────
SCHEDULES["hotel_corridor_lighting"] = _compact(
    "hotel_corridor_lighting", "Fraction",
    [
        "Through: 12/31",
        "For: Weekdays",
        "Until: 07:00, 0.50",
        "Until: 23:00, 0.80",
        "Until: 24:00, 0.50",
        "For: AllOtherDays",
        "Until: 07:00, 0.50",
        "Until: 23:00, 0.80",
        "Until: 24:00, 0.50",
    ],
)

# ── Bedroom equipment ─────────────────────────────────────────────────────────
SCHEDULES["hotel_bedroom_equipment"] = _compact(
    "hotel_bedroom_equipment", "Fraction",
    [
        "Through: 12/31",
        "For: Weekdays",
        "Until: 06:00, 0.10",
        "Until: 08:00, 0.50",
        "Until: 18:00, 0.05",
        "Until: 22:00, 0.70",
        "Until: 24:00, 0.20",
        "For: AllOtherDays",
        "Until: 07:00, 0.10",
        "Until: 10:00, 0.55",
        "Until: 18:00, 0.15",
        "Until: 22:00, 0.70",
        "Until: 24:00, 0.20",
    ],
)

# ── Common area equipment ─────────────────────────────────────────────────────
SCHEDULES["hotel_common_equipment"] = _compact(
    "hotel_common_equipment", "Fraction",
    [
        "Through: 12/31",
        "For: Weekdays",
        "Until: 07:00, 0.40",
        "Until: 22:00, 0.80",
        "Until: 24:00, 0.50",
        "For: AllOtherDays",
        "Until: 07:00, 0.40",
        "Until: 22:00, 0.80",
        "Until: 24:00, 0.50",
    ],
)

# ── Heating setpoint ──────────────────────────────────────────────────────────
SCHEDULES["hotel_heating_setpoint"] = _compact(
    "hotel_heating_setpoint", "Temperature",
    [
        "Through: 12/31",
        "For: Weekdays",
        "Until: 06:00, 18.0",
        "Until: 22:00, 21.0",
        "Until: 24:00, 18.0",
        "For: AllOtherDays",
        "Until: 07:00, 18.0",
        "Until: 23:00, 21.0",
        "Until: 24:00, 18.0",
    ],
)

# ── Cooling setpoint ──────────────────────────────────────────────────────────
SCHEDULES["hotel_cooling_setpoint"] = _compact(
    "hotel_cooling_setpoint", "Temperature",
    [
        "Through: 12/31",
        "For: Weekdays",
        "Until: 06:00, 28.0",
        "Until: 22:00, 24.0",
        "Until: 24:00, 28.0",
        "For: AllOtherDays",
        "Until: 07:00, 28.0",
        "Until: 23:00, 24.0",
        "Until: 24:00, 28.0",
    ],
)

# ── DHW demand ────────────────────────────────────────────────────────────────
SCHEDULES["hotel_dhw_demand"] = _compact(
    "hotel_dhw_demand", "Fraction",
    [
        "Through: 12/31",
        "For: Weekdays",
        "Until: 06:00, 0.05",
        "Until: 09:00, 1.00",
        "Until: 12:00, 0.30",
        "Until: 17:00, 0.15",
        "Until: 21:00, 0.70",
        "Until: 24:00, 0.10",
        "For: AllOtherDays",
        "Until: 07:00, 0.05",
        "Until: 11:00, 0.90",
        "Until: 14:00, 0.35",
        "Until: 17:00, 0.20",
        "Until: 22:00, 0.70",
        "Until: 24:00, 0.10",
    ],
)

# ── Ventilation schedules ──────────────────────────────────────────────────────
# hotel_ventilation_continuous: 24/7 full rate
SCHEDULES["hotel_ventilation_continuous"] = _compact(
    "hotel_ventilation_continuous", "Fraction",
    [
        "Through: 12/31",
        "For: AllDays",
        "Until: 24:00, 1.0",
    ],
)

# hotel_ventilation_occupied: full rate 06:00–23:00, reduced overnight
SCHEDULES["hotel_ventilation_occupied"] = _compact(
    "hotel_ventilation_occupied", "Fraction",
    [
        "Through: 12/31",
        "For: AllDays",
        "Until: 06:00, 0.3",
        "Until: 23:00, 1.0",
        "Until: 24:00, 0.3",
    ],
)

# hotel_ventilation_timer: 07:00–22:00 full, overnight 50%
SCHEDULES["hotel_ventilation_timer"] = _compact(
    "hotel_ventilation_timer", "Fraction",
    [
        "Through: 12/31",
        "For: AllDays",
        "Until: 07:00, 0.5",
        "Until: 22:00, 1.0",
        "Until: 24:00, 0.5",
    ],
)


# ── Thermostat control type — always DualSetpoint (4) ─────────────────────────
SCHEDULES["ThermostatControlType_DualSetpoint"] = _compact(
    "ThermostatControlType_DualSetpoint", "ThermostatControlType",
    [
        "Through: 12/31",
        "For: AllDays",
        "Until: 24:00, 4",
    ],
)


# ── Public API ────────────────────────────────────────────────────────────────

def get_schedule(name: str) -> dict:
    """Return a single Schedule:Compact epJSON dict. Raises KeyError if not found."""
    if name not in SCHEDULES:
        available = ", ".join(SCHEDULES.keys())
        raise KeyError(f"Schedule '{name}' not found. Available: {available}")
    return deepcopy(SCHEDULES[name])


def list_schedules() -> list[dict]:
    """Return a summary list of all available schedules with peak/min values."""
    result = []
    for name, sched in SCHEDULES.items():
        values = [
            e["field"] for e in sched.get("data", [])
            if isinstance(e.get("field"), (int, float))
        ]
        result.append({
            "name": name,
            "type_limits": sched.get("schedule_type_limits_name", ""),
            "min_value": min(values) if values else None,
            "max_value": max(values) if values else None,
        })
    return result


def get_all_schedules() -> dict:
    """Return all schedules as a 'Schedule:Compact' epJSON sub-dict."""
    return deepcopy(SCHEDULES)


def get_schedule_type_limits() -> dict:
    """Return 'ScheduleTypeLimits' epJSON objects for all used types."""
    return deepcopy(SCHEDULE_TYPE_LIMITS)


# ── Library schedule → Schedule:Compact converter ─────────────────────────────

# Last day of each month (non-leap year)
_MONTH_ENDS = [
    "1/31", "2/28", "3/31", "4/30", "5/31", "6/30",
    "7/31", "8/31", "9/30", "10/31", "11/30", "12/31",
]

# Map schedule_type string to EnergyPlus ScheduleTypeLimits name
_SCHED_TYPE_LIMITS_MAP: dict[str, str] = {
    "occupancy":        "Fraction",
    "lighting":         "Fraction",
    "equipment":        "Fraction",
    "dhw":              "Fraction",
    "heating_setpoint": "Temperature",
    "cooling_setpoint": "Temperature",
}


def library_schedule_to_compact(config_json: dict) -> dict:
    """
    Convert a library schedule config_json (day_types + monthly_multipliers format)
    to an EnergyPlus Schedule:Compact epJSON dict.

    For fraction schedules the hourly value is multiplied by the monthly multiplier
    and clamped to [0, 1].  For setpoint schedules the multiplier is not applied.

    Parameters
    ----------
    config_json : dict
        Must contain:
          - ``day_types``: dict with keys 'weekday', 'saturday', 'sunday',
                           each a list of 24 float values
          - ``monthly_multipliers``: list of 12 floats
          - ``schedule_type``: one of 'occupancy', 'lighting', 'equipment',
                               'dhw', 'heating_setpoint', 'cooling_setpoint'
    """
    day_types   = config_json.get("day_types", {})
    multipliers = config_json.get("monthly_multipliers", [1.0] * 12)
    sched_type  = config_json.get("schedule_type", "occupancy")

    weekday  = day_types.get("weekday",  [0.5] * 24)
    saturday = day_types.get("saturday", weekday)
    sunday   = day_types.get("sunday",   weekday)

    type_limits = _SCHED_TYPE_LIMITS_MAP.get(sched_type, "Fraction")
    is_setpoint = sched_type in ("heating_setpoint", "cooling_setpoint")

    data: list[dict] = []

    for m, month_end in enumerate(_MONTH_ENDS):
        mult = 1.0 if is_setpoint else float(multipliers[m])
        data.append({"field": f"Through: {month_end}"})

        for day_label, day_values in [
            ("For: Weekdays", weekday),
            ("For: Saturday", saturday),
            ("For: AllOtherDays", sunday),   # covers Sunday, holidays, design days
        ]:
            data.append({"field": day_label})
            for h, raw_val in enumerate(day_values):
                if is_setpoint:
                    val = float(raw_val)
                else:
                    val = round(max(0.0, min(1.0, float(raw_val) * mult)), 4)
                data.append({"field": f"Until: {h + 1:02d}:00"})
                data.append({"field": val})

    return {
        "schedule_type_limits_name": type_limits,
        "data": data,
    }


# ── Standardised visual library format ────────────────────────────────────────
#
# Used by the library database and Profiles editor.
# Format: day_types arrays (24 hourly values each), monthly_multipliers,
# and metadata. Independent of EnergyPlus Schedule:Compact syntax.
#
# Values are fractions (0–1) for occupancy/lighting/equipment/DHW,
# or degrees Celsius for setpoint schedules.

_SCHEDULE_LIBRARY: dict[str, dict] = {

    # Hotel bedroom occupancy — high at night, low during the day
    "hotel_bedroom_occupancy": {
        "schedule_type":      "occupancy",
        "building_type":      "hotel",
        "zone_type":          "bedroom",
        "time_resolution":    "hourly",
        "display_name":       "Hotel Bedroom — Occupancy",
        "description":        "Hotel bedroom occupancy — high at night, low during day, seasonal variation for UK tourism",
        "day_types": {
            "weekday": [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.7, 0.4, 0.3, 0.2, 0.2, 0.2,
                        0.2, 0.2, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.9, 0.9],
            "saturday":[0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.8, 0.5, 0.4, 0.3, 0.3, 0.3,
                        0.3, 0.3, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.9, 0.9, 0.9],
            "sunday":  [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.8, 0.6, 0.5, 0.4, 0.4, 0.4,
                        0.4, 0.4, 0.4, 0.5, 0.5, 0.6, 0.7, 0.8, 0.9, 0.9, 0.9, 0.9],
        },
        "monthly_multipliers": [0.7, 0.7, 0.8, 0.9, 1.0, 1.0, 1.0, 1.0, 1.0, 0.9, 0.8, 0.7],
    },

    # Hotel corridor occupancy — inverse of bedrooms, peaks at movement hours
    "hotel_corridor_occupancy": {
        "schedule_type":      "occupancy",
        "building_type":      "hotel",
        "zone_type":          "corridor",
        "time_resolution":    "hourly",
        "display_name":       "Hotel Corridor — Occupancy",
        "description":        "Hotel corridor occupancy — busiest at morning checkout and evening arrival",
        "day_types": {
            "weekday": [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.3, 0.6, 0.5, 0.4, 0.3, 0.3,
                        0.3, 0.3, 0.3, 0.4, 0.5, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.1],
            "saturday":[0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.5, 0.6, 0.5, 0.4, 0.4,
                        0.4, 0.4, 0.4, 0.5, 0.6, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.1],
            "sunday":  [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.4, 0.6, 0.6, 0.5, 0.5,
                        0.5, 0.5, 0.4, 0.5, 0.5, 0.5, 0.4, 0.3, 0.2, 0.2, 0.1, 0.1],
        },
        "monthly_multipliers": [0.7, 0.7, 0.8, 0.9, 1.0, 1.0, 1.0, 1.0, 1.0, 0.9, 0.8, 0.7],
    },

    # Hotel reception — daytime peaks
    "hotel_reception_occupancy": {
        "schedule_type":      "occupancy",
        "building_type":      "hotel",
        "zone_type":          "reception",
        "time_resolution":    "hourly",
        "display_name":       "Hotel Reception — Occupancy",
        "description":        "Hotel reception occupancy — daytime operation with check-in/out peaks",
        "day_types": {
            "weekday": [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.5, 0.8, 0.7, 0.6, 0.6,
                        0.5, 0.5, 0.7, 0.8, 0.9, 0.7, 0.5, 0.3, 0.2, 0.2, 0.1, 0.1],
            "saturday":[0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.4, 0.7, 0.8, 0.7, 0.6,
                        0.5, 0.5, 0.6, 0.8, 0.9, 0.7, 0.5, 0.3, 0.2, 0.2, 0.1, 0.1],
            "sunday":  [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.4, 0.6, 0.8, 0.7, 0.6,
                        0.5, 0.4, 0.4, 0.5, 0.6, 0.5, 0.4, 0.3, 0.2, 0.2, 0.1, 0.1],
        },
        "monthly_multipliers": [0.7, 0.7, 0.8, 0.9, 1.0, 1.0, 1.0, 1.0, 1.0, 0.9, 0.8, 0.7],
    },

    # Hotel bedroom lighting — follows occupancy with evening peak
    "hotel_bedroom_lighting": {
        "schedule_type":      "lighting",
        "building_type":      "hotel",
        "zone_type":          "bedroom",
        "time_resolution":    "hourly",
        "display_name":       "Hotel Bedroom — Lighting",
        "description":        "Hotel bedroom lighting — minimal overnight, peaks at wakeup and bedtime",
        "day_types": {
            "weekday": [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.4, 0.7, 0.2, 0.1, 0.1, 0.1,
                        0.1,  0.1,  0.1,  0.1,  0.1,  0.2,  0.5, 0.8, 0.8, 0.6, 0.2, 0.05],
            "saturday":[0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.2, 0.6, 0.4, 0.2, 0.1, 0.1,
                        0.1,  0.1,  0.1,  0.1,  0.2,  0.3,  0.5, 0.8, 0.8, 0.6, 0.2, 0.05],
            "sunday":  [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.2, 0.5, 0.5, 0.3, 0.2, 0.1,
                        0.1,  0.1,  0.1,  0.1,  0.2,  0.3,  0.5, 0.8, 0.7, 0.5, 0.2, 0.05],
        },
        "monthly_multipliers": [1.0, 1.0, 0.9, 0.8, 0.7, 0.7, 0.7, 0.7, 0.8, 0.9, 1.0, 1.0],
    },

    # Hotel corridor lighting — near constant, slightly lower overnight
    "hotel_corridor_lighting": {
        "schedule_type":      "lighting",
        "building_type":      "hotel",
        "zone_type":          "corridor",
        "time_resolution":    "hourly",
        "display_name":       "Hotel Corridor — Lighting",
        "description":        "Hotel corridor lighting — near-constant throughout the day, reduced overnight",
        "day_types": {
            "weekday": [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.7, 0.8, 0.8, 0.8, 0.8, 0.8,
                        0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.7, 0.6, 0.5],
            "saturday":[0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.6, 0.8, 0.8, 0.8, 0.8, 0.8,
                        0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.7, 0.6, 0.5, 0.5],
            "sunday":  [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.6, 0.7, 0.8, 0.8, 0.8, 0.8,
                        0.8, 0.8, 0.8, 0.8, 0.8, 0.7, 0.7, 0.7, 0.6, 0.6, 0.5, 0.5],
        },
        "monthly_multipliers": [1.0, 1.0, 0.9, 0.8, 0.7, 0.7, 0.7, 0.7, 0.8, 0.9, 1.0, 1.0],
    },

    # Hotel bedroom equipment
    "hotel_bedroom_equipment": {
        "schedule_type":      "equipment",
        "building_type":      "hotel",
        "zone_type":          "bedroom",
        "time_resolution":    "hourly",
        "display_name":       "Hotel Bedroom — Equipment",
        "description":        "Hotel bedroom equipment (TV, chargers, HVAC) — loosely follows occupancy",
        "day_types": {
            "weekday": [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.3, 0.6, 0.1, 0.05, 0.05, 0.05,
                        0.05, 0.05, 0.05, 0.05, 0.1, 0.3, 0.6, 0.7, 0.6, 0.4, 0.2, 0.1],
            "saturday":[0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.5, 0.3, 0.1, 0.1, 0.1,
                        0.1, 0.1, 0.1, 0.1, 0.2, 0.4, 0.6, 0.7, 0.6, 0.4, 0.2, 0.1],
            "sunday":  [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.4, 0.4, 0.2, 0.1, 0.1,
                        0.1, 0.1, 0.1, 0.1, 0.2, 0.3, 0.5, 0.6, 0.5, 0.3, 0.2, 0.1],
        },
        "monthly_multipliers": [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    },

    # Hotel heating setpoint (°C)
    "hotel_heating_setpoint": {
        "schedule_type":      "heating_setpoint",
        "building_type":      "hotel",
        "zone_type":          "all",
        "time_resolution":    "hourly",
        "display_name":       "Hotel — Heating Setpoint",
        "description":        "Hotel heating setpoint — 21°C occupied, 18°C setback",
        "day_types": {
            "weekday": [18, 18, 18, 18, 18, 18, 18, 21, 21, 21, 21, 21,
                        21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 18],
            "saturday":[18, 18, 18, 18, 18, 18, 18, 21, 21, 21, 21, 21,
                        21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 18],
            "sunday":  [18, 18, 18, 18, 18, 18, 18, 21, 21, 21, 21, 21,
                        21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 18],
        },
        "monthly_multipliers": [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    },

    # Hotel cooling setpoint (°C)
    "hotel_cooling_setpoint": {
        "schedule_type":      "cooling_setpoint",
        "building_type":      "hotel",
        "zone_type":          "all",
        "time_resolution":    "hourly",
        "display_name":       "Hotel — Cooling Setpoint",
        "description":        "Hotel cooling setpoint — 24°C occupied, 28°C setback",
        "day_types": {
            "weekday": [28, 28, 28, 28, 28, 28, 28, 24, 24, 24, 24, 24,
                        24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 28],
            "saturday":[28, 28, 28, 28, 28, 28, 28, 24, 24, 24, 24, 24,
                        24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 28],
            "sunday":  [28, 28, 28, 28, 28, 28, 28, 24, 24, 24, 24, 24,
                        24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 28],
        },
        "monthly_multipliers": [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    },

    # Hotel DHW demand — morning and evening peaks
    "hotel_dhw_demand": {
        "schedule_type":      "dhw",
        "building_type":      "hotel",
        "zone_type":          "all",
        "time_resolution":    "hourly",
        "display_name":       "Hotel — DHW Demand",
        "description":        "Hotel DHW demand — morning shower peak (06-10) and evening peak (17-22)",
        "day_types": {
            "weekday": [0.05, 0.05, 0.05, 0.05, 0.05, 0.15, 0.80, 1.00, 0.90, 0.60,
                        0.30, 0.20, 0.20, 0.15, 0.15, 0.20, 0.40, 0.60, 0.70, 0.65,
                        0.55, 0.30, 0.10, 0.05],
            "saturday":[0.05, 0.05, 0.05, 0.05, 0.05, 0.10, 0.60, 0.90, 1.00, 0.80,
                        0.40, 0.25, 0.20, 0.20, 0.20, 0.25, 0.45, 0.65, 0.70, 0.65,
                        0.55, 0.30, 0.10, 0.05],
            "sunday":  [0.05, 0.05, 0.05, 0.05, 0.05, 0.10, 0.50, 0.80, 1.00, 0.90,
                        0.50, 0.30, 0.25, 0.20, 0.20, 0.25, 0.45, 0.60, 0.65, 0.60,
                        0.50, 0.30, 0.10, 0.05],
        },
        "monthly_multipliers": [0.8, 0.8, 0.9, 0.95, 1.0, 1.0, 1.0, 1.0, 1.0, 0.95, 0.9, 0.85],
    },

    # Office occupancy — 9-5 weekday, empty weekend
    "office_occupancy": {
        "schedule_type":      "occupancy",
        "building_type":      "office",
        "zone_type":          "open_plan",
        "time_resolution":    "hourly",
        "display_name":       "Office — Occupancy",
        "description":        "Office occupancy — 9-5 weekday pattern with lunch dip, empty at weekends",
        "day_types": {
            "weekday": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.5, 0.9, 0.95, 0.95,
                        0.75, 0.9, 0.95, 0.9, 0.7, 0.3, 0.1, 0.05, 0.0, 0.0, 0.0, 0.0],
            "saturday":[0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.05, 0.05, 0.05,
                        0.05, 0.05, 0.05, 0.05, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            "sunday":  [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                        0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        },
        "monthly_multipliers": [0.9, 0.9, 1.0, 1.0, 1.0, 0.9, 0.8, 0.8, 1.0, 1.0, 1.0, 0.85],
    },

    # Office lighting — follows occupancy with daylight adjustment
    "office_lighting": {
        "schedule_type":      "lighting",
        "building_type":      "office",
        "zone_type":          "open_plan",
        "time_resolution":    "hourly",
        "display_name":       "Office — Lighting",
        "description":        "Office lighting — follows occupancy, reduced in summer by daylight",
        "day_types": {
            "weekday": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.5, 0.8, 0.9, 0.9,
                        0.7, 0.85, 0.9, 0.85, 0.65, 0.25, 0.05, 0.0, 0.0, 0.0, 0.0, 0.0],
            "saturday":[0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.05, 0.05, 0.05,
                        0.05, 0.05, 0.05, 0.05, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            "sunday":  [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                        0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        },
        "monthly_multipliers": [1.0, 1.0, 0.9, 0.8, 0.7, 0.6, 0.6, 0.65, 0.75, 0.85, 0.95, 1.0],
    },

    # Retail occupancy — 10-6 pattern
    "retail_occupancy": {
        "schedule_type":      "occupancy",
        "building_type":      "retail",
        "zone_type":          "sales_floor",
        "time_resolution":    "hourly",
        "display_name":       "Retail — Occupancy",
        "description":        "Retail occupancy — 10-6 pattern, busier at weekends",
        "day_types": {
            "weekday": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.5, 0.8,
                        0.9, 0.85, 0.8, 0.75, 0.7, 0.4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            "saturday":[0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.6, 0.9,
                        1.0, 0.95, 0.9, 0.85, 0.8, 0.6, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0],
            "sunday":  [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.2, 0.6,
                        0.8, 0.85, 0.8, 0.7, 0.5, 0.2, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        },
        "monthly_multipliers": [0.8, 0.9, 1.0, 1.0, 1.0, 0.95, 0.9, 0.95, 0.95, 1.0, 1.1, 1.2],
    },

    # Ventilation schedules
    "hotel_ventilation_continuous": {
        "schedule_type":   "ventilation",
        "building_type":   "hotel",
        "zone_type":       "all",
        "time_resolution": "hourly",
        "display_name":    "Hotel — Ventilation Continuous",
        "description":     "24/7 continuous ventilation at full rate. Typical for centralised extract systems.",
        "day_types": {
            "weekday": [1.0] * 24,
            "saturday": [1.0] * 24,
            "sunday": [1.0] * 24,
        },
        "monthly_multipliers": [1.0] * 12,
    },

    "hotel_ventilation_occupied": {
        "schedule_type":   "ventilation",
        "building_type":   "hotel",
        "zone_type":       "all",
        "time_resolution": "hourly",
        "display_name":    "Hotel — Ventilation Occupied",
        "description":     "Full rate 06:00–23:00 (1.0), reduced overnight 23:00–06:00 (0.3). Better for energy, may need building regs check.",
        "day_types": {
            "weekday":  [0.3, 0.3, 0.3, 0.3, 0.3, 0.3,
                         1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
                         1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
                         1.0, 1.0, 1.0, 1.0, 1.0, 0.3],
            "saturday": [0.3, 0.3, 0.3, 0.3, 0.3, 0.3,
                         1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
                         1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
                         1.0, 1.0, 1.0, 1.0, 1.0, 0.3],
            "sunday":   [0.3, 0.3, 0.3, 0.3, 0.3, 0.3,
                         1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
                         1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
                         1.0, 1.0, 1.0, 1.0, 1.0, 0.3],
        },
        "monthly_multipliers": [1.0] * 12,
    },

    "hotel_ventilation_timer": {
        "schedule_type":   "ventilation",
        "building_type":   "hotel",
        "zone_type":       "all",
        "time_resolution": "hourly",
        "display_name":    "Hotel — Ventilation Timer",
        "description":     "Fixed timer: 07:00–22:00 full rate (1.0), 22:00–07:00 at 50%. Typical for time-clock controls.",
        "day_types": {
            "weekday":  [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                         1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
                         1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
                         1.0, 0.5, 0.5],
            "saturday": [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                         1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
                         1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
                         1.0, 0.5, 0.5],
            "sunday":   [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                         1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
                         1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
                         1.0, 0.5, 0.5],
        },
        "monthly_multipliers": [1.0] * 12,
    },
}


def list_schedule_library() -> list[dict]:
    """Return summary of all visual-format schedule library items."""
    return [
        {
            "name":          name,
            "display_name":  data.get("display_name", name),
            "description":   data.get("description", ""),
            "schedule_type": data.get("schedule_type"),
            "building_type": data.get("building_type"),
            "zone_type":     data.get("zone_type"),
        }
        for name, data in _SCHEDULE_LIBRARY.items()
    ]
