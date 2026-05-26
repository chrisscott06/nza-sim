# Current brief

**No active brief.** Brief 53 (ventilation summer-bypass + heat-balance Sankey on Systems) closed 2026-05-26 — see [`archive/53_ventilation_bypass_and_heatbalance_COMPLETED.md`](archive/53_ventilation_bypass_and_heatbalance_COMPLETED.md) and STATUS.md. Clean-state Bridgewater EUI anchor unchanged: **128.20 kWh/m²·yr** (bypass default-off; the toggle is now user-controllable via a checkbox on each ventilation system entry in `/systems`).

The Brief 53 walkthrough surfaced one observation that is **NOT a Brief 53 regression**: intervention order-dependence (`[VRF, MVHR] = 130 kWh/m²·yr` vs `[MVHR, VRF] = 124 kWh/m²·yr`). This is the pre-existing Finding D patch-overlap bug in the intervention stacking layer — Brief 53 never touched that code. It is now the explicit trigger for the next brief (see priorities below).

## Next priorities

1. **Granular-field-patch / SCOP-invariant fix** (Finding D follow-up — Brief 53 walkthrough reproduction fixture). NOW THE NEXT BRIEF. The intervention-stacking layer currently applies whole-object `systems_config_v40` snapshots as patches (each intervention sets the entire v40 object). When two interventions touch the same service (e.g. "VRF 4.0" sets heating to a single VRF at SCOP 4; "MVHR Bedrooms" sets ventilation), the later one's snapshot replaces the earlier one's wholesale — so heating gets clobbered by MVHR's patched-but-unintentionally-included heating block. Result: order-dependent EUI.

   **Fix shape:** field-level system patches (`op:set` on `building.systems_config_v40.heating[0].efficiency_metric`, not on the whole `building.systems_config_v40` object). VRF and MVHR then compose instead of collide.

   **Falsifiability gate:**
   - Cumulative after-stack EUI must be **order-independent** — `[VRF, MVHR]` and `[MVHR, VRF]` must converge to one number (the 130/124 split → one value).
   - **No isolated SCOP/demand-reducer may show a positive marginal.** A pure efficiency improvement (e.g. VRF SCOP 2.8 → 4.0) or a pure demand reducer (e.g. MVHR HRE upgrade) MUST move EUI in the saving direction in isolation. The walkthrough screenshots (showing `[MVHR alone]` and `[VRF alone]` marginals from Brief 48's breakdown panel) are the reproduction fixture for this brief.

   Brief not yet written.

2. **Metadata-input-page brief** (single source of truth for num_rooms, comfort_band, peak_people_per_room). Will subsume the comfort_band stopgap landed at `e462a21`. Brief not yet written.

3. **Brief 51 (HELD)** — MVHR recovery row surfacing / panel reconciliation (Brief 50 target 5 residual). Polish only, waits behind the engine-correctness work above. Source brief at `~/Downloads/51_mvhr_recovery_row_surfacing.md` (not yet landed in active/).

Brief 50 (MVHR recovery double-count fix — Option A: State 2 owns recovery) closed 2026-05-25 — see [`archive/50_mvhr_recovery_doublecount_fix_COMPLETED.md`](archive/50_mvhr_recovery_doublecount_fix_COMPLETED.md). Movement explained from first principles in `docs/audit/50_mvhr_recovery_doublecount.md` §4 + §7.

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
