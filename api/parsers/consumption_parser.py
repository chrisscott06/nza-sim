"""
api/parsers/consumption_parser.py

Auto-detecting CSV/Excel parser for half-hourly and monthly consumption data.
Adapted from Pablo's ParserEngine.js — ported to Python using pandas.

Supported formats:
  Wide format:  Date column + 48 time columns (00:00, 00:30, ..., 23:30). One row per day.
  Long format:  Timestamp column + value column. One row per interval.
  Monthly:      Date/month column + single kWh column (for gas bills etc.)

Auto-detection:
  1. Score column headers for date, energy, and time patterns
  2. Wide format detected if 10+ columns matching HH time slots found
  3. Long format detected if timestamp + value columns found
  4. Monthly format detected if < 6 columns and date-like + numeric column

Fuel type detection (from filename):
  electricity → filename contains: elec, electric, mpan, import
  gas         → filename contains: gas, mprn
  unknown     → everything else (user can override in UI)
"""

from __future__ import annotations

import io
import re
from datetime import datetime, date, timedelta
from typing import Any

import pandas as pd
import numpy as np


# ── Meta-sheet detection (Excel multi-sheet files) ────────────────────────────

def _is_meta_sheet(name: str, df: pd.DataFrame) -> bool:
    """Detect instruction/meta sheets that don't contain consumption data."""
    meta_keywords = ['instruct', 'readme', 'info', 'meta', 'notes', 'help', 'about', 'template']
    if any(k in name.lower() for k in meta_keywords):
        return True
    if len(df) < 5:
        return True
    # Check if first 10 rows have fewer than 3 numeric values
    sample = df.head(10)
    numeric_count = sum(
        1 for col in sample.columns
        for val in sample[col]
        if isinstance(val, (int, float)) and not pd.isna(val)
    )
    return numeric_count < 3


# ── Fuel type detection ────────────────────────────────────────────────────────

def _detect_fuel(filename: str, columns: list[str]) -> str:
    fn = filename.lower()
    if any(k in fn for k in ("elec", "electric", "mpan", "import")):
        return "electricity"
    if any(k in fn for k in ("gas", "mprn")):
        return "gas"
    # Check columns
    col_text = " ".join(str(c).lower() for c in columns)
    if "gas" in col_text or "mprn" in col_text:
        return "gas"
    return "electricity"  # default for unlabelled


# ── Date parsing helpers ───────────────────────────────────────────────────────

_DATE_FMTS = ["%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y", "%d/%m/%y", "%Y/%m/%d"]

def _parse_date(val: Any) -> date | None:
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    if isinstance(val, (datetime, pd.Timestamp)):
        return val.date()
    if isinstance(val, date):
        return val
    # Excel serial date number
    if isinstance(val, (int, float)):
        try:
            return (datetime(1899, 12, 30) + timedelta(days=int(val))).date()
        except Exception:
            return None
    s = str(val).strip()
    for fmt in _DATE_FMTS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _parse_ts(val: Any) -> datetime | None:
    """Parse a timestamp value (string or datetime)."""
    if val is None:
        return None
    if isinstance(val, (datetime, pd.Timestamp)):
        return pd.Timestamp(val).to_pydatetime()
    s = str(val).strip()
    # Try pandas flexible parser
    try:
        return pd.to_datetime(s, dayfirst=True).to_pydatetime()
    except Exception:
        return None


# ── Column scoring ─────────────────────────────────────────────────────────────

_TIME_PATTERN = re.compile(r"^\d{1,2}:\d{2}$")   # "00:00" … "23:30"


