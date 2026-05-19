"""
Brief 42 Part 3 — Per-opening cd and flow_mode migration.

Writes the building-wide `openings.cd` and `openings.flow_mode` values
onto every facade entry (north/south/east/west) and every operable
opening, then removes the now-orphaned building-wide fields. Site
exposure (`openings.site_exposure`) stays building-wide -- it's a
property of where the building sits, not of any individual opening.

Why
---
Brief 42 Part 1 added per-opening `cd` + `flow_mode` to the schema.
Brief 42 Part 2 switched the engine to read per-opening, with a
fallback to building-wide for unmigrated entries. This script
materialises the per-opening values from the persisted building-wide
values so that:

  - the fallback chain becomes mechanically irrelevant (each opening
    declares its own physics)
  - the building-wide fields can be removed from the persisted blob,
    matching the Brief 42 Part 1 schema change to DEFAULT_PARAMS
  - subsequent user edits in Parts 4/5's per-opening UI operate on
    real per-opening fields rather than seeded defaults

Behaviour preservation
----------------------
At migration time the per-opening values are *copies* of the
building-wide values. Engine output is therefore unchanged at the
moment the script runs (Brief 42 Principle 5). Once the user starts
editing per-opening values in Parts 4/5, behaviour diverges intentionally.

If a project has no persisted `openings.cd` or `openings.flow_mode`
(e.g. a freshly-seeded project that never had the building-wide
fields), Brief 42 Part 1's DEFAULT_PARAMS values are used as the
seed: cd = 0.40 (louvre), flow_mode = 'single_sided'.

Operable openings: synthesised window-type entries from
Brief 41/Brief 42 Part 1 already carry cd 0.55 / 'single_sided' (the
window seed). Pre-Brief-42 operable entries that lack these fields
get the building-wide values written onto them (door-type and
vent-type entries don't get re-typed to window defaults -- the user
explicitly picked the type).

Idempotent
----------
Re-running is a no-op:
  - building-wide fields already removed -> nothing to copy from
  - per-facade / per-opening fields already present -> nothing to add

Stop-dev-server discipline
--------------------------
Per CLAUDE.md Process Rule 11, STOP the dev server before running.
The frontend's autosave can race the migration: a partially-migrated
opening re-saved through the running editor would re-introduce the
building-wide fields with stale values.

Usage
-----
    # 1. Stop the dev server (Ctrl+C in the frontend terminal).
    # 2. Run:
    python scripts/42_per_opening_cd_flowmode_migration.py
    # 3. Confirm output. Re-run for NO-OP check.
    # 4. Restart the dev server.

Requires the backend running on port 8002.
"""

import json
import sys
import urllib.error
import urllib.request

API_BASE = "http://127.0.0.1:8002/api"

FACADES = ("north", "south", "east", "west")
VALID_FLOW_MODES = ("single_sided", "cross")

# Brief 42 Part 1 DEFAULT_PARAMS seed values (used when a project has
# no persisted building-wide cd / flow_mode -- e.g. a freshly-created
# project that never went through the building-wide era).
DEFAULT_CD = 0.40          # louvre seed
DEFAULT_FLOW_MODE = "single_sided"


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


def _resolve_seed_cd(value):
    """Building-wide cd if numeric, else Brief 42 default."""
    if isinstance(value, (int, float)):
        return float(value)
    return DEFAULT_CD


def _resolve_seed_flow_mode(value):
    """Building-wide flow_mode if valid, else Brief 42 default."""
    if value in VALID_FLOW_MODES:
        return value
    return DEFAULT_FLOW_MODE


def _migrate_openings_block(openings, seed_cd, seed_flow_mode):
    """Return (new_openings_block, n_facade_writes, n_facade_skips, removed_building_wide).
    Idempotent: facades that already carry cd / flow_mode are left untouched."""
    if not isinstance(openings, dict):
        return openings, 0, 0, False
    out = dict(openings)
    n_writes = 0
    n_skips = 0
    for face in FACADES:
        entry = out.get(face)
        if not isinstance(entry, dict):
            # Facade missing entirely -- skip; engine reads default if face absent.
            continue
        new_entry = dict(entry)
        changed = False
        if "cd" not in new_entry:
            new_entry["cd"] = seed_cd
            changed = True
        if "flow_mode" not in new_entry:
            new_entry["flow_mode"] = seed_flow_mode
            changed = True
        if changed:
            n_writes += 1
        else:
            n_skips += 1
        out[face] = new_entry
    removed = False
    if "cd" in out:
        out.pop("cd")
        removed = True
    if "flow_mode" in out:
        out.pop("flow_mode")
        removed = True
    return out, n_writes, n_skips, removed


