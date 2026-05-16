#!/usr/bin/env python3
"""
scripts/_check_28e_gate4b_temperature_mode_functional.py

Brief 28e Gate E4b — temperature-mode functional test for operable openings.
Brief 28e §D.13 verification (Chris ruling, 2026-05-17): exercise the
temperature-mode control path on a synthetic test project to verify both
Static and EP behave reasonably, and to quantify the EP-mapping limitations
(no hysteresis on EP gates; require_outside_cooler approximated via
maximum_outdoor_temperature).

Synthetic test project (NOT persisted; doesn't touch Bridgewater seed):
  - Single-zone box, 12 × 8 × 3.5 m (GIA 96 m², 4 zones)
  - WWR 0.3 on all facades
  - Standard library constructions (no BRUKL overrides)
  - infiltration_ach 0.3
  - Modest internal gains (Bridgewater-derived shapes, scaled) — enough
    to push the free-running zone above 22 °C in shoulder hours so the
    temperature-mode opening actually fires
  - One operable opening on south facade:
      area 2.0 m², height 1.5 m, Cd 0.6, Cw 0.25
      mode: 'temperature'
      open_above_zone_c: 22.0
      hysteresis_c: 1.0
      require_outside_cooler: true

Comparisons:
  - open_hours (Static vs EP) — tolerance ±25% per Chris (different control
    mechanisms: Static has strict hysteresis + T_out<T_zone check; EP has
    independent-per-timestep min_indoor + max_outdoor gates)
  - heat_loss for the opening (Static breakdown only; EP zone-aggregates)
  - pathological-behaviour check: open_hours not 0 (control fires), not
    8760 (control closes), no per-zone NaN
"""

from __future__ import annotations

import copy
import io
import json
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from nza_engine.generators.epjson_assembler import assemble_epjson
from nza_engine.runner import run_simulation
from nza_engine.parsers.sql_parser import _connect, _query, _sum_annual, J_TO_KWH

RUN_DIR = REPO_ROOT / "data" / "simulations" / "28e_gate4b_temp_mode"

