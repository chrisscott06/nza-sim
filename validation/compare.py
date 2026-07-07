#!/usr/bin/env python3
"""compare.py - Brief 81 P9 EnergyPlus-vs-NZA-Sim comparison report.

Reads the two normalised result JSONs produced by P7 and P8:
  - validation/energyplus/results/<fixture>.json   (EnergyPlus reference)
  - validation/nza_sim/results/<fixture>.json       (NZA-Sim extract)

and diffs them field-by-field against the Brief 81 tolerances, writing a
markdown report to validation/reports/<fixture>_<ts>.md.

Stdlib only (json, math, argparse, datetime, pathlib). No network, no DB.

This is an HONEST first-pass comparator: it reports each metric's delta and
PASS/FAIL against its tolerance, and an overall verdict. It does NOT tune,
fudge, or hide divergences - surfacing them is the whole point of the harness.

Gated metrics (per brief) drive the overall verdict:
  EUI +/-10%, heating +/-15%, cooling +/-15%, fabric (aggregate) +/-20%,
  mech-vent +/-15%, monthly heating & cooling correlation >= 0.85.
Other rows (infiltration, solar, internal gains, zone temp, per-element fabric,
glazing) are INFO: reported with deltas but not part of the verdict.

Run:
  python validation/compare.py
  python validation/compare.py --fixture bridgewater_box_v1
  python validation/compare.py --stdout    # print report, don't write file
"""
import argparse
import csv
import json
import math
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
EP_RESULTS = SCRIPT_DIR / "energyplus" / "results"
NZA_RESULTS = SCRIPT_DIR / "nza_sim" / "results"
REPORTS_DIR = SCRIPT_DIR / "reports"
DEFAULT_FIXTURE = "bridgewater_box_v1"

# Gated tolerances (percent, except correlation which is a floor).
TOL = {
    "eui": 10.0,
    "heating": 15.0,
    "cooling": 15.0,
    "fabric": 20.0,
    "mech_vent": 15.0,
    "monthly_corr": 0.85,  # floor, not a percentage
}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def g(d, *path, default=None):
    """Safe nested getter."""
    cur = d
    for k in path:
        if not isinstance(cur, dict) or k not in cur:
            return default
        cur = cur[k]
    return cur


def pct_delta(nza, ep):
    """(nza - ep) / ep * 100, robust to None / zero baseline."""
    if nza is None or ep is None:
        return None
    if ep == 0:
        return None if nza == 0 else math.inf
    return (nza - ep) / ep * 100.0


def pearson(a, b):
    """Pearson correlation of two equal-length numeric lists."""
    pairs = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
    n = len(pairs)
    if n < 2:
        return None
    xs = [p[0] for p in pairs]
    ys = [p[1] for p in pairs]
    mx = sum(xs) / n
    my = sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in pairs)
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx == 0 or syy == 0:
        return None
    return sxy / math.sqrt(sxx * syy)


def fmt(v, nd=3):
    if v is None:
        return "n/a"
    if isinstance(v, float) and math.isinf(v):
        return "inf"
    return f"{v:.{nd}f}"


