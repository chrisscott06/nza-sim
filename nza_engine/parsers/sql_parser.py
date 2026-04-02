"""
nza_engine/parsers/sql_parser.py

Queries the EnergyPlus SQLite output database and returns structured results.

EnergyPlus writes simulation results to an SQLite database (eplusout.sql).
Key tables:
  - ReportDataDictionary — maps DataDictionaryIndex to variable names/zone keys
  - ReportData            — timestep/hourly values indexed by time and variable
  - Time                  — maps TimeIndex to date/time and interval duration
  - Zones                 — zone metadata (floor area, volume)
  - TabularDataWithStrings — EnergyPlus summary table data

All energy values are returned in kWh.
Power values are returned in Watts (converted from J/interval using Time.Interval).

Notes on KeyValue:
  EnergyPlus uses component names as KeyValues, not zone names. For
  ZoneHVAC:IdealLoadsAirSystem objects, the KeyValue is the component name
  (e.g. "FLOOR_1_IDEALLOADS"). Zone-level energy is recovered by matching
  KeyValue prefixes against zone names.
"""

import sqlite3
from pathlib import Path
from typing import Any

J_TO_KWH = 1.0 / 3_600_000.0


def _connect(sql_path: str | Path) -> sqlite3.Connection:
    sql_path = Path(sql_path)
    if not sql_path.exists():
        raise FileNotFoundError(f"SQLite output not found: {sql_path}")
    conn = sqlite3.connect(sql_path)
    conn.row_factory = sqlite3.Row
    return conn


def _query(conn: sqlite3.Connection, sql: str, params=()) -> list[sqlite3.Row]:
    return conn.execute(sql, params).fetchall()


def _get_indices(conn: sqlite3.Connection, variable_name: str) -> list[int]:
    """Return all ReportDataDictionaryIndex values for a given variable name."""
    rows = _query(
        conn,
        "SELECT ReportDataDictionaryIndex FROM ReportDataDictionary "
        "WHERE Name = ? COLLATE NOCASE",
        (variable_name,),
    )
    return [r[0] for r in rows]


def _sum_annual(conn: sqlite3.Connection, variable_name: str) -> float:
    """Sum all report data for a variable over the full year. Returns kWh."""
    indices = _get_indices(conn, variable_name)
    if not indices:
        return 0.0
    ph = ",".join("?" for _ in indices)
    rows = _query(
        conn,
        f"SELECT SUM(Value) FROM ReportData WHERE ReportDataDictionaryIndex IN ({ph})",
        indices,
    )
    return (rows[0][0] or 0.0) * J_TO_KWH


def _monthly_sums(conn: sqlite3.Connection, variable_name: str) -> list[float]:
    """Return 12 monthly energy sums in kWh for a given variable."""
    indices = _get_indices(conn, variable_name)
    if not indices:
        return [0.0] * 12
    ph = ",".join("?" for _ in indices)
    rows = _query(
        conn,
        f"""
        SELECT t.Month, SUM(rd.Value) AS MonthlyTotal
        FROM ReportData rd
        JOIN Time t ON rd.TimeIndex = t.TimeIndex
        WHERE rd.ReportDataDictionaryIndex IN ({ph})
        GROUP BY t.Month
        ORDER BY t.Month
        """,
        indices,
    )
    monthly = [0.0] * 12
    for row in rows:
        m = (row["Month"] or 1) - 1
        if 0 <= m < 12:
            monthly[m] = (row["MonthlyTotal"] or 0.0) * J_TO_KWH
    return monthly


def _get_reporting_interval_s(conn: sqlite3.Connection) -> float:
    """
    Return the reporting interval in seconds from the Time table.
    EnergyPlus stores Interval in minutes.
    """
    rows = _query(conn, "SELECT Interval FROM Time WHERE Interval IS NOT NULL LIMIT 1")
    if rows:
        interval_min = rows[0]["Interval"] or 60
        return float(interval_min) * 60.0
    return 3600.0  # default hourly


def _get_coincident_peak_W(conn: sqlite3.Connection, variable_name: str) -> float:
    """
    Return the peak coincident building power in Watts for a given energy variable.

    Sums all zone values at each timestep to get total building energy, finds
    the maximum, then converts from J/interval to Watts.
    """
    indices = _get_indices(conn, variable_name)
    if not indices:
        return 0.0

    interval_s = _get_reporting_interval_s(conn)
    ph = ",".join("?" for _ in indices)

    rows = _query(
        conn,
        f"""
        SELECT SUM(rd.Value) AS TotalJ
        FROM ReportData rd
        WHERE rd.ReportDataDictionaryIndex IN ({ph})
        GROUP BY rd.TimeIndex
        ORDER BY TotalJ DESC
        LIMIT 1
        """,
        indices,
    )
    peak_j_per_interval = rows[0]["TotalJ"] or 0.0
    return peak_j_per_interval / interval_s


