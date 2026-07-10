#!/usr/bin/env python3
"""Brief 99 — adapt the 22 HIEX report interventions (scripts/report/interventions.py)
into the persisted Library shape and write them to a project via the API.

Report-shape -> persisted-shape adapter (Brief 99 §"The shape adapter"):
  name -> label ; ref -> notes ; +id/enabled/capex_gbp/schema_version ;
  patches +id+source ; cost.lines -> cost.groups ; on_cost_pct -> contingency_pct.

Pinned decisions:
  D1 schema_version = 2 (modal live value + DEFAULT_PARAMS; see P1 commit).
  D2 blended on_cost -> ONE bucket (contingency_pct); the other four EXPLICIT 0
     (NOT null) — null would inherit PROJECT_COST_DEFAULTS 12/10/8/5 and blow the
     ±1% reconciliation. Matches migrateCostShape (costModel.js:79) precedent. Not
     fabricating rates: four are 0, one carries the report's single blended figure.
  D3 new groups shape.  D5 API PUT /{id}/building (merge).

Class handling: off_model/enabling items already carry 0 patches in the source, so
no faked savings are possible. Flag derived from enabling/off_model/cls.

Usage:
  python3 scripts/seed_hiex_interventions.py --project <id> --refs 1.4 --mode append [--write]
  python3 scripts/seed_hiex_interventions.py --project <id> --all --mode replace [--write]
Without --write it is a DRY RUN (adapts + reconciles + prints, no API call).
"""
import argparse
import json
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts" / "report"))
import interventions as REPORT  # noqa: E402
import offmodel as OFFMODEL  # noqa: E402

# Brief 100: off-model measures (Class C) carry their real energy/carbon effect in an
# `off_model` field (computed by scripts/report/offmodel.py), which the frontend metrics
# add on top of the engine result. ref -> (offmodel callable). 3.2 is the refrigerant
# component that rides ALONGSIDE 3.2's energy patch (additive carbon).
_OFF_MODEL_FN = {
    "1.5": OFFMODEL.interlink_1_5,
    "3.2": OFFMODEL.refrigerant_3_2,
    "7.1": OFFMODEL.pv_7_1,
}
_OFF_MODEL_KEYS = ("annual_elec_kwh_saved", "annual_gas_kwh_saved", "annual_gbp_saved",
                   "lifetime_tco2e", "eui_delta_kwh_m2", "basis")


def _off_model(ref):
    fn = _OFF_MODEL_FN.get(ref)
    if fn is None:
        return None
    raw = fn()
    return {k: raw[k] for k in _OFF_MODEL_KEYS if k in raw}

API = "http://127.0.0.1:8002"
SCHEMA_VERSION = 2  # D1

# report cost-line unit -> persisted UNITS (display only; does not affect totals)
_UNIT_MAP = {
    "allow": "sum", "circuit": "nr", "fitting": "nr", "kWp": "kW", "m2": "m²",
    "meter": "m", "point": "nr", "riser": "nr", "room": "nr", "survey": "item",
    "visit": "item", "day": "day", "kW": "kW", "l/s": "l/s", "nr": "nr", "m": "m",
}


def _slug(ref):
    return ref.replace(".", "_")


def _flag(entry):
    if entry.get("enabling"):
        return "enabling"
    if entry.get("off_model"):
        return "off_model"
    return {"A": "simulated", "B": "derived", "C": "off_model", "D": "enabling"}.get(entry.get("cls"), "simulated")


def _notes(entry, flag):
    ref, cls = entry["ref"], entry.get("cls")
    bits = [f"HIEX ref {ref} · Class {cls} ({flag})."]
    if flag == "off_model":
        bits.append("Energy/carbon effect calculated off-model — see report.")
    within = (entry.get("cost") or {}).get("within")
    if within:
        bits.append(f"Cost carried by ref {within}.")
    if entry.get("assumption"):
        bits.append(entry["assumption"])
    if entry.get("basis"):
        bits.append(f"Basis: {entry['basis']}")
    return " ".join(bits).strip()


