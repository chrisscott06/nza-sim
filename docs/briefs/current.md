# Current brief

**Brief 89 (Brief C) — CRREM lifetime carbon.** Active on branch `chris/interventions-rework-ux`.
Populates Brief A's placeholder Lifetime Carbon card (per-intervention) + CRREM stranding diagram
(Strategy view) with fuel-switching-aware operational carbon math vs the UK CRREM trajectory. No engine
changes; canonical carbon/CRREM read helpers per Bible Rule 11. Brief:
[`active/89_crrem_lifetime_carbon.md`](active/89_crrem_lifetime_carbon.md); design note:
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
final sign-off pending**, then archive + single PR to `main`. Brief: [`active/87_interventions_ux_rework.md`](active/87_interventions_ux_rework.md);
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
| 75 | OPEN (P2-only) | Full ventilation heat modelling + Bridgewater heating-demand-zero diagnostic | [`active/75_ventilation_heat_modelling.md`](active/75_ventilation_heat_modelling.md) |
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
