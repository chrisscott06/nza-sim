#!/usr/bin/env python3
"""Brief 96 P2 — cost reconciliation: computed cost-plan total vs the doc's stated central.

For each of the 22 items: computed = Σ(qty×rate) × (1+on_cost%). Must match the benchmarks
doc's stated central within ±1% (rounding). Mismatch >1% is a STOP-and-write per item.
Writes docs/report/01_cost_reconciliation.md.

Run: validation/.venv/bin/python scripts/report/reconcile_costs.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from interventions import INTERVENTIONS, compute_cost_total  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "docs" / "report" / "01_cost_reconciliation.md"

rows, fails = [], []
for iv in INTERVENTIONS:
    c = iv["cost"]
    computed = compute_cost_total(c)
    doc = c["central"]
    if doc == 0:
        delta_pct = 0.0 if computed == 0 else 100.0
    else:
        delta_pct = (computed - doc) / doc * 100.0
    ok = abs(delta_pct) <= 1.0 or (doc == 0 and computed == 0)
    if not ok:
        fails.append((iv["ref"], iv["name"], doc, computed, delta_pct))
    rows.append((iv["ref"], iv["name"], iv["cls"], c["tier"], c["confidence"],
                 doc, computed, delta_pct, ok, f"{c['low']:,}–{c['high']:,}"))

lines = ["# Brief 96 P2 — Cost reconciliation (computed vs benchmarks-doc central)\n",
         "Computed = Σ(quantity × unit-rate) × (1 + on-cost %). On-costs (~40%) applied to "
         "NRM-tier (c) items only, per the doc. Target: |Δ| ≤ 1%.\n",
         "| Ref | Name | Cls | Tier | Conf | Doc central £ | Computed £ | Δ% | Range £ | ✓ |",
         "|---|---|:--:|:--:|:--:|--:|--:|--:|--:|:--:|"]
for r in rows:
    ref, name, cls, tier, conf, doc, comp, dp, ok, rng = r
    lines.append(f"| {ref} | {name[:44]} | {cls} | {tier} | {conf} | "
                 f"{doc:,} | {comp:,} | {dp:+.2f}% | {rng} | {'✓' if ok else '✗'} |")

total_doc = sum(r[5] for r in rows)
total_comp = sum(r[6] for r in rows)
lines.append(f"\n**Totals:** doc central £{total_doc:,} · computed £{total_comp:,} "
             f"({(total_comp-total_doc)/total_doc*100:+.2f}%). "
             f"**{len(rows)-len(fails)}/{len(rows)} within ±1%.**")
if fails:
    lines.append("\n## ⚠ STOP-and-write — reconciliation >1%")
    for ref, name, doc, comp, dp in fails:
        lines.append(f"- **{ref} {name}**: doc £{doc:,} vs computed £{comp:,} ({dp:+.2f}%)")

OUT.write_text("\n".join(lines) + "\n")
print(f"[reconcile] {len(rows)-len(fails)}/{len(rows)} within ±1%; wrote {OUT.relative_to(REPO)}")
for ref, name, doc, comp, dp in fails:
    print(f"  ✗ {ref} {name}: doc {doc} vs computed {comp} ({dp:+.2f}%)")
sys.exit(1 if fails else 0)
