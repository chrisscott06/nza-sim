"""
scripts/test_geometry.py

Verifies the geometry generator produces correct zones and surfaces
for the Bridgewater Hotel test case.

Run from project root:
    python3 scripts/test_geometry.py

Expected values (Bridgewater: 60m × 15m, 4 floors, 3.2m, WWR 25%):
  GIA           ≈ 3,600 m²   (60 × 15 × 4)
  Total walls   ≈ 1,920 m²   (2 × (60+15) × 3.2 × 4)
  Total glazing ≈   480 m²   (25% of 1,920)
  Overall WWR   ≈  0.25

Note: the brief states wall area as 3,840 m² — this appears to be a
transcription error (double the correct value). 1,920 m² is correct.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from nza_engine.generators.geometry import generate_building_geometry

BRIDGEWATER = {
    "name": "Bridgewater Hotel",
    "length": 60.0,
    "width": 15.0,
    "num_floors": 4,
    "floor_height": 3.2,
    "orientation": 0.0,
    "wwr": {"north": 0.25, "south": 0.25, "east": 0.25, "west": 0.25},
}

TOLERANCE = 0.01   # 1% tolerance for area checks


def pct_err(actual, expected):
    return abs(actual - expected) / expected * 100


def check(label, actual, expected, tol_pct=TOLERANCE * 100):
    err = pct_err(actual, expected)
    status = "✓" if err <= tol_pct else "✗"
    print(f"  {status} {label}: {actual:,.1f} m²  (expected ≈ {expected:,.1f}, error {err:.2f}%)")
    return err <= tol_pct


def main():
    print("=" * 60)
    print("NZA Simulate — Geometry generator test")
    print("=" * 60)

    geom = generate_building_geometry(BRIDGEWATER)
    meta = geom["_metadata"]
    zones = geom["Zone"]
    surfaces = geom["BuildingSurface:Detailed"]
    windows = geom["FenestrationSurface:Detailed"]

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\nBuilding: {meta['building_name']}")
    print(f"  Zones     : {meta['num_zones']}")
    print(f"  Surfaces  : {meta['num_surfaces']}")
    print(f"  Windows   : {meta['num_windows']}")
    print(f"  Overall WWR: {meta['overall_wwr']:.3f}")

    # ── Zone list ─────────────────────────────────────────────────────────────
    print(f"\nZones:")
    for z in sorted(zones.keys()):
        print(f"  {z}")

    # ── Area checks ───────────────────────────────────────────────────────────
    print(f"\nArea checks:")
    expected_gia = 60.0 * 15.0 * 4
    expected_walls = 2 * (60.0 + 15.0) * 3.2 * 4    # = 1,920 m²
    expected_glazing = 0.25 * expected_walls           # = 480 m²

    ok_gia     = check("GIA          ", meta["gia_m2"],             expected_gia)
    ok_walls   = check("Total walls  ", meta["total_wall_area_m2"], expected_walls)
    ok_glazing = check("Total glazing", meta["total_glazing_area_m2"], expected_glazing)

    # ── Surface type breakdown ────────────────────────────────────────────────
    print(f"\nSurface types:")
    type_counts: dict[str, int] = {}
    for s in surfaces.values():
        t = s["surface_type"]
        type_counts[t] = type_counts.get(t, 0) + 1
    for t, cnt in sorted(type_counts.items()):
        print(f"  {t:12s}: {cnt}")

    # ── Boundary condition check ──────────────────────────────────────────────
    print(f"\nBoundary conditions:")
    bc_counts: dict[str, int] = {}
    for s in surfaces.values():
        bc = s["outside_boundary_condition"]
        bc_counts[bc] = bc_counts.get(bc, 0) + 1
    for bc, cnt in sorted(bc_counts.items()):
        print(f"  {bc:12s}: {cnt}")

    # Expected: 1 Ground (GF slab), 1 Outdoors roof, rest Outdoors (walls) + Surface (interior)
    ground_count = bc_counts.get("Ground", 0)
    outdoors_count = bc_counts.get("Outdoors", 0)
    surface_count = bc_counts.get("Surface", 0)

    print(f"\n  ✓ Ground (GF slab)     : {ground_count} (expected 1)")   if ground_count == 1 else print(f"  ✗ Ground count wrong: {ground_count}")
    print(f"  ✓ Outdoors (walls+roof): {outdoors_count} (expected {4*4 + 1})")  if outdoors_count == 4*4 + 1 else print(f"  ✗ Outdoors count: {outdoors_count} (expected {4*4 + 1})")
    print(f"  ✓ Surface (interior)   : {surface_count} (expected {(4-1)*2})")  if surface_count == (4-1)*2 else print(f"  ✗ Surface count: {surface_count} (expected {(4-1)*2})")

    # ── Sample surface vertex check ───────────────────────────────────────────
    print(f"\nSample surface spot-check (Floor_1_Wall_S — south wall, ground floor):")
    s = surfaces.get("Floor_1_Wall_S")
    if s:
        print(f"  Surface type   : {s['surface_type']}")
        print(f"  Outside BC     : {s['outside_boundary_condition']}")
        print(f"  Construction   : {s['construction_name']}  (placeholder — assembler will replace)")
        print(f"  Vertices ({s['number_of_vertices']}):")
        for v in s["vertices"]:
            print(f"    ({v['vertex_x_coordinate']:.2f}, {v['vertex_y_coordinate']:.2f}, {v['vertex_z_coordinate']:.2f})")
        # Check outward normal: for south wall, normal should be -y
        v0, v1, v2 = s["vertices"][0], s["vertices"][1], s["vertices"][2]
        e1 = (v1["vertex_x_coordinate"]-v0["vertex_x_coordinate"],
              v1["vertex_y_coordinate"]-v0["vertex_y_coordinate"],
              v1["vertex_z_coordinate"]-v0["vertex_z_coordinate"])
        e2 = (v2["vertex_x_coordinate"]-v1["vertex_x_coordinate"],
              v2["vertex_y_coordinate"]-v1["vertex_y_coordinate"],
              v2["vertex_z_coordinate"]-v1["vertex_z_coordinate"])
        nx = e1[1]*e2[2] - e1[2]*e2[1]
        ny = e1[2]*e2[0] - e1[0]*e2[2]
        nz = e1[0]*e2[1] - e1[1]*e2[0]
        mag = (nx**2 + ny**2 + nz**2) ** 0.5
        nx, ny, nz = nx/mag, ny/mag, nz/mag
        print(f"  Outward normal : ({nx:.2f}, {ny:.2f}, {nz:.2f})  (expected: (0, -1, 0))")
        ok_normal = abs(ny - (-1.0)) < 0.01
        print(f"  {'✓' if ok_normal else '✗'} Normal correct for south wall")

    # ── Interior pairing check ────────────────────────────────────────────────
    print(f"\nInterior surface pairing check:")
    pairs_ok = True
    for f in range(2, BRIDGEWATER["num_floors"] + 1):
        slab_name = f"Floor_{f}_Slab"
        ceil_name = f"Floor_{f-1}_Ceiling"
        slab = surfaces.get(slab_name)
        ceil = surfaces.get(ceil_name)
        if slab and ceil:
            slab_ok = slab["outside_boundary_condition_object"] == ceil_name
            ceil_ok = ceil["outside_boundary_condition_object"] == slab_name
            if slab_ok and ceil_ok:
                print(f"  ✓ {slab_name} ↔ {ceil_name}")
            else:
                print(f"  ✗ {slab_name} ↔ {ceil_name}: pairing mismatch")
                pairs_ok = False
        else:
            print(f"  ✗ Missing surface: {slab_name} or {ceil_name}")
            pairs_ok = False

    # ── Pass/fail ─────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    all_ok = ok_gia and ok_walls and ok_glazing and pairs_ok
    if all_ok:
        print("Geometry test PASSED — all area checks within 1% tolerance.")
    else:
        print("Geometry test FAILED — see above for details.")
    print("=" * 60)

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
