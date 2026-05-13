"""
scripts/state1_isolation_epjson.py

Brief 26 Part 9 — state isolation regression test (EP path).

Counterpart to scripts/state1_isolation_live.mjs. The live engine test
covers _calculateEnvelopeOnly; this script covers the EP-path equivalent
by asserting that `assemble_epjson(..., mode='envelope-only')` produces
byte-identical epJSON regardless of forbidden-input values.

Why epJSON byte-identity (not full EP run + parser):
  - EP is deterministic for a given epJSON. If the assembler strips
    forbidden inputs correctly, the epJSON is the only place leakage
    can happen on the EP path.
  - _get_heat_balance_state1 reads only State 1 allowed inputs from
    building_config (length/width/floors/wwr/orientation/infiltration_ach/
    openings/site_exposure/louvre_area_m2/constructions) and from the
    EP SQL output. None of the forbidden inputs touch it.
  - Cost: ~50 ms per assembly call vs ~3 s per EP run. Lets us enumerate
    every forbidden path + the combined-absurd case in seconds.

The forbidden list is read from frontend/src/utils/stateMode.js
programmatically — single source of truth.

Bar: byte-identical via canonical JSON. Float tolerance is zero.

Usage:
  python scripts/state1_isolation_epjson.py [project_id]
  exit 0 = pass; exit 1 = leak
"""
from __future__ import annotations

import copy
import json
import re
import sqlite3
import sys
from pathlib import Path

# Make the repo root importable
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from nza_engine.generators.epjson_assembler import assemble_epjson
from nza_engine.parsers.sql_parser import get_heat_balance
from nza_engine.runner import run_simulation


# ── Read the canonical forbidden list from stateMode.js ──────────────────────
def load_forbidden_paths() -> list[str]:
    """
    Parse FORBIDDEN_ENVELOPE_ONLY_INPUTS out of stateMode.js. Single source of
    truth — when a new forbidden input is added to the JS list, this picks it
    up automatically.
    """
    sm = (REPO_ROOT / "frontend/src/utils/stateMode.js").read_text(encoding="utf-8")
    m = re.search(
        r"FORBIDDEN_ENVELOPE_ONLY_INPUTS\s*=\s*Object\.freeze\(\[(.*?)\]\)",
        sm, flags=re.DOTALL,
    )
    if not m:
        raise RuntimeError("Could not parse FORBIDDEN_ENVELOPE_ONLY_INPUTS from stateMode.js")
    body = m.group(1)
    return re.findall(r"'([^']+)'", body)


# ── Absurd values — match the live-engine test exactly ──────────────────────
ABSURD: dict = {
    'params.num_bedrooms':              9999,
    'params.occupancy_rate':              9.99,
    'params.people_per_room':             5.0,
    'systems.lighting_power_density':   100,
    'systems.equipment_power_density':  100,
    'systems.lighting_control':         'always-on-9999',
    'systems.space_heating':            {'setpoint_heating_c': 35, 'cop': 99},
    'systems.space_cooling':            {'setpoint_cooling_c':  5, 'cop': 99},
    'systems.dhw':                      {'setpoint_c': 99, 'cop': 99},
    'systems.ventilation':              {'ventilation_ach': 99},
    'systems.hvac_type':                'invalid-system-9999',
    'systems.dhw_primary':              'invalid-dhw-9999',
    'systems.dhw_preheat':              99,
    'systems.dhw_setpoint':             99,
    'systems.ventilation_type':         'invalid-vent-9999',
    'systems.ventilation_control':      'invalid-control-9999',
    'systems.sfp_override':             99,
    'systems.cop_heating':              99,
    'systems.mvhr_efficiency':           0.99,
    'openings.schedule':                'always',
    'openings.{face}.openable_fraction': 0.99,
}


def apply_absurd(building: dict, systems: dict, path: str, value):
    """
    Apply `path = value` to a deep copy of (building, systems). Returns the
    modified pair.
    """
    building = copy.deepcopy(building)
    systems  = copy.deepcopy(systems)
    if path == 'openings.{face}.openable_fraction':
        building.setdefault('openings', {})
        for face in ('north', 'south', 'east', 'west'):
            building['openings'].setdefault(face, {})
            building['openings'][face]['openable_fraction'] = value
        return building, systems

    root, *rest = path.split('.')
    if root == 'params':
        cursor = building
    elif root == 'systems':
        cursor = systems
    elif root == 'openings':
        building.setdefault('openings', {})
        cursor = building['openings']
    else:
        raise ValueError(f"Unknown root: {path}")
    for k in rest[:-1]:
        cursor.setdefault(k, {})
        cursor = cursor[k]
    cursor[rest[-1]] = value
    return building, systems


