#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Brief 81 P7 — EnergyPlus runner + output normaliser (Bridgewater-Box).

Runs the committed, byte-stable IDF (P6: validation/energyplus/generated/
bridgewater_box_v1.idf) on the locally-installed EnergyPlus, parses the
SQLite output, and emits a normalised JSON reference at
validation/energyplus/results/bridgewater_box_v1.json.

That JSON is the *EnergyPlus side* of the Phase-4 comparison (P9). Its schema is
deliberately parallel to the NZA-Sim anchor (validation/nza_sim/results/
bridgewater_box_v1.json, P2) so P9 can compare field-by-field. It carries:

  * demand_mwh        — raw ideal-loads outputs (zone + OA, after heat recovery)
  * fabric_conduction — per-surface Average Face Conduction (signed, EP convention)
  * windows_mwh       — per-facade transmitted solar / heat loss / heat gain
  * infiltration_mwh  — sensible/total infiltration loss & gain
  * internal_gains_mwh— people / lights / equipment as EnergyPlus reports them
  * meters_mwh        — InteriorLights / InteriorEquipment electricity meters
  * zone_temperature  — annual + monthly mean air temperature
  * monthly           — heating / cooling / zone-temp / outdoor-drybulb arrays (12)
  * derived_delivered — EP zone demand passed through the fixture's *documented*
                        system layer (same efficiencies NZA-Sim uses); DHW + fan
                        are closed-form analytical loads with no zone coupling
                        (audit D5c/D5d), computed independently from the fixture.
                        Enables the EUI / fuel comparison.
  * headline / totals — EUI, fuel split — mirror of the NZA-Sim anchor headline.

Design rules honoured (Brief 81 + CLAUDE.md):
  * "Build EnergyPlus the EnergyPlus way" — we read EnergyPlus's own outputs.
    We do NOT reshape them to mirror NZA-Sim's internal state model. The
    derived_delivered block is the only transform, and it applies the fixture's
    documented system parameters (identical in both engines) — clearly labelled.
  * EnergyPlus is located via ENERGYPLUS_DIR env var or ep_config.json — never a
    global PATH assumption (the install is outside the repo).
  * Raw EnergyPlus run artefacts land in validation/energyplus/runs/ (gitignored);
    only the normalised JSON is committed.
  * Read-only on everything else; never touches the live NZA-Sim DB.

Stdlib-only (subprocess, sqlite3, json, hashlib, argparse). Needs PyYAML to read
the fixture; if PyYAML is absent it auto-re-execs under the contained venv
(validation/.venv) that P6's generator already uses.

Usage:
    python validation/energyplus/run.py                 # run EP + write JSON
    python validation/energyplus/run.py --reuse <dir>   # parse an existing run
    python validation/energyplus/run.py --stdout        # print JSON, don't write
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent            # validation/energyplus
VALIDATION_DIR = SCRIPT_DIR.parent                      # validation
REPO_ROOT = VALIDATION_DIR.parent                       # repo root
EP_CONFIG_PATH = SCRIPT_DIR / "ep_config.json"
FIXTURE_PATH = VALIDATION_DIR / "fixtures" / "bridgewater_box_v1.yaml"
DEFAULT_IDF = SCRIPT_DIR / "generated" / "bridgewater_box_v1.idf"
RESULTS_DIR = SCRIPT_DIR / "results"
RUNS_DIR = SCRIPT_DIR / "runs"
WEATHER_DIR = REPO_ROOT / "data" / "weather" / "current"

FIXTURE_NAME = "bridgewater_box_v1"

J_TO_MWH = 1.0 / 3.6e9
J_TO_KWH = 1.0 / 3.6e6
CP_WATER_KJ_PER_KGK = 4.18      # specific heat of water (matches NZA-Sim / audit §2.4)


# ----------------------------------------------------------------------------
# PyYAML bootstrap — re-exec under the contained venv if needed
# ----------------------------------------------------------------------------
try:
    import yaml  # type: ignore
except ImportError:  # pragma: no cover - environment shim
    _venv_py = VALIDATION_DIR / ".venv" / (
        "Scripts/python.exe" if os.name == "nt" else "bin/python"
    )
    if _venv_py.exists() and os.environ.get("_NZA_P7_REEXEC") != "1":
        _env = {**os.environ, "_NZA_P7_REEXEC": "1"}
        sys.exit(subprocess.call([str(_venv_py), __file__, *sys.argv[1:]], env=_env))
    sys.stderr.write(
        "ERROR: PyYAML not importable and no contained venv at "
        f"{_venv_py}.\n       Install it (pip install pyyaml) or run under "
        "validation/.venv.\n"
    )
    sys.exit(2)


