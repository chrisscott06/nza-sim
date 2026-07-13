# T1 + T2 — EP-vs-NZA intervention deltas & monthly-shape validation

Read-only on both engines. `instantCalc.js` + `epjson_assembler.py` untouched; anchors
132.6 / 126.0 byte-identical. EP via the nza_engine matched-inputs pipeline (98-A2:
envelope-derived airtightness, NZA gains profiles, NZA DHW litres), mode="full",
EP 25-2-0. NZA baseline reproduces the anchor (126.0 / heat 87.7 / cool 101.1).
Scripts: `scripts/_t1_ep.py`, `scripts/_t1_nza.mjs`. Data: `docs/audit/T1_ep_runs.json`,
`T1_nza_runs.json`, `T2_nza_monthly.json`.

Baselines: **NZA** EUI 126.0 · heat 87.7 · cool 101.1 MWh · **EP** EUI 95.6 · heat 10.3 ·
cool 163.8 MWh.

---

## T1 — five interventions, NZA Δ vs EP Δ (isolated, vs each engine's own baseline)

| Measure | NZA ΔEUI | EP ΔEUI | NZA Δheat | EP Δheat | NZA Δcool | EP Δcool | EP validation |
|---|--:|--:|--:|--:|--:|--:|---|
| **Air permeability** q50 4.64→1.9 | −0.3 | −0.3 | **−9.6** | **−3.0** | **+6.3** | **+14.3** | ✅ both model it, directions agree |
| **Brise soleil** (3.5, 0.5 m S+W) | −0.1 | **0.0** | +2.1 | 0.0 | −3.9 | 0.0 | ❌ EP emits overhangs, zero solar effect |
| **Bedroom extract→MVHR** (vent-only) | +4.7 | **0.0** | −84.3 | 0.0 | +100.2 | 0.0 | ❌ not the EP-modelled vent system |
| **MVHR conversion** (2.1 full) | +4.7 | **0.0** | −84.3 | 0.0 | +100.2 | 0.0 | ❌ same + heating-share ≠ demand |
| **Setpoint widening** (3.3, 21→20 / 24→25) | −3.1 | −4.6 | **−18.6** | **−3.2** | **−18.9** | **−7.7** | ✅ both model it, directions agree |

Absolutes (EUI / heat / cool MWh): NZA base 126.0/87.7/101.1 · air-perm 125.7/78.1/107.4 ·
brise 125.9/89.8/97.2 · vent&2.1 130.7/3.4/201.3 · setpoint 122.9/69.1/82.2. EP base
95.6/10.3/163.8 · air-perm 95.3/7.3/178.1 · brise/vent/2.1 unchanged · setpoint 91.0/7.1/156.1.

**Only 2 of 5 measures are validatable in the EP pipeline. The three nulls are structural
EP-pipeline limitations, not real "no effect":**

1. **Brise soleil** — the geometry generator *does* emit `Shading:Overhang` (×10) +
   `Shading:Building:Detailed` (×10) with FullExterior + DetailedSkyDiffuse, but the EP
   run is byte-identical to baseline. This is the documented Brief 23 H3 limitation
   ("Shading:Overhang does not visibly reduce solar in EP for our model"). EP cannot
   currently validate any external-shading measure.
2. **Bedroom extract→MVHR / MVHR conversion** — `derive_systems_for_sim._primary()` maps
   only the **single highest-share ventilation system** to EP. Baseline primary =
   `vent_mvhr_gf_public` (1425 L/s, 80% recovery). The **bedroom extract (2208 L/s) and
   toilet extract (210 L/s) are not in the EP model at all.** Improving the bedroom
   extract patches a system EP doesn't see → ΔEP = 0. (2.1's heating-share swap also can't
   move heating *demand* — share affects delivered energy, not demand.)

**Where both engines DO model the measure, directions agree** (airtightness: heat↓ cool↑ in
both; setpoint widening: heat↓ cool↓ in both). Magnitudes differ, explained by the same
gaps traced in the physics review: NZA airtightness Δheat is 3× EP's (−9.6 vs −3.0) because
NZA carries the full envelope+ventilation loss; NZA setpoint Δ is larger (−18.6 vs −3.2)
because NZA holds a **continuous** 21/24 band whereas EP already runs an overnight setback
(21/18, 24/28), so fewer occupied hours are affected by the 1 °C widening.

