# Current brief

**No active brief.** Brief 77 just closed (`8b2301f` P2+P3 + close commit landing now). Brief 75 stays open at "P2-only — superseded by Brief 76 P2."

Next brief is architect's call. Likely candidates:
- **Brief 78 — door bug** (operable door heat_loss=0 on Systems Heat Balance).
- **Brief 79 — interventions diagnostic harness**.
- **Brief 80 — WWHR**.
- **Brief 81 — EnergyPlus validation harness** (per Brief 77 numbering rolls).
- **Brief 75 P3-P5 carry-forward** (mech_vent_thermal_flow decomposition + MVHR recovery IN ribbon). Optional follow-on.
- Tier-3 carryovers: zero-value `mech_ventilation` row when all vent disabled (Brief 77 §4.4); EnergyCarbonTab v25 label reads + InterventionEditor dual-capture (Brief 76 §future).

## Recently closed

| Brief | Closed | Title | Archive |
|---|---|---|---|
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