def adapt(entry):
    """report entry -> persisted intervention (Brief 41 §3 shape)."""
    ref = entry["ref"]
    flag = _flag(entry)
    cost = entry.get("cost") or {}
    lines = cost.get("lines") or []
    on_cost_pct = cost.get("on_cost_pct") or 0

    # patches: reuse op/path/value as-is (paths already match v40 selector format)
    patches = []
    for i, p in enumerate(entry.get("patches") or []):
        pp = {"id": f"patch_hiex_{_slug(ref)}_{i}", "source": "inline",
              "op": p["op"], "path": p["path"], "value": p.get("value")}
        if "match" in p:
            pp["match"] = p["match"]
        patches.append(pp)

    # cost -> groups shape
    if lines:
        group_lines = [{
            "id": f"l_hiex_{_slug(ref)}_{i}", "name": ln.get("desc", ""),
            "quantity": ln.get("qty"), "unit": _UNIT_MAP.get(ln.get("unit"), "nr"),
            "rate": ln.get("rate"), "notes": "",
        } for i, ln in enumerate(lines)]
        groups = [{"id": f"g_hiex_{_slug(ref)}", "name": f"Cost plan (HIEX {ref})",
                   "nrm2_category": None, "collapsed": False, "lines": group_lines}]
    else:
        groups = []
    cost_obj = {
        "groups": groups,
        # D2: blended on-cost in ONE bucket, others EXPLICIT 0 (not null).
        "on_costs": {"design_fees_pct": 0, "prelims_pct": 0, "ohp_pct": 0,
                     "contingency_pct": on_cost_pct, "inflation_pct": 0},
        "template_origin": None,
        "notes": (f"Cost carried by ref {cost.get('within')}." if cost.get("within") else ""),
    }

    out = {
        "id": f"int_hiex_{_slug(ref)}",
        "label": entry["name"],
        "notes": _notes(entry, flag),
        "enabled": True,
        "theme": entry.get("theme", ""),
        "capex_gbp": cost.get("central") if cost.get("central") else None,
        "schema_version": SCHEMA_VERSION,
        "patches": patches,
        "cost": cost_obj,
    }
    om = _off_model(ref)
    if om is not None:
        out["off_model"] = om
    return out


def seeded_total(persisted):
    """Mirror costModel computeOnCostsBreakdown with the seeded (0/0/0/pct/0) on_costs."""
    oc = persisted["cost"]["on_costs"]
    lines_total = sum((ln.get("quantity") or 0) * (ln.get("rate") or 0)
                      for g in persisted["cost"]["groups"] for ln in g["lines"])
    design = round(lines_total * oc["design_fees_pct"] / 100)
    prelims = round(lines_total * oc["prelims_pct"] / 100)
    ohp = round(lines_total * oc["ohp_pct"] / 100)
    subtotal = lines_total + design + prelims + ohp
    contingency = round(subtotal * oc["contingency_pct"] / 100)
    inflation = round(subtotal * oc["inflation_pct"] / 100)
    return subtotal + contingency + inflation


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.loads(r.read())


def put_building(project_id, body):
    req = urllib.request.Request(
        f"{API}/api/projects/{project_id}/building", method="PUT",
        data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--refs", nargs="*", help="specific refs, e.g. 1.4")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--mode", choices=["append", "replace"], default="replace")
    ap.add_argument("--write", action="store_true", help="actually PUT (else dry run)")
    args = ap.parse_args()

    entries = REPORT.INTERVENTIONS
    if args.refs and not args.all:
        entries = [e for e in entries if e["ref"] in args.refs]
    print(f"adapting {len(entries)} intervention(s); schema_version={SCHEMA_VERSION}")

    adapted, recon = [], []
    for e in entries:
        p = adapt(e)
        adapted.append(p)
        central = (e.get("cost") or {}).get("central") or 0
        tot = seeded_total(p)
        delta_pct = (100 * (tot - central) / central) if central else 0.0
        ok = abs(delta_pct) <= 1.0 if central else True
        recon.append({"ref": e["ref"], "cls": e.get("cls"), "flag": _flag(e),
                      "central": central, "seeded_total": tot, "delta_pct": round(delta_pct, 2),
                      "reconciled": ok, "patches": len(p["patches"])})
        print(f"  {e['ref']:5} {e.get('cls'):3} {_flag(e):10} central={central:>8} seeded={tot:>8} "
              f"Δ={delta_pct:+.2f}% {'OK' if ok else 'FAIL'} patches={len(p['patches'])}")

    fails = [r for r in recon if not r["reconciled"]]
    print(f"\nreconciled {len(recon)-len(fails)}/{len(recon)} within ±1%"
          + (f"  FAILURES: {[r['ref'] for r in fails]}" if fails else ""))

    if args.write:
        proj = fetch_json(f"{API}/api/projects/{args.project}")
        existing = (proj["building_config"].get("interventions") or [])
        new_list = (existing + adapted) if args.mode == "append" else adapted
        # de-dup by id (append mode: a re-run replaces same-id, keeps others)
        seen, deduped = set(), []
        for iv in reversed(new_list):
            if iv["id"] in seen:
                continue
            seen.add(iv["id"]); deduped.append(iv)
        deduped.reverse()
        status, _ = put_building(args.project, {"interventions": deduped})
        print(f"\nAPI PUT /{args.project}/building -> {status}; interventions now = {len(deduped)} (mode={args.mode})")
    else:
        print("\nDRY RUN — no API write (pass --write to persist).")

    return recon, adapted


if __name__ == "__main__":
    main()
