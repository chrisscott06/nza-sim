#!/usr/bin/env python3
"""Brief 96 P5 — export the intervention definitions to JSON for the Node NZA runner.

The engine (instantCalc.js / interventionsEngine.js) is JS; interventions.py is the Python
source of truth. This dumps the run-relevant fields (ref, patches, class, life, spine, the
3.2 cumulative-eff override) to docs/report/data/interventions.json so run_nza.mjs can drive
the same definitions without duplicating them.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from interventions import INTERVENTIONS, PHASING_SPINE  # noqa: E402
from offmodel import VRF_REPLACEMENT_EFF  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "docs" / "report" / "data" / "interventions.json"

items = []
for iv in INTERVENTIONS:
    modellable = iv["cls"] in ("A", "B") and bool(iv.get("patches"))
    items.append({
        "ref": iv["ref"], "name": iv["name"], "theme": iv["theme"], "cls": iv["cls"],
        "life": iv["life"], "modellable": modellable,
        "off_model": bool(iv.get("off_model")), "enabling": bool(iv.get("enabling")),
        "patches": iv.get("patches", []),
        # 3.2 uses a distinct efficiency in the cumulative spine (post-3.1 anti-double-count)
        "cumulative_patch_override": (
            [{"op": "set", "path": "building.systems_config_v40.heating[0].efficiency_metric",
              "value": VRF_REPLACEMENT_EFF["cumulative_after_3_1"]},
             {"op": "set", "path": "building.systems_config_v40.cooling[0].efficiency_metric",
              "value": VRF_REPLACEMENT_EFF["cumulative_after_3_1"]}]
            if iv["ref"] == "3.2" else None),
    })

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({"interventions": items, "spine": PHASING_SPINE}, indent=1))
print(f"[export] {len(items)} interventions "
      f"({sum(1 for i in items if i['modellable'])} modellable) → {OUT.relative_to(REPO)}")
