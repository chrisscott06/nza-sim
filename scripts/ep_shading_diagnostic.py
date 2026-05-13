"""
scripts/ep_shading_diagnostic.py

Brief 26.2 — EP shading investigation. Per-window deep dive into the
diagnostic variables that pinpoint where shading is or isn't being
applied.

Runs 3 EP scenarios on Bridgewater (no shading / current / extreme on
south with 2m overhang + 1m fins) by PUTting the building_config,
running the sim via API, then reading the SQL directly to extract:

  - Sunlit Fraction (mean, summer noon hours) for south windows
  - Incident Solar Rate per Area (mean, summer noon hours) for south windows
  - Transmitted Solar Energy (annual sum) for south windows
  - Window Heat Gain Energy (annual sum, if available)

Reading Sunlit Fraction is the textbook indicator: if SF drops below 1.0
under shading, EP IS applying the shading geometry. If SF stays at 1.0
regardless of shading geometry, EP isn't seeing the shading at all
(geometry-level problem). If SF drops but Incident Solar doesn't, EP
sees the shading but doesn't apply it to the radiation calc (settings-
level problem).

Usage:
  python scripts/ep_shading_diagnostic.py
"""
from __future__ import annotations

import json
import sqlite3
import sys
import time
from pathlib import Path
from urllib import request, error

REPO_ROOT = Path(__file__).resolve().parent.parent
API = "http://127.0.0.1:8002"
PROJECT_ID = "14b4a5b1-8c73-4acb-8b65-1d22f05ec969"

ZERO_SHADING = {
    "shading_overhang": {f: {"depth_m": 0, "offset_m": 0} for f in ("north","south","east","west")},
    "shading_fin":      {f: {"left_depth_m": 0, "right_depth_m": 0} for f in ("north","south","east","west")},
}


def http_request(method: str, path: str, body=None) -> dict:
    url = f"{API}{path}"
    req = request.Request(url, method=method)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        req.add_header("Content-Type", "application/json")
        req.data = data
    try:
        with request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode("utf-8")) if r.status != 204 else {}
    except error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode("utf-8"))
        except Exception:
            detail = {"detail": str(e)}
        return {"_http_error": e.code, **detail}


def set_shading(payload: dict) -> None:
    r = http_request("PUT", f"/api/projects/{PROJECT_ID}/building", payload)
    if r.get("_http_error"):
        raise RuntimeError(f"PUT /building failed: {r}")


def run_sim() -> str:
    r = http_request("POST", f"/api/projects/{PROJECT_ID}/simulate?scenario_name=ShadingDeep&mode=envelope-only")
    if not r.get("run_id"):
        raise RuntimeError(f"simulate failed: {r}")
    return r["run_id"]


def query_sql(run_id: str) -> dict:
    sql_path = REPO_ROOT / f"data/simulations/{run_id}/eplusout.sql"
    con = sqlite3.connect(sql_path)
    con.row_factory = sqlite3.Row
    out = {}

    def sum_by_keyvalue(var: str, key_prefix: str) -> dict[str, float]:
        rows = con.execute(
            "SELECT ReportDataDictionaryIndex, KeyValue FROM ReportDataDictionary "
            "WHERE Name = ? COLLATE NOCASE",
            (var,),
        ).fetchall()
        result = {}
        for r in rows:
            kv = (r["KeyValue"] or "").upper()
            if key_prefix.upper() in kv:
                idx = r["ReportDataDictionaryIndex"]
                s = con.execute(
                    "SELECT SUM(Value), AVG(Value), COUNT(Value) FROM ReportData WHERE ReportDataDictionaryIndex = ?",
                    (idx,),
                ).fetchone()
                result[kv] = {
                    "sum": s[0] or 0.0,
                    "avg": s[1] or 0.0,
                    "n":   s[2] or 0,
                }
        return result

    # South-facing windows are named like FLOOR_n_WIN_S
    sunlit_south = sum_by_keyvalue("Surface Outside Face Sunlit Fraction", "_WIN_S")
    incident_south = sum_by_keyvalue("Surface Outside Face Incident Solar Radiation Rate per Area", "_WIN_S")
    trans_south = sum_by_keyvalue("Surface Window Transmitted Solar Radiation Energy", "_WIN_S")

    # South WALL (for comparison — should also be shaded by the overhang above the window)
    sunlit_wall_s = sum_by_keyvalue("Surface Outside Face Sunlit Fraction", "_WALL_S")
    incident_wall_s = sum_by_keyvalue("Surface Outside Face Incident Solar Radiation Rate per Area", "_WALL_S")

    con.close()

    def aggregate(d: dict) -> dict:
        if not d:
            return {"avg": None, "sum": None, "keys": 0}
        avgs = [v["avg"] for v in d.values() if v["n"] > 0]
        sums = [v["sum"] for v in d.values() if v["n"] > 0]
        return {
            "avg":  sum(avgs) / len(avgs) if avgs else None,
            "sum":  sum(sums),
            "keys": len(d),
            "samples": list(d.keys())[:2],  # show a sample of key names
        }

    return {
        "sunlit_south_windows":   aggregate(sunlit_south),
        "incident_south_windows": aggregate(incident_south),
        "transmitted_south_windows_J": aggregate(trans_south),
        "sunlit_south_wall":      aggregate(sunlit_wall_s),
        "incident_south_wall":    aggregate(incident_wall_s),
    }


