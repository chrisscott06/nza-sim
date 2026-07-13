#!/usr/bin/env python3
"""T1 — EP isolated runs for 5 interventions vs the 98-A2 MATCHED-INPUTS baseline.

Read-only on engines. Uses the nza_engine assembler (the pipeline that carries the
98-A2 matched-inputs fixes: envelope-derived airtightness, NZA gains profiles, NZA DHW
litres) in mode="full" — the SAME path as scripts/_brief98A_p1_ep.py. For each measure we
deep-copy report_baseline_v1, apply the patch(es), re-derive systems, assemble, run EP,
and record EUI / heating / cooling demand. Delta vs the matched-inputs baseline.

Setpoint-widening caveat: the EP thermostat is the hardcoded `hotel_heating_setpoint` /
`hotel_cooling_setpoint` Schedule:Compact (21 occ / 18 setback ; 24 occ / 28 setback),
NOT systems_config_v40. So the 3.3 v40 setpoint patch does NOT reach EP. To model the
measure faithfully we shift the OCCUPIED setpoint fields in the assembled epJSON
(21.0->20.0 heating, 24.0->25.0 cooling), leaving setback untouched. This is a model-file
edit in the run layer, not an engine change.

Run: ENERGYPLUS_DIR=/Applications/EnergyPlus-25-2-0 validation/.venv/bin/python scripts/_t1_ep.py
"""
import copy, json, sys
from pathlib import Path
import yaml

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "validation" / "energyplus"))
from nza_engine.config import ENERGYPLUS_DIR, SIMULATIONS_DIR
from nza_engine.generators.epjson_assembler import assemble_epjson, derive_operational_ach
from nza_engine.runner import run_simulation
from nza_engine.systems_from_v40 import derive_systems_for_sim
from nza_engine.parsers.sql_parser import get_building_summary, get_monthly_energy_by_enduse, _monthly_sums
from state_builder import apply_patch  # noqa: E402
import sqlite3

FX0 = yaml.safe_load((REPO / "validation/fixtures/report_baseline_v1.yaml").read_text())
WEATHER = REPO / "data/weather/current" / FX0["weather_file"]

MEASURES = [
    {"ref": "baseline", "name": "Matched-inputs baseline", "patches": []},
    {"ref": "air_perm_1.9", "name": "Air permeability q50 4.64->1.9",
     "patches": [{"op": "set", "path": "building.fabric.air_permeability_q50", "value": 1.9}]},
    {"ref": "3.5_brise_soleil", "name": "Brise soleil (0.5m overhang S+W)",
     "patches": [{"op": "set", "path": "building.shading_overhang.south", "value": {"depth_m": 0.5, "offset_m": 0}},
                 {"op": "set", "path": "building.shading_overhang.west", "value": {"depth_m": 0.5, "offset_m": 0}}]},
    {"ref": "vent_to_mvhr", "name": "Bedroom extract->MVHR (vent-only isolate)",
     "patches": [{"op": "set", "path": "building.systems_config_v40.ventilation[1].efficiency_metric",
                  "value": {"sfp_w_per_lps": 1.8, "recovery_sensible_pct": 80, "recovery_latent_pct": 0}}]},
    {"ref": "2.1_mvhr_conversion", "name": "MVHR conversion (full 2.1: vent+heating swap)",
     "patches": [{"op": "set", "path": "building.systems_config_v40.ventilation[1].efficiency_metric",
                  "value": {"sfp_w_per_lps": 1.8, "recovery_sensible_pct": 80, "recovery_latent_pct": 0}},
                 {"op": "set", "path": "building.systems_config_v40.heating[1].share_pct", "value": 0},
                 {"op": "set", "path": "building.systems_config_v40.heating[0].share_pct", "value": 100}]},
    {"ref": "3.3_setpoint_widen", "name": "Setpoint widening (heat 21->20, cool 24->25)",
     "patches": [], "ep_setpoint_shift": True},
]


def shift_setpoints(epjson_path):
    """Widen EP occupied setpoints in the assembled model: hotel_heating 21->20,
    hotel_cooling 24->25. Setback (18/28) untouched. Returns count of edited fields."""
    d = json.loads(Path(epjson_path).read_text())
    sc = d.get("Schedule:Compact", {})
    edits = 0
    for name, frm, to in (("hotel_heating_setpoint", 21.0, 20.0), ("hotel_cooling_setpoint", 24.0, 25.0)):
        obj = sc.get(name)
        if not obj:
            continue
        for entry in obj.get("data", []):
            v = entry.get("field")
            if isinstance(v, (int, float)) and abs(float(v) - frm) < 1e-6:
                entry["field"] = to
                edits += 1
    Path(epjson_path).write_text(json.dumps(d, indent=1))
    return edits


def run_one(m):
    fx = copy.deepcopy(FX0)
    for p in m["patches"]:
        apply_patch(fx, p)
    bc = fx["building_config"]
    cc = fx["construction_choices"]
    op_ach, _ = derive_operational_ach(bc)
    simple, v25 = derive_systems_for_sim(bc, fallback_simple=fx.get("systems_config"))
    bc_sim = {**bc, "systems_config_v25": v25}
    out = SIMULATIONS_DIR / f"t1_{m['ref']}"
    out.mkdir(parents=True, exist_ok=True)
    ep_path = out / "input.epJSON"
    assemble_epjson(building_params=bc_sim, construction_choices=cc, weather_file_path=WEATHER,
                    output_path=ep_path, systems_config=simple, schedule_overrides=None, mode="full")
    if m.get("ep_setpoint_shift"):
        e = shift_setpoints(ep_path)
        print(f"    [setpoint] edited {e} occupied setpoint fields (expect 4: 2 heating + 2 cooling)")
    res = run_simulation(epjson_path=ep_path, weather_file_path=WEATHER, output_dir=out)
    if not res.success:
        print(f"  X {m['ref']} FAILED fatal={res.fatal_errors}")
        return {"ref": m["ref"], "name": m["name"], "status": "failed"}
    s = get_building_summary(res.sql_path)
    monthly = get_monthly_energy_by_enduse(res.sql_path)
    # total delivered electricity per month (Electricity:Facility) for T2
    with sqlite3.connect(str(res.sql_path)) as conn:
        conn.row_factory = sqlite3.Row
        elec_monthly = _monthly_sums(conn, "Electricity:Facility")
    row = {"ref": m["ref"], "name": m["name"], "status": "ok", "op_ach": round(op_ach, 5),
           "eui": s.get("eui_kWh_per_m2"),
           "heating_mwh": round(s.get("annual_heating_kWh", 0) / 1000, 1),
           "cooling_mwh": round(s.get("annual_cooling_kWh", 0) / 1000, 1),
           "monthly_electricity_kwh": [round(x, 0) for x in elec_monthly],
           "monthly_enduse": {k: [round(x, 0) for x in v] for k, v in monthly.items()}}
    print(f"  OK {m['ref']:22s} EUI {row['eui']:6} | heat {row['heating_mwh']:6} | cool {row['cooling_mwh']:6} | ann_elec {round(sum(elec_monthly)/1000,1)} MWh")
    return row


print(f"EP {ENERGYPLUS_DIR}")
rows = [run_one(m) for m in MEASURES]
OUT = REPO / "docs/audit/T1_ep_runs.json"
OUT.write_text(json.dumps({"ep_version": str(ENERGYPLUS_DIR), "rows": rows}, indent=1))
print(f"wrote {OUT}")
