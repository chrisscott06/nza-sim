"""
Brief 37 Part 3 — Schedule schema migration: flatten `day_types` to
top-level `weekday` / `saturday` / `sunday`.

Why this script exists
----------------------
Brief 37 unifies the schedule editor across Internal Gains, Operation,
and Systems. The two pre-existing editors used different shapes:

  - gains/ (Internal Gains):  flat — schedule.weekday[24] etc. at top level
                              + exceptions[]
  - profiles/ (Operation, Systems library): nested — schedule.day_types: {
                              weekday, saturday, sunday }, no exceptions[]

The new UnifiedScheduleEditor writes the flat shape. To remove the legacy
nested shape from persisted state, this script walks each project's
params.schedules[] array and:

  1. Detects entries with the nested `day_types` shape.
  2. Lifts day_types.{weekday,saturday,sunday} to top-level
     {weekday, saturday, sunday}.
  3. Ensures `exceptions: []` is present (default empty array; no behaviour
     change since the legacy engine never read exceptions for library
     schedules).
  4. Drops the now-redundant `day_types` field.
  5. Preserves everything else (id, name, display_name, schedule_type,
     zone_type, monthly_multipliers, _provenance, ...).

The script is idempotent: a second run reports `NO-OP` (entries already in
the flat shape are detected and skipped).

A reader-side fallback in `frontend/src/utils/scheduleLibrary.js`
`resolveScheduleAtHour` tolerates both shapes during the transition window,
so running this script asynchronously to the deploy is safe.

Per CLAUDE.md Process Rule 11 — STOP the dev server before running this
script. The frontend's autosave can race the migration: a partially-
migrated schedule re-saved through the legacy editor would re-introduce
day_types.

Usage
-----
    # 1. Stop the dev server (Ctrl+C in the frontend terminal)
    # 2. Run:
    python scripts/37_schedule_schema_migration.py
    # 3. Confirm output. Re-run for NO-OP check.
    # 4. Restart the dev server.

Requires the backend running on port 8002.
"""

import json
import sys
import urllib.error
import urllib.request

API_BASE = "http://127.0.0.1:8002/api"


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


def _is_legacy_shape(entry):
    """A schedule entry is legacy-shaped if it has `day_types` AND lacks
    the flat fields. Entries that have BOTH (mid-migration state) are
    treated as legacy and re-flattened from day_types for safety."""
    if not isinstance(entry, dict):
        return False
    has_dt = isinstance(entry.get("day_types"), dict)
    has_flat = isinstance(entry.get("weekday"), list)
    return has_dt and not has_flat


def _flatten(entry):
    dt = entry.get("day_types") or {}
    out = dict(entry)
    out["weekday"]  = dt.get("weekday")  or []
    out["saturday"] = dt.get("saturday") or out["weekday"]
    out["sunday"]   = dt.get("sunday")   or out["weekday"]
    if "exceptions" not in out or not isinstance(out.get("exceptions"), list):
        out["exceptions"] = []
    # Drop the now-redundant nested field.
    out.pop("day_types", None)
    return out


def _migrate_project(project):
    name = project.get("name") or project.get("id")
    project_id = project["id"]
    full = http_get(f"{API_BASE}/projects/{project_id}")
    bc = full.get("building_config") or {}
    schedules = bc.get("schedules") or []
    if not isinstance(schedules, list) or len(schedules) == 0:
        print(f"NO-OP: {name!r} has no project-scoped schedules")
        return False

    legacy_count = sum(1 for e in schedules if _is_legacy_shape(e))
    if legacy_count == 0:
        # Also check exceptions[] presence even on already-flat entries.
        missing_exc = sum(1 for e in schedules if isinstance(e, dict) and not isinstance(e.get("exceptions"), list))
        if missing_exc == 0:
            print(f"NO-OP: {name!r} schedules already migrated ({len(schedules)} entries)")
            return False

    migrated = []
    for e in schedules:
        if _is_legacy_shape(e):
            migrated.append(_flatten(e))
        elif isinstance(e, dict):
            if not isinstance(e.get("exceptions"), list):
                e = {**e, "exceptions": []}
            migrated.append(e)
        else:
            migrated.append(e)

    http_put(f"{API_BASE}/projects/{project_id}/building", {"schedules": migrated})
    print(f"OK: {name!r} - migrated {legacy_count}/{len(schedules)} schedule entries to flat shape")
    for e in migrated:
        if isinstance(e, dict):
            print(f"    - {e.get('id') or e.get('name'):<40s} type={e.get('schedule_type','?'):<12s} excs={len(e.get('exceptions') or [])}")
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
