"""
scripts/migrate_gains_v24.py

Brief 27 Revised Part 9 — backend migration to the v2.4 data model.

Converts every persisted project's `building_config.gains.lighting` and
`building_config.gains.equipment` from v2.3's single-quantity shape to
v2.4's `profiles: [...]` array shape.

The single v2.3 quantity becomes profiles[0] with `area_share: 1.0`,
preserving all magnitudes, relationship_to_occupancy, schedule, etc.
This is byte-identical-engine-output by design — the engine reads
profiles[*] × area_share, and 1.0 × single_profile = single_profile.

Idempotent — running twice doesn't double-apply.

The frontend ProjectContext (`migrateGainsV23`) does the equivalent
migration on load (so the UI always sees the v2.4 shape regardless of
what's on disk), but this script eagerly migrates the DB so the
backend's `building_config` mirrors the contract shape directly. State 2
EP simulation and state isolation regressions both work against the
persisted config.

Usage:
  python scripts/migrate_gains_v24.py [--dry-run]

Always backs up the DB to data/nza_sim.db.bak.v24.{timestamp} before writing.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = REPO_ROOT / "data/nza_sim.db"


def lighting_profile_from_v23(v23_lighting: dict) -> dict:
    """Wrap a v2.3 single-quantity lighting block as a v2.4 profile."""
    return {
        "id":    "default_lighting",
        "label": "Lighting",
        "magnitude": dict(v23_lighting.get("magnitude") or {"value": 8, "unit": "w_per_m2"}),
        "relationship_to_occupancy": v23_lighting.get("relationship_to_occupancy", "proportional_with_spill"),
        "spill_minutes":   v23_lighting.get("spill_minutes", 15),
        "daylight_factor": v23_lighting.get("daylight_factor", 0.6),
        "area_share":      1.0,
        # Schedule preserved verbatim; v2.4 exceptions stay as-is — the
        # frontend lazy-migrates exception ids/curves on load.
        "schedule": dict(v23_lighting.get("schedule") or {}),
        "_provenance": v23_lighting.get("_provenance") or {
            "source":     "migrated_v23_to_v24",
            "confidence": "medium",
        },
    }


def equipment_profile_from_v23(v23_equipment: dict) -> dict:
    """Wrap a v2.3 single-quantity equipment block as a v2.4 profile."""
    return {
        "id":    "default_equipment",
        "label": "Equipment",
        "baseload": dict(v23_equipment.get("baseload") or {"value": 3, "unit": "w_per_m2"}),
        "active":   dict(v23_equipment.get("active")   or {"value": 7, "unit": "w_per_m2"}),
        "relationship_to_occupancy": v23_equipment.get("relationship_to_occupancy", "proportional"),
        "standby_factor": v23_equipment.get("standby_factor", 0.10),
        "area_share":     1.0,
        "schedule": dict(v23_equipment.get("schedule") or {}),
        "_provenance": v23_equipment.get("_provenance") or {
            "source":     "migrated_v23_to_v24",
            "confidence": "medium",
        },
    }


def migrate_one(bc: dict) -> tuple[dict, list[str]]:
    """Return (new_bc, list_of_changes_applied)."""
    bc = dict(bc)
    changes: list[str] = []
    gains = dict(bc.get("gains") or {})

    # ── Lighting ────────────────────────────────────────────────────────────
    lighting = dict(gains.get("lighting") or {})
    if isinstance(lighting.get("profiles"), list):
        # Already v2.4 — no-op.
        pass
    else:
        # v2.3 or missing: wrap into profiles[0] with area_share 1.0.
        new_lighting = {
            "profiles": [lighting_profile_from_v23(lighting)],
        }
        gains["lighting"] = new_lighting
        changes.append("lighting -> profiles[1] (area_share=1.0)")

    # ── Equipment ───────────────────────────────────────────────────────────
    equipment = dict(gains.get("equipment") or {})
    if isinstance(equipment.get("profiles"), list):
        pass
    else:
        new_equipment = {
            "profiles": [equipment_profile_from_v23(equipment)],
        }
        gains["equipment"] = new_equipment
        changes.append("equipment -> profiles[1] (area_share=1.0)")

    if changes:
        bc["gains"] = gains
    return bc, changes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="don't write changes")
    args = parser.parse_args()

    if not DB_PATH.exists():
        print(f"DB not found at {DB_PATH}", file=sys.stderr)
        sys.exit(1)

    if not args.dry_run:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup = DB_PATH.with_suffix(f".db.bak.v24.{ts}")
        shutil.copy2(DB_PATH, backup)
        print(f"Backed up DB to {backup.name}")

    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    rows = con.execute("SELECT id, name, building_config FROM projects").fetchall()
    print(f"Found {len(rows)} project(s)")
    print()

    total_changes = 0
    for row in rows:
        try:
            bc = json.loads(row["building_config"])
        except (json.JSONDecodeError, TypeError):
            print(f"  ! {row['name']} ({row['id'][:8]}): building_config not valid JSON — skipped")
            continue

        new_bc, changes = migrate_one(bc)
        if not changes:
            print(f"  - {row['name']} ({row['id'][:8]}): already v2.4, no changes")
            continue

        total_changes += len(changes)
        print(f"  + {row['name']} ({row['id'][:8]}): {len(changes)} change(s)")
        for c in changes:
            print(f"      - {c}")

        if not args.dry_run:
            con.execute(
                "UPDATE projects SET building_config = ? WHERE id = ?",
                (json.dumps(new_bc), row["id"]),
            )

    if not args.dry_run:
        con.commit()
    con.close()

    print()
    print(f"Total: {total_changes} change(s) across {len(rows)} project(s)")
    if args.dry_run:
        print("DRY RUN — no changes written. Re-run without --dry-run to apply.")
    else:
        print(f"Database updated. Backup at {DB_PATH.with_suffix('.db.bak.v24.*')}")


if __name__ == "__main__":
    main()
