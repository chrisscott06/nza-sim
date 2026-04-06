"""
scripts/setup_weather.py

Unpack and organise PROMETHEUS future weather files into the NZA Simulate
weather directory structure.

Usage
-----
  python scripts/setup_weather.py [--source data/weather/prometheus]

The script looks for PROMETHEUS zip archives (downloaded from CIBSE/PROMETHEUS)
and unpacks them into:

  data/weather/
  ├── current/        ← control (present-day) EPW files
  └── future/
      ├── 2030_medium/
      ├── 2030_high/
      ├── 2050_medium/
      ├── 2050_high/
      ├── 2080_medium/
      └── 2080_high/

PROMETHEUS zip structure (typical):
  Bristol.zip
  └── Bristol/
      ├── Bristol_control.zip        → current TRY + DSY
      ├── Bristol_2030_a1b_med.zip   → 2030 medium scenario
      ├── Bristol_2030_a1b_high.zip  → 2030 high scenario
      ├── Bristol_2050_a1b_med.zip
      ├── Bristol_2050_a1b_high.zip
      ├── Bristol_2080_a1b_med.zip
      └── Bristol_2080_a1b_high.zip

Run from the project root:
  python scripts/setup_weather.py

Or specify a different source directory:
  python scripts/setup_weather.py --source /path/to/prometheus/downloads
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
import zipfile
from pathlib import Path

# ── Resolve project root relative to this script ──────────────────────────────
SCRIPT_DIR   = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR     = PROJECT_ROOT / "data"
WEATHER_DIR  = DATA_DIR / "weather"
CURRENT_DIR  = WEATHER_DIR / "current"
FUTURE_DIR   = WEATHER_DIR / "future"

# Default source directory — where the downloaded PROMETHEUS zips live
DEFAULT_SOURCE = WEATHER_DIR  # also check data/weather/29812739/ if present


# ── Scenario classification ────────────────────────────────────────────────────

def classify_zip_name(name: str) -> tuple[str | None, str | None]:
    """
    Classify a PROMETHEUS inner zip by name.

    Returns (period, scenario):
      'control' → (None, None)   → goes to current/
      '2030_med' → ('2030', 'medium')
      '2050_high' → ('2050', 'high')
    """
    name_lower = name.lower()
    if "control" in name_lower or "cntr" in name_lower:
        return None, None  # current climate

    m = re.search(r'(\d{4})', name_lower)
    period = m.group(1) if m else None

    if any(x in name_lower for x in ("high", "rcp85", "90th", "90_perc")):
        scenario = "high"
    elif any(x in name_lower for x in ("med", "a1b", "50th", "50_perc")):
        scenario = "medium"
    else:
        scenario = "medium"  # default to medium if ambiguous

    return period, scenario


def target_dir(period: str | None, scenario: str | None) -> Path:
    """Return the target directory for an EPW based on period and scenario."""
    if period is None:
        return CURRENT_DIR
    label = f"{period}_{scenario}" if scenario else period
    return FUTURE_DIR / label


# ── Core unpacking logic ───────────────────────────────────────────────────────

def unpack_inner_zip(inner_zip: Path, dest_dir: Path, verbose: bool = True) -> int:
    """Extract all .epw files from inner_zip into dest_dir."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(inner_zip, "r") as z:
        for name in z.namelist():
            if name.lower().endswith(".epw"):
                out_path = dest_dir / Path(name).name
                if out_path.exists():
                    if verbose:
                        print(f"  [skip] {out_path.name} already exists")
                    continue
                with z.open(name) as src, open(out_path, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                if verbose:
                    print(f"  [copy] {out_path.name} → {dest_dir.relative_to(PROJECT_ROOT)}")
                count += 1
    return count


def process_city_zip(city_zip: Path, tmp_dir: Path, verbose: bool = True) -> int:
    """
    Unpack a top-level city zip (e.g. Bristol.zip).

    Each city zip may contain:
      - EPW files directly
      - Inner zips (one per scenario)
    """
    total = 0
    with zipfile.ZipFile(city_zip, "r") as z:
        names = z.namelist()

        # Check for inner zips
        inner_zips = [n for n in names if n.lower().endswith(".zip")]
        epws_direct = [n for n in names if n.lower().endswith(".epw")]

        if inner_zips:
            # Extract inner zips to a temp directory, then process each
            z.extractall(tmp_dir)
            for inner_name in inner_zips:
                inner_path = tmp_dir / inner_name
                if not inner_path.exists():
                    # May be nested inside a subdirectory
                    candidates = list(tmp_dir.rglob(Path(inner_name).name))
                    if candidates:
                        inner_path = candidates[0]
                    else:
                        continue

                period, scenario = classify_zip_name(inner_path.stem)
                dest = target_dir(period, scenario)
                if verbose:
                    print(f"  Processing {inner_path.name} → {dest.relative_to(PROJECT_ROOT)}")
                try:
                    count = unpack_inner_zip(inner_path, dest, verbose=verbose)
                    total += count
                except zipfile.BadZipFile:
                    print(f"  [warn] {inner_path.name} is not a valid zip — skipping")

        elif epws_direct:
            # Top-level zip contains EPW files directly
            for epw_name in epws_direct:
                stem = Path(epw_name).stem
                period, scenario = classify_zip_name(stem)
                dest = target_dir(period, scenario)
                dest.mkdir(parents=True, exist_ok=True)
                out_path = dest / Path(epw_name).name
                if out_path.exists():
                    if verbose:
                        print(f"  [skip] {out_path.name} already exists")
                    continue
                with z.open(epw_name) as src, open(out_path, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                if verbose:
                    print(f"  [copy] {out_path.name} → {dest.relative_to(PROJECT_ROOT)}")
                total += 1

    return total


def find_source_zips(source_dirs: list[Path]) -> list[Path]:
    """Find all city-level zip files in the source directories."""
    found = []
    for d in source_dirs:
        if d.exists():
            found.extend(sorted(d.glob("*.zip")))
            # Also check one level deep (e.g. data/weather/29812739/)
            for sub in d.iterdir():
                if sub.is_dir():
                    found.extend(sorted(sub.glob("*.zip")))
    return found


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Unpack PROMETHEUS weather files.")
    parser.add_argument(
        "--source",
        default=None,
        help="Directory containing PROMETHEUS zip files (default: data/weather/ and subdirectories)",
    )
    parser.add_argument("--quiet", action="store_true", help="Suppress per-file output")
    args = parser.parse_args()

    verbose = not args.quiet

    # Determine source directories
    source_dirs = []
    if args.source:
        source_dirs = [Path(args.source)]
    else:
        source_dirs = [WEATHER_DIR]
        # Check for Zenodo-style numeric subdirectory (e.g. data/weather/29812739/)
        for child in WEATHER_DIR.iterdir() if WEATHER_DIR.exists() else []:
            if child.is_dir() and child.name.isdigit():
                source_dirs.append(child)

    source_zips = find_source_zips(source_dirs)

    if not source_zips:
        print(f"No zip files found in: {', '.join(str(d) for d in source_dirs)}")
        print("Download PROMETHEUS weather files from https://www.prometheus-climate.org/")
        print("and place the zip files in data/weather/ or a subdirectory.")
        sys.exit(0)

    print(f"Found {len(source_zips)} zip file(s) to process:")
    for z in source_zips:
        print(f"  {z}")
    print()

    # Temporary extraction directory
    tmp_dir = WEATHER_DIR / "_tmp_extract"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    total_files = 0
    try:
        for zip_path in source_zips:
            print(f"Processing: {zip_path.name}")
            try:
                count = process_city_zip(zip_path, tmp_dir, verbose=verbose)
                total_files += count
                print(f"  → {count} EPW file(s) extracted")
            except zipfile.BadZipFile:
                print(f"  [error] Not a valid zip file: {zip_path.name}")
            except Exception as exc:
                print(f"  [error] {exc}")
            print()
    finally:
        # Clean up temp directory
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir, ignore_errors=True)

    print(f"Done. {total_files} EPW file(s) organised into:")
    for d in [CURRENT_DIR, FUTURE_DIR]:
        if d.exists():
            epws = list(d.rglob("*.epw"))
            if epws:
                print(f"  {d.relative_to(PROJECT_ROOT)}/  ({len(epws)} files)")

    print()
    print("Restart the backend to pick up the new weather files:")
    print("  python -m uvicorn api.main:app --host 127.0.0.1 --port 8002")


if __name__ == "__main__":
    main()
