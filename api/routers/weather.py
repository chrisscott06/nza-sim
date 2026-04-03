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

from nza_engine.config import DEFAULT_WEATHER_DIR
from api.utils import resolve_weather_file

router = APIRouter()

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
