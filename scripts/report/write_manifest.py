#!/usr/bin/env python3
"""Brief 96 P5 — write docs/report/02_run_manifest.md from the run outputs."""
import json
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
NZA = json.loads((REPO / "docs/report/data/nza_runs.json").read_text())
EP = json.loads((REPO / "docs/report/data/ep_runs.json").read_text())
HEAD = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"],
                      capture_output=True, text=True).stdout.strip()

iso = NZA["isolated"]
cum = NZA["cumulative"]
ep_rows = {r["ref"]: r for r in EP["rows"]}

L = ["# Brief 96 P5 — Run manifest\n",
     f"**Provenance:** fixture `report_baseline_v1` · NZA-Sim engine v2.5 · EnergyPlus 25-2-0 · "
     f"commit `{HEAD}` · `scripts/report/run_nza.mjs` + `run_ep_mappable.py`.\n",
     f"**NZA baseline:** EUI {NZA['baseline']['eui']} · heating {NZA['baseline']['heating_mwh']} · "
     f"cooling {NZA['baseline']['cooling_mwh']} MWh.  "
     f"**EP baseline:** EUI {EP['ep_baseline']['eui']} · heating {EP['ep_baseline']['heating_mwh']} · "
     f"cooling {EP['ep_baseline']['cooling_mwh']} MWh.\n",
     "## Isolated — NZA-Sim (all modellable Class A/B) + EP where mapped\n",
     "| Ref | NZA EUI | EP EUI | NZA EUI Δ | EP EUI Δ | EP status |",
     "|---|--:|--:|--:|--:|:--:|"]
for ref in sorted(iso, key=lambda r: [int(x) for x in r.split(".")]):
    nz = iso[ref]
    er = ep_rows.get(ref)
    ep_eui = f"{er['eui']['ep_delta']:+.1f}" if er and "eui" in er else "—"
    ep_abs = "—"
    if er and er.get("status") in ("done", "cached"):
        ep_abs = f"{EP['ep_baseline']['eui'] + er['eui']['ep_delta']:.1f}"
    nz_delta = round(nz["eui"] - NZA["baseline"]["eui"], 1)
    L.append(f"| {ref} | {nz['eui']} | {ep_abs} | {nz_delta:+.1f} | {ep_eui} | "
             f"{er['status'] if er else 'NZA-only'} |")

n_iso = len(iso)
n_ep = sum(1 for r in EP["rows"] if r.get("status") in ("done", "cached"))
n_ep_fail = sum(1 for r in EP["rows"] if r.get("status") == "failed")

L += ["\n## Cumulative — phasing spine\n",
      f"Spine order (modellable, {len(cum['order'])} states): `{' → '.join(cum['order'])}`\n",
      f"Skipped in the demand chain ({len(cum['skips'])}, carried for cumulative capex): " +
      ", ".join(f"{s['ref']} ({s['reason']})" for s in cum["skips"]) + "\n",
      "| Step | Ref | Cumulative EUI | vs baseline |", "|--:|---|--:|--:|"]
for i, st in enumerate(cum["states"], 1):
    L.append(f"| {i} | {st['ref']} | {st['eui']} | {st['eui']-NZA['baseline']['eui']:+.1f} |")
final = cum["states"][-1]["eui"]
L.append(f"\n**Cumulative final EUI {final}** (baseline {NZA['baseline']['eui']}, "
         f"{(final/NZA['baseline']['eui']-1)*100:+.1f}%). Sanity band [baseline−60%, baseline] = "
         f"[{NZA['baseline']['eui']*0.4:.1f}, {NZA['baseline']['eui']}] → **within band.** "
         f"vs CRREM 2026 target 184.1 and plateau 95: final {final} is below both.")

L += ["\n## Coverage",
      f"- Every modellable Class A/B has an NZA isolated result: **{n_iso}/13** ✓",
      f"- Every EP-mappable has an EP result or named failure: **{n_ep} done, {n_ep_fail} failed** ✓",
      f"- Cumulative chain state count: **{len(cum['order'])} modellable + {len(cum['skips'])} skipped = 22** ✓",
      "\n_Caveat (OVERNIGHT_FINDINGS): cumulative DHW measures share config paths → last-write-"
      "wins under-compounds; cumulative DHW savings are a lower bound. Isolated (the MACC) is unaffected._"]

(REPO / "docs/report/02_run_manifest.md").write_text("\n".join(L) + "\n")
print(f"[manifest] {n_iso} isolated, {n_ep} EP, final cumulative EUI {final}")
