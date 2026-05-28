# Current brief

**Brief 72 — Auxiliary loads, gain_fraction, and DHW load-shape UI.** Architect-authored at [`active/72_auxiliary_loads_dhw_shape.md`](active/72_auxiliary_loads_dhw_shape.md); 11 parts. Carries forward the never-shipped Brief 60 Part B/D addendum and folds in two correctness fixes uncovered during the Brief 71 walkthrough (headcount unification + Occupancy/Calc-trail discriminator).

**Anchor** (Principle 5, captured at Part 1, HEAD `286f57c`): Bridgewater clean = **EUI 130.0 kWh/m²·yr / 536.4 MWh total** (electricity 356.3 + gas 180.1). Demand split: Heating 55.9 / Cooling 87.6 / DHW 210.5 MWh. Full anchor table at `docs/audit/72_auxiliary_loads_dhw_shape.md` §1.

**Sequencing:** P1 anchor + STATUS reconcile (this commit) → P2 discriminator (read-only, H1/H2/H3 settled, decides whether P2b fix is needed) → P3 headcount unification + num_bedrooms capture → P4 schema → P5 engine wiring (Rule 14 check) → P6 colour → P7 Aux UI [HARD STOP] → P8 gain_fraction editor [HARD STOP] → P9 DHW load-shape UI → P10 patch capture → P11 walkthrough + close. Each Part = one commit. HARD STOPs at P7 and P8 for Chris's browser pass.

## Recently closed

| Brief | Closed | Title | Archive |
|---|---|---|---|
| 71 | 2026-05-28 | Interventions: Isolated vs Combined evaluation + theme grouping | [`archive/71_interventions_isolated_vs_combined_COMPLETED.md`](archive/71_interventions_isolated_vs_combined_COMPLETED.md) |

## Queued (not yet started)

- **Brief 70 Parts 2–4** — day-zoom + week-zoom + walkthrough close (Brief 70 Part 1 + adhoc polish landed; remainder pending)
- **Brief 73** — Operable door heat_loss=0 on Systems Heat Balance (engine-side natvent parity bug). Trace summary at the bottom of `archive/71_interventions_isolated_vs_combined_COMPLETED.md`.
- **Brief 60 Part C (folded back in via Brief 74+)** — baseline/intervention parity guard. Brief 60 Part B is absorbed into Brief 72 (auxiliary loads).
- **Brief 74 (drafted, awaiting Brief 72 close)** — interventions diagnostic harness + tab redesign.
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

## Paused

[`archive/30_dynamic_engine_rebuild_PAUSED.md`](archive/30_dynamic_engine_rebuild_PAUSED.md) — eligible for resumption when the Static work cycle pauses.
[`archive/67_zone_temperature_trajectory_PAUSED.md`](archive/67_zone_temperature_trajectory_PAUSED.md) — Part B paused with three modelling judgements flagged for Chris.
