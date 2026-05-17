"""
Brief 29 Issue #13 diagnostic — minimal envelope-only EP run with all HVAC,
thermostat, sizing, and mechanical ventilation stripped. Compare T_zone trace
against the baseline run b8db113e to identify the source of the 21.0 °C
clamping behaviour.

Time-box: 90 minutes. One commit. No fixes.

Usage:
  python scripts/_issue13_diagnostic.py

Outputs:
  data/simulations/_diag_issue13_no_hvac/  — minimal EP run
  prints a comparison table to stdout
"""
import json, shutil, subprocess, sqlite3, statistics
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BASELINE_DIR = REPO / "data" / "simulations" / "b8db113e"
DIAG_DIR     = REPO / "data" / "simulations" / "_diag_issue13_no_hvac"
EP_BIN       = Path(r"C:\EnergyPlusV26-1-0\energyplus.exe")
EPW = REPO / "data" / "weather" / "current" / "GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw"

# Strip these object types entirely from the epJSON.
# Rationale: we want pure envelope free-running. Remove anything that:
#   - injects energy into the zone (HVAC)
#   - moves air in/out other than infiltration + permanent louvres
#   - might pin T_zone via control logic (thermostat + sizing)
STRIP_TYPES = [
    "ZoneHVAC:IdealLoadsAirSystem",
    "ZoneHVAC:TerminalUnit:VariableRefrigerantFlow",
    "ZoneHVAC:EquipmentConnections",
    "ZoneHVAC:EquipmentList",
    "ZoneTerminalUnitList",
    "ThermostatSetpoint:DualSetpoint",
    "ZoneControl:Thermostat",
    "Sizing:Zone",
    "SizingPeriod:DesignDay",
    "DesignSpecification:OutdoorAir",
    "ZoneVentilation:DesignFlowRate",  # mechanical OA — strip in this diag
    "OutdoorAir:Node",
    # Internal gains already zero-density per state1 but strip the objects too
    # so EP doesn't even compute them.
    "People",
    "Lights",
    "ElectricEquipment",
]

# Also disable sizing in SimulationControl
def patch_simulation_control(ep):
    sc = ep.get("SimulationControl", {})
    for k in sc:
        sc[k]["do_zone_sizing_calculation"]   = "No"
        sc[k]["do_system_sizing_calculation"] = "No"
        sc[k]["do_plant_sizing_calculation"]  = "No"
        sc[k]["run_simulation_for_sizing_periods"]      = "No"
        sc[k]["run_simulation_for_weather_file_run_periods"] = "Yes"

def patch_building(ep):
    # Keep solar_distribution as-is; don't change physics, only strip
    # extraneous objects.
    pass


def main():
    print("=== Brief 29 Issue #13 diagnostic ===")
    print(f"baseline: {BASELINE_DIR}")
    print(f"diag dir: {DIAG_DIR}")
    print()

    # 1. Copy baseline epJSON and strip HVAC + thermostat + sizing + vent
    DIAG_DIR.mkdir(parents=True, exist_ok=True)
    with open(BASELINE_DIR / "input.epJSON") as f:
        ep = json.load(f)

    print("Baseline object counts:")
    for t in STRIP_TYPES:
        print(f"  {t}: {len(ep.get(t, {}))}")

    for t in STRIP_TYPES:
        if t in ep:
            del ep[t]

    patch_simulation_control(ep)
    patch_building(ep)

    minimal_path = DIAG_DIR / "input.epJSON"
    with open(minimal_path, "w") as f:
        json.dump(ep, f, indent=2)
    print(f"\nWrote minimal epJSON: {minimal_path}")
    print(f"Remaining object types: {len(ep)}")

    # 2. Run EnergyPlus
    print("\nRunning EnergyPlus (minimal envelope-only, no HVAC)...")
    cmd = [str(EP_BIN), "-w", str(EPW), "-d", str(DIAG_DIR), "-r", "-x", str(minimal_path)]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if res.returncode != 0:
        print("EP run failed.")
        print("STDOUT:", res.stdout[-3000:])
        print("STDERR:", res.stderr[-3000:])
        return
    print(f"EP run finished, return code {res.returncode}")

    # 3. Read T_zone trace from diag SQL
    diag_sql = DIAG_DIR / "eplusout.sql"
    if not diag_sql.exists():
        print(f"FAIL: {diag_sql} not produced")
        return

    def read_tair(sql_path):
        conn = sqlite3.connect(str(sql_path))
        cur = conn.cursor()
        cur.execute("""
            SELECT ReportData.Value FROM ReportData
            JOIN ReportDataDictionary ON ReportData.ReportDataDictionaryIndex = ReportDataDictionary.ReportDataDictionaryIndex
            WHERE ReportDataDictionary.Name = 'Zone Mean Air Temperature'
            ORDER BY ReportData.TimeIndex
        """)
        rows = [r[0] for r in cur.fetchall()]
        conn.close()
        return rows

    baseline = read_tair(BASELINE_DIR / "eplusout.sql")
    diag     = read_tair(diag_sql)

    print("\n=== T_zone trace comparison ===")
    def stats(label, rows):
        if not rows:
            print(f"{label:14s}  NO ROWS")
            return
        clamp_21 = sum(1 for r in rows if abs(r - 21.0) < 0.05)
        clamp_18 = sum(1 for r in rows if abs(r - 18.0) < 0.05)
        print(f"{label:14s}  n={len(rows):>6}  mean={statistics.mean(rows):6.2f} C  "
              f"min={min(rows):5.2f}  max={max(rows):5.2f}  "
              f"stdev={statistics.stdev(rows):4.2f}  "
              f"~21.0={100*clamp_21/len(rows):4.1f}%  "
              f"~18.0={100*clamp_18/len(rows):4.1f}%")
    stats("baseline", baseline)
    stats("diag",     diag)

    # Hour-by-hour correlation (only if same length)
    if len(baseline) == len(diag) and len(baseline) > 0:
        # Pearson r
        mb = statistics.mean(baseline); md = statistics.mean(diag)
        num = sum((baseline[i]-mb)*(diag[i]-md) for i in range(len(baseline)))
        denb = (sum((b-mb)**2 for b in baseline))**0.5
        dend = (sum((d-md)**2 for d in diag))**0.5
        r = num / (denb * dend) if (denb*dend) > 0 else 0
        print(f"\nhour-by-hour Pearson r (baseline vs diag): {r:.3f}")
        mean_abs_diff = sum(abs(baseline[i]-diag[i]) for i in range(len(baseline))) / len(baseline)
        print(f"mean |baseline - diag|: {mean_abs_diff:.2f} K")
    else:
        print(f"\nlength mismatch: baseline={len(baseline)}, diag={len(diag)} — can't do hour-by-hour")

if __name__ == "__main__":
    main()
