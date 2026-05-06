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
from __future__ import annotations

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
        "number_of_vertices": len(vertices),
        "vertices": vertices,
    }


def _window_surface(
    name: str,
    parent_surface_name: str,
    construction_name: str,
    vertices: list[dict],
) -> dict:
    """
    Assemble a FenestrationSurface:Detailed window entry.

    EnergyPlus 25.2 epJSON uses flat vertex fields for FenestrationSurface
    (vertex_1_x_coordinate etc.) rather than the array format used by
    BuildingSurface:Detailed.
    """
    obj: dict = {
        "surface_type": "Window",
        "construction_name": construction_name,
        "building_surface_name": parent_surface_name,
        "multiplier": 1.0,
        "number_of_vertices": len(vertices),
    }
    # Flatten vertices into numbered fields
    for i, v in enumerate(vertices, start=1):
        obj[f"vertex_{i}_x_coordinate"] = v["vertex_x_coordinate"]
        obj[f"vertex_{i}_y_coordinate"] = v["vertex_y_coordinate"]
        obj[f"vertex_{i}_z_coordinate"] = v["vertex_z_coordinate"]
    return obj


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


# Per-facade outward normal (unit vector). Building length along Z, width
# along X — see geometry below. North wall normal = +Y, south = -Y, etc.
_FACADE_NORMAL = {
    "north": (0.0,  1.0, 0.0),
    "south": (0.0, -1.0, 0.0),
    "east":  (1.0,  0.0, 0.0),
    "west":  (-1.0, 0.0, 0.0),
}


def _shading_building_overhang_slab(
    name: str, facade: str, win_verts: list[dict], depth_m: float, offset_m: float = 0.0,
) -> dict | None:
    """
    Shading:Building:Detailed — explicit-vertex horizontal slab above the
    window, extending outward by depth_m. Bypasses Shading:Overhang attached-
    shading logic in case that's the path EP isn't applying.

    win_verts (CCW from outside):  v0=bottom-left, v1=bottom-right,
                                   v2=top-right,    v3=top-left
    """
    if depth_m <= 0:
        return None
    n = _FACADE_NORMAL.get(facade)
    if not n:
        return None

    # Top edge of window: v3 (TL) → v2 (TR), at z = head_z
    tl, tr = win_verts[3], win_verts[2]
    head_z = tl["vertex_z_coordinate"]
    # Slab inner edge sits offset_m above the window head
    inner_z = head_z + float(offset_m or 0.0)

    # Inner edge points along the wall: from TL.xy to TR.xy at z=inner_z
    inner_a = (tl["vertex_x_coordinate"], tl["vertex_y_coordinate"], inner_z)
    inner_b = (tr["vertex_x_coordinate"], tr["vertex_y_coordinate"], inner_z)
    # Outer edge: extruded by depth_m along the facade outward normal
    outer_b = (inner_b[0] + n[0] * depth_m, inner_b[1] + n[1] * depth_m, inner_z)
    outer_a = (inner_a[0] + n[0] * depth_m, inner_a[1] + n[1] * depth_m, inner_z)

    # GlobalGeometryRules: starting_vertex_position=UpperLeftCorner +
    # vertex_entry_direction=Counterclockwise. For a horizontal slab the
    # "upper left" is the NW corner when viewed from above. CCW from above
    # means the outward (upward) normal is +Z so the slab blocks sun
    # coming from above. Going inner_b → outer_b → outer_a → inner_a
    # (NE wall → NE outer → SW outer → SW wall, looking from above) is
    # CCW for a south-facing facade. For a north-facing one the outward
    # normal direction reverses, so the same vertex order naturally flips.
    # Empirically: this order gives EP a slab that actually shades.
    return {
        "transmittance_schedule_name": "",
        "number_of_vertices": 4,
        "vertices": [
            {"vertex_x_coordinate": inner_b[0], "vertex_y_coordinate": inner_b[1], "vertex_z_coordinate": inner_b[2]},
            {"vertex_x_coordinate": outer_b[0], "vertex_y_coordinate": outer_b[1], "vertex_z_coordinate": outer_b[2]},
            {"vertex_x_coordinate": outer_a[0], "vertex_y_coordinate": outer_a[1], "vertex_z_coordinate": outer_a[2]},
            {"vertex_x_coordinate": inner_a[0], "vertex_y_coordinate": inner_a[1], "vertex_z_coordinate": inner_a[2]},
        ],
    }


