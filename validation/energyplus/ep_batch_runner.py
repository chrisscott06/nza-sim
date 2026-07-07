#!/usr/bin/env python3
# ============================================================================
# Brief 95 P5 — EnergyPlus batch runner + config-hash cache (ep_runs table)
# ============================================================================
#
# Runs a queue of selected states (each a fully-resolved fix-shaped config) through
# EnergyPlus one at a time (minutes-scale), parses demand → consumption, and stores the
# normalised result keyed by config_hash. Cached hashes are NEVER re-run. Failures are
# stored with the .err tail and DO NOT block the rest of the queue (no silent retry).
#
#   ep_runs(config_hash PK, descriptor, status, started, finished, results_json,
#           ep_version, provenance, error_tail)
#   run_state(config, descriptor, …)  — one state: cache-check → run → parse → store
#   run_batch(states, …)              — queue; isolates per-state failures
#
# API (thin, importable by the FastAPI backend): start_batch / batch_progress / fetch_result.
# ============================================================================

import json
import os
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import yaml

SCRIPT_DIR = Path(__file__).resolve().parent
VALIDATION_DIR = SCRIPT_DIR.parent
REPO_ROOT = VALIDATION_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))
from state_builder import config_hash, resolved_to_idf  # noqa: E402
from generate_idf import resolve_idd  # noqa: E402
from run_full import split_delivered  # noqa: E402  (proportional-split, reused)

EP_RUNS_DB = REPO_ROOT / "data" / "ep_runs.db"
RUNS_DIR = SCRIPT_DIR / "runs" / "ep_batch"
EP_VERSION = "25.2.0-cf7368216c"
CP_KJ = 4.186
HOURS = 8760.0
J_TO_MWH = 3.6e9


def _db(path=None):
    con = sqlite3.connect(path or EP_RUNS_DB)
    con.execute("""CREATE TABLE IF NOT EXISTS ep_runs (
        config_hash TEXT PRIMARY KEY, descriptor TEXT, status TEXT,
        started TEXT, finished TEXT, results_json TEXT, ep_version TEXT,
        provenance TEXT, error_tail TEXT)""")
    return con


def _resolve_ep_exe():
    base = os.environ.get("ENERGYPLUS_DIR") or json.loads((SCRIPT_DIR / "ep_config.json").read_text())["install_dir"]
    return Path(base) / "energyplus"


def _run_ep(idf_text, run_dir, epw):
    run_dir.mkdir(parents=True, exist_ok=True)
    idf_path = run_dir / "in.idf"
    idf_path.write_text(idf_text)
    r = subprocess.run([str(_resolve_ep_exe()), "-w", str(epw), "-d", str(run_dir), "-r", str(idf_path)],
                       capture_output=True, text=True)
    err = run_dir / "eplusout.err"
    err_txt = err.read_text() if err.exists() else r.stderr
    ok = "EnergyPlus Completed Successfully" in err_txt and " 0 Severe Errors" in err_txt
    tail = "\n".join(err_txt.splitlines()[-12:])
    return ok, tail


def _read_demand(sql_path):
    db = sqlite3.connect(sql_path)
    out = {"heating": 0.0, "cooling": 0.0, "facility_elec": 0.0}
    q = """SELECT rdd.Name, SUM(rd.Value) FROM ReportData rd
           JOIN ReportDataDictionary rdd ON rd.ReportDataDictionaryIndex=rdd.ReportDataDictionaryIndex
           WHERE rdd.ReportingFrequency='Run Period' GROUP BY rdd.Name"""
    for name, val in db.execute(q):
        if "Ideal Loads Zone Sensible Heating Energy" in name:
            out["heating"] = val / J_TO_MWH
        elif "Ideal Loads Zone Sensible Cooling Energy" in name:
            out["cooling"] = val / J_TO_MWH
        elif name == "Electricity:Facility":
            out["facility_elec"] = val / J_TO_MWH
    db.close()
    return out


