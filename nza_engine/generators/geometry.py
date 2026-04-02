"""
nza_engine/generators/geometry.py

Generates EnergyPlus zone and surface definitions for a rectangular building.

Output is a Python dict structured to map directly to epJSON format.
Construction names are placeholder strings (ALL_CAPS constants) that the
epjson_assembler replaces with actual library construction names.

EnergyPlus vertex convention used throughout:
  - Walls:    counterclockwise when viewed from outside the building
  - Floors:   counterclockwise when viewed from below (outward normal = -z)
  - Ceilings: counterclockwise when viewed from above (outward normal = +z)
  - Right-hand rule gives the outward normal vector.

Coordinate system:
  - Origin at lower-left corner of ground floor
  - x-axis: along building length (east)
  - y-axis: along building width  (north)
  - z-axis: vertical (up)
  - Building orientation is applied via the EnergyPlus Building object
    north-axis field, not by rotating the geometry here.
"""

import math
from typing import Any

# ── Construction type placeholders ────────────────────────────────────────────
# The assembler maps these to real construction names from the library.
PLACEHOLDER_EXT_WALL = "EXT_WALL"
PLACEHOLDER_ROOF = "ROOF"
PLACEHOLDER_GROUND_FLOOR = "GROUND_FLOOR"
PLACEHOLDER_GLAZING = "GLAZING"
PLACEHOLDER_INT_FLOOR_CEIL = "INT_FLOOR_CEIL"

# ── Window geometry constants ──────────────────────────────────────────────────
WINDOW_HEIGHT = 1.5          # m — standard hotel window height
MIN_SILL_HEIGHT = 0.5        # m — minimum sill above floor


def _vert(x: float, y: float, z: float) -> dict:
    """Create a single epJSON vertex dict."""
    return {
        "vertex_x_coordinate": round(x, 6),
        "vertex_y_coordinate": round(y, 6),
        "vertex_z_coordinate": round(z, 6),
    }


def _wall_surface(
    name: str,
    zone_name: str,
    construction_name: str,
    vertices: list[dict],
    outside_bc: str = "Outdoors",
    outside_bc_object: str = "",
    sun_exposed: bool = True,
    wind_exposed: bool = True,
) -> dict:
    """Assemble a BuildingSurface:Detailed wall entry."""
    return {
        "surface_type": "Wall",
        "construction_name": construction_name,
        "zone_name": zone_name,
        "outside_boundary_condition": outside_bc,
        "outside_boundary_condition_object": outside_bc_object,
        "sun_exposure": "SunExposed" if sun_exposed else "NoSun",
        "wind_exposure": "WindExposed" if wind_exposed else "NoWind",
        "view_factor_to_ground": "autocalculate",
        "number_of_vertices": len(vertices),
        "vertices": vertices,
    }


def _floor_surface(
    name: str,
    zone_name: str,
    construction_name: str,
    vertices: list[dict],
    outside_bc: str = "Ground",
    outside_bc_object: str = "",
) -> dict:
    """Assemble a BuildingSurface:Detailed floor entry."""
    return {
        "surface_type": "Floor",
        "construction_name": construction_name,
        "zone_name": zone_name,
        "outside_boundary_condition": outside_bc,
        "outside_boundary_condition_object": outside_bc_object,
        "sun_exposure": "NoSun",
        "wind_exposure": "NoWind",
        "view_factor_to_ground": "autocalculate",
        "number_of_vertices": len(vertices),
        "vertices": vertices,
    }


def _ceiling_surface(
    name: str,
    zone_name: str,
    construction_name: str,
    vertices: list[dict],
    outside_bc: str = "Outdoors",
    outside_bc_object: str = "",
    is_roof: bool = False,
) -> dict:
    """Assemble a BuildingSurface:Detailed ceiling/roof entry."""
    return {
        "surface_type": "Roof" if is_roof else "Ceiling",
        "construction_name": construction_name,
        "zone_name": zone_name,
        "outside_boundary_condition": outside_bc,
        "outside_boundary_condition_object": outside_bc_object,
        "sun_exposure": "SunExposed" if is_roof else "NoSun",
        "wind_exposure": "WindExposed" if is_roof else "NoWind",
        "view_factor_to_ground": "autocalculate",
        "number_of_vertices": len(vertices),
        "vertices": vertices,
    }


