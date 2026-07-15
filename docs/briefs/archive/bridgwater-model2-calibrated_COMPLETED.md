# Brief — Bridgwater Model-2 (In-Service Calibrated) + Auxiliary Residual + Inert-Input Audit

**Repo:** NZA-Sim
**Land at:** `docs/briefs/active/bridgwater-model2-calibrated.md` (first commit, before any code)
**Tier:** Standard, governed by an existing design note — **read it first**: Notion, "Design note: Two-model methodology — as-specified baseline, in-service calibration, and the auxiliary residual" (NZA-Sim hub, 2026-07-14). This brief implements that note; where they conflict, STOP and surface.
**Date:** 2026-07-14 · **Author:** Claude Chat (authorised by Chris)

---

## BEFORE DOING ANYTHING

- [ ] Confirm receipt: quote this brief's title and first paragraph back.
- [ ] Land this brief — first commit, before code.
- [ ] Read `CLAUDE.md`, `STATUS.md`, the design note above, and `docs/audit/bridgwater-baseline-model1_close.md`.
- [ ] Session reconciliation (active/, current.md, STATUS tail, git log −20). PR #20 (Model 1) must be merged to main before starting; if not, STOP and surface.
- [ ] Clean tree, origin in sync. Branch: `chris/bridgwater-model2-calibrated`.

---

## Goal

