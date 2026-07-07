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
from state_builder import config_hash, resolved_to_idf, build_states  # noqa: E402
from generate_idf import resolve_idd  # noqa: E402
from run_full import split_delivered  # noqa: E402  (proportional-split, reused)

FIXTURE = VALIDATION_DIR / "fixtures" / "bridgewater_anchor_v2.yaml"
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


def batch_by_id(batch_id, db_path=None):
    """All rows for a batch (provenance == batch_id) — the polling interface."""
    con = _db(db_path)
    rows = con.execute("""SELECT config_hash, descriptor, status, results_json, error_tail
                          FROM ep_runs WHERE provenance=? ORDER BY started""", (batch_id,)).fetchall()
    con.close()
    return [{"config_hash": r[0], "descriptor": r[1], "status": r[2],
             "results": json.loads(r[3]) if r[3] else None, "error_tail": r[4]} for r in rows]


NZA_DB = REPO_ROOT / "data" / "nza_sim.db"


def load_project_fix(project_id):
    """Build a fix-shaped config from the CURRENT DB project (so edits change the hash).
    Library constructions come from the frozen fixture (ZZ TEST uses the same set; the
    Bridgewater stack has no U-value edits) — building_config/choices/comfort come live."""
    con = sqlite3.connect(NZA_DB)
    row = con.execute("""SELECT building_config, construction_choices,
                         comfort_band_lower_c, comfort_band_upper_c FROM projects WHERE id=?""",
                      (project_id,)).fetchone()
    con.close()
    if not row:
        raise ValueError(f"project not found: {project_id}")
    bc = json.loads(row[0])
    cc = json.loads(row[1]) if isinstance(row[1], str) else row[1]
    fixture = yaml.safe_load(FIXTURE.read_text())
    return {"building_config": bc, "construction_choices": cc,
            "comfort_band": {"lower_c": row[2], "upper_c": row[3]},
            "library_constructions": fixture["library_constructions"],
            "weather_file": bc.get("weather_file")}


# ── selection → states ───────────────────────────────────────────────────────
def build_selected(fix, selection):
    """selection = {cumulative: bool, isolated: [library_ids]}. Returns [(descriptor, config)]
    including the baseline. States are the resolved fix-shaped configs (state_builder)."""
    by = {iv["id"]: iv for iv in fix["building_config"]["interventions"]}
    refs = fix["building_config"]["strategies"][0]["refs"]
    st = build_states(fix, refs, by)
    out = [("baseline", st["baseline"]["config"])]
    if selection.get("cumulative"):
        for c in st["cumulative"]:
            out.append((f"cumulative:{c['through']}", c["config"]))
    for iid in selection.get("isolated", []):
        if iid in st["isolated"]:
            out.append((f"isolated:{iid}", st["isolated"][iid]["config"]))
    return out


def prequeue(states, batch_id, db_path=None):
    """Insert all selected states as 'queued' (or re-tag already-'done' ones) under batch_id,
    so the UI sees the full queue immediately. Returns the config_hashes in order."""
    con = _db(db_path)
    hashes = []
    for desc, cfg in states:
        h = config_hash(cfg); hashes.append(h)
        row = con.execute("SELECT status FROM ep_runs WHERE config_hash=?", (h,)).fetchone()
        if row and row[0] == "done":
            con.execute("UPDATE ep_runs SET provenance=?, descriptor=? WHERE config_hash=?", (batch_id, desc, h))
        else:
            con.execute("""INSERT OR REPLACE INTO ep_runs (config_hash, descriptor, status, provenance, ep_version)
                           VALUES (?,?,?,?,?)""", (h, desc, "queued", batch_id, EP_VERSION))
    con.commit(); con.close()
    return hashes


def plan(fix, selection, db_path=None):
    """Compute the CURRENT config hashes for the selection + whether each is cached
    (status 'done'). No EP runs — fast. This is what powers the live 'M cached' count;
    because the hash is over the current resolved config, editing a definition + Apply
    yields new hashes → not cached (Brief 95 P6 requirement)."""
    con = _db(db_path)
    out = []
    for desc, cfg in build_selected(fix, selection):
        h = config_hash(cfg)
        row = con.execute("SELECT status FROM ep_runs WHERE config_hash=?", (h,)).fetchone()
        out.append({"descriptor": desc, "config_hash": h, "cached": bool(row and row[0] == "done")})
    con.close()
    return out


def _fix_for(args):
    return load_project_fix(args.project_id) if args.project_id else yaml.safe_load(FIXTURE.read_text())


def main():
    import argparse
    ap = argparse.ArgumentParser(description="EP batch runner (invoked as a subprocess by the backend).")
    ap.add_argument("--selection", required=True, help='JSON {"cumulative":bool,"isolated":[ids]}')
    ap.add_argument("--batch-id")
    ap.add_argument("--project-id", help="build states from this DB project (else the frozen fixture)")
    ap.add_argument("--plan", action="store_true", help="print hashes+cache flags as JSON; no EP runs")
    args = ap.parse_args()
    fix = _fix_for(args)
    selection = json.loads(args.selection)
    if args.plan:
        print(json.dumps(plan(fix, selection)))
        return
    states = build_selected(fix, selection)
    prequeue(states, args.batch_id)
    epw = REPO_ROOT / "data" / "weather" / "current" / fix["building_config"]["weather_file"]
    run_batch(states, epw, resolve_idd(), args.batch_id)


if __name__ == "__main__":
    main()