def _score_columns(df: pd.DataFrame) -> dict:
    """Return best guesses for date_col, value_col, timestamp_col."""
    cols = list(df.columns)
    date_scores:  dict[str, int] = {}
    value_scores: dict[str, int] = {}
    ts_scores:    dict[str, int] = {}

    date_keywords  = ["date", "day", "period", "month"]
    value_keywords = ["kwh", "energy", "consumption", "import", "usage", "value"]
    ts_keywords    = ["timestamp", "datetime", "time", "halfhour", "interval"]

    # High-confidence patterns (worth extra points)
    ts_high_patterns    = ["interval start", "datetime", "timestamp"]
    energy_high_patterns = ["import from grid", "import kwh", "total kwh"]

    for col in cols:
        col_l = str(col).lower()
        ds  = sum(2 for k in date_keywords  if k in col_l)
        vs  = sum(2 for k in value_keywords if k in col_l)
        tss = sum(2 for k in ts_keywords    if k in col_l)

        # Boost high-confidence patterns
        for pattern in ts_high_patterns:
            if pattern in col_l:
                tss += 10
        for pattern in energy_high_patterns:
            if pattern in col_l:
                vs += 10
        if "kwh" in col_l:
            vs += 5
        if "import" in col_l and "kwh" in col_l:
            vs += 8

        # Sample up to 10 non-null values to infer type
        sample = df[col].dropna().head(10)
        for val in sample:
            if isinstance(val, (date, datetime, pd.Timestamp)):
                ds += 1
                tss += 1
            if isinstance(val, (int, float)) and not np.isnan(float(val)):
                vs += 0.5
            s = str(val)
            if re.match(r"\d{1,2}/\d{1,2}/\d{2,4}", s) or re.match(r"\d{4}-\d{2}-\d{2}", s):
                ds += 2
            if re.match(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}", s):
                tss += 3

        date_scores[col]  = ds
        value_scores[col] = vs
        ts_scores[col]    = tss

    date_col  = max(date_scores,  key=date_scores.get)  if date_scores  else None
    value_col = max(value_scores, key=value_scores.get) if value_scores else None
    ts_col    = max(ts_scores,    key=ts_scores.get)    if ts_scores    else None

    return {"date_col": date_col, "value_col": value_col, "ts_col": ts_col}


# ── Wide format parser ─────────────────────────────────────────────────────────

def _parse_wide(df: pd.DataFrame, date_col: str, time_cols: list[str]) -> list[dict]:
    """One row per day, 48 HH time columns → flat records."""
    records = []
    for _, row in df.iterrows():
        d = _parse_date(row[date_col])
        if d is None:
            continue
        for tc in time_cols:
            try:
                kwh = float(row[tc])
            except (TypeError, ValueError):
                kwh = None
            h, m = map(int, tc.split(":"))
            # EPW-style: "00:00" = midnight slot → 00:00–00:30
            ts = datetime(d.year, d.month, d.day, h, m)
            records.append({
                "timestamp": ts.isoformat(),
                "kwh":       kwh,
                "quality":   "actual" if kwh is not None else "missing",
            })
    return records


# ── Long format parser ─────────────────────────────────────────────────────────

