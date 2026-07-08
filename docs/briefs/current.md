# Current brief

**Brief 91b — Cost Plan Editor (Brief 91 P4–P9, HIEX-seeded) — IN PROGRESS 2026-07-08.** On branch
`chris/cost-plan-editor` (cut from `main` `d7d2c37`, post-95/96 merge). Completes Brief 91: replaces the
transitional headline cost card with the full hierarchical Cost Plan Editor (groups → line items, qty × unit
× rate, unit-adaptive labels, % on-cost lines, drag + keyboard reorder, templates), deletes the old
`HeadlineCostEditor` + both transitional `costModel.js` blocks, and seeds type-default rates from the HIEX
benchmarks. Lifts the "no brief touches the cost layer" quarantine. **Zero physics** (`--fixture` anchor EUI
132.6 byte-identical start→close). Parts: **P1** brief landing + EP-flag-rename rider (soften "EP-validated ✓"
→ "EP-checked — see Table 3" where |EUI Δ%|>25%: 2.2/3.3/3.4/3.5) · **P2** CostPlanEditor + transitional
removal · **P3** keyboard discipline · **P4** template save/apply UI · **P5** HIEX type-default rates · **P6**
walkthrough (ZZ TEST, two acceptance cases, 50-line perf) · **P7** close (PR, NOT merged). Design authority:
[`active/91_cost_plan_builder.md`](active/91_cost_plan_builder.md) +
[`../design-notes/91_cost_plan_builder.md`](../design-notes/91_cost_plan_builder.md) +
[`active/91b_cost_plan_completion_STUB.md`](active/91b_cost_plan_completion_STUB.md). Brief:
[`active/91b_cost_plan_editor.md`](active/91b_cost_plan_editor.md). **Independent review + Chris walkthrough
gate close; do NOT merge without both.**

