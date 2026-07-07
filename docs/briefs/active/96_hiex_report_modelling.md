# Brief 96: HIEX Report Modelling — 22 Interventions, Four-Metric Table, CSV/Excel Export

**Canonical design note (wins over this brief):** Notion — "Design note: HIEX intervention modelling methods + report metrics" (NZA-Sim product page). Every Class assignment, scalar, formula, metric definition, measure life, and tariff in this brief comes from that note.
**Source data:** `HIEX_Intervention_Spec_and_Cost_Benchmarks.md` — Chris will place it at `docs/report/HIEX_Intervention_Spec_and_Cost_Benchmarks.md`; if absent, STOP and report.

## UNATTENDED MODE

Chris is asleep. No human gates tonight. Rules:
- Any escalation trigger → STOP that thread, write findings to `docs/report/OVERNIGHT_FINDINGS.md`, continue other independent threads if safe, otherwise stop cleanly. Never guess past an ambiguity.
- No browser verification required anywhere in this brief — every check is script-runnable. Do not block on UI.
- Commit and push after every Part. If the session dies, the morning state must be reconstructable from git.

## BEFORE DOING ANYTHING

1. Confirm receipt: quote title + Goal.
2. **Precondition:** Brief 95 P9 is complete on `chris/ep-interventions-backend` (archived brief, fixture invariant passed). If P7–P9 are unfinished: STOP, report status, do not start Brief 96.
3. Branch: `git checkout -b chris/hiex-report-modelling` from the head of `chris/ep-interventions-backend` (stacked; nothing merges to main tonight).
4. Land this brief at `docs/briefs/active/96_hiex_report_modelling.md` as Part 1's first commit. Read CLAUDE.md, STATUS.md, reconcile.
5. Read the design note's content as mirrored in this brief's tables; where this brief is silent, the note decides; where both are silent, STOP-and-write.

## Goal

By morning: all 22 HIEX interventions exist as library items with cost plans seeded from the benchmarks document; the report baseline is frozen as a clean fixture; every modellable intervention has isolated results and the phasing-spine strategy has cumulative results; a metrics engine computes the report table; and `docs/report/` contains CSV + XLSX exports Chris can drop into PowerPoint.

## Scope

**IN:** clean report baseline fixture · 22 library items (patches per Class) · cost-plan seeding into the existing cost data model (programmatic — groups/lines/on-costs) · Class B scalars + Class C off-model calculators per the note · metrics engine · isolated + cumulative runs (NZA-Sim) · EP isolated runs for mappable interventions (validation appendix) · CSV + XLSX export · assumptions README.

**OUT:** the 91b cost-editor UI · any merge to main · engine changes (`instantCalc.js` untouched; fixture invariant at close) · NPV/discounting · report prose · new UI beyond what exists.

## Decisions already agreed

1. Baseline = **new fixture `report_baseline_v1`**: export the Bridgewater config with the 5 W/m² debug aux load (and any experiment residue) removed. Commit it. Run both engines once on it — those are the reference numbers. `bridgewater_anchor_v2` stays untouched as the regression fixture.
2. Classes per the design note: **A** direct patches (1.1, 1.4, 2.1, 2.2, 2.3, 3.3, 3.4, 3.5, 4.2, 5.2) · **B** derived scalars (1.2 WWHR −18% DHW [12–25]; 1.3 preheat COP +0.4 [+0.3/+0.5]; 3.1 three-scenario band none/+0.4/managed-3.9, central reported; 3.2 energy −20% via derated rated-SCOP substitution) · **C** off-model (1.5 interlink monthly-coincidence formula; 3.2 refrigerant ≈4.7 tCO₂e/yr; 7.1 PV 47.5 MWh/yr, 85% self-consumption, EUI unchanged) · **D** enabling/£0 (4.1, 4.3, 5.1, 5.3, 5.4-in-6.1, 6.1 — capex only, no energy claim).
3. Double-count guard: cumulative mode computes in the phasing-spine order; 3.2's saving computes against the post-3.1 state.
4. Metrics: EUI Δ (GIA 4,215, gross demand — PV excluded from EUI) · lifetime tCO₂e to 2050 (electricity on the FES grid-intensity series in `benchmarks.py` — NOT the CRREM target pathway; gas 0.18316 constant; capped at measure life: controls/settings 10y, plant 15y, PV 25y, fabric 30y) · £/tCO₂e = central capex ÷ lifetime tonnes · simple payback = central capex ÷ year-1 £ saving at flat 28p elec / 7p gas.
5. Costs seed verbatim from the benchmarks doc: quantity × unit × rate lines + the stated on-cost %s for NRM-tier items; central/low/high carried; the four L-flags surface as "allowance only".

