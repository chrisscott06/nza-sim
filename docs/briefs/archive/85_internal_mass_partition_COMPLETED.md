# Brief 85 — Internal mass partition (Finding A resolution)

**Author:** Claude Chat (architect)
**Authorised by:** Chris (2 June 2026, post-Briefs 84a + 84b close)
**Authority level:** Same-day staged session. Three steps with hard checkpoints. Branch only.
**Design note (canonical):** `85_design_note.md` (sibling file). Land in repo at `docs/design-notes/85_internal_mass_partition.md` as part of Step 0.
**Branch:** All work on `feat/energyplus-validation`. NEVER merge to `main` during this brief.
**Lineage:** Closes the open evidence path from Brief 84b. The +1.10 °C free-float delta needs to be partitioned between internal mass and residual solver convention before any engine-level commitments are made.

---

## CRITICAL CONTEXT — READ BEFORE STARTING

### What Briefs 84a + 84b established

**Bridgewater-Box validation state: 5/7 PASS** (up from 4/7 at Brief 81 close).
- 84a moved mech-vent comparison from +93% FAIL → +3.6% PASS via like-for-like coil-run-hours pairing. Harness fix only, no engine change.
- 84b characterised the remaining FAILs (heating −24%, cooling +108%) as faces of one underlying finding: NZA-Sim's zone air node free-floats +1.10 °C warmer than EnergyPlus during 2,949 both-unconditioned hours (97.5% positive delta).

### What the evidence says about the +1.10 °C delta

Brief 84b P2 — **conditional and loss-side**:
- r = −0.57 vs external temperature (delta grows as it gets colder)
- r = +0.50 vs ΔT (delta grows with heating-mode temperature differential)
- Night-heavy
- Lower under sun and occupancy
- Fingerprint of thermal storage / mass over-damping, not a gains booking issue

Brief 84b P3/P4 — **structural differences identified**:

| | NZA-Sim | EnergyPlus (Bridgewater-Box) |
|---|---|---|
| Air-node integration | 1st-order implicit Euler, 1 step/hour | 3rd-order backward difference, 6 substeps/hour |
| Lumped internal mass | 25 MJ/K (98.6% of air capacitance, tuned to EP summer max) | 0 (bare reference box) |
| Source position in code | `instantCalc.js` State 2 around L3550-3650 | EP defaults + IDF as Brief 81 generated |

Brief 84b P5 — **decisive blocker surfaced**: `calculateInstant` silently drops `opts.tuning` at approximately `instantCalc.js:L4961`. The internal-mass calibration hook exists in code, has been tuned, but is dead via the production path. The sweep that would partition the +1.10 °C delta couldn't run within Brief 84b's scope. Code flagged this as the prerequisite for Brief 85 Step 0 rather than fixing autonomously — correct call.

### Architectural decisions made upstream (don't re-litigate)

Three questions Brief 84b left open. Chris's answers (2 June 2026):

1. **Internal mass philosophy:** Construction-derived is the right long-term answer. Tuned-lumped is a hack; bare-envelope is unrealistic. Step 2 below codifies this — but Step 1 runs an explicit sweep BEFORE the engine-level commitment is made, so the choice is evidence-backed.

2. **Bare-vs-furnished EP reference:** For validation purposes (this brief), strip both engines to physics-bare in the comparison. Realistic-mass comparisons happen on full Bridgewater later. Brief 85 does NOT re-spec the EP IDF with internal mass — that's a separate question, picked up after Step 2 if needed.

3. **Tolerance vs engine change:** Depends on Step 1's evidence. If construction-derived mass brings residual delta below ~0.3 °C, engine change wins. If residual is 0.5-0.8 °C, calibration is its own brief. If residual is >0.8 °C, solver convention is genuinely structural and tolerance widens with cited reasoning. Step 2 is gated on Step 1's numbers.

### What Brief 85 produces

**Step 0:** A 1-line plumbing fix that wires `opts.tuning` through `calculateInstant`. Smallest possible change. Plus a verification test that confirms the hook is now live.

**Step 1:** A live internal-mass sweep on Bridgewater-Box. Run the harness at 5+ mass values (bare envelope, 10 MJ/K, 25 MJ/K, 50 MJ/K, 100 MJ/K, construction-derived). Plot delta vs mass. Identify the mass that minimises delta and the residual at that minimum.

