"""
scripts/test_energyplus.py

Confirms EnergyPlus is installed and can run a simulation.

Run from project root:
    python scripts/test_energyplus.py

Expected outcome:
  - EnergyPlus exits with return code 0
  - Output directory contains .sql, .csv, .htm, .err files
  - The .err file reports zero fatal errors
"""

import subprocess
import sys
from pathlib import Path

# Add project root to path so nza_engine is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from nza_engine.config import (
    ENERGYPLUS_BIN,
    DEFAULT_WEATHER_DIR,
    SIMULATIONS_DIR,
)

# ── Paths ──────────────────────────────────────────────────────────────────────
EXAMPLE_FILES_DIR = ENERGYPLUS_BIN.parent / "ExampleFiles"
TEST_IDF = EXAMPLE_FILES_DIR / "1ZoneUncontrolled.idf"
TEST_WEATHER = DEFAULT_WEATHER_DIR / "USA_CO_Golden-NREL.724666_TMY3.epw"
OUTPUT_DIR = SIMULATIONS_DIR / "test_connection"


def main():
    print("=" * 60)
    print("NZA Simulate — EnergyPlus connection test")
    print("=" * 60)

    # ── Pre-flight checks ──────────────────────────────────────────────────────
    print(f"\nEnergyPlus binary : {ENERGYPLUS_BIN}")
    print(f"Example IDF       : {TEST_IDF}")
    print(f"Weather file      : {TEST_WEATHER}")
    print(f"Output directory  : {OUTPUT_DIR}")

    for label, path in [
        ("EnergyPlus binary", ENERGYPLUS_BIN),
        ("Example IDF", TEST_IDF),
        ("Weather file", TEST_WEATHER),
    ]:
        if not path.exists():
            print(f"\n✗ MISSING: {label} not found at {path}")
            sys.exit(1)
        print(f"  ✓ {label} found")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # ── Run EnergyPlus ─────────────────────────────────────────────────────────
    cmd = [
        str(ENERGYPLUS_BIN),
        "-w", str(TEST_WEATHER),
        "-d", str(OUTPUT_DIR),
        str(TEST_IDF),
    ]

    print(f"\nRunning: {' '.join(cmd)}\n")

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
    )

    # ── Return code ────────────────────────────────────────────────────────────
    if result.returncode == 0:
        print(f"✓ EnergyPlus exited with return code 0 (success)")
    else:
        print(f"✗ EnergyPlus exited with return code {result.returncode}")
        print("\n--- stdout ---")
        print(result.stdout[-3000:] if len(result.stdout) > 3000 else result.stdout)
        print("\n--- stderr ---")
        print(result.stderr[-2000:] if len(result.stderr) > 2000 else result.stderr)
        sys.exit(1)

    # ── Output files ───────────────────────────────────────────────────────────
    print("\nOutput files produced:")
    output_files = sorted(OUTPUT_DIR.iterdir())
    for f in output_files:
        size_kb = f.stat().st_size / 1024
        print(f"  {f.name:50s}  {size_kb:8.1f} KB")

    key_extensions = {".sql", ".csv", ".htm", ".err"}
    found_extensions = {f.suffix.lower() for f in output_files}
    missing = key_extensions - found_extensions
    if missing:
        print(f"\n⚠ Expected output files not found: {missing}")
    else:
        print(f"\n✓ All key output file types present: {key_extensions}")

    # ── Error file check ───────────────────────────────────────────────────────
    err_files = [f for f in output_files if f.suffix.lower() == ".err"]
    if not err_files:
        print("⚠ No .err file found — cannot check for fatal errors")
    else:
        err_text = err_files[0].read_text(errors="replace")
        fatal_count = err_text.lower().count("** fatal")
        severe_count = err_text.lower().count("** severe")
        warning_count = err_text.lower().count("** warning")

        print(f"\n.err file summary ({err_files[0].name}):")
        print(f"  Fatal errors  : {fatal_count}")
        print(f"  Severe errors : {severe_count}")
        print(f"  Warnings      : {warning_count}")

        if fatal_count > 0:
            print("\n✗ FATAL ERRORS detected — simulation is invalid")
            sys.exit(1)
        else:
            print("\n✓ No fatal errors — simulation completed successfully")

    print("\n" + "=" * 60)
    print("Connection test PASSED — EnergyPlus is working correctly.")
    print("=" * 60)


if __name__ == "__main__":
    main()
