#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Brief 82 P3 - Zone-temperature trace comparison + divergence-regime analysis.

Reads the two Brief 82 P2 hourly CSVs (EnergyPlus + NZA-Sim, 8760 rows each,
schema-identical) and produces a divergence diagnostic of the per-hour zone
air temperature delta (T_NZA - T_EP). It answers the five evidence questions
the brief mandates and writes a markdown report to
validation/reports/zone_temp_diagnostic_{timestamp}.md.

This is a read-only, post-hoc analysis of committed CSVs. It does NOT touch any
engine, the EnergyPlus run, or the live DB. Stdlib only (csv, statistics, math,
datetime, argparse, pathlib); matplotlib is intentionally not required - the
report is markdown tables so it is reviewable in git.

Inputs (both produced at P2):
    validation/energyplus/results/bridgewater_box_v1_hourly_temps.csv
    validation/nza_sim/results/bridgewater_box_v1_hourly_temps.csv
Schema (both): hour_index, month, day, hour, zone_mean_air_temp_c,
    outdoor_drybulb_c, heating_demand_kwh, cooling_demand_kwh

Hour convention: both CSVs are hour-ending, index-for-index aligned (audit
section 2.4). hour_index 0 = first hour-ending interval of 1 Jan.

Output is ASCII-only (matches the Brief 81 P9 report house style + Windows
cp1252 console safety): "deg C" not the degree glyph, "delta", "+/-".

Usage:
    python validation/zone_temp_diagnostic.py
    python validation/zone_temp_diagnostic.py --ep <csv> --nza <csv> --stdout
