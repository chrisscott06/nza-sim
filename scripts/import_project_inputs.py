"""
scripts/import_project_inputs.py  — Brief 86 Part 6 (input persistence)

Recreate a project from a snapshot produced by export_project_inputs.py. This is
the recovery path: a fresh install (empty DB) becomes a fully-configured project
from one committed file. Round-trips with the exporter.

Usage:
    python scripts/import_project_inputs.py <snapshot.json> [--id NEW_ID] [--name NEW_NAME]
Without --id, restores to the project's original id (overwrites in place).
"""
import sys, json, sqlite3, argparse
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DB = REPO / "data/nza_sim.db"

PROJECT_COLS = [
    "id", "name", "description", "building_config", "systems_config",
    "construction_choices", "schedule_assignments", "weather_file", "metadata",
    "comfort_band_lower_c", "comfort_band_upper_c",
]
JSON_COLS = {"building_config", "systems_config", "construction_choices",
             "schedule_assignments", "metadata"}


def import_project(snap: dict, new_id=None, new_name=None) -> str:
    if snap.get("schema", "").split("/")[0] != "nza-sim-project-inputs":
        raise SystemExit(f"Unrecognised snapshot schema: {snap.get('schema')}")
    proj = dict(snap["project"])
    if new_id:
        proj["id"] = new_id
    if new_name:
        proj["name"] = new_name
        bc = proj.get("building_config")
        if isinstance(bc, dict):
            bc["name"] = new_name

    db = sqlite3.connect(DB)
    try:
        # constructions first (project references them)
        for c in snap.get("constructions", []):
            cj = c["config_json"]
            db.execute(
                """INSERT OR REPLACE INTO library_items
                   (id, library_type, name, display_name, description, config_json,
                    is_default, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,0,
                     COALESCE((SELECT created_at FROM library_items WHERE id=?), datetime('now')),
                     datetime('now'))""",
                (f"lib_construction_{c['name']}", "construction", c["name"],
                 c.get("display_name"), c.get("description"),
                 json.dumps(cj) if not isinstance(cj, str) else cj,
                 f"lib_construction_{c['name']}"),
            )
        # project row
        vals = []
        for col in PROJECT_COLS:
            v = proj.get(col)
            if col in JSON_COLS and not isinstance(v, (str, type(None))):
                v = json.dumps(v)
            vals.append(v)
        placeholders = ",".join("?" * len(PROJECT_COLS))
        db.execute(
            f"""INSERT OR REPLACE INTO projects
                ({', '.join(PROJECT_COLS)}, created_at, updated_at)
                VALUES ({placeholders},
                  COALESCE((SELECT created_at FROM projects WHERE id=?), datetime('now')),
                  datetime('now'))""",
            (*vals, proj["id"]),
        )
        db.commit()
        return proj["id"]
    finally:
        db.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("snapshot")
    ap.add_argument("--id")
    ap.add_argument("--name")
    a = ap.parse_args()
    snap = json.loads(Path(a.snapshot).read_text())
    pid = import_project(snap, new_id=a.id, new_name=a.name)
    n = len(snap.get("constructions", []))
    print(f"Imported project '{snap['project'].get('name')}' → id {pid} "
          f"(+{n} construction(s)) into {DB.relative_to(REPO)}")


if __name__ == "__main__":
    main()
