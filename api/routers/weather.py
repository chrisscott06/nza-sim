"""
api/routers/weather.py

Weather data endpoints.

GET /api/weather/{filename}/hourly
    Parse an EPW weather file and return hourly arrays for the instant calc.
    The response is cached in memory after first parse.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException

from nza_engine.config import (
    DEFAULT_WEATHER_DIR,
    PROJECT_WEATHER_CURRENT,
    PROJECT_WEATHER_FUTURE,
)
from api.utils import resolve_weather_file, all_epw_files

router = APIRouter()


# ── Weather file categorisation helpers ───────────────────────────────────────

import re as _re

def _categorise_epw(filepath: Path) -> dict:
    """
    Return metadata for an EPW file by inspecting its path and filename.

    PROMETHEUS filenames look like:
      cntr_Bristol_TRY.epw                      → current, TRY
      Bristol_2030_a1b_50_percentile_TRY.epw    → future_2030, medium, TRY
      Bristol_2050_rcp85_90_percentile_DSY.epw  → future_2050, high, DSY
    """
    name = filepath.stem  # filename without .epw

    # Determine category from parent directory
    try:
        rel = filepath.relative_to(PROJECT_WEATHER_CURRENT)
        category = "current"
    except ValueError:
        try:
            rel = filepath.relative_to(PROJECT_WEATHER_FUTURE)
            # Use subdirectory name as category hint, e.g. "2030_medium"
            parts = filepath.relative_to(PROJECT_WEATHER_FUTURE).parts
            category = f"future_{parts[0]}" if parts else "future"
        except ValueError:
            category = "bundled"

    # Try to parse type (TRY / DSY)
    file_type = "TRY" if "_TRY" in name.upper() else ("DSY" if "_DSY" in name.upper() else None)

    # Parse period and scenario from PROMETHEUS future filename
    period = None
    scenario = None
    percentile = None
    m = _re.search(r'(\d{4}).*?(a1b|rcp\d+|med|high)', name, _re.IGNORECASE)
    if m:
        period = m.group(1)
        raw_scen = m.group(2).lower()
        scenario = "medium" if raw_scen in ("a1b", "med") else "high"
    perc_m = _re.search(r'(\d+)_percentile', name, _re.IGNORECASE)
    if perc_m:
        percentile = f"{perc_m.group(1)}th"

    # Human-readable display name
    city_m = _re.match(r'cntr_(\w+)_', name, _re.IGNORECASE) or _re.match(r'(\w+)_\d{4}', name)
    city = city_m.group(1).replace('_', ' ') if city_m else name

    if category == "current":
        display = f"{city} — Control {file_type or 'EPW'}"
    elif period:
        display = f"{city} — {period} {scenario.capitalize() if scenario else ''} {file_type or 'EPW'}"
    else:
        display = name

    return {
        "filename":     filepath.name,
        "display_name": display,
        "category":     category,
        "period":       period,
        "scenario":     scenario,
        "percentile":   percentile,
        "type":         file_type,
    }


@router.get("/api/weather")
async def list_weather_files():
    """
    List all available EPW weather files across all weather directories.
    Returns metadata parsed from filenames plus lat/lon from EPW headers.
    """
    files = all_epw_files()
    result = []
    for fp in files:
        meta = _categorise_epw(fp)
        # Peek at EPW header for location (use cache if already parsed)
        cache_key = str(fp.resolve())
        if cache_key in _EPW_CACHE:
            loc = _EPW_CACHE[cache_key].get("location", {})
        else:
            try:
                with open(fp, encoding="latin-1") as fh:
                    hdr = fh.readline().split(",")
                loc = {
                    "city":      hdr[1].strip() if len(hdr) > 1 else meta["filename"],
                    "latitude":  float(hdr[6]) if len(hdr) > 6 else None,
                    "longitude": float(hdr[7]) if len(hdr) > 7 else None,
                }
            except Exception:
                loc = {}
        meta["city"]      = loc.get("city", meta["filename"])
        meta["latitude"]  = loc.get("latitude")
        meta["longitude"] = loc.get("longitude")
        result.append(meta)
    return result


# ── Module-level EPW parse cache ──────────────────────────────────────────────
# Maps resolved filepath string → parsed dict.  EPW files never change at
# runtime so there is no cache invalidation; the process restart clears it.
_EPW_CACHE: dict[str, dict] = {}


def parse_epw(filepath: Path) -> dict:
    """
    Parse an EPW weather file and return hourly arrays.

    EPW format: 8 header lines, then 8,760 hourly rows.
    Column indices (0-based):
        0  Year
        1  Month (1-12)
        2  Day (1-31)
        3  Hour (1-24,  1 = midnight-to-1am)
        6  Dry Bulb Temperature (°C)
        13 Direct Normal Irradiance (Wh/m²)
        14 Diffuse Horizontal Irradiance (Wh/m²)

    Header line 1 format:
        LOCATION, City, State, Country, DataSource, WMO, Latitude, Longitude,
        TimeZone, Elevation
    """
    with open(filepath, encoding="latin-1") as fh:
        lines = fh.readlines()

    if len(lines) < 9:
        raise ValueError(f"EPW file too short: {len(lines)} lines")

    # ── Location from header line 1 ───────────────────────────────────────────
    hdr = lines[0].split(",")
    city      = hdr[1].strip() if len(hdr) > 1 else "Unknown"
    try:
        latitude  = float(hdr[6])
    except (IndexError, ValueError):
        latitude  = 51.5
    try:
        longitude = float(hdr[7])
    except (IndexError, ValueError):
        longitude = -0.1

    # ── Data rows ─────────────────────────────────────────────────────────────
    temperature:          list[float] = []
    direct_normal:        list[float] = []
    diffuse_horizontal:   list[float] = []
    month_arr:            list[int]   = []
    hour_arr:             list[int]   = []

    for line in lines[8 : 8 + 8760]:
        parts = line.split(",")
        if len(parts) < 15:
            continue
        try:
            month_arr.append(int(parts[1]))
            hour_arr.append(int(parts[3]))
            temperature.append(float(parts[6]))
            direct_normal.append(float(parts[13]))
            diffuse_horizontal.append(float(parts[14]))
        except (IndexError, ValueError):
            # Corrupt row — insert zeros to keep arrays aligned
            month_arr.append(1)
            hour_arr.append(1)
            temperature.append(0.0)
            direct_normal.append(0.0)
            diffuse_horizontal.append(0.0)

    return {
        "temperature":        temperature,
        "direct_normal":      direct_normal,
        "diffuse_horizontal": diffuse_horizontal,
        "month":              month_arr,
        "hour":               hour_arr,
        "location": {
            "city":      city,
            "latitude":  latitude,
            "longitude": longitude,
        },
        "count": len(temperature),
    }


@router.get("/api/weather/{filename}/hourly")
async def get_weather_hourly(filename: str):
    """
    Return parsed hourly arrays from an EPW weather file.

    ``filename`` can be a bare filename (resolved against the EnergyPlus
    WeatherData directory), an absolute path, or the special value ``default``
    which picks the first available EPW file.
    """
    if filename == "default":
        epws = sorted(DEFAULT_WEATHER_DIR.glob("*.epw"))
        if not epws:
            raise HTTPException(
                status_code=500,
                detail=f"No EPW files found in {DEFAULT_WEATHER_DIR}",
            )
        filepath = epws[0]
    else:
        try:
            filepath = resolve_weather_file(filename)
        except HTTPException:
            raise

    cache_key = str(filepath.resolve())
    if cache_key not in _EPW_CACHE:
        try:
            _EPW_CACHE[cache_key] = parse_epw(filepath)
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to parse EPW: {exc}",
            ) from exc

    return _EPW_CACHE[cache_key]