def mech_vent_like_for_like(fixture):
    """Brief 84a: pair the mech-vent metric LIKE-FOR-LIKE over EnergyPlus coil-run hours.

    NZA-Sim's `losses.mech_ventilation` is a zone-balance loss-at-setpoint accrued over EVERY
    heating-degree hour; EnergyPlus's `oa_sensible - heat_recovery` is a coil OA load accrued
    only when the ideal-loads coil runs (Brief 83 audit §3.4 / §5.2). The Brief-81 gated metric
    compared those two all-hours scalars (different accounting objects, different hour sets) and
    read +93 %. Brief 83 P4 proved that over EP's coil-run hours the two engines agree to ~3.7 %
    (per-hour recovery ~75 % both sides) -- there is no recovery-fraction bug. This helper sums
    each engine's net mech-vent over EP's coil-run hours, per side, reproducing that agreement.
    See docs/design-notes/84a_harness_likeforlike_fix.md.

    Reads the opt-in Brief 83 P4 per-hour CSVs (off by default; regenerate with
    `node validation/nza_sim/extract.mjs --mvhr-hourly` and
    `python validation/energyplus/extract_mvhr_hourly.py`).

    Returns (nza_mwh, ep_mwh, n_heat_hours, n_cool_hours), or (None, None, 0, 0) if the CSVs
    are absent (caller falls back to the all-hours metric with a visible note).
    """
    ep_csv = EP_RESULTS / f"{fixture}_mvhr_hourly.csv"
    nza_csv = NZA_RESULTS / f"{fixture}_mvhr_hourly.csv"
    if not (ep_csv.exists() and nza_csv.exists()):
        return None, None, 0, 0

    def rows_by_hour(path):
        with path.open(newline="", encoding="utf-8") as f:
            return {int(r["hour_index"]): r for r in csv.DictReader(f)}

    ep = rows_by_hour(ep_csv)
    nza = rows_by_hour(nza_csv)
    hours = sorted(set(ep) & set(nza))
    ep_kwh = nza_kwh = 0.0
    n_heat = n_cool = 0
    for h in hours:
        e, n = ep[h], nza[h]
        # heating side: EP heating coil active
        if float(e["supply_air_heating_kwh"]) > 0:
            ep_kwh += float(e["net_mech_vent_heating_kwh"])
            nza_kwh += float(n["net_mech_vent_heating_kwh"])
            n_heat += 1
        # cooling side: EP cooling coil active
        if float(e["supply_air_cooling_kwh"]) > 0:
            ep_kwh += float(e["net_mech_vent_cooling_kwh"])
            nza_kwh += float(n["net_mech_vent_cooling_kwh"])
            n_cool += 1
    return nza_kwh / 1000.0, ep_kwh / 1000.0, n_heat, n_cool


def verdict(ok):
    return "PASS" if ok else "FAIL"


