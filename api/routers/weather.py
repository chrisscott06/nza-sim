"""
api/routers/weather.py

Weather data endpoints.

GET /api/weather/{filename}/hourly
    Parse an EPW weather file and return hourly arrays for the instant calc.
    The response is cached in memory after first parse.
"""

from __future__ import annotations

import io
import json
import math
import re as _re
import zipfile
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from nza_engine.config import (
    DEFAULT_WEATHER_DIR,
    PROJECT_WEATHER_CURRENT,
    PROJECT_WEATHER_FUTURE,
)
from api.utils import resolve_weather_file, all_epw_files

router = APIRouter()


# ── Weather file categorisation helpers ───────────────────────────────────────

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
        21 Wind Speed (m/s)

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
    wind_speed_arr:       list[float] = []
    month_arr:            list[int]   = []
    hour_arr:             list[int]   = []

    for line in lines[8 : 8 + 8760]:
        parts = line.split(",")
        if len(parts) < 22:
            continue
        try:
            month_arr.append(int(parts[1]))
            hour_arr.append(int(parts[3]))
            temperature.append(float(parts[6]))
            direct_normal.append(float(parts[13]))
            diffuse_horizontal.append(float(parts[14]))
            wind_speed_arr.append(float(parts[21]))
        except (IndexError, ValueError):
            # Corrupt row — insert zeros to keep arrays aligned
            month_arr.append(1)
            hour_arr.append(1)
            temperature.append(0.0)
            direct_normal.append(0.0)
            diffuse_horizontal.append(0.0)
            wind_speed_arr.append(0.0)

    return {
        "temperature":        temperature,
        "direct_normal":      direct_normal,
        "diffuse_horizontal": diffuse_horizontal,
        "wind_speed":         wind_speed_arr,
        "month":              month_arr,
        "hour":               hour_arr,
        "location": {
            "city":      city,
            "latitude":  latitude,
            "longitude": longitude,
        },
        "count": len(temperature),
    }