def _migrate_operable_openings(openings_array, seed_cd, seed_flow_mode):
    """Return (new_array, n_writes, n_skips). Idempotent."""
    if not isinstance(openings_array, list):
        return openings_array, 0, 0
    out = []
    n_writes = 0
    n_skips = 0
    for o in openings_array:
        if not isinstance(o, dict):
            out.append(o)
            continue
        new_o = dict(o)
        changed = False
        if "cd" not in new_o:
            new_o["cd"] = seed_cd
            changed = True
        if "flow_mode" not in new_o:
            new_o["flow_mode"] = seed_flow_mode
            changed = True
        if changed:
            n_writes += 1
        else:
            n_skips += 1
        out.append(new_o)
    return out, n_writes, n_skips


def _migrate_project(project):
    name = project.get("name") or project.get("id")
    project_id = project["id"]
    full = http_get(f"{API_BASE}/projects/{project_id}")
    bc = full.get("building_config") or {}
    openings = bc.get("openings")
    operable = bc.get("operable_openings")

    if openings is None and (not isinstance(operable, list) or len(operable) == 0):
        print(f"NO-OP: {name!r} has no openings block and no operable openings")
        return False

    # Resolve seed values from the persisted building-wide fields.
    bw_cd = (openings or {}).get("cd")
    bw_flow_mode = (openings or {}).get("flow_mode")
    seed_cd = _resolve_seed_cd(bw_cd)
    seed_flow_mode = _resolve_seed_flow_mode(bw_flow_mode)
    using_defaults = (
        (bw_cd is None or not isinstance(bw_cd, (int, float)))
        and (bw_flow_mode not in VALID_FLOW_MODES)
    )

    new_openings, fac_writes, fac_skips, removed_bw = (
        _migrate_openings_block(openings, seed_cd, seed_flow_mode)
        if isinstance(openings, dict) else (openings, 0, 0, False)
    )
    new_operable, op_writes, op_skips = _migrate_operable_openings(
        operable, seed_cd, seed_flow_mode
    )

    if fac_writes == 0 and op_writes == 0 and not removed_bw:
        print(
            f"NO-OP: {name!r} -- already migrated "
            f"({fac_skips} facades + {op_skips} operable openings already have cd + flow_mode)"
        )
        return False

    body = {}
    if isinstance(openings, dict):
        body["openings"] = new_openings
    if isinstance(operable, list):
        body["operable_openings"] = new_operable

    http_put(f"{API_BASE}/projects/{project_id}/building", body)

    note = " (using Brief 42 defaults -- no persisted building-wide values)" if using_defaults else ""
    print(
        f"OK: {name!r}{note}"
        f"\n    seed: cd = {seed_cd:.3f}, flow_mode = {seed_flow_mode!r}"
        f"\n    facades: {fac_writes} written, {fac_skips} already had per-facade values"
        f"\n    operable openings: {op_writes} written, {op_skips} already had per-opening values"
        f"\n    building-wide cd / flow_mode removed: {removed_bw}"
    )
    if isinstance(new_operable, list):
        for o in new_operable:
            if isinstance(o, dict):
                name_str = o.get("name") or o.get("id") or "?"
                cd_str = f"{o.get('cd'):.3f}" if isinstance(o.get("cd"), (int, float)) else "?"
                fm_str = o.get("flow_mode") or "?"
                t_str = o.get("opening_type") or "?"
                area_str = f"{o.get('area_m2')}" if o.get("area_m2") is not None else "?"
                print(f"      - {name_str!s:<35s} type={t_str:<7s} area={area_str:>5s} m2  cd={cd_str}  {fm_str}")
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
