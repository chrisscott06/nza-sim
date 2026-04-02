"""
api/utils.py

Shared utilities used across API routers.
"""

from pathlib import Path

from fastapi import HTTPException

from nza_engine.config import DEFAULT_WEATHER_DIR


def resolve_weather_file(weather_file: str | None) -> Path:
    """Resolve a weather file name or path to a full filesystem Path."""
    if not weather_file or weather_file == "USE_DEFAULT":
        epws = sorted(DEFAULT_WEATHER_DIR.glob("*.epw"))
        if not epws:
            raise HTTPException(
                status_code=500,
                detail=f"No EPW files found in {DEFAULT_WEATHER_DIR}",
            )
        return epws[0]

    # Bare filename → look in default weather directory
    candidate = DEFAULT_WEATHER_DIR / weather_file
    if candidate.exists():
        return candidate

    # Absolute path
    full = Path(weather_file)
    if full.exists():
        return full

    raise HTTPException(
        status_code=400,
        detail=f"Weather file not found: {weather_file}",
    )
