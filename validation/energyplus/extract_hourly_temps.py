#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Brief 82 P2 — EnergyPlus hourly zone-temperature trace extractor (Bridgewater-Box).

Reads the canonical Brief 81 P7 EnergyPlus run (validation/energyplus/runs/
bridgewater_box_v1_ep/eplusout.sql) and dumps an 8760-row hourly CSV with the
zone air temperature trace plus the supporting series the Brief 82 diagnostic
needs (outdoor drybulb, hourly ideal-loads heating/cooling demand).

NO EnergyPlus re-run is required: the Brief 81 IDF already requests
`Zone Mean Air Temperature` and `Site Outdoor Air Drybulb Temperature` at
Hourly frequency (validation/energyplus/bridgewater_box_v1.idf lines 735-738),
and the canonical SQL already holds all 8760 rows. This script is a pure,
read-only re-read of that committed run — it does not touch EnergyPlus, the
IDF, or the live NZA-Sim DB.

Output schema (identical to the NZA-Sim side, node extract.mjs --hourly-temps):
    hour_index, month, day, hour, zone_mean_air_temp_c, outdoor_drybulb_c,
    heating_demand_kwh, cooling_demand_kwh

Hour convention (EnergyPlus, hour-ending): the Time table reports Hour in 1..24
with Minute=60 / Interval=60, so row (Month=1, Day=1, Hour=1) is the mean over
00:00-01:00 on 1 January. hour_index is the 0-based ordinal hour of the year
(0 = first hour). Both CSVs use the same ordering (chronological from 1 Jan).

Energy units: EnergyPlus reports the ideal-loads sensible energies in Joules at
Hourly frequency; we convert to kWh (J / 3.6e6) so both engines' demand columns
are kWh.

Stdlib-only (sqlite3, csv, argparse, pathlib). Read-only SQLite (mode=ro).

Usage:
    python validation/energyplus/extract_hourly_temps.py
    python validation/energyplus/extract_hourly_temps.py --run-dir <dir> --stdout
"""
from __future__ import annotations

import argparse
import csv
import sqlite3
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent              # validation/energyplus
VALIDATION_DIR = SCRIPT_DIR.parent                        # validation
REPO_ROOT = VALIDATION_DIR.parent                         # repo root
DEFAULT_RUN_DIR = SCRIPT_DIR / "runs" / "bridgewater_box_v1_ep"
RESULTS_DIR = SCRIPT_DIR / "results"
DEFAULT_OUT = RESULTS_DIR / "bridgewater_box_v1_hourly_temps.csv"

J_TO_KWH = 1.0 / 3.6e6

ZONE_TEMP = "Zone Mean Air Temperature"
OUTDOOR = "Site Outdoor Air Drybulb Temperature"
HEATING = "Zone Ideal Loads Supply Air Sensible Heating Energy"
COOLING = "Zone Ideal Loads Supply Air Sensible Cooling Energy"

HEADER = [
    "hour_index", "month", "day", "hour",
    "zone_mean_air_temp_c", "outdoor_drybulb_c",
    "heating_demand_kwh", "cooling_demand_kwh",
]


def open_ro(db_path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)


def fetch_hourly(con: sqlite3.Connection, var_name: str) -> dict[int, float]:
    """{TimeIndex: Value} for one Hourly variable (single key value expected)."""
    rows = con.execute(
        """
        SELECT rd.TimeIndex, rd.Value
        FROM ReportData rd
        JOIN ReportDataDictionary rdd
          ON rd.ReportDataDictionaryIndex = rdd.ReportDataDictionaryIndex
        WHERE rdd.Name = ? AND rdd.ReportingFrequency = 'Hourly'
        """,
        (var_name,),
    ).fetchall()
    return {int(ti): v for ti, v in rows}


def fetch_calendar(con: sqlite3.Connection) -> list[tuple[int, int, int, int]]:
    """Ordered (TimeIndex, Month, Day, Hour) for the hourly Time rows used by
    the zone-temp variable (guarantees we walk the same 8760 intervals)."""
    rows = con.execute(
        """
        SELECT t.TimeIndex, t.Month, t.Day, t.Hour
        FROM ReportData rd
        JOIN ReportDataDictionary rdd
          ON rd.ReportDataDictionaryIndex = rdd.ReportDataDictionaryIndex
        JOIN Time t ON rd.TimeIndex = t.TimeIndex
        WHERE rdd.Name = ? AND rdd.ReportingFrequency = 'Hourly'
        ORDER BY t.TimeIndex
        """,
        (ZONE_TEMP,),
    ).fetchall()
    return [(int(ti), int(m), int(d), int(h)) for ti, m, d, h in rows]


def build_rows(con: sqlite3.Connection) -> list[list]:
    calendar = fetch_calendar(con)
    ztemp = fetch_hourly(con, ZONE_TEMP)
    odb = fetch_hourly(con, OUTDOOR)
    heat = fetch_hourly(con, HEATING)
    cool = fetch_hourly(con, COOLING)

    n = len(calendar)
    if n != 8760:
        sys.stderr.write(
            f"WARNING: expected 8760 hourly rows, got {n}. Proceeding.\n"
        )
    out = []
    for idx, (ti, month, day, hour) in enumerate(calendar):
        out.append([
            idx,
            month,
            day,
            hour,
            round(ztemp[ti], 4) if ti in ztemp else "",
            round(odb[ti], 4) if ti in odb else "",
            round(heat.get(ti, 0.0) * J_TO_KWH, 6),
            round(cool.get(ti, 0.0) * J_TO_KWH, 6),
        ])
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Brief 82 P2 EnergyPlus hourly zone-temp extractor")
    ap.add_argument("--run-dir", default=str(DEFAULT_RUN_DIR),
                    help="EnergyPlus run directory holding eplusout.sql")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="Output CSV path")
    ap.add_argument("--stdout", action="store_true", help="Print CSV to stdout instead of writing")
    args = ap.parse_args(argv)

    db_path = Path(args.run_dir).resolve() / "eplusout.sql"
    if not db_path.exists():
        sys.stderr.write(f"ERROR: no eplusout.sql in {args.run_dir}\n")
        return 2

    con = open_ro(db_path)
    try:
        rows = build_rows(con)
    finally:
        con.close()

    if args.stdout:
        w = csv.writer(sys.stdout)
        w.writerow(HEADER)
        w.writerows(rows)
    else:
        out_path = Path(args.out).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(HEADER)
            w.writerows(rows)
        rel = out_path.relative_to(REPO_ROOT)
        # ASCII-only console summary (Windows cp1252 console).
        temps = [r[4] for r in rows if r[4] != ""]
        mean_t = sum(temps) / len(temps) if temps else float("nan")
        print(f"[extract_hourly_temps] wrote {rel} ({len(rows)} rows)", file=sys.stderr)
        print(f"[extract_hourly_temps] EP zone mean air temp = {mean_t:.4f} C", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
