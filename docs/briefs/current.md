# Current brief

**Brief 93 — Branch Consolidation — CLOSED 2026-07-07 (independent review pending).** The three long-running
branches are merged into `main`: `feat/envelope-fix-bridgwater-rebuild` (Brief 86 — rebuilt Bridgewater),
`chris/interventions-rework-ux` (Briefs 87–92 — interventions / CRREM / cost / gains), and
`feat/energyplus-validation` (Briefs 81–85 — EP validation harness). **Zero physics drift** (Bridgewater
anchor EUI 169.8 identical through every merge). Archived:
[`archive/93_branch_consolidation_COMPLETED.md`](archive/93_branch_consolidation_COMPLETED.md); audit:
[`../audit/93_consolidation_snapshots.md`](../audit/93_consolidation_snapshots.md).

**Next work:** EP-as-canonical-results for Interventions, on branch `chris/ep-interventions-backend` (cut
from consolidated `main`). Also open: **Brief 91b** — Cost Plan Builder completion (transitional Brief 91
merged; P4–P9 remain — [`active/91b_cost_plan_completion_STUB.md`](active/91b_cost_plan_completion_STUB.md);
"no brief touches the cost layer until it closes").

## Housekeeping 2026-07-07 — stale-brief archive sweep

Seven briefs moved out of `docs/briefs/active/` (only **91** + **91b** remain active). Suffixes are
faithful to actual status, not blanket `_COMPLETED`:

| Brief | New location | Status |
|---|---|---|
| 86 envelope-fix rebuild | [`archive/86_..._COMPLETED.md`](archive/86_envelope_fix_and_bridgwater_rebuild_COMPLETED.md) | merged into `main` (Brief 93) |
| 87 interventions UX | [`archive/87_..._COMPLETED.md`](archive/87_interventions_ux_rework_COMPLETED.md) | code done; Part 7 walkthrough sign-off still Chris's |
| 89 CRREM lifetime carbon | [`archive/89_..._COMPLETED.md`](archive/89_crrem_lifetime_carbon_COMPLETED.md) | done bar sign-off |
| 92 auxiliary Systems toggle | [`archive/92_..._COMPLETED.md`](archive/92_auxiliary_systems_toggle_COMPLETED.md) | merged into `main` |
| 90 NRM2 cost model | [`archive/90_..._SUPERSEDED.md`](archive/90_nrm2_cost_model_SUPERSEDED.md) | opened + blocked (Applemore); superseded by Brief 91 |
| 75 ventilation heat modelling | [`archive/75_..._SUPERSEDED.md`](archive/75_ventilation_heat_modelling_SUPERSEDED.md) | P2-only open; superseded by Brief 76 |
| 70 zone-temp/demand viewer | [`archive/70_..._ARCHIVED.md`](archive/70_zone_temp_demand_viewer_ARCHIVED.md) | Part 1 landed; P2–4 parked (still in Queued below) |

Open remainders (70 P2–4, 75 P2) stay catalogued in the Queued section — archiving the files does not drop
the work.

**Brief 90 (Brief B) — NRM2 cost model.** Landed on `chris/interventions-rework-ux` (Part 1 docs only).
**BLOCKED at Part 2** — the Applemore Feasibility Cost Plan spreadsheet (the rate-library source) is not
in the repo. Needs Chris to provide it at `docs/reference/applemore_cost_plan.xlsm`. Last of three:
A (UX, done) → C (CRREM, done bar sign-off) → **B (cost, blocked)**. Brief:
[`archive/90_nrm2_cost_model_SUPERSEDED.md`](archive/90_nrm2_cost_model_SUPERSEDED.md); audit:
[`../audit/90_nrm2_cost_model.md`](../audit/90_nrm2_cost_model.md).

