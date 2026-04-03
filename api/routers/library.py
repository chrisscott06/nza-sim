"""
api/routers/library.py

Library management endpoints for NZA Simulate.

GET    /api/library                       — List all library items (filterable)
GET    /api/library/{id}                  — Get full library item
POST   /api/library                       — Create a custom library item
PUT    /api/library/{id}                  — Update a custom library item
DELETE /api/library/{id}                  — Delete a custom library item

Legacy compat endpoints (still used by frontend):
GET    /api/library/constructions         — List constructions
GET    /api/library/constructions/{name}  — Get construction detail
GET    /api/library/systems               — List systems
GET    /api/library/systems/{name}        — Get system detail
GET    /api/library/schedules             — List schedules
"""

import json
import uuid

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from api.db.database import get_db

router = APIRouter(prefix="/api/library", tags=["library"])


# ── Pydantic models ────────────────────────────────────────────────────────────

class CreateLibraryItemRequest(BaseModel):
    library_type: str
    name: str
    display_name: str | None = None
    description: str | None = None
    config_json: dict


class UpdateLibraryItemRequest(BaseModel):
    name: str | None = None
    display_name: str | None = None
    description: str | None = None
    config_json: dict | None = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _row_to_item(row, include_config: bool = True) -> dict:
    """Convert a library_items row to a dict."""
    cfg = json.loads(row["config_json"])
    out = {
        "id":           row["id"],
        "library_type": row["library_type"],
        "name":         row["name"],
        "display_name": row["display_name"],
        "description":  row["description"],
        "is_default":   bool(row["is_default"]),
        "created_at":   row["created_at"],
        "updated_at":   row["updated_at"],
    }
    if include_config:
        # Full config for detail views
        out["config_json"] = cfg
    else:
        # Slim summary: key metrics only, for card/list display
        out["config_json"] = {
            "u_value_W_per_m2K": cfg.get("u_value_W_per_m2K"),
            "g_value":           cfg.get("g_value"),
            "thermal_mass":      cfg.get("thermal_mass"),
            "type":              cfg.get("type"),
            "cop":               cfg.get("cop"),
            "eer":               cfg.get("eer"),
            "category":          cfg.get("category"),
            "schedule_type":     cfg.get("schedule_type"),
            "zone_type":         cfg.get("zone_type"),
        }
    return out


# ── Generic library CRUD ───────────────────────────────────────────────────────

@router.get("")
async def list_library_items(
    type: str | None = Query(None, description="Filter by library_type"),
    search: str | None = Query(None, description="Search by name or description"),
):
    """List all library items, optionally filtered by type or search term."""
    async with get_db() as db:
        if type and search:
            cursor = await db.execute(
                """
                SELECT id, library_type, name, display_name, description, config_json, is_default, created_at, updated_at
                FROM library_items
                WHERE library_type = ?
                  AND (name LIKE ? OR description LIKE ? OR display_name LIKE ?)
                ORDER BY is_default DESC, name
                """,
                (type, f"%{search}%", f"%{search}%", f"%{search}%"),
            )
        elif type:
            cursor = await db.execute(
                """
                SELECT id, library_type, name, display_name, description, config_json, is_default, created_at, updated_at
                FROM library_items
                WHERE library_type = ?
                ORDER BY is_default DESC, name
                """,
                (type,),
            )
        elif search:
            cursor = await db.execute(
                """
                SELECT id, library_type, name, display_name, description, config_json, is_default, created_at, updated_at
                FROM library_items
                WHERE name LIKE ? OR description LIKE ? OR display_name LIKE ?
                ORDER BY library_type, is_default DESC, name
                """,
                (f"%{search}%", f"%{search}%", f"%{search}%"),
            )
        else:
            cursor = await db.execute(
                """
                SELECT id, library_type, name, display_name, description, config_json, is_default, created_at, updated_at
                FROM library_items
                ORDER BY library_type, is_default DESC, name
                """
            )

        rows = await cursor.fetchall()

    return [_row_to_item(r, include_config=False) for r in rows]