# ---------------------------------------------------------------------------
# comparison build
# ---------------------------------------------------------------------------
def build_rows(ep, nza, fixture=DEFAULT_FIXTURE):
    """Return (gated_rows, info_rows, corr_rows, notes).

    Each value row: dict(label, nza, ep, delta_pct, tol, passed, gated, unit).
    """
    gated, info, notes = [], [], []

    # --- EUI (gated +/-10%) ---
    eui_nza = g(nza, "totals", "eui_kwh_per_m2_yr")
    eui_ep = g(ep, "totals", "eui_kwh_per_m2_yr")
    d = pct_delta(eui_nza, eui_ep)
    gated.append(dict(label="EUI", nza=eui_nza, ep=eui_ep, delta_pct=d,
                      tol=TOL["eui"], passed=(d is not None and abs(d) <= TOL["eui"]),
                      unit="kWh/m2"))

    # --- Heating demand (gated +/-15%): NZA net demand vs EP supply-air sensible ---
    h_nza = g(nza, "demand_mwh", "heating")
    h_ep = g(ep, "demand_mwh", "heating_supply_air_sensible")
    d = pct_delta(h_nza, h_ep)
    gated.append(dict(label="Heating demand", nza=h_nza, ep=h_ep, delta_pct=d,
                      tol=TOL["heating"], passed=(d is not None and abs(d) <= TOL["heating"]),
                      unit="MWh"))

    # --- Cooling demand (gated +/-15%) ---
    c_nza = g(nza, "demand_mwh", "cooling")
    c_ep = g(ep, "demand_mwh", "cooling_supply_air_sensible")
    d = pct_delta(c_nza, c_ep)
    gated.append(dict(label="Cooling demand", nza=c_nza, ep=c_ep, delta_pct=d,
                      tol=TOL["cooling"], passed=(d is not None and abs(d) <= TOL["cooling"]),
                      unit="MWh"))

    # --- Fabric conduction AGGREGATE (gated +/-20%), magnitudes, glazing excluded ---
    fabric_keys = ["external_wall_sum", "roof", "ground_floor", "thermal_bridge"]
    nza_fab = sum(abs(g(nza, "fabric_conduction_mwh", k, default=0) or 0) for k in fabric_keys)
    ep_fab = sum(abs(g(ep, "fabric_conduction_mwh", k, default=0) or 0) for k in fabric_keys)
    d = pct_delta(nza_fab, ep_fab)
    gated.append(dict(label="Fabric conduction (total, magnitudes)", nza=nza_fab, ep=ep_fab, delta_pct=d,
                      tol=TOL["fabric"], passed=(d is not None and abs(d) <= TOL["fabric"]),
                      unit="MWh"))

    # --- Mech ventilation (gated +/-15%) ---
    # Brief 84a: compare LIKE-FOR-LIKE over EnergyPlus coil-run hours. NZA's
    # losses.mech_ventilation is a zone-balance loss-at-setpoint over ALL heating-degree hours;
    # EP's (oa_sensible - heat_recovery) is a coil OA load over coil-run hours only (Brief 83
    # §3.4/§5.2). Comparing the all-hours scalars (the Brief-81 metric) mis-pairs domains and
    # reads +93%; over EP's coil-run hours the engines agree to ~3.7% (Brief 83 §7.2 / P4 -
    # per-hour recovery ~75% both sides, no recovery-fraction bug). See
    # docs/design-notes/84a_harness_likeforlike_fix.md.
    nza_mv_all = g(nza, "mech_ventilation_mwh", "loss")          # all heating-degree hours
    ep_oa_h = g(ep, "demand_mwh", "oa_sensible_heating", default=0) or 0
    ep_oa_c = g(ep, "demand_mwh", "oa_sensible_cooling", default=0) or 0
    ep_hr_h = g(ep, "demand_mwh", "heat_recovery_sensible_heating", default=0) or 0
    ep_hr_c = g(ep, "demand_mwh", "heat_recovery_sensible_cooling", default=0) or 0
    ep_mv_all = (ep_oa_h - ep_hr_h) + (ep_oa_c - ep_hr_c)       # coil-domain, all hours

    llf_nza, llf_ep, n_heat_h, n_cool_h = mech_vent_like_for_like(fixture)
    if llf_nza is not None:
        nza_mv, ep_mv_net = llf_nza, llf_ep
        mv_label = "Mech-vent loss (net, EP coil-run hours)"
        notes.append(f"Mech-vent (Brief 84a) compared like-for-like over EnergyPlus coil-run hours "
                     f"({n_heat_h} heating, {n_cool_h} cooling); the Brief-81 all-hours framing "
                     f"(NZA {fmt(nza_mv_all)} vs EP {fmt(ep_mv_all)} MWh) is retained as an info row.")
    else:
        nza_mv, ep_mv_net = nza_mv_all, ep_mv_all
        mv_label = "Mech-vent loss (net of recovery) [all-hours; like-for-like CSVs missing]"
        notes.append("Brief 84a like-for-like CSVs not found; mech-vent shown on the Brief-81 "
                     "all-hours (domain-mismatched) basis. Regenerate with "
                     "`extract.mjs --mvhr-hourly` + `extract_mvhr_hourly.py` to enable the "
                     "coil-run-hours comparison.")
    d = pct_delta(nza_mv, ep_mv_net)
    gated.append(dict(label=mv_label, nza=nza_mv, ep=ep_mv_net, delta_pct=d,
                      tol=TOL["mech_vent"], passed=(d is not None and abs(d) <= TOL["mech_vent"]),
                      unit="MWh"))

    # Info: the all-hours heat-balance-domain framing (the Brief-81 metric) - kept for honesty
    # (CLAUDE.md Rule 9: the all-hours vent loss is a real zone-balance term) when the gated row
    # has switched to the like-for-like basis.
    if llf_nza is not None:
        info.append(dict(label="Mech-vent loss (all heating-degree hours, heat-balance domain) [info]",
                         nza=nza_mv_all, ep=ep_mv_all, delta_pct=pct_delta(nza_mv_all, ep_mv_all),
                         tol=None, passed=None, unit="MWh"))
    # Gross framing for context (info only). Uses the all-hours NZA loss + recovery offset.
    nza_mv_gross = None
    ro = g(nza, "mech_ventilation_mwh", "recovery_offset")
    if nza_mv_all is not None and ro is not None:
        nza_mv_gross = nza_mv_all + ro
    ep_mv_gross = ep_oa_h + ep_oa_c
    info.append(dict(label="Mech-vent loss (gross, pre-recovery) [info]",
                     nza=nza_mv_gross, ep=ep_mv_gross,
                     delta_pct=pct_delta(nza_mv_gross, ep_mv_gross), tol=None, passed=None, unit="MWh"))
    info.append(dict(label="Heat recovery [info]", nza=ro, ep=ep_hr_h + ep_hr_c,
                     delta_pct=pct_delta(ro, ep_hr_h + ep_hr_c), tol=None, passed=None, unit="MWh"))

    # --- INFO: infiltration ---
    inf_nza = g(nza, "infiltration_mwh", "sensible_loss")
    inf_ep = g(ep, "infiltration_mwh", "sensible_loss")
    info.append(dict(label="Infiltration sensible loss", nza=inf_nza, ep=inf_ep,
                     delta_pct=pct_delta(inf_nza, inf_ep), tol=20.0,
                     passed=(pct_delta(inf_nza, inf_ep) is not None and abs(pct_delta(inf_nza, inf_ep)) <= 20.0),
                     unit="MWh"))

    # --- INFO: transmitted solar (enclosure total) ---
    sol_nza = g(nza, "windows_mwh", "transmitted_solar", "enclosure_total")
    sol_ep = g(ep, "windows_mwh", "transmitted_solar", "enclosure_total")
    info.append(dict(label="Transmitted solar (enclosure)", nza=sol_nza, ep=sol_ep,
                     delta_pct=pct_delta(sol_nza, sol_ep), tol=20.0,
                     passed=(pct_delta(sol_nza, sol_ep) is not None and abs(pct_delta(sol_nza, sol_ep)) <= 20.0),
                     unit="MWh"))

    # --- INFO: glazing conduction (NZA fabric element vs EP window heat loss) ---
    gl_nza = g(nza, "windows_mwh", "conduction_loss", "sum")
    gl_ep = g(ep, "windows_mwh", "heat_loss", "sum")
    info.append(dict(label="Glazing conduction loss", nza=gl_nza, ep=gl_ep,
                     delta_pct=pct_delta(gl_nza, gl_ep), tol=None, passed=None, unit="MWh"))

    # --- INFO: internal gains (shared inputs - should match) ---
    for label, key, epkey in [
        ("Internal gain: people", "people", "people_sensible"),
        ("Internal gain: lighting", "lighting", "lights"),
        ("Internal gain: equipment", "equipment", "equipment"),
    ]:
        nv = g(nza, "internal_gains_mwh", key)
        ev = g(ep, "internal_gains_mwh", epkey)
        dd = pct_delta(nv, ev)
        info.append(dict(label=label, nza=nv, ep=ev, delta_pct=dd, tol=5.0,
                         passed=(dd is not None and abs(dd) <= 5.0), unit="MWh"))

    # --- INFO: per-element fabric magnitudes ---
    for label, key in [("Fabric: external walls", "external_wall_sum"),
                        ("Fabric: roof", "roof"),
                        ("Fabric: ground floor", "ground_floor"),
                        ("Fabric: thermal bridge", "thermal_bridge")]:
        nv = abs(g(nza, "fabric_conduction_mwh", key, default=0) or 0)
        ev = abs(g(ep, "fabric_conduction_mwh", key, default=0) or 0)
        dd = pct_delta(nv, ev)
        info.append(dict(label=label, nza=nv, ep=ev, delta_pct=dd, tol=20.0,
                         passed=(dd is not None and abs(dd) <= 20.0), unit="MWh"))

    # --- INFO: zone mean air temp (absolute delta, not %) ---
    t_nza = g(nza, "zone_temperature", "mean_air_temp_annual_c")
    t_ep = g(ep, "zone_temperature", "mean_air_temp_annual_c")
    t_delta = None if (t_nza is None or t_ep is None) else (t_nza - t_ep)
    info.append(dict(label="Zone mean air temp (absolute dC)", nza=t_nza, ep=t_ep,
                     delta_pct=None, abs_delta=t_delta, tol=1.0,
                     passed=(t_delta is not None and abs(t_delta) <= 1.0), unit="degC"))

    # --- Monthly correlations (gated >= 0.85) ---
    corr_rows = []
    for label, nkey, ekey in [
        ("Monthly heating profile", "heating_supply_air_sensible_kwh", "heating_supply_air_sensible_kwh"),
        ("Monthly cooling profile", "cooling_supply_air_sensible_kwh", "cooling_supply_air_sensible_kwh"),
        ("Monthly zone temp", "zone_mean_air_temp_c", "zone_mean_air_temp_c"),
    ]:
        na = g(nza, "monthly", nkey, default=[])
        ea = g(ep, "monthly", ekey, default=[])
        r = pearson(na, ea)
        gate = label in ("Monthly heating profile", "Monthly cooling profile")
        corr_rows.append(dict(label=label, r=r, gated=gate,
                              passed=(r is not None and r >= TOL["monthly_corr"])))

    return gated, info, corr_rows, notes