**Brief 96 — HIEX Report Modelling (22 interventions, four-metric table, CSV/XLSX) — CLOSED 2026-07-08;
MERGED to `main` `d7d2c37` (PR #3) 2026-07-08.** Was on branch `chris/hiex-report-modelling`
(stacked on the Brief 95 branch). Turned the 22 HIEX Bridgwater interventions into a demonstrator report:
cost plans seeded verbatim from the benchmarks doc (reconciled 22/22 ≤1%), a clean frozen baseline
(`report_baseline_v1`, EUI 126.0 NZA / 111.1 EP), isolated + cumulative NZA-Sim runs, EP validation
(13/13 mappable), a metrics engine (£/tCO₂e MACC + payback + lifetime carbon), and CSV/XLSX exports. **Zero
engine change** (`instantCalc.js` untouched); both fixture invariants hold (anchor 132.6, report baseline
126.0). Cumulative reaches EUI **74.8** (below CRREM 184.1 + plateau 95) for ~£800k. Canonical inputs: the
Notion design note + `docs/report/HIEX_Intervention_Spec_and_Cost_Benchmarks.md`. Deliverables + Chris
sanity-check items in `docs/report/` (esp. `OVERNIGHT_FINDINGS.md`). Brief:
[`archive/96_hiex_report_modelling_COMPLETED.md`](archive/96_hiex_report_modelling_COMPLETED.md).
**Independent review (Claude Chat) + Chris sanity-check gate it before any merge.**

**Brief 95 — EnergyPlus Results Backend for Interventions — CLOSED 2026-07-08; MERGED to `main` `b138702`
(PR #2) 2026-07-08 (independent review + Chris walkthrough still PENDING).** Was on branch
`chris/ep-interventions-backend` (re-cut from post-94 `main` `8601e7f`). A second results backend for Interventions: translate the strategy stack →
EnergyPlus models, run as a user-triggered batch, display NZA-Sim | EP | Δ% side-by-side. **NZA-Sim engine
numbers byte-identical throughout** — fixture anchor `--fixture` EUI **132.6** unchanged P1→close; zero
engine files touched on the branch (only 7 interventions UI files + the EP harness). Parts:
- **P1** EP pinned **25-2-0** (Box gate byte-identical) · ZZ TEST seed · CLAUDE.md fixture rule.
- **P2** full-project fixture → runnable IDF (IdealLoads demand + fixed-η post-processing).
- **P3** dual-engine baseline characterisation; **P3b/c** gains + ventilation parity → physical baseline
  (EP heating 96.4 / cooling 130.3 / EUI 117.7 vs NZA-Sim 132.6; monthly r 0.95/0.92 — level offset, not
  shape). Discipline: specs match by construction, losses compared+explained, **never tuned**.
- **P4/P4b** patch translation + state builder + config-hash cache; generator extended (setpoints, q50→ach
  mirroring `instantCalc.js:387-394`, occupancy→People, shading) → translation_gaps zero physical.
- **P5** EP batch runner + config-hash cache + `ep_runs` table (10/10 tests).
- **P6** subprocess backend (venv, non-blocking, `ep_runs` is the interface) + "Validate with EnergyPlus"
  run-selection panel (current-hash cache count).
- **P7** side-by-side NZA-Sim | EP | Δ% (isolated/cumulative/marginal) + trajectory overlay + stale-guard
  (edit/toggle/reorder → "stale · re-run", never a stale number as current; a real ivSig gap was caught +
  fixed in browser verify).
- **P8** cooling delta investigation ([`../audit/95_cooling_deltas.md`](../audit/95_cooling_deltas.md)):
  the NZA-Sim cooling gap is a **+29 % baseline LEVEL error**, not per-measure — cooling DELTAS agree with
  EP to ~2 MWh for gains/solar/infiltration measures; **one DELTA outlier: cooling-setpoint relaxation,
  NZA-Sim over-credits ~4×**. Brise soleil small effect confirmed honest physics (§5c).
- **P9** close: fixture invariant byte-identical · STATUS · archive · PR (no merge).

Brief: [`archive/95_ep_results_backend_COMPLETED.md`](archive/95_ep_results_backend_COMPLETED.md); audit:
[`../audit/95_ep_backend.md`](../audit/95_ep_backend.md) + [`../audit/95_cooling_deltas.md`](../audit/95_cooling_deltas.md).

**Brief 94 — Interventions Library/Strategy Decoupling + Apply-Gated Recalc — MERGED to `main` `8601e7f`
2026-07-07 (walkthrough passed; reorder x-sensitivity fix `24dff84` included).** Was on branch
`chris/interventions-decoupling` (off `main` `533db7e`). Decoupled the intervention **library** (definitions) from the **strategy** (ordered
`[{library_id, enabled, order}]` refs), gated all global recalc behind **Apply**, and fixed the drag-reorder
bug. **Zero physics** (fixture-anchor EUI **132.6** byte-identical P3→close). Parts: P1 diagnostic (reorder =
pre-existing, root cause Brief 87 `a106438`) · P2 refs data-model + lossless migrate-on-read (37/37 tests) ·
P3 strategy view select/order/toggle + reorder fix · P4 library = sole editing surface (clone + guarded
delete) · P5 Apply-gated recalc · P6 aux tab colour + Sankey explainer. Anchor method amended to a **frozen
fixture** (`validation/fixtures/bridgewater_anchor_v2.yaml` + `--fixture` mode) — the live DB is no longer a
regression reference. Brief: [`archive/94_library_strategy_decoupling_COMPLETED.md`](archive/94_library_strategy_decoupling_COMPLETED.md);
audit: [`../audit/94_decoupling.md`](../audit/94_decoupling.md). **Do NOT merge until Chris walkthrough +
independent review.**

**Brief 93 — Branch Consolidation — CLOSED 2026-07-07 (independent review pending).** The three long-running
branches are merged into `main`: `feat/envelope-fix-bridgwater-rebuild` (Brief 86 — rebuilt Bridgewater),
`chris/interventions-rework-ux` (Briefs 87–92 — interventions / CRREM / cost / gains), and
`feat/energyplus-validation` (Briefs 81–85 — EP validation harness). **Zero physics drift** (Bridgewater
anchor EUI 169.8 identical through every merge). Archived:
[`archive/93_branch_consolidation_COMPLETED.md`](archive/93_branch_consolidation_COMPLETED.md); audit:
[`../audit/93_consolidation_snapshots.md`](../audit/93_consolidation_snapshots.md).

**Next work:** EP-as-canonical-results for Interventions, on branch `chris/ep-interventions-backend` (cut
from consolidated `main`). Also open: **Brief 91b** — Cost Plan Builder completion (transitional Brief 91
merged; P4–P9 remain — [`active/91b_cost_plan_completion_STUB.md`](active/91b_cost_plan_completion_STUB.md);
"no brief touches the cost layer until it closes").

## Housekeeping 2026-07-07 — stale-brief archive sweep

Seven briefs moved out of `docs/briefs/active/` (only **91** + **91b** remain active). Suffixes are
faithful to actual status, not blanket `_COMPLETED`:

| Brief | New location | Status |
|---|---|---|
| 86 envelope-fix rebuild | [`archive/86_..._COMPLETED.md`](archive/86_envelope_fix_and_bridgwater_rebuild_COMPLETED.md) | merged into `main` (Brief 93) |
| 87 interventions UX | [`archive/87_..._COMPLETED.md`](archive/87_interventions_ux_rework_COMPLETED.md) | code done; Part 7 walkthrough sign-off still Chris's |
| 89 CRREM lifetime carbon | [`archive/89_..._COMPLETED.md`](archive/89_crrem_lifetime_carbon_COMPLETED.md) | done bar sign-off |
| 92 auxiliary Systems toggle | [`archive/92_..._COMPLETED.md`](archive/92_auxiliary_systems_toggle_COMPLETED.md) | merged into `main` |
| 90 NRM2 cost model | [`archive/90_..._SUPERSEDED.md`](archive/90_nrm2_cost_model_SUPERSEDED.md) | opened + blocked (Applemore); superseded by Brief 91 |
| 75 ventilation heat modelling | [`archive/75_..._SUPERSEDED.md`](archive/75_ventilation_heat_modelling_SUPERSEDED.md) | P2-only open; superseded by Brief 76 |
| 70 zone-temp/demand viewer | [`archive/70_..._ARCHIVED.md`](archive/70_zone_temp_demand_viewer_ARCHIVED.md) | Part 1 landed; P2–4 parked (still in Queued below) |

Open remainders (70 P2–4, 75 P2) stay catalogued in the Queued section — archiving the files does not drop
the work.

**Brief 90 (Brief B) — NRM2 cost model.** Landed on `chris/interventions-rework-ux` (Part 1 docs only).
**BLOCKED at Part 2** — the Applemore Feasibility Cost Plan spreadsheet (the rate-library source) is not
in the repo. Needs Chris to provide it at `docs/reference/applemore_cost_plan.xlsm`. Last of three:
A (UX, done) → C (CRREM, done bar sign-off) → **B (cost, blocked)**. Brief:
[`archive/90_nrm2_cost_model_SUPERSEDED.md`](archive/90_nrm2_cost_model_SUPERSEDED.md); audit:
[`../audit/90_nrm2_cost_model.md`](../audit/90_nrm2_cost_model.md).

**Brief 89 (Brief C) — CRREM lifetime carbon.** Active on branch `chris/interventions-rework-ux`.
Populates Brief A's placeholder Lifetime Carbon card (per-intervention) + CRREM stranding diagram
(Strategy view) with fuel-switching-aware operational carbon math vs the UK CRREM trajectory. No engine
changes; canonical carbon/CRREM read helpers per Bible Rule 11. Brief:
[`archive/89_crrem_lifetime_carbon_COMPLETED.md`](archive/89_crrem_lifetime_carbon_COMPLETED.md); design note:
[`../design-notes/brief_C_crrem_lifetime_carbon.md`](../design-notes/brief_C_crrem_lifetime_carbon.md);
audit: [`../audit/89_crrem_lifetime_carbon.md`](../audit/89_crrem_lifetime_carbon.md). Closes into the
combined PR with Brief 87 + 88. Second of three: A (UX, done) → **C (CRREM, this)** → B (NRM2 cost).

**Brief 88 — Strategy baseline state-sync — CLOSED 2026-06-26.** Diagnostic refuted the brief's
hypothesis (no option-passthrough bug; divergence didn't reproduce); the real root cause was two
independently-computed EUI exposures. Fix: canonical `consumption.total.kwh_per_m2_yr` read via
`utils/engineReads.readModelledEui`, alias deprecated + purged from all consumers, Bible Rule 11 added.
Independent review (Claude Chat) passed; tidy-up checks done (grep clean, Rule 11 banked). Archived:
[`archive/88_strategy_baseline_state_sync_COMPLETED.md`](archive/88_strategy_baseline_state_sync_COMPLETED.md).

**Brief 87 — Interventions UX rework (Library/Strategy split + two-section per-intervention view).**
Active on branch `chris/interventions-rework-ux` (cut from `main` `d8a6207`). UX restructure only — no
engine changes. **Part 6 cleanup DONE** (old visualiser subgraph deleted); **Part 7 walkthrough = Chris's
final sign-off pending**, then archive + single PR to `main`. Brief: [`archive/87_interventions_ux_rework_COMPLETED.md`](archive/87_interventions_ux_rework_COMPLETED.md);
design note (canonical): [`../design-notes/interventions_rework.md`](../design-notes/interventions_rework.md).
First of three: A (UX, this) → C (CRREM lifetime carbon) → B (NRM2 cost). Brief 75 stays open
(P2-only — superseded by Brief 76 P2).

NB: Brief numbers 78–86 exist on other branches (`feat/energyplus-validation` 78–85; calibration branch
86); this rework is numbered 87 to avoid collision, per the brief.

## Recently closed

| Brief | Closed | Title | Archive |
|---|---|---|---|
| 88 | 2026-06-26 | Strategy baseline state-sync — canonical EUI read path (`engineReads.readModelledEui`), alias deprecated, Bible Rule 11 | [`archive/88_strategy_baseline_state_sync_COMPLETED.md`](archive/88_strategy_baseline_state_sync_COMPLETED.md) |
| 77 | 2026-06-02 | Per-system ventilation loss rendering (Heat Balance) — restore three per-system ribbons across Sankey/Rows/Stacked via mutual exclusion | [`archive/77_per_system_vent_rendering_COMPLETED.md`](archive/77_per_system_vent_rendering_COMPLETED.md) |
| 76 | 2026-06-01 | v40-as-source for State 2 ventSystems builder (closes b9ae15b regression) | [`archive/76_v40_ventsystems_base_iterator_COMPLETED.md`](archive/76_v40_ventsystems_base_iterator_COMPLETED.md) |
| ~~76 (draft)~~ | superseded before landing | ~~Route v40 projects to State 3 (close inline-legacy dispatch gap)~~ | [`archive/76_v40_state3_dispatch_SUPERSEDED.md`](archive/76_v40_state3_dispatch_SUPERSEDED.md) |
| 75 | OPEN (P2-only) | Full ventilation heat modelling + Bridgewater heating-demand-zero diagnostic | [`archive/75_ventilation_heat_modelling_SUPERSEDED.md`](archive/75_ventilation_heat_modelling_SUPERSEDED.md) |
| 74 | 2026-06-01 | Energy Flows auxiliary + Heat Balance mech vent loss ribbon (Sankey topology gaps) | [`archive/74_sankey_topology_gaps_COMPLETED.md`](archive/74_sankey_topology_gaps_COMPLETED.md) |
| 73 | 2026-06-01 | Ventilation share rule + auxiliary visualisation + lighting baseline check | [`archive/73_ventilation_auxiliary_lighting_COMPLETED.md`](archive/73_ventilation_auxiliary_lighting_COMPLETED.md) |
| 72 | 2026-05-29 | Auxiliary loads, gain_fraction, DHW load-shape UI + DB recovery (OVERNIGHT) | [`archive/72_auxiliary_loads_dhw_shape_COMPLETED.md`](archive/72_auxiliary_loads_dhw_shape_COMPLETED.md) |

## Recently closed

| Brief | Closed | Title | Archive |
|---|---|---|---|
| 74 | 2026-06-01 | Energy Flows auxiliary + Heat Balance mech vent loss ribbon (Sankey topology gaps) | [`archive/74_sankey_topology_gaps_COMPLETED.md`](archive/74_sankey_topology_gaps_COMPLETED.md) |
| 73 | 2026-06-01 | Ventilation share rule + auxiliary visualisation + lighting baseline check | [`archive/73_ventilation_auxiliary_lighting_COMPLETED.md`](archive/73_ventilation_auxiliary_lighting_COMPLETED.md) |
| 72 | 2026-05-29 | Auxiliary loads, gain_fraction, DHW load-shape UI + DB recovery (OVERNIGHT) | [`archive/72_auxiliary_loads_dhw_shape_COMPLETED.md`](archive/72_auxiliary_loads_dhw_shape_COMPLETED.md) |
| 71 | 2026-05-28 | Interventions: Isolated vs Combined evaluation + theme grouping | [`archive/71_interventions_isolated_vs_combined_COMPLETED.md`](archive/71_interventions_isolated_vs_combined_COMPLETED.md) |

## Queued (not yet started)

- **Brief 70 Parts 2–4** — day-zoom + week-zoom + walkthrough close (Brief 70 Part 1 + adhoc polish landed; remainder pending).
- **Brief 72 P9 follow-on** — DHW load-shape toggle no-op investigation. Stub at [`docs/audit/72_p9_dhw_load_shape_followup.md`](../audit/72_p9_dhw_load_shape_followup.md). Two candidate root causes + 30-min investigation plan documented.
- **Brief 75 (renumber the door-bug placeholder)** — Operable door heat_loss=0 on Systems Heat Balance.
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
9. **EnergyFlowsTab on Results** — separate parallel `annualEnergy` aggregation, auxiliary parity TBD (Brief 73 P5 §future).

## Paused

[`archive/30_dynamic_engine_rebuild_PAUSED.md`](archive/30_dynamic_engine_rebuild_PAUSED.md) — eligible for resumption when the Static work cycle pauses.
[`archive/67_zone_temperature_trajectory_PAUSED.md`](archive/67_zone_temperature_trajectory_PAUSED.md) — Part B paused with three modelling judgements flagged for Chris.