def _get_zones_info(conn: sqlite3.Connection) -> list[dict]:
    """Return zone floor areas and volumes from the Zones table."""
    try:
        rows = _query(conn, "SELECT ZoneName, FloorArea, Volume FROM Zones")
        return [
            {
                "name": r["ZoneName"],
                "floor_area_m2": r["FloorArea"] or 0.0,
                "volume_m3": r["Volume"] or 0.0,
            }
            for r in rows
        ]
    except Exception:
        return []


def _get_zone_energy_by_variable(
    conn: sqlite3.Connection,
    variable_name: str,
    zone_names: list[str],
) -> dict[str, float]:
    """
    Return per-zone annual energy in kWh for a given variable.

    EnergyPlus uses component names (e.g. "FLOOR_1_IDEALLOADS") as KeyValues,
    not bare zone names. This function matches KeyValues by prefix.
    """
    # Build index → zone_name map
    rows = _query(
        conn,
        "SELECT ReportDataDictionaryIndex, KeyValue FROM ReportDataDictionary "
        "WHERE Name = ? COLLATE NOCASE",
        (variable_name,),
    )

    # Match each KeyValue to a zone name (KeyValue starts with zone name)
    idx_to_zone: dict[int, str] = {}
    zone_upper = {z.upper(): z for z in zone_names}

    for row in rows:
        kv = (row["KeyValue"] or "").upper()
        for z_upper, z_orig in zone_upper.items():
            if kv == z_upper or kv.startswith(z_upper + "_"):
                idx_to_zone[row["ReportDataDictionaryIndex"]] = z_orig
                break

    if not idx_to_zone:
        return {z: 0.0 for z in zone_names}

    result = {z: 0.0 for z in zone_names}
    for idx, zone_name in idx_to_zone.items():
        rows2 = _query(
            conn,
            "SELECT SUM(Value) FROM ReportData WHERE ReportDataDictionaryIndex = ?",
            (idx,),
        )
        val_j = rows2[0][0] or 0.0
        result[zone_name] = result.get(zone_name, 0.0) + val_j * J_TO_KWH

    return result


def _get_unmet_hours(conn: sqlite3.Connection) -> dict[str, float]:
    """Read unmet hours from EnergyPlus tabular summary tables."""
    for table_name in ["Time Setpoint Not Met", "TimeSetpointNotMet"]:
        try:
            rows = _query(
                conn,
                """
                SELECT RowName, Value
                FROM TabularDataWithStrings
                WHERE TableName = ? COLLATE NOCASE
                """,
                (table_name,),
            )
            if rows:
                heating = cooling = 0.0
                for r in rows:
                    rname = (r["RowName"] or "").lower()
                    try:
                        val = float(r["Value"] or 0)
                    except (ValueError, TypeError):
                        continue
                    if "heat" in rname:
                        heating += val
                    elif "cool" in rname:
                        cooling += val
                return {
                    "unmet_heating_hours": heating,
                    "unmet_cooling_hours": cooling,
                }
        except Exception:
            pass
    return {"unmet_heating_hours": 0.0, "unmet_cooling_hours": 0.0}


# ── Public API ────────────────────────────────────────────────────────────────

def get_annual_energy_by_enduse(sql_path: str | Path) -> dict[str, float]:
    """Return annual energy by end use in kWh."""
    conn = _connect(sql_path)
    try:
        heating   = _sum_annual(conn, "Zone Ideal Loads Supply Air Total Heating Energy")
        cooling   = _sum_annual(conn, "Zone Ideal Loads Supply Air Total Cooling Energy")
        lighting  = _sum_annual(conn, "Zone Lights Electricity Energy")
        equipment = _sum_annual(conn, "Zone Electric Equipment Electricity Energy")
        return {
            "heating_kWh":   round(heating,   1),
            "cooling_kWh":   round(cooling,   1),
            "lighting_kWh":  round(lighting,  1),
            "equipment_kWh": round(equipment, 1),
            "total_kWh":     round(heating + cooling + lighting + equipment, 1),
        }
    finally:
        conn.close()


def get_monthly_energy_by_enduse(sql_path: str | Path) -> dict[str, list[float]]:
    """Return monthly energy breakdown in kWh (12 values per end use)."""
    conn = _connect(sql_path)
    try:
        return {
            "heating_kWh":   _monthly_sums(conn, "Zone Ideal Loads Supply Air Total Heating Energy"),
            "cooling_kWh":   _monthly_sums(conn, "Zone Ideal Loads Supply Air Total Cooling Energy"),
            "lighting_kWh":  _monthly_sums(conn, "Zone Lights Electricity Energy"),
            "equipment_kWh": _monthly_sums(conn, "Zone Electric Equipment Electricity Energy"),
        }
    finally:
        conn.close()


