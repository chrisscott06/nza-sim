"""
scripts/state2_isolation_epjson.py

Brief 27 Part 8 — state isolation regression test (EP path, State 2).

Counterpart to scripts/state2_isolation_live.mjs. Confirms
`assemble_epjson(..., mode='envelope-gains')` produces byte-identical
epJSON regardless of forbidden-input values.

State 2 forbidden set is read from `FORBIDDEN_ENVELOPE_GAINS_INPUTS` in
stateMode.js — single source of truth.

Bar: byte-identical via canonical JSON. Float tolerance is zero.

Usage:
  python scripts/state2_isolation_epjson.py [project_id]
  exit 0 = pass; exit 1 = leak
"""
from __future__ import annotations

import copy
import json
import re
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from nza_engine.generators.epjson_assembler import assemble_epjson


# ── Read the canonical forbidden list from stateMode.js ──────────────────────
_MIN_FORBIDDEN_PATHS = 18  # tripwire

def load_forbidden_paths() -> list[str]:
    """Parse FORBIDDEN_ENVELOPE_GAINS_INPUTS out of stateMode.js."""
    sm = (REPO_ROOT / "frontend/src/utils/stateMode.js").read_text(encoding="utf-8")
    m = re.search(
        r"FORBIDDEN_ENVELOPE_GAINS_INPUTS\s*=\s*Object\.freeze\(\[(.*?)\]\)",
        sm, flags=re.DOTALL,
    )
    if not m:
        raise RuntimeError("Could not parse FORBIDDEN_ENVELOPE_GAINS_INPUTS from stateMode.js")
    body = m.group(1)
    paths = re.findall(r"'([^']+)'", body)
    if len(paths) < _MIN_FORBIDDEN_PATHS:
        raise RuntimeError(
            f"Parsed only {len(paths)} forbidden paths — expected >= {_MIN_FORBIDDEN_PATHS}. "
            f"The regex may have broken against reformatted source."
        )
    return paths


# ── Absurd values — mirror the live-engine test ─────────────────────────────
ABSURD: dict = {
    'params.occupancy_rate':            9.99,
    'params.people_per_room':            5.0,
    'systems.lighting_power_density':  100,
    'systems.equipment_power_density': 100,
    'systems.lighting_control':       'always-on-9999',
    'systems.space_heating':           {'setpoint_heating_c': 35, 'cop': 99},
    'systems.space_cooling':           {'setpoint_cooling_c':  5, 'cop': 99},
    'systems.dhw':                     {'setpoint_c': 99, 'cop': 99},
    'systems.ventilation':             {'ventilation_ach': 99},
    'systems.hvac_type':              'invalid-system-9999',
    'systems.dhw_primary':            'invalid-dhw-9999',
    'systems.dhw_preheat':            99,
    'systems.dhw_setpoint':           99,
    'systems.ventilation_type':       'invalid-vent-9999',
    'systems.ventilation_control':    'invalid-control-9999',
    'systems.sfp_override':           99,
    'systems.cop_heating':            99,
    'systems.mvhr_efficiency':         0.99,
    'openings.schedule':              'always',
    'openings.{face}.openable_fraction': 0.99,
}


def apply_absurd(building: dict, systems: dict, path: str, value):
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
    return json.dumps(o, sort_keys=True, separators=(',', ':'), default=str)


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
    for c in [REPO_ROOT / "data/weather/current" / weather_file,
              REPO_ROOT / "data/weather" / weather_file]:
        if c.exists():
            return c
    raise FileNotFoundError(f"Weather file not found: {weather_file}")


def main():
    project_id = sys.argv[1] if len(sys.argv) > 1 else "14b4a5b1-8c73-4acb-8b65-1d22f05ec969"

    forbidden = load_forbidden_paths()
    project = load_project(project_id)
    weather_file = (project["weather_file"] or project["building_config"].get("weather_file"))
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
            mode="envelope-gains",
        )

    baseline = asm(building, systems)
    baseline_canon = canonical(baseline)
    baseline_bytes = len(baseline_canon)

    print()
    print("=" * 73)
    print("  STATE 2 ISOLATION REGRESSION - EP PATH (assembler byte-identity)")
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
            failures.append({"path": fpath, "delta_bytes": len(result_canon) - baseline_bytes})

    # Combined
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

    print()
    print("=" * 73)
    if not failures:
        print(f"  PASS ALL — {passed} scenarios, every State 2 epJSON byte-identical")
        print("=" * 73)
        sys.exit(0)
    else:
        print(f"  FAIL {len(failures)} LEAK(S) — state isolation contract violated")
        for f in failures:
            print(f"    {f['path']}: delta {'+' if f['delta_bytes'] >= 0 else ''}{f['delta_bytes']} bytes")
        print("=" * 73)
        sys.exit(1)


if __name__ == "__main__":
    main()
