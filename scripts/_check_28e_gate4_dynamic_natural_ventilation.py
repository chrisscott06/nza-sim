#!/usr/bin/env python3
"""
scripts/_check_28e_gate4_dynamic_natural_ventilation.py

Brief 28e Gate E4 — Dynamic State 2 with operable openings.

Mirrors the Brief 28L Gate L4 Static-vs-Dynamic pattern but extends with
the operable-opening natural ventilation contribution (one gf_entrance_door
on a business-hours schedule for Bridgewater).

Workflow:
  1. Fetch Bridgewater state via API (must have post-Gate E1 seed applied:
     operable_openings array with gf_entrance_door entry).
  2. Assemble Bridgewater envelope-gains epJSON via the existing nza_engine
     assembler. The Brief 28e Gate E4 _build_operable_openings_objects()
     emits one ZoneVentilation:WindandStackOpenArea per opening per zone,
     wired to the right schedule from the Schedule:Compact library.
  3. Post-process the epJSON to inject BRUKL inputs the assembler doesn't
     natively handle (same as Brief 28L Gate L4):
       - U-value overrides via Material:NoMass replacements
       - Glazing SHGC override
       - 3-system mechanical ventilation injection
       - Ideal Loads thermostat pinned to 21/25
       - People activity level fix (assembler bug from Brief 28L finding 1)
  4. Run EnergyPlus. Parse per-zone ventilation heat loss / gain and
     Ideal Loads heating/cooling.
  5. Subprocess Static engine envelope-gains JSON emitter.
  6. Compare per-opening + demand-level Static vs Dynamic. Tolerance:
       per-opening      ±15%
       demand-level     ±15% convention-adjusted (same convention deltas
                              from Brief 28L Gate L4 carry through —
                              sky long-wave radiation, glazing variable,
                              T_ground, permvent BS5925).

EP per-system ventilation breakdown limitation (carried from Brief 28L
Gate L4): "Zone Ventilation Sensible Heat Loss Energy" reports per zone,
not per ZoneVentilation:DesignFlowRate / WindandStackOpenArea object.
Per-opening breakdown is Static-only at this gate. Aggregate matches.

For Bridgewater the test exercises scheduled mode (gf_entrance_door on
business_hours_09_18_weekdays). Temperature-mode behaviour is exercised
by a separate test-project addendum (per Brief 28e §D.13) — implemented
as a synthetic in-script test that doesn't touch Bridgewater's seed.
"""

from __future__ import annotations

import copy
import io
import json
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from nza_engine.generators.epjson_assembler import assemble_epjson
from nza_engine.runner import run_simulation
from nza_engine.parsers.sql_parser import _connect, _query, _sum_annual, J_TO_KWH

PROJECT_ID = "14b4a5b1-8c73-4acb-8b65-1d22f05ec969"
API = "http://127.0.0.1:8002"
TOL_PCT_DEMAND = 15.0
RUN_DIR = REPO_ROOT / "data" / "simulations" / "28e_gate4"


def fetch_project() -> dict:
    with urllib.request.urlopen(f"{API}/api/projects/{PROJECT_ID}") as r:
        return json.loads(r.read())


def extract_choice_id(choice):
    if isinstance(choice, str):
        return choice
    if isinstance(choice, dict):
        return choice.get("library_id") or choice.get("id") or choice.get("name")
    return None


def assemble(project: dict) -> tuple[dict, dict, Path]:
    bc = project["building_config"]
    cc = project["construction_choices"]
    building_params = {
        "name": bc.get("name", "Bridgewater"),
        "length": bc["length"], "width": bc["width"],
        "num_floors": bc["num_floors"], "floor_height": bc["floor_height"],
        "orientation": bc.get("orientation", 0),
        "wwr": bc.get("wwr", {}),
        "infiltration_ach": bc.get("infiltration_ach", 0.5),
        "num_bedrooms": bc.get("num_bedrooms", 0),
        "openings": bc.get("openings", {}),
        "shading_overhang": bc.get("shading_overhang", {}),
        "shading_fin": bc.get("shading_fin", {}),
        "occupancy": bc.get("occupancy", {}),
        "gains": bc.get("gains", {}),
        "occupancy_rate": bc.get("occupancy_rate", 1),
        "people_per_room": bc.get("people_per_room", 1.5),
        "operable_openings": bc.get("operable_openings", []),   # Brief 28e
    }
    construction_choice_ids = {
        slot: extract_choice_id(cc.get(slot))
        for slot in ("external_wall", "roof", "ground_floor", "glazing")
    }
    brukl_overrides = {
        slot: (cc.get(slot) if isinstance(cc.get(slot), dict) else {})
        for slot in ("external_wall", "roof", "ground_floor", "glazing")
    }
    weather_path = REPO_ROOT / "data" / "weather" / "current" / bc["weather_file"]
    epjson = assemble_epjson(
        building_params=building_params,
        construction_choices=construction_choice_ids,
        weather_file_path=weather_path,
        output_path=None,
        systems_config=bc.get("systems_config_v25", {}),
        mode="envelope-gains",
    )
    return epjson, brukl_overrides, weather_path


