"""
scripts/migrate_add_simulation_mode.py

Brief 28 prereq Option C+ Step 2 — add `simulation_mode` column to
the `simulation_runs` table.

Idempotent. Safe to re-run.

  - If the column already exists, no-op (exit 0)
  - If the column is missing, runs `ALTER TABLE simulation_runs
    ADD COLUMN simulation_mode TEXT`
  - Existing rows are left with NULL (treated as legacy / untagged)

Usage:
  python scripts/migrate_add_simulation_mode.py
"""
from __future__ import annotations
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DB_PATH   = REPO_ROOT / "data/nza_sim.db"


def main() -> int:
    if not DB_PATH.exists():
        print(f"ERROR: DB not found at {DB_PATH}")
        return 1

    con = sqlite3.connect(DB_PATH)
    try:
        # Check whether the column already exists
        cols = [r[1] for r in con.execute("PRAGMA table_info(simulation_runs)").fetchall()]
        if "simulation_mode" in cols:
            print(f"simulation_mode column already present on simulation_runs — no-op")
            return 0

        print(f"Adding simulation_mode column to simulation_runs...")
        con.execute("ALTER TABLE simulation_runs ADD COLUMN simulation_mode TEXT")
        con.commit()

        # Verify
        cols_after = [r[1] for r in con.execute("PRAGMA table_info(simulation_runs)").fetchall()]
        if "simulation_mode" not in cols_after:
            print(f"FAILED: column not present after ALTER TABLE")
            return 1

        # Report distribution
        n_total = con.execute("SELECT COUNT(*) FROM simulation_runs").fetchone()[0]
        n_null  = con.execute("SELECT COUNT(*) FROM simulation_runs WHERE simulation_mode IS NULL").fetchone()[0]
        print(f"OK. {n_total} rows in simulation_runs, {n_null} now have simulation_mode = NULL (legacy)")
        return 0
    finally:
        con.close()


if __name__ == "__main__":
    sys.exit(main())
