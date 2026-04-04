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
        glazing = {FACE_FULL[f]: {"solar_gain_kWh": 0.0, "conduction_kWh": 0.0, "net_kWh": 0.0} for f in FACES}

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
            + roof["annual_heat_loss_kWh"]
            + ground_floor["annual_heat_loss_kWh"]
        )
        total_fabric_gain = (
            sum(v["annual_heat_gain_kWh"] for v in walls.values())
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