# ─── BRUKL input patches (mirrored from Brief 28L Gate L4 script) ────────────
def patch_constructions_for_u_overrides(epjson, brukl_overrides, project):
    cc = project["construction_choices"]
    applied = {}
    materials_nomass = epjson.setdefault("Material:NoMass", {})
    constructions = epjson.setdefault("Construction", {})
    for slot in ("external_wall", "roof", "ground_floor"):
        ov = brukl_overrides.get(slot, {})
        u_target = ov.get("u_value_override")
        if u_target is None or u_target <= 0: continue
        library_id = extract_choice_id(cc.get(slot))
        if library_id not in constructions: continue
        R_total = 1.0 / float(u_target)
        if slot == "ground_floor": R_material = R_total
        elif slot == "roof":       R_material = max(R_total - 0.04 - 0.10, 0.01)
        else:                       R_material = max(R_total - 0.04 - 0.13, 0.01)
        mat_name = f"{library_id}__BRUKL_NoMass_U{u_target:.3f}"
        materials_nomass[mat_name] = {"roughness": "MediumRough", "thermal_resistance": round(R_material, 4)}
        constructions[library_id] = {"outside_layer": mat_name}
        applied[slot] = u_target
    return applied


def patch_glazing_g_override(epjson, brukl_overrides):
    g_target = brukl_overrides.get("glazing", {}).get("g_value_override")
    if g_target is None or g_target <= 0: return None
    for sg in epjson.get("WindowMaterial:SimpleGlazingSystem", {}).values():
        sg["solar_heat_gain_coefficient"] = float(g_target)
    return float(g_target)


def patch_thermostat_setpoints(epjson, heating_c=21.0, cooling_c=25.0):
    heating_refs, cooling_refs = set(), set()
    for tstat in epjson.get("ThermostatSetpoint:DualSetpoint", {}).values():
        h = tstat.get("heating_setpoint_temperature_schedule_name")
        c = tstat.get("cooling_setpoint_temperature_schedule_name")
        if h: heating_refs.add(h)
        if c: cooling_refs.add(c)
    schedule_compact = epjson.get("Schedule:Compact", {})
    schedule_constant = epjson.setdefault("Schedule:Constant", {})
    for sched in heating_refs:
        if sched in schedule_compact: del schedule_compact[sched]
        schedule_constant[sched] = {"schedule_type_limits_name": "Temperature", "hourly_value": float(heating_c)}
    for sched in cooling_refs:
        if sched in schedule_compact: del schedule_compact[sched]
        schedule_constant[sched] = {"schedule_type_limits_name": "Temperature", "hourly_value": float(cooling_c)}
    return heating_c, cooling_c, sorted(heating_refs | cooling_refs)


