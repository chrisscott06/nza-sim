"""
scripts/_model1_dhw_anchor.py — Brief: bridgwater-baseline-model1, Part 2 (D2)

Gas-anchor the Bridgwater baseline DHW demand: set litres/person/day so modelled
annual DHW *gas* = the metered anchor (207.7 MWh), with the 75/25 gas/ASHP split
and eta=0.89 held fixed. NOT hand-set — the value comes from the convergence.

TEMPERATURE-BASIS FINDING (read from systemsEngine._computeDhw, not assumed):
  litres/person/day is TAP litres at 40 C tap-mix. Per-head, not presence-scaled
  (Brief 58 B3). The boiler heats only hot_fraction = (tap-cold)/(setpoint-cold)
  = (40-10)/(60-10) = 0.6 of the tap litres, from 10 -> 60 C.
  Heating is all-electric VRF, so DHW gas is the ONLY modelled gas.

  demand_MWh = occupants x L x hot_fraction x (setpoint-cold) x (4.18/3600) x 365 / 1000
  gas_MWh    = demand_MWh x gas_share / gas_eta          (linear in L -> direct solve)

Converged (2026-07-14): L = 48.2 L/p/day @40C tap -> gas 207.6 MWh (-0.05%);
60 C-equivalent = 48.2 x 0.6 = 28.9 L/p/day (brief independent sanity ~28.7).

Usage: python scripts/_model1_dhw_anchor.py
"""
import sqlite3, json
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "data/nza_sim.db"
TARGET_GAS_MWH = 207.7
SHC = 4.18 / 3600  # WATER_SHC_KWH_PER_L_PER_K, mirrors systemsEngine.js:59


def anchor(project_name="Bridgewater Hotel"):
    c = sqlite3.connect(DB)
    cols = [d[0] for d in c.execute("SELECT * FROM projects LIMIT 1").description]
    d = dict(zip(cols, c.execute("SELECT * FROM projects WHERE name=?", (project_name,)).fetchone()))
    pid = d["id"]; bc = json.loads(d["building_config"]); v40 = bc["systems_config_v40"]

    occupants = bc["num_bedrooms"] * bc["occupancy"]["density"]["value"] * \
        bc["occupancy"].get("occupancy_rate", bc.get("occupancy_rate", 1))
    setp = v40["dhw_storage_setpoint_c"]; cold = v40["dhw_cold_supply_temp_c"]; tap = v40["dhw_tap_outlet_temp_c"]
    hot_fraction = (tap - cold) / (setp - cold)
    gas = next(s for s in v40["dhw"] if s["source"] == "gas")
    gas_share = gas["share_pct"] / 100; gas_eff = gas["efficiency_metric"]

    gas_per_L = (occupants * hot_fraction * (setp - cold) * SHC * 365 / 1000) * gas_share / gas_eff
    L = round(TARGET_GAS_MWH / gas_per_L, 1)
    v40["dhw_demand_litres_per_person_per_day"] = L
    c.execute("UPDATE projects SET building_config=? WHERE id=?", (json.dumps(bc), pid)); c.commit()

    gas_at = gas_per_L * L
    print(f"  occupants={occupants:.3f}  hot_fraction={hot_fraction}  gas={gas_share}/{gas_eff}")
    print(f"  converged L = {L} L/p/day @40C tap  ->  gas {gas_at:.2f} MWh ({100*(gas_at-TARGET_GAS_MWH)/TARGET_GAS_MWH:+.2f}%)")
    print(f"  60C-equivalent = {L} x {hot_fraction} = {L*hot_fraction:.1f} L/p/day")


if __name__ == "__main__":
    anchor()
