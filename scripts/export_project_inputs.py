"""
scripts/export_project_inputs.py  — Brief 86 Part 6 (input persistence)

Export the COMPLETE input set for a project to a single committable JSON, so a
project can never be lost in a machine migration again (the failure this brief
exists to fix). Captures everything the engine needs to reproduce the project:
geometry, fabric, the per-project custom constructions, systems (v25 + v40),
loads, schedules, comfort band, weather.

Round-trips with scripts/import_project_inputs.py.

Usage:
    python scripts/export_project_inputs.py <project_id> [out_path]
Default out_path: projects/snapshots/<slug>.json (a tracked, committable dir).
"""
import sys, json, re, sqlite3
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DB = REPO / "data/nza_sim.db"
SNAP_DIR = REPO / "projects/snapshots"

SCHEMA = "nza-sim-project-inputs/v1"
# project columns that define engine inputs (ephemeral sim rows excluded)
PROJECT_COLS = [
    "id", "name", "description", "building_config", "systems_config",
    "construction_choices", "schedule_assignments", "weather_file", "metadata",
    "comfort_band_lower_c", "comfort_band_upper_c",
]


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (s or "project").lower()).strip("_")


def export_project(project_id: str, exported_at: str = "unset") -> dict:
    db = sqlite3.connect(DB); db.row_factory = sqlite3.Row
    try:
        row = db.execute(
            f"SELECT {', '.join(PROJECT_COLS)} FROM projects WHERE id = ?",
            (project_id,),
        ).fetchone()
        if not row:
            raise SystemExit(f"No project '{project_id}' in {DB}")
        project = {}
        for c in PROJECT_COLS:
            v = row[c]
            # JSON columns are stored as text — keep them as parsed objects
            if c in ("building_config", "systems_config", "construction_choices",
                     "schedule_assignments", "metadata") and isinstance(v, str):
                v = json.loads(v) if v else None
            project[c] = v

        # Collect the per-project custom constructions referenced by choices so
        # the snapshot is self-contained (parser U-values + frontend resolve).
        choices = project.get("construction_choices") or {}
        names = set()
        for entry in choices.values():
            if isinstance(entry, str):
                names.add(entry)
            elif isinstance(entry, dict):
                n = entry.get("library_id") or entry.get("name")
                if n:
                    names.add(n)
        constructions = []
        if names:
            q = ",".join("?" * len(names))
            for r in db.execute(
                f"SELECT name, library_type, display_name, description, config_json "
                f"FROM library_items WHERE library_type='construction' AND name IN ({q})",
                tuple(names),
            ):
                cj = r["config_json"]
                constructions.append({
                    "name": r["name"],
                    "library_type": r["library_type"],
                    "display_name": r["display_name"],
                    "description": r["description"],
                    "config_json": json.loads(cj) if isinstance(cj, str) else cj,
                })
        return {
            "schema": SCHEMA,
            "exported_at": exported_at,
            "project": project,
            "constructions": constructions,
        }
    finally:
        db.close()


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    pid = sys.argv[1]
    snap = export_project(pid)
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else (
        SNAP_DIR / f"{_slug(snap['project'].get('name'))}.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snap, indent=2, ensure_ascii=False))
    p = snap["project"]
    try:
        shown = out.resolve().relative_to(REPO)
    except ValueError:
        shown = out
    print(f"Exported '{p.get('name')}' ({pid}) → {shown}")
    print(f"  constructions: {[c['name'] for c in snap['constructions']]}")
    print(f"  building_config keys: {len(p.get('building_config') or {})}  "
          f"comfort: [{p.get('comfort_band_lower_c')}, {p.get('comfort_band_upper_c')}]")


if __name__ == "__main__":
    main()