### The unmatched input this exposed (bigger than any of the five)
"Matched inputs" (98-A2) matched airtightness, gains and DHW — but **not ventilation
topology and not the thermostat regime.** NZA models **3843 L/s** across three ventilation
systems; EP models **1425 L/s** (37%), one system. For a ventilation-dominated building
this alone is a first-order driver of the baseline heating gap (EP 10.3 vs NZA 87.7) —
compounding the EP overnight setback and the lumped-mass gain-banking difference. The five
interventions did not create this gap; they revealed it.

---

## T2 — modelled monthly electricity vs Bridgewater actual meter (2024)

Actual = half-hourly electricity import `hotel_electricity_2024.csv` (17,568 records,
Bridgewater Hotel project). **Shape only** — magnitudes are not comparable: actual HH total
1,124.8 MWh is ~2× the manual invoice (572.4 MWh, likely a kW-vs-kWh half-hour unit issue),
and both models (~360–374 MWh) sit well below even the invoice (models omit
communal/catering/external loads). Normalised to % of annual:

| Mon | Actual % | EP % | NZA % | Actual kWh | EP kWh | NZA kWh |
|---|--:|--:|--:|--:|--:|--:|
| Jan | 8.57 | 8.26 | 9.53 | 96,356 | 29,547 | 35,637 |
| Feb | 8.02 | 7.51 | 7.99 | 90,203 | 26,862 | 29,877 |
| Mar | 8.02 | 8.09 | 8.15 | 90,215 | 28,944 | 30,453 |
| Apr | 7.78 | 7.50 | 7.01 | 87,455 | 26,854 | 26,205 |
| May | 8.20 | 8.60 | 7.93 | 92,238 | 30,780 | 29,653 |
| Jun | 8.83 | 8.92 | 8.91 | 99,351 | 31,919 | 33,303 |
| Jul | 9.14 | 9.59 | 9.90 | 102,765 | 34,300 | 37,006 |
| Aug | 9.16 | 9.26 | 8.90 | 103,073 | 33,151 | 33,277 |
| Sep | 7.78 | 8.47 | 7.78 | 87,470 | 30,299 | 29,070 |
| Oct | 8.03 | 8.03 | 7.03 | 90,309 | 28,724 | 26,277 |
| Nov | 7.92 | 7.51 | 7.86 | 89,093 | 26,887 | 29,391 |
| Dec | 8.56 | 8.26 | 9.01 | 96,287 | 29,566 | 33,694 |

| Metric | Actual | EP | NZA |
|---|--:|--:|--:|
| Pearson r vs actual (shape) | — | **0.839** | **0.846** |
| Summer/Winter (JJA / DJF) | 1.079 | 1.156 | 1.044 |
| Peak : trough ratio | **1.18** | 1.28 | 1.41 |
| Jan / annual-mean (winter bump) | 1.028 | 0.991 | **1.144** |
| Peak / trough month | Aug / Apr | Jul / Apr | Jul / Apr |

### Reading
- **The real building is much flatter than both models** (peak:trough 1.18 vs EP 1.28, NZA
  1.41) and **gently summer-peaking** — a hotel with a large year-round base load, a modest
  summer cooling bump and a *mild* winter uptick (Jan/Dec sit above the spring/autumn
  troughs). Correlations are near-identical (0.839 vs 0.846) — indistinguishable on r alone.
- **The one discriminating feature is the winter bump.** The real meter shows Jan/Dec
  *above* the shoulder months (Jan/mean 1.028). **NZA reproduces a winter rise** (its VRF
  heating is electric, so winter electricity climbs — Jan/mean 1.144) — directionally
  correct but **overshooting**. **EP shows essentially no winter bump** (Jan/mean 0.991)
  because EP heating collapsed to 10.3 MWh, so it flattens winter to nothing — directionally
  wrong.
- On summer/winter *balance*, NZA (1.044) is closer to actual (1.079) than EP (1.156); on
  overall *amplitude*, EP (1.28) is closer to actual (1.18) than NZA (1.41).

### Verdict
**On the seasonal *character* — a building that uses more electricity in both summer
(cooling) and winter (electric heating) — the real meter sides with NZA's bimodal shape
over EP's summer-only shape.** The winter electricity rise is real in the data; NZA predicts
it (too strongly), EP misses it. But it is a **lean, not a proof**: r is a statistical tie,
both models are too peaky against a very flat real building, and the flatness itself is
partly a base-load-share artefact (the models omit communal/catering/external load that
would dilute both humps). The magnitude mismatch (models ≈ 33% of HH, ≈ 65% of invoice) is a
separate coverage/data-integrity issue, not a shape result.
