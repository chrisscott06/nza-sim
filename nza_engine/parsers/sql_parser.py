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
from __future__ import annotations

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

def _detect_hvac_mode(conn: sqlite3.Connection) -> str:
    """
    Detect whether the simulation used ideal loads or detailed HVAC.

    Returns 'ideal_loads' or 'detailed'.
    Heuristic: if 'Zone Ideal Loads Supply Air Total Heating Energy' is in
    the ReportDataDictionary, the simulation used IdealLoads.
    """
    rows = _query(
        conn,
        "SELECT ReportDataDictionaryIndex FROM ReportDataDictionary "
        "WHERE Name = 'Zone Ideal Loads Supply Air Total Heating Energy' LIMIT 1"
    )
    return "ideal_loads" if rows else "detailed"


def get_annual_energy_by_enduse(sql_path: str | Path) -> dict[str, float]:
    """
    Return annual energy by end use in kWh.

    Mode-aware: detects whether the simulation used IdealLoads or detailed HVAC
    (VRF, etc.) and reads the appropriate variables/meters.

    For ideal loads:
      - heating/cooling = zone thermal demand (Zone Ideal Loads variables)
      - total = thermal demand + lighting + equipment
    For detailed HVAC:
      - heating_kWh   = Heating:EnergyTransfer (thermal energy delivered to zones)
      - cooling_kWh   = Cooling:EnergyTransfer (thermal energy removed from zones)
      - fans_kWh      = Fans:Electricity
      - hvac_elec_kWh = Heating:Electricity + Cooling:Electricity + Fans:Electricity
      - total_kWh     = Electricity:Facility (all site electricity incl. lighting, equip, HVAC)
    """
    conn = _connect(sql_path)
    try:
        mode     = _detect_hvac_mode(conn)
        lighting  = _sum_annual(conn, "Zone Lights Electricity Energy")
        equipment = _sum_annual(conn, "Zone Electric Equipment Electricity Energy")

        if mode == "ideal_loads":
            heating = _sum_annual(conn, "Zone Ideal Loads Supply Air Total Heating Energy")
            cooling = _sum_annual(conn, "Zone Ideal Loads Supply Air Total Cooling Energy")
            fans    = 0.0
            total   = heating + cooling + lighting + equipment
            return {
                "hvac_mode":     "ideal_loads",
                "heating_kWh":   round(heating,   1),
                "cooling_kWh":   round(cooling,   1),
                "fans_kWh":      0.0,
                "lighting_kWh":  round(lighting,  1),
                "equipment_kWh": round(equipment, 1),
                "total_kWh":     round(total,     1),
            }
        else:
            # Detailed HVAC (VRF etc.): read from meters
            # EnergyTransfer = thermal demand (useful for reporting building demand)
            heating_et  = _sum_annual(conn, "Heating:EnergyTransfer")
            cooling_et  = _sum_annual(conn, "Cooling:EnergyTransfer")
            # Electricity meters = actual site consumption
            heating_el  = _sum_annual(conn, "Heating:Electricity")
            cooling_el  = _sum_annual(conn, "Cooling:Electricity")
            fans        = _sum_annual(conn, "Fans:Electricity")
            # Electricity:Facility = all electricity including lighting + equipment + HVAC
            total_elec  = _sum_annual(conn, "Electricity:Facility")
            # Gas (for future DHW gas boiler support)
            gas_el      = _sum_annual(conn, "NaturalGas:Facility")
            total       = total_elec + gas_el
            return {
                "hvac_mode":             "detailed",
                "heating_kWh":           round(heating_et,  1),   # thermal demand
                "cooling_kWh":           round(cooling_et,  1),   # thermal demand
                "heating_electricity_kWh": round(heating_el, 1),  # actual site elec
                "cooling_electricity_kWh": round(cooling_el, 1),
                "fans_kWh":              round(fans,        1),
                "lighting_kWh":          round(lighting,    1),
                "equipment_kWh":         round(equipment,   1),
                "electricity_kWh":       round(total_elec,  1),
                "gas_kWh":               round(gas_el,      1),
                "total_kWh":             round(total,       1),
            }
    finally:
        conn.close()


