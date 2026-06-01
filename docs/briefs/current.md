# Current brief

**Brief 74 — Energy Flows auxiliary + Heat Balance mech vent loss ribbon (Sankey topology gaps).** Architect-authored at [`active/74_sankey_topology_gaps.md`](active/74_sankey_topology_gaps.md). Closes the deferred items 7/8 from Brief 73 (Systems Energy Flows Sankey auxiliary on the v40 path) plus the mech-vent loss ribbon on Heat Balance. Design note canonical at https://www.notion.so/372d645e05cc814cb837dde20a22a161.

**Anchor** (carried forward from Brief 73 close, HEAD `9a77dee`): Bridgewater clean = engine fully functional, vent fan electricity rolling up correctly, Heat Balance Sankey rendering auxiliary ribbon, right-strip per-service breakdown showing Auxiliary entry, all five previously-failing walkthrough items green. Re-capture as Brief 74 P1 against the post-fix tree.

**Sequencing:** Per the brief — see [`active/74_sankey_topology_gaps.md`](active/74_sankey_topology_gaps.md). P6 carries the HARD STOP for Chris's in-browser walkthrough.

## Recently closed

| Brief | Closed | Title | Archive |
|---|---|---|---|
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