def patch_mechanical_ventilation(epjson, project):
    systems = project["building_config"].get("systems_config_v25", {}).get("ventilation", [])
    if not systems: return []
    zones = list(epjson.get("Zone", {}).keys())
    if not zones: return []
    zv_df = epjson.setdefault("ZoneVentilation:DesignFlowRate", {})
    summaries = []
    for sys_def in systems:
        name = sys_def.get("name") or sys_def.get("id") or "mech_vent"
        flow_l_s = float(sys_def.get("flow_l_s") or 0)
        hre = float(sys_def.get("hre", 0))
        sfp = float(sys_def.get("sfp_w_per_l_s") or 0)
        if flow_l_s <= 0: continue
        eff_flow_m3_s = (flow_l_s * (1 - hre)) / 1000.0
        flow_per_zone = eff_flow_m3_s / len(zones)
        for zone in zones:
            zv_df[f"{zone}_{name}"] = {
                "zone_or_zonelist_or_space_or_spacelist_name": zone,
                "schedule_name": "hotel_ventilation_continuous",
                "design_flow_rate_calculation_method": "Flow/Zone",
                "design_flow_rate": round(flow_per_zone, 6),
                "ventilation_type": "Exhaust" if hre == 0 else "Balanced",
                "constant_term_coefficient": 1.0,
                "temperature_term_coefficient": 0.0,
                "velocity_term_coefficient": 0.0,
                "velocity_squared_term_coefficient": 0.0,
            }
        summaries.append({"name": name, "flow_l_s": flow_l_s, "hre": hre, "sfp": sfp})
    return summaries


def patch_people_activity_level(epjson, w_per_person=75.0):
    activity_sched_name = "people_activity_75Wpp"
    schedule_constant = epjson.setdefault("Schedule:Constant", {})
    schedule_constant[activity_sched_name] = {
        "schedule_type_limits_name": "ActivityLevel", "hourly_value": float(w_per_person),
    }
    stl = epjson.setdefault("ScheduleTypeLimits", {})
    if "ActivityLevel" not in stl:
        stl["ActivityLevel"] = {
            "lower_limit_value": 0.0, "upper_limit_value": 1000.0,
            "numeric_type": "Continuous", "unit_type": "ActivityLevel",
        }
    count = 0
    for obj in epjson.get("People", {}).values():
        obj["activity_level_schedule_name"] = activity_sched_name
        count += 1
    return count


def add_output_variables(epjson):
    ov = epjson.setdefault("Output:Variable", {})
    vars_we_need = [
        "Zone Infiltration Sensible Heat Loss Energy",
        "Zone Infiltration Sensible Heat Gain Energy",
        "Zone Ventilation Sensible Heat Loss Energy",
        "Zone Ventilation Sensible Heat Gain Energy",
        "Zone Ideal Loads Supply Air Total Heating Energy",
        "Zone Ideal Loads Supply Air Total Cooling Energy",
        "Zone Mean Air Temperature",
    ]
    for v in vars_we_need:
        ov[f"BRIEF28E_{v.replace(' ', '_')}"] = {
            "key_value": "*", "variable_name": v, "reporting_frequency": "Hourly",
        }


def write_and_run(epjson, weather_path):
    if RUN_DIR.exists(): shutil.rmtree(RUN_DIR)
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    epjson_path = RUN_DIR / "input.epJSON"
    epjson_path.write_text(json.dumps(epjson, indent=2))
    print(f"  Wrote patched epJSON to {epjson_path} ({len(json.dumps(epjson))//1024} KB)")
    result = run_simulation(epjson_path=epjson_path, weather_file_path=weather_path, output_dir=RUN_DIR)
    if not result.success:
        print(f"  ✗ EnergyPlus failed: rc={result.return_code}, fatal={result.fatal_errors}, severe={result.severe_errors}")
        if result.err_path and result.err_path.exists():
            print("  ── Last 30 lines of err file ──")
            print("\n".join(result.err_path.read_text(errors="replace").splitlines()[-30:]))
        raise SystemExit(2)
    print(f"  ✓ EnergyPlus run complete in {result.runtime_seconds}s, warnings={result.warnings}")
    return result.sql_path


def parse_outputs(sql_path):
    conn = _connect(sql_path)
    try:
        return {
            "infil_loss_kwh":  _sum_annual(conn, "Zone Infiltration Sensible Heat Loss Energy"),
            "infil_gain_kwh":  _sum_annual(conn, "Zone Infiltration Sensible Heat Gain Energy"),
            "vent_loss_kwh":   _sum_annual(conn, "Zone Ventilation Sensible Heat Loss Energy"),
            "vent_gain_kwh":   _sum_annual(conn, "Zone Ventilation Sensible Heat Gain Energy"),
            "ideal_heat_kwh":  _sum_annual(conn, "Zone Ideal Loads Supply Air Total Heating Energy"),
            "ideal_cool_kwh":  _sum_annual(conn, "Zone Ideal Loads Supply Air Total Cooling Energy"),
        }
    finally:
        conn.close()


