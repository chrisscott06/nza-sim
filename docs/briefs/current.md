# Current brief

**Bridgwater Baseline: Model-1 (As-Specified) — CLOSED 2026-07-14 on `chris/bridgwater-baseline-model1` ([PR #20](https://github.com/chrisscott06/nza-sim/pull/20) open, NOT merged — Chris merges after walkthrough).**
Brought the Bridgewater baseline to the Model-1 (as-specified) definition, gas-anchored DHW,
added an export **Outputs** sheet + engine SHA, and pinned the corrected scenario as the project
baseline. **No engine/schedule changes.** **Headline: Model-1 EUI = 119.2 kWh/m²/yr** (elec
294.959 · gas 207.599 · total 502.558 MWh) vs metered 185.1 → **−35.6% as-specified performance
gap** (the two-model methodology's intended output; inside the hard stop-band 80–130). DHW
gas-anchored to 207.599 MWh (−0.05% vs 207.7) at **48.2 L/p/day tap-basis** (60 °C-equiv 28.9).
**MAJOR finding:** `gains.auxiliary` is **inert in the instant engine** (0.0/0.3/7.0 W/m² → identical
output), so the "258 MWh aux" was never in the modelled EUI — the pre-D1 model was already 118.6,
not ~185 (185 is the meter); Model-2's auxiliary residual must ride a *counted* end-use. Loader
round-trip bug fixed so pinned baselines survive reload (`baseline_snapshot` was missing from the
project-loader allow-list). Audit
[`../audit/bridgwater-baseline-model1_close.md`](../audit/bridgwater-baseline-model1_close.md);
brief [`archive/bridgwater-baseline-model1_COMPLETED.md`](archive/bridgwater-baseline-model1_COMPLETED.md).

**Assumptions Export — single-sheet "Inputs" XLSX — CLOSED 2026-07-14.**
On branch `chris/assumptions-export` (off clean `main`). Read-only export: a one-click
"Export assumptions" button on the Building inputs page writes every model input assumption
(fabric, gains, occupancy, DHW, baseline systems) for the loaded scenario to a single-sheet
`nza-sim_assumptions_<scenario>_<date>.xlsx`. **No engine/schedule change**; live state only, no
hardcoded values; reuses installed SheetJS (no npm). Verified on live HIEX by decoding the actual
exported blob (40+ rows faithful, single "Inputs" sheet, filename convention). Occupancy tripwire
reconciled: schedule-realised avg = **293.8** (live State-2 `occupancy_summary`), not the brief's
stale 330.6, shown beside the 414 peak; Chris confirmed. Brief
[`archive/assumptions-export_COMPLETED.md`](archive/assumptions-export_COMPLETED.md); audit
[`../audit/assumptions-export_verification.md`](../audit/assumptions-export_verification.md).
**Local branch, NOT pushed/merged.**

**Brief 101 — Lifecycle £/tonne + assumption notes — CLOSED 2026-07-13.**
On branch `chris/lifecycle-notes` (off main). Engine untouched (`instantCalc.js`/assembler
byte-identical) — cost-model + intervention-data + export only. **P1:** £/tonne now uses
LIFECYCLE capex — initial + 70%-of-initial replacements per measure life expiring before 2050
(`floor(25/life)`; controls 10→2, plant 15→1, PV 25→1, fabric ≥26→0); carbon stays to-2050.
`measure_life_years` seeded onto all 22 from `scripts/report/interventions.py` life bands.
Verified: DHW ASHP (plant 15) £/t 155→**264** (×1.70); fabric (30y) unchanged. **P2:** per-
intervention `assumption_notes` (ENERGY BASIS / COST BASIS), auto-drafted for all 22 from the
repo sources; the four L-flags (1.2/1.3/1.5/2.1) say allowance-only, PV states the CRREM
gross-demand rule; editable via a textarea in the isolated view; exported as a 5th **Assumptions**
sheet. Re-exported `Bridgewater_Hotel_interventions.xlsx` (5 sheets); UI ↔ export consistent
(1.1 £95, 1.4 £264 in both). Brief
[`archive/101_lifecycle_notes_COMPLETED.md`](archive/101_lifecycle_notes_COMPLETED.md).
**PR open, NOT merged.**

**Brief 98-C — The Convergence — CLOSED 2026-07-13.**
On branch `chris/engine-convergence` (off `chris/reconciliation-table`). Closed all six EP-side,
anchor-safe gaps from the 98-R register, with the reconciliation table as the acceptance test.
**EP assembler + hvac_dhw only; NZA-Sim `instantCalc.js` untouched; anchors 132.6/126.0 byte-identical;
inherited inputs, nothing tuned.** Headline: **space-heating demand converged from EP 10.3 → 107.2
(NZA 87.7, +22%)** and cooling 163.8 → 88.3 (NZA 101.1, −13%) — from ~8× apart to within ~20%; red cells
14→3. Six inherits: people gain (1.2→120.4), ventilation topology (0→3 systems, ~248 MWh restored),
thermostat (setback→flat band), DHW fuel split (gas 45→155), thermal bridging (0→24 via psi-adjusted U),
permanent vents (55.7→16 on NZA's wind correlation). Residual demand gap = named method difference
(EP full sub-hourly balance vs NZA gated/lumped-mass-reset). 3 remaining reds all delivered-side: VRF
heating-elec COP (curves ~1.4 vs flat SCOP 3.0 — a NEW finding), cooling-elec (downstream), fan-elec
(parked/NZA-side). **Meter sanity:** EP now shows a winter signature but over-shoots (VRF COP over-dumps
winter electricity) → the remaining reality gap is the SYSTEMS layer (VRF COP), delivered-side, anchor-safe.
Deliverable [`../audit/98R_reconciliation.md`](../audit/98R_reconciliation.md) (BEFORE `98C_before.md`,
AFTER `98C_after.md`). Brief [`archive/98C_convergence_COMPLETED.md`](archive/98C_convergence_COMPLETED.md).
**PR open, NOT merged.**

**Brief 98-R — The Reconciliation Table — CLOSED 2026-07-13.**
On branch `chris/reconciliation-table` (off `chris/ep-inherit-nza-inputs`). The systematic gap-detector:
every energy channel + every config field, NZA | EP, side by side, automatic flags. **DETECTS, does not
fix.** No physics change either engine — EP assembler change limited to OUTPUT:VARIABLE requests (P1,
demand byte-identical 95.6/10.3/163.8). instantCalc read-only; anchors 132.6/126.0 byte-identical.
Deliverable [`../audit/98R_reconciliation.md`](../audit/98R_reconciliation.md) is fully script-generated
(`scripts/report/reconcile.py`): **Table A** (25 channels, 14 🔴 / 2 🟠, zero unexplained — every flag
named), **Table B** (input parity, INHERITED/NOT/STRUCTURAL with assembler file:line), **gap register**
(11 root gaps, each with fix class + suggested brief). Headline gaps: ventilation topology (~248 MWh, EP
models 1 of 3 systems), people activity-schedule bug (1.2 vs 120.4 MWh), thermostat regime (EP setback vs
NZA band), thermal bridging (0 vs 24), DHW fuel split. **The register is the finish-the-model backlog** —
vent + people are the dominant EP-side anchor-safe fixes. Brief:
[`archive/98R_reconciliation_COMPLETED.md`](archive/98R_reconciliation_COMPLETED.md). **PR open, NOT merged.**

**Brief 98-A2 — EnergyPlus inherits NZA-Sim's inputs (small power, lighting, DHW) — CLOSED 2026-07-13.**
On branch `chris/ep-inherit-nza-inputs` (off `chris/engine-comparison-p0`, PR #13). Same building = same
inputs — EP now inherits NZA's small-power + lighting schedules (via the per-profile machinery state2
uses) and DHW demand (mirror of NZA's tap-mix → `daily_hot_litres_override`). **EP assembler only;
instantCalc.js read-only; anchor unmoved (132.6/126.0).** Proven byte-exact: EP equipment 186.1 =
NZA 186.1, lighting 39.0 = NZA 39.0, DHW 12,144 L/day → 257.3 MWh = NZA 257.335. **Claim 2 (systems)
now tight (<0.1%)**; DHW delivered-gas differs by the ASHP topology (series-preheat vs 52/48), named.
**BUT matching the gains unmasked a large Claim-1 residual** — EP heating 10.3 / cooling 163.8 vs NZA
87.7 / 101.1 — a real blended-zone-vs-full-heat-balance solver difference amplified by NZA's flat
8760 h small power (186 MWh, likely unrealistic for a 138-bed hotel). **Verdict: 98-B (Results UI)
NOT clear** until a baseline-realism review (diversified small-power profile + DHW occupancy check —
moves the anchor, Chris's call). Deliverable:
[`../audit/98A2_matched_inputs.md`](../audit/98A2_matched_inputs.md). Brief:
[`archive/98A2_ep_inherit_inputs_COMPLETED.md`](archive/98A2_ep_inherit_inputs_COMPLETED.md).
**PR open, NOT merged.**

**Brief 98-A — Same-Building Engine Comparison (airtightness fix + two-claim residual) — CLOSED 2026-07-10.**
On branch `chris/engine-comparison-p0` (off clean `main` `a5d8107`). The first valid NZA-vs-EnergyPlus
comparison — same building, both engines, nothing tuned (prior numbers void: measured across mismatched
stale configs). **P0:** EP infiltration now reads NZA-Sim's envelope-derived operational ACH (q50 →
n50/20) instead of flat 0.5 — `derive_operational_ach()` mirrors `deriveOperationalACH`; proven
byte-identical (0.06925 both sides), EP 0 fatal. **P1:** Claim 1 (Fabric→Demand) is **defensible
physics** — heating NZA 87.7 / EP 52.9 MWh, r 0.896, gap dominated by thermal_bridging 24.0 (EP 0) +
permanent_vents 18.9 (EP-absent); Claim 2 (Demand→Delivered) is **NOT tight** — candidate bugs flagged
(small_power 4.7×, DHW ~10×, lighting 2×, fans). **P2 verdict:** fabric is trustworthy, but the systems
layer has real candidate bugs dominating the EUI gap → **a Claim-2 bug-fix pass should precede Brief
98-B** (Results UI). NZA-Sim `instantCalc.js` untouched; anchors 132.6/126.0 byte-identical. Deliverable:
[`../audit/98A_valid_comparison.md`](../audit/98A_valid_comparison.md). Brief:
[`archive/98A_engine_comparison_COMPLETED.md`](archive/98A_engine_comparison_COMPLETED.md).
**PR open, NOT merged — independent review gates it.**

**Brief 100 — Interventions Library: XLSX export + off-model savings + narratives — CLOSED 2026-07-10; MERGED to `main` `a5d8107` (PR #12).**
On branch `chris/interventions-export` (off `chris/seed-hiex-interventions`, PR #11, which carries the
seed script Brief 100 extends). Three connected pieces: (1) **off-model savings** — a new optional
`off_model` field lets PV/interlink/refrigerant show their real carbon/£/kWh (from `offmodel.py`),
additive to the engine + rolled into strategy totals — Solar PV now shows −30.8 tCO₂e / £1,786/tonne /
4.9 yr, EUI Δ 0 (honest, gross-demand), badged off-model, instead of looking dead; (2) **narratives** —
a two-part (energy + cost) plain-language "How this works" panel from the intervention notes, all
sourced; (3) **XLSX export** — a Library "Export XLSX" button producing a 4-sheet workbook (Summary /
Calc trail per-service demand / Cost plans / Narratives) via a shared metrics helper so it matches the
screen. Also fixed the Demand tab (DHW shape bug + hidden ventilation/lighting/small-power). **No engine
change** — anchors 132.6/126.0 byte-identical. Verified in browser + a workbook round-trip test. Brief:
[`archive/100_interventions_export_COMPLETED.md`](archive/100_interventions_export_COMPLETED.md).
**PR open, NOT merged — Chris walkthrough gates it.**

**Brief 99 — Seed 22 HIEX Interventions into live Bridgewater Library — CLOSED 2026-07-10.**
On branch `chris/seed-hiex-interventions` (off `main` `7195b7c`). Seeded all 22 HIEX report interventions
(with cost plans, in the new groups shape) into the LIVE Bridgewater project's Library via API PUT
`/{id}/building`, so the report can be written from the tool. **No engine change** — Library data only;
anchors 132.6/126.0 byte-identical. Adapter `scripts/seed_hiex_interventions.py` (report→persisted shape;
schema_version=2; blended on-cost → contingency_pct, others explicit 0). **22/22 cost totals reconcile
±1%** ([`../report/99_seed_reconciliation.md`](../report/99_seed_reconciliation.md)). Class flags honest:
A simulated / B derived / C off_model / D enabling; off-model + enabling carry 0 patches (no faked
savings). Engine verification (`scripts/_brief99_p4_verify.mjs`): 13 modellable move EUI, 9
off-model/enabling show 0 Δ, cumulative spine 83.5 (−37.6%) ≈ report 74.8 (−40.6%) given the +7.9
live-baseline offset. The 8 originals backed up + DB snapshotted (reversible). Brief:
[`archive/99_seed_hiex_interventions_COMPLETED.md`](archive/99_seed_hiex_interventions_COMPLETED.md).
**PR open, NOT merged — Chris walkthrough on LIVE Bridgewater gates close.**

**Brief 98-pre-d — C1 lighting + C2 ASHP DHW COP EP-derive fixes — CLOSED 2026-07-09; MERGED to `main` `7195b7c` (PR #10).**
On branch `chris/98pre-d-lighting-dhw-cop` (off `main`). Definitive read-only traces of the displayed
engine `_calculateState3` (`instantCalc.js:4941`) on live Bridgewater proved it reads **v40** for both
DHW (consumption.dhw = 42.2 MWh elec + 157.4 MWh gas, ASHP present) and lighting (44.46 MWh, v40
control_factor 1.0) — correcting the 98-pre-c escalation, which had traced the wrong function (legacy
`calculateInstantDegreeDay`). So the audit's original **C1/C2 were real EP-derive gaps**, now fixed in
`derive_systems_for_sim`: **C1** maps v40 lighting `control_mechanism` → `lighting_control` (constant →
EP factor 1.0, was 0.80 ≈ 20% low); **C2** derives ASHP DHW COP from v40 (3.0, was 2.8). Proven
(`scripts/_brief98pred_p2.py`): emitted Lights watts/area = LPD×1.0, ASHP tank efficiency 3.0, EP 0
fatal. **No `instantCalc.js`/assembler change; anchors 132.6/126.0 byte-identical.** Corrected the
superseded "displayed reads simple" claim in the audit doc + escalation. **Config drift fully closed.**
Brief: [`archive/98pred_lighting_dhw_cop_COMPLETED.md`](archive/98pred_lighting_dhw_cop_COMPLETED.md).
**PR open, NOT merged.** Supersedes 98-pre-c + the PR #9 note (folded in).

**Brief 98-pre-c — Derive Remaining Fields — CLOSED as a doc correction 2026-07-09 (no code changed).**
On branch `chris/derive-remaining-fields` (off `chris/fix-systems-config-drift`); the escalation + doc
correction were consolidated onto `chris/audit-config-drift`. Investigation found the audit's four (c)
findings rest on a false premise: NZA-Sim's *instant engine* (behind the 132.6/126.0 anchors + displayed
Results) reads `lighting_control` and DHW from the flat/simple config, NOT v40. So 98-pre-b's *preserved*
values already match the instant engine; deriving from v40 would open a ~20% EP-vs-anchor lighting gap.
**STOP-and-write** per the brief's escalate clause — derive/assembler/instantCalc untouched. The dangerous
drift (system *type*) is fully closed by 98-pre-b; the residual is an upstream NZA-Sim instant-engine split
(out of scope, would move the anchors). ⚠️ **Open decision for Chris:** is Bridgewater DHW gas-only (simple)
or ASHP-48%-COP-3 (v40)? — the report's DHW baseline depends on it. Deliverable:
[`../audit/98prec_escalation.md`](../audit/98prec_escalation.md) + CORRECTION in
[`../audit/config_drift_rootcause.md`](../audit/config_drift_rootcause.md). Brief:
[`archive/98prec_derive_remaining_fields_COMPLETED.md`](archive/98prec_derive_remaining_fields_COMPLETED.md).

**Audit — systems_config Drift Root-Cause (read-only, findings only) — CLOSED 2026-07-09.**
On branch `chris/audit-config-drift` (off `chris/fix-systems-config-drift`, PR #7's branch — read-only,
so the derive it audits is present). Evidence trail behind the 98-pre-b fix. **Q1:** accidental orphan —
Brief 40 (2026-05-19) migrated the systems model to v40 for the instant engine + UI but left the EP
`/api/simulate` path reading the un-maintained simple `systems_config` column (~7 weeks exposure).
**Q2:** 2 of 4 projects drifted (Bridgewater Hotel materially); **no realised stale EP result** — all
full-systems runs predate v40, the only later run was envelope-only. **Q3:** primary dispatch faithful,
but **4 (c) findings** — `lighting_control` (~20% lighting), `ashp_cop_dhw` (~7% ASHP-DHW), v40 DHW
setpoints (latent), stale `dhw_preheat` (latent) — still preserved-from-stored not derived-from-v40.
**Verdict: drift NOT fully closed** — 98-pre-b is mergeable as-is (fixes wrong system *type*), but a
short follow-up fix brief should derive the 4 secondary fields from v40 before EP numbers go
client-facing. No engine/config changes made. Deliverable:
[`../audit/config_drift_rootcause.md`](../audit/config_drift_rootcause.md). Brief:
[`archive/audit_config_drift_COMPLETED.md`](archive/audit_config_drift_COMPLETED.md). **PR open, NOT merged — the value is the doc.**

**Brief 98-pre-b — systems_config Drift: one source of system truth for `/api/simulate` — CLOSED 2026-07-09.**
On branch `chris/fix-systems-config-drift` (off `main` `0d68618`, post-PR#6 merge). `/api/simulate` read two
legacy configs the current UI never writes — the simple `systems_config` DB column (`projects.py:573`) and the
`systems_config_v25` enabled gates (`epjson_assembler.py:1418`) — while the UI edits only `systems_config_v40`
(what NZA-Sim reads). So any edited project silently simulated its pre-edit systems. **Fix (derive-on-read):**
`nza_engine/systems_from_v40.py` `derive_systems_for_sim()` derives the simple config **and** v25 gates from
v40 at simulate time (ephemeral; merges onto the existing simple config — overrides system
types/efficiencies/gates, preserves non-system fields LPD/EPD/dhw-setpoint/natural-vent). `simulate_project`
now reads the derived config. Auto-corrects stale projects, no migration. **Proven** (`scripts/_brief98preb_p3.py`):
baseline runs 0 fatal / 0 severe as VRF from v40 despite a poisoned gas simple copy (LPD/EPD preserved →
lighting 15.7 / equip 39.6 MWh match 98-pre); an edited v40 (heating→gas, cooling off) flips emitted objects
with no manual sync. NZA-Sim untouched; anchors 132.6 / 126.0 byte-identical.
⚠️ **For Brief 98 P0:** the faithful v40-derived EP baseline is **EUI 47.2** (heat 54.2 / cool 64.5 MWh), not
98-pre's 60.5 — v40 ventilation is **MVHR 80%** where 98-pre's hand-corrected fixture had **MEV**; P0's residual
table diffs NZA-Sim against this derived baseline. Deliverables:
[`../audit/98preb_config_drift.md`](../audit/98preb_config_drift.md), `../audit/98preb_proof.json`. Brief:
[`archive/98preb_systems_config_drift_COMPLETED.md`](archive/98preb_systems_config_drift_COMPLETED.md).
**PR open, NOT merged — independent review gates it; then Brief 98 P0 resumes on a config layer that can no longer drift.**

**Brief 98-pre — Fix Main-Sim Gas Heating (unblock the EnergyPlus baseline) — CLOSED 2026-07-09; MERGED to
`main` `0d68618` (PR #6).** Was on branch `chris/fix-mainsim-gas-heating`. The main `/api/simulate` EnergyPlus
fatalled on Bridgewater because `hvac_heating_boiler.py` emitted `ZoneHVAC:Baseboard:Convective:Gas` (not an EP
object) **and** the simple `systems_config` wrongly said `gas_boiler_heating` (real plant = VRF). **Both fixed:**
generator now emits `ZoneHVAC:UnitHeater` + `Coil:Heating:Fuel` (schema-valid, efficiency clamped ≤ 1); fixture
`systems_config` corrected to VRF. report_baseline_v1 ran clean (0 fatal). 🚩 Flagged (not chased): a second fatal
in the gas+VRF-cooling combination (VRF-TU node reconciliation) — its own follow-up; the systems_config drift is
now fixed by Brief 98-pre-b. NZA-Sim untouched; anchors 132.6 / 126.0 byte-identical. Deliverable:
[`../audit/98pre_gas_heating_fix.md`](../audit/98pre_gas_heating_fix.md). Brief:
[`archive/98pre_fix_mainsim_gas_heating_COMPLETED.md`](archive/98pre_fix_mainsim_gas_heating_COMPLETED.md).

**Brief 97 — Interventions Studio (module redesign + RICS cost editor as pop-out) — CLOSED 2026-07-08
(overnight, unattended; P1–P9 done; PR open, NOT merged — independent review + Chris walkthrough gate it).**
On branch `chris/cost-plan-editor` (cut from `main` `d7d2c37`, post-95/96 merge).
**Supersedes Brief 91 + the 91b stub/editor drafts** (91b files `git rm`'d from active/; 91 kept as content
source). Turns the Interventions module from a grey-scroll into a designed, tabbed workspace and replaces the
transitional headline cost card with the full RICS/NRM2 cost editor built as a **pop-out** window (not inline —
overrides 91's UX-freeze). **Zero physics** (`--fixture` anchor EUI 132.6 byte-identical start→close). Parts:
**P1** land brief + supersede 91b + EP-flag rename rider (already applied: "EP-validated ✓" → "EP-checked — see
Table 3" where |EUI Δ%|>25%: 2.2/3.3/3.4/3.5) · **P2** semantic colour tokens · **P3** Library isolated view →
tabs (Impact/Carbon/Demand/Cost) · **P4** cost data model + lossless headline migration · **P5** RICS cost
editor as pop-out + delete headline editor + transitional dual-path (lifts the 91b quarantine) · **P6** keyboard
discipline (best-effort) · **P7** HIEX-seeded templates + fill-from-defaults · **P8** Strategy restyle + validate
panel cleanup · **P9** close (PR, NOT merged). Carries forward the 91b P2 work (CostPlanEditor component,
migrate-on-read, transitional-block removal — rehomed into the pop-out). Canonical design note: Notion
"Interventions Studio". Brief: [`archive/97_interventions_studio_COMPLETED.md`](archive/97_interventions_studio_COMPLETED.md);
content source: [`archive/91_cost_plan_builder_SUPERSEDED.md`](archive/91_cost_plan_builder_SUPERSEDED.md);
overnight log: [`../report/97_OVERNIGHT_FINDINGS.md`](../report/97_OVERNIGHT_FINDINGS.md). All 9 parts done,
`--fixture` anchor EUI 132.6 byte-identical start→close, migration 11/11, ASHP acceptance £95,941.
**Independent review + Chris walkthrough gate close; do NOT merge unattended.**

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
