# Brief 81 P9 - Comparison report: bridgewater_box_v1

- **Generated:** 2026-06-08T09-49-07Z
- **Reference:** EnergyPlus 26.1.0-6f2e40d102
- **Candidate:** NZA-Sim v2.5 (instantCalc dynamic engine)
- **Fixture:** `bridgewater_box_v1` (GIA 100 m2, EPW GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw)

## Verdict: **FAIL**  (5/7 gated metrics within tolerance)

**Gated metrics outside tolerance:**

- Heating demand: 2.492 vs 3.278 (-24.0%, tol +/-15%)
- Cooling demand: 1.407 vs 0.677 (+107.9%, tol +/-15%)

> A FAIL here is a finding, not a defect in the harness: the comparator reports the unmodified engine outputs. Divergences feed the next validation rung (Brief 82), they are never tuned away.

**Notes:**

- Mech-vent (Brief 84a) compared like-for-like over EnergyPlus coil-run hours (4426 heating, 1173 cooling); the Brief-81 all-hours framing (NZA 1.282 vs EP 0.665 MWh) is retained as an info row.

## Gated metrics

| Metric | NZA-Sim | EnergyPlus | Delta | Tol | Result |
|---|---|---|---|---|---|
| EUI | 160.400 | 166.600 | -3.7% | +/-10% | PASS |
| Heating demand | 2.492 | 3.278 | -24.0% | +/-15% | FAIL |
| Cooling demand | 1.407 | 0.677 | +107.9% | +/-15% | FAIL |
| Fabric conduction (total, magnitudes) | 5.454 | 4.909 | +11.1% | +/-20% | PASS |
| Mech-vent loss (net, EP coil-run hours) | 0.919 | 0.887 | +3.6% | +/-15% | PASS |

### Monthly profile correlation

| Profile | Pearson r | Floor | Gated | Result |
|---|---|---|---|---|
| Monthly heating profile | 0.9933 | >= 0.85 | yes | PASS |
| Monthly cooling profile | 0.9446 | >= 0.85 | yes | PASS |
| Monthly zone temp | 0.9377 | >= 0.85 | no | PASS |

## Informational comparisons (not gated)

| Metric | NZA-Sim | EnergyPlus | Delta | Tol | Result |
|---|---|---|---|---|---|
| Mech-vent loss (all heating-degree hours, heat-balance domain) [info] | 1.282 | 0.665 | +92.9% | - | INFO |
| Mech-vent loss (gross, pre-recovery) [info] | 2.813 | 3.709 | -24.2% | - | INFO |
| Heat recovery [info] | 1.531 | 3.044 | -49.7% | - | INFO |
| Infiltration sensible loss | 4.808 | 4.877 | -1.4% | +/-20% | PASS |
| Transmitted solar (enclosure) | 3.443 | 3.395 | +1.4% | +/-20% | PASS |
| Glazing conduction loss | 1.399 | 0.880 | +58.9% | - | INFO |
| Internal gain: people | 1.073 | 1.073 | +0.0% | +/-5% | PASS |
| Internal gain: lighting | 2.555 | 2.555 | +0.0% | +/-5% | PASS |
| Internal gain: equipment | 3.650 | 3.650 | +0.0% | +/-5% | PASS |
| Fabric: external walls | 1.888 | 1.566 | +20.6% | +/-20% | FAIL |
| Fabric: roof | 1.457 | 1.271 | +14.7% | +/-20% | PASS |
| Fabric: ground floor | 1.936 | 1.884 | +2.8% | +/-20% | PASS |
| Fabric: thermal bridge | 0.173 | 0.188 | -8.3% | +/-20% | PASS |
| Zone mean air temp (absolute dC) | 22.308 | 21.814 | 0.49 dC | +/-1dC | PASS |

## Interpretation

- **Convention:** Delta = (NZA - EnergyPlus) / EnergyPlus. Fabric and infiltration losses are compared as magnitudes (EnergyPlus reports conduction negative = heat out).
- **Mech-vent mapping (Brief 84a like-for-like):** NZA's `losses.mech_ventilation` is a zone-balance loss-at-setpoint over ALL heating-degree hours; EnergyPlus's (OA sensible - heat recovery) is a coil OA load over coil-run hours only. These are different accounting objects (Brief 83 §3.4/§5.2), so the gated row now compares them LIKE-FOR-LIKE over EnergyPlus's coil-run hours (where both engines agree to ~3.7%, per-hour recovery ~75% each - no recovery-fraction bug). The Brief-81 all-hours framing is retained as an info row; the gross framing is shown for context.
- **Demand vs EUI:** the per-service heating/cooling demand split can diverge while the headline EUI still agrees, because fuel conversion, DHW and plug/lighting loads (which dominate this all-electric-plus-gas box) are shared closed-form inputs.
- **Monthly correlation** tests profile *shape* independently of absolute magnitude: a high r with a failing magnitude means the dynamics line up but the calibration differs.

_Source: `python validation/compare.py --fixture bridgewater_box_v1`. Inputs: P7 EnergyPlus JSON + P8 NZA-Sim JSON._
