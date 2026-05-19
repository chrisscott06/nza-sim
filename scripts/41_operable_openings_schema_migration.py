"""
Brief 41 Part 3 — Operable-openings schema migration.

Removes the dropped per-opening physics fields from persisted state:

  - discharge_coefficient   (now driven by building-wide openings.cd)
  - wind_coefficient        (now driven by building-wide openings.site_exposure → Cw)

Retained:

  - area_m2, height_m, facade, parent_glazing_face, opening_type,
    name, id, control, _synthesised_from_legacy, ...

Why
---
Brief 41 Part 1 unified the operable-opening flow correlation with the
permanent-vent correlation (Brief 33/34's flow_mode dispatch). The
per-opening discharge_coefficient + wind_coefficient fields are no
longer read by the engine — they were silently ignored from Part 1
forward. This script removes them from the DB for cleanliness so
future readers (UI editors, audit scripts, exports) don't trip over
zombie fields.

height_m is required for the temperature-mode stack term and stays.

Per CLAUDE.md Process Rule 11 — STOP the dev server before running this
script. The frontend's autosave can race the migration: a partially-
migrated opening re-saved through the running editor would re-introduce
the removed fields.

Usage
-----
    # 1. Stop the dev server (Ctrl+C in the frontend terminal).
    # 2. Run:
    python scripts/41_operable_openings_schema_migration.py
    # 3. Confirm output. Re-run for NO-OP check.
    # 4. Restart the dev server.

Requires the backend running on port 8002.
"""

import json
import sys
import urllib.error
import urllib.request

API_BASE = "http://127.0.0.1:8002/api"

DROPPED_FIELDS = ("discharge_coefficient", "wind_coefficient")


def http_get(url):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def http_put(url, body):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="PUT",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def _strip_dropped(entry):
    """Return a copy of the opening with the Brief 41-dropped fields removed.
    Returns (stripped_entry, n_fields_removed)."""
    if not isinstance(entry, dict):
        return entry, 0
    out = dict(entry)
    n = 0
    for k in DROPPED_FIELDS:
        if k in out:
            out.pop(k)
            n += 1
    return out, n


def _migrate_project(project):
    name = project.get("name") or project.get("id")
    project_id = project["id"]
    full = http_get(f"{API_BASE}/projects/{project_id}")
    bc = full.get("building_config") or {}
    openings = bc.get("operable_openings") or []
    if not isinstance(openings, list) or len(openings) == 0:
        print(f"NO-OP: {name!r} has no operable_openings")
        return False

    migrated = []
    total_removed = 0
    n_touched = 0
    for o in openings:
        stripped, n = _strip_dropped(o)
        if n > 0:
            n_touched += 1
            total_removed += n
        migrated.append(stripped)

    if total_removed == 0:
        print(f"NO-OP: {name!r} has {len(openings)} operable openings; none carry dropped fields")
        return False

    http_put(f"{API_BASE}/projects/{project_id}/building", {"operable_openings": migrated})
    print(f"OK: {name!r} - {n_touched}/{len(openings)} openings cleaned ({total_removed} fields removed)")
    for o in migrated:
        if isinstance(o, dict):
            print(f"    - {o.get('id') or o.get('name'):<40s} area={o.get('area_m2'):<6s} height={o.get('height_m')}m"
                  if isinstance(o.get('area_m2'), (int, float)) and isinstance(o.get('height_m'), (int, float))
                  else f"    - {(o.get('id') or o.get('name', '?'))!r}")
    return True


def main():
    try:
        projects = http_get(f"{API_BASE}/projects")
    except urllib.error.URLError as e:
        print(f"ERROR: cannot reach backend at {API_BASE} - is go.bat running? ({e})")
        return 2

    any_changed = False
    for p in projects:
        try:
            if _migrate_project(p):
                any_changed = True
        except Exception as e:
            print(f"ERROR migrating {p.get('name')}: {e}")
            return 3

    if not any_changed:
        print("All projects already migrated; nothing to do.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
