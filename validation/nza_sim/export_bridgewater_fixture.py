"""
export_bridgewater_fixture.py — Brief 81 P3.

Freeze the live "HIX Bridgewater" project (post-Brief-77, most-defensible state)
into a versioned YAML fixture `validation/fixtures/bridgewater_v1.yaml`. This is
preparatory work for Brief 82 (full-Bridgewater EnergyPlus validation): we want
the anchor frozen NOW, while the numbers are trusted.

READ-ONLY. Opens data/nza_sim.db with mode=ro (writes are impossible) and never
mutates the live DB (CLAUDE.md data-safety + Brief 72 PA). The engine is run
pure-Node from the emitted fixture (divergence D4), not from a DB project.

WHY a verbatim building_config dump (not the hand-authored box schema):
  The Bridgewater-Box fixture (P2) uses a clean hand-authored schema because the
  box is a designed reference. Bridgewater proper is a real 4,125 m² hotel with
  2 heating / 1 cooling / 2 DHW / 3 ventilation systems, a full occupancy
  schedule, and 11 library constructions. The faithful freeze is the live
  `building_config` object verbatim (it IS the engine's `building` param on the
  live path) + `construction_choices` + comfort band + the library constructions
  the project references — resolved into the SAME shape the `/api/library/
  constructions` endpoint returns, so the Node loader reproduces exactly what the
  live UI fed the engine.

Construction `layers` are derived from each item's `config_json.epjson` using the
IDENTICAL logic as api/routers/library.py::get_constructions() (Brief 26.1 P5),
so the dynamic thermal-mass model sees the same stack the live engine saw.

Run (from project root):
    python validation/nza_sim/export_bridgewater_fixture.py
"""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import yaml

PROJECT_ID = "3561c5a6-9a3f-4b5c-9e3d-72b449658d9a"  # HIX Bridgewater
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DB = REPO_ROOT / "data" / "nza_sim.db"
OUT = REPO_ROOT / "validation" / "fixtures" / "bridgewater_v1.yaml"


def jload(x):
    if x is None or isinstance(x, (dict, list)):
        return x
    try:
        return json.loads(x)
    except Exception:
        return x


def derive_layers(name, cfg):
    """Mirror api/routers/library.py::get_constructions() layer derivation.

    Reads config_json.epjson.Construction[name] (outside_layer → layer_2..10),
    cross-references Material / Material:NoMass. Glazing returns [] by
    convention (no opaque mass term in the live engine).
    """
    layers = []
    epjson = cfg.get("epjson") or {}
    construction_obj = (epjson.get("Construction") or {}).get(name, {})
    materials = epjson.get("Material") or {}
    nomass = epjson.get("Material:NoMass") or {}
    ordered = []
    if construction_obj.get("outside_layer"):
        ordered.append(construction_obj["outside_layer"])
    for i in range(2, 11):
        n = construction_obj.get(f"layer_{i}")
        if n:
            ordered.append(n)
    for ln in ordered:
        if ln in materials:
            m = materials[ln]
            layers.append({
                "name": ln,
                "kind": "Material",
                "thickness": m.get("thickness"),
                "conductivity": m.get("conductivity"),
                "density": m.get("density"),
                "specific_heat": m.get("specific_heat"),
            })
        elif ln in nomass:
            layers.append({
                "name": ln,
                "kind": "Material:NoMass",
                "thermal_resistance": (nomass[ln] or {}).get("thermal_resistance"),
            })
    return layers


def build_construction(row):
    """Same response shape as GET /api/library/constructions list items."""
    cfg = jload(row["config_json"]) or {}
    return {
        "name": row["name"],
        "display_name": row["display_name"] or row["name"],
        "description": row["description"] or "",
        "type": cfg.get("type", "wall"),
        "u_value_W_per_m2K": cfg.get("u_value_W_per_m2K"),
        "g_value": cfg.get("g_value"),
        "thermal_mass": cfg.get("thermal_mass"),
        "y_factor": cfg.get("y_factor"),
        "u_value_effective_W_per_m2K": cfg.get("u_value_effective_W_per_m2K"),
        "layers": derive_layers(row["name"], cfg),
    }


def main():
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row

    proj = con.execute(
        "SELECT id, name, building_config, construction_choices, "
        "comfort_band_lower_c, comfort_band_upper_c FROM projects WHERE id=?",
        (PROJECT_ID,),
    ).fetchone()
    if proj is None:
        raise SystemExit(f"project {PROJECT_ID} not found")

    building_config = jload(proj["building_config"])
    construction_choices = jload(proj["construction_choices"])

    constructions = [
        build_construction(r)
        for r in con.execute(
            "SELECT name, display_name, description, config_json FROM library_items "
            "WHERE library_type='construction' ORDER BY is_default DESC, name"
        )
    ]
    con.close()

    fixture = {
        "meta": {
            "fixture_id": "bridgewater_v1",
            "schema_version": 1,
            "kind": "project_dump",  # distinct from the box's hand-authored schema
            "title": "HIX Bridgewater (frozen anchor, post-Brief-77)",
            "brief": "Brief 81 P3 — frozen anchor for Brief 82",
            "source_project_id": proj["id"],
            "source_project_name": proj["name"],
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "nza_engine": "v2.5 (State 3)",
            "note": (
                "Verbatim freeze of the live building_config. The Node loader "
                "(run_bridgewater_anchor.mjs) maps building_config -> engine "
                "`building` param 1:1, construction_choices -> `constructions`, "
                "and library.constructions -> libraryData.constructions using the "
                "SAME mapping as scripts/_brief75_p1_anchor.mjs (which reads the "
                "live /api/library/constructions). Engine run is pure-Node, no DB "
                "write (divergence D4). Expected to reproduce the Brief 77 anchor "
                "within +/-1%: EUI 143.5, heating 98.3, cooling 53.1, mech vent "
                "326.0 MWh."
            ),
        },
        "project": {
            "comfort_band": {
                "lower_c": proj["comfort_band_lower_c"],
                "upper_c": proj["comfort_band_upper_c"],
            },
        },
        "weather": {
            "epw_file": (building_config or {}).get("weather_file"),
        },
        "construction_choices": construction_choices,
        "building_config": building_config,
        "library": {
            "constructions": constructions,
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(
            "# ============================================================\n"
            "# Bridgewater v1 — FROZEN ANCHOR (Brief 81 P3)\n"
            "# Auto-generated by validation/nza_sim/export_bridgewater_fixture.py\n"
            "# Read-only export of the live HIX Bridgewater project, post-Brief-77.\n"
            "# Do not hand-edit; re-run the exporter to refresh.\n"
            "# ============================================================\n"
        )
        yaml.safe_dump(fixture, f, sort_keys=False, allow_unicode=True, width=100)

    print(f"wrote {OUT.relative_to(REPO_ROOT)}")
    print(f"  project              : {proj['name']} ({proj['id']})")
    print(f"  weather_file         : {fixture['weather']['epw_file']}")
    print(f"  comfort_band         : {proj['comfort_band_lower_c']}-{proj['comfort_band_upper_c']}")
    print(f"  construction_choices : {construction_choices}")
    print(f"  library constructions: {len(constructions)}")
    v40 = (building_config or {}).get("systems_config_v40") or {}
    for svc in ("heating", "cooling", "dhw", "ventilation", "lighting", "small_power"):
        arr = v40.get(svc)
        if isinstance(arr, list):
            print(f"  v40.{svc:11s}: {[s.get('id') for s in arr]}")


if __name__ == "__main__":
    main()