**Brief 89 (Brief C) — CRREM lifetime carbon.** Active on branch `chris/interventions-rework-ux`.
Populates Brief A's placeholder Lifetime Carbon card (per-intervention) + CRREM stranding diagram
(Strategy view) with fuel-switching-aware operational carbon math vs the UK CRREM trajectory. No engine
changes; canonical carbon/CRREM read helpers per Bible Rule 11. Brief:
[`archive/89_crrem_lifetime_carbon_COMPLETED.md`](archive/89_crrem_lifetime_carbon_COMPLETED.md); design note:
[`../design-notes/brief_C_crrem_lifetime_carbon.md`](../design-notes/brief_C_crrem_lifetime_carbon.md);
audit: [`../audit/89_crrem_lifetime_carbon.md`](../audit/89_crrem_lifetime_carbon.md). Closes into the
combined PR with Brief 87 + 88. Second of three: A (UX, done) → **C (CRREM, this)** → B (NRM2 cost).

**Brief 88 — Strategy baseline state-sync — CLOSED 2026-06-26.** Diagnostic refuted the brief's
hypothesis (no option-passthrough bug; divergence didn't reproduce); the real root cause was two
independently-computed EUI exposures. Fix: canonical `consumption.total.kwh_per_m2_yr` read via
`utils/engineReads.readModelledEui`, alias deprecated + purged from all consumers, Bible Rule 11 added.
Independent review (Claude Chat) passed; tidy-up checks done (grep clean, Rule 11 banked). Archived:
[`archive/88_strategy_baseline_state_sync_COMPLETED.md`](archive/88_strategy_baseline_state_sync_COMPLETED.md).

**Brief 87 — Interventions UX rework (Library/Strategy split + two-section per-intervention view).**
Active on branch `chris/interventions-rework-ux` (cut from `main` `d8a6207`). UX restructure only — no
engine changes. **Part 6 cleanup DONE** (old visualiser subgraph deleted); **Part 7 walkthrough = Chris's
final sign-off pending**, then archive + single PR to `main`. Brief: [`archive/87_interventions_ux_rework_COMPLETED.md`](archive/87_interventions_ux_rework_COMPLETED.md);
design note (canonical): [`../design-notes/interventions_rework.md`](../design-notes/interventions_rework.md).
First of three: A (UX, this) → C (CRREM lifetime carbon) → B (NRM2 cost). Brief 75 stays open
(P2-only — superseded by Brief 76 P2).

NB: Brief numbers 78–86 exist on other branches (`feat/energyplus-validation` 78–85; calibration branch
86); this rework is numbered 87 to avoid collision, per the brief.

## Recently closed

| Brief | Closed | Title | Archive |
|---|---|---|---|
| 88 | 2026-06-26 | Strategy baseline state-sync — canonical EUI read path (`engineReads.readModelledEui`), alias deprecated, Bible Rule 11 | [`archive/88_strategy_baseline_state_sync_COMPLETED.md`](archive/88_strategy_baseline_state_sync_COMPLETED.md) |
| 77 | 2026-06-02 | Per-system ventilation loss rendering (Heat Balance) — restore three per-system ribbons across Sankey/Rows/Stacked via mutual exclusion | [`archive/77_per_system_vent_rendering_COMPLETED.md`](archive/77_per_system_vent_rendering_COMPLETED.md) |
| 76 | 2026-06-01 | v40-as-source for State 2 ventSystems builder (closes b9ae15b regression) | [`archive/76_v40_ventsystems_base_iterator_COMPLETED.md`](archive/76_v40_ventsystems_base_iterator_COMPLETED.md) |
| ~~76 (draft)~~ | superseded before landing | ~~Route v40 projects to State 3 (close inline-legacy dispatch gap)~~ | [`archive/76_v40_state3_dispatch_SUPERSEDED.md`](archive/76_v40_state3_dispatch_SUPERSEDED.md) |
| 75 | OPEN (P2-only) | Full ventilation heat modelling + Bridgewater heating-demand-zero diagnostic | [`archive/75_ventilation_heat_modelling_SUPERSEDED.md`](archive/75_ventilation_heat_modelling_SUPERSEDED.md) |
| 74 | 2026-06-01 | Energy Flows auxiliary + Heat Balance mech vent loss ribbon (Sankey topology gaps) | [`archive/74_sankey_topology_gaps_COMPLETED.md`](archive/74_sankey_topology_gaps_COMPLETED.md) |
| 73 | 2026-06-01 | Ventilation share rule + auxiliary visualisation + lighting baseline check | [`archive/73_ventilation_auxiliary_lighting_COMPLETED.md`](archive/73_ventilation_auxiliary_lighting_COMPLETED.md) |
| 72 | 2026-05-29 | Auxiliary loads, gain_fraction, DHW load-shape UI + DB recovery (OVERNIGHT) | [`archive/72_auxiliary_loads_dhw_shape_COMPLETED.md`](archive/72_auxiliary_loads_dhw_shape_COMPLETED.md) |

## Recently closed

| Brief | Closed | Title | Archive |
|---|---|---|---|
| 74 | 2026-06-01 | Energy Flows auxiliary + Heat Balance mech vent loss ribbon (Sankey topology gaps) | [`archive/74_sankey_topology_gaps_COMPLETED.md`](archive/74_sankey_topology_gaps_COMPLETED.md) |
| 73 | 2026-06-01 | Ventilation share rule + auxiliary visualisation + lighting baseline check | [`archive/73_ventilation_auxiliary_lighting_COMPLETED.md`](archive/73_ventilation_auxiliary_lighting_COMPLETED.md) |
| 72 | 2026-05-29 | Auxiliary loads, gain_fraction, DHW load-shape UI + DB recovery (OVERNIGHT) | [`archive/72_auxiliary_loads_dhw_shape_COMPLETED.md`](archive/72_auxiliary_loads_dhw_shape_COMPLETED.md) |
| 71 | 2026-05-28 | Interventions: Isolated vs Combined evaluation + theme grouping | [`archive/71_interventions_isolated_vs_combined_COMPLETED.md`](archive/71_interventions_isolated_vs_combined_COMPLETED.md) |

## Queued (not yet started)

- **Brief 70 Parts 2–4** — day-zoom + week-zoom + walkthrough close (Brief 70 Part 1 + adhoc polish landed; remainder pending).
- **Brief 72 P9 follow-on** — DHW load-shape toggle no-op investigation. Stub at [`docs/audit/72_p9_dhw_load_shape_followup.md`](../audit/72_p9_dhw_load_shape_followup.md). Two candidate root causes + 30-min investigation plan documented.
- **Brief 75 (renumber the door-bug placeholder)** — Operable door heat_loss=0 on Systems Heat Balance.
- **Brief 76 (queued)** — WWHR (needs a DHW end-use split first).

## Pending housekeeping (catalogued, not picked up)

Carried forward from the pre-Brief-71 list:

1. **Issue #24 polish trio** (see [`docs/audit/29_open_issues.md`](../audit/29_open_issues.md)).
2. **Performance polish** (Brief 44 Part 5d follow-ups).
3. **Sankey per-system share enhancement** (Brief 45 Part 3 deferred).
4. **Cross-route EUI baseline reading harmonisation** (Brief 45 Part 4 finding).
5. **Other /systems hard-coded MWh sweeps** (~6 sites in SystemsModule.jsx).
6. **PatchedInputBadge per-input coverage** in InternalGainsModule + OperationModule (Brief 47 Part 4 deferred).
7. **Per-row collapse-state persistence** (Brief 47 Part 5c deferred).
8. **Breakdown panel Level 3 leave-one-out** (Brief 48 Part 3 deferred).
9. **EnergyFlowsTab on Results** — separate parallel `annualEnergy` aggregation, auxiliary parity TBD (Brief 73 P5 §future).

## Paused

[`archive/30_dynamic_engine_rebuild_PAUSED.md`](archive/30_dynamic_engine_rebuild_PAUSED.md) — eligible for resumption when the Static work cycle pauses.
[`archive/67_zone_temperature_trajectory_PAUSED.md`](archive/67_zone_temperature_trajectory_PAUSED.md) — Part B paused with three modelling judgements flagged for Chris.
