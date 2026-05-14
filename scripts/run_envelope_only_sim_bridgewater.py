"""
scripts/run_envelope_only_sim_bridgewater.py

Brief 28 prereq Option C+ Step 2 — persist a genuine envelope-only EP
simulation for Bridgewater so engine_agreement.mjs can compare Static
free-running against Dynamic free-running (rather than full-sim SQL
re-parsed through the State 1 parser view).

What it does:
  1. Loads the Bridgewater project + library from the DB.
  2. Resolves the project's weather file.
  3. Assembles an envelope-only epJSON via assemble_epjson(...,
     mode='envelope-only').
  4. Runs EnergyPlus.
  5. INSERTs a row into simulation_runs with simulation_mode =
     'envelope-only', scenario_name = 'envelope-only baseline',
     status = 'complete', and results_hourly_path pointing at the
     produced eplusout.sql.
  6. Prints the new run_id so state1_engine_agreement.mjs can pick it up
     (either via run_id arg or via filtering on simulation_mode).

Idempotent in the sense that re-running creates a fresh run (new uuid +
new directory). Old envelope-only runs are not deleted.

Usage:
  python scripts/run_envelope_only_sim_bridgewater.py [project_id]
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import time
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from nza_engine.generators.epjson_assembler import assemble_epjson
from nza_engine.runner import run_simulation

DB_PATH         = REPO_ROOT / "data/nza_sim.db"
SIMULATIONS_DIR = REPO_ROOT / "data/simulations"
DEFAULT_PROJECT = "14b4a5b1-8c73-4acb-8b65-1d22f05ec969"  # HIX Bridgewater


def resolve_epw(weather_file: str) -> Path:
    for c in [REPO_ROOT / "data/weather/current" / weather_file,
              REPO_ROOT / "data/weather" / weather_file]:
        if c.exists():
            return c
    raise FileNotFoundError(f"Weather file not found: {weather_file}")


def main() -> int:
    project_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PROJECT

    if not DB_PATH.exists():
        print(f"ERROR: DB not found at {DB_PATH}")
        return 1

    # ── 1. Load project ────────────────────────────────────────────────────
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    row = con.execute(
        "SELECT name, building_config, construction_choices, systems_config, weather_file "
        "FROM projects WHERE id = ?", (project_id,)
    ).fetchone()
    if not row:
        print(f"ERROR: project {project_id} not found")
        con.close()
        return 1

    name           = row["name"]
    building       = json.loads(row["building_config"])
    constructions  = json.loads(row["construction_choices"]) if row["construction_choices"] else {}
    systems        = json.loads(row["systems_config"]) if row["systems_config"] else {}
    weather_file   = row["weather_file"] or building.get("weather_file")
    epw_path       = resolve_epw(weather_file)

    print(f"Project:        {name} ({project_id})")
    print(f"Weather file:   {epw_path.name}")

    # ── 2. Prepare run dir + assemble epJSON ───────────────────────────────
    run_id     = str(uuid.uuid4())[:8]
    run_dir    = SIMULATIONS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    epjson_path = run_dir / "input.epJSON"

    print(f"Run id:         {run_id}")
    print(f"Output dir:     {run_dir}")
    print(f"Assembling envelope-only epJSON...")

    assemble_epjson(
        building_params=building,
        construction_choices=constructions,
        weather_file_path=epw_path,
        output_path=epjson_path,
        systems_config=systems,
        mode="envelope-only",
    )
    print(f"  -> {epjson_path.name}  ({epjson_path.stat().st_size:,} bytes)")

    # ── 3. Run EnergyPlus ──────────────────────────────────────────────────
    ep_dir = os.environ.get("ENERGYPLUS_DIR")
    if not ep_dir:
        print("WARNING: ENERGYPLUS_DIR not set in environment; runner.py will fall back to its default")
        print("         (which is a macOS path and will fail on Windows). Set:")
        print(r'         $env:ENERGYPLUS_DIR = "C:\EnergyPlusV26-1-0"')
    print(f"Running EnergyPlus...")

    t0 = time.monotonic()
    sim_result = run_simulation(
        epjson_path=epjson_path,
        weather_file_path=epw_path,
        output_dir=run_dir,
    )
    runtime = time.monotonic() - t0

    if not sim_result.success:
        print(f"ERROR: EnergyPlus run failed.")
        print(f"  return_code: {sim_result.return_code}")
        print(f"  fatal_errors: {sim_result.fatal_errors}, severe_errors: {sim_result.severe_errors}")
        print(f"  err file: {sim_result.err_path}")
        con.close()
        return 1

    sql_path = sim_result.sql_path
    if not sql_path or not sql_path.exists():
        print(f"ERROR: EnergyPlus succeeded but eplusout.sql not found in {run_dir}")
        con.close()
        return 1

    print(f"  OK ({runtime:.1f}s, {sim_result.warnings} warnings, {sim_result.fatal_errors} fatal)")
    print(f"  SQL: {sql_path}")

    # ── 4. INSERT into simulation_runs ─────────────────────────────────────
    input_snapshot = json.dumps({
        "building":      building,
        "constructions": constructions,
        "systems":       systems,
    })

    con.execute(
        """
        INSERT INTO simulation_runs
            (id, project_id, scenario_name, status, input_snapshot,
             results_hourly_path,
             energyplus_warnings, energyplus_errors, simulation_time_seconds,
             simulation_mode)
        VALUES (?, ?, ?, 'complete', ?, ?, ?, 0, ?, ?)
        """,
        (
            run_id,
            project_id,
            "envelope-only baseline",
            input_snapshot,
            str(sql_path),
            sim_result.warnings,
            sim_result.runtime_seconds,
            "envelope-only",
        ),
    )
    con.commit()
    con.close()

    print()
    print("=" * 73)
    print(f"  ENVELOPE-ONLY EP RUN PERSISTED")
    print(f"  run_id:           {run_id}")
    print(f"  simulation_mode:  envelope-only")
    print(f"  project_id:       {project_id}")
    print()
    print(f"  To use in state1_engine_agreement.mjs:")
    print(f"    node scripts/state1_engine_agreement.mjs {project_id} {run_id}")
    print(f"  Or once Step 3 of the prereq lands (auto-filter by simulation_mode):")
    print(f"    node scripts/state1_engine_agreement.mjs {project_id}")
    print("=" * 73)
    return 0


if __name__ == "__main__":
    sys.exit(main())
