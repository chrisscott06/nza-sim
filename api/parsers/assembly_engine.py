"""
api/parsers/assembly_engine.py

Gap-filling assembly engine for consumption data.
Adapted from Pablo's AssemblyEngine.js.

Takes raw parsed records (which may have gaps, missing days, partial months)
and produces a COMPLETE target year of data using a cascade of fill methods:

  1. Original data      — actual readings from the file
  2. Donor year         — same month/day/time from a different year (with scaling)
  3. Weekday average    — same day-of-week and time, same month, any year
  4. Interpolation      — linear between adjacent known values
  5. Monthly average    — last resort: average kWh for that month

Every filled slot tracks its fill_method for provenance display in the UI.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any


# ── Entry point ───────────────────────────────────────────────────────────────

def assemble_complete_year(
    records: list[dict],
    target_year: int | None = None,
    interval_minutes: int = 30,
) -> dict:
    """
    Gap-fill parsed records to produce a complete target year.

    Args:
        records:          Raw parsed records from consumption_parser.
        target_year:      Year to fill (default: majority year in records).
        interval_minutes: Interval between slots (30 for HH, 60 for hourly, 1440 for daily).

    Returns:
        {
            records:          list[dict] — complete year, no gaps
            provenance:       dict       — breakdown of fill methods
            target_year:      int
            interval_minutes: int
            total_kwh:        float
        }
    """
    # Determine interval and target year
    slots_per_day = 1440 // interval_minutes
    if interval_minutes >= 1440:
        # Daily data — treat as one slot per day
        slots_per_day = 1
        interval_minutes = 1440

    if target_year is None:
        years = [int(r["timestamp"][:4]) for r in records if r.get("timestamp")]
        target_year = max(set(years), key=years.count) if years else datetime.now().year

    # ── Build lookup: timestamp_str → kwh ─────────────────────────────────────
    # Normalise to truncated ISO string aligned to interval
    def _norm_ts(ts_str: str) -> str:
        """Truncate timestamp to interval boundary."""
        try:
            dt = datetime.fromisoformat(ts_str)
            minute = (dt.minute // interval_minutes) * interval_minutes
            return dt.replace(minute=minute, second=0, microsecond=0).isoformat()
        except Exception:
            return ts_str[:16]

    raw_lookup: dict[str, float | None] = {}
    for r in records:
        ts = r.get("timestamp")
        kwh = r.get("kwh")
        if ts:
            raw_lookup[_norm_ts(ts)] = kwh

    # ── Build donor lookups (keyed by (year, month, day, slot)) ──────────────
    # slot = slot index within the day (0 = 00:00, 1 = 00:30, ...)
    actual_data: dict[tuple, float] = {}  # (year, month, day, slot) → kwh
    year_data:   dict[tuple, list]  = defaultdict(list)  # (year, month, slot) → [kwh]

    for ts_str, kwh in raw_lookup.items():
        if kwh is None:
            continue
        try:
            dt = datetime.fromisoformat(ts_str)
        except Exception:
            continue
        slot = dt.hour * (60 // interval_minutes) + dt.minute // interval_minutes
        key = (dt.year, dt.month, dt.day, slot)
        actual_data[key] = kwh
        year_data[(dt.year, dt.month, slot)].append(kwh)

    # Weekday lookup: (weekday 0-6, month 1-12, slot) → [kwh]
    weekday_data: dict[tuple, list] = defaultdict(list)
    for (yr, mo, day, slot), kwh in actual_data.items():
        try:
            wd = datetime(yr, mo, day).weekday()
            weekday_data[(wd, mo, slot)].append(kwh)
        except Exception:
            pass

    # Monthly average lookup: (month 1-12, slot) → avg kwh
    month_avg: dict[tuple, float] = {}
    for (yr, mo, slot), values in year_data.items():
        key = (mo, slot)
        existing = month_avg.get(key, [])
        if isinstance(existing, list):
            existing.extend(values)
            month_avg[key] = existing  # type: ignore[assignment]
    month_avg_final: dict[tuple, float] = {
        k: float(sum(v)) / len(v) for k, v in month_avg.items() if isinstance(v, list) and v
    }

    # ── Scaling: for each month in target_year, compute scale vs donor ────────
    target_month_actual: dict[int, list] = defaultdict(list)
    for (yr, mo, day, slot), kwh in actual_data.items():
        if yr == target_year:
            target_month_actual[mo].append(kwh)

    def _donor_scale(month: int) -> float:
        """Ratio of target month's actual average to all-year average for that month."""
        target_vals = target_month_actual.get(month, [])
        if not target_vals:
            return 1.0
        target_avg = sum(target_vals) / len(target_vals)
        all_vals = [v for (yr, mo, sl), v in actual_data.items() if mo == month]
        if not all_vals:
            return 1.0
        all_avg = sum(all_vals) / len(all_vals)
        if all_avg == 0:
            return 1.0
        return min(max(target_avg / all_avg, 0.5), 2.0)

    scale_cache: dict[int, float] = {}

    # ── Generate all slots for the target year ────────────────────────────────
    start_dt = datetime(target_year, 1, 1, 0, 0)
    end_dt   = datetime(target_year, 12, 31, 23, 59)
    step     = timedelta(minutes=interval_minutes)

    output_records: list[dict] = []
    prov_counts = {"original": 0, "donor_year": 0, "weekday_fill": 0, "interpolated": 0, "monthly_avg": 0}

    # Build a list of all target slot datetimes
    slot_dts: list[datetime] = []
    cur = start_dt
    while cur <= end_dt:
        slot_dts.append(cur)
        cur += step

    # First pass: fill what we can without interpolation
    interim: list[dict | None] = []
    for dt in slot_dts:
        ts_str = dt.isoformat()
        norm   = _norm_ts(ts_str)
        slot   = dt.hour * (60 // interval_minutes) + dt.minute // interval_minutes
        month  = dt.month
        day    = dt.day

        # 1. Original data
        if norm in raw_lookup and raw_lookup[norm] is not None:
            interim.append({"timestamp": ts_str, "kwh": raw_lookup[norm], "quality": "actual", "fill_method": None})
            prov_counts["original"] += 1
            continue

        # 2. Donor year — try other years, closest first
        donor_found = False
        for yr_offset in [1, -1, 2, -2]:
            donor_yr = target_year + yr_offset
            donor_key = (donor_yr, month, day, slot)
            if donor_key in actual_data:
                scale = scale_cache.setdefault(month, _donor_scale(month))
                val = actual_data[donor_key] * scale
                interim.append({
                    "timestamp": ts_str,
                    "kwh": round(max(0, val), 4),
                    "quality": "filled",
                    "fill_method": f"donor-year:{donor_yr}:scaled:{round(scale, 2)}",
                })
                prov_counts["donor_year"] += 1
                donor_found = True
                break
        if donor_found:
            continue

        # 3. Weekday average
        wd = dt.weekday()
        wd_key = (wd, month, slot)
        wd_vals = weekday_data.get(wd_key, [])
        if wd_vals:
            avg = sum(wd_vals) / len(wd_vals)
            interim.append({
                "timestamp": ts_str,
                "kwh": round(max(0, avg), 4),
                "quality": "filled",
                "fill_method": f"weekday-avg:{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][wd]}:n={len(wd_vals)}",
            })
            prov_counts["weekday_fill"] += 1
            continue

        # Placeholder for interpolation pass
        interim.append(None)

    # Second pass: interpolation and monthly average fallback for None slots
    filled_records: list[dict] = []
    for i, record in enumerate(interim):
        if record is not None:
            filled_records.append(record)
            continue

        # Find nearest known values before and after
        dt   = slot_dts[i]
        slot = dt.hour * (60 // interval_minutes) + dt.minute // interval_minutes

        prev_val: float | None = None
        next_val: float | None = None
        prev_dist = next_dist = 0

        for j in range(1, min(49, len(interim))):  # look up to 48 slots (1 day) away
            if i - j >= 0 and interim[i - j] is not None:
                prev_val  = interim[i - j]["kwh"]  # type: ignore[index]
                prev_dist = j
                break
        for j in range(1, min(49, len(interim))):
            if i + j < len(interim) and interim[i + j] is not None:
                next_val  = interim[i + j]["kwh"]  # type: ignore[index]
                next_dist = j
                break

        if prev_val is not None and next_val is not None:
            # Linear interpolation
            t = prev_dist / (prev_dist + next_dist)
            val = prev_val + t * (next_val - prev_val)
            filled_records.append({
                "timestamp":   slot_dts[i].isoformat(),
                "kwh":         round(max(0, val), 4),
                "quality":     "filled",
                "fill_method": "interpolated",
            })
            prov_counts["interpolated"] += 1
        elif prev_val is not None:
            filled_records.append({
                "timestamp":   slot_dts[i].isoformat(),
                "kwh":         round(max(0, prev_val), 4),
                "quality":     "filled",
                "fill_method": "interpolated",
            })
            prov_counts["interpolated"] += 1
        else:
            # Monthly average last resort
            ma = month_avg_final.get((dt.month, slot), 0.0)
            filled_records.append({
                "timestamp":   slot_dts[i].isoformat(),
                "kwh":         round(max(0, ma), 4),
                "quality":     "filled",
                "fill_method": "monthly-avg",
            })
            prov_counts["monthly_avg"] += 1

    total = len(filled_records)
    total_kwh = sum(r["kwh"] or 0 for r in filled_records)

    provenance = {
        "original":     prov_counts["original"],
        "donor_year":   prov_counts["donor_year"],
        "weekday_fill": prov_counts["weekday_fill"],
        "interpolated": prov_counts["interpolated"],
        "monthly_avg":  prov_counts["monthly_avg"],
        "total":        total,
        "coverage_pct": round(prov_counts["original"] / max(1, total) * 100, 1),
    }

    return {
        "records":          filled_records,
        "provenance":       provenance,
        "target_year":      target_year,
        "interval_minutes": interval_minutes,
        "total_kwh":        round(total_kwh, 1),
    }
