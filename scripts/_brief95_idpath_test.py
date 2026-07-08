#!/usr/bin/env python3
"""Regression test — state_builder must apply `[field=value]` list selectors (as the JS
engine does). Real project patches use e.g. `heating[id=sys_heating_1]`; before the fix the
Python parser only handled `[integer]` and crashed → /plan returned empty → panel "0 runs".

Run: validation/.venv/bin/python scripts/_brief95_idpath_test.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "validation" / "energyplus"))
from state_builder import apply_patch, _parse_path  # noqa: E402

_p = _f = 0
def ok(name, cond):
    global _p, _f
    if cond: _p += 1; print(f"  ✓ {name}")
    else: _f += 1; print(f"  ✗ FAIL: {name}")

fix = {"building_config": {"systems_config_v40": {"heating": [
    {"id": "sys_a", "share_pct": 95}, {"id": "sys_b", "share_pct": 5}]}}}

# integer index still works
apply_patch(fix, {"op": "set", "path": "building.systems_config_v40.heating[0].share_pct", "value": 100})
ok("integer index [0] applies", fix["building_config"]["systems_config_v40"]["heating"][0]["share_pct"] == 100)

# [id=...] selector resolves to the matching element (not index 1)
apply_patch(fix, {"op": "set", "path": "building.systems_config_v40.heating[id=sys_b].share_pct", "value": 0})
ok("[id=sys_b] targets the element with id=sys_b", fix["building_config"]["systems_config_v40"]["heating"][1]["share_pct"] == 0)
ok("[id=sys_b] did NOT touch sys_a", fix["building_config"]["systems_config_v40"]["heating"][0]["share_pct"] == 100)

# parse shape
parts = _parse_path("building.systems_config_v40.heating[id=sys_heating_1782394791339_15293].share_pct")
ok("id selector parses to ('id', value) tuple", ("id", "sys_heating_1782394791339_15293") in parts)

# unknown id raises loudly (never silent no-op)
try:
    apply_patch(fix, {"op": "set", "path": "building.systems_config_v40.heating[id=nope].share_pct", "value": 1})
    ok("unknown id raises", False)
except KeyError:
    ok("unknown id raises KeyError (no silent no-op)", True)

print(f"\n{'✅ ALL PASS' if _f == 0 else '❌ FAILURES'}: {_p} passed, {_f} failed")
sys.exit(0 if _f == 0 else 1)