---

## PART 1: Land brief + clean report baseline

1. Land brief; verify the benchmarks doc is at `docs/report/`.
2. Build the clean config: strip the debug aux load (empty `gains.auxiliary.profiles`) from a COPY of the current Bridgewater config — via the fixture-export path, not by editing Chris's live DB. Export as `validation/fixtures/report_baseline_v1.yaml` with a header stating provenance + what was removed.
3. Run both engines on it: NZA-Sim via the fixture anchor; EP via the P2 pipeline. Record the dual-engine baseline table (annual + monthly) in `docs/report/00_baseline.md`.
4. Commit: `Brief 96 P1: report_baseline_v1 frozen + dual-engine baseline`.

**Falsifiable:** fixture committed; baseline doc has both engines' full breakdowns; `bridgewater_anchor_v2` output unchanged (132.6).

## PART 2: 22 library items + cost plans seeded

1. Create all 22 as library items via the strategy/library data model (script or API — not by hand in the UI): patches per Class A/B; Class C and D items carry no engine patches but exist for cost/metric purposes, flagged `off_model` / `enabling`.
2. Seed each item's cost plan into the existing cost data model: line items exactly as the benchmarks doc states them (quantity × unit × rate), on-costs applied to NRM-tier items at the doc's percentages, central/low/high stored, confidence flag stored.
3. Reconciliation check: for each of the 22, computed cost-plan total must match the doc's stated central total within rounding (±1%). Mismatch → STOP-and-write for that item, continue others.
4. Commit: `Brief 96 P2: 22 HIEX library items + cost plans seeded (totals reconciled)`.

**Falsifiable:** a generated `docs/report/01_cost_reconciliation.md` table: 22 rows, doc total vs computed total vs Δ, all ≤1% (or STOP-noted).

## PART 3: Class B scalars + Class C calculators

1. Class B: implement the four derived-scalar patches exactly per the note (WWHR as DHW demand scalar 0.82; 1.3 as +0.4 on the preheat stage COP only; 3.1 as three variants of one library item — model the CENTRAL as the stack member, store none/strong as sensitivity results; 3.2 with the anti-double-count basis).
2. Class C: `scripts/report/offmodel.py` — interlink monthly-coincidence calc reading the baseline's monthly cooling + DHW profile; refrigerant-carbon formula; PV formula with the FES-pathway carbon valuation. Each function returns (annual kWh/£ effect, lifetime tCO₂e, basis string).
3. Unit tests: WWHR scalar reaches the DHW calc; 1.3 touches only the preheat stage; interlink usable ≤ recoverable and ≤ preheat demand every month; PV EUI contribution = 0.
4. Commit: `Brief 96 P3: Class B scalars + Class C off-model calculators (tested)`.

## PART 4: Metrics engine

`scripts/report/metrics.py`: for any (baseline results, intervention results | off-model tuple, cost plan) → the row: capex central (+low/high) · annual kWh saved (elec/gas split) · annual £ saved (28p/7p) · EUI Δ · lifetime tCO₂e to 2050 (FES series, gas constant, life-capped per the table) · £/tCO₂e · simple payback. Class D rows: capex only, metrics em-dashed. Unit tests on 3 hand-computed cases (one Class A, one C, one D).