**Step 2:** Based on Step 1's evidence, one of three outcomes:
- **(a) Construction-derived mass minimises residual to <0.3 °C.** Land construction-derived as NZA's default. Engine change.
- **(b) Some intermediate mass minimises residual at 0.3-0.8 °C.** Step 1's evidence becomes input to a separate calibration brief. Brief 85 closes diagnostic-only.
- **(c) No mass value brings residual below ~0.8 °C.** Solver convention is structural. Brief 85 closes by documenting + widening tolerance with cited reasoning. EP-side mass re-spec becomes a follow-up question.

---

## BEFORE DOING ANYTHING

1. **Confirm receipt.** Quote this brief's title and the "What Briefs 84a + 84b established" paragraph. State tip of `feat/energyplus-validation` (expected: `85d47c9` or later if Brief 84b close commits have landed). State tip of `main` (expected: `d8a6207` — unchanged since branch cut).
2. **Read the design note** (sibling `85_design_note.md`).
3. **Read Brief 84b's audit document** at `docs/audit/84b_finding_a_freefloat.md` — particularly §2 (free-float delta character), §3 (NZA solver source read), §4 (EP solver convention), §5 (dead `opts.tuning` hook).
4. **Confirm branch.** `git branch --show-current` returns `feat/energyplus-validation`.
5. **Land brief + design note on disk.** Brief at `docs/briefs/active/85_internal_mass_partition.md`. Design note at `docs/design-notes/85_internal_mass_partition.md`. Open audit stub at `docs/audit/85_internal_mass_partition.md`.

---

## Steps

This brief is structured as three sequential steps with hard checkpoints between them. **Each step must pass its own verification before the next begins.** Do not skip ahead.

### Step 0 — Wire `opts.tuning` through `calculateInstant`

**Goal:** Make the internal-mass calibration hook live via the production path. Smallest possible change.

**Part 0.1 — Brief landing + branch verify.**
Land brief and design note. Open audit stub. Confirm branch.

Commit: `Brief 85 P0.1: brief landing on feat/energyplus-validation`.

**Part 0.2 — Source read of the dropped hook.**
Read `instantCalc.js` around L4961 (per Brief 84b P5's reference). Document in audit §0.2:
- The exact line(s) where `opts.tuning` is dropped or ignored
- The intended flow path (where it should reach)
- The proposed fix (expected: 1-3 lines)
- Any other callers of `calculateInstant` that pass `opts.tuning` — confirm they expect it to plumb through

This is read-only. No code changes.

Commit: `Brief 85 P0.2: source read of opts.tuning drop point`.

**Part 0.3 — Implement the plumbing fix.**
Make the minimum change to wire `opts.tuning` through to wherever it's consumed (likely the State 2 internal-mass parameter). Document the diff in audit §0.3.

**Hard requirement:** the change must NOT alter behaviour when `opts.tuning` is undefined or absent. Default behaviour stays byte-identical to pre-fix. Only when `opts.tuning` is explicitly passed does the new path activate.

Commit: `Brief 85 P0.3: opts.tuning plumbing fix`.

**Part 0.4 — Verify the hook is live.**

Run two end-to-end tests:

1. **Default path test:** Run the existing harness with no `opts.tuning` set. Confirm Bridgewater-Box result is byte-identical to Brief 84b's anchor (same EUI, same heating demand, same cooling demand, same zone temp trace). If anything moves, the fix has leaked into default behaviour — STOP.

2. **Hook activation test:** Run the engine with `opts.tuning = { internalMassMJperK: 0 }` (bare envelope). Confirm the result differs from default. Run with `opts.tuning = { internalMassMJperK: 100 }`. Confirm the result differs again, in the expected direction (higher mass → more thermal damping → smaller free-float temperature swings).

Document both tests in audit §0.4 with quantitative evidence (anchor values vs test values).

**HARD CHECKPOINT:** Both tests must pass before Step 1. If hook activation test doesn't show expected sensitivity, the plumbing is wrong somewhere downstream — STOP, diagnose, escalate.

Commit: `Brief 85 P0.4: opts.tuning hook verification`.

### Step 1 — Internal mass sweep

**Goal:** Quantify how the +1.10 °C free-float delta varies with NZA's internal mass parameter. Identify the mass value that minimises the delta and the residual at that minimum.

**Part 1.1 — Sweep design.**

Define the mass values to test. Minimum set:
- **0 MJ/K** (bare envelope — matches EP reference box)
- **10 MJ/K**
- **25 MJ/K** (current tuned value, for reference)
- **50 MJ/K**
- **100 MJ/K**
- **Construction-derived value** — compute from Bridgewater-Box's actual layer specs in the YAML fixture. For each opaque surface, sum (thickness × density × specific heat × area) across all material layers. Aggregate to a single MJ/K value. Document the computation in audit §1.1.

Plus any additional values Code thinks are informative (e.g. a point between 25 and 50 if the curve is steep there). State sweep design in audit §1.1 before running.

Commit: `Brief 85 P1.1: sweep design + construction-derived mass computation`.

**Part 1.2 — Run the sweep.**

For each mass value, run the full harness end-to-end:
```
node validation/nza_sim/extract.mjs --opts-tuning '{"internalMassMJperK": <value>}'
python validation/compare.py
```

(Exact CLI flag depends on how Code wires `opts.tuning` through the extractor — Code can adjust the invocation as needed.)

Capture for each run:
- Free-float delta mean (the +1.10 °C metric)
- Free-float delta conditional patterns (recompute the r = −0.57 vs T_out and r = +0.50 vs ΔT correlations)
- Heating demand delta vs EP
- Cooling demand delta vs EP
- Zone temp std dev (over free-float hours — high mass should reduce swing magnitude)
- Mech-vent delta (the harness-fix metric from 84a — should stay near +3.6% throughout)

Store results as `validation/sweeps/85_internal_mass_sweep.csv` for downstream analysis.

Commit: `Brief 85 P1.2: internal mass sweep execution`.

**Part 1.3 — Sweep analysis + delta partition.**

Plot (or tabulate, if matplotlib unavailable) delta vs mass. Identify:
- The mass value that minimises free-float delta mean (call this `mass_min`)
- The residual delta at `mass_min` (call this `delta_residual`)
- Whether the conditional patterns (r values, night-heaviness) persist at `mass_min` or collapse

**Honest reporting requirement:** if the sweep shows a clean monotonic relationship between mass and delta (delta decreases as mass increases up to some asymptote), partition the original +1.10 °C between "mass-explained" (1.10 − `delta_residual`) and "residual" (`delta_residual`). If the relationship isn't clean (e.g. non-monotonic, or delta doesn't reduce meaningfully at any mass), report that honestly — the mass hypothesis isn't supported by the sweep.

