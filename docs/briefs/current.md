# Current brief

**No active brief on disk.** Brief 71 just closed (2026-05-28); Brief 72 is authored by Chris's architect session and lands on disk as its own Part 1 first commit per its BEFORE-DOING-ANYTHING.

## Next up

**Brief 72 — Auxiliary loads, gain_fraction, and DHW load-shape UI** (architect-authored, awaiting Code's "Part 1 first commit"). Adds a fourth Internal-Gains section (External lighting / Catering / Pumps / Small power / Lifts / Custom), promotes `gain_fraction` to a first-class editable field on lighting / equipment / auxiliary profiles, and surfaces the `dhw_load_shape` control (flat vs follow-occupancy) that has shipped in the engine since Brief 58 without a UI. Anchor is captured, not hardcoded — STATUS.md reconcile is the first commit (Brief 72 P1). Brief on disk lands at `docs/briefs/active/72_auxiliary_loads_dhw_shape.md` as part of P1.

## Recently closed

| Brief | Closed | Title | Archive |
|---|---|---|---|
| 71 | 2026-05-28 | Interventions: Isolated vs Combined evaluation + theme grouping | [`archive/71_interventions_isolated_vs_combined_COMPLETED.md`](archive/71_interventions_isolated_vs_combined_COMPLETED.md) |

## Queued (not yet started)

- **Brief 73** — Operable door heat_loss=0 on Systems Heat Balance (engine-side natvent parity bug between direct-State-2 and State-3-via-State-2 invocations). Three diagnosis angles exhausted during the Brief 71 session; needs a dedicated brief. Trace summary at the bottom of `archive/71_interventions_isolated_vs_combined_COMPLETED.md`.
- **Brief 74 (conditional)** — Isolated-view value factor-of-2 vs Calc Trail for mid-stack interventions. Documented diagnosis at `docs/audit/71_interventions_isolated_vs_combined.md §6` is that this is cumulative-vs-isolated semantics, not a math bug; caption rewording in Brief 71 Part 4 addresses the UX side. Stays unqueued if Chris's first-in-stack browser test confirms first-row agreement across views.
- **Brief 60 Parts B + C** — auxiliary energy in Internal Gains (now superseded by Brief 72) and baseline/intervention parity guard (parity guard still pending; the auxiliary work moves under Brief 72's umbrella).

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
