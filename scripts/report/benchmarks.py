#!/usr/bin/env python3
"""Brief 96 — carbon factors, tariffs, and the lifetime-carbon helper.

The electricity carbon factor is the **FES/CRREM declining grid pathway** (NOT the CRREM
property target curve — that is the EUI benchmark, a different thing). Values mirror
`frontend/src/data/ukGridCarbonTrajectory.js` (Brief 89): DESNZ Green Book + National Grid
FES, linear-interpolated between anchor years. Gas is a constant 0.18316 kgCO₂/kWh per the
design note. Tariffs are the demonstrator flat rates: 28p/kWh elec, 7p/kWh gas.
"""
from bisect import bisect_right

GIA_M2 = 4215.0
ELEC_TARIFF_GBP_PER_KWH = 0.28
GAS_TARIFF_GBP_PER_KWH = 0.07
GAS_KGCO2_PER_KWH = 0.18316          # design note, constant
REPORT_START_YEAR = 2026             # CRREM 2026 report year
CAP_YEAR = 2050                      # lifetime carbon "to 2050"

# FES declining grid pathway anchor points (gCO₂/kWh) — linear interp between.
_GRID_ANCHORS = [(2024, 190), (2026, 150), (2030, 50), (2035, 15), (2040, 8), (2050, 5)]
_GYEARS = [y for y, _ in _GRID_ANCHORS]
_GVALS = [v for _, v in _GRID_ANCHORS]


def grid_kgco2_per_kwh(year):
    """Grid carbon intensity (kgCO₂/kWh) for a year, linear-interpolated, clamped to range."""
    if year <= _GYEARS[0]:
        return _GVALS[0] / 1000.0
    if year >= _GYEARS[-1]:
        return _GVALS[-1] / 1000.0
    i = bisect_right(_GYEARS, year) - 1
    y0, y1 = _GYEARS[i], _GYEARS[i + 1]
    v0, v1 = _GVALS[i], _GVALS[i + 1]
    g = v0 + (v1 - v0) * (year - y0) / (y1 - y0)
    return g / 1000.0


def lifetime_carbon_tco2e(annual_elec_kwh_saved, annual_gas_kwh_saved, life_years,
                          start_year=REPORT_START_YEAR):
    """Lifetime tCO₂e saved to 2050, capped at measure life. Electricity valued on the
    declining grid pathway year-by-year; gas at the constant factor. A positive value is a
    SAVING (annual_*_saved positive = demand removed)."""
    if life_years is None:
        return None
    end = min(start_year + int(life_years), CAP_YEAR + 1)   # exclusive
    total_kg = 0.0
    for yr in range(start_year, end):
        total_kg += annual_elec_kwh_saved * grid_kgco2_per_kwh(yr)
        total_kg += annual_gas_kwh_saved * GAS_KGCO2_PER_KWH
    return total_kg / 1000.0


def refrigerant_lifetime_tco2e(annual_tco2e, life_years, start_year=REPORT_START_YEAR):
    """Refrigerant carbon is grid-independent (constant per year), capped at life + 2050."""
    end = min(start_year + int(life_years), CAP_YEAR + 1)
    return annual_tco2e * (end - start_year)


if __name__ == "__main__":
    for y in (2026, 2030, 2035, 2041, 2050):
        print(f"{y}: {grid_kgco2_per_kwh(y)*1000:.0f} gCO2/kWh")
    # sanity: 100 MWh/yr elec saved, 15y life from 2026
    print("100 MWh/yr elec, 15y:", round(lifetime_carbon_tco2e(100_000, 0, 15), 1), "tCO2e")