# ---------------------------------------------------------------------------
# markdown rendering
# ---------------------------------------------------------------------------
def value_table(rows):
    out = ["| Metric | NZA-Sim | EnergyPlus | Delta | Tol | Result |",
           "|---|---|---|---|---|---|"]
    for r in rows:
        if r.get("abs_delta") is not None or (r.get("delta_pct") is None and "abs_delta" in r):
            delta_s = f"{fmt(r.get('abs_delta'), 2)} dC" if r.get("abs_delta") is not None else "n/a"
        else:
            dp = r.get("delta_pct")
            delta_s = "n/a" if dp is None else f"{dp:+.1f}%"
        tol = r.get("tol")
        tol_s = "-" if tol is None else (f"+/-{tol:g}%" if r["unit"] != "degC" else f"+/-{tol:g}dC")
        res = "INFO" if r.get("passed") is None else verdict(r["passed"])
        out.append(f"| {r['label']} | {fmt(r['nza'])} | {fmt(r['ep'])} | {delta_s} | {tol_s} | {res} |")
    return "\n".join(out)


def corr_table(rows):
    out = ["| Profile | Pearson r | Floor | Gated | Result |",
           "|---|---|---|---|---|"]
    for r in rows:
        res = verdict(r["passed"]) if r["r"] is not None else "n/a"
        out.append(f"| {r['label']} | {fmt(r['r'], 4)} | >= {TOL['monthly_corr']} | "
                   f"{'yes' if r['gated'] else 'no'} | {res} |")
    return "\n".join(out)


