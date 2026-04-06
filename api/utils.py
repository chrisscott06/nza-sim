"""
api/utils.py

Shared utilities used across API routers.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException

from nza_engine.config import (
    DEFAULT_WEATHER_DIR,
    PROJECT_WEATHER_CURRENT,
    PROJECT_WEATHER_FUTURE,
)

# Ordered list of directories to search for EPW files.
# Project-specific directories take priority over the EnergyPlus bundled files.
_WEATHER_SEARCH_DIRS = [
    PROJECT_WEATHER_CURRENT,
    PROJECT_WEATHER_FUTURE,
    DEFAULT_WEATHER_DIR,
]


def all_epw_files() -> list[Path]:
    """Return all EPW files found across all weather search directories."""
    seen: set[str] = set()
    files: list[Path] = []
    for d in _WEATHER_SEARCH_DIRS:
        if d.exists():
            for p in sorted(d.rglob("*.epw")):
                if p.name not in seen:
                    seen.add(p.name)
                    files.append(p)
    return files


def resolve_weather_file(weather_file: str | None) -> Path:
    """Resolve a weather file name or path to a full filesystem Path.

    Search order:
      1. data/weather/current/
      2. data/weather/future/ (recursive)
      3. EnergyPlus WeatherData/ (fallback)
    """
    if not weather_file or weather_file == "USE_DEFAULT":
        # Pick first available EPW across all directories
        all_files = all_epw_files()
        # Prefer current-climate files (cntr_ prefix) if available
        current = [f for f in all_files if f.parent == PROJECT_WEATHER_CURRENT]
        preferred = current or all_files
        if not preferred:
            raise HTTPException(
                status_code=500,
                detail="No EPW weather files found. Add files to data/weather/current/ or install EnergyPlus.",
            )
        return preferred[0]

    # Search all directories for a matching filename
    for search_dir in _WEATHER_SEARCH_DIRS:
        if not search_dir.exists():
            continue
        for candidate in search_dir.rglob(weather_file):
            if candidate.is_file():
                return candidate

    # Absolute path fallback
    full = Path(weather_file)
    if full.exists():
        return full

    raise HTTPException(
        status_code=400,
        detail=f"Weather file not found: {weather_file!r}. "
               f"Searched: {', '.join(str(d) for d in _WEATHER_SEARCH_DIRS)}",
    )
