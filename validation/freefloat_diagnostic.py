#!/usr/bin/env python3
"""freefloat_diagnostic.py - Brief 84b P2 free-float zone-temp delta characterisation.

Fresh analysis (NOT relying on Brief 82's framing) of the ~+1 C free-float warmth:
NZA-Sim's zone air node settling warmer than EnergyPlus during hours where NEITHER
engine is conditioning. Read-only; stdlib only (csv, math, argparse, datetime, pathlib).

Free-float hour = EP not conditioning (heating+cooling demand == 0) AND NZA not
conditioning (heating+cooling demand == 0). Both must hold (Brief 84b P2).

In free-float hours NZA's reported zone_mean_air_temp_c IS its free-float temp (no clamp),
so delta = T_NZA - T_EP is the free-float warmth directly.

Inputs:
  validation/energyplus/results/<fixture>_hourly_temps.csv   (Brief 82 P2)
  validation/nza_sim/results/<fixture>_hourly_temps.csv      (Brief 82 P2)
  data/weather/current/<epw>                                 (global horizontal solar)

Output:
  validation/reports/freefloat_diagnostic_<ts>.md            (ASCII markdown)

Run:
  python validation/freefloat_diagnostic.py
  python validation/freefloat_diagnostic.py --stdout
"""
import argparse
import csv
import math
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
EP_CSV = SCRIPT_DIR / "energyplus" / "results"
NZA_CSV = SCRIPT_DIR / "nza_sim" / "results"
REPORTS_DIR = SCRIPT_DIR / "reports"
WEATHER_DIR = REPO_ROOT / "data" / "weather" / "current"
DEFAULT_FIXTURE = "bridgewater_box_v1"
EPS = 1e-6  # kWh: demand at/below this counts as zero (matches Brief 82/83)


# ---------------------------------------------------------------------------
def load_temps(path):
    with path.open(newline="", encoding="utf-8") as f:
        return {int(r["hour_index"]): r for r in csv.DictReader(f)}


def load_epw_global_horizontal(path):
    """Return {hour_index: global_horizontal_Wh_m2}. EPW: 8 header lines, then 8760 data
    lines; global horizontal radiation is field index 13 (0-based)."""
    out = {}
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    # find first data row (field 0 a 4-digit year, >= 14 fields)
    start = 0
    for i, ln in enumerate(lines):
        parts = ln.split(",")
        if len(parts) >= 14 and parts[0].strip().isdigit() and len(parts[0].strip()) == 4:
            start = i
            break
    hi = 0
    for ln in lines[start:]:
        parts = ln.split(",")
        if len(parts) < 14 or not parts[0].strip().isdigit():
            continue
        try:
            out[hi] = float(parts[13])
        except ValueError:
            out[hi] = 0.0
        hi += 1
    return out


def mean(a):
    return sum(a) / len(a) if a else float("nan")


def median(a):
    s = sorted(a)
    n = len(s)
    if n == 0:
        return float("nan")
    m = n // 2
    return s[m] if n % 2 else 0.5 * (s[m - 1] + s[m])


def pstdev(a):
    if not a:
        return float("nan")
    mu = mean(a)
    return math.sqrt(sum((x - mu) ** 2 for x in a) / len(a))


