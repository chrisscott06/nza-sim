# Brief 81 — EnergyPlus validation harness (Bridgewater-Box first rung) — OVERNIGHT

**Author:** Claude Chat (architect)
**Authorised by:** Chris (2 June 2026, post-Brief-77 walkthrough)
**Authority level:** Full autonomous execution on Opus 4.8. Estimated runtime: 8–12 hours. Chris reviews in the morning.
**Provisional number:** 81. Numbering rolls: door bug → Brief 78; interventions diagnostic harness → Brief 79; WWHR → Brief 80; subsequent EnergyPlus extension work (full Bridgewater, Phase 5 iteration, CI) → Briefs 82+.
**Design note (canonical, READ FIRST):** https://www.notion.so/373d645e05cc8163929dca9070e8d261 — "Brief 81 design note: EnergyPlus validation harness — Bridgewater-Box first rung". Where this brief and the design note disagree, the design note wins.
**Branch:** All work on a new branch `feat/energyplus-validation`, cut from current `main` tip. NEVER merge or push to `main` during this brief.

---

## CRITICAL CONTEXT — READ ALL OF THIS BEFORE STARTING

### Why this brief exists

After five weeks of building NZA-Sim's custom JavaScript dynamic simulation engine, the team has hit the limit of internal validation. This week alone, Briefs 75/76/77 surfaced a major bug cycle where the model's headline numbers were wrong for four days because first-principles hand-calculations missed an upstream issue (`_calculateState2:2921` reading v25-only ventilation when Bridgewater is v40). The fix landed at commit `ccc2e72`, but the time-to-discovery was unacceptable.

**The cost of not having an external validation reference is now greater than the cost of building one.** Every brief in the queue is being developed against an engine whose absolute correctness we cannot independently verify. This brief is the first concrete step toward fixing that.

### Why EnergyPlus

EnergyPlus is the de facto standard for whole-building dynamic energy simulation, maintained by the US Department of Energy with 30+ years of validation against measured buildings. It is genuinely independent of NZA-Sim's internal architecture, which is exactly what we need from a validation reference.

### What we are NOT trying to do

- We are NOT replacing NZA-Sim's engine. NZA-Sim stays primary for the UI and live preview.
- We are NOT trying to mirror NZA-Sim's internal state architecture (envelope-only → gains added → vents added → systems added) inside EnergyPlus. This would defeat the purpose of independent validation. **Build EnergyPlus the EnergyPlus way.** See "Critical design decision" below.
- We are NOT building this on `main`. Everything happens on the `feat/energyplus-validation` branch.
- We are NOT building the full Bridgewater integration in this brief. We are building Bridgewater-Box (a simpler reference building, defined in this brief) as the first validation rung. Full Bridgewater comes in Brief 82+.
- We are NOT building CI integration in this brief. That's later.

### Critical design decision: build EnergyPlus the EnergyPlus way

The single most important architectural decision in this brief: **EnergyPlus is configured per ASHRAE/IBPSA/EnergyPlus best practice, NOT to mirror NZA-Sim's state-progression architecture.**

NZA-Sim has internal "states" — State 1 (envelope only), State 2 (envelope + gains + vents + integrated demand), State 3 (State 2 + systems). These are useful UX abstractions inside NZA-Sim. They are NOT how EnergyPlus is meant to work.

EnergyPlus runs a single integrated simulation. All loads, schedules, surfaces, and systems coexist from hour 1 of the year through hour 8760. There is no "envelope-only output" inside EnergyPlus that we can compare against NZA-Sim's State 1.

**The comparison happens at the OUTPUT level, not at intermediate stages of the simulation.** We compare:
- Annual heating demand: NZA-Sim's number vs EnergyPlus's number
- Annual cooling demand: same
- Annual mech vent heat loss: NZA-Sim's `losses.mech_ventilation` vs EnergyPlus's equivalent zone air loss
- Monthly heating profile: same
- Sample-week hourly heating profile (one winter week, one summer week): same
- Per-envelope-term annual conduction (walls, roof, floor, glazing): same

Both engines compute these metrics internally; we extract and compare them. Where they agree to within tolerance, we have high confidence. Where they disagree, we have a question to investigate (Phase 5 work, deferred to later briefs).

