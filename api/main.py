"""
api/main.py

NZA Simulate — FastAPI application entry point.

Start with:
    python -m uvicorn api.main:app --host 127.0.0.1 --port 8002

Endpoints:
    GET  /api/health                  — EnergyPlus status and available weather files
    POST /api/simulate                — Run a simulation, return results
    GET  /api/simulate/{run_id}       — Retrieve a previous simulation run
    GET  /api/library/constructions   — List available constructions
    GET  /api/library/constructions/{name} — Get construction detail
    GET  /api/library/schedules       — List available schedule templates
"""

import subprocess
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from nza_engine.config import ENERGYPLUS_BIN, ENERGYPLUS_DIR, DEFAULT_WEATHER_DIR
from api.routers import simulate, library
from api.routers import projects as projects_router
from api.routers import scenarios as scenarios_router
from api.db.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialise the database (create tables, seed library) on startup."""
    await init_db()
    yield


app = FastAPI(
    title="NZA Simulate API",
    description="Building energy simulation API powered by EnergyPlus",
    version="0.1.0",
    lifespan=lifespan,
)

# Allow the Vite dev server (port 5176) to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5176", "http://127.0.0.1:5176"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(simulate.router)
app.include_router(library.router)
app.include_router(projects_router.router)
app.include_router(scenarios_router.router)


@app.get("/api/health")
async def health():
    """
    Return EnergyPlus installation status and available weather files.
    """
    ep_ok = ENERGYPLUS_BIN.exists()
    ep_version = "unknown"

    if ep_ok:
        try:
            result = subprocess.run(
                [str(ENERGYPLUS_BIN), "--version"],
                capture_output=True, text=True, timeout=5,
            )
            output = (result.stdout + result.stderr).strip()
            # Parse "EnergyPlus, Version X.Y.Z-..." from first line
            for line in output.splitlines():
                if "version" in line.lower() or "energyplus" in line.lower():
                    ep_version = line.strip()
                    break
        except Exception as e:
            ep_version = f"error: {e}"

    # List available weather files
    weather_files = []
    if DEFAULT_WEATHER_DIR.exists():
        for epw in sorted(DEFAULT_WEATHER_DIR.glob("*.epw")):
            weather_files.append(epw.name)

    return {
        "status": "ok" if ep_ok else "energyplus_not_found",
        "energyplus_dir": str(ENERGYPLUS_DIR),
        "energyplus_bin": str(ENERGYPLUS_BIN),
        "energyplus_found": ep_ok,
        "energyplus_version": ep_version,
        "available_weather_files": weather_files,
        "weather_dir": str(DEFAULT_WEATHER_DIR),
    }