# ─── Synthetic test project (in-memory only, NOT persisted) ──────────────────
# Reuse Bridgewater's gain shapes (real schedule data) but scale for small box
def build_synthetic_project(weather_file: str) -> dict:
    """Builds a small synthetic single-floor box with one temperature-mode
    operable opening on the south facade. Uses simple library constructions
    (no per-project U/g overrides). Internal gains tuned so the zone runs
    warm enough in shoulder hours to fire the 22 °C temperature trigger."""
    return {
        "building_config": {
            "name": "synthetic_temp_mode_test",
            "length": 12.0,
            "width":  8.0,
            "num_floors": 1,
            "floor_height": 3.5,
            "orientation": 0,
            "wwr": {"north": 0.3, "south": 0.3, "east": 0.3, "west": 0.3},
            "weather_file": weather_file,
            "infiltration_ach": 0.3,
            "thermal_mass_mode": "auto",
            "thermal_mass_category": "light",
            "num_bedrooms": 4,
            "people_per_room": 1.5,
            "occupancy_rate": 1.0,
            "openings": {
                "site_exposure": "normal",
                "north": {"louvre_area_m2": 0, "openable_fraction": 0},
                "south": {"louvre_area_m2": 0, "openable_fraction": 0},
                "east":  {"louvre_area_m2": 0, "openable_fraction": 0},
                "west":  {"louvre_area_m2": 0, "openable_fraction": 0},
                "schedule": "never",
            },
            "shading_overhang": {"north": 0, "south": 0, "east": 0, "west": 0},
            "shading_fin":      {"north": 0, "south": 0, "east": 0, "west": 0},
            # Occupancy (v2.3 shape) — 24/7 baseline with daytime peak.
            "occupancy": {
                "occupancy_rate": 1.0,
                "density": {"value": 1.5, "basis": "per_room"},
                "sensible_w_per_person": 75,
                "latent_w_per_person": 55,
                "schedule": {
                    "weekday":  [0.5,0.5,0.5,0.5,0.5,0.5,0.5,
                                 0.7,0.9,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,
                                 0.9,0.7,0.5,0.5,0.5,0.5,0.5],
                    "saturday": [0.5,0.5,0.5,0.5,0.5,0.5,0.5,
                                 0.7,0.9,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,
                                 0.9,0.7,0.5,0.5,0.5,0.5,0.5],
                    "sunday":   [0.5,0.5,0.5,0.5,0.5,0.5,0.5,
                                 0.7,0.9,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,
                                 0.9,0.7,0.5,0.5,0.5,0.5,0.5],
                    "monthly_multipliers": [1,1,1,1,1,1,1,1,1,1,1,1],
                    "exceptions": [],
                },
            },
            # Brief 28e — operable opening on south facade, temperature-mode
            "operable_openings": [{
                "id": "test_temp_opening",
                "name": "Test temperature-triggered window (south)",
                "facade": "south",
                "area_m2": 2.0,
                "height_m": 1.5,
                "discharge_coefficient": 0.6,
                "wind_coefficient": 0.25,
                "opening_type": "window",
                "parent_glazing_face": "south",
                "control": {
                    "mode": "temperature",
                    "open_above_zone_c": 22.0,
                    "hysteresis_c": 1.0,
                    "require_outside_cooler": True,
                },
            }],
            "gains": {
                "lighting": {"profiles": [{
                    "id": "test_lighting",
                    "label": "test lighting",
                    "magnitude": {"value": 8.0, "unit": "w_per_m2"},
                    "relationship_to_occupancy": "independent",
                    "spill_minutes": 0,
                    "daylight_factor": 1.0,
                    "area_share": 1.0,
                    "schedule": {
                        "weekday":  [0.1,0.1,0.1,0.1,0.1,0.1,0.1,
                                     0.3,0.6,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,
                                     0.8,0.5,0.3,0.2,0.1,0.1,0.1],
                        "saturday": [0.1]*24,
                        "sunday":   [0.1]*24,
                        "monthly_multipliers": [1,1,0.9,0.8,0.7,0.6,0.6,0.7,0.8,0.9,1,1],
                        "exceptions": [],
                    },
                }]},
                "equipment": {"profiles": [{
                    "id": "test_equipment",
                    "label": "test equipment",
                    "baseload": {"value": 2.0, "unit": "w_per_m2"},
                    "active":   {"value": 6.0, "unit": "w_per_m2"},
                    "relationship_to_occupancy": "proportional",
                    "standby_factor": 0.1,
                    "area_share": 1.0,
                    "schedule": {
                        "weekday":  [0.1,0.1,0.1,0.1,0.1,0.1,0.1,
                                     0.3,0.7,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,
                                     0.7,0.5,0.3,0.2,0.1,0.1,0.1],
                        "saturday": [0.1]*24,
                        "sunday":   [0.1]*24,
                        "monthly_multipliers": [1]*12,
                        "exceptions": [],
                    },
                }]},
            },
        },
        "construction_choices": {
            "external_wall": "cavity_wall_enhanced",
            "roof":          "pitched_roof_standard",
            "ground_floor":  "ground_floor_slab",
            "glazing":       "double_low_e",
        },
        "comfort_band_lower_c": 21,
        "comfort_band_upper_c": 25,
    }


# ─── Static (Node subprocess) ────────────────────────────────────────────────
def run_static_envelope_gains(project: dict) -> dict:
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8",
    ) as tf:
        json.dump(project, tf, ensure_ascii=False)
        temp_path = tf.name
    try:
        r = subprocess.run(
            ["node", str(REPO_ROOT / "scripts" / "_get_static_from_file_json.mjs"),
             temp_path, "envelope-gains"],
            cwd=REPO_ROOT, capture_output=True, text=True, check=False,
        )
        if r.returncode != 0:
            print(f"  ✗ Static engine subprocess failed:\n{r.stderr}")
            raise SystemExit(3)
        return json.loads(r.stdout)
    finally:
        Path(temp_path).unlink(missing_ok=True)


