# Brief 85 design note — Internal mass partition (Finding A resolution)

## Where this came from

Brief 84a closed the mech-vent FAIL via a like-for-like harness fix (no engine change). Brief 84b characterised the remaining FAILs (heating −24%, cooling +108%) as faces of one underlying finding: NZA-Sim's zone air node free-floats ~+1.10 °C warmer than EnergyPlus during 2,949 both-unconditioned hours.

Brief 84b's evidence pointed at thermal mass as the dominant mechanism — the delta is conditional on outdoor temperature (r = −0.57), conditional on ΔT (r = +0.50), night-heavy, lower under sun/occupancy. That's the fingerprint of mass over-damping during slow thermal transients, not a gains booking issue or a setpoint deadband artefact.

But Brief 84b couldn't quantitatively partition the +1.10 °C between mass and residual solver convention, because the engine's internal-mass calibration hook is dead via the production path. `calculateInstant` silently drops `opts.tuning` at approximately `instantCalc.js:L4961`. Code flagged this as a 1-line defect at Brief 85 Step 0 rather than fixing autonomously — correct call.

## What this brief is testing

**Hypothesis:** When NZA-Sim's internal mass is set to a defensible value (most likely construction-derived from Bridgewater-Box's actual layer specs), the +1.10 °C free-float delta against EnergyPlus drops substantially. The residual after mass alignment characterises the genuine solver-convention difference.

**Three subordinate questions:**

1. **Does the mass hypothesis hold quantitatively?** A clean monotonic relationship between mass and delta would confirm the conditional patterns in 84b. A chaotic or non-monotonic relationship would refute it.

2. **What's the residual delta after mass alignment?** This number determines whether the remaining structural difference (1st-order vs 3rd-order integration, hourly vs sub-hourly substepping) is small enough to be defensible.

3. **What's the right value for NZA's default internal mass?** Bare envelope is too far one way; the current tuned-lumped value is a hack. Construction-derived from actual layer specs is most defensible.

## What this brief produces

**Step 0 — Plumbing fix.** Wire the dropped `opts.tuning` hook through `calculateInstant`. ~1-3 lines. Strict requirement: default behaviour byte-identical when `opts.tuning` is absent.

**Step 1 — Internal mass sweep.** Run the harness at 5+ mass values (including bare envelope, current tuned 25 MJ/K, and construction-derived). Capture free-float delta, demand deltas, conditional patterns, mech-vent regression check at each.

**Step 2 — Verdict.** Based on Step 1 evidence, recommend Brief 86's scope:
- **(a)** Construction-derived mass minimises residual to <0.3 °C → land construction-derived as default in Brief 86.
- **(b)** Some intermediate mass minimises residual at 0.3-0.8 °C → Brief 86 = calibration brief.
- **(c)** No mass value brings residual below ~0.8 °C → Brief 86 = tolerance + documentation brief.

## Architectural decisions made upstream

Three questions Brief 84b left open. Chris's answers (2 June 2026):

1. **Internal mass philosophy:** Construction-derived is the long-term right answer. Tuned-lumped is a hack; bare-envelope is unrealistic. Step 1 includes construction-derived as a sweep point; Step 2 decides whether to land it.

2. **Bare-vs-furnished EP reference:** For validation purposes (this brief), strip both engines to physics-bare. The current Brief 81 IDF (zero internal mass) stays as the comparison target. EP-side internal mass re-spec is a separate question, picked up later if needed.

3. **Tolerance vs engine change:** Evidence-gated. Depends on Step 1's residual. Step 2 makes the call.

## Three sequential steps, hard checkpoints

This brief is staged. Each step has a verification gate before the next begins. Step 0 must wire the hook AND verify default behaviour preserved AND verify hook responds to non-default inputs. Step 1 must produce sweep data AND honest partition. Step 2 must give a verdict grounded in Step 1's evidence.

The discipline is: small bug fix first, then the experiment the bug fix enables, then the verdict the experiment supports. Each step's hard-STOP triggers (in the brief) prevent the next step from running on broken foundations.

## What this brief does NOT do

- Re-spec the EP IDF (no internal mass added on the EP side in this brief).
- Re-specify the Bridgewater-Box YAML fixture.
- Re-tune tolerances (tolerance change is a possible Brief 86 outcome, not this brief's deliverable).
- Land construction-derived as default in this brief (that's Brief 86 outcome (a), based on Step 2's verdict).
- Address full Bridgewater (Bridgewater-Box only).
- Touch any engine code beyond the Step 0 plumbing fix.

## Branch

All work on `feat/energyplus-validation`. NEVER merge to `main` during this brief.

After Brief 85 closes, the harness fix from 84a and the plumbing fix from 85 Step 0 might both be candidates for back-port to `main` (neither is an engine architectural change). But that's a separate decision after Chris reviews Step 2's verdict.

## The architect's verification responsibility

Per Chris's instruction 2 June 2026 ("your job is to verify, always"): this brief is grounded in Brief 84b's audit evidence — specifically the +1.10 °C delta with its conditional pattern, the identified mass and integration-order differences, and the dead `opts.tuning` hook. The architect has not source-read `calculateInstant:L4961` directly; that's part of Code's Step 0.2 work. If Code's source-read reveals the hook drop is more complex than 84b suggested, push back via audit comment and reframe — same premise-check authority as Briefs 76, 83.

## Decision log

**2 June 2026:** After Briefs 84a + 84b's close, Chris confirms:
- Brief 85 scope is the staged Step 0 + Step 1 + Step 2 path Code outlined in the handoff
- The three architectural decisions are answered upfront (construction-derived mass long-term; bare EP for validation; tolerance vs engine change is evidence-gated)
- Brief 85 closes the Brief 81-85 validation arc with whichever outcome (a/b/c) Step 1 supports
- Brief 86 implements (or documents) the verdict
