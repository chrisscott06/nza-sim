#!/usr/bin/env python3
# ============================================================================
# Brief 95 P2 — Full-Bridgewater EP run + demand→consumption post-processor
# ============================================================================
#
# Runs the full-building IDF (generate_full_idf.py output) on EnergyPlus 25-2-0,
# reads the IdealLoads zone DEMAND, and converts demand → CONSUMPTION in
# post-processing with FIXED efficiencies from the fixture (no HVAC equipment is
# modelled in EP — Brief 95 P2 scope decision). Writes a normalised results JSON
# whose header states every efficiency assumption.
#
#   IdealLoads is the simulation layer (envelope + gains + ventilation + demand).
#   Delivered energy = demand ÷ efficiency, proportional-split across systems.
#   DHW is a DETERMINISTIC calc (not an EP object): litres × ΔT × cp, split by share.
#   Ventilation fan electricity = Σ SFP × flow × 8760 (no fan object under IdealLoads).
#
# Run: validation/.venv/bin/python validation/energyplus/run_full.py
#      validation/.venv/bin/python validation/energyplus/run_full.py --reuse <rundir>
# ============================================================================

import argparse
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import yaml

import os

SCRIPT_DIR = Path(__file__).resolve().parent
VALIDATION_DIR = SCRIPT_DIR.parent
REPO_ROOT = VALIDATION_DIR.parent


def resolve_ep_exe():
    """ENERGYPLUS_DIR env, else ep_config.json install_dir → the `energyplus` binary."""
    base = os.environ.get("ENERGYPLUS_DIR")
    if not base:
        base = json.loads((SCRIPT_DIR / "ep_config.json").read_text()).get("install_dir")
    exe = Path(base) / "energyplus"
    if not exe.exists():
        sys.exit(f"[run_full] EnergyPlus binary not found: {exe}")
    return exe


FIXTURE = VALIDATION_DIR / "fixtures" / "bridgewater_anchor_v2.yaml"
IDF = SCRIPT_DIR / "generated" / "bridgewater_full_v1.idf"
RESULTS = SCRIPT_DIR / "results" / "bridgewater_full_v1.json"
RUN_DIR = SCRIPT_DIR / "runs" / "bridgewater_full_ep"
CP_KJ = 4.186   # kJ/(L·K)
HOURS = 8760.0

J_TO_MWH = 3.6e9


def run_ep(epw):
    exe = resolve_ep_exe()
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    subprocess.run([str(exe), "-w", str(epw), "-d", str(RUN_DIR), "-r", str(IDF)],
                   check=True, capture_output=True)


def read_demand():
    db = sqlite3.connect(RUN_DIR / "eplusout.sql")
    out = {"heating": 0.0, "cooling": 0.0, "facility_elec": 0.0}
    q = """SELECT rdd.Name, SUM(rd.Value) FROM ReportData rd
           JOIN ReportDataDictionary rdd ON rd.ReportDataDictionaryIndex=rdd.ReportDataDictionaryIndex
           GROUP BY rdd.Name"""
    for name, val in db.execute(q):
        if "Ideal Loads Zone Sensible Heating Energy" in name:
            out["heating"] = val / J_TO_MWH
        elif "Ideal Loads Zone Sensible Cooling Energy" in name:
            out["cooling"] = val / J_TO_MWH
        elif name == "Electricity:Facility":
            out["facility_elec"] = val / J_TO_MWH
    db.close()
    return out


