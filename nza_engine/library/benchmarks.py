"""
nza_engine/library/benchmarks.py

CRREM decarbonisation pathways and carbon intensity data for UK buildings.

Sources
-------
- CRREM (Carbon Risk Real Estate Monitor) v2 tool — 1.5°C pathways for UK Hotel
- National Grid ESO — Future Energy Scenarios (FES) 2023 Leading the Way
- BEIS/DESNZ — gas emission factor from UK Government GHG Conversion Factors

These values are approximations for initial use and can be replaced with
official CRREM tool outputs when available.
"""
from __future__ import annotations

# ── CRREM 1.5°C Pathway — UK Hotel ────────────────────────────────────────────

CRREM_HOTEL_UK_15 = {
    "name":          "CRREM 1.5°C — UK Hotel",
    "display_name":  "CRREM 1.5°C Pathway — UK Hotel",
    "description":   "CRREM 1.5°C decarbonisation pathway for UK hotels. "
                     "Real values from CRREM V2.07 Risk Assessment Tool. "
                     "EUI based on gross energy demand. EUI plateaus at 95 kWh/m² from 2037 "
                     "(grid decarbonisation means further EUI reduction is not needed).",
    "pathway":       "1.5C",
    "country":       "UK",
    "building_type": "hotel",
    "source":        "CRREM V2.07 Risk Assessment Tool — 1.5°C, United Kingdom, Hotel",
    # EUI targets (kWh/m² per year) — real values from CRREM V2.07
    "eui_targets": {
        2020: 264.0, 2021: 248.6, 2022: 234.1, 2023: 220.4, 2024: 207.6,
        2025: 195.5, 2026: 184.1, 2027: 173.3, 2028: 163.2, 2029: 153.7,
        2030: 144.7, 2031: 136.3, 2032: 128.3, 2033: 120.8, 2034: 113.8,
        2035: 107.1, 2036: 100.9,
        2037:  95.0,  # PLATEAU: grid decarbonisation means no further EUI reduction needed
        2038:  95.0, 2039:  95.0, 2040:  95.0, 2041:  95.0, 2042:  95.0,
        2043:  95.0, 2044:  95.0, 2045:  95.0, 2046:  95.0, 2047:  95.0,
        2048:  95.0, 2049:  95.0, 2050:  95.0,
    },
    # Carbon intensity targets (kgCO₂/m² per year) — real values from CRREM V2.07
    "carbon_targets": {
        2020: 56.13, 2021: 52.95, 2022: 49.09, 2023: 45.32, 2024: 41.66,
        2025: 38.28, 2026: 34.74, 2027: 31.49, 2028: 28.38, 2029: 25.42,
        2030: 22.51, 2031: 20.04, 2032: 17.61, 2033: 15.30, 2034: 13.13,
        2035: 11.08, 2036:  9.14, 2037:  7.33, 2038:  5.78, 2039:  4.54,
        2040:  3.53, 2041:  2.98, 2042:  2.56, 2043:  2.19, 2044:  1.86,
        2045:  1.56, 2046:  1.34, 2047:  1.13, 2048:  0.94, 2049:  0.77,
        2050:  0.60,
    },
}

# ── CRREM 2°C Pathway — UK Hotel ──────────────────────────────────────────────

CRREM_HOTEL_UK_2 = {
    "name":          "CRREM 2°C — UK Hotel",
    "display_name":  "CRREM 2°C Pathway — UK Hotel",
    "description":   "CRREM 2°C decarbonisation pathway for UK hotels. "
                     "NOTE: These values are approximations — NOT verified against the official "
                     "CRREM V2.07 tool. Use the 1.5°C pathway (crrem_hotel_uk_15) for "
                     "client-facing output.",
    "pathway":       "2C",
    "country":       "UK",
    "building_type": "hotel",
    "eui_targets": {
        2020: 280, 2025: 245, 2030: 205, 2035: 170,
        2040: 140, 2045: 115, 2050:  95, 2055:  80, 2060:  70,
    },
    "carbon_targets": {
        2020:  80, 2025:  63, 2030:  47, 2035:  33,
        2040:  24, 2045:  16, 2050:  11, 2055:   7, 2060:   4,
    },
}

# ── UK Grid Carbon Intensity Projections ──────────────────────────────────────

