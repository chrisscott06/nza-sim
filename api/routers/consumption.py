"""
api/routers/consumption.py

Consumption data endpoints.

POST /api/projects/{project_id}/consumption/upload
    Upload and parse a CSV/Excel file of half-hourly or monthly consumption data.

GET  /api/projects/{project_id}/consumption
    List all consumption datasets for a project.

GET  /api/projects/{project_id}/consumption/{consumption_id}/records
    Return raw records for a dataset (with optional date filtering).

GET  /api/projects/{project_id}/consumption/{consumption_id}/monthly
    Monthly aggregated totals.

GET  /api/projects/{project_id}/consumption/{consumption_id}/daily
    Daily aggregated totals.

DELETE /api/projects/{project_id}/consumption/{consumption_id}
    Delete a consumption dataset and all its records.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from api.db.database import get_db

router = APIRouter(prefix="/api/projects/{project_id}/consumption", tags=["consumption"])


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _require_project(project_id: str) -> None:
    """Raise 404 if the project does not exist."""
    async with get_db() as db:
        row = await db.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not await row.fetchone():
            raise HTTPException(status_code=404, detail=f"Project {project_id!r} not found")


async def _require_consumption(project_id: str, consumption_id: str) -> dict:
    """Return the consumption_data row or raise 404."""
    async with get_db() as db:
        row = await db.execute(
            "SELECT * FROM consumption_data WHERE id = ? AND project_id = ?",
            (consumption_id, project_id),
        )
        record = await row.fetchone()
        if not record:
            raise HTTPException(status_code=404, detail=f"Consumption dataset {consumption_id!r} not found")
        return dict(record)


# ── Upload ────────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_consumption(
    project_id: str,
    file: UploadFile = File(...),
):
    """
    Parse an uploaded CSV/Excel consumption file and store records.
    Returns a summary of the imported dataset.
    """
    await _require_project(project_id)

    file_bytes = await file.read()
    filename   = file.filename or "upload.csv"

    # Import parser lazily to avoid startup cost
    try:
        from api.parsers.consumption_parser import parse_consumption_file
        from api.parsers.assembly_engine import assemble_complete_year
    except ImportError as exc:
        raise HTTPException(status_code=500, detail=f"Parser module unavailable: {exc}")

    try:
        parsed = parse_consumption_file(file_bytes, filename)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to parse file: {exc}")

    if not parsed.get("records"):
        raise HTTPException(status_code=422, detail="No records found in file")

    # Gap-fill to produce a complete year
    try:
        assembled = assemble_complete_year(
            parsed["records"],
            target_year=parsed.get("target_year"),
            interval_minutes=parsed.get("interval_minutes", 30),
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Assembly failed: {exc}")

    records     = assembled["records"]
    provenance  = assembled["provenance"]
    total_kwh   = assembled["total_kwh"]
    fuel_type   = parsed.get("fuel_type", "electricity")
    interval    = assembled.get("interval_minutes", 30)

    timestamps = [r["timestamp"] for r in records if r.get("timestamp")]
    data_start = min(timestamps)[:10] if timestamps else None
    data_end   = max(timestamps)[:10] if timestamps else None

    consumption_id = str(uuid.uuid4())

    async with get_db() as db:
        await db.execute(
            """
            INSERT INTO consumption_data
                (id, project_id, fuel_type, interval_minutes, data_start, data_end,
                 total_kwh, record_count, source_filename, provenance_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                consumption_id, project_id, fuel_type, interval,
                data_start, data_end, total_kwh, len(records),
                filename, json.dumps(provenance),
            ),
        )

        # Bulk-insert records in chunks
        CHUNK = 500
        for i in range(0, len(records), CHUNK):
            chunk = records[i : i + CHUNK]
            await db.executemany(
                "INSERT INTO consumption_records (consumption_id, timestamp, kwh, quality, fill_method) VALUES (?,?,?,?,?)",
                [
                    (
                        consumption_id,
                        r["timestamp"],
                        r.get("kwh"),
                        r.get("quality", "actual"),
                        r.get("fill_method"),
                    )
                    for r in chunk
                ],
            )

        await db.commit()

    return {
        "id":           consumption_id,
        "fuel_type":    fuel_type,
        "record_count": len(records),
        "total_kwh":    round(total_kwh, 1),
        "data_start":   data_start,
        "data_end":     data_end,
        "interval_minutes": interval,
        "provenance":   provenance,
        "source_filename": filename,
    }


# ── Manual entry ─────────────────────────────────────────────────────────────

class ManualFuelEntry(BaseModel):
    type: str           # 'electricity' | 'gas' | 'oil' | 'lpg' | 'biomass' | 'district_heating'
    kwh: float
    source: str = "invoice"  # invoice | estimate | dec | utility_bill | sub_metered


class ManualConsumptionRequest(BaseModel):
    year: int
    fuels: list[ManualFuelEntry]
    gia_m2: float = 0.0


