"""Brief 95 P6 — EnergyPlus batch backend routes.

Architecture (Chris 2026-07-07): the backend NEVER imports the runner. It invokes the P5
runner (validation/energyplus/ep_batch_runner.py) as a SUBPROCESS using the harness venv's
python, and reads status/results from the `ep_runs` table (data/ep_runs.db). The subprocess
is detached (non-blocking) — a running batch never hangs an API request; progress polling is
a plain DB read.
"""
import json
import os
import sqlite3
import subprocess
import uuid
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/ep", tags=["ep-backend"])

REPO = Path(__file__).resolve().parents[2]
VENV_PY = REPO / "validation" / ".venv" / "bin" / "python"
RUNNER = REPO / "validation" / "energyplus" / "ep_batch_runner.py"
EP_RUNS_DB = REPO / "data" / "ep_runs.db"


class BatchRequest(BaseModel):
    selection: dict   # {"cumulative": bool, "isolated": [library_ids]}


def _rows(where_sql, params):
    if not EP_RUNS_DB.exists():
        return []
    con = sqlite3.connect(EP_RUNS_DB, timeout=5)
    try:
        rows = con.execute(
            "SELECT config_hash, descriptor, status, results_json, error_tail FROM ep_runs "
            + where_sql, params).fetchall()
    except sqlite3.OperationalError:
        return []
    finally:
        con.close()
    return [{"config_hash": r[0], "descriptor": r[1], "status": r[2],
             "results": json.loads(r[3]) if r[3] else None, "error_tail": r[4]} for r in rows]


@router.post("/batch/start")
def start_batch(req: BatchRequest):
    """Launch the runner as a detached subprocess (harness venv). Returns a batch_id to poll.
    Non-blocking: the request returns immediately; the runner writes ep_runs as it works."""
    if not VENV_PY.exists():
        return {"error": f"harness venv not found at {VENV_PY}", "batch_id": None}
    batch_id = "batch_" + uuid.uuid4().hex[:12]
    env = {**os.environ}
    env.setdefault("ENERGYPLUS_DIR", os.environ.get("ENERGYPLUS_DIR", "/Applications/EnergyPlus-25-2-0"))
    subprocess.Popen(
        [str(VENV_PY), str(RUNNER), "--selection", json.dumps(req.selection), "--batch-id", batch_id],
        cwd=str(REPO), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
        start_new_session=True)   # detached — never blocks the API
    return {"batch_id": batch_id}


@router.get("/batch/{batch_id}")
def batch_progress(batch_id: str):
    """Per-state status for a batch — a plain read of the ep_runs table (interface)."""
    return {"batch_id": batch_id, "states": _rows("WHERE provenance=? ORDER BY started", (batch_id,))}


@router.get("/result/{config_hash}")
def result(config_hash: str):
    rows = _rows("WHERE config_hash=?", (config_hash,))
    return rows[0] if rows else {"status": "queued", "results": None}