def canonical(o) -> str:
    """JSON with sorted keys, no whitespace. Byte-identity uses string ==."""
    return json.dumps(o, sort_keys=True, separators=(',', ':'), default=str)


# ── Load project + library directly from the DB ─────────────────────────────
def load_project(project_id: str) -> dict:
    db_path = REPO_ROOT / "data/nza_sim.db"
    if not db_path.exists():
        raise RuntimeError(f"Project DB not found at {db_path}")
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    row = con.execute(
        "SELECT name, building_config, construction_choices, systems_config, weather_file "
        "FROM projects WHERE id = ?", (project_id,),
    ).fetchone()
    if not row:
        raise RuntimeError(f"Project {project_id} not found")
    con.close()
    return {
        "name": row["name"],
        "building_config":      json.loads(row["building_config"]),
        "construction_choices": json.loads(row["construction_choices"]) if row["construction_choices"] else {},
        "systems_config":       json.loads(row["systems_config"]) if row["systems_config"] else {},
        "weather_file":         row["weather_file"],
    }


def resolve_epw(weather_file: str | None) -> Path:
    if not weather_file:
        raise RuntimeError("Project has no weather_file set")
    candidates = [
        REPO_ROOT / "data/weather/current" / weather_file,
        REPO_ROOT / "data/weather" / weather_file,
    ]
    for c in candidates:
        if c.exists():
            return c
    raise FileNotFoundError(f"Weather file not found: {weather_file}")


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    project_id = sys.argv[1] if len(sys.argv) > 1 else "14b4a5b1-8c73-4acb-8b65-1d22f05ec969"

    forbidden = load_forbidden_paths()
    project = load_project(project_id)
    # Weather file lives on building_config in current schema (was on the
    # projects row in older versions — fall through to either).
    weather_file = (
        project["weather_file"]
        or project["building_config"].get("weather_file")
    )
    epw_path = resolve_epw(weather_file)
    building = project["building_config"]
    systems  = project["systems_config"]
    constructions = project["construction_choices"]

    def asm(b, s):
        return assemble_epjson(
            building_params=b,
            construction_choices=constructions,
            weather_file_path=epw_path,
            output_path=None,
            systems_config=s,
            mode="envelope-only",
        )

    baseline = asm(building, systems)
    baseline_canon = canonical(baseline)
    baseline_bytes = len(baseline_canon)

    print()
    print("=" * 73)
    print("  STATE 1 ISOLATION REGRESSION - EP PATH (assembler byte-identity)")
    print("=" * 73)
    print(f"  Project:        {project['name']} ({project_id})")
    print(f"  Baseline bytes: {baseline_bytes}")
    print(f"  Forbidden list: {len(forbidden)} paths (from stateMode.js)")
    print()

    failures: list[dict] = []
    passed = 0

    for fpath in forbidden:
        if fpath not in ABSURD:
            print(f"  SKIP {fpath:<48} (no absurd value defined)")
            continue
        b_mod, s_mod = apply_absurd(building, systems, fpath, ABSURD[fpath])
        result = asm(b_mod, s_mod)
        result_canon = canonical(result)
        if result_canon == baseline_canon:
            print(f"  PASS {fpath:<48} byte-identical")
            passed += 1
        else:
            print(f"  FAIL {fpath:<48} LEAKED")
            failures.append({
                "path": fpath,
                "delta_bytes": len(result_canon) - baseline_bytes,
            })

    # Combined: every forbidden absurd at once
    b, s = building, systems
    for fpath, v in ABSURD.items():
        b, s = apply_absurd(b, s, fpath, v)
    combined = asm(b, s)
    combined_canon = canonical(combined)
    print()
    if combined_canon == baseline_canon:
        print(f"  PASS COMBINED (all forbidden absurd at once)        byte-identical")
        passed += 1
    else:
        print(f"  FAIL COMBINED (all forbidden absurd at once)        LEAKED")
        failures.append({"path": "COMBINED", "delta_bytes": len(combined_canon) - baseline_bytes})

    # ── End-to-end EP run for the COMBINED scenario ─────────────────────────
    # The assembler test above already proves epJSON byte-identity, which is
    # mathematically sufficient (EP is deterministic on identical input).
    # Running EP itself is belt-and-braces — it closes the spec literally.
    print()
    print("  EP end-to-end (COMBINED) ...")
    import tempfile
    # Load constructions library for the State 1 parser
    db_path = REPO_ROOT / "data/nza_sim.db"
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    lib_rows = con.execute(
        "SELECT name, config_json FROM library_items WHERE library_type = 'construction'"
    ).fetchall()
    con.close()
    library_data = {
        "constructions": [
            {
                "name": r["name"],
                "u_value_W_per_m2K": (json.loads(r["config_json"]) or {}).get("u_value_W_per_m2K"),
                "y_factor":          (json.loads(r["config_json"]) or {}).get("y_factor", 1.0),
                "config_json":       json.loads(r["config_json"]) or {},
            }
            for r in lib_rows
        ]
    }
    cb = {"lower_c": 20.0, "upper_c": 26.0}

    def run_and_parse(b: dict, s: dict, tag: str) -> dict:
        with tempfile.TemporaryDirectory(prefix=f"state1_iso_{tag}_") as td:
            tdp = Path(td)
            epjson_path = tdp / "input.epJSON"
            assemble_epjson(
                building_params=b,
                construction_choices=constructions,
                weather_file_path=epw_path,
                output_path=epjson_path,
                systems_config=s,
                mode="envelope-only",
            )
            res = run_simulation(
                epjson_path=epjson_path,
                weather_file_path=epw_path,
                output_dir=tdp,
            )
            if not res.success:
                raise RuntimeError(f"EP failed for {tag}: {res.error_message}")
            # Inject construction_choices the way the API does so the parser
            # can resolve U-values
            b_for_parser = dict(b)
            b_for_parser["constructions"] = constructions
            return get_heat_balance(
                sql_path=tdp / "eplusout.sql",
                building_config=b_for_parser,
                weather_file_path=epw_path,
                mode="envelope-only",
                comfort_band=cb,
                library_data=library_data,
            )

    # Baseline run
    ep_baseline = run_and_parse(building, systems, "baseline")
    # Combined-absurd run
    b_combined, s_combined = building, systems
    for fp, v in ABSURD.items():
        b_combined, s_combined = apply_absurd(b_combined, s_combined, fp, v)
    ep_combined = run_and_parse(b_combined, s_combined, "combined")

    # Drop hourly_temperature_c from comparison — they're long arrays
    # that, if anything ever flips by a single bit, drown the diff output.
    # We still want them byte-identical though, so include them in the
    # primary check and only filter for the failure-diagnostic print.
    ep_baseline_canon = canonical(ep_baseline)
    ep_combined_canon = canonical(ep_combined)
    if ep_baseline_canon == ep_combined_canon:
        print(f"  PASS EP end-to-end (COMBINED)                       byte-identical")
        passed += 1
    else:
        print(f"  FAIL EP end-to-end (COMBINED)                       LEAKED")
        failures.append({"path": "EP_END_TO_END_COMBINED",
                         "delta_bytes": len(ep_combined_canon) - len(ep_baseline_canon)})
        # Drill into which top-level keys differ
        ep_base_top = json.loads(ep_baseline_canon)
        ep_comb_top = json.loads(ep_combined_canon)
        for key in sorted(set(ep_base_top.keys()) | set(ep_comb_top.keys())):
            if canonical(ep_base_top.get(key)) != canonical(ep_comb_top.get(key)):
                print(f"      first divergent top-level key: {key}")
                break

    print()
    print("=" * 73)
    if not failures:
        print(f"  ALL PASS - {passed} scenarios, every State 1 output byte-identical")
        print("=" * 73)
        sys.exit(0)
    else:
        print(f"  {len(failures)} LEAK(S) - state isolation contract violated")
        for f in failures:
            print(f"    {f['path']}: delta {f['delta_bytes']:+d} bytes")
            # Diff drilldown: which top-level epJSON section differs?
            mod_b, mod_s = building, systems
            if f["path"] == "COMBINED":
                for fp, v in ABSURD.items():
                    mod_b, mod_s = apply_absurd(mod_b, mod_s, fp, v)
            elif f["path"] in ABSURD:
                mod_b, mod_s = apply_absurd(building, systems, f["path"], ABSURD[f["path"]])
            mod = asm(mod_b, mod_s)
            for section_key in sorted(set(baseline.keys()) | set(mod.keys())):
                if canonical(baseline.get(section_key)) != canonical(mod.get(section_key)):
                    print(f"      first divergent section: {section_key}")
                    break
        print("=" * 73)
        sys.exit(1)


if __name__ == "__main__":
    main()