UK_GRID_CARBON_INTENSITY = {
    "name":          "uk_grid_carbon_fes_leading",
    "display_name":  "UK Grid Carbon Intensity — FES Leading the Way",
    "description":   "UK grid electricity carbon intensity projection 2020–2060 "
                     "based on National Grid FES 2023 Leading the Way scenario. "
                     "Values in kgCO₂/kWh (including transmission losses).",
    "source":        "National Grid FES 2023 — Leading the Way (simplified)",
    # kgCO₂ per kWh of delivered electricity
    "intensity_kgCO2_per_kWh": {
        2020: 0.233, 2021: 0.215, 2022: 0.200, 2023: 0.185, 2024: 0.172,
        2025: 0.160, 2026: 0.145, 2027: 0.130, 2028: 0.116, 2029: 0.108,
        2030: 0.100, 2031: 0.088, 2032: 0.077, 2033: 0.068, 2034: 0.060,
        2035: 0.053, 2036: 0.047, 2037: 0.041, 2038: 0.036, 2039: 0.032,
        2040: 0.028, 2041: 0.025, 2042: 0.022, 2043: 0.019, 2044: 0.017,
        2045: 0.015, 2046: 0.013, 2047: 0.011, 2048: 0.009, 2049: 0.008,
        2050: 0.007, 2051: 0.006, 2052: 0.005, 2053: 0.004, 2054: 0.004,
        2055: 0.003, 2056: 0.003, 2057: 0.002, 2058: 0.002, 2059: 0.002,
        2060: 0.002,
    },
}

# ── Fuel carbon intensities (static) ──────────────────────────────────────────

# Natural gas — BEIS 2023 GHG Conversion Factors (Scope 1, gross CV)
GAS_CARBON_INTENSITY_KG_PER_KWH = 0.183

# Oil — BEIS 2023 GHG Conversion Factors (kerosene, gross CV)
OIL_CARBON_INTENSITY_KG_PER_KWH = 0.247

# ── All benchmarks (for seeding) ──────────────────────────────────────────────

_BENCHMARKS = {
    "crrem_hotel_uk_15":        CRREM_HOTEL_UK_15,
    "crrem_hotel_uk_2":         CRREM_HOTEL_UK_2,
    "uk_grid_carbon_fes_leading": UK_GRID_CARBON_INTENSITY,
}


# ── Carbon computation helper ──────────────────────────────────────────────────

def compute_building_carbon(
    annual_energy_by_fuel: dict,
    gia_m2: float,
    year: int,
    grid_intensity_data: dict,
) -> float | None:
    """
    Calculate the building's operational carbon intensity (kgCO₂/m²/yr)
    for a specific year, using the energy breakdown and carbon factors.

    Parameters
    ----------
    annual_energy_by_fuel : dict
        Energy consumption by fuel type in kWh/yr.
        Expected keys: 'electricity_kWh', 'gas_kWh', 'oil_kWh'.
    gia_m2 : float
        Gross internal area in m².
    year : int
        The year for which to calculate carbon (drives grid intensity).
    grid_intensity_data : dict
        The intensity_kgCO2_per_kWh dict from UK_GRID_CARBON_INTENSITY.

    Returns
    -------
    float | None
        Carbon intensity in kgCO₂/m²/yr, or None if GIA is zero.
    """
    if not gia_m2 or gia_m2 <= 0:
        return None

    intensity_map = grid_intensity_data.get("intensity_kgCO2_per_kWh", {})

    # Clamp year to available range
    years_available = sorted(intensity_map.keys())
    if not years_available:
        return None
    clamped_year = max(years_available[0], min(years_available[-1], year))

    # Linear interpolation between the two nearest data points
    grid_intensity = _interpolate(intensity_map, clamped_year)

    electricity_kWh = annual_energy_by_fuel.get("electricity_kWh", 0.0) or 0.0
    gas_kWh         = annual_energy_by_fuel.get("gas_kWh", 0.0) or 0.0
    oil_kWh         = annual_energy_by_fuel.get("oil_kWh", 0.0) or 0.0

    total_carbon_kg = (
        electricity_kWh * grid_intensity
        + gas_kWh * GAS_CARBON_INTENSITY_KG_PER_KWH
        + oil_kWh * OIL_CARBON_INTENSITY_KG_PER_KWH
    )

    return total_carbon_kg / gia_m2


def interpolate_pathway(pathway_dict: dict, year: int) -> float | None:
    """
    Linearly interpolate a year-keyed pathway dict (e.g. eui_targets or
    carbon_targets) to get a value for any year in the covered range.

    Returns None if the year is outside the dict's range.
    """
    years = sorted(pathway_dict.keys())
    if not years:
        return None
    if year < years[0] or year > years[-1]:
        return None
    return _interpolate(pathway_dict, year)


def _interpolate(data: dict, year: int | float) -> float:
    """Linear interpolation between the two nearest integer-keyed data points."""
    years = sorted(data.keys())

    # Exact hit
    if year in data:
        return float(data[year])

    # Find bracketing years
    lower = max((y for y in years if y <= year), default=years[0])
    upper = min((y for y in years if y >= year), default=years[-1])

    if lower == upper:
        return float(data[lower])

    t = (year - lower) / (upper - lower)
    return float(data[lower]) + t * (float(data[upper]) - float(data[lower]))
