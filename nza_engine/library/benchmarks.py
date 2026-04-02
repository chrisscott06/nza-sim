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

# ── CRREM 1.5°C Pathway — UK Hotel ────────────────────────────────────────────

CRREM_HOTEL_UK_15 = {
    "name":          "CRREM 1.5°C — UK Hotel",
    "display_name":  "CRREM 1.5°C Pathway — UK Hotel",
    "description":   "CRREM 1.5°C decarbonisation pathway for UK hotels. "
                     "Year-by-year EUI (kWh/m²) and carbon intensity (kgCO₂/m²) targets.",
    "pathway":       "1.5C",
    "country":       "UK",
    "building_type": "hotel",
    # EUI targets (kWh/m² per year)
    "eui_targets": {
        2020: 280, 2021: 268, 2022: 257, 2023: 246, 2024: 235,
        2025: 225, 2026: 215, 2027: 205, 2028: 196, 2029: 188,
        2030: 180, 2031: 171, 2032: 162, 2033: 154, 2034: 147,
        2035: 140, 2036: 133, 2037: 127, 2038: 121, 2039: 116,
        2040: 110, 2041: 106, 2042: 102, 2043:  98, 2044:  94,
        2045:  90, 2046:  87, 2047:  84, 2048:  81, 2049:  78,
        2050:  75, 2051:  72, 2052:  69, 2053:  67, 2054:  65,
        2055:  63, 2056:  61, 2057:  59, 2058:  57, 2059:  56,
        2060:  55,
    },
    # Carbon intensity targets (kgCO₂/m² per year)
    "carbon_targets": {
        2020:  80, 2021:  73, 2022:  66, 2023:  60, 2024:  57,
        2025:  55, 2026:  50, 2027:  45, 2028:  41, 2029:  39,
        2030:  38, 2031:  34, 2032:  30, 2033:  27, 2034:  26,
        2035:  25, 2036:  23, 2037:  21, 2038:  19, 2039:  18,
        2040:  18, 2041:  16, 2042:  15, 2043:  14, 2044:  13,
        2045:  12, 2046:  11, 2047:  10, 2048:   9, 2049:   8,
        2050:   8, 2051:   7, 2052:   6, 2053:   6, 2054:   5,
        2055:   5, 2056:   4, 2057:   4, 2058:   3, 2059:   3,
        2060:   2,
    },
}

# ── CRREM 2°C Pathway — UK Hotel ──────────────────────────────────────────────

CRREM_HOTEL_UK_2 = {
    "name":          "CRREM 2°C — UK Hotel",
    "display_name":  "CRREM 2°C Pathway — UK Hotel",
    "description":   "CRREM 2°C decarbonisation pathway for UK hotels.",
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