def _window_surface(
    name: str,
    parent_surface_name: str,
    construction_name: str,
    vertices: list[dict],
) -> dict:
    """Assemble a FenestrationSurface:Detailed window entry."""
    return {
        "surface_type": "Window",
        "construction_name": construction_name,
        "building_surface_name": parent_surface_name,
        "frame_and_divider_name": "",
        "multiplier": 1.0,
        "number_of_vertices": len(vertices),
        "vertices": vertices,
    }


def _window_vertices_on_wall(
    wall_vertices: list[dict],
    wwr: float,
    floor_height: float,
    win_height: float = WINDOW_HEIGHT,
    min_sill: float = MIN_SILL_HEIGHT,
) -> list[dict] | None:
    """
    Compute window vertices centred on a wall surface.

    Determines window width from the WWR and the wall dimensions.
    Returns None if the window would be degenerate (zero or negative size).
    The window vertices share the same plane and outward normal as the wall.

    For a wall defined by 4 vertices (CCW from outside), the window is:
      - Centred horizontally
      - Centred vertically (respecting min_sill)
      - Same outward normal as the wall
    """
    if wwr <= 0:
        return None

    # Determine wall width (horizontal span) and height from vertices.
    # v0=bottom-left, v1=bottom-right, v2=top-right, v3=top-left
    # (following CCW-from-outside convention set up in geometry generation)
    v0, v1 = wall_vertices[0], wall_vertices[1]
    dx = v1["vertex_x_coordinate"] - v0["vertex_x_coordinate"]
    dy = v1["vertex_y_coordinate"] - v0["vertex_y_coordinate"]
    wall_width = math.sqrt(dx * dx + dy * dy)   # horizontal span
    wall_area = wall_width * floor_height

    win_area = wwr * wall_area
    win_w = win_area / win_height

    if win_w <= 0 or win_w > wall_width:
        return None

    # Sill height — centred vertically, never below min_sill
    sill_z = max(min_sill, (floor_height - win_height) / 2)
    head_z = sill_z + win_height

    if head_z > floor_height:
        return None

    # Horizontal offset from v0 (left edge when viewed from outside)
    h_offset = (wall_width - win_w) / 2

    # Unit horizontal vector along the wall bottom edge (v0 → v1)
    ux = dx / wall_width
    uy = dy / wall_width

    # Base z (floor level this wall starts at)
    z_base = v0["vertex_z_coordinate"]

    # Window corners in global coordinates
    # CCW from outside: bottom-left, bottom-right, top-right, top-left
    x0, y0 = v0["vertex_x_coordinate"] + ux * h_offset, v0["vertex_y_coordinate"] + uy * h_offset
    x1, y1 = x0 + ux * win_w, y0 + uy * win_w

    return [
        _vert(x0, y0, z_base + sill_z),
        _vert(x1, y1, z_base + sill_z),
        _vert(x1, y1, z_base + head_z),
        _vert(x0, y0, z_base + head_z),
    ]