def _parse_long(df: pd.DataFrame, ts_col: str, value_col: str) -> tuple[list[dict], int]:
    """Timestamp + value rows → flat records. Returns (records, interval_minutes)."""
    records = []
    timestamps = []
    for _, row in df.iterrows():
        ts = _parse_ts(row[ts_col])
        if ts is None:
            continue
        try:
            kwh = float(row[value_col])
        except (TypeError, ValueError):
            kwh = None
        records.append({
            "timestamp": ts.isoformat(),
            "kwh":       kwh,
            "quality":   "actual" if kwh is not None else "missing",
        })
        timestamps.append(ts)

    # Infer interval from median gap
    interval_minutes = 30
    if len(timestamps) > 2:
        timestamps.sort()
        gaps = [(timestamps[i+1] - timestamps[i]).seconds // 60 for i in range(min(20, len(timestamps)-1))]
        gaps = [g for g in gaps if 0 < g <= 120]
        if gaps:
            interval_minutes = int(sorted(gaps)[len(gaps)//2])  # median

    return records, interval_minutes


# ── Monthly format parser ──────────────────────────────────────────────────────

def _parse_monthly(df: pd.DataFrame, date_col: str, value_col: str) -> list[dict]:
    """Monthly billing data → explode to daily records (distribute evenly)."""
    records = []
    for _, row in df.iterrows():
        raw = row[date_col]
        d = _parse_date(raw)
        if d is None:
            # Try just year-month string
            try:
                d = datetime.strptime(str(raw).strip()[:7], "%Y-%m").date().replace(day=1)
            except Exception:
                continue
        try:
            total_kwh = float(row[value_col])
        except (TypeError, ValueError):
            continue

        # Days in month
        if d.month == 12:
            days_in_month = 31
        else:
            days_in_month = (date(d.year, d.month + 1, 1) - date(d.year, d.month, 1)).days
        daily_kwh = total_kwh / days_in_month

        for day_offset in range(days_in_month):
            day_date = date(d.year, d.month, 1) + timedelta(days=day_offset)
            ts = datetime(day_date.year, day_date.month, day_date.day, 0, 0)
            records.append({
                "timestamp": ts.isoformat(),
                "kwh":       round(daily_kwh, 4),
                "quality":   "estimated",  # monthly distributed to daily
            })
    return records


# ── Main parser entry point ────────────────────────────────────────────────────

def parse_consumption_file(file_bytes: bytes, filename: str) -> dict:
    """
    Parse CSV/Excel consumption data → normalised records.

    Returns:
        {
            records: list of {timestamp, kwh, quality},
            fuel_type: str,
            interval_minutes: int,
            target_year: int | None,
            format_detected: str,  # 'wide', 'long', 'monthly'
        }
    """
    fn_lower = filename.lower()

    # Load into DataFrame
    try:
        if fn_lower.endswith((".xlsx", ".xls")):
            xls = pd.ExcelFile(io.BytesIO(file_bytes))
            df = None
            for sheet_name in xls.sheet_names:
                candidate = pd.read_excel(xls, sheet_name=sheet_name, header=0)
                if not _is_meta_sheet(sheet_name, candidate):
                    df = candidate
                    break
            if df is None:
                raise ValueError("No data sheets found in Excel file")
        else:
            # Try comma first, then tab, then semicolon
            for sep in (",", "\t", ";"):
                try:
                    df = pd.read_csv(io.BytesIO(file_bytes), sep=sep, header=0)
                    if len(df.columns) > 1:
                        break
                except Exception:
                    continue
    except Exception as exc:
        raise ValueError(f"Could not read file: {exc}") from exc

    # Strip whitespace from column names
    df.columns = [str(c).strip() for c in df.columns]
    df = df.dropna(how="all")

    fuel_type = _detect_fuel(filename, list(df.columns))

    # Detect wide format: find HH time columns
    time_cols = [c for c in df.columns if _TIME_PATTERN.match(str(c))]

    scores = _score_columns(df)

    if len(time_cols) >= 10:
        # Wide format
        date_col  = scores["date_col"] or df.columns[0]
        records   = _parse_wide(df, date_col, time_cols)
        interval  = 30
        fmt       = "wide"
    elif scores["ts_col"] and scores["value_col"]:
        # Long format (timestamp + value).
        # ts_col may equal date_col when a single column contains full datetime
        # strings — that is still valid long format if the values have time components.
        ts_col_candidate = scores["ts_col"]
        col_sample = df[ts_col_candidate].dropna().head(5).astype(str)
        has_time = any(re.search(r"\d{2}:\d{2}", v) for v in col_sample)

        if has_time or scores["ts_col"] != scores["date_col"]:
            records, interval = _parse_long(df, ts_col_candidate, scores["value_col"])
            fmt = "long"
        elif scores["value_col"] and scores["date_col"]:
            # Monthly billing format (small number of columns, dates only)
            records  = _parse_monthly(df, scores["date_col"], scores["value_col"])
            interval = 1440  # daily
            fmt      = "monthly"
        else:
            raise ValueError(f"Could not detect data format. Headers: {list(df.columns)[:10]}")
    elif scores["value_col"] and scores["date_col"]:
        # Monthly billing format (small number of columns)
        records  = _parse_monthly(df, scores["date_col"], scores["value_col"])
        interval = 1440  # daily
        fmt      = "monthly"
    else:
        raise ValueError(
            f"Could not detect data format. Headers: {list(df.columns)[:10]}"
        )

    if not records:
        raise ValueError("No records parsed from file")

    # Determine target year from majority year in data
    years = []
    for r in records:
        try:
            years.append(int(r["timestamp"][:4]))
        except Exception:
            pass
    target_year = max(set(years), key=years.count) if years else None

    return {
        "records":          records,
        "fuel_type":        fuel_type,
        "interval_minutes": interval,
        "target_year":      target_year,
        "format_detected":  fmt,
    }
