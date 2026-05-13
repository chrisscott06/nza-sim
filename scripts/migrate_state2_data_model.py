"""
scripts/migrate_state2_data_model.py

Brief 27 Part 1 — backend migration to the v2.3 data model.

Adds `building_config.occupancy.*` and `building_config.gains.*` blocks
to every persisted project. Preserves any explicit user values. Idempotent
— running twice doesn't double-apply.

The frontend ProjectContext does the equivalent migration on load (so the
UI always sees the v2.3 shape regardless of what's on disk), but this
script eagerly migrates the DB so the backend's `building_config` mirrors
the contract shape directly. State 2 EP simulation (Brief 27 Part 3) and
the state isolation regression (Part 8) both depend on the persisted
config matching v2.3 exactly.

The legacy fields (`num_bedrooms`, `occupancy_rate`, `people_per_room`)
are kept in place — `nza_engine/generators/hvac_dhw.py` still reads them.
Brief 28+ (State 3 systems) will be the natural place to retire them.

Usage:
  python scripts/migrate_state2_data_model.py [--dry-run]

Always backs up the DB to data/nza_sim.db.bak.{timestamp} before writing.
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


# Default preset values mirror frontend/src/data/schedulePresets.js — the
# hotel-bedroom occupancy / lighting / equipment patterns. The frontend
# applies them via the imported preset; here we inline them so the script
# has no JS-side dependency.

HOTEL_OCC_WEEKDAY  = [0.9,0.9,0.9,0.9,0.9,0.9,0.7,0.4,0.3,0.2,0.2,0.2,0.2,0.2,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0.9,0.9]
HOTEL_OCC_SATURDAY = [0.9,0.9,0.9,0.9,0.9,0.9,0.8,0.5,0.4,0.3,0.3,0.3,0.3,0.3,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0.9,0.9,0.9]
HOTEL_OCC_SUNDAY   = [0.9,0.9,0.9,0.9,0.9,0.9,0.8,0.6,0.5,0.4,0.4,0.4,0.4,0.4,0.4,0.5,0.5,0.6,0.7,0.8,0.9,0.9,0.9,0.9]
UK_TOURISM_MONTHS  = [0.7,0.7,0.8,0.9,1.0,1.0,1.0,1.0,1.0,0.9,0.8,0.7]

HOTEL_LIGHT_WEEKDAY  = [0.05,0.05,0.05,0.05,0.05,0.05,0.4,0.7,0.2,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.2,0.5,0.8,0.8,0.6,0.2,0.05]
HOTEL_LIGHT_SATURDAY = [0.05,0.05,0.05,0.05,0.05,0.05,0.2,0.6,0.4,0.2,0.1,0.1,0.1,0.1,0.1,0.1,0.2,0.3,0.5,0.8,0.8,0.6,0.2,0.05]
HOTEL_LIGHT_SUNDAY   = [0.05,0.05,0.05,0.05,0.05,0.05,0.2,0.5,0.5,0.3,0.2,0.1,0.1,0.1,0.1,0.1,0.2,0.3,0.5,0.8,0.7,0.5,0.2,0.05]
HOTEL_LIGHT_MONTHS   = [1.0,1.0,0.9,0.8,0.7,0.7,0.7,0.7,0.8,0.9,1.0,1.0]

HOTEL_EQUIP_WEEKDAY  = [0.1,0.1,0.1,0.1,0.1,0.1,0.3,0.6,0.1,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.1,0.3,0.6,0.7,0.6,0.4,0.2,0.1]
HOTEL_EQUIP_SATURDAY = [0.1,0.1,0.1,0.1,0.1,0.1,0.2,0.5,0.3,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.2,0.4,0.6,0.7,0.6,0.4,0.2,0.1]
HOTEL_EQUIP_SUNDAY   = [0.1,0.1,0.1,0.1,0.1,0.1,0.2,0.4,0.4,0.2,0.1,0.1,0.1,0.1,0.1,0.1,0.2,0.3,0.5,0.6,0.5,0.3,0.2,0.1]
FLAT_MONTHS          = [1,1,1,1,1,1,1,1,1,1,1,1]


def default_occupancy(legacy: dict) -> dict:
    """Build a v2.3 occupancy block from legacy fields where possible."""
    return {
        "occupancy_rate": float(legacy.get("occupancy_rate") or 0.75),
        "density": {
            "value": float(legacy.get("people_per_room") or 1.5),
            "basis": "per_room" if legacy.get("people_per_room") is not None else "per_room",
        },
        "sensible_w_per_person": 75,
        "latent_w_per_person":   55,
        "schedule": {
            "weekday":             list(HOTEL_OCC_WEEKDAY),
            "saturday":            list(HOTEL_OCC_SATURDAY),
            "sunday":              list(HOTEL_OCC_SUNDAY),
            "monthly_multipliers": list(UK_TOURISM_MONTHS),
            "exceptions":          [],
        },
        "_provenance": {"source": "migrated_from_legacy", "confidence": "medium"},
    }


def default_gains() -> dict:
    return {
        "lighting": {
            "magnitude": {"value": 8, "unit": "w_per_m2"},
            "relationship_to_occupancy": "proportional_with_spill",
            "spill_minutes":   15,
            "daylight_factor": 0.6,
            "schedule": {
                "weekday":             list(HOTEL_LIGHT_WEEKDAY),
                "saturday":            list(HOTEL_LIGHT_SATURDAY),
                "sunday":              list(HOTEL_LIGHT_SUNDAY),
                "monthly_multipliers": list(HOTEL_LIGHT_MONTHS),
                "exceptions":          [],
            },
            "_provenance": {"source": "migrated_from_legacy", "confidence": "low"},
        },
        "equipment": {
            "baseload": {"value": 3, "unit": "w_per_m2"},
            "active":   {"value": 7, "unit": "w_per_m2"},
            "relationship_to_occupancy": "proportional",
            "standby_factor": 0.10,
            "schedule": {
                "weekday":             list(HOTEL_EQUIP_WEEKDAY),
                "saturday":            list(HOTEL_EQUIP_SATURDAY),
                "sunday":              list(HOTEL_EQUIP_SUNDAY),
                "monthly_multipliers": list(FLAT_MONTHS),
                "exceptions":          [],
            },
            "_provenance": {"source": "migrated_from_legacy", "confidence": "low"},
        },
    }


def migrate_one(bc: dict) -> tuple[dict, list[str]]:
    """Return (new_bc, list_of_changes_applied)."""
    bc = dict(bc)  # shallow copy
    changes: list[str] = []

    # ── Occupancy ───────────────────────────────────────────────────────────
    if not isinstance(bc.get("occupancy"), dict) or not (bc.get("occupancy") or {}).get("density"):
        bc["occupancy"] = default_occupancy(bc)
        changes.append("added occupancy")
    else:
        # Already has occupancy.density — preserve verbatim, just backfill
        # any missing keys from defaults.
        occ = dict(bc["occupancy"])
        defaults = default_occupancy(bc)
        for k, v in defaults.items():
            if k not in occ:
                occ[k] = v
                changes.append(f"backfilled occupancy.{k}")
            elif k == "schedule" and isinstance(occ.get("schedule"), dict):
                sched = dict(occ["schedule"])
                for sk, sv in defaults["schedule"].items():
                    if sk not in sched:
                        sched[sk] = sv
                        changes.append(f"backfilled occupancy.schedule.{sk}")
                occ["schedule"] = sched
            elif k == "density" and isinstance(occ.get("density"), dict):
                dens = dict(occ["density"])
                for dk, dv in defaults["density"].items():
                    if dk not in dens:
                        dens[dk] = dv
                        changes.append(f"backfilled occupancy.density.{dk}")
                occ["density"] = dens
        bc["occupancy"] = occ

    # ── Gains ───────────────────────────────────────────────────────────────
    if not isinstance(bc.get("gains"), dict) or not (bc.get("gains") or {}).get("lighting"):
        bc["gains"] = default_gains()
        changes.append("added gains")
    else:
        gains = dict(bc["gains"])
        defaults = default_gains()
        for category in ("lighting", "equipment"):
            if category not in gains or not isinstance(gains[category], dict):
                gains[category] = defaults[category]
                changes.append(f"added gains.{category}")
            else:
                merged = dict(gains[category])
                for k, v in defaults[category].items():
                    if k not in merged:
                        merged[k] = v
                        changes.append(f"backfilled gains.{category}.{k}")
                gains[category] = merged
        bc["gains"] = gains

    return bc, changes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="don't write changes")
    args = parser.parse_args()

    if not DB_PATH.exists():
        print(f"DB not found at {DB_PATH}", file=sys.stderr)
        sys.exit(1)

    # Back up first
    if not args.dry_run:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup = DB_PATH.with_suffix(f".db.bak.{ts}")
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
            print(f"  - {row['name']} ({row['id'][:8]}): already v2.3, no changes")
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
        print(f"Database updated. Backup at {DB_PATH.with_suffix('.db.bak.*')}")


if __name__ == "__main__":
    main()
