# Current brief

**Active:** [`active/50_mvhr_recovery_doublecount_fix.md`](active/50_mvhr_recovery_doublecount_fix.md) — Brief 50 MVHR recovery double-count fix (Option A: State 2 owns recovery). Engine fix brief — deletes the duplicate State 3 subtraction at `instantCalc.js` ~L4131. Primary acceptance gate: refbox Probe 1 ratio must converge 1.99 → 1.00 (re-run `scripts/_brief49_refbox_test.mjs`). Secondary: Bridgewater total apparent MVHR saving ≤ 104 MWh (was 147.02). New anchor expected ~126 kWh/m²·yr from first principles — not calibrated to.

Brief 49 (MVHR recovery boundary diagnostic) closed 2026-05-25 at HARD STOP with verdict H3 (double-count) confirmed via reference box fixture ratio 1.99 — see [`archive/49_mvhr_recovery_boundary_diagnostic_COMPLETED.md`](archive/49_mvhr_recovery_boundary_diagnostic_COMPLETED.md) and [`docs/audit/49_mvhr_recovery_diagnosis.md`](../audit/49_mvhr_recovery_diagnosis.md).

Brief 48 (Interventions: per-intervention audit-trail / breakdown viewer) closed 2026-05-25 — see [`archive/48_intervention_breakdown_viewer_COMPLETED.md`](archive/48_intervention_breakdown_viewer_COMPLETED.md) and STATUS.md.

Brief 47 (Interventions: faithful state + inputs-left / visualiser-right layout) closed 2026-05-24 — see [`archive/47_interventions_layout_and_state_COMPLETED.md`](archive/47_interventions_layout_and_state_COMPLETED.md).

Brief 46 (Interventions editor full rebuild) closed 2026-05-24 — see [`archive/46_interventions_editor_rebuild_COMPLETED.md`](archive/46_interventions_editor_rebuild_COMPLETED.md). The capture-context architecture + read-overlay layer is the foundation Briefs 47 + 48 built on.

Brief 45 (Interventions + Systems UX polish) closed 2026-05-21 — see [`archive/45_ux_polish_COMPLETED.md`](archive/45_ux_polish_COMPLETED.md).

**Paused (held in archive):** [`archive/30_dynamic_engine_rebuild_PAUSED.md`](archive/30_dynamic_engine_rebuild_PAUSED.md) — Phase 0 + Phase 1.0 complete (commits `8003577` + `cc96815`). Phase 1.1 onwards PAUSED. Dynamic backend code frozen at HEAD `54407e3` (post Brief 31), not deleted. Eligible for resumption when Static work cycle pauses.

This pointer file is updated each time a brief in `active/` closes or a new brief opens.

## Brief 48 outcome

Brief 48 built the diagnostic instrument — the per-intervention BreakdownPanel (Trail + Matrix modes, framing toggle, Level 1 headline / Level 2 audit trail / Level 3 chain context). The panel succeeded in the strongest possible way: Chris diagnosed a real engine bug (Finding E — MVHR boundary decoupled accounting) on first use by reading the panel during the Part 2 checkpoint.

See [`docs/audit/48_findings_first_look.md`](../audit/48_findings_first_look.md) for the Part 5 findings record:

- **Finding D** — delta-math layer cleared algebraically (`computeDelta` cumulative === sum of marginals by construction). Reorder behaviour is not a delta-arithmetic bug. If it still feels wrong, the work is patch-overlap semantics (Brief 41 §6) or marginal-attribution UX framing.
- **Finding A** (cooling setpoint) and **Finding C** (infiltration) — instrument ready; live read-out pending.
- **Finding E** (MVHR boundary) — confirmed via panel; gets its own brief next.

## Next brief — MVHR boundary fix (provisional)

Finding E is the next brief's seed. Likely also reads A and C through the same instrument while the boundary surface is being worked. To be written by Chris.

## Pending candidates for a future housekeeping brief

Logged from Briefs 44 + 45 + 47 + 48 close. Not yet picked up:

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

6. **InternalGainsModule + OperationModule per-input PatchedInputBadge coverage** (Brief 47 Part 4 deferred the deep wrapping): per-profile Lighting / Equipment magnitudes inside `MultiProfileList`, per-opening fields inside `OperationModule`'s OpeningRow expanded editor, per-system fields inside `SystemEditorPopout`. Currently wrapped at parent level only (whole-snapshot prefix-match). Per-field granularity is a Brief 41 patch-shape concern.

7. **Per-row collapse-state persistence** (Brief 47 Part 5c deferred): intervention cards default collapsed on every reload. localStorage with per-id keys would remember which rows the user expanded.

8. **Breakdown panel Level 3 leave-one-out** (Brief 48 Part 3 deferred): the current chain context shows position + predecessor + successor summaries by reading already-computed deltas. A more ambitious read would rerun the stack without the selected intervention to attribute "how much of intervention X's marginal is because you enabled this row vs because the chain would have produced it anyway." Expensive (second engine pass per intervention) — defer until real client need surfaces.

All catalogued for the next architect-decided brief.

## Recent brief sequencing

See STATUS.md for Brief 48 close-out + prior close-outs. Prior closed briefs in `docs/briefs/archive/`.