Create a second named scenario — **"Bridgewater Hotel — calibrated (Model 2)"** — from the pinned Model-1 baseline; apply the agreed evidence-cited in-service adjustments cumulatively, recording EUI after each step (the report's waterfall); re-anchor DHW to metered gas under the new plant split; implement the remaining electricity gap as an explicit auxiliary residual **on an end-use the engine counts**; audit every exported input for engine consumption; export both scenarios.

## Why this exists (intent)

Model 1 (119.2 EUI) explains the gas side of the building to −0.05% and leaves a ~277 MWh/yr electricity gap to the 572.4 MWh metered. Model 2 closes what evidence can close — field-trial efficiencies, measured duties, observed behaviour, each step cited — and the remainder becomes a named, sized residual: the quantified sub-metering case for the client report (sections 3.5/3.6). Two things destroy the deliverable: tuning anything to the meter, and a residual sitting on an input the engine ignores. The `gains.auxiliary` inert-input finding (Model-1 audit note) makes the second risk real.

Metered anchors (2025, triangulated): **elec 572.4 MWh · gas 207.7 MWh · total 780.1 · EUI 185.1** (GIA 4,215 m²).

## Scope

**IN:** minimal named-scenario save/load IF none exists (Part 0); new scenario; D1 adjustments; DHW re-anchor; residual implementation; per-step waterfall record; inert-input trace audit + export marking; export both scenarios.
**OUT:** any change to the pinned Model-1 baseline; the occupancy schedule shape; engine calculation changes (the residual must be implementable through existing input pathways — see escalations); interventions module; xlsx import / scenario round-trip from Excel; scenario version history or management UI.

## Design decisions already agreed

**D1 — Adjustments, applied cumulatively IN THIS ORDER, EUI recorded after each step:**

| # | Parameter | Model 1 | Model 2 | Basis (goes in export Basis/Source) |
|---|---|---|---|---|
| 1 | U-values wall/roof/floor/glazing | 0.14/0.15/0.13/1.4 | **0.154/0.165/0.143/1.54** (+10%) | As-built allowance — workmanship/thermal bypass (TM63 convention) |
| 2 | Air permeability | 4.64 | **5.34** (+15%) | In-service condition: test-condition sealing removed, movement since 2019 test. Tested figure remains the anchor |
| 3 | Door-operation infiltration | — | small allowance, entrance + deliveries, daytime | Only uncontrolled path beyond trickle vents. See escalation E1 for mechanism |
| 4 | Heating SCOP (VRF) | 5.0 | **2.8** | DESNZ Electrification of Heat field median (2.81) |
| 5 | Cooling SEER (VRF) | 3.5 | **3.0** | Field studies; cooling degrades less than heating (ORNL) |
| 6 | SFP — bedroom_extract / mvhr / toilet | 0.4 / 1.4 / 0.4 | **0.8 / 1.8 / 0.8** | Commissioned motor ratings; 505 ventilation review |
| 7 | Fan duties — bedroom / mvhr | 2208 / 1425 | **2292 / 1450** (measured; toilet stays 210) | 2019 commissioning records |
| 8 | Heat recovery (mvhr) | 80% | **70%** | In-service exchanger performance (TM63 convention) |
| 9 | Lighting | 2.5 W/m² | **3.5 W/m²** | Always-on communal/external circuits (report 2.7) |
| 10 | Laundry — NEW explicit equipment entry | — | **34.5 MWh/yr** equivalent, named `equipment_laundry` | 505 washing/tumble-dryer energy calc |
| 11 | Setpoints htg/clg | 21 / 24 | **22 / 23** | Occupant behaviour under HO regime; no setback established |
| 12 | ASHP DHW COP / gas η | 3.4 / 0.89 | **2.8 / 0.85** | High-lift duty (505 convention) / cycling + standing losses |
| 13 | DHW plant split gas:HP | 75/25 | **60/40** | 505-derived ASHP share |
| 14 | DHW demand | 48.2 L/p/day | **re-converge** to gas = 207.7 MWh ± 2% under new split/η | Gas-anchoring rule (design note). Report converged value + 60 °C equivalent |
| 15 | Auxiliary residual | — | **balance: modelled elec → 572.4 MWh** | The quantified unknown (design note). See D2 |

NOT adjusted (deliberate): general equipment 4 W/m² (catering remains inside the residual — it is unmetered, which is precisely what the residual represents; record this in the audit note), thermal bridging ×2, trickle-vent EA 1.43, g-value, GIA, occupancy density/rate, gains per person.

**D2 — Residual implementation.** After steps 1–14, residual_kWh = 572,400 − modelled electricity. Implement as a named, flat-profile entry `auxiliary_residual_unattributed` on a pathway the engine demonstrably counts (equipment-class is known-counted: 147.7 MWh appears in outputs; `gains.auxiliary` is known-inert — do NOT use it). Prove consumption: export before/after adding the residual and show the Outputs delta equals the residual. Report it in MWh/yr, W/m² continuous-equivalent, and EUI points.

**D3 — Inert-input trace audit.** For every row the assumptions export emits, trace the input to its engine consumption point (file:function). Deliver a table in the audit note: input → consumed (where) / NOT CONSUMED. The export collector marks non-consumed rows with "⚠ NOT CONSUMED BY ENGINE" appended to Basis/Source. Known case: `gains.auxiliary`. If others surface, list them — do not fix them in this brief (report first; fixes are follow-up briefs).

**D4 — Waterfall record.** A table in the audit note: step # → parameter → EUI after step → Δ vs previous. This populates the report 3.6 ΔEUI column; it is a deliverable, not an internal artefact. Note in it that steps interact (order stated above is canonical).

**D5 — Dirty-state stamp on export.** On export, compare live inputs against the saved scenario of that name and stamp both sheets: `State: saved` if identical, or `State: MODIFIED from "<scenario>" (n values differ)` if not. Every results file then declares which named input set it came from AND whether the live state actually matched it at export time. (Agreed with Chris 2026-07-14 — closes the inputs↔outputs provenance loop. Reuse the comparison from verification 9.)

## Principles / constraints

- Never adjust anything outside D1 to influence any number. Engine output is canonical; audit before fix.
- Model-1 pinned baseline is read-only throughout. Verify at close that its export is byte-comparable (values unchanged).
- No new packages; no lockfile pushes; follow existing scenario/export patterns.

## Parts (one commit each)

0. **Named scenarios (minimal) — ONLY if no mechanism exists.** First, check: can the app persist and reload more than one named input set per project? If yes, skip to Part 1. If no, build the minimal version: save current inputs as a named set, load a named set, list sets (name + saved-at + optional SHA). DB-backed, per project; the existing baseline pin becomes per-scenario. NO version history, NO xlsx import (Excel stays one-way, audit-out only — decision agreed with Chris 2026-07-14), NO management UI beyond save/load/list. Follow the baseline-pin persistence pattern (note its round-trip allow-list bug from the Model-1 session — don't repeat it). Commit: `feat(scenarios): minimal named input-set save/load`
1. **Land brief + scenario creation** — save the current pinned baseline state as scenario "Model 1 — as-specified"; clone it → "Bridgewater Hotel — calibrated (Model 2)" scenario. Commit: `feat(bridgwater): model-2 calibrated scenario scaffold`
2. **Adjustments 1–13 cumulatively** with per-step EUI log. Commit: `feat(bridgwater): in-service adjustments with waterfall record`
3. **DHW re-anchor (step 14)**. Commit: `feat(bridgwater): gas re-anchor under 60/40 split`
4. **Residual (D2) + inert-input audit & export marking (D3)**. Commit: `feat(bridgwater): counted auxiliary residual + input-consumption audit`
5. **Verify, pin Model-2 baseline slot, export both scenarios, audit note, close.** Commit: `chore(bridgwater): verify + close model-2 brief`

## Verification (falsifiable)

1. Gas = 207.7 MWh ± 2% after step 14.
2. Electricity = 572,400 kWh ± 0.5% and EUI = 185.1 ± 0.5 after residual.
3. Residual stop-band: expected ~120–160 MWh. If **< 80 or > 200 MWh**, STOP and report the waterfall table before closing — do not proceed to pin/export.
4. Residual consumption proof (D2 before/after exports).
5. Waterfall table complete: 15 steps, EUI after each, deltas sum (with interaction note) from 119.2 to final.
6. Converged L/p/day reported with 60 °C equivalent; sanity vs 28.9 Model-1 equivalent (expect higher volume — ASHP doing more).
7. Both exports: two sheets, SHA-stamped, inert rows marked; Model-1 export values unchanged vs `b15f13f` export.
8. Occupied rooms 134 / peak 402 in both.
9. Scenario round-trip: save both scenarios, reload the app, load each — inputs identical to what was saved (export-compare). Switching scenarios must not bleed values between them.
10. Dirty-state stamp: export a clean scenario → `State: saved`; change one value, export again → `State: MODIFIED (1 value differs)`; restore → `State: saved`.

## What MUST NOT happen

- Residual on `gains.auxiliary` or any unverified pathway.
- Any tuning of D1 values to satisfy verification 2 or 3 — the residual absorbs the gap by definition; if it can't, that's an escalation.
- Model-1 scenario or its pinned baseline modified.
- Schedule shape changes; engine changes; lockfile pushes.
- Inert inputs silently dropped from the export — they are marked, not hidden.

## When to escalate / STOP (E-numbers)

- **E1:** no existing input mechanism for door-operation infiltration (step 3). Do NOT hack the engine; skip the step, log it in the waterfall as "no mechanism — carried in residual", and continue.
- **E2:** residual outside stop-band (verification 3).
- **E3:** DHW convergence needs L/p/day outside 15–80 (tap basis).
- **E4:** any D1 parameter without a discrete input home.
- **E5:** trace audit finds a *consumed-but-wrong* pathway (input consumed somewhere unexpected) — report, don't fix.
- Three failed approaches on anything.

## Independent review

Standard tier + Claude Chat reviews the audit note, waterfall table, and both exports against the design note before either file is treated as report-ready. Chris walkthrough: toggle between scenarios, eyeball the waterfall, export both.

## Final report

Parts + SHAs · waterfall table (all 15 steps) · final Model-2 EUI · residual (MWh, W/m², EUI points) · converged L/p/day + 60 °C equivalent · inert-input audit table · divergences from brief (Lessons).