def _shading_overhang(name: str, window_name: str, depth_m: float, offset_m: float) -> dict:
    """
    Shading:Overhang — horizontal projection above a window/door.

    EnergyPlus computes per-timestep shadow patches automatically from the
    sun position. Tilt 90° = strict horizontal overhang.
    """
    # Note: EP 26 epJSON schema uses 'window_door' (no '_or_') for these field
    # names. Earlier versions had '_or_' — wrong field names are silently
    # dropped by EnergyPlus, leaving the shading object with no effect.
    return {
        "window_or_door_name": window_name,
        "height_above_window_or_door": float(offset_m or 0.0),
        "tilt_angle_from_window_door": 90.0,
        "left_extension_from_window_door_width": 0.0,
        "right_extension_from_window_door_width": 0.0,
        "depth": float(depth_m),
    }


def _shading_fin(
    name: str, window_name: str,
    left_depth_m: float = 0.0, right_depth_m: float = 0.0,
) -> dict | None:
    """
    Shading:Fin — vertical fins on either side of a window/door.
    Returns None if both depths are zero (caller skips emission).
    """
    if (left_depth_m or 0) <= 0 and (right_depth_m or 0) <= 0:
        return None
    return {
        "window_or_door_name": window_name,
        "left_extension_from_window_door": 0.0,
        "left_distance_above_top_of_window": 0.0,
        "left_distance_below_bottom_of_window": 0.0,
        "left_tilt_angle_from_window_door": 90.0,
        "left_depth": float(left_depth_m or 0.0),
        "right_extension_from_window_door": 0.0,
        "right_distance_above_top_of_window": 0.0,
        "right_distance_below_bottom_of_window": 0.0,
        "right_tilt_angle_from_window_door": 90.0,
        "right_depth": float(right_depth_m or 0.0),
    }


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

    shading_overhang_cfg = params.get("shading_overhang") or {}
    shading_fin_cfg      = params.get("shading_fin")      or {}

    zones: dict[str, Any] = {}
    surfaces: dict[str, Any] = {}
    windows: dict[str, Any] = {}
    overhangs: dict[str, Any]            = {}
    fins: dict[str, Any]                  = {}
    detailed_shadings: dict[str, Any]    = {}

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
            # volume and floor_area intentionally omitted —
            # EnergyPlus calculates them from surface geometry
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

                # ── Shading on this window ─────────────────────────────────
                # Two parallel emissions:
                #  1. Shading:Overhang / Shading:Fin (attached) — was the
                #     original approach. Visible in eplusout.eio but does
                #     not visibly reduce solar in EP 26 for our model.
                #  2. Shading:Building:Detailed (explicit vertices) — the
                #     fallback being tested in Brief 23 H3.
                oh = shading_overhang_cfg.get(facade) or {}
                depth = float(oh.get("depth_m") or 0.0)
                offset = float(oh.get("offset_m") or 0.0)
                if depth > 0:
                    oh_name = f"{win_name}_Overhang"
                    overhangs[oh_name] = _shading_overhang(oh_name, win_name, depth_m=depth, offset_m=offset)
                    # Also emit explicit-vertex slab as a parallel test.
                    slab = _shading_building_overhang_slab(
                        f"{win_name}_OverhangDet", facade, win_verts, depth, offset
                    )
                    if slab:
                        detailed_shadings[f"{win_name}_OverhangDet"] = slab

                fc = shading_fin_cfg.get(facade) or {}
                fin_obj = _shading_fin(
                    f"{win_name}_Fin", win_name,
                    left_depth_m=float(fc.get("left_depth_m") or 0.0),
                    right_depth_m=float(fc.get("right_depth_m") or 0.0),
                )
                if fin_obj:
                    fins[f"{win_name}_Fin"] = fin_obj

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

    # Compute actual glazing area from generated windows.
    # Windows now use flat vertex fields (vertex_N_x/y/z_coordinate).
    def _win_area_flat(win: dict) -> float:
        x1, y1, z1 = win["vertex_1_x_coordinate"], win["vertex_1_y_coordinate"], win["vertex_1_z_coordinate"]
        x2, y2, z2 = win["vertex_2_x_coordinate"], win["vertex_2_y_coordinate"], win["vertex_2_z_coordinate"]
        x3, y3, z3 = win["vertex_3_x_coordinate"], win["vertex_3_y_coordinate"], win["vertex_3_z_coordinate"]
        w = math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
        h = abs(z3 - z2)
        return w * h

    total_glazing_area = sum(_win_area_flat(win) for win in windows.values())

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

    result = {
        "Zone": zones,
        "BuildingSurface:Detailed": surfaces,
        "FenestrationSurface:Detailed": windows,
        "_metadata": metadata,
    }
    if overhangs:
        result["Shading:Overhang"] = overhangs
    if fins:
        result["Shading:Fin"] = fins
    if detailed_shadings:
        result["Shading:Building:Detailed"] = detailed_shadings
    return result