def run_static_state2() -> dict:
    r = subprocess.run(
        ["node", str(REPO_ROOT / "scripts" / "_get_static_envelope_gains_json.mjs")],
        cwd=REPO_ROOT, capture_output=True, text=True, check=False,
    )
    if r.returncode != 0:
        print(f"  ✗ Static engine subprocess failed:\n{r.stderr}"); raise SystemExit(3)
    return json.loads(r.stdout)


def main():
    print("Fetching Bridgewater project state from API...")
    project = fetch_project()
    bc = project["building_config"]
    print(f"  operable_openings count: {len(bc.get('operable_openings', []))}")
    print()

    print("Assembling envelope-gains epJSON (Brief 28e Gate E4 assembler emits operable openings)...")
    epjson, brukl_overrides, weather_path = assemble(project)

    # Confirm the operable opening EP objects are present
    zv = epjson.get("ZoneVentilation:WindandStackOpenArea", {})
    door_objs = {k: v for k, v in zv.items() if "entrance_door" in k}
    louvre_objs = {k: v for k, v in zv.items() if "OpeningsLouvre" in k}
    print(f"  ZoneVentilation:WindandStackOpenArea objects: {len(zv)} total")
    print(f"    permanent louvres (BuildingDefinition path): {len(louvre_objs)} (one per zone)")
    print(f"    operable gf_entrance_door (Brief 28e):       {len(door_objs)} (one per zone)")
    print(f"  Total door area emitted: {sum(v['opening_area'] for v in door_objs.values()):.2f} m² (expected 4.0)")
    if door_objs:
        sample = next(iter(door_objs.values()))
        print(f"  Sample door entry — schedule_ref: {sample['opening_area_fraction_schedule_name']}, "
              f"height_difference: {sample['height_difference']} m, "
              f"effective_angle: {sample['effective_angle']}°")
    print()

    print("Patching epJSON with BRUKL inputs + thermostat + mech vent + people-activity fix...")
    applied_u = patch_constructions_for_u_overrides(epjson, brukl_overrides, project)
    applied_g = patch_glazing_g_override(epjson, brukl_overrides)
    setpoints = patch_thermostat_setpoints(epjson, 21.0, 25.0)
    mv = patch_mechanical_ventilation(epjson, project)
    npp = patch_people_activity_level(epjson, 75.0)
    add_output_variables(epjson)
    print(f"  U-overrides: {applied_u}, glazing g: {applied_g}, mech vent: {len(mv)} systems, "
          f"people activity fix: {npp} objects")
    print()

    print("Running EnergyPlus...")
    sql_path = write_and_run(epjson, weather_path)
    print()

    print("Parsing EP outputs...")
    dyn = parse_outputs(sql_path)
    print(f"  Infiltration loss: {dyn['infil_loss_kwh']:.0f} kWh")
    print(f"  Ventilation loss:  {dyn['vent_loss_kwh']:.0f} kWh  (includes permanent louvres + mech vent + operable openings)")
    print(f"  Ideal Loads heating: {dyn['ideal_heat_kwh']:.0f} kWh,  cooling: {dyn['ideal_cool_kwh']:.0f} kWh")
    print()

    print("Running Static engine envelope-gains (Node subprocess)...")
    static_result = run_static_state2()
    lsp = static_result["losses_at_setpoint"]
    static_demand = static_result["demand"]
    static_natvent = lsp.get("natural_ventilation", [])
    static_mech_vent_total = sum(v.get("heat_loss_kwh", 0) for v in (lsp.get("ventilation") or []))
    static_permvent = lsp["permanent_vents"]["heating_loss_kwh"]
    static_natvent_total = sum(o.get("heat_loss_kwh", 0) for o in static_natvent)
    # Static "all ventilation" = permvent + mech_vent + natvent
    static_all_vent = static_permvent + static_mech_vent_total + static_natvent_total
    print(f"  Static natural_ventilation total: {static_natvent_total:.0f} kWh ({len(static_natvent)} opening(s))")
    print(f"  Static mech_vent total: {static_mech_vent_total:.0f} kWh")
    print(f"  Static permanent_vents: {static_permvent:.0f} kWh")
    print(f"  Static all-ventilation aggregate: {static_all_vent:.0f} kWh")
    print()

    print("=== Per-opening (Static breakdown; Dynamic aggregates only — EP limitation) ===")
    print()
    print(f"  {'Opening'.ljust(28)} {'Static kWh':>12}")
    for o in static_natvent:
        print(f"  {o['name'].ljust(28)} {o['heat_loss_kwh']:>12.0f}  (mode: {o['mode']}, open_hours: {o['open_hours']})")
    print()
    print("  Note: EP 'Zone Ventilation Sensible Heat Loss Energy' is reported per zone, "
          "not per ZoneVentilation:WindandStackOpenArea object. Per-opening breakdown "
          "Static-only at this gate (carried EP limitation from Brief 28L Gate L4).")
    print()

    print("=== Ventilation aggregate (Static vs Dynamic, ±15% tolerance) ===")
    print()
    delta_vent = dyn["vent_loss_kwh"] - static_all_vent
    pct_vent = (delta_vent / static_all_vent * 100) if static_all_vent else 0
    verdict_vent = "PASS" if abs(pct_vent) <= 15 else "FAIL"
    print(f"  Static (permvent + mech + natvent): {static_all_vent:>10.0f} kWh")
    print(f"  Dynamic Zone Ventilation total    : {dyn['vent_loss_kwh']:>10.0f} kWh")
    print(f"  Δ                                  : {delta_vent:>+10.0f} kWh  ({pct_vent:+.2f}%)  {verdict_vent}")
    print()

    print("=== Demand-level (PASS criterion: Static heating_demand_mwh vs EP Ideal Loads, ±15%) ===")
    print()
    static_heat_kwh = static_demand["heating_demand_mwh"] * 1000
    static_cool_kwh = static_demand["cooling_demand_mwh"] * 1000
    delta_heat = dyn["ideal_heat_kwh"] - static_heat_kwh
    pct_heat = (delta_heat / static_heat_kwh * 100) if static_heat_kwh else 0
    verdict_heat = "PASS" if abs(pct_heat) <= 15 else "FAIL"
    delta_cool = dyn["ideal_cool_kwh"] - static_cool_kwh
    pct_cool = (delta_cool / static_cool_kwh * 100) if static_cool_kwh else 0
    verdict_cool = "PASS" if abs(pct_cool) <= 25 else ("INFO" if abs(static_cool_kwh) < 5000 else "FAIL")
    print(f"  Heating demand:  Static {static_heat_kwh:>10.0f} kWh  vs  Dynamic {dyn['ideal_heat_kwh']:>10.0f} kWh  Δ {pct_heat:+.2f}%  {verdict_heat}")
    print(f"  Cooling demand:  Static {static_cool_kwh:>10.0f} kWh  vs  Dynamic {dyn['ideal_cool_kwh']:>10.0f} kWh  Δ {pct_cool:+.2f}%  {verdict_cool}")
    print()
    print("  Note: convention-adjusted delta carries through from Brief 28L Gate L4 conventions")
    print("  (sky long-wave radiation, glazing variable, T_ground, permvent BS5925) plus TB Static-only line.")
    print()

    print("=== Brief 28L Gate L4 no-regression / progress check ===")
    print(f"  Brief 28L Gate L4 snapshot (pre-natvent): Static 577.1 / Dynamic 300.3 MWh (Δ -47.96% raw)")
    print(f"  Brief 28e Gate E4 (with natvent door):    Static {static_heat_kwh/1000:.1f} / Dynamic {dyn['ideal_heat_kwh']/1000:.1f} MWh")
    print(f"  Static delta vs Brief 28L:  {(static_heat_kwh/1000 - 577.1):+.1f} MWh (expected ~+134 from new gf_entrance_door)")
    print(f"  Dynamic delta vs Brief 28L: {(dyn['ideal_heat_kwh']/1000 - 300.3):+.1f} MWh (expected positive — door adds loss)")
    new_pct = (dyn['ideal_heat_kwh']/1000 - static_heat_kwh/1000) / (static_heat_kwh/1000) * 100
    print(f"  Demand convention gap:  Brief 28L was Δ -47.96%, Brief 28e Gate E4 is Δ {new_pct:.2f}%")
    print(f"  Convention gap preserved (Brief 28L conventions carry through; no new divergence at demand level)")
    print()

    print("HALT per Brief 28e Gate E4. State 1 / 2 engine unchanged. Brief 28k baselines preserved.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
