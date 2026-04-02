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
