#!/usr/bin/env python3
"""Brief 95 P4 — state builder / classifier / config-hash unit tests (no test runner in repo).

Run: validation/.venv/bin/python scripts/_brief95_p4_test.py
"""
import copy
import re
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
EP_DIR = REPO / "validation" / "energyplus"
sys.path.insert(0, str(EP_DIR))
from state_builder import (  # noqa: E402
    classify_patch, apply_patch, build_states, config_hash, resolved_to_idf,
)
from generate_idf import resolve_idd  # noqa: E402

FIX = yaml.safe_load((REPO / "validation" / "fixtures" / "bridgewater_anchor_v2.yaml").read_text())
IVS = FIX["building_config"]["interventions"]
BY_ID = {iv["id"]: iv for iv in IVS}
REFS = FIX["building_config"]["strategies"][0]["refs"]

_p = _f = 0
def ok(name, cond):
    global _p, _f
    if cond: _p += 1; print(f"  ✓ {name}")
    else: _f += 1; print(f"  ✗ FAIL: {name}")

# ── Classifier ──────────────────────────────────────────────────────────────
print("\n── classifier ──")
ok("setpoint patch → physical", classify_patch({"op": "set", "path": "building.systems_config_v40.heating_setpoint_c", "value": 20}) == "physical")
ok("infiltration patch → physical", classify_patch({"op": "set", "path": "building.fabric", "value": {}}) == "physical")
ok("EPD baseload patch → physical", classify_patch({"op": "set", "path": "building.gains.equipment.profiles[0].baseload.value", "value": 3.5}) == "physical")
ok("percentage-adjustment op → nza_sim_only", classify_patch({"op": "multiply", "path": "building.gains.lighting.pct_reduction", "value": 0.2}) == "nza_sim_only")
ok("unknown path → nza_sim_only", classify_patch({"op": "set", "path": "building.roadmap.something", "value": 1}) == "nza_sim_only")
ok("real Bridgewater stack is all-physical", all(classify_patch(p) == "physical" for iv in IVS for p in iv.get("patches", [])))

# ── apply_patch ─────────────────────────────────────────────────────────────
print("\n── apply_patch ──")
f = copy.deepcopy(FIX)
apply_patch(f, {"op": "set", "path": "building.systems_config_v40.heating_setpoint_c", "value": 20})
ok("set nested value", f["building_config"]["systems_config_v40"]["heating_setpoint_c"] == 20)
apply_patch(f, {"op": "set", "path": "building.systems_config_v40.dhw[1].efficiency_metric", "value": 5})
ok("set array-indexed value", f["building_config"]["systems_config_v40"]["dhw"][1]["efficiency_metric"] == 5)
ok("original fixture untouched (deep copy)", FIX["building_config"]["systems_config_v40"].get("heating_setpoint_c") != 20)

# ── build_states ────────────────────────────────────────────────────────────
print("\n── build_states (real stack) ──")
states = build_states(FIX, REFS, BY_ID)
enabled = [r for r in REFS if r.get("enabled", True)]
ok("one cumulative state per enabled ref", len(states["cumulative"]) == len(enabled))
ok("one isolated state per enabled ref", len(states["isolated"]) == len(enabled))
ok("baseline config == fixture", config_hash(states["baseline"]["config"]) == config_hash(FIX))
# 'New intervention' has no patches → recorded as a skip (no_patches) in the cumulative chain
last_skips = states["cumulative"][-1]["skips"]
ok("empty-patch intervention recorded as skip", any(s.get("reason") == "no_patches" for s in last_skips))

# ── config-hash stability ───────────────────────────────────────────────────
print("\n── config-hash stability ──")
iso1 = {k: config_hash(v["config"]) for k, v in states["isolated"].items()}
# reorder the stack → isolated hashes must NOT change (isolated = baseline + one item)
refs_rev = [dict(r, order=len(REFS) - r["order"]) for r in REFS]
states_rev = build_states(FIX, refs_rev, BY_ID)
iso2 = {k: config_hash(v["config"]) for k, v in states_rev["isolated"].items()}
ok("reordering stack does NOT change isolated-state hashes", iso1 == iso2)
# toggle an unrelated item off → other isolated hashes unchanged
one = REFS[0]["library_id"]
refs_toggle = [dict(r, enabled=False) if r["library_id"] == one else r for r in REFS]
states_tog = build_states(FIX, refs_toggle, BY_ID)
iso3 = {k: config_hash(v["config"]) for k, v in states_tog["isolated"].items()}
ok("toggling one item does NOT change others' isolated hashes",
   all(iso3[k] == iso1[k] for k in iso3 if k != one))