def split_delivered(demand_mwh, systems):
    """Proportional split: fuel = Σ demand × share_i / η_i, keyed by fuel."""
    by_fuel = {}
    breakdown = []
    for s in systems:
        if not s.get("enabled", True):
            continue
        share = float(s.get("share_pct") or 0) / 100.0
        if share <= 0:
            continue
        eff = float(s["efficiency_metric"])
        fuel = "gas" if s["source"] == "gas" else "electricity"
        fuel_mwh = demand_mwh * share / eff
        by_fuel[fuel] = by_fuel.get(fuel, 0.0) + fuel_mwh
        breakdown.append({"label": s["label"], "source": s["source"], "share_pct": share * 100,
                          "efficiency": eff, "fuel": fuel, "fuel_mwh": round(fuel_mwh, 3)})
    return by_fuel, breakdown


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reuse", help="skip EP run; parse an existing run dir")
    ap.add_argument("--stdout", action="store_true")
    args = ap.parse_args()

    fix = yaml.safe_load(FIXTURE.read_text())
    bc = fix["building_config"]
    v40 = bc["systems_config_v40"]
    gia = float(bc["length"]) * float(bc["width"]) * int(bc["num_floors"])
    weather = fix.get("weather_file") or bc.get("weather_file")
    epw = REPO_ROOT / "data" / "weather" / "current" / weather

    if args.reuse:
        global RUN_DIR
        RUN_DIR = Path(args.reuse)
    else:
        run_ep(epw)
    dem = read_demand()

    # ---- space heating / cooling: demand ÷ efficiency (proportional split) ----
    heat_fuel, heat_bd = split_delivered(dem["heating"], v40["heating"])
    cool_fuel, cool_bd = split_delivered(dem["cooling"], v40["cooling"])

    # ---- DHW: deterministic (not EP) ----
    people = int(bc["num_bedrooms"]) * int(bc["people_per_room"])
    lpppd = float(v40["dhw_demand_litres_per_person_per_day"])
    tap = float(v40["dhw_tap_outlet_temp_c"]); cold = float(v40["dhw_cold_supply_temp_c"])
    dhw_litres_yr = lpppd * people * 365.0
    dhw_demand_mwh = dhw_litres_yr * CP_KJ * (tap - cold) / 3.6e6   # kJ→MWh
    dhw_fuel, dhw_bd = split_delivered(dhw_demand_mwh, v40["dhw"])

    # ---- ventilation fan electricity: Σ SFP × flow × hours (no fan object) ----
    vent_fan_mwh = 0.0
    vent_bd = []
    for vsys in v40["ventilation"]:
        if not vsys.get("enabled", True):
            continue
        sfp = float(vsys["efficiency_metric"]["sfp_w_per_lps"])
        flow = float(vsys["flow_rate"])   # L/s
        mwh = sfp * flow * HOURS / 1e9    # W×h → MWh
        vent_fan_mwh += mwh
        vent_bd.append({"label": vsys["label"], "sfp_w_per_lps": sfp, "flow_l_s": flow,
                        "fuel_mwh": round(mwh, 3)})

    # ---- roll up ----
    elec = (dem["facility_elec"] + heat_fuel.get("electricity", 0) + cool_fuel.get("electricity", 0)
            + dhw_fuel.get("electricity", 0) + vent_fan_mwh)
    gas = heat_fuel.get("gas", 0) + cool_fuel.get("gas", 0) + dhw_fuel.get("gas", 0)
    eui = (elec + gas) * 1000.0 / gia

    result = {
        "_header": {
            "brief": "Brief 95 P2 — full-Bridgewater EP (IdealLoads demand + fixed-efficiency post-processing)",
            "energyplus_version": "25.2.0-cf7368216c",
            "simulation_layer": "ZoneHVAC:IdealLoadsAirSystem (envelope + gains + ventilation → zone demand)",
            "efficiency_assumptions": {
                "space_heating": [f"{b['label']}: {b['share_pct']:.0f}% ÷ {'SCOP' if b['source']=='ambient_air' else 'η/COP'} {b['efficiency']}" for b in heat_bd],
                "space_cooling": [f"{b['label']}: {b['share_pct']:.0f}% ÷ EER {b['efficiency']}" for b in cool_bd],
                "dhw": {
                    "method": "deterministic (not EP)",
                    "formula": f"{lpppd} L·person⁻¹·day⁻¹ × {people} people × 365 d × cp {CP_KJ} kJ/(L·K) × ΔT({tap}−{cold})°C",
                    "demand_mwh": round(dhw_demand_mwh, 3),
                    "split": [f"{b['label']}: {b['share_pct']:.0f}% ÷ {'η' if b['source']=='gas' else 'SCOP'} {b['efficiency']}" for b in dhw_bd],
                },
                "ventilation_fans": [f"{b['label']}: SFP {b['sfp_w_per_lps']} × {b['flow_l_s']} L/s × 8760 h" for b in vent_bd],
                "notes": "No HVAC equipment modelled in EP (no PTHP/VRF/coils/curves/plant loop). Full-equipment EP model is parked (possible later upgrade).",
            },
        },
        "gia_m2": round(gia, 1),
        "demand_mwh": {"space_heating": round(dem["heating"], 3), "space_cooling": round(dem["cooling"], 3),
                       "dhw": round(dhw_demand_mwh, 3)},
        "consumption_mwh": {
            "electricity": round(elec, 3), "gas": round(gas, 3),
            "space_heating": {k: round(v, 3) for k, v in heat_fuel.items()},
            "space_cooling": {k: round(v, 3) for k, v in cool_fuel.items()},
            "dhw": {k: round(v, 3) for k, v in dhw_fuel.items()},
            "ventilation_fans_electricity": round(vent_fan_mwh, 3),
            "lighting_equipment_aux_electricity": round(dem["facility_elec"], 3),
        },
        "eui_kwh_per_m2_yr": round(eui, 1),
        "breakdown": {"space_heating": heat_bd, "space_cooling": cool_bd, "dhw": dhw_bd, "ventilation": vent_bd},
    }

    text = json.dumps(result, indent=2, ensure_ascii=False)
    if args.stdout:
        print(text)
    else:
        RESULTS.parent.mkdir(parents=True, exist_ok=True)
        RESULTS.write_text(text)
        print(f"[run_full] EP demand: heating {dem['heating']:.1f} / cooling {dem['cooling']:.1f} MWh")
        print(f"[run_full] consumption: elec {elec:.1f} / gas {gas:.1f} MWh · EUI {eui:.1f} kWh/m²")
        print(f"[run_full] wrote {RESULTS.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
