"""
Brief 32 Part 2 — Bridgewater migration: set permanent-vent topology to
`balanced_mechanical`.

Why this script exists
----------------------
Brief 32 Part 2 lands the flow-mode dispatch in `instantCalc.js`. The schema
default for new projects is `'cross'` (preserves legacy behaviour). Existing
projects keep whatever value is persisted on their DB row — which means
Bridgewater would still report Case A (120.8 MWh) until its row is updated.

Per `docs/audit/29_permanent_vent_methodology.md`, Bridgewater is a cellular
hotel with continuous bathroom extract. The correct topology is Case C
(balanced mechanical). This script writes that classification onto the
persisted Bridgewater project so the Static engine renders the new physics
on next load.

Reference numbers (audit baseline 2026-05-17)
----------------------------------------------
- num_bedrooms: 134
- mech_extract_lps_per_room: 8 (CIBSE Guide A Table 1.5 / Approved Doc F)
- Total Q: 134 × 8 / 1000 = 1.072 m³/s
- Expected post-fix permanent-vent loss: ~24 MWh (Case C lower bound) per
  methodology doc, range 24–85 MWh defensible.

Usage
-----
    python scripts/32_bridgewater_balanced_mech_migration.py

The script is idempotent: running it twice does not change behaviour. It
GETs the current openings block, merges in the new fields, and PUTs the
merged dict back. Requires the backend to be running on port 8002 (the
go.bat default).

Project target
--------------
Bridgewater is identified by name ("HIX Bridgewater") rather than by ID,
so the script also works on a freshly seeded DB. If multiple projects
match the name, the first match is used.
"""

import json
import sys
import urllib.error
import urllib.request

API_BASE = "http://127.0.0.1:8002/api"
PROJECT_NAME = "HIX Bridgewater"

OPENINGS_PATCH = {
    "flow_mode": "balanced_mechanical",
    "mech_extract_lps_per_room": 8,
}


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

    # Merge: preserve existing per-facade louvre data, schedule, site_exposure;
    # add / overwrite flow_mode + mech_extract_lps_per_room.
    merged_openings = {**current_openings, **OPENINGS_PATCH}

    before_flow_mode = current_openings.get("flow_mode")
    before_extract = current_openings.get("mech_extract_lps_per_room")

    if (before_flow_mode == OPENINGS_PATCH["flow_mode"]
            and before_extract == OPENINGS_PATCH["mech_extract_lps_per_room"]):
        print(f"NO-OP: {PROJECT_NAME} already has flow_mode={before_flow_mode!r}, "
              f"mech_extract_lps_per_room={before_extract!r}")
        return 0

    body = {"openings": merged_openings}
    http_put(f"{API_BASE}/projects/{project_id}/building", body)

    refreshed = http_get(f"{API_BASE}/projects/{project_id}")
    after_openings = (refreshed.get("building_config") or {}).get("openings") or {}

    print(f"OK: {PROJECT_NAME} ({project_id}) updated")
    print(f"  flow_mode:                  {before_flow_mode!r} -> {after_openings.get('flow_mode')!r}")
    print(f"  mech_extract_lps_per_room:  {before_extract!r} -> {after_openings.get('mech_extract_lps_per_room')!r}")
    print(f"  louvre areas preserved:     "
          f"N={after_openings.get('north', {}).get('louvre_area_m2')}, "
          f"S={after_openings.get('south', {}).get('louvre_area_m2')}, "
          f"E={after_openings.get('east', {}).get('louvre_area_m2')}, "
          f"W={after_openings.get('west', {}).get('louvre_area_m2')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
