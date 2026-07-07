#!/usr/bin/env python3
# ============================================================================
# Brief 81 P6 — Bridgewater-Box EnergyPlus IDF generator
# ============================================================================
#
# Reads the single source of truth (validation/fixtures/bridgewater_box_v1.yaml)
# and programmatically emits an EnergyPlus IDF that is SEMANTICALLY EQUIVALENT
# to the hand-authored reference (validation/energyplus/bridgewater_box_v1.idf,
# Brief 81 P5). "The EnergyPlus way": every object is built through eppy against
# the V26.1 IDD, so field names/positions are validated by the IDD rather than
# guessed, and the generated IDF is the ultimate IDD-checked by running it.
#
# Two properties this generator guarantees (verified in audit §6):
#   1. BYTE-STABILITY  — the build is a pure function of the YAML. Re-running it
#      produces byte-identical output (no timestamps, no dict-ordering drift).
#      `--check-determinism` builds twice in-memory and asserts equality.
#   2. SEMANTIC EQUIVALENCE — the generated IDF runs clean on EnergyPlus and its
#      annual outputs match the P5 hand-authored run within rounding. Verified by
#      running both and diffing the SQLite annual totals (audit §6.3).
#
# The generated IDF is intentionally NOT byte-identical to the hand-authored
# one (eppy's canonical field-comment style differs from the hand-laid banners).
# Equivalence is at the OBJECT/OUTPUT level, which is what the comparison harness
# (P7-P9) consumes.
#
# Usage:
#   python generate_idf.py                 # write generated/bridgewater_box_v1.idf
#   python generate_idf.py --out PATH      # write to a specific path
#   python generate_idf.py --check-determinism   # build twice, assert identical
#   python generate_idf.py --stdout        # print IDF to stdout (no file write)
#
# EnergyPlus is located via ENERGYPLUS_DIR env var, else ep_config.json (idd).
# Run inside the contained venv: validation/.venv (eppy + pyyaml; gitignored).
# ============================================================================

import argparse
import json
import os
import sys
from io import StringIO
from pathlib import Path

import yaml

# --- paths -------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent              # validation/energyplus
VALIDATION_DIR = SCRIPT_DIR.parent                         # validation
REPO_ROOT = VALIDATION_DIR.parent                          # repo root
FIXTURE_PATH = VALIDATION_DIR / "fixtures" / "bridgewater_box_v1.yaml"
EP_CONFIG_PATH = SCRIPT_DIR / "ep_config.json"
DEFAULT_OUT = SCRIPT_DIR / "generated" / "bridgewater_box_v1.idf"

# --- generator constants (calibrated to the P5 hand-authored reference) ------
# Placement details the fixture does not parametrise but P5 fixed; reproduced
# here so the generated IDF matches the hand-authored geometry exactly.
WINDOW_SILL_M = 0.75            # window sill height; head = sill + window height
# Thermal bridge (D5e): a detached 1 m x 1 m NoMass conductance patch. The
# fixture gives h_tb = 2.0 W/K (psi 0.05 x 40 m). With a 1 m^2 patch and the
# TARP/DOE-2 surface films EnergyPlus applies, a NoMass thermal resistance of
# 0.33 m^2K/W yields the ~2.0 W/K as-run conductance measured in P5 (audit §5.4).
TB_PATCH_ORIGIN = (20.0, 20.0)  # detached, away from the box
TB_PATCH_SIZE_M = 1.0           # 1 m wide x 1 m tall -> 1 m^2
TB_MATERIAL_R = 0.33            # NoMass thermal resistance {m2-K/W}

# IdealLoads supply-air limits (EnergyPlus IdealLoads defaults, stated explicitly
# to match the P5 reference and keep the generated IDF self-documenting).
IDEALLOADS_MAX_HEAT_SUPPLY_T = 50
IDEALLOADS_MIN_COOL_SUPPLY_T = 13
IDEALLOADS_MAX_HEAT_HUMRAT = 0.0156
IDEALLOADS_MIN_COOL_HUMRAT = 0.0077

