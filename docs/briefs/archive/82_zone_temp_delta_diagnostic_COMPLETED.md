# Brief 82 — Zone-temp delta diagnostic (Bridgewater-Box root cause)

**Author:** Claude Chat (architect)
**Authorised by:** Chris (2 June 2026, post-Brief-81 close)
**Authority level:** Same-day working session (not overnight). Diagnostic only — no engine code changes.
**Provisional number:** 82. Numbering rolls per Brief 81: door bug → Brief 78; interventions diagnostic harness → Brief 79; WWHR → Brief 80; the engine-fix brief that follows from Brief 82's evidence → Brief 83.
**Design note (canonical, READ FIRST):** https://app.notion.com/p/374d645e05cc81f2b19ee7350c46af7d — "Brief 82 design note: Zone-temp delta diagnostic (Bridgewater-Box root cause)". Where this brief and the design note disagree, the design note wins.
**Branch:** All work on `feat/energyplus-validation` (continuation of Brief 81). NEVER merge to `main` during this brief.

---

## CRITICAL CONTEXT — READ BEFORE STARTING

### What Brief 81 found

First-rung Bridgewater-Box comparison: 4/7 tolerances pass. Envelope physics agree (EUI −3.7%, aggregate fabric +11.1%, monthly heating correlation r=0.993, monthly cooling r=0.945). Demand-side booking diverges:

- **Heating demand: −24.0%** ❌ (NZA-Sim lower)
- **Cooling demand: +107.9%** ❌ (NZA-Sim higher)
- **Mech vent net loss: +92.9%** ❌ (NZA-Sim higher)
- **Zone air temperature: +0.49 °C** (NZA-Sim warmer, info row not gated)

### The hypothesis Brief 82 tests

**The four divergences are most likely one finding.** A zone that free-floats ~0.5 °C warmer in NZA-Sim than EnergyPlus would naturally produce all three booking divergences:
- Fewer hours below 21 °C heating setpoint → less heating demand booked
- More hours above 24 °C cooling setpoint → more cooling demand booked
- Different integration of mech vent loss against heating-mode hours

If true: one engine fix collapses three symptoms. If false: three independent issues, three separate briefs.

### Three candidate root causes (ranked by plausibility)

1. **MVHR recovery coupling to zone air node.** Most likely a genuine engine issue. EnergyPlus mixes MVHR supply at the zone air node; NZA-Sim may be applying recovery as supply-side adjustment instead. The 93% mech vent delta is the strongest hint.

2. **Zone heat balance solver convention.** CTF + heat balance method (EnergyPlus) vs quasi-dynamic deadband (NZA-Sim). Defensible difference rather than bug.

3. **Setpoint deadband handling.** EnergyPlus dual-setpoint thermostat with hysteresis vs NZA-Sim's implicit deadband. Could be configuration mismatch.

### What Brief 82 produces

A diagnostic report. NOT an engine fix. Evidence-based determination of which candidate is operative.

---

## BEFORE DOING ANYTHING

1. **Confirm receipt.** Quote this brief's title and the hypothesis paragraph. State current tip of `feat/energyplus-validation` (expected: `f03ee13` or later if Brief 81 close commits have landed). State current tip of `main` (expected: `d8a6207` — unchanged since branch cut).
2. **Read the design note** at https://app.notion.com/p/374d645e05cc81f2b19ee7350c46af7d in full.
3. **Confirm branch.** `git branch --show-current` returns `feat/energyplus-validation`. Verify before every commit.
4. **Read Brief 81's audit document** at `docs/audit/81_energyplus_validation_box.md` — particularly §10 close summary with the divergence findings. The numbers cited above come from there.
5. **Land brief on disk** at `docs/briefs/active/82_zone_temp_delta_diagnostic.md` on the feature branch. Open audit stub at `docs/audit/82_zone_temp_delta_diagnostic.md`.

---

## Parts (one commit per part, minimum)

### Part 1 — Brief landing + branch verify

Confirm branch is `feat/energyplus-validation`. Confirm `main` is unchanged at `d8a6207`. Land brief on disk. Open audit stub.

Commit: `Brief 82 P1: brief landing on feat/energyplus-validation`.

### Part 2 — Hourly zone temperature extraction

Extend the existing harness to dump hourly zone air temperature traces from BOTH engines for the full 8760-hour year (not just sample weeks).

**EnergyPlus side:** Verify the Brief 81 IDF requests `Zone Mean Air Temperature` as an `Output:Variable` at `Hourly` reporting frequency. If not present, add it, re-run the IDF, capture. Output to `validation/energyplus/results/bridgewater_box_v1_hourly_temps.csv` or equivalent.