@router.get("/constructions")
async def get_constructions():
    """
    Return all constructions — database-backed.
    Maintains legacy response shape for frontend compatibility.
    """
    async with get_db() as db:
        cursor = await db.execute(
            """
            SELECT id, name, display_name, description, config_json
            FROM library_items
            WHERE library_type = 'construction'
            ORDER BY is_default DESC, name
            """
        )
        rows = await cursor.fetchall()

    constructions = []
    for row in rows:
        cfg = json.loads(row["config_json"])
        constructions.append({
            "name":              row["name"],
            "display_name":      row["display_name"] or row["name"],
            "description":       row["description"] or "",
            "type":              cfg.get("type", "wall"),
            "u_value_W_per_m2K": cfg.get("u_value_W_per_m2K"),
            "g_value":           cfg.get("g_value"),
            "thermal_mass":      cfg.get("thermal_mass"),
        })

    return {"constructions": constructions}


@router.get("/constructions/{name}")
async def get_construction_detail(name: str):
    """Return the full definition for a specific construction."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM library_items WHERE library_type = 'construction' AND name = ?",
            (name,),
        )
        row = await cursor.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Construction '{name}' not found")

    cfg = json.loads(row["config_json"])
    return {
        "name":       row["name"],
        "definition": cfg.get("epjson", cfg),  # return epJSON-ready layers
        "summary":    {
            "type":              cfg.get("type"),
            "u_value_W_per_m2K": cfg.get("u_value_W_per_m2K"),
            "g_value":           cfg.get("g_value"),
            "thermal_mass":      cfg.get("thermal_mass"),
            "description":       cfg.get("description", ""),
        },
    }


@router.get("/systems")
async def get_systems(category: str | None = None, serves: str | None = None):
    """
    Return all system templates — database-backed.
    Optional filters:
      category: hvac, heating, cooling, dhw, ventilation
      serves:   heating, cooling, heating_and_cooling, dhw, ventilation
    """
    async with get_db() as db:
        cursor = await db.execute(
            """
            SELECT name, display_name, description, config_json
            FROM library_items
            WHERE library_type = 'system'
            ORDER BY name
            """
        )
        rows = await cursor.fetchall()

    systems = []
    for row in rows:
        cfg = json.loads(row["config_json"])
        if category and cfg.get("category") != category:
            continue
        # Filter by serves field — support comma-separated for "heating_and_cooling"
        if serves:
            item_serves = cfg.get("serves", "")
            # "heating_and_cooling" should match queries for "heating" or "cooling"
            if serves in ("heating", "cooling") and item_serves == "heating_and_cooling":
                pass  # include combined systems in heating/cooling queries
            elif item_serves != serves:
                continue
        systems.append({
            "name":         row["name"],
            "display_name": row["display_name"] or cfg.get("display_name", row["name"]),
            "description":  row["description"] or cfg.get("description", ""),
            "category":     cfg.get("category", "hvac"),
            **{k: v for k, v in cfg.items() if k not in ("name", "display_name", "description")},
        })

    return {"systems": systems}


@router.get("/systems/{name}")
async def get_system_detail(name: str):
    """Return the full template for a specific system."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM library_items WHERE library_type = 'system' AND name = ?",
            (name,),
        )
        row = await cursor.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"System '{name}' not found")

    cfg = json.loads(row["config_json"])
    return {"name": row["name"], "system": cfg}


@router.get("/benchmarks")
async def get_benchmarks(building_type: str | None = None, pathway: str | None = None):
    """
    Return all benchmark pathways (CRREM, carbon intensity).
    Optional filters: building_type (e.g. 'hotel'), pathway (e.g. '1.5C').
    """
    async with get_db() as db:
        cursor = await db.execute(
            """
            SELECT id, name, display_name, description, config_json
            FROM library_items
            WHERE library_type = 'benchmark'
            ORDER BY name
            """
        )
        rows = await cursor.fetchall()

    benchmarks = []
    for row in rows:
        cfg = json.loads(row["config_json"])
        if building_type and cfg.get("building_type") != building_type:
            continue
        if pathway and cfg.get("pathway") != pathway:
            continue
        benchmarks.append({
            "id":            row["id"],
            "name":          row["name"],
            "display_name":  row["display_name"] or row["name"],
            "description":   row["description"] or "",
            "building_type": cfg.get("building_type"),
            "pathway":       cfg.get("pathway"),
            "country":       cfg.get("country"),
            "config_json":   cfg,
        })

    return {"benchmarks": benchmarks}