# People metabolic split: activity level = sensible + latent (W/person).
# Sensible Heat Fraction (SHF) for the People object = sensible / activity.


# ============================================================================
# EnergyPlus / IDD location
# ============================================================================
def resolve_idd() -> str:
    """Locate Energy+.idd via ENERGYPLUS_DIR (override) or ep_config.json."""
    env_dir = os.environ.get("ENERGYPLUS_DIR")
    if env_dir:
        idd = Path(env_dir) / "Energy+.idd"
        if idd.is_file():
            return str(idd)
        raise FileNotFoundError(f"ENERGYPLUS_DIR set but no Energy+.idd at {idd}")
    if EP_CONFIG_PATH.is_file():
        cfg = json.loads(EP_CONFIG_PATH.read_text(encoding="utf-8"))
        idd = cfg.get("idd")
        if idd and Path(idd).is_file():
            return idd
    raise FileNotFoundError(
        "Could not locate Energy+.idd. Set ENERGYPLUS_DIR or fix ep_config.json."
    )


# ============================================================================
# Fixture parsing helpers
# ============================================================================
def parse_window(spec: str):
    """'07:00-21:00' -> ('07:00', '21:00') as 'HH:MM' Until-tokens."""
    start, end = spec.split("-")
    return start.strip(), end.strip()


def shf_from_split(sensible_w, latent_w):
    """People Sensible Heat Fraction = sensible / (sensible + latent)."""
    activity = sensible_w + latent_w
    return round(sensible_w / activity, 4), activity


# ============================================================================
# Geometry (parametric, World coords, CCW-from-outside, upper-left start)
# Matches P5: +Y North, -Y South, +X East, -X West. x 0..L, y 0..W, z 0..H.
# ============================================================================
def box_surfaces(L, W, H):
    """Return ordered list of (name, type, construction, sun, wind, verts)."""
    return [
        ("Wall_South", "Wall", "EXT_WALL", "SunExposed", "WindExposed",
         [(0, 0, H), (0, 0, 0), (L, 0, 0), (L, 0, H)]),
        ("Wall_North", "Wall", "EXT_WALL", "SunExposed", "WindExposed",
         [(L, W, H), (L, W, 0), (0, W, 0), (0, W, H)]),
        ("Wall_East", "Wall", "EXT_WALL", "SunExposed", "WindExposed",
         [(L, 0, H), (L, 0, 0), (L, W, 0), (L, W, H)]),
        ("Wall_West", "Wall", "EXT_WALL", "SunExposed", "WindExposed",
         [(0, W, H), (0, W, 0), (0, 0, 0), (0, 0, H)]),
        ("Roof", "Roof", "ROOF", "SunExposed", "WindExposed",
         [(0, 0, H), (L, 0, H), (L, W, H), (0, W, H)]),
        # Ground floor -> Outdoors / NoSun / NoWind (D5a).
        ("Floor", "Floor", "GROUND_FLOOR", "NoSun", "NoWind",
         [(0, 0, 0), (0, W, 0), (L, W, 0), (L, 0, 0)]),
    ]


def thermal_bridge_surface():
    """Detached 1 m^2 NoMass conductance patch (D5e)."""
    ox, oy = TB_PATCH_ORIGIN
    s = TB_PATCH_SIZE_M
    verts = [(ox, oy, s), (ox, oy, 0.0), (ox + s, oy, 0.0), (ox + s, oy, s)]
    return ("Thermal_Bridge", "Wall", "TB_CONSTRUCTION", "NoSun", "NoWind", verts)


def window_surfaces(L, W, win_w, win_h):
    """One centred window per facade, sill WINDOW_SILL_M, head = sill + win_h.

    Each window follows its host wall's traversal direction so it lies flush.
    """
    sill = WINDOW_SILL_M
    head = sill + win_h
    x0, x1 = L / 2 - win_w / 2, L / 2 + win_w / 2   # N/S facades (width = L)
    y0, y1 = W / 2 - win_w / 2, W / 2 + win_w / 2   # E/W facades (width = W)
    return [
        ("Window_South", "Wall_South",
         [(x0, 0, head), (x0, 0, sill), (x1, 0, sill), (x1, 0, head)]),
        ("Window_North", "Wall_North",
         [(x1, W, head), (x1, W, sill), (x0, W, sill), (x0, W, head)]),
        ("Window_East", "Wall_East",
         [(L, y0, head), (L, y0, sill), (L, y1, sill), (L, y1, head)]),
        ("Window_West", "Wall_West",
         [(0, y1, head), (0, y1, sill), (0, y0, sill), (0, y0, head)]),
    ]


