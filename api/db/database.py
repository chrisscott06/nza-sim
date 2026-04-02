"""
api/db/database.py

SQLite database layer for NZA Simulate.
Uses aiosqlite for async access. WAL mode enabled for concurrent reads.

Usage
-----
    from api.db.database import init_db, get_db

    await init_db()

    async with get_db() as db:
        rows = await db.execute("SELECT * FROM projects")
        ...
"""

import json
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite

from nza_engine.config import DATA_DIR
from nza_engine.library.constructions import list_constructions
from nza_engine.library.systems import list_systems

# ── Database path ─────────────────────────────────────────────────────────────

DATABASE_PATH = DATA_DIR / "nza_sim.db"
_SCHEMA_PATH  = Path(__file__).parent / "schema.sql"

# ── Default project config ────────────────────────────────────────────────────

DEFAULT_BUILDING_CONFIG = {
    "name":         "New Project",
    "length":       60.0,
    "width":        15.0,
    "num_floors":   4,
    "floor_height": 3.2,
    "orientation":  0.0,
    "wwr": {"north": 0.25, "south": 0.25, "east": 0.25, "west": 0.25},
}

DEFAULT_CONSTRUCTION_CHOICES = {
    "external_wall": "cavity_wall_standard",
    "roof":          "flat_roof_standard",
    "ground_floor":  "ground_floor_slab",
    "glazing":       "double_low_e",
}

DEFAULT_SYSTEMS_CONFIG = {
    "mode":                    "ideal",
    "hvac_type":               "vrf_standard",
    "ventilation_type":        "mev_standard",
    "natural_ventilation":     False,
    "natural_vent_threshold":  22.0,
    "dhw_primary":             "gas_boiler_dhw",
    "dhw_preheat":             "ashp_dhw",
    "dhw_setpoint":            60.0,
    "dhw_preheat_setpoint":    45.0,
    "lighting_power_density":  8.0,
    "lighting_control":        "occupancy_sensing",
    "pump_type":               "variable_speed",
}


# ── Connection helper ─────────────────────────────────────────────────────────

@asynccontextmanager
async def get_db():
    """Async context manager yielding an aiosqlite connection in WAL mode."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")
        yield db


# ── Schema initialisation ─────────────────────────────────────────────────────

async def init_db() -> None:
    """
    Create tables (if not exists) and seed the global library with
    default constructions and system templates.

    Safe to call multiple times — uses INSERT OR IGNORE to avoid duplicates.
    """
    schema_sql = _SCHEMA_PATH.read_text()

    async with get_db() as db:
        # Create tables (scenarios table included in schema.sql)
        await db.executescript(schema_sql)
        await db.commit()

        # Add scenario_id to simulation_runs if not yet present.
        # SQLite does not support ADD COLUMN IF NOT EXISTS, so catch the error.
        try:
            await db.execute(
                "ALTER TABLE simulation_runs ADD COLUMN scenario_id TEXT REFERENCES scenarios(id) ON DELETE SET NULL"
            )
            await db.commit()
        except Exception:
            # Column already exists — this is expected on subsequent startups
            pass

        # Seed constructions from nza_engine library
        await _seed_constructions(db)

        # Seed system templates from nza_engine library
        await _seed_systems(db)

        # Seed schedule templates from nza_engine library
        await _seed_schedules(db)

        await db.commit()


# ── Seed helpers ──────────────────────────────────────────────────────────────

async def _seed_constructions(db: aiosqlite.Connection) -> None:
    """Seed all constructions from the Python library into library_items."""
    from nza_engine.library.constructions import (
        _CONSTRUCTIONS,  # type: ignore[attr-defined]
    )

    for name, data in _CONSTRUCTIONS.items():
        item_id = f"lib_construction_{name}"
        summary = data.get("summary", {})
        # Store the full raw construction data as config_json for layer detail
        config = {
            "name":              name,
            "type":              summary.get("type", "wall"),
            "u_value_W_per_m2K": summary.get("u_value_W_per_m2K"),
            "g_value":           summary.get("g_value"),
            "thermal_mass":      summary.get("thermal_mass"),
            "description":       summary.get("description", name),
            # Store the full epJSON-ready layers so the UI can show layer buildup
            "epjson":            {k: v for k, v in data.items() if k != "summary"},
        }
        description = summary.get("description", "")
        display_name = summary.get("description", name)  # use description as display name
        await db.execute(
            """
            INSERT OR IGNORE INTO library_items
                (id, library_type, name, display_name, description, config_json, is_default)
            VALUES (?, 'construction', ?, ?, ?, ?, 1)
            """,
            (
                item_id,
                name,
                display_name,
                description,
                json.dumps(config),
            ),
        )


async def _seed_schedules(db: aiosqlite.Connection) -> None:
    """Seed all schedule templates from the visual library into library_items."""
    from nza_engine.library.schedules import _SCHEDULE_LIBRARY  # type: ignore[attr-defined]

    for name, data in _SCHEDULE_LIBRARY.items():
        item_id = f"lib_schedule_{name}"
        config = {**data, "name": name}
        await db.execute(
            """
            INSERT OR IGNORE INTO library_items
                (id, library_type, name, display_name, description, config_json, is_default)
            VALUES (?, 'schedule', ?, ?, ?, ?, 1)
            """,
            (
                item_id,
                name,
                data.get("display_name", name),
                data.get("description", ""),
                json.dumps(config),
            ),
        )


async def _seed_systems(db: aiosqlite.Connection) -> None:
    """Seed all system templates from the Python library into library_items."""
    from nza_engine.library.systems import _SYSTEMS  # type: ignore[attr-defined]

    for name, data in _SYSTEMS.items():
        item_id = f"lib_system_{name}"
        config = {**data, "name": name}
        await db.execute(
            """
            INSERT OR IGNORE INTO library_items
                (id, library_type, name, display_name, description, config_json, is_default)
            VALUES (?, 'system', ?, ?, ?, ?, 1)
            """,
            (
                item_id,
                name,
                data.get("display_name", name),
                data.get("description", ""),
                json.dumps(config),
            ),
        )