def generate_building_geometry(params: dict) -> dict[str, Any]:
    """
    Generate EnergyPlus zone and surface definitions for a rectangular building.

    Parameters
    ----------
    params : dict with keys:
        name         (str)   Building name
        length       (float) Building length in metres along x-axis
        width        (float) Building width  in metres along y-axis
        num_floors   (int)   Number of floors
        floor_height (float) Floor-to-floor height in metres
        orientation  (float) Degrees from north, clockwise — applied via
                             Building object, not by rotating geometry
        wwr          (dict)  Window-to-wall ratio per facade:
                             {"north": 0.25, "south": 0.25,
                              "east": 0.25, "west": 0.25}

    Returns
    -------
    dict with keys:
        "Zone"                       — epJSON Zone objects
        "BuildingSurface:Detailed"   — epJSON wall/floor/ceiling objects
        "FenestrationSurface:Detailed" — epJSON window objects
        "_metadata"                  — summary info (not written to epJSON)
    """
    L = float(params["length"])        # x-axis
    W = float(params["width"])         # y-axis
    nf = int(params["num_floors"])
    fh = float(params["floor_height"])
    wwr = params["wwr"]                # dict: north/south/east/west

    zones: dict[str, Any] = {}
    surfaces: dict[str, Any] = {}
    windows: dict[str, Any] = {}

    for i in range(nf):
        floor_num = i + 1
        z0 = i * fh        # bottom of this floor
        z1 = z0 + fh       # top of this floor
        zone_name = f"Floor_{floor_num}"

        # ── Zone ──────────────────────────────────────────────────────────────
        zones[zone_name] = {
            "direction_of_relative_north": 0.0,
            "x_origin": 0.0,
            "y_origin": 0.0,
            "z_origin": 0.0,
            "type": 1,
            "multiplier": 1,
            "ceiling_height": fh,
            "volume": "autocalculate",
            "floor_area": "autocalculate",
        }

        # ── Wall names ────────────────────────────────────────────────────────
        wall_s_name = f"{zone_name}_Wall_S"
        wall_n_name = f"{zone_name}_Wall_N"
        wall_e_name = f"{zone_name}_Wall_E"
        wall_w_name = f"{zone_name}_Wall_W"

        # ── South wall  (y=0, outward normal = -y) ────────────────────────────
        # CCW from outside (south): v0=SW-bot, v1=SE-bot, v2=SE-top, v3=SW-top
        south_verts = [
            _vert(0, 0, z0), _vert(L, 0, z0),
            _vert(L, 0, z1), _vert(0, 0, z1),
        ]
        surfaces[wall_s_name] = _wall_surface(
            wall_s_name, zone_name, PLACEHOLDER_EXT_WALL, south_verts
        )

        # ── North wall  (y=W, outward normal = +y) ───────────────────────────
        # CCW from outside (north): v0=NE-bot, v1=NW-bot, v2=NW-top, v3=NE-top
        north_verts = [
            _vert(L, W, z0), _vert(0, W, z0),
            _vert(0, W, z1), _vert(L, W, z1),
        ]
        surfaces[wall_n_name] = _wall_surface(
            wall_n_name, zone_name, PLACEHOLDER_EXT_WALL, north_verts
        )

        # ── East wall   (x=L, outward normal = +x) ───────────────────────────
        # CCW from outside (east): v0=SE-bot, v1=NE-bot, v2=NE-top, v3=SE-top
        east_verts = [
            _vert(L, 0, z0), _vert(L, W, z0),
            _vert(L, W, z1), _vert(L, 0, z1),
        ]
        surfaces[wall_e_name] = _wall_surface(
            wall_e_name, zone_name, PLACEHOLDER_EXT_WALL, east_verts
        )

        # ── West wall   (x=0, outward normal = -x) ───────────────────────────
        # CCW from outside (west): v0=NW-bot, v1=SW-bot, v2=SW-top, v3=NW-top
        west_verts = [
            _vert(0, W, z0), _vert(0, 0, z0),
            _vert(0, 0, z1), _vert(0, W, z1),
        ]
        surfaces[wall_w_name] = _wall_surface(
            wall_w_name, zone_name, PLACEHOLDER_EXT_WALL, west_verts
        )

        # ── Windows ───────────────────────────────────────────────────────────
        for facade, wall_name, wall_verts in [
            ("south", wall_s_name, south_verts),
            ("north", wall_n_name, north_verts),
            ("east",  wall_e_name,  east_verts),
            ("west",  wall_w_name,  west_verts),
        ]:
            win_verts = _window_vertices_on_wall(
                wall_verts, wwr.get(facade, 0.0), fh
            )
            if win_verts:
                win_name = f"{zone_name}_Win_{facade[0].upper()}"
                windows[win_name] = _window_surface(
                    win_name, wall_name, PLACEHOLDER_GLAZING, win_verts
                )

        # ── Floor slab ────────────────────────────────────────────────────────
        slab_name = f"{zone_name}_Slab"
        # Floor vertices: CCW from below = outward normal -z
        # v0=SW, v1=NW, v2=NE, v3=SE (counter-clockwise when viewed from below)
        floor_verts = [
            _vert(0, 0, z0), _vert(0, W, z0),
            _vert(L, W, z0), _vert(L, 0, z0),
        ]

        if floor_num == 1:
            # Ground floor — boundary with ground
            surfaces[slab_name] = _floor_surface(
                slab_name, zone_name,
                PLACEHOLDER_GROUND_FLOOR, floor_verts,
                outside_bc="Ground",
            )
        else:
            # Interior floor — paired with the ceiling of the floor below
            below_ceil_name = f"Floor_{floor_num - 1}_Ceiling"
            surfaces[slab_name] = _floor_surface(
                slab_name, zone_name,
                PLACEHOLDER_INT_FLOOR_CEIL, floor_verts,
                outside_bc="Surface",
                outside_bc_object=below_ceil_name,
            )

        # ── Ceiling / Roof ────────────────────────────────────────────────────
        ceil_name = f"{zone_name}_Ceiling"
        # Ceiling vertices: CCW from above = outward normal +z
        # v0=SW, v1=SE, v2=NE, v3=NW
        ceil_verts = [
            _vert(0, 0, z1), _vert(L, 0, z1),
            _vert(L, W, z1), _vert(0, W, z1),
        ]

        if floor_num == nf:
            # Top floor — this is the roof
            surfaces[ceil_name] = _ceiling_surface(
                ceil_name, zone_name,
                PLACEHOLDER_ROOF, ceil_verts,
                outside_bc="Outdoors",
                is_roof=True,
            )
        else:
            # Interior ceiling — paired with the floor slab of the zone above
            above_slab_name = f"Floor_{floor_num + 1}_Slab"
            surfaces[ceil_name] = _ceiling_surface(
                ceil_name, zone_name,
                PLACEHOLDER_INT_FLOOR_CEIL, ceil_verts,
                outside_bc="Surface",
                outside_bc_object=above_slab_name,
                is_roof=False,
            )

    # ── Metadata summary ──────────────────────────────────────────────────────
    gia = L * W * nf
    wall_area_per_floor = 2 * (L + W) * fh
    total_wall_area = wall_area_per_floor * nf

    # Compute actual glazing area from generated windows
    def _win_area(verts: list[dict]) -> float:
        v0, v1, v2 = verts[0], verts[1], verts[2]
        w = math.sqrt(
            (v1["vertex_x_coordinate"] - v0["vertex_x_coordinate"]) ** 2
            + (v1["vertex_y_coordinate"] - v0["vertex_y_coordinate"]) ** 2
        )
        h = abs(v2["vertex_z_coordinate"] - v1["vertex_z_coordinate"])
        return w * h

    total_glazing_area = sum(
        _win_area(win["vertices"]) for win in windows.values()
    )

    metadata = {
        "building_name": params.get("name", "Building"),
        "num_zones": nf,
        "gia_m2": gia,
        "total_wall_area_m2": total_wall_area,
        "total_glazing_area_m2": total_glazing_area,
        "overall_wwr": total_glazing_area / total_wall_area if total_wall_area > 0 else 0,
        "num_surfaces": len(surfaces),
        "num_windows": len(windows),
    }

    return {
        "Zone": zones,
        "BuildingSurface:Detailed": surfaces,
        "FenestrationSurface:Detailed": windows,
        "_metadata": metadata,
    }
