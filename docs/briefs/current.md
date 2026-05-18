# Current brief

**Active:** [`active/37_unified_schedule_editor.md`](active/37_unified_schedule_editor.md) — single shared schedule editor across Internal Gains + Operation + Systems with consistent theming + schema + exception-period support. Chat-form authorisation 2026-05-18; Part 1 in flight (this commit) is the colour-token foundation.

**Paused (only remaining entry in active/):** [`active/30_dynamic_engine_rebuild.md`](active/30_dynamic_engine_rebuild.md) — Phase 0 + Phase 1.0 complete (commits `8003577` + `cc96815`). Phase 1.1 onwards PAUSED. Dynamic backend code frozen at HEAD `54407e3` (post Brief 31), not deleted. Eligible for resumption now that Brief 33 has closed.

This pointer file is updated each time a brief in `active/` closes.

## Recent brief sequencing (last ~7 days)

| Brief | Status | Closing commit(s) |
|-------|--------|-------------------|
| [`archive/26_State_1_envelope_only_COMPLETED.md`](archive/26_State_1_envelope_only_COMPLETED.md) | ✅ closed 2026-05-12 | — |
| [`archive/26_1_State_1_finalisation_COMPLETED.md`](archive/26_1_State_1_finalisation_COMPLETED.md) | ✅ closed 2026-05-13 | — |
| [`archive/26_2_EP_Shading_Investigation_COMPLETED.md`](archive/26_2_EP_Shading_Investigation_COMPLETED.md) | ✅ closed 2026-05-13 | — |
| [`archive/27_Internal_Gains_State_2_COMPLETED.md`](archive/27_Internal_Gains_State_2_COMPLETED.md) | ✅ closed 2026-05-13 | — |
| [`archive/27_cleanup_COMPLETED.md`](archive/27_cleanup_COMPLETED.md) | ✅ closed 2026-05-14 | — |
| [`archive/28_prereq_free_running_ep_COMPLETED.md`](archive/28_prereq_free_running_ep_COMPLETED.md) | ✅ closed 2026-05-14 | — |
| [`archive/28a_visible_polish_COMPLETED.md`](archive/28a_visible_polish_COMPLETED.md) | ✅ closed 2026-05-14 (Part 8 + walkthrough findings landed) | `1d79d82` |
| [`archive/28k_heat_loss_setpoint_convention_COMPLETED.md`](archive/28k_heat_loss_setpoint_convention_COMPLETED.md) | ✅ Gates 1-3+ shipped 2026-05-15 | `6d0e5c2`, `bc36878` |
| [`archive/28c_state_2_loss_recompute_COMPLETED.md`](archive/28c_state_2_loss_recompute_COMPLETED.md) | ✅ shipped 2026-05-15 | `5d36391` |
| [`archive/28f_state_3_systems_COMPLETED.md`](archive/28f_state_3_systems_COMPLETED.md) | ✅ Parts 1-4 complete 2026-05-15 (Part 5 onward deferred) | `b69f092`, `4cab01d`, `518a6f7`, `79dfebc` |
| [`archive/28j_hourly_mvhr_recovery_cap_COMPLETED.md`](archive/28j_hourly_mvhr_recovery_cap_COMPLETED.md) | ✅ shipped 2026-05-15 | `80183db` |
| [`archive/28b_physics_overhaul_SUPERSEDED.md`](archive/28b_physics_overhaul_SUPERSEDED.md) | ⚠ Part 3 v3 shipped; Parts 2/4/5 deferred. Foundational premise re-examined by Brief 29 — see strategic implications doc | `5342090` |
| [`archive/28e_operable_openings_COMPLETED.md`](archive/28e_operable_openings_COMPLETED.md) | ✅ Gates E1-E5a shipped 2026-05-16 | `8abd997`, `8474ad9`, `6ee7d13`, `f125b4d`, `7f3ba5c`, `4152e92` |
| [`archive/28tb_thermal_bridging_simple_COMPLETED.md`](archive/28tb_thermal_bridging_simple_COMPLETED.md) | ✅ TB-V1 + TB-V1b shipped 2026-05-16 | `f4e6406`, `5c3da03` |
| [`archive/28L_brukl_ingestion_COMPLETED.md`](archive/28L_brukl_ingestion_COMPLETED.md) | ✅ Gates L3-L5 shipped 2026-05-16 | `ed4b494`, `689f2b2`, `84bb346`, `56273e7` |
| [`archive/28im_intervention_model_COMPLETED.md`](archive/28im_intervention_model_COMPLETED.md) | ✅ IM-M1 through M6 + M4.5 shipped 2026-05-17 | `6be3b42`, `7f4d4f6`, `713e818`, `ed78554`, `f13c28d`, `2967014`, `279ee78`, `0f4d9f7` |
| [`archive/28im_polish_COMPLETED.md`](archive/28im_polish_COMPLETED.md) | ✅ POL-M1, M2, M3 shipped 2026-05-17 | `7c8cb4c`, `cdb919f`, `7206c0a` |
| [`archive/29_first_principles_audit_COMPLETED.md`](archive/29_first_principles_audit_COMPLETED.md) | ✅ Parts 1 & 2 complete 2026-05-17; escalation triggered; Issue #13 re-diagnosed 2026-05-18; Parts 3-8 superseded by Brief 30 | `39a828c`, `587f4c0`, `2be42fe`, `7073908`, `6bd46b3`, `3f8b1ee`, `cc96815` |
| [`archive/29_Building_Module_Completion_v2_SUPERSEDED.md`](archive/29_Building_Module_Completion_v2_SUPERSEDED.md) | ⚠ Different brief from the audit. Never started; superseded by Brief 30 | — |
| [`active/30_dynamic_engine_rebuild.md`](active/30_dynamic_engine_rebuild.md) | ⏸ paused — superseded by Brief 32 in active queue until Static is client-ready. Phase 0 + Phase 1.0 frozen; Phase 1.1+ resumes after Brief 32 closes | `8003577`, `cc96815` |
| Brief 31 — Documentation Reconciliation | ✅ closed 2026-05-18 | `54407e3` |
| [`archive/32_static_completion_COMPLETED.md`](archive/32_static_completion_COMPLETED.md) | ⚠ closed-and-superseded by Brief 33 — Part 1 closed `3a793ce`; Part 2 closed-but-superseded `341eeff` (balanced_mechanical was a scope violation). Parts 3-7 did not happen as scoped. | `3a793ce`, `341eeff` |
| [`archive/33_building_envelope_COMPLETED.md`](archive/33_building_envelope_COMPLETED.md) + [`archive/33_part_3_module_scopes_COMPLETED.md`](archive/33_part_3_module_scopes_COMPLETED.md) | ✅ closed 2026-05-18 — Part 1 revert `195a87b`; Finding 1 fix `b53b163`; Part 2 geometry-aware C_d `c6a415b`; Part 3 CLAUDE.md "Module scopes" + Process Rules 10–11 `d814973` | `195a87b`, `b53b163`, `c6a415b`, `d814973` |
| [`archive/34_simplify_permanent_openings_ui_COMPLETED.md`](archive/34_simplify_permanent_openings_ui_COMPLETED.md) | ✅ closed 2026-05-18 — UI simplification to single C_d slider | `f702687` |
| [`archive/36_internal_gains_audit_polish_COMPLETED.md`](archive/36_internal_gains_audit_polish_COMPLETED.md) | ✅ closed 2026-05-18 — Part 1 Internal Gains Static audit (`2c96896`); Part 2 colour discipline (`376ab41`); Part 3 SchedulePopout shared chrome (`f0b764c`); Part 4 close-out (`66fb0e6`). Two S2 issues logged (#14 scope contamination, #15 lighting `independent` mode scaling). Systems exception-period support deferred to Brief 37. | `2c96896`, `376ab41`, `f0b764c`, `66fb0e6` |
| **[`active/37_unified_schedule_editor.md`](active/37_unified_schedule_editor.md)** | **🟡 active** — Part 1 in flight (this commit): colour-token sweep (Operation teal-700, Systems DHW pink-500, ventilation teal-500, cooling cyan-bright unified). Parts 2-4 build + wire UnifiedScheduleEditor; Part 4 deletes legacy editors after sign-off pause. | (this commit) |

Brief 31 lands the rules that govern future sessions (CLAUDE.md updates) and the project's self-description (STATUS.md refresh + brief management). Brief 30 Phase 1.1 onwards is then re-authorised against that corrected foundation.

Brief 32 (2026-05-18) pauses Brief 30 in active queue to land a client-ready Bridgewater Static baseline first. Brief 32 Part 2 attempted a topology fix that imported mechanical-systems concepts into the Building module; Brief 33 closed Brief 32 with a corrective scope (revert → geometry-aware C_d → CLAUDE.md scope lock). Brief 34 simplified the Brief 33 Part 2 per-facade UI to a single slider after Chris's over-precision concern at walkthrough.
