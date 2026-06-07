#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Brief 83 P4 - EnergyPlus hourly MVHR heat-flow extractor (Bridgewater-Box).

Reads the canonical Brief 81 P7 EnergyPlus run (validation/energyplus/runs/
bridgewater_box_v1_ep/eplusout.sql) - re-run in Brief 83 P4 with the additional
hourly Output:Variable lines for the ideal-loads outdoor-air load and heat-
recovery contribution - and dumps an 8760-row CSV of the per-hour MVHR heat
flows for the NZA-vs-EnergyPlus mech-vent booking comparison (Finding B).

Output schema (parallel to the NZA side, node extract.mjs --mvhr-hourly):
    hour_index, month, day, hour, outdoor_drybulb_c, zone_mean_air_temp_c,
    oa_sensible_heating_kwh, oa_sensible_cooling_kwh,
    heat_recovery_heating_kwh, heat_recovery_cooling_kwh,
    net_mech_vent_heating_kwh, net_mech_vent_cooling_kwh,
    supply_air_heating_kwh, supply_air_cooling_kwh

net_mech_vent_*  = oa_sensible_* - heat_recovery_*  (the Brief 81 net mech-vent
loss convention: EP's coil OA load minus the heat-recovery contribution).

Hour convention (EnergyPlus, hour-ending) and units (J -> kWh) identical to the
Brief 82 extractor. Stdlib-only; read-only SQLite (mode=ro).

Usage:
    python validation/energyplus/extract_mvhr_hourly.py
    python validation/energyplus/extract_mvhr_hourly.py --run-dir <dir> --stdout
"""
from __future__ import annotations

import argparse
import csv
import sqlite3
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
VALIDATION_DIR = SCRIPT_DIR.parent
REPO_ROOT = VALIDATION_DIR.parent
DEFAULT_RUN_DIR = SCRIPT_DIR / "runs" / "bridgewater_box_v1_ep"
RESULTS_DIR = SCRIPT_DIR / "results"
DEFAULT_OUT = RESULTS_DIR / "bridgewater_box_v1_mvhr_hourly.csv"

J_TO_KWH = 1.0 / 3.6e6

ZONE_TEMP = "Zone Mean Air Temperature"
OUTDOOR = "Site Outdoor Air Drybulb Temperature"
OA_HEAT = "Zone Ideal Loads Outdoor Air Sensible Heating Energy"
OA_COOL = "Zone Ideal Loads Outdoor Air Sensible Cooling Energy"
HR_HEAT = "Zone Ideal Loads Heat Recovery Sensible Heating Energy"
HR_COOL = "Zone Ideal Loads Heat Recovery Sensible Cooling Energy"
SUP_HEAT = "Zone Ideal Loads Supply Air Sensible Heating Energy"
SUP_COOL = "Zone Ideal Loads Supply Air Sensible Cooling Energy"

HEADER = [
    "hour_index", "month", "day", "hour",
    "outdoor_drybulb_c", "zone_mean_air_temp_c",
    "oa_sensible_heating_kwh", "oa_sensible_cooling_kwh",
    "heat_recovery_heating_kwh", "heat_recovery_cooling_kwh",
    "net_mech_vent_heating_kwh", "net_mech_vent_cooling_kwh",
    "supply_air_heating_kwh", "supply_air_cooling_kwh",
]


def open_ro(db_path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)


def fetch_hourly(con: sqlite3.Connection, var_name: str) -> dict[int, float]:
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
    oa_h = fetch_hourly(con, OA_HEAT)
    oa_c = fetch_hourly(con, OA_COOL)
    hr_h = fetch_hourly(con, HR_HEAT)
    hr_c = fetch_hourly(con, HR_COOL)
    sup_h = fetch_hourly(con, SUP_HEAT)
    sup_c = fetch_hourly(con, SUP_COOL)

    for name, series in (("OA heating", oa_h), ("heat recovery heating", hr_h)):
        if not series:
            sys.stderr.write(
                f"ERROR: hourly '{name}' is empty - did the IDF re-run add the "
                f"Brief 83 P4 hourly Output:Variable lines? STOP.\n"
            )
            raise SystemExit(3)

    n = len(calendar)
    if n != 8760:
        sys.stderr.write(f"WARNING: expected 8760 hourly rows, got {n}. Proceeding.\n")

    out = []
    for idx, (ti, month, day, hour) in enumerate(calendar):
        oah = oa_h.get(ti, 0.0) * J_TO_KWH
        oac = oa_c.get(ti, 0.0) * J_TO_KWH
        hrh = hr_h.get(ti, 0.0) * J_TO_KWH
        hrc = hr_c.get(ti, 0.0) * J_TO_KWH
        out.append([
            idx, month, day, hour,
            round(odb[ti], 4) if ti in odb else "",
            round(ztemp[ti], 4) if ti in ztemp else "",
            round(oah, 6), round(oac, 6),
            round(hrh, 6), round(hrc, 6),
            round(oah - hrh, 6), round(oac - hrc, 6),
            round(sup_h.get(ti, 0.0) * J_TO_KWH, 6),
            round(sup_c.get(ti, 0.0) * J_TO_KWH, 6),
        ])
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Brief 83 P4 EnergyPlus hourly MVHR heat-flow extractor")
    ap.add_argument("--run-dir", default=str(DEFAULT_RUN_DIR))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--stdout", action="store_true")
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
        net_h = sum(r[10] for r in rows)
        net_c = sum(r[11] for r in rows)
        oa_h_sum = sum(r[6] for r in rows)
        hr_h_sum = sum(r[8] for r in rows)
        print(f"[extract_mvhr_hourly] wrote {rel} ({len(rows)} rows)", file=sys.stderr)
        print(f"[extract_mvhr_hourly] EP net mech-vent heating = {net_h/1000:.4f} MWh, "
              f"cooling = {net_c/1000:.4f} MWh", file=sys.stderr)
        print(f"[extract_mvhr_hourly] EP OA heating {oa_h_sum/1000:.4f} - recovery "
              f"{hr_h_sum/1000:.4f} MWh (annual recovery ratio {hr_h_sum/oa_h_sum:.3f})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