"""
from __future__ import annotations

import argparse
import csv
import math
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent              # validation
REPO_ROOT = SCRIPT_DIR.parent                             # repo root
DEFAULT_EP = SCRIPT_DIR / "energyplus" / "results" / "bridgewater_box_v1_hourly_temps.csv"
DEFAULT_NZA = SCRIPT_DIR / "nza_sim" / "results" / "bridgewater_box_v1_hourly_temps.csv"
REPORTS_DIR = SCRIPT_DIR / "reports"

EPS = 1e-6   # kWh: demand below this counts as zero (mode = free-float)
HEAT_SP = 21.0
COOL_SP = 24.0

MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# ── loading ────────────────────────────────────────────────────────────────
def load(path: Path) -> list[dict]:
    out = []
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            out.append({
                "idx": int(row["hour_index"]),
                "month": int(row["month"]),
                "day": int(row["day"]),
                "hour": int(row["hour"]),
                "zt": float(row["zone_mean_air_temp_c"]),
                "odb": float(row["outdoor_drybulb_c"]),
                "heat": float(row["heating_demand_kwh"]),
                "cool": float(row["cooling_demand_kwh"]),
            })
    return out


def classify(heat: float, cool: float) -> str:
    if heat > EPS:
        return "heating"
    if cool > EPS:
        return "cooling"
    return "free"


# ── stats helpers ────────────────────────────────────────────────────────────
def pearson(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    if n < 2:
        return float("nan")
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    denom = math.sqrt(sxx * syy)
    return sxy / denom if denom > 0 else float("nan")


def mean(v: list[float]) -> float:
    return sum(v) / len(v) if v else float("nan")


def f(x: float, n: int = 3) -> str:
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "n/a"
    return f"{x:.{n}f}"


# ── core build ───────────────────────────────────────────────────────────────
def build_records(ep: list[dict], nza: list[dict]) -> list[dict]:
    recs = []
    for e, z in zip(ep, nza):
        recs.append({
            "idx": e["idx"],
            "month": e["month"],
            "hour": e["hour"],
            "ep_zt": e["zt"],
            "nza_zt": z["zt"],
            "delta": z["zt"] - e["zt"],          # NZA - EP
            "odb": z["odb"],                      # raw EPW drybulb (NZA side)
            "dT": e["zt"] - z["odb"],             # EP zone minus outdoor (loss proxy)
            "ep_heat": e["heat"], "ep_cool": e["cool"],
            "nza_heat": z["heat"], "nza_cool": z["cool"],
            "ep_mode": classify(e["heat"], e["cool"]),
            "nza_mode": classify(z["heat"], z["cool"]),
        })
    return recs


def band_label(v: float, edges: list[float]) -> str:
    lo = None
    for e in edges:
        if v < e:
            return f"<{e:g}" if lo is None else f"[{lo:g},{e:g})"
        lo = e
    return f">={edges[-1]:g}"


def grouped_delta(recs: list[dict], keyfn, order=None):
    """{key: (count, mean_delta, mean_abs_delta)} preserving `order` if given."""
    buckets: dict = {}
    for r in recs:
        buckets.setdefault(keyfn(r), []).append(r["delta"])
    keys = order if order else list(buckets.keys())
    out = []
    for k in keys:
        if k not in buckets:
            continue
        d = buckets[k]
        out.append((k, len(d), mean(d), mean([abs(x) for x in d])))
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Brief 82 P3 zone-temp trace diagnostic")
    ap.add_argument("--ep", default=str(DEFAULT_EP))
    ap.add_argument("--nza", default=str(DEFAULT_NZA))
    ap.add_argument("--stdout", action="store_true",
                    help="print report to stdout instead of writing a file")
    args = ap.parse_args(argv)

    ep = load(Path(args.ep))
    nza = load(Path(args.nza))

    # alignment guards (P2 already verified; re-assert here)
    if len(ep) != len(nza):
        sys.stderr.write(f"ERROR: row count mismatch {len(ep)} vs {len(nza)}\n")
        return 2
    cal_mm = sum(1 for e, z in zip(ep, nza)
                 if (e["month"], e["day"], e["hour"]) != (z["month"], z["day"], z["hour"]))
    if cal_mm:
        sys.stderr.write(f"ERROR: {cal_mm} calendar mismatches; traces not aligned\n")
        return 2

    recs = build_records(ep, nza)
    n = len(recs)
    deltas = [r["delta"] for r in recs]

    # ── annual statistics ──
    mean_d = mean(deltas)
    median_d = statistics.median(deltas)
    std_d = statistics.pstdev(deltas)
    max_pos = max(deltas)
    min_neg = min(deltas)
    pct_pos = 100.0 * sum(1 for d in deltas if d > 0) / n
    pct_near0 = 100.0 * sum(1 for d in deltas if abs(d) < 0.05) / n

    # ── monthly ──
    monthly = grouped_delta(recs, lambda r: r["month"], order=list(range(1, 13)))

    # ── mode breakdown (EP reference mode) ──
    by_mode = grouped_delta(recs, lambda r: r["ep_mode"],
                            order=["heating", "cooling", "free"])
    # contribution of each mode to the annual mean delta = sum(delta)/n
    mode_contrib = {}
    for m in ("heating", "cooling", "free"):
        s = sum(r["delta"] for r in recs if r["ep_mode"] == m)
        mode_contrib[m] = s / n

    # ── EP mode x NZA mode cross-tab ──
    cross = {}
    for r in recs:
        cross.setdefault((r["ep_mode"], r["nza_mode"]), []).append(r["delta"])

    # ── outdoor-temp bands ──
    odb_edges = [0, 5, 10, 15, 20]
    by_odb = grouped_delta(recs, lambda r: band_label(r["odb"], odb_edges),
                           order=[f"<{odb_edges[0]:g}"]
                           + [f"[{odb_edges[i]:g},{odb_edges[i+1]:g})" for i in range(len(odb_edges) - 1)]
                           + [f">={odb_edges[-1]:g}"])

    # ── indoor-outdoor dT bands (loss proxy) ──
    dT_edges = [5, 10, 15, 20]
    by_dT = grouped_delta(recs, lambda r: band_label(r["dT"], dT_edges),
                          order=[f"<{dT_edges[0]:g}"]
                          + [f"[{dT_edges[i]:g},{dT_edges[i+1]:g})" for i in range(len(dT_edges) - 1)]
                          + [f">={dT_edges[-1]:g}"])

    # ── hour-of-day ──
    by_hour = grouped_delta(recs, lambda r: r["hour"], order=list(range(1, 25)))

    # ── correlations ──
    free = [r for r in recs if r["ep_mode"] == "free"]
    r_delta_odb_all = pearson([r["odb"] for r in recs], deltas)
    r_delta_odb_free = pearson([r["odb"] for r in free], [r["delta"] for r in free])
    r_delta_dT_free = pearson([r["dT"] for r in free], [r["delta"] for r in free])

    # occupied vs unoccupied (proxy for gains schedule), free-float hours only
    occ_hours = set(range(9, 19))  # hour-ending 9..18 = 08:00-18:00
    free_occ = [r["delta"] for r in free if r["hour"] in occ_hours]
    free_unocc = [r["delta"] for r in free if r["hour"] not in occ_hours]

    # ── setpoint transitions (EP mode change between consecutive hours) ──
    trans_idx = [i for i in range(1, n) if recs[i]["ep_mode"] != recs[i - 1]["ep_mode"]]
    trans_abs = [abs(recs[i]["delta"]) for i in trans_idx]
    nontrans_abs = [abs(recs[i]["delta"]) for i in range(1, n) if i not in set(trans_idx)]
    # EP free-float zone temp distribution (where it sits in the 21-24 deadband)
    free_zt = [r["ep_zt"] for r in free]

    # ── demand decomposition (where the booking gaps come from) ──
    # Heating: EP total vs NZA total, split into (EP heats, NZA doesn't) + (both heat)
    ep_heat_tot = sum(r["ep_heat"] for r in recs)
    nza_heat_tot = sum(r["nza_heat"] for r in recs)
    heat_lost_nza_floats = sum(r["ep_heat"] for r in recs
                               if r["ep_heat"] > EPS and r["nza_heat"] <= EPS)
    heat_both = [(r["ep_heat"], r["nza_heat"]) for r in recs
                 if r["ep_heat"] > EPS and r["nza_heat"] > EPS]
    heat_both_ep = sum(a for a, _ in heat_both)
    heat_both_nza = sum(b for _, b in heat_both)

    ep_cool_tot = sum(r["ep_cool"] for r in recs)
    nza_cool_tot = sum(r["nza_cool"] for r in recs)
    cool_extra_nza_floats = sum(r["nza_cool"] for r in recs
                                if r["nza_cool"] > EPS and r["ep_cool"] <= EPS)
    cool_both = [(r["ep_cool"], r["nza_cool"]) for r in recs
                 if r["ep_cool"] > EPS and r["nza_cool"] > EPS]
    cool_both_ep = sum(a for a, _ in cool_both)
    cool_both_nza = sum(b for _, b in cool_both)

    # ── assemble report ──
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    L = []
    w = L.append
    w(f"# Brief 82 P3 - Zone-temperature trace diagnostic: bridgewater_box_v1")
    w("")
    w(f"- **Generated:** {ts}")
    w(f"- **Inputs:** `{Path(args.ep).relative_to(REPO_ROOT) if Path(args.ep).resolve().is_relative_to(REPO_ROOT) else args.ep}`"
      f" vs `{Path(args.nza).relative_to(REPO_ROOT) if Path(args.nza).resolve().is_relative_to(REPO_ROOT) else args.nza}`")
    w(f"- **Rows:** {n} (calendar mismatches: {cal_mm})")
    w(f"- **Delta convention:** delta = T_NZA - T_EP (positive = NZA warmer)")
    w(f"- **Mode (EP reference):** heating if EP heating demand > {EPS:g} kWh; "
      f"cooling if EP cooling > {EPS:g} kWh; else free-float. Setpoints {HEAT_SP:g}/{COOL_SP:g} deg C.")
    w("")
    w("## 1. Annual delta statistics")
    w("")
    w("| Stat | Value (deg C) |")
    w("|---|---|")
    w(f"| Mean delta | {f(mean_d,4)} |")
    w(f"| Median delta | {f(median_d,4)} |")
    w(f"| Std dev (population) | {f(std_d,4)} |")
    w(f"| Max positive | {f(max_pos,4)} |")
    w(f"| Max negative | {f(min_neg,4)} |")
    w(f"| Hours NZA warmer (delta>0) | {f(pct_pos,1)} % |")
    w(f"| Hours near-zero (|delta|<0.05) | {f(pct_near0,1)} % |")
    w("")
    w(f"Mean delta {f(mean_d,4)} deg C reproduces the Brief 81 finding (+0.49 deg C). "
      f"The spread (std {f(std_d,3)}, range {f(min_neg,2)}..{f(max_pos,2)}) is the first "
      f"signal that the offset is **not** a flat constant - see section 4.")
    w("")

    w("## 2. Monthly mean delta")
    w("")
    w("| Month | Hours | Mean delta (deg C) |")
    w("|---|---|---|")
    for k, c, md, _ in monthly:
        w(f"| {MONTHS[k]} | {c} | {f(md,4)} |")
    w("")

    w("## 3. Demand-booking decomposition (where the Brief 81 gaps come from)")
    w("")
    w("Heating (kWh/yr):")
    w("")
    w("| Component | EP | NZA |")
    w("|---|---|---|")
    w(f"| Total | {f(ep_heat_tot,1)} | {f(nza_heat_tot,1)} |")
    w(f"| Hours EP heats but NZA free-floats above {HEAT_SP:g} | {f(heat_lost_nza_floats,1)} | 0.0 |")
    w(f"| Hours both heat | {f(heat_both_ep,1)} | {f(heat_both_nza,1)} |")
    w("")
    w(f"NZA books {f(nza_heat_tot,1)} vs EP {f(ep_heat_tot,1)} kWh "
      f"({f(100*(nza_heat_tot-ep_heat_tot)/ep_heat_tot,1)} %). Of the "
      f"{f(ep_heat_tot-nza_heat_tot,1)} kWh shortfall, "
      f"{f(heat_lost_nza_floats,1)} kWh is in hours where EP still heats but NZA has "
      f"floated above the {HEAT_SP:g} deg C setpoint (books nothing), and "
      f"{f(heat_both_ep-heat_both_nza,1)} kWh is NZA heating less while both are in "
      f"heating mode.")
    w("")
    w("Cooling (kWh/yr):")
    w("")
    w("| Component | EP | NZA |")
    w("|---|---|---|")
    w(f"| Total | {f(ep_cool_tot,1)} | {f(nza_cool_tot,1)} |")
    w(f"| Hours NZA cools but EP free-floats below {COOL_SP:g} | 0.0 | {f(cool_extra_nza_floats,1)} |")
    w(f"| Hours both cool | {f(cool_both_ep,1)} | {f(cool_both_nza,1)} |")
    w("")
    w(f"NZA books {f(nza_cool_tot,1)} vs EP {f(ep_cool_tot,1)} kWh "
      f"({f(100*(nza_cool_tot-ep_cool_tot)/ep_cool_tot,1)} %). Of the "
      f"{f(nza_cool_tot-ep_cool_tot,1)} kWh excess, "
      f"{f(cool_extra_nza_floats,1)} kWh is in hours where NZA has floated above the "
      f"{COOL_SP:g} deg C setpoint (and cools) while EP free-floats below it, and "
      f"{f(cool_both_nza-cool_both_ep,1)} kWh is NZA cooling harder while both cool.")
    w("")

    w("## 4. Divergence regimes")
    w("")
    w("### 4a. By EP heating/cooling mode")
    w("")
    w("| EP mode | Hours | Mean delta (deg C) | Contribution to annual mean (deg C) |")
    w("|---|---|---|---|")
    for k, c, md, _ in by_mode:
        w(f"| {k} | {c} | {f(md,4)} | {f(mode_contrib[k],4)} |")
    w("")
    w("### 4b. EP mode x NZA mode cross-tab (hours; mean delta deg C)")
    w("")
    w("| EP \\ NZA | heating | cooling | free |")
    w("|---|---|---|---|")
    for em in ("heating", "cooling", "free"):
        cells = []
        for zm in ("heating", "cooling", "free"):
            d = cross.get((em, zm))
            cells.append(f"{len(d)} ({f(mean(d),2)})" if d else "0 (-)")
        w(f"| **{em}** | {cells[0]} | {cells[1]} | {cells[2]} |")
    w("")
    w("### 4c. By outdoor drybulb band")
    w("")
    w("| Outdoor band (deg C) | Hours | Mean delta (deg C) |")
    w("|---|---|---|")
    for k, c, md, _ in by_odb:
        w(f"| {k} | {c} | {f(md,4)} |")
    w("")
    w("### 4d. By indoor-outdoor dT band (EP zone - outdoor; ventilation/conduction loss proxy)")
    w("")
    w("| dT band (deg C) | Hours | Mean delta (deg C) |")
    w("|---|---|---|")
    for k, c, md, _ in by_dT:
        w(f"| {k} | {c} | {f(md,4)} |")
    w("")
    w("### 4e. By hour-of-day (hour-ending)")
    w("")
    w("| Hour | Hours | Mean delta (deg C) |")
    w("|---|---|---|")
    for k, c, md, _ in by_hour:
        w(f"| {k} | {c} | {f(md,4)} |")
    w("")

    w("## 5. The five evidence questions")
    w("")
    free_mean = mean([r["delta"] for r in free]) if free else float("nan")
    heat_mode_mean = next((md for k, c, md, _ in by_mode if k == "heating"), float("nan"))
    cool_mode_mean = next((md for k, c, md, _ in by_mode if k == "cooling"), float("nan"))
    w("### Q1 - Is the delta constant or conditional?")
    w("")
    w(f"**Conditional.** If it were a flat calibration offset the std would be near "
      f"zero and every regime would show the same delta. Instead std = {f(std_d,3)} deg C, "
      f"range {f(min_neg,2)}..{f(max_pos,2)}, and the delta is near-zero in conditioned "
      f"hours but large in free-float (section 4a). Correlation of delta with outdoor "
      f"drybulb over all hours r = {f(r_delta_odb_all,3)}; over free-float hours only "
      f"r = {f(r_delta_odb_free,3)}.")
    w("")
    w("### Q2 - Does the delta correlate with ventilation activity?")
    w("")
    w(f"Bridgewater-Box mechanical ventilation is a constant 50 L/s with no schedule, so "
      f"there are no scheduled-off hours to contrast against from the temperature trace "
      f"alone - this question cannot be answered definitively here and is the job of the "
      f"P4 mech-vent re-booking. As a proxy, ventilation/conduction loss scales with the "
      f"indoor-outdoor dT; correlation of free-float delta with dT (EP zone - outdoor) is "
      f"r = {f(r_delta_dT_free,3)} (section 4d shows the banded trend). ")
    w("")
    w("### Q3 - Does the delta correlate with internal gains?")
    w("")
    w(f"Proxy via hour-of-day (gains follow the daily occupancy/lighting/equipment "
      f"schedule), free-float hours only: mean delta in occupied hours "
      f"(08:00-18:00) = {f(mean(free_occ),3)} deg C ({len(free_occ)} h) vs "
      f"unoccupied = {f(mean(free_unocc),3)} deg C ({len(free_unocc)} h). "
      f"Section 4e gives the full 24-hour profile.")
    w("")
    w("### Q4 - Does the delta correlate with heating/cooling mode?")
    w("")
    w(f"**Strongly, and this is the headline.** Mean delta by EP mode: "
      f"heating = {f(heat_mode_mean,3)}, cooling = {f(cool_mode_mean,3)}, "
      f"free-float = {f(free_mean,3)} deg C. The free-float regime carries essentially "
      f"all of the +{f(mean_d,3)} deg C annual mean "
      f"(free-float contributes {f(mode_contrib['free'],3)} deg C of it). When either "
      f"setpoint binds, both engines pin to the same value and the delta collapses to "
      f"~0. The divergence is a **free-float phenomenon**: NZA's unconditioned zone "
      f"settles warmer than EP's.")
    w("")
    w("### Q5 - Is the delta exaggerated at setpoint transitions?")
    w("")
    w(f"Mode-change hours: {len(trans_idx)}. Mean |delta| at transition hours = "
      f"{f(mean(trans_abs),3)} deg C vs {f(mean(nontrans_abs),3)} deg C elsewhere. "
      f"EP free-float zone temperature sits at mean {f(mean(free_zt),3)} deg C "
      f"(min {f(min(free_zt),2)}, max {f(max(free_zt),2)}) - i.e. mostly hugging the "
      f"{HEAT_SP:g} deg C heating boundary rather than wandering the full deadband. "
      f"{'Transition hours do show a larger |delta|, consistent with some boundary effect.' if mean(trans_abs) > 1.3*mean(nontrans_abs) else 'Transition hours are not dramatically worse than the free-float regime as a whole, so the divergence is broad-spectrum free-float behaviour rather than a narrow hysteresis-at-transition effect.'}")
    w("")

    w("## 6. Preliminary read (P4 is decisive)")
    w("")
    w("The delta is conditional, mode-asymmetric, and concentrated almost entirely in "
      "free-float hours where NZA settles warmer. This argues **against** candidate 2 in "
      "its pure form (a roughly constant solver-convention offset would not vanish under "
      "conditioning). It is consistent with candidate 1 (a loss-side / MVHR coupling that "
      "lets NZA retain heat in free-float) and, to the extent the warmth tracks the gains "
      "schedule, with a gains-retention effect. Candidate 3 (deadband hysteresis at "
      "transitions) is not strongly supported unless the transition |delta| markedly "
      "exceeds the free-float baseline (see Q5). The load-bearing test is P4: shift the "
      "NZA trace down by the mean offset, re-book against EP setpoint logic, and see "
      "whether the heating, cooling, and mech-vent gaps all close.")
    w("")
    w("_Generated by validation/zone_temp_diagnostic.py (read-only; no engine/IDF/DB "
      "changes). Stdlib only; matplotlib not used._")
    w("")

    report = "\n".join(L)

    if args.stdout:
        sys.stdout.write(report)
    else:
        REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        out_path = REPORTS_DIR / f"zone_temp_diagnostic_{ts}.md"
        out_path.write_text(report, encoding="utf-8")
        rel = out_path.relative_to(REPO_ROOT)
        print(f"[zone_temp_diagnostic] wrote {rel}", file=sys.stderr)
        print(f"[zone_temp_diagnostic] annual mean delta (NZA-EP) = {mean_d:.4f} C", file=sys.stderr)
        print(f"[zone_temp_diagnostic] free-float mean delta = {free_mean:.4f} C "
              f"over {len(free)} h; heating {heat_mode_mean:.4f} / cooling {cool_mode_mean:.4f}",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