def scenario(label: str, payload: dict) -> dict:
    print(f"  {label}")
    set_shading(payload)
    run_id = run_sim()
    time.sleep(0.5)  # let SQL flush
    metrics = query_sql(run_id)
    return {"run_id": run_id, "metrics": metrics}


def main():
    proj = http_request("GET", f"/api/projects/{PROJECT_ID}")
    bc = proj["building_config"]
    current_overhang = bc.get("shading_overhang")
    current_fin = bc.get("shading_fin")

    print()
    print("=" * 78)
    print("  EP SHADING DEEP DIAGNOSTIC — three scenarios on Bridgewater")
    print("  Reading Sunlit Fraction + Incident Solar to localise the failure")
    print("=" * 78)
    print()

    scenarios = [
        ("NO SHADING (all zero)", ZERO_SHADING),
        ("CURRENT persisted", {"shading_overhang": current_overhang, "shading_fin": current_fin}),
        ("EXTREME on F3 South (2m overhang + 1m fins)", {
            "shading_overhang": {**ZERO_SHADING["shading_overhang"], "south": {"depth_m": 2.0, "offset_m": 0}},
            "shading_fin":      {**ZERO_SHADING["shading_fin"],      "south": {"left_depth_m": 1.0, "right_depth_m": 1.0}},
        }),
    ]

    results = []
    for label, payload in scenarios:
        r = scenario(label, payload)
        results.append((label, r["run_id"], r["metrics"]))
        m = r["metrics"]
        print(f"    run_id: {r['run_id']}")
        print(f"    south windows:  sunlit_avg = {m['sunlit_south_windows']['avg']!r}   incident_avg(W/m2) = {m['incident_south_windows']['avg']!r}   transmitted_sum(J) = {m['transmitted_south_windows_J']['sum']!r}")
        print(f"    south WALL:     sunlit_avg = {m['sunlit_south_wall']['avg']!r}      incident_avg(W/m2) = {m['incident_south_wall']['avg']!r}")
        print()

    # Restore original config
    set_shading({"shading_overhang": current_overhang, "shading_fin": current_fin})
    print("  (project config restored)")
    print("=" * 78)

    # Diagnosis
    print()
    print("  DIAGNOSIS:")
    wnd_sunlit = [r[2]["sunlit_south_windows"]["avg"] for r in results]
    wnd_incident = [r[2]["incident_south_windows"]["avg"] for r in results]
    wall_sunlit = [r[2]["sunlit_south_wall"]["avg"] for r in results]
    delta_wnd_sunlit = (wnd_sunlit[0] or 0) - (wnd_sunlit[2] or 0)
    delta_wnd_incident = (wnd_incident[0] or 0) - (wnd_incident[2] or 0)
    print(f"    South window Sunlit Fraction (no→extreme):   {wnd_sunlit[0]!r} → {wnd_sunlit[2]!r}   (Δ {delta_wnd_sunlit:.4f})")
    print(f"    South window Incident Solar (no→extreme):    {wnd_incident[0]!r} → {wnd_incident[2]!r}   (Δ {delta_wnd_incident:.2f})")
    print(f"    South wall Sunlit Fraction (no→extreme):     {wall_sunlit[0]!r} → {wall_sunlit[2]!r}")
    print()
    if delta_wnd_sunlit > 0.01:
        print("    ✓ Sunlit Fraction DROPS under shading — EP geometry IS being applied")
        if delta_wnd_incident > 1.0:
            print("    ✓ Incident Solar also drops — issue is downstream (transmitted variable, window heat balance)")
        else:
            print("    ✗ Incident Solar UNCHANGED despite Sunlit Fraction drop — bug is in")
            print("      EP's window radiation calc OR the variable we're reading.")
    else:
        print("    ✗ Sunlit Fraction UNCHANGED — EP is NOT applying shading geometry")
        print("      The geometry is loaded but not consumed by the shadow calc.")
    print("=" * 78)


if __name__ == "__main__":
    main()