# ----------------------------------------------------------------------------
# Locating EnergyPlus + the weather file (config, not global PATH)
# ----------------------------------------------------------------------------
def load_ep_config() -> dict:
    with open(EP_CONFIG_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def resolve_energyplus(cfg: dict) -> tuple[Path, Path]:
    """Resolution order: ENERGYPLUS_DIR env var, then ep_config.json."""
    env_var = cfg.get("env_override_var", "ENERGYPLUS_DIR")
    env_dir = os.environ.get(env_var)
    if env_dir:
        base = Path(env_dir)
        exe = base / ("energyplus.exe" if os.name == "nt" else "energyplus")
        idd = base / "Energy+.idd"
    else:
        exe = Path(cfg["energyplus_exe"])
        idd = Path(cfg["idd"])
    if not exe.exists():
        raise FileNotFoundError(
            f"EnergyPlus executable not found at {exe}. Set {env_var} or fix "
            f"ep_config.json."
        )
    return exe, idd


def resolve_weather(epw_name: str) -> Path:
    epw = WEATHER_DIR / epw_name
    if not epw.exists():
        raise FileNotFoundError(
            f"Weather file {epw_name} not found under {WEATHER_DIR}. The data/ "
            f"directory is gitignored — copy the EPW from a working install."
        )
    return epw


# ----------------------------------------------------------------------------
# Fixture access (single source of truth for geometry + system parameters)
# ----------------------------------------------------------------------------
def load_fixture() -> dict:
    with open(FIXTURE_PATH, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


# ----------------------------------------------------------------------------
# Run EnergyPlus
# ----------------------------------------------------------------------------
def run_energyplus(exe: Path, epw: Path, idf: Path, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [str(exe), "-w", str(epw), "-d", str(out_dir), "-r", str(idf)]
    print(f"[run.py] {' '.join(cmd)}", file=sys.stderr)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout[-2000:] + "\n" + proc.stderr[-2000:] + "\n")
        raise RuntimeError(f"EnergyPlus exited {proc.returncode}")


def parse_err(out_dir: Path) -> dict:
    """Read eplusout.err for version, severe/warning counts, success flag."""
    err_path = out_dir / "eplusout.err"
    text = err_path.read_text(encoding="utf-8", errors="replace") if err_path.exists() else ""
    version = None
    m = re.search(r"Version\s+([0-9][\w.\-]+)", text)
    if m:
        version = m.group(1).rstrip(",")
    severe = warnings = None
    completed = "EnergyPlus Completed Successfully" in text
    m2 = re.search(r"Completed Successfully--\s*(\d+)\s+Warning;\s*(\d+)\s+Severe", text)
    if m2:
        warnings = int(m2.group(1))
        severe = int(m2.group(2))
    return {
        "version": version,
        "severe_errors": severe,
        "warnings": warnings,
        "completed_successfully": completed,
    }


# ----------------------------------------------------------------------------
# SQLite extraction
# ----------------------------------------------------------------------------
def open_ro(db_path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)


def fetch_runperiod(con: sqlite3.Connection) -> dict:
    """Return {(Name, KeyValue): (Value, Units)} for all Run Period variables."""
    rows = con.execute(
        """
        SELECT rdd.Name, rdd.KeyValue, rdd.Units, rd.Value
        FROM ReportData rd
        JOIN ReportDataDictionary rdd
          ON rd.ReportDataDictionaryIndex = rdd.ReportDataDictionaryIndex
        WHERE rdd.ReportingFrequency = 'Run Period'
        """
    ).fetchall()
    out: dict[tuple[str, str], tuple[float, str]] = {}
    for name, key, units, value in rows:
        out[(name, (key or "").upper())] = (value, units)
    return out


def fetch_monthly(con: sqlite3.Connection, var_name: str, agg: str) -> list[float | None]:
    """Aggregate an Hourly variable to 12 monthly values (SUM or AVG)."""
    assert agg in ("SUM", "AVG")
    rows = con.execute(
        f"""
        SELECT t.Month, {agg}(rd.Value)
        FROM ReportData rd
        JOIN ReportDataDictionary rdd
          ON rd.ReportDataDictionaryIndex = rdd.ReportDataDictionaryIndex
        JOIN Time t ON rd.TimeIndex = t.TimeIndex
        WHERE rdd.Name = ? AND rdd.ReportingFrequency = 'Hourly'
              AND t.Month IS NOT NULL
        GROUP BY t.Month ORDER BY t.Month
        """,
        (var_name,),
    ).fetchall()
    by_month = {int(m): v for m, v in rows}
    return [by_month.get(m) for m in range(1, 13)]


def annual_mean_hourly(con: sqlite3.Connection, var_name: str) -> float | None:
    row = con.execute(
        """
        SELECT AVG(rd.Value)
        FROM ReportData rd
        JOIN ReportDataDictionary rdd
          ON rd.ReportDataDictionaryIndex = rdd.ReportDataDictionaryIndex
        WHERE rdd.Name = ? AND rdd.ReportingFrequency = 'Hourly'
        """,
        (var_name,),
    ).fetchone()
    return row[0] if row else None


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def r(x: float | None, n: int = 6) -> float | None:
    return None if x is None else round(x, n)


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


# ----------------------------------------------------------------------------
# Normalise
# ----------------------------------------------------------------------------
def normalise(con: sqlite3.Connection, fix: dict, err_info: dict,
              idf: Path, epw: Path, out_dir: Path) -> dict:
    rp = fetch_runperiod(con)
    ZONE = "BOX_ZONE"
    IL = "BOX_IDEALLOADS"

    def mwh(name: str, key: str) -> float | None:
        hit = rp.get((name, key.upper()))
        return None if hit is None else hit[0] * J_TO_MWH

    def kwh(name: str, key: str) -> float | None:
        hit = rp.get((name, key.upper()))
        return None if hit is None else hit[0] * J_TO_KWH

    # --- raw ideal-loads demand (MWh) ---------------------------------------
    demand = {
        "heating_supply_air_sensible": r(mwh("Zone Ideal Loads Supply Air Sensible Heating Energy", IL)),
        "cooling_supply_air_sensible": r(mwh("Zone Ideal Loads Supply Air Sensible Cooling Energy", IL)),
        "heating_supply_air_total": r(mwh("Zone Ideal Loads Supply Air Total Heating Energy", IL)),
        "cooling_supply_air_total": r(mwh("Zone Ideal Loads Supply Air Total Cooling Energy", IL)),
        "heating_zone_sensible": r(mwh("Zone Ideal Loads Zone Sensible Heating Energy", IL)),
        "cooling_zone_sensible": r(mwh("Zone Ideal Loads Zone Sensible Cooling Energy", IL)),
        "oa_sensible_heating": r(mwh("Zone Ideal Loads Outdoor Air Sensible Heating Energy", IL)),
        "oa_sensible_cooling": r(mwh("Zone Ideal Loads Outdoor Air Sensible Cooling Energy", IL)),
        "oa_total_heating": r(mwh("Zone Ideal Loads Outdoor Air Total Heating Energy", IL)),
        "heat_recovery_sensible_heating": r(mwh("Zone Ideal Loads Heat Recovery Sensible Heating Energy", IL)),
        "heat_recovery_sensible_cooling": r(mwh("Zone Ideal Loads Heat Recovery Sensible Cooling Energy", IL)),
        "_note": ("Raw ZoneHVAC:IdealLoadsAirSystem outputs. 'supply_air_sensible' "
                  "is the net zone+OA sensible demand the system meets (after heat "
                  "recovery) — the direct analogue of NZA-Sim heating/cooling demand. "
                  "OA + heat-recovery terms are reported separately for the P9 "
                  "mech-ventilation mapping."),
    }

    # --- per-surface conduction (MWh, signed: negative = net heat out) ------
    cond_name = "Surface Average Face Conduction Heat Transfer Energy"
    walls = {f: r(mwh(cond_name, f"WALL_{f.upper()}")) for f in ("south", "north", "east", "west")}
    wall_sum = sum(v for v in walls.values() if v is not None)
    fabric = {
        "wall_south": walls["south"],
        "wall_north": walls["north"],
        "wall_east": walls["east"],
        "wall_west": walls["west"],
        "external_wall_sum": r(wall_sum),
        "roof": r(mwh(cond_name, "ROOF")),
        "ground_floor": r(mwh(cond_name, "FLOOR")),
        "thermal_bridge": r(mwh(cond_name, "THERMAL_BRIDGE")),
        "_note": ("Surface Average Face Conduction Heat Transfer Energy. EnergyPlus "
                  "sign convention: negative = net annual heat flow OUT of the zone. "
                  "Glazing conduction is NOT in this set (windows reported separately "
                  "below). P9 compares magnitudes against NZA-Sim losses_per_element."),
    }

    # --- windows (MWh) ------------------------------------------------------
    facades = ("south", "north", "east", "west")
    trans = {f: r(mwh("Surface Window Transmitted Solar Radiation Energy", f"WINDOW_{f.upper()}")) for f in facades}
    wloss = {f: r(mwh("Surface Window Heat Loss Energy", f"WINDOW_{f.upper()}")) for f in facades}
    wgain = {f: r(mwh("Surface Window Heat Gain Energy", f"WINDOW_{f.upper()}")) for f in facades}
    windows = {
        "transmitted_solar": {
            **trans,
            "sum_facades": r(sum(v for v in trans.values() if v is not None)),
            "enclosure_total": r(mwh("Enclosure Windows Total Transmitted Solar Radiation Energy", ZONE)),
        },
        "heat_loss": {**wloss, "sum": r(sum(v for v in wloss.values() if v is not None))},
        "heat_gain": {**wgain, "sum": r(sum(v for v in wgain.values() if v is not None))},
        "_note": ("Per-facade window energy. 'transmitted_solar' is solar energy "
                  "through the glazing into the zone; 'heat_loss'/'heat_gain' are the "
                  "conduction+convection window energy flows (positive magnitudes)."),
    }

    # --- infiltration (MWh) -------------------------------------------------
    infiltration = {
        "sensible_loss": r(mwh("Zone Infiltration Sensible Heat Loss Energy", ZONE)),
        "sensible_gain": r(mwh("Zone Infiltration Sensible Heat Gain Energy", ZONE)),
        "total_loss": r(mwh("Zone Infiltration Total Heat Loss Energy", ZONE)),
    }

    # --- internal gains (MWh) ----------------------------------------------
    internal_gains = {
        "people_sensible": r(mwh("Zone People Sensible Heating Energy", ZONE)),
        "people_total": r(mwh("Zone People Total Heating Energy", ZONE)),
        "lights": r(mwh("Zone Lights Total Heating Energy", ZONE)),
        "equipment": r(mwh("Zone Electric Equipment Total Heating Energy", ZONE)),
    }

    # --- electricity meters (MWh) ------------------------------------------
    # Meter dictionary rows carry a NULL KeyValue (-> "" after normalisation).
    meters = {
        "interior_lights_electricity": r(mwh("InteriorLights:Electricity", "")),
        "interior_equipment_electricity": r(mwh("InteriorEquipment:Electricity", "")),
    }

    # --- zone temperature ---------------------------------------------------
    zone_temp = {
        "mean_air_temp_annual_c": r(annual_mean_hourly(con, "Zone Mean Air Temperature"), 4),
        "_note": "Annual = mean of 8760 hourly values; monthly array under 'monthly'.",
    }

    # --- monthly arrays -----------------------------------------------------
    heating_monthly_j = fetch_monthly(con, "Zone Ideal Loads Supply Air Sensible Heating Energy", "SUM")
    cooling_monthly_j = fetch_monthly(con, "Zone Ideal Loads Supply Air Sensible Cooling Energy", "SUM")
    ztemp_monthly = fetch_monthly(con, "Zone Mean Air Temperature", "AVG")
    odb_monthly = fetch_monthly(con, "Site Outdoor Air Drybulb Temperature", "AVG")
    monthly = {
        "month_labels": ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                         "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        "heating_supply_air_sensible_kwh": [r(v * J_TO_KWH, 3) if v is not None else None for v in heating_monthly_j],
        "cooling_supply_air_sensible_kwh": [r(v * J_TO_KWH, 3) if v is not None else None for v in cooling_monthly_j],
        "zone_mean_air_temp_c": [r(v, 3) for v in ztemp_monthly],
        "outdoor_drybulb_c": [r(v, 3) for v in odb_monthly],
        "_note": "Heating/cooling = monthly sums of hourly ideal-loads energy; temps = monthly means. For P9 monthly-correlation check (>=0.85).",
    }

    # --- derived delivered energy (fixture system layer) --------------------
    geom = fix["geometry"]
    gia = float(geom["gia_m2"])
    occ = fix["internal_gains"]["occupancy"]
    dhw = fix["internal_gains"]["dhw"]
    sysd = fix["systems"]
    vent = fix["ventilation"][0]
    comfort = fix["comfort_band"]

    heating_demand = demand["heating_supply_air_sensible"] or 0.0
    cooling_demand = demand["cooling_supply_air_sensible"] or 0.0
    eta_heat = float(sysd["heating"]["efficiency"])
    eer_cool = float(sysd["cooling"]["efficiency"])
    eta_dhw = float(sysd["dhw"]["efficiency"])

    heating_fuel = heating_demand / eta_heat
    cooling_elec = cooling_demand / eer_cool

    # DHW — closed-form analytical (audit D5d, §2.4); identical model in both engines.
    headcount = float(occ["people"]) * float(occ["occupancy_rate"])
    litres_day = headcount * float(dhw["litres_per_person_per_day"])
    storage_c = float(dhw["storage_setpoint_c"])
    cold_c = float(dhw["cold_supply_temp_c"])
    tap_c = float(dhw["tap_outlet_temp_c"])
    hot_fraction = (tap_c - cold_c) / (storage_c - cold_c) if storage_c != cold_c else 1.0
    dhw_demand_kwh = litres_day * hot_fraction * CP_WATER_KJ_PER_KGK * (storage_c - cold_c) / 3600.0 * 365.0
    dhw_demand_mwh = dhw_demand_kwh / 1000.0
    dhw_fuel = dhw_demand_mwh / eta_dhw

    # Fan — closed-form analytical (audit D5c); SFP x flow x hours.
    sfp = float(vent["sfp_w_per_lps"])
    flow_lps = float(vent["flow_l_s"])
    hours = float(vent["hours_per_year"])
    fan_mwh = sfp * flow_lps * hours / 1e6

    lights_mwh = meters["interior_lights_electricity"] or 0.0
    equip_mwh = meters["interior_equipment_electricity"] or 0.0

    elec_total = cooling_elec + lights_mwh + equip_mwh + fan_mwh
    gas_total = heating_fuel + dhw_fuel
    eui = (elec_total + gas_total) * 1000.0 / gia

    derived = {
        "_note": ("EnergyPlus zone demand passed through the fixture's DOCUMENTED "
                  "system layer (the same efficiencies / SFP NZA-Sim uses). DHW and "
                  "fan are closed-form analytical loads with NO zone coupling (audit "
                  "D5c/D5d) — recomputed here independently from the fixture, not "
                  "copied from the NZA-Sim anchor. This block exists so EUI / fuel can "
                  "be compared; the demand-level comparison (P9) uses the raw "
                  "demand_mwh block above, not these."),
        "heating": {"demand_mwh": r(heating_demand), "efficiency": eta_heat,
                    "fuel": sysd["heating"]["fuel"], "fuel_mwh": r(heating_fuel)},
        "cooling": {"demand_mwh": r(cooling_demand), "eer": eer_cool,
                    "fuel": sysd["cooling"]["fuel"], "fuel_mwh": r(cooling_elec)},
        "dhw": {"demand_mwh": r(dhw_demand_mwh), "efficiency": eta_dhw,
                "fuel": sysd["dhw"]["fuel"], "fuel_mwh": r(dhw_fuel),
                "headcount": r(headcount, 3), "litres_per_day": r(litres_day, 1),
                "hot_fraction": r(hot_fraction, 4), "delta_t_k": storage_c - cold_c,
                "basis": "litres x cp x dT / eta (closed form, audit S2.4)"},
        "ventilation": {"fan_electrical_mwh": r(fan_mwh), "sfp_w_per_lps": sfp,
                        "flow_l_s": flow_lps, "hours": hours,
                        "recovery_sensible_pct": vent["hre_sensible_pct"],
                        "summer_bypass": vent["summer_bypass"]},
        "lighting_mwh": r(lights_mwh),
        "equipment_mwh": r(equip_mwh),
    }

    headline = {
        "eui_kwh_per_m2_yr": r(eui, 1),
        "heating_demand_mwh": r(heating_demand),
        "cooling_demand_mwh": r(cooling_demand),
        "dhw_demand_mwh": r(dhw_demand_mwh),
        "electricity_mwh": r(elec_total),
        "gas_mwh": r(gas_total),
    }
    totals = {
        "eui_kwh_per_m2_yr": r(eui, 1),
        "electricity_mwh": r(elec_total),
        "gas_mwh": r(gas_total),
        "district_heat_mwh": 0,
    }

    return {
        "brief": "Brief 81 P7 - Bridgewater-Box EnergyPlus reference",
        "source": "python validation/energyplus/run.py",
        "fixture": FIXTURE_NAME,
        "fixture_schema_version": fix.get("meta", {}).get("schema_version", 1),
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "engine": {
            "name": "EnergyPlus",
            "version": err_info.get("version"),
            "idf": str(idf.relative_to(REPO_ROOT)).replace("\\", "/"),
            "idf_sha256": sha256_of(idf),
            "weather_epw": epw.name,
            "run_dir": str(out_dir.relative_to(REPO_ROOT)).replace("\\", "/"),
            "severe_errors": err_info.get("severe_errors"),
            "warnings": err_info.get("warnings"),
            "completed_successfully": err_info.get("completed_successfully"),
            "warning_note": ("The single expected warning is 'Zone BOX_ZONE is not "
                             "fully enclosed' from the detached thermal-bridge patch "
                             "(audit D5e/S5.5); benign — explicit zone volume used."),
        },
        "geometry": {
            "gia_m2": gia,
            "volume_m3": float(geom["volume_m3"]),
            "weather_file": fix["weather"]["epw_file"],
            "comfort_band_c": {"lower_c": comfort["lower_c"], "upper_c": comfort["upper_c"]},
        },
        "demand_mwh": demand,
        "fabric_conduction_mwh": fabric,
        "windows_mwh": windows,
        "infiltration_mwh": infiltration,
        "internal_gains_mwh": internal_gains,
        "meters_mwh": meters,
        "zone_temperature": zone_temp,
        "monthly": monthly,
        "derived_delivered": derived,
        "headline": headline,
        "totals": totals,
    }


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Brief 81 P7 EnergyPlus runner + normaliser")
    ap.add_argument("--idf", default=str(DEFAULT_IDF), help="IDF to run (default: committed generated box)")
    ap.add_argument("--reuse", metavar="DIR", default=None,
                    help="Skip the EnergyPlus run; parse an existing run directory's eplusout.sql")
    ap.add_argument("--out", default=str(RESULTS_DIR / f"{FIXTURE_NAME}.json"),
                    help="Output JSON path (default: validation/energyplus/results/<fixture>.json)")
    ap.add_argument("--stdout", action="store_true", help="Print JSON to stdout instead of writing the file")
    args = ap.parse_args(argv)

    cfg = load_ep_config()
    fix = load_fixture()
    idf = Path(args.idf).resolve()
    if not idf.exists():
        sys.stderr.write(f"ERROR: IDF not found: {idf}\n")
        return 2

    if args.reuse:
        out_dir = Path(args.reuse).resolve()
        epw = resolve_weather(fix["weather"]["epw_file"])
    else:
        exe, _idd = resolve_energyplus(cfg)
        epw = resolve_weather(fix["weather"]["epw_file"])
        out_dir = (RUNS_DIR / f"{FIXTURE_NAME}_ep").resolve()
        run_energyplus(exe, epw, idf, out_dir)

    db_path = out_dir / "eplusout.sql"
    if not db_path.exists():
        sys.stderr.write(f"ERROR: no eplusout.sql in {out_dir}\n")
        return 2

    err_info = parse_err(out_dir)
    con = open_ro(db_path)
    try:
        result = normalise(con, fix, err_info, idf, epw, out_dir)
    finally:
        con.close()

    payload = json.dumps(result, indent=2)
    if args.stdout:
        print(payload)
    else:
        out_path = Path(args.out).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(payload + "\n", encoding="utf-8", newline="\n")
        print(f"[run.py] wrote {out_path.relative_to(REPO_ROOT)}", file=sys.stderr)

    # one-line console summary (ASCII only — Windows cp1252 console)
    h = result["headline"]
    eng = result["engine"]
    print(
        f"[run.py] EP {eng['version']} | {eng['warnings']}W/{eng['severe_errors']}S | "
        f"heating {h['heating_demand_mwh']} MWh | cooling {h['cooling_demand_mwh']} MWh | "
        f"EUI {h['eui_kwh_per_m2_yr']} kWh/m2",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