def _parse_epw_full(filepath: Path) -> dict:
    """
    Richer EPW parse for the Weather inspector module. Returns the full set
    of hourly variables and a small year/period metadata block. Used by
    /api/weather/{filename}/inspect.

    EPW columns used (0-based, per the EnergyPlus EPW data dictionary):
       0  Year                                           (int)
       1  Month                                          (int 1-12)
       2  Day                                            (int 1-31)
       3  Hour                                           (int 1-24)
       6  Dry Bulb Temperature                           (°C)
       7  Dew Point Temperature                          (°C)
       8  Relative Humidity                              (%)
       9  Atmospheric Pressure                           (Pa)
      12  Horizontal Infrared Radiation Intensity        (Wh/m²)
      13  Direct Normal Irradiance                       (Wh/m²)
      14  Diffuse Horizontal Irradiance                  (Wh/m²)
      15  Global Horizontal Irradiance                   (Wh/m²)
      21  Wind Direction                                 (deg)
      22  Wind Speed                                     (m/s)
      23  Total Sky Cover                                (tenths)

    Wet-bulb is computed from dry-bulb + RH + pressure via the standard
    Stull (2011) approximation — close enough for visualisation use.
    """
    with open(filepath, encoding="latin-1") as fh:
        lines = fh.readlines()
    if len(lines) < 9:
        raise ValueError(f"EPW file too short: {len(lines)} lines")

    hdr = lines[0].split(",")
    location = {
        "city":      hdr[1].strip() if len(hdr) > 1 else "Unknown",
        "state":     hdr[2].strip() if len(hdr) > 2 else "",
        "country":   hdr[3].strip() if len(hdr) > 3 else "",
        "data_source": hdr[4].strip() if len(hdr) > 4 else "",
        "wmo":       hdr[5].strip() if len(hdr) > 5 else "",
    }
    try: location["latitude"]  = float(hdr[6])
    except: location["latitude"]  = 51.5
    try: location["longitude"] = float(hdr[7])
    except: location["longitude"] = -0.1
    try: location["time_zone"] = float(hdr[8])
    except: location["time_zone"] = 0.0
    try: location["elevation_m"] = float(hdr[9])
    except: location["elevation_m"] = 0.0

    # Hourly arrays
    year_arr: list[int]  = []
    month_arr: list[int] = []
    day_arr: list[int]   = []
    hour_arr: list[int]  = []
    dry_bulb: list[float] = []
    dew_point: list[float] = []
    humidity: list[float] = []
    pressure: list[float] = []
    direct_normal: list[float] = []
    diffuse_horizontal: list[float] = []
    global_horizontal: list[float] = []
    wind_dir: list[float] = []
    wind_speed: list[float] = []
    sky_cover: list[float] = []

    def _f(v, default=0.0):
        try: return float(v)
        except: return default
    def _i(v, default=0):
        try: return int(v)
        except: return default

    for line in lines[8 : 8 + 8760]:
        parts = line.split(",")
        if len(parts) < 24:
            continue
        year_arr.append(_i(parts[0]))
        month_arr.append(_i(parts[1], 1))
        day_arr.append(_i(parts[2], 1))
        hour_arr.append(_i(parts[3], 1))
        dry_bulb.append(_f(parts[6]))
        dew_point.append(_f(parts[7]))
        humidity.append(_f(parts[8]))
        pressure.append(_f(parts[9]))
        direct_normal.append(_f(parts[13]))
        diffuse_horizontal.append(_f(parts[14]))
        global_horizontal.append(_f(parts[15]))
        wind_dir.append(_f(parts[20]))
        wind_speed.append(_f(parts[21]))
        try: sky_cover.append(_f(parts[22]))
        except: sky_cover.append(0.0)

    # Wet-bulb via Stull (2011): T_wb ≈ T*atan(0.151977*(RH+8.313659)^0.5)
    #   + atan(T+RH) − atan(RH−1.676331) + 0.00391838*RH^1.5*atan(0.023101*RH)
    #   − 4.686035
    def _wet_bulb(T, RH):
        try:
            rh = max(0.0, min(100.0, RH))
            return (T * math.atan(0.151977 * (rh + 8.313659) ** 0.5)
                    + math.atan(T + rh) - math.atan(rh - 1.676331)
                    + 0.00391838 * rh ** 1.5 * math.atan(0.023101 * rh)
                    - 4.686035)
        except Exception:
            return T
    wet_bulb = [_wet_bulb(t, h) for t, h in zip(dry_bulb, humidity)]

    # ── Aggregations ──────────────────────────────────────────────────────────
    # Monthly stats — min/avg/max dry-bulb + sum of solar
    months_unique = sorted(set(month_arr))
    monthly = []
    for m in months_unique:
        idx = [i for i, mm in enumerate(month_arr) if mm == m]
        if not idx:
            continue
        ts = [dry_bulb[i] for i in idx]
        gh = [global_horizontal[i] for i in idx]
        monthly.append({
            "month": m,
            "t_min":  round(min(ts), 1),
            "t_avg":  round(sum(ts) / len(ts), 1),
            "t_max":  round(max(ts), 1),
            "ghi_kwh_per_m2": round(sum(gh) / 1000.0, 1),  # Wh/m² → kWh/m²
        })

    # HDD / CDD at common bases
    def _dd(temps, base, mode):
        if mode == "heat":
            hours = sum(max(0.0, base - t) for t in temps)
        else:
            hours = sum(max(0.0, t - base) for t in temps)
        return round(hours / 24.0, 1)

    degree_days = {
        "hdd": {
            "12":   _dd(dry_bulb, 12.0, "heat"),
            "15":   _dd(dry_bulb, 15.0, "heat"),
            "15.5": _dd(dry_bulb, 15.5, "heat"),
            "18":   _dd(dry_bulb, 18.0, "heat"),
        },
        "cdd": {
            "18":   _dd(dry_bulb, 18.0, "cool"),
            "22":   _dd(dry_bulb, 22.0, "cool"),
            "24":   _dd(dry_bulb, 24.0, "cool"),
        },
    }

    # Annual extremes + sums
    annual = {
        "t_min": round(min(dry_bulb), 1),
        "t_max": round(max(dry_bulb), 1),
        "t_avg": round(sum(dry_bulb) / len(dry_bulb), 1),
        "ghi_kwh_per_m2": round(sum(global_horizontal) / 1000.0, 1),
        "dni_kwh_per_m2": round(sum(direct_normal) / 1000.0, 1),
        "dhi_kwh_per_m2": round(sum(diffuse_horizontal) / 1000.0, 1),
        "wind_speed_avg": round(sum(wind_speed) / len(wind_speed), 1),
    }

    # Year coverage — TMY-style files have varying years per month; report
    # the dominant (mode) year per month so the user can see what's actually
    # being modelled (e.g. "Jan: 2017, Feb: 2019, ...").
    years_unique = sorted(set(year_arr))
    from collections import Counter
    months_to_years = []
    for m in months_unique:
        ys = [year_arr[i] for i, mm in enumerate(month_arr) if mm == m]
        if ys:
            mode_year, count = Counter(ys).most_common(1)[0]
            months_to_years.append({
                "month": m,
                "year": mode_year,
                "coverage": round(count / len(ys), 2),  # fraction of hours from that year
            })

    # Methodology — derive from filename so the UI can show "TMYx" /
    # "TRY" / "DSY" etc. without needing separate metadata.
    fname_upper = filepath.name.upper()
    if   "_DSY" in fname_upper:  methodology = "DSY"
    elif "_TRY" in fname_upper:  methodology = "TRY"
    elif "_TMYX" in fname_upper: methodology = "TMYx"
    elif "_TMY3" in fname_upper: methodology = "TMY3"
    elif "_TMY"  in fname_upper: methodology = "TMY"
    elif "_HDY"  in fname_upper: methodology = "HDY"
    elif "_CDY"  in fname_upper: methodology = "CDY"
    else: methodology = "Unknown"

    return {
        "filename": filepath.name,
        "location": location,
        "annual": annual,
        "monthly": monthly,
        "degree_days": degree_days,
        "methodology": methodology,
        "years": {
            "min": min(years_unique) if years_unique else None,
            "max": max(years_unique) if years_unique else None,
            "all": years_unique,
            "by_month": months_to_years,
        },
        "hourly": {
            "month":   month_arr,
            "day":     day_arr,
            "hour":    hour_arr,
            "dry_bulb": [round(v, 2) for v in dry_bulb],
            "wet_bulb": [round(v, 2) for v in wet_bulb],
            "dew_point":[round(v, 2) for v in dew_point],
            "humidity": [round(v, 1) for v in humidity],
            "global_horizontal": [round(v, 0) for v in global_horizontal],
            "direct_normal":     [round(v, 0) for v in direct_normal],
            "diffuse_horizontal":[round(v, 0) for v in diffuse_horizontal],
            "wind_speed": [round(v, 1) for v in wind_speed],
        },
    }


