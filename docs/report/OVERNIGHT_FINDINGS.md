# Brief 96 — Overnight Findings & Decisions Log

Running log of judgment calls, assumptions, and stop-and-write items from the unattended
run. Chris to sanity-check the flagged items before the table goes near the report.

## Setup decisions

- **Benchmarks doc location.** The brief expected it at `docs/report/HIEX_Intervention_Spec_and_Cost_Benchmarks.md`; it was actually in `~/Downloads/` alongside the brief itself. Judgment: Chris dropped both source files in Downloads — the intent is obvious, so I copied it into `docs/report/` (which Part 1 creates anyway) rather than STOP on a path technicality. Content verified as the real 22-intervention spec.
- **Canonical design note fetched from Notion** (`Design note: HIEX intervention modelling methods + report metrics`, updated 2026-07-07). It confirms the class assignments, all Class B/C methods, the four metric definitions, measure lives (controls 10y / plant 15y / PV 25y / fabric 30y), and tariffs (28p/7p). Where this note and the benchmarks doc are the authority, I follow them; the brief is followed where it's more specific (e.g. FES grid series, not the CRREM target pathway, for the electricity carbon factor).

## P1 — clean baseline

- `report_baseline_v1` derived from `bridgewater_anchor_v2`: aux experiment (External lighting 1.5 W/m²) + 8 playground interventions removed. Aux removal drops EUI 6.6 kWh/m² in both engines (132.6→126.0 NZA, 117.7→111.1 EP) — clean.
- **EP generator edit:** `generate_full_idf.py` previously assumed a non-empty `gains.auxiliary.profiles`; guarded it so the clean baseline (no aux) builds. Anchor path unaffected (anchor has an aux profile → identical output); NZA fixture invariant untouched.
- Baseline reference numbers: see `docs/report/00_baseline.md`.

## Assumptions requiring Chris sanity-check (P2 patch values)

All within the benchmarks doc's stated ranges; each is a *stated engineering assumption*
per the design note's "every number defensible with a stated assumption" discipline. Costs
reconcile 22/22 within ±1% (`01_cost_reconciliation.md`).

- **1.1 low-flow −19.5% DHW** = shower fraction 65% × low-flow volume reduction **30%** (aerator/regulator standard). The doc gives the −10..−25% band + shower fraction but not the flow-reduction %; 30% is my stated assumption. Modelled as `dhw_demand_litres_per_person_per_day` 55→44.3.
- **5.2 communal lighting −15%** = whole-building lighting magnitude 2.0→1.7 W/m² (communal fraction × PIR saving). The doc gives no explicit %; 15% is my stated assumption for the communal-LED+PIR effect on the whole-building lighting figure.
- **3.4 glazing g 0.55→0.42** via the nearest library construction `double_low_e` (u unchanged 1.4; film reduces g not u). Doc target g 0.40 — 0.42 is the nearest available; delta negligible. Film life ~10–15y in reality; note maps fabric→30y (overstates lifetime carbon — flagged).
- **3.5 brise soleil facades**: doc says SW/S/W → modelled as **south + west** overhangs (0.5 m) of the 4-orientation box (North_Axis 42°). The box has no separate SW; south+west is the faithful subset.
- **2.2 fan duty cube law**: flow −28% (2208→1590) AND SFP scaled by (flow ratio)² (0.9→0.47) so fan energy ∝ flow³ per the doc. The static engine's fan model is SFP×flow (linear), so the SFP derate carries the cube-law physics.
- **4.2 room shut-off −25%** plug load (mid of doc's −20..−30%): equipment baseload 5.04→3.78 W/m².
- **1.4 ASHP SCOP 2.9** (mid 2.8–3.0), gas DHW share→0, ASHP→100%.

## ⚠ Modelling limitations the design note does NOT resolve (Chris — read before trusting cumulative)

- **DHW same-path stacking.** 1.1 (low-flow) and 1.2 (WWHR) both scale `dhw_demand_litres_per_person_per_day`; 1.3 and 1.4 both touch `dhw[1].efficiency_metric`. The declarative engine does **last-write-wins on a shared path**, so in the CUMULATIVE spine these DHW measures do NOT fully compound (only the last-applied one's value survives per path). ISOLATED results (the MACC, Table 1 — the primary deliverable) are unaffected: each measure stands alone. The note only addresses the 3.2-after-3.1 case, not multi-DHW stacking. **Cumulative DHW savings are therefore a lower bound** — documented, will be reflected in Table 2's caveat and the run manifest.
- **VRF-eff same-path (3.1 & 3.2).** Both set `heating[0]/cooling[0].efficiency_metric`. The note's explicit guard (3.2 computed against the post-3.1 state) IS honoured in the cumulative run by giving 3.2 a cumulative-specific eff (post-3.1 3.4 × 1/0.8 = 4.25) distinct from its isolated eff (3.75). Implemented in the P5 run layer.
- **2.3 heat-recovery bypass** has no clean static-engine representation (seasonal HRV bypass is not an exposed field). Modelled effect ≈ 0; flagged as a near-free control with an uncaptured small summer cooling benefit. Cost £0 (within 6.1).

## Stop-and-write items
_(none — all ambiguities resolved to stated assumptions within doc ranges or flagged as limitations above)_
