#!/usr/bin/env python3
"""Brief 95 P1 — seed the "ZZ TEST — do not use" project from the frozen fixture.

Idempotent: deletes any existing ZZ TEST project (by name AND by our fixed id), then
inserts exactly one fresh copy built from validation/fixtures/bridgewater_anchor_v2.yaml.
Re-running is a clean recreate — there is always exactly one ZZ TEST project afterwards.

UI verification for Brief 95 uses ZZ TEST ONLY — never Chris's real projects (fixture rule).

Reads the fixture with PyYAML and writes directly to the local SQLite DB (data/nza_sim.db).
STOP THE DEV SERVER before running (CLAUDE.md rule 11 — autosave races a manual DB write);
back up the DB first (data-safety rules).

Note (implementer's-choice deviation, documented in docs/audit/95_ep_backend.md §2): the brief
names this seed_test_project.mjs, but node here has neither a YAML parser nor a SQLite driver
(no repo node project), while Python has both (stdlib sqlite3 + the harness venv's pyyaml).

Run: validation/.venv/bin/python scripts/seed_test_project.py
"""
import json
import sqlite3
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
DB = REPO / "data" / "nza_sim.db"
FIXTURE = REPO / "validation" / "fixtures" / "bridgewater_anchor_v2.yaml"
ZZ_NAME = "ZZ TEST — do not use"
ZZ_ID = "zztest00-0000-0000-0000-000000000000"   # fixed id → re-runs replace the same row


def main():
    if not FIXTURE.exists():
        sys.exit(f"[seed] fixture not found: {FIXTURE}")
    if not DB.exists():
        sys.exit(f"[seed] DB not found: {DB} (start the backend once to create it, then re-run)")

    fx = yaml.safe_load(FIXTURE.read_text())
    bc = fx["building_config"]
    cc = fx["construction_choices"]
    cb = fx.get("comfort_band", {}) or {}
    weather = fx.get("weather_file") or bc.get("weather_file")
    # The modern engine reads building_config.systems_config_v40; the legacy top-level
    # systems_config column is NOT NULL, so mirror the fixture's v25 block (or {}).
    systems_config = bc.get("systems_config_v25") or {}
    schedule_assignments = bc.get("schedule_assignments") or {}
    metadata = {
        "seed": "Brief 95 P1 — ZZ TEST",
        "source_fixture": "validation/fixtures/bridgewater_anchor_v2.yaml",
        "warning": "EP-backend test project. Do not use for real work.",
    }

    db = sqlite3.connect(DB)
    try:
        # Idempotent clean recreate.
        db.execute("DELETE FROM projects WHERE name = ? OR id = ?", (ZZ_NAME, ZZ_ID))
        db.execute(
            """INSERT INTO projects
               (id, name, description, building_config, systems_config, construction_choices,
                schedule_assignments, weather_file, metadata,
                comfort_band_lower_c, comfort_band_upper_c)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (
                ZZ_ID, ZZ_NAME,
                "Brief 95 EP-backend test project (frozen fixture, EUI 132.6). Do not use for real work.",
                json.dumps(bc), json.dumps(systems_config), json.dumps(cc),
                json.dumps(schedule_assignments), weather, json.dumps(metadata),
                float(cb.get("lower_c", 20)), float(cb.get("upper_c", 26)),
            ),
        )
        db.commit()
        n = db.execute("SELECT COUNT(*) FROM projects WHERE name = ?", (ZZ_NAME,)).fetchone()[0]
        print(f"[seed] '{ZZ_NAME}' -> id {ZZ_ID}")
        print(f"[seed] ZZ TEST projects now in DB: {n}")
        if n != 1:
            sys.exit(f"[seed] FAIL: expected exactly 1 ZZ TEST project, found {n}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