def consumption_from_demand(fix, dem):
    """demand (heating/cooling MWh + facility elec) → normalised consumption, with the
    deterministic DHW + fixed-efficiency splits (same model as run_full.py)."""
    bc = fix["building_config"]; v40 = bc["systems_config_v40"]
    gia = float(bc["length"]) * float(bc["width"]) * int(bc["num_floors"])
    hf, _ = split_delivered(dem["heating"], v40["heating"])
    cf, _ = split_delivered(dem["cooling"], v40["cooling"])
    people = int(bc["num_bedrooms"]) * int(bc["people_per_room"])
    dhw_mwh = float(v40["dhw_demand_litres_per_person_per_day"]) * people * 365.0 * CP_KJ \
        * (float(v40["dhw_tap_outlet_temp_c"]) - float(v40["dhw_cold_supply_temp_c"])) / 3.6e6
    df, _ = split_delivered(dhw_mwh, v40["dhw"])
    vent = sum(float(v["efficiency_metric"]["sfp_w_per_lps"]) * float(v["flow_rate"]) * HOURS / 1e9
               for v in v40["ventilation"] if v.get("enabled", True))
    elec = dem["facility_elec"] + hf.get("electricity", 0) + cf.get("electricity", 0) + df.get("electricity", 0) + vent
    gas = hf.get("gas", 0) + cf.get("gas", 0) + df.get("gas", 0)
    return {"demand_mwh": {"space_heating": round(dem["heating"], 3), "space_cooling": round(dem["cooling"], 3),
                           "dhw": round(dhw_mwh, 3)},
            "consumption_mwh": {"electricity": round(elec, 3), "gas": round(gas, 3),
                                "ventilation_fans": round(vent, 3)},
            "eui_kwh_per_m2_yr": round((elec + gas) * 1000.0 / gia, 1)}


def run_state(fix_config, descriptor, epw, idd, provenance, db_path=None, force=False):
    con = _db(db_path)
    h = config_hash(fix_config)
    row = con.execute("SELECT status, results_json FROM ep_runs WHERE config_hash=?", (h,)).fetchone()
    if row and row[0] == "done" and not force:
        con.close()
        return {"config_hash": h, "descriptor": descriptor, "status": "cached",
                "results": json.loads(row[1]) if row[1] else None}

    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    con.execute("""INSERT OR REPLACE INTO ep_runs (config_hash, descriptor, status, started, ep_version, provenance)
                   VALUES (?,?,?,?,?,?)""", (h, descriptor, "running", started, EP_VERSION, provenance))
    con.commit()
    run_dir = RUNS_DIR / h
    ok, tail = _run_ep(resolved_to_idf(fix_config, idd), run_dir, epw)
    finished = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if not ok:
        con.execute("UPDATE ep_runs SET status='failed', finished=?, error_tail=? WHERE config_hash=?",
                    (finished, tail, h))
        con.commit(); con.close()
        return {"config_hash": h, "descriptor": descriptor, "status": "failed", "error_tail": tail}
    results = consumption_from_demand(fix_config, _read_demand(run_dir / "eplusout.sql"))
    con.execute("UPDATE ep_runs SET status='done', finished=?, results_json=? WHERE config_hash=?",
                (finished, json.dumps(results), h))
    con.commit(); con.close()
    return {"config_hash": h, "descriptor": descriptor, "status": "done", "results": results}


def run_batch(states, epw, idd, provenance, db_path=None):
    """states: list of (descriptor, resolved_config). Per-state failures are isolated —
    a broken state records FAILED and the queue continues."""
    out = []
    for descriptor, cfg in states:
        try:
            out.append(run_state(cfg, descriptor, epw, idd, provenance, db_path=db_path))
        except Exception as e:  # never let one state kill the batch
            out.append({"descriptor": descriptor, "status": "failed", "error_tail": repr(e)})
    return out


# ── thin API surface (importable by the FastAPI backend) ─────────────────────
def batch_progress(hashes, db_path=None):
    con = _db(db_path)
    rows = {r[0]: r[1] for r in con.execute(
        "SELECT config_hash, status FROM ep_runs WHERE config_hash IN (%s)" % ",".join("?" * len(hashes)), hashes)}
    con.close()
    return {h: rows.get(h, "queued") for h in hashes}


def fetch_result(h, db_path=None):
    con = _db(db_path)
    row = con.execute("SELECT status, results_json, error_tail FROM ep_runs WHERE config_hash=?", (h,)).fetchone()
    con.close()
    if not row:
        return None
    return {"status": row[0], "results": json.loads(row[1]) if row[1] else None, "error_tail": row[2]}