Document in audit §1.3 with quantitative results and plots/tables.

Commit: `Brief 85 P1.3: sweep analysis + delta partition`.

### Step 2 — Outcome verdict + Brief 86 handoff

**Goal:** Based on Step 1 evidence, determine which of the three outcomes applies and recommend Brief 86's scope.

**Part 2.1 — Outcome verdict.**

Based on `mass_min` and `delta_residual`:

- **Outcome (a):** Construction-derived mass minimises residual to <0.3 °C → recommend landing construction-derived as NZA's default in Brief 86 (engine change).
- **Outcome (b):** Some intermediate mass minimises residual at 0.3-0.8 °C → recommend Brief 86 as a calibration brief, with Step 1's sweep data as input.
- **Outcome (c):** No mass value brings residual below ~0.8 °C → recommend Brief 86 as a tolerance-widening + documentation brief. EP-side internal mass re-spec becomes a separate follow-up question.

State the verdict honestly. If the evidence is ambiguous (e.g. residual right around a threshold, or sweep behaviour doesn't fit any of the three cleanly), say so. Don't force a clean answer.

Document in audit §2.1 with reasoning.

Commit: `Brief 85 P2.1: outcome verdict + reasoning`.

**Part 2.2 — Bridgewater-Box validation state summary.**

With Step 1's data, recompute the Bridgewater-Box harness state at the `mass_min` value. How many of the original 7 gated tolerances now pass? Compare:
- Brief 81 baseline: 4/7
- Brief 84a + 84b post-close: 5/7
- Brief 85 post-sweep (at `mass_min`): N/7

This is informational, not a commitment — `mass_min` may not become the production default depending on Step 2.1's outcome. But it tells us what's achievable with the current engine architecture + the opts.tuning hook.

Document in audit §2.2.

Commit: `Brief 85 P2.2: validation state summary at mass_min`.

**Part 2.3 — Close + Brief 86 handoff.**

Write Brief 85 close summary in audit §2.3:
- Step 0 outcome: `opts.tuning` hook live, default behaviour preserved
- Step 1 evidence: sweep results, `mass_min`, `delta_residual`, conditional pattern persistence
- Step 2 verdict: outcome (a/b/c)
- Recommended Brief 86 scope: engine default change / calibration brief / tolerance + documentation brief
- Open questions for Chris
- Confirmation `main` untouched at `d8a6207`

Update STATUS.md on the branch — Brief 85 closed, Brief 86 candidate scope identified.

Commit: `Brief 85 P2.3: close summary + STATUS update + Brief 86 handoff`.

Push to origin. **DO NOT merge to main.**

---

## What MUST NOT happen

- **Any commit, push, or merge to `main`.** All work on `feat/energyplus-validation` only.
- **Engine code changes beyond the Step 0 plumbing fix.** Step 1 is a sweep using the now-live hook; it doesn't add new engine logic. Step 2 is verdict + recommendation; it doesn't implement anything.
- **Changing default behaviour in Step 0.** When `opts.tuning` is undefined, engine output must be byte-identical to Brief 84b's anchor.
- **Skipping the hard checkpoint between Step 0 and Step 1.** If the hook activation test in 0.4 doesn't show expected sensitivity, the sweep is meaningless — diagnose first.
- **Forcing a clean outcome in Step 2.** If evidence is ambiguous, report ambiguous. Outcome (b) and (c) are both legitimate.
- **Touching the EP IDF.** EP-side internal mass re-spec is a separate question (after Step 2 if needed).
- **Re-specifying the Bridgewater-Box YAML fixture.** Same physics, same baseline.
- **Re-tuning tolerances in this brief.** Tolerance change is one possible Brief 86 outcome, not this brief's deliverable.
- **Spending more than 90 minutes on any single sub-problem before escalating.**
- **Reading prior briefs' framings as load-bearing fact without verifying.** Same source-read discipline that's been working through Briefs 76, 81, 83, 84a/b.

---

## Hard-STOP triggers

- **Step 0.2 finds `opts.tuning` is dropped in a more complex way than Brief 84b suggested** (not a 1-3 line fix). STOP, document, escalate.
- **Step 0.4 default path test shows byte-drift.** The plumbing fix has leaked into default behaviour. STOP.
- **Step 0.4 hook activation test shows no sensitivity** (varying mass doesn't change free-float behaviour). The hook isn't actually plumbed through, or the downstream consumer is also broken. STOP.
- **Step 1 sweep shows non-monotonic or chaotic behaviour** vs mass. Mass-hypothesis isn't clean — diagnose before continuing.
- **Step 1 finds construction-derived mass calculation produces an obviously wrong value** (e.g. negative, or differs from sanity-check by orders of magnitude). STOP, fix the computation, document.
- **Step 2 evidence points to a real engine bug** (not a mass/calibration question). STOP — Brief 86 becomes a fix brief with different shape than (a)/(b)/(c).
- **Any indication work has accidentally landed on `main`.** STOP IMMEDIATELY.

---

## What "session success" looks like

Bridgewater-Box's +1.10 °C free-float delta is partitioned between mass-explained and residual. The `opts.tuning` hook is live (a 1-3 line fix that's now in place). Step 2's verdict names which of the three outcomes applies with quantitative evidence. Brief 86 has clear scope based on the evidence.

If outcome (a): we're roughly one targeted engine brief (Brief 86) from having a validated engine on Bridgewater-Box at 6-7/7.

If outcome (b) or (c): we have a calibration question or a documented defensible difference, both legitimate ends to the Brief 81-85 validation arc. Bridgewater-Box validation state is the best it can be without further architectural change.

---

## What "session partial/failure" looks like

If session ends before Step 2:
- Whatever's committed gets pushed.
- `WIP_STATUS.md` at branch root explains where things ended.
- Audit captures partial findings.

A Step-0-only outcome (plumbing fix landed, sweep not run) is acceptable — the next session picks up Step 1. A Step-0+Step-1 outcome without verdict is acceptable — the next session does Step 2.

Producing a misleading verdict without evidence is not.

---

## Authority notes

This brief is the first in this cycle where the architect has source-read enough of the relevant engine code (via Code's Brief 84b audit) to ground the brief properly before sending. Same pattern as Brief 84a/b — premise grounded in fresh evidence from prior briefs' per-hour data, not in Brief 82's original framing.

Code's premise-check authority applies. If Step 0.2's source read reveals the dropped hook isn't where Brief 84b located it, push back via audit comment and reframe. Same for any other framing element that turns out wrong.

The discipline that's working: source-read first, evidence-grounded brief second, implementation third, honest verdict fourth. Brief 85 follows this through three sequential steps with hard checkpoints.

---

## Final notes

This brief should be the last in the Brief 81-85 validation arc. After Step 2's verdict, Brief 86 either:
- Lands a small targeted engine fix (construction-derived mass as default) and validates at 6-7/7 on Bridgewater-Box, OR
- Becomes a calibration brief with Step 1's sweep data as input, OR
- Becomes a tolerance + documentation brief that closes the validation arc with a "defensible structural difference" verdict.

Any of these is forward progress. The point of Brief 85 is to make the choice evidence-backed rather than architect-guessed.

Good luck.
