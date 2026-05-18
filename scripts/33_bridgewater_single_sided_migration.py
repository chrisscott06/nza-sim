"""
Brief 33 Part 1 — Bridgewater migration: set permanent-vent topology to
`single_sided` and remove the obsolete `mech_extract_lps_per_room` field.

Why this script exists
----------------------
Brief 32 Part 2 added a `balanced_mechanical` flow_mode that imported a
mechanical-systems concept (continuous bathroom extract) into the Building
module's permanent-vent calculation. Brief 33 reverts that: the Building
module is envelope-only, and permanent vents are passive wind-driven
openings. See CLAUDE.md "Module scopes" (added in Brief 33 Part 3) and
Brief 33 §"Scope statement".

Bridgewater's correct envelope topology — independent of any mechanical
system it happens to have — is **single-sided**: each guest room has a
trickle vent on one façade, the corridor wall is closed, there is no
cross-flow path inside a room. The BS EN 16798-7 §6.4 single-sided
empirical correlation is the right envelope-level physics.

This script writes that classification onto the persisted Bridgewater
project and strips the now-invalid `mech_extract_lps_per_room` field if
present.

Usage
-----
    python scripts/33_bridgewater_single_sided_migration.py

Idempotent: a second run reports `NO-OP`. Requires the backend running on
port 8002 (the go.bat default).

Project target
--------------
"HIX Bridgewater" by name (works on a freshly seeded DB).
"""

import json
import sys
import urllib.error
import urllib.request

API_BASE = "http://127.0.0.1:8002/api"
PROJECT_NAME = "HIX Bridgewater"

NEW_FLOW_MODE = "single_sided"
OBSOLETE_FIELDS = ["mech_extract_lps_per_room"]


def http_get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def http_put(url: str, body: dict) -> dict:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="PUT",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def main() -> int:
    try:
        projects = http_get(f"{API_BASE}/projects")
    except urllib.error.URLError as e:
        print(f"ERROR: cannot reach backend at {API_BASE} — is go.bat running? ({e})")
        return 2

    match = next((p for p in projects if p.get("name") == PROJECT_NAME), None)
    if not match:
        print(f"ERROR: no project named {PROJECT_NAME!r} in the DB")
        return 3

    project_id = match["id"]
    full = http_get(f"{API_BASE}/projects/{project_id}")
    bc = full.get("building_config") or {}
    current_openings = bc.get("openings") or {}

    before_flow_mode = current_openings.get("flow_mode")
    before_obsolete = {k: current_openings.get(k) for k in OBSOLETE_FIELDS}
    has_obsolete = any(v is not None for v in before_obsolete.values())

    if before_flow_mode == NEW_FLOW_MODE and not has_obsolete:
        print(f"NO-OP: {PROJECT_NAME} already on flow_mode={before_flow_mode!r}, "
              f"no obsolete fields present")
        return 0

    # Build the merged openings: set new flow_mode + strip obsolete keys,
    # keep everything else (per-facade louvre data, schedule, site_exposure).
    merged_openings = {
        k: v for k, v in current_openings.items() if k not in OBSOLETE_FIELDS
    }
    merged_openings["flow_mode"] = NEW_FLOW_MODE

    http_put(f"{API_BASE}/projects/{project_id}/building", {"openings": merged_openings})

    refreshed = http_get(f"{API_BASE}/projects/{project_id}")
    after_openings = (refreshed.get("building_config") or {}).get("openings") or {}

    print(f"OK: {PROJECT_NAME} ({project_id}) updated")
    print(f"  flow_mode:           {before_flow_mode!r} -> {after_openings.get('flow_mode')!r}")
    for k in OBSOLETE_FIELDS:
        print(f"  {k:<20s}{before_obsolete[k]!r} -> {after_openings.get(k)!r} (should be None)")
    print(f"  louvre areas preserved:  "
          f"N={after_openings.get('north', {}).get('louvre_area_m2')}, "
          f"S={after_openings.get('south', {}).get('louvre_area_m2')}, "
          f"E={after_openings.get('east', {}).get('louvre_area_m2')}, "
          f"W={after_openings.get('west', {}).get('louvre_area_m2')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