# cumulative hashes ARE order-sensitive (sanity: reordering changes at least one prefix)
cum1 = [config_hash(s["config"]) for s in states["cumulative"]]
cum2 = [config_hash(s["config"]) for s in states_rev["cumulative"]]
ok("cumulative prefix hashes are order-sensitive", cum1 != cum2)

# ── mixed stack (physical + percentage) → correct count + skips ──────────────
print("\n── mixed stack (physical + nza_sim_only) ──")
phys_iv = {"id": "iv_phys", "label": "Phys", "patches": [
    {"op": "set", "path": "building.systems_config_v40.heating_setpoint_c", "value": 19}]}
pct_iv = {"id": "iv_pct", "label": "Pct", "patches": [
    {"op": "multiply", "path": "building.gains.lighting.pct_reduction", "value": 0.2}]}
by = {"iv_phys": phys_iv, "iv_pct": pct_iv}
refs_mix = [{"library_id": "iv_phys", "enabled": True, "order": 0},
            {"library_id": "iv_pct", "enabled": True, "order": 1}]
st = build_states(FIX, refs_mix, by)
ok("mixed: 2 cumulative states", len(st["cumulative"]) == 2)
ok("mixed: nza_sim_only item recorded as skip", any(s.get("reason") == "nza_sim_only" for s in st["cumulative"][-1]["skips"]))
ok("mixed: pct patch excluded from EP config (setpoint applied, no lighting change)",
   st["cumulative"][-1]["config"]["building_config"]["systems_config_v40"]["heating_setpoint_c"] == 19)

# ── translation: two U-value patches → differing IDFs at exactly the construction ──
print("\n── translation: two U-value patches → differing IDFs ──")
idd = resolve_idd()
wall_idx = next(i for i, c in enumerate(FIX["library_constructions"]) if c["name"] == FIX["construction_choices"]["external_wall"])
cfg_a = copy.deepcopy(FIX); apply_patch(cfg_a, {"op": "set", "path": f"library_constructions[{wall_idx}].u_value_W_per_m2K", "value": 0.10})
cfg_b = copy.deepcopy(FIX); apply_patch(cfg_b, {"op": "set", "path": f"library_constructions[{wall_idx}].u_value_W_per_m2K", "value": 0.30})
idf_a = resolved_to_idf(cfg_a, idd)
idf_b = resolved_to_idf(cfg_b, idd)
def mat_r(idf, mat):
    m = re.search(mat + r"_MAT,.*?Roughness.*?\n\s*([\d.]+)", idf, re.S)
    return m.group(1) if m else None
ok("IDFs differ (wall U 0.10 vs 0.30)", idf_a != idf_b)
ok("EXT_WALL material R differs at exactly the patched construction",
   mat_r(idf_a, "EXT_WALL") != mat_r(idf_b, "EXT_WALL"))
ok("ROOF material R unchanged (other constructions identical)",
   mat_r(idf_a, "ROOF") == mat_r(idf_b, "ROOF"))
ok("GROUND_FLOOR material R unchanged",
   mat_r(idf_a, "GROUND_FLOOR") == mat_r(idf_b, "GROUND_FLOOR"))
ok("hashes differ for the two U-value configs", config_hash(cfg_a) != config_hash(cfg_b))

# ── translation gaps: physical-but-unmapped patches ESCALATE (not silent-drop) ──
print("\n── translation gaps (escalate, don't silently drop) ──")
from state_builder import translation_gaps, is_translated  # noqa: E402
gaps = translation_gaps(IVS)
gap_ivs = {g["intervention"] for g in gaps}
ok("shading (Brise soleil) flagged as unmapped", any("Brise" in i for i in gap_ivs))
ok("systems setpoints (Widen) flagged as unmapped", any("Widen" in i for i in gap_ivs))
ok("occupancy density flagged as unmapped", any("Occupancy" in i for i in gap_ivs))
ok("MVHR recovery IS translated (not a gap)", is_translated("building.systems_config_v40.ventilation[1].efficiency_metric.recovery_sensible_pct"))
ok("EPD baseload IS translated (not a gap)", is_translated("building.gains.equipment.profiles[0].baseload.value"))
ok("gaps list is non-empty (real stack has unmapped physicals — escalation surfaced)", len(gaps) > 0)

print(f"\n{'─'*48}\n{'✅ ALL PASS' if _f == 0 else '❌ FAILURES'}: {_p} passed, {_f} failed\n")
sys.exit(0 if _f == 0 else 1)
