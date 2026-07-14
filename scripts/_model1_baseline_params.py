"""
scripts/_model1_baseline_params.py — Brief: bridgwater-baseline-model1, Part 1 (D1)

Apply the Model-1 (as-specified) parameter corrections to the Bridgewater Hotel
baseline scenario. Idempotent (sets absolute values). The auditable record of
the D1 table; the data itself lives in the gitignored DB.

Basis per the brief's D1 table (BRUKL + datasheets + commissioning records).
The removed ~6.7 W/m² auxiliary baseload (7 -> 0.3) is NOT deleted knowledge —
it becomes the explicit auxiliary residual in Model-2 (future brief).

Usage: python scripts/_model1_baseline_params.py
"""
import sqlite3, json
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "data/nza_sim.db"


def apply(project_name="Bridgewater Hotel"):
    c = sqlite3.connect(DB)
    cols = [d[0] for d in c.execute("SELECT * FROM projects LIMIT 1").description]
    row = c.execute("SELECT * FROM projects WHERE name=?", (project_name,)).fetchone()
    if not row:
        raise SystemExit(f"No project '{project_name}'")
    d = dict(zip(cols, row)); pid = d["id"]
    bc = json.loads(d["building_config"]); v40 = bc["systems_config_v40"]
    log = []
    def setv(label, obj, key, val):
        log.append(f"{label}: {obj.get(key)} -> {val}"); obj[key] = val

    # D1.1 Heating SCOP 2.8 -> 5.0  (BRUKL SSEFF 4.93 GF / 5.12 bedrooms, weighted)
    for s in v40["heating"]:
        if s.get("source") == "ambient_air":
            setv("heating VRF SCOP", s, "efficiency_metric", 5.0)
    # D1.2 Cooling SEER 3.0 -> 3.5  (BRUKL 3.29 GF / 3.51 bedrooms)
    for s in v40["cooling"]:
        if "vrf" in (s.get("label") or ""):
            setv("cooling VRF SEER", s, "efficiency_metric", 3.5)
    # D1.3/1.4 SFP  (BRUKL local mech vent / system D)
    for s in v40["ventilation"]:
        if s.get("id") == "vent_bedroom_extract":
            setv("bedroom_extract SFP", s["efficiency_metric"], "sfp_w_per_lps", 0.4)
        if s.get("id") == "vent_mvhr_gf_public":
            setv("mvhr_gf_public SFP", s["efficiency_metric"], "sfp_w_per_lps", 1.4)
    # D1.5/1.6 DHW plant  (Andrews flue-gas ~89% gross; Carrier ASHP catalogue)
    for s in v40["dhw"]:
        if s.get("source") == "gas":
            setv("DHW gas eta", s, "efficiency_metric", 0.89)
        if s.get("source") == "ambient_air":
            setv("DHW ASHP COP", s, "efficiency_metric", 3.4)
    # D1.7 Permanent openings EA 2.2 -> 1.43  (Renson IEMAH065 take-off; scaled
    #      proportionally across the two glazed facades: 1.1 x (1.43/2.2) = 0.715)
    op = bc["openings"]
    for f in ("north", "south"):
        if op.get(f, {}).get("louvre_area_m2"):
            setv(f"openings.{f} louvre", op[f], "louvre_area_m2", 0.715)
    # D1.8 Auxiliary baseload 7 -> 0.3 W/m² + rename (external lighting allowance)
    aux = bc["gains"]["auxiliary"]["profiles"][0]
    setv("aux baseload W/m2", aux["magnitude"], "value", 0.3)
    setv("aux label", aux, "label", "External lighting")
    # D1.9 occupancy_rate 1.0 -> 0.971  (134 of 138 rooms let). BOTH slots: the
    #      engine reads occupancy.occupancy_rate (instantCalc.js:2250); the export
    #      derived-rooms row reads the top-level occupancy_rate.
    setv("occupancy.occupancy_rate", bc["occupancy"], "occupancy_rate", 0.971)
    setv("occupancy_rate (top-level)", bc, "occupancy_rate", 0.971)

    c.execute("UPDATE projects SET building_config=? WHERE id=?", (json.dumps(bc), pid))
    c.commit()
    for l in log:
        print(" ", l)
    tot = round(sum(op.get(f, {}).get("louvre_area_m2", 0) or 0 for f in ("north", "east", "south", "west")), 3)
    print(f"  openings total: {tot} m² (target 1.43)")
    print(f"  derived occupied rooms: 138 x 0.971 = {round(138 * 0.971, 1)}")


if __name__ == "__main__":
    apply()