# ============================================================================
# Numeric formatting — deterministic, no trailing-zero drift
# ============================================================================
def fnum(x):
    """Format a number like the hand-authored IDF: ints stay int, floats keep
    a stable minimal decimal form. Pure function -> byte-stable output."""
    if isinstance(x, bool):
        return str(int(x))
    if isinstance(x, int):
        return str(x)
    f = float(x)
    if f == int(f):
        return str(int(f))
    # Trim to at most 6 dp, strip trailing zeros, keep determinism.
    s = f"{f:.6f}".rstrip("0").rstrip(".")
    return s


def flat_verts(verts):
    """[(x,y,z),...] -> ['x','y','z', ...] formatted strings."""
    out = []
    for (x, y, z) in verts:
        out.extend([fnum(x), fnum(y), fnum(z)])
    return out


# ============================================================================
# IDF construction
# ============================================================================
def build_idf(fix, idd_path):
    """Build the eppy IDF object from the parsed fixture dict. Pure w.r.t. fix."""
    from eppy.modeleditor import IDF

    IDF.setiddname(idd_path)          # idempotent; once per process
    idf = IDF(StringIO(""))           # empty IDF

    geom = fix["geometry"]
    L = float(geom["length_m"])
    W = float(geom["width_m"])
    H = float(geom["floor_height_m"])
    gia = float(geom["gia_m2"])
    vol = float(geom["volume_m3"])
    win_w = float(geom["window"]["width_m"])
    win_h = float(geom["window"]["height_m"])

    env = fix["envelope"]
    cons = env["constructions"]
    ig = fix["internal_gains"]
    occ = ig["occupancy"]
    comfort = fix["comfort_band"]
    vent = fix["ventilation"][0]

    # ---- simulation control / building -------------------------------------
    idf.newidfobject("VERSION", Version_Identifier="26.1")

    idf.newidfobject(
        "SIMULATIONCONTROL",
        Do_Zone_Sizing_Calculation="No",
        Do_System_Sizing_Calculation="No",
        Do_Plant_Sizing_Calculation="No",
        Run_Simulation_for_Sizing_Periods="No",
        Run_Simulation_for_Weather_File_Run_Periods="Yes",
        Do_HVAC_Sizing_Simulation_for_Sizing_Periods="No",
        Maximum_Number_of_HVAC_Sizing_Simulation_Passes=1,
    )

    idf.newidfobject(
        "BUILDING",
        Name="Bridgewater-Box",
        North_Axis=0,
        Terrain="Suburbs",
        Loads_Convergence_Tolerance_Value=0.04,
        Temperature_Convergence_Tolerance_Value=0.4,
        Solar_Distribution="FullExterior",
        Maximum_Number_of_Warmup_Days=25,
        Minimum_Number_of_Warmup_Days=6,
    )

    idf.newidfobject("TIMESTEP", Number_of_Timesteps_per_Hour=6)
    idf.newidfobject("HEATBALANCEALGORITHM", Algorithm="ConductionTransferFunction")
    idf.newidfobject("SURFACECONVECTIONALGORITHM:INSIDE", Algorithm="TARP")
    idf.newidfobject("SURFACECONVECTIONALGORITHM:OUTSIDE", Algorithm="DOE-2")

    idf.newidfobject(
        "RUNPERIOD",
        Name="Full Year",
        Begin_Month=1, Begin_Day_of_Month=1,
        End_Month=12, End_Day_of_Month=31,
        Use_Weather_File_Holidays_and_Special_Days="Yes",
        Use_Weather_File_Daylight_Saving_Period="Yes",
        Apply_Weekend_Holiday_Rule="No",
        Use_Weather_File_Rain_Indicators="Yes",
        Use_Weather_File_Snow_Indicators="Yes",
    )

    idf.newidfobject("OUTPUT:DIAGNOSTICS", Key_1="DisplayExtraWarnings")

    # ---- schedule type limits ----------------------------------------------
    idf.newidfobject("SCHEDULETYPELIMITS", Name="Fraction",
                     Lower_Limit_Value=0.0, Upper_Limit_Value=1.0,
                     Numeric_Type="Continuous", Unit_Type="Dimensionless")
    idf.newidfobject("SCHEDULETYPELIMITS", Name="Temperature",
                     Lower_Limit_Value=-60, Upper_Limit_Value=200,
                     Numeric_Type="Continuous", Unit_Type="Temperature")
    idf.newidfobject("SCHEDULETYPELIMITS", Name="ControlType",
                     Lower_Limit_Value=0, Upper_Limit_Value=4,
                     Numeric_Type="Discrete", Unit_Type="Dimensionless")
    idf.newidfobject("SCHEDULETYPELIMITS", Name="ActivityLevel",
                     Lower_Limit_Value=0, Upper_Limit_Value=1000,
                     Numeric_Type="Continuous", Unit_Type="ActivityLevel")

    # ---- schedules ----------------------------------------------------------
    occ_start, occ_end = parse_window(occ["schedule_occupied_hours"])
    lights_start, lights_end = parse_window(ig["lighting"]["schedule_on_hours"])
    equip_start, equip_end = parse_window(ig["equipment"]["schedule_active_hours"])
    occ_rate = float(occ["occupancy_rate"])
    sens_w = float(occ["sensible_W_per_person"])
    lat_w = float(occ["latent_W_per_person"])
    shf, activity_w = shf_from_split(sens_w, lat_w)

    def add_compact(name, limits, fields):
        obj = idf.newidfobject("SCHEDULE:COMPACT")
        obj.obj = ["Schedule:Compact", name, limits] + [str(f) for f in fields]

    add_compact("ALWAYS_ON", "Fraction",
                ["Through: 12/31", "For: AllDays", "Until: 24:00", "1.0"])
    add_compact("OCC_PRESENCE", "Fraction",
                ["Through: 12/31", "For: AllDays",
                 f"Until: {occ_start}", "0.0",
                 f"Until: {occ_end}", fnum(occ_rate),
                 "Until: 24:00", "0.0"])
    add_compact("ACTIVITY_LEVEL", "ActivityLevel",
                ["Through: 12/31", "For: AllDays", "Until: 24:00", fnum(activity_w)])
    add_compact("LIGHTS_SCHED", "Fraction",
                ["Through: 12/31", "For: AllDays",
                 f"Until: {lights_start}", "0.0",
                 f"Until: {lights_end}", "1.0",
                 "Until: 24:00", "0.0"])
    add_compact("EQUIP_ACTIVE_SCHED", "Fraction",
                ["Through: 12/31", "For: AllDays",
                 f"Until: {equip_start}", "0.0",
                 f"Until: {equip_end}", "1.0",
                 "Until: 24:00", "0.0"])
    add_compact("HEATING_SETPOINT", "Temperature",
                ["Through: 12/31", "For: AllDays", "Until: 24:00",
                 fnum(comfort["lower_c"])])
    add_compact("COOLING_SETPOINT", "Temperature",
                ["Through: 12/31", "For: AllDays", "Until: 24:00",
                 fnum(comfort["upper_c"])])
    add_compact("DUAL_CONTROL_TYPE", "ControlType",
                ["Through: 12/31", "For: AllDays", "Until: 24:00", "4"])

    # ---- materials ----------------------------------------------------------
    roughness = {
        "PIR_wall": "MediumSmooth", "Concrete_wall": "MediumRough",
        "PIR_roof": "MediumSmooth", "Concrete_roof": "MediumRough",
        "PIR_floor": "MediumSmooth", "Concrete_floor": "MediumRough",
    }
    # Emit opaque materials in construction/layer order (deterministic).
    seen = set()
    for ckey in ("external_wall", "roof", "ground_floor"):
        for layer in cons[ckey]["layers"]:
            nm = layer["name"]
            if nm in seen:
                continue
            seen.add(nm)
            idf.newidfobject(
                "MATERIAL",
                Name=nm,
                Roughness=roughness[nm],
                Thickness=float(layer["thickness"]),
                Conductivity=float(layer["conductivity"]),
                Density=float(layer["density"]),
                Specific_Heat=float(layer["specific_heat"]),
            )

    # Thermal-bridge NoMass conductance material (D5e).
    idf.newidfobject(
        "MATERIAL:NOMASS",
        Name="TB_MAT",
        Roughness="Smooth",
        Thermal_Resistance=TB_MATERIAL_R,
        Thermal_Absorptance=0.9,
        Solar_Absorptance=0.7,
        Visible_Absorptance=0.7,
    )

    # Simple glazing.
    gl = cons["glazing"]
    idf.newidfobject(
        "WINDOWMATERIAL:SIMPLEGLAZINGSYSTEM",
        Name="GLAZING_MAT",
        UFactor=float(gl["u_value_W_per_m2K"]),
        Solar_Heat_Gain_Coefficient=float(gl["g_value"]),
        Visible_Transmittance=float(gl["light_transmission"]),
    )

    # ---- constructions (outside layer first) -------------------------------
    def add_construction(name, layers):
        obj = idf.newidfobject("CONSTRUCTION", Name=name)
        obj.Outside_Layer = layers[0]
        for i, lname in enumerate(layers[1:], start=2):
            setattr(obj, f"Layer_{i}", lname)

    add_construction("EXT_WALL", [l["name"] for l in cons["external_wall"]["layers"]])
    add_construction("ROOF", [l["name"] for l in cons["roof"]["layers"]])
    add_construction("GROUND_FLOOR", [l["name"] for l in cons["ground_floor"]["layers"]])
    add_construction("GLAZING", ["GLAZING_MAT"])
    add_construction("TB_CONSTRUCTION", ["TB_MAT"])

    # ---- geometry rules + zone ---------------------------------------------
    idf.newidfobject(
        "GLOBALGEOMETRYRULES",
        Starting_Vertex_Position="UpperLeftCorner",
        Vertex_Entry_Direction="Counterclockwise",
        Coordinate_System="World",
    )
    idf.newidfobject(
        "ZONE",
        Name="Box_Zone",
        Direction_of_Relative_North=0,
        X_Origin=0, Y_Origin=0, Z_Origin=0,
        Type=1, Multiplier=1,
        Ceiling_Height=H, Volume=vol, Floor_Area=gia,
    )

    # ---- surfaces -----------------------------------------------------------
    def add_surface(name, stype, constr, sun, wind, verts):
        obj = idf.newidfobject("BUILDINGSURFACE:DETAILED")
        obj.obj = [
            "BuildingSurface:Detailed", name, stype, constr, "Box_Zone", "",
            "Outdoors", "", sun, wind, "autocalculate", str(len(verts)),
        ] + flat_verts(verts)

    for surf in box_surfaces(L, W, H):
        add_surface(*surf)
    add_surface(*thermal_bridge_surface())

    # ---- windows ------------------------------------------------------------
    def add_window(name, host_wall, verts):
        obj = idf.newidfobject("FENESTRATIONSURFACE:DETAILED")
        obj.obj = [
            "FenestrationSurface:Detailed", name, "Window", "GLAZING",
            host_wall, "", "autocalculate", "", "1", str(len(verts)),
        ] + flat_verts(verts)

    for win in window_surfaces(L, W, win_w, win_h):
        add_window(*win)

    # ---- internal gains -----------------------------------------------------
    idf.newidfobject(
        "PEOPLE",
        Name="Box_People",
        Zone_or_ZoneList_or_Space_or_SpaceList_Name="Box_Zone",
        Number_of_People_Schedule_Name="OCC_PRESENCE",
        Number_of_People_Calculation_Method="People",
        Number_of_People=int(occ["people"]),
        Fraction_Radiant=0.3,
        Sensible_Heat_Fraction=shf,
        Activity_Level_Schedule_Name="ACTIVITY_LEVEL",
    )

    lights_w = float(ig["lighting"]["w_per_m2"]) * gia
    idf.newidfobject(
        "LIGHTS",
        Name="Box_Lights",
        Zone_or_ZoneList_or_Space_or_SpaceList_Name="Box_Zone",
        Schedule_Name="LIGHTS_SCHED",
        Design_Level_Calculation_Method="LightingLevel",
        Lighting_Level=lights_w,
        Return_Air_Fraction=0,
        Fraction_Radiant=0.7,
        Fraction_Visible=0.2,
        Fraction_Replaceable=1.0,
    )

    base_w = float(ig["equipment"]["baseload_w_per_m2"]) * gia
    active_w = float(ig["equipment"]["active_w_per_m2"]) * gia
    idf.newidfobject(
        "ELECTRICEQUIPMENT",
        Name="Box_Equip_Base",
        Zone_or_ZoneList_or_Space_or_SpaceList_Name="Box_Zone",
        Schedule_Name="ALWAYS_ON",
        Design_Level_Calculation_Method="EquipmentLevel",
        Design_Level=base_w,
        Fraction_Latent=0, Fraction_Radiant=0, Fraction_Lost=0,
    )
    idf.newidfobject(
        "ELECTRICEQUIPMENT",
        Name="Box_Equip_Active",
        Zone_or_ZoneList_or_Space_or_SpaceList_Name="Box_Zone",
        Schedule_Name="EQUIP_ACTIVE_SCHED",
        Design_Level_Calculation_Method="EquipmentLevel",
        Design_Level=active_w,
        Fraction_Latent=0, Fraction_Radiant=0, Fraction_Lost=0,
    )

    # ---- infiltration -------------------------------------------------------
    idf.newidfobject(
        "ZONEINFILTRATION:DESIGNFLOWRATE",
        Name="Box_Infiltration",
        Zone_or_ZoneList_or_Space_or_SpaceList_Name="Box_Zone",
        Schedule_Name="ALWAYS_ON",
        Design_Flow_Rate_Calculation_Method="AirChanges/Hour",
        Air_Changes_per_Hour=float(env["infiltration"]["ach_constant"]),
        Constant_Term_Coefficient=1.0,
        Temperature_Term_Coefficient=0.0,
        Velocity_Term_Coefficient=0.0,
        Velocity_Squared_Term_Coefficient=0.0,
    )

    # ---- HVAC: ideal loads + MVHR as OA + sensible HR (D5b/D5c) ------------
    oa_flow = float(vent["flow_l_s"]) / 1000.0   # L/s -> m3/s
    hre = float(vent["hre_sensible_pct"]) / 100.0
    idf.newidfobject(
        "DESIGNSPECIFICATION:OUTDOORAIR",
        Name="Box_MVHR_OA",
        Outdoor_Air_Method="Flow/Zone",
        # Zero the per-person / per-area fields explicitly: under Flow/Zone only
        # the per-zone flow is used, but eppy would otherwise fill the IDD per-
        # person default (0.00944), which misleadingly implies per-person OA.
        Outdoor_Air_Flow_per_Person=0,
        Outdoor_Air_Flow_per_Zone_Floor_Area=0,
        Outdoor_Air_Flow_per_Zone=oa_flow,
    )
    idf.newidfobject("OUTDOORAIR:NODE", Name="Box_OA_Inlet_Node")

    idf.newidfobject(
        "ZONECONTROL:THERMOSTAT",
        Name="Box_Thermostat",
        Zone_or_ZoneList_Name="Box_Zone",
        Control_Type_Schedule_Name="DUAL_CONTROL_TYPE",
        Control_1_Object_Type="ThermostatSetpoint:DualSetpoint",
        Control_1_Name="Box_DualSetpoint",
    )
    idf.newidfobject(
        "THERMOSTATSETPOINT:DUALSETPOINT",
        Name="Box_DualSetpoint",
        Heating_Setpoint_Temperature_Schedule_Name="HEATING_SETPOINT",
        Cooling_Setpoint_Temperature_Schedule_Name="COOLING_SETPOINT",
    )
    idf.newidfobject(
        "ZONEHVAC:EQUIPMENTCONNECTIONS",
        Zone_Name="Box_Zone",
        Zone_Conditioning_Equipment_List_Name="Box_EquipList",
        Zone_Air_Inlet_Node_or_NodeList_Name="Box_Supply_Inlet",
        Zone_Air_Node_Name="Box_Zone_Air_Node",
        Zone_Return_Air_Node_or_NodeList_Name="Box_Return_Node",
    )
    idf.newidfobject(
        "ZONEHVAC:EQUIPMENTLIST",
        Name="Box_EquipList",
        Load_Distribution_Scheme="SequentialLoad",
        Zone_Equipment_1_Object_Type="ZoneHVAC:IdealLoadsAirSystem",
        Zone_Equipment_1_Name="Box_IdealLoads",
        Zone_Equipment_1_Cooling_Sequence=1,
        Zone_Equipment_1_Heating_or_NoLoad_Sequence=1,
    )
    idf.newidfobject(
        "ZONEHVAC:IDEALLOADSAIRSYSTEM",
        Name="Box_IdealLoads",
        Zone_Supply_Air_Node_Name="Box_Supply_Inlet",
        Maximum_Heating_Supply_Air_Temperature=IDEALLOADS_MAX_HEAT_SUPPLY_T,
        Minimum_Cooling_Supply_Air_Temperature=IDEALLOADS_MIN_COOL_SUPPLY_T,
        Maximum_Heating_Supply_Air_Humidity_Ratio=IDEALLOADS_MAX_HEAT_HUMRAT,
        Minimum_Cooling_Supply_Air_Humidity_Ratio=IDEALLOADS_MIN_COOL_HUMRAT,
        Heating_Limit="NoLimit",
        Cooling_Limit="NoLimit",
        Dehumidification_Control_Type="None",
        Humidification_Control_Type="None",
        Design_Specification_Outdoor_Air_Object_Name="Box_MVHR_OA",
        Outdoor_Air_Inlet_Node_Name="Box_OA_Inlet_Node",
        Demand_Controlled_Ventilation_Type="None",
        Outdoor_Air_Economizer_Type="NoEconomizer",
        Heat_Recovery_Type="Sensible",
        Sensible_Heat_Recovery_Effectiveness=hre,
        Latent_Heat_Recovery_Effectiveness=0.0,
    )

    # ---- output -------------------------------------------------------------
    idf.newidfobject("OUTPUT:VARIABLEDICTIONARY", Key_Field="IDF")
    idf.newidfobject("OUTPUT:SQLITE", Option_Type="SimpleAndTabular")
    idf.newidfobject("OUTPUTCONTROL:TABLE:STYLE", Column_Separator="CommaAndHTML")
    idf.newidfobject("OUTPUT:TABLE:SUMMARYREPORTS", Report_1_Name="AllSummary")

    runperiod_vars = [
        "Zone Ideal Loads Supply Air Sensible Heating Energy",
        "Zone Ideal Loads Supply Air Sensible Cooling Energy",
        "Zone Ideal Loads Supply Air Total Heating Energy",
        "Zone Ideal Loads Supply Air Total Cooling Energy",
        "Zone Ideal Loads Zone Sensible Heating Energy",
        "Zone Ideal Loads Zone Sensible Cooling Energy",
        "Zone Ideal Loads Outdoor Air Sensible Heating Energy",
        "Zone Ideal Loads Outdoor Air Sensible Cooling Energy",
        "Zone Ideal Loads Outdoor Air Total Heating Energy",
        "Zone Ideal Loads Heat Recovery Sensible Heating Energy",
        "Zone Ideal Loads Heat Recovery Sensible Cooling Energy",
        "Surface Average Face Conduction Heat Transfer Energy",
        "Surface Window Heat Loss Energy",
        "Surface Window Heat Gain Energy",
        "Surface Window Transmitted Solar Radiation Energy",
        "Enclosure Windows Total Transmitted Solar Radiation Energy",
        "Zone Infiltration Sensible Heat Loss Energy",
        "Zone Infiltration Sensible Heat Gain Energy",
        "Zone Infiltration Total Heat Loss Energy",
        "Zone People Sensible Heating Energy",
        "Zone People Total Heating Energy",
        "Zone Lights Total Heating Energy",
        "Zone Electric Equipment Total Heating Energy",
        "Zone Mean Air Temperature",
    ]
    for v in runperiod_vars:
        idf.newidfobject("OUTPUT:VARIABLE", Key_Value="*",
                         Variable_Name=v, Reporting_Frequency="RunPeriod")

    hourly_vars = [
        "Site Outdoor Air Drybulb Temperature",
        "Zone Mean Air Temperature",
        "Zone Ideal Loads Supply Air Sensible Heating Energy",
        "Zone Ideal Loads Supply Air Sensible Cooling Energy",
        # Brief 83 P4 (2026-06-07): per-hour MVHR recovery-booking diagnostic.
        # OA coil load + heat-recovery contribution, hourly, so the NZA-vs-EP
        # mech-vent comparison can be decomposed by hour (free-float vs heating).
        # Output-only addition; no model physics change.
        "Zone Ideal Loads Outdoor Air Sensible Heating Energy",
        "Zone Ideal Loads Outdoor Air Sensible Cooling Energy",
        "Zone Ideal Loads Heat Recovery Sensible Heating Energy",
        "Zone Ideal Loads Heat Recovery Sensible Cooling Energy",
    ]
    for v in hourly_vars:
        idf.newidfobject("OUTPUT:VARIABLE", Key_Value="*",
                         Variable_Name=v, Reporting_Frequency="Hourly")

    for m in ("InteriorLights:Electricity", "InteriorEquipment:Electricity"):
        idf.newidfobject("OUTPUT:METER", Key_Name=m, Reporting_Frequency="RunPeriod")

    return idf


