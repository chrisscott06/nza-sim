# Current brief

**Active:** _(none — awaiting next direction)_

Brief 45 (Interventions + Systems UX polish) closed 2026-05-21 — see [`archive/45_ux_polish_COMPLETED.md`](archive/45_ux_polish_COMPLETED.md) and STATUS.md.

**Paused (held in archive):** [`archive/30_dynamic_engine_rebuild_PAUSED.md`](archive/30_dynamic_engine_rebuild_PAUSED.md) — Phase 0 + Phase 1.0 complete (commits `8003577` + `cc96815`). Phase 1.1 onwards PAUSED. Dynamic backend code frozen at HEAD `54407e3` (post Brief 31), not deleted. Eligible for resumption when Static work cycle pauses.

This pointer file is updated each time a brief in `active/` closes or a new brief opens.

## Pending candidates for Brief 47 (housekeeping bundle)

Logged from Briefs 44 + 45 close. Awaiting Chris's authorisation:

1. **Issue #24 polish trio** ([`docs/audit/29_open_issues.md`](../audit/29_open_issues.md)):
   - `heat_gas_share` defensive guard (`instantCalc.js:4474`).
   - Inline-legacy 'full' code path consolidation (Brief 39 audit `docs/audit/39_calculation_flow_map.md` Option (a)).
   - LiveResultsPanel heating denominator inconsistency (28.8 / 90.1 vs Diagnostic's 28.8 / 28.8 — boundary-mismatch family).

2. **Performance polish** (Brief 44 Part 5d follow-ups):
   - React.memo on `consumption`-driven children (Sankey, Profiles, Live Results) — ~5 % additional cost reduction.
   - Patches-empty intervention short-circuit (closes the /interventions 6,101 ms outlier).
   - Reference stability on engine output.

3. **Sankey per-system share enhancement** (Brief 45 Part 3 deferred): current Sankey ribbon hover tooltip shows demand → SCOP → fuel per system; could surface the per-service share % for multi-system services.

4. **Cross-route EUI baseline reading harmonisation** (Brief 45 Part 4 walkthrough finding): /systems shows 121.7 kWh/m² via `{...params, comfort_band: cb, _skipInterventions: true}`; /interventions baseline row reads 122.3 via raw params + empty options. Same engine field, 0.5 % drift due to `comfort_band` propagation. Same family as Issue #24 (c).

All four threads target overlapping engine + UI surfaces; bundling lets a single brief reason about boundary semantics + memo discipline.

## Recent brief sequencing (last ~7 days)

See STATUS.md for full Brief 45 close-out + Brief 44 close-out earlier. Prior closed briefs (Brief 42 / Brief 43 / Brief 41 / etc.) catalogued in `docs/briefs/archive/`.