def get_monthly_energy_by_enduse(sql_path: str | Path) -> dict[str, list[float]]:
    """
    Return monthly energy breakdown in kWh (12 values per end use).
    Mode-aware: uses IdealLoads variables or meters depending on simulation mode.
    """
    conn = _connect(sql_path)
    try:
        mode = _detect_hvac_mode(conn)
        if mode == "ideal_loads":
            return {
                "heating_kWh":   _monthly_sums(conn, "Zone Ideal Loads Supply Air Total Heating Energy"),
                "cooling_kWh":   _monthly_sums(conn, "Zone Ideal Loads Supply Air Total Cooling Energy"),
                "lighting_kWh":  _monthly_sums(conn, "Zone Lights Electricity Energy"),
                "equipment_kWh": _monthly_sums(conn, "Zone Electric Equipment Electricity Energy"),
            }
        else:
            return {
                "heating_kWh":   _monthly_sums(conn, "Heating:EnergyTransfer"),
                "cooling_kWh":   _monthly_sums(conn, "Cooling:EnergyTransfer"),
                "fans_kWh":      _monthly_sums(conn, "Fans:Electricity"),
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
        mode       = _detect_hvac_mode(conn)

        if mode == "ideal_loads":
            heat_var = "Zone Ideal Loads Supply Air Total Heating Energy"
            cool_var = "Zone Ideal Loads Supply Air Total Cooling Energy"
        else:
            # For VRF: use coil energy variables if available, otherwise meters
            heat_var = "Zone VRF Heat Pump Heating Energy"
            cool_var = "Zone VRF Heat Pump Cooling Energy"

        heat_by_zone = _get_zone_energy_by_variable(conn, heat_var, zone_names)
        cool_by_zone = _get_zone_energy_by_variable(conn, cool_var, zone_names)

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

        mode      = _detect_hvac_mode(conn)
        lighting  = _sum_annual(conn, "Zone Lights Electricity Energy")
        equipment = _sum_annual(conn, "Zone Electric Equipment Electricity Energy")

        if mode == "ideal_loads":
            heating = _sum_annual(conn, "Zone Ideal Loads Supply Air Total Heating Energy")
            cooling = _sum_annual(conn, "Zone Ideal Loads Supply Air Total Cooling Energy")
            total   = heating + cooling + lighting + equipment
            peak_heat_W = _get_coincident_peak_W(
                conn, "Zone Ideal Loads Supply Air Total Heating Energy"
            )
            peak_cool_W = _get_coincident_peak_W(
                conn, "Zone Ideal Loads Supply Air Total Cooling Energy"
            )
        else:
            # Detailed mode: report thermal demand for heating/cooling display,
            # but use total site electricity for EUI
            heating     = _sum_annual(conn, "Heating:EnergyTransfer")
            cooling     = _sum_annual(conn, "Cooling:EnergyTransfer")
            total_elec  = _sum_annual(conn, "Electricity:Facility")
            gas         = _sum_annual(conn, "NaturalGas:Facility")
            total       = total_elec + gas
            # Peak from the EnergyTransfer meters (represents peak zone demand)
            peak_heat_W = _get_coincident_peak_W(conn, "Heating:EnergyTransfer")
            peak_cool_W = _get_coincident_peak_W(conn, "Cooling:EnergyTransfer")

        eui = total / total_gia if total_gia > 0 else 0.0

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


def get_energy_by_fuel(sql_path: str | Path) -> dict:
    """
    Return annual energy consumption split by fuel type.

    For ideal_loads mode: all energy is treated as electricity (no real system).
    For detailed mode: electricity and gas are read from Facility meters.

    Returns
    -------
    dict with keys:
      electricity_kwh       — total site electricity (kWh)
      natural_gas_kwh       — total natural gas (kWh)
      total_kwh             — electricity + gas
      electricity_fraction  — share of total (0-1)
      gas_fraction          — share of total (0-1)
    """
    conn = _connect(sql_path)
    try:
        mode = _detect_hvac_mode(conn)
        if mode == "ideal_loads":
            # Ideal loads — no real fuel split; total is thermal + lighting + equip
            heating  = _sum_annual(conn, "Zone Ideal Loads Supply Air Total Heating Energy")
            cooling  = _sum_annual(conn, "Zone Ideal Loads Supply Air Total Cooling Energy")
            lighting = _sum_annual(conn, "Zone Lights Electricity Energy")
            equip    = _sum_annual(conn, "Zone Electric Equipment Electricity Energy")
            total    = heating + cooling + lighting + equip
            elec, gas = total, 0.0
        else:
            elec = _sum_annual(conn, "Electricity:Facility")
            gas  = _sum_annual(conn, "NaturalGas:Facility")
            total = elec + gas
        total = max(total, 0.001)  # avoid division by zero
        return {
            "electricity_kwh":      round(elec,           1),
            "natural_gas_kwh":      round(gas,            1),
            "total_kwh":            round(elec + gas,     1),
            "electricity_fraction": round(elec / total,   4),
            "gas_fraction":         round(gas  / total,   4),
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

        # Solar gains — surface-level variable works with SimpleGlazingSystem in EP 25.2
        # Zone-level "Zone Windows Total Transmitted Solar Radiation Energy" is not generated
        # by SimpleGlazingSystem; "Surface Window Transmitted Solar Radiation Energy" is.
        solar = _sum_annual(conn, "Surface Window Transmitted Solar Radiation Energy")
        if solar == 0.0:
            # Fallback to zone-level (may work with detailed glazing in future)
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


def get_hourly_profiles(sql_path) -> dict:
    """
    Return full 8760-hour load profiles from the simulation.

    Returns dict with keys: hours, months, days, hours_of_day,
    heating_kWh, cooling_kWh, lighting_kWh, equipment_kWh, solar_kWh.
    Each is a list of 8760 values.
    """
    conn = _connect(sql_path)
    try:
        def _get_hourly_series(var_name):
            indices = _get_indices(conn, var_name)
            if not indices:
                return {}
            ph = ",".join("?" for _ in indices)
            rows = _query(
                conn,
                f"""
                SELECT TimeIndex, SUM(Value) AS TotalJ
                FROM ReportData
                WHERE ReportDataDictionaryIndex IN ({ph})
                GROUP BY TimeIndex
                """,
                indices,
            )
            return {r["TimeIndex"]: (r["TotalJ"] or 0.0) * J_TO_KWH for r in rows}

        heating   = _get_hourly_series("Zone Ideal Loads Supply Air Total Heating Energy")
        cooling   = _get_hourly_series("Zone Ideal Loads Supply Air Total Cooling Energy")
        lighting  = _get_hourly_series("Zone Lights Electricity Energy")
        equipment = _get_hourly_series("Zone Electric Equipment Electricity Energy")
        solar     = _get_hourly_series("Surface Window Transmitted Solar Radiation Energy")
        # New end uses (may return empty dict if not available in this model)
        dhw       = _get_hourly_series("Zone Hot Water Equipment Electricity Energy")
        fan       = _get_hourly_series("Fan Electricity Energy")
        vent_loss = _get_hourly_series("Zone Ventilation Sensible Heat Loss Energy")
        infil_loss = _get_hourly_series("Zone Infiltration Sensible Heat Loss Energy")

        time_rows = _query(conn, "SELECT TimeIndex, Month, Day, Hour FROM Time ORDER BY TimeIndex")

        hours_of_year, months, days, hours_of_day = [], [], [], []
        h_vals, c_vals, l_vals, e_vals, s_vals = [], [], [], [], []
        dhw_vals, fan_vals, vent_vals = [], [], []

        for i, tr in enumerate(time_rows):
            ti = tr["TimeIndex"]
            hours_of_year.append(i)
            months.append(tr["Month"] or 1)
            days.append(tr["Day"] or 1)
            hours_of_day.append((tr["Hour"] or 1) - 1)  # EP Hour is 1-24 → 0-23
            h_vals.append(round(heating.get(ti, 0.0), 4))
            c_vals.append(round(cooling.get(ti, 0.0), 4))
            l_vals.append(round(lighting.get(ti, 0.0), 4))
            e_vals.append(round(equipment.get(ti, 0.0), 4))
            s_vals.append(round(solar.get(ti, 0.0), 4))
            dhw_vals.append(round(dhw.get(ti, 0.0), 4))
            fan_vals.append(round(fan.get(ti, 0.0), 4))
            # Ventilation loss: sum of mechanical vent loss + infiltration loss
            vl = vent_loss.get(ti, 0.0) + infil_loss.get(ti, 0.0)
            vent_vals.append(round(vl, 4))

        return {
            "hours":         hours_of_year,
            "months":        months,
            "days":          days,
            "hours_of_day":  hours_of_day,
            "heating_kWh":   h_vals,
            "cooling_kWh":   c_vals,
            "lighting_kWh":  l_vals,
            "equipment_kWh": e_vals,
            "solar_kWh":     s_vals,
            "dhw_kWh":       dhw_vals,
            "fan_kWh":       fan_vals,
            "vent_loss_kWh": vent_vals,
        }
    finally:
        conn.close()


def get_typical_day_profiles(sql_path) -> dict:
    """
    Extract representative 24-hour profiles for 4 day types:
    peak_heating, peak_cooling, typical_winter, typical_summer.

    Each profile is a dict with 24-value lists per end use.
    """
    from collections import defaultdict

    hourly = get_hourly_profiles(sql_path)
    n = len(hourly["hours"])
    KEYS = ("heating_kWh", "cooling_kWh", "lighting_kWh", "equipment_kWh", "solar_kWh",
            "dhw_kWh", "fan_kWh", "vent_loss_kWh")

    if n == 0:
        empty = {k: [0.0] * 24 for k in KEYS}
        return {t: {"label": t, **empty} for t in ("peak_heating", "peak_cooling", "typical_winter", "typical_summer")}

    # Group hours by (month, day)
    day_data: dict = defaultdict(lambda: defaultdict(dict))
    for i in range(n):
        md = (hourly["months"][i], hourly["days"][i])
        hod = hourly["hours_of_day"][i]
        day_data[md][hod] = {k: hourly[k][i] for k in KEYS}

    def _day_profile(md):
        hmap = day_data[md]
        return {k: [hmap.get(h, {}).get(k, 0.0) for h in range(24)] for k in KEYS}

    def _avg_profiles(mds):
        if not mds:
            return {k: [0.0] * 24 for k in KEYS}
        sums = {k: [0.0] * 24 for k in KEYS}
        for md in mds:
            prof = _day_profile(md)
            for k in KEYS:
                for h in range(24):
                    sums[k][h] += prof[k][h]
        nd = len(mds)
        return {k: [round(v / nd, 4) for v in sums[k]] for k in KEYS}

    day_heat_totals = {md: sum(day_data[md].get(h, {}).get("heating_kWh", 0.0) for h in range(24)) for md in day_data}
    day_cool_totals = {md: sum(day_data[md].get(h, {}).get("cooling_kWh", 0.0) for h in range(24)) for md in day_data}

    peak_heat_day = max(day_heat_totals, key=day_heat_totals.get)
    peak_cool_day = max(day_cool_totals, key=day_cool_totals.get)
    winter_days = [md for md in day_data if md[0] in (12, 1, 2)]
    summer_days = [md for md in day_data if md[0] in (6, 7, 8)]

    return {
        "peak_heating":   {"label": f"Peak Heating Day", "month": peak_heat_day[0], "day": peak_heat_day[1], **_day_profile(peak_heat_day)},
        "peak_cooling":   {"label": f"Peak Cooling Day",  "month": peak_cool_day[0], "day": peak_cool_day[1], **_day_profile(peak_cool_day)},
        "typical_winter": {"label": "Typical Winter Day (Dec-Feb avg)", **_avg_profiles(winter_days)},
        "typical_summer": {"label": "Typical Summer Day (Jun-Aug avg)", **_avg_profiles(summer_days)},
    }


def _read_epw_temperatures(weather_file_path: str | Path) -> list[float]:
    """
    Read 8760 hourly outdoor dry-bulb temperatures from an EnergyPlus EPW file.
    Returns an empty list if the file can't be read.

    EPW format: 8 header lines, then 8760 data rows (one per hour).
    Comma-separated; field index 6 (0-indexed) = Dry Bulb Temperature in °C.
    """
    p = Path(weather_file_path)
    if not p.exists() or not p.is_file():
        return []
    temps: list[float] = []
    try:
        with open(p, "r", encoding="latin-1") as f:
            for _ in range(8):
                f.readline()
            for line in f:
                parts = line.strip().split(",")
                if len(parts) > 6:
                    try:
                        temps.append(float(parts[6]))
                    except ValueError:
                        pass
    except Exception:
        return []
    return temps


def _read_epw_wind_temp(weather_file_path: str | Path) -> tuple[list[float], list[int]]:
    """
    Read hourly wind speed (m/s, EPW field 21) and month index from an EPW.
    Returns (wind_speed, month_idx_0_based). Empty lists on failure.
    """
    p = Path(weather_file_path)
    if not p.exists() or not p.is_file():
        return ([], [])
    wind: list[float] = []
    months: list[int] = []
    try:
        with open(p, "r", encoding="latin-1") as f:
            for _ in range(8):
                f.readline()
            for line in f:
                parts = line.strip().split(",")
                if len(parts) > 21:
                    try:
                        months.append(int(parts[1]) - 1)
                        wind.append(float(parts[21]))
                    except (ValueError, IndexError):
                        pass
    except Exception:
        return ([], [])
    return (wind, months)


def _attribute_openings_share(
    total_vent_loss_kwh: float,
    weather_file_path: str | Path | None,
    building_config: dict | None,
) -> tuple[float, float, float]:
    """
    Split the EP-reported total ZoneVentilation:Sensible Heat Loss Energy into
    three streams: (louvre_kwh, window_kwh, mech_kwh).

    EnergyPlus emits a single per-zone aggregate covering mechanical
    ventilation AND every ZoneVentilation:WindandStackOpenArea object — there
    are no per-object outputs. We attribute the lump by **design flow ratio**:

        Q_louvre  ≈ Cd · A_louvre  · √Cw · v_design
        Q_window  ≈ Cd · A_window  · √Cw · v_design  · sched_fraction
        Q_mech    ≈ 8 L/s · N_people

    The shares sum to 1, so each stream's kwh = share × total_vent_loss.
    Honest about being a split estimate, not a per-object measurement.
    """
    if total_vent_loss_kwh <= 0 or not building_config:
        return (0.0, 0.0, total_vent_loss_kwh)
    openings = building_config.get("openings") or {}
    if not openings:
        return (0.0, 0.0, total_vent_loss_kwh)

    Cd = 0.6
    Cw = {"sheltered": 0.05, "normal": 0.10, "exposed": 0.20}.get(
        openings.get("site_exposure", "normal"), 0.10
    )
    sqrt_Cw = Cw ** 0.5

    # Design wind speed: annual mean from the EPW (matches what EP integrates)
    if weather_file_path:
        wind, _ = _read_epw_wind_temp(weather_file_path)
        v_design = (sum(wind) / len(wind)) if wind else 4.0
    else:
        v_design = 4.0  # conservative UK default

    faces = ("north", "south", "east", "west")
    louvre_total = sum(
        float((openings.get(f) or {}).get("louvre_area_m2", 0) or 0) for f in faces
    )

    length = float(building_config.get("length", 60))
    width = float(building_config.get("width", 15))
    floor_height = float(building_config.get("floor_height", 3))
    num_floors = float(building_config.get("num_floors", 1))
    wwr = building_config.get("wwr") or {}
    facade_area = {
        "north": length * floor_height * num_floors,
        "south": length * floor_height * num_floors,
        "east":  width  * floor_height * num_floors,
        "west":  width  * floor_height * num_floors,
    }
    openable_total = sum(
        float((openings.get(f) or {}).get("openable_fraction", 0) or 0)
        * float(wwr.get(f, 0) or 0)
        * facade_area[f]
        for f in faces
    )

    # Schedule-fraction multiplier on the openable-window flow
    sched = openings.get("schedule", "never")
    sched_frac = {
        "always":     1.0,
        "occupied":   16 / 24,           # ~07:00-23:00 in the live calc
        "summer_day": (5 / 12) * (12 / 24),
        "never":      0.0,
    }.get(sched, 0.0)

    # Mechanical ventilation flow (8 L/s/person, fixed)
    num_bedrooms = float(building_config.get("num_bedrooms", 0) or 0)
    occ_rate = float(building_config.get("occupancy_rate", 0.75) or 0.75)
    people_per_room = float(building_config.get("people_per_room", 1.5) or 1.5)
    n_people = num_bedrooms * occ_rate * people_per_room
    Q_mech = 0.008 * n_people  # m³/s

    # Time-averaged design flows for attribution
    Q_louvre = Cd * louvre_total * sqrt_Cw * v_design
    Q_window = Cd * openable_total * sqrt_Cw * v_design * sched_frac

    Q_sum = Q_louvre + Q_window + Q_mech
    if Q_sum <= 0:
        return (0.0, 0.0, total_vent_loss_kwh)

    louvre_kwh = total_vent_loss_kwh * (Q_louvre / Q_sum)
    window_kwh = total_vent_loss_kwh * (Q_window / Q_sum)
    mech_kwh   = total_vent_loss_kwh * (Q_mech   / Q_sum)
    return (louvre_kwh, window_kwh, mech_kwh)


def _hdd_cdd(temps: list[float], heat_base_C: float = 18.0, cool_base_C: float = 22.0) -> tuple[float, float]:
    """
    Compute heating- and cooling-degree-days from an hourly temperature series.
    Hour-degrees / 24 → degree-days. Returns (HDD, CDD) in K·days.
    """
    if not temps:
        return (0.0, 0.0)
    hdh = sum(max(0.0, heat_base_C - t) for t in temps)
    cdh = sum(max(0.0, t - cool_base_C) for t in temps)
    return (round(hdh / 24.0, 1), round(cdh / 24.0, 1))


def _building_areas(building_config: dict | None) -> dict:
    """
    Compute fabric areas from building_config.
    Returns {gia_m2, external_wall_m2, roof_m2, ground_floor_m2, glazing_m2_by_facade}.
    """
    bc = building_config or {}
    L  = float(bc.get("length", 0) or 0)
    W  = float(bc.get("width", 0) or 0)
    nf = float(bc.get("num_floors", 0) or 0)
    fh = float(bc.get("floor_height", 0) or 0)
    wwr = bc.get("wwr") or {}

    perim_height = nf * fh
    # Per-facade gross wall length (north/south faces are length L; east/west are width W)
    face_lengths = {"north": L, "south": L, "east": W, "west": W}
    glazing = {}
    wall_net = {}
    for face, fl in face_lengths.items():
        gross = fl * perim_height
        ratio = float(wwr.get(face, 0) or 0)
        glazing[face]   = round(gross * ratio, 1)
        wall_net[face]  = round(gross * (1 - ratio), 1)

    return {
        "gia_m2":            round(L * W * nf, 1),
        "external_wall_m2":  round(sum(wall_net.values()), 1),
        "external_wall_by_face_m2": wall_net,
        "roof_m2":           round(L * W, 1),
        "ground_floor_m2":   round(L * W, 1),
        "glazing_by_face_m2": glazing,
        "glazing_total_m2":  round(sum(glazing.values()), 1),
    }


def get_heat_balance(
    sql_path: str | Path,
    building_config: dict | None = None,
    weather_file_path: str | Path | None = None,
    mode: str = "full",
    comfort_band: dict | None = None,
    library_data: dict | None = None,
) -> dict:
    """
    Return a balanced view of all annual heat flows from a simulation run.

    `mode` follows the state contract:
      - "full"         → State 3 / detailed model (default; existing behaviour)
      - "envelope-only"→ State 1 path. Reads hourly zone temperatures from the
                         free-running EP run, derives heating/cooling demand
                         against the comfort band using the same lumped-
                         capacitance formula as the live engine
                         (`_calculateEnvelopeOnly` in instantCalc.js), and
                         returns the State 1 output shape per docs/state_contracts.md.

    For State 1, EP is run with extreme setpoints (`-60` / `+100`) so the
    Ideal Loads system never injects energy. The reported `Zone Mean Air
    Temperature` is therefore the free-running response of the building
    fabric to weather and (in State 1, suppressed) gains. Demand is computed
    post-hoc — it must NOT be read from EP's heating/cooling output meters,
    which correctly report zero with wide setpoints.

    Output shape (consumed by the frontend HeatBalance component):

      {
        "annual": {
          "losses": {
            "external_wall":  {kwh, kwh_per_m2, area_m2, by_face},
            "roof":           {kwh, kwh_per_m2, area_m2},
            "ground_floor":   {kwh, kwh_per_m2, area_m2},
            "glazing":        {kwh, kwh_per_m2, area_m2},   # transmission only
            "infiltration":   {kwh, kwh_per_m2, ach},
            "ventilation":    {kwh, kwh_per_m2},
            "cooling":        {kwh, kwh_per_m2},
          },
          "gains": {
            "solar":          {north, east, south, west — each {kwh, kwh_per_m2, area_m2}, total},
            "internal":       {people, equipment, lighting — each {kwh, kwh_per_m2}, total},
            "heating":        {kwh, kwh_per_m2},
          },
          "totals": { losses_kwh_per_m2, gains_kwh_per_m2, net_kwh_per_m2 },
        },
        "metadata": { gia_m2, hdd_18C, cdd_22C, weather_file },
      }

    All values in kWh (annual) or kWh/m²·a.
    """
    if mode == "envelope-only":
        return _get_heat_balance_state1(
            sql_path,
            building_config=building_config,
            weather_file_path=weather_file_path,
            comfort_band=comfort_band,
            library_data=library_data,
        )
    if mode == "envelope-gains":
        return _get_heat_balance_state2(
            sql_path,
            building_config=building_config,
            weather_file_path=weather_file_path,
            comfort_band=comfort_band,
            library_data=library_data,
        )
    conn = _connect(sql_path)
    try:
        # ── Reuse existing detailed envelope parser for fabric ────────────────
        env = get_envelope_heat_flow_detailed(sql_path)

        # ── Areas from building config (authoritative) ────────────────────────
        areas = _building_areas(building_config)
        gia = max(areas["gia_m2"], 1.0)  # avoid div by 0

        # ── Fabric losses per element ─────────────────────────────────────────
        wall_loss_total = sum(env["walls"][f]["annual_heat_loss_kWh"] for f in env["walls"])
        wall_loss_by_face = {f: round(env["walls"][f]["annual_heat_loss_kWh"], 1) for f in env["walls"]}

        # Glazing transmission losses come from the detailed envelope parser
        # (now reads window conduction per Brief 21 fix in get_envelope_heat_flow_detailed)
        glazing_loss = sum(env["glazing"][f]["annual_heat_loss_kWh"] for f in env["glazing"])

        # ── Internal gains ────────────────────────────────────────────────────
        people_kwh    = _sum_annual(conn, "Zone People Total Heating Energy")
        # Fall back to electricity * 1.0 if heat-energy variant is missing
        equip_heat    = _sum_annual(conn, "Zone Electric Equipment Total Heating Energy")
        if equip_heat == 0.0:
            equip_heat = _sum_annual(conn, "Zone Electric Equipment Electricity Energy")
        light_heat    = _sum_annual(conn, "Zone Lights Total Heating Energy")
        if light_heat == 0.0:
            light_heat = _sum_annual(conn, "Zone Lights Electricity Energy")

        # ── Heating / cooling delivered to zone ───────────────────────────────
        eu = get_annual_energy_by_enduse(sql_path)
        heating_kwh = float(eu.get("heating_kWh") or 0.0)
        cooling_kwh = float(eu.get("cooling_kWh") or 0.0)

        # ── Ventilation losses ────────────────────────────────────────────────
        # Detailed mode reports Zone Ventilation Sensible Heat Loss Energy.
        # Ideal Loads bundles ventilation into the heating/cooling demand —
        # in that case we report 0 here (heating delta absorbs it).
        # Note: this aggregate INCLUDES our ZoneVentilation:WindandStackOpenArea
        # opening flows. EP doesn't report per-object — we attribute the lump
        # by design flow ratio so louvres / windows / mechanical show as
        # separate line items.
        vent_loss_total = _sum_annual(conn, "Zone Ventilation Sensible Heat Loss Energy")
        louvre_loss, window_loss, vent_loss = _attribute_openings_share(
            vent_loss_total, weather_file_path, building_config
        )

        # ── Solar gains by orientation (already split in env detailed) ────────
        solar_by_face = {
            f: env["glazing"][f]["solar_gain_kWh"]
            for f in env["glazing"]
        }

        # ── HDD / CDD from EPW ────────────────────────────────────────────────
        hdd, cdd = (0.0, 0.0)
        if weather_file_path:
            temps = _read_epw_temperatures(weather_file_path)
            hdd, cdd = _hdd_cdd(temps, 18.0, 22.0)

        # ── Build response ────────────────────────────────────────────────────
        def per_m2(kwh):
            return round(kwh / gia, 2)

        losses = {
            "external_wall": {
                "kwh":         round(wall_loss_total, 1),
                "kwh_per_m2":  per_m2(wall_loss_total),
                "area_m2":     areas["external_wall_m2"],
                "by_face":     wall_loss_by_face,
            },
            "roof": {
                "kwh":         round(env["roof"]["annual_heat_loss_kWh"], 1),
                "kwh_per_m2":  per_m2(env["roof"]["annual_heat_loss_kWh"]),
                "area_m2":     areas["roof_m2"],
            },
            "ground_floor": {
                "kwh":         round(env["ground_floor"]["annual_heat_loss_kWh"], 1),
                "kwh_per_m2":  per_m2(env["ground_floor"]["annual_heat_loss_kWh"]),
                "area_m2":     areas["ground_floor_m2"],
            },
            "glazing": {
                "kwh":         round(glazing_loss, 1),
                "kwh_per_m2":  per_m2(glazing_loss),
                "area_m2":     areas["glazing_total_m2"],
            },
            "infiltration": {
                "kwh":         round(env["infiltration"]["annual_heat_loss_kWh"], 1),
                "kwh_per_m2":  per_m2(env["infiltration"]["annual_heat_loss_kWh"]),
                "ach":         float((building_config or {}).get("infiltration_ach", 0) or 0),
            },
            "openings_louvre": {
                "kwh":         round(louvre_loss, 1),
                "kwh_per_m2":  per_m2(louvre_loss),
            },
            "openings_window": {
                "kwh":         round(window_loss, 1),
                "kwh_per_m2":  per_m2(window_loss),
            },
            "ventilation": {
                "kwh":         round(vent_loss, 1),
                "kwh_per_m2":  per_m2(vent_loss),
            },
            "cooling": {
                "kwh":         round(cooling_kwh, 1),
                "kwh_per_m2":  per_m2(cooling_kwh),
            },
        }

        gains = {
            "solar": {
                **{
                    f: {
                        "kwh":        round(solar_by_face[f], 1),
                        "kwh_per_m2": per_m2(solar_by_face[f]),
                        "area_m2":    areas["glazing_by_face_m2"].get(f, 0.0),
                    }
                    for f in solar_by_face
                },
                "total_kwh":        round(sum(solar_by_face.values()), 1),
                "total_kwh_per_m2": per_m2(sum(solar_by_face.values())),
            },
            "internal": {
                "people":    {"kwh": round(people_kwh, 1), "kwh_per_m2": per_m2(people_kwh)},
                "equipment": {"kwh": round(equip_heat, 1), "kwh_per_m2": per_m2(equip_heat)},
                "lighting":  {"kwh": round(light_heat, 1), "kwh_per_m2": per_m2(light_heat)},
                "total_kwh": round(people_kwh + equip_heat + light_heat, 1),
                "total_kwh_per_m2": per_m2(people_kwh + equip_heat + light_heat),
            },
            "heating": {
                "kwh":        round(heating_kwh, 1),
                "kwh_per_m2": per_m2(heating_kwh),
            },
        }

        total_losses = sum(losses[k]["kwh"] for k in losses)
        total_gains  = (
            sum(solar_by_face.values()) + people_kwh + equip_heat + light_heat + heating_kwh
        )

        return {
            "annual": {
                "losses": losses,
                "gains":  gains,
                "totals": {
                    "losses_kwh":        round(total_losses, 1),
                    "gains_kwh":         round(total_gains, 1),
                    "losses_kwh_per_m2": per_m2(total_losses),
                    "gains_kwh_per_m2":  per_m2(total_gains),
                    "net_kwh_per_m2":    per_m2(total_gains - total_losses),
                },
            },
            "metadata": {
                "gia_m2":         areas["gia_m2"],
                "hdd_18C":        hdd,
                "cdd_22C":        cdd,
                "weather_file":   str(weather_file_path) if weather_file_path else None,
            },
        }
    finally:
        conn.close()


# ── Brief 26 Part 6 — State 1 envelope-only parser ──────────────────────────
#
# Constants below MUST match the live engine in `frontend/src/utils/instantCalc.js`.
# If you change one, change the other in the same commit — engine agreement
# is what makes the dual-engine discipline work.

# Wh / (m³·K) — ρ_air × Cp_air; mirrors AIR_HEAT_CAPACITY in instantCalc.js.
# Physics: ρ_air ≈ 1.2 kg/m³ × Cp_air ≈ 1006 J/(kg·K) = ~1200 J/(m³·K) = 0.33 Wh/(m³·K).
# (The instantCalc.js comment "kWh/m³/K" is mislabelled — the value 0.33 is Wh/(m³·K).)
_AIR_HEAT_CAPACITY_WH_PER_M3_K = 0.33

# J / (K·m²·GIA) — CIBSE TM52 thermal-mass categories
_THERMAL_MASS_J_PER_K_PER_M2 = {
    "light":  80_000,
    "medium": 160_000,
    "heavy":  280_000,
}

# Centre-of-element U-values used when a construction is not assigned. Fall-back
# only; State 1 strict-input mode logs a warning if the building config doesn't
# carry a fabric set.
_DEFAULT_U_VALUES = {
    "external_wall": 0.28,
    "roof":          0.18,
    "ground_floor":  0.22,
    "glazing":       1.4,
}
_DEFAULT_G_VALUE = 0.4
_FRAME_FRACTION = 0.20
_SHADING_FACTOR = 1.0


def _u_value(constructions: dict | None, element: str, library_data: dict | None) -> tuple[float, float]:
    """
    Return (u_effective, u_centre) for a fabric element. u_effective has the
    Y-factor uplift baked in; u_centre is the library item's bare U-value.
    Falls back to _DEFAULT_U_VALUES if the construction can't be resolved.
    """
    name = (constructions or {}).get(element)
    if name and library_data and library_data.get("constructions"):
        for item in library_data["constructions"]:
            if item.get("name") == name and item.get("u_value_W_per_m2K") is not None:
                u_centre = float(item["u_value_W_per_m2K"])
                y = item.get("y_factor", 1.0)
                try:
                    y = float(y)
                    if y <= 0:
                        y = 1.0
                except (TypeError, ValueError):
                    y = 1.0
                return (u_centre * y, u_centre)
    u_default = _DEFAULT_U_VALUES.get(element, 1.0)
    return (u_default, u_default)


def _g_value(constructions: dict | None, library_data: dict | None) -> float:
    name = (constructions or {}).get("glazing")
    if name and library_data and library_data.get("constructions"):
        for item in library_data["constructions"]:
            if item.get("name") == name:
                cfg = item.get("config_json") or {}
                if cfg.get("g_value") is not None:
                    try:
                        return float(cfg["g_value"])
                    except (TypeError, ValueError):
                        pass
    return _DEFAULT_G_VALUE


def _read_hourly_zone_temp(conn: sqlite3.Connection, var_name: str) -> list[float]:
    """
    Return an 8760-length list of GIA-area-weighted average zone temperatures
    in °C for the given EP variable (`Zone Mean Air Temperature` or
    `Zone Operative Temperature`). Empty list if the variable wasn't requested.
    """
    rows = _query(
        conn,
        "SELECT ReportDataDictionaryIndex, KeyValue FROM ReportDataDictionary "
        "WHERE Name = ? COLLATE NOCASE",
        (var_name,),
    )
    if not rows:
        return []
    # Get per-zone floor areas to weight the average correctly
    zones = {z["name"].upper(): z["floor_area_m2"] for z in _get_zones_info(conn)}
    if not zones:
        return []
    # Build TimeIndex → {zone: T} grid
    timegrid: dict[int, list[tuple[float, float]]] = {}
    for r in rows:
        kv = (r["KeyValue"] or "").upper()
        area = zones.get(kv, 0.0)
        if area <= 0:
            continue
        idx = r["ReportDataDictionaryIndex"]
        data_rows = _query(
            conn,
            "SELECT TimeIndex, Value FROM ReportData WHERE ReportDataDictionaryIndex = ? ORDER BY TimeIndex",
            (idx,),
        )
        for dr in data_rows:
            timegrid.setdefault(dr["TimeIndex"], []).append((float(dr["Value"]), area))
    # Sort by TimeIndex and emit area-weighted means
    out: list[float] = []
    for ti in sorted(timegrid.keys()):
        pairs = timegrid[ti]
        total_area = sum(a for _, a in pairs)
        if total_area <= 0:
            out.append(0.0)
        else:
            out.append(sum(v * a for v, a in pairs) / total_area)
    return out


def _read_hourly_solar_by_face(
    conn: sqlite3.Connection,
    glazing_face_m2: dict,
    g_value: float,
    frame_fraction: float = 0.20,
) -> dict[str, list[float]]:
    """
    Return solar gains through windows per face per hour, in kWh.
    Keys: north, south, east, west. Each value is an 8760-length list.

    Brief 26.2 (EP shading fix). Previously read `Surface Window
    Transmitted Solar Radiation Energy` directly. That variable, and
    the per-window `Surface Outside Face Incident Solar Radiation Rate
    per Area`, are both broken for FenestrationSurface objects with
    external shading. The diagnostic
    (scripts/ep_shading_diagnostic.py) confirmed:

      ┌──────────────────┬──────────┬────────┬─────────┐
      │ Run              │ Window SF│ Wall SF│ Win Inc │
      │                  │  south   │  south │  W/m²   │
      ├──────────────────┼──────────┼────────┼─────────┤
      │ no shading       │  0.3642  │  0.3642│  111.1  │
      │ 0.5m overhang    │  0.3642  │  0.2685│  111.1  │
      │ 2m + 1m fins     │  0.3642  │  0.1341│  111.1  │
      └──────────────────┴──────────┴────────┴─────────┘

    The PARENT WALL's Sunlit Fraction and Incident Solar respond to
    shading objects correctly. The WINDOW's don't — EP's shadow calc
    skips the fenestration sub-surfaces.

    Workaround: read incident solar from the parent WALL surface, which
    IS shading-aware. The wall around the window experiences the same
    overhang/fin shadow as the window would, so wall-incident-rate is a
    good proxy. Multiply by the window's GLAZING area (not wall area)
    to get the energy on the glazing aperture, then by SHGC × (1 − frame)
    for transmitted solar.

    This matches the live engine's formula
        Q_solar_face = hourly_solar_per_facade × area × g × (1 − frame) × shading
    where the hourly_solar_per_facade × shading product is what EP's
    wall-Incident-Solar variable provides directly.
    """
    rows = _query(
        conn,
        "SELECT ReportDataDictionaryIndex, KeyValue FROM ReportDataDictionary "
        "WHERE Name = 'Surface Outside Face Incident Solar Radiation Rate per Area' COLLATE NOCASE",
    )
    FACE_MAP = {"N": "north", "S": "south", "E": "east", "W": "west"}

    # Group rows by face for averaging. Read from the parent WALL (not the
    # window) because the wall's incident-solar variable correctly accounts
    # for attached shading; the window's variable doesn't.
    per_face_rows: dict[str, list[int]] = {f: [] for f in FACE_MAP.values()}
    for r in rows:
        kv = (r["KeyValue"] or "").upper()
        # Match the four exterior walls by name suffix _WALL_N/S/E/W.
        # Skip everything else (windows, slabs, mirror surfaces, floor/roof).
        if "_WALL_" not in kv:
            continue
        face_letter = kv[-1] if len(kv) > 0 else ""
        face = FACE_MAP.get(face_letter)
        if face:
            per_face_rows[face].append(r["ReportDataDictionaryIndex"])

    # Per face: read hourly rate (W/m²) from any/all windows on that face,
    # average across windows (they share orientation so should be equal anyway).
    by_face: dict[str, dict[int, list[float]]] = {f: {} for f in FACE_MAP.values()}
    for face, indices in per_face_rows.items():
        for idx in indices:
            data_rows = _query(
                conn,
                "SELECT TimeIndex, Value FROM ReportData WHERE ReportDataDictionaryIndex = ? ORDER BY TimeIndex",
                (idx,),
            )
            for dr in data_rows:
                by_face[face].setdefault(dr["TimeIndex"], []).append(float(dr["Value"]))

    # Convert to kWh per hour per facade:
    #   avg_W_per_m2 × 1 hr × area_m² × g_value × (1 - frame_fraction) / 1000
    all_ti = sorted({ti for f in by_face.values() for ti in f.keys()})
    transmittance = g_value * (1.0 - frame_fraction)
    out: dict[str, list[float]] = {}
    for face, ti_map in by_face.items():
        area = glazing_face_m2.get(face, 0.0)
        if area <= 0:
            out[face] = [0.0] * len(all_ti)
            continue
        series = []
        for ti in all_ti:
            vals = ti_map.get(ti, [])
            avg_W_per_m2 = (sum(vals) / len(vals)) if vals else 0.0
            kwh_this_hr = avg_W_per_m2 * area * transmittance / 1000.0
            series.append(kwh_this_hr)
        out[face] = series
    return out


def _get_heat_balance_state1(
    sql_path: str | Path,
    building_config: dict | None,
    weather_file_path: str | Path | None,
    comfort_band: dict | None,
    library_data: dict | None,
) -> dict:
    """
    State 1 envelope-only parser path.

    EP has just been run with extreme setpoints (`-60` / `+100`), so the zone
    is free-running. We read the resulting hourly zone temperatures, then
    derive heating/cooling demand against the comfort band using the same
    lumped-capacitance formula as `_calculateEnvelopeOnly` in instantCalc.js.

    Output shape per docs/state_contracts.md § State 1:
      {
        state: 1, mode: "envelope-only", inputs_used: [...], comfort_band_used,
        gains:  { solar: { f1..f4, roof, total } },
        losses: { conduction: { external_wall, roof, ground_floor,
                                glazing: {f1..f4}, thermal_bridging },
                  ventilation: { fabric_leakage, permanent_vents } },
        free_running: { annual_mean_c, winter_min_c, summer_max_c, hourly_temperature_c },
        demand: { heating_demand_mwh, cooling_demand_mwh,
                  underheating_hours, overheating_hours, comfort_hours },
        heat_balance: { annual: { losses, gains, totals }, metadata, demand,
                        free_running, comfort_band_used },
      }
    """
    band = comfort_band or {"lower_c": 20.0, "upper_c": 26.0}
    lower_c = float(band.get("lower_c", 20.0))
    upper_c = float(band.get("upper_c", 26.0))

    bc = building_config or {}
    constructions = bc.get("constructions") or {}

    # ── Areas + geometry (canonical building config) ──────────────────────────
    areas = _building_areas(bc)
    L = float(bc.get("length", 0) or 0)
    W = float(bc.get("width", 0) or 0)
    fh = float(bc.get("floor_height", 0) or 0)
    nf = float(bc.get("num_floors", 0) or 0)
    gia = max(areas["gia_m2"], 1.0)
    volume = L * W * fh * nf if (L * W * fh * nf) > 0 else gia * 3.0
    wall_face_m2 = areas["external_wall_by_face_m2"]
    glazing_face_m2 = areas["glazing_by_face_m2"]
    total_wall_opaque = areas["external_wall_m2"]
    total_glazing = areas["glazing_total_m2"]
    roof_area = areas["roof_m2"]
    ground_area = areas["ground_floor_m2"]

    # ── U-values & UAs (W/K) ──────────────────────────────────────────────────
    u_wall_e,  u_wall_c  = _u_value(constructions, "external_wall", library_data)
    u_roof_e,  u_roof_c  = _u_value(constructions, "roof",          library_data)
    u_floor_e, u_floor_c = _u_value(constructions, "ground_floor",  library_data)
    u_glaz_e,  u_glaz_c  = _u_value(constructions, "glazing",       library_data)
    g_value = _g_value(constructions, library_data)

    UA_wall  = u_wall_e  * total_wall_opaque
    UA_roof  = u_roof_e  * roof_area
    UA_floor = u_floor_e * ground_area
    UA_glaz  = u_glaz_e  * total_glazing
    UA_fabric = UA_wall + UA_roof + UA_floor + UA_glaz

    # Thermal bridging — uplift portion of each U times area
    UA_bridging = (
        max(0.0, (u_wall_e  - u_wall_c)  * total_wall_opaque) +
        max(0.0, (u_roof_e  - u_roof_c)  * roof_area)         +
        max(0.0, (u_floor_e - u_floor_c) * ground_area)       +
        max(0.0, (u_glaz_e  - u_glaz_c)  * total_glazing)
    )

    ach = float(bc.get("infiltration_ach", 0.5) or 0.5)
    # UA_leakage = ρ_air·Cp · ach·volume = W/K = Wh/K per hour. Mirrors the
    # live engine: `UA_leakage = AIR_HEAT_CAPACITY * ach * volume` in instantCalc.js.
    UA_leakage = _AIR_HEAT_CAPACITY_WH_PER_M3_K * ach * volume  # Wh/K per hour

    # ── Permanent openings (louvres only — operable windows forbidden) ────────
    openings = bc.get("openings") or {}
    Cd = 0.6
    Cw_map = {"sheltered": 0.05, "normal": 0.10, "exposed": 0.20}
    Cw = Cw_map.get(openings.get("site_exposure", "normal"), 0.10)
    sqrt_Cw = Cw ** 0.5
    faces = ("north", "south", "east", "west")
    louvre_total_m2 = sum(
        float((openings.get(f) or {}).get("louvre_area_m2", 0) or 0) for f in faces
    )

    # ── EPW hourly data ───────────────────────────────────────────────────────
    epw_temps = _read_epw_temperatures(weather_file_path) if weather_file_path else []
    wind, months = _read_epw_wind_temp(weather_file_path) if weather_file_path else ([], [])
    n_epw = min(len(epw_temps), len(wind)) if (epw_temps and wind) else len(epw_temps) or len(wind)

    # ── SQL hourly data ───────────────────────────────────────────────────────
    conn = _connect(sql_path)
    try:
        T_air_hourly = _read_hourly_zone_temp(conn, "Zone Mean Air Temperature")
        T_op_hourly  = _read_hourly_zone_temp(conn, "Zone Operative Temperature")
        # Brief 26.2: pass glazing geometry + SHGC into the solar reader so it
        # can convert EP's shading-aware Incident Solar (W/m²) into transmitted
        # solar (kWh) per face. EP's Transmitted variable is broken for
        # SimpleGlazingSystem; see _read_hourly_solar_by_face docstring.
        solar_face = _read_hourly_solar_by_face(
            conn,
            glazing_face_m2=glazing_face_m2,
            g_value=g_value,
            frame_fraction=0.20,
        )
    finally:
        conn.close()

    # Air temp drives conduction physics; operative drives comfort hour counts.
    # If only one available, use whichever is present (operative preferred per
    # user spec — comfort is the more thermodynamically meaningful index).
    if not T_air_hourly and not T_op_hourly:
        raise ValueError(
            "State 1 parser needs Zone Mean Air Temperature or Zone Operative "
            "Temperature in the EP SQL output, but neither was found. The "
            "epJSON assembler must request these variables for envelope-only mode."
        )
    if not T_air_hourly:
        T_air_hourly = list(T_op_hourly)
    if not T_op_hourly:
        T_op_hourly = list(T_air_hourly)

    n = min(
        len(T_air_hourly), len(T_op_hourly),
        len(epw_temps) if epw_temps else len(T_air_hourly),
        len(solar_face["north"]) if solar_face["north"] else len(T_air_hourly),
    )
    if n == 0:
        raise ValueError("State 1 parser: no overlapping hourly data between SQL and EPW.")

    # Pad wind/months to n if they're shorter
    if not wind:
        wind = [4.0] * n
    if len(wind) < n:
        wind = wind + [wind[-1] if wind else 4.0] * (n - len(wind))
    if not months:
        # Reconstruct months from hour-of-year if we don't have EPW months
        # (rough heuristic — only used for winter/summer min/max tagging)
        months = []
        for h in range(n):
            day_of_year = h // 24
            # Cumulative days at start of each month (non-leap)
            m = 1
            cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365]
            for i in range(12):
                if day_of_year < cum[i + 1]:
                    m = i + 1
                    break
            months.append(m - 1)
    if len(months) < n:
        months = months + [months[-1] if months else 0] * (n - len(months))

    # ── 8760-hour loop — mirror the live engine ───────────────────────────────
    acc_solar = {f: 0.0 for f in faces}
    acc_solar_roof = 0.0  # opaque-roof solar — parser leaves at 0 (EP handles it implicitly)
    acc_cond_wall = 0.0
    acc_cond_roof = 0.0
    acc_cond_floor = 0.0
    acc_cond_glaz = {f: 0.0 for f in faces}
    acc_thermal_bridging = 0.0
    acc_vent_leakage = 0.0
    acc_vent_permanent = 0.0
    acc_heating_demand_Wh = 0.0
    acc_cooling_demand_Wh = 0.0
    underheating_hours = 0
    overheating_hours = 0
    comfort_hours = 0
    T_sum = 0.0
    T_winter_min = float("inf")
    T_summer_max = float("-inf")

    # Per-face glazing UA fractions
    glaz_face_UA = {
        f: u_glaz_e * glazing_face_m2.get(f, 0.0) for f in faces
    }

    for h in range(n):
        T_air = T_air_hourly[h]
        T_op  = T_op_hourly[h]
        T_out = epw_temps[h] if h < len(epw_temps) else T_air
        v_wind = wind[h] if h < len(wind) else 4.0

        # Solar gains by face (kWh this hour) — pulled straight from EP
        sol_n = solar_face["north"][h] if h < len(solar_face["north"]) else 0.0
        sol_s = solar_face["south"][h] if h < len(solar_face["south"]) else 0.0
        sol_e = solar_face["east"][h]  if h < len(solar_face["east"])  else 0.0
        sol_w = solar_face["west"][h]  if h < len(solar_face["west"])  else 0.0
        acc_solar["north"] += sol_n; acc_solar["south"] += sol_s
        acc_solar["east"]  += sol_e; acc_solar["west"]  += sol_w
        Q_solar_in_Wh = (sol_n + sol_s + sol_e + sol_w) * 1000.0  # kWh → Wh

        # Permanent-vent UA this hour (wind-driven)
        Q_louvre_m3s = Cd * louvre_total_m2 * sqrt_Cw * v_wind
        UA_permanent = _AIR_HEAT_CAPACITY_WH_PER_M3_K * (Q_louvre_m3s * 3600.0)  # Wh/K per hour
        UA_total = UA_fabric + UA_leakage + UA_permanent

        # Conduction physics — air temp drives ΔT
        dT = T_air - T_out
        Q_cond_walls_Wh   = u_wall_e  * total_wall_opaque * dT
        Q_cond_roof_Wh    = u_roof_e  * roof_area         * dT
        Q_cond_floor_Wh   = u_floor_e * ground_area       * dT
        Q_cond_glaz_n_Wh  = glaz_face_UA["north"] * dT
        Q_cond_glaz_s_Wh  = glaz_face_UA["south"] * dT
        Q_cond_glaz_e_Wh  = glaz_face_UA["east"]  * dT
        Q_cond_glaz_w_Wh  = glaz_face_UA["west"]  * dT
        Q_bridging_Wh     = UA_bridging   * dT
        Q_vent_leak_Wh    = UA_leakage    * dT
        Q_vent_perm_Wh    = UA_permanent  * dT

        # Loss accumulators — positive direction only (mirrors live calc)
        if dT > 0:
            acc_cond_wall    += Q_cond_walls_Wh
            acc_cond_roof    += Q_cond_roof_Wh
            acc_cond_floor   += Q_cond_floor_Wh
            acc_cond_glaz["north"] += Q_cond_glaz_n_Wh
            acc_cond_glaz["south"] += Q_cond_glaz_s_Wh
            acc_cond_glaz["east"]  += Q_cond_glaz_e_Wh
            acc_cond_glaz["west"]  += Q_cond_glaz_w_Wh
            acc_thermal_bridging  += Q_bridging_Wh
            acc_vent_leakage      += Q_vent_leak_Wh
            acc_vent_permanent    += Q_vent_perm_Wh

        # Comfort hour counts — operative temperature (what occupants feel)
        if T_op < lower_c:
            underheating_hours += 1
        elif T_op > upper_c:
            overheating_hours += 1
        else:
            comfort_hours += 1

        # Free-running stats
        T_sum += T_air
        m = months[h] if h < len(months) else (h // 730) % 12
        if m == 11 or m <= 1:  # Dec/Jan/Feb (0-indexed)
            if T_air < T_winter_min:
                T_winter_min = T_air
        if 5 <= m <= 7:        # Jun/Jul/Aug
            if T_air > T_summer_max:
                T_summer_max = T_air

        # Demand derivation — same formula as live engine, triggered by
        # free-running operative temperature
        if T_op < lower_c:
            Q_loss_at_lower = UA_total * max(0.0, lower_c - T_out)
            heating_Wh = max(0.0, Q_loss_at_lower - Q_solar_in_Wh)
            acc_heating_demand_Wh += heating_Wh
        elif T_op > upper_c:
            Q_gain_at_upper = Q_solar_in_Wh + UA_total * max(0.0, T_out - upper_c)
            acc_cooling_demand_Wh += Q_gain_at_upper

    # ── Aggregates ────────────────────────────────────────────────────────────
    def r1(wh: float) -> float:
        return round(wh / 1000.0, 1)

    def per_m2(wh: float) -> float:
        return round(wh / 1000.0 / gia, 2)

    total_solar_Wh = sum(acc_solar.values()) * 1000.0  # solar accumulators are in kWh
    total_cond_glaz_Wh = sum(acc_cond_glaz.values())
    total_cond_Wh = acc_cond_wall + acc_cond_roof + acc_cond_floor + total_cond_glaz_Wh + acc_thermal_bridging
    total_vent_Wh = acc_vent_leakage + acc_vent_permanent
    T_mean = T_sum / n if n > 0 else 0.0

    heat_balance = {
        "annual": {
            "losses": {
                "external_wall":    {"kwh": r1(acc_cond_wall),    "kwh_per_m2": per_m2(acc_cond_wall),    "area_m2": round(total_wall_opaque)},
                "roof":             {"kwh": r1(acc_cond_roof),    "kwh_per_m2": per_m2(acc_cond_roof),    "area_m2": round(roof_area)},
                "ground_floor":     {"kwh": r1(acc_cond_floor),   "kwh_per_m2": per_m2(acc_cond_floor),   "area_m2": round(ground_area)},
                "glazing":          {"kwh": r1(total_cond_glaz_Wh), "kwh_per_m2": per_m2(total_cond_glaz_Wh), "area_m2": round(total_glazing)},
                "thermal_bridging": {"kwh": r1(acc_thermal_bridging), "kwh_per_m2": per_m2(acc_thermal_bridging)},
                "fabric_leakage":   {"kwh": r1(acc_vent_leakage), "kwh_per_m2": per_m2(acc_vent_leakage), "ach": ach},
                "permanent_vents":  {"kwh": r1(acc_vent_permanent), "kwh_per_m2": per_m2(acc_vent_permanent)},
                # No `cooling` here — State 1 has no mechanical cooling.
            },
            "gains": {
                "solar": {
                    "north": {"kwh": round(acc_solar["north"], 1), "kwh_per_m2": round(acc_solar["north"] / gia, 2), "area_m2": round(glazing_face_m2.get("north", 0))},
                    "south": {"kwh": round(acc_solar["south"], 1), "kwh_per_m2": round(acc_solar["south"] / gia, 2), "area_m2": round(glazing_face_m2.get("south", 0))},
                    "east":  {"kwh": round(acc_solar["east"], 1),  "kwh_per_m2": round(acc_solar["east"]  / gia, 2), "area_m2": round(glazing_face_m2.get("east",  0))},
                    "west":  {"kwh": round(acc_solar["west"], 1),  "kwh_per_m2": round(acc_solar["west"]  / gia, 2), "area_m2": round(glazing_face_m2.get("west",  0))},
                    "total_kwh":        round(sum(acc_solar.values()), 1),
                    "total_kwh_per_m2": round(sum(acc_solar.values()) / gia, 2),
                },
                # No people / equipment / lighting / heating — State 1.
            },
            "totals": {
                "losses_kwh":        r1(total_cond_Wh + total_vent_Wh),
                "gains_kwh":         round(sum(acc_solar.values()), 1),
                "losses_kwh_per_m2": per_m2(total_cond_Wh + total_vent_Wh),
                "gains_kwh_per_m2":  round(sum(acc_solar.values()) / gia, 2),
            },
        },
        "metadata": {
            "gia_m2":       areas["gia_m2"],
            "weather_file": str(weather_file_path) if weather_file_path else None,
        },
        # State 1 extras for the HeatBalance component
        "demand": {
            "heating_demand_mwh": round(acc_heating_demand_Wh / 1_000_000.0, 1),
            "cooling_demand_mwh": round(acc_cooling_demand_Wh / 1_000_000.0, 1),
            "underheating_hours": underheating_hours,
            "overheating_hours":  overheating_hours,
            "comfort_hours":      comfort_hours,
        },
        "free_running": {
            "annual_mean_c": round(T_mean, 1),
            "winter_min_c":  round(T_winter_min, 1) if T_winter_min != float("inf") else None,
            "summer_max_c":  round(T_summer_max, 1) if T_summer_max != float("-inf") else None,
        },
        "comfort_band_used": {"lower_c": lower_c, "upper_c": upper_c},
    }

    return {
        "state":  1,
        "mode":   "envelope-only",
        "inputs_used": [
            "length", "width", "num_floors", "floor_height", "orientation",
            "wwr", "window_count", "shading_overhang", "shading_fin",
            "infiltration_ach", "thermal_mass_category",
            "openings.site_exposure", "openings.{face}.louvre_area_m2",
            "constructions.{external_wall, roof, ground_floor, glazing}",
            "weather (EPW)",
        ],
        "comfort_band_used": {"lower_c": lower_c, "upper_c": upper_c},

        "gains": {
            "solar": {
                "f1": round(acc_solar["north"], 1),  # north
                "f2": round(acc_solar["east"], 1),   # east
                "f3": round(acc_solar["south"], 1),  # south
                "f4": round(acc_solar["west"], 1),   # west
                "roof":  round(acc_solar_roof, 1),
                "total": round(sum(acc_solar.values()), 1),
            },
        },
        "losses": {
            "conduction": {
                "external_wall": r1(acc_cond_wall),
                "roof":          r1(acc_cond_roof),
                "ground_floor":  r1(acc_cond_floor),
                "glazing": {
                    "f1": r1(acc_cond_glaz["north"]),
                    "f2": r1(acc_cond_glaz["east"]),
                    "f3": r1(acc_cond_glaz["south"]),
                    "f4": r1(acc_cond_glaz["west"]),
                },
                "thermal_bridging": r1(acc_thermal_bridging),
            },
            "ventilation": {
                "fabric_leakage":  r1(acc_vent_leakage),
                "permanent_vents": r1(acc_vent_permanent),
            },
        },
        "free_running": {
            "annual_mean_c":       round(T_mean, 1),
            "winter_min_c":        round(T_winter_min, 1) if T_winter_min != float("inf") else None,
            "summer_max_c":        round(T_summer_max, 1) if T_summer_max != float("-inf") else None,
            "hourly_temperature_c": [round(t, 2) for t in T_air_hourly[:n]],
        },
        "demand": {
            "heating_demand_mwh": round(acc_heating_demand_Wh / 1_000_000.0, 1),
            "cooling_demand_mwh": round(acc_cooling_demand_Wh / 1_000_000.0, 1),
            "underheating_hours": underheating_hours,
            "overheating_hours":  overheating_hours,
            "comfort_hours":      comfort_hours,
        },
        # Heat Balance component reads from this nested shape (matches the
        # full-mode return signature so the existing UI renders state 1
        # without changes)
        "heat_balance": heat_balance,
        # Also fold into the top-level so the existing API endpoint shape
        # (which spreads `annual`/`metadata` at the root) keeps working.
        "annual":   heat_balance["annual"],
        "metadata": heat_balance["metadata"],
    }


def _get_heat_balance_state2(
    sql_path: str | Path,
    building_config: dict | None,
    weather_file_path: str | Path | None,
    comfort_band: dict | None,
    library_data: dict | None,
) -> dict:
    """
    State 2 envelope + internal gains parser path. Brief 27 Part 3.

    EP has just been run with extreme setpoints (`-60` / `+100`) — same as
    State 1 — and the People/Lights/ElectricEquipment objects have been
    emitted from `building_config.occupancy.*` + `building_config.gains.*`
    (v2.3 contract). The zone's free-running temperature trace therefore
    reflects gains, and EP's gain meters report actual gain energies.

    Approach (light reuse of state1 logic):
      1. Run the State 1 demand calc on the (gains-influenced) hourly zone
         temperatures to derive heating/cooling demand against the
         comfort band. Same lumped-capacitance formula; the only difference
         from State 1 is that T_hourly already encodes the gain effect.
      2. Read People/Lights/Equipment annual energies from EP output meters.
         These were near-zero in State 1; now non-zero per Part 3.
      3. Return the State 2 contract shape with gain energies attached.

    NOTE: `state1_delta` cannot be computed here without re-running the
    State 1 simulation. The runner/API layer is responsible for that
    diff if needed. For now `state1_delta` is omitted from the return
    shape; consumers should compute it from a separate State 1 run.
    """
    # Run the existing state1 envelope physics on this (gains-influenced) run.
    # The returned shape includes free_running, demand (computed against the
    # comfort band from the EP-reported T_op trace), and the loss accounting.
    base = _get_heat_balance_state1(
        sql_path,
        building_config=building_config,
        weather_file_path=weather_file_path,
        comfort_band=comfort_band,
        library_data=library_data,
    )

    # ── Read gain energies from EP output meters ─────────────────────────────
    conn = _connect(sql_path)
    try:
        people_kwh = _sum_annual(conn, "Zone People Total Heating Energy")
        light_heat = _sum_annual(conn, "Zone Lights Total Heating Energy")
        if light_heat == 0.0:
            light_heat = _sum_annual(conn, "Zone Lights Electricity Energy")
        equip_heat = _sum_annual(conn, "Zone Electric Equipment Total Heating Energy")
        if equip_heat == 0.0:
            equip_heat = _sum_annual(conn, "Zone Electric Equipment Electricity Energy")
    finally:
        conn.close()

    bc = building_config or {}
    areas = _building_areas(bc)
    gia = max(areas["gia_m2"], 1.0)

    # ── State 2-shaped output (mode + state + gains attached) ────────────────
    return {
        **base,  # carries losses, free_running, demand, heat_balance, annual, metadata
        "state": 2,
        "mode":  "envelope-gains",
        "inputs_used": (base.get("inputs_used") or []) + [
            "occupancy.density", "occupancy.occupancy_rate",
            "occupancy.sensible_w_per_person", "occupancy.schedule",
            "occupancy.schedule.exceptions",
            "gains.lighting.magnitude", "gains.lighting.relationship_to_occupancy",
            "gains.lighting.daylight_factor", "gains.lighting.schedule",
            "gains.equipment.baseload", "gains.equipment.active",
            "gains.equipment.relationship_to_occupancy", "gains.equipment.standby_factor",
            "gains.equipment.schedule",
        ],
        "gains": {
            **(base.get("gains") or {}),
            "people": {
                "sensible_kwh": round(people_kwh, 1),
                "latent_kwh":   0.0,
                "total_kwh":    round(people_kwh, 1),
            },
            "lighting": {
                "kwh": round(light_heat, 1),
            },
            "equipment": {
                "kwh": round(equip_heat, 1),
            },
        },
        # state1_delta is omitted — requires running State 1 in parallel.
        # The runner / API computes the delta by calling get_heat_balance
        # twice (once with mode='envelope-only', once with 'envelope-gains'
        # against an EP run assembled in each mode) and diffing.
    }


def get_envelope_heat_flow_detailed(sql_path) -> dict:
    """
    Return per-facade annual heat flow data grouped by element type and facade.

    Returns a structured dict:
    {
      "walls":    { "north": {area_m2, annual_heat_loss_kWh, annual_heat_gain_kWh, net_kWh}, ... },
      "glazing":  { "north": {area_m2, solar_gain_kWh, conduction_kWh, net_kWh}, ... },
      "roof":     { annual_heat_loss_kWh, annual_heat_gain_kWh, net_kWh },
      "ground_floor": { annual_heat_loss_kWh, annual_heat_gain_kWh, net_kWh },
      "infiltration": { annual_heat_loss_kWh, annual_heat_gain_kWh },
      "summary":  { total_fabric_loss_kWh, total_solar_gain_kWh, net_balance_kWh }
    }

    Surface names follow geometry generator convention:
      FLOOR_N_WALL_N/S/E/W, FLOOR_N_WIN_N/S/E/W, FLOOR_N_SLAB, FLOOR_N_CEILING
    """
    conn = _connect(sql_path)
    try:
        FACES = ("N", "S", "E", "W")
        FACE_FULL = {"N": "north", "S": "south", "E": "east", "W": "west"}

        def _sum_by_keyvalue_prefix(var_name: str, prefix_filter) -> dict[str, float]:
            """
            Sum annual energy per KeyValue, filtered by a callable.
            Returns {keyvalue: kWh}.
            """
            rows = _query(
                conn,
                "SELECT ReportDataDictionaryIndex, KeyValue FROM ReportDataDictionary "
                "WHERE Name = ? COLLATE NOCASE",
                (var_name,),
            )
            result = {}
            for row in rows:
                kv = (row["KeyValue"] or "").upper()
                if prefix_filter(kv):
                    idx = row["ReportDataDictionaryIndex"]
                    val = _query(
                        conn,
                        "SELECT SUM(Value) FROM ReportData WHERE ReportDataDictionaryIndex = ?",
                        (idx,),
                    )
                    result[kv] = (val[0][0] or 0.0) * J_TO_KWH
            return result

        # ── Walls: surface conduction (positive = heat gain into zone, negative = loss)
        walls = {FACE_FULL[f]: {"annual_heat_loss_kWh": 0.0, "annual_heat_gain_kWh": 0.0, "net_kWh": 0.0} for f in FACES}
        wall_cond = _sum_by_keyvalue_prefix(
            "Surface Inside Face Conduction Heat Transfer Energy",
            lambda kv: "_WALL_" in kv and any(kv.endswith("_" + f) for f in FACES),
        )
        for kv, kwh in wall_cond.items():
            face = kv[-1]  # last char: N/S/E/W
            fname = FACE_FULL.get(face)
            if fname:
                if kwh >= 0:
                    walls[fname]["annual_heat_gain_kWh"] += kwh
                else:
                    walls[fname]["annual_heat_loss_kWh"] += abs(kwh)
                walls[fname]["net_kWh"] += kwh

        # ── Glazing: solar gains + conduction through windows
        glazing = {FACE_FULL[f]: {"solar_gain_kWh": 0.0, "conduction_kWh": 0.0,
                                  "annual_heat_loss_kWh": 0.0, "annual_heat_gain_kWh": 0.0,
                                  "net_kWh": 0.0} for f in FACES}

        solar_by_win = _sum_by_keyvalue_prefix(
            "Surface Window Transmitted Solar Radiation Energy",
            lambda kv: "_WIN_" in kv and any(kv.endswith("_" + f) for f in FACES),
        )
        for kv, kwh in solar_by_win.items():
            face = kv[-1]
            fname = FACE_FULL.get(face)
            if fname:
                glazing[fname]["solar_gain_kWh"]  += kwh
                glazing[fname]["net_kWh"] += kwh

        # Window conduction — split by face. EP tags windows as `..._WIN_N/S/E/W`
        # (Brief 21 fix: previously only walls were read from this variable, so
        # the contract's `losses.conduction.glazing` line item came back zero.)
        win_cond = _sum_by_keyvalue_prefix(
            "Surface Inside Face Conduction Heat Transfer Energy",
            lambda kv: "_WIN_" in kv and any(kv.endswith("_" + f) for f in FACES),
        )
        for kv, kwh in win_cond.items():
            face = kv[-1]
            fname = FACE_FULL.get(face)
            if fname:
                # Positive Value = heat into zone (gain); negative = heat leaving (loss).
                # Mirror the wall sign convention.
                if kwh >= 0:
                    glazing[fname]["annual_heat_gain_kWh"] += kwh
                else:
                    glazing[fname]["annual_heat_loss_kWh"] += abs(kwh)
                glazing[fname]["conduction_kWh"] += kwh
                glazing[fname]["net_kWh"] += kwh

        # ── Roof (top floor ceiling)
        roof_cond = _sum_by_keyvalue_prefix(
            "Surface Inside Face Conduction Heat Transfer Energy",
            lambda kv: kv.endswith("_CEILING"),
        )
        roof_net = sum(roof_cond.values())
        roof = {
            "annual_heat_loss_kWh": abs(roof_net) if roof_net < 0 else 0.0,
            "annual_heat_gain_kWh": roof_net if roof_net >= 0 else 0.0,
            "net_kWh": round(roof_net, 1),
        }

        # ── Ground floor (slab)
        slab_cond = _sum_by_keyvalue_prefix(
            "Surface Inside Face Conduction Heat Transfer Energy",
            lambda kv: kv.endswith("_SLAB"),
        )
        slab_net = sum(slab_cond.values())
        ground_floor = {
            "annual_heat_loss_kWh": abs(slab_net) if slab_net < 0 else 0.0,
            "annual_heat_gain_kWh": slab_net if slab_net >= 0 else 0.0,
            "net_kWh": round(slab_net, 1),
        }

        # ── Infiltration
        infil_loss = _sum_annual(conn, "Zone Infiltration Sensible Heat Loss Energy")
        infil_gain = _sum_annual(conn, "Zone Infiltration Sensible Heat Gain Energy")

        # ── Solar total and summary
        total_solar = sum(v["solar_gain_kWh"] for v in glazing.values())
        total_fabric_loss = (
            sum(v["annual_heat_loss_kWh"] for v in walls.values())
            + sum(v["annual_heat_loss_kWh"] for v in glazing.values())
            + roof["annual_heat_loss_kWh"]
            + ground_floor["annual_heat_loss_kWh"]
        )
        total_fabric_gain = (
            sum(v["annual_heat_gain_kWh"] for v in walls.values())
            + sum(v["annual_heat_gain_kWh"] for v in glazing.values())
            + roof["annual_heat_gain_kWh"]
            + ground_floor["annual_heat_gain_kWh"]
        )

        # Round everything
        def _round_dict(d):
            return {k: round(v, 1) if isinstance(v, float) else v for k, v in d.items()}

        return {
            "walls":        {f: _round_dict(v) for f, v in walls.items()},
            "glazing":      {f: _round_dict(v) for f, v in glazing.items()},
            "roof":         _round_dict(roof),
            "ground_floor": _round_dict(ground_floor),
            "infiltration": {
                "annual_heat_loss_kWh": round(infil_loss, 1),
                "annual_heat_gain_kWh": round(infil_gain, 1),
            },
            "summary": {
                "total_solar_gain_kWh":   round(total_solar, 1),
                "total_fabric_loss_kWh":  round(total_fabric_loss, 1),
                "total_fabric_gain_kWh":  round(total_fabric_gain, 1),
                "net_balance_kWh":        round(total_fabric_gain + total_solar - total_fabric_loss - infil_loss + infil_gain, 1),
            },
        }
    finally:
        conn.close()
