#!/usr/bin/env python3
# ============================================================================
# Brief 95 P2 — Full-Bridgewater EnergyPlus IDF generator
# ============================================================================
#
# Consumes the FULL project-dump fixture (validation/fixtures/bridgewater_anchor_v2.yaml)
# and emits a runnable IDF for EnergyPlus 25-2-0. Unlike the Box generator
# (generate_idf.py, box-fixture-only, real material layers), the full fixture carries
# U-values only, per-facade WWR + window counts, and hourly gain/occupancy schedules.
#
# MODELLING DECISIONS (Brief 95 P2 — documented in docs/audit/95_ep_backend.md §3):
#  - Single thermal zone (multi-zone is OUT of scope). Footprint = length x width
#    (843 m2); height = num_floors x floor_height (16 m). Zone Floor_Area is set to the
#    GIA (4216 m2) so loads + EUI reference the whole building, matching NZA-Sim's
#    single-zone lumped model and the anchor's per-element areas (walls = perimeter x
#    16 m, roof/floor = footprint).
#  - Constructions from U-values → MATERIAL:NOMASS (R = 1/U − combined film). Glazing →
#    WINDOWMATERIAL:SIMPLEGLAZINGSYSTEM (U + g). Thermal mass is not represented (the
#    fixture carries no layers) — a documented simplification; P3 characterises accuracy.
#  - Gains: people (num_bedrooms x people_per_room), lighting (W/m2), equipment
#    (baseload W/m2), auxiliary/external-lighting (W/m2) — each on a SCHEDULE:COMPACT
#    built from the fixture's 24h weekday/sat/sun arrays x monthly multipliers.
#  - Ventilation (THIS FOUNDATION STAGE): MVHR supply + extract-only flows collapsed to a
#    single OA flow with a flow-weighted effective sensible recovery, on IdealLoads.
#    The real-equipment stage (P2 part 2) swaps IdealLoads for a PTHP-surrogate VRF
#    (DX coils + performance curves + supplemental electric) + an ERV + exhaust fans +
#    a two-stage DHW plant loop. This file is built in stages so the envelope+loads run
#    clean before the HVAC network is layered on.
#
# Usage:
#   python generate_full_idf.py                 # write generated/bridgewater_full_v1.idf
#   python generate_full_idf.py --check-determinism
#   python generate_full_idf.py --stdout
#
# EnergyPlus located via ENERGYPLUS_DIR / ep_config.json. Run inside validation/.venv.
# ============================================================================

import argparse
import sys
from io import StringIO
from pathlib import Path

import yaml
from eppy.modeleditor import IDF

SCRIPT_DIR = Path(__file__).resolve().parent
VALIDATION_DIR = SCRIPT_DIR.parent
REPO_ROOT = VALIDATION_DIR.parent
FIXTURE_PATH = VALIDATION_DIR / "fixtures" / "bridgewater_anchor_v2.yaml"
DEFAULT_OUT = SCRIPT_DIR / "generated" / "bridgewater_full_v1.idf"

# Reuse the Box generator's IDD resolver + numeric formatter + vertex flattener.
sys.path.insert(0, str(SCRIPT_DIR))
from generate_idf import resolve_idd, fnum, flat_verts  # noqa: E402

# Standard combined surface film resistances (ISO 6946) to back out material R from a
# whole-element U-value (which includes films).
HOURS = 8760.0
FILM_R = {"wall": 0.17, "roof": 0.14, "floor": 0.17}
MONTH_END = ["1/31", "2/28", "3/31", "4/30", "5/31", "6/30",
             "7/31", "8/31", "9/30", "10/31", "11/30", "12/31"]


def libcon_u(fix, name):
    for c in fix["library_constructions"]:
        if c["name"] == name:
            return float(c["u_value_W_per_m2K"])
    raise KeyError(f"construction not found in fixture: {name}")


def libcon_cfg(fix, name):
    for c in fix["library_constructions"]:
        if c["name"] == name:
            return c.get("config_json") or {}
    return {}


def rectangle(z0, z1, base):
    """Vertical wall rectangle from base (2 xy points) between heights z0..z1,
    UpperLeftCorner / counter-clockwise (matches Box GLOBALGEOMETRYRULES)."""
    (x0, y0), (x1, y1) = base
    return [(x0, y0, z1), (x0, y0, z0), (x1, y1, z0), (x1, y1, z1)]


