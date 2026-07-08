#!/usr/bin/env python3
"""Brief 96 P5 — EnergyPlus isolated runs for the EP-mappable interventions.

Validation appendix (NOT the headline). Each modellable (Class A/B) intervention is applied
alone to report_baseline_v1, run through the Brief 95 EP pipeline (IdealLoads demand +
fixed-efficiency consumption, config-hash cached), and its Δ vs the EP baseline recorded
against the NZA-Sim Δ.

Cross-engine path note: NZA uses the `constructions.` quartet prefix; the EP state_builder
routes `construction_choices.` / `library_constructions.` as top-level. We remap
`constructions.` → `construction_choices.` before applying for EP (same logical patch).

Run: ENERGYPLUS_DIR=/Applications/EnergyPlus-25-2-0 validation/.venv/bin/python scripts/report/run_ep_mappable.py
"""
import copy
import json
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "validation" / "energyplus"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from state_builder import apply_patch, config_hash  # noqa: E402
from generate_idf import resolve_idd  # noqa: E402
import ep_batch_runner as R  # noqa: E402
from interventions import INTERVENTIONS  # noqa: E402

FIX = yaml.safe_load((REPO / "validation" / "fixtures" / "report_baseline_v1.yaml").read_text())
EPW = REPO / "data" / "weather" / "current" / FIX["building_config"]["weather_file"]
IDD = resolve_idd()
DB = REPO / "docs" / "report" / "data" / "ep_report.db"
OUT = REPO / "docs" / "report" / "data" / "ep_runs.json"
NZA = json.loads((REPO / "docs" / "report" / "data" / "nza_runs.json").read_text())


def remap_for_ep(patch):
    """NZA `constructions.` prefix → EP `construction_choices.` (same logical target)."""
    p = dict(patch)
    if p["path"].startswith("constructions."):
        p["path"] = "construction_choices." + p["path"][len("constructions."):]
    return p


def ep_metrics(res):
    d = res["demand_mwh"]
    return {"eui": res["eui_kwh_per_m2_yr"], "heating_mwh": round(d["space_heating"], 1),
            "cooling_mwh": round(d["space_cooling"], 1)}


# EP baseline (from P1)
ep_base_raw = json.loads((REPO / "validation" / "energyplus" / "results" / "report_baseline_v1.json").read_text())
ep_base = {"eui": ep_base_raw["eui_kwh_per_m2_yr"],
           "heating_mwh": round(ep_base_raw["demand_mwh"]["space_heating"], 1),
           "cooling_mwh": round(ep_base_raw["demand_mwh"]["space_cooling"], 1)}
nza_base = NZA["baseline"]

rows = []
for iv in INTERVENTIONS:
    if iv["cls"] not in ("A", "B") or not iv.get("patches"):
        continue
    cfg = copy.deepcopy(FIX)
    for p in iv["patches"]:
        apply_patch(cfg, remap_for_ep(p))
    try:
        r = R.run_state(cfg, f"iso:{iv['ref']}", EPW, IDD, "b96_report", db_path=DB)
    except Exception as e:  # isolate failures — record + continue
        rows.append({"ref": iv["ref"], "name": iv["name"], "status": "failed", "error": str(e)[:200]})
        print(f"  ✗ {iv['ref']} EP FAILED: {e}")
        continue
    if r["status"] == "failed":
        rows.append({"ref": iv["ref"], "name": iv["name"], "status": "failed", "error_tail": r.get("error_tail")})
        print(f"  ✗ {iv['ref']} EP FAILED (fatal)")
        continue
    ep = ep_metrics(r["results"])
    nz = NZA["isolated"].get(iv["ref"], {})
    row = {"ref": iv["ref"], "name": iv["name"], "status": r["status"], "hash": r["config_hash"][:12]}
    for k, unit in (("eui", "kWh/m²"), ("heating_mwh", "MWh"), ("cooling_mwh", "MWh")):
        nza_d = round((nz.get(k) or 0) - (nza_base.get(k) or 0), 1)
        ep_d = round(ep[k] - ep_base[k], 1)
        pct = round((ep_d - nza_d) / abs(nza_d) * 100) if abs(nza_d) > 0.05 else None
        row[k] = {"nza_delta": nza_d, "ep_delta": ep_d, "delta_pct": pct}
    rows.append(row)
    print(f"  ✓ {iv['ref']} {r['status']}: EUI Δ NZA {row['eui']['nza_delta']} | EP {row['eui']['ep_delta']}")

OUT.write_text(json.dumps({"ep_baseline": ep_base, "nza_baseline": {k: nza_base[k] for k in ('eui', 'heating_mwh', 'cooling_mwh')},
                           "rows": rows}, indent=1))
done = sum(1 for r in rows if r.get("status") in ("done", "cached"))
print(f"\n[ep] {done}/{len(rows)} EP-mappable ran; wrote {OUT.relative_to(REPO)}")