HEADER = """\
!-============================================================================
!- Bridgewater-Box v1 — GENERATED EnergyPlus model (Brief 81 P6)
!-============================================================================
!- DO NOT EDIT BY HAND. Generated by validation/energyplus/generate_idf.py from
!- the single source of truth validation/fixtures/bridgewater_box_v1.yaml.
!- Semantically equivalent to the P5 hand-authored bridgewater_box_v1.idf;
!- byte-stable across re-runs (pure function of the YAML). See audit §6.
!-============================================================================
"""


def render(fix, idd_path):
    """Build and return the IDF as a deterministic string (with header)."""
    idf = build_idf(fix, idd_path)
    return HEADER + idf.idfstr()


def load_fixture():
    with open(FIXTURE_PATH, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Generate Bridgewater-Box IDF from YAML fixture.")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="output IDF path")
    ap.add_argument("--stdout", action="store_true", help="print IDF to stdout, do not write")
    ap.add_argument("--check-determinism", action="store_true",
                    help="build twice in-memory and assert byte-identical")
    args = ap.parse_args(argv)

    idd_path = resolve_idd()
    fix = load_fixture()

    if args.check_determinism:
        a = render(fix, idd_path)
        b = render(fix, idd_path)
        if a == b:
            print(f"DETERMINISM OK: two builds byte-identical ({len(a)} bytes).")
            return 0
        # First differing line for diagnosis.
        for i, (la, lb) in enumerate(zip(a.splitlines(), b.splitlines()), 1):
            if la != lb:
                print(f"DETERMINISM FAIL at line {i}:\n  A: {la!r}\n  B: {lb!r}")
                break
        return 1

    text = render(fix, idd_path)
    if args.stdout:
        sys.stdout.write(text)
        return 0

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    # Normalise to '\n' line endings for cross-platform byte-stability.
    out.write_text(text, encoding="utf-8", newline="\n")
    print(f"Wrote {out} ({len(text)} bytes).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