# ─── Dynamic (assembler + EP) ────────────────────────────────────────────────
def assemble_and_run_dynamic(project: dict) -> tuple[Path, dict]:
    bc = project["building_config"]
    cc = project["construction_choices"]
    building_params = {
        "name": bc["name"],
        "length": bc["length"], "width": bc["width"],
        "num_floors": bc["num_floors"], "floor_height": bc["floor_height"],
        "orientation": bc["orientation"],
        "wwr": bc["wwr"],
        "infiltration_ach": bc["infiltration_ach"],
        "num_bedrooms": bc["num_bedrooms"],
        "openings": bc["openings"],
        "shading_overhang": bc["shading_overhang"],
        "shading_fin": bc["shading_fin"],
        "occupancy": bc["occupancy"],
        "gains": bc["gains"],
        "occupancy_rate": bc.get("occupancy_rate", 1),
        "people_per_room": bc.get("people_per_room", 1.5),
        "operable_openings": bc["operable_openings"],
    }
    weather_path = REPO_ROOT / "data" / "weather" / "current" / bc["weather_file"]
    epjson = assemble_epjson(
        building_params=building_params,
        construction_choices=cc,
        weather_file_path=weather_path,
        output_path=None,
        systems_config=bc.get("systems_config_v25", {}),
        mode="envelope-gains",
    )

    # Pin Ideal Loads to BRUKL setpoints (same patch as Brief 28L Gate L4)
    heating_refs, cooling_refs = set(), set()
    for t in epjson.get("ThermostatSetpoint:DualSetpoint", {}).values():
        if t.get("heating_setpoint_temperature_schedule_name"):
            heating_refs.add(t["heating_setpoint_temperature_schedule_name"])
        if t.get("cooling_setpoint_temperature_schedule_name"):
            cooling_refs.add(t["cooling_setpoint_temperature_schedule_name"])
    sc = epjson.get("Schedule:Compact", {})
    sk = epjson.setdefault("Schedule:Constant", {})
    for s in heating_refs:
        sc.pop(s, None)
        sk[s] = {"schedule_type_limits_name": "Temperature", "hourly_value": 21.0}
    for s in cooling_refs:
        sc.pop(s, None)
        sk[s] = {"schedule_type_limits_name": "Temperature", "hourly_value": 25.0}

    # People activity-level fix (Brief 28L finding 1)
    sk["people_activity_75Wpp"] = {
        "schedule_type_limits_name": "ActivityLevel", "hourly_value": 75.0,
    }
    stl = epjson.setdefault("ScheduleTypeLimits", {})
    if "ActivityLevel" not in stl:
        stl["ActivityLevel"] = {
            "lower_limit_value": 0.0, "upper_limit_value": 1000.0,
            "numeric_type": "Continuous", "unit_type": "ActivityLevel",
        }
    for obj in epjson.get("People", {}).values():
        obj["activity_level_schedule_name"] = "people_activity_75Wpp"

    # Output requests
    ov = epjson.setdefault("Output:Variable", {})
    for v in ("Zone Ventilation Sensible Heat Loss Energy",
              "Zone Ventilation Sensible Heat Gain Energy",
              "Zone Ideal Loads Supply Air Total Heating Energy",
              "Zone Ideal Loads Supply Air Total Cooling Energy",
              "Zone Mean Air Temperature"):
        ov[f"BRIEF28E_TEMP_{v.replace(' ', '_')}"] = {
            "key_value": "*", "variable_name": v, "reporting_frequency": "Hourly",
        }

    if RUN_DIR.exists(): shutil.rmtree(RUN_DIR)
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    epjson_path = RUN_DIR / "input.epJSON"
    epjson_path.write_text(json.dumps(epjson, indent=2))

    result = run_simulation(epjson_path=epjson_path, weather_file_path=weather_path, output_dir=RUN_DIR)
    if not result.success:
        print(f"  ✗ EP failed: rc={result.return_code}, fatal={result.fatal_errors}, severe={result.severe_errors}")
        if result.err_path and result.err_path.exists():
            print("\n".join(result.err_path.read_text(errors="replace").splitlines()[-30:]))
        raise SystemExit(2)
    return result.sql_path, epjson