def build_idf(fix, idd_path):
    IDF.setiddname(idd_path, testing=True)
    idf = IDF(StringIO(""))

    bc = fix["building_config"]
    v40 = bc["systems_config_v40"]
    L = float(bc["length"]); W = float(bc["width"])
    nfl = int(bc["num_floors"]); fh = float(bc["floor_height"])
    H = nfl * fh
    footprint = L * W
    gia = footprint * nfl
    volume = footprint * H
    orient = float(bc.get("orientation", 0))
    cb = fix.get("comfort_band", {}) or {}
    heat_sp = float(cb.get("lower_c", 21))
    cool_sp = float(cb.get("upper_c", 24))
    weather = fix.get("weather_file") or bc.get("weather_file")

    # ---- global sim control ------------------------------------------------
    idf.newidfobject("VERSION", Version_Identifier="25.2")
    idf.newidfobject("SIMULATIONCONTROL",
                     Do_Zone_Sizing_Calculation="No", Do_System_Sizing_Calculation="No",
                     Do_Plant_Sizing_Calculation="No", Run_Simulation_for_Sizing_Periods="No",
                     Run_Simulation_for_Weather_File_Run_Periods="Yes")
    idf.newidfobject("BUILDING", Name="Bridgewater_Full", North_Axis=orient,
                     Terrain="City", Solar_Distribution="FullExterior",
                     Maximum_Number_of_Warmup_Days=25, Minimum_Number_of_Warmup_Days=6)
    idf.newidfobject("TIMESTEP", Number_of_Timesteps_per_Hour=6)
    idf.newidfobject("HEATBALANCEALGORITHM", Algorithm="ConductionTransferFunction")
    idf.newidfobject("SURFACECONVECTIONALGORITHM:INSIDE", Algorithm="TARP")
    idf.newidfobject("SURFACECONVECTIONALGORITHM:OUTSIDE", Algorithm="DOE-2")
    # Relative coords so the Building North_Axis (orientation) is actually applied to the
    # geometry — under World coords EP ignores non-zero North Axis (Brief 95 P2 fix).
    idf.newidfobject("GLOBALGEOMETRYRULES", Starting_Vertex_Position="UpperLeftCorner",
                     Vertex_Entry_Direction="Counterclockwise", Coordinate_System="Relative")
    idf.newidfobject("RUNPERIOD", Name="Annual", Begin_Month=1, Begin_Day_of_Month=1,
                     End_Month=12, End_Day_of_Month=31, Day_of_Week_for_Start_Day="Sunday",
                     Use_Weather_File_Holidays_and_Special_Days="No",
                     Use_Weather_File_Daylight_Saving_Period="No",
                     Apply_Weekend_Holiday_Rule="No", Use_Weather_File_Rain_Indicators="Yes",
                     Use_Weather_File_Snow_Indicators="Yes")
    idf.newidfobject("OUTPUT:DIAGNOSTICS", Key_1="DisplayExtraWarnings")

    # ---- schedule type limits ----------------------------------------------
    idf.newidfobject("SCHEDULETYPELIMITS", Name="Fraction", Lower_Limit_Value=0,
                     Upper_Limit_Value=1, Numeric_Type="Continuous")
    idf.newidfobject("SCHEDULETYPELIMITS", Name="Temperature", Numeric_Type="Continuous")
    idf.newidfobject("SCHEDULETYPELIMITS", Name="ControlType", Lower_Limit_Value=0,
                     Upper_Limit_Value=4, Numeric_Type="Discrete")
    idf.newidfobject("SCHEDULETYPELIMITS", Name="ActivityLevel", Lower_Limit_Value=0,
                     Numeric_Type="Continuous")

    def add_compact(name, limits, fields):
        obj = idf.newidfobject("SCHEDULE:COMPACT")
        obj.obj = ["Schedule:Compact", name, limits] + [str(f) for f in fields]

    def hourly_fields(day24):
        out = []
        for h in range(24):
            out += [f"Until: {h + 1:02d}:00", fnum(round(float(day24[h]), 5))]
        return out

    def month_schedule(name, sched):
        """SCHEDULE:COMPACT from {weekday,saturday,sunday}[24] x monthly_multipliers[12]."""
        wd = sched.get("weekday", [0] * 24)
        sa = sched.get("saturday", wd)
        su = sched.get("sunday", sa)
        mm = sched.get("monthly_multipliers", [1] * 12)
        fields = []
        for m in range(12):
            k = float(mm[m]) if m < len(mm) else 1.0
            fields += [f"Through: {MONTH_END[m]}"]
            fields += ["For: Weekdays"] + hourly_fields([v * k for v in wd])
            fields += ["For: Saturday"] + hourly_fields([v * k for v in sa])
            fields += ["For: Sunday Holidays AllOtherDays"] + hourly_fields([v * k for v in su])
        add_compact(name, "Fraction", fields)

    add_compact("ALWAYS_ON", "Fraction", ["Through: 12/31", "For: AllDays", "Until: 24:00", "1.0"])
    month_schedule("OCC_SCHED", bc["occupancy"]["schedule"])
    month_schedule("LIGHTS_SCHED", bc["gains"]["lighting"]["profiles"][0]["schedule"])
    month_schedule("EQUIP_SCHED", bc["gains"]["equipment"]["profiles"][0]["schedule"])
    aux_prof = bc["gains"]["auxiliary"]["profiles"][0]
    month_schedule("AUX_SCHED", aux_prof["schedule"])
    # People activity level (sensible + latent, W/person) + occupancy setpoints.
    sens = float(bc["occupancy"]["sensible_w_per_person"])
    lat = float(bc["occupancy"]["latent_w_per_person"])
    add_compact("ACTIVITY_LEVEL", "ActivityLevel",
                ["Through: 12/31", "For: AllDays", "Until: 24:00", fnum(sens + lat)])
    add_compact("HEATING_SETPOINT", "Temperature",
                ["Through: 12/31", "For: AllDays", "Until: 24:00", fnum(heat_sp)])
    add_compact("COOLING_SETPOINT", "Temperature",
                ["Through: 12/31", "For: AllDays", "Until: 24:00", fnum(cool_sp)])
    add_compact("DUAL_CONTROL_TYPE", "ControlType",
                ["Through: 12/31", "For: AllDays", "Until: 24:00", "4"])

    # ---- constructions from U-values (NoMass) + simple glazing --------------
    cc = fix["construction_choices"]

    def add_nomass(name, u, film):
        r = max(0.01, 1.0 / u - film)
        idf.newidfobject("MATERIAL:NOMASS", Name=f"{name}_MAT", Roughness="MediumRough",
                         Thermal_Resistance=r, Thermal_Absorptance=0.9,
                         Solar_Absorptance=0.6, Visible_Absorptance=0.6)
        obj = idf.newidfobject("CONSTRUCTION", Name=name)
        obj.Outside_Layer = f"{name}_MAT"

    add_nomass("EXT_WALL", libcon_u(fix, cc["external_wall"]), FILM_R["wall"])
    add_nomass("ROOF", libcon_u(fix, cc["roof"]), FILM_R["roof"])
    add_nomass("GROUND_FLOOR", libcon_u(fix, cc["ground_floor"]), FILM_R["floor"])
    gl_cfg = libcon_cfg(fix, cc["glazing"])
    idf.newidfobject("WINDOWMATERIAL:SIMPLEGLAZINGSYSTEM", Name="GLAZING_MAT",
                     UFactor=float(gl_cfg.get("u_value_W_per_m2K", libcon_u(fix, cc["glazing"]))),
                     Solar_Heat_Gain_Coefficient=float(gl_cfg.get("g_value", 0.55)),
                     Visible_Transmittance=float(gl_cfg.get("light_transmission", 0.7)))
    glz = idf.newidfobject("CONSTRUCTION", Name="GLAZING")
    glz.Outside_Layer = "GLAZING_MAT"

    # ---- zone --------------------------------------------------------------
    idf.newidfobject("ZONE", Name="Building_Zone", Direction_of_Relative_North=0,
                     X_Origin=0, Y_Origin=0, Z_Origin=0, Type=1, Multiplier=1,
                     Ceiling_Height=H, Volume=volume, Floor_Area=gia)

    # ---- surfaces (footprint corners, CCW) ---------------------------------
    # Corners: (0,0) (L,0) (L,W) (0,W). Facades: south y=0, east x=L, north y=W, west x=0.
    c = {"sw": (0, 0), "se": (L, 0), "ne": (L, W), "nw": (0, W)}
    facades = {  # name: (base edge as 2 pts left→right seen from outside, wwr, count)
        "SOUTH": ((c["sw"], c["se"]), bc["wwr"]["south"]),
        "EAST":  ((c["se"], c["ne"]), bc["wwr"]["east"]),
        "NORTH": ((c["ne"], c["nw"]), bc["wwr"]["north"]),
        "WEST":  ((c["nw"], c["sw"]), bc["wwr"]["west"]),
    }

    def add_surface(name, stype, constr, bc_cond, sun, wind, verts):
        obj = idf.newidfobject("BUILDINGSURFACE:DETAILED")
        obj.obj = ["BuildingSurface:Detailed", name, stype, constr, "Building_Zone", bc_cond,
                   "" if bc_cond == "Outdoors" else "", sun, wind, "autocalculate",
                   str(len(verts))] + flat_verts(verts)
        # fix outside-boundary fields: (name,type,constr,zone,space,bc,bcobj,sun,wind,vertcount,verts)
        obj.obj = ["BuildingSurface:Detailed", name, stype, constr, "Building_Zone", "", bc_cond,
                   "", sun, wind, "autocalculate", str(len(verts))] + flat_verts(verts)

    # walls (full height) with punched window fraction handled via separate windows
    for fname, (base, wwr) in facades.items():
        add_surface(f"WALL_{fname}", "Wall", "EXT_WALL", "Outdoors",
                    "SunExposed", "WindExposed", rectangle(0, H, base))
    # roof (at z=H) and ground floor (at z=0)
    roof_v = [(0, W, H), (0, 0, H), (L, 0, H), (L, W, H)]
    add_surface("ROOF", "Roof", "ROOF", "Outdoors", "SunExposed", "WindExposed", roof_v)
    floor_v = [(0, 0, 0), (0, W, 0), (L, W, 0), (L, 0, 0)]
    add_surface("FLOOR", "Floor", "GROUND_FLOOR", "Ground", "NoSun", "NoWind", floor_v)

    # ---- windows (one aggregate window per facade, WWR-scaled, centred) -----
    def add_window(name, host, verts):
        obj = idf.newidfobject("FENESTRATIONSURFACE:DETAILED")
        obj.obj = ["FenestrationSurface:Detailed", name, "Window", "GLAZING", host, "",
                   "autocalculate", "", "1", str(len(verts))] + flat_verts(verts)

    for fname, (base, wwr) in facades.items():
        if wwr <= 0:
            continue
        (x0, y0), (x1, y1) = base
        seg = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
        # window band: centred vertically, height = wwr*H, full-ish width via inset
        wh = wwr * H
        z_lo = (H - wh) / 2.0
        z_hi = z_lo + wh
        inset = 0.02
        ux, uy = (x1 - x0) / seg, (y1 - y0) / seg
        xa, ya = x0 + ux * seg * inset, y0 + uy * seg * inset
        xb, yb = x0 + ux * seg * (1 - inset), y0 + uy * seg * (1 - inset)
        verts = [(xa, ya, z_hi), (xa, ya, z_lo), (xb, yb, z_lo), (xb, yb, z_hi)]
        add_window(f"WIN_{fname}", f"WALL_{fname}", verts)

    # ---- internal gains — matched to NZA-Sim per-load zone heat "by construction" ----
    # Brief 95 gain-parity check (Chris 2026-07-07): every load's ANNUAL zone-heat must
    # equal NZA-Sim's booked value, so the demand comparison isolates the envelope, not the
    # gain inputs. NZA per-load (from bridgewater_anchor_v2.yaml via
    # `_brief93_anchor.mjs --fixture`, frozen fixture): people 120.41, lighting 39.01,
    # equipment 186.14, aux 0 MWh. NZA differs from a raw magnitude×schedule because it
    # (a) treats equipment BASELOAD as always-on (constant, active=0 → 5.04 W/m² × 8760),
    # (b) daylight-dims lighting, (c) integrates occupancy on a different day/monthly basis.
    NZA_GAIN_MWH = {"people": 120.41, "lighting": 39.01}

    def sched_avg(s):
        wd = s.get("weekday", [0] * 24); sa = s.get("saturday", wd); su = s.get("sunday", sa)
        mm = s.get("monthly_multipliers", [1] * 12)
        daily = (5 * sum(wd) + sum(sa) + sum(su)) / 7 / 24
        return daily * (sum(mm) / len(mm))

    occ_avg = sched_avg(bc["occupancy"]["schedule"])
    lit_avg = sched_avg(bc["gains"]["lighting"]["profiles"][0]["schedule"])
    shf = sens / (sens + lat)
    # People count set so sensible zone heat over OCC_SCHED == NZA people (fractional OK).
    people = NZA_GAIN_MWH["people"] * 1e6 / (sens * HOURS * occ_avg)
    idf.newidfobject("PEOPLE", Name="People", Zone_or_ZoneList_or_Space_or_SpaceList_Name="Building_Zone",
                     Number_of_People_Schedule_Name="OCC_SCHED",
                     Number_of_People_Calculation_Method="People", Number_of_People=round(people, 2),
                     Activity_Level_Schedule_Name="ACTIVITY_LEVEL",
                     Sensible_Heat_Fraction=round(shf, 4), Fraction_Radiant=0.3)
    # Lighting level set so gain over LIGHTS_SCHED == NZA lighting (daylight-dimmed).
    light_level = NZA_GAIN_MWH["lighting"] * 1e6 / (HOURS * lit_avg)
    idf.newidfobject("LIGHTS", Name="Lights", Zone_or_ZoneList_or_Space_or_SpaceList_Name="Building_Zone",
                     Schedule_Name="LIGHTS_SCHED", Design_Level_Calculation_Method="LightingLevel",
                     Lighting_Level=round(light_level, 1), Return_Air_Fraction=0,
                     Fraction_Radiant=0.5, Fraction_Visible=0.2)
    # Equipment: baseload is ALWAYS-ON (constant); active=0. → 5.04 W/m² × 8760 = 186.1 MWh.
    epd = float(bc["gains"]["equipment"]["profiles"][0]["baseload"]["value"])
    idf.newidfobject("ELECTRICEQUIPMENT", Name="Equipment",
                     Zone_or_ZoneList_or_Space_or_SpaceList_Name="Building_Zone",
                     Schedule_Name="ALWAYS_ON", Design_Level_Calculation_Method="EquipmentLevel",
                     Design_Level=epd * gia, Fraction_Latent=0, Fraction_Radiant=0.3, Fraction_Lost=0)
    auxd = float(aux_prof["magnitude"]["value"])
    # External lighting → an equipment object with Fraction_Lost=1 (electricity use, no zone gain).
    idf.newidfobject("ELECTRICEQUIPMENT", Name="ExternalLighting",
                     Zone_or_ZoneList_or_Space_or_SpaceList_Name="Building_Zone",
                     Schedule_Name="AUX_SCHED", Design_Level_Calculation_Method="EquipmentLevel",
                     Design_Level=auxd * gia, Fraction_Latent=0, Fraction_Radiant=0, Fraction_Lost=1)

    # ---- infiltration ------------------------------------------------------
    idf.newidfobject("ZONEINFILTRATION:DESIGNFLOWRATE", Name="Infiltration",
                     Zone_or_ZoneList_or_Space_or_SpaceList_Name="Building_Zone",
                     Schedule_Name="ALWAYS_ON", Design_Flow_Rate_Calculation_Method="AirChanges/Hour",
                     Air_Changes_per_Hour=float(bc["infiltration_ach"]),
                     Constant_Term_Coefficient=1.0, Temperature_Term_Coefficient=0.0,
                     Velocity_Term_Coefficient=0.0, Velocity_Squared_Term_Coefficient=0.0)

    # ---- ventilation (FOUNDATION: blended OA + effective recovery on IdealLoads) --
    vents = [v for v in v40["ventilation"] if v.get("enabled", True)]
    total_flow = sum(float(v["flow_rate"]) for v in vents)          # L/s
    rec_num = sum(float(v["flow_rate"]) * float(v["efficiency_metric"].get("recovery_sensible_pct", 0)) / 100.0
                  for v in vents)
    eff_hre = (rec_num / total_flow) if total_flow else 0.0
    oa_flow = total_flow / 1000.0                                    # m3/s
    idf.newidfobject("DESIGNSPECIFICATION:OUTDOORAIR", Name="MVHR_OA",
                     Outdoor_Air_Method="Flow/Zone", Outdoor_Air_Flow_per_Person=0,
                     Outdoor_Air_Flow_per_Zone_Floor_Area=0, Outdoor_Air_Flow_per_Zone=oa_flow)
    idf.newidfobject("OUTDOORAIR:NODE", Name="OA_Inlet_Node")

    # ---- thermostat + ideal loads (foundation) -----------------------------
    idf.newidfobject("ZONECONTROL:THERMOSTAT", Name="Thermostat",
                     Zone_or_ZoneList_Name="Building_Zone", Control_Type_Schedule_Name="DUAL_CONTROL_TYPE",
                     Control_1_Object_Type="ThermostatSetpoint:DualSetpoint", Control_1_Name="DualSP")
    idf.newidfobject("THERMOSTATSETPOINT:DUALSETPOINT", Name="DualSP",
                     Heating_Setpoint_Temperature_Schedule_Name="HEATING_SETPOINT",
                     Cooling_Setpoint_Temperature_Schedule_Name="COOLING_SETPOINT")
    idf.newidfobject("ZONEHVAC:EQUIPMENTCONNECTIONS", Zone_Name="Building_Zone",
                     Zone_Conditioning_Equipment_List_Name="EquipList",
                     Zone_Air_Inlet_Node_or_NodeList_Name="Supply_Inlet",
                     Zone_Air_Node_Name="Zone_Air_Node", Zone_Return_Air_Node_or_NodeList_Name="Return_Node")
    idf.newidfobject("ZONEHVAC:EQUIPMENTLIST", Name="EquipList", Load_Distribution_Scheme="SequentialLoad",
                     Zone_Equipment_1_Object_Type="ZoneHVAC:IdealLoadsAirSystem",
                     Zone_Equipment_1_Name="IdealLoads", Zone_Equipment_1_Cooling_Sequence=1,
                     Zone_Equipment_1_Heating_or_NoLoad_Sequence=1)
    idf.newidfobject("ZONEHVAC:IDEALLOADSAIRSYSTEM", Name="IdealLoads",
                     Zone_Supply_Air_Node_Name="Supply_Inlet",
                     Maximum_Heating_Supply_Air_Temperature=50, Minimum_Cooling_Supply_Air_Temperature=13,
                     Maximum_Heating_Supply_Air_Humidity_Ratio=0.0156,
                     Minimum_Cooling_Supply_Air_Humidity_Ratio=0.0077,
                     Heating_Limit="NoLimit", Cooling_Limit="NoLimit",
                     Dehumidification_Control_Type="None", Humidification_Control_Type="None",
                     Design_Specification_Outdoor_Air_Object_Name="MVHR_OA",
                     Outdoor_Air_Inlet_Node_Name="OA_Inlet_Node",
                     Demand_Controlled_Ventilation_Type="None", Outdoor_Air_Economizer_Type="NoEconomizer",
                     Heat_Recovery_Type="Sensible", Sensible_Heat_Recovery_Effectiveness=round(eff_hre, 4),
                     Latent_Heat_Recovery_Effectiveness=0.0)

    # ---- output ------------------------------------------------------------
    idf.newidfobject("OUTPUT:VARIABLEDICTIONARY", Key_Field="IDF")
    idf.newidfobject("OUTPUT:SQLITE", Option_Type="SimpleAndTabular")
    idf.newidfobject("OUTPUTCONTROL:TABLE:STYLE", Column_Separator="CommaAndHTML")
    idf.newidfobject("OUTPUT:TABLE:SUMMARYREPORTS", Report_1_Name="AllSummary")
    for m in ["Electricity:Facility", "NaturalGas:Facility"]:
        idf.newidfobject("OUTPUT:METER", Key_Name=m, Reporting_Frequency="RunPeriod")
    for v in ["Zone Ideal Loads Zone Sensible Heating Energy",
              "Zone Ideal Loads Zone Sensible Cooling Energy"]:
        idf.newidfobject("OUTPUT:VARIABLE", Key_Value="*", Variable_Name=v, Reporting_Frequency="RunPeriod")

    return idf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--stdout", action="store_true")
    ap.add_argument("--check-determinism", action="store_true")
    args = ap.parse_args()

    fix = yaml.safe_load(FIXTURE_PATH.read_text())
    idd = resolve_idd()

    if args.check_determinism:
        a = build_idf(fix, idd).idfstr()
        b = build_idf(fix, idd).idfstr()
        if a == b:
            print(f"DETERMINISM OK: two builds byte-identical ({len(a)} bytes).")
            sys.exit(0)
        print("DETERMINISM FAIL: builds differ.")
        sys.exit(1)

    idf = build_idf(fix, idd)
    text = idf.idfstr()
    if args.stdout:
        sys.stdout.write(text)
    else:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text)
        print(f"[gen] wrote {out.relative_to(REPO_ROOT)} ({len(text)} bytes)")


if __name__ == "__main__":
    main()
