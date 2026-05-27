# Current brief

**Brief 60 — Finish line: in-tool calculation trail (panel redesign) + auxiliary energy + baseline/intervention parity guard.** Tier-3 wrap-up at [`active/60_finish_line.md`](active/60_finish_line.md). Three parts:

- **Part A — Redesigned breakdown panel** (the in-tool calculation trail). Three bands + summary cards + headline; all systems present; inline `delivered ÷ efficiency = fuel` arithmetic; fan energy added; broken rows cut. UI-only — engine git diff = 0.
- **Part B — Auxiliary energy in Internal Gains** (Brief 58 Part D, folded in). External lighting / catering / pumps / small power as gain-coupled loads.
- **Part C — Baseline-vs-intervention parity guard.** Extends `scripts/trace_calc.mjs` with a parity mode + permanent fixture asserting baseline-edit results == equivalent-intervention results.

**Anchor:** Bridgewater clean **110.30 EUI** (post Brief 58 Part C, post Brief 59 vent-flow fix). Each part states whether it moves the anchor; Part A must not (UI-only).

**Sequencing:** one commit per sub-part; hard stop at each PART boundary for Chris's in-screen walkthrough (10 / 7 / 5 items in the brief). Each part independently shippable.

After Brief 60: Brief 58 formally closes (Part D delivered here as Part B). Brief 59 already closed (vent-flow fix + calc-trace harness).

---

## Previous brief sequencing

Brief 59 closed 2026-05-27 — `[archive entry pending Brief 60 close]`.
Brief 58 (demand-honesty cluster) Parts A1-A4 + B1-B4 + C landed; Part D folded into Brief 60 Part B.
Brief 55 (granular field-level system patches) closed 2026-05-26 — see [`archive/55_granular_field_patches_COMPLETED.md`](archive/55_granular_field_patches_COMPLETED.md).
Brief 50 (MVHR recovery double-count fix) closed 2026-05-25 — see [`archive/50_mvhr_recovery_doublecount_fix_COMPLETED.md`](archive/50_mvhr_recovery_doublecount_fix_COMPLETED.md).

**Paused (held in archive):** [`archive/30_dynamic_engine_rebuild_PAUSED.md`](archive/30_dynamic_engine_rebuild_PAUSED.md) — eligible for resumption when Static work cycle pauses.

## Pending housekeeping (catalogued, not picked up)

1. **Issue #24 polish trio** (see [`docs/audit/29_open_issues.md`](../audit/29_open_issues.md)).
2. **Performance polish** (Brief 44 Part 5d follow-ups).
3. **Sankey per-system share enhancement** (Brief 45 Part 3 deferred).
4. **Cross-route EUI baseline reading harmonisation** (Brief 45 Part 4 finding).
5. **Other /systems hard-coded MWh sweeps** (~6 sites in SystemsModule.jsx).
6. **PatchedInputBadge per-input coverage** in InternalGainsModule + OperationModule (Brief 47 Part 4 deferred).
7. **Per-row collapse-state persistence** (Brief 47 Part 5c deferred).
8. **Breakdown panel Level 3 leave-one-out** (Brief 48 Part 3 deferred).

All catalogued for the next architect-decided brief.