@router.get("/schedules")
async def get_schedules():
    """Return all schedule templates — database-backed."""
    async with get_db() as db:
        cursor = await db.execute(
            """
            SELECT id, name, display_name, description, config_json
            FROM library_items
            WHERE library_type = 'schedule'
            ORDER BY name
            """
        )
        rows = await cursor.fetchall()

    schedules = []
    for row in rows:
        cfg = json.loads(row["config_json"])
        schedules.append({
            "id":            row["id"],
            "name":          row["name"],
            "display_name":  row["display_name"] or row["name"],
            "description":   row["description"] or "",
            "schedule_type": cfg.get("schedule_type"),
            "building_type": cfg.get("building_type"),
            "zone_type":     cfg.get("zone_type"),
        })

    return {"schedules": schedules}


@router.get("/{item_id}")
async def get_library_item(item_id: str):
    """Return full details for a specific library item including config_json."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM library_items WHERE id = ?", (item_id,)
        )
        row = await cursor.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Library item '{item_id}' not found")

    return _row_to_item(row, include_config=True)


@router.post("", status_code=201)
async def create_library_item(request: CreateLibraryItemRequest):
    """Create a custom (non-default) library item."""
    item_id = f"custom_{str(uuid.uuid4())[:8]}"

    async with get_db() as db:
        await db.execute(
            """
            INSERT INTO library_items
                (id, library_type, name, display_name, description, config_json, is_default)
            VALUES (?, ?, ?, ?, ?, ?, 0)
            """,
            (
                item_id,
                request.library_type,
                request.name,
                request.display_name or request.name,
                request.description or "",
                json.dumps(request.config_json),
            ),
        )
        await db.commit()

        cursor = await db.execute(
            "SELECT * FROM library_items WHERE id = ?", (item_id,)
        )
        row = await cursor.fetchone()

    return _row_to_item(row, include_config=True)


@router.put("/{item_id}")
async def update_library_item(item_id: str, request: UpdateLibraryItemRequest):
    """Update a custom library item. Default (built-in) items are read-only."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM library_items WHERE id = ?", (item_id,)
        )
        row = await cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail=f"Library item '{item_id}' not found")
        if row["is_default"]:
            raise HTTPException(
                status_code=403,
                detail="Built-in library items are read-only. Duplicate the item to create an editable copy.",
            )

        current = _row_to_item(row, include_config=True)
        name         = request.name or current["name"]
        display_name = request.display_name or current["display_name"]
        description  = request.description if request.description is not None else current["description"]
        config_json  = request.config_json or current["config_json"]

        await db.execute(
            """
            UPDATE library_items SET
                name = ?, display_name = ?, description = ?, config_json = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (name, display_name, description, json.dumps(config_json), item_id),
        )
        await db.commit()

        cursor = await db.execute("SELECT * FROM library_items WHERE id = ?", (item_id,))
        updated = await cursor.fetchone()

    return _row_to_item(updated, include_config=True)


@router.delete("/{item_id}", status_code=204)
async def delete_library_item(item_id: str):
    """Delete a custom library item. Default (built-in) items cannot be deleted."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id, is_default FROM library_items WHERE id = ?", (item_id,)
        )
        row = await cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail=f"Library item '{item_id}' not found")
        if row["is_default"]:
            raise HTTPException(
                status_code=403,
                detail="Built-in library items cannot be deleted.",
            )

        await db.execute("DELETE FROM library_items WHERE id = ?", (item_id,))
        await db.commit()
