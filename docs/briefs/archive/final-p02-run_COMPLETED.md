# Brief — Final P02 Run: Engine Fixes, Measure Re-Authors, All-In Costs, Print-Ready Results (TONIGHT)

**Repo:** NZA-Sim · **Land at:** `docs/briefs/active/final-p02-run.md` · **Branch:** `chris/final-p02-run` off main
**Authority:** Notion design note "Two-model methodology…" incl. Interventions rules. **Rule override, tonight only:** the ventilation-scheduler fix (Part 2) is an engine change, permitted under a byte-identical guard because every existing schedule is 100% always-on (output provably unchanged). The P02 number-freeze point moves to this brief's close; the gated briefs (thermal-bridging, gains.auxiliary, performance-gap-term) re-gate against THIS run's SHA — update their gate lines as part of close.
**Context:** the P02 report ships tonight from this run's outputs. Everything below is final unless a verification fails.

## BEFORE DOING ANYTHING
- Confirm receipt (quote title). Land brief first. Reconciliation (active/, current.md, STATUS, git log −20). Clean tree, DB backup.
- **Part 0 — state verification (blocking):** reload pinned "Bridgewater Hotel — calibrated (Model 2)"; export; confirm `State: saved`, EUI = 185.1, elec 572,400 ±0.5%, gas 207,700 ±2%. Record the GF units' `summer_bypass` state as found (expected: true — it is the existing design, per Chris). Same check on pinned Model 1 (119.2). Chris hand-tested toggles today; if either scenario fails, STOP and report before any work — do not "fix" a drifted baseline silently.

## Goal
Make the engine consume ventilation schedules, expose glazing g-value per orientation, re-author the intervention stack to tonight's agreed final form with all-in costs, re-run everything against the pinned Model 2, and deliver print-ready results for report section 4.8 plus fresh exports.

## Parts (one commit each)

### Part 1 — Parity audit, both directions (do first: it scopes Parts 2–3)
Trace UI inputs ↔ engine consumption ↔ measure patch-targets in BOTH directions. Known cases: `gains.auxiliary` (UI, not consumed), ventilation `schedule` (UI, not consumed by fan/vent-heat paths — Chris proved live tonight), `summer_bypass` (engine capability that the diagnostic doc wrongly declared absent — correct `docs/audit/interventions_stale_targets_diagnostic.md` with an addendum note, do not rewrite history). Deliver the audit table; fix nothing beyond Parts 2–3's scope.

### Part 2 — Ventilation scheduler consumed (engine, guarded)
Fan energy and the ventilation heat/free-cooling paths multiply by the system's schedule fraction hour-by-hour instead of 8,760 flat. **Guard:** with all schedules at 100%, both pinned scenarios' exports are byte-identical (values) before/after — this is the acceptance test and the licence for touching the engine tonight. Then prove consumption: set a test schedule 50% on a scratch config → fan energy halves.

### Part 3 — Glazing g-value input, per orientation
UI-editable g per glazing entry/orientation (film scope is SW-only); flows to the solar path (already consumed); appears in the assumptions export with basis string; dirty-stamp participates. Guard: pinned scenarios byte-identical (exposing an input must not change its value).

### Part 4 — Measure re-authors (final agreed set)
1. **MVHR — full flow (primary):** existing patches + `summer_bypass: true` + SFP → **1.2** (spec choice, new plant). Expected ≈ **−2.4 kWh/m²** (Chris hand-run; tolerance ±0.3). Narrative: conditional on three specification choices — bypass, SFP ≤1.2 verified against retained ductwork/plenum at design stage, full design flow.
2. **MVHR — reduced flow (sensitivity):** same + flow 1,656. Expected ≈ **−1.9**. Narrative: kept to show full flow wins once fans are cheap.
3. **DELETE the GF HR-bypass measure concept** (never create it): GF bypass is the existing design (baseline carries it). No row anywhere.
4. **NEW: Communal ventilation night shutdown** (replaces the "run-hours" enabling row): GF units scheduled off **23:00–07:00** (all day-types). Post-Part-2 this is Modelled. Hand estimate −1.5 kWh/m²; report the modelled figure. £0 (controls visit). Delivery note: confirm kitchen prep start — if 06:00, window is 23:00–06:00.
5. **Film → SW-only:** g 0.55→0.35 on SW orientation only (needs Part 3); cost **£4,040** (101 m² × £40). Re-run; expect materially below the old −1.6.
6. **Brise soleil:** geometry confirmed 60 SW windows × 1 m; cost **£31,200** (60 × £520). Re-run if its patch scope changed; else keep −0.2.
7. **WWHR → at-refurb basis:** marginal cost **~£650/room** [CONFIRM unit price], saving −10.7 **at full rollout over the refurbishment cycle**; flagged out of the immediate investment stack (status: specification policy). NO stack-based variant anywhere.
8. **Keycard:** cost **under review** pending room wiring survey (circuit separation); keep −4.5 with the regime-sensitivity note (−25% is a normal-trading benchmark, optimistic under Home Office occupancy).
9. **Exhaust-air over ASHP:** delivery note "duct onto the coil intake [CONFIRM airflow path from RUA datasheet]"; package-with-larger-ASHP note.
10. **Larger ASHP:** basis stated **~120 kW @ ~£920/kW installed** incl. electrical upgrade.
11. **Kitchen:** Enabling; **£5.0k TBC subject to metering/monitoring spec**; indicative ~2 kWh/m² (15% of est. 50–70 MWh) stated in narrative, EXCLUDED from 4.8 totals; staff training/observation in delivery.
12. **Lighting:** basis "communal+external ≈ 40% of 77.8 MWh; sensing+LED completion saves 35–40% of that" → −2.8 stands; [CONFIRM luminaire mix on site walk].
13. **Room metering:** £5.0k package basis (10 rooms × ~£500: CT ~£100 + gateway + electrician day + commissioning); wiring survey added to its scope.
14. **Fan duty:** unchanged (−3.6, £2.9k); mutual-exclusivity note vs MVHR (acts on the system MVHR replaces).

