"""
nza_engine/config.py

Central configuration for NZA Simulate.
EnergyPlus paths are read from environment variables, falling back to
the standard macOS installation path used on Chris's machine.
"""

import os
from pathlib import Path

# ── Project root ──────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# ── EnergyPlus installation ───────────────────────────────────────────────────
ENERGYPLUS_DIR = Path(
    os.environ.get("ENERGYPLUS_DIR", "/Applications/EnergyPlus-25-2-0")
)

ENERGYPLUS_BIN = ENERGYPLUS_DIR / "energyplus"
ENERGYPLUS_IDD = ENERGYPLUS_DIR / "Energy+.idd"
ENERGYPLUS_SCHEMA = ENERGYPLUS_DIR / "Energy+.schema.epJSON"
DEFAULT_WEATHER_DIR = ENERGYPLUS_DIR / "WeatherData"

# ── Data directories ──────────────────────────────────────────────────────────
DATA_DIR = PROJECT_ROOT / "data"
SIMULATIONS_DIR = DATA_DIR / "simulations"

# ── Project weather directories ───────────────────────────────────────────────
# Organised EPW files for NZA Simulate. Searched before the EnergyPlus WeatherData
# fallback so project-specific files take priority.
PROJECT_WEATHER_DIR     = DATA_DIR / "weather"
PROJECT_WEATHER_CURRENT = PROJECT_WEATHER_DIR / "current"    # current-climate EPW files
PROJECT_WEATHER_FUTURE  = PROJECT_WEATHER_DIR / "future"     # PROMETHEUS future EPW files

# ── Ensure runtime directories exist ─────────────────────────────────────────
SIMULATIONS_DIR.mkdir(parents=True, exist_ok=True)
PROJECT_WEATHER_CURRENT.mkdir(parents=True, exist_ok=True)
PROJECT_WEATHER_FUTURE.mkdir(parents=True, exist_ok=True)