**If you are tempted to add an "envelope-only mode" or "no-systems mode" to EnergyPlus to match NZA-Sim's states: STOP.** That defeats the purpose of independent validation.

### History the brief is informed by

Recent briefs (read these before starting if useful context needed):
- **Brief 72 OVERNIGHT** (28-29 May): autonomous overnight execution after DB-loss incident. Established the pattern of overnight autonomous Code runs with hard-STOPs and morning handoff.
- **Brief 73**: Removed ventilation share validation. Established three-render-site pattern (Brief 73 P5-redux: multiple components share data, must update together).
- **Brief 74**: Added mech ventilation ribbon + auxiliary visualisation. Closed cleanly.
- **Brief 75**: Diagnostic for heating-demand-zero on Bridgewater. P2 returned outcome (c). Stayed open at "P2-only, superseded" status.
- **Brief 76 (REAL)**: Fixed `_calculateState2:2921` v25-only ventilation iteration. Bridgewater's headline numbers became defensible for the first time this week. EUI 143.5, heating 98.3, cooling 53.1, mech vent 326.0.
- **Brief 77**: Per-system ventilation rendering across all three Heat Balance view modes. Σ-preservation gate at 326.0 MWh ±1 MWh verified. Closed cleanly.

Key architectural patterns from the week:
- **Architect reads engine source BEFORE writing engine briefs, not after.** Three of this week's briefs went wrong because the architect built on Code's summaries without reading the actual source. Code's diagnostic discipline (read source, push back on premise, propose actual fix) is what saved each brief. This brief instructs Code to apply the same discipline to EnergyPlus best practice — read EnergyPlus documentation before writing IDF code.
- **Display-parity discipline**: when multiple render sites consume the same data, update all of them together. This brief applies the same logic to: where multiple metrics extracted from EnergyPlus need to match NZA-Sim metrics, all extractions stay consistent.
- **Two-independent-calcs-at-zero is a valid gate**: if both engines independently produce zero for a quantity, that's strong agreement. Don't force a non-zero comparison to feel meaningful.

---

## BEFORE DOING ANYTHING — first steps

1. **Confirm receipt.** Quote this brief's title and the first paragraph of "Why this brief exists." State tip of `main` SHA (expected: `ccc2e72` or later if Brief 77 commits have landed).
2. **Read the design note** at https://www.notion.so/373d645e05cc8163929dca9070e8d261 in full. It contains rationale and context this brief does not repeat.
3. **Confirm STATUS.md is reconciled at Brief 77 close.**
4. **Cut the feature branch.** From current `main` tip, create branch `feat/energyplus-validation`. Push to origin. All subsequent commits in this brief go to this branch only. Verify before each commit that `git branch --show-current` returns `feat/energyplus-validation`.
5. **Land brief on disk** at `docs/briefs/active/81_energyplus_validation_box.md` on the feature branch. Open audit stub at `docs/audit/81_energyplus_validation_box.md`.
6. **Read this brief in full before starting Part 1.** Especially "What MUST NOT happen" and "Hard-STOP triggers."

---

## What you have to work with