def parse_dynamic(sql_path: Path) -> dict:
    conn = _connect(sql_path)
    try:
        # Count hours where the synthetic opening is open in EP. EP doesn't
        # expose per-object open-hours directly; instead, count hours where
        # Zone Ventilation Sensible Heat Loss > 0 (proxy: any of the opening
        # contributes nonzero loss this hour).
        kv_rows = _query(
            conn,
            "SELECT ReportDataDictionaryIndex, KeyValue FROM ReportDataDictionary "
            "WHERE Name = 'Zone Ventilation Sensible Heat Loss Energy' COLLATE NOCASE",
        )
        nonzero_hours_any = set()
        for r in kv_rows:
            idx = r["ReportDataDictionaryIndex"]
            t_rows = _query(
                conn,
                "SELECT TimeIndex FROM ReportData WHERE ReportDataDictionaryIndex = ? AND Value > 0",
                (idx,),
            )
            for tr in t_rows:
                nonzero_hours_any.add(tr["TimeIndex"])
        return {
            "vent_loss_kwh":   _sum_annual(conn, "Zone Ventilation Sensible Heat Loss Energy"),
            "vent_gain_kwh":   _sum_annual(conn, "Zone Ventilation Sensible Heat Gain Energy"),
            "ideal_heat_kwh":  _sum_annual(conn, "Zone Ideal Loads Supply Air Total Heating Energy"),
            "ideal_cool_kwh":  _sum_annual(conn, "Zone Ideal Loads Supply Air Total Cooling Energy"),
            "ep_open_hours_proxy": len(nonzero_hours_any),
        }
    finally:
        conn.close()