def render(fixture, ep, nza, gated, info, corr_rows, notes, ts):
    gated_fail = [r for r in gated if not r["passed"]]
    corr_gated = [r for r in corr_rows if r["gated"]]
    corr_fail = [r for r in corr_gated if not r["passed"]]
    overall_pass = not gated_fail and not corr_fail
    n_gated = len(gated) + len(corr_gated)
    n_pass = (len(gated) - len(gated_fail)) + (len(corr_gated) - len(corr_fail))

    ep_eng = g(ep, "engine", "name") or "EnergyPlus"
    ep_ver = g(ep, "engine", "version") or "?"
    nza_eng = g(nza, "engine", "name") or "NZA-Sim"
    nza_ver = g(nza, "engine", "version") or "?"

    lines = []
    lines.append(f"# Brief 81 P9 - Comparison report: {fixture}")
    lines.append("")
    lines.append(f"- **Generated:** {ts}")
    lines.append(f"- **Reference:** {ep_eng} {ep_ver}")
    lines.append(f"- **Candidate:** {nza_eng} {nza_ver}")
    lines.append(f"- **Fixture:** `{fixture}` (GIA {g(nza, 'geometry', 'gia_m2')} m2, "
                 f"EPW {g(nza, 'geometry', 'weather_file')})")
    lines.append("")
    lines.append(f"## Verdict: **{verdict(overall_pass)}**  ({n_pass}/{n_gated} gated metrics within tolerance)")
    lines.append("")
    if gated_fail or corr_fail:
        lines.append("**Gated metrics outside tolerance:**")
        lines.append("")
        for r in gated_fail:
            dp = r.get("delta_pct")
            lines.append(f"- {r['label']}: {fmt(r['nza'])} vs {fmt(r['ep'])} "
                         f"({'n/a' if dp is None else f'{dp:+.1f}%'}, tol +/-{r['tol']:g}%)")
        for r in corr_fail:
            lines.append(f"- {r['label']}: r={fmt(r['r'], 4)} (floor {TOL['monthly_corr']})")
        lines.append("")
    lines.append("> A FAIL here is a finding, not a defect in the harness: the comparator reports "
                 "the unmodified engine outputs. Divergences feed the next validation rung "
                 "(Brief 82), they are never tuned away.")
    lines.append("")
    if notes:
        lines.append("**Notes:**")
        lines.append("")
        for note in notes:
            lines.append(f"- {note}")
        lines.append("")

    lines.append("## Gated metrics")
    lines.append("")
    lines.append(value_table(gated))
    lines.append("")
    lines.append("### Monthly profile correlation")
    lines.append("")
    lines.append(corr_table(corr_rows))
    lines.append("")

    lines.append("## Informational comparisons (not gated)")
    lines.append("")
    lines.append(value_table(info))
    lines.append("")

    lines.append("## Interpretation")
    lines.append("")
    lines.append("- **Convention:** Delta = (NZA - EnergyPlus) / EnergyPlus. Fabric and infiltration "
                 "losses are compared as magnitudes (EnergyPlus reports conduction negative = heat out).")
    lines.append("- **Mech-vent mapping (Brief 84a like-for-like):** NZA's `losses.mech_ventilation` "
                 "is a zone-balance loss-at-setpoint over ALL heating-degree hours; EnergyPlus's "
                 "(OA sensible - heat recovery) is a coil OA load over coil-run hours only. These are "
                 "different accounting objects (Brief 83 §3.4/§5.2), so the gated row now compares them "
                 "LIKE-FOR-LIKE over EnergyPlus's coil-run hours (where both engines agree to ~3.7%, "
                 "per-hour recovery ~75% each - no recovery-fraction bug). The Brief-81 all-hours "
                 "framing is retained as an info row; the gross framing is shown for context.")
    lines.append("- **Demand vs EUI:** the per-service heating/cooling demand split can diverge while "
                 "the headline EUI still agrees, because fuel conversion, DHW and plug/lighting loads "
                 "(which dominate this all-electric-plus-gas box) are shared closed-form inputs.")
    lines.append("- **Monthly correlation** tests profile *shape* independently of absolute magnitude: "
                 "a high r with a failing magnitude means the dynamics line up but the calibration "
                 "differs.")
    lines.append("")
    lines.append(f"_Source: `python validation/compare.py --fixture {fixture}`. "
                 "Inputs: P7 EnergyPlus JSON + P8 NZA-Sim JSON._")
    lines.append("")
    return "\n".join(lines), overall_pass, n_pass, n_gated


