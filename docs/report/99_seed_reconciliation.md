# Brief 99 P3 — HIEX interventions seed reconciliation

All 22 HIEX report interventions seeded to LIVE Bridgewater (project `12cf7cc4-9bdc-41bc-ab4e-24e044fbad9d`) via API PUT `/{id}/building`. Cost totals vs report central, ±1%.

| ref | class | flag | report central £ | seeded total £ | Δ% | patches |
|---|---|---|---|---|---|---|
| 1.1 | A | simulated | 8,280 | 8,280 | +0.00% | 1 |
| 1.2 | B | derived | 22,000 | 22,155 | +0.70% | 1 |
| 1.3 | B | derived | 4,550 | 4,550 | +0.00% | 1 |
| 1.4 | A | simulated | 105,000 | 105,700 | +0.67% | 3 |
| 1.5 | C | off_model | 25,000 | 25,000 | +0.00% | 0 |
| 2.1 | A | simulated | 99,000 | 98,840 | -0.16% | 3 |
| 2.2 | A | simulated | 2,600 | 2,600 | +0.00% | 2 |
| 2.3 | A | off_model | 0 | 0 | +0.00% | 0 |
| 3.1 | B | derived | 8,100 | 8,100 | +0.00% | 2 |
| 3.2 | B | derived | 375,000 | 376,600 | +0.43% | 2 |
| 3.3 | A | simulated | 0 | 0 | +0.00% | 4 |
| 3.4 | A | simulated | 8,685 | 8,685 | +0.00% | 1 |
| 3.5 | A | simulated | 23,100 | 23,100 | +0.00% | 2 |
| 4.1 | D | enabling | 4,500 | 4,500 | +0.00% | 0 |
| 4.2 | A | simulated | 19,320 | 19,320 | +0.00% | 1 |
| 4.3 | D | enabling | 0 | 0 | +0.00% | 0 |
| 5.1 | D | enabling | 2,300 | 2,300 | +0.00% | 0 |
| 5.2 | A | simulated | 20,100 | 20,100 | +0.00% | 1 |
| 5.3 | D | enabling | 13,300 | 13,300 | +0.00% | 0 |
| 5.4 | D | enabling | 0 | 0 | +0.00% | 0 |
| 6.1 | D | enabling | 3,000 | 3,000 | +0.00% | 0 |
| 7.1 | C | off_model | 55,000 | 55,000 | +0.00% | 0 |

**22/22 reconciled within ±1%.** No failures.

Class flags: A→simulated (real patches), B→derived (scalar patches), C→off_model (0 patches, capex only), D→enabling (0 patches, capex only). Off-model/enabling carry NO faked energy patch (0 patches by construction in the source data).

on_costs: blended report on_cost_pct → contingency_pct; other four explicit 0 (decision 2, avoids inheriting non-zero PROJECT_COST_DEFAULTS). schema_version=2 (decision 1). Existing 8 backed up in `docs/report/pre_seed_bridgewater_library_backup.json`.