**NZA-Sim side:** Identify the engine's per-hour zone temperature output in State 2's hourly loop (likely the implicit air-node solver result). Surface it through the extract.mjs pathway as a new field in `validation/nza_sim/results/bridgewater_box_v1_hourly_temps.csv` with the same schema as the EnergyPlus output. The engine probably already computes this internally; check `instantCalc.js` State 2 around line 2540 onwards, look for the air-node solver, and export the per-hour T_zone result.

**Critical:** if the NZA-Sim engine doesn't currently expose per-hour zone temperature in its result schema, add a non-breaking opt-in output (e.g. only when a flag is set in calculateInstant options) so we don't bloat the standard result payload. The opt-in flag must not change any other engine behaviour.

**Falsifiability:** Both CSVs have 8760 rows. Both start at hour 0 of 1 January. Both have the same hour indexing convention (clarify in audit §2 which is hour-beginning vs hour-ending). Sample 10 random hours, hand-verify values look plausible.

Commit: `Brief 82 P2: hourly zone temperature extraction (both engines)`.

### Part 3 — Temperature trace comparison

Write `validation/zone_temp_diagnostic.py` (stdlib + matplotlib if available, else CSV out only) that:

- Loads both hourly CSVs
- Produces hour-by-hour delta: T_NZA_Sim − T_EnergyPlus
- Computes annual statistics: mean delta (should be ~+0.49 °C per Brief 81 finding), median, std dev, max positive, max negative, percentage of hours where delta > 0
- Computes monthly statistics: mean delta per month
- Identifies "divergence regimes": classify each hour into bands by external temperature, heating/cooling demand state, ventilation system operation, etc. — see which conditions produce the largest deltas
- Produces a markdown report at `validation/reports/zone_temp_diagnostic_{timestamp}.md`

**Specific questions the report must answer with evidence:**

1. **Is the delta constant or conditional?** A constant ~0.49 °C offset suggests a systematic calibration difference. A delta that varies with external temperature, time of day, or ventilation mode suggests a coupling issue.

2. **Does the delta correlate with ventilation activity?** Plot delta vs ventilation flow (constant 50 L/s in Bridgewater-Box, but check if NZA-Sim ever schedules it off). If delta is markedly different during scheduled-off hours vs scheduled-on hours, candidate 1 (MVHR coupling) is confirmed.

3. **Does the delta correlate with internal gains?** Plot delta vs occupancy/lighting/equipment schedule. If delta is high during occupied hours and low during unoccupied, gains-handling differs.

4. **Does the delta correlate with heating/cooling mode?** Tag each hour as heating, cooling, or free-floating in EnergyPlus. Compute mean delta per mode. If delta is mode-asymmetric (e.g. larger during free-float than during heating), it points to deadband behaviour.

5. **At setpoint transitions** (the few hours per year where the zone crosses 21 °C or 24 °C), is the delta exaggerated? Hysteresis differences would show here.

Commit: `Brief 82 P3: zone temperature trace comparison + divergence regime analysis`.

### Part 4 — Counterfactual test: does fixing the temp delta close the demand gaps?

This is the load-bearing test of the hypothesis.

Write a small Python or Node script that:

1. Takes the NZA-Sim hourly zone temperature trace from P2
2. Subtracts 0.49 °C from every hour (or whatever the mean offset turns out to be from P3)
3. Re-books heating/cooling demand against the shifted trace using the same setpoint logic EnergyPlus uses (heating below 21 °C, cooling above 24 °C, deadband in between)
4. Re-books mech vent loss against the shifted heating-mode hours
5. Compares the re-booked totals against EnergyPlus's totals

**Critical:** This is NOT modifying NZA-Sim's engine. It's a post-hoc arithmetic exercise on the output trace to test whether a zone-temp fix would resolve the booking divergences. No engine code changes.

**Three named outcomes:**

- **Outcome (a) — hypothesis confirmed:** Re-booking against the shifted trace brings heating, cooling, and mech vent all within tolerance (±10-15% of EnergyPlus values). Zone temp is the single root cause. Brief 83 becomes "fix the zone temp solver/coupling" — one targeted fix.

- **Outcome (b) — hypothesis partially confirmed:** Re-booking closes one or two of the three demand gaps but not all. The unresolved divergence has an independent cause. Brief 83+ becomes two briefs: one for the upstream temp fix, one for the remaining divergence.

- **Outcome (c) — hypothesis rejected:** Re-booking against the shifted trace doesn't close any of the demand gaps. The three divergences are independent of the temp delta. Brief 83+ becomes three sequential briefs, or a deeper architectural review is required.

Document outcome in audit §4 with quantitative evidence. Predict before measuring. Acknowledge prediction error if outcome is (b) or (c).

Commit: `Brief 82 P4: counterfactual re-booking test against shifted zone trace`.

### Part 5 — Candidate root cause identification

Based on the evidence from P3 (when/under-what-conditions divergence occurs) and P4 (whether temp is upstream), identify which of the three candidate root causes is operative:

1. **MVHR coupling to zone air node** — if delta varies with vent activity (P3 Q2) AND mech vent gap doesn't close with re-booking (P4 outcome b/c on vent specifically)
2. **Solver convention** — if delta is roughly constant across regimes (P3 Q1) AND re-booking closes the demand gaps (P4 outcome a)
3. **Setpoint deadband handling** — if delta is exaggerated near setpoint transitions (P3 Q5) AND re-booking is sensitive to deadband width

Document evidence and verdict in audit §5. State confidence level honestly (e.g. "candidate 1 is consistent with all evidence; candidate 2 is also possible but less consistent" rather than overclaiming).

If evidence is genuinely ambiguous or points to a coupled cause, say so. Don't force a clean answer.

Commit: `Brief 82 P5: candidate root cause verdict + evidence`.

### Part 6 — Brief 83 recommendation + close

Write Brief 82's close summary in audit §6:

- P2 evidence: hourly trace summary
- P3 evidence: divergence regime analysis
- P4 outcome: (a), (b), or (c)
- P5 verdict: which candidate(s) operative
- **Recommended Brief 83 scope:** one fix / multiple fixes / deeper review
- Concrete next investigation steps if applicable
- Honest assessment of confidence

Update STATUS.md on the branch (not on `main`) — Brief 82 closed, Brief 83 candidate identified.

Commit: `Brief 82 P6: close summary + STATUS update + Brief 83 recommendation`.

**Push final state to origin. DO NOT merge to main.**

---

## What MUST NOT happen

- **Any commit, push, or merge to `main`.** All work on `feat/energyplus-validation` branch only.
- **Any engine code change.** This is diagnostic only. The opt-in zone-temp output in P2 is the closest thing to a code change permitted, and it must be non-breaking (off by default, no other behaviour changes).
- **Modifying the EnergyPlus IDF** (with one narrow exception: P2 may add the `Zone Mean Air Temperature` output variable if absent — that's an output declaration, not a model change).
- **Tuning NZA-Sim to make the comparison pass.** The point is to identify root cause, not to close gaps cosmetically.
- **Forcing a clean root cause when evidence is ambiguous.** If P4 returns outcome (b) and the verdict is unclear, say so. Don't manufacture certainty.
- **Spending more than 60 minutes on any single sub-problem before escalating.** Standard hard-STOP discipline.
- **Skipping P4's counterfactual test.** It's the most important part of the brief — the test of whether the zone temp is upstream of the booking divergences.

---

## Hard-STOP triggers (escalate to Chris, do NOT push past)

- **P2 reveals NZA-Sim's State 2 doesn't actually compute hourly zone temperature** (e.g. it uses a different solver that doesn't produce a per-hour T_zone value). STOP. The whole brief's hypothesis assumes T_zone exists as an hourly quantity. If it doesn't, the framing changes.
- **P3 shows the delta has bizarre patterns** that don't fit any of the three candidates (e.g. constant 5 °C offset during August only). Document, STOP, escalate.
- **P4 outcome is dramatically different from any of (a), (b), (c)** — e.g. re-booking makes the demand gaps WORSE. Documents an unexpected coupling. STOP.
- **Any indication that work has accidentally landed on `main`.** STOP IMMEDIATELY.

---

## What "session success" looks like

A diagnostic report exists at `validation/reports/zone_temp_diagnostic_{timestamp}.md` showing:
- Hourly delta statistics
- Divergence regime analysis (when/why the engines disagree)
- Counterfactual test outcome
- Verdict on operative root cause
- Clear recommendation for Brief 83's scope

Chris reads the report. Based on outcome:
- Outcome (a) → Brief 83 is one small targeted engine fix
- Outcome (b) → Brief 83 splits into two fixes
- Outcome (c) → Architect-Chris conversation about deeper architectural review before any fix brief

---

## What "session partial/failure" looks like

If session ends before P6:
- Whatever's committed gets pushed.
- A `WIP_STATUS.md` at the branch root explains where things ended.
- Audit document captures everything tried.

Hitting a hard-STOP early is acceptable. Producing a misleading "verdict" without evidence is not.

---

## Authority notes

This brief follows Brief 76's premise-check precedent: if reading source reveals the architect's hypothesis is wrong (e.g. NZA-Sim doesn't have a per-hour T_zone solver at all, or the divergence is structurally different from what's hypothesised), **push back via audit document comment, propose the actual investigation path, and execute that** — but document the divergence clearly so Chris can review.

The architect has been wrong three times in this week alone. The diagnose-before-fix discipline that worked: Code reads source, runs evidence, pushes back on architect framings, proposes evidence-grounded next step.

---

## Final notes

This brief is small and focused. It produces evidence, not code changes. The answer determines Brief 83's shape.

If the hypothesis is right and outcome is (a), we're roughly one targeted engine brief away from having a validated engine on Bridgewater-Box. If it's wrong, we know that, and we approach Brief 83 with the right scope from the start.

Good luck.