### Part 5 — All-in cost structure
Cost plan gains category multipliers applied to base costs: **settings/commissioning ×1.00 · supply-and-fit ×1.12 · works packages ×1.32** [CONFIRM house rates — components: MEP design ~9%, prelims ~13%, OH&P ~8%, contingency ~10% for works tier]. Assign: works = ASHP, MVHR, VRF replacement, brise soleil, PV, exhaust-air, interlink; supply-fit = low-flow, film, keycard, lighting, WWHR-at-refurb marginal, metering packages; settings = controls visit, fan duty, night shutdown. Tariffs **[CONFIRM: elec £0.25/kWh, gas £0.06/kWh]** stated in the cost plan. Paybacks and £/tCO₂e recompute from ALL-IN capex. Both base and all-in retained in data; 4.8 prints all-in.

### Part 6 — Full re-run + outputs (the report feeds from these)
- Full stack isolated vs pinned Model 2 (scenarios untouched — export-compare guard). Conservation check per measure. Residual untouched by every measure.
- Regenerate: `docs/audit/interventions_model2_results.md` (per-measure: EUI Δ, MWh, lifetime tCO₂e, £/t all-in, payback all-in, base + all-in capex, basis notes); both scenario assumption exports; the interventions xlsx export.
- **Print-ready 4.8 table** as a markdown block in the final report message, grouped by theme in report order, exactly the columns: Theme | Intervention | EUI Δ | Lifetime tCO₂e | £/tCO₂e (all-in) | Payback (all-in) | Capex (all-in), with footnotes: ASHP running-cost line; MVHR three-conditions line; WWHR at-refurb line; keycard under-review flag; kitchen indicative-excluded line; "measures do not simply sum"; mutual exclusivity (fan duty vs MVHR); tariffs/uplifts per Appendix A.

### Part 7 — Verify + close
Verification (falsifiable): (1) Part-0 state checks passed; (2) byte-identical guards (Parts 2–3) passed; (3) Model 2 still closes 572,400/207,700/185.1 exactly after all work; (4) MVHR full −2.4 ±0.3, reduced −1.9 ±0.3; night shutdown reported vs −1.5 estimate (outside ±0.7, explain before printing); (5) conservation on every measure; (6) film SW-only result < old −1.6 and explained; (7) every 4.8 row's capex = base × its category multiplier; (8) no row exists for GF bypass, stack-WWHR, trickle-vent standalone, or purge. Update the three gated briefs' gate lines to this run's close SHA. Audit note, STATUS, archive brief, push, PR (no self-merge — but note: Chris will use the docs/exports from the branch tonight for the report; merging can follow tomorrow).

## MUST NOT
No thermal-engine changes beyond Part 2's guarded scheduler fix. No touching pinned scenario values. No absolute `set` on L/p/day. No tuning any result toward an expected value — tolerances are tripwires, not targets. No lockfile pushes. Kitchen's indicative saving never enters totals.

## Escalate / STOP
Part-0 failure (drifted baseline) · either byte-identical guard fails · Model 2 fails to re-close · any expected-value tolerance blown twice · conservation violation · three failed approaches.

## Final report
Part SHAs · Part-0 findings (incl. GF bypass state as found) · parity-audit table · the print-ready 4.8 block · per-measure deltas vs hand-run expectations · divergences (Lessons).

---
## Part-0 resolution (Chris, 2026-07-17) — recorded at landing
State-verification found THREE scenarios; the live/active/pinned baseline is **"Bridgewater — calibrated
(Model 2.1)"** (GF `summer_bypass: True`, the existing design — re-pinned 2026-07-16 22:45), NOT the stale
no-bypass "Model 2". Engine confirms `summer_bypass` IS consumed: cooling 50.23→42.63 MWh, so **Model 2.1 =
EUI 183.3 / elec 564,836 / gas 207,700**. Model 1 = 119.2 (clean).
**Decision:** Model 2.1 is canonical. **Accept elec 564,836 (1.3% under the 572,400 meter)** — residual
stays 147.75 MWh, NOT re-sized. **The freeze point and all Part-7 verification numbers move to
183.3 / 564,836 / 207,700** (superseding the brief's 185.1 / 572,400). Model 1 unchanged at 119.2.
