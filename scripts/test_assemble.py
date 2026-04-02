"""
scripts/test_assemble.py

Assembles the Bridgewater Hotel epJSON and validates the output.

Run from project root:
    python3 scripts/test_assemble.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from nza_engine.config import DEFAULT_WEATHER_DIR, SIMULATIONS_DIR
from nza_engine.generators.epjson_assembler import assemble_epjson

BRIDGEWATER = {
    "name": "Bridgewater Hotel",
    "length": 60.0,
    "width": 15.0,
    "num_floors": 4,
    "floor_height": 3.2,
    "orientation": 0.0,
    "wwr": {"north": 0.25, "south": 0.25, "east": 0.25, "west": 0.25},
}

CONSTRUCTION_CHOICES = {
    "external_wall": "cavity_wall_standard",
    "roof": "flat_roof_standard",
    "ground_floor": "ground_floor_slab",
    "glazing": "double_low_e",
}

WEATHER_FILE = DEFAULT_WEATHER_DIR / "USA_CO_Golden-NREL.724666_TMY3.epw"
OUTPUT_PATH = SIMULATIONS_DIR / "test_bridgewater" / "input.epJSON"


def main():
    print("=" * 60)
    print("NZA Simulate — epJSON assembler test")
    print("=" * 60)

    print(f"\nWeather file : {WEATHER_FILE}")
    print(f"Output path  : {OUTPUT_PATH}")

    if not WEATHER_FILE.exists():
        print(f"\n✗ Weather file not found: {WEATHER_FILE}")
        sys.exit(1)

    # ── Assemble ──────────────────────────────────────────────────────────────
    print("\nAssembling epJSON...")
    epjson = assemble_epjson(
        building_params=BRIDGEWATER,
        construction_choices=CONSTRUCTION_CHOICES,
        weather_file_path=WEATHER_FILE,
        output_path=OUTPUT_PATH,
    )

    # ── File size ─────────────────────────────────────────────────────────────
    size_kb = OUTPUT_PATH.stat().st_size / 1024
    print(f"\n✓ Written to {OUTPUT_PATH}")
    print(f"  File size: {size_kb:.1f} KB")

    # ── Object counts ─────────────────────────────────────────────────────────
    print("\nEnergyPlus object counts:")
    object_types = [
        "Zone", "BuildingSurface:Detailed", "FenestrationSurface:Detailed",
        "Material", "Material:NoMass", "WindowMaterial:SimpleGlazingSystem",
        "Construction", "Schedule:Compact", "People", "Lights",
        "ElectricEquipment", "ZoneInfiltration:DesignFlowRate",
        "HVACTemplate:Zone:IdealLoadsAirSystem", "Output:Variable", "Output:Meter",
    ]
    total = 0
    for obj_type in object_types:
        count = len(epjson.get(obj_type, {}))
        total += count
        if count > 0:
            print(f"  {obj_type:45s}: {count}")
    print(f"  {'TOTAL':45s}: {total}")

    # ── JSON round-trip validation ─────────────────────────────────────────────
    print("\nValidating JSON round-trip...")
    json_str = json.dumps(epjson)
    reparsed = json.loads(json_str)
    assert reparsed == epjson, "JSON round-trip failed!"
    print("  ✓ Valid JSON — round-trip check passed")

    # ── Spot checks ───────────────────────────────────────────────────────────
    print("\nSpot checks:")
    checks_passed = 0
    checks_total = 0

    def check(label, condition, detail=""):
        nonlocal checks_passed, checks_total
        checks_total += 1
        if condition:
            checks_passed += 1
            print(f"  ✓ {label}")
        else:
            print(f"  ✗ {label}{(' — ' + detail) if detail else ''}")

    zones = epjson.get("Zone", {})
    check("4 zones created", len(zones) == 4, f"got {len(zones)}")

    surfaces = epjson.get("BuildingSurface:Detailed", {})
    check("24 surfaces created", len(surfaces) == 24, f"got {len(surfaces)}")

    windows = epjson.get("FenestrationSurface:Detailed", {})
    check("16 windows created", len(windows) == 16, f"got {len(windows)}")

    constructions = epjson.get("Construction", {})
    expected_constructions = {
        "cavity_wall_standard", "flat_roof_standard",
        "ground_floor_slab", "double_low_e", "interior_floor_ceiling",
    }
    check(
        "All 5 constructions present",
        expected_constructions.issubset(set(constructions.keys())),
        f"found: {set(constructions.keys())}",
    )

    # Check no surface still has a placeholder construction
    for name, surf in surfaces.items():
        cname = surf.get("construction_name", "")
        check(
            f"Surface {name} has real construction name",
            not cname.isupper() or cname in constructions,
            f"placeholder still present: {cname}",
        )
        break  # just spot-check the first one

    # Check run period
    rp = epjson.get("RunPeriod", {})
    check("RunPeriod exists", len(rp) > 0)
    rp_val = list(rp.values())[0] if rp else {}
    check("Full year run (Jan 1 – Dec 31)",
          rp_val.get("begin_month") == 1 and rp_val.get("end_month") == 12)

    # Check output SQLite
    check("Output:SQLite present", "Output:SQLite" in epjson)
    check("Output:Variable requests present", len(epjson.get("Output:Variable", {})) >= 8)

    # Check ideal loads HVAC
    ideal = epjson.get("HVACTemplate:Zone:IdealLoadsAirSystem", {})
    check("Ideal loads system for each zone", len(ideal) == 4, f"got {len(ideal)}")

    # Check site location was parsed
    loc = epjson.get("Site:Location", {})
    check("Site:Location present", len(loc) > 0)

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'=' * 60}")
    if checks_passed == checks_total:
        print(f"Assembler test PASSED ({checks_passed}/{checks_total} checks).")
    else:
        print(f"Assembler test FAILED ({checks_passed}/{checks_total} checks passed).")
    print("=" * 60)

    return 0 if checks_passed == checks_total else 1


if __name__ == "__main__":
    sys.exit(main())