Commit: `Brief 96 P4: metrics engine (hand-check verified)`.

**Falsifiable:** the three hand-computed rows match the engine to the penny/decimal in the test output.

## PART 5: Runs — isolated + cumulative, both engines where mappable

1. NZA-Sim: isolated run per modellable intervention (Classes A+B) against `report_baseline_v1`; cumulative run of the phasing-spine strategy (the doc's dependency-spine order; Class C/D skipped with skips recorded; 3.2-after-3.1 ordering enforced).
2. EP: isolated runs for every EP-mappable intervention via the Brief 95 batch runner (config-hash cache makes re-runs free). These populate a VALIDATION appendix, not the headline table.
3. All runs recorded with provenance (fixture, commit, engine, hash).
4. Commit: `Brief 96 P5: isolated + cumulative runs complete (NZA all, EP mappable)`.

**Falsifiable:** run manifest in `docs/report/02_run_manifest.md`: every Class A/B item has an NZA isolated result; every EP-mappable item has an EP result or a named failure; cumulative chain state count correct.

## PART 6: The export — CSV + XLSX

1. `docs/report/HIEX_intervention_metrics.csv` (and `.xlsx`, openpyxl, one sheet per table):
   - **Table 1 — Isolated (the MACC table):** one row per intervention (all 22): ref · name · theme · category · class · confidence/tier · capex central £ (+ low–high) · annual elec kWh Δ · annual gas kWh Δ · annual £ saving · EUI Δ kWh/m² · lifetime tCO₂e (life-capped) · £/tCO₂e · simple payback yrs · basis/assumption string (one line, from the design note) · flags (allowance-only / off-model / enabling / EP-validated ✓).
   - **Table 2 — Cumulative (phasing spine):** the stack in order with running totals: cumulative capex · cumulative EUI · cumulative annual £ · cumulative lifetime tCO₂e · resulting EUI vs CRREM 2026 target (184.1) and vs the 95 plateau.
   - **Table 3 — EP validation appendix:** mappable interventions, NZA Δ | EP Δ | Δ% on EUI/heating/cooling.
2. Number formatting sane for PowerPoint paste (0 dp £, 1 dp EUI, 1 dp payback). Sorted Table 1 by £/tCO₂e ascending (MACC order), Class D at bottom.
3. `docs/report/03_assumptions_README.md`: tariffs, measure lives, FES series version, the Class B/C bases verbatim, the four L-flags, and the honest-limits paragraph from the design note.
4. Commit: `Brief 96 P6: report tables exported (CSV + XLSX) + assumptions README`.

**Falsifiable:** files exist, open, row counts = 22 / spine-length / mappable-count; spot-check three rows against the metrics-engine test values.

## PART 7: Close

1. Fixture invariants: `bridgewater_anchor_v2` byte-identical AND `report_baseline_v1` re-run byte-identical.
2. STATUS.md, archive brief, current.md, push, open PR (stacked on the 95 PR). NO merge.
3. `docs/report/OVERNIGHT_FINDINGS.md` finalised: what completed, what stopped and why, the headline numbers (best £/tCO₂e, cumulative EUI landing point vs 184.1/95), anything Chris must sanity-check before the table goes near the report.

## MUST NOT
No merge to main · no engine/physics edits · no cost-editor UI work · no edits to Chris's live DB (fixture-export path only) · no invented cost lines or scalars (doc + note only) · no silent skips — every skip named in the manifest · no blocking on browser checks.

## Escalate (stop-and-write)
Cost reconciliation >1% on any item · a Class A patch that doesn't reach the engine/IDF · metrics hand-check mismatch · cumulative chain producing a result outside [baseline−60%, baseline] EUI (sanity band) · anything the design note doesn't cover.

## Independent review (mandatory)
Morning, Claude Chat: metrics engine vs three hand-computed rows · cost reconciliation table · run manifest · the exported Table 1 read against the design note's bases · both fixture invariants. Reviewed together with the 95 PR before any merge.