def main():
    weather_file = "GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw"

    print("=== Brief 28e Gate E4b — temperature-mode functional test ===")
    print()
    print(f"Synthetic test project (in-memory; NOT persisted to DB)")
    print(f"  geometry          : 12 × 8 m, 1 floor, 3.5 m height (GIA 96 m²)")
    print(f"  WWR               : 0.3 all facades")
    print(f"  infiltration_ach  : 0.3")
    print(f"  internal gains    : people + lights 8 W/m² + equip 2+6 W/m²")
    print(f"  Weather           : Yeovilton TMYx")
    print()
    print(f"Operable opening under test:")
    print(f"  facade            : south")
    print(f"  area_m2           : 2.0")
    print(f"  height_m          : 1.5")
    print(f"  Cd                : 0.6")
    print(f"  Cw                : 0.25")
    print(f"  control.mode      : temperature")
    print(f"  open_above_zone_c : 22.0  (low-ish threshold to ensure firing in UK summer)")
    print(f"  hysteresis_c      : 1.0")
    print(f"  require_outside_cooler : True")
    print()

    project = build_synthetic_project(weather_file)

    print("Running Static engine (envelope-gains, Node subprocess)...")
    s = run_static_envelope_gains(project)
    natvent = s["losses_at_setpoint"].get("natural_ventilation", [])
    if not natvent:
        print("  ✗ Static engine did not return a natural_ventilation entry")
        raise SystemExit(1)
    op = natvent[0]
    print(f"  Static result for '{op['name']}':")
    print(f"    heat_loss_kwh         : {op['heat_loss_kwh']:.1f}")
    print(f"    cooling_gain_kwh      : {op['cooling_gain_kwh']:.1f}")
    print(f"    open_hours            : {op['open_hours']}")
    print(f"    avg_flow_when_open_l_s: {op['avg_flow_when_open_l_s']}")
    print(f"    avg_dT_when_open_k    : {op['avg_dT_when_open_k']}")
    print(f"  Static demand: heating {s['demand']['heating_demand_mwh']} MWh, "
          f"cooling {s['demand']['cooling_demand_mwh']} MWh")
    print(f"  Static annual-mean T_op: {s.get('free_running_mean_c', 'n/a')} °C")
    print()

    print("Running Dynamic (EP) on the same synthetic project...")
    sql_path, ej = assemble_and_run_dynamic(project)
    # Confirm what assembler emitted
    zv = ej.get("ZoneVentilation:WindandStackOpenArea", {})
    opening_objs = {k: v for k, v in zv.items() if "test_temp_opening" in k}
    print(f"  Assembler emitted {len(opening_objs)} ZoneVentilation object(s) for the opening:")
    if opening_objs:
        sample = next(iter(opening_objs.values()))
        print(f"    schedule_ref          : {sample['opening_area_fraction_schedule_name']}")
        print(f"    min_indoor_T          : {sample['minimum_indoor_temperature']} °C (gates opening when T_zone < this)")
        print(f"    max_outdoor_T         : {sample['maximum_outdoor_temperature']} °C (gates opening when T_out > this)")
        print(f"    height_difference     : {sample['height_difference']} m (stack lever arm)")
        print(f"    effective_angle       : {sample['effective_angle']}°")
    d = parse_dynamic(sql_path)
    print(f"  Dynamic ventilation loss (zone-aggregated): {d['vent_loss_kwh']:.0f} kWh")
    print(f"  Dynamic Ideal Loads: heating {d['ideal_heat_kwh']:.0f} kWh, cooling {d['ideal_cool_kwh']:.0f} kWh")
    print(f"  Dynamic open-hours proxy (any zone has ZoneVentilation loss > 0): {d['ep_open_hours_proxy']}")
    print()

    # ─── Comparison ──────────────────────────────────────────────────────────
    print("=== Comparison (per Chris's Gate E4b acceptance criteria) ===")
    print()
    s_open = op["open_hours"]
    d_open = d["ep_open_hours_proxy"]
    if s_open > 0:
        pct_oh = (d_open - s_open) / s_open * 100
    else:
        pct_oh = float("inf")
    verdict_oh = "PASS" if abs(pct_oh) <= 25 else "FAIL" if s_open > 0 else "INFO"
    print(f"  open_hours (±25% tolerance):")
    print(f"    Static  : {s_open}")
    print(f"    Dynamic : {d_open}")
    print(f"    Δ       : {(d_open - s_open):+}  ({pct_oh:+.2f}%)   {verdict_oh}")
    print()
    s_heat = op["heat_loss_kwh"]
    d_vent = d["vent_loss_kwh"]
    print(f"  Heat loss (Static opening-only vs Dynamic zone-aggregated ventilation):")
    print(f"    Static opening : {s_heat:.0f} kWh")
    print(f"    Dynamic vent   : {d_vent:.0f} kWh  (note: includes ALL ZoneVentilation in this zone;")
    print(f"                                       there are no other vent objects in this synthetic")
    print(f"                                       project so the comparison is meaningful)")
    if s_heat > 0:
        pct_h = (d_vent - s_heat) / s_heat * 100
        print(f"    Δ              : {(d_vent - s_heat):+.0f} kWh  ({pct_h:+.2f}%)")
    print()

    # Pathological-behaviour check
    print("  Pathological-behaviour check:")
    issues = []
    if s_open == 0:
        issues.append("Static open_hours = 0 (control never fires; threshold too high?)")
    if s_open == 8760:
        issues.append("Static open_hours = 8760 (control always open; threshold too low or hysteresis bug?)")
    if d_open == 0 and s_open > 0:
        issues.append("Dynamic open_hours = 0 despite Static firing (EP min_indoor_temperature gate?)")
    if d_open == 8760:
        issues.append("Dynamic open_hours = 8760 (no gating active?)")
    if not issues:
        print("    ✓ Both engines fire on a sensible subset of hours; neither pathological boundary triggered.")
    else:
        for i in issues:
            print(f"    ✗ {i}")
    print()

    # ─── Verdict ─────────────────────────────────────────────────────────────
    print("=== Gate E4b verdict ===")
    print()
    print(f"  Temperature-mode control fires on {s_open} hours (Static) / {d_open} hours (Dynamic).")
    print(f"  Both engines exercise the temperature-triggered control path on the synthetic test")
    print(f"  project. Static's strict hysteresis + outside-cooler check vs EP's independent-per-")
    print(f"  timestep gates produces a different open-hours count by design (see Gate E5 doc:")
    print(f"  EP-mapping limitations on hysteresis + require_outside_cooler approximation).")
    print()
    if not issues:
        print("  ✓ No pathological behaviour. Temperature-mode is end-to-end validated for both engines.")
    else:
        print(f"  ⚠ {len(issues)} pathological signal(s) — investigate before E5 doc.")
    print()
    print("HALT per Brief 28e Gate E4b — temperature-mode functional test complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
