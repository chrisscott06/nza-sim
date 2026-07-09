#!/usr/bin/env python3
"""Audit P2 — read-only blast radius. Compares, per project, the dispatch the STORED
simple systems_config would have produced (what /api/simulate emitted BEFORE 98-pre-b)
against the dispatch derive_systems_for_sim(v40) produces (what it emits NOW). No writes.

Run: python3 scripts/_audit_config_drift_blast.py
"""
import json
import sqlite3
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from nza_engine.systems_from_v40 import derive_systems_for_sim  # noqa: E402

_GAS = {"gas_boiler_heating", "gas_boiler_combi"}


def stored_key(simple, service, flat_fallback):
    """Replicate the assembler's read of the stored simple config for a service."""
    sysd = (simple.get("systems") or {}).get(service, {}) or {}
    prim = sysd.get("primary") or {}
    return prim.get("system") or simple.get(flat_fallback)


def dispatch(simple, v25):
    """The coarse EP dispatch outcome from a simple config + v25 gates."""
    sh = stored_key(simple, "space_heating", "hvac_type")
    sc = stored_key(simple, "space_cooling", "hvac_type")
    vt = stored_key(simple, "ventilation", "ventilation_type")
    dh = stored_key(simple, "dhw", "dhw_primary")
    heat_on = ((v25 or {}).get("heating") or {}).get("enabled", True) is not False
    cool_on = ((v25 or {}).get("cooling") or {}).get("enabled", True) is not False
    dhw_on = ((v25 or {}).get("dhw") or {}).get("enabled", True) is not False
    return {
        "heating": ("gas" if sh in _GAS else "vrf/other") if heat_on else "OFF",
        "cooling": "none" if (sc == "none_cooling" or not cool_on) else "vrf",
        "ventilation": "mvhr" if (vt or "").startswith("mvhr") else "mev",
        "dhw": ("gas" if dh else "gas") if dhw_on else "OFF",
        "_raw": {"heating_key": sh, "cooling_key": sc, "vent_key": vt, "dhw_key": dh,
                 "gates": {"h": heat_on, "c": cool_on, "d": dhw_on}},
    }


c = sqlite3.connect("file:data/nza_sim.db?mode=ro", uri=True)
c.row_factory = sqlite3.Row
rows = c.execute("SELECT id,name,building_config,systems_config,updated_at FROM projects").fetchall()

report = {"db": "data/nza_sim.db", "projects": []}
for r in rows:
    bc = json.loads(r["building_config"] or "{}")
    stored_simple = json.loads(r["systems_config"] or "{}")
    v40 = bc.get("systems_config_v40") or {}
    stored_v25 = bc.get("systems_config_v25") or {}

    has_v40 = any(v40.get(s) for s in ("heating", "cooling", "dhw", "ventilation"))
    stored_disp = dispatch(stored_simple, stored_v25)

    if has_v40:
        derived_simple, derived_v25 = derive_systems_for_sim(bc, fallback_simple=stored_simple)
        derived_disp = dispatch(derived_simple, derived_v25)
    else:
        derived_disp = {"heating": "(no v40 — falls back to stored, no drift)",
                        "cooling": "-", "ventilation": "-", "dhw": "-", "_raw": {}}

    diffs = []
    for svc in ("heating", "cooling", "ventilation", "dhw"):
        if has_v40 and stored_disp[svc] != derived_disp[svc]:
            diffs.append(f"{svc}: stored={stored_disp[svc]} → v40={derived_disp[svc]}")

    entry = {
        "id": r["id"][:12], "name": r["name"], "updated_at": r["updated_at"],
        "has_v40": has_v40,
        "drifted": bool(diffs),
        "differing_services": diffs,
        "stored_dispatch": {k: stored_disp[k] for k in ("heating", "cooling", "ventilation", "dhw")},
        "v40_dispatch": {k: derived_disp[k] for k in ("heating", "cooling", "ventilation", "dhw")},
    }
    report["projects"].append(entry)

print(json.dumps(report, indent=2))
OUT = REPO / "docs/audit/config_drift_blast.json"
OUT.write_text(json.dumps(report, indent=2))
print(f"\nwrote {OUT}")