def get_zone_summary(sql_path: str | Path) -> list[dict]:
    """Return per-zone floor area, volume, and annual heating/cooling in kWh."""
    conn = _connect(sql_path)
    try:
        zones_info = _get_zones_info(conn)
        zone_names = [z["name"] for z in zones_info]

        heat_by_zone = _get_zone_energy_by_variable(
            conn, "Zone Ideal Loads Supply Air Total Heating Energy", zone_names
        )
        cool_by_zone = _get_zone_energy_by_variable(
            conn, "Zone Ideal Loads Supply Air Total Cooling Energy", zone_names
        )

        return [
            {
                "zone_name": z["name"],
                "floor_area_m2": z["floor_area_m2"],
                "volume_m3": z["volume_m3"],
                "annual_heating_kWh": round(heat_by_zone.get(z["name"], 0.0), 1),
                "annual_cooling_kWh": round(cool_by_zone.get(z["name"], 0.0), 1),
            }
            for z in zones_info
        ]
    finally:
        conn.close()


def get_building_summary(sql_path: str | Path) -> dict[str, Any]:
    """
    Return a comprehensive building-level summary from simulation results.

    Returns
    -------
    dict with keys:
        total_gia_m2, total_volume_m3,
        annual_heating_kWh, annual_cooling_kWh,
        annual_lighting_kWh, annual_equipment_kWh, annual_total_kWh,
        eui_kWh_per_m2,
        peak_heating_W, peak_cooling_W,
        peak_heating_W_per_m2, peak_cooling_W_per_m2,
        unmet_heating_hours, unmet_cooling_hours
    """
    conn = _connect(sql_path)
    try:
        zones_info  = _get_zones_info(conn)
        total_gia   = sum(z["floor_area_m2"] for z in zones_info)
        total_vol   = sum(z["volume_m3"]     for z in zones_info)

        heating   = _sum_annual(conn, "Zone Ideal Loads Supply Air Total Heating Energy")
        cooling   = _sum_annual(conn, "Zone Ideal Loads Supply Air Total Cooling Energy")
        lighting  = _sum_annual(conn, "Zone Lights Electricity Energy")
        equipment = _sum_annual(conn, "Zone Electric Equipment Electricity Energy")
        total     = heating + cooling + lighting + equipment

        eui = total / total_gia if total_gia > 0 else 0.0

        # Coincident peak loads (sum all zones at each timestep, return max)
        peak_heat_W = _get_coincident_peak_W(
            conn, "Zone Ideal Loads Supply Air Total Heating Energy"
        )
        peak_cool_W = _get_coincident_peak_W(
            conn, "Zone Ideal Loads Supply Air Total Cooling Energy"
        )

        unmet = _get_unmet_hours(conn)

        return {
            "total_gia_m2":           round(total_gia,   1),
            "total_volume_m3":        round(total_vol,   1),
            "annual_heating_kWh":     round(heating,     1),
            "annual_cooling_kWh":     round(cooling,     1),
            "annual_lighting_kWh":    round(lighting,    1),
            "annual_equipment_kWh":   round(equipment,   1),
            "annual_total_kWh":       round(total,       1),
            "eui_kWh_per_m2":         round(eui,         1),
            "peak_heating_W":         round(peak_heat_W, 0),
            "peak_cooling_W":         round(peak_cool_W, 0),
            "peak_heating_W_per_m2":  round(peak_heat_W / total_gia, 1) if total_gia else 0.0,
            "peak_cooling_W_per_m2":  round(peak_cool_W / total_gia, 1) if total_gia else 0.0,
            "unmet_heating_hours":    unmet["unmet_heating_hours"],
            "unmet_cooling_hours":    unmet["unmet_cooling_hours"],
        }
    finally:
        conn.close()


def get_envelope_heat_flow(sql_path: str | Path) -> dict[str, float]:
    """
    Return annual heat flow through envelope components in kWh.
    Used to feed the Sankey diagram.
    """
    conn = _connect(sql_path)
    try:
        infil_loss = _sum_annual(conn, "Zone Infiltration Sensible Heat Loss Energy")
        infil_gain = _sum_annual(conn, "Zone Infiltration Sensible Heat Gain Energy")

        # Solar radiation — try both rate and energy variable names
        solar = _sum_annual(conn, "Zone Windows Total Transmitted Solar Radiation Rate")
        if solar == 0.0:
            solar = _sum_annual(conn, "Zone Windows Total Transmitted Solar Radiation Energy")

        fabric = _sum_annual(conn, "Surface Inside Face Conduction Heat Transfer Energy")

        return {
            "fabric_conduction_kWh":  round(fabric,     1),
            "infiltration_loss_kWh":  round(infil_loss, 1),
            "infiltration_gain_kWh":  round(infil_gain, 1),
            "solar_gain_kWh":         round(solar,      1),
        }
    finally:
        conn.close()
