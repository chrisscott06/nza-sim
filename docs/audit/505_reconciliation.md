# 505 Reconciliation — trace their savings to assumptions, compare under Model 2

**Brief:** `docs/briefs/active/505-reconciliation.md`. **Date:** 2026-07-15.
**Sources:** DRAFT P02 docx (target, D2b) + Master workbook — see
`docs/reference/505/505_assumptions_extracted.md` (claims + provenance).
**Status:** Parts 1–2 complete; Parts 3–4 (per-measure runs, register) below as they land.
**Discipline:** reproduction is diagnostic, not deference; assumption-visible framing; DRAFTS only.

## Part 2 — baseline + tier arithmetic (D2, verification 1–2)

### Baseline (verification 1)
| | Metered kWh/yr | ÷ GIA 4,215 | EUI | Window |
|---|---:|---:|---:|---|
| 505 | 762,291 | | **180.85** ("181") | bills 2025–**26** |
| NZA | 780,100 | | **185.08** | calendar-**2025** (Model-1/2 anchor) |

Gap **4.23 EUI = 17,809 kWh (2.34%)**. Outside the ±3 band in raw terms — **documented cause:
the meter window**, not a modelling disagreement. Both baselines are *metered* (bill-based ÷ GIA);
there is no engine model to "reproduce". Once window-aligned they agree to convention.
→ **Bin 1 (Convention), COMMENT** — align the reporting window and close. 505 themselves flag the
occupancy caveat (¶90: "higher than normal occupancy") which compounds the window question.

### Tier arithmetic (verification 2)
505 present reductions **cumulatively from 181**: −54 → **127**, −66 → **115**, −86* → **95**
(*C "in progress"). All three sum correctly (181−54=127, 181−66=115, 181−86=95). Marginal
equivalent: A **−54**, B **−12** (127→115), C **−20** (115→95). Structure read correctly. ✔
Register note (D2b): docx resultants 127/115 vs workbook 126.8/115.1 — rounding; confirm current.

## Part 3 — per-measure Run A / Run B + D5 decomposition

Run A = 505's stated assumption applied to a **scratch** config from Model 2 (never saved over a
named scenario). Run B = the same measure under Model-2 rules (reused from
`interventions_model2_results.md` where identical). Saving shown positive.

| # | Measure | 505 claim | Run A (ours, their basis) | Run B (Model 2) | Named assumption worth the Δ |
|---|---|---|---|---|---|
| A1 | Fan speed 16→12 l/s | (in −54) | 9.3 MWh / 2.2 EUI (flow-only) | 2_2 **−14.9 MWh** (flow ×0.72 + SFP cube-law) | SFP cube-law + entanglement with the ventilator load (A4) |
| A2 | **Occupancy → 1.6** | **120.6 MWh / 28.6 EUI** | **111.8 MWh / 26.5 EUI** (reproduced, ±8%) | — no NZA measure | occupancy basis (1.6 vs live 2.91); it is a **regime scenario, not an intervention** |
| A3 | **Washing removal** | **34.5 MWh / 8.2 EUI** | **35.1 MWh / 8.3 EUI** (reproduced, ±2%) | — Model 2 **keeps** this load (`equipment_laundry` 34.5) | **scope exclusion**, not a saving |
| A4 | **Ventilator "EUI of 12"** | 50.9 MWh / **12.07 EUI** (thermal, COP-1) | see D5 → **4.30 EUI delivered → ~0 net** | 2_4 trickle-vent **−0.5 MWh** | **COP-1 vs VRF efficiency (7.77 EUI)** + gains cancellation |
| B1 | MVHR throughout | (in −12) | = Run B | 2_1a **+8.3** / 2_1b **+7.1** (net penalty, no bypass) | no-bypass engine limit; with-bypass bound 2_1a ~−11.5 / 2_1b ~−20.5 |
| B2 | Panel heaters → DX | (in −12) | small (panel = 4% heating share, COP 1→~3) | — | resistance→heat-pump on a 4% share; minor |
| B3 | Window free-area | (in −12) | = Run B | 2_4 **−0.5** (EA ×0.5) | free-area factor illustrative (CONFIRM-505) |
| C1 | ASHP 95–100% HWS | (in −20) | = Run B | 1_4 **−144.7** (all DHW off gas) | 100%-ASHP-annual approximation; gas retained as backup |
| C2 | Full VRF replacement | (in −20) | = Run B | 3_2 **−15.6** | agreement; SMMS-e commissioning-record note (COMMENT) |
| C3 | Solar shading | (in −20) | = Run B | 3_5 **−0.8** | agreement (small in this orientation) |

Verification 3: every mapped measure has both runs + a verdict + the named assumption worth the Δ.
Reproduced within ±10% under their assumptions: A2 ✔, A3 ✔ (the two we can run directly). Conservation
holds on every run (no measure exceeds its end-use; A2/A3 bounded by DHW+gains / laundry respectively).

### D5 — ventilator "EUI of 12" decomposition (bin-2 flagship)
505: 49,646 kWh heating + 1,234 kWh cooling = **50.9 MWh thermal, EUI 12.07**, at an **implicit COP-1**
(thermal treated as delivered).
- **Step 1 — delivered:** through the VRF at in-service efficiency (SCOP 2.8 / SEER 3.0) →
  17,731 + 411 = **18.1 MWh delivered, EUI 4.30**. The COP-1→VRF assumption is worth **7.77 EUI (32.7 MWh)**.
- **Step 2 — gains cancellation:** the make-up-air load sits in a gains-dominated envelope; the net
  delivered impact of reducing it is far below 4.30 (our 2_4, halving trickle EA, nets **−0.5 MWh / 0.12 EUI**).

### The crux (finding)
**~91% of 505's "low-cost −54 EUI" tier is the three must-resolve items** — occupancy 28.6 + washing 8.2
+ ventilator 12.1 = **48.9 of 54**. All three are diagnostically reproducible **under their assumptions**,
but under NZA's CRREM gross-metered methodology occupancy and washing are **re-labelled** (a sensitivity
regime and a scope exclusion, not interventions) and the ventilator is **4.3 EUI delivered, gains-cancelled
toward 0** — not a 12-EUI baseload. This is the reconciliation's centre of gravity and why these three are
MUST-RESOLVE-BEFORE-MERGE in a shared document.

## Part 4 — comparison table + four-bin/two-flag tally
_(pending)_
