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
from __future__ import annotations

import json
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite

from nza_engine.config import DATA_DIR
from nza_engine.library.constructions import list_constructions
from nza_engine.library.systems import list_systems
from nza_engine.library.benchmarks import _BENCHMARKS

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
    # Per-facade external shading. Defaults are zero (no shading).
    # depth_m   = projection out from the facade (m)
    # offset_m  = vertical gap from window head to underside of overhang (m)
    # left_depth_m / right_depth_m = vertical fin projection on each side
    # of the window (looking at the facade from outside)
    "shading_overhang": {
        "north": {"depth_m": 0.0, "offset_m": 0.0},
        "south": {"depth_m": 0.0, "offset_m": 0.0},
        "east":  {"depth_m": 0.0, "offset_m": 0.0},
        "west":  {"depth_m": 0.0, "offset_m": 0.0},
    },
    "shading_fin": {
        "north": {"left_depth_m": 0.0, "right_depth_m": 0.0},
        "south": {"left_depth_m": 0.0, "right_depth_m": 0.0},
        "east":  {"left_depth_m": 0.0, "right_depth_m": 0.0},
        "west":  {"left_depth_m": 0.0, "right_depth_m": 0.0},
    },
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

        # Brief 26 Part 1: comfort_band columns on projects.
        # State contract requires `project.comfort_band.{lower_c, upper_c}` as a
        # first-class field. Existing projects backfill with 20/26 defaults.
        for col, default in (("comfort_band_lower_c", 20.0), ("comfort_band_upper_c", 26.0)):
            try:
                await db.execute(
                    f"ALTER TABLE projects ADD COLUMN {col} REAL DEFAULT {default}"
                )
                await db.commit()
            except Exception:
                pass  # already present

        # Seed constructions from nza_engine library
        await _seed_constructions(db)

        # Seed system templates from nza_engine library
        await _seed_systems(db)

        # Seed schedule templates from nza_engine library
        await _seed_schedules(db)

        # Seed CRREM benchmark pathways
        await _seed_benchmarks(db)

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
    """Seed all system templates from the Python library into library_items.

    Uses INSERT OR REPLACE so new fields (serves, efficiency_type, etc.) are
    propagated to existing items when the library is updated. Default rows that
    no longer exist in the Python library are removed (covers the case where a
    template — e.g. the old ``natural_vent_windows`` system — is retired).
    """
    from nza_engine.library.systems import _SYSTEMS  # type: ignore[attr-defined]

    # Drop any default system rows whose name no longer exists in the library.
    valid_names = list(_SYSTEMS.keys())
    placeholders = ",".join("?" * len(valid_names)) or "''"
    await db.execute(
        f"DELETE FROM library_items WHERE library_type='system' AND is_default=1 AND name NOT IN ({placeholders})",
        valid_names,
    )

    for name, data in _SYSTEMS.items():
        item_id = f"lib_system_{name}"
        config = {**data, "name": name}
        await db.execute(
            """
            INSERT OR REPLACE INTO library_items
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


async def _seed_benchmarks(db: aiosqlite.Connection) -> None:
    """Seed CRREM pathway and carbon intensity benchmarks into library_items."""
    from nza_engine.library.benchmarks import _BENCHMARKS  # type: ignore[attr-defined]

    for name, data in _BENCHMARKS.items():
        item_id = f"lib_benchmark_{name}"
        await db.execute(
            """
            INSERT OR IGNORE INTO library_items
                (id, library_type, name, display_name, description, config_json, is_default)
            VALUES (?, 'benchmark', ?, ?, ?, ?, 1)
            """,
            (
                item_id,
                name,
                data.get("display_name", name),
                data.get("description", ""),
                json.dumps(data),
            ),
        )
