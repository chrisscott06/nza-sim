"""
Brief 29 Issue #13 narrowing test — strip ONLY the VRF terminal units
(keep ZoneVentilation:DesignFlowRate, thermostat, Sizing:Zone). If T_zone
returns to free-running, VRF is the clamping source. If it stays clamped,
something else (vent or thermostat) is the culprit.
"""
import json, subprocess, sqlite3, statistics
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BASELINE = REPO / "data" / "simulations" / "b8db113e"
DIAG2    = REPO / "data" / "simulations" / "_diag_issue13_no_vrf"
EP_BIN   = Path(r"C:\EnergyPlusV26-1-0\energyplus.exe")
EPW = REPO / "data" / "weather" / "current" / "GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw"

# Strip ONLY VRF + its dependents (equipment list/connections/terminal list
# need to go because they refer to the terminal units that no longer exist).
# Keep: thermostat, sizing, DSOA, DesignFlowRate vent.
STRIP_TYPES = [
    "ZoneHVAC:TerminalUnit:VariableRefrigerantFlow",
    "ZoneHVAC:EquipmentConnections",
    "ZoneHVAC:EquipmentList",
    "ZoneTerminalUnitList",
]

def main():
    DIAG2.mkdir(parents=True, exist_ok=True)
    with open(BASELINE / "input.epJSON") as f:
        ep = json.load(f)
    for t in STRIP_TYPES:
        if t in ep: del ep[t]
    minimal = DIAG2 / "input.epJSON"
    with open(minimal, "w") as f: json.dump(ep, f, indent=2)
    print("=== Issue #13 narrowing: VRF removed, vent + thermostat kept ===")
    res = subprocess.run([str(EP_BIN), "-w", str(EPW), "-d", str(DIAG2), "-r", "-x", str(minimal)],
                         capture_output=True, text=True, timeout=300)
    if res.returncode != 0:
        print("FAIL:", res.stdout[-2000:]); return
    sql = DIAG2 / "eplusout.sql"
    conn = sqlite3.connect(str(sql)); cur = conn.cursor()
    cur.execute("""SELECT ReportData.Value FROM ReportData
        JOIN ReportDataDictionary ON ReportData.ReportDataDictionaryIndex = ReportDataDictionary.ReportDataDictionaryIndex
        WHERE ReportDataDictionary.Name = 'Zone Mean Air Temperature' ORDER BY ReportData.TimeIndex""")
    rows = [r[0] for r in cur.fetchall()]; conn.close()
    if rows:
        clamp = sum(1 for r in rows if abs(r-21.0) < 0.05)
        print(f"diag2 (no VRF, with vent+tstat): n={len(rows)} mean={statistics.mean(rows):.2f}C "
              f"stdev={statistics.stdev(rows):.2f}K ~21.0={100*clamp/len(rows):.1f}%")
        print(f"min={min(rows):.2f}, max={max(rows):.2f}")
    print()
    print("Compare to:")
    print("  baseline (with VRF+vent+tstat): mean 21.11 C, stdev 1.87 K, ~21.0=29.5%")
    print("  diag    (everything stripped) : mean 14.74 C, stdev 5.25 K, ~21.0= 0.6%")

if __name__ == "__main__":
    main()
