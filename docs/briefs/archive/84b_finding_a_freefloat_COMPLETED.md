# Brief 84b — Finding A free-float characterisation (zone air-node solver convention)

**Author:** Claude Chat (architect)
**Authorised by:** Chris (2 June 2026, post-Brief-83 close)
**Authority level:** Same-day investigative session. Diagnostic-first, may or may not produce an engine fix. Branch only.
**Design note (canonical):** `84b_design_note.md` (sibling file). Land in repo at `docs/design-notes/84b_finding_a_freefloat.md` as part of Part 1.
**Branch:** All work on `feat/energyplus-validation`. NEVER merge to `main` during this brief.
**Companion brief:** Brief 84a (harness like-for-like fix) runs separately. They do not depend on each other and can land in either order.

---

## CRITICAL CONTEXT — READ BEFORE STARTING

### What Brief 83 revealed about Finding A

Brief 82 originally framed two divergences from Brief 81's comparison: Finding A (zone temp +0.49 °C warmer in NZA) and Finding B (mech-vent +93% higher in NZA). Brief 83 proved these are not two findings — they are **one underlying finding viewed two ways.**

Brief 83 P4–P5 evidence:
- 100% of the +92.9% mech-vent excess lives in free-float hours (hours where the zone is not being conditioned by EP)
- 59% of it = NZA booking a vent loss term in hours where EP's coil is off
- In coil-run hours (4,426 of the year), NZA and EP agree on per-hour recovery to 3.7%
- The mech-vent metric, as constructed in Brief 81, was Finding A viewed through the ventilation-loss line

