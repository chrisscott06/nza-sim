#!/usr/bin/env python3
"""Brief 96 P1 — build the clean report baseline fixture.

`report_baseline_v1` = a COPY of the frozen `bridgewater_anchor_v2` with the experiment
residue removed, per the design note ("the 5 W/m² debug auxiliary load and any other
experiment residue removed first"):
  - gains.auxiliary.profiles → []  (the residual External-lighting 1.5 W/m² aux-toggle
    experiment; the 5 W/m² debug load was already removed in the earlier re-anchor)
  - building_config.interventions → []  (the anchor's 8 playground interventions; the 22
    HIEX items are added separately in P2 — the report baseline is the un-intervened
    building)
  - building_config.strategies → [{ id, name, refs: [] }]

Everything else (envelope, systems, occupancy, schedules, constructions, weather) is
carried through byte-for-byte so the baseline physics is identical to the anchor's minus
the aux experiment. `bridgewater_anchor_v2` itself is NOT touched (Decision 1).

Run:  validation/.venv/bin/python scripts/report/build_baseline.py
"""
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
SRC = REPO / "validation" / "fixtures" / "bridgewater_anchor_v2.yaml"
DST = REPO / "validation" / "fixtures" / "report_baseline_v1.yaml"

fix = yaml.safe_load(SRC.read_text())
bc = fix["building_config"]

# 1. strip the aux experiment residue (External lighting 1.5 W/m²)
removed_aux = []
aux = bc.get("gains", {}).get("auxiliary", {})
if isinstance(aux, dict):
    removed_aux = [p.get("label") for p in (aux.get("profiles") or [])]
    aux["profiles"] = []

# 2. clear the anchor's playground interventions + strategy (HIEX 22 added in P2)
removed_ivs = [iv.get("label") for iv in (bc.get("interventions") or [])]
bc["interventions"] = []
bc["strategies"] = [{"id": "hiex_report_strategy", "name": "HIEX phasing spine", "refs": []}]

# 3. provenance header (replace the anchor _meta with a report-baseline one)
fix["_meta"] = {
    "brief": "Brief 96 P1 — report_baseline_v1 (clean report baseline, engine-direct)",
    "derived_from": "validation/fixtures/bridgewater_anchor_v2.yaml",
    "source_project": "12cf7cc4-9bdc-41bc-ab4e-24e044fbad9d (Bridgewater Hotel)",
    "removed": {
        "gains.auxiliary.profiles": removed_aux,
        "building_config.interventions": removed_ivs,
        "note": "aux-toggle experiment residue + anchor playground interventions removed "
                "per the HIEX design note baseline discipline. Envelope/systems/occupancy/"
                "schedules/constructions carried byte-for-byte. Anchor fixture untouched.",
    },
    "gia_m2": 4215,
    "tariffs": {"electricity_p_per_kwh": 28, "gas_p_per_kwh": 7},
}

DST.write_text(
    "# Brief 96 P1 — report_baseline_v1: clean report baseline (see _meta for provenance).\n"
    "# Derived from bridgewater_anchor_v2 with the aux experiment + playground interventions\n"
    "# removed. Anchor stays the engine-regression fixture; this is the REPORT reference.\n"
    + yaml.safe_dump(fix, sort_keys=False, allow_unicode=True, width=4096)
)
print(f"[build_baseline] wrote {DST.relative_to(REPO)}")
print(f"[build_baseline] removed aux profiles: {removed_aux}")
print(f"[build_baseline] removed {len(removed_ivs)} playground interventions: {removed_ivs}")
sys.exit(0)
