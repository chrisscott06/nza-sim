# HIEX Bridgwater — Report Baseline (dual-engine reference)

**Fixture:** `validation/fixtures/report_baseline_v1.yaml` — a clean copy of the frozen
`bridgewater_anchor_v2` with the experiment residue removed per the design note baseline
discipline:
- `gains.auxiliary.profiles` → `[]` (the residual **External lighting 1.5 W/m²** aux-toggle
  experiment; the 5 W/m² debug load was already removed in the earlier re-anchor).
- `building_config.interventions` → `[]` (the anchor's 8 playground interventions; the 22 HIEX
  items are added in P2 — the report baseline is the un-intervened building).

Everything else (envelope, systems_config_v40, occupancy, schedules, constructions, weather)
carried through byte-for-byte. `bridgewater_anchor_v2` is untouched and still yields EUI **132.6**
(regression invariant, verified). Removing the aux experiment drops EUI by exactly **6.6 kWh/m²**
in *both* engines (132.6→126.0 NZA; 117.7→111.1 EP), a clean sanity check that the only change is
the removed electrical load.

**GIA:** 4,216 m² (58.8 × 14.34 × 5). **Tariffs:** 28p/kWh elec, 7p/kWh gas.
**Weather:** GBR_ENG_Yeovilton TMYx 2011–2025.

## Annual — the reference numbers every intervention delta is read against

| Quantity | NZA-Sim | EnergyPlus | Δ (EP − NZA) |
|---|---:|---:|---:|
| **EUI** (kWh/m²·yr, gross) | **126.0** | **111.1** | −14.9 (−12%) |
| Space heating demand (MWh) | 87.7 | 96.4 | +8.7 (+10%) |
| Space cooling demand (MWh) | 101.1 | 130.3 | +29.2 (+29%) |
| DHW demand (MWh) | 257.3 | 257.3 (deterministic) | — |
| Electricity (MWh) | 373.8 | 342.4 | −31.4 |
| Gas (MWh) | 157.4 | 126.1 | −31.3 |

*The engine divergence (EP heating/cooling higher; fuel split differs) is the characterised
Brief 95 level offset — the named baseline-model residuals (thermal bridging, per-opening
permanent vents, un-blended mechanical ventilation), not tuned. The report headline uses NZA-Sim;
EP is the validation appendix (Table 3).*

## Monthly

**NZA-Sim** (envelope monthly heating-loss + gains shape, kWh — the v2.5 anchor's shape proxy):

| | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| Heating loss | 24307 | 20131 | 21130 | 16993 | 12862 | 8739 | 5932 | 7274 | 9589 | 12787 | 18695 | 21879 |
| Gains (int+solar) | 32547 | 31471 | 39713 | 45631 | 50068 | 51346 | 51796 | 46961 | 42221 | 37516 | 32618 | 31457 |

**EnergyPlus** (IdealLoads zone sensible demand, MWh):

| | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| Heating | 23.1 | 17.0 | 13.7 | 7.4 | 1.6 | 0.3 | 0.0 | 0.2 | 1.7 | 2.5 | 11.6 | 17.4 |
| Cooling | 0.5 | 1.3 | 4.0 | 9.5 | 15.1 | 24.2 | 30.8 | 20.9 | 14.6 | 7.2 | 1.8 | 0.5 |

## Provenance
- NZA-Sim: `node scripts/_brief93_anchor.mjs --fixture=validation/fixtures/report_baseline_v1.yaml` → `docs/report/data/nza_baseline.json` (engine v2.5, `_skipInterventions`).
- EnergyPlus: `generate_full_idf.py --fixture … && run_full.py --fixture …` (EP 25-2-0, IdealLoads demand + fixed-η post-processing) → `validation/energyplus/results/report_baseline_v1.json`.
- CRREM 2026 hotel target = **184.1 kWh/m²** · practical plateau ≈ **95 kWh/m²** (report landing-point references, per brief).
