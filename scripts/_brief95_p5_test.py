#!/usr/bin/env python3
"""Brief 95 P5 — batch runner + config-hash cache tests (runs real EP; fast, <1 s/state).

Run: ENERGYPLUS_DIR=/Applications/EnergyPlus-25-2-0 validation/.venv/bin/python scripts/_brief95_p5_test.py
"""
import copy
import sys
import tempfile
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
EP_DIR = REPO / "validation" / "energyplus"
sys.path.insert(0, str(EP_DIR))
from state_builder import build_states, apply_patch, config_hash  # noqa: E402
from generate_idf import resolve_idd  # noqa: E402
import ep_batch_runner as R  # noqa: E402

FIX = yaml.safe_load((REPO / "validation" / "fixtures" / "bridgewater_anchor_v2.yaml").read_text())
BY = {iv["id"]: iv for iv in FIX["building_config"]["interventions"]}
REFS = FIX["building_config"]["strategies"][0]["refs"]
EPW = REPO / "data" / "weather" / "current" / FIX["building_config"]["weather_file"]
IDD = resolve_idd()

_p = _f = 0
def ok(name, cond):
    global _p, _f
    if cond: _p += 1; print(f"  ✓ {name}")
    else: _f += 1; print(f"  ✗ FAIL: {name}")

tmpdb = Path(tempfile.mkdtemp()) / "ep_runs_test.db"

# Two valid states: baseline + one isolated (Plug-load, a mappable physical patch).
st = build_states(FIX, REFS, BY)
base_cfg = st["baseline"]["config"]
plug_id = next(k for k, v in BY.items() if "Plug-load" in (v.get("label") or ""))
plug_cfg = st["isolated"][plug_id]["config"]
states = [("baseline", base_cfg), ("isolated:plug", plug_cfg)]

print("── batch run 1 (cold cache) ──")
r1 = R.run_batch(states, EPW, IDD, "test", db_path=tmpdb)
ok("both states ran to 'done'", all(s["status"] == "done" for s in r1))
ok("baseline result has EUI", r1[0]["results"]["eui_kwh_per_m2_yr"] > 0)
ok("the two states have different config hashes", r1[0]["config_hash"] != r1[1]["config_hash"])

print("── batch run 2 (warm cache — must perform 0 EP executions) ──")
r2 = R.run_batch(states, EPW, IDD, "test", db_path=tmpdb)
ok("both states served from cache (status='cached')", all(s["status"] == "cached" for s in r2))
ok("cached results identical to run 1", r2[0]["results"] == r1[0]["results"] and r2[1]["results"] == r1[1]["results"])

print("── broken state FAILS with error tail + does NOT block the queue ──")
broken = copy.deepcopy(FIX)
# inverted setpoints (heating 30 > cooling 20) → EP fatal.
for op in [("systems_config_v40.heating_setpoint_mode", "custom"),
           ("systems_config_v40.heating_setpoint_c", 30),
           ("systems_config_v40.cooling_setpoint_mode", "custom"),
           ("systems_config_v40.cooling_setpoint_c", 20)]:
    apply_patch(broken, {"op": "set", "path": "building." + op[0], "value": op[1]})
# fresh isolated state that hasn't been cached, so it must actually run after the broken one
setp_cfg = copy.deepcopy(base_cfg)
apply_patch(setp_cfg, {"op": "set", "path": "building.systems_config_v40.cooling_setpoint_mode", "value": "custom"})
apply_patch(setp_cfg, {"op": "set", "path": "building.systems_config_v40.cooling_setpoint_c", "value": 26})
batch2 = R.run_batch([("broken:inverted-sp", broken), ("valid:cool26", setp_cfg)], EPW, IDD, "test", db_path=tmpdb)
ok("broken state recorded FAILED", batch2[0]["status"] == "failed")
ok("broken state has an error tail", bool(batch2[0].get("error_tail")))
ok("queue continued — the following valid state still ran", batch2[1]["status"] == "done")

print("── API surface: progress + fetch ──")
prog = R.batch_progress([config_hash(base_cfg), config_hash(broken)], db_path=tmpdb)
ok("progress reports done for baseline, failed for broken",
   prog[config_hash(base_cfg)] == "done" and prog[config_hash(broken)] == "failed")
fetched = R.fetch_result(config_hash(base_cfg), db_path=tmpdb)
ok("fetch_result returns the stored normalised result", fetched["results"]["eui_kwh_per_m2_yr"] > 0)

print(f"\n{'─'*48}\n{'✅ ALL PASS' if _f == 0 else '❌ FAILURES'}: {_p} passed, {_f} failed\n")
sys.exit(0 if _f == 0 else 1)
