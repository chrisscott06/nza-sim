"""
scripts/test_api_simulate_mode.py — Brief 30 Phase 1.0 regression test.

This is the test that would have caught Brief 29 Issue #13 originally.

Bug history: prior to Brief 30 Phase 1.0 (commit at end of Phase 1.0), the
`POST /api/projects/{project_id}/simulate` endpoint declared `mode: str =
"full"` as a simple-type parameter. FastAPI parses that as a query-string
parameter; JSON body `{"mode":"envelope-only"}` was silently dropped and
the default `"full"` was used. Every JSON-body caller — and there were
several, including the Brief 29 Part 2 diagnostic — got a full-mode
simulation that the parser then mis-interpreted as State 1.

This test exercises both forms (query string AND JSON body) and asserts
that the resulting epJSON correctly reflects `mode=envelope-only` —
specifically: NO `ZoneHVAC:TerminalUnit:VariableRefrigerantFlow`,
NO `ZoneVentilation:DesignFlowRate`, NO `DesignSpecification:OutdoorAir`.

Per Bible lesson from Brief 30: "Parameter binding at an API boundary can
silently disable a feature without raising any error. The only thing that
catches this is an end-to-end test verifying that calling the feature with
input X actually produces behaviour X downstream."

Run from project root with backend up:
    python scripts/test_api_simulate_mode.py

Or against an arbitrary host:
    python scripts/test_api_simulate_mode.py http://localhost:8002
"""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

DEFAULT_HOST = "http://127.0.0.1:8002"
BRIDGEWATER_ID = "14b4a5b1-8c73-4acb-8b65-1d22f05ec969"
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Object types that MUST be absent in a correctly-invoked envelope-only run
STATE1_FORBIDDEN_OBJECTS = [
    "ZoneHVAC:TerminalUnit:VariableRefrigerantFlow",
    "AirConditioner:VariableRefrigerantFlow",
    "ZoneTerminalUnitList",
    "ZoneVentilation:DesignFlowRate",
    "DesignSpecification:OutdoorAir",
    "OutdoorAir:Node",
    "Sizing:Zone",
    "SizingPeriod:DesignDay",
]


def _post(url: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else b"{}"
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read().decode())


def _load_epjson(run_id: str) -> dict:
    path = PROJECT_ROOT / "data" / "simulations" / run_id / "input.epJSON"
    if not path.exists():
        raise FileNotFoundError(f"epJSON not found for run {run_id}: {path}")
    return json.loads(path.read_text())


def _assert_state1(label: str, epjson: dict) -> None:
    failures: list[str] = []
    for obj_type in STATE1_FORBIDDEN_OBJECTS:
        count = len(epjson.get(obj_type, {}))
        if count > 0:
            failures.append(f"{obj_type}: {count} entries (expected 0)")

    # Schedule:Constant should contain state1_heating_setpoint when the
    # current assembler is invoked correctly. This is the positive test —
    # presence confirms the state1 emission path actually ran.
    sched = epjson.get("Schedule:Constant", {})
    if "state1_heating_setpoint" not in sched:
        failures.append("Schedule:Constant.state1_heating_setpoint missing — state1 path did not run")

    if failures:
        print(f"  FAIL {label}: FAIL")
        for f in failures:
            print(f"      {f}")
        return False
    print(f"  PASS {label}: pass")
    return True


def main() -> int:
    host = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_HOST
    base = f"{host}/api/projects/{BRIDGEWATER_ID}/simulate"

    print(f"Brief 30 Phase 1.0 API binding regression test")
    print(f"Target: {host}")
    print()

    all_passed = True

    # ── Test 1: mode via QUERY STRING ────────────────────────────────────
    print("Test 1: POST .../simulate?mode=envelope-only  (query string)")
    res1 = _post(f"{base}?mode=envelope-only", body=None)
    run1 = res1["run_id"]
    print(f"  run_id: {run1}")
    ep1 = _load_epjson(run1)
    if not _assert_state1("query-string form", ep1):
        all_passed = False

    # ── Test 2: mode via JSON BODY ───────────────────────────────────────
    print()
    print("Test 2: POST .../simulate  with body {'mode': 'envelope-only'}")
    res2 = _post(base, body={"mode": "envelope-only"})
    run2 = res2["run_id"]
    print(f"  run_id: {run2}")
    ep2 = _load_epjson(run2)
    if not _assert_state1("JSON-body form", ep2):
        all_passed = False

    # ── Test 3: NEGATIVE — default (no mode set) should be "full" ───────
    print()
    print("Test 3: POST .../simulate  with no mode (negative test — should NOT be state1)")
    res3 = _post(base, body=None)
    run3 = res3["run_id"]
    print(f"  run_id: {run3}")
    ep3 = _load_epjson(run3)
    forbidden_present = sum(1 for t in STATE1_FORBIDDEN_OBJECTS if ep3.get(t, {}))
    has_state1_schedule = "state1_heating_setpoint" in ep3.get("Schedule:Constant", {})
    if forbidden_present > 0 and not has_state1_schedule:
        print(f"  PASS negative case: default mode is NOT envelope-only "
              f"({forbidden_present}/{len(STATE1_FORBIDDEN_OBJECTS)} forbidden objects present, "
              f"no state1 schedule)")
    else:
        print(f"  FAIL negative case: default behaviour wrong")
        all_passed = False

    print()
    if all_passed:
        print("ALL TESTS PASSED")
        return 0
    else:
        print("REGRESSION DETECTED — API binding has reverted to the pre-Brief-30 silent-drop behaviour.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