**The actual underlying phenomenon:** NZA-Sim's zone air node settles ~+1 °C warmer than EnergyPlus during free-float (unconditioned) hours. This warmer free-float:
- Reduces the count of hours where the zone drops below the 21 °C heating setpoint → less heating demand booked (Brief 81's −24% heating gap)
- Increases the count of hours where the zone rises above the 24 °C cooling setpoint → more cooling demand booked (Brief 81's +108% cooling gap)
- Changes how NZA's all-hours heat-balance mech-vent loss accumulates versus EP's coil-only mech-vent (the 59% + 36% + 5% decomposition in Brief 83)

Three of Brief 81's four FAIL metrics trace back to this single solver-convention difference.

### What this brief is testing

**Hypothesis:** NZA-Sim's zone air-node solver (lumped quasi-dynamic mass + implicit-Euler step) and EnergyPlus's solver (CTF surfaces + air-node heat balance method) produce a structural ~1 °C offset during free-float that is a property of their respective conventions, not a bug in either.

**Subordinate questions:**

1. Is the offset truly constant during free-float, or does it vary with external temperature, internal gains, or building thermal mass?
2. Does the offset arise from differences in thermal mass treatment, timestep convention, surface convection coefficient correlations, or some combination?
3. Is there a calibration adjustment (lumped-mass capacitance value, convection correlation choice, etc.) that would bring NZA closer to EP without changing solver architecture?
4. If yes — is making that adjustment the right call, or is the current NZA convention defensible and the comparison tolerance should widen?

### What this brief produces

A characterisation report. The output may be:
- **(a)** A documented defensible solver-convention difference. Brief 85 widens free-float-related tolerances in the harness with cited reasoning. NZA engine unchanged.
- **(b)** A calibration adjustment (one parameter, one value change, well-grounded in the evidence). Brief 85 implements it.
- **(c)** A real engine bug surfaced by the characterisation. Brief 85 fixes it.
- **(d)** Genuinely coupled / ambiguous. Brief 85 conversation with Chris about scope before any further work.

Code reports outcome honestly. Same diagnostic discipline as Brief 82.

### What this brief does NOT do

- **Implement any engine fix.** This brief is diagnostic + design. Brief 85 implements whatever the diagnostic recommends.
- **Touch the harness comparison framework** (that's Brief 84a, parallel).
- **Address full Bridgewater.** Bridgewater-Box only.
- **Re-tune tolerances yet.** Tolerance adjustment is part of Brief 85's potential outcomes, not this brief's deliverable.
- **Merge to `main`.**

---

## BEFORE DOING ANYTHING

1. **Confirm receipt.** Quote this brief's title and the "What Brief 83 revealed" section. State tip of `feat/energyplus-validation`. State tip of `main` (expected: `d8a6207`).
2. **Read the design note** (sibling `84b_design_note.md`).
3. **Read Brief 82's audit document** (`docs/audit/82_zone_temp_delta_diagnostic.md`) §3 (divergence regime analysis) and §5 (candidate ranking).
4. **Read Brief 83's audit document** (`docs/audit/83_mvhr_recovery_booking.md`) §4 (per-hour data findings) and §5 (decomposition of the +92.9% gap).
5. **Confirm branch.** `git branch --show-current` returns `feat/energyplus-validation`.
6. **Land brief + design note on disk.** Brief at `docs/briefs/active/84b_finding_a_freefloat.md`. Design note at `docs/design-notes/84b_finding_a_freefloat.md`. Open audit stub at `docs/audit/84b_finding_a_freefloat.md`.

---

## Parts (one commit per part, minimum)

### Part 1 — Brief + design note landing + fresh evidence inventory

Land brief and design note. Open audit stub.

**Important:** verify with fresh eyes what per-hour data already exists from Briefs 82 P2 and 83 P4. The instrumentation from those briefs should already provide:
- Hourly NZA zone air temperature trace (Brief 82 P2)
- Hourly EP zone air temperature trace (Brief 82 P2)
- Hourly per-system MVHR heat flows on both engines (Brief 83 P4)
- Hourly outdoor temperature
- Hourly internal gains schedules

Document in audit §1 what's available and what (if anything) needs additional extraction for this brief's questions. Don't add new instrumentation unnecessarily — the existing data should answer most of the subordinate questions.

Commit: `Brief 84b P1: brief + design note landing + evidence inventory`.

### Part 2 — Free-float characterisation: is the offset constant?

Using the existing hourly traces, characterise the free-float zone-temp delta with fresh analysis (not relying on Brief 82's framing):

- **Identify "free-float" hours rigorously:** hours where neither engine is actively conditioning. Use EP's coil-off flag AND NZA's setpoint-not-bound condition. Both must hold.
- **Statistics over the free-float subset:** mean delta, median, std dev, min, max, percentage of free-float hours where delta > 0.
- **Conditional analysis:** does the delta vary with
  - External temperature bands (e.g. ≤0, 0-10, 10-20, ≥20 °C)?
  - Internal gain magnitude (occupied vs unoccupied hours)?
  - Ventilation system state (system on vs system off — if applicable)?
  - Solar incidence (cloudy vs sunny hours, using horizontal solar from weather)?
  - Time of day (transient effects after schedule transitions)?
  - Day of year / season (cumulative thermal mass effects)?
- **Visualisation:** if matplotlib available, produce a few key plots: delta vs external temp, delta over time (one winter week, one summer week, one shoulder week), delta histogram. CSV output as fallback.

Document in audit §2 with quantitative findings. Answer subordinate question 1: is the offset constant or conditional?

Commit: `Brief 84b P2: free-float delta characterisation + conditional analysis`.

### Part 3 — Solver-convention source read (NZA-Sim)

Read NZA-Sim's air-node solver source. Document in audit §3 with file + line refs:

- **Where is the zone air-node temperature integrated each hour?** Identify the implicit-Euler step in State 2 (probably around line 3550-3650 of `instantCalc.js`).
- **What thermal mass / capacitance value is used?** Where does `C_thermal` come from? Is it a configured input, a derived geometric/material value, or a hard-coded approximation? (Brief 82's Appendix A noted `C_thermal ≈ 31.7 MJ/K` — confirm and trace its derivation.)
- **What surface convection coefficients are used?** Hardcoded values, correlations, or pulled from constructions?
- **What is the timestep treatment?** Single hourly step? Sub-hourly substeps? Adaptive?
- **What other terms enter the air-node balance?** Surface conduction, infiltration, mech vent supply, internal gains — verify all are present and entering with correct signs.

This is read-only. Goal: understand exactly what the solver is doing, so the offset's source can be localised.

Commit: `Brief 84b P3: NZA-Sim air-node solver source read`.

### Part 4 — Solver-convention source read (EnergyPlus reference)

Read EnergyPlus documentation + the IDF Brief 81 generated. Document in audit §4:

- **Which zone heat balance method is configured?** (`ZoneAirHeatBalanceAlgorithm` — likely `ThirdOrderBackwardDifference` by default, or something else).
- **What surface heat balance is configured?** CTF? Conduction Finite Difference? Default vs explicit.
- **What thermal mass is EP using?** Look at the construction layer specifications, internal mass objects, and zone volume. Compute the effective thermal capacitance EP is integrating against. Compare to NZA's value from Part 3.
- **Convection coefficients?** Default algorithm (TARP / DOE-2 / etc.) or explicit overrides.
- **Timestep?** Default 6/hour? Other?

Goal: understand exactly what EP is doing, so the structural difference can be characterised.

Commit: `Brief 84b P4: EnergyPlus solver convention source read`.

### Part 5 — Localise the structural difference

Based on P2-P4 evidence, identify which solver-convention element is the dominant contributor to the free-float offset. Candidate mechanisms (more may emerge from reading):

1. **Thermal mass / capacitance mismatch.** NZA's lumped `C_thermal` differs from EP's effective thermal capacitance. Different mass = different free-float thermal lag = different settled temperature.
2. **Convection coefficient correlation.** Different surface heat-transfer coefficients change how quickly the zone air equilibrates with surface temperatures.
3. **Timestep convention.** NZA's single-hourly implicit-Euler vs EP's sub-hourly substepping produces different transient responses.
4. **Implicit air-node closure assumption.** NZA may close the air-node balance under an assumption EP doesn't (e.g. perfect mixing at every step, or no infiltration-driven stratification).

Or some combination. Or a fifth mechanism evidence reveals.

For each candidate, walk through the math from Part 3 / Part 4 evidence and show whether it would produce the observed magnitude and conditional pattern of the offset (from Part 2). Rank by consistency with evidence.

Document the verdict in audit §5. State confidence honestly.

**Critical:** if reading source reveals the offset's source isn't a solver convention question at all (e.g. an infiltration coupling bug, a missing surface, a wrong U-value), **push back via audit comment and reframe.** Same premise-check authority as Briefs 76, 83.

Commit: `Brief 84b P5: solver-convention localisation + ranked candidates`.

### Part 6 — Recommendation for Brief 85

Based on Part 5's verdict, recommend Brief 85's scope. One of:

- **(a) Documented defensible difference.** Brief 85 widens free-float-related tolerances in the harness with cited reasoning. NZA convention is reasonable; EP convention is reasonable; they differ; the comparison tolerance should reflect that. Document and move on.
- **(b) Calibration adjustment.** Brief 85 changes one well-grounded parameter (e.g. C_thermal value, convection correlation choice, timestep substepping) to bring NZA closer to EP. Adjustment must be defensible on physics grounds, not engineered to make the comparison pass.
- **(c) Real bug.** Brief 85 fixes it.
- **(d) Ambiguous / coupled.** Chris-architect conversation about scope before Brief 85.

Document recommendation in audit §6 with reasoning.

Commit: `Brief 84b P6: Brief 85 recommendation`.

### Part 7 — Close

Write Brief 84b close summary in audit §7:

- P2 evidence: free-float delta character (constant / conditional / patterns)
- P3-P4 evidence: solver-convention reads, key numerical comparisons
- P5 verdict: dominant mechanism + confidence
- P6 recommendation: Brief 85 scope (a/b/c/d)
- Open questions for Chris
- Confirmation `main` untouched at `d8a6207`

Update STATUS.md on the branch — Brief 84b closed, Brief 85 candidate scope identified.

Commit: `Brief 84b P7: close summary + STATUS update + Brief 85 handoff`.

Push to origin. **DO NOT merge to main.**

---

## What MUST NOT happen

- **Any commit, push, or merge to `main`.**
- **Any engine code change.** This is diagnostic + design. Brief 85 implements (or doesn't).
- **Tuning anything to make the comparison pass.** Brief 84b's job is to characterise honestly, not close gaps.
- **Adding new instrumentation if the existing per-hour data suffices.** Verify P1's evidence inventory first.
- **Forcing a clean root cause when evidence is ambiguous.** Outcome (d) is allowed.
- **Touching Brief 84a's territory** (harness comparison framework). They're parallel concerns.
- **Spending more than 90 minutes on any single sub-problem before escalating.**

---

## Hard-STOP triggers

- **P2 finds the delta isn't actually concentrated in free-float hours.** Brief 83's Finding A framing was wrong. STOP, re-frame.
- **P3 finds the source isn't where Brief 82's Appendix A located it.** STOP, document, re-frame.
- **P5 verdict requires touching things outside the zone air-node solver** (e.g. surface heat balance, infiltration model, construction layer treatment). STOP — the finding is bigger than this brief's scope.
- **P5 evidence points at a real engine bug** (not a solver-convention difference). STOP — Brief 85 becomes a fix brief with different shape than (a)/(b).
- **Any indication work has landed on `main`.** STOP IMMEDIATELY.

---

## What "session success" looks like

A characterisation report exists that honestly answers: is the +1 °C free-float offset a defensible solver-convention difference, a calibration question, or a bug? Brief 85 has a clear scope based on the evidence. The hypothesis "NZA's lumped quasi-dynamic mass + implicit-Euler vs EP's CTF + heat balance produce a structural offset" is either supported with quantitative evidence, refined into a more specific mechanism, or refuted in favour of a different explanation.

---

## What "session partial/failure" looks like

If session ends before P7:
- Whatever's committed gets pushed.
- `WIP_STATUS.md` at branch root explains where things ended.
- Audit captures partial findings.

A diagnostic-only outcome (Parts 1-5 complete, no Brief 85 recommendation yet) is acceptable — the next session picks up the recommendation work. Producing a misleading verdict without evidence is not.

---

## Authority notes

This brief follows the discipline pattern that is now load-bearing: source-read first, evidence-grounded analysis second, recommendation third. The architect's job is to verify and write the brief; Code's job is to push back on the framing if source-reading shows it's wrong.

The two-finding tension from Brief 82 has now collapsed into one finding (per Brief 83's evidence). This brief works with that consolidated framing. If the source-read reveals the framing is *still* wrong, push back via audit comment.

---

## Final notes

This is the substantive characterisation that should have been Brief 82 — but Brief 82's framing ran ahead of the evidence and led to Brief 83's premise error. Brief 84b returns to first principles with fresh eyes and three rounds of accumulated per-hour data.

The outcome may not be a fix. That's fine. The goal is honest understanding of why the two engines settle ~1 °C apart in free-float, and a clear-eyed call about whether that warrants engine change, tolerance change, or documentation.

Good luck.
