"""
Brief 33 Part 2 — Bridgewater migration: set opening geometry / resistance
fields on the existing permanent vents so the per-opening C_d derivation
(via computeCd in openingCoefficients.js) produces a realistic value.

Why this script exists
----------------------
Brief 32 Part 2 added `flow_mode` to the openings schema. Brief 33 Part 1
reverted the `balanced_mechanical` scope error and migrated Bridgewater to
`single_sided`. Brief 33 Part 2 adds the geometry-aware C_d work: per
facade with louvres, the engine now reads:

    type:                'orifice' | 'slot' | 'louvre' | 'trickle_vent' | 'fixed_grille'
    internal_resistance: array of 'mesh' | 'flap' | 'acoustic_baffle'
    width_mm, height_mm: required for slot / trickle_vent so aspect ratio
                         can be computed for the CIBSE Guide A Table 4.20
                         interpolation.

Bridgewater's permanent vents are trickle vents above each guest-room
window: 15 × 1300 mm slot with mesh and a flap. This script writes those
fields onto the N and S facades (the two facades that actually have a
non-zero louvre area on Bridgewater per the audit baseline 2026-05-17).

Expected derived C_d (verifiable via computeCd):
    Aspect ratio:  1300 / 15 ≈ 87
    Base C_d (slot, AR 87 interpolated between AR-50 0.42 and AR-100 0.38):
                    ≈ 0.39
    Multipliers:    × 0.85 (mesh) × 0.70 (flap) ≈ 0.595
    Final C_d:      ≈ 0.23

Usage
-----
    python scripts/33_bridgewater_opening_geometry_migration.py

Idempotent: a second run reports `NO-OP`. Requires backend on port 8002.

Project target
--------------
"HIX Bridgewater" by name; the facades with non-zero louvre area
(N=1.0 m², S=0.76 m² at audit baseline) get the trickle-vent fields.
Facades with zero area are left at the schema defaults.
"""

import json
import sys
import urllib.error
import urllib.request

API_BASE = "http://127.0.0.1:8002/api"
PROJECT_NAME = "HIX Bridgewater"

TRICKLE_VENT_PATCH = {
    "type":                "trickle_vent",
    "internal_resistance": ["mesh", "flap"],
    "width_mm":            15,
    "height_mm":           1300,
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


def _matches_patch(face_dict: dict) -> bool:
    return all(face_dict.get(k) == v for k, v in TRICKLE_VENT_PATCH.items())


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

    faces_with_louvres = [
        f for f in ("north", "south", "east", "west")
        if (current_openings.get(f) or {}).get("louvre_area_m2", 0) > 0
    ]
    if not faces_with_louvres:
        print(f"NO-OP: {PROJECT_NAME} has no facades with louvre_area_m2 > 0")
        return 0

    # Idempotency check — already applied?
    if all(_matches_patch(current_openings.get(f) or {}) for f in faces_with_louvres):
        print(f"NO-OP: {PROJECT_NAME} trickle-vent geometry already set on "
              f"{faces_with_louvres}")
        return 0

    # Build merged openings: per-facade deep-merge with the patch only
    # applied to facades that actually have louvres.
    merged_openings = dict(current_openings)
    for face in faces_with_louvres:
        before = current_openings.get(face) or {}
        merged_openings[face] = {**before, **TRICKLE_VENT_PATCH}

    http_put(f"{API_BASE}/projects/{project_id}/building", {"openings": merged_openings})

    refreshed = http_get(f"{API_BASE}/projects/{project_id}")
    after_openings = (refreshed.get("building_config") or {}).get("openings") or {}

    print(f"OK: {PROJECT_NAME} ({project_id}) updated")
    for face in faces_with_louvres:
        a = after_openings.get(face) or {}
        print(f"  {face}: area={a.get('louvre_area_m2')} m², "
              f"type={a.get('type')!r}, resistance={a.get('internal_resistance')}, "
              f"{a.get('width_mm')}×{a.get('height_mm')} mm")
    print("  expected derived C_d ~ 0.23 (slot AR ~87, x 0.85 mesh, x 0.70 flap)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