def pearson(xs, ys):
    n = len(xs)
    if n < 2:
        return float("nan")
    mx, my = mean(xs), mean(ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx == 0 or syy == 0:
        return float("nan")
    return sxy / math.sqrt(sxx * syy)


def f(x, nd=4):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "n/a"
    return f"{x:.{nd}f}"


# ---------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description="Brief 84b P2 free-float delta characterisation")
    ap.add_argument("--fixture", default=DEFAULT_FIXTURE)
    ap.add_argument("--stdout", action="store_true")
    args = ap.parse_args(argv)

    ep = load_temps(EP_CSV / f"{args.fixture}_hourly_temps.csv")
    nza = load_temps(NZA_CSV / f"{args.fixture}_hourly_temps.csv")
    epw_files = sorted(WEATHER_DIR.glob("*.epw"))
    solar = load_epw_global_horizontal(epw_files[0]) if epw_files else {}
    epw_name = epw_files[0].name if epw_files else "(none)"

    hours = sorted(set(ep) & set(nza))
    n_all = len(hours)

    # classify
    def cond(rec):
        return (float(rec["heating_demand_kwh"]) > EPS) or (float(rec["cooling_demand_kwh"]) > EPS)

    recs = []  # free-float records
    n_ep_ff = n_nza_ff = 0
    for h in hours:
        e, z = ep[h], nza[h]
        ep_ff = not cond(e)
        nza_ff = not cond(z)
        if ep_ff:
            n_ep_ff += 1
        if nza_ff:
            n_nza_ff += 1
        if ep_ff and nza_ff:
            t_ep = float(e["zone_mean_air_temp_c"])
            t_nza = float(z["zone_mean_air_temp_c"])
            recs.append(dict(
                h=h, month=int(e["month"]), hour=int(e["hour"]),
                t_ep=t_ep, t_nza=t_nza, delta=t_nza - t_ep,
                odb=float(e["outdoor_drybulb_c"]),
                dt=t_ep - float(e["outdoor_drybulb_c"]),   # indoor-outdoor (EP)
                ghi=solar.get(h, 0.0),
            ))

    deltas = [r["delta"] for r in recs]
    n_ff = len(recs)

    # ---- overall stats ----
    L = []
    w = L.append
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    w(f"# Brief 84b P2 - Free-float zone-temp delta characterisation: {args.fixture}")
    w("")
    w(f"- **Generated:** {ts}")
    w(f"- **Inputs:** EP+NZA `{args.fixture}_hourly_temps.csv` (Brief 82 P2); EPW `{epw_name}` (global horizontal)")
    w("- **Free-float hour:** EP heating+cooling demand == 0 AND NZA heating+cooling demand == 0 (both unconditioned).")
    w("- **Delta convention:** delta = T_NZA - T_EP (positive = NZA warmer). In free-float hours NZA's reported zone temp is its free-float temp (no clamp).")
    w("")
    w("## 1. Free-float hour set")
    w("")
    w("| Quantity | Hours | % of 8760 |")
    w("|---|---|---|")
    w(f"| EP unconditioned | {n_ep_ff} | {100*n_ep_ff/n_all:.1f}% |")
    w(f"| NZA unconditioned | {n_nza_ff} | {100*n_nza_ff/n_all:.1f}% |")
    w(f"| **Both unconditioned (free-float subset)** | **{n_ff}** | **{100*n_ff/n_all:.1f}%** |")
    w("")
    w("## 2. Free-float delta statistics")
    w("")
    w("| Stat | Value (deg C) |")
    w("|---|---|")
    w(f"| Mean delta | {f(mean(deltas))} |")
    w(f"| Median delta | {f(median(deltas))} |")
    w(f"| Std dev (population) | {f(pstdev(deltas))} |")
    w(f"| Min | {f(min(deltas))} |")
    w(f"| Max | {f(max(deltas))} |")
    w(f"| Hours delta > 0 | {100*sum(1 for d in deltas if d>0)/n_ff:.1f}% |")
    w(f"| Hours |delta| < 0.1 | {100*sum(1 for d in deltas if abs(d)<0.1)/n_ff:.1f}% |")
    w("")
    cv = pstdev(deltas) / mean(deltas) if mean(deltas) else float("nan")
    w(f"Coefficient of variation (std/mean) = {f(cv,3)}. A near-constant structural offset would have "
      f"CV near 0; a strongly conditional one CV >> 0.")
    w("")

    # ---- conditional: outdoor band ----
    def banded(keyfn, bands, label):
        w(f"### By {label}")
        w("")
        w("| Band | Hours | Mean delta | Median | Std |")
        w("|---|---|---|---|---|")
        for lo, hi, name in bands:
            sub = [r["delta"] for r in recs if lo <= keyfn(r) < hi]
            if sub:
                w(f"| {name} | {len(sub)} | {f(mean(sub))} | {f(median(sub))} | {f(pstdev(sub))} |")
            else:
                w(f"| {name} | 0 | n/a | n/a | n/a |")
        w("")

    w("## 3. Conditional analysis")
    w("")
    banded(lambda r: r["odb"],
           [(-99, 0, "<0"), (0, 5, "[0,5)"), (5, 10, "[5,10)"), (10, 15, "[10,15)"),
            (15, 20, "[15,20)"), (20, 99, ">=20")], "outdoor drybulb (deg C)")
    banded(lambda r: r["dt"],
           [(-99, 5, "<5"), (5, 10, "[5,10)"), (10, 15, "[10,15)"), (15, 20, "[15,20)"),
            (20, 99, ">=20")], "indoor-outdoor dT (EP zone - outdoor, deg C)")
    banded(lambda r: r["ghi"],
           [(-1, 1, "0 (night)"), (1, 100, "(0,100)"), (100, 300, "[100,300)"),
            (300, 9999, ">=300")], "global horizontal solar (Wh/m2)")

    # hour-of-day
    w("### By hour-of-day (hour-ending)")
    w("")
    w("| Hour | Hours | Mean delta |")
    w("|---|---|---|")
    for hh in range(1, 25):
        sub = [r["delta"] for r in recs if r["hour"] == hh]
        if sub:
            w(f"| {hh} | {len(sub)} | {f(mean(sub))} |")
    w("")
    occ = [r["delta"] for r in recs if 8 <= r["hour"] <= 18]
    uno = [r["delta"] for r in recs if not (8 <= r["hour"] <= 18)]
    w(f"Occupied proxy (08-18h): mean delta {f(mean(occ))} ({len(occ)} h) vs "
      f"unoccupied {f(mean(uno))} ({len(uno)} h).")
    w("")

    # monthly
    w("### By month")
    w("")
    w("| Month | Hours | Mean delta |")
    w("|---|---|---|")
    for mo in range(1, 13):
        sub = [r["delta"] for r in recs if r["month"] == mo]
        if sub:
            w(f"| {mo} | {len(sub)} | {f(mean(sub))} |")
    w("")

    # ---- correlations ----
    w("## 4. Correlations (free-float subset)")
    w("")
    w("| Pair | Pearson r |")
    w("|---|---|")
    w(f"| delta vs outdoor drybulb | {f(pearson([r['odb'] for r in recs], deltas),3)} |")
    w(f"| delta vs indoor-outdoor dT | {f(pearson([r['dt'] for r in recs], deltas),3)} |")
    w(f"| delta vs global horizontal solar | {f(pearson([r['ghi'] for r in recs], deltas),3)} |")
    w("")

    # ---- verdict ----
    w("## 5. P2 verdict: constant or conditional?")
    w("")
    r_dt = pearson([r["dt"] for r in recs], deltas)
    r_odb = pearson([r["odb"] for r in recs], deltas)
    r_ghi = pearson([r["ghi"] for r in recs], deltas)
    verdict = "CONDITIONAL" if (pstdev(deltas) > 0.2 or abs(r_dt) > 0.3 or abs(r_odb) > 0.3) else "near-constant"
    w(f"The free-float delta is **{verdict}**: mean {f(mean(deltas),3)} deg C, std {f(pstdev(deltas),3)}, "
      f"range {f(min(deltas),2)}..{f(max(deltas),2)}. Correlations: outdoor r={f(r_odb,3)}, "
      f"indoor-outdoor dT r={f(r_dt,3)}, solar r={f(r_ghi,3)}. "
      f"(P3-P5 localise the solver-convention mechanism behind this pattern.)")
    w("")
    w("_Generated by validation/freefloat_diagnostic.py (read-only; no engine/IDF/DB changes). Stdlib only._")
    w("")

    report = "\n".join(L)
    if args.stdout:
        print(report)
    else:
        REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        out = REPORTS_DIR / f"freefloat_diagnostic_{ts}.md"
        out.write_text(report, encoding="utf-8", newline="\n")
        print(f"[freefloat] free-float hours: {n_ff} ({100*n_ff/n_all:.1f}%); "
              f"mean delta {mean(deltas):.4f} std {pstdev(deltas):.4f} "
              f"range {min(deltas):.2f}..{max(deltas):.2f}")
        print(f"[freefloat] corr delta vs: outdoor {r_odb:.3f}  dT {r_dt:.3f}  solar {r_ghi:.3f}")
        print(f"[freefloat] wrote {out.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
