"""
Brief 34 — Migrate persisted projects from per-facade C_d geometry to a
single building-wide `openings.cd` value.

Why this script exists
----------------------
Brief 33 Part 2 added per-facade opening geometry fields (type,
internal_resistance, width_mm, height_mm) and derived C_d via
`computeCd(opening)`. Brief 34 simplifies the UI to a single building-wide
C_d slider. Persisted projects need their `openings` blocks reshaped:

  - If a project has per-facade geometry: compute the would-be C_d per
    facade (in Python, mirroring `computeCd` in openingCoefficients.js),
    take the area-weighted mean across facades with non-zero louvre area,
    and write that as `openings.cd`.
  - If a project has no per-facade geometry: set `openings.cd` to the
    schema default 0.25.
  - Either way, strip the now-defunct per-facade fields.

The script is idempotent: a second run is a no-op.

Verification for Bridgewater
----------------------------
Pre-Brief-34 state (set by `33_bridgewater_opening_geometry_migration.py`):
  N: type=trickle_vent, resistance=['mesh','flap'], 15×1300 mm, area=1.0 m²
  S: type=trickle_vent, resistance=['mesh','flap'], 15×1300 mm, area=0.76 m²

Derived C_d (both facades identical): ~0.23.
Area-weighted mean across two identical-derivation facades: ~0.23.

Post-Brief-34 state:
  openings.cd = 0.23 (one number, slider-driven thereafter)
  per-facade geometry fields removed.

Usage
-----
    python scripts/34_simplify_cd_migration.py

Requires backend on port 8002.
"""

import json
import sys
import urllib.error
import urllib.request

API_BASE = "http://127.0.0.1:8002/api"
DEFAULT_CD = 0.25
OBSOLETE_FACE_FIELDS = ("type", "internal_resistance", "width_mm", "height_mm")
FACADES = ("north", "south", "east", "west")

# Mirror of `computeCd` in frontend/src/utils/openingCoefficients.js. Kept
# in sync with the JS lookup tables.
SLOT_AR_ANCHORS = [
    (1, 0.61),
    (5, 0.58),
    (10, 0.50),
    (50, 0.42),
    (100, 0.38),
]
BASE_CD = {
    "orifice":      0.61,
    "louvre":       0.40,
    "fixed_grille": 0.40,
}
RESISTANCE_MULTIPLIERS = {
    "mesh":            0.85,
    "flap":            0.70,
    "acoustic_baffle": 0.60,
}


def _interpolate(x, x0, x1, y0, y1):
    if x <= x0:
        return y0
    if x >= x1:
        return y1
    return y0 + (y1 - y0) * ((x - x0) / (x1 - x0))


def _slot_base_cd(aspect_ratio):
    if aspect_ratio is None or aspect_ratio < 1:
        return SLOT_AR_ANCHORS[0][1]
    for (ar_a, cd_a), (ar_b, cd_b) in zip(SLOT_AR_ANCHORS, SLOT_AR_ANCHORS[1:]):
        if aspect_ratio <= ar_b:
            return _interpolate(aspect_ratio, ar_a, ar_b, cd_a, cd_b)
    return SLOT_AR_ANCHORS[-1][1]


def _compute_cd(opening):
    t = (opening or {}).get("type")
    if t in ("orifice", "louvre", "fixed_grille"):
        base = BASE_CD[t]
    elif t in ("slot", "trickle_vent"):
        w = opening.get("width_mm") or 0
        h = opening.get("height_mm") or 0
        longer  = max(w or 0, h or 0)
        shorter = min(w or 0, h or 0)
        ar = (longer / shorter) if shorter > 0 else 1.0
        base = _slot_base_cd(ar)
    else:
        base = BASE_CD["orifice"]
    cd = base
    for f in (opening or {}).get("internal_resistance", []) or []:
        m = RESISTANCE_MULTIPLIERS.get(f)
        if m is not None:
            cd *= m
    return cd


def _opening_has_geometry(face):
    return any(k in (face or {}) and (face or {})[k] is not None for k in OBSOLETE_FACE_FIELDS)


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


def _migrate_one(project):
    name = project.get("name") or project.get("id")
    project_id = project["id"]
    full = http_get(f"{API_BASE}/projects/{project_id}")
    bc = full.get("building_config") or {}
    openings = bc.get("openings") or {}

    # If no obsolete fields anywhere and `cd` already present, no-op.
    has_obsolete = any(
        _opening_has_geometry(openings.get(f) or {}) for f in FACADES
    )
    has_cd = isinstance(openings.get("cd"), (int, float))
    if not has_obsolete and has_cd:
        print(f"NO-OP: {name} — already on single cd = {openings['cd']!r}")
        return False

    # Compute the area-weighted mean C_d across facades that have BOTH a
    # non-zero area AND per-facade geometry. If nothing qualifies, use the
    # schema default.
    weighted_sum = 0.0
    area_sum = 0.0
    per_facade_cd = {}
    for f in FACADES:
        face = openings.get(f) or {}
        area = float(face.get("louvre_area_m2") or 0.0)
        if area <= 0 or not _opening_has_geometry(face):
            continue
        cd_face = _compute_cd(face)
        weighted_sum += cd_face * area
        area_sum += area
        per_facade_cd[f] = (cd_face, area)

    new_cd = (weighted_sum / area_sum) if area_sum > 0 else DEFAULT_CD
    new_cd = round(new_cd, 4)

    # Build the merged openings with obsolete fields stripped and `cd` set.
    merged_openings = {k: v for k, v in openings.items()}
    merged_openings["cd"] = new_cd
    for f in FACADES:
        face = merged_openings.get(f)
        if not isinstance(face, dict):
            continue
        merged_openings[f] = {k: v for k, v in face.items() if k not in OBSOLETE_FACE_FIELDS}

    http_put(f"{API_BASE}/projects/{project_id}/building", {"openings": merged_openings})

    print(f"OK: {name} ({project_id})")
    if per_facade_cd:
        for f, (cd_face, area) in per_facade_cd.items():
            print(f"  derived C_d {f}: {cd_face:.4f} @ area {area} m²")
        print(f"  -> area-weighted mean cd = {new_cd}")
    else:
        print(f"  no per-facade geometry; cd set to default {new_cd}")
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
            if _migrate_one(p):
                any_changed = True
        except Exception as e:
            print(f"ERROR migrating {p.get('name')}: {e}")
            return 3

    if not any_changed:
        print("All projects already migrated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
