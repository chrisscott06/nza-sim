# Current brief

**Active:** _none_ — Brief 47 closed 2026-05-24. Awaiting the next brief.

Brief 47 (Interventions: faithful state + inputs-left / visualiser-right layout) closed 2026-05-24 — see [`archive/47_interventions_layout_and_state_COMPLETED.md`](archive/47_interventions_layout_and_state_COMPLETED.md) and STATUS.md.

Brief 46 (Interventions editor full rebuild) closed 2026-05-24 — see [`archive/46_interventions_editor_rebuild_COMPLETED.md`](archive/46_interventions_editor_rebuild_COMPLETED.md). The capture-context architecture + read-overlay layer (the inert-controls fix at HEAD `70514e6`) are the foundation Brief 47 built on.

Brief 45 (Interventions + Systems UX polish) closed 2026-05-21 — see [`archive/45_ux_polish_COMPLETED.md`](archive/45_ux_polish_COMPLETED.md) and STATUS.md.

**Paused (held in archive):** [`archive/30_dynamic_engine_rebuild_PAUSED.md`](archive/30_dynamic_engine_rebuild_PAUSED.md) — Phase 0 + Phase 1.0 complete (commits `8003577` + `cc96815`). Phase 1.1 onwards PAUSED. Dynamic backend code frozen at HEAD `54407e3` (post Brief 31), not deleted. Eligible for resumption when Static work cycle pauses.

This pointer file is updated each time a brief in `active/` closes or a new brief opens.

## Deferred to the next brief

Logged during Brief 47 walkthrough as next-brief work, NOT Brief 47 defects:

1. **Finding D** — stacked-marginal reorder behaviour / demand-vs-delivered reading. Reordering interventions in the stack shifts the engine's per-row marginal/cumulative attribution in ways that don't fully match the demand-vs-delivered framing the user expects. The engine output is correct per Brief 41 Part 2's `computeDelta` definition; the user-facing framing of marginal-after-reorder needs its own pass. Diagnostic note (location TBD) carries the live observation.

2. **Intervention breakdown viewer** — a "what changed inside this intervention, step-by-step" drill-down (separate from the change list, which shows raw patches; this would show their physical impact decomposed: this q50 change shaved X kWh/m²·yr through infiltration, this construction swap shaved Y through walls, etc.). Different shape from the Brief 47 visualiser views (which show the WHOLE stack's impact). New view, new engine query.

Both are next-brief work — Brief 47's scope is closed.

## Pending candidates for a future housekeeping brief

Logged from Briefs 44 + 45 close. Not picked up by Brief 47:

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

See STATUS.md for full Brief 47 close-out + Brief 46 close-out + Brief 45 / 44 close-outs. Prior closed briefs (Brief 42 / 43 / 41 / etc.) catalogued in `docs/briefs/archive/`.
