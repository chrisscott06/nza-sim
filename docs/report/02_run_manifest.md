# Brief 96 P5 — Run manifest

**Provenance:** fixture `report_baseline_v1` · NZA-Sim engine v2.5 · EnergyPlus 25-2-0 · commit `a616e24` · `scripts/report/run_nza.mjs` + `run_ep_mappable.py`.

**NZA baseline:** EUI 126 · heating 87.7 · cooling 101.1 MWh.  **EP baseline:** EUI 111.1 · heating 96.4 · cooling 130.3 MWh.

## Isolated — NZA-Sim (all modellable Class A/B) + EP where mapped

| Ref | NZA EUI | EP EUI | NZA EUI Δ | EP EUI Δ | EP status |
|---|--:|--:|--:|--:|:--:|
| 1.1 | 116.8 | 103.8 | -9.2 | -7.3 | done |
| 1.2 | 117.5 | 104.3 | -8.5 | -6.8 | done |
| 1.3 | 124.9 | 110.2 | -1.1 | -0.9 | done |
| 1.4 | 100 | 90.3 | -26.0 | -20.8 | done |
| 2.1 | 130.7 | 115.5 | +4.7 | +4.4 | done |
| 2.2 | 122.4 | 109.6 | -3.6 | -1.5 | done |
| 3.1 | 124.3 | 109.1 | -1.7 | -2.0 | done |
| 3.2 | 123.1 | 107.6 | -2.9 | -3.5 | done |
| 3.3 | 122.9 | 109.3 | -3.1 | -1.8 | done |
| 3.4 | 125 | 109.5 | -1.0 | -1.6 | done |
| 3.5 | 125.9 | 110.6 | -0.1 | -0.5 | done |
| 4.2 | 115.2 | 100.4 | -10.8 | -10.7 | done |
| 5.2 | 124.7 | 109.5 | -1.3 | -1.6 | done |

## Cumulative — phasing spine

Spine order (modellable, 13 states): `3.3 → 2.2 → 3.1 → 1.1 → 5.2 → 4.2 → 3.2 → 1.4 → 1.2 → 1.3 → 3.4 → 3.5 → 2.1`

Skipped in the demand chain (9, carried for cumulative capex): 5.3 (enabling), 4.1 (enabling), 5.1 (enabling), 6.1 (enabling), 5.4 (enabling), 2.3 (off_model), 4.3 (enabling), 1.5 (off_model), 7.1 (off_model)

| Step | Ref | Cumulative EUI | vs baseline |
|--:|---|--:|--:|
| 1 | 3.3 | 122.9 | -3.1 |
| 2 | 2.2 | 119.7 | -6.3 |
| 3 | 3.1 | 118.4 | -7.6 |
| 4 | 1.1 | 109.2 | -16.8 |
| 5 | 5.2 | 107.8 | -18.2 |
| 6 | 4.2 | 96.5 | -29.5 |
| 7 | 3.2 | 94.6 | -31.4 |
| 8 | 1.4 | 73.6 | -52.4 |
| 9 | 1.2 | 73.9 | -52.1 |
| 10 | 1.3 | 71.4 | -54.6 |
| 11 | 3.4 | 70.6 | -55.4 |
| 12 | 3.5 | 70.6 | -55.4 |
| 13 | 2.1 | 74.8 | -51.2 |

**Cumulative final EUI 74.8** (baseline 126, -40.6%). Sanity band [baseline−60%, baseline] = [50.4, 126] → **within band.** vs CRREM 2026 target 184.1 and plateau 95: final 74.8 is below both.

## Coverage
- Every modellable Class A/B has an NZA isolated result: **13/13** ✓
- Every EP-mappable has an EP result or named failure: **13 done, 0 failed** ✓
- Cumulative chain state count: **13 modellable + 9 skipped = 22** ✓

_Caveat (OVERNIGHT_FINDINGS): cumulative DHW measures share config paths → last-write-wins under-compounds; cumulative DHW savings are a lower bound. Isolated (the MACC) is unaffected._