@router.post("/manual")
async def manual_consumption(project_id: str, body: ManualConsumptionRequest):
    """
    Record annual consumption totals by fuel type without uploading a file.

    Creates one consumption_data row per fuel. Existing manual entries for the
    same year + fuel type are replaced (deleted then re-inserted).
    """
    await _require_project(project_id)

    if not body.fuels:
        raise HTTPException(status_code=422, detail="At least one fuel entry is required")

    year       = body.year
    data_start = f"{year}-01-01"
    data_end   = f"{year}-12-31"
    created    = []

    async with get_db() as db:
        for fuel in body.fuels:
            fuel_type = fuel.type.lower().replace(" ", "_").replace("-", "_")

            # Delete any existing manual entry for this project/year/fuel
            await db.execute(
                """
                DELETE FROM consumption_data
                WHERE project_id = ? AND fuel_type = ?
                  AND data_start = ? AND source_filename LIKE 'manual:%'
                """,
                (project_id, fuel_type, data_start),
            )

            consumption_id = str(uuid.uuid4())
            provenance = {
                "source":    "manual",
                "data_source": fuel.source,
                "year":      year,
                "gia_m2":    body.gia_m2,
            }

            await db.execute(
                """
                INSERT INTO consumption_data
                    (id, project_id, fuel_type, interval_minutes, data_start, data_end,
                     total_kwh, record_count, source_filename, provenance_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    consumption_id, project_id, fuel_type,
                    0,              # 0 = annual total, no interval records
                    data_start, data_end,
                    round(fuel.kwh, 1), 1,
                    f"manual:{fuel.source}:{year}",
                    json.dumps(provenance),
                ),
            )
            created.append({
                "id":           consumption_id,
                "fuel_type":    fuel_type,
                "total_kwh":    round(fuel.kwh, 1),
                "data_start":   data_start,
                "data_end":     data_end,
                "source":       fuel.source,
            })

        await db.commit()

    return {"created": created, "year": year}


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_consumption(project_id: str):
    """List all consumption datasets for a project."""
    await _require_project(project_id)
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM consumption_data WHERE project_id = ? ORDER BY imported_at DESC",
            (project_id,),
        )
        rows = await cursor.fetchall()
    return {"datasets": [dict(r) for r in rows]}


# ── Records ───────────────────────────────────────────────────────────────────

@router.get("/{consumption_id}/records")
async def get_records(
    project_id: str,
    consumption_id: str,
    start_date: str | None = Query(None),
    end_date:   str | None = Query(None),
):
    """Return raw records with optional date range filter."""
    dataset = await _require_consumption(project_id, consumption_id)

    conditions = ["consumption_id = ?"]
    params: list = [consumption_id]
    if start_date:
        conditions.append("timestamp >= ?")
        params.append(start_date)
    if end_date:
        conditions.append("timestamp <= ?")
        params.append(end_date + "T23:59:59")

    async with get_db() as db:
        cursor = await db.execute(
            f"SELECT timestamp, kwh, quality, fill_method FROM consumption_records WHERE {' AND '.join(conditions)} ORDER BY timestamp",
            params,
        )
        rows = await cursor.fetchall()

    records = [dict(r) for r in rows]
    total = sum(r["kwh"] for r in records if r["kwh"])
    return {
        "records": records,
        "summary": {
            "total_kwh": round(total, 1),
            "record_count": len(records),
            "avg_daily_kwh": round(total / max(1, len(records) / (48 if dataset["interval_minutes"] == 30 else 24)), 1),
        },
    }


# ── Monthly aggregates ────────────────────────────────────────────────────────

@router.get("/{consumption_id}/monthly")
async def get_monthly(project_id: str, consumption_id: str):
    """Return monthly aggregated kWh totals."""
    await _require_consumption(project_id, consumption_id)

    async with get_db() as db:
        cursor = await db.execute(
            """
            SELECT substr(timestamp, 1, 7) AS month,
                   SUM(kwh) AS kwh,
                   COUNT(*) AS record_count
            FROM consumption_records
            WHERE consumption_id = ?
            GROUP BY month
            ORDER BY month
            """,
            (consumption_id,),
        )
        rows = await cursor.fetchall()

    return {
        "monthly": [
            {"month": r["month"], "kwh": round(r["kwh"] or 0, 1), "record_count": r["record_count"]}
            for r in rows
        ]
    }


# ── Daily aggregates ──────────────────────────────────────────────────────────

@router.get("/{consumption_id}/daily")
async def get_daily(project_id: str, consumption_id: str):
    """Return daily aggregated kWh totals."""
    await _require_consumption(project_id, consumption_id)

    async with get_db() as db:
        cursor = await db.execute(
            """
            SELECT substr(timestamp, 1, 10) AS day,
                   SUM(kwh) AS kwh
            FROM consumption_records
            WHERE consumption_id = ?
            GROUP BY day
            ORDER BY day
            """,
            (consumption_id,),
        )
        rows = await cursor.fetchall()

    return {
        "daily": [
            {"day": r["day"], "kwh": round(r["kwh"] or 0, 2)}
            for r in rows
        ]
    }


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{consumption_id}")
async def delete_consumption(project_id: str, consumption_id: str):
    """Delete a consumption dataset and all its records (CASCADE)."""
    await _require_consumption(project_id, consumption_id)
    async with get_db() as db:
        await db.execute(
            "DELETE FROM consumption_data WHERE id = ? AND project_id = ?",
            (consumption_id, project_id),
        )
        await db.commit()
    return {"ok": True}