_INSPECT_CACHE: dict[str, dict] = {}


@router.get("/api/weather/{filename}/inspect")
async def inspect_weather(filename: str):
    """
    Return a comprehensive weather-data report for the Weather module:
      - location metadata
      - annual + monthly stats
      - HDD / CDD at multiple bases
      - hourly arrays for visualisation
    Cached per resolved-path.
    """
    if filename == "default":
        epws = sorted(DEFAULT_WEATHER_DIR.glob("*.epw"))
        if not epws:
            raise HTTPException(status_code=500, detail=f"No EPW files in {DEFAULT_WEATHER_DIR}")
        filepath = epws[0]
    else:
        filepath = resolve_weather_file(filename)

    cache_key = str(filepath.resolve())
    if cache_key not in _INSPECT_CACHE:
        try:
            _INSPECT_CACHE[cache_key] = _parse_epw_full(filepath)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to parse EPW: {exc}") from exc
    return _INSPECT_CACHE[cache_key]


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


# ── UK Station Index ──────────────────────────────────────────────────────────

_STATIONS_CACHE: list[dict] | None = None
_STATIONS_FILE  = Path("data/weather/uk_stations.json")


def _load_stations() -> list[dict]:
    global _STATIONS_CACHE
    if _STATIONS_CACHE is not None:
        return _STATIONS_CACHE
    if not _STATIONS_FILE.exists():
        return []
    try:
        with open(_STATIONS_FILE, encoding="utf-8") as f:
            data = json.load(f)
        _STATIONS_CACHE = data.get("stations", [])
    except Exception:
        _STATIONS_CACHE = []
    return _STATIONS_CACHE


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km (Haversine formula)."""
    R    = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a    = (math.sin(dlat / 2) ** 2
            + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
            * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


@router.get("/api/weather/nearest")
async def nearest_station(
    postcode: str | None = Query(None, description="UK postcode, e.g. TA6 6DF"),
    lat:      float | None = Query(None),
    lon:      float | None = Query(None),
):
    """
    Find the nearest climate.onebuilding.org TMYx station to a postcode or coordinates.

    Returns the nearest station plus up to 3 alternatives.
    """
    # Resolve postcode → lat/lon via postcodes.io
    resolved_lat, resolved_lon = lat, lon
    location_name: str | None = None

    if postcode and (resolved_lat is None or resolved_lon is None):
        clean = postcode.strip().replace(" ", "")
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(f"https://api.postcodes.io/postcodes/{clean}")
            if not r.is_success:
                raise HTTPException(status_code=400, detail=f"Could not resolve postcode '{postcode}' — postcodes.io returned {r.status_code}")
            result = r.json().get("result") or {}
            resolved_lat = result.get("latitude")
            resolved_lon = result.get("longitude")
            location_name = result.get("admin_district") or result.get("region")
        except httpx.RequestError as exc:
            raise HTTPException(status_code=503, detail=f"Postcode lookup failed: {exc}")

    if resolved_lat is None or resolved_lon is None:
        raise HTTPException(status_code=400, detail="Provide postcode or lat/lon query parameters")

    stations = _load_stations()
    if not stations:
        raise HTTPException(
            status_code=503,
            detail="UK station index not available. Run: python scripts/build_station_index.py",
        )

    # Sort by haversine distance
    ranked = sorted(
        stations,
        key=lambda s: _haversine_km(resolved_lat, resolved_lon, s["latitude"], s["longitude"]),
    )

    def _enrich(s: dict) -> dict:
        return {**s, "distance_km": round(_haversine_km(resolved_lat, resolved_lon, s["latitude"], s["longitude"]), 1)}

    nearest      = _enrich(ranked[0])
    alternatives = [_enrich(s) for s in ranked[1:4]]

    # Check if the nearest station is already downloaded
    epw_name = nearest["filename"].replace(".zip", ".epw")
    already_downloaded = (PROJECT_WEATHER_CURRENT / epw_name).exists()

    return {
        "location": {
            "latitude":  resolved_lat,
            "longitude": resolved_lon,
            "name":      location_name,
        },
        "nearest":              {**nearest, "already_downloaded": already_downloaded},
        "alternatives":         alternatives,
        "station_count":        len(stations),
    }


class DownloadRequest(BaseModel):
    filename:     str  # e.g. "GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.zip"
    download_url: str
    station_name: str


@router.post("/api/weather/download")
async def download_station_epw(body: DownloadRequest):
    """
    Download an EPW from climate.onebuilding.org, extract it, and save to
    data/weather/current/. No-ops if the file already exists.
    """
    epw_name  = body.filename.replace(".zip", ".epw")
    dest_path = PROJECT_WEATHER_CURRENT / epw_name

    if dest_path.exists():
        # Invalidate list cache so the new file appears
        return {
            "status":       "already_exists",
            "filename":     epw_name,
            "message":      f"Already downloaded: {epw_name}",
        }

    # Download the zip from climate.onebuilding.org
    try:
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            r = await client.get(body.download_url)
        if not r.is_success:
            raise HTTPException(status_code=502, detail=f"Download failed: HTTP {r.status_code} from {body.download_url}")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail=f"Network error downloading EPW: {exc}")

    # Extract .epw from zip
    try:
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            epw_members = [n for n in z.namelist() if n.lower().endswith(".epw")]
            if not epw_members:
                raise HTTPException(status_code=502, detail="No .epw file found in downloaded zip")
            epw_content = z.read(epw_members[0])
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=502, detail=f"Downloaded file is not a valid zip: {exc}")

    # Save to current weather directory
    PROJECT_WEATHER_CURRENT.mkdir(parents=True, exist_ok=True)
    dest_path.write_bytes(epw_content)

    # Invalidate EPW list cache so the new file is immediately visible
    # (The _EPW_CACHE for hourly data is keyed by filepath, not affected here)

    return {
        "status":       "downloaded",
        "filename":     epw_name,
        "station_name": body.station_name,
        "size_bytes":   len(epw_content),
    }
