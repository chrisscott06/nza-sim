# Brief 84b design note — Finding A free-float characterisation

## Where this came from

Brief 81's first-rung Bridgewater-Box comparison failed on three demand-side metrics: heating −24%, cooling +108%, mech-vent +93%. The zone air temperature also ran +0.49 °C warmer in NZA-Sim than EnergyPlus (info row, not gated).

Brief 82 hypothesised the three FAILs were one finding rooted in the +0.49 °C zone delta. Counterfactual evidence returned outcome (b) — partial. Brief 82 framed two findings: A (free-float warmth, solver convention) and B (same-setpoint magnitude, MVHR booking).

Brief 83 was sent to fix Finding B. Per-hour instrumentation proved Finding B as a recovery-booking bug doesn't exist. NZA and EP agree on per-hour recovery to 3.7% in coil-run hours. The +93% mech-vent excess decomposes entirely into hours where the engines book differently because of when they're booking (NZA: all heating-degree hours; EP: coil-run hours only) — not how much they're booking.

Brief 83 P5: **100% of the mech-vent excess lives in free-float hours.** The "two findings" were one finding viewed two ways. The structural difference is the +1 °C free-float zone temperature delta. Everything else is a downstream consequence.

## What we now know about Finding A

The free-float warmth is a structural property of the difference between the two engines' zone air-node solvers:

- **NZA-Sim:** Lumped quasi-dynamic mass + implicit-Euler step. `C_thermal ≈ 31.7 MJ/K` (per Brief 82 Appendix A). Single hourly timestep.
- **EnergyPlus:** CTF (Conduction Transfer Function) for surfaces + air-node heat balance method. Effective thermal capacitance depends on construction layer specifications and any internal mass objects. Default 6 substeps per hour.

These produce different transient responses to the same hourly forcing. Same envelope physics (envelope-level metrics agree in Brief 81), same internal gains, same ventilation — but the zone air settles ~1 °C warmer in NZA during free-float.

## What this brief tests

**Hypothesis:** The +1 °C free-float offset is a structural solver-convention difference that is defensible on both sides, not a bug in either engine.

**Subordinate questions:**

1. **Is the offset constant or conditional?** A truly structural solver-convention offset should be ~constant during free-float, with possibly some conditional variation tied to thermal mass response time. A conditional offset that correlates with external temperature bands, internal gain magnitude, or ventilation state would suggest a specific coupling issue rather than a generic solver convention.

2. **Where does the offset come from?** Four candidate mechanisms:
   - Thermal mass / capacitance value mismatch
   - Surface convection coefficient correlation differences
   - Timestep / substepping convention
   - Air-node closure assumption (mixing, stratification)

3. **Is there a defensible calibration?** Could one parameter (e.g. C_thermal, or convection correlation choice) be adjusted in NZA to align with EP without changing solver architecture?

4. **Is the right call to widen the harness tolerance and document, or to make an engine adjustment?** Depends on whether NZA's current convention is itself defensible.

## Possible outcomes

This brief is genuinely investigative. It may not produce a code change. Possible outcomes for Brief 85:

- **(a)** Documented defensible difference. Tolerance widened in harness with cited reasoning. No engine change.
- **(b)** Calibration adjustment. One parameter changed with physics-grounded justification.
- **(c)** Real bug surfaced. Targeted fix.
- **(d)** Ambiguous / coupled. More investigation needed before any change.

Code reports outcome honestly. Same diagnostic discipline as Brief 82 P5 (which honestly flagged outcome (b) when the architect expected (a)).

## What this brief does NOT do

- **Implement any engine change.** That's Brief 85's territory, scoped by this brief's recommendation.
- **Touch the harness comparison framework.** That's Brief 84a, parallel.
- **Address full Bridgewater.** Box only.
- **Re-tune tolerances.** Tolerance adjustment is one of Brief 85's possible outcomes, not this brief's deliverable.

## Branch

All work on `feat/energyplus-validation`. The diagnostic-only nature means nothing in this brief should land on `main`. Brief 85 (whatever shape it takes) makes the call on what merges back when.

## The architect's verification responsibility

Per Chris's instruction 2 June 2026 ("your job is to verify, always"): the architect must source-read before brief-writing. Brief 82's framing went wrong because it built on Brief 81's summary numbers without verifying their construction. Brief 83's framing went wrong because it inherited Brief 82's "54% effective recovery" without checking what produced that figure. Brief 84b is written grounded in Brief 83 P4's per-hour evidence — the load-bearing fact is that 100% of the mech-vent excess lives in free-float hours, which Code proved with instrumented data. The architect verified this by reading Brief 83's audit document before drafting.

## Decision log

**2 June 2026:** After Brief 83's diagnostic-only close, Chris approves Brief 84b as the substantive characterisation of Finding A, separate from Brief 84a (harness fix). The two run in parallel. Brief 84b is diagnostic-only; Brief 85 implements whatever Brief 84b recommends. The framing "+1 °C free-float offset is a structural solver-convention difference" is the working hypothesis; Brief 84b tests it against fresh evidence and refutes/refines/confirms.
