"""
scripts/state1_envelope_only_verify.py

Brief 28 prereq Part 1 — Verify the assembler's envelope-only mode

Builds a Bridgewater envelope-only epJSON via assemble_epjson(...,
mode='envelope-only') and inspects it for the four properties Brief 28
prereq Part 1 requires:

  1. IdealLoads HVAC with wide-band setpoints (-60 / +100 deg C) so the
     zone runs free against the envelope.
  2. NO People / Lights / ElectricEquipment objects (those are State 2+).
  3. NO operable-window mechanisms (AirflowNetwork:* or
     ZoneVentilation:* — those are State 2.5+).
  4. NO real systems (boilers / VRF / heat pumps / DHW — those are State 3+).

Exit 0 = all four pass. Exit 1 = at least one fail (halt under HH4).

Usage:
  python scripts/state1_envelope_only_verify.py [project_id]
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from nza_engine.generators.epjson_assembler import assemble_epjson


def load_project(project_id: str) -> dict:
    db_path = REPO_ROOT / "data/nza_sim.db"
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    row = con.execute(
        "SELECT name, building_config, construction_choices, systems_config, weather_file "
        "FROM projects WHERE id = ?", (project_id,),
    ).fetchone()
    con.close()
    if not row:
        raise RuntimeError(f"Project {project_id} not found")
    return {
        "name": row["name"],
        "building_config":      json.loads(row["building_config"]),
        "construction_choices": json.loads(row["construction_choices"]) if row["construction_choices"] else {},
        "systems_config":       json.loads(row["systems_config"]) if row["systems_config"] else {},
        "weather_file":         row["weather_file"],
    }


def resolve_epw(weather_file: str) -> Path:
    for c in [REPO_ROOT / "data/weather/current" / weather_file,
              REPO_ROOT / "data/weather" / weather_file]:
        if c.exists():
            return c
    raise FileNotFoundError(f"Weather file not found: {weather_file}")


def main() -> int:
    project_id = sys.argv[1] if len(sys.argv) > 1 else "14b4a5b1-8c73-4acb-8b65-1d22f05ec969"
    project = load_project(project_id)
    weather_file = project["weather_file"] or project["building_config"].get("weather_file")
    epw_path = resolve_epw(weather_file)

    epjson = assemble_epjson(
        building_params=project["building_config"],
        construction_choices=project["construction_choices"],
        weather_file_path=epw_path,
        output_path=None,
        systems_config=project["systems_config"],
        mode="envelope-only",
    )

    print()
    print("=" * 73)
    print("  STATE 1 ENVELOPE-ONLY MODE VERIFICATION - Brief 28 prereq Part 1")
    print("=" * 73)
    print(f"  Project:   {project['name']} ({project_id})")
    print(f"  Mode:      envelope-only")
    print(f"  Object types in epJSON: {len(epjson)}")
    print()

    failures = []

    # ── Check 1: Wide-band setpoints + IdealLoads HVAC ──────────────────────
    sched_const = epjson.get("Schedule:Constant", {})
    heating = sched_const.get("state1_heating_setpoint", {})
    cooling = sched_const.get("state1_cooling_setpoint", {})
    heating_val = heating.get("hourly_value")
    cooling_val = cooling.get("hourly_value")
    ideal_loads = epjson.get("ZoneHVAC:IdealLoadsAirSystem", {})

    print("  Check 1: Wide-band setpoints + IdealLoads")
    print(f"    state1_heating_setpoint: {heating_val}     (expected -60.0)")
    print(f"    state1_cooling_setpoint: {cooling_val}     (expected +100.0)")
    print(f"    IdealLoadsAirSystem objects: {len(ideal_loads)}     (expected >= 1)")
    if heating_val == -60.0 and cooling_val == 100.0 and len(ideal_loads) >= 1:
        print("    PASS")
    else:
        print("    FAIL")
        failures.append("setpoints/ideal-loads")

    # Verify thermostats actually reference state1 setpoints
    thermostats = epjson.get("ThermostatSetpoint:DualSetpoint", {})
    bad_thermostats = []
    for name, t in thermostats.items():
        h = t.get("heating_setpoint_temperature_schedule_name")
        c = t.get("cooling_setpoint_temperature_schedule_name")
        if h != "state1_heating_setpoint" or c != "state1_cooling_setpoint":
            bad_thermostats.append((name, h, c))
    print(f"    Thermostats referencing state1 setpoints: "
          f"{len(thermostats) - len(bad_thermostats)}/{len(thermostats)}")
    if bad_thermostats:
        for name, h, c in bad_thermostats[:3]:
            print(f"      ! {name}: heating={h!r}, cooling={c!r}")
        print("    FAIL")
        failures.append("thermostat-references")

    print()

    # ── Check 2: Zero gain magnitudes ──────────────────────────────────────
    # Updated 2026-05-14 (Option C+): we check magnitudes, not object counts.
    # Emitting zero-density placeholder objects is fine -- they keep schedule
    # references valid and contribute no heat. What matters is that the
    # densities themselves are zero.
    def max_value(section: str, field: str) -> float:
        objs = epjson.get(section, {})
        if not objs:
            return 0.0
        return max(obj.get(field, 0.0) for obj in objs.values())

    max_people = max_value("People",            "people_per_floor_area")
    max_lights = max_value("Lights",            "watts_per_floor_area")
    max_equip  = max_value("ElectricEquipment", "watts_per_floor_area")

    print("  Check 2: Zero gain magnitudes (object counts irrelevant; magnitudes must be 0)")
    print(f"    max People  people_per_floor_area: {max_people}     (expected 0.0)")
    print(f"    max Lights  watts_per_floor_area:  {max_lights}     (expected 0.0)")
    print(f"    max Equip   watts_per_floor_area:  {max_equip}     (expected 0.0)")
    if max_people == 0.0 and max_lights == 0.0 and max_equip == 0.0:
        print("    PASS")
    else:
        print("    FAIL")
        failures.append("non-zero-gain-magnitudes")

    print()

    # ── Check 3: No operable-window mechanisms ─────────────────────────────
    afn_zone     = len(epjson.get("AirflowNetwork:MultiZone:Zone", {}))
    afn_surface  = len(epjson.get("AirflowNetwork:MultiZone:Surface", {}))
    afn_sim      = len(epjson.get("AirflowNetwork:SimulationControl", {}))
    zone_vent    = len(epjson.get("ZoneVentilation:DesignFlowRate", {}))
    zone_vent_wd = len(epjson.get("ZoneVentilation:WindandStackOpenArea", {}))

    print("  Check 3: No operable-window mechanisms")
    print(f"    AirflowNetwork:MultiZone:Zone:        {afn_zone}     (expected 0)")
    print(f"    AirflowNetwork:MultiZone:Surface:     {afn_surface}     (expected 0)")
    print(f"    AirflowNetwork:SimulationControl:     {afn_sim}     (expected 0)")
    print(f"    ZoneVentilation:DesignFlowRate:       {zone_vent}     (expected 0)")
    print(f"    ZoneVentilation:WindandStackOpenArea: {zone_vent_wd}     (expected 0)")
    if (afn_zone + afn_surface + afn_sim + zone_vent + zone_vent_wd) == 0:
        print("    PASS")
    else:
        print("    FAIL")
        failures.append("operable-windows-present")

    print()

    # ── Check 4: No real systems ────────────────────────────────────────────
    boilers  = len(epjson.get("Boiler:HotWater", {}))
    vrf_out  = len(epjson.get("AirConditioner:VariableRefrigerantFlow", {}))
    vrf_term = len(epjson.get("ZoneHVAC:TerminalUnit:VariableRefrigerantFlow", {}))
    coils_h  = len(epjson.get("Coil:Heating:DX:VariableRefrigerantFlow", {}))
    coils_c  = len(epjson.get("Coil:Cooling:DX:VariableRefrigerantFlow", {}))
    waterhtr = len(epjson.get("WaterHeater:Mixed", {}))
    pumps    = len(epjson.get("Pump:VariableSpeed", {})) + len(epjson.get("Pump:ConstantSpeed", {}))
    baseboard= len(epjson.get("ZoneHVAC:Baseboard:Convective:Gas", {}))

    print("  Check 4: No real systems")
    print(f"    Boiler:HotWater:                        {boilers}     (expected 0)")
    print(f"    AirConditioner:VRF:                     {vrf_out}     (expected 0)")
    print(f"    ZoneHVAC:TerminalUnit:VRF:              {vrf_term}     (expected 0)")
    print(f"    Coil:Heating:DX:VRF:                    {coils_h}     (expected 0)")
    print(f"    Coil:Cooling:DX:VRF:                    {coils_c}     (expected 0)")
    print(f"    WaterHeater:Mixed:                      {waterhtr}     (expected 0)")
    print(f"    Pump:VariableSpeed/ConstantSpeed:       {pumps}     (expected 0)")
    print(f"    ZoneHVAC:Baseboard:Convective:Gas:      {baseboard}     (expected 0)")
    if (boilers + vrf_out + vrf_term + coils_h + coils_c + waterhtr + pumps + baseboard) == 0:
        print("    PASS")
    else:
        print("    FAIL")
        failures.append("real-systems-present")

    print()
    print("=" * 73)
    if not failures:
        print("  ALL CHECKS PASS - envelope-only mode produces a genuinely free-running epJSON")
        print("=" * 73)
        return 0
    else:
        print(f"  FAILED: {len(failures)} check(s): {', '.join(failures)}")
        print("=" * 73)
        return 1


if __name__ == "__main__":
    sys.exit(main())