# ---------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description="Brief 81 P9 EnergyPlus-vs-NZA comparison report")
    ap.add_argument("--fixture", default=DEFAULT_FIXTURE)
    ap.add_argument("--stdout", action="store_true", help="print report, do not write a file")
    args = ap.parse_args(argv)

    ep_path = EP_RESULTS / f"{args.fixture}.json"
    nza_path = NZA_RESULTS / f"{args.fixture}.json"
    for p in (ep_path, nza_path):
        if not p.exists():
            raise SystemExit(f"missing result file: {p}")

    ep = json.loads(ep_path.read_text(encoding="utf-8"))
    nza = json.loads(nza_path.read_text(encoding="utf-8"))

    gated, info, corr_rows, notes = build_rows(ep, nza, args.fixture)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    report, overall_pass, n_pass, n_gated = render(args.fixture, ep, nza, gated, info, corr_rows, notes, ts)

    if args.stdout:
        print(report)
    else:
        REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        out_path = REPORTS_DIR / f"{args.fixture}_{ts}.md"
        out_path.write_text(report, encoding="utf-8", newline="\n")
        rel = out_path.relative_to(REPO_ROOT)
        print(f"[compare] {args.fixture}: {verdict(overall_pass)} "
              f"({n_pass}/{n_gated} gated within tolerance)")
        print(f"[compare] wrote {rel}")

    return 0 if overall_pass else 0  # always exit 0: a FAIL verdict is a valid result


if __name__ == "__main__":
    raise SystemExit(main())
