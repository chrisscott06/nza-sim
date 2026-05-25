# Current brief

**Active:** [`active/48_intervention_breakdown_viewer.md`](active/48_intervention_breakdown_viewer.md) — Brief 48 per-intervention audit-trail / breakdown viewer. Surfacing-not-recomputing exercise per the §5 data audit; mandatory checkpoint after Part 2 on the UX "narrate-it-unprompted" gate. UI/surfacing only — no engine recompute, no boundary fixes (those are a separate brief).

Brief 47 (Interventions: faithful state + inputs-left / visualiser-right layout) closed 2026-05-24 — see [`archive/47_interventions_layout_and_state_COMPLETED.md`](archive/47_interventions_layout_and_state_COMPLETED.md) and STATUS.md.

Brief 46 (Interventions editor full rebuild) closed 2026-05-24 — see [`archive/46_interventions_editor_rebuild_COMPLETED.md`](archive/46_interventions_editor_rebuild_COMPLETED.md). The capture-context architecture + read-overlay layer (the inert-controls fix at HEAD `70514e6`) are the foundation Brief 47 + 48 build on.

Brief 45 (Interventions + Systems UX polish) closed 2026-05-21 — see [`archive/45_ux_polish_COMPLETED.md`](archive/45_ux_polish_COMPLETED.md) and STATUS.md.

**Paused (held in archive):** [`archive/30_dynamic_engine_rebuild_PAUSED.md`](archive/30_dynamic_engine_rebuild_PAUSED.md) — Phase 0 + Phase 1.0 complete (commits `8003577` + `cc96815`). Phase 1.1 onwards PAUSED. Dynamic backend code frozen at HEAD `54407e3` (post Brief 31), not deleted. Eligible for resumption when Static work cycle pauses.

This pointer file is updated each time a brief in `active/` closes or a new brief opens.

## Brief 48 §5 data audit — completed, no escalation

`docs/audit/48_breakdown_data_audit.md` walks the engine's intervention pass and confirms the brief's premise: **all data the breakdown panel needs is already on the engine result or trivially derivable.** Both framings (cumulative vs marginal) are first-class (computed by `runInterventionStack` per intervention). The MVHR boundary (raw / recovery offset / post-MVHR / delivered) is all surfaced or one subtraction away. **Escalation gate does not fire.** Part 1 is a ~50-line additive change to `computeDelta` + `_serviceDelta` in `interventionsEngine.js` — no physics, no State 2/3, no new engine path. Proceeding.

## Deferred to a future boundary-fix brief (NOT Brief 48 scope)

Brief 48 builds the diagnostic instrument; the boundary-fix brief uses it. Per Brief 48 Part 5: the new viewer will be used to inspect Findings A (cooling setpoint), C (infiltration), D (reorder marginals) and record observations to the diagnostics note — **no engine fixes in this brief.** Engine boundary fixes that those observations may motivate are their own brief.

## Pending candidates for a future housekeeping brief

Logged from Briefs 44 + 45 + 47 close. Not picked up by Brief 48:

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

5. **Other /systems surfaces with hard-coded MWh** (post-Brief-47 sidecar fix only swept SystemsSankey): Live Results strip / panel, SystemsRejection, SystemsSummary table, Sankey legend. ~6 sites in `SystemsModule.jsx`. Mechanical fix.

6. **InternalGainsModule + OperationModule per-input PatchedInputBadge coverage** (Brief 47 Part 4 deferred the deep wrapping): per-profile Lighting / Equipment magnitudes inside `MultiProfileList`, per-opening fields inside `OperationModule`'s OpeningRow expanded editor, per-system fields inside `SystemEditorPopout`. Currently wrapped at parent level only (whole-snapshot prefix-match). Per-field granularity is a Brief 41 patch-shape concern — requires moving from whole-object captures to field-level captures.

7. **Per-row collapse-state persistence** (Brief 47 Part 5c deferred): intervention cards default collapsed on every reload. localStorage with per-id keys would remember which rows the user expanded.

All catalogued for the next architect-decided brief.

## Recent brief sequencing

See STATUS.md for Brief 47 close-out + Brief 46 close-out + Brief 45 / 44 close-outs. Prior closed briefs in `docs/briefs/archive/`.
