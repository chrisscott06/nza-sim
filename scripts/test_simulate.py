"""
scripts/test_simulate.py

Full integration test: assemble Bridgewater Hotel epJSON, run EnergyPlus,
parse the SQLite results, and print a formatted summary.

Run from project root:
    python3 scripts/test_simulate.py

Expected results (USA_CO_Golden weather, cavity wall standard, flat roof standard):
  GIA       ≈ 3,600 m²
  EUI       ≈ 100–400 kWh/m²  (plausible hotel range)
  Heating   > 0
  Lighting  > 0  (confirms schedules are working)
  Peak heat ≈ 30–80 W/m²
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from nza_engine.config import DEFAULT_WEATHER_DIR, SIMULATIONS_DIR
from nza_engine.generators.epjson_assembler import assemble_epjson
from nza_engine.runner import run_simulation
from nza_engine.parsers.sql_parser import (
    get_building_summary,
    get_annual_energy_by_enduse,
    get_monthly_energy_by_enduse,
    get_zone_summary,
    get_envelope_heat_flow,
)

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
SIM_DIR = SIMULATIONS_DIR / "test_bridgewater"
EPJSON_PATH = SIM_DIR / "input.epJSON"

MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def bar(value, max_value, width=30) -> str:
    if max_value <= 0:
        return ""
    filled = int(round(value / max_value * width))
    return "█" * filled + "░" * (width - filled)


def main():
    print("=" * 65)
    print("NZA Simulate — Full simulation test: Bridgewater Hotel")
    print("=" * 65)

    # ── 1. Assemble epJSON ────────────────────────────────────────────────────
    print("\n[1/3] Assembling epJSON...")
    assemble_epjson(
        building_params=BRIDGEWATER,
        construction_choices=CONSTRUCTION_CHOICES,
        weather_file_path=WEATHER_FILE,
        output_path=EPJSON_PATH,
    )
    print(f"  ✓ Written: {EPJSON_PATH}")

    # ── 2. Run simulation ─────────────────────────────────────────────────────
    print("\n[2/3] Running EnergyPlus simulation (this may take 1–2 minutes)...")
    result = run_simulation(
        epjson_path=EPJSON_PATH,
        weather_file_path=WEATHER_FILE,
        output_dir=SIM_DIR,
    )

    print(f"  Runtime     : {result.runtime_seconds:.1f} s")
    print(f"  Return code : {result.return_code}")
    print(f"  Fatal errors: {result.fatal_errors}")
    print(f"  Severe errors: {result.severe_errors}")
    print(f"  Warnings    : {result.warnings}")

    if not result.success:
        print("\n✗ SIMULATION FAILED")
        print("\n--- Error file tail ---")
        print(result.err_summary[-3000:])
        sys.exit(1)

    if not result.sql_path or not result.sql_path.exists():
        print(f"\n✗ SQLite output not found at: {result.sql_path}")
        print("  Check the .err file for clues.")
        sys.exit(1)

    print(f"  ✓ Simulation succeeded — SQL: {result.sql_path.name}")

    # ── 3. Parse results ──────────────────────────────────────────────────────
    print("\n[3/3] Parsing results...")
    sql = result.sql_path
    summary  = get_building_summary(sql)
    monthly  = get_monthly_energy_by_enduse(sql)
    zones    = get_zone_summary(sql)
    envelope = get_envelope_heat_flow(sql)

    # ── Print report ──────────────────────────────────────────────────────────
    print("\n" + "=" * 65)
    print("RESULTS SUMMARY — Bridgewater Hotel")
    print("=" * 65)

    print(f"\n{'Building'}")
    print(f"  GIA               : {summary['total_gia_m2']:,.0f} m²")
    print(f"  Volume            : {summary['total_volume_m3']:,.0f} m³")

    print(f"\n{'Annual Energy'}")
    total = summary["annual_total_kWh"]
    gia   = summary["total_gia_m2"]
    for label, key in [
        ("Heating",   "annual_heating_kWh"),
        ("Cooling",   "annual_cooling_kWh"),
        ("Lighting",  "annual_lighting_kWh"),
        ("Equipment", "annual_equipment_kWh"),
    ]:
        val  = summary[key]
        pct  = val / total * 100 if total > 0 else 0
        eui  = val / gia if gia > 0 else 0
        print(f"  {label:12s}: {val:>10,.0f} kWh  ({pct:5.1f}%)  {eui:6.1f} kWh/m²")
    print(f"  {'TOTAL':12s}: {total:>10,.0f} kWh           {summary['eui_kWh_per_m2']:6.1f} kWh/m²")

    print(f"\n{'Peak Loads'}")
    print(f"  Peak heating : {summary['peak_heating_W']:>10,.0f} W  ({summary['peak_heating_W_per_m2']:.1f} W/m²)")
    print(f"  Peak cooling : {summary['peak_cooling_W']:>10,.0f} W  ({summary['peak_cooling_W_per_m2']:.1f} W/m²)")

    print(f"\n{'Unmet Hours'}")
    print(f"  Heating : {summary['unmet_heating_hours']:.0f} h")
    print(f"  Cooling : {summary['unmet_cooling_hours']:.0f} h")

    print(f"\n{'Envelope Heat Flow'}")
    print(f"  Fabric conduction net : {envelope['fabric_conduction_kWh']:>10,.0f} kWh")
    print(f"  Infiltration loss     : {envelope['infiltration_loss_kWh']:>10,.0f} kWh")
    print(f"  Infiltration gain     : {envelope['infiltration_gain_kWh']:>10,.0f} kWh")
    print(f"  Solar gain (windows)  : {envelope['solar_gain_kWh']:>10,.0f} kWh")

    print(f"\n{'Monthly Heating & Cooling (kWh)'}")
    print(f"  {'Month':>5}  {'Heating':>10}  {'Cooling':>10}  {'Bar':}")
    max_monthly = max(
        max(monthly["heating_kWh"]),
        max(monthly["cooling_kWh"]),
        1.0,
    )
    for i, month in enumerate(MONTH_NAMES):
        h = monthly["heating_kWh"][i]
        c = monthly["cooling_kWh"][i]
        b = bar(h, max_monthly, 20) + "/" + bar(c, max_monthly, 20)
        print(f"  {month:>5}  {h:>10,.0f}  {c:>10,.0f}  {b}")

    print(f"\n{'Zone Summary'}")
    print(f"  {'Zone':15s}  {'Area':>8}  {'Heating':>12}  {'Cooling':>12}")
    for z in zones:
        print(f"  {z['zone_name']:15s}  {z['floor_area_m2']:>7.0f}m²  "
              f"{z['annual_heating_kWh']:>10,.0f}kWh  {z['annual_cooling_kWh']:>10,.0f}kWh")

    # ── Sanity checks ─────────────────────────────────────────────────────────
    print(f"\n{'Sanity Checks'}")
    checks = [
        ("GIA ≈ 3600 m²",
         2900 <= summary["total_gia_m2"] <= 4300),
        ("EUI in hotel range (50–500 kWh/m²)",
         50 <= summary["eui_kWh_per_m2"] <= 500),
        ("Heating demand > 0",
         summary["annual_heating_kWh"] > 0),
        ("Lighting > 0 (schedules working)",
         summary["annual_lighting_kWh"] > 0),
        ("Equipment > 0",
         summary["annual_equipment_kWh"] > 0),
        ("Peak heating 10–200 W/m²",
         10 <= summary["peak_heating_W_per_m2"] <= 200),
    ]
    all_ok = True
    for label, ok in checks:
        print(f"  {'✓' if ok else '✗'} {label}")
        if not ok:
            all_ok = False

    print("\n" + "=" * 65)
    if all_ok:
        print("Integration test PASSED — engine is working correctly.")
    else:
        print("Integration test FAILED — check values above.")
    print("=" * 65)

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