- NZA-Sim repo: `C:\Users\ChrisScott\Dev\nza-sim` (Chris's machine). Public repo at github.com/chrisscott06/nza-sim.
- Frontend: React, port 5176. Backend: Python, port 8002. SQLite database.
- `go.bat` launcher.
- Bridgewater post-Brief-77 anchor (your validation target):
  - EUI: 143.5 kWh/m²·yr
  - Σ electricity: 387.2 MWh, Σ gas: 204.7 MWh
  - Heating demand: 98.3 MWh
  - Cooling demand: 53.1 MWh
  - DHW: 263.2 MWh
  - Vent fan total: 42.0 MWh
  - Σ losses: 549.2 MWh, Σ gains: 586.3 MWh, Net: +37.1 MWh
  - Mech ventilation loss: 326.0 MWh (three systems: vent_mvhr_gf_public 75% HRE, vent_bedroom_extract 0% HRE, vent_public_toilet_extract 0% HRE)
  - Carbon: 27.0 kgCO₂/m²·yr
- Bridgewater spec: 4,125 m² GIA, 134 rooms (canonical), hotel use, UK climate.

---

## Bridgewater-Box specification

Bridgewater-Box is a deliberately-simplified reference building. Same envelope physics as Bridgewater, single zone, one vent system, no auxiliary loads. The intent is to give EnergyPlus and NZA-Sim the smallest possible degrees-of-freedom comparison so disagreements are easy to localise.

**Geometry:**
- Single rectangular zone, single storey
- GIA: 100 m² (a small box, easy to verify hand-calcs)
- Floor: 10 m × 10 m
- Floor-to-ceiling height: 3.0 m → volume 300 m³
- Four external walls: north (10 × 3 = 30 m²), south (30 m²), east (30 m²), west (30 m²). Total opaque: 120 m² minus glazing.
- Glazing: one window per facade, 2 m × 1.5 m = 3 m² each, total 12 m². Opaque wall after deduction: 108 m².
- Roof: 100 m² (flat, exposed to outside)
- Ground floor: 100 m² (in contact with ground)

**Construction U-values (match Bridgewater's library defaults):**
- External wall: 0.18 W/m²·K
- Roof: 0.15 W/m²·K
- Ground floor: 0.20 W/m²·K
- Glazing: 1.2 W/m²·K, g-value 0.55, light transmission 0.7
- Thermal bridging linear losses: 0.05 W/m·K × perimeter (40 m) = 2.0 W/K total
- Air permeability (infiltration): 0.5 ACH constant
- Permanent vents: none

**Internal gains:**
- Occupancy: 4 people, 70% occupancy rate, sensible 75 W/person + latent 55 W/person (CIBSE Guide A standard hotel)
- Lighting: 5 W/m², daily profile matching Bridgewater's lighting schedule (CIBSE 14h-on / 10h-off cycle)
- Equipment: 3 W/m² baseload + 2 W/m² active during occupied hours
- DHW: 80 L/person/day at 60°C delivery
- No auxiliary loads (to keep the comparison simple)

**Ventilation:**
- One MVHR system, balanced supply/extract, 50 L/s total flow, 75% HRE sensible, SFP 1.5 W/(L/s)
- Continuous operation 8760 hours
- No summer bypass (to keep first-rung simple)

**Systems:**
- Heating: gas boiler, 90% seasonal efficiency, setpoint 21°C
- Cooling: split AC, EER 3.0, setpoint 24°C
- DHW: gas-fired water heater, 80% efficiency, no MVHR contribution

**Weather:**
- London (Heathrow, IWEC TMY3 or equivalent), latitude 51.4775°N, longitude 0.4614°W
- Reuse whichever weather file NZA-Sim is currently using for Bridgewater; we want both engines reading the same source data. Document the exact filename in the YAML fixture.

**Location/orientation:**
- North-facing primary entry (south facade gets primary solar)
- Site exposure: standard urban

The fixture lives at `validation/fixtures/bridgewater_box_v1.yaml` once Phase 1 completes. The YAML schema is yours to design; document it in `docs/audit/81_*.md` §1 so future fixtures follow the same shape.

---

## Phases (one commit per part, minimum)

### Phase 1 — Lock the reference fixtures

**Part 1 — Branch + brief landing + STATUS check.**
Cut `feat/energyplus-validation` branch from `main`. Push to origin. Land brief on disk. Open audit stub. Confirm STATUS reconciled at Brief 77 close. **DO NOT MERGE TO MAIN AT ANY POINT.**

Commit: `Brief 81 P1: branch cut + brief landing on feat/energyplus-validation`.

**Part 2 — Bridgewater-Box YAML fixture.**
Author `validation/fixtures/bridgewater_box_v1.yaml` per the Bridgewater-Box specification above. Document the YAML schema in audit §2. The fixture must contain every input value needed to:
- Run NZA-Sim's engine (so the YAML can be loaded into a project)
- Generate an EnergyPlus IDF (later in Phase 2)

Include comments in the YAML for every field explaining its source and units. The fixture is a documentation asset as much as a data file.

**Falsifiability:** Hand-load the YAML into a fresh NZA-Sim project in the local DB. Run the engine on it. Capture the result. Document the Bridgewater-Box NZA-Sim anchor in audit §2:
- EUI, heating demand, cooling demand, mech vent loss, Σ losses, Σ gains, Net residual

These numbers become the comparison target for EnergyPlus in Phase 4.

Commit: `Brief 81 P2: Bridgewater-Box YAML fixture + NZA-Sim anchor`.

**Part 3 — Bridgewater v1 YAML fixture (full Bridgewater, frozen anchor).**
Author `validation/fixtures/bridgewater_v1.yaml` capturing Bridgewater's current state post-Brief-77 as a versioned fixture. This is preparatory work for Brief 82; we want the fixture frozen NOW while Bridgewater is in its most defensible state.

This is exporting the current SQLite project into YAML form — every input value, geometry, construction, system, schedule. Document approach in audit §3.

**Falsifiability:** Hand-load the YAML into a fresh project (different from the live Bridgewater). Run the engine. Compare to Brief 77 anchor: EUI 143.5, heating 98.3, cooling 53.1, mech vent 326.0. Must agree within ±1% across all headline metrics.

Commit: `Brief 81 P3: Bridgewater v1 YAML fixture (frozen anchor for Brief 82)`.

### Phase 2 — IDF generation

**Part 4 — EnergyPlus installation.**
Install EnergyPlus locally in a contained location: `tools/energyplus/` under the repo (gitignored) OR a Docker container, whichever Code prefers. Document approach in audit §4 including version (target: EnergyPlus 23.2.0 or newer LTS; check current LTS at time of install).

**Hard requirements:**
- Installation does NOT modify global PATH or system-wide environment.
- Installation directory is gitignored.
- The runner script (later) finds EnergyPlus via an environment variable or config file, not a global install.

Verify install: run EnergyPlus's bundled "1ZoneEvapCooler" example IDF, confirm it produces a valid `.eso` output file.

Commit: `Brief 81 P4: EnergyPlus install + bundled example validation`.

**Part 5 — Hand-author Bridgewater-Box IDF.**
Write a hand-authored `validation/energyplus/bridgewater_box_v1.idf` per EnergyPlus best practice. Read the EnergyPlus Input/Output Reference and ASHRAE 140 example files for guidance — do NOT guess IDF syntax. Document references in audit §5.

The IDF must:
- Match the Bridgewater-Box specification exactly: same geometry, same construction U-values, same internal gains, same ventilation, same systems, same weather.
- Include the right `Output:Variable` and `Output:Meter` declarations to extract these metrics for Phase 4 comparison:
  - Annual heating demand (`HVAC,Sum,Heating:Energy`)
  - Annual cooling demand (`HVAC,Sum,Cooling:Energy`)
  - Per-zone air system loads (heating/cooling sensible)
  - Per-surface conduction heat transfer (walls, roof, floor, glazing) — split by direction and net
  - Zone mech vent heat loss (related to `Zone Mechanical Ventilation Heat Loss Energy` or equivalent — check EnergyPlus's reporting variables)
  - Zone infiltration heat loss
  - Internal gains: people, lights, equipment, hot water use
  - Hourly outputs for one winter week (3rd week of January) and one summer week (3rd week of July) for: outside dry-bulb, zone mean air temp, heating system output, cooling system output

**Critical instruction:** Build the IDF the EnergyPlus way. Use EnergyPlus's standard objects: `BuildingSurface:Detailed`, `Construction`, `Material`, `Window`, `People`, `Lights`, `ElectricEquipment`, `ZoneVentilation:DesignFlowRate` (or `ZoneInfiltration:DesignFlowRate` for infiltration + `ZoneHVAC:EnergyRecoveryVentilator` for MVHR), `HVACTemplate:Zone:IdealLoadsAirSystem` or full HVAC objects per ASHRAE 90.1 baseline practice. Do NOT invent custom workarounds to match NZA-Sim's internal state model.

Run the IDF in EnergyPlus. Confirm clean run (no fatal errors, no "severe" warnings — "warning" level is acceptable as long as the simulation completes). Capture outputs.

**Falsifiability:**
- IDF runs successfully on EnergyPlus.
- Annual heating demand is non-zero and within a sensible UK hotel envelope range (for a 100 m² well-insulated box: probably 2-6 MWh/yr).
- Cooling demand is small (well-insulated, modest gains).
- Mech vent heat loss is non-zero (50 L/s × 25% un-recovered).
- Sample-week hourly outputs show variation hour-by-hour, not constant values.

Commit: `Brief 81 P5: Hand-authored Bridgewater-Box IDF + first EnergyPlus run`.

**Part 6 — Python IDF generator.**
Write `validation/energyplus/generate_idf.py` using `eppy`. Given a YAML fixture path, it produces the equivalent IDF. The generator must:
- Reproduce the hand-authored Bridgewater-Box IDF from `bridgewater_box_v1.yaml` to byte-stability (or near-byte-stability, with documented exceptions for non-semantic ordering).
- Be runnable from the command line: `python generate_idf.py validation/fixtures/bridgewater_box_v1.yaml validation/energyplus/generated/bridgewater_box.idf`.

If exact byte-stability is impossible due to `eppy` formatting choices, document the differences and prove semantic equivalence (run both IDFs in EnergyPlus, compare outputs — should be identical to within numerical precision).

Commit: `Brief 81 P6: Python IDF generator + byte-stability verification`.

### Phase 3 — EnergyPlus runner

**Part 7 — Runner + output normaliser.**
Write `validation/energyplus/run.py` that:
- Takes an IDF and a weather file path as input
- Invokes EnergyPlus (subprocess or `eppy.runner`)
- Parses outputs (`.eso`, `.csv`, or via the EnergyPlus reader API)
- Produces normalised JSON output at `validation/energyplus/results/{fixture_name}.json` with this schema:

```
{
  "annual": {
    "heating_demand_kwh": float,
    "cooling_demand_kwh": float,
    "dhw_demand_kwh": float,
    "fabric_loss_kwh": {
      "walls": float,
      "roof": float,
      "floor": float,
      "glazing": float
    },
    "infiltration_loss_kwh": float,
    "mech_vent_loss_kwh": float,
    "internal_gains_kwh": {
      "people": float,
      "lights": float,
      "equipment": float
    },
    "solar_gain_kwh": float,
    "eui_kwh_m2_yr": float
  },
  "monthly": {
    "heating_demand_kwh": [12 floats],
    "cooling_demand_kwh": [12 floats]
  },
  "hourly_winter_week": {
    "outside_drybulb_c": [168 floats],
    "zone_temp_c": [168 floats],
    "heating_kw": [168 floats],
    "cooling_kw": [168 floats]
  },
  "hourly_summer_week": { (same shape) }
}
```

The JSON shape is YOUR design call — document the decisions in audit §7. The schema above is illustrative; adjust as needed for what EnergyPlus actually exposes.

**Falsifiability:** Run the script on Bridgewater-Box. Output JSON has all expected fields populated with non-zero, sensible numbers. No NaNs, no nulls in required fields.

Commit: `Brief 81 P7: EnergyPlus runner + output normaliser`.

### Phase 4 — Comparison report

**Part 8 — NZA-Sim result extractor.**
Write a parallel `validation/nza_sim/extract.py` (or equivalent in JS) that extracts the SAME metrics from NZA-Sim's engine output, into a JSON file at `validation/nza_sim/results/{fixture_name}.json` with the EXACT same schema as Phase 3's output.

The two JSON files must be directly comparable. Same metric names, same units, same scope (annual = full year, monthly = 12-element arrays starting January, hourly samples = same week numbers).

**Falsifiability:** Run on Bridgewater-Box. Output JSON matches the schema. Numbers correspond to Bridgewater-Box NZA-Sim anchor from Part 2.

Commit: `Brief 81 P8: NZA-Sim result extractor matching EnergyPlus schema`.

**Part 9 — Comparison report.**
Write `validation/compare.py` (or equivalent) that takes the two JSON files and produces a Markdown comparison report at `validation/reports/{fixture_name}_{timestamp}.md`.

Report contents:
- **Header:** fixture name, NZA-Sim engine commit SHA, EnergyPlus version, weather file used, run timestamp.
- **Annual comparison table:** every metric in the JSON, NZA-Sim value, EnergyPlus value, absolute delta, percentage delta, tolerance, pass/fail.
- **Monthly comparison:** 12-row table for heating and cooling demand.
- **Hourly samples:** small tables or note on shape correlation for the two sample weeks.
- **Summary:** count of metrics within tolerance vs outside, biggest deltas highlighted.

**Initial tolerances** (these are first-pass; will tighten or loosen in Phase 5 work):
- Annual EUI: ±10%
- Annual heating demand: ±15%
- Annual cooling demand: ±15%
- Annual fabric loss by element: ±20%
- Annual mech vent loss: ±15%
- Monthly profile correlation: ≥0.85 Pearson correlation
- Hourly sample-week pattern: visual review only for now (no automated tolerance)

**Critical instruction:** these tolerances are GENEROUS first-pass. The goal of this brief is to surface ANY disagreement, not to pass tolerance. If everything passes ±5%, that's great. If things are out by 30%, that's the discovery we want to make. The report does not need to "pass" for this brief to close successfully.

**Falsifiability:** Run on Bridgewater-Box. Report is generated. Some deltas will exist; document them honestly. If huge deltas appear (>50%), investigate one layer deep before closing — is it a unit error, a weather-file mismatch, a fundamentally different schedule? Note in audit §9 with hypothesis but do NOT fix in this brief.

Commit: `Brief 81 P9: Comparison report (Bridgewater-Box first-pass results)`.

### Close

**Part 10 — Audit summary + status update + handoff to Chris.**

Write a comprehensive close summary in audit §10:
- Branch state: confirm `feat/energyplus-validation` is up to date, all commits pushed.
- Phase-by-phase status: what completed, what didn't.
- Bridgewater-Box anchor (from NZA-Sim): documented values.
- Bridgewater-Box EnergyPlus first-pass results: documented values.
- Comparison report path.
- Top 3 deltas observed, ranked by magnitude.
- Recommended next brief (Brief 82): apply Phases 1-4 to full Bridgewater, OR Phase 5 iteration on Bridgewater-Box deltas first, depending on what the deltas look like.
- Open questions for Chris.

Update STATUS.md on the branch (NOT on `main`):
- Brief 81 status: completed/partial.
- Branch state.
- Brief 82 candidate.

Commit: `Brief 81 P10: close summary + STATUS update`.

**Push final state to origin. DO NOT merge to main.**

This is the morning handoff. Chris reviews the comparison report and decides next steps.

---

## What MUST NOT happen

- **Any commit, push, or merge to `main`.** All work on `feat/energyplus-validation` branch only.
- **EnergyPlus installation modifying global PATH or system environment.** Contained install only.
- **The IDF being authored to mirror NZA-Sim's state model.** Build it the EnergyPlus way.
- **NZA-Sim engine code being modified during this brief.** Phase 5 iteration is a SEPARATE later brief. This brief observes deltas; it does not fix them.
- **Hand-fudging the comparison to make tolerances pass.** Report whatever EnergyPlus actually produces, even if deltas are large. The goal is honest discovery.
- **Spending more than 90 minutes on any single sub-problem before escalating.** If `eppy` won't install, if EnergyPlus crashes on a specific object, if a weather file doesn't load — stop, document, move to the next phase or write up failure for morning review. Do not iterate-iterate-iterate.
- **Fabricating EnergyPlus outputs.** If EnergyPlus didn't run, the comparison report says so. Never approximate EnergyPlus's behaviour from NZA-Sim's outputs.
- **Adding test buildings beyond Bridgewater-Box.** Full Bridgewater is Brief 82.
- **Building CI integration.** Later brief.
- **Building an "envelope-only" or "no-systems" EnergyPlus mode** to mirror NZA-Sim's State 1.
- **Quiet scope expansion.** The brief defines four phases for Bridgewater-Box; do not start on Bridgewater proper, do not start on Phase 5 iteration, do not start on CI.
- **Modifying any NZA-Sim project in the live DB.** Bridgewater-Box is a NEW project (Part 2 creates it). Existing Bridgewater stays untouched.
- **Committing the EnergyPlus binary to the repo.** Gitignored.
- **Committing weather files larger than a few MB to the repo.** Document path and source; consider git-lfs or external store if needed.

---

## Hard-STOP triggers (escalate to morning review, do NOT push past)

- **Branch cut fails or branches in unexpected ways.** Stop, document, capture morning issue.
- **EnergyPlus install fails after 90 minutes of trying.** Document failure mode, try one alternative install method (Docker if local failed, or vice versa), if that also fails STOP.
- **`eppy` cannot represent a Bridgewater-Box construct.** Document, STOP. (E.g., if MVHR objects are too constrained.)
- **Hand-authored IDF crashes EnergyPlus with fatal errors that don't yield to standard debugging.** Document the error, STOP.
- **Comparison report shows deltas >100% on multiple metrics.** That's likely a unit error or fundamental modeling mismatch. Investigate one layer; if not resolved in 60 minutes, STOP and capture state for morning.
- **Any indication that work has accidentally landed on `main`.** STOP IMMEDIATELY. Document, do not attempt to revert autonomously.
- **EnergyPlus version or `eppy` version produces strange behaviour.** Try one alternative version. If still strange, STOP.
- **Three approaches tried on any single sub-problem with no progress.** STOP, document, await morning direction.

---

## What "morning success" looks like

Chris wakes up to:
- A new branch `feat/energyplus-validation` on origin, with 10 commits.
- A comparison report at `validation/reports/bridgewater_box_v1_{timestamp}.md` showing NZA-Sim vs EnergyPlus side-by-side on Bridgewater-Box.
- An audit document covering everything that happened: what installed, what didn't, what passed tolerance, what didn't, where the surprises are.
- A clear recommendation for Brief 82: scale to full Bridgewater, OR iterate on box deltas first.

Even if the comparison shows large deltas, that's success. The goal is discovery, not agreement. Chris can then make an informed decision about Phase 5 priority.

---

## What "morning partial" looks like

If overnight work didn't reach Part 10:
- Whatever was completed is committed and pushed.
- A `WIP_STATUS.md` at the branch root explains where things ended and what's blocking.
- The audit document captures everything tried.
- Chris can resume work in the morning with full context.

---

## What "morning failure" looks like

If overnight work hit a hard-STOP early:
- Whatever was completed (possibly just Part 1) is committed and pushed.
- A `FAILURE_REPORT.md` at the branch root explains:
  - Where work stopped
  - The specific failure mode
  - What was tried
  - What's needed to unblock (information, decision, tooling)
- The branch is in a state Chris can either delete and restart, or pick up from.

Even hitting an early hard-STOP is acceptable. What is NOT acceptable is pushing through a real problem and producing fabricated or unreliable output.

---

## Authorship and authority notes

This is the second autonomous overnight execution of this project (the first was Brief 72 OVERNIGHT, 28-29 May, which executed successfully with a major DB-loss incident along the way — the incident was correctly stopped, documented, and recovered from in subsequent commits). The pattern: aggressive autonomous execution, hard-STOPs that are actually obeyed, honest morning reporting including failure modes.

You have the architect's full authority for this brief within the scope defined. Do not seek clarification on architectural points during the run; the design note plus this brief contains all decisions you need. If you encounter something genuinely ambiguous, default to the more conservative option (smaller scope, more documentation, no behaviour change).

You also have Code's premise-check authority from this week's Brief 76 precedent: if you read the EnergyPlus documentation and discover that this brief's recommended approach contradicts EnergyPlus best practice, **push back via a comment in the audit document, propose the correct approach, and execute that instead** — but document the divergence clearly so Chris can review in the morning. The brief's intent is the EnergyPlus best-practice approach; specific tooling choices within that intent are yours to refine.

---

## Final notes

This is the most important brief in the project's history so far. Get this right and we have a validated engine for the first time. Get it wrong and we spend another week chasing internal-consistency bugs we can't independently verify.

Take the time to read EnergyPlus documentation properly in Phase 2 before writing IDF code. The IDF format is well-documented but full of subtle conventions; getting it right matters more than getting it fast.

Bridgewater-Box exists because complexity will kill the comparison. Keep it simple. If the box passes tolerance, we scale up confidently. If it doesn't, we localise the issue on a simple geometry before scaling up to one with 134 zones and three vent systems.

Most importantly: be honest. If EnergyPlus and NZA-Sim disagree, that's the discovery we paid for. Don't paper over deltas. Document them. They're the entire point.

Good luck. Push when done.
