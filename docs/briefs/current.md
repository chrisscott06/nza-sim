# Current brief

**Active:** [`active/33_building_envelope.md`](active/33_building_envelope.md) — Revert `balanced_mechanical` from the Building module, fix the trickle-vent C_d, lock the Building module's scope in CLAUDE.md. Closes Brief 32.

**Status:** Part 1 closed `195a87b`. Walkthrough surfaced Finding 1 (flow_mode missing from `withMode` State 1 allowlist — engine never saw the dropdown selection); fix in flight as a standalone commit between Parts 1 and 2. Finding 2 (Sankey/Stacked/Rows totals disagree on the same config) is next. Then Part 2 — geometry-aware C_d.

**Paused (in active/ for traceability):** [`active/30_dynamic_engine_rebuild.md`](active/30_dynamic_engine_rebuild.md) — Phase 0 + Phase 1.0 complete (commits `8003577` + `cc96815`). Phase 1.1 onwards PAUSED. Dynamic backend code frozen at HEAD `54407e3` (post Brief 31), not deleted. Resume after Brief 33 closes.

**Superseded in active queue:** [`active/32_static_completion.md`](active/32_static_completion.md) — Part 1 (`3a793ce`) closed; Part 2 (`341eeff`) closed-but-superseded by Brief 33 Part 1. Parts 3–7 do not happen as scoped; the Building module work continues under Brief 33.

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
| [`active/32_static_completion.md`](active/32_static_completion.md) | ⚠ closed in active queue — Part 1 closed `3a793ce`; Part 2 closed-but-superseded `341eeff` (balanced_mechanical was a scope violation). Parts 3-7 do not happen as scoped. | `3a793ce`, `341eeff` |
| **[`active/33_building_envelope.md`](active/33_building_envelope.md)** | **🟡 active** — Part 1 in flight (this commit): revert `balanced_mechanical` from Building module. Parts 2-3: geometry-aware C_d, then CLAUDE.md "Module scopes" lock. | (this commit) |

Brief 31 lands the rules that govern future sessions (CLAUDE.md updates) and the project's self-description (STATUS.md refresh + brief management). Brief 30 Phase 1.1 onwards is then re-authorised against that corrected foundation.

Brief 32 (2026-05-18) pauses Brief 30 in active queue to land a client-ready Bridgewater Static baseline first. Brief 32 Part 2 attempted a topology fix that imported mechanical-systems concepts into the Building module; Brief 33 closes Brief 32 with a corrective scope (revert → C_d → CLAUDE.md scope lock).
